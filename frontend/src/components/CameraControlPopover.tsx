'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, RotateCcw, Sparkles } from 'lucide-react';

// ── VLM Calibration & Viewport-Relative Angle Translator ───────────────────────
export interface OrientationCalibration {
  initial_yaw_offset?: number; // e.g. -45° if car is facing front-left
  primary_feature?: string;    // e.g. "front headlights and front grille"
}

export const translateCameraAngles = (
  rotate: number, vertical: number, zoom: number, calibration?: OrientationCalibration
): { instruction: string; spatial: string; verticalPart: string; zoomPart: string; legacyInstruction?: string } => {
  const yawOffset = calibration?.initial_yaw_offset || 0;
  const effectiveRotate = ((rotate + yawOffset) % 360 + 360) % 360;
  const normRot = effectiveRotate > 180 ? effectiveRotate - 360 : effectiveRotate;

  // 1. Explicit Numeric & Body-Relative Spatial Height Anchoring for Vertical Tilt
  let verticalAnchor = 'camera positioned at eye level (0° pitch tilt)';
  let verticalPart = 'eye-level shot';
  let verticalVisualEffect = 'eye-level perspective with natural horizon height';

  if (vertical > 60) {
    verticalAnchor = `camera raised overhead to a steep ${vertical}° high angle, positioned well above head height`;
    verticalPart = "bird's-eye view shot";
    verticalVisualEffect = 'steep downward perspective — ground surface dominates frame, subject seen from directly above';
  } else if (vertical > 25) {
    verticalAnchor = `camera raised above head height with a ${vertical}° downward pitch tilt`;
    verticalPart = 'high-angle shot';
    verticalVisualEffect = 'downward perspective tilt — camera looks down from above head level, background appears lower in frame';
  } else if (vertical < -60) {
    verticalAnchor = `camera lowered to near ground level with a ${vertical}° steep upward tilt`;
    verticalPart = "worm's-eye view shot";
    verticalVisualEffect = 'extreme upward perspective tilt — camera sits near ground level looking steeply up, subject looms tall, background elements rise high in frame';
  } else if (vertical < -25) {
    verticalAnchor = `camera physically lowered to waist/hip height with a ${vertical}° upward pitch tilt`;
    verticalPart = 'low-angle shot';
    verticalVisualEffect = 'strong upward perspective tilt — camera sits below chest height looking up toward the face, jawline and chin are prominent from below, mountains/background rise higher in frame';
  } else if (vertical < -10) {
    verticalAnchor = `camera lowered slightly below chest height with a ${vertical}° upward tilt`;
    verticalPart = 'slight low-angle shot';
    verticalVisualEffect = 'subtle upward perspective — camera sits at chest height angled slightly up';
  } else if (vertical > 10) {
    verticalAnchor = `camera raised slightly above eye level with a +${vertical}° downward tilt`;
    verticalPart = 'slight high-angle shot';
    verticalVisualEffect = 'subtle downward perspective — camera sits slightly above eye level angled down';
  }

  let zoomPart = 'medium shot';
  if (zoom >= 9) zoomPart = 'extreme close-up';
  else if (zoom >= 7) zoomPart = 'close-up';
  else if (zoom <= 2) zoomPart = 'wide establishing shot';
  else if (zoom <= 4) zoomPart = 'medium-wide shot';

  // ── 8-sector horizontal spatial descriptions ──────────────────────────────
  // Breakpoints: 0° = FRONT, ±15° = FRONT boundary, ±60° = SIDE boundary,
  //              ±120° = REAR-¾ boundary, ±165° = REAR boundary, ±180° = BACK
  // Each description explicitly states which end of the subject faces camera.
  let spatial = '';
  const featureHint = calibration?.primary_feature ? `focusing directly on the ${calibration.primary_feature}` : '';

  const absNorm = Math.abs(normRot);

  if (vertical > 60) {
    // Bird's-eye overhead — horizontal direction still matters for slight offset
    if (absNorm > 165) spatial = 'directly above and behind the subject, looking down from overhead onto the back';
    else if (normRot > 60) spatial = 'steeply above and to the right of the subject, looking down — right side and partial back visible';
    else if (normRot > 15) spatial = 'above and slightly to the front-right, looking down — front and right side visible from above';
    else if (normRot < -60) spatial = 'steeply above and to the left of the subject, looking down — left side and partial back visible';
    else if (normRot < -15) spatial = 'above and slightly to the front-left, looking down — front and left side visible from above';
    else spatial = `directly overhead looking straight down at the subject ${featureHint}, front facing up`.trim();
  } else if (vertical > 25) {
    // High angle
    if (absNorm > 165) spatial = 'at a high angle behind the subject — back of subject facing camera';
    else if (normRot > 120) spatial = 'at a high angle behind-right (rear three-quarter) — right side and back partially visible';
    else if (normRot > 60) spatial = 'at a high angle to the right (side view) — right side profile visible from above';
    else if (normRot > 15) spatial = 'at a high angle front-right (front three-quarter) — front and right side visible from above';
    else if (normRot < -120) spatial = 'at a high angle behind-left (rear three-quarter) — left side and back partially visible';
    else if (normRot < -60) spatial = 'at a high angle to the left (side view) — left side profile visible from above';
    else if (normRot < -15) spatial = 'at a high angle front-left (front three-quarter) — front and left side visible from above';
    else spatial = `at a high angle directly facing the front of the subject ${featureHint}, looking down`.trim();
  } else if (vertical < -60) {
    // Worm's eye
    if (absNorm > 165) spatial = 'near ground level behind the subject, looking steeply up at the back';
    else if (normRot > 60) spatial = 'near ground level to the right, looking steeply up — right side profile from below';
    else if (normRot > 15) spatial = 'near ground level front-right, looking steeply up — front and right side from below';
    else if (normRot < -60) spatial = 'near ground level to the left, looking steeply up — left side profile from below';
    else if (normRot < -15) spatial = 'near ground level front-left, looking steeply up — front and left side from below';
    else spatial = `near ground level looking straight up at the front of the subject ${featureHint}`.trim();
  } else if (vertical < -25) {
    // Low angle
    if (absNorm > 165) spatial = 'at a low angle behind the subject, looking up at the back';
    else if (normRot > 120) spatial = 'at a low angle behind-right (rear three-quarter), looking up — right side and back visible';
    else if (normRot > 60) spatial = 'at a low angle to the right (side view), looking up — right side profile visible';
    else if (normRot > 15) spatial = 'at a low angle front-right (front three-quarter), looking up — front and right side visible';
    else if (normRot < -120) spatial = 'at a low angle behind-left (rear three-quarter), looking up — left side and back visible';
    else if (normRot < -60) spatial = 'at a low angle to the left (side view), looking up — left side profile visible';
    else if (normRot < -15) spatial = 'at a low angle front-left (front three-quarter), looking up — front and left side visible';
    else spatial = `at a low angle directly in front of the subject ${featureHint}, looking up at the front`.trim();
  } else {
    // Eye-level — primary case
    if (absNorm > 165) spatial = 'directly behind the subject — back fully facing camera, front not visible';
    else if (normRot > 120) spatial = 'behind and to the right (rear three-quarter view) — mostly the back and right side of the subject visible, front partially hidden';
    else if (normRot > 60) spatial = 'to the right of the subject (side profile view) — right side fully visible, showing right profile';
    else if (normRot > 15) spatial = 'front-right three-quarter view — front and right side of the subject both visible, subject angled toward camera';
    else if (normRot < -120) spatial = 'behind and to the left (rear three-quarter view) — mostly the back and left side of the subject visible, front partially hidden';
    else if (normRot < -60) spatial = 'to the left of the subject (side profile view) — left side fully visible, showing left profile';
    else if (normRot < -15) spatial = 'front-left three-quarter view — front and left side of the subject both visible, subject angled toward camera';
    else spatial = `at eye-level straight in front of the subject ${featureHint}, head-on front view — face and front fully visible`.trim();
  }

  const rotDir = normRot === 0 ? '0° head-on' : normRot > 0 ? `${normRot}° to the right` : `${Math.abs(normRot)}° to the left`;
  
  // LEGACY/LOGGING-ONLY: The old long-form bucket-based prompt is kept here for reference/UI logs only.
  // It is NOT used in the final API generation prompt.
  const legacyInstruction = `Re-render scene with virtual camera rotated ${rotDir} horizontally and ${verticalAnchor}. The camera is physically positioned ${spatial}, captured in a ${verticalPart}, ${zoomPart}. Lens perspective effect: ${verticalVisualEffect}. Strictly preserve subject identity, key features, styling, materials, and product details.`;

  // NEW SIMPLIFIED PROMPT FORM (Task 1):
  const instruction = `Create a new angle of the subject in this image: rotate the virtual camera ${normRot}° around the subject horizontally and ${vertical}° vertically, keeping the same framing, identity, clothing, and styling as the original.`;

  return { instruction, spatial: `the camera is now ${spatial}`, verticalPart, zoomPart, legacyInstruction };
};

// ── Unified 8-sector pill badge label ─────────────────────────────────────────
// Breakpoints: FRONT (±15°), FRONT RIGHT/LEFT (15°–60°), RIGHT/LEFT (60°–120°),
//              REAR RIGHT/LEFT (120°–165°), REAR (165°–180°)
// Same normRot math used by translateCameraAngles — single source of truth.
export const getBadge = (r: number, v: number, calibration?: OrientationCalibration) => {
  const yawOffset = calibration?.initial_yaw_offset || 0;
  const effectiveRotate = ((r + yawOffset) % 360 + 360) % 360;
  const normRot = effectiveRotate > 180 ? effectiveRotate - 360 : effectiveRotate;
  const absNorm = Math.abs(normRot);

  // Derive horizontal label first
  let hLabel = 'FRONT';
  if (absNorm > 165)       hLabel = 'REAR';
  else if (normRot > 120)  hLabel = 'REAR RIGHT';
  else if (normRot > 60)   hLabel = 'RIGHT';
  else if (normRot > 15)   hLabel = 'FRONT RIGHT';
  else if (normRot < -120) hLabel = 'REAR LEFT';
  else if (normRot < -60)  hLabel = 'LEFT';
  else if (normRot < -15)  hLabel = 'FRONT LEFT';

  // Vertical overrides for extreme tilt
  if (v > 60) return "BIRD'S EYE";
  if (v < -60) return "WORM'S EYE";
  if (v > 25) return hLabel === 'FRONT' ? 'HIGH FRONT' : `HIGH ${hLabel}`;
  if (v < -25) return hLabel === 'FRONT' ? 'LOW FRONT' : `LOW ${hLabel}`;
  return hLabel;
};

// ── 3D Scene Container with Canvas & HTML Thumbnail Overlay ────────────────────
function CameraScene({ rotate, vertical, zoom, imageUrl, onRotateChange, onVerticalChange }: {
  rotate: number; vertical: number; zoom: number; imageUrl?: string;
  onRotateChange?: (v: number) => void;
  onVerticalChange?: (v: number) => void;
}) {
  const W = 436, H = 220;
  const VPX = 218, VPY = 82;
  const CX = 218, GY = 175;
  const RX = 145, RY = 36;

  // ── Blue camera sphere position (horizontal orbit) ──
  // Positive rotate = clockwise rotation around subject (right side of viewer screen, camX > CX)
  const rotRad = (rotate * Math.PI) / 180;
  const camX = CX + RX * Math.sin(rotRad);
  const camY = GY + RY * Math.cos(rotRad);
  const inFront = camY >= GY;

  // ── Fixed purple vertical elevation arc ──
  const fixedX = CX - RX * 0.707;
  const fixedY = GY + RY * 0.707;
  const elevScale = 115;
  const vertRad = (vertical * Math.PI) / 180;
  const sinV = Math.sin(vertRad);
  const cosV = Math.cos(vertRad);

  const purX = CX + cosV * (fixedX - CX);
  const purY = GY + cosV * (fixedY - GY) - sinV * elevScale;

  const arcEndX = CX, arcEndY = GY - elevScale;
  const cp1X = fixedX, cp1Y = fixedY - elevScale * 0.55;
  const cp2X = CX,     cp2Y = arcEndY;
  const arcD = `M ${fixedX} ${fixedY} C ${cp1X} ${cp1Y} ${cp2X} ${cp2Y} ${arcEndX} ${arcEndY}`;

  // ── Center subject card (landscape-friendly aspect ratio to show full image without cropping) ──
  const PW = 64 + ((zoom - 1) / 9) * 44;
  const PH = PW * 0.72; // Wide landscape ratio matching standard photos
  const tPX = CX - PW / 2, tPY = GY - PH;

  // Ring arc paths (front/back split for z-ordering)
  const backArc  = `M ${CX+RX},${GY} A ${RX},${RY} 0 0 0 ${CX-RX},${GY}`;
  const frontArc = `M ${CX-RX},${GY} A ${RX},${RY} 0 0 0 ${CX+RX},${GY}`;

  // Perspective grid
  const N = 9;
  const dLines = Array.from({ length: N + 1 }, (_, i) => ({
    x1: (W / N) * i, y1: H + 4, x2: VPX, y2: VPY,
  }));
  const hYs = [H+4, 220, 202, 185, 169, 154, 140, 127, 115, 104, 94];
  const hLines = hYs.map(gy => {
    const f = (H + 4 - gy) / (H + 4 - VPY);
    return { x1: CX - CX * f, y1: gy, x2: CX + (W - CX) * f, y2: gy };
  });

  // Target center on subject card
  const targetX = CX;
  const targetY = GY - PH * 0.5;

  // ── Drag interaction handlers ──
  const svgRef = useRef<SVGSVGElement>(null);

  const getSVGPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  };

  const handleBlueDrag = useCallback((clientX: number, clientY: number) => {
    if (!onRotateChange) return;
    const pt = getSVGPoint(clientX, clientY);
    const dx = (pt.x - CX) / RX;
    const dy = (pt.y - GY) / RY;
    let angleDeg = Math.atan2(dx, dy) * (180 / Math.PI);
    angleDeg = ((angleDeg % 360) + 360) % 360;
    onRotateChange(Math.round(angleDeg));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRotateChange]);

  const handlePurpleDrag = useCallback((clientX: number, clientY: number) => {
    if (!onVerticalChange) return;
    const pt = getSVGPoint(clientX, clientY);
    const fraction = (GY - pt.y) / elevScale;
    let angleDeg = Math.asin(Math.max(-0.5, Math.min(1, fraction))) * (180 / Math.PI);
    angleDeg = Math.max(-30, Math.min(90, Math.round(angleDeg)));
    onVerticalChange(angleDeg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onVerticalChange]);

  const startDrag = (handler: (cx: number, cy: number) => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    handler(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => handler(ev.clientX, ev.clientY);
    const onUp = (ev: PointerEvent) => {
      (e.target as Element).releasePointerCapture(ev.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const normRot = ((rotate % 360) + 360) % 360;
  const isBackView = normRot >= 115 && normRot <= 245;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', userSelect: 'none' }}>
      <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: '100%', display: 'block' }}>
        <defs>
          <linearGradient id="sc-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a0818" />
            <stop offset="100%" stopColor="#04030a" />
          </linearGradient>
          <filter id="sc-gbl" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="sc-gpl" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="sc-sph" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="sc-bgr" cx="35%" cy="25%" r="68%">
            <stop offset="0%" stopColor="#c0dcff" />
            <stop offset="45%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#1d4ed8" />
          </radialGradient>
          <radialGradient id="sc-pgr" cx="35%" cy="25%" r="68%">
            <stop offset="0%" stopColor="#f3e8ff" />
            <stop offset="45%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#7e22ce" />
          </radialGradient>
          <clipPath id="sc-pc">
            <rect x={tPX} y={tPY} width={PW} height={PH} rx="6" />
          </clipPath>
        </defs>

        {/* Dark stage background */}
        <rect width={W} height={H} fill="url(#sc-bg)" />

        {/* 3D Grid */}
        {dLines.map((l, i) =>
          <line key={`d${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#1b173c" strokeWidth="0.8" />)}
        {hLines.map((l, i) =>
          <line key={`h${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#14112e" strokeWidth="0.6" />)}

        {/* Back half of horizontal orbit ring */}
        <path d={backArc} fill="none" stroke="#1e3a8a" strokeWidth="10" opacity="0.2" />
        <path d={backArc} fill="none" stroke="#2563eb" strokeWidth="3" opacity="0.5" />

        {/* Blue camera sphere BEHIND center card */}
        {!inFront && (
          <g style={{ cursor: 'grab' }} onPointerDown={startDrag(handleBlueDrag)}>
            <circle cx={camX} cy={camY} r="22" fill="#3b82f6" opacity="0.16" />
            <circle cx={camX} cy={camY} r="13" fill="url(#sc-bgr)" filter="url(#sc-sph)" />
            <ellipse cx={camX-3.5} cy={camY-4.5} rx="5" ry="2.8" fill="rgba(255,255,255,0.7)" />
          </g>
        )}

        {/* Center subject card (shows FULL image without cropping) */}
        <ellipse cx={CX} cy={GY + 2} rx={PW * 0.48} ry={4} fill="rgba(0,0,0,0.45)" />
        <rect x={tPX} y={tPY} width={PW} height={PH} rx="6"
          fill="#0c0a1a" stroke="#2d2654" strokeWidth="1.5" />
        {imageUrl ? (
          <image href={imageUrl} x={tPX} y={tPY} width={PW} height={PH}
            preserveAspectRatio="xMidYMid meet" clipPath="url(#sc-pc)"
            style={{ opacity: 0.96 }} />
        ) : (
          <rect x={tPX+1} y={tPY+1} width={PW-2} height={PH-2} rx="5" fill="#181432" />
        )}
        <rect x={tPX} y={tPY} width={PW} height={PH} rx="6"
          fill="none" stroke="rgba(192,160,255,0.22)" strokeWidth="1.2" />

        {/* Front half of horizontal orbit ring */}
        <path d={frontArc} fill="none" stroke="#1d4ed8" strokeWidth="14" opacity="0.2" />
        <path d={frontArc} fill="none" stroke="#3b82f6" strokeWidth="4" filter="url(#sc-gbl)" />

        {/* Fixed vertical elevation arc */}
        <path d={arcD} fill="none" stroke="#7e22ce" strokeWidth="9" opacity="0.22" />
        <path d={arcD} fill="none" stroke="#c084fc" strokeWidth="3" filter="url(#sc-gpl)" />
        <circle cx={fixedX} cy={fixedY} r="4" fill="#d8b4fe" opacity="0.85" />
        <circle cx={arcEndX} cy={arcEndY} r="3" fill="#a855f7" opacity="0.75" />

        {/* Minute laser aiming rays showing where balls point to subject center */}
        <line x1={camX} y1={camY} x2={targetX} y2={targetY}
          stroke="#60a5fa" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.85" />
        <line x1={purX} y1={purY} x2={targetX} y2={targetY}
          stroke="#c084fc" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.85" />

        {/* Target reticle dot at subject center */}
        <circle cx={targetX} cy={targetY} r="2.5" fill="#e9d5ff" opacity="0.9" />

        {/* Blue camera sphere IN FRONT of center card */}
        {inFront && (
          <g style={{ cursor: 'grab' }} onPointerDown={startDrag(handleBlueDrag)}>
            <circle cx={camX} cy={camY} r="22" fill="#3b82f6" opacity="0.16" />
            <circle cx={camX} cy={camY} r="13" fill="url(#sc-bgr)" filter="url(#sc-sph)" />
            <ellipse cx={camX-3.5} cy={camY-4.5} rx="5" ry="2.8" fill="rgba(255,255,255,0.7)" />
          </g>
        )}

        {/* Purple elevation sphere */}
        <g style={{ cursor: 'ns-resize' }} onPointerDown={startDrag(handlePurpleDrag)}>
          <circle cx={purX} cy={purY} r="18" fill="#a855f7" opacity="0.2" />
          <circle cx={purX} cy={purY} r="11" fill="url(#sc-pgr)" filter="url(#sc-sph)" />
          <ellipse cx={purX-3} cy={purY-4} rx="4" ry="2.4" fill="rgba(255,255,255,0.7)" />
        </g>

        {/* Stage overlay titles */}
        <text x="14" y="20" fill="#4c427c" fontSize="9.5" fontFamily="monospace" letterSpacing="0.8" fontWeight="bold">
          CAMERA PREVIEW
        </text>
        <text x="14" y={H - 10} fill="#5d5292" fontSize="9.5" fontFamily="monospace">
          {zoom >= 9 ? 'Extreme CU' : zoom >= 7 ? 'Close-Up' :
           zoom <= 2 ? 'Wide Shot' : zoom <= 4 ? 'Med-Wide' : 'Medium'} · {zoom}×
        </text>
      </svg>

      {/* ── Top-Right HTML 3D Camera Preview Thumbnail Box ── */}
      <div style={{
        position: 'absolute',
        top: 12,
        right: 14,
        width: 92,
        height: 70,
        perspective: 260,
        zIndex: 10,
      }}>
        <div style={{
          width: '100%',
          height: '100%',
          borderRadius: 8,
          border: '1.5px solid #a855f7',
          boxShadow: '0 8px 24px -4px rgba(168,85,247,0.5)',
          transform: `rotateX(${-vertical * 0.85}deg) rotateY(${-rotate}deg)`,
          transformOrigin: 'center center',
          transformStyle: 'preserve-3d',
          background: isBackView ? '#100c24' : '#14102c',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}>
          {!isBackView ? (
            imageUrl ? (
              <img src={imageUrl} alt="3D Angle Preview" style={{
                width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.95
              }} />
            ) : (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: '#c084fc', fontSize: 11, fontWeight: 700, fontFamily: 'monospace'
              }}>
                <Camera size={20} style={{ marginBottom: 2 }} />
                <span>PREVIEW</span>
              </div>
            )
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '100%', height: '100%'
            }}>
              <span style={{
                fontSize: 32,
                fontWeight: 900,
                fontFamily: 'Inter, system-ui, sans-serif',
                background: 'linear-gradient(135deg, #f3e8ff 0%, #c084fc 50%, #9333ea 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '-0.05em',
                filter: 'drop-shadow(0 2px 10px rgba(168,85,247,0.5))'
              }}>CC</span>
            </div>
          )}

          {/* Perspective border outline */}
          <div style={{
            position: 'absolute', inset: 0, border: '1px solid rgba(192,132,252,0.3)', pointerEvents: 'none'
          }} />
        </div>
      </div>
    </div>
  );
}

// ── Main Popover Component ─────────────────────────────────────────────────────
type Props = {
  onApply: (instruction: string, angles?: { rotate: number; vertical: number; zoom: number }) => void;
  onClose: () => void;
  imageUrl?: string;
  initialRotate?: number;
  initialVertical?: number;
  initialZoom?: number;
};

export function CameraControlPopover({
  onApply,
  onClose,
  imageUrl,
  initialRotate = 0,
  initialVertical = 0,
  initialZoom = 5
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [rotate, setRotate] = useState(initialRotate);
  const [vertical, setVertical] = useState(initialVertical);
  const [zoom, setZoom] = useState(initialZoom);
  const [calibration, setCalibration] = useState<OrientationCalibration | undefined>(undefined);
  const [isCalibrating, setIsCalibrating] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Solution 1: Auto VLM Orientation Calibration on Mount (Subject-Agnostic)
  useEffect(() => {
    if (!imageUrl) return;
    let isCancelled = false;
    const calibrateImage = async () => {
      setIsCalibrating(true);
      try {
        // Dynamically detect initial 3D orientation and primary front feature for ANY image type (person, product, car, building, animal)
        const res = await fetch('/api/analyze-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: imageUrl,
            prompt_context: 'Detect subject initial 3D yaw angle offset (-180 to 180) and primary front-facing feature dynamically for any image subject.'
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled && data) {
            setCalibration({
              initial_yaw_offset: data.initial_yaw_offset || 0,
              primary_feature: data.primary_feature || undefined
            });
          }
        }
      } catch (err) {
        // Universal subject-agnostic fallback (zero hardcoded subject assumptions)
        if (!isCancelled) {
          setCalibration({
            initial_yaw_offset: 0,
            primary_feature: undefined
          });
        }
      } finally {
        if (!isCancelled) setIsCalibrating(false);
      }
    };
    calibrateImage();
    return () => { isCancelled = true; };
  }, [imageUrl]);

  const bdg = getBadge(rotate, vertical, calibration);
  const { instruction, spatial, verticalPart, zoomPart } = translateCameraAngles(rotate, vertical, zoom, calibration);
  const pctR  = (rotate / 360 * 100).toFixed(1);
  const pctV  = (((vertical + 30) / 120) * 100).toFixed(1);
  const pctZ  = ((zoom - 1) / 9 * 100).toFixed(1);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
      }} />

      <style>{`
        #ccpop,#ccpop *{box-sizing:border-box;margin:0;padding:0}
        #ccpop{
          position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
          z-index:9999;width:480px;max-width:calc(100vw - 32px);
          max-height:calc(100vh - 32px);overflow-y:auto;overscroll-behavior:contain;
          background:linear-gradient(158deg,#18152e 0%,#100d20 65%,#090714 100%);
          border-radius:24px;border:1px solid #2d2654;
          box-shadow:0 40px 100px -16px rgba(0,0,0,0.95),inset 0 1px 0 rgba(255,255,255,0.08);
          color:#f0eeff;font-family:Inter,system-ui,sans-serif;padding:22px;
        }
        #ccpop::-webkit-scrollbar{width:4px}
        #ccpop::-webkit-scrollbar-thumb{background:#3a3460;border-radius:2px}

        /* Header */
        #ccpop .hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
        #ccpop .brand{display:flex;align-items:center;gap:11px}
        #ccpop .ic{
          width:38px;height:38px;border-radius:12px;flex-shrink:0;overflow:hidden;
          border:1.5px solid rgba(168,85,247,.5);
          box-shadow:0 4px 16px -4px rgba(168,85,247,.6);
          background:#1a1538;display:flex;align-items:center;justify-content:center;
        }
        #ccpop .ic img{width:100%;height:100%;object-fit:cover;display:block}
        #ccpop .ttl{font-weight:700;font-size:16px;color:#f0eeff;letter-spacing:-.01em}
        #ccpop .right{display:flex;align-items:center;gap:8px}
        #ccpop .bdg{
          font-size:10px;font-weight:700;font-family:monospace;padding:5px 11px;
          border-radius:12px;letter-spacing:.6px;white-space:nowrap;
          background:rgba(168,85,247,.18);border:1px solid rgba(168,85,247,.45);
          color:#e9d5ff;transition:all .2s;
        }
        #ccpop .xb{
          width:30px;height:30px;border-radius:9px;border:none;flex-shrink:0;
          background:rgba(255,255,255,.07);color:#94a3b8;
          display:flex;align-items:center;justify-content:center;cursor:pointer;
          transition:background .15s,color .15s;
        }
        #ccpop .xb:hover{background:rgba(255,255,255,.14);color:#f0eeff}

        /* Stage */
        #ccpop .cc-stage{
          width:100%;height:220px;min-height:220px;max-height:220px;
          border-radius:16px;overflow:hidden;padding:0 !important;
          border:1px solid #221c48;margin-bottom:16px;background:#06050e;
          flex-shrink:0;position:relative;
        }

        /* Sliders */
        #ccpop .sliders{display:flex;flex-direction:column;gap:10px;margin-bottom:16px}
        #ccpop .sr-card{
          background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
          border-radius:14px;padding:10px 14px;display:flex;flex-direction:column;gap:6px;
        }
        #ccpop .sr{display:flex;justify-content:space-between;align-items:center}
        #ccpop .sl{font-size:12.5px;font-weight:600;color:#c4b5fd}
        #ccpop .sv{font-family:monospace;font-size:12px;color:#e9d5ff;font-weight:600}
        #ccpop input[type=range]{
          -webkit-appearance:none;width:100%;height:6px;border-radius:3px;
          background:linear-gradient(to right,#3b82f6 0%,#3b82f6 var(--pct),#221d38 var(--pct));
          outline:none;cursor:pointer;display:block;
        }
        #ccpop input[type=range]::-webkit-slider-thumb{
          -webkit-appearance:none;width:18px;height:18px;border-radius:50%;
          background:linear-gradient(135deg,#e9d5ff,#a855f7);
          box-shadow:0 0 0 3px rgba(168,85,247,.32),0 2px 6px rgba(0,0,0,.65);
          cursor:pointer;transition:box-shadow .15s;
        }
        #ccpop input[type=range]::-webkit-slider-thumb:hover,
        #ccpop input[type=range]::-webkit-slider-thumb:active{
          box-shadow:0 0 0 6px rgba(168,85,247,.45),0 2px 6px rgba(0,0,0,.65);
        }
        #ccpop input[type=range]::-moz-range-thumb{
          width:18px;height:18px;border-radius:50%;border:none;
          background:linear-gradient(135deg,#e9d5ff,#a855f7);
        }

        /* Prompt */
        #ccpop .pr{
          background:#0a081a;border:1px solid #251e4c;border-left:3px solid #8b5cf6;
          border-radius:12px;padding:10px 14px;margin-bottom:16px;
          font-family:monospace;font-size:11px;line-height:1.6;
          color:#8b82be;max-height:64px;overflow-y:auto;word-break:break-word;
        }
        #ccpop .pr .hl{color:#d8b4fe;font-weight:600}
        #ccpop .pr .hg{color:#fbbf24;font-weight:600}

        /* Buttons */
        #ccpop .btns{display:flex;gap:10px}
        #ccpop .btn{
          border:none;border-radius:12px;padding:12px 0;font-size:13.5px;font-weight:700;
          cursor:pointer;font-family:inherit;transition:transform .12s,filter .12s;
          display:flex;align-items:center;justify-content:center;gap:6px;
        }
        #ccpop .btn:active{transform:scale(.97)}
        #ccpop .rst{flex:1;background:#1a1734;color:#a78bfa;border:1px solid #2d2654}
        #ccpop .rst:hover{color:#f0eeff;border-color:#3e3570}
        #ccpop .apl{
          flex:2;color:#180e00;
          background:linear-gradient(135deg,#fbbf24,#f59e0b 50%,#d97706);
          box-shadow:0 4px 22px -6px rgba(245,158,11,.65);
        }
        #ccpop .apl:hover{filter:brightness(1.08)}
      `}</style>

      <div id="ccpop">
        {/* ── Header ── */}
        <div className="hd">
          <div className="brand">
            <div className="ic">
              <span style={{
                fontSize: 15,
                fontWeight: 900,
                fontFamily: 'Inter, system-ui, sans-serif',
                background: 'linear-gradient(135deg, #e9d5ff, #a855f7)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '-0.04em'
              }}>CC</span>
            </div>
            <div className="ttl">Camera Control</div>
          </div>
          <div className="right">
            <div className="bdg">{bdg}</div>
            <button className="xb" onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        {/* ── 3D Scene Viewport ── */}
        <div className="cc-stage">
          <CameraScene
            rotate={rotate}
            vertical={vertical}
            zoom={zoom}
            imageUrl={imageUrl}
            onRotateChange={setRotate}
            onVerticalChange={setVertical}
          />
        </div>

        {/* ── Sliders ── */}
        <div className="sliders">
          <div className="sr-card">
            <div className="sr">
              <span className="sl">Rotate</span>
              <span className="sv">{rotate}°</span>
            </div>
            <input type="range" min="0" max="360" value={rotate}
              style={{ '--pct': `${pctR}%` } as React.CSSProperties}
              onChange={e => setRotate(+e.target.value)} />
          </div>
          <div className="sr-card">
            <div className="sr">
              <span className="sl">Vertical</span>
              <span className="sv">{vertical}°</span>
            </div>
            <input type="range" min="-30" max="90" value={vertical}
              style={{ '--pct': `${pctV}%` } as React.CSSProperties}
              onChange={e => setVertical(+e.target.value)} />
          </div>
          <div className="sr-card">
            <div className="sr">
              <span className="sl">Zoom</span>
              <span className="sv">
                {zoom >= 9 ? 'Extreme CU' : zoom >= 7 ? 'Close-Up' :
                 zoom <= 2 ? 'Wide Shot' : zoom <= 4 ? 'Med-Wide' : 'Medium'} · {zoom}×
              </span>
            </div>
            <input type="range" min="1" max="10" step="0.5" value={zoom}
              style={{ '--pct': `${pctZ}%` } as React.CSSProperties}
              onChange={e => setZoom(+e.target.value)} />
          </div>
        </div>

        {/* ── Prompt Preview ── */}
        <div className="pr">
          <span className="hg">Camera:</span>{' '}
          <span className="hl">{spatial}</span>, in a{' '}
          <span className="hl">{verticalPart}</span>,{' '}
          <span className="hl">{zoomPart}</span>.{' '}
          Strictly preserve subject identity, facial features, pose, clothing, and product details.
        </div>

        {/* ── Buttons ── */}
        <div className="btns">
          <button className="btn rst" onClick={() => { setRotate(0); setVertical(0); setZoom(5); }}>
            <RotateCcw size={14} /> Reset
          </button>
          <button className="btn apl" onClick={() => { onApply(instruction, { rotate, vertical, zoom }); onClose(); }}>
            <Sparkles size={15} /> Apply Camera Angle
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
