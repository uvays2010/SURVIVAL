import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  CloudRain,
  Compass,
  Flashlight,
  Gamepad2,
  Heart,
  MapPin,
  Pause,
  Play,
  RotateCw,
  Sliders,
  Sun,
  Swords,
  Users,
  Volume2,
  VolumeX,
  Wind,
} from 'lucide-react';
import { GameEntryOverlay } from './components/GameEntryOverlay';
import { MapTransitionOverlay } from './components/MapTransitionOverlay';
import { MobileTouchControls } from './components/MobileTouchControls';
import { MultiplayerPanel } from './components/MultiplayerPanel';
import { OfflineIndicator } from './components/OfflineIndicator';
import { WorldMap } from './components/WorldMap';
import {
  ConnectionStatus,
  getInitialPlayerName,
  getInitialRoomFromUrl,
  MultiplayerChatMessage,
  MultiplayerClient,
  RemotePlayerState,
  SyncTransport,
} from './game/multiplayer';
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
  const [mpOpen, setMpOpen] = useState(false);
  const [mpStatus, setMpStatus] = useState<ConnectionStatus>('connecting');
  const [mpTransport, setMpTransport] = useState<SyncTransport>('local');
  const [mpAuthUser, setMpAuthUser] = useState<{ uid: string; displayName: string | null } | null>(null);
  const [mpRoomId, setMpRoomId] = useState<string>(getInitialRoomFromUrl);
  const [mpSelfId, setMpSelfId] = useState<string | null>(null);
  const [mpName, setMpName] = useState<string>(getInitialPlayerName);
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayerState[]>([]);
  const [mpMessages, setMpMessages] = useState<MultiplayerChatMessage[]>([]);
  const [firestoreFatalErr, setFirestoreFatalErr] = useState<Error | null>(null);
  const mpClientRef = useRef<MultiplayerClient | null>(null);
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
    health: 100,
    maxHealth: 100,
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
    defeatedCount: 0,
    activeEnemyTarget: null,
    playerHitFlash: 0,
    respawnBannerTimer: 0,
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
      onLocalStateSync: (state) => {
        mpClientRef.current?.pushLocalState(state);
      },
      initialQuality: quality,
      initialSensitivity: lookSensitivity,
      initialMapId: activeMapId,
    });
    engineRef.current = engine;

    const mpClient = new MultiplayerClient(mpRoomId, mpName, engine.getLocalNetState(), {
      onStatusChange: (status, room, selfId, transport) => {
        setMpStatus(status);
        setMpRoomId(room);
        setMpSelfId(selfId);
        setMpTransport(transport);
      },
      onAuthChange: (user) => {
        setMpAuthUser(user);
        if (user?.displayName) {
          setMpName((prev) => {
            if (!prev.startsWith('Sayohatchi-')) return prev;
            return user.displayName!.trim().slice(0, 18) || prev;
          });
        }
      },
      onPlayersFrame: (players) => {
        engineRef.current?.setRemotePlayers(players);
      },
      onPlayersChange: (players) => {
        setRemotePlayers(players);
      },
      onChatMessagesReplace: (messages) => {
        setMpMessages(messages);
      },
      onChatMessage: (msg) => {
        setMpMessages((prev) => {
          if (prev.some((item) => item.id === msg.id)) return prev;
          return [...prev.slice(-49), msg];
        });
      },
      onFirestoreError: (err) => {
        setFirestoreFatalErr(err);
      },
    });
    mpClientRef.current = mpClient;

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.code === 'Escape') {
          setMpOpen(false);
          setMapOpen(false);
        }
        return;
      }
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
        setMpOpen(false);
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
      mpClient.dispose();
      mpClientRef.current = null;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const isPortrait = viewport.height > viewport.width;
  const virtualLandscape = touchMode && landscapeMode && isPortrait;
  const compactHud = touchMode || viewport.width < 820 || viewport.height < 520;

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

  const handleOpenMultiplayer = () => {
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    setMapOpen(false);
    setMpOpen(true);
  };

  const handleMpNameChange = (nextName: string) => {
    setMpName(nextName);
    mpClientRef.current?.setPlayerName(nextName);
  };

  const handleMpJoinRoom = (nextRoom: string) => {
    setMpMessages([]);
    mpClientRef.current?.joinRoom(nextRoom);
  };

  const handleGoToPlayer = async (target: RemotePlayerState) => {
    setMpOpen(false);
    if (target.mapId !== activeMapId) {
      await handleSwitchMap(target.mapId);
    }
    engineRef.current?.teleportToCoords(target.x + 2.2, target.z + 2.2);
  };

  if (firestoreFatalErr) {
    throw firestoreFatalErr;
  }

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
        className={`pointer-events-none absolute z-10 flex flex-col ${
          compactHud ? 'top-2 left-2.5 gap-1' : 'top-4 left-5 gap-2'
        }`}
        style={{ maxWidth: compactHud ? 'calc(100% - 140px)' : 'calc(100% - 190px)' }}
      >
        <div className="flex flex-col">
          {!compactHud && (
            <h1 className="font-display text-lg font-semibold leading-tight tracking-wider text-stone-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]">
              {t.gameTitle}
            </h1>
          )}
          <div
            className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-stone-200/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] ${
              compactHud ? 'text-[9.5px] leading-tight' : 'text-xs'
            }`}
          >
            <span className="font-medium text-amber-300">
              {t.biomes[telemetry.biomeLabel] ?? telemetry.biomeLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num">{formatTime(telemetry.timeHours)}</span>
            <span aria-hidden="true">·</span>
            <span>{t.weatherStatus[telemetry.weatherLabel] ?? telemetry.weatherLabel}</span>
            {!compactHud && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num">
                  {t.cardinals[Math.round(telemetry.headingDeg / 45) % 8]} {telemetry.headingDeg}°
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num">{telemetry.elevation.toFixed(1)}m</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="font-mono-num text-stone-300">
              {telemetry.fps} {t.fpsSuffix}
            </span>
          </div>
        </div>

        {/* Prominent Player HP (Jon) + Secondary Survival Vitals */}
        <div
          className={`flex flex-col border rounded-md w-fit shadow-lg ${
            compactHud ? 'gap-1 bg-[#0c1015]/78 px-2 py-1' : 'mt-0.5 gap-1.5 bg-[#0c1015]/90 px-3 py-2'
          } ${telemetry.health <= 30 ? 'border-rose-500/70' : 'border-white/12'}`}
        >
          <div className={`flex items-center ${compactHud ? 'gap-1.5' : 'gap-2'}`}>
            <Heart
              className={`shrink-0 ${compactHud ? 'w-3 h-3' : 'w-4 h-4'} ${
                telemetry.health <= 30 ? 'text-rose-400 fill-rose-500' : 'text-rose-500 fill-rose-500'
              }`}
            />
            <span className={`font-semibold text-stone-100 ${compactHud ? 'text-[10px]' : 'text-xs'}`}>
              {t.vitals.health}
            </span>
            <div
              className={`bg-white/15 rounded-sm overflow-hidden ${
                compactHud ? 'w-20 h-1.5' : 'w-40 h-2.5'
              }`}
            >
              <div
                className="h-full transition-all duration-150 bg-gradient-to-r from-rose-600 to-rose-400"
                style={{
                  width: `${Math.max(0, Math.min(100, (telemetry.health / Math.max(1, telemetry.maxHealth)) * 100))}%`,
                }}
              />
            </div>
            <span
              className={`font-mono-num font-bold text-rose-200 whitespace-nowrap ${
                compactHud ? 'text-[10px]' : 'text-xs'
              }`}
            >
              {telemetry.health}/{telemetry.maxHealth}
            </span>
          </div>

          <div
            className={`flex flex-wrap items-center border-t border-white/8 ${
              compactHud ? 'gap-2 pt-0.5' : 'gap-3.5 pt-1'
            }`}
          >
            <VitalBar label={t.vitals.stamina} value={telemetry.stamina} colorClass="bg-emerald-400" compact={compactHud} />
            <VitalBar label={t.vitals.warmth} value={telemetry.warmth} colorClass="bg-amber-400" compact={compactHud} />
            <VitalBar label={t.vitals.hydration} value={telemetry.hydration} colorClass="bg-sky-400" compact={compactHud} />
            {telemetry.defeatedCount > 0 && (
              <span
                className={`flex items-center gap-1 border-l border-white/12 font-mono-num text-amber-300 ${
                  compactHud ? 'pl-1.5 text-[9.5px]' : 'pl-2.5 text-[11px]'
                }`}
              >
                <Swords className={compactHud ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                {telemetry.defeatedCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Respawn Notification Banner */}
      {enteredWorld && !webglError && telemetry.respawnBannerTimer > 0 && (
        <div
          className={`pointer-events-none fixed left-1/2 -translate-x-1/2 z-25 bg-[#160b10]/94 border border-rose-500/60 rounded-md font-semibold text-rose-200 shadow-2xl whitespace-nowrap ${
            compactHud ? 'top-11 px-3 py-1 text-[11px]' : 'top-24 px-4 py-2 text-sm'
          }`}
        >
          {t.enemies.respawnedNotice}
        </div>
      )}

      {/* Subtle Crimson Damage Vignette on Player Hit */}
      {telemetry.playerHitFlash > 0.05 && (
        <div
          className="pointer-events-none fixed inset-0 z-20 transition-opacity duration-75"
          style={{
            opacity: Math.min(0.85, telemetry.playerHitFlash),
            boxShadow: 'inset 0 0 95px 28px rgba(225, 29, 72, 0.55)',
          }}
        />
      )}

      {/* Top-Center Active Enemy / World Boss HP Bar */}
      {enteredWorld && !webglError && telemetry.activeEnemyTarget && (
        <div
          className={`pointer-events-none fixed left-1/2 -translate-x-1/2 z-15 bg-[#0c1015]/86 border border-white/15 rounded-md shadow-xl ${
            compactHud
              ? isPortrait && !virtualLandscape
                ? 'top-[68px] w-[min(210px,54vw)] px-2 py-1'
                : 'top-2 w-[min(220px,40vw)] px-2 py-1'
              : 'top-4 w-[min(320px,62vw)] px-3 py-1.5'
          }`}
        >
          <div
            className={`flex items-center justify-between gap-1.5 leading-tight ${
              compactHud ? 'text-[9.5px] mb-0.5' : 'text-[11px] mb-1'
            }`}
          >
            <div className="flex items-center gap-1 min-w-0">
              <span
                className={`font-semibold uppercase tracking-wider shrink-0 ${
                  compactHud ? 'text-[8.5px]' : 'text-[10px]'
                } ${
                  telemetry.activeEnemyTarget.isBoss
                    ? 'text-purple-300'
                    : telemetry.activeEnemyTarget.category === 'mech'
                    ? 'text-sky-300'
                    : telemetry.activeEnemyTarget.category === 'squad'
                    ? 'text-orange-300'
                    : 'text-rose-300'
                }`}
              >
                {telemetry.activeEnemyTarget.isBoss
                  ? t.enemies.bossBadge
                  : t.enemies.categories[telemetry.activeEnemyTarget.category]}
              </span>
              <span className="text-stone-100 font-medium truncate">
                {t.enemies.names[telemetry.activeEnemyTarget.nameKey as keyof typeof t.enemies.names] ??
                  telemetry.activeEnemyTarget.nameKey}
              </span>
            </div>
            <span className={`font-mono-num text-stone-300 shrink-0 ${compactHud ? 'text-[8.5px]' : 'text-[10px]'}`}>
              {telemetry.activeEnemyTarget.hp}/{telemetry.activeEnemyTarget.maxHp} · {telemetry.activeEnemyTarget.dist}m
            </span>
          </div>
          <div className={`w-full bg-white/12 rounded-sm overflow-hidden ${compactHud ? 'h-1' : 'h-1.5'}`}>
            <div
              className={`h-full transition-all duration-100 ${
                telemetry.activeEnemyTarget.isBoss
                  ? 'bg-purple-500'
                  : telemetry.activeEnemyTarget.category === 'mech'
                  ? 'bg-sky-400'
                  : telemetry.activeEnemyTarget.category === 'squad'
                  ? 'bg-orange-400'
                  : 'bg-rose-500'
              }`}
              style={{
                width: `${Math.max(
                  0,
                  Math.min(100, (telemetry.activeEnemyTarget.hp / Math.max(1, telemetry.activeEnemyTarget.maxHp)) * 100)
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Top-Right Compact Online, Landscape, Touch Pad & Audio Quick Toggles */}
      <div
        className={`absolute z-20 flex items-center ${
          compactHud ? 'top-2 right-2.5 gap-1' : 'top-4 right-5 gap-1.5'
        }`}
      >
        <button
          type="button"
          onClick={handleOpenMultiplayer}
          aria-label={t.multiplayer.buttonLabel}
          className={`flex items-center gap-1 rounded-md font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            compactHud ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-xs gap-1.5'
          } ${
            mpOpen
              ? 'bg-amber-500 text-stone-950 border-amber-300'
              : 'bg-[#0d1117]/82 text-stone-200 border-white/15 hover:bg-[#171e28]'
          }`}
        >
          <Users className={compactHud ? 'w-3 h-3 text-amber-400' : 'w-3.5 h-3.5 text-amber-400'} />
          {!compactHud && <span>{t.multiplayer.buttonLabel}</span>}
          <span className={`font-mono-num text-amber-300 ${compactHud ? 'text-[10px]' : 'text-[11px]'}`}>
            {remotePlayers.length + 1}
          </span>
        </button>

        {touchMode && (
          <button
            type="button"
            onClick={handleToggleLandscape}
            aria-label={t.landscape}
            className={`flex items-center gap-1 rounded-md font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              compactHud ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-xs'
            } ${
              landscapeMode
                ? 'bg-sky-500 text-stone-950 border-sky-300'
                : 'bg-[#0d1117]/82 text-stone-200 border-white/15 hover:bg-[#171e28]'
            }`}
          >
            <RotateCw className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            {!compactHud && <span>{t.landscape}</span>}
          </button>
        )}

        <button
          type="button"
          onClick={() => setTouchMode((prev) => !prev)}
          aria-label={touchMode ? t.touchOn : t.touchOff}
          className={`flex items-center gap-1 rounded-md font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            compactHud ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-xs'
          } ${
            touchMode
              ? 'bg-amber-500 text-stone-950 border-amber-300'
              : 'bg-[#0d1117]/82 text-stone-200 border-white/15 hover:bg-[#171e28]'
          }`}
        >
          <Gamepad2 className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          {!compactHud && <span>{touchMode ? t.touchOn : t.touchOff}</span>}
        </button>

        <button
          type="button"
          onClick={handleToggleAudio}
          aria-label={audioOn ? t.actions.audioOn : t.actions.audioOff}
          className={`flex items-center gap-1 rounded-md font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            compactHud ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-xs'
          } ${
            audioOn
              ? 'bg-emerald-500 text-stone-950 border-emerald-300'
              : 'bg-[#0d1117]/82 text-stone-200 border-white/15 hover:bg-[#171e28]'
          }`}
        >
          {audioOn ? (
            <Volume2 className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          ) : (
            <VolumeX className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          )}
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
        compact={compactHud}
        remotePlayers={remotePlayers}
        enemyMarkers={engineRef.current?.getEnemyMarkers() ?? []}
        onTeleport={(id) => engineRef.current?.teleportToLandmark(id)}
        onSwitchMap={handleSwitchMap}
      />

      {/* Online Multiplayer Co-op Room & Chat Panel */}
      <MultiplayerPanel
        visible={enteredWorld && !webglError}
        isOpen={mpOpen}
        onClose={() => setMpOpen(false)}
        status={mpStatus}
        transport={mpTransport}
        authUser={mpAuthUser}
        roomId={mpRoomId}
        selfId={mpSelfId}
        playerName={mpName}
        activeMapId={activeMapId}
        remotePlayers={remotePlayers}
        messages={mpMessages}
        lang={lang}
        onChangeName={handleMpNameChange}
        onJoinRoom={handleMpJoinRoom}
        onGoToPlayer={handleGoToPlayer}
        onSendChat={(text) => mpClientRef.current?.sendChat(text)}
        onSignInCloud={async () => {
          await mpClientRef.current?.signInCloud();
        }}
        onSignOutCloud={async () => {
          await mpClientRef.current?.signOutCloud();
        }}
      />

      {/* Mobile Touch Virtual Joystick & Action Pad */}
      {touchMode && !dockOpen && !mapOpen && !mpOpen && (
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
        className={`fixed left-1/2 -translate-x-1/2 z-30 flex flex-col items-center transition-transform duration-300 ease-out ${
          compactHud ? 'bottom-0.5' : 'bottom-4'
        } ${
          dockOpen
            ? 'translate-y-0'
            : compactHud
            ? 'translate-y-[calc(100%-22px)]'
            : 'translate-y-[calc(100%-30px)]'
        }`}
        style={{ width: compactHud ? 'min(520px, 88%)' : 'min(920px, 95%)' }}
      >
        {/* Collapse / Expand Handle */}
        <button
          type="button"
          onClick={() => setDockOpen((o) => !o)}
          className={`flex items-center gap-1 font-medium text-stone-200 bg-[#0d1117]/88 hover:bg-[#171d26] border border-b-0 border-white/15 rounded-t-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            compactHud ? 'px-2.5 py-0.5 text-[9.5px]' : 'px-3.5 py-1 text-[11px] gap-1.5'
          }`}
        >
          {dockOpen ? (
            <ChevronDown className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          ) : (
            <ChevronUp className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          )}
          <span>{dockOpen ? t.hideControls : t.showSettings}</span>
        </button>

        {/* Main Dock Panel (Solid/RGBA dark obsidian, zero backdrop-blur) */}
        <div
          className={`w-full overflow-y-auto touch-pan-y bg-[#0d1117]/94 border border-white/14 rounded-lg shadow-2xl flex flex-col ${
            compactHud ? 'max-h-[40vh] p-1.5 gap-1.5' : 'max-h-[54%] p-3 gap-2.5'
          }`}
        >
          {/* Top Row: Tabs + Quick Action Buttons */}
          <div
            className={`flex flex-wrap items-center justify-between border-b border-white/10 ${
              compactHud ? 'gap-1 pb-1.5' : 'gap-2 pb-2'
            }`}
          >
            <div className="flex items-center gap-0.5 sm:gap-1 bg-[#161c24] p-0.5 rounded-md overflow-x-auto max-w-full">
              <DockTabBtn
                active={activeTab === 'GRAPHICS'}
                onClick={() => setActiveTab('GRAPHICS')}
                icon={<Sliders className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
                label={t.tabs.graphics}
                compact={compactHud}
              />
              <DockTabBtn
                active={activeTab === 'WEATHER'}
                onClick={() => setActiveTab('WEATHER')}
                icon={<CloudRain className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
                label={t.tabs.weather}
                compact={compactHud}
              />
              <DockTabBtn
                active={activeTab === 'WORLD'}
                onClick={() => setActiveTab('WORLD')}
                icon={<MapPin className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
                label={t.tabs.world}
                compact={compactHud}
              />
              <DockTabBtn
                active={activeTab === 'CONTROLS'}
                onClick={() => setActiveTab('CONTROLS')}
                icon={<Compass className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
                label={t.tabs.controls}
                compact={compactHud}
              />
            </div>

            {/* Quick Interactive Gear & Combat Actions */}
            <div className={`flex flex-wrap items-center ${compactHud ? 'gap-1' : 'gap-1.5'}`}>
              {!compactHud && (
                <>
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
                </>
              )}

              <button
                type="button"
                onClick={handleToggleFlashlight}
                className={`flex items-center gap-1 rounded font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  compactHud ? 'px-2 py-1 text-[10px]' : 'gap-1.5 px-2.5 py-1.5 text-xs'
                } ${
                  telemetry.flashlightOn
                    ? 'bg-amber-500 text-stone-950'
                    : 'bg-[#1a212b] text-stone-200 hover:bg-[#232c38]'
                }`}
              >
                <Flashlight className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                <span>{t.actions.light}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleAudio}
                className={`flex items-center gap-1 rounded font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  compactHud ? 'px-2 py-1 text-[10px]' : 'gap-1.5 px-2.5 py-1.5 text-xs'
                } ${
                  audioOn
                    ? 'bg-emerald-500 text-stone-950'
                    : 'bg-[#1a212b] text-stone-200 hover:bg-[#232c38]'
                }`}
              >
                {audioOn ? (
                  <Volume2 className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                ) : (
                  <VolumeX className={compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                )}
                <span>{audioOn ? t.actions.audioOn : t.actions.audioOff}</span>
              </button>
            </div>
          </div>

          {/* Tab Content Area */}
          {activeTab === 'GRAPHICS' && (
            <div className={`flex flex-col ${compactHud ? 'gap-1.5' : 'gap-2'}`}>
              <div className={`flex flex-wrap items-center justify-between ${compactHud ? 'gap-1.5' : 'gap-2'}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`text-stone-400 whitespace-nowrap ${compactHud ? 'text-[10px]' : 'text-xs'}`}>
                    {t.qualityPresetLabel}
                  </span>
                  <div className="flex items-center gap-0.5 bg-[#161c24] p-0.5 rounded-md">
                    {QUALITY_LIST.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => handleQualityChange(q)}
                        className={`font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          compactHud ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
                        } ${
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
                {!compactHud && (
                  <div className="text-xs text-stone-400 font-mono-num">{t.qualityDesc[quality]}</div>
                )}
              </div>

              <div className={`flex flex-wrap items-center ${compactHud ? 'gap-1' : 'gap-1.5'}`}>
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
                      className={`rounded font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                        compactHud ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
                      } ${
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
                  className={`rounded font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                    compactHud ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
                  } ${
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
            <div className={`flex flex-col ${compactHud ? 'gap-1.5' : 'gap-2'}`}>
              <div className={`flex flex-wrap items-center justify-between ${compactHud ? 'gap-1.5' : 'gap-2'}`}>
                <div className="flex items-center gap-0.5 bg-[#161c24] p-0.5 rounded-md overflow-x-auto max-w-full">
                  {WEATHER_IDS.map((wId) => (
                    <button
                      key={wId}
                      type="button"
                      onClick={() => handleWeatherChange(wId)}
                      className={`font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        compactHud ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
                      } ${
                        weatherMode === wId
                          ? 'bg-amber-500 text-stone-950'
                          : 'text-stone-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {t.weatherOptions[wId]}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={handleToggleTimePause}
                    className={`flex items-center gap-1 rounded bg-[#1a212b] hover:bg-[#232c38] text-stone-200 cursor-pointer whitespace-nowrap shrink-0 ${
                      compactHud ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
                    }`}
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
                      className={`rounded bg-[#1a212b] hover:bg-[#232c38] text-stone-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0 ${
                        compactHud ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Sun className={compactHud ? 'w-3 h-3 text-amber-400 shrink-0' : 'w-3.5 h-3.5 text-amber-400 shrink-0'} />
                <span className={`text-stone-400 whitespace-nowrap ${compactHud ? 'text-[10px]' : 'text-xs'}`}>
                  {t.timeControls.cycle24h}
                </span>
                <input
                  type="range"
                  min={0}
                  max={23.95}
                  step={0.05}
                  value={telemetry.timeHours}
                  onChange={(e) => handleTimeSlider(parseFloat(e.target.value))}
                  className="survival-slider flex-1"
                />
                <span className={`font-mono-num text-stone-200 text-right ${compactHud ? 'text-[10px] w-10' : 'text-xs w-12'}`}>
                  {formatTime(telemetry.timeHours)}
                </span>
              </div>
            </div>
          )}

          {activeTab === 'WORLD' && (
            <div className={`flex flex-col ${compactHud ? 'gap-1.5' : 'gap-2'}`}>
              <div className={`flex flex-wrap items-center justify-between ${compactHud ? 'gap-1.5' : 'gap-2'}`}>
                <div className="flex items-center gap-1.5">
                  <Camera className={compactHud ? 'w-3 h-3 text-amber-400' : 'w-3.5 h-3.5 text-amber-400'} />
                  <div className="flex items-center gap-0.5 bg-[#161c24] p-0.5 rounded-md">
                    {(['THIRD_PERSON', 'FIRST_PERSON', 'CINEMATIC_ORBIT'] as CameraMode[]).map((camId) => (
                      <button
                        key={camId}
                        type="button"
                        onClick={() => handleCameraChange(camId)}
                        className={`font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          compactHud ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
                        } ${
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
                      className={`rounded bg-[#1a212b] hover:bg-amber-500/20 hover:text-amber-300 text-stone-300 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        compactHud ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
                      }`}
                    >
                      {t.landmarks[lm.id] ?? lm.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1 overflow-x-auto pt-1 border-t border-white/8">
                {WORLD_MAPS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSwitchMap(m.id)}
                    className={`rounded font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      compactHud ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]'
                    } ${
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
            <div className={`flex flex-col ${compactHud ? 'gap-1.5' : 'gap-2'}`}>
              <div className="flex items-center gap-2">
                <span className={`text-stone-400 whitespace-nowrap ${compactHud ? 'text-[10px]' : 'text-xs'}`}>
                  {t.controlsTab.lookSensitivity}
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={3.0}
                  step={0.1}
                  value={lookSensitivity}
                  onChange={(e) => handleSensitivityChange(parseFloat(e.target.value))}
                  className="survival-slider flex-1"
                />
                <span className={`font-mono-num text-amber-300 text-right ${compactHud ? 'text-[10px] w-8' : 'text-xs w-10'}`}>
                  {lookSensitivity.toFixed(1)}x
                </span>
              </div>
              <div
                className={`flex flex-wrap items-center text-stone-300 ${
                  compactHud ? 'gap-x-2.5 gap-y-0.5 text-[10px]' : 'gap-x-4 gap-y-1 text-xs'
                }`}
              >
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

function VitalBar({
  label,
  value,
  colorClass,
  compact = false,
}: {
  label: string;
  value: number;
  colorClass: string;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className={compact ? 'text-[9px] text-stone-300' : 'text-[11px] text-stone-300'}>{label}</span>
      <div className={`${compact ? 'w-8 h-1' : 'w-14 h-1.5'} bg-white/12 rounded-sm overflow-hidden`}>
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
  compact = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center rounded font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
        compact ? 'gap-1 px-1.5 py-0.5 text-[10px]' : 'gap-1.5 px-2.5 py-1 text-xs'
      } ${active ? 'bg-[#26303d] text-white' : 'text-stone-400 hover:text-stone-200'}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
