import { FastifyPluginAsync } from 'fastify'
import { prisma } from '../../../../lib/prisma'
import { apiResponseSchema, paginatedDataSchema } from '../../../../common/response-schema'
import { errors, success } from '../../../../common/response'
import { sanitizeEmailConfig, sendEmailWithConfig } from '../../../../email/service'

const emailConfigSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    host: { type: 'string' },
    port: { type: 'number' },
    secure: { type: 'boolean' },
    from: { type: 'string' },
    fromName: { type: 'string', nullable: true },
    isActive: { type: 'boolean' },
    authUser: { type: 'string' },
    hasPassword: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}

const idParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' }
  },
  required: ['id']
}

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { page?: number; pageSize?: number } }>('/', {
    schema: {
      operationId: 'listEmailConfigs',
      tags: ['EmailConfigs'],
      summary: '获取邮件配置列表',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1 },
          pageSize: { type: 'number', minimum: 1, maximum: 100 }
        }
      },
      response: {
        200: apiResponseSchema(paginatedDataSchema(emailConfigSchema))
      }
    }
  }, async (request) => {
    const page = Math.max(request.query.page ?? 1, 1)
    const pageSize = Math.min(Math.max(request.query.pageSize ?? 20, 1), 100)
    const skip = (page - 1) * pageSize
    const [rows, total] = await prisma.$transaction([
      prisma.emailConfig.findMany({
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.emailConfig.count()
    ])
    return success({
      items: rows.map((item) => sanitizeEmailConfig(item)),
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1)
    })
  })

  fastify.post('/', {
    schema: {
      operationId: 'createEmailConfig',
      tags: ['EmailConfigs'],
      summary: '创建邮件配置',
      body: {
        type: 'object',
        required: ['name', 'host', 'port', 'from', 'authUser', 'authPass'],
        properties: {
          name: { type: 'string', minLength: 1 },
          host: { type: 'string', minLength: 1 },
          port: { type: 'number' },
          secure: { type: 'boolean' },
          from: { type: 'string', minLength: 1 },
          fromName: { type: 'string' },
          authUser: { type: 'string', minLength: 1 },
          authPass: { type: 'string', minLength: 1 },
          isActive: { type: 'boolean' }
        }
      },
      response: {
        200: apiResponseSchema(emailConfigSchema)
      }
    }
  }, async (request) => {
    const body = request.body as {
      name: string
      host: string
      port: number
      secure?: boolean
      from: string
      fromName?: string
      authUser: string
      authPass: string
      isActive?: boolean
    }
    const shouldActive = body.isActive !== false
    if (shouldActive) {
      await prisma.emailConfig.updateMany({
        where: { isActive: true },
        data: { isActive: false }
      })
    }
    const created = await prisma.emailConfig.create({
      data: {
        name: body.name,
        host: body.host,
        port: body.port,
        secure: body.secure ?? true,
        from: body.from,
        fromName: body.fromName || null,
        isActive: shouldActive,
        auth: {
          user: body.authUser,
          pass: body.authPass
        }
      }
    })
    return success(sanitizeEmailConfig(created))
  })

  fastify.put('/:id', {
    schema: {
      operationId: 'updateEmailConfig',
      tags: ['EmailConfigs'],
      summary: '更新邮件配置',
      params: idParamsSchema,
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          host: { type: 'string', minLength: 1 },
          port: { type: 'number' },
          secure: { type: 'boolean' },
          from: { type: 'string', minLength: 1 },
          fromName: { type: 'string' },
          authUser: { type: 'string', minLength: 1 },
          authPass: { type: 'string', minLength: 1 },
          isActive: { type: 'boolean' }
        }
      },
      response: {
        200: apiResponseSchema(emailConfigSchema)
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as {
      name?: string
      host?: string
      port?: number
      secure?: boolean
      from?: string
      fromName?: string
      authUser?: string
      authPass?: string
      isActive?: boolean
    }
    const exists = await prisma.emailConfig.findUnique({ where: { id } })
    if (!exists) {
      return (reply as any).status(404).send(errors.notFound('邮件配置不存在'))
    }
    const currentAuth = (exists.auth || {}) as Record<string, unknown>
    const nextAuth = {
      user: body.authUser ?? (typeof currentAuth.user === 'string' ? currentAuth.user : ''),
      pass: body.authPass ?? (typeof currentAuth.pass === 'string' ? currentAuth.pass : '')
    }
    if (body.isActive === true) {
      await prisma.emailConfig.updateMany({
        where: { isActive: true, id: { not: id } },
        data: { isActive: false }
      })
    }
    const updated = await prisma.emailConfig.update({
      where: { id },
      data: {
        name: body.name,
        host: body.host,
        port: body.port,
        secure: body.secure,
        from: body.from,
        fromName: body.fromName,
        isActive: body.isActive,
        auth: nextAuth
      }
    })
    return success(sanitizeEmailConfig(updated))
  })

  fastify.delete('/:id', {
    schema: {
      operationId: 'deleteEmailConfig',
      tags: ['EmailConfigs'],
      summary: '删除邮件配置',
      params: idParamsSchema,
      response: {
        200: apiResponseSchema({
          type: 'object',
          nullable: true
        })
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const exists = await prisma.emailConfig.findUnique({ where: { id } })
    if (!exists) {
      return (reply as any).status(404).send(errors.notFound('邮件配置不存在'))
    }
    await prisma.emailConfig.delete({ where: { id } })
    return success(null, '删除成功')
  })

  fastify.post('/:id/test', {
    schema: {
      operationId: 'testEmailConfig',
      tags: ['EmailConfigs'],
      summary: '测试邮件配置',
      params: idParamsSchema,
      body: {
        type: 'object',
        required: ['to'],
        properties: {
          to: { type: 'string', minLength: 1 },
          subject: { type: 'string' },
          content: { type: 'string' }
        }
      },
      response: {
        200: apiResponseSchema({
          type: 'object',
          properties: {
            messageId: { type: 'string', nullable: true },
            accepted: { type: 'array', items: { type: 'string' } },
            rejected: { type: 'array', items: { type: 'string' } }
          }
        })
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as { to: string; subject?: string; content?: string }
    try {
      const result = await sendEmailWithConfig(id, {
        to: body.to,
        subject: body.subject || 'AutoOps 测试邮件',
        text: body.content || '这是一封测试邮件，用于验证 SMTP 配置是否可用。'
      })
      return success(result, '测试邮件发送成功')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '测试邮件发送失败'
      return (reply as any).status(400).send(errors.emailError(msg))
    }
  })
}

export default routes
