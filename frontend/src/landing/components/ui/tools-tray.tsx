"use client";

import React from "react";
import { ArrowRight, Sparkles } from "lucide-react";

interface Tool {
  id: string;
  title: string;
  videoUrl: string;
  isNew?: boolean;
}

const tools: Tool[] = [
  {
    id: "1",
    title: "Create Image",
    videoUrl: "https://images.unsplash.com/photo-1649265825072-f7dd6942baed?auto=format&fit=crop&q=80&w=800",
  },
];

export default function ToolsTray({ isDark }: { isDark: boolean }) {

  return (
    <div className={`w-full transition-colors duration-300 ${isDark ? "bg-[#0a0a0a]" : "bg-white"}`}>
    <section className="w-full max-w-[1440px] mx-auto px-6 py-4 mt-6 mb-12">
      <div 
        className={`relative flex flex-col md:flex-row items-center gap-6 p-6 md:p-8 rounded-[32px] overflow-hidden ${
          isDark 
            ? "bg-[#111111] border border-white/5 shadow-2xl" 
            : "bg-slate-50 border border-slate-200"
        }`}
      >
        {/* Decorative Background Glow (Orange) */}
        {isDark && (
          <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden text-[#f95738]">
            <div className="absolute -top-1/2 -left-1/4 w-[100%] h-[200%] bg-[radial-gradient(circle,rgba(249,87,56,0.05)_0%,rgba(0,0,0,0)_60%)] rotate-12" />
          </div>
        )}

        {/* Header Content - Balanced Width */}
        <div className="flex flex-col justify-between gap-8 py-4 w-full md:w-[32%] shrink-0 z-10">
          <div className="flex flex-col gap-4">
            <h2 className={`text-3xl md:text-[38px] font-black uppercase tracking-tight leading-[1.1] [word-spacing:0.1em] ${isDark ? "text-white" : "text-slate-900"}`}>
              WHAT WILL YOU <br />
              <span className="text-[#f95738]">CREATE TODAY?</span>
            </h2>
            <p className={`text-[14px] md:text-[16px] max-w-[300px] font-medium leading-[1.4] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Create authentic images and videos with natural texture and easy style
            </p>
          </div>

          <button className="flex items-center justify-between gap-4 w-full md:w-fit px-8 py-4 rounded-xl bg-[#f95738] text-white font-black text-lg hover:bg-[#e04e2d] transition-all hover:scale-[1.05] active:scale-95 group shadow-[0_10px_25px_rgba(249,87,56,0.3)]">
            Explore all tools
            <Sparkles className="w-5 h-5 transition-transform group-hover:rotate-12" />
          </button>
        </div>

        {/* Single Featured Tool Card */}
        <div className="relative flex-1 flex items-center justify-center min-h-[260px] md:ml-4">
          {tools.map((tool) => (
            <div 
              key={tool.id}
              className={`group w-full max-w-[320px] h-[230px] md:h-[260px] rounded-[18px] overflow-hidden relative cursor-pointer transition-all duration-500 border border-transparent shadow-lg hover:scale-[1.02] ${
                isDark 
                  ? "bg-[#1a1a1a] hover:shadow-[0_0_40px_rgba(249,87,56,0.35)]" 
                  : "bg-white hover:shadow-[0_0_25px_rgba(249,87,56,0.25)]"
              }`}
            >
              {/* Image/Video Background */}
              <img 
                src={tool.videoUrl} 
                alt={tool.title}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" 
              />
              
              {/* Overlay Gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-70 group-hover:opacity-100 transition-opacity" />

              {/* Content */}
              <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-white">
                <h3 className="text-[15px] font-bold tracking-tight leading-tight">{tool.title}</h3>
                <div className="w-6 h-6 rounded-full border border-white/20 flex items-center justify-center transition-all group-hover:bg-white group-hover:text-black">
                  <ArrowRight className="w-3 h-3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
    </div>
  );
}
