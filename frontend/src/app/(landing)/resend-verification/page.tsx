"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import AuthLayout from "@landing/auth/auth-layout";
import { Button } from "@landing/ui/button";
import { Input } from "@landing/ui/input";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/utils/api";
import Link from "next/link";

export default function ResendVerificationPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Please enter your email address");
      return;
    }

    setLoading(true);
    try {
      const response = await api.post("/api/users/resend-verification", { 
        email: email.trim() 
      });

      if (response.data.status === "success") {
        setSuccess(true);
      } else {
        toast.error("Error", { description: response.data.message || "Something went wrong." });
      }
    } catch (err: any) {
      toast.error("Connection error. Please try again.", {
        description: err.response?.data?.detail || err.response?.data?.message
      });
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <AuthLayout title="Verification email sent!" subtitle={`Check your inbox at ${email}`}>
        <div className="flex flex-col items-center py-4 text-center space-y-5">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center border border-green-200">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
          <p className="text-slate-500 text-[14px] leading-relaxed">
            Please click the link in the email to activate your account. Check your spam folder if you don't see it.
          </p>
          <Button
            onClick={() => router.push("/login")}
            className="w-full h-12 rounded-xl bg-[#f95738] hover:bg-[#e04e2d] text-white text-[15px] font-black transition-all duration-300 shadow-lg shadow-[#f95738]/20"
          >
            Back to Login
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Resend verification" subtitle="Enter your email to get a new verification link">
      <div className="space-y-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-[13px] font-bold text-slate-700 ml-1">Email Address</label>
            <Input
              type="email"
              placeholder="name@company.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-white border-slate-200 text-black placeholder:text-slate-400 focus:border-[#f95738]/50 focus:ring-[#f95738]/20"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-[#f95738] hover:bg-[#e04e2d] text-white text-[15px] font-black transition-all duration-300 shadow-lg shadow-[#f95738]/20 active:scale-[0.98]"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Send Verification Email"}
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
