"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Eye, EyeOff, Lock, User } from "lucide-react";
import { getApi, LoginBody } from "@/generated/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const api = getApi();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const loginBody: LoginBody = { username, password };
      const response = await api.login(loginBody);
      
      if (response.data?.success && response.data?.data) {
        router.push("/dashboard");
      } else {
        setError(response.data?.msg || "登录失败");
      }
    } catch (err: any) {
      setError(err.response?.data?.msg || "网络错误，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      {/* 背景装饰 - 移动端简化 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[200px] h-[200px] sm:w-[500px] sm:h-[500px] bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-[200px] h-[200px] sm:w-[500px] sm:h-[500px] bg-muted rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
      </div>

      {/* 主内容区 - 移动端去掉卡片，直接全屏 */}
      <div className="flex-1 flex flex-col justify-center items-center p-4 sm:p-6 relative z-10">
        {/* 移动端：无卡片全屏布局 / 桌面端：卡片布局 */}
        <div className="w-full max-w-[360px] sm:max-w-[400px]">
          {/* 移动端无卡片，桌面端有卡片 */}
          <Card className="shadow-none border-0 sm:shadow-lg sm:border bg-transparent sm:bg-card">
            <CardHeader className="space-y-4 sm:space-y-6 pb-6 sm:pb-8 pt-2 sm:pt-8 px-0 sm:px-6">
              <div className="flex flex-col items-center space-y-3 sm:space-y-4">
                {/* Logo - 移动端更大 */}
                <div className="w-14 h-14 sm:w-14 sm:h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
                  <Shield className="w-7 h-7 sm:w-7 sm:h-7 text-primary-foreground" />
                </div>
                <div className="text-center">
                  <CardTitle className="text-[22px] sm:text-2xl font-bold tracking-tight">
                    自动化运维平台
                  </CardTitle>
                  <CardDescription className="text-muted-foreground mt-2 text-sm sm:text-sm">
                    证书管理 · 健康检查 · 邮件推送
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pb-4 sm:pb-8 px-0 sm:px-6">
              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-sm font-medium">用户名</Label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground" />
                    <Input
                      id="username"
                      type="text"
                      placeholder="请输入用户名"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="pl-11 h-12 text-base sm:h-11 sm:text-sm"
                      required
                      autoComplete="username"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium">密码</Label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="请输入密码"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-11 pr-11 h-12 text-base sm:h-11 sm:text-sm"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                    >
                      {showPassword ? (
                        <EyeOff className="w-[18px] h-[18px]" />
                      ) : (
                        <Eye className="w-[18px] h-[18px]" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-sm text-destructive text-center">{error}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 sm:h-11 mt-2 text-base sm:text-sm font-medium"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      <span>登录中...</span>
                    </div>
                  ) : (
                    "登录"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 版权信息 - 移动端固定在底部 */}
      <div className="py-4 sm:py-0 sm:fixed sm:bottom-4 left-0 right-0 text-center px-4 relative z-10">
        <p className="text-xs text-muted-foreground">
          © {currentYear} AutoOps Platform. All rights reserved.
        </p>
      </div>
    </div>
  );
}
