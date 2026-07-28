"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, ExternalLink, Loader2, LogOut, Check } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import api from "@/utils/api";
import { toast } from "sonner";

export function TosModal() {
  const { user, isAuthenticated, loading, refreshUser, logout } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);

  // Show modal ONLY if user is logged in, auth is loaded, and tos_accepted_at is missing/null
  const isTosMissing = Boolean(
    isAuthenticated && !loading && user && !user.tos_accepted_at
  );

  const handleAccept = async () => {
    if (!agreed) {
      toast.info("Please check the box to accept the terms before continuing.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.post("/api/users/accept-tos", {
        version: "v1.0",
      });

      if (res.data.status === "success") {
        toast.success("Terms accepted. Welcome to Genfy!");
        await refreshUser();
      } else {
        toast.error(res.data.detail || "Unable to save acceptance. Please try again.");
      }
    } catch (err: any) {
      toast.error(
        err.response?.data?.detail || "Network error while saving terms acceptance."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isTosMissing && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 select-none">
          {/* Backdrop with strong blur and dimming */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/85 backdrop-blur-md"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            className="relative w-full max-w-[520px] bg-[#0c0c0e] border border-white/10 rounded-[28px] overflow-hidden shadow-2xl flex flex-col"
          >
            {/* Ambient accent highlight line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#f95738] to-transparent opacity-80" />

            <div className="p-6 sm:p-8 flex flex-col">
              {/* Header Icon + Title */}
              <div className="flex items-start gap-4 mb-5">
                <div className="w-11 h-11 rounded-2xl bg-[#f95738]/10 border border-[#f95738]/20 flex items-center justify-center shrink-0 text-[#f95738]">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    Terms & Conditions
                  </h2>
                  <p className="text-zinc-400 text-xs mt-1 leading-relaxed">
                    Please review and accept our platform usage terms to continue using Genfy.
                  </p>
                </div>
              </div>

              {/* Minimalistic Scrollable Terms Summary Box */}
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 max-h-56 overflow-y-auto space-y-3.5 text-xs text-zinc-300 leading-relaxed font-normal scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                <div>
                  <h3 className="font-semibold text-white text-[13px] mb-1">
                    1. Acceptable Use & Content Safety
                  </h3>
                  <p className="text-zinc-400 text-[12px]">
                    You agree not to use Genfy to generate illegal, hateful, non-consensual, infringing, or defamatory imagery. Automated content safety monitors run on all generations.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-white text-[13px] mb-1">
                    2. Intellectual Property & Reference Materials
                  </h3>
                  <p className="text-zinc-400 text-[12px]">
                    You represent that any reference images, logos, or assets you upload do not infringe third-party intellectual property or copyright laws.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-white text-[13px] mb-1">
                    3. DMCA Compliance & Moderation
                  </h3>
                  <p className="text-zinc-400 text-[12px]">
                    Genfy complies with digital copyright regulations. Assets identified as infringing or flagged by rights holders may be quarantined or removed without prior notice.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-white text-[13px] mb-1">
                    4. Fair Usage & Platform Integrity
                  </h3>
                  <p className="text-zinc-400 text-[12px]">
                    Access is governed by rate limits and plan quotas. Automated abuse, API reverse-engineering, or quota circumvention will result in account suspension.
                  </p>
                </div>
              </div>

              {/* External Links */}
              <div className="flex items-center justify-between mt-3 px-1 text-[11px] text-zinc-400">
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-[#f95738] transition-colors"
                >
                  Full Terms of Service <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
                <span className="text-zinc-700">•</span>
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-[#f95738] transition-colors"
                >
                  Privacy Policy <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              </div>

              {/* Consent Checkbox */}
              <label
                onClick={() => setAgreed((prev) => !prev)}
                className="mt-5 flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 cursor-pointer hover:bg-white/[0.04] transition-all"
              >
                <div
                  className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                    agreed
                      ? "bg-[#f95738] border-[#f95738] text-white"
                      : "border-white/20 bg-black/40"
                  }`}
                >
                  {agreed && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
                <span className="text-xs text-zinc-300 leading-snug">
                  I have read, understood, and agree to the Genfy Terms of Service and Privacy Policy.
                </span>
              </label>

              {/* Action Buttons */}
              <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={logout}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 text-xs font-medium transition-all flex items-center justify-center gap-1.5 order-2 sm:order-1"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>

                <button
                  type="button"
                  disabled={!agreed || isSubmitting}
                  onClick={handleAccept}
                  className={`w-full sm:flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all order-1 sm:order-2 ${
                    agreed && !isSubmitting
                      ? "bg-[#f95738] hover:bg-[#e0482a] text-white shadow-lg shadow-[#f95738]/20"
                      : "bg-white/10 text-zinc-500 cursor-not-allowed border border-white/5"
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Accepting...
                    </>
                  ) : (
                    "Accept & Continue"
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
