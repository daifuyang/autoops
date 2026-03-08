import { FastifyInstance } from 'fastify'
import { success, errors } from '../common/response'
import { providerFactory } from '../providers'
import { prisma } from '../lib/prisma'
import { createTask } from '../tasks/service'

export default async function (fastify: FastifyInstance) {
  // GET /api/certificates/dns-providers - 获取支持的 DNS 服务商
  fastify.get('/dns-providers', async () => {
    const adapters = providerFactory.listByCategory('DNS' as any)
    return success(adapters.map(a => ({
      code: a.type,
      name: a.name,
      credentialFields: a.credentialFields
    })))
  })

  // GET /api/certificates/deploy-targets - 获取支持的部署目标
  fastify.get('/deploy-targets', async () => {
    return success([
      { type: 'manual', name: '手动部署', description: '仅签发证书，手动下载部署' },
      { type: 'aliyun_fc', name: '阿里云函数计算', description: '部署到阿里云函数计算' },
      { type: 'aliyun_cdn', name: '阿里云 CDN', description: '部署到阿里云 CDN' }
    ])
  })

  // POST /api/certificates - 创建证书
  fastify.post('/', async (request) => {
    const body = request.body as {
      name: string
      domain: string
      wildcard?: boolean
      sanDomains?: string[]
      dnsProviderId: string
      deployTarget?: string
      deployProviderId?: string
      deployConfig?: Record<string, unknown>
      autoRenew?: boolean
    }

    // 验证 DNS 服务商
    const dnsProvider = await prisma.provider.findUnique({
      where: { id: body.dnsProviderId }
    })
    if (!dnsProvider) {
      return errors.notFound('DNS 服务商不存在')
    }

    const certificate = await prisma.certificate.create({
      data: {
        name: body.name,
        domain: body.domain,
        wildcard: body.wildcard ?? false,
        sanDomains: body.sanDomains || [],
        dnsProviderId: body.dnsProviderId,
        deployTarget: body.deployTarget || 'manual',
        deployProviderId: body.deployProviderId,
        deployConfig: body.deployConfig as any,
        autoRenew: body.autoRenew ?? true,
        status: 'PENDING'
      }
    })

    return success(certificate)
  })

  // GET /api/certificates - 获取证书列表
  fastify.get('/', async () => {
    const certificates = await prisma.certificate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        dnsProvider: { select: { id: true, name: true, type: true } },
        deployProvider: { select: { id: true, name: true, type: true } },
        _count: { select: { logs: true } }
      }
    })
    return success(certificates)
  })

  // GET /api/certificates/:id - 获取证书详情
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const certificate = await prisma.certificate.findUnique({
      where: { id },
      include: {
        dnsProvider: { select: { id: true, name: true, type: true } },
        deployProvider: { select: { id: true, name: true, type: true } },
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    })

    if (!certificate) {
      return reply.status(404).send(errors.notFound('证书不存在'))
    }

    return success(certificate)
  })

  // PUT /api/certificates/:id - 更新证书配置
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as {
      name?: string
      autoRenew?: boolean
      deployTarget?: string
      deployProviderId?: string
      deployConfig?: Record<string, unknown>
    }

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) {
      return reply.status(404).send(errors.notFound('证书不存在'))
    }

    const updated = await prisma.certificate.update({
      where: { id },
      data: body as any
    })

    return success(updated)
  })

  // DELETE /api/certificates/:id - 删除证书
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) {
      return reply.status(404).send(errors.notFound('证书不存在'))
    }

    await prisma.certificate.delete({ where: { id } })
    return success(null, '删除成功')
  })

  // POST /api/certificates/:id/issue - 手动签发证书（异步）
  fastify.post('/:id/issue', async (request, reply) => {
    const { id } = request.params as { id: string }

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) {
      return reply.status(404).send(errors.notFound('证书不存在'))
    }

    // 更新状态为签发中
    await prisma.certificate.update({
      where: { id },
      data: { status: 'ISSUING' }
    })

    // 创建异步任务
    const task = await createTask({
      name: `签发证书: ${certificate.domain}`,
      type: 'CERT_ISSUE' as any,
      payload: { certificateId: id },
      maxAttempts: 3
    })

    return success({
      certificateId: id,
      taskId: task.id,
      status: 'ISSUING'
    }, '证书签发任务已提交')
  })

  // POST /api/certificates/:id/renew - 手动续期证书（异步）
  fastify.post('/:id/renew', async (request, reply) => {
    const { id } = request.params as { id: string }

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) {
      return reply.status(404).send(errors.notFound('证书不存在'))
    }

    // 更新状态为签发中
    await prisma.certificate.update({
      where: { id },
      data: { status: 'ISSUING' }
    })

    // 创建异步任务
    const task = await createTask({
      name: `续期证书: ${certificate.domain}`,
      type: 'CERT_RENEW' as any,
      payload: { certificateId: id },
      maxAttempts: 3
    })

    return success({
      certificateId: id,
      taskId: task.id,
      status: 'ISSUING'
    }, '证书续期任务已提交')
  })

  // GET /api/certificates/:id/download - 下载证书
  fastify.get('/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string }

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) {
      return reply.status(404).send(errors.notFound('证书不存在'))
    }

    if (!certificate.certPem || !certificate.keyPem) {
      return errors.badRequest('证书尚未签发')
    }

    const content = `# Certificate for ${certificate.domain}
# Issued at: ${certificate.issuedAt}
# Expires at: ${certificate.expiresAt}

# Private Key
${certificate.keyPem}

# Certificate
${certificate.certPem}

# Chain
${certificate.chainPem || ''}
`.trim()

    reply.header('Content-Type', 'text/plain')
    reply.header('Content-Disposition', `attachment; filename="${certificate.domain}.pem"`)
    return content
  })

  // GET /api/certificates/:id/logs - 获取证书日志
  fastify.get('/:id/logs', async (request, reply) => {
    const { id } = request.params as { id: string }

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) {
      return reply.status(404).send(errors.notFound('证书不存在'))
    }

    const logs = await prisma.certLog.findMany({
      where: { certificateId: id },
      orderBy: { createdAt: 'desc' }
    })

    return success(logs)
  })
}
