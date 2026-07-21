"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthLayout from "@landing/auth/auth-layout";
import { Button } from "@landing/ui/button";
import { Input } from "@landing/ui/input";
import { CheckCircle2, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import api from "@/utils/api";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [tokenError, setTokenError] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) {
      setTokenError(true);
    } else {
      setToken(t);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const response = await api.post("/api/users/reset-password", { 
        token, 
        new_password: password 
      });
      
      if (response.data.status === "success") {
        setSuccess(true);
      }
    } catch (err: any) {
      toast.error("Reset failed", { 
        description: err.response?.data?.detail || err.response?.data?.message || "Invalid or expired link." 
      });
    } finally {
      setLoading(false);
    }
  };

  if (tokenError) {
    return (
      <AuthLayout title="Invalid link" subtitle="This password reset link is not valid">
        <div className="flex flex-col items-center py-4 text-center space-y-5">
          <p className="text-slate-500 text-[14px]">
            The reset link is missing or malformed. Please request a new one.
          </p>
          <Button
            onClick={() => router.push("/forgot-password")}
            className="w-full h-12 rounded-xl bg-[#f95738] hover:bg-[#e04e2d] text-white text-[15px] font-black transition-all duration-300"
          >
            Request New Reset Link
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout title="Password updated!" subtitle="Your new password has been set">
        <div className="flex flex-col items-center py-4 text-center space-y-5">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center border border-green-200">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
          <p className="text-slate-500 text-[14px]">
            Your password has been reset successfully. You can now sign in with your new password.
          </p>
          <Button
            onClick={() => router.push("/login")}
            className="w-full h-12 rounded-xl bg-[#f95738] hover:bg-[#e04e2d] text-white text-[15px] font-black transition-all duration-300 shadow-lg shadow-[#f95738]/20"
          >
            Sign In
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your new password below">
      <div className="space-y-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-[13px] font-bold text-slate-300 ml-1">New Password</label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-slate-500 focus:border-[#f95738]/50 focus:ring-[#f95738]/20 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[13px] font-bold text-slate-300 ml-1">Confirm New Password</label>
            <div className="relative">
              <Input
                type={showConfirmPassword ? "text" : "password"}
                placeholder="••••••••"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-slate-500 focus:border-[#f95738]/50 focus:ring-[#f95738]/20 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-[#f95738] hover:bg-[#e04e2d] text-white text-[15px] font-black transition-all duration-300 shadow-lg shadow-[#f95738]/20 active:scale-[0.98]"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Set New Password"}
          </Button>
        </form>

        <p className="text-center text-[14px] text-slate-500">
          <Link href="/login" className="text-[#f95738] font-bold hover:underline underline-offset-4">
            ← Back to login
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
