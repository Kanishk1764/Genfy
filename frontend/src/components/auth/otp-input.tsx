"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/landing/ui/button";
import { Loader2, ArrowLeft, RotateCw } from "lucide-react";
import { motion } from "framer-motion";

interface OtpInputProps {
  email: string;
  onVerify: (otp: string) => Promise<void>;
  onResend: () => Promise<void>;
  onBack?: () => void;
  title?: string;
  subtitle?: string;
  loading?: boolean;
}

export function OtpInput({
  email,
  onVerify,
  onResend,
  onBack,
  title = "Verify Your Email",
  subtitle = "We've sent a 6-digit verification code to",
  loading = false,
}: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    // Focus first input on mount
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleChange = (index: number, value: string) => {
    // Allow only numeric input
    const cleaned = value.replace(/\D/g, "");
    if (!cleaned) {
      const updated = [...digits];
      updated[index] = "";
      setDigits(updated);
      return;
    }

    const lastChar = cleaned.slice(-1);
    const updated = [...digits];
    updated[index] = lastChar;
    setDigits(updated);

    // Auto focus next input
    if (index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto submit if all 6 digits entered
    const fullCode = updated.join("");
    if (fullCode.length === 6 && !updated.includes("")) {
      onVerify(fullCode);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pastedData) return;

    const newDigits = Array(6).fill("");
    for (let i = 0; i < pastedData.length; i++) {
      newDigits[i] = pastedData[i];
    }
    setDigits(newDigits);

    const targetIndex = Math.min(pastedData.length, 5);
    inputRefs.current[targetIndex]?.focus();

    if (pastedData.length === 6) {
      onVerify(pastedData);
    }
  };

  const handleResendClick = async () => {
    if (resendCooldown > 0 || resending) return;
    try {
      setResending(true);
      await onResend();
      setResendCooldown(60);
    } finally {
      setResending(false);
    }
  };

  const isComplete = digits.join("").length === 6 && !digits.includes("");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6 py-2"
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-slate-400 hover:text-white text-sm font-bold transition-colors mb-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
      )}

      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-black text-white">{title}</h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          {subtitle} <span className="font-bold text-[#f95738]">{email}</span>
        </p>
      </div>

      <div className="flex justify-between gap-2 py-4">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => { inputRefs.current[index] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            disabled={loading}
            className={`w-12 h-14 sm:w-14 sm:h-16 text-center text-2xl font-black rounded-xl bg-[#121212] border transition-all duration-200 outline-none text-white ${
              digit
                ? "border-[#f95738] shadow-[0_0_15px_rgba(249,87,56,0.2)] bg-[#f95738]/5"
                : "border-white/10 focus:border-[#f95738]/60 focus:bg-white/5"
            }`}
          />
        ))}
      </div>

      <Button
        type="button"
        onClick={() => onVerify(digits.join(""))}
        disabled={!isComplete || loading}
        className="w-full h-14 rounded-2xl bg-[#f95738] hover:bg-[#e04e2d] text-white text-base font-black transition-all duration-300 shadow-lg shadow-[#f95738]/25 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Verifying Code...</span>
          </div>
        ) : (
          "Verify & Continue"
        )}
      </Button>

      <div className="text-center pt-2">
        <button
          type="button"
          onClick={handleResendClick}
          disabled={resendCooldown > 0 || resending || loading}
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-[#f95738] disabled:opacity-50 disabled:hover:text-slate-400 transition-colors"
        >
          {resending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Resending...</span>
            </>
          ) : (
            <>
              <RotateCw className="w-3.5 h-3.5" />
              <span>
                {resendCooldown > 0
                  ? `Resend code in ${resendCooldown}s`
                  : "Didn't receive code? Resend"}
              </span>
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
