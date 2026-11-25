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
  Sliders,
  Sun,
  Swords,
  Volume2,
  VolumeX,
  Wind,
} from 'lucide-react';
import { MobileTouchControls } from './components/MobileTouchControls';
import { SurvivalEngine } from './game/engine';
import {
  CameraMode,
  getPresetGraphicsFlags,
  GraphicsFlags,
  HudTelemetry,
  LANDMARKS,
  QualityPreset,
  WeatherMode,
} from './game/types';

type DockTab = 'GRAPHICS' | 'WEATHER' | 'WORLD' | 'CONTROLS';

const QUALITY_LIST: QualityPreset[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA', 'CINEMATIC'];
const WEATHER_LIST: { id: WeatherMode; label: string }[] = [
  { id: 'DYNAMIC', label: 'Dynamic' },
  { id: 'CLEAR', label: 'Clear' },
  { id: 'FOGGY', label: 'Fog' },
  { id: 'RAIN', label: 'Rain' },
  { id: 'STORM', label: 'Storm' },
  { id: 'SNOW', label: 'Snow' },
];

function formatTime(hours: number): string {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function compassCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SurvivalEngine | null>(null);

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
  const [activeTab, setActiveTab] = useState<DockTab>('GRAPHICS');

  const [quality, setQuality] = useState<QualityPreset>('HIGH');
  const [graphicsFlags, setGraphicsFlags] = useState<GraphicsFlags>(() => getPresetGraphicsFlags('HIGH'));
  const [weatherMode, setWeatherMode] = useState<WeatherMode>('DYNAMIC');
  const [cameraMode, setCameraMode] = useState<CameraMode>('THIRD_PERSON');
  const [timePaused, setTimePaused] = useState(false);
  const [audioOn, setAudioOn] = useState(false);

  const [telemetry, setTelemetry] = useState<HudTelemetry>({
    biomeLabel: 'Emerald Old-Growth',
    timeHours: 17.65,
    weatherLabel: 'Clear Breeze',
    headingDeg: 300,
    elevation: 3.2,
    speedMs: 0,
    stamina: 100,
    warmth: 90,
    hydration: 92,
    nearCampfire: true,
    campfireLit: true,
    nearWater: false,
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
    });
    engineRef.current = engine;

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyH') {
        setDockOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleQualityChange = (q: QualityPreset) => {
    setQuality(q);
    engineRef.current?.setQualityPreset(q);
    setGraphicsFlags(getPresetGraphicsFlags(q));
  };

  const handleToggleGraphicsFlag = (key: 'hdr' | 'rayReflections' | 'giAndAo' | 'dof' | 'motionBlur') => {
    const nextVal = !graphicsFlags[key];
    const updated = engineRef.current?.setGraphicsFlags({ [key]: nextVal });
    setGraphicsFlags(updated ?? { ...graphicsFlags, [key]: nextVal });
  };

  const handleCycleAA = () => {
    const order: GraphicsFlags['antiAliasing'][] = ['OFF', 'FXAA', 'SMAA'];
    const nextAA = order[(order.indexOf(graphicsFlags.antiAliasing) + 1) % order.length];
    const updated = engineRef.current?.setGraphicsFlags({ antiAliasing: nextAA });
    setGraphicsFlags(updated ?? { ...graphicsFlags, antiAliasing: nextAA });
  };

  const handleWeatherChange = (w: WeatherMode) => {
    setWeatherMode(w);
    engineRef.current?.setWeatherMode(w);
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

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0b0e11]">
      {/* Isolated Full-Viewport WebGL Mount */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full cursor-crosshair" />

      {/* Graceful WebGL Fallback */}
      {webglError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0b0e11] p-6">
          <div className="max-w-md border border-white/15 bg-[#12171d] p-6 text-stone-200">
            <h2 className="font-display text-xl tracking-wide text-amber-400">SURVIVAL: THE LOST WORLD</h2>
            <p className="mt-2 text-sm text-stone-300">{webglError}</p>
          </div>
        </div>
      )}

      {/* Top-Left Minimal Expedition Readout & Vitals (Unboxed, Zero Pills, No Blur) */}
      <div
        className="pointer-events-none absolute top-3 left-3 sm:top-4 sm:left-5 z-10 flex flex-col gap-1.5 sm:gap-2"
        style={{ maxWidth: 'calc(100vw - 110px)' }}
      >
        <div className="flex flex-col">
          <h1 className="font-display text-sm sm:text-lg font-semibold tracking-wider text-stone-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]">
            SURVIVAL: THE LOST WORLD
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs text-stone-200/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            <span className="font-medium text-amber-300">{telemetry.biomeLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num">{formatTime(telemetry.timeHours)}</span>
            <span aria-hidden="true">·</span>
            <span>{telemetry.weatherLabel}</span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="font-mono-num hidden sm:inline">
              {compassCardinal(telemetry.headingDeg)} {telemetry.headingDeg}°
            </span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="font-mono-num hidden sm:inline">{telemetry.elevation.toFixed(1)}m</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num text-stone-300">{telemetry.fps} FPS</span>
          </div>
        </div>

        {/* Minimal Survival Vitals Bars */}
        <div className="mt-0.5 flex flex-wrap items-center gap-2.5 sm:gap-4 bg-[#0c1015]/82 px-2.5 sm:px-3 py-1 sm:py-1.5 border border-white/10 rounded-md w-fit">
          <VitalBar label="Stam" value={telemetry.stamina} colorClass="bg-emerald-400" />
          <VitalBar label="Warm" value={telemetry.warmth} colorClass="bg-amber-400" />
          <VitalBar label="Hydr" value={telemetry.hydration} colorClass="bg-sky-400" />
        </div>
      </div>

      {/* Top-Right Compact Touch Pad & Audio Quick Toggles */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-5 z-20 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setTouchMode((prev) => !prev)}
          aria-label="Toggle Touch Controls"
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            touchMode
              ? 'bg-amber-500 text-stone-950 border-amber-300'
              : 'bg-[#0d1117]/86 text-stone-200 border-white/15 hover:bg-[#171e28]'
          }`}
        >
          <Gamepad2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{touchMode ? 'Touch On' : 'Touch Off'}</span>
        </button>

        <button
          type="button"
          onClick={handleToggleAudio}
          aria-label="Toggle Audio"
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

      {!touchMode && (telemetry.nearCampfire || telemetry.nearWater || telemetry.inCave) && (
        <div className="pointer-events-none fixed bottom-[132px] left-1/2 -translate-x-1/2 z-10 bg-[#0d1117]/88 border border-white/12 px-3.5 py-1.5 rounded text-xs text-stone-200 whitespace-nowrap">
          {telemetry.nearCampfire
            ? `[E] ${telemetry.campfireLit ? 'Extinguish Campfire' : 'Ignite Campfire'}`
            : telemetry.nearWater
            ? '[E] Drink Fresh Water'
            : '[F] Toggle Flashlight inside Echo Cavern'}
        </div>
      )}

      {/* Mobile Touch Virtual Joystick & Action Pad */}
      {touchMode && !dockOpen && (
        <MobileTouchControls
          flashlightOn={telemetry.flashlightOn}
          nearCampfire={telemetry.nearCampfire}
          campfireLit={telemetry.campfireLit}
          nearWater={telemetry.nearWater}
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
        style={{ width: 'min(920px, 95vw)' }}
      >
        {/* Collapse / Expand Handle */}
        <button
          type="button"
          onClick={() => setDockOpen((o) => !o)}
          className="flex items-center gap-1.5 px-3.5 py-1 text-[11px] font-medium text-stone-200 bg-[#0d1117]/92 hover:bg-[#171d26] border border-b-0 border-white/15 rounded-t-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          {dockOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          <span>{dockOpen ? 'Hide Controls (H)' : 'Settings & World'}</span>
        </button>

        {/* Main Dock Panel (Solid/RGBA dark obsidian, zero backdrop-blur) */}
        <div className="w-full max-h-[54vh] overflow-y-auto touch-pan-y bg-[#0d1117]/95 border border-white/14 rounded-lg shadow-2xl p-2.5 sm:p-3 flex flex-col gap-2.5">
          {/* Top Row: Tabs + Quick Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div className="flex items-center gap-1 bg-[#161c24] p-0.5 rounded-md">
              <DockTabBtn
                active={activeTab === 'GRAPHICS'}
                onClick={() => setActiveTab('GRAPHICS')}
                icon={<Sliders className="w-3.5 h-3.5" />}
                label="Graphics"
              />
              <DockTabBtn
                active={activeTab === 'WEATHER'}
                onClick={() => setActiveTab('WEATHER')}
                icon={<CloudRain className="w-3.5 h-3.5" />}
                label="Weather & Sky"
              />
              <DockTabBtn
                active={activeTab === 'WORLD'}
                onClick={() => setActiveTab('WORLD')}
                icon={<MapPin className="w-3.5 h-3.5" />}
                label="World & Camera"
              />
              <DockTabBtn
                active={activeTab === 'CONTROLS'}
                onClick={() => setActiveTab('CONTROLS')}
                icon={<Compass className="w-3.5 h-3.5" />}
                label="Controls"
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
                <span>Slash (J)</span>
              </button>

              <button
                type="button"
                onClick={() => engineRef.current?.triggerHeavyAttack()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-[#1a212b] text-orange-300 hover:bg-[#242e3b] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Cleave (K)</span>
              </button>

              <button
                type="button"
                onClick={() => engineRef.current?.triggerDodge()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-[#1a212b] text-sky-300 hover:bg-[#242e3b] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Wind className="w-3.5 h-3.5" />
                <span>Dodge (Q)</span>
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
                <span>Light (F)</span>
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
                <span>{audioOn ? 'Audio On' : 'Audio Off'}</span>
              </button>
            </div>
          </div>

          {/* Tab Content Area */}
          {activeTab === 'GRAPHICS' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400 whitespace-nowrap">Quality Preset</span>
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
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-stone-400 font-mono-num">
                  {quality === 'LOW' && '512px · Fast Terrain · Base Lighting'}
                  {quality === 'MEDIUM' && '1024px Shadows · HDR · FXAA · 6.5k Grass'}
                  {quality === 'HIGH' && '2048px Shadows · Ray Refl · GI & AO · 12k Grass'}
                  {quality === 'ULTRA' && '2048px Hi-DPI · DoF · SMAA · 18k Grass'}
                  {quality === 'CINEMATIC' && '4096px Shadows · Max HDR & GI · 24k Grass'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { key: 'hdr', label: 'HDR Tone' },
                    { key: 'rayReflections', label: 'Ray Reflections' },
                    { key: 'giAndAo', label: 'GI & AO' },
                    { key: 'dof', label: 'Depth of Field' },
                    { key: 'motionBlur', label: 'Motion Blur' },
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
                      {item.label}: {active ? 'ON' : 'OFF'}
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
                  AA: {graphicsFlags.antiAliasing}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'WEATHER' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-[#161c24] p-0.5 rounded-md overflow-x-auto">
                  {WEATHER_LIST.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => handleWeatherChange(w.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        weatherMode === w.id
                          ? 'bg-amber-500 text-stone-950'
                          : 'text-stone-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {w.label}
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
                    <span>{timePaused ? 'Resume' : 'Pause'}</span>
                  </button>
                  {[
                    { label: 'Dawn', h: 5.9 },
                    { label: 'Noon', h: 12.5 },
                    { label: 'Sunset', h: 17.65 },
                    { label: 'Night', h: 22.8 },
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
                <span className="text-xs text-stone-400 whitespace-nowrap">24h Cycle</span>
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
                    {[
                      { id: 'THIRD_PERSON' as CameraMode, label: '3rd Person' },
                      { id: 'FIRST_PERSON' as CameraMode, label: '1st Person' },
                      { id: 'CINEMATIC_ORBIT' as CameraMode, label: 'Cinematic Orbit' },
                    ].map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleCameraChange(c.id)}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          cameraMode === c.id
                            ? 'bg-amber-500 text-stone-950'
                            : 'text-stone-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {LANDMARKS.map((lm) => (
                    <button
                      key={lm.id}
                      type="button"
                      onClick={() => engineRef.current?.teleportToLandmark(lm.id)}
                      className="px-2 py-1 rounded bg-[#1a212b] hover:bg-amber-500/20 hover:text-amber-300 text-xs text-stone-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {lm.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'CONTROLS' && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-300">
              <span>
                <strong className="text-amber-300 font-mono-num">WASD / Arrows</strong> Move
              </span>
              <span>
                <strong className="text-amber-300 font-mono-num">Click / Drag</strong> Look
              </span>
              <span>
                <strong className="text-amber-300 font-mono-num">J / L-Click</strong> Slash Combo
              </span>
              <span>
                <strong className="text-amber-300 font-mono-num">K / R-Click</strong> Heavy Cleave
              </span>
              <span>
                <strong className="text-amber-300 font-mono-num">Q</strong> Dodge Dash
              </span>
              <span>
                <strong className="text-amber-300 font-mono-num">R</strong> Guard
              </span>
              <span>
                <strong className="text-amber-300 font-mono-num">Shift / Space / C</strong> Sprint / Jump / Crouch
              </span>
              <span>
                <strong className="text-amber-300 font-mono-num">F / E / V</strong> Light / Camp / Camera
              </span>
            </div>
          )}
        </div>
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
