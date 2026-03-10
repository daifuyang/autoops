"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getApi } from "@/generated/api";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowRight, Box, Globe, Plus, Rocket, Server, Terminal } from "lucide-react";

type DeploymentProjectItem = {
  id: string;
  name: string;
  artifactPath?: string | null;
  deployPath: string;
  startCommand?: string | null;
  servicePort?: number | null;
  healthCheckPath?: string | null;
  apiToken: string;
  deployMethod?: string;
  deployWebhookPath?: string;
  uploadWebhookPath?: string;
};

export default function DeploymentsPage() {
  const api = useMemo(() => getApi(), []);
  const [projects, setProjects] = useState<DeploymentProjectItem[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [projectForm, setProjectForm] = useState({
    name: "",
    artifactPath: "",
    deployPath: "",
    startCommand: "npm start",
    servicePort: 3000,
    healthCheckPath: "/",
    runtimeEnvJson: "{}",
  });

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

  const handleCreateProject = async () => {
    if (!projectForm.name.trim() || !projectForm.deployPath.trim() || !projectForm.startCommand.trim()) {
      toast.error("请填写必填项：项目名称、部署路径和执行入口");
      return;
    }
    let runtimeEnv: Record<string, string> | undefined = undefined;
    try {
      runtimeEnv = projectForm.runtimeEnvJson.trim() ? JSON.parse(projectForm.runtimeEnvJson) : undefined;
    } catch {
      toast.error("运行环境配置格式错误，请输入有效的 JSON");
      return;
    }
    setActionLoading(true);
    try {
      const response = await api.createDeploymentProject({
        name: projectForm.name.trim(),
        artifactPath: projectForm.artifactPath.trim() || undefined,
        deployPath: projectForm.deployPath.trim(),
        startCommand: projectForm.startCommand.trim(),
        servicePort: Number(projectForm.servicePort) || undefined,
        healthCheckPath: projectForm.healthCheckPath.trim() || undefined,
        runtimeEnv,
      });
      if (response.data?.success) {
        toast.success("项目创建成功，已为您生成部署配置");
        const id = String((response.data.data as { id?: string })?.id || "");
        setProjectForm({
          name: "",
          artifactPath: "",
          deployPath: "",
          startCommand: "npm start",
          servicePort: 3000,
          healthCheckPath: "/",
          runtimeEnvJson: "{}",
        });
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
            <div className="grid gap-6 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name" className="text-right">
                  应用名称 <span className="text-destructive">*</span>
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
                  <Label htmlFor="artifactPath">构建产物前缀</Label>
                  <Input
                    id="artifactPath"
                    value={projectForm.artifactPath}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, artifactPath: e.target.value }))}
                    placeholder="builds/project-a"
                  />
                  <p className="text-xs text-muted-foreground">仅用于拼接上传/触发时的 artifactUri，不影响解压目录</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="deployPath">
                    目标部署目录 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="deployPath"
                    value={projectForm.deployPath}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, deployPath: e.target.value }))}
                    placeholder="/data/apps/project-a"
                  />
                  <p className="text-xs text-muted-foreground">实际运行目录为 {`{deployPath}/current`}，版本发布到 {`{deployPath}/releases`}</p>
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
                <Label htmlFor="runtimeEnv">环境变量配置 (JSON)</Label>
                <Input
                  id="runtimeEnv"
                  value={projectForm.runtimeEnvJson}
                  onChange={(e) => setProjectForm((prev) => ({ ...prev, runtimeEnvJson: e.target.value }))}
                  placeholder='{"NODE_ENV":"production"}'
                  className="font-mono text-sm"
                />
              </div>
            </div>
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
              </CardContent>
              <CardFooter className="p-4 pt-0">
                <Button asChild className="w-full" variant="outline" size="sm">
                  <Link href={`/deployments/${item.id}`}>
                    管理应用
                    <ArrowRight className="ml-2 h-3.5 w-3.5 opacity-50 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
