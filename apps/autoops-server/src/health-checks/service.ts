import { TaskType } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { cancelTask, createTask } from '../tasks/service'
import { sendEmailWithActiveConfig } from '../email/service'

const HEALTH_TASK_NAME_PREFIX = '健康检查:'

function getHealthTaskName(healthCheckId: string): string {
  return `${HEALTH_TASK_NAME_PREFIX}${healthCheckId}`
}

export async function executeHealthCheck(healthCheckId: string) {
  const check = await prisma.healthCheck.findUnique({ where: { id: healthCheckId } })
  if (!check) return null

  const started = Date.now()
  let status: 'UP' | 'DOWN' = 'DOWN'
  let responseTime: number | null = null
  let statusCode: number | null = null
  let error: string | null = null

  try {
    const controller = new AbortController()
    const timeoutRef = setTimeout(() => controller.abort(), Math.max(check.timeout, 1) * 1000)
    const response = await fetch(check.url, {
      method: check.method,
      headers: (check.headers || undefined) as Record<string, string> | undefined,
      body: check.body || undefined,
      signal: controller.signal
    })
    clearTimeout(timeoutRef)

    responseTime = Date.now() - started
    statusCode = response.status

    const bodyText = await response.text()
    const statusMatched = response.status === check.expectStatus
    const bodyMatched = check.expectBody ? bodyText.includes(check.expectBody) : true
    status = statusMatched && bodyMatched ? 'UP' : 'DOWN'
    if (!statusMatched) {
      error = `状态码不匹配，期望 ${check.expectStatus}，实际 ${response.status}`
    } else if (!bodyMatched) {
      error = '响应内容不符合预期'
    }
  } catch (err) {
    responseTime = Date.now() - started
    error = err instanceof Error ? err.message : '请求失败'
    status = 'DOWN'
  }

  const log = await prisma.healthCheckLog.create({
    data: {
      healthCheckId: check.id,
      status,
      responseTime: responseTime ?? undefined,
      statusCode: statusCode ?? undefined,
      error: error ?? undefined
    }
  })

  await prisma.healthCheck.update({
    where: { id: check.id },
    data: {
      lastCheckAt: new Date(),
      lastStatus: status
    }
  })

  if (status === 'DOWN' && check.notifyEmail) {
    try {
      await sendEmailWithActiveConfig({
        to: check.notifyEmail,
        subject: `健康检查告警：${check.name}`,
        text: [
          `检查名称：${check.name}`,
          `目标地址：${check.url}`,
          `状态：DOWN`,
          `状态码：${statusCode ?? '-'}`,
          `耗时：${responseTime ?? '-'}ms`,
          `错误：${error || '无'}`
        ].join('\n')
      })
    } catch (err) {
      console.warn('send health check email failed:', err)
    }
  }

  return log
}

export async function clearHealthCheckTasks(healthCheckId: string) {
  const tasks = await prisma.scheduledTask.findMany({
    where: {
      type: TaskType.HEALTH_CHECK,
      name: getHealthTaskName(healthCheckId),
      status: { not: 'CANCELLED' }
    },
    orderBy: { createdAt: 'desc' }
  })
  for (const task of tasks) {
    await cancelTask(task.id)
  }
}

export async function scheduleHealthCheckTask(healthCheckId: string, delaySeconds: number) {
  const runAt = new Date(Date.now() + Math.max(delaySeconds, 1) * 1000)
  return createTask({
    name: getHealthTaskName(healthCheckId),
    type: TaskType.HEALTH_CHECK,
    payload: { healthCheckId },
    runAt: runAt.toISOString(),
    maxAttempts: 1,
    backoffMs: 1000
  })
}

export async function rescheduleHealthCheckTask(healthCheckId: string) {
  const check = await prisma.healthCheck.findUnique({ where: { id: healthCheckId } })
  if (!check) return
  await clearHealthCheckTasks(healthCheckId)
  if (!check.isActive) return
  await scheduleHealthCheckTask(healthCheckId, check.interval)
}
