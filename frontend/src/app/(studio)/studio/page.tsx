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
import { formatUserFriendlyError } from '../generate/page';

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
  { id: '4:1',  label: '4:1',  icon: '📀', name: 'Wide Banner', prompt: 'wide banner 4:1 aspect ratio',           svgW: 52, svgH: 22 },
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
// Models that are fully integrated and selectable
const INTEGRATED_MODELS = ['Nanobanana 2', 'Nanobanana Pro', 'ChatGPT', 'Kling', 'Flux.1'];
// Models shown greyed-out as "coming soon"
const COMING_SOON_MODELS = ['Midjourney', 'Stable Diffusion', 'Grok-2'];
// Default initial selection — single model only to avoid accidental arena/compare mode
const DEFAULT_SELECTED_MODELS = ['Nanobanana 2'];
// Alias kept for backward compat with any remaining references
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
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const sidebarPromptRef = useRef<HTMLTextAreaElement>(null);
  const editPromptInputRef = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();
  const reuseId = searchParams.get('reuse');
  // Use window.location.pathname as ground truth (same fix as generate page)
  const realPathname = typeof window !== 'undefined' ? window.location.pathname : pathname;
  const allowReuseRoute = realPathname === '/history';
  const isStudioRoute = realPathname === '/studio';
  const isGenerateRoute = realPathname === '/generate';
  
  const { user, logout } = useAuth();
  const { openAuthModal } = useAuthModal();

  const isAdmin = Boolean(user && (user.role === 'admin' || (user as any)?.is_admin));
  const [showAdminHistory, setShowAdminHistory] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('genfy_show_admin_history') === 'true';
    }
    return false;
  });

  useEffect(() => {
    const handleStorageChange = () => {
      if (typeof window !== 'undefined') {
        setShowAdminHistory(localStorage.getItem('genfy_show_admin_history') === 'true');
      }
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('genfy_admin_history_toggled', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('genfy_admin_history_toggled', handleStorageChange);
    };
  }, []);

  const toggleAdminHistory = () => {
    const nextVal = !showAdminHistory;
    setShowAdminHistory(nextVal);
    if (typeof window !== 'undefined') {
      localStorage.setItem('genfy_show_admin_history', String(nextVal));
      window.dispatchEvent(new Event('genfy_admin_history_toggled'));
    }
    if (nextVal) {
      toast.success('Admin recent generations are now visible');
    } else {
      toast.info('Admin recent generations are now hidden');
    }
  };

  const [prompt, setPrompt] = useState('');
  const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(null);
  const [pipelineType, setPipelineType] = useState<string | null>(null);
  const [enhancedPromptExpanded, setEnhancedPromptExpanded] = useState(false);
  // Auto-expand the AI Enhanced Prompt panel whenever a new enhanced prompt arrives
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
  const [visionDescription, setVisionDescription] = useState<string | null>(null);
  const { isDark, setIsDark } = useTheme();
  const [ratio, setRatio] = useState(ratioData[1]); // Default 16:9
  const [quality, setQuality] = useState(qualityData[0]); // Default Standard (SD)
  const [ratioOpen, setRatioOpen] = useState(false);
  const [qualOpen, setQualOpen] = useState(false);
  const [activeCat, setActiveCat] = useState('camera');
  const [selections, setSelections] = useState<Record<string, string>>({});

  const [generating, setGenerating] = useState(false);
  const [autoEnhancing, setAutoEnhancing] = useState(false);
  const [studioView, setStudioView] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  useEffect(() => {
    if (uploadedFiles.length === 0) {
      setVisionDescription(null);
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
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configModalCat, setConfigModalCat] = useState('style');
  const [selectedModels, setSelectedModels] = useState<string[]>(DEFAULT_SELECTED_MODELS);
  const [modelSelectOpen, setModelSelectOpen] = useState(false);
  const [chatgptModel, setChatgptModel] = useState('gpt-image-1.5');
  const [chatgptSubOpen, setChatgptSubOpen] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<number | null>(null);
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
    error_msg?: string;
  }>>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
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
  const [portalMounted, setPortalMounted] = useState(false);
  useEffect(() => { setPortalMounted(true); }, []);
  const [focusMode, setFocusMode] = useState(false);
  const [gridView, setGridView] = useState<'masonry' | 'grid-2' | 'grid-3'>('masonry');
  const [gridViewOpen, setGridViewOpen] = useState(false);
  const goToStudio = () => router.push('/studio');
  const goToHistory = () => router.push('/history');

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

  // ── STYLE AUTOPILOT STATE ──────────────────────────────────────
  // Mode 1: Smart Bar (prompt-first AI suggestion)
  const [smartBarSuggestion, setSmartBarSuggestion] = useState<any>(null);
  const [smartBarLoading, setSmartBarLoading] = useState(false);
  const [smartBarDismissed, setSmartBarDismissed] = useState(false);
  const smartBarDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Mode 2: Inline Scoring (per-thumbnail tier badges)
  const [styleScores, setStyleScores] = useState<Record<string, number>>({});
  const [thumbScores, setThumbScores] = useState<Record<string, { score: number; tier: 'best' | 'great' | 'neutral' | 'clash' }>>({});


  // Phase 4: Vision Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Phase 9: Multi-Canvas Inline Editing
  const [inlinePrompts, setInlinePrompts] = useState<Record<number, string>>({});
  const [inlineGenerating, setInlineGenerating] = useState<Record<number, boolean>>({});

  // Edit Panel state
  const [editPanelImg, setEditPanelImg] = useState<number | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  useEffect(() => {
    const textarea = editPromptInputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [editPrompt]);
  const [editRefFile, setEditRefFile] = useState<File | null>(null);
  const [editGenerating, setEditGenerating] = useState(false);
  // Local ratio/quality for edit panel - isolated from the global state
  const [editRatio, setEditRatio] = useState(ratioData[1]); // Default 16:9
  const [editQuality, setEditQuality] = useState(qualityData[0]); // Default Standard (SD)
  const [editRatioOpen, setEditRatioOpen] = useState(false);
  const [editQualOpen, setEditQualOpen] = useState(false);
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
        const response = await fetch(fetchUrl, { cache: 'no-store' });
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
  // Version history per image slot: map from original index -> array of image srcs (v1, v2, ...)
  const [imageVersions, setImageVersions] = useState<Record<number, string[]>>({});
  // Absolute sequential counter - never resets, so edited images get Image 03, 04... not Image 01
  const imageCounterRef = React.useRef(0);
  const [imageNumbers, setImageNumbers] = useState<string[]>([]);
  // Prevents main session poller from clobbering an in-progress edit slot
  const editInProgressRef = React.useRef(false);

  const catScrollRef = useRef<HTMLDivElement>(null);
  const carouselWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editRefInputRef = useRef<HTMLInputElement>(null);
  const comparePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isCarouselHovered, setIsCarouselHovered] = useState(false);
  const [isButtonHovered, setIsButtonHovered] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const resumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Check if any card is selected (for pausing carousel) - memoized
  const hasSelection = useMemo(() => {
    return !!selections[activeCat];
  }, [selections, activeCat]);

  // -- Stable Refs for /generate route protection --
  const generatingRef = useRef(generating);
  generatingRef.current = generating;
  const generatedImagesLengthRef = useRef(generatedImages.length);
  generatedImagesLengthRef.current = generatedImages.length;

  useEffect(() => {
    if (isGenerateRoute) {
      const shouldTrigger = localStorage.getItem('genimage_auto_trigger');
      if (shouldTrigger === 'true') {
        localStorage.removeItem('genimage_auto_trigger');
        setTimeout(() => { generate(true); }, 500);
      } else {
        const checkTimeout = setTimeout(() => {
          const pendingJob = localStorage.getItem('genimage_pending_job');
          if (!pendingJob && !generatingRef.current && generatedImagesLengthRef.current === 0) {
            router.replace('/studio');
          }
        }, 1500);
        return () => clearTimeout(checkTimeout);
      }
    }
  }, [isGenerateRoute]); // Stable dependency

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
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const loadedReuseSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      // Allow between 260px and 600px
      const newWidth = Math.max(260, Math.min(600, e.clientX));
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
    setHistoryOpen(false);
    // Clear any stale history context so /generate doesn't redirect to an old reuse session
    try { localStorage.removeItem('genimage_last_reuse_session'); } catch (_) {}
    fetchHistory();
  }, [isStudioRoute, reuseId]);

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
          const sess = res.data.session;
          if (!sess) break;
          
          if (!latestSess) latestSess = sess;

          const imageRecords = (sess.images || []).filter((img: any) => img && img.url);
          const imageUrls = imageRecords.length > 0
            ? imageRecords.map((img: any) => img.url)
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
                ratio: img.ratio || sess.ratio || sess.settings?.ratio || '16:9',
                quality: img.quality || sess.quality || sess.settings?.quality || 'standard',
                active_configs: img.active_configs || activeConfigs || {},
                models: modelList,
                model: img?.model_id || modelList?.[idx] || modelList?.[0] || undefined,
                status: img.status || (img.url ? 'completed' : 'failed'),
                sessionId: sess.id || currentId,
                parentSessionId: sess.parent_session_id,
                id: img.id,
                error_msg: img.error_msg,
                url: img.url || ''
              };
            });

            allUrls = [...allUrls, ...imageUrls];
            allMeta = [...allMeta, ...stepMeta];
          }

          currentId = sess.parent_session_id;
          if (allMeta.length > 100) break; // Safety cap
        }

        if (latestSess) {
          setPrompt(latestSess.prompt || '');
          setFailedImages(new Set());
          
          if (latestSess.settings) {
            setRatio(latestSess.settings.ratio || '16:9');
            // Restore quality by looking up the matching qualityData object by id
            const savedQualityId = typeof latestSess.settings.quality === 'string'
              ? latestSess.settings.quality
              : latestSess.settings.quality?.id;
            const restoredQuality = qualityData.find(q => q.id === savedQualityId) || qualityData[0];
            setQuality(restoredQuality);
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

          // ── PRODUCTION: Persist the history session to IndexedDB so that
          // navigating to /generate shows this session seamlessly instead of
          // showing stale data from a different past session.
          try {
            const idbPayload = {
              generatedImages: allUrls.slice(0, 6),
              imageNumbers: allMeta.map((_: any, idx: number) => String(idx + 1).padStart(2, '0')).slice(0, 6),
              imageVersions: {},
              imageMetadata: allMeta.slice(0, 6),
              imageCounter: allMeta.length
            };
            idbSet('genimage_blobs_v4', idbPayload).catch(() => {});
          } catch (_) {}

          // Write settings so /generate restores the correct prompt & styles
          try {
            const activeConfigs = typeof latestSess.active_configs === 'string'
              ? JSON.parse(latestSess.active_configs || '{}')
              : (latestSess.active_configs || {});
            localStorage.setItem('genimage_settings_v3', JSON.stringify({
              prompt: latestSess.prompt || '',
              ratio: latestSess.settings?.ratio || '16:9',
              quality: latestSess.settings?.quality || 'standard',
              activeCat: 'camera',
              selections: activeConfigs,
              selectedModels: finalModels,
              studioView: true
            }));
            // Signal to /generate which reuse session is active so it can
            // navigate to /generate?sessionId=<reuseId> and load correctly.
            localStorage.setItem('genimage_last_reuse_session', reuseId);
          } catch (_) {}
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
      if (!(e.target as Element).closest('.adv-drop-wrap')) {
        setRatioOpen(false);
        setQualOpen(false);
        setModelSelectOpen(false);
        setGridViewOpen(false);
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
    return () => { if (comparePollRef.current) clearInterval(comparePollRef.current); };
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
          x: (rect.left + rect.width / 2) / 1.125,
          y: (rect.top - 8) / 1.125,
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


  // Mode 1: Smart Bar — watch prompt text for AI suggestion
  useEffect(() => {
    // Only fire if: 15+ chars, fewer than 4 selections, not dismissed
    if (prompt.trim().length < 15 || Object.keys(selections).length >= 4 || smartBarDismissed) {
      // Clear the bar if prompt becomes too short
      if (prompt.trim().length < 15) {
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
      } catch (e) {
        console.error('[SmartBar] Error:', e);
        setSmartBarSuggestion(null);
      } finally {
        setSmartBarLoading(false);
      }
    }, 1500);

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
        if (parsed.ratio) setRatio(parsed.ratio);
        if (parsed.quality) {
          // Look up the qualityData object by id to ensure quality is always a full object
          const savedQId = typeof parsed.quality === 'string' ? parsed.quality : parsed.quality?.id;
          const restoredQ = qualityData.find(q => q.id === savedQId) || qualityData[0];
          setQuality(restoredQ);
        }
        if (parsed.activeCat) {
          setActiveCat(parsed.activeCat);
          setManualInteract(false);
        }
        if (parsed.selections) setSelections(parsed.selections);
        if (parsed.selectedModels) setSelectedModels(parsed.selectedModels);
        // Do NOT restore studioView from localStorage on /studio page so it defaults to input bar
        // if (parsed.studioView !== undefined) setStudioView(parsed.studioView);
      }
    } catch (e) {
      console.error('Failed to load settings state:', e);
    } finally {
      isInitialized.current = true;
    }

    // CRITICAL: If sessionId or reuseId is in the URL, force studioView + generating state
    // This overrides any stale localStorage value and guarantees the masonry view renders
    const urlSessionId = new URLSearchParams(window.location.search).get('sessionId');
    const urlReuseId = new URLSearchParams(window.location.search).get('reuse');
    if (urlSessionId || urlReuseId) {
      console.log('[INIT] sessionId/reuseId in URL — forcing studioView=true');
      setStudioView(true);
      if (urlSessionId) setGenerating(true);
    }
  }, []);

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

  // 2. Image data (Large data -> IndexedDB)
  useEffect(() => {
    const loadImages = async () => {
      // In studio page, we never want to auto-restore IndexedDB images and force studioView=true.
      // The studio route always defaults to the template prompt builder.
      return;
    };
    loadImages();
  }, [reuseId, allowReuseRoute]);

  // IndexedDB health flag
  const idbDisabledRef = useRef(false);

  useEffect(() => {
    const saveImages = async () => {
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
          console.warn('[IndexedDB] Permanently broken, disabling for this session.');
          idbDisabledRef.current = true;
        }
      }
    };
    if (generatedImages.length > 0) saveImages();
  }, [generatedImages, imageNumbers, imageVersions, imageMetadata]);
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
      processImageFiles(imageItems);
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
        processImageFiles(imageFiles);
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
    console.log(`[🖼️ RATIO CHANGED] ${newRatio.id} (${newRatio.name}) — prompt tag: "${newRatio.prompt}"`);
    setRatio(newRatio);
    setRatioOpen(false);
  };

  const changeQuality = (newQuality: typeof qualityData[0]) => {
    console.log(`[⚡ QUALITY CHANGED] ${newQuality.id} — prompt tag: "${newQuality.prompt}"`);
    setQuality(newQuality);
    setQualOpen(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      processImageFiles(files);
    }
  };

  const processImageFiles = (files: File[]) => {
    if (files.length === 0) return;

    let allowedFiles = files;
    if (uploadedFiles.length + files.length > 12) {
      alert("You can only upload up to 12 reference images at once.");
      const availableSlots = 12 - uploadedFiles.length;
      if (availableSlots <= 0) return;
      allowedFiles = files.slice(0, availableSlots);
    }

    setUploadedFiles(prev => [...prev, ...allowedFiles]);
    
    const base64Promises = allowedFiles.map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(base64Promises).then(base64s => {
      analyzeUploadedImages(base64s);
    });
  };

  const analyzeUploadedImages = async (base64s: string[]) => {
    setIsAnalyzing(true);
    try {
      const catContextLines = Object.entries(cats).map(([key, list]) => {
        const title = key.charAt(0).toUpperCase() + key.slice(1);
        const options = (list as any[]).map(i => i.label).join(", ");
        return `${title}: ${options}`;
      });
      const categoriesContext = catContextLines.join("\n");

      const descriptions = [];
      for (let idx = 0; idx < base64s.length; idx++) {
        const b64 = base64s[idx];
        const resp = await api.post('/api/analyze-image', {
          image_base64: b64,
          categories_context: categoriesContext
        });
        const data = resp.data;
        const desc = data.detailed_description || data.description || "";
        if (desc) {
          const catHeader = data.category ? `Category: ${data.category}\n` : "";
          descriptions.push(`[Reference Image ${idx + 1}]\n${catHeader}${desc}`);
        }
      }

      const finalDesc = descriptions.filter(d => d).join("\n\n");
      if (finalDesc) {
        setVisionDescription(prev => prev ? `${prev}\n\n${finalDesc}` : finalDesc);
      }
    } catch (err) {
      console.error("Analysis Error:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const removeUploadedFile = (idx: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const toggleThumb = (catKey: string, itemId: string) => {
    const item = (cats as any)[catKey]?.find((i: any) => i.id === itemId);

    const isDeselecting = selections[catKey] === itemId;
    console.log(`[🎨 STYLE CARD ${isDeselecting ? 'DESELECTED' : 'SELECTED'}] category="${catKey}" id="${itemId}" label="${item?.label || '?'}" prompt="${item?.prompt || '?'}"`);
    setSelections(prev => {
      const next = { ...prev };
      if (prev[catKey] === itemId) {
        delete next[catKey];
        console.log(`[🎨 STYLE STATE] Removed "${catKey}". Active selections:`, Object.keys(next));
      } else {
        next[catKey] = itemId;
        console.log(`[🎨 STYLE STATE] Set "${catKey}" → "${itemId}". Active selections:`, next);
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

      const selectedId = selections[activeCat];
      if (selectedId) {
        const el0 = document.getElementById(`thumb-0-${selectedId}`);
        const el1 = document.getElementById(`thumb-1-${selectedId}`);
        if (el0) targetEls.push(el0);
        if (el1) targetEls.push(el1);
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

  const generate = async (bypassStyleGate = false) => {
    console.log('\n%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color:#FACC15;font-weight:bold');
    console.log('%c🚀 [GENERATE BUTTON CLICKED]', 'color:#FACC15;font-size:14px;font-weight:bold');
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color:#FACC15;font-weight:bold');
    console.log('[GENERATE] User:', user?.email || 'NOT LOGGED IN');
    console.log('[GENERATE] bypassStyleGate:', bypassStyleGate);
    console.log('[GENERATE] Selected models:', selectedModels);
    console.log('[GENERATE] Route:', { isStudioRoute, isGenerateRoute });
    console.log('[GENERATE] Raw user prompt:', JSON.stringify(prompt));
    console.log('[GENERATE] Active style selections:', selections);
    console.log('[GENERATE] Ratio:', ratio.id, '| Quality:', quality.id);
    console.log('[GENERATE] Uploaded files:', uploadedFiles.length);

    if (!user) {
      console.warn('[GENERATE] ❌ BLOCKED — user not logged in, opening auth modal');
      openAuthModal('signup');
      return;
    }
    // Style gate applies to BOTH single and compare mode —
    // if no styles selected, prompt the user first unless bypassed
    if (!bypassStyleGate && Object.keys(selections).length === 0 && !studioView) {
      console.warn('[GENERATE] ❌ BLOCKED — no styles selected, showing style gate banner');
      setShowStyleGate(true);
      setTimeout(() => {
        document.getElementById('styleGateBanner')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return;
    }
    setShowStyleGate(false);

    setGenerating(true);
    setStudioView(true);
    let image_base64 = undefined;

    if (uploadedFiles.length > 0) {
      console.log(`[GENERATE] 📎 ${uploadedFiles.length} Reference image(s) detected`);
      const base64Promises = uploadedFiles.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      });
      image_base64 = await Promise.all(base64Promises) as any;
      console.log('[GENERATE] 📎 Reference image(s) encoded to base64 ✅');
    } else {
      console.log('[GENERATE] No reference image — text-only generation');
    }

    // ── PROMPT ASSEMBLY ──
    const tagStrings: string[] = [];
    Object.entries(selections).forEach(([catKey, id]) => {
      const item = (cats as any)[catKey]?.find((i: any) => i.id === id);
      if (item && item.prompt) {
        tagStrings.push(item.prompt);
        console.log(`[PROMPT ASSEMBLY] + style tag [${catKey}/${id}]: "${item.prompt}"`);
      }
    });
    if (ratio.prompt) {
      tagStrings.push(ratio.prompt);
      console.log(`[PROMPT ASSEMBLY] + ratio tag: "${ratio.prompt}"`);
    }
    if (quality.prompt) {
      tagStrings.push(quality.prompt);
      console.log(`[PROMPT ASSEMBLY] + quality tag: "${quality.prompt}"`);
    }

    const promptParts = [prompt.trim()];
    const fullPrompt = [...promptParts, ...tagStrings].filter(Boolean).join(', ');

    console.log('%c[PROMPT ASSEMBLY] ✅ FULL FRONTEND PROMPT (sent to backend):', 'color:#34D399;font-weight:bold');
    console.log(fullPrompt);

    // ── API CALL (Database First) ──
    try {
      try {
        localStorage.setItem('genimage_settings_v3', JSON.stringify({
          prompt, ratio, quality, activeCat, selections, selectedModels, studioView: true
        }));
      } catch (_) {}

      console.log('%c[API] 📤 POST /api/sessions — Creating Database Session', 'color:#60A5FA;font-weight:bold');
      const res = await api.post('/api/sessions', {
        prompt: fullPrompt,
        ratio: ratio.id,
        quality: quality.id,
        active_configs: { ...selections, chatgpt_model: chatgptModel },
        model_ids: selectedModels,
        image_base64,
        vision_description: visionDescription || undefined
      });
      
      const data = res.data;
      if (data.session_id) {
        console.log(`%c[API] ✅ Session Created: ${data.session_id}`, 'color:#A78BFA;font-weight:bold');
        router.push(`/generate?sessionId=${data.session_id}`);
        return;
      }
    } catch (e: any) {
      console.error(`%c[API] ❌ SESSION CREATION FAILED`, 'color:#F87171;font-weight:bold', e);
      const errorMsg = formatUserFriendlyError(e.response?.data?.detail || e.message || 'Failed to start generation session');
      toast.error(`Generation failed: ${errorMsg}`);
      setGenerating(false);
      setFocusedImg(0);
    }
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

  // Download a generated image
  const downloadImage = async (src: string, index: number, format: 'png' | 'tiff' | 'jpg' = 'png') => {
    try {
      let blob: Blob;
      if (src.startsWith('data:')) {
        const [header, b64] = src.split(',');
        const mime = header.split(':')[1]?.split(';')[0] || 'image/png';
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        blob = new Blob([arr], { type: mime });
      } else {
        const response = await fetch(src, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
        blob = await response.blob();
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `generated-image-${index + 1}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch (e) {
      console.error('[downloadImage] Failed:', e);
      const a = document.createElement('a');
      a.href = src;
      a.download = `generated-image-${index + 1}.${format}`;
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
    // with parent_session.prompt, so re-adding them here would cause triple-stacking.
    if (editPrompt.trim()) parts.push(editPrompt.trim());
    // Accepted chips from vision analysis of ref image (these are NEW style overrides
    // from a reference image, not duplicates of existing selections)
    if (editRefAnalysis && !editRefAnalysis._fallback_exhausted) {
      (['style', 'lighting', 'composition'] as const).forEach(catKey => {
        if (acceptedRefChips[catKey] && editRefAnalysis[catKey]) {
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
    const meta = imageMetadata[index];
    if (meta) {
      setEditPrompt('');
      const r = ratioData.find((x: any) => x.id === meta.ratio);
      if (r) setEditRatio(r);
      const q = qualityData.find((x: any) => x.id === meta.quality);
      if (q) setEditQuality(q);
      setEditSelections(meta.active_configs ? { ...meta.active_configs } : { ...selections });
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
    const modelsToUse = allModels ? selectedModels : [selectedModels[0]];
    const editRatioId = editRatio.id;
    const editQualityId = editQuality.id;
    const sourceMeta = imageMetadata[editPanelImg!];

    // Build prompt history for the LLM Synthesizer:
    const prevHistory: string[] = [
      ...(sourceMeta?.promptHistory ?? []),
      ...((sourceMeta?.prompt || prompt) ? [sourceMeta?.prompt || prompt] : []),
    ];
    const rawEditInstruction = editPrompt.trim();

    console.log('[Edit] Final prompt:', finalPrompt);
    console.log('[Edit] Prompt history depth:', prevHistory.length);

    try {
      // Helper: fetch a URL and convert to base64 string (data URI prefix stripped)
      const urlToBase64 = async (url: string): Promise<string | null> => {
        try {
          if (url.startsWith('data:image')) {
            return url.split(',')[1];
          }
          const resp = await fetch(url, { cache: 'no-store' });
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

      let sourceBase64: string | null = null;
      if (sourceSrc) {
        sourceBase64 = await urlToBase64(sourceSrc);
      }

      // Prefer async database-first pipeline if we have session tracking
      if (sourceMeta?.sessionId && (sourceMeta as any)?.id) {
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
        const hasEditInstruction = rawEditInstruction.length > 0 || (editRefAnalysis && !editRefAnalysis._fallback_exhausted);
        const fullPromptOverride = hasEditInstruction ? null : overrideParts.filter(Boolean).join(', ');

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

        const payload = {
          edit_prompt: rawEditInstruction || finalPrompt,
          full_prompt_override: fullPromptOverride,
          reference_image_id: null,
          config_overrides: Object.keys(configOverrides).length > 0 ? configOverrides : null,
          image_base64: finalImageBase64,
          vision_description: (editRefAnalysis && !editRefAnalysis._fallback_exhausted) 
            ? ((editRefAnalysis as any).detailed_description || editRefAnalysis.description)
            : undefined,
          ratio: editRatioId,
          quality: editQualityId
        };
        console.log('[Edit] POSTing to:', `/api/sessions/${sourceMeta.sessionId}/images/${(sourceMeta as any).id}/edit`);
        const res = await api.post(`/api/sessions/${sourceMeta.sessionId}/images/${(sourceMeta as any).id}/edit`, payload);
        console.log('[Edit] API response:', res.data);
        const childSessionId = res.data?.child_session_id || res.data?.session_id;
        if (childSessionId) {
          // Stable slot ID — survives array prepends/appends from concurrent generates
          const slotId = `edit-slot-${Date.now()}-${Math.random().toString(36).slice(2)}`;

          // Close panel immediately and reset edit state
          setEditPanelImg(null);
          setEditPrompt('');
          setEditRefFile(null);
          setEditRefAnalysis(null);
          setAcceptedRefChips({});
          setEditGenerating(false);

          // Mark that an edit placeholder is now live
          editInProgressRef.current = true;

          // Prepend a pending placeholder tagged with slotId
          imageCounterRef.current += 1;
          const num = String(imageCounterRef.current).padStart(2, '0');
          setImageNumbers(prev => [num, ...prev]);
          setGeneratedImages(prev => ['', ...prev]);
          setImageMetadata(prev => [{
            prompt: finalPrompt,
            ratio: editRatioId,
            quality: editQualityId,
            models: modelsToUse,
            status: 'pending' as const,
            sessionId: childSessionId,
            parentSessionId: sourceMeta.sessionId,
            _slotId: slotId,
          } as any, ...prev]);

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
              console.warn('[Edit] Poll error:', pollErr);
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

      // Fallback: Synchronous generation for legacy images missing session tracking
      const res = await fetch(`${API_BASE_URL}/api/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: rawEditInstruction || finalPrompt,
          ratio: editRatioId,
          quality: editQualityId,
          categories: editSelections,
          models: modelsToUse,
          image_base64: sourceBase64,
          chatgpt_model: chatgptModel,
          session_id: sourceMeta?.sessionId || currentSessionId,
          prompt_history: prevHistory.length > 0 ? prevHistory : undefined
        })
      });
      const data = await res.json();

      if (data.status === 'success' && data.results && data.results.length > 0) {
        const newImages = data.results.map((r: any) => r.url);
        const origIdx = editPanelImg;
        setImageVersions(prev => {
          const existing = (prev || {})[origIdx] || [generatedImages[origIdx]];
          return { ...(prev || {}), [origIdx]: [...existing, ...newImages] };
        });
        const newNums = data.results.map(() => {
          imageCounterRef.current += 1;
          return String(imageCounterRef.current).padStart(2, '0');
        });
        setImageNumbers(prev => [...newNums, ...prev]);
        setGeneratedImages(prev => [...newImages, ...prev]);
        const updatedHistory: string[] = [...prevHistory, sourceMeta?.prompt || finalPrompt].filter(Boolean);
        const editSessionId = `session_${Date.now()}`;
        const parentSessionId = sourceMeta?.sessionId;
        const editMeta = data.results.map((res: any) => ({
          prompt: finalPrompt,
          ratio: editRatioId,
          quality: editQualityId,
          models: modelsToUse,
          model: res.model,
          status: res.url ? 'completed' : 'failed',
          promptHistory: updatedHistory,
          sessionId: data.session_id || editSessionId,
          parentSessionId,
          id: res.id || res.image_id || res.imageId,
          error_msg: res.error
        }));
        setImageMetadata(prev => [...editMeta, ...prev]);
        if (!currentSessionId && data.session_id) {
          setCurrentSessionId(data.session_id);
        }
        setEditPanelImg(null);
        setEditPrompt('');
        setEditRefFile(null);
        setEditRefAnalysis(null);
        setAcceptedRefChips({});
        setFocusedImg(0);
      }
    } catch (e: any) {
      console.error(e);
      toast.error(`Edit failed: ${formatUserFriendlyError(e.message)}`);
    }
    setEditGenerating(false);
  };

  const generateInlineEdit = async (index: number) => {
    if (!user) {
      openAuthModal('signup');
      return;
    }
    setInlineGenerating(prev => ({ ...prev, [index]: true }));

    const textRefinement = inlinePrompts[index].trim();
    const base64Src = generatedImages[index];

    // Build prompt history for the inline edit
    const sourceMeta = imageMetadata[index];
    const inlineHistory: string[] = [
      ...(sourceMeta?.promptHistory ?? []),
      ...((sourceMeta?.prompt || prompt) ? [sourceMeta?.prompt || prompt] : []),
    ];

    const tagStrings: string[] = [];
    Object.entries(selections).forEach(([catKey, id]) => {
      const item = (cats as any)[catKey]?.find((i: any) => i.id === id);
      if (item && item.prompt) tagStrings.push(item.prompt);
    });
    const completePrompt = [prompt.trim(), textRefinement, ...tagStrings].filter(Boolean).join(', ');

    try {
      if (sourceMeta?.sessionId && (sourceMeta as any)?.id) {
        const payload = {
          edit_prompt: textRefinement,
          full_prompt_override: null,
          reference_image_id: null,
          config_overrides: selections,
          image_base64: base64Src,
          ratio: ratio.id,
          quality: quality.id
        };
        const res = await api.post(`/api/sessions/${sourceMeta.sessionId}/images/${(sourceMeta as any).id}/edit`, payload);
        if (res.data?.session_id) {
          setInlinePrompts(prev => { const n = { ...prev }; delete n[index]; return n; });
          const lsData = { prompt: completePrompt, ratio, quality, activeCat, selections, selectedModels, studioView: true };
          localStorage.setItem('genimage_settings_v3', JSON.stringify(lsData));
          router.push(`/generate?sessionId=${res.data.session_id}`);
          return;
        }
      }

      // Fallback
      const res = await api.post('/api/generate', {
        prompt: textRefinement,
        ratio: ratio.id,
        quality: quality.id,
        categories: selections,
        models: selectedModels,
        image_base64: base64Src,
        chatgpt_model: chatgptModel,
        session_id: currentSessionId,
        prompt_history: inlineHistory.length > 0 ? inlineHistory : undefined
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
        // Carry lineage forward for next inline edit
        const updatedHistory: string[] = [...inlineHistory, textRefinement].filter(Boolean);
        const inlineMeta = data.results.map((res: any) => ({
          prompt: completePrompt,
          ratio: ratio.id,
          quality: quality.id,
          models: selectedModels,
          model: res.model,
          status: res.url ? 'completed' : 'failed',
          promptHistory: updatedHistory,
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
      console.error(e);
      toast.error(`Inline edit failed: ${formatUserFriendlyError(e.message)}`);
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
      toast.error(`Compare generation failed: ${formatUserFriendlyError(e.message)}`);
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

  async function fetchHistory() {
    try {
      const res = await api.get('/api/sessions');
      setSessionHistory(res.data.sessions || []);
    } catch (e) {
      console.error('[fetchHistory]', e);
    }
  }

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
        const imageRecords = (data.images || []).filter((img: any) => img && img.url);
        const imgs = imageRecords.length > 0
          ? imageRecords.map((img: any) => img.url)
          : (data.preview_images || []);
        setGeneratedImages(imgs);
        const models = Array.isArray(data.models) ? data.models : JSON.parse(data.models || '[]');
        const metaSource = imageRecords.length > 0 ? imageRecords : imgs.map((url: string) => ({ url }));
        const meta = metaSource.map((img: any) => ({
          prompt: data.prompt,
          ratio: data.ratio || data.settings?.ratio,
          quality: data.quality || data.settings?.quality,
          models,
          model: img?.model_id || models?.[0] || undefined,
          sessionId: data.id || data.session_id,
          id: img?.id,
          status: img.status || (img.url ? 'completed' : 'failed'),
          url: img.url || ''
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
          .cmp-scroll{flex:1;display:flex;align-items:stretch;overflow-x:auto;overflow-y:hidden;padding:28px 28px 20px;gap:18px;min-height:0}
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
            fontSize: 16, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 99999,
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

          .studio-root {
            display: flex;
            min-height: 100vh;
            width: 100%;
            margin: 0;
            position: relative;
            z-index: 100;
            color: var(--text);
            background: var(--bg);
            padding-top: var(--studio-nav-offset, 76px);
            transition: padding-top 180ms ease-out;
          }
          .studio-main {
            flex: 1;
            margin-left: var(--sidebar-width, 320px);
            position: relative;
            min-width: 0;
            transition: margin-right 0.3s cubic-bezier(0.19, 1, 0.22, 1);
            padding: 20px 30px 20px 30px;
          }
          .stage {
            padding: 0 32px 32px;
            width: 100%;
          }
          .studio-sidebar {
            position: fixed;
            top: var(--studio-nav-offset, 76px);
            left: 0;
            bottom: 0;
            height: calc(100dvh - var(--studio-nav-offset, 76px));
            width: var(--sidebar-width, 320px);
            display: flex;
            flex-direction: column;
            padding: 8px 8px 22px 20px;
            overflow-y: auto;
            overflow-x: hidden;
            z-index: 900;
            gap: 12px;
            flex-shrink: 0;
            background: var(--panel);
            border-right: 1px solid var(--card-border);
            border-top: none;
            border-bottom: none;
            border-left: none;
            border-radius: 0;
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
            column-count: 2;
            column-gap: 24px;
            padding: 0;
            overflow: visible;
            column-fill: balance;
            width: 100%;
          }
          @media (max-width: 1400px) { .studio-gallery-masonry { column-count: 2; } }
          @media (max-width: 1000px) { .studio-gallery-masonry { column-count: 2; } }
          @media (max-width: 600px) { .studio-gallery-masonry { column-count: 1; } }

          .studio-gallery-grid-2 {
            display: block;
            column-count: 2;
            column-gap: 24px;
            padding: 0;
            overflow: visible;
            column-fill: balance;
            width: 100%;
          }
          .studio-gallery-grid-3 {
            display: block;
            column-count: 3;
            column-gap: 24px;
            padding: 0;
            overflow: visible;
            column-fill: balance;
            width: 100%;
          }
          @media (max-width: 1200px) { .studio-gallery-grid-3 { column-count: 2; } }
          @media (max-width: 800px) { .studio-gallery-grid-3 { column-count: 1; } .studio-gallery-grid-2 { column-count: 1; } }

          .grid-toggle-wrap {
            display: flex;
            background: var(--surface);
            border: 1px solid var(--card-border);
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
          .studio-gallery-focus::-webkit-scrollbar-thumb { background: var(--card-border); border-radius: 4px; }
          .lineage-step {
            display: flex;
            align-items: center;
            gap: 16px;
            flex-shrink: 0;
          }
          .lineage-arrow {
            font-size: 32px;
            color: var(--dim);
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
          .masonry-card:hover { box-shadow: none; border-color: var(--text); }
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
            position:fixed; inset:0; z-index:2000;
            background:rgba(0,0,0,0.28); backdrop-filter:blur(8px);
            display:flex; align-items:center; justify-content:center;
            animation: fadeIn .2s ease;
          }
          @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
          .lightbox-content {
            display:flex; gap:0; max-width:1100px; width:95vw; max-height:90vh;
            background:var(--panel); backdrop-filter:blur(20px);
            border-radius:24px;
            border:1px solid var(--card-border); overflow:hidden;
            box-shadow:0 40px 120px rgba(0,0,0,0.7);
            animation: popIn .2s ease;
            position:relative;
          }
          @keyframes popIn { from { transform:scale(0.95); opacity:0; } to { transform:scale(1); opacity:1; } }
          .lightbox-img-wrap {
            flex:1; display:flex; align-items:center; justify-content:center;
            background:var(--surface); overflow:auto; padding:20px; min-width:0;
          }
          .lightbox-img-wrap img { max-width:100%; max-height:80vh; object-fit:contain; border-radius:12px; display:block; }
          .lightbox-info {
            width:320px; flex-shrink:0; padding:28px 24px;
            border-left:1px solid var(--card-border);
            overflow-y:auto; display:flex; flex-direction:column; gap:20px;
          }
          .lightbox-info::-webkit-scrollbar { width:4px; }
          .lightbox-info::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.16); border-radius:4px; }
          .lightbox-close-btn {
            position:absolute; top:16px; right:16px;
            background:var(--surface); border:1px solid var(--card-border);
            border-radius:10px; color:var(--text); cursor:pointer; z-index:2001;
            padding:7px 14px; font-size:11px; font-weight:700; font-family:inherit;
            transition:all .2s;
          }
          .lightbox-close-btn:hover { background:var(--surface-strong); border-color:var(--card-border); transform:translateY(-1px); }
          .studio-sidebar::-webkit-scrollbar { width: 0; }
          .studio-sidebar:hover::-webkit-scrollbar { width: 4px; }
          .studio-sidebar::-webkit-scrollbar-thumb { background: var(--card-border); border-radius: 4px; }

          .studio-main {
            flex: 1;
            height: auto;
            min-height: 0;
            overflow: visible;
            display: flex;
            flex-direction: column;
            background: var(--bg);
            padding-top: 0;
          }
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
            padding: 24px; border-bottom: 1px solid var(--card-border);
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
          .history-item-date { position: absolute; bottom: 8px; right: 12px; font-size: 9px; color: var(--dim); }
          
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
        `}</style>



        <div className="studio-root" style={{ background: 'var(--bg)', color: 'var(--text)', '--sidebar-width': `${sidebarWidth}px` } as any}>
          {/* LEFT SIDEBAR - reference-inspired layout */}
          <div className="studio-sidebar studio-scroll-region">
            <div 
              className={`studio-resizer ${isResizing ? 'resizing' : ''}`} 
              onMouseDown={() => setIsResizing(true)}
            />

            {editPanelImg !== null ? (
              /* === EDIT MODE === */
              <>
                {/* Back to History Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--card-border)' }}>
                  <button
                    onClick={() => {
                      setEditPanelImg(null); setEditPrompt(''); setEditRefFile(null);
                      setEditRefAnalysis(null); setAcceptedRefChips({}); setEditAdvancedOpen(false);
                    }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--dim)', padding: '4px 6px 4px 0',
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 12, fontFamily: 'inherit', transition: 'color 0.15s',
                      flexShrink: 0
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                      <path d="M19 12H5" />
                      <path d="M12 5l-7 7 7 7" />
                    </svg>
                    Back to History
                  </button>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--orange)', textTransform: 'uppercase' }}>
                      Editing Image {String((editPanelImg ?? 0) + 1).padStart(2, '0')}
                    </div>
                  </div>
                  <div style={{ width: 32, flexShrink: 0 }} />
                </div>

                {/* Source thumbnail */}
                <div style={{ marginBottom: 20 }}>
                  <span className="edit-section-label">Source Image</span>
                  {generatedImages[editPanelImg!] ? (
                    <img src={generatedImages[editPanelImg!]} alt="source" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--card-border)', marginTop: 8, display: 'block' }} />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)', fontSize: 11, borderRadius: 10, height: 100, marginTop: 8 }}>
                      Image not available
                    </div>
                  )}
                </div>

                {/* Output Settings */}
                <div style={{ marginBottom: 20 }}>
                  <span className="edit-section-label">Output Settings <span style={{ opacity: 0.5, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(for this edit only)</span></span>
                  <div className="studio-rq-row" style={{ marginTop: 8 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <button className={`studio-rq-btn ${editRatioOpen ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setEditRatioOpen(!editRatioOpen); setEditQualOpen(false); }}>
                        <span>[ ] {editRatio.id}</span>
                        <svg viewBox="0 0 10 6" fill="none" width="10" height="6"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      </button>
                      {editRatioOpen && (
                        <div className="studio-rq-panel">
                          {ratioData.map(r => (
                            <div key={r.id} className={`studio-rq-opt ${editRatio.id === r.id ? 'active' : ''}`}
                              onClick={(e) => { e.stopPropagation(); setEditRatio(r); setEditRatioOpen(false); }}>
                              {r.id} · {r.name}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <button className={`studio-rq-btn ${editQualOpen ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setEditQualOpen(!editQualOpen); setEditRatioOpen(false); }}>
                        <span>* {editQuality.id}</span>
                        <svg viewBox="0 0 10 6" fill="none" width="10" height="6"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      </button>
                      {editQualOpen && (
                        <div className="studio-rq-panel">
                          {qualityData.map(q => (
                            <div key={q.id} className={`studio-rq-opt ${editQuality.id === q.id ? 'active' : ''}`}
                              onClick={(e) => { e.stopPropagation(); setEditQuality(q); setEditQualOpen(false); }}>
                              {q.icon} {q.id}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Edit prompt */}
                <div style={{ marginBottom: 20 }}>
                  <span className="edit-section-label">Edit Prompt</span>
                  <textarea
                    className="edit-prompt-input"
                    ref={editPromptInputRef}
                    rows={1}
                    autoFocus
                    placeholder="e.g. add a sword, change background to forest, make lighting more dramatic..."
                    value={editPrompt}
                    onChange={e => setEditPrompt(e.target.value)}
                    disabled={editGenerating}
                    style={{ marginTop: 8, resize: 'none', minHeight: '40px', maxHeight: '150px', overflowY: 'auto' }}
                  />
                  {["angle", "from the left", "from the right", "from side", "from above", "from behind", "from below", "profile", "three-quarter", "three quarter", "low angle", "high angle", "top-down", "camera", "viewpoint", "perspective"].some(k => editPrompt.toLowerCase().includes(k)) && (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                      <span>💡</span> Camera angle changes work best with specific direction, e.g. 'three-quarter view from stage left'
                    </div>
                  )}
                </div>

                {/* Style reference */}
                <div style={{ marginBottom: 20 }}>
                  <span className="edit-section-label">Style Reference <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></span>
                  <input
                    ref={editRefInputRef}
                    type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) setEditRefFile(f); }}
                  />
                  {!editRefFile ? (
                    <div className="edit-ref-zone" style={{ marginTop: 8 }} onClick={() => editRefInputRef.current?.click()}>
                      <div className="edit-ref-placeholder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="var(--dim)" strokeWidth="2" width="20" height="20">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>Upload reference image</div>
                        <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 3 }}>Style will be extracted & applied to this edit</div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', borderRadius: 10, border: '1px solid rgba(255,107,43,0.2)', marginTop: 6 }}>
                      <img src={URL.createObjectURL(editRefFile)} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(255,107,43,0.4)' }} alt="ref" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{editRefFile.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>
                          {editRefAnalyzing ? 'Analyzing style...' : editRefAnalysis ? `Analyzed via ${editRefAnalysis._model_used ?? 'vision'}` : 'Ready'}
                        </div>
                      </div>
                      {editRefAnalyzing && <div className="gen-spinner" style={{ width: 16, height: 16, borderWidth: 1.5, flexShrink: 0 }} />}
                      <button
                        style={{ background: 'rgba(220,50,50,0.15)', border: '1px solid rgba(220,50,50,0.3)', borderRadius: 6, color: '#ff6b6b', cursor: 'pointer', fontSize: 11, padding: '3px 8px', flexShrink: 0 }}
                        onClick={e => { e.stopPropagation(); setEditRefFile(null); }}
                      >Remove</button>
                    </div>
                  )}
                </div>

                {/* Vision analysis results */}
                {editRefAnalysis && !editRefAnalysis._fallback_exhausted && (
                  <div style={{ background: 'var(--surface)', border: '1px solid rgba(255,107,43,0.1)', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
                    <span className="edit-section-label" style={{ marginBottom: 10, display: 'block' }}>🔍 Detected Style - toggle to include</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {(['style', 'lighting', 'composition'] as const).map(catKey => {
                        const label = editRefAnalysis[catKey];
                        if (!label) return null;
                        const accepted = acceptedRefChips[catKey];
                        return (
                          <button
                            key={catKey}
                            onClick={() => setAcceptedRefChips(prev => ({ ...prev, [catKey]: !prev[catKey] }))}
                            style={{
                              padding: '4px 12px', borderRadius: 16, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                              border: accepted ? '1px solid rgba(255,107,43,0.6)' : '1px solid rgba(255,107,43,0.15)',
                              background: accepted ? 'rgba(255,107,43,0.15)' : 'var(--surface-strong)',
                              color: accepted ? '#ffaa66' : 'var(--dim)',
                              transition: 'all 0.15s',
                            }}
                          >
                            {accepted ? '✓ ' : ''}{catKey}: {label}
                          </button>
                        );
                      })}
                    </div>
                    {editRefAnalysis.description && (
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={includeRefDescription}
                          onChange={e => setIncludeRefDescription(e.target.checked)}
                          style={{ marginTop: 2, accentColor: 'var(--orange)', flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5 }}>
                          Include description: <em style={{ color: 'var(--dim)', opacity: 0.7 }}>“{editRefAnalysis.description}”</em>
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {/* Advanced Style Settings */}
                <div style={{ marginBottom: 24 }}>
                  <button
                    onClick={() => {
                      setEditSelections(prev => Object.keys(prev).length === 0 ? { ...selections } : prev);
                      setEditStyleModalOpen(true);
                    }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: 'var(--surface)', border: '1px solid var(--card-border)',
                      borderRadius: 10, padding: '11px 14px', cursor: 'pointer', color: 'var(--dim)',
                      fontSize: 12, fontFamily: 'inherit', transition: 'all .2s'
                    }}
                  >
                    <span>⚙️ Advanced Style Settings</span>
                    {Object.keys(editSelections).filter(k => editSelections[k]).length > 0 && (
                      <span style={{ background: 'var(--surface-strong)', border: '1px solid var(--card-border)', color: 'var(--text)', fontSize: 10, padding: '2px 7px', borderRadius: 10 }}>
                        {Object.keys(editSelections).filter(k => editSelections[k]).length} active
                      </span>
                    )}
                    <svg viewBox="0 0 10 6" fill="none" width="10" height="6"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  </button>
                  {Object.entries(editSelections).filter(([, v]) => v).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                      {Object.entries(editSelections).filter(([, v]) => v).map(([k, id]) => {
                        const item = (cats as any)[k]?.find((i: any) => i.id === id);
                        return item ? (
                          <span key={k} style={{ background: 'rgba(255,107,43,0.1)', border: '1px solid rgba(255,107,43,0.25)', color: 'var(--orange)', fontSize: 10, padding: '2px 8px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {item.label}
                            <span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setEditSelections(p => { const n = { ...p }; delete n[k]; return n; })}>×</span>
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>

                {/* Edit CTA — pinned at bottom */}
                <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--card-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    className="edit-cta-primary"
                    onClick={() => generateEdit(false)}
                    disabled={editGenerating || editRefAnalyzing || (!editPrompt.trim() && !editRefFile)}
                  >
                    {editGenerating ? <><div className="gen-spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} /> Generating...</> : '✦ Generate Edit'}
                  </button>
                  <button
                    className="edit-cta-secondary"
                    onClick={() => generateEdit(true)}
                    disabled={editGenerating || editRefAnalyzing || (!editPrompt.trim() && !editRefFile)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                    Re-run all models with this edit
                  </button>
                </div>
              </>
            ) : (
              /* === GENERATE MODE === */
              <>
                {/* Back to Studio */}
                <button
              onClick={goToStudio}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'none', border: 'none', cursor: 'pointer',
                color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
                fontSize: 12, fontFamily: 'inherit',
                padding: '4px 0', marginBottom: 8,
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = isDark ? '#fff' : '#000')}
              onMouseLeave={e => (e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M19 12H5" />
                <path d="M12 5l-7 7 7 7" />
              </svg>
              Back
            </button>



            {/* GENERATION RECOVERY TOAST */}
            {pendingJobToast && (
              <div style={{
                background: pendingJobToast.startsWith('✓') ? 'rgba(60,200,100,0.12)' : 'rgba(255,165,0,0.12)',
                border: `1px solid ${pendingJobToast.startsWith('✓') ? 'rgba(60,200,100,0.35)' : 'rgba(255,165,0,0.35)'}`,
                borderRadius: 10, padding: '10px 12px', marginBottom: 16,
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

            {/* MODEL SELECT */}
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <span className="sb-section-label">Models List</span>
              <div
                className="adv-drop-wrap sb-model-card"
                data-tooltip="Select AI models to use for generation"
                onClick={(e) => { e.stopPropagation(); setModelSelectOpen(!modelSelectOpen); setStudioRatioOpen(false); setStudioQualOpen(false); }}
              >
                <div className="sb-model-info">
                  <svg className="sb-model-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                  </svg>
                  <span className="sb-model-title">{selectedModels.length === 1 ? selectedModels[0] : `${selectedModels.length} models`}</span>
                  <span className="sb-model-badge">{selectedModels.length === 1 ? 'active' : `${selectedModels.length} selected`}</span>
                </div>
                <svg viewBox="0 0 10 6" fill="none" width="8" height="5" style={{ opacity: 0.4 }}>
                  <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>

                {modelSelectOpen && (
                  <div className="sb-model-dropdown" style={{ padding: '6px 0' }}>
                    {/* MULTI-SELECT checkboxes — clicking a model toggles it on/off */}
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '4px 14px 6px' }}>SELECT MODELS (RUN PARALLEL)</div>
                    {INTEGRATED_MODELS.map(m => {
                      const isActive = selectedModels.includes(m);
                      const dots: Record<string, string> = { 'Nanobanana 2': '#4285f4', 'Nanobanana 2 (Beta)': '#ec4899', 'Nanobanana Pro': '#E040FB', 'ChatGPT': '#00a67e', 'Kling': '#8b5cf6', 'Flux.1': '#f59e0b' };
                      const dotColor = dots[m] || '#888';
                      return (
                        <div key={m}>
                          <div
                            className={`sb-model-opt ${isActive ? 'active' : ''}`}
                            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedModels(prev => {
                                if (prev.includes(m)) {
                                  return prev.length > 1 ? prev.filter(x => x !== m) : prev;
                                }
                                return [...prev, m];
                              });
                            }}
                          >
                            {/* Checkbox square indicator */}
                            <span style={{
                              width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                              border: `2px solid ${isActive ? dotColor : 'rgba(255,255,255,0.2)'}`,
                              background: isActive ? dotColor : 'transparent',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.15s'
                            }}>
                              {isActive && <svg width="7" height="7" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </span>
                            <span style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.65)' }}>{m}</span>
                            {m === 'ChatGPT' && isActive && (
                              <span
                                style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                                onClick={(e) => { e.stopPropagation(); setChatgptSubOpen(prev => !prev); }}
                              >
                                {CHATGPT_SUB_MODELS.find(s => s.id === chatgptModel)?.label || chatgptModel} ▾
                              </span>
                            )}
                          </div>
                          {/* ChatGPT sub-model selector */}
                          {m === 'ChatGPT' && isActive && chatgptSubOpen && (
                            <div style={{ paddingLeft: 28, paddingBottom: 4 }}>
                              {CHATGPT_SUB_MODELS.map(sub => (
                                <div
                                  key={sub.id}
                                  style={{
                                    padding: '5px 10px', fontSize: 11, cursor: 'pointer', borderRadius: 6,
                                    background: chatgptModel === sub.id ? 'rgba(0,166,126,0.15)' : 'transparent',
                                    color: chatgptModel === sub.id ? '#00a67e' : 'rgba(255,255,255,0.45)',
                                    transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6
                                  }}
                                  onClick={(e) => { e.stopPropagation(); setChatgptModel(sub.id); setChatgptSubOpen(false); }}
                                >
                                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: chatgptModel === sub.id ? '#00a67e' : 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                                  {sub.label}
                                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>{sub.desc}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Divider + coming soon */}
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '6px 10px' }} />
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.2)', padding: '4px 14px 6px' }}>COMING SOON</div>
                    {COMING_SOON_MODELS.map(m => (
                      <div
                        key={m}
                        className="sb-model-opt"
                        style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.35, cursor: 'not-allowed' }}
                      >
                        <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, border: '2px solid rgba(255,255,255,0.15)', display: 'inline-block' }} />
                        <span>{m}</span>
                      </div>
                    ))}
                    {/* Parallel hint */}
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '6px 10px' }} />
                    {selectedModels.length >= 2 ? (
                      <div style={{ fontSize: 10, color: '#ff8c5f', padding: '5px 14px', lineHeight: 1.5 }}>
                        ✦ {selectedModels.length} models — results appear side-by-side
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', padding: '5px 14px', lineHeight: 1.5 }}>
                        Check multiple models to run in parallel
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Upgrade link removed */}
            </div>

            {/* PROMPT */}
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <span className="sb-section-label">Prompt</span>
              <textarea
                className="sb-prompt-textarea"
                ref={sidebarPromptRef}
                data-tooltip="Enter the text prompt for your image generation"
                placeholder="Describe your image..."
                value={prompt}
                onChange={e => {
                  setPrompt(e.target.value);
                  // User manually edited the prompt - treat as synced
                  setSettingsDirty(false);
                }}
                onDoubleClick={e => (e.target as HTMLTextAreaElement).select()}
              />
              {prompt.length > 0 && (
                <CopyButton
                  value={prompt}
                  size="sm"
                  data-tooltip="Copy prompt"
                  style={{ 
                    position: 'absolute', 
                    top: 28, 
                    right: 10, 
                background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', 
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'}`, 
                width: '26px', 
                height: '26px',
                borderRadius: '8px',
                color: isDark ? '#fff' : '#000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 0.2s',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'; }}
                />
              )}
            </div>

            {/* AI ENHANCED PROMPT — shows the full prompt sent to the model */}
            {enhancedPrompt && (
              <div style={{ marginBottom: 14 }}>
                <div
                  onClick={() => setEnhancedPromptExpanded(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer', marginBottom: 6,
                    padding: '9px 12px',
                    borderRadius: 10,
                    background: isDark ? 'rgba(255,107,43,0.13)' : 'rgba(255,107,43,0.09)',
                    border: `1.5px solid ${isDark ? 'rgba(255,107,43,0.45)' : 'rgba(255,107,43,0.35)'}`,
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = isDark ? 'rgba(255,107,43,0.2)' : 'rgba(255,107,43,0.15)')}
                  onMouseLeave={e => (e.currentTarget.style.background = isDark ? 'rgba(255,107,43,0.13)' : 'rgba(255,107,43,0.09)')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--orange)' }}>
                      ✦ AI Enhanced Prompt
                    </span>
                    {pipelineType && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                        padding: '2px 7px', borderRadius: 20,
                        background: isDark ? 'rgba(255,107,43,0.25)' : 'rgba(255,107,43,0.2)',
                        color: 'var(--orange)', border: '1px solid rgba(255,107,43,0.4)'
                      }}>
                        {pipelineType}
                      </span>
                    )}
                    <span style={{ fontSize: 9, color: 'var(--dim)', marginLeft: 2 }}>
                      {enhancedPrompt.length.toLocaleString()} chars
                    </span>
                  </div>
                  <svg
                    viewBox="0 0 10 6" fill="none" width="10" height="6"
                    style={{ transition: 'transform 0.2s', transform: enhancedPromptExpanded ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--orange)' }}
                  >
                    <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                {enhancedPromptExpanded && (
                  <div style={{
                    background: isDark ? 'rgba(255,107,43,0.05)' : 'rgba(255,107,43,0.04)',
                    border: `1px solid ${isDark ? 'rgba(255,107,43,0.2)' : 'rgba(255,107,43,0.15)'}`,
                    borderRadius: 10, padding: '10px 12px',
                    position: 'relative',
                  }}>
                    <p style={{
                      fontSize: 11, color: 'var(--dim)', lineHeight: 1.7, margin: 0,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      paddingRight: 28,
                    }}>
                      {enhancedPrompt}
                    </p>
                    <CopyButton
                      value={enhancedPrompt}
                      size="sm"
                      data-tooltip="Copy enhanced prompt"
                      style={{
                        position: 'absolute', top: 8, right: 8,
                        background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                        border: `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'}`,
                        width: '24px', height: '24px', borderRadius: '7px',
                        color: isDark ? '#fff' : '#000',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* OUTPUT SETTINGS - below prompt */}

            <div style={{ marginBottom: 14 }}>
              <span className="sb-section-label">Output Settings</span>
              <div className="studio-rq-row">
                {/* Ratio */}
                <div style={{ position: 'relative', flex: 1 }}>
                  <button
                    className={`studio-rq-btn ${studioRatioOpen ? 'active' : ''}`}
                    data-tooltip="Select image aspect ratio"
                    onClick={(e) => { e.stopPropagation(); setStudioRatioOpen(!studioRatioOpen); setStudioQualOpen(false); setModelSelectOpen(false); }}
                  >
                    <span>[ ] {ratio.id}</span>
                    <svg viewBox="0 0 10 6" fill="none" width="10" height="6"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  </button>
                  {studioRatioOpen && (
                    <div className="studio-rq-panel">
                      {ratioData.map(r => (
                        <div key={r.id} className={`studio-rq-opt ${ratio.id === r.id ? 'active' : ''}`}
                          onClick={(e) => { e.stopPropagation(); setRatio(r); setStudioRatioOpen(false); }}>
                          {r.id} · {r.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Quality */}
                <div style={{ position: 'relative', flex: 1 }}>
                  <button
                    className={`studio-rq-btn ${studioQualOpen ? 'active' : ''}`}
                    data-tooltip="Select logic/quality level"
                    onClick={(e) => { e.stopPropagation(); setStudioQualOpen(!studioQualOpen); setStudioRatioOpen(false); setModelSelectOpen(false); }}
                  >
                    <span>* {quality.id}</span>
                    <svg viewBox="0 0 10 6" fill="none" width="10" height="6"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  </button>
                  {studioQualOpen && (
                    <div className="studio-rq-panel">
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

            {/* REFERENCES */}
            <div style={{ marginBottom: 14 }}>
              <span className="sb-section-label">References</span>
              <div className="sb-ref-grid">
                {/* Style button - opens config modal on Style tab */}
                <button
                  className={`sb-ref-btn ${selections['style'] ? 'has-value' : ''}`}
                  data-tooltip="Configure visual styles, composition, and lighting"
                  onClick={() => { setConfigModalCat('style'); setConfigModalOpen(true); }}
                >
                  <span className="sb-ref-btn-icon"></span>
                  <span>{selections['style']
                    ? (cats.style.find(i => i.id === selections['style'])?.label ?? 'Style')
                    : 'Style'}</span>
                </button>
                {/* Add button - paperclip icon */}
                <button
                  className="sb-ref-btn"
                  onClick={() => fileInputRef.current?.click()}
                  data-tooltip="Upload image reference (or Ctrl+V to paste)"
                >
                  <span className="sb-ref-btn-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                  </span>
                  <span>Add</span>
                </button>
              </div>
            </div>

            {/* ACTIVE SELECTIONS chips */}
            {Object.keys(selections).length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span className="sb-section-label" style={{ marginBottom: 0 }}>Active Configs</span>
                  <span
                    onClick={() => { setSelections({}); }}
                    className="clear-all-pill"
                    data-tooltip="Clear all styles"
                  >Clear All</span>
                </div>
                <div className="sb-chips-wrap">
                  {Object.entries(selections).map(([catKey, id]) => {
                    const item = (cats as any)[catKey]?.find((i: any) => i.id === id);
                    if (!item) return null;
                    return (
                      <button
                        key={catKey}
                        className="sb-chip active"
                        data-tooltip="Remove this style"
                        onClick={() => { setConfigModalCat(catKey); setConfigModalOpen(true); }}
                      >
                        {item.label}
                        <span className="sb-chip-x" onClick={(e) => { e.stopPropagation(); removeChip(catKey); }}>X</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Uploaded reference images */}
            {uploadedFiles.length > 0 && (
              <div>
                <span className="sb-section-label">Uploaded References</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {uploadedFiles.map((f, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img
                        src={URL.createObjectURL(f)}
                        style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(255,107,43,0.4)', display: 'block' }}
                        alt={f.name}
                      />
                      <button
                        onClick={() => removeUploadedFile(i)}
                        style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: 'rgba(220,50,50,0.85)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >X</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* GENERATE / UPDATE PROMPT button */}
            {settingsDirty && prompt.trim() ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Hint banner */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,165,0,0.08)', border: '1px solid rgba(255,165,0,0.25)', borderRadius: 8, padding: '7px 10px' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,165,0,0.9)', flex: 1, lineHeight: 1.4 }}>
                    ⚠️ Settings changed - click <strong>Update Prompt</strong> to let AI rewrite your prompt with the new styles, then Generate.
                  </span>
                  <button
                    onClick={() => setSettingsDirty(false)}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}
                    data-tooltip="Dismiss and generate with original prompt"
                  >Ignore</button>
                </div>
                <StudioButton
                  loading={isRefiningPrompt}
                  onClick={async () => {
                    setIsRefiningPrompt(true);
                    try {
                      // Build selections with labels (not IDs) so Gemini understands them
                      const selectionLabels: Record<string, string> = {};
                      Object.entries(selections).forEach(([k, id]) => {
                        const item = (cats as any)[k]?.find((i: any) => i.id === id);
                        if (item) selectionLabels[k] = item.label;
                      });
                      const res = await api.post('/api/refine-prompt', {
                        prompt,
                        ratio: ratio.id,
                        quality: quality.id,
                        selections: selectionLabels
                      });
                      const data = res.data;
                      if (data.status === 'success' && data.refined_prompt) {
                        setPrompt(data.refined_prompt);
                        setSettingsDirty(false);
                      }
                    } catch (e) {
                      console.error('[refine-prompt]', e);
                    }
                    setIsRefiningPrompt(false);
                  }}
                  className="w-full bg-orange-600"
                >
                  Update Prompt
                </StudioButton>
              </div>
            ) : (
              <StudioButton
                loading={generating}
                disabled={!prompt.trim()}
                onClick={() => generate()}
                data-tooltip={!prompt.trim() ? 'Enter a prompt to generate' : 'Start image generation'}
                className="w-full bg-orange-600"
                style={{ opacity: !prompt.trim() ? 0.4 : 1, cursor: !prompt.trim() ? 'not-allowed' : 'pointer', transition: 'opacity 0.2s' }}
              >
                Generate
              </StudioButton>
            )}
              </>
            )}
          </div>

          {!editPanelImg && (
            <div className="studio-floating-actions" style={{ position: 'absolute', top: 20, right: 32, zIndex: 500, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, marginLeft: 0 }}>
                <button className="studio-icon-btn" data-tooltip="Refresh" onClick={() => window.location.reload()}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <path d="M1 4v6h6M23 20v-6h-6" />
                    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                  </svg>
                </button>

                <div className="adv-drop-wrap" style={{ position: 'relative' }}>
                  <button 
                    className={`studio-icon-btn ${gridViewOpen ? 'active' : ''}`} 
                    data-tooltip="View Layout"
                    onClick={(e) => { e.stopPropagation(); setGridViewOpen(!gridViewOpen); }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                    </svg>
                  </button>
                  {gridViewOpen && (
                    <div className="studio-rq-panel" style={{ right: 0, top: 'calc(100% + 8px)', width: 160 }}>
                      <div 
                        className={`studio-rq-opt ${gridView === 'masonry' ? 'active' : ''}`}
                        onClick={() => { setGridView('masonry'); setGridViewOpen(false); }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" style={{ marginRight: 8 }}>
                          <rect x="3" y="3" width="7" height="11" /><rect x="14" y="3" width="7" height="5" />
                          <rect x="14" y="10" width="7" height="11" /><rect x="3" y="16" width="7" height="5" />
                        </svg>
                        Masonry
                      </div>
                      <div 
                        className={`studio-rq-opt ${gridView === 'grid-2' ? 'active' : ''}`}
                        onClick={() => { setGridView('grid-2'); setGridViewOpen(false); }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" style={{ marginRight: 8 }}>
                          <rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="8" />
                          <rect x="3" y="13" width="8" height="8" /><rect x="13" y="13" width="8" height="8" />
                        </svg>
                        2 Column
                      </div>
                      <div 
                        className={`studio-rq-opt ${gridView === 'grid-3' ? 'active' : ''}`}
                        onClick={() => { setGridView('grid-3'); setGridViewOpen(false); }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" style={{ marginRight: 8 }}>
                          <rect x="2" y="2" width="5" height="5" /><rect x="9.5" y="2" width="5" height="5" /><rect x="17" y="2" width="5" height="5" />
                          <rect x="2" y="9.5" width="5" height="5" /><rect x="9.5" y="9.5" width="5" height="5" /><rect x="17" y="9.5" width="5" height="5" />
                          <rect x="2" y="17" width="5" height="5" /><rect x="9.5" y="17" width="5" height="5" /><rect x="17" y="17" width="5" height="5" />
                        </svg>
                        3 Column
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="studio-main" style={{ 
            position: 'relative',
            marginRight: '0',
            padding: '60px 30px 40px 30px',
            zIndex: hoveredIndex !== null ? 3000 : 1
          }}>

            {/* TRUE MASONRY GALLERY (PINTEREST STYLE) with Smart Session Highlighting */}
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
                  // Include pending slots (edit in progress) as well as completed images
                  available: Boolean(
                    imageMetadata[i]?.status === 'pending' ||
                    (generatedImages[i] && imageMetadata[i]?.status !== 'failed' && !failedImages.has(i))
                  )
                }))
                .filter(card => card.available);

              return (
                <div
                  className={focusMode ? "studio-gallery-focus" : (gridView === 'masonry' ? "studio-gallery-masonry" : (gridView === 'grid-2' ? "studio-gallery-grid-2" : "studio-gallery-grid-3"))}
                  style={focusMode && focusIndices.length === 1 ? { justifyContent: 'center' } : { justifyContent: 'flex-start' }}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  {/* Skeletons for currently generating images */}
                  {generating && selectedModels.map((m, i) => (
                    <div key={`skel-${i}`} className="masonry-card" style={{ aspectRatio: '1/1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,107,43,0.3)', flexShrink: 0, cursor: 'default', minHeight: 200, width: focusMode ? 600 : 'auto' }}>
                      <div className="gen-spinner" style={{ width: 32, height: 32, borderWidth: 2 }}></div>
                    </div>
                  ))}

                  {displayCards.length === 0 && !generating && (
                    <div style={{
                      gridColumn: '1 / -1',
                      height: '60vh',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'rgba(255,255,255,0.2)',
                      textAlign: 'center',
                      padding: '40px'
                    }}>
                      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ marginBottom: 20, opacity: 0.5 }}>
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                      <h2 style={{ fontSize: 20, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>No images in this session</h2>
                      <p style={{ fontSize: 14, maxWidth: 300, lineHeight: 1.6 }}>
                        Enter a prompt and click <strong>Generate</strong> to create your first masterpiece.
                      </p>
                      {compareSessionId && (
                        <button 
                          onClick={() => setCompareView(true)}
                          style={{
                            marginTop: 24,
                            background: 'rgba(255,107,43,0.15)',
                            border: '1px solid rgba(255,107,43,0.3)',
                            color: 'var(--orange)',
                            padding: '10px 20px',
                            borderRadius: 10,
                            cursor: 'pointer',
                            fontSize: 13,
                            fontWeight: 600
                          }}
                        >
                          Return to Compare Arena
                        </button>
                      )}
                    </div>
                  )}

                  {(() => {
                    return displayCards.map(({ i, src, meta }, mapIdx) => {
                      const isHovered = hoveredIndex === i;
                      const modelLabel = getModelLabel(meta?.model || meta?.models?.[0]);

                      const cardNode = (
                        <div
                          key={i}
                          className="masonry-card"
                          style={{
                            breakInside: 'avoid',
                            border: editPanelImg === i ? '2px solid var(--orange)' : isHovered ? '2px solid rgba(255,255,255,0.25)' : '2px solid transparent',
                            opacity: 1,
                            transition: 'all 0.3s cubic-bezier(0.19, 1, 0.22, 1)',
                            transform: isHovered ? 'scale(1.03)' : 'scale(1)',
                            zIndex: isHovered ? 2000 : 1
                          }}
                          onClick={() => openEditPanel(i)}
                        >
                          <div
                            className="masonry-card-media"
                            onMouseEnter={() => setHoveredIndex(i)}
                            onMouseLeave={() => setHoveredIndex(prev => (prev === i ? null : prev))}
                          >
                            {/* Session Marker Badge (Top Left) */}
                            {modelLabel && (
                              <div
                                className="masonry-card-badge"
                                style={{
                                  opacity: isHovered ? 1 : 0,
                                  transform: isHovered ? 'translateY(0)' : 'translateY(-2px)'
                                }}
                              >
                                {modelLabel}
                              </div>
                            )}

                            {meta?.status === 'pending' ? (
                              <div style={{
                                aspectRatio: '1/1',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                minHeight: focusMode ? 400 : 250,
                              }}>
                                <div className="gen-spinner" style={{ width: 40, height: 40, borderWidth: 3, marginBottom: 16 }} />
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600, letterSpacing: '0.05em' }}>
                                  GENERATING
                                </div>
                              </div>
                            ) : src && meta?.status !== 'failed' && !failedImages.has(i) ? (
                              <img
                                src={src}
                                alt={`Generated image ${i + 1}`}
                                onError={() => setFailedImages(prev => new Set(prev).add(i))}
                              />
                            ) : (
                              <div style={{
                                aspectRatio: '1/1',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(255,255,255,0.02)',
                                border: '1px dashed rgba(255,92,92,0.4)',
                                padding: '20px',
                                textAlign: 'center',
                                minHeight: focusMode ? 400 : 250,
                                gap: 12
                              }}>
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff5c5c" strokeWidth="2">
                                  <circle cx="12" cy="12" r="10" />
                                  <line x1="12" y1="8" x2="12" y2="12" />
                                  <line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                                <div style={{ fontSize: 13, color: '#ff5c5c', fontWeight: 700 }}>
                                  {meta?.model || 'Model'} failed to generate
                                </div>
                                {(meta as any)?.error_msg && (
                                  <div style={{ fontSize: 11, color: 'rgba(255,92,92,0.7)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {(meta as any).error_msg}
                                  </div>
                                )}
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                                  Try again or use a different model
                                </div>
                              </div>
                            )}

                            {/* Overlay */}
                            <div className="masonry-card-overlay">
                              <div className="masonry-card-actions" onClick={e => e.stopPropagation()}>
                                <button className="masonry-action-btn" data-tooltip="Download as PNG" onClick={(e) => { e.stopPropagation(); downloadImage(src, i, 'png'); }}>PNG</button>
                                <button className="masonry-action-btn" data-tooltip="Download as JPG (Max Quality)" onClick={(e) => { e.stopPropagation(); downloadImage(src, i, 'jpg'); }}>JPG</button>
                                <button className="masonry-action-btn" data-tooltip="Download as TIFF (Lossless)" onClick={(e) => { e.stopPropagation(); downloadImage(src, i, 'tiff'); }}>TIFF</button>
                                <button className="masonry-action-btn" data-tooltip="Upscale to Ultra 4K" onClick={(e) => { e.stopPropagation(); requestUpscale(meta?.id, src); }} style={{ background: "rgba(168, 85, 247, 0.9)", color: "#fff", borderColor: "#a855f7" }}>Upscale</button>
                                <button className="masonry-action-btn" data-tooltip="Expand full view" onClick={(e) => { e.stopPropagation(); setLightboxImg(i); }}>Expand</button>
                                <button className="masonry-action-btn promote" data-tooltip="Use as Storyboard Character" onClick={(e) => { e.stopPropagation(); setPromoteImg(i); }} style={{ background: "rgba(249, 87, 56, 0.9)", color: "#fff", borderColor: "#f95738" }}>To Storyboard</button>
                              </div>
                              {editPanelImg === i && (
                                <div style={{ position: 'absolute', top: 8, left: 8, background: 'var(--orange)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, letterSpacing: '0.05em' }}>
                                  ✦ EDITING
                                </div>
                              )}
                              {meta?.prompt && <div className="masonry-card-prompt">{meta.prompt}</div>}
                              <div className="masonry-card-meta">
                                <span>#{imageNumbers[i] ?? String(i + 1).padStart(2, '0')}</span>
                                {meta && <><span>{meta.ratio}</span><span>{meta.quality}</span></>}
                              </div>
                            </div>
                          </div>

                          {/* Inline Edit Prompt (from old feature) */}
                          {inlinePrompts[i] !== undefined && (
                            <div className="inline-edit-overlay" onClick={e => e.stopPropagation()}>
                              <div className="inline-edit-title">Refine Variant</div>
                              <textarea
                                className="inline-prompt-input"
                                autoFocus
                                placeholder="e.g. change the background to a futuristic neon city..."
                                value={inlinePrompts[i]}
                                onChange={e => setInlinePrompts(prev => ({ ...prev, [i]: e.target.value }))}
                                disabled={inlineGenerating[i]}
                              />
                              <div className="inline-edit-actions">
                                <button
                                  className="inline-btn cancel"
                                  onClick={(e) => { e.stopPropagation(); setInlinePrompts(prev => { const n = { ...prev }; delete n[i]; return n; }); }}
                                  disabled={inlineGenerating[i]}
                                >Cancel</button>
                                <button
                                  className="inline-btn generate"
                                  onClick={(e) => { e.stopPropagation(); generateInlineEdit(i); }}
                                  disabled={inlineGenerating[i] || !inlinePrompts[i].trim()}
                                >
                                  {inlineGenerating[i] ? <div className="gen-spinner" style={{ width: 14, height: 14, borderWidth: 1.5, marginRight: 6 }} /> : ' '} Generate
                                </button>
                              </div>
                              {inlineGenerating[i] && (
                                <div className="inline-edit-loading">
                                  <div className="gen-spinner" style={{ width: 32, height: 32 }}></div>
                                  <div style={{ fontSize: 11, color: 'var(--text)', marginTop: 12, fontWeight: 600 }}>Generating...</div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );

                      if (focusMode) {
                        return (
                          <div key={`focus-${i}`} className="lineage-step">
                            {cardNode}
                            {mapIdx < focusIndices.length - 1 && (
                              <div className="lineage-arrow">→</div>
                            )}
                          </div>
                        );
                      } else {
                        return cardNode;
                      }
                    });
                  })()}
                </div>
              );
            })()}


          </div>
        </div>

        {/* LIGHTBOX */}
        {lightboxImg !== null && (() => {
          const src = generatedImages[lightboxImg];
          const meta = imageMetadata[lightboxImg];
          return (
            <div className="lightbox-backdrop" onClick={() => setLightboxImg(null)}>
              <div className="lightbox-content" onClick={e => e.stopPropagation()}>
                <button className="lightbox-close-btn" aria-label="Close modal" onClick={() => setLightboxImg(null)}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                </button>
                <div className="lightbox-img-wrap">
                  {src ? (
                    <img src={src} alt="Full view" />
                  ) : (
                    <div className="lightbox-error">Image not available</div>
                  )}
                </div>
                <div className="lightbox-info">
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Image #{imageNumbers[lightboxImg] ?? String(lightboxImg + 1).padStart(2, '0')}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-geist-sans), sans-serif', marginBottom: 4 }}>Generation Info</div>
                  </div>
                  {meta?.prompt && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                        <div style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                          {meta.promptHistory && meta.promptHistory.length > 0 ? 'Final Prompt' : 'Prompt'}
                        </div>
                        {meta.promptHistory && meta.promptHistory.length > 0 && (
                          <button
                            onClick={() => setLightboxHistoryOpen(o => !o)}
                            style={{ background: 'var(--surface)', border: '1px solid var(--card-border)', borderRadius: 6, color: 'var(--dim)', cursor: 'pointer', padding: '2px 8px', fontSize: 10, fontFamily: 'inherit', transition: 'all .2s' }}
                          >
                            {lightboxHistoryOpen ? 'Hide history' : `History (${meta.promptHistory.length})`}
                          </button>
                        )}
                      </div>
                      {/* Current / final prompt */}
                      <div style={{ position: 'relative', fontSize: 12, color: 'var(--text)', lineHeight: 1.7, background: 'var(--surface)', padding: '12px 44px 12px 14px', borderRadius: 12, border: '1px solid var(--card-border)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        <CopyButton
                          value={meta.prompt}
                          size="sm"
                          data-tooltip="Copy prompt"
                          style={{
                            position: 'absolute',
                            top: 10,
                            right: 10,
                            background: 'var(--surface-strong)',
                            border: '1px solid var(--card-border)',
                            borderRadius: 8,
                            color: 'var(--text)',
                            width: 28,
                            height: 28,
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-strong)'; }}
                        />
                        {meta.prompt}
                      </div>
                      {/* Prompt history collapse */}
                      {lightboxHistoryOpen && meta.promptHistory && meta.promptHistory.length > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>Previous prompts (oldest last)</div>
                          {meta.promptHistory.map((hp, idx) => (
                            <div key={idx} style={{
                              fontSize: 11, color: 'var(--dim)', lineHeight: 1.6,
                              background: 'var(--surface)', padding: '8px 10px',
                              borderRadius: 8, border: '1px solid var(--card-border)',
                              position: 'relative', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'
                            }}>
                              <span style={{ position: 'absolute', top: 4, right: 6, fontSize: 8, color: 'var(--dim)', fontWeight: 700 }}>v{meta.promptHistory!.length - idx}</span>
                              {hp}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {meta && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>RATIO</div>
                        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{meta.ratio}</div>
                      </div>
                      <div style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>QUALITY</div>
                        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{meta.quality}</div>
                      </div>
                    </div>
                  )}
                  {meta?.models && meta.models.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Models Used</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {meta.models.map((m: string) => (
                          <span key={m} style={{ background: 'var(--surface)', border: '1px solid var(--card-border)', color: 'var(--text)', fontSize: 11, padding: '3px 10px', borderRadius: 20 }}>{getModelLabel(m)}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
                    <button onClick={() => downloadImage(src, lightboxImg, 'png')} style={{ flex: 1, padding: '10px', borderRadius: 10, background: 'var(--surface-strong)', border: '1px solid var(--card-border)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all .2s' }} onMouseOver={e => (e.currentTarget.style.background = 'var(--surface)')} onMouseOut={e => (e.currentTarget.style.background = 'var(--surface-strong)')}>PNG</button>
                    <button onClick={() => downloadImage(src, lightboxImg, 'jpg')} style={{ flex: 1, padding: '10px', borderRadius: 10, background: 'var(--surface-strong)', border: '1px solid var(--card-border)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all .2s' }} onMouseOver={e => (e.currentTarget.style.background = 'var(--surface)')} onMouseOut={e => (e.currentTarget.style.background = 'var(--surface-strong)')}>JPG</button>
                    <button onClick={() => downloadImage(src, lightboxImg, 'tiff')} style={{ flex: 1, padding: '10px', borderRadius: 10, background: 'var(--surface-strong)', border: '1px solid var(--card-border)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all .2s' }} onMouseOver={e => (e.currentTarget.style.background = 'var(--surface)')} onMouseOut={e => (e.currentTarget.style.background = 'var(--surface-strong)')}>TIFF</button>
                    <button onClick={() => { if (lightboxImg !== null) { openEditPanel(lightboxImg); setLightboxImg(null); } }} style={{ flex: 1, padding: '10px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--card-border)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', transition: 'all .2s' }} onMouseOver={e => (e.currentTarget.style.background = 'var(--surface-strong)')} onMouseOut={e => (e.currentTarget.style.background = 'var(--surface)')}>Edit</button>
                    <button onClick={() => { if (lightboxImg !== null) { setPromoteImg(lightboxImg); setLightboxImg(null); } }} style={{ flex: 1.5, padding: '10px', borderRadius: 10, background: 'rgba(249, 87, 56, 0.9)', border: '1px solid #f95738', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all .2s' }} onMouseOver={e => (e.currentTarget.style.background = 'rgba(249, 87, 56, 1)')} onMouseOut={e => (e.currentTarget.style.background = 'rgba(249, 87, 56, 0.9)')}>To Storyboard</button>
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
                        onClick={() => setEditSelections(prev => ({
                          ...prev,
                          [editStyleModalCat]: prev[editStyleModalCat] === item.id ? (delete prev[editStyleModalCat], { ...prev }) as any : item.id
                        }))}
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
                  { k: 'mood', l: 'Mood' },
                  { k: 'color', l: 'Color Palette' },
                ].map(c => (
                  <button
                    key={c.k}
                    className={`cfg-cat-btn ${configModalCat === c.k ? 'active' : ''}`}
                    onClick={() => setConfigModalCat(c.k)}
                  >
                    {c.l}
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
                    const isSelected = selections[configModalCat] === item.id;
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
        .stage {
          position: relative;
          z-index: 1;
          width: 100%;
          min-height: 0 !important;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          gap: 0;
          padding: 0 20px 20px !important;
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

        @keyframes promptPulse {
          0%, 100% {
            border-color: var(--card-border);
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2), 0 0 15px rgba(255, 107, 43, 0.03);
          }
          50% {
            border-color: rgba(255, 107, 43, 0.35);
            box-shadow: 0 12px 45px rgba(0, 0, 0, 0.28), 0 0 25px rgba(255, 107, 43, 0.12);
          }
        }

        /* Redesigned Prompt Card Styles */
        .prompt-card {
          background: #ffffff;
          border: 1.5px solid var(--card-border);
          border-radius: 16px;
          padding: 13px 16px;
          width: 100%;
          max-width: 800px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin: 0 auto 16px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: text;
          animation: promptPulse 4s infinite ease-in-out;
        }
        .dark .prompt-card {
          background: #111113;
          border-color: rgba(255, 255, 255, 0.08);
        }
        .prompt-card:hover {
          border-color: rgba(255, 107, 43, 0.45);
        }
        .prompt-card:focus-within {
          border-color: #ff6b2b;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35), 0 0 35px rgba(255, 107, 43, 0.22);
          animation: none;
        }
        .dark .prompt-card:focus-within {
          background: #131316;
        }
        .prompt-card-top {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .prompt-upload-btn {
          width: 30px;
          height: 30px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          background: var(--surface);
          border: 1px solid var(--card-border);
          color: var(--text);
          transition: all 0.2s ease;
        }
        .prompt-upload-btn:hover {
          background: var(--surface-strong);
          border-color: var(--text);
        }
        .prompt-active-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .prompt-tag-chip {
          position: relative;
          width: 51px;
          height: 57px;
          border-radius: 7px;
          border: 1.5px solid var(--card-border);
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          user-select: none;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
        }
        .prompt-tag-chip:hover {
          border-color: #ff6b2b;
          transform: translateY(-2px) scale(1.03);
          box-shadow: 0 8px 16px rgba(255, 107, 43, 0.25);
        }
        .prompt-tag-chip img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          z-index: 1;
        }
        .prompt-tag-chip-fallback {
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, var(--orange), #ff8c42);
          z-index: 1;
        }
        .prompt-tag-chip-gradient {
          position: absolute;
          inset: 0;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.3) 50%, rgba(0, 0, 0, 0) 100%);
          z-index: 2;
        }
        .prompt-tag-chip-text {
          position: relative;
          z-index: 3;
          color: #ffffff !important;
          font-size: 7px;
          font-weight: 700;
          text-align: center;
          padding: 4px 3px;
          width: 100%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        }
        .prompt-tag-chip-close {
          position: absolute;
          top: 3px;
          right: 3px;
          z-index: 4;
          width: 11px;
          height: 11px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 7px;
          font-weight: bold;
          transition: all 0.2s;
        }
        .prompt-tag-chip:hover .prompt-tag-chip-close {
          background: #ff5c5c;
          transform: scale(1.1);
        }
        .prompt-card-middle {
          width: 100%;
        }
        .prompt-card-textarea {
          width: 100%;
          background: transparent;
          border: none;
          outline: none;
          resize: none;
          color: var(--text);
          font-family: inherit;
          font-size: 15px;
          font-weight: 400;
          line-height: 1.5;
          padding: 3px 0;
        }
        .prompt-card-textarea::placeholder {
          color: var(--text);
          opacity: 0.55;
        }
        .prompt-card-bottom {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 3px;
          border-top: 1px solid var(--card-border);
          padding-top: 11px;
        }
        .prompt-card-controls {
          display: flex;
          gap: 5px;
          align-items: center;
        }
        .prompt-control-pill {
          padding: 8px 16px;
          border-radius: 100px;
          background: var(--surface);
          border: 1px solid var(--card-border);
          color: var(--text);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          font-family: inherit;
          font-size: 11px;
          transition: all 0.2s ease;
        }
        .prompt-control-pill:hover {
          background: var(--surface-strong);
          border-color: var(--text);
        }
        .prompt-generate-btn {
          padding: 9px 29px;
          border-radius: 100px;
          background: #000;
          color: #fff;
          font-weight: 700;
          font-size: 12px;
          cursor: pointer;
          border: none;
          transition: all 0.2s ease;
          box-shadow: 0 4px 15px rgba(0,0,0,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
        }
        .dark .prompt-generate-btn {
          background: #fff;
          color: #000;
        }
        .prompt-generate-btn:hover {
          transform: scale(1.02);
          opacity: 0.9;
        }
        .prompt-generate-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          transform: none;
        }

        /* Style Grid Layout Styles */
        .style-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(70px, 1fr));
          gap: 9px;
          width: 100%;
          max-width: 1600px;
          margin: 0 auto;
          padding: 8px 0;
        }
        .style-grid .thumb {
          width: 100%;
          height: auto;
          aspect-ratio: 170 / 190;
          margin: 0;
        }
        .style-grid .thumb-visual {
          width: 100%;
          height: 100%;
        }
        .style-grid .thumb-visual img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .style-grid .thumb-overlay {
          padding: 7px;
        }
        .style-grid .thumb-name {
          font-size: 12px;
          font-weight: 700;
        }
        .style-grid .thumb-desc {
          font-size: 9px;
          opacity: 0.85;
        }

        /* Capsule category pills */
        .cat-pill {
          border-radius: 100px !important;
          padding: 8px 16px !important;
          font-size: 11px !important;
        }
      `}</style>

      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)',
          background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(16px)',
          color: '#fff', padding: '8px 14px', borderRadius: '10px',
          fontSize: 16, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 99999,
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
        <div className="gen-sub">This usually takes 5â€“15 seconds</div>
      </div>

      <div className="stage">
        {/* Header row with Greeting (left) and Action buttons (right) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', maxWidth: '1200px', margin: '0 auto', padding: '16px 20px 0', marginBottom: '16px', gap: '20px', position: 'relative' }}>
          {/* Greeting */}
          <div className="greeting" style={{ 
            animation: 'premiumReveal 1.2s cubic-bezier(0.22, 1, 0.36, 1) both',
            transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            flex: 1
          }}>
            <h1 style={{
              fontSize: 'clamp(28px, 4.5vw, 42px)',
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
              marginTop: '4px',
              opacity: 0.8,
              transition: 'color 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
            }}>What would you like to Create today?</p>
          </div>
        </div>

        {/* Redesigned Premium Prompt Card */}
        <div 
          className="prompt-card"
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (!target.closest('button') && !target.closest('input') && !target.closest('label') && !target.closest('.prompt-active-tags') && !target.closest('.adv-drop-wrap')) {
              promptInputRef.current?.focus();
            }
          }}
        >
          {/* TOP ROW: Upload button + active tags */}
          <div className="prompt-card-top">
            {/* Upload button - label wrapping input = always opens picker */}
            <label
              htmlFor="home-file-upload"
              className="prompt-upload-btn"
              data-tooltip="Upload reference image (or Ctrl+V to paste)"
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
                <div className="relative flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="12" height="12">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span className="absolute -top-1.5 -right-1.5 bg-black text-white dark:bg-white dark:text-black w-2.5 h-2.5 rounded-full flex items-center justify-center text-[6px] font-extrabold">+</span>
                </div>
              )}
            </label>

            {/* Active style chips & uploaded file preview tags */}
            <div className="prompt-active-tags">
              {/* Reference image files as tags */}
              {uploadedFiles.map((f, i) => (
                <div 
                  key={`file-${i}`} 
                  className="prompt-tag-chip" 
                  onClick={() => removeUploadedFile(i)} 
                  data-tooltip={`Reference Image: ${f.name} - Click to remove`}
                >
                  <img src={URL.createObjectURL(f)} alt="ref" />
                  <div className="prompt-tag-chip-gradient" />
                  <div className="prompt-tag-chip-text">{f.name}</div>
                  <div className="prompt-tag-chip-close">×</div>
                </div>
              ))}

              {/* Selection chips */}
              {Object.entries(selections).map(([catKey, id]) => {
                const item = (cats as any)[catKey]?.find((i: any) => i.id === id);
                if (!item) return null;
                return (
                  <div 
                    key={catKey} 
                    className="prompt-tag-chip" 
                    onClick={() => removeChip(catKey)} 
                    data-tooltip={`${item.label} (${catKey.charAt(0).toUpperCase() + catKey.slice(1)}) - Click to remove`}
                  >
                    {item.img ? (
                      <img src={item.img} alt={item.label} />
                    ) : (
                      <div className="prompt-tag-chip-fallback" />
                    )}
                    <div className="prompt-tag-chip-gradient" />
                    <div className="prompt-tag-chip-text">{item.label}</div>
                    <div className="prompt-tag-chip-close">×</div>
                  </div>
                );
              })}

              {/* Clear all selections */}
              {Object.keys(selections).length > 0 && (
                <button
                  onClick={() => setSelections({})}
                  className="text-[10px] font-semibold text-orange-500 hover:text-orange-600 ml-2"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {/* MIDDLE ROW: Textarea */}
          <div className="prompt-card-middle">
            <textarea
              className="prompt-card-textarea"
              id="promptInput"
              ref={promptInputRef}
              rows={2}
              placeholder="Type a prompt..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onDoubleClick={(e) => (e.target as HTMLTextAreaElement).select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!isAnalyzing && !generating) generate();
                }
              }}
            />
          </div>

          {/* BOTTOM ROW: Controls on left, Generate button on right */}
          <div className="prompt-card-bottom">
            <div className="prompt-card-controls">
              {/* Aspect Ratio selector */}
              <div className="relative adv-drop-wrap">
                <button 
                  className="prompt-control-pill text-[11px] font-bold flex items-center gap-1.5"
                  onClick={(e) => { e.stopPropagation(); setRatioOpen(!ratioOpen); setQualOpen(false); setModelSelectOpen(false); }}
                  style={{ display: 'inline-flex', alignItems: 'center' }}
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
                  <span>Ratio: {ratio.id}</span>
                </button>
                {ratioOpen && (
                  <div 
                    className="absolute left-0 top-full mt-3.5 rounded-2xl p-4 shadow-2xl z-50 w-[480px]"
                    style={{ background: 'var(--panel)', border: '1px solid var(--card-border)', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}
                  >
                    <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3 px-1">Aspect Ratio</div>
                    <div className="grid grid-cols-5 gap-2 max-h-80 overflow-y-auto pr-1">
                      {ratioData.map(r => (
                        <div 
                          key={r.id} 
                          className={`flex flex-col items-center justify-center p-2.5 rounded-xl cursor-pointer border text-center transition-all ${
                            ratio.id === r.id 
                              ? 'bg-[#f95738]/10 border-[#f95738] text-[#f95738]' 
                              : 'border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 hover:border-gray-300 dark:hover:border-zinc-700'
                          }`} 
                          onClick={() => {
                            changeRatio(r);
                            setRatioOpen(false);
                          }}
                        >
                          {/* Visual Ratio Box */}
                          <div className={`w-10 h-10 flex items-center justify-center mb-1 bg-black/5 dark:bg-white/5 rounded-lg transition-colors ${ratio.id === r.id ? 'text-[#f95738]' : 'text-gray-400 dark:text-gray-500'}`}>
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

              {/* Quality Selector */}
              <div className="relative adv-drop-wrap">
                <button 
                  className="prompt-control-pill text-[11px] font-bold"
                  onClick={(e) => { e.stopPropagation(); setQualOpen(!qualOpen); setRatioOpen(false); setModelSelectOpen(false); }}
                >
                  ✦ Quality: {quality.id === 'Standard' ? 'SD' : quality.id === 'High' ? 'HD' : '4K'}
                </button>
                {qualOpen && (
                  <div 
                    className="absolute left-0 top-full mt-3.5 rounded-2xl p-2.5 shadow-2xl z-50 min-w-[190px] flex flex-col gap-1"
                    style={{ background: 'var(--panel)', border: '1px solid var(--card-border)', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}
                  >
                    <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 px-2 pt-1">Output Quality</div>
                    {qualityData.map(q => (
                      <div 
                        key={q.id} 
                        className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-all ${
                          quality.id === q.id 
                            ? 'bg-[#f95738]/10 text-[#f95738] font-bold' 
                            : 'hover:bg-black/5 dark:hover:bg-white/5'
                        }`} 
                        onClick={() => {
                          changeQuality(q);
                          setQualOpen(false);
                        }}
                      >
                        <span className={`text-xs ${quality.id === q.id ? 'text-[#f95738]' : 'text-gray-900 dark:text-white'}`}>{q.id}</span>
                        <span className="text-[9px] text-gray-500 dark:text-gray-400">{q.res}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Model Selector — Multi-select */}
              <div className="relative adv-drop-wrap">
                <button 
                  className="prompt-control-pill text-[11px] font-bold flex items-center gap-1.5"
                  onClick={(e) => { e.stopPropagation(); setModelSelectOpen(!modelSelectOpen); setRatioOpen(false); setQualOpen(false); }}
                >
                  ⚙️ Model:{' '}
                  {selectedModels.length === 0 ? 'Nanobanana 2'
                    : selectedModels.length === 1 ? selectedModels[0]
                    : selectedModels.length === 2 ? `${selectedModels[0]} + ${selectedModels[1]}`
                    : `${selectedModels[0]} + ${selectedModels.length - 1} more`}
                  {selectedModels.length >= 2 && (
                    <span style={{ fontSize: 9, background: 'rgba(255,107,43,0.15)', color: 'var(--orange)', border: '1px solid rgba(255,107,43,0.3)', borderRadius: 5, padding: '1px 5px', fontWeight: 700 }}>
                      {selectedModels.length}
                    </span>
                  )}
                  <svg viewBox="0 0 10 6" fill="none" width="8" height="5" className="text-gray-400"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                </button>
                {modelSelectOpen && (
                  <div 
                    className="absolute left-0 top-full mt-3.5 rounded-2xl p-2 shadow-2xl z-50 min-w-[220px] flex flex-col gap-0.5"
                    style={{ background: 'var(--panel)', border: '1px solid var(--card-border)', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}
                  >
                    <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1 px-2 pt-1">Select Models (Run Parallel)</div>
                    {AVAILABLE_MODELS.map(m => {
                      const isActive = selectedModels.includes(m);
                      const isComingSoon = COMING_SOON_MODELS.includes(m);
                      return (
                        <div 
                          key={m} 
                          className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all ${
                            isComingSoon 
                              ? 'opacity-40 cursor-not-allowed' 
                              : 'cursor-pointer'
                          }`}
                          style={{
                            background: isActive ? 'rgba(255,107,43,0.08)' : 'transparent',
                            border: `1px solid ${isActive ? 'rgba(255,107,43,0.25)' : 'transparent'}`,
                          }}
                          onClick={(e) => {
                            if (isComingSoon) return;
                            e.stopPropagation();
                            setSelectedModels(prev => {
                              if (prev.includes(m)) {
                                return prev.length > 1 ? prev.filter(x => x !== m) : prev;
                              }
                              return [...prev, m];
                            });
                          }}
                        >
                          {/* Checkbox */}
                          <div style={{
                            width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                            border: `1.5px solid ${isActive ? 'var(--orange)' : 'rgba(150,150,150,0.4)'}`,
                            background: isActive ? 'var(--orange)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}>
                            {isActive && <svg width="8" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <span className={`text-xs flex-1 ${isActive ? 'font-semibold' : 'font-normal'}`} style={{ color: isActive ? 'var(--text)' : 'var(--dim)' }}>{m}</span>
                          {isComingSoon && <span className="text-[8px] bg-gray-200 dark:bg-white/10 px-1.5 py-0.5 rounded text-gray-500 font-bold">Soon</span>}
                        </div>
                      );
                    })}
                    {selectedModels.length >= 2 && (
                      <div style={{ margin: '4px 2px 2px', padding: '6px 10px', borderRadius: 8, background: 'rgba(255,107,43,0.06)', border: '1px solid rgba(255,107,43,0.15)', fontSize: 10, color: 'var(--orange)', lineHeight: 1.5 }}>
                        ✦ Parallel generation — results appear side-by-side
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Generate Button */}
            <button
              className="prompt-generate-btn"
              onClick={() => generate()}
              disabled={generating || isAnalyzing || !prompt.trim()}
              data-tooltip={!prompt.trim() ? 'Enter a prompt to generate' : isAnalyzing ? 'Analyzing prompt...' : 'Start image generation'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="24" height="24" style={{ flexShrink: 0 }}>
                <rect x="3" y="8" width="13" height="13" rx="3" />
                <path d="M17 2c0 2.2-1.3 3.5-3.5 3.5 2.2 0 3.5 1.3 3.5 3.5 0-2.2 1.3-3.5 3.5-3.5-2.2 0-3.5-1.3-3.5-3.5z" fill="currentColor" stroke="none" />
                <path d="M9 11c0 1.25-.75 2-2 2 1.25 0 2 .75 2 2 0-1.25 .75-2 2-2-1.25 0-2-.75-2-2z" fill="currentColor" stroke="none" />
              </svg>
              <span>{isAnalyzing ? 'Analyzing...' : generating ? 'Generating...' : 'Generate'}</span>
            </button>
          </div>
        </div>

        {/* -- SOFT GATE BANNER (rendered via Portal to escape zoom context) -- */}
        {portalMounted && showStyleGate && createPortal(
          <div
            onClick={(e) => { if (e.target === e.currentTarget) setShowStyleGate(false); }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              zIndex: 999999,
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
          </div>,
          document.body
        )}

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
          <div className="cat-row-wrap" style={{ width: '100%', maxWidth: '1200px', margin: '0 auto 28px' }}>
            <button className="cat-arrow" data-tooltip="Scroll categories left" onClick={() => scrollCats(-1)}>&lsaquo;</button>
            <div className="cat-scroll" id="catScroll" ref={catScrollRef}>
              {[
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
                  {c.l}
                </button>
              ))}
            </div>
            <button className="cat-arrow" data-tooltip="Scroll categories right" onClick={() => scrollCats(1)}>&rsaquo;</button>
          </div>
        </div>

        <div className="style-grid-container" style={{ width: '100%', maxWidth: '1600px', margin: '0 auto 40px' }}>
          <div className="style-grid" key={activeCat}>
            {((cats as any)[activeCat] || []).map((item: any, idx: number) => {
                const isSelected = selections[activeCat] === item.id;
                const scoring = thumbScores[item.id];
                const tier = scoring?.tier || 'neutral';
                const showScoring = Object.keys(selections).length > 0 && !isSelected;
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
                        <svg viewBox="0 0 170 190" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%' }}>
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
            }

          </div>
        </div>

        {/* Your Recent Generations (Visible to all users) */}
        {sessionHistory && sessionHistory.length > 0 && (
          <div className="recent-inspirations-wrap" style={{ width: '100%', maxWidth: '1600px', margin: '40px auto 40px', padding: '0 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
                Your Recent Generations
              </h2>
              <button 
                onClick={() => router.push('/history')}
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--orange)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '8px',
                  transition: 'all 0.2s'
                }}
                onMouseOver={e => e.currentTarget.style.background = 'rgba(255, 107, 43, 0.08)'}
                onMouseOut={e => e.currentTarget.style.background = 'none'}
              >
                View History &rarr;
              </button>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(218px, 1fr))',
              gap: '16px',
              animation: 'fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both'
            }}>
              {sessionHistory
                .flatMap(session => (session.preview_images || []).map((imgUrl: string) => ({ imgUrl, sessionId: session.id, prompt: session.prompt })))
                .slice(0, 10)
                .map((item, idx) => (
                  <div 
                    key={`${item.sessionId}-${idx}`} 
                    className="group relative cursor-pointer overflow-hidden rounded-2xl border border-black/5 dark:border-white/5 bg-white dark:bg-[#121212]"
                    style={{ 
                      aspectRatio: '1/1', 
                      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)',
                      transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
                    }}
                    onMouseOver={e => {
                      e.currentTarget.style.transform = 'translateY(-4px) scale(1.02)';
                      e.currentTarget.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.15)';
                    }}
                    onMouseOut={e => {
                      e.currentTarget.style.transform = 'translateY(0) scale(1)';
                      e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.05)';
                    }}
                    onClick={() => router.push(`/generate?sessionId=${item.sessionId}`)}
                  >
                    <img 
                      src={item.imgUrl} 
                      alt={item.prompt || "Recent generation"} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.5s ease' }} 
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3.5 flex flex-col justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <p className="text-[12px] text-white/90 font-semibold line-clamp-2 leading-relaxed m-0 text-left">
                        {item.prompt || 'Untitled Generation'}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

