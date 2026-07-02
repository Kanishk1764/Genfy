"use client";
// Refinement: using custom SVG icons for better reliability

import React from "react";
import Link from "next/link";
import { Mail, ArrowUpRight } from "lucide-react";
import { LogoAsterisk } from "@landing/ui/genfy-nav";

const SocialX = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.045 4.126H5.078z" />
  </svg>
);

const SocialGithub = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

const SocialInstagram = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

const SocialYoutube = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505a3.017 3.017 0 0 0-2.122 2.136C0 8.055 0 12 0 12s0 3.945.501 5.814a3.017 3.017 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.945 24 12 24 12s0-3.945-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const footerLinks = [
  {
    title: "Product",
    links: [
      { name: "Explore", href: "#" },
      { name: "Image Generation", href: "#" },
      { name: "Video Generation", href: "#" },
      { name: "Pricing", href: "/pricing" },
      { name: "Cinema Gallery", href: "#" },
      { name: "Login", href: "/login" },
      { name: "Sign Up", href: "/signup" },
    ],
  },
  {
    title: "Company",
    links: [
      { name: "About Us", href: "#" },
      { name: "Careers", href: "#" },
      { name: "Blog", href: "#" },
      { name: "Contact", href: "#" },
    ],
  },
  {
    title: "Resources",
    links: [
      { name: "Documentation", href: "#" },
      { name: "Community", href: "#" },
      { name: "Discord", href: "#" },
      { name: "Support", href: "#" },
    ],
  },
];

export default function Footer({ isDark }: { isDark: boolean }) {
  return (
    <footer 
      className={`w-full pt-20 pb-10 transition-colors duration-300 ${
        isDark ? "bg-[#0a0a0a] border-t border-white/5" : "bg-white"
      }`}
    >
      <div className="max-w-[1440px] mx-auto px-6">
        <div className="flex flex-col lg:flex-row justify-between gap-16 mb-20">
          {/* Logo & Tagline */}
          <div className="flex flex-col gap-6 max-w-sm">
            <Link href="/" className="flex items-center gap-2 group">
              <LogoAsterisk className="text-[#f95738] w-8 h-8 transition-transform group-hover:rotate-45" />
              <span className={`text-2xl font-black uppercase tracking-tighter ${isDark ? "text-white" : "text-black"}`}>
                GENFY
              </span>
            </Link>
            <p className={`text-[15px] leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              The next-generation AI workspace for cinematic visual storytelling.
              Turn your wildest ideas into stunning visuals with just a few clicks.
            </p>
            <div className="flex items-center gap-4 mt-2">
              {[SocialX, SocialGithub, SocialYoutube, SocialInstagram].map((Icon, idx) => (
                <Link 
                  key={idx} 
                  href="#" 
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    isDark 
                      ? "bg-white/5 text-slate-400 hover:bg-[#f95738] hover:text-white" 
                      : "bg-slate-100 text-slate-600 hover:bg-[#f95738] hover:text-white"
                  }`}
                >
                  <Icon />
                </Link>
              ))}
            </div>
          </div>

          {/* Links Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-12 lg:gap-24">
            {footerLinks.map((section) => (
              <div key={section.title} className="flex flex-col gap-6">
                <h4 className={`text-[14px] font-bold uppercase tracking-widest ${isDark ? "text-white" : "text-black"}`}>
                  {section.title}
                </h4>
                <div className="flex flex-col gap-4">
                  {section.links.map((link) => (
                    <Link 
                      key={link.name} 
                      href={link.href} 
                      className={`text-[15px] font-medium transition-colors hover:text-[#f95738] ${
                        isDark ? "text-slate-400" : "text-slate-500"
                      }`}
                    >
                      {link.name}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className={`pt-10 border-t flex flex-col md:flex-row items-center justify-between gap-6 ${
          isDark ? "border-white/5" : "border-slate-100"
        }`}>
          <div className={`text-[13px] flex items-center gap-6 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
            <span>© 2026 Genfy Inc. All rights reserved.</span>
            <Link href="#" className="hover:text-[#f95738] transition-colors">Privacy Policy</Link>
            <Link href="#" className="hover:text-[#f95738] transition-colors">Terms of Service</Link>
          </div>
          
          <div className="flex items-center gap-2">
            {/* System Status removed */}
          </div>
        </div>
      </div>
    </footer>
  );
}
