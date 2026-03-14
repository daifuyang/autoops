"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getApi, GetDeploymentRecordDataStepLogItemSchema } from "@/generated/api";
import { customInstance } from "@/lib/axios-instance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Box, CheckCircle2, ChevronRight, CircleDashed, Clock, Copy, FolderUp, History, KeyRound, Play, RefreshCw, Rocket, Search, Server, Terminal, UploadCloud, XCircle } from "lucide-react";
import { useParams } from "next/navigation";
import { cn } from "@/lib/utils";

type DeploymentRecordItem = {
  id: string;
  projectId: string;
  artifactUri: string;
  status: string;
  buildId?: string | null;
  createdAt: string;
};

type DeploymentStepLogItem = GetDeploymentRecordDataStepLogItemSchema;

type DeploymentProjectItem = {
  id: string;
  name: string;
  deployPath: string;
  startCommand?: string | null;
  servicePort?: number | null;
  apiToken: string;
  deployMethod?: string;
  deployWebhookPath?: string;
  uploadWebhookPath?: string;
  artifactPath?: string;
};

export default function DeploymentProjectDetailPage() {
  const api = useMemo(() => getApi(), []);
  const params = useParams<{ projectId: string }>();
  const projectId = String(params?.projectId || "");
  const [project, setProject] = useState<DeploymentProjectItem | null>(null);
  const [records, setRecords] = useState<DeploymentRecordItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedArtifactUri, setSelectedArtifactUri] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isLogDialogOpen, setIsLogDialogOpen] = useState(false);
  const [activeRecordId, setActiveRecordId] = useState<string>("");
  const [logSearch, setLogSearch] = useState("");
  const [recordStepLogs, setRecordStepLogs] = useState<Record<string, DeploymentStepLogItem[]>>({});
  const [recordStepLogErrors, setRecordStepLogErrors] = useState<Record<string, string>>({});
  const [stepLogLoadingRecordId, setStepLogLoadingRecordId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  const fetchData = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const [projectRes, recordRes] = await Promise.allSettled([
        api.listDeploymentProjects({ page: 1, pageSize: 100 }),
        api.listDeploymentRecords({ page: 1, pageSize: 50, projectId }),
      ]);

      if (projectRes.status === "fulfilled") {
        const projectData = projectRes.value.data?.data;
        const projectItems = Array.isArray(projectData) ? projectData : projectData?.items || [];
        const matched = (projectItems as DeploymentProjectItem[]).find((item) => item.id === projectId) || null;
        if (!matched) {
          setProject(null);
          setRecords([]);
          setError("项目不存在或已删除");
          return;
        }
        setProject(matched);
      } else {
        setProject(null);
        setRecords([]);
        setRecordStepLogs({});
        setRecordStepLogErrors({});
        setError("获取项目部署数据失败，请稍后重试");
        return;
      }

      if (recordRes.status === "fulfilled") {
        const recordData = recordRes.value.data?.data;
        const recordItems = Array.isArray(recordData) ? recordData : recordData?.items || [];
        setRecords(recordItems as DeploymentRecordItem[]);
        setRecordStepLogs({});
        setRecordStepLogErrors({});
      } else {
        setError("获取部署记录失败，请稍后重试");
      }
    } catch {
      setProject(null);
      setRecords([]);
      setRecordStepLogs({});
      setRecordStepLogErrors({});
      setError("获取项目部署数据失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (records.length === 0) {
      setSelectedArtifactUri("");
      return;
    }
    if (!selectedArtifactUri || !records.some((item) => item.artifactUri === selectedArtifactUri)) {
      setSelectedArtifactUri(records[0]?.artifactUri || "");
    }
  }, [records, selectedArtifactUri]);

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error("复制失败");
    }
  };

  const handleRegenerateToken = async () => {
    if (!project) {
      return;
    }
    setActionLoading(true);
    try {
      const response = await customInstance<{ success?: boolean; msg?: string }>({
        url: `/deployments/projects/${project.id}/token/regenerate`,
        method: "POST",
      });
      if (response.data?.success) {
        toast.success("访问令牌已更新");
        fetchData();
      } else {
        toast.error(response.data?.msg || "重置失败，请稍后重试");
      }
    } catch {
      toast.error("系统繁忙，重置失败");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetry = async (id: string) => {
    setActionLoading(true);
    try {
      const response = await api.retryDeploymentRecord({ id });
      if (response.data?.success) {
        toast.success("重试任务已创建，正在排队执行");
        fetchData();
      } else {
        toast.error(response.data?.msg || "重试失败");
      }
    } catch {
      toast.error("系统繁忙，重试失败");
    } finally {
      setActionLoading(false);
    }
  };

  const handleManualTrigger = async () => {
    if (!project?.apiToken) {
      return;
    }
    if (!selectedArtifactUri.trim()) {
      toast.error("请选择要部署的构建版本");
      return;
    }
    setActionLoading(true);
    try {
      const response = await customInstance<{ success?: boolean; msg?: string }>({
        url: `/deployments/webhook/${project.apiToken}/deploy`,
        method: "POST",
        data: { artifactUri: selectedArtifactUri.trim() },
      });
      if (response.data?.success) {
        toast.success("部署任务已创建");
        fetchData();
      } else {
        toast.error(response.data?.msg || "触发失败");
      }
    } catch {
      toast.error("系统繁忙，触发失败");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUploadTrigger = async () => {
    if (!project?.apiToken) {
      return;
    }
    if (!uploadFile) {
      toast.error("请选择要上传的部署包");
      return;
    }
    const formData = new FormData();
    formData.append("file", uploadFile);
    setActionLoading(true);
    try {
      const response = await customInstance<{ success?: boolean; msg?: string }>({
        url: `/deployments/webhook/${project.apiToken}/upload`,
        method: "POST",
        data: formData,
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (response.data?.success) {
        toast.success("上传成功，部署任务已自动创建");
        setUploadFile(null);
        const fileInput = document.getElementById("file-upload") as HTMLInputElement;
        if (fileInput) fileInput.value = "";
        fetchData();
      } else {
        toast.error(response.data?.msg || "上传失败");
      }
    } catch {
      toast.error("上传过程中发生错误");
    } finally {
      setActionLoading(false);
    }
  };

  const loadRecordStepLogs = useCallback(async (id: string) => {
    setStepLogLoadingRecordId(id);
    setRecordStepLogErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const response = await api.getDeploymentRecord({ id });
      if (!response.data?.success) {
        setRecordStepLogErrors((prev) => ({ ...prev, [id]: response.data?.msg || "日志加载失败" }));
        return;
      }
      const logs = response.data?.data?.stepLogs || [];
      const sortedLogs = [...logs].sort((a, b) => {
        const orderDiff = (a.stepOrder || 0) - (b.stepOrder || 0);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      });
      setRecordStepLogs((prev) => ({ ...prev, [id]: sortedLogs }));
    } catch {
      setRecordStepLogErrors((prev) => ({ ...prev, [id]: "日志加载失败，请稍后重试" }));
    } finally {
      setStepLogLoadingRecordId(null);
    }
  }, [api]);

  const handleOpenLogDialog = useCallback((id: string) => {
    setActiveRecordId(id);
    setIsLogDialogOpen(true);
    if (!recordStepLogs[id]) {
      loadRecordStepLogs(id);
    }
  }, [loadRecordStepLogs, recordStepLogs]);

  const artifactOptions = useMemo(() => {
    const uniqueMap = new Map<string, DeploymentRecordItem>();
    for (const record of records) {
      if (!record.artifactUri) {
        continue;
      }
      if (!uniqueMap.has(record.artifactUri)) {
        uniqueMap.set(record.artifactUri, record);
      }
    }
    return Array.from(uniqueMap.values());
  }, [records]);

  const middleEllipsis = useCallback((value: string, head = 22, tail = 16) => {
    if (!value || value.length <= head + tail + 1) {
      return value;
    }
    return `${value.slice(0, head)}...${value.slice(-tail)}`;
  }, []);

  const selectedArtifactLabel = useMemo(() => {
    const selected = artifactOptions.find((item) => item.artifactUri === selectedArtifactUri);
    if (!selected) {
      return "";
    }
    const version = selected.buildId || "未标记版本";
    return `${version} · ${middleEllipsis(selected.artifactUri)}`;
  }, [artifactOptions, middleEllipsis, selectedArtifactUri]);

  const activeRecordLogs = useMemo(() => {
    const logs = recordStepLogs[activeRecordId] || [];
    const keyword = logSearch.trim().toLowerCase();
    if (!keyword) {
      return logs;
    }
    return logs.filter((log) => {
      const content = `${log.stepName || ""} ${log.message || ""} ${log.status || ""}`.toLowerCase();
      return content.includes(keyword);
    });
  }, [activeRecordId, logSearch, recordStepLogs]);

  const statusBadge = (status: string) => {
    if (status === "SUCCESS") return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1"><CheckCircle2 className="w-3 h-3" /> 成功</Badge>;
    if (status === "FAILED") return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1"><XCircle className="w-3 h-3" /> 失败</Badge>;
    if (status === "RUNNING") return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1 animate-pulse"><CircleDashed className="w-3 h-3 animate-spin" /> 运行中</Badge>;
    if (status === "ROLLED_BACK") return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 gap-1"><History className="w-3 h-3" /> 已回滚</Badge>;
    return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>;
  };

  const stepStatusBadge = (status?: string) => {
    if (status === "SUCCESS") return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1"><CheckCircle2 className="w-3 h-3" /> 成功</Badge>;
    if (status === "FAILED") return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1"><XCircle className="w-3 h-3" /> 失败</Badge>;
    if (status === "RUNNING") return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1"><CircleDashed className="w-3 h-3 animate-spin" /> 运行中</Badge>;
    return <Badge variant="outline" className="text-muted-foreground">{status || "未知"}</Badge>;
  };

  return (
    <div className="flex flex-col gap-8 p-4 md:p-8">
      <div className="space-y-3 border-b pb-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/deployments" className="transition-colors hover:text-foreground">应用部署</Link>
          <ChevronRight className="h-3.5 w-3.5 opacity-60" />
          <span className="font-medium text-foreground">{project?.name || "加载中..."}</span>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <Link href="/deployments" aria-label="返回部署列表">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{project?.name || "加载中..."}</h1>
                {project && (
                  <Badge variant="secondary" className="font-normal text-xs">
                    {project.deployMethod || "PM2"}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                管理应用的部署配置、触发流水线及查看历史记录。
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={fetchData} disabled={isLoading || actionLoading}>
            <RefreshCw className={cn("h-4 w-4", (isLoading || actionLoading) && "animate-spin")} />
            刷新
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-6">
          <Card className="animate-pulse h-[200px]" />
          <Card className="animate-pulse h-[400px]" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center animate-in fade-in-50">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <Server className="h-6 w-6 text-destructive" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">{error}</h3>
          <Button variant="outline" onClick={fetchData} className="mt-4">
            重试
          </Button>
        </div>
      ) : project ? (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">概览与配置</TabsTrigger>
            <TabsTrigger value="history">部署记录</TabsTrigger>
            <TabsTrigger value="settings">操作与触发</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-muted-foreground" />
                    基础信息
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm">
                  <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                    <span className="text-muted-foreground">应用ID</span>
                    <span className="font-mono text-xs bg-muted px-2 py-1 rounded select-all">{project.id}</span>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                    <span className="text-muted-foreground">部署路径</span>
                    <span className="font-mono break-all">{`${project.deployPath}/current`}</span>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                    <span className="text-muted-foreground">服务端口</span>
                    <span>{project.servicePort || "N/A"}</span>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                    <span className="text-muted-foreground">产物前缀</span>
                    <span className="font-mono">{project.artifactPath || "未设置（直接使用传入 artifactUri）"}</span>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                    <span className="text-muted-foreground">执行入口</span>
                    <span className="font-mono break-all">{project.startCommand || "未配置"}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-muted-foreground" />
                    集成配置
                  </CardTitle>
                  <CardDescription>用于 CI/CD 流水线集成的凭证与接口</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Access Token</Label>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText(project.apiToken, "Token 已复制")}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="relative">
                      <Input readOnly value={project.apiToken} className="font-mono text-xs pr-20 bg-muted/50" />
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="absolute right-1 top-1 h-7 text-xs text-muted-foreground hover:text-destructive"
                        onClick={handleRegenerateToken}
                        disabled={actionLoading}
                      >
                        <RefreshCw className={cn("w-3 h-3 mr-1", actionLoading && "animate-spin")} />
                        重置
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <Label className="text-xs text-muted-foreground">Webhook 示例</Label>
                    <div className="flex items-center justify-between rounded-md border bg-muted/30 p-2.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                          <Terminal className="h-4 w-4" />
                        </div>
                        <div className="grid gap-0.5">
                          <span className="text-sm font-medium">部署触发</span>
                          <span className="text-xs text-muted-foreground">调用 API 触发已存在产物的部署</span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => copyText(
                        `curl -X POST "${window.location.origin}/api/v1/deployments/webhook/${project.apiToken}/deploy" -H "Content-Type: application/json" -d '{"artifactUri":"builds/app.tgz"}'`,
                        "部署命令已复制"
                      )}>
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        复制 CURL
                      </Button>
                    </div>

                    <div className="flex items-center justify-between rounded-md border bg-muted/30 p-2.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                          <UploadCloud className="h-4 w-4" />
                        </div>
                        <div className="grid gap-0.5">
                          <span className="text-sm font-medium">上传部署</span>
                          <span className="text-xs text-muted-foreground">上传产物并自动触发部署流程</span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => copyText(
                        `curl -X POST "${window.location.origin}/api/v1/deployments/webhook/${project.apiToken}/upload" -F "file=@./artifact.tgz"`,
                        "上传命令已复制"
                      )}>
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        复制 CURL
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>历史记录</CardTitle>
                <CardDescription>最近 50 次部署任务执行情况</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>状态</TableHead>
                      <TableHead>产物版本 / URI</TableHead>
                      <TableHead>Build ID</TableHead>
                      <TableHead>执行时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{statusBadge(item.status)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 max-w-[300px]" title={item.artifactUri}>
                            <Box className="w-4 h-4 text-muted-foreground shrink-0" />
                            <span className="truncate font-mono text-xs">{item.artifactUri}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{item.buildId || "-"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(item.createdAt).toLocaleString()}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => handleOpenLogDialog(item.id)}>
                              日志
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleRetry(item.id)} disabled={actionLoading}>
                              <RefreshCw className={cn("w-3 h-3 mr-1", actionLoading && "animate-spin")} />
                              重试
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {records.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                          暂无部署记录
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Dialog open={isLogDialogOpen} onOpenChange={setIsLogDialogOpen}>
              <DialogContent className="sm:max-w-[920px]">
                <DialogHeader>
                  <DialogTitle>部署步骤日志</DialogTitle>
                  <DialogDescription>支持关键字筛选，适合大体量日志定位问题。</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={logSearch}
                      onChange={(event) => setLogSearch(event.target.value)}
                      placeholder="搜索步骤名 / 状态 / 消息"
                      className="pl-9"
                    />
                  </div>
                  <div className="max-h-[520px] overflow-y-auto rounded-md border p-3">
                    {stepLogLoadingRecordId === activeRecordId ? (
                      <div className="text-sm text-muted-foreground">正在加载步骤日志...</div>
                    ) : recordStepLogErrors[activeRecordId] ? (
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm text-destructive">{recordStepLogErrors[activeRecordId]}</span>
                        <Button size="sm" variant="outline" onClick={() => loadRecordStepLogs(activeRecordId)}>
                          重试加载
                        </Button>
                      </div>
                    ) : activeRecordLogs.length === 0 ? (
                      <div className="text-sm text-muted-foreground">暂无匹配日志</div>
                    ) : (
                      <div className="space-y-3">
                        {activeRecordLogs.map((log, index) => (
                          <div key={log.id || `${activeRecordId}-${index}`} className="rounded-md border bg-muted/20 p-3">
                            <div className="flex items-center gap-2">
                              {stepStatusBadge(log.status)}
                              <span className="text-sm font-medium">{log.stepName || "未命名步骤"}</span>
                              <span className="text-xs text-muted-foreground">#{log.stepOrder || "-"}</span>
                              <span className="text-xs text-muted-foreground ml-auto">
                                {log.createdAt ? new Date(log.createdAt).toLocaleString() : "-"}
                              </span>
                            </div>
                            {log.message ? (
                              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground/90">{log.message}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>手动触发</CardTitle>
                <CardDescription>适用于调试或紧急回滚场景</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-3 p-4 border rounded-lg bg-muted/20">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-primary/10 rounded-full text-primary">
                      <Rocket className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-medium text-sm">指定产物部署</h4>
                      <p className="text-xs text-muted-foreground">从历史构建中选择版本，默认最新，便于安全回滚</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="w-0 flex-1">
                      <Select value={selectedArtifactUri} onValueChange={setSelectedArtifactUri}>
                        <SelectTrigger className="w-full font-mono text-sm">
                          <SelectValue placeholder="请选择构建版本">
                            <span className="block truncate text-left" title={selectedArtifactLabel}>
                              {selectedArtifactLabel}
                            </span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {artifactOptions.map((item) => {
                            const version = item.buildId || "未标记版本";
                            const fullLabel = `${version} · ${item.artifactUri}`;
                            const displayLabel = `${version} · ${middleEllipsis(item.artifactUri)}`;
                            return (
                              <SelectItem key={`${item.id}-${item.artifactUri}`} value={item.artifactUri}>
                                <span className="block max-w-[520px] truncate" title={fullLabel}>
                                  {displayLabel}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button className="sm:shrink-0" onClick={handleManualTrigger} disabled={actionLoading}>
                      <Play className="mr-2 w-4 h-4" />
                      部署
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 p-4 border rounded-lg bg-muted/20">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-primary/10 rounded-full text-primary">
                      <FolderUp className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-medium text-sm">上传部署包</h4>
                      <p className="text-xs text-muted-foreground">上传本地 .tgz 或 .zip 文件进行部署</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input 
                      id="file-upload"
                      type="file" 
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)} 
                      className="min-w-0 file:mr-4 file:py-1 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                    />
                    <Button className="sm:shrink-0" onClick={handleUploadTrigger} disabled={actionLoading || !uploadFile}>
                      <UploadCloud className="mr-2 w-4 h-4" />
                      上传并部署
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
