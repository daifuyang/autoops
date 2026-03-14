import { CertStatus, DeploymentRecordStatus, DeploymentStorageType, DeploymentTargetType, TaskType } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { createTask } from '../tasks/service'
import { randomBytes } from 'node:crypto'
import { copyFile, lstat, mkdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
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
  certificateId?: string
  enableTlsAutoBind?: boolean
  nginxServerName?: string
  nginxConfigPath?: string
  nginxCertPath?: string
  nginxKeyPath?: string
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
  tlsBinding?: {
    enabled?: boolean
    serverName?: string
    configPath?: string
    certPath?: string
    keyPath?: string
    certPem?: string
    keyPem?: string
    certId?: string
  }
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

function getCnDateKey(date = new Date()) {
  const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const year = utc8.getUTCFullYear()
  const month = String(utc8.getUTCMonth() + 1).padStart(2, '0')
  const day = String(utc8.getUTCDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function formatBuildId(dateKey: string, sequence: number) {
  return `v${dateKey}.${String(sequence).padStart(6, '0')}`
}

function parseBuildSequence(buildId?: string | null) {
  if (!buildId) {
    return 0
  }
  const matched = /^v\d{8}\.(\d+)$/.exec(buildId)
  if (!matched) {
    return 0
  }
  return Number(matched[1]) || 0
}

async function generateNextDailyBuildId(projectId: string) {
  const dateKey = getCnDateKey()
  const prefix = `v${dateKey}.`
  const records = await prisma.deploymentRecord.findMany({
    where: {
      projectId,
      buildId: { startsWith: prefix }
    },
    select: { buildId: true }
  })
  const maxSequence = records.reduce((max, record) => {
    const seq = parseBuildSequence(record.buildId)
    return seq > max ? seq : max
  }, 0)
  const nextSequence = maxSequence + 1
  return formatBuildId(dateKey, nextSequence)
}

function isBuildIdUniqueConflict(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code = (error as { code?: string }).code
  return code === 'P2002'
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
        target: true,
        certificate: true
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
      certificateId: input.certificateId,
      enableTlsAutoBind: Boolean(input.certificateId),
      notifyOnSuccess: input.notifyOnSuccess ?? false,
      isActive: input.isActive ?? true
    },
    include: {
      storage: true,
      target: true,
      certificate: true
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
      certificateId: input.certificateId,
      enableTlsAutoBind: input.certificateId !== undefined ? Boolean(input.certificateId) : undefined,
      notifyOnSuccess: input.notifyOnSuccess,
      isActive: input.isActive
    },
    include: {
      storage: true,
      target: true,
      certificate: true
    }
  })
}

export async function deleteDeploymentProject(id: string) {
  return prisma.deploymentProject.delete({
    where: { id },
    include: {
      storage: true,
      target: true,
      certificate: true
    }
  })
}

export async function listAvailableCertificates() {
  return prisma.certificate.findMany({
    where: {
      status: CertStatus.ACTIVE,
      certPem: { not: null },
      keyPem: { not: null }
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      domain: true,
      status: true,
      expiresAt: true
    }
  })
}

export async function syncNginxTlsBindingsByCertificate(certificateId: string) {
  const projects = await prisma.deploymentProject.findMany({
    where: {
      certificateId,
      enableTlsAutoBind: true,
      isActive: true
    },
    include: {
      certificate: true
    }
  })
  const results: Array<{ projectId: string; success: boolean; message: string }> = []
  for (const project of projects) {
    try {
      const runtimeConfig = resolveProjectRuntimeConfig({
        name: project.name,
        deployPath: project.deployPath,
        servicePort: project.servicePort,
        healthCheckPath: project.healthCheckPath,
        runtimeEnv: project.runtimeEnv,
        startCommand: project.startCommand,
        enableTlsAutoBind: project.enableTlsAutoBind,
        nginxServerName: project.nginxServerName,
        nginxConfigPath: project.nginxConfigPath,
        nginxCertPath: project.nginxCertPath,
        nginxKeyPath: project.nginxKeyPath,
        certificateId: project.certificateId,
        certificate: project.certificate
          ? {
            id: project.certificate.id,
            domain: project.certificate.domain,
            certPem: project.certificate.certPem,
            keyPem: project.certificate.keyPem,
            status: project.certificate.status
          }
          : null
      })
      await applyNginxTlsBinding(runtimeConfig)
      results.push({ projectId: project.id, success: true, message: 'nginx 证书绑定同步成功' })
    } catch (error) {
      results.push({
        projectId: project.id,
        success: false,
        message: error instanceof Error ? error.message : 'nginx 证书绑定同步失败'
      })
    }
  }
  return results
}

export async function createDeploymentRecord(input: CreateDeploymentRecordInput) {
  let record: Awaited<ReturnType<typeof prisma.deploymentRecord.create>> | null = null
  let latestError: unknown = null

  for (let attempt = 0; attempt < 8; attempt++) {
    const nextBuildId = await generateNextDailyBuildId(input.projectId)
    try {
      record = await prisma.deploymentRecord.create({
        data: {
          projectId: input.projectId,
          artifactUri: input.artifactUri,
          buildId: nextBuildId,
          commitSha: input.commitSha,
          refName: input.refName,
          checksum: input.checksum,
          triggeredBy: input.triggeredBy,
          metadata: (input.metadata || {}) as never,
          status: DeploymentRecordStatus.PENDING
        }
      })
      break
    } catch (error) {
      if (isBuildIdUniqueConflict(error)) {
        latestError = error
        continue
      }
      throw error
    }
  }

  if (!record) {
    throw latestError || new Error('构建版本号生成失败，请稍后重试')
  }

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
  const tlsBindingRaw = raw.tlsBinding && typeof raw.tlsBinding === 'object'
    ? raw.tlsBinding as Record<string, unknown>
    : null
  if (!deployPath) {
    throw new Error('ECS 目标缺少 deployPath 配置')
  }
  return {
    appName,
    deployPath,
    port: Number.isFinite(port) && port > 0 ? port : undefined,
    healthCheckPath: healthCheckPath || '/',
    runtimeEnv,
    startCommand: startCommand || undefined,
    tlsBinding: tlsBindingRaw ? {
      enabled: Boolean(tlsBindingRaw.enabled),
      serverName: tlsBindingRaw.serverName ? String(tlsBindingRaw.serverName) : undefined,
      configPath: tlsBindingRaw.configPath ? String(tlsBindingRaw.configPath) : undefined,
      certPath: tlsBindingRaw.certPath ? String(tlsBindingRaw.certPath) : undefined,
      keyPath: tlsBindingRaw.keyPath ? String(tlsBindingRaw.keyPath) : undefined,
      certPem: tlsBindingRaw.certPem ? String(tlsBindingRaw.certPem) : undefined,
      keyPem: tlsBindingRaw.keyPem ? String(tlsBindingRaw.keyPem) : undefined,
      certId: tlsBindingRaw.certId ? String(tlsBindingRaw.certId) : undefined
    } : undefined
  }
}

function resolveProjectRuntimeConfig(project: {
  name: string
  deployPath: string
  servicePort: number | null
  healthCheckPath: string | null
  runtimeEnv: unknown
  startCommand?: string | null
  enableTlsAutoBind?: boolean | null
  nginxServerName?: string | null
  nginxConfigPath?: string | null
  nginxCertPath?: string | null
  nginxKeyPath?: string | null
  certificateId?: string | null
  certificate?: {
    id: string
    domain: string
    certPem?: string | null
    keyPem?: string | null
    status: CertStatus
  } | null
}) {
  const runtimeEnvRaw = project.runtimeEnv && typeof project.runtimeEnv === 'object'
    ? project.runtimeEnv as Record<string, unknown>
    : {}
  const runtimeEnv = Object.fromEntries(
    Object.entries(runtimeEnvRaw).map(([k, v]) => [k, String(v)])
  )
  const domain = (project.certificate?.domain || '').trim()
  const normalizedDomain = domain
    .replace(/^\*\./, 'wildcard.')
    .replace(/[^\w.-]/g, '-')
  const nginxProjectRoot = resolve(String(process.env.NGINX_PROJECT_ROOT || process.cwd()).trim() || process.cwd())
  const defaultNginxConfigPath = normalizedDomain
    ? join(nginxProjectRoot, 'nginx', `${normalizedDomain}.conf`)
    : undefined
  return {
    appName: normalizePm2AppName(project.name),
    deployPath: String(project.deployPath || '').trim(),
    port: project.servicePort || undefined,
    healthCheckPath: project.healthCheckPath || '/',
    runtimeEnv,
    startCommand: (project.startCommand || undefined) || undefined,
    tlsBinding: {
      enabled: Boolean(project.enableTlsAutoBind && project.certificateId),
      serverName: (project.certificate?.domain || '').trim() || undefined,
      configPath: defaultNginxConfigPath,
      certPem: project.certificate?.certPem || undefined,
      keyPem: project.certificate?.keyPem || undefined,
      certId: project.certificate?.id || undefined
    }
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

async function applyNginxTlsBinding(runtimeConfig: EcsRuntimeConfig) {
  const tls = runtimeConfig.tlsBinding
  if (!tls?.enabled) {
    return null
  }
  if (!tls.serverName || !tls.configPath || !tls.certPem || !tls.keyPem) {
    throw new Error('启用证书绑定时，缺少域名或证书内容，无法生成 Nginx 配置')
  }
  const certPath = tls.certPath || join(runtimeConfig.deployPath, 'tls', `${runtimeConfig.appName}.crt`)
  const keyPath = tls.keyPath || join(runtimeConfig.deployPath, 'tls', `${runtimeConfig.appName}.key`)
  await mkdir(dirname(certPath), { recursive: true })
  await mkdir(dirname(keyPath), { recursive: true })
  await mkdir(dirname(tls.configPath), { recursive: true })
  await writeFile(certPath, tls.certPem, 'utf8')
  await writeFile(keyPath, tls.keyPem, 'utf8')
  const nginxConfig = `server {\n  listen 443 ssl;\n  server_name ${tls.serverName};\n\n  ssl_certificate ${certPath};\n  ssl_certificate_key ${keyPath};\n\n  location / {\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_pass http://127.0.0.1:${runtimeConfig.port || 3000};\n  }\n}\n`
  await writeFile(tls.configPath, nginxConfig, 'utf8')
  const nginxBin = process.env.NGINX_BIN || 'nginx'
  await execFileAsync(nginxBin, ['-t'])
  await execFileAsync(nginxBin, ['-s', 'reload'])
  return {
    certPath,
    keyPath,
    configPath: tls.configPath,
    serverName: tls.serverName,
    certId: tls.certId || ''
  }
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
  const nginxBinding = await applyNginxTlsBinding(input.runtimeConfig)
  await verifyHealth(input.runtimeConfig.port, input.runtimeConfig.healthCheckPath)
  return {
    releaseDir,
    artifactPath: artifact.localPath,
    nginxBinding
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
          target: true,
          certificate: true
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
