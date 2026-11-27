import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';
import { PLAYER_PALETTE, PLAYER_PALETTE_HEX, RemotePlayerState } from './multiplayer';
import { WorldMapId } from './types';

interface RemoteAvatarRig {
  id: string;
  name: string;
  colorIdx: number;
  root: THREE.Group;
  pelvis: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  pony: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  weaponPivot: THREE.Group;
  flashlightBulb: THREE.Mesh;
  flashlightCone: THREE.Mesh;
  labelSprite: THREE.Sprite;
  labelTex: THREE.CanvasTexture;
  labelMat: THREE.SpriteMaterial;
  accentMat: THREE.MeshStandardMaterial;
  pos: THREE.Vector3;
  yaw: number;
  walkPhase: number;
  swimPhase: number;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function createNameTagTexture(name: string, colorCss: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.font = '600 24px "Plus Jakarta Sans", system-ui, sans-serif';
    const textWidth = Math.min(210, Math.ceil(ctx.measureText(name).width));
    const pillW = Math.max(88, textWidth + 36);
    const pillH = 38;
    const x = (canvas.width - pillW) * 0.5;
    const y = (canvas.height - pillH) * 0.5;

    ctx.fillStyle = 'rgba(10, 14, 20, 0.86)';
    drawRoundedRect(ctx, x, y, pillW, pillH, 10);
    ctx.fill();

    ctx.strokeStyle = colorCss;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x + 15, y + pillH * 0.5, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = colorCss;
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, x + 26, y + pillH * 0.5 + 1, pillW - 36);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function shortestAngleLerp(current: number, target: number, t: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

export class RemotePlayersSystem {
  private scene: THREE.Scene;
  private textures: ProceduralTextureSet;
  private avatars = new Map<string, RemoteAvatarRig>();

  private sharedSkinMat: THREE.MeshStandardMaterial;
  private sharedHairMat: THREE.MeshStandardMaterial;
  private sharedTunicMat: THREE.MeshStandardMaterial;
  private sharedPantsMat: THREE.MeshStandardMaterial;
  private sharedBootMat: THREE.MeshStandardMaterial;
  private sharedMetalMat: THREE.MeshStandardMaterial;
  private sharedBulbGeo: THREE.SphereGeometry;
  private sharedConeGeo: THREE.ConeGeometry;

  constructor(scene: THREE.Scene, textures: ProceduralTextureSet) {
    this.scene = scene;
    this.textures = textures;

    this.sharedSkinMat = new THREE.MeshStandardMaterial({
      color: 0xeebba2,
      roughness: 0.48,
      metalness: 0.02,
    });
    this.sharedHairMat = new THREE.MeshStandardMaterial({
      map: textures.hairMap,
      color: 0xffffff,
      roughness: 0.45,
      metalness: 0.05,
    });
    this.sharedTunicMat = new THREE.MeshStandardMaterial({
      map: textures.fabricMap,
      color: 0xe6ddd0,
      roughness: 0.8,
      metalness: 0.02,
    });
    this.sharedPantsMat = new THREE.MeshStandardMaterial({
      map: textures.fabricMap,
      color: 0x2d2926,
      roughness: 0.84,
      metalness: 0.03,
    });
    this.sharedBootMat = new THREE.MeshStandardMaterial({
      color: 0x291a12,
      roughness: 0.58,
      metalness: 0.08,
    });
    this.sharedMetalMat = new THREE.MeshStandardMaterial({
      color: 0x9ca6b0,
      roughness: 0.25,
      metalness: 0.88,
    });
    this.sharedBulbGeo = new THREE.SphereGeometry(0.038, 8, 8);

    this.sharedConeGeo = new THREE.ConeGeometry(1.9, 9.5, 12, 1, true);
    this.sharedConeGeo.translate(0, -4.75, 0);
    this.sharedConeGeo.rotateX(-Math.PI * 0.5);
  }

  private createAvatar(player: RemotePlayerState): RemoteAvatarRig {
    const colorIdx = ((player.colorIdx % PLAYER_PALETTE.length) + PLAYER_PALETTE.length) % PLAYER_PALETTE.length;
    const colorCss = PLAYER_PALETTE[colorIdx];
    const accentHex = PLAYER_PALETTE_HEX[colorIdx];

    const accentMat = new THREE.MeshStandardMaterial({
      map: this.textures.fabricMap,
      color: accentHex,
      roughness: 0.68,
      metalness: 0.05,
    });

    const root = new THREE.Group();
    const pelvis = new THREE.Group();
    pelvis.position.y = 0.9;
    root.add(pelvis);

    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.148, 0.18, 12), this.sharedPantsMat);
    hips.scale.set(1.05, 1, 0.74);
    hips.castShadow = true;
    pelvis.add(hips);

    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.132, 0.14, 0.06, 12), accentMat);
    belt.scale.set(1.06, 1, 0.78);
    belt.position.y = 0.06;
    pelvis.add(belt);

    const torso = new THREE.Group();
    torso.position.y = 0.08;
    pelvis.add(torso);

    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.115, 0.44, 14), accentMat);
    chest.scale.set(1.05, 1, 0.72);
    chest.position.y = 0.22;
    chest.castShadow = true;
    torso.add(chest);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.032, 8, 16), accentMat);
    collar.rotation.x = Math.PI * 0.5 + 0.1;
    collar.position.set(0, 0.44, 0.005);
    torso.add(collar);

    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.12), this.sharedBootMat);
    backpack.position.set(0, 0.22, -0.145);
    backpack.castShadow = true;
    torso.add(backpack);

    const head = new THREE.Group();
    head.position.y = 0.47;
    torso.add(head);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.048, 0.09, 10), this.sharedSkinMat);
    neck.position.y = 0.04;
    head.add(neck);

    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), this.sharedSkinMat);
    cranium.scale.set(0.95, 1.08, 1.0);
    cranium.position.y = 0.18;
    cranium.castShadow = true;
    head.add(cranium);

    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.116, 14, 12), this.sharedHairMat);
    hairCap.scale.set(1.0, 1.02, 1.04);
    hairCap.position.set(0, 0.195, -0.015);
    hairCap.castShadow = true;
    head.add(hairCap);

    const pony = new THREE.Group();
    pony.position.set(0, 0.2, -0.115);
    head.add(pony);
    const ponyMesh = new THREE.Mesh(new THREE.ConeGeometry(0.046, 0.34, 10), this.sharedHairMat);
    ponyMesh.rotation.x = Math.PI - 0.24;
    ponyMesh.position.set(0, -0.14, -0.04);
    ponyMesh.castShadow = true;
    pony.add(ponyMesh);

    const buildArm = (side: number) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.185, 0.4, 0);
      torso.add(shoulder);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.034, 0.25, 10), this.sharedTunicMat);
      sleeve.position.y = -0.12;
      sleeve.castShadow = true;
      shoulder.add(sleeve);
      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.026, 0.24, 10), this.sharedSkinMat);
      forearm.position.y = -0.35;
      forearm.castShadow = true;
      shoulder.add(forearm);
      return shoulder;
    };

    const leftArm = buildArm(-1);
    const rightArm = buildArm(1);

    const weaponPivot = new THREE.Group();
    weaponPivot.position.set(0, -0.46, 0.04);
    rightArm.add(weaponPivot);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.04, 0.48), this.sharedMetalMat);
    blade.position.set(0, 0, 0.26);
    blade.castShadow = true;
    weaponPivot.add(blade);

    const buildLeg = (side: number) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.09, -0.04, 0);
      pelvis.add(hip);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.052, 0.42, 10), this.sharedPantsMat);
      thigh.position.y = -0.21;
      thigh.castShadow = true;
      hip.add(thigh);
      const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.042, 0.42, 10), this.sharedBootMat);
      boot.position.y = -0.62;
      boot.castShadow = true;
      hip.add(boot);
      return hip;
    };

    const leftLeg = buildLeg(-1);
    const rightLeg = buildLeg(1);

    // Lightweight volumetric flashlight cone & emitter bulb (zero dynamic SpotLight shader recompiles)
    const bulbMat = new THREE.MeshBasicMaterial({
      color: 0xfff3d6,
    });
    const flashlightBulb = new THREE.Mesh(this.sharedBulbGeo, bulbMat);
    flashlightBulb.position.set(-0.2, 1.25, 0.22);
    flashlightBulb.visible = false;
    root.add(flashlightBulb);

    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffe8c2,
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const flashlightCone = new THREE.Mesh(this.sharedConeGeo, coneMat);
    flashlightCone.position.set(-0.2, 1.25, 0.22);
    flashlightCone.rotation.x = 0.08;
    flashlightCone.visible = false;
    root.add(flashlightCone);

    const labelTex = createNameTagTexture(player.name, colorCss);
    const labelMat = new THREE.SpriteMaterial({
      map: labelTex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const labelSprite = new THREE.Sprite(labelMat);
    labelSprite.position.set(0, 2.15, 0);
    labelSprite.scale.set(1.55, 0.39, 1);
    root.add(labelSprite);

    const pos = new THREE.Vector3(player.x, player.y, player.z);
    root.position.copy(pos);
    root.rotation.y = player.yaw + Math.PI;
    this.scene.add(root);

    return {
      id: player.id,
      name: player.name,
      colorIdx,
      root,
      pelvis,
      torso,
      head,
      pony,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      weaponPivot,
      flashlightBulb,
      flashlightCone,
      labelSprite,
      labelTex,
      labelMat,
      accentMat,
      pos,
      yaw: player.yaw,
      walkPhase: 0,
      swimPhase: 0,
    };
  }

  private removeAvatar(id: string): void {
    const rig = this.avatars.get(id);
    if (!rig) return;
    this.scene.remove(rig.root);

    rig.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (obj.geometry !== this.sharedBulbGeo && obj.geometry !== this.sharedConeGeo) {
          obj.geometry.dispose();
        }
      }
    });
    (rig.flashlightBulb.material as THREE.Material).dispose();
    (rig.flashlightCone.material as THREE.Material).dispose();
    rig.labelTex.dispose();
    rig.labelMat.dispose();
    rig.accentMat.dispose();
    this.avatars.delete(id);
  }

  public update(dt: number, elapsed: number, activeMapId: WorldMapId, players: RemotePlayerState[]): void {
    const sameMapIds = new Set<string>();

    for (const p of players) {
      if (p.mapId !== activeMapId) continue;
      sameMapIds.add(p.id);

      let rig = this.avatars.get(p.id);
      if (!rig) {
        rig = this.createAvatar(p);
        this.avatars.set(p.id, rig);
      } else if (rig.name !== p.name) {
        rig.name = p.name;
        const colorCss = PLAYER_PALETTE[rig.colorIdx] ?? PLAYER_PALETTE[0];
        rig.labelTex.dispose();
        rig.labelTex = createNameTagTexture(p.name, colorCss);
        rig.labelMat.map = rig.labelTex;
        rig.labelMat.needsUpdate = true;
      }

      const lerpAlpha = 1 - Math.exp(-14 * dt);
      rig.pos.x = THREE.MathUtils.lerp(rig.pos.x, p.x, lerpAlpha);
      rig.pos.y = THREE.MathUtils.lerp(rig.pos.y, p.y, lerpAlpha);
      rig.pos.z = THREE.MathUtils.lerp(rig.pos.z, p.z, lerpAlpha);
      rig.yaw = shortestAngleLerp(rig.yaw, p.yaw, lerpAlpha);

      rig.root.position.copy(rig.pos);
      rig.root.rotation.y = rig.yaw + Math.PI;

      // Procedural motion animation
      if (p.swim) {
        rig.swimPhase += dt * (p.sprint ? 7.2 : 4.6);
        rig.pelvis.position.y = 0.75 + Math.sin(rig.swimPhase * 2) * 0.04;
        rig.torso.rotation.x = 1.08;
        rig.head.rotation.x = -0.82;
        rig.leftArm.rotation.x = -1.2 + Math.sin(rig.swimPhase) * 0.85;
        rig.rightArm.rotation.x = -1.2 - Math.sin(rig.swimPhase) * 0.85;
        rig.leftLeg.rotation.x = Math.sin(rig.swimPhase * 2) * 0.45;
        rig.rightLeg.rotation.x = -Math.sin(rig.swimPhase * 2) * 0.45;
        rig.pony.rotation.x = 0.4 + Math.sin(rig.swimPhase) * 0.14;
      } else {
        const moveFactor = THREE.MathUtils.clamp(p.speed / 6.5, 0, 1);
        rig.walkPhase += dt * (2.6 + p.speed * 1.45);
        const swing = Math.sin(rig.walkPhase) * 0.65 * moveFactor;

        rig.pelvis.position.y = (p.crouch ? 0.68 : 0.9) + Math.abs(Math.sin(rig.walkPhase)) * 0.04 * moveFactor;
        rig.torso.rotation.x = p.crouch ? 0.28 : p.sprint ? 0.16 * moveFactor : 0.04 * moveFactor;
        rig.head.rotation.x = -rig.torso.rotation.x * 0.7 + Math.sin(elapsed * 1.9) * 0.03;

        rig.leftLeg.rotation.x = swing;
        rig.rightLeg.rotation.x = -swing;
        rig.leftArm.rotation.x = -swing * 0.85;

        if (p.attackTimer > 0) {
          const swingWave = Math.sin((1 - p.attackTimer) * Math.PI * 2.2);
          rig.rightArm.rotation.x = -1.1 + swingWave * 0.95;
          rig.rightArm.rotation.z = p.heavy ? -0.45 : -0.25;
        } else if (p.guard) {
          rig.rightArm.rotation.x = -0.95;
          rig.rightArm.rotation.z = 0.35;
        } else {
          rig.rightArm.rotation.x = swing * 0.85;
          rig.rightArm.rotation.z = 0;
        }

        rig.pony.rotation.x = 0.25 + moveFactor * 0.45 + Math.sin(rig.walkPhase * 2) * 0.12 * moveFactor;
      }

      // Lightweight flashlight sync
      const lampY = p.crouch ? 0.95 : 1.25;
      rig.flashlightBulb.visible = p.flashlight;
      rig.flashlightCone.visible = p.flashlight;
      rig.flashlightBulb.position.y = lampY;
      rig.flashlightCone.position.y = lampY;
    }

    for (const id of Array.from(this.avatars.keys())) {
      if (!sameMapIds.has(id)) {
        this.removeAvatar(id);
      }
    }
  }

  public dispose(): void {
    for (const id of Array.from(this.avatars.keys())) {
      this.removeAvatar(id);
    }
    this.sharedSkinMat.dispose();
    this.sharedHairMat.dispose();
    this.sharedTunicMat.dispose();
    this.sharedPantsMat.dispose();
    this.sharedBootMat.dispose();
    this.sharedMetalMat.dispose();
    this.sharedBulbGeo.dispose();
    this.sharedConeGeo.dispose();
  }
}
