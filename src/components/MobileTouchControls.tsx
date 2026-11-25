import React, { useRef, useState } from 'react';
import { ArrowUp, Camera, Flame, Flashlight, Shield, Swords, Wind } from 'lucide-react';

interface MobileTouchControlsProps {
  flashlightOn: boolean;
  nearCampfire: boolean;
  campfireLit: boolean;
  nearWater: boolean;
  onMove: (forward: number, right: number, sprint: boolean) => void;
  onJump: () => void;
  onSlash: () => void;
  onCleave: () => void;
  onDodge: () => void;
  onGuardChange: (guarding: boolean) => void;
  onCrouchChange: (crouching: boolean) => void;
  onToggleFlashlight: () => void;
  onInteract: () => void;
  onCycleCamera: () => void;
}

export function MobileTouchControls({
  flashlightOn,
  nearCampfire,
  campfireLit,
  nearWater,
  onMove,
  onJump,
  onSlash,
  onCleave,
  onDodge,
  onGuardChange,
  onCrouchChange,
  onToggleFlashlight,
  onInteract,
  onCycleCamera,
}: MobileTouchControlsProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, sprinting: false, active: false });
  const [crouched, setCrouched] = useState(false);
  const [guarding, setGuarding] = useState(false);

  const maxRadius = 42;

  const updateStickFromEvent = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }
    const normX = dx / maxRadius;
    const normY = -dy / maxRadius; // up on screen = +forward
    const mag = Math.min(1, dist / maxRadius);
    const sprinting = mag > 0.8 && normY > 0.35;

    setKnob({ x: dx, y: dy, sprinting, active: true });
    onMove(normY, normX, sprinting);
  };

  const resetStick = () => {
    pointerIdRef.current = null;
    setKnob({ x: 0, y: 0, sprinting: false, active: false });
    onMove(0, 0, false);
  };

  const handleStickDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateStickFromEvent(e.clientX, e.clientY);
  };

  const handleStickMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    e.stopPropagation();
    e.preventDefault();
    updateStickFromEvent(e.clientX, e.clientY);
  };

  const handleStickUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    e.stopPropagation();
    e.preventDefault();
    resetStick();
  };

  const toggleCrouch = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const next = !crouched;
    setCrouched(next);
    onCrouchChange(next);
  };

  return (
    <>
      {/* Left Thumb Area: Crouch / Camera + Virtual Analog Thumbstick */}
      <div
        className="fixed z-20 flex flex-col items-start gap-2.5 touch-none select-none"
        style={{
          left: 'max(14px, env(safe-area-inset-left))',
          bottom: 'max(46px, calc(env(safe-area-inset-bottom) + 38px))',
        }}
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onPointerDown={toggleCrouch}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors touch-none ${
              crouched
                ? 'bg-amber-500 text-stone-950 border-amber-300'
                : 'bg-[#0d1117]/82 text-stone-200 border-white/15'
            }`}
          >
            {crouched ? 'Standing' : 'Crouch'}
          </button>
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCycleCamera();
            }}
            aria-label="Switch Camera"
            className="p-1.5 rounded-lg bg-[#0d1117]/82 text-stone-200 border border-white/15 active:bg-amber-500 active:text-stone-950 touch-none"
          >
            <Camera className="w-4 h-4" />
          </button>
        </div>

        {/* Analog Stick Base */}
        <div
          ref={padRef}
          onPointerDown={handleStickDown}
          onPointerMove={handleStickMove}
          onPointerUp={handleStickUp}
          onPointerCancel={handleStickUp}
          className={`relative w-[114px] h-[114px] rounded-full border-2 flex items-center justify-center touch-none transition-colors ${
            knob.sprinting
              ? 'bg-[#0d1117]/75 border-amber-400/75'
              : knob.active
              ? 'bg-[#0d1117]/75 border-white/35'
              : 'bg-[#0d1117]/58 border-white/18'
          }`}
        >
          {/* Directional guide ticks */}
          <div className="pointer-events-none absolute inset-3 rounded-full border border-white/10" />
          {knob.sprinting && (
            <span className="pointer-events-none absolute -top-5 text-[10px] font-bold tracking-wider text-amber-300 uppercase">
              Sprint
            </span>
          )}
          {/* Inner Thumb Puck */}
          <div
            className={`pointer-events-none w-12 h-12 rounded-full border shadow-lg transition-colors ${
              knob.sprinting
                ? 'bg-amber-400/90 border-amber-200'
                : knob.active
                ? 'bg-stone-200/85 border-white'
                : 'bg-stone-300/60 border-white/40'
            }`}
            style={{
              transform: `translate(${knob.x}px, ${knob.y}px)`,
            }}
          />
        </div>
      </div>

      {/* Right Thumb Area: Contextual Interact + Combat + Jump + Flashlight */}
      <div
        className="fixed z-20 flex flex-col items-end gap-2 touch-none select-none"
        style={{
          right: 'max(14px, env(safe-area-inset-right))',
          bottom: 'max(46px, calc(env(safe-area-inset-bottom) + 38px))',
        }}
      >
        {/* Contextual Interact + Flashlight Row */}
        <div className="flex items-center gap-1.5">
          {(nearCampfire || nearWater) && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onInteract();
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-stone-950 border border-amber-300 shadow-lg active:scale-95 touch-none"
            >
              <Flame className="w-3.5 h-3.5" />
              <span>{nearCampfire ? (campfireLit ? 'Extinguish' : 'Ignite') : 'Drink'}</span>
            </button>
          )}

          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleFlashlight();
            }}
            aria-label="Toggle Flashlight"
            className={`p-2 rounded-lg border transition-colors touch-none ${
              flashlightOn
                ? 'bg-amber-500 text-stone-950 border-amber-300'
                : 'bg-[#0d1117]/82 text-stone-200 border-white/15'
            }`}
          >
            <Flashlight className="w-4 h-4" />
          </button>
        </div>

        {/* Ergonomic Combat & Movement Arc */}
        <div className="relative w-[164px] h-[144px]">
          {/* Guard (Hold) */}
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              setGuarding(true);
              onGuardChange(true);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setGuarding(false);
              onGuardChange(false);
            }}
            onPointerCancel={() => {
              setGuarding(false);
              onGuardChange(false);
            }}
            className={`absolute top-0 right-2 w-12 h-12 rounded-full border flex flex-col items-center justify-center text-[10px] font-semibold transition-transform active:scale-95 touch-none ${
              guarding
                ? 'bg-cyan-400 text-stone-950 border-cyan-200'
                : 'bg-[#0d1117]/82 text-cyan-300 border-cyan-400/35'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>Guard</span>
          </button>

          {/* Heavy Cleave */}
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCleave();
            }}
            className="absolute top-2 left-6 w-12 h-12 rounded-full bg-[#0d1117]/82 border border-orange-400/45 text-orange-300 flex flex-col items-center justify-center text-[10px] font-semibold active:scale-90 active:bg-orange-500 active:text-stone-950 touch-none"
          >
            <Swords className="w-4 h-4" />
            <span>Cleave</span>
          </button>

          {/* Dodge Dash */}
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onDodge();
            }}
            className="absolute bottom-4 left-0 w-12 h-12 rounded-full bg-[#0d1117]/82 border border-sky-400/40 text-sky-300 flex flex-col items-center justify-center text-[10px] font-semibold active:scale-90 active:bg-sky-400 active:text-stone-950 touch-none"
          >
            <Wind className="w-4 h-4" />
            <span>Dodge</span>
          </button>

          {/* Primary Light Slash */}
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onSlash();
            }}
            className="absolute bottom-6 right-14 w-[62px] h-[62px] rounded-full bg-amber-500/88 border-2 border-amber-300 text-stone-950 flex flex-col items-center justify-center text-[11px] font-bold shadow-xl active:scale-90 touch-none"
          >
            <Swords className="w-5 h-5" />
            <span>Slash</span>
          </button>

          {/* Jump */}
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onJump();
            }}
            className="absolute bottom-0 right-0 w-13 h-13 rounded-full bg-[#0d1117]/84 border border-emerald-400/45 text-emerald-300 flex flex-col items-center justify-center text-[10px] font-semibold active:scale-90 active:bg-emerald-400 active:text-stone-950 touch-none"
          >
            <ArrowUp className="w-4 h-4" />
            <span>Jump</span>
          </button>
        </div>
      </div>
    </>
  );
}
