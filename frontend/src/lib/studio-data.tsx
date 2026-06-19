// ─────────────────────────────────────────────────────────────────────────────
// SHARED STUDIO DATA & UTILITIES
// Extracted from studio/page.tsx and generate/page.tsx to eliminate duplication.
// ─────────────────────────────────────────────────────────────────────────────

// ------------------------------------------------------------------
// RECOMMENDATION MAPPINGS
// ------------------------------------------------------------------
export const KEY_TO_JSON: Record<string, string> = {
  style: 'visualStyle', medium: 'medium', lighting: 'lighting',
  composition: 'composition', camera: 'cameraAngle', lens: 'lens',
  mood: 'mood', color: 'colorPalette'
};
export const JSON_TO_KEY: Record<string, string> = {
  visualStyle: 'style', medium: 'medium', lighting: 'lighting',
  composition: 'composition', cameraAngle: 'camera', lens: 'lens',
  mood: 'mood', colorPalette: 'color'
};

// ------------------------------------------------------------------
// ASPECT RATIO DATA
// ------------------------------------------------------------------
export const ratioData = [
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

export const qualityData = [
  { id: 'Standard', label: 'Standard', res: '1K', icon: '*', desc: 'Fast · 1K (1024px)', prompt: 'standard quality' },
  { id: 'High',     label: 'High',     res: '2K', icon: '*', desc: 'Balanced · 2K (2048px)', prompt: 'high quality, highly detailed' },
  { id: 'Ultra',    label: 'Ultra',    res: '4K', icon: '*', desc: 'Max detail · 4K (4096px)', prompt: 'ultra quality, maximum detail, 8K resolution, masterpiece' },
];

// ------------------------------------------------------------------
// MODELS
// ------------------------------------------------------------------
export const AVAILABLE_MODELS = ['Nanobanana 2', 'Nanobanana Pro', 'ChatGPT', 'Kling', 'Flux.1', 'Midjourney', 'Stable Diffusion', 'Grok-2'];
export const INTEGRATED_MODELS = ['Nanobanana 2', 'Nanobanana Pro', 'ChatGPT', 'Kling', 'Flux.1'];
export const COMING_SOON_MODELS = ['Midjourney', 'Stable Diffusion', 'Grok-2'];
export const DEFAULT_SELECTED_MODELS = ['Nanobanana 2'];
export const DEFAULT_COMPARE_MODELS = INTEGRATED_MODELS;

export const CHATGPT_SUB_MODELS = [
  { id: 'gpt-image-2', label: 'GPT Image 2', desc: 'State-of-the-art' },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5', desc: 'Previous flagship' },
  { id: 'chatgpt-image-latest', label: 'ChatGPT Image Latest', desc: 'Latest default' },
  { id: 'gpt-image-1', label: 'GPT Image 1', desc: 'Previous generation' },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1 Mini', desc: 'Cost-efficient' },
];

// ------------------------------------------------------------------
// STYLE CATEGORIES DATA
// ------------------------------------------------------------------
export const cats = {
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

// ------------------------------------------------------------------
// HELPER FUNCTIONS
// ------------------------------------------------------------------
export function getModelColor(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('kling')) return '#FF6B2B';
  if (m.includes('chatgpt')) return '#10A37F';
  if (m.includes('flux')) return '#8B5CF6';
  if (m.includes('nanobanana pro')) return '#E040FB';
  if (m.includes('nanobanana')) return '#FACC15';
  if (m.includes('midjourney')) return '#3B82F6';
  return '#64748b';
}

export function getModelLabel(model?: string | null): string {
  if (!model) return '';
  const raw = String(model).trim();
  const m = raw.toLowerCase();
  if (m.includes('gpt-image') || m.includes('chatgpt')) return 'ChatGPT';
  if (m.includes('flux')) return 'Flux';
  if (m.includes('nanobanana pro')) return 'Nanobanana Pro';
  if (m.includes('nanobanana')) return 'Nanobanana 2';
  if (m.includes('midjourney')) return 'Midjourney';
  if (m.includes('stable diffusion') || m.includes('stable-diffusion') || m === 'sd') return 'Stable Diffusion';
  if (m.includes('kling')) return 'Kling';
  if (m.includes('grok')) return 'Grok';
  return raw.replace(/[._-]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

import React from 'react';

export function getShapeSVG(id: string, cat: string, item: any): React.ReactNode {
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
