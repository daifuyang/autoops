import { test } from 'node:test'
import * as assert from 'node:assert'
import { build } from '../helper'
import { prisma } from '../../src/lib/prisma'
import { registerBuiltinProviders } from '../../src/providers'

// 注册内置适配器
registerBuiltinProviders()

// 测试前准备数据
test.before(async () => {
  console.log('🌱 Seeding test data for certificates...')

  // 清理现有数据
  await prisma.certLog.deleteMany()
  await prisma.certificate.deleteMany()
  await prisma.taskExecution.deleteMany()
  await prisma.scheduledTask.deleteMany()
  await prisma.provider.deleteMany()

  // 创建演示提供商
  await prisma.provider.create({
    data: {
      name: '阿里云 DNS 演示',
      type: 'aliyun',
      category: 'CLOUD',
      credentials: {
        accessKeyId: 'demo-access-key',
        accessKeySecret: 'demo-access-secret'
      },
      config: { region: 'cn-hangzhou' },
      description: '用于演示的阿里云配置',
      isActive: true
    }
  })

  console.log('✅ Test data seeded for certificates')
})

// 测试后清理数据
test.after(async () => {
  console.log('🧹 Cleaning up test data for certificates...')
  // 禁用外键检查，强制清理所有数据
  await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 0`
  await prisma.certLog.deleteMany()
  await prisma.certificate.deleteMany()
  await prisma.taskExecution.deleteMany()
  await prisma.scheduledTask.deleteMany()
  await prisma.provider.deleteMany()
  await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 1`
  console.log('✅ Test data cleaned up for certificates')
})

test('获取 DNS 服务商列表', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/certificates/dns-providers'
  })
  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.success, true)
  assert.ok(Array.isArray(body.data))
  assert.ok(body.data.some((p: any) => p.code === 'aliyun'))
})

test('获取部署目标列表', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/certificates/deploy-targets'
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.ok(Array.isArray(body.data))
  assert.ok(body.data.some((t: any) => t.type === 'manual'))
  assert.ok(body.data.some((t: any) => t.type === 'aliyun_fc'))
})

test('创建证书 - 不存在的 DNS 服务商', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/certificates',
    payload: {
      name: '测试证书',
      domain: 'example.com',
      dnsProviderId: 'non-existent-provider-id'
    }
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1004) // 资源不存在
  assert.equal(body.success, false)
})

test('创建证书 - 成功', async (t) => {
  const app = await build(t)

  // 先创建 DNS 服务商
  const providerRes = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '测试 DNS 服务商',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })
  const providerBody = JSON.parse(providerRes.payload)
  const dnsProviderId = providerBody.data.id

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/certificates',
    payload: {
      name: '测试证书',
      domain: 'example.com',
      wildcard: true,
      sanDomains: ['www.example.com'],
      dnsProviderId: dnsProviderId,
      deployTarget: 'manual',
      autoRenew: true
    }
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.success, true)
  assert.ok(body.data.id)
  assert.equal(body.data.name, '测试证书')
  assert.equal(body.data.domain, 'example.com')
  assert.equal(body.data.wildcard, true)
  assert.equal(body.data.status, 'ISSUING')
  assert.equal(body.data.dnsProviderId, dnsProviderId)
})

test('获取证书列表', async (t) => {
  const app = await build(t)

  // 先创建 DNS 服务商和证书
  const providerRes = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '列表测试 DNS 服务商',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })
  const providerBody = JSON.parse(providerRes.payload)
  const dnsProviderId = providerBody.data.id

  await app.inject({
    method: 'POST',
    url: '/api/v1/certificates',
    payload: {
      name: '列表测试证书',
      domain: 'test.com',
      dnsProviderId: dnsProviderId
    }
  })

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/certificates'
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.ok(Array.isArray(body.data))
  assert.ok(body.data.length > 0)
  assert.ok(body.data.some((c: any) => c.name === '列表测试证书'))
})

test('获取证书详情', async (t) => {
  const app = await build(t)

  // 先创建 DNS 服务商和证书
  const providerRes = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '详情测试 DNS 服务商',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })
  const providerBody = JSON.parse(providerRes.payload)
  const dnsProviderId = providerBody.data.id

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/certificates',
    payload: {
      name: '详情测试证书',
      domain: 'detail.com',
      dnsProviderId: dnsProviderId
    }
  })
  const createBody = JSON.parse(createRes.payload)
  const certId = createBody.data.id

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/certificates/${certId}`
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.data.id, certId)
  assert.equal(body.data.name, '详情测试证书')
  assert.ok(body.data.dnsProvider)
})

test('获取不存在的证书详情', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/certificates/non-existent-id'
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 404)
  assert.equal(body.code, 1004)
  assert.equal(body.success, false)
})

test('更新证书配置', async (t) => {
  const app = await build(t)

  // 先创建 DNS 服务商和证书
  const providerRes = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '更新测试 DNS 服务商',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })
  const providerBody = JSON.parse(providerRes.payload)
  const dnsProviderId = providerBody.data.id

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/certificates',
    payload: {
      name: '更新测试证书',
      domain: 'update.com',
      dnsProviderId: dnsProviderId
    }
  })
  const createBody = JSON.parse(createRes.payload)
  const certId = createBody.data.id

  const res = await app.inject({
    method: 'PUT',
    url: `/api/v1/certificates/${certId}`,
    payload: {
      name: '已更新的证书名称',
      autoRenew: false
    }
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.data.name, '已更新的证书名称')
  assert.equal(body.data.autoRenew, false)
})

test('删除证书', async (t) => {
  const app = await build(t)

  // 先创建 DNS 服务商和证书
  const providerRes = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '删除测试 DNS 服务商',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })
  const providerBody = JSON.parse(providerRes.payload)
  const dnsProviderId = providerBody.data.id

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/certificates',
    payload: {
      name: '删除测试证书',
      domain: 'delete.com',
      dnsProviderId: dnsProviderId
    }
  })
  const createBody = JSON.parse(createRes.payload)
  const certId = createBody.data.id

  const res = await app.inject({
    method: 'DELETE',
    url: `/api/v1/certificates/${certId}`
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.msg, '删除成功')

  // 验证已删除
  const getRes = await app.inject({
    method: 'GET',
    url: `/api/v1/certificates/${certId}`
  })
  assert.equal(getRes.statusCode, 404)
})

test('提交证书签发任务', async (t) => {
  const app = await build(t)

  // 先创建 DNS 服务商和证书
  const providerRes = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '签发测试 DNS 服务商',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })
  const providerBody = JSON.parse(providerRes.payload)
  const dnsProviderId = providerBody.data.id

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/certificates',
    payload: {
      name: '签发测试证书',
      domain: 'issue.com',
      dnsProviderId: dnsProviderId
    }
  })
  const createBody = JSON.parse(createRes.payload)
  const certId = createBody.data.id

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/certificates/${certId}/issue`
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.data.certificateId, certId)
  assert.equal(body.data.status, 'ISSUING')
  assert.ok(body.data.taskId)
})

test('提交证书续期任务', async (t) => {
  const app = await build(t)

  // 先创建 DNS 服务商和证书
  const providerRes = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '续期测试 DNS 服务商',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })
  const providerBody = JSON.parse(providerRes.payload)
  const dnsProviderId = providerBody.data.id

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/certificates',
    payload: {
      name: '续期测试证书',
      domain: 'renew.com',
      dnsProviderId: dnsProviderId
    }
  })
  const createBody = JSON.parse(createRes.payload)
  const certId = createBody.data.id

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/certificates/${certId}/renew`
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.data.certificateId, certId)
  assert.equal(body.data.status, 'ISSUING')
  assert.ok(body.data.taskId)
})

test('下载未签发的证书', async (t) => {
  const app = await build(t)

  // 先创建 DNS 服务商和证书
  const providerRes = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '下载测试 DNS 服务商',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })
  const providerBody = JSON.parse(providerRes.payload)
  const dnsProviderId = providerBody.data.id

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/certificates',
    payload: {
      name: '下载测试证书',
      domain: 'download.com',
      dnsProviderId: dnsProviderId
    }
  })
  const createBody = JSON.parse(createRes.payload)
  const certId = createBody.data.id

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/certificates/${certId}/download`
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1001) // 参数错误
  assert.equal(body.msg, '证书尚未签发')
})
