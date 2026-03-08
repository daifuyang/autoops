import { Queue, QueueEvents, Worker } from 'bullmq'
import { config } from '../config'

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  db: config.redis.db,
  password: config.redis.password,
  connectTimeout: 5000, // 5秒连接超时
  maxRetriesPerRequest: null
}

let taskQueue: Queue | null = null
let taskQueueEvents: QueueEvents | null = null
let connectionFailed = false

export function getTaskQueue(): Queue {
  if (!taskQueue) {
    taskQueue = new Queue(config.queue.name, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      }
    })
    
    // 监听连接错误
    taskQueue.on('error', (error) => {
      console.error('Task queue error:', error.message)
      connectionFailed = true
    })
  }
  return taskQueue
}

export function getQueueEvents(): QueueEvents | null {
  if (connectionFailed) return null
  
  if (!taskQueueEvents) {
    try {
      taskQueueEvents = new QueueEvents(config.queue.name, {
        connection
      })
      
      taskQueueEvents.on('error', (error) => {
        console.error('Queue events error:', error.message)
      })
    } catch (error) {
      console.error('Failed to create queue events:', error)
      connectionFailed = true
      return null
    }
  }
  return taskQueueEvents
}

export async function closeQueueEvents(): Promise<void> {
  if (taskQueueEvents) {
    await taskQueueEvents.close()
    taskQueueEvents = null
  }
}

export function createTaskWorker(
  processor: ConstructorParameters<typeof Worker>[1],
  concurrency = config.worker.concurrency
): Worker | null {
  if (connectionFailed) {
    console.warn('Redis connection failed, worker not created')
    return null
  }
  
  try {
    const worker = new Worker(config.queue.name, processor, {
      connection,
      concurrency,
      autorun: true
    })
    
    worker.on('error', (error) => {
      console.error('Worker error:', error.message)
    })
    
    return worker
  } catch (error) {
    console.error('Failed to create worker:', error)
    return null
  }
}

export async function closeTaskQueue(): Promise<void> {
  if (taskQueue) {
    await taskQueue.close()
    taskQueue = null
  }
}

// 检查 Redis 连接状态
export function isRedisConnected(): boolean {
  return !connectionFailed
}
