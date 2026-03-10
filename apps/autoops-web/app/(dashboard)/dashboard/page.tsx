"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getApi, ListCertificatesDataItemSchema, ListHealthChecksDataItemSchema, ProviderSchema, ScheduledTask } from "@/generated/api";
import { Shield, Server, HeartPulse, CheckCircle, XCircle, Clock } from "lucide-react";

export default function DashboardPage() {
  const api = useMemo(() => getApi(), []);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [certificates, setCertificates] = useState<ListCertificatesDataItemSchema[]>([]);
  const [providers, setProviders] = useState<ProviderSchema[]>([]);
  const [healthChecks, setHealthChecks] = useState<ListHealthChecksDataItemSchema[]>([]);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);

  const fetchOverview = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [certRes, providerRes, healthRes, taskRes] = await Promise.all([
        api.listCertificates({ page: 1, pageSize: 50 }),
        api.listProviders({ page: 1, pageSize: 50 }),
        api.listHealthChecks({ page: 1, pageSize: 50 }),
        api.listTasks({
          page: 1,
          pageSize: 20,
        }),
      ]);
      const certData = certRes.data?.data;
      const providerData = providerRes.data?.data;
      const healthData = healthRes.data?.data;
      const taskData = taskRes.data?.data;
      setCertificates(Array.isArray(certData) ? certData : certData?.items || []);
      setProviders(Array.isArray(providerData) ? providerData : providerData?.items || []);
      setHealthChecks(Array.isArray(healthData) ? healthData : healthData?.items || []);
      setTasks(Array.isArray(taskData) ? taskData : taskData?.items || []);
    } catch {
      setError("概览数据加载失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const toDaysLeft = (expiresAt?: string | null) => {
    if (!expiresAt) return null;
    const ts = new Date(expiresAt).getTime();
    if (Number.isNaN(ts)) return null;
    return Math.ceil((ts - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const summary = useMemo(() => {
    const expiring = certificates.filter((item) => {
      const days = toDaysLeft(item.expiresAt);
      return days !== null && days >= 0 && days <= 30;
    }).length;
    const activeProviders = providers.filter((item) => item.isActive !== false).length;
    const downChecks = healthChecks.filter((item) => (item.lastStatus || "").toUpperCase() === "DOWN").length;
    return {
      certTotal: certificates.length,
      certExpiring: expiring,
      providerTotal: providers.length,
      providerActive: activeProviders,
      healthTotal: healthChecks.length,
      healthDown: downChecks,
    };
  }, [certificates, providers, healthChecks]);

  const stats = [
    {
      title: "证书总数",
      value: String(summary.certTotal),
      icon: Shield,
      description: `${summary.certExpiring} 个即将过期`,
    },
    {
      title: "服务商配置",
      value: String(summary.providerTotal),
      icon: Server,
      description: `${summary.providerActive} 个启用中`,
    },
    {
      title: "健康检查",
      value: String(summary.healthTotal),
      icon: HeartPulse,
      description: `${summary.healthDown} 个异常`,
    },
  ];

  const recentTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      const t1 = new Date(a.createdAt).getTime();
      const t2 = new Date(b.createdAt).getTime();
      return t2 - t1;
    });
    return sorted.slice(0, 6).map((item) => {
      const status = item.status === "FAILED"
        ? "failed"
        : item.status === "RUNNING"
          ? "running"
          : "success";
      const diffMs = Date.now() - new Date(item.createdAt).getTime();
      const mins = Math.max(Math.floor(diffMs / 60000), 0);
      const time = mins < 1 ? "刚刚" : mins < 60 ? `${mins}分钟前` : `${Math.floor(mins / 60)}小时前`;
      return {
        id: item.id,
        name: item.name,
        status,
        time,
      };
    });
  }, [tasks]);

  const expiringCertificates = useMemo(() => {
    return certificates
      .map((item) => ({ domain: item.domain || "-", days: toDaysLeft(item.expiresAt) }))
      .filter((item) => item.days !== null && (item.days as number) >= 0)
      .sort((a, b) => (a.days as number) - (b.days as number))
      .slice(0, 5) as { domain: string; days: number }[];
  }, [certificates]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">概览</h1>
        <p className="text-muted-foreground">
          欢迎回来，这里是您的自动化运维仪表板
        </p>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-muted-foreground">加载中...</div>
      ) : error ? (
        <div className="py-10 text-center text-destructive">{error}</div>
      ) : (
        <>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {stats.map((stat) => (
              <Card key={stat.title}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground">{stat.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>最近任务</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentTasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无任务记录</p>
                  ) : recentTasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {task.status === "success" && (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        )}
                        {task.status === "failed" && (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        {task.status === "running" && (
                          <Clock className="h-4 w-4 text-blue-500" />
                        )}
                        <span className="text-sm">{task.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            task.status === "success"
                              ? "default"
                              : task.status === "failed"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {task.status === "success" && "成功"}
                          {task.status === "failed" && "失败"}
                          {task.status === "running" && "进行中"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{task.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>即将过期的证书</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {expiringCertificates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无即将过期证书</p>
                  ) : expiringCertificates.map((cert) => (
                    <div key={cert.domain} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Shield className="h-4 w-4 text-orange-500" />
                        <span className="text-sm">{cert.domain}</span>
                      </div>
                      <Badge variant={cert.days <= 7 ? "destructive" : "secondary"}>
                        {cert.days} 天后过期
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

    </div>
  );
}
