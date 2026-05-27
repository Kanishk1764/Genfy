"use client";

import React, { useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { useRouter, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";

interface AuthGuardProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

export function AuthGuard({ children, requireAuth = true }: AuthGuardProps) {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading) {
      if (requireAuth && !isAuthenticated) {
        // Redirect to login if auth is required but user is not logged in
        router.push(`/login?redirect=${encodeURIComponent(pathname)}`);
      } else if (!requireAuth && isAuthenticated) {
        // If it's a guest-only page (like login/signup) and user is auth'd, redirect to studio
        router.push("/studio");
      }
    }
  }, [loading, isAuthenticated, requireAuth, router, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white">
        <Loader2 className="w-10 h-10 animate-spin text-[#f95738]" />
      </div>
    );
  }

  // Prevent flash of content while redirecting
  if (requireAuth && !isAuthenticated) return null;
  if (!requireAuth && isAuthenticated) return null;

  return <>{children}</>;
}
