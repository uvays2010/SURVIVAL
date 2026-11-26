import { BiomeId, getWorldMapDef, WorldMapId } from './types';

export const WORLD_SIZE = 1280;
export const HALF_WORLD = WORLD_SIZE * 0.5;
export const WATER_LEVEL = 0.0;

let activeWorldMapId: WorldMapId = 'lost_valley';

export function setActiveWorldMap(id: WorldMapId): void {
  activeWorldMapId = id;
}

export function getActiveWorldMap(): WorldMapId {
  return activeWorldMapId;
}

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

// Lost Valley river centerline X coordinate as a function of Z
export function riverCenterX(z: number): number {
  return 20 - Math.sin(z * 0.015) * 26 - smoothstep(45, 280, z) * 145 + smoothstep(-140, -60, z) * 8;
}

export function riverHalfWidth(z: number): number {
  if (z < -130) return 9;
  const lakeJoin = smoothstep(-25, 35, z) * (1 - smoothstep(45, 95, z));
  return 11 + lakeJoin * 24 + smoothstep(100, 320, z) * 10;
}

const ARCHIPELAGO_ISLANDS = [
  { x: 0, z: 14, r: 44, h: 11.5 },
  { x: -96, z: -56, r: 40, h: 13.0 },
  { x: 96, z: 64, r: 42, h: 12.5 },
  { x: -86, z: 96, r: 38, h: 10.5 },
  { x: 76, z: -104, r: 42, h: 18.0 },
  { x: 8, z: 116, r: 34, h: 8.5 },
  { x: -135, z: 10, r: 30, h: 10.0 },
  { x: 135, z: -35, r: 32, h: 11.0 },
  { x: -12, z: -135, r: 34, h: 15.0 },
];

// Distance to main water network for the given (or active) map
export function waterDistanceInfo(
  x: number,
  z: number,
  mapId: WorldMapId = activeWorldMapId
): { dist: number; depthFactor: number; isUpperStream: boolean } {
  if (mapId === 'lost_valley') {
    const dxLake = (x + 22) / 56;
    const dzLake = (z - 34) / 48;
    const lakeR = Math.sqrt(dxLake * dxLake + dzLake * dzLake);
    const lakeDist = (lakeR - 1.0) * 48;

    const dxPool = x - 20;
    const dzPool = z + 124;
    const poolDist = Math.sqrt(dxPool * dxPool + dzPool * dzPool) - 20;

    let riverDist = 999;
    if (z >= -134 && z <= 480) {
      const cx = riverCenterX(z);
      const hw = riverHalfWidth(z);
      riverDist = Math.abs(x - cx) - hw;
    }

    let isUpperStream = false;
    if (z < -144) {
      const ucx = 20 + Math.sin(z * 0.03) * 8;
      const upperDist = Math.abs(x - ucx) - 8;
      if (upperDist < 12) isUpperStream = true;
    }

    const dist = Math.min(lakeDist, poolDist, riverDist);
    return { dist, depthFactor: smoothstep(4, -14, dist), isUpperStream };
  }

  if (mapId === 'alpine_glacier') {
    const lake1 = Math.hypot(x + 42, z + 26) - 28;
    const lake2 = Math.hypot(x - 44, z + 66) - 25;
    const riverCx = 6 + Math.sin(z * 0.022) * 18;
    const river = z > -150 && z < 340 ? Math.abs(x - riverCx) - 10 : 999;
    const dist = Math.min(lake1, lake2, river);
    return { dist, depthFactor: smoothstep(4, -12, dist), isUpperStream: false };
  }

  if (mapId === 'emerald_archipelago') {
    let minIslandSignedDist = 999;
    for (const isl of ARCHIPELAGO_ISLANDS) {
      const wobble = fbm2D(x * 0.025 + isl.x * 0.01, z * 0.025 - isl.z * 0.01, 2) * 8;
      const d = Math.hypot(x - isl.x, z - isl.z) - (isl.r + wobble);
      if (d < minIslandSignedDist) minIslandSignedDist = d;
    }
    // Positive outside islands = negative waterDist (inside ocean)
    const dist = -minIslandSignedDist;
    return { dist, depthFactor: smoothstep(4, -16, dist), isUpperStream: false };
  }

  if (mapId === 'saffron_canyon') {
    const cx = 26 + Math.sin(z * 0.018) * 30;
    const river = z > -220 && z < 340 ? Math.abs(x - cx) - 10.5 : 999;
    const oasis = Math.hypot(x - 32, z + 34) - 15;
    const dist = Math.min(river, oasis);
    return { dist, depthFactor: smoothstep(3.5, -10, dist), isUpperStream: false };
  }

  if (mapId === 'misty_wetlands') {
    const c1 = Math.abs(x - (-48 + Math.sin(z * 0.022) * 26)) - 12;
    const c2 = Math.abs(x - (56 + Math.cos(z * 0.019) * 24)) - 11;
    const cross = Math.abs(z - (12 + Math.sin(x * 0.02) * 18)) - 10;
    const fenPool = Math.hypot(x + 76, z + 26) - 22;
    let dist = Math.min(c1, c2, cross, fenPool);
    // Keep landmarks safely dry
    const def = getWorldMapDef('misty_wetlands');
    for (const lm of def.landmarks) {
      const ld = Math.hypot(x - lm.x, z - lm.z);
      if (ld < 18) dist = Math.max(dist, 18 - ld + 1.5);
    }
    return { dist, depthFactor: smoothstep(3.5, -10, dist), isUpperStream: false };
  }

  if (mapId === 'crimson_caldera') {
    const r = Math.hypot(x, z);
    // Annular crater lake between r=22 and r=62 (with central spire island at r < 22)
    const lakeBand = Math.max(22 - r, r - 62);
    const breachStream = z > 40 && z < 260 ? Math.abs(x - (-18 + Math.sin(z * 0.03) * 10)) - 9 : 999;
    const dist = Math.min(lakeBand, breachStream);
    return { dist, depthFactor: smoothstep(4, -14, dist), isUpperStream: false };
  }

  if (mapId === 'twin_fjords') {
    const westCx = -56 + Math.sin(z * 0.02) * 12;
    const eastCx = 58 + Math.cos(z * 0.02) * 12;
    const westFjord = z > -108 && z < 420 ? Math.abs(x - westCx) - 21 : 999;
    const eastFjord = z > -104 && z < 420 ? Math.abs(x - eastCx) - 21 : 999;
    const southBay = z > 155 ? 155 - z : 999;
    const dist = Math.min(westFjord, eastFjord, southBay);
    return { dist, depthFactor: smoothstep(4, -15, dist), isUpperStream: false };
  }

  // highland_meadows
  const riverCx = 16 + Math.sin(z * 0.018) * 32;
  const river = z > -240 && z < 360 ? Math.abs(x - riverCx) - 11.5 : 999;
  const pond = Math.hypot(x + 74, z - 6) - 20;
  const dist = Math.min(river, pond);
  return { dist, depthFactor: smoothstep(3.5, -11, dist), isUpperStream: false };
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

export function getBiomeWeights(
  x: number,
  z: number,
  height: number,
  mapId: WorldMapId = activeWorldMapId
): BiomeWeights {
  const warpX = x + fbm2D(x * 0.004, z * 0.004, 2) * 34;
  const warpZ = z + fbm2D(x * 0.004 + 17.3, z * 0.004 - 9.1, 2) * 34;
  const distEdge = Math.max(Math.abs(x), Math.abs(z));
  const rimMountain = smoothstep(370, 540, distEdge);

  if (mapId === 'alpine_glacier') {
    const mountain = Math.min(1, 0.45 + smoothstep(10, 26, height) * 0.55 + rimMountain * 0.5);
    const forest = Math.max(0, 1 - mountain) * 0.8;
    const meadow = 0.08;
    const snow = Math.min(1, 0.58 + smoothstep(6, 18, height) * 0.42);
    const total = forest + meadow + mountain + 0.0001;
    return {
      forest: forest / total,
      meadow: meadow / total,
      mountain: mountain / total,
      desert: 0,
      marsh: 0,
      village: 0,
      snow,
    };
  }

  if (mapId === 'emerald_archipelago') {
    const beach = 1 - smoothstep(1.2, 4.2, height);
    const mountain = smoothstep(11, 24, height) * 0.8 + rimMountain * 0.4;
    const forest = Math.max(0.2, 1 - beach * 0.55 - mountain * 0.6);
    const meadow = 0.35 * (1 - beach * 0.6);
    const desert = beach * 0.65;
    const total = forest + meadow + mountain + desert + 0.0001;
    return {
      forest: forest / total,
      meadow: meadow / total,
      mountain: mountain / total,
      desert: desert / total,
      marsh: 0,
      village: 0,
      snow: smoothstep(28, 42, height),
    };
  }

  if (mapId === 'saffron_canyon') {
    const { dist } = waterDistanceInfo(x, z, mapId);
    const oasisGreen = smoothstep(26, 4, dist);
    const mountain = Math.min(1, smoothstep(15, 28, height) * 0.65 + rimMountain * 0.55);
    const desert = Math.max(0.15, (1 - oasisGreen * 0.85) * (1 - mountain * 0.5));
    const meadow = oasisGreen * 0.7;
    const forest = oasisGreen * 0.4;
    const total = forest + meadow + mountain + desert + 0.0001;
    return {
      forest: forest / total,
      meadow: meadow / total,
      mountain: mountain / total,
      desert: desert / total,
      marsh: 0,
      village: 0,
      snow: 0,
    };
  }

  if (mapId === 'misty_wetlands') {
    const marsh = 0.68 + fbm2D(warpX * 0.01, warpZ * 0.01, 2) * 0.25;
    const forest = 0.38;
    const mountain = rimMountain * 0.8;
    const meadow = 0.14;
    const total = forest + meadow + mountain + marsh + 0.0001;
    return {
      forest: forest / total,
      meadow: meadow / total,
      mountain: mountain / total,
      desert: 0,
      marsh: marsh / total,
      village: 0,
      snow: smoothstep(28, 42, height),
    };
  }

  if (mapId === 'crimson_caldera') {
    const r = Math.hypot(x, z);
    const mountain = Math.min(1, 0.55 + smoothstep(65, 115, r) * 0.45 + rimMountain * 0.4);
    const desert = smoothstep(5, 14, height) * 0.35; // volcanic ash/ochre scree
    const forest = Math.max(0.05, 1 - mountain * 0.75 - desert * 0.5);
    const snow = smoothstep(32, 46, height);
    const total = forest + mountain + desert + 0.0001;
    return {
      forest: forest / total,
      meadow: 0,
      mountain: mountain / total,
      desert: desert / total,
      marsh: 0,
      village: 0,
      snow,
    };
  }

  if (mapId === 'twin_fjords') {
    const mountain = Math.min(1, smoothstep(8, 22, height) * 0.85 + rimMountain * 0.5);
    const forest = Math.max(0.15, (1 - mountain * 0.65) * 0.75);
    const meadow = Math.max(0.1, (1 - mountain * 0.7) * 0.4);
    const snow = smoothstep(21, 34, height);
    const total = forest + meadow + mountain + 0.0001;
    return {
      forest: forest / total,
      meadow: meadow / total,
      mountain: mountain / total,
      desert: 0,
      marsh: 0,
      village: 0,
      snow,
    };
  }

  if (mapId === 'highland_meadows') {
    const mountain = Math.min(1, smoothstep(-110, -210, warpZ) * 0.75 + rimMountain * 0.75);
    const meadow = Math.max(0.25, 0.72 * (1 - mountain * 0.7));
    const forest = Math.max(0.15, 0.38 * (1 - mountain * 0.5));
    const snow = smoothstep(25, 39, height);
    const total = forest + meadow + mountain + 0.0001;
    return {
      forest: forest / total,
      meadow: meadow / total,
      mountain: mountain / total,
      desert: 0,
      marsh: 0,
      village: 0,
      snow,
    };
  }

  // Default: lost_valley
  const northMountain = smoothstep(-95, -210, warpZ);
  const mountain = Math.min(1, Math.max(northMountain, rimMountain));

  const desertX = smoothstep(75, 165, warpX);
  const desertZ = smoothstep(35, 125, warpZ);
  const desert = desertX * desertZ * (1 - rimMountain * 0.85);

  const marshX = smoothstep(-55, -145, warpX);
  const marshZ = smoothstep(85, 175, warpZ);
  const marsh = marshX * marshZ * (1 - mountain) * (1 - desert);

  const meadowX = smoothstep(-55, -145, warpX);
  const meadowZ = smoothstep(60, -25, warpZ) * (1 - smoothstep(-65, -135, warpZ));
  const meadow = meadowX * meadowZ * (1 - mountain);

  const dxV = (x - 108) / 56;
  const dzV = (z - 16) / 52;
  const village = smoothstep(1.0, 0.35, Math.sqrt(dxV * dxV + dzV * dzV));

  const forest = Math.max(0, 1 - Math.max(mountain, desert, marsh, meadow * 0.85, village * 0.75));
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

// Cave location (only active inside Lost Valley)
export function getCaveProximity(
  x: number,
  z: number,
  mapId: WorldMapId = activeWorldMapId
): { inCaveZone: number; mouthDist: number } {
  if (mapId !== 'lost_valley') {
    return { inCaveZone: 0, mouthDist: 999 };
  }
  const cx = -134;
  const cz = -124;
  const dx = x - cx;
  const dz = z - cz;
  const mouthDist = Math.sqrt(dx * dx + dz * dz);
  const inside = smoothstep(26, 8, mouthDist) * smoothstep(-104, -124, z);
  return { inCaveZone: inside, mouthDist };
}

export function groundHeightAt(x: number, z: number, mapId: WorldMapId = activeWorldMapId): number {
  const n1 = fbm2D(x * 0.0045, z * 0.0045, 4);
  const n2 = fbm2D(x * 0.018 + 31.4, z * 0.018 - 14.2, 3);
  const detail = fbm2D(x * 0.065, z * 0.065, 2) * 0.55;
  const ridge = ridged2D(x * 0.0075 + 4.1, z * 0.0075 - 2.7, 4);
  const edgeR = Math.sqrt(x * x * 0.92 + z * z * 0.92);
  const outerRim = smoothstep(390, 610, edgeR) * (24 + ridge * 62);

  let h = 3.0 + n1 * 7.2 + n2 * 2.1 + detail;

  if (mapId === 'lost_valley') {
    const warpZ = z + fbm2D(x * 0.005, z * 0.005, 2) * 26;
    const northCliff = smoothstep(-126, -158, warpZ);
    const mountainPeak = smoothstep(-135, -340, z) * (18 + ridge * 58);
    h += northCliff * 21.5 + mountainPeak + outerRim;

    if (z < -138) {
      const streamCx = 20 + Math.sin(z * 0.03) * 8;
      const streamDist = Math.abs(x - streamCx);
      const carve = smoothstep(14, 4, streamDist) * smoothstep(-138, -155, z);
      h -= carve * 4.5;
    }

    const desertFactor = smoothstep(85, 175, x) * smoothstep(45, 135, z) * (1 - smoothstep(380, 520, edgeR));
    if (desertFactor > 0.001) {
      const dune =
        Math.sin(x * 0.042 + fbm2D(x * 0.015, z * 0.015, 2) * 3.0) * 3.4 +
        fbm2D(x * 0.012 + 9, z * 0.012, 3) * 6.5;
      h = lerp(h, 4.2 + dune, desertFactor * 0.85);
    }

    const marshFactor = smoothstep(-65, -150, x) * smoothstep(90, 175, z) * (1 - smoothstep(380, 520, edgeR));
    if (marshFactor > 0.001) {
      const marshRelief = fbm2D(x * 0.03, z * 0.03, 2) * 1.45;
      h = lerp(h, 0.35 + marshRelief, marshFactor * 0.88);
    }

    const campDist = Math.hypot(x + 16, z - 76);
    h = lerp(h, 3.2, smoothstep(26, 8, campDist) * 0.88);

    const vilDist = Math.hypot(x - 106, z - 18);
    h = lerp(h, 3.6, smoothstep(52, 22, vilDist) * 0.78);

    const caveDist = Math.hypot(x + 134, z + 124);
    h = lerp(h, 4.0, smoothstep(28, 12, caveDist) * 0.92);
  } else if (mapId === 'alpine_glacier') {
    const glacierPeaks = ridge * 26 + smoothstep(90, 260, Math.hypot(x, z * 0.85)) * (12 + ridge * 32);
    h = 5.2 + n1 * 8.5 + n2 * 2.8 + detail + glacierPeaks + outerRim;
  } else if (mapId === 'emerald_archipelago') {
    h = -4.2 + n1 * 1.5;
    for (const isl of ARCHIPELAGO_ISLANDS) {
      const wobble = fbm2D(x * 0.025 + isl.x * 0.01, z * 0.025 - isl.z * 0.01, 2) * 8;
      const d = Math.hypot(x - isl.x, z - isl.z);
      const landMask = smoothstep(isl.r + wobble + 12, isl.r * 0.25, d);
      const peak = smoothstep(isl.r * 0.7, 4, d) * isl.h * (0.65 + ridge * 0.55);
      h = Math.max(h, lerp(-4.0, 2.2 + n2 * 1.8 + peak, landMask));
    }
    h += smoothstep(430, 620, edgeR) * 18;
  } else if (mapId === 'saffron_canyon') {
    const cx = 26 + Math.sin(z * 0.018) * 30;
    const canyonDist = Math.abs(x - cx);
    const duneWave = Math.sin(x * 0.036 + z * 0.02) * 2.8 + fbm2D(x * 0.012, z * 0.012, 3) * 5.2;
    const mesa = smoothstep(28, 62, canyonDist) * (10 + ridge * 16);
    const terracedMesa = Math.round((4.5 + mesa) / 3.5) * 3.5 * 0.35 + (4.5 + mesa) * 0.65;
    h = terracedMesa + duneWave * smoothstep(22, 65, canyonDist) + detail + outerRim;
    // Oasis floor flattening
    const oasisDist = Math.hypot(x - 32, z + 34);
    h = lerp(h, 2.0, smoothstep(32, 16, oasisDist) * 0.85);
  } else if (mapId === 'misty_wetlands') {
    h = 1.6 + n1 * 2.4 + n2 * 1.2 + detail * 0.6 + outerRim;
  } else if (mapId === 'crimson_caldera') {
    const r = Math.hypot(x, z);
    // Central spire island + annular basin + tall jagged volcano ring at r ~ 118
    const centerSpire = smoothstep(26, 4, r) * (8 + ridge * 10);
    const craterRing = Math.exp(-Math.pow((r - 122) / 42, 2)) * (26 + ridge * 28);
    const outerSlope = 4.2 + n1 * 5.5 + n2 * 2.0;
    h = outerSlope + centerSpire + craterRing + outerRim;
    // Breach canyon on the south-west
    const breach = z > 40 ? smoothstep(24, 6, Math.abs(x - (-18 + Math.sin(z * 0.03) * 10))) : 0;
    h = lerp(h, 1.8, breach * 0.78);
  } else if (mapId === 'twin_fjords') {
    const westCx = -56 + Math.sin(z * 0.02) * 12;
    const eastCx = 58 + Math.cos(z * 0.02) * 12;
    const wallW = smoothstep(20, 48, Math.abs(x - westCx));
    const wallE = smoothstep(20, 48, Math.abs(x - eastCx));
    const cliffHeight = Math.min(wallW, wallE) * (15 + ridge * 24);
    const northHead = smoothstep(-95, -210, z) * (16 + ridge * 30);
    h = 3.2 + n1 * 4.5 + n2 * 2.2 + cliffHeight + northHead + outerRim;
  } else if (mapId === 'highland_meadows') {
    const northHills = smoothstep(-90, -230, z) * (14 + ridge * 30);
    const terraces = Math.sin(n1 * 6.0) * 1.6;
    h = 4.0 + n1 * 6.8 + n2 * 2.6 + terraces + detail + northHills + outerRim;
  }

  // Smooth safe terrain pads around spawn & landmarks for non-lost_valley maps
  if (mapId !== 'lost_valley') {
    const def = getWorldMapDef(mapId);
    const spawnDist = Math.hypot(x - def.spawn.x, z - def.spawn.z);
    if (spawnDist < 22) {
      h = lerp(h, 3.6, smoothstep(22, 7, spawnDist) * 0.88);
    }
    for (const lm of def.landmarks) {
      const ld = Math.hypot(x - lm.x, z - lm.z);
      if (ld < 14 && h < 1.8) {
        h = lerp(h, 2.4, smoothstep(14, 5, ld) * 0.9);
      }
    }
  }

  // Carve water beds smoothly
  const { dist } = waterDistanceInfo(x, z, mapId);
  if (dist < 14) {
    const bankBlend = smoothstep(14, -10, dist);
    const targetWaterBed = dist < 0 ? lerp(-0.5, -5.2, smoothstep(0, -16, dist)) : lerp(h, 0.4, 0.65);
    h = lerp(h, targetWaterBed, bankBlend);
  }

  return h;
}

export function groundNormalAt(
  x: number,
  z: number,
  mapId: WorldMapId = activeWorldMapId
): { nx: number; ny: number; nz: number } {
  const e = 0.6;
  const hL = groundHeightAt(x - e, z, mapId);
  const hR = groundHeightAt(x + e, z, mapId);
  const hD = groundHeightAt(x, z - e, mapId);
  const hU = groundHeightAt(x, z + e, mapId);
  const nx = hL - hR;
  const ny = 2 * e;
  const nz = hD - hU;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return { nx: nx / len, ny: ny / len, nz: nz / len };
}

export function getDominantBiome(
  x: number,
  z: number,
  height: number,
  mapId: WorldMapId = activeWorldMapId
): { id: BiomeId; label: string } {
  const cave = getCaveProximity(x, z, mapId);
  if (cave.inCaveZone > 0.45) {
    return { id: 'CAVERN', label: 'Echo Cavern' };
  }
  const { dist } = waterDistanceInfo(x, z, mapId);
  if (dist < 1.5 && height < 0.4) {
    return { id: 'RIVER_LAKE', label: 'Crystal Basin' };
  }
  const w = getBiomeWeights(x, z, height, mapId);
  if (w.village > 0.45) return { id: 'ABANDONED_VILLAGE', label: 'Abandoned Settlement' };
  if (w.snow > 0.52) return { id: 'SNOW_PEAKS', label: 'Glacial Peaks' };
  if (w.mountain > 0.45) return { id: 'MOUNTAIN', label: 'Granite Foothills' };
  if (w.desert > 0.4) return { id: 'DESERT', label: 'Saffron Dunes' };
  if (w.marsh > 0.4) return { id: 'MARSH', label: 'Misty Wetlands' };
  if (w.meadow > 0.4) return { id: 'MEADOW', label: 'Wildflower Meadow' };
  return { id: 'FOREST', label: 'Emerald Old-Growth' };
}
