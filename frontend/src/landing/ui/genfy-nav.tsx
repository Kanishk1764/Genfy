"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { motion } from "motion/react";
import api from "@/utils/api";

export const LogoAsterisk = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 1C12 6.5 16.5 9 22 9C16.5 9 12 11.5 12 17C12 11.5 7.5 9 2 9C7.5 9 12 6.5 12 1Z" />
    <path
      d="M12 1C12 6.5 16.5 9 22 9C16.5 9 12 11.5 12 17C12 11.5 7.5 9 2 9C7.5 9 12 6.5 12 1Z"
      transform="rotate(45 12 9)"
    />
  </svg>
);

const NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Gallery", href: "/gallery" },
  { label: "About", href: "/about" },
  { label: "Pricing", href: "/pricing" },
  { label: "Studio", href: "/studio" },
  { label: "Generate", href: "/generate" },
  { label: "Storyboard", href: "/storyboard" },
  { label: "Upscales", href: "/upscales" },
  { label: "Admin", href: "/admin", protected: true },
];

// ─── Profile Dropdown ────────────────────────────────────────────────────────

function ProfileDropdown({
  user,
  logout,
  isDark,
}: {
  user: any;
  logout: () => void;
  isDark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; right: number } | null>(null);
  const [quota, setQuota] = useState<{
    images_used_this_week: number;
    images_limit_per_week: number;
    upscales_used_today: number;
    upscales_limit_per_day: number;
  } | null>(null);

  useEffect(() => {
    if (open && user) {
      api.get("/api/quota")
        .then(res => {
          setQuota(res.data);
        })
        .catch(err => {
          console.error("Failed to fetch user quota:", err);
        });
    }
  }, [open, user]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Compute fixed position when opening
  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropPos({
        top: rect.bottom + 10,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(v => !v);
  };

  const displayName =
    user.name ||
    user.email
      .split("@")[0]
      .replace(/[._]/g, " ")
      .replace(/\b\w/g, (c: string) => c.toUpperCase());
  const initial = displayName.charAt(0).toUpperCase();
  const isTrialActive = !!user.is_trial && !!user.trial_ends_at && new Date(user.trial_ends_at).getTime() > Date.now();
  const planLabel = isTrialActive
    ? "7-Day Trial"
    : user.plan_type && user.plan_type !== "not_selected"
      ? `${user.plan_type.charAt(0).toUpperCase()}${user.plan_type.slice(1)} Plan`
      : "Free Plan";
  const isPremium = user.plan_type === "enterprise" || user.plan_type === "pro";

  const imagesUsed = quota ? quota.images_used_this_week : 0;
  const imagesLimit = quota ? quota.images_limit_per_week : 50;
  const isUnlimited = imagesLimit === -1;
  const creditsPercent = isUnlimited ? 0 : Math.min((imagesUsed / imagesLimit) * 100, 100);
  const outOfCredits = !isUnlimited && imagesUsed >= imagesLimit;

  return (
    <div className="relative" ref={ref}>
      {/* Avatar trigger */}
      <button
        ref={triggerRef}
        onClick={handleToggle}
        aria-label="Open profile menu"
        className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-[15px] text-white transition-transform hover:scale-105 focus:outline-none ring-2 ring-[#f95738]/40 hover:ring-[#f95738]/80"
        style={{ background: "linear-gradient(135deg,#f95738,#e04e2d)" }}
      >
        {initial}
      </button>

      {/* Dropdown — rendered fixed to escape overflow:hidden ancestors */}
      {open && dropPos && (
        <div
          className="fixed w-[260px] rounded-2xl shadow-2xl z-[99999] overflow-hidden"
          style={{
            top: dropPos.top,
            right: dropPos.right,
            background: isDark ? "#1a1a1a" : "#ffffff",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
          }}
        >
          {/* User info */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-[15px] text-white flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#f95738,#e04e2d)" }}
            >
              {initial}
            </div>
            <div className="min-w-0">
              <p
                className={`text-[14px] font-semibold truncate ${isDark ? "text-white" : "text-gray-900"}`}
              >
                {displayName}
              </p>
              <p
                className={`text-[12px] truncate ${isDark ? "text-white/50" : "text-gray-500"}`}
              >
                {planLabel}
              </p>
            </div>
          </div>

          {/* Divider */}
          <div
            className="mx-4"
            style={{
              height: "1px",
              background: isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(0,0,0,0.06)",
            }}
          />

          {/* Credits section */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span
                className={`text-[13px] font-semibold ${outOfCredits ? "text-[#f95738]" : isDark ? "text-white/80" : "text-gray-700"}`}
              >
                Weekly Images
              </span>
              <span className={`text-[12px] font-medium ${isDark ? "text-white/50" : "text-gray-500"}`}>
                {isUnlimited ? "Unlimited ∞" : `${imagesUsed} / ${imagesLimit}`}
              </span>
            </div>
            {/* Credits bar — hidden for unlimited */}
            {!isUnlimited && (
            <div
              className="w-full rounded-full overflow-hidden"
              style={{
                height: "6px",
                background: isDark ? "rgba(255,255,255,0.1)" : "#e5e7eb",
              }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${creditsPercent}%`,
                  background: outOfCredits
                    ? "linear-gradient(90deg,#f95738,#e04e2d)"
                    : "linear-gradient(90deg,#f95738,#fbbf24)",
                }}
              />
            </div>
            )}
          </div>

          {/* Divider */}
          <div
            className="mx-4"
            style={{
              height: "1px",
              background: isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(0,0,0,0.06)",
            }}
          />

          {/* Go Premium row */}
          {!isPremium && (
            <>
              <div className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[18px]">👑</span>
                  <span
                    className={`text-[14px] font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
                  >
                    Go Premium
                  </span>
                </div>
                <Link
                  href="/pricing"
                  onClick={() => setOpen(false)}
                  className="px-4 py-1.5 rounded-lg text-[13px] font-bold text-white no-underline transition-all hover:scale-105"
                  style={{ background: "#f95738", color: "white" }}
                >
                  Upgrade
                </Link>
              </div>

              {/* Divider */}
              <div
                className="mx-4"
                style={{
                  height: "1px",
                  background: isDark
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(0,0,0,0.06)",
                }}
              />
            </>
          )}

          <div className="py-1">
            {[
              {
                label: "Manage account",
                href: "/account",
                icon: (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                ),
              },
            ].map(({ label, href, icon }) => (
              <Link
                key={label}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-4 py-2.5 text-[14px] font-medium no-underline transition-colors ${
                  isDark
                    ? "text-white/75 hover:text-white hover:bg-white/5"
                    : "text-gray-700 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                <span
                  className={isDark ? "text-white/40" : "text-gray-400"}
                >
                  {icon}
                </span>
                {label}
              </Link>
            ))}
          </div>

          {/* Divider */}
          <div
            className="mx-4"
            style={{
              height: "1px",
              background: isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(0,0,0,0.06)",
            }}
          />

          {/* Sign out */}
          <div className="py-1">
            <button
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-[14px] font-medium transition-colors ${
                isDark
                  ? "text-white/75 hover:text-white hover:bg-white/5"
                  : "text-gray-700 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              <span className={isDark ? "text-white/40" : "text-gray-400"}>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
                  />
                </svg>
              </span>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Nav ────────────────────────────────────────────────────────────────

export default function GenfyNav({
  isDark,
  setIsDark,
  fullWidth = false,
  className = "",
  edgeInsetClassName = "",
  containerClassName = "",
  leftSectionClassName = "",
  leftSectionStyle,
  studioMode = false,
  fixed = false,
  collapsed = false,
}: {
  isDark: boolean;
  setIsDark: (val: boolean) => void;
  fullWidth?: boolean;
  className?: string;
  edgeInsetClassName?: string;
  containerClassName?: string;
  leftSectionClassName?: string;
  leftSectionStyle?: React.CSSProperties;
  studioMode?: boolean;
  fixed?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const { user, logout, loading } = useAuth();

  return (
    <div className={`${fixed ? "fixed top-0 left-0 right-0" : "sticky top-0"} z-[1000] w-full transition-transform duration-200 ${
      studioMode 
        ? (isDark ? "bg-[#0a0a0a]" : "bg-white")
        : (isDark ? "bg-[#0a0a0a]/80" : "bg-white/80")
    } ${studioMode ? "" : "backdrop-blur-md"} ${collapsed ? "-translate-y-full" : "translate-y-0"}`}>
      <nav
        className={`flex items-center justify-between py-4 font-sans ${
          fullWidth ? "w-full" : "max-w-[1400px] mx-auto w-full"
        } ${containerClassName} ${className || "px-6"}`}
      >
        {/* Logo */}
        <div
          className={`flex items-center gap-2 ${edgeInsetClassName} ${leftSectionClassName}`}
          style={leftSectionStyle}
        >
          <Link href="/" className="flex items-center gap-2 no-underline group">
            <LogoAsterisk className="text-[#f95738] w-7 h-7 transition-transform group-hover:rotate-45" />
            <span
              className={`font-black text-[24px] ${
                isDark ? "text-white" : "text-black"
              }`}
            >
              Genfy
            </span>
          </Link>
          
          {/* Dark/Light Toggle */}
          <button
            onClick={() => setIsDark(!isDark)}
            className={`ml-4 flex h-5 w-10 items-center rounded-full p-0.5 transition-colors duration-300 ${
              isDark ? "bg-slate-700" : "bg-slate-300"
            }`}
            aria-label="Toggle theme"
          >
            <div
              className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${
                isDark ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Nav Items */}
        <div className="hidden md:flex items-center gap-10 text-[15px] font-semibold font-sans">
          {NAV_ITEMS.filter((item: any) => {
            if (item.protected && (!user || user.role !== "admin")) return false;
            return true;
          }).map(({ label, href }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={label}
                href={href}
                className="flex flex-col items-center gap-1 no-underline relative group"
              >
                <span
                  className={`transition-all duration-200 ${
                    isActive
                      ? "text-[#f95738]"
                      : isDark
                        ? "text-slate-400 group-hover:text-white"
                        : "text-slate-500 group-hover:text-black"
                  }`}
                >
                  {label}
                </span>
                {isActive && (
                  <motion.div 
                    layoutId="nav-active"
                    className="absolute -bottom-1.5"
                  >
                    <LogoAsterisk className="text-[#f95738] w-2.5 h-2.5" />
                  </motion.div>
                )}
              </Link>
            );
          })}
        </div>

        {/* Auth Buttons */}
        <div className={`flex items-center gap-4 min-w-[150px] justify-end ${edgeInsetClassName}`}>
          {loading ? (
            <div className="w-5 h-5 border-2 border-[#f95738]/20 border-t-[#f95738] rounded-full animate-spin" />
          ) : user ? (
            <ProfileDropdown user={user} logout={logout} isDark={isDark} />
          ) : (
            <div className="flex items-center gap-3">
              <Link
                href="/signup"
                className={`px-6 py-2.5 rounded-full text-[14px] font-bold transition-all no-underline ${
                  isDark 
                    ? "text-white hover:bg-white/5" 
                    : "text-slate-900 hover:bg-black/5"
                }`}
              >
                Sign Up
              </Link>
              <Link
                href="/login"
                className="px-7 py-2.5 rounded-full bg-[#f95738] text-white text-[14px] font-bold hover:bg-[#e04e2d] transition-all shadow-lg shadow-[#f95738]/20 no-underline"
              >
                Login
              </Link>
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}
