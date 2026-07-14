"use client";

import React from "react";
import { useTheme } from "@/context/theme-context";
import Footer from "@landing/components/ui/footer";

export default function AboutPage() {
  const { isDark } = useTheme();

  return (
    <>
      <section className="w-full max-w-[1440px] mx-auto px-6 py-24 md:py-32">
        <div className="flex flex-col gap-6 text-center max-w-4xl mx-auto">
          <h1 className={`text-5xl md:text-7xl lg:text-[80px] font-black uppercase tracking-tighter leading-[1.1] ${isDark ? "text-white" : "text-black"}`}>
            WE ARE <span className="text-[#f95738]">GENFY</span>
          </h1>
          <p className={`text-lg md:text-xl font-medium leading-relaxed max-w-2xl mx-auto ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Empowering the next generation of creative teams to generate breathtaking, hyper-realistic visual concepts blazingly fast. Our mission is to bridge the gap between human imagination and computational reality.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mt-24">
          <div className="flex flex-col gap-6">
            <h2 className={`text-3xl font-bold uppercase tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>Our Vision</h2>
            <p className={`text-lg md:text-xl leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
              Born from a collective of rogue engineers and visionary artists, Genfy was built on the core belief that access to world-class artistic tools should be democratized. We&apos;re actively building a proprietary machine learning pipeline called Soul Cinema XL, optimized specifically for ultra-high-resolution cinematic output that feels organically human.
            </p>
            <p className={`text-lg md:text-xl leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
              By focusing heavily on rendering fidelity rather than sheer volume, we empower global agencies, solo creators, and enterprise clients to completely rewrite their visual storytelling pipelines.
            </p>
          </div>

          <div className={`p-10 rounded-[32px] border flex flex-col gap-6 relative overflow-hidden ${isDark ? "bg-white/5 border-white/10" : "bg-slate-50 border-slate-200"}`}>
            <h3 className={`text-xl font-bold tracking-tight uppercase ${isDark ? "text-white" : "text-slate-900"}`}>
              Company Stats
            </h3>
            <div className="flex flex-col gap-4 mt-auto">
              <div className={`flex justify-between items-center pb-4 border-b ${isDark ? "border-white/10" : "border-slate-200"}`}>
                <span className="text-slate-400 font-medium">Images Generated</span>
                <span className="text-[#f95738] font-black text-xl">12.4M</span>
              </div>
              <div className={`flex justify-between items-center pb-4 border-b ${isDark ? "border-white/10" : "border-slate-200"}`}>
                <span className="text-slate-400 font-medium">Enterprise Clients</span>
                <span className="text-[#f95738] font-black text-xl">450+</span>
              </div>
              <div className={`flex justify-between items-center pb-4 border-b ${isDark ? "border-white/10" : "border-slate-200"}`}>
                <span className="text-slate-400 font-medium">Global Datacenters</span>
                <span className="text-[#f95738] font-black text-xl">14</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 font-medium">Uptime Guarantee</span>
                <span className="text-[#f95738] font-black text-xl">99.99%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer isDark={isDark} />
    </>
  );
}
