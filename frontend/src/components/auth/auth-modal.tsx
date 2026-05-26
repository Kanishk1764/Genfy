"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useAuthModal } from "@/context/auth-modal-context";
import { SignupForm } from "./signup-form";
import { LoginForm } from "./login-form";

export function AuthModal() {
  const { isOpen, type, closeAuthModal, openAuthModal } = useAuthModal();

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeAuthModal}
            className="absolute inset-0 bg-black/95"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-[480px] bg-[#0a0a0a] border border-white/10 rounded-[32px] overflow-hidden shadow-2xl"
          >
            {/* Top Pattern Decoration */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#f95738] to-transparent opacity-50" />
            
            <div className="p-8 sm:p-10">
              {/* Header */}
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h2 className="text-3xl font-black text-white tracking-tight">
                    {type === "signup" ? "Get Started" : "Welcome Back"}
                  </h2>
                  <p className="text-slate-500 mt-2 font-medium">
                    {type === "signup" 
                      ? "Join Genfy to start generating premium AI images." 
                      : "Sign in to continue your creative journey."}
                  </p>
                </div>
                <button
                  onClick={closeAuthModal}
                  className="p-2 rounded-full hover:bg-white/5 text-slate-400 hover:text-white transition-all duration-200"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Form Content */}
              <div className="relative">
                {type === "signup" ? (
                  <SignupForm onSuccess={closeAuthModal} />
                ) : (
                  <LoginForm onSuccess={closeAuthModal} />
                )}
              </div>

              {/* Footer Toggle */}
              <div className="mt-8 pt-6 border-t border-white/5 text-center">
                <p className="text-slate-500 text-sm">
                  {type === "signup" ? (
                    <>
                      Already have an account?{" "}
                      <button
                        onClick={() => openAuthModal("login")}
                        className="text-[#f95738] font-bold hover:underline underline-offset-4"
                      >
                        Sign In
                      </button>
                    </>
                  ) : (
                    <>
                      Don't have an account?{" "}
                      <button
                        onClick={() => openAuthModal("signup")}
                        className="text-[#f95738] font-bold hover:underline underline-offset-4"
                      >
                        Create one for free
                      </button>
                    </>
                  )}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
