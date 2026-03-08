import { test } from 'node:test'
import * as assert from 'node:assert'
import { build } from '../helper'
import { prisma } from '../../src/lib/prisma'
import { registerBuiltinProviders } from '../../src/providers'

// 注册内置适配器
registerBuiltinProviders()

// 测试前准备数据
test.before(async () => {
  console.log('🌱 Seeding test data...')
  
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
  
  console.log('✅ Test data seeded')
})

// 测试后清理数据
test.after(async () => {
  console.log('🧹 Cleaning up test data...')
  // 禁用外键检查，强制清理所有数据
  await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 0`
  await prisma.certLog.deleteMany()
  await prisma.certificate.deleteMany()
  await prisma.taskExecution.deleteMany()
  await prisma.scheduledTask.deleteMany()
  await prisma.provider.deleteMany()
  await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 1`
  console.log('✅ Test data cleaned up')
})

test('获取提供商类型列表', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/providers/types'
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.success, true)
  assert.ok(Array.isArray(body.data))
  // 至少应该有阿里云提供商
  assert.ok(body.data.length > 0)
  assert.ok(body.data.some((p: any) => p.type === 'aliyun'))
})

test('创建阿里云提供商配置', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '测试阿里云配置',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-access-key-id',
        accessKeySecret: 'test-access-key-secret'
      },
      description: '用于测试的阿里云配置'
    }
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.success, true)
  assert.ok(body.data.id)
  assert.equal(body.data.name, '测试阿里云配置')
  assert.equal(body.data.type, 'aliyun')
})

test('创建提供商配置 - 缺少必填字段', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '测试配置',
      type: 'aliyun',
      credentials: {
        // 缺少 accessKeySecret
        accessKeyId: 'test-access-key-id'
      }
    }
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1001) // 参数错误
  assert.equal(body.success, false)
})

test('获取提供商列表', async (t) => {
  const app = await build(t)

  // 先创建一个提供商
  await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '列表测试配置',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/providers'
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.ok(Array.isArray(body.data))
  assert.ok(body.data.length > 0)
})

test('获取提供商详情', async (t) => {
  const app = await build(t)

  // 先创建一个提供商
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '详情测试配置',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })
  const createBody = JSON.parse(createRes.payload)
  const providerId = createBody.data.id

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/providers/${providerId}`
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.data.id, providerId)
  assert.equal(body.data.name, '详情测试配置')
})

test('获取不存在的提供商详情', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/providers/non-existent-id'
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 404)
  assert.equal(body.code, 1004) // 资源不存在
  assert.equal(body.success, false)
})

test('更新提供商配置', async (t) => {
  const app = await build(t)

  // 先创建一个提供商
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '更新测试配置',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })
  const createBody = JSON.parse(createRes.payload)
  const providerId = createBody.data.id

  const res = await app.inject({
    method: 'PUT',
    url: `/api/v1/providers/${providerId}`,
    payload: {
      name: '已更新的配置名称',
      description: '更新后的描述'
    }
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.data.name, '已更新的配置名称')
  assert.equal(body.data.description, '更新后的描述')
})

test('删除提供商配置', async (t) => {
  const app = await build(t)

  // 先创建一个提供商
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/providers',
    payload: {
      name: '删除测试配置',
      type: 'aliyun',
      credentials: {
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret'
      }
    }
  })
  const createBody = JSON.parse(createRes.payload)
  const providerId = createBody.data.id

  const res = await app.inject({
    method: 'DELETE',
    url: `/api/v1/providers/${providerId}`
  })

  const body = JSON.parse(res.payload)
  assert.equal(res.statusCode, 200)
  assert.equal(body.code, 1)
  assert.equal(body.msg, '删除成功')

  // 验证已删除
  const getRes = await app.inject({
    method: 'GET',
    url: `/api/v1/providers/${providerId}`
  })
  assert.equal(getRes.statusCode, 404)
})
