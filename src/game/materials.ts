import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';

export interface SharedEnvUniforms {
  uTime: { value: number };
  uWindDir: { value: THREE.Vector2 };
  uWindStrength: { value: number };
  uRainWetness: { value: number };
  uRainIntensity: { value: number };
  uSnowCover: { value: number };
  uCloudDensity: { value: number };
  uPlayerPos: { value: THREE.Vector3 };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSkyTopColor: { value: THREE.Color };
  uSkyHorizonColor: { value: THREE.Color };
  uMoonDir: { value: THREE.Vector3 };
  uNightFactor: { value: number };
  uFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
  uEnvMap: { value: THREE.CubeTexture };
  uEnvMapMix: { value: number };
}

function createPlaceholderCubeTexture(): THREE.CubeTexture {
  const data = new Uint8Array([120, 145, 175, 255]);
  const face = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  face.needsUpdate = true;
  const cube = new THREE.CubeTexture([
    face.image,
    face.image,
    face.image,
    face.image,
    face.image,
    face.image,
  ]);
  cube.needsUpdate = true;
  return cube;
}

export function createSharedEnvUniforms(): SharedEnvUniforms {
  return {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(0.85, 0.52).normalize() },
    uWindStrength: { value: 1.0 },
    uRainWetness: { value: 0.0 },
    uRainIntensity: { value: 0.0 },
    uSnowCover: { value: 0.0 },
    uCloudDensity: { value: 0.42 },
    uPlayerPos: { value: new THREE.Vector3(0, 0, 0) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.5).normalize() },
    uSunColor: { value: new THREE.Color(0xfff1d6) },
    uSkyTopColor: { value: new THREE.Color(0x285a98) },
    uSkyHorizonColor: { value: new THREE.Color(0x9fc2de) },
    uMoonDir: { value: new THREE.Vector3(-0.4, -0.5, -0.5).normalize() },
    uNightFactor: { value: 0.0 },
    uFogColor: { value: new THREE.Color(0x9fc2de) },
    uFogDensity: { value: 0.0028 },
    uEnvMap: { value: createPlaceholderCubeTexture() },
    uEnvMapMix: { value: 0.0 },
  };
}

export function createTerrainMaterial(
  textures: ProceduralTextureSet,
  env: SharedEnvUniforms
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.02,
    normalMap: textures.rockNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
  });
  mat.customProgramCacheKey = () => 'terrain_pbr_v1';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSoilMap = { value: textures.soilMap };
    shader.uniforms.uRockMap = { value: textures.rockMap };
    shader.uniforms.uSandMap = { value: textures.sandMap };
    shader.uniforms.uSnowMap = { value: textures.snowMap };
    shader.uniforms.uTime = env.uTime;
    shader.uniforms.uWindDir = env.uWindDir;
    shader.uniforms.uRainWetness = env.uRainWetness;
    shader.uniforms.uSnowCover = env.uSnowCover;
    shader.uniforms.uCloudDensity = env.uCloudDensity;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aBiome;
        varying vec4 vBiome;
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vBiome = aBiome;
        vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uSoilMap;
        uniform sampler2D uRockMap;
        uniform sampler2D uSandMap;
        uniform sampler2D uSnowMap;
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform float uRainWetness;
        uniform float uSnowCover;
        uniform float uCloudDensity;
        varying vec4 vBiome;
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;

        float hashTerrain(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noiseTerrain(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hashTerrain(i), hashTerrain(i + vec2(1.0, 0.0)), f.x),
            mix(hashTerrain(i + vec2(0.0, 1.0)), hashTerrain(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 wp = vTerrainWorldPos.xz;
        // Dual-scale anti-tiling UV sampling
        vec2 uvA = wp * 0.14;
        vec2 uvB = wp * 0.037 + vec2(11.3, 7.1);
        float macroVar = noiseTerrain(wp * 0.045);

        vec3 soilCol = mix(texture2D(uSoilMap, uvA).rgb, texture2D(uSoilMap, uvB).rgb, 0.42);
        vec3 rockCol = mix(texture2D(uRockMap, uvA * 0.9).rgb, texture2D(uRockMap, uvB * 1.1).rgb, 0.45);
        vec3 sandCol = mix(texture2D(uSandMap, uvA * 0.85).rgb, texture2D(uSandMap, uvB).rgb, 0.35);
        vec3 snowCol = mix(texture2D(uSnowMap, uvA * 0.7).rgb, texture2D(uSnowMap, uvB * 0.8).rgb, 0.4);

        // Lush grassy moss & meadow tint on gentle terrain
        vec3 lushGrass = mix(vec3(0.14, 0.24, 0.08), vec3(0.24, 0.34, 0.11), macroVar);
        vec3 forestFloor = mix(soilCol * vec3(0.85, 0.82, 0.75), lushGrass, smoothstep(0.2, 0.75, vBiome.x));

        // Marsh muddy tint
        vec3 marshTint = mix(forestFloor, soilCol * vec3(0.52, 0.56, 0.42), vBiome.w * 0.85);

        // Desert sand blend
        vec3 groundCol = mix(marshTint, sandCol, vBiome.y);

        // Shoreline wet sand/pebbles near Y=0
        float shoreMask = 1.0 - smoothstep(-0.4, 2.2, vTerrainWorldPos.y);
        groundCol = mix(groundCol, rockCol * vec3(0.72, 0.67, 0.58), shoreMask * 0.65);

        // Slope-based granite cliff strata
        float slope = 1.0 - clamp(vTerrainWorldNormal.y, 0.0, 1.0);
        float rockWeight = smoothstep(0.24, 0.52, slope + macroVar * 0.12);
        groundCol = mix(groundCol, rockCol * vec3(0.95, 0.94, 0.91), rockWeight);

        // Altitude snow + dynamic snowfall accumulation
        float dynamicSnow = clamp(vBiome.z + uSnowCover * (1.0 - rockWeight * 0.75) * smoothstep(0.55, 0.85, vTerrainWorldNormal.y), 0.0, 1.0);
        float snowEdge = smoothstep(0.35, 0.65, dynamicSnow - rockWeight * 0.35 + macroVar * 0.15);
        groundCol = mix(groundCol, snowCol, snowEdge);

        // Rain wetness darkens porous surfaces
        float wetDarken = mix(1.0, 0.62, uRainWetness * (1.0 - snowEdge * 0.85));
        groundCol *= wetDarken;

        // Moving overhead cloud shadows
        vec2 cloudUv = wp * 0.0042 + uWindDir * uTime * 0.012;
        float cShadow = noiseTerrain(cloudUv) * 0.6 + noiseTerrain(cloudUv * 2.1 + 4.2) * 0.4;
        float shadowFactor = 1.0 - smoothstep(0.45, 0.82, cShadow) * (0.18 + uCloudDensity * 0.35);
        groundCol *= shadowFactor;

        diffuseColor.rgb *= groundCol;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float wetSmooth = uRainWetness * 0.52 * smoothstep(0.4, 0.95, vTerrainWorldNormal.y);
        roughnessFactor = clamp(roughnessFactor - wetSmooth, 0.18, 0.96);`
      );
  };

  return mat;
}

export function createWaterMaterial(env: SharedEnvUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: env.uTime,
      uWindDir: env.uWindDir,
      uWindStrength: env.uWindStrength,
      uRainIntensity: env.uRainIntensity,
      uSunDir: env.uSunDir,
      uSunColor: env.uSunColor,
      uSkyTopColor: env.uSkyTopColor,
      uSkyHorizonColor: env.uSkyHorizonColor,
      uMoonDir: env.uMoonDir,
      uNightFactor: env.uNightFactor,
      uFogColor: env.uFogColor,
      uFogDensity: env.uFogDensity,
      uEnvMap: env.uEnvMap,
      uEnvMapMix: env.uEnvMapMix,
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      uniform float uWindStrength;
      attribute float aWaterDepth;
      attribute float aFlowSpeed;
      varying vec3 vWorldPos;
      varying float vDepth;
      varying float vFlow;

      void main() {
        vDepth = aWaterDepth;
        vFlow = aFlowSpeed;
        vec3 pos = position;
        vec4 wp = modelMatrix * vec4(pos, 1.0);
        float amp = mix(0.02, 0.11, clamp(aWaterDepth / 3.0, 0.0, 1.0)) * (0.7 + uWindStrength * 0.5);
        float wave = sin(wp.x * 0.42 + uTime * 1.9) * cos(wp.z * 0.38 - uTime * 1.5) * amp;
        wave += sin((wp.x + wp.z) * 0.85 - uTime * 2.6) * amp * 0.45;
        pos.y += wave;
        wp = modelMatrix * vec4(pos, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec2 uWindDir;
      uniform float uWindStrength;
      uniform float uRainIntensity;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyTopColor;
      uniform vec3 uSkyHorizonColor;
      uniform vec3 uMoonDir;
      uniform float uNightFactor;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform samplerCube uEnvMap;
      uniform float uEnvMapMix;

      varying vec3 vWorldPos;
      varying float vDepth;
      varying float vFlow;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      float fbmWater(vec2 p) {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          s += a * vnoise(p);
          p = p * 2.05 + vec2(1.7, 9.2);
          a *= 0.5;
        }
        return s;
      }

      // Raindrop concentric ripples on water surface
      float rainRipple(vec2 p, float t) {
        vec2 cell = floor(p);
        vec2 local = fract(p) - 0.5;
        float h = hash21(cell);
        float phase = fract(t * 1.45 + h * 6.28);
        float d = length(local);
        float ring = (1.0 - smoothstep(0.0, 0.07, abs(d - phase * 0.48))) * (1.0 - phase);
        return ring;
      }

      void main() {
        vec2 flowOffset = vec2(0.0, -uTime * (0.45 + vFlow * 1.35));
        vec2 p1 = vWorldPos.xz * 0.34 + flowOffset + uWindDir * uTime * 0.2;
        vec2 p2 = vWorldPos.xz * 0.88 - flowOffset * 0.6 + vec2(4.1, 2.7);

        float eps = 0.14;
        float h0 = fbmWater(p1) * 0.65 + fbmWater(p2) * 0.35;
        float hx = fbmWater(p1 + vec2(eps, 0.0)) * 0.65 + fbmWater(p2 + vec2(eps, 0.0)) * 0.35;
        float hz = fbmWater(p1 + vec2(0.0, eps)) * 0.65 + fbmWater(p2 + vec2(0.0, eps)) * 0.35;

        float rainRip = 0.0;
        if (uRainIntensity > 0.02) {
          rainRip = (rainRipple(vWorldPos.xz * 1.4, uTime) + rainRipple(vWorldPos.xz * 2.1 + 3.7, uTime * 1.2)) * uRainIntensity;
        }

        float normalAmp = (1.1 + uWindStrength * 0.7) * 0.42;
        vec3 N = normalize(vec3((h0 - hx) * normalAmp + rainRip * 0.25, 1.0, (h0 - hz) * normalAmp + rainRip * 0.25));
        vec3 V = normalize(cameraPosition - vWorldPos);

        // Fresnel
        float fresnel = clamp(0.03 + 0.97 * pow(max(1.0 - max(dot(N, V), 0.0), 1e-4), 4.2), 0.0, 1.0);

        // Depth-based water absorption color (turquoise shallows -> deep emerald/navy)
        float depthNorm = clamp(vDepth / 4.2, 0.0, 1.0);
        vec3 shallowColor = vec3(0.11, 0.34, 0.31);
        vec3 deepColor = vec3(0.02, 0.09, 0.13);
        vec3 waterBody = mix(shallowColor, deepColor, smoothstep(0.0, 1.0, depthNorm));

        // Dynamic sky/mountain reflection + Real-time CubeCamera environment reflections
        vec3 R = reflect(-V, N);
        float reflElev = clamp(R.y, 0.0, 1.0);
        vec3 skyRefl = mix(uSkyHorizonColor, uSkyTopColor, pow(max(reflElev, 1e-4), 0.6));
        float treeBand = (1.0 - smoothstep(0.02, 0.24, reflElev)) * 0.38;
        skyRefl = mix(skyRefl, vec3(0.07, 0.12, 0.09) * (1.0 - uNightFactor * 0.75), treeBand);

        if (uEnvMapMix > 0.01) {
          vec3 envDir = normalize(vec3(R.x, max(R.y, 0.015), R.z));
          vec3 envSample = textureCube(uEnvMap, envDir).rgb;
          skyRefl = mix(skyRefl, envSample, uEnvMapMix * 0.78);
        }

        // Sun & Moon specular glints + rich golden-hour sunset sun path
        vec3 L = normalize(uSunDir);
        vec3 H = normalize(L + V);
        float sunsetArg = (L.y - 0.06) / 0.16;
        float sunsetBoost = exp(-(sunsetArg * sunsetArg));
        float ndh = max(dot(N, H), 0.0);
        float sunSpec = (ndh > 1e-3 ? pow(ndh, 210.0) : 0.0) * (1.0 - uNightFactor) * (2.6 + sunsetBoost * 1.4);
        float sunSheen = (ndh > 1e-3 ? pow(ndh, 18.0) : 0.0) * (1.0 - uNightFactor) * (0.26 + sunsetBoost * 0.42);
        // Stretched shimmer path across ripples toward low setting sun
        vec3 NFlat = normalize(vec3(N.x * 0.45, 1.0, N.z * 1.4));
        vec3 HPath = normalize(L + V);
        float nfhp = max(dot(NFlat, HPath), 0.0);
        float sunPath = (nfhp > 1e-3 ? pow(nfhp, 38.0) : 0.0) * (1.0 - uNightFactor) * sunsetBoost * 0.58;

        vec3 ML = normalize(uMoonDir);
        vec3 MH = normalize(ML + V);
        float ndmh = max(dot(N, MH), 0.0);
        float moonSpec = (ndmh > 1e-3 ? pow(ndmh, 140.0) : 0.0) * uNightFactor * 0.75;

        // Shoreline & waterfall plunge foam
        float plungeDist = length(vWorldPos.xz - vec2(20.0, -124.0));
        float plungeFoam = (1.0 - smoothstep(4.0, 18.0, plungeDist)) * smoothstep(0.38, 0.72, h0);
        float shoreFoam = (1.0 - smoothstep(0.02, 0.55, vDepth)) * smoothstep(0.45, 0.75, h0);
        float foam = clamp(shoreFoam * 0.85 + plungeFoam * 1.1 + rainRip * 0.35, 0.0, 1.0);

        vec3 dayLightFactor = mix(vec3(1.0), vec3(0.22, 0.28, 0.42), uNightFactor);
        vec3 col = mix(waterBody * dayLightFactor, skyRefl, fresnel * (0.82 + sunsetBoost * 0.12));
        col += uSunColor * (sunSpec + sunSheen + sunPath);
        col += vec3(0.65, 0.78, 1.0) * moonSpec;
        col = mix(col, vec3(0.86, 0.91, 0.94) * dayLightFactor, foam * 0.72);

        // Exponential distance fog matching scene.fog
        float camDist = length(cameraPosition - vWorldPos);
        float fogDist = camDist * uFogDensity;
        float fogFactor = 1.0 - exp(-(fogDist * fogDist));
        col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

        float alpha = clamp(mix(0.42, 0.94, smoothstep(0.05, 1.6, vDepth)) + fresnel * 0.25 + foam * 0.35, 0.25, 0.97);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function createWaterfallMaterial(env: SharedEnvUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: env.uTime,
      uSunColor: env.uSunColor,
      uSkyHorizonColor: env.uSkyHorizonColor,
      uNightFactor: env.uNightFactor,
      uFogColor: env.uFogColor,
      uFogDensity: env.uFogDensity,
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 pos = position;
        pos.z += sin(uv.y * 12.0 + uTime * 6.0) * 0.28 * (1.0 - uv.y);
        vec4 wp = modelMatrix * vec4(pos, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunColor;
      uniform vec3 uSkyHorizonColor;
      uniform float uNightFactor;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying vec2 vUv;
      varying vec3 vWorldPos;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      void main() {
        vec2 uv1 = vec2(vUv.x * 5.0, vUv.y * 3.5 + uTime * 2.4);
        vec2 uv2 = vec2(vUv.x * 11.0 + 2.3, vUv.y * 7.0 + uTime * 3.8);
        float streak = noise(uv1) * 0.6 + noise(uv2) * 0.4;
        float edgeFade = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float bottomSpray = smoothstep(0.0, 0.35, 1.0 - vUv.y);
        float alpha = clamp((streak * 0.95 + bottomSpray * 0.35) * edgeFade, 0.0, 0.92);
        vec3 baseWater = mix(vec3(0.62, 0.78, 0.86), vec3(0.95, 0.98, 1.0), smoothstep(0.35, 0.85, streak + bottomSpray * 0.3));
        vec3 lightTint = mix(uSunColor * 0.65 + uSkyHorizonColor * 0.35, vec3(0.32, 0.42, 0.58), uNightFactor);
        vec3 col = baseWater * lightTint;

        float camDist = length(cameraPosition - vWorldPos);
        float fogDist = camDist * uFogDensity;
        float fogFactor = 1.0 - exp(-(fogDist * fogDist));
        col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function createSkyDomeMaterial(env: SharedEnvUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: env.uTime,
      uWindDir: env.uWindDir,
      uCloudDensity: env.uCloudDensity,
      uSunDir: env.uSunDir,
      uSunColor: env.uSunColor,
      uSkyTopColor: env.uSkyTopColor,
      uSkyHorizonColor: env.uSkyHorizonColor,
      uMoonDir: env.uMoonDir,
      uNightFactor: env.uNightFactor,
    },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec2 uWindDir;
      uniform float uCloudDensity;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyTopColor;
      uniform vec3 uSkyHorizonColor;
      uniform vec3 uMoonDir;
      uniform float uNightFactor;
      varying vec3 vDir;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }
      float fbm(vec2 p) {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          s += a * noise(p);
          p = p * 2.04 + vec2(3.1, 5.7);
          a *= 0.5;
        }
        return s;
      }

      void main() {
        vec3 dir = normalize(vDir);
        float y = clamp(dir.y, 0.0, 1.0);

        // Rayleigh/Mie sky gradient + rich rose-amber sunset horizon band
        vec3 sky = mix(uSkyHorizonColor, uSkyTopColor, pow(max(y, 1e-4), 0.48));

        // Sun disc + Mie scattering corona + directional sunset blush
        vec3 sDir = normalize(uSunDir);
        float sunDot = max(dot(dir, sDir), 0.0);
        float sunsetArg = (sDir.y - 0.05) / 0.17;
        float sunsetWeight = exp(-(sunsetArg * sunsetArg));
        float sunDisc = smoothstep(0.9990, 0.99965, sunDot);
        float sunGlow = (sunDot > 1e-4 ? pow(sunDot, 8.0) : 0.0) * (0.38 + sunsetWeight * 0.35)
                      + (sunDot > 1e-4 ? pow(sunDot, 72.0) : 0.0) * 0.82;
        float sunVisible = smoothstep(-0.10, 0.06, sDir.y);

        // Warm peach-magenta sunset band hugging the horizon toward the sun
        float horizBand = exp(-y * 5.2) * (sunDot * sunDot) * sunsetWeight * sunVisible;
        sky += vec3(1.0, 0.44, 0.24) * horizBand * 0.58;
        sky += uSunColor * (sunGlow + sunDisc * 3.4) * sunVisible;

        // Subtle radial crepuscular sun shafts in the sky dome
        if (sunVisible > 0.02 && dir.y > -0.02 && sunDot > 1e-4) {
          vec2 azDelta = dir.xz - sDir.xz;
          float az = length(azDelta) > 1e-4 ? atan(azDelta.x, azDelta.y) : 0.0;
          float rayNoise = noise(vec2(az * 7.5 + uTime * 0.03, y * 2.5));
          float rays = pow(sunDot, 5.0) * smoothstep(0.42, 0.88, rayNoise) * (0.14 + sunsetWeight * 0.22);
          sky += uSunColor * rays * sunVisible * (1.0 - uNightFactor);
        }

        // Stars at night
        if (uNightFactor > 0.05 && dir.y > 0.02) {
          vec2 starUv = dir.xz / (dir.y + 0.32) * 58.0;
          vec2 cell = floor(starUv);
          vec2 local = fract(starUv) - 0.5;
          float rnd = hash(cell);
          if (rnd > 0.972) {
            float twinkle = 0.65 + 0.35 * sin(uTime * 2.5 + rnd * 120.0);
            float star = (1.0 - smoothstep(0.01, 0.16, length(local))) * twinkle;
            sky += vec3(0.85, 0.91, 1.0) * star * uNightFactor * smoothstep(0.02, 0.25, dir.y);
          }
        }

        // Moon disc & halo
        vec3 mDir = normalize(uMoonDir);
        float moonDot = max(dot(dir, mDir), 0.0);
        float moonVis = smoothstep(-0.04, 0.1, mDir.y) * uNightFactor;
        float moonDisc = smoothstep(0.9987, 0.9992, moonDot);
        float moonHalo = (moonDot > 1e-4 ? pow(moonDot, 28.0) : 0.0) * 0.28;
        sky += vec3(0.76, 0.86, 1.0) * (moonDisc * 1.6 + moonHalo) * moonVis;

        // Volumetric-style drifting cloud plane projection with fiery sunset underlighting
        if (dir.y > 0.015) {
          vec2 cloudCoord = dir.xz / (dir.y + 0.14) * 1.45 + uWindDir * uTime * 0.018;
          float n1 = fbm(cloudCoord);
          float n2 = fbm(cloudCoord * 2.3 - uWindDir * uTime * 0.008);
          float cloudVal = n1 * 0.72 + n2 * 0.28;
          float threshold = mix(0.68, 0.36, uCloudDensity);
          float cloudAlpha = smoothstep(threshold, threshold + 0.26, cloudVal) * smoothstep(0.015, 0.16, dir.y);

          float rim = (sunDot > 1e-4 ? pow(sunDot, 4.5) : 0.0) * sunVisible;
          vec3 sunsetUnderlit = mix(vec3(0.98, 0.66, 0.42), vec3(1.0, 0.48, 0.34), sunDot * sunDot);
          vec3 cloudLit = mix(vec3(0.96, 0.97, 0.99), uSunColor * 1.18, 0.42 + rim * 0.48);
          cloudLit = mix(cloudLit, sunsetUnderlit * 1.15, sunsetWeight * 0.75 * sunVisible);
          vec3 cloudDark = mix(uSkyTopColor * 0.52 + vec3(0.18, 0.14, 0.20), vec3(0.08, 0.11, 0.18), uNightFactor);
          cloudDark = mix(cloudDark, vec3(0.36, 0.22, 0.30), sunsetWeight * 0.48 * sunVisible);
          cloudLit = mix(cloudLit, vec3(0.26, 0.32, 0.44), uNightFactor * 0.85);
          vec3 cloudColor = mix(cloudDark, cloudLit, smoothstep(0.22, 0.85, n2 + rim * 0.35));

          sky = mix(sky, cloudColor, cloudAlpha * 0.92);
        }

        // Smooth horizon mist blend
        float horizonBlend = 1.0 - smoothstep(-0.025, 0.085, dir.y);
        sky = mix(sky, uSkyHorizonColor, horizonBlend);

        gl_FragColor = vec4(max(sky, vec3(0.0)), 1.0);
      }
    `,
  });
}

export function createFoliageCanopyMaterial(
  textures: ProceduralTextureSet,
  env: SharedEnvUniforms
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: textures.leafAlphaMap,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.74,
    metalness: 0.02,
  });
  mat.customProgramCacheKey = () => 'foliage_wind_v1';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = env.uTime;
    shader.uniforms.uWindDir = env.uWindDir;
    shader.uniforms.uWindStrength = env.uWindStrength;
    shader.uniforms.uPlayerPos = env.uPlayerPos;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform float uWindStrength;
        uniform vec3 uPlayerPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wPosF = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wPosF = instanceMatrix * wPosF;
        #endif
        wPosF = modelMatrix * wPosF;
        float gust = sin(wPosF.x * 0.18 + wPosF.z * 0.14 + uTime * 1.45);
        float flutter = sin(wPosF.x * 1.9 + wPosF.y * 2.3 + uTime * 3.8) * 0.09;
        float swayAmt = (0.14 * gust + flutter) * uWindStrength * smoothstep(1.2, 6.0, wPosF.y);
        transformed.x += uWindDir.x * swayAmt;
        transformed.z += uWindDir.y * swayAmt;
        transformed.y += sin(wPosF.x * 1.3 + uTime * 2.5) * 0.04 * uWindStrength;`
      );
  };
  return mat;
}

export function createGrassMaterial(
  textures: ProceduralTextureSet,
  env: SharedEnvUniforms
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: textures.grassBladeMap,
    alphaTest: 0.38,
    side: THREE.DoubleSide,
    roughness: 0.72,
    metalness: 0.02,
  });
  mat.customProgramCacheKey = () => 'grass_wind_v1';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = env.uTime;
    shader.uniforms.uWindDir = env.uWindDir;
    shader.uniforms.uWindStrength = env.uWindStrength;
    shader.uniforms.uPlayerPos = env.uPlayerPos;
    shader.uniforms.uRainWetness = env.uRainWetness;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform float uWindStrength;
        uniform vec3 uPlayerPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float tip = clamp(uv.y, 0.0, 1.0);
        vec4 instW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          instW = instanceMatrix * instW;
        #endif
        instW = modelMatrix * instW;

        // Travelling wind wave across meadow
        float wave = sin(instW.x * 0.25 + instW.z * 0.19 - uTime * 2.3) * 0.65
                   + sin(instW.x * 0.7 - instW.z * 0.55 - uTime * 3.9) * 0.35;
        float bend = (0.18 + wave * 0.26) * uWindStrength * tip * tip;
        transformed.x += uWindDir.x * bend;
        transformed.z += uWindDir.y * bend;

        // Player & wildlife proximity bending
        vec2 toPlayer = instW.xz - uPlayerPos.xz;
        float pDist = length(toPlayer);
        if (pDist < 2.2) {
          float push = (1.0 - smoothstep(0.2, 2.2, pDist)) * tip * 0.65;
          vec2 pushDir = pDist > 0.01 ? toPlayer / pDist : vec2(1.0, 0.0);
          transformed.x += pushDir.x * push;
          transformed.z += pushDir.y * push;
          transformed.y -= push * 0.35;
        }`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uRainWetness;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - uRainWetness * 0.42, 0.22, 0.9);`
      );
  };
  return mat;
}
