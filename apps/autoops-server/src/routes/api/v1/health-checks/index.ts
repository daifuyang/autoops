import { FastifyInstance } from 'fastify'
import { prisma } from '../../../../lib/prisma'
import { success, errors } from '../../../../common/response'
import { apiResponseSchema, paginatedDataSchema } from '../../../../common/response-schema'
import { clearHealthCheckTasks, executeHealthCheck, rescheduleHealthCheckTask } from '../../../../health-checks/service'

const healthCheckSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    url: { type: 'string' },
    method: { type: 'string' },
    headers: { type: 'object', nullable: true, additionalProperties: { type: 'string' } },
    body: { type: 'string', nullable: true },
    interval: { type: 'number' },
    timeout: { type: 'number' },
    retry: { type: 'number' },
    expectStatus: { type: 'number' },
    expectBody: { type: 'string', nullable: true },
    notifyEmail: { type: 'string', nullable: true },
    isActive: { type: 'boolean' },
    lastCheckAt: { type: 'string', format: 'date-time', nullable: true },
    lastStatus: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    latestLog: {
      type: 'object',
      nullable: true,
      properties: {
        status: { type: 'string' },
        responseTime: { type: 'number', nullable: true },
        statusCode: { type: 'number', nullable: true },
        error: { type: 'string', nullable: true },
        createdAt: { type: 'string', format: 'date-time' }
      }
    }
  }
}

const healthCheckLogSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    healthCheckId: { type: 'string' },
    status: { type: 'string' },
    responseTime: { type: 'number', nullable: true },
    statusCode: { type: 'number', nullable: true },
    error: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' }
  }
}

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' }
  },
  required: ['id']
}

export default async function (fastify: FastifyInstance) {
  fastify.get<{ Querystring: { page?: number; pageSize?: number } }>('/', {
    schema: {
      operationId: 'listHealthChecks',
      tags: ['HealthChecks'],
      summary: '获取健康检查列表',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1 },
          pageSize: { type: 'number', minimum: 1, maximum: 100 }
        }
      },
      response: {
        200: apiResponseSchema(paginatedDataSchema(healthCheckSchema))
      }
    }
  }, async (request) => {
    const page = Math.max(request.query.page ?? 1, 1)
    const pageSize = Math.min(Math.max(request.query.pageSize ?? 20, 1), 100)
    const skip = (page - 1) * pageSize
    const [checks, total] = await prisma.$transaction([
      prisma.healthCheck.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          logs: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      }),
      prisma.healthCheck.count()
    ])
    return success({
      items: checks.map((item) => ({
        ...item,
        latestLog: item.logs[0] || null,
        logs: undefined
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1)
    })
  })

  fastify.post('/', {
    schema: {
      operationId: 'createHealthCheck',
      tags: ['HealthChecks'],
      summary: '创建健康检查',
      body: {
        type: 'object',
        required: ['name', 'url'],
        properties: {
          name: { type: 'string', minLength: 1 },
          url: { type: 'string', minLength: 1 },
          method: { type: 'string' },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          body: { type: 'string' },
          interval: { type: 'number' },
          timeout: { type: 'number' },
          retry: { type: 'number' },
          expectStatus: { type: 'number' },
          expectBody: { type: 'string' },
          notifyEmail: { type: 'string' },
          isActive: { type: 'boolean' }
        }
      },
      response: {
        200: apiResponseSchema(healthCheckSchema)
      }
    }
  }, async (request) => {
    const body = request.body as {
      name: string
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
      interval?: number
      timeout?: number
      retry?: number
      expectStatus?: number
      expectBody?: string
      notifyEmail?: string
      isActive?: boolean
    }
    const created = await prisma.healthCheck.create({
      data: {
        name: body.name,
        url: body.url,
        method: body.method || 'GET',
        headers: body.headers as any,
        body: body.body,
        interval: body.interval ?? 60,
        timeout: body.timeout ?? 10,
        retry: body.retry ?? 3,
        expectStatus: body.expectStatus ?? 200,
        expectBody: body.expectBody,
        notifyEmail: body.notifyEmail,
        isActive: body.isActive ?? true
      }
    })
    await rescheduleHealthCheckTask(created.id)
    return success({ ...created, latestLog: null })
  })

  fastify.get('/:id', {
    schema: {
      operationId: 'getHealthCheck',
      tags: ['HealthChecks'],
      summary: '获取健康检查详情',
      params: idParamSchema,
      response: {
        200: apiResponseSchema(healthCheckSchema)
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const check = await prisma.healthCheck.findUnique({
      where: { id },
      include: {
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    })
    if (!check) {
      return (reply as any).status(404).send(errors.notFound('健康检查不存在'))
    }
    return success({
      ...check,
      latestLog: check.logs[0] || null,
      logs: undefined
    })
  })

  fastify.put('/:id', {
    schema: {
      operationId: 'updateHealthCheck',
      tags: ['HealthChecks'],
      summary: '更新健康检查',
      params: idParamSchema,
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          url: { type: 'string', minLength: 1 },
          method: { type: 'string' },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          body: { type: 'string' },
          interval: { type: 'number' },
          timeout: { type: 'number' },
          retry: { type: 'number' },
          expectStatus: { type: 'number' },
          expectBody: { type: 'string' },
          notifyEmail: { type: 'string' },
          isActive: { type: 'boolean' }
        }
      },
      response: {
        200: apiResponseSchema(healthCheckSchema)
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    const exists = await prisma.healthCheck.findUnique({ where: { id } })
    if (!exists) {
      return (reply as any).status(404).send(errors.notFound('健康检查不存在'))
    }
    const updated = await prisma.healthCheck.update({
      where: { id },
      data: body as any
    })
    await rescheduleHealthCheckTask(updated.id)
    return success({ ...updated, latestLog: null })
  })

  fastify.delete('/:id', {
    schema: {
      operationId: 'deleteHealthCheck',
      tags: ['HealthChecks'],
      summary: '删除健康检查',
      params: idParamSchema,
      response: {
        200: apiResponseSchema({
          type: 'object',
          nullable: true
        })
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const exists = await prisma.healthCheck.findUnique({ where: { id } })
    if (!exists) {
      return (reply as any).status(404).send(errors.notFound('健康检查不存在'))
    }
    await clearHealthCheckTasks(id)
    await prisma.healthCheck.delete({ where: { id } })
    return success(null, '删除成功')
  })

  fastify.post('/:id/run', {
    schema: {
      operationId: 'runHealthCheck',
      tags: ['HealthChecks'],
      summary: '立即执行健康检查',
      params: idParamSchema,
      response: {
        200: apiResponseSchema(healthCheckLogSchema)
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const log = await executeHealthCheck(id)
    if (!log) {
      return (reply as any).status(404).send(errors.notFound('健康检查不存在'))
    }
    return success(log)
  })

  fastify.get<{ Params: { id: string }; Querystring: { page?: number; pageSize?: number } }>('/:id/logs', {
    schema: {
      operationId: 'listHealthCheckLogs',
      tags: ['HealthChecks'],
      summary: '获取健康检查日志',
      params: idParamSchema,
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1 },
          pageSize: { type: 'number', minimum: 1, maximum: 100 }
        }
      },
      response: {
        200: apiResponseSchema(paginatedDataSchema(healthCheckLogSchema))
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const exists = await prisma.healthCheck.findUnique({ where: { id } })
    if (!exists) {
      return (reply as any).status(404).send(errors.notFound('健康检查不存在'))
    }
    const page = Math.max(request.query.page ?? 1, 1)
    const pageSize = Math.min(Math.max(request.query.pageSize ?? 20, 1), 100)
    const skip = (page - 1) * pageSize
    const [items, total] = await prisma.$transaction([
      prisma.healthCheckLog.findMany({
        where: { healthCheckId: id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.healthCheckLog.count({
        where: { healthCheckId: id }
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
}
