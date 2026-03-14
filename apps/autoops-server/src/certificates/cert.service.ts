import * as acme from 'acme-client'
import { providerFactory } from '../providers'
import { AppError } from '../common/error'
import { prisma } from '../lib/prisma'
import { syncNginxTlsBindingsByCertificate } from '../deployments/service'

export interface IssueCertificateInput {
  certificateId: string
}

export class CertificateService {
  async issueCertificate(input: IssueCertificateInput) {
    const { certificateId } = input

    const certificate = await prisma.certificate.findUnique({
      where: { id: certificateId },
      include: { dnsProvider: true }
    })

    if (!certificate) {
      throw new AppError(1004, '证书不存在')
    }

    // 更新状态为签发中
    await prisma.certificate.update({
      where: { id: certificateId },
      data: { status: 'ISSUING' }
    })

    // 创建日志
    await prisma.certLog.create({
      data: {
        certificateId,
        action: 'issue',
        status: 'pending',
        message: '开始签发证书'
      }
    })

    try {
      // 获取 DNS 服务商适配器
      const dnsAdapter = providerFactory.getDnsAdapter(certificate.dnsProvider.type)
      if (!dnsAdapter) {
        throw new AppError(2001, `不支持的 DNS 服务商: ${certificate.dnsProvider.type}`)
      }

      const dnsService = dnsAdapter.createDnsService(
        certificate.dnsProvider.credentials as Record<string, string>
      )

      // ACME 申请证书
      const result = await this.acmeIssue({
        domain: certificate.domain,
        wildcard: certificate.wildcard,
        sanDomains: certificate.sanDomains as string[] || [],
        dnsService
      })

      // 更新证书信息
      await prisma.certificate.update({
        where: { id: certificateId },
        data: {
          certPem: result.certificate,
          keyPem: result.privateKey,
          chainPem: result.chain,
          status: 'ACTIVE',
          issuedAt: new Date(),
          expiresAt: result.expiresAt
        }
      })

      // 更新日志
      await prisma.certLog.create({
        data: {
          certificateId,
          action: 'issue',
          status: 'success',
          message: '证书签发成功',
          details: { expiresAt: result.expiresAt }
        }
      })

      // 如果有部署目标，自动部署
      if (certificate.deployTarget && certificate.deployTarget !== 'manual') {
        await this.deployCertificate(certificateId)
      }

      const syncResults = await syncNginxTlsBindingsByCertificate(certificateId)
      if (syncResults.length > 0) {
        const failed = syncResults.filter((item) => !item.success)
        await prisma.certLog.create({
          data: {
            certificateId,
            action: 'deploy',
            status: failed.length === 0 ? 'success' : 'failed',
            message: failed.length === 0 ? '已同步绑定项目 Nginx 证书配置' : '部分绑定项目 Nginx 证书配置同步失败',
            details: syncResults as never
          }
        })
      }

      return result
    } catch (error) {
      // 更新状态为错误
      await prisma.certificate.update({
        where: { id: certificateId },
        data: {
          status: 'ERROR'
        }
      })

      // 记录错误日志
      await prisma.certLog.create({
        data: {
          certificateId,
          action: 'issue',
          status: 'failed',
          message: error instanceof Error ? error.message : '签发失败'
        }
      })

      throw error
    }
  }

  private async acmeIssue(params: {
    domain: string
    wildcard: boolean
    sanDomains: string[]
    dnsService: any
  }) {
    const { domain, wildcard, sanDomains, dnsService } = params

    const accountKey = await (acme as any).crypto.createPrivateKey()
    const client = new (acme as any).Client({
      directoryUrl: this.getAcmeDirectoryUrl(),
      accountKey
    })

    // 创建账户
    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [this.getAcmeContact(domain)]
    })

    // 准备域名列表
    const domains = wildcard ? [`*.${domain}`] : [domain]
    if (sanDomains.length > 0) {
      domains.push(...sanDomains)
    }

    // 创建订单
    const order = await client.createOrder({
      identifiers: domains.map(d => ({ type: 'dns', value: d }))
    })

    // 获取授权和挑战
    const authorizations = await client.getAuthorizations(order)
    const dnsRecords: Array<{ recordId: string; domain: string; rr: string }> = []

    try {
      // 处理每个授权
      for (const authz of authorizations) {
        const challenge = authz.challenges.find((c: any) => c.type === 'dns-01')
        if (!challenge) {
          throw new Error('DNS-01 challenge not found')
        }

        // 获取 DNS 验证密钥
        const keyAuthorization = await client.getChallengeKeyAuthorization(challenge)

        // 解析域名获取根域名和主机记录
        const { rootDomain, rr } = this.parseDomain(authz.identifier.value)

        // 添加 TXT 记录
        const recordId = await dnsService.addTxtRecord(rootDomain, rr, keyAuthorization)

        dnsRecords.push({ recordId, domain: rootDomain, rr })
      }

      // 等待 DNS 传播
      await new Promise(resolve => setTimeout(resolve, 30000))

      // 完成挑战
      for (const authz of authorizations) {
        const challenge = authz.challenges.find((c: any) => c.type === 'dns-01')!
        await client.completeChallenge(challenge)
        await client.waitForValidStatus(challenge)
      }

      const [privateKey, csr] = await (acme as any).crypto.createCsr({
        commonName: domains[0],
        altNames: domains.slice(1)
      })

      // 等待订单完成
      await client.finalizeOrder(order, csr)
      const cert = await client.getCertificate(order)

      // 解析证书信息
      const certInfo = await (acme as any).crypto.readCertificateInfo(cert)

      return {
        certificate: cert,
        privateKey: Buffer.isBuffer(privateKey) ? privateKey.toString() : String(privateKey),
        chain: '', // 可以从 cert 中提取
        expiresAt: certInfo.notAfter
      }
    } finally {
      // 清理 DNS 记录
      for (const record of dnsRecords) {
        try {
          await dnsService.deleteRecord(record.recordId)
        } catch (error) {
          console.error('Failed to delete DNS record:', error)
        }
      }
    }
  }

  private parseDomain(domain: string): { rootDomain: string; rr: string } {
    // 移除通配符前缀
    const cleanDomain = domain.replace(/^\*\./, '')

    // 分割域名
    const parts = cleanDomain.split('.')

    if (parts.length < 2) {
      throw new Error(`Invalid domain: ${domain}`)
    }

    // 根域名（最后两部分）
    const rootDomain = parts.slice(-2).join('.')

    // 主机记录
    const subDomain = parts.slice(0, -2).join('.')
    const rr = subDomain ? `_acme-challenge.${subDomain}` : '_acme-challenge'

    return { rootDomain, rr }
  }

  private getAcmeContact(domain: string): string {
    const envContact = (process.env.ACME_CONTACT_EMAIL || '').trim()
    if (envContact) {
      return envContact.startsWith('mailto:') ? envContact : `mailto:${envContact}`
    }
    const cleanDomain = domain.replace(/^\*\./, '')
    return `mailto:admin@${cleanDomain}`
  }

  private getAcmeDirectoryUrl(): string {
    const custom = (process.env.ACME_DIRECTORY_URL || '').trim()
    if (custom) return custom
    const useStaging = (process.env.ACME_USE_STAGING || (process.env.NODE_ENV === 'production' ? 'false' : 'true')).toLowerCase() === 'true'
    return useStaging
      ? (acme as any).directory.letsencrypt.staging
      : (acme as any).directory.letsencrypt.production
  }

  async deployCertificate(certificateId: string) {
    const certificate = await prisma.certificate.findUnique({
      where: { id: certificateId },
      include: { deployProvider: true }
    })

    if (!certificate) {
      throw new AppError(1004, '证书不存在')
    }

    if (!certificate.deployTarget || certificate.deployTarget === 'manual' || !certificate.deployProvider) {
      throw new AppError(1001, '未配置部署目标')
    }

    // 这里实现具体的部署逻辑
    // 根据 deployTarget 调用不同的部署服务

    // 记录部署日志
    await prisma.certLog.create({
      data: {
        certificateId,
        action: 'deploy',
        status: 'success',
        message: `部署到 ${certificate.deployTarget} 成功`
      }
    })
  }

  async checkAndRenewCertificates() {
    const certificates = await prisma.certificate.findMany({
      where: {
        autoRenew: true,
        status: 'ACTIVE',
        expiresAt: {
          lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 天内过期
        }
      }
    })

    for (const certificate of certificates) {
      console.log(`Renewing certificate for ${certificate.domain}`)

      try {
        await this.issueCertificate({ certificateId: certificate.id })
        console.log(`Successfully renewed certificate for ${certificate.domain}`)
      } catch (error) {
        console.error(`Failed to renew certificate for ${certificate.domain}:`, error)
      }
    }

    return certificates.length
  }
}
