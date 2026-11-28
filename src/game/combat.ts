import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';
import { groundHeightAt } from './noise';

export interface CrateAnchor {
  x: number;
  z: number;
  rotY: number;
}

export interface TotemAnchor {
  x: number;
  z: number;
}

import type { EnemyMeleeHitInfo } from './enemies';

export interface CombatHitResult {
  hit: boolean;
  hitStop: number;
  shake: number;
  targetKind: 'none' | 'crate' | 'totem' | 'wildlife' | 'enemy';
  killedEnemy?: boolean;
}

interface SlashArcInstance {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  active: boolean;
  age: number;
  duration: number;
  startSpin: number;
  spinSpeed: number;
}

interface SparkParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
  r: number;
  g: number;
  b: number;
}

interface SplinterPiece {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  age: number;
  maxAge: number;
}

interface ShockwaveRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  duration: number;
  maxScale: number;
}

interface DestructibleCrate {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  baseX: number;
  baseY: number;
  baseZ: number;
  rotY: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  respawnTimer: number;
  hitFlash: number;
  wobble: number;
}

interface TrainingTotem {
  group: THREE.Group;
  postPivot: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  x: number;
  y: number;
  z: number;
  wobbleX: number;
  wobbleZ: number;
  velX: number;
  velZ: number;
  hitFlash: number;
}

export interface CombatSystem {
  root: THREE.Group;
  spawnSlashArc: (
    origin: THREE.Vector3,
    yaw: number,
    comboStep: number,
    isHeavy: boolean
  ) => void;
  spawnDodgeBurst: (origin: THREE.Vector3) => void;
  spawnImpactPulse: (origin: THREE.Vector3, colorHex: number, maxScale: number, sparkCount?: number) => void;
  triggerAttackHitCheck: (
    origin: THREE.Vector3,
    forwardDir: THREE.Vector3,
    range: number,
    isHeavy: boolean,
    wildlifeHitCheck: (origin: THREE.Vector3, dir: THREE.Vector3, range: number, isHeavy: boolean) => THREE.Vector3 | null,
    enemyHitCheck?: (origin: THREE.Vector3, dir: THREE.Vector3, range: number, isHeavy: boolean) => EnemyMeleeHitInfo | null
  ) => CombatHitResult;
  playCombatSfx: (kind: 'slash' | 'heavy' | 'hit' | 'break' | 'dodge' | 'guard') => void;
  update: (dt: number, elapsed: number) => void;
  dispose: () => void;
}

function createSlashArcGeometry(radius: number, width: number, arcAngle: number): THREE.BufferGeometry {
  const segs = 28;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ang = -arcAngle * 0.5 + t * arcAngle;
    // Taper width sharply at ends for a razor-sharp crescent ribbon
    const taper = Math.sin(t * Math.PI);
    const localW = width * (0.2 + 0.8 * taper);
    const rInner = radius - localW * 0.5;
    const rOuter = radius + localW * 0.5;

    const c = Math.cos(ang);
    const s = Math.sin(ang);

    positions.push(s * rInner, 0, c * rInner);
    uvs.push(t, 0);

    positions.push(s * rOuter, 0, c * rOuter);
    uvs.push(t, 1);

    if (i < segs) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createSlashMaterial(isHeavy: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uCoreColor: { value: new THREE.Color(isHeavy ? 0xffdfa8 : 0xeef9ff) },
      uEdgeColor: { value: new THREE.Color(isHeavy ? 0xff5a1f : 0xffaa44) },
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
      uniform float uProgress;
      uniform vec3 uCoreColor;
      uniform vec3 uEdgeColor;
      varying vec2 vUv;

      void main() {
        // Sweep bright leading head across vUv.x and fade tail smoothly
        float head = clamp(uProgress * 1.35, 0.0, 1.25);
        float trailDist = head - vUv.x;
        float trailMask = smoothstep(0.0, 0.08, trailDist) * (1.0 - smoothstep(0.18, 0.78, trailDist));
        // Fade cleanly near end of animation
        float lifeFade = 1.0 - smoothstep(0.55, 1.0, uProgress);
        // Sharp bright outer blade edge
        float edgeGlow = pow(max(smoothstep(0.0, 0.85, vUv.y), 1e-4), 1.6) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
        float coreBlade = smoothstep(0.58, 0.86, vUv.y) * (1.0 - smoothstep(0.88, 0.99, vUv.y));

        float alpha = (edgeGlow * 0.85 + coreBlade * 0.95) * trailMask * lifeFade;
        vec3 col = mix(uEdgeColor, uCoreColor, coreBlade);
        gl_FragColor = vec4(col * 1.45, clamp(alpha, 0.0, 1.0));
      }
    `,
  });
}

export function createCombatSystem(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
  crateAnchors: CrateAnchor[],
  totemAnchors: TotemAnchor[]
): CombatSystem {
  const root = new THREE.Group();
  scene.add(root);

  // 1. Slash Arc Ribbon Pool
  const lightArcGeo = createSlashArcGeometry(1.65, 0.78, Math.PI * 0.88);
  const heavyArcGeo = createSlashArcGeometry(2.15, 1.05, Math.PI * 1.15);
  const slashPool: SlashArcInstance[] = [];
  for (let i = 0; i < 6; i++) {
    const isHeavySlot = i >= 4;
    const mat = createSlashMaterial(isHeavySlot);
    const mesh = new THREE.Mesh(isHeavySlot ? heavyArcGeo : lightArcGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 6;
    root.add(mesh);
    slashPool.push({
      mesh,
      mat,
      active: false,
      age: 0,
      duration: 0.24,
      startSpin: 0,
      spinSpeed: 0,
    });
  }

  // 2. Shockwave Ground Rings Pool
  const rings: ShockwaveRing[] = [];
  const ringGeo = new THREE.RingGeometry(0.42, 0.72, 28);
  ringGeo.rotateX(-Math.PI * 0.5);
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb35c,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 5;
    root.add(mesh);
    rings.push({ mesh, mat, active: false, age: 0, duration: 0.34, maxScale: 4.5 });
  }

  // 3. Impact Spark Particle Pool
  const MAX_SPARKS = 140;
  const sparks: SparkParticle[] = Array.from({ length: MAX_SPARKS }, () => ({
    active: false,
    x: 0,
    y: -999,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    age: 0,
    maxAge: 0.45,
    r: 1,
    g: 0.75,
    b: 0.3,
  }));
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(MAX_SPARKS * 3);
  const sparkCol = new Float32Array(MAX_SPARKS * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparkMat = new THREE.PointsMaterial({
    map: textures.softGlowMap,
    size: 0.42,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
  });
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  sparkPoints.frustumCulled = false;
  root.add(sparkPoints);

  // 4. Wood Splinter Debris Pool
  const MAX_SPLINTERS = 64;
  const splinters: SplinterPiece[] = Array.from({ length: MAX_SPLINTERS }, () => ({
    active: false,
    x: 0,
    y: -999,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    vrx: 0,
    vry: 0,
    age: 0,
    maxAge: 1.4,
  }));
  const splinterGeo = new THREE.BoxGeometry(0.18, 0.04, 0.07);
  const splinterMat = new THREE.MeshStandardMaterial({
    map: textures.woodPlankMap,
    roughness: 0.85,
  });
  const splinterMesh = new THREE.InstancedMesh(splinterGeo, splinterMat, MAX_SPLINTERS);
  splinterMesh.frustumCulled = false;
  splinterMesh.castShadow = true;
  root.add(splinterMesh);
  const _splinterDummy = new THREE.Object3D();

  // 5. Destructible Wooden Supply Crates
  const crates: DestructibleCrate[] = [];
  const crateGeo = new THREE.BoxGeometry(0.95, 0.95, 0.95);
  for (const a of crateAnchors) {
    const mat = new THREE.MeshStandardMaterial({
      map: textures.crateMap,
      roughness: 0.82,
      metalness: 0.08,
    });
    const mesh = new THREE.Mesh(crateGeo, mat);
    const y = groundHeightAt(a.x, a.z) + 0.475;
    mesh.position.set(a.x, y, a.z);
    mesh.rotation.y = a.rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    crates.push({
      mesh,
      mat,
      baseX: a.x,
      baseY: y,
      baseZ: a.z,
      rotY: a.rotY,
      hp: 2,
      maxHp: 2,
      destroyed: false,
      respawnTimer: 0,
      hitFlash: 0,
      wobble: 0,
    });
  }

  // 6. Interactive Carved Wooden Combat Training Totems
  const totems: TrainingTotem[] = [];
  const postGeo = new THREE.CylinderGeometry(0.16, 0.2, 1.95, 9);
  const crossbarGeo = new THREE.BoxGeometry(1.05, 0.16, 0.16);
  const targetBandGeo = new THREE.CylinderGeometry(0.185, 0.185, 0.36, 10);
  const padMat = new THREE.MeshStandardMaterial({
    map: textures.fabricMap,
    color: 0xa4462c,
    roughness: 0.85,
  });

  for (const ta of totemAnchors) {
    const group = new THREE.Group();
    const y = groundHeightAt(ta.x, ta.z);
    group.position.set(ta.x, y, ta.z);

    const postPivot = new THREE.Group();
    group.add(postPivot);

    const mat = new THREE.MeshStandardMaterial({
      map: textures.barkOakMap,
      normalMap: textures.barkNormal,
      roughness: 0.86,
    });
    const post = new THREE.Mesh(postGeo, mat);
    post.position.y = 0.95;
    post.castShadow = true;
    post.receiveShadow = true;
    postPivot.add(post);

    const crossbar = new THREE.Mesh(crossbarGeo, mat);
    crossbar.position.y = 1.42;
    crossbar.castShadow = true;
    postPivot.add(crossbar);

    const band = new THREE.Mesh(targetBandGeo, padMat);
    band.position.y = 1.25;
    postPivot.add(band);

    const helmCap = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), mat);
    helmCap.position.y = 1.98;
    helmCap.castShadow = true;
    postPivot.add(helmCap);

    root.add(group);
    totems.push({
      group,
      postPivot,
      mat,
      x: ta.x,
      y,
      z: ta.z,
      wobbleX: 0,
      wobbleZ: 0,
      velX: 0,
      velZ: 0,
      hitFlash: 0,
    });
  }

  // Lightweight procedural Web Audio Combat SFX (lazily created on user action)
  let sfxCtx: AudioContext | null = null;
  const playCombatSfx = (kind: 'slash' | 'heavy' | 'hit' | 'break' | 'dodge' | 'guard') => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      if (!sfxCtx) sfxCtx = new AC();
      if (sfxCtx.state === 'suspended') {
        sfxCtx.resume().catch(() => {});
      }
      const now = sfxCtx.currentTime;

      if (kind === 'slash' || kind === 'heavy' || kind === 'dodge') {
        const dur = kind === 'heavy' ? 0.28 : 0.16;
        const bufSize = Math.floor(sfxCtx.sampleRate * dur);
        const buf = sfxCtx.createBuffer(1, bufSize, sfxCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) {
          const env = Math.sin((i / bufSize) * Math.PI);
          data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = sfxCtx.createBufferSource();
        src.buffer = buf;
        const bp = sfxCtx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(kind === 'heavy' ? 420 : kind === 'dodge' ? 680 : 950, now);
        bp.frequency.exponentialRampToValueAtTime(kind === 'heavy' ? 160 : 280, now + dur);
        bp.Q.value = 1.6;
        const g = sfxCtx.createGain();
        g.gain.setValueAtTime(kind === 'heavy' ? 0.24 : 0.15, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        src.connect(bp).connect(g).connect(sfxCtx.destination);
        src.start(now);
      } else if (kind === 'hit' || kind === 'break' || kind === 'guard') {
        const osc = sfxCtx.createOscillator();
        const g = sfxCtx.createGain();
        osc.type = kind === 'guard' ? 'triangle' : 'sawtooth';
        const baseFreq = kind === 'guard' ? 520 : kind === 'break' ? 130 : 195;
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(kind === 'guard' ? 280 : 48, now + 0.16);
        g.gain.setValueAtTime(kind === 'break' ? 0.24 : 0.16, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(g).connect(sfxCtx.destination);
        osc.start(now);
        osc.stop(now + 0.19);
      }
    } catch {
      // Ignore if audio playback is blocked
    }
  };

  let sparkCursor = 0;
  const emitSparks = (x: number, y: number, z: number, count: number, heavy: boolean) => {
    for (let i = 0; i < count; i++) {
      const sp = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
      const ang = Math.random() * Math.PI * 2;
      const spd = (heavy ? 5.5 : 3.4) + Math.random() * 5.2;
      sp.active = true;
      sp.x = x;
      sp.y = y;
      sp.z = z;
      sp.vx = Math.cos(ang) * spd;
      sp.vy = 2.0 + Math.random() * (heavy ? 5.5 : 3.6);
      sp.vz = Math.sin(ang) * spd;
      sp.age = 0;
      sp.maxAge = 0.28 + Math.random() * 0.28;
      if (heavy && i % 4 === 0) {
        // Arcane cyan-white magic spark accent in HDR range
        sp.r = 0.45;
        sp.g = 1.25;
        sp.b = 1.65;
      } else if (heavy) {
        sp.r = 1.55;
        sp.g = 0.72 + Math.random() * 0.4;
        sp.b = 0.22;
      } else {
        sp.r = 1.3;
        sp.g = 1.0 + Math.random() * 0.2;
        sp.b = 0.5 + Math.random() * 0.45;
      }
    }
  };

  let splinterCursor = 0;
  const emitSplinters = (x: number, y: number, z: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const s = splinters[splinterCursor];
      splinterCursor = (splinterCursor + 1) % MAX_SPLINTERS;
      const ang = Math.random() * Math.PI * 2;
      const spd = 2.2 + Math.random() * 4.2;
      s.active = true;
      s.x = x + (Math.random() - 0.5) * 0.4;
      s.y = y + Math.random() * 0.5;
      s.z = z + (Math.random() - 0.5) * 0.4;
      s.vx = Math.cos(ang) * spd;
      s.vy = 2.6 + Math.random() * 4.0;
      s.vz = Math.sin(ang) * spd;
      s.rx = Math.random() * 3;
      s.ry = Math.random() * 3;
      s.rz = Math.random() * 3;
      s.vrx = (Math.random() - 0.5) * 14;
      s.vry = (Math.random() - 0.5) * 14;
      s.age = 0;
      s.maxAge = 0.9 + Math.random() * 0.6;
    }
  };

  const spawnShockwave = (x: number, y: number, z: number, maxScale: number, colorHex: number) => {
    const slot = rings.find((r) => !r.active) ?? rings[0];
    slot.active = true;
    slot.age = 0;
    slot.duration = 0.34;
    slot.maxScale = maxScale;
    slot.mesh.position.set(x, y + 0.12, z);
    slot.mesh.scale.setScalar(0.35);
    slot.mat.color.setHex(colorHex);
    slot.mat.opacity = 0.85;
    slot.mesh.visible = true;
  };

  const spawnSlashArc = (origin: THREE.Vector3, yaw: number, comboStep: number, isHeavy: boolean) => {
    const startIdx = isHeavy ? 4 : 0;
    const endIdx = isHeavy ? 6 : 4;
    let slot = slashPool[startIdx];
    for (let i = startIdx; i < endIdx; i++) {
      if (!slashPool[i].active) {
        slot = slashPool[i];
        break;
      }
    }

    slot.active = true;
    slot.age = 0;
    slot.duration = isHeavy ? 0.32 : 0.22;
    slot.mat.uniforms.uProgress.value = 0;

    // Position slightly forward of player chest
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    slot.mesh.position.set(origin.x + forwardX * 0.35, origin.y + 1.18, origin.z + forwardZ * 0.35);

    // Tilt crescent differently per combo step for fluid modern choreography
    const tiltZ = isHeavy ? -0.35 : comboStep === 1 ? -0.45 : comboStep === 2 ? 0.18 : 0.62;
    const tiltX = isHeavy ? 0.25 : 0.08;
    const spinDir = comboStep === 2 ? -1 : 1;
    slot.startSpin = yaw + Math.PI - spinDir * 0.6;
    slot.spinSpeed = spinDir * (isHeavy ? 4.4 : 5.6);

    slot.mesh.rotation.set(tiltX, slot.startSpin, tiltZ);
    slot.mesh.scale.setScalar(isHeavy ? 1.15 : 0.95);
    slot.mesh.visible = true;

    if (isHeavy) {
      spawnShockwave(origin.x + forwardX * 1.4, origin.y, origin.z + forwardZ * 1.4, 4.4, 0xff8f3d);
      emitSparks(origin.x + forwardX * 1.5, origin.y + 1.0, origin.z + forwardZ * 1.5, 16, true);
      playCombatSfx('heavy');
    } else {
      emitSparks(origin.x + forwardX * 1.2, origin.y + 1.15, origin.z + forwardZ * 1.2, 6, false);
      playCombatSfx('slash');
    }
  };

  const spawnDodgeBurst = (origin: THREE.Vector3) => {
    spawnShockwave(origin.x, origin.y, origin.z, 2.4, 0x9bdcff);
    emitSparks(origin.x, origin.y + 0.5, origin.z, 10, false);
    playCombatSfx('dodge');
  };

  const spawnImpactPulse = (
    origin: THREE.Vector3,
    colorHex: number,
    maxScale: number,
    sparkCount = 14
  ) => {
    spawnShockwave(origin.x, origin.y, origin.z, maxScale, colorHex);
    emitSparks(origin.x, origin.y + 0.85, origin.z, sparkCount, maxScale >= 3.5);
  };

  const _toTarget = new THREE.Vector3();

  const triggerAttackHitCheck = (
    origin: THREE.Vector3,
    forwardDir: THREE.Vector3,
    range: number,
    isHeavy: boolean,
    wildlifeHitCheck: (origin: THREE.Vector3, dir: THREE.Vector3, range: number, isHeavy: boolean) => THREE.Vector3 | null,
    enemyHitCheck?: (origin: THREE.Vector3, dir: THREE.Vector3, range: number, isHeavy: boolean) => EnemyMeleeHitInfo | null
  ): CombatHitResult => {
    let hit = false;
    let targetKind: CombatHitResult['targetKind'] = 'none';
    let killedEnemy = false;

    // 0. Check Hostile Enemies & Bosses (highest combat priority)
    const enemyHit = enemyHitCheck?.(origin, forwardDir, range, isHeavy) ?? null;
    if (enemyHit) {
      hit = true;
      targetKind = 'enemy';
      killedEnemy = enemyHit.killed;
      const fxColor = enemyHit.isMech
        ? 0x38bdf8
        : enemyHit.category === 'boss'
        ? 0xa855f7
        : 0xff4522;
      emitSparks(
        enemyHit.hitPos.x,
        enemyHit.hitPos.y + 1.05,
        enemyHit.hitPos.z,
        isHeavy || enemyHit.killed ? 26 : 16,
        isHeavy || enemyHit.isMech
      );
      spawnShockwave(
        enemyHit.hitPos.x,
        enemyHit.hitPos.y + 0.08,
        enemyHit.hitPos.z,
        enemyHit.killed ? 4.4 : isHeavy ? 3.8 : 2.3,
        fxColor
      );
      playCombatSfx(enemyHit.killed ? 'break' : 'hit');
    }

    // 1. Check Crates
    for (const cr of crates) {
      if (cr.destroyed) continue;
      _toTarget.set(cr.baseX - origin.x, 0, cr.baseZ - origin.z);
      const dist = _toTarget.length();
      if (dist > range + 0.5) continue;
      if (dist > 0.05) {
        _toTarget.divideScalar(dist);
        const dot = _toTarget.x * forwardDir.x + _toTarget.z * forwardDir.z;
        if (dot < (isHeavy ? -0.1 : 0.15)) continue;
      }

      hit = true;
      targetKind = 'crate';
      cr.hp -= isHeavy ? 2 : 1;
      cr.hitFlash = 1.0;
      cr.wobble = 0.3;
      emitSparks(cr.baseX, cr.baseY + 0.2, cr.baseZ, isHeavy ? 22 : 14, isHeavy);
      emitSplinters(cr.baseX, cr.baseY + 0.15, cr.baseZ, cr.hp <= 0 ? 18 : 6);

      if (cr.hp <= 0) {
        cr.destroyed = true;
        cr.respawnTimer = 18;
        cr.mesh.visible = false;
        spawnShockwave(cr.baseX, cr.baseY - 0.45, cr.baseZ, 2.8, 0xffaa44);
        playCombatSfx('break');
      } else {
        playCombatSfx('hit');
      }
    }

    // 2. Check Training Totems
    for (const tm of totems) {
      _toTarget.set(tm.x - origin.x, 0, tm.z - origin.z);
      const dist = _toTarget.length();
      if (dist > range + 0.4) continue;
      if (dist > 0.05) {
        _toTarget.divideScalar(dist);
        const dot = _toTarget.x * forwardDir.x + _toTarget.z * forwardDir.z;
        if (dot < (isHeavy ? -0.1 : 0.15)) continue;
      }

      hit = true;
      targetKind = 'totem';
      tm.hitFlash = 1.0;
      const impulse = isHeavy ? 7.2 : 4.6;
      tm.velX += forwardDir.z * impulse;
      tm.velZ -= forwardDir.x * impulse;
      emitSparks(tm.x, tm.y + 1.25, tm.z, isHeavy ? 24 : 14, isHeavy);
      spawnShockwave(tm.x, tm.y + 0.05, tm.z, isHeavy ? 3.5 : 2.1, 0xffc66e);
      playCombatSfx('hit');
    }

    // 3. Check Wildlife Targets
    const wHitPos = wildlifeHitCheck(origin, forwardDir, range, isHeavy);
    if (wHitPos) {
      hit = true;
      targetKind = 'wildlife';
      emitSparks(wHitPos.x, wHitPos.y + 0.65, wHitPos.z, isHeavy ? 22 : 14, isHeavy);
      spawnShockwave(wHitPos.x, wHitPos.y, wHitPos.z, isHeavy ? 3.6 : 2.2, 0xff7043);
      playCombatSfx('hit');
    }

    return {
      hit,
      hitStop: hit ? (isHeavy ? 0.055 : 0.028) : 0,
      shake: hit ? (isHeavy ? 0.55 : 0.24) : isHeavy ? 0.28 : 0.08,
      targetKind,
      killedEnemy,
    };
  };

  const update = (dt: number, elapsed: number) => {
    void elapsed;

    // Slash Arcs
    for (const s of slashPool) {
      if (!s.active) continue;
      s.age += dt;
      const p = s.age / s.duration;
      if (p >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.mat.uniforms.uProgress.value = p;
      s.mesh.rotation.y = s.startSpin + s.spinSpeed * s.age;
    }

    // Shockwave Rings
    for (const r of rings) {
      if (!r.active) continue;
      r.age += dt;
      const p = r.age / r.duration;
      if (p >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const ease = 1 - Math.pow(1 - p, 2);
      r.mesh.scale.setScalar(0.35 + ease * r.maxScale);
      r.mat.opacity = (1 - p) * 0.78;
    }

    // Sparks
    for (let i = 0; i < MAX_SPARKS; i++) {
      const sp = sparks[i];
      if (!sp.active) {
        sparkPos[i * 3] = 0;
        sparkPos[i * 3 + 1] = -9999;
        sparkPos[i * 3 + 2] = 0;
        continue;
      }
      sp.age += dt;
      if (sp.age >= sp.maxAge) {
        sp.active = false;
        sparkPos[i * 3 + 1] = -9999;
        continue;
      }
      sp.vy -= 12.5 * dt;
      sp.vx *= 1 - 2.2 * dt;
      sp.vz *= 1 - 2.2 * dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.z += sp.vz * dt;

      const fade = 1 - sp.age / sp.maxAge;
      sparkPos[i * 3] = sp.x;
      sparkPos[i * 3 + 1] = sp.y;
      sparkPos[i * 3 + 2] = sp.z;
      sparkCol[i * 3] = sp.r * fade;
      sparkCol[i * 3 + 1] = sp.g * fade;
      sparkCol[i * 3 + 2] = sp.b * fade;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;

    // Wood Splinters
    for (let i = 0; i < MAX_SPLINTERS; i++) {
      const s = splinters[i];
      if (!s.active) {
        _splinterDummy.position.set(0, -9999, 0);
        _splinterDummy.scale.setScalar(0.001);
        _splinterDummy.updateMatrix();
        splinterMesh.setMatrixAt(i, _splinterDummy.matrix);
        continue;
      }
      s.age += dt;
      if (s.age >= s.maxAge) {
        s.active = false;
        _splinterDummy.position.set(0, -9999, 0);
        _splinterDummy.scale.setScalar(0.001);
        _splinterDummy.updateMatrix();
        splinterMesh.setMatrixAt(i, _splinterDummy.matrix);
        continue;
      }
      s.vy -= 16 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.rx += s.vrx * dt;
      s.ry += s.vry * dt;

      const fade = Math.min(1, (1 - s.age / s.maxAge) * 2.5);
      _splinterDummy.position.set(s.x, s.y, s.z);
      _splinterDummy.rotation.set(s.rx, s.ry, s.rz);
      _splinterDummy.scale.setScalar(fade);
      _splinterDummy.updateMatrix();
      splinterMesh.setMatrixAt(i, _splinterDummy.matrix);
    }
    splinterMesh.instanceMatrix.needsUpdate = true;

    // Crates
    for (const cr of crates) {
      if (cr.destroyed) {
        cr.respawnTimer -= dt;
        if (cr.respawnTimer <= 0) {
          cr.destroyed = false;
          cr.hp = cr.maxHp;
          cr.mesh.visible = true;
          cr.mesh.scale.setScalar(1);
        }
        continue;
      }
      if (cr.hitFlash > 0) {
        cr.hitFlash = Math.max(0, cr.hitFlash - dt * 5);
        cr.mat.emissive.setHex(0xff7722);
        cr.mat.emissiveIntensity = cr.hitFlash * 0.85;
      }
      if (cr.wobble > 0) {
        cr.wobble = Math.max(0, cr.wobble - dt * 2.8);
        cr.mesh.rotation.z = Math.sin(cr.wobble * 36) * cr.wobble * 0.4;
      } else {
        cr.mesh.rotation.z = 0;
      }
    }

    // Spring-damped Training Totems
    for (const tm of totems) {
      const k = 42;
      const damp = 5.5;
      tm.velX += (-k * tm.wobbleX - damp * tm.velX) * dt;
      tm.velZ += (-k * tm.wobbleZ - damp * tm.velZ) * dt;
      tm.wobbleX += tm.velX * dt;
      tm.wobbleZ += tm.velZ * dt;
      tm.postPivot.rotation.x = THREE.MathUtils.clamp(tm.wobbleX, -0.45, 0.45);
      tm.postPivot.rotation.z = THREE.MathUtils.clamp(tm.wobbleZ, -0.45, 0.45);

      if (tm.hitFlash > 0) {
        tm.hitFlash = Math.max(0, tm.hitFlash - dt * 5);
        tm.mat.emissive.setHex(0xff8c32);
        tm.mat.emissiveIntensity = tm.hitFlash * 0.65;
      }
    }
  };

  const dispose = () => {
    lightArcGeo.dispose();
    heavyArcGeo.dispose();
    ringGeo.dispose();
    sparkGeo.dispose();
    splinterGeo.dispose();
    crateGeo.dispose();
    postGeo.dispose();
    crossbarGeo.dispose();
    targetBandGeo.dispose();
    if (sfxCtx) {
      sfxCtx.close().catch(() => {});
      sfxCtx = null;
    }
  };

  return {
    root,
    spawnSlashArc,
    spawnDodgeBurst,
    spawnImpactPulse,
    triggerAttackHitCheck,
    playCombatSfx,
    update,
    dispose,
  };
}
