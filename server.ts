import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

const VALID_MAP_IDS = new Set([
  'lost_valley',
  'alpine_glacier',
  'emerald_archipelago',
  'saffron_canyon',
  'misty_wetlands',
  'crimson_caldera',
  'twin_fjords',
  'highland_meadows',
]);

const DEFAULT_ROOM_ID = 'global';
const MAX_PLAYERS_PER_ROOM = 32;
const MAX_PAYLOAD_BYTES = 2048;
const CHAT_COOLDOWN_MS = 350;

interface ServerPlayer {
  id: string;
  roomId: string;
  name: string;
  colorIdx: number;
  mapId: string;
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

interface ClientSession {
  ws: WebSocket;
  playerId: string;
  roomId: string;
  lastChatAt: number;
  isAlive: boolean;
}

function sanitizeRoomId(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_ROOM_ID;
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
  return cleaned.length >= 2 ? cleaned : DEFAULT_ROOM_ID;
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Sayohatchi';
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 18);
  return cleaned.length >= 1 ? cleaned : 'Sayohatchi';
}

function sanitizeMapId(raw: unknown): string {
  if (typeof raw === 'string' && VALID_MAP_IDS.has(raw)) {
    return raw;
  }
  return 'lost_valley';
}

function clampCoord(raw: unknown, fallback = 0): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-520, Math.min(520, n));
}

function clampNum(raw: unknown, min: number, max: number, fallback = 0): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeChatText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

const rooms = new Map<string, Map<string, ServerPlayer>>();
const roomSockets = new Map<string, Set<ClientSession>>();

function getOrCreateRoom(roomId: string): {
  players: Map<string, ServerPlayer>;
  sockets: Set<ClientSession>;
} {
  let players = rooms.get(roomId);
  if (!players) {
    players = new Map<string, ServerPlayer>();
    rooms.set(roomId, players);
  }
  let sockets = roomSockets.get(roomId);
  if (!sockets) {
    sockets = new Set<ClientSession>();
    roomSockets.set(roomId, sockets);
  }
  return { players, sockets };
}

function broadcastToRoom(roomId: string, payload: unknown, excludeId?: string): void {
  const sockets = roomSockets.get(roomId);
  if (!sockets || sockets.size === 0) return;
  const serialized = JSON.stringify(payload);
  for (const client of sockets) {
    if (excludeId && client.playerId === excludeId) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(serialized);
    }
  }
}

function removeFromRoom(session: ClientSession): void {
  const { roomId, playerId } = session;
  if (!roomId || !playerId) return;

  const players = rooms.get(roomId);
  const sockets = roomSockets.get(roomId);
  sockets?.delete(session);

  if (players?.delete(playerId)) {
    broadcastToRoom(roomId, { type: 'player:left', id: playerId });
  }

  if (players && players.size === 0) {
    rooms.delete(roomId);
    roomSockets.delete(roomId);
  }
}

async function startServer(): Promise<void> {
  const app = express();
  const server = http.createServer(app);
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
  });

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: MAX_PAYLOAD_BYTES,
  });

  wss.on('connection', (ws: WebSocket) => {
    const session: ClientSession = {
      ws,
      playerId: crypto.randomUUID(),
      roomId: '',
      lastChatAt: 0,
      isAlive: true,
    };

    ws.on('pong', () => {
      session.isAlive = true;
    });

    ws.on('message', (raw: Buffer | string) => {
      let msg: Record<string, unknown>;
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        msg = parsed as Record<string, unknown>;
      } catch {
        return;
      }

      const type = msg.type;
      if (type === 'join') {
        const nextRoomId = sanitizeRoomId(msg.roomId);
        if (session.roomId && session.roomId !== nextRoomId) {
          removeFromRoom(session);
        }

        const { players, sockets } = getOrCreateRoom(nextRoomId);
        if (!players.has(session.playerId) && players.size >= MAX_PLAYERS_PER_ROOM) {
          ws.send(JSON.stringify({ type: 'error', code: 'ROOM_FULL' }));
          return;
        }

        session.roomId = nextRoomId;
        sockets.add(session);

        const existing = players.get(session.playerId);
        const colorIdx = existing
          ? existing.colorIdx
          : Math.floor(Math.random() * 8);

        const player: ServerPlayer = {
          id: session.playerId,
          roomId: nextRoomId,
          name: sanitizeName(msg.name),
          colorIdx,
          mapId: sanitizeMapId(msg.mapId),
          x: clampCoord(msg.x, -16),
          y: clampNum(msg.y, -40, 200, 3.2),
          z: clampCoord(msg.z, 76),
          yaw: clampNum(msg.yaw, -Math.PI * 4, Math.PI * 4, 1.05),
          speed: 0,
          crouch: false,
          sprint: false,
          swim: false,
          flashlight: false,
          attackCombo: 0,
          attackTimer: 0,
          heavy: false,
          dodge: false,
          guard: false,
          lastUpdated: Date.now(),
        };

        players.set(session.playerId, player);

        ws.send(
          JSON.stringify({
            type: 'welcome',
            selfId: session.playerId,
            roomId: nextRoomId,
            players: Array.from(players.values()),
          })
        );

        broadcastToRoom(
          nextRoomId,
          { type: 'player:joined', player },
          session.playerId
        );
        return;
      }

      if (!session.roomId) return;
      const roomPlayers = rooms.get(session.roomId);
      const current = roomPlayers?.get(session.playerId);
      if (!current) return;

      if (type === 'rename') {
        current.name = sanitizeName(msg.name);
        current.lastUpdated = Date.now();
        broadcastToRoom(session.roomId, {
          type: 'player:updated',
          player: current,
        });
        return;
      }

      if (type === 'state') {
        current.mapId = sanitizeMapId(msg.mapId);
        current.x = clampCoord(msg.x, current.x);
        current.y = clampNum(msg.y, -40, 200, current.y);
        current.z = clampCoord(msg.z, current.z);
        current.yaw = clampNum(msg.yaw, -Math.PI * 4, Math.PI * 4, current.yaw);
        current.speed = clampNum(msg.speed, 0, 30, 0);
        current.crouch = Boolean(msg.crouch);
        current.sprint = Boolean(msg.sprint);
        current.swim = Boolean(msg.swim);
        current.flashlight = Boolean(msg.flashlight);
        current.attackCombo = Math.trunc(clampNum(msg.attackCombo, 0, 5, 0));
        current.attackTimer = clampNum(msg.attackTimer, 0, 2, 0);
        current.heavy = Boolean(msg.heavy);
        current.dodge = Boolean(msg.dodge);
        current.guard = Boolean(msg.guard);
        current.lastUpdated = Date.now();

        broadcastToRoom(
          session.roomId,
          { type: 'player:state', player: current },
          session.playerId
        );
        return;
      }

      if (type === 'chat') {
        const now = Date.now();
        if (now - session.lastChatAt < CHAT_COOLDOWN_MS) return;
        const text = sanitizeChatText(msg.text);
        if (!text) return;
        session.lastChatAt = now;

        broadcastToRoom(session.roomId, {
          type: 'chat:message',
          message: {
            id: crypto.randomUUID(),
            playerId: current.id,
            name: current.name,
            colorIdx: current.colorIdx,
            text,
            ts: now,
          },
        });
      }
    });

    ws.on('close', () => {
      removeFromRoom(session);
    });

    ws.on('error', () => {
      removeFromRoom(session);
    });
  });

  const heartbeat = setInterval(() => {
    for (const sockets of roomSockets.values()) {
      for (const client of sockets) {
        if (!client.isAlive) {
          client.ws.terminate();
          removeFromRoom(client);
          continue;
        }
        client.isAlive = false;
        client.ws.ping();
      }
    }
  }, 25000);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Not built');
      }
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

void startServer();
