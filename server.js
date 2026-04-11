const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const {
  calcHits,
  PUNCH_MIN_FORCE, PUNCH_MAX_FORCE, PUNCH_RANGE,
  PUNCH_MAX_CHARGE, PUNCH_MIN_CHARGE, PUNCH_DURATION,
  PUNCH_CRITICAL_RANGE, PUNCH_CRITICAL_FORCE,
} = require('./server/mechanics');

// ─── App Setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 5000,
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants ───────────────────────────────────────────────────────────────
const TICK_RATE = 60;
const TICK_MS = Math.floor(1000 / TICK_RATE);

const ARENA_CENTER_X = 400;
const ARENA_CENTER_Y = 400;
const ARENA_INITIAL_RADIUS = 380;
const ARENA_MIN_RADIUS = 150;
const ARENA_SHRINK_START_TICK = 30 * TICK_RATE;   // tick 1800
const ARENA_SHRINK_END_TICK = 60 * TICK_RATE;     // tick 3600
const GAME_MAX_TICKS = 60 * TICK_RATE;            // 60 seconds

const PLAYER_RADIUS = 25;
const MOVE_SPEED = 1.6;
const FRICTION = 0.85;
const PUSH_FORCE = 4;
// const PUNCH_ARC = 0.45;     // [360도 폭발형으로 변경] 더 이상 사용하지 않음
const CHARGE_SLOW = 0.4;       // movement speed multiplier while charging

const DODGE_DURATION = 15;     // ticks
const DODGE_COOLDOWN = 300;    // ticks (5 sec)
const DODGE_BURST = 6;         // lateral burst speed

const EDGE_ZONE = 12;          // edge zone width where players teeter
const EDGE_DRAG = 0.92;        // drag in edge zone (약한 저항, 걸리는 느낌)
const FALL_BUFFER = 5;         // must go past edge by this much to actually fall

const MAX_PLAYERS = 10;
const COUNTDOWN_TICKS = 3 * TICK_RATE; // 3 seconds

const EMOJI_POOL = [
  '😀','😎','🤡','👻','👽','🤖','🦊','🐸',
  '🐷','🦁','🐻','🐼','🐨','🦄','🐙',
];

const COLOR_POOL = [
  '#ff6b6b', '#ffa502', '#2ed573', '#1e90ff', '#a55eea',
  '#ff6348', '#7bed9f', '#70a1ff', '#ff4757', '#eccc68',
];

const BOT_NAMES = [
  '살쾡이', '뚱보곰', '번개토끼', '돌주먹', '바람돌이',
  '무적거북', '꼬마용', '철벽이', '독수리눈', '불도저',
];

const INPUT_RATE_LIMIT = 120; // max inputs per second per player

// ─── Room Storage ────────────────────────────────────────────────────────────
const rooms = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function pickEmoji(usedEmojis) {
  const available = EMOJI_POOL.filter(e => !usedEmojis.includes(e));
  const pool = available.length > 0 ? available : EMOJI_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

function createPlayer(id, nickname, emoji, color) {
  // Random spawn within inner area of arena
  const angle = Math.random() * Math.PI * 2;
  const dist = 80 + Math.random() * 180; // spread across arena but not at edge
  return {
    id,
    nickname,
    emoji,
    color,
    x: ARENA_CENTER_X + Math.cos(angle) * dist,
    y: ARENA_CENTER_Y + Math.sin(angle) * dist,
    vx: 0,
    vy: 0,
    radius: PLAYER_RADIUS,
    alive: true,
    // Input state
    inputDx: 0,
    inputDy: 0,
    // Punch state
    charging: false,
    chargeTicks: 0,
    receivedCritFrom: null,   // 크로스카운터 감지용: { id, tick }
    punching: false,
    punchTicks: 0,
    // Dodge state
    dodging: false,
    dodgeTicks: 0,
    dodgeCooldown: 0,
    isInvincible: false,
    // Facing direction (last non-zero input)
    facingX: 1,
    facingY: 0,
    // Edge teetering
    teetering: false,
    // Tracking
    eliminatedBy: null,
    rank: 0,
    // Rate limiting
    inputCount: 0,
    inputResetTime: Date.now(),
    // Bot flag
    isBot: false,
  };
}

function createRoom(hostId) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId,
    players: new Map(),
    phase: 'lobby',       // lobby → countdown → playing → gameover
    tickTimer: null,
    tick: 0,
    countdownTick: 0,
    arena: {
      x: ARENA_CENTER_X,
      y: ARENA_CENTER_Y,
      radius: ARENA_INITIAL_RADIUS,
    },
    rankings: [],
    eliminationOrder: 0,
    isSolo: false,
  };
  rooms.set(code, room);
  return room;
}

// ─── Physics ─────────────────────────────────────────────────────────────────
function getArenaRadius(tick) {
  if (tick < ARENA_SHRINK_START_TICK) return ARENA_INITIAL_RADIUS;
  if (tick >= ARENA_SHRINK_END_TICK) return ARENA_MIN_RADIUS;
  const progress = (tick - ARENA_SHRINK_START_TICK) / (ARENA_SHRINK_END_TICK - ARENA_SHRINK_START_TICK);
  return ARENA_INITIAL_RADIUS - (ARENA_INITIAL_RADIUS - ARENA_MIN_RADIUS) * progress;
}

function updatePlayer(player) {
  if (!player.alive) return;

  // Cooldowns
  if (player.dodgeCooldown > 0) player.dodgeCooldown--;

  // Charge tick
  if (player.charging) {
    player.chargeTicks = Math.min(player.chargeTicks + 1, PUNCH_MAX_CHARGE);
  }

  // Punch animation tick
  if (player.punching) {
    player.punchTicks--;
    if (player.punchTicks <= 0) {
      player.punching = false;
    }
  }

  // Dodge tick
  if (player.dodging) {
    player.dodgeTicks--;
    player.isInvincible = true;
    if (player.dodgeTicks <= 0) {
      player.dodging = false;
      player.isInvincible = false;
    }
  }

  // Apply movement input (slower while charging)
  const speedMult = player.charging ? CHARGE_SLOW : 1;
  player.vx += player.inputDx * MOVE_SPEED * speedMult;
  player.vy += player.inputDy * MOVE_SPEED * speedMult;

  // Apply friction
  player.vx *= FRICTION;
  player.vy *= FRICTION;

  // Update position
  player.x += player.vx;
  player.y += player.vy;
}

function resolveCollisions(players) {
  const alive = players.filter(p => p.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = a.radius + b.radius;

      if (dist < minDist && dist > 0.001) {
        // Normalize collision normal
        const nx = dx / dist;
        const ny = dy / dist;

        // Separate overlapping circles
        const overlap = (minDist - dist) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;

        // Skip knockback if either is invincible
        if (a.isInvincible || b.isInvincible) continue;

        // Normal body collision - symmetric push
        b.vx += nx * PUSH_FORCE;
        b.vy += ny * PUSH_FORCE;
        a.vx -= nx * PUSH_FORCE;
        a.vy -= ny * PUSH_FORCE;
      }
    }
  }
}

function checkArenaElimination(room) {
  const { arena, players } = room;
  const alivePlayers = [...players.values()].filter(p => p.alive);

  for (const player of alivePlayers) {
    const dx = player.x - arena.x;
    const dy = player.y - arena.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const edgeStart = arena.radius - EDGE_ZONE - player.radius;
    const fallPoint = arena.radius + FALL_BUFFER;

    if (dist > fallPoint) {
      // Fully past the edge + buffer → eliminate
      eliminatePlayer(room, player);
    } else if (dist + player.radius > arena.radius - EDGE_ZONE) {
      // In the edge zone → teetering! Feels like wading through mud
      player.teetering = true;

      // Apply drag only (no push back - just resistance)
      player.vx *= EDGE_DRAG;
      player.vy *= EDGE_DRAG;
    } else {
      player.teetering = false;
    }
  }
}

function eliminatePlayer(room, player) {
  player.alive = false;
  player.vx = 0;
  player.vy = 0;
  room.eliminationOrder++;

  const aliveCount = [...room.players.values()].filter(p => p.alive).length;
  player.rank = aliveCount + 1;

  // Try to determine who pushed them (closest alive player)
  let killerName = 'arena';
  let closestDist = Infinity;
  for (const other of room.players.values()) {
    if (other.id === player.id || !other.alive) continue;
    const dx = other.x - player.x;
    const dy = other.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist && dist < 200) {
      closestDist = dist;
      killerName = other.nickname;
    }
  }
  player.eliminatedBy = killerName;

  io.to(room.code).emit('player-eliminated', {
    playerId: player.id,
    playerName: player.nickname,
    playerEmoji: player.emoji,
    killerName,
    rank: player.rank,
  });

  // 솔로 모드: 사람이 죽으면 즉시 종료
  if (room.isSolo && !player.isBot) {
    // 남은 봇들에게 중심 거리 기준 순위 부여
    const aliveBots = [...room.players.values()].filter(p => p.alive);
    aliveBots.sort((a, b) => {
      const distA = Math.sqrt((a.x - ARENA_CENTER_X) ** 2 + (a.y - ARENA_CENTER_Y) ** 2);
      const distB = Math.sqrt((b.x - ARENA_CENTER_X) ** 2 + (b.y - ARENA_CENTER_Y) ** 2);
      return distA - distB;
    });
    // 1등부터 순서대로 rank 부여
    for (let i = 0; i < aliveBots.length; i++) {
      aliveBots[i].rank = i + 1;
      aliveBots[i].alive = false;
    }
    endGame(room, aliveBots[0] || null);
    return;
  }

  // Check win condition
  const alive = [...room.players.values()].filter(p => p.alive);
  if (alive.length <= 1) {
    endGame(room, alive[0] || null);
  }
}

function endGame(room, winner) {
  room.phase = 'gameover';

  // Build rankings
  const rankings = [...room.players.values()]
    .sort((a, b) => a.rank - b.rank)
    .map((p, i) => ({
      rank: p.alive ? 1 : p.rank,
      id: p.id,
      nickname: p.nickname,
      emoji: p.emoji,
    }));

  // Winner gets rank 1
  if (winner) {
    winner.rank = 1;
  }

  room.rankings = rankings;

  io.to(room.code).emit('game-over', {
    winner: winner ? { id: winner.id, nickname: winner.nickname, emoji: winner.emoji } : null,
    rankings,
  });

  stopGameLoop(room);
}

// ─── Game Loop ───────────────────────────────────────────────────────────────
function startCountdown(room) {
  room.phase = 'countdown';
  room.countdownTick = COUNTDOWN_TICKS;

  io.to(room.code).emit('phase-change', { phase: 'countdown', duration: 3 });

  room.tickTimer = setInterval(() => {
    room.countdownTick--;
    const secondsLeft = Math.ceil(room.countdownTick / TICK_RATE);

    if (room.countdownTick % TICK_RATE === 0) {
      io.to(room.code).emit('countdown', { count: secondsLeft });
    }

    if (room.countdownTick <= 0) {
      clearInterval(room.tickTimer);
      startPlaying(room);
    }
  }, TICK_MS);
}

function startPlaying(room) {
  room.phase = 'playing';
  room.tick = 0;
  room.eliminationOrder = 0;
  room.arena.radius = ARENA_INITIAL_RADIUS;

  io.to(room.code).emit('phase-change', { phase: 'playing' });

  room.tickTimer = setInterval(() => {
    try { gameTick(room); }
    catch (e) { console.error('gameTick error:', e); }
  }, TICK_MS);
}

function gameTick(room) {
  if (room.phase !== 'playing') return;

  room.tick++;

  // Update arena
  room.arena.radius = getArenaRadius(room.tick);

  // Update AI bots
  const playerList = [...room.players.values()];
  for (const player of playerList) {
    if (player.isBot && player.alive) updateBotAI(player, room);
  }

  // Update all players
  for (const player of playerList) {
    updatePlayer(player);
  }

  // Resolve collisions
  resolveCollisions(playerList);

  // Check arena boundary eliminations
  checkArenaElimination(room);

  // Time's up — eliminate everyone still alive except the one closest to center
  if (room.tick >= GAME_MAX_TICKS && room.phase === 'playing') {
    const alive = playerList.filter(p => p.alive);
    if (alive.length > 1) {
      // Player closest to center wins
      alive.sort((a, b) => {
        const distA = Math.sqrt((a.x - ARENA_CENTER_X) ** 2 + (a.y - ARENA_CENTER_Y) ** 2);
        const distB = Math.sqrt((b.x - ARENA_CENTER_X) ** 2 + (b.y - ARENA_CENTER_Y) ** 2);
        return distA - distB;
      });
      const winner = alive[0];
      for (let i = alive.length - 1; i >= 1; i--) {
        eliminatePlayer(room, alive[i]);
      }
      if (room.phase === 'playing') {
        endGame(room, winner);
      }
    } else {
      endGame(room, alive[0] || null);
    }
    return;
  }

  // Broadcast state
  broadcastGameState(room);
}

function broadcastGameState(room) {
  const players = [...room.players.values()].map(p => ({
    id: p.id,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    radius: p.radius,
    emoji: p.emoji,
    color: p.color,
    nickname: p.nickname,
    alive: p.alive,
    punching: p.punching,
    charging: p.charging,
    chargeRatio: p.charging ? Math.min(1, p.chargeTicks / PUNCH_MAX_CHARGE) : 0,
    dodging: p.dodging,
    isInvincible: p.isInvincible,
    dodgeCooldown: p.dodgeCooldown,
    facingX: p.facingX,
    facingY: p.facingY,
    teetering: p.teetering,
  }));

  io.to(room.code).emit('game-state', {
    players,
    arena: {
      x: room.arena.x,
      y: room.arena.y,
      radius: room.arena.radius,
    },
    tick: room.tick,
    time: Math.max(0, 60 - room.tick / TICK_RATE),
    phase: room.phase,
  });
}

function stopGameLoop(room) {
  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
}

function resetRoomForRestart(room) {
  stopGameLoop(room);
  room.tick = 0;
  room.arena.radius = ARENA_INITIAL_RADIUS;
  room.rankings = [];
  room.eliminationOrder = 0;

  const usedEmojis = [];
  let colorIdx = 0;
  for (const player of room.players.values()) {
    const emoji = pickEmoji(usedEmojis);
    usedEmojis.push(emoji);
    const color = COLOR_POOL[colorIdx % COLOR_POOL.length];
    const wasBot = player.isBot;
    Object.assign(player, createPlayer(player.id, player.nickname, emoji, color));
    player.isBot = wasBot;
    player._botPersonality = null; // 새 성격 부여
    colorIdx++;
  }
}

function getPlayerList(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    nickname: p.nickname,
    emoji: p.emoji,
    isHost: p.id === room.hostId,
  }));
}

// ─── AI Bot Logic ────────────────────────────────────────────────────────────
function updateBotAI(bot, room) {
  const arena = room.arena;
  const tick = room.tick;

  // Distance to arena center
  const toCenterX = arena.x - bot.x;
  const toCenterY = arena.y - bot.y;
  const distToCenter = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY);

  // Find nearest alive target (no human preference - bots fight each other too)
  let nearestTarget = null;
  let nearestDist = Infinity;

  for (const other of room.players.values()) {
    if (other.id === bot.id || !other.alive) continue;
    const dx = other.x - bot.x;
    const dy = other.y - bot.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < nearestDist) {
      nearestDist = d;
      nearestTarget = other;
    }
  }

  // Bot personality - much weaker and more varied
  const personality = bot._botPersonality || (bot._botPersonality = {
    aggression: 0.3 + Math.random() * 0.5,      // 0.3-0.8
    wanderSpeed: 0.3 + Math.random() * 0.5,     // 0.3-0.8
    punchRange: 50 + Math.random() * 30,         // 50-80
    edgeSense: 0.75 + Math.random() * 0.15,     // 0.75-0.9 (how close to edge before retreating)
    clumsiness: Math.random() * 0.4,             // 0-0.4 (random jitter added to movement)
    phase: Math.random() * Math.PI * 2,
  });

  let dx = 0, dy = 0;

  // Priority 1: stay away from arena edge (but react later and weaker)
  const edgeThreshold = arena.radius * personality.edgeSense;
  if (distToCenter > edgeThreshold) {
    const nx = toCenterX / distToCenter;
    const ny = toCenterY / distToCenter;
    const urgency = (distToCenter - edgeThreshold) / (arena.radius - edgeThreshold);
    dx += nx * (0.3 + urgency * 0.5);
    dy += ny * (0.3 + urgency * 0.5);
  }

  // Priority 2: chase target (weaker pursuit, no human preference)
  const target = nearestTarget;
  if (target) {
    const tdx = target.x - bot.x;
    const tdy = target.y - bot.y;
    const td = Math.sqrt(tdx * tdx + tdy * tdy);
    if (td > 0.01 && td < 150 * personality.aggression) {
      dx += (tdx / td) * personality.aggression * 0.4;
      dy += (tdy / td) * personality.aggression * 0.4;
    }

    // 봇 차징 시작 — 가까울 때 확률적으로 차징 개시
    if (td < personality.punchRange && !bot.punching && !bot.charging) {
      bot.facingX = tdx / td;
      bot.facingY = tdy / td;
      if (Math.random() < 0.08 * personality.aggression) {
        bot.charging = true;
        bot.chargeTicks = 0;
        // 목표 차징 틱 설정 (0.3~1.5초 = 18~90틱)
        bot._chargeTarget = Math.floor(18 + Math.random() * 72 * personality.aggression);
      }
    }

    // 봇 차징 중 — 목표 틱 도달하면 릴리즈
    if (bot.charging && bot.chargeTicks >= (bot._chargeTarget || 30)) {
      const charge = Math.min(bot.chargeTicks, PUNCH_MAX_CHARGE);
      bot.charging = false;
      bot.chargeTicks = 0;
      bot.punching = true;
      bot.punchTicks = PUNCH_DURATION;

      const chargeRatio = Math.min(1, charge / PUNCH_MAX_CHARGE);
      const force = PUNCH_MIN_FORCE + (PUNCH_MAX_FORCE - PUNCH_MIN_FORCE) * chargeRatio;

      // 360도 방사형 넉백
      let botHitCount = 0;
      for (const t2 of room.players.values()) {
        if (t2.id === bot.id || !t2.alive || t2.isInvincible) continue;
        const hx = t2.x - bot.x;
        const hy = t2.y - bot.y;
        const hd = Math.sqrt(hx * hx + hy * hy);
        if (hd > PUNCH_RANGE) continue;
        if (hd > 0.01) {
          t2.vx += (hx / hd) * force;
          t2.vy += (hy / hd) * force;
        } else {
          const rAngle = Math.random() * Math.PI * 2;
          t2.vx += Math.cos(rAngle) * force;
          t2.vy += Math.sin(rAngle) * force;
        }
        botHitCount++;
      }

      // 봇 펀치 임팩트 이벤트
      io.to(room.code).emit('punch-impact', {
        x: bot.x, y: bot.y,
        chargeRatio,
        hitCount: botHitCount,
        playerId: bot.id,
      });
    }

    // Dodge - much rarer
    if (target.charging && td < 60 && !bot.dodging && bot.dodgeCooldown <= 0 && Math.random() < 0.01) {
      bot.dodging = true;
      bot.dodgeTicks = DODGE_DURATION;
      bot.dodgeCooldown = DODGE_COOLDOWN;
      bot.isInvincible = true;
      const perpX = -tdy / td;
      const perpY = tdx / td;
      const side = Math.random() < 0.5 ? 1 : -1;
      bot.vx += perpX * DODGE_BURST * side;
      bot.vy += perpY * DODGE_BURST * side;
    }
  }

  // Wander - change direction randomly instead of smooth circle
  if (!personality.wanderDx || Math.random() < 0.02) {
    // Pick a new random direction occasionally
    const angle = Math.random() * Math.PI * 2;
    personality.wanderDx = Math.cos(angle);
    personality.wanderDy = Math.sin(angle);
  }
  dx += personality.wanderDx * personality.wanderSpeed;
  dy += personality.wanderDy * personality.wanderSpeed;

  // Add clumsiness - random jitter makes bots less precise
  dx += (Math.random() - 0.5) * personality.clumsiness;
  dy += (Math.random() - 0.5) * personality.clumsiness;

  // Normalize
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag > 1) { dx /= mag; dy /= mag; }

  bot.inputDx = dx;
  bot.inputDy = dy;

  // Update facing
  if (mag > 0.1) {
    bot.facingX = dx / (mag > 1 ? mag : 1);
    bot.facingY = dy / (mag > 1 ? mag : 1);
  }
}

function addBotsToRoom(room, count) {
  const usedEmojis = [...room.players.values()].map(p => p.emoji);
  let colorIdx = room.players.size;

  for (let i = 0; i < count; i++) {
    const botId = `bot_${room.code}_${i}`;
    const name = BOT_NAMES[i % BOT_NAMES.length];
    const emoji = pickEmoji(usedEmojis);
    usedEmojis.push(emoji);
    const color = COLOR_POOL[colorIdx % COLOR_POOL.length];
    colorIdx++;

    const player = createPlayer(botId, name, emoji, color);
    player.isBot = true;
    room.players.set(botId, player);
  }
}

// ─── Socket.io Connection ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentRoom = null;

  // ── Create Room ──────────────────────────────────────────────────────────
  socket.on('create-room', (data, callback) => {
    const nickname = (data && data.nickname) ? String(data.nickname).slice(0, 12) : 'Player';
    const room = createRoom(socket.id);
    currentRoom = room.code;

    const emoji = pickEmoji([]);
    const color = COLOR_POOL[0];
    const player = createPlayer(socket.id, nickname, emoji, color);
    room.players.set(socket.id, player);

    socket.join(room.code);

    const respond = typeof callback === 'function' ? callback : () => {};
    respond({
      success: true,
      roomCode: room.code,
      playerId: socket.id,
      players: getPlayerList(room),
    });
  });

  // ── Join Room ────────────────────────────────────────────────────────────
  socket.on('join-room', (data, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};

    if (!data || !data.roomCode) {
      return respond({ success: false, error: '방 코드를 입력하세요.' });
    }

    const roomCode = String(data.roomCode).trim();
    const room = rooms.get(roomCode);

    if (!room) {
      return respond({ success: false, error: '존재하지 않는 방입니다.' });
    }
    if (room.phase !== 'lobby') {
      return respond({ success: false, error: '이미 게임이 진행 중입니다.' });
    }
    if (room.players.size >= MAX_PLAYERS) {
      return respond({ success: false, error: '방이 가득 찼습니다. (최대 10명)' });
    }

    const nickname = (data.nickname) ? String(data.nickname).slice(0, 12) : 'Player';
    const usedEmojis = [...room.players.values()].map(p => p.emoji);
    const emoji = pickEmoji(usedEmojis);
    const color = COLOR_POOL[room.players.size % COLOR_POOL.length];
    const player = createPlayer(socket.id, nickname, emoji, color);

    room.players.set(socket.id, player);
    currentRoom = room.code;
    socket.join(room.code);

    const playerList = getPlayerList(room);

    respond({
      success: true,
      roomCode: room.code,
      playerId: socket.id,
      players: playerList,
    });

    // Notify others
    socket.to(room.code).emit('player-joined', {
      player: { id: socket.id, nickname, emoji, isHost: false },
      players: playerList,
    });
  });

  // ── Start Game ───────────────────────────────────────────────────────────
  socket.on('start-game', (data, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const room = currentRoom ? rooms.get(currentRoom) : null;

    if (!room) return respond({ success: false, error: '방을 찾을 수 없습니다.' });
    if (room.hostId !== socket.id) return respond({ success: false, error: '방장만 시작할 수 있습니다.' });
    if (room.players.size < 2) return respond({ success: false, error: '2명 이상 필요합니다. (혼자하기는 로비에서!)' });
    if (room.phase !== 'lobby') return respond({ success: false, error: '이미 시작했습니다.' });

    respond({ success: true });
    startCountdown(room);
  });

  // ── Solo Start (with AI bots) ───────────────────────────────────────────
  socket.on('solo-start', (data, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const nickname = (data && data.nickname) ? String(data.nickname).slice(0, 12) : 'Player';

    // Create room
    const room = createRoom(socket.id);
    currentRoom = room.code;

    const emoji = pickEmoji([]);
    const color = COLOR_POOL[0];
    const player = createPlayer(socket.id, nickname, emoji, color);
    room.players.set(socket.id, player);
    socket.join(room.code);

    // Add 9 AI bots
    room.isSolo = true;
    addBotsToRoom(room, 9);

    respond({
      success: true,
      roomCode: room.code,
      playerId: socket.id,
      players: getPlayerList(room),
    });

    // Start game immediately
    startCountdown(room);
  });

  // ── Player Input (Movement) ──────────────────────────────────────────────
  socket.on('player-input', (data) => {
    const room = currentRoom ? rooms.get(currentRoom) : null;
    if (!room || room.phase !== 'playing') return;

    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;

    // Rate limiting
    const now = Date.now();
    if (now - player.inputResetTime > 1000) {
      player.inputCount = 0;
      player.inputResetTime = now;
    }
    player.inputCount++;
    if (player.inputCount > INPUT_RATE_LIMIT) return;

    if (data && typeof data.dx === 'number' && typeof data.dy === 'number') {
      // Normalize input to max magnitude 1
      let dx = data.dx;
      let dy = data.dy;
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag > 1) {
        dx /= mag;
        dy /= mag;
      }
      player.inputDx = dx;
      player.inputDy = dy;

      // Update facing direction
      if (mag > 0.1) {
        player.facingX = dx / (mag > 1 ? mag : 1);
        player.facingY = dy / (mag > 1 ? mag : 1);
      }
    }
  });

  // ── Charged Punch ────────────────────────────────────────────────────────
  socket.on('punch-start', () => {
    const room = currentRoom ? rooms.get(currentRoom) : null;
    if (!room || room.phase !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive || player.punching) return;

    player.charging = true;
    player.chargeTicks = 0;
  });

  socket.on('punch-release', (data) => {
    const room = currentRoom ? rooms.get(currentRoom) : null;
    if (!room || room.phase !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive || !player.charging) return;

    const charge = Math.min(player.chargeTicks, PUNCH_MAX_CHARGE);
    player.charging = false;
    player.chargeTicks = 0;

    if (charge < PUNCH_MIN_CHARGE) return;

    player.punching = true;
    player.punchTicks = PUNCH_DURATION;

    const chargeRatio = Math.min(1, charge / PUNCH_MAX_CHARGE);

    const hits = calcHits(player, room.players.values(), room.tick);

    let hitCount = 0;
    let hasCritical = false;
    let hasCrossCounter = false;

    for (const hit of hits) {
      const { target, force, nx, ny, isCritical, isCrossCounter } = hit;
      target.vx += nx * force;
      target.vy += ny * force;
      hitCount++;
      if (isCritical) {
        hasCritical = true;
        target.receivedCritFrom = { id: player.id, tick: room.tick };
      }
      if (isCrossCounter) hasCrossCounter = true;
    }

    io.to(room.code).emit('punch-impact', {
      x: player.x, y: player.y,
      chargeRatio,
      hitCount,
      playerId: player.id,
      isCritical: hasCritical,
      isCrossCounter: hasCrossCounter,
    });

    // 반동: 히트 수에 비례
    const fx = player.facingX, fy = player.facingY;
    const fMag = Math.sqrt(fx * fx + fy * fy);
    const nfx = fMag > 0.01 ? fx / fMag : 1;
    const nfy = fMag > 0.01 ? fy / fMag : 0;
    if (hitCount > 0) {
      player.vx -= nfx * Math.min(hitCount * 2, 6);
      player.vy -= nfy * Math.min(hitCount * 2, 6);
    }
  });

  // Keep backward compat: old 'dash' event acts as instant min-charge punch
  socket.on('dash', () => {
    const room = currentRoom ? rooms.get(currentRoom) : null;
    if (!room || room.phase !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;
    // Treat as a quick jab
    player.punching = true;
    player.punchTicks = PUNCH_DURATION;
    player.charging = false;
    player.chargeTicks = 0;
  });

  // ── Dodge ────────────────────────────────────────────────────────────────
  socket.on('dodge', () => {
    const room = currentRoom ? rooms.get(currentRoom) : null;
    if (!room || room.phase !== 'playing') return;

    const player = room.players.get(socket.id);
    if (!player || !player.alive || player.dodging || player.dodgeCooldown > 0) return;

    player.dodging = true;
    player.dodgeTicks = DODGE_DURATION;
    player.dodgeCooldown = DODGE_COOLDOWN;
    player.isInvincible = true;

    // Lateral burst — perpendicular to facing direction
    const perpX = -player.facingY;
    const perpY = player.facingX;

    // Choose the side closer to the player's current input direction
    const dot = player.inputDx * perpX + player.inputDy * perpY;
    const sign = dot >= 0 ? 1 : -1;

    player.vx += perpX * DODGE_BURST * sign;
    player.vy += perpY * DODGE_BURST * sign;
  });

  // ── Restart Game ─────────────────────────────────────────────────────────
  socket.on('restart-game', (data, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const room = currentRoom ? rooms.get(currentRoom) : null;

    if (!room) return respond({ success: false, error: '방을 찾을 수 없습니다.' });
    if (room.hostId !== socket.id) return respond({ success: false, error: '방장만 재시작할 수 있습니다.' });
    if (room.phase !== 'gameover') return respond({ success: false, error: '게임이 끝난 후에만 재시작할 수 있습니다.' });

    resetRoomForRestart(room);
    room.phase = 'lobby';

    respond({ success: true });

    io.to(room.code).emit('phase-change', { phase: 'lobby' });
    io.to(room.code).emit('room-update', { players: getPlayerList(room) });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const player = room.players.get(socket.id);
    room.players.delete(socket.id);

    // If the room is empty, clean up
    if (room.players.size === 0) {
      stopGameLoop(room);
      rooms.delete(room.code);
      return;
    }

    // Transfer host if the host left
    if (room.hostId === socket.id) {
      const newHost = room.players.keys().next().value;
      room.hostId = newHost;
    }

    // If game is playing and player was alive, mark as eliminated
    if (room.phase === 'playing' && player && player.alive) {
      player.alive = false;
      room.eliminationOrder++;
      const aliveCount = [...room.players.values()].filter(p => p.alive).length;
      player.rank = aliveCount + 1;

      io.to(room.code).emit('player-eliminated', {
        playerId: socket.id,
        playerName: player.nickname,
        playerEmoji: player.emoji,
        killerName: 'disconnect',
        rank: player.rank,
      });

      // Check win condition
      const alive = [...room.players.values()].filter(p => p.alive);
      if (alive.length <= 1 && room.phase === 'playing') {
        endGame(room, alive[0] || null);
      }
    }

    // Notify remaining players
    io.to(room.code).emit('player-left', {
      playerId: socket.id,
      playerName: player ? player.nickname : 'Unknown',
      players: getPlayerList(room),
    });
  });
});

// ─── Start Server ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Noon Arena] Server running on http://localhost:${PORT}`);
});
