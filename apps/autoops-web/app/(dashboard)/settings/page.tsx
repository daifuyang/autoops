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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Bell, Database, Mail } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getApi, UpdateSystemSettingsBody } from "@/generated/api";
import { toast } from "sonner";

type EmailConfigItem = {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  fromName?: string | null;
  isActive: boolean;
  authUser: string;
  hasPassword: boolean;
};

type SystemSettingsState = {
  general: {
    siteName: string;
    maintenanceMode: boolean;
  };
  notifications: {
    certExpiryReminder: boolean;
    healthCheckAlert: boolean;
  };
  system: {
    autoCleanupLogs: boolean;
    appVersion: string;
    nodeVersion: string;
    database: string;
    databaseVersion: string;
    redis: string;
    redisVersion: string;
  };
};

const defaultSettingsState: SystemSettingsState = {
  general: {
    siteName: "自动化运维平台",
    maintenanceMode: false,
  },
  notifications: {
    certExpiryReminder: true,
    healthCheckAlert: true,
  },
  system: {
    autoCleanupLogs: true,
    appVersion: "v1.0.0",
    nodeVersion: "-",
    database: "异常",
    databaseVersion: "-",
    redis: "异常",
    redisVersion: "-",
  },
};

export default function SettingsPage() {
  const api = useMemo(() => getApi(), []);
  const [settings, setSettings] = useState<SystemSettingsState>(defaultSettingsState);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [configs, setConfigs] = useState<EmailConfigItem[]>([]);
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailError, setEmailError] = useState("");
  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
  const [isTestDialogOpen, setIsTestDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<EmailConfigItem | null>(null);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState({
    id: "",
    name: "",
    host: "",
    port: 465,
    secure: true,
    from: "",
    fromName: "",
    authUser: "",
    authPass: "",
    isActive: true,
  });
  const [testForm, setTestForm] = useState({
    to: "",
    subject: "AutoOps 测试邮件",
    content: "这是一封测试邮件，用于验证 SMTP 配置是否可用。",
  });

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const response = await api.getSystemSettings();
      const data = response.data?.data;
      if (!data) {
        setSettings(defaultSettingsState);
      } else {
        setSettings({
          general: {
            siteName: data.general?.siteName || defaultSettingsState.general.siteName,
            maintenanceMode: data.general?.maintenanceMode ?? defaultSettingsState.general.maintenanceMode,
          },
          notifications: {
            certExpiryReminder: data.notifications?.certExpiryReminder ?? defaultSettingsState.notifications.certExpiryReminder,
            healthCheckAlert: data.notifications?.healthCheckAlert ?? defaultSettingsState.notifications.healthCheckAlert,
          },
          system: {
            autoCleanupLogs: data.system?.autoCleanupLogs ?? defaultSettingsState.system.autoCleanupLogs,
            appVersion: data.system?.appVersion || defaultSettingsState.system.appVersion,
            nodeVersion: data.system?.nodeVersion || defaultSettingsState.system.nodeVersion,
            database: data.system?.database || defaultSettingsState.system.database,
            databaseVersion: data.system?.databaseVersion || defaultSettingsState.system.databaseVersion,
            redis: data.system?.redis || defaultSettingsState.system.redis,
            redisVersion: data.system?.redisVersion || defaultSettingsState.system.redisVersion,
          },
        });
      }
    } catch {
      setSettings(defaultSettingsState);
      setSettingsError("系统设置加载失败");
    } finally {
      setSettingsLoading(false);
    }
  }, [api]);

  const fetchEmailConfigs = useCallback(async () => {
    setEmailLoading(true);
    setEmailError("");
    try {
      const response = await api.listEmailConfigs({ page: 1, pageSize: 50 });
      const data = response.data?.data;
      const items = Array.isArray(data) ? data : data?.items || [];
      setConfigs(items as EmailConfigItem[]);
    } catch {
      setConfigs([]);
      setEmailError("获取邮件配置失败");
    } finally {
      setEmailLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchEmailConfigs();
  }, [fetchEmailConfigs]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const resetConfigForm = () => {
    setConfigForm({
      id: "",
      name: "",
      host: "",
      port: 465,
      secure: true,
      from: "",
      fromName: "",
      authUser: "",
      authPass: "",
      isActive: true,
    });
  };

  const handleOpenCreate = () => {
    resetConfigForm();
    setIsConfigDialogOpen(true);
  };

  const handleOpenEdit = (config: EmailConfigItem) => {
    setSelectedConfig(config);
    setConfigForm({
      id: config.id,
      name: config.name,
      host: config.host,
      port: config.port,
      secure: config.secure,
      from: config.from,
      fromName: config.fromName || "",
      authUser: config.authUser,
      authPass: "",
      isActive: config.isActive,
    });
    setIsConfigDialogOpen(true);
  };

  const handleSaveConfig = async () => {
    if (!configForm.name.trim() || !configForm.host.trim() || !configForm.from.trim() || !configForm.authUser.trim()) {
      toast.error("请填写完整配置");
      return;
    }
    if (!configForm.id && !configForm.authPass.trim()) {
      toast.error("新建配置必须填写密码");
      return;
    }
    const key = configForm.id ? `update-${configForm.id}` : "create";
    setActionLoadingKey(key);
    try {
      if (configForm.id) {
        const response = await api.updateEmailConfig(
          { id: configForm.id },
          {
            name: configForm.name,
            host: configForm.host,
            port: Number(configForm.port),
            secure: configForm.secure,
            from: configForm.from,
            fromName: configForm.fromName || undefined,
            authUser: configForm.authUser,
            authPass: configForm.authPass || undefined,
            isActive: configForm.isActive,
          }
        );
        if (!response.data?.success) {
          toast.error(response.data?.msg || "更新失败");
          return;
        }
        toast.success("邮件配置已更新");
      } else {
        const response = await api.createEmailConfig({
          name: configForm.name,
          host: configForm.host,
          port: Number(configForm.port),
          secure: configForm.secure,
          from: configForm.from,
          fromName: configForm.fromName || undefined,
          authUser: configForm.authUser,
          authPass: configForm.authPass,
          isActive: configForm.isActive,
        });
        if (!response.data?.success) {
          toast.error(response.data?.msg || "创建失败");
          return;
        }
        toast.success("邮件配置已创建");
      }
      setIsConfigDialogOpen(false);
      setSelectedConfig(null);
      resetConfigForm();
      fetchEmailConfigs();
    } catch {
      toast.error("保存失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleOpenTest = (config: EmailConfigItem) => {
    setSelectedConfig(config);
    setTestForm({
      to: config.authUser || "",
      subject: "AutoOps 测试邮件",
      content: "这是一封测试邮件，用于验证 SMTP 配置是否可用。",
    });
    setIsTestDialogOpen(true);
  };

  const handleSendTest = async () => {
    if (!selectedConfig?.id) return;
    if (!testForm.to.trim()) {
      toast.error("请填写收件人");
      return;
    }
    setActionLoadingKey(`test-${selectedConfig.id}`);
    try {
      const response = await api.testEmailConfig({ id: selectedConfig.id }, {
        to: testForm.to,
        subject: testForm.subject,
        content: testForm.content,
      });
      if (response.data?.success) {
        toast.success("测试邮件发送成功");
        setIsTestDialogOpen(false);
      } else {
        toast.error(response.data?.msg || "测试发送失败");
      }
    } catch {
      toast.error("测试发送失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleOpenDelete = (config: EmailConfigItem) => {
    setSelectedConfig(config);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfig = async () => {
    if (!selectedConfig?.id) return;
    setActionLoadingKey(`delete-${selectedConfig.id}`);
    try {
      const response = await api.deleteEmailConfig({ id: selectedConfig.id });
      if (response.data?.success) {
        toast.success("邮件配置已删除");
        setIsDeleteDialogOpen(false);
        setSelectedConfig(null);
        fetchEmailConfigs();
      } else {
        toast.error(response.data?.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleSaveSettings = async () => {
    setActionLoadingKey("save-settings");
    try {
      const payload: UpdateSystemSettingsBody = {
        general: {
          siteName: settings.general.siteName,
          maintenanceMode: settings.general.maintenanceMode,
        },
        notifications: {
          certExpiryReminder: settings.notifications.certExpiryReminder,
          healthCheckAlert: settings.notifications.healthCheckAlert,
        },
        system: {
          autoCleanupLogs: settings.system.autoCleanupLogs,
        },
      };
      const response = await api.updateSystemSettings(payload);
      if (!response.data?.success) {
        toast.error(response.data?.msg || "保存失败");
        return;
      }
      toast.success("系统设置已保存");
      await fetchSettings();
    } catch {
      toast.error("保存失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">设置</h1>
        <p className="text-muted-foreground">
          管理系统配置和个性化设置
        </p>
        {settingsError ? (
          <p className="mt-2 text-sm text-destructive">{settingsError}</p>
        ) : null}
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList>
          <TabsTrigger value="general">常规</TabsTrigger>
          <TabsTrigger value="notifications">通知</TabsTrigger>
          <TabsTrigger value="system">系统</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>常规设置</CardTitle>
              <CardDescription>
                配置系统的基本参数
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="siteName">站点名称</Label>
                <Input
                  id="siteName"
                  value={settings.general.siteName}
                  onChange={(e) => setSettings((prev) => ({
                    ...prev,
                    general: { ...prev.general, siteName: e.target.value },
                  }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>维护模式</Label>
                  <p className="text-sm text-muted-foreground">
                    启用后只有管理员可以访问系统
                  </p>
                </div>
                <Switch
                  checked={settings.general.maintenanceMode}
                  onCheckedChange={(checked) => setSettings((prev) => ({
                    ...prev,
                    general: { ...prev.general, maintenanceMode: checked },
                  }))}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                通知设置
              </CardTitle>
              <CardDescription>
                配置邮件和消息通知
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>证书到期提醒</Label>
                  <p className="text-sm text-muted-foreground">
                    证书即将过期时发送邮件提醒
                  </p>
                </div>
                <Switch
                  checked={settings.notifications.certExpiryReminder}
                  onCheckedChange={(checked) => setSettings((prev) => ({
                    ...prev,
                    notifications: { ...prev.notifications, certExpiryReminder: checked },
                  }))}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>健康检查异常</Label>
                  <p className="text-sm text-muted-foreground">
                    服务健康检查失败时发送通知
                  </p>
                </div>
                <Switch
                  checked={settings.notifications.healthCheckAlert}
                  onCheckedChange={(checked) => setSettings((prev) => ({
                    ...prev,
                    notifications: { ...prev.notifications, healthCheckAlert: checked },
                  }))}
                />
              </div>
              <Separator />
              <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">
                任务执行仅在失败时自动通知，成功结果默认静默。
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                邮件配置
              </CardTitle>
              <CardDescription>
                管理 SMTP 服务并支持测试发送
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-end">
                <Dialog open={isConfigDialogOpen} onOpenChange={setIsConfigDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={handleOpenCreate}>新增配置</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                      <DialogTitle>{configForm.id ? "编辑邮件配置" : "新增邮件配置"}</DialogTitle>
                      <DialogDescription>配置 SMTP 参数并保存</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label>配置名称</Label>
                        <Input value={configForm.name} onChange={(e) => setConfigForm((prev) => ({ ...prev, name: e.target.value }))} />
                      </div>
                      <div className="grid gap-2">
                        <Label>SMTP 服务器</Label>
                        <Input value={configForm.host} onChange={(e) => setConfigForm((prev) => ({ ...prev, host: e.target.value }))} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>端口</Label>
                          <Input type="number" value={configForm.port} onChange={(e) => setConfigForm((prev) => ({ ...prev, port: Number(e.target.value) || 465 }))} />
                        </div>
                        <div className="flex items-end justify-between rounded border px-3 py-2">
                          <div className="space-y-0.5">
                            <Label>SSL/TLS</Label>
                            <p className="text-xs text-muted-foreground">启用安全连接</p>
                          </div>
                          <Switch checked={configForm.secure} onCheckedChange={(checked) => setConfigForm((prev) => ({ ...prev, secure: checked }))} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>发件邮箱</Label>
                          <Input value={configForm.from} onChange={(e) => setConfigForm((prev) => ({ ...prev, from: e.target.value }))} />
                        </div>
                        <div className="grid gap-2">
                          <Label>发件人名称</Label>
                          <Input value={configForm.fromName} onChange={(e) => setConfigForm((prev) => ({ ...prev, fromName: e.target.value }))} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>SMTP 用户名</Label>
                          <Input value={configForm.authUser} onChange={(e) => setConfigForm((prev) => ({ ...prev, authUser: e.target.value }))} />
                        </div>
                        <div className="grid gap-2">
                          <Label>{configForm.id ? "SMTP 密码（留空不修改）" : "SMTP 密码"}</Label>
                          <Input type="password" value={configForm.authPass} onChange={(e) => setConfigForm((prev) => ({ ...prev, authPass: e.target.value }))} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between rounded border px-3 py-2">
                        <div className="space-y-0.5">
                          <Label>设为启用配置</Label>
                          <p className="text-xs text-muted-foreground">同一时间仅建议一个启用配置</p>
                        </div>
                        <Switch checked={configForm.isActive} onCheckedChange={(checked) => setConfigForm((prev) => ({ ...prev, isActive: checked }))} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsConfigDialogOpen(false)}>取消</Button>
                      <Button type="button" onClick={handleSaveConfig} disabled={actionLoadingKey === "create" || actionLoadingKey === `update-${configForm.id}`}>
                        {actionLoadingKey === "create" || actionLoadingKey === `update-${configForm.id}` ? "保存中..." : "保存"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              {emailLoading ? (
                <div className="py-8 text-center text-muted-foreground">加载中...</div>
              ) : emailError ? (
                <div className="py-8 text-center text-destructive">{emailError}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称</TableHead>
                      <TableHead>服务器</TableHead>
                      <TableHead>发件邮箱</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {configs.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.host}:{item.port}</TableCell>
                        <TableCell>{item.from}</TableCell>
                        <TableCell>{item.isActive ? "已启用" : "已停用"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleOpenTest(item)}>测试</Button>
                            <Button variant="outline" size="sm" onClick={() => handleOpenEdit(item)}>编辑</Button>
                            <Button variant="destructive" size="sm" onClick={() => handleOpenDelete(item)}>删除</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <Dialog open={isTestDialogOpen} onOpenChange={setIsTestDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>发送测试邮件</DialogTitle>
                    <DialogDescription>验证“{selectedConfig?.name || "-"}”连接是否可用</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label>收件人</Label>
                      <Input value={testForm.to} onChange={(e) => setTestForm((prev) => ({ ...prev, to: e.target.value }))} />
                    </div>
                    <div className="grid gap-2">
                      <Label>主题</Label>
                      <Input value={testForm.subject} onChange={(e) => setTestForm((prev) => ({ ...prev, subject: e.target.value }))} />
                    </div>
                    <div className="grid gap-2">
                      <Label>内容</Label>
                      <Input value={testForm.content} onChange={(e) => setTestForm((prev) => ({ ...prev, content: e.target.value }))} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsTestDialogOpen(false)}>取消</Button>
                    <Button onClick={handleSendTest} disabled={actionLoadingKey === `test-${selectedConfig?.id}`}>
                      {actionLoadingKey === `test-${selectedConfig?.id}` ? "发送中..." : "发送测试"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogContent className="sm:max-w-[420px]">
                  <DialogHeader>
                    <DialogTitle>删除邮件配置</DialogTitle>
                    <DialogDescription>确认删除“{selectedConfig?.name || "-"}”吗？删除后无法恢复。</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>取消</Button>
                    <Button variant="destructive" onClick={handleDeleteConfig} disabled={actionLoadingKey === `delete-${selectedConfig?.id}`}>
                      {actionLoadingKey === `delete-${selectedConfig?.id}` ? "删除中..." : "确认删除"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                系统信息
              </CardTitle>
              <CardDescription>
                查看系统状态和版本信息
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">系统版本</Label>
                  <p className="font-medium">{settings.system.appVersion}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Node.js 版本</Label>
                  <p className="font-medium">{settings.system.nodeVersion}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">数据库</Label>
                  <p className="font-medium">{settings.system.database} / {settings.system.databaseVersion}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Redis</Label>
                  <p className="font-medium">{settings.system.redis} / {settings.system.redisVersion}</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>自动清理日志</Label>
                  <p className="text-sm text-muted-foreground">
                    自动清理 30 天前的日志记录
                  </p>
                </div>
                <Switch
                  checked={settings.system.autoCleanupLogs}
                  onCheckedChange={(checked) => setSettings((prev) => ({
                    ...prev,
                    system: { ...prev.system, autoCleanupLogs: checked },
                  }))}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-4">
        <Button
          variant="outline"
          onClick={() => {
            fetchSettings();
            fetchEmailConfigs();
          }}
          disabled={settingsLoading || emailLoading}
        >
          刷新配置
        </Button>
        <Button onClick={handleSaveSettings} disabled={actionLoadingKey === "save-settings" || settingsLoading}>
          {actionLoadingKey === "save-settings" ? "保存中..." : "保存设置"}
        </Button>
      </div>
    </div>
  );
}
