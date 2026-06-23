'use client';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame } from '@react-three/fiber';
import { Plane, Sphere, Line, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { X, Sun } from 'lucide-react';

// Preset color options
export const LIGHT_COLORS = [
  { id: 'original', label: 'Original Image Light (Match)', hex: '#e2e8f0', promptName: 'the existing natural image lighting and ambient atmosphere' },
  { id: 'white', label: 'Neutral Studio', hex: '#ffffff', promptName: 'bright neutral white studio light' },
  { id: 'golden', label: 'Golden Hour', hex: '#ffaa33', promptName: 'warm golden hour sunlight' },
  { id: 'sunset', label: 'Warm Sunset', hex: '#ff5522', promptName: 'intense warm amber sunset glow' },
  { id: 'cyan', label: 'Cool Cinematic', hex: '#22ccff', promptName: 'cool cyan teal cinematic lighting' },
  { id: 'neon', label: 'Cyberpunk Neon', hex: '#ff22aa', promptName: 'vibrant magenta neon lighting' },
];

// Presets for quick selection
export const QUICK_PRESETS = [
  { label: 'Top', rotate: 0, elevation: 80 },
  { label: 'Front', rotate: 0, elevation: 0 },
  { label: 'Right', rotate: 90, elevation: 15 },
  { label: 'Left', rotate: -90, elevation: 15 },
  { label: 'Back', rotate: 180, elevation: 20 },
  { label: 'Bottom', rotate: 0, elevation: -60 },
];

// ── Neutral color descriptors for prompt injection ───────────────────────────
// Keeps mood-loaded preset names (e.g. "Cyberpunk Neon", "Golden Hour") out of the
// prompt so the model doesn't restyle the entire scene to match the preset's aesthetic.
// Only the directional light color is communicated — not the implied setting/mood.
const RELIGHT_COLOR_DESCRIPTOR: Record<string, string> = {
  'white':  'clean neutral white',
  'golden': 'warm golden-amber',
  'sunset': 'warm orange-red',
  'cyan':   'cool cyan-blue',
  'neon':   'vivid magenta-pink',
};

// ── Fused direction descriptor ───────────────────────────────────────────────
// Produces a single crisp phrase for strong angle combinations instead of two
// separate clauses (e.g. "from the upper-right" rather than "coming from the right
// side" + "with high-angle key illumination"), which prevents the model from having
// to reconcile two independent directional cues.
function getFusedDirection(rotate: number, elevation: number): string {
  const high   = elevation > 25;
  const low    = elevation < -15;
  const veryLow = elevation < -45;
  const veryHigh = elevation > 60;
  const right  = rotate > 45 && rotate <= 150;
  const left   = rotate < -45 && rotate >= -150;
  const behind = rotate > 150 || rotate < -150;

  if (veryHigh && behind) return 'from directly above and behind the subject';
  if (veryHigh && right)  return 'from steeply above on the right';
  if (veryHigh && left)   return 'from steeply above on the left';
  if (veryHigh)           return 'from directly overhead';
  if (high && right)      return 'from the upper-right';
  if (high && left)       return 'from the upper-left';
  if (high && behind)     return 'from above and behind the subject, creating rim light';
  if (high)               return 'from a high angle directly in front';
  if (veryLow && right)   return 'from below on the right side';
  if (veryLow && left)    return 'from below on the left side';
  if (veryLow)            return 'from directly below the subject';
  if (low && right)       return 'from a low angle on the right';
  if (low && left)        return 'from a low angle on the left';
  if (behind)             return 'from directly behind the subject, creating strong rim light';
  if (right)              return 'from the right side';
  if (left)               return 'from the left side';
  if (rotate > 10)        return 'slightly off-center from the right';
  if (rotate < -10)       return 'slightly off-center from the left';
  return 'from directly in front of the subject';
}

// ── Angle + Color → Prompt Translation ──────────────────────────────────────
export const translateRelightPrompt = (rotate: number, elevation: number, colorHex: string): string => {
  const colorObj = LIGHT_COLORS.find(c => c.hex === colorHex) || LIGHT_COLORS[0];
  const direction = getFusedDirection(rotate, elevation);

  // ── Match mode: shift existing light direction, preserve everything else ──
  if (colorObj.id === 'original') {
    return (
      `Relight scene by shifting the primary key light source to be ${direction}. ` +
      `Reposition all main light rays, subject highlights, and cast shadows to match ` +
      `this new directional light source, while strictly preserving ` +
      `${colorObj.promptName}, color tone, and subject details.`
    );
  }

  // ── Custom color mode: add a new directional light, do NOT recolor the whole image ──
  const descriptor = RELIGHT_COLOR_DESCRIPTOR[colorObj.id] ?? colorObj.promptName;
  return (
    `Add a ${descriptor} light source to the scene, ${direction}. ` +
    `Illuminate surfaces facing this new light and cast natural shadows on surfaces facing away from it, ` +
    `while strictly preserving the room's existing architecture, background elements, other light sources, ` +
    `and time of day. Do not apply a color wash or filter across the entire image — the new color should ` +
    `be visible only as directional highlights, rim light, and reflections consistent with a real added light. ` +
    `Maintain exact subject identity and overall composition.`
  );
};

// ── Image Plane (loads texture from URL) ─────────────────────────────────────
function ImagePlane({ url }: { url: string }) {
  const texture = useTexture(url);
  const img = texture.image as HTMLImageElement | undefined;
  const aspect = img ? img.width / img.height : 16 / 9;
  const planeW = 2.8;
  const planeH = planeW / aspect;
  return (
    <Plane args={[planeW, planeH]} position={[0, 0, 0]}>
      <meshStandardMaterial map={texture} roughness={0.4} metalness={0.1} side={THREE.DoubleSide} />
    </Plane>
  );
}

// ── 3D Preview Scene ────────────────────────────────────────────────────────
type SceneProps = { rotate: number; elevation: number; colorHex: string; imageUrl?: string };

function Scene({ rotate, elevation, colorHex, imageUrl }: SceneProps) {
  const lightOrbRef = useRef<THREE.Group>(null!);
  const spotLightRef = useRef<THREE.DirectionalLight>(null!);
  const ORBIT_R = 4.0;

  useFrame(() => {
    const rRad = THREE.MathUtils.degToRad(rotate);
    const eRad = THREE.MathUtils.degToRad(elevation);

    const y = Math.sin(eRad) * ORBIT_R;
    const xzR = Math.cos(eRad) * ORBIT_R;
    const x = Math.sin(rRad) * xzR;
    const z = Math.cos(rRad) * xzR;

    if (lightOrbRef.current) {
      lightOrbRef.current.position.set(x, y, z);
    }
    if (spotLightRef.current) {
      spotLightRef.current.position.set(x, y, z);
    }
  });

  const rayLinePts: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, ORBIT_R],
  ];

  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight
        ref={spotLightRef}
        color={colorHex}
        intensity={2.2}
        position={[0, 3, 3]}
      />

      {/* Target Image Canvas Plane */}
      {imageUrl ? (
        <React.Suspense fallback={
          <Plane args={[2.8, 1.9]} position={[0, 0, 0]}>
            <meshStandardMaterial color="#333344" roughness={0.4} metalness={0.1} side={THREE.DoubleSide} />
          </Plane>
        }>
          <ImagePlane url={imageUrl} />
        </React.Suspense>
      ) : (
        <Plane args={[2.8, 1.9]} position={[0, 0, 0]}>
          <meshStandardMaterial color="#333344" roughness={0.4} metalness={0.1} side={THREE.DoubleSide} />
        </Plane>
      )}

      {/* Light Source Orb */}
      <group ref={lightOrbRef}>
        <Sphere args={[0.25, 16, 16]}>
          <meshBasicMaterial color={colorHex} />
        </Sphere>
        {/* Glow halo */}
        <Sphere args={[0.35, 16, 16]}>
          <meshBasicMaterial color={colorHex} transparent opacity={0.3} />
        </Sphere>
        {/* Ray guide line pointing to center */}
        <Line points={rayLinePts} color={colorHex} lineWidth={1.2} dashed dashSize={0.15} gapSize={0.1} />
      </group>
    </>
  );
}

// ── Main Popover Export ──────────────────────────────────────────────────────
type RelightControlPopoverProps = {
  onApply: (instruction: string) => void;
  onClose: () => void;
  imageUrl?: string;
};

export function RelightControlPopover({ onApply, onClose, imageUrl }: RelightControlPopoverProps) {
  const [mounted, setMounted] = useState(false);
  const [rotate, setRotate] = useState(45);
  const [elevation, setElevation] = useState(30);
  const [colorHex, setColorHex] = useState(LIGHT_COLORS[0].hex); // Default Original Image Light

  useEffect(() => {
    setMounted(true);
  }, []);

  const previewText = translateRelightPrompt(rotate, elevation, colorHex);

  const handleApply = () => {
    onApply(previewText);
    onClose();
  };

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          backdropFilter: 'blur(4px)',
          zIndex: 9998,
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: 'max(16px, min(calc(50vh - 280px), calc(100vh - 580px)))',
          left: 'max(16px, min(350px, calc(100vw - 440px)))',
          width: 320,
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          background: 'rgba(16,16,24,0.97)',
          border: '1px solid rgba(255,170,51,0.3)',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,170,51,0.15)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 16,
          zIndex: 9999,
          color: '#fff',
          backdropFilter: 'blur(16px)',
        }}
      >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'linear-gradient(135deg, #ffaa33, #ff5522)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Sun size={15} color="#fff" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>Relight Scene</span>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24, height: 24, borderRadius: 6, border: 'none',
            background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s'
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
        >
          <X size={12} />
        </button>
      </div>

      {/* 3D Canvas Light Preview */}
      <div style={{
        width: '100%', height: 280,
        background: 'rgba(0,0,0,0.55)', borderRadius: 10,
        overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)',
        position: 'relative'
      }}>
        <Canvas camera={{ position: [0, 5, 8], fov: 42 }}>
          <Scene rotate={rotate} elevation={elevation} colorHex={colorHex} imageUrl={imageUrl} />
        </Canvas>
        <span style={{
          position: 'absolute', bottom: 6, left: 8, fontSize: 9.5,
          color: 'rgba(255,255,255,0.4)', pointerEvents: 'none'
        }}>
          Interactive 3D Light Source
        </span>
      </div>

      {/* Quick Select Presets */}
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.45)', fontWeight: 700, marginBottom: 6 }}>
          Quick Select
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
          {QUICK_PRESETS.map(p => {
            const isSelected = rotate === p.rotate && elevation === p.elevation;
            return (
              <button
                key={p.label}
                onClick={() => { setRotate(p.rotate); setElevation(p.elevation); }}
                style={{
                  padding: '5px 0', borderRadius: 6,
                  border: isSelected ? '1px solid #ffaa33' : '1px solid rgba(255,255,255,0.08)',
                  background: isSelected ? 'rgba(255,170,51,0.2)' : 'rgba(255,255,255,0.04)',
                  color: isSelected ? '#ffaa33' : 'rgba(255,255,255,0.7)',
                  fontSize: 10, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s'
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Light Settings Color Picker */}
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.45)', fontWeight: 700, marginBottom: 6 }}>
          Light Color
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {LIGHT_COLORS.map(c => {
            const isSelected = colorHex === c.hex;
            return (
              <button
                key={c.id}
                title={c.label}
                onClick={() => setColorHex(c.hex)}
                style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: c.hex, border: isSelected ? '2px solid #fff' : '2px solid transparent',
                  boxShadow: isSelected ? `0 0 10px ${c.hex}` : 'none',
                  cursor: 'pointer', transition: 'transform 0.15s',
                  transform: isSelected ? 'scale(1.15)' : 'scale(1)'
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Position Sliders */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 56, fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 500, flexShrink: 0 }}>
            Rotate
          </span>
          <input
            type="range" min={-180} max={180} value={rotate}
            onChange={e => setRotate(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#ffaa33', height: 4, cursor: 'pointer' }}
          />
          <span style={{ width: 34, fontSize: 11, color: '#fff', textAlign: 'right', fontWeight: 600, flexShrink: 0 }}>
            {rotate}°
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 56, fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 500, flexShrink: 0 }}>
            Elevation
          </span>
          <input
            type="range" min={-90} max={90} value={elevation}
            onChange={e => setElevation(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#ffaa33', height: 4, cursor: 'pointer' }}
          />
          <span style={{ width: 34, fontSize: 11, color: '#fff', textAlign: 'right', fontWeight: 600, flexShrink: 0 }}>
            {elevation}°
          </span>
        </div>
      </div>

      {/* Live Prompt Preview */}
      <div style={{
        fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4,
        background: 'rgba(255,170,51,0.06)', borderRadius: 8,
        padding: '7px 9px', border: '1px solid rgba(255,170,51,0.12)'
      }}>
        {previewText}
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          onClick={() => { setRotate(45); setElevation(30); setColorHex(LIGHT_COLORS[0].hex); }}
          style={{
            flex: 1, padding: '7px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.65)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer'
          }}
        >
          Reset
        </button>
        <button
          onClick={handleApply}
          style={{
            flex: 2, padding: '7px 0', borderRadius: 8, border: 'none',
            background: 'linear-gradient(135deg, #ffaa33, #ff5522)',
            color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(255,170,51,0.35)'
          }}
        >
          Apply Relight
        </button>
      </div>
    </div>
    </>,
    document.body
  );
}
