export enum ProviderCategory {
  DNS = 'DNS',
  CDN = 'CDN',
  SMTP = 'SMTP',
  CLOUD = 'CLOUD'
}

export interface FieldDef {
  name: string
  label: string
  type: 'text' | 'password' | 'select' | 'number'
  required: boolean
  options?: string[] // for select type
}

export interface ProviderAdapter {
  readonly type: string
  readonly name: string
  readonly category: ProviderCategory
  readonly capabilities: string[]
  readonly credentialFields: FieldDef[]
  readonly configFields?: FieldDef[]

  test(credentials: Record<string, string>): Promise<TestResult>
}

export interface TestResult {
  success: boolean
  message?: string
}

export interface DnsService {
  addTxtRecord(domain: string, rr: string, value: string): Promise<string>
  deleteRecord(recordId: string): Promise<void>
  describeRecords(domain: string, rr?: string, type?: string): Promise<DnsRecord[]>
}

export interface DnsRecord {
  recordId: string
  rr: string
  type: string
  value: string
}

export interface CdnService {
  uploadCert(domain: string, certPem: string, keyPem: string): Promise<void>
  deployCert(domain: string, certId: string): Promise<void>
}

export interface DnsProviderAdapter extends ProviderAdapter {
  createDnsService(credentials: Record<string, string>): DnsService
}

export interface CdnProviderAdapter extends ProviderAdapter {
  createCdnService(credentials: Record<string, string>): CdnService
}
