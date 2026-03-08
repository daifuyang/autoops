import { FastifyRequest, FastifyReply } from 'fastify'

export class AppError extends Error {
  constructor(
    public code: number,
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }
}

// 全局错误处理中间件
export function errorHandler(error: Error, req: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    reply.status(200).send({
      code: error.code,
      success: false,
      msg: error.message,
      data: null
    })
  } else {
    reply.status(200).send({
      code: 1006,
      success: false,
      msg: error.message || '服务器内部错误',
      data: null
    })
  }
}
