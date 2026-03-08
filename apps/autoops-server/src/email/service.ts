import nodemailer from 'nodemailer'
import { prisma } from '../lib/prisma'

type EmailConfigAuth = {
  user?: string
  pass?: string
}

export type EmailConfigView = {
  id: string
  name: string
  host: string
  port: number
  secure: boolean
  from: string
  fromName: string | null
  isActive: boolean
  authUser: string
  hasPassword: boolean
  createdAt: Date
  updatedAt: Date
}

function parseAuth(auth: unknown): EmailConfigAuth {
  if (!auth || typeof auth !== 'object') return {}
  const source = auth as Record<string, unknown>
  return {
    user: typeof source.user === 'string' ? source.user : undefined,
    pass: typeof source.pass === 'string' ? source.pass : undefined
  }
}

export function sanitizeEmailConfig(config: {
  id: string
  name: string
  host: string
  port: number
  secure: boolean
  auth: unknown
  from: string
  fromName: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}): EmailConfigView {
  const auth = parseAuth(config.auth)
  return {
    id: config.id,
    name: config.name,
    host: config.host,
    port: config.port,
    secure: config.secure,
    from: config.from,
    fromName: config.fromName,
    isActive: config.isActive,
    authUser: auth.user || '',
    hasPassword: Boolean(auth.pass),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  }
}

export async function sendEmailWithActiveConfig(input: {
  to: string
  subject: string
  text?: string
  html?: string
}) {
  const config = await prisma.emailConfig.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: 'desc' }
  })
  if (!config) {
    throw new Error('未找到启用的邮件配置')
  }
  const auth = parseAuth(config.auth)
  if (!auth.user || !auth.pass) {
    throw new Error('邮件配置缺少认证信息')
  }
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: auth.user,
      pass: auth.pass
    }
  })
  const result = await transporter.sendMail({
    from: config.fromName ? `"${config.fromName}" <${config.from}>` : config.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html
  })
  return {
    messageId: result.messageId,
    accepted: result.accepted,
    rejected: result.rejected
  }
}

export async function sendEmailWithConfig(configId: string, input: {
  to: string
  subject: string
  text?: string
  html?: string
}) {
  const config = await prisma.emailConfig.findUnique({ where: { id: configId } })
  if (!config) {
    throw new Error('邮件配置不存在')
  }
  const auth = parseAuth(config.auth)
  if (!auth.user || !auth.pass) {
    throw new Error('邮件配置缺少认证信息')
  }
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: auth.user,
      pass: auth.pass
    }
  })
  const result = await transporter.sendMail({
    from: config.fromName ? `"${config.fromName}" <${config.from}>` : config.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html
  })
  return {
    messageId: result.messageId,
    accepted: result.accepted,
    rejected: result.rejected
  }
}
