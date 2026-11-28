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

export type AntiAliasingMode = 'OFF' | 'SMAA';

export interface GraphicsFlags {
  hdr: boolean;
  rayReflections: boolean;
  giAndAo: boolean;
  clarity: boolean;
  antiAliasing: AntiAliasingMode;
}

export function getPresetGraphicsFlags(preset: QualityPreset): GraphicsFlags {
  switch (preset) {
    case 'LOW':
      return {
        hdr: false,
        rayReflections: false,
        giAndAo: false,
        clarity: false,
        antiAliasing: 'OFF',
      };
    case 'MEDIUM':
      return {
        hdr: true,
        rayReflections: false,
        giAndAo: true,
        clarity: true,
        antiAliasing: 'OFF',
      };
    case 'HIGH':
      return {
        hdr: true,
        rayReflections: true,
        giAndAo: true,
        clarity: true,
        antiAliasing: 'SMAA',
      };
    case 'ULTRA':
      return {
        hdr: true,
        rayReflections: true,
        giAndAo: true,
        clarity: true,
        antiAliasing: 'SMAA',
      };
    case 'CINEMATIC':
      return {
        hdr: true,
        rayReflections: true,
        giAndAo: true,
        clarity: true,
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
    maxPixelRatio: 1.25,
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
    maxPixelRatio: 1.35,
    shadowMapSize: 1024,
    shadowsEnabled: true,
    fogFar: 350,
    grassCount: 5200,
    grassRadius: 44,
    particleMultiplier: 0.55,
    postProcessing: true,
    bloomEnabled: true,
    gradeEnabled: true,
    waterSegments: 72,
    terrainSegments: 200,
  },
  HIGH: {
    label: 'HIGH',
    maxPixelRatio: 2.0,
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

export type WorldMapId =
  | 'lost_valley'
  | 'alpine_glacier'
  | 'emerald_archipelago'
  | 'saffron_canyon'
  | 'misty_wetlands'
  | 'crimson_caldera'
  | 'twin_fjords'
  | 'highland_meadows';

export interface WorldMapDef {
  id: WorldMapId;
  defaultWeather: WeatherMode;
  defaultTimeHours: number;
  spawn: { x: number; z: number; yaw: number };
  landmarks: LandmarkInfo[];
  hasClassicStructures?: boolean;
}

export const LANDMARKS: LandmarkInfo[] = [
  { id: 'camp', name: 'Forest Camp', x: -16, z: 76, yaw: 0.2 },
  { id: 'waterfall', name: 'Cascade Falls', x: 18, z: -96, yaw: 0.05 },
  { id: 'village', name: 'Abandoned Village', x: 96, z: 18, yaw: -1.1 },
  { id: 'cavern', name: 'Echo Cavern', x: -124, z: -102, yaw: 0.35 },
  { id: 'peak', name: 'Alpine Ridge', x: 64, z: -178, yaw: 2.8 },
  { id: 'desert', name: 'Saffron Dunes', x: 165, z: 120, yaw: 2.35 },
];

export const WORLD_MAPS: WorldMapDef[] = [
  {
    id: 'lost_valley',
    defaultWeather: 'DYNAMIC',
    defaultTimeHours: 17.65,
    spawn: { x: -16, z: 76, yaw: 1.05 },
    landmarks: LANDMARKS,
    hasClassicStructures: true,
  },
  {
    id: 'alpine_glacier',
    defaultWeather: 'SNOW',
    defaultTimeHours: 10.6,
    spawn: { x: -12, z: 72, yaw: 0.35 },
    landmarks: [
      { id: 'glacier_camp', name: 'Ice Ridge Camp', x: -12, z: 72, yaw: 0.35 },
      { id: 'frozen_basin', name: 'Frozen Twin Lake', x: -34, z: -4, yaw: -0.4 },
      { id: 'frost_spire', name: 'Frostbite Spire', x: 58, z: -145, yaw: 2.6 },
      { id: 'ice_pass', name: 'North Ice Pass', x: -92, z: -115, yaw: 0.8 },
      { id: 'crystal_overlook', name: 'Crystal Overlook', x: 108, z: 32, yaw: -1.3 },
      { id: 'snow_pine', name: 'Snowy Pine Basin', x: -128, z: 112, yaw: 2.1 },
    ],
  },
  {
    id: 'emerald_archipelago',
    defaultWeather: 'CLEAR',
    defaultTimeHours: 14.4,
    spawn: { x: 0, z: 14, yaw: 0.45 },
    landmarks: [
      { id: 'isle_camp', name: 'Sanctuary Isle', x: 0, z: 14, yaw: 0.45 },
      { id: 'crescent_lagoon', name: 'Crescent Atoll', x: -96, z: -56, yaw: 0.9 },
      { id: 'sunset_atoll', name: 'Sunset Atoll', x: 96, z: 64, yaw: -0.8 },
      { id: 'twin_palms', name: 'South Cove Isle', x: -86, z: 96, yaw: 2.2 },
      { id: 'north_spire_isle', name: 'North Spire Isle', x: 76, z: -104, yaw: -2.4 },
      { id: 'coral_sandbar', name: 'Coral Sandbar', x: 8, z: 116, yaw: 0.1 },
    ],
  },
  {
    id: 'saffron_canyon',
    defaultWeather: 'CLEAR',
    defaultTimeHours: 16.85,
    spawn: { x: -28, z: 58, yaw: -0.5 },
    landmarks: [
      { id: 'canyon_camp', name: 'Oasis Overlook', x: -28, z: 58, yaw: -0.5 },
      { id: 'oasis_pool', name: 'Emerald Oasis', x: 14, z: -34, yaw: 0.2 },
      { id: 'red_mesa', name: 'Crimson Mesa', x: -118, z: -48, yaw: 1.2 },
      { id: 'sun_gorge', name: 'Sunstone Gorge', x: 18, z: -146, yaw: 3.0 },
      { id: 'dune_sea', name: 'Golden Dune Sea', x: 136, z: 78, yaw: -1.8 },
      { id: 'south_arch', name: 'South Canyon Rim', x: 78, z: 148, yaw: 2.5 },
    ],
  },
  {
    id: 'misty_wetlands',
    defaultWeather: 'FOGGY',
    defaultTimeHours: 7.4,
    spawn: { x: -22, z: 52, yaw: 0.6 },
    landmarks: [
      { id: 'marsh_camp', name: 'Mossy Knoll', x: -22, z: 52, yaw: 0.6 },
      { id: 'cypress_heart', name: 'Cypress Heart', x: 34, z: -24, yaw: -0.9 },
      { id: 'whisper_fen', name: 'Whispering Fen', x: -112, z: 18, yaw: 1.1 },
      { id: 'sunken_delta', name: 'Braided Delta', x: 88, z: 92, yaw: -2.1 },
      { id: 'mist_ridge', name: 'North Mist Rise', x: -18, z: -132, yaw: 2.9 },
      { id: 'reed_shore', name: 'Reed Crossing', x: 122, z: -64, yaw: -1.4 },
    ],
  },
  {
    id: 'crimson_caldera',
    defaultWeather: 'STORM',
    defaultTimeHours: 18.2,
    spawn: { x: 8, z: 96, yaw: 0.05 },
    landmarks: [
      { id: 'caldera_camp', name: 'Caldera Saddle', x: 8, z: 96, yaw: 0.05 },
      { id: 'crater_heart', name: 'Crater Spire Isle', x: 0, z: 0, yaw: 0.4 },
      { id: 'north_rim', name: 'North Volcano Rim', x: -14, z: -132, yaw: 3.1 },
      { id: 'east_ash', name: 'East Basalt Ridge', x: 126, z: -12, yaw: -1.5 },
      { id: 'west_vents', name: 'West Ash Slope', x: -124, z: 18, yaw: 1.4 },
      { id: 'outer_valley', name: 'Outer Lava Wash', x: 112, z: 128, yaw: -2.4 },
    ],
  },
  {
    id: 'twin_fjords',
    defaultWeather: 'RAIN',
    defaultTimeHours: 11.8,
    spawn: { x: 2, z: 28, yaw: 0.25 },
    landmarks: [
      { id: 'fjord_camp', name: 'Peninsula Camp', x: 2, z: 28, yaw: 0.25 },
      { id: 'west_fjord', name: 'West Fjord Shore', x: -94, z: -16, yaw: 1.2 },
      { id: 'east_fjord', name: 'East Fjord Cliffs', x: 102, z: -10, yaw: -1.2 },
      { id: 'glacier_head', name: 'Highland Headwall', x: 4, z: -148, yaw: 3.0 },
      { id: 'south_strait', name: 'South Fjord Mouth', x: -14, z: 132, yaw: 0.1 },
      { id: 'granite_lookout', name: 'Granite Lookout', x: -128, z: -116, yaw: 0.8 },
    ],
  },
  {
    id: 'highland_meadows',
    defaultWeather: 'CLEAR',
    defaultTimeHours: 9.4,
    spawn: { x: -34, z: 44, yaw: 0.75 },
    landmarks: [
      { id: 'meadow_camp', name: 'Wildflower Camp', x: -34, z: 44, yaw: 0.75 },
      { id: 'river_bend', name: 'Golden Bend', x: 24, z: -18, yaw: -0.6 },
      { id: 'birch_terrace', name: 'Birch Terrace', x: -114, z: -38, yaw: 1.0 },
      { id: 'sunny_crest', name: 'Sunlit Crest', x: 108, z: -96, yaw: -2.2 },
      { id: 'orchard_vale', name: 'South Vale', x: 92, z: 98, yaw: -2.6 },
      { id: 'high_moor', name: 'Northern Moor', x: -24, z: -156, yaw: 2.9 },
    ],
  },
];

export function getWorldMapDef(id: WorldMapId): WorldMapDef {
  return WORLD_MAPS.find((m) => m.id === id) ?? WORLD_MAPS[0];
}

export type EnemyCategory = 'beast' | 'raider' | 'boss' | 'squad' | 'mech';

export interface EnemyHudTarget {
  id: string;
  category: EnemyCategory;
  nameKey: string;
  hp: number;
  maxHp: number;
  dist: number;
  isBoss: boolean;
}

export interface EnemyMapMarker {
  id: string;
  x: number;
  z: number;
  category: EnemyCategory;
}

export interface HudTelemetry {
  activeMapId: WorldMapId;
  biomeLabel: string;
  timeHours: number;
  weatherLabel: string;
  headingDeg: number;
  elevation: number;
  playerX: number;
  playerZ: number;
  speedMs: number;
  health: number;
  maxHealth: number;
  stamina: number;
  warmth: number;
  hydration: number;
  nearCampfire: boolean;
  campfireLit: boolean;
  nearWater: boolean;
  isSwimming: boolean;
  inCave: boolean;
  flashlightOn: boolean;
  fps: number;
  isPointerLocked: boolean;
  defeatedCount: number;
  activeEnemyTarget: EnemyHudTarget | null;
  playerHitFlash: number;
  respawnBannerTimer: number;
}
