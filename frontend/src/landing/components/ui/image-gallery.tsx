"use client";

import { cn } from "@landing/lib/utils";
import { useState } from "react";

export default function Example({ isDark }: { isDark: boolean }) {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900&display=swap');
    
        * {
          font-family: 'Poppins', sans-serif;
        }
      `}</style>

      <section className={`w-full flex flex-col items-center justify-start py-6 transition-colors duration-300 ${isDark ? "bg-[#0a0a0a]" : "bg-white"}`}>
        <div className="max-w-4xl text-center px-4 mt-4">
          <h1 className={`text-5xl md:text-7xl font-black uppercase tracking-tighter leading-none ${isDark ? "text-white" : "text-black"}`}>
            <span className={isDark ? "text-gray-300 drop-shadow-md" : "text-gray-700 drop-shadow-md"}>TURNING WORDS</span><br/>
            <span>INTO VISUALS</span>
          </h1>
          <p className={`text-base md:text-lg mt-4 leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
            A visual collection of our most recent works – each piece crafted
            with intention, emotion, and style.
          </p>
        </div>

        {/* Gallery */}
        <div className="flex items-center gap-3 md:gap-4 h-[500px] md:h-[650px] w-full max-w-[1440px] mt-14 px-6 md:px-8 mb-20">
          {[
            "/landing-gallery/12.png",
            "/landing-gallery/generated-image-history-1.png",
            "/landing-gallery/13.png",
            "/landing-gallery/6.png",
            "/landing-gallery/4.png",
            "/landing-gallery/14.png",
            "/landing-gallery/generated-image-history-2.png",
            "/landing-gallery/2.png",
            "/landing-gallery/generated-image-history-3.png",
          ].map((src, idx) => (
            <div
              key={idx}
              className="relative group flex-grow transition-all w-24 sm:w-32 md:w-56 rounded-2xl overflow-hidden h-full duration-[800ms] ease-out hover:w-[400px] md:hover:w-[700px] hover:shadow-2xl hover:shadow-[#f95738]/10 cursor-pointer"
            >
              <img
                className="h-full w-full object-cover object-center"
                src={src}
                alt={`image-${idx}`}
              />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
