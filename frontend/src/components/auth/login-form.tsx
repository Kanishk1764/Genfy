"use client";

import React, { useState } from "react";
import { Button } from "@/landing/ui/button";
import { Input } from "@/landing/ui/input";
import Link from "next/link";
import { useRouter } from "next/navigation";
import api, { API_BASE_URL } from "@/utils/api";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { GoogleLogin, useGoogleLogin } from "@react-oauth/google";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/auth-context";

const GithubIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
  </svg>
);

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
  </svg>
);

function GoogleSignInButton({
  loading,
  onSuccess,
}: {
  loading: boolean;
  onSuccess: (tokenResponse: any) => Promise<void>;
}) {
  const googleLoginHandler = useGoogleLogin({
    onSuccess,
    onError: () => toast.error("Google login failed"),
  });

  return (
    <div className="w-full flex flex-col items-center gap-2">
      <div className="w-full flex justify-center border border-white/10 rounded-2xl p-1 bg-[#121212] overflow-hidden">
        <GoogleLogin
          onSuccess={onSuccess}
          onError={() => toast.error("Google Login failed")}
          theme="filled_black"
          size="large"
          text="continue_with"
          shape="pill"
          width="320"
        />
      </div>
    </div>
  );
}

export function LoginForm({ onSuccess }: { onSuccess?: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const router = useRouter();
  const { login } = useAuth();
  const isGoogleConfigured = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim());

  const handleNextAction = (nextAction: string | undefined) => {
    if (onSuccess) {
      setTimeout(onSuccess, 1200);
      return;
    }
    setTimeout(() => {
      switch (nextAction) {
        case "verify_email":
          router.push("/verify-email");
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
    }, 1200);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await api.post("/api/users/login", { email, password });
      const data = response.data;

      if (data.status === "success") {
        setIsSuccess(true);
        login(data.user);
        handleNextAction(data.user.next_action);
      } else {
        toast.error("Login failed", {
          description: data.message || "Please check your credentials and try again.",
        });
      }
    } catch (err: any) {
      const responseData = err.response?.data;
      const message = responseData?.message || responseData?.detail || "Please check your credentials and try again.";
      const emailVerified = responseData?.email_verified;

      if (emailVerified === false) {
        toast.error("Email not verified", {
          description: "Please verify your email first.",
          action: {
            label: "Resend link",
            onClick: () => router.push(`/resend-verification`),
          },
        });
      } else {
        toast.error("Authentication failed", { description: message });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (tokenResponse: any) => {
    try {
      setLoading(true);
      const credential = tokenResponse.credential || tokenResponse.access_token;
      const isAccessToken = !tokenResponse.credential && Boolean(tokenResponse.access_token);

      const response = await api.post("/api/users/google-signin", {
        credential,
        is_access_token: isAccessToken,
        is_signup: false
      });

      const data = response.data;
      if (data.status === "success") {
        setIsSuccess(true);
        login(data.user);
        handleNextAction(data.user.next_action);
      }
    } catch (err: any) {
      toast.error("Google Sign-In failed", {
        description: err.response?.data?.detail || "Something went wrong.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative space-y-6 overflow-hidden">
      <AnimatePresence>
        {isSuccess && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 z-50 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center text-center space-y-4"
          >
             <motion.div
               initial={{ scale: 0 }}
               animate={{ scale: 1 }}
               transition={{ type: "spring", damping: 10, stiffness: 100, delay: 0.2 }}
               className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center border-2 border-green-500/20"
             >
               <CheckCircle2 className="w-10 h-10 text-green-500" />
             </motion.div>
             <div className="space-y-1">
               <h3 className="text-2xl font-black text-slate-900">Access Granted</h3>
               <p className="text-slate-500 font-bold">Welcome back!</p>
             </div>
          </motion.div>
        )}
      </AnimatePresence>


      <form className="space-y-4" onSubmit={handleLogin}>
        <div className="space-y-2">
          <label className="text-[13px] font-bold text-slate-300 ml-1">Email Address</label>
          <Input
            type="email"
            placeholder="name@company.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value.replace(/\s/g, ""))}
            className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-[#f95738]/50 focus:ring-[#f95738]/20"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between ml-1">
            <label className="text-[13px] font-bold text-slate-300">Password</label>
            <Link
              href="/forgot-password"
              className="text-[12px] font-medium text-[#f95738] hover:text-[#e04e2d] transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value.replace(/[^a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/g, ""))}
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

        <Button
          type="submit"
          disabled={loading}
          className="w-full h-12 rounded-xl bg-[#f95738] hover:bg-[#e04e2d] text-white text-[15px] font-black transition-all duration-300 shadow-lg shadow-[#f95738]/20 active:scale-[0.98]"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Sign In"}
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-white/10" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-[#0a0a0a] px-2 text-slate-500 font-medium">Or continue with</span>
        </div>
      </div>

      <div className="space-y-3 w-full">
        {isGoogleConfigured && (
          <GoogleSignInButton loading={loading} onSuccess={handleGoogleSuccess} />
        )}

        <button 
          type="button"
          onClick={() => window.location.href = `${API_BASE_URL}/auth/github`}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 h-14 rounded-2xl bg-[#121212] border border-white/10 hover:bg-white/5 text-white font-bold transition-all duration-300 active:scale-[0.98] group"
        >
          <GithubIcon />
          <span>GitHub</span>
        </button>
      </div>
    </div>
  );
}
