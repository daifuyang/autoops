import { FastifyInstance } from 'fastify'
import { success, errors } from '../../../../common/response'
import { apiResponseSchema, paginatedDataSchema } from '../../../../common/response-schema'
import { providerFactory } from '../../../../providers/provider.factory'
import { prisma } from '../../../../lib/prisma'
import { createTask } from '../../../../tasks/service'

const providerBriefSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' }
  }
}

const certLogSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    certificateId: { type: 'string' },
    level: { type: 'string' },
    message: { type: 'string' },
    details: { type: 'object', nullable: true },
    createdAt: { type: 'string', format: 'date-time' }
  }
}

const certificateSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    domain: { type: 'string' },
    wildcard: { type: 'boolean' },
    sanDomains: { type: 'array', items: { type: 'string' } },
    dnsProviderId: { type: 'string' },
    deployTarget: { type: 'string' },
    deployProviderId: { type: 'string', nullable: true },
    deployConfig: { type: 'object', nullable: true },
    autoRenew: { type: 'boolean' },
    status: { type: 'string' },
    certPem: { type: 'string', nullable: true },
    keyPem: { type: 'string', nullable: true },
    chainPem: { type: 'string', nullable: true },
    issuedAt: { type: 'string', format: 'date-time', nullable: true },
    expiresAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}

const certificateListSchema = {
  type: 'object',
  properties: {
    ...certificateSchema.properties,
    dnsProvider: providerBriefSchema,
    deployProvider: {
      ...providerBriefSchema,
      nullable: true
    },
    _count: {
      type: 'object',
      properties: {
        logs: { type: 'number' }
      }
    }
  }
}

const certificateDetailSchema = {
  type: 'object',
  properties: {
    ...certificateSchema.properties,
    dnsProvider: providerBriefSchema,
    deployProvider: {
      ...providerBriefSchema,
      nullable: true
    },
    logs: {
      type: 'array',
      items: certLogSchema
    }
  }
}

const createCertificateBodySchema = {
  type: 'object',
  required: ['name', 'domain', 'dnsProviderId'],
  properties: {
    name: { type: 'string', minLength: 1 },
    domain: { type: 'string', minLength: 1 },
    wildcard: { type: 'boolean' },
    sanDomains: { type: 'array', items: { type: 'string' } },
    dnsProviderId: { type: 'string' },
    deployTarget: { type: 'string' },
    deployProviderId: { type: 'string' },
    deployConfig: { type: 'object', additionalProperties: true },
    autoRenew: { type: 'boolean' }
  }
}

const updateCertificateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    autoRenew: { type: 'boolean' },
    deployTarget: { type: 'string' },
    deployProviderId: { type: 'string' },
    deployConfig: { type: 'object', additionalProperties: true }
  }
}

const idParamSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id']
}

export default async function (fastify: FastifyInstance) {
  // GET /api/v1/certificates/dns-providers - 获取支持的 DNS 服务商
  fastify.get('/dns-providers', {
    schema: {
      operationId: 'listDnsProviders',
      tags: ['Certificates'],
      summary: '获取支持的 DNS 服务商',
      response: {
        200: apiResponseSchema({
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              name: { type: 'string' },
              credentialFields: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    label: { type: 'string' },
                    type: { type: 'string' },
                    required: { type: 'boolean' },
                    description: { type: 'string', nullable: true }
                  }
                }
              }
            }
          }
        })
      }
    }
  }, async () => {
    // 过滤有 DNS 管理能力的适配器
    const adapters = providerFactory.list().filter(a => 
      a.capabilities.includes('dns_manage')
    )
    return success(adapters.map(a => ({
      code: a.type,
      name: a.name,
      credentialFields: a.credentialFields
    })))
  })

  // GET /api/v1/certificates/deploy-targets - 获取支持的部署目标
  fastify.get('/deploy-targets', {
    schema: {
      operationId: 'listDeployTargets',
      tags: ['Certificates'],
      summary: '获取支持的部署目标',
      response: {
        200: apiResponseSchema({
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' }
            }
          }
        })
      }
    }
  }, async () => {
    return success([
      { type: 'manual', name: '手动部署', description: '仅签发证书，手动下载部署' },
      { type: 'aliyun_fc', name: '阿里云函数计算', description: '部署到阿里云函数计算' },
      { type: 'aliyun_cdn', name: '阿里云 CDN', description: '部署到阿里云 CDN' }
    ])
  })

  // POST /api/v1/certificates - 创建证书
  fastify.post('/', {
    schema: {
      operationId: 'createCertificate',
      tags: ['Certificates'],
      summary: '创建证书',
      body: createCertificateBodySchema,
      response: {
        200: apiResponseSchema(certificateSchema)
      }
    }
  }, async (request) => {
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

    const task = await createTask({
      name: `签发证书: ${certificate.domain}`,
      type: 'CERT_ISSUE' as any,
      payload: { certificateId: certificate.id },
      maxAttempts: 3
    })

    const issuingCertificate = await prisma.certificate.update({
      where: { id: certificate.id },
      data: { status: 'ISSUING' }
    })

    await prisma.certLog.create({
      data: {
        certificateId: certificate.id,
        action: 'issue',
        status: 'pending',
        message: '证书创建成功，已自动提交签发任务',
        details: { taskId: task.id, autoTriggered: true }
      }
    })

    return success(issuingCertificate, '证书创建成功，已自动开始签发')
  })

  // GET /api/v1/certificates - 获取证书列表
  fastify.get<{ Querystring: { page?: number; pageSize?: number } }>('/', {
    schema: {
      operationId: 'listCertificates',
      tags: ['Certificates'],
      summary: '获取证书列表',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1 },
          pageSize: { type: 'number', minimum: 1, maximum: 100 }
        }
      },
      response: {
        200: apiResponseSchema(paginatedDataSchema(certificateListSchema))
      }
    }
  }, async (request) => {
    const page = Math.max(request.query.page ?? 1, 1)
    const pageSize = Math.min(Math.max(request.query.pageSize ?? 20, 1), 100)
    const skip = (page - 1) * pageSize
    const [items, total] = await prisma.$transaction([
      prisma.certificate.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          dnsProvider: { select: { id: true, name: true, type: true } },
          deployProvider: { select: { id: true, name: true, type: true } },
          _count: { select: { logs: true } }
        },
        skip,
        take: pageSize
      }),
      prisma.certificate.count()
    ])
    return success({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1)
    })
  })

  // GET /api/v1/certificates/:id - 获取证书详情
  fastify.get('/:id', {
    schema: {
      operationId: 'getCertificate',
      tags: ['Certificates'],
      summary: '获取证书详情',
      params: idParamSchema,
      response: {
        200: apiResponseSchema(certificateDetailSchema)
      }
    }
  }, async (request, reply) => {
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
      return (reply as any).status(404).send(errors.notFound('证书不存在'))
    }

    return success(certificate)
  })

  // PUT /api/v1/certificates/:id - 更新证书配置
  fastify.put('/:id', {
    schema: {
      operationId: 'updateCertificate',
      tags: ['Certificates'],
      summary: '更新证书配置',
      params: idParamSchema,
      body: updateCertificateBodySchema,
      response: {
        200: apiResponseSchema(certificateSchema)
      }
    }
  }, async (request, reply) => {
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
      return (reply as any).status(404).send(errors.notFound('证书不存在'))
    }

    const updated = await prisma.certificate.update({
      where: { id },
      data: body as any
    })

    return success(updated)
  })

  // DELETE /api/v1/certificates/:id - 删除证书
  fastify.delete('/:id', {
    schema: {
      operationId: 'deleteCertificate',
      tags: ['Certificates'],
      summary: '删除证书',
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

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) {
      return (reply as any).status(404).send(errors.notFound('证书不存在'))
    }

    await prisma.certificate.delete({ where: { id } })
    return success(null, '删除成功')
  })

  // POST /api/v1/certificates/:id/issue - 手动签发证书（异步）
  fastify.post('/:id/issue', {
    schema: {
      operationId: 'issueCertificate',
      tags: ['Certificates'],
      summary: '手动签发证书',
      params: idParamSchema,
      response: {
        200: apiResponseSchema({
          type: 'object',
          properties: {
            certificateId: { type: 'string' },
            taskId: { type: 'string' },
            status: { type: 'string' }
          }
        })
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    console.log(`[issue] Starting issue for certificate: ${id}`)

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) {
      console.log(`[issue] Certificate not found: ${id}`)
      return (reply as any).status(404).send(errors.notFound('证书不存在'))
    }
    console.log(`[issue] Found certificate: ${certificate.domain}`)

    // 更新状态为签发中
    await prisma.certificate.update({
      where: { id },
      data: { status: 'ISSUING' }
    })
    console.log(`[issue] Updated certificate status to ISSUING`)

    // 创建异步任务
    console.log(`[issue] Creating task for certificate...`)
    const task = await createTask({
      name: `签发证书: ${certificate.domain}`,
      type: 'CERT_ISSUE' as any,
      payload: { certificateId: id },
      maxAttempts: 3
    })
    console.log(`[issue] Task created: ${task.id}`)

    return success({
      certificateId: id,
      taskId: task.id,
      status: 'ISSUING'
    }, '证书签发任务已提交')
  })

  // POST /api/v1/certificates/:id/renew - 手动续期证书（异步）
  fastify.post('/:id/renew', {
    schema: {
      operationId: 'renewCertificate',
      tags: ['Certificates'],
      summary: '手动续期证书',
      params: idParamSchema,
      response: {
        200: apiResponseSchema({
          type: 'object',
          properties: {
            certificateId: { type: 'string' },
            taskId: { type: 'string' },
            status: { type: 'string' }
          }
        })
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) {
      return (reply as any).status(404).send(errors.notFound('证书不存在'))
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

  // GET /api/v1/certificates/:id/download - 下载证书
  fastify.get('/:id/download', {
    schema: {
      operationId: 'downloadCertificate',
      tags: ['Certificates'],
      summary: '下载证书',
      params: idParamSchema,
      response: {
        200: {
          type: 'string'
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) {
      return (reply as any).status(404).send(errors.notFound('证书不存在'))
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

  // GET /api/v1/certificates/:id/logs - 获取证书日志
  fastify.get<{ Params: { id: string }; Querystring: { page?: number; pageSize?: number } }>('/:id/logs', {
    schema: {
      operationId: 'listCertificateLogs',
      tags: ['Certificates'],
      summary: '获取证书日志',
      params: idParamSchema,
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1 },
          pageSize: { type: 'number', minimum: 1, maximum: 100 }
        }
      },
      response: {
        200: apiResponseSchema(paginatedDataSchema(certLogSchema))
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) {
      return (reply as any).status(404).send(errors.notFound('证书不存在'))
    }

    const page = Math.max(request.query.page ?? 1, 1)
    const pageSize = Math.min(Math.max(request.query.pageSize ?? 20, 1), 100)
    const skip = (page - 1) * pageSize
    const [items, total] = await prisma.$transaction([
      prisma.certLog.findMany({
        where: { certificateId: id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.certLog.count({
        where: { certificateId: id }
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
