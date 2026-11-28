import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Flame, Globe2, Layers, Map as MapIcon, Maximize2, Navigation, X } from 'lucide-react';
import { EnemyCategory, EnemyMapMarker, getWorldMapDef, WORLD_MAPS, WorldMapId } from '../game/types';
import {
  getBiomeWeights,
  getCaveProximity,
  groundHeightAt,
  WATER_LEVEL,
  waterDistanceInfo,
} from '../game/noise';
import { GameLang, TRANSLATIONS } from '../i18n';
import { PLAYER_PALETTE, RemotePlayerState } from '../game/multiplayer';

export type MapStyleMode = 'TOPO' | 'SATELLITE' | 'RADAR' | 'ELEVATION';

function getEnemyMarkerColor(category: EnemyCategory): string {
  switch (category) {
    case 'boss':
      return '#c084fc';
    case 'mech':
      return '#38bdf8';
    case 'squad':
      return '#fb923c';
    case 'beast':
    case 'raider':
    default:
      return '#f43f5e';
  }
}

interface WorldMapProps {
  visible: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  activeMapId: WorldMapId;
  playerX: number;
  playerZ: number;
  headingDeg: number;
  elevation: number;
  biomeLabel: string;
  campfireLit: boolean;
  lang: GameLang;
  compact?: boolean;
  remotePlayers?: RemotePlayerState[];
  enemyMarkers?: EnemyMapMarker[];
  onTeleport: (landmarkId: string) => void;
  onSwitchMap: (mapId: WorldMapId) => void;
}

const MAP_HALF_SPAN = 260; // Covers [-260, +260] meters (520m x 520m)
const MAP_SPAN = MAP_HALF_SPAN * 2;
const BAKE_RES = 240;
const MINIMAP_HALF_VIEW = 120;
const STYLE_MODES: MapStyleMode[] = ['TOPO', 'SATELLITE', 'RADAR', 'ELEVATION'];

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

export function renderMapCanvas(
  mapId: WorldMapId,
  style: MapStyleMode,
  resolution = BAKE_RES
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const def = getWorldMapDef(mapId);
  const img = ctx.createImageData(resolution, resolution);
  const data = img.data;
  const step = MAP_SPAN / resolution;

  const heights = new Float32Array((resolution + 1) * (resolution + 1));
  for (let py = 0; py <= resolution; py++) {
    const wz = -MAP_HALF_SPAN + py * step;
    for (let px = 0; px <= resolution; px++) {
      const wx = -MAP_HALF_SPAN + px * step;
      heights[py * (resolution + 1) + px] = groundHeightAt(wx, wz, mapId);
    }
  }

  const lx = -0.62;
  const ly = 0.58;
  const lz = -0.52;

  for (let py = 0; py < resolution; py++) {
    const wz = -MAP_HALF_SPAN + (py + 0.5) * step;
    for (let px = 0; px < resolution; px++) {
      const wx = -MAP_HALF_SPAN + (px + 0.5) * step;
      const idx = py * (resolution + 1) + px;
      const h = heights[idx];
      const hR = heights[idx + 1];
      const hD = heights[idx + (resolution + 1)];

      const water = waterDistanceInfo(wx, wz, mapId);
      const isBridgeDeck =
        Boolean(def.hasClassicStructures) && wx >= 1 && wx <= 35 && wz >= 9.6 && wz <= 14.4;
      const isWater = (h < WATER_LEVEL && !isBridgeDeck) || (water.isUpperStream && water.dist < 16);

      const nx = h - hR;
      const ny = step;
      const nz = h - hD;
      const len = Math.hypot(nx, ny, nz) || 1;
      const dot = (nx * lx + ny * ly + nz * lz) / len;
      const shade = 0.72 + Math.max(0, dot) * 0.56;
      const isContour =
        Math.floor(h / 6) !== Math.floor(hR / 6) || Math.floor(h / 6) !== Math.floor(hD / 6);

      let r = 0;
      let g = 0;
      let b = 0;

      if (style === 'RADAR') {
        if (isBridgeDeck) {
          r = 245;
          g = 175;
          b = 65;
        } else if (isWater) {
          r = 8;
          g = 28;
          b = 44;
        } else {
          const elevGlow = Math.min(1, Math.max(0, h / 34));
          r = 10 + elevGlow * 16;
          g = 34 + elevGlow * 88 * shade;
          b = 46 + elevGlow * 102 * shade;
          if (isContour) {
            r += 16;
            g += 72;
            b += 78;
          }
        }
      } else if (style === 'ELEVATION') {
        if (isBridgeDeck) {
          r = 250;
          g = 204;
          b = 21;
        } else if (isWater) {
          const depth = Math.min(1, Math.max(0, (WATER_LEVEL - h) / 4.2));
          r = 18 - depth * 10;
          g = 86 - depth * 52;
          b = 164 - depth * 64;
        } else {
          const t = Math.min(1, Math.max(0, h / 38));
          if (t < 0.25) {
            const u = t / 0.25;
            r = 34 + u * 44;
            g = 128 + u * 46;
            b = 76 - u * 18;
          } else if (t < 0.55) {
            const u = (t - 0.25) / 0.3;
            r = 78 + u * 145;
            g = 174 - u * 22;
            b = 58 - u * 16;
          } else if (t < 0.82) {
            const u = (t - 0.55) / 0.27;
            r = 223 - u * 45;
            g = 152 - u * 54;
            b = 42 + u * 58;
          } else {
            const u = (t - 0.82) / 0.18;
            r = 178 + u * 68;
            g = 98 + u * 148;
            b = 100 + u * 148;
          }
          r *= shade;
          g *= shade;
          b *= shade;
          if (isContour) {
            r *= 0.85;
            g *= 0.85;
            b *= 0.85;
          }
        }
      } else {
        // TOPO or SATELLITE
        if (isBridgeDeck) {
          r = 198;
          g = 144;
          b = 84;
        } else if (isWater) {
          if (water.isUpperStream) {
            r = 72;
            g = 166;
            b = 204;
          } else {
            const depth = Math.min(1, Math.max(0, (WATER_LEVEL - h) / 4.2));
            r = 44 - depth * 28;
            g = 140 - depth * 80;
            b = 182 - depth * 82;
            if (depth < 0.14) {
              r += 24;
              g += 26;
              b += 20;
            }
          }
        } else {
          const w = getBiomeWeights(wx, wz, h, mapId);
          const cave = getCaveProximity(wx, wz, mapId);

          r = w.forest * 45 + w.meadow * 86 + w.marsh * 56 + w.desert * 196 + w.mountain * 108;
          g = w.forest * 92 + w.meadow * 128 + w.marsh * 82 + w.desert * 154 + w.mountain * 114;
          b = w.forest * 58 + w.meadow * 64 + w.marsh * 68 + w.desert * 92 + w.mountain * 124;

          if (w.village > 0.01) {
            const vMix = Math.min(0.6, w.village * 0.65);
            r = r * (1 - vMix) + 124 * vMix;
            g = g * (1 - vMix) + 106 * vMix;
            b = b * (1 - vMix) + 78 * vMix;
          }

          if (w.snow > 0.01) {
            const sMix = Math.min(1, w.snow);
            r = r * (1 - sMix) + 230 * sMix;
            g = g * (1 - sMix) + 238 * sMix;
            b = b * (1 - sMix) + 248 * sMix;
          }

          if (cave.inCaveZone > 0.05) {
            const cMix = Math.min(0.75, cave.inCaveZone * 0.8);
            r = r * (1 - cMix) + 36 * cMix;
            g = g * (1 - cMix) + 40 * cMix;
            b = b * (1 - cMix) + 54 * cMix;
          }

          const satBoost = style === 'SATELLITE' ? 1.06 : 1.0;
          r *= shade * satBoost;
          g *= shade * satBoost;
          b *= shade * satBoost;

          if (style === 'TOPO' && isContour) {
            r *= 0.84;
            g *= 0.84;
            b *= 0.84;
          }
        }
      }

      const off = (py * resolution + px) * 4;
      data[off] = clampByte(r);
      data[off + 1] = clampByte(g);
      data[off + 2] = clampByte(b);
      data[off + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  if (style === 'TOPO' || style === 'RADAR') {
    ctx.strokeStyle = style === 'RADAR' ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let m = -200; m <= 200; m += 100) {
      const pos = ((m + MAP_HALF_SPAN) / MAP_SPAN) * resolution;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, resolution);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(resolution, pos);
      ctx.stroke();
    }
  }

  return canvas;
}

function worldToNorm(wx: number, wz: number): { nx: number; ny: number } {
  return {
    nx: (wx + MAP_HALF_SPAN) / MAP_SPAN,
    ny: (wz + MAP_HALF_SPAN) / MAP_SPAN,
  };
}

export const WorldMap: React.FC<WorldMapProps> = ({
  visible,
  isOpen,
  onOpenChange,
  activeMapId,
  playerX,
  playerZ,
  headingDeg,
  elevation,
  biomeLabel,
  campfireLit,
  lang,
  compact = false,
  remotePlayers = [],
  enemyMarkers = [],
  onTeleport,
  onSwitchMap,
}) => {
  const t = TRANSLATIONS[lang];
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fullCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mapStyle, setMapStyle] = useState<MapStyleMode>('TOPO');
  const [atlasTab, setAtlasTab] = useState<'CURRENT' | 'ALL'>('CURRENT');

  const activeMapDef = useMemo(() => getWorldMapDef(activeMapId), [activeMapId]);

  const bakedTerrain = useMemo(() => {
    if (typeof document === 'undefined') return null;
    return renderMapCanvas(activeMapId, mapStyle, BAKE_RES);
  }, [activeMapId, mapStyle]);

  // Lazily bake all 8 miniature map thumbnails when the All Maps tab is opened
  const mapThumbnails = useMemo(() => {
    if (!isOpen || atlasTab !== 'ALL' || typeof document === 'undefined') return null;
    const out: Partial<Record<WorldMapId, string>> = {};
    for (const def of WORLD_MAPS) {
      const c = renderMapCanvas(def.id, 'TOPO', 96);
      out[def.id] = c.toDataURL();
    }
    return out;
  }, [isOpen, atlasTab]);

  // Draw live Mini-Map sliding terrain + player FOV cone + landmark indicators
  useEffect(() => {
    if (!visible || !bakedTerrain) return;
    const canvas = miniCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const half = size * 0.5;
    const pxPerMeter = size / (MINIMAP_HALF_VIEW * 2);

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0c1118';
    ctx.fillRect(0, 0, size, size);

    const mapPxSize = MAP_SPAN * pxPerMeter;
    const originX = half - (playerX + MAP_HALF_SPAN) * pxPerMeter;
    const originY = half - (playerZ + MAP_HALF_SPAN) * pxPerMeter;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bakedTerrain, originX, originY, mapPxSize, mapPxSize);
    ctx.restore();

    // Spawn campfire marker
    const campDx = (activeMapDef.spawn.x - playerX) * pxPerMeter;
    const campDz = (activeMapDef.spawn.z - playerZ) * pxPerMeter;
    if (Math.hypot(campDx, campDz) < half - 8) {
      ctx.beginPath();
      ctx.arc(half + campDx, half + campDz, 4, 0, Math.PI * 2);
      ctx.fillStyle = campfireLit ? '#fb923c' : '#9ca3af';
      ctx.fill();
      ctx.strokeStyle = '#0b0e11';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Landmark pins & rim indicators
    for (const lm of activeMapDef.landmarks) {
      const dx = (lm.x - playerX) * pxPerMeter;
      const dz = (lm.z - playerZ) * pxPerMeter;
      const distPx = Math.hypot(dx, dz);
      const maxR = half - 10;

      if (distPx <= maxR) {
        ctx.beginPath();
        ctx.arc(half + dx, half + dz, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        ctx.strokeStyle = '#0b0e11';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        const edgeX = half + (dx / distPx) * (half - 6);
        const edgeY = half + (dz / distPx) * (half - 6);
        ctx.beginPath();
        ctx.arc(edgeX, edgeY, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.82)';
        ctx.fill();
      }
    }

    // Player FOV cone + directional chevron
    const rad = (headingDeg * Math.PI) / 180;
    const angle = Math.atan2(-Math.cos(rad), Math.sin(rad));

    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(angle);

    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 46);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.42)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 46, -0.52, 0.52);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(9.5, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    // Hostile enemies & World Boss markers on mini-map
    for (const em of enemyMarkers) {
      const dx = (em.x - playerX) * pxPerMeter;
      const dz = (em.z - playerZ) * pxPerMeter;
      const distPx = Math.hypot(dx, dz);
      const maxR = half - 9;
      if (distPx > maxR && em.category !== 'boss') continue;
      const drawX = distPx <= maxR ? half + dx : half + (dx / distPx) * (half - 7);
      const drawY = distPx <= maxR ? half + dz : half + (dz / distPx) * (half - 7);
      const color = getEnemyMarkerColor(em.category);

      if (em.category === 'boss') {
        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = color;
        ctx.fillRect(-4.5, -4.5, 9, 9);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.3;
        ctx.strokeRect(-4.5, -4.5, 9, 9);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(drawX, drawY, 3.1, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#0b0e11';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // Remote teammates on the same map
    for (const rp of remotePlayers) {
      if (rp.mapId !== activeMapId) continue;
      const dx = (rp.x - playerX) * pxPerMeter;
      const dz = (rp.z - playerZ) * pxPerMeter;
      const distPx = Math.hypot(dx, dz);
      const maxR = half - 10;
      const colorCss =
        PLAYER_PALETTE[((rp.colorIdx % PLAYER_PALETTE.length) + PLAYER_PALETTE.length) % PLAYER_PALETTE.length];

      if (distPx <= maxR) {
        ctx.beginPath();
        ctx.arc(half + dx, half + dz, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = colorCss;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else {
        const edgeX = half + (dx / distPx) * (half - 6);
        const edgeY = half + (dz / distPx) * (half - 6);
        ctx.beginPath();
        ctx.arc(edgeX, edgeY, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = colorCss;
        ctx.fill();
      }
    }
  }, [visible, bakedTerrain, activeMapDef, activeMapId, playerX, playerZ, headingDeg, campfireLit, remotePlayers, enemyMarkers]);

  // Draw Full World Atlas base terrain + player cone when Current Map tab is visible
  useEffect(() => {
    if (!isOpen || atlasTab !== 'CURRENT' || !bakedTerrain) return;
    const canvas = fullCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(bakedTerrain, 0, 0, size, size);

    const { nx, ny } = worldToNorm(playerX, playerZ);
    const px = nx * size;
    const py = ny * size;
    const rad = (headingDeg * Math.PI) / 180;
    const angle = Math.atan2(-Math.cos(rad), Math.sin(rad));

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 44);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.55)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 44, -0.52, 0.52);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6.5, -6.5);
    ctx.lineTo(-3.2, 0);
    ctx.lineTo(-6.5, 6.5);
    ctx.closePath();
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    // Draw hostile enemy markers on Full Atlas canvas
    for (const em of enemyMarkers) {
      const pos = worldToNorm(em.x, em.z);
      const ex = pos.nx * size;
      const ey = pos.ny * size;
      const color = getEnemyMarkerColor(em.category);

      if (em.category === 'boss') {
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = color;
        ctx.fillRect(-5.5, -5.5, 11, 11);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.6;
        ctx.strokeRect(-5.5, -5.5, 11, 11);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(ex, ey, 3.8, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#0b0e11';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
    }

    // Draw remote teammates on Full Atlas canvas
    for (const rp of remotePlayers) {
      if (rp.mapId !== activeMapId) continue;
      const pos = worldToNorm(rp.x, rp.z);
      const rx = pos.nx * size;
      const ry = pos.ny * size;
      const colorCss =
        PLAYER_PALETTE[((rp.colorIdx % PLAYER_PALETTE.length) + PLAYER_PALETTE.length) % PLAYER_PALETTE.length];

      ctx.beginPath();
      ctx.arc(rx, ry, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = colorCss;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = '600 11px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(10,14,20,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(rp.name, rx + 8, ry + 4);
      ctx.fillText(rp.name, rx + 8, ry + 4);
    }
  }, [isOpen, atlasTab, bakedTerrain, activeMapId, playerX, playerZ, headingDeg, remotePlayers, enemyMarkers]);

  if (!visible) return null;

  const playerNorm = worldToNorm(playerX, playerZ);
  const campNorm = worldToNorm(activeMapDef.spawn.x, activeMapDef.spawn.z);
  const bridgeNorm = worldToNorm(18, 12);
  const currentMapMeta = t.worldMaps[activeMapId];

  return (
    <>
      {/* Top-Right Compact Live Mini-Map */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(true);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        aria-label={t.map.openMap}
        title={t.map.minimapLabel}
        className={`group absolute z-20 border border-white/20 bg-[#0b1016]/85 shadow-[0_6px_18px_rgba(0,0,0,0.5)] overflow-hidden cursor-pointer transition-transform active:scale-95 hover:border-amber-400/70 select-none ${
          compact
            ? 'top-10 right-2.5 w-[94px] h-[94px] rounded-xl'
            : 'top-14 right-5 w-[132px] h-[132px] rounded-xl'
        }`}
      >
        <canvas ref={miniCanvasRef} width={220} height={220} className="w-full h-full block" />
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />

        <span
          className={`pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 rounded bg-[#0b1016]/85 font-bold tracking-wider text-amber-300 border border-white/10 ${
            compact ? 'px-1 py-0 text-[8.5px]' : 'px-1.5 py-[1px] text-[10px]'
          }`}
        >
          {t.map.northShort}
        </span>

        <span className="pointer-events-none absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1">
          {!compact && (
            <span className="truncate max-w-[82px] px-1.5 py-[1px] rounded bg-[#0b1016]/85 text-[9px] font-medium text-stone-200 border border-white/10">
              {currentMapMeta.name}
            </span>
          )}
          <span
            className={`ml-auto flex items-center gap-1 rounded bg-[#0b1016]/85 font-medium text-stone-200 border border-white/10 group-hover:text-amber-300 ${
              compact ? 'px-1 py-[1px] text-[8.5px]' : 'px-1.5 py-[2px] text-[10px]'
            }`}
          >
            <Maximize2 className={compact ? 'w-2.5 h-2.5' : 'w-2.5 h-2.5'} />
            {!compact && <span>M</span>}
          </span>
        </span>
      </button>

      {/* Expanded Interactive World Atlas & 8-Map Switcher Modal */}
      {isOpen && (
        <div
          onClick={() => onOpenChange(false)}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={t.map.title}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-2 sm:p-5"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[min(860px,96%)] max-h-[92%] overflow-y-auto rounded-xl border border-white/15 bg-[#0d1117]/97 text-stone-100 shadow-2xl flex flex-col"
          >
            {/* Header with Atlas Tab Switcher + Style Modes */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 sm:px-5 sm:py-3 border-b border-white/10">
              <div className="flex items-center gap-2 min-w-0">
                <MapIcon className="w-4 h-4 text-amber-400 shrink-0" />
                <h2 className="font-display text-sm sm:text-base font-semibold tracking-wider text-white truncate">
                  {currentMapMeta.name}
                </h2>
                <span className="hidden md:inline text-xs text-stone-400">
                  · {t.biomes[biomeLabel] ?? biomeLabel}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <div className="flex items-center rounded-md bg-[#161c24] p-0.5 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setAtlasTab('CURRENT')}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                      atlasTab === 'CURRENT'
                        ? 'bg-amber-500 text-stone-950 font-semibold'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>{t.map.currentMapTab}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAtlasTab('ALL')}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                      atlasTab === 'ALL'
                        ? 'bg-amber-500 text-stone-950 font-semibold'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    <Globe2 className="w-3.5 h-3.5" />
                    <span>{t.map.allMapsTab}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  aria-label={t.map.closeMap}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/8 hover:bg-white/15 text-xs text-stone-200 transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                  <span className="hidden sm:inline">{t.map.closeMap}</span>
                </button>
              </div>
            </div>

            {atlasTab === 'CURRENT' ? (
              <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1.25fr)_minmax(215px,0.85fr)] gap-3 sm:gap-4 items-start">
                {/* Interactive Map Canvas */}
                <div className="flex flex-col gap-2">
                  {/* Map View Style Switcher */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-stone-400">
                      <Layers className="w-3.5 h-3.5 text-amber-400" />
                      <div className="flex items-center gap-1 bg-[#161c24] p-0.5 rounded-md border border-white/10">
                        {STYLE_MODES.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setMapStyle(mode)}
                            className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                              mapStyle === mode
                                ? 'bg-[#2a3442] text-amber-300'
                                : 'text-stone-400 hover:text-stone-200'
                            }`}
                          >
                            {t.map.styles[mode]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="relative w-full aspect-square max-h-[70vh] sm:max-h-[58vh] mx-auto rounded-lg overflow-hidden border border-white/15 bg-[#0b1016]">
                    <canvas
                      ref={fullCanvasRef}
                      width={520}
                      height={520}
                      className="w-full h-full block"
                    />

                    {/* Cardinal Markers */}
                    <span className="pointer-events-none absolute top-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-[#0d1117]/85 text-[10px] font-bold text-amber-300 border border-white/10">
                      {t.cardinals[0]}
                    </span>
                    <span className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-[#0d1117]/85 text-[10px] font-semibold text-stone-300 border border-white/10">
                      {t.cardinals[4]}
                    </span>
                    <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-[#0d1117]/85 text-[10px] font-semibold text-stone-300 border border-white/10">
                      {t.cardinals[6]}
                    </span>
                    <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-[#0d1117]/85 text-[10px] font-semibold text-stone-300 border border-white/10">
                      {t.cardinals[2]}
                    </span>

                    {/* Wooden Bridge Indicator (Lost Valley only) */}
                    {activeMapDef.hasClassicStructures && (
                      <div
                        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 px-1 py-0.5 rounded bg-[#0d1117]/75 text-[9px] text-amber-200/90 border border-amber-400/25 whitespace-nowrap"
                        style={{
                          left: `${bridgeNorm.nx * 100}%`,
                          top: `${bridgeNorm.ny * 100}%`,
                        }}
                      >
                        {t.map.bridge}
                      </div>
                    )}

                    {/* Campfire Indicator */}
                    <div
                      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 rounded-full bg-orange-500/25 border border-orange-400/60"
                      style={{
                        left: `${campNorm.nx * 100}%`,
                        top: `${campNorm.ny * 100}%`,
                      }}
                      title={t.map.campfire}
                    >
                      <Flame className={`w-2.5 h-2.5 ${campfireLit ? 'text-orange-400' : 'text-stone-400'}`} />
                    </div>

                    {/* Interactive Landmark Pins */}
                    {activeMapDef.landmarks.map((lm) => {
                      const pos = worldToNorm(lm.x, lm.z);
                      const label = t.landmarks[lm.id] ?? lm.name;
                      return (
                        <button
                          key={lm.id}
                          type="button"
                          onClick={() => {
                            onTeleport(lm.id);
                            onOpenChange(false);
                          }}
                          style={{
                            left: `${pos.nx * 100}%`,
                            top: `${pos.ny * 100}%`,
                          }}
                          className="group absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center cursor-pointer z-10"
                          title={label}
                        >
                          <span className="w-3 h-3 rounded-full bg-amber-400 border-2 border-[#0b1016] shadow group-hover:scale-125 group-hover:bg-amber-300 transition-transform" />
                          <span className="mt-0.5 px-1.5 py-[1px] rounded bg-[#0b1016]/88 text-[9px] sm:text-[10px] font-medium text-stone-100 border border-white/12 group-hover:border-amber-400/60 group-hover:text-amber-300 whitespace-nowrap">
                            {label}
                          </span>
                        </button>
                      );
                    })}

                    {/* Player Pulse Label */}
                    <div
                      className="pointer-events-none absolute -translate-x-1/2 translate-y-2.5 z-20"
                      style={{
                        left: `${Math.min(96, Math.max(4, playerNorm.nx * 100))}%`,
                        top: `${Math.min(94, Math.max(4, playerNorm.ny * 100))}%`,
                      }}
                    >
                      <span className="px-1.5 py-[1px] rounded bg-sky-500/90 text-[9px] font-bold text-stone-950 whitespace-nowrap shadow">
                        {t.map.playerMarker}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Info & Fast-Travel Sidebar */}
                <div className="flex flex-col gap-2.5 text-xs">
                  <div className="rounded-lg border border-white/10 bg-[#141a23] p-2.5 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sky-300 font-semibold">
                        <Navigation className="w-3.5 h-3.5" />
                        {t.map.playerMarker}
                      </span>
                      <span className="font-mono-num text-stone-300">
                        {t.cardinals[Math.round(headingDeg / 45) % 8]} {headingDeg}°
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-stone-400 font-mono-num">
                      <span>
                        {t.map.coordinates}: X {Math.round(playerX)} · Z {Math.round(playerZ)}
                      </span>
                      <span>{elevation.toFixed(1)}m</span>
                    </div>
                  </div>

                  {/* Fast-Travel Landmarks */}
                  <div className="rounded-lg border border-white/10 bg-[#141a23] p-2.5 flex flex-col gap-1.5">
                    <div className="flex items-center gap-1 text-[11px] text-amber-300 font-medium">
                      <Compass className="w-3.5 h-3.5" />
                      <span>{t.map.teleportHint}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-1 gap-1.5 mt-0.5">
                      {activeMapDef.landmarks.map((lm) => {
                        const dist = Math.round(Math.hypot(lm.x - playerX, lm.z - playerZ));
                        return (
                          <button
                            key={lm.id}
                            type="button"
                            onClick={() => {
                              onTeleport(lm.id);
                              onOpenChange(false);
                            }}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-[#1a222d] hover:bg-amber-500/20 border border-white/8 hover:border-amber-400/50 text-left transition-colors cursor-pointer"
                          >
                            <span className="text-stone-200 font-medium truncate">
                              {t.landmarks[lm.id] ?? lm.name}
                            </span>
                            <span className="font-mono-num text-[11px] text-amber-300 shrink-0">
                              {dist}m
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Biome Legend */}
                  <div className="rounded-lg border border-white/10 bg-[#141a23] p-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-stone-300">
                    <LegendItem color="bg-[#2d5c3a]" label={t.map.legend.forest} />
                    <LegendItem color="bg-[#227ca8]" label={t.map.legend.water} />
                    <LegendItem color="bg-[#cfd8e4]" label={t.map.legend.mountain} />
                    <LegendItem color="bg-[#c4985a]" label={t.map.legend.desert} />
                    <LegendItem color="bg-[#385244]" label={t.map.legend.marsh} />
                    <LegendItem color="bg-orange-400" label={t.map.campfire} />
                  </div>
                </div>
              </div>
            ) : (
              /* 8-Map Playable Worlds Gallery */
              <div className="p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                {WORLD_MAPS.map((def) => {
                  const isCurrent = def.id === activeMapId;
                  const meta = t.worldMaps[def.id];
                  const thumb = mapThumbnails?.[def.id];
                  return (
                    <button
                      key={def.id}
                      type="button"
                      onClick={() => {
                        onSwitchMap(def.id);
                        setAtlasTab('CURRENT');
                        onOpenChange(false);
                      }}
                      className={`group flex flex-col rounded-xl border p-2 text-left transition-all cursor-pointer ${
                        isCurrent
                          ? 'bg-amber-500/15 border-amber-400 shadow-lg'
                          : 'bg-[#141a23] border-white/12 hover:border-amber-400/60 hover:bg-[#1a222d]'
                      }`}
                    >
                      <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-[#0b1016] border border-white/10">
                        {thumb && (
                          <img
                            src={thumb}
                            alt={meta.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        )}
                        {isCurrent && (
                          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-amber-500 text-[10px] font-bold text-stone-950 shadow">
                            {t.map.activeBadge}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-col gap-0.5 min-w-0">
                        <span className="text-xs sm:text-sm font-semibold text-white truncate">
                          {meta.name}
                        </span>
                        <span className="text-[11px] text-stone-400 line-clamp-2 leading-snug">
                          {meta.desc}
                        </span>
                      </div>
                      <span
                        className={`mt-2 text-[11px] font-semibold ${
                          isCurrent ? 'text-amber-300' : 'text-sky-300 group-hover:text-amber-300'
                        }`}
                      >
                        {isCurrent ? t.map.activeBadge : t.map.enterMapBtn}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className={`w-2.5 h-2.5 rounded-sm shrink-0 border border-white/20 ${color}`} />
      <span className="truncate">{label}</span>
    </div>
  );
}
