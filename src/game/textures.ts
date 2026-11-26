import * as THREE from 'three';

export interface ProceduralTextureSet {
  soilMap: THREE.CanvasTexture;
  rockMap: THREE.CanvasTexture;
  rockNormal: THREE.CanvasTexture;
  sandMap: THREE.CanvasTexture;
  snowMap: THREE.CanvasTexture;
  barkPineMap: THREE.CanvasTexture;
  barkOakMap: THREE.CanvasTexture;
  barkBirchMap: THREE.CanvasTexture;
  barkNormal: THREE.CanvasTexture;
  woodPlankMap: THREE.CanvasTexture;
  woodPlankNormal: THREE.CanvasTexture;
  plasterWallMap: THREE.CanvasTexture;
  rustMetalMap: THREE.CanvasTexture;
  fabricMap: THREE.CanvasTexture;
  fabricNormal: THREE.CanvasTexture;
  hairMap: THREE.CanvasTexture;
  irisMap: THREE.CanvasTexture;
  leafAlphaMap: THREE.CanvasTexture;
  grassBladeMap: THREE.CanvasTexture;
  softGlowMap: THREE.CanvasTexture;
  smokePuffMap: THREE.CanvasTexture;
  snowflakeMap: THREE.CanvasTexture;
  footprintMap: THREE.CanvasTexture;
  faceMap: THREE.CanvasTexture;
  crateMap: THREE.CanvasTexture;
}

function hash2(x: number, y: number, seed = 1337): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

// Tileable value noise on period P
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;

  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);

  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

function tileFbm(u: number, v: number, baseFreq: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = baseFreq;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileNoise(u * freq, v * freq, freq, seed + i * 19);
    norm += amp;
    freq *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  repeat: boolean,
  anisotropy: number
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  } else {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function buildNormalFromHeight(heightField: Float32Array, size: number, strength: number, anisotropy: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const hL = heightField[y * size + xm];
      const hR = heightField[y * size + xp];
      const hU = heightField[ym * size + x];
      const hD = heightField[yp * size + x];
      let nx = (hL - hR) * strength;
      let ny = (hU - hD) * strength;
      let nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const idx = (y * size + x) * 4;
      d[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      d[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finalizeTexture(c, false, true, anisotropy);
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const aniso = Math.min(16, Math.max(1, maxAnisotropy));

  // 1. Forest Loam & Moss Soil (512x512)
  const S = 512;
  const [soilC, soilCtx] = makeCanvas(S);
  const soilImg = soilCtx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = tileFbm(u, v, 8, 5, 11);
      const pebbles = tileFbm(u, v, 24, 3, 97);
      const moss = Math.max(0, tileFbm(u, v, 4, 3, 211) - 0.52) * 2.1;
      const idx = (y * S + x) * 4;
      const r = 64 * (0.65 + n * 0.65) + pebbles * 22 - moss * 14;
      const g = 52 * (0.65 + n * 0.65) + pebbles * 18 + moss * 34;
      const b = 36 * (0.65 + n * 0.65) + pebbles * 14 - moss * 8;
      soilImg.data[idx] = Math.min(255, Math.max(0, r));
      soilImg.data[idx + 1] = Math.min(255, Math.max(0, g));
      soilImg.data[idx + 2] = Math.min(255, Math.max(0, b));
      soilImg.data[idx + 3] = 255;
    }
  }
  soilCtx.putImageData(soilImg, 0, 0);
  const soilMap = finalizeTexture(soilC, true, true, aniso);

  // 2. Alpine Rock Strata + Normal (256x256)
  const [rockC, rockCtx] = makeCanvas(S);
  const rockImg = rockCtx.createImageData(S, S);
  const rockH = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const strata = tileFbm(u * 0.5, v * 2.0, 6, 4, 307);
      const grit = tileFbm(u, v, 16, 4, 419);
      const crack = Math.abs(tileFbm(u, v, 8, 3, 503) - 0.5) * 2.0;
      const crackFactor = Math.pow(Math.min(1, crack * 2.2), 0.5);
      const h = (strata * 0.5 + grit * 0.5) * crackFactor;
      rockH[y * S + x] = h;
      const idx = (y * S + x) * 4;
      const base = 74 + h * 78;
      rockImg.data[idx] = Math.min(255, base * 1.02);
      rockImg.data[idx + 1] = Math.min(255, base * 0.99);
      rockImg.data[idx + 2] = Math.min(255, base * 0.94);
      rockImg.data[idx + 3] = 255;
    }
  }
  rockCtx.putImageData(rockImg, 0, 0);
  const rockMap = finalizeTexture(rockC, true, true, aniso);
  const rockNormal = buildNormalFromHeight(rockH, S, 3.2, aniso);

  // 3. Desert Wind-Rippled Sand
  const [sandC, sandCtx] = makeCanvas(S);
  const sandImg = sandCtx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const warp = tileFbm(u, v, 4, 3, 601) * 0.2;
      const ripple = Math.sin((u * 10 + v * 4 + warp * 8) * Math.PI * 2) * 0.5 + 0.5;
      const grain = tileFbm(u, v, 32, 2, 701);
      const shade = 0.84 + ripple * 0.12 + grain * 0.08;
      const idx = (y * S + x) * 4;
      sandImg.data[idx] = Math.min(255, 206 * shade);
      sandImg.data[idx + 1] = Math.min(255, 168 * shade);
      sandImg.data[idx + 2] = Math.min(255, 114 * shade);
      sandImg.data[idx + 3] = 255;
    }
  }
  sandCtx.putImageData(sandImg, 0, 0);
  const sandMap = finalizeTexture(sandC, true, true, aniso);

  // 4. Snow Crust
  const [snowC, snowCtx] = makeCanvas(S);
  const snowImg = snowCtx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const drift = tileFbm(u, v, 6, 4, 809);
      const sparkle = hash2(x, y, 821) > 0.985 ? 24 : 0;
      const idx = (y * S + x) * 4;
      const b = 220 + drift * 30 + sparkle;
      snowImg.data[idx] = Math.min(255, b - 4);
      snowImg.data[idx + 1] = Math.min(255, b);
      snowImg.data[idx + 2] = Math.min(255, b + 8);
      snowImg.data[idx + 3] = 255;
    }
  }
  snowCtx.putImageData(snowImg, 0, 0);
  const snowMap = finalizeTexture(snowC, true, true, aniso);

  // 5. Furrowed Bark Textures + Normal
  const barkH = new Float32Array(S * S);
  const buildBark = (rBase: number, gBase: number, bBase: number, seed: number, isBirch = false) => {
    const [c, ctx] = makeCanvas(S);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const ridge = tileFbm(u * 2.5, v * 0.4, 8, 4, seed);
        const micro = tileFbm(u, v, 24, 3, seed + 41);
        let h = ridge * 0.72 + micro * 0.28;
        if (isBirch) {
          const lenticel = tileFbm(u * 0.4, v * 3.0, 12, 2, seed + 99);
          h = lenticel < 0.34 ? 0.2 : 0.85 + micro * 0.15;
        }
        if (seed === 901) barkH[y * S + x] = h;
        const idx = (y * S + x) * 4;
        const shade = isBirch ? 0.22 + h * 0.78 : 0.45 + h * 0.75;
        img.data[idx] = Math.min(255, rBase * shade);
        img.data[idx + 1] = Math.min(255, gBase * shade);
        img.data[idx + 2] = Math.min(255, bBase * shade);
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finalizeTexture(c, true, true, aniso);
  };

  const barkPineMap = buildBark(92, 68, 52, 901);
  const barkNormal = buildNormalFromHeight(barkH, S, 3.6, aniso);
  const barkOakMap = buildBark(84, 72, 58, 955);
  const barkBirchMap = buildBark(218, 214, 205, 991, true);

  // 6. Weathered Wood Planks + Normal
  const [plankC, plankCtx] = makeCanvas(S);
  const plankImg = plankCtx.createImageData(S, S);
  const plankH = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const plankRow = Math.floor(v * 6);
      const seam = Math.abs((v * 6) % 1 - 0.5) > 0.47 ? 0.18 : 1.0;
      const grain = Math.sin((u * 14 + tileFbm(u, v, 8, 3, 1021 + plankRow * 7) * 5) * Math.PI);
      const tone = 0.75 + 0.15 * grain + 0.1 * tileFbm(u, v, 4, 2, 1099 + plankRow * 13);
      const h = (0.5 + 0.35 * grain) * seam;
      plankH[y * S + x] = h;
      const idx = (y * S + x) * 4;
      plankImg.data[idx] = Math.min(255, 118 * tone * seam);
      plankImg.data[idx + 1] = Math.min(255, 92 * tone * seam);
      plankImg.data[idx + 2] = Math.min(255, 68 * tone * seam);
      plankImg.data[idx + 3] = 255;
    }
  }
  plankCtx.putImageData(plankImg, 0, 0);
  const woodPlankMap = finalizeTexture(plankC, true, true, aniso);
  const woodPlankNormal = buildNormalFromHeight(plankH, S, 2.8, aniso);

  // 7. Cracked Abandoned Plaster / Stone Wall
  const [plasterC, plasterCtx] = makeCanvas(S);
  const plasterImg = plasterCtx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const grime = tileFbm(u, v, 6, 4, 1151);
      const damp = Math.pow(v, 1.5) * 0.32;
      const crack = Math.abs(tileFbm(u, v, 10, 3, 1213) - 0.5) < 0.025 ? 0.45 : 1.0;
      const shade = (0.72 + grime * 0.35 - damp) * crack;
      const idx = (y * S + x) * 4;
      plasterImg.data[idx] = Math.min(255, 168 * shade);
      plasterImg.data[idx + 1] = Math.min(255, 158 * shade);
      plasterImg.data[idx + 2] = Math.min(255, 142 * shade);
      plasterImg.data[idx + 3] = 255;
    }
  }
  plasterCtx.putImageData(plasterImg, 0, 0);
  const plasterWallMap = finalizeTexture(plasterC, true, true, aniso);

  // 8. Rusted Corrugated Metal
  const [rustC, rustCtx] = makeCanvas(S);
  const rustImg = rustCtx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const corr = Math.sin(u * Math.PI * 16) * 0.14 + 0.86;
      const rustMask = smoothstepLocal(0.42, 0.72, tileFbm(u, v, 6, 4, 1301));
      const r = (92 * (1 - rustMask) + 128 * rustMask) * corr;
      const g = (98 * (1 - rustMask) + 64 * rustMask) * corr;
      const b = (104 * (1 - rustMask) + 38 * rustMask) * corr;
      const idx = (y * S + x) * 4;
      rustImg.data[idx] = Math.min(255, r);
      rustImg.data[idx + 1] = Math.min(255, g);
      rustImg.data[idx + 2] = Math.min(255, b);
      rustImg.data[idx + 3] = 255;
    }
  }
  rustCtx.putImageData(rustImg, 0, 0);
  const rustMetalMap = finalizeTexture(rustC, true, true, aniso);

  // 9. High-Resolution Woven Explorer Twill Fabric + Normal Map (512x512)
  const fabSize = 512;
  const [fabC, fabCtx] = makeCanvas(fabSize);
  const fabImg = fabCtx.createImageData(fabSize, fabSize);
  const fabH = new Float32Array(fabSize * fabSize);
  for (let y = 0; y < fabSize; y++) {
    for (let x = 0; x < fabSize; x++) {
      const u = x / fabSize;
      const v = y / fabSize;
      // Diagonal twill weave + fine warp/weft thread micro-relief
      const twill = ((x + y) % 6 < 3) ? 1.07 : 0.91;
      const cross = ((x - y + fabSize) % 6 < 2) ? 1.04 : 0.96;
      const microThread = Math.sin(x * Math.PI * 0.5) * 0.03 + Math.sin(y * Math.PI * 0.5) * 0.03;
      const wear = tileFbm(u, v, 8, 4, 1409) * 0.16 + 0.88;
      const fine = tileFbm(u, v, 24, 2, 1427) * 0.08;
      const idx = (y * fabSize + x) * 4;
      const shade = Math.min(255, Math.round(224 * twill * cross * (wear + fine) + microThread * 18));
      fabImg.data[idx] = shade;
      fabImg.data[idx + 1] = shade;
      fabImg.data[idx + 2] = shade;
      fabImg.data[idx + 3] = 255;
      fabH[y * fabSize + x] = (twill - 0.9) * 0.45 + microThread + fine * 0.7;
    }
  }
  fabCtx.putImageData(fabImg, 0, 0);
  const fabricMap = finalizeTexture(fabC, true, true, aniso);
  const fabricNormal = buildNormalFromHeight(fabH, fabSize, 1.35, aniso);

  // 9b. High-Resolution Silky Anisotropic Hair Strand Texture (512x512)
  const hairSize = 512;
  const [hairC, hairCtx] = makeCanvas(hairSize);
  const hairImg = hairCtx.createImageData(hairSize, hairSize);
  for (let y = 0; y < hairSize; y++) {
    const v = y / hairSize;
    // Root darker, mid warm chestnut, tips slightly sun-kissed
    const lengthShade = 0.76 + Math.sin(v * Math.PI) * 0.22 + v * 0.1;
    for (let x = 0; x < hairSize; x++) {
      const u = x / hairSize;
      const strandA = Math.sin(u * Math.PI * 160 + tileFbm(u, v, 6, 2, 911) * 4.5) * 0.5 + 0.5;
      const strandB = Math.sin(u * Math.PI * 340 + v * 6.0) * 0.5 + 0.5;
      const bundle = tileFbm(u * 2.5, v * 0.4, 8, 3, 947);
      const sheenBand = Math.exp(-Math.pow((v - 0.42) * 3.8, 2)) * (0.28 + 0.32 * strandA);
      const tone = (0.72 + strandA * 0.22 + strandB * 0.08 + bundle * 0.14 + sheenBand) * lengthShade;
      const idx = (y * hairSize + x) * 4;
      hairImg.data[idx] = Math.min(255, Math.round(92 * tone));
      hairImg.data[idx + 1] = Math.min(255, Math.round(58 * tone));
      hairImg.data[idx + 2] = Math.min(255, Math.round(42 * tone));
      hairImg.data[idx + 3] = 255;
    }
  }
  hairCtx.putImageData(hairImg, 0, 0);
  const hairMap = finalizeTexture(hairC, true, true, aniso);

  // 9c. High-Resolution Radiant Emerald-Hazel Radial Iris Texture (256x256)
  const [irisC, irisCtx] = makeCanvas(256);
  irisCtx.fillStyle = '#0f241c';
  irisCtx.fillRect(0, 0, 256, 256);
  const irisGrad = irisCtx.createRadialGradient(128, 128, 18, 128, 128, 124);
  irisGrad.addColorStop(0.0, '#120c08');
  irisGrad.addColorStop(0.26, '#c78a3e'); // Warm golden-amber inner collarette
  irisGrad.addColorStop(0.45, '#3b8b6c'); // Vivid jade-emerald iris body
  irisGrad.addColorStop(0.8, '#1e5b49');
  irisGrad.addColorStop(0.95, '#0b221b'); // Dark limbal ring
  irisGrad.addColorStop(1.0, '#071410');
  irisCtx.fillStyle = irisGrad;
  irisCtx.beginPath();
  irisCtx.arc(128, 128, 124, 0, Math.PI * 2);
  irisCtx.fill();
  // Fine radial stromal fibers
  for (let i = 0; i < 140; i++) {
    const ang = (i / 140) * Math.PI * 2 + hash2(i, 1, 303) * 0.04;
    const r0 = 32 + hash2(i, 2, 303) * 14;
    const r1 = 96 + hash2(i, 3, 303) * 20;
    irisCtx.strokeStyle =
      i % 3 === 0
        ? 'rgba(235, 198, 120, 0.34)'
        : i % 2 === 0
        ? 'rgba(130, 232, 192, 0.28)'
        : 'rgba(18, 58, 44, 0.35)';
    irisCtx.lineWidth = 1.2 + hash2(i, 4, 303) * 1.4;
    irisCtx.beginPath();
    irisCtx.moveTo(128 + Math.cos(ang) * r0, 128 + Math.sin(ang) * r0);
    irisCtx.lineTo(128 + Math.cos(ang) * r1, 128 + Math.sin(ang) * r1);
    irisCtx.stroke();
  }
  // Crisp obsidian pupil center
  irisCtx.fillStyle = '#070709';
  irisCtx.beginPath();
  irisCtx.arc(128, 128, 36, 0, Math.PI * 2);
  irisCtx.fill();
  const irisMap = finalizeTexture(irisC, true, false, aniso);

  // 10. Leaf Cluster Alpha/Color Texture (for crisp foliage cards)
  const [leafC, leafCtx] = makeCanvas(128);
  leafCtx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + hash2(i, 1, 55) * 0.4;
    const rad = 16 + hash2(i, 2, 55) * 28;
    const lx = 64 + Math.cos(a) * rad;
    const ly = 64 + Math.sin(a) * rad;
    const sz = 14 + hash2(i, 3, 55) * 14;
    leafCtx.save();
    leafCtx.translate(lx, ly);
    leafCtx.rotate(a + 0.5);
    const tone = 175 + Math.floor(hash2(i, 4, 55) * 75);
    leafCtx.fillStyle = `rgb(${tone - 22}, ${tone}, ${tone - 36})`;
    leafCtx.beginPath();
    leafCtx.ellipse(0, 0, sz, sz * 0.55, 0, 0, Math.PI * 2);
    leafCtx.fill();
    leafCtx.restore();
  }
  // Center cluster
  leafCtx.fillStyle = 'rgb(205, 225, 190)';
  leafCtx.beginPath();
  leafCtx.arc(64, 64, 20, 0, Math.PI * 2);
  leafCtx.fill();
  const leafAlphaMap = finalizeTexture(leafC, true, false, aniso);

  // 11. Grass Blade Texture
  const [grassC, grassCtx] = makeCanvas(64);
  grassCtx.clearRect(0, 0, 64, 64);
  const gradG = grassCtx.createLinearGradient(0, 64, 0, 0);
  gradG.addColorStop(0, '#5a6f36');
  gradG.addColorStop(0.55, '#88aa4d');
  gradG.addColorStop(1, '#c3d977');
  grassCtx.fillStyle = gradG;
  grassCtx.beginPath();
  grassCtx.moveTo(22, 64);
  grassCtx.quadraticCurveTo(25, 28, 32, 2);
  grassCtx.quadraticCurveTo(39, 28, 42, 64);
  grassCtx.closePath();
  grassCtx.fill();
  const grassBladeMap = finalizeTexture(grassC, true, false, aniso);

  // 12. Soft Radial Glow (Sparks, Fireflies, Sun Glare)
  const [glowC, glowCtx] = makeCanvas(128);
  const rg = glowCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  rg.addColorStop(0.6, 'rgba(255,255,255,0.2)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  glowCtx.fillStyle = rg;
  glowCtx.fillRect(0, 0, 128, 128);
  const softGlowMap = finalizeTexture(glowC, true, false, 1);

  // 13. Smoke Puff Texture (Soft organic cloudlet)
  const [smokeC, smokeCtx] = makeCanvas(128);
  const smokeImg = smokeCtx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const dx = (x - 64) / 64;
      const dy = (y - 64) / 64;
      const r = Math.sqrt(dx * dx + dy * dy);
      const n = tileFbm(x / 128, y / 128, 4, 3, 1553);
      const alpha = Math.max(0, 1 - r * 1.15) * (0.45 + 0.55 * n);
      const idx = (y * 128 + x) * 4;
      smokeImg.data[idx] = 235;
      smokeImg.data[idx + 1] = 235;
      smokeImg.data[idx + 2] = 240;
      smokeImg.data[idx + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
  smokeCtx.putImageData(smokeImg, 0, 0);
  const smokePuffMap = finalizeTexture(smokeC, true, false, 1);

  // 14. Snowflake Texture
  const [sfC, sfCtx] = makeCanvas(64);
  const sfg = sfCtx.createRadialGradient(32, 32, 0, 32, 32, 30);
  sfg.addColorStop(0, 'rgba(255,255,255,0.95)');
  sfg.addColorStop(0.45, 'rgba(235,245,255,0.65)');
  sfg.addColorStop(1, 'rgba(220,235,255,0)');
  sfCtx.fillStyle = sfg;
  sfCtx.fillRect(0, 0, 64, 64);
  const snowflakeMap = finalizeTexture(sfC, true, false, 1);

  // 15. Boot Footprint Decal Texture
  const [fpC, fpCtx] = makeCanvas(64);
  fpCtx.clearRect(0, 0, 64, 64);
  fpCtx.fillStyle = 'rgba(20, 14, 9, 0.72)';
  // Boot heel + sole treads
  fpCtx.beginPath();
  fpCtx.ellipse(32, 46, 10, 9, 0, 0, Math.PI * 2);
  fpCtx.fill();
  fpCtx.beginPath();
  fpCtx.ellipse(32, 22, 12, 16, 0, 0, Math.PI * 2);
  fpCtx.fill();
  const footprintMap = finalizeTexture(fpC, true, false, aniso);

  // 16. High-Resolution Luminous Feminine Face Texture (1024x1024 Spherical UV aligned front at u=0.5)
  // Note: 3D eyeballs, animated eyelids, eyebrows, nose, and lips sit atop this canvas skin map so there are no flat painted eyeballs!
  const [faceC, faceCtx] = makeCanvas(1024);
  faceCtx.save();
  faceCtx.scale(4, 4); // Draw cleanly on normalized 256x256 portrait grid at full 1024px resolution

  // Warm radiant porcelain-peach skin gradient with natural undertone transitions
  const skinGrad = faceCtx.createLinearGradient(0, 0, 0, 256);
  skinGrad.addColorStop(0, '#ecc2a6');
  skinGrad.addColorStop(0.38, '#f4cfb6');
  skinGrad.addColorStop(0.7, '#ecc1a5');
  skinGrad.addColorStop(1, '#dcad8f');
  faceCtx.fillStyle = skinGrad;
  faceCtx.fillRect(0, 0, 256, 256);

  // Subtle translucent skin pore micro-luminance & delicate sun-kissed freckles across nose & cheeks
  for (let p = 0; p < 520; p++) {
    const px = 72 + hash2(p, 1, 777) * 112;
    const py = 84 + hash2(p, 2, 777) * 110;
    faceCtx.fillStyle = p % 3 === 0 ? 'rgba(182, 114, 88, 0.055)' : 'rgba(255, 240, 228, 0.065)';
    faceCtx.fillRect(px, py, 0.65, 0.65);
  }
  for (let f = 0; f < 34; f++) {
    const fx = 96 + hash2(f, 5, 881) * 64;
    const fy = 128 + hash2(f, 6, 881) * 20;
    faceCtx.fillStyle = 'rgba(176, 108, 76, 0.14)';
    faceCtx.beginPath();
    faceCtx.arc(fx, fy, 0.65 + hash2(f, 7, 881) * 0.45, 0, Math.PI * 2);
    faceCtx.fill();
  }

  // Warm SSS rose-coral cheek blush, temple warmth, and delicate nose/chin glow
  for (const [cx, cy, r, col] of [
    [101, 138, 22, 'rgba(232, 118, 102, 0.24)'],
    [155, 138, 22, 'rgba(232, 118, 102, 0.24)'],
    [128, 133, 12, 'rgba(226, 124, 104, 0.15)'],
    [128, 174, 16, 'rgba(224, 132, 112, 0.12)'],
    [128, 86, 48, 'rgba(255, 232, 214, 0.18)'],
  ] as const) {
    const cg = faceCtx.createRadialGradient(cx, cy, 1, cx, cy, r);
    cg.addColorStop(0, col);
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    faceCtx.fillStyle = cg;
    faceCtx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // Delicate cheekbone & jawline contouring (soft golden-tan contour underneath cheek blush)
  for (const sx of [-1, 1]) {
    const jg = faceCtx.createRadialGradient(128 + sx * 36, 158, 2, 128 + sx * 36, 158, 26);
    jg.addColorStop(0, 'rgba(168, 106, 82, 0.14)');
    jg.addColorStop(1, 'rgba(0,0,0,0)');
    faceCtx.fillStyle = jg;
    faceCtx.fillRect(128 + sx * 36 - 26, 158 - 26, 52, 52);
  }

  // Soft orbital eye-socket warmth & subtle natural lash-line shadow (3D eyes sit cleanly inside)
  for (const ex of [110, 146]) {
    const og = faceCtx.createRadialGradient(ex, 121, 2, ex, 121, 14);
    og.addColorStop(0, 'rgba(132, 82, 68, 0.28)');
    og.addColorStop(0.65, 'rgba(162, 104, 86, 0.14)');
    og.addColorStop(1, 'rgba(0,0,0,0)');
    faceCtx.fillStyle = og;
    faceCtx.fillRect(ex - 14, 121 - 14, 28, 28);
  }

  // Subtle nose bridge highlight & soft philtrum / chin dimple shading
  const noseHi = faceCtx.createLinearGradient(125, 116, 131, 140);
  noseHi.addColorStop(0, 'rgba(255, 240, 228, 0.22)');
  noseHi.addColorStop(1, 'rgba(255, 240, 228, 0.04)');
  faceCtx.fillStyle = noseHi;
  faceCtx.fillRect(126.2, 116, 3.6, 22);

  // Soft base rose lip blush beneath sculpted 3D lips
  const lipGlow = faceCtx.createRadialGradient(128, 156, 2, 128, 156, 14);
  lipGlow.addColorStop(0, 'rgba(196, 88, 86, 0.42)');
  lipGlow.addColorStop(1, 'rgba(0,0,0,0)');
  faceCtx.fillStyle = lipGlow;
  faceCtx.fillRect(114, 142, 28, 28);

  // Soft natural hairline shadow along forehead crown & nape
  const hairline = faceCtx.createLinearGradient(0, 24, 0, 72);
  hairline.addColorStop(0, 'rgba(58, 36, 26, 0.72)');
  hairline.addColorStop(0.55, 'rgba(90, 56, 40, 0.22)');
  hairline.addColorStop(1, 'rgba(0,0,0,0)');
  faceCtx.fillStyle = hairline;
  faceCtx.fillRect(0, 0, 256, 72);

  faceCtx.restore();
  const faceMap = finalizeTexture(faceC, true, false, aniso);

  // 17. Reinforced Wooden Supply Crate Texture (256x256)
  const [crC, crCtx] = makeCanvas(256);
  crCtx.drawImage(plankC, 0, 0, 256, 256);
  crCtx.strokeStyle = '#3a2c20';
  crCtx.lineWidth = 24;
  crCtx.strokeRect(12, 12, 232, 232);
  crCtx.beginPath();
  crCtx.moveTo(20, 20);
  crCtx.lineTo(236, 236);
  crCtx.stroke();
  // Iron corner rivets
  crCtx.fillStyle = '#353a3f';
  for (const [rx, ry] of [[16, 16], [224, 16], [16, 224], [224, 224]]) {
    crCtx.fillRect(rx, ry, 16, 16);
  }
  const crateMap = finalizeTexture(crC, true, false, aniso);

  return {
    soilMap,
    rockMap,
    rockNormal,
    sandMap,
    snowMap,
    barkPineMap,
    barkOakMap,
    barkBirchMap,
    barkNormal,
    woodPlankMap,
    woodPlankNormal,
    plasterWallMap,
    rustMetalMap,
    fabricMap,
    fabricNormal,
    hairMap,
    irisMap,
    leafAlphaMap,
    grassBladeMap,
    softGlowMap,
    smokePuffMap,
    snowflakeMap,
    footprintMap,
    faceMap,
    crateMap,
  };
}

function smoothstepLocal(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
