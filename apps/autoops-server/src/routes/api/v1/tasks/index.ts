import { FastifyPluginAsync } from 'fastify'
import { TaskType } from '../../../../generated/prisma/client'
import { success } from '../../../../common/response'
import { apiResponseSchema, paginatedDataSchema } from '../../../../common/response-schema'
import { prisma } from '../../../../lib/prisma'
import {
  cancelTask,
  createTask,
  getQueueOverview,
  getTaskList,
  pauseTask,
  resumeTask,
  triggerTask
} from '../../../../tasks/service'

const tasksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addSchema({
    $id: 'TaskType',
    type: 'string',
    enum: ['NOTIFY', 'SMS', 'HTTPS_ISSUE', 'CERT_ISSUE', 'CERT_RENEW', 'HEALTH_CHECK', 'EMAIL_SEND', 'DEPLOY_EXECUTE']
  })
  fastify.addSchema({
    $id: 'TaskStatus',
    type: 'string',
    enum: ['READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED']
  })
  fastify.addSchema({
    $id: 'ScheduledTask',
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      type: { $ref: 'TaskType#' },
      payload: { type: 'object' },
      cronExpression: { type: 'string', nullable: true },
      runAt: { type: 'string', format: 'date-time', nullable: true },
      status: { $ref: 'TaskStatus#' },
      attempts: { type: 'number' },
      maxAttempts: { type: 'number' },
      backoffMs: { type: 'number' },
      lastRunAt: { type: 'string', format: 'date-time', nullable: true },
      nextRunAt: { type: 'string', format: 'date-time', nullable: true },
      lastError: { type: 'string', nullable: true },
      lastResult: { type: 'object', nullable: true },
      queueJobId: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['id', 'name', 'type', 'payload', 'status', 'attempts', 'maxAttempts', 'backoffMs', 'createdAt', 'updatedAt']
  })
  fastify.addSchema({
    $id: 'TaskExecution',
    type: 'object',
    properties: {
      id: { type: 'string' },
      taskId: { type: 'string' },
      status: { $ref: 'TaskStatus#' },
      attempt: { type: 'number' },
      startedAt: { type: 'string', format: 'date-time' },
      endedAt: { type: 'string', format: 'date-time', nullable: true },
      durationMs: { type: 'number', nullable: true },
      result: { type: 'object', nullable: true },
      error: { type: 'string', nullable: true },
      queueJobId: { type: 'string', nullable: true },
      workerName: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' }
    },
    required: ['id', 'taskId', 'status', 'attempt', 'startedAt', 'createdAt']
  })
  fastify.addSchema({
    $id: 'QueueOverview',
    type: 'object',
    properties: {
      active: { type: 'number' },
      completed: { type: 'number' },
      delayed: { type: 'number' },
      failed: { type: 'number' },
      paused: { type: 'number' },
      waiting: { type: 'number' }
    },
    required: ['active', 'completed', 'delayed', 'failed', 'paused', 'waiting']
  })

  // GET /api/v1/tasks - 获取任务列表
  fastify.get<{ Querystring: { page?: number; pageSize?: number } }>('/', {
    schema: {
      operationId: 'listTasks',
      tags: ['Tasks'],
      summary: '获取任务列表',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1 },
          pageSize: { type: 'number', minimum: 1, maximum: 100 }
        }
      },
      response: {
        200: apiResponseSchema(paginatedDataSchema({ $ref: 'ScheduledTask#' }))
      }
    }
  }, async (request) => {
    const tasks = await getTaskList({
      page: request.query.page,
      pageSize: request.query.pageSize
    })
    return success(tasks)
  })

  // POST /api/v1/tasks - 创建任务
  fastify.post<{
    Body: {
      name: string
      type: TaskType
      payload: Record<string, unknown>
      cronExpression?: string
      runAt?: string
      maxAttempts?: number
      backoffMs?: number
    }
  }>('/', {
    schema: {
      operationId: 'createTask',
      tags: ['Tasks'],
      summary: '创建任务',
      body: {
        type: 'object',
        required: ['name', 'type', 'payload'],
        properties: {
          name: { type: 'string', minLength: 1 },
          type: { $ref: 'TaskType#' },
          payload: { type: 'object' },
          cronExpression: { type: 'string' },
          runAt: { type: 'string' },
          maxAttempts: { type: 'number', minimum: 1, maximum: 20 },
          backoffMs: { type: 'number', minimum: 100, maximum: 600000 }
        }
      },
      response: {
        200: apiResponseSchema({ $ref: 'ScheduledTask#' })
      }
    }
  }, async (request) => {
    const task = await createTask(request.body)
    return success(task, '创建成功')
  })

  // POST /api/v1/tasks/:id/trigger - 立即触发任务
  fastify.post<{ Params: { id: string } }>('/:id/trigger', {
    schema: {
      operationId: 'triggerTask',
      tags: ['Tasks'],
      summary: '立即触发任务',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      response: {
        200: apiResponseSchema({
          type: 'object',
          properties: { jobId: { type: 'string' } }
        })
      }
    }
  }, async (request) => {
    const result = await triggerTask(request.params.id)
    return success(result, '触发成功')
  })

  // POST /api/v1/tasks/:id/pause - 暂停任务
  fastify.post<{ Params: { id: string } }>('/:id/pause', {
    schema: {
      operationId: 'pauseTask',
      tags: ['Tasks'],
      summary: '暂停任务',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      response: {
        200: apiResponseSchema({ $ref: 'ScheduledTask#' })
      }
    }
  }, async (request) => {
    const task = await pauseTask(request.params.id)
    return success(task, '暂停成功')
  })

  // POST /api/v1/tasks/:id/resume - 恢复任务
  fastify.post<{ Params: { id: string } }>('/:id/resume', {
    schema: {
      operationId: 'resumeTask',
      tags: ['Tasks'],
      summary: '恢复任务',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      response: {
        200: apiResponseSchema({ $ref: 'ScheduledTask#' })
      }
    }
  }, async (request) => {
    const task = await resumeTask(request.params.id)
    return success(task, '恢复成功')
  })

  // POST /api/v1/tasks/:id/cancel - 取消任务
  fastify.post<{ Params: { id: string } }>('/:id/cancel', {
    schema: {
      operationId: 'cancelTask',
      tags: ['Tasks'],
      summary: '取消任务',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      response: {
        200: apiResponseSchema({ $ref: 'ScheduledTask#' })
      }
    }
  }, async (request) => {
    const task = await cancelTask(request.params.id)
    return success(task, '取消成功')
  })

  // GET /api/v1/tasks/:id/executions - 获取任务执行记录
  fastify.get<{ Params: { id: string }; Querystring: { page?: number; pageSize?: number } }>('/:id/executions', {
    schema: {
      operationId: 'listTaskExecutions',
      tags: ['Tasks'],
      summary: '获取任务执行记录',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1 },
          pageSize: { type: 'number', minimum: 1, maximum: 100 }
        }
      },
      response: {
        200: apiResponseSchema(paginatedDataSchema({ $ref: 'TaskExecution#' }))
      }
    }
  }, async (request) => {
    const page = Math.max(request.query.page ?? 1, 1)
    const pageSize = Math.min(Math.max(request.query.pageSize ?? 20, 1), 100)
    const skip = (page - 1) * pageSize
    const [items, total] = await prisma.$transaction([
      prisma.taskExecution.findMany({
        where: { taskId: request.params.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.taskExecution.count({
        where: { taskId: request.params.id }
      })
    ])
    return success({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1)
    })
  })

  // GET /api/v1/tasks/queue/overview - 获取队列概览
  fastify.get('/queue/overview', {
    schema: {
      operationId: 'getQueueOverview',
      tags: ['Tasks'],
      summary: '获取队列概览',
      response: {
        200: apiResponseSchema({ $ref: 'QueueOverview#' })
      }
    }
  }, async () => {
    const overview = await getQueueOverview()
    return success(overview)
  })
}

export default tasksRoutes
