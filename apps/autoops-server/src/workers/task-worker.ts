import * as crypto from 'node:crypto'
import { Worker } from 'bullmq'
import { TaskType } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { createTaskWorker, getQueueEvents, isRedisConnected } from '../lib/queue'
import { resolveTaskHandler } from '../tasks/handlers'
import {
  createTask,
  fetchTaskByJob,
  markTaskFailed,
  markTaskRunning,
  markTaskSuccess
} from '../tasks/service'
import { config } from '../config'

const SETTINGS_KEY = 'system_settings_v1'

function truncateMessage(message: string, max = 500): string {
  return message.length > max ? `${message.slice(0, max)}...` : message
}

async function pushTaskFailureNotification(input: {
  taskId: string
  taskType: string
  taskName: string
  error: string
}) {
  if (input.taskType === 'NOTIFY') return
  const setting = await prisma.appSetting.findUnique({
    where: { key: SETTINGS_KEY }
  })
  const maintenanceMode = Boolean((setting?.value as any)?.general?.maintenanceMode)
  if (maintenanceMode) return
  await createTask({
    name: `失败通知:${input.taskId}`,
    type: TaskType.NOTIFY,
    payload: {
      title: '任务执行失败',
      level: 'ERROR',
      channel: 'IN_APP',
      message: [
        `任务名称：${input.taskName}`,
        `任务类型：${input.taskType}`,
        `任务ID：${input.taskId}`,
        `错误信息：${truncateMessage(input.error)}`
      ].join('\n')
    },
    maxAttempts: 2,
    backoffMs: 3000
  })
}

export async function startTaskWorker(): Promise<{ worker: Worker | null }> {
  // 检查 Redis 连接
  if (!isRedisConnected()) {
    console.warn('Redis not connected, task worker not started')
    return { worker: null }
  }

  const queueEvents = getQueueEvents()
  if (queueEvents) {
    await queueEvents.waitUntilReady()
    queueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`queue failed: job=${jobId} reason=${failedReason}`)
    })
  }

  const worker = createTaskWorker(async (job) => {

    console.info(`queue job processed: ${job.id}`)

    const task = await fetchTaskByJob(job)
    console.log('task:', task)
    if (!task) {
      console.warn(`stale queue job removed: ${job.id}`)
      try {
        await job.remove()
      } catch (error) {
        console.warn(`failed to remove stale job: ${job.id}`)
      }
      return { skipped: true, reason: 'task_not_found' }
    }
    const execution = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        status: 'RUNNING',
        attempt: job.attemptsMade + 1,
        startedAt: new Date(),
        queueJobId: String(job.id),
        workerName: config.worker.name
      }
    })

    try {
      await markTaskRunning(task.id)
      const handler = resolveTaskHandler(task.type as any)
      const traceId = crypto.randomUUID()
      const result = await handler.execute(task.payload as never, {
        taskId: task.id,
        executionId: execution.id,
        attempt: job.attemptsMade + 1,
        workerName: config.worker.name,
        traceId
      })
      await prisma.taskExecution.update({
        where: { id: execution.id },
        data: {
          status: 'COMPLETED',
          endedAt: new Date(),
          durationMs: Date.now() - execution.startedAt.getTime(),
          result: result as never
        }
      })
      await markTaskSuccess(task.id, result as never)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      await prisma.taskExecution.update({
        where: { id: execution.id },
        data: {
          status: 'FAILED',
          endedAt: new Date(),
          durationMs: Date.now() - execution.startedAt.getTime(),
          error: message
        }
      })
      await markTaskFailed(task.id, message)
      try {
        await pushTaskFailureNotification({
          taskId: task.id,
          taskType: String(task.type),
          taskName: task.name || task.id,
          error: message
        })
      } catch (notifyErr) {
        console.warn('failed to enqueue task failure notification:', notifyErr)
      }
      throw error
    }
  })

  if (worker) {
    worker.on('completed', (job) => {
      console.info(`job completed: ${job.id}`)
    })

    worker.on('failed', (job, error) => {
      console.error(`job failed: ${job?.id} ${error.message}`)
    })
  }

  return { worker }
}
