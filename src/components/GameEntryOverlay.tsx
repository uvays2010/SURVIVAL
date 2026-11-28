import React, { useState } from 'react';
import { Compass, Play, Volume2, VolumeX } from 'lucide-react';
import { QualityPreset } from '../game/types';
import { SurvivalLoadProgress } from '../game/engine';
import { GameLang, TRANSLATIONS } from '../i18n';
import { PWAInstallButton } from './PWAInstallButton';

interface GameEntryOverlayProps {
  progress: SurvivalLoadProgress;
  quality: QualityPreset;
  onQualityChange: (q: QualityPreset) => void;
  audioEnabledOnStart: boolean;
  onToggleAudioOnStart: () => void;
  onEnterWorld: () => void;
  visible: boolean;
  lang: GameLang;
  onLangChange: (lang: GameLang) => void;
}

const QUALITY_OPTIONS: QualityPreset[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA', 'CINEMATIC'];
const LANG_OPTIONS: { code: GameLang; label: string }[] = [
  { code: 'uz', label: 'UZ' },
  { code: 'ru', label: 'RU' },
  { code: 'en', label: 'EN' },
];

export const GameEntryOverlay: React.FC<GameEntryOverlayProps> = ({
  progress,
  quality,
  onQualityChange,
  audioEnabledOnStart,
  onToggleAudioOnStart,
  onEnterWorld,
  visible,
  lang,
  onLangChange,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  if (!visible) return null;

  const t = TRANSLATIONS[lang];
  const translatedStage = t.loadStages[progress.stage] ?? progress.stage;

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-between overflow-y-auto bg-[#0b0e11] text-stone-100"
      role="region"
      aria-label={t.gameTitle}
    >
      {/* Key-Art Backdrop with CSS Gradient Fallback & Contrast Scrim */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#1b2430] via-[#10161f] to-[#0b0e11]">
        {!imgFailed && (
          <img
            src="/src/assets/images/survival_loading_backdrop_1795713421841.jpg"
            alt={t.gameTitle}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover object-center opacity-70"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0e11] via-[#0b0e11]/65 to-[#0b0e11]/45" />
      </div>

      {/* Top Row: Compact Brand Mark, Language Switcher & Install Action */}
      <header className="relative z-10 flex items-center justify-between gap-2 px-3.5 py-2.5 sm:px-8 sm:py-4">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src="/pwa-192x192.png"
            alt={t.gameTitle}
            className="w-6 h-6 sm:w-7 sm:h-7 rounded-md border border-white/15 shrink-0"
          />
          <span className="font-display text-xs sm:text-sm font-semibold tracking-wider text-stone-100 whitespace-nowrap truncate">
            {t.gameTitle}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className="flex items-center rounded-md bg-[#10161e]/90 p-0.5 border border-white/15"
            role="group"
            aria-label="Language"
          >
            {LANG_OPTIONS.map((item) => (
              <button
                key={item.code}
                type="button"
                onClick={() => onLangChange(item.code)}
                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  lang === item.code
                    ? 'bg-amber-500 text-stone-950'
                    : 'text-stone-300 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <PWAInstallButton variant="compact" lang={lang} />
        </div>
      </header>

      {/* Center / Bottom Launch & Loading Panel */}
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end px-4 pb-4 pt-2 sm:px-8 sm:pb-8">
        <div className="max-w-xl">
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-amber-300/95 font-medium">
            <Compass className="w-3 h-3 shrink-0" />
            <span>{t.subtitleBadge}</span>
          </div>

          <h2 className="mt-1 font-display text-lg sm:text-3xl font-bold tracking-wide text-white [text-wrap:balance]">
            {t.gameTitle}
          </h2>

          <p className="mt-1.5 text-[11px] sm:text-xs text-stone-300 leading-relaxed max-w-lg hidden sm:block">
            {t.heroDescription}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] sm:text-[11px] text-stone-400">
            <span>{t.heroTags[0]}</span>
            <span aria-hidden="true">·</span>
            <span>{t.heroTags[1]}</span>
            <span aria-hidden="true">·</span>
            <span>{t.heroTags[2]}</span>
          </div>
        </div>

        {/* Graphics Preset + Audio Row */}
        <div className="mt-3 sm:mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2.5 sm:pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] sm:text-[11px] text-stone-400 whitespace-nowrap">{t.graphicsLabel}</span>
            <div className="flex flex-wrap items-center gap-0.5 rounded-md bg-[#10161e]/90 p-0.5 border border-white/10">
              {QUALITY_OPTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onQualityChange(q)}
                  className={`px-1.5 py-0.5 sm:px-2 sm:py-1 text-[10px] sm:text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    quality === q
                      ? 'bg-amber-500 text-stone-950 font-semibold'
                      : 'text-stone-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {t.qualityNames[q]}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleAudioOnStart}
            className="flex items-center gap-1.5 rounded-md border border-white/15 bg-[#10161e]/90 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-[11px] font-medium text-stone-200 hover:bg-[#1a222e] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {audioEnabledOnStart ? (
              <Volume2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <VolumeX className="w-3 h-3 text-stone-400" />
            )}
            <span>{audioEnabledOnStart ? t.audioOnLabel : t.audioMutedLabel}</span>
          </button>
        </div>

        {/* Loading Progress Track & Primary Launch Action */}
        <div className="mt-2.5 sm:mt-4 flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3 text-[11px] sm:text-xs">
              <span className="text-stone-200 font-medium truncate">{translatedStage}</span>
              <span className="font-mono-num text-amber-400 font-semibold shrink-0">
                {progress.percent}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/12">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-[width] duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(4, progress.percent))}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
            <button
              type="button"
              disabled={!progress.ready}
              onClick={onEnterWorld}
              className={`flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                progress.ready
                  ? 'bg-amber-500 hover:bg-amber-400 text-stone-950 shadow-lg cursor-pointer'
                  : 'bg-stone-800 text-stone-400 cursor-wait'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{progress.ready ? t.enterWorld : t.loadingWorld}</span>
            </button>

            <PWAInstallButton variant="hero" lang={lang} />
          </div>
        </div>
      </main>
    </div>
  );
};
