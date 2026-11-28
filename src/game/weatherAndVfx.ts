import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';
import { WeatherMode } from './types';
import { groundHeightAt, waterDistanceInfo } from './noise';

export interface WeatherState {
  mode: WeatherMode;
  rainIntensity: number;
  rainWetness: number;
  snowIntensity: number;
  snowCover: number;
  fogDensityMult: number;
  cloudDensity: number;
  windStrength: number;
  windDir: THREE.Vector2;
  lightningFlash: number;
  label: string;
}

export interface WeatherVfxSystem {
  weather: WeatherState;
  campfireLit: boolean;
  setWeatherMode: (mode: WeatherMode) => void;
  setCampfireLit: (lit: boolean) => void;
  toggleCampfire: () => void;
  setCampfirePos: (pos: THREE.Vector3) => void;
  toggleAudio: () => boolean;
  isAudioEnabled: () => boolean;
  update: (
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    playerMoveSpeed: number,
    isGrounded: boolean,
    nightFactor: number,
    particleMult: number,
    inCave: number,
    treePositions: { x: number; y: number; z: number }[],
    isSwimming: boolean,
    sharedClockMs?: number
  ) => void;
  dispose: () => void;
}

export function createWeatherAndVfxSystem(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
  campfirePos: THREE.Vector3
): WeatherVfxSystem {
  const weather: WeatherState = {
    mode: 'DYNAMIC',
    rainIntensity: 0,
    rainWetness: 0,
    snowIntensity: 0,
    snowCover: 0,
    fogDensityMult: 1,
    cloudDensity: 0.42,
    windStrength: 1.0,
    windDir: new THREE.Vector2(0.84, 0.54).normalize(),
    lightningFlash: 0,
    label: 'Clear Breeze',
  };

  let campfireLit = true;
  let dynamicTarget: 'CLEAR' | 'FOGGY' | 'RAIN' | 'STORM' | 'SNOW' = 'CLEAR';
  let lastStormBoltIdx = -1;

  // --- 1. EXTREME CAMPFIRE (Independent Tongues + Glow + Sparks + Smoke) ---
  const fireGroup = new THREE.Group();
  fireGroup.position.copy(campfirePos).add(new THREE.Vector3(0, 0.12, 0));
  scene.add(fireGroup);

  const fireLight = new THREE.PointLight(0xff7b29, 8.5, 28, 1.5);
  fireLight.position.set(0, 1.15, 0);
  fireLight.castShadow = false; // Keep shadow casters <= 3 (Sun + Flashlight)
  fireGroup.add(fireLight);

  const flameMeshes: { mesh: THREE.Mesh; speed: number; phase: number; baseScale: number; offset: THREE.Vector3 }[] = [];
  const flameColors = [0xff4500, 0xff8c1a, 0xffc83d, 0xfff0a8, 0xff5a1f];
  for (let i = 0; i < 9; i++) {
    const fMat = new THREE.MeshBasicMaterial({
      map: textures.softGlowMap,
      color: flameColors[i % flameColors.length],
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const fGeo = new THREE.PlaneGeometry(0.42 + (i % 3) * 0.14, 0.85 + (i % 4) * 0.18);
    fGeo.translate(0, 0.38, 0);
    const mesh = new THREE.Mesh(fGeo, fMat);
    const ang = (i / 9) * Math.PI * 2;
    const rad = i === 0 ? 0 : 0.14 + (i % 3) * 0.08;
    const off = new THREE.Vector3(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
    mesh.position.copy(off);
    mesh.rotation.y = ang;
    fireGroup.add(mesh);
    flameMeshes.push({
      mesh,
      speed: 7 + (i % 5) * 2.1,
      phase: i * 1.7,
      baseScale: 0.75 + (i % 3) * 0.22,
      offset: off,
    });
  }

  // Rising Fire Sparks & Embers
  const SPARK_COUNT = 75;
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  const sparkVel = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);
  for (let i = 0; i < SPARK_COUNT; i++) {
    sparkLife[i] = Math.random();
    sparkPos[i * 3] = campfirePos.x;
    sparkPos[i * 3 + 1] = campfirePos.y + 0.3;
    sparkPos[i * 3 + 2] = campfirePos.z;
    sparkVel[i * 3] = (Math.random() - 0.5) * 0.6;
    sparkVel[i * 3 + 1] = 1.2 + Math.random() * 1.8;
    sparkVel[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({
    map: textures.softGlowMap,
    color: 0xff9a3b,
    size: 0.18,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sparksPoints = new THREE.Points(sparkGeo, sparkMat);
  scene.add(sparksPoints);

  // Volumetric-style Curling Campfire Smoke Sprites
  const smokePuffs: { sprite: THREE.Sprite; age: number; maxAge: number; vx: number; vz: number }[] = [];
  for (let i = 0; i < 24; i++) {
    const sMat = new THREE.SpriteMaterial({
      map: textures.smokePuffMap,
      color: 0xbec4cc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const sp = new THREE.Sprite(sMat);
    sp.position.copy(campfirePos).add(new THREE.Vector3(0, 0.8 + i * 0.3, 0));
    scene.add(sp);
    smokePuffs.push({
      sprite: sp,
      age: (i / 24) * 5.0,
      maxAge: 5.0,
      vx: (Math.random() - 0.5) * 0.25,
      vz: (Math.random() - 0.5) * 0.25,
    });
  }

  // --- 2. WATERFALL PLUNGE SPRAY & MIST ---
  const WF_SPRAY = 140;
  const wfPos = new Float32Array(WF_SPRAY * 3);
  const wfVel = new Float32Array(WF_SPRAY * 3);
  const wfAge = new Float32Array(WF_SPRAY);
  for (let i = 0; i < WF_SPRAY; i++) {
    wfAge[i] = Math.random();
    wfPos[i * 3] = 20 + (Math.random() - 0.5) * 12;
    wfPos[i * 3 + 1] = 0.2 + Math.random() * 4;
    wfPos[i * 3 + 2] = -132 + (Math.random() - 0.5) * 8;
  }
  const wfGeo = new THREE.BufferGeometry();
  wfGeo.setAttribute('position', new THREE.BufferAttribute(wfPos, 3));
  const wfMat = new THREE.PointsMaterial({
    map: textures.smokePuffMap,
    color: 0xe6f2f8,
    size: 2.2,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const wfPoints = new THREE.Points(wfGeo, wfMat);
  scene.add(wfPoints);

  // --- 3. RAIN STREAKS SYSTEM (LineSegments around player) ---
  const MAX_RAIN = 1800;
  const rainPos = new Float32Array(MAX_RAIN * 6);
  const rainSeeds = new Float32Array(MAX_RAIN * 3);
  for (let i = 0; i < MAX_RAIN; i++) {
    rainSeeds[i * 3] = (Math.random() - 0.5) * 64;
    rainSeeds[i * 3 + 1] = Math.random() * 28;
    rainSeeds[i * 3 + 2] = (Math.random() - 0.5) * 64;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xc2d5e6,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  const rainLines = new THREE.LineSegments(rainGeo, rainMat);
  rainLines.frustumCulled = false;
  scene.add(rainLines);

  // --- 4. EXTREME SNOWFLAKES SYSTEM ---
  const MAX_SNOW = 1600;
  const snowPos = new Float32Array(MAX_SNOW * 3);
  const snowSeeds = new Float32Array(MAX_SNOW * 3);
  for (let i = 0; i < MAX_SNOW; i++) {
    snowSeeds[i * 3] = (Math.random() - 0.5) * 76;
    snowSeeds[i * 3 + 1] = Math.random() * 30;
    snowSeeds[i * 3 + 2] = (Math.random() - 0.5) * 76;
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snowMat = new THREE.PointsMaterial({
    map: textures.snowflakeMap,
    color: 0xf4f8ff,
    size: 0.36,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  const snowPoints = new THREE.Points(snowGeo, snowMat);
  snowPoints.frustumCulled = false;
  scene.add(snowPoints);

  // --- 5. FALLING LEAVES & SUNLIGHT DUST MOTES ---
  const MAX_LEAVES = 90;
  const leafGeo = new THREE.PlaneGeometry(0.18, 0.12);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x7d8a3c,
    roughness: 0.75,
    side: THREE.DoubleSide,
  });
  const leafInst = new THREE.InstancedMesh(leafGeo, leafMat, MAX_LEAVES);
  leafInst.frustumCulled = false;
  scene.add(leafInst);
  const leafState = Array.from({ length: MAX_LEAVES }, () => ({
    x: (Math.random() - 0.5) * 70,
    y: 5 + Math.random() * 12,
    z: (Math.random() - 0.5) * 70,
    vy: 0.7 + Math.random() * 0.7,
    phase: Math.random() * 10,
    settled: 0,
  }));

  const DUST_COUNT = 240;
  const dustPos = new Float32Array(DUST_COUNT * 3);
  const dustSeeds = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    dustSeeds[i * 3] = (Math.random() - 0.5) * 38;
    dustSeeds[i * 3 + 1] = 0.5 + Math.random() * 6;
    dustSeeds[i * 3 + 2] = (Math.random() - 0.5) * 38;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    map: textures.softGlowMap,
    color: 0xfff3d4,
    size: 0.14,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dustPoints = new THREE.Points(dustGeo, dustMat);
  dustPoints.frustumCulled = false;
  scene.add(dustPoints);

  // --- 5B. ARCANE SPIRIT WISPS & FLOATING MAGIC ORBS (Echo Cavern Pool + Training Totems) ---
  const MAGIC_COUNT = 72;
  const magicPos = new Float32Array(MAGIC_COUNT * 3);
  const magicCol = new Float32Array(MAGIC_COUNT * 3);
  const magicAnchors = [
    { x: -135.5, y: groundHeightAt(-135.5, -129.5) + 0.5, z: -129.5, radius: 5.5, kind: 0 }, // Cavern mineral pool (cyan/emerald)
    { x: campfirePos.x + 5.8, y: groundHeightAt(campfirePos.x + 5.8, campfirePos.z + 2.4) + 1.2, z: campfirePos.z + 2.4, radius: 2.2, kind: 1 }, // Camp totem (amber/gold)
    { x: 91, y: groundHeightAt(91, 22) + 1.2, z: 22, radius: 2.2, kind: 1 }, // Village totem
    { x: 20, y: 1.4, z: -124, radius: 8.5, kind: 2 }, // Cascade Falls mist runes (aqua/pearl)
  ];
  const magicGeo = new THREE.BufferGeometry();
  magicGeo.setAttribute('position', new THREE.BufferAttribute(magicPos, 3));
  magicGeo.setAttribute('color', new THREE.BufferAttribute(magicCol, 3));
  const magicMat = new THREE.PointsMaterial({
    map: textures.softGlowMap,
    size: 0.48,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
  });
  const magicPoints = new THREE.Points(magicGeo, magicMat);
  magicPoints.frustumCulled = false;
  scene.add(magicPoints);

  // --- 6. VALLEY / LAKE MORNING GROUND MIST LAYER ---
  const mistSprites: { sprite: THREE.Sprite; bx: number; bz: number; speed: number }[] = [];
  const mistMat = new THREE.SpriteMaterial({
    map: textures.smokePuffMap,
    color: 0xd4e2ec,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  });
  const mistCoords = [
    [-22, 34], [-40, 22], [12, -10], [18, -118], [-95, 125], [-115, 145], [55, 25], [-55, -20],
  ];
  mistCoords.forEach(([mx, mz], idx) => {
    const sp = new THREE.Sprite(mistMat);
    const y = Math.max(0.5, groundHeightAt(mx, mz)) + 2.5;
    sp.position.set(mx, y, mz);
    sp.scale.set(34 + idx * 3, 9, 1);
    scene.add(sp);
    mistSprites.push({ sprite: sp, bx: mx, bz: mz, speed: 0.35 + (idx % 3) * 0.15 });
  });

  // --- 7. PROCEDURAL WEB AUDIO AMBIENT SOUNDSCAPE ---
  let audioCtx: AudioContext | null = null;
  let audioEnabled = false;
  let windGain: GainNode | null = null;
  let waterGain: GainNode | null = null;
  let rainGain: GainNode | null = null;
  let fireGain: GainNode | null = null;
  let stepAccum = 0;

  const initAudio = () => {
    if (audioCtx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctx();

    // Create 3-second looping pink/brown noise buffer
    const len = audioCtx.sampleRate * 3;
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.04 * white) / 1.04;
      lastOut = data[i];
      data[i] *= 2.5;
    }

    const makeChannel = (filterFreq: number, q: number, initGain: number) => {
      const src = audioCtx!.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = audioCtx!.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = filterFreq;
      filter.Q.value = q;
      const gain = audioCtx!.createGain();
      gain.gain.value = initGain;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx!.destination);
      src.start();
      return gain;
    };

    windGain = makeChannel(340, 0.9, 0.06);
    waterGain = makeChannel(620, 0.45, 0.0);
    rainGain = makeChannel(1450, 0.35, 0.0);
    fireGain = makeChannel(920, 1.4, 0.0);
  };

  const toggleAudio = (): boolean => {
    if (!audioCtx) initAudio();
    audioEnabled = !audioEnabled;
    if (audioCtx && audioCtx.state === 'suspended' && audioEnabled) {
      audioCtx.resume();
    }
    if (!audioEnabled && audioCtx) {
      if (windGain) windGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
      if (waterGain) waterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
      if (rainGain) rainGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
      if (fireGain) fireGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
    }
    return audioEnabled;
  };

  const playFootstep = (inWater: boolean) => {
    if (!audioEnabled || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(inWater ? 240 : 115 + Math.random() * 25, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(42, audioCtx.currentTime + 0.09);
    g.gain.setValueAtTime(inWater ? 0.08 : 0.055, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.11);
  };

  const _leafDummy = new THREE.Object3D();

  const setWeatherMode = (mode: WeatherMode) => {
    weather.mode = mode;
    if (mode !== 'DYNAMIC') {
      dynamicTarget = mode;
    }
  };

  const setCampfireLit = (lit: boolean) => {
    campfireLit = lit;
  };

  const toggleCampfire = () => {
    campfireLit = !campfireLit;
  };

  const update = (
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    playerMoveSpeed: number,
    isGrounded: boolean,
    nightFactor: number,
    particleMult: number,
    inCave: number,
    treePositions: { x: number; y: number; z: number }[],
    isSwimming: boolean,
    sharedClockMs?: number
  ) => {
    const clockMs = sharedClockMs ?? Date.now();
    const sharedSec = clockMs / 1000;

    // Deterministic Shared Dynamic Weather State Machine (identical across all online peers)
    if (weather.mode === 'DYNAMIC') {
      const cycle: ('CLEAR' | 'FOGGY' | 'RAIN' | 'STORM' | 'SNOW')[] = ['CLEAR', 'FOGGY', 'RAIN', 'STORM', 'CLEAR', 'SNOW'];
      const slot = Math.floor(sharedSec / 38) % cycle.length;
      dynamicTarget = cycle[slot];
    } else {
      dynamicTarget = weather.mode;
    }

    const activeState = dynamicTarget;
    const targetRain = activeState === 'RAIN' ? 0.65 : activeState === 'STORM' ? 1.0 : 0.0;
    const targetSnow = activeState === 'SNOW' ? 0.92 : playerPos.y > 23 ? 0.45 : 0.0;
    const targetFog = activeState === 'FOGGY' ? 2.4 : activeState === 'STORM' ? 1.75 : activeState === 'RAIN' ? 1.45 : activeState === 'SNOW' ? 1.6 : 1.0;
    const targetCloud = activeState === 'CLEAR' ? 0.34 : activeState === 'FOGGY' ? 0.68 : activeState === 'SNOW' ? 0.78 : 0.88;
    const targetWind = activeState === 'STORM' ? 2.25 : activeState === 'RAIN' ? 1.45 : activeState === 'SNOW' ? 1.35 : 0.85 + Math.sin(sharedSec * 0.14) * 0.3;

    // Gradual realistic transitions (never instant snap)
    weather.rainIntensity = THREE.MathUtils.damp(weather.rainIntensity, targetRain, 0.55, dt);
    weather.rainWetness = THREE.MathUtils.damp(weather.rainWetness, targetRain > 0.1 ? 1.0 : 0.0, targetRain > 0.1 ? 0.35 : 0.12, dt);
    weather.snowIntensity = THREE.MathUtils.damp(weather.snowIntensity, targetSnow, 0.5, dt);
    weather.snowCover = THREE.MathUtils.damp(weather.snowCover, activeState === 'SNOW' ? 0.82 : 0.0, 0.15, dt);
    weather.fogDensityMult = THREE.MathUtils.damp(weather.fogDensityMult, targetFog, 0.6, dt);
    weather.cloudDensity = THREE.MathUtils.damp(weather.cloudDensity, targetCloud, 0.5, dt);
    weather.windStrength = THREE.MathUtils.damp(weather.windStrength, targetWind, 0.8, dt);

    const windAngle = 0.58 + Math.sin(sharedSec * 0.05) * 0.35;
    weather.windDir.set(Math.cos(windAngle), Math.sin(windAngle)).normalize();

    const boltIdx = Math.floor(sharedSec / 6.5);
    if (activeState === 'STORM') {
      if (boltIdx !== lastStormBoltIdx) {
        lastStormBoltIdx = boltIdx;
        if ((boltIdx * 7 + 3) % 5 < 3) {
          weather.lightningFlash = 1.0;
        }
      }
    } else {
      lastStormBoltIdx = boltIdx;
    }
    weather.lightningFlash = THREE.MathUtils.damp(weather.lightningFlash, 0, 8, dt);

    weather.label =
      activeState === 'STORM'
        ? 'Thunderstorm'
        : activeState === 'RAIN'
        ? 'Steady Rain'
        : activeState === 'SNOW'
        ? 'Alpine Snowfall'
        : activeState === 'FOGGY'
        ? 'Dense Valley Mist'
        : 'Clear Breeze';

    // 1. Update Campfire Flames, Sparks & Smoke
    fireGroup.visible = campfireLit;
    sparksPoints.visible = campfireLit;
    if (campfireLit) {
      const flicker = 0.82 + Math.sin(elapsed * 19.3) * 0.11 + Math.sin(elapsed * 31.7) * 0.07;
      fireLight.intensity = 9.5 * flicker;
      fireLight.position.x = weather.windDir.x * 0.14 * weather.windStrength + Math.sin(elapsed * 15) * 0.04;
      fireLight.position.z = weather.windDir.y * 0.14 * weather.windStrength + Math.cos(elapsed * 13) * 0.04;

      for (const fl of flameMeshes) {
        const sY = fl.baseScale * (0.8 + 0.36 * Math.sin(elapsed * fl.speed + fl.phase));
        const sX = fl.baseScale * (0.85 + 0.2 * Math.cos(elapsed * (fl.speed * 0.8) + fl.phase));
        fl.mesh.scale.set(sX, sY, 1);
        fl.mesh.rotation.z = -weather.windDir.x * 0.28 * weather.windStrength + Math.sin(elapsed * 8 + fl.phase) * 0.12;
      }

      const spAttr = sparkGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < SPARK_COUNT; i++) {
        sparkLife[i] += dt * (0.65 + (i % 5) * 0.12);
        if (sparkLife[i] >= 1) {
          sparkLife[i] = 0;
          sparkPos[i * 3] = campfirePos.x + (Math.random() - 0.5) * 0.45;
          sparkPos[i * 3 + 1] = campfirePos.y + 0.25;
          sparkPos[i * 3 + 2] = campfirePos.z + (Math.random() - 0.5) * 0.45;
        } else {
          sparkPos[i * 3] += (sparkVel[i * 3] + weather.windDir.x * weather.windStrength * 0.8) * dt;
          sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
          sparkPos[i * 3 + 2] += (sparkVel[i * 3 + 2] + weather.windDir.y * weather.windStrength * 0.8) * dt;
        }
        spAttr.setXYZ(i, sparkPos[i * 3], sparkPos[i * 3 + 1], sparkPos[i * 3 + 2]);
      }
      spAttr.needsUpdate = true;
    } else {
      fireLight.intensity = 0;
    }

    for (const p of smokePuffs) {
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.age = 0;
        p.sprite.position.set(
          campfirePos.x + (Math.random() - 0.5) * 0.25,
          campfirePos.y + 0.55,
          campfirePos.z + (Math.random() - 0.5) * 0.25
        );
      }
      if (!campfireLit && p.age < 0.2) {
        p.sprite.material.opacity = 0;
        continue;
      }
      const t = p.age / p.maxAge;
      p.sprite.position.x += (p.vx + weather.windDir.x * weather.windStrength * 1.15) * dt;
      p.sprite.position.y += (1.15 - t * 0.35) * dt;
      p.sprite.position.z += (p.vz + weather.windDir.y * weather.windStrength * 1.15) * dt;
      const sz = 0.72 + t * 3.5;
      p.sprite.scale.set(sz, sz, 1);
      p.sprite.material.opacity = (campfireLit ? 0.38 : 0.09) * Math.sin(t * Math.PI);
    }

    // 2. Waterfall Plunge Spray
    const wfAttr = wfGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < WF_SPRAY; i++) {
      wfAge[i] += dt * 0.9;
      if (wfAge[i] >= 1) {
        wfAge[i] = 0;
        wfPos[i * 3] = 20 + (Math.random() - 0.5) * 12;
        wfPos[i * 3 + 1] = 0.2 + Math.random() * 1.5;
        wfPos[i * 3 + 2] = -134 + Math.random() * 6;
        wfVel[i * 3] = (Math.random() - 0.5) * 2.5;
        wfVel[i * 3 + 1] = 2.5 + Math.random() * 3.2;
        wfVel[i * 3 + 2] = 2.0 + Math.random() * 3.0;
      } else {
        wfVel[i * 3 + 1] -= 4.2 * dt;
        wfPos[i * 3] += (wfVel[i * 3] + weather.windDir.x * 1.2) * dt;
        wfPos[i * 3 + 1] += wfVel[i * 3 + 1] * dt;
        wfPos[i * 3 + 2] += (wfVel[i * 3 + 2] + weather.windDir.y * 1.2) * dt;
      }
      wfAttr.setXYZ(i, wfPos[i * 3], wfPos[i * 3 + 1], wfPos[i * 3 + 2]);
    }
    wfAttr.needsUpdate = true;

    // 3. Rain Streaks (suppress inside deep cavern)
    const outdoorExposure = 1 - inCave;
    const activeRainCount = Math.floor(MAX_RAIN * Math.min(1, particleMult) * (weather.rainIntensity > 0.02 ? 1 : 0));
    rainLines.visible = activeRainCount > 0 && outdoorExposure > 0.1;
    rainMat.opacity = weather.rainIntensity * 0.42 * outdoorExposure;
    if (rainLines.visible) {
      const rAttr = rainGeo.attributes.position as THREE.BufferAttribute;
      const fallSpd = 24 + weather.rainIntensity * 12;
      const tiltX = weather.windDir.x * weather.windStrength * 0.42;
      const tiltZ = weather.windDir.y * weather.windStrength * 0.42;
      for (let i = 0; i < MAX_RAIN; i++) {
        if (i >= activeRainCount) {
          rAttr.setXYZ(i * 2, 0, -999, 0);
          rAttr.setXYZ(i * 2 + 1, 0, -999, 0);
          continue;
        }
        rainSeeds[i * 3 + 1] -= fallSpd * dt;
        if (rainSeeds[i * 3 + 1] < -2) {
          rainSeeds[i * 3 + 1] = 24 + Math.random() * 6;
          rainSeeds[i * 3] = (Math.random() - 0.5) * 62;
          rainSeeds[i * 3 + 2] = (Math.random() - 0.5) * 62;
        }
        const x = playerPos.x + rainSeeds[i * 3];
        const y = playerPos.y + rainSeeds[i * 3 + 1];
        const z = playerPos.z + rainSeeds[i * 3 + 2];
        rAttr.setXYZ(i * 2, x, y, z);
        rAttr.setXYZ(i * 2 + 1, x - tiltX, y + 0.85, z - tiltZ);
      }
      rAttr.needsUpdate = true;
    }

    // 4. Snowflakes
    const activeSnowCount = Math.floor(MAX_SNOW * Math.min(1, particleMult) * (weather.snowIntensity > 0.02 ? 1 : 0));
    snowPoints.visible = activeSnowCount > 0 && outdoorExposure > 0.1;
    snowMat.opacity = weather.snowIntensity * 0.85 * outdoorExposure;
    if (snowPoints.visible) {
      const sAttr = snowGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < MAX_SNOW; i++) {
        if (i >= activeSnowCount) {
          sAttr.setXYZ(i, 0, -999, 0);
          continue;
        }
        snowSeeds[i * 3 + 1] -= (1.8 + (i % 4) * 0.45) * dt;
        snowSeeds[i * 3] += (weather.windDir.x * weather.windStrength * 2.2 + Math.sin(elapsed * 1.4 + i) * 0.7) * dt;
        snowSeeds[i * 3 + 2] += (weather.windDir.y * weather.windStrength * 2.2 + Math.cos(elapsed * 1.2 + i) * 0.7) * dt;
        if (snowSeeds[i * 3 + 1] < -2) {
          snowSeeds[i * 3 + 1] = 24 + Math.random() * 6;
          snowSeeds[i * 3] = (Math.random() - 0.5) * 72;
          snowSeeds[i * 3 + 2] = (Math.random() - 0.5) * 72;
        }
        sAttr.setXYZ(i, playerPos.x + snowSeeds[i * 3], playerPos.y + snowSeeds[i * 3 + 1], playerPos.z + snowSeeds[i * 3 + 2]);
      }
      sAttr.needsUpdate = true;
    }

    // 5. Falling Leaves
    const activeLeaves = Math.floor(MAX_LEAVES * Math.min(1, particleMult));
    for (let i = 0; i < MAX_LEAVES; i++) {
      if (i >= activeLeaves) {
        _leafDummy.position.set(0, -999, 0);
        _leafDummy.scale.setScalar(0.001);
        _leafDummy.updateMatrix();
        leafInst.setMatrixAt(i, _leafDummy.matrix);
        continue;
      }
      const lf = leafState[i];
      const gy = groundHeightAt(lf.x, lf.z);
      if (lf.y <= gy + 0.06) {
        lf.settled += dt;
        if (lf.settled > 2.5) {
          lf.settled = 0;
          if (treePositions.length > 0) {
            // Spawn near a tree near player
            const tp = treePositions[(i * 37 + Math.floor(elapsed * 3)) % treePositions.length];
            if (Math.hypot(tp.x - playerPos.x, tp.z - playerPos.z) < 75) {
              lf.x = tp.x + (Math.random() - 0.5) * 4;
              lf.y = tp.y + Math.random() * 3;
              lf.z = tp.z + (Math.random() - 0.5) * 4;
            } else {
              lf.x = playerPos.x + (Math.random() - 0.5) * 48;
              lf.y = playerPos.y + 8 + Math.random() * 6;
              lf.z = playerPos.z + (Math.random() - 0.5) * 48;
            }
          }
        }
      } else {
        lf.x += (weather.windDir.x * weather.windStrength * 1.4 + Math.sin(elapsed * 2 + lf.phase) * 0.55) * dt;
        lf.z += (weather.windDir.y * weather.windStrength * 1.4 + Math.cos(elapsed * 1.8 + lf.phase) * 0.55) * dt;
        lf.y -= lf.vy * dt;
      }
      _leafDummy.position.set(lf.x, Math.max(gy + 0.03, lf.y), lf.z);
      _leafDummy.rotation.set(elapsed * 1.8 + lf.phase, elapsed * 1.2 + lf.phase, Math.sin(elapsed * 2 + lf.phase));
      _leafDummy.scale.setScalar(1);
      _leafDummy.updateMatrix();
      leafInst.setMatrixAt(i, _leafDummy.matrix);
    }
    leafInst.instanceMatrix.needsUpdate = true;

    // 6. Sunlit Dust Motes
    const dAttr = dustGeo.attributes.position as THREE.BufferAttribute;
    dustMat.opacity = (0.32 * (1 - nightFactor * 0.7)) * (1 - weather.rainIntensity * 0.7);
    for (let i = 0; i < DUST_COUNT; i++) {
      const dx = dustSeeds[i * 3] + Math.sin(elapsed * 0.4 + i) * 1.2;
      const dy = dustSeeds[i * 3 + 1] + Math.cos(elapsed * 0.35 + i * 1.3) * 0.6;
      const dz = dustSeeds[i * 3 + 2] + Math.sin(elapsed * 0.3 + i * 0.7) * 1.2;
      dAttr.setXYZ(i, playerPos.x + dx, playerPos.y + dy, playerPos.z + dz);
    }
    dAttr.needsUpdate = true;

    // 6B. Arcane Spirit Magic Wisps & Floating Orbs (glow brightest in HDR & dusk/cavern)
    const mPosAttr = magicGeo.attributes.position as THREE.BufferAttribute;
    const mColAttr = magicGeo.attributes.color as THREE.BufferAttribute;
    const glowBoost = 0.75 + nightFactor * 0.55 + inCave * 0.65;
    for (let i = 0; i < MAGIC_COUNT; i++) {
      const anchor = magicAnchors[i % magicAnchors.length];
      const phase = i * 1.37;
      const orbitAng = elapsed * (0.42 + (i % 4) * 0.14) + phase;
      const orbitRad = anchor.radius * (0.28 + 0.68 * ((i * 19 % 100) / 100));
      const rise = ((elapsed * (0.55 + (i % 3) * 0.18) + phase) % 4.2);
      const wx = anchor.x + Math.cos(orbitAng) * orbitRad;
      const wy = anchor.y + rise + Math.sin(elapsed * 2.1 + phase) * 0.35;
      const wz = anchor.z + Math.sin(orbitAng) * orbitRad;
      mPosAttr.setXYZ(i, wx, wy, wz);

      const pulse = (0.45 + 0.55 * Math.sin(elapsed * 3.4 + phase)) * Math.sin((rise / 4.2) * Math.PI);
      const intensity = pulse * glowBoost;
      if (anchor.kind === 0) {
        mColAttr.setXYZ(i, 0.25 * intensity, 1.35 * intensity, 1.45 * intensity); // HDR cyan-aqua cavern magic
      } else if (anchor.kind === 1) {
        mColAttr.setXYZ(i, 1.45 * intensity, 0.92 * intensity, 0.32 * intensity); // HDR golden-amber rune embers
      } else {
        mColAttr.setXYZ(i, 0.65 * intensity, 1.15 * intensity, 1.45 * intensity); // Waterfall spirit mist
      }
    }
    mPosAttr.needsUpdate = true;
    mColAttr.needsUpdate = true;

    // 7. Drifting Ground Mist
    mistMat.opacity = 0.11 * weather.fogDensityMult * (0.7 + nightFactor * 0.4);
    for (const ms of mistSprites) {
      ms.sprite.position.x = ms.bx + Math.sin(elapsed * 0.06 * ms.speed) * 14;
      ms.sprite.position.z = ms.bz + Math.cos(elapsed * 0.05 * ms.speed) * 10;
    }

    // 8. Procedural Audio Gain Modulation
    if (audioEnabled && audioCtx) {
      const t = audioCtx.currentTime;
      if (windGain) windGain.gain.setTargetAtTime(0.03 + weather.windStrength * 0.035 * outdoorExposure, t, 0.2);

      const { dist: waterDist } = waterDistanceInfo(playerPos.x, playerPos.z);
      const fallsDist = Math.hypot(playerPos.x - 20, playerPos.z + 128);
      const waterProximity = Math.max(
        Math.max(0, 1 - Math.max(0, waterDist) / 42) * 0.07,
        Math.max(0, 1 - fallsDist / 65) * 0.14
      );
      if (waterGain) waterGain.gain.setTargetAtTime(waterProximity, t, 0.2);

      if (rainGain) rainGain.gain.setTargetAtTime(weather.rainIntensity * 0.14 * outdoorExposure, t, 0.2);

      const fireDist = playerPos.distanceTo(campfirePos);
      const fireProximity = campfireLit ? Math.max(0, 1 - fireDist / 16) * 0.08 : 0;
      if (fireGain) fireGain.gain.setTargetAtTime(fireProximity, t, 0.2);

      if (isSwimming && playerMoveSpeed > 0.45) {
        stepAccum += dt * (0.9 + playerMoveSpeed * 0.25);
        if (stepAccum >= 1) {
          stepAccum = 0;
          playFootstep(true);
        }
      } else if (isGrounded && playerMoveSpeed > 0.6) {
        stepAccum += dt * (playerMoveSpeed * 0.42);
        if (stepAccum >= 1) {
          stepAccum = 0;
          playFootstep(waterDist < 0.2 && playerPos.y < 0.25);
        }
      }
    }
  };

  const setCampfirePos = (pos: THREE.Vector3) => {
    campfirePos.copy(pos);
    fireGroup.position.copy(pos).add(new THREE.Vector3(0, 0.12, 0));
    for (let i = 0; i < SPARK_COUNT; i++) {
      sparkPos[i * 3] = pos.x;
      sparkPos[i * 3 + 1] = pos.y + 0.3;
      sparkPos[i * 3 + 2] = pos.z;
    }
    sparkGeo.attributes.position.needsUpdate = true;
  };

  const dispose = () => {
    if (audioCtx) {
      audioCtx.close().catch(() => {});
    }
  };

  return {
    weather,
    get campfireLit() {
      return campfireLit;
    },
    setWeatherMode,
    setCampfireLit,
    toggleCampfire,
    setCampfirePos,
    toggleAudio,
    isAudioEnabled: () => audioEnabled,
    update,
    dispose,
  };
}
