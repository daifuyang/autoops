import { FastifyInstance } from 'fastify'
import { success, errors } from '../common/response'
import { providerFactory } from './provider.factory'
import { ProviderCategory } from './types'
import { prisma } from '../lib/prisma'

export default async function (fastify: FastifyInstance) {
  // GET /api/providers/types - 获取支持的提供商类型
  fastify.get('/types', async () => {
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

  // GET /api/providers/types/:category - 按分类获取提供商类型
  fastify.get('/types/:category', async (request) => {
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

  // POST /api/providers - 创建提供商配置
  fastify.post('/', async (request) => {
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

  // GET /api/providers - 获取提供商列表
  fastify.get('/', async () => {
    const providers = await prisma.provider.findMany({
      orderBy: { createdAt: 'desc' }
    })
    return success(providers)
  })

  // GET /api/providers/:id - 获取提供商详情
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const provider = await prisma.provider.findUnique({ where: { id } })
    
    if (!provider) {
      return reply.status(404).send(errors.notFound('提供商不存在'))
    }

    return success(provider)
  })

  // PUT /api/providers/:id - 更新提供商配置
  fastify.put('/:id', async (request, reply) => {
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
      return reply.status(404).send(errors.notFound('提供商不存在'))
    }

    const updated = await prisma.provider.update({
      where: { id },
      data: body as any
    })

    return success(updated)
  })

  // DELETE /api/providers/:id - 删除提供商配置
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    
    const provider = await prisma.provider.findUnique({ where: { id } })
    if (!provider) {
      return reply.status(404).send(errors.notFound('提供商不存在'))
    }

    await prisma.provider.delete({ where: { id } })
    return success(null, '删除成功')
  })

  // POST /api/providers/:id/test - 测试提供商连通性
  fastify.post('/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string }
    
    const provider = await prisma.provider.findUnique({ where: { id } })
    if (!provider) {
      return reply.status(404).send(errors.notFound('提供商不存在'))
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
