export type TaskType = 'NOTIFY' | 'SMS' | 'HTTPS_ISSUE' | 'CERT_ISSUE' | 'CERT_RENEW' | 'HEALTH_CHECK' | 'EMAIL_SEND' | 'DEPLOY_EXECUTE'

export interface NotifyPayload {
  notificationId?: string
  title?: string
  level?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR'
  channel: 'IN_APP' | 'EMAIL' | 'WEBHOOK'
  recipient?: string
  message: string
}

export interface SmsPayload {
  phoneNumber: string
  template: string
  params?: Record<string, string>
}

export interface HttpsIssuePayload {
  endpoint: string
  method?: 'POST' | 'PUT'
  body: Record<string, unknown>
}

export interface CertIssuePayload {
  certificateId: string
}

export interface HealthCheckPayload {
  healthCheckId: string
}

export interface EmailSendPayload {
  to: string
  subject: string
  text?: string
  html?: string
}

export interface DeployExecutePayload {
  deploymentRecordId: string
}

export type TaskPayload = NotifyPayload | SmsPayload | HttpsIssuePayload | CertIssuePayload | HealthCheckPayload | EmailSendPayload | DeployExecutePayload

export interface TaskExecutionContext {
  taskId: string
  executionId: string
  attempt: number
  workerName: string
  traceId: string
}

export interface TaskExecutionResult {
  success: boolean
  summary: string
  data?: Record<string, unknown>
}

export interface TaskHandler {
  canHandle(type: TaskType): boolean
  execute(payload: TaskPayload, context: TaskExecutionContext): Promise<TaskExecutionResult>
}
