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
const PLAYER_STALE_MS = 18000;
const MAX_CHAT_HISTORY = 50;

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
  transport: 'ws' | 'http';
}

interface ChatRecord {
  id: string;
  playerId: string;
  name: string;
  colorIdx: number;
  text: string;
  ts: number;
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
const roomChats = new Map<string, ChatRecord[]>();
const httpChatCooldown = new Map<string, number>();

function getOrCreateRoom(roomId: string): {
  players: Map<string, ServerPlayer>;
  sockets: Set<ClientSession>;
  chats: ChatRecord[];
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
  let chats = roomChats.get(roomId);
  if (!chats) {
    chats = [];
    roomChats.set(roomId, chats);
  }
  return { players, sockets, chats };
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

function cleanupRoomIfEmpty(roomId: string): void {
  const players = rooms.get(roomId);
  const sockets = roomSockets.get(roomId);
  if ((!players || players.size === 0) && (!sockets || sockets.size === 0)) {
    rooms.delete(roomId);
    roomSockets.delete(roomId);
    roomChats.delete(roomId);
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
  cleanupRoomIfEmpty(roomId);
}

function applyPlayerStateUpdate(player: ServerPlayer, msg: Record<string, unknown>): void {
  player.mapId = sanitizeMapId(msg.mapId);
  player.x = clampCoord(msg.x, player.x);
  player.y = clampNum(msg.y, -40, 200, player.y);
  player.z = clampCoord(msg.z, player.z);
  player.yaw = clampNum(msg.yaw, -Math.PI * 4, Math.PI * 4, player.yaw);
  player.speed = clampNum(msg.speed, 0, 30, 0);
  player.crouch = Boolean(msg.crouch);
  player.sprint = Boolean(msg.sprint);
  player.swim = Boolean(msg.swim);
  player.flashlight = Boolean(msg.flashlight);
  player.attackCombo = Math.trunc(clampNum(msg.attackCombo, 0, 5, 0));
  player.attackTimer = clampNum(msg.attackTimer, 0, 2, 0);
  player.heavy = Boolean(msg.heavy);
  player.dodge = Boolean(msg.dodge);
  player.guard = Boolean(msg.guard);
  player.lastUpdated = Date.now();
}

function recordAndBroadcastChat(roomId: string, player: ServerPlayer, text: string): ChatRecord {
  const { chats } = getOrCreateRoom(roomId);
  const msg: ChatRecord = {
    id: crypto.randomUUID(),
    playerId: player.id,
    name: player.name,
    colorIdx: player.colorIdx,
    text,
    ts: Date.now(),
  };
  chats.push(msg);
  if (chats.length > MAX_CHAT_HISTORY) {
    chats.splice(0, chats.length - MAX_CHAT_HISTORY);
  }
  broadcastToRoom(roomId, { type: 'chat:message', message: msg });
  return msg;
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '4kb' }));
  app.use(express.text({ limit: '4kb', type: 'text/plain' }));

  const server = http.createServer(app);
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.get('/api/health', (_req, res) => {
    let totalPlayers = 0;
    for (const p of rooms.values()) {
      totalPlayers += p.size;
    }
    res.json({ ok: true, rooms: rooms.size, players: totalPlayers });
  });

  // HTTP Multiplayer Fallback Endpoints (work seamlessly even if a proxy blocks WebSocket upgrades)
  app.post('/api/mp/join', (req, res) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const roomId = sanitizeRoomId(body.roomId);
    const prevId = typeof body.playerId === 'string' && body.playerId.length <= 64 ? body.playerId : '';
    const { players, chats } = getOrCreateRoom(roomId);

    const playerId = prevId && players.has(prevId) ? prevId : crypto.randomUUID();
    if (!players.has(playerId) && players.size >= MAX_PLAYERS_PER_ROOM) {
      res.status(429).json({ ok: false, error: 'ROOM_FULL' });
      return;
    }

    const existing = players.get(playerId);
    const player: ServerPlayer = {
      id: playerId,
      roomId,
      name: sanitizeName(body.name),
      colorIdx: existing ? existing.colorIdx : Math.floor(Math.random() * 8),
      mapId: sanitizeMapId(body.mapId),
      x: clampCoord(body.x, -16),
      y: clampNum(body.y, -40, 200, 3.2),
      z: clampCoord(body.z, 76),
      yaw: clampNum(body.yaw, -Math.PI * 4, Math.PI * 4, 1.05),
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
      transport: 'http',
    };
    players.set(playerId, player);
    broadcastToRoom(roomId, { type: 'player:joined', player }, playerId);

    res.json({
      ok: true,
      selfId: playerId,
      roomId,
      players: Array.from(players.values()),
      messages: chats.slice(-25),
    });
  });

  app.post('/api/mp/sync', (req, res) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const roomId = sanitizeRoomId(body.roomId);
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const sinceTs = clampNum(body.sinceTs, 0, Number.MAX_SAFE_INTEGER, 0);

    const { players, chats } = getOrCreateRoom(roomId);
    const player = players.get(playerId);
    if (!player) {
      res.status(404).json({ ok: false, error: 'NOT_JOINED' });
      return;
    }

    if (body.state && typeof body.state === 'object' && !Array.isArray(body.state)) {
      applyPlayerStateUpdate(player, body.state as Record<string, unknown>);
      broadcastToRoom(roomId, { type: 'player:state', player }, playerId);
    } else {
      player.lastUpdated = Date.now();
    }

    const recentMessages = sinceTs > 0 ? chats.filter((m) => m.ts > sinceTs) : chats.slice(-20);
    res.json({
      ok: true,
      players: Array.from(players.values()),
      messages: recentMessages,
    });
  });

  app.post('/api/mp/rename', (req, res) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const roomId = sanitizeRoomId(body.roomId);
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const player = rooms.get(roomId)?.get(playerId);
    if (!player) {
      res.status(404).json({ ok: false });
      return;
    }
    player.name = sanitizeName(body.name);
    player.lastUpdated = Date.now();
    broadcastToRoom(roomId, { type: 'player:updated', player });
    res.json({ ok: true });
  });

  app.post('/api/mp/chat', (req, res) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const roomId = sanitizeRoomId(body.roomId);
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const player = rooms.get(roomId)?.get(playerId);
    if (!player) {
      res.status(404).json({ ok: false });
      return;
    }
    const now = Date.now();
    const prevAt = httpChatCooldown.get(playerId) ?? 0;
    if (now - prevAt < CHAT_COOLDOWN_MS) {
      res.status(429).json({ ok: false });
      return;
    }
    const text = sanitizeChatText(body.text);
    if (!text) {
      res.status(400).json({ ok: false });
      return;
    }
    httpChatCooldown.set(playerId, now);
    const message = recordAndBroadcastChat(roomId, player, text);
    res.json({ ok: true, message });
  });

  app.post('/api/mp/leave', (req, res) => {
    let body: Record<string, unknown> = {};
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    } else if (req.body && typeof req.body === 'object') {
      body = req.body as Record<string, unknown>;
    }
    const roomId = sanitizeRoomId(body.roomId);
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    if (playerId && rooms.get(roomId)?.delete(playerId)) {
      httpChatCooldown.delete(playerId);
      broadcastToRoom(roomId, { type: 'player:left', id: playerId });
      cleanupRoomIfEmpty(roomId);
    }
    res.json({ ok: true });
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

        const { players, sockets, chats } = getOrCreateRoom(nextRoomId);
        if (!players.has(session.playerId) && players.size >= MAX_PLAYERS_PER_ROOM) {
          ws.send(JSON.stringify({ type: 'error', code: 'ROOM_FULL' }));
          return;
        }

        session.roomId = nextRoomId;
        sockets.add(session);

        const existing = players.get(session.playerId);
        const colorIdx = existing ? existing.colorIdx : Math.floor(Math.random() * 8);

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
          transport: 'ws',
        };

        players.set(session.playerId, player);

        ws.send(
          JSON.stringify({
            type: 'welcome',
            selfId: session.playerId,
            roomId: nextRoomId,
            players: Array.from(players.values()),
            messages: chats.slice(-25),
          })
        );

        broadcastToRoom(nextRoomId, { type: 'player:joined', player }, session.playerId);
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
        applyPlayerStateUpdate(current, msg);
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
        recordAndBroadcastChat(session.roomId, current, text);
      }
    });

    ws.on('close', () => {
      removeFromRoom(session);
    });

    ws.on('error', () => {
      removeFromRoom(session);
    });
  });

  // Heartbeat + prune stale HTTP/disconnected players every 8 seconds
  const heartbeat = setInterval(() => {
    const now = Date.now();
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

    for (const [roomId, players] of rooms.entries()) {
      for (const [id, player] of players.entries()) {
        if (player.transport === 'http' && now - player.lastUpdated > PLAYER_STALE_MS) {
          players.delete(id);
          httpChatCooldown.delete(id);
          broadcastToRoom(roomId, { type: 'player:left', id });
        }
      }
      cleanupRoomIfEmpty(roomId);
    }
  }, 8000);

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
