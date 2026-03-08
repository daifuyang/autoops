import { providerFactory } from './provider.factory'
import { AliyunAdapter } from './adapters/aliyun.adapter'

// 注册内置适配器
export function registerBuiltinProviders() {
  providerFactory.register(new AliyunAdapter())
}

export * from './types'
export { providerFactory }
