import { FastifyInstance } from 'fastify'
import { success, errors } from '../../../../common/response'
import { apiResponseSchema, paginatedDataSchema } from '../../../../common/response-schema'
import { providerFactory } from '../../../../providers/provider.factory'
import { ProviderCategory } from '../../../../providers/types'
import { prisma } from '../../../../lib/prisma'

// Provider 响应 schema
const providerResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    category: { type: 'string' },
    description: { type: 'string', nullable: true },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}

const providerFieldSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    type: { type: 'string' },
    required: { type: 'boolean' },
    description: { type: 'string', nullable: true }
  }
}

// ProviderType 响应 schema
const providerTypeResponseSchema = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    name: { type: 'string' },
    category: { type: 'string' },
    capabilities: { type: 'array', items: { type: 'string' } },
    credentialFields: {
      type: 'array',
      items: { $ref: 'ProviderFieldSchema#' }
    },
    configFields: {
      type: 'array',
      items: { $ref: 'ProviderFieldSchema#' }
    }
  }
}

export default async function (fastify: FastifyInstance) {
  fastify.addSchema({
    $id: 'ProviderFieldSchema',
    ...providerFieldSchema
  })
  fastify.addSchema({
    $id: 'ProviderSchema',
    ...providerResponseSchema
  })
  fastify.addSchema({
    $id: 'ProviderTypeSchema',
    ...providerTypeResponseSchema
  })

  // GET /api/v1/providers/types - 获取支持的提供商类型
  fastify.get('/types', {
    schema: {
      operationId: 'listProviderTypes',
      tags: ['Providers'],
      summary: '获取支持的提供商类型',
      response: {
        200: apiResponseSchema({
          type: 'array',
          items: { $ref: 'ProviderTypeSchema#' }
        })
      }
    }
  }, async () => {
    const adapters = providerFactory.list()
    return success(adapters.map(a => ({
      type: a.type,
      name: a.name,
      category: a.category,
      capabilities: a.capabilities,
      credentialFields: a.credentialFields,
      configFields: a.configFields
    })))
  })

  // GET /api/v1/providers/types/:category - 按分类获取提供商类型
  fastify.get('/types/:category', {
    schema: {
      operationId: 'listProviderTypesByCategory',
      tags: ['Providers'],
      summary: '按分类获取提供商类型',
      params: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['dns', 'cdn', 'email', 'storage'] }
        }
      },
      response: {
        200: apiResponseSchema({
          type: 'array',
          items: { $ref: 'ProviderTypeSchema#' }
        })
      }
    }
  }, async (request) => {
    const { category } = request.params as { category: ProviderCategory }
    const adapters = providerFactory.listByCategory(category)
    return success(adapters.map(a => ({
      type: a.type,
      name: a.name,
      category: a.category,
      capabilities: a.capabilities,
      credentialFields: a.credentialFields,
      configFields: a.configFields
    })))
  })

  // POST /api/v1/providers - 创建提供商配置
  fastify.post('/', {
    schema: {
      operationId: 'createProvider',
      tags: ['Providers'],
      summary: '创建提供商配置',
      body: {
        type: 'object',
        required: ['name', 'type', 'credentials'],
        properties: {
          name: { type: 'string', description: '提供商名称' },
          type: { type: 'string', description: '提供商类型' },
          description: { type: 'string', description: '描述' },
          credentials: {
            type: 'object',
            description: '认证信息',
            additionalProperties: { type: 'string' }
          },
          config: {
            type: 'object',
            description: '配置信息',
            additionalProperties: true
          }
        }
      },
      response: {
        200: apiResponseSchema({ $ref: 'ProviderSchema#' })
      }
    }
  }, async (request) => {
    const body = request.body as {
      name: string
      type: string
      credentials: Record<string, string>
      config?: Record<string, unknown>
      description?: string
    }

    // 验证提供商类型
    const adapter = providerFactory.get(body.type)
    if (!adapter) {
      return errors.badRequest(`不支持的提供商类型: ${body.type}`)
    }

    // 验证必填字段
    for (const field of adapter.credentialFields) {
      if (field.required && !body.credentials[field.name]) {
        return errors.badRequest(`缺少必填字段: ${field.label}`)
      }
    }

    const provider = await prisma.provider.create({
      data: {
        name: body.name,
        type: body.type,
        category: adapter.category,
        credentials: body.credentials as any,
        config: body.config as any,
        description: body.description,
        isActive: true
      }
    })

    return success(provider)
  })

  // GET /api/v1/providers - 获取提供商列表
  fastify.get<{ Querystring: { page?: number; pageSize?: number } }>('/', {
    schema: {
      operationId: 'listProviders',
      tags: ['Providers'],
      summary: '获取提供商列表',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1 },
          pageSize: { type: 'number', minimum: 1, maximum: 100 }
        }
      },
      response: {
        200: apiResponseSchema(paginatedDataSchema({ $ref: 'ProviderSchema#' }))
      }
    }
  }, async (request) => {
    const page = Math.max(request.query.page ?? 1, 1)
    const pageSize = Math.min(Math.max(request.query.pageSize ?? 20, 1), 100)
    const skip = (page - 1) * pageSize
    const [items, total] = await prisma.$transaction([
      prisma.provider.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.provider.count()
    ])
    return success({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1)
    })
  })

  // GET /api/v1/providers/:id - 获取提供商详情
  fastify.get('/:id', {
    schema: {
      operationId: 'getProvider',
      tags: ['Providers'],
      summary: '获取提供商详情',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '提供商ID' }
        }
      },
      response: {
        200: apiResponseSchema({ $ref: 'ProviderSchema#' })
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const provider = await prisma.provider.findUnique({ where: { id } })
    
    if (!provider) {
      return (reply as any).status(404).send(errors.notFound('提供商不存在'))
    }

    return success(provider)
  })

  // PUT /api/v1/providers/:id - 更新提供商配置
  fastify.put('/:id', {
    schema: {
      operationId: 'updateProvider',
      tags: ['Providers'],
      summary: '更新提供商配置',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '提供商ID' }
        }
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '提供商名称' },
          description: { type: 'string', description: '描述' },
          credentials: {
            type: 'object',
            description: '认证信息',
            additionalProperties: { type: 'string' }
          },
          config: {
            type: 'object',
            description: '配置信息',
            additionalProperties: true
          },
          isActive: { type: 'boolean', description: '是否启用' }
        }
      },
      response: {
        200: apiResponseSchema({ $ref: 'ProviderSchema#' })
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as {
      name?: string
      credentials?: Record<string, string>
      config?: Record<string, unknown>
      description?: string
      isActive?: boolean
    }

    const provider = await prisma.provider.findUnique({ where: { id } })
    if (!provider) {
      return (reply as any).status(404).send(errors.notFound('提供商不存在'))
    }

    const updated = await prisma.provider.update({
      where: { id },
      data: body as any
    })

    return success(updated)
  })

  // DELETE /api/v1/providers/:id - 删除提供商配置
  fastify.delete('/:id', {
    schema: {
      operationId: 'deleteProvider',
      tags: ['Providers'],
      summary: '删除提供商配置',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '提供商ID' }
        }
      },
      response: {
        200: apiResponseSchema({
          type: 'object',
          nullable: true,
          description: '删除成功返回 null'
        })
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    const provider = await prisma.provider.findUnique({ where: { id } })
    if (!provider) {
      return (reply as any).status(404).send(errors.notFound('提供商不存在'))
    }

    await prisma.provider.delete({ where: { id } })
    return success(null, '删除成功')
  })

  // POST /api/v1/providers/:id/test - 测试提供商连通性
  fastify.post('/:id/test', {
    schema: {
      operationId: 'testProvider',
      tags: ['Providers'],
      summary: '测试提供商连通性',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '提供商ID' }
        }
      },
      response: {
        200: apiResponseSchema({
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        })
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    const provider = await prisma.provider.findUnique({ where: { id } })
    if (!provider) {
      return (reply as any).status(404).send(errors.notFound('提供商不存在'))
    }

    const adapter = providerFactory.get(provider.type)
    if (!adapter) {
      return errors.internal(`找不到适配器: ${provider.type}`)
    }

    const result = await adapter.test(provider.credentials as Record<string, string>)
    
    if (result.success) {
      return success({ success: true, message: result.message })
    } else {
      return errors.providerError(result.message || '连接失败')
    }
  })
}
