import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  CloudRain,
  Compass,
  Flashlight,
  Gamepad2,
  MapPin,
  Pause,
  Play,
  RotateCw,
  Sliders,
  Sun,
  Swords,
  Volume2,
  VolumeX,
  Wind,
} from 'lucide-react';
import { GameEntryOverlay } from './components/GameEntryOverlay';
import { MapTransitionOverlay } from './components/MapTransitionOverlay';
import { MobileTouchControls } from './components/MobileTouchControls';
import { OfflineIndicator } from './components/OfflineIndicator';
import { WorldMap } from './components/WorldMap';
import {
  GameLang,
  getInitialLanguage,
  LANG_STORAGE_KEY,
  TRANSLATIONS,
} from './i18n';
import { SurvivalEngine, SurvivalLoadProgress } from './game/engine';
import {
  CameraMode,
  getPresetGraphicsFlags,
  getWorldMapDef,
  GraphicsFlags,
  HudTelemetry,
  QualityPreset,
  WeatherMode,
  WORLD_MAPS,
  WorldMapId,
} from './game/types';

type DockTab = 'GRAPHICS' | 'WEATHER' | 'WORLD' | 'CONTROLS';

const QUALITY_LIST: QualityPreset[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA', 'CINEMATIC'];
const WEATHER_IDS: WeatherMode[] = ['DYNAMIC', 'CLEAR', 'FOGGY', 'RAIN', 'STORM', 'SNOW'];

function formatTime(hours: number): string {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SurvivalEngine | null>(null);
  const [lang, setLang] = useState<GameLang>(getInitialLanguage);
  const t = TRANSLATIONS[lang];

  const [webglError, setWebglError] = useState<string | null>(null);
  const [touchMode, setTouchMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia?.('(pointer: coarse)').matches ||
      navigator.maxTouchPoints > 0 ||
      window.innerWidth < 820
    );
  });
  const [dockOpen, setDockOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth >= 820;
  });
  const [landscapeMode, setLandscapeMode] = useState<boolean>(true);
  const [viewport, setViewport] = useState<{ width: number; height: number }>(() => {
    if (typeof window === 'undefined') return { width: 1280, height: 720 };
    return {
      width: window.visualViewport?.width ?? window.innerWidth,
      height: window.visualViewport?.height ?? window.innerHeight,
    };
  });
  const [activeTab, setActiveTab] = useState<DockTab>(() => (touchMode ? 'CONTROLS' : 'GRAPHICS'));

  const [quality, setQuality] = useState<QualityPreset>(() => (touchMode ? 'MEDIUM' : 'HIGH'));
  const [graphicsFlags, setGraphicsFlags] = useState<GraphicsFlags>(() =>
    getPresetGraphicsFlags(touchMode ? 'MEDIUM' : 'HIGH')
  );
  const [lookSensitivity, setLookSensitivity] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('lost_world_sensitivity');
        if (saved) {
          const parsed = parseFloat(saved);
          if (Number.isFinite(parsed) && parsed >= 0.4 && parsed <= 3.0) return parsed;
        }
      } catch {
        // Ignore storage read errors
      }
    }
    return touchMode ? 1.6 : 1.0;
  });
  const [weatherMode, setWeatherMode] = useState<WeatherMode>('DYNAMIC');
  const [cameraMode, setCameraMode] = useState<CameraMode>('THIRD_PERSON');
  const [timePaused, setTimePaused] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [audioOnStart, setAudioOnStart] = useState(true);
  const [activeMapId, setActiveMapId] = useState<WorldMapId>('lost_valley');
  const [enteredWorld, setEnteredWorld] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [loadProgress, setLoadProgress] = useState<SurvivalLoadProgress>({
    percent: 4,
    stage: 'Preparing Expedition...',
    ready: false,
  });
  const [mapSwitchState, setMapSwitchState] = useState<{
    mapId: WorldMapId;
    progress: SurvivalLoadProgress;
  } | null>(null);
  const mapSwitchHideTimerRef = useRef<number | null>(null);
  const enteredWorldRef = useRef(false);
  enteredWorldRef.current = enteredWorld;

  const [telemetry, setTelemetry] = useState<HudTelemetry>({
    activeMapId: 'lost_valley',
    biomeLabel: 'Emerald Old-Growth',
    timeHours: 17.65,
    weatherLabel: 'Clear Breeze',
    headingDeg: 300,
    elevation: 3.2,
    playerX: -16,
    playerZ: 76,
    speedMs: 0,
    stamina: 100,
    warmth: 90,
    hydration: 92,
    nearCampfire: true,
    campfireLit: true,
    nearWater: false,
    isSwimming: false,
    inCave: false,
    flashlightOn: false,
    fps: 60,
    isPointerLocked: false,
  });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const engine = new SurvivalEngine(container, {
      onTelemetry: (data) => setTelemetry(data),
      onWebglError: (msg) => setWebglError(msg),
      onLoadProgress: (prog) => setLoadProgress(prog),
      onMapSwitchProgress: (prog) => {
        if (enteredWorldRef.current) {
          setMapSwitchState((prev) => (prev ? { ...prev, progress: prog } : prev));
        }
      },
      initialQuality: quality,
      initialSensitivity: lookSensitivity,
      initialMapId: activeMapId,
    });
    engineRef.current = engine;

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyH') {
        setDockOpen((prev) => !prev);
      } else if (e.code === 'KeyM') {
        setMapOpen((prev) => {
          const next = !prev;
          if (next && document.pointerLockElement) {
            document.exitPointerLock?.();
          }
          return next;
        });
      } else if (e.code === 'Escape') {
        setMapOpen(false);
      }
    };
    const onFirstTouch = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        setTouchMode(true);
      }
    };
    const updateViewport = () => {
      setViewport({
        width: window.visualViewport?.width ?? window.innerWidth,
        height: window.visualViewport?.height ?? window.innerHeight,
      });
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onFirstTouch, { passive: true });
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    window.visualViewport?.addEventListener('resize', updateViewport);

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onFirstTouch);
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      if (mapSwitchHideTimerRef.current !== null) {
        window.clearTimeout(mapSwitchHideTimerRef.current);
      }
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const isPortrait = viewport.height > viewport.width;
  const virtualLandscape = touchMode && landscapeMode && isPortrait;

  useEffect(() => {
    engineRef.current?.setVirtualLandscape(virtualLandscape);
  }, [virtualLandscape]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
      document.title = TRANSLATIONS[lang].gameTitle;
    }
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // Ignore storage write errors
    }
  }, [lang]);

  const handleLangChange = (nextLang: GameLang) => {
    setLang(nextLang);
  };

  const handleQualityChange = (q: QualityPreset) => {
    setQuality(q);
    engineRef.current?.setQualityPreset(q);
    setGraphicsFlags(getPresetGraphicsFlags(q));
  };

  const handleToggleGraphicsFlag = (key: 'hdr' | 'rayReflections' | 'giAndAo' | 'clarity') => {
    const nextVal = !graphicsFlags[key];
    const updated = engineRef.current?.setGraphicsFlags({ [key]: nextVal });
    setGraphicsFlags(updated ?? { ...graphicsFlags, [key]: nextVal });
  };

  const handleCycleAA = () => {
    const order: GraphicsFlags['antiAliasing'][] = ['OFF', 'SMAA'];
    const nextAA = order[(order.indexOf(graphicsFlags.antiAliasing) + 1) % order.length];
    const updated = engineRef.current?.setGraphicsFlags({ antiAliasing: nextAA });
    setGraphicsFlags(updated ?? { ...graphicsFlags, antiAliasing: nextAA });
  };

  const handleWeatherChange = (w: WeatherMode) => {
    setWeatherMode(w);
    engineRef.current?.setWeatherMode(w);
  };

  const handleSwitchMap = async (nextMapId: WorldMapId) => {
    if (nextMapId === activeMapId && (enteredWorld ? !mapSwitchState : loadProgress.ready)) {
      return;
    }

    if (mapSwitchHideTimerRef.current !== null) {
      window.clearTimeout(mapSwitchHideTimerRef.current);
      mapSwitchHideTimerRef.current = null;
    }

    setActiveMapId(nextMapId);
    const def = getWorldMapDef(nextMapId);
    setWeatherMode(def.defaultWeather);

    if (enteredWorld) {
      setMapOpen(false);
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
      setMapSwitchState({
        mapId: nextMapId,
        progress: { percent: 8, stage: 'Preparing Expedition...', ready: false },
      });
    }

    setTelemetry((prev) => ({
      ...prev,
      activeMapId: nextMapId,
      timeHours: def.defaultTimeHours,
      playerX: def.spawn.x,
      playerZ: def.spawn.z,
    }));

    await engineRef.current?.switchWorldMap(nextMapId);

    if (enteredWorldRef.current) {
      setMapSwitchState((prev) =>
        prev && prev.mapId === nextMapId
          ? { mapId: nextMapId, progress: { percent: 100, stage: 'Expedition Ready', ready: true } }
          : prev
      );
      mapSwitchHideTimerRef.current = window.setTimeout(() => {
        setMapSwitchState((prev) => (prev && prev.mapId === nextMapId ? null : prev));
        mapSwitchHideTimerRef.current = null;
      }, 280);
    }
  };

  const handleCameraChange = (c: CameraMode) => {
    setCameraMode(c);
    engineRef.current?.setCameraMode(c);
  };

  const handleTimeSlider = (val: number) => {
    engineRef.current?.setTimeOfDay(val);
    setTelemetry((prev) => ({ ...prev, timeHours: val }));
  };

  const handleToggleTimePause = () => {
    const next = !timePaused;
    setTimePaused(next);
    engineRef.current?.setTimePaused(next);
  };

  const handleToggleAudio = () => {
    const next = engineRef.current?.toggleAudio() ?? false;
    setAudioOn(next);
  };

  const handleToggleFlashlight = () => {
    engineRef.current?.toggleFlashlight();
  };

  const tryNativeLandscapeFullscreen = async () => {
    try {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        }
      }
    } catch {
      // Fullscreen may be restricted in some browsers/iframes; virtual landscape fallback handles it
    }
    try {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      await orientation?.lock?.('landscape');
    } catch {
      // Orientation lock unsupported (e.g. iOS Safari); virtual landscape rotation keeps widescreen
    }
  };

  const handleEnterWorld = () => {
    if (touchMode && landscapeMode) {
      void tryNativeLandscapeFullscreen();
    }
    engineRef.current?.enterWorld();
    if (audioOnStart && !audioOn) {
      const enabled = engineRef.current?.toggleAudio() ?? false;
      setAudioOn(enabled);
    }
    setMapOpen(false);
    setEnteredWorld(true);
  };

  const handleToggleLandscape = () => {
    const next = !landscapeMode;
    setLandscapeMode(next);
    if (next && touchMode) {
      void tryNativeLandscapeFullscreen();
    } else if (!next && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }
  };

  const handleSensitivityChange = (val: number) => {
    setLookSensitivity(val);
    engineRef.current?.setLookSensitivity(val);
    try {
      localStorage.setItem('lost_world_sensitivity', String(val));
    } catch {
      // Ignore storage write errors
    }
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b0e11]">
      <div
        className="relative overflow-hidden bg-[#0b0e11]"
        style={
          virtualLandscape
            ? {
                position: 'fixed',
                top: 0,
                left: `${viewport.width}px`,
                width: `${viewport.height}px`,
                height: `${viewport.width}px`,
                transform: 'rotate(90deg)',
                transformOrigin: '0 0',
              }
            : {
                width: '100%',
                height: '100%',
              }
        }
      >
        {/* Isolated Full-Viewport WebGL Mount */}
        <div ref={mountRef} className="absolute inset-0 w-full h-full cursor-crosshair touch-none" />

      {/* Game Loading & Launch Entry Screen */}
      <GameEntryOverlay
        visible={!enteredWorld && !webglError}
        progress={loadProgress}
        quality={quality}
        onQualityChange={handleQualityChange}
        selectedMapId={activeMapId}
        onMapChange={handleSwitchMap}
        audioEnabledOnStart={audioOnStart}
        onToggleAudioOnStart={() => setAudioOnStart((prev) => !prev)}
        onEnterWorld={handleEnterWorld}
        lang={lang}
        onLangChange={handleLangChange}
      />

      {/* Map-Switch Transition Loading Screen */}
      <MapTransitionOverlay
        visible={enteredWorld && !webglError && mapSwitchState !== null}
        mapId={mapSwitchState?.mapId ?? activeMapId}
        progress={
          mapSwitchState?.progress ?? { percent: 10, stage: 'Preparing Expedition...', ready: false }
        }
        lang={lang}
      />

      {/* Graceful WebGL Fallback */}
      {webglError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0b0e11] p-6">
          <div className="max-w-md border border-white/15 bg-[#12171d] p-6 text-stone-200">
            <h2 className="font-display text-xl tracking-wide text-amber-400">{t.gameTitle}</h2>
            <p className="mt-2 text-sm text-stone-300">{t.webglErrorFallback}</p>
          </div>
        </div>
      )}

      {/* Top-Left Minimal Expedition Readout & Vitals */}
      <div
        className="pointer-events-none absolute top-3 left-3 sm:top-4 sm:left-5 z-10 flex flex-col gap-1.5 sm:gap-2"
        style={{ maxWidth: 'calc(100% - 178px)' }}
      >
        <div className="flex flex-col">
          <h1 className="font-display text-sm sm:text-lg font-semibold leading-tight tracking-wider text-stone-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]">
            {t.gameTitle}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs text-stone-200/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            <span className="font-medium text-amber-300">
              {t.biomes[telemetry.biomeLabel] ?? telemetry.biomeLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num">{formatTime(telemetry.timeHours)}</span>
            <span aria-hidden="true">·</span>
            <span>{t.weatherStatus[telemetry.weatherLabel] ?? telemetry.weatherLabel}</span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="font-mono-num hidden sm:inline">
              {t.cardinals[Math.round(telemetry.headingDeg / 45) % 8]} {telemetry.headingDeg}°
            </span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="font-mono-num hidden sm:inline">{telemetry.elevation.toFixed(1)}m</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num text-stone-300">
              {telemetry.fps} {t.fpsSuffix}
            </span>
          </div>
        </div>

        {/* Minimal Survival Vitals Bars */}
        <div className="mt-0.5 flex flex-wrap items-center gap-2.5 sm:gap-4 bg-[#0c1015]/82 px-2.5 sm:px-3 py-1 sm:py-1.5 border border-white/10 rounded-md w-fit">
          <VitalBar label={t.vitals.stamina} value={telemetry.stamina} colorClass="bg-emerald-400" />
          <VitalBar label={t.vitals.warmth} value={telemetry.warmth} colorClass="bg-amber-400" />
          <VitalBar label={t.vitals.hydration} value={telemetry.hydration} colorClass="bg-sky-400" />
        </div>
      </div>

      {/* Top-Right Compact Landscape, Touch Pad & Audio Quick Toggles */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-5 z-20 flex items-center gap-1.5">

        {touchMode && (
          <button
            type="button"
            onClick={handleToggleLandscape}
            aria-label={t.landscape}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              landscapeMode
                ? 'bg-sky-500 text-stone-950 border-sky-300'
                : 'bg-[#0d1117]/86 text-stone-200 border-white/15 hover:bg-[#171e28]'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t.landscape}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setTouchMode((prev) => !prev)}
          aria-label={touchMode ? t.touchOn : t.touchOff}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            touchMode
              ? 'bg-amber-500 text-stone-950 border-amber-300'
              : 'bg-[#0d1117]/86 text-stone-200 border-white/15 hover:bg-[#171e28]'
          }`}
        >
          <Gamepad2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{touchMode ? t.touchOn : t.touchOff}</span>
        </button>

        <button
          type="button"
          onClick={handleToggleAudio}
          aria-label={audioOn ? t.actions.audioOn : t.actions.audioOff}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            audioOn
              ? 'bg-emerald-500 text-stone-950 border-emerald-300'
              : 'bg-[#0d1117]/86 text-stone-200 border-white/15 hover:bg-[#171e28]'
          }`}
        >
          {audioOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Subtle Center Crosshair & Contextual Prompt */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <div className="w-1 h-1 rounded-full bg-white/55 shadow-[0_0_4px_rgba(0,0,0,0.8)]" />
      </div>

      {!touchMode && (telemetry.nearCampfire || telemetry.isSwimming || telemetry.nearWater || telemetry.inCave) && (
        <div className="pointer-events-none fixed bottom-[132px] left-1/2 -translate-x-1/2 z-10 bg-[#0d1117]/88 border border-white/12 px-3.5 py-1.5 rounded text-xs text-stone-200 whitespace-nowrap">
          {telemetry.nearCampfire
            ? telemetry.campfireLit
              ? t.prompts.extinguishCampfire
              : t.prompts.igniteCampfire
            : telemetry.isSwimming
            ? t.prompts.swimmingHint
            : telemetry.nearWater
            ? t.prompts.drinkWater
            : t.prompts.caveFlashlight}
        </div>
      )}

      {/* Live Mini-Map HUD & Expandable World Atlas */}
      <WorldMap
        visible={enteredWorld && !webglError}
        isOpen={mapOpen}
        onOpenChange={(next) => {
          if (next && document.pointerLockElement) {
            document.exitPointerLock?.();
          }
          setMapOpen(next);
        }}
        activeMapId={activeMapId}
        playerX={telemetry.playerX}
        playerZ={telemetry.playerZ}
        headingDeg={telemetry.headingDeg}
        elevation={telemetry.elevation}
        biomeLabel={telemetry.biomeLabel}
        campfireLit={telemetry.campfireLit}
        lang={lang}
        onTeleport={(id) => engineRef.current?.teleportToLandmark(id)}
        onSwitchMap={handleSwitchMap}
      />

      {/* Mobile Touch Virtual Joystick & Action Pad */}
      {touchMode && !dockOpen && !mapOpen && (
        <MobileTouchControls
          flashlightOn={telemetry.flashlightOn}
          nearCampfire={telemetry.nearCampfire}
          campfireLit={telemetry.campfireLit}
          nearWater={telemetry.nearWater}
          isSwimming={telemetry.isSwimming}
          virtualLandscape={virtualLandscape}
          lang={lang}
          onMove={(f, r, s) => engineRef.current?.setVirtualMove(f, r, s)}
          onJump={() => engineRef.current?.triggerJump()}
          onSlash={() => engineRef.current?.triggerLightAttack()}
          onCleave={() => engineRef.current?.triggerHeavyAttack()}
          onDodge={() => engineRef.current?.triggerDodge()}
          onGuardChange={(g) => engineRef.current?.setGuarding(g)}
          onCrouchChange={(c) => engineRef.current?.setCrouching(c)}
          onToggleFlashlight={handleToggleFlashlight}
          onInteract={() => engineRef.current?.interact()}
          onCycleCamera={() => {
            const next = engineRef.current?.cycleCameraMode();
            if (next) setCameraMode(next);
          }}
        />
      )}

      {/* Unified Collapsible Bottom Control Dock */}
      <div
        className={`fixed bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center transition-transform duration-300 ease-out ${
          dockOpen ? 'translate-y-0' : 'translate-y-[calc(100%-30px)]'
        }`}
        style={{ width: virtualLandscape ? 'min(760px, 92%)' : 'min(920px, 95%)' }}
      >
        {/* Collapse / Expand Handle */}
        <button
          type="button"
          onClick={() => setDockOpen((o) => !o)}
          className="flex items-center gap-1.5 px-3.5 py-1 text-[11px] font-medium text-stone-200 bg-[#0d1117]/92 hover:bg-[#171d26] border border-b-0 border-white/15 rounded-t-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          {dockOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          <span>{dockOpen ? t.hideControls : t.showSettings}</span>
        </button>

        {/* Main Dock Panel (Solid/RGBA dark obsidian, zero backdrop-blur) */}
        <div className="w-full max-h-[54%] overflow-y-auto touch-pan-y bg-[#0d1117]/95 border border-white/14 rounded-lg shadow-2xl p-2.5 sm:p-3 flex flex-col gap-2.5">
          {/* Top Row: Tabs + Quick Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div className="flex items-center gap-1 bg-[#161c24] p-0.5 rounded-md">
              <DockTabBtn
                active={activeTab === 'GRAPHICS'}
                onClick={() => setActiveTab('GRAPHICS')}
                icon={<Sliders className="w-3.5 h-3.5" />}
                label={t.tabs.graphics}
              />
              <DockTabBtn
                active={activeTab === 'WEATHER'}
                onClick={() => setActiveTab('WEATHER')}
                icon={<CloudRain className="w-3.5 h-3.5" />}
                label={t.tabs.weather}
              />
              <DockTabBtn
                active={activeTab === 'WORLD'}
                onClick={() => setActiveTab('WORLD')}
                icon={<MapPin className="w-3.5 h-3.5" />}
                label={t.tabs.world}
              />
              <DockTabBtn
                active={activeTab === 'CONTROLS'}
                onClick={() => setActiveTab('CONTROLS')}
                icon={<Compass className="w-3.5 h-3.5" />}
                label={t.tabs.controls}
              />
            </div>

            {/* Quick Interactive Gear & Combat Actions */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => engineRef.current?.triggerLightAttack()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-[#1a212b] text-amber-300 hover:bg-[#242e3b] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Swords className="w-3.5 h-3.5" />
                <span>{t.actions.slash}</span>
              </button>

              <button
                type="button"
                onClick={() => engineRef.current?.triggerHeavyAttack()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-[#1a212b] text-orange-300 hover:bg-[#242e3b] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>{t.actions.cleave}</span>
              </button>

              <button
                type="button"
                onClick={() => engineRef.current?.triggerDodge()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-[#1a212b] text-sky-300 hover:bg-[#242e3b] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Wind className="w-3.5 h-3.5" />
                <span>{t.actions.dodge}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleFlashlight}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  telemetry.flashlightOn
                    ? 'bg-amber-500 text-stone-950'
                    : 'bg-[#1a212b] text-stone-200 hover:bg-[#232c38]'
                }`}
              >
                <Flashlight className="w-3.5 h-3.5" />
                <span>{t.actions.light}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleAudio}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  audioOn
                    ? 'bg-emerald-500 text-stone-950'
                    : 'bg-[#1a212b] text-stone-200 hover:bg-[#232c38]'
                }`}
              >
                {audioOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                <span>{audioOn ? t.actions.audioOn : t.actions.audioOff}</span>
              </button>
            </div>
          </div>

          {/* Tab Content Area */}
          {activeTab === 'GRAPHICS' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400 whitespace-nowrap">{t.qualityPresetLabel}</span>
                  <div className="flex items-center gap-1 bg-[#161c24] p-0.5 rounded-md">
                    {QUALITY_LIST.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => handleQualityChange(q)}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          quality === q
                            ? 'bg-amber-500 text-stone-950'
                            : 'text-stone-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {t.qualityNames[q]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-stone-400 font-mono-num">{t.qualityDesc[quality]}</div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { key: 'hdr', label: t.graphicsFlags.hdr },
                    { key: 'rayReflections', label: t.graphicsFlags.rayReflections },
                    { key: 'giAndAo', label: t.graphicsFlags.giAndAo },
                    { key: 'clarity', label: t.graphicsFlags.clarity },
                  ] as const
                ).map((item) => {
                  const active = graphicsFlags[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleToggleGraphicsFlag(item.key)}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                        active
                          ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                          : 'bg-[#161c24] text-stone-400 border-white/8 hover:text-stone-200'
                      }`}
                    >
                      {item.label}: {active ? t.graphicsFlags.on : t.graphicsFlags.off}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={handleCycleAA}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                    graphicsFlags.antiAliasing !== 'OFF'
                      ? 'bg-sky-500/20 text-sky-300 border-sky-400/40'
                      : 'bg-[#161c24] text-stone-400 border-white/8 hover:text-stone-200'
                  }`}
                >
                  {t.graphicsFlags.aa}: {graphicsFlags.antiAliasing === 'OFF' ? t.graphicsFlags.off : 'SMAA'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'WEATHER' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-[#161c24] p-0.5 rounded-md overflow-x-auto">
                  {WEATHER_IDS.map((wId) => (
                    <button
                      key={wId}
                      type="button"
                      onClick={() => handleWeatherChange(wId)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        weatherMode === wId
                          ? 'bg-amber-500 text-stone-950'
                          : 'text-stone-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {t.weatherOptions[wId]}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleToggleTimePause}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-[#1a212b] hover:bg-[#232c38] text-xs text-stone-200 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {timePaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                    <span>{timePaused ? t.timeControls.resume : t.timeControls.pause}</span>
                  </button>
                  {[
                    { label: t.timeControls.dawn, h: 5.9 },
                    { label: t.timeControls.noon, h: 12.5 },
                    { label: t.timeControls.sunset, h: 17.65 },
                    { label: t.timeControls.night, h: 22.8 },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => handleTimeSlider(p.h)}
                      className="px-2 py-1 rounded bg-[#1a212b] hover:bg-[#232c38] text-xs text-stone-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-xs text-stone-400 whitespace-nowrap">{t.timeControls.cycle24h}</span>
                <input
                  type="range"
                  min={0}
                  max={23.95}
                  step={0.05}
                  value={telemetry.timeHours}
                  onChange={(e) => handleTimeSlider(parseFloat(e.target.value))}
                  className="survival-slider flex-1"
                />
                <span className="font-mono-num text-xs text-stone-200 w-12 text-right">
                  {formatTime(telemetry.timeHours)}
                </span>
              </div>
            </div>
          )}

          {activeTab === 'WORLD' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Camera className="w-3.5 h-3.5 text-amber-400" />
                  <div className="flex items-center gap-1 bg-[#161c24] p-0.5 rounded-md">
                    {(['THIRD_PERSON', 'FIRST_PERSON', 'CINEMATIC_ORBIT'] as CameraMode[]).map((camId) => (
                      <button
                        key={camId}
                        type="button"
                        onClick={() => handleCameraChange(camId)}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          cameraMode === camId
                            ? 'bg-amber-500 text-stone-950'
                            : 'text-stone-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {t.cameraModes[camId]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {getWorldMapDef(activeMapId).landmarks.map((lm) => (
                    <button
                      key={lm.id}
                      type="button"
                      onClick={() => engineRef.current?.teleportToLandmark(lm.id)}
                      className="px-2 py-1 rounded bg-[#1a212b] hover:bg-amber-500/20 hover:text-amber-300 text-xs text-stone-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {t.landmarks[lm.id] ?? lm.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-white/8">
                {WORLD_MAPS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSwitchMap(m.id)}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      m.id === activeMapId
                        ? 'bg-amber-500 text-stone-950 font-semibold'
                        : 'bg-[#161c24] text-stone-300 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {t.worldMaps[m.id].name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'CONTROLS' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-stone-400 whitespace-nowrap">{t.controlsTab.lookSensitivity}</span>
                <input
                  type="range"
                  min={0.5}
                  max={3.0}
                  step={0.1}
                  value={lookSensitivity}
                  onChange={(e) => handleSensitivityChange(parseFloat(e.target.value))}
                  className="survival-slider flex-1"
                />
                <span className="font-mono-num text-xs text-amber-300 w-10 text-right">
                  {lookSensitivity.toFixed(1)}x
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-300">
                <span>
                  <strong className="text-amber-300 font-mono-num">{t.controlsTab.moveKey}</strong> {t.controlsTab.moveDesc}
                </span>
                <span>
                  <strong className="text-amber-300 font-mono-num">{t.controlsTab.lookKey}</strong> {t.controlsTab.lookDesc}
                </span>
                <span>
                  <strong className="text-amber-300 font-mono-num">{t.controlsTab.slashKey}</strong> {t.controlsTab.slashDesc}
                </span>
                <span>
                  <strong className="text-amber-300 font-mono-num">{t.controlsTab.cleaveKey}</strong> {t.controlsTab.cleaveDesc}
                </span>
                <span>
                  <strong className="text-amber-300 font-mono-num">{t.controlsTab.dodgeKey}</strong> {t.controlsTab.dodgeDesc}
                </span>
                <span>
                  <strong className="text-amber-300 font-mono-num">{t.controlsTab.guardKey}</strong> {t.controlsTab.guardDesc}
                </span>
                <span>
                  <strong className="text-amber-300 font-mono-num">{t.controlsTab.moveActionsKey}</strong> {t.controlsTab.moveActionsDesc}
                </span>
                <span>
                  <strong className="text-amber-300 font-mono-num">{t.controlsTab.gearActionsKey}</strong> {t.controlsTab.gearActionsDesc}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <OfflineIndicator lang={lang} />
      </div>
    </div>
  );
}

function VitalBar({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-stone-300">{label}</span>
      <div className="w-14 h-1.5 bg-white/12 rounded-sm overflow-hidden">
        <div className={`h-full ${colorClass} transition-all duration-200`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function DockTabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
        active ? 'bg-[#26303d] text-white' : 'text-stone-400 hover:text-stone-200'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
