"use client";

import React, { useEffect, useState, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "@/context/theme-context";
import { useAuth } from "@/context/auth-context";
import { useAuthModal } from "@/context/auth-modal-context";
import { 
  Sparkles, 
  Film, 
  Maximize2, 
  History, 
  Settings, 
  Sun, 
  Moon, 
  LogOut, 
  User, 
  Shield,
  Clock,
  Bell
} from "lucide-react";
import api from "@/utils/api";

const LogoAsterisk = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 1C12 6.5 16.5 9 22 9C16.5 9 12 11.5 12 17C12 11.5 7.5 9 2 9C7.5 9 12 6.5 12 1Z" />
    <path
      d="M12 1C12 6.5 16.5 9 22 9C16.5 9 12 11.5 12 17C12 11.5 7.5 9 2 9C7.5 9 12 6.5 12 1Z"
      transform="rotate(45 12 9)"
    />
  </svg>
);

export function StudioShell({ children }: { children: React.ReactNode }) {
  const { isDark, setIsDark } = useTheme();
  const { user, logout, isAuthenticated } = useAuth();
  const { openAuthModal } = useAuthModal();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSessionId = searchParams.get('sessionId');

  const [menuOpen, setMenuOpen] = useState(false);
  const [quota, setQuota] = useState<{
    images_used_this_week: number;
    images_limit_per_week: number;
    upscales_used_today: number;
    upscales_limit_per_day: number;
  } | null>(null);

  const isSidebarExpanded = true;
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [openHistoryMenu, setOpenHistoryMenu] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  const [showAdminHistoryState, setShowAdminHistoryState] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('genfy_show_admin_history') === 'true';
    }
    return false;
  });

  useEffect(() => {
    const handleStorage = () => {
      if (typeof window !== 'undefined') {
        setShowAdminHistoryState(localStorage.getItem('genfy_show_admin_history') === 'true');
      }
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('genfy_admin_history_toggled', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('genfy_admin_history_toggled', handleStorage);
    };
  }, []);

  const menuRef = useRef<HTMLDivElement>(null);
  const gearBtnRef = useRef<HTMLButtonElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);

  // Fetch quota on mount + every 60s so credits widget stays live
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchQuota = () => {
      api.get("/api/quota")
        .then((res) => setQuota(res.data))
        .catch((err) => console.error("Failed to fetch user quota:", err));
    };
    fetchQuota();
    const interval = setInterval(fetchQuota, 60_000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Also refresh when settings menu opens (instant update)
  useEffect(() => {
    if (menuOpen && isAuthenticated) {
      api.get("/api/quota")
        .then((res) => setQuota(res.data))
        .catch((err) => console.error("Failed to fetch user quota:", err));
    }
  }, [menuOpen, isAuthenticated]);

  // Fetch history for expanded sidebar
  useEffect(() => {
    if (isAuthenticated) {
      api.get("/api/sessions")
        .then((res) => setHistoryItems(res.data.sessions || []))
        .catch((err) => console.error("Failed to fetch sessions for sidebar:", err));
    } else {
      setHistoryItems([]);
    }
  }, [isAuthenticated, deletingId, activeSessionId]);

  // Handle click outside to close menus
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      // Close settings menu
      if (
        menuRef.current && 
        !menuRef.current.contains(event.target as Node) &&
        gearBtnRef.current && 
        !gearBtnRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
      // Close history menu
      if (historyMenuRef.current && !historyMenuRef.current.contains(event.target as Node)) {
        setOpenHistoryMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const deleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDeletingId(id);
    setOpenHistoryMenu(null);
    try {
      await api.delete(`/api/sessions/${id}`);
      setHistoryItems(prev => prev.filter(item => item.id !== id));
    } catch (err) {
      console.error('Failed to delete session:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const startNewGeneration = async () => {
    try {
      const { del: idbDel } = await import('idb-keyval');
      await idbDel('genimage_blobs_v4');
    } catch (err) {
      console.error('Failed to clear IndexedDB:', err);
    }
    // Clear ALL persisted studio state so the new session starts completely blank
    localStorage.removeItem('genimage_pending_job');
    localStorage.removeItem('genimage_last_reuse_session');
    localStorage.removeItem('genimage_settings_v3');  // clears prompt, styles, ratio, quality
    localStorage.removeItem('genimage_auto_trigger');
    window.location.href = "/studio";
  };


  const navItems = [
    { 
      id: "studio", 
      icon: Sparkles, 
      label: "Studio", 
      path: "/studio", 
      active: pathname === "/studio" || pathname === "/generate" 
    },
    { 
      id: "storyboard", 
      icon: Film, 
      label: "Storyboard", 
      path: "/storyboard", 
      active: pathname.startsWith("/storyboard") 
    },
    { 
      id: "upscales", 
      icon: Maximize2, 
      label: "Upscale", 
      path: "/upscales", 
      active: pathname.startsWith("/upscales") 
    },
    ...(user?.role === "admin" || user?.is_admin
      ? [
          {
            id: "admin",
            icon: Shield,
            label: "Admin",
            path: "/admin",
            active: pathname.startsWith("/admin"),
          },
        ]
      : []),
  ];

  // In collapsed mode, we also show History in the main navigation list
  const collapsedNavItems = [
    ...navItems,
    {
      id: "history",
      icon: History,
      label: "History",
      path: "/history",
      active: pathname.startsWith("/history")
    }
  ];

  const TOTAL_CREDITS = 120; // Credits scale shown to users
  const imagesUsed = quota ? quota.images_used_this_week : 0;
  const imagesLimit = quota ? quota.images_limit_per_week : 50;
  const isUnlimited = imagesLimit === -1;
  // Proportional credits: 120 total, each image costs (120 / imagesLimit) credits
  const creditsRemaining = isUnlimited
    ? TOTAL_CREDITS
    : Math.max(0, Math.round(TOTAL_CREDITS * (imagesLimit - imagesUsed) / imagesLimit));
  const quotaPercent = isUnlimited ? 0 : Math.min((imagesUsed / imagesLimit) * 100, 100);

  const formatRelativeTime = (dateStr: string) => {
    if (!dateStr) return "Just now";
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHr = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHr / 24);

      if (isNaN(date.getTime())) return "Just now";
      if (diffSec < 60) return "Just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHr < 24) return `${diffHr}h ago`;
      if (diffDays === 1) return "1 day ago";
      return `${diffDays} days ago`;
    } catch (_) {
      return "Just now";
    }
  };

  return (
    <div
      className={`transition-colors duration-300 ${
        (pathname.startsWith("/generate") || pathname.startsWith("/storyboard"))
          ? "h-[calc(100vh/1.125)] max-h-[calc(100vh/1.125)] overflow-hidden flex flex-row"
          : "min-h-screen flex flex-row"
      }`}
      style={{
        background: "var(--bg)",
        color: "var(--text)",
        zoom: 1.125,
        minHeight: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? undefined : "88.89vh",
        height: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? "calc(100vh / 1.125)" : undefined,
        maxHeight: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? "calc(100vh / 1.125)" : undefined,
        overflow: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? "hidden" : undefined,
      } as React.CSSProperties}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        html:has([data-storyboard-page="true"]),
        body:has([data-storyboard-page="true"]) {
          overflow: hidden !important;
          height: 100% !important;
          max-height: 100vh !important;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        body.is-editing .studio-floating-widgets {
          display: none !important;
        }
      ` }} />
      {/* SIDEBAR - STATIC PERMANENTLY OPEN SIDEBAR */}
      <div 
        className="fixed z-[1000] flex flex-col items-center py-6"
        style={{
          background: "var(--card-bg)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          zoom: 0.625,
          left: "0",
          top: "0",
          transform: "none",
          width: "340px",
          height: "142.22vh",
          borderRadius: "0",
          paddingLeft: "16px",
          paddingRight: "16px",
          borderLeft: "none",
          borderTop: "none",
          borderBottom: "none",
          borderRight: "1px solid var(--card-border)",
          boxShadow: "none",
        }}
      >
        {/* LOGO */}
        <div 
          onClick={() => {
            localStorage.removeItem('genimage_settings_v3');
            localStorage.removeItem('genimage_pending_job');
            localStorage.removeItem('genimage_last_reuse_session');
            localStorage.removeItem('genimage_auto_trigger');
            window.location.href = "/studio";
          }}
          className={`flex items-center w-full cursor-pointer select-none rounded-xl ${
            isSidebarExpanded ? "px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5" : "justify-center w-10 h-10"
          } transition-all duration-300`}
        >
          <LogoAsterisk className="w-6 h-6 text-orange-500 flex-shrink-0 animate-pulse" />
          <span className={`font-extrabold tracking-tight text-gray-900 dark:text-white transition-all duration-300 whitespace-nowrap overflow-hidden ${
            isSidebarExpanded ? 'opacity-100 max-w-40 ml-3' : 'opacity-0 max-w-0 pointer-events-none'
          }`} style={{ fontSize: '28px' }}>
            Genfy
          </span>
        </div>

        <div className="w-full h-[1px] bg-black/5 dark:bg-white/10 my-5" />

        {/* + NEW GENERATION BUTTON (Only in hovered state) */}
        {isSidebarExpanded && (
          <div className="w-full flex justify-center px-1 animate-in fade-in duration-200 mb-5">
            <button
              onClick={startNewGeneration}
              className="w-full py-3.5 bg-black dark:bg-white text-white dark:text-black rounded-xl font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all duration-200"
            >
              <span className="text-xl font-bold leading-none">+</span>
              <span style={{ fontSize: '20px' }}>New Generation</span>
            </button>
          </div>
        )}

        {/* NAVIGATION ITEMS */}
        <div className="flex flex-col gap-2.5 w-full">
          {(isSidebarExpanded ? navItems : collapsedNavItems).map((item) => {
            const Icon = item.icon;
            const isActive = item.active;
            return (
              <button
                key={item.id}
                onClick={() => router.push(item.path)}
                className={`h-13 rounded-xl flex items-center transition-all duration-300 group relative ${
                  isSidebarExpanded ? "px-4 justify-start w-full" : "justify-center w-11"
                } ${
                  isActive 
                    ? "bg-gray-100 dark:bg-zinc-800/80 text-gray-900 dark:text-white font-bold" 
                    : "text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                }`}
                aria-label={item.label}
              >
                <Icon className="w-5.5 h-5.5 flex-shrink-0 transition-transform duration-200 group-hover:scale-105" />
                <span className={`font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ${
                  isSidebarExpanded ? "opacity-100 max-w-32 ml-3" : "opacity-0 max-w-0 pointer-events-none"
                }`} style={{ fontSize: '20px' }}>
                  {item.label}
                </span>
                
                {/* TOOLTIP: Only show if NOT hovered */}
                {!isSidebarExpanded && (
                  <div className="absolute left-14 opacity-0 group-hover:opacity-100 bg-black text-white dark:bg-white dark:text-black text-xs font-semibold px-2.5 py-1.5 rounded-lg pointer-events-none transition-opacity duration-200 whitespace-nowrap shadow-md z-50">
                    {item.label}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* HISTORY SECTION (Only shown when expanded) */}
        {isSidebarExpanded && (
          <div className="flex flex-col w-full gap-2 mt-5 px-1 select-none animate-in fade-in duration-300" style={{ overflow: 'visible' }}>
            <div className="flex items-center text-gray-900 dark:text-white gap-2.5 px-3 py-2 mt-1">
              <Clock className="w-4 h-4 text-gray-900 dark:text-white flex-shrink-0" />
              <span style={{ fontSize: '20px' }} className="font-bold">History</span>
            </div>
            <div className="flex flex-col gap-1.5 max-h-[380px] overflow-y-auto pr-1 text-left no-scrollbar" style={{ overflow: 'auto' }}>
              {historyItems.length > 0 ? (
                historyItems.slice(0, 15).map((item, idx) => {
                  const isMenuOpen = openHistoryMenu === item.id;
                  const isDeleting = deletingId === item.id;
                  const isActive = item.id === activeSessionId;
                  return (
                    <div
                      key={item.id || idx}
                      className="relative group/item w-full"
                    >
                      <button
                        onClick={() => router.push(`/generate?sessionId=${item.id}`)}
                        className="w-full text-left py-2 pl-3 pr-8 rounded-lg transition-all duration-200"
                        style={{
                          opacity: isDeleting ? 0.4 : 1,
                          background: isActive ? 'rgba(249,87,56,0.10)' : undefined,
                          borderLeft: isActive ? '2.5px solid #f95738' : '2.5px solid transparent',
                        }}
                        disabled={isDeleting}
                      >
                        <p style={{ fontSize: '20px' }} className={`font-medium truncate transition-colors ${
                          isActive
                            ? 'text-orange-500 dark:text-orange-400 font-semibold'
                            : 'text-gray-500 dark:text-gray-400 group-hover/item:text-black dark:group-hover/item:text-white'
                        }`}>
                          {item.prompt || "Untitled Generation"}
                        </p>
                      </button>

                      {/* 3-dot menu button — appears on hover */}
                      {!isDeleting && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenHistoryMenu(isMenuOpen ? null : item.id); }}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-gray-400 dark:text-gray-500 opacity-0 group-hover/item:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white transition-all duration-150"
                          title="Options"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                          </svg>
                        </button>
                      )}

                      {/* Deleting spinner */}
                      {isDeleting && (
                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center">
                          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/>
                          </svg>
                        </div>
                      )}

                      {/* Dropdown menu */}
                      {isMenuOpen && (
                        <div
                          ref={historyMenuRef}
                          className="absolute right-0 top-full mt-1 z-[9999] bg-white dark:bg-zinc-900 border border-black/8 dark:border-white/10 rounded-xl shadow-xl overflow-hidden"
                          style={{ minWidth: 140 }}
                        >
                          <button
                            onClick={(e) => deleteHistoryItem(item.id, e)}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors duration-150"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                            </svg>
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="text-[12px] text-gray-400 dark:text-gray-600 px-3 py-2">No history yet</p>
              )}
            </div>
          </div>
        )}

        {/* BOTTOM CONTROLS & SETTINGS */}
        <div className="mt-auto w-full flex flex-col gap-3 items-center pt-4 border-t border-black/5 dark:border-white/10">
          {/* DIRECT THEME SWITCHER */}
          {isSidebarExpanded ? (
            <button
              onClick={() => setIsDark(!isDark)}
              className="h-11 px-4 rounded-xl flex items-center w-full text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-300 animate-in fade-in duration-200"
            >
              {isDark ? <Sun className="w-5.5 h-5.5 flex-shrink-0" /> : <Moon className="w-5.5 h-5.5 flex-shrink-0" />}
              <span style={{ fontSize: '20px' }} className="font-semibold ml-3 whitespace-nowrap overflow-hidden transition-all duration-300">
                {isDark ? "Light Theme" : "Dark Theme"}
              </span>
            </button>
          ) : (
            <button
              onClick={() => setIsDark(!isDark)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-300 group relative"
              aria-label="Toggle Theme"
            >
              {isDark ? <Sun className="w-5.5 h-5.5 flex-shrink-0" /> : <Moon className="w-5.5 h-5.5 flex-shrink-0" />}
              <div className="absolute left-14 opacity-0 group-hover:opacity-100 bg-black text-white dark:bg-white dark:text-black text-xs font-semibold px-2.5 py-1.5 rounded-lg pointer-events-none transition-opacity duration-200 whitespace-nowrap shadow-md z-50">
                {isDark ? "Light Mode" : "Dark Mode"}
              </div>
            </button>
          )}

          {/* GEAR/SETTINGS */}
          <div className="relative w-full flex justify-center">
            <button
              ref={gearBtnRef}
              onClick={() => setMenuOpen(!menuOpen)}
              className={`h-11 rounded-xl flex items-center transition-all duration-300 group relative ${
                isSidebarExpanded ? "px-4 justify-start w-full" : "justify-center w-11"
              } ${
                menuOpen || pathname === "/admin"
                  ? "bg-gray-100 dark:bg-zinc-800/80 text-gray-900 dark:text-white font-bold"
                  : "text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
              }`}
              aria-label="Settings"
            >
              {isAuthenticated && user ? (
                <div className="w-5.5 h-5.5 rounded-full bg-gradient-to-tr from-orange-500 to-red-500 flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0">
                  {(user.name || user.email).charAt(0).toUpperCase()}
                </div>
              ) : (
                <Settings className="w-5.5 h-5.5 flex-shrink-0 group-hover:rotate-45 transition-all duration-300" />
              )}
              <span className={`font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ${
                isSidebarExpanded ? "opacity-100 max-w-32 ml-3" : "opacity-0 max-w-0 pointer-events-none"
              }`} style={{ fontSize: '20px' }}>
                Settings
              </span>
            </button>
            
            {/* TOOLTIP: Only show if NOT hovered */}
            {!isSidebarExpanded && (
              <div className="absolute left-14 opacity-0 group-hover:opacity-100 bg-black text-white dark:bg-white dark:text-black text-xs font-semibold px-2.5 py-1.5 rounded-lg pointer-events-none transition-opacity duration-200 whitespace-nowrap shadow-md z-50">
                Settings & Account
              </div>
            )}
          </div>

          {/* SETTINGS POPOVER MENU - floating right next to the sidebar */}
          {menuOpen && (
            <div
              ref={menuRef}
              className="absolute left-full ml-3 bottom-0 w-68 bg-white/95 dark:bg-[#141414]/95 border border-black/5 dark:border-white/10 rounded-2xl p-4 shadow-2xl z-[2000] animate-in fade-in slide-in-from-left-2 duration-200"
              style={{
                boxShadow: isDark 
                  ? "0 10px 40px rgba(0,0,0,0.6)" 
                  : "0 10px 30px rgba(0,0,0,0.12)"
              }}
            >
              {/* USER PROFILE INFO */}
              {isAuthenticated && user ? (
                <div className="mb-4">
                  <div className="flex items-center gap-2.5 mb-3 pb-3 border-b border-black/5 dark:border-white/5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-orange-500 to-red-500 flex items-center justify-center text-white font-bold text-xs">
                      {(user.name || user.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate text-gray-900 dark:text-white">
                        {user.name || "Explorer"}
                      </p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        {user.email}
                      </p>
                    </div>
                  </div>

                  {/* QUOTA STATS */}
                  <div className="bg-black/5 dark:bg-white/5 rounded-xl p-3 mb-3">
                    <div className="flex justify-between text-[10px] font-semibold text-gray-400 dark:text-gray-500 mb-1">
                      <span>Weekly Generations</span>
                      <span>{isUnlimited ? "Unlimited" : `${imagesUsed} / ${imagesLimit}`}</span>
                    </div>
                    {!isUnlimited && (
                      <div className="w-full h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-orange-500 rounded-full transition-all duration-300"
                          style={{ width: `${quotaPercent}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mb-4 text-center pb-3 border-b border-black/5 dark:border-white/5">
                  <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-950/30 flex items-center justify-center mx-auto mb-2 text-orange-500">
                    <User className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-semibold text-gray-900 dark:text-white mb-1">Guest Mode</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-3">Login to save your generations</p>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      openAuthModal("login");
                    }}
                    className="w-full py-2 bg-[#f95738] hover:bg-[#e04e2d] text-white rounded-xl text-xs font-semibold shadow-md shadow-[#f95738]/20 transition-all active:scale-[0.98]"
                  >
                    Login / Sign Up
                  </button>
                </div>
              )}

              {/* ACTION LIST */}
              <div className="flex flex-col gap-1.5 text-xs">
                {/* THEME TOGGLE */}
                <button
                  onClick={() => setIsDark(!isDark)}
                  className="flex items-center justify-between px-2.5 py-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl text-gray-600 dark:text-gray-300 font-medium transition-colors"
                >
                  <span className="flex items-center gap-2">
                    {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
                  </span>
                  <div className={`w-8 h-4.5 rounded-full p-0.5 transition-colors ${isDark ? 'bg-orange-500' : 'bg-gray-300'}`}>
                    <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${isDark ? 'translate-x-3.5' : 'translate-x-0'}`} />
                  </div>
                </button>

                {/* ADMIN DASHBOARD (if admin) */}
                {isAuthenticated && (user?.is_admin || user?.role === "admin") && (
                  <>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        router.push("/admin");
                      }}
                      className="flex items-center gap-2 px-2.5 py-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl text-gray-600 dark:text-gray-300 font-medium transition-colors text-left"
                    >
                      <Shield className="w-4 h-4 text-orange-500" />
                      <span>Admin Dashboard</span>
                    </button>

                  </>
                )}

                {/* ACCOUNT & SETTINGS */}
                {isAuthenticated && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      router.push("/account");
                    }}
                    className="flex items-center gap-2 px-2.5 py-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl text-gray-600 dark:text-gray-300 font-medium transition-colors text-left"
                  >
                    <User className="w-4 h-4 text-orange-500" />
                    <span>Account Settings</span>
                  </button>
                )}

                {/* LOGOUT */}
                {isAuthenticated && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                      router.push("/studio");
                    }}
                    className="flex items-center gap-2 px-2.5 py-2 hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500 rounded-xl font-medium transition-colors text-left mt-1.5"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Log Out</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CONTENT AREA */}
      <div 
        className="flex-1 relative pl-[213px]"
        style={{
          paddingTop: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? '0px' : '32px',
          paddingBottom: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? '0px' : '32px',
          paddingRight: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? '0px' : '32px',
          height: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? 'calc(100vh / 1.125)' : undefined,
          maxHeight: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? 'calc(100vh / 1.125)' : undefined,
          minHeight: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? 0 : '88.89vh',
          overflow: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? 'hidden' : undefined,
          display: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? 'flex' : undefined,
          flexDirection: (pathname.startsWith("/generate") || pathname.startsWith("/storyboard")) ? 'column' : undefined,
        }}
      >
        {/* Floating Top Right Header (mockup widgets) — hidden on storyboard to avoid overlap */}
        {!pathname.startsWith('/storyboard') && (
        <div className="studio-floating-widgets absolute top-6 right-8 flex items-center gap-4 z-[400]">
          {/* Credits Widget */}
          <div className="flex items-center gap-1.5 px-4 py-2 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-full text-xs text-gray-700 dark:text-gray-200 shadow-sm">
            <span className="opacity-80">Credits</span>
            <span className="font-bold">{isUnlimited ? "∞" : creditsRemaining}</span>
          </div>

          {/* Bell Notification Widget */}
          <button className="w-9 h-9 rounded-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center relative text-gray-600 dark:text-gray-300 transition-all hover:bg-black/10 dark:hover:bg-white/10 active:scale-95 shadow-sm">
            <Bell className="w-4.5 h-4.5" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-[#f95738] rounded-full border border-white dark:border-zinc-900" />
          </button>

          {/* User Profile Widget */}
          <button className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center font-extrabold text-sm shadow-md transition-all active:scale-[0.98]">
            {isAuthenticated && user ? (user.name || user.email).charAt(0).toUpperCase() : "A"}
          </button>
        </div>
        )}

        {children}
      </div>
    </div>
  );
}
