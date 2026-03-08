import Core = require('@alicloud/pop-core')
import {
  DnsProviderAdapter,
  CdnProviderAdapter,
  ProviderCategory,
  DnsService,
  CdnService,
  DnsRecord,
  TestResult,
  FieldDef
} from '../types'

export class AliyunAdapter implements DnsProviderAdapter, CdnProviderAdapter {
  readonly type = 'aliyun'
  readonly name = '阿里云'
  readonly category = ProviderCategory.CLOUD
  readonly capabilities = ['dns_manage', 'cdn_deploy', 'fc_deploy']

  readonly credentialFields: FieldDef[] = [
    { name: 'accessKeyId', label: 'AccessKey ID', type: 'text', required: true },
    { name: 'accessKeySecret', label: 'AccessKey Secret', type: 'password', required: true }
  ]

  readonly configFields: FieldDef[] = [
    { name: 'region', label: '地域', type: 'select', options: ['cn-hangzhou', 'cn-beijing', 'cn-shanghai'], required: false }
  ]

  async test(credentials: Record<string, string>): Promise<TestResult> {
    try {
      const client = new Core({
        accessKeyId: credentials.accessKeyId,
        accessKeySecret: credentials.accessKeySecret,
        endpoint: 'https://alidns.aliyuncs.com',
        apiVersion: '2015-01-09'
      })

      // 调用 DescribeDomains 测试连通性
      await client.request('DescribeDomains', {}, { method: 'POST' })

      return { success: true, message: '连接成功' }
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败'
      return { success: false, message }
    }
  }

  createDnsService(credentials: Record<string, string>): DnsService {
    return new AliyunDnsService(credentials)
  }

  createCdnService(credentials: Record<string, string>): CdnService {
    return new AliyunCdnService(credentials)
  }
}

class AliyunDnsService implements DnsService {
  private client: Core

  constructor(credentials: Record<string, string>) {
    this.client = new Core({
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      endpoint: 'https://alidns.aliyuncs.com',
      apiVersion: '2015-01-09'
    })
  }

  async addTxtRecord(domain: string, rr: string, value: string): Promise<string> {
    const result = await this.client.request('AddDomainRecord', {
      DomainName: domain,
      RR: rr,
      Type: 'TXT',
      Value: value
    }, { method: 'POST' }) as any

    return result.RecordId
  }

  async deleteRecord(recordId: string): Promise<void> {
    await this.client.request('DeleteDomainRecord', {
      RecordId: recordId
    }, { method: 'POST' })
  }

  async describeRecords(domain: string, rr?: string, type?: string): Promise<DnsRecord[]> {
    const params: Record<string, string> = {
      DomainName: domain
    }
    if (rr) params.RRKeyWord = rr
    if (type) params.TypeKeyWord = type

    const result = await this.client.request('DescribeDomainRecords', params, { method: 'POST' }) as any

    const records = result.DomainRecords?.Record || []
    return records.map((r: any) => ({
      recordId: r.RecordId,
      rr: r.RR,
      type: r.Type,
      value: r.Value
    }))
  }
}

class AliyunCdnService implements CdnService {
  private client: Core

  constructor(credentials: Record<string, string>) {
    this.client = new Core({
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      endpoint: 'https://cdn.aliyuncs.com',
      apiVersion: '2018-05-10'
    })
  }

  async uploadCert(domain: string, certPem: string, keyPem: string): Promise<void> {
    await this.client.request('SetCdnDomainSSLCertificate', {
      DomainName: domain,
      SSLProtocol: 'on',
      SSLOpt: '1',
      CertType: 'upload',
      SSLPub: certPem,
      SSLPri: keyPem
    }, { method: 'POST' })
  }

  async deployCert(domain: string, certId: string): Promise<void> {
    // 阿里云 CDN 在上传时已经部署，这里可以添加额外的验证逻辑
  }
}
