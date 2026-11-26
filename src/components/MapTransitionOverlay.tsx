import React, { useEffect, useRef } from 'react';
import { Compass } from 'lucide-react';
import { WorldMapId } from '../game/types';
import { SurvivalLoadProgress } from '../game/engine';
import { GameLang, TRANSLATIONS } from '../i18n';
import { renderMapCanvas } from './WorldMap';

interface MapTransitionOverlayProps {
  visible: boolean;
  mapId: WorldMapId;
  progress: SurvivalLoadProgress;
  lang: GameLang;
}

export const MapTransitionOverlay: React.FC<MapTransitionOverlayProps> = ({
  visible,
  mapId,
  progress,
  lang,
}) => {
  const thumbCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!visible) return;
    const canvas = thumbCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const preview = renderMapCanvas(mapId, 'TOPO', 180);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);
  }, [visible, mapId]);

  if (!visible) return null;

  const t = TRANSLATIONS[lang];
  const mapInfo = t.worldMaps[mapId];
  const translatedStage = t.loadStages[progress.stage] ?? progress.stage;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-[#090c10]/96 p-4 sm:p-8 text-stone-100"
      role="status"
      aria-live="polite"
      aria-label={mapInfo.name}
    >
      <div className="w-full max-w-xl border border-white/12 bg-[#0f141b] rounded-xl shadow-2xl p-4 sm:p-6 flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg overflow-hidden border border-white/15 bg-[#0a0e13] shrink-0">
            <canvas
              ref={thumbCanvasRef}
              width={180}
              height={180}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
              <Compass className="w-3.5 h-3.5 shrink-0" />
              <span>{t.map.loadingMapLabel}</span>
            </div>
            <h2 className="mt-1 font-display text-xl sm:text-2xl font-bold tracking-wide text-white truncate">
              {mapInfo.name}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-stone-400 leading-relaxed">
              {mapInfo.desc}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between gap-4 text-xs sm:text-sm">
            <span className="text-stone-200 font-medium truncate">{translatedStage}</span>
            <span className="font-mono-num text-amber-400 font-semibold shrink-0">
              {progress.percent}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/12">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-[width] duration-200 ease-out"
              style={{ width: `${Math.min(100, Math.max(6, progress.percent))}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
