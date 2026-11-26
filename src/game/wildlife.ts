import * as THREE from 'three';
import { groundHeightAt, groundNormalAt, waterDistanceInfo, seededRandom, WATER_LEVEL } from './noise';

type AnimalKind = 'deer' | 'wolf' | 'fox' | 'rabbit' | 'bear' | 'boar';
type AnimalBehavior = 'roam' | 'graze' | 'drink' | 'rest' | 'flee';

interface LandAnimal {
  kind: AnimalKind;
  group: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  ears: THREE.Mesh[];
  tail: THREE.Mesh | null;
  legs: THREE.Group[];
  matMain: THREE.MeshStandardMaterial;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  behavior: AnimalBehavior;
  timer: number;
  gaitPhase: number;
  scale: number;
  homeX: number;
  homeZ: number;
  hitFlashTimer: number;
}

interface BirdAgent {
  group: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  center: THREE.Vector3;
  radius: number;
  speed: number;
  phase: number;
  flapPhase: number;
  isEagle: boolean;
}

interface FishAgent {
  group: THREE.Group;
  tail: THREE.Mesh;
  centerX: number;
  centerZ: number;
  radius: number;
  depth: number;
  phase: number;
  speed: number;
}

interface ButterflyAgent {
  group: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  phase: number;
}

export interface WildlifeSystem {
  root: THREE.Group;
  checkMeleeHit: (
    origin: THREE.Vector3,
    forwardDir: THREE.Vector3,
    range: number,
    isHeavy: boolean
  ) => THREE.Vector3 | null;
  update: (
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    nightFactor: number,
    rainIntensity: number
  ) => void;
  dispose: () => void;
}

function buildQuadruped(
  kind: AnimalKind,
  rand: () => number
): Omit<LandAnimal, 'kind' | 'pos' | 'yaw' | 'speed' | 'behavior' | 'timer' | 'gaitPhase' | 'homeX' | 'homeZ' | 'hitFlashTimer'> {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const specs: Record<
    AnimalKind,
    {
      color: number;
      belly: number;
      bodyL: number;
      bodyR: number;
      legH: number;
      legR: number;
      neckL: number;
      headR: number;
      earH: number;
      scale: number;
    }
  > = {
    deer: { color: 0x8f6440, belly: 0xcab092, bodyL: 1.25, bodyR: 0.28, legH: 0.78, legR: 0.048, neckL: 0.55, headR: 0.14, earH: 0.18, scale: 1.05 },
    wolf: { color: 0x626669, belly: 0x9aa0a3, bodyL: 1.02, bodyR: 0.22, legH: 0.54, legR: 0.045, neckL: 0.28, headR: 0.13, earH: 0.12, scale: 0.95 },
    fox: { color: 0xb85928, belly: 0xeadcd1, bodyL: 0.72, bodyR: 0.15, legH: 0.36, legR: 0.032, neckL: 0.2, headR: 0.1, earH: 0.11, scale: 0.85 },
    rabbit: { color: 0x8d7b68, belly: 0xcfc4b8, bodyL: 0.34, bodyR: 0.12, legH: 0.16, legR: 0.032, neckL: 0.06, headR: 0.085, earH: 0.17, scale: 0.9 },
    bear: { color: 0x453124, belly: 0x5c4232, bodyL: 1.65, bodyR: 0.48, legH: 0.68, legR: 0.11, neckL: 0.28, headR: 0.24, earH: 0.09, scale: 1.15 },
    boar: { color: 0x463d38, belly: 0x5c5048, bodyL: 0.98, bodyR: 0.3, legH: 0.38, legR: 0.055, neckL: 0.16, headR: 0.17, earH: 0.09, scale: 0.95 },
  };

  const sp = specs[kind];
  const matMain = new THREE.MeshStandardMaterial({ color: sp.color, roughness: 0.88, metalness: 0.02 });
  const matBelly = new THREE.MeshStandardMaterial({ color: sp.belly, roughness: 0.92, metalness: 0.0 });

  body.position.y = sp.legH + sp.bodyR * 0.65;

  // Torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(sp.bodyR, sp.bodyL * 0.62, 6, 12), matMain);
  torso.rotation.x = Math.PI * 0.5;
  torso.castShadow = true;
  torso.receiveShadow = true;
  body.add(torso);

  // Underbelly / Chest highlight
  const chest = new THREE.Mesh(new THREE.SphereGeometry(sp.bodyR * 0.88, 10, 8), matBelly);
  chest.position.set(0, -sp.bodyR * 0.18, sp.bodyL * 0.28);
  body.add(chest);

  // Neck + Head
  const head = new THREE.Group();
  head.position.set(0, sp.bodyR * 0.35, sp.bodyL * 0.44);
  body.add(head);

  if (sp.neckL > 0.12) {
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(sp.headR * 0.72, sp.bodyR * 0.58, sp.neckL, 8), matMain);
    neck.position.set(0, sp.neckL * 0.4, sp.neckL * 0.22);
    neck.rotation.x = kind === 'deer' ? 0.38 : 0.65;
    neck.castShadow = true;
    head.add(neck);
  }

  const headPosY = sp.neckL * 0.75;
  const headPosZ = sp.neckL * 0.48;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(sp.headR, 10, 8), matMain);
  skull.position.set(0, headPosY, headPosZ);
  skull.scale.set(0.88, 0.92, 1.2);
  skull.castShadow = true;
  head.add(skull);

  const snout = new THREE.Mesh(new THREE.CylinderGeometry(sp.headR * 0.36, sp.headR * 0.58, sp.headR * 1.1, 8), matMain);
  snout.rotation.x = Math.PI * 0.5;
  snout.position.set(0, headPosY - sp.headR * 0.15, headPosZ + sp.headR * 1.05);
  head.add(snout);

  // Expressive Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x161210, roughness: 0.18, metalness: 0.2 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(sp.headR * 0.16, 6, 6), eyeMat);
    eye.position.set(side * sp.headR * 0.58, headPosY + sp.headR * 0.18, headPosZ + sp.headR * 0.68);
    head.add(eye);
  }

  // Ears
  const ears: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(sp.headR * 0.32, sp.earH, 5), matMain);
    ear.position.set(side * sp.headR * 0.68, headPosY + sp.headR * 0.85, headPosZ - sp.headR * 0.1);
    ear.rotation.z = -side * 0.32;
    ear.rotation.x = -0.15;
    head.add(ear);
    ears.push(ear);
  }

  // Stag antlers on half of deer
  if (kind === 'deer' && rand() > 0.45) {
    const antMat = new THREE.MeshStandardMaterial({ color: 0xcbbba0, roughness: 0.75 });
    for (const side of [-1, 1]) {
      const mainBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.44, 5), antMat);
      mainBeam.position.set(side * 0.11, headPosY + 0.28, headPosZ - 0.02);
      mainBeam.rotation.z = -side * 0.42;
      mainBeam.rotation.x = -0.25;
      head.add(mainBeam);
      const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.2, 5), antMat);
      tine.position.set(side * 0.19, headPosY + 0.36, headPosZ + 0.05);
      tine.rotation.x = 0.45;
      head.add(tine);
    }
  }

  // Tail
  let tail: THREE.Mesh | null = null;
  if (kind === 'wolf' || kind === 'fox') {
    tail = new THREE.Mesh(new THREE.ConeGeometry(sp.bodyR * 0.38, sp.bodyL * 0.52, 7), kind === 'fox' ? matBelly : matMain);
    tail.position.set(0, sp.bodyR * 0.1, -sp.bodyL * 0.62);
    tail.rotation.x = -Math.PI * 0.65;
    body.add(tail);
  } else if (kind === 'deer' || kind === 'rabbit') {
    tail = new THREE.Mesh(new THREE.SphereGeometry(sp.bodyR * 0.28, 6, 6), matBelly);
    tail.position.set(0, sp.bodyR * 0.22, -sp.bodyL * 0.5);
    body.add(tail);
  }

  // 4 Articulated Legs
  const legs: THREE.Group[] = [];
  const legOffsets = [
    { x: -sp.bodyR * 0.56, z: sp.bodyL * 0.3 },
    { x: sp.bodyR * 0.56, z: sp.bodyL * 0.3 },
    { x: -sp.bodyR * 0.56, z: -sp.bodyL * 0.3 },
    { x: sp.bodyR * 0.56, z: -sp.bodyL * 0.3 },
  ];
  for (const off of legOffsets) {
    const legPivot = new THREE.Group();
    legPivot.position.set(off.x, -sp.bodyR * 0.4, off.z);
    const legMesh = new THREE.Mesh(new THREE.CylinderGeometry(sp.legR * 1.1, sp.legR * 0.72, sp.legH, 6), matMain);
    legMesh.position.y = -sp.legH * 0.5;
    legMesh.castShadow = true;
    legPivot.add(legMesh);
    body.add(legPivot);
    legs.push(legPivot);
  }

  const scale = sp.scale * (0.88 + rand() * 0.24);
  group.scale.setScalar(scale);

  return { group, body, head, ears, tail, legs, matMain, scale };
}

export function createWildlifeSystem(
  scene: THREE.Scene,
  softGlowMap: THREE.CanvasTexture,
  flowerPositions: { x: number; y: number; z: number }[]
): WildlifeSystem {
  const root = new THREE.Group();
  scene.add(root);

  const rand = seededRandom(40499);
  const animals: LandAnimal[] = [];

  const spawnAnimal = (kind: AnimalKind, cx: number, cz: number, spread: number) => {
    for (let tries = 0; tries < 25; tries++) {
      const x = cx + (rand() - 0.5) * spread;
      const z = cz + (rand() - 0.5) * spread;
      const { dist } = waterDistanceInfo(x, z);
      const h = groundHeightAt(x, z);
      const n = groundNormalAt(x, z);
      if (dist > 3 && h > 0.6 && h < 22 && n.ny > 0.82) {
        const built = buildQuadruped(kind, rand);
        const pos = new THREE.Vector3(x, h, z);
        built.group.position.copy(pos);
        const yaw = rand() * Math.PI * 2;
        built.group.rotation.y = yaw;
        root.add(built.group);
        animals.push({
          ...built,
          kind,
          pos,
          yaw,
          speed: 0,
          behavior: 'roam',
          timer: 2 + rand() * 5,
          gaitPhase: rand() * 10,
          homeX: x,
          homeZ: z,
          hitFlashTimer: 0,
        });
        return;
      }
    }
  };

  // Deer herds in meadow & forest
  for (let i = 0; i < 10; i++) spawnAnimal('deer', -70, 10, 140);
  // Wolves prowling northern foothills & deep forest
  for (let i = 0; i < 4; i++) spawnAnimal('wolf', -35, -75, 110);
  // Foxes near village & forest edges
  for (let i = 0; i < 5; i++) spawnAnimal('fox', 60, 45, 120);
  // Rabbits in meadows & camp clearing
  for (let i = 0; i < 10; i++) spawnAnimal('rabbit', -65, 55, 110);
  // Grizzly Bears near waterfall & upper valley
  for (let i = 0; i < 3; i++) spawnAnimal('bear', 35, -80, 90);
  // Wild Boars in forest & marsh border
  for (let i = 0; i < 5; i++) spawnAnimal('boar', -80, 105, 100);

  // Birds (Flocking Songbirds + Soaring Eagles)
  const birds: BirdAgent[] = [];
  const birdBodyMat = new THREE.MeshStandardMaterial({ color: 0x3b3532, roughness: 0.75 });
  const eagleMat = new THREE.MeshStandardMaterial({ color: 0x4d3625, roughness: 0.72 });
  for (let i = 0; i < 24; i++) {
    const isEagle = i < 4;
    const g = new THREE.Group();
    const s = isEagle ? 2.2 : 0.65;
    const mat = isEagle ? eagleMat : birdBodyMat;

    const torso = new THREE.Mesh(new THREE.ConeGeometry(0.11 * s, 0.45 * s, 5), mat);
    torso.rotation.x = Math.PI * 0.5;
    g.add(torso);

    const lw = new THREE.Group();
    const lBlade = new THREE.Mesh(new THREE.BoxGeometry(0.45 * s, 0.02 * s, 0.16 * s), mat);
    lBlade.position.x = -0.22 * s;
    lw.add(lBlade);
    g.add(lw);

    const rw = new THREE.Group();
    const rBlade = new THREE.Mesh(new THREE.BoxGeometry(0.45 * s, 0.02 * s, 0.16 * s), mat);
    rBlade.position.x = 0.22 * s;
    rw.add(rBlade);
    g.add(rw);

    root.add(g);
    birds.push({
      group: g,
      leftWing: lw,
      rightWing: rw,
      center: new THREE.Vector3((rand() - 0.5) * 180, isEagle ? 34 + rand() * 14 : 15 + rand() * 12, (rand() - 0.5) * 180),
      radius: isEagle ? 42 + rand() * 25 : 14 + rand() * 20,
      speed: isEagle ? 0.22 + rand() * 0.1 : 0.65 + rand() * 0.45,
      phase: rand() * Math.PI * 2,
      flapPhase: rand() * 10,
      isEagle,
    });
  }

  // Swimming Fish inside Central Lake (-22, 34)
  const fishes: FishAgent[] = [];
  const fishMat = new THREE.MeshStandardMaterial({ color: 0x5c767a, roughness: 0.25, metalness: 0.35 });
  for (let i = 0; i < 22; i++) {
    const fg = new THREE.Group();
    const fBody = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), fishMat);
    fBody.scale.set(0.55, 0.72, 2.1);
    fg.add(fBody);
    const fTail = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.22, 4), fishMat);
    fTail.rotation.x = Math.PI * 0.5;
    fTail.position.z = -0.3;
    fg.add(fTail);
    root.add(fg);

    fishes.push({
      group: fg,
      tail: fTail,
      centerX: -22 + (rand() - 0.5) * 32,
      centerZ: 34 + (rand() - 0.5) * 26,
      radius: 4 + rand() * 8,
      depth: -0.45 - rand() * 1.4,
      phase: rand() * Math.PI * 2,
      speed: 0.45 + rand() * 0.4,
    });
  }

  // Meadow Butterflies
  const butterflies: ButterflyAgent[] = [];
  const bColors = [0xf4c542, 0xe87a5d, 0x7cb8eb, 0xf2ede4];
  for (let i = 0; i < 28; i++) {
    const bg = new THREE.Group();
    const bMat = new THREE.MeshBasicMaterial({ color: bColors[i % bColors.length], side: THREE.DoubleSide });
    const wingGeo = new THREE.PlaneGeometry(0.14, 0.18);
    const lw = new THREE.Mesh(wingGeo, bMat);
    lw.position.x = -0.07;
    const rw = new THREE.Mesh(wingGeo, bMat);
    rw.position.x = 0.07;
    bg.add(lw, rw);
    root.add(bg);

    const fp = flowerPositions.length > 0 ? flowerPositions[i % flowerPositions.length] : null;
    const ax = fp ? fp.x : -60 + (rand() - 0.5) * 90;
    const az = fp ? fp.z : 20 + (rand() - 0.5) * 90;
    const ay = groundHeightAt(ax, az) + 1.0;

    butterflies.push({
      group: bg,
      leftWing: lw,
      rightWing: rw,
      anchorX: ax,
      anchorY: ay,
      anchorZ: az,
      phase: rand() * Math.PI * 2,
    });
  }

  // Nighttime Fireflies (additive glowing Points near forest & camp)
  const FIREFLY_COUNT = 160;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(FIREFLY_COUNT * 3);
  const ffBase = new Float32Array(FIREFLY_COUNT * 3);
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const x = -40 + (rand() - 0.5) * 200;
    const z = 40 + (rand() - 0.5) * 200;
    const y = Math.max(0.6, groundHeightAt(x, z)) + 0.8 + rand() * 2.5;
    ffBase[i * 3] = x;
    ffBase[i * 3 + 1] = y;
    ffBase[i * 3 + 2] = z;
    ffPos[i * 3] = x;
    ffPos[i * 3 + 1] = y;
    ffPos[i * 3 + 2] = z;
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  const ffMat = new THREE.PointsMaterial({
    map: softGlowMap,
    color: 0xc8ff6e,
    size: 0.45,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const fireflies = new THREE.Points(ffGeo, ffMat);
  root.add(fireflies);

  const _hitPosOut = new THREE.Vector3();

  const checkMeleeHit = (
    origin: THREE.Vector3,
    forwardDir: THREE.Vector3,
    range: number,
    isHeavy: boolean
  ): THREE.Vector3 | null => {
    for (const a of animals) {
      const dx = a.pos.x - origin.x;
      const dz = a.pos.z - origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + 0.7) continue;
      if (dist > 0.05) {
        const dot = (dx / dist) * forwardDir.x + (dz / dist) * forwardDir.z;
        if (dot < (isHeavy ? -0.15 : 0.12)) continue;
      }
      a.hitFlashTimer = 0.28;
      a.behavior = 'flee';
      a.timer = 4.5;
      a.yaw = Math.atan2(dx, dz);
      a.speed = isHeavy ? 9.8 : 7.8;
      const knock = isHeavy ? 1.45 : 0.85;
      const kx = a.pos.x + (dist > 0.01 ? (dx / dist) * knock : forwardDir.x * knock);
      const kz = a.pos.z + (dist > 0.01 ? (dz / dist) * knock : forwardDir.z * knock);
      const { dist: wd } = waterDistanceInfo(kx, kz);
      if (wd > 0.8) {
        a.pos.x = kx;
        a.pos.z = kz;
        a.pos.y = groundHeightAt(kx, kz);
      }
      _hitPosOut.copy(a.pos);
      return _hitPosOut;
    }
    return null;
  };

  const update = (
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    nightFactor: number,
    rainIntensity: number
  ) => {
    // 1. Land Animals AI & Procedural Articulated Animation
    for (const a of animals) {
      if (a.hitFlashTimer > 0) {
        a.hitFlashTimer = Math.max(0, a.hitFlashTimer - dt);
        a.matMain.emissive.setHex(0xff5222);
        a.matMain.emissiveIntensity = (a.hitFlashTimer / 0.28) * 1.1;
      } else if (a.matMain.emissiveIntensity > 0) {
        a.matMain.emissiveIntensity = 0;
      }

      const dxP = a.pos.x - playerPos.x;
      const dzP = a.pos.z - playerPos.z;
      const distP = Math.hypot(dxP, dzP);

      // Proximity reaction (deer, rabbit, fox flee; wolf/bear keep cautious distance or retreat slowly)
      if (distP < 14 && a.behavior !== 'flee') {
        a.behavior = 'flee';
        a.timer = 3.2;
        a.yaw = Math.atan2(dxP, dzP) + (Math.random() - 0.5) * 0.4;
      }

      a.timer -= dt;
      if (a.timer <= 0) {
        const r = Math.random();
        if (r < 0.48) {
          a.behavior = 'roam';
          a.timer = 3 + Math.random() * 5;
          // Gently steer back toward home territory if wandered far
          const distHome = Math.hypot(a.pos.x - a.homeX, a.pos.z - a.homeZ);
          if (distHome > 45) {
            a.yaw = Math.atan2(a.homeX - a.pos.x, a.homeZ - a.pos.z) + (Math.random() - 0.5) * 0.6;
          } else {
            a.yaw += (Math.random() - 0.5) * 2.2;
          }
        } else if (r < 0.8) {
          a.behavior = 'graze';
          a.timer = 2.5 + Math.random() * 4;
        } else {
          a.behavior = 'rest';
          a.timer = 2.5 + Math.random() * 4;
        }
      }

      const maxRoamSpeed = a.kind === 'bear' ? 2.1 : a.kind === 'rabbit' ? 2.4 : 2.8;
      const fleeSpeed = a.kind === 'deer' ? 8.2 : a.kind === 'rabbit' ? 6.5 : a.kind === 'wolf' ? 7.2 : 5.4;
      const targetSpd = a.behavior === 'flee' ? fleeSpeed : a.behavior === 'roam' ? maxRoamSpeed : 0;
      a.speed = THREE.MathUtils.damp(a.speed, targetSpd, 6, dt);

      if (a.speed > 0.1) {
        const nx = a.pos.x + Math.sin(a.yaw) * a.speed * dt;
        const nz = a.pos.z + Math.cos(a.yaw) * a.speed * dt;
        const { dist } = waterDistanceInfo(nx, nz);
        const h = groundHeightAt(nx, nz);
        if (dist > 1.2 && h > 0.3 && h < 24) {
          a.pos.x = nx;
          a.pos.z = nz;
          a.pos.y = THREE.MathUtils.damp(a.pos.y, h, 14, dt);
        } else {
          // Turn away from water or steep mountain
          a.yaw += Math.PI * 0.65;
        }
      }

      a.group.position.copy(a.pos);
      // Smooth facing rotation
      let yDiff = a.yaw - a.group.rotation.y;
      while (yDiff > Math.PI) yDiff -= Math.PI * 2;
      while (yDiff < -Math.PI) yDiff += Math.PI * 2;
      a.group.rotation.y += yDiff * Math.min(1, dt * 8);

      // Gait & Secondary Animation (Breathing, Head Dip, Ear Twitch, Rabbit Hop)
      const stride = Math.min(1, a.speed / 4.5);
      a.gaitPhase += dt * (a.kind === 'rabbit' ? 12 : 7.5 + a.speed * 1.1);
      const s = Math.sin(a.gaitPhase);

      if (a.kind === 'rabbit' && a.speed > 0.4) {
        const hop = Math.max(0, Math.sin(a.gaitPhase)) * 0.35;
        a.body.position.y = 0.25 + hop;
        a.body.rotation.x = -Math.cos(a.gaitPhase) * 0.28;
      } else {
        const restSink = a.behavior === 'rest' ? -0.18 * a.scale : 0;
        const breath = Math.sin(elapsed * 2.2 + a.homeX) * 0.015;
        a.body.position.y = THREE.MathUtils.damp(a.body.position.y, (a.kind === 'bear' ? 1.0 : a.kind === 'deer' ? 0.95 : 0.62) + restSink + breath, 6, dt);
        a.body.rotation.x = Math.sin(a.gaitPhase * 2) * 0.04 * stride;
      }

      // Legs
      if (a.legs.length === 4) {
        const legAmp = stride * (a.behavior === 'flee' ? 0.72 : 0.48);
        a.legs[0].rotation.x = s * legAmp;
        a.legs[1].rotation.x = -s * legAmp;
        a.legs[2].rotation.x = -s * legAmp;
        a.legs[3].rotation.x = s * legAmp;
      }

      // Head grazing / scanning
      const targetHeadPitch = a.behavior === 'graze' ? 0.68 : 0.0;
      a.head.rotation.x = THREE.MathUtils.damp(a.head.rotation.x, targetHeadPitch, 5, dt);
      a.head.rotation.y = Math.sin(elapsed * 0.8 + a.homeZ) * (a.behavior === 'graze' ? 0.18 : 0.25) * (1 - stride);

      // Ears & Tail
      a.ears.forEach((ear, ei) => {
        ear.rotation.x = -0.15 + Math.sin(elapsed * 4.5 + ei * 2 + a.homeX) * 0.12;
      });
      if (a.tail) {
        a.tail.rotation.z = Math.sin(elapsed * 5 + a.homeX) * 0.18;
      }
    }

    // 2. Birds & Eagles
    for (const b of birds) {
      b.phase += dt * b.speed;
      const bx = b.center.x + Math.cos(b.phase) * b.radius;
      const bz = b.center.z + Math.sin(b.phase) * b.radius;
      const by = b.center.y + Math.sin(b.phase * 2.0) * (b.isEagle ? 2.5 : 1.2);
      b.group.position.set(bx, by, bz);
      b.group.rotation.y = -b.phase;
      b.group.rotation.z = b.isEagle ? 0.24 : 0.16; // Banking into turn

      b.flapPhase += dt * (b.isEagle ? 4.2 : 12.5);
      // Eagles alternate gliding & flapping
      const glideMod = b.isEagle ? Math.max(0, Math.sin(elapsed * 0.4 + b.radius)) : 1.0;
      const flap = Math.sin(b.flapPhase) * 0.68 * glideMod;
      b.leftWing.rotation.z = flap;
      b.rightWing.rotation.z = -flap;
    }

    // 3. Fish
    for (const f of fishes) {
      f.phase += dt * f.speed;
      const fx = f.centerX + Math.cos(f.phase) * f.radius;
      const fz = f.centerZ + Math.sin(f.phase) * f.radius;
      f.group.position.set(fx, WATER_LEVEL + f.depth, fz);
      f.group.rotation.y = -f.phase;
      f.tail.rotation.y = Math.sin(elapsed * 9 + f.phase) * 0.45;
    }

    // 4. Butterflies (hide during rain or deep night)
    const bVisible = rainIntensity < 0.3 && nightFactor < 0.65;
    for (const bf of butterflies) {
      bf.group.visible = bVisible;
      if (!bVisible) continue;
      const t = elapsed * 1.4 + bf.phase;
      bf.group.position.set(
        bf.anchorX + Math.sin(t * 1.3) * 1.1,
        bf.anchorY + Math.sin(t * 2.7) * 0.35,
        bf.anchorZ + Math.cos(t * 1.1) * 1.1
      );
      bf.group.rotation.y = t;
      const wingAng = Math.sin(elapsed * 18 + bf.phase) * 0.95;
      bf.leftWing.rotation.y = wingAng;
      bf.rightWing.rotation.y = -wingAng;
    }

    // 5. Night Fireflies
    const ffVis = Math.max(0, Math.min(1, (nightFactor - 0.35) * 2.2)) * (1 - rainIntensity * 0.85);
    ffMat.opacity = ffVis * (0.65 + 0.35 * Math.sin(elapsed * 3.1));
    fireflies.visible = ffVis > 0.02;
    if (fireflies.visible) {
      const posAttr = ffGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < FIREFLY_COUNT; i++) {
        const bx = ffBase[i * 3];
        const by = ffBase[i * 3 + 1];
        const bz = ffBase[i * 3 + 2];
        posAttr.setXYZ(
          i,
          bx + Math.sin(elapsed * 0.7 + i) * 1.4,
          by + Math.sin(elapsed * 1.3 + i * 1.7) * 0.55,
          bz + Math.cos(elapsed * 0.65 + i * 0.9) * 1.4
        );
      }
      posAttr.needsUpdate = true;
    }
  };

  const dispose = () => {
    root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material.dispose();
      }
    });
    scene.remove(root);
  };

  return { root, checkMeleeHit, update, dispose };
}
