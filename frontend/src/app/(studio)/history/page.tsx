'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { useTheme } from "@/context/theme-context";
import { useAuth } from "@/context/auth-context";
import { API_BASE_URL } from "@/utils/api";
import StudioPage from "../studio/page";

type HistorySession = {
  id: string;
  type?: 'session' | 'compare';
  prompt?: string | null;
  created_at?: string | null;
  latest_activity_at?: string | null;
  preview_images?: string[];
};

type FlatImage = {
  url: string;
  sessionId: string;
  prompt: string;
  date: string;
  imgIdx: number;
  sessionIdx: number;
};

function parseDate(raw?: string | null): Date | null {
  if (!raw) return null;
  let str = String(raw).trim();
  if (!str.endsWith('Z') && !str.includes('+') && !str.includes('-', 10)) {
    str = str.replace(' ', 'T') + 'Z';
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function formatRelative(raw?: string | null): string {
  const d = parseDate(raw);
  if (!d) return 'Recently';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getGroup(raw?: string | null): string {
  const d = parseDate(raw);
  if (!d) return 'Earlier';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This Week';
  if (days < 30) return 'This Month';
  return 'Earlier';
}

const GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'This Month', 'Earlier'];

export default function HistoryPage() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  
  const isAdmin = Boolean(user && (user.role === 'admin' || (user as any)?.is_admin));
  const [showAdminHistory, setShowAdminHistory] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('genfy_show_admin_history') === 'true';
    }
    return false;
  });

  useEffect(() => {
    const handleStorage = () => {
      if (typeof window !== 'undefined') {
        setShowAdminHistory(localStorage.getItem('genfy_show_admin_history') === 'true');
      }
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('genfy_admin_history_toggled', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('genfy_admin_history_toggled', handleStorage);
    };
  }, []);

  const toggleAdminHistory = () => {
    const nextVal = !showAdminHistory;
    setShowAdminHistory(nextVal);
    if (typeof window !== 'undefined') {
      localStorage.setItem('genfy_show_admin_history', String(nextVal));
      window.dispatchEvent(new Event('genfy_admin_history_toggled'));
    }
  };

  const [sessionHistory, setSessionHistory] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [pollEnabled, setPollEnabled] = useState(true);
  const [brokenPreviews, setBrokenPreviews] = useState<Set<string>>(new Set());
  const [hoveredImg, setHoveredImg] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const reuseId = searchParams.get('reuse');
  const inFlightRef = useRef(false);
  const failureCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sortSessions = useCallback((sessions: HistorySession[]) =>
    [...sessions].sort((a, b) => {
      const aTime = parseDate(a.latest_activity_at || a.created_at)?.getTime() || 0;
      const bTime = parseDate(b.latest_activity_at || b.created_at)?.getTime() || 0;
      return bTime - aTime;
    }), []);

  const fetchHistory = useCallback(async (silent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      if (!silent) setLoading(true);
      const res = await fetch(`${API_BASE_URL}/api/sessions?_=${Date.now()}`, {
        method: 'GET', credentials: 'include', cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setSessionHistory(sortSessions((data.sessions || []) as HistorySession[]));
      setBrokenPreviews(new Set());
      failureCountRef.current = 0;
      setPollEnabled(true);
    } catch (e) {
      failureCountRef.current += 1;
      if (!silent) toast.error('Failed to load history');
      if (failureCountRef.current >= 3) setPollEnabled(false);
    } finally {
      if (!silent) setLoading(false);
      inFlightRef.current = false;
    }
  }, [sortSessions, isAdmin, showAdminHistory]);

  useEffect(() => {
    if (reuseId) return;
    let active = true;
    const load = async (silent = false) => { if (active) await fetchHistory(silent); };
    const schedulePoll = (delay: number) => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(async () => {
        if (!active) return;
        if (pollEnabled) await load(true);
        schedulePoll(failureCountRef.current > 0 ? 5000 : 2000);
      }, delay);
    };
    load(false);
    schedulePoll(2000);
    const onFocus = () => load(true);
    const onVis = () => { if (document.visibilityState === 'visible') load(true); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      active = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [reuseId, fetchHistory, pollEnabled]);

  if (reuseId) return <StudioPage />;

  const deleteSession = async (sessId: string) => {
    if (!window.confirm('Delete this session and all its images? This cannot be undone.')) return;
    setSessionHistory(h => h.filter(s => s.id !== sessId));
    setDeleteId(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/sessions/${sessId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      toast.success('Session deleted');
    } catch (e) {
      toast.error('Failed to delete. Please retry.');
      fetchHistory(true);
    }
  };

  // Group sessions by date
  const grouped: Record<string, HistorySession[]> = {};
  for (const sess of sessionHistory) {
    const g = getGroup(sess.latest_activity_at || sess.created_at);
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(sess);
  }
  const orderedGroups = GROUP_ORDER.filter(g => grouped[g]);

  // Flatten all images for total count
  const totalImages = sessionHistory.reduce((acc, s) => acc + (s.preview_images?.length || 0), 0);

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
      fontFamily: 'var(--font-geist-sans), sans-serif',
    }}>
      <style>{`
        @keyframes fadeUpHist {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spinHist {
          to { transform: rotate(360deg); }
        }
        .hist-masonry {
          columns: 4 160px;
          column-gap: 12px;
        }
        .hist-img-tile {
          break-inside: avoid;
          margin-bottom: 12px;
          border-radius: 14px;
          overflow: hidden;
          position: relative;
          cursor: pointer;
          background: var(--surface);
          border: 1.5px solid transparent;
          transition: border-color 0.2s, box-shadow 0.2s, transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
        }
        .hist-img-tile:hover {
          border-color: rgba(255,107,43,0.4);
          box-shadow: 0 12px 36px rgba(0,0,0,0.3);
          transform: translateY(-3px) scale(1.01);
          z-index: 2;
        }
        .hist-img-tile img {
          width: 100%;
          height: auto;
          display: block;
          transition: transform 0.4s cubic-bezier(0.4,0,0.2,1);
        }
        .hist-img-tile:hover img {
          transform: scale(1.04);
        }
        .hist-img-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0) 100%);
          opacity: 0;
          transition: opacity 0.25s;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: 14px 12px 12px;
          pointer-events: none;
        }
        .hist-img-tile:hover .hist-img-overlay {
          opacity: 1;
        }
        .hist-img-prompt {
          font-size: 11px;
          font-weight: 600;
          color: rgba(255,255,255,0.92);
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .hist-img-meta {
          font-size: 10px;
          color: rgba(255,255,255,0.5);
          margin-top: 4px;
          font-weight: 500;
        }
        .hist-open-badge {
          position: absolute;
          top: 10px;
          right: 10px;
          background: rgba(255,107,43,0.9);
          backdrop-filter: blur(8px);
          border-radius: 99px;
          padding: 4px 10px;
          font-size: 10px;
          font-weight: 700;
          color: #fff;
          opacity: 0;
          transition: opacity 0.2s;
          pointer-events: none;
          letter-spacing: 0.03em;
        }
        .hist-img-tile:hover .hist-open-badge {
          opacity: 1;
        }
        .hist-group-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text);
          opacity: 0.4;
          margin: 0 0 14px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--card-border);
        }
        .hist-session-row {
          margin-bottom: 32px;
          animation: fadeUpHist 0.5s cubic-bezier(0.22,1,0.36,1) both;
        }
        .hist-session-header {
          display: flex;
          align-items: baseline;
          gap: 10px;
          margin-bottom: 10px;
        }
        .hist-session-prompt {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--text);
          opacity: 0.75;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 480px;
        }
        .hist-session-time {
          font-size: 11px;
          color: var(--text);
          opacity: 0.35;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .hist-session-del {
          margin-left: auto;
          flex-shrink: 0;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text);
          opacity: 0.3;
          padding: 2px 6px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          transition: opacity 0.2s, background 0.2s;
        }
        .hist-session-del:hover {
          opacity: 1;
          background: rgba(255,80,80,0.12);
          color: #ff5c5c;
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--card-border)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}>
        <div style={{
          maxWidth: 1400, margin: '0 auto',
          padding: '16px 40px',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text)' }}>
              My Generations
            </div>
            {!loading && totalImages > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text)', opacity: 0.4, marginTop: 2, fontWeight: 500 }}>
                {totalImages} image{totalImages !== 1 ? 's' : ''} across {sessionHistory.length} session{sessionHistory.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => router.push('/studio')}
              style={{
                padding: '8px 16px', borderRadius: 10,
                background: 'var(--surface)', border: '1px solid var(--card-border)',
                color: 'var(--text)', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
              }}
              onMouseOver={e => e.currentTarget.style.background = 'var(--surface-strong)'}
              onMouseOut={e => e.currentTarget.style.background = 'var(--surface)'}
            >
              ← Studio
            </button>
            <button
              onClick={() => router.push('/generate')}
              style={{
                padding: '8px 18px', borderRadius: 10,
                background: 'linear-gradient(135deg, #FF6B2B, #E040C8)',
                border: 'none', color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 4px 14px rgba(255,107,43,0.35)',
                transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6,
              }}
              onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(255,107,43,0.45)'; }}
              onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(255,107,43,0.35)'; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Generation
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 40px 80px' }}>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
            <div style={{
              width: 36, height: 36,
              border: '3px solid rgba(255,107,43,0.2)',
              borderTopColor: '#FF6B2B',
              borderRadius: '50%',
              animation: 'spinHist 0.8s linear infinite',
            }} />
            <div style={{ fontSize: 13, color: 'var(--text)', opacity: 0.45, fontWeight: 500 }}>Loading your generations…</div>
          </div>

        ) : sessionHistory.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            minHeight: 400, gap: 20, textAlign: 'center',
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: 20,
              background: 'linear-gradient(135deg, rgba(255,107,43,0.12), rgba(224,64,200,0.08))',
              border: '1px solid rgba(255,107,43,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#FF6B2B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>No generations yet</div>
              <div style={{ fontSize: 13, color: 'var(--text)', opacity: 0.5, marginBottom: 24 }}>Start creating in the Studio to see your images here</div>
              <button
                onClick={() => router.push('/studio')}
                style={{
                  padding: '10px 24px', borderRadius: 12,
                  background: 'linear-gradient(135deg, #FF6B2B, #E040C8)',
                  border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: '0 4px 16px rgba(255,107,43,0.35)',
                }}
              >
                Open Studio →
              </button>
            </div>
          </div>

        ) : (
          <div>
            {orderedGroups.map(group => (
              <div key={group} style={{ marginBottom: 48 }}>
                {/* Date group label */}
                <div className="hist-group-label">{group}</div>

                {/* Sessions in this group */}
                {grouped[group].map((sess, sIdx) => {
                  const images = (sess.preview_images || []).filter(url => {
                    const key = `${sess.id}-${url}`;
                    return !brokenPreviews.has(key);
                  });
                  if (images.length === 0) return null;

                  return (
                    <div
                      key={sess.id}
                      className="hist-session-row"
                      style={{ animationDelay: `${sIdx * 0.07}s` }}
                    >
                      {/* Session header */}
                      <div className="hist-session-header">
                        <div style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: 'linear-gradient(135deg, #FF6B2B, #E040C8)',
                          flexShrink: 0, marginTop: 2,
                        }} />
                        <span className="hist-session-prompt">
                          {sess.prompt || 'Untitled session'}
                        </span>
                        <span className="hist-session-time">{formatRelative(sess.latest_activity_at || sess.created_at)}</span>
                        <button
                          className="hist-session-del"
                          title="Delete session"
                          onClick={() => deleteSession(sess.id)}
                        >
                          Delete
                        </button>
                      </div>

                      {/* Images — masonry within session */}
                      <div className="hist-masonry">
                        {images.map((url, imgIdx) => {
                          const key = `${sess.id}-${url}`;
                          return (
                            <div
                              key={key}
                              className="hist-img-tile"
                              onClick={() => router.push(`/generate?sessionId=${sess.id}`)}
                              title={sess.prompt || 'Open session'}
                            >
                              <img
                                src={url}
                                alt={sess.prompt || 'Generated image'}
                                onError={() => setBrokenPreviews(prev => new Set(prev).add(key))}
                                loading="lazy"
                              />
                              <div className="hist-img-overlay">
                                <div className="hist-img-prompt">{sess.prompt || 'Untitled session'}</div>
                                <div className="hist-img-meta">{formatRelative(sess.created_at)}</div>
                              </div>
                              <div className="hist-open-badge">Open ↗</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
