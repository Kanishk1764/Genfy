"use client";

import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { LogoAsterisk } from "@landing/ui/genfy-nav";

// CSS to prevent white autofill background
const autofillStyles = `
  input:-webkit-autofill,
  input:-webkit-autofill:hover,
  input:-webkit-autofill:focus,
  input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 30px #1a1a1a inset !important;
    -webkit-text-fill-color: white !important;
    transition: background-color 5000s ease-in-out 0s;
  }
`;

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}

export default function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const containerVariants = {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    initial: { opacity: 0, y: 15 },
    animate: { 
      opacity: 1, 
      y: 0, 
      transition: { 
        duration: 0.5, 
        ease: [0.33, 1, 0.68, 1] as const 
      } 
    },
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: autofillStyles }} />
      <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#0a0a0a]">
      <Link 
        href="/"
        className="absolute top-8 left-8 z-50 p-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-[#f95738]/10 hover:border-[#f95738]/30 backdrop-blur-md transition-all duration-300 group"
      >
        <ChevronLeft className="w-5 h-5 transition-transform group-hover:-translate-x-0.5" />
      </Link>

      <div className="absolute inset-0 z-0">
        <motion.div
          animate={{ scale: [1, 1.1, 1], rotate: [0, 45, 0], x: [0, 30, 0], y: [0, 20, 0] }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] bg-[#f95738]/5 blur-[120px] rounded-full"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], rotate: [0, -30, 0], x: [0, -20, 0], y: [0, -40, 0] }}
          transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -bottom-[10%] -right-[10%] w-[60%] h-[60%] bg-[#f95738]/3 blur-[150px] rounded-full"
        />
      </div>

      <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none mix-blend-overlay" 
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} 
      />

      <motion.div 
        variants={containerVariants}
        initial="initial"
        animate={mounted ? "animate" : "initial"}
        className="relative z-10 w-full max-w-[480px] px-6"
      >
        <div className="flex flex-col items-center mb-8">
          <motion.div variants={itemVariants}>
            <Link href="/" className="mb-6 group block">
              <div className="flex items-center gap-2 relative px-4 py-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md group-hover:bg-[#f95738]/10 group-hover:border-[#f95738]/30 transition-all duration-500">
                <LogoAsterisk className="w-8 h-8 text-[#f95738] transition-transform group-hover:rotate-45" />
                <span className="font-black text-[24px] text-white">Genfy</span>
              </div>
            </Link>
          </motion.div>
          
          <motion.h1 variants={itemVariants} className="text-[32px] font-black tracking-tight text-white mb-2 font-sans text-center">
            {title}
          </motion.h1>
          
          <motion.p variants={itemVariants} className="text-slate-400 text-[16px] text-center">
            {subtitle}
          </motion.p>
        </div>

        <motion.div
          variants={itemVariants}
          className="bg-[#111111]/80 border border-white/[0.08] backdrop-blur-[20px] rounded-[32px] p-8 shadow-2xl shadow-black/40 [&_input]:bg-[#1a1a1a] [&_input]:border-[#2a2a2a] [&_input]:text-white [&_input]:placeholder:text-slate-500 [&_input]:autofill:bg-[#1a1a1a] [&_input]:-webkit-autofill:bg-[#1a1a1a]"
        >
          {children}
        </motion.div>

        <motion.div variants={itemVariants} className="mt-8 text-center">
          <p className="text-slate-500 text-sm" suppressHydrationWarning>
            © {new Date().getFullYear()} Genfy Inc. All rights reserved.
          </p>
        </motion.div>
      </motion.div>
    </div>
    </>
  );
}
