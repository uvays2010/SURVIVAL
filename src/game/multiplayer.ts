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

export const MP_NAME_STORAGE_KEY = 'lost_world_mp_name';

export function getInitialRoomFromUrl(): string {
  if (typeof window === 'undefined') return 'global';
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('room') || '';
    const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
    return cleaned.length >= 2 ? cleaned : 'global';
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

export interface MultiplayerCallbacks {
  onStatusChange: (status: ConnectionStatus, roomId: string, selfId: string | null) => void;
  onPlayersChange: (players: RemotePlayerState[]) => void;
  onChatMessage: (msg: MultiplayerChatMessage) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private disposed = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;

  private roomId: string;
  private playerName: string;
  private selfId: string | null = null;
  private players = new Map<string, RemotePlayerState>();
  private latestLocalState: NetLocalPlayerState;
  private callbacks: MultiplayerCallbacks;
  private lastSentAt = 0;
  private lastSentSignature = '';

  constructor(
    initialRoomId: string,
    initialName: string,
    initialState: NetLocalPlayerState,
    callbacks: MultiplayerCallbacks
  ) {
    this.roomId = initialRoomId;
    this.playerName = initialName;
    this.latestLocalState = { ...initialState };
    this.callbacks = callbacks;
    this.connect();
  }

  private getWsUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  private connect(): void {
    if (this.disposed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.callbacks.onStatusChange(
      this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      this.roomId,
      this.selfId
    );

    try {
      const ws = new WebSocket(this.getWsUrl());
      this.ws = ws;

      ws.onopen = () => {
        if (this.disposed || this.ws !== ws) return;
        this.reconnectAttempt = 0;
        this.sendRaw({
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
        if (this.disposed || this.ws !== ws) return;
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
          this.callbacks.onStatusChange('connected', this.roomId, this.selfId);
          this.emitPlayers();
          return;
        }

        if (type === 'player:joined' || type === 'player:updated' || type === 'player:state') {
          const p = data.player as RemotePlayerState | undefined;
          if (!p || typeof p.id !== 'string' || p.id === this.selfId) return;
          this.players.set(p.id, p);
          this.emitPlayers();
          return;
        }

        if (type === 'player:left') {
          const id = typeof data.id === 'string' ? data.id : '';
          if (id && this.players.delete(id)) {
            this.emitPlayers();
          }
          return;
        }

        if (type === 'chat:message') {
          const msg = data.message as MultiplayerChatMessage | undefined;
          if (msg && typeof msg.id === 'string' && typeof msg.text === 'string') {
            this.callbacks.onChatMessage(msg);
          }
        }
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
        }
        if (this.disposed) return;
        this.callbacks.onStatusChange('reconnecting', this.roomId, this.selfId);
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        // Error triggers onclose which handles reconnect
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    const delay = Math.min(10000, 1000 * Math.pow(1.6, this.reconnectAttempt));
    this.reconnectAttempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private sendRaw(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private emitPlayers(): void {
    this.callbacks.onPlayersChange(Array.from(this.players.values()));
  }

  public getPlayersSnapshot(): RemotePlayerState[] {
    return Array.from(this.players.values());
  }

  public pushLocalState(state: NetLocalPlayerState): void {
    this.latestLocalState = { ...state };
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

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
    this.sendRaw({
      type: 'state',
      ...state,
    });
  }

  public joinRoom(nextRoomId: string): void {
    const cleaned = nextRoomId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
    const targetRoom = cleaned.length >= 2 ? cleaned : 'global';
    if (targetRoom === this.roomId && this.ws?.readyState === WebSocket.OPEN) return;

    this.roomId = targetRoom;
    this.players.clear();
    this.emitPlayers();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendRaw({
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
      this.connect();
    }
  }

  public setPlayerName(nextName: string): void {
    const cleaned = nextName.trim().slice(0, 18) || 'Sayohatchi';
    this.playerName = cleaned;
    try {
      localStorage.setItem(MP_NAME_STORAGE_KEY, cleaned);
    } catch {
      // Ignore storage write errors
    }
    this.sendRaw({ type: 'rename', name: cleaned });
  }

  public sendChat(text: string): void {
    const trimmed = text.trim().slice(0, 140);
    if (!trimmed) return;
    this.sendRaw({ type: 'chat', text: trimmed });
  }

  public dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    this.players.clear();
  }
}
