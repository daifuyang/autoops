import { FastifyPluginAsync } from 'fastify'
import { compare, hash } from 'bcrypt'
import { sign, verify } from 'jsonwebtoken'
import { success, errors } from '../../../../common/response'
import { apiResponseSchema } from '../../../../common/response-schema'
import { prisma } from '../../../../lib/prisma'

// JWT 配置
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production'
const JWT_EXPIRES_IN = '7d'
const AUTH_COOKIE_NAME = 'autoops_token'
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7

// 默认管理员配置（从环境变量读取）
const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME || 'admin'
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123'

type JwtPayload = {
  userId: string
}

// 初始化默认管理员
async function initDefaultAdmin() {
  const existingAdmin = await prisma.userAccount.findUnique({
    where: { username: DEFAULT_ADMIN_USERNAME }
  })
  if (!existingAdmin) {
    await prisma.userAccount.create({
      data: {
        username: DEFAULT_ADMIN_USERNAME,
        passwordHash: await hash(DEFAULT_ADMIN_PASSWORD, 10),
        role: 'admin',
        isActive: true
      }
    })
    console.log(`[Auth] Default admin user created: ${DEFAULT_ADMIN_USERNAME}`)
  }
}

function buildAuthCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_COOKIE_MAX_AGE}${secure}`
}

function buildClearAuthCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

function getTokenFromCookie(cookieHeader?: string): string | null {
  if (!cookieHeader) return null
  const segments = cookieHeader.split(';').map((part) => part.trim())
  const found = segments.find((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`))
  if (!found) return null
  const raw = found.slice(`${AUTH_COOKIE_NAME}=`.length)
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

const auth: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  // 初始化默认管理员
  await initDefaultAdmin()

  fastify.addSchema({
    $id: 'AuthUser',
    type: 'object',
    properties: {
      id: { type: 'string' },
      username: { type: 'string' },
      role: { type: 'string' }
    },
    required: ['id', 'username', 'role']
  })
  fastify.addSchema({
    $id: 'AuthLoginData',
    type: 'object',
    properties: {
      token: { type: 'string', description: 'JWT Token' },
      user: { $ref: 'AuthUser#' }
    },
    required: ['token', 'user']
  })

  // 登录接口
  fastify.post('/login', {
    schema: {
      operationId: 'login',
      tags: ['Auth'],
      summary: '用户登录',
      description: '使用用户名和密码登录，返回 JWT Token',
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, description: '用户名' },
          password: { type: 'string', minLength: 1, description: '密码' }
        }
      },
      response: {
        200: {
          ...apiResponseSchema({ $ref: 'AuthLoginData#' }),
          required: ['code', 'success', 'msg', 'data']
        }
      }
    }
  }, async (request, reply) => {
    const { username, password } = request.body as { username: string; password: string }

    // 查找用户
      const user = await prisma.userAccount.findUnique({
        where: { username }
      })
    if (!user) {
      return errors.unauthorized('用户名或密码错误')
    }
      if (!user.isActive) {
        return errors.forbidden('账号已禁用')
      }

    // 验证密码
    const isValid = await compare(password, user.passwordHash)
    if (!isValid) {
      return errors.unauthorized('用户名或密码错误')
    }

    // 生成 JWT Token
    const token = sign(
      { 
        userId: user.id, 
        username: user.username, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )
    reply.header('Set-Cookie', buildAuthCookie(token))

    return success({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    }, '登录成功')
  })

  // 获取当前用户信息
  fastify.get('/me', {
    schema: {
      operationId: 'getCurrentUser',
      tags: ['Auth'],
      summary: '获取当前用户信息',
      description: '使用 JWT Token 获取当前登录用户信息',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          ...apiResponseSchema({ $ref: 'AuthUser#' }),
          required: ['code', 'success', 'msg', 'data']
        }
      }
    }
  }, async (request, reply) => {
    try {
      const token = getTokenFromCookie(request.headers.cookie)
      if (!token) {
        return errors.unauthorized('未授权')
      }
      const decoded = verify(token, JWT_SECRET) as JwtPayload

      const user = await prisma.userAccount.findUnique({
        where: { id: decoded.userId }
      })
      if (!user) {
        return errors.unauthorized('用户不存在')
      }
      if (!user.isActive) {
        return errors.forbidden('账号已禁用')
      }

      return success({
        id: user.id,
        username: user.username,
        role: user.role
      })
    } catch (err) {
      return errors.unauthorized('Token 无效或已过期')
    }
  })

  // 退出登录
  fastify.post('/logout', {
    schema: {
      operationId: 'logout',
      tags: ['Auth'],
      summary: '退出登录',
      description: '用户退出登录',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          ...apiResponseSchema({
            type: 'object',
            nullable: true,
            description: '返回数据，通常为 null'
          }),
          required: ['code', 'success', 'msg']
        }
      }
    }
  }, async (request, reply) => {
    reply.header('Set-Cookie', buildClearAuthCookie())
    return success(null, '退出成功')
  })

  // 修改密码
  fastify.post('/change-password', {
    schema: {
      operationId: 'changePassword',
      tags: ['Auth'],
      summary: '修改密码',
      description: '修改当前用户密码',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['oldPassword', 'newPassword'],
        properties: {
          oldPassword: { type: 'string', minLength: 1, description: '原密码' },
          newPassword: { type: 'string', minLength: 6, description: '新密码（至少6位）' }
        }
      },
      response: {
        200: {
          ...apiResponseSchema({
            type: 'object',
            nullable: true,
            description: '返回数据，通常为 null'
          }),
          required: ['code', 'success', 'msg']
        }
      }
    }
  }, async (request, reply) => {
    try {
      const token = getTokenFromCookie(request.headers.cookie)
      if (!token) {
        return errors.unauthorized('未授权')
      }
      const decoded = verify(token, JWT_SECRET) as JwtPayload

      const user = await prisma.userAccount.findUnique({
        where: { id: decoded.userId }
      })
      if (!user) {
        return errors.unauthorized('用户不存在')
      }
      if (!user.isActive) {
        return errors.forbidden('账号已禁用')
      }

      const { oldPassword, newPassword } = request.body as { oldPassword: string; newPassword: string }

      // 验证旧密码
      const isValid = await compare(oldPassword, user.passwordHash)
      if (!isValid) {
        return errors.badRequest('原密码错误')
      }

      // 更新密码
      await prisma.userAccount.update({
        where: { id: user.id },
        data: {
          passwordHash: await hash(newPassword, 10)
        }
      })

      return success(null, '密码修改成功')
    } catch (err) {
      return errors.unauthorized('Token 无效或已过期')
    }
  })
}

export default auth
