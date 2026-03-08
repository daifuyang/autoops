import { FastifyPluginAsync } from 'fastify'
import { prisma } from '../../../../lib/prisma'
import { apiResponseSchema } from '../../../../common/response-schema'
import { success } from '../../../../common/response'
import { getTaskQueue } from '../../../../lib/queue'

const SETTINGS_KEY = 'system_settings_v1'

type GeneralSettings = {
  siteName: string
  maintenanceMode: boolean
}

type NotificationSettings = {
  certExpiryReminder: boolean
  healthCheckAlert: boolean
}

type SystemSettings = {
  autoCleanupLogs: boolean
}

type SettingsPayload = {
  general: GeneralSettings
  notifications: NotificationSettings
  system: SystemSettings
}

const defaults: SettingsPayload = {
  general: {
    siteName: '自动化运维平台',
    maintenanceMode: false
  },
  notifications: {
    certExpiryReminder: true,
    healthCheckAlert: true
  },
  system: {
    autoCleanupLogs: true
  }
}

function normalizeSettings(value: unknown): SettingsPayload {
  if (!value || typeof value !== 'object') return defaults
  const src = value as Record<string, any>
  return {
    general: {
      siteName: typeof src.general?.siteName === 'string' ? src.general.siteName : defaults.general.siteName,
      maintenanceMode: typeof src.general?.maintenanceMode === 'boolean' ? src.general.maintenanceMode : defaults.general.maintenanceMode
    },
    notifications: {
      certExpiryReminder: typeof src.notifications?.certExpiryReminder === 'boolean' ? src.notifications.certExpiryReminder : defaults.notifications.certExpiryReminder,
      healthCheckAlert: typeof src.notifications?.healthCheckAlert === 'boolean' ? src.notifications.healthCheckAlert : defaults.notifications.healthCheckAlert
    },
    system: {
      autoCleanupLogs: typeof src.system?.autoCleanupLogs === 'boolean' ? src.system.autoCleanupLogs : defaults.system.autoCleanupLogs
    }
  }
}

async function getSystemRuntimeInfo() {
  let database = '异常'
  let databaseVersion = '-'
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ version: string }>>('SELECT VERSION() AS version')
    database = '正常'
    databaseVersion = rows?.[0]?.version || '-'
  } catch {
    database = '异常'
  }

  let redis = '异常'
  let redisVersion = '-'
  try {
    const queue = getTaskQueue()
    await queue.getJobCounts('waiting')
    redis = '正常'
    const client = await queue.client as any
    if (client && typeof client.info === 'function') {
      const info = await client.info('server')
      const match = typeof info === 'string' ? info.match(/redis_version:([^\r\n]+)/) : null
      redisVersion = match?.[1] || '-'
    }
  } catch {
    redis = '异常'
  }

  return {
    appVersion: process.env.APP_VERSION || 'v1.0.0',
    nodeVersion: process.version,
    database,
    databaseVersion,
    redis,
    redisVersion
  }
}

const settingsSchema = {
  type: 'object',
  properties: {
    general: {
      type: 'object',
      properties: {
        siteName: { type: 'string' },
        maintenanceMode: { type: 'boolean' }
      }
    },
    notifications: {
      type: 'object',
      properties: {
        certExpiryReminder: { type: 'boolean' },
        healthCheckAlert: { type: 'boolean' }
      }
    },
    system: {
      type: 'object',
      properties: {
        autoCleanupLogs: { type: 'boolean' },
        appVersion: { type: 'string' },
        nodeVersion: { type: 'string' },
        database: { type: 'string' },
        databaseVersion: { type: 'string' },
        redis: { type: 'string' },
        redisVersion: { type: 'string' }
      }
    }
  }
}

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', {
    schema: {
      operationId: 'getSystemSettings',
      tags: ['Settings'],
      summary: '获取系统设置',
      response: {
        200: apiResponseSchema(settingsSchema)
      }
    }
  }, async () => {
    const setting = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } })
    const normalized = normalizeSettings(setting?.value)
    const runtime = await getSystemRuntimeInfo()
    return success({
      ...normalized,
      system: {
        ...normalized.system,
        ...runtime
      }
    })
  })

  fastify.put('/', {
    schema: {
      operationId: 'updateSystemSettings',
      tags: ['Settings'],
      summary: '更新系统设置',
      body: settingsSchema,
      response: {
        200: apiResponseSchema(settingsSchema)
      }
    }
  }, async (request) => {
    const body = request.body as {
      general?: Partial<GeneralSettings>
      notifications?: Partial<NotificationSettings>
      system?: Partial<SystemSettings>
    }
    const current = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } })
    const currentNormalized = normalizeSettings(current?.value)
    const merged = normalizeSettings({
      ...currentNormalized,
      ...body,
      general: {
        ...currentNormalized.general,
        ...(body.general || {})
      },
      notifications: {
        ...currentNormalized.notifications,
        ...(body.notifications || {})
      },
      system: {
        ...currentNormalized.system,
        ...(body.system || {})
      }
    })

    await prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: {
        key: SETTINGS_KEY,
        value: merged as any
      },
      update: {
        value: merged as any
      }
    })
    const runtime = await getSystemRuntimeInfo()
    return success({
      ...merged,
      system: {
        ...merged.system,
        ...runtime
      }
    }, '设置已保存')
  })
}

export default routes
