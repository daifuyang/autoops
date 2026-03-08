import fp from 'fastify-plugin'
import multipart from '@fastify/multipart'

export default fp(async (fastify) => {
  const maxBytes = Number(process.env.DEPLOY_UPLOAD_MAX_BYTES || 1024 * 1024 * 1024)
  fastify.register(multipart, {
    limits: {
      fileSize: maxBytes
    }
  })
})
