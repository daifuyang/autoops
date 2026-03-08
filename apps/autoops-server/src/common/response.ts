export interface ApiResponse<T = unknown> {
  code: number
  success: boolean
  msg: string
  data: T | null
}

export function success<T>(data: T, msg = '操作成功'): ApiResponse<T> {
  return { code: 1, success: true, msg, data }
}

export function error(code: number, msg: string): ApiResponse<null> {
  return { code, success: false, msg, data: null }
}

// 常用错误快捷方法
export const errors = {
  badRequest: (msg = '参数错误') => error(1001, msg),
  unauthorized: (msg = '未授权') => error(1002, msg),
  forbidden: (msg = '禁止访问') => error(1003, msg),
  notFound: (msg = '资源不存在') => error(1004, msg),
  conflict: (msg = '资源冲突') => error(1005, msg),
  internal: (msg = '服务器内部错误') => error(1006, msg),
  providerError: (msg = '服务商 API 调用失败') => error(2001, msg),
  dnsError: (msg = 'DNS 验证失败') => error(2002, msg),
  certError: (msg = '证书签发失败') => error(2003, msg),
  healthError: (msg = '健康检查失败') => error(2004, msg),
  emailError: (msg = '邮件发送失败') => error(2005, msg)
}
