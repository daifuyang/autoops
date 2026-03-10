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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Play, Edit, Trash2, CheckCircle, XCircle, Clock, ScrollText } from "lucide-react";
import { getApi, ListHealthChecksDataItemSchema, CreateHealthCheckBody, RunHealthCheckDataSchema, UpdateHealthCheckBody } from "@/generated/api";
import { toast } from "sonner";

type HealthCheckItem = {
  id: string;
  name: string;
  url: string;
  method: string;
  interval: number;
  expectStatus: number;
  notifyEmail: string;
  isActive: boolean;
  status: "healthy" | "unhealthy" | "pending";
  lastChecked: string;
  responseTime: string;
};

export default function HealthPage() {
  const api = useMemo(() => getApi(), []);
  const [checks, setChecks] = useState<HealthCheckItem[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isLogDialogOpen, setIsLogDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [selectedCheck, setSelectedCheck] = useState<HealthCheckItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HealthCheckItem | null>(null);
  const [logs, setLogs] = useState<RunHealthCheckDataSchema[]>([]);
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    method: "GET",
    interval: 60,
    expectStatus: 200,
    notifyEmail: "",
  });
  const [editFormData, setEditFormData] = useState({
    id: "",
    name: "",
    url: "",
    method: "GET",
    interval: 60,
    expectStatus: 200,
    notifyEmail: "",
    isActive: true,
  });

  const parseItem = (item: ListHealthChecksDataItemSchema, index: number): HealthCheckItem => {
    const statusRaw = (item.lastStatus || "").toUpperCase();
    const status: "healthy" | "unhealthy" | "pending" =
      statusRaw === "UP" ? "healthy" : statusRaw === "DOWN" ? "unhealthy" : "pending";
    const lastChecked = item.lastCheckAt
      ? new Date(item.lastCheckAt).toLocaleString()
      : "从未";
    const responseTime =
      typeof item.latestLog?.responseTime === "number"
        ? `${item.latestLog.responseTime}ms`
        : "-";
    return {
      id: String(item.id || `check-${index}`),
      name: item.name || "未命名检查",
      url: item.url || "-",
      method: (item.method || "GET").toUpperCase(),
      interval: item.interval || 60,
      expectStatus: item.expectStatus || 200,
      notifyEmail: item.notifyEmail || "",
      isActive: item.isActive !== false,
      status,
      lastChecked,
      responseTime,
    };
  };

  const fetchChecks = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.listHealthChecks({ page: 1, pageSize: 50 });
      const data = response.data?.data;
      const list = Array.isArray(data) ? data : data?.items || [];
      setChecks(list.map((item, idx) => parseItem(item, idx)));
    } catch {
      setChecks([]);
      setError("获取健康检查失败，请检查后端服务");
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchChecks();
  }, [fetchChecks]);

  const handleCreateCheck = async () => {
    if (!formData.name.trim() || !formData.url.trim()) {
      toast.error("请填写检查名称和 URL");
      return;
    }
    setActionLoadingKey("create");
    try {
      const payload: CreateHealthCheckBody = {
        name: formData.name.trim(),
        url: formData.url.trim(),
        method: formData.method,
        interval: Number(formData.interval),
        expectStatus: Number(formData.expectStatus),
        notifyEmail: formData.notifyEmail || undefined,
      };
      const response = await api.createHealthCheck(payload);
      if (response.data?.success) {
        toast.success("健康检查创建成功");
        setIsDialogOpen(false);
        setFormData({
          name: "",
          url: "",
          method: "GET",
          interval: 60,
          expectStatus: 200,
          notifyEmail: "",
        });
        fetchChecks();
      } else {
        toast.error(response.data?.msg || "创建失败");
      }
    } catch {
      toast.error("创建失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleRunCheck = async (id: string) => {
    setActionLoadingKey(`run-${id}`);
    try {
      const response = await api.runHealthCheck({ id });
      if (response.data?.success) {
        toast.success("已触发立即检查");
        fetchChecks();
      } else {
        toast.error(response.data?.msg || "触发失败");
      }
    } catch {
      toast.error("触发失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleDeleteCheck = async (id: string) => {
    setActionLoadingKey(`delete-${id}`);
    try {
      const response = await api.deleteHealthCheck({ id });
      if (response.data?.success) {
        toast.success("删除成功");
        fetchChecks();
      } else {
        toast.error(response.data?.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleOpenDeleteDialog = (check: HealthCheckItem) => {
    setDeleteTarget(check);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    await handleDeleteCheck(deleteTarget.id);
    setIsDeleteDialogOpen(false);
    setDeleteTarget(null);
  };

  const handleOpenEdit = (check: HealthCheckItem) => {
    setSelectedCheck(check);
    setEditFormData({
      id: check.id,
      name: check.name,
      url: check.url,
      method: check.method,
      interval: check.interval,
      expectStatus: check.expectStatus,
      notifyEmail: check.notifyEmail,
      isActive: check.isActive,
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdateCheck = async () => {
    if (!editFormData.id || !editFormData.name.trim() || !editFormData.url.trim()) {
      toast.error("请填写完整信息");
      return;
    }
    setActionLoadingKey(`edit-${editFormData.id}`);
    try {
      const payload: UpdateHealthCheckBody = {
        name: editFormData.name.trim(),
        url: editFormData.url.trim(),
        method: editFormData.method,
        interval: Number(editFormData.interval),
        expectStatus: Number(editFormData.expectStatus),
        notifyEmail: editFormData.notifyEmail || undefined,
        isActive: editFormData.isActive,
      };
      const response = await api.updateHealthCheck({ id: editFormData.id }, payload);
      if (response.data?.success) {
        toast.success("更新成功");
        setIsEditDialogOpen(false);
        fetchChecks();
      } else {
        toast.error(response.data?.msg || "更新失败");
      }
    } catch {
      toast.error("更新失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleOpenLogs = async (check: HealthCheckItem) => {
    setSelectedCheck(check);
    setLogs([]);
    setIsLogDialogOpen(true);
    setActionLoadingKey(`logs-${check.id}`);
    try {
      const response = await api.listHealthCheckLogs(
        { id: check.id },
        { page: 1, pageSize: 100 }
      );
      const data = response.data?.data;
      setLogs(Array.isArray(data) ? data : data?.items || []);
    } catch {
      toast.error("获取日志失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const summary = useMemo(() => {
    return {
      healthy: checks.filter((c) => c.status === "healthy").length,
      unhealthy: checks.filter((c) => c.status === "unhealthy").length,
      pending: checks.filter((c) => c.status === "pending").length,
    };
  }, [checks]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "healthy":
        return (
          <Badge className="gap-1 bg-green-500">
            <CheckCircle className="h-3 w-3" />
            正常
          </Badge>
        );
      case "unhealthy":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            异常
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            待检查
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">健康检查</h1>
          <p className="text-muted-foreground">
            监控服务状态，自动检测异常并发送告警
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              添加检查
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>添加健康检查</DialogTitle>
              <DialogDescription>
                配置要监控的服务端点
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">检查名称</Label>
                <Input
                  id="name"
                  placeholder="如：API 服务健康检查"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="url">监控 URL</Label>
                <Input
                  id="url"
                  placeholder="https://api.example.com/health"
                  value={formData.url}
                  onChange={(e) => setFormData((prev) => ({ ...prev, url: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="method">请求方法</Label>
                  <Select
                    value={formData.method}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, method: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="HEAD">HEAD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="interval">检查间隔（秒）</Label>
                  <Input
                    id="interval"
                    type="number"
                    value={formData.interval}
                    onChange={(e) => setFormData((prev) => ({ ...prev, interval: Number(e.target.value) || 60 }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="expectedStatus">期望状态码</Label>
                <Input
                  id="expectedStatus"
                  type="number"
                  value={formData.expectStatus}
                  onChange={(e) => setFormData((prev) => ({ ...prev, expectStatus: Number(e.target.value) || 200 }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="notifyEmail">告警邮箱</Label>
                <Input
                  id="notifyEmail"
                  placeholder="ops@example.com（可选）"
                  value={formData.notifyEmail}
                  onChange={(e) => setFormData((prev) => ({ ...prev, notifyEmail: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" onClick={handleCreateCheck} disabled={actionLoadingKey === "create"}>
                {actionLoadingKey === "create" ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>编辑健康检查</DialogTitle>
              <DialogDescription>
                更新检查配置并保存
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">检查名称</Label>
                <Input
                  id="edit-name"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-url">监控 URL</Label>
                <Input
                  id="edit-url"
                  value={editFormData.url}
                  onChange={(e) => setEditFormData((prev) => ({ ...prev, url: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-method">请求方法</Label>
                  <Select
                    value={editFormData.method}
                    onValueChange={(value) => setEditFormData((prev) => ({ ...prev, method: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="HEAD">HEAD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-interval">检查间隔（秒）</Label>
                  <Input
                    id="edit-interval"
                    type="number"
                    value={editFormData.interval}
                    onChange={(e) => setEditFormData((prev) => ({ ...prev, interval: Number(e.target.value) || 60 }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-expectedStatus">期望状态码</Label>
                  <Input
                    id="edit-expectedStatus"
                    type="number"
                    value={editFormData.expectStatus}
                    onChange={(e) => setEditFormData((prev) => ({ ...prev, expectStatus: Number(e.target.value) || 200 }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-active">状态</Label>
                  <Select
                    value={editFormData.isActive ? "active" : "inactive"}
                    onValueChange={(value) => setEditFormData((prev) => ({ ...prev, isActive: value === "active" }))}
                  >
                    <SelectTrigger id="edit-active">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">启用</SelectItem>
                      <SelectItem value="inactive">停用</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-notifyEmail">告警邮箱</Label>
                <Input
                  id="edit-notifyEmail"
                  placeholder="ops@example.com（可选）"
                  value={editFormData.notifyEmail}
                  onChange={(e) => setEditFormData((prev) => ({ ...prev, notifyEmail: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                onClick={handleUpdateCheck}
                disabled={actionLoadingKey === `edit-${editFormData.id}`}
              >
                {actionLoadingKey === `edit-${editFormData.id}` ? "保存中..." : "保存修改"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={isLogDialogOpen} onOpenChange={setIsLogDialogOpen}>
          <DialogContent className="sm:max-w-[760px]">
            <DialogHeader>
              <DialogTitle>检查日志</DialogTitle>
              <DialogDescription>
                {selectedCheck ? `查看 ${selectedCheck.name} 的最近执行日志` : "最近执行日志"}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[420px] overflow-auto rounded border">
              {actionLoadingKey === `logs-${selectedCheck?.id}` ? (
                <div className="py-8 text-center text-muted-foreground">加载中...</div>
              ) : logs.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">暂无日志</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>状态</TableHead>
                      <TableHead>状态码</TableHead>
                      <TableHead>响应耗时</TableHead>
                      <TableHead>错误信息</TableHead>
                      <TableHead>时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>{log.status}</TableCell>
                        <TableCell>{log.statusCode ?? "-"}</TableCell>
                        <TableCell>{typeof log.responseTime === "number" ? `${log.responseTime}ms` : "-"}</TableCell>
                        <TableCell className="max-w-[260px] truncate">{log.error || "-"}</TableCell>
                        <TableCell>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>删除健康检查</DialogTitle>
              <DialogDescription>
                确认删除“{deleteTarget?.name || '-'}”吗？删除后无法恢复。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>取消</Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={!deleteTarget || actionLoadingKey === `delete-${deleteTarget?.id}`}
              >
                {actionLoadingKey === `delete-${deleteTarget?.id}` ? "删除中..." : "确认删除"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">正常服务</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{summary.healthy}</div>
            <p className="text-xs text-muted-foreground">运行正常</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">异常服务</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{summary.unhealthy}</div>
            <p className="text-xs text-muted-foreground">需要关注</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">待检查</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{summary.pending}</div>
            <p className="text-xs text-muted-foreground">尚未执行</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>健康检查列表</CardTitle>
          <CardDescription>共 {checks.length} 个检查项</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-muted-foreground">加载中...</div>
          ) : error ? (
            <div className="py-10 text-center text-destructive">{error}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>方法</TableHead>
                  <TableHead>间隔</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最后检查</TableHead>
                  <TableHead>响应时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checks.map((check) => (
                  <TableRow key={check.id}>
                    <TableCell className="font-medium">{check.name}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{check.url}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{check.method}</Badge>
                    </TableCell>
                    <TableCell>{check.interval} 秒</TableCell>
                    <TableCell>{getStatusBadge(check.status)}</TableCell>
                    <TableCell>{check.lastChecked}</TableCell>
                    <TableCell>{check.responseTime}</TableCell>
                    <TableCell className="text-right">
                      <TooltipProvider>
                        <div className="flex justify-end gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRunCheck(check.id)}
                                disabled={actionLoadingKey === `run-${check.id}`}
                                aria-label="立即检查"
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>立即检查</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenLogs(check)}
                                disabled={actionLoadingKey === `logs-${check.id}`}
                                aria-label="查看日志"
                              >
                                <ScrollText className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>查看日志</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenEdit(check)}
                                disabled={actionLoadingKey === `edit-${check.id}`}
                                aria-label="编辑"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>编辑</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenDeleteDialog(check)}
                                disabled={actionLoadingKey === `delete-${check.id}`}
                                aria-label="删除"
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>删除</TooltipContent>
                          </Tooltip>
                        </div>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
