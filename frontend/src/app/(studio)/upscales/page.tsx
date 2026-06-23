"use client";

import React, { useEffect, useState, useRef } from "react";
import api from "@/utils/api";

export default function UpscalesPage() {
  const [upscales, setUpscales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const fetchUpscales = async () => {
    try {
      const res = await api.get(`/api/upscales?_=${Date.now()}`);
      setUpscales(res.data.upscales || []);
    } catch (e) {
      console.error("Failed to fetch upscales", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUpscales();
  }, []);

  useEffect(() => {
    // Poll every 3s as long as there is any pending/processing upscale
    const hasPending = upscales.some((u) => u.status === "pending" || u.status === "processing");
    if (!hasPending) return;

    const interval = setInterval(fetchUpscales, 3000);
    return () => clearInterval(interval);
  }, [upscales]);

  const downloadImage = (url: string, index: number) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `genfy-upscale-${index + 1}.png`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const timeAgo = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
      if (isNaN(seconds)) return "";
      
      let interval = Math.floor(seconds / 31536000);
      if (interval >= 1) return `${interval}y ago`;
      interval = Math.floor(seconds / 2592000);
      if (interval >= 1) return `${interval}mo ago`;
      interval = Math.floor(seconds / 86400);
      if (interval >= 1) return `${interval}d ago`;
      interval = Math.floor(seconds / 3600);
      if (interval >= 1) return `${interval}h ago`;
      interval = Math.floor(seconds / 60);
      if (interval >= 1) return `${interval}m ago`;
      return "Just now";
    } catch (e) {
      return "";
    }
  };

  const cancelUpscale = async (id: string) => {
    try {
      await api.post(`/api/upscale/${id}/cancel`);
      fetchUpscales();
    } catch (e) {
      console.error("Failed to cancel upscale", e);
    }
  };

  return (
    <>
      {previewImg && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPreviewImg(null)}
          style={{ backdropFilter: 'blur(10px)' }}
        >
          <button 
            className="absolute top-6 right-6 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white text-xl backdrop-blur transition-colors"
            onClick={() => setPreviewImg(null)}
          >×</button>
          <img 
            src={previewImg} 
            alt="Preview" 
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" 
            onClick={e => e.stopPropagation()} 
          />
        </div>
      )}
    <div className="w-full h-full min-h-screen pt-4 pb-20 px-6 max-w-[1400px] mx-auto overflow-y-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <span style={{ color: "#a855f7" }}>✦</span> Upscaled Library
          </h1>
          <p style={{ color: 'var(--dim)' }} className="text-sm mt-1">
            View your manually upscaled Ultra 4K images.
          </p>
        </div>
        <button
          onClick={fetchUpscales}
          className="px-4 py-2 rounded-full text-sm font-medium transition-colors"
          style={{ background: 'var(--surface)', border: '1px solid var(--card-border)', color: 'var(--text)' }}
          onMouseOver={e => { e.currentTarget.style.background = 'var(--surface-strong)'; }}
          onMouseOut={e => { e.currentTarget.style.background = 'var(--surface)'; }}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[50vh]">
          <div className="w-8 h-8 border-4 border-[#a855f7]/20 border-t-[#a855f7] rounded-full animate-spin"></div>
        </div>
      ) : upscales.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[50vh] text-center border border-dashed rounded-3xl" style={{ borderColor: 'var(--card-border)', background: 'var(--surface)' }}>
          <span className="text-5xl mb-4 opacity-50">✦</span>
          <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>No upscaled images yet</h3>
          <p className="max-w-sm" style={{ color: 'var(--dim)' }}>
            Generate images in the Studio and click the "Upscale" button to enhance them to Ultra 4K.
          </p>
        </div>
      ) : (
        <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-6 space-y-6">
          {upscales.map((item: any, i: number) => {
            const isPending = item.status === "pending" || item.status === "processing";
            const isCancelled = item.status === "cancelled";
            const isSuccess = item.status === "success";

            return (
              <div
                key={item.id}
                className="break-inside-avoid mb-6 relative rounded-2xl overflow-hidden group border"
                style={{
                  minHeight: isSuccess ? "auto" : 250,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderColor: 'var(--card-border)',
                  background: 'var(--surface)'
                }}
              >
                {isSuccess && item.url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt="Upscaled image"
                      className="w-full h-auto object-cover"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='250' viewBox='0 0 400 250' fill='%231a1a1a'%3E%3Crect width='400' height='250' fill='%231a1a1a'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle' font-family='sans-serif' font-size='14' fill='%23666'%3EImage Unavailable%3C/text%3E%3C/svg%3E";
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold px-2 py-1 bg-[#a855f7] rounded text-white shadow-lg">
                          ULTRA 4K
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setPreviewImg(item.url)}
                            className="px-3 py-1.5 bg-black/40 hover:bg-black/60 backdrop-blur rounded text-xs font-bold text-white transition-colors border border-white/10"
                          >
                            Preview
                          </button>
                          <button
                            onClick={() => downloadImage(item.url, i)}
                            className="px-3 py-1.5 bg-white/20 hover:bg-white/30 backdrop-blur rounded text-xs font-bold text-white transition-colors"
                          >
                            Download
                          </button>
                        </div>
                      </div>
                      <div className="text-xs text-white/50 mt-2">
                        {item.created_at ? timeAgo(item.created_at) : ""}
                      </div>
                    </div>
                  </>
                ) : isPending ? (
                  <div className="flex flex-col items-center justify-center text-center p-6 w-full h-full">
                    <div className="w-8 h-8 border-2 border-[#a855f7]/30 border-t-[#a855f7] rounded-full animate-spin mb-3"></div>
                    <div className="text-[#a855f7] font-bold text-sm">Upscaling...</div>
                    <div className="text-xs mt-2 max-w-[200px] mb-4" style={{ color: 'var(--dim)' }}>
                      Tile-based rendering in progress (60-90s).
                    </div>
                    <button
                      onClick={() => cancelUpscale(item.id)}
                      className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-full text-xs font-semibold transition-colors flex items-center gap-1.5"
                    >
                      <span>🛑</span> Stop Upscaling
                    </button>
                  </div>
                ) : isCancelled ? (
                  <div className="flex flex-col items-center justify-center text-center p-6">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 text-sm font-bold mb-2">⏹</div>
                    <div className="text-amber-400 font-bold text-sm mb-1">Upscale Stopped</div>
                    <div className="text-xs text-amber-400/70">Cancelled by user</div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center p-6">
                    <svg className="w-8 h-8 text-red-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-red-400 font-bold text-sm mb-1">Upscale Failed</div>
                    {item.error_msg && (
                      <div className="text-red-400/70 text-xs max-w-[200px] truncate" title={item.error_msg}>
                        {item.error_msg}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    </>
  );
}
