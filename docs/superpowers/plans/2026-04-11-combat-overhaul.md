# Combat Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배치기 버튼 터치 캔슬 버그 수정, 이동 민감도 감소, 크리티컬 배치기 시스템 신설(밀착 → 대형 넉백), 크로스카운터 감지(동시 상호 크리티컬 → CLASH!! 이펙트).

**Architecture:** 배치기 히트 계산을 `server/mechanics.js`(순수 함수, 테스트 가능)로 추출. 서버가 `isCritical`/`isCrossCounter` 플래그를 판단해 브로드캐스트. 클라이언트는 document 레벨 터치 추적으로 버튼 캔슬 수정; game.js에 새 이펙트 함수 추가.

**Tech Stack:** Node.js + `node:test`(유닛 테스트), Socket.io, Three.js(클라이언트), Vanilla JS

---

## File Map

| 파일 | 변경 |
|---|---|
| `server/mechanics.js` | 신규: 배치기 상수 + `calcHits()` 순수 함수 |
| `server.js` | 수정: mechanics.js require, 이동 상수, punch-release 핸들러, 플레이어 초기화 |
| `public/js/game.js` | 수정: 터치 이벤트 재구조화, 새 이펙트 함수, `spawnPunchImpact` 시그니처 확장 |
| `public/js/ui.js` | 수정: punch-impact 이벤트에 `isCritical`/`isCrossCounter` 전달 |
| `public/css/style.css` | 수정: `@keyframes floatUp` 추가 |
| `tests/punch.test.js` | 신규: `calcHits()` 유닛 테스트 |
| `package.json` | 수정: test 스크립트 추가 |

---

### Task 1: 이동 상수 조정 + 테스트 인프라 준비

**Files:**
- Modify: `server.js:30-31`
- Modify: `package.json`
- Create: `tests/punch.test.js` (빈 파일)

- [ ] **Step 1: server.js 이동 상수 변경**

`server.js:30-31`의 두 줄을:
```js
const MOVE_SPEED = 2;
const FRICTION = 0.92;
```
아래로 교체:
```js
const MOVE_SPEED = 1.6;
const FRICTION = 0.85;
```

- [ ] **Step 2: package.json test 스크립트 추가**

`package.json`의 `"test"` 값을:
```json
"test": "echo \"Error: no test specified\" && exit 1"
```
아래로 교체:
```json
"test": "node --test tests/punch.test.js"
```

- [ ] **Step 3: 빈 테스트 파일 생성**

```bash
mkdir -p tests && touch tests/punch.test.js
```

- [ ] **Step 4: 서버 기동 확인**

```bash
node server.js
```
Expected: `[Noon Arena] Server running on http://localhost:3000`

Ctrl+C로 종료.

- [ ] **Step 5: Commit**

```bash
git add server.js package.json tests/punch.test.js
git commit -m "feat: 이동 마찰 증가 (FRICTION 0.85, MOVE_SPEED 1.6)"
```

---

### Task 2: server/mechanics.js 생성 + calcHits 유닛 테스트

**Files:**
- Create: `server/mechanics.js`
- Modify: `tests/punch.test.js`

- [ ] **Step 1: 실패하는 테스트 먼저 작성**

`tests/punch.test.js` 전체 내용:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcHits } = require('../server/mechanics');

function mkPlayer(overrides = {}) {
  return {
    id: 'a', alive: true, isInvincible: false,
    x: 400, y: 400, vx: 0, vy: 0,
    chargeTicks: 120, // 풀차지
    facingX: 1, facingY: 0,
    receivedCritFrom: null,
    ...overrides,
  };
}

test('범위 밖 타겟은 히트 없음', () => {
  const puncher = mkPlayer({ id: 'A', x: 0, y: 0 });
  const target  = mkPlayer({ id: 'B', x: 200, y: 0 }); // dist=200 > PUNCH_RANGE=120
  const hits = calcHits(puncher, [puncher, target], 0);
  assert.equal(hits.length, 0);
});

test('범위 내 일반 히트 — 크리티컬 아님', () => {
  const puncher = mkPlayer({ id: 'A', x: 0, y: 0 });
  const target  = mkPlayer({ id: 'B', x: 80, y: 0 }); // dist=80, PUNCH_CRITICAL_RANGE=55
  const hits = calcHits(puncher, [puncher, target], 0);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].isCritical, false);
  assert.equal(hits[0].isCrossCounter, false);
});

test('밀착 히트 — 크리티컬', () => {
  const puncher = mkPlayer({ id: 'A', x: 0, y: 0 });
  const target  = mkPlayer({ id: 'B', x: 40, y: 0 }); // dist=40 < PUNCH_CRITICAL_RANGE=55
  const hits = calcHits(puncher, [puncher, target], 0);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].isCritical, true);
  assert.equal(hits[0].isCrossCounter, false);
});

test('크리티컬 포스가 일반 포스보다 큼', () => {
  const puncher    = mkPlayer({ id: 'A', x: 0, y: 0 });
  const nearTarget = mkPlayer({ id: 'B', x: 40, y: 0 }); // 크리티컬
  const farTarget  = mkPlayer({ id: 'C', x: 80, y: 0 }); // 일반
  const nearHit = calcHits(puncher, [puncher, nearTarget], 0)[0];
  const farHit  = calcHits(puncher, [puncher, farTarget],  0)[0];
  assert.ok(nearHit.force > farHit.force, `크리티컬 force(${nearHit.force}) > 일반 force(${farHit.force})`);
});

test('크로스카운터 감지 — 10틱 이내 상호 크리티컬', () => {
  // A가 틱 5에 B를 크리티컬로 가격했음 → B.receivedCritFrom = { id:'A', tick:5 }
  const A = mkPlayer({ id: 'A', x: 40, y: 0 });
  const B = mkPlayer({ id: 'B', x: 0, y: 0, receivedCritFrom: { id: 'A', tick: 5 } });
  // 틱 10: B가 A를 크리티컬 범위에서 반격 (dist=40 < 55)
  const hits = calcHits(B, [A, B], 10);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].isCritical, true);
  assert.equal(hits[0].isCrossCounter, true);
});

test('크로스카운터 — 11틱 초과는 일반 크리티컬', () => {
  const A = mkPlayer({ id: 'A', x: 40, y: 0 });
  const B = mkPlayer({ id: 'B', x: 0, y: 0, receivedCritFrom: { id: 'A', tick: 0 } });
  const hits = calcHits(B, [A, B], 11); // 11틱 = 초과
  assert.equal(hits.length, 1);
  assert.equal(hits[0].isCritical, true);
  assert.equal(hits[0].isCrossCounter, false);
});

test('죽은 플레이어는 히트 안됨', () => {
  const puncher = mkPlayer({ id: 'A', x: 0, y: 0 });
  const dead    = mkPlayer({ id: 'B', x: 10, y: 0, alive: false });
  const hits = calcHits(puncher, [puncher, dead], 0);
  assert.equal(hits.length, 0);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npm test
```
Expected: `Error: Cannot find module '../server/mechanics'`

- [ ] **Step 3: server/mechanics.js 생성**

```bash
mkdir -p server
```

`server/mechanics.js`:
```js
// ─── 배치기 순수 로직 — 테스트 가능한 순수 함수만 포함 ──────────────────────

const PUNCH_MIN_FORCE = 8;
const PUNCH_MAX_FORCE = 40;      // ↑ 28에서 상향 (일반 풀차징 넉백)
const PUNCH_RANGE = 120;         // 배치기 유효 범위
const PUNCH_MAX_CHARGE = 120;    // 최대 차지 틱 (2초)
const PUNCH_MIN_CHARGE = 6;      // 최소 차지 틱 (0.1초)
const PUNCH_DURATION = 15;       // 펀치 애니메이션 틱
const PUNCH_CRITICAL_RANGE = 55; // 밀착 판정 거리 (플레이어 지름 딱 붙는 거리)
const PUNCH_CRITICAL_FORCE = 60; // 크리티컬 넉백 (60 × 1/0.15 ≈ 400 이동거리, 아레나 반지름 380)

/**
 * 배치기 발동 시 히트 결과 계산 — 순수 함수 (상태 변경 없음).
 *
 * @param {object} puncher       공격자 { id, x, y, chargeTicks, receivedCritFrom }
 * @param {Iterable} allPlayers  방의 전체 플레이어 목록
 * @param {number} tick          현재 게임 틱
 * @returns {Array<{target, force, nx, ny, isCritical, isCrossCounter, dist}>}
 */
function calcHits(puncher, allPlayers, tick) {
  const chargeRatio = Math.min(1, puncher.chargeTicks / PUNCH_MAX_CHARGE);
  const normalForce = PUNCH_MIN_FORCE + (PUNCH_MAX_FORCE - PUNCH_MIN_FORCE) * chargeRatio;
  const hits = [];

  for (const target of allPlayers) {
    if (target.id === puncher.id || !target.alive || target.isInvincible) continue;

    const dx = target.x - puncher.x;
    const dy = target.y - puncher.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > PUNCH_RANGE) continue;

    const isCritical = dist < PUNCH_CRITICAL_RANGE;
    const force = isCritical ? PUNCH_CRITICAL_FORCE : normalForce;

    let nx, ny;
    if (dist > 0.01) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      const a = Math.random() * Math.PI * 2;
      nx = Math.cos(a);
      ny = Math.sin(a);
    }

    // 크로스카운터: puncher가 최근에 target에게 크리티컬을 당했고, 지금 반격 크리티컬
    const isCrossCounter = isCritical &&
      puncher.receivedCritFrom !== null &&
      puncher.receivedCritFrom.id === target.id &&
      (tick - puncher.receivedCritFrom.tick) <= 10;

    hits.push({ target, force, nx, ny, isCritical, isCrossCounter, dist });
  }
  return hits;
}

module.exports = {
  calcHits,
  PUNCH_MIN_FORCE, PUNCH_MAX_FORCE, PUNCH_RANGE,
  PUNCH_MAX_CHARGE, PUNCH_MIN_CHARGE, PUNCH_DURATION,
  PUNCH_CRITICAL_RANGE, PUNCH_CRITICAL_FORCE,
};
```

- [ ] **Step 4: 테스트 재실행 — 7개 모두 통과 확인**

```bash
npm test
```
Expected:
```
▶ 범위 밖 타겟은 히트 없음
▶ 범위 내 일반 히트 — 크리티컬 아님
▶ 밀착 히트 — 크리티컬
▶ 크리티컬 포스가 일반 포스보다 큼
▶ 크로스카운터 감지 — 10틱 이내 상호 크리티컬
▶ 크로스카운터 — 11틱 초과는 일반 크리티컬
▶ 죽은 플레이어는 히트 안됨
```
모두 pass.

- [ ] **Step 5: Commit**

```bash
git add server/mechanics.js tests/punch.test.js package.json
git commit -m "feat: calcHits 순수 함수 + 크리티컬/크로스카운터 로직 + 유닛 테스트 7개"
```

---

### Task 3: server.js — mechanics.js 통합 + punch-release 핸들러 교체

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 상단에 mechanics.js require 추가**

`server.js` 최상단(첫 번째 `const` 선언 바로 위)에 추가:
```js
const {
  calcHits,
  PUNCH_MIN_FORCE, PUNCH_MAX_FORCE, PUNCH_RANGE,
  PUNCH_MAX_CHARGE, PUNCH_MIN_CHARGE, PUNCH_DURATION,
  PUNCH_CRITICAL_RANGE, PUNCH_CRITICAL_FORCE,
} = require('./server/mechanics');
```

- [ ] **Step 2: 중복 상수 6줄 삭제**

`server.js`에서 아래 6줄 삭제 (이제 mechanics.js에서 가져옴):
```js
const PUNCH_MIN_FORCE = 8;     // knockback at minimum charge
const PUNCH_MAX_FORCE = 28;    // knockback at full charge
const PUNCH_RANGE = 120;       // must be close to land a punch
const PUNCH_DURATION = 15;     // ticks of punch animation
const PUNCH_MAX_CHARGE = 120;  // max charge ticks (2 seconds)
const PUNCH_MIN_CHARGE = 6;    // min charge to fire (0.1 sec)
```

- [ ] **Step 3: createPlayer에 receivedCritFrom 필드 추가**

`server.js`의 `createPlayer` 함수 return 객체에서 `chargeTicks: 0,` 바로 다음 줄에 추가:
```js
receivedCritFrom: null,   // 크로스카운터 감지용: { id, tick }
```

- [ ] **Step 4: punch-release 핸들러 전체 교체**

기존 `socket.on('punch-release', ...)` 핸들러 전체를 아래로 교체:
```js
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
```

- [ ] **Step 5: 서버 기동 + 테스트 모두 통과 확인**

```bash
node server.js &
npm test
kill %1
```
Expected: 서버 기동 성공 + 7개 테스트 pass.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: server.js 배치기 — 크리티컬/크로스카운터 판정 + 포스 상향(max 40)"
```

---

### Task 4: 클라이언트 터치 이벤트 버그 수정 (game.js)

**Files:**
- Modify: `public/js/game.js:62` (game 객체)
- Modify: `public/js/game.js:1559-1565` (dashBtn 이벤트)

- [ ] **Step 1: game 객체에 punchTouchId 추가**

`public/js/game.js:62`의 줄:
```js
punchCharging: false, punchChargeStart: 0,
```
을 아래로 교체:
```js
punchCharging: false, punchChargeStart: 0,
punchTouchId: null,
```

- [ ] **Step 2: dashBtn 이벤트 리스너 재구조화**

`public/js/game.js`에서 아래 블록:
```js
if (dashBtn) {
  dashBtn.addEventListener('touchstart', e => { e.preventDefault(); startPunchCharge(); }, { passive: false });
  dashBtn.addEventListener('touchend', e => { e.preventDefault(); releasePunch(); }, { passive: false });
  dashBtn.addEventListener('touchcancel', e => { releasePunch(); }, { passive: false });
  dashBtn.addEventListener('mousedown', e => { e.preventDefault(); startPunchCharge(); });
  dashBtn.addEventListener('mouseup', e => { releasePunch(); });
}
```
을 아래로 교체:
```js
if (dashBtn) {
  dashBtn.addEventListener('touchstart', e => {
    e.preventDefault();
    if (game.punchCharging) return;
    game.punchTouchId = e.changedTouches[0].identifier;
    startPunchCharge();
  }, { passive: false });
  dashBtn.addEventListener('mousedown', e => { e.preventDefault(); startPunchCharge(); });
  dashBtn.addEventListener('mouseup', () => { releasePunch(); });
}

// 버튼 밖으로 손가락이 이동해도 원래 터치면 릴리즈
document.addEventListener('touchend', e => {
  if (game.punchTouchId === null) return;
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === game.punchTouchId) {
      game.punchTouchId = null;
      releasePunch();
      return;
    }
  }
}, { passive: false });

document.addEventListener('touchcancel', e => {
  if (game.punchTouchId === null) return;
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === game.punchTouchId) {
      game.punchTouchId = null;
      releasePunch();
      return;
    }
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add public/js/game.js
git commit -m "fix: 배치기 버튼 터치 캔슬 버그 수정 — document 레벨 touch ID 추적"
```

---

### Task 5: 크리티컬 이펙트 + 플로팅 텍스트 (game.js + style.css)

**Files:**
- Modify: `public/css/style.css` (애니메이션 추가)
- Modify: `public/js/game.js` (이펙트 함수 추가 + spawnPunchImpact 수정)

- [ ] **Step 1: style.css 끝에 floatUp 키프레임 추가**

`public/css/style.css` 파일 맨 끝에 추가:
```css
@keyframes floatUp {
  0%   { transform: translate(-50%, -50%) scale(1);    opacity: 1; }
  60%  { transform: translate(-50%, -120%) scale(1.2); opacity: 1; }
  100% { transform: translate(-50%, -180%) scale(0.8); opacity: 0; }
}
```

- [ ] **Step 2: game.js — serverCoordsToScreen 헬퍼 추가**

`public/js/game.js`에서 `// ─── 배치기 임팩트 이펙트` 주석 바로 위에 삽입:
```js
// ─── 서버 좌표 → 화면 픽셀 변환 ──────────────────────────────────────────────
function serverCoordsToScreen(sx, sy) {
  const { x: wx, z: wz } = serverToWorld(sx, sy);
  const vec = new THREE.Vector3(wx, 0, wz);
  vec.project(camera);
  const el = renderer.domElement;
  const rect = el.getBoundingClientRect();
  return {
    x: (vec.x + 1) / 2 * el.clientWidth  + rect.left,
    y: (-vec.y + 1) / 2 * el.clientHeight + rect.top,
  };
}
```

- [ ] **Step 3: game.js — spawnFloatingText 추가 (serverCoordsToScreen 바로 아래)**

```js
function spawnFloatingText(sx, sy, text, color, scale = 1) {
  const { x, y } = serverCoordsToScreen(sx, sy);
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = [
    'position:fixed',
    `left:${x}px`, `top:${y}px`,
    `font-size:${Math.round(28 * scale)}px`,
    'font-weight:900',
    `color:${color}`,
    'text-shadow:2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000',
    'pointer-events:none',
    'z-index:9998',
    'animation:floatUp 0.9s ease-out forwards',
  ].join(';');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}
```

- [ ] **Step 4: game.js — spawnCriticalImpact 추가 (spawnFloatingText 바로 아래)**

```js
function spawnCriticalImpact(sx, sy) {
  // 화면 전체 흰색 플래시
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0.8;pointer-events:none;z-index:9999;transition:opacity 0.3s ease-out';
  document.body.appendChild(flash);
  requestAnimationFrame(() => requestAnimationFrame(() => { flash.style.opacity = '0'; }));
  setTimeout(() => flash.remove(), 400);

  // 충격파 링 3개 연속 (55ms 간격)
  ['#ffffff', '#ffdd00', '#ff8800'].forEach((color, i) => {
    setTimeout(() => spawnShockwaveRing(sx, sy, 16, color, 8, 1.5), i * 55);
  });

  spawn3DParticles(sx, sy, 12, '#ffdd00', 2.0);
  spawn3DParticles(sx, sy, 8, '#ffffff', 1.5);
  shakeCamera(4, 300);
  spawnFloatingText(sx, sy, 'CRITICAL!', '#ff4400', 1.2);
}
```

- [ ] **Step 5: game.js — spawnCrossCounterEffect 추가 (spawnCriticalImpact 바로 아래)**

```js
function spawnCrossCounterEffect(sx, sy) {
  // 오렌지/흰색 번갈아 3회 플래시
  ['#ff6600', '#ffffff', '#ff6600'].forEach((bg, i) => {
    setTimeout(() => {
      const flash = document.createElement('div');
      flash.style.cssText = `position:fixed;inset:0;background:${bg};opacity:0.65;pointer-events:none;z-index:9999;transition:opacity 0.15s ease-out`;
      document.body.appendChild(flash);
      requestAnimationFrame(() => requestAnimationFrame(() => { flash.style.opacity = '0'; }));
      setTimeout(() => flash.remove(), 250);
    }, i * 150);
  });

  shakeCamera(6, 450);
  spawn3DParticles(sx, sy, 20, '#ff6600', 2.5);
  spawn3DParticles(sx, sy, 12, '#ffffff', 2.0);
  spawnFloatingText(sx, sy, 'CLASH!!', '#ff6600', 1.6);
}
```

- [ ] **Step 6: spawnPunchImpact 시그니처 + 분기 추가**

기존:
```js
function spawnPunchImpact(sx, sy, chargeRatio, hitCount) {
```
를 아래로 교체:
```js
function spawnPunchImpact(sx, sy, chargeRatio, hitCount, isCritical = false, isCrossCounter = false) {
```

그 다음 함수 본문 첫 줄(`const { x: wx, z: wz } = serverToWorld(sx, sy);` 바로 위)에 추가:
```js
if (isCrossCounter) { spawnCrossCounterEffect(sx, sy); return; }
if (isCritical)     { spawnCriticalImpact(sx, sy); return; }
```

- [ ] **Step 7: Commit**

```bash
git add public/js/game.js public/css/style.css
git commit -m "feat: 크리티컬 CRITICAL!/CLASH!! 이펙트 — 플래시, 충격파, 플로팅 텍스트"
```

---

### Task 6: ui.js — punch-impact 핸들러 업데이트

**Files:**
- Modify: `public/js/ui.js:497-501`

- [ ] **Step 1: punch-impact 핸들러 교체**

`public/js/ui.js:497-501`의 기존 코드:
```js
net.on('punch-impact', (data) => {
  if (window.gameRenderer && typeof window.gameRenderer.spawnPunchImpact === 'function') {
    window.gameRenderer.spawnPunchImpact(data.x, data.y, data.chargeRatio || 0, data.hitCount || 0);
  }
});
```
를 아래로 교체:
```js
net.on('punch-impact', (data) => {
  if (window.gameRenderer && typeof window.gameRenderer.spawnPunchImpact === 'function') {
    window.gameRenderer.spawnPunchImpact(
      data.x, data.y,
      data.chargeRatio || 0,
      data.hitCount || 0,
      data.isCritical || false,
      data.isCrossCounter || false,
    );
  }
});
```

- [ ] **Step 2: 최종 테스트 통과 확인**

```bash
npm test
```
Expected: 7개 pass.

- [ ] **Step 3: 브라우저 수동 확인 시나리오**

```bash
node server.js
```
두 탭(또는 두 기기)에서 `http://localhost:3000` 접속 후 확인:

| 시나리오 | 기대 결과 |
|---|---|
| 버튼 누르고 손가락 버튼 밖으로 이동 | 차징 유지, 손 떼면 발사 |
| 엣지 근처에서 조이스틱 놓기 | 이전보다 빠르게 멈춤 |
| 떨어진 거리(>55u)에서 배치기 | 일반 이펙트 (빨간 충격파) |
| 밀착(<55u)에서 배치기 | 흰 플래시 + CRITICAL! + 대형 넉백 |
| 두 플레이어 동시 밀착 배치기 | CLASH!! + 오렌지 플래시 교번 + 양쪽 날아감 |

- [ ] **Step 4: Commit**

```bash
git add public/js/ui.js
git commit -m "feat: ui.js punch-impact에 isCritical/isCrossCounter 연결 — 전투 개선 완료"
```

---

## 완료 기준

- `npm test` — 7개 유닛 테스트 모두 pass
- 배치기 버튼을 누르고 손가락이 밖으로 나가도 캔슬 없음
- 엣지 근처 조이스틱 놓으면 빠르게 감속 (혼자 죽는 빈도 대폭 감소)
- 밀착(55px 이내) 배치기 → CRITICAL! 이펙트 + 크리티컬 포스 60
- 두 플레이어 10틱(≈167ms) 이내 상호 밀착 배치기 → CLASH!! 이펙트
- 아레나 어느 위치에서도 크리티컬 맞으면 80~90% 확률 탈락
