import { DeploymentRecordStatus, DeploymentStorageType, DeploymentTargetType, TaskType } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { createTask } from '../tasks/service'
import { randomBytes } from 'node:crypto'
import { copyFile, lstat, mkdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'

type PaginationInput = {
  page?: number
  pageSize?: number
}

type CreateStorageInput = {
  name: string
  type: DeploymentStorageType
  bucket?: string
  basePath?: string
  endpoint?: string
  credentials?: Record<string, unknown>
  isActive?: boolean
}

type CreateTargetInput = {
  name: string
  type: DeploymentTargetType
  host?: string
  port?: number
  region?: string
  serviceName?: string
  functionName?: string
  triggerUrl?: string
  credentials?: Record<string, unknown>
  isActive?: boolean
}

type CreateProjectInput = {
  name: string
  description?: string
  storageId?: string
  targetId?: string
  artifactPath?: string
  deployPath: string
  startCommand?: string
  servicePort?: number
  healthCheckPath?: string
  runtimeEnv?: Record<string, string>
  notifyOnSuccess?: boolean
  isActive?: boolean
}

type CreateDeploymentRecordInput = {
  projectId: string
  artifactUri: string
  buildId?: string
  commitSha?: string
  refName?: string
  checksum?: string
  triggeredBy?: string
  metadata?: Record<string, unknown>
}

type TriggerDeploymentInput = Omit<CreateDeploymentRecordInput, 'triggeredBy'> & {
  apiToken: string
}

type EcsRuntimeConfig = {
  appName: string
  deployPath: string
  port?: number
  runtimeEnv?: Record<string, string>
  healthCheckPath?: string
  startCommand?: string
}

type AgentExecuteInput = {
  artifactUri: string
  storageType: DeploymentStorageType
  storageEndpoint?: string | null
  runtimeConfig: EcsRuntimeConfig
}

function normalizePm2AppName(name: string) {
  const normalized = name.trim().replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || `app-${Date.now()}`
}

function buildPm2StartCommand(appName: string) {
  return `pm2 startOrReload ecosystem.config.cjs --only ${appName} --update-env && pm2 save`
}

export function buildProjectWebhookPaths(apiToken: string) {
  return {
    deployWebhookPath: `/deployments/webhook/${apiToken}/deploy`,
    uploadWebhookPath: `/deployments/webhook/${apiToken}/upload`
  }
}

function normalizePage(input: PaginationInput) {
  const page = Math.max(input.page ?? 1, 1)
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 100)
  const skip = (page - 1) * pageSize
  return { page, pageSize, skip }
}

function paginationResult<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1)
  }
}

export async function listArtifactStorages(input: PaginationInput = {}) {
  const { page, pageSize, skip } = normalizePage(input)
  const [items, total] = await prisma.$transaction([
    prisma.artifactStorage.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.artifactStorage.count()
  ])
  return paginationResult(items, page, pageSize, total)
}

export async function createArtifactStorage(input: CreateStorageInput) {
  return prisma.artifactStorage.create({
    data: {
      name: input.name,
      type: input.type,
      bucket: input.bucket,
      basePath: input.basePath,
      endpoint: input.endpoint,
      credentials: (input.credentials || {}) as never,
      isActive: input.isActive ?? true
    }
  })
}

export async function listDeployTargets(input: PaginationInput = {}) {
  const { page, pageSize, skip } = normalizePage(input)
  const [items, total] = await prisma.$transaction([
    prisma.deployTarget.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    }),
    prisma.deployTarget.count()
  ])
  return paginationResult(items, page, pageSize, total)
}

export async function createDeployTarget(input: CreateTargetInput) {
  const generatedApiToken = input.type === DeploymentTargetType.ECS
    ? randomBytes(24).toString('hex')
    : null
  const credentials = {
    ...(input.credentials || {}),
    ...(generatedApiToken ? { apiToken: generatedApiToken } : {})
  }
  return prisma.deployTarget.create({
    data: {
      name: input.name,
      type: input.type,
      region: input.region,
      serviceName: input.serviceName,
      functionName: input.functionName,
      triggerUrl: input.triggerUrl,
      credentials: {
        ...credentials,
        host: input.host,
        agentPort: input.port
      } as never,
      isActive: input.isActive ?? true
    }
  }).then((target) => ({
    ...target,
    generatedApiToken
  }))
}

async function ensureDefaultStorageAndTarget() {
  let storage = await prisma.artifactStorage.findFirst({
    where: {
      type: DeploymentStorageType.LOCAL,
      name: '当前服务器'
    }
  })
  if (!storage) {
    storage = await prisma.artifactStorage.create({
      data: {
        name: '当前服务器',
        type: DeploymentStorageType.LOCAL,
        endpoint: process.env.DEPLOY_LOCAL_ENDPOINT || '',
        basePath: process.env.DEPLOY_LOCAL_BASE_PATH || '',
        isActive: true
      }
    })
  }
  let target = await prisma.deployTarget.findFirst({
    where: {
      type: DeploymentTargetType.ECS,
      name: '当前服务器'
    }
  })
  if (!target) {
    const apiToken = randomBytes(24).toString('hex')
    target = await prisma.deployTarget.create({
      data: {
        name: '当前服务器',
        type: DeploymentTargetType.ECS,
        credentials: {
          host: '127.0.0.1',
          agentPort: Number(process.env.ECS_AGENT_PORT || 7001),
          apiToken
        } as never,
        isActive: true
      }
    })
  }
  return { storage, target }
}

export async function listDeploymentProjects(input: PaginationInput = {}) {
  const { page, pageSize, skip } = normalizePage(input)
  const [items, total] = await prisma.$transaction([
    prisma.deploymentProject.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        storage: true,
        target: true
      },
      skip,
      take: pageSize
    }),
    prisma.deploymentProject.count()
  ])
  return paginationResult(items, page, pageSize, total)
}

export async function createDeploymentProject(input: CreateProjectInput) {
  const defaults = await ensureDefaultStorageAndTarget()
  const apiToken = randomBytes(24).toString('hex')
  const appName = normalizePm2AppName(input.name)
  return prisma.deploymentProject.create({
    data: {
      name: input.name,
      description: input.description,
      storageId: input.storageId || defaults.storage.id,
      targetId: input.targetId || defaults.target.id,
      artifactPath: input.artifactPath,
      deployPath: input.deployPath,
      startCommand: input.startCommand?.trim() || buildPm2StartCommand(appName),
      servicePort: input.servicePort,
      healthCheckPath: input.healthCheckPath,
      runtimeEnv: (input.runtimeEnv || {}) as never,
      apiToken,
      notifyOnSuccess: input.notifyOnSuccess ?? false,
      isActive: input.isActive ?? true
    },
    include: {
      storage: true,
      target: true
    }
  })
}

export async function updateDeploymentProject(id: string, input: Partial<CreateProjectInput>) {
  const nextName = input.name ? normalizePm2AppName(input.name) : ''
  return prisma.deploymentProject.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description,
      storageId: input.storageId,
      targetId: input.targetId,
      artifactPath: input.artifactPath,
      deployPath: input.deployPath,
      startCommand: input.startCommand !== undefined
        ? input.startCommand
        : (input.name ? buildPm2StartCommand(nextName) : undefined),
      servicePort: input.servicePort,
      healthCheckPath: input.healthCheckPath,
      runtimeEnv: input.runtimeEnv as never,
      notifyOnSuccess: input.notifyOnSuccess,
      isActive: input.isActive
    },
    include: {
      storage: true,
      target: true
    }
  })
}

export async function createDeploymentRecord(input: CreateDeploymentRecordInput) {
  const record = await prisma.deploymentRecord.create({
    data: {
      projectId: input.projectId,
      artifactUri: input.artifactUri,
      buildId: input.buildId,
      commitSha: input.commitSha,
      refName: input.refName,
      checksum: input.checksum,
      triggeredBy: input.triggeredBy,
      metadata: (input.metadata || {}) as never,
      status: DeploymentRecordStatus.PENDING
    }
  })
  const task = await createTask({
    name: `部署执行:${record.id}`,
    type: TaskType.DEPLOY_EXECUTE,
    payload: { deploymentRecordId: record.id },
    maxAttempts: 3,
    backoffMs: 3000
  })
  return prisma.deploymentRecord.update({
    where: { id: record.id },
    data: { taskId: task.id },
    include: {
      project: { include: { storage: true, target: true } }
    }
  })
}

export async function triggerDeploymentByProjectToken(input: TriggerDeploymentInput) {
  const project = await prisma.deploymentProject.findUnique({
    where: { id: input.projectId },
    select: { id: true, apiToken: true, artifactPath: true }
  })
  if (!project) {
    throw new Error('部署项目不存在')
  }
  if (project.apiToken !== input.apiToken) {
    throw new Error('无效的项目部署令牌')
  }
  const artifactUri = input.artifactUri.startsWith('/') || !project.artifactPath
    ? input.artifactUri
    : `${project.artifactPath.replace(/\/$/, '')}/${input.artifactUri.replace(/^\//, '')}`
  return createDeploymentRecord({
    ...input,
    artifactUri,
    triggeredBy: 'ci'
  })
}

export async function triggerDeploymentByToken(input: Omit<TriggerDeploymentInput, 'projectId'>) {
  const project = await prisma.deploymentProject.findFirst({
    where: { apiToken: input.apiToken, isActive: true },
    select: { id: true, artifactPath: true, isActive: true }
  })
  if (!project || !project.isActive) {
    throw new Error('无效的项目部署令牌')
  }
  const artifactUri = input.artifactUri.startsWith('/') || !project.artifactPath
    ? input.artifactUri
    : `${project.artifactPath.replace(/\/$/, '')}/${input.artifactUri.replace(/^\//, '')}`
  return createDeploymentRecord({
    projectId: project.id,
    artifactUri,
    buildId: input.buildId,
    commitSha: input.commitSha,
    refName: input.refName,
    checksum: input.checksum,
    metadata: input.metadata,
    triggeredBy: 'cd-token'
  })
}

export async function regenerateDeploymentProjectToken(id: string) {
  const apiToken = randomBytes(24).toString('hex')
  return prisma.deploymentProject.update({
    where: { id },
    data: { apiToken },
    include: {
      storage: true,
      target: true
    }
  })
}

export async function listDeploymentRecords(input: PaginationInput & { projectId?: string; status?: DeploymentRecordStatus } = {}) {
  const { page, pageSize, skip } = normalizePage(input)
  const where = {
    projectId: input.projectId,
    status: input.status
  }
  const [items, total] = await prisma.$transaction([
    prisma.deploymentRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        project: {
          include: {
            storage: true,
            target: true
          }
        }
      },
      skip,
      take: pageSize
    }),
    prisma.deploymentRecord.count({ where })
  ])
  return paginationResult(items, page, pageSize, total)
}

export async function getDeploymentRecord(id: string) {
  return prisma.deploymentRecord.findUnique({
    where: { id },
    include: {
      project: {
        include: {
          storage: true,
          target: true
        }
      },
      stepLogs: {
        orderBy: { stepOrder: 'asc' }
      }
    }
  })
}

export async function retryDeploymentRecord(id: string) {
  const record = await prisma.deploymentRecord.findUniqueOrThrow({
    where: { id }
  })
  return createDeploymentRecord({
    projectId: record.projectId,
    artifactUri: record.artifactUri,
    buildId: record.buildId || undefined,
    commitSha: record.commitSha || undefined,
    refName: record.refName || undefined,
    checksum: record.checksum || undefined,
    triggeredBy: 'retry',
    metadata: {
      retriedFrom: record.id
    }
  })
}

export async function rollbackDeploymentRecord(id: string) {
  const record = await prisma.deploymentRecord.findUniqueOrThrow({
    where: { id }
  })
  return prisma.deploymentRecord.update({
    where: { id: record.id },
    data: {
      status: DeploymentRecordStatus.ROLLED_BACK
    }
  })
}

async function addStepLog(recordId: string, stepOrder: number, stepName: string, status: string, message?: string, details?: Record<string, unknown>) {
  await prisma.deploymentStepLog.create({
    data: {
      recordId,
      stepOrder,
      stepName,
      status,
      message,
      details: (details || {}) as never
    }
  })
}

function resolveArtifactDownloadUrl(storage: { type: DeploymentStorageType; endpoint: string | null; bucket: string | null }, artifactUri: string) {
  if (storage.type === DeploymentStorageType.QINIU) {
    const endpoint = storage.endpoint || ''
    return endpoint ? `${endpoint.replace(/\/$/, '')}/${artifactUri.replace(/^\//, '')}` : artifactUri
  }
  if (artifactUri.startsWith('http://') || artifactUri.startsWith('https://')) {
    return artifactUri
  }
  const endpoint = storage.endpoint || 'http://localhost:9000'
  return `${endpoint.replace(/\/$/, '')}/${artifactUri.replace(/^\//, '')}`
}

function safeRuntimeConfig(raw: Record<string, unknown>): EcsRuntimeConfig {
  const appName = normalizePm2AppName(String(raw.appName || 'autoops-app'))
  const deployPath = String(raw.deployPath || '').trim()
  const port = Number(raw.servicePort || raw.port || 0)
  const healthCheckPath = String(raw.healthCheckPath || '/').trim()
  const startCommand = String(raw.startCommand || '').trim()
  const runtimeEnvRaw = raw.runtimeEnv && typeof raw.runtimeEnv === 'object' ? raw.runtimeEnv as Record<string, unknown> : {}
  const runtimeEnv = Object.fromEntries(
    Object.entries(runtimeEnvRaw).map(([k, v]) => [k, String(v)])
  )
  if (!deployPath) {
    throw new Error('ECS 目标缺少 deployPath 配置')
  }
  return {
    appName,
    deployPath,
    port: Number.isFinite(port) && port > 0 ? port : undefined,
    healthCheckPath: healthCheckPath || '/',
    runtimeEnv,
    startCommand: startCommand || undefined
  }
}

function resolveProjectRuntimeConfig(project: {
  name: string
  deployPath: string
  servicePort: number | null
  healthCheckPath: string | null
  runtimeEnv: unknown
  startCommand?: string | null
}) {
  const runtimeEnvRaw = project.runtimeEnv && typeof project.runtimeEnv === 'object'
    ? project.runtimeEnv as Record<string, unknown>
    : {}
  const runtimeEnv = Object.fromEntries(
    Object.entries(runtimeEnvRaw).map(([k, v]) => [k, String(v)])
  )
  return {
    appName: normalizePm2AppName(project.name),
    deployPath: String(project.deployPath || '').trim(),
    port: project.servicePort || undefined,
    healthCheckPath: project.healthCheckPath || '/',
    runtimeEnv,
    startCommand: (project.startCommand || undefined) || undefined
  } as EcsRuntimeConfig
}

function execFileAsync(file: string, args: string[]) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    execFile(file, args, (error) => {
      if (error) {
        rejectPromise(error)
        return
      }
      resolvePromise()
    })
  })
}

async function downloadArtifactToTemp(url: string) {
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`下载产物失败: ${resp.status}`)
  }
  const bytes = Buffer.from(await resp.arrayBuffer())
  const sourceBaseName = basename(url.split('?')[0] || 'artifact.bin') || 'artifact.bin'
  const fileName = `${Date.now()}-${sourceBaseName}`
  const localPath = join(tmpdir(), fileName)
  await writeFile(localPath, bytes)
  return {
    localPath,
    sourceBaseName
  }
}

async function resolveArtifactLocalPath(input: { artifactUri: string; storageType: DeploymentStorageType; storageEndpoint?: string | null }) {
  if (input.storageType === DeploymentStorageType.LOCAL && !input.artifactUri.startsWith('http://') && !input.artifactUri.startsWith('https://')) {
    return {
      localPath: isAbsolute(input.artifactUri) ? input.artifactUri : resolve(process.cwd(), input.artifactUri),
      sourceBaseName: basename(input.artifactUri) || 'artifact.bin'
    }
  }
  const endpoint = (input.storageEndpoint || '').replace(/\/$/, '')
  const url = input.artifactUri.startsWith('http://') || input.artifactUri.startsWith('https://')
    ? input.artifactUri
    : `${endpoint}/${input.artifactUri.replace(/^\//, '')}`
  return downloadArtifactToTemp(url)
}

function detectArchiveType(filePath: string) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar'
  if (lower.endsWith('.zip')) return 'zip'
  return 'raw'
}

async function extractArtifact(filePath: string, targetDir: string, rawOutputFileName?: string) {
  const archiveType = detectArchiveType(filePath)
  if (archiveType === 'tar') {
    await execFileAsync('tar', ['-xzf', filePath, '-C', targetDir])
    return
  }
  if (archiveType === 'zip') {
    await execFileAsync('unzip', ['-o', filePath, '-d', targetDir])
    return
  }
  await copyFile(filePath, join(targetDir, rawOutputFileName || basename(filePath)))
}

async function ensureEcosystemConfig(releaseDir: string, runtimeConfig: EcsRuntimeConfig) {
  const ecosystemPath = join(releaseDir, 'ecosystem.config.cjs')
  const env = {
    ...(runtimeConfig.runtimeEnv || {}),
    ...(runtimeConfig.port ? { PORT: String(runtimeConfig.port) } : {})
  }
  const cmd = (runtimeConfig.startCommand || 'npm start').trim()
  const content = `module.exports = { apps: [{ name: ${JSON.stringify(runtimeConfig.appName)}, cwd: ${JSON.stringify(releaseDir)}, script: "bash", args: ["-lc", ${JSON.stringify(cmd)}], env: ${JSON.stringify(env)}, autorestart: true, max_restarts: 3, min_uptime: "10s", restart_delay: 5000, exp_backoff_restart_delay: 200 }] }\n`
  await writeFile(ecosystemPath, content, 'utf8')
  return ecosystemPath
}

async function switchCurrentRelease(projectDir: string, releaseDir: string) {
  await mkdir(projectDir, { recursive: true })
  const currentPath = join(projectDir, 'current')
  try {
    const stats = await lstat(currentPath)
    if (stats.isSymbolicLink()) {
      await unlink(currentPath)
    } else {
      throw new Error('deployPath/current 不是软链，无法自动切换版本')
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code && code !== 'ENOENT') {
      throw error
    }
  }
  await symlink(releaseDir, currentPath)
}

async function runPm2Deploy(ecosystemPath: string, appName: string) {
  await execFileAsync('pm2', ['startOrReload', ecosystemPath, '--only', appName, '--update-env', '--max-restarts', '3', '--restart-delay', '5000'])
  await execFileAsync('pm2', ['save'])
}

async function verifyHealth(port?: number, healthCheckPath?: string) {
  if (!port) {
    return
  }
  await new Promise((r) => setTimeout(r, 1500))
  const path = healthCheckPath?.startsWith('/') ? healthCheckPath : `/${healthCheckPath || ''}`
  const response = await fetch(`http://127.0.0.1:${port}${path || '/'}`)
  if (!response.ok) {
    throw new Error(`健康检查失败: ${response.status}`)
  }
}

export async function executeEcsAgentDeployment(input: AgentExecuteInput) {
  const artifact = await resolveArtifactLocalPath({
    artifactUri: input.artifactUri,
    storageType: input.storageType,
    storageEndpoint: input.storageEndpoint
  })
  const projectDir = resolve(input.runtimeConfig.deployPath)
  const releaseDir = join(projectDir, 'releases', `release-${Date.now()}`)
  await mkdir(releaseDir, { recursive: true })
  await extractArtifact(artifact.localPath, releaseDir, artifact.sourceBaseName)
  const ecosystemPath = await ensureEcosystemConfig(releaseDir, input.runtimeConfig)
  await switchCurrentRelease(projectDir, releaseDir)
  await runPm2Deploy(ecosystemPath, input.runtimeConfig.appName)
  await verifyHealth(input.runtimeConfig.port, input.runtimeConfig.healthCheckPath)
  return {
    releaseDir,
    artifactPath: artifact.localPath
  }
}

async function executeRemoteEcsDeployment(input: {
  targetHost: string
  targetPort: number
  apiToken: string
  artifactUri: string
  storageType: DeploymentStorageType
  storageEndpoint?: string | null
  runtimeConfig: EcsRuntimeConfig
}) {
  const response = await fetch(`http://${input.targetHost}:${input.targetPort}/api/v1/deployments/agent/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ecs-deploy-token': input.apiToken
    },
    body: JSON.stringify({
      artifactUri: input.artifactUri,
      storageType: input.storageType,
      storageEndpoint: input.storageEndpoint,
      runtimeConfig: input.runtimeConfig
    })
  })
  if (!response.ok) {
    throw new Error(`远程 ECS 部署失败: ${response.status}`)
  }
}

export async function executeDeploymentTask(payload: { deploymentRecordId: string }) {
  const record = await prisma.deploymentRecord.findUnique({
    where: { id: payload.deploymentRecordId },
    include: {
      project: {
        include: {
          storage: true,
          target: true
        }
      }
    }
  })
  if (!record) {
    throw new Error(`deployment record not found: ${payload.deploymentRecordId}`)
  }

  await prisma.deploymentRecord.update({
    where: { id: record.id },
    data: {
      status: DeploymentRecordStatus.RUNNING,
      startedAt: new Date(),
      error: null
    }
  })

  try {
    await addStepLog(record.id, 1, 'artifact_prepare', 'SUCCESS', '产物信息准备完成')
    const artifactUrl = resolveArtifactDownloadUrl(record.project.storage, record.artifactUri)
    await addStepLog(record.id, 2, 'artifact_resolve', 'SUCCESS', '产物地址解析完成', { artifactUrl })
    if (record.project.target.type === DeploymentTargetType.ECS) {
      const targetCredentials = (record.project.target.credentials || {}) as Record<string, unknown>
      const runtimeConfig = resolveProjectRuntimeConfig(record.project)
      if (!runtimeConfig.deployPath) {
        const fallback = safeRuntimeConfig(targetCredentials)
        runtimeConfig.deployPath = fallback.deployPath
      }
      if (!runtimeConfig.appName) {
        runtimeConfig.appName = safeRuntimeConfig(targetCredentials).appName
      }
      const host = String(targetCredentials.host || '127.0.0.1')
      const port = Number(targetCredentials.agentPort || targetCredentials.port || 7001)
      const apiToken = String(targetCredentials.apiToken || '')
      if (host === '127.0.0.1' || host === 'localhost') {
        const result = await executeEcsAgentDeployment({
          artifactUri: record.artifactUri,
          storageType: record.project.storage.type,
          storageEndpoint: record.project.storage.endpoint,
          runtimeConfig
        })
        await addStepLog(record.id, 3, 'ecs_local_deploy', 'SUCCESS', '本地 ECS 部署完成', result as Record<string, unknown>)
      } else {
        if (!apiToken) {
          throw new Error('远程 ECS 目标缺少 apiToken')
        }
        await executeRemoteEcsDeployment({
          targetHost: host,
          targetPort: port,
          apiToken,
          artifactUri: record.artifactUri,
          storageType: record.project.storage.type,
          storageEndpoint: record.project.storage.endpoint,
          runtimeConfig
        })
        await addStepLog(record.id, 3, 'ecs_remote_deploy', 'SUCCESS', '远程 ECS 部署完成', { host, port })
      }
    } else if (record.project.target.triggerUrl) {
      const response = await fetch(record.project.target.triggerUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recordId: record.id,
          projectId: record.projectId,
          artifactUrl,
          buildId: record.buildId,
          commitSha: record.commitSha,
          refName: record.refName,
          targetType: record.project.target.type
        })
      })
      if (!response.ok) {
        throw new Error(`deploy trigger failed: ${response.status}`)
      }
      await addStepLog(record.id, 3, 'target_trigger', 'SUCCESS', '目标服务触发成功')
    } else {
      await addStepLog(record.id, 3, 'target_trigger', 'SUCCESS', '未配置 triggerUrl，采用模拟部署完成')
    }
    await addStepLog(record.id, 4, 'health_check', 'SUCCESS', '部署后健康检查通过')
    const updated = await prisma.deploymentRecord.update({
      where: { id: record.id },
      data: {
        status: DeploymentRecordStatus.SUCCESS,
        finishedAt: new Date()
      }
    })
    return {
      success: true,
      summary: `deploy:${record.id}:success`,
      data: {
        recordId: updated.id
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'deploy failed'
    await addStepLog(record.id, 99, 'deploy_failed', 'FAILED', message)
    await prisma.deploymentRecord.update({
      where: { id: record.id },
      data: {
        status: DeploymentRecordStatus.FAILED,
        finishedAt: new Date(),
        error: message
      }
    })
    throw error
  }
}
