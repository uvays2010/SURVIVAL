import { BiomeId } from './types';

export const WORLD_SIZE = 1280;
export const HALF_WORLD = WORLD_SIZE * 0.5;
export const WATER_LEVEL = 0.0;

// Deterministic hash & gradient noise (fast, zero-allocation)
const PERM = new Uint8Array(512);
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

(function initNoise() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 42197;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function noise2D(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = PERM[PERM[X] + Y] & 7;
  const ab = PERM[PERM[X] + Y + 1] & 7;
  const ba = PERM[PERM[X + 1] + Y] & 7;
  const bb = PERM[PERM[X + 1] + Y + 1] & 7;

  const gAA = GRAD2[aa][0] * xf + GRAD2[aa][1] * yf;
  const gBA = GRAD2[ba][0] * (xf - 1) + GRAD2[ba][1] * yf;
  const gAB = GRAD2[ab][0] * xf + GRAD2[ab][1] * (yf - 1);
  const gBB = GRAD2[bb][0] * (xf - 1) + GRAD2[bb][1] * (yf - 1);

  return lerp(lerp(gAA, gBA, u), lerp(gAB, gBB, u), v);
}

export function fbm2D(x: number, y: number, octaves = 4, lacunarity = 2.05, gain = 0.5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2D(x * freq, y * freq);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

export function ridged2D(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1.0 - Math.abs(noise2D(x * freq, y * freq));
    sum += amp * n * n;
    norm += amp;
    freq *= 2.1;
    amp *= 0.5;
  }
  return sum / norm;
}

export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// River centerline X coordinate as a function of Z
export function riverCenterX(z: number): number {
  return 20 - Math.sin(z * 0.015) * 26 - smoothstep(45, 280, z) * 145 + smoothstep(-140, -60, z) * 8;
}

export function riverHalfWidth(z: number): number {
  if (z < -130) return 9;
  const lakeJoin = smoothstep(-25, 35, z) * (1 - smoothstep(45, 95, z));
  return 11 + lakeJoin * 24 + smoothstep(100, 320, z) * 10;
}

// Distance to main water network (river + central lake + waterfall plunge pool)
export function waterDistanceInfo(x: number, z: number): { dist: number; depthFactor: number; isUpperStream: boolean } {
  // Central lake centered at (-22, 34)
  const dxLake = (x + 22) / 56;
  const dzLake = (z - 34) / 48;
  const lakeR = Math.sqrt(dxLake * dxLake + dzLake * dzLake);
  const lakeDist = (lakeR - 1.0) * 48;

  // Waterfall plunge pool at (20, -124)
  const dxPool = x - 20;
  const dzPool = z + 124;
  const poolDist = Math.sqrt(dxPool * dxPool + dzPool * dzPool) - 20;

  // Main river from z = -130 to +450
  let riverDist = 999;
  if (z >= -134 && z <= 480) {
    const cx = riverCenterX(z);
    const hw = riverHalfWidth(z);
    riverDist = Math.abs(x - cx) - hw;
  }

  // Upper mountain stream above waterfall (z < -144)
  let isUpperStream = false;
  let upperDist = 999;
  if (z < -144) {
    const ucx = 20 + Math.sin(z * 0.03) * 8;
    upperDist = Math.abs(x - ucx) - 8;
    if (upperDist < 12) isUpperStream = true;
  }

  const dist = Math.min(lakeDist, poolDist, riverDist);
  const depthFactor = smoothstep(4, -14, dist);
  return { dist, depthFactor, isUpperStream };
}

export interface BiomeWeights {
  forest: number;
  meadow: number;
  mountain: number;
  desert: number;
  marsh: number;
  village: number;
  snow: number;
}

export function getBiomeWeights(x: number, z: number, height: number): BiomeWeights {
  // Spatial biome regions with smooth organic domain warping
  const warpX = x + fbm2D(x * 0.004, z * 0.004, 2) * 38;
  const warpZ = z + fbm2D(x * 0.004 + 17.3, z * 0.004 - 9.1, 2) * 38;

  // Mountain belt in the north (z < -115) + far outer perimeter ring
  const distEdge = Math.max(Math.abs(x), Math.abs(z));
  const rimMountain = smoothstep(370, 540, distEdge);
  const northMountain = smoothstep(-95, -210, warpZ);
  const mountain = Math.min(1, Math.max(northMountain, rimMountain));

  // Desert in the southeast
  const desertX = smoothstep(75, 165, warpX);
  const desertZ = smoothstep(35, 125, warpZ);
  const desert = desertX * desertZ * (1 - rimMountain * 0.85);

  // Marsh in the southwest lowlands
  const marshX = smoothstep(-55, -145, warpX);
  const marshZ = smoothstep(85, 175, warpZ);
  const marsh = marshX * marshZ * (1 - mountain) * (1 - desert);

  // Wildflower meadow in west-northwest
  const meadowX = smoothstep(-55, -145, warpX);
  const meadowZ = smoothstep(60, -25, warpZ) * (1 - smoothstep(-65, -135, warpZ));
  const meadow = meadowX * meadowZ * (1 - mountain);

  // Abandoned village clearing east of river
  const dxV = (x - 108) / 56;
  const dzV = (z - 16) / 52;
  const village = smoothstep(1.0, 0.35, Math.sqrt(dxV * dxV + dzV * dzV));

  // Forest fills the lush temperate center
  let forest = Math.max(0, 1 - Math.max(mountain, desert, marsh, meadow * 0.85, village * 0.75));

  // Snow increases with height & northern latitude
  const snowAlt = smoothstep(23, 38, height + (z < -150 ? 4 : 0));
  const snow = Math.min(1, snowAlt * (0.45 + 0.55 * mountain));

  const total = forest + meadow + mountain + desert + marsh + 0.0001;
  return {
    forest: forest / total,
    meadow: meadow / total,
    mountain: mountain / total,
    desert: desert / total,
    marsh: marsh / total,
    village,
    snow,
  };
}

// Cave location: Echo Cavern mouth at (-134, -118) extending deeper north-west into mountain cliff
export function getCaveProximity(x: number, z: number): { inCaveZone: number; mouthDist: number } {
  const cx = -134;
  const cz = -124;
  const dx = x - cx;
  const dz = z - cz;
  const mouthDist = Math.sqrt(dx * dx + dz * dz);
  // Cave floor depression & interior enclosure factor
  const inside = smoothstep(26, 8, mouthDist) * smoothstep(-104, -124, z);
  return { inCaveZone: inside, mouthDist };
}

export function groundHeightAt(x: number, z: number): number {
  // Base organic rolling hills
  const n1 = fbm2D(x * 0.0045, z * 0.0045, 4);
  const n2 = fbm2D(x * 0.018 + 31.4, z * 0.018 - 14.2, 3);
  const detail = fbm2D(x * 0.065, z * 0.065, 2) * 0.55;

  let h = 2.8 + n1 * 7.5 + n2 * 2.2 + detail;

  // North Alpine Mountains & Waterfall Escarpment
  const warpZ = z + fbm2D(x * 0.005, z * 0.005, 2) * 26;
  const northCliff = smoothstep(-126, -158, warpZ);
  const ridge = ridged2D(x * 0.0075 + 4.1, z * 0.0075 - 2.7, 4);
  const mountainPeak = smoothstep(-135, -340, z) * (18 + ridge * 58);

  // Outer world boundary mountain amphitheater (natural perimeter, never boxed walls)
  const edgeR = Math.sqrt(x * x * 0.92 + z * z * 0.92);
  const outerRim = smoothstep(390, 610, edgeR) * (24 + ridge * 62);

  h += northCliff * 21.5 + mountainPeak + outerRim;

  // Upper waterfall stream channel cut into the cliff at x=20, z < -144
  if (z < -138) {
    const streamCx = 20 + Math.sin(z * 0.03) * 8;
    const streamDist = Math.abs(x - streamCx);
    const carve = smoothstep(14, 4, streamDist) * smoothstep(-138, -155, z);
    h -= carve * 4.5;
  }

  // Desert rolling sand dunes (SE)
  const desertFactor = smoothstep(85, 175, x) * smoothstep(45, 135, z) * (1 - smoothstep(380, 520, edgeR));
  if (desertFactor > 0.001) {
    const dune = Math.sin(x * 0.042 + fbm2D(x * 0.015, z * 0.015, 2) * 3.0) * 3.4 +
      fbm2D(x * 0.012 + 9, z * 0.012, 3) * 6.5;
    h = lerp(h, 4.2 + dune, desertFactor * 0.85);
  }

  // Marsh lowlands (SW)
  const marshFactor = smoothstep(-65, -150, x) * smoothstep(90, 175, z) * (1 - smoothstep(380, 520, edgeR));
  if (marshFactor > 0.001) {
    const marshRelief = fbm2D(x * 0.03, z * 0.03, 2) * 1.45;
    h = lerp(h, 0.35 + marshRelief, marshFactor * 0.88);
  }

  // Smooth forest camp clearing around (-16, 76)
  const campDist = Math.sqrt((x + 16) * (x + 16) + (z - 76) * (z - 76));
  const campFlat = smoothstep(26, 8, campDist);
  h = lerp(h, 3.2, campFlat * 0.88);

  // Smooth Abandoned Village terrace around (106, 18)
  const vilDist = Math.sqrt((x - 106) * (x - 106) + (z - 18) * (z - 18));
  const vilFlat = smoothstep(52, 22, vilDist);
  h = lerp(h, 3.6, vilFlat * 0.78);

  // Smooth Echo Cavern approach & flat cavern chamber floor around (-134, -124)
  const caveDx = x + 134;
  const caveDz = z + 124;
  const caveDist = Math.sqrt(caveDx * caveDx + caveDz * caveDz);
  const caveFloor = smoothstep(28, 12, caveDist);
  h = lerp(h, 4.0, caveFloor * 0.92);

  // Carve River, Waterfall Plunge Pool & Central Lake
  const { dist } = waterDistanceInfo(x, z);
  if (dist < 14) {
    const bankBlend = smoothstep(14, -10, dist);
    const targetWaterBed = dist < 0 ? lerp(-0.5, -5.2, smoothstep(0, -16, dist)) : lerp(h, 0.4, 0.65);
    h = lerp(h, targetWaterBed, bankBlend);
  }

  return h;
}

export function groundNormalAt(x: number, z: number): { nx: number; ny: number; nz: number } {
  const e = 0.6;
  const hL = groundHeightAt(x - e, z);
  const hR = groundHeightAt(x + e, z);
  const hD = groundHeightAt(x, z - e);
  const hU = groundHeightAt(x, z + e);
  const nx = hL - hR;
  const ny = 2 * e;
  const nz = hD - hU;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return { nx: nx / len, ny: ny / len, nz: nz / len };
}

export function getDominantBiome(x: number, z: number, height: number): { id: BiomeId; label: string } {
  const cave = getCaveProximity(x, z);
  if (cave.inCaveZone > 0.45) {
    return { id: 'CAVERN', label: 'Echo Cavern' };
  }
  const { dist } = waterDistanceInfo(x, z);
  if (dist < 1.5 && height < 0.4) {
    return { id: 'RIVER_LAKE', label: 'Crystal Basin' };
  }
  const w = getBiomeWeights(x, z, height);
  if (w.village > 0.45) return { id: 'ABANDONED_VILLAGE', label: 'Abandoned Settlement' };
  if (w.snow > 0.52) return { id: 'SNOW_PEAKS', label: 'Glacial Peaks' };
  if (w.mountain > 0.45) return { id: 'MOUNTAIN', label: 'Granite Foothills' };
  if (w.desert > 0.4) return { id: 'DESERT', label: 'Saffron Dunes' };
  if (w.marsh > 0.4) return { id: 'MARSH', label: 'Misty Wetlands' };
  if (w.meadow > 0.4) return { id: 'MEADOW', label: 'Wildflower Meadow' };
  return { id: 'FOREST', label: 'Emerald Old-Growth' };
}
