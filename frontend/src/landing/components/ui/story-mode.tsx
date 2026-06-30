"use client";

import React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { LogoAsterisk } from "@landing/ui/genfy-nav";

export default function StoryMode({ isDark }: { isDark: boolean }) {
  return (
    <div className={`w-full transition-colors duration-300 ${isDark ? "bg-[#0a0a0a]" : "bg-white"}`}>
    <section className="w-full max-w-[1440px] mx-auto px-6 py-4 mb-2">
      <div 
        className={`relative flex flex-col md:flex-row rounded-[24px] overflow-hidden min-h-[220px] md:min-h-[260px] ${
          isDark 
            ? "bg-gradient-to-r from-[#242629] via-[#1a1c1e] to-[#0d0d0d] border border-white/5" 
            : "bg-gradient-to-r from-slate-100 to-slate-200 border border-slate-200"
        }`}
      >
        {/* Left Side: Content - Spread to Corners */}
        <div className="flex flex-col justify-between items-start z-20 w-full md:w-[45%] p-6 md:p-8 lg:p-10">
          <div className="flex flex-col gap-4">
            <div className="inline-flex px-2 py-0.5 rounded-md bg-[#f95738] text-white font-black text-[9px] uppercase tracking-wider w-fit">
              STORY MODE
            </div>
            
            <div className="flex flex-col">
              <h2 className={`text-2xl md:text-[38px] font-black leading-[0.9] uppercase tracking-tighter ${isDark ? "text-white" : "text-slate-900"}`}>
                DIFFERENT SCENES <br />
                SAME STAR
              </h2>
              <p className={`text-[13px] md:text-[14px] mt-2 font-medium ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Build your character. One click does the rest
              </p>
            </div>
          </div>

          <Link 
            href="/signup"
            className={`mt-4 px-6 py-2.5 rounded-lg font-black text-sm transition-all hover:scale-[1.05] active:scale-95 shadow-lg no-underline ${
              isDark 
                ? "bg-white text-black hover:bg-slate-100" 
                : "bg-[#0a0a0a] text-white hover:bg-slate-800"
            }`}
          >
            Try Story Mode
          </Link>
        </div>

        {/* Right Side: Tilted Image Stack - Compact Banner style */}
        <div className="absolute top-0 right-0 w-[60%] h-full pointer-events-none overflow-hidden flex items-center justify-end pr-10">
          {/* Main Tilted Image (Top) */}
          <motion.div 
            initial={{ rotate: -15, x: 30 }}
            whileInView={{ rotate: -10, x: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            viewport={{ once: true }}
            className="relative z-20 w-[140px] md:w-[200px] lg:w-[240px] aspect-[4/5] rounded-[16px] overflow-hidden border-[3px] border-[#222] shadow-2xl translate-x-12 translate-y-4"
          >
            <img 
              src="/landing-gallery/1.png" 
              className="w-full h-full object-cover" 
              alt="Story character scene 1" 
            />
          </motion.div>

          {/* Secondary Tilted Image (Middle) */}
          <motion.div 
            initial={{ rotate: -10, x: 50 }}
            whileInView={{ rotate: -15, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            viewport={{ once: true }}
            className="relative z-10 w-[120px] md:w-[180px] lg:w-[220px] aspect-[4/5] rounded-[16px] overflow-hidden border-[3px] border-[#1a1a1a] shadow-xl -translate-x-4 -translate-y-4"
          >
            <img 
              src="/landing-gallery/2.png" 
              className="w-full h-full object-cover" 
              alt="Story character scene 2" 
            />
          </motion.div>

          {/* Third Tilted Image (Back) */}
          <motion.div 
            initial={{ rotate: -5, x: 80 }}
            whileInView={{ rotate: -20, x: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            viewport={{ once: true }}
            className="relative z-0 w-[100px] md:w-[150px] lg:w-[180px] aspect-[4/5] rounded-[16px] overflow-hidden border-[3px] border-[#111] opacity-60 shadow-lg -translate-x-16 translate-y-2"
          >
            <img 
              src="/landing-gallery/4.png" 
              className="w-full h-full object-cover" 
              alt="Story character scene 3" 
            />
          </motion.div>

          {/* Decorative LogoAsterisk removed */}
        </div>
      </div>
    </section>
    </div>
  );
}
