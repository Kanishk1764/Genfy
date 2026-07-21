"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthLayout from "@landing/auth/auth-layout";
import { Button } from "@landing/ui/button";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import api from "@/utils/api";
import { toast } from "sonner";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("Verifying your email...");

  const handleNextAction = (nextAction: string) => {
    switch (nextAction) {
      case "verify_email":
        // Should not happen if success
        break;
      case "select_plan":
        router.push("/pricing");
        break;
      case "payment":
        router.push("/pricing");
        break;
      case "dashboard":
      default:
        router.push("/studio");
        break;
    }
  };

  const verificationStarted = React.useRef(false);

  useEffect(() => {
    // Guard against React 18 Strict Mode double-invoke (mounts → unmounts → remounts)
    // Without this the POST fires twice: the 1st call deletes PendingUser, the 2nd
    // finds nothing and returns 400 "Invalid or expired token".
    if (verificationStarted.current) return;
    verificationStarted.current = true;

    const searchParams = new URLSearchParams(window.location.search);
    const token = searchParams.get("token");

    if (!token) {
      setStatus("error");
      setMessage("Invalid verification link. No token provided.");
      return;
    }

    const verify = async () => {
      try {
        const response = await api.post("/api/users/verify-email", { token });
        const data = response.data;

        if (data.status === "success") {
          setStatus("success");
          setMessage(data.message || "Email verified successfully!");

          toast.success("Email verified!", {
            description: "Your account is now active.",
          });
          // No auto-redirect — user clicks button to go to login
        } else {
          setStatus("error");
          setMessage(data.message || "Verification failed. Please try again.");
        }
      } catch (err: any) {
        setStatus("error");
        setMessage(err.response?.data?.detail || "Connection error. Please try again.");
        console.error(err);
      }
    };

    verify();
  }, []);

  return (
    <AuthLayout title="Email Verification" subtitle="Confirming your identity">
      <div className="flex flex-col items-center py-6 text-center space-y-5">
        {status === "verifying" && (
          <>
            <Loader2 className="w-14 h-14 text-[#f95738] animate-spin" />
            <p className="text-slate-400 text-[15px] font-medium">{message}</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center border border-green-500/20">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-white font-bold text-[20px]">Email Verified!</h2>
              <p className="text-slate-400 text-[14px] leading-relaxed max-w-[280px] mx-auto">
                {message}
              </p>
            </div>
            <Button
              onClick={() => router.push("/login")}
              className="w-full h-12 rounded-xl bg-[#f95738] hover:bg-[#e04e2d] text-white text-[15px] font-black transition-all duration-300 shadow-lg shadow-[#f95738]/20 mt-4"
            >
              Go to Login
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20">
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-white font-bold text-[20px]">Link Expired or Invalid</h2>
              <p className="text-red-400 text-[14px] leading-relaxed max-w-[280px] mx-auto mb-6">
                {message}
              </p>
            </div>
            <div className="w-full space-y-3 pt-4">
              <Button
                onClick={() => router.push("/resend-verification")}
                className="w-full h-12 rounded-xl bg-[#f95738] hover:bg-[#e04e2d] text-white text-[15px] font-black transition-all duration-300 shadow-lg shadow-[#f95738]/20"
              >
                Resend Verification Email
              </Button>
              <Link
                href="/"
                className="block text-center text-[14px] text-slate-500 font-bold hover:text-white transition-colors pt-2"
              >
                ← Back to Home
              </Link>
            </div>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
