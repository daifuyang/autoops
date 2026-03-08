import Fastify, { FastifyInstance } from 'fastify'
import app from './app'
import { config } from './config'

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: true
  })

  await server.register(app)
  return server
}

async function start(): Promise<void> {
  const server = await buildServer()
  await server.listen({
    host: '0.0.0.0',
    port: 3000
  })
  server.log.info(`api is running, queue=${config.queue.name}`)

  const shutdown = async (signal: string): Promise<void> => {
    server.log.info(`${signal} received, shutting down`)
    await server.close()
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

start().catch((error) => {
  console.error(error)
  process.exit(1)
})
