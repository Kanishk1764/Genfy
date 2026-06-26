"use client";

import React, { useEffect, useRef } from "react";
import { LogoAsterisk } from "@landing/ui/genfy-nav";

export default function GenfyHero({ isDark }: { isDark: boolean }) {
  const galleryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = galleryRef.current;
    if (!container) return;

    const items = Array.from(container.querySelectorAll<HTMLElement>(".gallery-item"));
    // Stagger delays matching the inline styles (ms)
    const delays = [0, 120, 240, 360, 480];

    const isInView = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      // Trigger when at least the top portion is visible
      return rect.top < window.innerHeight * 0.9 && rect.bottom > 50;
    };

    const isFullyOut = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      // Only reset when COMPLETELY outside the viewport (prevents blinking on partial visibility)
      return rect.top >= window.innerHeight || rect.bottom <= 0;
    };

    const update = () => {
      items.forEach((el, i) => {
        if (isInView(el)) {
          el.style.opacity = "1";
          el.style.transform = "translateY(0px)";
          el.style.transition = `opacity 0.7s ease ${delays[i]}ms, transform 0.7s ease ${delays[i]}ms`;
        } else if (isFullyOut(el)) {
          // Instantly hide — no transition so the reset is invisible
          el.style.transition = "none";
          el.style.opacity = "0";
          el.style.transform = "translateY(48px)";
          // Re-arm the transition after the DOM commits the reset
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              el.style.transition = `opacity 0.7s ease ${delays[i]}ms, transform 0.7s ease ${delays[i]}ms`;
            })
          );
        }
        // Partially visible → leave as-is, no state change
      });
    };

    window.addEventListener("scroll", update, { passive: true });
    update(); // Run once on mount
    return () => window.removeEventListener("scroll", update);
  }, []);


  return (
    <>
      {/* Hero Content */}
      <style>{`
        @keyframes slideInLeft {
          0% { opacity: 0; transform: translate3d(-40px, 0, 0) scale(0.97); filter: blur(8px); }
          100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0px); }
        }
        @keyframes slideInRight {
          0% { opacity: 0; transform: translate3d(40px, 0, 0) scale(0.97); filter: blur(8px); }
          100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0px); }
        }
        @keyframes smoothScaleIn {
          0% { opacity: 0; transform: scale(0.97); filter: blur(8px); }
          100% { opacity: 1; transform: scale(1); filter: blur(0px); }
        }
        .hero-anim {
          opacity: 0;
          will-change: transform, opacity, filter;
          -webkit-font-smoothing: antialiased;
        }
        .animate-hero-1 {
          animation: slideInLeft 1.5s cubic-bezier(0.2, 0.8, 0.2, 1) 0.1s forwards;
        }
        .animate-hero-2 {
          animation: slideInRight 1.5s cubic-bezier(0.2, 0.8, 0.2, 1) 0.3s forwards;
        }
        .animate-hero-3 {
          animation: smoothScaleIn 1.5s cubic-bezier(0.2, 0.8, 0.2, 1) 0.5s forwards;
        }
      `}</style>
      <section className="max-w-[1400px] mx-auto px-6 pt-16 md:pt-24 pb-12 w-full relative z-10">
        <div className="flex flex-col w-full mb-[64px] md:mb-[80px]">
          <div className="flex w-full justify-center hero-anim animate-hero-1">
            <h1 className={`text-[32px] sm:text-[48px] md:text-[64px] lg:text-[80px] font-black font-sans tracking-tight leading-[1.1] uppercase whitespace-nowrap [word-spacing:0.2em] text-center ${isDark ? "text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400" : "text-black"}`}>
              GENERATE YOUR IDEAS
            </h1>
          </div>

          <div className="flex w-full justify-center mt-2 lg:mt-4 hero-anim animate-hero-2">
            <h1 className={`text-[32px] sm:text-[48px] md:text-[64px] lg:text-[80px] font-black font-sans tracking-tight leading-[1.1] uppercase whitespace-nowrap [word-spacing:0.2em] text-center ${isDark ? "text-transparent bg-clip-text bg-gradient-to-l from-white via-slate-100 to-slate-400" : "text-black"}`}>
              INTO STUNNING VISUALS
            </h1>
          </div>
          
          <div className="flex w-full justify-center mt-8 md:mt-12 hero-anim animate-hero-3">
            <div className={`max-w-[600px] font-medium text-[16px] md:text-[18px] leading-[1.6] text-center ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Introducing Genfy, the Generative AI image for brings your ideas to life with perfectly matched and unique visuals.
              <span className="inline-block ml-2 align-baseline translate-y-[4px]">
                <LogoAsterisk className="text-[#f95738] w-[20px] h-[20px]" />
              </span>
            </div>
          </div>
        </div>


        {/* Gallery Grid */}
        <div
          ref={galleryRef}
          className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-[280px_280px] lg:grid-rows-[310px_310px] gap-4 w-full"
        >
          {/* Image 1: Tall left */}
          <div
            className="gallery-item md:col-start-1 md:row-start-1 md:row-span-2 rounded-[32px] overflow-hidden group h-[300px] md:h-auto border border-white/5"
            style={{
              opacity: 0,
              transform: "translateY(48px)",
              transition: "opacity 0.7s ease, transform 0.7s ease",
              transitionDelay: "0ms",
            }}
          >
            <img src="/landing-gallery/11.png" className="w-full h-full object-cover transition-transform duration-[800ms] group-hover:scale-105" alt="Ballet Dancer" />
          </div>

          {/* Image 2: Top Wide */}
          <div
            className="gallery-item md:col-start-2 md:col-span-2 md:row-start-1 rounded-[32px] overflow-hidden group h-[200px] md:h-auto border border-white/5"
            style={{
              opacity: 0,
              transform: "translateY(48px)",
              transition: "opacity 0.7s ease, transform 0.7s ease",
              transitionDelay: "120ms",
            }}
          >
            <img src="/landing-gallery/4.png" className="w-full h-full object-cover object-center transition-transform duration-[800ms] group-hover:scale-105" alt="Cyberpunk Horizon" />
          </div>

          {/* Image 3: Bottom Left Square */}
          <div
            className="gallery-item md:col-start-2 md:row-start-2 rounded-[32px] overflow-hidden group h-[200px] md:h-auto relative border border-white/5"
            style={{
              opacity: 0,
              transform: "translateY(48px)",
              transition: "opacity 0.7s ease, transform 0.7s ease",
              transitionDelay: "240ms",
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a]/40 to-transparent pointer-events-none z-10" />
            <img src="/landing-gallery/abstract_macro.png" className="w-full h-full object-cover transition-transform duration-[800ms] group-hover:scale-105" alt="Abstract Macro" />
          </div>

          {/* Image 4: Bottom Right Square */}
          <div
            className="gallery-item md:col-start-3 md:row-start-2 rounded-[32px] overflow-hidden group h-[200px] md:h-auto border border-white/5"
            style={{
              opacity: 0,
              transform: "translateY(48px)",
              transition: "opacity 0.7s ease, transform 0.7s ease",
              transitionDelay: "360ms",
            }}
          >
            <img src="/landing-gallery/nature_waterfall.png" className="w-full h-full object-cover transition-transform duration-[800ms] group-hover:scale-105" alt="Hidden Waterfall" />
          </div>

          {/* Image 5: Tall Right */}
          <div
            className="gallery-item md:col-start-4 md:row-start-1 md:row-span-2 rounded-[32px] overflow-hidden group h-[300px] md:h-auto border border-white/5"
            style={{
              opacity: 0,
              transform: "translateY(48px)",
              transition: "opacity 0.7s ease, transform 0.7s ease",
              transitionDelay: "480ms",
            }}
          >
            <img src="/landing-gallery/13.png" className="w-full h-full object-cover transition-transform duration-[800ms] group-hover:scale-105" alt="Vogue Fashion Portrait" />
          </div>
        </div>


      </section>
    </>
  );
}
