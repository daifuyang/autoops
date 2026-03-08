import { FastifyPluginAsync } from 'fastify'
import { DeploymentRecordStatus, DeploymentStorageType, DeploymentTargetType } from '../../../../generated/prisma/client'
import { errors, success } from '../../../../common/response'
import { apiResponseSchema, paginatedDataSchema } from '../../../../common/response-schema'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  buildProjectWebhookPaths,
  createArtifactStorage,
  createDeploymentProject,
  createDeploymentRecord,
  createDeployTarget,
  executeEcsAgentDeployment,
  getDeploymentRecord,
  listArtifactStorages,
  listDeploymentProjects,
  listDeploymentRecords,
  listDeployTargets,
  regenerateDeploymentProjectToken,
  retryDeploymentRecord,
  rollbackDeploymentRecord,
  triggerDeploymentByToken,
  triggerDeploymentByProjectToken,
  updateDeploymentProject
} from '../../../../deployments/service'

const storageSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    bucket: { type: 'string', nullable: true },
    basePath: { type: 'string', nullable: true },
    endpoint: { type: 'string', nullable: true },
    credentials: { type: 'object', nullable: true },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}

const targetSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    region: { type: 'string', nullable: true },
    serviceName: { type: 'string', nullable: true },
    functionName: { type: 'string', nullable: true },
    triggerUrl: { type: 'string', nullable: true },
    credentials: { type: 'object', nullable: true },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}

const targetCreateSchema = {
  ...targetSchema,
  properties: {
    ...(targetSchema.properties || {}),
    generatedApiToken: { type: 'string', nullable: true }
  }
}

const projectSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    storageId: { type: 'string' },
    targetId: { type: 'string' },
    artifactPath: { type: 'string', nullable: true },
    deployPath: { type: 'string' },
    startCommand: { type: 'string' },
    servicePort: { type: 'number', nullable: true },
    healthCheckPath: { type: 'string', nullable: true },
    runtimeEnv: { type: 'object', nullable: true },
    apiToken: { type: 'string' },
    deployMethod: { type: 'string' },
    deployWebhookPath: { type: 'string' },
    uploadWebhookPath: { type: 'string' },
    notifyOnSuccess: { type: 'boolean' },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    storage: storageSchema,
    target: targetSchema
  }
}

const stepLogSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    recordId: { type: 'string' },
    stepOrder: { type: 'number' },
    stepName: { type: 'string' },
    status: { type: 'string' },
    message: { type: 'string', nullable: true },
    details: { type: 'object', nullable: true },
    createdAt: { type: 'string', format: 'date-time' }
  }
}

const recordSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    projectId: { type: 'string' },
    buildId: { type: 'string', nullable: true },
    commitSha: { type: 'string', nullable: true },
    refName: { type: 'string', nullable: true },
    artifactUri: { type: 'string' },
    checksum: { type: 'string', nullable: true },
    status: { type: 'string' },
    triggeredBy: { type: 'string', nullable: true },
    taskId: { type: 'string', nullable: true },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    finishedAt: { type: 'string', format: 'date-time', nullable: true },
    error: { type: 'string', nullable: true },
    metadata: { type: 'object', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    project: projectSchema
  }
}

const withProjectWebhook = <T extends { apiToken: string }>(project: T) => ({
  ...project,
  deployMethod: 'PM2',
  ...buildProjectWebhookPaths(project.apiToken)
})

const routes: FastifyPluginAsync = async (fastify) => {
  const paginationQuery = {
    type: 'object',
    properties: {
      page: { type: 'number', minimum: 1 },
      pageSize: { type: 'number', minimum: 1, maximum: 100 }
    }
  }

  fastify.get<{ Querystring: { page?: number; pageSize?: number } }>('/storages', {
    schema: {
      operationId: 'listArtifactStorages',
      tags: ['Deployments'],
      summary: '获取产物存储列表',
      querystring: paginationQuery,
      response: {
        200: apiResponseSchema(paginatedDataSchema(storageSchema))
      }
    }
  }, async (request) => {
    const data = await listArtifactStorages(request.query)
    return success(data)
  })

  fastify.post<{
    Body: {
      name: string
      type: DeploymentStorageType
      bucket?: string
      basePath?: string
      endpoint?: string
      credentials?: Record<string, unknown>
      isActive?: boolean
    }
  }>('/storages', {
    schema: {
      operationId: 'createArtifactStorage',
      tags: ['Deployments'],
      summary: '创建产物存储',
      body: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: Object.values(DeploymentStorageType) },
          bucket: { type: 'string' },
          basePath: { type: 'string' },
          endpoint: { type: 'string' },
          credentials: { type: 'object' },
          isActive: { type: 'boolean' }
        }
      },
      response: {
        200: apiResponseSchema(storageSchema)
      }
    }
  }, async (request) => {
    const data = await createArtifactStorage(request.body)
    return success(data)
  })

  fastify.get<{ Querystring: { page?: number; pageSize?: number } }>('/targets', {
    schema: {
      operationId: 'listDeployTargets',
      tags: ['Deployments'],
      summary: '获取部署目标列表',
      querystring: paginationQuery,
      response: {
        200: apiResponseSchema(paginatedDataSchema(targetSchema))
      }
    }
  }, async (request) => {
    const data = await listDeployTargets(request.query)
    return success(data)
  })

  fastify.post<{
    Body: {
      name: string
      type: DeploymentTargetType
      host?: string
      port?: number
      deployPath?: string
      startCommand?: string
      servicePort?: number
      healthCheckPath?: string
      runtimeEnv?: Record<string, string>
      region?: string
      serviceName?: string
      functionName?: string
      triggerUrl?: string
      credentials?: Record<string, unknown>
      isActive?: boolean
    }
  }>('/targets', {
    schema: {
      operationId: 'createDeployTarget',
      tags: ['Deployments'],
      summary: '创建部署目标',
      body: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: Object.values(DeploymentTargetType) },
          host: { type: 'string' },
          port: { type: 'number' },
          deployPath: { type: 'string' },
          startCommand: { type: 'string' },
          servicePort: { type: 'number' },
          healthCheckPath: { type: 'string' },
          runtimeEnv: { type: 'object', additionalProperties: { type: 'string' } },
          region: { type: 'string' },
          serviceName: { type: 'string' },
          functionName: { type: 'string' },
          triggerUrl: { type: 'string' },
          credentials: { type: 'object' },
          isActive: { type: 'boolean' }
        }
      },
      response: {
        200: apiResponseSchema(targetCreateSchema)
      }
    }
  }, async (request) => {
    const data = await createDeployTarget({
      ...request.body,
      credentials: {
        ...(request.body.credentials || {}),
        host: request.body.host,
        agentPort: request.body.port,
        deployPath: request.body.deployPath,
        startCommand: request.body.startCommand,
        servicePort: request.body.servicePort,
        healthCheckPath: request.body.healthCheckPath,
        runtimeEnv: request.body.runtimeEnv
      }
    })
    return success(data)
  })

  fastify.get<{ Querystring: { page?: number; pageSize?: number } }>('/projects', {
    schema: {
      operationId: 'listDeploymentProjects',
      tags: ['Deployments'],
      summary: '获取部署项目列表',
      querystring: paginationQuery,
      response: {
        200: apiResponseSchema(paginatedDataSchema(projectSchema))
      }
    }
  }, async (request) => {
    const data = await listDeploymentProjects(request.query)
    return success({
      ...data,
      items: data.items.map((item) => withProjectWebhook(item as { apiToken: string }))
    })
  })

  fastify.post<{
    Body: {
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
  }>('/projects', {
    schema: {
      operationId: 'createDeploymentProject',
      tags: ['Deployments'],
      summary: '创建部署项目',
      body: {
        type: 'object',
        required: ['name', 'deployPath'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          storageId: { type: 'string' },
          targetId: { type: 'string' },
          artifactPath: { type: 'string' },
          deployPath: { type: 'string' },
          startCommand: { type: 'string' },
          servicePort: { type: 'number' },
          healthCheckPath: { type: 'string' },
          runtimeEnv: { type: 'object', additionalProperties: { type: 'string' } },
          notifyOnSuccess: { type: 'boolean' },
          isActive: { type: 'boolean' }
        }
      },
      response: {
        200: apiResponseSchema(projectSchema)
      }
    }
  }, async (request) => {
    const data = await createDeploymentProject(request.body)
    return success(withProjectWebhook(data as { apiToken: string }))
  })

  fastify.put<{
    Params: { id: string }
    Body: {
      name?: string
      description?: string
      storageId?: string
      targetId?: string
      artifactPath?: string
      deployPath?: string
      startCommand?: string
      servicePort?: number
      healthCheckPath?: string
      runtimeEnv?: Record<string, string>
      notifyOnSuccess?: boolean
      isActive?: boolean
    }
  }>('/projects/:id', {
    schema: {
      operationId: 'updateDeploymentProject',
      tags: ['Deployments'],
      summary: '更新部署项目',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          storageId: { type: 'string' },
          targetId: { type: 'string' },
          artifactPath: { type: 'string' },
          deployPath: { type: 'string' },
          startCommand: { type: 'string' },
          servicePort: { type: 'number' },
          healthCheckPath: { type: 'string' },
          runtimeEnv: { type: 'object', additionalProperties: { type: 'string' } },
          notifyOnSuccess: { type: 'boolean' },
          isActive: { type: 'boolean' }
        }
      },
      response: {
        200: apiResponseSchema(projectSchema)
      }
    }
  }, async (request, reply) => {
    try {
      const data = await updateDeploymentProject(request.params.id, request.body)
      return success(withProjectWebhook(data as { apiToken: string }))
    } catch {
      return (reply as any).status(404).send(errors.notFound('部署项目不存在'))
    }
  })

  fastify.post<{ Params: { id: string } }>('/projects/:id/token/regenerate', {
    schema: {
      operationId: 'regenerateDeploymentProjectToken',
      tags: ['Deployments'],
      summary: '重置部署项目 Token',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      response: {
        200: apiResponseSchema(projectSchema)
      }
    }
  }, async (request, reply) => {
    try {
      const data = await regenerateDeploymentProjectToken(request.params.id)
      return success(withProjectWebhook(data as { apiToken: string }), 'Token 已重置')
    } catch {
      return (reply as any).status(404).send(errors.notFound('部署项目不存在'))
    }
  })

  fastify.post<{
    Body: {
      projectId: string
      artifactUri: string
      buildId?: string
      commitSha?: string
      refName?: string
      checksum?: string
      triggeredBy?: string
      metadata?: Record<string, unknown>
    }
  }>('/records', {
    schema: {
      operationId: 'createDeploymentRecord',
      tags: ['Deployments'],
      summary: '创建部署记录并触发部署',
      body: {
        type: 'object',
        required: ['projectId', 'artifactUri'],
        properties: {
          projectId: { type: 'string' },
          artifactUri: { type: 'string' },
          buildId: { type: 'string' },
          commitSha: { type: 'string' },
          refName: { type: 'string' },
          checksum: { type: 'string' },
          triggeredBy: { type: 'string' },
          metadata: { type: 'object' }
        }
      },
      response: {
        200: apiResponseSchema(recordSchema)
      }
    }
  }, async (request) => {
    const data = await createDeploymentRecord(request.body)
    return success(data, '部署任务已创建')
  })

  fastify.post<{
    Body: {
      projectId: string
      artifactUri: string
      buildId?: string
      commitSha?: string
      refName?: string
      checksum?: string
      metadata?: Record<string, unknown>
    }
  }>('/trigger', {
    schema: {
      operationId: 'triggerDeploymentByCi',
      tags: ['Deployments'],
      summary: 'CI 触发部署',
      body: {
        type: 'object',
        required: ['projectId', 'artifactUri'],
        properties: {
          projectId: { type: 'string' },
          artifactUri: { type: 'string' },
          buildId: { type: 'string' },
          commitSha: { type: 'string' },
          refName: { type: 'string' },
          checksum: { type: 'string' },
          metadata: { type: 'object' }
        }
      },
      response: {
        200: apiResponseSchema(recordSchema)
      }
    }
  }, async (request) => {
    const token = String(request.headers['x-project-token'] || '')
    const data = await triggerDeploymentByProjectToken({
      ...request.body,
      apiToken: token
    })
    return success(data, 'CI 部署任务已创建')
  })

  fastify.post<{
    Params: { token: string }
    Body: {
      artifactUri: string
      buildId?: string
      commitSha?: string
      refName?: string
      checksum?: string
      metadata?: Record<string, unknown>
    }
  }>('/webhook/:token/deploy', {
    schema: {
      operationId: 'triggerDeploymentByToken',
      tags: ['Deployments'],
      summary: 'CD 通过 token 触发部署',
      params: {
        type: 'object',
        properties: { token: { type: 'string' } },
        required: ['token']
      },
      body: {
        type: 'object',
        required: ['artifactUri'],
        properties: {
          artifactUri: { type: 'string' },
          buildId: { type: 'string' },
          commitSha: { type: 'string' },
          refName: { type: 'string' },
          checksum: { type: 'string' },
          metadata: { type: 'object' }
        }
      },
      response: {
        200: apiResponseSchema(recordSchema)
      }
    }
  }, async (request) => {
    const data = await triggerDeploymentByToken({
      apiToken: request.params.token,
      artifactUri: request.body.artifactUri,
      buildId: request.body.buildId,
      commitSha: request.body.commitSha,
      refName: request.body.refName,
      checksum: request.body.checksum,
      metadata: request.body.metadata
    })
    return success(data, '部署任务已创建')
  })

  fastify.post<{ Params: { token: string } }>('/webhook/:token/upload', {
    schema: {
      operationId: 'uploadAndTriggerDeploymentByToken',
      tags: ['Deployments'],
      summary: 'CD 通过 token 上传产物并触发部署',
      consumes: ['multipart/form-data'],
      params: {
        type: 'object',
        properties: { token: { type: 'string' } },
        required: ['token']
      },
      response: {
        200: apiResponseSchema({
          type: 'object',
          properties: {
            record: recordSchema,
            artifactUri: { type: 'string' }
          }
        })
      }
    }
  }, async (request, reply) => {
    const file = await (request as any).file()
    if (!file) {
      return (reply as any).status(400).send(errors.badRequest('请上传文件字段 file'))
    }
    const uploadRoot = process.env.DEPLOY_UPLOAD_DIR || join(process.cwd(), 'runtime', 'deployments')
    await mkdir(uploadRoot, { recursive: true })
    const safeFileName = basename(file.filename || 'artifact.tar.gz').replace(/[^a-zA-Z0-9._-]/g, '_')
    const storedDirName = `${Date.now()}-${randomBytes(6).toString('hex')}`
    const storedDir = join(uploadRoot, storedDirName)
    await mkdir(storedDir, { recursive: true })
    const artifactUri = join(storedDir, safeFileName)
    await writeFile(artifactUri, await file.toBuffer())
    const record = await triggerDeploymentByToken({
      apiToken: request.params.token,
      artifactUri
    })
    return success({ record, artifactUri }, '上传成功，部署任务已创建')
  })

  fastify.post<{
    Body: {
      artifactUri: string
      storageType: DeploymentStorageType
      storageEndpoint?: string
      runtimeConfig: {
        appName: string
        deployPath: string
        port?: number
        runtimeEnv?: Record<string, string>
        healthCheckPath?: string
      }
    }
  }>('/agent/execute', {
    schema: {
      operationId: 'executeEcsAgentDeployment',
      tags: ['Deployments'],
      summary: 'ECS 节点执行部署任务',
      body: {
        type: 'object',
        required: ['artifactUri', 'storageType', 'runtimeConfig'],
        properties: {
          artifactUri: { type: 'string' },
          storageType: { type: 'string', enum: Object.values(DeploymentStorageType) },
          storageEndpoint: { type: 'string' },
          runtimeConfig: {
            type: 'object',
            required: ['appName', 'deployPath'],
            properties: {
              appName: { type: 'string' },
              deployPath: { type: 'string' },
              port: { type: 'number' },
              runtimeEnv: { type: 'object', additionalProperties: { type: 'string' } },
              healthCheckPath: { type: 'string' },
              startCommand: { type: 'string' }
            }
          }
        }
      },
      response: {
        200: apiResponseSchema({
          type: 'object',
          properties: {
            releaseDir: { type: 'string' },
            artifactPath: { type: 'string' }
          }
        })
      }
    }
  }, async (request) => {
    const token = String(request.headers['x-ecs-deploy-token'] || '')
    const expected = String(process.env.ECS_DEPLOY_AGENT_TOKEN || '')
    if (expected && token !== expected) {
      return {
        code: 1001,
        success: false,
        msg: '无效的 ECS agent token',
        data: null
      }
    }
    const result = await executeEcsAgentDeployment({
      artifactUri: request.body.artifactUri,
      storageType: request.body.storageType,
      storageEndpoint: request.body.storageEndpoint,
      runtimeConfig: request.body.runtimeConfig
    })
    return success(result)
  })

  fastify.get<{
    Querystring: {
      page?: number
      pageSize?: number
      projectId?: string
      status?: DeploymentRecordStatus
    }
  }>('/records', {
    schema: {
      operationId: 'listDeploymentRecords',
      tags: ['Deployments'],
      summary: '获取部署记录列表',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1 },
          pageSize: { type: 'number', minimum: 1, maximum: 100 },
          projectId: { type: 'string' },
          status: { type: 'string', enum: Object.values(DeploymentRecordStatus) }
        }
      },
      response: {
        200: apiResponseSchema(paginatedDataSchema(recordSchema))
      }
    }
  }, async (request) => {
    const data = await listDeploymentRecords(request.query)
    return success(data)
  })

  fastify.get<{ Params: { id: string } }>('/records/:id', {
    schema: {
      operationId: 'getDeploymentRecord',
      tags: ['Deployments'],
      summary: '获取部署记录详情',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      response: {
        200: apiResponseSchema({
          ...recordSchema,
          properties: {
            ...(recordSchema.properties || {}),
            stepLogs: {
              type: 'array',
              items: stepLogSchema
            }
          }
        })
      }
    }
  }, async (request, reply) => {
    const data = await getDeploymentRecord(request.params.id)
    if (!data) {
      return (reply as any).status(404).send(errors.notFound('部署记录不存在'))
    }
    return success(data)
  })

  fastify.post<{ Params: { id: string } }>('/records/:id/retry', {
    schema: {
      operationId: 'retryDeploymentRecord',
      tags: ['Deployments'],
      summary: '重试部署',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      response: {
        200: apiResponseSchema(recordSchema)
      }
    }
  }, async (request, reply) => {
    try {
      const data = await retryDeploymentRecord(request.params.id)
      return success(data, '已创建重试部署任务')
    } catch {
      return (reply as any).status(404).send(errors.notFound('部署记录不存在'))
    }
  })

  fastify.post<{ Params: { id: string } }>('/records/:id/rollback', {
    schema: {
      operationId: 'rollbackDeploymentRecord',
      tags: ['Deployments'],
      summary: '回滚部署记录',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      response: {
        200: apiResponseSchema(recordSchema)
      }
    }
  }, async (request, reply) => {
    try {
      const data = await rollbackDeploymentRecord(request.params.id)
      return success(data, '回滚标记完成')
    } catch {
      return (reply as any).status(404).send(errors.notFound('部署记录不存在'))
    }
  })
}

export default routes
