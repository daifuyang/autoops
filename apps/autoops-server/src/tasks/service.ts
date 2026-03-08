import { Job, JobsOptions } from 'bullmq'
import { Prisma, TaskStatus, TaskType } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { getTaskQueue } from '../lib/queue'

type CreateTaskInput = {
  name: string
  type: TaskType
  payload: Record<string, unknown>
  cronExpression?: string
  runAt?: string
  maxAttempts?: number
  backoffMs?: number
}

function getJobOptions(task: {
  id: string
  cronExpression: string | null
  runAt: Date | null
  maxAttempts: number
  backoffMs: number
}): JobsOptions {
  const base: JobsOptions = {
    jobId: `task-${task.id}`,
    attempts: task.maxAttempts,
    backoff: {
      type: 'exponential',
      delay: task.backoffMs
    },
    removeOnComplete: 200,
    removeOnFail: 500
  }
  if (task.cronExpression) {
    return {
      ...base,
      repeat: {
        pattern: task.cronExpression
      }
    }
  }
  if (task.runAt) {
    const delay = Math.max(task.runAt.getTime() - Date.now(), 0)
    return {
      ...base,
      delay
    }
  }
  return base
}

export async function enqueueTask(taskId: string): Promise<void> {
  const taskQueue = getTaskQueue()
  const task = await prisma.scheduledTask.findUniqueOrThrow({
    where: { id: taskId }
  })
  const opts = getJobOptions(task)
  const job = await taskQueue.add(task.type, { taskId: task.id }, opts)
  await prisma.scheduledTask.update({
    where: { id: task.id },
    data: {
      queueJobId: job.id,
      nextRunAt: task.runAt
    }
  })
}

export async function createTask(input: CreateTaskInput) {
  const task = await prisma.scheduledTask.create({
    data: {
      name: input.name,
      type: input.type,
      payload: input.payload as Prisma.InputJsonValue,
      cronExpression: input.cronExpression ?? null,
      runAt: input.runAt ? new Date(input.runAt) : null,
      status: TaskStatus.READY,
      maxAttempts: input.maxAttempts ?? 3,
      backoffMs: input.backoffMs ?? 5000
    }
  })
  // 尝试加入队列，如果 Redis 不可用则跳过
  try {
    await enqueueTask(task.id)
  } catch (error) {
    console.warn('Failed to enqueue task, skipping queue:', error)
  }
  return task
}

export async function triggerTask(taskId: string) {
  const taskQueue = getTaskQueue()
  const task = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: taskId } })
  if (task.status === TaskStatus.CANCELLED) {
    throw new Error('Task is cancelled')
  }
  const job = await taskQueue.add(task.type, { taskId: task.id }, {
    attempts: task.maxAttempts,
    backoff: {
      type: 'exponential',
      delay: task.backoffMs
    },
    removeOnComplete: 200,
    removeOnFail: 500
  })
  return { jobId: job.id }
}

export async function pauseTask(taskId: string) {
  const taskQueue = getTaskQueue()
  const task = await prisma.scheduledTask.update({
    where: { id: taskId },
    data: { status: TaskStatus.PAUSED }
  })
  if (task.queueJobId) {
    const job = await taskQueue.getJob(task.queueJobId)
    await job?.remove()
  }
  return task
}

export async function resumeTask(taskId: string) {
  const task = await prisma.scheduledTask.update({
    where: { id: taskId },
    data: { status: TaskStatus.READY }
  })
  await enqueueTask(task.id)
  return task
}

export async function cancelTask(taskId: string) {
  const taskQueue = getTaskQueue()
  const task = await prisma.scheduledTask.update({
    where: { id: taskId },
    data: { status: TaskStatus.CANCELLED }
  })
  if (task.cronExpression) {
    await taskQueue.removeRepeatable(task.type, { pattern: task.cronExpression }, `task-${task.id}`)
  }
  if (task.queueJobId) {
    const job = await taskQueue.getJob(task.queueJobId)
    await job?.remove()
  }
  return task
}

type GetTaskListInput = {
  page?: number
  pageSize?: number
}

export async function getTaskList(input: GetTaskListInput = {}) {
  const startTime = Date.now()
  const page = Math.max(input.page ?? 1, 1)
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 100)
  const skip = (page - 1) * pageSize
  console.log('[getTaskList] Start fetching tasks...')
  
  try {
    const [tasks, total] = await prisma.$transaction([
      prisma.scheduledTask.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.scheduledTask.count()
    ])
    const duration = Date.now() - startTime
    console.log(`[getTaskList] Fetched ${tasks.length} tasks in ${duration}ms (page=${page}, pageSize=${pageSize})`)
    return {
      items: tasks,
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1)
    }
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[getTaskList] Failed after ${duration}ms:`, error)
    return {
      items: [],
      page,
      pageSize,
      total: 0,
      totalPages: 0
    }
  }
}

export async function getTaskExecutions(taskId: string) {
  return prisma.taskExecution.findMany({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
    take: 200
  })
}

export async function getQueueOverview() {
  const taskQueue = getTaskQueue()
  return taskQueue.getJobCounts('active', 'completed', 'delayed', 'failed', 'paused', 'waiting')
}

export async function markTaskRunning(taskId: string) {
  return prisma.scheduledTask.update({
    where: { id: taskId },
    data: {
      status: TaskStatus.RUNNING,
      lastRunAt: new Date(),
      attempts: {
        increment: 1
      }
    }
  })
}

export async function markTaskSuccess(taskId: string, result: Record<string, unknown>) {
  return prisma.scheduledTask.update({
    where: { id: taskId },
    data: {
      status: TaskStatus.READY,
      lastError: null,
      lastResult: result as Prisma.InputJsonValue
    }
  })
}

export async function markTaskFailed(taskId: string, error: string) {
  return prisma.scheduledTask.update({
    where: { id: taskId },
    data: {
      status: TaskStatus.FAILED,
      lastError: error
    }
  })
}

export async function fetchTaskByJob(job: Job): Promise<{ id: string, name: string, type: TaskType, payload: Record<string, unknown> } | null> {
  const taskId = String(job.data.taskId)
  const task = await prisma.scheduledTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      name: true,
      type: true,
      payload: true
    }
  })
  if (!task) {
    return null
  }
  return task as { id: string, name: string, type: TaskType, payload: Record<string, unknown> }
}
