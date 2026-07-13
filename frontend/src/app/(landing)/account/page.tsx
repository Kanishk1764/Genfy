"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import GenfyNav, { LogoAsterisk } from "@landing/ui/genfy-nav";
import Footer from "@landing/components/ui/footer";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/context/theme-context";
import api from "@/utils/api";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { AlertTriangle, Trash2, X, Loader2, ShieldAlert } from "lucide-react";

export default function AccountPage() {
  const { user, refreshUser, logout, loading: authLoading } = useAuth();
  const { isDark, setIsDark } = useTheme();
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showEnhancedPrompt, setShowEnhancedPrompt] = useState(false);

  // Account deletion modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setEmail(user.email || "");
    }
  }, [user]);

  // Load developer preferences from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('genfy_show_enhanced_prompt');
    setShowEnhancedPrompt(stored === 'true');
  }, []);

  const toggleShowEnhancedPrompt = (val: boolean) => {
    setShowEnhancedPrompt(val);
    localStorage.setItem('genfy_show_enhanced_prompt', val ? 'true' : 'false');
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveStatus(null);
    
    try {
      const response = await api.post("/api/users/update-profile", { name, email });
      if (response.data.status === "success") {
        setSaveStatus({ type: "success", message: "Profile updated successfully!" });
        await refreshUser();
      }
    } catch (error: any) {
      setSaveStatus({ 
        type: "error", 
        message: error.response?.data?.detail || "Failed to update profile." 
      });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  const handleTopUp = async (amount: number) => {
    try {
      const response = await api.post("/api/users/top-up", { amount });
      if (response.data.status === "success") {
        alert(response.data.message);
        await refreshUser();
      }
    } catch (error) {
      alert("Failed to top up tokens.");
    }
  };

  const handleDeleteAccount = () => {
    setDeleteConfirmText("");
    setShowDeleteModal(true);
  };

  const executeDeleteAccount = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== "DELETE") {
      toast.error("Please type DELETE to confirm.");
      return;
    }

    try {
      setIsDeleting(true);
      const response = await api.delete("/api/users/me");
      if (response.data.status === "success") {
        // Clear all cached local studio states & settings
        try {
          Object.keys(localStorage).forEach((key) => {
            if (key.startsWith("genimage_") || key.startsWith("genfy_")) {
              localStorage.removeItem(key);
            }
          });
        } catch (e) {
          console.error("Error clearing local storage:", e);
        }

        toast.success("Your account and all associated data have been permanently deleted.");
        setShowDeleteModal(false);
        await logout();
        window.location.href = "/";
      }
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Failed to delete account. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (authLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? "bg-[#0a0a0a]" : "bg-white"}`}>
        <div className="w-12 h-12 border-4 border-[#f95738]/20 border-t-[#f95738] rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 py-32 text-center">
        <h1 className="text-4xl font-bold mb-4">Please login to access this page</h1>
        <a href="/login" className="text-[#f95738] hover:underline">Go to Login</a>
      </div>
    );
  }

  const tokenPercent = user.token_balance ? Math.min((user.total_tokens_consumed / (user.token_balance + user.total_tokens_consumed)) * 100, 100) : 0;
  const trialEndsAt = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
  const trialMsLeft = trialEndsAt ? trialEndsAt.getTime() - Date.now() : null;
  const trialDaysLeft = trialMsLeft !== null ? Math.max(0, Math.ceil(trialMsLeft / (1000 * 60 * 60 * 24))) : null;
  const trialHoursLeft = trialMsLeft !== null ? Math.max(0, Math.ceil(trialMsLeft / (1000 * 60 * 60))) : null;
  const trialActive = !!user.is_trial && trialMsLeft !== null && trialMsLeft > 0;

  return (
    <>
      <section className="max-w-[1400px] mx-auto px-6 pt-16 pb-24">
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
             <LogoAsterisk className="text-[#f95738] w-5 h-5" />
             <span className="text-[#f95738] text-[14px] font-bold tracking-widest uppercase">Settings</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight uppercase">Manage Account</h1>
          <p className={`mt-2 ${isDark ? "text-slate-400" : "text-slate-600"}`}>Manage your profile, usage, and billing preferences.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Profile Update */}
          <div className="lg:col-span-2 space-y-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-[32px] p-8 md:p-10 border ${isDark ? "bg-white/[0.03] border-white/10" : "bg-slate-50 border-slate-200"}`}
            >
               <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
                 <span className="p-2 rounded-xl bg-[#f95738]/10 text-[#f95738]">
                   <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                   </svg>
                 </span>
                 Profile Information
               </h2>

               <form onSubmit={handleUpdateProfile} className="space-y-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   <div className="space-y-2">
                     <label className={`text-sm font-semibold ml-1 ${isDark ? "text-slate-400" : "text-slate-600"}`}>Display Name</label>
                     <input 
                       type="text" 
                       value={name}
                       onChange={(e) => setName(e.target.value)}
                       placeholder="Enter your name"
                       className={`w-full px-5 py-3.5 rounded-2xl border transition-all outline-none focus:ring-2 focus:ring-[#f95738]/50 ${
                         isDark 
                           ? "bg-white/[0.05] border-white/10 text-white placeholder-white/20" 
                           : "bg-white border-slate-200 text-black placeholder-slate-400"
                       }`}
                     />
                   </div>
                   <div className="space-y-2">
                     <label className={`text-sm font-semibold ml-1 ${isDark ? "text-slate-400" : "text-slate-600"}`}>Email Address</label>
                     <input 
                       type="email" 
                       value={email}
                       onChange={(e) => setEmail(e.target.value)}
                       placeholder="Enter your email"
                       className={`w-full px-5 py-3.5 rounded-2xl border transition-all outline-none focus:ring-2 focus:ring-[#f95738]/50 ${
                         isDark 
                           ? "bg-white/[0.05] border-white/10 text-white placeholder-white/20" 
                           : "bg-white border-slate-200 text-black placeholder-slate-400"
                       }`}
                     />
                   </div>
                 </div>

                 <div className="flex items-center justify-between pt-4">
                   <AnimatePresence mode="wait">
                     {saveStatus && (
                       <motion.div 
                         initial={{ opacity: 0, x: -10 }}
                         animate={{ opacity: 1, x: 0 }}
                         exit={{ opacity: 0, x: 10 }}
                         className={`text-sm font-medium ${saveStatus.type === "success" ? "text-green-500" : "text-red-500"}`}
                       >
                         {saveStatus.message}
                       </motion.div>
                     )}
                   </AnimatePresence>
                   <button 
                     type="submit"
                     disabled={isSaving}
                     className="px-8 py-3.5 rounded-full bg-[#f95738] text-white font-bold hover:bg-[#e04e2d] transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#f95738]/20"
                   >
                     {isSaving ? (
                       <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                     ) : (
                       "Update Profile"
                     )}
                   </button>
                 </div>
               </form>
            </motion.div>

            {/* Token Usage Section */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={`rounded-[32px] p-8 md:p-10 border ${isDark ? "bg-white/[0.03] border-white/10" : "bg-slate-50 border-slate-200"}`}
            >
               <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
                 <span className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
                   <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                   </svg>
                 </span>
                 Usage & Credits
               </h2>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>Token Consumption</span>
                      <span className="text-sm font-bold">{Math.round(user.total_tokens_consumed).toLocaleString()} / {(user.token_balance + user.total_tokens_consumed).toLocaleString()}</span>
                    </div>
                    <div className={`h-3 w-full rounded-full overflow-hidden ${isDark ? "bg-white/10" : "bg-slate-200"}`}>
                       <motion.div 
                         initial={{ width: 0 }}
                         animate={{ width: `${tokenPercent}%` }}
                         className="h-full bg-gradient-to-r from-[#f95738] to-orange-400 rounded-full"
                       />
                    </div>
                    <p className={`text-[12px] ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                      Your token usage is tracked across all AI generations. Usage resets based on your billing cycle.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className={`p-5 rounded-2xl ${isDark ? "bg-white/[0.05]" : "bg-white border border-slate-100 shadow-sm"}`}>
                       <p className={`text-[11px] font-bold uppercase tracking-wider mb-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Balance</p>
                       <p className="text-xl font-black text-[#f95738]">{user.token_balance.toLocaleString()}</p>
                    </div>
                    <div className={`p-5 rounded-2xl ${isDark ? "bg-white/[0.05]" : "bg-white border border-slate-100 shadow-sm"}`}>
                       <p className={`text-[11px] font-bold uppercase tracking-wider mb-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Total Prompts</p>
                       <p className="text-xl font-black">{user.prompt_tokens_consumed.toLocaleString()}</p>
                    </div>
                  </div>
               </div>

               <div className={`p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6 ${isDark ? "bg-white/[0.05] border border-white/5" : "bg-blue-50/50 border border-blue-100"}`}>
                 <div className="flex items-center gap-4 text-center md:text-left">
                   <div className="w-12 h-12 rounded-full bg-[#f95738]/10 flex items-center justify-center text-2xl">⚡</div>
                   <div>
                     <p className="font-bold">Need more tokens?</p>
                     <p className={`text-sm ${isDark ? "text-slate-400" : "text-slate-600"}`}>Top up your account to continue generating high-quality AI images.</p>
                   </div>
                 </div>
                 <button 
                   onClick={() => handleTopUp(50000)}
                   className="px-8 py-3 rounded-full bg-white text-black font-bold hover:bg-slate-100 transition-all border border-white/10 shadow-xl"
                 >
                   Top Up Now
                 </button>
               </div>
            </motion.div>
          </div>

          {/* Right Column: Plan & Info */}
          <div className="space-y-8">
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className={`rounded-[32px] p-8 border ${isDark ? "bg-white/[0.03] border-white/10" : "bg-slate-50 border-slate-200"}`}
            >
              <h3 className="text-lg font-bold mb-6 tracking-tight uppercase">Current Plan</h3>
              <div className="flex items-baseline gap-2 mb-6">
                 <span className="text-4xl font-black text-[#f95738] uppercase tracking-tighter">
                   {trialActive ? "Trial" : (user.plan_type === 'not_selected' ? 'Free' : (user.plan_type.charAt(0).toUpperCase() + user.plan_type.slice(1)))}
                 </span>
                 <span className={`text-sm font-medium ${isDark ? "text-slate-500" : "text-slate-400"}`}>{trialActive ? "/ 7 days" : "/ month"}</span>
              </div>

              <div className={`mb-6 rounded-2xl p-4 border ${trialActive ? "bg-[#f95738]/10 border-[#f95738]/20" : isDark ? "bg-white/[0.04] border-white/10" : "bg-white border-slate-200"}`}>
                <p className="text-[11px] font-bold uppercase tracking-widest mb-2 text-[#f95738]">Trial Status</p>
                <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                  {trialActive
                    ? trialDaysLeft && trialDaysLeft > 0
                      ? `Active trial ends in ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}`
                      : `Active trial ends in ${trialHoursLeft} hour${trialHoursLeft === 1 ? "" : "s"}`
                    : "No active trial"}
                </p>
                <p className={`text-[12px] mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  {trialActive && trialEndsAt ? `Expires ${trialEndsAt.toLocaleString()}` : "Start a trial from pricing to unlock the studio experience."}
                </p>
              </div>
              
              <ul className="space-y-4 mb-8">
                 {[
                   "Access to all studio models",
                   "Cloud project storage",
                   "Standard generation speeds",
                   "Community support"
                 ].map((item, i) => (
                   <li key={i} className="flex items-center gap-3">
                     <svg className="w-4 h-4 text-[#f95738]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                     </svg>
                     <span className={`text-[13px] font-medium ${isDark ? "text-slate-300" : "text-slate-700"}`}>{item}</span>
                   </li>
                 ))}
              </ul>

              <button onClick={() => router.push("/pricing")} className={`w-full py-4 rounded-full font-bold transition-all ${isDark ? "bg-white text-black hover:bg-slate-100" : "bg-black text-white hover:bg-slate-800"}`}>
                Change Plan
              </button>
            </motion.div>

            {/* ── ACCOUNT STATUS & DANGER ZONE ── */}
            <motion.div 
               initial={{ opacity: 0, x: 20 }}
               animate={{ opacity: 1, x: 0 }}
               transition={{ delay: 0.1 }}
               className={`rounded-[32px] p-8 border ${isDark ? "bg-white/[0.03] border-white/10" : "bg-white border-slate-200"}`}
            >
              <h3 className="text-sm font-bold text-[#f95738] mb-2 uppercase tracking-widest leading-none">Account Status</h3>
              <div className="flex items-center gap-3 mb-4">
                 <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                 <span className="font-bold text-sm">Verified Account</span>
              </div>
              <p className={`text-[12px] leading-relaxed mb-6 ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                Your account is active and in good standing. Member since{" "}
                <span className="font-semibold">{new Date(user.created_at).toLocaleDateString()}</span>.
              </p>

              {/* Danger Zone */}
              <div className="pt-6 border-t border-red-500/20">
                <div className="flex items-center gap-2 mb-2 text-red-500 font-bold text-xs uppercase tracking-wider">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Danger Zone</span>
                </div>
                <p className={`text-[11px] leading-relaxed mb-4 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Permanently delete your account, all generated images, storyboards, upscale history, and personal data. This cannot be undone.
                </p>
                <button 
                  onClick={handleDeleteAccount}
                  className="w-full py-3.5 rounded-2xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white font-bold transition-all border border-red-500/30 uppercase tracking-widest text-[11px] flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Account</span>
                </button>
              </div>
            </motion.div>
          </div>
        </div>

        {/* ── DEVELOPER SETTINGS (admin only) ─────────────────────────────── */}
        {user?.role === 'admin' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className={`mt-8 rounded-[32px] p-8 md:p-10 border ${isDark ? 'bg-white/[0.03] border-white/10' : 'bg-slate-50 border-slate-200'}`}
          >
            <div className="flex items-center gap-3 mb-6">
              <span style={{ fontSize: 18 }}>⚙️</span>
              <div>
                <h3 className="text-lg font-bold tracking-tight uppercase">Developer Settings</h3>
                <p className={`text-[12px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Admin-only options for debugging and development.
                </p>
              </div>
            </div>

            <div className={`flex items-center justify-between p-5 rounded-2xl border ${isDark ? 'bg-white/[0.04] border-white/10' : 'bg-white border-slate-200'}`}>
              <div>
                <p className="font-bold text-[14px]">✦ AI Enhanced Prompt</p>
                <p className={`text-[12px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Show the full Claude-composed prompt in the Generation Info panel.<br />
                  <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                    Admin always sees this. Toggle to show it for your current session as a non-admin test.
                  </span>
                </p>
              </div>
              <button
                onClick={() => toggleShowEnhancedPrompt(!showEnhancedPrompt)}
                style={{
                  flexShrink: 0,
                  width: 48, height: 26,
                  borderRadius: 999,
                  background: showEnhancedPrompt ? 'var(--orange, #f95738)' : (isDark ? 'rgba(255,255,255,0.12)' : '#d1d5db'),
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background 0.2s',
                  marginLeft: 24,
                }}
                aria-label="Toggle AI Enhanced Prompt visibility"
              >
                <span style={{
                  position: 'absolute',
                  top: 3, left: showEnhancedPrompt ? 25 : 3,
                  width: 20, height: 20,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                }} />
              </button>
            </div>

            <p className={`mt-3 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
              This setting is saved in your browser. It does not affect other users.
            </p>
          </motion.div>
        )}
      </section>

      {/* ── PERMANENT ACCOUNT DELETION MODAL ── */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className={`w-full max-w-md rounded-3xl p-6 sm:p-8 border shadow-2xl relative ${
                isDark ? "bg-[#121212] border-red-500/30 text-white" : "bg-white border-red-200 text-slate-900"
              }`}
            >
              <button
                onClick={() => !isDeleting && setShowDeleteModal(false)}
                disabled={isDeleting}
                className="absolute top-5 right-5 p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-slate-400 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center mb-5">
                <Trash2 className="w-6 h-6" />
              </div>

              <h3 className="text-xl font-bold tracking-tight text-red-500 mb-2">
                Delete Account Permanently?
              </h3>
              <p className={`text-xs leading-relaxed mb-4 ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                This action is <strong className="text-red-400 font-semibold">irreversible</strong>. Once confirmed, all of your data will be wiped permanently:
              </p>

              <div className={`p-3.5 rounded-2xl mb-5 space-y-2 text-xs border ${
                isDark ? "bg-white/[0.02] border-white/10 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-700"
              }`}>
                <div className="flex items-start gap-2">
                  <span className="text-red-500">✕</span>
                  <span>All generated images, comparisons, and upscale history</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-red-500">✕</span>
                  <span>All storyboards, characters, products, and generated videos</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-red-500">✕</span>
                  <span>Active subscriptions, remaining token balances, and profile</span>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Type <span className="font-mono text-red-500 font-bold">DELETE</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  disabled={isDeleting}
                  className={`w-full px-4 py-3 rounded-xl border text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-red-500 transition-all ${
                    isDark
                      ? "bg-black/40 border-white/10 text-white placeholder-white/20"
                      : "bg-slate-100 border-slate-300 text-slate-900 placeholder-slate-400"
                  }`}
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                  className={`flex-1 py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors ${
                    isDark ? "bg-white/10 hover:bg-white/15 text-white" : "bg-slate-200 hover:bg-slate-300 text-slate-700"
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={executeDeleteAccount}
                  disabled={isDeleting || deleteConfirmText.trim().toUpperCase() !== "DELETE"}
                  className={`flex-1 py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                    deleteConfirmText.trim().toUpperCase() === "DELETE" && !isDeleting
                      ? "bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/30 active:scale-[0.98]"
                      : "bg-red-600/40 text-white/40 cursor-not-allowed"
                  }`}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <span>Permanently Delete</span>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <Footer isDark={isDark} />
    </>
  );
}
