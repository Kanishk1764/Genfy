'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { get, set as idbSet, del as idbDel } from 'idb-keyval';
import { StudioButton } from "@/components/ui/studio-button";
import { CopyButton } from "@/components/ui/copy-button";
import GenfyNav from "@landing/ui/genfy-nav";
import api, { API_BASE_URL } from "@/utils/api";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner"; // Assuming sonner is available or will be used for feedback
import { CameraControlPopover } from "@/components/CameraControlPopover";
import { RelightControlPopover } from "@/components/RelightControlPopover";
import { SkinEnhancerPopover } from "@/components/SkinEnhancerPopover";

// api utility is imported at line 7 and handles baseURL dynamically

// ------------------------------------------------------------------
// RECOMMENDATION MAPPINGS
// ------------------------------------------------------------------
const KEY_TO_JSON: Record<string, string> = {
  style: 'visualStyle', medium: 'medium', lighting: 'lighting',
  composition: 'composition', camera: 'cameraAngle', lens: 'lens',
  mood: 'mood', color: 'colorPalette'
};
const JSON_TO_KEY: Record<string, string> = {
  visualStyle: 'style', medium: 'medium', lighting: 'lighting',
  composition: 'composition', cameraAngle: 'camera', lens: 'lens',
  mood: 'mood', colorPalette: 'color'
};

export function formatUserFriendlyError(raw?: string | null): string {
  if (!raw) return 'An unexpected error occurred. Please try again.';
  const lower = raw.toLowerCase();
  if (lower.includes('weekly limit reached')) {
    return raw;
  }
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'High server demand: AI model capacity temporarily reached. Please wait a few moments and try again.';
  }
  if (lower.includes('safety') || lower.includes('prohibited') || lower.includes('policy') || lower.includes('blocked') || lower.includes('violat')) {
    return 'Prompt blocked: The request violates safety or content guidelines. Please adjust your prompt.';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadlineexceeded') || lower.includes('504')) {
    return 'Generation timed out. The upstream server was slow to respond. Please try again.';
  }
  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('busy') || lower.includes('overloaded')) {
    return 'AI service is temporarily busy due to high demand. Please try again shortly.';
  }
  if (lower.includes('cancelled') || lower.includes('canceled')) {
    return 'Generation cancelled.';
  }
  if (raw.length > 120 || raw.includes('{') || raw.includes('google.rpc') || raw.includes('Traceback')) {
    return 'AI generation failed due to a temporary upstream error. Please try again.';
  }
  return raw;
}

// ASPECT RATIO DATA
// ------------------------------------------------------------------
const ratioData = [
  { id: '1:1',  label: '1:1',  icon: '⬜', name: 'Square',      prompt: 'square 1:1 aspect ratio',             svgW: 34, svgH: 34 },
  { id: '16:9', label: '16:9', icon: '🖥️', name: 'Landscape',   prompt: 'landscape 16:9 widescreen aspect ratio', svgW: 46, svgH: 36 },
  { id: '9:16', label: '9:16', icon: '📱', name: 'Portrait',    prompt: 'portrait 9:16 vertical aspect ratio',    svgW: 22, svgH: 40 },
  { id: '4:5',  label: '4:5',  icon: '📷', name: 'Social',      prompt: 'social media 4:5 aspect ratio',          svgW: 26, svgH: 34 },
  { id: '3:2',  label: '3:2',  icon: '🖼️', name: 'Photo Print', prompt: 'photo print 3:2 aspect ratio',           svgW: 42, svgH: 30 },
  { id: '2:3',  label: '2:3',  icon: '📄', name: 'Poster',      prompt: 'poster 2:3 vertical aspect ratio',       svgW: 28, svgH: 42 },
  { id: '4:3',  label: '4:3',  icon: '📺', name: 'Standard TV', prompt: 'standard 4:3 aspect ratio',              svgW: 44, svgH: 34 },
  { id: '3:4',  label: '3:4',  icon: '📋', name: 'Vertical',   prompt: 'vertical 3:4 aspect ratio',              svgW: 32, svgH: 42 },
  { id: '5:4',  label: '5:4',  icon: '🖼️', name: 'Classic',    prompt: 'classic 5:4 aspect ratio',               svgW: 44, svgH: 36 },
  { id: '4:1',  label: '4:1',  icon: '📰', name: 'Wide Banner', prompt: 'wide banner 4:1 aspect ratio',           svgW: 52, svgH: 22 },
  { id: '1:4',  label: '1:4',  icon: '🎞️', name: 'Tall Banner', prompt: 'tall banner 1:4 aspect ratio',           svgW: 22, svgH: 52 },
  { id: '8:1',  label: '8:1',  icon: '📏', name: 'Panoramic',   prompt: 'panoramic 8:1 aspect ratio',             svgW: 60, svgH: 20 },
  { id: '1:8',  label: '1:8',  icon: '📐', name: 'Ultra Tall',  prompt: 'ultra-tall 1:8 aspect ratio',            svgW: 20, svgH: 60 },
  { id: '21:9', label: '21:9', icon: '🎬', name: 'Cinematic',   prompt: 'cinematic ultrawide 21:9 aspect ratio',  svgW: 54, svgH: 26 },
];

const qualityData = [
  { id: 'Standard', label: 'Standard', res: '1K', icon: '*', desc: 'Fast · 1K (1024px)', prompt: 'standard quality' },
  { id: 'High',     label: 'High',     res: '2K', icon: '*', desc: 'Balanced · 2K (2048px)', prompt: 'high quality, highly detailed' },
  { id: 'Ultra',    label: 'Ultra',    res: '4K', icon: '*', desc: 'Max detail · 4K (4096px)', prompt: 'ultra quality, maximum detail, 8K resolution, masterpiece' },
];

// Placeholder generated image URLs (demo - now empty by default)
const DEMO_IMAGES: string[] = [];

// Available models
const AVAILABLE_MODELS = ['Nanobanana 2', 'Nanobanana Pro', 'ChatGPT', 'Kling', 'Flux.1', 'Midjourney', 'Stable Diffusion', 'Grok-2'];
// Models that are fully integrated and selectable in the UI
const INTEGRATED_MODELS = ['Nanobanana 2', 'Nanobanana Pro', 'ChatGPT', 'Kling', 'Flux.1'];
// Models not yet integrated (shown greyed-out as "coming soon")
const COMING_SOON_MODELS = ['Midjourney', 'Stable Diffusion', 'Grok-2'];
// Default initial selection — single model so users don't accidentally trigger compare mode
const DEFAULT_SELECTED_MODELS = ['Nanobanana 2'];
// Alias kept for any references still using DEFAULT_COMPARE_MODELS
const DEFAULT_COMPARE_MODELS = INTEGRATED_MODELS;

// ChatGPT sub-models
const CHATGPT_SUB_MODELS = [
  { id: 'gpt-image-2', label: 'GPT Image 2', desc: 'State-of-the-art' },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5', desc: 'Previous flagship' },
  { id: 'chatgpt-image-latest', label: 'ChatGPT Image Latest', desc: 'Latest default' },
  { id: 'gpt-image-1', label: 'GPT Image 1', desc: 'Previous generation' },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1 Mini', desc: 'Cost-efficient' },
];

// Compare Arena types
interface CompareImageSlot {
  id: string;
  model_id: string;
  tailored_prompt: string;
  status: 'pending' | 'completed' | 'failed';
  url: string | null;
  error_msg: string | null;
  iteration: number;
}

interface VariantCard {
  modelId: string;
  sessionId: string;
  imageId: string;
  imageUrl: string;
  prompt: string;
  iterations: string[];
}

// ------------------------------------------------------------------
// DATA
// ------------------------------------------------------------------
const cats = {
  style: [
    { id: 'photorealistic', label: 'Photorealistic', desc: 'Real-world photographic quality', prompt: 'photorealistic, ultra realistic, highly detailed textures, natural lighting', grad: ['#8BA8C0', '#C9A96E', '#6B8E7F'], img: '/previews/Photorealistic.jpg' },
    { id: 'cinematic', label: 'Cinematic', desc: 'Film-style dramatic visuals', prompt: 'cinematic style, dramatic lighting, film still, high contrast, movie quality', grad: ['#0D0D1A', '#E94560', '#533483'], img: '/previews/Cinematic.jpg' },
    { id: 'anime', label: 'Anime', desc: 'Japanese animation style', prompt: 'anime style, cel shading, vibrant colors, clean outlines', grad: ['#FFB7C5', '#87CEEB', '#DDA0DD'], img: '/previews/Anime.jpg' },
    { id: 'oil-paint', label: 'Oil Painting', desc: 'Classic painterly look', prompt: 'oil painting, visible brush strokes, rich textures, classical art style', grad: ['#8B4513', '#D2691E', '#A0522D'], img: '/previews/Oilpainting.jpg' },
    { id: 'watercolor', label: 'Watercolor', desc: 'Soft blended paint', prompt: 'watercolor painting, soft edges, translucent colors, artistic wash', grad: ['#B5EAD7', '#FFDAC1', '#C7CEEA'], img: '/previews/Watercolor.jpg' },
    { id: 'concept-art', label: 'Concept Art', desc: 'Detailed creative illustration', prompt: 'concept art, highly detailed, digital painting, production design style', grad: ['#1C1C4E', '#C05C7E', '#F3826F'], img: '/previews/Conceptart.jpg' },
    { id: '3d-render', label: '3D Render', desc: 'CGI generated look', prompt: '3D render, octane render, global illumination, volumetric lighting', grad: ['#1A1A2E', '#16213E', '#4FC3F7'], img: '/previews/3drender.jpg' },
    { id: 'minimalist', label: 'Minimalist', desc: 'Clean and simple composition', prompt: 'minimalist, clean composition, simple forms, lots of negative space', grad: ['#E8E8E3', '#D4D4CF', '#BFBFBA'], img: '/previews/Minimalist.jpg' },
  ],
  medium: [
    { id: 'digital', label: 'Digital Art', desc: 'Modern digital painting', prompt: 'digital art, smooth shading, modern illustration', grad: ['#1A0533', '#6C3483', '#D2B4DE'], img: '/previews/Digitalart.jpg' },
    { id: 'photography', label: 'Photography', desc: 'Captured via camera', prompt: 'professional photography, realistic lighting, high dynamic range', grad: ['#2C3E50', '#7F8C8D', '#ECF0F1'], img: '/previews/Photography.jpg' },
    { id: 'charcoal', label: 'Charcoal', desc: 'Dark textured strokes', prompt: 'charcoal drawing, rough texture, high contrast shading', grad: ['#1C1C1C', '#404040', '#808080'], img: '/previews/Charcoal.jpg' },
    { id: 'ink', label: 'Ink Drawing', desc: 'Line-based art', prompt: 'ink drawing, black lines, detailed linework, high contrast', grad: ['#0D0D0D', '#1A1A1A', '#F5F5F0'], img: '/previews/Inkdrawing.jpg' },
    { id: 'acrylic', label: 'Acrylic', desc: 'Bold opaque paint', prompt: 'acrylic painting, bold colors, thick paint texture', grad: ['#FF6B6B', '#FFE66D', '#4ECDC4'], img: '/previews/Acrylic.jpg' },
    { id: 'collage', label: 'Mixed Media', desc: 'Layered textures', prompt: 'mixed media collage, layered textures, experimental composition', grad: ['#E74C3C', '#F39C12', '#2ECC71'], img: '/previews/Mixedmedia.jpg' },
  ],
  lighting: [
    { id: 'natural', label: 'Natural', desc: 'Soft daylight', prompt: 'natural lighting, soft diffused daylight, no harsh shadows, even illumination', grad: ['#E8F5E9', '#A5D6A7', '#66BB6A'], img: '/previews/Natural.jpg' },
    { id: 'golden', label: 'Golden Hour', desc: 'Warm sunlight', prompt: 'golden hour lighting, warm sunlight, soft shadows, sunset glow', grad: ['#FF8C42', '#FF5D01', '#FFBA08'], img: '/previews/Goldenhour.jpg' },
    { id: 'blue-hour', label: 'Blue Hour', desc: 'Cool twilight', prompt: 'blue hour lighting, cool tones, soft ambient light', grad: ['#0D3349', '#1B6CA8', '#89C4F4'], img: '/previews/Bluehour.jpg' },
    { id: 'studio', label: 'Studio', desc: 'Controlled lighting', prompt: 'studio lighting, softbox lighting, evenly lit subject', grad: ['#F0F0F0', '#D0D0D0', '#B0B0B0'], img: '/previews/Studio.jpg' },
    { id: 'dramatic', label: 'Dramatic', desc: 'High contrast', prompt: 'dramatic lighting, deep shadows, strong highlights', grad: ['#0A0A0A', '#1C1C1C', '#8B0000'], img: '/previews/Dramatic.jpg' },
    { id: 'neon', label: 'Neon', desc: 'Colorful artificial light', prompt: 'neon lighting, glowing lights, vibrant colors, cyberpunk glow', grad: ['#FF00FF', '#00FFFF', '#0A0A2E'], img: '/previews/Neon.jpg' },
    { id: 'volumetric', label: 'Volumetric', desc: 'Light rays', prompt: 'volumetric lighting, god rays, fog, light beams', grad: ['#FFF8E1', '#F3E5AB', '#C5A028'], img: '/previews/Volumetric.jpg' },
    { id: 'moonlight', label: 'Moonlight', desc: 'Night lighting', prompt: 'moonlight, cool blue tones, soft shadows', grad: ['#1C2951', '#2E4A7A', '#C8D8F0'], img: '/previews/Moonlight.jpg' },
    { id: 'candlelight', label: 'Candlelight', desc: 'Warm soft glow', prompt: 'candlelight, warm glow, soft flickering light', grad: ['#FF6600', '#FF9900', '#FFCC00'], img: '/previews/Candlelight.jpg' },
  ],
  composition: [
    { id: 'centered', label: 'Centered', desc: 'Symmetrical framing', prompt: 'centered composition, symmetrical framing', grad: ['#2C3E50', '#3498DB', '#ECF0F1'], img: '/previews/Centred.jpg' },
    { id: 'rule-thirds', label: 'Rule of Thirds', desc: 'Off-center balance', prompt: 'rule of thirds composition, balanced framing', grad: ['#1A472A', '#2D6A4F', '#74C69D'], img: '/previews/Ruleofthirds.jpg' },
    { id: 'flat-lay', label: 'Flat Lay', desc: 'Top-down arrangement', prompt: 'flat lay, top down view', grad: ['#F8F0E3', '#E8D5B7', '#CBBAA0'], img: '/previews/Flatlay.jpg' },
    { id: 'panoramic', label: 'Panoramic', desc: 'Ultra-wide landscape', prompt: 'panoramic composition, ultra wide view', grad: ['#0077B6', '#00B4D8', '#90E0EF'], img: '/previews/Panoramic.jpg' },
  ],
  camera: [
    { id: 'worms-eye', label: "Worm's Eye View", desc: 'Looking straight up', prompt: "worm's eye view, extreme low angle, looking up perspective", grad: ['#0A0A1A', '#1E1E3E', '#4040A0'], img: '/previews/Wormseyeview.jpg' },
    { id: 'dutch', label: 'Dutch Angle', desc: 'Tilted dramatic frame', prompt: 'dutch angle, tilted frame, dynamic composition', grad: ['#1A0A0A', '#3E1E1E', '#A04040'], img: '/previews/Dutchangle.jpg' },
    { id: 'birds-eye', label: "Bird's Eye", desc: 'Looking down from above', prompt: "bird's eye view, top down perspective", grad: ['#0A1A0A', '#1E3E1E', '#40A040'], img: '/previews/Birdseye.jpg' },
    { id: 'extreme-cu', label: 'Extreme Close-Up', desc: 'Macro extreme detail', prompt: 'extreme close-up, macro detail, highly detailed subject', grad: ['#1A1A0A', '#3E3E1E', '#A0A040'], img: '/previews/Extremecloseup.jpg' },
    { id: 'wide-shot', label: 'Wide Shot', desc: 'Full environment view', prompt: 'wide shot, full scene view, environmental composition', grad: ['#0A1A1A', '#1E3E3E', '#40A0A0'], img: '/previews/Wideshot.jpg' },
    { id: 'medium-shot', label: 'Medium Shot', desc: 'Waist-up portrait', prompt: 'medium shot, waist-up framing', grad: ['#1A0A1A', '#3E1E3E', '#A04040'], img: '/previews/Mediumshot.jpg' },
    { id: 'close-up', label: 'Close-Up', desc: 'Face or detail fill', prompt: 'close-up shot, detailed subject focus', grad: ['#1A0A08', '#3E2018', '#C06040'], img: '/previews/Closeup.jpg' },
    { id: 'low-angle', label: 'Low Angle', desc: 'Looking up, heroic', prompt: 'low angle shot, looking up, dramatic perspective', grad: ['#080A1A', '#18203E', '#4060C0'], img: '/previews/Lowangle.jpg' },
  ],
  lens: [
    { id: '24mm', label: '24mm Wide', desc: 'Broad environmental', prompt: '24mm wide lens, wide perspective, environmental depth', grad: ['#1A2A1A', '#2A4A2A', '#4A8A4A'], img: '/previews/24mmwideperspective.jpg' },
    { id: '50mm', label: '50mm Normal', desc: 'Natural eye perspective', prompt: '50mm lens, natural perspective', grad: ['#2A1A1A', '#4A2A2A', '#8A4A8A'], img: '/previews/50mmnaturalview.jpg' },
    { id: '85mm', label: '85mm Portrait', desc: 'Flattering compression', prompt: '85mm lens, portrait compression, shallow depth of field', grad: ['#1A1A2A', '#2A2A4A', '#4A4A8A'], img: '/previews/85mmportraitcompression.jpg' },
    { id: '135mm', label: '135mm Telephoto', desc: 'Subject separation', prompt: '135mm telephoto lens, strong subject isolation', grad: ['#2A1A2A', '#4A2A4A', '#8A4A8A'], img: '/previews/135mmtelephotoisolation.jpg' },
    { id: 'macro', label: 'Macro', desc: 'Extreme close detail', prompt: 'macro photography, extreme close-up, shallow depth of field, fine details', grad: ['#1A2A2A', '#2A4A4A', '#4A8A8A'], img: '/previews/Macroextremedetail.jpg' },
    { id: 'fisheye', label: 'Fisheye', desc: 'Distorted 180° view', prompt: 'fisheye lens, ultra wide distortion, curved perspective', grad: ['#2A2A1A', '#4A4A2A', '#8A8A4A'], img: '/previews/Fisheyecurveddistortion.jpg' },
  ],
  mood: [
    { id: 'serene', label: 'Serene', desc: 'Calm and peaceful', prompt: 'serene atmosphere, calm, peaceful', grad: ['#AED6F1', '#D6EAF8', '#EBF5FB'], img: '/previews/Serene.jpg' },
    { id: 'dramatic-mood', label: 'Dramatic', desc: 'Intense and powerful', prompt: 'dramatic mood, intense, powerful', grad: ['#17202A', '#922B21', '#E74C3C'], img: '/previews/Dramatic Intense.jpg' },
    { id: 'ethereal', label: 'Ethereal', desc: 'Dreamy, otherworldly', prompt: 'ethereal, dreamy, soft glow, otherworldly', grad: ['#D7BDE2', '#E8DAEF', '#FDFEFE'], img: '/previews/Ethereal.jpg' },
    { id: 'mysterious', label: 'Mysterious', desc: 'Dark and intriguing', prompt: 'mysterious atmosphere, dark, cinematic shadows', grad: ['#0B0C10', '#1F2833', '#45A29E'], img: '/previews/Mysterious.jpg' },
    { id: 'melancholic', label: 'Melancholic', desc: 'Introspective, foggy', prompt: 'melancholic mood, foggy, muted tones', grad: ['#5D6D7E', '#85929E', '#BFC9CA'], img: '/previews/Melancholic.jpg' },
    { id: 'futuristic', label: 'Futuristic', desc: 'Tech neon cyberpunk', prompt: 'futuristic, cyberpunk, advanced technology', grad: ['#00FFFF', '#FF00FF', '#0A0A2E'], img: '/previews/Futuristic.jpg' },
    { id: 'romantic', label: 'Romantic', desc: 'Soft warm tender', prompt: 'romantic mood, soft lighting, warm tones', grad: ['#FADBD8', '#F1948A', '#E74C3C'], img: '/previews/Romantic.jpg' },
    { id: 'epic', label: 'Epic', desc: 'Grand awe-inspiring', prompt: 'epic scale, grand, cinematic, awe-inspiring', grad: ['#1A1A2E', '#C0392B', '#F39C12'], img: '/previews/Epic.jpg' },
  ],
  color: [
    { id: 'vibrant', label: 'Vibrant', desc: 'Bold saturated energy', prompt: 'vibrant colors, highly saturated', grad: ['#FF0055', '#00CCFF', '#FFFF00'], img: '/previews/Vibrant.jpg' },
    { id: 'muted', label: 'Muted', desc: 'Desaturated film tones', prompt: 'muted colors, desaturated tones', grad: ['#9E9E9E', '#BDBDBD', '#757575'], img: '/previews/Muted.jpg' },
    { id: 'pastel', label: 'Pastel', desc: 'Soft dreamy palette', prompt: 'pastel colors, soft tones', grad: ['#FFCCCC', '#CCFFCC', '#CCCCFF'], img: '/previews/Pastel.jpg' },
    { id: 'monochrome', label: 'Monochrome', desc: 'Black white and grey', prompt: 'monochrome, black and white', grad: ['#000000', '#888888', '#FFFFFF'], img: '/previews/Monochrome.jpg' },
    { id: 'earth', label: 'Earth Tones', desc: 'Browns terracottas', prompt: 'earth tones, natural colors, browns and greens', grad: ['#8B4513', '#556B2F', '#D2B48C'], img: '/previews/Earthtones.jpg' },
    { id: 'neon-cyber', label: 'Neon/Cyber', desc: 'Electric on dark', prompt: 'neon cyberpunk colors, glowing accents', grad: ['#FF00FF', '#00FFFF', '#0D0D0D'], img: '/previews/Neoncyber.jpg' },
    { id: 'warm', label: 'Warm Tones', desc: 'Oranges reds golds', prompt: 'warm color palette, reds, oranges, golden hues', grad: ['#FF6B35', '#FF8C42', '#FFC857'], img: '/previews/Warm.jpg' },
    { id: 'cool', label: 'Cool Tones', desc: 'Blues cyans purples', prompt: 'cool color palette, blues, cyans, purples', grad: ['#0077B6', '#00B4D8', '#90E0EF'], img: '/previews/Cool.jpg' },
  ],
  camera_body: [
    { id: 'hasselblad', label: 'Hasselblad H6D', desc: '100MP medium format', prompt: 'shot on Hasselblad H6D-100c medium format, Carl Zeiss Otus 100mm f/2.2 lens, ISO 64, 16-bit color depth', grad: ['#1A1A2E', '#4A4A6A', '#8A8AAA'], img: '/previews/Hasselblad.jpg' },
    { id: 'phase-one', label: 'Phase One IQ4', desc: '150MP ultra detail', prompt: 'shot on Phase One IQ4 150MP, Schneider Kreuznach 80mm f/2.8 LS lens, ISO 50, extreme resolving power', grad: ['#0D0D1A', '#2D2D4A', '#6D6D8A'], img: '/previews/PhaseOne.jpg' },
    { id: 'canon-r5', label: 'Canon EOS R5', desc: '45MP full frame', prompt: 'shot on Canon EOS R5, Canon RF 85mm f/1.2L USM lens, ISO 100, dual pixel CMOS AF', grad: ['#1A0A0A', '#8B0000', '#CC3333'], img: '/previews/CanonR5.jpg' },
    { id: 'sony-a7rv', label: 'Sony A7R V', desc: '61MP full frame', prompt: 'shot on Sony A7R V, Sony FE 85mm f/1.4 GM lens, ISO 100, high dynamic range', grad: ['#0A0A1A', '#1A1A3A', '#F5A623'], img: '/previews/SonyA7RV.jpg' },
    { id: 'leica-m11', label: 'Leica M11', desc: '60MP rangefinder', prompt: 'shot on Leica M11, Leica Summilux-M 50mm f/1.4 ASPH lens, ISO 64, Leica color science', grad: ['#1A1A1A', '#CC0000', '#E8E8E8'], img: '/previews/LeicaM11.jpg' },
    { id: 'fuji-gfx', label: 'Fujifilm GFX 100S', desc: '102MP medium format', prompt: 'shot on Fujifilm GFX 100S, Fujinon GF 110mm f/2 R LM WR lens, ISO 100, Fujifilm color science', grad: ['#0A1A0A', '#1A3A1A', '#4A8A4A'], img: '/previews/FujiGFX.jpg' },
    { id: 'nikon-z9', label: 'Nikon Z9', desc: '45.7MP full frame', prompt: 'shot on Nikon Z9, Nikkor Z 85mm f/1.2 S lens, ISO 64, EXPEED 7 processing', grad: ['#1A1A0A', '#3A3A1A', '#F5D623'], img: '/previews/NikonZ9.jpg' },
  ],
};

function getShapeSVG(id: string, cat: string, item: any) {
  if (id === 'worms-eye') return <><g opacity="0.7"><line x1="85" y1="10" x2="10" y2="190" stroke="rgba(255,255,255,0.15)" strokeWidth="1" /><line x1="85" y1="10" x2="160" y2="190" stroke="rgba(255,255,255,0.15)" strokeWidth="1" /><line x1="85" y1="10" x2="85" y2="190" stroke="rgba(255,255,255,0.12)" strokeWidth="1" /></g><rect x="55" y="30" width="60" height="70" rx="4" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" /><circle cx="85" cy="10" r="4" fill="rgba(255,255,255,0.4)" /></>;
  if (id === 'dutch') return <><g transform="rotate(-20, 85, 95)" opacity="0.8"><rect x="30" y="45" width="110" height="75" rx="4" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" /></g><line x1="0" y1="30" x2="170" y2="160" stroke="rgba(255,255,255,0.25)" strokeWidth="2" /></>;
  if (id === 'birds-eye') return <g opacity="0.8"><rect x="20" y="20" width="130" height="100" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" /><rect x="35" y="35" width="40" height="30" rx="3" fill="rgba(255,255,255,0.08)" /><rect x="90" y="35" width="45" height="20" rx="3" fill="rgba(255,255,255,0.08)" /></g>;
  if (id === 'extreme-cu') return <><circle cx="85" cy="90" r="55" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" /><circle cx="85" cy="90" r="38" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" /><ellipse cx="85" cy="90" rx="22" ry="28" fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.25)" strokeWidth="1" /><circle cx="85" cy="90" r="10" fill="rgba(0,0,0,0.7)" /><ellipse cx="78" cy="82" rx="5" ry="7" fill="rgba(255,255,255,0.35)" transform="rotate(-20,78,82)" /></>;
  if (id === 'wide-shot') return <><rect x="8" y="50" width="154" height="90" rx="4" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" /><path d="M8 120 Q50 90 85 110 Q120 130 162 100 L162 140 L8 140Z" fill="rgba(255,255,255,0.06)" /><circle cx="85" cy="80" r="8" fill="rgba(255,255,255,0.15)" /></>;
  if (id === 'medium-shot') return <><rect x="45" y="30" width="80" height="110" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" /><circle cx="85" cy="62" r="18" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" /><path d="M55 110 Q70 95 85 98 Q100 101 115 110 L115 140 L55 140Z" fill="rgba(255,255,255,0.08)" /></>;
  if (id === 'close-up') return <><circle cx="85" cy="85" r="60" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" /><circle cx="85" cy="72" r="28" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" /><path d="M62 105 Q85 115 108 105" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" fill="none" /></>;
  if (id === 'low-angle') return <><line x1="85" y1="180" x2="20" y2="20" stroke="rgba(255,255,255,0.1)" strokeWidth="1" /><line x1="85" y1="180" x2="150" y2="20" stroke="rgba(255,255,255,0.1)" strokeWidth="1" /><rect x="50" y="40" width="70" height="90" rx="4" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" /><circle cx="85" cy="175" r="5" fill="rgba(255,255,255,0.4)" /></>;
  if (id === 'ethereal') return <><circle cx="85" cy="90" r="50" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" /><circle cx="85" cy="90" r="32" fill="rgba(255,255,255,0.05)" /><circle cx="85" cy="90" r="16" fill="rgba(255,255,255,0.08)" /><circle cx="85" cy="90" r="5" fill="rgba(255,255,255,0.2)" /></>;
  if (id === 'futuristic') {
    return (
      <>
        {Array.from({ length: 5 }).map((_, i) => (
          <line key={i} x1={20 + i * 30} y1="0" x2={10 + i * 35} y2="190" stroke={`rgba(0,255,255,${0.05 + i * 0.02})`} strokeWidth="1" />
        ))}
        <rect x="30" y="60" width="110" height="70" rx="4" fill="rgba(0,255,255,0.04)" stroke="rgba(0,255,255,0.2)" strokeWidth="1" />
      </>
    );
  }
  if (cat === 'color') {
    const [a, b, c] = item.grad;
    return (
      <>
        <rect x="0" y="0" width="57" height="190" fill={a} opacity="0.8" />
        <rect x="57" y="0" width="56" height="190" fill={b} opacity="0.8" />
        <rect x="113" y="0" width="57" height="190" fill={c} opacity="0.8" />
        <rect x="0" y="0" width="170" height="190" fill="rgba(0,0,0,0.3)" />
      </>
    );
  }
  if (id === 'golden') return (
    <>
      <path d="M85 20 L90 38 L108 42 L90 46 L85 64 L80 46 L62 42 L80 38Z" fill="rgba(255,200,0,0.6)" />
      <circle cx="85" cy="42" r="12" fill="rgba(255,200,0,0.3)" />
      {Array.from({ length: 8 }).map((_, i) => (
        <line key={i} x1="85" y1="42" x2={85 + 50 * Math.cos(i * Math.PI / 4)} y2={42 + 50 * Math.sin(i * Math.PI / 4)} stroke="rgba(255,180,0,0.15)" strokeWidth="1" />
      ))}
    </>
  );
  if (id === 'neon') return <><rect x="20" y="72" width="130" height="20" rx="10" fill="rgba(255,0,255,0.08)" stroke="rgba(255,0,255,0.5)" strokeWidth="1.5" /><rect x="30" y="102" width="110" height="16" rx="8" fill="rgba(0,255,255,0.08)" stroke="rgba(0,255,255,0.4)" strokeWidth="1.5" /></>;
  if (id === 'volumetric') {
    return (
      <>{Array.from({ length: 6 }).map((_, i) => (
        <line key={i} x1={40 + i * 18} y1="0" x2={25 + i * 22} y2="190" stroke={`rgba(255,250,220,${0.03 + i * 0.015})`} strokeWidth={i + 1} />
      ))}</>
    );
  }
  return <><circle cx="85" cy="85" r="35" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" /><circle cx="85" cy="85" r="18" fill="rgba(255,255,255,0.04)" /></>;
}


import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/context/theme-context";
import { useAuthModal } from "@/context/auth-modal-context";

const getModelColor = (model: string) => {
  const m = model.toLowerCase();
  if (m.includes('kling')) return '#FF6B2B'; // Orange
  if (m.includes('chatgpt')) return '#10A37F'; // OpenAI Green
  if (m.includes('flux')) return '#8B5CF6'; // Purple
  if (m.includes('nanobanana')) return '#FACC15'; // Yellow
  if (m.includes('midjourney')) return '#3B82F6'; // Blue
  return '#64748b'; // Slate default
};

const getModelLabel = (model?: string | null) => {
  if (!model) return '';
  const raw = String(model).trim();
  const m = raw.toLowerCase();
  if (m.includes('gpt-image') || m.includes('chatgpt')) return 'ChatGPT';
  if (m.includes('flux')) return 'Flux';
  if (m.includes('nanobanana pro')) return 'Nanobanana Pro';
  if (m.includes('beta') || m.includes('nanobanana 2 (beta)') || m.includes('nanobanana 2 beta')) return 'Nanobanana 2 (Beta)';
  if (m.includes('nanobanana')) return 'Nanobanana 2';
  if (m.includes('midjourney')) return 'Midjourney';
  if (m.includes('stable diffusion') || m.includes('stable-diffusion') || m === 'sd') return 'Stable Diffusion';
  if (m.includes('kling')) return 'Kling';
  if (m.includes('grok')) return 'Grok';
  return raw.replace(/[._-]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
};

export default function App() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isInitialized = useRef(false);
  const pathname = usePathname();
  const reuseId = searchParams.get('reuse');
  const sessionIdParam = searchParams.get('sessionId');
  const editIdParam = searchParams.get('editId');
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const sidebarPromptRef = useRef<HTMLTextAreaElement>(null);
  const editPromptInputRef = useRef<HTMLTextAreaElement>(null);
  // CRITICAL FIX: usePathname() can return stale/wrong values during Next.js hydration
  // (known Turbopack issue in route groups). Use window.location.pathname as ground truth.
  const realPathname = typeof window !== 'undefined' ? window.location.pathname : pathname;
  const allowReuseRoute = realPathname === '/history';
  const isStudioRoute = realPathname === '/studio';
  const isGenerateRoute = realPathname === '/generate';
  
  const { user, logout } = useAuth();
  const { openAuthModal } = useAuthModal();

  const [prompt, setPrompt] = useState('');
  const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(null);
  const [pipelineType, setPipelineType] = useState<string | null>(null);
  const [enhancedPromptExpanded, setEnhancedPromptExpanded] = useState(false);
  const [showEnhancedPrompt, setShowEnhancedPrompt] = useState(false);
  // Sync from localStorage on mount
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('genfy_show_enhanced_prompt') : null;
    if (stored === 'true') setShowEnhancedPrompt(true);
  }, []);

  useEffect(() => {
    if (enhancedPrompt) setEnhancedPromptExpanded(true);
  }, [enhancedPrompt]);



  // Helper to strip the auto-appended aspect ratio and quality suffixes from the user's input prompt in the UI
  const cleanRawPrompt = (fullPrompt: string, ratioId: string | undefined, qualityId: string | undefined) => {
    if (!fullPrompt) return '';
    let cleaned = fullPrompt.trim();
    
    // Find matching ratio prompt and quality prompt
    const r = ratioData.find(x => x.id === ratioId);
    const q = qualityData.find(x => x.id === qualityId);
    
    // Remove quality prompt if present at the end
    if (q && q.prompt && cleaned.endsWith(q.prompt)) {
      cleaned = cleaned.slice(0, -q.prompt.length).trim().replace(/,\s*$/, '');
    }
    // Remove ratio prompt if present at the end
    if (r && r.prompt && cleaned.endsWith(r.prompt)) {
      cleaned = cleaned.slice(0, -r.prompt.length).trim().replace(/,\s*$/, '');
    }
    // Second pass to handle opposite order variations
    if (q && q.prompt && cleaned.endsWith(q.prompt)) {
      cleaned = cleaned.slice(0, -q.prompt.length).trim().replace(/,\s*$/, '');
    }
    return cleaned;
  };
  const [appliedRefDescription, setAppliedRefDescription] = useState<string | null>(null);
  const { isDark, setIsDark } = useTheme();
  const [ratio, setRatio] = useState(ratioData[0]);
  const [quality, setQuality] = useState(qualityData[1]);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [numGenerations, setNumGenerations] = useState(1);
  const [qualOpen, setQualOpen] = useState(false);
  const [activeCat, setActiveCat] = useState('camera');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [expandedPrompts, setExpandedPrompts] = useState<Record<number, boolean>>({});
  const [selectedCameraBodies, setSelectedCameraBodies] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [autoEnhancing, setAutoEnhancing] = useState(false);
  const [studioView, setStudioView] = useState(true);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  useEffect(() => {
    if (uploadedFiles.length === 0) {
      setAppliedRefDescription(null);
    }
  }, [uploadedFiles]);

  useEffect(() => {
    const textarea = promptInputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
    const sbTextarea = sidebarPromptRef.current;
    if (sbTextarea) {
      sbTextarea.style.height = 'auto';
      sbTextarea.style.height = `${sbTextarea.scrollHeight}px`;
    }
  }, [prompt]);

  const [focusedImg, setFocusedImg] = useState(0);
  const formatRelativeTimeText = (dateStr?: string) => {
    if (!dateStr) return 'Just now';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return 'Yesterday';
      return `${diffDays}d ago`;
    } catch (_) {
      return 'Just now';
    }
  };
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configModalCat, setConfigModalCat] = useState('style');
  const [selectedModels, setSelectedModels] = useState<string[]>(DEFAULT_SELECTED_MODELS); // Single model by default — compare mode only when user explicitly selects 2+
  const [modelSelectOpen, setModelSelectOpen] = useState(false);
  const [chatgptModel, setChatgptModel] = useState('gpt-image-1.5');
  const [chatgptSubOpen, setChatgptSubOpen] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<number | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState<number>(1);
  const [lightboxOrigin, setLightboxOrigin] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [lbDownloadOpen, setLbDownloadOpen] = useState(false);
  useEffect(() => {
    setLbDownloadOpen(false);
  }, [lightboxImg]);

  // Keyboard navigation & zoom reset when lightbox opens/closes
  useEffect(() => {
    if (lightboxImg === null) {
      setLightboxZoom(1);
      setLightboxOrigin({ x: 50, y: 50 });
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in inputs or editable elements
      const target = e.target as HTMLElement;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setLightboxImg(prev => {
          if (prev === null) return null;
          return prev < generatedImages.length - 1 ? prev + 1 : prev;
        });
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setLightboxImg(prev => {
          if (prev === null) return null;
          return prev > 0 ? prev - 1 : prev;
        });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setLightboxImg(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImg, generatedImages.length]);
  const [lightboxHistoryOpen, setLightboxHistoryOpen] = useState(false);
  const [imageMetadata, setImageMetadata] = useState<Array<{
    prompt: string;
    ratio: string;
    quality: string;
    models: string[];
    model?: string;            // the specific model that generated this image
    status?: 'completed' | 'failed' | 'pending';
    promptHistory?: string[];
    sessionId?: string;        // groups images from the same generate click
    parentSessionId?: string;  // set when this is an edit of another session
    active_configs?: Record<string, string>;
    id?: string;
    enhanced_prompt?: string | null;  // full Claude-composed prompt sent to the model
    pipeline_type?: string | null;    // e.g. AUTHENTIC, PORTRAIT, CINEMATIC
    created_at?: string;
    createdAt?: string;
  }>>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  
  // ── INLINE TWEAK STATE ──
  const [activeFeedIndex, setActiveFeedIndex] = useState<number>(0);
  
  const isTweaking = useMemo(() => {
    if (!imageMetadata[activeFeedIndex]) return false;
    const meta = imageMetadata[activeFeedIndex];
    if (prompt !== meta.prompt) return true;
    if (ratio.id !== meta.ratio) return true;
    if (quality.id !== meta.quality) return true;
    
    const metaConfigs = meta.active_configs || {};
    const currentConfigs = { ...selections, chatgpt_model: chatgptModel };
    const metaKeys = Object.keys(metaConfigs).filter(k => metaConfigs[k]);
    const currentKeys = Object.keys(currentConfigs).filter(k => currentConfigs[k as keyof typeof currentConfigs]);
    
    if (metaKeys.length !== currentKeys.length) return true;
    for (const key of metaKeys) {
      if (metaConfigs[key] !== (currentConfigs as any)[key]) return true;
    }
    
    return false;
  }, [prompt, ratio, quality, selections, chatgptModel, imageMetadata, activeFeedIndex]);

  // Sync left panel state when active image changes or loads
  useEffect(() => {
    const meta = imageMetadata[activeFeedIndex];
    if (meta) {
      setPrompt(meta.prompt || '');
      
      const r = ratioData.find(r => r.id === meta.ratio);
      if (r) setRatio(r);
      
      const q = qualityData.find(q => q.id === meta.quality);
      if (q) setQuality(q);
      
      if (meta.active_configs) {
        const { chatgpt_model, ...rest } = meta.active_configs;
        setSelections(rest);
        if (chatgpt_model) setChatgptModel(chatgpt_model as string);
      } else {
        setSelections({});
      }
    }
  }, [activeFeedIndex]);
  // ────────────────────────

  const [pendingJobToast, setPendingJobToast] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);   // true when settings changed after prompt was written
  const [isRefiningPrompt, setIsRefiningPrompt] = useState(false); // loading state for AI prompt update // message shown when recovering a lost job
  const [promptCopied, setPromptCopied] = useState(false);
  const [studioRatioOpen, setStudioRatioOpen] = useState(false);
  const [studioQualOpen, setStudioQualOpen] = useState(false);
  const [tooltip, setTooltip] = useState<{ text: string, x: number, y: number } | null>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const TOOLTIP_HIDE_DELAY = 2000; // 2 seconds
  const [showStyleGate, setShowStyleGate] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [gridView, setGridView] = useState<'masonry' | 'grid-2' | 'grid-3'>('masonry');
  const [gridViewOpen, setGridViewOpen] = useState(false);
  const goToStudio = () => {
    // Clear all persisted session state so studio starts blank
    localStorage.removeItem('genimage_settings_v3');
    localStorage.removeItem('genimage_pending_job');
    localStorage.removeItem('genimage_last_reuse_session');
    localStorage.removeItem('genimage_auto_trigger');
    window.location.assign('/studio');
  };
  const goToHistory = () => window.location.assign('/history');

  // ── COMPARE ARENA STATE ──────────────────────────────────────────
  const [compareView, setCompareView] = useState(false);
  const [compareSessionId, setCompareSessionId] = useState<string | null>(null);
  const [compareImages, setCompareImages] = useState<CompareImageSlot[]>([]);
  const [compareOriginalPrompt, setCompareOriginalPrompt] = useState('');
  const [compareDismissed, setCompareDismissed] = useState<Set<string>>(new Set());
  const [compareSelected, setCompareSelected] = useState<string | null>(null);
  const [compareFeedbacks, setCompareFeedbacks] = useState<Record<string, string>>({});
  const [compareFeedbackOpen, setCompareFeedbackOpen] = useState<Set<string>>(new Set());
  const [compareRegenerating, setCompareRegenerating] = useState(false);
  const [compareExpanded, setCompareExpanded] = useState<Set<string>>(new Set());

  // ── VARIANT VIEW STATE ───────────────────────────────────────────
  const [variantView, setVariantView] = useState(false);
  const [variantCards, setVariantCards] = useState<VariantCard[]>([]);
  const [variantIterateOpen, setVariantIterateOpen] = useState<string | null>(null);
  const [variantIteratePrompt, setVariantIteratePrompt] = useState('');
  const [variantIterating, setVariantIterating] = useState<string | null>(null);
  // Once the user picks images from the variant view this is set to true.
  // The polling loop checks this and will NEVER re-open the variant screen
  // after the user has already dismissed it.
  const variantDismissedRef = useRef(false);
  // Set to true the first time the session fully settles — stops the poll.
  const sessionSettledRef = useRef(false);
  // Set to true while an edit placeholder is in-flight — prevents the main
  // session poller from overwriting generatedImages and wiping the placeholder.
  const editInProgressRef = useRef(false);
  // Set to true when the user explicitly clicks Generate (so we preserve old images).
  // False when navigating to a history session (so we clear and show only that session).
  const freshGenerationRef = useRef(false);



  // ── STYLE AUTOPILOT STATE ──────────────────────────────────────
  // Mode 1: Smart Bar (prompt-first AI suggestion)
  const [smartBarSuggestion, setSmartBarSuggestion] = useState<any>(null);
  const [smartBarLoading, setSmartBarLoading] = useState(false);
  const [smartBarDismissed, setSmartBarDismissed] = useState(false);
  const smartBarDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Mode 2: Inline Scoring (per-thumbnail tier badges)
  const [styleScores, setStyleScores] = useState<Record<string, number>>({});
  const [thumbScores, setThumbScores] = useState<Record<string, { score: number; tier: 'best' | 'great' | 'neutral' | 'clash' }>>({});

  // Mode 3: Style Recipes
  const [recipes, setRecipes] = useState<any[]>([]);

  // Phase 4: Vision Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [showAnalysisPrompt, setShowAnalysisPrompt] = useState(false);
  // Phase 9: Multi-Canvas Inline Editing
  const [inlinePrompts, setInlinePrompts] = useState<Record<number, string>>({});
  const [inlineGenerating, setInlineGenerating] = useState<Record<number, boolean>>({});

  // Edit Panel state
  const [editPanelImg, setEditPanelImg] = useState<number | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [cameraPopoverOpen, setCameraPopoverOpen] = useState(false);
  const [cameraInstruction, setCameraInstruction] = useState('');
  const [cameraAngles, setCameraAngles] = useState<{ rotate: number; vertical: number; zoom: number }>({ rotate: 0, vertical: 0, zoom: 5 });
  const [relightPopoverOpen, setRelightPopoverOpen] = useState(false);
  const [relightInstruction, setRelightInstruction] = useState('');
  const [skinEnhancerPopoverOpen, setSkinEnhancerPopoverOpen] = useState(false);
  const [skinEnhancerInstruction, setSkinEnhancerInstruction] = useState('');
  useEffect(() => {
    if (editPanelImg !== null) {
      document.body.classList.add('is-editing');
    } else {
      document.body.classList.remove('is-editing');
    }
    return () => {
      document.body.classList.remove('is-editing');
    };
  }, [editPanelImg]);
  useEffect(() => {
    const textarea = editPromptInputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [editPrompt]);
  const editPrefilledRef = useRef<boolean>(false);
  const [editRefFile, setEditRefFile] = useState<File | null>(null);
  const [editGenerating, setEditGenerating] = useState(false);
  // Local ratio/quality for edit panel - isolated from the global state
  const [editRatio, setEditRatio] = useState(ratioData[0]);
  const [editQuality, setEditQuality] = useState(qualityData[1]);
  const [editRatioOpen, setEditRatioOpen] = useState(false);
  const [editQualOpen, setEditQualOpen] = useState(false);
  const [editVariationsOpen, setEditVariationsOpen] = useState(false);
  const [editModelOpen, setEditModelOpen] = useState(false);
  // Local selections override for the edit panel (pre-seeded from source image metadata)
  const [editSelections, setEditSelections] = useState<Record<string, string>>({});
  const [editAdvancedOpen, setEditAdvancedOpen] = useState(false);
  const [editStyleModalOpen, setEditStyleModalOpen] = useState(false);
  const [editStyleModalCat, setEditStyleModalCat] = useState('style');
  // Vision analysis of edit ref image
  const [editRefAnalysis, setEditRefAnalysis] = useState<{
    description: string; style: string; lighting: string;
    composition: string; visual_style_prompt: string;
    _model_used?: string; _fallback_exhausted?: boolean;
  } | null>(null);
  const [editRefAnalyzing, setEditRefAnalyzing] = useState(false);
  const [acceptedRefChips, setAcceptedRefChips] = useState<Record<string, boolean>>({});
  const [includeRefDescription, setIncludeRefDescription] = useState(true);
  // Version history per image slot: map from original index -> array of image srcs (v1, v2, ...)
  const [imageVersions, setImageVersions] = useState<Record<number, string[]>>({});
  // Absolute sequential counter - never resets, so edited images get Image 03, 04... not Image 01
  const imageCounterRef = React.useRef(0);
  const [imageNumbers, setImageNumbers] = useState<string[]>([]);

  const catScrollRef = useRef<HTMLDivElement>(null);
  const carouselWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editRefInputRef = useRef<HTMLInputElement>(null);
  const comparePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isCarouselHovered, setIsCarouselHovered] = useState(false);

  // --- Storyboard Promote State ---
  const [promoteImg, setPromoteImg] = useState<number | null>(null);
  const [promoteSbs, setPromoteSbs] = useState<any[]>([]);
  const [promoteSbId, setPromoteSbId] = useState<string>("new");
  const [promoteCharName, setPromoteCharName] = useState("");
  const [promoteNewSbName, setPromoteNewSbName] = useState("");
  const [promoteLoading, setPromoteLoading] = useState(false);
  const [promoteMounted, setPromoteMounted] = useState(false);

  useEffect(() => {
    setPromoteMounted(true);
  }, []);

  useEffect(() => {
    if (promoteImg !== null) {
      api.get('/api/storyboard/list').then(r => setPromoteSbs(r.data)).catch(console.error);
    }
  }, [promoteImg]);

  const handlePromote = async () => {
    if (promoteImg === null || !promoteCharName) return;
    const src = generatedImages[promoteImg];
    if (!src) return;
    setPromoteLoading(true);
    try {
      // Convert blob URL to base64
      let b64 = src;
      if (src.startsWith('blob:') || src.startsWith('http') || src.startsWith('exports/') || src.startsWith('/exports/')) {
        const fetchUrl = src.startsWith('exports/') ? `/${src}` : src;
        const response = await fetch(fetchUrl);
        const blob = await response.blob();
        b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      let sbId = promoteSbId;
      if (sbId === "new") {
        const res = await api.post('/api/storyboard/create', { name: promoteNewSbName || "New Storyboard", description: "" });
        sbId = res.data.id;
      }
      const charRes = await api.post(`/api/storyboard/${sbId}/character/create`, { name: promoteCharName, image_b64: b64 });
      const charId = charRes.data.id;
      await api.post(`/api/storyboard/${sbId}/character/${charId}/analyze`);
      
      setPromoteImg(null);
      setPromoteCharName("");
      setPromoteNewSbName("");
      router.push('/storyboard');
    } catch (e) {
      console.error(e);
      alert("Failed to promote to storyboard");
    } finally {
      setPromoteLoading(false);
    }
  };

  const [isButtonHovered, setIsButtonHovered] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const resumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if any card is selected (for pausing carousel) - memoized
  const hasSelection = useMemo(() => {
    return !!selections[activeCat] || (activeCat === 'recipes' && recipes.some(r => r.config && Object.entries(r.config).every(([k, v]) => selections[k] === v)));
  }, [selections, activeCat, recipes]);

  // -- Stable Refs for /generate route protection --
  const generatingRef = useRef(generating);
  generatingRef.current = generating;
  // stopPollingRef: set to true by stopGeneration() to immediately break the polling loop
  const stopPollingRef = useRef(false);
  // activeSessionIdRef: tracks current session ID for backend cancellation
  const activeSessionIdRef = useRef<string | null>(null);

  const generatedImagesLengthRef = useRef(generatedImages.length);
  generatedImagesLengthRef.current = generatedImages.length;
  // generateFnRef: always holds the LATEST generate() so the auto-trigger
  // setTimeout never calls a stale closure that captured old selectedModels / prompt state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generateFnRef = useRef<(bypass?: boolean, modelsOverride?: string[]) => Promise<void>>(async () => {});
  // selectedModelsRef / promptRef / ratioRef / qualityRef: always track the latest values so generate() can
  // shadow its own closure-captured variables with fresh data at call time.
  const selectedModelsRef = useRef(selectedModels);
  selectedModelsRef.current = selectedModels;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  const numGenerationsRef = useRef(numGenerations);
  numGenerationsRef.current = numGenerations;

  // Redirect check to /studio disabled to allow direct access to generator view

  // Handle pause/resume with 1s delay
  useEffect(() => {
    // Clear any existing timeout
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
    }

    if (isCarouselHovered || isButtonHovered || hasSelection) {
      // Pause immediately
      setShouldAutoScroll(false);
    } else {
      // Resume after 1 second delay
      resumeTimeoutRef.current = setTimeout(() => {
        setShouldAutoScroll(true);
      }, 1000);
    }

    return () => {
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
    };
  }, [isCarouselHovered, isButtonHovered, hasSelection]);

  // JS Auto-Scroll & Infinite Loop - stops on hover OR when card is selected
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const autoScroll = (time: number) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      // Only scroll if shouldAutoScroll is true
      if (shouldAutoScroll && carouselWrapRef.current) {
        const wrap = carouselWrapRef.current;
        wrap.scrollLeft += deltaTime * 0.04;
        
        if (wrap.scrollLeft >= wrap.scrollWidth / 2) {
          wrap.scrollLeft -= wrap.scrollWidth / 2;
        }
        // Only re-queue when actively scrolling — avoids infinite rAF drain when paused
        animationFrameId = requestAnimationFrame(autoScroll);
      }
    };

    if (shouldAutoScroll) {
      animationFrameId = requestAnimationFrame(autoScroll);
    }
    return () => cancelAnimationFrame(animationFrameId);
  }, [shouldAutoScroll]);

  const handleCarouselScroll = () => {
    const wrap = carouselWrapRef.current;
    if (!wrap) return;
    
    if (wrap.scrollLeft <= 1) {
      wrap.scrollLeft += wrap.scrollWidth / 2;
    } else if (wrap.scrollLeft >= wrap.scrollWidth / 2 - 1) {
      wrap.scrollLeft -= wrap.scrollWidth / 2;
    }
  };
  const [manualInteract, setManualInteract] = useState(false);
  const [scrollDirection, setScrollDirection] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());
  const [sessionHistory, setSessionHistory] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (editStyleModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [editStyleModalOpen]);
  const [menuOpenSessionId, setMenuOpenSessionId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const loadedReuseSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      // Allow between 340px and 650px
      const newWidth = Math.max(340, Math.min(650, e.clientX - 280));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Keep /studio clean so it does not inherit reused history state.
  useEffect(() => {
    if (!isStudioRoute || reuseId) return;

    loadedReuseSessionRef.current = null;
    setPrompt('');
    setGeneratedImages([]);
    setImageMetadata([]);
    setImageNumbers([]);
    setFailedImages(new Set());
    setStudioView(false);
    setCompareView(false);
    setCompareSessionId(null);
    setCompareImages([]);
    setCompareDismissed(new Set());
    setCompareSelected(null);
    setCompareFeedbacks({});
    setCompareFeedbackOpen(new Set());
    setCompareRegenerating(false);
    setCompareExpanded(new Set());
    setVariantView(false);
    setVariantCards([]);
    setVariantIterateOpen(null);
    setVariantIteratePrompt('');
    setHistoryOpen(false);
  }, [isStudioRoute, reuseId]);

  // Cleanup old camera queue state
  useEffect(() => {
    import('idb-keyval').then(({ del }) => del('genimage_camera_queue')).catch(() => {});
  }, []);

  // Handle session reuse only on the history route
  useEffect(() => {
    if (!allowReuseRoute) return;
    
    if (!reuseId) {
      loadedReuseSessionRef.current = null;
      setGeneratedImages([]);
      setImageMetadata([]);
      setImageNumbers([]);
      setPrompt('');
      return;
    }
    if (loadedReuseSessionRef.current === reuseId) return;
    loadedReuseSessionRef.current = reuseId;
    
    const loadReusedSession = async () => {
      console.log('[loadReusedSession] Started loading:', reuseId);
      try {
        // Double check reset at start of load
        setGeneratedImages([]);
        setPrompt('');

        let currentId: string | null = reuseId;
        let allUrls: string[] = [];
        let allMeta: any[] = [];
        let latestSess: any = null;
        let visited = new Set();

        while (currentId && !visited.has(currentId)) {
          visited.add(currentId);
          console.log('[loadReusedSession] Fetching step:', currentId);
          const res: any = await api.get(`/api/sessions/${currentId}?_=${Date.now()}`);
          const sess = res.data.session || res.data;
          if (!sess) break;
          
          if (!latestSess) latestSess = sess;

          const imageRecords = (sess.images || []).filter((img: any) => img);
          const imageUrls = imageRecords.length > 0
            ? imageRecords.map((img: any) => img?.url || null)
            : (sess.preview_images || []);
          
          const modelList = sess.settings?.models || sess.models || [];

          if (imageUrls.length > 0) {
            const metaSource = imageRecords.length > 0 ? imageRecords : imageUrls.map((url: string) => ({ url }));
            const stepMeta = metaSource.map((img: any, idx: number) => {
              const activeConfigs = typeof sess.active_configs === 'string'
                ? JSON.parse(sess.active_configs || '{}')
                : (sess.active_configs || {});
              return {
                prompt: img.prompt || sess.prompt,
                ratio: img.ratio || sess.ratio || sess.settings?.ratio || '1:1',
                quality: img.quality || sess.quality || sess.settings?.quality || 'standard',
                active_configs: img.active_configs || activeConfigs || {},
                models: modelList,
                model: img?.model_id || modelList?.[idx] || modelList?.[0] || undefined,
                status: img.status || (img.url ? 'completed' : 'failed'),
                sessionId: sess.id || currentId,
                parentSessionId: sess.parent_session_id,
                id: img.id,
                error_msg: img.error_msg,
                url: img.url || null
              };
            });

            allUrls = [...allUrls, ...imageUrls];
            allMeta = [...allMeta, ...stepMeta];
          }

          currentId = sess.parent_session_id;
          if (allMeta.length > 100) break; // Safety cap
        }

        if (latestSess) {
          const loadedRatioId = latestSess.ratio || latestSess.settings?.ratio || '1:1';
          const loadedQualityId = latestSess.quality || latestSess.settings?.quality || 'High';
          setPrompt(cleanRawPrompt(latestSess.prompt || '', loadedRatioId, loadedQualityId));
          setEnhancedPrompt(latestSess.enhanced_prompt || null);
          setPipelineType(latestSess.pipeline_type || null);
          setFailedImages(new Set());
          
          if (latestSess.settings) {
            const sessRId = typeof latestSess.settings.ratio === 'string' ? latestSess.settings.ratio : (latestSess.settings.ratio?.id || '1:1');
            setRatio(ratioData.find(r => r.id === sessRId) || ratioData[0]);
            // Resolve quality string → full qualityData object (with .id, .prompt fields)
            const rawQuality = latestSess.settings.quality;
            const qualityId = typeof rawQuality === 'string' ? rawQuality : (rawQuality?.id || 'High');
            setQuality(qualityData.find(q => q.id === qualityId) || qualityData[1]);
          }
          
          const finalModels = latestSess.settings?.models || latestSess.models || [];
          if (Array.isArray(finalModels) && finalModels.length > 0) {
            setSelectedModels(finalModels);
          }

          if (allUrls.length > 0) {
            setGeneratedImages(allUrls);
            setImageMetadata(allMeta);
            setImageNumbers(allMeta.map((_: any, idx: number) => String(idx + 1)));
          }
          setStudioView(true);
          toast.success('Session lineage loaded');
        }
      } catch (e) {
        console.error('[reuseSession]', e);
        toast.error('Failed to load session history');
      }
    };
    loadReusedSession();
  }, [reuseId, allowReuseRoute]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('.adv-drop-wrap') && !target.closest('.studio-drop-wrap') && !target.closest('.studio-rq-panel')) {
        setRatioOpen(false);
        setQualOpen(false);
        setModelSelectOpen(false);
        setGridViewOpen(false);
        setStudioRatioOpen(false);
        setStudioQualOpen(false);
        setEditModelOpen(false);
        setEditRatioOpen(false);
        setEditQualOpen(false);
      }
      if (!(e.target as Element).closest('.lb-download-wrap')) {
        setLbDownloadOpen(false);
      }
      if (!(e.target as Element).closest('.history-item-actions') && !(e.target as Element).closest('.history-item-menu')) {
        setMenuOpenSessionId(null);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Cleanup compare poll on unmount
  useEffect(() => {
    return () => {
      if (comparePollRef.current) clearInterval(comparePollRef.current);
    };
  }, []);


  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as Element).closest('[data-tooltip]');
      if (target) {
        const rect = target.getBoundingClientRect();
        // Clear any existing timeout
        if (tooltipTimeoutRef.current) {
          clearTimeout(tooltipTimeoutRef.current);
        }
        setTooltip({
          text: target.getAttribute('data-tooltip')!,
          x: rect.left + rect.width / 2,
          y: rect.top - 8
        });
      } else {
        setTooltip(null);
        if (tooltipTimeoutRef.current) {
          clearTimeout(tooltipTimeoutRef.current);
          tooltipTimeoutRef.current = null;
        }
      }
    };
    document.addEventListener('mouseover', handleMouseOver);
    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  // Mark settings as dirty whenever ratio/quality/selections change while prompt has content
  // This enables the "Update Prompt" two-stage button flow
  useEffect(() => {
    // Don't mark dirty during initial settings restoration from localStorage
    if (!isInitialized.current) return;
    if (prompt.trim().length > 0) setSettingsDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, quality, selections]);

  // ── STYLE AUTOPILOT LOGIC ──────────────────────────────────────

  // Load style scores on mount (Mode 2)
  useEffect(() => {
    fetch('/style_scores.json')
      .then(res => res.json())
      .then(data => setStyleScores(data.pairScores || {}))
      .catch(err => console.error('Failed to load style scores', err));
  }, []);

  // Load recipes on mount (Mode 3)
  useEffect(() => {
    fetch('/style_recipes.json')
      .then(res => res.json())
      .then(data => setRecipes(data.recipes || []))
      .catch(err => console.error('Failed to load recipes', err));
  }, []);

  // Mode 1: Smart Bar — watch prompt text for AI suggestion
  useEffect(() => {
    // Fire only when: 40+ chars (meaningful prompt), fewer than 4 selections, not dismissed.
    // Higher threshold + longer debounce = fewer Gemini calls = less quota burn.
    if (prompt.trim().length < 40 || Object.keys(selections).length >= 4 || smartBarDismissed) {
      if (prompt.trim().length < 40) {
        setSmartBarSuggestion(null);
        setSmartBarDismissed(false);
      }
      setSmartBarLoading(false);
      return;
    }

    if (smartBarDebounceRef.current) clearTimeout(smartBarDebounceRef.current);
    setSmartBarLoading(true);
    smartBarDebounceRef.current = setTimeout(async () => {
      try {
        const res = await api.post("/api/suggest-from-prompt", { prompt: prompt.trim() });
        const data = res.data;
        if (data.suggested && Object.keys(data.suggested).length > 0) {
          setSmartBarSuggestion(data);
        } else {
          setSmartBarSuggestion(null);
        }
      } catch (e: any) {
        // 429 = Gemini quota exhausted, 503 = Gemini high demand — both are transient.
        // Silently hide the SmartBar rather than showing an error; suggestions are non-critical.
        const status = e?.response?.status;
        if (status === 429 || status === 503) {
          console.warn('[SmartBar] Gemini rate-limited, hiding suggestions temporarily.');
        } else {
          console.error('[SmartBar] Error:', e);
        }
        setSmartBarSuggestion(null);
      } finally {
        setSmartBarLoading(false);
      }
    }, 2500); // 2.5s debounce — user must pause before a Gemini call is made

    return () => { if (smartBarDebounceRef.current) clearTimeout(smartBarDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, smartBarDismissed]);

  // Smart Bar: Apply all suggestions
  const applySmartBar = () => {
    if (!smartBarSuggestion?.suggested) return;
    const newSels: Record<string, string> = {};
    Object.entries(smartBarSuggestion.suggested).forEach(([jsonK, labelStr]) => {
      const appK = JSON_TO_KEY[jsonK];
      if (!appK || !labelStr) return;
      const targetStr = (labelStr as string).toLowerCase();
      const id = (cats as any)[appK]?.find((i: any) => i.label.toLowerCase() === targetStr)?.id;
      // fuzzy fallback — try includes if exact match fails
      const fuzzyId = id || (cats as any)[appK]?.find((i: any) => i.label.toLowerCase().includes(targetStr))?.id;
      if (fuzzyId) newSels[appK] = fuzzyId;
    });
    setSelections(newSels);
    setSmartBarDismissed(true);
    setSmartBarSuggestion(null);
  };

  // Apply a recipe (Mode 3)
  const applyRecipe = (recipe: any) => {
    if (!recipe?.config) return;

    // Check if it's already fully applied
    const isApplied = Object.entries(recipe.config).every(([k, v]) => selections[k] === v);

    if (isApplied) {
      // Toggle OFF: Remove all keys associated with this recipe
      setSelections(prev => {
        const next = { ...prev };
        Object.keys(recipe.config).forEach(k => {
          if (next[k] === recipe.config[k]) {
            delete next[k];
          }
        });
        return next;
      });
    } else {
      // Toggle ON: Apply recipe config
      setSelections({ ...recipe.config });
      setSmartBarDismissed(true);
      setSmartBarSuggestion(null);
    }
  };


  // Mode 2: Compute per-thumbnail scores whenever selections or activeCat changes
  useEffect(() => {
    if (Object.keys(styleScores).length === 0 || Object.keys(selections).length === 0) {
      setThumbScores({});
      return;
    }

    // Get labels for all current selections
    const selectedLabels: string[] = [];
    Object.entries(selections).forEach(([catKey, itemId]) => {
      if (catKey === activeCat) return; // don't score against own category
      const label = (cats as any)[catKey]?.find((i: any) => i.id === itemId)?.label;
      if (label) selectedLabels.push(label);
    });

    if (selectedLabels.length === 0) { setThumbScores({}); return; }

    const items = (cats as any)[activeCat] || [];
    const newScores: Record<string, { score: number; tier: 'best' | 'great' | 'neutral' | 'clash' }> = {};
    let bestId = '';
    let bestScore = -1;

    items.forEach((item: any) => {
      // Average score against all selections
      let total = 0;
      let count = 0;
      selectedLabels.forEach(selLabel => {
        const key1 = `${item.label}|${selLabel}`;
        const key2 = `${selLabel}|${item.label}`;
        const score = styleScores[key1] ?? styleScores[key2] ?? 50; // default 50
        total += score;
        count++;
      });
      const avg = count > 0 ? Math.round(total / count) : 50;
      let tier: 'best' | 'great' | 'neutral' | 'clash' = 'neutral';
      if (avg >= 65) tier = 'great';
      if (avg < 40) tier = 'clash';
      newScores[item.id] = { score: avg, tier };

      if (avg > bestScore) {
        bestScore = avg;
        bestId = item.id;
      }
    });

    // Promote the highest-scoring item to 'best' if it's at least 65
    if (bestId && bestScore >= 65 && newScores[bestId]) {
      newScores[bestId].tier = 'best';
    }

    setThumbScores(newScores);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections, activeCat, styleScores]);

  // -- Session Persistence via Hybrid Storage --------------------------
  // 1. Settings state (Small data -> localStorage)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('genimage_settings_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.prompt) setPrompt(parsed.prompt);
          if (parsed.ratio) {
            const savedRId = typeof parsed.ratio === 'string' ? parsed.ratio : parsed.ratio?.id;
            const restoredR = ratioData.find(r => r.id === savedRId) || ratioData[0];
            setRatio(restoredR);
          }
        if (parsed.quality) setQuality(parsed.quality);
        if (parsed.numGenerations) setNumGenerations(parsed.numGenerations);
        if (parsed.activeCat) {
          setActiveCat(parsed.activeCat);
          setManualInteract(false);
        }
        if (parsed.selections) setSelections(parsed.selections);
        // Validate restored models: must be a non-empty array of known model names.
        // SKIP if a ?m= URL param is present — that is the ground truth set by /studio
        // and must not be overwritten by a stale localStorage value (which defaults to Nanobanana).
        const urlM = new URLSearchParams(window.location.search).get('m');
        if (!urlM && Array.isArray(parsed.selectedModels) && parsed.selectedModels.length > 0) {
          const validModels = parsed.selectedModels.filter((m: string) => AVAILABLE_MODELS.includes(m));
          if (validModels.length > 0) setSelectedModels(validModels);
        }
        if (parsed.studioView !== undefined) setStudioView(parsed.studioView);
      }
    } catch (e) {
      console.error('Failed to load settings state:', e);
    } finally {
      // Delay marking initialized until AFTER React has flushed all the state
      // updates above (setRatio, setSelections, setQuality …).
      // If we set this synchronously, the dirty-flag useEffect fires with
      // isInitialized=true and marks settings as dirty on every page load —
      // even when the user hasn't touched anything.
      setTimeout(() => { isInitialized.current = true; }, 0);
    }

    // CRITICAL: If sessionId or reuseId is in the URL, force studioView + generating state
    // This overrides any stale localStorage value and guarantees the masonry view renders
    const urlSessionId = new URLSearchParams(window.location.search).get('sessionId');
    const urlReuseId = new URLSearchParams(window.location.search).get('reuse');
    if (urlSessionId || urlReuseId) {
      console.log('[INIT] sessionId/reuseId in URL — forcing studioView=true');
      setStudioView(true);
    }

    // PRODUCTION: If the user navigated here from a history session (studio page wrote
    // this key after loadReusedSession completed), redirect to /generate?sessionId=<id>
    // so the generate page polls and shows the correct history session — not stale IndexedDB.
    // The key is consumed immediately so this redirect only happens once.
    if (!urlSessionId && !urlReuseId) {
      try {
        const lastReuseSession = localStorage.getItem('genimage_last_reuse_session');
        if (lastReuseSession) {
          localStorage.removeItem('genimage_last_reuse_session');
          console.log('[INIT] Redirecting to history session:', lastReuseSession);
          window.location.replace(`/generate?sessionId=${lastReuseSession}`);
          return; // stop further init — page is navigating
        }
      } catch (_) {}
    }
  }, []);

  // Prefill edit modal on reload after metadata arrives
  useEffect(() => {
    if (editPanelImg !== null && !editPrefilledRef.current && imageMetadata[editPanelImg!]) {
      const meta = imageMetadata[editPanelImg!];
      // Don't pre-fill editPrompt with the full styled prompt — the edit field
      // is for the user's edit instruction only (e.g. "add a sword").
      // The backend merges it with parent_session.prompt automatically.
      setEditPrompt('');
      const r = ratioData.find((x: any) => x.id === meta.ratio);
      if (r) setEditRatio(r);
      const q = qualityData.find((x: any) => x.id === meta.quality);
      if (q) setEditQuality(q);
      if (meta.active_configs) setSelections(meta.active_configs);
      editPrefilledRef.current = true;
    } else if (editPanelImg === null) {
      editPrefilledRef.current = false;
    }
  }, [editPanelImg, imageMetadata, prompt]);

  useEffect(() => {
    if (!isInitialized.current) return;
    try {
      const settingsToSave = {
        prompt, ratio, quality, activeCat, selections, selectedModels, studioView
      };
      localStorage.setItem('genimage_settings_v3', JSON.stringify(settingsToSave));
    } catch (e) {
      console.error('Failed to save settings state:', e);
    }
  }, [prompt, ratio, quality, activeCat, selections, selectedModels, studioView]);

  // 3. On mount: recover any generation that was interrupted by a reload
  useEffect(() => {
    const pendingRaw = localStorage.getItem('genimage_pending_job');
    if (!pendingRaw) return;
    try {
      const job = JSON.parse(pendingRaw);
      // Only recover jobs younger than 5 minutes
      if (Date.now() - job.timestamp > 5 * 60 * 1000) {
        localStorage.removeItem('genimage_pending_job');
        return;
      }
      setPendingJobToast('Resubmitting a generation that was interrupted by page reload...');
      // Slight delay so UI is ready
      setTimeout(() => recoverPendingJob(job), 800);
    } catch {
      localStorage.removeItem('genimage_pending_job');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recoverPendingJob = async (job: {
    fullPrompt: string; ratioId: string; qualityId: string;
    models: string[]; sessionId: string; timestamp: number;
  }) => {
    setGenerating(true);
    setStudioView(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: job.fullPrompt,
          ratio: job.ratioId,
          quality: job.qualityId,
          categories: {},
          models: job.models,
        })
      });
      const data = await res.json();
      if (data.status === 'success' && data.results && data.results.length > 0) {
        const backendSessionId = data.session_id || job.sessionId;
        const newImages = data.results.map((r: any) => r.url);
        const newNums = data.results.map(() => {
          imageCounterRef.current += 1;
          return String(imageCounterRef.current).padStart(2, '0');
        });
        setImageNumbers(prev => [...newNums, ...prev]);
        setGeneratedImages(prev => [...newImages, ...prev]);
        const meta = data.results.map((res: any) => ({
          prompt: job.fullPrompt,
          ratio: job.ratioId,
          quality: job.qualityId,
          models: job.models,
          model: res.model,
          status: res.url ? 'completed' : 'failed',
          sessionId: job.sessionId,
          id: res.id || res.image_id || res.imageId,
          error_msg: res.error
        }));
        setImageMetadata(prev => [...meta, ...prev]);
        setPendingJobToast('✓ Recovered! Image from previous session was successfully generated.');
        setTimeout(() => setPendingJobToast(null), 4000);
      }
    } catch (e) {
      console.error('[Recovery] Failed:', e);
      setPendingJobToast('Could not recover interrupted generation. Please try again.');
      setTimeout(() => setPendingJobToast(null), 4000);
    }
    localStorage.removeItem('genimage_pending_job');
    setGenerating(false);
  };

  // IndexedDB health flag — if corrupted, stop trying for this session
  const idbDisabledRef = useRef(false);

  // 2. Image data (Large data -> IndexedDB)
  useEffect(() => {
    const loadImages = async () => {
      // Skip IndexedDB restore on studio route, or when reuseId is set (history reuse has its own loader)
      // Allow restore on /generate WITHOUT a sessionId (page reloaded after generation finished)
      if (isStudioRoute || reuseId) return;
      if (isGenerateRoute && sessionIdParam) return; // actively polling — don't overwrite
      try {
        const savedImages = await get('genimage_blobs_v4');
        if (savedImages) {
          if (savedImages.generatedImages) {
            // Only restore non-null URLs (null = pending slot that never completed)
            const validImages = savedImages.generatedImages.filter((u: any) => u);
            if (validImages.length > 0) {
              setGeneratedImages(validImages);
              setStudioView(true);
            }
          }
          if (savedImages.imageNumbers) setImageNumbers(savedImages.imageNumbers);
          if (savedImages.imageVersions) setImageVersions(savedImages.imageVersions);
          if (savedImages.imageCounter !== undefined) imageCounterRef.current = savedImages.imageCounter;
          if (savedImages.imageMetadata) setImageMetadata(savedImages.imageMetadata);
          setFailedImages(new Set());
        }
      } catch (e) {
        // IndexedDB is corrupted — nuke it and disable for this session
        console.warn('[IndexedDB] Load failed, nuking corrupted store:', e);
        try { await idbDel('genimage_blobs_v4'); } catch {}
        idbDisabledRef.current = true;
      }
    };
    loadImages();
  }, [reuseId, allowReuseRoute, isGenerateRoute, sessionIdParam]);


  useEffect(() => {
    const saveImages = async () => {
      // If IndexedDB is known-broken this session, skip entirely
      if (idbDisabledRef.current) return;

      const MAX_IDB_IMAGES = 6;
      const trimmedImages = generatedImages.slice(0, MAX_IDB_IMAGES);
      const trimmedNumbers = imageNumbers.slice(0, MAX_IDB_IMAGES);
      const trimmedMeta = imageMetadata.slice(0, MAX_IDB_IMAGES);
      try {
        await idbSet('genimage_blobs_v4', {
          generatedImages: trimmedImages,
          imageNumbers: trimmedNumbers,
          imageVersions,
          imageMetadata: trimmedMeta,
          imageCounter: imageCounterRef.current
        });
      } catch {
        // First failure — nuke the corrupted DB and retry once
        try {
          await idbDel('genimage_blobs_v4');
          await idbSet('genimage_blobs_v4', {
            generatedImages: trimmedImages.slice(0, 1),
            imageNumbers: trimmedNumbers.slice(0, 1),
            imageVersions: {},
            imageMetadata: trimmedMeta.slice(0, 1),
            imageCounter: imageCounterRef.current
          });
        } catch {
          // IndexedDB is fundamentally broken — disable for this entire session
          // Images are safe in backend DB, this is just a convenience cache
          console.warn('[IndexedDB] Permanently broken, disabling for this session.');
          idbDisabledRef.current = true;
        }
      }
    };
    if (generatedImages.length > 0) saveImages();
  }, [generatedImages, imageNumbers, imageVersions, imageMetadata]);

  // -- Polling for Database-First Generation ---------------------------
  useEffect(() => {
    if (!sessionIdParam) return;

    // Save existing images so we can prepend the new generation to them
    sessionSettledRef.current = false;
    editInProgressRef.current = false;
    variantDismissedRef.current = false;
    // Only preserve existing images if this was a fresh Generate click (not a history navigation)
    if (!freshGenerationRef.current) {
      setGeneratedImages([]);
      setImageMetadata([]);
    }
    freshGenerationRef.current = false; // reset after consuming
    imageCounterRef.current = 0;
    setExpandedPrompts({}); // Collapse prompts for the new session
    
    let pollInterval: NodeJS.Timeout | null = null;
    const pollStartTime = Date.now();
    const SLOW_POLL_AFTER_MS  = 2 * 60 * 1000;  // after 2 min, slow down to 5s intervals
    const HARD_STOP_MS        = 15 * 60 * 1000; // stop polling after 15 min regardless
    let slowToastShown = false;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    const fetchSessionData = async () => {
      // Honour an explicit stop request from the user
      if (stopPollingRef.current) {
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
        return;
      }
      // If the session already settled OR an edit placeholder is active,
      // don't run — we'd only overwrite state that's now owned by the edit poller.
      if (sessionSettledRef.current || editInProgressRef.current) return;

      const elapsed = Date.now() - pollStartTime;

      // Hard stop — 15 minutes is the absolute maximum any generation should take
      if (elapsed > HARD_STOP_MS) {
        console.warn('[Polling] Hard stop after 15 minutes.');
        setGenerating(false);
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
        toast.error('Generation timed out after 15 minutes. Check History for the result.');
        return;
      }

      // After 2 minutes, show a gentle toast once so user knows it's still working
      if (elapsed > SLOW_POLL_AFTER_MS && !slowToastShown) {
        slowToastShown = true;
        toast('Still generating… some models can take a few minutes.', { duration: 6000 });
        // Slow down the poll interval to every 5s to reduce server load
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = setInterval(fetchSessionData, 5000);
        }
      }

      try {
        const res = await api.get(`/api/sessions/${sessionIdParam}?_=${Date.now()}`);
        consecutiveErrors = 0;

        // Post-await guard: another call may have settled the session or an edit
        // placeholder may have been added while this fetch was in-flight.
        if (sessionSettledRef.current || editInProgressRef.current) return;

        const data = res.data;
        
        if (data && (data.id || data.session_id || data.session)) {
          const sess = data.session || data;
          const loadedSessionId = sess.id || sess.session_id;
          setCurrentSessionId(loadedSessionId);
          activeSessionIdRef.current = loadedSessionId;
          
          const loadedRatioId = sess.ratio || sess.settings?.ratio || '1:1';
          const loadedQualityId = sess.quality || sess.settings?.quality || 'High';
          if (sess.prompt) setPrompt(cleanRawPrompt(sess.prompt, loadedRatioId, loadedQualityId));
          if (sess.enhanced_prompt) setEnhancedPrompt(sess.enhanced_prompt);
          if (sess.pipeline_type) setPipelineType(sess.pipeline_type);
          
          // Restore active configs
          const activeConfigs = typeof sess.active_configs === 'string'
            ? JSON.parse(sess.active_configs || '{}')
            : (sess.active_configs || {});
          setSelections(activeConfigs);
          
          // Determine models
          const parsedModels = Array.isArray(sess.models) ? sess.models : JSON.parse(sess.models || '[]');
          if (parsedModels.length > 0) {
            setSelectedModels(parsedModels);
          }
          
          const imageRecords: any[] = (sess.images || []).filter((img: any) => img);
          
          if (imageRecords.length > 0) {
            // NEVER forcibly mark pending as failed based on our local timer.
            // Only the backend's actual status field determines fate.
            const settledRecords = imageRecords; // use as-is from backend

            const completedRecords = settledRecords.filter((img: any) => img?.url);
            const newImages = completedRecords.map((img: any) => img.url);
            const meta = settledRecords.map((img: any) => ({
              prompt: img.prompt || sess.prompt,
              enhanced_prompt: sess.enhanced_prompt || null,
              pipeline_type: sess.pipeline_type || null,
              ratio: img.ratio || sess.ratio || sess.settings?.ratio || '1:1',
              quality: img.quality || sess.quality || sess.settings?.quality || 'standard',
              active_configs: img.active_configs || sess.active_configs || {},
              models: parsedModels,
              model: img.model_id,
              status: img.status || (img.url ? 'completed' : 'failed'),
              sessionId: img.session_id || sess.id,
              id: img.id,
              url: img.url || null,
              error_msg: img.error_msg
            }));
            
            const isMultiModel = parsedModels.length >= 2;

            // Still pending if any image is not yet settled by the backend
            const isPending = settledRecords.some((img: any) => img.status === 'pending');

            if (!isMultiModel) {
              // Single-model: show masonry progressively
              setStudioView(true);
              // Only update images if no edit is in progress (edit placeholder takes priority)
              if (completedRecords.length > 0 && !editInProgressRef.current) {
                // Prepend new images to existing ones (preserve previous generations)
                setGeneratedImages(prev => {
                  const oldImages = prev.filter(u => u && !newImages.includes(u));
                  return [...newImages, ...oldImages];
                });
                setImageMetadata(prev => {
                  const newMeta = meta.filter((_: any, i: number) => settledRecords[i]?.url);
                  const oldMeta = prev.filter((m: any) => !newImages.includes(m?.url || ''));
                  return [...newMeta, ...oldMeta];
                });
              }
              // Don't clear images if nothing completed yet — keep showing the loading state
            } else {
              // Multi-model: show completed images as they arrive so user sees progress
              if (completedRecords.length > 0) {
                setStudioView(true);
                setGeneratedImages(prev => {
                  const oldImages = prev.filter(u => u && !newImages.includes(u));
                  return [...newImages, ...oldImages];
                });
                setImageMetadata(prev => {
                  const newMeta = meta.filter((_: any, i: number) => settledRecords[i]?.url);
                  const oldMeta = prev.filter((m: any) => !newImages.includes(m?.url || ''));
                  return [...newMeta, ...oldMeta];
                });
              }
              // If nothing completed yet — keep old images visible, stay in loading state
            }
            
            // Generate numbers if missing (single-model only)
            if (!isMultiModel && completedRecords.length > 0 && imageNumbers.length !== completedRecords.length) {
              const newNums = completedRecords.map((_: any, idx: number) => {
                return String(idx + 1).padStart(2, '0');
              });
              setImageNumbers(newNums);
              imageCounterRef.current = completedRecords.length;
            }
            
            if (isPending) {
              setGenerating(true);
            } else {
              // Backend confirmed all images are settled — stop polling
              sessionSettledRef.current = true;
              setGenerating(false);
              setEditGenerating(false);
              
              if (completedRecords.length === 0) {
                const failed = settledRecords.find((img: any) => img.status === 'failed');
                if (failed) {
                  toast.error(`Generation failed: ${formatUserFriendlyError(failed.error_msg)}`);
                }
              }

              if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
              }



              // ── MULTI-MODEL: Show all variants directly in Studio Gallery (side-by-side) ──
              // We no longer use a separate variant review screen — images appear in the main
              // studio gallery under the same session card, naturally grouped side-by-side.
              setStudioView(true);
              
              // Persist to IndexedDB if healthy
              if (!idbDisabledRef.current) {
                try {
                  await idbSet('genimage_blobs_v4', {
                    generatedImages: newImages.slice(0, 6),
                    imageNumbers: completedRecords.map((_: any, i: number) => String(i + 1).padStart(2, '0')).slice(0, 6),
                    imageVersions: {},
                    imageMetadata: meta.filter((_: any, i: number) => settledRecords[i]?.url).slice(0, 6),
                    imageCounter: completedRecords.length
                  });
                } catch { /* IDB broken — ignore, useEffect handler will disable it */ }
              }
            }
          }
        }
      } catch (err: any) {
        consecutiveErrors++;
        console.warn('[Polling] Fetch error:', err, `(${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
        // Do NOT clear the interval on network errors — just count them.
        // Only stop for permanent 404 (session doesn't exist) or too many consecutive failures.
        if (err.response?.status === 404) {
          setGenerating(false);
          setEditGenerating(false);
          if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
          toast.error('Session not found. It may have been deleted.');
        } else if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error('[Polling] Too many consecutive errors, stopping poll.');
          setGenerating(false);
          if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
          toast.error('Lost connection during generation. Check History for the result.');
        }
      }
    };
    
    // Initial fetch immediately
    fetchSessionData();
    
    // Poll every 2 seconds (slows to 5s after 2 minutes automatically)
    pollInterval = setInterval(fetchSessionData, 2000);
    
    return () => { 
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  }, [sessionIdParam]);
  // ---------------------------------------------------------------------

  // Global paste and drag-drop handler
  useEffect(() => {
    // 1. Paste Handler
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItems: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) imageItems.push(file);
        }
      }
      if (imageItems.length === 0) return;
      e.preventDefault();
      setUploadedFiles(prev => [...prev, ...imageItems]);
      const file = imageItems[0];
      const reader = new FileReader();
      reader.onloadend = async () => {
        analyzeUploadedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    };

    // 2. Drag and Drop Preventer
    // Prevents the browser from navigating to the image (which causes a full reload/wipe)
    const handleDragOver = (e: DragEvent) => e.preventDefault();
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        setUploadedFiles(prev => [...prev, ...imageFiles]);
        const reader = new FileReader();
        reader.onloadend = async () => {
          analyzeUploadedImage(reader.result as string);
        };
        reader.readAsDataURL(imageFiles[0]);
      }
    };

    document.addEventListener('paste', handlePaste);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('paste', handlePaste);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  const changeRatio = (newRatio: typeof ratioData[0]) => {
    setRatio(newRatio);
    setRatioOpen(false);
  };

  const changeQuality = (newQuality: typeof qualityData[0]) => {
    setQuality(newQuality);
    setQualOpen(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setUploadedFiles(prev => [...prev, ...files]);

      // Phase 4: Trigger Vision Analysis in background for the first file
      const file = files[0];
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        analyzeUploadedImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeUploadedImage = async (base64: string) => {
    setIsAnalyzing(true);
    try {
      const catContextLines = Object.entries(cats).map(([key, list]) => {
        const title = key.charAt(0).toUpperCase() + key.slice(1);
        const options = (list as any[]).map(i => i.label).join(", ");
        return `${title}: ${options}`;
      });
      const categoriesContext = catContextLines.join("\n");

      const resp = await api.post('/api/analyze-image', {
        image_base64: base64,
        categories_context: categoriesContext
      });
      const data = resp.data;
      setAnalysis(data);

      if (studioView) {
        if (data.detailed_description || data.description) {
          const fullDesc = [data.description, data.detailed_description].filter(Boolean).join('\n\n');
          setAppliedRefDescription(fullDesc);
        }
        setSelections(prev => {
          const newSelections = { ...prev };
          const findId = (cat: string, label: string) => {
            const list = (cats as any)[cat];
            const found = list?.find((i: any) => i.label.toLowerCase().includes(label.toLowerCase()));
            return found?.id;
          };
          if (data.style) {
            const id = findId('style', data.style);
            if (id) newSelections.style = id;
          }
          if (data.lighting) {
            const id = findId('lighting', data.lighting);
            if (id) newSelections.lighting = id;
          }
          if (data.composition) {
            const id = findId('composition', data.composition);
            if (id) newSelections.composition = id;
          }
          return newSelections;
        });
        setShowAnalysisPrompt(false);
      } else {
        setShowAnalysisPrompt(true);
      }
    } catch (err) {
      console.error("Analysis Error:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const applyAnalysis = () => {
    if (!analysis) return;

    // Save description to background state instead of appending it directly to the prompt box
    if (analysis.detailed_description || analysis.description) {
      const fullDesc = [analysis.description, analysis.detailed_description].filter(Boolean).join('\n\n');
      setAppliedRefDescription(fullDesc);
    }

    // Map labels to IDs (This is simplified, in a real app you'd have a mapping table)
    const findId = (cat: string, label: string) => {
      const list = (cats as any)[cat];
      const found = list?.find((i: any) => i.label.toLowerCase().includes(label.toLowerCase()));
      return found?.id;
    };

    const newSelections = { ...selections };
    if (analysis.style) {
      const id = findId('style', analysis.style);
      if (id) newSelections.style = id;
    }
    if (analysis.lighting) {
      const id = findId('lighting', analysis.lighting);
      if (id) newSelections.lighting = id;
    }
    if (analysis.composition) {
      const id = findId('composition', analysis.composition);
      if (id) newSelections.composition = id;
    }

    setSelections(newSelections);
    setShowAnalysisPrompt(false);
  };

  const removeUploadedFile = (idx: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const toggleThumb = (catKey: string, itemId: string) => {
    // Camera Body is multi-select
    if (catKey === 'camera_body') {
      setSelectedCameraBodies(prev => {
        const isSelected = prev.includes(itemId);
        return isSelected ? prev.filter(id => id !== itemId) : [...prev, itemId];
      });
      setShowStyleGate(false);
      return;
    }
    setSelections(prev => {
      const next = { ...prev };
      if (prev[catKey] === itemId) {
        delete next[catKey];
      } else {
        next[catKey] = itemId;
        setShowStyleGate(false);
      }
      return next;
    });
  };


  const removeChip = (catKey: string) => {
    setSelections(prev => {
      const next = { ...prev };
      delete next[catKey];
      return next;
    });
  };

  const scrollCats = (dir: number) => {
    if (catScrollRef.current) {
      catScrollRef.current.scrollBy({ left: dir * 200, behavior: 'smooth' });
    }
  };

  const scrollCarousel = (dir: number) => {
    if (!carouselWrapRef.current) return;
    setManualInteract(true);
    const wrap = carouselWrapRef.current;

    wrap.scrollBy({
      left: dir * 320,
      behavior: 'smooth'
    });
  };

  // Continuous scroll when holding manual buttons
  useEffect(() => {
    if (scrollDirection === null) return;
    
    const intervalId = setInterval(() => {
      if (carouselWrapRef.current) {
        carouselWrapRef.current.scrollLeft += scrollDirection * 8;
      }
    }, 16); // ~60fps

    return () => clearInterval(intervalId);
  }, [scrollDirection]);

  // AUTO-CENTER SELECTED CARD ON TAB SWITCH
  useEffect(() => {
    const wrap = carouselWrapRef.current;
    if (!wrap) return;

    const timer = setTimeout(() => {
      if (!wrap) return;

      // Find all copies of the selected element (since it's a loop)
      let targetEls: HTMLElement[] = [];

      if (activeCat === 'recipes') {
        targetEls = Array.from(wrap.querySelectorAll('.thumb.recipe-card.selected')) as HTMLElement[];
      } else {
        const selectedId = selections[activeCat];
        if (selectedId) {
          // Find both thumb-0-id and thumb-1-id
          const el0 = document.getElementById(`thumb-0-${selectedId}`);
          const el1 = document.getElementById(`thumb-1-${selectedId}`);
          if (el0) targetEls.push(el0);
          if (el1) targetEls.push(el1);
        }
      }

      if (targetEls.length > 0) {
        const wrapWidth = wrap.clientWidth;
        const currentScroll = wrap.scrollLeft;
        const centerView = currentScroll + (wrapWidth / 2);

        // Find the copy that is closest to the current center of the view
        let bestTarget = targetEls[0];
        let minDiff = Infinity;

        targetEls.forEach(el => {
          const elCenter = el.offsetLeft + (el.offsetWidth / 2);
          const diff = Math.abs(elCenter - centerView);
          if (diff < minDiff) {
            minDiff = diff;
            bestTarget = el;
          }
        });

        // Center the best target
        const scrollAmount = bestTarget.offsetLeft - (wrapWidth / 2) + (bestTarget.offsetWidth / 2);

        wrap.scrollTo({
          left: scrollAmount,
          behavior: 'smooth'
        });
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [activeCat]);








  const autoEnhance = () => {
    setAutoEnhancing(true);
    setTimeout(() => {
      const enhancements = [', cinematic lighting, ultra detailed, 8K', ', dramatic atmosphere, volumetric fog', ', hyperrealistic, award-winning photography'];
      const pick = enhancements[Math.floor(Math.random() * enhancements.length)];
      const val = prompt.trim().replace(/, ?(cinematic|dramatic|hyperrealistic|ultra|8K|award).*$/i, '');
      setPrompt(val + pick);
      setAutoEnhancing(false);
    }, 700);
  };

  const generate = async (bypassStyleGate = false, modelsOverride?: string[]) => {
    // ── Idempotency guard: prevent double-fire on rapid clicks ──
    if (generatingRef.current) return;

    // ── Ref-shadow: always read the LATEST selectedModels and prompt via refs. ──
    // generate() is a closure — if called from a stale setTimeout or old event handler,
    // the closure-captured values may be from an earlier render (e.g. ['Nanobanana'] default).
    // Reading from refs here guarantees we always use whatever the UI currently shows.
    // modelsOverride is set by the auto-trigger when the model is encoded in the URL
    // (?m=ChatGPT) — this is the most reliable source and takes highest priority.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const selectedModels = modelsOverride ?? selectedModelsRef.current;  // URL param > ref > closure
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const prompt = promptRef.current;                  // shadows closure variable
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ratio = ratioRef.current;                    // shadows closure variable
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const quality = qualityRef.current;                // shadows closure variable

    if (!user) {
      openAuthModal('signup');
      return;
    }
    // Guard: require prompt text — but ONLY for direct user clicks (not the auto-trigger redirect
    // from /studio, which already validated the prompt before saving to localStorage and redirecting).
    // bypassStyleGate=true is always passed by the auto-trigger, so we tie the guard to that flag.
    if (!bypassStyleGate && !prompt.trim() && uploadedFiles.length === 0) {
      toast.error('Please enter a prompt before generating.');
      return;
    }
    // Style gate applies to BOTH single and compare mode —
    // if no styles selected, prompt the user first unless bypassed
    if (!bypassStyleGate && Object.keys(selections).length === 0 && !studioView) {
      setShowStyleGate(true);
      setTimeout(() => {
        document.getElementById('styleGateBanner')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return;
    }
    setShowStyleGate(false);

    setGenerating(true);
    setStudioView(true);
    let image_base64: any = undefined;

    if (isTweaking && generatedImages[activeFeedIndex]) {
      try {
        const sourceSrc = generatedImages[activeFeedIndex];
        let base64Str = '';
        if (sourceSrc.startsWith('data:image')) {
          base64Str = sourceSrc;
        } else {
          const resp = await fetch(sourceSrc);
          const blob = await resp.blob();
          base64Str = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        const isGeminiSelected = selectedModels.some(m => m.includes('Nanobanana'));
        image_base64 = isGeminiSelected ? [base64Str] : base64Str;
      } catch (e) {
        console.warn('Failed to get base64 for tweak:', e);
      }
    } else if (uploadedFiles.length > 0) {
      const isGeminiSelected = selectedModels.some(m => m.includes('Nanobanana'));
      if (isGeminiSelected) {
        const promises = uploadedFiles.map(file => {
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
        });
        image_base64 = await Promise.all(promises);
      } else {
        const file = uploadedFiles[0];
        image_base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }
    }

    const tagStrings: string[] = [];
    Object.entries(selections).forEach(([catKey, id]) => {
      const item = (cats as any)[catKey]?.find((i: any) => i.id === id);
      if (item && item.prompt) tagStrings.push(item.prompt);
    });
    if (ratio.prompt) tagStrings.push(ratio.prompt);
    if (quality.prompt) tagStrings.push(quality.prompt);

    const promptParts = [prompt.trim()];
    if (appliedRefDescription && uploadedFiles.length > 0) {
      promptParts.push(`inspired by: ${appliedRefDescription}`);
    }
    const fullPrompt = [...promptParts, ...tagStrings].filter(Boolean).join(', ');

    // Diagnostic log – visible in browser console to verify correct model is sent
    console.log('[generate] SENDING models:', JSON.stringify(selectedModels), '| modelsOverride:', JSON.stringify(modelsOverride ?? null));

    // ── API CALL (Database First) ──
    try {
      // Save full settings to localStorage so /generate can restore ratio, quality, selections on reload
      try {
        localStorage.setItem('genimage_settings_v3', JSON.stringify({
          prompt, ratio, quality, activeCat, selections, selectedModels, numGenerations: numGenerationsRef.current, studioView: true
        }));
      } catch (_) {}

      console.log('%c[API] 📤 POST /api/sessions — Creating Database Session', 'color:#60A5FA;font-weight:bold');
      const res = await api.post('/api/sessions', {
        prompt: fullPrompt,
        ratio: ratio.id,
        quality: quality.id,
        active_configs: { ...selections, chatgpt_model: chatgptModel },
        // Multi-model: send all selected models directly
        // Single model: repeat N times to get N generations of the same model
        model_ids: selectedModels.length > 1
          ? selectedModels
          : Array(numGenerationsRef.current || 1).fill(selectedModels[0] || 'Nanobanana 2'),
        image_base64,
        vision_description: (uploadedFiles.length > 0 && appliedRefDescription) ? appliedRefDescription : undefined,
        parent_session_id: undefined // Fresh prompt-bar generation: never chain previous session lineage
      });
      
      const data = res.data;
      if (data.session_id) {
        console.log(`%c[API] ✅ Session Created: ${data.session_id}`, 'color:#A78BFA;font-weight:bold');
        activeSessionIdRef.current = data.session_id;
        // Mark this as a fresh generation so the polling useEffect preserves old images
        freshGenerationRef.current = true;
        // Full page navigation to ensure fresh mount with correct localStorage state
        router.push(`/generate?sessionId=${data.session_id}`);
        return; // Page is navigating away — don't touch state
      }
    } catch (e: any) {
      console.error(`%c[API] ❌ SESSION CREATION FAILED`, 'color:#F87171;font-weight:bold', e);
      const rawDetail: string = e.response?.data?.detail || e.message || 'Total generation failure';
      
      const errorMsg = formatUserFriendlyError(rawDetail);
      toast.error(`Generation failed: ${errorMsg}`, { duration: 8000 });
      setGenerating(false);
      setFocusedImg(0);
    }
  };

  // Keep generateFnRef always pointing to the latest generate() closure.
  // This MUST be after the generate function is defined.
  generateFnRef.current = generate;

  // ── Stop Generation ────────────────────────────────────────────────────
  // Immediately halts the client-side polling and resets UI to idle state.
  // Sends cancellation to backend to immediately abort in-flight retries and free semaphores.
  const stopGeneration = async () => {
    stopPollingRef.current = true;    // polling loop checks this and self-destructs
    setGenerating(false);
    setEditGenerating(false);
    sessionSettledRef.current = true; // prevent any stale polls from re-enabling generating

    const targetSessionId = activeSessionIdRef.current || currentSessionId || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('sessionId') : null);
    if (targetSessionId) {
      try {
        console.log(`[API] 🛑 Cancelling session ${targetSessionId} on backend...`);
        await api.post(`/api/sessions/${targetSessionId}/cancel`);
      } catch (err) {
        console.error('Failed to cancel session on backend:', err);
      }
    }

    toast('Generation stopped.', { duration: 4000 });
    // Navigate back to a clean /generate URL so the polling useEffect unmounts
    router.push('/generate');
    // Reset the stop flag after a short delay so future generations work normally
    setTimeout(() => { stopPollingRef.current = false; sessionSettledRef.current = false; }, 600);
  };

  const clearSession = async () => {
    setPrompt('');
    setSelections({});
    setGeneratedImages([]);
    setImageMetadata([]);
    setImageNumbers([]);
    setFailedImages(new Set());
    setImageVersions({});
    setCurrentSessionId(null);
    setUploadedFiles([]);
    imageCounterRef.current = 0;
    // Clear IndexedDB & LocalStorage
    try {
      await idbSet('genimage_blobs_v4', null);
      localStorage.removeItem('genimage_settings_v3');
    } catch (e) {
      console.error('Failed to clear session:', e);
    }
    toast.success('New session started');
  };

  // Download a generated image — fully client-side, no backend round-trip.
  // Handles format conversion via HTMLCanvas if requested format differs from native format.
  const downloadImage = async (src: string, index: number, format: 'png' | 'tiff' | 'jpg' = 'png') => {
    try {
      let originalMime = 'image/png';
      let sourceUrl = src;

      // 1. Resolve source to an ObjectURL if it's base64
      if (src.startsWith('data:')) {
        const [header, b64] = src.split(',');
        originalMime = header.split(':')[1]?.split(';')[0] || 'image/png';
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: originalMime });
        sourceUrl = URL.createObjectURL(blob);
      } else {
        // Fetch it to get the MIME type and blob
        const response = await fetch(src);
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
        const blob = await response.blob();
        originalMime = blob.type;
        sourceUrl = URL.createObjectURL(blob);
      }

      // Determine target MIME type based on requested format
      let targetMime = 'image/png';
      if (format === 'jpg') targetMime = 'image/jpeg';
      else if (format === 'tiff') targetMime = 'image/tiff'; // Note: limited browser support for tiff encoding via canvas

      let finalDownloadUrl = sourceUrl;
      
      // 2. Transcode using Canvas if the requested format is different from the original format
      if (
        (format === 'jpg' && originalMime !== 'image/jpeg') || 
        (format === 'png' && originalMime !== 'image/png') ||
        (format === 'tiff' && originalMime !== 'image/tiff')
      ) {
        finalDownloadUrl = await new Promise<string>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Failed to get canvas context'));
            
            // Fill background with white for JPGs (since PNGs might have transparency)
            if (format === 'jpg') {
              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            
            ctx.drawImage(img, 0, 0);
            
            // Convert to target format
            let quality = undefined;
            if (format === 'jpg') quality = 1.0; // Max quality for JPG
            
            // Note: If a browser doesn't support image/tiff, it silently falls back to image/png
            canvas.toBlob((convertedBlob) => {
              if (convertedBlob) {
                resolve(URL.createObjectURL(convertedBlob));
              } else {
                reject(new Error('Canvas toBlob failed'));
              }
            }, targetMime, quality);
          };
          img.onerror = () => reject(new Error('Failed to load image for conversion'));
          img.src = sourceUrl;
        });
      }

      // 3. Trigger download
      const a = document.createElement('a');
      a.href = finalDownloadUrl;
      a.download = `genimage-${String(index + 1).padStart(2, '0')}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // 4. Cleanup
      setTimeout(() => {
        if (sourceUrl !== src) URL.revokeObjectURL(sourceUrl);
        if (finalDownloadUrl !== sourceUrl) URL.revokeObjectURL(finalDownloadUrl);
      }, 5000);
      
    } catch (e) {
      console.error('[downloadImage] Failed:', e);
      // Last-resort fallback
      const a = document.createElement('a');
      a.href = src;
      a.download = `genimage-${String(index + 1).padStart(2, '0')}.${format}`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // -- REQUEST UPSCALE ----------------------------------------------------
  const requestUpscale = async (imageId?: string, imageUrl?: string) => {
    try {
      const idToUse = imageId || '';
      const urlToUse = imageUrl || '';
      if (!idToUse && !urlToUse) {
        console.error('[Upscale] Invalid imageId and imageUrl');
        toast.error('Could not find image reference for upscaling.');
        return;
      }
      const res = await api.post('/api/upscale', {
        image_id: idToUse || undefined,
        image_url: urlToUse || undefined,
      });
      console.log('[Upscale] Success:', res.data);
      toast.success('Upscaling started! You can view it in the Upscales tab shortly.');
    } catch (e: any) {
      console.error('[Upscale] Failed:', e);
      const detail = e?.response?.data?.detail || 'Failed to start upscaling. Please try again.';
      toast.error(detail);
    }
  };

  // -- EDIT REF IMAGE VISION ANALYSIS -------------------------------------
  const analyzeEditRef = async (file: File) => {
    setEditRefAnalyzing(true);
    setEditRefAnalysis(null);
    setAcceptedRefChips({});
    setIncludeRefDescription(true);
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      // Build categories context string (same as global analyzeUploadedImage)
      const catLines = Object.entries(cats as Record<string, any[]>).map(([key, items]) =>
        `${key}: ${items.map((i: any) => i.label).join(', ')}`
      ).join('\n');
      const res = await api.post('/api/analyze-image', { image_base64: base64, categories_context: catLines });
      const data = res.data;
      setEditRefAnalysis(data);
      // Auto-accept every detected chip (user can toggle off)
      const chips: Record<string, boolean> = {};
      if (data.style) chips['style'] = true;
      if (data.lighting) chips['lighting'] = true;
      if (data.composition) chips['composition'] = true;
      setAcceptedRefChips(chips);
    } catch (e) {
      console.error('[EditRefAnalysis] Failed:', e);
      // Silent fail - analysis section just won't show chips
      setEditRefAnalysis({ description: '', style: '', lighting: '', composition: '', visual_style_prompt: '', _fallback_exhausted: true });
    } finally {
      setEditRefAnalyzing(false);
    }
  };

  // Auto-trigger analysis whenever a ref file is set in the Edit Panel
  useEffect(() => {
    if (editRefFile) {
      analyzeEditRef(editRefFile);
    } else {
      setEditRefAnalysis(null);
      setAcceptedRefChips({});
    }
  }, [editRefFile]);

  // -- BUILD FINAL EDIT PROMPT ----------------------------------------------
  const buildEditPrompt = () => {
    const parts: string[] = [];
    // Only include the user's edit instruction — NOT the original session prompt
    // or style tags. The backend's edit endpoint already merges the edit instruction
    // with parent_session.prompt, so re-adding them here would cause triple-stacking
    // of style keywords (original prompt has styles baked in, editSelections would add
    // them again, and the backend would prepend the parent prompt a third time).
    // Filter out dummy/placeholder text like "regenerate", ".", etc. if user entered it just to trigger edit
    const cleanText = editPrompt.trim().replace(/^(regenerate|\.|\,\s*)+$/i, '').trim();
    if (cleanText) parts.push(cleanText);
    if (cameraInstruction) parts.push(cameraInstruction);
    if (relightInstruction) parts.push(relightInstruction);
    if (skinEnhancerInstruction) parts.push(skinEnhancerInstruction);
    // Accepted chips from vision analysis of ref image (these are NEW style overrides
    // from a reference image, not duplicates of existing selections)
    if (editRefAnalysis && !editRefAnalysis._fallback_exhausted) {
      (['style', 'lighting', 'composition'] as const).forEach(catKey => {
        if (acceptedRefChips[catKey] && editRefAnalysis[catKey]) {
          // Try to find the matching item's prompt string from the cats data
          const matchedItem = (cats as any)[catKey]?.find(
            (i: any) => i.label === editRefAnalysis[catKey]
          );
          if (matchedItem?.prompt) parts.push(matchedItem.prompt);
          else if (editRefAnalysis[catKey]) parts.push(editRefAnalysis[catKey]);
        }
      });
      // Raw visual_style_prompt from vision
      if (editRefAnalysis.visual_style_prompt) {
        parts.push(editRefAnalysis.visual_style_prompt);
      }
      // Subject description (if checkbox is checked)
      if (includeRefDescription && editRefAnalysis.description) {
        parts.push(`inspired by: ${editRefAnalysis.description}`);
      }
    }
    return parts.filter(Boolean).join(', ');
  };

  const openEditPanel = (index: number) => {
    setEditPanelImg(index);
    setCameraInstruction('');
    setRelightInstruction('');
    setSkinEnhancerInstruction('');
    setCameraPopoverOpen(false);
    setRelightPopoverOpen(false);
    setSkinEnhancerPopoverOpen(false);
    const meta = imageMetadata[index];
    if (meta) {
      // Don't pre-fill with the full styled prompt — the edit field is for the
      // user's edit instruction only. The backend merges it with parent_session.prompt.
      setEditPrompt('');
      const r = ratioData.find((x: any) => x.id === meta.ratio);
      if (r) setEditRatio(r);
      const q = qualityData.find((x: any) => x.id === meta.quality);
      if (q) setEditQuality(q);
      // Seed editSelections from the original image's active_configs (or fall back to global selections)
      setEditSelections(meta.active_configs ? { ...meta.active_configs } : { ...selections });
      // Lock the edit model to the model that originally generated this image.
      // This ensures edits preserve the style and pipeline of the source generation.
      if (meta.model) setSelectedModels([meta.model]);
    } else {
      setEditPrompt('');
      setEditRatio(ratio);
      setEditQuality(quality);
      setEditSelections({ ...selections });
    }
    setEditRefFile(null);
    setEditRefAnalysis(null);
    setAcceptedRefChips({});
  };

  // -- GENERATE EDIT --------------------------------------------------------
  const generateEdit = async (allModels = false) => {
    if (!user) {
      openAuthModal('signup');
      return;
    }
    if (editPanelImg === null) return;
    setEditGenerating(true);

    const sourceSrc = generatedImages[editPanelImg!];
    const finalPrompt = buildEditPrompt();
    let modelsToUse = allModels 
      ? selectedModels 
      : Array(numGenerationsRef.current || 1).fill(selectedModels[0] || 'Nanobanana 2');

    // Route camera-angle edit requests specifically to Nanobanana 2
    if (cameraInstruction) {
      modelsToUse = modelsToUse.map(m => m.includes('Nanobanana') ? 'Nanobanana 2' : m);
      if (!modelsToUse.some(m => m.includes('Nanobanana 2'))) {
        modelsToUse = ['Nanobanana 2'];
      }
    }
    const editRatioId = editRatio.id;
    const editQualityId = editQuality.id;
    const sourceMeta = imageMetadata[editPanelImg!];

    console.log('[Edit] Final prompt:', finalPrompt);
    console.log('[Edit] sourceMeta:', sourceMeta);

    // Helper: fetch a URL and convert to base64 string (data URI prefix stripped)
    const urlToBase64 = async (url: string): Promise<string | null> => {
      try {
        if (url.startsWith('data:image')) {
          return url.split(',')[1];
        }
        const resp = await fetch(url);
        const blob = await resp.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn('[Edit] Failed to convert URL to base64:', e);
        return null;
      }
    };

    try {
      // Convert source image URL -> base64 for the edit API
      let sourceBase64: string | null = null;
      if (sourceSrc) {
        sourceBase64 = await urlToBase64(sourceSrc);
      }

      // Prefer async database-first pipeline if we have session + image tracking
      if (sourceMeta?.sessionId && sourceMeta?.id) {
        // Construct string-value overrides for the backend from accepted vision chips and editSelections
        const configOverrides: Record<string, string> = { ...editSelections };
        if (acceptedRefChips && Object.keys(acceptedRefChips).length > 0) {
          Object.entries(acceptedRefChips).forEach(([catKey, isAccepted]) => {
            if (isAccepted && editRefAnalysis && (editRefAnalysis as any)[catKey]) {
              const val = (editRefAnalysis as any)[catKey];
              const item = (cats as any)[catKey]?.find((i: any) => i.label === val);
              configOverrides[catKey] = item ? item.id : val;
            }
          });
        }

        // Fully reconstructed prompt with new styles for override
        const overrideTagStrings: string[] = [];
        Object.entries(configOverrides).forEach(([catKey, id]) => {
          const item = (cats as any)[catKey]?.find((i: any) => i.id === id);
          if (item?.prompt) overrideTagStrings.push(item.prompt);
        });
        if (editRatio.prompt) overrideTagStrings.push(editRatio.prompt);
        if (editQuality.prompt) overrideTagStrings.push(editQuality.prompt);

        const overrideParts = [prompt.trim(), editPrompt.trim(), ...overrideTagStrings];
        if (appliedRefDescription) {
          overrideParts.push(`inspired by: ${appliedRefDescription}`);
        }
        if (editRefAnalysis && !editRefAnalysis._fallback_exhausted) {
          if (includeRefDescription && editRefAnalysis.description) {
            overrideParts.push(`inspired by: ${editRefAnalysis.description}`);
          }
        }

        const isGeminiSelected = modelsToUse.some(m => m.includes('Nanobanana'));
        let finalImageBase64: any = sourceBase64;
        if (isGeminiSelected && editRefFile) {
          const refBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(editRefFile);
          });
          finalImageBase64 = [sourceBase64 || '', refBase64];
        }

        // Only send full_prompt_override for pure style/ratio/quality changes (no edit instruction).
        // When the user has typed an edit instruction, sending full_prompt_override buries the
        // edit inside a 500-word style-tag soup — the model ignores the instruction and
        // reproduces the original image. The backend's EDIT-FIX path handles it correctly
        // using just the raw instruction + the source image in base64.
        // Treat any popover-set instruction (relight, camera, skin enhancer) as an edit
        // instruction — ensures the EDIT-FIX backend path is triggered even when the user
        // only used a popover without typing anything in the textarea.
        const hasEditInstruction = editPrompt.trim().length > 0 || !!relightInstruction || !!cameraInstruction || !!skinEnhancerInstruction;
        const fullPromptOverride = hasEditInstruction
          ? null  // let backend use clean EDIT-FIX path
          : overrideParts.filter(Boolean).join(', '); // pure style change only

        const payload = {
          edit_prompt: finalPrompt,
          full_prompt_override: fullPromptOverride,
          reference_image_id: null,
          config_overrides: Object.keys(configOverrides).length > 0 ? configOverrides : null,
          image_base64: finalImageBase64,
          ratio: editRatioId,
          quality: editQualityId,
          model_ids: modelsToUse
        };
        console.log('[Edit] POSTing to:', `/api/sessions/${sourceMeta.sessionId}/images/${sourceMeta.id}/edit`);
        const res = await api.post(`/api/sessions/${sourceMeta.sessionId}/images/${sourceMeta.id}/edit`, payload);
        console.log('[Edit] API response:', res.data);
        const childSessionId = res.data?.child_session_id || res.data?.session_id;
        if (childSessionId) {
          activeSessionIdRef.current = childSessionId;
          // Stable slot IDs — survives array prepends/appends from concurrent generates
          const slotIds = modelsToUse.map((m, i) => `edit-slot-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`);

          // Close panel immediately and reset edit state
          setEditPanelImg(null);
          setEditPrompt('');
          setCameraInstruction('');
          setRelightInstruction('');
          setSkinEnhancerInstruction('');
          setCameraPopoverOpen(false);
          setRelightPopoverOpen(false);
          setSkinEnhancerPopoverOpen(false);
          setEditRefFile(null);
          setEditRefAnalysis(null);
          setAcceptedRefChips({});
          setEditGenerating(false);

          // Mark that an edit placeholder is now live — tells main session poller to stay out
          editInProgressRef.current = true;

          const newNums: string[] = [];
          const newImgs: string[] = [];
          const newMetas: any[] = [];
          
          modelsToUse.forEach((m, i) => {
            imageCounterRef.current += 1;
            newNums.unshift(String(imageCounterRef.current).padStart(2, '0'));
            newImgs.unshift('');
            newMetas.unshift({
              prompt: finalPrompt,
              ratio: editRatioId,
              quality: editQualityId,
              models: [m],
              status: 'pending' as const,
              sessionId: childSessionId,
              parentSessionId: sourceMeta.sessionId,
              _slotId: slotIds[i],
            } as any);
          });
          
          setImageNumbers(prev => [...newNums, ...prev]);
          setGeneratedImages(prev => [...newImgs, ...prev]);
          setImageMetadata(prev => [...newMetas, ...prev]);

          // Helper: find the slot index using slotId in a current metadata snapshot
          // imageMetadata and generatedImages share the same indices at all times
          let consecutiveErrors = 0;
          const MAX_ERRORS = 4;
          const pollStart = Date.now();
          const MAX_DURATION = 5 * 60 * 1000; // 5 min

          const updateSlot = (sId: string, url: string, status: 'completed' | 'failed', extraMeta?: any) => {
            let processed = false;
            setImageMetadata(prev => {
              const idx = (prev as any[]).findIndex((m: any) => m?._slotId === sId);
              if (idx === -1) return prev;
              const n = [...prev];
              (n[idx] as any) = { ...n[idx], status, ...extraMeta };
              // Update the image URL at the same index, ensuring it only runs once per conceptual update
              if (url && !processed) {
                processed = true;
                setGeneratedImages(imgs => {
                  const updated = [...imgs];
                  if (idx < updated.length) updated[idx] = url;
                  return updated;
                });
              }
              return n;
            });
          };

          const removeSlot = (sId: string) => {
            let processed = false;
            setImageMetadata(prev => {
              const idx = (prev as any[]).findIndex((m: any) => m?._slotId === sId);
              if (idx === -1) return prev;
              
              if (!processed) {
                processed = true;
                setGeneratedImages(imgs => { const u = [...imgs]; u.splice(idx, 1); return u; });
                setImageNumbers(nums => { const u = [...nums]; u.splice(idx, 1); return u; });
              }
              
              const n = [...prev];
              n.splice(idx, 1);
              return n;
            });
          };

          let pendingSlots = [...slotIds];

          const poll = setInterval(async () => {
            if (Date.now() - pollStart > MAX_DURATION) {
              clearInterval(poll);
              editInProgressRef.current = false;
              pendingSlots.forEach(s => updateSlot(s, '', 'failed'));
              toast.error('Edit timed out after 5 minutes. Check History for the result.');
              return;
            }
            try {
              const r = await api.get(`/api/sessions/${childSessionId}`);
              consecutiveErrors = 0;
              const sess = r.data?.session || r.data;
              const allImgs: any[] = sess?.images || [];
              const imgs = allImgs.filter((i: any) => i.session_id === childSessionId);
              
              imgs.forEach((img, index) => {
                if (index < slotIds.length) {
                  const sId = slotIds[index];
                  if (pendingSlots.includes(sId)) {
                    if (img.status === 'completed' && img.url) {
                      updateSlot(sId, img.url, 'completed', { id: img.id, model: img.model_id });
                      pendingSlots = pendingSlots.filter(s => s !== sId);
                    } else if (img.status === 'failed') {
                      updateSlot(sId, '', 'failed', { id: img.id, model: img.model_id });
                      pendingSlots = pendingSlots.filter(s => s !== sId);
                    }
                  }
                }
              });

              if (pendingSlots.length === 0) {
                clearInterval(poll);
                editInProgressRef.current = false;
              }
            } catch (pollErr) {
              consecutiveErrors++;
              console.warn('[Edit] Poll error:', pollErr);
              if (consecutiveErrors >= MAX_ERRORS) {
                clearInterval(poll);
                editInProgressRef.current = false;
                pendingSlots.forEach(sId => updateSlot(sId, '', 'failed'));
                toast.error('Connection lost during edit. Check History for the result.');
              }
            }
          }, 2500);
          return;
        }
      }

      // Fallback: synchronous /api/generate (for images without DB session tracking)
      console.log('[Edit] Falling back to synchronous /api/generate');
      const res = await api.post('/api/generate', {
        prompt: finalPrompt,
        ratio: editRatioId,
        quality: editQualityId,
        categories: editSelections,
        models: modelsToUse,
        image_base64: sourceBase64,
        chatgpt_model: chatgptModel
      });
      const data = res.data;

      if (data.status === 'success' && data.results && data.results.length > 0) {
        const newImages: string[] = data.results.map((r: any) => r.url);
        const newNums = data.results.map(() => {
          imageCounterRef.current += 1;
          return String(imageCounterRef.current).padStart(2, '0');
        });
        const prevHistory: string[] = [
          ...(sourceMeta?.prompt ? [sourceMeta.prompt] : []),
          ...(sourceMeta?.promptHistory ?? [])
        ];
        const editMeta = data.results.map((r: any) => ({
          prompt: finalPrompt,
          ratio: editRatioId,
          quality: editQualityId,
          models: modelsToUse,
          model: r.model,
          status: r.url ? 'completed' : 'failed',
          promptHistory: prevHistory,
          sessionId: data.session_id || `session_${Date.now()}`,
          parentSessionId: sourceMeta?.sessionId,
          id: r.id || r.image_id || r.imageId,
        }));
        setImageNumbers(prev => [...newNums, ...prev]);
        setGeneratedImages(prev => [...newImages, ...prev]);
        setImageMetadata(prev => [...editMeta, ...prev]);
        setEditPanelImg(null);
        setEditPrompt('');
        setCameraInstruction('');
        setRelightInstruction('');
        setSkinEnhancerInstruction('');
        setCameraPopoverOpen(false);
        setRelightPopoverOpen(false);
        setSkinEnhancerPopoverOpen(false);
        setEditRefFile(null);
        setEditRefAnalysis(null);
        setAcceptedRefChips({});
        setFocusedImg(0);
      }
    } catch (e: any) {
      console.error('[Edit] Error:', e);
      toast.error(`Edit failed: ${e.message}`);
    }
    setEditGenerating(false);
  };

  const generateInlineEdit = async (index: number) => {
    if (!user) {
      openAuthModal('signup');
      return;
    }
    setInlineGenerating(prev => ({ ...prev, [index]: true }));

    const textRefinement = inlinePrompts[index]?.trim();
    if (!textRefinement) {
      toast.error('Please enter an edit prompt');
      setInlineGenerating(prev => ({ ...prev, [index]: false }));
      return;
    }

    const sourceSrc = generatedImages[index];
    const sourceMeta = imageMetadata[index];

    // Send ONLY the raw user instruction as edit_prompt — NOT the full prompt + style tags.
    // The backend has the original prompt via prompt_history + parent session DB record.
    // Baking the full concatenated string into edit_prompt corrupts the EDIT-FIX path,
    // which wraps the entire string as the "instruction", making it unreadable to the model.
    // Style selections are forwarded separately via config_overrides.
    const rawInstruction = textRefinement; // just what the user typed

    // Helper: fetch a URL and convert to base64 string (data URI prefix stripped)
    const urlToBase64 = async (url: string): Promise<string | null> => {
      try {
        if (url.startsWith('data:image')) {
          return url.split(',')[1];
        }
        const resp = await fetch(url);
        const blob = await resp.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn('[InlineEdit] Failed to convert URL to base64:', e);
        return null;
      }
    };

    try {
      // Convert source image URL -> base64 for both pathways
      let sourceBase64: string | null = null;
      if (sourceSrc) {
        sourceBase64 = await urlToBase64(sourceSrc);
      }

      if (sourceMeta?.sessionId && sourceMeta?.id) {

        const payload = {
          edit_prompt: rawInstruction,   // raw user instruction only — backend merges with history
          reference_image_id: null,
          config_overrides: selections,  // style tags forwarded separately
          image_base64: sourceBase64,
          ratio: ratio.id,
          quality: quality.id
        };
        console.log('[InlineEdit] edit_prompt (raw):', rawInstruction);
        console.log('[InlineEdit] POSTing to:', `/api/sessions/${sourceMeta.sessionId}/images/${sourceMeta.id}/edit`);
        const res = await api.post(`/api/sessions/${sourceMeta.sessionId}/images/${sourceMeta.id}/edit`, payload);
        console.log('[InlineEdit] API response:', res.data);
        const childSessionId = res.data?.child_session_id || res.data?.session_id;
        if (childSessionId) {
          // Clear the inline prompt input
          setInlinePrompts(prev => { const n = { ...prev }; delete n[index]; return n; });
          setInlineGenerating(prev => ({ ...prev, [index]: false }));

          // Stable slot ID — survives array prepends/appends from concurrent generates
          const slotId = `inline-edit-slot-${Date.now()}-${Math.random().toString(36).slice(2)}`;

          // Mark that an edit placeholder is now live — tells main session poller to stay out
          editInProgressRef.current = true;

          // Prepend a pending placeholder tagged with slotId
          imageCounterRef.current += 1;
          const num = String(imageCounterRef.current).padStart(2, '0');
          setImageNumbers(prev => [num, ...prev]);
          setGeneratedImages(prev => ['', ...prev]);
          setImageMetadata(prev => [{
            prompt: rawInstruction,
            ratio: ratio.id,
            quality: quality.id,
            models: selectedModels,
            status: 'pending' as const,
            sessionId: childSessionId,
            parentSessionId: sourceMeta.sessionId,
            _slotId: slotId,
          } as any, ...prev]);

          // Poll child session for the result
          let consecutiveErrors = 0;
          const MAX_ERRORS = 4;
          const pollStart = Date.now();
          const MAX_DURATION = 5 * 60 * 1000; // 5 min

          const updateSlot = (url: string, status: 'completed' | 'failed', extraMeta?: any) => {
            let processed = false;
            setImageMetadata(prev => {
              const idx = (prev as any[]).findIndex((m: any) => m?._slotId === slotId);
              if (idx === -1) return prev;
              const n = [...prev];
              (n[idx] as any) = { ...n[idx], status, ...extraMeta };
              if (url && !processed) {
                processed = true;
                setGeneratedImages(imgs => {
                  const updated = [...imgs];
                  if (idx < updated.length) updated[idx] = url;
                  return updated;
                });
              }
              return n;
            });
          };

          const removeSlot = () => {
            let processed = false;
            setImageMetadata(prev => {
              const idx = (prev as any[]).findIndex((m: any) => m?._slotId === slotId);
              if (idx === -1) return prev;
              
              if (!processed) {
                processed = true;
                setGeneratedImages(imgs => { const u = [...imgs]; u.splice(idx, 1); return u; });
                setImageNumbers(nums => { const u = [...nums]; u.splice(idx, 1); return u; });
              }
              
              const n = [...prev];
              n.splice(idx, 1);
              return n;
            });
          };

          const poll = setInterval(async () => {
            if (Date.now() - pollStart > MAX_DURATION) {
              clearInterval(poll);
              editInProgressRef.current = false;
              updateSlot('', 'failed');
              toast.error('Edit timed out after 5 minutes. Check History for the result.');
              return;
            }
            try {
              const r = await api.get(`/api/sessions/${childSessionId}`);
              consecutiveErrors = 0;
              // CRITICAL: Filter to ONLY the child session's own images
              const sess = r.data?.session || r.data;
              const allImgs: any[] = sess?.images || [];
              const imgs = allImgs.filter((i: any) => i.session_id === childSessionId);
              const done = imgs.find((i: any) => i.status === 'completed' && i.url);
              const allFailed = imgs.length > 0 && imgs.every((i: any) => i.status === 'failed');

              if (done) {
                clearInterval(poll);
                editInProgressRef.current = false;
                updateSlot(done.url, 'completed', { id: done.id });
              } else if (allFailed) {
                clearInterval(poll);
                editInProgressRef.current = false;
                removeSlot();
                toast.error('Edit generation failed. Please try again.');
              }
            } catch (pollErr) {
              consecutiveErrors++;
              console.warn('[InlineEdit] Poll error:', pollErr);
              if (consecutiveErrors >= MAX_ERRORS) {
                clearInterval(poll);
                editInProgressRef.current = false;
                updateSlot('', 'failed');
                toast.error('Connection lost during edit. Check History for the result.');
              }
            }
          }, 2500);
          return;
        }
      }

      // Fallback: synchronous /api/generate
      console.log('[InlineEdit] Falling back to synchronous /api/generate');
      const res = await api.post('/api/generate', {
        prompt: rawInstruction,
        ratio: ratio.id,
        quality: quality.id,
        categories: selections,
        models: selectedModels,
        image_base64: sourceBase64,
        chatgpt_model: chatgptModel,
        session_id: currentSessionId
      });
      const data = res.data;

      if (data.status === 'success' && data.results && data.results.length > 0) {
        const newImages = data.results.map((r: any) => r.url);
        const newNums = data.results.map(() => {
          imageCounterRef.current += 1;
          return String(imageCounterRef.current).padStart(2, '0');
        });
        setImageNumbers(prev => [...newNums, ...prev]);
        setGeneratedImages(prev => [...newImages, ...prev]);
        const inlineMeta = data.results.map((res: any) => ({
          prompt: rawInstruction,
          ratio: ratio.id,
          quality: quality.id,
          models: selectedModels,
          model: res.model,
          status: res.url ? 'completed' : 'failed',
          sessionId: data.session_id || currentSessionId,
          id: res.id || res.image_id || res.imageId,
          error_msg: res.error
        }));
        setImageMetadata(prev => [...inlineMeta, ...prev]);
        setInlinePrompts(prev => { const n = { ...prev }; delete n[index]; return n; });
        if (!currentSessionId && data.session_id) {
          setCurrentSessionId(data.session_id);
        }
        setFocusedImg(0);
      }
    } catch (e: any) {
      console.error('[InlineEdit]', e);
      toast.error(`Edit failed: ${e.message}`);
    }
    setInlineGenerating(prev => ({ ...prev, [index]: false }));
  };


  // -- COMPARE ARENA FUNCTIONS --------------------------------------------------

  const clearComparePoll = () => {
    if (comparePollRef.current) { clearInterval(comparePollRef.current); comparePollRef.current = null; }
  };

  const startComparePoll = (sessionId: string) => {
    clearComparePoll();
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/api/compare/${sessionId}`);
        const data = res.data;
        setCompareImages(data.images);
        if (data.images.every((img: CompareImageSlot) => img.status !== 'pending')) clearComparePoll();
      } catch (e) { console.error('[comparePoll]', e); }
    }, 2000);
    comparePollRef.current = interval;
  };

  const compareGenerate = async () => {
    if (!user) {
      openAuthModal('signup');
      return;
    }
    // Compare mode always proceeds — no style gate (user is exploring, not confirming)
    setShowStyleGate(false);
    setGenerating(true);
    let image_base64: any = undefined;
    if (uploadedFiles.length > 0) {
      const file = uploadedFiles[0];
      image_base64 = await new Promise((resolve) => { const r = new FileReader(); r.onloadend = () => resolve(r.result); r.readAsDataURL(file); });
    }
    const tagStrings: string[] = [];
    Object.entries(selections).forEach(([catKey, id]) => {
      const item = (cats as any)[catKey]?.find((i: any) => i.id === id);
      if (item?.prompt) tagStrings.push(item.prompt);
    });
    if (ratio.prompt) tagStrings.push(ratio.prompt);
    if (quality.prompt) tagStrings.push(quality.prompt);
    const fullPrompt = [prompt.trim(), ...tagStrings].filter(Boolean).join(', ');
    try {
      const res = await api.post('/api/compare/start', {
        prompt: fullPrompt,
        models: selectedModels,
        ratio: ratio.id,
        quality: quality.id,
        categories: selections,
        image_base64,
        chatgpt_model: chatgptModel,
        session_id: currentSessionId
      });
      const data = res.data;
      setCompareSessionId(data.compare_session_id);
      if (!currentSessionId && data.compare_session_id) {
        setCurrentSessionId(data.compare_session_id);
      }
      setCompareImages(data.images);
      setCompareOriginalPrompt(fullPrompt);
      setCompareDismissed(new Set()); setCompareSelected(null);
      setCompareFeedbacks({}); setCompareFeedbackOpen(new Set());
      setCompareView(true); setStudioView(false);
      startComparePoll(data.compare_session_id);
    } catch (e: any) {
      console.error('[compareGenerate]', e);
      toast.error(`Compare generation failed: ${e.message || 'Unknown error'}`);
    }
    setGenerating(false);
  };

  const compareRunFeedback = async () => {
    if (!compareSessionId) return;
    const fbs: Record<string, string> = {};
    Object.entries(compareFeedbacks).forEach(([m, t]) => { if (t.trim() && !compareDismissed.has(m)) fbs[m] = t.trim(); });
    if (!Object.keys(fbs).length) return;
    setCompareRegenerating(true);
    try {
      const res = await api.post(`/api/compare/${compareSessionId}/feedback`, {
        feedbacks: fbs,
        ratio: ratio.id,
        quality: quality.id
      });
      const data = res.data;
      setCompareImages(prev => [...prev, ...data.new_images]);
      setCompareFeedbacks(prev => { const n = { ...prev }; Object.keys(fbs).forEach(m => delete n[m]); return n; });
      setCompareFeedbackOpen(prev => { const n = new Set(prev); Object.keys(fbs).forEach(m => n.delete(m)); return n; });
      startComparePoll(compareSessionId);
    } catch (e) { console.error('[compareRunFeedback]', e); }
    setCompareRegenerating(false);
  };

  const compareFinalizeSelection = (modelId: string) => {
    const candidates = compareImages.filter(
      img => img.model_id === modelId && img.status === 'completed' && img.url
    );
    if (!candidates.length) return;
    const slot2 = candidates.reduce((a, b) => (b.iteration > a.iteration ? b : a));
    if (!slot2.url) return;
    imageCounterRef.current += 1;
    const num = String(imageCounterRef.current).padStart(2, '0');
    const sessionId = `compare_${compareSessionId}_${modelId}`;
    setImageNumbers(prev => [num, ...prev]);
    setGeneratedImages(prev => [slot2.url as string, ...prev]);
    setImageMetadata(prev => [{
      prompt: slot2.tailored_prompt,
      ratio: ratio.id,
      quality: quality.id,
      models: [modelId],
      model: modelId,
      sessionId,
      id: slot2.id,
      status: 'completed' as const,
      promptHistory: [compareOriginalPrompt]
    }, ...prev]);
    clearComparePoll();
    setCompareView(false); setStudioView(true);
    setCompareSessionId(null); setCompareImages([]);
    setCompareDismissed(new Set()); setCompareSelected(null);
    setCompareFeedbacks({}); setCompareFeedbackOpen(new Set());
    setFocusedImg(0);
  };

  // ── VARIANT VIEW FUNCTIONS ────────────────────────────────────────

  const variantIterate = async (modelId: string) => {
    const card = variantCards.find(v => v.modelId === modelId);
    if (!card || !variantIteratePrompt.trim()) return;
    setVariantIterating(modelId);
    try {
      // Use the card's current image as reference
      let refB64: string | undefined;
      const imgUrl = card.imageUrl;
      if (imgUrl.startsWith('data:')) {
        refB64 = imgUrl;
      } else {
        try {
          const resp = await fetch(imgUrl);
          const blob = await resp.blob();
          refB64 = await new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch { refB64 = undefined; }
      }

      const res = await api.post('/api/sessions', {
        prompt: variantIteratePrompt.trim(),
        model_ids: [modelId],
        image_base64: refB64,
        ratio: ratio.id,
        quality: quality.id,
        active_configs: { ...selections, chatgpt_model: chatgptModel },
        parent_session_id: card.sessionId
      });
      const newSessionId = res.data.session_id;
      if (!newSessionId) throw new Error('No session_id returned');

      // Poll until complete
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const pollRes = await api.get(`/api/sessions/${newSessionId}`);
          const pollImgs = (pollRes.data.images || []).filter((img: any) => img);
          const done = pollImgs.find((img: any) => img.status === 'completed' && img.url);
          if (done) {
            setVariantCards(prev => prev.map(v =>
              v.modelId !== modelId ? v : {
                ...v,
                imageUrl: done.url,
                sessionId: newSessionId,
                imageId: done.id,
                iterations: [...v.iterations, done.url]
              }
            ));
            setVariantIterateOpen(null);
            setVariantIteratePrompt('');
            break;
          }
          if (pollImgs.length > 0 && pollImgs.every((img: any) => img.status === 'failed')) {
            toast.error(`Iterate failed for ${modelId}`);
            break;
          }
        } catch { /* continue polling */ }
      }
    } catch (e: any) {
      toast.error(`Iterate failed: ${e.message}`);
    }
    setVariantIterating(null);
  };

  const useVariantImages = (modelIds: string[]) => {
    const selected = variantCards.filter(v => modelIds.includes(v.modelId));
    if (!selected.length) return;
    // Mark dismissed FIRST — prevents the poll (if somehow still alive) from
    // re-opening the variant screen after the user has already picked images.
    variantDismissedRef.current = true;
    const urls = selected.map(v => v.imageUrl);
    const meta = selected.map(v => ({
      prompt: v.prompt,
      ratio: ratio.id,
      quality: quality.id,
      models: [v.modelId],
      model: v.modelId,
      sessionId: v.sessionId,
      id: v.imageId,
      status: 'completed' as const
    }));
    const startIdx = imageCounterRef.current;
    imageCounterRef.current += urls.length;
    const nums = urls.map((_, i) => String(startIdx + i + 1).padStart(2, '0'));
    setGeneratedImages(prev => [...urls, ...prev]);
    setImageMetadata(prev => [...meta, ...prev]);
    setImageNumbers(prev => [...nums, ...prev]);
    setVariantView(false);
    setVariantCards([]);
    setVariantIterateOpen(null);
    setVariantIteratePrompt('');
    setStudioView(true);
    setFocusedImg(0);
  };

  const handleNewChat = () => {
    setPrompt('');
    setSelections({});
    if (generatedImages.length > 0) {
      setCurrentSessionId(null);
    }
    setGeneratedImages([]);
    setImageNumbers([]);
    setImageMetadata([]);
    setFailedImages(new Set());
    setImageVersions({});
    setStudioView(false);
    setHistoryOpen(false);
    imageCounterRef.current = 0;
  };

  const fetchHistory = async () => {
    try {
      const res = await api.get('/api/sessions');
      setSessionHistory(res.data.sessions || []);
    } catch (e) {
      console.error('[fetchHistory]', e);
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      await api.delete(`/api/sessions/${sessionId}`).catch(() => {
        console.warn('API delete not supported yet, removing locally');
      });
      setSessionHistory(prev => prev.filter(s => s.id !== sessionId));
      toast.success('Session deleted');
    } catch (e) {
      console.error('Failed to delete session:', e);
      toast.error('Failed to delete session');
    }
  };

  const loadSession = async (sessionId: string) => {
    try {
      const res = await api.get(`/api/sessions/${sessionId}`);
      const data = res.data.session || res.data;
      if (data && (data.id || data.session_id)) {
        setCurrentSessionId(sessionId);
        setFailedImages(new Set());
        const activeConfigs = typeof data.active_configs === 'string'
          ? JSON.parse(data.active_configs || '{}')
          : (data.active_configs || {});
        setSelections(activeConfigs);
        const imageRecords = (data.images || []).filter((img: any) => img);
        const imgs = imageRecords.length > 0
          ? imageRecords.map((img: any) => img?.url || null)
          : (data.preview_images || []);
        setGeneratedImages(imgs);
        const models = Array.isArray(data.models) ? data.models : JSON.parse(data.models || '[]');
        const metaSource = imageRecords.length > 0 ? imageRecords : imgs.map((url: string) => ({ url }));
        const meta = metaSource.map((img: any) => ({
          prompt: img.prompt || data.prompt,
          enhanced_prompt: img.enhanced_prompt || data.enhanced_prompt || null,
          pipeline_type: img.pipeline_type || data.pipeline_type || null,
          ratio: img.ratio || data.ratio || data.settings?.ratio,
          quality: img.quality || data.quality || data.settings?.quality,
          models,
          model: img?.model_id || models?.[0] || undefined,
          sessionId: img?.session_id || data.id || data.session_id,
          id: img?.id,
          status: img.status || (img.url ? 'completed' : 'failed'),
          url: img.url || null
        }));
        setImageMetadata(meta);
        setImageNumbers(metaSource.map((_: any, i: number) => String(i + 1).padStart(2, '0')));
        imageCounterRef.current = metaSource.length;
        
        const loadedRatioId = data.ratio || data.settings?.ratio || '1:1';
        const loadedQualityId = data.quality || data.settings?.quality || 'High';
        setPrompt(cleanRawPrompt(data.prompt || '', loadedRatioId, loadedQualityId));
        setEnhancedPrompt(data.enhanced_prompt || null);
        setPipelineType(data.pipeline_type || null);
        
        setHistoryOpen(false);
        setStudioView(true);
      }
    } catch (e) {
      console.error('[loadSession]', e);
    }
  };


  // Multi-model generations now show directly in the studio gallery side-by-side.
  // The separate fullscreen loading screen has been removed.

  // -- VARIANT VIEW (multi-model results) --------------------------------
  if (variantView) {
    const MODEL_COLORS: Record<string, string> = {
      'Nanobanana 2': '#FACC15', 'Nanobanana 2 (Beta)': '#ec4899', 'Nanobanana Pro': '#E040FB', 'ChatGPT': '#10A37F', 'Kling': '#FF6B2B',
      'Flux.1': '#8B5CF6', 'Midjourney': '#3B82F6', 'Stable Diffusion': '#f87171',
      'Grok-2': '#34d399', 'OpenAI': '#10a37f'
    };
    return (
      <>
        <style>{`
          .var-root{width:100vw;min-height:100vh;display:flex;flex-direction:column;background:var(--bg);overflow:hidden;position:relative}
          .var-topbar{display:flex;align-items:center;gap:16px;padding:18px 28px;border-bottom:1px solid var(--card-border);background:var(--panel);backdrop-filter:blur(24px);flex-shrink:0;z-index:10}
          .var-title{font-family:var(--font-geist-sans),sans-serif;font-size:17px;font-weight:700;color:var(--text);letter-spacing:.02em}
          .var-subtitle{font-size:12px;color:var(--dim);margin-left:2px}
          .var-status-done{margin-left:auto;font-size:12px;color:rgba(74,222,128,0.9);font-weight:600;display:flex;align-items:center;gap:6px}
          .var-scroll{flex:1;display:flex;align-items:flex-start;overflow-x:auto;overflow-y:hidden;padding:32px 32px 24px;gap:22px;min-height:0}
          .var-scroll::-webkit-scrollbar{height:5px}
          .var-scroll::-webkit-scrollbar-thumb{background:var(--card-border);border-radius:10px}
          .var-card{flex-shrink:0;width:340px;min-width:300px;display:flex;flex-direction:column;background:var(--surface);border:1.5px solid var(--card-border);border-radius:22px;overflow:hidden;transition:border-color .25s,box-shadow .25s;box-shadow:0 4px 24px rgba(0,0,0,.25)}
          .var-card:hover{border-color:var(--text);box-shadow:0 8px 40px rgba(0,0,0,.35)}
          .var-card-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 12px;border-bottom:1px solid var(--card-border);flex-shrink:0}
          .var-badge{display:flex;align-items:center;gap:9px}
          .var-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;box-shadow:0 0 8px currentColor}
          .var-model-name{font-size:13px;font-weight:700;color:var(--text);letter-spacing:.03em}
          .var-iter-badge{font-size:10px;background:var(--surface-strong);padding:2px 8px;border-radius:8px;color:var(--dim);font-weight:600}
          .var-img-wrap{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;background:rgba(0,0,0,.3);flex-shrink:0}
          .var-img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .35s cubic-bezier(.19,1,.22,1)}
          .var-img:hover{transform:scale(1.04)}
          .var-skeleton{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:linear-gradient(90deg,rgba(255,255,255,.02) 0%,rgba(255,255,255,.05) 50%,rgba(255,255,255,.02) 100%);background-size:200% 100%;animation:varShimmer 1.6s infinite}
          @keyframes varShimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
          .var-iterating-label{font-size:11px;color:var(--dim);font-weight:700;letter-spacing:.1em;text-transform:uppercase}
          .var-prompt-area{padding:12px 16px 10px;border-top:1px solid var(--card-border)}
          .var-prompt-label{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:5px;display:block}
          .var-prompt-text{font-size:11px;color:var(--dim);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
          .var-footer{padding:12px 14px;border-top:1px solid var(--card-border);display:flex;gap:8px;flex-shrink:0}
          .var-btn-use{flex:1;padding:9px;border-radius:11px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;background:linear-gradient(135deg,rgba(34,197,94,.18),rgba(34,197,94,.1));border:1px solid rgba(34,197,94,.3);color:#4ade80;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:6px}
          .var-btn-use:hover{background:linear-gradient(135deg,rgba(34,197,94,.28),rgba(34,197,94,.18));border-color:rgba(34,197,94,.5);transform:translateY(-1px)}
          .var-btn-iterate-toggle{padding:9px 14px;border-radius:11px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;background:var(--surface);border:1px solid var(--card-border);color:var(--dim);transition:all .15s;display:flex;align-items:center;gap:5px;flex-shrink:0}
          .var-btn-iterate-toggle:hover:not(:disabled){background:rgba(251,191,36,.1);border-color:rgba(251,191,36,.3);color:#fbbf24}
          .var-btn-iterate-toggle.open{background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.35);color:#fbbf24}
          .var-btn-iterate-toggle:disabled{opacity:.35;cursor:not-allowed}
          .var-iterate-panel{padding:13px 14px 14px;border-top:1px solid rgba(251,191,36,.2);background:rgba(251,191,36,.04);animation:varSlide .2s ease}
          @keyframes varSlide{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
          .var-iterate-ta{width:100%;background:var(--surface);border:1px solid rgba(251,191,36,.3);border-radius:10px;color:var(--text);font-size:12px;padding:9px 11px;font-family:inherit;resize:none;outline:none;line-height:1.5;min-height:72px;box-sizing:border-box;transition:border-color .2s}
          .var-iterate-ta:focus{border-color:rgba(251,191,36,.55)}
          .var-iterate-hint{font-size:10px;color:var(--muted);margin-top:5px;margin-bottom:8px}
          .var-iterate-actions{display:flex;gap:8px;margin-top:8px}
          .var-btn-cancel{flex:1;padding:8px;border-radius:9px;font-size:12px;font-weight:600;font-family:inherit;background:var(--surface);border:1px solid var(--card-border);color:var(--dim);cursor:pointer;transition:all .15s}
          .var-btn-cancel:hover{background:var(--surface-strong);color:var(--text)}
          .var-btn-run-iterate{flex:2;padding:8px;border-radius:9px;font-size:12px;font-weight:700;font-family:inherit;background:linear-gradient(135deg,rgba(251,191,36,.18),rgba(251,191,36,.1));border:1px solid rgba(251,191,36,.35);color:#fbbf24;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:6px}
          .var-btn-run-iterate:hover:not(:disabled){background:linear-gradient(135deg,rgba(251,191,36,.28),rgba(251,191,36,.16));border-color:rgba(251,191,36,.55)}
          .var-btn-run-iterate:disabled{opacity:.35;cursor:not-allowed}
          .var-bottombar{padding:16px 32px;border-top:1px solid var(--card-border);display:flex;align-items:center;gap:16px;background:var(--panel);backdrop-filter:blur(20px);flex-shrink:0}
          .var-hint{font-size:12px;color:var(--dim);flex:1;line-height:1.5}
          .var-use-all-btn{padding:12px 28px;border-radius:12px;border:none;cursor:pointer;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-family:var(--font-geist-sans),sans-serif;font-size:13px;font-weight:700;transition:all .2s;display:flex;align-items:center;gap:8px;box-shadow:0 6px 20px rgba(34,197,94,.28);flex-shrink:0}
          .var-use-all-btn:hover{transform:translateY(-1px);box-shadow:0 8px 28px rgba(34,197,94,.4)}
        `}</style>
        <div className="bg-layer" />
        <div className="var-root">
          <div className="var-topbar">
            <button className="studio-back-btn" onClick={() => { setVariantView(false); setVariantCards([]); setVariantIterateOpen(null); setVariantIteratePrompt(''); }}>← Back</button>
            <div>
              <span className="var-title">Variant Generations</span>
              <span className="var-subtitle"> · {variantCards.length} model{variantCards.length !== 1 ? 's' : ''} completed</span>
            </div>
            <div className="var-status-done">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', display: 'inline-block', boxShadow: '0 0 8px #4ade80' }} />
              All generated
            </div>
          </div>

          <div className="var-scroll">
            {variantCards.map(card => {
              const isIterating = variantIterating === card.modelId;
              const isIterateOpen = variantIterateOpen === card.modelId;
              const color = MODEL_COLORS[card.modelId] || '#888';
              return (
                <div key={card.imageId || card.modelId} className="var-card">
                  <div className="var-card-head">
                    <div className="var-badge">
                      <div className="var-dot" style={{ background: color, color }} />
                      <span className="var-model-name">{card.modelId}</span>
                      {card.iterations.length > 1 && (
                        <span className="var-iter-badge">v{card.iterations.length}</span>
                      )}
                    </div>
                  </div>

                  <div className="var-img-wrap">
                    {isIterating ? (
                      <div className="var-skeleton">
                        <div className="gen-spinner" style={{ width: 36, height: 36, borderWidth: 2.5 }} />
                        <span className="var-iterating-label">Iterating...</span>
                      </div>
                    ) : (
                      <img src={card.imageUrl} alt={card.modelId} className="var-img" />
                    )}
                  </div>

                  <div className="var-prompt-area">
                    <span className="var-prompt-label">Prompt</span>
                    <div className="var-prompt-text">{card.prompt}</div>
                  </div>

                  {isIterateOpen && (
                    <div className="var-iterate-panel">
                      <textarea
                        className="var-iterate-ta"
                        autoFocus
                        placeholder={`Describe changes for ${card.modelId}, e.g. 'warmer tones, more dramatic lighting'...`}
                        value={variantIteratePrompt}
                        onChange={e => setVariantIteratePrompt(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) variantIterate(card.modelId); }}
                      />
                      <div className="var-iterate-hint">The current image is used as reference · Ctrl+Enter to submit</div>
                      <div className="var-iterate-actions">
                        <button className="var-btn-cancel" onClick={() => { setVariantIterateOpen(null); setVariantIteratePrompt(''); }}>Cancel</button>
                        <button className="var-btn-run-iterate" disabled={!variantIteratePrompt.trim() || !!variantIterating} onClick={() => variantIterate(card.modelId)}>
                          {isIterating ? <><div className="gen-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Iterating...</> : '↻ Iterate'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="var-footer">
                    <button className="var-btn-use" onClick={() => useVariantImages([card.modelId])}>✓ Use This</button>
                    <button
                      className={`var-btn-iterate-toggle ${isIterateOpen ? 'open' : ''}`}
                      disabled={!!variantIterating}
                      onClick={() => {
                        if (isIterateOpen) { setVariantIterateOpen(null); setVariantIteratePrompt(''); }
                        else { setVariantIterateOpen(card.modelId); setVariantIteratePrompt(''); }
                      }}
                    >
                      ↻ {isIterateOpen ? 'Close' : 'Iterate'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="var-bottombar">
            <div className="var-hint">Pick the best result with <strong style={{ color: 'var(--text)' }}>Use This</strong>, or refine any variant with <strong style={{ color: '#fbbf24' }}>Iterate</strong> before moving to your studio</div>
            <button className="var-use-all-btn" onClick={() => useVariantImages(variantCards.map(v => v.modelId))}>
              Use All ({variantCards.length}) →
            </button>
          </div>
        </div>
      </>
    );
  }

  // -- COMPARE VIEW (Screen 2A) -------------------------------------------
  if (compareView) {
    const latestByModel: Record<string, CompareImageSlot> = {};
    compareImages.forEach(img => { const ex = latestByModel[img.model_id]; if (!ex || img.iteration > ex.iteration) latestByModel[img.model_id] = img; });
    const visibleModels = Object.keys(latestByModel).filter(m => !compareDismissed.has(m));
    const allDone = visibleModels.length > 0 && visibleModels.every(m => latestByModel[m]?.status !== 'pending');
    const feedbackCount = Object.entries(compareFeedbacks).filter(([m, t]) => t.trim() && !compareDismissed.has(m)).length;
    const MCL: Record<string, string> = { 'Nanobanana 2': '#4285f4', 'Nanobanana 2 (Beta)': '#ec4899', 'Nanobanana Pro': '#E040FB', 'ChatGPT': '#00a67e', 'Kling': '#8b5cf6', 'Flux.1': '#f59e0b', 'Midjourney': '#e879f9', 'Stable Diffusion': '#f87171', 'Grok-2': '#34d399', 'OpenAI': '#10a37f' };
    return (
      <>
        <style>{`
          .cmp-root{width:100vw;height:100vh;display:flex;flex-direction:column;background:var(--bg);overflow:hidden;position:relative}
          .cmp-topbar{display:flex;align-items:center;gap:16px;padding:18px 28px;border-bottom:1px solid var(--card-border);background:var(--panel);backdrop-filter:blur(24px);flex-shrink:0}
          .cmp-title{font-family:var(--font-geist-sans),sans-serif;font-size:17px;font-weight:700;color:var(--text);letter-spacing:.02em}
            .cmp-subtitle{font-size:12px;color:var(--dim);margin-left:2px}
            .cmp-status{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dim)}
          .cmp-scroll::-webkit-scrollbar-track{background:transparent;border-radius:10px}
          .cmp-scroll::-webkit-scrollbar-thumb{background:var(--card-border);border-radius:10px}
          .cmp-card{flex-shrink:0;width:300px;min-width:280px;display:flex;flex-direction:column;background:var(--surface);border:2px solid var(--card-border);border-radius:20px;overflow:hidden;transition:border-color .3s,box-shadow .3s,opacity .3s}
          .cmp-card.selected{border-color:#22c55e;box-shadow:0 0 44px rgba(34,197,94,.22)}
          .cmp-card.dimmed{opacity:.28;filter:grayscale(.3);pointer-events:none}
          .cmp-card-head{display:flex;align-items:center;justify-content:space-between;padding:13px 14px 11px;border-bottom:1px solid var(--card-border);flex-shrink:0}
          .cmp-badge{display:flex;align-items:center;gap:8px}
          .cmp-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
          .cmp-model-name{font-size:13px;font-weight:700;color:var(--text);letter-spacing:.03em}
          .cmp-iter{font-size:10px;background:var(--surface-strong);padding:2px 7px;border-radius:8px;color:var(--dim)}
          .cmp-dismiss{width:26px;height:26px;border-radius:8px;flex-shrink:0;background:rgba(255,60,60,.1);border:1px solid rgba(255,60,60,.2);color:rgba(255,130,130,.8);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;transition:all .15s}
          .cmp-dismiss:hover{background:rgba(255,60,60,.25);border-color:rgba(255,60,60,.5);color:#ff9090}
          .cmp-img-wrap{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;background:rgba(0,0,0,.25);flex-shrink:0}
          .cmp-img{width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;transition:transform .3s}
          .cmp-img:hover{transform:scale(1.04)}
          .cmp-skeleton{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:linear-gradient(90deg,rgba(255,255,255,.02) 0%,rgba(255,255,255,.05) 50%,rgba(255,255,255,.02) 100%);background-size:200% 100%;animation:cmpShimmer 1.6s infinite}
          @keyframes cmpShimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
          .cmp-error{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:20px;text-align:center;background:rgba(220,50,50,.05)}
          .cmp-prompt-area{padding:11px 14px 20px;flex:1;border-top:1px solid var(--card-border);overflow:hidden;position:relative}
          .cmp-prompt-label{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:5px;display:block}
          .cmp-prompt-text{font-size:11px;color:var(--dim);line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;transition:all .3s ease}
          .cmp-prompt-text.expanded{-webkit-line-clamp:unset;display:block;max-height:none}
          .cmp-more-btn{background:none;border:none;color:var(--orange);font-size:10px;font-weight:700;padding:0;cursor:pointer;margin-top:6px;opacity:.7;transition:opacity .2s;font-family:inherit}
          .cmp-more-btn:hover{opacity:1}
          .cmp-footer{padding:11px 14px;border-top:1px solid var(--card-border);display:flex;gap:6px;flex-shrink:0}
          .cmp-btn-select{flex:1;padding:8px;border-radius:10px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);color:#4ade80;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:5px}
          .cmp-btn-select:hover:not(:disabled){background:rgba(34,197,94,.22);border-color:rgba(34,197,94,.45)}
          .cmp-btn-select.active{background:rgba(34,197,94,.28);border-color:#22c55e;color:#86efac}
          .cmp-btn-select:disabled{opacity:.35;cursor:not-allowed}
          .cmp-btn-feedback{padding:8px 11px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;background:var(--surface);border:1px solid var(--card-border);color:var(--dim);transition:all .15s;display:flex;align-items:center;gap:4px}
          .cmp-btn-feedback:hover:not(:disabled){background:rgba(251,191,36,.1);border-color:rgba(251,191,36,.3);color:#fbbf24}
          .cmp-btn-feedback.open{background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.35);color:#fbbf24}
          .cmp-btn-feedback:disabled{opacity:.35;cursor:not-allowed}
          .cmp-fb-box{padding:10px 14px 13px;border-top:1px solid rgba(251,191,36,.15);background:rgba(251,191,36,.04);animation:cmpSlide .2s ease}
          @keyframes cmpSlide{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
          .cmp-fb-ta{width:100%;background:var(--surface);border:1px solid rgba(251,191,36,.25);border-radius:8px;color:var(--text);font-size:12px;padding:8px 10px;font-family:inherit;resize:none;outline:none;line-height:1.5;min-height:68px;box-sizing:border-box;transition:border-color .2s}
          .cmp-fb-ta:focus{border-color:rgba(251,191,36,.5)}
          .cmp-fb-hint{font-size:10px;color:var(--muted);margin-top:5px}
          .cmp-bottombar{padding:14px 28px;border-top:1px solid var(--card-border);display:flex;align-items:center;gap:14px;background:var(--panel);backdrop-filter:blur(20px);flex-shrink:0}
          .cmp-hint{font-size:12px;color:var(--dim);flex:1;line-height:1.5}
          .cmp-regen-btn{padding:11px 22px;border-radius:11px;cursor:pointer;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.28);color:#fbbf24;font-family:var(--font-geist-sans),sans-serif;font-size:13px;font-weight:700;transition:all .2s;display:flex;align-items:center;gap:8px}
          .cmp-regen-btn:hover:not(:disabled){background:rgba(251,191,36,.18);border-color:rgba(251,191,36,.5)}
          .cmp-regen-btn:disabled{opacity:.3;cursor:not-allowed}
          .cmp-continue-btn{padding:11px 26px;border-radius:11px;border:none;cursor:pointer;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-family:var(--font-geist-sans),sans-serif;font-size:13px;font-weight:700;transition:all .2s;display:flex;align-items:center;gap:8px;box-shadow:0 6px 20px rgba(34,197,94,.3)}
          .cmp-continue-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 26px rgba(34,197,94,.4)}
          .cmp-continue-btn:disabled{opacity:.3;cursor:not-allowed;transform:none;box-shadow:none}
          .cmp-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--dim)}
        `}</style>
        <div className="bg-layer" />
        <div className="cmp-root">
          <div className="cmp-topbar">
            <button className="studio-back-btn" onClick={() => { clearComparePoll(); setCompareView(false); setStudioView(false); setCompareSessionId(null); setCompareImages([]); setCompareDismissed(new Set()); setCompareSelected(null); setCompareFeedbacks({}); setCompareFeedbackOpen(new Set()); }}>← Back</button>
            <div><span className="cmp-title">Compare Generations</span><span className="cmp-subtitle"> · {visibleModels.length} model{visibleModels.length !== 1 ? 's' : ''}</span></div>
            <div className="cmp-status">{!allDone ? <><div className="gen-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /><span>Generating...</span></> : <span style={{ color: 'rgba(74,222,128,0.9)' }}>✓ All complete</span>}</div>
          </div>
          <div className="cmp-scroll">
            {visibleModels.length === 0 && (
              <div className="cmp-empty">
                <span style={{ fontSize: 32 }}>🫗</span>
                <span style={{ fontSize: 14 }}>All models dismissed</span>
                <button style={{ background: 'none', border: '1px solid rgba(255,107,43,0.4)', borderRadius: 8, color: 'var(--orange)', padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }} onClick={() => setCompareDismissed(new Set())}>Restore All</button>
              </div>
            )}
            {visibleModels.map(modelId => {
              const slot = latestByModel[modelId];
              const isSelected = compareSelected === modelId;
              const isDimmed = compareSelected !== null && !isSelected;
              const isFbOpen = compareFeedbackOpen.has(modelId);
              const color = MCL[modelId] || '#888';
              return (
                <div key={modelId} className={`cmp-card ${isSelected ? 'selected' : ''} ${isDimmed ? 'dimmed' : ''}`}>
                  <div className="cmp-card-head">
                    <div className="cmp-badge">
                      <div className="cmp-dot" style={{ background: color }} />
                      <span className="cmp-model-name">{modelId}</span>
                      {(slot?.iteration ?? 0) > 0 && <span className="cmp-iter">Round {(slot?.iteration ?? 0) + 1}</span>}
                    </div>
                    <button className="cmp-dismiss" title="Remove model" onClick={() => { setCompareDismissed(prev => new Set([...prev, modelId])); if (compareSelected === modelId) setCompareSelected(null); }}>✕</button>
                  </div>
                  <div className="cmp-img-wrap">
                    {slot?.status === 'pending' && <div className="cmp-skeleton"><div className="gen-spinner" style={{ width: 36, height: 36, borderWidth: 2.5 }} /><span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.1em' }}>GENERATING</span></div>}
                    {slot?.status === 'completed' && slot.url && <img src={slot.url} alt={modelId} className="cmp-img" />}
                    {slot?.status === 'failed' && <div className="cmp-error"><span style={{ fontSize: 26 }}>⚠️</span><span style={{ fontSize: 12, color: 'rgba(255,90,90,0.9)', fontWeight: 700 }}>{modelId} failed</span><span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5, maxWidth: 220 }}>{formatUserFriendlyError(slot.error_msg)}</span></div>}
                  </div>
                  <div className="cmp-prompt-area">
                    <span className="cmp-prompt-label">Tailored Prompt</span>
                    <div className={`cmp-prompt-text ${compareExpanded.has(modelId) ? 'expanded' : ''}`}>{slot?.tailored_prompt || '—'}</div>
                    {slot?.tailored_prompt && slot.tailored_prompt.length > 80 && (
                      <button
                        className="cmp-more-btn"
                        onClick={() => setCompareExpanded(prev => {
                          const n = new Set(prev);
                          if (n.has(modelId)) n.delete(modelId); else n.add(modelId);
                          return n;
                        })}
                      >
                        {compareExpanded.has(modelId) ? '...less' : 'more...'}
                      </button>
                    )}
                  </div>
                  <div className="cmp-footer">
                    <button className={`cmp-btn-select ${isSelected ? 'active' : ''}`} disabled={slot?.status !== 'completed'} onClick={() => setCompareSelected(prev => prev === modelId ? null : modelId)}>{isSelected ? '✓ Selected' : '✓ Select'}</button>
                    <button className={`cmp-btn-feedback ${isFbOpen ? 'open' : ''}`} disabled={slot?.status === 'pending'} onClick={() => setCompareFeedbackOpen(prev => { const n = new Set(prev); if (n.has(modelId)) n.delete(modelId); else n.add(modelId); return n; })}>✎ {isFbOpen ? 'Editing' : 'Feedback'}</button>
                  </div>
                  {isFbOpen && (
                    <div className="cmp-fb-box">
                      <textarea className="cmp-fb-ta" autoFocus placeholder={`Changes for ${modelId}, e.g. 'more dramatic lighting, warmer tones'...`} value={compareFeedbacks[modelId] || ''} onChange={e => setCompareFeedbacks(prev => ({ ...prev, [modelId]: e.target.value }))} />
                      <div className="cmp-fb-hint">Feedback is appended to the tailored prompt for {modelId} only</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="cmp-bottombar">
            <div className="cmp-hint">{compareSelected ? `✓ ${compareSelected} selected — click Continue to add this image to your studio` : feedbackCount > 0 ? `${feedbackCount} model${feedbackCount > 1 ? 's' : ''} marked for regeneration` : 'Select an image to continue · or give feedback to refine specific models'}</div>
            <button className="cmp-regen-btn" disabled={compareRegenerating || feedbackCount === 0} onClick={compareRunFeedback}>{compareRegenerating ? <><div className="gen-spinner" style={{ width: 13, height: 13, borderWidth: 1.5 }} /> Regenerating...</> : `↻ Regenerate (${feedbackCount})`}</button>
            <button className="cmp-continue-btn" disabled={!compareSelected} onClick={() => compareSelected && compareFinalizeSelection(compareSelected)}>{compareSelected ? `Continue with ${compareSelected} →` : 'Continue →'}</button>
          </div>
        </div>
      </>
    );
  }

  // -- STUDIO VIEW --------------------------------------------------------
  if (studioView) {
    return (
      <>
        {tooltip && (
          <div style={{
            position: 'fixed', left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)',
            background: 'var(--panel)', backdropFilter: 'blur(16px)',
            color: 'var(--text)', padding: '8px 14px', borderRadius: '10px',
            fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 99999,
            border: '1px solid var(--card-border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)'
          }}>
            {/* Arrow */}
            <div style={{
              position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)',
              width: 10, height: 10, background: 'var(--panel)',
              borderRight: '1px solid var(--card-border)', borderBottom: '1px solid var(--card-border)'
            }}></div>
            {tooltip.text}
          </div>
        )}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="image/*"
          multiple
          onChange={handleFileUpload}
        />
        <input
          type="file"
          ref={editRefInputRef}
          style={{ display: 'none' }}
          accept="image/*"
          onChange={e => { if (e.target.files?.[0]) setEditRefFile(e.target.files[0]); }}
        />
        <style>{`
          /* -- EDIT PANEL -- */
          .edit-panel {
            position: fixed; top: var(--studio-nav-offset, 76px); right: 0;
            width: 360px; z-index: 900;
            bottom: 0;
            height: calc(100dvh - var(--studio-nav-offset, 76px));
            background: var(--panel);
            border-left: 1px solid var(--card-border);
            border-top: none;
            border-bottom: none;
            border-right: none;
            border-radius: 0;
            display: flex; flex-direction: column;
            box-shadow: -4px 0 32px rgba(0,0,0,0.18);
            animation: slideInRight 0.28s cubic-bezier(0.19,1,0.22,1);
            overflow-y: auto;
            overflow-x: hidden;
            padding-top: 0;
            direction: rtl; /* Move scrollbar to left side */
            transition: top 180ms ease-out, height 180ms ease-out;
          }
          .edit-panel > * {
            direction: ltr; /* Restore content direction */
          }
          .edit-panel::-webkit-scrollbar { width: 3px; height: 3px; }
          .edit-panel::-webkit-scrollbar-thumb { background: var(--card-border); border-radius: 4px; }
          .edit-panel::-webkit-scrollbar-track { background: transparent; }
          .edit-panel.studio-scroll-region {
            scrollbar-width: thin;
            scrollbar-color: var(--card-border) transparent;
          }
          .edit-panel.studio-scroll-region::-webkit-scrollbar {
            width: 3px;
            height: 3px;
          }
          .studio-scroll-region {
            scrollbar-width: none;
            -ms-overflow-style: none;
            overscroll-behavior: contain;
          }
          .studio-scroll-region::-webkit-scrollbar {
            width: 0;
            height: 0;
          }
          .studio-scroll-region:hover {
            scrollbar-width: thin;
            scrollbar-color: var(--muted) transparent;
          }
          .studio-scroll-region:hover::-webkit-scrollbar {
            width: 4px;
            height: 4px;
          }
          .studio-scroll-region:hover::-webkit-scrollbar-thumb {
            background: var(--muted);
            border-radius: 999px;
          }
          @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
          }
          .edit-panel-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 16px 12px;
          }
          .edit-panel-title {
            font-family: var(--font-geist-sans), sans-serif; font-weight: 700;
            font-size: 14px; color: var(--text); letter-spacing: 0.04em;
          }
          .edit-panel-close {
            background: var(--surface); border: 1px solid var(--card-border);
            border-radius: 8px; color: var(--dim); cursor: pointer;
            width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
            font-size: 14px; transition: all 0.2s;
          }
          .edit-panel-close:hover { background: var(--surface-strong); color: var(--text); }
          .edit-panel-body {
            padding: 16px;
            display: flex; flex-direction: column; gap: 14px;
          }
          .edit-section-label {
            font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
            text-transform: uppercase; color: var(--dim);
            margin-bottom: 8px; display: block;
          }
          .edit-prompt-input {
            width: 100%; background: var(--surface);
            border: 1px solid var(--card-border); border-radius: 12px;
            color: var(--text); font-size: 13px; padding: 12px 14px;
            font-family: inherit; resize: vertical; min-height: 100px;
            outline: none; line-height: 1.6; transition: border-color 0.2s;
            box-sizing: border-box;
          }
          .edit-prompt-input:focus { border-color: var(--card-border); }
          .edit-ref-zone {
            border: 1px dashed var(--card-border); border-radius: 12px;
            padding: 14px; display: flex; align-items: center; gap: 12px;
            cursor: pointer; transition: all 0.2s; background: var(--surface);
          }
          .edit-ref-zone:hover { border-color: var(--card-border); background: var(--surface-strong); }
          .edit-ref-zone.has-file { border-color: var(--card-border); border-style: solid; background: var(--surface-strong); }
          .edit-ref-preview { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; border: 1px solid var(--card-border); }
          .edit-ref-placeholder { width: 44px; height: 44px; border-radius: 8px; background: var(--surface); display: flex; align-items: center; justify-content: center; }
          .edit-source-thumb { 
            width: 100%; 
            border-radius: 12px; 
            height: auto;
            max-height: 200px; 
            object-fit: contain;
            background: rgba(0,0,0,0.2);
            border: 1px solid var(--card-border); 
            display: block;
            margin-top: 4px;
          }
          .edit-configs-wrap { display: flex; flex-wrap: wrap; gap: 6px; }
          .edit-config-chip {
            font-size: 11px; padding: 4px 10px; border-radius: 20px;
            background: var(--surface); border: 1px solid var(--card-border);
            color: var(--dim); font-family: inherit;
          }
          .edit-cta-primary {
            width: 100%; padding: 13px; border-radius: 12px; border: none; cursor: pointer;
            background: linear-gradient(135deg, var(--orange), var(--pink));
            color: #fff; font-family: var(--font-geist-sans), sans-serif; font-size: 14px; font-weight: 700;
            transition: opacity 0.2s, transform 0.1s; display: flex; align-items: center; justify-content: center; gap: 8px;
          }
          .edit-cta-primary:hover { opacity: 0.88; transform: translateY(-1px); }
          .edit-cta-primary:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
          .edit-cta-secondary {
            width: 100%; padding: 10px; border-radius: 12px; cursor: pointer;
            background: var(--surface); border: 1px solid var(--card-border);
            color: var(--dim); font-family: inherit; font-size: 12px; font-weight: 500;
            transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 6px;
          }
          .edit-cta-secondary:hover { background: var(--surface-strong); color: var(--text); border-color: var(--card-border); }
          .edit-cta-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
          .edit-panel-footer {
            padding: 12px 16px 24px; display: flex; flex-direction: column; gap: 8px;
          }
          .studio-img-card:hover .studio-img-overlay { opacity: 1; }
          .studio-img-action-btn.edit-btn {
            background: rgba(255,107,43,0.2);
            border-color: rgba(255,107,43,0.35);
            color: rgba(255,200,150,1);
          }
          .studio-img-action-btn.edit-btn:hover {
            background: rgba(255,107,43,0.4);
            border-color: rgba(255,107,43,0.6);
          }

          @keyframes stopPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.3); }
            50% { box-shadow: 0 0 0 10px rgba(239,68,68,0); }
          }

          .studio-root {
            display: flex;
            height: 88.89vh;
            width: 100%;
            margin: 0;
            position: relative;
            z-index: 100;
            color: var(--text);
            background: var(--bg);
            overflow: hidden;
          }
          .studio-main {
            flex: 1;
            margin-left: var(--sidebar-width, 380px);
            position: relative;
            min-width: 0;
            height: 88.89vh;
            overflow-y: auto;
            transition: margin-left 0.3s cubic-bezier(0.19, 1, 0.22, 1);
            padding: 64px 32px 60px 32px;
          }
          .stage {
            padding: 0 32px 32px;
            width: 100%;
          }
          .studio-sidebar {
            position: fixed;
            top: 0;
            left: 213px;
            bottom: 0;
            height: 88.89vh;
            width: var(--sidebar-width, 380px);
            display: flex;
            flex-direction: column;
            padding: 20px 16px 24px 20px;
            overflow-y: auto;
            overflow-x: hidden;
            z-index: 900;
            gap: 0;
            flex-shrink: 0;
            background: var(--panel);
            border-right: 1px solid var(--card-border);
            border-top: none;
            border-bottom: none;
            border-left: none;
            border-radius: 0;
            scrollbar-width: none;
            -ms-overflow-style: none;
            box-shadow: none;
            transition: top 180ms ease-out, height 180ms ease-out;
          }
          .studio-resizer {
            position: absolute;
            top: 0;
            right: 0;
            width: 4px;
            height: 100%;
            cursor: col-resize;
            z-index: 1000;
            transition: background 0.2s;
            border-radius: 0;
          }
          .studio-resizer:hover, .studio-resizer.resizing {
            background: var(--orange);
          }
          /* -- STUDIO RATIO/QUALITY ROW -- */
          .studio-rq-row { display:flex; gap:10px; width: 100%; }
          .studio-rq-btn {
            width: 100%; padding:8px 12px; border-radius:10px;
            background:var(--surface); border:1px solid var(--card-border);
            color:var(--text); font-size:12px; font-family:inherit; cursor:pointer;
            display:flex; align-items:center; justify-content:space-between; gap:6px;
            transition:all .2s; position:relative; box-sizing: border-box;
          }
          .studio-rq-btn:hover { background:var(--surface-strong); color:var(--text); }
          .studio-rq-btn.active { border-color:var(--card-border); color:var(--text); background:var(--surface-strong); }
          .studio-rq-panel {
            position:absolute; top:calc(100% + 8px); left:0; right:0;
            background:var(--panel); border:1px solid var(--card-border);
            border-radius:12px; padding:10px; z-index:9999;
            display:flex; flex-direction:column; gap:4px;
            box-shadow:0 12px 40px rgba(0,0,0,0.6);
            min-width:140px;
            max-height: 300px;
            overflow-y: auto;
          }
          .sb-model-dropdown {
            position: absolute; top: calc(100% + 8px); left: 0; right: 0;
            background: var(--panel); border: 1px solid var(--card-border);
            border-radius: 12px; z-index: 9999;
            box-shadow: 0 12px 40px rgba(0,0,0,0.3);
            overflow: hidden;
            animation: fadeUp 0.2s ease;
          }
          .studio-rq-opt {
            padding:7px 10px; border-radius:8px; font-size:12px; cursor:pointer;
            color:var(--dim); transition:all .15s;
          }
          .studio-rq-opt:hover { background:var(--surface); color:var(--text); }
          .studio-rq-opt.active { background:var(--surface-strong); color:var(--text); font-weight:600; }
          /* -- MASONRY GALLERY -- */
          .studio-gallery-masonry {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
            gap: 24px;
            padding: 0;
            width: 100%;
          }
          @media (max-width: 600px) { .studio-gallery-masonry { grid-template-columns: 1fr; } }

          .studio-gallery-grid-2 {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 24px;
            padding: 0;
            width: 100%;
          }
          .studio-gallery-grid-3 {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 24px;
            padding: 0;
            width: 100%;
          }
          @media (max-width: 1200px) { .studio-gallery-grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
          @media (max-width: 800px) { .studio-gallery-grid-3 { grid-template-columns: 1fr; } .studio-gallery-grid-2 { grid-template-columns: 1fr; } }

          .grid-toggle-wrap {
            display: flex;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 2px;
            gap: 2px;
          }
          
          .studio-gallery-focus {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 0;
            height: 100%;
            overflow-x: auto;
          }
          .studio-gallery-focus::-webkit-scrollbar { height: 8px; }
          .studio-gallery-focus::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
          .lineage-step {
            display: flex;
            align-items: center;
            gap: 16px;
            flex-shrink: 0;
          }
          .lineage-arrow {
            font-size: 32px;
            color: rgba(255,255,255,0.2);
            font-weight: 200;
            flex-shrink: 0;
          }
          .studio-gallery-focus .masonry-card {
            width: 480px;
            max-width: 80vw;
            margin: 0;
            border-radius: 24px;
            flex-shrink: 0;
          }
          .masonry-card {
            break-inside: avoid;
            margin-bottom: 20px;
            position: relative;
            border-radius: 24px;
            overflow: hidden;
            cursor: pointer;
            border: 1px solid var(--card-border);
            transition: transform .2s, border-color .2s, box-shadow .2s;
            background: var(--card);
            backdrop-filter: blur(18px) saturate(160%);
            -webkit-backdrop-filter: blur(18px) saturate(160%);
            box-shadow: none;
            will-change: transform;
          }
          .masonry-card:hover { box-shadow: none; border-color: rgba(255, 255, 255, 0.4); }
          .masonry-card img { width:100%; height:auto; display:block; transition: filter .25s ease; transform-origin: center center; border-radius: inherit; }
          .masonry-card-media {
            position: relative;
            border-radius: inherit;
            overflow: hidden;
          }
          .masonry-card-badge {
            position: absolute;
            top: 10px;
            left: 10px;
            z-index: 3;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.02em;
            padding: 4px 10px;
            border-radius: 999px;
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.14);
            color: rgba(255,255,255,0.92);
            backdrop-filter: blur(10px);
            box-shadow: none;
            pointer-events: none;
            opacity: 0;
            transform: translateY(-2px);
            transition: opacity .18s ease, transform .18s ease;
          }
          .masonry-card-overlay {
            position:absolute; inset:0;
            background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.1) 50%, transparent 100%);
            opacity:0; transition:opacity .2s;
            display:flex; flex-direction:column; justify-content:flex-end;
            padding:14px;
          }
          .masonry-card:hover .masonry-card-overlay { opacity:1; }
          .masonry-card-prompt {
            font-size:11px; color:rgba(255,255,255,0.85); line-height:1.5;
            display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical;
            overflow:hidden;
          }
          .masonry-card-meta {
            font-size:10px; color:rgba(255,255,255,0.45); margin-top:6px;
            display:flex; gap:8px;
          }
          .masonry-card-actions {
            display:flex; gap:6px; margin-bottom:8px;
          }
          .masonry-action-btn {
            padding:4px 10px; border-radius:6px; font-size:10px; font-weight:600;
            cursor:pointer; font-family:inherit; border:1px solid rgba(255,255,255,0.2);
            background:rgba(0,0,0,0.5); color:#fff; transition:all .15s;
          }
          .masonry-action-btn:hover { background:rgba(255,255,255,0.15); }
          .masonry-action-btn.edit { background:rgba(255,107,43,0.25); border-color:rgba(255,107,43,0.5); color:#ffb088; }
          .masonry-action-btn.edit:hover { background:rgba(255,107,43,0.45); }
          /* -- LIGHTBOX -- */
          .lightbox-backdrop {
            position: fixed; inset: 0; z-index: 2000;
            background: rgba(0,0,0,0.65); backdrop-filter: blur(16px) saturate(160%);
            display: flex; align-items: center; justify-content: center;
            animation: lbFadeIn .22s ease;
            padding: 20px;
            overflow: hidden;
          }
          @keyframes lbFadeIn { from { opacity:0; } to { opacity:1; } }
          .lightbox-content {
            display: flex; max-width: 1600px; width: 98vw; height: 88vh;
            background: var(--panel);
            border-radius: 20px;
            overflow: hidden;
            border: 1px solid var(--card-border);
            box-shadow: 0 32px 80px rgba(0,0,0,0.45), var(--shadow-sm);
            animation: lbPopIn .28s cubic-bezier(0.34, 1.4, 0.64, 1);
            position: relative;
          }
          @keyframes lbPopIn { from { transform:scale(0.94) translateY(10px); opacity:0; } to { transform:scale(1) translateY(0); opacity:1; } }
          .lightbox-img-wrap {
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
            background: var(--bg); padding: 32px; min-width: 0; position: relative; gap: 16px;
            overflow: hidden;
          }
          .lightbox-img-wrap img {
            max-width: 100%; max-height: 76vh; object-fit: contain; border-radius: 10px; display: block;
            box-shadow: 0 16px 48px rgba(0,0,0,0.3);
          }
          .lightbox-info {
            width: 420px; flex-shrink: 0; padding: 0;
            overflow: hidden; display: flex; flex-direction: column;
            background: var(--panel);
            border-left: 1px solid var(--card-border);
          }
          .lightbox-close-btn {
            position: absolute; top: 14px; right: 14px;
            width: 32px; height: 32px; border-radius: 50%;
            background: var(--surface-strong); color: var(--text);
            border: 1px solid var(--card-border);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; z-index: 2010;
            transition: all 0.2s;
          }
          .lightbox-close-btn:hover { background: var(--surface); transform: scale(1.08); }
          .lb-nav-btn {
            position: absolute; top: 50%; transform: translateY(-50%);
            width: 40px; height: 40px; border-radius: 50%;
            background: var(--surface-strong); color: var(--text);
            border: 1px solid var(--card-border);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; z-index: 2020; transition: all 0.2s;
          }
          .lb-nav-btn:hover { background: var(--surface); transform: translateY(-50%) scale(1.08); }
          .lb-nav-btn.prev { left: 16px; }
          /* next sits just inside the left edge of the info panel */
          .lb-nav-btn.next { right: calc(420px + 16px); }
          .lb-action-btn {
            display: flex; align-items: center; justify-content: center; gap: 8px;
            width: 100%; padding: 12px 16px; border-radius: 10px;
            font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
            transition: all 0.18s; border: none; letter-spacing: 0.01em;
          }
          .lb-action-primary {
            background: var(--orange);
            color: #fff;
            box-shadow: 0 4px 16px rgba(255,107,43,0.3);
          }
          .lb-action-primary:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 6px 22px rgba(255,107,43,0.4); }
          .lb-action-secondary {
            background: var(--surface-strong);
            color: var(--text);
            border: 1px solid var(--card-border) !important;
          }
          .lb-action-secondary:hover { background: var(--surface); border-color: var(--orange) !important; color: var(--text); }
          .lb-tag {
            display: inline-flex; align-items: center; gap: 5px;
            padding: 4px 10px; border-radius: 99px;
            font-size: 11px; font-weight: 600;
            background: var(--surface-strong);
            border: 1px solid var(--card-border);
            color: var(--text);
          }

          /* Sidebar scrollbar — invisible at rest, thin+subtle on hover */
          .studio-sidebar { scrollbar-width: thin; scrollbar-color: transparent transparent; }
          .studio-sidebar:hover { scrollbar-color: rgba(255,255,255,0.15) transparent; }
          .studio-sidebar::-webkit-scrollbar { width: 4px; }
          .studio-sidebar::-webkit-scrollbar-track { background: transparent; }
          .studio-sidebar::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; }
          .studio-sidebar:hover::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); }

          /* studio-main scroll is defined above */
          .studio-gallery-area {
            flex: 1;
            min-height: 0;
            padding: 8px 16px 30px 30px;
            display: grid;
            gap: 24px;
            align-content: start;
            overflow-y: auto;
            overflow-x: hidden;
            grid-template-columns: 1fr 1fr;
          }
          .grid-1cols { grid-template-columns: 1fr 1fr; max-width: 1400px; margin: 0 auto; width: 100%; }
          .grid-2cols { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .grid-3cols { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .grid-2x2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }

          .studio-img-card {
            position: relative;
            border-radius: 24px;
            overflow: hidden;
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            cursor: pointer;
            transition: all 0.5s cubic-bezier(0.19, 1, 0.22, 1);
            box-shadow: none;
            aspect-ratio: auto;
          }
          .studio-img-card:hover {
            transform: scale(1.03);
            z-index: 2000;
            border-color: rgba(255, 107, 43, 0.5);
            box-shadow: none;
          }
          .studio-img-card img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
            border-radius: 14px;
          }
          .studio-img-overlay {
            position: absolute; bottom: 0; left: 0; right: 0;
            background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%);
            padding: 20px 16px 14px;
            opacity: 0; transition: opacity 0.3s;
          }
          .studio-img-card:hover .studio-img-overlay { opacity: 1; }
          
          /* -- STUDIO HEADER & ACTIONS -- */
          .studio-header {
            margin-bottom: 16px;
            display: flex;
            justify-content: flex-end;
            align-items: center;
          }
          .studio-back-btn {
            background: var(--surface);
            border: 1px solid var(--card-border);
            color: var(--text); padding: 8px 16px; border-radius: 8px;
            font-size: 13px; font-family: var(--font-geist-sans), sans-serif; cursor: pointer;
            transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px;
          }
          .studio-back-btn:hover {
            background: var(--surface-strong); border-color: var(--orange); color: var(--orange);
          }

          .studio-topbar {
            display: flex; justify-content: space-between; align-items: center; padding: 18px 32px 14px;
            position: sticky; top: 0; z-index: 400;
            background: var(--panel);
            backdrop-filter: blur(24px) saturate(180%);
            border-bottom: 1px solid var(--card-border);
            box-shadow: 0 4px 30px rgba(0,0,0,0.1);
          }
          .studio-top-actions { display: flex; gap: 12px; }
        .studio-main-toolbar {
          display: inline-flex;
          justify-content: flex-start;
          align-items: center;
          gap: 12px;
          padding: 0;
          position: relative;
          z-index: 200;
          flex-shrink: 0;
          align-self: flex-start;
        }
          .studio-icon-btn {
            background: var(--surface);
            backdrop-filter: blur(12px) saturate(180%);
            border: 1px solid var(--card-border);
            color: var(--text); width: 36px; height: 36px; border-radius: 10px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
          }
          .studio-icon-btn:hover { 
            background: var(--surface-strong); 
            border-color: var(--card-border);
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
          }
          .studio-icon-btn.active {
            background: var(--surface-strong);
            border-color: var(--card-border);
            color: var(--text);
          }
          .studio-back-btn-simple {
             background: var(--surface);
             border: 1px solid var(--card-border);
             color: var(--dim);
             width: 32px; height: 32px; border-radius: 8px;
             display: flex; align-items: center; justify-content: center;
             cursor: pointer; font-size: 18px; font-weight: 300;
             transition: all 0.2s;
           }
          .studio-back-btn-simple:hover {
            background: var(--surface-strong);
            color: var(--text);
            border-color: var(--card-border);
          }

          .studio-img-actions { display: flex; gap: 10px; margin-bottom: 8px; }
          .studio-img-action-btn {
            background: var(--surface); backdrop-filter: blur(8px);
            border: 1px solid var(--card-border);
            color: var(--text); padding: 6px 14px; border-radius: 8px; font-size: 11px;
            font-family: inherit; display: flex; align-items: center; gap: 6px;
            cursor: pointer; transition: all 0.2s;
          }
          .studio-img-action-btn:hover { background: var(--surface-strong); border-color: var(--card-border); }
          .studio-img-meta { color: var(--dim); font-size: 11px; }

          /* -- PILL NAVIGATION (HISTORY/COMMUNITY) -- */
          .pill-nav-wrap {
            display: flex;
            background: var(--surface);
            border: 1px solid var(--card-border);
            padding: 4px;
            border-radius: 12px;
            gap: 4px;
          }
          .pill-nav-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            color: var(--dim);
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            background: transparent;
          }
          .pill-nav-btn:hover {
            color: var(--text);
            background: var(--surface-strong);
          }
          .pill-nav-btn.active {
            background: var(--surface-strong);
            color: var(--text);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
          }
          .pill-nav-icon {
            opacity: 0.7;
          }
          .pill-nav-btn.active .pill-nav-icon {
            opacity: 1;
          }

          /* -- NEW CHAT BUTTON -- */
          .new-chat-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 700;
            color: #fff;
            background: var(--orange);
            border: none;
            cursor: pointer;
            transition: all 0.2s;
            box-shadow: 0 4px 15px rgba(255, 107, 43, 0.2);
          }
          .new-chat-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(255, 107, 43, 0.3);
            opacity: 0.9;
          }
          .new-chat-btn:active {
            transform: translateY(0);
          }
          
          /* -- HISTORY SIDEBAR/MODAL -- */
          .history-overlay {
            position: fixed; inset: 0; z-index: 1500;
            background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(4px);
            display: flex; justify-content: flex-start;
            animation: fadeIn 0.2s ease;
          }
          .history-sidebar {
            width: 45%; height: 100%;
            background: var(--panel);
            border-right: 1px solid var(--card-border);
            display: flex; flex-direction: column;
            animation: slideInLeft 0.3s cubic-bezier(0.19, 1, 0.22, 1);
            box-shadow: 20px 0 60px rgba(0,0,0,0.5);
          }
          @keyframes slideInLeft {
            from { transform: translateX(-100%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
          }
          .history-header {
            padding: 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.07);
            display: flex; align-items: center; justify-content: space-between;
          }
          .history-title { font-family: var(--font-geist-sans), sans-serif; font-weight: 700; font-size: 16px; color: var(--text); }
          .history-list { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
          .history-list::-webkit-scrollbar { width: 6px; }
          .history-list::-webkit-scrollbar-track { background: transparent; border-radius: 3px; }
          .history-list::-webkit-scrollbar-thumb { background: var(--card-border); border-radius: 3px; }
          .history-list::-webkit-scrollbar-thumb:hover { background: var(--orange); }
          .history-item {
            padding: 12px; border-radius: 12px; background: var(--card);
            border: 1px solid var(--card-border); cursor: pointer; transition: all 0.2s;
            display: flex; flex-direction: column; gap: 8px; position: relative;
          }
          .history-item:hover { background: var(--surface-strong); border-color: var(--orange); }
          .history-item.active { background: var(--surface-strong); border-color: var(--text); }
          .history-item-prompt { font-size: 12px; color: var(--text); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; opacity: 0.8; }
          .history-item-thumbnails { display: flex; gap: 6px; align-items: center; }
          .history-thumb { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; background: rgba(255, 255, 255, 0.1); }
          .history-thumb-more { width: 40px; height: 40px; border-radius: 6px; background: rgba(255, 107, 43, 0.2); border: 1px solid rgba(255, 107, 43, 0.3); display: flex; align-items: center; justify-content: center; font-size: 11px; color: rgba(255, 107, 43, 0.9); font-weight: 600; }
          .history-item-date { position: absolute; bottom: 8px; right: 12px; font-size: 9px; color: rgba(255, 255, 255, 0.35); }
          
          /* -- INLINE EDIT OVERLAY -- */
          .inline-edit-overlay {
            position: absolute; inset: 0; z-index: 60;
            background: var(--panel); backdrop-filter: blur(12px);
            padding: 24px; display: flex; flex-direction: column; justify-content: center;
            border-radius: 14px;
          }
          .inline-edit-title {
            font-weight: 700; font-size: 13px; margin-bottom: 12px; color: var(--text); letter-spacing: 0.05em; text-transform: uppercase;
          }
          .inline-prompt-input {
            width: 100%; height: 100px; background: var(--surface);
            border-left: 2px solid var(--card-border); padding-left: 10px;
            color: var(--text); font-size: 13px; padding: 12px;
            font-family: inherit; resize: none; outline: none; transition: border-color .2s;
          }
          .inline-prompt-input:focus { border-color: rgba(255, 255, 255, 0.3); }
          .inline-edit-actions {
            display: flex; gap: 8px; margin-top: 14px;
          }
          .inline-btn {
            flex: 1; padding: 10px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; display: flex; align-items: center; justify-content: center; transition: all 0.2s;
          }
          .inline-btn.cancel {
            background: rgba(255, 255, 255, 0.1); color: #fff;
          }
          .inline-btn.cancel:hover { background: rgba(255, 255, 255, 0.15); }
          .inline-btn.cancel:disabled { opacity: 0.5; cursor: not-allowed; }
          .inline-btn.generate {
            background: var(--orange); color: #fff;
          }
          .inline-btn.generate:hover { opacity: 0.9; }
          .inline-btn.generate:disabled { opacity: 0.5; cursor: not-allowed; }
          
          .inline-edit-loading {
            position: absolute; inset: 0; z-index: 70; border-radius: 14px;
            background: rgba(5, 5, 8, 0.85); backdrop-filter: blur(4px);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
          }

          .studio-prompt-textarea {
            width: 100%; background: var(--surface);
            border: 1px solid var(--card-border); border-radius: 12px;
            color: var(--text); font-size: 13px; padding: 12px;
            font-family: inherit; resize: none; min-height: 100px;
            outline: none; transition: border-color .2s;
            scrollbar-width: none;
            scrollbar-color: transparent transparent;
          }
          .studio-prompt-textarea:focus { border-color: var(--orange); }
          .studio-prompt-textarea::-webkit-scrollbar { width: 0px; }
          .studio-prompt-textarea:hover,
          .studio-prompt-textarea:focus {
            scrollbar-width: thin;
            scrollbar-color: var(--card-border) transparent;
          }
          .studio-prompt-textarea:hover::-webkit-scrollbar,
          .studio-prompt-textarea:focus::-webkit-scrollbar {
            width: 4px;
          }
          .studio-prompt-textarea:hover::-webkit-scrollbar-track,
          .studio-prompt-textarea:focus::-webkit-scrollbar-track {
            background: transparent;
          }
          .studio-prompt-textarea:hover::-webkit-scrollbar-thumb,
          .studio-prompt-textarea:focus::-webkit-scrollbar-thumb {
            background: var(--card-border);
            border-radius: 999px;
          }

          .sb-section-label { font-size: 11px; font-weight: 500; color: var(--dim); text-transform: uppercase; letter-spacing: .1em; margin-bottom: 6px; display: block; }
          .sb-generate-btn {
            width: 100%; padding: 12px; border-radius: 12px; border: none; cursor: pointer;
            background: var(--orange);
            color: #fff; font-family: var(--font-geist-sans), sans-serif; font-size: 14px; font-weight: 700;
            transition: all 0.2s; box-shadow: 0 4px 15px rgba(255, 107, 43, 0.2);
            margin-top: auto;
          }
          .sb-generate-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(255, 107, 43, 0.4); }
          
          .sb-ref-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
          .sb-ref-btn {
            display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 10px 4px;
            background: var(--surface); border: 1px dashed var(--card-border);
            border-radius: 10px; color: var(--text); cursor: pointer; font-size: 9px; transition: all 0.2s;
          }
          .sb-ref-btn:hover { background: var(--surface-strong); color: var(--text); border-color: var(--card-border); }
          .sb-ref-btn.has-value { background: var(--surface-strong); border-color: var(--card-border); color: var(--text); border-style: solid; }
          
          .sb-chips-wrap { display: flex; flex-wrap: wrap; gap: 14px; }
          .sb-chip {
            padding: 3px 8px; border-radius: 20px; font-size: 10px;
            background: var(--surface); border: 1px solid var(--card-border);
            color: var(--text); cursor: pointer; display: flex; align-items: center; gap: 4px;
            margin-bottom: 3px;
          }
          .sb-chip-x { opacity: 0.5; }
          .sb-chip-x:hover { opacity: 1; }

          .clear-all-pill {
            display: inline-flex !important;
            align-items: center;
            padding: 6px 12px !important;
            border-radius: 20px !important;
            background: rgba(220, 50, 50, 0.15) !important;
            border: 1px solid rgba(220, 50, 50, 0.3) !important;
            color: #ff5a5a !important;
            font-size: 11px !important;
            cursor: pointer;
            font-weight: 700 !important;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            transition: all 0.2s ease;
          }
          .clear-all-pill:hover {
            background: rgba(220, 50, 50, 0.35) !important;
            border-color: rgba(220, 50, 50, 0.6) !important;
            transform: scale(1.05);
          }

          .sb-model-card {
            background: var(--surface); border: 1px solid var(--card-border); border-radius: 10px; padding: 10px 12px;
            display: flex; align-items: center; justify-content: space-between;
            color: var(--text); cursor: pointer; transition: all 0.2s;
          }
          .sb-model-card:hover { background: var(--surface-strong); border-color: var(--card-border); }
          .sb-model-info { display: flex; align-items: center; gap: 6px; }
          .sb-model-icon { width: 14px; height: 14px; opacity: 0.6; }
          .sb-model-title { font-size: 12px; font-weight: 600; }
          .sb-model-badge { font-size: 9px; background: var(--surface-strong); padding: 1px 5px; border-radius: 6px; color: var(--text); }
          .sb-model-dropdown {
            position: absolute; top: calc(100% + 8px); left: 0; right: 0;
            background: var(--panel); border: 1px solid var(--card-border); border-radius: 12px; z-index: 500;
            box-shadow: 0 15px 50px rgba(0,0,0,0.8); 
            max-height: 180px; overflow-y: auto;
            animation: fadeUp 0.15s ease-out;
          }
          .sb-model-dropdown::-webkit-scrollbar { width: 4px; }
          .sb-model-dropdown::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.2); border-radius: 10px; }
          .sb-model-opt { padding: 8px 12px; font-size: 12px; color: var(--dim); transition: all 0.2s; cursor: pointer; }
          .sb-model-opt:hover { background: var(--surface); color: var(--text); }
          .sb-model-opt.active { background: var(--surface-strong); font-weight: 700; color: var(--text); }

          .studio-generating-overlay {
            position: fixed; inset: 0; z-index: 1000;
            background: rgba(5, 5, 8, 0.85); backdrop-filter: blur(10px);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
          }
          .fadeUp { animation: fadeUp 0.3s ease-out; }
          @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes tooltipPop { from { opacity: 0; transform: translate(-50%, -100%) scale(0.92); } to { opacity: 1; transform: translate(-50%, -100%) scale(1); } }

          /* -- NEW SIDEBAR STYLES -- */
          .sb-section-label {
            font-size:10px; font-weight:700; letter-spacing:.12em;
            text-transform:uppercase; color:var(--dim);
            margin-bottom:6px; display:block;
          }
          .sb-ref-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
          .sb-ref-btn {
            display:flex; flex-direction:column; align-items:center; gap:6px;
            padding:10px 6px;
            background:var(--surface);
            border:1px dashed var(--card-border);
            border-radius:12px; cursor:pointer; color:var(--text);
            font-size:11px; font-family:inherit;
            transition:all .2s;
          }
          .sb-ref-btn:hover { background:var(--surface-strong); color:var(--text); border-color:var(--card-border); }
          .sb-ref-btn.has-value { border-style:solid; border-color:var(--card-border); background:var(--surface); color:var(--text); }
          .sb-ref-btn-icon { font-size:18px; line-height:1; }
          .sb-prompt-textarea {
            width:100%; background:var(--surface);
            border:1px solid var(--card-border); border-radius:12px;
            color:var(--text); font-size:12px; padding:12px 36px 10px 12px;
            font-family:inherit; resize:vertical; min-height:80px;
            outline:none; line-height:1.5;
            transition:border-color .2s, scrollbar-color .2s, scrollbar-width .2s;
            scrollbar-width: none;
            scrollbar-color: transparent transparent;
          }
          .sb-prompt-textarea:focus { border-color:var(--card-border); }
          .sb-prompt-textarea::-webkit-scrollbar { width: 0px; }
          .sb-prompt-textarea:hover,
          .sb-prompt-textarea:focus {
            scrollbar-width: thin;
            scrollbar-color: rgba(0,0,0,0.24) transparent;
          }
          .sb-prompt-textarea:hover::-webkit-scrollbar,
          .sb-prompt-textarea:focus::-webkit-scrollbar {
            width: 4px;
          }
          .sb-prompt-textarea:hover::-webkit-scrollbar-track,
          .sb-prompt-textarea:focus::-webkit-scrollbar-track {
            background: transparent;
          }
          .sb-prompt-textarea:hover::-webkit-scrollbar-thumb,
          .sb-prompt-textarea:focus::-webkit-scrollbar-thumb {
            background: rgba(0,0,0,0.24);
            border-radius: 999px;
          }

          /* -- MODEL SELECT STYLE -- */
          .sb-upgrade-link { font-size: 12px; color: #64748b; margin-top: 10px; }
          .sb-upgrade-link .upgrade-text {
            color: var(--orange); font-weight: 700; text-decoration: none;
            cursor: pointer; border-bottom: 1px solid rgba(255, 107, 43, 0.3);
          }

          .sb-chip {
            font-size:11px; padding:4px 10px; border-radius:12px;
            background:var(--surface); border:1px solid var(--card-border);
            color:var(--text); cursor:pointer; font-family:inherit;
            transition:all .15s; display:flex; align-items:center; gap:5px;
          }
          .sb-chip:hover { background:var(--surface-strong); border-color:var(--card-border); color:var(--text); }
          .sb-chip.active { background:var(--surface-strong); border-color:var(--card-border); color:var(--text); }
          .sb-chip-x { opacity:.6; font-size:9px; }
          .sb-chip-x:hover { opacity:1; }
          .sb-generate-btn {
            width:100%; padding:14px; border-radius:12px; border:none; cursor:pointer;
            background:var(--orange);
            color:#fff; font-family:var(--font-geist-sans),sans-serif; font-size:15px; font-weight:700;
            letter-spacing:.02em;
            transition:opacity .2s, transform .1s;
            margin-top:auto; box-shadow:0 4px 20px rgba(255,107,43,0.35);
          }
          .sb-generate-btn:hover { opacity:.88; transform:translateY(-1px); }

          /* -- SMART BAR (Style Suggestions) -- */
          .smart-bar {
            width: 100%; max-width: 900px;
            background: var(--card-bg);
            border: 1px solid rgba(255, 107, 43, 0.3);
            border-radius: 14px;
            padding: 16px 20px;
            margin-bottom: 16px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
            animation: fadeUp 0.3s ease;
          }
          .smart-bar-header {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 10px;
          }
          .smart-bar-title {
            font-size: 13px; font-weight: 700;
            color: #FF6B2B;
            display: flex; align-items: center; gap: 6px;
          }
          .smart-bar-dismiss {
            background: none;
            border: none;
            color: var(--dim);
            font-size: 18px;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: all 0.15s;
          }
          .smart-bar-dismiss:hover {
            color: var(--text);
          }
          .smart-bar-reason {
            font-size: 12px;
            color: var(--text);
            opacity: 0.85;
            margin-bottom: 12px;
            line-height: 1.4;
            border-left: 2px solid rgba(255, 107, 43, 0.4);
            padding-left: 10px;
            font-style: italic;
          }
          .smart-bar-chips {
            display: flex; flex-wrap: wrap; gap: 8px;
            margin-bottom: 14px;
          }
          .smart-bar-chip {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 6px 12px;
            background: var(--surface-strong);
            border: 1px solid rgba(255, 107, 43, 0.25);
            border-radius: 10px;
            font-size: 11px;
            transition: all 0.15s;
          }
          .smart-bar-chip-cat {
            color: var(--dim);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-size: 9px;
          }
          .smart-bar-chip-val {
            color: var(--text);
            font-weight: 600;
          }
          .smart-bar-chip:hover {
            background: rgba(255, 107, 43, 0.15);
            border-color: rgba(255, 107, 43, 0.35);
          }
          .smart-bar-apply {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 8px 16px;
            background: linear-gradient(135deg, #FF6B2B, #ff9066);
            border: none;
            border-radius: 20px;
            color: #fff;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
          }
          .smart-bar-apply:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(255, 107, 43, 0.3);
          }

          /* -- CONFIG MODAL -- */
          .cfg-backdrop {
            position:fixed; inset:0; z-index:10000;
            background:rgba(0,0,0,0.28); backdrop-filter:blur(10px);
            display:flex; align-items:center; justify-content:center;
          }
          .cfg-modal {
            width:1000px; max-width:96vw; height:750px; max-height:90vh;
            background:var(--panel);
            border:1px solid var(--card-border);
            border-radius:12px; display:flex; overflow:hidden;
            box-shadow:0 20px 60px rgba(0,0,0,0.7);
          }
          .cfg-sidebar {
            width:200px; border-right:1px solid var(--card-border);
            padding:20px 12px; display:flex; flex-direction:column; gap:4px;
            overflow-y:auto;
          }
          .cfg-sidebar::-webkit-scrollbar { width:3px; }
          .cfg-sidebar::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.16); border-radius:3px; }
          .cfg-cat-btn {
            text-align:left; padding:9px 12px; border-radius:9px;
            background:transparent; border:none; color:var(--dim);
            font-size:12px; font-family:inherit; cursor:pointer;
            transition:all .15s;
          }
          .cfg-cat-btn:hover { background:var(--surface); color:var(--text); }
          .cfg-cat-btn.active { background:var(--surface-strong); color:var(--text); }
          .cfg-main {
            flex:1; padding:30px; overflow-y:auto; display:flex; flex-direction:column; gap:14px;
          }
          .cfg-main::-webkit-scrollbar { width:3px; }
          .cfg-main::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.16); border-radius:3px; }
          .cfg-title { font-family:var(--font-geist-sans),sans-serif; font-size:16px; font-weight:600; color:var(--text); }
          .cfg-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:16px; }
          .cfg-thumb {
            border-radius:12px; overflow:hidden; cursor:pointer;
            border:2px solid transparent; transition:all .15s;
            background:var(--surface);
          }
          .cfg-thumb:hover { border-color:var(--card-border); }
          .cfg-thumb.selected { border-color:var(--text); box-shadow:0 0 0 1px rgba(0,0,0,0.1); }
          .cfg-thumb-visual { height:140px; overflow:hidden; }
          .cfg-thumb-name { font-size:11px; padding:5px 7px 6px; color:var(--dim); font-family:inherit; }
          .cfg-thumb.selected .cfg-thumb-name { color:var(--text); }
          .cfg-close {
            margin-left:auto; background:var(--surface);
            border:1px solid var(--card-border); border-radius:8px;
            color:var(--dim); cursor:pointer; padding:5px 12px;
            font-size:12px; font-family:inherit; transition:all .15s;
          }
          .cfg-close:hover { background:var(--surface-strong); color:var(--text); }
          .carousel-shell {
            position: relative;
            width: 100%;
            max-width: 1100px;
            overflow: visible;
            isolation: isolate;
            margin: 0 auto;
          }
          .carousel-wrap {
            overflow: hidden;
            padding: 0 64px;
            max-width: 100%;
            position: relative;
            contain: content;
          }
          .carousel-fade {
            position: absolute;
            top: 0; bottom: 0; width: 100px;
            z-index: 5; pointer-events: none;
          }
          .carousel-fade-left {
            left: 0;
            background: linear-gradient(to right, var(--bg) 0%, transparent 100%);
          }
          .carousel-fade-right {
            right: 0;
            background: linear-gradient(to left, var(--bg) 0%, transparent 100%);
          }




          .carousel-nav-btn {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            z-index: 1000;
            width: 56px;
            height: 56px;
            border-radius: 999px;
            border: 2px solid var(--orange);
            background: var(--panel);
            color: var(--text);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            backdrop-filter: blur(12px);
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            opacity: 1 !important;
            pointer-events: auto !important;
            font-size: 28px;
            font-weight: 900;
            transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          }

          .carousel-nav-btn.prev { left: 12px; }
          .carousel-nav-btn.next { right: 12px; }
          .carousel-shell:hover .carousel-nav-btn {
            opacity: 1;
            pointer-events: auto;
          }
          .carousel-nav-btn:hover {
            background: var(--surface-strong);
            border-color: var(--card-border);
            color: var(--text);
          }
          .edit-gen-skeleton {
            width: 100%; aspect-ratio: 1; background: rgba(255,255,255,0.03);
            border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 12px; color: var(--dim);
          }
        `}</style>
        <div className="studio-root" style={{ background: 'var(--bg)', color: 'var(--text)', '--sidebar-width': editPanelImg !== null ? '0px' : `${sidebarWidth}px`, overflow: editPanelImg !== null ? 'visible' : 'hidden' } as any}>
          {/* LEFT SIDEBAR - reference-inspired layout */}
          {editPanelImg === null && (
            <div className="studio-sidebar studio-scroll-region">
              <div 
                className={`studio-resizer ${isResizing ? 'resizing' : ''}`} 
                onMouseDown={() => setIsResizing(true)}
              />

              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'visible' }}>
                {/* Scrollable content area — overflow:visible lets absolute-positioned dropdowns escape the container */}
                <div className="studio-scroll-region" style={{ flex: 1, overflow: 'visible', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 24 }}>
                  
                  {/* GENERATION RECOVERY TOAST */}
                  {pendingJobToast && (
                    <div style={{
                      background: pendingJobToast.startsWith('✓') ? 'rgba(60,200,100,0.12)' : 'rgba(255,165,0,0.12)',
                      border: `1px solid ${pendingJobToast.startsWith('✓') ? 'rgba(60,200,100,0.35)' : 'rgba(255,165,0,0.35)'}`,
                      borderRadius: 10, padding: '10px 12px',
                      display: 'flex', alignItems: 'flex-start', gap: 8
                    }}>
                      {pendingJobToast.startsWith('✓') ? (
                        <span style={{ fontSize: 14, flexShrink: 0 }}>✓</span>
                      ) : (
                        <div className="gen-spinner" style={{ width: 12, height: 12, borderWidth: 1.5, flexShrink: 0, marginTop: 2 }} />
                      )}
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5, flex: 1 }}>{pendingJobToast}</span>
                      <button onClick={() => setPendingJobToast(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12, flexShrink: 0, paddingTop: 0 }}>×</button>
                    </div>
                  )}

                  {/* MODEL */}
                  <div className="studio-drop-wrap" style={{ position: 'relative' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      Model
                    </div>
                    {/* Trigger button — shows selected model(s) summary */}
                    <div
                      onClick={(e) => { e.stopPropagation(); setModelSelectOpen(!modelSelectOpen); setStudioRatioOpen(false); setStudioQualOpen(false); }}
                      style={{ background: 'var(--surface)', border: `1px solid ${modelSelectOpen ? 'var(--orange)' : 'var(--card-border)'}`, borderRadius: 100, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: 14, color: 'var(--text)', transition: 'all 0.2s', fontWeight: 600 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-strong)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: selectedModels.length >= 2 ? 'linear-gradient(135deg,#ff6b2b,#facc15)' : '#ff6b2b', flexShrink: 0 }}></span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedModels.length === 0 ? 'Nanobanana 2'
                            : selectedModels.length === 1 ? selectedModels[0]
                            : selectedModels.length === 2 ? `${selectedModels[0]} + ${selectedModels[1]}`
                            : `${selectedModels[0]} + ${selectedModels.length - 1} more`}
                        </span>
                        {selectedModels.length >= 2 && (
                          <span style={{ fontSize: 10, background: 'rgba(255,107,43,0.15)', color: 'var(--orange)', border: '1px solid rgba(255,107,43,0.3)', borderRadius: 6, padding: '1px 6px', fontWeight: 700, flexShrink: 0 }}>
                            {selectedModels.length} models
                          </span>
                        )}
                      </div>
                      <svg viewBox="0 0 10 6" fill="none" width="12" height="7" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: modelSelectOpen ? 'rotate(180deg)' : 'none' }}><path d="M1 1l4 4 4-4" stroke="var(--dim)" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </div>
                    {/* Multi-select Model Dropdown Panel */}
                    {modelSelectOpen && (
                      <div className="studio-rq-panel" style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 1000, padding: '6px', minWidth: 220 }}>
                        <div style={{ padding: '6px 8px 4px', fontSize: 10, fontWeight: 700, color: 'var(--dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Select Models (Run Parallel)</div>
                        {INTEGRATED_MODELS.map(m => {
                          const isChecked = selectedModels.includes(m);
                          return (
                            <div
                              key={m}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedModels(prev => {
                                  if (isChecked) {
                                    // Prevent deselecting the last model
                                    return prev.length > 1 ? prev.filter(x => x !== m) : prev;
                                  }
                                  return [...prev, m];
                                });
                              }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, cursor: 'pointer',
                                background: isChecked ? 'rgba(255,107,43,0.08)' : 'transparent',
                                border: `1px solid ${isChecked ? 'rgba(255,107,43,0.25)' : 'transparent'}`,
                                color: isChecked ? 'var(--text)' : 'var(--dim)',
                                transition: 'all 0.15s', marginBottom: 2, fontWeight: isChecked ? 600 : 400, fontSize: 13
                              }}
                              onMouseEnter={e => { if (!isChecked) e.currentTarget.style.background = 'var(--surface-strong)'; }}
                              onMouseOut={e => { if (!isChecked) e.currentTarget.style.background = 'transparent'; }}
                            >
                              <div style={{
                                width: 16, height: 16, borderRadius: 5, border: `1.5px solid ${isChecked ? 'var(--orange)' : 'var(--card-border)'}`,
                                background: isChecked ? 'var(--orange)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s'
                              }}>
                                {isChecked && <svg width="9" height="9" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                              </div>
                              <span style={{ flex: 1 }}>{m}</span>
                            </div>
                          );
                        })}
                        {selectedModels.length >= 2 && (
                          <div style={{ margin: '6px 4px 2px', padding: '7px 10px', borderRadius: 8, background: 'rgba(255,107,43,0.06)', border: '1px solid rgba(255,107,43,0.15)', fontSize: 11, color: 'var(--orange)', lineHeight: 1.5 }}>
                            ✦ Parallel generation — results appear side-by-side
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* REFERENCES */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>References</div>
                      <div style={{ fontSize: 12, color: 'var(--dim)', fontWeight: 600 }}>
                        {Object.entries(selections).filter(([catKey, id]) => !!(cats as any)[catKey]?.find((i: any) => i.id === id)).length + uploadedFiles.length}/9
                      </div>
                    </div>

                    {/* Row: Style button + selected style cards + Add button */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>

                      {/* Style trigger button — always original look */}
                      <button
                        onClick={() => { setConfigModalCat('style'); setConfigModalOpen(true); }}
                        style={{
                          width: 72, height: 72, flexShrink: 0,
                          background: 'var(--surface)',
                          border: '1px solid var(--card-border)',
                          borderRadius: 12, display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 6,
                          color: 'var(--text)', cursor: 'pointer', transition: 'all 0.2s',
                          position: 'relative'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-strong)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Style</span>
                        {(() => {
                          const validCount = Object.entries(selections).filter(([catKey, id]) => !!(cats as any)[catKey]?.find((i: any) => i.id === id)).length;
                          return validCount > 0 ? (
                            <div style={{
                              position: 'absolute', top: -6, right: -6,
                              width: 18, height: 18, borderRadius: '50%',
                              background: 'var(--orange)', color: '#fff',
                              fontSize: 10, fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                              {validCount}
                            </div>
                          ) : null;
                        })()}
                      </button>

                      {/* Selected style preset cards — shown inline as thumbnail previews like the modal */}
                      {Object.entries(selections).map(([catKey, id]) => {
                        const item = (cats as any)[catKey]?.find((i: any) => i.id === id);
                        if (!item) return null;
                        return (
                          <div
                            key={catKey}
                            style={{
                              position: 'relative', width: 72, height: 72, flexShrink: 0,
                              borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                              border: '2px solid var(--orange)',
                              background: 'var(--surface)',
                              transition: 'transform 0.15s, box-shadow 0.15s'
                            }}
                            onClick={() => { setConfigModalCat(catKey); setConfigModalOpen(true); }}
                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.05)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 14px rgba(255,107,43,0.35)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
                          >
                            {/* Preview image — same source as the modal */}
                            <img
                              src={item.img}
                              alt={item.label}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            />
                            {/* Dark gradient overlay with label */}
                            <div style={{
                              position: 'absolute', inset: 0,
                              background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.1) 55%, transparent 100%)',
                              display: 'flex', flexDirection: 'column',
                              justifyContent: 'flex-end', padding: '5px 5px 5px'
                            }}>
                              <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', lineHeight: 1.2, textShadow: '0 1px 3px rgba(0,0,0,0.8)', wordBreak: 'break-word' }}>
                                {item.label}
                              </span>
                            </div>
                            {/* Remove ✕ */}
                            <button
                              onClick={e => { e.stopPropagation(); removeChip(catKey); }}
                              style={{
                                position: 'absolute', top: 4, right: 4,
                                width: 16, height: 16, borderRadius: '50%',
                                background: 'rgba(0,0,0,0.65)', border: 'none',
                                color: '#fff', cursor: 'pointer', fontSize: 9, fontWeight: 700,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                lineHeight: 1
                              }}
                            >×</button>
                          </div>
                        );
                      })}

                      {/* Add / Upload image button */}
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        style={{
                          width: 72, height: 72, flexShrink: 0,
                          background: 'transparent', border: '1.5px dashed var(--dim)',
                          borderRadius: 12, display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 6,
                          color: 'var(--dim)', cursor: 'pointer', transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text)'; e.currentTarget.style.color = 'var(--text)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--dim)'; e.currentTarget.style.color = 'var(--dim)'; }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="22" height="22"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Add</span>
                      </button>

                    </div>

                    {/* Uploaded image files */}
                    {uploadedFiles.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                        {uploadedFiles.map((f, idx) => (
                          <div key={idx} style={{ position: 'relative', width: 52, height: 52 }}>
                            <img
                              src={URL.createObjectURL(f)}
                              style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--card-border)' }}
                              alt={f.name}
                            />
                            <button
                              onClick={() => setUploadedFiles(prev => prev.filter((_, fileIdx) => fileIdx !== idx))}
                              style={{
                                position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%',
                                background: 'rgba(220,50,50,0.85)', border: 'none', color: '#fff', cursor: 'pointer',
                                fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold'
                              }}
                            >×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* PROMPT */}
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>Prompt</div>
                    <div style={{ position: 'relative' }}>
                      <textarea 
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        placeholder="Place the tote bag in the sand on a beach."
                        style={{ 
                          width: '100%', height: 180, background: 'var(--surface)', 
                          border: '1px solid var(--card-border)', borderRadius: 16, 
                          padding: '16px 40px 16px 16px', color: 'var(--text)', 
                          fontSize: 14, fontFamily: 'inherit', resize: 'none',
                          overflowY: 'auto' 
                        }}
                      />
                      {prompt.length > 0 && (
                        <CopyButton
                          value={prompt} size="sm" data-tooltip="Copy prompt"
                          style={{ 
                            position: 'absolute', top: 12, right: 12, 
                            background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', 
                            border: `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'}`, 
                            width: '28px', height: '28px', borderRadius: '8px', color: isDark ? '#fff' : '#000',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                          }}
                        />
                      )}
                    </div>
                  </div>

                  {/* DUAL CONFIG ROW: Generations & Aspect Ratio side-by-side */}
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: 20 }}>
                    {/* Generations stepper */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Generations</div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--surface-strong)',
                        border: '1px solid var(--card-border)',
                        borderRadius: '100px',
                        padding: '4px 8px',
                        height: '38px',
                        width: '100%'
                      }}>
                        <button 
                          onClick={() => setNumGenerations(prev => Math.max(1, prev - 1))}
                          disabled={numGenerations <= 1}
                          style={{
                            background: 'none', border: 'none', color: 'var(--text)',
                            fontSize: '15px', fontWeight: 700,
                            cursor: numGenerations <= 1 ? 'not-allowed' : 'pointer',
                            opacity: numGenerations <= 1 ? 0.3 : 0.8,
                            padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}
                        >
                          −
                        </button>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>
                          {numGenerations}
                        </span>
                        <button 
                          onClick={() => setNumGenerations(prev => Math.min(4, prev + 1))}
                          disabled={numGenerations >= 4}
                          style={{
                            background: 'none', border: 'none', color: 'var(--text)',
                            fontSize: '15px', fontWeight: 700,
                            cursor: numGenerations >= 4 ? 'not-allowed' : 'pointer',
                            opacity: numGenerations >= 4 ? 0.3 : 0.8,
                            padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Aspect Ratio popover dropdown */}
                    <div className="studio-drop-wrap" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Aspect ratio</div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setStudioRatioOpen(!studioRatioOpen); setModelSelectOpen(false); setStudioQualOpen(false); }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          background: 'var(--surface-strong)',
                          border: '1px solid var(--card-border)',
                          borderRadius: '100px',
                          padding: '4px 14px',
                          height: '38px',
                          width: '100%',
                          cursor: 'pointer',
                          color: 'var(--text)',
                          fontSize: '13px',
                          fontWeight: 700,
                          transition: 'border-color 0.2s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--card-border)'}
                      >
                        <div 
                          className="border-[1.5px] rounded-[2px] opacity-80"
                          style={{ 
                            width: `${(ratio.svgW || 30) * 0.35}px`, 
                            height: `${(ratio.svgH || 30) * 0.35}px`, 
                            borderColor: 'currentColor',
                            display: 'inline-block'
                          }}
                        />
                        <span>{ratio.id}</span>
                      </button>
                      {studioRatioOpen && (
                        <div 
                          className="absolute top-full mt-2 rounded-2xl p-4 shadow-2xl z-[1000] w-full max-h-[350px] overflow-y-auto"
                          style={{ 
                            background: 'var(--panel)', 
                            border: '1px solid var(--card-border)', 
                            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
                            right: 0,
                            minWidth: '280px'
                          }}
                        >
                          <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3 px-1">Aspect Ratio</div>
                          <div className="grid grid-cols-3 gap-2 pr-1">
                            {ratioData.map(r => (
                              <div 
                                key={r.id} 
                                className={`flex flex-col items-center justify-center p-2.5 rounded-xl cursor-pointer border text-center transition-all ${
                                  ratio.id === r.id 
                                    ? 'bg-[#f95738]/10 border-[#f95738] text-[#f95738]' 
                                    : 'border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 hover:border-gray-300 dark:hover:border-zinc-700'
                                }`} 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRatio(r);
                                  setStudioRatioOpen(false);
                                }}
                              >
                                {/* Visual Ratio Box */}
                                <div className={`w-9 h-9 flex items-center justify-center mb-1 bg-black/5 dark:bg-white/5 rounded-lg transition-colors ${ratio.id === r.id ? 'text-[#f95738]' : 'text-gray-400 dark:text-gray-500'}`}>
                                  <div 
                                    className="border-[1.5px] rounded-[3px]"
                                    style={{ 
                                      width: `${(r.svgW || 30) * 0.55}px`, 
                                      height: `${(r.svgH || 30) * 0.55}px`, 
                                      borderColor: 'currentColor'
                                    }}
                                  />
                                </div>
                                <span className={`text-[11px] font-bold ${ratio.id === r.id ? 'text-[#f95738]' : 'text-gray-900 dark:text-white'}`}>{r.id}</span>
                                <span className="text-[9px] text-gray-400 dark:text-gray-500 truncate w-full mt-0.5">{r.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* SETTINGS (Quality) */}
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>Quality</div>
                    <div className="studio-drop-wrap" style={{ position: 'relative' }}>
                      <button onClick={(e) => { e.stopPropagation(); setStudioQualOpen(!studioQualOpen); setModelSelectOpen(false); setStudioRatioOpen(false); }}
                        style={{ width: '100%', background: 'var(--surface-strong)', border: '1px solid var(--card-border)', borderRadius: 100, padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: 13, color: 'var(--text)', fontWeight: 700, height: '38px' }}>
                        <span>{quality.id}</span>
                        <svg viewBox="0 0 10 6" fill="none" width="10" height="6"><path d="M1 1l4 4 4-4" stroke="var(--dim)" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      </button>
                      {studioQualOpen && (
                        <div className="studio-rq-panel" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, marginTop: 6 }}>
                          {qualityData.map(q => (
                            <div key={q.id} className={`studio-rq-opt ${quality.id === q.id ? 'active' : ''}`}
                              onClick={(e) => { e.stopPropagation(); setQuality(q); setStudioQualOpen(false); }}>
                              {q.icon} {q.id}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* GENERATE / STOP BUTTON */}
                <div style={{ paddingTop: 16, borderTop: '1px solid var(--card-border)', marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {generating ? (
                    /* ── STOP button (shown while generating) ── */
                    <button
                      onClick={stopGeneration}
                      style={{
                        width: '100%', padding: '18px', borderRadius: 100, border: '2px solid rgba(239,68,68,0.6)',
                        background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                        fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', gap: 10, cursor: 'pointer',
                        transition: 'all 0.2s', boxShadow: '0 0 0 0 rgba(239,68,68,0.3)',
                        animation: 'stopPulse 2s ease-in-out infinite'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(239,68,68,0.22)';
                        e.currentTarget.style.borderColor = 'rgba(239,68,68,0.9)';
                        e.currentTarget.style.transform = 'scale(1.02)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
                        e.currentTarget.style.borderColor = 'rgba(239,68,68,0.6)';
                        e.currentTarget.style.transform = 'scale(1)';
                      }}
                    >
                      {/* Stop square icon */}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="4" y="4" width="16" height="16" rx="3"/>
                      </svg>
                      Stop Generation
                    </button>
                  ) : (
                    /* ── GENERATE button (shown when idle) ── */
                    <button
                      onClick={() => generate()}
                      disabled={!prompt.trim()}
                      style={{
                        width: '100%',
                        background: isTweaking ? 'var(--orange)' : (isDark ? '#fff' : '#000'),
                        color: isTweaking ? '#fff' : (isDark ? '#000' : '#fff'),
                        padding: '18px', borderRadius: 100, border: 'none', fontSize: 18, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                        cursor: prompt.trim() ? 'pointer' : 'not-allowed',
                        opacity: prompt.trim() ? 1 : 0.5,
                        transition: 'transform 0.2s, opacity 0.2s, background 0.2s',
                        boxShadow: isTweaking ? '0 4px 20px rgba(255,107,43,0.4)' : '0 4px 15px rgba(0,0,0,0.15)'
                      }}
                      onMouseEnter={e => { if (prompt.trim()) e.currentTarget.style.transform = 'scale(1.02)'; }}
                      onMouseLeave={e => { if (prompt.trim()) e.currentTarget.style.transform = 'scale(1)'; }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="24" height="24" style={{ flexShrink: 0 }}>
                        {isTweaking ? (
                          <>
                            <path d="M12 20h9"/>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                          </>
                        ) : (
                          <>
                            <rect x="3" y="8" width="13" height="13" rx="3" />
                            <path d="M17 2c0 2.2-1.3 3.5-3.5 3.5 2.2 0 3.5 1.3 3.5 3.5 0-2.2 1.3-3.5 3.5-3.5-2.2 0-3.5-1.3-3.5-3.5z" fill="currentColor" stroke="none" />
                            <path d="M9 11c0 1.25-.75 2-2 2 1.25 0 2 .75 2 2 0-1.25 .75-2 2-2-1.25 0-2-.75-2-2z" fill="currentColor" stroke="none" />
                          </>
                        )}
                      </svg>
                      <span>{isTweaking ? 'Update & Generate' : 'Generate'}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* === FULL SCREEN EDIT WORKSPACE — flex sibling inside studio-root === */}
          {editPanelImg !== null && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'row',
              height: '88.89vh', overflow: 'hidden',
              background: 'var(--bg)', color: 'var(--text)',
              minWidth: 0, marginLeft: 0
            }}>

                {/* ── LEFT SIDEBAR: Edit Controls ── */}
                <div style={{
                  width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column',
                  background: 'var(--panel)', borderRight: '1px solid var(--card-border)',
                  height: '100%', overflow: 'visible', position: 'relative'
                }}>
                  {/* Sidebar Header */}
                  <div style={{
                    padding: '20px 20px 16px', borderBottom: '1px solid var(--card-border)', flexShrink: 0
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--orange)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" width="16" height="16" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Edit Image</div>
                          <div style={{ fontSize: 11, color: 'var(--dim)' }}>Describe what to change</div>
                        </div>
                      </div>
                      <button
                        onClick={() => { setEditPanelImg(null); setEditPrompt(''); setCameraInstruction(''); setCameraAngles({ rotate: 0, vertical: 0, zoom: 5 }); setCameraPopoverOpen(false); setRelightInstruction(''); setRelightPopoverOpen(false); setSkinEnhancerInstruction(''); setSkinEnhancerPopoverOpen(false); setEditRefFile(null); setEditRefAnalysis(null); setAcceptedRefChips({}); setEditAdvancedOpen(false); }}
                        style={{ background: 'var(--surface-strong)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12" strokeLinecap="round"><path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/></svg>
                        Back
                      </button>
                    </div>
                  </div>

                  {/* Sidebar Body - scrollable */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 20 }}>

                    {/* Step 1: Prompt */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--orange)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>1</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Describe the edit</span>
                      </div>
                      <textarea
                        placeholder="e.g. make the background blurry, add a sunset, change hair color to blonde..."
                        value={editPrompt}
                        onChange={e => setEditPrompt(e.target.value)}
                        disabled={editGenerating}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (editPrompt.trim() || editRefFile) generateEdit(true); } }}
                        rows={4}
                        style={{
                          width: '100%', resize: 'none', background: 'var(--surface)',
                          border: `1.5px solid ${editPrompt.trim() ? 'var(--orange)' : 'var(--card-border)'}`,
                          borderRadius: 12, padding: '12px 14px', fontSize: 13, color: 'var(--text)',
                          fontFamily: 'inherit', outline: 'none', lineHeight: 1.6,
                          transition: 'border-color 0.2s', boxSizing: 'border-box',
                          caretColor: 'var(--orange)'
                        }}
                      />
                      <div style={{ fontSize: 11, color: 'var(--dim)' }}>Press Enter to apply, Shift+Enter for new line</div>
                      {["angle", "from the left", "from the right", "from side", "from above", "from behind", "from below", "profile", "three-quarter", "three quarter", "low angle", "high angle", "top-down", "camera", "viewpoint", "perspective"].some(k => editPrompt.toLowerCase().includes(k)) && (
                        <div style={{ marginTop: 6, fontSize: 11, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                          <span>💡</span> Camera angle changes work best with specific direction, e.g. 'three-quarter view from stage left'
                        </div>
                      )}
                    </div>

                    {/* Step 2: Reference Image */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--surface-strong)', border: '1.5px solid var(--card-border)', color: 'var(--dim)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>2</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Reference image <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(optional)</span></span>
                      </div>
                      {editRefFile ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(255,107,43,0.07)', border: '1px solid rgba(255,107,43,0.25)', borderRadius: 10 }}>
                          <img src={URL.createObjectURL(editRefFile)} style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} alt="ref" />
                          <span style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editRefFile.name}</span>
                          <button onClick={() => setEditRefFile(null)} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => editRefInputRef.current?.click()}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                            background: 'var(--surface)', border: '1.5px dashed var(--card-border)',
                            borderRadius: 10, cursor: 'pointer', color: 'var(--dim)', fontSize: 12, fontWeight: 500,
                            transition: 'all 0.15s', width: '100%', boxSizing: 'border-box'
                          }}
                          onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--orange)'; e.currentTarget.style.color = 'var(--orange)'; }}
                          onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--card-border)'; e.currentTarget.style.color = 'var(--dim)'; }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                          Upload style reference...
                        </button>
                      )}
                      <input ref={editRefInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) setEditRefFile(f); }} />
                    </div>

                    {/* Step 3: Styles — visual thumbnail row same as generate page */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--surface-strong)', border: '1.5px solid var(--card-border)', color: 'var(--dim)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>3</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Style presets <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(optional)</span></span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {/* Style trigger button */}
                        <button
                          onClick={() => { setEditSelections(prev => Object.keys(prev).length === 0 ? { ...selections } : prev); setEditStyleModalOpen(true); }}
                          style={{
                            width: 64, height: 64, flexShrink: 0,
                            background: 'var(--surface)', border: '1px solid var(--card-border)',
                            borderRadius: 12, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 5,
                            color: 'var(--text)', cursor: 'pointer', transition: 'all 0.2s', position: 'relative'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-strong)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                          <span style={{ fontSize: 11, fontWeight: 600 }}>Style</span>
                          {(() => {
                            const vc = Object.entries(editSelections).filter(([ck, id]) => !!(cats as any)[ck]?.find((i: any) => i.id === id)).length;
                            return vc > 0 ? <div style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: 'var(--orange)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{vc}</div> : null;
                          })()}
                        </button>
                        
                        {/* Camera trigger button */}
                        <button
                          onClick={() => setCameraPopoverOpen(true)}
                          style={{
                            width: 64, height: 64, flexShrink: 0,
                            background: 'var(--surface)', border: '1px solid var(--card-border)',
                            borderRadius: 12, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 5,
                            color: 'var(--text)', cursor: 'pointer', transition: 'all 0.2s', position: 'relative'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-strong)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                          <span style={{ fontSize: 11, fontWeight: 600 }}>Camera</span>
                          {cameraInstruction && <div style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: 'var(--orange)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>}
                        </button>
                        {cameraPopoverOpen && (
                          <CameraControlPopover 
                            onApply={(inst, angles) => {
                              setCameraInstruction(inst);
                              if (angles) setCameraAngles(angles);
                            }}
                            onClose={() => setCameraPopoverOpen(false)}
                            imageUrl={editPanelImg !== null ? generatedImages[editPanelImg] : undefined}
                            initialRotate={cameraAngles.rotate}
                            initialVertical={cameraAngles.vertical}
                            initialZoom={cameraAngles.zoom}
                          />
                        )}

                        {/* Relight trigger button */}
                        <button
                          onClick={() => setRelightPopoverOpen(true)}
                          style={{
                            width: 64, height: 64, flexShrink: 0,
                            background: 'var(--surface)', border: '1px solid var(--card-border)',
                            borderRadius: 12, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 5,
                            color: 'var(--text)', cursor: 'pointer', transition: 'all 0.2s', position: 'relative'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-strong)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                          <span style={{ fontSize: 11, fontWeight: 600 }}>Relight</span>
                          {relightInstruction && <div style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: 'var(--orange)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>}
                        </button>
                        {relightPopoverOpen && (
                          <RelightControlPopover 
                            onApply={(inst) => setRelightInstruction(inst)}
                            onClose={() => setRelightPopoverOpen(false)}
                            imageUrl={editPanelImg !== null ? generatedImages[editPanelImg] : undefined}
                          />
                        )}

                        {/* Skin Enhancer trigger button */}
                        <button
                          onClick={() => setSkinEnhancerPopoverOpen(true)}
                          style={{
                            width: 64, height: 64, flexShrink: 0,
                            background: skinEnhancerInstruction ? 'rgba(245,166,35,0.12)' : 'var(--surface)',
                            border: skinEnhancerInstruction ? '1px solid rgba(245,166,35,0.5)' : '1px solid var(--card-border)',
                            borderRadius: 12, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 5,
                            color: skinEnhancerInstruction ? '#f5a623' : 'var(--text)',
                            cursor: 'pointer', transition: 'all 0.2s', position: 'relative'
                          }}
                          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = skinEnhancerInstruction ? 'rgba(245,166,35,0.18)' : 'var(--surface-strong)'}
                          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = skinEnhancerInstruction ? 'rgba(245,166,35,0.12)' : 'var(--surface)'}
                        >
                          {/* Crown icon */}
                          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                            <path d="M2 19l2-9 5 4 3-7 3 7 5-4 2 9H2zm0 0h20v2H2v-2z"/>
                          </svg>
                          <span style={{ fontSize: 11, fontWeight: 600 }}>Skin</span>
                          {skinEnhancerInstruction && <div style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: '#f5a623', color: '#1a1006', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>}
                        </button>
                        {skinEnhancerPopoverOpen && (
                          <SkinEnhancerPopover
                            onApply={(inst) => setSkinEnhancerInstruction(inst)}
                            onClose={() => setSkinEnhancerPopoverOpen(false)}
                          />
                        )}
                        
                        {/* Selected style thumbnail cards */}
                        {Object.entries(editSelections).map(([catKey, id]) => {
                          const item = (cats as any)[catKey]?.find((i: any) => i.id === id);
                          if (!item) return null;
                          return (
                            <div key={catKey} style={{
                              position: 'relative', width: 64, height: 64, flexShrink: 0,
                              borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                              border: '2px solid var(--orange)', background: 'var(--surface)',
                              transition: 'transform 0.15s'
                            }}
                              onClick={() => { setEditStyleModalOpen(true); }}
                              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.05)'}
                              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)'}
                            >
                              <img src={item.img} alt={item.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                              <div style={{
                                position: 'absolute', inset: 0,
                                background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 55%)',
                                display: 'flex', alignItems: 'flex-end', padding: '4px'
                              }}>
                                <span style={{ fontSize: 8, fontWeight: 800, color: '#fff', lineHeight: 1.2, textShadow: '0 1px 3px rgba(0,0,0,0.8)', wordBreak: 'break-word' }}>{item.label}</span>
                              </div>
                              <button onClick={e => { e.stopPropagation(); setEditSelections(prev => { const n = { ...prev }; delete n[catKey]; return n; }); }}
                                style={{ position: 'absolute', top: 3, right: 3, width: 15, height: 15, borderRadius: '50%', background: 'rgba(0,0,0,0.65)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              >×</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Step 4: Size & Quality */}
                    <div style={{ display: 'flex', gap: 10 }}>
                      {/* Ratio */}
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--surface-strong)', border: '1.5px solid var(--card-border)', color: 'var(--dim)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>4</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Size (Ratio)</span>
                        </div>
                        <div className="studio-drop-wrap" style={{ position: 'relative' }}>
                          <button
                            onClick={() => { setEditRatioOpen(!editRatioOpen); setEditQualOpen(false); setEditModelOpen(false); }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--card-border)', borderRadius: 10, fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}
                            onMouseOver={e => e.currentTarget.style.borderColor = 'var(--orange)'}
                            onMouseOut={e => e.currentTarget.style.borderColor = 'var(--card-border)'}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editRatio.id}</span>
                            <svg viewBox="0 0 10 6" fill="none" width="9" height="6" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: editRatioOpen ? 'rotate(180deg)' : 'none' }}><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                          </button>
                          {editRatioOpen && (
                            <div className="studio-rq-panel" style={{ position: 'absolute', bottom: 'calc(100% + 6px)', top: 'auto', left: 0, right: 0, zIndex: 9999 }}>
                              {ratioData.map(r => (
                                <div key={r.id} className={`studio-rq-opt ${editRatio.id === r.id ? 'active' : ''}`}
                                  onClick={e => { e.stopPropagation(); setEditRatio(r); setEditRatioOpen(false); }}>{r.id} ({r.name})</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Quality */}
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Quality</span>
                        </div>
                        <div className="studio-drop-wrap" style={{ position: 'relative' }}>
                          <button
                            onClick={() => { setEditQualOpen(!editQualOpen); setEditRatioOpen(false); setEditModelOpen(false); }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--card-border)', borderRadius: 10, fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}
                            onMouseOver={e => e.currentTarget.style.borderColor = 'var(--orange)'}
                            onMouseOut={e => e.currentTarget.style.borderColor = 'var(--card-border)'}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editQuality.id}</span>
                            <svg viewBox="0 0 10 6" fill="none" width="9" height="6" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: editQualOpen ? 'rotate(180deg)' : 'none' }}><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                          </button>
                          {editQualOpen && (
                            <div className="studio-rq-panel" style={{ position: 'absolute', bottom: 'calc(100% + 6px)', top: 'auto', left: 0, right: 0, zIndex: 9999 }}>
                              {qualityData.map(q => (
                                <div key={q.id} className={`studio-rq-opt ${editQuality.id === q.id ? 'active' : ''}`}
                                  onClick={e => { e.stopPropagation(); setEditQuality(q); setEditQualOpen(false); }}>{q.label}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Step 5: Model + Variations */}
                    <div style={{ display: 'flex', gap: 10 }}>
                      {/* Model */}
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--surface-strong)', border: '1.5px solid var(--card-border)', color: 'var(--dim)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>5</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Model</span>
                        </div>
                        {/* Interactive model selector dropdown — allows selecting ANY model when editing */}
                        <div className="studio-drop-wrap" style={{ position: 'relative' }}>
                          <button
                            onClick={() => { setEditModelOpen(!editModelOpen); setEditRatioOpen(false); setEditQualOpen(false); }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--card-border)', borderRadius: 10, fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}
                            onMouseOver={e => e.currentTarget.style.borderColor = 'var(--orange)'}
                            onMouseOut={e => e.currentTarget.style.borderColor = 'var(--card-border)'}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff6b2b', flexShrink: 0 }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedModels[0] || 'Nanobanana 2'}</span>
                            </div>
                            <svg viewBox="0 0 10 6" fill="none" width="9" height="6" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: editModelOpen ? 'rotate(180deg)' : 'none' }}><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                          </button>
                          {editModelOpen && (
                            <div className="studio-rq-panel" style={{ position: 'absolute', bottom: 'calc(100% + 6px)', top: 'auto', left: 0, right: 0, zIndex: 9999, maxHeight: 220, overflowY: 'auto' }}>
                              {AVAILABLE_MODELS.map(m => {
                                const isSel = selectedModels.includes(m);
                                return (
                                  <div key={m} className={`studio-rq-opt ${isSel ? 'active' : ''}`}
                                    onClick={e => {
                                      e.stopPropagation();
                                      setSelectedModels([m]);
                                      setEditModelOpen(false);
                                    }}
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', fontSize: 12, cursor: 'pointer' }}
                                  >
                                    <span>{m}</span>
                                    {isSel && <span style={{ fontSize: 12, color: 'var(--orange)' }}>✓</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Variations — +/- stepper like generate page */}
                      <div style={{ width: 100, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Variations</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--surface)', border: '1px solid var(--card-border)', borderRadius: 10, overflow: 'hidden' }}>
                          <button
                            onClick={() => setNumGenerations(Math.max(1, numGenerations - 1))}
                            style={{ width: 36, height: 40, border: 'none', background: 'transparent', color: 'var(--text)', fontSize: 18, fontWeight: 400, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-strong)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >−</button>
                          <span style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text)', userSelect: 'none' }}>{numGenerations}</span>
                          <button
                            onClick={() => setNumGenerations(Math.min(4, numGenerations + 1))}
                            style={{ width: 36, height: 40, border: 'none', background: 'transparent', color: 'var(--text)', fontSize: 18, fontWeight: 400, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-strong)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >+</button>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Sidebar Footer: Apply Edit + Make Final Quality Recovery */}
                  <div style={{ padding: '16px 20px', borderTop: '1px solid var(--card-border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <button
                      onClick={() => generateEdit(true)}
                      disabled={editGenerating || (!editPrompt.trim() && !editRefFile)}
                      style={{
                        width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                        background: (editPrompt.trim() || editRefFile) && !editGenerating ? 'var(--orange)' : 'var(--surface-strong)',
                        color: (editPrompt.trim() || editRefFile) && !editGenerating ? '#fff' : 'var(--dim)',
                        fontSize: 14, fontWeight: 700, cursor: (editPrompt.trim() || editRefFile) && !editGenerating ? 'pointer' : 'not-allowed',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        transition: 'all 0.18s',
                        boxShadow: (editPrompt.trim() || editRefFile) && !editGenerating ? '0 4px 16px rgba(255,107,43,0.3)' : 'none'
                      }}
                      onMouseOver={e => { if ((editPrompt.trim() || editRefFile) && !editGenerating) e.currentTarget.style.opacity = '0.9'; }}
                      onMouseOut={e => { e.currentTarget.style.opacity = '1'; }}
                    >
                      {editGenerating ? (
                        <><div className="gen-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Generating edit…</>
                      ) : (
                        <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Apply Edit</>
                      )}
                    </button>
                  </div>
                </div>

                {/* ── CENTER: Image Canvas ── */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 0, height: '100%', position: 'relative', background: 'var(--bg)', padding: '32px' }}>
                  {generatedImages[editPanelImg!] ? (
                    <img
                      src={generatedImages[editPanelImg!]}
                      alt="Editing"
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 14, boxShadow: '0 16px 56px rgba(0,0,0,0.18)' }}
                    />
                  ) : (
                    <div style={{ color: 'var(--dim)', fontSize: '14px' }}>Image loading or not available</div>
                  )}
                </div>

                {/* ── RIGHT: Generation Thumbnails strip ── */}
                <div style={{
                  width: 100, flexShrink: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', padding: '20px 10px', gap: 12,
                  overflowY: 'auto', background: 'var(--panel)',
                  borderLeft: '1px solid var(--card-border)'
                }}>
                  {generatedImages.map((imgSrc, i) => {
                    const isActive = i === editPanelImg;
                    return (
                      <div
                        key={i}
                        onClick={() => openEditPanel(i)}
                        title={`Generation ${i + 1}`}
                        style={{
                          width: 68, height: 68, borderRadius: 10, cursor: 'pointer',
                          overflow: 'hidden', background: 'var(--surface-strong)', flexShrink: 0,
                          border: isActive ? '2.5px solid var(--orange)' : '2px solid transparent',
                          boxShadow: isActive ? '0 4px 14px rgba(255,107,43,0.35)' : 'none',
                          transition: 'all 0.18s', position: 'relative'
                        }}
                      >
                        {imgSrc && <img src={imgSrc} alt={`Gen ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        {isActive && (
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,107,43,0.12)', pointerEvents: 'none' }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
          )}

          {/* === REGULAR GALLERY VIEW === */}
          {editPanelImg === null && (
          <div className="studio-main" style={{
            position: 'relative', zIndex: 1,
            display: 'flex', flexDirection: 'column',
            flex: 1, minWidth: 0, height: '88.89vh',
            overflow: 'auto',
            padding: '64px 32px 60px 32px'
          }}>
            {(() => {
              // Compute lineage history if in Focus Mode
              let focusIndices: number[] = [];
              if (focusMode && generatedImages.length > 0) {
                focusIndices.push(0); // Add latest
                let currentParentId = imageMetadata[0]?.parentSessionId;
                while (currentParentId) {
                  const parentIdx = imageMetadata.findIndex(m => m && m.sessionId === currentParentId);
                  if (parentIdx !== -1) {
                      focusIndices.unshift(parentIdx); // Prepend to show oldest first
                      currentParentId = imageMetadata[parentIdx]?.parentSessionId;
                    } else {
                      break;
                    }
                  }
                }

                const baseIndices = focusMode ? focusIndices : generatedImages.map((_, i) => i);
                const displayCards = baseIndices
                  .map((i) => ({
                    i,
                    src: generatedImages[i],
                    meta: imageMetadata[i],
                    // Show pending edit placeholders (empty URL) alongside completed images
                    available: Boolean(
                      (generatedImages[i] || imageMetadata[i]?.status === 'pending') &&
                      imageMetadata[i]?.status !== 'failed' &&
                      !failedImages.has(i)
                    )
                  }))
                  .filter(card => card.available);



                const formatGroupDate = (dateStr: string) => {
                  if (!dateStr) return 'Today';
                  try {
                    const d = new Date(dateStr);
                    const now = new Date();
                    if (d.toDateString() === now.toDateString()) return 'Today';
                    const yesterday = new Date(now);
                    yesterday.setDate(now.getDate() - 1);
                    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
                    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
                  } catch (_) {
                    return 'Today';
                  }
                };

                const groups: { [key: string]: typeof displayCards } = {};
                displayCards.forEach(card => {
                  const dateStr = (card.meta as any)?.created_at || (card.meta as any)?.createdAt;
                  const groupKey = formatGroupDate(dateStr);
                  if (!groups[groupKey]) {
                    groups[groupKey] = [];
                  }
                  groups[groupKey].push(card);
                });

                return (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '32px',
                      width: '100%'
                    }}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    {/* Skeletons for edit generation */}
                    {editGenerating && (
                      <div className="feed-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,107,43,0.04)', border: '1px dashed var(--orange)', borderRadius: '24px', minHeight: 250, gap: 12 }}>
                        <div className="gen-spinner" style={{ width: 32, height: 32, borderWidth: 2, borderColor: 'rgba(255,107,43,0.3)', borderTopColor: 'var(--orange)' }} />
                        <span style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 600 }}>GENERATING EDIT…</span>
                        <button
                          onClick={stopGeneration}
                          style={{
                            marginTop: 4, padding: '8px 22px', borderRadius: 100,
                            border: '1.5px solid rgba(239,68,68,0.6)', background: 'rgba(239,68,68,0.1)',
                            color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.18s'
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                          Stop
                        </button>
                      </div>
                    )}

                    {/* Skeletons for currently generating images — side-by-side for multi-model */}
                    {generating && selectedModels.length === 1 && (
                      <div className="feed-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--card-border)', borderRadius: '24px', minHeight: 250 }}>
                        <div className="gen-spinner" style={{ width: 32, height: 32, borderWidth: 2 }} />
                        <span style={{ fontSize: 12, color: 'var(--dim)', fontWeight: 600, marginTop: 12 }}>GENERATING VIA {(selectedModels[0] || '').toUpperCase()}…</span>
                      </div>
                    )}
                    {generating && selectedModels.length >= 2 && (
                      <div className="feed-card" style={{ padding: '20px 16px', border: '1px dashed var(--card-border)', borderRadius: '24px', background: 'rgba(255,255,255,0.01)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14, textAlign: 'center' }}>
                          Generating with {selectedModels.length} models in parallel…
                        </div>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          {selectedModels.map((m, idx) => (
                            <div key={`skel-${idx}`} style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 16, minHeight: 180, gap: 10, padding: '20px 12px' }}>
                              <div className="gen-spinner" style={{ width: 28, height: 28, borderWidth: 2 }} />
                              <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 600, textAlign: 'center' }}>VIA {m.toUpperCase()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {displayCards.length === 0 && !generating && (
                      <div style={{
                        height: '60vh', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: '40px'
                      }}>
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ marginBottom: 20, opacity: 0.5 }}>
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                        <h2 style={{ fontSize: 20, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
                          {sessionIdParam && sessionSettledRef.current ? "Images Expired" : "No images yet"}
                        </h2>
                        <p style={{ fontSize: 14, maxWidth: 350, lineHeight: 1.6 }}>
                          {sessionIdParam && sessionSettledRef.current ? (
                            <>Older images are automatically deleted after 3 days to save space. Your prompt and settings have been restored — click <strong>Generate</strong> to recreate them!</>
                          ) : (
                            <>Enter a prompt and click <strong>Generate</strong> to create your first image.</>
                          )}
                        </p>
                      </div>
                    )}

                    {/* Render date groups */}
                    {Object.keys(groups).map((groupKey, groupIdx) => (
                      <div key={groupKey} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <h2 style={{
                          fontSize: '11px', fontWeight: 700, color: 'var(--text)', opacity: 0.5,
                          textTransform: 'uppercase', letterSpacing: '0.1em',
                          marginTop: groupIdx > 0 ? '8px' : '0', marginBottom: '0'
                        }}>{groupKey}</h2>

                        {/* --- Group cards by sessionId; edits join their parent session (side by side) --- */}
                        {(() => {
                          // Build session-level buckets in order of first appearance.
                          // Rule: images sharing the same sessionId → side by side in one card.
                          //       edits (parentSessionId set) join the parent session bucket
                          //       so originals + edits appear side by side.
                          const sessionOrder: string[] = [];
                          const sessionBuckets: { [sid: string]: typeof groups[string] } = {};
                          groups[groupKey].forEach(card => {
                            const meta = card.meta as any;
                            // Edits resolve to their parent session so they appear beside the original
                            const sid = meta?.sessionId || `solo_${card.i}`;
                            const parentSid = meta?.parentSessionId;
                            // Use parentSid if the parent bucket already exists (edit case)
                            const bucketKey = (parentSid && sessionBuckets[parentSid]) ? parentSid : sid;
                            if (!sessionBuckets[bucketKey]) {
                              sessionBuckets[bucketKey] = [];
                              sessionOrder.push(bucketKey);
                            }
                            sessionBuckets[bucketKey].push(card);
                          });

                          return sessionOrder.map(sid => {
                            const cards = sessionBuckets[sid];
                            const firstCard = cards[0];
                            const firstMeta = firstCard.meta as any;
                            const modelLabel = getModelLabel(firstMeta?.model || firstMeta?.models?.[0]) || 'Nanobanana 2';
                            const aspectLabel = firstMeta?.ratio || '1:1';
                            const qualityLabel = firstMeta?.quality || 'Standard';
                            const timeText = formatRelativeTimeText(firstMeta?.created_at || firstMeta?.createdAt);
                            const cardPrompt = firstMeta?.prompt || prompt;
                            const isMenuOpen = hoveredIndex === firstCard.i;
                            // Responsive style matching the reference screenshots
                            const aspectMatch = (aspectLabel || '1:1').match(/(\d+):(\d+)/);
                            const [aw, ah] = aspectMatch ? [parseInt(aspectMatch[1]), parseInt(aspectMatch[2])] : [1, 1];
                            const aspect = aw / ah;

                            let responsiveHeight = 'clamp(220px, 30vh, 320px)'; // Square (1:1)
                            if (aspect > 1.2) {
                              responsiveHeight = 'clamp(180px, 24vh, 260px)'; // Landscape (e.g. 16:9)
                            } else if (aspect < 0.8) {
                              responsiveHeight = 'clamp(260px, 36vh, 420px)'; // Portrait (e.g. 9:16)
                            }

                            return (
                              <div
                                key={sid}
                                style={{ 
                                  display: 'flex', 
                                  flexDirection: 'column', 
                                  gap: '12px', 
                                  width: '100%',
                                  paddingBottom: '32px',
                                  borderBottom: '1px solid var(--card-border)',
                                  marginBottom: '16px'
                                }}
                              >
                                {/* ONE-LINE HEADER: prompt … · tags · time · menu */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden', minWidth: 0, opacity: 0.9 }}>
                                  <p
                                    onClick={() => setExpandedPrompts(prev => ({ ...prev, [firstCard.i]: !prev[firstCard.i] }))}
                                    style={{
                                      fontSize: '13px', fontWeight: 500, color: 'var(--text)', margin: 0, flex: 1,
                                      lineHeight: 1.4, cursor: 'pointer',
                                      whiteSpace: expandedPrompts[firstCard.i] ? 'normal' : 'nowrap',
                                      overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0
                                    }}
                                    title={cardPrompt}
                                  >
                                    {cardPrompt}
                                  </p>
                                  {/* Metadata tags */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                    {[aspectLabel, qualityLabel].map(tag => (
                                      <span key={tag} style={{
                                        background: 'var(--surface-strong)',
                                        borderRadius: '5px', padding: '2px 7px', fontSize: '10px', fontWeight: 600,
                                        color: 'var(--dim)', whiteSpace: 'nowrap'
                                      }}>{tag}</span>
                                    ))}
                                    <span style={{ fontSize: '11px', color: 'var(--dim)', fontWeight: 400, whiteSpace: 'nowrap' }}>{timeText}</span>
                                    {/* ⋯ menu */}
                                    <div style={{ position: 'relative' }}>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setHoveredIndex(isMenuOpen ? null : firstCard.i); }}
                                        style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '50%', transition: 'all 0.15s', padding: 0 }}
                                        onMouseOver={e => (e.currentTarget.style.background = 'var(--surface-strong)')}
                                        onMouseOut={e => (e.currentTarget.style.background = 'none')}
                                      >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                                      </button>
                                      {isMenuOpen && (
                                        <div className="studio-rq-panel" style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', width: '160px', zIndex: 1000 }}>
                                          <div className="studio-rq-opt" style={{ padding: '8px 14px', fontSize: '12px', cursor: 'pointer' }} onClick={() => { setPromoteImg(firstCard.i); setHoveredIndex(null); }}>To Storyboard</div>
                                          <div className="studio-rq-opt" style={{ padding: '8px 14px', fontSize: '12px', cursor: 'pointer' }} onClick={() => { downloadImage(firstCard.src, firstCard.i, 'jpg'); setHoveredIndex(null); }}>Download JPG</div>
                                          <div className="studio-rq-opt" style={{ padding: '8px 14px', fontSize: '12px', cursor: 'pointer' }} onClick={() => { downloadImage(firstCard.src, firstCard.i, 'tiff'); setHoveredIndex(null); }}>Download TIFF</div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* IMAGE STRIP — natural width, responsive height, scrolls if overflow */}
                                <div style={{
                                  display: 'flex',
                                  gap: '6px',
                                  height: responsiveHeight,
                                  overflowX: 'auto',
                                  overflowY: 'hidden',
                                  scrollbarWidth: 'none',
                                }}>
                                  {cards.map(({ i: imgIdx, src, meta: imgMeta }) => {
                                    const isActive = activeFeedIndex === imgIdx;
                                    return (
                                      <div
                                        key={imgIdx}
                                        style={{
                                          position: 'relative',
                                          height: '100%',
                                          flexShrink: 0,
                                          borderRadius: '10px',
                                          overflow: 'hidden',
                                          background: 'var(--surface-strong)',
                                          cursor: 'pointer',
                                          aspectRatio: `${aw}/${ah}`,
                                          border: 'none',
                                          outline: isActive ? '2.5px solid var(--orange)' : '2.5px solid transparent',
                                          outlineOffset: '0px',
                                          boxShadow: isActive ? '0 4px 14px rgba(255,107,43,0.35)' : 'none',
                                          transition: 'all 0.25s ease',
                                          isolation: 'isolate',
                                        }}
                                        onMouseEnter={() => setHoveredIndex(imgIdx + 10000)}
                                        onMouseLeave={() => setHoveredIndex(null)}
                                        onClick={() => { setActiveFeedIndex(imgIdx); }}
                                      >
                                        {src && (imgMeta as any)?.status !== 'failed' && !failedImages.has(imgIdx) ? (
                                          <>
                                            <img
                                              src={src}
                                              alt={(imgMeta as any)?.prompt || 'Generated'}
                                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: '8px' }}
                                              onClick={(e) => { e.stopPropagation(); setActiveFeedIndex(imgIdx); setLightboxImg(imgIdx); }}
                                            />
                                            {/* Model badge — visible when the session used multiple models */}
                                            {cards.length > 1 && (imgMeta as any)?.model && (
                                              <div style={{
                                                position: 'absolute', top: 6, left: 6, zIndex: 5,
                                                background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
                                                border: `1px solid ${getModelColor((imgMeta as any).model)}40`,
                                                borderRadius: 6, padding: '2px 7px',
                                                fontSize: 9, fontWeight: 700, color: '#fff',
                                                letterSpacing: '0.04em', whiteSpace: 'nowrap',
                                                pointerEvents: 'none',
                                              }}>
                                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: getModelColor((imgMeta as any).model), display: 'inline-block', marginRight: 4, verticalAlign: 'middle' }} />
                                                {(imgMeta as any).model}
                                              </div>
                                            )}
                                          </>
                                        ) : (imgMeta as any)?.status === 'pending' ? (
                                          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--orange)' }}>
                                            <div className="gen-spinner" style={{ width: 24, height: 24, borderWidth: 2.5, borderColor: 'rgba(255,107,43,0.3)', borderTopColor: 'var(--orange)' }} />
                                            <span style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.05em' }}>GENERATING...</span>
                                          </div>
                                        ) : (
                                          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', color: '#ff5c5c' }}>
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                            <span style={{ fontSize: '10px', fontWeight: 600 }}>Failed</span>
                                          </div>
                                        )}

                                        {hoveredIndex === imgIdx + 10000 && src && (imgMeta as any)?.status !== 'failed' && !failedImages.has(imgIdx) && (
                                          <div style={{
                                            position: 'absolute', bottom: 0, left: 0, right: 0,
                                            background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0) 100%)',
                                            padding: '32px 8px 10px',
                                            display: 'flex', gap: '5px', justifyContent: 'center', alignItems: 'center',
                                            borderRadius: '0 0 8px 8px',
                                            zIndex: 10,
                                            pointerEvents: 'all',
                                          }}>
                                            {[
                                              { label: 'Upscale', icon: <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>, action: () => requestUpscale((imgMeta as any)?.id, src) },
                                              { label: 'Download', icon: <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>, action: () => downloadImage(src, imgIdx, 'png') },
                                              { label: 'Edit', icon: <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>, action: () => openEditPanel(imgIdx) },
                                            ].map(btn => (
                                              <button key={btn.label}
                                                onClick={(e) => { e.stopPropagation(); btn.action(); }}
                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 11px', background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '99px', fontSize: '10px', fontWeight: 700, color: '#fff', cursor: 'pointer', transition: 'background 0.15s', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
                                                onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.35)')}
                                                onMouseOut={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
                                              >
                                                {btn.icon}{btn.label}
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                    </div>
                                  );
                                })}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    ))}
                  </div>
                );
              })()}
          </div>
          )}
        </div>

        {lightboxImg !== null && (() => {
          const src = generatedImages[lightboxImg];
          const meta = imageMetadata[lightboxImg];
          const modelLabel = getModelLabel(meta?.model || meta?.models?.[0]) || 'Nanobanana 2';
          const aspectLabel = meta?.ratio || '1:1';
          const qualityLabel = meta?.quality || 'Standard';
          const timeText = formatRelativeTimeText(meta?.created_at || (meta as any)?.createdAt);
          const modelColor = getModelColor(meta?.model || meta?.models?.[0] || '');

          // Active style selections for this image
          const activeConfigs: Record<string,string> = (typeof (meta as any)?.active_configs === 'string'
            ? JSON.parse((meta as any)?.active_configs || '{}')
            : ((meta as any)?.active_configs || {}));
          const styleEntries = Object.entries(activeConfigs).filter(([k]) => k !== 'chatgpt_model');

          const totalImages = generatedImages.length;
          const canPrev = lightboxImg > 0;
          const canNext = lightboxImg < totalImages - 1;

          return (
            <div className="lightbox-backdrop" onClick={() => setLightboxImg(null)}>
              <div className="lightbox-content" onClick={e => e.stopPropagation()}>

                {/* Prev / Next navigation — on lightbox-content so overflow:hidden on img-wrap doesn't clip them */}
                {canPrev && (
                  <button className="lb-nav-btn prev" onClick={() => setLightboxImg(lightboxImg - 1)} aria-label="Previous image">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                  </button>
                )}
                {canNext && (
                  <button className="lb-nav-btn next" onClick={() => setLightboxImg(lightboxImg + 1)} aria-label="Next image">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                )}

                {/* ── LEFT: Image area ── */}
                <div className="lightbox-img-wrap" style={{ borderRadius: '20px 0 0 20px', position: 'relative' }}>

                  {/* Close button */}
                  <button className="lightbox-close-btn" aria-label="Close" onClick={() => setLightboxImg(null)}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>

                  {src ? (
                    <div 
                      style={{ 
                        position: 'relative', 
                        width: '100%', 
                        height: '100%', 
                        overflow: 'hidden', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        userSelect: 'none'
                      }}
                      onWheel={e => {
                        e.preventDefault();
                        const zoomFactor = 0.25;
                        let nextZoom = e.deltaY < 0 ? lightboxZoom + zoomFactor : lightboxZoom - zoomFactor;
                        nextZoom = Math.min(Math.max(Number(nextZoom.toFixed(2)), 1), 8);
                        
                        if (nextZoom > 1) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = Math.min(Math.max(((e.clientX - rect.left) / rect.width) * 100, 0), 100);
                          const y = Math.min(Math.max(((e.clientY - rect.top) / rect.height) * 100, 0), 100);
                          setLightboxOrigin({ x, y });
                        }
                        setLightboxZoom(nextZoom);
                      }}
                      onMouseMove={e => {
                        if (lightboxZoom > 1) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = Math.min(Math.max(((e.clientX - rect.left) / rect.width) * 100, 0), 100);
                          const y = Math.min(Math.max(((e.clientY - rect.top) / rect.height) * 100, 0), 100);
                          setLightboxOrigin({ x, y });
                        }
                      }}
                      onDoubleClick={e => {
                        if (lightboxZoom > 1) {
                          setLightboxZoom(1);
                          setLightboxOrigin({ x: 50, y: 50 });
                        } else {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = Math.min(Math.max(((e.clientX - rect.left) / rect.width) * 100, 0), 100);
                          const y = Math.min(Math.max(((e.clientY - rect.top) / rect.height) * 100, 0), 100);
                          setLightboxOrigin({ x, y });
                          setLightboxZoom(2.5);
                        }
                      }}
                    >
                      {/* Floating Zoom Indicator & Reset Button */}
                      {lightboxZoom > 1 && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setLightboxZoom(1);
                            setLightboxOrigin({ x: 50, y: 50 });
                          }}
                          style={{
                            position: 'absolute',
                            top: 16,
                            left: 16,
                            zIndex: 10,
                            background: 'rgba(0, 0, 0, 0.75)',
                            backdropFilter: 'blur(8px)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: 20,
                            padding: '4px 10px',
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            cursor: 'pointer',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                            transition: 'all 0.15s ease'
                          }}
                          title="Click to reset zoom"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                          <span>{lightboxZoom.toFixed(1)}x · Reset</span>
                        </button>
                      )}

                      <img 
                        src={src} 
                        alt={(meta as any)?.prompt || 'Generated image'} 
                        style={{ 
                          maxWidth: '100%', 
                          maxHeight: '100%', 
                          objectFit: 'contain', 
                          transform: `scale(${lightboxZoom})`,
                          transformOrigin: `${lightboxOrigin.x}% ${lightboxOrigin.y}%`,
                          transition: 'transform 0.12s ease-out, transform-origin 0.08s ease-out',
                          cursor: lightboxZoom > 1 ? 'crosshair' : 'zoom-in'
                        }} 
                      />
                    </div>
                  ) : (
                    <div style={{ color: '#ff5c5c', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--dim)' }}>Image not available</span>
                    </div>
                  )}

                  {/* Image counter */}
                  {totalImages > 1 && (
                    <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
                      {generatedImages.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setLightboxImg(i)}
                          style={{
                            width: i === lightboxImg ? 20 : 6, height: 6, borderRadius: 99,
                            background: i === lightboxImg ? 'var(--orange)' : 'var(--surface-strong)',
                            border: 'none', cursor: 'pointer', padding: 0,
                            transition: 'all 0.25s'
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* ── RIGHT: Info Panel ── */}
                <div className="lightbox-info">
                  {/* Orange accent bar at top */}
                  <div style={{ height: 3, background: 'var(--orange)', flexShrink: 0 }} />

                  <div style={{ padding: '22px 22px 24px', display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>

                    {/* Header: title + time */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--text)', letterSpacing: '-0.01em' }}>Generation #{lightboxImg + 1}</h2>
                        <span style={{ fontSize: 10, color: 'var(--dim)', fontWeight: 500, background: 'var(--surface-strong)', padding: '3px 8px', borderRadius: 99, border: '1px solid var(--card-border)' }}>{timeText}</span>
                      </div>
                      {/* Model badge */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: modelColor, boxShadow: `0 0 6px ${modelColor}66`, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--dim)' }}>{modelLabel}</span>
                      </div>
                    </div>

                    {/* Divider */}
                    <div style={{ height: 1, background: 'var(--card-border)', margin: '0 -22px' }} />

                    {/* Prompt */}
                    {meta?.prompt && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Prompt</span>
                          <CopyButton value={meta.prompt} size="sm" data-tooltip="Copy prompt"
                            style={{ padding: 4, background: 'var(--surface-strong)', border: '1px solid var(--card-border)', borderRadius: 6, cursor: 'pointer', color: 'var(--dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          />
                        </div>
                        <div style={{
                          background: 'var(--surface)', padding: '12px 14px', borderRadius: '10px',
                          fontSize: 12, color: 'var(--text)', lineHeight: 1.65,
                          maxHeight: 120, overflowY: 'auto', border: '1px solid var(--card-border)',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          scrollbarWidth: 'thin'
                        }}>
                          {meta.prompt}
                        </div>
                      </div>
                    )}

                    {/* Metadata pills: Ratio + Quality */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className="lb-tag">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        {aspectLabel}
                      </span>
                      <span className="lb-tag">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                        {qualityLabel}
                      </span>
                    </div>

                    {/* Active style selections — thumbnail cards same as generate page */}
                    {styleEntries.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Styles Applied</span>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {styleEntries.map(([k, v]) => {
                            const catItems = (cats as any)[k];
                            const item = catItems?.find((i: any) => i.id === v);
                            if (!item) return null;
                            return (
                              <div key={k} style={{
                                position: 'relative', width: 60, height: 60, flexShrink: 0,
                                borderRadius: 10, overflow: 'hidden',
                                border: '2px solid var(--orange)',
                                background: 'var(--surface)'
                              }}>
                                <img src={item.img} alt={item.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                <div style={{
                                  position: 'absolute', inset: 0,
                                  background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 55%)',
                                  display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '4px 4px 4px'
                                }}>
                                  <span style={{ fontSize: 8, fontWeight: 800, color: '#fff', lineHeight: 1.2, textShadow: '0 1px 3px rgba(0,0,0,0.8)', wordBreak: 'break-word' }}>{item.label}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Other Images in Session */}
                    {generatedImages.filter((img, i) => i !== lightboxImg && img).length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          More from this session
                        </span>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {generatedImages.map((img, i) => {
                            if (i === lightboxImg || !img) return null;
                            const otherMeta = imageMetadata[i];
                            const otherModel = getModelLabel(otherMeta?.model || otherMeta?.models?.[0]) || 'Nanobanana 2';
                            return (
                              <button
                                key={i}
                                onClick={() => setLightboxImg(i)}
                                style={{
                                  position: 'relative', width: 80, height: 60, padding: 0,
                                  border: '1.5px solid var(--card-border)', borderRadius: 8,
                                  overflow: 'hidden', cursor: 'pointer', background: 'var(--surface)',
                                  transition: 'all 0.2s ease', flexShrink: 0
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--orange)'; e.currentTarget.style.transform = 'scale(1.04)'; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--card-border)'; e.currentTarget.style.transform = 'scale(1)'; }}
                              >
                                <img src={img} alt={`Generation ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                <div style={{
                                  position: 'absolute', bottom: 0, left: 0, right: 0,
                                  background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
                                  padding: '4px 5px 3px', fontSize: 9, fontWeight: 600, color: '#fff'
                                }}>
                                  #{i + 1} · {otherModel.split(' ')[0]}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Quick stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {[
                        { icon: '🖼️', label: 'Ratio', value: aspectLabel },
                        { icon: '✨', label: 'Quality', value: qualityLabel },
                        { icon: '🤖', label: 'Model', value: modelLabel.split(' ').slice(0,2).join(' ') },
                        { icon: '📅', label: 'Session', value: `#${lightboxImg + 1} of ${generatedImages.filter(Boolean).length}` },
                      ].map(({ icon, label, value }) => (
                        <div key={label} style={{
                          background: 'var(--surface)', border: '1px solid var(--card-border)',
                          borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 3
                        }}>
                          <span style={{ fontSize: 10, color: 'var(--dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{icon} {label}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
                        </div>
                      ))}
                    </div>

                    {/* Spacer */}
                    <div style={{ flex: 1 }} />

                    {/* Divider */}
                    <div style={{ height: 1, background: 'var(--card-border)', margin: '0 -22px' }} />

                    {/* Action buttons */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* Primary: Edit Image */}
                      <button
                        className="lb-action-btn lb-action-primary"
                        onClick={() => { openEditPanel(lightboxImg); setLightboxImg(null); }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14" strokeLinecap="round">
                          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                        </svg>
                        Edit Image
                      </button>

                      {/* Secondary: Download Dropdown */}
                      <div className="lb-download-wrap" style={{ position: 'relative' }}>
                        <button
                          className="lb-action-btn lb-action-secondary"
                          onClick={() => setLbDownloadOpen(!lbDownloadOpen)}
                          style={{ border: '1px solid rgba(255,255,255,0.1)', width: '100%', justifyContent: 'space-between' }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14" strokeLinecap="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Download Image
                          </span>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" strokeLinecap="round" style={{ opacity: 0.8, transform: lbDownloadOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                        
                        {lbDownloadOpen && (
                          <div 
                            style={{ 
                              position: 'absolute', 
                              bottom: '100%', 
                              left: 0, 
                              width: '100%', 
                              zIndex: 1000, 
                              marginBottom: '6px',
                              background: '#1a1a1a',
                              border: '1px solid rgba(255,255,255,0.12)',
                              borderRadius: '10px',
                              overflow: 'hidden',
                              boxShadow: '0 -12px 30px rgba(0,0,0,0.6)',
                              display: 'flex',
                              flexDirection: 'column'
                            }}
                          >
                            {[
                              { key: 'png', label: 'Download PNG' },
                              { key: 'jpg', label: 'Download JPG' },
                              { key: 'tiff', label: 'Download TIFF' }
                            ].map((opt) => (
                              <button
                                key={opt.key}
                                onClick={() => { downloadImage(src, lightboxImg!, opt.key as any); setLbDownloadOpen(false); }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'rgba(255,255,255,0.9)',
                                  padding: '10px 14px',
                                  fontSize: '12px',
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                  transition: 'background 0.15s'
                                }}
                                onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                                onMouseOut={(e) => { e.currentTarget.style.background = 'none'; }}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Row: Upscale + Storyboard */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="lb-action-btn lb-action-secondary"
                          style={{ flex: 1, padding: '10px', border: '1px solid rgba(255,255,255,0.1)', fontSize: 12 }}
                          onClick={() => requestUpscale((meta as any)?.id, src)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12" strokeLinecap="round">
                            <polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>
                          </svg>
                          Upscale
                        </button>
                        <button
                          className="lb-action-btn lb-action-secondary"
                          style={{ flex: 1, padding: '10px', border: '1px solid rgba(255,255,255,0.1)', fontSize: 12 }}
                          onClick={() => { setPromoteImg(lightboxImg); setLightboxImg(null); }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12" strokeLinecap="round">
                            <polygon points="12 2 2 22 22 22"/>
                          </svg>
                          Storyboard
                        </button>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* -- EDIT STYLE MODAL -- */}
        {editStyleModalOpen && (
          <div className="cfg-backdrop" onClick={() => setEditStyleModalOpen(false)}>
            <div className="cfg-modal" onClick={e => e.stopPropagation()}>
              {/* Left category sidebar */}
              <div className="cfg-sidebar">
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12, paddingLeft: 4 }}>Style Categories</div>
                {[
                  { k: 'style', l: 'Visual Style' },
                  { k: 'medium', l: 'Art Medium' },
                  { k: 'lighting', l: 'Lighting' },
                  { k: 'composition', l: 'Composition' },
                  { k: 'camera', l: 'Camera Angle' },
                  { k: 'lens', l: 'Lens' },
                  { k: 'camera_body', l: 'Camera Body' },
                  { k: 'mood', l: 'Mood' },
                  { k: 'color', l: 'Color Palette' },
                ].map(({ k, l }) => {
                  const isActive = editStyleModalCat === k;
                  const hasVal = !!editSelections[k];
                  return (
                    <button
                      key={k}
                      className={`cfg-cat-btn ${isActive ? 'active' : ''}`}
                      onClick={() => setEditStyleModalCat(k)}
                    >
                      {l}
                      {hasVal && <span style={{ marginLeft: 4, color: 'var(--orange)', fontSize: 9 }}>●</span>}
                    </button>
                  );
                })}
                {/* Clear all button */}
                {Object.keys(editSelections).filter(k => editSelections[k]).length > 0 && (
                  <button
                    onClick={() => setEditSelections({})}
                    style={{ marginTop: 'auto', background: 'rgba(255,0,0,0.1)', border: '1px solid rgba(255,0,0,0.3)', borderRadius: 8, color: '#ff1a1a', cursor: 'pointer', padding: '8px 10px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', textAlign: 'center' }}
                  >Clear All</button>
                )}
              </div>

              {/* Right thumbnail grid */}
              <div className="cfg-main">
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                  <span className="cfg-title">
                    {editStyleModalCat.charAt(0).toUpperCase() + editStyleModalCat.slice(1).replace('-', ' ')}
                  </span>
                  <button className="cfg-close" onClick={() => setEditStyleModalOpen(false)}>Done</button>
                </div>
                <div className="cfg-grid">
                  {((cats as any)[editStyleModalCat] || []).map((item: any) => {
                    const isSelected = editSelections[editStyleModalCat] === item.id;
                    const [c1, c2, c3] = item.grad;
                    const uid = 'ecfg' + item.id.replace(/[^a-z0-9]/g, '');
                    return (
                      <div
                        key={item.id}
                        className={`cfg-thumb ${isSelected ? 'selected' : ''}`}
                        onClick={() => setEditSelections(prev => {
                          const next = { ...prev };
                          if (next[editStyleModalCat] === item.id) {
                            delete next[editStyleModalCat];
                          } else {
                            next[editStyleModalCat] = item.id;
                          }
                          return next;
                        })}
                      >
                        <div className="cfg-thumb-visual">
                          {item.img ? (
                            <img src={item.img} alt={item.label} style={{ width: '100%', height: '100%', objectFit: item.id === 'panoramic' ? 'contain' : 'cover', background: `linear-gradient(135deg, ${c1}, ${c2})` }} />
                          ) : (
                            <svg viewBox="0 0 170 90" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" width="100%" height="72">
                              <defs>
                                <radialGradient id={uid} cx="40%" cy="35%" r="75%">
                                  <stop offset="0%" stopColor={c1} />
                                  <stop offset="50%" stopColor={c2} />
                                  <stop offset="100%" stopColor={c3} />
                                </radialGradient>
                              </defs>
                              <rect width="170" height="90" fill={`url(#${uid})`} />
                            </svg>
                          )}
                        </div>
                        <div className="cfg-thumb-name">{item.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CONFIG MODAL (main studio) */}
        {configModalOpen && (
          <div className="cfg-backdrop" onClick={() => setConfigModalOpen(false)}>
            <div className="cfg-modal" onClick={e => e.stopPropagation()}>
              {/* Modal category sidebar */}
              <div className="cfg-sidebar">
                {[
                  { k: 'style', l: 'Visual Style' },
                  { k: 'medium', l: 'Medium' },
                  { k: 'lighting', l: 'Lighting' },
                  { k: 'composition', l: 'Composition' },
                  { k: 'camera', l: 'Camera Angle' },
                  { k: 'lens', l: 'Lens' },
                  { k: 'camera_body', l: 'Camera Body' },
                  { k: 'mood', l: 'Mood' },
                  { k: 'color', l: 'Color Palette' },
                ].map(c => (
                  <button
                    key={c.k}
                    className={`cfg-cat-btn ${configModalCat === c.k ? 'active' : ''}`}
                    onClick={() => setConfigModalCat(c.k)}
                  >
                    {c.l}{c.k === 'camera_body' && selectedCameraBodies.length > 0 ? ` (${selectedCameraBodies.length})` : ''}
                    {selections[c.k] ? ' ✓' : ''}
                  </button>
                ))}
              </div>

              {/* Modal main - thumbnails */}
              <div className="cfg-main">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="cfg-title">
                    {configModalCat.charAt(0).toUpperCase() + configModalCat.slice(1).replace('-', ' ')}
                  </span>
                  <button className="cfg-close" onClick={() => setConfigModalOpen(false)}>Done</button>
                </div>

                <div className="cfg-grid">
                  {((cats as any)[configModalCat] || []).map((item: any) => {
                    const isSelected = configModalCat === 'camera_body'
                      ? selectedCameraBodies.includes(item.id)
                      : selections[configModalCat] === item.id;
                    const [c1, c2, c3] = item.grad;
                    const uid = 'cfg' + item.id.replace(/[^a-z0-9]/g, '');
                    return (
                      <div
                        key={item.id}
                        className={`cfg-thumb ${isSelected ? 'selected' : ''}`}
                        onClick={() => toggleThumb(configModalCat, item.id)}
                      >
                        <div className="cfg-thumb-visual">
                          {item.img ? (
                            <img
                              src={item.img}
                              alt={item.label}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: item.id === 'panoramic' ? 'contain' : 'cover',
                                background: `linear-gradient(135deg, ${c1}, ${c2})`
                              }}
                            />
                          ) : (
                            <svg viewBox="0 0 170 90" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" width="100%" height="72">
                              <defs>
                                <radialGradient id={uid} cx="40%" cy="35%" r="75%">
                                  <stop offset="0%" stopColor={c1} />
                                  <stop offset="50%" stopColor={c2} />
                                  <stop offset="100%" stopColor={c3} />
                                </radialGradient>
                              </defs>
                              <rect width="170" height="90" fill={`url(#${uid})`} />
                            </svg>
                          )}
                        </div>
                        <div className="cfg-thumb-name">{item.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Promote Modal */}
        {promoteImg !== null && (
          <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.85)" }}>
            <div style={{ background: "#1c1c1c", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 24, width: 400, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.8)" }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: "#fff" }}>Promote to Character</h3>
              <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, margin: 0 }}>This will extract the character's DNA so you can use them in your Storyboard.</p>
              
              <input 
                value={promoteCharName} 
                onChange={e => setPromoteCharName(e.target.value)} 
                placeholder="Character Name" 
                style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", padding: "10px 14px", borderRadius: 8, color: "#fff", outline: "none" }} 
              />
              
              <select 
                value={promoteSbId} 
                onChange={e => setPromoteSbId(e.target.value)} 
                style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", padding: "10px 14px", borderRadius: 8, color: "#fff", outline: "none" }}
              >
                <option value="new">Create New Storyboard</option>
                {promoteSbs.map(sb => <option key={sb.id} value={sb.id}>{sb.name}</option>)}
              </select>
              
                {promoteSbId === "new" && (
                <input 
                  value={promoteNewSbName} 
                  onChange={e => setPromoteNewSbName(e.target.value)} 
                  placeholder="New Storyboard Name" 
                  style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", padding: "10px 14px", borderRadius: 8, color: "#fff", outline: "none" }} 
                />
              )}
              
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => setPromoteImg(null)} style={{ background: "transparent", color: "rgba(255,255,255,0.6)", border: "none", cursor: "pointer", padding: "8px 16px", borderRadius: 8 }}>Cancel</button>
                <button 
                  onClick={handlePromote} 
                  disabled={promoteLoading || !promoteCharName || (promoteSbId === "new" && !promoteNewSbName)} 
                  style={{ background: "#f95738", color: "#fff", border: "none", cursor: "pointer", padding: "8px 16px", borderRadius: 8, fontWeight: 600, opacity: (promoteLoading || !promoteCharName || (promoteSbId === "new" && !promoteNewSbName)) ? 0.5 : 1 }}
                >
                  {promoteLoading ? "Extracting DNA..." : "Promote & Go"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // -- HOME VIEW ----------------------------------------------------------
  return (
    <>
      <style>{`
        .studio-main {
          flex: 1; height: auto; min-height: 100vh; overflow: visible; display: flex; flex-direction: column;
          background: var(--bg);
          transition: background 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .studio-topbar {
          display: flex; justify-content: space-between; align-items: center; padding: 12px 24px 10px;
          position: sticky; top: 0; z-index: 400;
          background: var(--panel);
          backdrop-filter: blur(24px) saturate(180%);
          border-bottom: 1px solid var(--card-border);
          box-shadow: var(--shadow-sm);
          transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .studio-top-actions { display: flex; gap: 12px; }
        .pill-nav-wrap {
          display: flex; background: var(--surface); 
          border: 1px solid var(--card-border);
          padding: 4px; border-radius: 12px; gap: 4px;
          backdrop-filter: blur(20px) saturate(160%);
          box-shadow: var(--shadow-sm);
          transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .pill-nav-btn {
          display: flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 8px;
          font-size: 12px; font-weight: 600; color: var(--dim);
          cursor: pointer; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); border: none; background: transparent;
        }
        .pill-nav-btn:hover { color: var(--text); background: var(--surface-strong); }
        .pill-nav-btn.active { background: var(--surface-strong); color: var(--text); box-shadow: var(--shadow-sm); border: 1px solid var(--card-border); }
        .pill-nav-icon { opacity: 0.7; transform: scale(0.9); }
        .pill-nav-btn.active .pill-nav-icon { opacity: 1; }
        .new-chat-btn {
          display: flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 8px;
          font-size: 12px; font-weight: 700; color: #fff; background: var(--orange);
          border: none; cursor: pointer; transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(255, 107, 43, 0.2);
        }
        .new-chat-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(255, 107, 43, 0.3); opacity: 0.9; }
        .new-chat-btn:active { transform: translateY(0); }
        .history-overlay {
          position: fixed; inset: 0; z-index: 1500;
          background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(4px);
          display: flex; justify-content: flex-start; animation: fadeIn 0.2s ease;
        }
        .history-sidebar {
          width: 280px; height: 100%; background: var(--panel);
          border-right: 1px solid var(--card-border);
          display: flex; flex-direction: column; animation: slideInLeft 0.3s cubic-bezier(0.19, 1, 0.22, 1);
          box-shadow: 20px 0 60px rgba(0,0,0,0.15);
          transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        @keyframes slideInLeft { from { transform: translateX(-100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        .history-header { padding: 16px 20px; border-bottom: 1px solid var(--card-border); display: flex; align-items: center; justify-content: space-between; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
        .history-title { font-family: var(--font-geist-sans), sans-serif; font-weight: 700; font-size: 14px; color: var(--text); transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
        .history-list { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
        .history-item {
          padding: 10px; border-radius: 10px; background: var(--surface);
          border: 1px solid var(--card-border); cursor: pointer; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex; flex-direction: column; gap: 6px; position: relative;
        }
        .history-item:hover { 
          background: var(--surface-strong); 
          border-color: var(--orange); 
        }
        .history-item-prompt { 
          font-size: 11px; color: var(--text); 
          line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; 
          overflow: hidden;
          opacity: 0.8;
        }
        .history-item-prompt-more {
          color: var(--muted);
          font-size: 10px;
          margin-left: 3px;
          display: inline-block;
        }
        .history-item-actions {
          position: absolute; top: 6px; right: 6px; opacity: 0; transition: opacity 0.2s;
          z-index: 10;
        }
        .history-item:hover .history-item-actions { opacity: 1; }
        .history-action-btn {
          background: var(--surface); border: 1px solid var(--card-border);
          color: var(--dim); width: 22px; height: 22px; border-radius: 5px;
          display: flex; align-items: center; justify-content: center; cursor: pointer;
          transition: all 0.2s;
        }
        .history-action-btn:hover { background: var(--surface-strong); color: var(--text); border-color: var(--card-border); }
        
        .history-item-menu {
          position: absolute; top: 32px; right: 6px; width: 110px;
          background: var(--panel);
          border: 1px solid var(--card-border);
          border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.15);
          z-index: 100; overflow: hidden; animation: fadeIn 0.2s ease;
        }
        .history-menu-item {
          padding: 6px 10px; font-size: 11px; color: var(--text);
          cursor: pointer; transition: background 0.2s; display: flex; align-items: center; gap: 6px;
        }
        .history-menu-item:hover { background: var(--surface-strong); }
        .history-menu-item.delete { color: #ff5c5c; }
        .history-menu-item.delete:hover { background: rgba(255, 92, 92, 0.1); }
        .history-item-thumbnails { display: flex; gap: 4px; align-items: center; }
        .history-thumb { width: 36px; height: 36px; border-radius: 5px; object-fit: cover; background: var(--surface); }
        .history-thumb-more { width: 36px; height: 36px; border-radius: 5px; background: rgba(255, 107, 43, 0.2); border: 1px solid rgba(255, 107, 43, 0.3); display: flex; align-items: center; justify-content: center; font-size: 10px; color: rgba(255, 107, 43, 0.9); font-weight: 600; }
        .history-item-date { position: absolute; bottom: 6px; right: 10px; font-size: 8px; color: var(--dim); }
        .studio-floating-actions {
          position: absolute; top: 20px; right: 32px; z-index: 500;
          display: flex; align-items: center; gap: 12px;
        }

        .carousel-shell {
          position: relative;
          width: 100%;
          max-width: 1400px;
          margin: 0 auto;
        }

      `}</style>
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)',
          background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(16px)',
          color: '#fff', padding: '8px 14px', borderRadius: '10px',
          fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 99999,
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
        }}>
          {/* Arrow */}
          <div style={{
            position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)',
            width: 10, height: 10, background: 'rgba(10,10,10,0.95)',
            borderRight: '1px solid rgba(255,255,255,0.12)', borderBottom: '1px solid rgba(255,255,255,0.12)'
          }}></div>
          {tooltip.text}
        </div>
      )}
      <div className="bg-layer"></div>
      <div className="bg-grid"></div>

      <div className={`gen-overlay ${generating ? 'active' : ''}`} id="genOverlay">
        <div className="gen-spinner"></div>
        <div className="gen-text">Creating your image...</div>
        <div className="gen-sub">This usually takes 5-15 seconds</div>
      </div>

      <div className="stage">
        {/* Header row with Greeting (left) and Action buttons (right) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', padding: '60px 0 0 40px', marginBottom: '28px', gap: '20px', position: 'relative' }}>
          {/* Greeting */}
          <div className="greeting" style={{ 
            animation: 'premiumReveal 1.2s cubic-bezier(0.22, 1, 0.36, 1) both',
            transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            flex: 1
          }}>
            <h1 style={{
              fontSize: 'clamp(32px, 5vw, 48px)',
              color: 'var(--text)',
              fontWeight: 700,
              transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              animation: 'slowFloat 6s ease-in-out infinite'
            }}>
              Good afternoon, {user?.name || 'Explorer'}
            </h1>
            <p style={{ 
              color: 'var(--text)', 
              fontSize: '1.1rem', 
              marginTop: '8px',
              opacity: 0.8,
              transition: 'color 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
            }}>What would you like to Create today?</p>
          </div>

          {/* Action buttons - right corner */}
          <div style={{ display: 'flex', gap: '10px', flexShrink: 0, position: 'absolute', right: '20px', top: '40px' }}>
            <button
              onClick={goToStudio}
              style={{
                padding: '10px 18px',
                borderRadius: '12px',
                background: 'var(--surface)',
                border: '1px solid var(--card-border)',
                color: 'var(--text)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap'
              }}
              onMouseOver={e => {
                e.currentTarget.style.background = 'var(--surface-strong)';
                e.currentTarget.style.borderColor = 'var(--text)';
                e.currentTarget.style.opacity = '1';
              }}
              onMouseOut={e => {
                e.currentTarget.style.background = 'var(--surface)';
                e.currentTarget.style.borderColor = 'var(--card-border)';
                e.currentTarget.style.opacity = '0.9';
              }}
            >
              Studio
            </button>
            <button
              onClick={goToHistory}
              style={{
                padding: '10px 18px',
                borderRadius: '12px',
                background: 'var(--orange)',
                border: '1px solid var(--orange)',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap'
              }}
              onMouseOver={e => {
                e.currentTarget.style.background = '#ff7d42';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseOut={e => {
                e.currentTarget.style.background = 'var(--orange)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              History
            </button>
          </div>
        </div>

        {/* Inline Analysis Results */}
        {showAnalysisPrompt && analysis && (
          <div className="analysis-inline">
            <div className="analysis-header">
              <div className="analysis-title-row">
                <span className="analysis-tag">Image Analyzed</span>
                <span className="analysis-title">Vision Intelligence</span>
              </div>
            </div>

            {analysis.description && (
              <div className="analysis-desc">"{analysis.description}"</div>
            )}

            <div className="analysis-chips">
              {['style', 'lighting', 'composition'].map(cat => (
                analysis[cat] && (
                  <div key={cat} className="analysis-chip">
                    <span className="analysis-chip-label">{cat}</span>
                    <span className="analysis-chip-val">{analysis[cat]}</span>
                  </div>
                )
              ))}
            </div>

            <div className="analysis-actions">
              <button className="analysis-btn-apply" onClick={applyAnalysis}> Apply Detected Style</button>
              <button className="analysis-btn-dismiss" onClick={() => setShowAnalysisPrompt(false)}>Dismiss</button>
            </div>
          </div>
        )}

        <div className="prompt-wrap">
          <div className="prompt-border"></div>
          <div className="prompt-bar">
            {/* Upload button - label wrapping input = always opens picker */}
            <label
              htmlFor="home-file-upload"
              data-tooltip="Upload reference image (or Ctrl+V to paste)"
              style={{
                background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'}`,
                borderRadius: '10px',
                color: isDark ? '#ffffff' : '#000000',
                padding: '6px 10px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s', flexShrink: 0,
              }}
              onMouseOver={e => { 
                e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'; 
                e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)'; 
              }}
              onMouseOut={e => { 
                e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'; 
                e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'; 
              }}
            >
              <input
                id="home-file-upload"
                type="file"
                style={{ display: 'none' }}
                accept="image/*"
                multiple
                onChange={handleFileUpload}
              />
              {isAnalyzing ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 2s linear infinite' }}>
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              ) : (
                <span style={{ fontSize: 22, fontWeight: 400, lineHeight: 1, color: isDark ? '#ffffff' : '#000000' }}>+</span>
              )}
            </label>

            <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
              <textarea
                className="prompt-input"
                id="promptInput"
                ref={promptInputRef}
                rows={1}
                data-tooltip="Describe the image you want to create"
                placeholder="Describe your image here..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onDoubleClick={(e) => (e.target as HTMLTextAreaElement).select()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isAnalyzing && !generating) generate();
                  }
                }}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: isDark ? '#fff' : '#000',
                  fontFamily: 'var(--font-geist-sans), sans-serif',
                  fontSize: 15,
                  fontWeight: 400,
                  caretColor: 'var(--orange)',
                  resize: 'none',
                  height: 'auto',
                  maxHeight: '200px',
                  overflowY: 'auto'
                }}
              />
              {prompt.length > 0 && (
                <CopyButton
                  value={prompt}
                  size="sm"
                  data-tooltip="Copy prompt"
                  style={{ flexShrink: 0, color: 'rgba(255,255,255,0.3)' }}
                />
              )}
            </div>



            <button
              className="gen-btn"
              data-tooltip={!prompt.trim() ? 'Enter a prompt to generate' : isAnalyzing ? 'Analyzing prompt...' : 'Start image generation'}
              onClick={() => generate()}
              disabled={generating || isAnalyzing || !prompt.trim()}
              style={{
                opacity: (generating || isAnalyzing || !prompt.trim()) ? 0.4 : 1,
                cursor: (generating || isAnalyzing || !prompt.trim()) ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.2s'
              }}
            >
              {isAnalyzing ? 'Analyzing...' : generating ? 'Generating...' : 'Generate'}
              <span className="gen-btn-sparkle">✨</span>
            </button>
          </div>
        </div>

        {/* -- SOFT GATE BANNER -- */}
        {showStyleGate && (
          <div
            onClick={(e) => { if (e.target === e.currentTarget) setShowStyleGate(false); }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              zIndex: 100000,
              background: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 20,
              fontFamily: 'var(--font-geist-sans), sans-serif',
            }}
          >
            <div id="styleGateBanner" style={{
              position: 'relative',
              width: '100%', maxWidth: 410,
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              borderRadius: 22,
              boxShadow: '0 24px 60px -12px rgba(0, 0, 0, 0.28), 0 0 0 1px var(--card-border)',
              overflow: 'hidden',
              animation: 'fadeUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
              padding: '24px 24px 22px',
            }}>
              {/* Subtle top ambient hairline glow */}
              <div style={{
                position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                width: '70%', height: 1,
                background: 'linear-gradient(90deg, transparent, rgba(255, 107, 43, 0.45), transparent)',
              }} />

              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Icon */}
                  <div style={{
                    width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                    background: 'var(--surface-strong)',
                    border: '1px solid var(--card-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#FF6B2B',
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" fill="currentColor" fillOpacity="0.12" />
                    </svg>
                  </div>
                  {/* Title & Badge */}
                  <div>
                    <div style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1.25 }}>
                      Boost your image quality
                    </div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FF6B2B', opacity: 0.85 }} />
                      <span style={{ fontSize: 11.5, color: 'var(--text)', opacity: 0.5, fontWeight: 500 }}>
                        No style selected
                      </span>
                    </div>
                  </div>
                </div>

                {/* Minimalist Close button */}
                <button
                  onClick={() => setShowStyleGate(false)}
                  aria-label="Close"
                  style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: 'transparent', border: 'none',
                    color: 'var(--text)', opacity: 0.45, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseOver={e => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.opacity = '0.9'; }}
                  onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = '0.45'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Body text */}
              <p style={{ fontSize: 13, color: 'var(--text)', opacity: 0.72, lineHeight: 1.55, margin: '0 0 16px' }}>
                Choosing a style, lighting, or composition gives your image creative direction for noticeably sharper detail and consistent results.
              </p>

              {/* Interactive Category Chips */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
                {[
                  {
                    key: 'style', label: 'Style',
                    icon: (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
                      </svg>
                    )
                  },
                  {
                    key: 'lighting', label: 'Lighting',
                    icon: (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                      </svg>
                    )
                  },
                  {
                    key: 'composition', label: 'Composition',
                    icon: (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
                      </svg>
                    )
                  },
                  {
                    key: 'color', label: 'Color',
                    icon: (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
                      </svg>
                    )
                  },
                ].map(hint => (
                  <button
                    key={hint.key}
                    onClick={() => {
                      setActiveCat(hint.key);
                      setShowStyleGate(false);
                      setTimeout(() => {
                        document.getElementById('catScroll')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 100);
                    }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '5px 10px', borderRadius: 8,
                      background: 'var(--surface)', border: '1px solid var(--card-border)',
                      fontSize: 11.5, color: 'var(--text)', opacity: 0.75, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s ease',
                    }}
                    onMouseOver={e => {
                      e.currentTarget.style.background = 'var(--surface-strong)';
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.borderColor = 'rgba(255, 107, 43, 0.35)';
                    }}
                    onMouseOut={e => {
                      e.currentTarget.style.background = 'var(--surface)';
                      e.currentTarget.style.opacity = '0.75';
                      e.currentTarget.style.borderColor = 'var(--card-border)';
                    }}
                  >
                    <span style={{ opacity: 0.7, display: 'flex', alignItems: 'center' }}>{hint.icon}</span>
                    <span>{hint.label}</span>
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 9 }}>
                <button
                  onClick={() => { setShowStyleGate(false); generate(true); }}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 10,
                    background: 'var(--surface)', border: '1px solid var(--card-border)',
                    color: 'var(--text)', opacity: 0.75, fontSize: 12.5, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s ease',
                  }}
                  onMouseOver={e => {
                    e.currentTarget.style.background = 'var(--surface-strong)';
                    e.currentTarget.style.opacity = '1';
                  }}
                  onMouseOut={e => {
                    e.currentTarget.style.background = 'var(--surface)';
                    e.currentTarget.style.opacity = '0.75';
                  }}
                >
                  Generate anyway
                </button>
                <button
                  onClick={() => {
                    setShowStyleGate(false);
                    setTimeout(() => {
                      document.getElementById('catScroll')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                  }}
                  style={{
                    flex: 1.3, padding: '10px 16px', borderRadius: 10,
                    background: '#FF6B2B',
                    border: 'none', color: '#ffffff', fontSize: 12.5, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: '0 4px 14px rgba(255, 107, 43, 0.28)',
                    transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                  onMouseOver={e => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 6px 18px rgba(255, 107, 43, 0.38)';
                    e.currentTarget.style.filter = 'brightness(1.05)';
                  }}
                  onMouseOut={e => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 14px rgba(255, 107, 43, 0.28)';
                    e.currentTarget.style.filter = 'none';
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
                  </svg>
                  Browse styles
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Uploaded / Pasted reference images strip */}
        {uploadedFiles.length > 0 ? (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12, animation: 'fadeUp 0.3s ease' }}>
            {uploadedFiles.map((f, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img
                  src={URL.createObjectURL(f)}
                  style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 10, border: '1px solid rgba(255,107,43,0.4)', display: 'block' }}
                  alt={f.name}
                />
                <button
                  onClick={() => removeUploadedFile(i)}
                  style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: 'rgba(220,50,50,0.85)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >X</button>
              </div>
            ))}
            <div style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>
              {uploadedFiles.length} reference{uploadedFiles.length > 1 ? 's' : ''} added · <span style={{ color: 'var(--orange)', cursor: 'pointer' }} data-tooltip="Clear all uploaded references" onClick={() => setUploadedFiles([])}>Clear all</span>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', marginBottom: 10 }}>
            Clip Ctrl+V to paste an image reference
          </div>
        )}
        {Object.keys(selections).length > 0 && (
          <div className="chip-strip" style={{ margin: '20px auto 16px', justifyContent: 'center', alignItems: 'flex-end', gap: 12, display: 'flex', flexWrap: 'wrap' }}>
            {Object.entries(selections).map(([catKey, id]) => {
              const item = (cats as any)[catKey]?.find((i: any) => i.id === id);
              if (!item) return null;
              return (
                <div key={catKey} className="sel-chip" data-tooltip="Remove this style">
                  {item.img && (
                    <img src={item.img} alt={item.label} className="sel-chip-thumb" />
                  )}
                  <span className="sel-chip-label">{item.label}</span>
                  <span className="sel-chip-x" onClick={() => removeChip(catKey)}>✕</span>
                </div>
              );
            })}
            <button
              onClick={() => { setSelections({}); }}
              data-tooltip="Clear all styles"
              className="clear-all-btn"
            >
              Clear All
            </button>
          </div>
        )}

        {/* Advanced Menu Below */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 24, position: 'relative', zIndex: 300 }}>

          {/* Aspect Ratio */}
          <div className="adv-drop-wrap" style={{ position: 'relative' }}>
            <button className={`adv-btn ${ratioOpen ? 'active' : ''}`} data-tooltip="Select image aspect ratio" onClick={(e) => { e.stopPropagation(); setRatioOpen(!ratioOpen); setQualOpen(false); setModelSelectOpen(false); }}>
              <div style={{ width: 12, height: 12, border: '1.5px solid currentColor', borderRadius: 2 }}></div>
              <span>Ratio: {ratio.id} <span style={{ opacity: 0.5, marginLeft: 4 }}>&gt;</span></span>
            </button>
            <div className={`drop-panel is-down ${ratioOpen ? 'open' : ''}`} style={{ top: 'calc(100% + 10px)' }}>
              <div className="drop-panel-title">Aspect Ratio</div>
              <div className="ratio-grid" style={{ maxHeight: '380px', overflowY: 'auto', paddingRight: '8px', alignContent: 'start' }}>
                {ratioData.map(r => {
                  const [w, h] = r.id.split(':').map(Number);
                  const scale = 26 / Math.max(w, h);
                  const width = w * scale;
                  const height = h * scale;
                  
                  return (
                    <div key={r.id} className={`ratio-option ${ratio.id === r.id ? 'active' : ''}`} onClick={() => changeRatio(r)}>
                      <div className="ratio-device" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '36px' }}>
                        <div style={{ width: `${width}px`, height: `${height}px`, border: '1.5px solid var(--svg-stroke)', borderRadius: '3px', background: 'var(--svg-fill)' }} />
                      </div>
                      <div className="ratio-label">{r.id}</div>
                      <div className="ratio-name">{r.name}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Quality */}
          <div className="adv-drop-wrap" style={{ position: 'relative' }}>
            <button className={`adv-btn ${qualOpen ? 'active' : ''}`} data-tooltip="Select generation quality" onClick={(e) => { e.stopPropagation(); setQualOpen(!qualOpen); setRatioOpen(false); setModelSelectOpen(false); }}>
              <span style={{ opacity: 0.6 }}>✨</span> <span>Quality: {quality.id === 'Standard' ? 'SD' : quality.id === 'High' ? 'HD' : '4K'} <span style={{ opacity: 0.5, marginLeft: 4 }}>&gt;</span></span>
            </button>
            <div className={`drop-panel is-down ${qualOpen ? 'open' : ''}`} style={{ top: 'calc(100% + 10px)', minWidth: 280 }}>
              <div className="drop-panel-title">Output Quality</div>
              <div className="quality-grid">
                <div className={`quality-option ${quality.id === 'Standard' ? 'active' : ''}`} onClick={() => changeQuality(qualityData[0])}>
                  <div className="quality-icon">*</div>
                  <div className="quality-label">Standard</div>
                  <div className="quality-desc">Fast · Good for drafts</div>
                </div>
                <div className={`quality-option ${quality.id === 'High' ? 'active' : ''}`} onClick={() => changeQuality(qualityData[1])}>
                  <div className="quality-icon">*</div>
                  <div className="quality-label">High</div>
                  <div className="quality-desc">Balanced speed &amp; detail</div>
                </div>
                <div className={`quality-option ${quality.id === 'Ultra' ? 'active' : ''}`} onClick={() => changeQuality(qualityData[2])}>
                  <div className="quality-icon">*</div>
                  <div className="quality-label">Ultra</div>
                  <div className="quality-desc">Max detail · Slower</div>
                </div>
              </div>
            </div>
          </div>

          {/* Model Selector */}
          <div className="adv-drop-wrap" style={{ position: 'relative' }}>
            <button
              className={`adv-btn ${modelSelectOpen ? 'active' : ''}`}
              data-tooltip="Open advanced model and generation settings"
              onClick={(e) => { e.stopPropagation(); setModelSelectOpen(!modelSelectOpen); setRatioOpen(false); setQualOpen(false); }}
            >
              <span style={{ opacity: 0.6 }}>⚙️</span> Models <span style={{ opacity: 0.6 }}>&gt;</span>
            </button>
            <div className={`drop-panel is-model-drop is-down ${modelSelectOpen ? 'open' : ''}`} style={{ top: 'calc(100% + 10px)', minWidth: 260, padding: '16px' }}>
              <div className="drop-panel-title">Select Models</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {AVAILABLE_MODELS.map(m => {
                  const isActive = selectedModels.includes(m);
                  return (
                    <div key={m} style={{ marginBottom: 2 }}>
                      <div
                        className={`sb-model-opt ${isActive ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedModels(prev => isActive ? prev.filter(x => x !== m) : [...prev, m]);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', padding: '10px 12px', borderRadius: 12,
                          cursor: 'pointer', background: isActive ? 'rgba(255,107,43,0.1)' : 'transparent',
                          color: isActive ? (isDark ? '#fff' : 'var(--orange)') : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'), transition: 'all 0.2s',
                          fontSize: 14, border: isActive ? '1px solid rgba(255,107,43,0.3)' : '1px solid transparent',
                          fontWeight: isActive ? 600 : 400
                        }}
                        onMouseOver={e => { if (!isActive) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; }}
                        onMouseOut={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{
                          width: 18, height: 18, borderRadius: 5, border: `1px solid ${isActive ? 'var(--orange)' : (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)')}`,
                          marginRight: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: isActive ? 'var(--orange)' : 'transparent', color: '#fff', fontSize: 10
                        }}>
                          {isActive && '✓'}
                        </div>
                        <span style={{ flex: 1 }}>{m}</span>
                        {m === 'ChatGPT' && isActive && (
                          <div
                            style={{
                              marginLeft: 'auto', fontSize: 10, color: isDark ? '#fff' : 'var(--orange)', cursor: 'pointer',
                              padding: '4px 10px', borderRadius: 8, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                              border: isDark ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: 4,
                              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                            }}
                            onClick={(e) => { e.stopPropagation(); setChatgptSubOpen(prev => !prev); }}
                          >
                            {CHATGPT_SUB_MODELS.find(s => s.id === chatgptModel)?.label || chatgptModel}
                            <span style={{ fontSize: 8, opacity: 0.6 }}>{chatgptSubOpen ? '▲' : '▼'}</span>
                          </div>
                        )}
                      </div>
                      {/* ChatGPT sub-model selector */}
                      {m === 'ChatGPT' && isActive && chatgptSubOpen && (
                        <div style={{ padding: '8px 4px 8px 32px', display: 'flex', flexDirection: 'column', gap: 2, animation: 'fadeDown 0.2s ease' }}>
                          {CHATGPT_SUB_MODELS.map(sub => (
                            <div
                              key={sub.id}
                              style={{
                                padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 10,
                                background: chatgptModel === sub.id ? 'rgba(0,166,126,0.12)' : 'transparent',
                                color: chatgptModel === sub.id ? '#00ffa3' : 'rgba(255,255,255,0.4)',
                                transition: 'all 0.15s', display: 'flex', flexDirection: 'column', gap: 2
                              }}
                              onClick={(e) => { e.stopPropagation(); setChatgptModel(sub.id); setChatgptSubOpen(false); }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: chatgptModel === sub.id ? '#00ffa3' : 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
                                <span style={{ fontWeight: chatgptModel === sub.id ? 600 : 400 }}>{sub.label}</span>
                                {chatgptModel === sub.id && <span style={{ fontSize: 10, opacity: 0.8 }}>Active</span>}
                              </div>
                              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', paddingLeft: 14 }}>{sub.desc}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ position: 'relative', width: '100%', maxWidth: '1000px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* ── MODE 1: SMART BAR ── */}
          {(smartBarLoading || smartBarSuggestion) && !smartBarDismissed && (
            <div className="smart-bar">
              {smartBarLoading && !smartBarSuggestion ? (
                <div className="smart-bar-loading">
                  <div className="smart-bar-shimmer" />
                  <span style={{ color: 'var(--text)', opacity: 0.7, fontSize: 13 }}>&#x2726; Analyzing your prompt...</span>
                </div>
              ) : smartBarSuggestion?.suggested && (
                <>
                  <div className="smart-bar-header">
                    <div className="smart-bar-title">
                      &#x2726; Style suggestion for &ldquo;{prompt.trim().slice(0, 40)}{prompt.trim().length > 40 ? '...' : ''}&rdquo;
                    </div>
                    <button className="smart-bar-dismiss" onClick={() => { setSmartBarDismissed(true); setSmartBarSuggestion(null); }}>&times;</button>
                  </div>
                  {smartBarSuggestion.reason && (
                    <div className="smart-bar-reason">{smartBarSuggestion.reason}</div>
                  )}
                  <div className="smart-bar-chips">
                    {Object.entries(smartBarSuggestion.suggested).map(([jsonK, label]) => {
                      if (!label) return null;
                      const catLabel = jsonK.replace(/([A-Z])/g, ' $1').trim();
                      return (
                        <div key={jsonK} className="smart-bar-chip">
                          <span className="smart-bar-chip-cat">{catLabel}</span>
                          <span className="smart-bar-chip-val">{String(label)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <button className="smart-bar-apply" onClick={applySmartBar}>Apply All &#x2726;</button>
                </>
              )}
            </div>
          )}

          {/* Category Tabs */}
          <div className="cat-row-wrap">
            <button className="cat-arrow" data-tooltip="Scroll categories left" onClick={() => scrollCats(-1)}>&lsaquo;</button>
            <div className="cat-scroll" id="catScroll" ref={catScrollRef}>
              {[
                { k: 'recipes', l: '✦ Recipes' },
                { k: 'style', l: 'Visual Style' },
                { k: 'medium', l: 'Medium' },
                { k: 'lighting', l: 'Lighting' },
                { k: 'composition', l: 'Composition' },
                { k: 'camera', l: 'Camera Angle' },
                { k: 'lens', l: 'Lens' },
                { k: 'mood', l: 'Mood' },
                { k: 'color', l: 'Color Palette' },
              ].map((c) => (
                <button
                  key={c.k}
                  className={`cat-pill ${activeCat === c.k ? 'active' : ''}`}
                  onClick={() => {
                    setActiveCat(c.k);
                    setManualInteract(false);
                    if (carouselWrapRef.current) carouselWrapRef.current.scrollLeft = 0;
                  }}
                >
                  {c.l}{c.k === 'camera_body' && selectedCameraBodies.length > 0 ? ` (${selectedCameraBodies.length})` : ''}
                </button>
              ))}
            </div>
            <button className="cat-arrow" data-tooltip="Scroll categories right" onClick={() => scrollCats(1)}>&rsaquo;</button>
          </div>
        </div>

        <div className="carousel-shell">
          <div
            className={`carousel-wrap ${selections[activeCat] || (activeCat === 'recipes' && recipes.some(r => r.config && Object.entries(r.config).every(([k, v]) => selections[k] === v))) ? 'has-selection' : ''}`}
            ref={carouselWrapRef}
            onMouseEnter={() => setIsCarouselHovered(true)}
            onMouseLeave={() => setIsCarouselHovered(false)}
          >
            <div
              className="carousel"
              id="carousel"
              key={activeCat}
            >
              {activeCat === 'recipes' ? (
                /* ── MODE 3: RECIPE CARDS ── */
                recipes.map((recipe: any, idx: number) => {
                  const [c1, c2, c3] = recipe.gradient || ['#333', '#555', '#777'];
                  const isApplied = recipe.config && Object.entries(recipe.config).every(([k, v]) => selections[k] === v);
                  return (
                    <div
                      key={`${recipe.name}-${idx}`}
                      id={`thumb-${recipe.id || idx}`}
                      className={`thumb recipe-card ${isApplied ? 'selected' : ''}`}
                      onClick={() => applyRecipe(recipe)}
                    >
                      <div className="thumb-visual">
                        <svg viewBox="0 0 170 190" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
                          <defs>
                            <linearGradient id={`rcp0-${idx}`} x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stopColor={c1} />
                              <stop offset="50%" stopColor={c2} />
                              <stop offset="100%" stopColor={c3} />
                            </linearGradient>
                          </defs>
                          <rect width="170" height="190" fill={`url(#rcp0-${idx})`} />
                          <text x="85" y="85" textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="48" fontFamily="Outfit" fontWeight="700">✦</text>
                        </svg>
                      </div>
                      <div className="thumb-overlay">
                        <div className="thumb-name">{recipe.name}</div>
                        <div className="thumb-desc">{recipe.desc}</div>
                      </div>
                      {isApplied && <div className="recipe-applied-badge">Applied</div>}
                    </div>
                  );
                })
              ) : (
                /* ── REGULAR STYLE THUMBNAILS WITH MODE 2 SCORING ── */
                ((cats as any)[activeCat] || []).map((item: any, idx: number) => {
                  const isSelected = activeCat === 'camera_body'
                    ? selectedCameraBodies.includes(item.id)
                    : selections[activeCat] === item.id;
                  const scoring = thumbScores[item.id];
                  const tier = scoring?.tier || 'neutral';
                  const showScoring = Object.keys(selections).length > 0 && !isSelected && activeCat !== 'recipes';
                  const [c1, c2, c3] = item.grad;
                  const uid = item.id.replace(/[^a-z0-9]/g, '');

                  return (
                    <div
                      key={`${item.id}`}
                      id={`thumb-${item.id}`}
                      className={`thumb ${isSelected ? 'selected' : ''} ${showScoring && tier === 'best' ? 'score-best' : ''} ${showScoring && tier === 'great' ? 'score-great' : ''} ${showScoring && tier === 'clash' ? 'score-clash' : ''}`}
                      onClick={() => toggleThumb(activeCat, item.id)}
                    >
                      {showScoring && tier === 'best' && <div className="best-match-badge">★★ Best Match</div>}
                      {showScoring && tier === 'great' && <div className="great-fit-dot">★</div>}
                      {showScoring && tier === 'clash' && <div className="clash-indicator">⚠</div>}
                      <div className="thumb-visual">
                        {item.img ? (
                          <img
                            src={item.img}
                            alt={item.label}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: item.id === 'panoramic' ? 'contain' : 'cover',
                              background: `linear-gradient(135deg, ${c1}, ${c2})`
                            }}
                          />
                        ) : (
                          <svg viewBox="0 0 170 190" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
                            <defs>
                              <radialGradient id={`rg${uid}`} cx="40%" cy="35%" r="75%">
                                <stop offset="0%" stopColor={c1} />
                                <stop offset="50%" stopColor={c2} />
                                <stop offset="100%" stopColor={c3} />
                              </radialGradient>
                            </defs>
                            <rect width="170" height="190" fill={`url(#rg${uid})`} />
                            {getShapeSVG(item.id, activeCat, item)}
                          </svg>
                        )}
                      </div>
                      <div className="thumb-overlay">
                        <div className="thumb-name">{item.label}</div>
                        <div className="thumb-desc">{item.desc}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

