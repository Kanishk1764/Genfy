"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import { ArrowRight, Copy, Download, Edit2, Play, Maximize2, RefreshCw, X, Check, Share2 } from "lucide-react";

const galleryImages = [
  {
    src: "/landing-gallery/1.png",
    type: "portrait",
    prompt: "Cinematic close-up of a high-fashion portrait, face with intricate gold leaf makeup, dramatic lighting, 8k resolution, ultra-detailed textures, soul cinema style.",
    author: "Aura_Design",
    model: "nanobanana",
    resolution: "768x1376"
  },
  {
    src: "/landing-gallery/2.png",
    type: "square",
    prompt: "Elegant woman in flowing gold metallic dress, high-end fashion editorial shot, desert background, sunset lighting, silky fabric textures.",
    author: "Gold_Luxury",
    model: "nanobanana",
    resolution: "1024x1024"
  },
  {
    src: "/landing-gallery/4.png",
    type: "landscape",
    prompt: "Wide landscape shot of a futuristic cyberpunk city at dusk, glowing neon lights, wet streets with reflections, cinematic atmosphere, hyper-realistic.",
    author: "Neon_Dreamer",
    model: "nanobanana",
    resolution: "1376x768"
  },
  {
    src: "/landing-gallery/5.png",
    type: "portrait",
    prompt: "Ultra-detailed macro shot of a complex biomechanical eye, intricate wiring and gears, metallic reflections, glowing iris, sci-fi aesthetic.",
    author: "Cyber_Tech",
    model: "nanobanana",
    resolution: "768x1376"
  },
  {
    src: "/landing-gallery/6.png",
    type: "square",
    prompt: "Breathtaking sunset over a mountain range, golden hour light, snow-capped peaks, cinematic vista, oil painting realism.",
    author: "Peak_Visions",
    model: "nanobanana",
    resolution: "1024x1024"
  },
  {
    src: "/landing-gallery/7.png",
    type: "portrait",
    prompt: "Character concept art, a futuristic knight in obsidian armor, glowing blue accents, standing in a rain-slicked hangar, moody lighting.",
    author: "Knight_Art",
    model: "nanobanana",
    resolution: "768x1376"
  },
  {
    src: "/landing-gallery/9.png",
    type: "square",
    prompt: "Ultra-realistic 8k cinematic shot of a high-speed Formula 1 car during a night race, intense motion blur, glowing carbon fiber brakes, sparks flying from the undercarriage.",
    author: "Soul_F1_Team",
    model: "nanobanana",
    resolution: "1024x1024"
  },
  {
    src: "/landing-gallery/10.png",
    type: "square",
    prompt: "Intense hyper-realistic 8k close-up of a professional rugby player mid-sprint, mud and sweat splattered across face and jersey, grit in the teeth, muscles tensed, dramatic cinematic lighting.",
    author: "Sports_Pro",
    model: "nanobanana",
    resolution: "1024x1024"
  },
  {
    src: "/landing-gallery/11.png",
    type: "portrait",
    prompt: "High-resolution cinematic shot of a ballet dancer on a dark stage, dramatic spotlight, delicate silk textures, dust motes in the air, graceful motion frozen in time.",
    author: "Stage_Pro",
    model: "nanobanana",
    resolution: "2048x3072"
  },
  {
    src: "/landing-gallery/12.png",
    type: "landscape",
    prompt: "Cinematic 8k shot of a fighter jet piercing through high-altitude clouds, sonic boom vapor cone, clear blue sky, lens flare, professional military photography.",
    author: "Sky_Guard",
    model: "nanobanana",
    resolution: "2000x1333"
  },
  {
    src: "/landing-gallery/13.png",
    type: "portrait",
    prompt: "Luxury high-fashion editorial portrait, model in avant-garde dress on a rocky coast at sunset, wind-swept textures, hyper-realistic skin detail.",
    author: "Vogue_Vibe",
    model: "nanobanana",
    resolution: "2048x2561"
  },
  {
    src: "/landing-gallery/14.png",
    type: "portrait",
    prompt: "Gritty urban cinematic shot of a skateboarder mid-air kickflip, urban street background, motion freeze, high-contrast textures, raw realistic style.",
    author: "Street_King",
    model: "nanobanana",
    resolution: "2000x2635"
  },
  {
    src: "/landing-gallery/abstract_macro.png",
    type: "square",
    prompt: "Abstract fluid art, swirling gold and deep blue ink, liquid silk textures, macro photography, high-end luxury aesthetic.",
    author: "Fluid_Flow",
    model: "nanobanana",
    resolution: "1024x1024"
  },
  {
    src: "/landing-gallery/nature_waterfall.png",
    type: "square",
    prompt: "Tucked away hidden waterfall in a lush tropical jungle, misty air, diverse flora, sunlight filtering through leaves, long exposure water physics.",
    author: "Nature_Path",
    model: "nanobanana",
    resolution: "1024x1024"
  },
  {
    src: "/landing-gallery/user_3.png",
    type: "landscape",
    prompt: "High-density urban sprawl at twilight, intricate building textures, glowing windows, cinematic atmospheric perspective, 8k resolution.",
    author: "City_Scaper",
    model: "nanobanana",
    resolution: "1376x768"
  },
  {
    src: "/landing-gallery/user_5.png",
    type: "landscape",
    prompt: "Vibrant high-fashion portrait with neon pink and cyan light accents, realistic skin pore detail, dramatic shadow play, Soul Cinema artistic aesthetic.",
    author: "Neon_Aura",
    model: "nanobanana",
    resolution: "1376x768"
  },
  {
    src: "/landing-gallery/user_6.png",
    type: "landscape",
    prompt: "Cinematic close-up portrait of a thoughtful man in a rain-slicked trench coat, water droplets on fabric, neon street reflections, high contrast film noir style.",
    author: "Noir_Frames",
    model: "nanobanana",
    resolution: "1376x768"
  },
  {
    src: "/landing-gallery/generated-image-history-1.png",
    type: "square",
    prompt: "Vibrant sci-fi metropolis with flying cars and glowing neon signs, cinematic depth of field, 8k resolution.",
    author: "Genfy_User",
    model: "nanobanana",
    resolution: "2048x2048"
  },
  {
    src: "/landing-gallery/generated-image-history-2.png",
    type: "square",
    prompt: "Mystical ancient forest with glowing bioluminescent plants, ethereal fantasy atmosphere, high detail, masterpiece.",
    author: "Genfy_User",
    model: "nanobanana",
    resolution: "2048x2048"
  },
  {
    src: "/landing-gallery/generated-image-history-3.png",
    type: "square",
    prompt: "Macro photography of an intricate crystalline structure, refracting prismatic light, sharp focus, 8k.",
    author: "Genfy_User",
    model: "nanobanana",
    resolution: "2048x2048"
  }
];

export default function CinemaGallery({ isDark }: { isDark: boolean }) {
  const [selectedImage, setSelectedImage] = useState<typeof galleryImages[0] | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [isCopied, setIsCopied] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);

  useEffect(() => {
    if (selectedImage) {
      setIsPromptExpanded(false);
      setIsZoomed(false);
    }
  }, [selectedImage]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 4000);
  };

  const handleDownload = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `genfy-image-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error('Error downloading image:', error);
    }
  };

  const visibleImages = galleryImages.filter(img => !failedImages.has(img.src));

  return (
    <div className={`w-full transition-colors duration-300 ${isDark ? "bg-[#0a0a0a]" : "bg-white"}`}>
    <section className="w-full max-w-[1440px] mx-auto px-6 pt-20 pb-0 relative">
      <div className="flex flex-col gap-4 mb-16 text-center max-w-4xl mx-auto overflow-hidden">
        <h2 className={`text-4xl md:text-5xl lg:text-7xl font-black uppercase tracking-tighter whitespace-nowrap ${isDark ? "text-white" : "text-slate-900"}`}>
          GENFY CINEMA GALLERY
        </h2>
        <p className={`text-lg md:text-xl font-medium ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Explore stunning creations from our community of high-performance visionary creators.
        </p>
      </div>

      {/* Masonry Layout with mask-image fade — covers ALL columns uniformly */}
      <div className="relative rounded-[40px]">
        <div
          className="columns-2 md:columns-3 lg:columns-4 gap-6 space-y-6"
          style={{
            maskImage: `linear-gradient(to bottom, black 0%, black 50%, rgba(0,0,0,0.4) 75%, transparent 100%)`,
            WebkitMaskImage: `linear-gradient(to bottom, black 0%, black 50%, rgba(0,0,0,0.4) 75%, transparent 100%)`,
          }}
        >
          {visibleImages.map((img, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: idx * 0.05 }}
              viewport={{ once: true }}
              onClick={() => setSelectedImage(img)}
              className={`group relative rounded-[24px] md:rounded-[32px] overflow-hidden cursor-pointer break-inside-avoid transition-shadow duration-300 ${isDark ? "border border-white/5 shadow-2xl" : "shadow-md"}`}
            >
              <img
                src={img.src}
                alt={img.prompt}
                className="w-full h-auto object-contain transition-transform duration-700 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-6">
                <p className="text-white text-xs font-medium line-clamp-2 opacity-80">{img.prompt}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Overlay for the CTA button — sits above the faded grid */}
        <div className="absolute inset-x-0 bottom-0 h-[200px] flex items-end justify-center pb-8 pointer-events-none z-10">
          <div className="pointer-events-auto">
            <Link
              href="/gallery"
              className={`flex items-center gap-2 px-8 py-3.5 rounded-full transition-all hover:scale-[1.02] active:scale-95 backdrop-blur-md shadow-xl border ${isDark
                  ? "bg-white/10 border-white/20 text-white hover:bg-white/20"
                  : "bg-white/80 border-slate-200 text-slate-800 hover:bg-slate-50"
                }`}
            >
              <span className="text-[15px] font-medium tracking-tight">
                View all of Genfy Cinema Gallery
              </span>
              <ArrowRight className="w-5 h-5 opacity-80" />
            </Link>
          </div>
        </div>
      </div>

      {/* Lightbox Modal with Sidebar */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-[4px] md:p-4 lg:p-8 ${isDark ? "bg-black/40" : "bg-black/20"}`}
          >
            <div className={`relative flex flex-col lg:flex-row rounded-[32px] overflow-hidden shadow-2xl transition-all duration-500 ease-in-out ${
              isDark ? "bg-[#080808] border border-white/10" : "bg-white border-none"
            } ${selectedImage.type === 'portrait'
                ? 'w-full max-w-[1100px] h-[92vh]'
                : 'w-[95vw] h-[92vh] max-w-[1600px]'
              }`}>
              <button
                onClick={() => setSelectedImage(null)}
                className={`absolute top-6 right-6 z-[120] p-2 rounded-full backdrop-blur-md transition-all border ${
                  isDark 
                    ? "bg-white/5 text-white/50 border-white/10 hover:bg-red-500/20 hover:text-red-400" 
                    : "bg-slate-100/80 text-slate-500 border-slate-200 hover:bg-red-50 hover:text-red-500"}`}
              >
                <X className="w-4 h-4" />
              </button>

              {/* Image Preview Area - Full Scale */}
              <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-black">
                <img
                  src={selectedImage.src}
                  alt="Full preview"
                  onClick={() => setIsZoomed(true)}
                  className="w-full h-full object-contain cursor-zoom-in"
                />

                <button className={`absolute top-6 left-6 flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-md transition-all border text-xs font-bold ${
                  isDark ? "bg-white/10 text-white border-white/10 hover:bg-white/20" : "bg-white/80 text-slate-900 border-slate-200 hover:bg-white"}`}>
                  <Share2 className="w-3 h-3" /> SHARE
                </button>
              </div>

              {/* Sidebar Section */}
              <div className={`w-full lg:w-[400px] p-6 lg:p-8 pt-12 lg:pt-12 flex flex-col overflow-y-auto border-l custom-scrollbar ${
                isDark ? "bg-[#0d0d0d] border-white/10" : "bg-slate-100/80 border-transparent shadow-[-10px_0_30px_rgba(0,0,0,0.02)]"
              }`}>
                <div className="mb-8">
                  <div className={`flex items-center gap-2 mb-4 text-xs font-bold uppercase tracking-wider ${isDark ? "text-gray-400" : "text-slate-500"}`}>
                    PROMPT
                  </div>
                  <div className={`relative p-5 rounded-2xl border leading-relaxed font-medium ${
                    isDark ? "bg-white/5 border-white/5 text-gray-200" : "bg-white border-slate-200 text-slate-900 shadow-sm"
                  }`}>
                    <button
                      onClick={() => handleCopy(selectedImage.prompt)}
                      className={`absolute top-3 right-3 p-1.5 rounded-[10px] transition-all border ${
                        isDark ? "bg-[#0d0d0d] border-white/10 text-gray-400 hover:border-white/20 active:text-white" : "bg-slate-50 border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 active:text-slate-900"
                      } ${isCopied ? "text-white" : ""}`}
                      title={isCopied ? "Copied!" : "Copy prompt"}
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <p className={`pr-8 text-base ${!isPromptExpanded ? 'line-clamp-3' : ''}`}>"{selectedImage.prompt}"</p>
                    {selectedImage.prompt.length > 80 && (
                      <button 
                         onClick={() => setIsPromptExpanded(!isPromptExpanded)}
                         className={`block mt-3 text-xs font-bold transition-all ${isDark ? "text-white/50 hover:text-white" : "text-slate-500 hover:text-slate-900"}`}
                      >
                         {isPromptExpanded ? "See less ↑" : "See all ↓"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mb-10">
                  <div className={`flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-wider ${isDark ? "text-gray-400" : "text-slate-500"}`}>
                    <RefreshCw className="w-4 h-4" /> INFORMATION
                  </div>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-sm">
                      <span className={`${isDark ? "text-gray-500" : "text-slate-400"} font-medium`}>Model</span>
                      <span className={`${isDark ? "text-white" : "text-slate-900"} font-bold`}>Nanobanana</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className={`${isDark ? "text-gray-500" : "text-slate-400"} font-medium`}>Quality</span>
                      <span className={`${isDark ? "text-white" : "text-slate-900"} font-bold`}>Ultra High (8K)</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className={`${isDark ? "text-gray-500" : "text-slate-400"} font-medium`}>Resolution</span>
                      <span className={`${isDark ? "text-white" : "text-slate-900"} font-bold`}>{selectedImage.resolution}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-auto space-y-3">
                  <button className="w-full py-4 rounded-xl bg-[#f95738] text-white font-black text-sm uppercase tracking-tighter hover:scale-[1.02] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#f95738]/20">
                    <RefreshCw className="w-4 h-4" /> Recreate
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    {["Video", "Download", "Upscale", "Edit"].map((label) => (
                      <button 
                        key={label}
                        onClick={() => label === "Download" ? handleDownload(selectedImage.src) : null}
                        className={`py-3 rounded-xl border font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                          isDark 
                            ? "bg-white/5 text-white border-white/5 hover:bg-white/10" 
                            : "bg-white text-slate-900 border-slate-200 hover:bg-slate-50 shadow-sm"
                        }`}
                      >
                        {label === "Video" && <Play className="w-4 h-4" />}
                        {label === "Download" && <Download className="w-4 h-4" />}
                        {label === "Upscale" && <Maximize2 className="w-4 h-4" />}
                        {label === "Edit" && <Edit2 className="w-4 h-4" />}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isZoomed && selectedImage && (
           <motion.div 
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-xl"
           >
             <button 
                 onClick={() => setIsZoomed(false)}
                 className="absolute top-6 right-6 z-[220] p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-all border border-white/10"
               >
                 <X className="w-6 h-6" />
             </button>
             <img 
                 src={selectedImage.src} 
                 alt="Zoomed" 
                 className="w-auto h-auto max-w-[75vw] max-h-[75vh] object-contain cursor-zoom-out shadow-2xl"
                 onClick={() => setIsZoomed(false)}
             />
           </motion.div>
        )}
      </AnimatePresence>

    </section>
    </div>
  );
}
