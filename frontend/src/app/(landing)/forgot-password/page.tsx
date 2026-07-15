"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import AuthLayout from "@/landing/auth/auth-layout";
import { Button } from "@/landing/ui/button";
import { Input } from "@/landing/ui/input";
import { CheckCircle2, Loader2, Eye, EyeOff, Lock } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { OtpInput } from "@/components/auth/otp-input";
import api from "@/utils/api";
import { useAuth } from "@/context/auth-context";
import { motion, AnimatePresence } from "framer-motion";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [step, setStep] = useState<"email" | "otp" | "new_password">("email");
  const [email, setEmail] = useState("");
  const [resetSessionToken, setResetSessionToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Step 1: Send Reset OTP
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Please enter your email address");
      return;
    }

    setLoading(true);
    try {
      const response = await api.post("/api/users/forgot-password", { email: email.trim() });
      if (response.data.status === "otp_sent") {
        toast.success("Reset code sent!", {
          description: `We've sent a 6-digit password reset code to ${email}`,
        });
        setStep("otp");
      }
    } catch (err: any) {
      toast.error("Error", {
        description: err.response?.data?.detail || err.response?.data?.message || "Something went wrong.",
      });
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify Reset OTP
  const handleVerifyOtp = async (otp: string) => {
    setLoading(true);
    try {
      const response = await api.post("/api/users/verify-reset-otp", {
        email: email.trim(),
        otp,
      });

      if (response.data.status === "success") {
        toast.success("Code verified!", {
          description: "Please enter your new password.",
        });
        setResetSessionToken(response.data.reset_session_token);
        setStep("new_password");
      }
    } catch (err: any) {
      toast.error("Verification failed", {
        description: err.response?.data?.detail || "Invalid code. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    try {
      const response = await api.post("/api/users/forgot-password", { email: email.trim() });
      if (response.data.status === "otp_sent") {
        toast.success("New code sent!", {
          description: `We've sent a fresh 6-digit reset code to ${email}`,
        });
      }
    } catch (err: any) {
      toast.error("Resend failed", {
        description: err.response?.data?.detail || "Could not resend reset code.",
      });
    }
  };

  // Step 3: Set New Password & Direct Auto Log-in
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const response = await api.post("/api/users/reset-password", {
        email: email.trim(),
        reset_session_token: resetSessionToken,
        new_password: newPassword,
      });

      const data = response.data;
      if (data.status === "success") {
        toast.success("Password reset successful!", {
          description: "Logging you in...",
        });
        setIsSuccess(true);
        if (data.user) {
          login(data.user);
        }
        setTimeout(() => {
          router.push("/studio");
        }, 1200);
      }
    } catch (err: any) {
      toast.error("Reset failed", {
        description: err.response?.data?.detail || "Could not update password. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={
        step === "otp"
          ? "Verify Reset Code"
          : step === "new_password"
          ? "Create New Password"
          : "Forgot Password?"
      }
      subtitle={
        step === "otp"
          ? `Enter the 6-digit code sent to ${email}`
          : step === "new_password"
          ? "Set a strong password for your account"
          : "Enter your email and we'll send you a 6-digit reset code"
      }
    >
      <div className="relative overflow-hidden space-y-6">
        <AnimatePresence>
          {isSuccess && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-md flex flex-col items-center justify-center text-center space-y-4"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 10, stiffness: 100, delay: 0.2 }}
                className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center border-2 border-green-500/20"
              >
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              </motion.div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-white">Password Updated</h3>
                <p className="text-slate-400 font-bold text-sm">Logging you in to Studio...</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {step === "otp" ? (
          <OtpInput
            email={email}
            title="Password Reset Code"
            subtitle="We've sent a 6-digit reset code to"
            onVerify={handleVerifyOtp}
            onResend={handleResendOtp}
            onBack={() => setStep("email")}
            loading={loading}
          />
        ) : step === "new_password" ? (
          <motion.form
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            onSubmit={handleResetPassword}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label className="text-[13px] font-bold text-slate-300 ml-1">New Password</label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-[#f95738]/50 focus:ring-[#f95738]/20 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[13px] font-bold text-slate-300 ml-1">Confirm New Password</label>
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-[#f95738]/50 focus:ring-[#f95738]/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-14 rounded-2xl bg-[#f95738] hover:bg-[#e04e2d] text-white text-base font-black transition-all duration-300 shadow-lg shadow-[#f95738]/25 active:scale-[0.98] mt-2"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  <span>Updating Password...</span>
                </div>
              ) : (
                "Update Password & Log In"
              )}
            </Button>
          </motion.form>
        ) : (
          <form className="space-y-4" onSubmit={handleRequestOtp}>
            <div className="space-y-2">
              <label className="text-[13px] font-bold text-slate-300 ml-1">Email Address</label>
              <Input
                type="email"
                placeholder="name@company.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-[#f95738]/50 focus:ring-[#f95738]/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-14 rounded-2xl bg-[#f95738] hover:bg-[#e04e2d] text-white text-base font-black transition-all duration-300 shadow-lg shadow-[#f95738]/25 active:scale-[0.98]"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Send Reset Code"}
            </Button>

            <p className="text-center text-[13px] text-slate-400 pt-2 font-bold">
              <Link href="/login" className="text-[#f95738] hover:underline underline-offset-4">
                ← Back to login
              </Link>
            </p>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
