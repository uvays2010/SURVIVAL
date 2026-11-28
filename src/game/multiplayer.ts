import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  onAuthStateChanged,
  OperationType,
  signInWithGoogle,
  signOutFirebase,
  type User,
} from '../firebase';
import { getWorldMapDef, WeatherMode, WorldMapId } from './types';
import type { EnemyAiState, EnemyNetItem } from './enemies';

export interface RemotePlayerState {
  id: string;
  roomId: string;
  name: string;
  colorIdx: number;
  mapId: WorldMapId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  crouch: boolean;
  sprint: boolean;
  swim: boolean;
  flashlight: boolean;
  attackCombo: number;
  attackTimer: number;
  heavy: boolean;
  dodge: boolean;
  guard: boolean;
  lastUpdated: number;
  receivedAt?: number;
}

export interface NetLocalPlayerState {
  mapId: WorldMapId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  crouch: boolean;
  sprint: boolean;
  swim: boolean;
  flashlight: boolean;
  attackCombo: number;
  attackTimer: number;
  heavy: boolean;
  dodge: boolean;
  guard: boolean;
}

export interface MultiplayerChatMessage {
  id: string;
  playerId: string;
  name: string;
  colorIdx: number;
  text: string;
  ts: number;
}

export interface RoomWorldState {
  mapId: WorldMapId;
  weatherMode: WeatherMode;
  timeAnchorHours: number;
  timeAnchorMs: number;
  timePaused: boolean;
  campfireLit: boolean;
  hostSessionId: string;
  enemies: EnemyNetItem[];
  serverNowMs: number;
}

export interface RoomEnemyHitEvent {
  id: string;
  mapId: WorldMapId;
  enemyId: string;
  attackerId: string;
  damage: number;
  dirX: number;
  dirZ: number;
  heavy: boolean;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type SyncTransport = 'cloud' | 'local';

export const PLAYER_PALETTE = [
  '#f59e0b', // Amber
  '#38bdf8', // Sky
  '#34d399', // Emerald
  '#f472b6', // Rose
  '#a78bfa', // Violet
  '#fb7185', // Coral
  '#facc15', // Gold
  '#2dd4bf', // Teal
] as const;

export const PLAYER_PALETTE_HEX = [
  0xf59e0b,
  0x38bdf8,
  0x34d399,
  0xf472b6,
  0xa78bfa,
  0xfb7185,
  0xfacc15,
  0x2dd4bf,
] as const;

const VALID_WORLD_MAP_IDS: ReadonlySet<WorldMapId> = new Set<WorldMapId>([
  'lost_valley',
  'alpine_glacier',
  'emerald_archipelago',
  'saffron_canyon',
  'misty_wetlands',
  'crimson_caldera',
  'twin_fjords',
  'highland_meadows',
]);

export const MP_NAME_STORAGE_KEY = 'lost_world_mp_name';
const MP_SESSION_STORAGE_KEY = 'lost_world_mp_session_id';

function clampNum(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function normalizeYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  let y = yaw % (Math.PI * 2);
  if (y > Math.PI) y -= Math.PI * 2;
  if (y < -Math.PI) y += Math.PI * 2;
  return round2(clampNum(y, -10, 10));
}

function sanitizeRoomId(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
  return cleaned.length >= 2 ? cleaned : 'global';
}

function sanitizePlayerName(raw: string): string {
  const cleaned = raw.trim().slice(0, 18);
  return cleaned.length >= 1 ? cleaned : 'Sayohatchi';
}

function sanitizeMapId(mapId: WorldMapId): WorldMapId {
  return VALID_WORLD_MAP_IDS.has(mapId) ? mapId : 'lost_valley';
}

function getOrCreateSessionId(): string {
  if (typeof window !== 'undefined') {
    try {
      const existing = window.sessionStorage.getItem(MP_SESSION_STORAGE_KEY);
      if (existing && /^[a-zA-Z0-9_-]{8,48}$/.test(existing)) {
        return existing;
      }
      const next = `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      window.sessionStorage.setItem(MP_SESSION_STORAGE_KEY, next);
      return next;
    } catch {
      // Ignore sessionStorage restrictions
    }
  }
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function hashColorIdx(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % PLAYER_PALETTE.length;
}

export function getInitialRoomFromUrl(): string {
  if (typeof window === 'undefined') return 'global';
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('room') || '';
    return sanitizeRoomId(raw);
  } catch {
    return 'global';
  }
}

export function getInitialPlayerName(): string {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(MP_NAME_STORAGE_KEY);
      if (saved && saved.trim().length > 0) {
        return saved.trim().slice(0, 18);
      }
    } catch {
      // Ignore storage read errors
    }
  }
  const suffix = Math.floor(100 + Math.random() * 900);
  return `Sayohatchi-${suffix}`;
}

export function buildShareableRoomUrl(roomId: string): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  if (url.hostname.startsWith('ais-dev-')) {
    url.hostname = url.hostname.replace(/^ais-dev-/, 'ais-pre-');
  }
  url.searchParams.set('room', sanitizeRoomId(roomId));
  return url.toString();
}

const VALID_WEATHER_MODES: ReadonlySet<WeatherMode> = new Set<WeatherMode>([
  'DYNAMIC',
  'CLEAR',
  'FOGGY',
  'RAIN',
  'STORM',
  'SNOW',
]);

const VALID_ENEMY_STATES: ReadonlySet<EnemyAiState> = new Set<EnemyAiState>([
  'patrol',
  'chase',
  'windup',
  'recover',
  'dead',
]);

function sanitizeWeatherMode(raw: unknown): WeatherMode {
  return typeof raw === 'string' && VALID_WEATHER_MODES.has(raw as WeatherMode)
    ? (raw as WeatherMode)
    : 'DYNAMIC';
}

function sanitizeEnemyItems(raw: unknown): EnemyNetItem[] {
  if (!Array.isArray(raw)) return [];
  const out: EnemyNetItem[] = [];
  for (let i = 0; i < Math.min(24, raw.length); i++) {
    const item = raw[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id.slice(0, 48) : '';
    if (!id) continue;
    const st = typeof item.st === 'string' && VALID_ENEMY_STATES.has(item.st as EnemyAiState)
      ? (item.st as EnemyAiState)
      : 'patrol';
    out.push({
      id,
      x: round2(clampNum(Number(item.x), -499, 499)),
      z: round2(clampNum(Number(item.z), -499, 499)),
      yaw: normalizeYaw(Number(item.yaw)),
      hp: Math.round(clampNum(Number(item.hp), 0, 2000)),
      st,
      sp: round2(clampNum(Number(item.sp), 0, 39)),
      tm: round2(clampNum(Number(item.tm), 0, 120)),
    });
  }
  return out;
}

export interface MultiplayerCallbacks {
  onStatusChange: (
    status: ConnectionStatus,
    roomId: string,
    selfId: string | null,
    transport: SyncTransport
  ) => void;
  onAuthChange?: (user: { uid: string; displayName: string | null } | null) => void;
  onPlayersFrame?: (players: RemotePlayerState[]) => void;
  onPlayersChange: (players: RemotePlayerState[]) => void;
  onChatMessagesReplace?: (messages: MultiplayerChatMessage[]) => void;
  onChatMessage: (msg: MultiplayerChatMessage) => void;
  onWorldStateUpdate?: (world: RoomWorldState) => void;
  onEnemyHitReceived?: (hit: RoomEnemyHitEvent) => void;
  onServerClockOffset?: (offsetMs: number) => void;
  onFirestoreError?: (err: Error) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private disposed = false;
  private mode: 'cloud' | 'ws' | 'http' = 'ws';
  private wsConnectTimeout: number | null = null;
  private reconnectTimer: number | null = null;
  private httpSyncTimer: number | null = null;
  private httpSyncInFlight = false;
  private reconnectAttempt = 0;

  // Firebase Auth & Firestore state
  private authUnsub: Unsubscribe | null = null;
  private playersUnsub: Unsubscribe | null = null;
  private messagesUnsub: Unsubscribe | null = null;
  private worldUnsub: Unsubscribe | null = null;
  private hitsUnsub: Unsubscribe | null = null;
  private cloudHeartbeatTimer: number | null = null;
  private cloudPruneTimer: number | null = null;
  private currentUser: User | null = null;
  private cloudSessionId: string;
  private cloudColorIdx: number;
  private cloudPlayerDocCreated = false;
  private cloudJoinSeq = 0;
  private cloudWriteInFlight = false;
  private cloudDirtyPending = false;
  private serverTimeOffsetMs = 0;

  // Room World (Weather/Time/Campfire + Co-op Enemies) state
  private activeMapId: WorldMapId;
  private worldDocExists = false;
  private worldWriteInFlight = false;
  private pendingEnemiesSnapshot: { mapId: WorldMapId; enemies: EnemyNetItem[] } | null = null;
  private lastEnemiesSentAt = 0;
  private localWorlds = new Map<WorldMapId, RoomWorldState>();
  private processedHitIds = new Set<string>();
  private lastHitTs = 0;
  private latestEnv: {
    weatherMode: WeatherMode;
    timeAnchorHours: number;
    timeAnchorMs: number;
    timePaused: boolean;
    campfireLit: boolean;
  };

  private roomId: string;
  private playerName: string;
  private selfId: string | null = null;
  private players = new Map<string, RemotePlayerState>();
  private latestLocalState: NetLocalPlayerState;
  private callbacks: MultiplayerCallbacks;
  private lastSentAt = 0;
  private lastSentSignature = '';
  private lastSentSpeed = 0;
  private lastUiEmitAt = 0;
  private lastChatTs = 0;

  constructor(
    initialRoomId: string,
    initialName: string,
    initialState: NetLocalPlayerState,
    callbacks: MultiplayerCallbacks
  ) {
    this.roomId = sanitizeRoomId(initialRoomId);
    this.playerName = sanitizePlayerName(initialName);
    this.latestLocalState = { ...initialState };
    this.activeMapId = sanitizeMapId(initialState.mapId);
    const mapDef = getWorldMapDef(this.activeMapId);
    this.latestEnv = {
      weatherMode: mapDef.defaultWeather,
      timeAnchorHours: mapDef.defaultTimeHours,
      timeAnchorMs: Date.now(),
      timePaused: false,
      campfireLit: true,
    };
    this.callbacks = callbacks;
    this.cloudSessionId = getOrCreateSessionId();
    this.cloudColorIdx = hashColorIdx(this.cloudSessionId);

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.handlePageHide);
    }

    // Monitor Firebase Auth; verified users sync globally across PC, Phone & PWA via Firestore
    this.authUnsub = onAuthStateChanged(auth, (user) => {
      if (this.disposed) return;
      const verified = user && user.emailVerified ? user : null;
      this.currentUser = verified;
      this.callbacks.onAuthChange?.(
        verified ? { uid: verified.uid, displayName: verified.displayName } : null
      );

      if (verified) {
        // Apply Google displayName automatically if player still has the auto-generated placeholder name
        if (verified.displayName) {
          try {
            const savedCustom = localStorage.getItem(MP_NAME_STORAGE_KEY);
            if (!savedCustom && this.playerName.startsWith('Sayohatchi-')) {
              this.playerName = sanitizePlayerName(verified.displayName);
            }
          } catch {
            // Ignore storage errors
          }
        }
        void this.activateCloudFirestore();
      } else {
        this.teardownCloud();
        this.connectWebSocket();
      }
    });
  }

  public async signInCloud(): Promise<void> {
    await signInWithGoogle();
  }

  public async signOutCloud(): Promise<void> {
    if (this.mode === 'cloud') {
      await this.deleteOwnCloudPlayerDoc(this.roomId);
    }
    this.teardownCloud();
    await signOutFirebase();
  }

  private handlePageHide = (): void => {
    if (this.mode === 'cloud' && this.currentUser && this.cloudPlayerDocCreated) {
      void deleteDoc(doc(db, 'rooms', this.roomId, 'players', this.cloudSessionId)).catch(() => {});
      return;
    }
    if (this.mode === 'http' && this.selfId && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(
          '/api/mp/leave',
          JSON.stringify({ roomId: this.roomId, playerId: this.selfId })
        );
      } catch {
        // Ignore beacon errors
      }
    }
  };

  private teardownLocalSockets(): void {
    this.clearWsTimers();
    this.clearHttpTimer();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
  }

  private teardownCloud(): void {
    this.cloudJoinSeq++;
    this.cloudPlayerDocCreated = false;
    this.worldDocExists = false;
    this.worldWriteInFlight = false;
    this.pendingEnemiesSnapshot = null;
    this.processedHitIds.clear();
    if (this.playersUnsub) {
      this.playersUnsub();
      this.playersUnsub = null;
    }
    if (this.messagesUnsub) {
      this.messagesUnsub();
      this.messagesUnsub = null;
    }
    if (this.worldUnsub) {
      this.worldUnsub();
      this.worldUnsub = null;
    }
    if (this.hitsUnsub) {
      this.hitsUnsub();
      this.hitsUnsub = null;
    }
    if (this.cloudHeartbeatTimer !== null) {
      window.clearInterval(this.cloudHeartbeatTimer);
      this.cloudHeartbeatTimer = null;
    }
    if (this.cloudPruneTimer !== null) {
      window.clearInterval(this.cloudPruneTimer);
      this.cloudPruneTimer = null;
    }
  }

  private buildCloudPlayerPayload(user: User) {
    const s = this.latestLocalState;
    return {
      id: this.cloudSessionId,
      ownerUid: user.uid,
      roomId: this.roomId,
      name: sanitizePlayerName(this.playerName),
      colorIdx: this.cloudColorIdx,
      mapId: sanitizeMapId(s.mapId),
      x: round2(clampNum(s.x, -499, 499)),
      y: round2(clampNum(s.y, -99, 499)),
      z: round2(clampNum(s.z, -499, 499)),
      yaw: normalizeYaw(s.yaw),
      speed: round2(clampNum(s.speed, 0, 39)),
      crouch: Boolean(s.crouch),
      sprint: Boolean(s.sprint),
      swim: Boolean(s.swim),
      flashlight: Boolean(s.flashlight),
      attackCombo: Math.round(clampNum(s.attackCombo, 0, 5)),
      attackTimer: round2(clampNum(s.attackTimer, 0, 5)),
      heavy: Boolean(s.heavy),
      dodge: Boolean(s.dodge),
      guard: Boolean(s.guard),
      updatedAt: serverTimestamp(),
    };
  }

  private buildCloudPlayerUpdatePayload() {
    const s = this.latestLocalState;
    return {
      name: sanitizePlayerName(this.playerName),
      colorIdx: this.cloudColorIdx,
      mapId: sanitizeMapId(s.mapId),
      x: round2(clampNum(s.x, -499, 499)),
      y: round2(clampNum(s.y, -99, 499)),
      z: round2(clampNum(s.z, -499, 499)),
      yaw: normalizeYaw(s.yaw),
      speed: round2(clampNum(s.speed, 0, 39)),
      crouch: Boolean(s.crouch),
      sprint: Boolean(s.sprint),
      swim: Boolean(s.swim),
      flashlight: Boolean(s.flashlight),
      attackCombo: Math.round(clampNum(s.attackCombo, 0, 5)),
      attackTimer: round2(clampNum(s.attackTimer, 0, 5)),
      heavy: Boolean(s.heavy),
      dodge: Boolean(s.dodge),
      guard: Boolean(s.guard),
      updatedAt: serverTimestamp(),
    };
  }

  private async deleteOwnCloudPlayerDoc(targetRoomId: string): Promise<void> {
    if (!this.cloudPlayerDocCreated) return;
    this.cloudPlayerDocCreated = false;
    const playerPath = `rooms/${targetRoomId}/players/${this.cloudSessionId}`;
    try {
      await deleteDoc(doc(db, 'rooms', targetRoomId, 'players', this.cloudSessionId));
    } catch {
      // Best effort cleanup on exit/switch
      void playerPath;
    }
  }

  private reportCloudError(error: unknown, op: OperationType, path: string): void {
    try {
      handleFirestoreError(error, op, path);
    } catch (wrapped) {
      if (wrapped instanceof Error) {
        this.callbacks.onFirestoreError?.(wrapped);
      }
    }
  }

  private async activateCloudFirestore(): Promise<void> {
    const user = this.currentUser;
    if (this.disposed || !user) return;

    this.teardownLocalSockets();
    this.teardownCloud();

    const seq = ++this.cloudJoinSeq;
    const activeRoom = this.roomId;
    this.mode = 'cloud';
    this.selfId = this.cloudSessionId;
    this.players.clear();
    this.emitPlayers(true);
    this.callbacks.onStatusChange('connecting', activeRoom, this.selfId, 'cloud');

    // 1. Ensure parent /rooms/{roomId} exists (Master Gate requirement)
    const roomPath = `rooms/${activeRoom}`;
    const roomRef = doc(db, 'rooms', activeRoom);
    try {
      const snap = await getDoc(roomRef);
      if (this.disposed || seq !== this.cloudJoinSeq) return;
      if (!snap.exists()) {
        try {
          await setDoc(roomRef, {
            roomId: activeRoom,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (createErr) {
          // If another client created the exact same room simultaneously, re-verify existence
          const retrySnap = await getDoc(roomRef);
          if (!retrySnap.exists()) {
            this.reportCloudError(createErr, OperationType.CREATE, roomPath);
            this.callbacks.onStatusChange('reconnecting', activeRoom, this.selfId, 'cloud');
            return;
          }
        }
      }
    } catch (error) {
      this.reportCloudError(error, OperationType.GET, roomPath);
      this.callbacks.onStatusChange('reconnecting', activeRoom, this.selfId, 'cloud');
      return;
    }

    if (this.disposed || seq !== this.cloudJoinSeq) return;

    // 2. Register own session document in /rooms/{roomId}/players/{sessionId}
    const playerPath = `rooms/${activeRoom}/players/${this.cloudSessionId}`;
    const playerRef = doc(db, 'rooms', activeRoom, 'players', this.cloudSessionId);
    try {
      await setDoc(playerRef, this.buildCloudPlayerPayload(user));
      this.cloudPlayerDocCreated = true;
    } catch (error) {
      this.reportCloudError(error, OperationType.CREATE, playerPath);
      this.callbacks.onStatusChange('reconnecting', activeRoom, this.selfId, 'cloud');
      return;
    }

    if (this.disposed || seq !== this.cloudJoinSeq) return;

    // 3. Subscribe to live players list inside this room (where roomId == activeRoom satisfies allow list)
    const playersCollectionPath = `rooms/${activeRoom}/players`;
    const playersQ = query(
      collection(db, 'rooms', activeRoom, 'players'),
      where('roomId', '==', activeRoom)
    );
    this.playersUnsub = onSnapshot(
      playersQ,
      (snapshot) => {
        if (this.disposed || seq !== this.cloudJoinSeq) return;
        const localNow = Date.now();
        const perfNow = performance.now();
        const changedRemoteIds = new Set<string>();
        let anyRemoteChanged = false;

        for (const change of snapshot.docChanges()) {
          if (change.doc.id === this.cloudSessionId) continue;
          anyRemoteChanged = true;
          if (change.type === 'added' || change.type === 'modified') {
            changedRemoteIds.add(change.doc.id);
          }
        }

        snapshot.forEach((docSnap) => {
          if (docSnap.id === this.cloudSessionId) {
            const selfData = docSnap.data() as Record<string, unknown>;
            const selfTs = selfData.updatedAt as Timestamp | null | undefined;
            if (selfTs && typeof selfTs.toMillis === 'function' && !docSnap.metadata.hasPendingWrites) {
              this.serverTimeOffsetMs = selfTs.toMillis() - localNow;
              this.callbacks.onServerClockOffset?.(this.serverTimeOffsetMs);
            }
          }
        });

        // Skip rebuilding remote players if only our own local write echoed back
        if (!anyRemoteChanged && this.players.size > 0) {
          return;
        }

        const now = localNow + this.serverTimeOffsetMs;
        const prevMap = new Map(this.players);
        const prevIds = new Set(prevMap.keys());
        const nextIds = new Set<string>();
        let structureChanged = false;

        this.players.clear();
        snapshot.forEach((docSnap) => {
          if (docSnap.id === this.cloudSessionId) return;
          const d = docSnap.data() as Record<string, unknown>;
          const tsObj = d.updatedAt as Timestamp | null | undefined;
          const updatedMs =
            tsObj && typeof tsObj.toMillis === 'function' ? tsObj.toMillis() : now;
          if (now - updatedMs > 60000) return;

          const id = typeof d.id === 'string' ? d.id : docSnap.id;
          const prevPlayer = prevMap.get(id);
          const packetChanged = changedRemoteIds.has(docSnap.id) || !prevPlayer;

          const rp: RemotePlayerState = {
            id,
            roomId: activeRoom,
            name: typeof d.name === 'string' ? d.name : 'Sayohatchi',
            colorIdx: typeof d.colorIdx === 'number' ? d.colorIdx : 0,
            mapId: sanitizeMapId(d.mapId as WorldMapId),
            x: typeof d.x === 'number' ? d.x : 0,
            y: typeof d.y === 'number' ? d.y : 3,
            z: typeof d.z === 'number' ? d.z : 0,
            yaw: typeof d.yaw === 'number' ? d.yaw : 0,
            speed: typeof d.speed === 'number' ? d.speed : 0,
            crouch: Boolean(d.crouch),
            sprint: Boolean(d.sprint),
            swim: Boolean(d.swim),
            flashlight: Boolean(d.flashlight),
            attackCombo: typeof d.attackCombo === 'number' ? d.attackCombo : 0,
            attackTimer: typeof d.attackTimer === 'number' ? d.attackTimer : 0,
            heavy: Boolean(d.heavy),
            dodge: Boolean(d.dodge),
            guard: Boolean(d.guard),
            lastUpdated: updatedMs,
            receivedAt: packetChanged ? perfNow : prevPlayer?.receivedAt ?? perfNow,
          };

          if (!prevPlayer || prevPlayer.mapId !== rp.mapId || prevPlayer.name !== rp.name) {
            structureChanged = true;
          }
          nextIds.add(rp.id);
          this.players.set(rp.id, rp);
        });

        for (const oldId of prevIds) {
          if (!nextIds.has(oldId)) structureChanged = true;
        }

        this.emitPlayers(structureChanged);
      },
      (error) => {
        this.reportCloudError(error, OperationType.LIST, playersCollectionPath);
        this.callbacks.onStatusChange('reconnecting', activeRoom, this.selfId, 'cloud');
      }
    );

    // 4. Subscribe to live room chat messages (client-side sort avoids composite index requirement)
    const messagesCollectionPath = `rooms/${activeRoom}/messages`;
    const messagesQ = query(
      collection(db, 'rooms', activeRoom, 'messages'),
      where('roomId', '==', activeRoom)
    );
    this.messagesUnsub = onSnapshot(
      messagesQ,
      (snapshot) => {
        if (this.disposed || seq !== this.cloudJoinSeq) return;
        const list: MultiplayerChatMessage[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data() as Record<string, unknown>;
          const tsObj = d.createdAt as Timestamp | null | undefined;
          const tsMs =
            tsObj && typeof tsObj.toMillis === 'function' ? tsObj.toMillis() : Date.now();
          list.push({
            id: typeof d.id === 'string' ? d.id : docSnap.id,
            playerId: typeof d.playerId === 'string' ? d.playerId : '',
            name: typeof d.name === 'string' ? d.name : 'Sayohatchi',
            colorIdx: typeof d.colorIdx === 'number' ? d.colorIdx : 0,
            text: typeof d.text === 'string' ? d.text : '',
            ts: tsMs,
          });
        });
        list.sort((a, b) => a.ts - b.ts);
        const recent = list.slice(-50);
        if (this.callbacks.onChatMessagesReplace) {
          this.callbacks.onChatMessagesReplace(recent);
        } else {
          for (const m of recent) {
            this.callbacks.onChatMessage(m);
          }
        }
      },
      (error) => {
        this.reportCloudError(error, OperationType.LIST, messagesCollectionPath);
      }
    );

    // 4B. Subscribe to shared room world state (weather, time, campfire & enemies) for activeMapId
    this.subscribeCloudWorld(activeRoom, this.activeMapId, seq);

    // 4C. Subscribe to co-op guest enemy hits inside this room
    this.subscribeCloudHits(activeRoom, seq);

    // 5. Periodic heartbeat + local stale player pruner
    this.cloudHeartbeatTimer = window.setInterval(() => {
      void this.flushCloudState(true);
    }, 6000);

    this.cloudPruneTimer = window.setInterval(() => {
      const now = Date.now() + this.serverTimeOffsetMs;
      let changed = false;
      for (const [id, rp] of this.players.entries()) {
        if (now - rp.lastUpdated > 60000) {
          this.players.delete(id);
          changed = true;
        }
      }
      if (changed) this.emitPlayers(true);
    }, 4500);

    this.callbacks.onStatusChange('connected', activeRoom, this.selfId, 'cloud');
  }

  private subscribeCloudWorld(activeRoom: string, targetMapId: WorldMapId, seq: number): void {
    if (this.worldUnsub) {
      this.worldUnsub();
      this.worldUnsub = null;
    }
    this.worldDocExists = false;
    const worldPath = `rooms/${activeRoom}/worlds/${targetMapId}`;
    const worldRef = doc(db, 'rooms', activeRoom, 'worlds', targetMapId);
    this.worldUnsub = onSnapshot(
      worldRef,
      (docSnap) => {
        if (this.disposed || seq !== this.cloudJoinSeq || targetMapId !== this.activeMapId) return;
        if (docSnap.metadata.hasPendingWrites) return;
        if (!docSnap.exists()) {
          this.worldDocExists = false;
          return;
        }
        this.worldDocExists = true;
        const d = docSnap.data() as Record<string, unknown>;
        const weatherMode = sanitizeWeatherMode(d.weatherMode);
        const timeAnchorHours = clampNum(Number(d.timeAnchorHours), 0, 24);
        const timeAnchorMs = clampNum(Number(d.timeAnchorMs), 0, 99999999999999);
        const timePaused = Boolean(d.timePaused);
        const campfireLit = d.campfireLit !== undefined ? Boolean(d.campfireLit) : true;
        const hostSessionId = typeof d.hostSessionId === 'string' ? d.hostSessionId : '';
        const enemies = sanitizeEnemyItems(d.enemies);

        this.latestEnv = {
          weatherMode,
          timeAnchorHours,
          timeAnchorMs,
          timePaused,
          campfireLit,
        };

        this.callbacks.onWorldStateUpdate?.({
          mapId: targetMapId,
          weatherMode,
          timeAnchorHours,
          timeAnchorMs,
          timePaused,
          campfireLit,
          hostSessionId,
          enemies,
          serverNowMs: Date.now() + this.serverTimeOffsetMs,
        });
      },
      (error) => {
        this.reportCloudError(error, OperationType.GET, worldPath);
      }
    );
  }

  private subscribeCloudHits(activeRoom: string, seq: number): void {
    if (this.hitsUnsub) {
      this.hitsUnsub();
      this.hitsUnsub = null;
    }
    const hitsPath = `rooms/${activeRoom}/hits`;
    const hitsQ = query(
      collection(db, 'rooms', activeRoom, 'hits'),
      where('roomId', '==', activeRoom)
    );
    this.hitsUnsub = onSnapshot(
      hitsQ,
      (snapshot) => {
        if (this.disposed || seq !== this.cloudJoinSeq) return;
        const nowMs = Date.now() + this.serverTimeOffsetMs;
        for (const change of snapshot.docChanges()) {
          if (change.type !== 'added') continue;
          const id = change.doc.id;
          if (this.processedHitIds.has(id)) continue;
          this.processedHitIds.add(id);
          if (this.processedHitIds.size > 240) {
            const first = this.processedHitIds.values().next().value;
            if (first !== undefined) this.processedHitIds.delete(first);
          }

          const d = change.doc.data() as Record<string, unknown>;
          if (d.attackerId === this.cloudSessionId) continue;
          const mapId = sanitizeMapId(d.mapId as WorldMapId);
          if (mapId !== this.activeMapId) continue;

          const tsObj = d.createdAt as Timestamp | null | undefined;
          const createdMs =
            tsObj && typeof tsObj.toMillis === 'function' ? tsObj.toMillis() : nowMs;
          if (nowMs - createdMs > 12000) continue;

          const enemyId = typeof d.enemyId === 'string' ? d.enemyId : '';
          if (!enemyId) continue;
          this.callbacks.onEnemyHitReceived?.({
            id,
            mapId,
            enemyId,
            attackerId: typeof d.attackerId === 'string' ? d.attackerId : '',
            damage: Math.round(clampNum(Number(d.damage), 1, 200)),
            dirX: clampNum(Number(d.dirX), -2, 2),
            dirZ: clampNum(Number(d.dirZ), -2, 2),
            heavy: Boolean(d.heavy),
          });
        }
      },
      (error) => {
        this.reportCloudError(error, OperationType.LIST, hitsPath);
      }
    );
  }

  private async flushCloudState(force = false): Promise<void> {
    if (
      this.disposed ||
      this.mode !== 'cloud' ||
      !this.currentUser ||
      !this.cloudPlayerDocCreated
    ) {
      return;
    }

    const s = this.latestLocalState;
    const now = performance.now();
    const signature = `${s.mapId}:${Math.round(s.x * 8)}:${Math.round(s.y * 8)}:${Math.round(s.z * 8)}:${Math.round(s.yaw * 16)}:${Math.round(s.speed * 2)}:${s.crouch ? 1 : 0}:${s.sprint ? 1 : 0}:${s.swim ? 1 : 0}:${s.flashlight ? 1 : 0}:${s.attackTimer > 0 ? 1 : 0}:${s.dodge ? 1 : 0}:${s.guard ? 1 : 0}`;
    const stoppedNow = s.speed < 0.15 && this.lastSentSpeed >= 0.35 && now - this.lastSentAt >= 50;
    const urgent =
      s.attackTimer > 0 ||
      s.dodge ||
      stoppedNow ||
      signature.split(':')[0] !== this.lastSentSignature.split(':')[0];

    if (!force && signature === this.lastSentSignature && now - this.lastSentAt < 5500) {
      return;
    }

    if (this.cloudWriteInFlight) {
      if (force || signature !== this.lastSentSignature) {
        this.cloudDirtyPending = true;
      }
      return;
    }

    if (!force && !urgent && now - this.lastSentAt < 110) {
      return;
    }

    this.lastSentAt = now;
    this.lastSentSignature = signature;
    this.lastSentSpeed = s.speed;
    this.cloudWriteInFlight = true;
    this.cloudDirtyPending = false;

    const playerPath = `rooms/${this.roomId}/players/${this.cloudSessionId}`;
    const playerRef = doc(db, 'rooms', this.roomId, 'players', this.cloudSessionId);
    try {
      await updateDoc(playerRef, this.buildCloudPlayerUpdatePayload());
    } catch (error) {
      // Recreate doc cleanly if it didn't exist yet or was removed
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('No document to update') || msg.includes('NOT_FOUND')) {
        try {
          await setDoc(playerRef, this.buildCloudPlayerPayload(this.currentUser));
        } catch (retryErr) {
          this.reportCloudError(retryErr, OperationType.WRITE, playerPath);
        }
      } else {
        this.reportCloudError(error, OperationType.UPDATE, playerPath);
      }
    } finally {
      this.cloudWriteInFlight = false;
      if (this.cloudDirtyPending && !this.disposed && this.mode === 'cloud') {
        this.cloudDirtyPending = false;
        void this.flushCloudState(false);
      }
    }
  }

  private getWsUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  private clearWsTimers(): void {
    if (this.wsConnectTimeout !== null) {
      window.clearTimeout(this.wsConnectTimeout);
      this.wsConnectTimeout = null;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHttpTimer(): void {
    if (this.httpSyncTimer !== null) {
      window.clearInterval(this.httpSyncTimer);
      this.httpSyncTimer = null;
    }
  }

  private connectWebSocket(): void {
    if (this.disposed || this.currentUser) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.mode = 'ws';
    this.clearHttpTimer();
    this.callbacks.onStatusChange(
      this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      this.roomId,
      this.selfId,
      'local'
    );

    try {
      const ws = new WebSocket(this.getWsUrl());
      this.ws = ws;

      this.wsConnectTimeout = window.setTimeout(() => {
        if (this.disposed || this.currentUser || this.ws !== ws) return;
        if (ws.readyState !== WebSocket.OPEN) {
          try {
            ws.close();
          } catch {
            // Ignore close errors
          }
          this.ws = null;
          void this.activateHttpFallback();
        }
      }, 2400);

      ws.onopen = () => {
        if (this.disposed || this.currentUser || this.ws !== ws) return;
        this.clearWsTimers();
        this.reconnectAttempt = 0;
        this.sendWsRaw({
          type: 'join',
          roomId: this.roomId,
          name: this.playerName,
          mapId: this.latestLocalState.mapId,
          x: this.latestLocalState.x,
          y: this.latestLocalState.y,
          z: this.latestLocalState.z,
          yaw: this.latestLocalState.yaw,
        });
      };

      ws.onmessage = (event) => {
        if (this.disposed || this.currentUser || this.ws !== ws) return;
        let data: Record<string, unknown>;
        try {
          const parsed = JSON.parse(String(event.data));
          if (!parsed || typeof parsed !== 'object') return;
          data = parsed as Record<string, unknown>;
        } catch {
          return;
        }

        const type = data.type;
        if (type === 'welcome') {
          const nextSelfId = typeof data.selfId === 'string' ? data.selfId : null;
          const nextRoomId = typeof data.roomId === 'string' ? data.roomId : this.roomId;
          this.selfId = nextSelfId;
          this.roomId = nextRoomId;
          this.players.clear();
          this.localWorlds.clear();

          if (typeof data.serverNowMs === 'number') {
            this.serverTimeOffsetMs = data.serverNowMs - Date.now();
            this.callbacks.onServerClockOffset?.(this.serverTimeOffsetMs);
          }

          if (Array.isArray(data.players)) {
            for (const item of data.players) {
              const p = item as RemotePlayerState;
              if (p && typeof p.id === 'string' && p.id !== this.selfId) {
                this.players.set(p.id, p);
              }
            }
          }
          if (Array.isArray(data.messages)) {
            for (const item of data.messages) {
              const m = item as MultiplayerChatMessage;
              if (m && typeof m.id === 'string' && typeof m.text === 'string') {
                this.lastChatTs = Math.max(this.lastChatTs, m.ts || 0);
                this.callbacks.onChatMessage(m);
              }
            }
          }
          if (Array.isArray(data.worlds)) {
            this.applyLocalWorldsSnapshot(data.worlds, Number(data.serverNowMs || Date.now()));
          }
          this.callbacks.onStatusChange('connected', this.roomId, this.selfId, 'local');
          this.emitPlayers(true);
          return;
        }

        if (type === 'player:joined' || type === 'player:updated') {
          const p = data.player as RemotePlayerState | undefined;
          if (!p || typeof p.id !== 'string' || p.id === this.selfId) return;
          this.players.set(p.id, p);
          this.emitPlayers(true);
          return;
        }

        if (type === 'player:state') {
          const p = data.player as RemotePlayerState | undefined;
          if (!p || typeof p.id !== 'string' || p.id === this.selfId) return;
          const prev = this.players.get(p.id);
          const mapChanged = !prev || prev.mapId !== p.mapId || prev.name !== p.name;
          this.players.set(p.id, p);
          this.emitPlayers(mapChanged);
          return;
        }

        if (type === 'player:left') {
          const id = typeof data.id === 'string' ? data.id : '';
          if (id && this.players.delete(id)) {
            this.emitPlayers(true);
          }
          return;
        }

        if (type === 'world:state') {
          const srvNow = typeof data.serverNowMs === 'number' ? data.serverNowMs : Date.now();
          this.serverTimeOffsetMs = srvNow - Date.now();
          this.callbacks.onServerClockOffset?.(this.serverTimeOffsetMs);
          if (data.world && typeof data.world === 'object') {
            this.applyLocalWorldsSnapshot([data.world], srvNow);
          }
          return;
        }

        if (type === 'enemy:hit') {
          const hit = data.hit as Record<string, unknown> | undefined;
          if (hit && typeof hit.enemyId === 'string' && hit.attackerId !== this.selfId) {
            const mapId = sanitizeMapId(hit.mapId as WorldMapId);
            if (mapId === this.activeMapId) {
              this.callbacks.onEnemyHitReceived?.({
                id: typeof hit.id === 'string' ? hit.id : String(Date.now()),
                mapId,
                enemyId: hit.enemyId,
                attackerId: typeof hit.attackerId === 'string' ? hit.attackerId : '',
                damage: Math.round(clampNum(Number(hit.damage), 1, 200)),
                dirX: clampNum(Number(hit.dirX), -2, 2),
                dirZ: clampNum(Number(hit.dirZ), -2, 2),
                heavy: Boolean(hit.heavy),
              });
            }
          }
          return;
        }

        if (type === 'chat:message') {
          const msg = data.message as MultiplayerChatMessage | undefined;
          if (msg && typeof msg.id === 'string' && typeof msg.text === 'string') {
            this.lastChatTs = Math.max(this.lastChatTs, msg.ts || 0);
            this.callbacks.onChatMessage(msg);
          }
        }
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
        }
        this.clearWsTimers();
        if (this.disposed || this.currentUser) return;

        if (this.reconnectAttempt >= 1) {
          void this.activateHttpFallback();
        } else {
          this.callbacks.onStatusChange('reconnecting', this.roomId, this.selfId, 'local');
          this.scheduleWsReconnect();
        }
      };

      ws.onerror = () => {
        // Handled cleanly in onclose
      };
    } catch {
      void this.activateHttpFallback();
    }
  }

  private scheduleWsReconnect(): void {
    if (this.disposed || this.currentUser || this.reconnectTimer !== null) return;
    const delay = Math.min(4000, 900 * Math.pow(1.5, this.reconnectAttempt));
    this.reconnectAttempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
  }

  private async activateHttpFallback(): Promise<void> {
    if (this.disposed || this.currentUser) return;
    this.mode = 'http';
    this.clearWsTimers();
    this.clearHttpTimer();

    try {
      const res = await fetch('/api/mp/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          playerId: this.selfId,
          name: this.playerName,
          mapId: this.latestLocalState.mapId,
          x: this.latestLocalState.x,
          y: this.latestLocalState.y,
          z: this.latestLocalState.z,
          yaw: this.latestLocalState.yaw,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.status === 404 || !contentType.includes('application/json')) {
        if (!this.disposed && !this.currentUser) {
          this.callbacks.onStatusChange('disconnected', this.roomId, this.selfId, 'local');
        }
        return;
      }
      if (!res.ok || this.disposed || this.currentUser) {
        this.callbacks.onStatusChange('reconnecting', this.roomId, this.selfId, 'local');
        this.scheduleHttpRetry();
        return;
      }

      const data = (await res.json()) as {
        ok?: boolean;
        selfId?: string;
        roomId?: string;
        players?: RemotePlayerState[];
        messages?: MultiplayerChatMessage[];
        worlds?: unknown[];
        serverNowMs?: number;
      };

      if (data.ok && data.selfId) {
        this.selfId = data.selfId;
        this.roomId = data.roomId || this.roomId;
        if (typeof data.serverNowMs === 'number') {
          this.serverTimeOffsetMs = data.serverNowMs - Date.now();
          this.callbacks.onServerClockOffset?.(this.serverTimeOffsetMs);
        }
        this.applyHttpSnapshot(
          data.players || [],
          data.messages || [],
          true,
          data.worlds,
          undefined,
          data.serverNowMs
        );
        this.callbacks.onStatusChange('connected', this.roomId, this.selfId, 'local');

        this.httpSyncTimer = window.setInterval(() => {
          void this.pollHttpSync();
        }, 160);
      }
    } catch {
      this.callbacks.onStatusChange('reconnecting', this.roomId, this.selfId, 'local');
      this.scheduleHttpRetry();
    }
  }

  private scheduleHttpRetry(): void {
    if (this.disposed || this.currentUser || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.activateHttpFallback();
    }, 2000);
  }

  private async pollHttpSync(): Promise<void> {
    if (
      this.disposed ||
      this.currentUser ||
      this.mode !== 'http' ||
      !this.selfId ||
      this.httpSyncInFlight
    ) {
      return;
    }
    this.httpSyncInFlight = true;
    try {
      const res = await fetch('/api/mp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          playerId: this.selfId,
          sinceTs: this.lastChatTs,
          sinceHitTs: this.lastHitTs,
          state: this.latestLocalState,
        }),
      });
      if (res.status === 404) {
        this.httpSyncInFlight = false;
        void this.activateHttpFallback();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        players?: RemotePlayerState[];
        messages?: MultiplayerChatMessage[];
        worlds?: unknown[];
        hits?: unknown[];
        serverNowMs?: number;
      };
      if (data.ok) {
        if (typeof data.serverNowMs === 'number') {
          this.serverTimeOffsetMs = data.serverNowMs - Date.now();
          this.callbacks.onServerClockOffset?.(this.serverTimeOffsetMs);
        }
        this.applyHttpSnapshot(
          data.players || [],
          data.messages || [],
          false,
          data.worlds,
          data.hits,
          data.serverNowMs
        );
      }
    } catch {
      this.callbacks.onStatusChange('reconnecting', this.roomId, this.selfId, 'local');
    } finally {
      this.httpSyncInFlight = false;
    }
  }

  private applyHttpSnapshot(
    list: RemotePlayerState[],
    messages: MultiplayerChatMessage[],
    forceUi: boolean,
    worlds?: unknown[],
    hits?: unknown[],
    serverNowMs?: number
  ): void {
    const prevIds = new Set(this.players.keys());
    const nextIds = new Set<string>();
    let structureChanged = forceUi;

    this.players.clear();
    for (const p of list) {
      if (p.id === this.selfId) continue;
      nextIds.add(p.id);
      if (!prevIds.has(p.id)) structureChanged = true;
      this.players.set(p.id, p);
    }
    for (const id of prevIds) {
      if (!nextIds.has(id)) structureChanged = true;
    }

    for (const m of messages) {
      this.lastChatTs = Math.max(this.lastChatTs, m.ts || 0);
      this.callbacks.onChatMessage(m);
    }

    if (Array.isArray(worlds)) {
      this.applyLocalWorldsSnapshot(worlds, serverNowMs ?? Date.now());
    }

    if (Array.isArray(hits)) {
      for (const rawHit of hits) {
        const hit = rawHit as Record<string, unknown>;
        if (!hit || typeof hit.enemyId !== 'string') continue;
        const ts = typeof hit.ts === 'number' ? hit.ts : 0;
        if (ts > this.lastHitTs) this.lastHitTs = ts;
        const id = typeof hit.id === 'string' ? hit.id : `${hit.enemyId}_${ts}`;
        if (this.processedHitIds.has(id)) continue;
        this.processedHitIds.add(id);
        const mapId = sanitizeMapId(hit.mapId as WorldMapId);
        if (mapId === this.activeMapId && hit.attackerId !== this.selfId) {
          this.callbacks.onEnemyHitReceived?.({
            id,
            mapId,
            enemyId: hit.enemyId,
            attackerId: typeof hit.attackerId === 'string' ? hit.attackerId : '',
            damage: Math.round(clampNum(Number(hit.damage), 1, 200)),
            dirX: clampNum(Number(hit.dirX), -2, 2),
            dirZ: clampNum(Number(hit.dirZ), -2, 2),
            heavy: Boolean(hit.heavy),
          });
        }
      }
    }

    this.emitPlayers(structureChanged);
  }

  private applyLocalWorldsSnapshot(rawWorlds: unknown[], serverNowMs: number): void {
    for (const item of rawWorlds) {
      const d = item as Record<string, unknown>;
      if (!d || typeof d !== 'object') continue;
      const mapId = sanitizeMapId(d.mapId as WorldMapId);
      const parsed: RoomWorldState = {
        mapId,
        weatherMode: sanitizeWeatherMode(d.weatherMode),
        timeAnchorHours: clampNum(Number(d.timeAnchorHours), 0, 24),
        timeAnchorMs: clampNum(Number(d.timeAnchorMs), 0, 99999999999999),
        timePaused: Boolean(d.timePaused),
        campfireLit: d.campfireLit !== undefined ? Boolean(d.campfireLit) : true,
        hostSessionId: typeof d.hostSessionId === 'string' ? d.hostSessionId : '',
        enemies: sanitizeEnemyItems(d.enemies),
        serverNowMs,
      };
      this.localWorlds.set(mapId, parsed);
      if (mapId === this.activeMapId) {
        this.latestEnv = {
          weatherMode: parsed.weatherMode,
          timeAnchorHours: parsed.timeAnchorHours,
          timeAnchorMs: parsed.timeAnchorMs,
          timePaused: parsed.timePaused,
          campfireLit: parsed.campfireLit,
        };
        this.callbacks.onWorldStateUpdate?.(parsed);
      }
    }
  }

  private sendWsRaw(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private emitPlayers(forceUi: boolean): void {
    const list = Array.from(this.players.values());
    this.callbacks.onPlayersFrame?.(list);
    const now = performance.now();
    if (forceUi || now - this.lastUiEmitAt >= 900) {
      this.lastUiEmitAt = now;
      this.callbacks.onPlayersChange(list);
    }
  }

  public getPlayersSnapshot(): RemotePlayerState[] {
    return Array.from(this.players.values());
  }

  public getServerNowMs(): number {
    return Date.now() + this.serverTimeOffsetMs;
  }

  public isMapHost(): boolean {
    const myId = this.selfId;
    if (!myId) return true;
    for (const p of this.players.values()) {
      if (p.mapId === this.activeMapId && p.id < myId) {
        return false;
      }
    }
    return true;
  }

  public hasSameMapTeammates(): boolean {
    for (const p of this.players.values()) {
      if (p.mapId === this.activeMapId) return true;
    }
    return false;
  }

  public setActiveMapId(mapId: WorldMapId): void {
    const clean = sanitizeMapId(mapId);
    if (this.activeMapId === clean) return;
    this.activeMapId = clean;
    const def = getWorldMapDef(clean);
    this.latestEnv = {
      weatherMode: def.defaultWeather,
      timeAnchorHours: def.defaultTimeHours,
      timeAnchorMs: this.getServerNowMs(),
      timePaused: false,
      campfireLit: true,
    };
    this.pendingEnemiesSnapshot = null;

    if (this.mode === 'cloud' && this.currentUser) {
      this.subscribeCloudWorld(this.roomId, clean, this.cloudJoinSeq);
    } else {
      const existing = this.localWorlds.get(clean);
      if (existing) {
        this.callbacks.onWorldStateUpdate?.(existing);
      }
    }
  }

  public pushRoomEnvUpdate(
    partial: {
      weatherMode?: WeatherMode;
      timeAnchorHours?: number;
      timeAnchorMs?: number;
      timePaused?: boolean;
      campfireLit?: boolean;
    },
    initialEnemies?: EnemyNetItem[]
  ): void {
    this.latestEnv = {
      ...this.latestEnv,
      ...partial,
      weatherMode: partial.weatherMode ? sanitizeWeatherMode(partial.weatherMode) : this.latestEnv.weatherMode,
      timeAnchorHours:
        partial.timeAnchorHours !== undefined
          ? clampNum(partial.timeAnchorHours, 0, 24)
          : this.latestEnv.timeAnchorHours,
      timeAnchorMs:
        partial.timeAnchorMs !== undefined
          ? Math.round(clampNum(partial.timeAnchorMs, 0, 99999999999999))
          : this.latestEnv.timeAnchorMs,
    };

    const targetMapId = this.activeMapId;
    if (this.mode === 'cloud' && this.currentUser) {
      void this.writeCloudEnv(targetMapId, initialEnemies);
      return;
    }

    if (this.mode === 'ws') {
      this.sendWsRaw({
        type: 'world:env',
        mapId: targetMapId,
        ...this.latestEnv,
      });
    } else if (this.mode === 'http' && this.selfId) {
      void fetch('/api/mp/world-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          playerId: this.selfId,
          mapId: targetMapId,
          ...this.latestEnv,
        }),
      }).catch(() => {});
    }
  }

  private async writeCloudEnv(
    targetMapId: WorldMapId,
    initialEnemies?: EnemyNetItem[]
  ): Promise<void> {
    const user = this.currentUser;
    if (this.disposed || !user || this.mode !== 'cloud') return;
    const worldPath = `rooms/${this.roomId}/worlds/${targetMapId}`;
    const worldRef = doc(db, 'rooms', this.roomId, 'worlds', targetMapId);

    const envFields = {
      weatherMode: this.latestEnv.weatherMode,
      timeAnchorHours: round2(clampNum(this.latestEnv.timeAnchorHours, 0, 24)),
      timeAnchorMs: Math.round(clampNum(this.latestEnv.timeAnchorMs, 0, 99999999999999)),
      timePaused: Boolean(this.latestEnv.timePaused),
      campfireLit: Boolean(this.latestEnv.campfireLit),
      updatedByUid: user.uid,
      updatedAt: serverTimestamp(),
    };

    try {
      if (!this.worldDocExists) {
        try {
          await setDoc(worldRef, {
            id: targetMapId,
            roomId: this.roomId,
            mapId: targetMapId,
            ...envFields,
            hostSessionId: this.cloudSessionId,
            enemies: sanitizeEnemyItems(initialEnemies ?? []),
            createdAt: serverTimestamp(),
          });
          this.worldDocExists = true;
          return;
        } catch {
          // Document may have just been created by a teammate; fall back to updateDoc
          await updateDoc(worldRef, envFields);
          this.worldDocExists = true;
          return;
        }
      }
      await updateDoc(worldRef, envFields);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('No document to update') || msg.includes('NOT_FOUND')) {
        try {
          await setDoc(worldRef, {
            id: targetMapId,
            roomId: this.roomId,
            mapId: targetMapId,
            ...envFields,
            hostSessionId: this.cloudSessionId,
            enemies: sanitizeEnemyItems(initialEnemies ?? []),
            createdAt: serverTimestamp(),
          });
          this.worldDocExists = true;
        } catch (retryErr) {
          this.reportCloudError(retryErr, OperationType.WRITE, worldPath);
        }
      } else {
        this.reportCloudError(err, OperationType.UPDATE, worldPath);
      }
    }
  }

  public pushRoomEnemiesSnapshot(enemies: EnemyNetItem[], force = false): void {
    if (this.disposed || !this.isMapHost()) return;
    const now = performance.now();
    const safeEnemies = sanitizeEnemyItems(enemies);

    if (this.mode === 'cloud' && this.currentUser) {
      const minInterval = force ? 160 : 240;
      if (this.worldWriteInFlight || now - this.lastEnemiesSentAt < minInterval) {
        if (force) {
          this.pendingEnemiesSnapshot = { mapId: this.activeMapId, enemies: safeEnemies };
        }
        return;
      }
      void this.flushCloudEnemies(this.activeMapId, safeEnemies);
      return;
    }

    if (this.mode === 'ws') {
      if (!force && now - this.lastEnemiesSentAt < 120) return;
      this.lastEnemiesSentAt = now;
      this.sendWsRaw({
        type: 'world:enemies',
        mapId: this.activeMapId,
        enemies: safeEnemies,
      });
    } else if (this.mode === 'http' && this.selfId) {
      if (!force && now - this.lastEnemiesSentAt < 220) return;
      this.lastEnemiesSentAt = now;
      void fetch('/api/mp/world-enemies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          playerId: this.selfId,
          mapId: this.activeMapId,
          enemies: safeEnemies,
        }),
      }).catch(() => {});
    }
  }

  private async flushCloudEnemies(targetMapId: WorldMapId, enemies: EnemyNetItem[]): Promise<void> {
    const user = this.currentUser;
    if (this.disposed || !user || this.mode !== 'cloud') return;
    this.worldWriteInFlight = true;
    this.lastEnemiesSentAt = performance.now();

    const worldPath = `rooms/${this.roomId}/worlds/${targetMapId}`;
    const worldRef = doc(db, 'rooms', this.roomId, 'worlds', targetMapId);
    const enemyFields = {
      hostSessionId: this.cloudSessionId,
      enemies,
      updatedByUid: user.uid,
      updatedAt: serverTimestamp(),
    };

    try {
      if (!this.worldDocExists) {
        try {
          await setDoc(worldRef, {
            id: targetMapId,
            roomId: this.roomId,
            mapId: targetMapId,
            weatherMode: this.latestEnv.weatherMode,
            timeAnchorHours: round2(clampNum(this.latestEnv.timeAnchorHours, 0, 24)),
            timeAnchorMs: Math.round(clampNum(this.latestEnv.timeAnchorMs, 0, 99999999999999)),
            timePaused: Boolean(this.latestEnv.timePaused),
            campfireLit: Boolean(this.latestEnv.campfireLit),
            ...enemyFields,
            createdAt: serverTimestamp(),
          });
          this.worldDocExists = true;
        } catch {
          await updateDoc(worldRef, enemyFields);
          this.worldDocExists = true;
        }
      } else {
        await updateDoc(worldRef, enemyFields);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('No document to update') || msg.includes('NOT_FOUND')) {
        try {
          await setDoc(worldRef, {
            id: targetMapId,
            roomId: this.roomId,
            mapId: targetMapId,
            weatherMode: this.latestEnv.weatherMode,
            timeAnchorHours: round2(clampNum(this.latestEnv.timeAnchorHours, 0, 24)),
            timeAnchorMs: Math.round(clampNum(this.latestEnv.timeAnchorMs, 0, 99999999999999)),
            timePaused: Boolean(this.latestEnv.timePaused),
            campfireLit: Boolean(this.latestEnv.campfireLit),
            ...enemyFields,
            createdAt: serverTimestamp(),
          });
          this.worldDocExists = true;
        } catch (retryErr) {
          this.reportCloudError(retryErr, OperationType.WRITE, worldPath);
        }
      } else {
        this.reportCloudError(err, OperationType.UPDATE, worldPath);
      }
    } finally {
      this.worldWriteInFlight = false;
      const queued = this.pendingEnemiesSnapshot;
      if (queued && !this.disposed && this.mode === 'cloud' && queued.mapId === this.activeMapId && this.isMapHost()) {
        this.pendingEnemiesSnapshot = null;
        void this.flushCloudEnemies(queued.mapId, queued.enemies);
      }
    }
  }

  public sendEnemyHit(hit: {
    enemyId: string;
    damage: number;
    dirX: number;
    dirZ: number;
    heavy: boolean;
  }): void {
    if (this.disposed) return;
    const targetMapId = this.activeMapId;
    const safeDmg = Math.round(clampNum(hit.damage, 1, 200));
    const dirX = round2(clampNum(hit.dirX, -2, 2));
    const dirZ = round2(clampNum(hit.dirZ, -2, 2));
    const heavy = Boolean(hit.heavy);

    if (this.mode === 'cloud' && this.currentUser) {
      const hitId = `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const hitPath = `rooms/${this.roomId}/hits/${hitId}`;
      const hitRef = doc(db, 'rooms', this.roomId, 'hits', hitId);
      void setDoc(hitRef, {
        id: hitId,
        ownerUid: this.currentUser.uid,
        roomId: this.roomId,
        mapId: targetMapId,
        enemyId: hit.enemyId.slice(0, 48),
        attackerId: this.cloudSessionId,
        damage: safeDmg,
        dirX,
        dirZ,
        heavy,
        createdAt: serverTimestamp(),
      })
        .then(() => {
          window.setTimeout(() => {
            void deleteDoc(hitRef).catch(() => {});
          }, 7000);
        })
        .catch((err) => {
          this.reportCloudError(err, OperationType.CREATE, hitPath);
        });
      return;
    }

    if (this.mode === 'ws') {
      this.sendWsRaw({
        type: 'enemy:hit',
        mapId: targetMapId,
        enemyId: hit.enemyId,
        damage: safeDmg,
        dirX,
        dirZ,
        heavy,
      });
    } else if (this.mode === 'http' && this.selfId) {
      void fetch('/api/mp/enemy-hit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.roomId,
          playerId: this.selfId,
          mapId: targetMapId,
          enemyId: hit.enemyId,
          damage: safeDmg,
          dirX,
          dirZ,
          heavy,
        }),
      }).catch(() => {});
    }
  }

  public pushLocalState(state: NetLocalPlayerState): void {
    this.latestLocalState = { ...state };
    if (this.mode === 'cloud') {
      void this.flushCloudState(false);
      return;
    }
    if (this.mode !== 'ws' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const now = performance.now();
    const signature = `${state.mapId}:${Math.round(state.x * 8)}:${Math.round(state.y * 8)}:${Math.round(state.z * 8)}:${Math.round(state.yaw * 16)}:${Math.round(state.speed * 2)}:${state.crouch ? 1 : 0}:${state.sprint ? 1 : 0}:${state.swim ? 1 : 0}:${state.flashlight ? 1 : 0}:${state.attackTimer > 0 ? 1 : 0}:${state.dodge ? 1 : 0}:${state.guard ? 1 : 0}`;
    const urgent =
      state.attackTimer > 0 ||
      state.dodge ||
      signature.split(':')[0] !== this.lastSentSignature.split(':')[0];

    if (signature === this.lastSentSignature && now - this.lastSentAt < 650) {
      return;
    }
    if (!urgent && now - this.lastSentAt < 50) {
      return;
    }

    this.lastSentAt = now;
    this.lastSentSignature = signature;
    this.sendWsRaw({
      type: 'state',
      ...state,
    });
  }

  public joinRoom(nextRoomId: string): void {
    const targetRoom = sanitizeRoomId(nextRoomId);
    if (
      targetRoom === this.roomId &&
      (this.mode === 'cloud' || this.ws?.readyState === WebSocket.OPEN || this.mode === 'http')
    ) {
      return;
    }

    const oldRoom = this.roomId;
    if (this.mode === 'cloud') {
      void this.deleteOwnCloudPlayerDoc(oldRoom);
    } else if (this.mode === 'http' && this.selfId) {
      void fetch('/api/mp/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: oldRoom, playerId: this.selfId }),
      }).catch(() => {});
    }

    this.roomId = targetRoom;
    this.lastChatTs = 0;
    this.lastHitTs = 0;
    this.players.clear();
    this.localWorlds.clear();
    this.emitPlayers(true);

    if (this.mode === 'cloud' && this.currentUser) {
      void this.activateCloudFirestore();
    } else if (this.mode === 'http') {
      void this.activateHttpFallback();
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWsRaw({
        type: 'join',
        roomId: this.roomId,
        name: this.playerName,
        mapId: this.latestLocalState.mapId,
        x: this.latestLocalState.x,
        y: this.latestLocalState.y,
        z: this.latestLocalState.z,
        yaw: this.latestLocalState.yaw,
      });
    } else {
      this.connectWebSocket();
    }
  }

  public setPlayerName(nextName: string): void {
    const cleaned = sanitizePlayerName(nextName);
    this.playerName = cleaned;
    try {
      localStorage.setItem(MP_NAME_STORAGE_KEY, cleaned);
    } catch {
      // Ignore storage write errors
    }

    if (this.mode === 'cloud') {
      void this.flushCloudState(true);
      return;
    }
    if (this.mode === 'http' && this.selfId) {
      void fetch('/api/mp/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: this.roomId, playerId: this.selfId, name: cleaned }),
      }).catch(() => {});
    } else {
      this.sendWsRaw({ type: 'rename', name: cleaned });
    }
  }

  public sendChat(text: string): void {
    const trimmed = text.trim().slice(0, 140);
    if (!trimmed) return;

    if (this.mode === 'cloud' && this.currentUser) {
      const msgId = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const msgPath = `rooms/${this.roomId}/messages/${msgId}`;
      const msgRef = doc(db, 'rooms', this.roomId, 'messages', msgId);
      void setDoc(msgRef, {
        id: msgId,
        ownerUid: this.currentUser.uid,
        playerId: this.cloudSessionId,
        roomId: this.roomId,
        name: sanitizePlayerName(this.playerName),
        colorIdx: this.cloudColorIdx,
        text: trimmed,
        createdAt: serverTimestamp(),
      }).catch((err) => {
        this.reportCloudError(err, OperationType.CREATE, msgPath);
      });
      return;
    }

    if (this.mode === 'http' && this.selfId) {
      void fetch('/api/mp/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: this.roomId, playerId: this.selfId, text: trimmed }),
      })
        .then((r) => r.json())
        .then((data: { message?: MultiplayerChatMessage }) => {
          if (data?.message) {
            this.lastChatTs = Math.max(this.lastChatTs, data.message.ts || 0);
            this.callbacks.onChatMessage(data.message);
          }
        })
        .catch(() => {});
    } else {
      this.sendWsRaw({ type: 'chat', text: trimmed });
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (this.authUnsub) {
      this.authUnsub();
      this.authUnsub = null;
    }
    this.handlePageHide();
    this.teardownCloud();
    this.teardownLocalSockets();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.handlePageHide);
    }
    this.players.clear();
  }
}
