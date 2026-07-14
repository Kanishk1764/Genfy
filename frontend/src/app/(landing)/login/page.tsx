"use client";

import React from "react";
import AuthLayout from "@landing/auth/auth-layout";
import { AuthGuard } from "@/components/auth/auth-guard";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <AuthGuard requireAuth={false}>
      <AuthLayout
        title="Welcome back"
        subtitle="Enter your details to access your account"
      >
        <LoginForm />
      </AuthLayout>
    </AuthGuard>
  );
}
