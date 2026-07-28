"use client";

import React, { useEffect, useState, useRef } from "react";
import { useAuth } from "@/context/auth-context";
import api from "@/utils/api";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Users,
  Image as ImageIcon,
  Settings,
  ShieldAlert,
  Search,
  Edit2,
  Power,
  Ban,
  TrendingUp,
  CheckCircle,
  Calendar,
  ArrowLeft,
  Download,
  Sparkles,
  Loader2,
  Lock,
  RefreshCw,
  Eye,
  Sliders,
  X,
  Copy,
  Film,
  FileText
} from "lucide-react";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  is_active: boolean;
  images_limit_per_week: number;
  upscales_limit_per_day: number;
  images_this_week: number;
  total_images: number;
  upscales_today: number;
  created_at: string;
  plan_type: string;
  no_auto_delete: boolean;
  can_generate_video?: boolean;
}

interface UserImage {
  id: string;
  url: string;
  model_id: string;
  created_at: string;
  prompt: string;
  enhanced_prompt?: string;
  ratio?: string;
  quality?: string;
  type?: "standard" | "compare" | "storyboard" | "character" | "product";
  video_url?: string;
  is_quarantined?: boolean;
  quarantined_at?: string;
  quarantine_reason?: string;
  quarantined_by?: string;
  upstream_request_id?: string;
  user?: {
    id: string;
    email: string;
    name: string | null;
  };
}

interface GlobalStats {
  total_users: number;
  active_users: number;
  total_images_generated: number;
  images_this_week: number;
}

interface ActiveGen {
  sessionId: string;
  prompt: string;
  model_id: string;
  status: "pending" | "success" | "failed";
  url?: string;
  error_msg?: string;
}

// ── Telemetry interfaces ──────────────────────────────────────────────────────
interface TelemetryDaySummary {
  date: string;
  total_requests: number;
  success_count: number;
  count_429: number;
  rate_429_pct: number;
  p50_latency_ms: number | null;
  p90_latency_ms: number | null;
  p95_latency_ms: number | null;
  peak_concurrency: number;
  source_breakdown?: Record<string, number>;
}

interface TelemetryTotals {
  total_requests: number;
  count_429: number;
  rate_429_pct: number;
  p50_latency_ms: number | null;
  p90_latency_ms: number | null;
  p95_latency_ms: number | null;
}

interface TelemetrySummary {
  days: TelemetryDaySummary[];
  totals: TelemetryTotals;
  live: { active_gemini_calls: number };
}

interface TelemetryIncident {
  id: string;
  timestamp: string;
  timestamp_ist?: string;
  status: string;
  model_used: string | null;
  error_code: string | null;
  concurrency_at_dispatch: number | null;
  burst_velocity_10s: number | null;
  latency_ms: number | null;
  retry_attempt: number;
  pipeline_type: string | null;
  aspect_ratio: string | null;
  is_image_to_image: boolean;
  request_source?: string | null;
}

interface TelemetryHourSlot {
  hour: number;
  total: number;
  count_429: number;
  rate_429_pct: number;
}

interface TelemetryLive {
  active_gemini_calls: number;
  semaphore_limit: number;
  semaphore_available: number;
}

const formatIST = (timestamp: string | Date | null | undefined): string => {
  if (!timestamp) return "—";
  let iso = typeof timestamp === "string" ? timestamp.trim() : timestamp.toISOString();
  if (typeof timestamp === "string" && !iso.endsWith("Z") && !iso.includes("+")) {
    iso = `${iso}Z`;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(timestamp);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
};

const formatDateIST = (timestamp: string | Date | null | undefined): string => {
  if (!timestamp) return "—";
  let iso = typeof timestamp === "string" ? timestamp.trim() : timestamp.toISOString();
  if (typeof timestamp === "string" && !iso.endsWith("Z") && !iso.includes("+")) {
    iso = `${iso}Z`;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(timestamp);
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
  });
};

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"users" | "stats" | "generations" | "generate" | "testing" | "settings">("users");
  
  // Stats Tab State
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Telemetry State
  const [telemetrySummary, setTelemetrySummary] = useState<TelemetrySummary | null>(null);
  const [telemetryIncidents, setTelemetryIncidents] = useState<TelemetryIncident[]>([]);
  const [telemetryHourly, setTelemetryHourly] = useState<TelemetryHourSlot[]>([]);
  const [telemetryLive, setTelemetryLive] = useState<TelemetryLive | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const telemetryLiveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Users Tab State
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Edit Limits Modal
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [newWeeklyLimit, setNewWeeklyLimit] = useState(50);
  const [newDailyUpscaleLimit, setNewDailyUpscaleLimit] = useState(5);
  const [limitsUpdating, setLimitsUpdating] = useState(false);

  // View User Images State
  const [viewingImagesUser, setViewingImagesUser] = useState<AdminUser | null>(null);
  const [userImages, setUserImages] = useState<UserImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);

  // All Generations Tab State
  const [allGenerations, setAllGenerations] = useState<UserImage[]>([]);
  const [generationsLoading, setGenerationsLoading] = useState(false);
  const [generationsSearchQuery, setGenerationsSearchQuery] = useState("");
  const [generationsPage, setGenerationsPage] = useState(1);
  const [totalGenerations, setTotalGenerations] = useState(0);
  const generationsPerPage = 24;
  const [expandedPrompts, setExpandedPrompts] = useState<Record<string, boolean>>({});

  // Date range and type filter states
  const [dateFilterPreset, setDateFilterPreset] = useState<"all" | "today" | "yesterday" | "7days" | "30days" | "single" | "custom">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [generationTypeFilter, setGenerationTypeFilter] = useState<"all" | "standard" | "compare" | "storyboard" | "character" | "product" | "quarantined">("all");

  const normalizeUrl = (url?: string) => {
    if (!url) return "";
    const s = url.trim();
    if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:") || s.startsWith("/")) {
      return s;
    }
    return `/${s}`;
  };

  const getDateRangeForPreset = (preset: string): { start: string; end: string } => {
    const now = new Date();
    const formatDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (preset === "today") {
      const todayStr = formatDate(now);
      return { start: todayStr, end: todayStr };
    }
    if (preset === "yesterday") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yStr = formatDate(y);
      return { start: yStr, end: yStr };
    }
    if (preset === "7days") {
      const past = new Date(now);
      past.setDate(past.getDate() - 7);
      return { start: formatDate(past), end: formatDate(now) };
    }
    if (preset === "30days") {
      const past = new Date(now);
      past.setDate(past.getDate() - 30);
      return { start: formatDate(past), end: formatDate(now) };
    }
    return { start: "", end: "" };
  };

  const togglePrompt = (key: string) => {
    setExpandedPrompts(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const fetchAllGenerations = async (
    page = 1,
    overridePreset?: string,
    overrideStart?: string,
    overrideEnd?: string,
    overrideType?: string,
    overrideSearch?: string
  ) => {
    setGenerationsLoading(true);
    try {
      const offset = (page - 1) * generationsPerPage;
      const preset = overridePreset !== undefined ? overridePreset : dateFilterPreset;
      const type = overrideType !== undefined ? overrideType : generationTypeFilter;
      const search = overrideSearch !== undefined ? overrideSearch : generationsSearchQuery;
      
      let sDate = overrideStart !== undefined ? overrideStart : startDate;
      let eDate = overrideEnd !== undefined ? overrideEnd : endDate;
      
      if (preset !== "custom" && preset !== "single") {
        const calculated = getDateRangeForPreset(preset);
        sDate = calculated.start;
        eDate = calculated.end;
      }

      let url = `/api/admin/generations?limit=${generationsPerPage}&offset=${offset}`;
      if (sDate) url += `&start_date=${encodeURIComponent(sDate)}`;
      if (eDate) url += `&end_date=${encodeURIComponent(eDate)}`;
      if (type && type !== "all") url += `&type=${encodeURIComponent(type)}`;
      if (search && search.trim()) url += `&search=${encodeURIComponent(search.trim())}`;

      const res = await api.get(url);
      setAllGenerations(res.data.generations || []);
      setTotalGenerations(res.data.total || 0);
      setGenerationsPage(page);
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.detail || "Failed to fetch generations");
    } finally {
      setGenerationsLoading(false);
    }
  };

  const refreshGenerations = () => {
    fetchAllGenerations(generationsPage);
  };

  // Quarantine & Legal Packet Handlers
  const [quarantiningId, setQuarantiningId] = useState<string | null>(null);

  const handleQuarantine = async (imgId: string) => {
    const reason = window.prompt("Enter quarantine / DMCA takedown reason:", "DMCA / Copyright Compliance Notice");
    if (reason === null) return;
    setQuarantiningId(imgId);
    try {
      await api.post(`/api/admin/images/${imgId}/quarantine`, { reason: reason.trim() || "DMCA / Copyright Compliance Notice" });
      toast.success("Image quarantined and revoked from public access");
      fetchAllGenerations(generationsPage);
      setUserImages(prev => prev.map(item => item.id === imgId ? { ...item, is_quarantined: true, quarantine_reason: reason.trim() || "DMCA / Copyright Compliance Notice" } : item));
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to quarantine image");
    } finally {
      setQuarantiningId(null);
    }
  };

  const handleRestore = async (imgId: string) => {
    if (!window.confirm("Restore this image to active public status?")) return;
    setQuarantiningId(imgId);
    try {
      await api.post(`/api/admin/images/${imgId}/restore`);
      toast.success("Image restored to active status");
      fetchAllGenerations(generationsPage);
      setUserImages(prev => prev.map(item => item.id === imgId ? { ...item, is_quarantined: false, quarantine_reason: undefined } : item));
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to restore image");
    } finally {
      setQuarantiningId(null);
    }
  };

  const handleExportLegalPacket = async (imgId: string) => {
    try {
      const res = await api.get(`/api/admin/images/${imgId}/legal-packet`);
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(res.data, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `genfy-legal-packet-${imgId}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      toast.success("Legal audit packet downloaded!");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to export legal packet");
    }
  };

  // Generator Tab State
  const [genPrompt, setGenPrompt] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>(["Flux.1"]);
  const [genRatio, setGenRatio] = useState("1:1");
  const [genQuality, setGenQuality] = useState("Standard");
  const [generating, setGenerating] = useState(false);
  const [activeGenerations, setActiveGenerations] = useState<ActiveGen[]>([]);

  // Nanobanana 2 Testing Tab State
  const [prodModel, setProdModel] = useState("gemini-3.1-flash-image");
  const [prodTemp, setProdTemp] = useState(0.4);
  const [betaModel, setBetaModel] = useState("gemini-3.1-flash-image");
  const [betaTemp, setBetaTemp] = useState(0.4);
  const [configLoading, setConfigLoading] = useState(false);
  const [updatingConfig, setUpdatingConfig] = useState(false);
  const [promotingConfig, setPromotingConfig] = useState(false);

  // Settings Tab State
  const [devMode, setDevMode] = useState(false);

  // Load Dev Mode on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("genfy_show_enhanced_prompt");
      if (stored === "true") setDevMode(true);
    } catch (_) {}
  }, []);

  const toggleDevMode = (val: boolean) => {
    setDevMode(val);
    try {
      localStorage.setItem("genfy_show_enhanced_prompt", val ? "true" : "false");
      toast.success(val ? "Developer Mode Enabled" : "Developer Mode Disabled");
    } catch (_) {}
  };

  // Guard: Redirect if not authenticated or not admin
  useEffect(() => {
    if (!authLoading && (!user || user.role !== "admin")) {
      toast.error("Access denied. Administrators only.");
      router.push("/");
    }
  }, [user, authLoading, router]);

  // Load Initial Tab Data
  useEffect(() => {
    if (!user || user.role !== "admin") return;
    if (activeTab === "users") {
      fetchUsers();
    } else if (activeTab === "stats") {
      fetchGlobalStats();
      fetchTelemetry();
    } else if (activeTab === "generations") {
      fetchAllGenerations(1);
    } else if (activeTab === "testing") {
      fetchNanobananaConfig();
    }
    // Start/stop live polling when stats tab is active
    if (activeTab === "stats") {
      if (telemetryLiveRef.current) clearInterval(telemetryLiveRef.current);
      telemetryLiveRef.current = setInterval(async () => {
        try {
          const res = await api.get("/api/admin/telemetry/live");
          setTelemetryLive(res.data);
        } catch (_) {}
      }, 5000);
    } else {
      if (telemetryLiveRef.current) {
        clearInterval(telemetryLiveRef.current);
        telemetryLiveRef.current = null;
      }
    }
    return () => {
      if (telemetryLiveRef.current) {
        clearInterval(telemetryLiveRef.current);
        telemetryLiveRef.current = null;
      }
    };
  }, [activeTab, user]);

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const res = await api.get("/api/admin/users");
      setUsers(res.data.users || []);
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.detail || "Failed to fetch users");
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchGlobalStats = async () => {
    setStatsLoading(true);
    try {
      const res = await api.get("/api/admin/stats");
      setGlobalStats(res.data);
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.detail || "Failed to fetch global stats");
    } finally {
      setStatsLoading(false);
    }
  };

  const fetchTelemetry = async () => {
    setTelemetryLoading(true);
    try {
      const [summaryRes, incidentsRes, hourlyRes, liveRes] = await Promise.all([
        api.get("/api/admin/telemetry/summary"),
        api.get("/api/admin/telemetry/incidents"),
        api.get("/api/admin/telemetry/hourly"),
        api.get("/api/admin/telemetry/live"),
      ]);
      setTelemetrySummary(summaryRes.data);
      setTelemetryIncidents(incidentsRes.data.incidents || []);
      setTelemetryHourly(hourlyRes.data.heatmap || []);
      setTelemetryLive(liveRes.data);
    } catch (err: any) {
      console.error("Telemetry fetch error:", err);
    } finally {
      setTelemetryLoading(false);
    }
  };

  // Toggle User Access Revocation
  const toggleUserAccess = async (targetUser: AdminUser) => {
    const nextActive = !targetUser.is_active;
    try {
      const res = await api.put(`/api/admin/users/${targetUser.id}/access`, {
        is_active: nextActive
      });
      if (res.data.status === "ok") {
        toast.success(`Access ${nextActive ? "restored" : "revoked"} successfully for ${targetUser.email}`);
        setUsers(prev =>
          prev.map(u => (u.id === targetUser.id ? { ...u, is_active: nextActive } : u))
        );
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update user access");
    }
  };

  // Toggle User Auto Delete status (no_auto_delete exemption)
  const toggleUserAutoDelete = async (targetUser: AdminUser) => {
    const nextExempt = !targetUser.no_auto_delete;
    try {
      const res = await api.put(`/api/admin/users/${targetUser.id}/no-delete`, {
        no_auto_delete: nextExempt
      });
      if (res.data.status === "ok") {
        toast.success(`Auto-delete policy updated for ${targetUser.email}`);
        setUsers(prev =>
          prev.map(u => (u.id === targetUser.id ? { ...u, no_auto_delete: nextExempt } : u))
        );
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update auto-delete policy");
    }
  };

  // Toggle User Video Animation Access
  const toggleUserVideoAccess = async (targetUser: AdminUser) => {
    const nextAccess = !targetUser.can_generate_video;
    try {
      const res = await api.put(`/api/admin/users/${targetUser.id}/video-access`, {
        can_generate_video: nextAccess
      });
      if (res.data.status === "ok") {
        toast.success(`Video animation rights ${nextAccess ? "granted to" : "revoked from"} ${targetUser.email}`);
        setUsers(prev =>
          prev.map(u => (u.id === targetUser.id ? { ...u, can_generate_video: nextAccess } : u))
        );
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update video rights");
    }
  };

  // Open Edit Limits Modal
  const openLimitsModal = (u: AdminUser) => {
    setEditingUser(u);
    setNewWeeklyLimit(u.images_limit_per_week);
    setNewDailyUpscaleLimit(u.upscales_limit_per_day);
  };

  // Save User Quota Limits
  const saveLimits = async () => {
    if (!editingUser) return;
    setLimitsUpdating(true);
    try {
      const res = await api.put(`/api/admin/users/${editingUser.id}/limits`, {
        images_limit_per_week: newWeeklyLimit,
        upscales_limit_per_day: newDailyUpscaleLimit
      });
      if (res.data.status === "ok") {
        toast.success(`Limits updated for ${editingUser.email}`);
        setUsers(prev =>
          prev.map(u =>
            u.id === editingUser.id
              ? {
                  ...u,
                  images_limit_per_week: newWeeklyLimit,
                  upscales_limit_per_day: newDailyUpscaleLimit
                }
              : u
          )
        );
        setEditingUser(null);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update user limits");
    } finally {
      setLimitsUpdating(false);
    }
  };

  // Load User Images
  const viewUserImages = async (u: AdminUser) => {
    setViewingImagesUser(u);
    setImagesLoading(true);
    setUserImages([]);
    try {
      const res = await api.get(`/api/admin/users/${u.id}/images?limit=50`);
      setUserImages(res.data.images || []);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to load user images");
    } finally {
      setImagesLoading(false);
    }
  };

  // Admin Image Generation Call
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genPrompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }
    if (selectedModels.length === 0) {
      toast.error("Please select at least one AI model");
      return;
    }

    setGenerating(true);
    try {
      const res = await api.post("/api/sessions", {
        prompt: genPrompt,
        model_ids: selectedModels,
        ratio: genRatio,
        quality: genQuality,
        active_configs: {}
      });
      
      const { session_id, images } = res.data;
      
      // Add pending placeholders to list
      const newGens: ActiveGen[] = images.map((img: any) => ({
        sessionId: session_id,
        prompt: genPrompt,
        model_id: img.model_id,
        status: "pending"
      }));
      
      setActiveGenerations(prev => [...newGens, ...prev]);
      setGenPrompt("");
      
      // Start polling loop for this session
      pollSession(session_id);
      
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Image generation request failed");
    } finally {
      setGenerating(false);
    }
  };

  // Polling loop logic for the admin console
  const pollSession = (sessionId: string) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 40) {
        clearInterval(interval);
        toast.error(`Session ${sessionId} polling timed out.`);
        setActiveGenerations(prev =>
          prev.map(g => (g.sessionId === sessionId && g.status === "pending" ? { ...g, status: "failed", error_msg: "Timed out" } : g))
        );
        return;
      }
      try {
        const res = await api.get(`/api/sessions/${sessionId}`);
        const data = res.data;
        
        // Update statuses
        setActiveGenerations(prev => {
          return prev.map(g => {
            if (g.sessionId === sessionId) {
              const matched = data.images.find((img: any) => img.model_id === g.model_id);
              if (matched) {
                return {
                  ...g,
                  status: matched.status,
                  url: matched.url,
                  error_msg: matched.error_msg
                };
              }
            }
            return g;
          });
        });

        const allDone = data.images.every((img: any) => img.status === "success" || img.status === "failed");
        if (allDone) {
          clearInterval(interval);
          toast.success("AI Generation Completed!");
        }

      } catch (err) {
        console.error("Polling error", err);
      }
    }, 3000);
  };

  const fetchNanobananaConfig = async () => {
    setConfigLoading(true);
    try {
      const res = await api.get("/api/nanobanana/config");
      setProdModel(res.data.production.model);
      setProdTemp(res.data.production.temperature);
      setBetaModel(res.data.beta.model);
      setBetaTemp(res.data.beta.temperature);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to load configuration");
    } finally {
      setConfigLoading(false);
    }
  };

  const handleUpdateBeta = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingConfig(true);
    try {
      const res = await api.post("/api/nanobanana/config", {
        beta: {
          model: betaModel,
          temperature: betaTemp
        }
      });
      toast.success("Beta configuration updated successfully!");
      setBetaModel(res.data.beta.model);
      setBetaTemp(res.data.beta.temperature);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update configuration");
    } finally {
      setUpdatingConfig(false);
    }
  };

  const handlePromote = async () => {
    if (!confirm("Are you sure you want to promote the Beta configuration to Production? This will overwrite the Production model configuration for all users.")) return;
    setPromotingConfig(true);
    try {
      const res = await api.post("/api/nanobanana/promote");
      toast.success("Beta configuration promoted to Production successfully!");
      setProdModel(res.data.production.model);
      setProdTemp(res.data.production.temperature);
      setBetaModel(res.data.beta.model);
      setBetaTemp(res.data.beta.temperature);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to promote configuration");
    } finally {
      setPromotingConfig(false);
    }
  };

  // Helper filters
  const filteredUsers = users.filter(u => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      u.email.toLowerCase().includes(query) ||
      (u.name && u.name.toLowerCase().includes(query)) ||
      u.id.toLowerCase().includes(query)
    );
  });

  const filteredGenerations = allGenerations;

  if (authLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[70vh] text-white bg-[#0a0a0a]">
        <Loader2 className="w-12 h-12 text-[#f95738] animate-spin mb-4" />
        <p className="text-white/60 font-semibold tracking-wide animate-pulse">Authenticating Admin Session...</p>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[80vh] text-center px-6 bg-[#0a0a0a]">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-6">
          <ShieldAlert className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="text-3xl font-black text-white mb-2">Access Denied</h1>
        <p className="text-white/50 max-w-md mb-8">
          This system endpoint is reserved exclusively for registered administrative credentials.
        </p>
        <button
          onClick={() => router.push("/")}
          className="px-6 py-3 rounded-full bg-gradient-to-r from-[#f95738] to-[#e04e2d] text-white font-bold transition-all hover:scale-105"
        >
          Return Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-screen bg-[#070707] text-white p-6 pt-[100px] overflow-y-auto">
      <div className="max-w-[1362px] mx-auto">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <span className="px-3 py-1 rounded-full text-[11px] font-black tracking-widest uppercase bg-gradient-to-r from-[#f95738] to-[#e04e2d] text-white border border-[#f95738]/30">
                SYSTEM CONTROL
              </span>
              <div className="flex items-center gap-1.5 text-xs text-white/50">
                <Lock className="w-3.5 h-3.5 text-[#f95738]" /> Admin Secured
              </div>
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white">
              System Admin Panel
            </h1>
          </div>

          {/* Tab Selection Navigation */}
          <div className="flex p-1 bg-white/5 backdrop-blur-xl border border-white/10 rounded-full w-fit flex-wrap">
            {[
              { id: "users", label: "User Control", icon: Users },
              { id: "stats", label: "Analytics & Stats", icon: TrendingUp },
              { id: "generations", label: "All Generations", icon: ImageIcon },
              { id: "generate", label: "Genfy Generator", icon: Sparkles },
              { id: "testing", label: "Nanobanana 2 Testing", icon: Sliders },
              { id: "settings", label: "Admin Settings", icon: Settings }
            ].map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-semibold transition-all ${
                    active
                      ? "bg-gradient-to-r from-[#f95738] to-[#e04e2d] text-white shadow-lg shadow-[#f95738]/20"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── TAB CONTENT: USERS CONTROL ── */}
        {activeTab === "users" && (
          <div className="space-y-6">
            
            {/* Search & Actions Bar */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl">
              <div className="relative w-full md:max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  placeholder="Search user email, name, or UUID..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-[14px] text-white placeholder-white/30 focus:outline-none focus:border-[#f95738]/50 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <button
                onClick={fetchUsers}
                disabled={usersLoading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white font-medium text-[14px] transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${usersLoading ? "animate-spin" : ""}`} />
                Refresh List
              </button>
            </div>

            {/* Users Database Table */}
            <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50 text-[12px] font-black uppercase tracking-wider bg-white/[0.02]">
                      <th className="p-5 font-semibold">User details</th>
                      <th className="p-5 font-semibold">Weekly limits</th>
                      <th className="p-5 font-semibold">Daily upscale</th>
                      <th className="p-5 font-semibold">Images (Week / Total)</th>
                      <th className="p-5 font-semibold">Video Rights</th>
                      <th className="p-5 font-semibold">3-Day Delete</th>
                      <th className="p-5 font-semibold">Status</th>
                      <th className="p-5 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[14px]">
                    {usersLoading ? (
                      <tr>
                        <td colSpan={8} className="p-10 text-center text-white/50">
                          <Loader2 className="w-8 h-8 text-[#f95738] animate-spin mx-auto mb-2" />
                          Loading users list...
                        </td>
                      </tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-10 text-center text-white/50">
                          No users found matching query.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map(u => {
                        const isRevoked = !u.is_active;
                        const isAdminUser = u.role === "admin";
                        return (
                          <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                            {/* User details */}
                            <td className="p-5">
                              <div className="flex flex-col">
                                <span className="font-bold text-white flex items-center gap-1.5">
                                  {u.name || "Unnamed User"}
                                  {isAdminUser && (
                                    <span className="px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-500 text-[10px] font-black tracking-widest uppercase">
                                      Admin
                                    </span>
                                  )}
                                </span>
                                <span className="text-white/40 text-[12px]">{u.email}</span>
                                <span className="text-[11px] text-white/30 font-mono mt-0.5">{u.id}</span>
                              </div>
                            </td>
                            {/* Weekly limit details */}
                            <td className="p-5 font-semibold text-white/80">
                              <div className="flex items-center gap-2">
                                <span>{u.images_limit_per_week} images</span>
                                {!isAdminUser && (
                                  <button
                                    onClick={() => openLimitsModal(u)}
                                    className="p-1 text-white/40 hover:text-[#f95738] transition-colors"
                                    title="Edit Limit"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                            {/* Daily upscale limit details */}
                            <td className="p-5 font-semibold text-white/80">
                              <span>{u.upscales_limit_per_day} upscales</span>
                            </td>
                            {/* Usage Counters */}
                            <td className="p-5">
                              <div className="flex flex-col">
                                <span className="font-bold text-white">
                                  {u.images_this_week} <span className="text-white/40 font-normal">this week</span>
                                </span>
                                <span className="text-[12px] text-white/50">
                                  {u.total_images} total images
                                </span>
                              </div>
                            </td>
                            {/* Video Rights Toggle */}
                            <td className="p-5">
                              <button
                                onClick={() => toggleUserVideoAccess(u)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all ${
                                  u.can_generate_video
                                    ? "bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20"
                                    : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white"
                                }`}
                                title={u.can_generate_video ? "Video generation enabled. Click to lock." : "Video generation locked. Click to grant."}
                              >
                                <Film className="w-3.5 h-3.5" />
                                {u.can_generate_video ? "Allowed" : "Locked"}
                              </button>
                            </td>
                            {/* 3-Day Delete Exemption */}
                            <td className="p-5">
                              <button
                                onClick={() => toggleUserAutoDelete(u)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all ${
                                  u.no_auto_delete
                                    ? "bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20"
                                    : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
                                }`}
                              >
                                {u.no_auto_delete ? "Keep Images" : "Delete (3 Days)"}
                              </button>
                            </td>
                            {/* Status badge */}
                            <td className="p-5">
                              {isRevoked ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-500/10 border border-red-500/30 text-red-400">
                                  <Ban className="w-3.5 h-3.5" /> Revoked
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-500/10 border border-green-500/30 text-green-400">
                                  <CheckCircle className="w-3.5 h-3.5" /> Active
                                </span>
                              )}
                            </td>
                            {/* Actions Column */}
                            <td className="p-5 text-right">
                              <div className="flex items-center justify-end gap-2.5">
                                <button
                                  onClick={() => viewUserImages(u)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white/80 hover:text-white text-[12px] font-semibold transition-all"
                                >
                                  <Eye className="w-3.5 h-3.5" /> View Images
                                </button>
                                <button
                                  onClick={() => {
                                    localStorage.setItem("impersonate_user_id", u.id);
                                    localStorage.setItem("impersonate_user", JSON.stringify({
                                      id: u.id,
                                      email: u.email,
                                      name: u.name || u.email.split("@")[0]
                                    }));
                                    localStorage.removeItem("activeSbId"); // Clear previous active SB so target user's newest SB loads
                                    toast.success(`Impersonating ${u.name || u.email} in Storyboard`);
                                    router.push("/storyboard");
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/25 hover:bg-purple-500/20 hover:border-purple-500/40 text-purple-300 text-[12px] font-semibold transition-all"
                                  title="Open Storyboard workspace as this user"
                                >
                                  <Film className="w-3.5 h-3.5 text-purple-400" /> Impersonate
                                </button>
                                {!isAdminUser && (
                                  <button
                                    onClick={() => toggleUserAccess(u)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all ${
                                      isRevoked
                                        ? "bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20"
                                        : "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20"
                                    }`}
                                  >
                                    <Power className="w-3.5 h-3.5" />
                                    {isRevoked ? "Unrevoke" : "Revoke"}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB CONTENT: ANALYTICS & STATS ── */}
        {activeTab === "stats" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                {
                  label: "Total Registered Users",
                  value: globalStats?.total_users,
                  desc: "Accounts created ever",
                  icon: Users,
                  color: "from-blue-500 to-indigo-600"
                },
                {
                  label: "Active Accounts",
                  value: globalStats?.active_users,
                  desc: "Unrevoked system access",
                  icon: CheckCircle,
                  color: "from-green-500 to-emerald-600"
                },
                {
                  label: "Total Images Generated",
                  value: globalStats?.total_images_generated,
                  desc: "Database success count",
                  icon: ImageIcon,
                  color: "from-[#f95738] to-[#e04e2d]"
                },
                {
                  label: "Generated This Week",
                  value: globalStats?.images_this_week,
                  desc: "Last 7 days usage",
                  icon: TrendingUp,
                  color: "from-purple-500 to-pink-600"
                }
              ].map((card, idx) => {
                const Icon = card.icon;
                return (
                  <div
                    key={idx}
                    className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl relative overflow-hidden group hover:border-[#f95738]/40 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-white/60 text-sm font-semibold">{card.label}</span>
                      <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-white/80 group-hover:text-[#f95738] transition-colors">
                        <Icon className="w-5 h-5" />
                      </div>
                    </div>
                    {statsLoading ? (
                      <div className="h-10 w-24 bg-white/10 rounded animate-pulse" />
                    ) : (
                      <h2 className="text-3xl font-black tracking-tight text-white mb-1">
                        {card.value !== undefined ? card.value.toLocaleString() : "0"}
                      </h2>
                    )}
                    <p className="text-[12px] text-white/40">{card.desc}</p>
                    <div className="absolute bottom-0 left-0 w-full h-[3px] bg-gradient-to-r opacity-50 group-hover:opacity-100 transition-opacity" style={{ backgroundImage: `linear-gradient(to right, var(--tw-gradient-stops))` }} />
                  </div>
                );
              })}
            </div>
            
            {/* System Info card */}
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl">
              <h3 className="text-lg font-bold mb-4">API Services Diagnostics</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
                <div className="p-4 rounded-xl bg-black/40 border border-white/5">
                  <div className="text-white/40 mb-1">Gemini AI Pipeline</div>
                  <div className="flex items-center gap-2 font-bold text-green-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-ping" /> Operational
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-black/40 border border-white/5">
                  <div className="text-white/40 mb-1">OpenAI API Connection</div>
                  <div className="flex items-center gap-2 font-bold text-green-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-ping" /> Operational
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-black/40 border border-white/5">
                  <div className="text-white/40 mb-1">Flux API Integration</div>
                  <div className="flex items-center gap-2 font-bold text-green-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-ping" /> Operational
                  </div>
                 </div>
              </div>
            </div>

            {/* ── API TELEMETRY STUDY ── */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-black text-white tracking-tight">API Telemetry Study</h2>
                  <p className="text-white/40 text-sm mt-0.5">7-day rolling window · Zero generation overhead · Admin-only</p>
                </div>
                <button
                  onClick={fetchTelemetry}
                  disabled={telemetryLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white font-medium text-sm transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${telemetryLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              {/* Live Concurrency Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  {
                    label: "Active Gemini Calls",
                    value: telemetryLive?.active_gemini_calls ?? "—",
                    sub: "Right now (live)",
                    color: "text-[#f95738]",
                    bg: "from-[#f95738]/10 to-[#e04e2d]/5"
                  },
                  {
                    label: "Semaphore Slots Free",
                    value: telemetryLive != null ? `${telemetryLive.semaphore_available}/${telemetryLive.semaphore_limit}` : "—",
                    sub: "Concurrency limit",
                    color: "text-green-400",
                    bg: "from-green-500/10 to-emerald-500/5"
                  },
                  {
                    label: "7-Day Total Requests",
                    value: telemetrySummary?.totals.total_requests?.toLocaleString() ?? (telemetryLoading ? "…" : "0"),
                    sub: "Gemini API calls",
                    color: "text-blue-400",
                    bg: "from-blue-500/10 to-indigo-500/5"
                  },
                  {
                    label: "7-Day 429 Rate",
                    value: telemetrySummary ? `${telemetrySummary.totals.rate_429_pct}%` : (telemetryLoading ? "…" : "0%"),
                    sub: `${telemetrySummary?.totals.count_429 ?? 0} incidents`,
                    color: telemetrySummary && telemetrySummary.totals.rate_429_pct > 5 ? "text-red-400" : "text-yellow-400",
                    bg: "from-yellow-500/10 to-orange-500/5"
                  }
                ].map((card, i) => (
                  <div key={i} className={`p-5 rounded-2xl bg-gradient-to-br ${card.bg} border border-white/10 backdrop-blur-xl`}>
                    <p className="text-white/50 text-xs font-semibold mb-2">{card.label}</p>
                    <p className={`text-2xl font-black ${card.color}`}>{card.value}</p>
                    <p className="text-white/30 text-xs mt-1">{card.sub}</p>
                  </div>
                ))}
              </div>

              {/* 7-Day Daily Summary Table */}
              <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl overflow-hidden">
                <div className="p-5 border-b border-white/10 flex items-center justify-between">
                  <h3 className="font-bold text-white">Daily Breakdown (7 Days)</h3>
                  {telemetryLoading && <Loader2 className="w-4 h-4 text-[#f95738] animate-spin" />}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-white/40 text-[11px] font-black uppercase tracking-wider bg-white/[0.02]">
                        <th className="p-4">Date</th>
                        <th className="p-4">Requests</th>
                        <th className="p-4">Successes</th>
                        <th className="p-4">429s</th>
                        <th className="p-4">429 Rate</th>
                        <th className="p-4">p50 Latency</th>
                        <th className="p-4">p90 Latency</th>
                        <th className="p-4">p95 Latency</th>
                        <th className="p-4">Peak Concurrency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {telemetrySummary && telemetrySummary.days.length > 0 ? (
                        telemetrySummary.days.map((day) => (
                          <tr key={day.date} className="hover:bg-white/[0.02] transition-colors">
                            <td className="p-4">
                              <div className="font-mono text-white/80 font-semibold">{day.date}</div>
                              {day.source_breakdown && Object.keys(day.source_breakdown).length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {Object.entries(day.source_breakdown).map(([src, count]) => (
                                    <span key={src} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/60 border border-white/5">
                                      {src}: {count}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="p-4 text-white">{day.total_requests}</td>
                            <td className="p-4 text-green-400">{day.success_count}</td>
                            <td className="p-4 text-red-400">{day.count_429}</td>
                            <td className="p-4">
                              <span className={`font-bold ${day.rate_429_pct > 10 ? "text-red-400" : day.rate_429_pct > 3 ? "text-yellow-400" : "text-green-400"}`}>
                                {day.rate_429_pct}%
                              </span>
                            </td>
                            <td className="p-4 text-white/70">{day.p50_latency_ms != null ? `${(day.p50_latency_ms / 1000).toFixed(1)}s` : "—"}</td>
                            <td className="p-4 text-white/70">{day.p90_latency_ms != null ? `${(day.p90_latency_ms / 1000).toFixed(1)}s` : "—"}</td>
                            <td className="p-4 text-white/70">{day.p95_latency_ms != null ? `${(day.p95_latency_ms / 1000).toFixed(1)}s` : "—"}</td>
                            <td className="p-4">
                              <span className={`font-bold ${day.peak_concurrency >= 2 ? "text-orange-400" : "text-white/70"}`}>
                                {day.peak_concurrency}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={9} className="p-8 text-center text-white/40">
                            {telemetryLoading ? "Loading telemetry data…" : "No data yet — telemetry starts recording from the next Gemini API call."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {telemetrySummary && telemetrySummary.days.length > 0 && (
                      <tfoot>
                        <tr className="border-t border-white/10 bg-white/[0.02] text-white/60 font-bold text-[11px]">
                          <td className="p-4 text-white/40 uppercase tracking-wider">7-Day Total</td>
                          <td className="p-4">{telemetrySummary.totals.total_requests}</td>
                          <td className="p-4 text-green-400">{telemetrySummary.totals.total_requests - telemetrySummary.totals.count_429}</td>
                          <td className="p-4 text-red-400">{telemetrySummary.totals.count_429}</td>
                          <td className="p-4">
                            <span className={`${telemetrySummary.totals.rate_429_pct > 5 ? "text-red-400" : "text-yellow-400"}`}>
                              {telemetrySummary.totals.rate_429_pct}%
                            </span>
                          </td>
                          <td className="p-4">{telemetrySummary.totals.p50_latency_ms != null ? `${(telemetrySummary.totals.p50_latency_ms / 1000).toFixed(1)}s` : "—"}</td>
                          <td className="p-4">{telemetrySummary.totals.p90_latency_ms != null ? `${(telemetrySummary.totals.p90_latency_ms / 1000).toFixed(1)}s` : "—"}</td>
                          <td className="p-4">{telemetrySummary.totals.p95_latency_ms != null ? `${(telemetrySummary.totals.p95_latency_ms / 1000).toFixed(1)}s` : "—"}</td>
                          <td className="p-4">—</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Hourly Heatmap */}
              {telemetryHourly.length > 0 && (
                <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl p-5">
                  <h3 className="font-bold text-white mb-4">Hourly Activity Heatmap <span className="text-white/40 font-normal text-sm">(IST, last 7 days combined)</span></h3>
                  <div className="grid grid-cols-12 gap-1.5">
                    {telemetryHourly.map((slot) => {
                      const intensity = slot.total > 0 ? Math.min(slot.total / Math.max(...telemetryHourly.map(s => s.total), 1), 1) : 0;
                      const has429 = slot.count_429 > 0;
                      return (
                        <div
                          key={slot.hour}
                          title={`${slot.hour}:00 IST — ${slot.total} req, ${slot.count_429} 429s (${slot.rate_429_pct}%)`}
                          className="relative group"
                        >
                          <div
                            className="h-12 rounded-lg flex flex-col items-center justify-center text-[10px] font-bold cursor-default transition-all"
                            style={{
                              backgroundColor: has429
                                ? `rgba(239,68,68,${0.2 + intensity * 0.6})`
                                : `rgba(249,87,56,${0.1 + intensity * 0.7})`,
                              border: has429 ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(255,255,255,0.05)"
                            }}
                          >
                            <span className="text-white/60">{slot.hour}h</span>
                            {slot.total > 0 && <span className="text-white/90">{slot.total}</span>}
                          </div>
                          {/* Tooltip */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded bg-black border border-white/10 text-[10px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity">
                            {slot.hour}:00 IST · {slot.total} req · {slot.count_429} 429s
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-xs text-white/40">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#f95738]/40" /> Normal load</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500/50" /> 429s occurred</span>
                  </div>
                </div>
              )}

              {/* 429 Incidents Log */}
              <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl overflow-hidden">
                <div className="p-5 border-b border-white/10">
                  <h3 className="font-bold text-white">Recent 429 &amp; Error Incidents <span className="text-white/40 font-normal text-sm">(last 7 days, newest first)</span></h3>
                </div>
                {telemetryIncidents.length === 0 ? (
                  <div className="p-8 text-center text-white/40">
                    {telemetryLoading ? "Loading…" : "🎉 No incidents in the past 7 days"}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-white/40 text-[11px] font-black uppercase tracking-wider bg-white/[0.02]">
                          <th className="p-4">Timestamp (IST)</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Source</th>
                          <th className="p-4">Model</th>
                          <th className="p-4">Concurrency</th>
                          <th className="p-4">Burst (10s)</th>
                          <th className="p-4">Latency</th>
                          <th className="p-4">Retry #</th>
                          <th className="p-4">Pipeline</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {telemetryIncidents.map((inc) => (
                          <tr key={inc.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="p-4 font-mono text-white/60 text-xs">{inc.timestamp_ist || formatIST(inc.timestamp)}</td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                inc.status === "429" ? "bg-red-500/20 text-red-400 border border-red-500/30" :
                                inc.status === "503" ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" :
                                "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                              }`}>{inc.status}</span>
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                                (inc.request_source || "").toUpperCase() === "STORYBOARD" ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" :
                                (inc.request_source || "").toUpperCase() === "COMPARE" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" :
                                (inc.request_source || "").toUpperCase() === "EDIT" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                                (inc.request_source || "").toUpperCase() === "UPSCALE" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" :
                                "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                              }`}>
                                {inc.request_source || "STUDIO"}
                              </span>
                            </td>
                            <td className="p-4 text-white/60 text-xs font-mono">{inc.model_used ?? "—"}</td>
                            <td className="p-4">
                              <span className={`font-bold ${(inc.concurrency_at_dispatch ?? 0) >= 2 ? "text-orange-400" : "text-white/70"}`}>
                                {inc.concurrency_at_dispatch ?? "—"}
                              </span>
                            </td>
                            <td className="p-4 text-white/70">{inc.burst_velocity_10s ?? "—"}</td>
                            <td className="p-4 text-white/70">{inc.latency_ms != null ? `${(inc.latency_ms / 1000).toFixed(1)}s` : "—"}</td>
                            <td className="p-4">
                              {inc.retry_attempt > 0 ? (
                                <span className="text-yellow-400 font-bold">#{inc.retry_attempt}</span>
                              ) : (
                                <span className="text-white/30">—</span>
                              )}
                            </td>
                            <td className="p-4 text-white/50 text-xs">{inc.pipeline_type ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB CONTENT: ALL GENERATIONS FEED ── */}
        {activeTab === "generations" && (
          <div className="space-y-6">
            {/* Filter & Controls Panel */}
            <div className="p-5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl space-y-4">
              {/* Row 1: Search, Type Filter, Refresh */}
              <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-lg flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                    <input
                      type="text"
                      placeholder="Filter by prompt, user email, model..."
                      value={generationsSearchQuery}
                      onChange={e => {
                        setGenerationsSearchQuery(e.target.value);
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          fetchAllGenerations(1);
                        }
                      }}
                      className="w-full pl-10 pr-10 py-2.5 bg-black/40 border border-white/10 rounded-xl text-[14px] text-white placeholder-white/30 focus:outline-none focus:border-[#f95738]/50 transition-colors"
                    />
                    {generationsSearchQuery && (
                      <button
                        onClick={() => {
                          setGenerationsSearchQuery("");
                          fetchAllGenerations(1, undefined, undefined, undefined, undefined, "");
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                        title="Clear search"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => fetchAllGenerations(1)}
                    className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white font-semibold text-xs tracking-wide transition-all shrink-0"
                  >
                    Search
                  </button>
                </div>

                {/* Type Filter Buttons */}
                <div className="flex items-center gap-1.5 p-1 bg-black/40 border border-white/10 rounded-xl overflow-x-auto">
                  {(["all", "standard", "compare", "storyboard", "character", "product", "quarantined"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => {
                        setGenerationTypeFilter(t);
                        fetchAllGenerations(1, undefined, undefined, undefined, t);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all whitespace-nowrap ${
                        generationTypeFilter === t
                          ? t === "quarantined"
                            ? "bg-red-500 text-white shadow-lg shadow-red-500/20"
                            : "bg-[#f95738] text-white shadow-lg shadow-[#f95738]/20"
                          : t === "quarantined"
                            ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      {t === "all" ? "All Types" : t === "character" ? "Characters" : t === "product" ? "Products" : t === "storyboard" ? "Storyboard" : t === "quarantined" ? "Quarantined" : t}
                    </button>
                  ))}
                </div>

                <button
                  onClick={refreshGenerations}
                  disabled={generationsLoading}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white font-medium text-[14px] transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${generationsLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              {/* Row 2: Date Filters & Presets */}
              <div className="pt-3 border-t border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-wider flex items-center gap-1.5 mr-1">
                    <Calendar className="w-3.5 h-3.5 text-[#f95738]" /> Filter Date:
                  </span>
                  {[
                    { id: "all", label: "All Time" },
                    { id: "today", label: "Today" },
                    { id: "yesterday", label: "Yesterday" },
                    { id: "7days", label: "Last 7 Days" },
                    { id: "30days", label: "Last 30 Days" },
                    { id: "single", label: "Specific Day" },
                    { id: "custom", label: "Custom Range" },
                  ].map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        const newPreset = p.id as any;
                        setDateFilterPreset(newPreset);
                        if (newPreset !== "custom" && newPreset !== "single") {
                          fetchAllGenerations(1, newPreset);
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        dateFilterPreset === p.id
                          ? "bg-white/20 text-white border border-white/30 font-bold shadow-md shadow-white/5"
                          : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10 border border-white/5"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Status Indicator / Clear Pill */}
                <div className="text-xs text-white/50 flex items-center gap-2">
                  <span>Total Found: <strong className="text-white">{totalGenerations}</strong></span>
                  {(dateFilterPreset !== "all" || generationTypeFilter !== "all" || generationsSearchQuery) && (
                    <button
                      onClick={() => {
                        setDateFilterPreset("all");
                        setStartDate("");
                        setEndDate("");
                        setGenerationTypeFilter("all");
                        setGenerationsSearchQuery("");
                        fetchAllGenerations(1, "all", "", "", "all", "");
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#f95738]/20 text-[#f95738] hover:bg-[#f95738]/30 transition-colors font-bold text-[11px]"
                    >
                      Reset All Filters
                    </button>
                  )}
                </div>
              </div>

              {/* Row 3A: Single Specific Day Picker */}
              {dateFilterPreset === "single" && (
                <div className="pt-3 border-t border-white/5 flex flex-wrap items-center gap-3 bg-black/20 p-3 rounded-xl">
                  <span className="text-xs text-white/70 font-semibold">Select Day:</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => {
                      const dayVal = e.target.value;
                      setStartDate(dayVal);
                      setEndDate(dayVal);
                      if (dayVal) {
                        fetchAllGenerations(1, "single", dayVal, dayVal);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-black/60 border border-white/20 text-white text-xs focus:outline-none focus:border-[#f95738]"
                  />
                  {startDate && (
                    <span className="text-xs text-[#f95738] font-medium">
                      Showing generations for {startDate}
                    </span>
                  )}
                </div>
              )}

              {/* Row 3B: Custom Date Range Pickers */}
              {dateFilterPreset === "custom" && (
                <div className="pt-3 border-t border-white/5 flex flex-wrap items-center gap-3 bg-black/20 p-3 rounded-xl">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-white/60 font-medium">From:</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="px-3 py-1.5 rounded-lg bg-black/60 border border-white/15 text-white text-xs focus:outline-none focus:border-[#f95738]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-white/60 font-medium">To:</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="px-3 py-1.5 rounded-lg bg-black/60 border border-white/15 text-white text-xs focus:outline-none focus:border-[#f95738]"
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (!startDate && !endDate) {
                        toast.error("Please pick at least a start date or end date");
                        return;
                      }
                      fetchAllGenerations(1, "custom", startDate, endDate);
                    }}
                    className="px-4 py-1.5 rounded-lg bg-[#f95738] hover:bg-[#f95738]/90 text-white text-xs font-bold transition-colors shadow-lg shadow-[#f95738]/20"
                  >
                    Apply Range
                  </button>
                </div>
              )}
            </div>

            {/* Generations Grid */}
            {generationsLoading ? (
              <div className="h-[400px] flex flex-col items-center justify-center text-white/40">
                <Loader2 className="w-12 h-12 text-[#f95738] animate-spin mb-4" />
                <p className="text-white/60 font-semibold tracking-wide animate-pulse">Loading system generations...</p>
              </div>
            ) : filteredGenerations.length === 0 ? (
              <div className="h-[400px] border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center text-white/30 text-sm">
                <ImageIcon className="w-12 h-12 mb-3 text-white/10" />
                No generations found.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredGenerations.map(img => (
                  <div
                    key={img.id}
                    className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden flex flex-col relative group"
                  >
                    {/* User Header */}
                    <div className="p-3 bg-black/40 border-b border-white/5 flex items-center justify-between">
                      <div className="flex flex-col min-w-0">
                        <span className="text-white font-semibold text-xs truncate">
                          {img.user?.name || "Unnamed User"}
                        </span>
                        <span className="text-white/40 text-[10px] truncate">
                          {img.user?.email}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {img.is_quarantined && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-red-500/20 border border-red-500/40 text-red-400 flex items-center gap-1">
                            <ShieldAlert className="w-2.5 h-2.5" /> QUARANTINED
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                          img.type === "storyboard" 
                            ? "bg-purple-500/10 border border-purple-500/20 text-purple-400" 
                            : img.type === "character"
                              ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                              : img.type === "product"
                                ? "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                                : img.type === "compare" 
                                  ? "bg-blue-500/10 border border-blue-500/20 text-blue-400" 
                                  : "bg-[#f95738]/10 border border-[#f95738]/20 text-[#f95738]"
                        }`}>
                          {img.type || "standard"}
                        </span>
                      </div>
                    </div>

                    {/* Image Box */}
                    <div className="aspect-square w-full relative bg-black/40 flex items-center justify-center">
                      <img
                        src={normalizeUrl(img.url)}
                        alt={img.prompt || "Generated output"}
                        className={`w-full h-full object-cover ${img.is_quarantined ? 'opacity-40 grayscale blur-[2px]' : ''}`}
                      />
                      {img.is_quarantined && (
                        <div className="absolute inset-0 bg-red-950/70 flex flex-col items-center justify-center p-4 text-center z-10">
                          <ShieldAlert className="w-8 h-8 text-red-400 mb-1 animate-pulse" />
                          <span className="text-xs font-black text-red-300 tracking-wider">LEGAL QUARANTINE</span>
                          <span className="text-[10px] text-red-200/80 mt-1 line-clamp-2">{img.quarantine_reason || "DMCA Takedown Notice"}</span>
                        </div>
                      )}
                      {img.video_url && (
                        <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur border border-purple-500/40 text-[9px] font-black text-purple-300 flex items-center gap-1 z-10 pointer-events-none">
                          <Film className="w-3 h-3 text-purple-400" />
                          <span>VIDEO</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-20">
                        <a
                          href={normalizeUrl(img.url)}
                          download={`genfy-system-${img.model_id}.jpg`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-3 rounded-full bg-white text-black hover:scale-115 transition-transform flex items-center justify-center shadow-2xl"
                          title="Download Image"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    </div>

                    {/* Details Box */}
                    <div className="p-4 space-y-2 bg-black/30 border-t border-white/5 text-[12px] flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between text-white/50 mb-2">
                          <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 font-bold uppercase text-[9px]">
                            {img.model_id || "Unknown Model"}
                          </span>
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <Calendar className="w-3.5 h-3.5" />
                            {img.created_at ? formatDateIST(img.created_at) : "Unknown Date"}
                          </div>
                        </div>

                        {/* Prompts Section */}
                        <div className="space-y-2 pt-2 border-t border-white/5">
                          {img.prompt && (
                            <div className="relative group/prompt">
                              <div className="flex items-center justify-between text-[11px] text-white/40 mb-0.5">
                                <span className="font-bold">Original Prompt:</span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(img.prompt);
                                    toast.success("Original prompt copied!");
                                  }}
                                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-white/50 hover:text-white opacity-0 group-hover/prompt:opacity-100 transition-opacity"
                                  title="Copy Original Prompt"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              <p className={`text-white/85 ${expandedPrompts[img.id + '-orig'] ? '' : 'line-clamp-2'} leading-relaxed`} title={img.prompt}>
                                {img.prompt}
                              </p>
                              {img.prompt.length > 60 && (
                                <button
                                  onClick={() => togglePrompt(img.id + '-orig')}
                                  className="text-[10px] text-[#f95738]/80 hover:text-[#f95738] font-bold mt-0.5"
                                >
                                  {expandedPrompts[img.id + '-orig'] ? "Show Less" : "Show More"}
                                </button>
                              )}
                            </div>
                          )}

                          {img.enhanced_prompt && (
                            <div className="relative group/prompt mt-2 pt-2 border-t border-dashed border-white/5">
                              <div className="flex items-center justify-between text-[11px] text-[#f95738]/50 mb-0.5">
                                <span className="font-bold text-[#f95738]/70">AI Enhanced Prompt:</span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(img.enhanced_prompt || "");
                                    toast.success("Enhanced prompt copied!");
                                  }}
                                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-white/50 hover:text-white opacity-0 group-hover/prompt:opacity-100 transition-opacity"
                                  title="Copy Enhanced Prompt"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              <p className={`text-white/60 ${expandedPrompts[img.id + '-enh'] ? '' : 'line-clamp-2'} leading-relaxed`} title={img.enhanced_prompt}>
                                {img.enhanced_prompt}
                              </p>
                              {img.enhanced_prompt.length > 60 && (
                                <button
                                  onClick={() => togglePrompt(img.id + '-enh')}
                                  className="text-[10px] text-[#f95738]/80 hover:text-[#f95738] font-bold mt-0.5"
                                >
                                  {expandedPrompts[img.id + '-enh'] ? "Show Less" : "Show More"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-2 mt-2 border-t border-white/5">
                        <div className="flex items-center justify-between text-[10px] text-white/40 uppercase font-black">
                          <div className="flex items-center gap-2">
                            {img.ratio && <span>Ratio: {img.ratio}</span>}
                            {img.quality && <span>Quality: {img.quality}</span>}
                          </div>
                          {img.upstream_request_id && (
                            <span className="text-[9px] text-white/30 truncate max-w-[120px]" title={img.upstream_request_id}>
                              ID: {img.upstream_request_id.slice(-8)}
                            </span>
                          )}
                        </div>

                        {/* Legal & DMCA Action Buttons */}
                        <div className="flex items-center justify-between gap-1.5 pt-1">
                          <button
                            onClick={() => handleExportLegalPacket(img.id)}
                            className="px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[10px] font-bold flex items-center gap-1 transition-colors"
                            title="Download complete forensic legal bundle for Google / OpenAI / Anthropic indemnity claim"
                          >
                            <FileText className="w-3 h-3" />
                            Legal Packet
                          </button>

                          {img.is_quarantined ? (
                            <button
                              onClick={() => handleRestore(img.id)}
                              disabled={quarantiningId === img.id}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
                              title="Restore image to active status"
                            >
                              <CheckCircle className="w-3 h-3" />
                              Restore
                            </button>
                          ) : (
                            <button
                              onClick={() => handleQuarantine(img.id)}
                              disabled={quarantiningId === img.id}
                              className="px-2.5 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
                              title="Quarantine image immediately under DMCA Safe Harbor"
                            >
                              <ShieldAlert className="w-3 h-3" />
                              Quarantine
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination Controls */}
            {!generationsLoading && totalGenerations > generationsPerPage && (
              <div className="flex items-center justify-center gap-4 pt-6">
                <button
                  disabled={generationsPage === 1}
                  onClick={() => fetchAllGenerations(generationsPage - 1)}
                  className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:pointer-events-none text-sm font-semibold"
                >
                  Previous
                </button>
                <span className="text-white/60 text-sm">
                  Page {generationsPage} of {Math.ceil(totalGenerations / generationsPerPage)}
                </span>
                <button
                  disabled={generationsPage >= Math.ceil(totalGenerations / generationsPerPage)}
                  onClick={() => fetchAllGenerations(generationsPage + 1)}
                  className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:pointer-events-none text-sm font-semibold"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── TAB CONTENT: GENFY GENERATOR ── */}
        {activeTab === "generate" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Options & Generation Control Panel */}
            <div className="lg:col-span-1 p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl h-fit">
              <div className="flex items-center gap-2 mb-6">
                <Sparkles className="w-5 h-5 text-[#f95738]" />
                <h3 className="text-lg font-black">Developer Console</h3>
              </div>

              <form onSubmit={handleGenerate} className="space-y-6">
                <div>
                  <label className="block text-white/50 text-[12px] font-black uppercase tracking-wider mb-2">
                    Enter Prompt
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Describe the image you want to generate in detail..."
                    value={genPrompt}
                    onChange={e => setGenPrompt(e.target.value)}
                    className="w-full p-4 bg-black/40 border border-white/10 rounded-xl text-[14px] text-white placeholder-white/30 focus:outline-none focus:border-[#f95738]/50 transition-colors resize-none"
                  />
                </div>

                <div>
                  <label className="block text-white/50 text-[12px] font-black uppercase tracking-wider mb-2.5">
                    Select Target Models
                  </label>
                  <div className="space-y-2">
                    {["Nanobanana Pro", "Nanobanana 2", "ChatGPT", "Flux.1", "OpenAI", "Kling"].map(model => {
                      const isChecked = selectedModels.includes(model);
                      return (
                        <label
                          key={model}
                          className={`flex items-center justify-between p-3 rounded-xl border text-[13px] font-semibold cursor-pointer transition-all ${
                            isChecked
                              ? "bg-white/5 border-[#f95738]/50 text-white"
                              : "border-white/5 text-white/40 hover:text-white hover:bg-white/[0.02]"
                          }`}
                        >
                          <span>{model}</span>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setSelectedModels(prev =>
                                isChecked ? prev.filter(m => m !== model) : [...prev, model]
                              );
                            }}
                            className="w-4 h-4 accent-[#f95738] rounded cursor-pointer"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-white/50 text-[12px] font-black uppercase tracking-wider mb-2">
                      Aspect Ratio
                    </label>
                    <select
                      value={genRatio}
                      onChange={e => setGenRatio(e.target.value)}
                      className="w-full px-4 py-2.5 bg-black border border-white/10 rounded-xl text-[13px] text-white focus:outline-none focus:border-[#f95738]/50"
                    >
                      <option value="1:1">1:1 Square</option>
                      <option value="16:9">16:9 Cinema</option>
                      <option value="9:16">9:16 Portrait</option>
                      <option value="4:3">4:3 Standard</option>
                      <option value="3:2">3:2 Classic</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-white/50 text-[12px] font-black uppercase tracking-wider mb-2">
                      Quality Mode
                    </label>
                    <select
                      value={genQuality}
                      onChange={e => setGenQuality(e.target.value)}
                      className="w-full px-4 py-2.5 bg-black border border-white/10 rounded-xl text-[13px] text-white focus:outline-none focus:border-[#f95738]/50"
                    >
                      <option value="Standard">Standard (Fast)</option>
                      <option value="High">High Quality</option>
                      <option value="Ultra">Ultra Details</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={generating || !genPrompt.trim() || selectedModels.length === 0}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-[#f95738] to-[#e04e2d] hover:brightness-110 text-white font-bold text-[15px] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#f95738]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" /> Starting...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" /> Generate Images
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Generated results grid */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-black">Generation Output History</h3>
                {activeGenerations.length > 0 && (
                  <button
                    onClick={() => setActiveGenerations([])}
                    className="text-white/40 hover:text-white text-xs font-semibold"
                  >
                    Clear History
                  </button>
                )}
              </div>

              {activeGenerations.length === 0 ? (
                <div className="h-[400px] border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center text-white/30 text-sm">
                  <ImageIcon className="w-12 h-12 mb-3 text-white/10" />
                  Your generated admin outputs will appear here in real-time.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {activeGenerations.map((g, idx) => (
                    <div
                      key={idx}
                      className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden flex flex-col relative group"
                    >
                      {/* Image Preview Container */}
                      <div className="aspect-square w-full relative bg-black/40 flex items-center justify-center">
                        {g.status === "pending" ? (
                          <div className="flex flex-col items-center gap-2 text-white/50">
                            <Loader2 className="w-8 h-8 text-[#f95738] animate-spin" />
                            <span className="text-xs font-medium uppercase tracking-wider">Generating ({g.model_id})...</span>
                          </div>
                        ) : g.status === "failed" ? (
                          <div className="p-4 text-center text-red-400">
                            <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-60" />
                            <span className="text-xs font-semibold">Generation Failed</span>
                            <p className="text-[11px] opacity-75 mt-1">{g.error_msg || "Server timeout"}</p>
                          </div>
                        ) : g.url ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={g.url}
                              alt={g.prompt}
                              className="w-full h-full object-cover"
                            />
                            {/* Download Action Overlay */}
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <a
                                href={g.url}
                                download={`genfy-admin-${g.model_id}.jpg`}
                                target="_blank"
                                rel="noreferrer"
                                className="p-3.5 rounded-full bg-white text-black hover:scale-110 transition-transform flex items-center justify-center shadow-2xl"
                                title="Download Full Resolution"
                              >
                                <Download className="w-5 h-5" />
                              </a>
                            </div>
                          </>
                        ) : (
                          <div className="text-white/30 text-xs">No media URL generated</div>
                        )}
                      </div>

                      {/* Details overlay metadata footer */}
                      <div className="p-4 bg-black/30 border-t border-white/5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="px-2 py-0.5 rounded bg-[#f95738]/10 text-[#f95738] text-[10px] font-black uppercase tracking-wider">
                            {g.model_id}
                          </span>
                          <span className="text-[11px] text-white/40 uppercase tracking-widest font-bold">
                            {g.status}
                          </span>
                        </div>
                        <p className="text-[12px] text-white/70 line-clamp-2" title={g.prompt}>
                          {g.prompt}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "testing" && (
          <div className="space-y-8 animate-fade-in">
            {configLoading ? (
              <div className="h-[300px] rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-[#f95738] animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                
                {/* PRODUCTION CONFIG */}
                <div className="p-8 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl relative overflow-hidden flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 rounded-lg bg-green-500/10 text-green-500 border border-green-500/20">
                        <CheckCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-black">Production Configuration</h3>
                        <p className="text-white/40 text-[12px]">Currently active version for all standard generations</p>
                      </div>
                    </div>

                    <div className="space-y-6 bg-black/40 p-6 rounded-xl border border-white/5">
                      <div>
                        <span className="block text-white/40 text-[11px] font-black uppercase tracking-wider mb-1">Model Name</span>
                        <code className="text-white text-[15px] font-mono bg-white/5 px-2.5 py-1 rounded border border-white/10 block w-fit">
                          {prodModel}
                        </code>
                      </div>

                      <div>
                        <span className="block text-white/40 text-[11px] font-black uppercase tracking-wider mb-1">Generation Temperature</span>
                        <div className="flex items-center gap-3">
                          <code className="text-white font-mono bg-white/5 px-2 py-0.5 rounded border border-white/10 text-xs">
                            {prodTemp.toFixed(1)}
                          </code>
                          <span className="text-xs text-white/50">
                            {prodTemp <= 0.3 ? "Precise & Conservative" : prodTemp >= 0.7 ? "Creative & Exploratory" : "Balanced Default"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 p-4 rounded-xl bg-green-500/5 border border-green-500/10 text-[13px] text-green-400/90 leading-relaxed">
                    This model configuration serves all user storyboards, character creations, and general Nanobanana 2 image requests.
                  </div>
                </div>

                {/* BETA CONFIG */}
                <div className="p-8 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl relative overflow-hidden">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-lg bg-[#f95738]/10 text-[#f95738] border border-[#f95738]/20">
                      <Sliders className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black">Beta / Sandbox Configuration</h3>
                      <p className="text-white/40 text-[12px]">Compare generations in the studio alongside Production</p>
                    </div>
                  </div>

                  <form onSubmit={handleUpdateBeta} className="space-y-6 bg-black/40 p-6 rounded-xl border border-white/5">
                    <div>
                      <label className="block text-white/50 text-[11px] font-black uppercase tracking-wider mb-2">
                        Beta Model Identifier
                      </label>
                      <input
                        type="text"
                        value={betaModel}
                        onChange={e => setBetaModel(e.target.value)}
                        placeholder="e.g. gemini-3.1-flash-image"
                        className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-[14px] font-mono text-white focus:outline-none focus:border-[#f95738]/50 transition-colors"
                        required
                      />
                      <span className="block text-white/30 text-[10px] mt-1.5 leading-normal">
                        Suggestions: <code className="cursor-pointer text-white/50 hover:text-white" onClick={() => setBetaModel("gemini-3.1-flash-image")}>gemini-3.1-flash-image</code>, <code className="cursor-pointer text-white/50 hover:text-white" onClick={() => setBetaModel("gemini-3.5-flash-image")}>gemini-3.5-flash-image</code>
                      </span>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-white/50 text-[11px] font-black uppercase tracking-wider">
                          Beta Generation Temperature
                        </label>
                        <span className="text-[13px] font-mono text-[#f95738] font-bold">
                          {betaTemp.toFixed(1)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.1"
                        value={betaTemp}
                        onChange={e => setBetaTemp(parseFloat(e.target.value))}
                        className="w-full accent-[#f95738] cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-white/30 mt-1">
                        <span>Precise (0.0)</span>
                        <span>Balanced (0.5)</span>
                        <span>Creative (1.0)</span>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={updatingConfig}
                      className="w-full py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white text-white/80 font-bold text-[14px] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {updatingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Save Beta Configuration
                    </button>
                  </form>
                </div>

                {/* PROMOTION ACTION CARD */}
                <div className="lg:col-span-2 p-8 rounded-2xl bg-gradient-to-r from-[#f95738]/10 to-[#e04e2d]/5 border border-[#f95738]/20 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-2 max-w-2xl">
                    <h3 className="text-xl font-black flex items-center gap-2 text-white">
                      <Sparkles className="w-5 h-5 text-[#f95738]" /> Promote Beta to Production
                    </h3>
                    <p className="text-white/60 text-[13.5px] leading-relaxed">
                      If you are satisfied with the Beta model's generation quality compared to Production, click promote. This action will deploy the current Beta settings (Model: <span className="font-mono text-white">{betaModel}</span>, Temp: <span className="text-white">{betaTemp}</span>) to the Production environment, replacing it instantly for all user requests.
                    </p>
                  </div>

                  <button
                    onClick={handlePromote}
                    type="button"
                    disabled={promotingConfig || configLoading}
                    className="flex-shrink-0 px-8 py-4 rounded-xl bg-gradient-to-r from-[#f95738] to-[#e04e2d] hover:brightness-110 text-white font-bold text-[15px] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#f95738]/20 disabled:opacity-50"
                  >
                    {promotingConfig ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                    Promote to Production
                  </button>
                </div>

              </div>
            )}
          </div>
        )}

        {/* ── TAB CONTENT: SETTINGS ── */}
        {activeTab === "settings" && (
          <div className="space-y-6">
            <div className="p-8 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl">
              <h2 className="text-2xl font-black mb-6">Developer Settings</h2>
              
              <div className="flex items-center justify-between p-6 bg-black/40 rounded-xl border border-white/5">
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">Developer Mode</h3>
                  <p className="text-white/50 text-[13px]">
                    Enable this to see behind-the-scenes data such as the <strong>Enhanced Prompts</strong> generated by the Vision LLM in the main studio interface.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={devMode}
                    onChange={(e) => toggleDevMode(e.target.checked)}
                  />
                  <div className="w-14 h-7 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-[#f95738]"></div>
                </label>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── MODAL: EDIT USER LIMITS ── */}
      {editingUser && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#111111] border border-white/10 shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Sliders className="w-5 h-5 text-[#f95738]" /> Update Quota Limits
              </h3>
              <button
                onClick={() => setEditingUser(null)}
                className="text-white/40 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <span className="text-xs text-white/40 uppercase tracking-wider block mb-0.5">User email</span>
                <span className="font-semibold text-white">{editingUser.email}</span>
              </div>

              <div>
                <label className="block text-white/50 text-[12px] font-black uppercase tracking-wider mb-2">
                  Images Generated Limit Per Week
                </label>
                <input
                  type="number"
                  min={1}
                  max={99999}
                  value={newWeeklyLimit}
                  onChange={e => setNewWeeklyLimit(parseInt(e.target.value) || 50)}
                  className="w-full px-4 py-2.5 bg-black border border-white/10 rounded-xl text-[14px] text-white focus:outline-none focus:border-[#f95738]/50"
                />
              </div>

              <div>
                <label className="block text-white/50 text-[12px] font-black uppercase tracking-wider mb-2">
                  Upscaling Trigger Limit Per Day
                </label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={newDailyUpscaleLimit}
                  onChange={e => setNewDailyUpscaleLimit(parseInt(e.target.value) || 5)}
                  className="w-full px-4 py-2.5 bg-black border border-white/10 rounded-xl text-[14px] text-white focus:outline-none focus:border-[#f95738]/50"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setEditingUser(null)}
                className="flex-1 py-3 rounded-xl border border-white/10 hover:bg-white/5 font-semibold text-white/80 hover:text-white text-[14px] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveLimits}
                disabled={limitsUpdating}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#f95738] to-[#e04e2d] text-white font-bold text-[14px] transition-all flex items-center justify-center gap-1.5"
              >
                {limitsUpdating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Save Changes"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── OVERLAY DRAWER: VIEW USER IMAGES HISTORY ── */}
      {viewingImagesUser && (
        <div className="fixed inset-y-0 right-0 z-[10000] w-full max-w-2xl bg-[#0b0b0b] border-l border-white/10 shadow-2xl flex flex-col">
          
          {/* Header */}
          <div className="p-6 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewingImagesUser(null)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white transition-all"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h3 className="text-lg font-bold text-white leading-tight">
                  User Image Library
                </h3>
                <span className="text-xs text-white/40">{viewingImagesUser.email}</span>
              </div>
            </div>

            <button
              onClick={() => setViewingImagesUser(null)}
              className="text-white/40 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Image Gallery Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {imagesLoading ? (
              <div className="h-[200px] flex flex-col items-center justify-center text-white/40">
                <Loader2 className="w-8 h-8 text-[#f95738] animate-spin mb-2" />
                Loading library data...
              </div>
            ) : userImages.length === 0 ? (
              <div className="h-[200px] flex flex-col items-center justify-center border border-dashed border-white/10 rounded-2xl text-white/30 text-sm">
                <ImageIcon className="w-10 h-10 mb-2 opacity-50" />
                This user has not generated any successful images yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {userImages.map(img => (
                  <div
                    key={img.id}
                    className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden flex flex-col relative group"
                  >
                    <div className="aspect-square w-full relative bg-black/40 flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={normalizeUrl(img.url)}
                        alt={img.prompt}
                        className={`w-full h-full object-cover ${img.is_quarantined ? 'opacity-40 grayscale blur-[2px]' : ''}`}
                      />
                      {img.is_quarantined && (
                        <div className="absolute inset-0 bg-red-950/70 flex flex-col items-center justify-center p-4 text-center z-10">
                          <ShieldAlert className="w-8 h-8 text-red-400 mb-1 animate-pulse" />
                          <span className="text-xs font-black text-red-300 tracking-wider">LEGAL QUARANTINE</span>
                          <span className="text-[10px] text-red-200/80 mt-1 line-clamp-2">{img.quarantine_reason || "DMCA Takedown Notice"}</span>
                        </div>
                      )}
                      {img.video_url && (
                        <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur border border-purple-500/40 text-[9px] font-black text-purple-300 flex items-center gap-1 z-10 pointer-events-none">
                          <Film className="w-3 h-3 text-purple-400" />
                          <span>VIDEO</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-20">
                        <a
                          href={normalizeUrl(img.url)}
                          download={`genfy-user-${img.model_id}.jpg`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-3 rounded-full bg-white text-black hover:scale-115 transition-transform flex items-center justify-center shadow-2xl"
                          title="Download Image"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    </div>

                    <div className="p-4 space-y-2 bg-black/30 border-t border-white/5 text-[12px] flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between text-white/50 mb-2">
                          <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 font-bold uppercase text-[9px]">
                            {img.model_id}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                            img.type === "storyboard" 
                              ? "bg-purple-500/10 border border-purple-500/20 text-purple-400" 
                              : img.type === "character"
                                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                                : img.type === "product"
                                  ? "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                                  : img.type === "compare" 
                                    ? "bg-blue-500/10 border border-blue-500/20 text-blue-400" 
                                    : "bg-[#f95738]/10 border border-[#f95738]/20 text-[#f95738]"
                          }`}>
                            {img.type || "standard"}
                          </span>
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <Calendar className="w-3.5 h-3.5" />
                            {formatDateIST(img.created_at)}
                          </div>
                        </div>

                        {/* Prompts Section */}
                        <div className="space-y-2 pt-2 border-t border-white/5">
                          {img.prompt && (
                            <div className="relative group/prompt">
                              <div className="flex items-center justify-between text-[11px] text-white/40 mb-0.5">
                                <span className="font-bold">Original Prompt:</span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(img.prompt);
                                    toast.success("Original prompt copied!");
                                  }}
                                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-white/50 hover:text-white opacity-0 group-hover/prompt:opacity-100 transition-opacity"
                                  title="Copy Original Prompt"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              <p className={`text-white/80 ${expandedPrompts[img.id + '-orig'] ? '' : 'line-clamp-2'} leading-relaxed`} title={img.prompt}>
                                {img.prompt}
                              </p>
                              {img.prompt.length > 60 && (
                                <button
                                  onClick={() => togglePrompt(img.id + '-orig')}
                                  className="text-[10px] text-[#f95738]/80 hover:text-[#f95738] font-bold mt-0.5"
                                >
                                  {expandedPrompts[img.id + '-orig'] ? "Show Less" : "Show More"}
                                </button>
                              )}
                            </div>
                          )}

                          {img.enhanced_prompt && (
                            <div className="relative group/prompt mt-2 pt-2 border-t border-dashed border-white/5">
                              <div className="flex items-center justify-between text-[11px] text-[#f95738]/50 mb-0.5">
                                <span className="font-bold text-[#f95738]/70">AI Enhanced Prompt:</span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(img.enhanced_prompt || "");
                                    toast.success("Enhanced prompt copied!");
                                  }}
                                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-white/50 hover:text-white opacity-0 group-hover/prompt:opacity-100 transition-opacity"
                                  title="Copy Enhanced Prompt"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              <p className={`text-white/60 ${expandedPrompts[img.id + '-enh'] ? '' : 'line-clamp-2'} leading-relaxed`} title={img.enhanced_prompt}>
                                {img.enhanced_prompt}
                              </p>
                              {img.enhanced_prompt.length > 60 && (
                                <button
                                  onClick={() => togglePrompt(img.id + '-enh')}
                                  className="text-[10px] text-[#f95738]/80 hover:text-[#f95738] font-bold mt-0.5"
                                >
                                  {expandedPrompts[img.id + '-enh'] ? "Show Less" : "Show More"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-2 mt-2 border-t border-white/5">
                        <div className="flex items-center justify-between text-[10px] text-white/40 uppercase font-black">
                          <div className="flex items-center gap-2">
                            {img.ratio && <span>Ratio: {img.ratio}</span>}
                            {img.quality && <span>Quality: {img.quality}</span>}
                          </div>
                          {img.upstream_request_id && (
                            <span className="text-[9px] text-white/30 truncate max-w-[120px]" title={img.upstream_request_id}>
                              ID: {img.upstream_request_id.slice(-8)}
                            </span>
                          )}
                        </div>

                        {/* Legal & DMCA Action Buttons */}
                        <div className="flex items-center justify-between gap-1.5 pt-1">
                          <button
                            onClick={() => handleExportLegalPacket(img.id)}
                            className="px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[10px] font-bold flex items-center gap-1 transition-colors"
                            title="Download complete forensic legal bundle for indemnity claim"
                          >
                            <FileText className="w-3 h-3" />
                            Legal Packet
                          </button>

                          {img.is_quarantined ? (
                            <button
                              onClick={() => handleRestore(img.id)}
                              disabled={quarantiningId === img.id}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
                              title="Restore image to active status"
                            >
                              <CheckCircle className="w-3 h-3" />
                              Restore
                            </button>
                          ) : (
                            <button
                              onClick={() => handleQuarantine(img.id)}
                              disabled={quarantiningId === img.id}
                              className="px-2.5 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
                              title="Quarantine image immediately under DMCA Safe Harbor"
                            >
                              <ShieldAlert className="w-3 h-3" />
                              Quarantine
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
