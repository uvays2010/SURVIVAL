import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';
import { groundHeightAt, groundNormalAt, waterDistanceInfo } from './noise';

export interface CharacterState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  isGrounded: boolean;
  isCrouching: boolean;
  isSprinting: boolean;
  moveSpeed: number;
  walkPhase: number;
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

export function createCharacterSystem(
  scene: THREE.Scene,
  textures: ProceduralTextureSet
): CharacterSystem {
  const group = new THREE.Group();

  // Materials with realistic roughness & fabric/leather/skin/steel contrast
  const jacketMat = new THREE.MeshStandardMaterial({
    map: textures.fabricMap,
    color: 0x455640, // Olive tactical field jacket
    roughness: 0.84,
    metalness: 0.04,
  });
  const jacketTrimMat = new THREE.MeshStandardMaterial({
    map: textures.fabricMap,
    color: 0x2c3328, // Darker reinforced shoulder/pocket trim
    roughness: 0.88,
    metalness: 0.05,
  });
  const collarShearlingMat = new THREE.MeshStandardMaterial({
    color: 0x73634e,
    roughness: 0.95,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    map: textures.fabricMap,
    color: 0x36312b, // Charcoal-earth cargo pants
    roughness: 0.9,
    metalness: 0.02,
  });
  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0x3b271a,
    roughness: 0.62,
    metalness: 0.08,
  });
  const bootMat = new THREE.MeshStandardMaterial({
    color: 0x221913,
    roughness: 0.68,
    metalness: 0.08,
  });
  const soleMat = new THREE.MeshStandardMaterial({
    color: 0x131416,
    roughness: 0.92,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xd4a181,
    roughness: 0.58,
    metalness: 0.02,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    map: textures.faceMap,
    color: 0xffffff,
    roughness: 0.56,
    metalness: 0.02,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x241b15,
    roughness: 0.86,
  });
  const packMat = new THREE.MeshStandardMaterial({
    map: textures.fabricMap,
    color: 0x6b533b,
    roughness: 0.85,
    metalness: 0.05,
  });
  const strapMat = new THREE.MeshStandardMaterial({
    color: 0x1b1d1f,
    roughness: 0.72,
    metalness: 0.12,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x6c757d,
    roughness: 0.25,
    metalness: 0.9,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xc29b48,
    roughness: 0.32,
    metalness: 0.85,
  });

  // Pelvis root (for breathing, crouch & landing squash)
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.92;
  group.add(pelvis);

  // Hips + Utility Leather Belt & Brass Buckle + Side Sheath
  const hipsMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.22), pantsMat);
  hipsMesh.castShadow = true;
  pelvis.add(hipsMesh);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.365, 0.055, 0.242), leatherMat);
  belt.position.y = 0.055;
  belt.castShadow = true;
  pelvis.add(belt);

  const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.025), brassMat);
  beltBuckle.position.set(0, 0.055, 0.125);
  pelvis.add(beltBuckle);

  const sheath = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.065), leatherMat);
  sheath.position.set(0.195, -0.04, 0.01);
  sheath.rotation.x = 0.22;
  pelvis.add(sheath);

  // Spine / Torso
  const torso = new THREE.Group();
  torso.position.y = 0.08;
  pelvis.add(torso);

  const chestMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.195, 0.162, 0.48, 12), jacketMat);
  chestMesh.scale.set(1.08, 1, 0.74);
  chestMesh.position.y = 0.24;
  chestMesh.castShadow = true;
  torso.add(chestMesh);

  // Storm-Flap Placket, Zipper & Dual Chest Utility Pockets
  const placket = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.44, 0.028), jacketTrimMat);
  placket.position.set(0, 0.24, 0.135);
  torso.add(placket);

  const zipperPull = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.42, 0.012), brassMat);
  zipperPull.position.set(0, 0.24, 0.148);
  torso.add(zipperPull);

  for (const px of [-0.095, 0.095]) {
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.03), jacketTrimMat);
    pocket.position.set(px, 0.29, 0.13);
    torso.add(pocket);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.096, 0.035, 0.036), jacketMat);
    flap.position.set(px, 0.34, 0.132);
    torso.add(flap);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 6), brassMat);
    button.rotation.x = Math.PI * 0.5;
    button.position.set(px, 0.335, 0.152);
    torso.add(button);
  }

  // Turned-up Shearling Collar & Shoulder Pads + Lower Jacket Hem
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.138, 0.1, 10), collarShearlingMat);
  collar.position.y = 0.5;
  torso.add(collar);

  for (const sx of [-0.17, 0.17]) {
    const shPad = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.055, 0.18), jacketTrimMat);
    shPad.position.set(sx, 0.46, 0);
    shPad.rotation.z = -Math.sign(sx) * 0.22;
    torso.add(shPad);
  }

  const jacketHem = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.215, 0.19, 12, 1, true), jacketMat);
  jacketHem.scale.set(1.06, 1, 0.78);
  jacketHem.position.y = 0.015;
  jacketHem.material.side = THREE.DoubleSide;
  torso.add(jacketHem);

  // Detailed Survival Backpack with Side Pouches, Bedroll & Buckles
  const backpack = new THREE.Group();
  backpack.position.set(0, 0.28, -0.185);
  torso.add(backpack);

  const packMain = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.44, 0.19), packMat);
  packMain.castShadow = true;
  backpack.add(packMain);

  const packTopFlap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.21), jacketTrimMat);
  packTopFlap.position.set(0, 0.22, 0.0);
  packTopFlap.castShadow = true;
  backpack.add(packTopFlap);

  const packFrontPocket = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.06), jacketTrimMat);
  packFrontPocket.position.set(0, -0.05, -0.11);
  packFrontPocket.castShadow = true;
  backpack.add(packFrontPocket);

  const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.37, 10), strapMat);
  bedroll.rotation.z = Math.PI * 0.5;
  bedroll.position.set(0, 0.29, -0.02);
  bedroll.castShadow = true;
  backpack.add(bedroll);

  for (const sx of [-0.11, 0.11]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.22), strapMat);
    strap.position.set(sx, 0, 0.14);
    backpack.add(strap);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.03, 0.02), brassMat);
    buckle.position.set(sx, 0.12, -0.105);
    backpack.add(buckle);
  }

  // Head, UV-Mapped Face, Sculpted 3D Facial Features & Layered Hair
  const headPivot = new THREE.Group();
  headPivot.position.y = 0.53;
  torso.add(headPivot);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.068, 0.11, 10), skinMat);
  neck.position.y = 0.03;
  headPivot.add(neck);

  // SphereGeometry u=0.5 is at +X; rotate -PI/2 around Y so faceMap looks straight along +Z
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.118, 22, 18), faceMat);
  headMesh.rotation.y = -Math.PI * 0.5;
  headMesh.scale.set(0.96, 1.08, 0.92);
  headMesh.position.y = 0.155;
  headMesh.castShadow = true;
  headPivot.add(headMesh);

  // Subtle 3D Nose Bridge & Tip
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.042, 6), skinMat);
  nose.rotation.x = Math.PI * 0.44;
  nose.position.set(0, 0.145, 0.115);
  headPivot.add(nose);

  // Subtle 3D Brow Ridge
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.016, 0.024), skinMat);
  brow.position.set(0, 0.184, 0.098);
  headPivot.add(brow);

  // Left & Right Sculpted Ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), skinMat);
    ear.scale.set(0.45, 1.15, 0.72);
    ear.position.set(side * 0.108, 0.15, -0.005);
    headPivot.add(ear);
  }

  // Layered Crown & Swept Bangs Hair
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hairMat);
  hairCap.position.set(0, 0.168, -0.012);
  hairCap.rotation.x = -0.26;
  hairCap.castShadow = true;
  headPivot.add(hairCap);

  const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.09, 0.07), hairMat);
  hairBack.position.set(0, 0.115, -0.085);
  headPivot.add(hairBack);

  for (let b = -2; b <= 2; b++) {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.068, 5), hairMat);
    tuft.position.set(b * 0.032, 0.235 - Math.abs(b) * 0.008, 0.072 - Math.abs(b) * 0.01);
    tuft.rotation.x = 1.18;
    tuft.rotation.z = -b * 0.15;
    headPivot.add(tuft);
  }

  // Arms (Left & Right articulated shoulders, elbows, cuff trim, fingerless gloves)
  const buildArm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.23, 0.44, 0);
    torso.add(shoulder);

    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.049, 0.28, 9), jacketMat);
    upperArm.position.y = -0.13;
    upperArm.castShadow = true;
    shoulder.add(upperArm);

    const elbow = new THREE.Group();
    elbow.position.y = -0.27;
    shoulder.add(elbow);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.039, 0.26, 9), jacketMat);
    forearm.position.y = -0.12;
    forearm.castShadow = true;
    elbow.add(forearm);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.04, 9), jacketTrimMat);
    cuff.position.y = -0.235;
    elbow.add(cuff);

    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.075, 0.076), leatherMat);
    glove.position.y = -0.275;
    elbow.add(glove);

    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.032, 0.06), skinMat);
    fingers.position.set(0, -0.315, 0.005);
    elbow.add(fingers);

    return { shoulder, elbow };
  };

  const leftArm = buildArm(-1);
  const rightArm = buildArm(1);

  // Handheld Flashlight attached to Left Hand (frees Right Hand for Survival Blade!)
  const flashlightMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.022, 0.16, 10), metalMat);
  flashlightMesh.rotation.x = Math.PI * 0.5;
  flashlightMesh.position.set(0, -0.29, 0.06);
  leftArm.elbow.add(flashlightMesh);

  // Detailed Survival Machete / Combat Blade attached to Right Hand
  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0, -0.29, 0.04);
  rightArm.elbow.add(weaponPivot);

  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.15, 8), leatherMat);
  hilt.rotation.x = Math.PI * 0.5;
  weaponPivot.add(hilt);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.022, 0.022), brassMat);
  guard.position.set(0, 0, 0.078);
  weaponPivot.add(guard);

  const bladeMain = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.048, 0.44), metalMat);
  bladeMain.position.set(0, 0.008, 0.305);
  bladeMain.castShadow = true;
  weaponPivot.add(bladeMain);

  const bladeTip = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.12, 4), metalMat);
  bladeTip.rotation.x = Math.PI * 0.5;
  bladeTip.scale.set(0.32, 1, 1);
  bladeTip.position.set(0, 0.008, 0.58);
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

  // Volumetric-style soft additive dust beam cone for flashlight
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

  // Legs (Thigh with Cargo Pocket, Knee Pad, Shin, Laced Lug-Sole Boot)
  const buildLeg = (side: number) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.105, -0.04, 0);
    pelvis.add(hip);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.064, 0.44, 9), pantsMat);
    thigh.position.y = -0.21;
    thigh.castShadow = true;
    hip.add(thigh);

    const cargoPocket = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.14, 0.11), jacketTrimMat);
    cargoPocket.position.set(side * 0.068, -0.22, 0.01);
    hip.add(cargoPocket);

    const knee = new THREE.Group();
    knee.position.y = -0.43;
    hip.add(knee);

    const kneePad = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.085, 0.045), strapMat);
    kneePad.position.set(0, 0, 0.048);
    knee.add(kneePad);

    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.049, 0.4, 9), pantsMat);
    shin.position.y = -0.19;
    shin.castShadow = true;
    knee.add(shin);

    const bootUpper = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.11, 0.22), bootMat);
    bootUpper.position.set(0, -0.415, 0.038);
    bootUpper.castShadow = true;
    knee.add(bootUpper);

    const bootSole = new THREE.Mesh(new THREE.BoxGeometry(0.114, 0.035, 0.235), soleMat);
    bootSole.position.set(0, -0.475, 0.038);
    knee.add(bootSole);

    return { hip, knee };
  };

  const leftLeg = buildLeg(-1);
  const rightLeg = buildLeg(1);

  // Grounded Contact Shadow Disc (always anchors boots to terrain & bridges)
  const contactShadowGeo = new THREE.PlaneGeometry(1.15, 1.15);
  contactShadowGeo.rotateX(-Math.PI * 0.5);
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: textures.softGlowMap,
    color: 0x05070a,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
  contactShadow.position.y = 0.03;
  group.add(contactShadow);

  // Arcane Guard Ward Ring (shimmers around survivor while guarding with R)
  const guardWardGeo = new THREE.RingGeometry(0.68, 0.88, 32);
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

  // Footprint Decal InstancedMesh Pool
  const fpGeo = new THREE.PlaneGeometry(0.2, 0.34);
  fpGeo.rotateX(-Math.PI * 2 * 0.25);
  const fpMat = new THREE.MeshStandardMaterial({
    map: textures.footprintMap,
    transparent: true,
    opacity: 0.55,
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

  const state: CharacterState = {
    position: new THREE.Vector3(-16, groundHeightAt(-16, 76), 76),
    velocity: new THREE.Vector3(),
    yaw: 0.2,
    pitch: -0.08,
    isGrounded: true,
    isCrouching: false,
    isSprinting: false,
    moveSpeed: 0,
    walkPhase: 0,
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

  const _fpDummy = new THREE.Object3D();
  const _upVec = new THREE.Vector3(0, 1, 0);
  const _normVec = new THREE.Vector3();
  const _alignQuat = new THREE.Quaternion();
  const _yawQuat = new THREE.Quaternion();
  const _flashPos = new THREE.Vector3();
  const _flashDir = new THREE.Vector3();

  const spawnFootprint = (side: number) => {
    const { dist } = waterDistanceInfo(state.position.x, state.position.z);
    if (dist < -0.15) return; // Don't stamp footprints deep underwater

    const offsetX = Math.cos(state.yaw) * side * 0.14;
    const offsetZ = -Math.sin(state.yaw) * side * 0.14;
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
    group.position.copy(state.position);
  };

  const triggerAttack = (heavy: boolean): { comboStep: number; isHeavy: boolean } | null => {
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

    // Snap character facing toward camera yaw & add crisp forward lunge impulse
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

    state.isCrouching = wantCrouch || state.dodgeTimer > 0;
    state.isSprinting = wantSprint && !wantCrouch && !state.isGuarding && state.attackTimer <= 0 && inputForward > 0.1;

    // Movement vector in world space from character yaw
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
      const dashSpeed = 12.5 * (state.dodgeTimer / 0.32) + 2.5;
      state.velocity.x = state.dodgeDirX * dashSpeed;
      state.velocity.z = state.dodgeDirZ * dashSpeed;
    } else {
      const speedMod = state.attackTimer > 0 ? 0.35 : state.isGuarding ? 0.55 : 1.0;
      const targetMaxSpeed = (state.isCrouching ? 2.6 : state.isSprinting ? 8.6 : 4.9) * speedMod;
      const targetVx = wishX * targetMaxSpeed;
      const targetVz = wishZ * targetMaxSpeed;

      // Natural acceleration & deceleration inertia
      const accel = state.isGrounded ? 10.5 : 3.5;
      state.velocity.x = THREE.MathUtils.damp(state.velocity.x, targetVx, accel, dt);
      state.velocity.z = THREE.MathUtils.damp(state.velocity.z, targetVz, accel, dt);
    }

    // Jump & gravity
    if (wantJump && state.isGrounded && !state.isCrouching) {
      state.velocity.y = 6.9;
      state.isGrounded = false;
    }
    state.velocity.y -= 18.5 * dt;

    let nextX = state.position.x + state.velocity.x * dt;
    let nextZ = state.position.z + state.velocity.z * dt;

    // Keep within playable valley bounds
    nextX = THREE.MathUtils.clamp(nextX, -420, 420);
    nextZ = THREE.MathUtils.clamp(nextZ, -420, 420);

    const resolved = resolveCollisions(nextX, nextZ, 0.45);
    nextX = resolved.x;
    nextZ = resolved.z;

    const nextY = state.position.y + state.velocity.y * dt;
    const floorY = groundHeightQuery(nextX, nextZ);

    // Slow down slightly in deep water
    const waterDepth = Math.max(0, -floorY);
    if (waterDepth > 0.35) {
      state.velocity.x *= 1 - Math.min(0.4, waterDepth * 0.18) * dt * 5;
      state.velocity.z *= 1 - Math.min(0.4, waterDepth * 0.18) * dt * 5;
    }

    if (nextY <= floorY) {
      if (!state.isGrounded && state.velocity.y < -4.5) {
        state.landSquash = Math.min(0.24, Math.abs(state.velocity.y) * 0.022);
      }
      state.position.set(nextX, floorY, nextZ);
      state.velocity.y = 0;
      state.isGrounded = true;
    } else {
      state.position.set(nextX, nextY, nextZ);
      state.isGrounded = false;
    }

    const horizSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    state.moveSpeed = horizSpeed;

    // Smooth character facing direction in Third Person (always face movement if moving, or yaw in FP)
    group.position.copy(state.position);
    if (isFirstPerson) {
      group.rotation.y = state.yaw + Math.PI;
    } else if (horizSpeed > 0.35) {
      const targetFacing = Math.atan2(state.velocity.x, state.velocity.z);
      let diff = targetFacing - group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      group.rotation.y += diff * Math.min(1, dt * 11);
    }

    // Procedural Animation Blending (Idle, Walk, Run, Crouch, Jump)
    state.landSquash = THREE.MathUtils.damp(state.landSquash, 0, 12, dt);

    const normMove = Math.min(1, horizSpeed / 7.5);
    const freq = state.isSprinting ? 11.2 : state.isCrouching ? 6.2 : 8.2;
    if (state.isGrounded && horizSpeed > 0.25) {
      state.walkPhase += dt * freq * (0.45 + 0.55 * normMove);
      // Detect footstep zero-crossings for footprint decals
      const stepSign = Math.sin(state.walkPhase) >= 0 ? 1 : -1;
      if (stepSign !== state.lastStepSign) {
        state.lastStepSign = stepSign;
        spawnFootprint(stepSign);
      }
    }

    const s = Math.sin(state.walkPhase);
    const c = Math.cos(state.walkPhase);
    const stride = state.isGrounded ? normMove : 0.15;

    // Breathing + vertical gait bounce + crouch + landing absorb
    const breath = Math.sin(elapsed * 2.1) * 0.012;
    const gaitBob = Math.abs(s) * 0.055 * stride;
    const crouchOffset = state.isCrouching ? -0.28 : 0;
    pelvis.position.y = 0.92 + gaitBob + crouchOffset - state.landSquash + breath * 0.4;
    pelvis.rotation.z = c * 0.045 * stride;

    // Torso forward lean, combat twist & dodge lean
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

    const forwardLean = (state.isCrouching ? 0.26 : stride * (state.isSprinting ? 0.24 : 0.11)) + combatPitchX;
    torso.rotation.x = THREE.MathUtils.damp(torso.rotation.x, forwardLean, 14, dt);
    torso.rotation.y = THREE.MathUtils.damp(torso.rotation.y, -s * 0.11 * stride + combatTwistY, 18, dt);
    chestMesh.scale.y = 1 + breath * 1.4;

    // Head subtle look-around & stabilization
    headPivot.rotation.x = -forwardLean * 0.45 + Math.sin(elapsed * 0.9) * 0.03;
    headPivot.rotation.y = THREE.MathUtils.damp(headPivot.rotation.y, -combatTwistY * 0.55 + Math.sin(elapsed * 0.55) * 0.06 * (1 - stride), 14, dt);

    // Secondary Cloth & Backpack Motion (sways with stride & wind)
    const windLocal = (windDir.x + windDir.y) * 0.04 * windStrength;
    jacketHem.rotation.x = -0.06 - stride * 0.14 - (state.dodgeTimer > 0 ? 0.28 : 0) + Math.sin(elapsed * 4.2) * 0.035 * windStrength + windLocal;
    backpack.position.y = 0.28 + Math.sin(state.walkPhase * 2) * 0.016 * stride;
    backpack.rotation.x = -stride * 0.06;

    // Legs & Knees
    const legAmp = state.isSprinting ? 0.78 : state.isCrouching ? 0.42 : 0.56;
    const crouchKnee = state.isCrouching ? 0.52 : 0;
    const airTuck = state.isGrounded ? 0 : 0.35;

    leftLeg.hip.rotation.x = s * legAmp * stride - crouchKnee * 0.5 - airTuck * 0.4;
    rightLeg.hip.rotation.x = -s * legAmp * stride - crouchKnee * 0.5 + airTuck * 0.2;

    leftLeg.knee.rotation.x = Math.max(0, -c * 0.65 * stride) + crouchKnee + airTuck * 0.7;
    rightLeg.knee.rotation.x = Math.max(0, c * 0.65 * stride) + crouchKnee + airTuck * 0.4;

    // Left Arm (Flashlight aim or Combat counterbalance / Guard brace)
    const armAmp = legAmp * 0.78;
    const leftTargetX = state.flashlightOn
      ? -1.05 + Math.sin(state.walkPhase) * 0.06 * stride
      : state.isGuarding
      ? -0.95
      : state.attackTimer > 0
      ? 0.45
      : -s * armAmp * stride + Math.sin(elapsed * 1.5) * 0.02;
    leftArm.shoulder.rotation.x = THREE.MathUtils.damp(leftArm.shoulder.rotation.x, leftTargetX, 14, dt);
    leftArm.elbow.rotation.x = state.flashlightOn ? -0.32 : state.isGuarding ? -1.15 : -0.25 - Math.max(0, s) * 0.35 * stride;

    // Right Arm (Combat Blade Combo, Heavy Cleave, Guard, or Walk Swing)
    let rShX = s * armAmp * stride;
    let rShY = 0;
    let rShZ = 0;
    let rElbX = -0.25 - Math.max(0, -s) * 0.35 * stride;
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
      rightArm.shoulder.rotation.z = THREE.MathUtils.damp(rightArm.shoulder.rotation.z, 0, 12, dt);
      rightArm.elbow.rotation.x = THREE.MathUtils.damp(rightArm.elbow.rotation.x, rElbX, 12, dt);
      weaponPivot.rotation.x = THREE.MathUtils.damp(weaponPivot.rotation.x, 0.16, 12, dt);
    }

    // Hide character body meshes in First-Person view so camera never clips inside skull
    pelvis.visible = !isFirstPerson;
    contactShadow.visible = !isFirstPerson && state.isGrounded;
    const airFade = state.isGrounded ? 1.0 : 0.3;
    contactShadowMat.opacity = (state.isCrouching ? 0.54 : 0.44) * airFade;

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

    // Update Footprint Ages & Matrices (fade faster in rain or snow)
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
