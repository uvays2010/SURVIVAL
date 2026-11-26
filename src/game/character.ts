import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';
import { groundHeightAt, groundNormalAt, waterDistanceInfo, WATER_LEVEL } from './noise';

export interface CharacterState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  isGrounded: boolean;
  isCrouching: boolean;
  isSprinting: boolean;
  isWading: boolean;
  isSwimming: boolean;
  waterDepth: number;
  moveSpeed: number;
  walkPhase: number;
  swimPhase: number;
  landSquash: number;
  flashlightOn: boolean;
  lastStepSign: number;
  attackCombo: number;
  attackTimer: number;
  attackDuration: number;
  isHeavyAttack: boolean;
  comboWindowTimer: number;
  dodgeTimer: number;
  dodgeDirX: number;
  dodgeDirZ: number;
  isGuarding: boolean;
}

export interface CharacterSystem {
  group: THREE.Group;
  state: CharacterState;
  flashlight: THREE.SpotLight;
  flashlightCone: THREE.Mesh;
  footprintsMesh: THREE.InstancedMesh;
  triggerAttack: (heavy: boolean) => { comboStep: number; isHeavy: boolean } | null;
  triggerDodge: (inputForward: number, inputRight: number) => boolean;
  setGuarding: (guarding: boolean) => void;
  update: (
    dt: number,
    elapsed: number,
    inputForward: number,
    inputRight: number,
    wantJump: boolean,
    wantSprint: boolean,
    wantCrouch: boolean,
    windDir: THREE.Vector2,
    windStrength: number,
    rainIntensity: number,
    snowIntensity: number,
    isFirstPerson: boolean,
    groundHeightQuery: (x: number, z: number) => number,
    resolveCollisions: (x: number, z: number, r: number) => { x: number; z: number }
  ) => void;
  setPosition: (x: number, z: number, yaw: number) => void;
}

const MAX_FOOTPRINTS = 140;

interface FootprintRecord {
  active: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  nx: number;
  ny: number;
  nz: number;
  age: number;
  maxAge: number;
  side: number;
}

interface SpringNode2D {
  ax: number;
  az: number;
  vx: number;
  vz: number;
}

function createSpringNode(ax = 0, az = 0): SpringNode2D {
  return { ax, az, vx: 0, vz: 0 };
}

function stepSpring2D(
  node: SpringNode2D,
  targetX: number,
  targetZ: number,
  stiffness: number,
  damping: number,
  dt: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): void {
  const safeDt = Math.min(dt, 0.04);
  const fx = (targetX - node.ax) * stiffness - node.vx * damping;
  const fz = (targetZ - node.az) * stiffness - node.vz * damping;
  node.vx += fx * safeDt;
  node.vz += fz * safeDt;
  node.ax = THREE.MathUtils.clamp(node.ax + node.vx * safeDt, minX, maxX);
  node.az = THREE.MathUtils.clamp(node.az + node.vz * safeDt, minZ, maxZ);
}

/**
 * Adds fast wrap-lighting + warm crimson-coral subsurface scattering (SSS)
 * onto MeshPhysicalMaterial without triggering a costly extra scene render pass.
 */
function applySubsurfaceSkinShader(mat: THREE.MeshPhysicalMaterial, scatterStrength = 1.0): void {
  mat.customProgramCacheKey = () => `female-skin-sss-${scatterStrength.toFixed(2)}`;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `
      #include <lights_fragment_end>
      {
        vec3 sssViewDir = normalize(vViewPosition);
        float sssFresnel = pow(1.0 - clamp(dot(normal, sssViewDir), 0.0, 1.0), 2.15);
        float sssFrontWrap = clamp(dot(normal, vec3(0.25, 0.55, 0.8)) * 0.5 + 0.5, 0.0, 1.0);
        vec3 sssTint = vec3(1.0, 0.36, 0.25);
        float sssLum = clamp(dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3(0.3, 0.5, 0.2)), 0.12, 1.15);
        reflectedLight.directDiffuse += diffuseColor.rgb * sssTint * (0.14 * sssFrontWrap + 0.19 * sssFresnel) * sssLum * ${scatterStrength.toFixed(2)};
      }
      `
    );
  };
}

/**
 * Sculpts a smooth, graceful feminine cranium, cheekbones, tapered jawline, and chin
 * while keeping Spherical UV u=0.5 aligned straight forward (+Z).
 */
function createSculptedFeminineHeadGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.112, 32, 24);
  geo.rotateY(-Math.PI * 0.5); // u=0.5 now points straight along +Z
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    const ny = y / 0.112; // -1 (chin/base) .. +1 (crown)
    const nz = z / 0.112; // -1 (back) .. +1 (front face)

    // Graceful oval elongation & slight temple narrowness
    x *= 0.91;
    y *= 1.09;
    z *= 0.94;

    // Taper lower jawline smoothly toward a delicate chin
    if (ny < -0.05) {
      const jawT = Math.min(1, (-ny - 0.05) / 0.95);
      const narrow = 1.0 - jawT * 0.36;
      x *= narrow;
      if (nz > 0.1) {
        // Gentle chin projection forward & slightly down
        z += jawT * 0.011 * nz;
        y -= jawT * 0.008 * nz;
      } else {
        // Taper neck-skull junction cleanly at the back bottom
        z *= 1.0 - jawT * 0.18;
      }
    }

    // Softly sculpted cheekbones
    const cheekBand = Math.exp(-Math.pow((ny + 0.12) * 3.1, 2));
    if (nz > 0.25) {
      const sideFactor = Math.min(1, Math.abs(x) / 0.055);
      z += cheekBand * sideFactor * 0.0065;
      x *= 1.0 + cheekBand * 0.035;
    }

    // Subtle orbital hollowing around eye level for natural 3D eyelid/brow framing
    const eyeBand = Math.exp(-Math.pow((ny - 0.11) * 4.2, 2));
    const eyeX = Math.exp(-Math.pow((Math.abs(x) - 0.036) / 0.022, 2));
    if (nz > 0.45) {
      z -= eyeBand * eyeX * 0.0065;
    }

    // Slightly flatten lower-front facial plane for refined profile
    if (nz > 0.55 && ny > -0.45 && ny < 0.35) {
      z -= 0.004 * (nz - 0.55);
    }

    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * Sculpts a tapered multi-segment curved lock of hair along -Y with subtle wave contour.
 */
function createHairLockGeometry(
  topRadius: number,
  midRadius: number,
  tipRadius: number,
  length: number,
  curveBackZ = 0.025
): THREE.BufferGeometry {
  const segY = 10;
  const segR = 10;
  const geo = new THREE.CylinderGeometry(tipRadius, topRadius, length, segR, segY, false);
  // Shift pivot to top root (y = 0 down to -length)
  geo.translate(0, -length * 0.5, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    const y = pos.getY(i);
    let z = pos.getZ(i);
    const t = Math.min(1, Math.max(0, -y / length));
    const profile =
      t < 0.35
        ? THREE.MathUtils.lerp(topRadius, midRadius, t / 0.35)
        : THREE.MathUtils.lerp(midRadius, tipRadius, (t - 0.35) / 0.65);
    const curR = Math.hypot(x, z);
    if (curR > 1e-5) {
      const scale = profile / curR;
      x *= scale * 1.15; // Slightly ribbon-flattened fuller hair volume
      z *= scale * 0.85;
    }
    // Gentle S-wave and backward arc
    z += Math.sin(t * Math.PI) * curveBackZ + Math.sin(t * Math.PI * 2.2) * 0.008;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createCharacterSystem(
  scene: THREE.Scene,
  textures: ProceduralTextureSet
): CharacterSystem {
  const group = new THREE.Group();

  // --- PBR + SSS + Cloth + Hair + Cornea Materials ---
  const skinMat = new THREE.MeshPhysicalMaterial({
    color: 0xf1cab0,
    roughness: 0.45,
    metalness: 0.0,
    sheen: 0.62,
    sheenRoughness: 0.46,
    sheenColor: new THREE.Color(0xff9678),
    clearcoat: 0.08,
    clearcoatRoughness: 0.58,
  });
  applySubsurfaceSkinShader(skinMat, 1.0);

  const faceMat = new THREE.MeshPhysicalMaterial({
    map: textures.faceMap,
    color: 0xffffff,
    roughness: 0.44,
    metalness: 0.0,
    sheen: 0.65,
    sheenRoughness: 0.44,
    sheenColor: new THREE.Color(0xff9476),
    clearcoat: 0.09,
    clearcoatRoughness: 0.54,
  });
  applySubsurfaceSkinShader(faceMat, 1.08);

  const lipMat = new THREE.MeshPhysicalMaterial({
    color: 0xc95e60,
    roughness: 0.32,
    metalness: 0.0,
    sheen: 0.5,
    sheenColor: new THREE.Color(0xff9c9c),
    clearcoat: 0.48,
    clearcoatRoughness: 0.28,
  });
  applySubsurfaceSkinShader(lipMat, 0.8);

  const scleraMat = new THREE.MeshPhysicalMaterial({
    color: 0xf7f3ee,
    roughness: 0.16,
    metalness: 0.0,
    clearcoat: 0.65,
    clearcoatRoughness: 0.12,
  });

  const irisMat = new THREE.MeshStandardMaterial({
    map: textures.irisMap,
    color: 0xffffff,
    roughness: 0.24,
    metalness: 0.04,
    emissive: new THREE.Color(0x133326),
    emissiveIntensity: 0.16,
  });

  const corneaMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.15,
    roughness: 0.02,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    ior: 1.4,
    envMapIntensity: 2.6,
    depthWrite: false,
  });

  const lashMat = new THREE.MeshStandardMaterial({
    color: 0x160f0c,
    roughness: 0.65,
    metalness: 0.02,
  });

  const hairMat = new THREE.MeshPhysicalMaterial({
    map: textures.hairMap,
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.06,
    sheen: 0.85,
    sheenRoughness: 0.3,
    sheenColor: new THREE.Color(0xb87f58),
    clearcoat: 0.16,
    clearcoatRoughness: 0.42,
  });

  const tunicMat = new THREE.MeshPhysicalMaterial({
    map: textures.fabricMap,
    normalMap: textures.fabricNormal,
    normalScale: new THREE.Vector2(0.42, 0.42),
    color: 0xe6ddd0, // Breathable ivory-cream expedition blouse
    roughness: 0.84,
    metalness: 0.02,
    sheen: 0.35,
    sheenRoughness: 0.65,
    sheenColor: new THREE.Color(0xfff5e8),
  });

  const vestMat = new THREE.MeshPhysicalMaterial({
    map: textures.fabricMap,
    normalMap: textures.fabricNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    color: 0x2f4b3e, // Tailored deep emerald-sage explorer vest
    roughness: 0.78,
    metalness: 0.04,
    sheen: 0.42,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0x7ca68e),
  });

  const clothCoatMat = new THREE.MeshPhysicalMaterial({
    map: textures.fabricMap,
    normalMap: textures.fabricNormal,
    normalScale: new THREE.Vector2(0.52, 0.52),
    color: 0x355344,
    roughness: 0.78,
    metalness: 0.04,
    sheen: 0.48,
    sheenRoughness: 0.52,
    sheenColor: new THREE.Color(0x88b49b),
    side: THREE.DoubleSide,
  });

  const scarfMat = new THREE.MeshPhysicalMaterial({
    map: textures.fabricMap,
    normalMap: textures.fabricNormal,
    normalScale: new THREE.Vector2(0.48, 0.48),
    color: 0xa63c35, // Warm terracotta-crimson flowing adventurer scarf
    roughness: 0.74,
    metalness: 0.02,
    sheen: 0.72,
    sheenRoughness: 0.42,
    sheenColor: new THREE.Color(0xff8e7a),
    side: THREE.DoubleSide,
  });

  const ribbonMat = new THREE.MeshPhysicalMaterial({
    color: 0x2e8568,
    roughness: 0.36,
    metalness: 0.06,
    sheen: 0.85,
    sheenColor: new THREE.Color(0x8be6c2),
    side: THREE.DoubleSide,
  });

  const pantsMat = new THREE.MeshPhysicalMaterial({
    map: textures.fabricMap,
    normalMap: textures.fabricNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    color: 0x2f2a27, // Fitted dark charcoal-umber riding trousers
    roughness: 0.84,
    metalness: 0.03,
    sheen: 0.25,
  });

  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0x4f2f1e,
    roughness: 0.54,
    metalness: 0.1,
  });

  const bootMat = new THREE.MeshStandardMaterial({
    color: 0x2b1b13,
    roughness: 0.52,
    metalness: 0.1,
  });

  const soleMat = new THREE.MeshStandardMaterial({
    color: 0x141416,
    roughness: 0.9,
  });

  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x87919b,
    roughness: 0.22,
    metalness: 0.92,
  });

  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd4aa52,
    roughness: 0.26,
    metalness: 0.88,
  });

  const packMat = new THREE.MeshStandardMaterial({
    map: textures.fabricMap,
    normalMap: textures.fabricNormal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    color: 0x6b472f,
    roughness: 0.76,
    metalness: 0.06,
  });

  const strapMat = new THREE.MeshStandardMaterial({
    color: 0x221b17,
    roughness: 0.65,
    metalness: 0.12,
  });

  // --- Pelvis Root (Contoured Feminine Hips, Corset Waist Belt, Satchel Pouch) ---
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.92;
  group.add(pelvis);

  const hipsProfile = [
    new THREE.Vector2(0.0, -0.095),
    new THREE.Vector2(0.115, -0.09),
    new THREE.Vector2(0.158, -0.03),
    new THREE.Vector2(0.152, 0.035),
    new THREE.Vector2(0.122, 0.095),
    new THREE.Vector2(0.0, 0.095),
  ];
  const hipsGeo = new THREE.LatheGeometry(hipsProfile, 18);
  hipsGeo.computeTangents();
  const hipsMesh = new THREE.Mesh(hipsGeo, pantsMat);
  hipsMesh.scale.set(1.06, 1.0, 0.74);
  hipsMesh.castShadow = true;
  pelvis.add(hipsMesh);

  // Tapered Leather Corset Waist Belt & Brass Buckle + Hip Pouch & Sheath
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.126, 0.145, 0.068, 16), leatherMat);
  belt.scale.set(1.06, 1.0, 0.76);
  belt.position.y = 0.065;
  belt.castShadow = true;
  pelvis.add(belt);

  const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.048, 0.02), brassMat);
  beltBuckle.position.set(0, 0.065, 0.112);
  pelvis.add(beltBuckle);

  const hipPouch = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.095, 0.08), leatherMat);
  hipPouch.position.set(-0.165, 0.02, 0.02);
  hipPouch.rotation.z = 0.12;
  hipPouch.castShadow = true;
  pelvis.add(hipPouch);

  const sheath = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.21, 0.055), leatherMat);
  sheath.position.set(0.168, -0.04, 0.01);
  sheath.rotation.x = 0.2;
  sheath.rotation.z = -0.1;
  pelvis.add(sheath);

  // --- Multi-Panel Flowing Cloth Coat-Tails / Split Explorer Sash (Cloth Simulation) ---
  const coatBackGeo = new THREE.PlaneGeometry(0.22, 0.24, 4, 4);
  coatBackGeo.translate(0, -0.12, 0);
  const coatBackLowerGeo = new THREE.PlaneGeometry(0.25, 0.22, 4, 4);
  coatBackLowerGeo.translate(0, -0.11, 0);

  const coatBackPivot = new THREE.Group();
  coatBackPivot.position.set(0, 0.055, -0.115);
  pelvis.add(coatBackPivot);
  const coatBackSeg1 = new THREE.Mesh(coatBackGeo, clothCoatMat);
  coatBackSeg1.rotation.x = 0.14;
  coatBackSeg1.castShadow = true;
  coatBackPivot.add(coatBackSeg1);

  const coatBackLowerPivot = new THREE.Group();
  coatBackLowerPivot.position.set(0, -0.23, 0);
  coatBackSeg1.add(coatBackLowerPivot);
  const coatBackSeg2 = new THREE.Mesh(coatBackLowerGeo, clothCoatMat);
  coatBackSeg2.castShadow = true;
  coatBackLowerPivot.add(coatBackSeg2);

  const coatSideGeo1 = new THREE.PlaneGeometry(0.14, 0.22, 3, 3);
  coatSideGeo1.translate(0, -0.11, 0);
  const coatSideGeo2 = new THREE.PlaneGeometry(0.16, 0.2, 3, 3);
  coatSideGeo2.translate(0, -0.1, 0);

  const buildSideCloth = (side: number) => {
    const p1 = new THREE.Group();
    p1.position.set(side * 0.155, 0.052, -0.02);
    p1.rotation.y = side * 1.15;
    pelvis.add(p1);
    const m1 = new THREE.Mesh(coatSideGeo1, clothCoatMat);
    m1.rotation.x = 0.1;
    m1.castShadow = true;
    p1.add(m1);

    const p2 = new THREE.Group();
    p2.position.set(0, -0.21, 0);
    m1.add(p2);
    const m2 = new THREE.Mesh(coatSideGeo2, clothCoatMat);
    m2.castShadow = true;
    p2.add(m2);
    return { p1, p2 };
  };
  const leftCoatCloth = buildSideCloth(-1);
  const rightCoatCloth = buildSideCloth(1);

  // --- Sculpted Feminine Torso (Hourglass Waist, Contoured Bust, Tailored Explorer Vest) ---
  const torso = new THREE.Group();
  torso.position.y = 0.08;
  pelvis.add(torso);

  const torsoProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.112, 0.02), // Slender waist
    new THREE.Vector2(0.118, 0.1),
    new THREE.Vector2(0.145, 0.21), // Ribcage flare
    new THREE.Vector2(0.165, 0.31), // Upper chest
    new THREE.Vector2(0.152, 0.4), // Tapered shoulders
    new THREE.Vector2(0.092, 0.46),
    new THREE.Vector2(0.0, 0.46),
  ];
  const chestGeo = new THREE.LatheGeometry(torsoProfile, 20);
  chestGeo.computeTangents();
  const chestMesh = new THREE.Mesh(chestGeo, vestMat);
  chestMesh.scale.set(1.06, 1.0, 0.72);
  chestMesh.castShadow = true;
  torso.add(chestMesh);

  // Contoured Feminine Bust & Crisp V-Neck Cream Blouse Inset
  for (const sx of [-0.062, 0.062]) {
    const bustContour = new THREE.Mesh(new THREE.SphereGeometry(0.072, 16, 14), vestMat);
    bustContour.scale.set(1.05, 0.92, 0.88);
    bustContour.position.set(sx, 0.3, 0.088);
    bustContour.castShadow = true;
    torso.add(bustContour);
  }

  const blouseInset = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.048, 0.22, 12), tunicMat);
  blouseInset.scale.set(0.95, 1.0, 0.65);
  blouseInset.position.set(0, 0.34, 0.098);
  torso.add(blouseInset);

  // Brass Vest Buttons & Tailored Lapels
  for (let b = 0; b < 4; b++) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), brassMat);
    btn.rotation.x = Math.PI * 0.5;
    btn.position.set(0, 0.09 + b * 0.055, 0.112 + b * 0.008);
    torso.add(btn);
  }

  for (const sx of [-1, 1]) {
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.18, 0.02), leatherMat);
    lapel.position.set(sx * 0.056, 0.35, 0.125);
    lapel.rotation.z = sx * 0.28;
    lapel.rotation.y = sx * 0.22;
    torso.add(lapel);
  }

  // --- Flowing Terracotta Adventurer Neck Scarf + 3-Segment Cloth Tail ---
  const scarfCollar = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.036, 12, 22), scarfMat);
  scarfCollar.rotation.x = Math.PI * 0.5 + 0.12;
  scarfCollar.scale.set(1.05, 0.92, 1.15);
  scarfCollar.position.set(0, 0.455, 0.005);
  scarfCollar.castShadow = true;
  torso.add(scarfCollar);

  const buildScarfTailSeg = (w: number, h: number) => {
    const g = new THREE.PlaneGeometry(w, h, 3, 4);
    g.translate(0, -h * 0.5, 0);
    return g;
  };
  const scarfTailPivot0 = new THREE.Group();
  scarfTailPivot0.position.set(-0.088, 0.435, -0.055);
  scarfTailPivot0.rotation.z = -0.18;
  scarfTailPivot0.rotation.y = -0.25;
  torso.add(scarfTailPivot0);
  const scarfSeg0 = new THREE.Mesh(buildScarfTailSeg(0.088, 0.18), scarfMat);
  scarfSeg0.rotation.x = 0.22;
  scarfSeg0.castShadow = true;
  scarfTailPivot0.add(scarfSeg0);

  const scarfTailPivot1 = new THREE.Group();
  scarfTailPivot1.position.set(0, -0.175, 0);
  scarfSeg0.add(scarfTailPivot1);
  const scarfSeg1 = new THREE.Mesh(buildScarfTailSeg(0.096, 0.18), scarfMat);
  scarfSeg1.castShadow = true;
  scarfTailPivot1.add(scarfSeg1);

  const scarfTailPivot2 = new THREE.Group();
  scarfTailPivot2.position.set(0, -0.175, 0);
  scarfSeg1.add(scarfTailPivot2);
  const scarfSeg2 = new THREE.Mesh(buildScarfTailSeg(0.082, 0.15), scarfMat);
  scarfSeg2.castShadow = true;
  scarfTailPivot2.add(scarfSeg2);

  // --- Sleek Compact Leather Expedition Pack (leaves ponytail & shoulders unobstructed) ---
  const backpack = new THREE.Group();
  backpack.position.set(0, 0.21, -0.152);
  torso.add(backpack);

  const packMain = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.125), packMat);
  packMain.castShadow = true;
  backpack.add(packMain);

  const packFlap = new THREE.Mesh(new THREE.BoxGeometry(0.255, 0.075, 0.14), leatherMat);
  packFlap.position.set(0, 0.13, 0);
  packFlap.castShadow = true;
  backpack.add(packFlap);

  const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.27, 10), strapMat);
  bedroll.rotation.z = Math.PI * 0.5;
  bedroll.position.set(0, -0.175, -0.01);
  bedroll.castShadow = true;
  backpack.add(bedroll);

  for (const sx of [-0.085, 0.085]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.3, 0.18), strapMat);
    strap.position.set(sx, 0.03, 0.09);
    backpack.add(strap);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.024, 0.014), brassMat);
    buckle.position.set(sx, 0.05, -0.07);
    backpack.add(buckle);
  }

  // --- Head, Sculpted Face, SSS Skin, Glossy 3D Eyes, Animated Lids/Brows/Lips, Physics Hair ---
  const headPivot = new THREE.Group();
  headPivot.position.y = 0.475;
  torso.add(headPivot);

  // Slender Graceful Neck + Subtle Collarbone Transition
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.056, 0.115, 14), skinMat);
  neck.position.y = 0.042;
  neck.castShadow = true;
  headPivot.add(neck);

  // Sculpted Feminine Head Mesh (u=0.5 forward +Z baked cleanly into geometry)
  const headMesh = new THREE.Mesh(createSculptedFeminineHeadGeometry(), faceMat);
  headMesh.position.y = 0.165;
  headMesh.castShadow = true;
  headPivot.add(headMesh);

  // Delicate Sculpted Nose (Bridge + Soft Tip)
  const noseBridge = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0085, 0.038, 8), skinMat);
  noseBridge.rotation.x = -0.32;
  noseBridge.position.set(0, 0.158, 0.101);
  headPivot.add(noseBridge);

  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 10, 8), skinMat);
  noseTip.scale.set(1.0, 0.82, 1.05);
  noseTip.position.set(0, 0.143, 0.109);
  headPivot.add(noseTip);

  // Sculpted Ears + Tiny Gold/Pearl Explorer Studs
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 10), skinMat);
    ear.scale.set(0.38, 1.15, 0.68);
    ear.rotation.z = side * -0.12;
    ear.position.set(side * 0.097, 0.158, -0.004);
    headPivot.add(ear);

    const stud = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 8), brassMat);
    stud.position.set(side * 0.102, 0.141, 0.0);
    headPivot.add(stud);
  }

  // Sculpted 3D Upper & Lower Lips (Animated with gentle smile / exertion)
  const upperLipCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.021, 0.0, -0.004),
    new THREE.Vector3(-0.007, 0.0038, 0.004),
    new THREE.Vector3(0, 0.0022, 0.0055),
    new THREE.Vector3(0.007, 0.0038, 0.004),
    new THREE.Vector3(0.021, 0.0, -0.004),
  ]);
  const upperLipMesh = new THREE.Mesh(new THREE.TubeGeometry(upperLipCurve, 14, 0.0038, 8, false), lipMat);
  upperLipMesh.position.set(0, 0.118, 0.095);
  headPivot.add(upperLipMesh);

  const lowerLipCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.018, 0.001, -0.003),
    new THREE.Vector3(0, -0.0035, 0.0055),
    new THREE.Vector3(0.018, 0.001, -0.003),
  ]);
  const lowerLipMesh = new THREE.Mesh(new THREE.TubeGeometry(lowerLipCurve, 12, 0.0046, 8, false), lipMat);
  lowerLipMesh.position.set(0, 0.112, 0.094);
  headPivot.add(lowerLipMesh);

  // --- Sculpted 3D Eyes (Sclera, Radial Emerald-Gold Iris, Glossy Clearcoat Cornea, Animated Eyelids & Brows) ---
  interface EyeRig {
    gazePivot: THREE.Group;
    upperLidPivot: THREE.Group;
    lowerLidPivot: THREE.Group;
    browPivot: THREE.Group;
  }

  const scleraGeo = new THREE.SphereGeometry(0.0168, 16, 14);
  const irisGeo = new THREE.CircleGeometry(0.0094, 22);
  const corneaGeo = new THREE.SphereGeometry(0.0176, 16, 12, 0, Math.PI * 2, 0, 0.72);
  corneaGeo.rotateX(Math.PI * 0.5);

  const upperLidGeo = new THREE.SphereGeometry(0.0185, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const lowerLidGeo = new THREE.SphereGeometry(0.0182, 14, 8, 0, Math.PI * 2, Math.PI * 0.56, Math.PI * 0.36);

  const buildEye = (side: number): EyeRig => {
    const socket = new THREE.Group();
    socket.position.set(side * 0.0345, 0.172, 0.082);
    socket.rotation.y = side * 0.11;
    headPivot.add(socket);

    const gazePivot = new THREE.Group();
    socket.add(gazePivot);

    const sclera = new THREE.Mesh(scleraGeo, scleraMat);
    sclera.scale.set(1.06, 0.94, 0.92);
    gazePivot.add(sclera);

    const iris = new THREE.Mesh(irisGeo, irisMat);
    iris.position.set(0, 0, 0.0148);
    gazePivot.add(iris);

    const cornea = new THREE.Mesh(corneaGeo, corneaMat);
    cornea.position.set(0, 0, 0.0014);
    cornea.renderOrder = 2;
    gazePivot.add(cornea);

    // Animated Upper Eyelid + Curved Eyelash Line
    const upperLidPivot = new THREE.Group();
    socket.add(upperLidPivot);
    const upperLid = new THREE.Mesh(upperLidGeo, skinMat);
    upperLid.scale.set(1.08, 0.98, 0.98);
    upperLidPivot.add(upperLid);

    const lashCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.016, -0.002, 0.012),
      new THREE.Vector3(-0.006, 0.002, 0.0178),
      new THREE.Vector3(0.006, 0.002, 0.0178),
      new THREE.Vector3(0.016, -0.002, 0.012),
    ]);
    const upperLash = new THREE.Mesh(new THREE.TubeGeometry(lashCurve, 10, 0.0016, 6, false), lashMat);
    upperLidPivot.add(upperLash);
    upperLidPivot.rotation.x = -0.34; // Open relaxed upper lid

    // Animated Lower Eyelid
    const lowerLidPivot = new THREE.Group();
    socket.add(lowerLidPivot);
    const lowerLid = new THREE.Mesh(lowerLidGeo, skinMat);
    lowerLid.scale.set(1.07, 0.96, 0.96);
    lowerLidPivot.add(lowerLid);
    lowerLidPivot.rotation.x = 0.08;

    // Articulated Sculpted Eyebrow
    const browPivot = new THREE.Group();
    browPivot.position.set(side * 0.035, 0.197, 0.09);
    browPivot.rotation.y = side * 0.14;
    headPivot.add(browPivot);

    const browCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-side * 0.019, -0.002, 0.002),
      new THREE.Vector3(0, 0.0045, 0.0055),
      new THREE.Vector3(side * 0.018, -0.001, -0.002),
    ]);
    const browMesh = new THREE.Mesh(new THREE.TubeGeometry(browCurve, 10, 0.0026, 6, false), hairMat);
    browPivot.add(browMesh);

    return { gazePivot, upperLidPivot, lowerLidPivot, browPivot };
  };

  const leftEye = buildEye(-1);
  const rightEye = buildEye(1);

  // --- Layered Silky Chestnut Hair + Multi-Segment Spring-Physics Ponytail & Side Locks ---
  // Sculpted crown cap wrapping neatly around skull back & crown
  const hairCrown = new THREE.Mesh(
    new THREE.SphereGeometry(0.118, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hairMat
  );
  hairCrown.scale.set(0.96, 1.07, 1.0);
  hairCrown.position.set(0, 0.175, -0.014);
  hairCrown.rotation.x = -0.34;
  hairCrown.castShadow = true;
  headPivot.add(hairCrown);

  // Back nape hair layer
  const hairBackNape = new THREE.Mesh(new THREE.SphereGeometry(0.106, 16, 12), hairMat);
  hairBackNape.scale.set(0.92, 1.05, 0.72);
  hairBackNape.position.set(0, 0.145, -0.048);
  hairBackNape.castShadow = true;
  headPivot.add(hairBackNape);

  // Softly parted swept front waves (left & right arched hair curtains framing forehead)
  for (const side of [-1, 1]) {
    const sweepGeo = createHairLockGeometry(0.042, 0.034, 0.014, 0.155, -0.025);
    const sweep = new THREE.Mesh(sweepGeo, hairMat);
    sweep.position.set(side * 0.018, 0.278, 0.064);
    sweep.rotation.z = side * 0.52;
    sweep.rotation.x = -0.36;
    sweep.rotation.y = side * 0.35;
    sweep.castShadow = true;
    headPivot.add(sweep);
  }

  // Face-Framing Side Locks (Spring Physics Enabled)
  const sideLockGeo = createHairLockGeometry(0.024, 0.02, 0.008, 0.21, 0.014);
  const leftSideLockPivot = new THREE.Group();
  leftSideLockPivot.position.set(-0.088, 0.215, 0.046);
  headPivot.add(leftSideLockPivot);
  const leftSideLock = new THREE.Mesh(sideLockGeo, hairMat);
  leftSideLock.rotation.z = -0.14;
  leftSideLock.castShadow = true;
  leftSideLockPivot.add(leftSideLock);

  const rightSideLockPivot = new THREE.Group();
  rightSideLockPivot.position.set(0.088, 0.215, 0.046);
  headPivot.add(rightSideLockPivot);
  const rightSideLock = new THREE.Mesh(sideLockGeo, hairMat);
  rightSideLock.rotation.z = 0.14;
  rightSideLock.castShadow = true;
  rightSideLockPivot.add(rightSideLock);

  // High Ponytail Crown Tie + Emerald Silk Ribbon + 3-Segment Articulated Ponytail
  const hairTie = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.011, 10, 16), ribbonMat);
  hairTie.position.set(0, 0.205, -0.112);
  hairTie.rotation.x = 0.42;
  headPivot.add(hairTie);

  const ribbonTailGeo = new THREE.PlaneGeometry(0.024, 0.13, 2, 3);
  ribbonTailGeo.translate(0, -0.065, 0);
  const ribbonL = new THREE.Mesh(ribbonTailGeo, ribbonMat);
  ribbonL.position.set(-0.014, 0.198, -0.118);
  ribbonL.rotation.set(0.28, 0, -0.24);
  headPivot.add(ribbonL);
  const ribbonR = new THREE.Mesh(ribbonTailGeo, ribbonMat);
  ribbonR.position.set(0.014, 0.198, -0.118);
  ribbonR.rotation.set(0.28, 0, 0.24);
  headPivot.add(ribbonR);

  const ponyPivot0 = new THREE.Group();
  ponyPivot0.position.set(0, 0.205, -0.116);
  headPivot.add(ponyPivot0);
  const ponySeg0 = new THREE.Mesh(createHairLockGeometry(0.044, 0.056, 0.044, 0.16, -0.028), hairMat);
  ponySeg0.rotation.x = 0.26;
  ponySeg0.castShadow = true;
  ponyPivot0.add(ponySeg0);

  const ponyPivot1 = new THREE.Group();
  ponyPivot1.position.set(0, -0.15, -0.01);
  ponySeg0.add(ponyPivot1);
  const ponySeg1 = new THREE.Mesh(createHairLockGeometry(0.043, 0.039, 0.028, 0.17, 0.018), hairMat);
  ponySeg1.castShadow = true;
  ponyPivot1.add(ponySeg1);

  const ponyPivot2 = new THREE.Group();
  ponyPivot2.position.set(0, -0.16, 0.005);
  ponySeg1.add(ponyPivot2);
  const ponySeg2 = new THREE.Mesh(createHairLockGeometry(0.027, 0.018, 0.005, 0.16, -0.014), hairMat);
  ponySeg2.castShadow = true;
  ponyPivot2.add(ponySeg2);

  // Subtle Soft Face & Rim Light (illuminates eyes, SSS skin, hair sheen & scarf even in shade)
  const faceFillLight = new THREE.PointLight(0xffe6d2, 0.55, 2.4, 1.6);
  faceFillLight.position.set(0.18, 0.26, 0.62);
  headPivot.add(faceFillLight);

  // --- Slender Articulated Feminine Arms, Rolled Cuffs, Fingerless Gloves ---
  const buildArm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.192, 0.415, 0);
    torso.add(shoulder);

    const shoulderCap = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), tunicMat);
    shoulderCap.scale.set(0.95, 1.0, 0.9);
    shoulder.add(shoulderCap);

    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.255, 12), tunicMat);
    upperArm.position.y = -0.12;
    upperArm.castShadow = true;
    shoulder.add(upperArm);

    const elbow = new THREE.Group();
    elbow.position.y = -0.245;
    shoulder.add(elbow);

    const cuffRoll = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.009, 8, 14), tunicMat);
    cuffRoll.rotation.x = Math.PI * 0.5;
    cuffRoll.position.y = -0.015;
    elbow.add(cuffRoll);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.027, 0.23, 12), skinMat);
    forearm.position.y = -0.115;
    forearm.castShadow = true;
    elbow.add(forearm);

    const bracer = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.029, 0.085, 12), leatherMat);
    bracer.position.y = -0.18;
    elbow.add(bracer);

    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.062, 0.062), leatherMat);
    glove.position.y = -0.245;
    elbow.add(glove);

    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.032, 0.05), skinMat);
    fingers.position.set(0, -0.285, 0.005);
    elbow.add(fingers);

    return { shoulder, elbow };
  };

  const leftArm = buildArm(-1);
  const rightArm = buildArm(1);

  // Handheld Flashlight attached to Left Hand
  const flashlightMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.019, 0.15, 10), metalMat);
  flashlightMesh.rotation.x = Math.PI * 0.5;
  flashlightMesh.position.set(0, -0.26, 0.055);
  leftArm.elbow.add(flashlightMesh);

  // Elegant Survival Blade attached to Right Hand
  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0, -0.26, 0.04);
  rightArm.elbow.add(weaponPivot);

  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.017, 0.145, 10), leatherMat);
  hilt.rotation.x = Math.PI * 0.5;
  weaponPivot.add(hilt);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), brassMat);
  guard.position.set(0, 0, 0.074);
  weaponPivot.add(guard);

  const bladeMain = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.044, 0.44), metalMat);
  bladeMain.position.set(0, 0.008, 0.298);
  bladeMain.castShadow = true;
  weaponPivot.add(bladeMain);

  const bladeTip = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.12, 4), metalMat);
  bladeTip.rotation.x = Math.PI * 0.5;
  bladeTip.scale.set(0.32, 1, 1);
  bladeTip.position.set(0, 0.008, 0.575);
  bladeTip.castShadow = true;
  weaponPivot.add(bladeTip);

  const flashlight = new THREE.SpotLight(0xfff1d4, 0, 58, Math.PI / 5.5, 0.55, 1.35);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(512, 512);
  flashlight.shadow.camera.near = 0.3;
  flashlight.shadow.camera.far = 55;
  flashlight.shadow.bias = -0.0005;
  scene.add(flashlight);
  scene.add(flashlight.target);

  const coneGeo = new THREE.ConeGeometry(2.6, 12, 16, 1, true);
  coneGeo.translate(0, -6, 0);
  coneGeo.rotateX(-Math.PI * 0.5);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xffe8c2,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const flashlightCone = new THREE.Mesh(coneGeo, coneMat);
  scene.add(flashlightCone);

  // --- Sculpted Feminine Legs & Tall Laced Explorer Boots ---
  const thighProfile = [
    new THREE.Vector2(0.0, -0.42),
    new THREE.Vector2(0.052, -0.42),
    new THREE.Vector2(0.063, -0.25),
    new THREE.Vector2(0.075, -0.06),
    new THREE.Vector2(0.073, 0.0),
    new THREE.Vector2(0.0, 0.0),
  ];
  const thighGeo = new THREE.LatheGeometry(thighProfile, 14);
  thighGeo.computeTangents();

  const buildLeg = (side: number) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.092, -0.04, 0);
    pelvis.add(hip);

    const thigh = new THREE.Mesh(thighGeo, pantsMat);
    thigh.castShadow = true;
    hip.add(thigh);

    const thighStrap = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.064, 0.036, 12), leatherMat);
    thighStrap.position.y = -0.2;
    hip.add(thighStrap);

    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);

    const kneeGuard = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), leatherMat);
    kneeGuard.scale.set(0.95, 1.05, 0.65);
    kneeGuard.position.set(0, 0.0, 0.028);
    knee.add(kneeGuard);

    const shinUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.048, 0.14, 12), pantsMat);
    shinUpper.position.y = -0.065;
    shinUpper.castShadow = true;
    knee.add(shinUpper);

    // Tall Sculpted Laced Explorer Boot Shaft + Cuff + Foot + Lug Heel
    const bootShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.042, 0.27, 12), bootMat);
    bootShaft.position.y = -0.255;
    bootShaft.castShadow = true;
    knee.add(bootShaft);

    const bootTopCuff = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.011, 8, 14), leatherMat);
    bootTopCuff.rotation.x = Math.PI * 0.5;
    bootTopCuff.position.y = -0.125;
    knee.add(bootTopCuff);

    const bootFoot = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.088, 0.205), bootMat);
    bootFoot.position.set(0, -0.425, 0.036);
    bootFoot.castShadow = true;
    knee.add(bootFoot);

    const bootSole = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.03, 0.215), soleMat);
    bootSole.position.set(0, -0.478, 0.036);
    knee.add(bootSole);

    return { hip, knee };
  };

  const leftLeg = buildLeg(-1);
  const rightLeg = buildLeg(1);

  // Grounded Contact Shadow Disc
  const contactShadowGeo = new THREE.PlaneGeometry(1.1, 1.1);
  contactShadowGeo.rotateX(-Math.PI * 0.5);
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: textures.softGlowMap,
    color: 0x05070a,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
  contactShadow.position.y = 0.03;
  group.add(contactShadow);

  // Arcane Guard Ward Ring
  const guardWardGeo = new THREE.RingGeometry(0.66, 0.86, 32);
  guardWardGeo.rotateX(-Math.PI * 0.5);
  const guardWardMat = new THREE.MeshBasicMaterial({
    color: 0x6ce5ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const guardWard = new THREE.Mesh(guardWardGeo, guardWardMat);
  guardWard.position.y = 1.08;
  guardWard.visible = false;
  group.add(guardWard);

  scene.add(group);

  // --- Footprint Decal InstancedMesh Pool ---
  const fpGeo = new THREE.PlaneGeometry(0.17, 0.31);
  fpGeo.rotateX(-Math.PI * 0.5);
  const fpMat = new THREE.MeshStandardMaterial({
    map: textures.footprintMap,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    roughness: 0.95,
  });
  const footprintsMesh = new THREE.InstancedMesh(fpGeo, fpMat, MAX_FOOTPRINTS);
  footprintsMesh.frustumCulled = false;
  scene.add(footprintsMesh);

  const fpRecords: FootprintRecord[] = Array.from({ length: MAX_FOOTPRINTS }, () => ({
    active: false,
    x: 0,
    y: -999,
    z: 0,
    yaw: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    age: 0,
    maxAge: 28,
    side: 1,
  }));
  let fpCursor = 0;

  // --- Water Surface Ripple Rings & Splash Droplets Pool ---
  const MAX_RIPPLES = 18;
  const rippleGeo = new THREE.RingGeometry(0.32, 0.44, 24);
  rippleGeo.rotateX(-Math.PI * 0.5);
  const ripples: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; active: boolean; age: number; maxAge: number; maxScale: number }[] = [];
  for (let i = 0; i < MAX_RIPPLES; i++) {
    const rMat = new THREE.MeshBasicMaterial({
      color: 0xdff4ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const rMesh = new THREE.Mesh(rippleGeo, rMat);
    rMesh.visible = false;
    rMesh.renderOrder = 3;
    scene.add(rMesh);
    ripples.push({ mesh: rMesh, mat: rMat, active: false, age: 0, maxAge: 1.4, maxScale: 3.2 });
  }
  let rippleCursor = 0;

  const MAX_SPLASH = 64;
  const splashPos = new Float32Array(MAX_SPLASH * 3);
  const splashVel = new Float32Array(MAX_SPLASH * 3);
  const splashAge = new Float32Array(MAX_SPLASH);
  const splashMaxAge = new Float32Array(MAX_SPLASH);
  const splashActive = new Uint8Array(MAX_SPLASH);
  for (let i = 0; i < MAX_SPLASH; i++) splashPos[i * 3 + 1] = -999;
  const splashGeo = new THREE.BufferGeometry();
  splashGeo.setAttribute('position', new THREE.BufferAttribute(splashPos, 3));
  const splashMat = new THREE.PointsMaterial({
    map: textures.softGlowMap,
    color: 0xe6f7ff,
    size: 0.28,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const splashPoints = new THREE.Points(splashGeo, splashMat);
  splashPoints.frustumCulled = false;
  splashPoints.renderOrder = 4;
  scene.add(splashPoints);
  let splashCursor = 0;

  const spawnWaterWake = (x: number, z: number, maxScale: number, droplets: number) => {
    const r = ripples[rippleCursor];
    rippleCursor = (rippleCursor + 1) % MAX_RIPPLES;
    r.active = true;
    r.age = 0;
    r.maxAge = 1.2 + Math.random() * 0.45;
    r.maxScale = maxScale;
    r.mesh.position.set(x, WATER_LEVEL + 0.04, z);
    r.mesh.scale.setScalar(0.45);
    r.mat.opacity = 0.65;
    r.mesh.visible = true;

    for (let i = 0; i < droplets; i++) {
      const idx = splashCursor;
      splashCursor = (splashCursor + 1) % MAX_SPLASH;
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.8 + Math.random() * 2.3;
      splashActive[idx] = 1;
      splashAge[idx] = 0;
      splashMaxAge[idx] = 0.35 + Math.random() * 0.3;
      splashPos[idx * 3] = x + (Math.random() - 0.5) * 0.55;
      splashPos[idx * 3 + 1] = WATER_LEVEL + 0.08;
      splashPos[idx * 3 + 2] = z + (Math.random() - 0.5) * 0.55;
      splashVel[idx * 3] = Math.cos(ang) * spd;
      splashVel[idx * 3 + 1] = 1.8 + Math.random() * 2.4;
      splashVel[idx * 3 + 2] = Math.sin(ang) * spd;
    }
  };

  const state: CharacterState = {
    position: new THREE.Vector3(-16, groundHeightAt(-16, 76), 76),
    velocity: new THREE.Vector3(),
    yaw: 0.2,
    pitch: -0.08,
    isGrounded: true,
    isCrouching: false,
    isSprinting: false,
    isWading: false,
    isSwimming: false,
    waterDepth: 0,
    moveSpeed: 0,
    walkPhase: 0,
    swimPhase: 0,
    landSquash: 0,
    flashlightOn: false,
    lastStepSign: 1,
    attackCombo: 0,
    attackTimer: 0,
    attackDuration: 0.34,
    isHeavyAttack: false,
    comboWindowTimer: 0,
    dodgeTimer: 0,
    dodgeDirX: 0,
    dodgeDirZ: -1,
    isGuarding: false,
  };
  group.position.copy(state.position);

  // Pre-allocated Scratch Math & Secondary Physics State (Zero GC in update)
  const _fpDummy = new THREE.Object3D();
  const _upVec = new THREE.Vector3(0, 1, 0);
  const _normVec = new THREE.Vector3();
  const _alignQuat = new THREE.Quaternion();
  const _yawQuat = new THREE.Quaternion();
  const _flashPos = new THREE.Vector3();
  const _flashDir = new THREE.Vector3();

  // Hair & Cloth Spring Chains
  const ponySpr0 = createSpringNode(0.26, 0);
  const ponySpr1 = createSpringNode(0.08, 0);
  const ponySpr2 = createSpringNode(0.05, 0);
  const leftLockSpr = createSpringNode(0.04, 0);
  const rightLockSpr = createSpringNode(0.04, 0);
  const ribbonSpr = createSpringNode(0.28, 0);

  const scarfSpr0 = createSpringNode(0.22, 0);
  const scarfSpr1 = createSpringNode(0.14, 0);
  const scarfSpr2 = createSpringNode(0.1, 0);

  const coatBackSpr0 = createSpringNode(0.14, 0);
  const coatBackSpr1 = createSpringNode(0.08, 0);
  const coatLeftSpr0 = createSpringNode(0.1, 0);
  const coatLeftSpr1 = createSpringNode(0.05, 0);
  const coatRightSpr0 = createSpringNode(0.1, 0);
  const coatRightSpr1 = createSpringNode(0.05, 0);

  let prevFacingYaw = group.rotation.y;
  let blinkCooldown = 2.8;
  let blinkElapsed = -1;
  let eyeSquintSmooth = 0;
  let browMoodSmooth = 0;
  let smileSmooth = 0.25;

  const spawnFootprint = (side: number) => {
    if (state.isSwimming) return;
    const { dist } = waterDistanceInfo(state.position.x, state.position.z);
    if (state.isWading) {
      const offsetX = Math.cos(state.yaw) * side * 0.12;
      const offsetZ = -Math.sin(state.yaw) * side * 0.12;
      spawnWaterWake(state.position.x + offsetX, state.position.z + offsetZ, 1.8, 5);
      return;
    }
    if (dist < -0.15) return;

    const offsetX = Math.cos(state.yaw) * side * 0.12;
    const offsetZ = -Math.sin(state.yaw) * side * 0.12;
    const fx = state.position.x + offsetX;
    const fz = state.position.z + offsetZ;
    const fy = groundHeightAt(fx, fz);
    const n = groundNormalAt(fx, fz);

    const rec = fpRecords[fpCursor];
    rec.active = true;
    rec.x = fx;
    rec.y = fy + 0.025;
    rec.z = fz;
    rec.yaw = state.yaw;
    rec.nx = n.nx;
    rec.ny = n.ny;
    rec.nz = n.nz;
    rec.age = 0;
    rec.maxAge = 26;
    rec.side = side;
    fpCursor = (fpCursor + 1) % MAX_FOOTPRINTS;
  };

  const setPosition = (x: number, z: number, yaw: number) => {
    const y = groundHeightAt(x, z);
    state.position.set(x, y, z);
    state.velocity.set(0, 0, 0);
    state.yaw = yaw;
    state.isGrounded = true;
    state.isSwimming = false;
    state.isWading = false;
    group.position.copy(state.position);
  };

  const triggerAttack = (heavy: boolean): { comboStep: number; isHeavy: boolean } | null => {
    if (state.isSwimming) return null;
    if (state.dodgeTimer > 0.08) return null;
    if (state.attackTimer > 0.1) return null;

    state.isGuarding = false;
    state.isHeavyAttack = heavy;
    if (heavy) {
      state.attackCombo = 3;
      state.attackDuration = 0.46;
      state.attackTimer = state.attackDuration;
      state.comboWindowTimer = 0;
    } else {
      state.attackCombo = state.comboWindowTimer > 0 ? (state.attackCombo % 3) + 1 : 1;
      state.attackDuration = 0.31;
      state.attackTimer = state.attackDuration;
      state.comboWindowTimer = 0.65;
    }

    const fx = -Math.sin(state.yaw);
    const fz = -Math.cos(state.yaw);
    group.rotation.y = state.yaw + Math.PI;
    const lunge = heavy ? 5.6 : 3.2;
    state.velocity.x += fx * lunge;
    state.velocity.z += fz * lunge;

    return { comboStep: state.attackCombo, isHeavy: heavy };
  };

  const triggerDodge = (inputForward: number, inputRight: number): boolean => {
    if (state.dodgeTimer > 0.05) return false;
    state.attackTimer = 0;
    state.isGuarding = false;
    state.dodgeTimer = 0.32;

    const sinY = Math.sin(state.yaw);
    const cosY = Math.cos(state.yaw);
    let dx = -sinY * inputForward + cosY * inputRight;
    let dz = -cosY * inputForward - sinY * inputRight;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) {
      dx = -sinY;
      dz = -cosY;
    } else {
      dx /= len;
      dz /= len;
    }
    state.dodgeDirX = dx;
    state.dodgeDirZ = dz;
    state.velocity.x = dx * 14.5;
    state.velocity.z = dz * 14.5;
    group.rotation.y = Math.atan2(dx, dz);
    return true;
  };

  const setGuarding = (guarding: boolean) => {
    state.isGuarding = guarding && state.attackTimer <= 0 && state.dodgeTimer <= 0;
  };

  const update = (
    dt: number,
    elapsed: number,
    inputForward: number,
    inputRight: number,
    wantJump: boolean,
    wantSprint: boolean,
    wantCrouch: boolean,
    windDir: THREE.Vector2,
    windStrength: number,
    rainIntensity: number,
    snowIntensity: number,
    isFirstPerson: boolean,
    groundHeightQuery: (x: number, z: number) => number,
    resolveCollisions: (x: number, z: number, r: number) => { x: number; z: number }
  ) => {
    if (state.attackTimer > 0) state.attackTimer = Math.max(0, state.attackTimer - dt);
    if (state.comboWindowTimer > 0) state.comboWindowTimer = Math.max(0, state.comboWindowTimer - dt);
    if (state.dodgeTimer > 0) state.dodgeTimer = Math.max(0, state.dodgeTimer - dt);

    const prevSwimming = state.isSwimming;
    const curFloorY = groundHeightQuery(state.position.x, state.position.z);
    const curWaterDepth = Math.max(0, WATER_LEVEL - curFloorY);
    state.waterDepth = curWaterDepth;

    const deepEnoughNow = curWaterDepth > 1.05 && state.position.y <= WATER_LEVEL - 0.65;
    state.isSwimming = deepEnoughNow;
    state.isWading = !deepEnoughNow && curWaterDepth > 0.14 && state.position.y <= WATER_LEVEL + 0.15;

    if (state.isSwimming) {
      state.attackTimer = 0;
      state.isGuarding = false;
    }

    state.isCrouching = !state.isSwimming && (wantCrouch || state.dodgeTimer > 0);
    state.isSprinting =
      wantSprint && !state.isCrouching && !state.isGuarding && state.attackTimer <= 0 && (state.isSwimming ? Math.hypot(inputForward, inputRight) > 0.1 : inputForward > 0.1);

    const sinY = Math.sin(state.yaw);
    const cosY = Math.cos(state.yaw);
    let wishX = -sinY * inputForward + cosY * inputRight;
    let wishZ = -cosY * inputForward - sinY * inputRight;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    if (state.dodgeTimer > 0) {
      const dashBase = state.isSwimming ? 7.8 : 12.5;
      const dashSpeed = dashBase * (state.dodgeTimer / 0.32) + 2.0;
      state.velocity.x = state.dodgeDirX * dashSpeed;
      state.velocity.z = state.dodgeDirZ * dashSpeed;
    } else if (state.isSwimming) {
      const swimMaxSpeed = state.isSprinting ? 5.3 : 3.35;
      const targetVx = wishX * swimMaxSpeed;
      const targetVz = wishZ * swimMaxSpeed;
      state.velocity.x = THREE.MathUtils.damp(state.velocity.x, targetVx, 4.6, dt);
      state.velocity.z = THREE.MathUtils.damp(state.velocity.z, targetVz, 4.6, dt);
    } else {
      const speedMod = state.attackTimer > 0 ? 0.35 : state.isGuarding ? 0.55 : state.isWading ? 0.76 : 1.0;
      const targetMaxSpeed = (state.isCrouching ? 2.6 : state.isSprinting ? 8.6 : 4.9) * speedMod;
      const targetVx = wishX * targetMaxSpeed;
      const targetVz = wishZ * targetMaxSpeed;

      const accel = state.isGrounded ? 10.5 : 3.5;
      state.velocity.x = THREE.MathUtils.damp(state.velocity.x, targetVx, accel, dt);
      state.velocity.z = THREE.MathUtils.damp(state.velocity.z, targetVz, accel, dt);
    }

    let nextX = state.position.x + state.velocity.x * dt;
    let nextZ = state.position.z + state.velocity.z * dt;

    nextX = THREE.MathUtils.clamp(nextX, -420, 420);
    nextZ = THREE.MathUtils.clamp(nextZ, -420, 420);

    const resolved = resolveCollisions(nextX, nextZ, 0.45);
    nextX = resolved.x;
    nextZ = resolved.z;

    const floorY = groundHeightQuery(nextX, nextZ);
    const nextWaterDepth = Math.max(0, WATER_LEVEL - floorY);
    state.waterDepth = nextWaterDepth;

    const horizPreview = Math.hypot(state.velocity.x, state.velocity.z);
    const swimNormPreview = Math.min(1, horizPreview / 4.8);

    const swimDepthThreshold = prevSwimming ? 0.82 : 1.04;
    if (nextWaterDepth > swimDepthThreshold && state.position.y <= WATER_LEVEL - 0.5) {
      state.isSwimming = true;
      state.isWading = false;
      state.isGrounded = false;

      if (!prevSwimming) {
        spawnWaterWake(nextX, nextZ, 3.6, 18);
      }

      const bob = Math.sin(elapsed * 2.4) * 0.045;
      const swimSurfaceY = WATER_LEVEL - 1.04 + swimNormPreview * 0.16 + bob;
      const springForce = (swimSurfaceY - state.position.y) * 16.0 - state.velocity.y * 5.2;
      state.velocity.y += springForce * dt;

      if (wantJump) {
        if (nextWaterDepth < 1.55) {
          state.velocity.y = 6.2;
          state.isSwimming = false;
          spawnWaterWake(nextX, nextZ, 2.8, 12);
        } else {
          state.velocity.y = Math.max(state.velocity.y, 2.2);
          spawnWaterWake(nextX, nextZ, 2.2, 8);
        }
      }

      let nextY = state.position.y + state.velocity.y * dt;
      if (nextY < floorY + 0.05) {
        nextY = floorY + 0.05;
        state.velocity.y = Math.max(0, state.velocity.y);
      }
      state.position.set(nextX, nextY, nextZ);
    } else {
      state.isSwimming = false;
      state.isWading = nextWaterDepth > 0.14 && state.position.y <= WATER_LEVEL + 0.2;

      if (wantJump && state.isGrounded && !state.isCrouching) {
        state.velocity.y = 6.9;
        state.isGrounded = false;
      }
      state.velocity.y -= 18.5 * dt;

      const nextY = state.position.y + state.velocity.y * dt;
      if (nextY <= floorY) {
        if (!state.isGrounded && state.velocity.y < -4.5) {
          state.landSquash = Math.min(0.24, Math.abs(state.velocity.y) * 0.022);
          if (nextWaterDepth > 0.1) {
            spawnWaterWake(nextX, nextZ, 2.9, 14);
          }
        }
        state.position.set(nextX, floorY, nextZ);
        state.velocity.y = 0;
        state.isGrounded = true;
      } else {
        state.position.set(nextX, nextY, nextZ);
        state.isGrounded = false;
      }
    }

    const horizSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    state.moveSpeed = horizSpeed;

    group.position.copy(state.position);
    if (isFirstPerson) {
      group.rotation.y = state.yaw + Math.PI;
    } else if (horizSpeed > 0.28) {
      const targetFacing = Math.atan2(state.velocity.x, state.velocity.z);
      let diff = targetFacing - group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      group.rotation.y += diff * Math.min(1, dt * (state.isSwimming ? 7.5 : 11));
    }

    // Angular yaw rate for centrifugal hair & cloth sway
    let yawDelta = group.rotation.y - prevFacingYaw;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    const angularTurnVel = THREE.MathUtils.clamp(yawDelta / Math.max(dt, 0.004), -12, 12);
    prevFacingYaw = group.rotation.y;

    // --- Procedural Limb & Body Animation ---
    state.landSquash = THREE.MathUtils.damp(state.landSquash, 0, 12, dt);

    if (state.isSwimming) {
      const swimNorm = Math.min(1, horizSpeed / 4.8);
      const strokeFreq = state.isSprinting ? 7.6 : 4.2 + swimNorm * 2.2;
      const prevStroke = Math.sin(state.swimPhase);
      state.swimPhase += dt * strokeFreq;
      const curStroke = Math.sin(state.swimPhase);

      if (prevStroke < 0 && curStroke >= 0) {
        spawnWaterWake(state.position.x, state.position.z, 2.2 + swimNorm * 1.4, swimNorm > 0.2 ? 9 : 3);
      }

      const swS = Math.sin(state.swimPhase);
      const swC = Math.cos(state.swimPhase);
      const kickS = Math.sin(state.swimPhase * 2.0);

      const targetBodyPitch = THREE.MathUtils.lerp(0.18, 1.12, swimNorm);
      pelvis.rotation.x = THREE.MathUtils.damp(pelvis.rotation.x, targetBodyPitch, 7, dt);
      pelvis.position.y = THREE.MathUtils.damp(pelvis.position.y, 0.92 + swimNorm * 0.2 + swC * 0.025, 8, dt);
      pelvis.rotation.z = THREE.MathUtils.damp(
        pelvis.rotation.z,
        state.isSprinting ? swC * 0.26 : swC * 0.08 * swimNorm,
        8,
        dt
      );

      torso.rotation.x = THREE.MathUtils.damp(torso.rotation.x, 0.08 * swimNorm, 8, dt);
      torso.rotation.y = THREE.MathUtils.damp(torso.rotation.y, state.isSprinting ? swS * 0.24 : 0, 10, dt);
      chestMesh.scale.y = 1 + Math.sin(elapsed * 2.5) * 0.015;

      headPivot.rotation.x = THREE.MathUtils.damp(headPivot.rotation.x, -pelvis.rotation.x * 0.72 + Math.sin(elapsed * 2.0) * 0.04, 8, dt);
      headPivot.rotation.y = THREE.MathUtils.damp(headPivot.rotation.y, -torso.rotation.y * 0.45, 8, dt);

      backpack.position.y = 0.21;
      backpack.rotation.x = -0.05;

      const kickAmp = THREE.MathUtils.lerp(0.28, 0.52, swimNorm);
      leftLeg.hip.rotation.x = 0.18 + kickS * kickAmp;
      rightLeg.hip.rotation.x = 0.18 - kickS * kickAmp;
      leftLeg.knee.rotation.x = 0.28 + Math.max(0, -kickS) * 0.42;
      rightLeg.knee.rotation.x = 0.28 + Math.max(0, kickS) * 0.42;

      if (state.isSprinting && swimNorm > 0.35) {
        leftArm.shoulder.rotation.x = -1.55 + swS * 1.15;
        leftArm.shoulder.rotation.z = -0.25 - Math.max(0, swC) * 0.35;
        leftArm.elbow.rotation.x = -0.35 - Math.max(0, -swC) * 0.65;

        rightArm.shoulder.rotation.x = -1.55 - swS * 1.15;
        rightArm.shoulder.rotation.y = 0;
        rightArm.shoulder.rotation.z = 0.25 + Math.max(0, -swC) * 0.35;
        rightArm.elbow.rotation.x = -0.35 - Math.max(0, swC) * 0.65;
      } else if (swimNorm > 0.12) {
        const reach = -1.65 + swS * 0.55;
        const spread = 0.42 + Math.max(0, swC) * 0.72;
        leftArm.shoulder.rotation.x = reach;
        leftArm.shoulder.rotation.z = -spread;
        leftArm.elbow.rotation.x = -0.45 - Math.max(0, -swS) * 0.45;

        rightArm.shoulder.rotation.x = reach;
        rightArm.shoulder.rotation.y = 0;
        rightArm.shoulder.rotation.z = spread;
        rightArm.elbow.rotation.x = -0.45 - Math.max(0, -swS) * 0.45;
      } else {
        leftArm.shoulder.rotation.x = -0.45 + swS * 0.22;
        leftArm.shoulder.rotation.z = -0.48 - swC * 0.26;
        leftArm.elbow.rotation.x = -0.75;

        rightArm.shoulder.rotation.x = -0.45 - swS * 0.22;
        rightArm.shoulder.rotation.y = 0;
        rightArm.shoulder.rotation.z = 0.48 + swC * 0.26;
        rightArm.elbow.rotation.x = -0.75;
      }
      weaponPivot.rotation.x = THREE.MathUtils.damp(weaponPivot.rotation.x, 0.2, 10, dt);
    } else {
      pelvis.rotation.x = THREE.MathUtils.damp(pelvis.rotation.x, 0, 12, dt);

      const normMove = Math.min(1, horizSpeed / 7.5);
      const freq = state.isSprinting ? 11.2 : state.isCrouching ? 6.2 : 8.2;
      if (state.isGrounded && horizSpeed > 0.25) {
        state.walkPhase += dt * freq * (0.45 + 0.55 * normMove);
        const stepSign = Math.sin(state.walkPhase) >= 0 ? 1 : -1;
        if (stepSign !== state.lastStepSign) {
          state.lastStepSign = stepSign;
          spawnFootprint(stepSign);
        }
      }

      const s = Math.sin(state.walkPhase);
      const c = Math.cos(state.walkPhase);
      const stride = state.isGrounded ? normMove : 0.15;

      const breath = Math.sin(elapsed * 2.1) * 0.012;
      const gaitBob = Math.abs(s) * 0.052 * stride;
      const crouchOffset = state.isCrouching ? -0.28 : 0;
      pelvis.position.y = 0.92 + gaitBob + crouchOffset - state.landSquash + breath * 0.4;
      // Graceful feminine hip sway during stride
      pelvis.rotation.z = c * 0.058 * stride;

      let combatTwistY = 0;
      let combatPitchX = 0;
      if (state.attackTimer > 0) {
        const p = 1 - state.attackTimer / state.attackDuration;
        const swing = Math.sin(p * Math.PI);
        if (state.isHeavyAttack) {
          combatPitchX = p < 0.35 ? -0.35 * (p / 0.35) : 0.48 * Math.sin(((p - 0.35) / 0.65) * Math.PI);
          combatTwistY = p < 0.35 ? -0.45 : THREE.MathUtils.lerp(-0.45, 0.85, (p - 0.35) / 0.65);
        } else if (state.attackCombo === 1) {
          combatTwistY = THREE.MathUtils.lerp(-0.65, 0.72, p);
          combatPitchX = 0.22 * swing;
        } else if (state.attackCombo === 2) {
          combatTwistY = THREE.MathUtils.lerp(0.72, -0.65, p);
          combatPitchX = 0.2 * swing;
        } else {
          combatTwistY = THREE.MathUtils.lerp(-0.55, 0.85, p);
          combatPitchX = -0.18 * swing;
        }
      } else if (state.dodgeTimer > 0) {
        combatPitchX = 0.42;
        pelvis.rotation.z = 0.24 * Math.sin((state.dodgeTimer / 0.32) * Math.PI);
      }

      const forwardLean = (state.isCrouching ? 0.24 : stride * (state.isSprinting ? 0.22 : 0.09)) + combatPitchX;
      torso.rotation.x = THREE.MathUtils.damp(torso.rotation.x, forwardLean, 14, dt);
      torso.rotation.y = THREE.MathUtils.damp(torso.rotation.y, -s * 0.12 * stride + combatTwistY, 18, dt);
      chestMesh.scale.y = 1 + breath * 1.3;

      headPivot.rotation.x = THREE.MathUtils.damp(headPivot.rotation.x, -forwardLean * 0.45 + Math.sin(elapsed * 0.9) * 0.025, 14, dt);
      headPivot.rotation.y = THREE.MathUtils.damp(headPivot.rotation.y, -combatTwistY * 0.55 + Math.sin(elapsed * 0.55) * 0.06 * (1 - stride), 14, dt);

      backpack.position.y = 0.21 + Math.sin(state.walkPhase * 2) * 0.014 * stride;
      backpack.rotation.x = -stride * 0.05;

      const legAmp = state.isSprinting ? 0.78 : state.isCrouching ? 0.42 : 0.56;
      const crouchKnee = state.isCrouching ? 0.52 : 0;
      const airTuck = state.isGrounded ? 0 : 0.35;

      leftLeg.hip.rotation.x = s * legAmp * stride - crouchKnee * 0.5 - airTuck * 0.4;
      rightLeg.hip.rotation.x = -s * legAmp * stride - crouchKnee * 0.5 + airTuck * 0.2;

      leftLeg.knee.rotation.x = Math.max(0, -c * 0.65 * stride) + crouchKnee + airTuck * 0.7;
      rightLeg.knee.rotation.x = Math.max(0, c * 0.65 * stride) + crouchKnee + airTuck * 0.4;

      const armAmp = legAmp * 0.76;
      const leftTargetX = state.flashlightOn
        ? -1.05 + Math.sin(state.walkPhase) * 0.06 * stride
        : state.isGuarding
        ? -0.95
        : state.attackTimer > 0
        ? 0.45
        : -s * armAmp * stride + Math.sin(elapsed * 1.5) * 0.02;
      leftArm.shoulder.rotation.x = THREE.MathUtils.damp(leftArm.shoulder.rotation.x, leftTargetX, 14, dt);
      leftArm.shoulder.rotation.z = THREE.MathUtils.damp(leftArm.shoulder.rotation.z, -0.04, 14, dt);
      leftArm.elbow.rotation.x = state.flashlightOn ? -0.32 : state.isGuarding ? -1.15 : -0.22 - Math.max(0, s) * 0.32 * stride;

      let rShX = s * armAmp * stride;
      let rShY = 0;
      let rShZ = 0.04;
      let rElbX = -0.22 - Math.max(0, -s) * 0.32 * stride;
      let wRotX = 0.22;

      if (state.attackTimer > 0) {
        const p = 1 - state.attackTimer / state.attackDuration;
        if (state.isHeavyAttack) {
          if (p < 0.34) {
            const u = p / 0.34;
            rShX = THREE.MathUtils.lerp(-0.4, -2.55, u);
            rShZ = -0.35 * u;
            rElbX = -0.55;
          } else {
            const u = (p - 0.34) / 0.66;
            rShX = THREE.MathUtils.lerp(-2.55, 0.65, Math.min(1, u * 1.45));
            rShY = THREE.MathUtils.lerp(-0.3, 0.75, u);
            rShZ = 0.25;
            rElbX = -0.15;
            wRotX = 0.55;
          }
        } else if (state.attackCombo === 1) {
          rShX = -1.15 + Math.sin(p * Math.PI) * 0.35;
          rShY = THREE.MathUtils.lerp(-1.15, 1.25, p);
          rShZ = -0.45;
          rElbX = -0.22;
          wRotX = 0.45;
        } else if (state.attackCombo === 2) {
          rShX = -1.05;
          rShY = THREE.MathUtils.lerp(1.25, -1.2, p);
          rShZ = 0.25;
          rElbX = -0.28;
          wRotX = 0.45;
        } else {
          rShX = THREE.MathUtils.lerp(0.45, -2.1, p);
          rShY = THREE.MathUtils.lerp(-0.55, 0.85, p);
          rShZ = -0.55;
          rElbX = -0.18;
          wRotX = 0.55;
        }
        rightArm.shoulder.rotation.x = rShX;
        rightArm.shoulder.rotation.y = rShY;
        rightArm.shoulder.rotation.z = rShZ;
        rightArm.elbow.rotation.x = rElbX;
        weaponPivot.rotation.x = wRotX;
      } else if (state.isGuarding) {
        rightArm.shoulder.rotation.x = THREE.MathUtils.damp(rightArm.shoulder.rotation.x, -1.15, 16, dt);
        rightArm.shoulder.rotation.y = THREE.MathUtils.damp(rightArm.shoulder.rotation.y, 0.65, 16, dt);
        rightArm.shoulder.rotation.z = THREE.MathUtils.damp(rightArm.shoulder.rotation.z, 0.35, 16, dt);
        rightArm.elbow.rotation.x = THREE.MathUtils.damp(rightArm.elbow.rotation.x, -0.92, 16, dt);
        weaponPivot.rotation.x = THREE.MathUtils.damp(weaponPivot.rotation.x, -0.55, 16, dt);
      } else {
        rightArm.shoulder.rotation.x = THREE.MathUtils.damp(rightArm.shoulder.rotation.x, rShX, 12, dt);
        rightArm.shoulder.rotation.y = THREE.MathUtils.damp(rightArm.shoulder.rotation.y, 0, 12, dt);
        rightArm.shoulder.rotation.z = THREE.MathUtils.damp(rightArm.shoulder.rotation.z, 0.04, 12, dt);
        rightArm.elbow.rotation.x = THREE.MathUtils.damp(rightArm.elbow.rotation.x, rElbX, 12, dt);
        weaponPivot.rotation.x = THREE.MathUtils.damp(weaponPivot.rotation.x, 0.16, 12, dt);
      }
    }

    // --- Real-Time Hair Physics & Cloth Simulation (Spring-Damper Chains) ---
    const moveFactor = Math.min(1.25, horizSpeed / 6.5);
    const bodyFaceCos = Math.cos(group.rotation.y);
    const bodyFaceSin = Math.sin(group.rotation.y);
    // Transform world wind into character-local lateral/back axes
    const localWindLat = windDir.x * bodyFaceCos - windDir.y * bodyFaceSin;
    const localWindFwd = windDir.x * bodyFaceSin + windDir.y * bodyFaceCos;
    const flutterA = Math.sin(elapsed * (3.6 + windStrength * 2.2 + moveFactor * 4.5));
    const flutterB = Math.cos(elapsed * (5.1 + windStrength * 1.9 + moveFactor * 5.2));
    const vertHairLift = state.isSwimming ? 0.45 : THREE.MathUtils.clamp(-state.velocity.y * 0.06, -0.18, 0.45);
    const dodgeFlare = state.dodgeTimer > 0 ? 0.55 : 0;

    // Ponytail 3-segment spring chain
    const ponyTargetX0 =
      0.26 +
      moveFactor * 0.52 +
      vertHairLift +
      dodgeFlare +
      Math.max(0, -localWindFwd) * 0.16 * windStrength +
      flutterA * (0.04 + 0.08 * moveFactor + 0.06 * windStrength);
    const ponyTargetZ0 =
      -angularTurnVel * 0.042 +
      localWindLat * 0.18 * windStrength +
      Math.sin(state.walkPhase) * 0.09 * moveFactor +
      flutterB * 0.04 * windStrength;
    stepSpring2D(ponySpr0, ponyTargetX0, ponyTargetZ0, 46, 7.2, dt, 0.08, 1.35, -0.58, 0.58);
    stepSpring2D(
      ponySpr1,
      (ponySpr0.ax - 0.26) * 0.55 + flutterB * (0.06 + 0.1 * moveFactor),
      ponySpr0.az * 0.65 - angularTurnVel * 0.025 + flutterA * 0.05,
      36,
      5.8,
      dt,
      -0.45,
      0.95,
      -0.62,
      0.62
    );
    stepSpring2D(
      ponySpr2,
      ponySpr1.ax * 0.65 - flutterA * (0.07 + 0.12 * moveFactor),
      ponySpr1.az * 0.72 + flutterB * 0.07,
      28,
      4.6,
      dt,
      -0.6,
      0.95,
      -0.7,
      0.7
    );

    ponySeg0.rotation.x = ponySpr0.ax;
    ponySeg0.rotation.z = ponySpr0.az;
    ponyPivot1.rotation.x = ponySpr1.ax;
    ponyPivot1.rotation.z = ponySpr1.az;
    ponyPivot2.rotation.x = ponySpr2.ax;
    ponyPivot2.rotation.z = ponySpr2.az;

    // Silk hair ribbon tails
    stepSpring2D(
      ribbonSpr,
      0.28 + moveFactor * 0.42 + vertHairLift * 0.6 + flutterB * 0.12,
      localWindLat * 0.16 * windStrength - angularTurnVel * 0.03,
      42,
      6.4,
      dt,
      0.08,
      1.25,
      -0.55,
      0.55
    );
    ribbonL.rotation.x = ribbonSpr.ax;
    ribbonL.rotation.z = -0.22 + ribbonSpr.az;
    ribbonR.rotation.x = ribbonSpr.ax * 0.94;
    ribbonR.rotation.z = 0.22 + ribbonSpr.az;

    // Face-framing front side locks
    const sideTargetX = moveFactor * 0.16 + vertHairLift * 0.35 + flutterA * 0.04;
    stepSpring2D(leftLockSpr, sideTargetX, -0.12 - angularTurnVel * 0.018 + localWindLat * 0.09 * windStrength, 52, 8.2, dt, -0.2, 0.55, -0.45, 0.2);
    stepSpring2D(rightLockSpr, sideTargetX, 0.12 - angularTurnVel * 0.018 + localWindLat * 0.09 * windStrength, 52, 8.2, dt, -0.2, 0.55, -0.2, 0.45);
    leftSideLock.rotation.x = leftLockSpr.ax;
    leftSideLock.rotation.z = leftLockSpr.az;
    rightSideLock.rotation.x = rightLockSpr.ax;
    rightSideLock.rotation.z = rightLockSpr.az;

    // Scarf 3-segment cloth simulation
    const scarfTargetX0 =
      0.22 +
      moveFactor * 0.54 +
      vertHairLift * 0.65 +
      dodgeFlare * 0.85 +
      flutterA * (0.06 + 0.09 * windStrength);
    const scarfTargetZ0 = -angularTurnVel * 0.036 + localWindLat * 0.22 * windStrength;
    stepSpring2D(scarfSpr0, scarfTargetX0, scarfTargetZ0, 38, 6.2, dt, 0.08, 1.35, -0.65, 0.65);
    stepSpring2D(
      scarfSpr1,
      (scarfSpr0.ax - 0.22) * 0.58 + flutterB * (0.09 + 0.12 * moveFactor),
      scarfSpr0.az * 0.6 + flutterA * 0.08,
      30,
      5.0,
      dt,
      -0.5,
      0.95,
      -0.7,
      0.7
    );
    stepSpring2D(
      scarfSpr2,
      scarfSpr1.ax * 0.72 - flutterA * (0.11 + 0.14 * moveFactor),
      scarfSpr1.az * 0.65 + flutterB * 0.1,
      24,
      4.2,
      dt,
      -0.65,
      1.05,
      -0.75,
      0.75
    );
    scarfSeg0.rotation.x = scarfSpr0.ax;
    scarfSeg0.rotation.z = scarfSpr0.az;
    scarfTailPivot1.rotation.x = scarfSpr1.ax;
    scarfTailPivot1.rotation.z = scarfSpr1.az;
    scarfTailPivot2.rotation.x = scarfSpr2.ax;
    scarfTailPivot2.rotation.z = scarfSpr2.az;

    // Split Coat-Tails Cloth Simulation (reacts directly to thigh motion, dodge, wind, and swim buoyancy)
    const backKickPush = Math.max(Math.max(0, leftLeg.hip.rotation.x), Math.max(0, rightLeg.hip.rotation.x)) * 0.72;
    const coatBackTarget0 =
      0.16 +
      moveFactor * 0.36 +
      backKickPush +
      dodgeFlare * 0.75 +
      (state.isSwimming ? 0.55 : 0) +
      flutterA * (0.05 + 0.07 * windStrength);
    stepSpring2D(coatBackSpr0, coatBackTarget0, -angularTurnVel * 0.025 + localWindLat * 0.14 * windStrength, 40, 6.6, dt, 0.06, 1.28, -0.45, 0.45);
    stepSpring2D(coatBackSpr1, (coatBackSpr0.ax - 0.16) * 0.52 + flutterB * 0.09, coatBackSpr0.az * 0.6 + flutterA * 0.06, 30, 5.2, dt, -0.4, 0.9, -0.5, 0.5);
    coatBackSeg1.rotation.x = coatBackSpr0.ax;
    coatBackSeg1.rotation.z = coatBackSpr0.az;
    coatBackLowerPivot.rotation.x = coatBackSpr1.ax;
    coatBackLowerPivot.rotation.z = coatBackSpr1.az;

    const leftLegFlare = Math.abs(leftLeg.hip.rotation.x) * 0.45 + (state.isSwimming ? 0.35 : 0.12) + moveFactor * 0.16;
    const rightLegFlare = Math.abs(rightLeg.hip.rotation.x) * 0.45 + (state.isSwimming ? 0.35 : 0.12) + moveFactor * 0.16;
    stepSpring2D(coatLeftSpr0, leftLegFlare + flutterA * 0.06, localWindFwd * 0.08 * windStrength, 42, 6.8, dt, 0.04, 1.05, -0.4, 0.4);
    stepSpring2D(coatLeftSpr1, coatLeftSpr0.ax * 0.42 + flutterB * 0.08, coatLeftSpr0.az * 0.5, 32, 5.4, dt, -0.35, 0.75, -0.4, 0.4);
    leftCoatCloth.p1.rotation.x = coatLeftSpr0.ax;
    leftCoatCloth.p1.rotation.z = coatLeftSpr0.az;
    leftCoatCloth.p2.rotation.x = coatLeftSpr1.ax;

    stepSpring2D(coatRightSpr0, rightLegFlare + flutterB * 0.06, -localWindFwd * 0.08 * windStrength, 42, 6.8, dt, 0.04, 1.05, -0.4, 0.4);
    stepSpring2D(coatRightSpr1, coatRightSpr0.ax * 0.42 + flutterA * 0.08, coatRightSpr0.az * 0.5, 32, 5.4, dt, -0.35, 0.75, -0.4, 0.4);
    rightCoatCloth.p1.rotation.x = coatRightSpr0.ax;
    rightCoatCloth.p1.rotation.z = coatRightSpr0.az;
    rightCoatCloth.p2.rotation.x = coatRightSpr1.ax;

    // --- Facial Animation (Natural Blinking, Micro-Gaze, Expressive Brows, Soft Smile / Exertion) ---
    blinkCooldown -= dt;
    if (blinkCooldown <= 0 && blinkElapsed < 0) {
      blinkElapsed = 0;
      blinkCooldown = Math.random() < 0.22 ? 0.26 : 2.6 + Math.random() * 2.8; // Occasional natural double-blink
    }
    let blinkAmount = 0;
    if (blinkElapsed >= 0) {
      blinkElapsed += dt;
      const blinkDur = 0.14;
      if (blinkElapsed >= blinkDur) {
        blinkElapsed = -1;
      } else {
        blinkAmount = Math.sin((blinkElapsed / blinkDur) * Math.PI);
      }
    }

    const combatFocus = state.attackTimer > 0 || state.isGuarding ? 1.0 : state.isSprinting ? 0.55 : 0.0;
    const airSurprise = !state.isGrounded && !state.isSwimming ? 1.0 : 0.0;
    eyeSquintSmooth = THREE.MathUtils.damp(eyeSquintSmooth, combatFocus * 0.22 - airSurprise * 0.14, 10, dt);
    browMoodSmooth = THREE.MathUtils.damp(browMoodSmooth, combatFocus * 0.18 - airSurprise * 0.12, 10, dt);
    smileSmooth = THREE.MathUtils.damp(smileSmooth, combatFocus > 0.3 ? -0.15 : 0.32, 6, dt);

    const upperLidAngle = THREE.MathUtils.lerp(-0.34 + eyeSquintSmooth, 0.32, blinkAmount);
    const lowerLidAngle = THREE.MathUtils.lerp(0.08 - eyeSquintSmooth * 0.45, -0.1, blinkAmount);
    const gazeX = THREE.MathUtils.clamp(-angularTurnVel * 0.02 + Math.sin(elapsed * 0.7) * 0.045, -0.14, 0.14);
    const gazeY = THREE.MathUtils.clamp(state.pitch * 0.18 + Math.cos(elapsed * 0.45) * 0.025, -0.09, 0.09);

    for (const eye of [leftEye, rightEye]) {
      eye.upperLidPivot.rotation.x = upperLidAngle;
      eye.lowerLidPivot.rotation.x = lowerLidAngle;
      eye.gazePivot.rotation.y = gazeX;
      eye.gazePivot.rotation.x = -gazeY;
    }

    leftEye.browPivot.position.y = 0.197 - browMoodSmooth * 0.018;
    leftEye.browPivot.rotation.z = -browMoodSmooth * 0.65;
    rightEye.browPivot.position.y = 0.197 - browMoodSmooth * 0.018;
    rightEye.browPivot.rotation.z = browMoodSmooth * 0.65;

    // Gentle expression on 3D lips (soft serene smile at rest, subtle exertion open during combat/sprint)
    const mouthOpen = state.attackTimer > 0 ? 0.004 : state.isSprinting ? 0.0022 : 0;
    upperLipMesh.position.y = 0.118 + smileSmooth * 0.002 + mouthOpen * 0.4;
    lowerLipMesh.position.y = 0.112 + smileSmooth * 0.001 - mouthOpen;
    upperLipMesh.scale.x = 1.0 + smileSmooth * 0.08;

    // Update Water Ripples & Splash Droplets
    for (const r of ripples) {
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / r.maxAge;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const ease = 1 - (1 - t) * (1 - t);
      r.mesh.scale.setScalar(0.45 + ease * r.maxScale);
      r.mat.opacity = (1 - t) * 0.62;
    }

    const spAttr = splashGeo.attributes.position as THREE.BufferAttribute;
    let splashDirty = false;
    for (let i = 0; i < MAX_SPLASH; i++) {
      if (!splashActive[i]) continue;
      splashDirty = true;
      splashAge[i] += dt;
      if (splashAge[i] >= splashMaxAge[i]) {
        splashActive[i] = 0;
        splashPos[i * 3 + 1] = -999;
        spAttr.setXYZ(i, 0, -999, 0);
        continue;
      }
      splashVel[i * 3 + 1] -= 9.8 * dt;
      splashPos[i * 3] += splashVel[i * 3] * dt;
      splashPos[i * 3 + 1] += splashVel[i * 3 + 1] * dt;
      splashPos[i * 3 + 2] += splashVel[i * 3 + 2] * dt;
      spAttr.setXYZ(i, splashPos[i * 3], splashPos[i * 3 + 1], splashPos[i * 3 + 2]);
    }
    if (splashDirty) spAttr.needsUpdate = true;

    // Hide character body meshes & local face fill light in First-Person view
    pelvis.visible = !isFirstPerson;
    faceFillLight.intensity = isFirstPerson ? 0 : 0.55;
    contactShadow.visible = !isFirstPerson && state.isGrounded && !state.isSwimming;
    const airFade = state.isGrounded ? 1.0 : 0.3;
    contactShadowMat.opacity = (state.isCrouching ? 0.52 : 0.42) * airFade;

    // Shimmering Arcane Guard Ward Ring
    const targetGuardAlpha = state.isGuarding && !isFirstPerson ? 0.62 : 0;
    guardWardMat.opacity = THREE.MathUtils.damp(guardWardMat.opacity, targetGuardAlpha, 14, dt);
    guardWard.visible = guardWardMat.opacity > 0.02;
    if (guardWard.visible) {
      guardWard.rotation.y = elapsed * 2.4;
      guardWard.rotation.x = Math.sin(elapsed * 3.1) * 0.16;
      guardWard.scale.setScalar(0.95 + Math.sin(elapsed * 7.5) * 0.06);
    }

    // Update Flashlight SpotLight & Volumetric Cone
    if (state.flashlightOn) {
      if (isFirstPerson) {
        _flashPos.set(state.position.x, state.position.y + (state.isCrouching ? 1.15 : 1.58), state.position.z);
        _flashDir.set(-Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch));
        _flashPos.addScaledVector(_flashDir, 0.25);
      } else {
        flashlightMesh.getWorldPosition(_flashPos);
        _flashDir.set(-Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch));
      }
      flashlight.position.copy(_flashPos);
      flashlight.target.position.copy(_flashPos).addScaledVector(_flashDir, 14);
      flashlight.intensity = 18.0;

      flashlightCone.position.copy(_flashPos);
      flashlightCone.lookAt(flashlight.target.position);
      coneMat.opacity = 0.055;
      flashlightCone.visible = true;
    } else {
      flashlight.intensity = 0;
      flashlightCone.visible = false;
    }

    // Update Footprint Ages & Matrices
    const wearRate = 1 + rainIntensity * 2.2 + snowIntensity * 1.8;
    for (let i = 0; i < MAX_FOOTPRINTS; i++) {
      const rec = fpRecords[i];
      if (!rec.active) {
        _fpDummy.position.set(0, -9999, 0);
        _fpDummy.scale.setScalar(0.001);
        _fpDummy.updateMatrix();
        footprintsMesh.setMatrixAt(i, _fpDummy.matrix);
        continue;
      }
      rec.age += dt * wearRate;
      if (rec.age >= rec.maxAge) {
        rec.active = false;
        _fpDummy.position.set(0, -9999, 0);
        _fpDummy.scale.setScalar(0.001);
        _fpDummy.updateMatrix();
        footprintsMesh.setMatrixAt(i, _fpDummy.matrix);
        continue;
      }
      const life = 1 - rec.age / rec.maxAge;
      _fpDummy.position.set(rec.x, rec.y, rec.z);
      _normVec.set(rec.nx, rec.ny, rec.nz);
      _alignQuat.setFromUnitVectors(_upVec, _normVec);
      _yawQuat.setFromAxisAngle(_upVec, rec.yaw);
      _fpDummy.quaternion.copy(_alignQuat).multiply(_yawQuat);
      _fpDummy.scale.set(rec.side * life, 1, life);
      _fpDummy.updateMatrix();
      footprintsMesh.setMatrixAt(i, _fpDummy.matrix);
    }
    footprintsMesh.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    state,
    flashlight,
    flashlightCone,
    footprintsMesh,
    triggerAttack,
    triggerDodge,
    setGuarding,
    update,
    setPosition,
  };
}
