"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  getApi,
  CreateProviderBody,
  ProviderFieldSchema,
  ProviderTypeSchema,
  ProviderSchema,
} from "@/generated/api";
import { Server, Plus, Loader2, FlaskConical, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

const createProviderSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空"),
  type: z.string().trim().min(1, "类型不能为空"),
  description: z.string().optional(),
  credentials: z.object({}).catchall(z.string()),
  config: z.object({}).catchall(z.unknown()).optional(),
});

const editProviderSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空"),
  description: z.string().optional(),
  isActive: z.boolean(),
  credentials: z.object({}).catchall(z.string()).optional(),
  config: z.object({}).catchall(z.string()).optional(),
});

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderSchema[]>([]);
  const [providerTypes, setProviderTypes] = useState<ProviderTypeSchema[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ProviderTypeSchema | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderSchema | null>(null);
  const [editingProviderType, setEditingProviderType] = useState<ProviderTypeSchema | null>(null);

  const form = useForm<z.infer<typeof createProviderSchema>>({
    resolver: zodResolver(createProviderSchema),
    defaultValues: {
      name: "",
      type: "",
      description: "",
      credentials: {},
      config: {},
    },
  });

  const editForm = useForm<z.infer<typeof editProviderSchema>>({
    resolver: zodResolver(editProviderSchema),
    defaultValues: {
      name: "",
      description: "",
      isActive: true,
      credentials: {},
      config: {},
    },
  });

  const api = useMemo(() => getApi(), []);

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "response" in error &&
      typeof (error as { response?: unknown }).response === "object" &&
      (error as { response?: unknown }).response !== null &&
      "data" in ((error as { response?: { data?: unknown } }).response || {}) &&
      typeof ((error as { response?: { data?: { msg?: unknown } } }).response?.data?.msg) === "string"
    ) {
      return (error as { response?: { data?: { msg?: string } } }).response?.data?.msg || fallback;
    }
    return fallback;
  };

  // 获取服务商列表
  const fetchProviders = useCallback(async () => {
    try {
      const response = await api.listProviders({ page: 1, pageSize: 50 });
      if (response.data?.success && response.data.data) {
        const list = Array.isArray(response.data.data) ? response.data.data : response.data.data.items || [];
        setProviders(list);
      }
    } catch {
      toast.error("获取服务商列表失败");
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  // 获取服务商类型
  const fetchProviderTypes = useCallback(async () => {
    try {
      const response = await api.listProviderTypes();
      if (response.data?.success && response.data.data) {
        setProviderTypes(response.data.data);
      }
    } catch {
      toast.error("获取服务商类型失败");
    }
  }, [api]);

  useEffect(() => {
    fetchProviders();
    fetchProviderTypes();
  }, [fetchProviderTypes, fetchProviders]);

  // 创建服务商
  const onSubmit = async (values: z.infer<typeof createProviderSchema>) => {
    try {
      const createProviderBody: CreateProviderBody = {
        name: values.name,
        type: values.type,
        description: values.description,
        credentials: values.credentials,
        config: values.config,
      };

      const response = await api.createProvider(createProviderBody);

      if (response.data?.success) {
        toast.success("创建成功");
        setIsDialogOpen(false);
        form.reset();
        fetchProviders();
      } else {
        toast.error(response.data?.msg || "创建失败");
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "创建失败"));
    }
  };

  // 删除服务商
  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个服务商吗？")) return;

    try {
      await api.deleteProvider({ id });
      toast.success("删除成功");
      fetchProviders();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "删除失败"));
    }
  };

  const handleEditOpen = (provider: ProviderSchema) => {
    if (!provider.id) return;
    const providerType = providerTypes.find((pt) => pt.type === provider.type) || null;
    setEditingProvider(provider);
    setEditingProviderType(providerType);
    editForm.reset({
      name: provider.name || "",
      description: provider.description || "",
      isActive: provider.isActive !== false,
      credentials: {},
      config: {},
    });
    setIsEditDialogOpen(true);
  };

  const handleEditSubmit = async (values: z.infer<typeof editProviderSchema>) => {
    if (!editingProvider?.id) return;
    const credentials = Object.fromEntries(
      Object.entries(values.credentials || {}).filter(([, value]) => String(value || "").trim() !== "")
    );
    const config = Object.fromEntries(
      Object.entries(values.config || {}).filter(([, value]) => String(value || "").trim() !== "")
    );
    try {
      const response = await api.updateProvider(
        { id: editingProvider.id },
        {
          name: values.name,
          description: values.description || undefined,
          isActive: values.isActive,
          credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
          config: Object.keys(config).length > 0 ? config : undefined,
        }
      );
      if (response.data?.success) {
        toast.success("更新成功");
        setIsEditDialogOpen(false);
        setEditingProvider(null);
        setEditingProviderType(null);
        fetchProviders();
      } else {
        toast.error(response.data?.msg || "更新失败");
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "更新失败"));
    }
  };

  // 测试连通性
  const handleTest = async (id: string) => {
    setTestingProvider(id);
    try {
      const response = await api.testProvider({ id });
      if (response.data?.success) {
        toast.success("连接测试成功");
      } else {
        toast.error(response.data?.msg || "连接测试失败");
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "连接测试失败"));
    } finally {
      setTestingProvider(null);
    }
  };

  // 类型变更时更新表单
  const handleTypeChange = (type: string) => {
    const pt = providerTypes.find((p) => p.type === type);
    setSelectedType(pt || null);
    form.setValue("type", type);

    // 初始化 credentials 默认值
    if (pt && pt.credentialFields) {
      const defaultCredentials: Record<string, string> = {};
      pt.credentialFields.forEach((field: ProviderFieldSchema) => {
        if (field.name) {
          defaultCredentials[field.name] = "";
        }
      });
      form.setValue("credentials", defaultCredentials);
    }
  };

  // 获取分类颜色
  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      dns: "bg-blue-100 text-blue-800",
      cdn: "bg-purple-100 text-purple-800",
      email: "bg-green-100 text-green-800",
      storage: "bg-orange-100 text-orange-800",
    };
    return colors[category] || "bg-gray-100 text-gray-800";
  };

  // 获取分类名称
  const getCategoryName = (category: string) => {
    const names: Record<string, string> = {
      dns: "DNS",
      cdn: "CDN",
      email: "邮件",
      storage: "存储",
    };
    return names[category] || category;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">服务商管理</h1>
          <p className="text-muted-foreground">
            管理 DNS、CDN、邮件等服务商配置
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              添加服务商
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>添加服务商</DialogTitle>
              <DialogDescription>
                配置新的服务商连接信息
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>名称</FormLabel>
                      <FormControl>
                        <Input placeholder="例如：阿里云 DNS" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>类型</FormLabel>
                      <Select
                        onValueChange={handleTypeChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="选择服务商类型" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {providerTypes.map((pt) => (
                            <SelectItem key={pt.type} value={pt.type!}>
                              {pt.name} ({getCategoryName(pt.category!)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>描述</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="可选描述"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {selectedType && selectedType.credentialFields && (
                  <div className="space-y-4 rounded-lg border p-4">
                    <h4 className="font-medium">认证信息</h4>
                    {selectedType.credentialFields
                      .filter((cf: ProviderFieldSchema) => Boolean(cf.name))
                      .map((cf: ProviderFieldSchema) => (
                      <FormField
                        key={cf.name!}
                        control={form.control}
                        name={`credentials.${cf.name!}`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              {cf.label}
                              {cf.required && (
                                <span className="text-red-500">*</span>
                              )}
                            </FormLabel>
                            <FormControl>
                              <Input
                                type={cf.type === "password" ? "password" : "text"}
                                placeholder={cf.description || ""}
                                value={field.value ?? ""}
                                onChange={field.onChange}
                                onBlur={field.onBlur}
                                name={field.name}
                                ref={field.ref}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                )}

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    取消
                  </Button>
                  <Button type="submit">确定</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={isEditDialogOpen}
          onOpenChange={(open) => {
            setIsEditDialogOpen(open);
            if (!open) {
              setEditingProvider(null);
              setEditingProviderType(null);
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>编辑服务商</DialogTitle>
              <DialogDescription>修改服务商名称、描述和启用状态</DialogDescription>
            </DialogHeader>
            <Form {...editForm}>
              <form
                onSubmit={editForm.handleSubmit(handleEditSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={editForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>名称</FormLabel>
                      <FormControl>
                        <Input placeholder="服务商名称" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>描述</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="可选描述"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {editingProviderType?.credentialFields && editingProviderType.credentialFields.length > 0 ? (
                  <div className="space-y-4 rounded-lg border p-4">
                    <h4 className="font-medium">更新认证信息</h4>
                    {editingProviderType.credentialFields
                      .filter((cf: ProviderFieldSchema) => Boolean(cf.name))
                      .map((cf: ProviderFieldSchema) => (
                        <FormField
                          key={cf.name!}
                          control={editForm.control}
                          name={`credentials.${cf.name!}`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{cf.label || cf.name}</FormLabel>
                              <FormControl>
                                <Input
                                  type={cf.type === "password" ? "password" : "text"}
                                  placeholder={cf.description || "留空则不更新"}
                                  value={field.value ?? ""}
                                  onChange={field.onChange}
                                  onBlur={field.onBlur}
                                  name={field.name}
                                  ref={field.ref}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ))}
                  </div>
                ) : null}
                {editingProviderType?.configFields && editingProviderType.configFields.length > 0 ? (
                  <div className="space-y-4 rounded-lg border p-4">
                    <h4 className="font-medium">更新配置信息</h4>
                    {editingProviderType.configFields
                      .filter((cf: ProviderFieldSchema) => Boolean(cf.name))
                      .map((cf: ProviderFieldSchema) => (
                        <FormField
                          key={cf.name!}
                          control={editForm.control}
                          name={`config.${cf.name!}`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{cf.label || cf.name}</FormLabel>
                              <FormControl>
                                <Input
                                  type={cf.type === "password" ? "password" : "text"}
                                  placeholder={cf.description || "留空则不更新"}
                                  value={field.value ?? ""}
                                  onChange={field.onChange}
                                  onBlur={field.onBlur}
                                  name={field.name}
                                  ref={field.ref}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ))}
                  </div>
                ) : null}
                <FormField
                  control={editForm.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>状态</FormLabel>
                      <Select
                        value={String(field.value)}
                        onValueChange={(value) => field.onChange(value === "true")}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="true">启用</SelectItem>
                          <SelectItem value="false">禁用</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEditDialogOpen(false)}
                  >
                    取消
                  </Button>
                  <Button type="submit">保存</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            服务商列表
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : providers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Server className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">暂无服务商</h3>
              <p className="text-muted-foreground">
                点击上方按钮添加第一个服务商
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell className="font-medium">
                      {provider.name}
                    </TableCell>
                    <TableCell>{provider.type}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={getCategoryColor(provider.category || "")}
                      >
                        {getCategoryName(provider.category || "")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={provider.isActive ? "default" : "secondary"}
                      >
                        {provider.isActive ? "启用" : "禁用"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {provider.createdAt ? new Date(provider.createdAt).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                aria-label="测试连通性"
                                onClick={() => provider.id && handleTest(provider.id)}
                                disabled={!provider.id || testingProvider === provider.id}
                              >
                                {testingProvider === provider.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <FlaskConical className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{testingProvider === provider.id ? "测试中" : "测试连通性"}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                aria-label="编辑服务商"
                                onClick={() => handleEditOpen(provider)}
                                disabled={!provider.id}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>编辑服务商</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive/90 hover:text-destructive"
                                aria-label="删除服务商"
                                onClick={() => provider.id && handleDelete(provider.id)}
                                disabled={!provider.id}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>删除服务商</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
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
