"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getApi } from "@/generated/api";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const api = getApi();
      try {
        const response = await api.getCurrentUser();
        if (response.data?.success) {
          router.push("/dashboard");
          return;
        }
      } catch {
      }
      router.push("/login");
    };
    checkAuth();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <span>加载中...</span>
      </div>
    </div>
  );
}
