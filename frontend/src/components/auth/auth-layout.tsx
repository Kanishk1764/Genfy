"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
const LogoAsterisk = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v20M17 4l-10 16M7 4l10 16M2 12h20" />
  </svg>
);

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

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center bg-[#fcfcfd] font-sans">
      {/* Background Subtle Gradient */}
      <div className="absolute inset-0 z-0 opacity-[0.4] pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_#f9573808_0%,_transparent_70%)]" />
      </div>

      {/* Back Button */}
      <Link 
        href="/"
        className="absolute top-8 left-8 z-50 flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-black hover:border-slate-300 shadow-sm transition-all duration-200 group"
      >
        <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        <span className="text-sm font-medium">Back</span>
      </Link>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={mounted ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-[440px] px-6 py-12"
      >
        <div className="flex flex-col items-center">
          {/* Logo Section */}
          <Link href="/" className="mb-8 group">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-black shadow-lg shadow-black/5 group-hover:scale-105 transition-transform duration-300">
                <LogoAsterisk className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight text-black">Genfy</span>
            </div>
          </Link>
          
          {/* Content Card */}
          <div className="w-full bg-white rounded-[24px] p-8 md:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
            <div className="text-center mb-10">
              <h1 className="text-[28px] font-bold tracking-tight text-black mb-2 leading-tight">
                {title}
              </h1>
              <p className="text-slate-500 text-[15px] font-medium leading-relaxed">
                {subtitle}
              </p>
            </div>

            {children}
          </div>

          {/* Footer Copyright */}
          <div className="mt-8 text-center">
            <p className="text-slate-400 text-xs font-medium tracking-wide">
              © {new Date().getFullYear()} GENFY INC. • ALL RIGHTS RESERVED
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
