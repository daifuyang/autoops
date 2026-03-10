"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Shield,
  Server,
  HeartPulse,
  Bell,
  LayoutDashboard,
  Settings,
  LogOut,
  Rocket,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getApi } from "@/generated/api";

const navItems = [
  {
    title: "概览",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "服务商管理",
    url: "/providers",
    icon: Server,
  },
  {
    title: "证书管理",
    url: "/certificates",
    icon: Shield,
  },
  {
    title: "健康检查",
    url: "/health",
    icon: HeartPulse,
  },
  {
    title: "通知管理",
    url: "/notifications",
    icon: Bell,
  },
  {
    title: "部署管理",
    url: "/deployments",
    icon: Rocket,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const api = getApi();
    
    try {
      // 调用后端退出登录接口
      await api.logout();
    } catch (err) {
      // 忽略错误，继续清除本地状态
    }
    
    // 跳转到登录页
    router.push("/login");
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Shield className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">自动化运维平台</span>
                  <span className="truncate text-xs">AutoOps</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.url || pathname.startsWith(`${item.url}/`)}
                tooltip={item.title}
              >
                <Link href={item.url}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="设置">
              <Link href="/settings">
                <Settings />
                <span>设置</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} tooltip="退出登录">
              <LogOut />
              <span>退出登录</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
