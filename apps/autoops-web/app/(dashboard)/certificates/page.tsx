"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plus,
  Download,
  RefreshCw,
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  ScrollText,
  Loader2,
  Trash2,
} from "lucide-react";
import {
  getApi,
  CreateCertificateBody,
  GetCertificateDataLogItemSchema,
  ListCertificatesDataItemSchema,
  ListDnsProvidersItemSchema,
  ProviderSchema,
} from "@/generated/api";
import { toast } from "sonner";
import JSZip from "jszip";

type CertificateItem = {
  id: string;
  name: string;
  domain: string;
  wildcard: boolean;
  status: string;
  issuer: string;
  expiresAt: string;
  daysLeft: number;
  autoRenew: boolean;
};

export default function CertificatesPage() {
  const api = useMemo(() => getApi(), []);
  const [certificates, setCertificates] = useState<CertificateItem[]>([]);
  const [dnsProviders, setDnsProviders] = useState<ListDnsProvidersItemSchema[]>([]);
  const [providers, setProviders] = useState<ProviderSchema[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLogDialogOpen, setIsLogDialogOpen] = useState(false);
  const [logCertificateName, setLogCertificateName] = useState("");
  const [logItems, setLogItems] = useState<GetCertificateDataLogItemSchema[]>([]);
  const [isLogLoading, setIsLogLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCertificate, setSelectedCertificate] = useState<CertificateItem | null>(null);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    domain: "",
    wildcard: false,
    dnsProviderId: "",
    autoRenew: true,
  });

  const parseCertificate = (item: ListCertificatesDataItemSchema, index: number): CertificateItem => {
    const expiresAtRaw = item.expiresAt || "";
    const expiresAtDate = expiresAtRaw ? new Date(expiresAtRaw) : null;
    const hasValidExpiry = Boolean(expiresAtDate && !Number.isNaN(expiresAtDate.getTime()));
    const daysLeft = hasValidExpiry
      ? Math.ceil((((expiresAtDate as Date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;
    const statusRaw = (item.status || "").toUpperCase();
    const computedStatus = statusRaw || (daysLeft < 0 ? "EXPIRED" : daysLeft <= 30 ? "EXPIRING" : "ACTIVE");

    return {
      id: String(item.id ?? `cert-${index}`),
      name: item.name || "未命名证书",
      domain: item.domain || "-",
      wildcard: Boolean(item.wildcard),
      status: computedStatus,
      issuer: "Let's Encrypt",
      expiresAt: hasValidExpiry ? (expiresAtDate as Date).toLocaleDateString() : "-",
      daysLeft,
      autoRenew: Boolean(item.autoRenew),
    };
  };

  const fetchCertificates = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.listCertificates({ page: 1, pageSize: 50 });
      const data = response.data?.data;
      const list = Array.isArray(data) ? data : data?.items || [];
      setCertificates(list.map((item, idx) => parseCertificate(item, idx)));
    } catch {
      setError("获取证书列表失败，请检查后端服务");
      setCertificates([]);
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  const fetchDnsProviders = useCallback(async () => {
    try {
      const response = await api.listDnsProviders();
      setDnsProviders(response.data?.data || []);
    } catch {
      setDnsProviders([]);
    }
  }, [api]);

  const fetchProviders = useCallback(async () => {
    try {
      const response = await api.listProviders({ page: 1, pageSize: 100 });
      const data = response.data?.data;
      setProviders(Array.isArray(data) ? data : data?.items || []);
    } catch {
      setProviders([]);
    }
  }, [api]);

  useEffect(() => {
    fetchCertificates();
    fetchDnsProviders();
    fetchProviders();
  }, [fetchCertificates, fetchDnsProviders, fetchProviders]);

  const availableDnsProviders = useMemo(() => {
    const dnsCodes = new Set(dnsProviders.map((item) => item.code).filter(Boolean));
    return providers.filter((provider) =>
      Boolean(provider.id && provider.name && provider.type && provider.isActive !== false && dnsCodes.has(provider.type))
    );
  }, [providers, dnsProviders]);

  const handleCreateCertificate = async () => {
    if (!formData.name.trim() || !formData.domain.trim() || !formData.dnsProviderId) {
      toast.error("请填写证书名称、域名并选择 DNS 服务商");
      return;
    }
    setIsCreating(true);
    try {
      const payload: CreateCertificateBody = {
        name: formData.name.trim(),
        domain: formData.domain.trim(),
        wildcard: formData.wildcard,
        dnsProviderId: formData.dnsProviderId,
        autoRenew: formData.autoRenew,
      };
      const response = await api.createCertificate(payload);
      if (response.data?.success) {
        toast.success("证书创建成功");
        setIsDialogOpen(false);
        setFormData({
          name: "",
          domain: "",
          wildcard: false,
          dnsProviderId: "",
          autoRenew: true,
        });
        fetchCertificates();
      } else {
        toast.error(response.data?.msg || "证书创建失败");
      }
    } catch {
      toast.error("证书创建失败");
    } finally {
      setIsCreating(false);
    }
  };

  const stat = useMemo(() => {
    const active = certificates.filter((c) => c.daysLeft > 30);
    const expiring = certificates.filter((c) => c.daysLeft <= 30 && c.daysLeft >= 0);
    const expired = certificates.filter((c) => c.daysLeft < 0);
    return { active, expiring, expired };
  }, [certificates]);

  const sanitizeText = (value: string) => {
    return value
      .replace(/-----BEGIN[\s\S]*?-----END[\s\S]*?-----/g, "[REDACTED_PEM_BLOCK]")
      .replace(/(access[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
      .replace(/[A-Za-z0-9+/_-]{24,}/g, "[REDACTED_TOKEN]");
  };

  const sanitizeUnknown = (value: unknown): unknown => {
    if (typeof value === "string") return sanitizeText(value);
    if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item));
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj)) {
        if (/(secret|token|password|private|certpem|keypem|chainpem|credential)/i.test(key)) {
          result[key] = "[REDACTED]";
        } else {
          result[key] = sanitizeUnknown(val);
        }
      }
      return result;
    }
    return value;
  };

  const handleOpenLogs = async (certificateId?: string, certificateName?: string) => {
    if (!certificateId) return;
    setIsLogDialogOpen(true);
    setLogCertificateName(certificateName || "证书");
    setIsLogLoading(true);
    setLogItems([]);
    try {
      const response = await api.listCertificateLogs(
        { id: certificateId },
        { page: 1, pageSize: 100 }
      );
      const data = response.data?.data;
      const rawLogs = Array.isArray(data) ? data : data?.items || [];
      const sanitized = rawLogs.map((log) => ({
        ...log,
        message: log.message ? sanitizeText(log.message) : log.message,
        details: sanitizeUnknown(log.details) as GetCertificateDataLogItemSchema["details"],
      }));
      setLogItems(sanitized);
    } catch {
      toast.error("获取执行日志失败");
    } finally {
      setIsLogLoading(false);
    }
  };

  const handleRetryOrRenew = async (cert: CertificateItem) => {
    if (!cert.id) return;
    const action = cert.status === "ACTIVE" ? "renew" : "issue";
    setActionLoadingKey(`${action}-${cert.id}`);
    try {
      const response = action === "renew"
        ? await api.renewCertificate({ id: cert.id })
        : await api.issueCertificate({ id: cert.id });
      if (response.data?.success) {
        toast.success(action === "renew" ? "续期任务已提交" : "重试签发任务已提交");
        fetchCertificates();
      } else {
        toast.error(response.data?.msg || "操作失败");
      }
    } catch {
      toast.error(action === "renew" ? "续期提交失败" : "重试签发失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleDownloadCertificate = async (cert: CertificateItem) => {
    if (!cert.id) return;
    setActionLoadingKey(`download-${cert.id}`);
    try {
      const response = await api.downloadCertificate({ id: cert.id });
      const content = typeof response.data === "string" ? response.data : "";
      if (!content) {
        toast.error("证书内容为空，无法下载");
        return;
      }
      const pemBlocks = content.match(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g) || [];
      const privateKey = pemBlocks.find((block) => block.includes("PRIVATE KEY")) || "";
      const certChain = pemBlocks.filter((block) => block.includes("CERTIFICATE"));
      if (!privateKey || certChain.length === 0) {
        toast.error("证书内容不完整，无法打包下载");
        return;
      }
      const leafCert = certChain[0];
      const chainCerts = certChain.slice(1);
      const zip = new JSZip();
      zip.file("private.key", `${privateKey}\n`);
      zip.file("public.crt", `${leafCert}\n`);
      zip.file("fullchain.crt", `${certChain.join("\n\n")}\n`);
      if (chainCerts.length > 0) {
        zip.file("chain.crt", `${chainCerts.join("\n\n")}\n`);
      }
      zip.file("bundle.pem", content.endsWith("\n") ? content : `${content}\n`);
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const blob = new Blob([zipBlob], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${cert.domain || cert.name}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("证书压缩包下载成功");
    } catch {
      toast.error("下载失败，请确认该证书已签发");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleOpenDeleteDialog = (cert: CertificateItem) => {
    setSelectedCertificate(cert);
    setDeleteDialogOpen(true);
  };

  const handleDeleteCertificate = async () => {
    if (!selectedCertificate?.id) return;
    setActionLoadingKey(`delete-${selectedCertificate.id}`);
    try {
      const response = await api.deleteCertificate({ id: selectedCertificate.id });
      if (response.data?.success) {
        toast.success("证书删除成功");
        setDeleteDialogOpen(false);
        setSelectedCertificate(null);
        fetchCertificates();
      } else {
        toast.error(response.data?.msg || "证书删除失败");
      }
    } catch {
      toast.error("证书删除失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const getStatusBadge = (status: string, daysLeft: number) => {
    switch (status) {
      case "ACTIVE":
        return daysLeft <= 30 ? (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            即将过期
          </Badge>
        ) : (
          <Badge variant="default" className="gap-1">
            <CheckCircle className="h-3 w-3" />
            正常
          </Badge>
        );
      case "EXPIRING":
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            即将过期
          </Badge>
        );
      case "EXPIRED":
        return (
          <Badge variant="destructive" className="gap-1">
            <Shield className="h-3 w-3" />
            已过期
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const renderCertificatesTable = (items: CertificateItem[]) => {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>域名</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>颁发机构</TableHead>
            <TableHead>过期时间</TableHead>
            <TableHead>剩余天数</TableHead>
            <TableHead>自动续期</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((cert) => (
            <TableRow key={cert.id}>
              <TableCell className="font-medium">{cert.name}</TableCell>
              <TableCell>
                {cert.domain}
                {cert.wildcard && (
                  <Badge variant="outline" className="ml-2">
                    通配符
                  </Badge>
                )}
              </TableCell>
              <TableCell>{getStatusBadge(cert.status, cert.daysLeft)}</TableCell>
              <TableCell>{cert.issuer}</TableCell>
              <TableCell>{cert.expiresAt}</TableCell>
              <TableCell>
                <span
                  className={
                    cert.daysLeft <= 7
                      ? "text-red-600 font-medium"
                      : cert.daysLeft <= 30
                        ? "text-yellow-600"
                        : "text-green-600"
                  }
                >
                  {cert.daysLeft > 0 ? `${cert.daysLeft} 天` : `已过期 ${Math.abs(cert.daysLeft)} 天`}
                </span>
              </TableCell>
              <TableCell>
                {cert.autoRenew ? (
                  <Badge variant="outline" className="text-green-600">
                    已开启
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-gray-400">
                    已关闭
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <TooltipProvider>
                  <div className="flex justify-end gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenLogs(cert.id, cert.name)}
                          aria-label="执行日志"
                        >
                          <ScrollText className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>执行日志</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRetryOrRenew(cert)}
                          disabled={actionLoadingKey === `issue-${cert.id}` || actionLoadingKey === `renew-${cert.id}`}
                          aria-label={cert.status === "ACTIVE" ? "续期证书" : "重试签发"}
                        >
                          {actionLoadingKey === `issue-${cert.id}` || actionLoadingKey === `renew-${cert.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{cert.status === "ACTIVE" ? "续期证书" : "重试签发"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownloadCertificate(cert)}
                          disabled={actionLoadingKey === `download-${cert.id}`}
                          aria-label="下载证书"
                        >
                          {actionLoadingKey === `download-${cert.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>下载证书</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDeleteDialog(cert)}
                          disabled={actionLoadingKey === `delete-${cert.id}`}
                          aria-label="删除证书"
                        >
                          {actionLoadingKey === `delete-${cert.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>删除证书</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  const renderCertificatesContent = (items: CertificateItem[]) => {
    if (isLoading) {
      return <div className="py-10 text-center text-muted-foreground">加载中...</div>;
    }
    if (error) {
      return <div className="py-10 text-center text-destructive">{error}</div>;
    }
    if (items.length === 0) {
      return <div className="py-10 text-center text-muted-foreground">暂无数据</div>;
    }
    return renderCertificatesTable(items);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">证书管理</h1>
          <p className="text-muted-foreground">
            管理 SSL/TLS 证书，支持自动续期和部署
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              申请证书
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>申请新证书</DialogTitle>
              <DialogDescription>
                配置域名和 DNS 服务商以申请 SSL 证书
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="certName">证书名称</Label>
                <Input
                  id="certName"
                  placeholder="如：主域名证书"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="domain">域名</Label>
                <Input
                  id="domain"
                  placeholder="example.com"
                  value={formData.domain}
                  onChange={(e) => setFormData((prev) => ({ ...prev, domain: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="wildcard"
                  className="rounded"
                  checked={formData.wildcard}
                  onChange={(e) => setFormData((prev) => ({ ...prev, wildcard: e.target.checked }))}
                />
                <Label htmlFor="wildcard">通配符证书 (*.example.com)</Label>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dnsProvider">DNS 服务商</Label>
                <Select
                  value={formData.dnsProviderId}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, dnsProviderId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择 DNS 服务商" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableDnsProviders.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id!}>
                        {provider.name} ({provider.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="autoRenew"
                  className="rounded"
                  checked={formData.autoRenew}
                  onChange={(e) => setFormData((prev) => ({ ...prev, autoRenew: e.target.checked }))}
                />
                <Label htmlFor="autoRenew">自动续期</Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" onClick={handleCreateCertificate} disabled={isCreating}>
                {isCreating ? "申请中..." : "申请证书"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={isLogDialogOpen} onOpenChange={setIsLogDialogOpen}>
          <DialogContent className="sm:max-w-[760px]">
            <DialogHeader>
              <DialogTitle>执行日志</DialogTitle>
              <DialogDescription>{logCertificateName} 的执行记录（已自动脱敏）</DialogDescription>
            </DialogHeader>
            <div className="max-h-[420px] overflow-y-auto rounded-md border">
              {isLogLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载日志中...
                </div>
              ) : logItems.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">暂无日志</div>
              ) : (
                <div className="divide-y">
                  {logItems.map((log) => (
                    <div key={log.id} className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge
                          variant={log.level === "ERROR" ? "destructive" : log.level === "WARN" ? "secondary" : "outline"}
                        >
                          {log.level || "INFO"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {log.createdAt ? new Date(log.createdAt).toLocaleString() : "-"}
                        </span>
                      </div>
                      <p className="text-sm leading-6">{log.message || "-"}</p>
                      {log.details && Object.keys(log.details).length > 0 ? (
                        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs leading-5">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>删除证书</DialogTitle>
              <DialogDescription>
                确认删除证书“{selectedCertificate?.name || "-"}”吗？该操作不可撤销。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteCertificate}
                disabled={!selectedCertificate?.id || actionLoadingKey === `delete-${selectedCertificate?.id}`}
              >
                {actionLoadingKey === `delete-${selectedCertificate?.id}` ? "删除中..." : "确认删除"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">全部 ({certificates.length})</TabsTrigger>
          <TabsTrigger value="active">正常 ({stat.active.length})</TabsTrigger>
          <TabsTrigger value="expiring">即将过期 ({stat.expiring.length})</TabsTrigger>
          <TabsTrigger value="expired">已过期 ({stat.expired.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>证书列表</CardTitle>
              <CardDescription>共 {certificates.length} 个证书</CardDescription>
            </CardHeader>
            <CardContent>
              {renderCertificatesContent(certificates)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="active">
          <Card>
            <CardHeader>
              <CardTitle>正常证书</CardTitle>
              <CardDescription>共 {stat.active.length} 个证书</CardDescription>
            </CardHeader>
            <CardContent>{renderCertificatesContent(stat.active)}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expiring">
          <Card>
            <CardHeader>
              <CardTitle>即将过期</CardTitle>
              <CardDescription>共 {stat.expiring.length} 个证书</CardDescription>
            </CardHeader>
            <CardContent>{renderCertificatesContent(stat.expiring)}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expired">
          <Card>
            <CardHeader>
              <CardTitle>已过期</CardTitle>
              <CardDescription>共 {stat.expired.length} 个证书</CardDescription>
            </CardHeader>
            <CardContent>{renderCertificatesContent(stat.expired)}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
