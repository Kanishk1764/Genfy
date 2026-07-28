"use client";

import React from "react";
import { usePathname } from "next/navigation";
import GenfyNav from "@/landing/ui/genfy-nav";
import { useTheme } from "@/context/theme-context";

export function LandingShell({ children }: { children: React.ReactNode }) {
  const { isDark, setIsDark } = useTheme();
  const pathname = usePathname();

  // Pages that SHOULD NOT show the main navbar (Auth pages)
  const authRoutes = [
    "/login",
    "/signup",
    "/forgot-password",
    "/verify-email",
    "/resend-verification",
    "/reset-password",
    "/privacy",
    "/terms"
  ];

  const isAuthRoute = authRoutes.some(route => pathname.startsWith(route));

  return (
    <div
      className="min-h-screen flex flex-col transition-colors duration-300"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      {!isAuthRoute && (
        <GenfyNav isDark={isDark} setIsDark={setIsDark} />
      )}
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
