"use client";

import React, { Suspense } from "react";
import AuthLayout from "@landing/auth/auth-layout";
import { Loader2 } from "lucide-react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignUpPage() {
  return (
    <AuthGuard requireAuth={false}>
      <AuthLayout 
        title="Create your account" 
        subtitle="Sign up and generate for free"
      >
        <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="animate-spin text-[#f95738]" /></div>}>
          <SignupForm />
        </Suspense>
      </AuthLayout>
    </AuthGuard>
  );
}
