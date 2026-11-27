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

export function buildShareableRoomUrl(roomId: string): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  if (url.hostname.startsWith('ais-dev-')) {
    url.hostname = url.hostname.replace(/^ais-dev-/, 'ais-pre-');
  }
  url.searchParams.set('room', roomId);
  return url.toString();
}

export interface MultiplayerCallbacks {
  onStatusChange: (status: ConnectionStatus, roomId: string, selfId: string | null) => void;
  onPlayersFrame?: (players: RemotePlayerState[]) => void;
  onPlayersChange: (players: RemotePlayerState[]) => void;
  onChatMessage: (msg: MultiplayerChatMessage) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private disposed = false;
  private mode: 'ws' | 'http' = 'ws';
  private wsConnectTimeout: number | null = null;
  private reconnectTimer: number | null = null;
  private httpSyncTimer: number | null = null;
  private httpSyncInFlight = false;
  private reconnectAttempt = 0;

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
    this.roomId = initialRoomId;
    this.playerName = initialName;
    this.latestLocalState = { ...initialState };
    this.callbacks = callbacks;

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.handlePageHide);
    }
    this.connectWebSocket();
  }

  private handlePageHide = (): void => {
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
    if (this.disposed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.mode = 'ws';
    this.clearHttpTimer();
    this.callbacks.onStatusChange(
      this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      this.roomId,
      this.selfId
    );

    try {
      const ws = new WebSocket(this.getWsUrl());
      this.ws = ws;

      this.wsConnectTimeout = window.setTimeout(() => {
        if (this.disposed || this.ws !== ws) return;
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
        if (this.disposed || this.ws !== ws) return;
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
          if (Array.isArray(data.messages)) {
            for (const item of data.messages) {
              const m = item as MultiplayerChatMessage;
              if (m && typeof m.id === 'string' && typeof m.text === 'string') {
                this.lastChatTs = Math.max(this.lastChatTs, m.ts || 0);
                this.callbacks.onChatMessage(m);
              }
            }
          }
          this.callbacks.onStatusChange('connected', this.roomId, this.selfId);
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
        if (this.disposed) return;

        // If WS closed quickly or repeatedly, fall back immediately to HTTP polling sync
        if (this.reconnectAttempt >= 1) {
          void this.activateHttpFallback();
        } else {
          this.callbacks.onStatusChange('reconnecting', this.roomId, this.selfId);
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
    if (this.disposed || this.reconnectTimer !== null) return;
    const delay = Math.min(4000, 900 * Math.pow(1.5, this.reconnectAttempt));
    this.reconnectAttempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
  }

  private async activateHttpFallback(): Promise<void> {
    if (this.disposed) return;
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
      if (!res.ok || this.disposed) {
        this.callbacks.onStatusChange('reconnecting', this.roomId, this.selfId);
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
        this.callbacks.onStatusChange('connected', this.roomId, this.selfId);

        this.httpSyncTimer = window.setInterval(() => {
          void this.pollHttpSync();
        }, 160);
      }
    } catch {
      this.callbacks.onStatusChange('reconnecting', this.roomId, this.selfId);
      this.scheduleHttpRetry();
    }
  }

  private scheduleHttpRetry(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.activateHttpFallback();
    }, 2000);
  }

  private async pollHttpSync(): Promise<void> {
    if (this.disposed || this.mode !== 'http' || !this.selfId || this.httpSyncInFlight) return;
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
      this.callbacks.onStatusChange('reconnecting', this.roomId, this.selfId);
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
    const cleaned = nextRoomId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
    const targetRoom = cleaned.length >= 2 ? cleaned : 'global';
    if (targetRoom === this.roomId && (this.ws?.readyState === WebSocket.OPEN || this.mode === 'http')) {
      return;
    }

    if (this.mode === 'http' && this.selfId) {
      void fetch('/api/mp/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: this.roomId, playerId: this.selfId }),
      }).catch(() => {});
    }

    this.roomId = targetRoom;
    this.lastChatTs = 0;
    this.players.clear();
    this.emitPlayers(true);

    if (this.mode === 'http') {
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
    const cleaned = nextName.trim().slice(0, 18) || 'Sayohatchi';
    this.playerName = cleaned;
    try {
      localStorage.setItem(MP_NAME_STORAGE_KEY, cleaned);
    } catch {
      // Ignore storage write errors
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
    this.clearWsTimers();
    this.clearHttpTimer();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.handlePageHide);
    }
    this.handlePageHide();
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
