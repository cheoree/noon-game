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
