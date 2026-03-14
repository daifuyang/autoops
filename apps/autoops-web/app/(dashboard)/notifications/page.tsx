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
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Bell, Plus } from "lucide-react";
import { getApi } from "@/generated/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  level: string;
  source: string;
  status: string;
  channel: string;
  recipient?: string | null;
  taskId?: string | null;
  scheduledAt?: string | null;
  sentAt?: string | null;
  failedAt?: string | null;
  lastError?: string | null;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
};

export default function NotificationsPage() {
  const api = useMemo(() => getApi(), []);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<NotificationItem | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    message: "",
    level: "INFO",
    channel: "IN_APP",
    sendMode: "ASYNC",
    scheduledAt: "",
    recipient: "",
  });

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const pageItems = useMemo(() => {
    const pages: Array<number | "left-ellipsis" | "right-ellipsis"> = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }
    pages.push(1);
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    if (start > 2) pages.push("left-ellipsis");
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push("right-ellipsis");
    pages.push(totalPages);
    return pages;
  }, [currentPage, totalPages]);

  const fetchItems = useCallback(async (page = currentPage, size = pageSize) => {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.listNotifications({ page, pageSize: size });
      const data = response.data?.data;
      const list = Array.isArray(data) ? data : data?.items || [];
      setItems(list as NotificationItem[]);
      if (Array.isArray(data)) {
        setCurrentPage(page);
        setPageSize(size);
        setTotal(list.length);
      } else {
        setCurrentPage(Number(data?.page) || page);
        setPageSize(Number(data?.pageSize) || size);
        setTotal(Number(data?.total) || 0);
      }
    } catch {
      setItems([]);
      setError("获取通知列表失败");
    } finally {
      setIsLoading(false);
    }
  }, [api, currentPage, pageSize]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems, currentPage, pageSize]);

  const unreadCount = useMemo(() => items.filter((item) => !item.isRead).length, [items]);

  const handleCreate = async () => {
    if (!formData.title.trim() || !formData.message.trim()) {
      toast.error("请填写标题与内容");
      return;
    }
    if (formData.sendMode === "SCHEDULED" && !formData.scheduledAt) {
      toast.error("请选择定时发送时间");
      return;
    }
    setActionLoadingKey("create");
    try {
      const response = await api.createNotification({
        title: formData.title.trim(),
        message: formData.message.trim(),
        level: formData.level,
        channel: formData.channel,
        sendMode: formData.sendMode,
        scheduledAt: formData.sendMode === "SCHEDULED" ? new Date(formData.scheduledAt).toISOString() : undefined,
        recipient: formData.recipient || undefined,
      });
      if (response.data?.success) {
        toast.success(formData.sendMode === "SCHEDULED" ? "定时通知已创建" : "异步通知已创建");
        setIsCreateDialogOpen(false);
        setFormData({
          title: "",
          message: "",
          level: "INFO",
          channel: "IN_APP",
          sendMode: "ASYNC",
          scheduledAt: "",
          recipient: "",
        });
        if (currentPage !== 1) {
          setCurrentPage(1);
        } else {
          fetchItems(1, pageSize);
        }
      } else {
        toast.error(response.data?.msg || "创建失败");
      }
    } catch {
      toast.error("创建失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleRead = async (item: NotificationItem) => {
    if (item.isRead) return;
    setActionLoadingKey(`read-${item.id}`);
    try {
      const response = await api.markNotificationRead({ id: item.id });
      if (response.data?.success) {
        toast.success("已标记为已读");
        fetchItems(currentPage, pageSize);
      } else {
        toast.error(response.data?.msg || "标记失败");
      }
    } catch {
      toast.error("标记失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleOpenDelete = (item: NotificationItem) => {
    setSelectedItem(item);
    setIsDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedItem?.id) return;
    setActionLoadingKey(`delete-${selectedItem.id}`);
    try {
      const response = await api.deleteNotification({ id: selectedItem.id });
      if (response.data?.success) {
        toast.success("通知已删除");
        setIsDeleteDialogOpen(false);
        setSelectedItem(null);
        if (items.length === 1 && currentPage > 1) {
          setCurrentPage((prev) => Math.max(prev - 1, 1));
        } else {
          fetchItems(currentPage, pageSize);
        }
      } else {
        toast.error(response.data?.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    } finally {
      setActionLoadingKey(null);
    }
  };

  const levelBadge = (level: string) => {
    if (level === "ERROR") return <Badge variant="destructive">错误</Badge>;
    if (level === "WARNING") return <Badge className="bg-yellow-500">警告</Badge>;
    if (level === "SUCCESS") return <Badge className="bg-green-600">成功</Badge>;
    return <Badge variant="outline">信息</Badge>;
  };

  const statusBadge = (status: string) => {
    if (status === "SENT") return <Badge className="bg-green-600">已发送</Badge>;
    if (status === "FAILED") return <Badge variant="destructive">发送失败</Badge>;
    if (status === "CANCELLED") return <Badge variant="secondary">已取消</Badge>;
    return <Badge variant="outline">待发送</Badge>;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">通知管理</h1>
          <p className="text-muted-foreground">手动创建系统通知并统一查看通知列表</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新增通知
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>新增通知</DialogTitle>
              <DialogDescription>手动创建一条通知消息</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>标题</Label>
                <Input value={formData.title} onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>内容</Label>
                <Input value={formData.message} onChange={(e) => setFormData((prev) => ({ ...prev, message: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>级别</Label>
                  <Select value={formData.level} onValueChange={(value) => setFormData((prev) => ({ ...prev, level: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INFO">信息</SelectItem>
                      <SelectItem value="SUCCESS">成功</SelectItem>
                      <SelectItem value="WARNING">警告</SelectItem>
                      <SelectItem value="ERROR">错误</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>通道</Label>
                  <Select value={formData.channel} onValueChange={(value) => setFormData((prev) => ({ ...prev, channel: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IN_APP">站内</SelectItem>
                      <SelectItem value="EMAIL">邮件</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>发送方式</Label>
                  <Select value={formData.sendMode} onValueChange={(value) => setFormData((prev) => ({ ...prev, sendMode: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ASYNC">异步立即</SelectItem>
                      <SelectItem value="SCHEDULED">定时发送</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>计划时间</Label>
                  <Input
                    type="datetime-local"
                    value={formData.scheduledAt}
                    disabled={formData.sendMode !== "SCHEDULED"}
                    onChange={(e) => setFormData((prev) => ({ ...prev, scheduledAt: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>接收方</Label>
                <Input
                  value={formData.recipient}
                  placeholder="邮箱/用户标识（可选）"
                  onChange={(e) => setFormData((prev) => ({ ...prev, recipient: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={actionLoadingKey === "create"}>
                {actionLoadingKey === "create" ? "创建中..." : "确认创建"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">总通知数</CardTitle>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">未读通知</CardTitle>
            <Bell className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{unreadCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>通知列表</CardTitle>
          <CardDescription>支持标记已读与删除</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">加载中...</div>
          ) : error ? (
            <div className="py-8 text-center text-destructive">{error}</div>
          ) : (
            <div className="space-y-4 overflow-hidden">
              <div className="w-full overflow-x-auto">
                <TooltipProvider>
                <Table className="min-w-[960px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead>标题</TableHead>
                    <TableHead>级别</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>发送状态</TableHead>
                    <TableHead>发送方式</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length > 0 ? items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="max-w-[360px] align-top">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-default font-medium [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden break-all">
                              {item.title}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[420px] break-all whitespace-pre-wrap" side="top" align="start">
                            {item.title}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="mt-0.5 cursor-default text-xs text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden break-all">
                              {item.message}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[420px] break-all whitespace-pre-wrap" side="top" align="start">
                            {item.message}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>{levelBadge(item.level)}</TableCell>
                      <TableCell>{item.source === "MANUAL" ? "手动" : "系统"}</TableCell>
                      <TableCell>{statusBadge(item.status)}</TableCell>
                      <TableCell>{item.scheduledAt ? "定时" : "异步"}</TableCell>
                      <TableCell>
                        {item.sentAt
                          ? new Date(item.sentAt).toLocaleString()
                          : item.scheduledAt
                            ? new Date(item.scheduledAt).toLocaleString()
                            : new Date(item.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right align-top">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRead(item)}
                            disabled={item.isRead || actionLoadingKey === `read-${item.id}`}
                          >
                            标记已读
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleOpenDelete(item)}
                            disabled={actionLoadingKey === `delete-${item.id}`}
                          >
                            删除
                          </Button>
                        </div>
                        {item.status === "FAILED" && item.lastError ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="mt-1 cursor-default text-right text-xs text-destructive [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden break-all">
                                {item.lastError}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[420px] break-all whitespace-pre-wrap" side="top" align="end">
                              {item.lastError}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        暂无通知数据
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
                </Table>
                </TooltipProvider>
              </div>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-muted-foreground">
                  第 {currentPage} / {totalPages} 页，共 {total} 条
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setCurrentPage(1);
                      setPageSize(Number(value));
                    }}
                  >
                    <SelectTrigger className="w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10 / 页</SelectItem>
                      <SelectItem value="20">20 / 页</SelectItem>
                      <SelectItem value="50">50 / 页</SelectItem>
                    </SelectContent>
                  </Select>
                  <Pagination className="mx-0 w-auto justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          className={cn((currentPage <= 1 || isLoading) && "pointer-events-none opacity-50")}
                          onClick={(e) => {
                            e.preventDefault();
                            if (currentPage > 1 && !isLoading) {
                              setCurrentPage((prev) => Math.max(prev - 1, 1));
                            }
                          }}
                        />
                      </PaginationItem>
                      {pageItems.map((item, index) => (
                        <PaginationItem key={`${item}-${index}`}>
                          {typeof item === "number" ? (
                            <PaginationLink
                              href="#"
                              isActive={item === currentPage}
                              onClick={(e) => {
                                e.preventDefault();
                                if (!isLoading && item !== currentPage) {
                                  setCurrentPage(item);
                                }
                              }}
                            >
                              {item}
                            </PaginationLink>
                          ) : (
                            <PaginationEllipsis />
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          className={cn((currentPage >= totalPages || isLoading) && "pointer-events-none opacity-50")}
                          onClick={(e) => {
                            e.preventDefault();
                            if (currentPage < totalPages && !isLoading) {
                              setCurrentPage((prev) => Math.min(prev + 1, totalPages));
                            }
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>删除通知</DialogTitle>
            <DialogDescription>确认删除“{selectedItem?.title || "-"}”吗？该操作不可恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={actionLoadingKey === `delete-${selectedItem?.id}`}>
              {actionLoadingKey === `delete-${selectedItem?.id}` ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
