export type QualityPreset = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA' | 'CINEMATIC';

export type WeatherMode = 'DYNAMIC' | 'CLEAR' | 'FOGGY' | 'RAIN' | 'STORM' | 'SNOW';

export type CameraMode = 'THIRD_PERSON' | 'FIRST_PERSON' | 'CINEMATIC_ORBIT';

export type BiomeId =
  | 'FOREST'
  | 'MEADOW'
  | 'MOUNTAIN'
  | 'SNOW_PEAKS'
  | 'RIVER_LAKE'
  | 'MARSH'
  | 'DESERT'
  | 'ABANDONED_VILLAGE'
  | 'CAVERN';

export interface LandmarkInfo {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
}

export type AntiAliasingMode = 'OFF' | 'FXAA' | 'SMAA';

export interface GraphicsFlags {
  hdr: boolean;
  rayReflections: boolean;
  giAndAo: boolean;
  dof: boolean;
  motionBlur: boolean;
  antiAliasing: AntiAliasingMode;
}

export function getPresetGraphicsFlags(preset: QualityPreset): GraphicsFlags {
  switch (preset) {
    case 'LOW':
      return {
        hdr: false,
        rayReflections: false,
        giAndAo: false,
        dof: false,
        motionBlur: false,
        antiAliasing: 'OFF',
      };
    case 'MEDIUM':
      return {
        hdr: true,
        rayReflections: false,
        giAndAo: false,
        dof: false,
        motionBlur: false,
        antiAliasing: 'FXAA',
      };
    case 'HIGH':
      return {
        hdr: true,
        rayReflections: true,
        giAndAo: true,
        dof: false,
        motionBlur: true,
        antiAliasing: 'FXAA',
      };
    case 'ULTRA':
      return {
        hdr: true,
        rayReflections: true,
        giAndAo: true,
        dof: true,
        motionBlur: true,
        antiAliasing: 'SMAA',
      };
    case 'CINEMATIC':
      return {
        hdr: true,
        rayReflections: true,
        giAndAo: true,
        dof: true,
        motionBlur: true,
        antiAliasing: 'SMAA',
      };
  }
}

export interface QualityConfig {
  label: QualityPreset;
  maxPixelRatio: number;
  shadowMapSize: number;
  shadowsEnabled: boolean;
  fogFar: number;
  grassCount: number;
  grassRadius: number;
  particleMultiplier: number;
  postProcessing: boolean;
  bloomEnabled: boolean;
  gradeEnabled: boolean;
  waterSegments: number;
  terrainSegments: number;
}

export const QUALITY_CONFIGS: Record<QualityPreset, QualityConfig> = {
  LOW: {
    label: 'LOW',
    maxPixelRatio: 1.0,
    shadowMapSize: 512,
    shadowsEnabled: false,
    fogFar: 240,
    grassCount: 2500,
    grassRadius: 34,
    particleMultiplier: 0.3,
    postProcessing: false,
    bloomEnabled: false,
    gradeEnabled: false,
    waterSegments: 48,
    terrainSegments: 160,
  },
  MEDIUM: {
    label: 'MEDIUM',
    maxPixelRatio: 1.25,
    shadowMapSize: 1024,
    shadowsEnabled: true,
    fogFar: 360,
    grassCount: 6500,
    grassRadius: 48,
    particleMultiplier: 0.6,
    postProcessing: true,
    bloomEnabled: true,
    gradeEnabled: false,
    waterSegments: 80,
    terrainSegments: 220,
  },
  HIGH: {
    label: 'HIGH',
    maxPixelRatio: 1.6,
    shadowMapSize: 2048,
    shadowsEnabled: true,
    fogFar: 460,
    grassCount: 12000,
    grassRadius: 62,
    particleMultiplier: 0.85,
    postProcessing: true,
    bloomEnabled: true,
    gradeEnabled: true,
    waterSegments: 112,
    terrainSegments: 260,
  },
  ULTRA: {
    label: 'ULTRA',
    maxPixelRatio: 2.0,
    shadowMapSize: 2048,
    shadowsEnabled: true,
    fogFar: 560,
    grassCount: 18000,
    grassRadius: 74,
    particleMultiplier: 1.0,
    postProcessing: true,
    bloomEnabled: true,
    gradeEnabled: true,
    waterSegments: 140,
    terrainSegments: 300,
  },
  CINEMATIC: {
    label: 'CINEMATIC',
    maxPixelRatio: 2.0,
    shadowMapSize: 4096,
    shadowsEnabled: true,
    fogFar: 660,
    grassCount: 24000,
    grassRadius: 85,
    particleMultiplier: 1.25,
    postProcessing: true,
    bloomEnabled: true,
    gradeEnabled: true,
    waterSegments: 160,
    terrainSegments: 320,
  },
};

export const LANDMARKS: LandmarkInfo[] = [
  { id: 'camp', name: 'Forest Camp', x: -16, z: 76, yaw: 0.2 },
  { id: 'waterfall', name: 'Cascade Falls', x: 18, z: -96, yaw: 0.05 },
  { id: 'village', name: 'Abandoned Village', x: 96, z: 18, yaw: -1.1 },
  { id: 'cavern', name: 'Echo Cavern', x: -124, z: -102, yaw: 0.35 },
  { id: 'peak', name: 'Alpine Ridge', x: 64, z: -178, yaw: 2.8 },
  { id: 'desert', name: 'Saffron Dunes', x: 165, z: 120, yaw: 2.35 },
];

export interface HudTelemetry {
  biomeLabel: string;
  timeHours: number;
  weatherLabel: string;
  headingDeg: number;
  elevation: number;
  speedMs: number;
  stamina: number;
  warmth: number;
  hydration: number;
  nearCampfire: boolean;
  campfireLit: boolean;
  nearWater: boolean;
  inCave: boolean;
  flashlightOn: boolean;
  fps: number;
  isPointerLocked: boolean;
}
