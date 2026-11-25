import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  WORLD_SIZE,
  WATER_LEVEL,
  groundHeightAt,
  groundNormalAt,
  getBiomeWeights,
  waterDistanceInfo,
  getCaveProximity,
  seededRandom,
  fbm2D,
} from './noise';
import { ProceduralTextureSet } from './textures';
import {
  SharedEnvUniforms,
  createTerrainMaterial,
  createWaterMaterial,
  createWaterfallMaterial,
  createFoliageCanopyMaterial,
  createGrassMaterial,
} from './materials';

import { CrateAnchor, TotemAnchor } from './combat';

export interface CylinderCollider {
  x: number;
  z: number;
  r: number;
  topY?: number;
}

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
}

export interface BridgeWalkway {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  deckY: number;
}

export interface WorldHandles {
  root: THREE.Group;
  terrainMesh: THREE.Mesh;
  waterMesh: THREE.Mesh;
  grassMesh: THREE.InstancedMesh;
  flowerMesh: THREE.InstancedMesh;
  treeCanopyGroup: THREE.Group;
  colliders: CylinderCollider[];
  boxColliders: BoxCollider[];
  bridges: BridgeWalkway[];
  campfirePos: THREE.Vector3;
  treePositions: { x: number; y: number; z: number }[];
  flowerPositions: { x: number; y: number; z: number }[];
  crateAnchors: CrateAnchor[];
  totemAnchors: TotemAnchor[];
  lanternLights: THREE.PointLight[];
  updateGrass: (px: number, pz: number, maxRadius: number, maxCount: number) => void;
  rebuildTerrainAndWater: (terrainSegs: number, waterSegs: number) => void;
}

function buildTerrainGeometry(segments: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const biomes = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = groundHeightAt(x, z);
    pos.setY(i, h);

    const w = getBiomeWeights(x, z, h);
    biomes[i * 4 + 0] = Math.min(1, w.forest + w.meadow * 1.15);
    biomes[i * 4 + 1] = w.desert;
    biomes[i * 4 + 2] = w.snow;
    biomes[i * 4 + 3] = w.marsh;
  }

  geo.setAttribute('aBiome', new THREE.BufferAttribute(biomes, 4));
  geo.computeVertexNormals();
  return geo;
}

function buildWaterGeometry(segments: number): THREE.BufferGeometry {
  const waterSize = 780;
  const geo = new THREE.PlaneGeometry(waterSize, waterSize, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const depths = new Float32Array(count);
  const flows = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const groundY = groundHeightAt(x, z);
    const depth = Math.max(0.0, WATER_LEVEL - groundY);
    depths[i] = depth;

    // Higher flow speed in narrow river channel & near waterfall plunge pool
    const { dist } = waterDistanceInfo(x, z);
    const isLake = Math.hypot((x + 22) / 56, (z - 34) / 48) < 1.05;
    const nearFalls = Math.hypot(x - 20, z + 124) < 26;
    flows[i] = nearFalls ? 1.0 : isLake ? 0.15 : dist < 0 ? 0.72 : 0.2;
  }

  geo.setAttribute('aWaterDepth', new THREE.BufferAttribute(depths, 1));
  geo.setAttribute('aFlowSpeed', new THREE.BufferAttribute(flows, 1));
  return geo;
}

function createDeformedRockGeometry(radius: number, detail: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(radius, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const n = fbm2D(vx * 0.9 + seed, vz * 0.9 - seed, 3);
    const strata = Math.sin(vy * 3.2 + seed) * 0.12;
    const scale = 0.78 + n * 0.48 + strata;
    pos.setXYZ(i, vx * scale, vy * (0.72 + n * 0.35), vz * scale);
  }
  geo.computeVertexNormals();
  return geo;
}

// Builds a single crossed-quad grass tuft geometry (2 intersecting curved blades)
function createGrassTuftGeometry(): THREE.BufferGeometry {
  const makeBlade = (rotY: number, tilt: number, w: number, h: number) => {
    const g = new THREE.PlaneGeometry(w, h, 1, 3);
    g.translate(0, h * 0.5, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = y / h;
      p.setZ(i, p.getZ(i) + t * t * tilt);
    }
    g.rotateY(rotY);
    g.computeVertexNormals();
    return g;
  };
  const b1 = makeBlade(0, 0.14, 0.24, 0.85);
  const b2 = makeBlade(Math.PI / 3, 0.12, 0.22, 0.78);
  const b3 = makeBlade(-Math.PI / 3, 0.16, 0.22, 0.72);
  const merged = BufferGeometryUtils.mergeGeometries([b1, b2, b3]);
  b1.dispose();
  b2.dispose();
  b3.dispose();
  return merged;
}

// Builds a multi-part Oak tree canopy card geometry cluster
function createOakCrownGeometry(): THREE.BufferGeometry {
  const cards: THREE.BufferGeometry[] = [];
  const rand = seededRandom(777);
  for (let i = 0; i < 16; i++) {
    const p = new THREE.PlaneGeometry(2.6 + rand() * 1.4, 2.3 + rand() * 1.2);
    p.rotateX((rand() - 0.5) * 0.9);
    p.rotateY(rand() * Math.PI * 2);
    p.rotateZ((rand() - 0.5) * 0.6);
    const ang = rand() * Math.PI * 2;
    const r = 0.4 + rand() * 1.8;
    p.translate(Math.cos(ang) * r, (rand() - 0.3) * 1.9, Math.sin(ang) * r);
    cards.push(p);
  }
  const merged = BufferGeometryUtils.mergeGeometries(cards);
  cards.forEach((c) => c.dispose());
  merged.computeVertexNormals();
  return merged;
}

// Builds a Pine bough tiered geometry cluster
function createPineCrownGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers = [
    { y: 2.2, r: 2.3, h: 2.4 },
    { y: 3.9, r: 1.9, h: 2.3 },
    { y: 5.5, r: 1.45, h: 2.1 },
    { y: 6.9, r: 0.95, h: 1.9 },
  ];
  tiers.forEach((t, idx) => {
    const cone = new THREE.ConeGeometry(t.r, t.h, 9, 2, true);
    const pos = cone.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const wave = Math.sin(Math.atan2(vz, vx) * 5 + idx) * 0.16;
      if (vy < 0) {
        pos.setXYZ(i, vx * (1 + wave), vy - Math.abs(wave) * 0.4, vz * (1 + wave));
      }
    }
    cone.translate(0, t.y, 0);
    cone.computeVertexNormals();
    parts.push(cone);
  });
  const merged = BufferGeometryUtils.mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

function createTrunkWithRootsGeometry(height: number, baseR: number, topR: number, seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(topR, baseR, height, 8, 4);
  trunk.translate(0, height * 0.5, 0);
  // Subtle organic bend
  const pos = trunk.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / height;
    pos.setX(i, pos.getX(i) + Math.sin(t * 2.8 + seed) * 0.18 * t);
  }
  trunk.computeVertexNormals();
  parts.push(trunk);

  // Flared roots gripping soil
  for (let r = 0; r < 4; r++) {
    const ang = (r / 4) * Math.PI * 2 + seed * 0.7;
    const root = new THREE.CylinderGeometry(baseR * 0.25, baseR * 0.65, baseR * 2.2, 5);
    root.rotateZ(Math.PI * 0.34);
    root.rotateY(ang);
    root.translate(Math.cos(ang) * baseR * 0.75, baseR * 0.35, Math.sin(ang) * baseR * 0.75);
    parts.push(root);
  }

  // Forking upper branches
  for (let b = 0; b < 3; b++) {
    const ang = (b / 3) * Math.PI * 2 + seed;
    const br = new THREE.CylinderGeometry(topR * 0.35, topR * 0.7, height * 0.32, 5);
    br.rotateZ(0.55);
    br.rotateY(ang);
    br.translate(Math.cos(ang) * 0.6, height * 0.78, Math.sin(ang) * 0.6);
    parts.push(br);
  }

  const merged = BufferGeometryUtils.mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

export function buildOpenWorld(
  textures: ProceduralTextureSet,
  env: SharedEnvUniforms,
  initialTerrainSegs: number,
  initialWaterSegs: number
): WorldHandles {
  const root = new THREE.Group();
  const colliders: CylinderCollider[] = [];
  const boxColliders: BoxCollider[] = [];
  const bridges: BridgeWalkway[] = [];
  const treePositions: { x: number; y: number; z: number }[] = [];
  const flowerPositions: { x: number; y: number; z: number }[] = [];
  const lanternLights: THREE.PointLight[] = [];

  // 1. TERRAIN
  const terrainMat = createTerrainMaterial(textures, env);
  const terrainMesh = new THREE.Mesh(buildTerrainGeometry(initialTerrainSegs), terrainMat);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = false;
  root.add(terrainMesh);

  // 2. WATER SURFACE (River + Lake + Plunge Pool)
  const waterMat = createWaterMaterial(env);
  const waterMesh = new THREE.Mesh(buildWaterGeometry(initialWaterSegs), waterMat);
  waterMesh.position.y = WATER_LEVEL;
  waterMesh.renderOrder = 2;
  root.add(waterMesh);

  // Upper Mountain Stream feeding the Waterfall
  const upperStreamGeo = new THREE.PlaneGeometry(16, 110, 12, 32);
  upperStreamGeo.rotateX(-Math.PI / 2);
  const uPos = upperStreamGeo.attributes.position as THREE.BufferAttribute;
  const uDepth = new Float32Array(uPos.count);
  const uFlow = new Float32Array(uPos.count);
  for (let i = 0; i < uPos.count; i++) {
    const wx = 20 + uPos.getX(i);
    const wz = -198 + uPos.getZ(i);
    uPos.setX(i, wx);
    uPos.setZ(i, wz);
    uPos.setY(i, groundHeightAt(wx, wz) + 0.35);
    uDepth[i] = 1.1;
    uFlow[i] = 1.15;
  }
  upperStreamGeo.setAttribute('aWaterDepth', new THREE.BufferAttribute(uDepth, 1));
  upperStreamGeo.setAttribute('aFlowSpeed', new THREE.BufferAttribute(uFlow, 1));
  const upperStreamMesh = new THREE.Mesh(upperStreamGeo, waterMat);
  root.add(upperStreamMesh);

  // 3. WATERFALL CASCADE (at x=20, z=-138)
  const waterfallMat = createWaterfallMaterial(env);
  const wfGroup = new THREE.Group();
  wfGroup.position.set(20, 11.5, -138);
  const wfMain = new THREE.Mesh(new THREE.PlaneGeometry(13, 27, 8, 16), waterfallMat);
  wfMain.rotation.x = -0.14;
  wfGroup.add(wfMain);
  const wfVeil = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 25, 6, 12), waterfallMat);
  wfVeil.position.set(0.4, -0.4, 0.9);
  wfVeil.rotation.x = -0.18;
  wfGroup.add(wfVeil);
  root.add(wfGroup);

  // 4. FOREST TREES (Instanced Multi-Part Trunks + Wind-Animated Canopies)
  const rand = seededRandom(918273);
  const trunkMatPine = new THREE.MeshStandardMaterial({
    map: textures.barkPineMap,
    normalMap: textures.barkNormal,
    roughness: 0.92,
    metalness: 0.0,
  });
  const trunkMatOak = new THREE.MeshStandardMaterial({
    map: textures.barkOakMap,
    normalMap: textures.barkNormal,
    roughness: 0.9,
    metalness: 0.0,
  });
  const trunkMatBirch = new THREE.MeshStandardMaterial({
    map: textures.barkBirchMap,
    normalMap: textures.barkNormal,
    roughness: 0.82,
    metalness: 0.0,
  });

  const canopyMat = createFoliageCanopyMaterial(textures, env);

  const pineTransforms: { x: number; y: number; z: number; s: number; ry: number; leanX: number; leanZ: number }[] = [];
  const oakTransforms: { x: number; y: number; z: number; s: number; ry: number; leanX: number; leanZ: number }[] = [];
  const birchTransforms: { x: number; y: number; z: number; s: number; ry: number; leanX: number; leanZ: number }[] = [];

  for (let i = 0; i < 1650; i++) {
    const x = (rand() - 0.5) * 760;
    const z = (rand() - 0.5) * 760;

    // Exclude spawn camp clearing, abandoned village core, cavern mouth, bridge & water
    if (Math.hypot(x + 16, z - 76) < 15) continue;
    if (Math.hypot(x - 106, z - 18) < 28) continue;
    if (Math.hypot(x + 134, z + 118) < 26) continue;
    if (Math.hypot(x - 42, z - 12) < 16) continue;

    const { dist } = waterDistanceInfo(x, z);
    if (dist < 4.5) continue;

    const h = groundHeightAt(x, z);
    if (h < 0.7 || h > 29) continue;

    const n = groundNormalAt(x, z);
    if (n.ny < 0.78) continue; // No trees on sheer vertical cliffs

    const w = getBiomeWeights(x, z, h);
    if (w.desert > 0.35) continue;

    // Higher density in forest, sparser in meadow/marsh/foothills
    const densityProb = w.forest * 0.92 + w.mountain * 0.45 + w.marsh * 0.35 + w.meadow * 0.14;
    if (rand() > densityProb) continue;

    const s = 0.75 + rand() * 0.75;
    const ry = rand() * Math.PI * 2;
    const leanX = (rand() - 0.5) * 0.08;
    const leanZ = (rand() - 0.5) * 0.08;

    const roll = rand();
    if (h > 11 || w.mountain > 0.3 || roll < 0.54) {
      pineTransforms.push({ x, y: h - 0.15, z, s, ry, leanX, leanZ });
    } else if (roll < 0.82) {
      oakTransforms.push({ x, y: h - 0.15, z, s, ry, leanX, leanZ });
    } else {
      birchTransforms.push({ x, y: h - 0.15, z, s, ry, leanX, leanZ });
    }

    treePositions.push({ x, y: h + 4.5 * s, z });
    colliders.push({ x, z, r: 0.52 * s });
  }

  const treeCanopyGroup = new THREE.Group();
  root.add(treeCanopyGroup);

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  // Instanced Pines
  if (pineTransforms.length > 0) {
    const pineTrunkGeo = createTrunkWithRootsGeometry(8.2, 0.44, 0.12, 1.2);
    const pineCrownGeo = createPineCrownGeometry();
    const pineTrunks = new THREE.InstancedMesh(pineTrunkGeo, trunkMatPine, pineTransforms.length);
    const pineCrowns = new THREE.InstancedMesh(pineCrownGeo, canopyMat, pineTransforms.length);
    pineTrunks.castShadow = true;
    pineTrunks.receiveShadow = true;
    pineCrowns.castShadow = true;
    pineCrowns.receiveShadow = true;

    pineTransforms.forEach((t, idx) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(t.leanX, t.ry, t.leanZ);
      dummy.scale.set(t.s, t.s * (0.9 + (idx % 5) * 0.06), t.s);
      dummy.updateMatrix();
      pineTrunks.setMatrixAt(idx, dummy.matrix);
      pineCrowns.setMatrixAt(idx, dummy.matrix);

      // Natural conifer hue variation + alpine frost near high altitude
      const snowMix = Math.max(0, Math.min(1, (t.y - 19) / 10));
      col.setHSL(0.31 + ((idx * 17) % 100) * 0.0005, 0.38, 0.22 + ((idx * 7) % 10) * 0.012);
      col.lerp(new THREE.Color(0xcbd8e2), snowMix * 0.58);
      pineCrowns.setColorAt(idx, col);
    });
    pineTrunks.computeBoundingSphere();
    pineCrowns.computeBoundingSphere();
    root.add(pineTrunks);
    treeCanopyGroup.add(pineCrowns);
  }

  // Instanced Oaks
  if (oakTransforms.length > 0) {
    const oakTrunkGeo = createTrunkWithRootsGeometry(5.6, 0.52, 0.2, 3.7);
    const oakCrownGeo = createOakCrownGeometry();
    oakCrownGeo.translate(0, 5.4, 0);
    const oakTrunks = new THREE.InstancedMesh(oakTrunkGeo, trunkMatOak, oakTransforms.length);
    const oakCrowns = new THREE.InstancedMesh(oakCrownGeo, canopyMat, oakTransforms.length);
    oakTrunks.castShadow = true;
    oakTrunks.receiveShadow = true;
    oakCrowns.castShadow = true;
    oakCrowns.receiveShadow = true;

    oakTransforms.forEach((t, idx) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(t.leanX, t.ry, t.leanZ);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      oakTrunks.setMatrixAt(idx, dummy.matrix);
      oakCrowns.setMatrixAt(idx, dummy.matrix);

      const autumnChance = (idx % 9 === 0) ? 0.11 : 0;
      col.setHSL(0.26 - autumnChance + ((idx * 13) % 40) * 0.001, 0.45, 0.34 + ((idx * 5) % 10) * 0.014);
      oakCrowns.setColorAt(idx, col);
    });
    oakTrunks.computeBoundingSphere();
    oakCrowns.computeBoundingSphere();
    root.add(oakTrunks);
    treeCanopyGroup.add(oakCrowns);
  }

  // Instanced Birches
  if (birchTransforms.length > 0) {
    const birchTrunkGeo = createTrunkWithRootsGeometry(6.8, 0.28, 0.09, 6.4);
    const birchCrownGeo = createOakCrownGeometry();
    birchCrownGeo.scale(0.85, 1.15, 0.85);
    birchCrownGeo.translate(0, 6.2, 0);
    const birchTrunks = new THREE.InstancedMesh(birchTrunkGeo, trunkMatBirch, birchTransforms.length);
    const birchCrowns = new THREE.InstancedMesh(birchCrownGeo, canopyMat, birchTransforms.length);
    birchTrunks.castShadow = true;
    birchTrunks.receiveShadow = true;
    birchCrowns.castShadow = true;
    birchCrowns.receiveShadow = true;

    birchTransforms.forEach((t, idx) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(t.leanX, t.ry, t.leanZ);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      birchTrunks.setMatrixAt(idx, dummy.matrix);
      birchCrowns.setMatrixAt(idx, dummy.matrix);

      col.setHSL(0.21 + ((idx * 11) % 30) * 0.001, 0.52, 0.42);
      birchCrowns.setColorAt(idx, col);
    });
    birchTrunks.computeBoundingSphere();
    birchCrowns.computeBoundingSphere();
    root.add(birchTrunks);
    treeCanopyGroup.add(birchCrowns);
  }

  // Fallen Mossy Logs & Forest Shrubs
  const fallenLogMat = trunkMatOak;
  const fallenGeo = new THREE.CylinderGeometry(0.28, 0.34, 4.8, 7);
  fallenGeo.rotateZ(Math.PI * 0.5);
  const fallenLogs = new THREE.InstancedMesh(fallenGeo, fallenLogMat, 55);
  fallenLogs.castShadow = true;
  fallenLogs.receiveShadow = true;
  let logCount = 0;
  for (let i = 0; i < 90 && logCount < 55; i++) {
    const lx = (rand() - 0.5) * 360;
    const lz = (rand() - 0.5) * 360;
    const { dist } = waterDistanceInfo(lx, lz);
    const h = groundHeightAt(lx, lz);
    if (dist < 4 || h < 1 || h > 16 || Math.hypot(lx + 16, lz - 76) < 10) continue;
    dummy.position.set(lx, h + 0.16, lz);
    dummy.rotation.set((rand() - 0.5) * 0.12, rand() * Math.PI * 2, (rand() - 0.5) * 0.12);
    dummy.scale.setScalar(0.8 + rand() * 0.6);
    dummy.updateMatrix();
    fallenLogs.setMatrixAt(logCount++, dummy.matrix);
  }
  fallenLogs.count = logCount;
  fallenLogs.computeBoundingSphere();
  root.add(fallenLogs);

  // 5. ROCKS, BOULDERS & CLIFF OUTCROPS (Instanced Deformed Shapes)
  const rockMat = new THREE.MeshStandardMaterial({
    map: textures.rockMap,
    normalMap: textures.rockNormal,
    roughness: 0.86,
    metalness: 0.04,
  });
  const boulderGeo = createDeformedRockGeometry(1.4, 1, 2.3);
  const rockInstances = new THREE.InstancedMesh(boulderGeo, rockMat, 420);
  rockInstances.castShadow = true;
  rockInstances.receiveShadow = true;
  let rockIdx = 0;
  for (let i = 0; i < 650 && rockIdx < 420; i++) {
    const rx = (rand() - 0.5) * 620;
    const rz = (rand() - 0.5) * 620;
    if (Math.hypot(rx + 16, rz - 76) < 12) continue;
    if (Math.hypot(rx - 42, rz - 12) < 14) continue;
    const h = groundHeightAt(rx, rz);
    const w = getBiomeWeights(rx, rz, h);
    const { dist } = waterDistanceInfo(rx, rz);
    const nearBank = Math.abs(dist) < 5;
    if (!nearBank && w.mountain < 0.25 && rand() > 0.35) continue;

    const scale = nearBank ? 0.5 + rand() * 1.1 : 0.7 + rand() * 2.2;
    dummy.position.set(rx, h + scale * 0.22, rz);
    dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    dummy.scale.set(scale * (0.8 + rand() * 0.5), scale * (0.55 + rand() * 0.5), scale * (0.8 + rand() * 0.5));
    dummy.updateMatrix();
    rockInstances.setMatrixAt(rockIdx, dummy.matrix);

    // Wet/mossy tint near river & falls, granite grey in mountains
    const wetTint = nearBank ? 0.58 : 0.92;
    col.setRGB(wetTint, wetTint * (nearBank ? 1.05 : 0.98), wetTint * 0.95);
    rockInstances.setColorAt(rockIdx, col);
    if (scale > 1.2) {
      colliders.push({ x: rx, z: rz, r: scale * 0.95 });
    }
    rockIdx++;
  }
  rockInstances.count = rockIdx;
  rockInstances.computeBoundingSphere();
  root.add(rockInstances);

  // 5B. MONUMENTAL GRANITE MOUNTAIN SPIRES & CASCADE GORGE CLIFF BUTTRESSES
  const spireGeo = createDeformedRockGeometry(5.8, 2, 11.4);
  const spireMat = new THREE.MeshStandardMaterial({
    map: textures.rockMap,
    normalMap: textures.rockNormal,
    color: 0x858a90,
    roughness: 0.88,
    metalness: 0.05,
  });
  const spirePlacements: { x: number; z: number; sx: number; sy: number; sz: number; ry: number }[] = [
    // Flanking Cascade Falls gorge (x=20, z=-138)
    { x: 4, z: -136, sx: 1.8, sy: 3.4, sz: 1.7, ry: 0.4 },
    { x: 37, z: -135, sx: 1.9, sy: 3.6, sz: 1.6, ry: -0.7 },
    { x: -12, z: -148, sx: 2.2, sy: 4.1, sz: 2.0, ry: 1.1 },
    { x: 52, z: -152, sx: 2.4, sy: 4.3, sz: 2.1, ry: 2.2 },
    // Northern Alpine Skyline Spires
    { x: -86, z: -182, sx: 3.2, sy: 5.5, sz: 2.8, ry: 0.8 },
    { x: -42, z: -195, sx: 3.5, sy: 6.2, sz: 3.0, ry: 1.7 },
    { x: 18, z: -215, sx: 3.8, sy: 6.8, sz: 3.1, ry: 0.2 },
    { x: 74, z: -192, sx: 3.4, sy: 5.8, sz: 2.9, ry: 2.6 },
    { x: 126, z: -178, sx: 3.1, sy: 5.1, sz: 2.6, ry: 1.1 },
    { x: -142, z: -165, sx: 2.8, sy: 4.8, sz: 2.5, ry: 0.5 },
  ];
  const spiresMesh = new THREE.InstancedMesh(spireGeo, spireMat, spirePlacements.length);
  spiresMesh.castShadow = true;
  spiresMesh.receiveShadow = true;
  spirePlacements.forEach((sp, i) => {
    const syBase = groundHeightAt(sp.x, sp.z);
    dummy.position.set(sp.x, syBase + sp.sy * 1.4, sp.z);
    dummy.rotation.set(0.06, sp.ry, -0.05);
    dummy.scale.set(sp.sx, sp.sy, sp.sz);
    dummy.updateMatrix();
    spiresMesh.setMatrixAt(i, dummy.matrix);
  });
  spiresMesh.computeBoundingSphere();
  root.add(spiresMesh);

  // 5C. FOREST FERNS & SHORELINE BUSH CLUSTERS (sharing wind-animated canopyMat)
  const fernCards: THREE.BufferGeometry[] = [];
  for (let f = 0; f < 5; f++) {
    const card = new THREE.PlaneGeometry(1.15, 0.95);
    card.translate(0, 0.44, 0);
    card.rotateX(0.42);
    card.rotateY((f / 5) * Math.PI * 2);
    fernCards.push(card);
  }
  const fernGeo = BufferGeometryUtils.mergeGeometries(fernCards);
  fernCards.forEach((c) => c.dispose());
  const fernMesh = new THREE.InstancedMesh(fernGeo, canopyMat, 360);
  fernMesh.castShadow = true;
  fernMesh.receiveShadow = true;
  let fernCount = 0;
  for (let i = 0; i < 640 && fernCount < 360; i++) {
    const fx = (rand() - 0.5) * 320;
    const fz = (rand() - 0.5) * 320;
    const { dist } = waterDistanceInfo(fx, fz);
    const h = groundHeightAt(fx, fz);
    const n = groundNormalAt(fx, fz);
    if (dist < 1.2 || h < 0.45 || h > 16 || n.ny < 0.8) continue;
    if (Math.hypot(fx + 16, fz - 76) < 4.5) continue;
    const fs = 0.65 + rand() * 0.75;
    dummy.position.set(fx, h - 0.05, fz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(fs, fs * (0.8 + rand() * 0.4), fs);
    dummy.updateMatrix();
    fernMesh.setMatrixAt(fernCount, dummy.matrix);
    col.setHSL(0.27 + rand() * 0.05, 0.48, 0.25 + rand() * 0.12);
    fernMesh.setColorAt(fernCount, col);
    fernCount++;
  }
  fernMesh.count = fernCount;
  fernMesh.computeBoundingSphere();
  treeCanopyGroup.add(fernMesh);

  // 6. ECHO CAVERN (Exploreable Deep Rock Vault + Stalactites + Mineral Pool)
  const caveGroup = buildEchoCavern(textures, env, colliders);
  root.add(caveGroup);

  // 7. OLD TIMBER RIVER BRIDGE (at x=42, z=12 spanning river)
  buildRiverBridge(root, textures, bridges, boxColliders);

  // 8. ABANDONED VILLAGE (Detailed Cabins, Porches, Lanterns, Dock, Rusted Expedition 4x4)
  buildAbandonedVillage(root, textures, boxColliders, colliders, lanternLights);

  // 9. FOREST SURVIVAL CAMP & INTERACTIVE CAMPFIRE (at x=-16, z=76)
  const campfirePos = new THREE.Vector3(-16, groundHeightAt(-16, 76), 76);
  buildSurvivalCamp(root, textures, campfirePos, colliders, lanternLights);

  // Combat & Interactive Anchors (Crates + Training Totems at Camp & Village)
  const crateAnchors: CrateAnchor[] = [
    { x: campfirePos.x + 3.4, z: campfirePos.z - 2.6, rotY: 0.35 },
    { x: campfirePos.x + 4.5, z: campfirePos.z - 1.9, rotY: -0.2 },
    { x: campfirePos.x + 3.9, z: campfirePos.z - 3.6, rotY: 0.85 },
    { x: 98, z: 13, rotY: 0.4 },
    { x: 99.3, z: 13.7, rotY: -0.3 },
    { x: 111, z: 24, rotY: 0.7 },
  ];
  const totemAnchors: TotemAnchor[] = [
    { x: campfirePos.x + 5.8, z: campfirePos.z + 2.4 },
    { x: 91, z: 22 },
  ];

  // 10. DYNAMIC INSTANCED GRASS & WILDFLOWERS (Sliding Window around Player)
  const MAX_GRASS = 24000;
  const grassGeo = createGrassTuftGeometry();
  const grassMat = createGrassMaterial(textures, env);
  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, MAX_GRASS);
  grassMesh.frustumCulled = false;
  grassMesh.receiveShadow = true;
  root.add(grassMesh);

  const MAX_FLOWERS = 900;
  const flowerGeo = new THREE.ConeGeometry(0.14, 0.22, 5);
  flowerGeo.rotateX(Math.PI);
  flowerGeo.translate(0, 0.34, 0);
  const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.0 });
  const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, MAX_FLOWERS);
  flowerMesh.frustumCulled = false;
  root.add(flowerMesh);

  let lastGrassX = 99999;
  let lastGrassZ = 99999;
  let lastGrassRadius = -1;
  let lastGrassLimit = -1;

  const updateGrass = (px: number, pz: number, maxRadius: number, maxCount: number) => {
    const moved = Math.hypot(px - lastGrassX, pz - lastGrassZ);
    if (moved < 7.5 && maxRadius === lastGrassRadius && maxCount === lastGrassLimit) return;

    lastGrassX = px;
    lastGrassZ = pz;
    lastGrassRadius = maxRadius;
    lastGrassLimit = maxCount;

    const step = Math.max(0.7, (maxRadius * 1.95) / Math.sqrt(maxCount));
    let idx = 0;
    let fIdx = 0;
    flowerPositions.length = 0;

    const startX = Math.floor((px - maxRadius) / step) * step;
    const startZ = Math.floor((pz - maxRadius) / step) * step;

    for (let gx = startX; gx <= px + maxRadius && idx < maxCount; gx += step) {
      for (let gz = startZ; gz <= pz + maxRadius && idx < maxCount; gz += step) {
        // Deterministic spatial jitter per grid cell so grass never marches when player walks
        const cellHash = Math.sin(gx * 12.9898 + gz * 78.233) * 43758.5453;
        const jx = (cellHash - Math.floor(cellHash) - 0.5) * step * 0.92;
        const cellHash2 = Math.sin(gx * 39.346 + gz * 11.135) * 24634.6345;
        const jz = (cellHash2 - Math.floor(cellHash2) - 0.5) * step * 0.92;
        const wx = gx + jx;
        const wz = gz + jz;

        const dPlayer = Math.hypot(wx - px, wz - pz);
        if (dPlayer > maxRadius) continue;

        // Exclude campfire center, cave deep interior, water & steep cliffs
        if (Math.hypot(wx - campfirePos.x, wz - campfirePos.z) < 2.8) continue;
        const cave = getCaveProximity(wx, wz);
        if (cave.inCaveZone > 0.35) continue;

        const { dist } = waterDistanceInfo(wx, wz);
        if (dist < 0.8) continue;

        const h = groundHeightAt(wx, wz);
        if (h < 0.35 || h > 24.5) continue;

        const n = groundNormalAt(wx, wz);
        if (n.ny < 0.72) continue;

        const w = getBiomeWeights(wx, wz, h);
        if (w.desert > 0.42 || w.snow > 0.55) continue;

        const patch = fbm2D(wx * 0.08, wz * 0.08, 2);
        if (patch < -0.18) continue;

        const scaleH = (0.55 + (cellHash - Math.floor(cellHash)) * 0.85) * (0.7 + w.meadow * 0.45 + w.marsh * 0.55);
        dummy.position.set(wx, h - 0.04, wz);
        dummy.rotation.set(0, (cellHash2 - Math.floor(cellHash2)) * Math.PI * 2, 0);
        dummy.scale.set(0.85 + patch * 0.35, scaleH, 0.85 + patch * 0.35);
        dummy.updateMatrix();
        grassMesh.setMatrixAt(idx, dummy.matrix);

        // Biome-calibrated natural grass colors
        const r = 0.24 + w.meadow * 0.14 + w.marsh * 0.06 + (patch + 0.3) * 0.08;
        const g = 0.36 + w.meadow * 0.16 + w.forest * 0.06 + (patch + 0.3) * 0.09;
        const b = 0.12 + w.marsh * 0.06;
        col.setRGB(r, g, b);
        grassMesh.setColorAt(idx, col);
        idx++;

        // Wildflowers in meadows & clearings
        if (fIdx < MAX_FLOWERS && (w.meadow > 0.25 || w.forest > 0.4) && (Math.abs(cellHash) % 1) > 0.88) {
          dummy.position.set(wx, h, wz);
          dummy.scale.setScalar(0.8 + (cellHash2 - Math.floor(cellHash2)) * 0.6);
          dummy.updateMatrix();
          flowerMesh.setMatrixAt(fIdx, dummy.matrix);
          const fPalette = [0xf5d76e, 0xe88d9c, 0xa8c6fa, 0xfaf6eb];
          col.setHex(fPalette[fIdx % fPalette.length]);
          flowerMesh.setColorAt(fIdx, col);
          if (fIdx % 6 === 0) flowerPositions.push({ x: wx, y: h + 0.4, z: wz });
          fIdx++;
        }
      }
    }

    grassMesh.count = idx;
    grassMesh.instanceMatrix.needsUpdate = true;
    if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;

    flowerMesh.count = fIdx;
    flowerMesh.instanceMatrix.needsUpdate = true;
    if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
  };

  // Initial populate around camp spawn
  updateGrass(-16, 76, 62, 12000);

  const rebuildTerrainAndWater = (terrainSegs: number, waterSegs: number) => {
    terrainMesh.geometry.dispose();
    terrainMesh.geometry = buildTerrainGeometry(terrainSegs);
    waterMesh.geometry.dispose();
    waterMesh.geometry = buildWaterGeometry(waterSegs);
  };

  return {
    root,
    terrainMesh,
    waterMesh,
    grassMesh,
    flowerMesh,
    treeCanopyGroup,
    colliders,
    boxColliders,
    bridges,
    campfirePos,
    treePositions,
    flowerPositions,
    crateAnchors,
    totemAnchors,
    lanternLights,
    updateGrass,
    rebuildTerrainAndWater,
  };
}

function buildEchoCavern(
  textures: ProceduralTextureSet,
  env: SharedEnvUniforms,
  colliders: CylinderCollider[]
): THREE.Group {
  const group = new THREE.Group();
  const cx = -134;
  const cz = -124;
  const baseH = groundHeightAt(cx, cz);
  group.position.set(cx, baseH, cz);

  const wetRockMat = new THREE.MeshStandardMaterial({
    map: textures.rockMap,
    normalMap: textures.rockNormal,
    color: 0x5c636a,
    roughness: 0.34,
    metalness: 0.08,
  });

  const rand = seededRandom(55123);
  // Horseshoe cavern arch + vaulted roof boulders
  for (let i = 0; i < 28; i++) {
    const angle = (i / 27) * Math.PI * 1.45 + Math.PI * 0.78; // Open facing South-East (+Z/+X)
    const r = 13.5 + (rand() - 0.5) * 2.4;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const rockGeo = createDeformedRockGeometry(4.2 + rand() * 2.5, 1, i * 1.7);
    const mesh = new THREE.Mesh(rockGeo, wetRockMat);
    mesh.position.set(x, 2.2 + (rand() * 2.5), z);
    mesh.scale.set(1.2, 1.8, 1.2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push({ x: cx + x, z: cz + z, r: 3.4 });
  }

  // Vaulted roof slabs
  for (let i = 0; i < 12; i++) {
    const rx = (rand() - 0.5) * 18;
    const rz = -2 - rand() * 14;
    const capGeo = createDeformedRockGeometry(5.5 + rand() * 2.5, 1, 90 + i);
    const cap = new THREE.Mesh(capGeo, wetRockMat);
    cap.position.set(rx, 8.8 + rand() * 1.5, rz);
    cap.scale.set(1.6, 0.75, 1.5);
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);
  }

  // Stalactites hanging from ceiling + Stalagmites rising from floor
  const coneGeo = new THREE.ConeGeometry(0.45, 2.6, 7);
  for (let i = 0; i < 22; i++) {
    const sx = (rand() - 0.5) * 16;
    const sz = -1 - rand() * 12;
    const stalactite = new THREE.Mesh(coneGeo, wetRockMat);
    stalactite.position.set(sx, 7.2, sz);
    stalactite.rotation.x = Math.PI;
    stalactite.scale.setScalar(0.55 + rand() * 0.85);
    group.add(stalactite);

    if (i % 2 === 0) {
      const stalagmite = new THREE.Mesh(coneGeo, wetRockMat);
      stalagmite.position.set(sx * 0.85, 0.8, sz * 0.9);
      stalagmite.scale.setScalar(0.5 + rand() * 0.7);
      group.add(stalagmite);
    }
  }

  // Glowing damp cavern mineral pool
  const poolGeo = new THREE.CircleGeometry(5.2, 24);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshPhysicalMaterial({
    color: 0x1e5c6b,
    roughness: 0.04,
    metalness: 0.14,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.95,
    emissive: 0x0b2a36,
    emissiveIntensity: 0.48,
  });
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.position.set(-1.5, 0.06, -5.5);
  group.add(pool);

  // Subtle cavern mineral luminescence + light shaft glow
  const caveLight = new THREE.PointLight(0x529bb8, 2.4, 24, 1.6);
  caveLight.position.set(-1.5, 4.2, -5.5);
  group.add(caveLight);

  void env;
  return group;
}

function buildRiverBridge(
  root: THREE.Group,
  textures: ProceduralTextureSet,
  bridges: BridgeWalkway[],
  boxColliders: BoxCollider[]
): void {
  // River at z=12 has center around x=14..18, width ~28m
  const bz = 12;
  const cx = 18;
  const span = 34;
  const width = 4.2;
  const deckY = 1.65;

  const plankMat = new THREE.MeshStandardMaterial({
    map: textures.woodPlankMap,
    normalMap: textures.woodPlankNormal,
    roughness: 0.88,
    metalness: 0.04,
  });
  const timberMat = new THREE.MeshStandardMaterial({
    map: textures.barkOakMap,
    normalMap: textures.barkNormal,
    roughness: 0.92,
    metalness: 0.02,
  });

  const bridgeGroup = new THREE.Group();
  bridgeGroup.position.set(cx, 0, bz);

  // Support pilings driven into river bed
  const postGeo = new THREE.CylinderGeometry(0.22, 0.26, 6.5, 8);
  for (let px = -span * 0.45; px <= span * 0.45; px += 5.5) {
    for (const pz of [-width * 0.45, width * 0.45]) {
      const p = new THREE.Mesh(postGeo, timberMat);
      p.position.set(px, deckY - 1.7, pz);
      p.castShadow = true;
      p.receiveShadow = true;
      bridgeGroup.add(p);
    }
  }

  // Longitudinal stringer beams
  const beamGeo = new THREE.BoxGeometry(span, 0.28, 0.28);
  for (const pz of [-width * 0.42, 0, width * 0.42]) {
    const beam = new THREE.Mesh(beamGeo, timberMat);
    beam.position.set(0, deckY - 0.22, pz);
    beam.castShadow = true;
    bridgeGroup.add(beam);
  }

  // Individual weathered deck planks with slight natural variation
  const plankGeo = new THREE.BoxGeometry(0.56, 0.14, width);
  const rand = seededRandom(8842);
  for (let px = -span * 0.5; px <= span * 0.5; px += 0.62) {
    const plank = new THREE.Mesh(plankGeo, plankMat);
    plank.position.set(px, deckY + (rand() - 0.5) * 0.03, 0);
    plank.rotation.y = (rand() - 0.5) * 0.03;
    plank.castShadow = true;
    plank.receiveShadow = true;
    bridgeGroup.add(plank);
  }

  // Side rope/timber rails
  const railGeo = new THREE.BoxGeometry(span, 0.14, 0.14);
  for (const pz of [-width * 0.46, width * 0.46]) {
    const rail = new THREE.Mesh(railGeo, plankMat);
    rail.position.set(0, deckY + 0.95, pz);
    rail.castShadow = true;
    bridgeGroup.add(rail);
  }

  root.add(bridgeGroup);

  bridges.push({
    minX: cx - span * 0.5,
    maxX: cx + span * 0.5,
    minZ: bz - width * 0.5,
    maxZ: bz + width * 0.5,
    deckY: deckY + 0.07,
  });

  // Rail colliders so player stays on bridge
  boxColliders.push(
    { minX: cx - span * 0.5, maxX: cx + span * 0.5, minZ: bz - width * 0.5 - 0.3, maxZ: bz - width * 0.5 + 0.25, maxY: deckY + 2 },
    { minX: cx - span * 0.5, maxX: cx + span * 0.5, minZ: bz + width * 0.5 - 0.25, maxZ: bz + width * 0.5 + 0.3, maxY: deckY + 2 }
  );
}

function buildAbandonedVillage(
  root: THREE.Group,
  textures: ProceduralTextureSet,
  boxColliders: BoxCollider[],
  colliders: CylinderCollider[],
  lanternLights: THREE.PointLight[]
): void {
  const plankMat = new THREE.MeshStandardMaterial({
    map: textures.woodPlankMap,
    normalMap: textures.woodPlankNormal,
    roughness: 0.88,
    metalness: 0.04,
  });
  const timberPostMat = new THREE.MeshStandardMaterial({
    map: textures.barkOakMap,
    normalMap: textures.barkNormal,
    roughness: 0.9,
    metalness: 0.02,
  });
  const plasterMat = new THREE.MeshStandardMaterial({
    map: textures.plasterWallMap,
    normalMap: textures.rockNormal,
    roughness: 0.92,
    metalness: 0.02,
  });
  const stoneMat = new THREE.MeshStandardMaterial({
    map: textures.rockMap,
    normalMap: textures.rockNormal,
    roughness: 0.88,
  });
  const rustMat = new THREE.MeshStandardMaterial({
    map: textures.rustMetalMap,
    roughness: 0.72,
    metalness: 0.58,
  });
  const lanternGlassMat = new THREE.MeshStandardMaterial({
    color: 0xffd089,
    emissive: 0xff8c2b,
    emissiveIntensity: 1.65,
    roughness: 0.2,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x9ab3ba,
    roughness: 0.05,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 2.0,
    transparent: true,
    opacity: 0.46,
  });

  // Helper to build a detailed multi-part timber cabin with porch, shutters, chimney & lantern
  const buildCabin = (cx: number, cz: number, rotY: number, w: number, d: number, h: number, usePlaster: boolean) => {
    const baseY = groundHeightAt(cx, cz);
    const cabin = new THREE.Group();
    cabin.position.set(cx, baseY, cz);
    cabin.rotation.y = rotY;

    const wallMat = usePlaster ? plasterMat : plankMat;

    // Foundation stone plinth + front wooden porch deck & steps
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.45, 0.55, d + 0.45), stoneMat);
    plinth.position.y = 0.22;
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    cabin.add(plinth);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), plankMat);
    floor.position.y = 0.52;
    floor.receiveShadow = true;
    cabin.add(floor);

    const porchDeck = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.14, 1.55), plankMat);
    porchDeck.position.set(0, 0.48, d * 0.5 + 0.75);
    porchDeck.castShadow = true;
    porchDeck.receiveShadow = true;
    cabin.add(porchDeck);

    // Front Porch Steps
    for (let st = 0; st < 2; st++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 0.34), plankMat);
      step.position.set(0, 0.32 - st * 0.16, d * 0.5 + 1.62 + st * 0.32);
      step.castShadow = true;
      cabin.add(step);
    }

    // Structural Corner Log Posts
    const postGeo = new THREE.CylinderGeometry(0.11, 0.12, h + 0.2, 7);
    for (const px of [-w * 0.5 + 0.08, w * 0.5 - 0.08]) {
      for (const pz of [-d * 0.5 + 0.08, d * 0.5 - 0.08]) {
        const post = new THREE.Mesh(postGeo, timberPostMat);
        post.position.set(px, 0.52 + h * 0.5, pz);
        post.castShadow = true;
        cabin.add(post);
      }
    }

    // Front Porch Support Posts + Awning Beam
    for (const px of [-w * 0.46, -1.0, 1.0, w * 0.46]) {
      const pPost = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, h * 0.82, 6), timberPostMat);
      pPost.position.set(px, 0.52 + h * 0.41, d * 0.5 + 1.38);
      pPost.castShadow = true;
      cabin.add(pPost);
    }
    const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.1, 1.65), rustMat);
    porchRoof.position.set(0, 0.52 + h * 0.84, d * 0.5 + 0.76);
    porchRoof.rotation.x = 0.18;
    porchRoof.castShadow = true;
    cabin.add(porchRoof);

    // Back wall, Left wall, Right wall (with framed window & ajar shutters), Front wall with framed doorway
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.24), wallMat);
    backWall.position.set(0, 0.52 + h * 0.5, -d * 0.5 + 0.12);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    cabin.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.24, h, d), wallMat);
    leftWall.position.set(-w * 0.5 + 0.12, 0.52 + h * 0.5, 0);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    cabin.add(leftWall);

    // Right wall split for framed window
    const rightLower = new THREE.Mesh(new THREE.BoxGeometry(0.24, h * 0.42, d), wallMat);
    rightLower.position.set(w * 0.5 - 0.12, 0.52 + h * 0.21, 0);
    rightLower.castShadow = true;
    cabin.add(rightLower);

    const rightUpper = new THREE.Mesh(new THREE.BoxGeometry(0.24, h * 0.25, d), wallMat);
    rightUpper.position.set(w * 0.5 - 0.12, 0.52 + h * 0.875, 0);
    rightUpper.castShadow = true;
    cabin.add(rightUpper);

    const winW = d * 0.36;
    const winH = h * 0.33;
    const winY = 0.52 + h * 0.58;
    const winZ = -d * 0.12;
    const brokenPane = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), glassMat);
    brokenPane.position.set(w * 0.5 - 0.12, winY, winZ);
    brokenPane.rotation.y = Math.PI * 0.5;
    cabin.add(brokenPane);

    // Window Sill + Ajar Wooden Shutters
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, winW + 0.24), timberPostMat);
    sill.position.set(w * 0.5 - 0.08, winY - winH * 0.5, winZ);
    cabin.add(sill);
    for (const sgn of [-1, 1]) {
      const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.06, winH, winW * 0.46), plankMat);
      shutter.position.set(w * 0.5 + 0.06, winY, winZ + sgn * (winW * 0.68));
      shutter.rotation.y = sgn * 0.45;
      shutter.castShadow = true;
      cabin.add(shutter);
    }

    // Front wall flanking framed doorway + header lintel
    const segW = (w - 1.5) * 0.5;
    for (const sgn of [-1, 1]) {
      const fw = new THREE.Mesh(new THREE.BoxGeometry(segW, h, 0.24), wallMat);
      fw.position.set(sgn * (w * 0.5 - segW * 0.5), 0.52 + h * 0.5, d * 0.5 - 0.12);
      fw.castShadow = true;
      fw.receiveShadow = true;
      cabin.add(fw);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.45, 0.28), timberPostMat);
    lintel.position.set(0, 0.52 + h - 0.22, d * 0.5 - 0.12);
    cabin.add(lintel);

    // Gable end triangles + Pitched Roof Panels + Stone Chimney
    const roofPitch = 0.46;
    const roofSlopeLen = (w * 0.58) / Math.cos(roofPitch);
    const roofL = new THREE.Mesh(new THREE.BoxGeometry(roofSlopeLen, 0.12, d + 0.9), rustMat);
    roofL.position.set(-w * 0.27, 0.52 + h + 0.58, 0);
    roofL.rotation.z = roofPitch;
    roofL.castShadow = true;
    cabin.add(roofL);

    const roofR = new THREE.Mesh(new THREE.BoxGeometry(roofSlopeLen * 0.9, 0.12, d + 0.75), rustMat);
    roofR.position.set(w * 0.26, 0.52 + h + 0.46, 0.06);
    roofR.rotation.z = -roofPitch * 1.06;
    roofR.rotation.x = 0.03;
    roofR.castShadow = true;
    cabin.add(roofR);

    const ridgeBeam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, d + 1.0), timberPostMat);
    ridgeBeam.position.set(0, 0.52 + h + 1.15, 0);
    cabin.add(ridgeBeam);

    // Stone Chimney + Stovepipe rising above roof
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.82, h + 1.9, 0.82), stoneMat);
    chimney.position.set(-w * 0.32, 0.52 + (h + 1.9) * 0.5, -d * 0.34);
    chimney.castShadow = true;
    cabin.add(chimney);

    // Hanging Warm Porch Oil Lantern + PointLight
    const lanternHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.26, 8), lanternGlassMat);
    lanternHousing.position.set(1.05, 0.52 + h * 0.68, d * 0.5 + 1.36);
    cabin.add(lanternHousing);

    const lanternCap = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.1, 8), rustMat);
    lanternCap.position.set(1.05, 0.52 + h * 0.68 + 0.16, d * 0.5 + 1.36);
    cabin.add(lanternCap);

    const lanternLight = new THREE.PointLight(0xff9b42, 1.4, 15, 1.8);
    lanternLight.position.set(1.05, 0.52 + h * 0.62, d * 0.5 + 1.42);
    cabin.add(lanternLight);
    lanternLights.push(lanternLight);

    // Interior abandoned table & stools
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.9), plankMat);
    tableTop.position.set(-w * 0.18, 1.34, -d * 0.18);
    tableTop.castShadow = true;
    cabin.add(tableTop);
    for (const lx of [-0.6, 0.6]) {
      for (const lz of [-0.32, 0.32]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.78, 0.08), plankMat);
        leg.position.set(-w * 0.18 + lx, 0.92, -d * 0.18 + lz);
        cabin.add(leg);
      }
    }

    root.add(cabin);

    const rad = Math.max(w, d) * 0.46;
    colliders.push({ x: cx, z: cz, r: rad });
    void boxColliders;
  };

  buildCabin(94, 8, 0.35, 6.4, 5.2, 3.1, false);
  buildCabin(116, 22, -0.75, 7.2, 5.6, 3.3, true);
  buildCabin(98, 36, 1.15, 5.6, 4.8, 2.9, false);

  // Rusted Abandoned Expedition 4x4 Truck at (106, 20)
  const tx = 107;
  const tz = 19;
  const ty = groundHeightAt(tx, tz);
  const truck = new THREE.Group();
  truck.position.set(tx, ty + 0.45, tz);
  truck.rotation.set(0.04, 0.62, -0.06);

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.65, 4.4), rustMat);
  chassis.position.y = 0.35;
  chassis.castShadow = true;
  truck.add(chassis);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.92, 1.65), rustMat);
  cab.position.set(0, 1.1, 0.35);
  cab.castShadow = true;
  truck.add(cab);

  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.72, 0.65), glassMat);
  windshield.position.set(0, 1.14, 1.19);
  windshield.rotation.x = -0.18;
  truck.add(windshield);

  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.95, metalness: 0.05 });
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 14);
  wheelGeo.rotateZ(Math.PI * 0.5);
  for (const wx of [-1.02, 1.02]) {
    for (const wz of [-1.35, 1.38]) {
      const wheel = new THREE.Mesh(wheelGeo, tireMat);
      wheel.position.set(wx, -0.05, wz);
      wheel.castShadow = true;
      truck.add(wheel);
    }
  }
  root.add(truck);
  colliders.push({ x: tx, z: tz, r: 2.3 });

  // Weathered Wooden Lake Dock at (8, 36)
  const dock = new THREE.Group();
  dock.position.set(10, 0.45, 34);
  dock.rotation.y = -0.15;
  const dockDeck = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.16, 2.4), plankMat);
  dockDeck.castShadow = true;
  dockDeck.receiveShadow = true;
  dock.add(dockDeck);
  const pileGeo = new THREE.CylinderGeometry(0.14, 0.16, 3.2, 8);
  for (const px of [-3.6, 0, 3.6]) {
    for (const pz of [-1.05, 1.05]) {
      const pile = new THREE.Mesh(pileGeo, plankMat);
      pile.position.set(px, -0.9, pz);
      dock.add(pile);
    }
  }
  root.add(dock);
}

function buildSurvivalCamp(
  root: THREE.Group,
  textures: ProceduralTextureSet,
  campfirePos: THREE.Vector3,
  colliders: CylinderCollider[],
  lanternLights: THREE.PointLight[]
): void {
  const plankMat = new THREE.MeshStandardMaterial({
    map: textures.woodPlankMap,
    normalMap: textures.woodPlankNormal,
    roughness: 0.88,
  });
  const rockMat = new THREE.MeshStandardMaterial({
    map: textures.rockMap,
    normalMap: textures.rockNormal,
    roughness: 0.85,
  });
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x26292d,
    roughness: 0.48,
    metalness: 0.78,
  });
  const lanternGlassMat = new THREE.MeshStandardMaterial({
    color: 0xffd28c,
    emissive: 0xff9232,
    emissiveIntensity: 1.8,
    roughness: 0.2,
  });
  const canvasMat = new THREE.MeshStandardMaterial({
    map: textures.fabricMap,
    color: 0x5c6848,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });

  // Stone Ring, Crossed Charred Logs & Cooking Tripod Kettle
  const ringGroup = new THREE.Group();
  ringGroup.position.copy(campfirePos);
  const stoneGeo = createDeformedRockGeometry(0.24, 0, 4.1);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const st = new THREE.Mesh(stoneGeo, rockMat);
    st.position.set(Math.cos(a) * 0.72, 0.12, Math.sin(a) * 0.72);
    st.scale.set(1.1, 0.65, 1.1);
    st.castShadow = true;
    ringGroup.add(st);
  }
  const fireLogGeo = new THREE.CylinderGeometry(0.09, 0.11, 1.1, 7);
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(fireLogGeo, plankMat);
    const a = (i / 4) * Math.PI + 0.3;
    log.position.set(Math.cos(a) * 0.16, 0.18, Math.sin(a) * 0.16);
    log.rotation.z = Math.PI * 0.38;
    log.rotation.y = a;
    ringGroup.add(log);
  }

  // Lashed Tripod Poles + Hanging Cast-Iron Cooking Kettle
  const tripodPoleGeo = new THREE.CylinderGeometry(0.032, 0.042, 2.05, 6);
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + 0.4;
    const tp = new THREE.Mesh(tripodPoleGeo, plankMat);
    tp.position.set(Math.cos(ang) * 0.42, 0.9, Math.sin(ang) * 0.42);
    tp.rotation.order = 'YXZ';
    tp.rotation.y = -ang;
    tp.rotation.z = 0.34;
    tp.castShadow = true;
    ringGroup.add(tp);
  }
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.78, 5), ironMat);
  chain.position.set(0, 1.25, 0);
  ringGroup.add(chain);
  const pot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), ironMat);
  pot.scale.set(1.0, 0.82, 1.0);
  pot.position.set(0, 0.85, 0);
  pot.castShadow = true;
  ringGroup.add(pot);

  root.add(ringGroup);

  // Fallen Log Bench beside campfire
  const benchX = campfirePos.x - 2.6;
  const benchZ = campfirePos.z + 0.8;
  const benchY = groundHeightAt(benchX, benchZ);
  const bench = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 3.0, 9), plankMat);
  bench.position.set(benchX, benchY + 0.24, benchZ);
  bench.rotation.z = Math.PI * 0.5;
  bench.rotation.y = 1.2;
  bench.castShadow = true;
  bench.receiveShadow = true;
  root.add(bench);
  colliders.push({ x: benchX, z: benchZ, r: 0.6 });

  // Firewood Stack & Chopping Stump
  const stumpX = campfirePos.x + 2.1;
  const stumpZ = campfirePos.z + 2.2;
  const stumpY = groundHeightAt(stumpX, stumpZ);
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.58, 10), plankMat);
  stump.position.set(stumpX, stumpY + 0.28, stumpZ);
  stump.castShadow = true;
  stump.receiveShadow = true;
  root.add(stump);
  colliders.push({ x: stumpX, z: stumpZ, r: 0.45 });

  // Survival Lean-To Canvas Tarp Shelter + Hanging Camp Lantern Post
  const sx = campfirePos.x - 4.8;
  const sz = campfirePos.z - 2.5;
  const sy = groundHeightAt(sx, sz);
  const shelter = new THREE.Group();
  shelter.position.set(sx, sy, sz);
  shelter.rotation.y = 0.65;

  const poleGeo = new THREE.CylinderGeometry(0.06, 0.07, 2.7, 6);
  for (const px of [-1.6, 1.6]) {
    const pole = new THREE.Mesh(poleGeo, plankMat);
    pole.position.set(px, 1.25, 0.8);
    pole.castShadow = true;
    shelter.add(pole);
  }
  const ridgePole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6), plankMat);
  ridgePole.rotation.z = Math.PI * 0.5;
  ridgePole.position.set(0, 2.45, 0.8);
  shelter.add(ridgePole);

  const tarp = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 3.2, 6, 4), canvasMat);
  tarp.position.set(0, 1.38, -0.35);
  tarp.rotation.x = -0.82;
  tarp.castShadow = true;
  tarp.receiveShadow = true;
  shelter.add(tarp);

  // Hanging Camp Lantern on right shelter post
  const lArm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.45), plankMat);
  lArm.position.set(1.6, 2.38, 0.98);
  shelter.add(lArm);
  const campLantern = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.24, 8), lanternGlassMat);
  campLantern.position.set(1.6, 2.15, 1.15);
  shelter.add(campLantern);
  const campLanternLight = new THREE.PointLight(0xffa048, 1.6, 16, 1.8);
  campLanternLight.position.set(1.6, 2.08, 1.15);
  shelter.add(campLanternLight);
  lanternLights.push(campLanternLight);

  root.add(shelter);
  colliders.push({ x: sx, z: sz, r: 1.7 });
}
