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
import { WorldMapId } from './types';

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
  private cloudHeartbeatTimer: number | null = null;
  private cloudPruneTimer: number | null = null;
  private currentUser: User | null = null;
  private cloudSessionId: string;
  private cloudColorIdx: number;
  private cloudPlayerDocCreated = false;
  private cloudJoinSeq = 0;
  private cloudWriteInFlight = false;
  private serverTimeOffsetMs = 0;

  private roomId: string;
  private playerName: string;
  private selfId: string | null = null;
  private players = new Map<string, RemotePlayerState>();
  private latestLocalState: NetLocalPlayerState;
  private callbacks: MultiplayerCallbacks;
  private lastSentAt = 0;
  private lastSentSignature = '';
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
    if (this.playersUnsub) {
      this.playersUnsub();
      this.playersUnsub = null;
    }
    if (this.messagesUnsub) {
      this.messagesUnsub();
      this.messagesUnsub = null;
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
        snapshot.forEach((docSnap) => {
          if (docSnap.id === this.cloudSessionId) {
            const selfData = docSnap.data() as Record<string, unknown>;
            const selfTs = selfData.updatedAt as Timestamp | null | undefined;
            if (selfTs && typeof selfTs.toMillis === 'function' && !docSnap.metadata.hasPendingWrites) {
              this.serverTimeOffsetMs = selfTs.toMillis() - localNow;
            }
          }
        });
        const now = localNow + this.serverTimeOffsetMs;
        const prevIds = new Set(this.players.keys());
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

          const rp: RemotePlayerState = {
            id: typeof d.id === 'string' ? d.id : docSnap.id,
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
          };

          const prev = prevIds.has(rp.id);
          if (!prev) structureChanged = true;
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

    // 5. Periodic heartbeat + local stale player pruner
    this.cloudHeartbeatTimer = window.setInterval(() => {
      void this.flushCloudState(true);
    }, 5000);

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

  private async flushCloudState(force = false): Promise<void> {
    if (
      this.disposed ||
      this.mode !== 'cloud' ||
      !this.currentUser ||
      !this.cloudPlayerDocCreated ||
      this.cloudWriteInFlight
    ) {
      return;
    }

    const s = this.latestLocalState;
    const now = performance.now();
    const signature = `${s.mapId}:${Math.round(s.x * 8)}:${Math.round(s.y * 8)}:${Math.round(s.z * 8)}:${Math.round(s.yaw * 16)}:${s.crouch ? 1 : 0}:${s.sprint ? 1 : 0}:${s.swim ? 1 : 0}:${s.flashlight ? 1 : 0}:${s.attackTimer > 0 ? 1 : 0}:${s.dodge ? 1 : 0}:${s.guard ? 1 : 0}`;
    const urgent =
      s.attackTimer > 0 ||
      s.dodge ||
      signature.split(':')[0] !== this.lastSentSignature.split(':')[0];

    if (!force && signature === this.lastSentSignature && now - this.lastSentAt < 4500) {
      return;
    }
    if (!force && !urgent && now - this.lastSentAt < 180) {
      return;
    }

    this.lastSentAt = now;
    this.lastSentSignature = signature;
    this.cloudWriteInFlight = true;

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
      };

      if (data.ok && data.selfId) {
        this.selfId = data.selfId;
        this.roomId = data.roomId || this.roomId;
        this.applyHttpSnapshot(data.players || [], data.messages || [], true);
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
      };
      if (data.ok) {
        this.applyHttpSnapshot(data.players || [], data.messages || [], false);
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
    forceUi: boolean
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

    this.emitPlayers(structureChanged);
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
    if (forceUi || now - this.lastUiEmitAt >= 240) {
      this.lastUiEmitAt = now;
      this.callbacks.onPlayersChange(list);
    }
  }

  public getPlayersSnapshot(): RemotePlayerState[] {
    return Array.from(this.players.values());
  }

  public pushLocalState(state: NetLocalPlayerState): void {
    this.latestLocalState = { ...state };
    if (this.mode === 'cloud') {
      void this.flushCloudState(false);
      return;
    }
    if (this.mode !== 'ws' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const now = performance.now();
    const signature = `${state.mapId}:${Math.round(state.x * 10)}:${Math.round(state.y * 10)}:${Math.round(state.z * 10)}:${Math.round(state.yaw * 20)}:${state.crouch ? 1 : 0}:${state.sprint ? 1 : 0}:${state.swim ? 1 : 0}:${state.flashlight ? 1 : 0}:${state.attackTimer > 0 ? 1 : 0}:${state.dodge ? 1 : 0}:${state.guard ? 1 : 0}`;
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
    this.players.clear();
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
