import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

import {
  QualityPreset,
  QUALITY_CONFIGS,
  WeatherMode,
  CameraMode,
  HudTelemetry,
  GraphicsFlags,
  getPresetGraphicsFlags,
  WorldMapId,
  getWorldMapDef,
  EnemyMapMarker,
} from './types';
import {
  groundHeightAt,
  getDominantBiome,
  getCaveProximity,
  waterDistanceInfo,
  WATER_LEVEL,
  setActiveWorldMap,
} from './noise';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import { createSharedEnvUniforms, createSkyDomeMaterial } from './materials';
import { buildOpenWorld } from './world';
import { createCharacterSystem } from './character';
import { createWildlifeSystem } from './wildlife';
import { createWeatherAndVfxSystem } from './weatherAndVfx';
import { createCombatSystem, CombatSystem } from './combat';
import { createEnemySystem, EnemySystem } from './enemies';
import { NetLocalPlayerState, RemotePlayerState } from './multiplayer';
import { RemotePlayersSystem } from './remotePlayers';

// Custom HDR Filmic Grading + Crisp Unsharp Clarity + Subtle Vignette (Zero Blur)
const CinematicGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uNightFactor: { value: 0.0 },
    uExposure: { value: 1.0 },
    uVignette: { value: 0.22 },
    uWarmth: { value: 0.05 },
    uHdrBoost: { value: 1.0 },
    uSharpness: { value: 0.24 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uNightFactor;
    uniform float uExposure;
    uniform float uVignette;
    uniform float uWarmth;
    uniform float uHdrBoost;
    uniform float uSharpness;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 col = tex.rgb;

      // Subtle unsharp-mask clarity boost for crisp foliage, stone, face & fabric detail
      if (uSharpness > 0.01) {
        vec2 px = 1.0 / max(uResolution, vec2(1.0));
        vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb;
        vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
        vec3 e = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb;
        vec3 w = texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb;
        vec3 neighbors = (n + s + e + w) * 0.25;
        vec3 detail = clamp(col - neighbors, vec3(-0.22), vec3(0.22));
        col += detail * uSharpness;
      }

      col *= uExposure;

      // HDR highlight preservation + gentle filmic contrast curve
      if (uHdrBoost > 0.5) {
        col = col * (1.0 + 0.14 * smoothstep(0.38, 1.55, col));
      }

      // Subtle natural vibrance (enhances warm skin SSS, foliage & fabric without oversaturating highlights)
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float maxC = max(col.r, max(col.g, col.b));
      float minC = min(col.r, min(col.g, col.b));
      float sat = maxC > 0.001 ? (maxC - minC) / maxC : 0.0;
      float vibAmt = (1.0 - sat * 0.65) * 0.14;
      col = mix(vec3(lum), col, 1.0 + vibAmt);

      // Filmic color grading (warm sunset highlights, cool crisp shadows)
      vec3 shadowsTint = mix(vec3(0.96, 0.99, 1.03), vec3(0.84, 0.92, 1.12), uNightFactor);
      vec3 highlightsTint = mix(vec3(1.0 + uWarmth, 1.0, 1.0 - uWarmth * 0.8), vec3(0.92, 0.96, 1.04), uNightFactor);
      col *= mix(shadowsTint, highlightsTint, smoothstep(0.14, 0.85, lum));

      // Gentle vignette framing
      vec2 centered = vUv - 0.5;
      float vig = 1.0 - dot(centered, centered) * uVignette;
      col *= clamp(vig, 0.6, 1.0);

      gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(12.0)), tex.a);
    }
  `,
};

export interface SurvivalLoadProgress {
  percent: number;
  stage: string;
  ready: boolean;
}

export interface SurvivalEngineCallbacks {
  onTelemetry: (data: HudTelemetry) => void;
  onWebglError: (msg: string) => void;
  onLoadProgress?: (progress: SurvivalLoadProgress) => void;
  onMapSwitchProgress?: (progress: SurvivalLoadProgress) => void;
  onLocalStateSync?: (state: NetLocalPlayerState) => void;
  initialQuality?: QualityPreset;
  initialSensitivity?: number;
  initialMapId?: WorldMapId;
}

export class SurvivalEngine {
  private container: HTMLElement;
  private callbacks: SurvivalEngineCallbacks;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private gradePass!: ShaderPass;
  private outputPass!: OutputPass;
  private smaaPass!: SMAAPass;

  private pmremGenerator!: THREE.PMREMGenerator;
  private dynamicEnvRT: THREE.WebGLRenderTarget | null = null;
  private cubeRenderTarget!: THREE.WebGLCubeRenderTarget;
  private cubeCamera!: THREE.CubeCamera;
  private reflectionFrameCounter = 0;

  private isSoftwareGl = false;
  private isMobileDevice = false;
  private virtualLandscape = false;
  private resizeObserver: ResizeObserver | null = null;
  private worldReady = false;
  private hasActiveWorldEntities = false;
  private isSwitchingMap = false;
  private mapSwitchSeq = 0;
  private entered = false;
  private frameId = 0;
  private disposed = false;
  private clock = new THREE.Clock();
  private elapsed = 0;

  private activeMapId: WorldMapId = 'lost_valley';
  private quality: QualityPreset = 'HIGH';
  private graphicsFlags: GraphicsFlags = getPresetGraphicsFlags('HIGH');
  private cameraMode: CameraMode = 'THIRD_PERSON';
  private timeHours = 17.65; // Dramatic golden-hour sunset start
  private timePaused = false;
  private timeSpeed = 0.06; // ~6.6 mins per full 24h cycle

  private envUniforms = createSharedEnvUniforms();
  private textures!: ProceduralTextureSet;
  private sunLight!: THREE.DirectionalLight;
  private bounceLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private sunGlareSprite!: THREE.Sprite;
  private skyDome!: THREE.Mesh;
  private sunShaftsGroup!: THREE.Group;
  private sunShaftMat!: THREE.ShaderMaterial;
  private fog!: THREE.FogExp2;

  private world!: ReturnType<typeof buildOpenWorld>;
  private character!: ReturnType<typeof createCharacterSystem>;
  private wildlife!: ReturnType<typeof createWildlifeSystem>;
  private weatherVfx!: ReturnType<typeof createWeatherAndVfxSystem>;
  private combat!: CombatSystem;
  private enemies!: EnemySystem;
  private remotePlayersSystem!: RemotePlayersSystem;
  private remotePlayers: RemotePlayerState[] = [];

  // Input & Controls
  private keys = new Set<string>();
  private virtualForward = 0;
  private virtualRight = 0;
  private virtualSprint = false;
  private virtualJumpQueued = false;
  private virtualCrouch = false;
  private activeCanvasPointers = new Map<number, { x: number; y: number }>();
  private lookPointerId: number | null = null;
  private lastPinchDist: number | null = null;
  private lastTouchTimestamp = 0;
  private lookSensitivity = 1.0;

  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private isPointerLocked = false;
  private camYaw = 1.05; // Framed across lake toward sunset mountains
  private camPitch = -0.11;
  private prevCamYaw = 1.05;
  private prevCamPitch = -0.11;
  private camDist = 5.0;
  private orbitAngle = 0;
  private smoothCamPos = new THREE.Vector3();
  private smoothCamLook = new THREE.Vector3();
  private introTimer = 3.4; // Opening cinematic crane sweep
  private camRoll = 0;
  private cameraTrauma = 0;
  private hitStopTimer = 0;
  private attackHitPending = false;
  private attackHitDelay = 0;
  private attackPendingHeavy = false;

  // Survival vitals
  private health = 100;
  private maxHealth = 100;
  private playerHitFlash = 0;
  private respawnBannerTimer = 0;
  private stamina = 100;
  private warmth = 90;
  private hydration = 92;
  private telemetryTimer = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private currentFps = 60;

  // Scratch vectors (zero GC in tick)
  private _camTarget = new THREE.Vector3();
  private _camDesired = new THREE.Vector3();
  private _camDir = new THREE.Vector3();
  private _camRight = new THREE.Vector3();
  private _attackOrigin = new THREE.Vector3();
  private _attackDir = new THREE.Vector3();
  private _skyTop = new THREE.Color();
  private _skyHoriz = new THREE.Color();
  private _sunCol = new THREE.Color();
  private _hemiSky = new THREE.Color();
  private _hemiGnd = new THREE.Color();

  constructor(container: HTMLElement, callbacks: SurvivalEngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isMobileDevice =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches ||
        navigator.maxTouchPoints > 0 ||
        window.innerWidth < 820);
    const startQuality = callbacks.initialQuality ?? (this.isMobileDevice ? 'MEDIUM' : 'HIGH');
    this.quality = startQuality;
    this.graphicsFlags = getPresetGraphicsFlags(startQuality);
    this.lookSensitivity = callbacks.initialSensitivity ?? (this.isMobileDevice ? 1.6 : 1.0);
    this.activeMapId = callbacks.initialMapId ?? 'lost_valley';
    setActiveWorldMap(this.activeMapId);
    const mapDef = getWorldMapDef(this.activeMapId);
    this.timeHours = mapDef.defaultTimeHours;
    this.camYaw = mapDef.spawn.yaw;
    this.prevCamYaw = mapDef.spawn.yaw;
    void this.init();
  }

  private yieldFrame(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  private emitProgress(percent: number, stage: string, ready = false): void {
    if (this.disposed) return;
    this.callbacks.onLoadProgress?.({ percent, stage, ready });
  }

  private emitMapSwitchProgress(percent: number, stage: string, ready = false): void {
    if (this.disposed) return;
    const payload: SurvivalLoadProgress = { percent, stage, ready };
    this.callbacks.onMapSwitchProgress?.(payload);
    if (!this.entered) {
      this.callbacks.onLoadProgress?.(payload);
    }
  }

  public enterWorld(): void {
    this.entered = true;
    this.introTimer = 3.4;
    this.clock.getDelta();
  }

  private detectSoftwareGl(): boolean {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return true;
    }
  }

  private async init(): Promise<void> {
    this.emitProgress(8, 'Initializing WebGL2 & HDR Pipeline');
    await this.yieldFrame();
    if (this.disposed) return;

    this.isSoftwareGl = this.detectSoftwareGl();

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      this.callbacks.onWebglError('WebGL context unavailable on this device.');
      return;
    }

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.callbacks.onWebglError('Graphics context paused. Restoring...');
    });
    this.container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2(0x9fc2de, 0.0026);
    this.scene.fog = this.fog;
    this.scene.background = this._skyHoriz;

    // Studio baseline environment + Real-time CubeCamera Reflection & Dynamic GI IBL Probe
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.dynamicEnvRT = this.pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.dynamicEnvRT.texture;
    this.scene.environmentIntensity = 0.48;

    this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(128, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      type: THREE.HalfFloatType,
    });
    this.cubeCamera = new THREE.CubeCamera(0.5, 900, this.cubeRenderTarget);
    this.scene.add(this.cubeCamera);

    this.camera = new THREE.PerspectiveCamera(62, w / h, 0.15, 1100);

    this.emitProgress(24, 'Generating Procedural PBR Materials');
    await this.yieldFrame();
    if (this.disposed) return;

    // Procedural Textures
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const textures = createProceduralTextures(maxAniso);
    this.textures = textures;

    // Sky Dome + Volumetric Cloud Shader (tracks camera so it never clips beyond camera.far)
    const skyMat = createSkyDomeMaterial(this.envUniforms);
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(360, 32, 20), skyMat);
    this.skyDome.frustumCulled = false;
    this.skyDome.renderOrder = -100;
    this.scene.add(this.skyDome);

    // Sun Glare / Lens Halo Sprite
    const glareMat = new THREE.SpriteMaterial({
      map: textures.softGlowMap,
      color: 0xffe4ad,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.sunGlareSprite = new THREE.Sprite(glareMat);
    this.sunGlareSprite.scale.set(95, 95, 1);
    this.scene.add(this.sunGlareSprite);

    // Warm/Cool Lighting Rig + Sun-Bounce Global Illumination Fill
    this.hemiLight = new THREE.HemisphereLight(0x9ec6e8, 0x3f3626, 0.72);
    this.scene.add(this.hemiLight);

    this.bounceLight = new THREE.DirectionalLight(0xffb478, 0.36);
    this.bounceLight.castShadow = false;
    this.scene.add(this.bounceLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 2.3);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.radius = 2.6;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 260;
    const d = 68;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.03;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.emitProgress(46, 'Sculpting Valley Terrain, River & Bridge');
    await this.yieldFrame();
    if (this.disposed) return;

    // Open World, Character, Wildlife, Combat & Weather/VFX
    const initCfg = QUALITY_CONFIGS[this.quality];
    const mapDef = getWorldMapDef(this.activeMapId);
    this.world = buildOpenWorld(textures, this.envUniforms, initCfg.terrainSegments, initCfg.waterSegments, mapDef);
    this.scene.add(this.world.root);

    this.emitProgress(68, 'Seeding Pine Forests, Flora & Wildlife');
    await this.yieldFrame();
    if (this.disposed) return;

    this.character = createCharacterSystem(this.scene, textures);
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnRadius = 1.6 + Math.random() * 1.4;
    this.character.setPosition(
      mapDef.spawn.x + Math.cos(spawnAngle) * spawnRadius,
      mapDef.spawn.z + Math.sin(spawnAngle) * spawnRadius,
      mapDef.spawn.yaw
    );
    this.character.state.yaw = this.camYaw;
    this.character.state.pitch = this.camPitch;
    this.character.group.rotation.y = this.camYaw + Math.PI;

    this.wildlife = createWildlifeSystem(this.scene, textures.softGlowMap, this.world.flowerPositions);
    this.weatherVfx = createWeatherAndVfxSystem(this.scene, textures, this.world.campfirePos);
    this.weatherVfx.setWeatherMode(mapDef.defaultWeather);
    this.combat = createCombatSystem(
      this.scene,
      textures,
      this.world.crateAnchors,
      this.world.totemAnchors
    );
    this.enemies = createEnemySystem(this.scene, this.activeMapId);
    this.remotePlayersSystem = new RemotePlayersSystem(this.scene, textures);

    // Volumetric Sunset / Golden-Hour God-Ray Shaft Planes across the Valley
    this.sunShaftMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffb46b) },
        uOpacity: { value: 0.14 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float edgeX = max(sin(vUv.x * 3.14159), 1e-4);
          float beam = pow(edgeX, 2.2) * smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.15, 1.0, vUv.y));
          gl_FragColor = vec4(uColor, beam * uOpacity);
        }
      `,
    });
    this.sunShaftsGroup = new THREE.Group();
    const shaftGeo = new THREE.PlaneGeometry(18, 56);
    const shaftAnchors = [
      { x: -34, z: 48 },
      { x: -24, z: 16 },
      { x: 14, z: -28 },
      { x: 64, z: 22 },
    ];
    for (const sa of shaftAnchors) {
      const m = new THREE.Mesh(shaftGeo, this.sunShaftMat);
      m.position.set(sa.x, groundHeightAt(sa.x, sa.z) + 18, sa.z);
      m.renderOrder = 3;
      this.sunShaftsGroup.add(m);
    }
    this.scene.add(this.sunShaftsGroup);

    // Initialize Camera High for Opening Cinematic Crane Swoop
    this.smoothCamPos.set(
      this.character.state.position.x + 14,
      this.character.state.position.y + 12.5,
      this.character.state.position.z + 16
    );
    this.smoothCamLook.copy(this.character.state.position).add(new THREE.Vector3(0, 2.2, 0));

    this.emitProgress(86, 'Compiling Shaders & Reflection Probes');
    await this.yieldFrame();
    if (this.disposed) return;

    // Crisp HDR HalfFloat MSAA Post-Processing Pipeline (Zero Blur):
    // Mobile GPUs disable 4x FBO MSAA to sustain smooth 45-60 FPS while keeping HDR + Clarity
    const hdrRenderTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples: this.isSoftwareGl || this.isMobileDevice ? 0 : 4,
    });
    this.composer = new EffectComposer(this.renderer, hdrRenderTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.22, 0.98);
    this.composer.addPass(this.bloomPass);

    this.gradePass = new ShaderPass(CinematicGradeShader);
    this.composer.addPass(this.gradePass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.smaaPass = new SMAAPass();
    this.composer.addPass(this.smaaPass);

    this.applyQualityPreset(this.quality, true);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
      this.updateReflectionProbe(true);
    }

    this.worldReady = true;
    this.hasActiveWorldEntities = true;
    this.bindEvents();
    this.emitProgress(100, 'Expedition Ready', true);
    this.tick();
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    const dom = this.renderer.domElement;
    dom.addEventListener('mousedown', this.onMouseDown);
    dom.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    dom.addEventListener('wheel', this.onWheel, { passive: true });
    dom.addEventListener('pointerdown', this.onCanvasPointerDown);
    dom.addEventListener('pointermove', this.onCanvasPointerMove);
    dom.addEventListener('pointerup', this.onCanvasPointerUp);
    dom.addEventListener('pointercancel', this.onCanvasPointerUp);
    dom.addEventListener('touchmove', this.onCanvasTouchMovePrevent, { passive: false });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.container);
    }
  }

  private onCanvasTouchMovePrevent = (e: TouchEvent): void => {
    if (this.entered && e.cancelable) {
      e.preventDefault();
    }
  };

  private getCanvasPinchDistance(): number | null {
    if (this.activeCanvasPointers.size < 2) return null;
    const it = this.activeCanvasPointers.values();
    const p1 = it.next().value;
    const p2 = it.next().value;
    if (!p1 || !p2) return null;
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  private onCanvasPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    if (!this.entered || this.isSwitchingMap) return;
    this.lastTouchTimestamp = performance.now();
    this.introTimer = 0;

    try {
      this.renderer.domElement.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore capture errors on synthetic pointers
    }

    this.activeCanvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.activeCanvasPointers.size >= 2) {
      this.lookPointerId = null;
      this.lastPinchDist = this.getCanvasPinchDistance();
      return;
    }

    if (this.lookPointerId === null) {
      this.lookPointerId = e.pointerId;
    }
  };

  private onCanvasPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    if (!this.entered || this.isSwitchingMap) return;
    if (!this.activeCanvasPointers.has(e.pointerId)) return;

    this.lastTouchTimestamp = performance.now();
    const prev = this.activeCanvasPointers.get(e.pointerId)!;
    const rawDx = e.clientX - prev.x;
    const rawDy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;

    const dx = this.virtualLandscape ? rawDy : rawDx;
    const dy = this.virtualLandscape ? -rawDx : rawDy;

    if (this.activeCanvasPointers.size >= 2 && this.cameraMode === 'THIRD_PERSON') {
      const dist = this.getCanvasPinchDistance();
      if (dist !== null && this.lastPinchDist !== null) {
        const delta = this.lastPinchDist - dist;
        this.camDist = THREE.MathUtils.clamp(this.camDist + delta * 0.02, 2.6, 11.5);
      }
      this.lastPinchDist = dist;
      return;
    }

    if (e.pointerId === this.lookPointerId) {
      const yawSens = 0.0082 * this.lookSensitivity;
      const pitchSens = 0.0068 * this.lookSensitivity;
      this.camYaw -= dx * yawSens;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch - dy * pitchSens, -1.15, 0.85);
      this.character.state.yaw = this.camYaw;
      this.character.state.pitch = this.camPitch;
    }
  };

  private onCanvasPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    this.lastTouchTimestamp = performance.now();
    this.activeCanvasPointers.delete(e.pointerId);

    try {
      if (this.renderer.domElement.hasPointerCapture?.(e.pointerId)) {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    if (this.activeCanvasPointers.size < 2) {
      this.lastPinchDist = null;
    }
    if (this.lookPointerId === e.pointerId) {
      this.lookPointerId = null;
    }
    if (this.lookPointerId === null && this.activeCanvasPointers.size === 1) {
      const nextId = this.activeCanvasPointers.keys().next().value;
      if (nextId !== undefined) {
        this.lookPointerId = nextId;
      }
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onResize = (): void => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.smaaPass.setSize(w * pr, h * pr);
    this.gradePass.uniforms.uResolution.value.set(w * pr, h * pr);
    this.bloomPass.resolution.set(w, h);
  };

  private onPointerLockChange = (): void => {
    this.isPointerLocked = document.pointerLockElement === this.renderer.domElement;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.entered || this.isSwitchingMap) return;
    if (performance.now() - this.lastTouchTimestamp < 900) return;
    this.introTimer = 0;
    if (e.button === 2) {
      this.performMeleeAttack(true);
      return;
    }
    if (e.button !== 0) return;

    if (this.isPointerLocked) {
      this.performMeleeAttack(false);
    }

    this.isDragging = true;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    if (!this.isPointerLocked && this.cameraMode !== 'CINEMATIC_ORBIT' && !this.isMobileDevice) {
      try {
        this.renderer.domElement.requestPointerLock?.();
      } catch {
        // Fallback drag-look works seamlessly if pointer lock is blocked
      }
    }
  };

  private onMouseUp = (): void => {
    this.isDragging = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.entered || this.isSwitchingMap) return;
    if (performance.now() - this.lastTouchTimestamp < 900) return;
    if (!this.isPointerLocked && !this.isDragging) return;
    const dx = this.isPointerLocked ? e.movementX : e.clientX - this.lastMouseX;
    const dy = this.isPointerLocked ? e.movementY : e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    const sens = 0.0024 * this.lookSensitivity;
    this.camYaw -= dx * sens;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - dy * sens, -1.15, 0.85);
    this.character.state.yaw = this.camYaw;
    this.character.state.pitch = this.camPitch;
  };

  private onWheel = (e: WheelEvent): void => {
    if (this.cameraMode === 'THIRD_PERSON') {
      this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.004, 2.6, 11.5);
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isSwitchingMap) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    const code = e.code;
    this.keys.add(code);

    if (code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD') {
      this.introTimer = 0;
    }

    if (code === 'KeyF') {
      this.toggleFlashlight();
    } else if (code === 'KeyJ') {
      this.introTimer = 0;
      this.performMeleeAttack(false);
    } else if (code === 'KeyK') {
      this.introTimer = 0;
      this.performMeleeAttack(true);
    } else if (code === 'KeyQ') {
      this.introTimer = 0;
      this.performDodge();
    } else if (code === 'KeyR') {
      this.character.setGuarding(true);
    } else if (code === 'KeyV') {
      this.cycleCameraMode();
    } else if (code === 'KeyE') {
      this.interact();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (e.code === 'KeyR') {
      this.character.setGuarding(false);
    }
  };

  private performMeleeAttack(heavy: boolean): void {
    if (heavy && this.stamina < 16) return;
    const res = this.character.triggerAttack(heavy);
    if (!res) return;

    if (heavy) {
      this.stamina = Math.max(0, this.stamina - 18);
    } else {
      this.stamina = Math.max(0, this.stamina - 6);
    }

    this.combat.spawnSlashArc(
      this.character.state.position,
      this.character.state.yaw,
      res.comboStep,
      res.isHeavy
    );
    this.cameraTrauma = Math.min(1, this.cameraTrauma + (res.isHeavy ? 0.34 : 0.14));
    this.attackHitPending = true;
    this.attackPendingHeavy = res.isHeavy;
    this.attackHitDelay = res.isHeavy ? 0.16 : 0.08;
  }

  private performDodge(): void {
    if (this.stamina < 14) return;
    let fwd = this.virtualForward;
    let rgt = this.virtualRight;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) rgt += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) rgt -= 1;

    if (this.character.triggerDodge(fwd, rgt)) {
      this.stamina = Math.max(0, this.stamina - 16);
      this.combat.spawnDodgeBurst(this.character.state.position);
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.18);
    }
  }

  public setVirtualMove(forward: number, right: number, sprint = false): void {
    if (Math.abs(forward) > 0.05 || Math.abs(right) > 0.05) {
      this.introTimer = 0;
    }
    this.virtualForward = THREE.MathUtils.clamp(forward, -1, 1);
    this.virtualRight = THREE.MathUtils.clamp(right, -1, 1);
    this.virtualSprint = sprint;
  }

  public triggerJump(): void {
    this.introTimer = 0;
    this.virtualJumpQueued = true;
  }

  public setGuarding(guarding: boolean): void {
    this.introTimer = 0;
    this.character.setGuarding(guarding);
  }

  public setCrouching(crouching: boolean): void {
    this.virtualCrouch = crouching;
  }

  public interact(): void {
    const distCamp = this.character.state.position.distanceTo(this.world.campfirePos);
    if (distCamp < 5.5) {
      this.weatherVfx.toggleCampfire();
    } else {
      const { dist } = waterDistanceInfo(this.character.state.position.x, this.character.state.position.z);
      if (dist < 3.5) {
        this.hydration = Math.min(100, this.hydration + 25);
        this.health = Math.min(this.maxHealth, this.health + 8);
      }
    }
  }

  public cycleCameraMode(): CameraMode {
    this.introTimer = 0;
    const order: CameraMode[] = ['THIRD_PERSON', 'FIRST_PERSON', 'CINEMATIC_ORBIT'];
    const next = order[(order.indexOf(this.cameraMode) + 1) % order.length];
    this.setCameraMode(next);
    return next;
  }

  // Public API for React Control Dock
  public setQualityPreset(preset: QualityPreset): void {
    this.graphicsFlags = getPresetGraphicsFlags(preset);
    if (!this.worldReady) {
      this.quality = preset;
      return;
    }
    this.applyQualityPreset(preset, false);
  }

  public getGraphicsFlags(): GraphicsFlags {
    return { ...this.graphicsFlags };
  }

  public setGraphicsFlags(partial: Partial<GraphicsFlags>): GraphicsFlags {
    this.graphicsFlags = { ...this.graphicsFlags, ...partial };
    if (this.worldReady) {
      this.syncPostProcessingFlags();
    }
    return { ...this.graphicsFlags };
  }

  private syncPostProcessingFlags(): void {
    const cfg = QUALITY_CONFIGS[this.quality];
    const postOn = !this.isSoftwareGl && cfg.postProcessing;

    this.bloomPass.enabled = cfg.bloomEnabled || (postOn && this.graphicsFlags.hdr);
    this.gradePass.enabled = cfg.gradeEnabled || (postOn && (this.graphicsFlags.hdr || this.graphicsFlags.clarity));
    this.gradePass.uniforms.uHdrBoost.value = this.graphicsFlags.hdr ? 1.0 : 0.0;
    this.gradePass.uniforms.uSharpness.value = this.graphicsFlags.clarity ? 0.30 : 0.0;
    this.bloomPass.threshold = this.graphicsFlags.hdr ? 0.94 : 1.04;
    this.bloomPass.strength = this.graphicsFlags.hdr ? 0.24 : 0.14;
    this.bloomPass.radius = 0.22;

    this.smaaPass.enabled = postOn && this.graphicsFlags.antiAliasing === 'SMAA';

    this.bounceLight.visible = this.graphicsFlags.giAndAo;
    this.scene.environmentIntensity = this.graphicsFlags.giAndAo ? 0.65 : 0.28;
    if (!this.graphicsFlags.rayReflections) {
      this.envUniforms.uEnvMapMix.value = 0.0;
    } else if (!this.isSoftwareGl) {
      this.envUniforms.uEnvMapMix.value = 1.0;
    }
  }

  private updateReflectionProbe(force = false): void {
    if (this.isSoftwareGl || !this.graphicsFlags.rayReflections) {
      this.envUniforms.uEnvMapMix.value = 0.0;
      return;
    }
    this.reflectionFrameCounter++;
    const interval = this.isMobileDevice ? 24 : 10;
    if (!force && this.reflectionFrameCounter % interval !== 0) return;

    const p = this.character.state.position;
    this.cubeCamera.position.set(p.x, Math.max(WATER_LEVEL + 1.8, p.y + 1.4), p.z);

    // Hide character, water plane, and sun flare sprite so probe reflects clean world sky/terrain/cabins
    const prevCharVis = this.character.group.visible;
    const prevWaterVis = this.world.waterMesh.visible;
    const prevGlareVis = this.sunGlareSprite.visible;
    this.character.group.visible = false;
    this.world.waterMesh.visible = false;
    this.sunGlareSprite.visible = false;

    this.skyDome.position.copy(this.cubeCamera.position);
    this.cubeCamera.update(this.renderer, this.scene);
    this.skyDome.position.copy(this.camera.position);

    this.character.group.visible = prevCharVis;
    this.world.waterMesh.visible = prevWaterVis;
    this.sunGlareSprite.visible = prevGlareVis;

    this.envUniforms.uEnvMap.value = this.cubeRenderTarget.texture;
    this.envUniforms.uEnvMapMix.value = 1.0;

    // Update real-time Global Illumination IBL environment every 30 frames when GI is enabled
    if (this.graphicsFlags.giAndAo && (force || this.reflectionFrameCounter % 30 === 0)) {
      const nextEnvRT = this.pmremGenerator.fromCubemap(this.cubeRenderTarget.texture);
      this.scene.environment = nextEnvRT.texture;
      this.dynamicEnvRT?.dispose();
      this.dynamicEnvRT = nextEnvRT;
    }
  }

  private applyQualityPreset(preset: QualityPreset, isInitial: boolean): void {
    const prev = QUALITY_CONFIGS[this.quality];
    this.quality = preset;
    const cfg = QUALITY_CONFIGS[preset];

    const pr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, cfg.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && cfg.shadowsEnabled;

    if (this.sunLight.shadow.mapSize.width !== cfg.shadowMapSize) {
      this.sunLight.shadow.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
    }

    this.syncPostProcessingFlags();

    this.camera.far = Math.max(920, cfg.fogFar * 2.1);
    this.camera.updateProjectionMatrix();

    if (!isInitial && (prev.terrainSegments !== cfg.terrainSegments || prev.waterSegments !== cfg.waterSegments)) {
      this.world.rebuildTerrainAndWater(cfg.terrainSegments, cfg.waterSegments);
    }
    this.onResize();
  }

  public setWeatherMode(mode: WeatherMode): void {
    if (!this.worldReady) return;
    this.weatherVfx.setWeatherMode(mode);
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }

  public setTimeOfDay(hours: number): void {
    this.timeHours = ((hours % 24) + 24) % 24;
  }

  public setTimePaused(paused: boolean): void {
    this.timePaused = paused;
  }

  public setLookSensitivity(value: number): void {
    this.lookSensitivity = THREE.MathUtils.clamp(value, 0.4, 3.0);
  }

  public setVirtualLandscape(enabled: boolean): void {
    if (this.virtualLandscape === enabled) return;
    this.virtualLandscape = enabled;
    if (this.worldReady) {
      this.onResize();
    }
  }

  public toggleFlashlight(): boolean {
    if (!this.worldReady) return false;
    this.character.state.flashlightOn = !this.character.state.flashlightOn;
    return this.character.state.flashlightOn;
  }

  public toggleAudio(): boolean {
    if (!this.worldReady) return false;
    return this.weatherVfx.toggleAudio();
  }

  public triggerLightAttack(): void {
    this.introTimer = 0;
    this.performMeleeAttack(false);
  }

  public triggerHeavyAttack(): void {
    this.introTimer = 0;
    this.performMeleeAttack(true);
  }

  public triggerDodge(): void {
    this.introTimer = 0;
    this.performDodge();
  }

  public async switchWorldMap(mapId: WorldMapId): Promise<void> {
    if (this.activeMapId === mapId && this.worldReady && !this.isSwitchingMap) return;
    const seq = ++this.mapSwitchSeq;
    this.activeMapId = mapId;
    setActiveWorldMap(mapId);
    const mapDef = getWorldMapDef(mapId);
    if (!this.worldReady) {
      this.timeHours = mapDef.defaultTimeHours;
      this.camYaw = mapDef.spawn.yaw;
      this.prevCamYaw = mapDef.spawn.yaw;
      return;
    }

    this.isSwitchingMap = true;
    try {
      this.emitMapSwitchProgress(12, 'Preparing Expedition...', false);
      await this.yieldFrame();
      if (this.disposed || seq !== this.mapSwitchSeq) return;

      const cfg = QUALITY_CONFIGS[this.quality];
      if (this.hasActiveWorldEntities) {
        this.scene.remove(this.world.root);
        this.world.dispose();
        this.wildlife.dispose();
        this.scene.remove(this.combat.root);
        this.combat.dispose();
        this.enemies?.dispose();
        this.hasActiveWorldEntities = false;
      }

      this.emitMapSwitchProgress(38, 'Sculpting Valley Terrain, River & Bridge', false);
      await this.yieldFrame();
      if (this.disposed || seq !== this.mapSwitchSeq) return;

      this.world = buildOpenWorld(this.textures, this.envUniforms, cfg.terrainSegments, cfg.waterSegments, mapDef);
      this.scene.add(this.world.root);
      this.world.updateGrass(mapDef.spawn.x, mapDef.spawn.z, cfg.grassRadius, cfg.grassCount);

      this.emitMapSwitchProgress(68, 'Seeding Pine Forests, Flora & Wildlife', false);
      await this.yieldFrame();
      if (this.disposed || seq !== this.mapSwitchSeq) return;

      this.wildlife = createWildlifeSystem(this.scene, this.textures.softGlowMap, this.world.flowerPositions);
      this.combat = createCombatSystem(
        this.scene,
        this.textures,
        this.world.crateAnchors,
        this.world.totemAnchors
      );
      this.enemies = createEnemySystem(this.scene, mapDef.id);
      this.health = 100;
      this.playerHitFlash = 0;
      this.hasActiveWorldEntities = true;

      this.weatherVfx.setCampfirePos(this.world.campfirePos);
      this.weatherVfx.setWeatherMode(mapDef.defaultWeather);
      this.timeHours = mapDef.defaultTimeHours;

      this.introTimer = 2.0;
      const switchAngle = Math.random() * Math.PI * 2;
      const switchRadius = 1.6 + Math.random() * 1.4;
      this.character.setPosition(
        mapDef.spawn.x + Math.cos(switchAngle) * switchRadius,
        mapDef.spawn.z + Math.sin(switchAngle) * switchRadius,
        mapDef.spawn.yaw
      );
      this.camYaw = mapDef.spawn.yaw;
      this.camPitch = -0.11;
      this.smoothCamPos.set(
        this.character.state.position.x + 8,
        this.character.state.position.y + 7.5,
        this.character.state.position.z + 9
      );
      this.smoothCamLook.copy(this.character.state.position).add(new THREE.Vector3(0, 1.8, 0));

      this.emitMapSwitchProgress(90, 'Compiling Shaders & Reflection Probes', false);
      await this.yieldFrame();
      if (this.disposed || seq !== this.mapSwitchSeq) return;

      if (!this.isSoftwareGl) {
        this.renderer.compile(this.scene, this.camera);
        this.updateReflectionProbe(true);
      }

      this.clock.getDelta();
      this.emitMapSwitchProgress(100, 'Expedition Ready', true);
    } finally {
      if (seq === this.mapSwitchSeq) {
        this.isSwitchingMap = false;
      }
    }
  }

  public teleportToLandmark(id: string): void {
    const mapDef = getWorldMapDef(this.activeMapId);
    const lm = mapDef.landmarks.find((l) => l.id === id);
    if (!lm) return;
    this.teleportToCoords(lm.x, lm.z, lm.yaw);
  }

  public teleportToCoords(x: number, z: number, yaw = this.camYaw): void {
    if (!this.worldReady) return;
    this.introTimer = 0;
    this.character.setPosition(x, z, yaw);
    this.camYaw = yaw;
    this.camPitch = -0.14;
    const cfg = QUALITY_CONFIGS[this.quality];
    this.world.updateGrass(x, z, cfg.grassRadius, cfg.grassCount);
  }

  public setRemotePlayers(players: RemotePlayerState[]): void {
    this.remotePlayers = players;
  }

  public getEnemyMarkers(): EnemyMapMarker[] {
    if (!this.worldReady || !this.enemies) return [];
    return this.enemies.getMapMarkers();
  }

  public getLocalNetState(): NetLocalPlayerState {
    if (!this.worldReady || !this.character) {
      const def = getWorldMapDef(this.activeMapId);
      return {
        mapId: this.activeMapId,
        x: def.spawn.x,
        y: 3.2,
        z: def.spawn.z,
        yaw: def.spawn.yaw,
        speed: 0,
        crouch: false,
        sprint: false,
        swim: false,
        flashlight: false,
        attackCombo: 0,
        attackTimer: 0,
        heavy: false,
        dodge: false,
        guard: false,
      };
    }
    const s = this.character.state;
    const bodyYaw = this.character.group.rotation.y - Math.PI;
    return {
      mapId: this.activeMapId,
      x: s.position.x,
      y: s.position.y,
      z: s.position.z,
      yaw: bodyYaw,
      speed: s.moveSpeed,
      crouch: s.isCrouching,
      sprint: s.isSprinting,
      swim: s.isSwimming,
      flashlight: s.flashlightOn,
      attackCombo: s.attackCombo,
      attackTimer: s.attackTimer,
      heavy: s.isHeavyAttack,
      dodge: s.dodgeTimer > 0,
      guard: s.isGuarding,
    };
  }

  private queryWalkableHeight = (x: number, z: number): number => {
    const terrainY = groundHeightAt(x, z);
    for (const b of this.world.bridges) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
        return Math.max(terrainY, b.deckY);
      }
    }
    return terrainY;
  };

  private resolveCollisions = (x: number, z: number, radius: number): { x: number; z: number } => {
    let rx = x;
    let rz = z;
    for (const c of this.world.colliders) {
      const dx = rx - c.x;
      const dz = rz - c.z;
      const minD = c.r + radius;
      const distSq = dx * dx + dz * dz;
      if (distSq < minD * minD && distSq > 0.00001) {
        const d = Math.sqrt(distSq);
        const push = minD - d;
        rx += (dx / d) * push;
        rz += (dz / d) * push;
      }
    }
    for (const bc of this.world.boxColliders) {
      if (rx > bc.minX - radius && rx < bc.maxX + radius && rz > bc.minZ - radius && rz < bc.maxZ + radius) {
        const dzTop = Math.abs(rz - (bc.minZ - radius));
        const dzBot = Math.abs(bc.maxZ + radius - rz);
        if (dzTop < dzBot) rz = bc.minZ - radius;
        else rz = bc.maxZ + radius;
      }
    }
    return { x: rx, z: rz };
  };

  private updateAtmosphereAndLighting(dt: number, inCave: number): { nightFactor: number } {
    if (!this.timePaused) {
      this.timeHours = (this.timeHours + dt * this.timeSpeed) % 24;
    }

    // Sun angle: 6:00 = sunrise (0), 12:00 = zenith (PI/2), 18:00 = sunset (PI)
    const sunTheta = ((this.timeHours - 6) / 24) * Math.PI * 2;
    const sunY = Math.sin(sunTheta);
    const sunX = Math.cos(sunTheta) * 0.88;
    const sunZ = 0.42;

    this.envUniforms.uSunDir.value.set(sunX, sunY, sunZ).normalize();
    this.envUniforms.uMoonDir.value.set(-sunX, -sunY, -sunZ * 0.85).normalize();

    const sunElev = THREE.MathUtils.clamp(sunY, -1, 1);
    const dayFactor = THREE.MathUtils.smoothstep(sunElev, -0.14, 0.22);
    const goldenFactor = Math.exp(-Math.pow((sunElev - 0.06) / 0.15, 2));
    const nightFactor = 1 - dayFactor;
    this.envUniforms.uNightFactor.value = nightFactor;

    const stormDim = 1 - this.weatherVfx.weather.rainIntensity * 0.45;
    const caveDim = 1 - inCave * 0.92;

    // Sky Zenith & Horizon Palette (Rich Sunset Indigo-Cobalt Zenith & Rose-Amber Horizon)
    const nightTop = new THREE.Color(0x060b14);
    const dayTop = new THREE.Color(0x275b9e);
    const sunsetTop = new THREE.Color(0x24345c);
    const stormTop = new THREE.Color(0x33404f);
    this._skyTop
      .copy(nightTop)
      .lerp(dayTop, dayFactor)
      .lerp(sunsetTop, goldenFactor * 0.72)
      .lerp(stormTop, this.weatherVfx.weather.rainIntensity * 0.65);

    const nightHoriz = new THREE.Color(0x101c2e);
    const dayHoriz = new THREE.Color(0x9bc0dd);
    const goldenHoriz = new THREE.Color(0xf48c54);
    const stormHoriz = new THREE.Color(0x52606e);
    this._skyHoriz
      .copy(nightHoriz)
      .lerp(dayHoriz, dayFactor)
      .lerp(goldenHoriz, goldenFactor * 0.85 * (1 - this.weatherVfx.weather.rainIntensity * 0.7))
      .lerp(stormHoriz, this.weatherVfx.weather.rainIntensity * 0.7);

    // Cave darkens fog color smoothly
    this._skyHoriz.lerp(new THREE.Color(0x0a0d12), inCave * 0.9);

    this.envUniforms.uSkyTopColor.value.copy(this._skyTop);
    this.envUniforms.uSkyHorizonColor.value.copy(this._skyHoriz);
    this.envUniforms.uFogColor.value.copy(this._skyHoriz);
    this.fog.color.copy(this._skyHoriz);

    const cfg = QUALITY_CONFIGS[this.quality];
    const baseFog = (1.6 / cfg.fogFar) * this.weatherVfx.weather.fogDensityMult;
    const caveFog = inCave * 0.032;
    this.fog.density = baseFog + caveFog;
    this.envUniforms.uFogDensity.value = this.fog.density;

    // Key Light (Sun during day, Moon at night, plus occasional Storm Lightning flash)
    const flash = this.weatherVfx.weather.lightningFlash;
    if (dayFactor > 0.15) {
      this._sunCol.setHex(0xfff5e4).lerp(new THREE.Color(0xff9444), goldenFactor * 0.84);
      this.sunLight.color.copy(this._sunCol);
      this.sunLight.intensity = (0.45 + dayFactor * 2.4) * stormDim * caveDim + flash * 3.5;
      this.sunLight.position.copy(this.character.state.position).addScaledVector(this.envUniforms.uSunDir.value, 95);
    } else {
      this._sunCol.setHex(0x7ca2d6);
      this.sunLight.color.copy(this._sunCol);
      this.sunLight.intensity = (0.38 * Math.max(0.15, this.envUniforms.uMoonDir.value.y) * caveDim) + flash * 4.5;
      this.sunLight.position.copy(this.character.state.position).addScaledVector(this.envUniforms.uMoonDir.value, 95);
    }
    this.sunLight.target.position.copy(this.character.state.position);
    this.envUniforms.uSunColor.value.copy(this._sunCol);

    // Hemisphere Warm/Cool Ambient Fill + Global Illumination Sun Bounce Light
    this._hemiSky.copy(this._skyHoriz).lerp(new THREE.Color(0x9bc4e8), dayFactor * 0.45);
    this._hemiGnd.setHex(0x2a241b).lerp(new THREE.Color(0x0d121a), nightFactor);
    this.hemiLight.color.copy(this._hemiSky);
    this.hemiLight.groundColor.copy(this._hemiGnd);
    this.hemiLight.intensity = (0.28 + dayFactor * 0.56) * (0.4 + 0.6 * caveDim) + flash * 1.4;

    // GI Bounce Light opposite the sun azimuth (soft warm sunset earth bounce)
    this.bounceLight.position.set(
      -this.envUniforms.uSunDir.value.x * 60,
      14,
      -this.envUniforms.uSunDir.value.z * 60
    );
    this.bounceLight.color
      .setHex(0xd99b6c)
      .lerp(new THREE.Color(0xff8c4a), goldenFactor * 0.7)
      .lerp(new THREE.Color(0x2d4368), nightFactor * 0.85);
    this.bounceLight.intensity = (0.24 + dayFactor * 0.28 + goldenFactor * 0.22) * stormDim * caveDim;

    // Sun Glare Halo & Volumetric Sun Shafts
    this.sunGlareSprite.position.copy(this.camera.position).addScaledVector(this.envUniforms.uSunDir.value, 420);
    const glareOp = Math.max(0.05, sunElev + 0.04) * (0.45 + goldenFactor * 0.25) * (1 - this.weatherVfx.weather.rainIntensity) * caveDim * (1 - nightFactor);
    (this.sunGlareSprite.material as THREE.SpriteMaterial).opacity = glareOp;
    (this.sunGlareSprite.material as THREE.SpriteMaterial).color.copy(this._sunCol);

    const shaftStrength = (0.04 + goldenFactor * 0.14) * (1 - nightFactor) * (1 - this.weatherVfx.weather.rainIntensity * 0.85) * caveDim;
    this.sunShaftMat.uniforms.uOpacity.value = shaftStrength;
    this.sunShaftMat.uniforms.uColor.value.copy(this._sunCol);
    this.sunShaftsGroup.visible = shaftStrength > 0.01;
    if (this.sunShaftsGroup.visible) {
      const sunYaw = Math.atan2(this.envUniforms.uSunDir.value.x, this.envUniforms.uSunDir.value.z);
      for (const child of this.sunShaftsGroup.children) {
        child.rotation.y = sunYaw + Math.PI * 0.5;
        child.rotation.z = -0.52;
      }
    }

    // Cabin & Camp Oil Lanterns warm dusk/night glow
    const lanternGlow = Math.max(0.15, goldenFactor * 1.1 + nightFactor * 1.65);
    for (let i = 0; i < this.world.lanternLights.length; i++) {
      const l = this.world.lanternLights[i];
      l.intensity = lanternGlow * (0.92 + Math.sin(this.elapsed * 9.5 + i * 2.1) * 0.08);
    }

    // Natural HDR exposure adaptation
    const hdrComp = this.graphicsFlags.hdr ? 1.08 : 0.96;
    this.renderer.toneMappingExposure = (1.02 + nightFactor * 0.14 + inCave * 0.18) * hdrComp;
    this.gradePass.uniforms.uNightFactor.value = nightFactor;
    this.gradePass.uniforms.uWarmth.value = 0.04 + goldenFactor * 0.12;

    return { nightFactor };
  }

  private updateCamera(dt: number, elapsed: number, inputRight: number): void {
    const char = this.character.state;
    const isFP = this.cameraMode === 'FIRST_PERSON';

    if (this.entered && this.introTimer > 0) {
      this.introTimer = Math.max(0, this.introTimer - dt);
    }
    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.9);

    // Dynamic FOV punch + Portrait Mobile Horizontal FOV Compensation
    const aspect = this.camera.aspect || 1;
    const portraitBoost = aspect < 1 ? Math.min(18, (1 - aspect) * 28) : 0;
    let targetFov = (isFP ? 66 : 60) + portraitBoost;
    if (this.introTimer > 0) targetFov = 67 + portraitBoost * 0.7;
    else if (char.dodgeTimer > 0) targetFov = 74 + portraitBoost * 0.8;
    else if (char.attackTimer > 0 && char.isHeavyAttack) targetFov = 66 + portraitBoost * 0.8;
    else if (char.isSprinting) targetFov = 70 + portraitBoost * 0.85;

    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 8, dt);
      this.camera.updateProjectionMatrix();
    }

    // Subtle cinematic Dutch tilt on strafing & dodge dashes
    const desiredRoll =
      this.cameraMode === 'CINEMATIC_ORBIT'
        ? Math.sin(elapsed * 0.45) * 0.025
        : char.dodgeTimer > 0
        ? -inputRight * 0.065
        : -inputRight * 0.022;
    this.camRoll = THREE.MathUtils.damp(this.camRoll, desiredRoll, 7, dt);

    // Camera shake offset from trauma
    const shakeAmt = this.cameraTrauma * this.cameraTrauma * 0.24;
    const shakeX = (Math.sin(elapsed * 43.0) + Math.cos(elapsed * 29.0)) * 0.5 * shakeAmt;
    const shakeY = (Math.cos(elapsed * 37.0) - Math.sin(elapsed * 51.0)) * 0.5 * shakeAmt;

    if (this.cameraMode === 'CINEMATIC_ORBIT') {
      this.orbitAngle += dt * 0.2;
      const r = 11.5 + Math.sin(elapsed * 0.28) * 3.5;
      const ox = char.position.x + Math.cos(this.orbitAngle) * r;
      const oz = char.position.z + Math.sin(this.orbitAngle) * r;
      const oy = Math.max(groundHeightAt(ox, oz) + 2.2, char.position.y + 4.2 + Math.sin(elapsed * 0.48) * 1.6);
      this._camDesired.set(ox, oy, oz);
      this._camTarget.set(char.position.x, char.position.y + 1.45, char.position.z);

      this.smoothCamPos.lerp(this._camDesired, 1 - Math.exp(-4.2 * dt));
      this.smoothCamLook.lerp(this._camTarget, 1 - Math.exp(-5.5 * dt));
      this.camera.position.copy(this.smoothCamPos);
      this.camera.position.x += shakeX;
      this.camera.position.y += shakeY;
      this.camera.lookAt(this.smoothCamLook);
      this.camera.rotation.z += this.camRoll;
      return;
    }

    if (isFP) {
      const eyeH = char.isCrouching ? 1.15 : 1.62;
      const moveRatio = Math.min(1, char.moveSpeed / 6.5);
      const bobY = char.isGrounded ? Math.sin(char.walkPhase * 2) * 0.042 * moveRatio : 0;
      const bobX = char.isGrounded ? Math.cos(char.walkPhase) * 0.025 * moveRatio : 0;
      const breath = Math.sin(elapsed * 2.0) * 0.008;

      this._camDesired.set(
        char.position.x + Math.cos(this.camYaw) * bobX + shakeX,
        char.position.y + eyeH + bobY + breath - char.landSquash * 0.5 + shakeY,
        char.position.z - Math.sin(this.camYaw) * bobX
      );
      this.smoothCamPos.lerp(this._camDesired, 1 - Math.exp(-22 * dt));
      this.camera.position.copy(this.smoothCamPos);

      this._camDir.set(
        -Math.sin(this.camYaw) * Math.cos(this.camPitch),
        Math.sin(this.camPitch),
        -Math.cos(this.camYaw) * Math.cos(this.camPitch)
      );
      this._camTarget.copy(this.camera.position).add(this._camDir);
      this.camera.lookAt(this._camTarget);
      this.camera.rotation.z += this.camRoll;
      return;
    }

    // Over-the-Shoulder Third-Person Framing + Opening Crane Sweep
    const focusY = char.isCrouching ? 1.05 : 1.48;
    const shoulderOffset = THREE.MathUtils.clamp(1.2 - (this.camDist - 3.0) * 0.14, 0.25, 0.72);
    this._camRight.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));

    this._camTarget.set(
      char.position.x + this._camRight.x * shoulderOffset,
      char.position.y + focusY,
      char.position.z + this._camRight.z * shoulderOffset
    );

    const cosP = Math.cos(this.camPitch);
    const offsetX = Math.sin(this.camYaw) * cosP * this.camDist + this._camRight.x * (shoulderOffset * 0.55);
    const offsetY = -Math.sin(this.camPitch) * this.camDist + 0.48;
    const offsetZ = Math.cos(this.camYaw) * cosP * this.camDist + this._camRight.z * (shoulderOffset * 0.55);

    this._camDesired.set(
      this._camTarget.x + offsetX,
      this._camTarget.y + offsetY,
      this._camTarget.z + offsetZ
    );

    // Smooth Opening Crane Swoop from Sunset Overlook down to Shoulder Cam
    if (this.introTimer > 0) {
      const t = this.introTimer / 3.4;
      const ease = t * t * (3 - 2 * t);
      this._camDesired.x += Math.sin(ease * 1.1) * 8.5 * ease;
      this._camDesired.y += 8.2 * ease;
      this._camDesired.z += 7.5 * ease;
    }

    const terrainCamFloor = groundHeightAt(this._camDesired.x, this._camDesired.z) + 0.55;
    const waterCamFloor = char.isSwimming ? WATER_LEVEL + 0.35 : -999;
    const floorCam = Math.max(terrainCamFloor, waterCamFloor);
    if (this._camDesired.y < floorCam) {
      this._camDesired.y = floorCam;
    }

    const followRate = this.introTimer > 0 ? 3.2 : 12.5;
    this.smoothCamPos.lerp(this._camDesired, 1 - Math.exp(-followRate * dt));
    this.smoothCamLook.lerp(this._camTarget, 1 - Math.exp(-15 * dt));

    const postFloor = Math.max(groundHeightAt(this.smoothCamPos.x, this.smoothCamPos.z) + 0.45, waterCamFloor);
    if (this.smoothCamPos.y < postFloor) this.smoothCamPos.y = postFloor;

    this.camera.position.copy(this.smoothCamPos);
    this.camera.position.x += shakeX;
    this.camera.position.y += shakeY;
    this.camera.lookAt(this.smoothCamLook);
    this.camera.rotation.z += this.camRoll * 0.7;
  }

  private tick = (): void => {
    if (this.disposed) return;

    if (this.isSwitchingMap) {
      this.clock.getDelta();
      if (this.isSoftwareGl) {
        this.frameId = window.setTimeout(this.tick, 50);
      } else {
        this.frameId = requestAnimationFrame(this.tick);
      }
      return;
    }

    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.05, Math.max(0.001, rawDt));

    // Hit-stop micro-freeze on solid melee impact (camera shake still ticks smoothly)
    let simDt = dt;
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
      simDt = dt * 0.08;
    }
    this.elapsed += simDt;

    // Input aggregation (locked until player clicks Enter World)
    let forward = this.entered ? this.virtualForward : 0;
    let right = this.entered ? this.virtualRight : 0;
    if (this.entered) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;
      forward = THREE.MathUtils.clamp(forward, -1, 1);
      right = THREE.MathUtils.clamp(right, -1, 1);
    }

    const wantJump = this.entered && (this.keys.has('Space') || this.virtualJumpQueued);
    this.virtualJumpQueued = false;
    const wantSprint =
      this.entered &&
      (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.virtualSprint) &&
      this.stamina > 5;
    const wantCrouch =
      this.entered && (this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.virtualCrouch);

    const cave = getCaveProximity(this.character.state.position.x, this.character.state.position.z);
    const inCave = cave.inCaveZone;

    const { nightFactor } = this.updateAtmosphereAndLighting(simDt, inCave);

    // Update character physics, procedural animation & footprints
    this.character.update(
      simDt,
      this.elapsed,
      forward,
      right,
      wantJump,
      wantSprint,
      wantCrouch,
      this.weatherVfx.weather.windDir,
      this.weatherVfx.weather.windStrength,
      this.weatherVfx.weather.rainIntensity,
      this.weatherVfx.weather.snowIntensity,
      this.cameraMode === 'FIRST_PERSON',
      this.queryWalkableHeight,
      this.resolveCollisions
    );

    // Pending Melee Hit Window Resolution
    if (this.attackHitPending) {
      this.attackHitDelay -= simDt;
      if (this.attackHitDelay <= 0) {
        this.attackHitPending = false;
        this._attackOrigin.copy(this.character.state.position);
        this._attackDir.set(-Math.sin(this.character.state.yaw), 0, -Math.cos(this.character.state.yaw));
        const res = this.combat.triggerAttackHitCheck(
          this._attackOrigin,
          this._attackDir,
          this.attackPendingHeavy ? 3.2 : 2.5,
          this.attackPendingHeavy,
          this.wildlife.checkMeleeHit,
          this.enemies.checkMeleeHit
        );
        if (res.hit) {
          this.hitStopTimer = res.hitStop;
          this.cameraTrauma = Math.min(1, this.cameraTrauma + res.shake);
          if (res.killedEnemy) {
            this.health = Math.min(100, this.health + 18);
            this.stamina = Math.min(100, this.stamina + 25);
          }
        }
      }
    }

    // Update Hostile Enemies (Maxluqlar, Yovuz dushmanlar, Bosslar, Guruhlar, Mexaniklar)
    this.playerHitFlash = Math.max(0, this.playerHitFlash - dt * 2.8);
    this.respawnBannerTimer = Math.max(0, this.respawnBannerTimer - dt);
    const enemyRes = this.enemies.update(
      simDt,
      this.elapsed,
      this.character.state.position,
      this.character.state.dodgeTimer > 0,
      this.character.state.isGuarding,
      this.entered
    );
    if (enemyRes.bossShockwavePos) {
      this.combat.spawnImpactPulse(enemyRes.bossShockwavePos, 0xa855f7, 6.2, 16);
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.35);
    }
    if (enemyRes.mechShockwavePos) {
      this.combat.spawnImpactPulse(enemyRes.mechShockwavePos, 0x38bdf8, 4.4, 12);
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.22);
    }
    if (enemyRes.playerDamage > 0) {
      if (enemyRes.playerHitBlocked) {
        this.combat.playCombatSfx('guard');
        this.combat.spawnImpactPulse(this.character.state.position, 0xfbbf24, 2.2, 8);
      } else {
        this.combat.playCombatSfx('hit');
        this.playerHitFlash = 1.0;
      }
      this.cameraTrauma = Math.min(1, this.cameraTrauma + (enemyRes.playerHitBlocked ? 0.16 : 0.42));
      this.health = Math.max(0, this.health - enemyRes.playerDamage);
      if (this.health <= 0) {
        const mapDef = getWorldMapDef(this.activeMapId);
        this.character.setPosition(mapDef.spawn.x, mapDef.spawn.z, mapDef.spawn.yaw);
        this.health = this.maxHealth;
        this.stamina = 100;
        this.playerHitFlash = 1.0;
        this.respawnBannerTimer = 3.0;
      }
    }

    // Survival vitals dynamics
    if (this.character.state.isSwimming && this.character.state.isSprinting && this.character.state.moveSpeed > 2.0) {
      this.stamina = Math.max(0, this.stamina - simDt * 3.0);
    } else if (this.character.state.isSprinting && this.character.state.moveSpeed > 5.5) {
      this.stamina = Math.max(0, this.stamina - simDt * 3.5);
    } else {
      this.stamina = Math.min(100, this.stamina + simDt * (this.character.state.isSwimming ? 8.5 : 12.5));
    }

    const nearCamp = this.character.state.position.distanceTo(this.world.campfirePos) < 6.5;
    if (nearCamp && this.weatherVfx.campfireLit) {
      this.health = Math.min(100, this.health + simDt * 5.5);
    }
    const targetWarmth =
      nearCamp && this.weatherVfx.campfireLit
        ? 98
        : (this.character.state.isSwimming ? 54 : 76) - nightFactor * 16 - this.weatherVfx.weather.snowIntensity * 22 - Math.max(0, this.character.state.position.y - 18) * 0.7;
    this.warmth = THREE.MathUtils.damp(this.warmth, THREE.MathUtils.clamp(targetWarmth, 18, 100), this.character.state.isSwimming ? 0.28 : 0.15, simDt);

    const { dist: waterDist } = waterDistanceInfo(this.character.state.position.x, this.character.state.position.z);
    if (waterDist < 0.8 || this.character.state.isSwimming) {
      this.hydration = Math.min(100, this.hydration + simDt * 4.5);
    } else {
      this.hydration = Math.max(25, this.hydration - simDt * 0.18);
    }

    // Update sliding grass field around player
    const cfg = QUALITY_CONFIGS[this.quality];
    this.world.updateGrass(this.character.state.position.x, this.character.state.position.z, cfg.grassRadius, cfg.grassCount);

    // Update Combat VFX, Crates & Training Totems
    this.combat.update(simDt, this.elapsed);

    // Update Weather, Campfire, Smoke & Particles
    this.weatherVfx.update(
      simDt,
      this.elapsed,
      this.character.state.position,
      this.character.state.moveSpeed,
      this.character.state.isGrounded,
      nightFactor,
      cfg.particleMultiplier,
      inCave,
      this.world.treePositions,
      this.character.state.isSwimming
    );

    // Update Living Wildlife & Insects
    this.wildlife.update(
      simDt,
      this.elapsed,
      this.character.state.position,
      nightFactor,
      this.weatherVfx.weather.rainIntensity
    );

    // Update Remote Online Teammates in 3D World
    this.remotePlayersSystem.update(simDt, this.elapsed, this.activeMapId, this.remotePlayers);

    // Emit local state delta for online sync
    this.callbacks.onLocalStateSync?.(this.getLocalNetState());

    // Sync shared shader uniforms
    this.envUniforms.uTime.value = this.elapsed;
    this.envUniforms.uWindDir.value.copy(this.weatherVfx.weather.windDir);
    this.envUniforms.uWindStrength.value = this.weatherVfx.weather.windStrength;
    this.envUniforms.uRainIntensity.value = this.weatherVfx.weather.rainIntensity;
    this.envUniforms.uRainWetness.value = this.weatherVfx.weather.rainWetness;
    this.envUniforms.uSnowCover.value = this.weatherVfx.weather.snowCover;
    this.envUniforms.uCloudDensity.value = this.weatherVfx.weather.cloudDensity;
    this.envUniforms.uPlayerPos.value.copy(this.character.state.position);

    // Smooth Cinematic Camera Update (uses full dt so shake & crane stay fluid)
    this.updateCamera(dt, this.elapsed, right);
    this.skyDome.position.copy(this.camera.position);

    // Update Real-Time Reflection & Global Illumination Probe (throttled on hardware GL)
    this.updateReflectionProbe(false);

    // Render Scene (Bypass EffectComposer on software WebGL for responsive frame pacing)
    if (this.isSoftwareGl || !cfg.postProcessing) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }

    // Telemetry & FPS calculation (~10Hz update to keep React lightweight)
    this.fpsAccum += rawDt;
    this.fpsFrames++;
    this.telemetryTimer += dt;
    if (this.telemetryTimer >= 0.12) {
      this.telemetryTimer = 0;
      if (this.fpsAccum > 0) {
        this.currentFps = Math.round(this.fpsFrames / this.fpsAccum);
        this.fpsAccum = 0;
        this.fpsFrames = 0;
      }
      const p = this.character.state.position;
      const biome = getDominantBiome(p.x, p.z, p.y);
      const heading = (((-THREE.MathUtils.radToDeg(this.camYaw)) % 360) + 360) % 360;
      this.callbacks.onTelemetry({
        activeMapId: this.activeMapId,
        biomeLabel: biome.label,
        timeHours: this.timeHours,
        weatherLabel: this.weatherVfx.weather.label,
        headingDeg: Math.round(heading),
        elevation: Math.round(p.y * 10) / 10,
        playerX: Math.round(p.x * 10) / 10,
        playerZ: Math.round(p.z * 10) / 10,
        speedMs: Math.round(this.character.state.moveSpeed * 10) / 10,
        health: Math.round(this.health),
        maxHealth: this.maxHealth,
        stamina: Math.round(this.stamina),
        warmth: Math.round(this.warmth),
        hydration: Math.round(this.hydration),
        nearCampfire: nearCamp,
        campfireLit: this.weatherVfx.campfireLit,
        nearWater: waterDist < 3.5,
        isSwimming: this.character.state.isSwimming,
        inCave: inCave > 0.45,
        flashlightOn: this.character.state.flashlightOn,
        fps: this.currentFps,
        isPointerLocked: this.isPointerLocked,
        defeatedCount: this.enemies.getDefeatedCount(),
        activeEnemyTarget: this.entered ? this.enemies.getHudTarget(this.character.state.position) : null,
        playerHitFlash: Number(this.playerHitFlash.toFixed(2)),
        respawnBannerTimer: Number(this.respawnBannerTimer.toFixed(1)),
      });
    }

    // Schedule next frame (Software WebGL afterDraw sync pacing vs native rAF)
    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.renderer?.domElement?.removeEventListener('mousedown', this.onMouseDown);
    this.renderer?.domElement?.removeEventListener('contextmenu', this.onContextMenu);
    this.renderer?.domElement?.removeEventListener('wheel', this.onWheel);
    this.renderer?.domElement?.removeEventListener('pointerdown', this.onCanvasPointerDown);
    this.renderer?.domElement?.removeEventListener('pointermove', this.onCanvasPointerMove);
    this.renderer?.domElement?.removeEventListener('pointerup', this.onCanvasPointerUp);
    this.renderer?.domElement?.removeEventListener('pointercancel', this.onCanvasPointerUp);
    this.renderer?.domElement?.removeEventListener('touchmove', this.onCanvasTouchMovePrevent);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.hasActiveWorldEntities) {
      this.world?.dispose();
      this.wildlife?.dispose();
      this.combat?.dispose();
      this.enemies?.dispose();
      this.hasActiveWorldEntities = false;
    }
    this.remotePlayersSystem?.dispose();
    this.weatherVfx?.dispose();
    this.dynamicEnvRT?.dispose();
    this.cubeRenderTarget?.dispose();
    this.pmremGenerator?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
