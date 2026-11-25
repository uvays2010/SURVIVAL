import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

import {
  QualityPreset,
  QUALITY_CONFIGS,
  WeatherMode,
  CameraMode,
  HudTelemetry,
  LANDMARKS,
  GraphicsFlags,
  getPresetGraphicsFlags,
} from './types';
import { groundHeightAt, getDominantBiome, getCaveProximity, waterDistanceInfo, WATER_LEVEL } from './noise';
import { createProceduralTextures } from './textures';
import { createSharedEnvUniforms, createSkyDomeMaterial } from './materials';
import { buildOpenWorld } from './world';
import { createCharacterSystem } from './character';
import { createWildlifeSystem } from './wildlife';
import { createWeatherAndVfxSystem } from './weatherAndVfx';
import { createCombatSystem, CombatSystem } from './combat';

// Directional Camera-Velocity + Subtle Sprint/Dodge Radial Motion Blur Shader
const MotionBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVelocity: { value: new THREE.Vector2(0, 0) },
    uRadial: { value: 0.0 },
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
    uniform vec2 uVelocity;
    uniform float uRadial;
    varying vec2 vUv;

    void main() {
      vec2 toCenter = vUv - 0.5;
      float edgeMask = smoothstep(0.18, 0.72, length(toCenter));
      vec2 blurVec = uVelocity + toCenter * (uRadial * edgeMask);
      float mag = length(blurVec);
      if (mag < 0.00035) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      vec2 stepVec = blurVec * (min(mag, 0.018) / mag) / 7.0;
      vec4 sum = vec4(0.0);
      for (int i = -3; i <= 3; i++) {
        vec2 sampleUv = clamp(vUv + stepVec * float(i), vec2(0.001), vec2(0.999));
        sum += texture2D(tDiffuse, sampleUv);
      }
      gl_FragColor = sum / 7.0;
    }
  `,
};

// Custom HDR Filmic Grading + Highlight Compression + Subtle Vignette
const CinematicGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uNightFactor: { value: 0.0 },
    uExposure: { value: 1.0 },
    uVignette: { value: 0.26 },
    uWarmth: { value: 0.05 },
    uHdrBoost: { value: 1.0 },
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
    uniform float uNightFactor;
    uniform float uExposure;
    uniform float uVignette;
    uniform float uWarmth;
    uniform float uHdrBoost;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 col = tex.rgb * uExposure;

      // HDR soft-shoulder highlight preservation + local micro-contrast
      if (uHdrBoost > 0.5) {
        col = col * (1.0 + 0.14 * smoothstep(0.35, 1.6, col));
      }

      // Filmic color grading (warm sunset highlights, cool crisp ambient shadows)
      vec3 shadowsTint = mix(vec3(0.96, 0.99, 1.03), vec3(0.84, 0.92, 1.12), uNightFactor);
      vec3 highlightsTint = mix(vec3(1.0 + uWarmth, 1.0, 1.0 - uWarmth * 0.8), vec3(0.92, 0.96, 1.04), uNightFactor);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(shadowsTint, highlightsTint, smoothstep(0.14, 0.85, lum));

      // Gentle vignette framing
      vec2 centered = vUv - 0.5;
      float vig = 1.0 - dot(centered, centered) * uVignette;
      col *= clamp(vig, 0.56, 1.0);

      gl_FragColor = vec4(col, tex.a);
    }
  `,
};

export interface SurvivalEngineCallbacks {
  onTelemetry: (data: HudTelemetry) => void;
  onWebglError: (msg: string) => void;
}

export class SurvivalEngine {
  private container: HTMLElement;
  private callbacks: SurvivalEngineCallbacks;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private ssaoPass!: SSAOPass;
  private bloomPass!: UnrealBloomPass;
  private bokehPass!: BokehPass;
  private motionBlurPass!: ShaderPass;
  private gradePass!: ShaderPass;
  private outputPass!: OutputPass;
  private fxaaPass!: ShaderPass;
  private smaaPass!: SMAAPass;

  private pmremGenerator!: THREE.PMREMGenerator;
  private dynamicEnvRT: THREE.WebGLRenderTarget | null = null;
  private cubeRenderTarget!: THREE.WebGLCubeRenderTarget;
  private cubeCamera!: THREE.CubeCamera;
  private reflectionFrameCounter = 0;

  private isSoftwareGl = false;
  private frameId = 0;
  private disposed = false;
  private clock = new THREE.Clock();
  private elapsed = 0;

  private quality: QualityPreset = 'HIGH';
  private graphicsFlags: GraphicsFlags = getPresetGraphicsFlags('HIGH');
  private cameraMode: CameraMode = 'THIRD_PERSON';
  private timeHours = 17.65; // Dramatic golden-hour sunset start
  private timePaused = false;
  private timeSpeed = 0.06; // ~6.6 mins per full 24h cycle

  private envUniforms = createSharedEnvUniforms();
  private sunLight!: THREE.DirectionalLight;
  private bounceLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private sunGlareSprite!: THREE.Sprite;
  private sunShaftsGroup!: THREE.Group;
  private sunShaftMat!: THREE.ShaderMaterial;
  private fog!: THREE.FogExp2;

  private world!: ReturnType<typeof buildOpenWorld>;
  private character!: ReturnType<typeof createCharacterSystem>;
  private wildlife!: ReturnType<typeof createWildlifeSystem>;
  private weatherVfx!: ReturnType<typeof createWeatherAndVfxSystem>;
  private combat!: CombatSystem;

  // Input & Controls
  private keys = new Set<string>();
  private virtualForward = 0;
  private virtualRight = 0;
  private virtualSprint = false;
  private virtualJumpQueued = false;
  private virtualCrouch = false;
  private lookTouchId: number | null = null;
  private lastTouchX = 0;
  private lastTouchY = 0;
  private lastPinchDist: number | null = null;

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
    this.init();
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

  private init(): void {
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
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.callbacks.onWebglError('Graphics context paused. Restoring...');
    });
    this.container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2(0x9fc2de, 0.0026);
    this.scene.fog = this.fog;

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

    // Procedural Textures
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const textures = createProceduralTextures(maxAniso);

    // Sky Dome + Volumetric Cloud Shader
    const skyMat = createSkyDomeMaterial(this.envUniforms);
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(850, 32, 20), skyMat);
    skyDome.frustumCulled = false;
    this.scene.add(skyDome);

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

    // Open World, Character, Wildlife, Combat & Weather/VFX
    const initCfg = QUALITY_CONFIGS[this.quality];
    this.world = buildOpenWorld(textures, this.envUniforms, initCfg.terrainSegments, initCfg.waterSegments);
    this.scene.add(this.world.root);

    this.character = createCharacterSystem(this.scene, textures);
    this.character.state.yaw = this.camYaw;
    this.character.state.pitch = this.camPitch;
    this.character.group.rotation.y = this.camYaw + Math.PI;

    this.wildlife = createWildlifeSystem(this.scene, textures.softGlowMap, this.world.flowerPositions);
    this.weatherVfx = createWeatherAndVfxSystem(this.scene, textures, this.world.campfirePos);
    this.combat = createCombatSystem(
      this.scene,
      textures,
      this.world.crateAnchors,
      this.world.totemAnchors
    );

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
          float edgeX = sin(vUv.x * 3.14159);
          float beam = pow(edgeX, 2.2) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.15, vUv.y);
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

    // HDR HalfFloat Post-Processing Pipeline:
    // Render -> SSAO -> HDR Bloom -> Bokeh DoF -> Motion Blur -> Filmic Grade -> Output(ACES) -> FXAA/SMAA
    const hdrRenderTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
    });
    this.composer = new EffectComposer(this.renderer, hdrRenderTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.ssaoPass = new SSAOPass(this.scene, this.camera, w, h);
    this.ssaoPass.kernelRadius = 11;
    this.ssaoPass.minDistance = 0.004;
    this.ssaoPass.maxDistance = 0.14;
    this.ssaoPass.output = SSAOPass.OUTPUT.Default;
    this.composer.addPass(this.ssaoPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.36, 0.52, 0.85);
    this.composer.addPass(this.bloomPass);

    this.bokehPass = new BokehPass(this.scene, this.camera, {
      focus: 5.0,
      aspect: w / h,
      aperture: 0.00018,
      maxblur: 0.0065,
    });
    this.composer.addPass(this.bokehPass);

    this.motionBlurPass = new ShaderPass(MotionBlurShader);
    this.composer.addPass(this.motionBlurPass);

    this.gradePass = new ShaderPass(CinematicGradeShader);
    this.composer.addPass(this.gradePass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.fxaaPass = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaaPass);

    this.smaaPass = new SMAAPass();
    this.composer.addPass(this.smaaPass);

    this.applyQualityPreset(this.quality, true);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
      this.updateReflectionProbe(true);
    }

    this.bindEvents();
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
    dom.addEventListener('touchstart', this.onTouchStart, { passive: false });
    dom.addEventListener('touchmove', this.onTouchMove, { passive: false });
    dom.addEventListener('touchend', this.onTouchEnd, { passive: false });
    dom.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  private onTouchStart = (e: TouchEvent): void => {
    if (e.cancelable) e.preventDefault();
    this.introTimer = 0;
    if (e.touches.length === 2) {
      this.lookTouchId = null;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      this.lastPinchDist = Math.hypot(dx, dy);
      return;
    }
    if (this.lookTouchId === null && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      this.lookTouchId = t.identifier;
      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (e.cancelable) e.preventDefault();
    if (e.touches.length === 2 && this.cameraMode === 'THIRD_PERSON') {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (this.lastPinchDist !== null) {
        const delta = this.lastPinchDist - dist;
        this.camDist = THREE.MathUtils.clamp(this.camDist + delta * 0.02, 2.6, 11.5);
      }
      this.lastPinchDist = dist;
      return;
    }
    if (this.lookTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.lookTouchId) {
        const dx = t.clientX - this.lastTouchX;
        const dy = t.clientY - this.lastTouchY;
        this.lastTouchX = t.clientX;
        this.lastTouchY = t.clientY;
        const sens = 0.0046;
        this.camYaw -= dx * sens;
        this.camPitch = THREE.MathUtils.clamp(this.camPitch - dy * sens, -1.15, 0.85);
        this.character.state.yaw = this.camYaw;
        this.character.state.pitch = this.camPitch;
        break;
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length < 2) {
      this.lastPinchDist = null;
    }
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.lookTouchId) {
        this.lookTouchId = null;
      }
    }
    if (this.lookTouchId === null && e.touches.length === 1) {
      this.lookTouchId = e.touches[0].identifier;
      this.lastTouchX = e.touches[0].clientX;
      this.lastTouchY = e.touches[0].clientY;
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
    this.fxaaPass.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
    this.smaaPass.setSize(w * pr, h * pr);
    this.ssaoPass.setSize(w, h);
    this.bloomPass.resolution.set(w, h);
    (this.bokehPass.uniforms as Record<string, THREE.IUniform>)['aspect'].value = w / h;
  };

  private onPointerLockChange = (): void => {
    this.isPointerLocked = document.pointerLockElement === this.renderer.domElement;
  };

  private onMouseDown = (e: MouseEvent): void => {
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
    if (!this.isPointerLocked && this.cameraMode !== 'CINEMATIC_ORBIT') {
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
    if (!this.isPointerLocked && !this.isDragging) return;
    const dx = this.isPointerLocked ? e.movementX : e.clientX - this.lastMouseX;
    const dy = this.isPointerLocked ? e.movementY : e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    const sens = 0.0024;
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
    this.applyQualityPreset(preset, false);
  }

  public getGraphicsFlags(): GraphicsFlags {
    return { ...this.graphicsFlags };
  }

  public setGraphicsFlags(partial: Partial<GraphicsFlags>): GraphicsFlags {
    this.graphicsFlags = { ...this.graphicsFlags, ...partial };
    this.syncPostProcessingFlags();
    return { ...this.graphicsFlags };
  }

  private syncPostProcessingFlags(): void {
    const cfg = QUALITY_CONFIGS[this.quality];
    const postOn = !this.isSoftwareGl && cfg.postProcessing;

    this.ssaoPass.enabled = postOn && this.graphicsFlags.giAndAo;
    this.bloomPass.enabled = cfg.bloomEnabled || (postOn && this.graphicsFlags.hdr);
    this.bokehPass.enabled = postOn && this.graphicsFlags.dof;
    this.motionBlurPass.enabled = postOn && this.graphicsFlags.motionBlur;
    this.gradePass.enabled = cfg.gradeEnabled || (postOn && this.graphicsFlags.hdr);
    this.gradePass.uniforms.uHdrBoost.value = this.graphicsFlags.hdr ? 1.0 : 0.0;
    this.bloomPass.threshold = this.graphicsFlags.hdr ? 0.84 : 0.92;
    this.bloomPass.strength = this.graphicsFlags.hdr ? 0.38 : 0.24;

    this.fxaaPass.enabled = postOn && this.graphicsFlags.antiAliasing === 'FXAA';
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
    if (!force && this.reflectionFrameCounter % 10 !== 0) return;

    const p = this.character.state.position;
    this.cubeCamera.position.set(p.x, Math.max(WATER_LEVEL + 1.8, p.y + 1.4), p.z);

    // Hide character, water plane, and sun flare sprite so probe reflects clean world sky/terrain/cabins
    const prevCharVis = this.character.group.visible;
    const prevWaterVis = this.world.waterMesh.visible;
    const prevGlareVis = this.sunGlareSprite.visible;
    this.character.group.visible = false;
    this.world.waterMesh.visible = false;
    this.sunGlareSprite.visible = false;

    this.cubeCamera.update(this.renderer, this.scene);

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

    this.camera.far = cfg.fogFar * 1.9;
    this.camera.updateProjectionMatrix();

    if (!isInitial && (prev.terrainSegments !== cfg.terrainSegments || prev.waterSegments !== cfg.waterSegments)) {
      this.world.rebuildTerrainAndWater(cfg.terrainSegments, cfg.waterSegments);
    }
    this.onResize();
  }

  public setWeatherMode(mode: WeatherMode): void {
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

  public toggleFlashlight(): boolean {
    this.character.state.flashlightOn = !this.character.state.flashlightOn;
    return this.character.state.flashlightOn;
  }

  public toggleAudio(): boolean {
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

  public teleportToLandmark(id: string): void {
    const lm = LANDMARKS.find((l) => l.id === id);
    if (!lm) return;
    this.introTimer = 0;
    this.character.setPosition(lm.x, lm.z, lm.yaw);
    this.camYaw = lm.yaw;
    this.camPitch = -0.14;
    const cfg = QUALITY_CONFIGS[this.quality];
    this.world.updateGrass(lm.x, lm.z, cfg.grassRadius, cfg.grassCount);
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

    if (this.introTimer > 0) {
      this.introTimer = Math.max(0, this.introTimer - dt);
    }
    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.9);

    // Dynamic FOV punch (Sprint, Dodge Dash, Heavy Cleave, Intro Crane)
    let targetFov = isFP ? 66 : 60;
    if (this.introTimer > 0) targetFov = 67;
    else if (char.dodgeTimer > 0) targetFov = 74;
    else if (char.attackTimer > 0 && char.isHeavyAttack) targetFov = 66;
    else if (char.isSprinting) targetFov = 70;

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

    const floorCam = groundHeightAt(this._camDesired.x, this._camDesired.z) + 0.55;
    if (this._camDesired.y < floorCam) {
      this._camDesired.y = floorCam;
    }

    const followRate = this.introTimer > 0 ? 3.2 : 12.5;
    this.smoothCamPos.lerp(this._camDesired, 1 - Math.exp(-followRate * dt));
    this.smoothCamLook.lerp(this._camTarget, 1 - Math.exp(-15 * dt));

    const postFloor = groundHeightAt(this.smoothCamPos.x, this.smoothCamPos.z) + 0.45;
    if (this.smoothCamPos.y < postFloor) this.smoothCamPos.y = postFloor;

    this.camera.position.copy(this.smoothCamPos);
    this.camera.position.x += shakeX;
    this.camera.position.y += shakeY;
    this.camera.lookAt(this.smoothCamLook);
    this.camera.rotation.z += this.camRoll * 0.7;
  }

  private tick = (): void => {
    if (this.disposed) return;

    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.05, Math.max(0.001, rawDt));

    // Hit-stop micro-freeze on solid melee impact (camera shake still ticks smoothly)
    let simDt = dt;
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
      simDt = dt * 0.08;
    }
    this.elapsed += simDt;

    // Input aggregation (Keyboard + Mobile Virtual Thumbstick)
    let forward = this.virtualForward;
    let right = this.virtualRight;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;
    forward = THREE.MathUtils.clamp(forward, -1, 1);
    right = THREE.MathUtils.clamp(right, -1, 1);

    const wantJump = this.keys.has('Space') || this.virtualJumpQueued;
    this.virtualJumpQueued = false;
    const wantSprint =
      (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.virtualSprint) && this.stamina > 5;
    const wantCrouch = this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.virtualCrouch;

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
          this.wildlife.checkMeleeHit
        );
        if (res.hit) {
          this.hitStopTimer = res.hitStop;
          this.cameraTrauma = Math.min(1, this.cameraTrauma + res.shake);
        }
      }
    }

    // Survival vitals dynamics
    if (this.character.state.isSprinting && this.character.state.moveSpeed > 5.5) {
      this.stamina = Math.max(0, this.stamina - simDt * 14);
    } else {
      this.stamina = Math.min(100, this.stamina + simDt * 11);
    }

    const nearCamp = this.character.state.position.distanceTo(this.world.campfirePos) < 6.5;
    const targetWarmth =
      nearCamp && this.weatherVfx.campfireLit
        ? 98
        : 76 - nightFactor * 16 - this.weatherVfx.weather.snowIntensity * 22 - Math.max(0, this.character.state.position.y - 18) * 0.7;
    this.warmth = THREE.MathUtils.damp(this.warmth, THREE.MathUtils.clamp(targetWarmth, 18, 100), 0.15, simDt);

    const { dist: waterDist } = waterDistanceInfo(this.character.state.position.x, this.character.state.position.z);
    if (waterDist < 0.8) {
      this.hydration = Math.min(100, this.hydration + simDt * 3);
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
      this.world.treePositions
    );

    // Update Living Wildlife & Insects
    this.wildlife.update(
      simDt,
      this.elapsed,
      this.character.state.position,
      nightFactor,
      this.weatherVfx.weather.rainIntensity
    );

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

    // Update Real-Time Motion Blur & Dynamic Depth-of-Field Focus
    const dYaw = (this.camYaw - this.prevCamYaw) / Math.max(0.008, dt);
    const dPitch = (this.camPitch - this.prevCamPitch) / Math.max(0.008, dt);
    this.prevCamYaw = this.camYaw;
    this.prevCamPitch = this.camPitch;
    const charState = this.character.state;
    const dodgeRadial = charState.dodgeTimer > 0 ? 0.024 : charState.isSprinting ? 0.011 : 0.0;
    this.motionBlurPass.uniforms.uVelocity.value.set(
      THREE.MathUtils.clamp(-dYaw * 0.0022, -0.015, 0.015),
      THREE.MathUtils.clamp(dPitch * 0.0022, -0.015, 0.015)
    );
    this.motionBlurPass.uniforms.uRadial.value = THREE.MathUtils.damp(
      this.motionBlurPass.uniforms.uRadial.value,
      dodgeRadial,
      12,
      dt
    );

    const focusDist =
      this.cameraMode === 'THIRD_PERSON'
        ? this.camDist
        : this.cameraMode === 'CINEMATIC_ORBIT'
        ? this.camera.position.distanceTo(charState.position)
        : 18.0;
    (this.bokehPass.uniforms as Record<string, THREE.IUniform>)['focus'].value = THREE.MathUtils.damp(
      (this.bokehPass.uniforms as Record<string, THREE.IUniform>)['focus'].value,
      focusDist,
      10,
      dt
    );

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
        biomeLabel: biome.label,
        timeHours: this.timeHours,
        weatherLabel: this.weatherVfx.weather.label,
        headingDeg: Math.round(heading),
        elevation: Math.round(p.y * 10) / 10,
        speedMs: Math.round(this.character.state.moveSpeed * 10) / 10,
        stamina: Math.round(this.stamina),
        warmth: Math.round(this.warmth),
        hydration: Math.round(this.hydration),
        nearCampfire: nearCamp,
        campfireLit: this.weatherVfx.campfireLit,
        nearWater: waterDist < 3.5,
        inCave: inCave > 0.45,
        flashlightOn: this.character.state.flashlightOn,
        fps: this.currentFps,
        isPointerLocked: this.isPointerLocked,
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
    this.renderer?.domElement?.removeEventListener('touchstart', this.onTouchStart);
    this.renderer?.domElement?.removeEventListener('touchmove', this.onTouchMove);
    this.renderer?.domElement?.removeEventListener('touchend', this.onTouchEnd);
    this.renderer?.domElement?.removeEventListener('touchcancel', this.onTouchEnd);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);

    this.combat?.dispose();
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
