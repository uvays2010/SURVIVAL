import * as THREE from 'three';
import { groundHeightAt, seededRandom, WATER_LEVEL, waterDistanceInfo } from './noise';
import {
  EnemyCategory,
  EnemyHudTarget,
  EnemyMapMarker,
  getWorldMapDef,
  WorldMapId,
} from './types';

export interface EnemyMeleeHitInfo {
  hitPos: THREE.Vector3;
  isMech: boolean;
  killed: boolean;
  category: EnemyCategory;
}

export interface EnemyUpdateResult {
  playerDamage: number;
  playerHitBlocked: boolean;
  playerKnockDir: THREE.Vector3;
  bossShockwavePos: THREE.Vector3 | null;
  mechShockwavePos: THREE.Vector3 | null;
}

export interface EnemySystem {
  root: THREE.Group;
  checkMeleeHit: (
    origin: THREE.Vector3,
    forwardDir: THREE.Vector3,
    range: number,
    isHeavy: boolean
  ) => EnemyMeleeHitInfo | null;
  update: (
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    playerDodging: boolean,
    playerGuarding: boolean,
    enteredWorld: boolean
  ) => EnemyUpdateResult;
  getHudTarget: (playerPos: THREE.Vector3) => EnemyHudTarget | null;
  getMapMarkers: () => EnemyMapMarker[];
  getDefeatedCount: () => number;
  dispose: () => void;
}

type EnemyAiState = 'patrol' | 'chase' | 'windup' | 'recover' | 'dead';

interface EnemyEntity {
  id: string;
  category: EnemyCategory;
  nameKey: string;
  squadId: string | null;
  group: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArm: THREE.Group | null;
  rightArm: THREE.Group | null;
  leftLeg: THREE.Group | null;
  rightLeg: THREE.Group | null;
  backLimbA: THREE.Group | null; // Wing L or rear leg L
  backLimbB: THREE.Group | null; // Wing R or rear leg R
  tailPivot: THREE.Group | null;
  rotorMesh: THREE.Mesh | null;
  glowMat: THREE.MeshStandardMaterial;
  armorMat: THREE.MeshStandardMaterial;
  hpSprite: THREE.Sprite;
  hpCanvas: HTMLCanvasElement;
  hpTex: THREE.CanvasTexture;
  pos: THREE.Vector3;
  homeX: number;
  homeZ: number;
  patrolTargetX: number;
  patrolTargetZ: number;
  yaw: number;
  speed: number;
  chaseSpeed: number;
  aggroRange: number;
  attackRange: number;
  attackDamage: number;
  windupDuration: number;
  attackCooldown: number;
  hitRadius: number;
  hp: number;
  maxHp: number;
  lastDrawnHp: number;
  state: EnemyAiState;
  stateTimer: number;
  cooldownTimer: number;
  respawnTimer: number;
  hitFlash: number;
  staggerTimer: number;
  knockVx: number;
  knockVz: number;
  gaitPhase: number;
  pendingShockwave: boolean;
}

function drawHealthBarCanvas(
  canvas: HTMLCanvasElement,
  hp: number,
  maxHp: number,
  category: EnemyCategory
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const ratio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  ctx.fillStyle = 'rgba(8, 12, 18, 0.85)';
  ctx.fillRect(6, 10, w - 12, h - 20);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 10, w - 12, h - 20);

  const barColor =
    category === 'boss'
      ? '#a855f7'
      : category === 'mech'
      ? '#38bdf8'
      : category === 'beast'
      ? '#f97316'
      : '#ef4444';
  ctx.fillStyle = barColor;
  ctx.fillRect(9, 13, Math.max(0, (w - 18) * ratio), h - 26);
}

function buildEnemyRig(
  category: EnemyCategory,
  isSquadLeader: boolean,
  disposables: { geos: THREE.BufferGeometry[]; mats: THREE.Material[]; texs: THREE.Texture[] }
) {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const headGroup = new THREE.Group();
  let leftArm: THREE.Group | null = null;
  let rightArm: THREE.Group | null = null;
  let leftLeg: THREE.Group | null = null;
  let rightLeg: THREE.Group | null = null;
  let backLimbA: THREE.Group | null = null;
  let backLimbB: THREE.Group | null = null;
  let tailPivot: THREE.Group | null = null;
  let rotorMesh: THREE.Mesh | null = null;

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.geos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.mats.push(m);
    return m;
  };

  let armorMat: THREE.MeshStandardMaterial;
  let glowMat: THREE.MeshStandardMaterial;
  let barHeight = 2.4;

  if (category === 'beast') {
    // 👹 Maxluq: Horned shadow predator with glowing dorsal spines & claws
    barHeight = 2.1;
    armorMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x2a1d2e, roughness: 0.78, metalness: 0.12 })
    );
    const hideMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x45222c, roughness: 0.9, metalness: 0.04 })
    );
    glowMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xff5722,
        emissive: 0xff3b14,
        emissiveIntensity: 1.5,
        roughness: 0.25,
      })
    );

    bodyGroup.position.y = 0.95;

    const torso = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.36, 0.85, 6, 10)), armorMat);
    torso.rotation.x = Math.PI * 0.42;
    torso.castShadow = true;
    bodyGroup.add(torso);

    const chest = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.42, 10, 8)), hideMat);
    chest.position.set(0, 0.12, 0.34);
    chest.scale.set(1.05, 0.95, 1.0);
    chest.castShadow = true;
    bodyGroup.add(chest);

    // Dorsal glowing spine crystals
    for (let i = 0; i < 4; i++) {
      const spine = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.08, 0.34 - i * 0.04, 5)), glowMat);
      spine.position.set(0, 0.38 - i * 0.06, 0.22 - i * 0.25);
      spine.rotation.x = -0.35;
      bodyGroup.add(spine);
    }

    headGroup.position.set(0, 0.26, 0.65);
    bodyGroup.add(headGroup);

    const skull = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.42, 0.34, 0.48)), armorMat);
    skull.castShadow = true;
    headGroup.add(skull);

    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.07, 0.42, 6)), hideMat);
      horn.position.set(side * 0.18, 0.24, -0.05);
      horn.rotation.set(-0.45, 0, -side * 0.35);
      headGroup.add(horn);

      const eye = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.055, 6, 6)), glowMat);
      eye.position.set(side * 0.14, 0.05, 0.24);
      headGroup.add(eye);
    }

    // 4 Articulated clawed legs
    const legGeo = trackGeo(new THREE.CylinderGeometry(0.09, 0.06, 0.85, 7));
    leftLeg = new THREE.Group();
    leftLeg.position.set(-0.34, -0.1, 0.36);
    const fl = new THREE.Mesh(legGeo, armorMat);
    fl.position.y = -0.36;
    fl.castShadow = true;
    leftLeg.add(fl);
    bodyGroup.add(leftLeg);

    rightLeg = new THREE.Group();
    rightLeg.position.set(0.34, -0.1, 0.36);
    const fr = new THREE.Mesh(legGeo, armorMat);
    fr.position.y = -0.36;
    fr.castShadow = true;
    rightLeg.add(fr);
    bodyGroup.add(rightLeg);

    backLimbA = new THREE.Group();
    backLimbA.position.set(-0.3, -0.18, -0.36);
    const bl = new THREE.Mesh(legGeo, hideMat);
    bl.position.y = -0.34;
    bl.castShadow = true;
    backLimbA.add(bl);
    bodyGroup.add(backLimbA);

    backLimbB = new THREE.Group();
    backLimbB.position.set(0.3, -0.18, -0.36);
    const br = new THREE.Mesh(legGeo, hideMat);
    br.position.y = -0.34;
    br.castShadow = true;
    backLimbB.add(br);
    bodyGroup.add(backLimbB);

    tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.05, -0.55);
    const tail = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.11, 0.9, 6)), hideMat);
    tail.rotation.x = -Math.PI * 0.45;
    tail.position.z = -0.42;
    tailPivot.add(tail);
    bodyGroup.add(tailPivot);
  } else if (category === 'mech') {
    // 🦾 Mexanik dushman: Brushed steel robot sentinel with glowing cyan core & plasma blade
    barHeight = 2.65;
    armorMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x6f7c8a, roughness: 0.24, metalness: 0.88 })
    );
    const jointMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1c2128, roughness: 0.72, metalness: 0.22 })
    );
    glowMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x00d8ff,
        emissiveIntensity: 1.8,
        roughness: 0.15,
      })
    );

    bodyGroup.position.y = 1.05;

    const pelvis = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.46, 0.24, 0.34)), jointMat);
    bodyGroup.add(pelvis);

    const chest = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.72, 0.68, 0.46)), armorMat);
    chest.position.y = 0.46;
    chest.castShadow = true;
    bodyGroup.add(chest);

    const core = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12)), glowMat);
    core.rotation.x = Math.PI * 0.5;
    core.position.set(0, 0.48, 0.23);
    bodyGroup.add(core);

    // Spinning dorsal radar/turbine
    rotorMesh = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.74, 0.06, 0.12)), glowMat);
    rotorMesh.position.set(0, 0.92, -0.18);
    bodyGroup.add(rotorMesh);

    headGroup.position.set(0, 0.96, 0.04);
    bodyGroup.add(headGroup);

    const helm = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.18, 0.22, 0.28, 8)), armorMat);
    helm.castShadow = true;
    headGroup.add(helm);

    const visor = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.32, 0.08, 0.12)), glowMat);
    visor.position.set(0, 0.02, 0.16);
    headGroup.add(visor);

    const armGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.64, 0.18));
    leftArm = new THREE.Group();
    leftArm.position.set(-0.48, 0.68, 0);
    const lArmMesh = new THREE.Mesh(armGeo, jointMat);
    lArmMesh.position.y = -0.28;
    lArmMesh.castShadow = true;
    leftArm.add(lArmMesh);
    bodyGroup.add(leftArm);

    rightArm = new THREE.Group();
    rightArm.position.set(0.48, 0.68, 0);
    const rArmMesh = new THREE.Mesh(armGeo, armorMat);
    rArmMesh.position.y = -0.28;
    rArmMesh.castShadow = true;
    rightArm.add(rArmMesh);
    const plasmaBlade = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.06, 0.14, 0.78)), glowMat);
    plasmaBlade.position.set(0, -0.58, 0.34);
    rightArm.add(plasmaBlade);
    bodyGroup.add(rightArm);

    const legGeo = trackGeo(new THREE.BoxGeometry(0.22, 0.88, 0.24));
    leftLeg = new THREE.Group();
    leftLeg.position.set(-0.2, -0.06, 0);
    const lLegMesh = new THREE.Mesh(legGeo, armorMat);
    lLegMesh.position.y = -0.44;
    lLegMesh.castShadow = true;
    leftLeg.add(lLegMesh);
    bodyGroup.add(leftLeg);

    rightLeg = new THREE.Group();
    rightLeg.position.set(0.2, -0.06, 0);
    const rLegMesh = new THREE.Mesh(legGeo, armorMat);
    rLegMesh.position.y = -0.44;
    rLegMesh.castShadow = true;
    rightLeg.add(rLegMesh);
    bodyGroup.add(rightLeg);
  } else if (category === 'boss') {
    // 🐉 Boss: Towering horned dragon/wyrm colossus with articulated wings & tail
    barHeight = 4.6;
    armorMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x261433, roughness: 0.52, metalness: 0.38 })
    );
    const scaleMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x4c1d59, roughness: 0.72, metalness: 0.15 })
    );
    glowMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf43f5e,
        emissive: 0xe11d48,
        emissiveIntensity: 1.75,
        roughness: 0.2,
      })
    );

    bodyGroup.position.y = 1.95;

    const torso = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.75, 1.35, 8, 12)), armorMat);
    torso.rotation.x = 0.28;
    torso.castShadow = true;
    bodyGroup.add(torso);

    const chestPlate = new THREE.Mesh(trackGeo(new THREE.DodecahedronGeometry(0.84, 0)), scaleMat);
    chestPlate.position.set(0, 0.48, 0.22);
    chestPlate.castShadow = true;
    bodyGroup.add(chestPlate);

    const chestCore = new THREE.Mesh(trackGeo(new THREE.OctahedronGeometry(0.28, 0)), glowMat);
    chestCore.position.set(0, 0.56, 0.88);
    bodyGroup.add(chestCore);

    // Neck + Dragon Head
    headGroup.position.set(0, 1.45, 0.58);
    bodyGroup.add(headGroup);

    const neck = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.32, 0.46, 0.9, 8)), armorMat);
    neck.position.set(0, -0.25, -0.12);
    neck.rotation.x = 0.35;
    headGroup.add(neck);

    const skull = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.66, 0.52, 0.92)), armorMat);
    skull.position.set(0, 0.22, 0.18);
    skull.castShadow = true;
    headGroup.add(skull);

    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.11, 0.85, 6)), scaleMat);
      horn.position.set(side * 0.28, 0.56, -0.15);
      horn.rotation.set(-0.6, 0, -side * 0.35);
      headGroup.add(horn);

      const eye = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.085, 6, 6)), glowMat);
      eye.position.set(side * 0.22, 0.28, 0.62);
      headGroup.add(eye);
    }

    // Twin Giant Articulated Wings
    const wingGeo = trackGeo(new THREE.BoxGeometry(1.75, 0.08, 0.95));
    backLimbA = new THREE.Group();
    backLimbA.position.set(-0.62, 0.85, -0.18);
    const wingL = new THREE.Mesh(wingGeo, scaleMat);
    wingL.position.set(-0.88, 0.1, -0.15);
    wingL.castShadow = true;
    backLimbA.add(wingL);
    bodyGroup.add(backLimbA);

    backLimbB = new THREE.Group();
    backLimbB.position.set(0.62, 0.85, -0.18);
    const wingR = new THREE.Mesh(wingGeo, scaleMat);
    wingR.position.set(0.88, 0.1, -0.15);
    wingR.castShadow = true;
    backLimbB.add(wingR);
    bodyGroup.add(backLimbB);

    // Heavy clawed arms
    const bossArmGeo = trackGeo(new THREE.CylinderGeometry(0.18, 0.14, 1.1, 8));
    leftArm = new THREE.Group();
    leftArm.position.set(-0.92, 0.62, 0.16);
    const la = new THREE.Mesh(bossArmGeo, armorMat);
    la.position.y = -0.52;
    la.castShadow = true;
    leftArm.add(la);
    bodyGroup.add(leftArm);

    rightArm = new THREE.Group();
    rightArm.position.set(0.92, 0.62, 0.16);
    const ra = new THREE.Mesh(bossArmGeo, armorMat);
    ra.position.y = -0.52;
    ra.castShadow = true;
    rightArm.add(ra);
    bodyGroup.add(rightArm);

    // Massive legs
    const bossLegGeo = trackGeo(new THREE.CylinderGeometry(0.24, 0.18, 1.35, 8));
    leftLeg = new THREE.Group();
    leftLeg.position.set(-0.42, -0.55, 0);
    const ll = new THREE.Mesh(bossLegGeo, armorMat);
    ll.position.y = -0.68;
    ll.castShadow = true;
    leftLeg.add(ll);
    bodyGroup.add(leftLeg);

    rightLeg = new THREE.Group();
    rightLeg.position.set(0.42, -0.55, 0);
    const rl = new THREE.Mesh(bossLegGeo, armorMat);
    rl.position.y = -0.68;
    rl.castShadow = true;
    rightLeg.add(rl);
    bodyGroup.add(rightLeg);

    tailPivot = new THREE.Group();
    tailPivot.position.set(0, -0.45, -0.68);
    const bossTail = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.26, 2.2, 7)), scaleMat);
    bossTail.rotation.x = -Math.PI * 0.48;
    bossTail.position.z = -1.05;
    tailPivot.add(bossTail);
    bodyGroup.add(tailPivot);
  } else {
    // 😈 Yovuz dushman / ⚔️ Dushman guruhi jangchisi (Raider / Squad Warrior)
    const isLeader = category === 'squad' && isSquadLeader;
    barHeight = isLeader ? 2.65 : 2.35;
    armorMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: isLeader ? 0x3b1f24 : 0x262930,
        roughness: 0.36,
        metalness: 0.72,
      })
    );
    const cloakMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: isLeader ? 0xb91c1c : 0x7f1d1d,
        roughness: 0.88,
        metalness: 0.04,
      })
    );
    glowMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xff4d4d,
        emissive: 0xdc2626,
        emissiveIntensity: 1.5,
        roughness: 0.2,
      })
    );

    bodyGroup.position.y = 0.96;
    if (isLeader) {
      group.scale.setScalar(1.16);
    }

    const torso = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.24, 0.19, 0.62, 10)), armorMat);
    torso.position.y = 0.34;
    torso.castShadow = true;
    bodyGroup.add(torso);

    const cloak = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.46, 0.72, 0.07)), cloakMat);
    cloak.position.set(0, 0.24, -0.18);
    cloak.rotation.x = 0.12;
    bodyGroup.add(cloak);

    // Spiked Pauldrons
    for (const side of [-1, 1]) {
      const pauldron = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.14, 8, 6)), armorMat);
      pauldron.position.set(side * 0.3, 0.56, 0);
      bodyGroup.add(pauldron);
    }

    headGroup.position.set(0, 0.8, 0);
    bodyGroup.add(headGroup);

    const helm = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.14, 0.16, 0.28, 10)), armorMat);
    helm.castShadow = true;
    headGroup.add(helm);

    const eyeSlit = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.2, 0.045, 0.08)), glowMat);
    eyeSlit.position.set(0, 0.02, 0.12);
    headGroup.add(eyeSlit);

    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(
        trackGeo(new THREE.ConeGeometry(0.04, isLeader ? 0.32 : 0.2, 5)),
        cloakMat
      );
      horn.position.set(side * 0.13, 0.18, 0);
      horn.rotation.z = -side * 0.45;
      headGroup.add(horn);
    }

    const armGeo = trackGeo(new THREE.CylinderGeometry(0.065, 0.055, 0.56, 7));
    leftArm = new THREE.Group();
    leftArm.position.set(-0.3, 0.56, 0);
    const la = new THREE.Mesh(armGeo, cloakMat);
    la.position.y = -0.24;
    leftArm.add(la);
    // Iron buckler shield on left arm
    const shield = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 10)), armorMat);
    shield.rotation.z = Math.PI * 0.5;
    shield.position.set(-0.08, -0.34, 0.08);
    leftArm.add(shield);
    bodyGroup.add(leftArm);

    rightArm = new THREE.Group();
    rightArm.position.set(0.3, 0.56, 0);
    const ra = new THREE.Mesh(armGeo, armorMat);
    ra.position.y = -0.24;
    rightArm.add(ra);
    // Crimson blade
    const blade = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.04, 0.1, 0.72)), glowMat);
    blade.position.set(0, -0.46, 0.32);
    rightArm.add(blade);
    bodyGroup.add(rightArm);

    const legGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.065, 0.78, 8));
    leftLeg = new THREE.Group();
    leftLeg.position.set(-0.12, 0.02, 0);
    const ll = new THREE.Mesh(legGeo, armorMat);
    ll.position.y = -0.4;
    ll.castShadow = true;
    leftLeg.add(ll);
    bodyGroup.add(leftLeg);

    rightLeg = new THREE.Group();
    rightLeg.position.set(0.12, 0.02, 0);
    const rl = new THREE.Mesh(legGeo, armorMat);
    rl.position.y = -0.4;
    rl.castShadow = true;
    rightLeg.add(rl);
    bodyGroup.add(rightLeg);
  }

  // Overhead HP bar sprite (visible when damaged or nearby)
  const hpCanvas = document.createElement('canvas');
  hpCanvas.width = 128;
  hpCanvas.height = 32;
  const hpTex = new THREE.CanvasTexture(hpCanvas);
  hpTex.colorSpace = THREE.SRGBColorSpace;
  disposables.texs.push(hpTex);
  const hpMat = trackMat(
    new THREE.SpriteMaterial({ map: hpTex, transparent: true, depthTest: false })
  );
  const hpSprite = new THREE.Sprite(hpMat);
  hpSprite.position.set(0, barHeight, 0);
  hpSprite.scale.set(category === 'boss' ? 2.8 : 1.45, 0.34, 1);
  hpSprite.visible = false;
  hpSprite.renderOrder = 10;
  group.add(hpSprite);

  return {
    group,
    bodyGroup,
    headGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    backLimbA,
    backLimbB,
    tailPivot,
    rotorMesh,
    glowMat,
    armorMat,
    hpSprite,
    hpCanvas,
    hpTex,
  };
}

export function createEnemySystem(scene: THREE.Scene, mapId: WorldMapId): EnemySystem {
  const root = new THREE.Group();
  scene.add(root);

  const disposables: {
    geos: THREE.BufferGeometry[];
    mats: THREE.Material[];
    texs: THREE.Texture[];
  } = { geos: [], mats: [], texs: [] };

  const mapDef = getWorldMapDef(mapId);
  const rand = seededRandom(mapId.length * 919 + 42);
  const entities: EnemyEntity[] = [];
  let defeatedCount = 0;

  const isDryLand = (x: number, z: number, minClearance = 0.4): boolean => {
    const gy = groundHeightAt(x, z, mapId);
    if (gy < WATER_LEVEL + minClearance) return false;
    const { dist } = waterDistanceInfo(x, z, mapId);
    return dist >= 1.0;
  };

  const spawnEnemy = (
    id: string,
    category: EnemyCategory,
    nameKey: string,
    wx: number,
    wz: number,
    squadId: string | null = null,
    isSquadLeader = false
  ) => {
    // Nudge out of lakes/rivers onto nearest dry land while keeping starting camp safe (>= 24m)
    let sx = wx;
    let sz = wz;
    if (!isDryLand(sx, sz, 0.45) || Math.hypot(sx - mapDef.spawn.x, sz - mapDef.spawn.z) < 24) {
      let foundDry = false;
      const radii = [10, 18, 28, 40, 54, 70, 88];
      for (const r of radii) {
        for (let attempt = 0; attempt < 16; attempt++) {
          const ang = (attempt / 16) * Math.PI * 2;
          const tx = wx + Math.cos(ang) * r;
          const tz = wz + Math.sin(ang) * r;
          if (
            Math.hypot(tx - mapDef.spawn.x, tz - mapDef.spawn.z) >= 24 &&
            isDryLand(tx, tz, 0.45)
          ) {
            sx = tx;
            sz = tz;
            foundDry = true;
            break;
          }
        }
        if (foundDry) break;
      }
      if (!foundDry) return;
    }

    const sy = groundHeightAt(sx, sz, mapId);
    const rig = buildEnemyRig(category, isSquadLeader, disposables);
    rig.group.position.set(sx, sy, sz);
    root.add(rig.group);

    const stats: Record<
      EnemyCategory,
      {
        hp: number;
        speed: number;
        aggro: number;
        range: number;
        dmg: number;
        windup: number;
        cd: number;
        radius: number;
      }
    > = {
      beast: { hp: 85, speed: 5.8, aggro: 22, range: 2.35, dmg: 14, windup: 0.42, cd: 1.3, radius: 1.0 },
      raider: { hp: 105, speed: 4.9, aggro: 21, range: 2.4, dmg: 16, windup: 0.48, cd: 1.45, radius: 0.95 },
      squad: {
        hp: isSquadLeader ? 140 : 88,
        speed: 5.1,
        aggro: 23,
        range: 2.4,
        dmg: isSquadLeader ? 18 : 13,
        windup: 0.46,
        cd: 1.4,
        radius: 0.95,
      },
      mech: { hp: 145, speed: 4.2, aggro: 24, range: 2.6, dmg: 19, windup: 0.55, cd: 1.6, radius: 1.15 },
      boss: { hp: 360, speed: 4.5, aggro: 30, range: 3.8, dmg: 26, windup: 0.72, cd: 1.85, radius: 1.85 },
    };

    const st = stats[category];
    drawHealthBarCanvas(rig.hpCanvas, st.hp, st.hp, category);
    rig.hpTex.needsUpdate = true;

    entities.push({
      id,
      category,
      nameKey,
      squadId,
      ...rig,
      pos: new THREE.Vector3(sx, sy, sz),
      homeX: sx,
      homeZ: sz,
      patrolTargetX: sx,
      patrolTargetZ: sz,
      yaw: rand() * Math.PI * 2,
      speed: 0,
      chaseSpeed: st.speed,
      aggroRange: st.aggro,
      attackRange: st.range,
      attackDamage: st.dmg,
      windupDuration: st.windup,
      attackCooldown: st.cd,
      hitRadius: st.radius,
      hp: st.hp,
      maxHp: st.hp,
      lastDrawnHp: st.hp,
      state: 'patrol',
      stateTimer: 0.3 + rand() * 0.8,
      cooldownTimer: 0,
      respawnTimer: 0,
      hitFlash: 0,
      staggerTimer: 0,
      knockVx: 0,
      knockVz: 0,
      gaitPhase: rand() * Math.PI * 2,
      pendingShockwave: false,
    });
  };

  // Populate all 5 archetypes dynamically across the active map's landmarks + near-camp trails
  const lms = mapDef.landmarks;
  const s = mapDef.spawn;

  // Accessible skirmish encounter outside camp on dry forest land (away from lake)
  spawnEnemy('trail_beast_1', 'beast', 'shadowBeast', s.x - 32, s.z + 28);
  spawnEnemy('trail_raider_1', 'raider', 'crimsonRaider', s.x + 48, s.z - 8);

  if (lms[1]) {
    // ⚔️ Dushman guruhi (Squad of 3) + 👹 Maxluq
    const sq1 = 'squad_alpha';
    spawnEnemy('sq1_lead', 'squad', 'squadWarrior', lms[1].x, lms[1].z + 8, sq1, true);
    spawnEnemy('sq1_m1', 'squad', 'squadWarrior', lms[1].x - 4.5, lms[1].z + 11, sq1, false);
    spawnEnemy('sq1_m2', 'squad', 'squadWarrior', lms[1].x + 4.5, lms[1].z + 11, sq1, false);
    spawnEnemy('lm1_beast', 'beast', 'shadowBeast', lms[1].x - 14, lms[1].z - 6);
  }

  if (lms[2]) {
    // 🦾 Mexanik dushmanlar + 😈 Yovuz dushmanlar
    spawnEnemy('mech_1', 'mech', 'cyberMech', lms[2].x - 4, lms[2].z + 5);
    spawnEnemy('mech_2', 'mech', 'cyberMech', lms[2].x + 6, lms[2].z - 5);
    spawnEnemy('raider_lm2', 'raider', 'crimsonRaider', lms[2].x + 12, lms[2].z + 8);
  }

  if (lms[3]) {
    // 👹 Maxluqlar + ⚔️ Dushman guruhi 2
    spawnEnemy('beast_lm3_a', 'beast', 'shadowBeast', lms[3].x - 6, lms[3].z + 6);
    spawnEnemy('beast_lm3_b', 'beast', 'shadowBeast', lms[3].x + 8, lms[3].z - 4);
    const sq2 = 'squad_beta';
    spawnEnemy('sq2_lead', 'squad', 'squadWarrior', lms[3].x + 14, lms[3].z + 10, sq2, true);
    spawnEnemy('sq2_m1', 'squad', 'squadWarrior', lms[3].x + 18, lms[3].z + 13, sq2, false);
    spawnEnemy('sq2_m2', 'squad', 'squadWarrior', lms[3].x + 11, lms[3].z + 14, sq2, false);
  }

  if (lms[4]) {
    // 🐉 BOSS + guards at the dramatic high landmark
    spawnEnemy('world_boss_1', 'boss', 'abyssalBoss', lms[4].x, lms[4].z);
    spawnEnemy('boss_guard_1', 'raider', 'crimsonRaider', lms[4].x - 8, lms[4].z + 6);
    spawnEnemy('boss_guard_2', 'mech', 'cyberMech', lms[4].x + 8, lms[4].z + 6);
  }

  if (lms[5]) {
    // Mix of Mech, Raiders & Beast in outer frontier
    spawnEnemy('mech_3', 'mech', 'cyberMech', lms[5].x - 5, lms[5].z);
    spawnEnemy('raider_lm5', 'raider', 'crimsonRaider', lms[5].x + 6, lms[5].z + 4);
    spawnEnemy('beast_lm5', 'beast', 'shadowBeast', lms[5].x, lms[5].z - 10);
  }

  const _toEnemy = new THREE.Vector3();

  const checkMeleeHit = (
    origin: THREE.Vector3,
    forwardDir: THREE.Vector3,
    range: number,
    isHeavy: boolean
  ): EnemyMeleeHitInfo | null => {
    let best: EnemyEntity | null = null;
    let bestDist = Infinity;

    for (const e of entities) {
      if (e.state === 'dead') continue;
      _toEnemy.set(e.pos.x - origin.x, 0, e.pos.z - origin.z);
      const dist = _toEnemy.length();
      if (dist > range + e.hitRadius) continue;
      if (dist > 0.1) {
        _toEnemy.divideScalar(dist);
        const dot = _toEnemy.x * forwardDir.x + _toEnemy.z * forwardDir.z;
        if (dot < (isHeavy ? -0.15 : 0.1)) continue;
      }
      if (dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    }

    if (!best) return null;

    const dmg = isHeavy ? 48 : 24;
    best.hp = Math.max(0, best.hp - dmg);
    best.hitFlash = 1.0;
    best.staggerTimer = best.category === 'boss' ? 0.12 : 0.28;
    const kbForce = best.category === 'boss' ? 3.5 : isHeavy ? 10.5 : 6.5;
    best.knockVx = forwardDir.x * kbForce;
    best.knockVz = forwardDir.z * kbForce;

    // Alert entire squad if part of an enemy squad
    if (best.squadId) {
      for (const mate of entities) {
        if (mate.squadId === best.squadId && mate.state === 'patrol') {
          mate.state = 'chase';
        }
      }
    }

    if (best.hp !== best.lastDrawnHp) {
      best.lastDrawnHp = best.hp;
      drawHealthBarCanvas(best.hpCanvas, best.hp, best.maxHp, best.category);
      best.hpTex.needsUpdate = true;
      best.hpSprite.visible = best.hp > 0;
    }

    let killed = false;
    if (best.hp <= 0) {
      killed = true;
      defeatedCount++;
      best.state = 'dead';
      best.respawnTimer = best.category === 'boss' ? 55 : 26;
      best.group.visible = false;
      best.hpSprite.visible = false;
    } else if (best.state === 'patrol') {
      best.state = 'chase';
    }

    return {
      hitPos: best.pos.clone(),
      isMech: best.category === 'mech',
      killed,
      category: best.category,
    };
  };

  const update = (
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    playerDodging: boolean,
    playerGuarding: boolean,
    enteredWorld: boolean
  ): EnemyUpdateResult => {
    let playerDamage = 0;
    let playerHitBlocked = false;
    const playerKnockDir = new THREE.Vector3();
    let bossShockwavePos: THREE.Vector3 | null = null;
    let mechShockwavePos: THREE.Vector3 | null = null;

    // Alert squad mates if any member sees player
    const activeSquads = new Set<string>();
    if (enteredWorld) {
      for (const e of entities) {
        if (e.state !== 'dead' && e.squadId) {
          const d = Math.hypot(playerPos.x - e.pos.x, playerPos.z - e.pos.z);
          if (d <= e.aggroRange) activeSquads.add(e.squadId);
        }
      }
    }

    for (const e of entities) {
      if (e.state === 'dead') {
        e.respawnTimer -= dt;
        if (e.respawnTimer <= 0) {
          e.state = 'patrol';
          e.hp = e.maxHp;
          e.lastDrawnHp = e.maxHp;
          e.pos.set(e.homeX, groundHeightAt(e.homeX, e.homeZ, mapId), e.homeZ);
          e.group.position.copy(e.pos);
          e.group.visible = true;
          e.hpSprite.visible = false;
          drawHealthBarCanvas(e.hpCanvas, e.hp, e.maxHp, e.category);
          e.hpTex.needsUpdate = true;
        }
        continue;
      }

      e.cooldownTimer = Math.max(0, e.cooldownTimer - dt);
      e.staggerTimer = Math.max(0, e.staggerTimer - dt);

      if (e.hitFlash > 0) {
        e.hitFlash = Math.max(0, e.hitFlash - dt * 4.5);
        e.armorMat.emissive.setHex(e.category === 'mech' ? 0x38bdf8 : 0xff5522);
        e.armorMat.emissiveIntensity = e.hitFlash * 0.9;
      } else {
        e.armorMat.emissiveIntensity = 0;
      }

      // Knockback velocity decay (stay on dry land)
      if (Math.abs(e.knockVx) > 0.05 || Math.abs(e.knockVz) > 0.05) {
        const kx = e.pos.x + e.knockVx * dt;
        const kz = e.pos.z + e.knockVz * dt;
        if (isDryLand(kx, kz, 0.28)) {
          e.pos.x = kx;
          e.pos.z = kz;
        } else {
          e.knockVx = 0;
          e.knockVz = 0;
        }
        e.knockVx *= Math.exp(-8.5 * dt);
        e.knockVz *= Math.exp(-8.5 * dt);
      }

      const dx = playerPos.x - e.pos.x;
      const dz = playerPos.z - e.pos.z;
      const distToPlayer = Math.hypot(dx, dz);
      const distFromHome = Math.hypot(e.pos.x - e.homeX, e.pos.z - e.homeZ);

      if (e.hp < e.maxHp || distToPlayer < 16) {
        e.hpSprite.visible = true;
      } else {
        e.hpSprite.visible = false;
      }

      const tryStepDry = (nx: number, nz: number): boolean => {
        if (isDryLand(nx, nz, 0.32)) {
          e.pos.x = nx;
          e.pos.z = nz;
          return true;
        }
        if (isDryLand(nx, e.pos.z, 0.32)) {
          e.pos.x = nx;
          return true;
        }
        if (isDryLand(e.pos.x, nz, 0.32)) {
          e.pos.z = nz;
          return true;
        }
        return false;
      };

      if (!enteredWorld) {
        e.state = 'patrol';
      } else if (e.staggerTimer <= 0) {
        const squadAlert = e.squadId ? activeSquads.has(e.squadId) : false;

        if (e.state === 'patrol') {
          if (distToPlayer <= e.aggroRange || squadAlert) {
            e.state = 'chase';
          } else {
            e.stateTimer -= dt;
            const pdx = e.patrolTargetX - e.pos.x;
            const pdz = e.patrolTargetZ - e.pos.z;
            const pDist = Math.hypot(pdx, pdz);
            if (e.stateTimer <= 0 || pDist < 1.2) {
              e.stateTimer = 2.4 + Math.random() * 2.5;
              let picked = false;
              for (let a = 0; a < 10; a++) {
                const ang = Math.random() * Math.PI * 2;
                const rad = 4 + Math.random() * 8;
                const tx = e.homeX + Math.cos(ang) * rad;
                const tz = e.homeZ + Math.sin(ang) * rad;
                if (isDryLand(tx, tz, 0.35)) {
                  e.patrolTargetX = tx;
                  e.patrolTargetZ = tz;
                  picked = true;
                  break;
                }
              }
              if (!picked) {
                e.patrolTargetX = e.homeX;
                e.patrolTargetZ = e.homeZ;
              }
            } else {
              const targetYaw = Math.atan2(pdx, pdz);
              e.yaw = targetYaw;
              const walkSpd = e.chaseSpeed * 0.36;
              e.speed = walkSpd;
              const nx = e.pos.x + (pdx / pDist) * walkSpd * dt;
              const nz = e.pos.z + (pdz / pDist) * walkSpd * dt;
              if (!tryStepDry(nx, nz)) {
                e.stateTimer = 0;
                e.speed = 0;
              }
            }
          }
        } else if (e.state === 'chase') {
          if (distToPlayer > e.aggroRange * 1.9 && distFromHome > 44) {
            e.state = 'patrol';
          } else if (distToPlayer <= e.attackRange && e.cooldownTimer <= 0) {
            e.state = 'windup';
            e.stateTimer = e.windupDuration;
            e.speed = 0;
            e.yaw = Math.atan2(dx, dz);
          } else if (distToPlayer > e.attackRange * 0.85) {
            const targetYaw = Math.atan2(dx, dz);
            e.yaw = targetYaw;
            const nx = e.pos.x + (dx / Math.max(0.01, distToPlayer)) * e.chaseSpeed * dt;
            const nz = e.pos.z + (dz / Math.max(0.01, distToPlayer)) * e.chaseSpeed * dt;
            if (tryStepDry(nx, nz)) {
              e.speed = e.chaseSpeed;
            } else {
              e.speed = 0;
            }
          } else {
            e.yaw = Math.atan2(dx, dz);
            e.speed = 0;
          }
        } else if (e.state === 'windup') {
          e.yaw = Math.atan2(dx, dz);
          e.stateTimer -= dt;
          e.glowMat.emissiveIntensity = 2.6 + Math.sin(elapsed * 28) * 0.9;
          if (e.stateTimer <= 0) {
            // Execute strike!
            if (e.category === 'boss') {
              bossShockwavePos = e.pos.clone();
            } else if (e.category === 'mech') {
              mechShockwavePos = e.pos.clone();
            }
            if (distToPlayer <= e.attackRange + 0.85 && !playerDodging) {
              const rawDmg = e.attackDamage;
              const applied = playerGuarding ? Math.max(2, Math.round(rawDmg * 0.25)) : rawDmg;
              playerDamage += applied;
              if (playerGuarding) playerHitBlocked = true;
              if (distToPlayer > 0.01) {
                playerKnockDir.set(dx / distToPlayer, 0, dz / distToPlayer);
              }
            }
            e.state = 'recover';
            e.stateTimer = 0.36;
            e.cooldownTimer = e.attackCooldown;
          }
        } else if (e.state === 'recover') {
          e.stateTimer -= dt;
          e.glowMat.emissiveIntensity = 1.5;
          if (e.stateTimer <= 0) {
            e.state = 'chase';
          }
        }
      }

      // Snap enemy cleanly onto dry terrain surface (never float on water)
      let gy = groundHeightAt(e.pos.x, e.pos.z, mapId);
      if (gy < WATER_LEVEL + 0.15) {
        e.pos.x = e.homeX;
        e.pos.z = e.homeZ;
        gy = groundHeightAt(e.pos.x, e.pos.z, mapId);
      }
      e.pos.y = gy;
      e.group.position.copy(e.pos);
      e.group.rotation.y = e.yaw;

      // Procedural Limb / Wing / Rotor Animation
      if (e.speed > 0.2) {
        e.gaitPhase += dt * e.speed * 2.2;
      } else {
        e.gaitPhase += dt * 1.8;
      }
      const stride = e.speed > 0.2 ? Math.sin(e.gaitPhase) * 0.55 : Math.sin(e.gaitPhase) * 0.05;
      if (e.leftLeg) e.leftLeg.rotation.x = stride;
      if (e.rightLeg) e.rightLeg.rotation.x = -stride;

      if (e.category === 'beast') {
        if (e.backLimbA) e.backLimbA.rotation.x = -stride;
        if (e.backLimbB) e.backLimbB.rotation.x = stride;
        if (e.tailPivot) e.tailPivot.rotation.y = Math.sin(elapsed * 5 + e.gaitPhase) * 0.35;
        if (e.state === 'windup') {
          e.bodyGroup.rotation.x = -0.32;
        } else {
          e.bodyGroup.rotation.x = 0;
        }
      } else if (e.category === 'boss') {
        const wingFlap =
          e.state === 'windup'
            ? 0.55
            : Math.sin(elapsed * 4.2 + e.gaitPhase * 0.3) * 0.34;
        if (e.backLimbA) e.backLimbA.rotation.z = wingFlap;
        if (e.backLimbB) e.backLimbB.rotation.z = -wingFlap;
        if (e.tailPivot) e.tailPivot.rotation.y = Math.sin(elapsed * 3.1) * 0.28;
        if (e.leftArm) {
          e.leftArm.rotation.x = e.state === 'windup' ? -1.45 : -stride * 0.5;
        }
        if (e.rightArm) {
          e.rightArm.rotation.x =
            e.state === 'windup' ? -1.45 : e.state === 'recover' ? 0.65 : stride * 0.5;
        }
      } else {
        if (e.leftArm) e.leftArm.rotation.x = -stride * 0.7;
        if (e.rightArm) {
          e.rightArm.rotation.x =
            e.state === 'windup'
              ? -1.65
              : e.state === 'recover'
              ? 0.75
              : stride * 0.7;
        }
        if (e.rotorMesh) {
          e.rotorMesh.rotation.y = elapsed * (e.state === 'chase' || e.state === 'windup' ? 9.5 : 3.2);
        }
      }
    }

    return {
      playerDamage,
      playerHitBlocked,
      playerKnockDir,
      bossShockwavePos,
      mechShockwavePos,
    };
  };

  const getHudTarget = (playerPos: THREE.Vector3): EnemyHudTarget | null => {
    let best: EnemyEntity | null = null;
    let bestScore = Infinity;
    for (const e of entities) {
      if (e.state === 'dead') continue;
      const dist = Math.hypot(e.pos.x - playerPos.x, e.pos.z - playerPos.z);
      const maxDetect = e.category === 'boss' ? 36 : 20;
      if (dist > maxDetect) continue;
      // Prioritize Boss or injured enemy in range
      const score = e.category === 'boss' ? dist * 0.45 : dist;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) return null;
    return {
      id: best.id,
      category: best.category,
      nameKey: best.nameKey,
      hp: Math.ceil(best.hp),
      maxHp: best.maxHp,
      dist: Math.round(Math.hypot(best.pos.x - playerPos.x, best.pos.z - playerPos.z)),
      isBoss: best.category === 'boss',
    };
  };

  const getMapMarkers = (): EnemyMapMarker[] => {
    const markers: EnemyMapMarker[] = [];
    for (const e of entities) {
      if (e.state === 'dead') continue;
      markers.push({
        id: e.id,
        x: Math.round(e.pos.x * 10) / 10,
        z: Math.round(e.pos.z * 10) / 10,
        category: e.category,
      });
    }
    return markers;
  };

  const dispose = () => {
    for (const g of disposables.geos) g.dispose();
    for (const m of disposables.mats) m.dispose();
    for (const t of disposables.texs) t.dispose();
    scene.remove(root);
  };

  return {
    root,
    checkMeleeHit,
    update,
    getHudTarget,
    getMapMarkers,
    getDefeatedCount: () => defeatedCount,
    dispose,
  };
}
