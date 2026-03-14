"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getApi } from "@/generated/api";
import { axiosInstance } from "@/lib/axios-instance";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Box, CircleHelp, Globe, Pencil, Plus, Rocket, Server, Settings, Shield, Terminal, Trash2 } from "lucide-react";

type DeploymentProjectItem = {
  id: string;
  name: string;
  description?: string | null;
  artifactPath?: string | null;
  deployPath: string;
  startCommand?: string | null;
  servicePort?: number | null;
  healthCheckPath?: string | null;
  runtimeEnv?: Record<string, string> | null;
  isActive?: boolean;
  certificateId?: string | null;
  enableTlsAutoBind?: boolean;
  certificate?: {
    id: string;
    name: string;
    domain: string;
    status: string;
    expiresAt?: string | null;
  } | null;
  apiToken: string;
  deployMethod?: string;
  deployWebhookPath?: string;
  uploadWebhookPath?: string;
};

type ProjectFormState = {
  name: string;
  artifactPath: string;
  deployPath: string;
  startCommand: string;
  servicePort: number;
  healthCheckPath: string;
  runtimeEnvJson: string;
  certificateId: string;
};

type AvailableCertificateItem = {
  id: string;
  name: string;
  domain: string;
  status: string;
  expiresAt?: string | null;
};

function FieldHint({ content }: { content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground">
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[320px] text-xs leading-relaxed">{content}</TooltipContent>
    </Tooltip>
  );
}

const createDefaultProjectForm = (): ProjectFormState => ({
  name: "",
  artifactPath: "",
  deployPath: "",
  startCommand: "npm start",
  servicePort: 3000,
  healthCheckPath: "/",
  runtimeEnvJson: "{}",
  certificateId: "",
});

export default function DeploymentsPage() {
  const api = useMemo(() => getApi(), []);
  const [projects, setProjects] = useState<DeploymentProjectItem[]>([]);
  const [availableCertificates, setAvailableCertificates] = useState<AvailableCertificateItem[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [editActionLoading, setEditActionLoading] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState("");
  const [editingProjectId, setEditingProjectId] = useState("");
  const [projectForm, setProjectForm] = useState<ProjectFormState>(createDefaultProjectForm());
  const [editProjectForm, setEditProjectForm] = useState<ProjectFormState>(createDefaultProjectForm());

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const projectRes = await api.listDeploymentProjects({ page: 1, pageSize: 100 });
      const projectData = projectRes.data?.data;
      const projectItems = Array.isArray(projectData) ? projectData : projectData?.items || [];
      setProjects(projectItems as DeploymentProjectItem[]);
    } catch {
      setProjects([]);
      setError("获取项目列表失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const fetchAvailableCertificates = useCallback(async () => {
    try {
      const response = await axiosInstance.get("/deployments/certificates/available");
      const list = Array.isArray(response.data?.data) ? response.data.data : [];
      setAvailableCertificates(list as AvailableCertificateItem[]);
    } catch {
      setAvailableCertificates([]);
    }
  }, []);

  useEffect(() => {
    fetchAvailableCertificates();
  }, [fetchAvailableCertificates]);

  const parseRuntimeEnv = (runtimeEnvJson: string) => {
    try {
      return runtimeEnvJson.trim() ? (JSON.parse(runtimeEnvJson) as Record<string, string>) : undefined;
    } catch {
      return null;
    }
  };

  const handleCreateProject = async () => {
    if (!projectForm.name.trim() || !projectForm.deployPath.trim() || !projectForm.startCommand.trim()) {
      toast.error("请填写必填项：项目名称、部署路径和执行入口");
      return;
    }
    const runtimeEnv = parseRuntimeEnv(projectForm.runtimeEnvJson);
    if (runtimeEnv === null) {
      toast.error("运行环境配置格式错误，请输入有效的 JSON");
      return;
    }
    setActionLoading(true);
    try {
      const response = await axiosInstance.post("/deployments/projects", {
        name: projectForm.name.trim(),
        artifactPath: projectForm.artifactPath.trim() || undefined,
        deployPath: projectForm.deployPath.trim(),
        startCommand: projectForm.startCommand.trim(),
        servicePort: Number(projectForm.servicePort) || undefined,
        healthCheckPath: projectForm.healthCheckPath.trim() || undefined,
        runtimeEnv,
        certificateId: projectForm.certificateId || undefined,
      });
      if (response.data?.success) {
        toast.success("项目创建成功，已为您生成部署配置");
        const id = String((response.data.data as { id?: string })?.id || "");
        setProjectForm(createDefaultProjectForm());
        setIsDialogOpen(false);
        if (id) {
          window.location.href = `/deployments/${id}`;
          return;
        }
        fetchProjects();
      } else {
        toast.error(response.data?.msg || "创建项目失败，请检查输入或重试");
      }
    } catch {
      toast.error("系统繁忙，创建项目失败");
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenEditDialog = (project: DeploymentProjectItem) => {
    setEditingProjectId(project.id);
    setEditProjectForm({
      name: project.name || "",
      artifactPath: project.artifactPath || "",
      deployPath: project.deployPath || "",
      startCommand: project.startCommand || "npm start",
      servicePort: Number(project.servicePort) || 3000,
      healthCheckPath: project.healthCheckPath || "/",
      runtimeEnvJson: JSON.stringify(project.runtimeEnv || {}, null, 2),
      certificateId: project.certificateId || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdateProject = async () => {
    if (!editingProjectId) return;
    if (!editProjectForm.name.trim() || !editProjectForm.deployPath.trim() || !editProjectForm.startCommand.trim()) {
      toast.error("请填写必填项：项目名称、部署路径和执行入口");
      return;
    }
    const runtimeEnv = parseRuntimeEnv(editProjectForm.runtimeEnvJson);
    if (runtimeEnv === null) {
      toast.error("运行环境配置格式错误，请输入有效的 JSON");
      return;
    }
    setEditActionLoading(true);
    try {
      const response = await axiosInstance.put(
        `/deployments/projects/${editingProjectId}`,
        {
          name: editProjectForm.name.trim(),
          artifactPath: editProjectForm.artifactPath.trim() || undefined,
          deployPath: editProjectForm.deployPath.trim(),
          startCommand: editProjectForm.startCommand.trim(),
          servicePort: Number(editProjectForm.servicePort) || undefined,
          healthCheckPath: editProjectForm.healthCheckPath.trim() || undefined,
          runtimeEnv,
          certificateId: editProjectForm.certificateId || undefined,
        },
      );
      if (response.data?.success) {
        toast.success("项目更新成功");
        setIsEditDialogOpen(false);
        setEditingProjectId("");
        fetchProjects();
      } else {
        toast.error(response.data?.msg || "更新失败，请稍后重试");
      }
    } catch {
      toast.error("系统繁忙，更新失败");
    } finally {
      setEditActionLoading(false);
    }
  };

  const handleDeleteProject = async (project: DeploymentProjectItem) => {
    if (!confirm(`确定删除应用「${project.name}」吗？删除后无法恢复。`)) return;
    setDeletingProjectId(project.id);
    try {
      const response = await axiosInstance.delete(`/deployments/projects/${project.id}`);
      if (response.data?.success) {
        toast.success("项目删除成功");
        fetchProjects();
      } else {
        toast.error(response.data?.msg || "删除失败，请稍后重试");
      }
    } catch {
      toast.error("系统繁忙，删除失败");
    } finally {
      setDeletingProjectId("");
    }
  };

  return (
    <div className="flex flex-col gap-8 p-4 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">应用部署</h1>
          <p className="mt-2 text-muted-foreground">
            集中管理您的应用服务，支持一键发布、状态监控与版本回滚。
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="lg" className="shadow-sm">
              <Plus className="mr-2 h-4 w-4" />
              新建应用
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>新建部署应用</DialogTitle>
              <DialogDescription>
                配置应用的基础信息与部署参数，我们将自动为您生成 PM2 进程守护配置与访问令牌。
              </DialogDescription>
            </DialogHeader>
            <TooltipProvider>
              <div className="grid gap-6 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name" className="text-right">
                    应用名称<span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={projectForm.name}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="例如：my-awesome-app"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="artifactPath">构建产物前缀</Label>
                      <FieldHint content="用于拼接上传/触发时的 artifactUri，示例：builds/project-a；不影响部署解压目录。" />
                    </div>
                    <Input
                      id="artifactPath"
                      value={projectForm.artifactPath}
                      onChange={(e) => setProjectForm((prev) => ({ ...prev, artifactPath: e.target.value }))}
                      placeholder="builds/project-a"
                    />
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="deployPath">
                        目标部署目录 <span className="text-destructive">*</span>
                      </Label>
                      <FieldHint content="应用部署到机器上的目录，实际运行路径为 {deployPath}/current，发布版本位于 {deployPath}/releases。" />
                    </div>
                    <Input
                      id="deployPath"
                      value={projectForm.deployPath}
                      onChange={(e) => setProjectForm((prev) => ({ ...prev, deployPath: e.target.value }))}
                      placeholder="/data/apps/project-a"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="startCommand">
                    执行入口 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="startCommand"
                    value={projectForm.startCommand}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, startCommand: e.target.value }))}
                    placeholder="例如：node index.js 或 npm start"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">将作为部署后进程启动命令执行</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="servicePort">服务端口</Label>
                    <Input
                      id="servicePort"
                      type="number"
                      value={projectForm.servicePort}
                      onChange={(e) => setProjectForm((prev) => ({ ...prev, servicePort: Number(e.target.value) || 0 }))}
                      placeholder="3000"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="healthCheckPath">健康检查接口</Label>
                    <Input
                      id="healthCheckPath"
                      value={projectForm.healthCheckPath}
                      onChange={(e) => setProjectForm((prev) => ({ ...prev, healthCheckPath: e.target.value }))}
                      placeholder="/api/health"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="certificateId">证书绑定</Label>
                  <Select
                    value={projectForm.certificateId || "none"}
                    onValueChange={(value) => {
                      const nextId = value === "none" ? "" : value;
                      setProjectForm((prev) => ({ ...prev, certificateId: nextId }));
                    }}
                  >
                    <SelectTrigger id="certificateId">
                      <SelectValue placeholder="选择证书（可选）" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不绑定证书</SelectItem>
                      {availableCertificates.map((cert) => (
                        <SelectItem key={cert.id} value={cert.id}>
                          {cert.name} ({cert.domain})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="runtimeEnv">环境变量配置 (JSON)</Label>
                  <textarea
                    id="runtimeEnv"
                    value={projectForm.runtimeEnvJson}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, runtimeEnvJson: e.target.value }))}
                    placeholder='{"NODE_ENV":"production"}'
                    className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
              </div>
            </TooltipProvider>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={actionLoading}>
                取消
              </Button>
              <Button onClick={handleCreateProject} disabled={actionLoading}>
                {actionLoading ? (
                  <>
                    <Rocket className="mr-2 h-4 w-4 animate-spin" />
                    正在创建...
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2 h-4 w-4" />
                    立即创建
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={isEditDialogOpen}
          onOpenChange={(open) => {
            setIsEditDialogOpen(open);
            if (!open) {
              setEditingProjectId("");
            }
          }}
        >
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>编辑部署应用</DialogTitle>
              <DialogDescription>更新应用部署参数，保存后立即生效。</DialogDescription>
            </DialogHeader>
            <TooltipProvider>
              <div className="grid gap-6 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-name">
                    应用名称 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edit-name"
                    value={editProjectForm.name}
                    onChange={(e) => setEditProjectForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="例如：my-awesome-app"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="edit-artifactPath">构建产物前缀</Label>
                      <FieldHint content="用于拼接上传/触发时的 artifactUri，示例：builds/project-a；不影响部署解压目录。" />
                    </div>
                    <Input
                      id="edit-artifactPath"
                      value={editProjectForm.artifactPath}
                      onChange={(e) => setEditProjectForm((prev) => ({ ...prev, artifactPath: e.target.value }))}
                      placeholder="builds/project-a"
                    />
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="edit-deployPath">
                        目标部署目录 <span className="text-destructive">*</span>
                      </Label>
                      <FieldHint content="应用部署到机器上的目录，实际运行路径为 {deployPath}/current，发布版本位于 {deployPath}/releases。" />
                    </div>
                    <Input
                      id="edit-deployPath"
                      value={editProjectForm.deployPath}
                      onChange={(e) => setEditProjectForm((prev) => ({ ...prev, deployPath: e.target.value }))}
                      placeholder="/data/apps/project-a"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-startCommand">
                    执行入口 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edit-startCommand"
                    value={editProjectForm.startCommand}
                    onChange={(e) => setEditProjectForm((prev) => ({ ...prev, startCommand: e.target.value }))}
                    placeholder="例如：node index.js 或 npm start"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-servicePort">服务端口</Label>
                    <Input
                      id="edit-servicePort"
                      type="number"
                      value={editProjectForm.servicePort}
                      onChange={(e) => setEditProjectForm((prev) => ({ ...prev, servicePort: Number(e.target.value) || 0 }))}
                      placeholder="3000"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-healthCheckPath">健康检查接口</Label>
                    <Input
                      id="edit-healthCheckPath"
                      value={editProjectForm.healthCheckPath}
                      onChange={(e) => setEditProjectForm((prev) => ({ ...prev, healthCheckPath: e.target.value }))}
                      placeholder="/api/health"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-certificateId">证书绑定</Label>
                  <Select
                    value={editProjectForm.certificateId || "none"}
                    onValueChange={(value) => {
                      const nextId = value === "none" ? "" : value;
                      setEditProjectForm((prev) => ({ ...prev, certificateId: nextId }));
                    }}
                  >
                    <SelectTrigger id="edit-certificateId">
                      <SelectValue placeholder="选择证书（可选）" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不绑定证书</SelectItem>
                      {availableCertificates.map((cert) => (
                        <SelectItem key={cert.id} value={cert.id}>
                          {cert.name} ({cert.domain})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-runtimeEnv">环境变量配置 (JSON)</Label>
                  <textarea
                    id="edit-runtimeEnv"
                    value={editProjectForm.runtimeEnvJson}
                    onChange={(e) => setEditProjectForm((prev) => ({ ...prev, runtimeEnvJson: e.target.value }))}
                    placeholder='{"NODE_ENV":"production"}'
                    className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
              </div>
            </TooltipProvider>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditDialogOpen(false);
                  setEditingProjectId("");
                }}
                disabled={editActionLoading}
              >
                取消
              </Button>
              <Button onClick={handleUpdateProject} disabled={editActionLoading}>
                {editActionLoading ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-[100px] bg-muted/50" />
              <CardContent className="h-[100px]" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center animate-in fade-in-50">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <Server className="h-6 w-6 text-destructive" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">{error}</h3>
          <Button variant="outline" onClick={fetchProjects} className="mt-4">
            重试
          </Button>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center animate-in fade-in-50">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Rocket className="h-6 w-6 text-primary" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">暂无应用</h3>
          <p className="mb-4 mt-2 text-sm text-muted-foreground max-w-sm">
            您还没有创建任何应用部署项目。立即创建一个，体验自动化的部署流程。
          </p>
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            创建第一个应用
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((item) => (
            <Card key={item.id} className="group overflow-hidden transition-all hover:border-primary/50 hover:shadow-md">
              <CardHeader className="border-b pb-4">
                <div className="flex items-start justify-between">
                  <div className="grid gap-1">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                      {item.name}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-1.5 text-xs">
                      <div className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-foreground/80">
                        <Terminal className="h-3 w-3" />
                        {item.deployMethod || "PM2"}
                      </div>
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 ring-1 ring-green-500/20 ring-inset">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    运行中
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 p-6 text-sm">
                <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Server className="h-3.5 w-3.5" /> 部署路径
                  </span>
                  <span className="font-mono text-foreground truncate" title={item.deployPath}>
                    {item.deployPath}
                  </span>
                </div>
                <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Globe className="h-3.5 w-3.5" /> 服务端口
                  </span>
                  <span className="font-mono text-foreground">{item.servicePort || "N/A"}</span>
                </div>
                <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Box className="h-3.5 w-3.5" /> 产物前缀
                  </span>
                  <span className="font-mono text-foreground truncate" title={item.artifactPath || ""}>
                    {item.artifactPath || "默认"}
                  </span>
                </div>
                <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Shield className="h-3.5 w-3.5" /> TLS 绑定
                  </span>
                  <span className="text-foreground">
                    {item.certificate?.name ? item.certificate.name : "未绑定"}
                  </span>
                </div>
              </CardContent>
              <CardFooter className="grid grid-cols-3 gap-2 p-4 pt-0">
                <Button asChild className="w-full" variant="outline" size="sm">
                  <Link href={`/deployments/${item.id}`}>
                    <Settings className="mr-1.5 h-3.5 w-3.5" />
                    管理
                  </Link>
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleOpenEditDialog(item)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  编辑
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleDeleteProject(item)}
                  disabled={deletingProjectId === item.id}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {deletingProjectId === item.id ? "删除中" : "删除"}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
