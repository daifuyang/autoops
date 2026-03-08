import fp from 'fastify-plugin'
import fastifySwaggerUi from '@fastify/swagger-ui'
import fastifySwagger from '@fastify/swagger'

export default fp(async function (fastify) {
  await fastify.register(fastifySwagger, {
    refResolver: {
      buildLocalReference(json, _baseUri, _fragment, i) {
        if (typeof json.$id === 'string' && json.$id.length > 0) {
          return json.$id
        }
        if (typeof json.title === 'string' && json.title.length > 0) {
          return json.title
        }
        if (typeof _fragment === 'string' && _fragment.length > 0) {
          const match = _fragment.match(/\/components\/schemas\/([^/]+)$/)
          if (match?.[1]) {
            return match[1]
          }
        }
        return `def-${i}`
      }
    },
    openapi: {
      info: {
        title: '自动化运维平台 API',
        description: '证书管理、健康检查、邮件推送等功能的 RESTful API',
        version: '1.0.0'
      },
      servers: [
        {
          url: 'http://localhost:3000/api/v1',
          description: '本地开发服务器'
        }
      ],
      tags: [
        { name: 'Auth', description: '用户认证' },
        { name: 'Providers', description: '服务商管理' },
        { name: 'Certificates', description: '证书管理' },
        { name: 'Tasks', description: '任务管理' }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: '请输入 JWT Token，格式: Bearer <token>'
          }
        }
      }
    }
  })

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    }
  })
})
