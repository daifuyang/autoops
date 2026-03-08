import { TaskExecutionContext, TaskExecutionResult, TaskHandler, TaskPayload, TaskType } from './types'
import { CertificateService } from '../certificates/cert.service'
import { prisma } from '../lib/prisma'
import { executeHealthCheck, scheduleHealthCheckTask } from '../health-checks/service'
import { sendEmailWithActiveConfig } from '../email/service'
import { executeDeploymentTask } from '../deployments/service'

const certService = new CertificateService()

class NotifyTaskHandler implements TaskHandler {
  canHandle(type: TaskType): boolean {
    return type === 'NOTIFY'
  }

  async execute(payload: TaskPayload, context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const notifyPayload = payload as {
      notificationId?: string
      title?: string
      level?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR'
      channel?: string
      recipient?: string
      message: string
    }
    const channel = (notifyPayload.channel || 'IN_APP').toUpperCase()
    const title = notifyPayload.title || `系统通知(${channel})`
    let notification = notifyPayload.notificationId
      ? await prisma.notification.findUnique({ where: { id: notifyPayload.notificationId } })
      : null
    if (!notification) {
      notification = await prisma.notification.create({
        data: {
          title,
          message: notifyPayload.message,
          level: notifyPayload.level || 'INFO',
          source: 'SYSTEM',
          status: 'PENDING',
          channel,
          recipient: notifyPayload.recipient || null,
          metadata: {
            traceId: context.traceId,
            taskId: context.taskId
          } as any
        }
      })
    }
    try {
      if (channel === 'EMAIL') {
        if (!notification.recipient) {
          throw new Error('EMAIL 通知缺少 recipient')
        }
        await sendEmailWithActiveConfig({
          to: notification.recipient,
          subject: notification.title,
          text: notification.message
        })
      }
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          lastError: null
        }
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '通知发送失败'
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          lastError: errMsg
        }
      })
      throw err
    }
    return {
      success: true,
      summary: `notify:${channel}:${notification.recipient ?? '-'}`,
      data: {
        notificationId: notification.id,
        message: notification.message,
        traceId: context.traceId
      }
    }
  }
}

class SmsTaskHandler implements TaskHandler {
  canHandle(type: TaskType): boolean {
    return type === 'SMS'
  }

  async execute(payload: TaskPayload, context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const smsPayload = payload as { phoneNumber: string, template: string, params?: Record<string, string> }
    return {
      success: true,
      summary: `sms:${smsPayload.phoneNumber}:${smsPayload.template}`,
      data: {
        params: smsPayload.params ?? {},
        traceId: context.traceId
      }
    }
  }
}

class HttpsIssueTaskHandler implements TaskHandler {
  canHandle(type: TaskType): boolean {
    return type === 'HTTPS_ISSUE'
  }

  async execute(payload: TaskPayload, context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const issuePayload = payload as { endpoint: string, method?: 'POST' | 'PUT', body: Record<string, unknown> }
    const response = await fetch(issuePayload.endpoint, {
      method: issuePayload.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        'x-trace-id': context.traceId
      },
      body: JSON.stringify(issuePayload.body)
    })
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`HTTPS_ISSUE failed: ${response.status} ${body}`)
    }
    return {
      success: true,
      summary: `https:${issuePayload.method ?? 'POST'}:${issuePayload.endpoint}`,
      data: {
        status: response.status,
        body
      }
    }
  }
}

class CertIssueTaskHandler implements TaskHandler {
  canHandle(type: TaskType): boolean {
    return type === 'CERT_ISSUE' || type === 'CERT_RENEW'
  }

  async execute(payload: TaskPayload, context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const certPayload = payload as { certificateId: string }

    const result = await certService.issueCertificate({ certificateId: certPayload.certificateId })

    return {
      success: true,
      summary: `cert:${context.traceId}:${certPayload.certificateId}`,
      data: {
        certificateId: certPayload.certificateId,
        expiresAt: result.expiresAt,
        traceId: context.traceId
      }
    }
  }
}

class HealthCheckTaskHandler implements TaskHandler {
  canHandle(type: TaskType): boolean {
    return type === 'HEALTH_CHECK'
  }

  async execute(payload: TaskPayload, context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const healthPayload = payload as { healthCheckId: string }
    const check = await prisma.healthCheck.findUnique({ where: { id: healthPayload.healthCheckId } })
    if (!check) {
      return {
        success: true,
        summary: `health-check:missing:${healthPayload.healthCheckId}`,
        data: { traceId: context.traceId }
      }
    }
    const log = await executeHealthCheck(healthPayload.healthCheckId)
    if (check.isActive) {
      await scheduleHealthCheckTask(check.id, check.interval)
    }
    return {
      success: true,
      summary: `health-check:${check.id}:${log?.status ?? 'UNKNOWN'}`,
      data: {
        healthCheckId: check.id,
        status: log?.status ?? 'UNKNOWN',
        responseTime: log?.responseTime ?? null,
        traceId: context.traceId
      }
    }
  }
}

class EmailSendTaskHandler implements TaskHandler {
  canHandle(type: TaskType): boolean {
    return type === 'EMAIL_SEND'
  }

  async execute(payload: TaskPayload, context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const emailPayload = payload as { to: string; subject: string; text?: string; html?: string }
    const result = await sendEmailWithActiveConfig({
      to: emailPayload.to,
      subject: emailPayload.subject,
      text: emailPayload.text,
      html: emailPayload.html
    })
    return {
      success: true,
      summary: `email:${emailPayload.to}:${emailPayload.subject}`,
      data: {
        accepted: result.accepted,
        rejected: result.rejected,
        traceId: context.traceId
      }
    }
  }
}

class DeployExecuteTaskHandler implements TaskHandler {
  canHandle(type: TaskType): boolean {
    return type === 'DEPLOY_EXECUTE'
  }

  async execute(payload: TaskPayload): Promise<TaskExecutionResult> {
    const deployPayload = payload as { deploymentRecordId: string }
    return executeDeploymentTask({
      deploymentRecordId: deployPayload.deploymentRecordId
    })
  }
}

const handlers: TaskHandler[] = [
  new NotifyTaskHandler(),
  new SmsTaskHandler(),
  new HttpsIssueTaskHandler(),
  new CertIssueTaskHandler(),
  new HealthCheckTaskHandler(),
  new EmailSendTaskHandler(),
  new DeployExecuteTaskHandler()
]

export function resolveTaskHandler(type: TaskType): TaskHandler {
  const handler = handlers.find((item) => item.canHandle(type))
  if (!handler) {
    throw new Error(`No handler for task type: ${type}`)
  }
  return handler
}
