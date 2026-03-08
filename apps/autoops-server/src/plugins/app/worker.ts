import fp from 'fastify-plugin'
import { closeQueueEvents, closeTaskQueue } from '../../lib/queue'
import { startTaskWorker } from '../../workers/task-worker'

export default fp(async (fastify) => {
  if (process.env.NODE_ENV === 'test') {
    return
  }
  if (process.env.ENABLE_WORKER === 'false') {
    return
  }

  const { worker } = await startTaskWorker()
  
  if (worker) {
    fastify.log.info('embedded worker started')

    fastify.addHook('onClose', async () => {
      await worker.close()
      await closeQueueEvents()
      await closeTaskQueue()
    })
  } else {
    fastify.log.warn('embedded worker not started (Redis not available)')
  }
})
