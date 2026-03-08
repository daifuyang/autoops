import 'dotenv/config'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

// 解析 DATABASE_URL
function parseDatabaseUrl(): { host: string; port: number; user: string; password: string; name: string } {
  const url = requiredEnv('DATABASE_URL')
  const dbUrl = new URL(url)
  return {
    host: dbUrl.hostname,
    port: parseInt(dbUrl.port) || 3306,
    user: dbUrl.username,
    password: dbUrl.password,
    name: dbUrl.pathname.slice(1) // 去掉开头的 /
  }
}

const dbConfig = parseDatabaseUrl()

export const config = {
  database: {
    url: requiredEnv('DATABASE_URL'),
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    name: dbConfig.name
  },
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    db: Number(process.env.REDIS_DB ?? 0),
    password: process.env.REDIS_PASSWORD
  },
  queue: {
    name: process.env.QUEUE_NAME ?? 'autoops'
  },
  worker: {
    name: process.env.WORKER_NAME ?? 'autoops-worker-1',
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5)
  }
}
