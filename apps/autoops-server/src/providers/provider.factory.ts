import { ProviderAdapter, DnsProviderAdapter, CdnProviderAdapter, ProviderCategory } from './types'

class ProviderFactory {
  private adapters = new Map<string, ProviderAdapter>()

  register(adapter: ProviderAdapter) {
    this.adapters.set(adapter.type, adapter)
  }

  get(type: string): ProviderAdapter | undefined {
    return this.adapters.get(type)
  }

  getDnsAdapter(type: string): DnsProviderAdapter | undefined {
    const adapter = this.adapters.get(type)
    if (adapter && 'createDnsService' in adapter) {
      return adapter as DnsProviderAdapter
    }
    return undefined
  }

  getCdnAdapter(type: string): CdnProviderAdapter | undefined {
    const adapter = this.adapters.get(type)
    if (adapter && 'createCdnService' in adapter) {
      return adapter as CdnProviderAdapter
    }
    return undefined
  }

  list(): ProviderAdapter[] {
    return Array.from(this.adapters.values())
  }

  listByCategory(category: ProviderCategory): ProviderAdapter[] {
    return this.list().filter(a => a.category === category)
  }
}

export const providerFactory = new ProviderFactory()
