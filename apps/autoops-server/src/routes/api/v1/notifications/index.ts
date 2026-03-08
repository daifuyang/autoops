import { FastifyPluginAsync } from 'fastify'
import { NotificationLevel, NotificationSource, TaskType } from '../../../../generated/prisma/client'
import { errors, success } from '../../../../common/response'
import { apiResponseSchema, paginatedDataSchema } from '../../../../common/response-schema'
import { prisma } from '../../../../lib/prisma'
import { cancelTask, createTask } from '../../../../tasks/service'

const notificationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    message: { type: 'string' },
    level: { type: 'string' },
    source: { type: 'string' },
    status: { type: 'string' },
    channel: { type: 'string' },
    recipient: { type: 'string', nullable: true },
    metadata: { type: 'object', nullable: true },
    taskId: { type: 'string', nullable: true },
    scheduledAt: { type: 'string', format: 'date-time', nullable: true },
    sentAt: { type: 'string', format: 'date-time', nullable: true },
    failedAt: { type: 'string', format: 'date-time', nullable: true },
    lastError: { type: 'string', nullable: true },
    isRead: { type: 'boolean' },
    readAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' }
  },
  required: ['id']
}

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', {
    schema: {
      operationId: 'listNotifications',
      tags: ['Notifications'],
      summary: '获取通知列表',
      querystring: {
        type: 'object',
        properties: {
          unreadOnly: { type: 'boolean' },
          level: { type: 'string' },
          status: { type: 'string' },
          page: { type: 'number', minimum: 1 },
          pageSize: { type: 'number', minimum: 1, maximum: 100 },
          limit: { type: 'number', minimum: 1, maximum: 100 }
        }
      },
      response: {
        200: apiResponseSchema(paginatedDataSchema(notificationSchema))
      }
    }
  }, async (request) => {
    const query = request.query as {
      unreadOnly?: boolean
      level?: string
      status?: string
      page?: number
      pageSize?: number
      limit?: number
    }
    const level = query.level && Object.values(NotificationLevel).includes(query.level as NotificationLevel)
      ? (query.level as NotificationLevel)
      : undefined
    const status = query.status && ['PENDING', 'SENT', 'FAILED', 'CANCELLED'].includes(query.status)
      ? query.status as 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED'
      : undefined
    const page = Math.max(query.page ?? 1, 1)
    const normalizedPageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100)
    const pageSize = query.limit ? Math.min(Math.max(query.limit, 1), 100) : normalizedPageSize
    const skip = (page - 1) * pageSize
    const where = {
      isRead: query.unreadOnly ? false : undefined,
      level,
      status
    }
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.notification.count({ where })
    ])
    return success({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1)
    })
  })

  fastify.post('/', {
    schema: {
      operationId: 'createNotification',
      tags: ['Notifications'],
      summary: '手动新增通知',
      body: {
        type: 'object',
        required: ['title', 'message'],
        properties: {
          title: { type: 'string', minLength: 1 },
          message: { type: 'string', minLength: 1 },
          level: { type: 'string' },
          channel: { type: 'string' },
          sendMode: { type: 'string' },
          scheduledAt: { type: 'string' },
          recipient: { type: 'string' },
          metadata: { type: 'object' }
        }
      },
      response: {
        200: apiResponseSchema(notificationSchema)
      }
    }
  }, async (request) => {
    const body = request.body as {
      title: string
      message: string
      level?: string
      channel?: string
      sendMode?: string
      scheduledAt?: string
      recipient?: string
      metadata?: Record<string, unknown>
    }
    const level = body.level && Object.values(NotificationLevel).includes(body.level as NotificationLevel)
      ? (body.level as NotificationLevel)
      : NotificationLevel.INFO
    const channel = (body.channel || 'IN_APP').toUpperCase()
    const sendMode = body.sendMode === 'SCHEDULED' ? 'SCHEDULED' : 'ASYNC'
    const scheduledAt = sendMode === 'SCHEDULED' && body.scheduledAt ? new Date(body.scheduledAt) : null
    if (sendMode === 'SCHEDULED' && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) {
      return {
        code: 1001,
        success: false,
        msg: 'scheduledAt 无效',
        data: null
      }
    }
    if (channel === 'EMAIL' && !body.recipient) {
      return {
        code: 1001,
        success: false,
        msg: 'EMAIL 通道必须提供 recipient',
        data: null
      }
    }
    const item = await prisma.notification.create({
      data: {
        title: body.title,
        message: body.message,
        level,
        source: NotificationSource.MANUAL,
        status: 'PENDING',
        channel,
        recipient: body.recipient || null,
        metadata: body.metadata as any,
        scheduledAt
      }
    })
    const task = await createTask({
      name: `通知发送:${item.id}`,
      type: TaskType.NOTIFY,
      payload: {
        notificationId: item.id,
        title: item.title,
        level: item.level,
        channel: item.channel,
        recipient: item.recipient,
        message: item.message
      },
      runAt: scheduledAt ? scheduledAt.toISOString() : undefined,
      maxAttempts: 3,
      backoffMs: 3000
    })
    const updated = await prisma.notification.update({
      where: { id: item.id },
      data: { taskId: task.id }
    })
    return success(updated)
  })

  fastify.post('/:id/read', {
    schema: {
      operationId: 'markNotificationRead',
      tags: ['Notifications'],
      summary: '标记通知为已读',
      params: idParamSchema,
      response: {
        200: apiResponseSchema(notificationSchema)
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const exists = await prisma.notification.findUnique({ where: { id } })
    if (!exists) {
      return (reply as any).status(404).send(errors.notFound('通知不存在'))
    }
    const updated = await prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date()
      }
    })
    return success(updated)
  })

  fastify.delete('/:id', {
    schema: {
      operationId: 'deleteNotification',
      tags: ['Notifications'],
      summary: '删除通知',
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
    const exists = await prisma.notification.findUnique({ where: { id } })
    if (!exists) {
      return (reply as any).status(404).send(errors.notFound('通知不存在'))
    }
    if (exists.taskId && exists.status === 'PENDING') {
      await cancelTask(exists.taskId)
    }
    await prisma.notification.delete({ where: { id } })
    return success(null, '删除成功')
  })
}

export default routes
