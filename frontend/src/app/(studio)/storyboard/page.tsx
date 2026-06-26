"use client";
import React, { useState, useEffect, useRef } from "react";
import { useTheme } from "@/context/theme-context";
import { useAuth } from "@/context/auth-context";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Download, Package, GripVertical, Settings, Settings2, Sparkles, RefreshCw, Pencil, Play, Trash2, Trash, Upload, X, FileText, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Folder, Search, Film, Paperclip, Mic, ArrowUp, MessageSquare, Video, ArrowRight, RotateCcw, Square, Eye, Users, Check, Maximize2, Lock } from "lucide-react";
import api, { API_BASE_URL } from "@/utils/api";
import { toast } from "sonner";

const API = API_BASE_URL;

const getSafeImageUrl = (path?: string | null): string => {
  if (!path) return "";
  if (path.startsWith("data:") || path.startsWith("blob:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return API ? `${API}/${cleanPath}` : `/${cleanPath}`;
};
const RATIOS = [
  { id: "1:1", label: "1:1", name: "Square" },
  { id: "1:4", label: "1:4", name: "Tall" },
  { id: "1:8", label: "1:8", name: "Extra Tall" },
  { id: "2:3", label: "2:3", name: "Portrait" },
  { id: "3:2", label: "3:2", name: "Photo Print" },
  { id: "3:4", label: "3:4", name: "Vertical" },
  { id: "4:1", label: "4:1", name: "Wide" },
  { id: "4:3", label: "4:3", name: "Standard" },
  { id: "4:5", label: "4:5", name: "Social" },
  { id: "5:4", label: "5:4", name: "Classic" },
  { id: "8:1", label: "8:1", name: "Extra Wide" },
  { id: "9:16", label: "9:16", name: "Story" },
  { id: "16:9", label: "16:9", name: "Landscape" },
  { id: "21:9", label: "21:9", name: "Cinematic" },
];
const QUALITIES = [
  { id: "Standard", label: "Standard · 1K" },
  { id: "High",     label: "High · 2K" },
];
const MODELS = ["ChatGPT", "Nanobanana 2", "Nanobanana Pro"];
const STYLES = ["Photorealistic", "3D Render", "Anime/Illustration", "Storyboard Sketch", "Digital Painting"];
const CHATGPT_SUB_MODELS = [
  { id: 'gpt-image-2', label: 'GPT Image 2' },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5' },
  { id: 'chatgpt-image-latest', label: 'ChatGPT Latest' },
  { id: 'gpt-image-1', label: 'GPT Image 1' },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1 Mini' }
];

export default function StoryboardPage() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const hasVideoAccess = Boolean(isAdmin || user?.can_generate_video);
  const router = useRouter();

  // ── Impersonation State ──
  const [impersonatedUser, setImpersonatedUser] = useState<{ id: string; email: string; name?: string } | null>(null);
  const [impersonationModalOpen, setImpersonationModalOpen] = useState(false);
  const [impersonationUsersList, setImpersonationUsersList] = useState<any[]>([]);
  const [impersonationSearch, setImpersonationSearch] = useState("");
  const [loadingImpersonationUsers, setLoadingImpersonationUsers] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("impersonate_user");
      if (stored) {
        setImpersonatedUser(JSON.parse(stored));
      }
    } catch (_) {}
  }, []);

  const exitImpersonation = () => {
    localStorage.removeItem("impersonate_user_id");
    localStorage.removeItem("impersonate_user");
    localStorage.removeItem("activeSbId");
    setImpersonatedUser(null);
    setActiveSb(null);
    toast.success("Exited impersonation mode");
    loadSbs();
  };

  const switchImpersonatedUser = (targetUser: { id: string; email: string; name?: string }) => {
    localStorage.setItem("impersonate_user_id", targetUser.id);
    localStorage.setItem("impersonate_user", JSON.stringify(targetUser));
    localStorage.removeItem("activeSbId");
    setImpersonatedUser(targetUser);
    setActiveSb(null);
    setImpersonationModalOpen(false);
    toast.success(`Switched impersonation to ${targetUser.name || targetUser.email}`);
    loadSbs();
  };

  const openImpersonationSwitcher = async () => {
    setImpersonationModalOpen(true);
    setLoadingImpersonationUsers(true);
    try {
      const res = await api.get("/api/storyboard/admin/impersonation-users");
      setImpersonationUsersList(res.data?.users || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to load users list");
    } finally {
      setLoadingImpersonationUsers(false);
    }
  };

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [storyboards, setStoryboards] = useState<any[]>([]);
  const [activeSb, setActiveSb] = useState<any | null>(null);
  const [chars, setChars] = useState<any[]>([]);
  const [prods, setProds] = useState<any[]>([]);
  const [frames, setFrames] = useState<any[]>([]);
  const [loadingSb, setLoadingSb] = useState(true);
  const [newSbName, setNewSbName] = useState("");
  const [newCharName, setNewCharName] = useState("");
  const [newCharImgs, setNewCharImgs] = useState<string[]>([]);
  const [newProdName, setNewProdName] = useState("");
  const [newProdImgs, setNewProdImgs] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null);
  const [frameSettings, setFrameSettings] = useState<Record<string, any>>({});
  const [refTab, setRefTab] = useState<"characters" | "products">("characters");
  const fileRef = useRef<HTMLInputElement>(null);
  const prodFileRef = useRef<HTMLInputElement>(null);

  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [creationMode, setCreationMode] = useState<"brief" | "blank" | "chat">("chat");
  const [landingBriefText, setLandingBriefText] = useState("");
  const landingFileInputRef = useRef<HTMLInputElement>(null);
  
  // NEW CHAT mode states
  const [chatPromptText, setChatPromptText] = useState("");
  const [chatAttachedImages, setChatAttachedImages] = useState<string[]>([]);
  const [chatAttachedFiles, setChatAttachedFiles] = useState<{ file: File; previewUrl?: string; name: string; type: string }[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [smartFrameCount, setSmartFrameCount] = useState<number>(6);
  const [chatSubmitting, setChatSubmitting] = useState(false);
  const chatSubmittingRef = useRef(false);
  const chatAbortControllerRef = useRef<AbortController | null>(null);

  const handleStopChatProcessing = async () => {
    if (chatAbortControllerRef.current) {
      chatAbortControllerRef.current.abort();
      chatAbortControllerRef.current = null;
    }
    chatSubmittingRef.current = false;
    setChatSubmitting(false);
    setChatContactSheetLoading(false);
    setChatGeneratingEntityId(null);
    setGeneratingEntityIds([]);
    if (liveTimerRef.current) {
      clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    generationStartTimeRef.current = 0;
    if (activeSb) {
      try {
        await api.post(`/api/storyboard/${activeSb.id}/cancel`);
      } catch (e) {
        console.error('Failed to cancel storyboard operations on backend:', e);
      }
    }
    toast.info("Processing stopped.");
  };

  const [showFrameCountPopup, setShowFrameCountPopup] = useState(false);
  const [tempFrameCount, setTempFrameCount] = useState<number>(6);
  const frameCountResolverRef = useRef<((count: number) => void) | null>(null);
  const [chatGeneratingEntityId, setChatGeneratingEntityId] = useState<string | null>(null);
  const [chatContactSheetLoading, setChatContactSheetLoading] = useState(false);
  const [contactSheetUrl, setContactSheetUrl] = useState<string | null>(null);
  const [contactSheetScenes, setContactSheetScenes] = useState<any[]>([]);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);

  // Dynamic live thinking stream state
  const [chatProgress, setChatProgress] = useState<any>(null);
  const [thinkingDrawerOpen, setThinkingDrawerOpen] = useState(true);
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState(0);
  const liveTimerRef = useRef<any>(null);
  const generationStartTimeRef = useRef<number>(0);

  // Clarification card marketing angle state
  const [customAngleInput, setCustomAngleInput] = useState<string>("");
  const [selectingAngle, setSelectingAngle] = useState<boolean>(false);

  // Submitting Thinking stream state & multi-entity auto-generation state
  const [chatSubmittingStep, setChatSubmittingStep] = useState<string>("Analyzing brief & extracting character DNA...");
  const [submittingThoughts, setSubmittingThoughts] = useState<string[]>([]);
  const [generatingEntityIds, setGeneratingEntityIds] = useState<string[]>([]);

  // Step 2 DNA Sync prompt modal state
  const [syncPromptModal, setSyncPromptModal] = useState<{
    open: boolean;
    entityName: string;
    entityType: "character" | "product";
  }>({ open: false, entityName: "", entityType: "character" });

  const [entityEditInputs, setEntityEditInputs] = useState<Record<string, string>>({});
  const [modifyingEntityId, setModifyingEntityId] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Smooth auto-scroll chat down whenever messages or thinking updates arrive
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatSubmitting, chatContactSheetLoading, generatingEntityIds]);
  const [isRecording, setIsRecording] = useState(false);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<any>(null);

  const [briefModalOpen, setBriefModalOpen] = useState(false);
  const [briefText, setBriefText] = useState("");
  const [briefParsing, setBriefParsing] = useState(false);
  const [briefError, setBriefError] = useState("");
  const [briefUploadMode, setBriefUploadMode] = useState<'pdf' | 'text'>('pdf');
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [pdfExtractedText, setPdfExtractedText] = useState("");
  const [pdfPreview, setPdfPreview] = useState("");
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [missingQuestions, setMissingQuestions] = useState<Record<string, string>>({});
  const [missingAnswers, setMissingAnswers] = useState<Record<string, string>>({});
  const [suggestedAnswers, setSuggestedAnswers] = useState<Record<string, string[]>>({});
  const [missingDialogOpen, setMissingDialogOpen] = useState(false);
  const [localPromptDrafts, setLocalPromptDrafts] = useState<Record<string, string>>({});
  const editingFrameRef = useRef<Set<string>>(new Set());
  // Ephemeral project created during landing-page brief flow (before ingest commits)
  const [briefTempSb, setBriefTempSb] = useState<any>(null);
  const [briefFrameCount, setBriefFrameCount] = useState(6);  // 1-15
  const [storyboardModel, setStoryboardModel] = useState<string>("Nanobanana 2");

  // ── Video Animation State (Google Veo 3.1 via fal.ai) ──
  const [animModalOpen, setAnimModalOpen] = useState(false);
  const [animMode, setAnimMode] = useState<"single" | "transition">("single");
  const [animSourceFrame, setAnimSourceFrame] = useState<any | null>(null);
  const [animTargetFrame, setAnimTargetFrame] = useState<any | null>(null);
  const [animDuration, setAnimDuration] = useState<number>(6); // 4, 6, 8 (Veo 3.1 enum)
  const [animResolution, setAnimResolution] = useState<"1080p" | "720p">("1080p");
  const [animModelTier, setAnimModelTier] = useState<"lite" | "flagship">("lite");
  const [animGenerateAudio, setAnimGenerateAudio] = useState<boolean>(true);
  const [animPrompt, setAnimPrompt] = useState<string>("");
  const DEFAULT_NEGATIVE_PROMPT_FRONTEND = "morphing faces, melting facial features, distorted anatomy, extra limbs, extra arms, extra hands, missing fingers, mutated fingers, fused fingers, multiple bodies, jittery frame, flickering, frame tearing, sudden jump cuts, stuttering, floating artifacts, ghosting, warped background geometry, unnatural robotic movement, jerky motion, digital glitch, low resolution, blurry, text overlay, watermark, subtitles";
  const [animNegativePrompt, setAnimNegativePrompt] = useState<string>(DEFAULT_NEGATIVE_PROMPT_FRONTEND);
  const [animDirectorLoading, setAnimDirectorLoading] = useState(false);
  const [animStylePreference, setAnimStylePreference] = useState<string>("natural_action");
  const [showNegativePromptDrawer, setShowNegativePromptDrawer] = useState(false);
  const [animSubmitting, setAnimSubmitting] = useState(false);
  const [animPreviewVideoUrl, setAnimPreviewVideoUrl] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [generatingSheet, setGeneratingSheet] = useState<Record<string, boolean>>({});
  const [relocking, setRelocking] = useState<Record<string, string>>({});
  const [expandedScore, setExpandedScore] = useState<string | null>(null);
  const [sheetViewChar, setSheetViewChar] = useState<any>(null);
  const [editDnaChar, setEditDnaChar] = useState<any>(null);
  const [savingDna, setSavingDna] = useState(false);
  const [editDnaTab, setEditDnaTab] = useState<"visual" | "voice" | "personality">("visual");
  const [editDnaForm, setEditDnaForm] = useState({
    ethnicity_skin_tone: "",
    age_gender: "",
    face_shape_features: "",
    hair_details: "",
    eye_details: "",
    build_details: "",
    wardrobe_bible: "",
    fixed_accessories: "",
    recurring_elements: "",
    voice_accent: "",
    voice_pitch: "",
    voice_pace: "",
    voice_texture: "",
    voice_emotional_default: "",
    motivation: "",
    communication_style: "",
    emotional_range: "",
  });

  const [editDnaProd, setEditDnaProd] = useState<any>(null);
  const [savingProdDna, setSavingProdDna] = useState(false);
  const [analyzingProd, setAnalyzingProd] = useState<Record<string, boolean>>({});
  const [editProdDnaForm, setEditProdDnaForm] = useState({
    product_type: "",
    color_palette: "",
    material_finish: "",
    shape_geometry: "",
    branding: "",
    surface_details: "",
    distinctive_features: "",
    scale_reference: "",
  });

  const openDnaEditor = (c: any) => {
    const d = c.character_dna || {};
    const phys = d.physical_anchors || {};
    const costume = d.costume_bible || {};
    const voice = d.voice_dna || {};
    const personality = d.personality_dna || {};

    setEditDnaForm({
      ethnicity_skin_tone: phys.ethnicity_skin_tone || d.ethnicity_skin_tone || d.demographics || d.skin_tone || d.ethnicity || "Warm Mediterranean olive skin tone",
      age_gender: phys.age_gender || d.age_gender || `${d.age || ''} ${d.gender || ''}`.trim() || "Young female (mid-20s)",
      face_shape_features: phys.face_shape_features || d.face_shape_features || d.face_geometry || d.facial_features || d.distinctive_features || "Warm oval face, gentle smile, natural defined jawline",
      hair_details: phys.hair_details || d.hair_details || d.hair_and_skin || d.hair || "Dark wavy chestnut brown hair, shoulder-length in a loose bun",
      eye_details: phys.eye_details || d.eye_details || d.eyes_and_brows || "Expressive amber brown almond-shaped eyes, natural arched brows",
      build_details: phys.build_details || d.build_details || d.build_and_posture || d.build_height || d.build || "Slender athletic build, active posture (~5'6\")",
      wardrobe_bible: costume.wardrobe_bible || d.wardrobe_bible || d.clothing_wardrobe || d.wardrobe || d.typical_wardrobe || d.default_wardrobe || "Fitted navy blue blazer over charcoal t-shirt, dark jeans, brown ankle boots",
      fixed_accessories: costume.fixed_accessories || d.fixed_accessories || d.distinguishing_props || "Minimalist gold hoop earrings, subtle leather wristband",
      recurring_elements: costume.recurring_elements || d.recurring_elements || d.distinguishing_props || d.distinctive_markers || d.distinctive_features || "Artisan copper espresso tamper, vintage ceramic bean jar",
      voice_accent: voice.voice_accent || d.voice_accent || "European Portuguese accent speaking fluent warm English",
      voice_pitch: voice.voice_pitch || d.voice_pitch || "Mid-pitch, melodic and energetic",
      voice_pace: voice.voice_pace || d.voice_pace || "150-165 WPM, spirited engaging cadence with thoughtful pauses",
      voice_texture: voice.voice_texture || d.voice_texture || "Crisp, bright, warm vocal tone with subtle breathiness",
      voice_emotional_default: voice.voice_emotional_default || d.voice_emotional_default || "Spirited, welcoming, enthusiastic craftsperson",
      motivation: personality.motivation || d.motivation || d.personality || "Mastering Lisbon's premier artisan rooftop café and uncovering hidden culinary recipes",
      communication_style: personality.communication_style || d.communication_style || "Warm, enthusiastic, expressive, direct and inviting",
      emotional_range: personality.emotional_range || d.emotional_range || "Animated micro-expressions, infectious smile, focused curiosity",
    });
    setEditDnaTab("visual");
    setEditDnaChar(c);
  };

  const [prodEditInstruction, setProdEditInstruction] = useState("");
  const [editingProdWithPipeline, setEditingProdWithPipeline] = useState(false);

  const openProdDnaEditor = (p: any) => {
    const d = p.product_dna || {};
    const lowName = (p.name || "").toLowerCase();
    setEditProdDnaForm({
      product_type: d.product_type || d.category || (lowName.includes("tamper") ? "Barista Espresso Tool" : lowName.includes("jar") ? "Ceramic Kitchenware" : "Artisan Prop / Equipment"),
      color_palette: d.color_palette || d.colors || d.color_material || (lowName.includes("tamper") ? "Warm burnished copper with dark walnut wood accents" : lowName.includes("jar") ? "Rustic glazed terracotta and off-white ceramic patina" : "Warm metallic copper and neutral earth tones"),
      material_finish: d.material_finish || d.material || d.color_material || (lowName.includes("tamper") ? "Solid turned artisan copper base with satin finish and oiled dark hardwood grip" : lowName.includes("jar") ? "Handmade glazed ceramic with subtle antique crazing" : "Solid polished metal and natural artisan materials"),
      shape_geometry: d.shape_geometry || d.geometry || d.shape_silhouette || (lowName.includes("tamper") ? "Ergonomic 58mm cylindrical flat compression base with curved teardrop handle" : lowName.includes("jar") ? "Cylindrical lidded storage vessel with soft rounded contours" : "Ergonomic functional silhouette"),
      branding: d.branding || d.logo || d.distinctive_branding || (lowName.includes("tamper") ? "Subtle artisan maker's hallmark stamped along rim" : lowName.includes("jar") ? "Faded vintage Portuguese calligraphy on glazed surface" : "Hand-embossed artisan maker's mark"),
      surface_details: d.surface_details || d.details || (lowName.includes("tamper") ? "Precision lathe-turned radial polish lines on bottom compression face, reflective copper patina" : lowName.includes("jar") ? "Tactile ceramic craquelure texture with worn unglazed base" : "Smooth satin finish with handcrafted details"),
      distinctive_features: d.distinctive_features || d.description || (lowName.includes("tamper") ? "Heavy calibrated professional artisan weight with balanced ergonomic center" : lowName.includes("jar") ? "Rolled vintage parchment secret recipe rolled inside chamber" : "Handcrafted artisan quality with authentic working details"),
      scale_reference: d.scale_reference || (lowName.includes("tamper") ? "Handheld commercial barista tool, 58mm diameter base, ~90mm height" : lowName.includes("jar") ? "Countertop canister, approx 15cm height x 10cm diameter" : "Standard handheld scale"),
    });
    setProdEditInstruction("");
    setEditDnaProd(p);
  };

  const saveDna = async () => {
    if (!activeSb || !editDnaChar) return;
    setSavingDna(true);
    try {
      const updatedDna = {
        ...editDnaChar.character_dna,
        physical_anchors: {
          ethnicity_skin_tone: editDnaForm.ethnicity_skin_tone,
          age_gender: editDnaForm.age_gender,
          face_shape_features: editDnaForm.face_shape_features,
          hair_details: editDnaForm.hair_details,
          eye_details: editDnaForm.eye_details,
          build_details: editDnaForm.build_details,
        },
        costume_bible: {
          wardrobe_bible: editDnaForm.wardrobe_bible,
          fixed_accessories: editDnaForm.fixed_accessories,
          recurring_elements: editDnaForm.recurring_elements,
        },
        voice_dna: {
          voice_accent: editDnaForm.voice_accent,
          voice_pitch: editDnaForm.voice_pitch,
          voice_pace: editDnaForm.voice_pace,
          voice_texture: editDnaForm.voice_texture,
          voice_emotional_default: editDnaForm.voice_emotional_default,
        },
        personality_dna: {
          motivation: editDnaForm.motivation,
          communication_style: editDnaForm.communication_style,
          emotional_range: editDnaForm.emotional_range,
        },
        demographics: `${editDnaForm.ethnicity_skin_tone} ${editDnaForm.age_gender}`.trim(),
        face_geometry: editDnaForm.face_shape_features,
        eyes_and_brows: editDnaForm.eye_details,
        hair_and_skin: editDnaForm.hair_details,
        build_and_posture: editDnaForm.build_details,
        default_wardrobe: editDnaForm.wardrobe_bible,
        distinctive_features: editDnaForm.recurring_elements,
      };

      await api.put(`/api/storyboard/${activeSb.id}/character/${editDnaChar.id}/dna`, {
        character_dna: updatedDna,
      });
      setEditDnaChar(null);
      loadChars(activeSb.id);
      toast.success("Character DNA saved successfully!");
    } catch (e: any) {
      console.error("Failed to save character DNA", e);
      toast.error(e?.response?.data?.detail || e?.message || "Failed to save character DNA");
    } finally {
      setSavingDna(false);
    }
  };

  const saveAndRegenerateCharSheet = async () => {
    if (!activeSb || !editDnaChar) return;
    setSavingDna(true);
    try {
      const updatedDna = {
        ...editDnaChar.character_dna,
        physical_anchors: {
          ethnicity_skin_tone: editDnaForm.ethnicity_skin_tone,
          age_gender: editDnaForm.age_gender,
          face_shape_features: editDnaForm.face_shape_features,
          hair_details: editDnaForm.hair_details,
          eye_details: editDnaForm.eye_details,
          build_details: editDnaForm.build_details,
        },
        costume_bible: {
          wardrobe_bible: editDnaForm.wardrobe_bible,
          fixed_accessories: editDnaForm.fixed_accessories,
          recurring_elements: editDnaForm.recurring_elements,
        },
        voice_dna: {
          voice_accent: editDnaForm.voice_accent,
          voice_pitch: editDnaForm.voice_pitch,
          voice_pace: editDnaForm.voice_pace,
          voice_texture: editDnaForm.voice_texture,
          voice_emotional_default: editDnaForm.voice_emotional_default,
        },
        personality_dna: {
          motivation: editDnaForm.motivation,
          communication_style: editDnaForm.communication_style,
          emotional_range: editDnaForm.emotional_range,
        },
        demographics: `${editDnaForm.ethnicity_skin_tone} ${editDnaForm.age_gender}`.trim(),
        face_geometry: editDnaForm.face_shape_features,
        eyes_and_brows: editDnaForm.eye_details,
        hair_and_skin: editDnaForm.hair_details,
        build_and_posture: editDnaForm.build_details,
        default_wardrobe: editDnaForm.wardrobe_bible,
        distinctive_features: editDnaForm.recurring_elements,
        clothing_wardrobe: editDnaForm.wardrobe_bible,
        hair: editDnaForm.hair_details,
        skin_tone: editDnaForm.ethnicity_skin_tone,
        facial_features: editDnaForm.face_shape_features,
        build_height: editDnaForm.build_details,
        distinguishing_props: editDnaForm.recurring_elements || editDnaForm.fixed_accessories,
        demeanor_expression: editDnaForm.voice_emotional_default,
      };

      await api.put(`/api/storyboard/${activeSb.id}/character/${editDnaChar.id}/dna`, {
        character_dna: updatedDna,
      });
      const cid = editDnaChar.id;
      setEditDnaChar(null);
      await loadChars(activeSb.id);
      toast.success("Character DNA saved! Regenerating 3-panel sheet with new DNA...");
      generateSheet(cid);
    } catch (e: any) {
      console.error("Failed to save and regenerate character DNA", e);
      toast.error(e?.response?.data?.detail || e?.message || "Failed to update character");
    } finally {
      setSavingDna(false);
    }
  };

  const saveProdDna = async () => {
    if (!activeSb || !editDnaProd) return;
    setSavingProdDna(true);
    try {
      const updatedDna = {
        ...editDnaProd.product_dna,
        product_type: editProdDnaForm.product_type,
        color_palette: editProdDnaForm.color_palette,
        material_finish: editProdDnaForm.material_finish,
        shape_geometry: editProdDnaForm.shape_geometry,
        branding: editProdDnaForm.branding,
        surface_details: editProdDnaForm.surface_details,
        distinctive_features: editProdDnaForm.distinctive_features,
        scale_reference: editProdDnaForm.scale_reference,
      };

      await api.put(`/api/storyboard/${activeSb.id}/product/${editDnaProd.id}/dna`, {
        product_dna: updatedDna,
      });
      setEditDnaProd(null);
      loadProds(activeSb.id);
      toast.success("Product DNA saved successfully!");
    } catch (e: any) {
      console.error("Failed to save product DNA", e);
      toast.error(e?.response?.data?.detail || e?.message || "Failed to save product DNA");
    } finally {
      setSavingProdDna(false);
    }
  };

  const applyProdEditAndRegenerate = async () => {
    if (!activeSb || !editDnaProd) return;
    setEditingProdWithPipeline(true);
    try {
      const updatedDna = {
        ...editDnaProd.product_dna,
        product_type: editProdDnaForm.product_type,
        color_palette: editProdDnaForm.color_palette,
        material_finish: editProdDnaForm.material_finish,
        shape_geometry: editProdDnaForm.shape_geometry,
        branding: editProdDnaForm.branding,
        surface_details: editProdDnaForm.surface_details,
        distinctive_features: editProdDnaForm.distinctive_features,
        scale_reference: editProdDnaForm.scale_reference,
      };

      await api.post(`/api/storyboard/${activeSb.id}/product/${editDnaProd.id}/edit`, {
        edit_instruction: prodEditInstruction,
        product_dna: updatedDna,
        regenerate_image: true,
      });
      await loadProds(activeSb.id);
      setEditDnaProd(null);
      setProdEditInstruction("");
      toast.success("Product reference image regenerated & DNA updated via Studio Edit Pipeline!");
    } catch (e: any) {
      console.error("Failed to edit product via pipeline", e);
      toast.error(e?.response?.data?.detail || e?.message || "Failed to edit product");
    } finally {
      setEditingProdWithPipeline(false);
    }
  };

  // Auto-generation progress tracker
  const [autoGenState, setAutoGenState] = useState<{ active: boolean; current: number; total: number; attempt: number; frameName?: string; statusNote?: string } | null>(null);
  const autoGenAbort = useRef<boolean>(false); // set true to cancel mid-run
  // Track which frames the user has explicitly triggered generation for (survives poll resets)
  const pendingFrameIds = useRef<Set<string>>(new Set());
  // In-UI warning modal replacing window.confirm
  const [unapprovedWarning, setUnapprovedWarning] = useState<{fid: string; prompt: string; names: string[]} | null>(null);
  // Per-frame hover state for bottom overlay
  const [hoveredFrame, setHoveredFrame] = useState<string | null>(null);

  // ── NO-BRIEF FEATURE STATE ──
  const [charCreateMode, setCharCreateMode] = useState<"upload"|"generate">("upload");
  const [prodCreateMode, setProdCreateMode] = useState<"upload"|"generate">("upload");
  const [newCharDesc, setNewCharDesc] = useState("");
  const [newProdDesc, setNewProdDesc] = useState("");
  const [generatingChar, setGeneratingChar] = useState(false);
  const [generatingProd, setGeneratingProd] = useState(false);
  const [aiIdeaText, setAiIdeaText] = useState("");
  const [aiScaffolding, setAiScaffolding] = useState(false);
  const [inspireLoading, setInspireLoading] = useState<Record<string, boolean>>({});
  const [templates, setTemplates] = useState<any[]>([]);

  useEffect(() => { loadSbs(); }, []);
  useEffect(() => { api.get('/api/storyboard/templates').then(r => setTemplates(r.data)).catch(() => {}); }, []);
  useEffect(() => { 
    if (activeSb) { 
      localStorage.setItem('activeSbId', activeSb.id);
      loadChars(activeSb.id); 
      loadProds(activeSb.id); 
      loadFrames(activeSb.id); 
      loadChatHistory(activeSb.id);
    } else { 
      localStorage.removeItem('activeSbId');
      setChars([]); 
      setProds([]); 
      setFrames([]); 
      setChatMessages([]);
      setContactSheetUrl(null);
    } 
  }, [activeSb]);

  // Poll for frame generation — continues as long as DB or local pending set says generating
  useEffect(() => {
    if (!activeSb) return;
    const isDbGenerating = frames.some((f: any) => f.status === 'generating' || f.video_status === 'generating' || f.transition_video_status === 'generating');
    const isPendingLocally = pendingFrameIds.current.size > 0;
    if (!isDbGenerating && !isPendingLocally) return;

    // Clean up pending IDs that are now done/failed in DB
    frames.forEach((f: any) => {
      if (f.status === 'done' || f.status === 'failed') {
        pendingFrameIds.current.delete(f.id);
      }
    });

    const interval = setInterval(() => {
      loadFrames(activeSb.id);
    }, 2500);
    return () => clearInterval(interval);
  }, [activeSb, frames]);

  const loadSbs = async () => { 
    setLoadingSb(true); 
    try { 
      const r = await api.get('/api/storyboard/list'); 
      setStoryboards(r.data || []); 
      const savedSbId = localStorage.getItem('activeSbId');
      if (savedSbId) {
        setActiveSb((prev: any) => {
          if (!prev) {
            const found = (r.data || []).find((sb: any) => sb.id === savedSbId);
            return found || (r.data && r.data.length > 0 ? r.data[0] : null);
          }
          return prev;
        });
      } else if (r.data && r.data.length > 0) {
        setActiveSb((prev: any) => prev || r.data[0]);
      } else {
        setActiveSb(null);
      }
    } catch(e: any) {
      // AuthGuard handles 401 globally — don't double-redirect
      console.warn('[loadSbs]', e?.response?.status, e?.message);
    } 
    setLoadingSb(false); 
  };
  const selectStoryboard = (sb: any, targetStep?: 1 | 2 | 3) => {
    setActiveSb(sb);
    setActiveStep(targetStep || 1);
    setCreationMode("chat");
  };

  const createSb = async () => {
    if (!newSbName.trim()) return;
    setCreating(true);
    setCreateError("");
    try {
      const r = await api.post('/api/storyboard/create', { name: newSbName });
      setStoryboards(prev => [r.data, ...prev]);
      setActiveSb(r.data);
      setActiveStep(1);
      setCreationMode("chat");
      setNewSbName("");
    } catch(e: any) {
      setCreateError("Failed to create project. Please try again.");
    }
    setCreating(false);
  };
  const deleteSb = async (id: string) => { try { await api.delete(`/api/storyboard/${id}`); setStoryboards(s => s.filter(x => x.id !== id)); if (activeSb?.id === id) setActiveSb(null); } catch(e){} };
  const loadChars = async (id: string) => { try { const r = await api.get(`/api/storyboard/${id}/characters`); setChars(r.data); } catch(e){} };
  const loadProds = async (id: string) => { try { const r = await api.get(`/api/storyboard/${id}/products`); setProds(r.data); } catch(e){} };
  const loadFrames = async (id: string) => { 
    try { 
      const r = await api.get(`/api/storyboard/${id}/frames`); 
      setFrames(prev => {
        // After setFrames, restore any active local drafts
        // Don't overwrite frames the user is currently editing
        return r.data.map((f: any) => {
          if (editingFrameRef.current.has(f.id)) {
            const existing = prev.find((p: any) => p.id === f.id);
            return { ...f, scene_prompt: existing?.scene_prompt ?? f.scene_prompt };
          }
          return f;
        });
      });
    } catch(e){} 
  };

  const loadChatHistory = async (id: string) => {
    try {
      const r = await api.get(`/api/storyboard/${id}/chat/history`);
      if (r.data) {
        const incoming = r.data.chat_history || [];
        setChatMessages(prev => {
          // If incoming has a contact sheet or more messages, always update
          const hasNewContactSheet = incoming.some((m: any) => m.contact_sheet_url && !prev.some((p: any) => p.contact_sheet_url === m.contact_sheet_url));
          if (hasNewContactSheet || incoming.length > prev.length) {
            return incoming;
          }
          // Never wipe out active in-progress or optimistic user messages with empty
          if (chatSubmittingRef.current || (incoming.length === 0 && prev.length > 0)) {
            return prev;
          }
          return incoming;
        });
        if (incoming.length > 0) {
          setCreationMode("chat");
        }
        if (r.data.contact_sheet_url) {
          setContactSheetUrl(r.data.contact_sheet_url);
        }
        if (r.data.slider_frame_count) {
          setSmartFrameCount(r.data.slider_frame_count);
        }
      }
    } catch(e) {
      console.warn('[loadChatHistory]', e);
    }
  };

  const onImgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    Array.from(files).forEach(f => {
      const r = new FileReader();
      r.onload = ev => setNewCharImgs(prev => [...prev, ev.target?.result as string]);
      r.readAsDataURL(f);
    });
    e.target.value = ""; // reset so same files can be re-selected
  };
  const removeNewImg = (idx: number) => setNewCharImgs(prev => prev.filter((_, i) => i !== idx));
  const createChar = async () => {
    if (!newCharName || newCharImgs.length === 0 || !activeSb) return;
    try { await api.post(`/api/storyboard/${activeSb.id}/character/create`, { name: newCharName, images_b64: newCharImgs }); setNewCharName(""); setNewCharImgs([]); loadChars(activeSb.id); } catch(e: any){ toast.error(e?.response?.data?.detail || e?.message || 'Operation failed'); }
  };
  const analyzeChar = async (cid: string) => {
    if (!activeSb) return;
    setChars(cs => cs.map(c => c.id === cid ? { ...c, analyzing: true } : c));
    try { await api.post(`/api/storyboard/${activeSb.id}/character/${cid}/analyze`); loadChars(activeSb.id); } catch(e: any) { setChars(cs => cs.map(c => c.id === cid ? { ...c, analyzing: false } : c)); toast.error(e?.response?.data?.detail || e?.message || 'Operation failed'); }
  };
  const deleteChar = async (cid: string) => { if (!activeSb) return; try { await api.delete(`/api/storyboard/${activeSb.id}/character/${cid}`); setChars(cs => cs.filter(c => c.id !== cid)); } catch(e: any){ toast.error(e?.response?.data?.detail || e?.message || 'Operation failed'); } };

  // ── PRODUCT HANDLERS ──
  const onProdImgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    Array.from(files).forEach(f => {
      const r = new FileReader();
      r.onload = ev => setNewProdImgs(prev => [...prev, ev.target?.result as string]);
      r.readAsDataURL(f);
    });
    e.target.value = "";
  };
  const removeProdImg = (idx: number) => setNewProdImgs(prev => prev.filter((_, i) => i !== idx));
  const createProd = async () => {
    if (!newProdName || newProdImgs.length === 0 || !activeSb) return;
    try {
      const res = await api.post(`/api/storyboard/${activeSb.id}/product/create`, {
        name: newProdName,
        description: newProdDesc.trim(),
        images_b64: newProdImgs
      });
      const pid = res.data?.id;
      setNewProdName("");
      setNewProdDesc("");
      setNewProdImgs([]);
      await loadProds(activeSb.id);
      toast.success("Product created! Extracting DNA...");
      if (pid) {
        analyzeProd(pid);
      }
    } catch(e: any){
      toast.error(e?.response?.data?.detail || e?.message || 'Operation failed');
    }
  };
  const analyzeProd = async (pid: string) => {
    if (!activeSb) return;
    setAnalyzingProd(prev => ({ ...prev, [pid]: true }));
    try {
      await api.post(`/api/storyboard/${activeSb.id}/product/${pid}/analyze`);
      loadProds(activeSb.id);
      toast.success("Product DNA extracted!");
    } catch(e: any) {
      toast.error(e?.response?.data?.detail || e?.message || 'Operation failed');
    } finally {
      setAnalyzingProd(prev => ({ ...prev, [pid]: false }));
    }
  };
  const [generatingProdImg, setGeneratingProdImg] = useState<Record<string, boolean>>({});

  const generateProdImg = async (pid: string) => {
    if (!activeSb) return;
    setGeneratingProdImg(prev => ({ ...prev, [pid]: true }));
    try {
      await api.post(`/api/storyboard/${activeSb.id}/product/${pid}/generate-image`);
      await loadProds(activeSb.id);
      toast.success("Product reference image generated!");
    } catch(e: any) {
      toast.error(e?.response?.data?.detail || e?.message || 'Failed to generate product image');
    } finally {
      setGeneratingProdImg(prev => ({ ...prev, [pid]: false }));
    }
  };

  const uploadPhotosToProd = async (pid: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files || files.length === 0 || !activeSb) return;
    const base64List: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const b64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = ev => resolve(ev.target?.result as string);
        reader.readAsDataURL(f);
      });
      if (b64) base64List.push(b64);
    }
    e.target.value = "";
    if (base64List.length === 0) return;
    try {
      await api.post(`/api/storyboard/${activeSb.id}/product/${pid}/upload-images`, { images_b64: base64List });
      await loadProds(activeSb.id);
      toast.success("Product photos uploaded!");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || 'Failed to upload product photos');
    }
  };

  const deleteProd = async (pid: string) => { if (!activeSb) return; try { await api.delete(`/api/storyboard/${activeSb.id}/product/${pid}`); setProds(ps => ps.filter(p => p.id !== pid)); } catch(e: any){ toast.error(e?.response?.data?.detail || e?.message || 'Operation failed'); } };

  // ── NO-BRIEF HANDLERS ──
  const aiScaffold = async () => {
    if (!aiIdeaText.trim()) return;
    setAiScaffolding(true);
    try {
      const r = await api.post('/api/storyboard/ai-scaffold', { idea: aiIdeaText });
      await loadSbs();
      setActiveSb({ id: r.data.id, name: r.data.name, description: '' });
      setAiIdeaText("");
    } catch(e) { console.error(e); }
    setAiScaffolding(false);
  };

  const templateScaffold = async (key: string, label: string) => {
    try {
      const r = await api.post('/api/storyboard/template-scaffold', { template_key: key, name: `${label} Campaign` });
      await loadSbs();
      setActiveSb({ id: r.data.id, name: r.data.name, description: '' });
    } catch(e) { console.error(e); }
  };

  const generateCharFromDesc = async () => {
    if (!newCharDesc.trim() || !newCharName.trim() || !activeSb) return;
    setGeneratingChar(true);
    const targetName = newCharName.trim();
    try {
      await api.post(`/api/storyboard/${activeSb.id}/character/generate-from-description`, { name: targetName, description: newCharDesc.trim() });
      setNewCharName(""); setNewCharDesc("");
      toast.success(`Character "${targetName}" generated with Nanobanana 2!`);
      await loadChars(activeSb.id);
    } catch(e: any) {
      console.error("[generateCharFromDesc]", e);
      toast.error(e?.response?.data?.detail || e?.message || "Failed to generate character");
    } finally {
      setGeneratingChar(false);
    }
  };

  const generateProdFromDesc = async () => {
    if (!newProdDesc.trim() || !newProdName.trim() || !activeSb) return;
    setGeneratingProd(true);
    const targetName = newProdName.trim();
    try {
      await api.post(`/api/storyboard/${activeSb.id}/product/generate-from-description`, { name: targetName, description: newProdDesc.trim() });
      setNewProdName(""); setNewProdDesc("");
      toast.success(`Product "${targetName}" generated with Nanobanana 2!`);
      await loadProds(activeSb.id);
    } catch(e: any) {
      console.error("[generateProdFromDesc]", e);
      toast.error(e?.response?.data?.detail || e?.message || "Failed to generate product");
    } finally {
      setGeneratingProd(false);
    }
  };

  const inspirePrompt = async (fid: string, roughIdea: string) => {
    if (!roughIdea.trim() || !activeSb) return;
    setInspireLoading(prev => ({ ...prev, [fid]: true }));
    try {
      const r = await api.post(`/api/storyboard/${activeSb.id}/frame/${fid}/inspire-prompt`, { rough_idea: roughIdea });
      setFrames(fs => fs.map(f => f.id === fid ? { ...f, scene_prompt: r.data.expanded_prompt } : f));
    } catch(e) { console.error(e); }
    setInspireLoading(prev => ({ ...prev, [fid]: false }));
  };

  const addFrame = async () => { if (!activeSb) return; try { await api.post(`/api/storyboard/${activeSb.id}/frame/add`, { scene_prompt: "" }); loadFrames(activeSb.id); } catch(e){} };
  const deleteFrame = async (fid: string) => { if (!activeSb) return; try { await api.delete(`/api/storyboard/${activeSb.id}/frame/${fid}`); setFrames(fs => fs.filter(f => f.id !== fid)); } catch(e){} };

  const getSettings = (fid: string) => frameSettings[fid] || { model: "Nanobanana 2", chatgptModel: "gpt-image-1.5", ratio: "16:9", quality: "Standard", style: "Photorealistic" };
  const setSetting = (fid: string, key: string, val: string) => setFrameSettings(s => ({ ...s, [fid]: { ...getSettings(fid), [key]: val } }));

  const closeBriefModal = () => {
    setBriefModalOpen(false);
    setBriefText("");
    setPdfExtractedText("");
    setPdfPreview("");
    setMissingFields([]);
    setMissingQuestions({});
    setMissingAnswers({});
    setSuggestedAnswers({});
    setBriefFromLanding(false);
    setBriefProjectName('');
    setBriefError('');
    setBriefTempSb(null);
  };

  // Helper: get or create the target storyboard for brief ingestion.
  // When briefFromLanding=true, creates a new project first (if not already created).
  const getOrCreateBriefTarget = async (rawText: string): Promise<any | null> => {
    if (!briefFromLanding) {
      if (!activeSb) { setBriefError('No project selected. Please open a project first.'); return null; }
      return activeSb;
    }
    // From landing: if we already created a temp project for this PDF session, reuse it
    if (briefTempSb) return briefTempSb;
    // Otherwise create a new project
    const firstLine = rawText.split('\n').find(l => l.trim().length > 3)?.trim().slice(0, 48) || 'Brief Project';
    const r = await api.post('/api/storyboard/create', { name: briefProjectName.trim() || firstLine });
    const newSb = r.data;
    setStoryboards(prev => [newSb, ...prev]);
    setBriefTempSb(newSb);
    return newSb;
  };

  // ── AUTO-GENERATION ENGINE ──
  const autoGenerateFrames = async (sbId: string, frames: any[]) => {
    const MAX_ATTEMPTS = 3;
    const POLL_INTERVAL = 3000; // ms between status polls
    const defaultSettings = { model: 'Nanobanana 2', chatgptModel: 'gpt-image-1.5', ratio: '16:9', quality: 'Standard', style: 'Photorealistic' };
    const QUEUE_NOTES = [
      "Crafting high-fidelity lighting & scene composition 🎨...",
      "AI queue is busy — giving Gemini a quick espresso break ☕... hang tight!",
      "Applying character consistency magic ✨...",
      "Finalizing photorealistic details, almost ready 🚀..."
    ];
    autoGenAbort.current = false;

    // If storyboard has an approved contact sheet, synchronize panels directly instead of generating from scratch
    if (activeSb?.contact_sheet_url) {
      try {
        toast.loading("Synchronizing frames from contact sheet...", { id: "sync-cs" });
        const res = await api.post(`/api/storyboard/${sbId}/sync-contact-sheet-frames`);
        if (res.data?.frames) {
          setFrames(res.data.frames);
          toast.success("All frames synchronized directly from your contact sheet!", { id: "sync-cs" });
          return;
        }
      } catch (e: any) {
        toast.error("Failed to sync contact sheet frames: " + (e.response?.data?.detail || e.message), { id: "sync-cs" });
        return;
      }
    }

    // Check if frames are already generated
    const pendingFrames = frames.filter(f => !f.image_path || f.status !== 'done');
    if (pendingFrames.length === 0) {
      toast.success("All frames are already generated! Click 'Regenerate' on any individual frame if you wish to tweak it.", { duration: 5000 });
      return;
    }

    for (let i = 0; i < frames.length; i++) {
      if (autoGenAbort.current) break;
      const frame = frames[i];
      const prompt = frame.scene_prompt?.trim();
      if (!prompt) continue;
      // Skip frames that already have an approved image
      if (frame.image_path && frame.status === 'done') continue;

      let attempt = 0;
      let succeeded = false;

      while (attempt < MAX_ATTEMPTS && !succeeded && !autoGenAbort.current) {
        attempt++;
        const note = attempt > 1 ? "Retrying with extra patience ☕..." : undefined;
        setAutoGenState({ active: true, current: i + 1, total: frames.length, attempt, frameName: prompt.slice(0, 40), statusNote: note });

        // 1. Fire generation request (returns immediately — backend does work async)
        try {
          pendingFrameIds.current.add(frame.id);
          setFrames(fs => fs.map(f => f.id === frame.id ? { ...f, status: 'generating' } : f));
          await api.post(`/api/storyboard/${sbId}/frame/${frame.id}/generate`, {
            model: defaultSettings.model,
            chatgpt_model: defaultSettings.chatgptModel,
            scene_prompt: prompt,
            ratio: defaultSettings.ratio,
            quality: defaultSettings.quality,
            style: defaultSettings.style,
          });
        } catch (e: any) {
          // 404 / auth error → abort entirely
          if (e?.response?.status === 404 || e?.response?.status === 401) {
            console.error('[auto-gen] fatal error, aborting:', e?.message);
            autoGenAbort.current = true;
            break;
          }
          // Other errors (timeout etc.) are fine — backend is still running
          console.warn(`[auto-gen] frame ${i + 1} attempt ${attempt} fire error (non-fatal):`, e?.message);
        }

        // 2. Poll until status is 'done' or 'failed' (up to 180s = 60 ticks)
        let status = 'generating';
        let staleTicks = 0;
        while (status === 'generating' && !autoGenAbort.current) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL));
          staleTicks++;
          
          // Update reassuring status note every 30s when generation takes time
          if (staleTicks % 10 === 0) {
            const noteIdx = Math.floor(staleTicks / 10) % QUEUE_NOTES.length;
            setAutoGenState(prev => prev ? { ...prev, statusNote: QUEUE_NOTES[noteIdx] } : null);
          }

          try {
            const r = await api.get(`/api/storyboard/${sbId}/frames`);
            const allFrames: any[] = r.data || [];
            setFrames(allFrames);
            const thisFrame = allFrames.find((f: any) => f.id === frame.id);
            status = thisFrame?.status ?? 'generating';
          } catch (pollErr) {
            console.warn('[auto-gen] poll error:', pollErr);
            staleTicks++;
          }
          // Hard timeout: if still generating after 180s (60 ticks), treat as failed
          if (staleTicks >= 60) {
            status = 'failed';
            setFrames(fs => fs.map(f => f.id === frame.id ? { ...f, status: 'failed', error_msg: 'Generation timed out — retrying...' } : f));
          }
        }

        if (status === 'done') {
          succeeded = true;
          pendingFrameIds.current.delete(frame.id);
          console.log(`[auto-gen] Frame ${i + 1}/${frames.length} done ✓`);
        } else {
          // Failed — will retry if attempts remain
          console.warn(`[auto-gen] Frame ${i + 1} attempt ${attempt} failed. ${attempt < MAX_ATTEMPTS ? 'Retrying...' : 'Giving up.'}`);
          if (attempt < MAX_ATTEMPTS) {
            await new Promise(r => setTimeout(r, 4000)); // 4s pause before retry
          }
        }
      }

      if (!succeeded) {
        pendingFrameIds.current.delete(frame.id);
        // Mark as failed with final error so user sees retry button
        setFrames(fs => fs.map(f => f.id === frame.id ? { ...f, status: 'failed', error_msg: `Failed after ${MAX_ATTEMPTS} attempts — click Retry.` } : f));
      }
    }

    setAutoGenState(null);
    autoGenAbort.current = false;
  };

  const ingestBrief = async (rawText: string) => {
    if (!rawText.trim()) return;
    setBriefError('');
    setBriefParsing(true);
    try {
      const targetSb = await getOrCreateBriefTarget(rawText);
      if (!targetSb) { setBriefParsing(false); return; }
      await api.post(`/api/storyboard/${targetSb.id}/ingest-brief`, {
        raw_text: rawText,
        frame_count: briefFrameCount,
      });
      closeBriefModal();
      await loadSbs();
      setActiveSb(targetSb);
      setActiveStep(2);
      setRefTab("characters");
      await loadChars(targetSb.id);
      await loadProds(targetSb.id);
      // Fetch frames and display them in pending state so user can review characters first
      const framesResp = await api.get(`/api/storyboard/${targetSb.id}/frames`);
      const newFrames: any[] = framesResp.data || [];
      setFrames(newFrames);
      toast.success('Brief parsed! Character DNA & reference sheets are generating in the sidebar. Review and approve them, then click "Generate All Frames"!', { duration: 6000 });
    } catch(e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Brief parsing failed. Please try again.';
      setBriefError(msg);
      console.error('[ingestBrief]', e);
    }
    setBriefParsing(false);
  };

  // Creates a new project from brief name (first line or auto-name), then opens the modal
  const [briefProjectName, setBriefProjectName] = useState('');
  const [briefFromLanding, setBriefFromLanding] = useState(false);

  const openBriefFromLanding = () => {
    setBriefFromLanding(true);
    setBriefModalOpen(true);
  };

  const ingestBriefFromLanding = async (rawText: string) => {
    // Delegates to ingestBrief which now handles the landing flow via getOrCreateBriefTarget
    await ingestBrief(rawText);
  };

  const handleLandingBriefSubmit = async () => {
    if (!landingBriefText.trim()) {
      toast.error("Please enter your creative brief or upload a PDF");
      return;
    }
    if (newSbName.trim()) {
      setBriefProjectName(newSbName.trim());
    }
    setBriefFromLanding(true);
    await ingestBrief(landingBriefText.trim());
  };

  const handleChatFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach(file => {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const isText = file.name.toLowerCase().endsWith(".txt") || file.name.toLowerCase().endsWith(".md");
      const isImg = file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name);

      if (isImg) {
        const reader = new FileReader();
        reader.onload = ev => {
          setChatAttachedFiles(prev => [
            ...prev,
            { file, previewUrl: ev.target?.result as string, name: file.name, type: "image" }
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        setChatAttachedFiles(prev => [
          ...prev,
          { file, name: file.name, type: isPdf ? "pdf" : (isText ? "text" : "doc") }
        ]);
      }
    });
    toast.success(`${files.length} file(s) attached`);
    e.target.value = "";
  };

  const removeChatAttachedFile = (idx: number) => {
    setChatAttachedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const toggleVoiceRecording = () => {
    if (isRecording) {
      if (mediaRecorderRef.current) {
        try { mediaRecorderRef.current.stop(); } catch(e){}
      }
      setIsRecording(false);
      toast.info("Voice recording stopped");
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice recording is not supported in this browser.");
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onstart = () => {
        setIsRecording(true);
        toast.success("Listening... Speak your prompt");
      };
      recognition.onresult = (event: any) => {
        let currentTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setChatPromptText(prev => (prev ? `${prev} ${currentTranscript}` : currentTranscript));
      };
      recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsRecording(false);
      };
      recognition.onend = () => {
        setIsRecording(false);
      };
      recognition.start();
      mediaRecorderRef.current = recognition;
    } catch (err) {
      console.error(err);
      toast.error("Could not access microphone.");
    }
  };

  const handleGenerateSingleEntityVisual = async (entity_type: "character" | "product", entity_id: string) => {
    if (!activeSb) return;
    setChatGeneratingEntityId(entity_id);
    try {
      const res = await api.post(`/api/storyboard/${activeSb.id}/chat/generate-entity-visual`, {
        entity_type,
        entity_id,
        model: storyboardModel,
      });
      if (res.data) {
        toast.success(`Generated visual look!`);
        if (entity_type === "character") {
          loadChars(activeSb.id);
        } else {
          loadProds(activeSb.id);
        }
        if (res.data.chat_history) {
          setChatMessages(res.data.chat_history);
        }
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to generate visual");
    } finally {
      setChatGeneratingEntityId(null);
    }
  };

  const handleEntityModification = async (entity_type: "character" | "product", entity_id: string) => {
    if (!activeSb) return;
    const instruction = (entityEditInputs[entity_id] || "").trim();
    if (!instruction) {
      toast.error("Please enter a revision instruction (e.g. 'make her hair blonde')");
      return;
    }
    setModifyingEntityId(entity_id);
    try {
      const res = await api.post(`/api/storyboard/${activeSb.id}/chat/modify-entity`, {
        entity_type,
        entity_id,
        instruction,
      });
      if (res.data) {
        toast.success("Updated DNA and regenerated look!");
        setEntityEditInputs(prev => ({ ...prev, [entity_id]: "" }));
        if (entity_type === "character") {
          loadChars(activeSb.id);
        } else {
          loadProds(activeSb.id);
        }
        if (res.data.chat_history) {
          setChatMessages(res.data.chat_history);
        }
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to update entity");
    } finally {
      setModifyingEntityId(null);
    }
  };

  const handleSelectMarketingAngle = async (angle: { id?: string; title: string; description?: string; custom_instruction?: string }) => {
    if (!activeSb) return;
    setSelectingAngle(true);
    try {
      const res = await api.post(`/api/storyboard/${activeSb.id}/chat/select-angle`, {
        angle_id: angle.id,
        angle_title: angle.title,
        angle_description: angle.description,
        custom_instruction: angle.custom_instruction,
      });
      if (res.data?.chat_history) {
        setChatMessages(res.data.chat_history);
      }
      toast.success(`Creative direction set: ${angle.custom_instruction || angle.title}`);
      await triggerGenerateContactSheet(smartFrameCount || 6, activeSb, angle.custom_instruction || angle.title);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to set story direction");
    } finally {
      setSelectingAngle(false);
      setCustomAngleInput("");
    }
  };

  const triggerGenerateContactSheet = async (specifiedCount?: number, targetSbOverride?: any, marketingAngleOverride?: string) => {
    const targetSb = targetSbOverride || activeSb;
    if (!targetSb?.id) {
      toast.error("No active storyboard project");
      return;
    }
    const count = specifiedCount || smartFrameCount || 6;
    setSmartFrameCount(count);
    setChatContactSheetLoading(true);
    chatSubmittingRef.current = true;
    const controller = new AbortController();
    chatAbortControllerRef.current = controller;
    toast.info(`Generating ${count}-panel storyboard contact sheet...`);

    generationStartTimeRef.current = Date.now();
    setLiveElapsedSeconds(0);
    setThinkingDrawerOpen(true);
    setChatProgress({
      status: "in_progress",
      current_step: `Directing ${count}-panel script continuity...`,
      current_frame: 0,
      total_frames: count,
      elapsed_seconds: 0,
      thoughts: [
        { time: 0.2, text: `Analyzing creative brief for '${targetSb.name || "Storyboard"}' (${count} panels)...` },
        ...(marketingAngleOverride ? [{ time: 0.5, text: `Directing story with marketing angle: '${marketingAngleOverride}'...` }] : [])
      ]
    });

    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    liveTimerRef.current = setInterval(() => {
      if (generationStartTimeRef.current > 0) {
        setLiveElapsedSeconds(Math.floor((Date.now() - generationStartTimeRef.current) / 1000));
      }
    }, 500);

    let pollInterval: any = null;
    let completed = false;

    const stopPolling = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (liveTimerRef.current) {
        clearInterval(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };

    // Resilient auto-polling: poll /chat/progress every 2s to stream live thoughts and detect completion
    pollInterval = setInterval(async () => {
      if (completed) {
        stopPolling();
        return;
      }
      try {
        const pRes = await api.get(`/api/storyboard/${targetSb.id}/chat/progress`);
        const prog = pRes.data;
        if (prog) {
          setChatProgress(prog);
          if (prog.status === "completed" && prog.contact_sheet_url) {
            completed = true;
            stopPolling();
            setContactSheetUrl(prog.contact_sheet_url);
            const r = await api.get(`/api/storyboard/${targetSb.id}/chat/history`);
            if (r.data?.chat_history) {
              setChatMessages(r.data.chat_history);
            }
            await loadFrames(targetSb.id);
            setChatContactSheetLoading(false);
            chatSubmittingRef.current = false;
            toast.success("Storyboard contact sheet generated! Review panels below.");
          } else if (prog.status === "error") {
            completed = true;
            stopPolling();
            setChatContactSheetLoading(false);
            chatSubmittingRef.current = false;
            toast.error(prog.error || "Contact sheet generation encountered an error");
          }
        }
      } catch (_) {}
    }, 2000);

    try {
      const csRes = await api.post(`/api/storyboard/${targetSb.id}/chat/generate-contact-sheet`, {
        frame_count: count,
        is_refinement: false,
        marketing_angle: marketingAngleOverride || undefined,
        model: storyboardModel,
      }, { signal: controller.signal });
      if (csRes.data && !completed) {
        completed = true;
        stopPolling();
        setContactSheetUrl(csRes.data.contact_sheet_url);
        setContactSheetScenes(csRes.data.scenes || []);
        if (csRes.data.chat_history) {
          setChatMessages(csRes.data.chat_history);
        }
        await loadFrames(targetSb.id);
        toast.success("Storyboard contact sheet generated! Review panels below.");
      }
    } catch (csErr: any) {
      if (controller.signal.aborted) {
        stopPolling();
        console.log("[SmartChat] Contact sheet generation aborted by user.");
        return;
      }
      console.warn("Contact sheet initial request waiting / timed out, background poller will handle completion:", csErr);
      // DO NOT cancel or set completed=true here! Background task is still running and pollInterval is tracking it!
    } finally {
      if (completed) {
        stopPolling();
        setChatContactSheetLoading(false);
        chatSubmittingRef.current = false;
        if (chatAbortControllerRef.current === controller) {
          chatAbortControllerRef.current = null;
        }
      }
    }
  };

  const confirmFrameSelection = (count: number) => {
    const validCount = Math.max(1, Math.min(15, count));
    setSmartFrameCount(validCount);
    setShowFrameCountPopup(false);
    if (frameCountResolverRef.current) {
      frameCountResolverRef.current(validCount);
      frameCountResolverRef.current = null;
    } else {
      triggerGenerateContactSheet(validCount, activeSb);
    }
  };

  const dismissFramePopup = () => {
    setShowFrameCountPopup(false);
    if (frameCountResolverRef.current) {
      frameCountResolverRef.current(smartFrameCount || 6);
      frameCountResolverRef.current = null;
    }
  };

  const handleSmartChatSubmit = async () => {
    if (!chatPromptText.trim() && chatAttachedFiles.length === 0) {
      toast.error("Please enter a prompt or attach reference files");
      return;
    }

    const userMsg = chatPromptText.trim() || `Uploaded ${chatAttachedFiles.length} file(s)`;
    const currentFiles = [...chatAttachedFiles];
    const userImageUrls = currentFiles
      .filter(f => f.previewUrl)
      .map(f => f.previewUrl as string);

    setChatPromptText("");
    setChatAttachedFiles([]);
    setChatSubmitting(true);
    chatSubmittingRef.current = true;
    setCreationMode("chat");
    setActiveStep(1);

    generationStartTimeRef.current = Date.now();
    setLiveElapsedSeconds(0);
    setThinkingDrawerOpen(true);
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    liveTimerRef.current = setInterval(() => {
      if (generationStartTimeRef.current) {
        setLiveElapsedSeconds(Math.floor((Date.now() - generationStartTimeRef.current) / 1000));
      }
    }, 1000);
    setChatSubmittingStep("Analyzing brief & extracting character DNA...");
    setSubmittingThoughts([
      `Received creative brief: "${userMsg.slice(0, 75)}${userMsg.length > 75 ? '...' : ''}"`,
      "Analyzing story narrative and extracting 4-dimension character & product DNA...",
      "Synthesizing tailored marketing & creative angles with Claude Sonnet 5...",
    ]);

    // Optimistically render user message immediately so it NEVER disappears
    setChatMessages(prev => [
      ...prev,
      {
        id: "temp-" + Date.now(),
        role: "user",
        content: userMsg,
        image_urls: userImageUrls,
        files: currentFiles.map(f => f.name),
        timestamp: new Date().toISOString(),
      },
    ]);

    let targetSb = activeSb;

    // Auto-create storyboard project if none active
    if (!targetSb) {
      try {
        const title = userMsg
          ? userMsg.slice(0, 36) + (userMsg.length > 36 ? "..." : "")
          : "Smart Storyboard";
        const cr = await api.post("/api/storyboard/create", { name: title });
        targetSb = cr.data;
        setStoryboards(prev => [targetSb, ...prev]);
        setActiveSb(targetSb);
      } catch (e: any) {
        toast.error("Failed to initialize project");
        setChatPromptText(userMsg);
        setChatSubmitting(false);
        chatSubmittingRef.current = false;
        return;
      }
    }

    const controller = new AbortController();
    chatAbortControllerRef.current = controller;

    try {
      // 1. Intake & Multi-Modal Analysis via GPT-5.6 Luna / Claude Sonnet 5
      const formData = new FormData();
      formData.append("text", userMsg);
      formData.append("frame_count", smartFrameCount.toString());
      currentFiles.forEach(f => {
        formData.append("files", f.file);
      });

      const intakeRes = await api.post(`/api/storyboard/${targetSb.id}/chat/intake`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        signal: controller.signal,
      });

      if (controller.signal.aborted || !chatSubmittingRef.current) return;

      const { intent, chat_history, characters, products, frame_count, is_refinement, edit_instruction, target_frame_numbers } = intakeRes.data;
      if (chat_history) setChatMessages(chat_history);
      if (frame_count) setSmartFrameCount(frame_count);
      if (targetSb?.id) {
        loadChars(targetSb.id);
        loadProds(targetSb.id);
      }

      // CASE 0: Conversational Query or Question (No image/contact sheet generation)
      if (intent === "query") {
        return;
      }

      // CASE 1: Entity Modification (DNA & look regenerated inline in backend)
      if (intent === "entity_modification") {
        toast.success("Updated entity DNA and regenerated look!");
        return;
      }

      // CASE 2: User explicitly requested to proceed / generate contact sheet
      if (intent === "proceed_contact_sheet") {
        await triggerGenerateContactSheet(frame_count || smartFrameCount || 6, targetSb);
        return;
      }

      // CASE 3: Specific Frame Refinement (Only when intent is strictly frame_refinement)
      if (intent === "frame_refinement") {
        toast.info("Refining storyboard contact sheet while preserving existing panels...");
        setChatContactSheetLoading(true);
        try {
          const csRes = await api.post(`/api/storyboard/${targetSb.id}/chat/generate-contact-sheet`, {
            frame_count: frame_count || smartFrameCount || 6,
            edit_instruction: edit_instruction || undefined,
            target_frame_numbers: target_frame_numbers || undefined,
            is_refinement: true,
            model: storyboardModel,
          }, { signal: controller.signal });
          if (csRes.data) {
            setContactSheetUrl(csRes.data.contact_sheet_url);
            setContactSheetScenes(csRes.data.scenes || []);
            if (csRes.data.chat_history) {
              setChatMessages(csRes.data.chat_history);
            }
            await loadFrames(targetSb.id);
            toast.success("Storyboard contact sheet updated! All frames synchronized.");
          }
        } finally {
          setChatContactSheetLoading(false);
        }
        return;
      }

      // If contact sheet already exists, do not auto-regenerate initial entities
      if (contactSheetUrl) {
        return;
      }

      // CASE 4: Initial New Story Creation (Phase 1)
      toast.success("Identified characters & props!");

      // Auto-generate visual references for all characters and products on their own
      const charIdsToGen = (characters || [])
        .filter((c: any) => c?.id && !c?.image_path && c?.name && !["none", "n/a", "null", "undefined", ""].includes(c.name.trim().toLowerCase()))
        .map((c: any) => c.id);
      const prodIdsToGen = (products || [])
        .filter((p: any) => p?.id && !p?.image_path && p?.name && !["none", "n/a", "null", "undefined", ""].includes(p.name.trim().toLowerCase()))
        .map((p: any) => p.id);

      const allIds = [...charIdsToGen, ...prodIdsToGen];
      setGeneratingEntityIds(allIds);

      if (allIds.length > 0) {
        setChatSubmittingStep(`Auto-generating visual references for ${allIds.length} extracted entities...`);
        setSubmittingThoughts(prev => [
          ...prev,
          `Auto-generating visual reference looks for ${characters?.length || 0} character(s) and ${products?.length || 0} product(s) in parallel...`
        ]);
      }

      const entityPromises: Promise<any>[] = [];

      for (const char of (characters || [])) {
        if (controller.signal.aborted || !chatSubmittingRef.current) break;
        const cName = (char.name || "").trim();
        if (!cName || ["none", "n/a", "null", "undefined", ""].includes(cName.toLowerCase())) continue;
        if (!char.image_path) {
          entityPromises.push(
            (async () => {
              try {
                const charRes = await api.post(`/api/storyboard/${targetSb.id}/chat/generate-entity-visual`, {
                  entity_type: "character",
                  entity_id: char.id,
                  model: storyboardModel,
                }, { signal: controller.signal });
                if (charRes.data?.chat_history) setChatMessages(charRes.data.chat_history);
                loadChars(targetSb.id);
              } catch (err) {
                if (!controller.signal.aborted) console.warn(`Visual generation failed for character ${char.name}`, err);
              } finally {
                setGeneratingEntityIds(prev => prev.filter(id => id !== char.id));
              }
            })()
          );
        }
      }

      for (const prod of (products || [])) {
        if (controller.signal.aborted || !chatSubmittingRef.current) break;
        const pName = (prod.name || "").trim();
        if (!pName || ["none", "n/a", "null", "undefined", ""].includes(pName.toLowerCase())) continue;
        if (!prod.image_path) {
          entityPromises.push(
            (async () => {
              try {
                const prodRes = await api.post(`/api/storyboard/${targetSb.id}/chat/generate-entity-visual`, {
                  entity_type: "product",
                  entity_id: prod.id,
                  model: storyboardModel,
                }, { signal: controller.signal });
                if (prodRes.data?.chat_history) setChatMessages(prodRes.data.chat_history);
                loadProds(targetSb.id);
              } catch (err) {
                if (!controller.signal.aborted) console.warn(`Visual generation failed for product ${prod.name}`, err);
              } finally {
                setGeneratingEntityIds(prev => prev.filter(id => id !== prod.id));
              }
            })()
          );
        }
      }

      if (entityPromises.length > 0) {
        await Promise.allSettled(entityPromises);
      }

      if (!controller.signal.aborted && chatSubmittingRef.current) {
        toast.info("Entities ready! Select a story & marketing angle to generate contact sheet.");
      }

    } catch (e: any) {
      if (controller.signal.aborted) {
        console.log("[SmartChat] Chat request aborted by user.");
        return;
      }
      toast.error(e?.response?.data?.detail || "Chat processing failed. Please try again.");
    } finally {
      setChatSubmitting(false);
      chatSubmittingRef.current = false;
      setChatGeneratingEntityId(null);
      setGeneratingEntityIds([]);
      if (liveTimerRef.current) {
        clearInterval(liveTimerRef.current);
        liveTimerRef.current = null;
      }
      if (chatAbortControllerRef.current === controller) {
        chatAbortControllerRef.current = null;
      }
    }
  };


  const handleLandingPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (newSbName.trim()) {
      setBriefProjectName(newSbName.trim());
    }
    setBriefFromLanding(true);
    await uploadBriefPdf(file);
  };

  const uploadBriefPdf = async (file: File) => {
    setBriefError('');
    setPdfExtracting(true);
    setPdfExtractedText("");
    setPdfPreview("");
    setMissingFields([]);
    setMissingQuestions({});
    try {
      // For the PDF upload we need a real storyboard ID. When coming from landing,
      // create the project now so the PDF OCR result is tied to it.
      let targetSb = activeSb;
      if (!targetSb) {
        if (!briefFromLanding) {
          setBriefError('No project selected. Please open a project first.');
          setPdfExtracting(false);
          return;
        }
        // Create project first (or reuse temp if already created)
        if (briefTempSb) {
          targetSb = briefTempSb;
        } else {
          const placeholderName = briefProjectName.trim() || 'Brief Project';
          const r = await api.post('/api/storyboard/create', { name: placeholderName });
          targetSb = r.data;
          setStoryboards(prev => [targetSb, ...prev]);
          setBriefTempSb(targetSb);
        }
      }
      const formData = new FormData();
      formData.append("file", file);
      const r = await api.post(
        `/api/storyboard/${targetSb.id}/upload-brief-pdf`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      const { raw_text, missing_fields, missing_questions, suggested_answers, preview } = r.data;
      setPdfExtractedText(raw_text);
      setPdfPreview(preview);
      if (missing_fields && missing_fields.length > 0) {
        setMissingFields(missing_fields);
        setMissingQuestions(missing_questions || {});
        setSuggestedAnswers(suggested_answers || {});
        const initAnswers: Record<string, string> = {};
        missing_fields.forEach((f: string) => { initAnswers[f] = ""; });
        setMissingAnswers(initAnswers);
        setMissingDialogOpen(true);
      } else {
        // Brief is complete — ingest directly (targetSb already created)
        await ingestBrief(raw_text);
      }
    } catch(e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Failed to process PDF. Please try again.';
      setBriefError(msg);
      console.error("[uploadBriefPdf]", e);
    }
    setPdfExtracting(false);
  };

  const handleMissingFieldsSubmit = async () => {
    if (!pdfExtractedText) return;
    const supplement = Object.entries(missingAnswers)
      .map(([field, answer]) => `\n\n[User-provided ${field.replace(/_/g, " ")}]:\n${answer}`)
      .join("");
    const enrichedText = pdfExtractedText + supplement;
    setMissingDialogOpen(false);
    await ingestBrief(enrichedText);
  };

  const generateSheet = async (cid: string, angle?: "all" | "side" | "face" | "missing") => {
    if (!activeSb) return;
    setGeneratingSheet(prev => ({...prev, [cid]: true}));
    try {
      const url = angle 
        ? `/api/storyboard/${activeSb.id}/character/${cid}/generate-sheet?angle=${angle}` 
        : `/api/storyboard/${activeSb.id}/character/${cid}/generate-sheet`;
      await api.post(url);
      // Backend returns immediately — poll until sheet images appear (up to 3 min)
      const sbId = activeSb.id;
      let ticks = 0;
      const poll = setInterval(async () => {
        ticks++;
        try {
          const r = await api.get(`/api/storyboard/${sbId}/characters`);
          setChars(r.data);
          const c = (r.data as any[]).find((ch: any) => ch.id === cid);
          let isComplete = false;
          if (angle === "side") {
            isComplete = !!c?.character_sheet?.side_profile_url;
          } else if (angle === "face") {
            isComplete = !!c?.character_sheet?.face_closeup_url;
          } else {
            isComplete = !!(c?.character_sheet?.front_body_url && c?.character_sheet?.side_profile_url && c?.character_sheet?.face_closeup_url);
          }
          // Auto-refresh the sheet modal if it's currently open for this character
          if (c) {
            setSheetViewChar((prev: any) => prev?.id === cid ? { ...c } : prev);
          }
          if (isComplete || ticks >= 60) {
            clearInterval(poll);
            setGeneratingSheet(prev => ({...prev, [cid]: false}));
            if (isComplete && activeSb?.contact_sheet_url) {
              setSyncPromptModal({
                open: true,
                entityName: c?.name || "Character",
                entityType: "character"
              });
            }
          }
        } catch {
          clearInterval(poll);
          setGeneratingSheet(prev => ({...prev, [cid]: false}));
        }
      }, 3000);
    } catch(e: any) {
      console.error('[generateSheet]', e?.response?.data?.detail || e?.message || e);
      toast.error(e?.response?.data?.detail || e?.message || 'Operation failed');
      setGeneratingSheet(prev => ({...prev, [cid]: false}));
    }
  };

  const approveSheet = async (cid: string) => {
    if (!activeSb) return;
    try {
      await api.post(`/api/storyboard/${activeSb.id}/character/${cid}/approve-sheet`);
      loadChars(activeSb.id);
      const c = chars.find(ch => ch.id === cid);
      if (activeSb?.contact_sheet_url) {
        setSyncPromptModal({
          open: true,
          entityName: c?.name || "Character",
          entityType: "character"
        });
      }
    } catch(e) { console.error(e); }
  };

  const approveProdLook = async (pid: string) => {
    if (!activeSb) return;
    try {
      await api.post(`/api/storyboard/${activeSb.id}/product/${pid}/approve-look`);
      loadProds(activeSb.id);
      toast.success("Product look approved!");
      const p = prods.find(pr => pr.id === pid);
      if (activeSb?.contact_sheet_url) {
        setSyncPromptModal({
          open: true,
          entityName: p?.name || "Product",
          entityType: "product"
        });
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || "Failed to update product approval");
    }
  };

  const cancelFrameGen = async (fid: string) => {
    if (!activeSb) return;
    try {
      pendingFrameIds.current.delete(fid);
      await api.post(`/api/storyboard/${activeSb.id}/frame/${fid}/cancel`);
      setFrames(prev => prev.map(f => f.id === fid ? { ...f, status: f.image_path ? "done" : "pending" } : f));
      toast.success("Frame generation stopped");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || "Failed to stop frame generation");
    }
  };

  const selectiveRelock = async (fid: string, cid: string, attr: string) => {
    if (!activeSb) return;
    setRelocking(prev => ({...prev, [fid]: attr}));
    try {
      await api.post(`/api/storyboard/${activeSb.id}/frame/${fid}/selective-relock`, { character_id: cid, relock_attribute: attr });
      loadFrames(activeSb.id);
    } catch(e) { console.error(e); }
    setRelocking(prev => ({...prev, [fid]: ""}));
  };

  const setAnchor = async (fid: string) => {
    if (!activeSb) return;
    try {
      await api.patch(`/api/storyboard/${activeSb.id}/frame/${fid}/set-anchor`);
      loadFrames(activeSb.id);
    } catch(e) { console.error(e); }
  };

  const [iterationPrompts, setIterationPrompts] = useState<Record<string, string>>({});
  const [mentionState, setMentionState] = useState<{ active: boolean, query: string, targetId: string, type: 'scene' | 'iteration' }>({ active: false, query: "", targetId: "", type: "scene" });

  const handleMentionChange = (val: string, targetId: string, type: 'scene' | 'iteration') => {
    const lastAtIdx = val.lastIndexOf('@');
    if (lastAtIdx !== -1) {
      const textAfterAt = val.slice(lastAtIdx + 1);
      if (!textAfterAt.includes(' ')) {
        setMentionState({ active: true, query: textAfterAt.toLowerCase(), targetId, type });
        return;
      }
    }
    setMentionState({ active: false, query: "", targetId: "", type: "scene" });
  };

  const insertMention = (name: string) => {
    const { targetId, type, query } = mentionState;
    if (!targetId) return;
    const tag = name.replace(/\s+/g, '_');
    if (type === "scene") {
      setFrames(fs => fs.map(f => {
        if (f.id === targetId) {
          const val = f.scene_prompt || "";
          const lastAtIdx = val.lastIndexOf('@');
          const newVal = val.slice(0, lastAtIdx) + `@${tag} ` + val.slice(lastAtIdx + 1 + query.length);
          return { ...f, scene_prompt: newVal };
        }
        return f;
      }));
    } else {
      setIterationPrompts(prev => {
        const val = prev[targetId] || "";
        const lastAtIdx = val.lastIndexOf('@');
        const newVal = val.slice(0, lastAtIdx) + `@${tag} ` + val.slice(lastAtIdx + 1 + query.length);
        return { ...prev, [targetId]: newVal };
      });
    }
    setMentionState({ active: false, query: "", targetId: "", type: "scene" });
  };

  const renderMentionDropdown = (targetId: string, type: 'scene' | 'iteration') => {
    if (!mentionState.active || mentionState.targetId !== targetId || mentionState.type !== type) return null;
    const filteredChars = chars.filter(c => c.name.toLowerCase().includes(mentionState.query));
    const filteredProds = prods.filter(p => p.name.toLowerCase().includes(mentionState.query));
    if (filteredChars.length === 0 && filteredProds.length === 0) return null;

    return (
      <div style={{ position: "absolute", bottom: "100%", left: 0, background: isDark ? "#222" : "#fff", border: `1px solid ${border}`, borderRadius: 6, padding: 4, zIndex: 10, display: "flex", flexDirection: "column", gap: 2, maxHeight: 150, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", minWidth: 150, marginBottom: 4 }}>
        {filteredChars.map(c => (
          <div key={c.id} onClick={() => insertMention(c.name)} style={{ padding: "6px 8px", fontSize: 12, color: txt, cursor: "pointer", borderRadius: 4, display: "flex", alignItems: "center", gap: 6 }} onMouseOver={e => e.currentTarget.style.background = isDark ? "#333" : "#f0f0f0"} onMouseOut={e => e.currentTarget.style.background = "transparent"}>
            <span style={{ color: accent, fontSize: 14 }}>@</span>{c.name} <span style={{ fontSize: 10, color: sub, marginLeft: "auto" }}>Character</span>
          </div>
        ))}
        {filteredProds.map(p => (
          <div key={p.id} onClick={() => insertMention(p.name)} style={{ padding: "6px 8px", fontSize: 12, color: txt, cursor: "pointer", borderRadius: 4, display: "flex", alignItems: "center", gap: 6 }} onMouseOver={e => e.currentTarget.style.background = isDark ? "#333" : "#f0f0f0"} onMouseOut={e => e.currentTarget.style.background = "transparent"}>
            <span style={{ color: "#3B82F6", fontSize: 14 }}>@</span>{p.name} <span style={{ fontSize: 10, color: sub, marginLeft: "auto" }}>Product</span>
          </div>
        ))}
      </div>
    );
  };

  const iterateFrame = async (fid: string) => {
    const prompt = iterationPrompts[fid];
    if (!activeSb || !prompt?.trim()) return;
    const s = getSettings(fid);
    // Mark as pending so polling loop stays alive
    pendingFrameIds.current.add(fid);
    setFrames(fs => fs.map(f => f.id === fid ? { ...f, status: "generating" } : f));
    try {
      await api.post(`/api/storyboard/${activeSb.id}/frame/${fid}/iterate`, { 
        iteration_prompt: prompt.trim(),
        model: s.model,
        chatgpt_model: s.chatgptModel,
        ratio: s.ratio,
        quality: s.quality,
        style: s.style 
      });
      // Clear the iterate input on success
      setIterationPrompts(prev => ({...prev, [fid]: ""}));
      loadFrames(activeSb.id);
    } catch(e: any) {
      console.warn("[iterateFrame] proxy timeout — backend still generating, polling will catch result.", e?.message || e);
      toast.error(e?.response?.data?.detail || e?.message || 'Operation failed');
      // Do NOT set status to failed — backend is likely still running
    }
  };

  const generateFrame = async (fid: string, prompt: string) => {
    if (!activeSb || !prompt.trim()) return;
    
    const mentionedChars = chars.filter(c => prompt.toLowerCase().includes(`@${c.name.toLowerCase().replace(/\s+/g, '_')}`) || prompt.toLowerCase().includes(`@${c.name.toLowerCase()}`));
    const unapprovedChars = mentionedChars.filter(c => !c.character_sheet || !c.character_sheet.is_approved);
    
    if (unapprovedChars.length > 0) {
      // Show in-UI warning instead of window.confirm
      setUnapprovedWarning({ fid, prompt, names: unapprovedChars.map((c: any) => c.name) });
      return;
    }
    doGenerateFrame(fid, prompt);
  };

  const doGenerateFrame = async (fid: string, prompt: string) => {
    if (!activeSb) return;
    
    const s = getSettings(fid);
    // Track as pending immediately so polling never stops prematurely
    pendingFrameIds.current.add(fid);
    setFrames(fs => fs.map(f => f.id === fid ? { ...f, scene_prompt: prompt, status: "generating" } : f));
    try {
      await api.post(`/api/storyboard/${activeSb.id}/frame/${fid}/generate`, { 
        model: s.model, 
        chatgpt_model: s.chatgptModel, 
        scene_prompt: prompt.trim(), 
        ratio: s.ratio, 
        quality: s.quality,
        style: s.style 
      });
      loadFrames(activeSb.id);
    } catch(e: any) { 
      console.warn("[generateFrame] Proxy timeout — backend still generating. Polling will catch the result.", e?.message || e);
      toast.error(e?.response?.data?.detail || e?.message || 'Operation failed');
      // Do NOT set status to failed — the backend is likely still generating.
      // pendingFrameIds keeps the polling loop alive until DB says done/failed.
    }
  };

  const downloadFrame = async (frame: any, idx: number, format: 'png' | 'tiff' | 'jpg' = 'png') => {
    if (!frame.image_path) return;
    try {
      const isRemoteUrl = frame.image_path.startsWith('http');
      const srcUrl = isRemoteUrl ? frame.image_path : `${API}/${frame.image_path}`;
      const response = await fetch(srcUrl);
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `storyboard_frame_${idx + 1}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch(e) {
      console.error("[downloadFrame] Failed, falling back to link:", e);
      const isRemoteUrl = frame.image_path.startsWith('http');
      const a = document.createElement("a");
      a.href = isRemoteUrl ? frame.image_path : `${API}/${frame.image_path}`;
      a.download = `storyboard_frame_${idx + 1}.${format}`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // ── High-Fidelity Script & Storyboard PDF Export ──
  const handleExportScriptPdf = async () => {
    if (!activeSb) {
      toast.error("No active storyboard selected");
      return;
    }

    setExportingPdf(true);
    const toastId = toast.loading("Compiling script & embedding character sheets and storyboard frames...", { duration: 30000 });

    try {
      // 1. Fetch freshest data to ensure newly generated frames/sheets are included
      let currentChars = chars;
      let currentProds = prods;
      let currentFrames = frames;

      try {
        const [cRes, pRes, fRes] = await Promise.all([
          api.get(`/api/storyboard/${activeSb.id}/characters`),
          api.get(`/api/storyboard/${activeSb.id}/products`),
          api.get(`/api/storyboard/${activeSb.id}/frames`),
        ]);
        if (cRes.data && Array.isArray(cRes.data)) currentChars = cRes.data;
        if (pRes.data && Array.isArray(pRes.data)) currentProds = pRes.data;
        if (fRes.data && Array.isArray(fRes.data)) currentFrames = fRes.data;
      } catch (fetchErr) {
        console.warn("[handleExportScriptPdf] Using state data for export:", fetchErr);
      }

      // Sort frames in chronological order
      const sortedFrames = [...currentFrames].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

      // 2. Extract Story Logline / Premise
      let storyLogline = activeSb.description || "";
      if (chatMessages && chatMessages.length > 0) {
        for (let i = chatMessages.length - 1; i >= 0; i--) {
          const msg = chatMessages[i];
          if (msg.role === "assistant" && msg.story_logline) {
            storyLogline = msg.story_logline;
            break;
          }
        }
      }

      // 3. Helper to resolve image paths and convert to Base64 Data URL for zero broken images
      const resolveImgUrl = (path?: string | null): string => {
        if (!path) return "";
        if (path.startsWith("data:") || path.startsWith("blob:")) return path;
        if (path.startsWith("http://") || path.startsWith("https://")) return path;
        const cleanPath = path.startsWith("/") ? path.slice(1) : path;
        return `${API}/${cleanPath}`;
      };

      const toDataUrl = async (rawPath?: string | null): Promise<string> => {
        const fullUrl = resolveImgUrl(rawPath);
        if (!fullUrl) return "";
        if (fullUrl.startsWith("data:")) return fullUrl;
        try {
          const res = await fetch(fullUrl, { mode: "cors" });
          if (!res.ok) return fullUrl;
          const blob = await res.blob();
          return await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(fullUrl);
            reader.readAsDataURL(blob);
          });
        } catch {
          return fullUrl;
        }
      };

      // 4. Preload and convert character images & sheet angles
      const charactersWithImages = await Promise.all(
        currentChars.map(async (c: any) => {
          const mainImg = await toDataUrl(c.image_path || (c.image_paths && c.image_paths[0]));
          const sheet = c.character_sheet || {};
          const frontImg = sheet.front_body_url ? await toDataUrl(sheet.front_body_url) : mainImg;
          const sideImg = sheet.side_profile_url ? await toDataUrl(sheet.side_profile_url) : "";
          const faceImg = sheet.face_closeup_url ? await toDataUrl(sheet.face_closeup_url) : "";
          return {
            ...c,
            resolvedMainImg: mainImg,
            resolvedFrontImg: frontImg,
            resolvedSideImg: sideImg,
            resolvedFaceImg: faceImg,
          };
        })
      );

      // 5. Preload product images
      const productsWithImages = await Promise.all(
        currentProds.map(async (p: any) => {
          const prodImg = await toDataUrl(p.image_path || (p.image_paths && p.image_paths[0]));
          return { ...p, resolvedImg: prodImg };
        })
      );

      // 6. Preload frame stills
      const framesWithImages = await Promise.all(
        sortedFrames.map(async (f: any) => {
          const frameImg = await toDataUrl(f.image_path);
          return { ...f, resolvedImg: frameImg };
        })
      );

      const title = activeSb.name || "Cinematic Storyboard";
      const formattedDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const safeDownloadTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_");

      const loglineHtml = storyLogline ? `
      <div class="logline-box">
        <strong>STORY LOGLINE:</strong> ${storyLogline}
      </div>` : "";

      let charactersHtml = "";
      if (charactersWithImages.length > 0) {
        const charCards = charactersWithImages.map((c: any) => {
          const dna = c.character_dna || {};
          const phys = dna.physical_anchors || {};
          const costume = dna.costume_bible || {};
          const ageGender = phys.age_gender || dna.demographics || `${dna.age || ""} ${dna.gender || ""}`.trim() || "Unspecified";
          const face = phys.face_shape_features || dna.distinctive_features || dna.face_geometry || "Natural";
          const hairSkin = phys.hair_details || dna.hair_and_skin || `Hair: ${dna.hair || "Natural"}; Skin: ${dna.skin_tone || "Natural"}`;
          const wardrobe = costume.wardrobe_bible || dna.clothing_wardrobe || dna.wardrobe || dna.default_wardrobe || "Everyday attire";

          const frontImgBlock = c.resolvedFrontImg
            ? `<img class="sheet-img" src="${c.resolvedFrontImg}" alt="${c.name} Front View" />`
            : `<div class="sheet-img" style="display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;">Front Portrait</div>`;

          const sideImgBlock = c.resolvedSideImg
            ? `<img class="sheet-img" src="${c.resolvedSideImg}" alt="${c.name} Side Profile" />`
            : `<div class="sheet-img" style="display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;">Profile View</div>`;

          const faceImgBlock = c.resolvedFaceImg
            ? `<img class="sheet-img" src="${c.resolvedFaceImg}" alt="${c.name} Close-up" />`
            : `<div class="sheet-img" style="display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;">Face Close-Up</div>`;

          return `
          <div class="char-card page-break-inside-avoid">
            <div class="char-header">
              <div>
                <div class="char-name">${c.name}</div>
                <div class="char-role">${ageGender}</div>
              </div>
            </div>
            <div class="char-dna-grid">
              <div class="char-dna-item"><b>Demographics:</b> ${ageGender}</div>
              <div class="char-dna-item"><b>Hair & Skin:</b> ${hairSkin}</div>
              <div class="char-dna-item"><b>Features:</b> ${face}</div>
              <div class="char-dna-item"><b>Mandatory Wardrobe:</b> ${wardrobe}</div>
            </div>
            <div class="sheet-gallery">
              <div class="sheet-photo-wrap">
                ${frontImgBlock}
                <div class="sheet-caption">1. Front Look (Anchor)</div>
              </div>
              <div class="sheet-photo-wrap">
                ${sideImgBlock}
                <div class="sheet-caption">2. 90° Side Profile</div>
              </div>
              <div class="sheet-photo-wrap">
                ${faceImgBlock}
                <div class="sheet-caption">3. Face Close-Up</div>
              </div>
            </div>
          </div>`;
        }).join("");

        charactersHtml = `
        <div class="section-title-bar">
          <span class="section-num">01</span>
          <h2 class="section-title">Dramatis Personae & Visual Character Sheets</h2>
        </div>
        ${charCards}`;
      }

      let productsHtml = "";
      if (productsWithImages.length > 0) {
        const prodCards = productsWithImages.map((p: any) => {
          const dna = p.product_dna || {};
          const imgBlock = p.resolvedImg ? `<img class="prod-img" src="${p.resolvedImg}" alt="${p.name}" />` : "";
          const colorMat = dna.color_material ? `<strong>Color & Material:</strong> ${dna.color_material}<br/>` : "";
          const form = dna.shape_geometry ? `<strong>Form:</strong> ${dna.shape_geometry}` : "";
          return `
          <div class="prod-card page-break-inside-avoid">
            ${imgBlock}
            <div class="prod-details">
              <div class="prod-name">${p.name}</div>
              <div class="prod-desc">
                ${p.description || dna.category || "Custom prop / environment anchor"}<br/>
                ${colorMat}
                ${form}
              </div>
            </div>
          </div>`;
        }).join("");

        productsHtml = `
        <div class="section-title-bar">
          <span class="section-num">02</span>
          <h2 class="section-title">Key Props & Environmental Anchors</h2>
        </div>
        ${prodCards}`;
      }

      const sectionNumFrames = productsWithImages.length > 0 ? "03" : "02";
      const frameCards = framesWithImages.map((f: any, idx: number) => {
        const promptText = f.scene_prompt || f.expanded_prompt || `Cinematic scene ${idx + 1}.`;
        const presentNames = charactersWithImages
          .filter((c: any) => c.name && promptText.toLowerCase().includes(c.name.toLowerCase()))
          .map((c: any) => c.name);

        const imgBlock = f.resolvedImg
          ? `<img class="frame-img" src="${f.resolvedImg}" alt="Frame ${idx + 1}" />`
          : `<div class="frame-placeholder">Frame ${idx + 1} Image Pending</div>`;

        const pillsHtml = presentNames.length > 0
          ? `<div class="tags-row">
              <span style="font-size:11px; font-weight:700; color:#475569; margin-right:4px;">CHARACTERS:</span>
              ${presentNames.map((name: string) => `<span class="char-pill">${name}</span>`).join("")}
            </div>`
          : "";

        return `
        <div class="frame-card page-break-inside-avoid">
          <div class="frame-bar">
            <div style="display:flex; align-items:center; gap: 10px;">
              <span class="frame-badge">FRAME ${(idx + 1).toString().padStart(2, "0")}</span>
              <span class="frame-slug screenplay-font">SCENE ${idx + 1}</span>
            </div>
            <span class="frame-ratio">16:9 Panavision</span>
          </div>
          <div class="frame-img-container">
            ${imgBlock}
          </div>
          <div class="script-section">
            <div class="script-header-line screenplay-font">SCENE VISUAL & ACTION</div>
            <div class="script-text screenplay-font">${promptText}</div>
            ${pillsHtml}
          </div>
        </div>`;
      }).join("");

      const framesHtml = `
      <div class="section-title-bar page-break-before">
        <span class="section-num">${sectionNumFrames}</span>
        <h2 class="section-title">Storyboard Frames & Shooting Script</h2>
      </div>
      ${frameCards}`;

      // 7. Render complete printable screenplay & storyboard document
      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>\${title} — Storyboard Script</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #7c3aed;
      --primary-dark: #6d28d9;
      --text: #111827;
      --text-muted: #4b5563;
      --bg: #ffffff;
      --surface: #f9fafb;
      --border: #e5e7eb;
      --card-border: #d1d5db;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: var(--text);
      background: #f3f4f6;
      line-height: 1.5;
      padding: 0;
      margin: 0;
    }
    .screenplay-font {
      font-family: 'Courier Prime', 'Courier New', Courier, monospace;
    }

    /* Print & Screen Toolbar */
    .toolbar-container {
      position: sticky;
      top: 0;
      z-index: 9999;
      background: #0f172a;
      color: #f8fafc;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    }
    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .toolbar-logo {
      font-weight: 800;
      font-size: 15px;
      letter-spacing: -0.5px;
      display: flex;
      align-items: center;
      gap: 6px;
      color: #fff;
    }
    .toolbar-tag {
      background: rgba(124, 58, 237, 0.3);
      color: #c4b5fd;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      font-weight: 600;
      border: 1px solid rgba(124, 58, 237, 0.5);
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
      border: none;
      text-decoration: none;
    }
    .btn-primary {
      background: linear-gradient(135deg, #7c3aed, #9333ea);
      color: #ffffff;
      box-shadow: 0 2px 10px rgba(124, 58, 237, 0.4);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #6d28d9, #7e22ce);
    }
    .btn-secondary {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
    }
    .btn-secondary:hover {
      background: #334155;
    }

    /* Page container */
    .document-page {
      max-width: 960px;
      margin: 32px auto;
      background: #ffffff;
      padding: 48px 56px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      border-radius: 8px;
    }

    /* Cover / Header Section */
    .cover-header {
      border-bottom: 3px solid #111827;
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    .studio-label {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 2px;
      color: var(--primary);
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .story-title {
      font-size: 32px;
      font-weight: 900;
      color: #111827;
      line-height: 1.15;
      margin-bottom: 16px;
      letter-spacing: -0.5px;
    }
    .logline-box {
      background: #f8fafc;
      border-left: 4px solid var(--primary);
      padding: 14px 18px;
      border-radius: 0 6px 6px 0;
      font-size: 14px;
      color: #334155;
      line-height: 1.6;
      margin-bottom: 20px;
      font-style: italic;
    }
    .metadata-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      padding-top: 12px;
      border-top: 1px dashed var(--border);
    }
    .meta-item {
      display: flex;
      flex-direction: column;
    }
    .meta-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      color: #6b7280;
      letter-spacing: 0.5px;
    }
    .meta-val {
      font-size: 13px;
      font-weight: 600;
      color: #111827;
    }

    /* Section Headings */
    .section-title-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 40px 0 20px 0;
      padding-bottom: 8px;
      border-bottom: 2px solid #111827;
    }
    .section-num {
      background: #111827;
      color: #ffffff;
      font-size: 11px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #111827;
    }

    /* Character Cards */
    .char-card {
      background: #ffffff;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .char-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .char-name {
      font-size: 18px;
      font-weight: 800;
      color: #111827;
    }
    .char-role {
      font-size: 12px;
      color: var(--primary);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .char-dna-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px 16px;
      font-size: 12px;
      color: #374151;
      margin-bottom: 16px;
      background: #f9fafb;
      padding: 12px 16px;
      border-radius: 6px;
    }
    .char-dna-item b {
      color: #111827;
      display: inline-block;
      min-width: 100px;
    }

    /* Model Sheet 3-Angle Gallery */
    .sheet-gallery {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 12px;
    }
    .sheet-photo-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      padding: 6px;
    }
    .sheet-img {
      width: 100%;
      height: 200px;
      object-fit: cover;
      border-radius: 4px;
      background: #e2e8f0;
    }
    .sheet-caption {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      margin-top: 6px;
      text-align: center;
    }

    /* Product Cards */
    .prod-card {
      background: #ffffff;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      display: flex;
      gap: 16px;
      align-items: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .prod-img {
      width: 120px;
      height: 120px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid var(--border);
      flex-shrink: 0;
      background: #f1f5f9;
    }
    .prod-details {
      flex: 1;
    }
    .prod-name {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .prod-desc {
      font-size: 12px;
      color: #4b5563;
      line-height: 1.5;
    }

    /* Storyboard Frame Cards */
    .frame-card {
      background: #ffffff;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 36px;
      page-break-inside: avoid;
      break-inside: avoid;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }
    .frame-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 2px solid #111827;
    }
    .frame-badge {
      background: #111827;
      color: #ffffff;
      font-size: 12px;
      font-weight: 800;
      padding: 4px 10px;
      border-radius: 4px;
      letter-spacing: 1px;
    }
    .frame-slug {
      font-size: 14px;
      font-weight: 700;
      color: #111827;
      letter-spacing: 0.5px;
    }
    .frame-ratio {
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
    }

    .frame-img-container {
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #0f172a;
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 18px;
      border: 1px solid #334155;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .frame-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .frame-placeholder {
      color: #94a3b8;
      font-size: 14px;
      font-style: italic;
    }

    .script-section {
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px 20px;
      margin-top: 12px;
    }
    .script-header-line {
      font-size: 13px;
      font-weight: 800;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .script-text {
      font-size: 13.5px;
      color: #1e293b;
      line-height: 1.65;
    }
    .tags-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed var(--border);
    }
    .char-pill {
      background: #e0e7ff;
      color: #3730a3;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
    }

    /* Print Specifics */
    @media print {
      body {
        background: #ffffff !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .no-print {
        display: none !important;
      }
      .document-page {
        box-shadow: none !important;
        border-radius: 0 !important;
        padding: 0 !important;
        max-width: 100% !important;
        margin: 0 !important;
      }
      .page-break-before {
        page-break-before: always;
        break-before: page;
      }
      .page-break-inside-avoid {
        page-break-inside: avoid;
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>

  <!-- Floating Print Control Bar (Screen Only) -->
  <div class="toolbar-container no-print">
    <div class="toolbar-left">
      <div class="toolbar-logo">
        <span>🎬 Genfy Storyboard AI</span>
      </div>
      <span class="toolbar-tag">Screenplay & Storyboard Treatment</span>
    </div>
    <div class="toolbar-actions">
      <button class="btn btn-primary" onclick="window.print()">
        🖨️ Save as PDF / Print
      </button>
      <button class="btn btn-secondary" onclick="downloadStandaloneHtml()">
        💾 Download HTML
      </button>
      <button class="btn btn-secondary" onclick="window.close()">
        ✕ Close
      </button>
    </div>
  </div>

  <div class="document-page">
    <!-- Header / Cover -->
    <div class="cover-header">
      <div class="studio-label">Genfy Storyboard Studio · Production Deck</div>
      <h1 class="story-title">${title}</h1>
      
      ${loglineHtml}

      <div class="metadata-grid">
        <div class="meta-item">
          <span class="meta-label">Total Panels</span>
          <span class="meta-val">${framesWithImages.length} Cinematic Frames</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Cast Members</span>
          <span class="meta-val">${charactersWithImages.length} Characters</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Aspect Ratio</span>
          <span class="meta-val">16:9 Landscape (Film)</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Generated Date</span>
          <span class="meta-val">${formattedDate}</span>
        </div>
      </div>
    </div>

    <!-- 01. CHARACTERS & CAST SECTION -->
    ${charactersHtml}

    <!-- 02. PROPS & ENVIRONMENT (IF ANY) -->
    ${productsHtml}

    <!-- 03. STORYBOARD FRAMES & SCREENPLAY -->
    ${framesHtml}

    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border); text-align: center; color: #94a3b8; font-size: 11px;">
      Generated by Genfy Storyboard AI · Confidential Production Document
    </div>
  </div>

  <script>
    function downloadStandaloneHtml() {
      const clone = document.documentElement.cloneNode(true);
      const toolbars = clone.querySelectorAll('.no-print');
      toolbars.forEach(el => el.remove());
      const htmlStr = '<!DOCTYPE html>\\n' + clone.outerHTML;
      const blob = new Blob([htmlStr], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '${safeDownloadTitle}_script.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    // Auto-trigger native browser PDF print dialog once rendered
    window.addEventListener('load', () => {
      setTimeout(() => {
        window.print();
      }, 700);
    });
  </script>
</body>
</html>`;

      const printWin = window.open("", "_blank");
      if (!printWin) {
        toast.error("Popup blocked! Please allow popups to download the Script PDF.", { id: toastId });
        setExportingPdf(false);
        return;
      }

      printWin.document.open();
      printWin.document.write(htmlContent);
      printWin.document.close();

      toast.success("Script PDF ready! Browser print/save dialog opened.", { id: toastId });
    } catch (err: any) {
      console.error("[handleExportScriptPdf] Error:", err);
      toast.error("Failed to generate script PDF: " + (err.message || "Unknown error"), { id: toastId });
    } finally {
      setExportingPdf(false);
    }
  };

  // ── Google Veo 3.1 Video Animation Handlers ──
  const openSingleFrameAnimation = (frame: any) => {
    if (!hasVideoAccess) return;
    setAnimMode("single");
    setAnimSourceFrame(frame);
    setAnimTargetFrame(null);
    setAnimDuration(frame.video_duration || 6);
    setAnimResolution("1080p");
    setAnimModelTier("lite");
    setAnimGenerateAudio(true);
    setAnimPrompt(
      frame.video_prompt ||
      (frame.scene_prompt
        ? `Cinematic subtle motion: ${frame.scene_prompt}`
        : "Cinematic motion, fluid lifelike movement, gentle camera pan")
    );
    setAnimPreviewVideoUrl(frame.video_url || null);
    setAnimNegativePrompt(DEFAULT_NEGATIVE_PROMPT_FRONTEND);
    setAnimModalOpen(true);
  };

  const fetchDirectorBridgePrompt = async (
    sourceFrame: any,
    targetFrame: any,
    duration = 6,
    stylePref = "natural_action"
  ) => {
    if (!activeSb) return;
    setAnimDirectorLoading(true);
    try {
      const resp = await api.post(`/api/storyboard/${activeSb.id}/frames/transition-bridge-prompt`, {
        source_frame_id: sourceFrame.id,
        target_frame_id: targetFrame.id,
        duration: duration,
        style_preference: stylePref,
      });
      if (resp.data) {
        if (resp.data.director_prompt) {
          setAnimPrompt(resp.data.director_prompt);
        }
        if (resp.data.negative_prompt) {
          setAnimNegativePrompt(resp.data.negative_prompt);
        }
        toast.success("AI Director crafted an optimized transition script!");
      }
    } catch (e: any) {
      console.warn("[DirectorBridge] Fallback used:", e);
      const p1 = sourceFrame?.scene_prompt || `Frame ${(sourceFrame?.order_index ?? 0) + 1}`;
      const p2 = targetFrame?.scene_prompt || `Frame ${(targetFrame?.order_index ?? 0) + 1}`;
      setAnimPrompt(
        `Continuous cinematic shot transitioning smoothly from "${p1}" into "${p2}". The subject moves with natural physics and posture, while the camera executes a fluid, steady movement to connect the two frames. Preserves consistent lighting, character appearance, and environment details.`
      );
    } finally {
      setAnimDirectorLoading(false);
    }
  };

  const openTransitionAnimation = (sourceFrame: any, targetFrame: any) => {
    if (!hasVideoAccess) return;
    setAnimMode("transition");
    setAnimSourceFrame(sourceFrame);
    setAnimTargetFrame(targetFrame);
    const dur = sourceFrame.transition_video_duration || 6;
    setAnimDuration(dur);
    setAnimResolution("1080p");
    setAnimModelTier("lite");
    setAnimGenerateAudio(true);
    setAnimStylePreference("natural_action");
    setAnimNegativePrompt(DEFAULT_NEGATIVE_PROMPT_FRONTEND);
    setAnimPreviewVideoUrl(sourceFrame.transition_video_url || null);
    setAnimModalOpen(true);

    if (sourceFrame.transition_video_prompt) {
      setAnimPrompt(sourceFrame.transition_video_prompt);
    } else {
      // Immediate fluid placeholder
      setAnimPrompt(
        `Continuous fluid shot. The subject naturally shifts focus and physical posture from "${sourceFrame.scene_prompt || 'Frame ' + (sourceFrame.order_index + 1)}" into "${targetFrame.scene_prompt || 'Frame ' + (targetFrame.order_index + 1)}", with steady camera motion and consistent lighting.`
      );
      // Automatically synthesize detailed AI Director Bridge
      fetchDirectorBridgePrompt(sourceFrame, targetFrame, dur, "natural_action");
    }
  };

  const triggerAnimation = async () => {
    if (!activeSb || !animSourceFrame) return;
    if (!hasVideoAccess) {
      toast.error("Video animation is locked. Please contact an admin to request video generation access.");
      return;
    }
    setAnimSubmitting(true);
    try {
      const payload: any = {
        mode: animMode,
        prompt: animPrompt.trim(),
        negative_prompt: animNegativePrompt.trim(),
        duration: Number(animDuration) || 6,
        aspect_ratio: "16:9",
        resolution: animResolution,
        generate_audio: animGenerateAudio,
        model_tier: animModelTier,
      };
      if (animMode === "transition") {
        if (!animTargetFrame) {
          toast.error("Target frame is required for transition mode");
          setAnimSubmitting(false);
          return;
        }
        payload.target_frame_id = animTargetFrame.id;
      }

      await api.post(`/api/storyboard/${activeSb.id}/frame/${animSourceFrame.id}/animate`, payload);
      toast.success(
        animMode === "transition"
          ? "Transition animation started with Google Veo 3.1!"
          : "Frame animation started with Google Veo 3.1!"
      );
      setAnimModalOpen(false);
      loadFrames(activeSb.id);
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || "Failed to start video animation";
      toast.error(detail);
    } finally {
      setAnimSubmitting(false);
    }
  };

  const downloadVideo = async (url: string, filename = "veo3_animation.mp4") => {
    if (!url) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch (e) {
      console.error("[downloadVideo] Fallback direct link:", e);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // Theme
  const bg = isDark ? "#0e0e0e" : "#fafafa";
  const panel = isDark ? "#161616" : "#f0f0f0";
  const card = isDark ? "#1c1c1c" : "#fff";
  const border = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const txt = isDark ? "#e8e8e8" : "#1a1a1a";
  const sub = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const accent = "#f95738";
  const accentHover = "#e04e2d";

  const inputStyle: React.CSSProperties = { width: "100%", background: isDark ? "#222" : "#fff", border: `1px solid ${border}`, borderRadius: 8, padding: "10px 14px", color: txt, outline: "none", fontSize: 13, fontFamily: "inherit" };
  const btnPrimary: React.CSSProperties = { background: accent, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 };
  const btnGhost: React.CSSProperties = { background: "none", border: `1px solid ${border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, color: sub, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 };

  return (
    <div
      data-storyboard-page="true"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        maxHeight: "100%",
        minHeight: 0,
        background: bg,
        color: txt,
        fontFamily: "'Inter', sans-serif",
        overflow: "hidden",
        position: "relative"
      }}
    >
      {/* ═══ IMPERSONATION BANNER ═══ */}
      {impersonatedUser && (
        <div style={{
          width: "100%",
          padding: "8px 24px",
          background: "linear-gradient(90deg, #7c3aed, #9333ea, #a855f7)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          fontWeight: 600,
          zIndex: 120,
          flexShrink: 0,
          boxShadow: "0 2px 10px rgba(124,58,237,0.35)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Eye size={16} />
            <span>
              Viewing Storyboard as <strong>{impersonatedUser.name || impersonatedUser.email}</strong> <span style={{ opacity: 0.85 }}>({impersonatedUser.email})</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={openImpersonationSwitcher}
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "1px solid rgba(255,255,255,0.4)",
                color: "#fff",
                padding: "4px 12px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.3)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.2)")}
            >
              Switch User
            </button>
            <button
              onClick={exitImpersonation}
              style={{
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.3)",
                color: "#fff",
                padding: "4px 12px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.45)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.3)")}
            >
              Exit Impersonation
            </button>
          </div>
        </div>
      )}

      {/* ═══ TOP FIXED HEADER & 3-STEP PROGRESS BAR ═══ */}
      <div style={{
        position: "sticky",
        top: 0,
        left: 0,
        right: 0,
        padding: "8px 24px",
        borderBottom: `1px solid ${border}`,
        background: isDark ? "rgba(20, 20, 20, 0.92)" : "rgba(255, 255, 255, 0.92)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        minHeight: 54,
        height: 54,
        flexShrink: 0,
        zIndex: 100,
        boxShadow: isDark ? "0 2px 10px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.03)",
      }}>
        {/* Left: Brand & Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${accent}, #f97316)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0, boxShadow: "0 2px 8px rgba(249,87,56,0.3)" }}>
            <Film size={16} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: -0.2, color: txt, lineHeight: 1.2 }}>Storyboard Studio</div>
            <div style={{ fontSize: 10, color: sub }}>Visual Consistency &amp; Shot Direction</div>
          </div>
        </div>

        {/* Center: 3-Step Stepper - Always Visible User Journey */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          {/* Step 1: AI Chat & Contact Sheet */}
          <div
            onClick={() => {
              setActiveStep(1);
              setCreationMode("chat");
            }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 14px", borderRadius: 20, cursor: "pointer",
              background: activeStep === 1 ? `${accent}18` : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"),
              border: `1px solid ${activeStep === 1 ? accent : border}`,
              color: activeStep === 1 ? accent : txt,
              fontWeight: activeStep === 1 ? 700 : 500,
              transition: "all 0.15s"
            }}
            title="Step 1: AI Chat, Character DNA & Contact Sheet"
          >
            <span style={{ width: 18, height: 18, borderRadius: "50%", background: activeStep === 1 ? accent : (activeSb ? "#22c55e" : (isDark ? "#333" : "#ddd")), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>
              {activeSb && activeStep !== 1 ? "✓" : "1"}
            </span>
            <span>1. AI Chat &amp; Contact Sheet</span>
          </div>

          <div style={{ color: sub, opacity: 0.4 }}>──</div>

          {/* Step 2: Lock Characters & Products */}
          <div
            onClick={() => {
              if (activeSb) {
                setActiveStep(2);
              } else {
                toast.info("Please create or select a project in Step 1 first");
              }
            }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 14px", borderRadius: 20, cursor: activeSb ? "pointer" : "not-allowed",
              background: activeStep === 2 ? `${accent}18` : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"),
              border: `1px solid ${activeStep === 2 ? accent : border}`,
              color: activeStep === 2 ? accent : (activeSb ? txt : sub),
              fontWeight: activeStep === 2 ? 700 : 500,
              opacity: activeSb ? 1 : 0.5,
              transition: "all 0.15s"
            }}
            title="Step 2: Lock Characters & Product DNA"
          >
            <span style={{ width: 18, height: 18, borderRadius: "50%", background: activeStep === 2 ? accent : ((chars.length + prods.length > 0 && chars.every(c => c.character_sheet?.is_approved) && prods.every(p => p.is_approved)) ? "#22c55e" : (isDark ? "#222" : "#eee")), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>
              {(chars.length + prods.length > 0 && chars.every(c => c.character_sheet?.is_approved) && prods.every(p => p.is_approved)) && activeStep !== 2 ? "✓" : "2"}
            </span>
            <span>2. Lock Characters &amp; Products ({chars.length + prods.length})</span>
          </div>

          <div style={{ color: sub, opacity: 0.4 }}>──</div>

          {/* Step 3: Direct Frames */}
          <div
            onClick={() => {
              if (activeSb) {
                setActiveStep(3);
              } else {
                toast.info("Please create or select a project in Step 1 first");
              }
            }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 14px", borderRadius: 20, cursor: activeSb ? "pointer" : "not-allowed",
              background: activeStep === 3 ? "rgba(124,58,237,0.15)" : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"),
              border: `1px solid ${activeStep === 3 ? "#7C3AED" : border}`,
              color: activeStep === 3 ? "#7C3AED" : (activeSb ? txt : sub),
              fontWeight: activeStep === 3 ? 700 : 500,
              opacity: activeSb ? 1 : 0.5,
              transition: "all 0.15s"
            }}
            title="Step 3: Direct Frames Studio (16:9 shots)"
          >
            <span style={{ width: 18, height: 18, borderRadius: "50%", background: activeStep === 3 ? "#7C3AED" : (isDark ? "#222" : "#eee"), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>
              3
            </span>
            <span>3. Direct Frames ({frames.length})</span>
          </div>
        </div>

        {/* Quick Back to Chat button when in Step 3 */}
        {activeStep === 3 && (
          <button
            onClick={() => {
              setActiveStep(1);
              setCreationMode("chat");
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 20,
              background: isDark ? "rgba(249,87,56,0.12)" : "rgba(249,87,56,0.08)",
              border: `1px solid ${accent}40`,
              color: accent,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.15s"
            }}
            onMouseOver={e => e.currentTarget.style.transform = "scale(1.03)"}
            onMouseOut={e => e.currentTarget.style.transform = "scale(1)"}
            title="Return to AI Chat & Contact Sheet screen"
          >
            <MessageSquare size={13} style={{ color: accent }} />
            <span>← Back to AI Chat</span>
          </button>
        )}

        {/* Proceed to Direct Frames Action in Navbar (When contact sheet is ready and not in Step 3) */}
        {activeStep !== 3 && (contactSheetUrl || activeSb?.contact_sheet_url) && (
          <button
            onClick={async () => {
              setActiveStep(3);
              if (activeSb?.id) {
                try {
                  const res = await api.post(`/api/storyboard/${activeSb.id}/sync-contact-sheet-frames`);
                  if (res.data?.frames) {
                    setFrames(res.data.frames);
                  }
                } catch (e) {
                  console.log("Sync on nav error:", e);
                }
              }
              toast.success("Direct frames synchronized with storyboard!");
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 20px",
              borderRadius: 20,
              background: "linear-gradient(135deg, #10b981, #059669)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              border: "none",
              boxShadow: "0 0 16px rgba(16,185,129,0.5)",
              transition: "all 0.15s",
            }}
            onMouseOver={e => e.currentTarget.style.transform = "scale(1.03)"}
            onMouseOut={e => e.currentTarget.style.transform = "scale(1)"}
          >
            <Sparkles size={14} /> Proceed to Direct Frames →
          </button>
        )}

        {/* Right: Project Switcher Dropdown & Chat Assistant Toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
          {/* Chat Assistant Drawer Toggle */}
          {activeSb && (
            <button
              onClick={() => setChatDrawerOpen(prev => !prev)}
              style={{
                ...btnGhost,
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 10,
                color: chatDrawerOpen ? accent : txt,
                background: chatDrawerOpen ? (isDark ? "rgba(249,87,56,0.15)" : "rgba(249,87,56,0.08)") : "transparent",
                border: `1px solid ${chatDrawerOpen ? accent : border}`,
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
              title="Toggle AI Chat Assistant"
            >
              <MessageSquare size={14} style={{ color: chatDrawerOpen ? accent : sub }} />
              <span>Assistant</span>
            </button>
          )}

          {/* Admin Impersonate Button */}
          {isAdmin && !impersonatedUser && (
            <button
              onClick={openImpersonationSwitcher}
              style={{
                ...btnGhost,
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 600,
                color: "#a855f7",
                borderColor: isDark ? "rgba(168,85,247,0.35)" : "rgba(168,85,247,0.4)",
                background: isDark ? "rgba(168,85,247,0.08)" : "rgba(168,85,247,0.05)",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
              title="Admin: Impersonate any user's storyboard"
            >
              <Eye size={14} style={{ color: "#a855f7" }} />
              <span>Impersonate</span>
            </button>
          )}

          {/* Project Switcher Dropdown Button */}
          <button
            onClick={() => setProjectDropdownOpen(prev => !prev)}
            style={{
              ...btnGhost,
              padding: "8px 16px", fontSize: 13, fontWeight: 700, color: txt,
              borderRadius: 10,
              background: projectDropdownOpen ? (isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)") : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)"),
              border: `1px solid ${border}`,
              display: "flex", alignItems: "center", gap: 8,
              boxShadow: isDark ? "0 2px 8px rgba(0,0,0,0.2)" : "0 2px 6px rgba(0,0,0,0.03)"
            }}
          >
            <Folder size={15} style={{ color: accent }} />
            <span style={{ maxWidth: 180, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {activeSb ? activeSb.name : `My Projects (${storyboards.length})`}
            </span>
            <ChevronDown size={14} style={{ transform: projectDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </button>

          {/* Project Dropdown Menu */}
          {projectDropdownOpen && (
            <div
              style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0,
                width: 290, background: card, border: `1px solid ${border}`,
                borderRadius: 12, boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
                padding: 8, display: "flex", flexDirection: "column", gap: 4, zIndex: 100
              }}
            >
              <div style={{ padding: "6px 8px 8px", borderBottom: `1px solid ${border}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>All Storyboards ({storyboards.length})</div>
                <div style={{ position: "relative" }}>
                  <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: sub }} />
                  <input
                    value={projectSearchQuery}
                    onChange={e => setProjectSearchQuery(e.target.value)}
                    placeholder="Search projects..."
                    style={{ ...inputStyle, padding: "5px 8px 5px 26px", fontSize: 11, borderRadius: 6 }}
                  />
                </div>
              </div>

              <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                {storyboards
                  .filter(sb => !projectSearchQuery || sb.name.toLowerCase().includes(projectSearchQuery.toLowerCase()))
                  .map(sb => (
                    <div
                      key={sb.id}
                      onClick={() => { selectStoryboard(sb); setProjectDropdownOpen(false); }}
                      style={{
                        padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                        background: activeSb?.id === sb.id ? (isDark ? "rgba(249,87,56,0.12)" : "rgba(249,87,56,0.08)") : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12,
                        transition: "background 0.12s"
                      }}
                      onMouseOver={e => { if (activeSb?.id !== sb.id) e.currentTarget.style.background = isDark ? "#252525" : "#f3f3f3"; }}
                      onMouseOut={e => { if (activeSb?.id !== sb.id) e.currentTarget.style.background = "transparent"; }}
                    >
                      <div style={{ minWidth: 0, flex: 1, marginRight: 8 }}>
                        <div style={{ fontWeight: activeSb?.id === sb.id ? 700 : 500, color: activeSb?.id === sb.id ? accent : txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {sb.name}
                        </div>
                        <div style={{ fontSize: 10, color: sub }}>{sb.frame_count || 0} frames</div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); deleteSb(sb.id); }}
                        style={{ background: "none", border: "none", color: sub, cursor: "pointer", padding: 4 }}
                        onMouseOver={e => e.currentTarget.style.color = "#ef4444"}
                        onMouseOut={e => e.currentTarget.style.color = sub}
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  ))}
              </div>

              <div style={{ borderTop: `1px solid ${border}`, paddingTop: 6, marginTop: 4 }}>
                <button
                  onClick={() => { setActiveSb(null); setActiveStep(1); setProjectDropdownOpen(false); }}
                  style={{ ...btnPrimary, width: "100%", justifyContent: "center", padding: "6px 0", fontSize: 11, borderRadius: 6 }}
                >
                  <Plus size={13} /> Create New Storyboard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ MAIN WORKSPACE BODY ═══ */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

        {/* ═══ STEP 1: SETUP & CREATIVE BRIEF ═══ */}
        {activeStep === 1 && (
          creationMode === "chat" ? (
            /* ═══ DEDICATED SMART CHAT SCREEN ═══ */
            <div style={{
              flex: 1,
              width: "100%",
              height: "100%",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              background: bg,
              overflow: "hidden",
            }}>
              {/* Top Sub-Bar: Back Button & Storyboard Status */}
              <div style={{
                width: "100%",
                padding: "8px 24px",
                borderBottom: `1px solid ${border}`,
                background: isDark ? "rgba(20, 20, 20, 0.95)" : "rgba(255, 255, 255, 0.95)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexShrink: 0,
                position: "sticky",
                top: 0,
                zIndex: 90
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={() => {
                      setActiveSb(null);
                      setFrames([]);
                      setChars([]);
                      setProds([]);
                      setContactSheetUrl(null);
                      setChatMessages([]);
                      setActiveStep(1);
                      setCreationMode("chat");
                      setStoryboardModel("Nanobanana 2");
                    }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "6px 12px", borderRadius: 8, border: `1px solid ${border}`,
                      background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
                      color: txt, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      transition: "all 0.15s"
                    }}
                    title="Start a new storyboard chat session"
                  >
                    <Plus size={14} style={{ color: accent }} /> New Storyboard
                  </button>

                  {/* Model Selector Dropdown */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 8,
                    background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
                    border: `1px solid ${border}`,
                  }}>
                    <Sparkles size={13} style={{ color: accent }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: sub }}>Model:</span>
                    <select
                      value={storyboardModel}
                      onChange={(e) => setStoryboardModel(e.target.value)}
                      style={{
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        color: txt,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        padding: "1px 2px",
                      }}
                      title="Primary image generation model for characters, products & storyboard panels"
                    >
                      <option value="Nanobanana 2" style={{ background: isDark ? "#1a1a1a" : "#ffffff", color: txt }}>Nanobanana 2 (Default)</option>
                      <option value="ChatGPT" style={{ background: isDark ? "#1a1a1a" : "#ffffff", color: txt }}>ChatGPT (GPT Image 1.5)</option>
                      <option value="Nanobanana Pro" style={{ background: isDark ? "#1a1a1a" : "#ffffff", color: txt }}>Nanobanana Pro</option>
                    </select>
                  </div>

                  {activeSb && (
                    <div style={{ fontSize: 12, color: sub, display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 8, background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                      <span style={{ color: txt, fontWeight: 700 }}>{activeSb.name}</span>
                    </div>
                  )}
                </div>

                {/* Interactive User Journey Milestones */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 14,
                    background: (chars.length > 0 || prods.length > 0) ? "rgba(16,185,129,0.12)" : `${accent}15`,
                    color: (chars.length > 0 || prods.length > 0) ? "#10b981" : accent,
                    fontWeight: 700, border: `1px solid ${(chars.length > 0 || prods.length > 0) ? "rgba(16,185,129,0.3)" : `${accent}30`}`
                  }}>
                    <span>{(chars.length > 0 || prods.length > 0) ? "✓" : "1"}</span>
                    <span>Brief &amp; DNA</span>
                  </div>

                  <span style={{ color: sub, opacity: 0.5 }}>→</span>

                  <div
                    onClick={() => {
                      if (chars.length > 0 || prods.length > 0) setActiveStep(2);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "4px 10px", borderRadius: 14,
                      background: (chars.length > 0 && chars.every(c => c.character_sheet?.is_approved)) ? "rgba(16,185,129,0.12)" : (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"),
                      color: (chars.length > 0 && chars.every(c => c.character_sheet?.is_approved)) ? "#10b981" : ((chars.length > 0 || prods.length > 0) ? txt : sub),
                      fontWeight: 600, border: `1px solid ${border}`,
                      cursor: (chars.length > 0 || prods.length > 0) ? "pointer" : "default"
                    }}
                    title={chars.length > 0 ? "Click to view Character & Product Bible (Step 2)" : "Extracted once brief is analyzed"}
                  >
                    <span>{(chars.length > 0 && chars.every(c => c.character_sheet?.is_approved)) ? "✓" : "2"}</span>
                    <span>Entity Visuals ({chars.length + prods.length})</span>
                  </div>

                  <span style={{ color: sub, opacity: 0.5 }}>→</span>

                  <div style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 14,
                    background: (contactSheetUrl || activeSb?.contact_sheet_url) ? "rgba(16,185,129,0.12)" : (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"),
                    color: (contactSheetUrl || activeSb?.contact_sheet_url) ? "#10b981" : sub,
                    fontWeight: 600, border: `1px solid ${border}`
                  }}>
                    <span>{(contactSheetUrl || activeSb?.contact_sheet_url) ? "✓" : "3"}</span>
                    <span>Contact Sheet</span>
                  </div>

                  <span style={{ color: sub, opacity: 0.5 }}>→</span>

                  <div
                    onClick={() => {
                      if (activeSb) setActiveStep(3);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "4px 10px", borderRadius: 14,
                      background: (frames.length > 0) ? "rgba(124,58,237,0.15)" : (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"),
                      color: (frames.length > 0) ? "#a855f7" : sub,
                      fontWeight: 600, border: `1px solid ${border}`,
                      cursor: activeSb ? "pointer" : "default"
                    }}
                    title={activeSb ? "Click to view Direct Frames Studio (Step 3)" : "Available when storyboard is created"}
                  >
                    <span>4</span>
                    <span>Direct Frames ({frames.length})</span>
                  </div>
                </div>

                {/* Right side: Quick Jump to Step 2 or Step 3 */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {chars.length > 0 && (
                    <button
                      onClick={() => setActiveStep(2)}
                      style={{
                        ...btnGhost,
                        padding: "6px 12px", fontSize: 12, borderRadius: 8,
                        display: "inline-flex", alignItems: "center", gap: 5
                      }}
                      title="Inspect & approve 3-view character references"
                    >
                      <Users size={13} /> Review Bible ({chars.length})
                    </button>
                  )}
                  {(contactSheetUrl || activeSb?.contact_sheet_url) && (
                    <button
                      onClick={async () => {
                        setActiveStep(3);
                        if (activeSb?.id) {
                          try {
                            const res = await api.post(`/api/storyboard/${activeSb.id}/sync-contact-sheet-frames`);
                            if (res.data?.frames) {
                              setFrames(res.data.frames);
                            }
                          } catch (e) {
                            console.log("Sync error:", e);
                          }
                        }
                      }}
                      style={{
                        ...btnPrimary,
                        background: "linear-gradient(135deg, #10b981, #059669)",
                        padding: "6px 16px", fontSize: 12, borderRadius: 20,
                        boxShadow: "0 2px 10px rgba(16,185,129,0.35)"
                      }}
                    >
                      <Sparkles size={13} /> Proceed to Direct Frames →
                    </button>
                  )}
                </div>
              </div>

              {/* Hidden file input for paperclip upload (accepts images, PDFs, text) */}
              <input
                ref={chatFileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md"
                style={{ display: "none" }}
                onChange={handleChatFileUpload}
              />

              {/* ── 100% Full-Width Scrollable Chat Feed (scrolls anywhere on whitespace, no middle scrollbar) ── */}
              <div
                className="no-scrollbar"
                style={{
                  flex: 1,
                  minHeight: 0,
                  width: "100%",
                  overflowY: "auto",
                  overflowX: "hidden",
                  overscrollBehavior: "contain",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "16px 20px 8px",
                  scrollbarWidth: "none",
                  msOverflowStyle: "none",
                }}
              >
                {/* Centered Message Column (840px max width) */}
                <div style={{
                  width: "100%",
                  maxWidth: 840,
                  display: "flex",
                  flexDirection: "column",
                  gap: 20
                }}>
                    {/* If no messages yet and not loading, show center Hero content */}
                    {chatMessages.length === 0 && !chatSubmitting && !chatContactSheetLoading ? (
                      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, margin: "auto", maxWidth: 780 }}>
                        <div style={{ width: 52, height: 52, borderRadius: 16, background: `linear-gradient(135deg, ${accent}, #f97316)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 8px 24px rgba(249,87,56,0.35)" }}>
                          <Film size={26} />
                        </div>
                        <div>
                          <h1 style={{ fontSize: 26, fontWeight: 800, color: txt, margin: "0 0 6px", letterSpacing: -0.5 }}>
                            Smart Storyboard Assistant
                          </h1>
                          <p style={{ fontSize: 13, color: sub, margin: 0, maxWidth: 540, lineHeight: 1.6 }}>
                            A guided workflow from your initial creative brief to locked character DNA, numbered contact sheets, and direct 16:9 cinematic shot direction.
                          </p>
                        </div>

                        {/* 4-Step User Journey Visual Roadmap */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, width: "100%", textAlign: "left" }}>
                          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: accent }}>
                              <span style={{ width: 20, height: 20, borderRadius: "50%", background: `${accent}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>1</span>
                              <span>Chat Brief &amp; PDF</span>
                            </div>
                            <div style={{ fontSize: 11, color: sub, lineHeight: 1.45 }}>
                              Type your idea or attach PDFs/images. AI extracts story scenes &amp; shot requirements.
                            </div>
                          </div>
                          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: "#3b82f6" }}>
                              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(59,130,246,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>2</span>
                              <span>DNA &amp; Visual Looks</span>
                            </div>
                            <div style={{ fontSize: 11, color: sub, lineHeight: 1.45 }}>
                              AI extracts rich Physical, Costume, Voice, &amp; Behavioral DNA with reference portraits.
                            </div>
                          </div>
                          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: "#10b981" }}>
                              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(16,185,129,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>3</span>
                              <span>Numbered Contact Sheet</span>
                            </div>
                            <div style={{ fontSize: 11, color: sub, lineHeight: 1.45 }}>
                              16:9 film stills synthesized with FRAME 1..N badges guaranteeing character wardrobe consistency.
                            </div>
                          </div>
                          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 12, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: "#8b5cf6" }}>
                              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(139,92,246,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>4</span>
                              <span>Direct Frames Studio</span>
                            </div>
                            <div style={{ fontSize: 11, color: sub, lineHeight: 1.45 }}>
                              Jump straight into the 16:9 timeline canvas to fine-tune prompts, re-roll, and export.
                            </div>
                          </div>
                        </div>

                        {/* Quick Prompts */}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 4, width: "100%" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: sub }}>Click an example to start your storyboard:</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                            {[
                              "☕ Cinematic artisanal coffee commercial featuring Elena preparing an espresso",
                              "🚗 Cyberpunk night drive through neon-lit rain with protagonist Alex",
                              "🧴 Luxury skincare serum commercial highlighting glass bottle textures and morning sunlight"
                            ].map((sample, sIdx) => (
                              <button
                                key={sIdx}
                                onClick={() => setChatPromptText(sample)}
                                style={{
                                  fontSize: 11, padding: "7px 14px", borderRadius: 14,
                                  background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                                  border: `1px solid ${border}`, color: txt, cursor: "pointer",
                                  transition: "all 0.15s"
                                }}
                                onMouseOver={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; }}
                                onMouseOut={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = txt; }}
                              >
                                {sample}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        {chatMessages
                          .filter((msg: any) => !msg.content?.startsWith("✨ Generated visual reference for"))
                          .map((msg: any, mIdx: number) => (
                          <div key={msg.id || mIdx} style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                            {/* User Message Bubble */}
                            {msg.role === "user" ? (
                              <div style={{
                                maxWidth: "75%",
                                background: `linear-gradient(135deg, ${accent}, #ea580c)`,
                                color: "#fff",
                                padding: "12px 18px",
                                borderRadius: "18px 18px 4px 18px",
                                fontSize: 13, lineHeight: 1.5,
                                boxShadow: "0 4px 14px rgba(249,87,56,0.25)"
                              }}>
                                {/* User Uploaded Reference Image Previews */}
                                {((msg.image_urls && msg.image_urls.length > 0) || (msg.images && msg.images.length > 0)) && (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                                    {(msg.image_urls || msg.images || []).map((imgUrl: string, imgIdx: number) => (
                                      <div
                                        key={imgIdx}
                                        style={{
                                          width: 100,
                                          height: 100,
                                          borderRadius: 10,
                                          overflow: "hidden",
                                          border: "2px solid rgba(255,255,255,0.7)",
                                          background: "rgba(0,0,0,0.2)",
                                          boxShadow: "0 3px 10px rgba(0,0,0,0.25)",
                                          cursor: "pointer",
                                          flexShrink: 0,
                                        }}
                                        onClick={() => window.open(getSafeImageUrl(imgUrl), "_blank")}
                                        title="Click to view full image in new tab"
                                      >
                                        <img
                                          src={getSafeImageUrl(imgUrl)}
                                          alt="Uploaded reference"
                                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div>{msg.content}</div>
                                {msg.files && msg.files.length > 0 && !msg.image_urls?.length && !msg.images?.length && (
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
                                    {msg.files.map((fn: string, fi: number) => (
                                      <span key={fi} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 4 }}>
                                        {fn.toLowerCase().endsWith(".pdf") ? "📄" : "📎"} {fn}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              /* Assistant Message Bubble */
                              <div style={{
                                width: "100%",
                                background: card,
                                border: `1px solid ${border}`,
                                borderRadius: 18,
                                padding: "18px 20px",
                                boxShadow: isDark ? "0 4px 20px rgba(0,0,0,0.4)" : "0 4px 14px rgba(0,0,0,0.04)",
                                display: "flex", flexDirection: "column", gap: 14
                              }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ width: 26, height: 26, borderRadius: 8, background: `${accent}18`, display: "flex", alignItems: "center", justifyContent: "center", color: accent }}>
                                    <Sparkles size={14} />
                                  </div>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: txt }}>Genfy Storyboard AI</span>
                                </div>

                                <div style={{ fontSize: 13, color: txt, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                                  {msg.content}
                                </div>

                                {/* Logline badge */}
                                {msg.story_logline && (
                                  <div style={{ padding: "8px 12px", borderRadius: 8, background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", border: `1px solid ${border}`, fontSize: 12, color: sub }}>
                                    <b style={{ color: txt }}>Story Logline:</b> {msg.story_logline}
                                  </div>
                                )}

                                {/* Characters Section - Full View Visual Cards */}
                                 {(() => {
                                   const validChars = (msg.characters || []).filter((c: any) => {
                                     const name = (c?.name || "").trim();
                                     return name.length > 0 && !["none", "n/a", "character", "untitled"].includes(name.toLowerCase());
                                   });
                                   if (validChars.length === 0) return null;

                                   return (
                                     <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                                       <div style={{ fontSize: 11, fontWeight: 800, color: accent, textTransform: "uppercase", letterSpacing: 0.5 }}>
                                         👥 Character Visual Reference
                                       </div>
                                       <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                                         {validChars.map((c: any) => {
                                           const liveChar = chars.find(x => x.id === c.id) || c;
                                           const isGenerating = generatingEntityIds.includes(liveChar.id) || chatGeneratingEntityId === liveChar.id;

                                           return (
                                             <div
                                               key={liveChar.id}
                                               style={{
                                                 width: 220,
                                                 background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                                                 border: `1px solid ${border}`,
                                                 borderRadius: 14,
                                                 overflow: "hidden",
                                                 display: "flex",
                                                 flexDirection: "column",
                                                 boxShadow: isDark ? "0 4px 16px rgba(0,0,0,0.25)" : "0 2px 8px rgba(0,0,0,0.04)"
                                               }}
                                             >
                                               {/* Full Portrait View */}
                                               <div style={{
                                                 width: "100%",
                                                 height: 280,
                                                 background: isDark ? "#121212" : "#f1f1f1",
                                                 borderBottom: `1px solid ${border}`,
                                                 display: "flex",
                                                 alignItems: "center",
                                                 justifyContent: "center",
                                                 position: "relative",
                                                 overflow: "hidden"
                                               }}>
                                                 {isGenerating ? (
                                                   <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 12, textAlign: "center" }}>
                                                     <RefreshCw size={22} className="animate-spin" style={{ color: accent }} />
                                                     <span style={{ fontSize: 11, color: sub, fontWeight: 600 }}>Generating look...</span>
                                                   </div>
                                                 ) : liveChar.image_path ? (
                                                   <img
                                                     src={liveChar.image_path.startsWith("http") ? liveChar.image_path : `${API}/${liveChar.image_path}`}
                                                     alt={liveChar.name}
                                                     style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                                   />
                                                 ) : (
                                                   <button
                                                     onClick={() => handleGenerateSingleEntityVisual("character", liveChar.id)}
                                                     style={{
                                                       ...btnGhost,
                                                       padding: "8px 14px",
                                                       borderRadius: 8,
                                                       flexDirection: "column",
                                                       gap: 4,
                                                       border: `1px dashed ${accent}60`,
                                                       color: accent
                                                     }}
                                                   >
                                                     <Sparkles size={16} />
                                                     <span style={{ fontSize: 11, fontWeight: 600 }}>Generate Visual</span>
                                                   </button>
                                                 )}
                                               </div>

                                               {/* Clean label: Name only */}
                                               <div style={{ padding: "10px 12px 12px 12px", textAlign: "center" }}>
                                                 <div style={{ fontSize: 14, fontWeight: 700, color: txt }}>{liveChar.name}</div>
                                                 <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>Lead Character</div>
                                               </div>
                                             </div>
                                           );
                                         })}
                                       </div>
                                       <div style={{ fontSize: 11, color: sub, fontStyle: "italic" }}>
                                         💡 To adjust any character look, type in chat (e.g. "Update Elena: make her wear a black dress").
                                       </div>
                                     </div>
                                   );
                                 })()}

                                 {/* Products Section - Full View Visual Cards */}
                                 {(() => {
                                   const validProds = (msg.products || []).filter((p: any) => {
                                     const name = (p?.name || "").trim();
                                     return name.length > 0 && !["none", "n/a", "product", "prop", "untitled"].includes(name.toLowerCase());
                                   });
                                   if (validProds.length === 0) return null;

                                   return (
                                     <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
                                       <div style={{ fontSize: 11, fontWeight: 800, color: "#8B5CF6", textTransform: "uppercase", letterSpacing: 0.5 }}>
                                         📦 Props &amp; Products Reference
                                       </div>
                                       <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                                         {validProds.map((p: any) => {
                                           const liveProd = prods.find(x => x.id === p.id) || p;
                                           const dna = liveProd.product_dna || {};
                                           const isGenerating = generatingEntityIds.includes(liveProd.id) || chatGeneratingEntityId === liveProd.id;

                                           return (
                                             <div
                                               key={liveProd.id}
                                               style={{
                                                 width: 200,
                                                 background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                                                 border: `1px solid ${border}`,
                                                 borderRadius: 14,
                                                 overflow: "hidden",
                                                 display: "flex",
                                                 flexDirection: "column",
                                                 boxShadow: isDark ? "0 4px 16px rgba(0,0,0,0.25)" : "0 2px 8px rgba(0,0,0,0.04)"
                                               }}
                                             >
                                               {/* Full Square View */}
                                               <div style={{
                                                 width: "100%",
                                                 height: 200,
                                                 background: isDark ? "#121212" : "#f1f1f1",
                                                 borderBottom: `1px solid ${border}`,
                                                 display: "flex",
                                                 alignItems: "center",
                                                 justifyContent: "center",
                                                 position: "relative",
                                                 overflow: "hidden"
                                               }}>
                                                 {isGenerating ? (
                                                   <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 12, textAlign: "center" }}>
                                                     <RefreshCw size={22} className="animate-spin" style={{ color: "#8B5CF6" }} />
                                                     <span style={{ fontSize: 11, color: sub, fontWeight: 600 }}>Generating look...</span>
                                                   </div>
                                                 ) : liveProd.image_path ? (
                                                   <img
                                                     src={liveProd.image_path.startsWith("http") ? liveProd.image_path : `${API}/${liveProd.image_path}`}
                                                     alt={liveProd.name}
                                                     style={{ width: "100%", height: "100%", objectFit: "contain", padding: 12, display: "block" }}
                                                   />
                                                 ) : (
                                                   <button
                                                     onClick={() => handleGenerateSingleEntityVisual("product", liveProd.id)}
                                                     style={{
                                                       ...btnGhost,
                                                       padding: "8px 14px",
                                                       borderRadius: 8,
                                                       flexDirection: "column",
                                                       gap: 4,
                                                       border: "1px dashed rgba(139,92,246,0.6)",
                                                       color: "#8B5CF6"
                                                     }}
                                                   >
                                                     <Sparkles size={16} />
                                                     <span style={{ fontSize: 11, fontWeight: 600 }}>Generate Visual</span>
                                                   </button>
                                                 )}
                                               </div>

                                               {/* Clean label: Name only */}
                                               <div style={{ padding: "10px 12px 12px 12px", textAlign: "center" }}>
                                                 <div style={{ fontSize: 13, fontWeight: 700, color: txt }}>{liveProd.name}</div>
                                                 <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>{dna.category || "Key Prop"}</div>
                                               </div>
                                             </div>
                                           );
                                         })}
                                       </div>
                                     </div>
                                   );
                                 })()}

                                 {/* Single Modified Entity Display - Full View Visual */}
                                 {Boolean(msg.modified_entity && msg.modified_entity.name && msg.modified_entity.name.trim().length > 0) && (
                                   <div style={{
                                     display: "flex",
                                     flexDirection: "column",
                                     gap: 10,
                                     marginTop: 4,
                                     padding: 12,
                                     borderRadius: 14,
                                     background: isDark ? "rgba(16,185,129,0.06)" : "rgba(16,185,129,0.04)",
                                     border: "1px solid rgba(16,185,129,0.3)",
                                   }}>
                                     <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: "#10b981", textTransform: "uppercase" }}>
                                       <Sparkles size={13} /> Updated {msg.modified_entity.type === "character" ? "Character" : "Prop"} Visual Look
                                     </div>
                                     <div style={{
                                       width: msg.modified_entity.type === "character" ? 220 : 200,
                                       background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                                       border: `1px solid ${border}`,
                                       borderRadius: 14,
                                       overflow: "hidden",
                                       display: "flex",
                                       flexDirection: "column"
                                     }}>
                                       <div style={{
                                         width: "100%",
                                         height: msg.modified_entity.type === "character" ? 280 : 200,
                                         background: isDark ? "#121212" : "#f1f1f1",
                                         borderBottom: `1px solid ${border}`,
                                         display: "flex",
                                         alignItems: "center",
                                         justifyContent: "center",
                                         overflow: "hidden"
                                       }}>
                                         {msg.modified_entity.image_path ? (
                                           <img
                                             src={msg.modified_entity.image_path.startsWith("http") ? msg.modified_entity.image_path : `${API}/${msg.modified_entity.image_path}`}
                                             alt={msg.modified_entity.name}
                                             style={{
                                               width: "100%",
                                               height: "100%",
                                               objectFit: msg.modified_entity.type === "character" ? "cover" : "contain",
                                               padding: msg.modified_entity.type === "character" ? 0 : 12,
                                               display: "block"
                                             }}
                                           />
                                         ) : (
                                           <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: sub, fontSize: 11 }}>No image</div>
                                         )}
                                       </div>
                                       <div style={{ padding: "10px 12px", textAlign: "center" }}>
                                         <div style={{ fontSize: 13, fontWeight: 700, color: txt }}>{msg.modified_entity.name}</div>
                                         <div style={{ fontSize: 11, color: "#10b981", fontWeight: 600, marginTop: 2 }}>✓ Updated Look</div>
                                       </div>
                                     </div>
                                   </div>
                                 )}

                                 {/* Claude-Style Clarification Card: Marketing & Story Direction */}
                                 {Boolean(msg.clarification_card || (msg.marketing_angles && msg.marketing_angles.length > 0)) && (
                                   <div style={{
                                     marginTop: 12,
                                     marginBottom: 8,
                                     borderRadius: 14,
                                     border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`,
                                     background: isDark ? "rgba(24,24,28,0.95)" : "#ffffff",
                                     boxShadow: isDark ? "0 4px 20px rgba(0,0,0,0.4)" : "0 4px 18px rgba(0,0,0,0.06)",
                                     overflow: "hidden"
                                   }}>
                                     {/* Header */}
                                     <div style={{
                                       padding: "14px 18px 10px",
                                       borderBottom: `1px solid ${border}`,
                                       display: "flex",
                                       alignItems: "flex-start",
                                       justifyContent: "space-between",
                                       gap: 12
                                     }}>
                                       <div>
                                         <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                           <span style={{ fontSize: 13, fontWeight: 800, color: txt }}>
                                             {msg.clarification_card?.title || "Select Story & Marketing Direction"}
                                           </span>
                                           <span style={{
                                             fontSize: 10,
                                             fontWeight: 800,
                                             padding: "2px 7px",
                                             borderRadius: 6,
                                             background: `${accent}20`,
                                             color: accent,
                                             letterSpacing: 0.5
                                           }}>
                                             CREATIVE ANGLE
                                           </span>
                                         </div>
                                         <div style={{ fontSize: 11, color: sub, lineHeight: 1.4 }}>
                                           {msg.clarification_card?.subtitle || "Choose a marketing angle or customize your direction before generating contact sheet:"}
                                         </div>
                                       </div>
                                     </div>

                                     {/* Options List */}
                                     <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                                       {(msg.clarification_card?.options || msg.marketing_angles || []).map((opt: any, optIdx: number) => {
                                         const isChosen = (msg.clarification_card?.selected_angle_id === opt.id) ||
                                                          (msg.clarification_card?.selected_angle_title === opt.title) ||
                                                          (msg.marketing_angle === opt.title);
                                         return (
                                           <div
                                             key={opt.id || optIdx}
                                             onClick={() => !selectingAngle && !chatContactSheetLoading && handleSelectMarketingAngle(opt)}
                                             style={{
                                               display: "flex",
                                               alignItems: "center",
                                               justifyContent: "space-between",
                                               padding: "10px 14px",
                                               borderRadius: 10,
                                               border: `1px solid ${isChosen ? accent : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)")}`,
                                               background: isChosen ? (isDark ? `${accent}18` : `${accent}0c`) : (isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)"),
                                               cursor: (selectingAngle || chatContactSheetLoading) ? "not-allowed" : "pointer",
                                               transition: "all 0.15s ease",
                                               opacity: (selectingAngle || chatContactSheetLoading) ? 0.7 : 1
                                             }}
                                             onMouseOver={(e) => {
                                               if (!isChosen && !selectingAngle && !chatContactSheetLoading) {
                                                 e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.035)";
                                                 e.currentTarget.style.borderColor = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)";
                                               }
                                             }}
                                             onMouseOut={(e) => {
                                               if (!isChosen) {
                                                 e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)";
                                                 e.currentTarget.style.borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
                                               }
                                             }}
                                           >
                                             <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, marginRight: 10 }}>
                                               {/* Number Badge */}
                                               <div style={{
                                                 width: 22, height: 22, borderRadius: 6,
                                                 background: isChosen ? accent : (isDark ? "#2a2a2e" : "#e5e7eb"),
                                                 color: isChosen ? "#fff" : sub,
                                                 display: "flex", alignItems: "center", justifyContent: "center",
                                                 fontSize: 11, fontWeight: 800, flexShrink: 0, marginTop: 1
                                               }}>
                                                 {isChosen ? <Check size={12} strokeWidth={3} /> : optIdx + 1}
                                               </div>
                                               <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                                 <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                   <span style={{ fontSize: 13, fontWeight: 700, color: isChosen ? accent : txt }}>
                                                     {opt.title}
                                                   </span>
                                                   {opt.tone && (
                                                     <span style={{
                                                       fontSize: 10,
                                                       fontWeight: 600,
                                                       padding: "1px 6px",
                                                       borderRadius: 4,
                                                       background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                                                       color: sub
                                                     }}>
                                                       {opt.tone}
                                                     </span>
                                                   )}
                                                 </div>
                                                 {opt.description && (
                                                   <div style={{ fontSize: 11, color: sub, lineHeight: 1.4 }}>
                                                     {opt.description}
                                                   </div>
                                                 )}
                                               </div>
                                             </div>

                                             <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                               {isChosen ? (
                                                 <span style={{ fontSize: 11, fontWeight: 700, color: accent }}>Selected ✓</span>
                                               ) : (
                                                 <ArrowRight size={14} style={{ color: sub }} />
                                               )}
                                             </div>
                                           </div>
                                         );
                                       })}

                                       {/* Custom Angle Input Row */}
                                       <div style={{
                                         display: "flex",
                                         alignItems: "center",
                                         gap: 8,
                                         padding: "8px 12px",
                                         borderRadius: 10,
                                         border: `1px solid ${border}`,
                                         background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                                         marginTop: 4
                                       }}>
                                         <Pencil size={13} style={{ color: sub, flexShrink: 0 }} />
                                         <input
                                           type="text"
                                           value={customAngleInput}
                                           onChange={(e) => setCustomAngleInput(e.target.value)}
                                           onKeyDown={(e) => {
                                             if (e.key === "Enter" && customAngleInput.trim() && !selectingAngle && !chatContactSheetLoading) {
                                               handleSelectMarketingAngle({
                                                 id: "custom",
                                                 title: customAngleInput.trim(),
                                                 custom_instruction: customAngleInput.trim()
                                               });
                                             }
                                           }}
                                           placeholder="Something else... (e.g. fast Gen-Z viral comedy with sharp switch twist)"
                                           style={{
                                             flex: 1,
                                             background: "transparent",
                                             border: "none",
                                             outline: "none",
                                             fontSize: 12,
                                             color: txt
                                           }}
                                         />
                                         <button
                                           onClick={() => {
                                             if (customAngleInput.trim() && !selectingAngle && !chatContactSheetLoading) {
                                               handleSelectMarketingAngle({
                                                 id: "custom",
                                                 title: customAngleInput.trim(),
                                                 custom_instruction: customAngleInput.trim()
                                               });
                                             }
                                           }}
                                           disabled={!customAngleInput.trim() || selectingAngle || chatContactSheetLoading}
                                           style={{
                                             ...btnPrimary,
                                             padding: "5px 12px",
                                             fontSize: 11,
                                             borderRadius: 6,
                                             opacity: (!customAngleInput.trim() || selectingAngle || chatContactSheetLoading) ? 0.4 : 1,
                                             cursor: (!customAngleInput.trim() || selectingAngle || chatContactSheetLoading) ? "not-allowed" : "pointer"
                                           }}
                                         >
                                           <span>Use Custom</span>
                                           <ArrowRight size={12} />
                                         </button>
                                       </div>

                                       {/* Skip / Auto-direct */}
                                       <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
                                         <button
                                           onClick={() => {
                                             if (!selectingAngle && !chatContactSheetLoading) {
                                               triggerGenerateContactSheet(smartFrameCount || 6, activeSb);
                                             }
                                           }}
                                           style={{
                                             ...btnGhost,
                                             padding: "4px 10px",
                                             fontSize: 11,
                                             color: sub,
                                             borderColor: "transparent"
                                           }}
                                         >
                                           <span>Auto-direct (Skip) →</span>
                                         </button>
                                       </div>
                                     </div>
                                   </div>
                                 )}

                                 {/* Gated Flow: CTA to generate storyboard contact sheet (if no clarification card) */}
                                 {Boolean((msg.intent === "new_story" || (msg.characters && msg.characters.length > 0) || msg.modified_entity) && !contactSheetUrl && !chatContactSheetLoading && !msg.clarification_card && !(msg.marketing_angles && msg.marketing_angles.length > 0)) && (
                                   <div style={{
                                     marginTop: 10,
                                     padding: "14px 16px",
                                     borderRadius: 12,
                                     background: isDark ? "rgba(249,87,56,0.08)" : "rgba(249,87,56,0.05)",
                                     border: "1px dashed rgba(249,87,56,0.4)",
                                     display: "flex",
                                     alignItems: "center",
                                     justifyContent: "space-between",
                                     flexWrap: "wrap",
                                     gap: 10
                                   }}>
                                     <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                       <div style={{ fontSize: 13, fontWeight: 700, color: txt }}>
                                         Ready for Storyboard Generation?
                                      </div>
                                      <div style={{ fontSize: 11, color: sub }}>
                                        Refine character looks above or proceed to generate your {smartFrameCount || 6}-panel contact sheet.
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => {
                                        setTempFrameCount(smartFrameCount || 6);
                                        setShowFrameCountPopup(true);
                                      }}
                                      style={{
                                        ...btnPrimary,
                                        background: `linear-gradient(135deg, ${accent}, #ea580c)`,
                                        padding: "8px 18px",
                                        fontSize: 12,
                                        borderRadius: 8,
                                        boxShadow: "0 4px 14px rgba(249,87,56,0.35)",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        cursor: "pointer"
                                      }}
                                    >
                                      <Sparkles size={14} /> Generate Storyboard Contact Sheet →
                                    </button>
                                  </div>
                                )}

                                {/* Contact Sheet Preview Section */}
                                {Boolean(msg.contact_sheet_url) && (
                                  <div style={{
                                    display: "flex", flexDirection: "column", gap: 12, marginTop: 8,
                                    padding: 16, borderRadius: 14, background: isDark ? "rgba(16,185,129,0.06)" : "rgba(16,185,129,0.04)",
                                    border: "1px solid rgba(16,185,129,0.3)"
                                  }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                      <div style={{ fontSize: 12, fontWeight: 800, color: "#10b981", textTransform: "uppercase", letterSpacing: 0.5 }}>
                                        🎬 Unified Storyboard Contact Sheet ({msg.frame_count || smartFrameCount} Panels)
                                      </div>
                                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#10b98120", color: "#10b981", fontWeight: 700 }}>
                                        Numbered 1 to {msg.frame_count || smartFrameCount}
                                      </span>
                                    </div>

                                    {/* The Image */}
                                    <div style={{ width: "100%", borderRadius: 10, overflow: "hidden", border: `1px solid ${border}`, background: "#0a0a0a" }}>
                                      <img
                                        src={getSafeImageUrl(msg.contact_sheet_url)}
                                        alt="Storyboard Contact Sheet"
                                        style={{ width: "100%", maxHeight: 380, objectFit: "contain", display: "block" }}
                                      />
                                    </div>

                                    {/* Scenes Breakdown */}
                                    {msg.scenes && msg.scenes.length > 0 && (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: txt }}>Scenes Breakdown:</div>
                                        {msg.scenes.map((sc: any, sci: number) => (
                                          <div key={sci} style={{ fontSize: 11, color: sub, padding: "4px 8px", borderRadius: 6, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)" }}>
                                            <b style={{ color: txt }}>Panel {sc.frame_number || sci + 1}:</b> {sc.scene_prompt || sc.scene_title}
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {/* Call to Action to enter Step 3 or Step 2 */}
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8, gap: 10, flexWrap: "wrap" }}>
                                      {chars.length > 0 ? (
                                        <button
                                          onClick={() => setActiveStep(2)}
                                          style={{
                                            ...btnGhost,
                                            padding: "8px 14px", fontSize: 12, borderRadius: 8,
                                            display: "inline-flex", alignItems: "center", gap: 6,
                                            borderColor: "rgba(16,185,129,0.3)"
                                          }}
                                          title="Review & approve 3-view character turnarounds"
                                        >
                                          <Users size={14} /> Review Character Bible (Step 2)
                                        </button>
                                      ) : <div />}

                                      <button
                                        onClick={async () => {
                                          setActiveStep(3);
                                          if (activeSb?.id) {
                                            try {
                                              const res = await api.post(`/api/storyboard/${activeSb.id}/sync-contact-sheet-frames`);
                                              if (res.data?.frames) {
                                                setFrames(res.data.frames);
                                              }
                                            } catch (e) {
                                              console.log("Sync error:", e);
                                            }
                                          }
                                        }}
                                        style={{
                                          ...btnPrimary,
                                          background: "linear-gradient(135deg, #10b981, #059669)",
                                          padding: "10px 22px", fontSize: 13, borderRadius: 10,
                                          boxShadow: "0 4px 16px rgba(16,185,129,0.35)"
                                        }}
                                      >
                                        <Sparkles size={15} /> Proceed to Direct Frames (Synced) →
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}

                        {/* ── Semi-visible single line status indicator ── */}
                        {(chatSubmitting || chatContactSheetLoading) && (
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "7px 14px",
                            borderRadius: 8,
                            background: isDark ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.02)",
                            border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
                            opacity: 0.8,
                            margin: "4px 0",
                            backdropFilter: "blur(4px)",
                            transition: "all 0.2s ease"
                          }}>
                            <div style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 9,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: 1
                            }}>
                              <div style={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                background: chatContactSheetLoading ? "#10b981" : accent,
                                boxShadow: chatContactSheetLoading ? "0 0 8px #10b981" : `0 0 8px ${accent}`,
                                animation: "pulse 1.8s infinite",
                                flexShrink: 0
                              }} />
                              <span style={{ fontSize: 12, fontWeight: 500, color: txt }}>
                                {chatContactSheetLoading
                                  ? (chatProgress?.current_step || "Generating contact sheet...")
                                  : (chatSubmittingStep || "Thinking...")}
                              </span>
                              {chatContactSheetLoading && Boolean(chatProgress?.total_frames && chatProgress.total_frames > 0) && (
                                <span style={{ fontSize: 11, fontWeight: 600, color: "#10b981", opacity: 0.9 }}>
                                  ({chatProgress?.current_frame || 0}/{chatProgress?.total_frames})
                                </span>
                              )}
                              <span style={{ fontSize: 11, color: sub, fontVariantNumeric: "tabular-nums" }}>
                                · {liveElapsedSeconds || chatProgress?.elapsed_seconds || 0}s
                              </span>
                            </div>

                            <button
                              onClick={handleStopChatProcessing}
                              title="Stop processing"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                padding: "2px 8px",
                                borderRadius: 5,
                                background: "transparent",
                                color: isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.45)",
                                border: isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.12)",
                                fontSize: 11,
                                cursor: "pointer",
                                flexShrink: 0,
                                transition: "all 0.15s"
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = "#ef4444";
                                e.currentTarget.style.borderColor = "#ef4444";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.45)";
                                e.currentTarget.style.borderColor = isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)";
                              }}
                            >
                              <Square size={8} fill="currentColor" />
                              <span>Stop</span>
                            </button>
                          </div>
                        )}
                        <div ref={chatBottomRef} />
                      </>
                    )}
                  </div>
                </div>

                {/* ── Bottom Floating Smart Chat Bar ── */}
                <div style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "center",
                  padding: "6px 24px 14px",
                  background: `linear-gradient(to top, ${bg} 90%, transparent)`,
                  flexShrink: 0,
                  position: "relative",
                  zIndex: 80
                }}>
                  <div style={{ width: "100%", maxWidth: 840, display: "flex", flexDirection: "column", gap: 8, position: "relative" }}>
                    {/* Attached File Previews */}
                    {chatAttachedFiles.length > 0 && (
                      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                        {chatAttachedFiles.map((f, i) => (
                          <div key={i} style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "4px 10px", borderRadius: 8,
                            background: card, border: `1px solid ${border}`,
                            fontSize: 11, color: txt, flexShrink: 0
                          }}>
                            {f.previewUrl ? (
                              <img src={f.previewUrl} alt={f.name} style={{ width: 22, height: 22, borderRadius: 4, objectFit: "cover" }} />
                            ) : (
                              <span>{f.type === "pdf" ? "📄" : "📝"}</span>
                            )}
                            <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                            <button
                              onClick={() => removeChatAttachedFile(i)}
                              style={{ background: "none", border: "none", color: sub, cursor: "pointer", display: "flex", alignItems: "center" }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── Frame Count Selection Popup (Opens above chat while processing or on badge click) ── */}
                    {showFrameCountPopup && (
                      <div style={{
                        position: "absolute",
                        bottom: "calc(100% + 12px)",
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: "calc(100% - 32px)",
                        maxWidth: 440,
                        background: isDark ? "#18181b" : "#ffffff",
                        border: `1.5px solid ${accent}60`,
                        borderRadius: 20,
                        boxShadow: isDark
                          ? "0 24px 60px rgba(0,0,0,0.8), 0 0 32px rgba(249,87,56,0.25)"
                          : "0 16px 44px rgba(0,0,0,0.14), 0 0 24px rgba(249,87,56,0.18)",
                        padding: "18px 20px",
                        zIndex: 120,
                        display: "flex",
                        flexDirection: "column",
                        gap: 14,
                        backdropFilter: "blur(20px)",
                        WebkitBackdropFilter: "blur(20px)",
                      }}>
                        {/* Header */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: 10,
                              background: `linear-gradient(135deg, ${accent}, #ea580c)`,
                              display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
                              boxShadow: `0 4px 14px ${accent}40`, flexShrink: 0
                            }}>
                              <Film size={17} />
                            </div>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 800, color: txt, letterSpacing: -0.2 }}>
                                How many frames?
                              </div>
                              <div style={{ fontSize: 11, color: sub }}>
                                Choose storyboard panels to generate
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={dismissFramePopup}
                            style={{
                              background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                              border: "none", color: sub, cursor: "pointer",
                              width: 26, height: 26, borderRadius: "50%",
                              display: "flex", alignItems: "center", justifyContent: "center"
                            }}
                            title="Dismiss"
                            onMouseOver={e => e.currentTarget.style.color = txt}
                            onMouseOut={e => e.currentTarget.style.color = sub}
                          >
                            <X size={14} />
                          </button>
                        </div>

                        {/* Quick Presets: 1-Click Select & Confirm */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                          {[
                            { count: 4, desc: "Quick (4)" },
                            { count: 6, desc: "Standard (6)" },
                            { count: 8, desc: "Detailed (8)" },
                            { count: 12, desc: "Cinema (12)" },
                          ].map(p => {
                            const isSelected = tempFrameCount === p.count;
                            return (
                              <button
                                key={p.count}
                                onClick={() => confirmFrameSelection(p.count)}
                                style={{
                                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                                  padding: "10px 4px", borderRadius: 12, cursor: "pointer",
                                  border: isSelected ? `2px solid ${accent}` : `1px solid ${border}`,
                                  background: isSelected
                                    ? (isDark ? "rgba(249,87,56,0.2)" : "rgba(249,87,56,0.12)")
                                    : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)"),
                                  transition: "all 0.15s",
                                }}
                                onMouseOver={e => {
                                  if (!isSelected) e.currentTarget.style.borderColor = accent;
                                }}
                                onMouseOut={e => {
                                  if (!isSelected) e.currentTarget.style.borderColor = border;
                                }}
                              >
                                <span style={{ fontSize: 14, fontWeight: 800, color: isSelected ? accent : txt }}>
                                  {p.count}
                                </span>
                                <span style={{ fontSize: 10, color: isSelected ? accent : sub, marginTop: 2, fontWeight: 600 }}>
                                  {p.desc}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Interactive Slider */}
                        <div style={{
                          background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                          border: `1px solid ${border}`, borderRadius: 12, padding: "10px 14px",
                          display: "flex", flexDirection: "column", gap: 8
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: sub }}>Custom Panel Count</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: accent, background: `${accent}20`, padding: "2px 8px", borderRadius: 8 }}>
                              {tempFrameCount} Panels
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 10, color: sub, fontWeight: 700 }}>1</span>
                            <input
                              type="range"
                              min={1}
                              max={15}
                              value={tempFrameCount}
                              onChange={e => setTempFrameCount(Number(e.target.value))}
                              style={{ flex: 1, accentColor: accent, cursor: "pointer" }}
                            />
                            <span style={{ fontSize: 10, color: sub, fontWeight: 700 }}>15</span>
                          </div>
                        </div>

                        {/* Confirm Button */}
                        <button
                          onClick={() => confirmFrameSelection(tempFrameCount)}
                          style={{
                            ...btnPrimary,
                            width: "100%", justifyContent: "center", padding: "10px 0",
                            borderRadius: 12, fontSize: 13, fontWeight: 700,
                            boxShadow: `0 4px 16px ${accent}40`,
                            background: `linear-gradient(135deg, ${accent}, #ea580c)`
                          }}
                        >
                          Confirm {tempFrameCount} Frames →
                        </button>
                      </div>
                    )}

                    {/* Chat Input Container */}
                    <div style={{
                      background: card, border: `1px solid ${border}`, borderRadius: 22,
                      boxShadow: isDark ? "0 10px 40px rgba(0,0,0,0.5)" : "0 8px 30px rgba(0,0,0,0.06)",
                      padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10
                    }}>
                      {/* Text Input */}
                      <textarea
                        value={chatPromptText}
                        onChange={e => setChatPromptText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSmartChatSubmit();
                          }
                        }}
                        placeholder="Describe your story, request changes to characters/products, or attach PDFs/images..."
                        rows={2}
                        style={{
                          width: "100%", background: "transparent", border: "none", outline: "none",
                          color: txt, fontSize: 13, resize: "none", fontFamily: "inherit"
                        }}
                      />

                      {/* Action buttons */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            onClick={() => chatFileInputRef.current?.click()}
                            title="Attach images, PDFs, or script text"
                            style={{
                              width: 32, height: 32, borderRadius: "50%", border: `1px solid ${border}`,
                              background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
                              color: sub, display: "flex", alignItems: "center", justifyContent: "center",
                              cursor: "pointer", transition: "all 0.15s"
                            }}
                            onMouseOver={e => e.currentTarget.style.color = txt}
                            onMouseOut={e => e.currentTarget.style.color = sub}
                          >
                            <Paperclip size={15} />
                          </button>

                          <button
                            onClick={toggleVoiceRecording}
                            title={isRecording ? "Stop recording" : "Record voice prompt"}
                            style={{
                              width: 32, height: 32, borderRadius: "50%", border: isRecording ? "1px solid #ef4444" : `1px solid ${border}`,
                              background: isRecording ? "rgba(239,68,68,0.15)" : (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"),
                              color: isRecording ? "#ef4444" : sub, display: "flex", alignItems: "center", justifyContent: "center",
                              cursor: "pointer", transition: "all 0.15s"
                            }}
                          >
                            <Mic size={15} className={isRecording ? "animate-pulse" : ""} />
                          </button>

                          {/* Quick Frames Badge / Trigger */}
                          <button
                            onClick={() => {
                              setTempFrameCount(smartFrameCount || 6);
                              setShowFrameCountPopup(prev => !prev);
                            }}
                            title="Choose number of storyboard frames"
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              padding: "5px 12px", borderRadius: 14,
                              border: `1px solid ${showFrameCountPopup ? accent : border}`,
                              background: showFrameCountPopup
                                ? (isDark ? "rgba(249,87,56,0.18)" : "rgba(249,87,56,0.1)")
                                : (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"),
                              color: showFrameCountPopup ? accent : sub,
                              fontSize: 11, fontWeight: 700, cursor: "pointer",
                              transition: "all 0.15s"
                            }}
                            onMouseOver={e => { e.currentTarget.style.color = accent; e.currentTarget.style.borderColor = accent; }}
                            onMouseOut={e => {
                              if (!showFrameCountPopup) {
                                e.currentTarget.style.color = sub;
                                e.currentTarget.style.borderColor = border;
                              }
                            }}
                          >
                            <Film size={12} />
                            <span>{smartFrameCount} Frames</span>
                          </button>
                        </div>

                        {(chatSubmitting || chatContactSheetLoading) ? (
                          <button
                            onClick={handleStopChatProcessing}
                            title="Stop processing"
                            style={{
                              width: 34, height: 34, borderRadius: "50%", border: "none",
                              background: "#ef4444",
                              color: "#fff",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              cursor: "pointer",
                              transition: "all 0.15s",
                              boxShadow: "0 2px 8px rgba(239,68,68,0.35)"
                            }}
                          >
                            <Square size={13} fill="#fff" />
                          </button>
                        ) : (
                          <button
                            onClick={handleSmartChatSubmit}
                            disabled={!chatPromptText.trim() && chatAttachedFiles.length === 0}
                            style={{
                              width: 34, height: 34, borderRadius: "50%", border: "none",
                              background: (chatPromptText.trim() || chatAttachedFiles.length > 0) ? accent : (isDark ? "#374151" : "#e5e7eb"),
                              color: (chatPromptText.trim() || chatAttachedFiles.length > 0) ? "#fff" : (isDark ? "#9ca3af" : "#9ca3af"),
                              display: "flex", alignItems: "center", justifyContent: "center",
                              cursor: (chatPromptText.trim() || chatAttachedFiles.length > 0) ? "pointer" : "not-allowed",
                              transition: "all 0.15s"
                            }}
                          >
                            <ArrowUp size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
          ) : (
            /* ═══ STANDARD BRIEF FORM ═══ */
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: bg, display: "flex", flexDirection: "column", alignItems: "center", padding: "36px 20px 60px" }}>
              <div style={{ width: "100%", maxWidth: 680, display: "flex", flexDirection: "column", gap: 24 }}>
                {/* Active Project Card (Only shown in standard brief mode) */}
                {activeSb && (
                  <div style={{ background: card, border: `1px solid ${accent}`, borderRadius: 18, padding: 24, boxShadow: `0 8px 30px ${accent}20`, display: "flex", flexDirection: "column", gap: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 10, background: `${accent}18`, display: "flex", alignItems: "center", justifyContent: "center", color: accent }}>
                          <Folder size={18} />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.5 }}>Active Storyboard (Saved)</div>
                          <h2 style={{ fontSize: 18, fontWeight: 800, color: txt, margin: 0 }}>{activeSb.name}</h2>
                        </div>
                      </div>
                      <button
                        onClick={() => { setActiveSb(null); setNewSbName(""); }}
                        style={{ ...btnGhost, fontSize: 11, padding: "5px 10px" }}
                      >
                        <Plus size={12} /> New Project
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, color: sub, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", padding: "10px 14px", borderRadius: 10, border: `1px solid ${border}` }}>
                      <span>👥 <b>{chars.length}</b> Character(s) extracted</span>
                      <span>·</span>
                      <span>📦 <b>{prods.length}</b> Product(s)</span>
                      <span>·</span>
                      <span>🎬 <b>{frames.length}</b> Frame(s) planned</span>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        onClick={() => setActiveStep(2)}
                        style={{ ...btnPrimary, flex: 1, justifyContent: "center", padding: "12px 0", fontSize: 13, borderRadius: 10, background: accent }}
                      >
                        🚀 Continue to Step 2: Lock Characters ({chars.length}) →
                      </button>
                      {frames.length > 0 && (
                        <button
                          onClick={() => setActiveStep(3)}
                          style={{ ...btnGhost, padding: "12px 18px", fontSize: 13, borderRadius: 10, color: "#7C3AED", borderColor: "#7C3AED", fontWeight: 600 }}
                        >
                          🎬 Direct Frames (Step 3) →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Standard Header */}
                  <div style={{ textAlign: "center" }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, ${accent}, #f97316)`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", marginBottom: 12, boxShadow: `0 8px 24px rgba(249,87,56,0.3)` }}>
                      <Film size={22} />
                    </div>
                    <h1 style={{ fontSize: 26, fontWeight: 800, color: txt, margin: "0 0 6px", letterSpacing: -0.5 }}>
                      {activeSb ? "Update Brief or Re-parse" : "Create New Storyboard"}
                    </h1>
                    <p style={{ fontSize: 13, color: sub, margin: 0 }}>
                      {activeSb ? "Upload an updated brief PDF or script to expand character DNA and scenes." : "Follow the simple steps to set up your storyboard and lock character consistency."}
                    </p>
                  </div>

                  {/* Creation Card */}
                  <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 18, padding: 28, boxShadow: isDark ? "0 12px 36px rgba(0,0,0,0.4)" : "0 8px 24px rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", gap: 20 }}>
                    
                    {/* Project Name Field */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 6 }}>
                        Project Name
                      </label>
                      <input
                        value={newSbName}
                        onChange={e => setNewSbName(e.target.value)}
                        placeholder={activeSb ? activeSb.name : "e.g. Panasonic Summer Campaign 2025..."}
                        style={{ ...inputStyle, padding: "12px 14px", fontSize: 14, borderRadius: 10 }}
                        onKeyDown={e => { if (e.key === "Enter" && creationMode === "blank") createSb(); }}
                      />
                      {createError && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 6, margin: "6px 0 0" }}>{createError}</p>}
                    </div>

                    {/* Mode Selection Tabs */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 8 }}>
                        Choose How to Build
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <button
                          onClick={() => setCreationMode("brief")}
                          style={{
                            padding: "12px 14px", borderRadius: 12, border: `2px solid ${creationMode === "brief" ? accent : border}`,
                            background: creationMode === "brief" ? (isDark ? "rgba(249,87,56,0.08)" : "rgba(249,87,56,0.04)") : "transparent",
                            cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 4, transition: "all 0.15s"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, color: creationMode === "brief" ? accent : txt }}>
                            <FileText size={15} /> 1. Import Brief / PDF
                          </div>
                          <div style={{ fontSize: 11, color: sub, lineHeight: 1.4 }}>
                            AI auto-extracts characters, generates 3-panel DNA sheets, and scenes.
                          </div>
                        </button>

                        <button
                          onClick={() => setCreationMode("chat")}
                          style={{
                            padding: "12px 14px", borderRadius: 12, border: `2px solid ${border}`,
                            background: "transparent",
                            cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 4, transition: "all 0.15s"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, color: txt }}>
                            <MessageSquare size={15} /> 2. NEW CHAT
                          </div>
                          <div style={{ fontSize: 11, color: sub, lineHeight: 1.4 }}>
                            Build custom scenes from scratch with custom characters &amp; camera angles.
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* Mode 1: Brief Form */}
                    {creationMode === "brief" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 6, borderTop: `1px solid ${border}` }}>
                        <div
                          onClick={() => landingFileInputRef.current?.click()}
                          style={{
                            border: `2px dashed ${border}`, borderRadius: 12, padding: "24px 16px", textAlign: "center", cursor: "pointer",
                            background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8
                          }}
                          onMouseOver={e => e.currentTarget.style.borderColor = accent}
                          onMouseOut={e => e.currentTarget.style.borderColor = border}
                        >
                          <input ref={landingFileInputRef} type="file" accept=".pdf,application/pdf" style={{ display: "none" }} onChange={handleLandingPdfUpload} />
                          <div style={{ width: 38, height: 38, borderRadius: 10, background: `${accent}18`, display: "flex", alignItems: "center", justifyContent: "center", color: accent }}>
                            <Upload size={18} />
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: txt }}>Click to upload PDF Creative Brief</div>
                            <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>Supports pitch decks, scripts, and campaign documents</div>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ height: 1, background: border, flex: 1 }} />
                          <span style={{ fontSize: 10, color: sub, textTransform: "uppercase", fontWeight: 700 }}>OR PASTE SCRIPT / BRIEF</span>
                          <div style={{ height: 1, background: border, flex: 1 }} />
                        </div>

                        <textarea
                          value={landingBriefText}
                          onChange={e => setLandingBriefText(e.target.value)}
                          placeholder="Paste your creative brief, script, or campaign idea here..."
                          style={{ ...inputStyle, height: 80, resize: "none", fontSize: 12, borderRadius: 10 }}
                        />

                        <div style={{ padding: "10px 14px", background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", borderRadius: 10, border: `1px solid ${border}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: txt }}>Target Frame Count:</span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: accent }}>{briefFrameCount} Frames</span>
                          </div>
                          <input
                            type="range" min={1} max={15} step={1}
                            value={briefFrameCount}
                            onChange={e => setBriefFrameCount(Number(e.target.value))}
                            style={{ width: "100%", accentColor: accent, cursor: "pointer" }}
                          />
                        </div>

                        <button
                          onClick={handleLandingBriefSubmit}
                          disabled={briefParsing || (!landingBriefText.trim() && !pdfExtracting)}
                          style={{
                            ...btnPrimary, width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 13, borderRadius: 10,
                            opacity: (briefParsing || (!landingBriefText.trim() && !pdfExtracting)) ? 0.4 : 1,
                            cursor: (briefParsing || (!landingBriefText.trim() && !pdfExtracting)) ? "not-allowed" : "pointer"
                          }}
                        >
                          {briefParsing ? <><RefreshCw size={14} className="animate-spin" /> Ingesting Brief &amp; Extracting DNA...</> : <><Sparkles size={14} /> Parse Brief &amp; Lock Characters</>}
                        </button>
                      </div>
                    )}
                  </div>

                    {/* Recent Storyboards Section */}
                    {storyboards.length > 0 && (
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: txt, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>Recent Storyboards ({storyboards.length})</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          {storyboards.slice(0, 6).map(sb => (
                            <div
                              key={sb.id}
                              onClick={() => selectStoryboard(sb)}
                              style={{
                                background: card, border: `1px solid ${border}`, borderRadius: 12, padding: "12px 16px",
                                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
                                transition: "all 0.15s"
                              }}
                              onMouseOver={e => { e.currentTarget.style.borderColor = accent; }}
                              onMouseOut={e => { e.currentTarget.style.borderColor = border; }}
                            >
                              <div style={{ minWidth: 0, flex: 1, marginRight: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {sb.name}
                                </div>
                                <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                                  {sb.frame_count !== undefined ? `${sb.frame_count} frames` : "0 frames"}
                                </div>
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 600, color: accent, display: "flex", alignItems: "center", gap: 4 }}>
                                <Play size={10} /> Open
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            )}


        {/* ═══ STEP 2: DEDICATED LOCK CHARACTERS & PRODUCT DNA SCREEN ═══ */}
        {activeStep === 2 && (
          <div style={{ flex: 1, overflowY: "auto", background: bg, display: "flex", flexDirection: "column", padding: "24px 32px 80px" }}>
            {/* Top Banner with Title & Proceed Button */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, borderBottom: `1px solid ${border}`, paddingBottom: 18, gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <button
                    onClick={() => { setActiveStep(1); setCreationMode("chat"); }}
                    style={{
                      ...btnGhost,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      color: accent,
                      borderColor: `${accent}40`,
                      background: isDark ? "rgba(249,87,56,0.1)" : "rgba(249,87,56,0.06)",
                      borderRadius: 8
                    }}
                    title="Return to AI Chat screen"
                  >
                    <ArrowLeft size={13} />
                    <MessageSquare size={13} style={{ color: accent }} />
                    <span>Back to AI Chat &amp; Contact Sheet</span>
                  </button>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 6, background: `${accent}20`, color: accent }}>STEP 2</span>
                  <h1 style={{ fontSize: 22, fontWeight: 800, color: txt, margin: 0 }}>Review &amp; Lock Character &amp; Product DNA</h1>
                </div>
                <p style={{ fontSize: 12, color: sub, margin: 0, maxWidth: 650, lineHeight: 1.5 }}>
                  Inspect 3-view character reference sheets and visual attributes. All frames in Step 3 will lock onto these approved looks.
                </p>
              </div>
              <button
                onClick={() => setActiveStep(3)}
                style={{
                  ...btnPrimary,
                  padding: "10px 22px", fontSize: 13, borderRadius: 10,
                  background: "linear-gradient(135deg, #7C3AED, #9333EA)",
                  boxShadow: "0 4px 16px rgba(124,58,237,0.35)",
                  whiteSpace: "nowrap"
                }}
              >
                <Sparkles size={14} /> Finalize DNA &amp; Proceed to Direct Frames (Step 3) →
              </button>
            </div>

            {/* Sub Tabs: Characters vs Products */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              <button
                onClick={() => setRefTab("characters")}
                style={{
                  padding: "8px 18px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${refTab === "characters" ? accent : border}`,
                  background: refTab === "characters" ? accent : "transparent",
                  color: refTab === "characters" ? "#fff" : txt,
                  display: "flex", alignItems: "center", gap: 6
                }}
              >
                <Play size={13} /> Characters ({chars.length})
              </button>
              <button
                onClick={() => setRefTab("products")}
                style={{
                  padding: "8px 18px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${refTab === "products" ? "#8B5CF6" : border}`,
                  background: refTab === "products" ? "#8B5CF6" : "transparent",
                  color: refTab === "products" ? "#fff" : txt,
                  display: "flex", alignItems: "center", gap: 6
                }}
              >
                <Package size={13} /> Products ({prods.length})
              </button>
            </div>

            {/* Characters Content */}
            {refTab === "characters" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Quick Add Character Card */}
                <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: txt, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>➕ Add Character</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {(["upload", "generate"] as const).map(m => (
                        <button key={m} onClick={() => setCharCreateMode(m)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: `1px solid ${charCreateMode === m ? accent : border}`, borderRadius: 6, background: charCreateMode === m ? accent : "transparent", color: charCreateMode === m ? "#fff" : sub, cursor: "pointer" }}>
                          {m === "upload" ? "⬆ Upload Photos" : "✨ Generate from Description"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <input value={newCharName} onChange={e => setNewCharName(e.target.value)} placeholder="Character name (e.g. Maya)" style={{ ...inputStyle, flex: "1 1 200px", padding: "10px 14px", borderRadius: 8 }} />
                    {charCreateMode === "upload" ? (
                      <div style={{ display: "flex", gap: 8, flex: "2 1 300px", alignItems: "center" }}>
                        <label style={{ flex: 1, height: 38, border: `1px dashed ${border}`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: sub, fontSize: 11, gap: 6 }}>
                          <Upload size={13} /> {newCharImgs.length > 0 ? `${newCharImgs.length} photos selected` : "Upload Reference Photos"}
                          <input ref={fileRef} type="file" accept="image/*" multiple onChange={onImgUpload} style={{ display: "none" }} />
                        </label>
                        <button onClick={createChar} disabled={!newCharName || newCharImgs.length === 0} style={{ ...btnPrimary, padding: "9px 18px", opacity: (!newCharName || newCharImgs.length === 0) ? 0.4 : 1, cursor: (!newCharName || newCharImgs.length === 0) ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                          Add Character
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, flex: "2 1 400px", alignItems: "center" }}>
                        <input value={newCharDesc} onChange={e => setNewCharDesc(e.target.value)} placeholder="Describe character: 28yo South Asian detective, sharp eyes, dark bob haircut, leather trench coat..." style={{ ...inputStyle, flex: 1, padding: "10px 14px", borderRadius: 8 }} />
                        <button onClick={generateCharFromDesc} disabled={generatingChar || !newCharName || !newCharDesc.trim()} style={{ ...btnPrimary, background: "#7C3AED", padding: "9px 18px", opacity: (generatingChar || !newCharName || !newCharDesc.trim()) ? 0.4 : 1, cursor: (generatingChar || !newCharName || !newCharDesc.trim()) ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                          {generatingChar ? <><RefreshCw size={12} className="animate-spin" /> Generating...</> : <><Sparkles size={12} /> Generate</>}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Character Cards List */}
                {chars.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: sub }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: txt }}>No characters added yet</div>
                    <div style={{ fontSize: 12 }}>Add a character above or import a brief in Step 1.</div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 18 }}>
                    {chars.map(c => (
                      <div key={c.id} style={{ background: card, border: `1px solid ${border}`, borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 14, boxShadow: isDark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 4px 16px rgba(0,0,0,0.04)" }}>
                        {/* Card Header */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", border: `2px solid ${accent}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isDark ? "#2a2a2a" : "#eee" }}>
                              {c.image_path
                                ? <img src={c.image_path.startsWith('http') ? c.image_path : `${API}/${c.image_path}`} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                : <span style={{ fontSize: 16, fontWeight: 700, color: accent }}>{c.name.charAt(0).toUpperCase()}</span>
                              }
                            </div>
                            <div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: txt }}>{c.name}</div>
                              <div style={{ fontSize: 11, color: c.character_dna ? "#22c55e" : sub, fontWeight: 600 }}>
                                {c.character_dna ? "✓ DNA Extracted & Ready" : "Awaiting Analysis"}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => openDnaEditor(c)} style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}>✏️ Edit DNA</button>
                            <button onClick={() => deleteChar(c.id)} style={{ background: "none", border: "none", color: sub, cursor: "pointer", padding: 4 }} onMouseOver={e => e.currentTarget.style.color = "#ef4444"} onMouseOut={e => e.currentTarget.style.color = sub}>
                              <Trash size={14} />
                            </button>
                          </div>
                        </div>

                        {/* 3-Panel Sheet Section */}
                        <div style={{ padding: "12px 14px", background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)", borderRadius: 12, border: `1px solid ${border}` }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>3-View Character Sheet Anchor</span>
                            {c.character_sheet?.is_approved && <span style={{ color: "#22c55e", fontWeight: 700 }}>✅ Approved</span>}
                          </div>
                          {c.character_sheet ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              <div style={{ display: "flex", gap: 6 }}>
                                {[
                                  { url: c.character_sheet.front_body_url, label: "Front Body", key: "front" },
                                  { url: c.character_sheet.side_profile_url, label: "Side Profile", key: "side" },
                                  { url: c.character_sheet.face_closeup_url, label: "Face Close-up", key: "face" },
                                ].map(({ url, label, key }) => (
                                  <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                                    <div 
                                      onClick={() => {
                                        if (url) {
                                          setSheetViewChar(c);
                                        } else if (!generatingSheet[c.id]) {
                                          generateSheet(c.id, key as any);
                                        }
                                      }}
                                      style={{ 
                                        aspectRatio: "1/1", 
                                        background: isDark ? "#111" : "#f4f4f5", 
                                        borderRadius: 8, 
                                        overflow: "hidden", 
                                        border: `1px solid ${!url ? (accent + "88") : border}`, 
                                        display: "flex", 
                                        alignItems: "center", 
                                        justifyContent: "center",
                                        cursor: "pointer",
                                        transition: "all 0.2s ease"
                                      }}
                                      title={url ? "Click to view full sheet" : `Click to generate ${label} from front look`}
                                    >
                                      {url ? (
                                        <img src={url.startsWith('http') ? url : `${API}/${url}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt={label} />
                                      ) : generatingSheet[c.id] ? (
                                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                          <span style={{ fontSize: 13, animation: "spin 1s linear infinite" }}>🔄</span>
                                          <span style={{ fontSize: 8, color: accent, fontWeight: 700 }}>Generating</span>
                                        </div>
                                      ) : (
                                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: 4, textAlign: "center" }}>
                                          <span style={{ fontSize: 11, color: accent }}>+ ✨</span>
                                          <span style={{ fontSize: 8, color: txt, fontWeight: 600 }}>Generate</span>
                                        </div>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 9, color: sub, textAlign: "center", fontWeight: 600 }}>{label}</div>
                                  </div>
                                ))}
                              </div>
                              <div style={{ display: "flex", gap: 8 }}>
                                {(() => {
                                  const isMissing = c.character_sheet.front_body_url && (!c.character_sheet.side_profile_url || !c.character_sheet.face_closeup_url);
                                  return (
                                    <button 
                                      onClick={() => generateSheet(c.id, isMissing ? "missing" : "all")} 
                                      disabled={generatingSheet[c.id]} 
                                      style={{ ...btnGhost, flex: 1, justifyContent: "center", fontSize: 11, padding: "6px 0", color: isMissing ? accent : undefined, borderColor: isMissing ? accent + "66" : undefined }}
                                    >
                                      {generatingSheet[c.id] ? "Generating Views..." : isMissing ? "✨ Generate Side & Face" : "🔄 Regenerate Sheet"}
                                    </button>
                                  );
                                })()}
                                <button onClick={() => approveSheet(c.id)} disabled={c.character_sheet.is_approved} style={{ ...btnPrimary, flex: 1, justifyContent: "center", fontSize: 11, padding: "6px 0", background: c.character_sheet.is_approved ? "#22c55e" : accent }}>
                                  {c.character_sheet.is_approved ? "✅ Approved Look" : "✅ Approve Look"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => generateSheet(c.id)} disabled={generatingSheet[c.id]} style={{ ...btnPrimary, width: "100%", justifyContent: "center", padding: "8px 0", fontSize: 12 }}>
                              {generatingSheet[c.id] ? "Generating 3-Panel Sheet..." : "✨ Generate 3-Panel Sheet"}
                            </button>
                          )}
                        </div>

                        {/* DNA Specs Details */}
                        {c.character_dna && (
                          <div style={{ fontSize: 11, color: sub, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 4 }}>
                            <div><b style={{ color: txt }}>Look / Demographics:</b> {c.character_dna.physical_anchors?.ethnicity_skin_tone || c.character_dna.demographics || "Visual Anchors Ready"}</div>
                            <div><b style={{ color: txt }}>Wardrobe:</b> {c.character_dna.costume_bible?.wardrobe_bible || c.character_dna.default_wardrobe || "Default Wardrobe Ready"}</div>
                            {c.character_dna.costume_bible?.fixed_accessories && (
                              <div><b style={{ color: txt }}>Accessories:</b> {c.character_dna.costume_bible.fixed_accessories}</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Products Content */}
            {refTab === "products" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Add Product Card */}
                <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: txt, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>➕ Add Product</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {(["upload", "generate"] as const).map(m => (
                        <button key={m} onClick={() => setProdCreateMode(m)} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: `1px solid ${prodCreateMode === m ? "#8B5CF6" : border}`, borderRadius: 6, background: prodCreateMode === m ? "#8B5CF6" : "transparent", color: prodCreateMode === m ? "#fff" : sub, cursor: "pointer" }}>
                          {m === "upload" ? "⬆ Upload Photos" : "✨ Generate from Description"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <input value={newProdName} onChange={e => setNewProdName(e.target.value)} placeholder="Product name (e.g. EcoBottle 500ml)" style={{ ...inputStyle, flex: "1 1 200px", padding: "10px 14px", borderRadius: 8 }} />
                    {prodCreateMode === "upload" ? (
                      <div style={{ display: "flex", gap: 8, flex: "2 1 420px", alignItems: "center", flexWrap: "wrap" }}>
                        <input value={newProdDesc} onChange={e => setNewProdDesc(e.target.value)} placeholder="Optional style prompt / visual directions (e.g. Matte white body, blue logo)..." style={{ ...inputStyle, flex: "1 1 200px", padding: "10px 14px", borderRadius: 8 }} />
                        <label style={{ flex: "1 1 140px", height: 38, border: `1px dashed ${border}`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: sub, fontSize: 11, gap: 6 }}>
                          <Upload size={13} /> {newProdImgs.length > 0 ? `${newProdImgs.length} photos selected` : "Upload Product Photos"}
                          <input ref={prodFileRef} type="file" accept="image/*" multiple onChange={onProdImgUpload} style={{ display: "none" }} />
                        </label>
                        <button onClick={createProd} disabled={!newProdName || newProdImgs.length === 0} style={{ ...btnPrimary, background: "#8B5CF6", padding: "9px 18px", opacity: (!newProdName || newProdImgs.length === 0) ? 0.4 : 1, cursor: (!newProdName || newProdImgs.length === 0) ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                          Add Product
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, flex: "2 1 400px", alignItems: "center" }}>
                        <input value={newProdDesc} onChange={e => setNewProdDesc(e.target.value)} placeholder="Describe product: Matte black stainless steel vacuum flask, orange silicone cap..." style={{ ...inputStyle, flex: 1, padding: "10px 14px", borderRadius: 8 }} />
                        <button onClick={generateProdFromDesc} disabled={generatingProd || !newProdName || !newProdDesc.trim()} style={{ ...btnPrimary, background: "#8B5CF6", padding: "9px 18px", opacity: (generatingProd || !newProdName || !newProdDesc.trim()) ? 0.4 : 1, cursor: (generatingProd || !newProdName || !newProdDesc.trim()) ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                          {generatingProd ? <><RefreshCw size={12} className="animate-spin" /> Generating...</> : <><Sparkles size={12} /> Generate Product DNA</>}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Product Cards List */}
                {prods.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: sub }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: txt }}>No products added yet</div>
                    <div style={{ fontSize: 12 }}>Add a product reference above if your campaign features hero items.</div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 18 }}>
                    {prods.map(p => {
                      const allImgs: string[] = p.image_paths?.length > 0
                        ? p.image_paths
                        : (p.image_path ? [p.image_path] : []);
                      const displayImgs = allImgs.slice(0, 2); // Show 1-2 product reference images

                      return (
                        <div key={p.id} style={{ background: card, border: `1px solid ${border}`, borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 14, boxShadow: isDark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 4px 16px rgba(0,0,0,0.04)" }}>
                          {/* Card Header */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 44, height: 44, borderRadius: 10, overflow: "hidden", border: `2px solid ${p.is_approved ? "#22c55e" : "#8B5CF6"}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isDark ? "#2a2a2a" : "#eee" }}>
                                {p.image_path
                                  ? <img src={p.image_path.startsWith('http') ? p.image_path : `${API}/${p.image_path}`} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                  : <Package size={20} color="#8B5CF6" />
                                }
                              </div>
                              <div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: txt }}>{p.name}</div>
                                <div style={{ fontSize: 11, color: p.is_approved ? "#22c55e" : (p.product_dna ? "#8B5CF6" : sub), fontWeight: 600 }}>
                                  {p.is_approved ? "✅ Approved Product Look" : (p.product_dna ? "✓ DNA Extracted & Ready" : "Awaiting Analysis")}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <button onClick={() => openProdDnaEditor(p)} style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}>✏️ Edit DNA</button>
                              <button onClick={() => deleteProd(p.id)} style={{ background: "none", border: "none", color: sub, cursor: "pointer", padding: 4 }} onMouseOver={e => e.currentTarget.style.color = "#ef4444"} onMouseOut={e => e.currentTarget.style.color = sub}>
                                <Trash size={14} />
                              </button>
                            </div>
                          </div>

                          {/* Product Reference Visuals Section */}
                          <div style={{ padding: "12px 14px", background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)", borderRadius: 12, border: `1px solid ${border}` }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span>Product Reference Visuals</span>
                              {p.is_approved && <span style={{ color: "#22c55e", fontWeight: 700 }}>✅ Approved</span>}
                            </div>
                            
                            {displayImgs.length > 0 ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                <div style={{ display: "flex", gap: 8 }}>
                                  {displayImgs.map((imgUrl, i) => (
                                    <div key={i} style={{ flex: 1, aspectRatio: displayImgs.length === 1 ? "16/9" : "1/1", maxHeight: 160, background: "#111", borderRadius: 8, overflow: "hidden", border: `1px solid ${border}` }}>
                                      <img
                                        src={imgUrl.startsWith('http') ? imgUrl : `${API}/${imgUrl}`}
                                        alt={`${p.name} view ${i + 1}`}
                                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                                      />
                                    </div>
                                  ))}
                                </div>

                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  <label style={{ ...btnGhost, flex: "1 1 120px", justifyContent: "center", fontSize: 11, padding: "6px 0", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                                    <Upload size={11} /> <span>Upload Photo</span>
                                    <input type="file" accept="image/*" multiple onChange={e => uploadPhotosToProd(p.id, e)} style={{ display: "none" }} />
                                  </label>
                                  <button
                                    onClick={() => analyzeProd(p.id)}
                                    disabled={analyzingProd[p.id]}
                                    style={{ ...btnGhost, flex: "1 1 120px", justifyContent: "center", fontSize: 11, padding: "6px 0" }}
                                  >
                                    {analyzingProd[p.id] ? <><RefreshCw size={11} className="animate-spin" /> Regenerating...</> : <><RefreshCw size={11} /> Regenerate Product DNA</>}
                                  </button>
                                  <button
                                    onClick={() => approveProdLook(p.id)}
                                    style={{
                                      ...btnPrimary,
                                      flex: "1 1 100%", justifyContent: "center", fontSize: 11, padding: "7px 0",
                                      background: p.is_approved ? "#22c55e" : "#8B5CF6",
                                    }}
                                  >
                                    {p.is_approved ? "✅ Approved Look" : "✅ Approve Product Look"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button
                                    onClick={() => analyzeProd(p.id)}
                                    disabled={analyzingProd[p.id]}
                                    style={{ ...btnPrimary, flex: 1, justifyContent: "center", padding: "9px 0", fontSize: 12, background: "#8B5CF6" }}
                                  >
                                    {analyzingProd[p.id] ? <><RefreshCw size={12} className="animate-spin" /> Generating Product DNA...</> : <><Sparkles size={12} /> ✨ Generate Product DNA</>}
                                  </button>
                                  <label style={{ ...btnGhost, height: 38, padding: "0 14px", border: `1px dashed ${border}`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: txt, fontSize: 11, gap: 6 }}>
                                    <Upload size={12} /> <span>Upload Photo</span>
                                    <input type="file" accept="image/*" multiple onChange={e => uploadPhotosToProd(p.id, e)} style={{ display: "none" }} />
                                  </label>
                                </div>
                                <button
                                  onClick={() => approveProdLook(p.id)}
                                  style={{
                                    ...btnGhost, width: "100%", justifyContent: "center", fontSize: 11, padding: "6px 0",
                                    color: p.is_approved ? "#22c55e" : sub, borderColor: p.is_approved ? "#22c55e" : border
                                  }}
                                >
                                  {p.is_approved ? "✅ Approved Look" : "Approve Product Look"}
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Product DNA Specs Details */}
                          {p.product_dna ? (
                            <div style={{ fontSize: 11, color: sub, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)", borderRadius: 12, border: `1px solid ${border}` }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${border}`, paddingBottom: 6 }}>
                                <span style={{ fontSize: 10, fontWeight: 800, color: txt, textTransform: "uppercase", letterSpacing: 0.5 }}>Product DNA Attributes</span>
                                <button onClick={() => openProdDnaEditor(p)} style={{ ...btnGhost, fontSize: 10, padding: "2px 6px" }}>✏️ Edit</button>
                              </div>
                              <div><b style={{ color: txt }}>Category:</b> {p.product_dna.product_type || p.product_dna.category || "Extracted"}</div>
                              <div><b style={{ color: txt }}>Colors:</b> {p.product_dna.color_palette || p.product_dna.colors || "Ready"}</div>
                              <div><b style={{ color: txt }}>Material &amp; Finish:</b> {p.product_dna.material_finish || p.product_dna.material || "Standard"}</div>
                              {p.product_dna.shape_geometry && (
                                <div><b style={{ color: txt }}>Form &amp; Geometry:</b> {p.product_dna.shape_geometry}</div>
                              )}
                              {p.product_dna.branding && (
                                <div><b style={{ color: txt }}>Branding / Logos:</b> {p.product_dna.branding}</div>
                              )}
                              {p.product_dna.surface_details && (
                                <div><b style={{ color: txt }}>Surface Details:</b> {p.product_dna.surface_details}</div>
                              )}
                              {p.product_dna.distinctive_features && (
                                <div><b style={{ color: txt }}>Key Features:</b> {p.product_dna.distinctive_features}</div>
                              )}
                              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTop: `1px solid ${border}` }}>
                                {p.dna_extraction_confidence !== undefined && (
                                  <span style={{ color: p.dna_extraction_confidence > 0.7 ? "#22c55e" : "#eab308", fontWeight: 700 }}>
                                    DNA Confidence: {Math.round(p.dna_extraction_confidence * 100)}%
                                  </span>
                                )}
                                {p.drift_warning && <span style={{ color: "#ef4444", fontWeight: 700 }}>⚠ DNA Drifted</span>}
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: sub, fontStyle: "italic", padding: "10px 14px", background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)", borderRadius: 12, border: `1px solid ${border}` }}>
                              Click &quot;Extract Product DNA&quot; to parse visual traits from product images.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ STEP 3: DIRECT FRAMES (TIMELINE CANVAS) ═══ */}
        {activeStep === 3 && (
          activeSb ? (
            <>
              {/* === REFERENCES PANEL (Characters + Products) === */}
              <div style={{ width: 300, borderRight: `1px solid ${border}`, background: bg, display: "flex", flexDirection: "column", flexShrink: 0, minHeight: 0, overflow: "hidden" }}>
                {/* Tab Switcher */}
                <div style={{ padding: "16px 16px 0", display: "flex", gap: 4 }}>
                  <button onClick={() => setRefTab("characters")} style={{ flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 600, border: `1px solid ${refTab === "characters" ? accent : border}`, borderRadius: 8, background: refTab === "characters" ? accent : "transparent", color: refTab === "characters" ? "#fff" : txt, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                    <Play size={12} /> Characters ({chars.length})
                  </button>
                  <button onClick={() => setRefTab("products")} style={{ flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 600, border: `1px solid ${refTab === "products" ? "#8B5CF6" : border}`, borderRadius: 8, background: refTab === "products" ? "#8B5CF6" : "transparent", color: refTab === "products" ? "#fff" : txt, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                    <Package size={12} /> Products ({prods.length})
                  </button>
                </div>

                {refTab === "characters" ? (
                  <>
                    <div style={{ padding: "12px 16px", borderBottom: `1px solid ${border}` }}>
                      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                        {(["upload", "generate"] as const).map(m => (
                          <button key={m} onClick={() => setCharCreateMode(m)} style={{ flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 600, border: `1px solid ${charCreateMode === m ? accent : border}`, borderRadius: 6, background: charCreateMode === m ? accent : "transparent", color: charCreateMode === m ? "#fff" : sub, cursor: "pointer" }}>
                            {m === "upload" ? "⬆ Upload Photos" : "✨ Generate from Description"}
                          </button>
                        ))}
                      </div>
                      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                        <input value={newCharName} onChange={e => setNewCharName(e.target.value)} placeholder="Character name" style={{ ...inputStyle, padding: "8px 12px" }} />
                        {charCreateMode === "upload" ? (
                          <>
                            {newCharImgs.length > 0 && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {newCharImgs.map((img, i) => (
                                  <div key={i} style={{ position: "relative", width: 52, height: 52, borderRadius: 6, overflow: "hidden", border: `1px solid ${border}` }}>
                                    <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    <button onClick={() => removeNewImg(i)} style={{ position: "absolute", top: 1, right: 1, background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 9, lineHeight: 1 }}>✕</button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <label style={{ width: "100%", height: newCharImgs.length > 0 ? 40 : 64, border: `1px dashed ${border}`, borderRadius: 8, display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", cursor: "pointer", color: sub, fontSize: 11, gap: 6 }}>
                              <Upload size={14} /> {newCharImgs.length > 0 ? `Add more (${newCharImgs.length} uploaded)` : "Upload References (multi)"}
                              <input ref={fileRef} type="file" accept="image/*" multiple onChange={onImgUpload} style={{ display: "none" }} />
                            </label>
                            <button onClick={createChar} disabled={!newCharName || newCharImgs.length === 0} style={{ ...btnPrimary, width: "100%", justifyContent: "center", opacity: (!newCharName || newCharImgs.length === 0) ? 0.4 : 1, cursor: (!newCharName || newCharImgs.length === 0) ? "not-allowed" : "pointer" }}>Add Character</button>
                          </>
                        ) : (
                          <>
                            <textarea value={newCharDesc} onChange={e => setNewCharDesc(e.target.value)} placeholder="Describe the character: age, ethnicity, build, hair, distinguishing features, wardrobe..." style={{ ...inputStyle, height: 80, resize: "none", fontSize: 12 }} />
                            <button onClick={generateCharFromDesc} disabled={generatingChar || !newCharName || !newCharDesc.trim()} style={{ ...btnPrimary, width: "100%", justifyContent: "center", background: "#7C3AED", opacity: (generatingChar || !newCharName || !newCharDesc.trim()) ? 0.4 : 1, cursor: (generatingChar || !newCharName || !newCharDesc.trim()) ? "not-allowed" : "pointer" }}>
                              {generatingChar ? <><RefreshCw size={12} className="animate-spin" /> Generating...</> : <><Sparkles size={12} /> Generate Character</>}
                            </button>
                            <p style={{ fontSize: 10, color: sub, textAlign: "center", margin: 0 }}>AI will generate a reference image + auto-extract DNA</p>
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                      {chars.length === 0 && <div style={{ color: sub, fontSize: 12, textAlign: "center", padding: 20 }}>No characters yet</div>}
                      {chars.map(c => (
                        <div key={c.id} style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: "hidden", background: card }}>
                          <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", gap: 10 }}>
                            <div style={{ width: 36, height: 36, borderRadius: "50%", overflow: "hidden", border: `2px solid ${accent}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isDark ? "#2a2a2a" : "#eee" }}>
                              {c.image_path
                                ? <img src={c.image_path.startsWith('http') ? c.image_path : `${API}/${c.image_path}`} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { (e.target as HTMLImageElement).style.display='none'; }}/>
                                : <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{c.name.charAt(0).toUpperCase()}</span>
                              }
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                              <div style={{ fontSize: 10, color: c.character_dna ? "#22c55e" : sub }}>{c.character_dna ? "✓ DNA Ready" : "Needs Analysis"} · {c.image_count || 1} ref{(c.image_count || 1) > 1 ? "s" : ""}</div>
                            </div>
                            <button onClick={() => deleteChar(c.id)} style={{ ...btnGhost, padding: 4, border: "none" }}><Trash size={13} color="#ef4444" /></button>
                          </div>
                          {!c.character_dna ? (
                            <div style={{ padding: "8px 14px 12px" }}>
                              <button onClick={() => analyzeChar(c.id)} disabled={c.analyzing} style={{ ...btnPrimary, width: "100%", justifyContent: "center", background: isDark ? "#333" : "#eee", color: txt, fontSize: 12, padding: "7px 0" }}>
                                {c.analyzing ? <><RefreshCw size={12} className="animate-spin" /> Analyzing...</> : <><Play size={12} /> Extract DNA</>}
                              </button>
                            </div>
                          ) : (
                            <div style={{ padding: "8px 14px 10px", fontSize: 11, color: sub, lineHeight: 1.5 }}>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: isDark ? "rgba(59,130,246,0.2)" : "#dbeafe", color: "#3b82f6" }}>🎨 Visual DNA</span>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: isDark ? "rgba(168,85,247,0.2)" : "#f3e8ff", color: "#a855f7" }}>🎙️ Voice DNA</span>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: isDark ? "rgba(34,197,94,0.2)" : "#dcfce7", color: "#22c55e" }}>🧠 Behavioral DNA</span>
                              </div>
                              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                <b style={{ color: txt }}>Look:</b> {c.character_dna.physical_anchors?.ethnicity_skin_tone || c.character_dna.demographics || "Visual Anchors Ready"}
                              </div>
                              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                <b style={{ color: txt }}>Costume:</b> {c.character_dna.costume_bible?.wardrobe_bible || c.character_dna.default_wardrobe || "Garment & Props Ready"}
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                                {c.dna_extraction_confidence !== undefined && (
                                  <span style={{ color: c.dna_extraction_confidence > 0.7 ? "#22c55e" : "#eab308", fontWeight: 600, fontSize: 10 }}>Confidence: {Math.round(c.dna_extraction_confidence * 100)}%</span>
                                )}
                                <button
                                  onClick={() => openDnaEditor(c)}
                                  style={{ ...btnGhost, fontSize: 10, padding: "2px 8px", border: `1px solid ${border}`, borderRadius: 4, color: txt, display: "flex", alignItems: "center", gap: 3 }}
                                >
                                  ✏️ Edit DNA
                                </button>
                              </div>
                            </div>
                          )}
                          {c.character_dna && (
                            <div style={{ padding: "8px 14px", borderTop: `1px solid ${border}` }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: sub, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span>CHARACTER SHEET</span>
                                {c.character_sheet ? (
                                  <button
                                    onClick={() => setSheetViewChar(c)}
                                    style={{ ...btnGhost, fontSize: 10, padding: "2px 8px", border: `1px solid ${accent}`, color: accent }}
                                  >View Full Sheet</button>
                                ) : (
                                  <button
                                    onClick={() => openDnaEditor(c)}
                                    style={{ ...btnGhost, fontSize: 10, padding: "2px 8px", color: sub }}
                                  >View DNA</button>
                                )}
                              </div>
                              {c.character_sheet ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                  <div style={{ display: "flex", gap: 4 }}>
                                    {[
                                      { url: c.character_sheet.front_body_url, label: "Front", key: "front" },
                                      { url: c.character_sheet.side_profile_url, label: "Side", key: "side" },
                                      { url: c.character_sheet.face_closeup_url, label: "Face", key: "face" },
                                    ].map(({ url, label, key }) => (
                                      <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                                        <div 
                                          onClick={() => {
                                            if (url) {
                                              setSheetViewChar(c);
                                            } else if (!generatingSheet[c.id]) {
                                              generateSheet(c.id, key as any);
                                            }
                                          }}
                                          style={{ 
                                            aspectRatio: "1/1", 
                                            background: isDark ? "#111" : "#f4f4f5", 
                                            borderRadius: 6, 
                                            overflow: "hidden", 
                                            border: `1px solid ${!url ? (accent + "88") : border}`, 
                                            display: "flex", 
                                            alignItems: "center", 
                                            justifyContent: "center",
                                            cursor: "pointer",
                                            transition: "all 0.2s ease"
                                          }}
                                          title={url ? "Click to view full sheet" : `Click to generate ${label} from front look`}
                                        >
                                          {url ? (
                                            <img src={url.startsWith('http') ? url : `${API}/${url}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt={label} />
                                          ) : generatingSheet[c.id] ? (
                                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                              <span style={{ fontSize: 11, animation: "spin 1s linear infinite" }}>🔄</span>
                                              <span style={{ fontSize: 7, color: accent, fontWeight: 700 }}>Generating</span>
                                            </div>
                                          ) : (
                                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: 2, textAlign: "center" }}>
                                              <span style={{ fontSize: 9, color: accent, fontWeight: 700 }}>+ ✨</span>
                                              <span style={{ fontSize: 8, color: txt, fontWeight: 600 }}>{label}</span>
                                            </div>
                                          )}
                                        </div>
                                        <div style={{ fontSize: 8, color: sub, textAlign: "center" }}>{label}</div>
                                      </div>
                                    ))}
                                  </div>
                                  <div style={{ display: "flex", gap: 4 }}>
                                    {(() => {
                                      const isMissing = c.character_sheet.front_body_url && (!c.character_sheet.side_profile_url || !c.character_sheet.face_closeup_url);
                                      return (
                                        <button
                                          onClick={() => generateSheet(c.id, isMissing ? "missing" : "all")}
                                          disabled={generatingSheet[c.id]}
                                          style={{ ...btnGhost, flex: 1, padding: "4px 0", fontSize: 10, justifyContent: "center", color: isMissing ? accent : undefined, borderColor: isMissing ? accent + "66" : undefined }}
                                        >
                                          {generatingSheet[c.id] ? "Generating Views..." : isMissing ? "✨ Generate Side & Face" : "Regenerate Sheet"}
                                        </button>
                                      );
                                    })()}
                                    <button
                                      onClick={() => approveSheet(c.id)}
                                      disabled={c.character_sheet.is_approved}
                                      style={{
                                        ...btnPrimary,
                                        flex: 1, padding: "4px 0", fontSize: 10, justifyContent: "center",
                                        background: c.character_sheet.is_approved ? "#22c55e" : accent,
                                        cursor: c.character_sheet.is_approved ? "default" : "pointer"
                                      }}
                                    >
                                      {c.character_sheet.is_approved ? "✓ Approved" : "Approve Look"}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => generateSheet(c.id)}
                                  disabled={generatingSheet[c.id]}
                                  style={{ ...btnPrimary, width: "100%", justifyContent: "center", padding: "7px 0", fontSize: 11 }}
                                >
                                  {generatingSheet[c.id] ? <><RefreshCw size={12} className="animate-spin" /> Generating Sheet...</> : "Generate Sheet"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ padding: "12px 16px", borderBottom: `1px solid ${border}` }}>
                      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                        {(["upload", "generate"] as const).map(m => (
                          <button key={m} onClick={() => setProdCreateMode(m)} style={{ flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 600, border: `1px solid ${prodCreateMode === m ? "#8B5CF6" : border}`, borderRadius: 6, background: prodCreateMode === m ? "#8B5CF6" : "transparent", color: prodCreateMode === m ? "#fff" : sub, cursor: "pointer" }}>
                            {m === "upload" ? "⬆ Upload Photos" : "✨ Generate from Description"}
                          </button>
                        ))}
                      </div>
                      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                        <input value={newProdName} onChange={e => setNewProdName(e.target.value)} placeholder="Product name (e.g. Red Can)" style={{ ...inputStyle, padding: "8px 12px" }} />
                        {prodCreateMode === "upload" ? (
                          <>
                            {newProdImgs.length > 0 && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {newProdImgs.map((img, i) => (
                                  <div key={i} style={{ position: "relative", width: 52, height: 52, borderRadius: 6, overflow: "hidden", border: `1px solid ${border}` }}>
                                    <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    <button onClick={() => removeProdImg(i)} style={{ position: "absolute", top: 1, right: 1, background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 9, lineHeight: 1 }}>✕</button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <label style={{ width: "100%", height: newProdImgs.length > 0 ? 40 : 64, border: `1px dashed ${border}`, borderRadius: 8, display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", cursor: "pointer", color: sub, fontSize: 11, gap: 6 }}>
                              <Upload size={14} /> {newProdImgs.length > 0 ? `Add more (${newProdImgs.length} uploaded)` : "Upload Product Photos (multi)"}
                              <input ref={prodFileRef} type="file" accept="image/*" multiple onChange={onProdImgUpload} style={{ display: "none" }} />
                            </label>
                            <button onClick={createProd} disabled={!newProdName || newProdImgs.length === 0} style={{ ...btnPrimary, width: "100%", justifyContent: "center", background: "#8B5CF6", opacity: (!newProdName || newProdImgs.length === 0) ? 0.4 : 1, cursor: (!newProdName || newProdImgs.length === 0) ? "not-allowed" : "pointer" }}>Add Product</button>
                          </>
                        ) : (
                          <>
                            <textarea value={newProdDesc} onChange={e => setNewProdDesc(e.target.value)} placeholder="Describe the product: category, colour, material, shape, branding, key features..." style={{ ...inputStyle, height: 80, resize: "none", fontSize: 12 }} />
                            <button onClick={generateProdFromDesc} disabled={generatingProd || !newProdName || !newProdDesc.trim()} style={{ ...btnPrimary, width: "100%", justifyContent: "center", background: "#8B5CF6", opacity: (generatingProd || !newProdName || !newProdDesc.trim()) ? 0.4 : 1, cursor: (generatingProd || !newProdName || !newProdDesc.trim()) ? "not-allowed" : "pointer" }}>
                              {generatingProd ? <><RefreshCw size={12} className="animate-spin" /> Generating...</> : <><Sparkles size={12} /> Generate Product</>}
                            </button>
                            <p style={{ fontSize: 10, color: sub, textAlign: "center", margin: 0 }}>AI will generate a reference image + auto-extract DNA</p>
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                      {prods.length === 0 && <div style={{ color: sub, fontSize: 12, textAlign: "center", padding: 20 }}>No products yet</div>}
                      {prods.map(p => (
                        <div key={p.id} style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: "hidden", background: card }}>
                          <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", gap: 10 }}>
                            <div style={{ width: 36, height: 36, borderRadius: 8, overflow: "hidden", border: `2px solid #8B5CF6`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isDark ? "#2a2a2a" : "#eee" }}>
                              {p.image_path
                                ? <img src={p.image_path.startsWith('http') ? p.image_path : `${API}/${p.image_path}`} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { (e.target as HTMLImageElement).style.display='none'; }}/>
                                : <Package size={18} color="#8B5CF6" />
                              }
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                              <div style={{ fontSize: 10, color: p.product_dna ? "#8B5CF6" : sub }}>{p.product_dna ? "✓ Product Ready" : "Needs Analysis"}</div>
                            </div>
                            <button onClick={() => deleteProd(p.id)} style={{ ...btnGhost, padding: 4, border: "none" }}><Trash size={13} color="#ef4444" /></button>
                          </div>
                          {!p.product_dna ? (
                            <div style={{ padding: "8px 14px 12px" }}>
                              <button onClick={() => analyzeProd(p.id)} disabled={analyzingProd[p.id]} style={{ ...btnPrimary, width: "100%", justifyContent: "center", background: isDark ? "#333" : "#eee", color: txt, fontSize: 12, padding: "7px 0" }}>
                                {analyzingProd[p.id] ? <><RefreshCw size={12} className="animate-spin" /> Analyzing...</> : <><Package size={12} /> Extract DNA</>}
                              </button>
                            </div>
                          ) : (
                            <div style={{ padding: "6px 14px 10px", fontSize: 11, color: sub, lineHeight: 1.5 }}>
                              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><b style={{ color: txt }}>Type:</b> {p.product_dna.product_type || "Extracted"}</div>
                              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><b style={{ color: txt }}>Colors:</b> {p.product_dna.color_palette || "Ready"}</div>
                              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                                {p.dna_extraction_confidence !== undefined && (
                                  <span style={{ color: p.dna_extraction_confidence > 0.7 ? "#22c55e" : "#eab308", fontWeight: 600 }}>Confidence: {Math.round(p.dna_extraction_confidence * 100)}%</span>
                                )}
                                {p.drift_warning && <span style={{ color: "#ef4444", fontWeight: 600 }}>⚠ DNA Drifted</span>}
                              </div>
                              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                <button
                                  onClick={() => openProdDnaEditor(p)}
                                  style={{
                                    ...btnGhost,
                                    flex: 1, padding: "4px 0", fontSize: 10, justifyContent: "center"
                                  }}
                                >
                                  ✏️ Edit DNA
                                </button>
                                <button
                                  onClick={() => approveProdLook(p.id)}
                                  style={{
                                    ...btnPrimary,
                                    flex: 1, padding: "4px 0", fontSize: 10, justifyContent: "center",
                                    background: p.is_approved ? "#22c55e" : "#8B5CF6",
                                  }}
                                >
                                  {p.is_approved ? "✓ Approved" : "Approve Look"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* === MAIN CANVAS === */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <div style={{ padding: "12px 20px", borderBottom: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, minHeight: 56 }}>
                  {/* Left: back to chat & Step 2 + title */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1, overflow: "hidden" }}>
                    <button
                      onClick={() => {
                        setActiveStep(1);
                        setCreationMode("chat");
                      }}
                      style={{
                        ...btnGhost,
                        gap: 6, padding: "6px 12px", flexShrink: 0,
                        color: accent,
                        borderColor: `${accent}40`,
                        background: isDark ? "rgba(249,87,56,0.12)" : "rgba(249,87,56,0.06)",
                        fontSize: 12, fontWeight: 700, borderRadius: 8,
                        cursor: "pointer"
                      }}
                      title="Return to AI Chat & Contact Sheet screen"
                    >
                      <ArrowLeft size={13} />
                      <MessageSquare size={13} style={{ color: accent }} />
                      <span>Back to AI Chat</span>
                    </button>
                    <button
                      onClick={() => setActiveStep(2)}
                      style={{ ...btnGhost, gap: 5, padding: "6px 10px", flexShrink: 0, fontSize: 11, borderRadius: 8 }}
                      title="Back to Step 2: Lock Characters & Products"
                    >
                      <Users size={12} /> Step 2: Characters ({chars.length})
                    </button>
                    <div style={{ width: 1, height: 22, background: border, flexShrink: 0 }} />
                    <div style={{ minWidth: 0, overflow: "hidden" }}>
                      <h1 style={{ fontSize: 15, fontWeight: 700, margin: 0, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{activeSb.name}</h1>
                      <p style={{ color: sub, fontSize: 11, margin: "2px 0 0", whiteSpace: "nowrap" }}>Mention @CharacterName in prompts for consistency</p>
                    </div>
                  </div>
                  {/* Right: action buttons */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    {activeSb?.contact_sheet_url ? (
                      <button
                        onClick={async () => {
                          try {
                            toast.loading("Synchronizing frames from contact sheet...", { id: "sync-cs" });
                            const res = await api.post(`/api/storyboard/${activeSb.id}/sync-contact-sheet-frames`);
                            if (res.data?.frames) {
                              setFrames(res.data.frames);
                              toast.success("All frames synchronized from contact sheet!", { id: "sync-cs" });
                            }
                          } catch (e: any) {
                            toast.error("Sync failed: " + (e.response?.data?.detail || e.message), { id: "sync-cs" });
                          }
                        }}
                        style={{
                          ...btnPrimary,
                          background: "linear-gradient(135deg, #10b981, #059669)",
                          boxShadow: "0 4px 14px rgba(16,185,129,0.35)",
                          flexShrink: 0, whiteSpace: "nowrap", padding: "7px 14px", fontSize: 12
                        }}
                      >
                        <RefreshCw size={13} /> Sync from Contact Sheet
                      </button>
                    ) : frames.length > 0 && (
                      <button
                        onClick={() => autoGenerateFrames(activeSb.id, frames)}
                        disabled={!!autoGenState}
                        style={{
                          ...btnPrimary,
                          background: autoGenState ? (isDark ? "#333" : "#ddd") : "linear-gradient(135deg, #7C3AED, #9333EA)",
                          boxShadow: autoGenState ? "none" : "0 4px 14px rgba(124,58,237,0.35)",
                          flexShrink: 0, whiteSpace: "nowrap", padding: "7px 14px", fontSize: 12
                        }}
                      >
                        <Sparkles size={13} /> {autoGenState ? "Generating Frames..." : `Generate All Frames (${frames.length})`}
                      </button>
                    )}
                    <button
                      onClick={handleExportScriptPdf}
                      disabled={exportingPdf}
                      style={{
                        ...btnGhost,
                        padding: "7px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: txt,
                        borderColor: border,
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                        opacity: exportingPdf ? 0.7 : 1,
                        cursor: exportingPdf ? "wait" : "pointer"
                      }}
                      title="Download complete screenplay script PDF with character sheets and storyboard frames"
                    >
                      <Download size={13} /> {exportingPdf ? "Preparing PDF..." : "Download Script"}
                    </button>
                    <button onClick={addFrame} style={{ ...btnPrimary, flexShrink: 0, whiteSpace: "nowrap", padding: "7px 14px", fontSize: 12 }}><Plus size={15} /> Add Frame</button>
                  </div>
                </div>

                {/* ── VISUAL FIDELITY / CONTACT SHEET SYNC BANNER ── */}
                {activeSb?.contact_sheet_url ? (
                  <div style={{
                    padding: "8px 20px",
                    borderBottom: `1px solid ${border}`,
                    background: isDark ? "rgba(16,185,129,0.08)" : "rgba(16,185,129,0.05)",
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 11
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: isDark ? "#34d399" : "#059669", minWidth: 0 }}>
                      <Sparkles size={13} color="#10b981" style={{ flexShrink: 0 }} />
                      <span><b>Visual Consistency Locked:</b> Every frame is synchronized directly from your approved storyboard contact sheet panels for 100% visual coherence.</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        onClick={() => {
                          setActiveStep(1);
                          setCreationMode("chat");
                        }}
                        style={{ ...btnGhost, padding: "4px 10px", fontSize: 11, color: isDark ? "#34d399" : "#059669", borderColor: "rgba(16,185,129,0.4)", display: "inline-flex", alignItems: "center", gap: 4 }}
                        title="View contact sheet and scene breakdown in Chat"
                      >
                        <Eye size={11} /> View in AI Chat
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            toast.loading("Re-slicing contact sheet panels...", { id: "sync-cs" });
                            const res = await api.post(`/api/storyboard/${activeSb.id}/sync-contact-sheet-frames`);
                            if (res.data?.frames) {
                              setFrames(res.data.frames);
                              toast.success("Synchronized all frames from approved contact sheet!", { id: "sync-cs" });
                            }
                          } catch (e: any) {
                            toast.error("Sync failed: " + (e.response?.data?.detail || e.message), { id: "sync-cs" });
                          }
                        }}
                        style={{ ...btnGhost, padding: "4px 10px", fontSize: 11, color: isDark ? "#34d399" : "#059669", borderColor: "rgba(16,185,129,0.4)" }}
                      >
                        <RefreshCw size={10} /> Re-sync
                      </button>
                    </div>
                  </div>
                ) : chars.length > 0 && !autoGenState && (
                  <div style={{
                    padding: "8px 20px",
                    borderBottom: `1px solid ${border}`,
                    background: isDark ? "rgba(124,58,237,0.06)" : "rgba(124,58,237,0.04)",
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 11
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: sub, minWidth: 0 }}>
                      <Sparkles size={13} color="#7C3AED" style={{ flexShrink: 0 }} />
                      <span><b>Character Consistency Anchor:</b> Review character reference sheets in the left sidebar to ensure character consistency before generating all frames.</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: chars.every(c => c.character_sheet?.is_approved) ? "#22c55e" : sub, fontWeight: 600 }}>
                        {chars.filter(c => c.character_sheet?.is_approved).length}/{chars.length} Sheets Approved
                      </span>
                      {frames.length > 0 && (
                        <button
                          onClick={() => autoGenerateFrames(activeSb.id, frames)}
                          disabled={!!autoGenState}
                          style={{ ...btnPrimary, padding: "4px 10px", fontSize: 11, background: "linear-gradient(135deg, #7C3AED, #9333EA)" }}
                        >
                          <Play size={10} /> Start Frame Generation
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* AUTO-GEN ALL FRAMES PROGRESS BAR */}
                {autoGenState && (
                  <div style={{
                    padding: "10px 20px",
                    background: isDark ? "#1a1528" : "#f5f0ff",
                    borderBottom: `1px solid ${isDark ? "#3b2d54" : "#e0d4fc"}`,
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                      <RefreshCw size={14} className="animate-spin" color="#7C3AED" style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, color: txt, marginBottom: 4 }}>
                          <span>Generating Frame {autoGenState.current} of {autoGenState.total}</span>
                          <span style={{ color: "#7C3AED" }}>{Math.round((autoGenState.current / autoGenState.total) * 100)}%</span>
                        </div>
                        <div style={{ height: 4, background: isDark ? "#333" : "#e0e0e0", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{
                            height: "100%",
                            width: `${(autoGenState.current / autoGenState.total) * 100}%`,
                            background: "linear-gradient(90deg, #7C3AED, #9333EA)",
                            borderRadius: 2,
                            transition: "width 0.4s ease"
                          }} />
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        autoGenAbort.current = true;
                        if (activeSb) {
                          try {
                            await api.post(`/api/storyboard/${activeSb.id}/cancel`);
                          } catch (e) {
                            console.error('Failed to cancel storyboard tasks on backend:', e);
                          }
                        }
                        setAutoGenState(null);
                      }}
                      style={{ ...btnGhost, color: "#ef4444", borderColor: "#ef444440", fontSize: 11, padding: "4px 10px", flexShrink: 0 }}
                    >
                      Stop
                    </button>
                  </div>
                )}

                {/* Frame Canvas Sequence */}
                <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", display: "flex", gap: 16, padding: "20px 24px", alignItems: "flex-start" }}>
                  {frames.length === 0 && (
                    <div style={{ margin: "auto", textAlign: "center", color: sub }}>
                      <div style={{ fontSize: 36, marginBottom: 8 }}>🎬</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: txt }}>No frames yet</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>Click &quot;Add Frame&quot; or import a creative brief to get started</div>
                    </div>
                  )}

                  {frames.map((frame, idx) => {
                    const charNames = chars.map((c: any) => c.name);
                    const prodNames = prods.map((p: any) => p.name);
                    const matchedEntities = [...charNames, ...prodNames].filter((name: string) => {
                      const prompt = frame.scene_prompt || "";
                      return prompt.toLowerCase().includes(name.toLowerCase());
                    });
                    const s = getSettings(frame.id);
                    const showSettings = settingsOpen === frame.id;

                    return (
                      <React.Fragment key={frame.id}>
                        <div
                          style={{
                          background: card,
                          border: `1px solid ${border}`,
                          borderRadius: 16,
                          display: "flex",
                          flexDirection: "column",
                          boxShadow: isDark ? "0 4px 24px rgba(0,0,0,0.4)" : "0 4px 20px rgba(0,0,0,0.08)",
                          minWidth: 320,
                          maxWidth: 400,
                          width: "calc((100vw - 280px - 300px - 48px - 60px) / 2.2)",
                          flexShrink: 0,
                          transition: "box-shadow 0.2s",
                          overflow: "hidden",
                        }}
                      >

                        {/* ── HEADER ── */}
                        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 10, fontWeight: 800, color: accent, letterSpacing: 1.5, textTransform: "uppercase" }}>Frame {idx + 1}</span>
                            {frame.model_used && <span style={{ fontSize: 9, color: sub, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", padding: "2px 7px", borderRadius: 20, fontWeight: 600 }}>{frame.model_used}</span>}
                            {frame.is_anchor && <span title="Anchor Frame" style={{ fontSize: 10 }}>⚓</span>}
                            {hasVideoAccess && frame.video_status === "generating" && (
                              <span style={{ fontSize: 9, color: "#8B5CF6", background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", padding: "2px 7px", borderRadius: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>
                                <RefreshCw size={9} className="animate-spin" /> Animating...
                              </span>
                            )}
                            {hasVideoAccess && frame.video_url && (
                              <button
                                onClick={() => openSingleFrameAnimation(frame)}
                                title="Watch animated video (Google Veo 3.1)"
                                style={{ fontSize: 9, color: "#fff", background: "linear-gradient(135deg, #8B5CF6, #6366F1)", border: "none", padding: "2px 8px", borderRadius: 20, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, boxShadow: "0 2px 6px rgba(139,92,246,0.4)" }}
                              >
                                <Play size={8} fill="#fff" /> Video ({frame.video_duration || 6}s)
                              </button>
                            )}
                            {hasVideoAccess && frame.transition_video_status === "generating" && (
                              <span style={{ fontSize: 9, color: "#8B5CF6", background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", padding: "2px 7px", borderRadius: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>
                                <RefreshCw size={9} className="animate-spin" /> Transition...
                              </span>
                            )}
                            {hasVideoAccess && frame.transition_video_url && (
                              <button
                                onClick={() => {
                                  const target = frames.find((f: any) => f.id === frame.transition_to_frame_id) || (idx === frames.length - 1 ? frames[0] : frames[idx + 1]);
                                  openTransitionAnimation(frame, target);
                                }}
                                title="Watch transition video (Google Veo 3.1)"
                                style={{ fontSize: 9, color: "#fff", background: "linear-gradient(135deg, #6366F1, #8B5CF6)", border: "none", padding: "2px 8px", borderRadius: 20, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, boxShadow: "0 2px 6px rgba(99,102,241,0.4)" }}
                              >
                                <Play size={8} fill="#fff" /> Transition ({frame.transition_video_duration || 6}s)
                              </button>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                            {frame.status === "generating" && (
                              <button
                                onClick={() => cancelFrameGen(frame.id)}
                                title="Stop frame generation"
                                style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.15)", color: "#ef4444", cursor: "pointer", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", gap: 3, marginRight: 2 }}
                              >
                                ✕ Stop
                              </button>
                            )}
                            {hasVideoAccess && frame.image_path && (
                              <button
                                onClick={() => openSingleFrameAnimation(frame)}
                                title="Animate Frame with Google Veo 3.1"
                                style={{ height: 28, padding: "0 7px", borderRadius: 7, border: "1px solid rgba(139,92,246,0.35)", background: frame.video_url ? "rgba(139,92,246,0.15)" : "transparent", color: "#8B5CF6", cursor: "pointer", display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, transition: "all 0.15s" }}
                                onMouseOver={e => { e.currentTarget.style.background = "rgba(139,92,246,0.25)"; }}
                                onMouseOut={e => { e.currentTarget.style.background = frame.video_url ? "rgba(139,92,246,0.15)" : "transparent"; }}
                              >
                                <Film size={12} />
                                <span style={{ fontSize: 10 }}>{frame.video_url ? "Video" : "Animate"}</span>
                              </button>
                            )}
                            <button
                              onClick={() => setSettingsOpen(showSettings ? null : frame.id)}
                              title="Frame settings"
                              style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${showSettings ? accent : border}`, background: showSettings ? `${accent}18` : "transparent", color: showSettings ? accent : sub, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                            >
                              <Settings size={13} />
                            </button>
                            <button
                              onClick={() => deleteFrame(frame.id)}
                              title="Delete frame"
                              style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid transparent", background: "transparent", color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                              onMouseOver={e => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; }}
                              onMouseOut={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
                            >
                              <Trash size={13} />
                            </button>
                          </div>
                        </div>

                      {/* ── SETTINGS DRAWER ── */}
                      {showSettings && (
                        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${border}`, background: isDark ? "#161616" : "#f6f6f6", display: "flex", flexDirection: "column", gap: 10, fontSize: 11 }}>
                          <div>
                            <div style={{ color: sub, marginBottom: 5, fontWeight: 700, fontSize: 10, letterSpacing: 0.5 }}>MODEL</div>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {MODELS.map(m => <button key={m} onClick={() => setSetting(frame.id, "model", m)} style={{ padding: "4px 10px", borderRadius: 20, border: `1px solid ${s.model === m ? accent : border}`, background: s.model === m ? accent : "transparent", color: s.model === m ? "#fff" : txt, cursor: "pointer", fontSize: 11, fontWeight: s.model === m ? 600 : 400, transition: "all 0.15s" }}>{m}</button>)}
                            </div>
                          </div>
                          {s.model === "ChatGPT" && (
                            <div>
                              <div style={{ color: sub, marginBottom: 5, fontWeight: 700, fontSize: 10, letterSpacing: 0.5 }}>CHATGPT VERSION</div>
                              <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 2 }}>
                                {CHATGPT_SUB_MODELS.map(m => <button key={m.id} onClick={() => setSetting(frame.id, "chatgptModel", m.id)} style={{ padding: "4px 10px", borderRadius: 20, border: `1px solid ${s.chatgptModel === m.id ? accent : border}`, background: s.chatgptModel === m.id ? accent : "transparent", color: s.chatgptModel === m.id ? "#fff" : txt, cursor: "pointer", fontSize: 11, flexShrink: 0, transition: "all 0.15s" }}>{m.label}</button>)}
                              </div>
                            </div>
                          )}
                          <div>
                            <div style={{ color: sub, marginBottom: 5, fontWeight: 700, fontSize: 10, letterSpacing: 0.5 }}>RATIO</div>
                            <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 2 }}>
                              {RATIOS.map(r => <button key={r.id} onClick={() => setSetting(frame.id, "ratio", r.id)} style={{ padding: "4px 10px", borderRadius: 20, border: `1px solid ${s.ratio === r.id ? accent : border}`, background: s.ratio === r.id ? accent : "transparent", color: s.ratio === r.id ? "#fff" : txt, cursor: "pointer", fontSize: 11, flexShrink: 0, transition: "all 0.15s" }}>{r.label}</button>)}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 16 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ color: sub, marginBottom: 5, fontWeight: 700, fontSize: 10, letterSpacing: 0.5 }}>QUALITY</div>
                              <div style={{ display: "flex", gap: 4 }}>
                                {QUALITIES.map(q => <button key={q.id} onClick={() => setSetting(frame.id, "quality", q.id)} style={{ padding: "4px 8px", borderRadius: 20, border: `1px solid ${s.quality === q.id ? accent : border}`, background: s.quality === q.id ? accent : "transparent", color: s.quality === q.id ? "#fff" : txt, cursor: "pointer", fontSize: 10, flexShrink: 0, transition: "all 0.15s" }}>{q.label}</button>)}
                              </div>
                            </div>
                          </div>
                          <div>
                            <div style={{ color: sub, marginBottom: 5, fontWeight: 700, fontSize: 10, letterSpacing: 0.5 }}>STYLE</div>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {STYLES.map(st => <button key={st} onClick={() => setSetting(frame.id, "style", st)} style={{ padding: "4px 10px", borderRadius: 20, border: `1px solid ${s.style === st ? "#8B5CF6" : border}`, background: s.style === st ? "#8B5CF6" : "transparent", color: s.style === st ? "#fff" : txt, cursor: "pointer", fontSize: 11, transition: "all 0.15s" }}>{st}</button>)}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── IMAGE AREA ── */}
                      <div
                        style={{ aspectRatio: "16/9", background: isDark ? "#0d0d0d" : "#e4e4e4", position: "relative", overflow: "hidden", flexShrink: 0 }}
                        onMouseEnter={() => setHoveredFrame(frame.id)}
                        onMouseLeave={() => setHoveredFrame(null)}
                      >
                        {frame.image_path ? (
                          <>
                            <img
                              src={getSafeImageUrl(frame.image_path)}
                              alt={frame.scene_prompt || `Frame ${idx + 1}`}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                            {/* Hover overlay with download buttons & consistency score */}
                            <div style={{
                              position: "absolute", inset: 0,
                              background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)",
                              opacity: hoveredFrame === frame.id ? 1 : 0,
                              transition: "opacity 0.18s ease",
                              pointerEvents: hoveredFrame === frame.id ? "auto" : "none",
                              display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 10, gap: 6,
                            }}>
                              {/* Download & Video row */}
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                                  {(["PNG","JPG","TIFF"] as const).map(fmt => (
                                    <button
                                      key={fmt}
                                      onClick={() => downloadFrame(frame, idx, fmt.toLowerCase() as any)}
                                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, background: "rgba(255,255,255,0.18)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer", transition: "background 0.15s", flexShrink: 0 }}
                                      onMouseOver={e => { e.currentTarget.style.background = "rgba(255,255,255,0.32)"; }}
                                      onMouseOut={e => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; }}
                                    >
                                      <Download size={10} />{fmt}
                                    </button>
                                  ))}
                                  {hasVideoAccess && (
                                    frame.video_url ? (
                                      <button
                                        onClick={() => openSingleFrameAnimation(frame)}
                                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, background: "linear-gradient(135deg, #8B5CF6, #6366F1)", border: "1px solid rgba(255,255,255,0.35)", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
                                      >
                                        <Play size={10} fill="#fff" /> Watch Video
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => openSingleFrameAnimation(frame)}
                                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, background: "rgba(139,92,246,0.35)", backdropFilter: "blur(8px)", border: "1px solid rgba(139,92,246,0.5)", color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                                      >
                                        <Film size={10} /> Animate
                                      </button>
                                    )
                                  )}
                                </div>
                                {frame.consistency_score !== null && (
                                  <button
                                    onClick={() => setExpandedScore(expandedScore === frame.id ? null : frame.id)}
                                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, background: "rgba(255,255,255,0.18)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                                  >
                                    📊 {frame.consistency_score}%
                                  </button>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: sub, gap: 8 }}>
                            {frame.status === "generating" ? (
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                                <RefreshCw size={24} className="animate-spin" style={{ color: accent }} />
                                <span style={{ fontSize: 11, fontWeight: 600, color: accent }}>Generating Frame...</span>
                                <button
                                  onClick={() => cancelFrameGen(frame.id)}
                                  style={{
                                    padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.5)",
                                    background: "rgba(239,68,68,0.15)", color: "#ef4444", fontSize: 11, fontWeight: 700,
                                    cursor: "pointer", display: "flex", alignItems: "center", gap: 4, transition: "all 0.15s"
                                  }}
                                  onMouseOver={e => e.currentTarget.style.background = "rgba(239,68,68,0.25)"}
                                  onMouseOut={e => e.currentTarget.style.background = "rgba(239,68,68,0.15)"}
                                >
                                  ✕ Stop Generation
                                </button>
                              </div>
                            ) : (
                              <>
                                <span style={{ fontSize: 24, opacity: 0.4 }}>🎬</span>
                                <span style={{ fontSize: 11 }}>Ready to generate</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* ── CONSISTENCY REPORT DRAWER ── */}
                      {expandedScore === frame.id && frame.consistency_report && (
                        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${border}`, background: isDark ? "#141414" : "#fbfbfb", fontSize: 11 }}>
                          <div style={{ fontWeight: 700, color: txt, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                            <span>CONSISTENCY ANALYSIS</span>
                            <button onClick={() => setExpandedScore(null)} style={{ background: "none", border: "none", color: sub, cursor: "pointer" }}>✕</button>
                          </div>
                          {Object.entries(frame.consistency_report).map(([cid, score]: [string, any]) => (
                            <div key={cid} style={{ marginBottom: 10, padding: "8px 10px", background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)", borderRadius: 8 }}>
                              <div style={{ fontWeight: 600, color: txt, marginBottom: 4 }}>👤 {score.name}</div>
                              <div style={{ display: "flex", gap: 12, color: sub, marginBottom: 6, fontSize: 10 }}>
                                <span>Face: <b style={{ color: score.face_score >= 80 ? "#22c55e" : "#eab308" }}>{score.face_score}%</b></span>
                                <span>Outfit: <b style={{ color: score.outfit_score >= 80 ? "#22c55e" : "#eab308" }}>{score.outfit_score}%</b></span>
                                <span>Proportion: <b style={{ color: score.proportion_score >= 80 ? "#22c55e" : "#eab308" }}>{score.proportion_score}%</b></span>
                              </div>
                              {score.notes && <div style={{ color: sub, fontStyle: "italic", marginBottom: 6, fontSize: 10 }}>"{score.notes}"</div>}
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {(["outfit","face","all"] as const).map(t => (
                                  <button key={t} onClick={() => selectiveRelock(frame.id, cid, t)} disabled={!!relocking[frame.id]} style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${border}`, background: "transparent", color: sub, cursor: "pointer", fontSize: 10, whiteSpace: "nowrap", flexShrink: 0 }}>
                                    {relocking[frame.id] === t ? "..." : `🔁 ${t.charAt(0).toUpperCase()+t.slice(1)}`}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── PROMPT + CONTROLS ── */}
                      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

                        {/* Scene prompt header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: sub, textTransform: "uppercase", letterSpacing: 0.5 }}>Scene Prompt</span>
                        </div>

                        {/* Scene prompt textarea */}
                        <div style={{ position: "relative" }}>
                          {renderMentionDropdown(frame.id, "scene")}
                          <textarea
                            value={localPromptDrafts[frame.id] ?? frame.scene_prompt ?? ""}
                            onChange={e => {
                              const v = e.target.value;
                              setLocalPromptDrafts(p => ({ ...p, [frame.id]: v }));
                              editingFrameRef.current.add(frame.id);
                              setFrames(fs => fs.map(f => f.id === frame.id ? { ...f, scene_prompt: v } : f));
                              handleMentionChange(v, frame.id, "scene");
                            }}
                            onBlur={() => {
                              editingFrameRef.current.delete(frame.id);
                            }}
                            placeholder="Describe the scene… e.g. @Character walking through a rain-soaked market"
                            style={{ ...inputStyle, height: 60, resize: "none", fontSize: 12, lineHeight: 1.5, width: "100%", boxSizing: "border-box" }}
                          />
                        </div>

                        {/* Generate / Regenerate CTA */}
                        {frame.status === "generating" ? (
                          <button
                            onClick={() => cancelFrameGen(frame.id)}
                            style={{
                              width: "100%", padding: "10px 0", borderRadius: 10,
                              border: "1px solid rgba(239,68,68,0.5)",
                              background: "rgba(239,68,68,0.12)",
                              color: "#ef4444",
                              cursor: "pointer",
                              fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                              transition: "all 0.2s",
                            }}
                            onMouseOver={e => { e.currentTarget.style.background = "rgba(239,68,68,0.22)"; }}
                            onMouseOut={e => { e.currentTarget.style.background = "rgba(239,68,68,0.12)"; }}
                          >
                            <RefreshCw size={13} className="animate-spin" /> Stop Generation (✕)
                          </button>
                        ) : (
                          <button
                            onClick={() => generateFrame(frame.id, frame.scene_prompt)}
                            disabled={!frame.scene_prompt?.trim()}
                            style={{
                              width: "100%", padding: "10px 0", borderRadius: 10, border: "none",
                              background: !frame.scene_prompt?.trim()
                                ? (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)")
                                : `linear-gradient(135deg, ${accent}, #e84d2a)`,
                              color: !frame.scene_prompt?.trim() ? sub : "#fff",
                              cursor: !frame.scene_prompt?.trim() ? "not-allowed" : "pointer",
                              fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                              boxShadow: !frame.scene_prompt?.trim() ? "none" : "0 4px 14px rgba(249,87,56,0.35)",
                              transition: "all 0.2s",
                            }}
                            onMouseOver={e => { if (frame.scene_prompt?.trim()) e.currentTarget.style.boxShadow = "0 6px 20px rgba(249,87,56,0.5)"; }}
                            onMouseOut={e => { e.currentTarget.style.boxShadow = !frame.scene_prompt?.trim() ? "none" : "0 4px 14px rgba(249,87,56,0.35)"; }}
                          >
                            {frame.image_path
                              ? <><Pencil size={13} /> Regenerate</>
                              : <><Play size={13} /> Generate Frame</>}
                          </button>
                        )}

                        {/* Google Veo 3.1 Frame Animation Button (when image exists) */}
                        {hasVideoAccess && frame.image_path && (
                          <button
                            onClick={() => openSingleFrameAnimation(frame)}
                            disabled={frame.video_status === "generating"}
                            style={{
                              width: "100%",
                              padding: "8px 0",
                              borderRadius: 10,
                              border: "1px solid rgba(139,92,246,0.35)",
                              background: frame.video_status === "generating"
                                ? "rgba(139,92,246,0.08)"
                                : frame.video_url
                                ? "rgba(139,92,246,0.12)"
                                : "transparent",
                              color: "#8B5CF6",
                              cursor: "pointer",
                              fontSize: 12,
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                              transition: "all 0.15s",
                            }}
                            onMouseOver={e => { e.currentTarget.style.background = "rgba(139,92,246,0.2)"; }}
                            onMouseOut={e => { e.currentTarget.style.background = frame.video_url ? "rgba(139,92,246,0.12)" : "transparent"; }}
                          >
                            {frame.video_status === "generating" ? (
                              <><RefreshCw size={12} className="animate-spin" /> Animating with Veo 3.1...</>
                            ) : frame.video_url ? (
                              <><Play size={12} fill="#8B5CF6" /> Watch Veo 3.1 Video ({frame.video_duration || 5}s)</>
                            ) : (
                              <><Film size={12} /> Animate Frame (Veo 3.1)</>
                            )}
                          </button>
                        )}

                        {/* Iterate row (only when image exists) */}
                        {frame.image_path && (
                          <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                            <div style={{ position: "relative", flex: 1 }}>
                              {renderMentionDropdown(frame.id, "iteration")}
                              <input
                                value={iterationPrompts[frame.id] || ""}
                                onChange={e => {
                                  const v = e.target.value;
                                  setIterationPrompts(prev => ({ ...prev, [frame.id]: v }));
                                  handleMentionChange(v, frame.id, "iteration");
                                }}
                                placeholder="Refine… e.g. add @Character in background"
                                style={{ ...inputStyle, padding: "8px 12px", fontSize: 11, width: "100%" }}
                                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); iterateFrame(frame.id); } }}
                              />
                            </div>
                            <button
                              onClick={() => iterateFrame(frame.id)}
                              disabled={frame.status === "generating" || !iterationPrompts[frame.id]?.trim()}
                              style={{
                                padding: "8px 12px", borderRadius: 9, border: `1px solid ${border}`,
                                background: (frame.status === "generating" || !iterationPrompts[frame.id]?.trim()) ? "transparent" : "rgba(124,58,237,0.1)",
                                color: (frame.status === "generating" || !iterationPrompts[frame.id]?.trim()) ? sub : "#7C3AED",
                                cursor: (frame.status === "generating" || !iterationPrompts[frame.id]?.trim()) ? "not-allowed" : "pointer",
                                fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 5,
                                opacity: (frame.status === "generating" || !iterationPrompts[frame.id]?.trim()) ? 0.4 : 1,
                                flexShrink: 0, transition: "all 0.15s",
                              }}
                            >
                              <Sparkles size={11} /> Iterate
                            </button>
                          </div>
                        )}

                        {/* AI Prompt — collapsed single line */}
                        {frame.expanded_prompt && (
                          <div style={{ fontSize: 10, color: sub, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)", padding: "6px 10px", borderRadius: 8, border: `1px solid ${border}`, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            <b style={{ color: txt, marginRight: 4 }}>AI:</b>{frame.expanded_prompt}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Transition connector between Frame N and Frame N+1 */}
                    {hasVideoAccess && (idx < frames.length - 1 ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          alignSelf: "center",
                          flexShrink: 0,
                          margin: "0 -2px",
                          zIndex: 2,
                        }}
                      >
                        <div style={{ width: 2, height: 16, background: border }} />
                        <button
                          onClick={() => openTransitionAnimation(frame, frames[idx + 1])}
                          disabled={!frame.image_path || !frames[idx + 1]?.image_path}
                          title={
                            !frame.image_path || !frames[idx + 1]?.image_path
                              ? "Generate images for both frames first to animate transition"
                              : `Animate transition between Frame ${idx + 1} and Frame ${idx + 2} with Google Veo 3.1`
                          }
                          style={{
                            padding: "7px 11px",
                            borderRadius: 20,
                            border: `1px solid ${frame.transition_video_url ? "#8B5CF6" : border}`,
                            background: frame.transition_video_status === "generating"
                              ? "rgba(139,92,246,0.15)"
                              : frame.transition_video_url
                              ? "linear-gradient(135deg, #8B5CF6, #6366F1)"
                              : (isDark ? "#1a1a1a" : "#ffffff"),
                            color: frame.transition_video_url ? "#fff" : (isDark ? "#e2e8f0" : "#334155"),
                            cursor: (!frame.image_path || !frames[idx + 1]?.image_path) ? "not-allowed" : "pointer",
                            opacity: (!frame.image_path || !frames[idx + 1]?.image_path) ? 0.35 : 1,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 10,
                            fontWeight: 700,
                            boxShadow: frame.transition_video_url
                              ? "0 4px 12px rgba(139,92,246,0.35)"
                              : "0 2px 6px rgba(0,0,0,0.06)",
                            transition: "all 0.15s",
                            whiteSpace: "nowrap",
                          }}
                          onMouseOver={e => {
                            if (frame.image_path && frames[idx + 1]?.image_path && !frame.transition_video_url) {
                              e.currentTarget.style.borderColor = "#8B5CF6";
                              e.currentTarget.style.color = "#8B5CF6";
                            }
                          }}
                          onMouseOut={e => {
                            if (!frame.transition_video_url) {
                              e.currentTarget.style.borderColor = border;
                              e.currentTarget.style.color = isDark ? "#e2e8f0" : "#334155";
                            }
                          }}
                        >
                          {frame.transition_video_status === "generating" ? (
                            <>
                              <RefreshCw size={11} className="animate-spin" style={{ color: "#8B5CF6" }} />
                              <span style={{ color: "#8B5CF6" }}>Transition...</span>
                            </>
                          ) : frame.transition_video_url ? (
                            <>
                              <Play size={9} fill="#fff" />
                              <span>Transition ({frame.transition_video_duration || 6}s)</span>
                            </>
                          ) : (
                            <>
                              <Film size={11} style={{ color: "#8B5CF6" }} />
                              <span>Transition {idx + 1}→{idx + 2}</span>
                            </>
                          )}
                        </button>
                        <div style={{ width: 2, height: 16, background: border }} />
                      </div>
                    ) : frames.length > 1 ? (
                      /* Last Frame Transition connector (Loop back to Frame 1 or chosen target) */
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          alignSelf: "center",
                          flexShrink: 0,
                          margin: "0 -2px",
                          zIndex: 2,
                        }}
                      >
                        <div style={{ width: 2, height: 16, background: border }} />
                        <button
                          onClick={() => {
                            const target = frames.find((f: any) => f.id === frame.transition_to_frame_id) || frames[0];
                            openTransitionAnimation(frame, target);
                          }}
                          disabled={!frame.image_path || !frames[0]?.image_path}
                          title={
                            !frame.image_path || !frames[0]?.image_path
                              ? "Generate images first to animate transition"
                              : `Animate transition from last Frame ${idx + 1} back to Frame 1 (Loop) with Google Veo 3.1`
                          }
                          style={{
                            padding: "7px 11px",
                            borderRadius: 20,
                            border: `1px solid ${frame.transition_video_url ? "#8B5CF6" : border}`,
                            background: frame.transition_video_status === "generating"
                              ? "rgba(139,92,246,0.15)"
                              : frame.transition_video_url
                              ? "linear-gradient(135deg, #8B5CF6, #6366F1)"
                              : (isDark ? "#1a1a1a" : "#ffffff"),
                            color: frame.transition_video_url ? "#fff" : (isDark ? "#e2e8f0" : "#334155"),
                            cursor: (!frame.image_path || !frames[0]?.image_path) ? "not-allowed" : "pointer",
                            opacity: (!frame.image_path || !frames[0]?.image_path) ? 0.35 : 1,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 10,
                            fontWeight: 700,
                            boxShadow: frame.transition_video_url
                              ? "0 4px 12px rgba(139,92,246,0.35)"
                              : "0 2px 6px rgba(0,0,0,0.06)",
                            transition: "all 0.15s",
                            whiteSpace: "nowrap",
                          }}
                          onMouseOver={e => {
                            if (frame.image_path && frames[0]?.image_path && !frame.transition_video_url) {
                              e.currentTarget.style.borderColor = "#8B5CF6";
                              e.currentTarget.style.color = "#8B5CF6";
                            }
                          }}
                          onMouseOut={e => {
                            if (!frame.transition_video_url) {
                              e.currentTarget.style.borderColor = border;
                              e.currentTarget.style.color = isDark ? "#e2e8f0" : "#334155";
                            }
                          }}
                        >
                          {frame.transition_video_status === "generating" ? (
                            <>
                              <RefreshCw size={11} className="animate-spin" style={{ color: "#8B5CF6" }} />
                              <span style={{ color: "#8B5CF6" }}>Looping...</span>
                            </>
                          ) : frame.transition_video_url ? (
                            <>
                              <Play size={9} fill="#fff" />
                              <span>Loop Video ({frame.transition_video_duration || 6}s)</span>
                            </>
                          ) : (
                            <>
                              <RotateCcw size={11} style={{ color: "#8B5CF6" }} />
                              <span>Transition {idx + 1}→1 (Loop)</span>
                            </>
                          )}
                        </button>
                        <div style={{ width: 2, height: 16, background: border }} />
                      </div>
                    ) : null)}
                  </React.Fragment>
                );
              })}

                {/* Add Frame Card */}
                <div onClick={addFrame} style={{ background: "transparent", border: `2px dashed ${border}`, borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 200, width: 200, flexShrink: 0, minHeight: 320, cursor: "pointer", color: sub, transition: "all 0.2s", alignSelf: "flex-start" }} onMouseOver={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; }} onMouseOut={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = sub; }}>
                  <Plus size={28} style={{ marginBottom: 10 }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Add Frame</span>
                </div>
                </div>
            </div>

            {/* ═══ PERSISTENT CHAT ASSISTANT DRAWER (Step 3) ═══ */}
            {chatDrawerOpen && (
              <div style={{
                width: 380,
                flexShrink: 0,
                borderLeft: `1px solid ${border}`,
                background: card,
                display: "flex",
                flexDirection: "column",
                zIndex: 20,
                boxShadow: isDark ? "-4px 0 20px rgba(0,0,0,0.4)" : "-4px 0 16px rgba(0,0,0,0.05)"
              }}>
                {/* Drawer Header */}
                <div style={{
                  padding: "14px 18px",
                  borderBottom: `1px solid ${border}`,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 8, background: `${accent}18`, display: "flex", alignItems: "center", justifyContent: "center", color: accent }}>
                      <Sparkles size={14} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: txt }}>AI Assistant Chat</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onClick={() => {
                        setChatDrawerOpen(false);
                        setActiveStep(1);
                        setCreationMode("chat");
                      }}
                      style={{
                        ...btnGhost,
                        padding: "3px 8px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4,
                        color: accent, borderColor: `${accent}40`
                      }}
                      title="Open full AI Chat screen"
                    >
                      <Maximize2 size={11} /> Full Chat
                    </button>
                    <button
                      onClick={() => setChatDrawerOpen(false)}
                      style={{ background: "none", border: "none", color: sub, cursor: "pointer", display: "flex", alignItems: "center", padding: 4 }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Drawer Message Stream */}
                <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                  {chatMessages.length === 0 ? (
                    <div style={{ textAlign: "center", color: sub, fontSize: 12, margin: "auto", padding: 20 }}>
                      No chat messages yet for this storyboard. Type below to ask anything or request revisions.
                    </div>
                  ) : (
                    chatMessages.map((msg: any, i: number) => (
                      <div key={msg.id || i} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                        <div style={{
                          maxWidth: "85%",
                          padding: "9px 13px",
                          borderRadius: msg.role === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                          background: msg.role === "user" ? accent : (isDark ? "#242424" : "#f3f4f6"),
                          color: msg.role === "user" ? "#fff" : txt,
                          fontSize: 12, lineHeight: 1.45,
                          border: msg.role === "user" ? "none" : `1px solid ${border}`
                        }}>
                          {((msg.image_urls && msg.image_urls.length > 0) || (msg.images && msg.images.length > 0)) && (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                              {(msg.image_urls || msg.images || []).map((imgUrl: string, imgIdx: number) => (
                                <div
                                  key={imgIdx}
                                  style={{ width: 64, height: 64, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.6)", cursor: "pointer" }}
                                  onClick={() => window.open(getSafeImageUrl(imgUrl), "_blank")}
                                  title="Click to view image"
                                >
                                  <img
                                    src={getSafeImageUrl(imgUrl)}
                                    alt="Reference"
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                          {msg.content}
                          {msg.image_path && (
                            <div style={{ marginTop: 6, borderRadius: 8, overflow: "hidden", border: `1px solid ${border}`, cursor: "pointer" }} onClick={() => window.open(getSafeImageUrl(msg.image_path), "_blank")}>
                              <img
                                src={getSafeImageUrl(msg.image_path)}
                                alt="Reference"
                                style={{ width: "100%", maxHeight: 180, objectFit: "cover" }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  {chatSubmitting && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, color: sub, padding: "6px 10px", background: isDark ? "rgba(249,87,56,0.08)" : "rgba(249,87,56,0.05)", borderRadius: 8, border: `1px solid ${accent}30` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <RefreshCw size={12} className="animate-spin" style={{ color: accent }} />
                        <span>Thinking...</span>
                      </div>
                      <button
                        onClick={handleStopChatProcessing}
                        title="Stop processing"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "2px 8px", borderRadius: 4,
                          background: "#ef4444", color: "#fff", border: "none",
                          fontSize: 10, fontWeight: 700, cursor: "pointer"
                        }}
                      >
                        <Square size={8} fill="#fff" />
                        <span>Stop</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Drawer Chat Input */}
                <div style={{ padding: "12px 14px", borderTop: `1px solid ${border}`, background: card }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={chatPromptText}
                      onChange={e => setChatPromptText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (!chatSubmitting) handleSmartChatSubmit();
                        }
                      }}
                      placeholder="Ask AI or request revisions..."
                      style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                    />
                    {chatSubmitting ? (
                      <button
                        onClick={handleStopChatProcessing}
                        title="Stop processing"
                        style={{
                          ...btnPrimary,
                          background: "#ef4444",
                          padding: "8px 12px", borderRadius: 8,
                          cursor: "pointer",
                          boxShadow: "0 2px 8px rgba(239,68,68,0.35)"
                        }}
                      >
                        <Square size={13} fill="#fff" />
                      </button>
                    ) : (
                      <button
                        onClick={handleSmartChatSubmit}
                        disabled={!chatPromptText.trim()}
                        style={{
                          ...btnPrimary,
                          padding: "8px 12px", borderRadius: 8,
                          opacity: !chatPromptText.trim() ? 0.5 : 1
                        }}
                      >
                        <ArrowUp size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ margin: "auto", textAlign: "center", padding: 40 }}>
            <p style={{ color: sub, marginBottom: 12 }}>No project selected.</p>
            <button onClick={() => setActiveStep(1)} style={btnPrimary}>Go to Step 1: Setup &amp; Brief</button>
          </div>
        )
      )}
    </div>
      
      {briefModalOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.72)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: card, width: 660, borderRadius: 18, border: `1px solid ${border}`, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 32px 80px rgba(0,0,0,0.55)" }}>

            {/* Header */}
            <div style={{ padding: "20px 26px", borderBottom: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Import Creative Brief</h3>
                <p style={{ fontSize: 11, color: sub, margin: "5px 0 0", lineHeight: 1.5 }}>
                  {briefFromLanding
                    ? 'AI will create a new project and extract characters, scenes & frames from your brief.'
                    : 'Upload a PDF or paste your brief — AI will extract characters, scenes & frames automatically.'}
                </p>
              </div>
              <button onClick={closeBriefModal} style={{ background: "none", border: "none", color: sub, cursor: "pointer", padding: 4, marginTop: -2 }}><X size={18} /></button>
            </div>

            {/* Project name input — only shown when coming from landing page */}
            {briefFromLanding && (
              <div style={{ padding: "14px 26px", borderBottom: `1px solid ${border}`, background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: sub, letterSpacing: 0.4, display: "block", marginBottom: 6 }}>PROJECT NAME (optional — will be auto-extracted from brief if blank)</label>
                <input
                  value={briefProjectName}
                  onChange={e => setBriefProjectName(e.target.value)}
                  placeholder="e.g. Panasonic Summer Campaign 2025..."
                  style={{ ...inputStyle, padding: "9px 14px", fontSize: 13 }}
                />
              </div>
            )}

            {/* Mode Tabs */}
            <div style={{ display: "flex", borderBottom: `1px solid ${border}` }}>
              {([['pdf', '📄  Upload PDF'] as const, ['text', '✏️  Paste Text'] as const]).map(([mode, label]) => (
                <button key={mode} onClick={() => setBriefUploadMode(mode)} style={{ flex: 1, padding: "13px 0", fontSize: 13, fontWeight: 600, background: briefUploadMode === mode ? (isDark ? "rgba(249,87,56,0.08)" : "rgba(249,87,56,0.04)") : "transparent", color: briefUploadMode === mode ? accent : sub, border: "none", borderBottom: `2px solid ${briefUploadMode === mode ? accent : "transparent"}`, cursor: "pointer", transition: "all 0.15s" }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div style={{ padding: 26, minHeight: 240 }}>
              {briefUploadMode === 'pdf' ? (
                <>
                  {pdfExtracting ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "36px 0" }}>
                      <div style={{ position: "relative", width: 52, height: 52 }}>
                        <RefreshCw size={52} className="animate-spin" style={{ color: accent, opacity: 0.15, position: "absolute" }} />
                        <FileText size={24} style={{ color: accent, position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }} />
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: txt, marginBottom: 6 }}>Extracting your brief...</div>
                        <div style={{ fontSize: 12, color: sub, lineHeight: 1.6 }}>Converting PDF pages to images &amp; running vision AI on each page.<br />This may take a few seconds.</div>
                      </div>
                    </div>
                  ) : pdfPreview ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <CheckCircle2 size={16} style={{ color: "#22c55e", flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#22c55e" }}>PDF extracted successfully</span>
                      </div>
                      <div style={{ background: isDark ? "#111" : "#f5f5f5", borderRadius: 10, padding: 14, fontSize: 11, color: sub, lineHeight: 1.7, maxHeight: 140, overflowY: "auto", border: `1px solid ${border}` }}>
                        <b style={{ color: txt, display: "block", marginBottom: 4 }}>Extracted Text Preview:</b>
                        {pdfPreview}
                      </div>
                      {/* Frame count slider for PDF mode — shown after extraction */}
                      <div style={{ padding: "14px 16px", background: isDark ? "rgba(249,87,56,0.06)" : "rgba(249,87,56,0.04)", borderRadius: 12, border: `1px solid ${isDark ? "rgba(249,87,56,0.18)" : "rgba(249,87,56,0.12)"}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: txt }}>🎬 How many frames to generate?</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: accent, minWidth: 28, textAlign: "right" }}>{briefFrameCount}</div>
                        </div>
                        <input
                          type="range" min={1} max={15} step={1}
                          value={briefFrameCount}
                          onChange={e => setBriefFrameCount(Number(e.target.value))}
                          style={{ width: "100%", accentColor: accent, cursor: "pointer" }}
                        />
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: sub, marginTop: 4 }}>
                          <span>1</span><span style={{ color: accent, fontWeight: 600 }}>Recommended: 6–8</span><span>15</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <button onClick={() => { setPdfPreview(""); setPdfExtractedText(""); }} style={{ ...btnGhost, fontSize: 11 }}>↺ Upload a different PDF</button>
                        <span style={{ fontSize: 11, color: sub }}>Click "Use This Brief" below to generate your storyboard frames.</span>
                      </div>
                    </div>
                  ) : (
                    <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, border: `2px dashed ${border}`, borderRadius: 14, padding: "44px 28px", cursor: "pointer", transition: "all 0.2s", background: "transparent" }} onMouseOver={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.background = isDark ? "rgba(249,87,56,0.06)" : "rgba(249,87,56,0.03)"; }} onMouseOut={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.background = "transparent"; }}>
                      <div style={{ width: 64, height: 64, borderRadius: 16, background: isDark ? "rgba(249,87,56,0.12)" : "rgba(249,87,56,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <FileText size={30} style={{ color: accent }} />
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: txt, marginBottom: 6 }}>Drop your PDF brief here</div>
                        <div style={{ fontSize: 12, color: sub, lineHeight: 1.6 }}>Or click to browse &nbsp;·&nbsp; Any campaign brief, script, or creative document<br />AI will OCR all pages and extract characters, scenes &amp; frames</div>
                      </div>
                      <div style={{ fontSize: 11, color: sub, background: isDark ? "#1e1e1e" : "#eee", padding: "4px 12px", borderRadius: 20 }}>PDF files only</div>
                      <input type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadBriefPdf(f); e.target.value = ""; }} />
                    </label>
                  )}
                </>
              ) : (
                <>
                  <textarea
                    value={briefText}
                    onChange={e => setBriefText(e.target.value)}
                    placeholder="Paste your creative brief here... We will auto-extract characters, products, and frames."
                    style={{ ...inputStyle, height: 160, resize: "none" }}
                  />
                  {/* Frame count slider for text mode — show once user has pasted something */}
                  {briefText.trim().length > 20 && (
                    <div style={{ marginTop: 8, padding: "14px 16px", background: isDark ? "rgba(249,87,56,0.06)" : "rgba(249,87,56,0.04)", borderRadius: 12, border: `1px solid ${isDark ? "rgba(249,87,56,0.18)" : "rgba(249,87,56,0.12)"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: txt }}>🎬 How many frames to generate?</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: accent, minWidth: 28, textAlign: "right" }}>{briefFrameCount}</div>
                      </div>
                      <input
                        type="range" min={1} max={15} step={1}
                        value={briefFrameCount}
                        onChange={e => setBriefFrameCount(Number(e.target.value))}
                        style={{ width: "100%", accentColor: accent, cursor: "pointer" }}
                      />
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: sub, marginTop: 4 }}>
                        <span>1</span><span style={{ color: accent, fontWeight: 600 }}>Recommended: 6–8</span><span>15</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "16px 26px", borderTop: `1px solid ${border}`, display: "flex", flexDirection: "column", gap: 10, background: isDark ? "#181818" : "#f7f7f7" }}>
              {/* Error message */}
              {briefError && (
                <div style={{ fontSize: 12, color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "8px 12px", lineHeight: 1.5 }}>
                  ⚠ {briefError}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={closeBriefModal} style={btnGhost}>Cancel</button>
                {briefUploadMode === 'text' ? (
                  <button
                    onClick={() => ingestBrief(briefText)}
                    disabled={briefParsing || !briefText.trim()}
                    style={{ ...btnPrimary, opacity: (briefParsing || !briefText.trim()) ? 0.5 : 1, cursor: (briefParsing || !briefText.trim()) ? "not-allowed" : "pointer" }}
                  >
                    {briefParsing
                      ? <><RefreshCw size={13} className="animate-spin" /> {briefFromLanding ? 'Creating Project...' : 'Parsing...'}</>
                      : <>{briefFromLanding ? '🚀 Create Project from Brief' : '✨ Parse Brief'}</>}
                  </button>
                ) : (
                  pdfPreview && !pdfExtracting && (
                    <button
                      onClick={() => ingestBrief(pdfExtractedText)}
                      disabled={briefParsing}
                      style={{ ...btnPrimary, opacity: briefParsing ? 0.5 : 1, cursor: briefParsing ? "not-allowed" : "pointer" }}
                    >
                      {briefParsing
                        ? <><RefreshCw size={13} className="animate-spin" /> {briefFromLanding ? 'Creating Project...' : 'Ingesting...'}</>
                        : <>{briefFromLanding ? '🚀 Create Project from Brief' : '✓ Use This Brief'}</>}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── MISSING FIELDS DIALOG ── */}
      {missingDialogOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.78)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)" }}>
          <div style={{ background: card, width: 580, borderRadius: 18, border: `1px solid ${border}`, overflow: "hidden", boxShadow: "0 40px 100px rgba(0,0,0,0.6)" }}>
            <div style={{ padding: "22px 26px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(245,158,11,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <AlertCircle size={20} style={{ color: "#f59e0b" }} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: txt, margin: 0 }}>Brief is Missing Some Details</h3>
                  <p style={{ fontSize: 11, color: sub, margin: "3px 0 0" }}>Please fill in the fields below before we generate your storyboard</p>
                </div>
              </div>
              <div style={{ background: isDark ? "rgba(245,158,11,0.08)" : "rgba(245,158,11,0.06)", border: `1px solid rgba(245,158,11,0.25)`, borderRadius: 10, padding: "10px 14px", marginBottom: 18 }}>
                <p style={{ fontSize: 12, color: isDark ? "#fbbf24" : "#92400e", margin: 0, lineHeight: 1.6 }}>
                  ⚡ Your PDF was extracted but some details needed for high-quality image generation are missing or incomplete.
                  Fill them in below — <b>all fields are required</b> before we can run the storyboard.
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, maxHeight: 360, overflowY: "auto", paddingRight: 4, paddingBottom: 2 }}>
                {missingFields.map(field => (
                  <div key={field}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: txt, display: "block", marginBottom: 7, letterSpacing: 0.2 }}>
                      {missingQuestions[field] || `Please describe the ${field.replace(/_/g, " ")}:`}
                      <span style={{ color: accent, marginLeft: 4 }}>*</span>
                    </label>
                    {/* Suggested answer chips */}
                    {suggestedAnswers[field] && suggestedAnswers[field].length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                        <span style={{ fontSize: 10, color: sub, fontWeight: 600, letterSpacing: 0.5 }}>SUGGESTIONS — click to use:</span>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {suggestedAnswers[field].map((suggestion, si) => (
                            <button
                              key={si}
                              onClick={() => setMissingAnswers(prev => ({ ...prev, [field]: suggestion }))}
                              style={{
                                textAlign: "left",
                                background: missingAnswers[field] === suggestion
                                  ? (isDark ? "rgba(249,87,56,0.18)" : "rgba(249,87,56,0.1)")
                                  : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"),
                                border: `1px solid ${missingAnswers[field] === suggestion ? accent : border}`,
                                borderRadius: 8,
                                padding: "8px 12px",
                                fontSize: 11,
                                color: missingAnswers[field] === suggestion ? accent : txt,
                                cursor: "pointer",
                                lineHeight: 1.5,
                                transition: "all 0.15s",
                                fontWeight: missingAnswers[field] === suggestion ? 600 : 400,
                                width: "100%",
                              }}
                              onMouseOver={e => { if (missingAnswers[field] !== suggestion) { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; } }}
                              onMouseOut={e => { if (missingAnswers[field] !== suggestion) { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = txt; } }}
                            >
                              <span style={{ opacity: 0.5, marginRight: 6 }}>#{si + 1}</span>{suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <textarea
                      value={missingAnswers[field] || ""}
                      onChange={e => setMissingAnswers(prev => ({ ...prev, [field]: e.target.value }))}
                      placeholder={
                        field === "characters" ? "e.g. A 28-year-old South Asian woman, slim build, long black hair, wearing a yellow kurta with gold earrings..." :
                        field === "setting_or_location" ? "e.g. A modern Mumbai apartment kitchen in the morning, warm natural light through large windows..." :
                        field === "mood_or_tone" ? "e.g. Warm and emotional, aspirational, cinematic — like a Bollywood family drama..." :
                        field === "frame_scenes" ? "e.g. Frame 1: Woman cooking breakfast. Frame 2: Family eating together. Frame 3: Kids leaving for school..." :
                        "Describe in detail..."
                      }
                      style={{ ...inputStyle, height: 84, resize: "none", fontSize: 12, lineHeight: 1.6, borderColor: missingAnswers[field]?.trim() ? "#22c55e" : border }}
                    />
                    {missingAnswers[field]?.trim() && (
                      <div style={{ fontSize: 10, color: "#22c55e", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                        <CheckCircle2 size={10} /> Looks good!
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: "18px 26px", display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${border}`, marginTop: 18, background: isDark ? "#181818" : "#f7f7f7" }}>
              <span style={{ fontSize: 11, color: sub }}>
                {missingFields.filter(f => missingAnswers[f]?.trim()).length} / {missingFields.length} fields complete
              </span>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setMissingDialogOpen(false)} style={btnGhost}>Cancel</button>
                <button
                  onClick={handleMissingFieldsSubmit}
                  disabled={briefParsing || missingFields.some(f => !missingAnswers[f]?.trim())}
                  style={{ ...btnPrimary, opacity: (briefParsing || missingFields.some(f => !missingAnswers[f]?.trim())) ? 0.45 : 1, cursor: (briefParsing || missingFields.some(f => !missingAnswers[f]?.trim())) ? "not-allowed" : "pointer", minWidth: 130, justifyContent: "center" }}
                >
                  {briefParsing ? <><RefreshCw size={13} className="animate-spin" /> Processing...</> : <>🚀 Generate Storyboard</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unapproved character warning modal (replaces window.confirm) */}
      {unapprovedWarning && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.65)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: card, width: 460, borderRadius: 16, border: `1px solid ${border}`, overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
            <div style={{ padding: "20px 24px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 22 }}>⚠️</span>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: txt, margin: 0 }}>No Character Sheet Approved</h3>
              </div>
              <p style={{ fontSize: 13, color: sub, lineHeight: 1.6, margin: 0 }}>
                The following character{unapprovedWarning.names.length > 1 ? 's do' : ' does'} not have an approved Character Sheet:
              </p>
              <ul style={{ margin: "10px 0", padding: "0 0 0 18px", color: accent, fontSize: 13, fontWeight: 600 }}>
                {unapprovedWarning.names.map(n => <li key={n}>{n}</li>)}
              </ul>
              <p style={{ fontSize: 12, color: sub, lineHeight: 1.5, margin: "0 0 8px" }}>
                Generating without an approved sheet may lead to visual drift across frames. You can generate the sheet from the sidebar under <b style={{ color: txt }}>Character Sheet → Generate Sheet</b>.
              </p>
            </div>
            <div style={{ padding: "16px 24px", display: "flex", gap: 10, justifyContent: "flex-end", borderTop: `1px solid ${border}`, marginTop: 16, background: isDark ? "#1a1a1a" : "#f5f5f5" }}>
              <button onClick={() => setUnapprovedWarning(null)} style={btnGhost}>Cancel</button>
              <button
                onClick={() => { const w = unapprovedWarning; setUnapprovedWarning(null); doGenerateFrame(w.fid, w.prompt); }}
                style={{ ...btnPrimary, background: "#f97316" }}
              >
                Generate Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CHARACTER SHEET VIEWER MODAL ═══ */}
      {sheetViewChar && sheetViewChar.character_sheet && (
        <div
          onClick={() => setSheetViewChar(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(8px)" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: isDark ? "#181818" : "#fff", borderRadius: 20, border: `1px solid ${border}`, width: "min(900px, 96vw)", maxHeight: "90vh", overflow: "auto", boxShadow: "0 32px 80px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column" }}
          >
            {/* Header */}
            <div style={{ padding: "20px 26px 16px", borderBottom: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800, color: txt }}>🎭 {sheetViewChar.name} — Character Sheet</div>
                <div style={{ fontSize: 12, color: sub, marginTop: 3 }}>
                  {sheetViewChar.character_sheet.is_approved
                    ? <span style={{ color: "#22c55e", fontWeight: 700 }}>✅ Approved — used for frame generation</span>
                    : <span style={{ color: "#f97316", fontWeight: 600 }}>⚠ Not yet approved — approve to lock consistency</span>}
                </div>
              </div>
              <button onClick={() => setSheetViewChar(null)} style={{ ...btnGhost, padding: "6px 10px", fontSize: 13 }}>✕ Close</button>
            </div>
            {/* Sheet images — 3 column grid */}
            <div style={{ padding: "24px 26px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {[
                { url: sheetViewChar.character_sheet.front_body_url, label: "Front Body", icon: "🧍", key: "front" },
                { url: sheetViewChar.character_sheet.side_profile_url, label: "Side Profile", icon: "🔄", key: "side" },
                { url: sheetViewChar.character_sheet.face_closeup_url, label: "Face Close-up", icon: "👤", key: "face" },
              ].map(({ url, label, icon, key }) => {
                const src = url?.startsWith('http') ? url : url ? `${API}/${url}` : '';
                return (
                  <div key={label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div 
                      onClick={() => {
                        if (!src && !generatingSheet[sheetViewChar.id]) {
                          generateSheet(sheetViewChar.id, key as any);
                        }
                      }}
                      style={{ 
                        background: isDark ? "#111" : "#f0f0f0", 
                        borderRadius: 14, 
                        overflow: "hidden", 
                        border: `1px solid ${!src ? accent + "88" : border}`, 
                        aspectRatio: "3/4",
                        cursor: !src ? "pointer" : "default"
                      }}
                    >
                      {src ? (
                        <img src={src} alt={label} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      ) : generatingSheet[sheetViewChar.id] ? (
                        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: accent }}>
                          <span style={{ fontSize: 24, animation: "spin 1s linear infinite" }}>🔄</span>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>Generating {label}...</span>
                        </div>
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 16, textAlign: "center" }}>
                          <span style={{ fontSize: 28, color: accent }}>+ ✨</span>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: txt }}>Generate {label}</div>
                            <div style={{ fontSize: 11, color: sub, marginTop: 4 }}>Creates view from front reference</div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "center", fontSize: 14, fontWeight: 700, color: txt }}>{icon} {label}</div>
                  </div>
                );
              })}
            </div>
            {/* Structured 3-Part DNA Breakdown */}
            {sheetViewChar.character_dna && (() => {
              const d = sheetViewChar.character_dna;
              const phys = d.physical_anchors || {};
              const costume = d.costume_bible || {};
              const voice = d.voice_dna || {};
              const personality = d.personality_dna || {};

              const ethSkin = phys.ethnicity_skin_tone || d.ethnicity_skin_tone || d.demographics || d.skin_tone || (d.ethnicity ? `${d.ethnicity} ${d.skin_tone || ''}` : '') || "Warm Mediterranean olive skin tone";
              const ageGen = phys.age_gender || d.age_gender || [d.age, d.gender].filter(Boolean).join(" ") || "Young female (mid-20s)";
              const face = phys.face_shape_features || d.face_shape_features || d.face_geometry || d.facial_features || d.distinctive_features || "Warm oval face, gentle smile, natural defined jawline";
              const hair = phys.hair_details || d.hair_details || d.hair_and_skin || d.hair || "Dark wavy chestnut brown hair, shoulder-length in a loose bun";
              const eyes = phys.eye_details || d.eye_details || d.eyes_and_brows || "Expressive amber brown almond eyes, natural arched brows";
              const build = phys.build_details || d.build_details || d.build_and_posture || d.build_height || d.build || "Slender athletic build (~5'6\")";

              const wardrobe = costume.wardrobe_bible || d.wardrobe_bible || d.default_wardrobe || d.clothing_wardrobe || d.wardrobe || "Fitted navy blue blazer over charcoal t-shirt, dark jeans, brown boots";
              const accessories = costume.fixed_accessories || d.fixed_accessories || d.distinguishing_props || "Minimalist gold hoop earrings, subtle leather wristband";
              const recurring = costume.recurring_elements || d.recurring_elements || d.distinctive_features || d.distinguishing_props || "Artisan copper espresso tamper, vintage ceramic bean jar";

              const voiceAccent = voice.voice_accent || d.voice_accent || "European Portuguese accent speaking fluent warm English";
              const voicePitch = voice.voice_pitch || d.voice_pitch || "Mid-pitch, melodic and energetic";
              const voicePace = voice.voice_pace || d.voice_pace || "150-165 WPM, spirited engaging cadence with thoughtful pauses";
              const voiceTexture = voice.voice_texture || d.voice_texture || "Crisp, bright, warm vocal tone with subtle breathiness";
              const voiceDefault = voice.voice_emotional_default || d.voice_emotional_default || "Spirited, welcoming, enthusiastic craftsperson";

              const motivation = personality.motivation || d.motivation || d.personality || "Mastering Lisbon's premier artisan rooftop café and uncovering hidden culinary recipes";
              const commStyle = personality.communication_style || d.communication_style || "Warm, enthusiastic, expressive, direct and inviting";
              const emoRange = personality.emotional_range || d.emotional_range || "Animated micro-expressions, infectious smile, focused curiosity";

              return (
                <div style={{ margin: "0 26px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 800, color: txt, fontSize: 14 }}>📋 Character DNA Specification</div>
                    <button
                      onClick={() => openDnaEditor(sheetViewChar)}
                      style={{ ...btnGhost, fontSize: 12, padding: "5px 12px", border: `1px solid ${accent}`, borderRadius: 6, color: accent, fontWeight: 600 }}
                    >
                      ✏️ Edit Character DNA
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    {/* Visual Identity */}
                    <div style={{ background: isDark ? "#111" : "#f8fafc", borderRadius: 12, border: `1px solid ${border}`, padding: 14, fontSize: 11, color: sub, lineHeight: 1.7 }}>
                      <div style={{ fontWeight: 700, color: "#3b82f6", marginBottom: 8, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>🎨 1. Visual Identity</div>
                      <div style={{ fontWeight: 700, color: txt, marginTop: 4, textTransform: "uppercase", fontSize: 10 }}>Physical Anchors</div>
                      <div><b style={{ color: txt }}>Ethnicity / Skin:</b> {ethSkin}</div>
                      <div><b style={{ color: txt }}>Age & Gender:</b> {ageGen}</div>
                      <div><b style={{ color: txt }}>Face & Jaw:</b> {face}</div>
                      <div><b style={{ color: txt }}>Hair:</b> {hair}</div>
                      <div><b style={{ color: txt }}>Eyes & Brows:</b> {eyes}</div>
                      <div><b style={{ color: txt }}>Build:</b> {build}</div>

                      <div style={{ fontWeight: 700, color: txt, marginTop: 8, textTransform: "uppercase", fontSize: 10 }}>Costume Bible</div>
                      <div><b style={{ color: txt }}>Wardrobe & Feel:</b> {wardrobe}</div>
                      <div><b style={{ color: txt }}>Fixed Accessories:</b> {accessories}</div>
                      <div><b style={{ color: txt }}>Recurring Props/Marks:</b> {recurring}</div>
                    </div>

                    {/* Voice DNA */}
                    <div style={{ background: isDark ? "#111" : "#fbf5ff", borderRadius: 12, border: `1px solid ${border}`, padding: 14, fontSize: 11, color: sub, lineHeight: 1.7 }}>
                      <div style={{ fontWeight: 700, color: "#a855f7", marginBottom: 8, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>🎙️ 2. Voice DNA</div>
                      <div><b style={{ color: txt }}>Accent / Dialect:</b> {voiceAccent}</div>
                      <div><b style={{ color: txt }}>Pitch:</b> {voicePitch}</div>
                      <div><b style={{ color: txt }}>Pace & WPM:</b> {voicePace}</div>
                      <div><b style={{ color: txt }}>Vocal Texture:</b> {voiceTexture}</div>
                      <div><b style={{ color: txt }}>Emotional Default:</b> {voiceDefault}</div>
                    </div>

                    {/* Personality & Behavioral DNA */}
                    <div style={{ background: isDark ? "#111" : "#f0fdf4", borderRadius: 12, border: `1px solid ${border}`, padding: 14, fontSize: 11, color: sub, lineHeight: 1.7 }}>
                      <div style={{ fontWeight: 700, color: "#22c55e", marginBottom: 8, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>🧠 3. Behavioral DNA</div>
                      <div><b style={{ color: txt }}>Motivation:</b> {motivation}</div>
                      <div><b style={{ color: txt }}>Communication Style:</b> {commStyle}</div>
                      <div><b style={{ color: txt }}>On-Screen Range:</b> {emoRange}</div>
                    </div>
                  </div>
                </div>
              );
            })()}
            {/* Footer actions */}
            <div style={{ padding: "16px 26px", borderTop: `1px solid ${border}`, display: "flex", gap: 10, justifyContent: "flex-end", background: isDark ? "#141414" : "#fafafa", borderRadius: "0 0 20px 20px" }}>
              {(() => {
                const isMissing = sheetViewChar.character_sheet.front_body_url && (!sheetViewChar.character_sheet.side_profile_url || !sheetViewChar.character_sheet.face_closeup_url);
                return (
                  <button
                    onClick={() => generateSheet(sheetViewChar.id, isMissing ? "missing" : "all")}
                    disabled={!!generatingSheet[sheetViewChar.id]}
                    style={{ ...btnGhost, padding: "9px 18px", fontSize: 13, color: isMissing ? accent : undefined, borderColor: isMissing ? accent + "66" : undefined }}
                  >
                    {generatingSheet[sheetViewChar.id] ? <><RefreshCw size={13} className="animate-spin" /> Generating Views...</> : isMissing ? "✨ Generate Side & Face Views" : "🔄 Regenerate All Views"}
                  </button>
                );
              })()}
              {!sheetViewChar.character_sheet.is_approved && (
                <button
                  onClick={() => {
                    approveSheet(sheetViewChar.id);
                    setSheetViewChar((prev: any) => prev ? { ...prev, character_sheet: { ...prev.character_sheet, is_approved: true } } : null);
                  }}
                  style={{ ...btnPrimary, padding: "9px 20px", fontSize: 13, background: "#22c55e" }}
                >
                  ✅ Approve Sheet
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ CHARACTER DNA EDITOR MODAL ═══ */}
      {editDnaChar && (
        <div
          onClick={() => setEditDnaChar(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 350, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(8px)" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: isDark ? "#181818" : "#fff", borderRadius: 20, border: `1px solid ${border}`, width: "min(760px, 94vw)", maxHeight: "90vh", overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column" }}
          >
            {/* Modal Header */}
            <div style={{ padding: "18px 24px", borderBottom: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: txt }}>🧬 Character DNA Specification — {editDnaChar.name}</div>
                <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>Lock non-negotiables for physical consistency, voice matching, and behavioral direction.</div>
              </div>
              <button onClick={() => setEditDnaChar(null)} style={{ ...btnGhost, padding: "6px 10px", fontSize: 13 }}>✕ Close</button>
            </div>

            {/* Navigation Tabs */}
            <div style={{ padding: "10px 24px 0", display: "flex", gap: 8, borderBottom: `1px solid ${border}`, background: isDark ? "#121212" : "#f8fafc" }}>
              <button
                onClick={() => setEditDnaTab("visual")}
                style={{ padding: "8px 14px", fontSize: 12, fontWeight: 700, borderRadius: "6px 6px 0 0", borderBottom: editDnaTab === "visual" ? `2px solid ${accent}` : "none", color: editDnaTab === "visual" ? accent : sub, background: "transparent", cursor: "pointer" }}
              >
                🎨 1. Visual Identity
              </button>
              <button
                onClick={() => setEditDnaTab("voice")}
                style={{ padding: "8px 14px", fontSize: 12, fontWeight: 700, borderRadius: "6px 6px 0 0", borderBottom: editDnaTab === "voice" ? `2px solid ${accent}` : "none", color: editDnaTab === "voice" ? accent : sub, background: "transparent", cursor: "pointer" }}
              >
                🎙️ 2. Voice DNA
              </button>
              <button
                onClick={() => setEditDnaTab("personality")}
                style={{ padding: "8px 14px", fontSize: 12, fontWeight: 700, borderRadius: "6px 6px 0 0", borderBottom: editDnaTab === "personality" ? `2px solid ${accent}` : "none", color: editDnaTab === "personality" ? accent : sub, background: "transparent", cursor: "pointer" }}
              >
                🧠 3. Behavioral DNA
              </button>
            </div>

            {/* Tab Form Contents */}
            <div style={{ padding: 24, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
              {editDnaTab === "visual" && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: txt, borderBottom: `1px solid ${border}`, paddingBottom: 6 }}>⚓ Physical Anchors (Model Consistency Non-Negotiables)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Ethnicity & Skin Tone</label>
                      <input
                        value={editDnaForm.ethnicity_skin_tone}
                        onChange={e => setEditDnaForm({ ...editDnaForm, ethnicity_skin_tone: e.target.value })}
                        placeholder="e.g. warm medium-brown South Asian"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Age & Gender</label>
                      <input
                        value={editDnaForm.age_gender}
                        onChange={e => setEditDnaForm({ ...editDnaForm, age_gender: e.target.value })}
                        placeholder="e.g. 28-year-old female"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Face Shape & Features (jaw, nose, brow)</label>
                      <input
                        value={editDnaForm.face_shape_features}
                        onChange={e => setEditDnaForm({ ...editDnaForm, face_shape_features: e.target.value })}
                        placeholder="e.g. oval face, sharp chiseled jaw, straight narrow nose bridge"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Hair (color, texture, length, style)</label>
                      <input
                        value={editDnaForm.hair_details}
                        onChange={e => setEditDnaForm({ ...editDnaForm, hair_details: e.target.value })}
                        placeholder="e.g. jet black, wavy, shoulder-length, side-parted"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Eye Shape & Color</label>
                      <input
                        value={editDnaForm.eye_details}
                        onChange={e => setEditDnaForm({ ...editDnaForm, eye_details: e.target.value })}
                        placeholder="e.g. almond-shaped, deep hazel brown"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Build (height category + body type)</label>
                      <input
                        value={editDnaForm.build_details}
                        onChange={e => setEditDnaForm({ ...editDnaForm, build_details: e.target.value })}
                        placeholder="e.g. 5'8 athletic build, broad shoulders"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, color: txt, borderBottom: `1px solid ${border}`, paddingBottom: 6, marginTop: 12 }}>👕 Costume Bible</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Wardrobe (garments + colors + material feels)</label>
                      <textarea
                        value={editDnaForm.wardrobe_bible}
                        onChange={e => setEditDnaForm({ ...editDnaForm, wardrobe_bible: e.target.value })}
                        placeholder="e.g. khaki utility vest in worn cotton, white crew-neck tee, dark denim jeans"
                        style={{ ...inputStyle, height: 50, resize: "none", fontSize: 12 }}
                      />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Fixed Accessories (always in same position)</label>
                        <input
                          value={editDnaForm.fixed_accessories}
                          onChange={e => setEditDnaForm({ ...editDnaForm, fixed_accessories: e.target.value })}
                          placeholder="e.g. goggles on forehead, leather cuff on left wrist"
                          style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Recurring Elements (held objects, scar/mark)</label>
                        <input
                          value={editDnaForm.recurring_elements}
                          onChange={e => setEditDnaForm({ ...editDnaForm, recurring_elements: e.target.value })}
                          placeholder="e.g. small silver scar on right cheek, vintage brass compass"
                          style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {editDnaTab === "voice" && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: txt, borderBottom: `1px solid ${border}`, paddingBottom: 6 }}>🎙️ Voice DNA (Voiceover Matching Specification)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Language / Accent / Dialect (specific region)</label>
                      <input
                        value={editDnaForm.voice_accent}
                        onChange={e => setEditDnaForm({ ...editDnaForm, voice_accent: e.target.value })}
                        placeholder="e.g. English - Pacific Northwest / Seattle dialect"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Pitch (low / mid / high)</label>
                      <input
                        value={editDnaForm.voice_pitch}
                        onChange={e => setEditDnaForm({ ...editDnaForm, voice_pitch: e.target.value })}
                        placeholder="e.g. mid-low, warm alt pitch"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Pace (WPM range & cadence)</label>
                      <input
                        value={editDnaForm.voice_pace}
                        onChange={e => setEditDnaForm({ ...editDnaForm, voice_pace: e.target.value })}
                        placeholder="e.g. 140-160 WPM, steady rhythm with deliberate pauses"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Vocal Texture (smooth, breathy, raspy, crisp)</label>
                      <input
                        value={editDnaForm.voice_texture}
                        onChange={e => setEditDnaForm({ ...editDnaForm, voice_texture: e.target.value })}
                        placeholder="e.g. crisp with subtle warm raspy undertone"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                    <div style={{ gridColumn: "span 2" }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Emotional Default (delivery style)</label>
                      <input
                        value={editDnaForm.voice_emotional_default}
                        onChange={e => setEditDnaForm({ ...editDnaForm, voice_emotional_default: e.target.value })}
                        placeholder="e.g. earnest, dry, curious, quietly confident"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                  </div>
                </>
              )}

              {editDnaTab === "personality" && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: txt, borderBottom: `1px solid ${border}`, paddingBottom: 6 }}>🧠 Personality / Behavioral DNA</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Motivation (what does this character want)</label>
                      <textarea
                        value={editDnaForm.motivation}
                        onChange={e => setEditDnaForm({ ...editDnaForm, motivation: e.target.value })}
                        placeholder="e.g. Uncover hidden urban mysteries and protect their team"
                        style={{ ...inputStyle, height: 60, resize: "none", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Communication Style (formal, casual, expressive, direct)</label>
                      <input
                        value={editDnaForm.communication_style}
                        onChange={e => setEditDnaForm({ ...editDnaForm, communication_style: e.target.value })}
                        placeholder="e.g. Direct, casual, concise with expressive gestures"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: "block", marginBottom: 4 }}>Emotional Range visible on-screen (stoic vs expressive)</label>
                      <input
                        value={editDnaForm.emotional_range}
                        onChange={e => setEditDnaForm({ ...editDnaForm, emotional_range: e.target.value })}
                        placeholder="e.g. Subtle micro-expressions, mostly stoic composure breaking into warm genuine smiles"
                        style={{ ...inputStyle, padding: "8px 12px", fontSize: 12 }}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Modal Actions */}
            <div style={{ padding: "16px 24px", borderTop: `1px solid ${border}`, display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", background: isDark ? "#141414" : "#fafafa", flexWrap: "wrap" }}>
              <button onClick={() => setEditDnaChar(null)} style={btnGhost}>Cancel</button>
              <button
                onClick={saveDna}
                disabled={savingDna}
                style={{ ...btnGhost, padding: "8px 16px", fontSize: 12, borderColor: border }}
              >
                {savingDna ? <><RefreshCw size={12} className="animate-spin" /> Saving...</> : "💾 Save DNA Only"}
              </button>
              <button
                onClick={saveAndRegenerateCharSheet}
                disabled={savingDna}
                style={{ ...btnPrimary, padding: "8px 20px", fontSize: 12, background: accent }}
              >
                {savingDna ? <><RefreshCw size={12} className="animate-spin" /> Updating...</> : "✨ Save & Regenerate 3-Panel Sheet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PRODUCT DNA EDITOR & VIEWER MODAL ═══ */}
      {editDnaProd && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 20, width: "100%", maxWidth: 680, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
            
            {/* Modal Header */}
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, overflow: "hidden", border: `2px solid #8B5CF6`, background: "#111", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {editDnaProd.image_path ? (
                    <img src={editDnaProd.image_path.startsWith('http') ? editDnaProd.image_path : `${API}/${editDnaProd.image_path}`} alt={editDnaProd.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Package size={20} color="#8B5CF6" />
                  )}
                </div>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: txt }}>{editDnaProd.name} — Product DNA</h3>
                  <p style={{ fontSize: 12, color: sub, margin: "2px 0 0" }}>Edit physical traits, branding, colors &amp; geometry anchors for image generation</p>
                </div>
              </div>
              <button onClick={() => setEditDnaProd(null)} style={{ background: "none", border: "none", color: sub, cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>

            {/* Modal Body: Editable Form */}
            <div style={{ padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
              
              {/* Product Reference Visual Strip */}
              {(editDnaProd.image_paths?.length > 0 || editDnaProd.image_path) && (
                <div style={{ padding: "12px 14px", background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)", borderRadius: 12, border: `1px solid ${border}`, display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: sub, width: 90 }}>Visual Reference:</div>
                  <div style={{ display: "flex", gap: 8, flex: 1 }}>
                    {(editDnaProd.image_paths || [editDnaProd.image_path]).slice(0, 3).map((imgUrl: string, i: number) => (
                      <div key={i} style={{ width: 64, height: 64, borderRadius: 8, overflow: "hidden", border: `1px solid ${border}`, background: "#111" }}>
                        <img src={imgUrl.startsWith('http') ? imgUrl : `${API}/${imgUrl}`} alt="view" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: txt, display: "block", marginBottom: 5 }}>Product Category / Type</label>
                  <input
                    value={editProdDnaForm.product_type}
                    onChange={e => setEditProdDnaForm({ ...editProdDnaForm, product_type: e.target.value })}
                    placeholder="e.g. Air conditioner indoor unit, Luxury watch, Electric sedan"
                    style={{ ...inputStyle, padding: "9px 12px", fontSize: 12, width: "100%", boxSizing: "border-box" }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: txt, display: "block", marginBottom: 5 }}>Colors &amp; Palette</label>
                  <input
                    value={editProdDnaForm.color_palette}
                    onChange={e => setEditProdDnaForm({ ...editProdDnaForm, color_palette: e.target.value })}
                    placeholder="e.g. Pure matte white with sapphire blue logo accents"
                    style={{ ...inputStyle, padding: "9px 12px", fontSize: 12, width: "100%", boxSizing: "border-box" }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: txt, display: "block", marginBottom: 5 }}>Material &amp; Surface Finish</label>
                  <input
                    value={editProdDnaForm.material_finish}
                    onChange={e => setEditProdDnaForm({ ...editProdDnaForm, material_finish: e.target.value })}
                    placeholder="e.g. Matte white polycarbonate with anodized aluminum trim"
                    style={{ ...inputStyle, padding: "9px 12px", fontSize: 12, width: "100%", boxSizing: "border-box" }}
                  />
                </div>

                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: txt, display: "block", marginBottom: 5 }}>Shape &amp; Geometry</label>
                  <input
                    value={editProdDnaForm.shape_geometry}
                    onChange={e => setEditProdDnaForm({ ...editProdDnaForm, shape_geometry: e.target.value })}
                    placeholder="e.g. Sleek rectangular wall unit with aerodynamically curved chamfered edges"
                    style={{ ...inputStyle, padding: "9px 12px", fontSize: 12, width: "100%", boxSizing: "border-box" }}
                  />
                </div>

                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: txt, display: "block", marginBottom: 5 }}>Branding, Text &amp; Logos</label>
                  <textarea
                    value={editProdDnaForm.branding}
                    onChange={e => setEditProdDnaForm({ ...editProdDnaForm, branding: e.target.value })}
                    placeholder="e.g. Panasonic brand logo in blue on lower right of front panel above INVERTER typography"
                    style={{ ...inputStyle, height: 55, resize: "none", fontSize: 12, width: "100%", boxSizing: "border-box" }}
                  />
                </div>

                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: txt, display: "block", marginBottom: 5 }}>Surface Details (Vents, Buttons, Seams, Displays)</label>
                  <textarea
                    value={editProdDnaForm.surface_details}
                    onChange={e => setEditProdDnaForm({ ...editProdDnaForm, surface_details: e.target.value })}
                    placeholder="e.g. Lower horizontal louvers with motorized directional fins, hidden digital temperature LED"
                    style={{ ...inputStyle, height: 55, resize: "none", fontSize: 12, width: "100%", boxSizing: "border-box" }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: txt, display: "block", marginBottom: 5 }}>Distinctive / Signature Features</label>
                  <input
                    value={editProdDnaForm.distinctive_features}
                    onChange={e => setEditProdDnaForm({ ...editProdDnaForm, distinctive_features: e.target.value })}
                    placeholder="e.g. Minimalist flush front panel without visible grilles"
                    style={{ ...inputStyle, padding: "9px 12px", fontSize: 12, width: "100%", boxSizing: "border-box" }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: txt, display: "block", marginBottom: 5 }}>Scale &amp; Dimensions</label>
                  <input
                    value={editProdDnaForm.scale_reference}
                    onChange={e => setEditProdDnaForm({ ...editProdDnaForm, scale_reference: e.target.value })}
                    placeholder="e.g. Residential indoor split unit, approx 85cm width"
                    style={{ ...inputStyle, padding: "9px 12px", fontSize: 12, width: "100%", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              {/* Studio Visual Edit Section */}
              <div style={{ padding: "14px", background: "rgba(139,92,246,0.06)", borderRadius: 12, border: "1px solid rgba(139,92,246,0.25)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#8B5CF6" }}>
                  <Sparkles size={14} /> Studio Visual Edit &amp; Iteration Pipeline
                </div>
                <div style={{ fontSize: 11, color: sub }}>
                  Provide natural language edit instructions to visually transform the product shot (e.g. modify colors, geometry, materials, or lighting):
                </div>
                <input
                  value={prodEditInstruction}
                  onChange={e => setProdEditInstruction(e.target.value)}
                  placeholder="e.g. Change body color to matte emerald green with gold Panasonic logo, add sleek metallic vent trim"
                  style={{ ...inputStyle, padding: "9px 12px", fontSize: 12, width: "100%", boxSizing: "border-box" }}
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ padding: "16px 24px", borderTop: `1px solid ${border}`, display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", background: isDark ? "#141414" : "#fafafa", flexWrap: "wrap" }}>
              <button onClick={() => setEditDnaProd(null)} style={btnGhost}>Cancel</button>
              <button
                onClick={saveProdDna}
                disabled={savingProdDna || editingProdWithPipeline}
                style={{ ...btnGhost, padding: "8px 16px", fontSize: 12, borderColor: border }}
              >
                {savingProdDna ? <><RefreshCw size={12} className="animate-spin" /> Saving...</> : "💾 Save DNA Only"}
              </button>
              <button
                onClick={applyProdEditAndRegenerate}
                disabled={savingProdDna || editingProdWithPipeline}
                style={{ ...btnPrimary, padding: "8px 20px", fontSize: 12, background: "#8B5CF6" }}
              >
                {editingProdWithPipeline ? <><RefreshCw size={12} className="animate-spin" /> Applying Edit Pipeline...</> : "✨ Apply & Regenerate Image (Studio Edit)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ GOOGLE VEO 3.1 ANIMATION STUDIO MODAL ═══ */}
      {hasVideoAccess && animModalOpen && animSourceFrame && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.78)", zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)", padding: 16 }}>
          <div style={{ background: card, width: "100%", maxWidth: 680, maxHeight: "92vh", borderRadius: 20, border: `1px solid ${border}`, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 32px 80px rgba(0,0,0,0.6)" }}>

            {/* Modal Header */}
            <div style={{ padding: "18px 24px", borderBottom: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #8B5CF6, #6366F1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                  <Film size={18} />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: txt }}>
                      {animMode === "transition"
                        ? `Animate Transition: Frame ${(animSourceFrame.order_index ?? 0) + 1} → ${(animTargetFrame?.order_index ?? 0) + 1}${animTargetFrame?.order_index === 0 && animSourceFrame?.order_index === frames.length - 1 ? " (Loop)" : ""}`
                        : `Animate Frame ${(animSourceFrame.order_index ?? 0) + 1}`}
                    </h3>
                    <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: animModelTier === "flagship" ? "linear-gradient(135deg, #EC4899, #8B5CF6)" : "linear-gradient(135deg, #8B5CF6, #4F46E5)", padding: "2px 8px", borderRadius: 12, letterSpacing: 0.5 }}>
                      {animModelTier === "flagship" ? "Veo 3.1 Flagship" : "Veo 3.1 Lite"} • {animResolution.toUpperCase()}
                    </span>
                  </div>
                  <p style={{ fontSize: 11, color: sub, margin: "3px 0 0" }}>
                    {animMode === "transition"
                      ? "Interpolate between frames with physics-aware continuity and smooth camera movement"
                      : "Bring this frame to life with cinematic AI motion, camera choreography, and lighting"}
                  </p>
                </div>
              </div>
              <button onClick={() => setAnimModalOpen(false)} style={{ background: "none", border: "none", color: sub, cursor: "pointer", padding: 6, borderRadius: 8, display: "flex", alignItems: "center" }}>
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>

              {/* Video Player (if video URL exists) */}
              {(animPreviewVideoUrl || (animMode === "single" ? animSourceFrame.video_url : animSourceFrame.transition_video_url)) ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: sub, letterSpacing: 0.5 }}>GENERATED VIDEO PREVIEW</span>
                    <button
                      onClick={() => {
                        const url = animPreviewVideoUrl || (animMode === "single" ? animSourceFrame.video_url : animSourceFrame.transition_video_url);
                        downloadVideo(url, `veo3_${animMode}_frame_${(animSourceFrame.order_index ?? 0) + 1}.mp4`);
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", color: "#8B5CF6", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                    >
                      <Download size={12} /> Download MP4
                    </button>
                  </div>
                  <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", maxHeight: 320, borderRadius: 12, overflow: "hidden", background: "#000", border: `1px solid ${border}` }}>
                    <video
                      src={animPreviewVideoUrl || (animMode === "single" ? animSourceFrame.video_url : animSourceFrame.transition_video_url)}
                      controls
                      autoPlay
                      loop
                      playsInline
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  </div>
                </div>
              ) : (
                /* Source Frame(s) Visual Preview */
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: sub, letterSpacing: 0.5 }}>
                      SOURCE FRAME{animMode === "transition" ? "S" : ""}
                    </div>
                    {animMode === "transition" && frames.length > 1 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: sub, fontWeight: 600 }}>Transition to:</span>
                        <select
                          value={animTargetFrame?.id || ""}
                          onChange={(e) => {
                            const selected = frames.find((f: any) => f.id === e.target.value);
                            if (selected) {
                              setAnimTargetFrame(selected);
                              fetchDirectorBridgePrompt(animSourceFrame, selected, animDuration, animStylePreference);
                            }
                          }}
                          style={{
                            padding: "3px 8px",
                            borderRadius: 8,
                            background: isDark ? "#222" : "#f1f5f9",
                            border: `1px solid ${border}`,
                            color: txt,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                            outline: "none",
                          }}
                        >
                          {frames.filter((f: any) => f.id !== animSourceFrame.id).map((f: any) => {
                            const isFirst = f.order_index === 0;
                            const isLoop = isFirst && animSourceFrame.order_index === frames.length - 1;
                            return (
                              <option key={f.id} value={f.id}>
                                Frame {(f.order_index ?? 0) + 1} {isLoop ? "(Loop 🔁)" : ""}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                  </div>
                  {animMode === "transition" && animTargetFrame ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ flex: 1, borderRadius: 10, overflow: "hidden", border: `1px solid ${border}`, position: "relative", aspectRatio: "16/9", background: isDark ? "#111" : "#eee" }}>
                        <img
                          src={animSourceFrame.image_path?.startsWith("http") ? animSourceFrame.image_path : `${API}/${animSourceFrame.image_path}`}
                          alt="Start Frame"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                        <div style={{ position: "absolute", bottom: 6, left: 6, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4 }}>
                          Frame {(animSourceFrame.order_index ?? 0) + 1} (Start)
                        </div>
                      </div>

                      <div style={{ width: 32, height: 32, borderRadius: 16, background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#8B5CF6", flexShrink: 0 }}>
                        <ArrowRight size={16} />
                      </div>

                      <div style={{ flex: 1, borderRadius: 10, overflow: "hidden", border: `1px solid ${border}`, position: "relative", aspectRatio: "16/9", background: isDark ? "#111" : "#eee" }}>
                        <img
                          src={animTargetFrame.image_path?.startsWith("http") ? animTargetFrame.image_path : `${API}/${animTargetFrame.image_path}`}
                          alt="End Frame"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                        <div style={{ position: "absolute", bottom: 6, left: 6, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4 }}>
                          Frame {(animTargetFrame.order_index ?? 0) + 1} (End{animTargetFrame.order_index === 0 && animSourceFrame.order_index === frames.length - 1 ? " / Loop" : ""})
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ width: "100%", maxWidth: 360, margin: "0 auto", borderRadius: 12, overflow: "hidden", border: `1px solid ${border}`, position: "relative", aspectRatio: "16/9", background: isDark ? "#111" : "#eee" }}>
                      <img
                        src={animSourceFrame.image_path?.startsWith("http") ? animSourceFrame.image_path : `${API}/${animSourceFrame.image_path}`}
                        alt="Frame"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <div style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4 }}>
                        Frame {(animSourceFrame.order_index ?? 0) + 1}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Quality, Model Tier & Resolution Controls */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {/* Model Tier */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: sub, letterSpacing: 0.5, display: "block", marginBottom: 6 }}>
                    MODEL ENGINE
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {[
                      { id: "lite", label: "Veo 3.1 Lite", tag: "Fast & Efficient" },
                      { id: "flagship", label: "Veo 3.1 Flagship", tag: "Max Realism" },
                    ].map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setAnimModelTier(m.id as any)}
                        style={{
                          padding: "8px 6px",
                          borderRadius: 10,
                          border: `1.5px solid ${animModelTier === m.id ? "#8B5CF6" : border}`,
                          background: animModelTier === m.id ? "rgba(139,92,246,0.12)" : "transparent",
                          color: animModelTier === m.id ? (isDark ? "#c084fc" : "#7c3aed") : txt,
                          cursor: "pointer",
                          textAlign: "center",
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700 }}>{m.label}</div>
                        <div style={{ fontSize: 9, color: animModelTier === m.id ? "#8B5CF6" : sub }}>{m.tag}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Resolution */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: sub, letterSpacing: 0.5, display: "block", marginBottom: 6 }}>
                    OUTPUT RESOLUTION
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {[
                      { res: "1080p", label: "1080p", tag: "Full HD (Recommended)" },
                      { res: "720p", label: "720p", tag: "Draft / Fast" },
                    ].map(r => (
                      <button
                        key={r.res}
                        type="button"
                        onClick={() => setAnimResolution(r.res as any)}
                        style={{
                          padding: "8px 4px",
                          borderRadius: 10,
                          border: `1.5px solid ${animResolution === r.res ? "#8B5CF6" : border}`,
                          background: animResolution === r.res ? "rgba(139,92,246,0.12)" : "transparent",
                          color: animResolution === r.res ? (isDark ? "#c084fc" : "#7c3aed") : txt,
                          cursor: "pointer",
                          textAlign: "center",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 800 }}>{r.label}</div>
                        <div style={{ fontSize: 9, color: animResolution === r.res ? "#8B5CF6" : sub }}>{r.tag}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Duration & Audio Selector */}
              <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", gap: 12, alignItems: "center" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: sub, letterSpacing: 0.5 }}>ANIMATION DURATION</label>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#8B5CF6" }}>{animDuration}s output</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    {[
                      { sec: 4, label: "4s", subtext: "Quick shot" },
                      { sec: 6, label: "6s", subtext: "Recommended" },
                      { sec: 8, label: "8s", subtext: "Extended cinematic" },
                    ].map(item => (
                      <button
                        key={item.sec}
                        type="button"
                        onClick={() => setAnimDuration(item.sec)}
                        style={{
                          padding: "8px 6px",
                          borderRadius: 10,
                          border: `1.5px solid ${animDuration === item.sec ? "#8B5CF6" : border}`,
                          background: animDuration === item.sec ? "rgba(139,92,246,0.12)" : "transparent",
                          color: animDuration === item.sec ? (isDark ? "#c084fc" : "#7c3aed") : txt,
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 2,
                          transition: "all 0.15s",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 800 }}>{item.label}</span>
                        <span style={{ fontSize: 9, color: animDuration === item.sec ? "#8B5CF6" : sub }}>{item.subtext}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* AI Synced Audio Toggle */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: sub, letterSpacing: 0.5, display: "block", marginBottom: 6 }}>
                    AI AUDIO
                  </label>
                  <button
                    type="button"
                    onClick={() => setAnimGenerateAudio(!animGenerateAudio)}
                    style={{
                      width: "100%",
                      padding: "8px 6px",
                      borderRadius: 10,
                      border: `1.5px solid ${animGenerateAudio ? "#10b981" : border}`,
                      background: animGenerateAudio ? "rgba(16,185,129,0.12)" : "transparent",
                      color: animGenerateAudio ? (isDark ? "#34d399" : "#059669") : sub,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 2,
                      transition: "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 800 }}>{animGenerateAudio ? "🔊 Synced" : "🔇 Off"}</span>
                    <span style={{ fontSize: 9 }}>{animGenerateAudio ? "Ambient sound" : "Muted"}</span>
                  </button>
                </div>
              </div>

              {/* AI Director Bridge & Transition Choreography (Transition Mode) */}
              {animMode === "transition" && (
                <div style={{ padding: "14px", borderRadius: 12, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Sparkles size={14} style={{ color: "#8B5CF6" }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: txt }}>AI Director Transition Engine</span>
                    </div>
                    <button
                      type="button"
                      disabled={animDirectorLoading || !animTargetFrame}
                      onClick={() => fetchDirectorBridgePrompt(animSourceFrame, animTargetFrame, animDuration, animStylePreference)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 8,
                        background: "linear-gradient(135deg, #8B5CF6, #6366F1)",
                        border: "none",
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: animDirectorLoading ? "not-allowed" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        boxShadow: "0 2px 8px rgba(139,92,246,0.35)",
                      }}
                    >
                      {animDirectorLoading ? (
                        <><RefreshCw size={11} className="animate-spin" /> Crafting Director Script...</>
                      ) : (
                        <><Sparkles size={11} /> Re-Craft with AI Director</>
                      )}
                    </button>
                  </div>

                  <div style={{ fontSize: 11, color: sub, lineHeight: 1.4 }}>
                    Analyzes character DNA, props, and camera trajectories between Frame {(animSourceFrame.order_index ?? 0) + 1} and {(animTargetFrame?.order_index ?? 0) + 1} to prevent melting faces, mutated limbs, and sudden cuts.
                  </div>

                  {/* Transition Style Selector */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: sub, marginBottom: 5, letterSpacing: 0.5 }}>CHOREOGRAPHY STYLE</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {[
                        { id: "natural_action", label: "🎬 Natural Subject Action" },
                        { id: "dolly_in", label: "🎥 Smooth Dolly-In" },
                        { id: "tracking_pan", label: "🔄 Continuous Pan & Track" },
                        { id: "subtle_morph", label: "✨ Subtle Depth Morph" },
                      ].map(style => (
                        <button
                          key={style.id}
                          type="button"
                          onClick={() => {
                            setAnimStylePreference(style.id);
                            fetchDirectorBridgePrompt(animSourceFrame, animTargetFrame, animDuration, style.id);
                          }}
                          style={{
                            padding: "4px 9px",
                            borderRadius: 14,
                            border: `1px solid ${animStylePreference === style.id ? "#8B5CF6" : border}`,
                            background: animStylePreference === style.id ? "rgba(139,92,246,0.18)" : (isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"),
                            color: animStylePreference === style.id ? (isDark ? "#c084fc" : "#7c3aed") : sub,
                            fontSize: 10,
                            fontWeight: animStylePreference === style.id ? 700 : 500,
                            cursor: "pointer",
                            transition: "all 0.15s",
                          }}
                        >
                          {style.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Motion & Camera Direction Prompt */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: sub, letterSpacing: 0.5 }}>
                    {animMode === "transition" ? "CINEMATIC DIRECTOR TRANSITION SCRIPT" : "MOTION & CAMERA DIRECTION"}
                  </label>
                  {animDirectorLoading ? (
                    <span style={{ fontSize: 10, color: "#8B5CF6", display: "flex", alignItems: "center", gap: 4 }}>
                      <RefreshCw size={10} className="animate-spin" /> AI optimizing...
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, color: sub }}>Action &amp; camera choreography</span>
                  )}
                </div>

                <textarea
                  value={animPrompt}
                  onChange={e => setAnimPrompt(e.target.value)}
                  placeholder={
                    animMode === "transition"
                      ? "Detailed continuous action describing how the character moves, how props are handled, and how the camera transitions..."
                      : "Describe the movement, camera motion, and action in the frame..."
                  }
                  style={{
                    ...inputStyle,
                    height: 84,
                    resize: "none",
                    fontSize: 12,
                    lineHeight: 1.55,
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* ── QUALITY GUARDRAILS & NEGATIVE PROMPTS ── */}
              <div style={{ padding: "12px 14px", borderRadius: 12, background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)", border: `1px solid ${border}`, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: txt }}>
                    <span>🛡️ Quality Guardrails Active</span>
                    <span style={{ fontSize: 9, color: "#22c55e", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", padding: "1px 6px", borderRadius: 10, fontWeight: 700 }}>
                      Enforced
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNegativePromptDrawer(!showNegativePromptDrawer)}
                    style={{ background: "none", border: "none", color: "#8B5CF6", cursor: "pointer", fontSize: 10, fontWeight: 600, padding: 0 }}
                  >
                    {showNegativePromptDrawer ? "Hide Negative Prompt" : "View / Customize Negative Prompt ▾"}
                  </button>
                </div>

                {/* Guardrail Badges */}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {[
                    "✓ Anti-Morphing Faces",
                    "✓ Anatomical Hand & Limb Guard",
                    "✓ Physical Object Stability",
                    "✓ Anti-Jitter & Tear Filter",
                    "✓ Smooth Camera Continuity",
                  ].map(b => (
                    <span key={b} style={{ fontSize: 9, color: isDark ? "#94a3b8" : "#475569", background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", padding: "3px 7px", borderRadius: 6, fontWeight: 600 }}>
                      {b}
                    </span>
                  ))}
                </div>

                {/* Expandable Negative Prompt Editor */}
                {showNegativePromptDrawer && (
                  <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: sub }}>NEGATIVE PROMPT (WHAT TO AVOID)</span>
                      <button
                        type="button"
                        onClick={() => setAnimNegativePrompt(DEFAULT_NEGATIVE_PROMPT_FRONTEND)}
                        style={{ background: "none", border: "none", color: sub, cursor: "pointer", fontSize: 9, textDecoration: "underline" }}
                      >
                        Reset to Strict Default
                      </button>
                    </div>
                    <textarea
                      value={animNegativePrompt}
                      onChange={e => setAnimNegativePrompt(e.target.value)}
                      placeholder="Enter negative prompts to avoid unwanted artifacts..."
                      style={{
                        ...inputStyle,
                        height: 56,
                        resize: "none",
                        fontSize: 10,
                        lineHeight: 1.4,
                        width: "100%",
                        boxSizing: "border-box",
                        color: sub,
                      }}
                    />
                  </div>
                )}
              </div>

              <div style={{ padding: "10px 14px", borderRadius: 10, background: isDark ? "rgba(139,92,246,0.06)" : "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.2)", fontSize: 11, color: sub, lineHeight: 1.5 }}>
                💡 <b style={{ color: txt }}>Powered by Google Veo 3.1 via fal.ai.</b> Generating in <b style={{ color: "#8B5CF6" }}>{animResolution.toUpperCase()}</b> ({animModelTier === "flagship" ? "Flagship Photorealism" : "Veo 3.1 Lite"}) with {animGenerateAudio ? "synced ambient audio" : "no audio"} and strict anti-morphing guardrails.
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ padding: "16px 24px", borderTop: `1px solid ${border}`, display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", background: isDark ? "#141414" : "#fafafa" }}>
              <button onClick={() => setAnimModalOpen(false)} style={btnGhost}>Close</button>
              <button
                onClick={triggerAnimation}
                disabled={animSubmitting || !animSourceFrame?.image_path}
                style={{
                  ...btnPrimary,
                  padding: "10px 22px",
                  fontSize: 13,
                  fontWeight: 700,
                  background: "linear-gradient(135deg, #8B5CF6, #6366F1)",
                  color: "#fff",
                  boxShadow: "0 4px 16px rgba(139,92,246,0.4)",
                  cursor: animSubmitting || !animSourceFrame?.image_path ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                {animSubmitting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    Starting Veo 3.1...
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    {animPreviewVideoUrl ? "Re-generate Video (Veo 3.1)" : "Generate Video (Veo 3.1)"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ STEP 2 DNA SYNC MODAL ═══ */}
      {syncPromptModal.open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 20
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSyncPromptModal({ open: false, entityName: "", entityType: "character" });
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              background: card,
              border: `1px solid ${border}`,
              borderRadius: 16,
              padding: 24,
              boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              animation: "fadeIn 0.2s ease"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "rgba(249,87,56,0.12)",
                color: accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <Sparkles size={20} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: txt }}>
                  Update Storyboard Contact Sheet?
                </div>
                <div style={{ fontSize: 12, color: sub }}>
                  Visual DNA for <b>{syncPromptModal.entityName}</b> was updated
                </div>
              </div>
            </div>

            <div style={{ fontSize: 13, color: sub, lineHeight: 1.6 }}>
              You updated the {syncPromptModal.entityType === "character" ? "character turnarounds & facial features" : "product styling"} for <b style={{ color: txt }}>{syncPromptModal.entityName}</b>.
              Would you like to regenerate the storyboard contact sheet so all panels reflect this updated visual DNA?
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, paddingTop: 6 }}>
              <button
                onClick={() => setSyncPromptModal({ open: false, entityName: "", entityType: "character" })}
                style={{
                  ...btnGhost,
                  padding: "8px 16px",
                  fontSize: 12,
                  borderRadius: 8
                }}
              >
                Keep Current Panels
              </button>
              <button
                onClick={() => {
                  setSyncPromptModal({ open: false, entityName: "", entityType: "character" });
                  setActiveStep(1);
                  triggerGenerateContactSheet(smartFrameCount || 6, activeSb);
                }}
                style={{
                  ...btnPrimary,
                  background: `linear-gradient(135deg, ${accent}, #ea580c)`,
                  padding: "8px 18px",
                  fontSize: 12,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 6
                }}
              >
                <Sparkles size={14} />
                <span>Regenerate Contact Sheet (Step 1)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ USER IMPERSONATION SWITCHER MODAL ═══ */}
      {impersonationModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(6px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setImpersonationModalOpen(false);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              background: card,
              border: `1px solid ${border}`,
              borderRadius: 16,
              boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              maxHeight: "85vh",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "18px 24px",
                borderBottom: `1px solid ${border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: "rgba(168,85,247,0.15)",
                    border: "1px solid rgba(168,85,247,0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#a855f7",
                  }}
                >
                  <Eye size={18} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: txt }}>
                    Impersonate User Storyboard
                  </h3>
                  <p style={{ fontSize: 12, color: sub, margin: 0 }}>
                    View and test storyboards exactly as this user sees them
                  </p>
                </div>
              </div>
              <button
                onClick={() => setImpersonationModalOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: sub,
                  cursor: "pointer",
                  padding: 4,
                  borderRadius: 6,
                  display: "flex",
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Search Box */}
            <div style={{ padding: "14px 24px 10px", borderBottom: `1px solid ${border}` }}>
              <div style={{ position: "relative" }}>
                <Search
                  size={15}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: sub,
                  }}
                />
                <input
                  type="text"
                  placeholder="Search user by name, email, or role..."
                  value={impersonationSearch}
                  onChange={(e) => setImpersonationSearch(e.target.value)}
                  style={{
                    ...inputStyle,
                    padding: "9px 12px 9px 36px",
                    fontSize: 13,
                    borderRadius: 8,
                  }}
                  autoFocus
                />
              </div>
            </div>

            {/* User List */}
            <div
              style={{
                padding: "12px 18px",
                overflowY: "auto",
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                minHeight: 220,
              }}
            >
              {loadingImpersonationUsers ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0", gap: 12, color: sub }}>
                  <RefreshCw size={22} className="animate-spin" style={{ color: "#a855f7" }} />
                  <span style={{ fontSize: 13 }}>Loading users...</span>
                </div>
              ) : (
                (() => {
                  const filtered = impersonationUsersList.filter((u: any) => {
                    if (!impersonationSearch.trim()) return true;
                    const q = impersonationSearch.toLowerCase();
                    return (
                      (u.name && u.name.toLowerCase().includes(q)) ||
                      (u.email && u.email.toLowerCase().includes(q)) ||
                      (u.role && u.role.toLowerCase().includes(q))
                    );
                  });

                  if (filtered.length === 0) {
                    return (
                      <div style={{ textAlign: "center", padding: "40px 16px", color: sub, fontSize: 13 }}>
                        No users match "{impersonationSearch}"
                      </div>
                    );
                  }

                  return filtered.map((u: any) => {
                    const isCurrentlyActive = impersonatedUser?.id === u.id;
                    const isSelf = user?.id === u.id;
                    return (
                      <div
                        key={u.id}
                        onClick={() => {
                          if (isCurrentlyActive) {
                            setImpersonationModalOpen(false);
                          } else if (isSelf) {
                            exitImpersonation();
                            setImpersonationModalOpen(false);
                          } else {
                            switchImpersonatedUser({ id: u.id, email: u.email, name: u.name });
                          }
                        }}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: isCurrentlyActive
                            ? "1.5px solid #a855f7"
                            : `1px solid ${border}`,
                          background: isCurrentlyActive
                            ? (isDark ? "rgba(168,85,247,0.12)" : "rgba(168,85,247,0.06)")
                            : (isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)"),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          if (!isCurrentlyActive) {
                            e.currentTarget.style.borderColor = isDark ? "#444" : "#ccc";
                            e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isCurrentlyActive) {
                            e.currentTarget.style.borderColor = border;
                            e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)";
                          }
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: "50%",
                              background: isCurrentlyActive
                                ? "#a855f7"
                                : (isDark ? "#333" : "#e5e7eb"),
                              color: isCurrentlyActive ? "#fff" : txt,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 13,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              flexShrink: 0,
                            }}
                          >
                            {(u.name?.[0] || u.email?.[0] || "?").toUpperCase()}
                          </div>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: txt }}>
                                {u.name || u.email}
                              </span>
                              {isSelf && (
                                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(59,130,246,0.15)", color: "#3b82f6", fontWeight: 700 }}>
                                  You
                                </span>
                              )}
                              {u.role === "admin" && (
                                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(249,115,22,0.15)", color: "#f97316", fontWeight: 700 }}>
                                  Admin
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>
                              {u.email}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {/* Admin Video Rights Control Toggle */}
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const nextVal = !u.can_generate_video;
                                await api.post(`/api/storyboard/admin/users/${u.id}/toggle-video-access`, { can_generate_video: nextVal });
                                u.can_generate_video = nextVal;
                                setImpersonationUsersList([...impersonationUsersList]);
                                toast.success(`Video rights ${nextVal ? "granted to" : "revoked from"} ${u.name || u.email}`);
                              } catch (err: any) {
                                toast.error(err?.response?.data?.detail || "Failed to toggle video access");
                              }
                            }}
                            title={u.can_generate_video ? "Video generation enabled. Click to revoke." : "Video generation locked. Click to grant."}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "3px 8px",
                              borderRadius: 6,
                              background: u.can_generate_video ? "rgba(34,197,94,0.15)" : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"),
                              border: u.can_generate_video ? "1px solid rgba(34,197,94,0.4)" : `1px solid ${border}`,
                              color: u.can_generate_video ? "#22c55e" : sub,
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                          >
                            <Video size={11} />
                            <span>{u.can_generate_video ? "Video Allowed" : "Video Locked"}</span>
                          </button>

                          <span
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              borderRadius: 12,
                              background: u.storyboard_count > 0 ? (isDark ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.08)") : (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"),
                              color: u.storyboard_count > 0 ? "#22c55e" : sub,
                              fontWeight: 600,
                            }}
                          >
                            {u.storyboard_count} {u.storyboard_count === 1 ? "storyboard" : "storyboards"}
                          </span>

                          {isCurrentlyActive ? (
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#a855f7", display: "flex", alignItems: "center", gap: 4 }}>
                              <Check size={13} /> Active
                            </span>
                          ) : (
                            <button
                              style={{
                                background: "none",
                                border: "1px solid rgba(168,85,247,0.3)",
                                color: "#a855f7",
                                padding: "4px 10px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              Impersonate
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "12px 24px",
                borderTop: `1px solid ${border}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: isDark ? "rgba(255,255,255,0.01)" : "rgba(0,0,0,0.01)",
              }}
            >
              {impersonatedUser ? (
                <button
                  onClick={() => {
                    exitImpersonation();
                    setImpersonationModalOpen(false);
                  }}
                  style={{
                    background: "none",
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: "#ef4444",
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Exit Impersonation
                </button>
              ) : (
                <div />
              )}
              <button
                onClick={() => setImpersonationModalOpen(false)}
                style={{ ...btnGhost, padding: "6px 14px", borderRadius: 8 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

