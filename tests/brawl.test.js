const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chooseAttackType, calcAttackHits, ATTACKS } = require('../server/mechanics');

function mkPlayer(overrides = {}) {
  return {
    id: 'A',
    alive: true,
    isInvincible: false,
    x: 0,
    y: 0,
    radius: 25,
    facingX: 1,
    facingY: 0,
    inputDx: 0,
    inputDy: 0,
    ...overrides,
  };
}

test('주먹 입력은 정면 중거리 타겟에게 스트레이트를 선택한다', () => {
  const attacker = mkPlayer({ id: 'A' });
  const target = mkPlayer({ id: 'B', x: 90, y: 0 });
  const attackType = chooseAttackType(attacker, [attacker, target], 'punch');
  assert.equal(attackType, 'straight');
});

test('주먹 입력은 근거리 타겟에게 훅을 선택한다', () => {
  const attacker = mkPlayer({ id: 'A' });
  const target = mkPlayer({ id: 'B', x: 45, y: 0 });
  const attackType = chooseAttackType(attacker, [attacker, target], 'punch');
  assert.equal(attackType, 'hook');
});

test('킥 입력은 정면 중거리 타겟에게 앞차기를 선택한다', () => {
  const attacker = mkPlayer({ id: 'A' });
  const target = mkPlayer({ id: 'B', x: 95, y: 0 });
  const attackType = chooseAttackType(attacker, [attacker, target], 'kick');
  assert.equal(attackType, 'frontKick');
});

test('킥 입력은 근거리 또는 붐비는 상황에서 돌려차기를 선택한다', () => {
  const attacker = mkPlayer({ id: 'A' });
  const close = mkPlayer({ id: 'B', x: 40, y: 0 });
  const attackType = chooseAttackType(attacker, [attacker, close], 'kick');
  assert.equal(attackType, 'roundKick');
});

test('스트레이트는 정면 타겟만 맞힌다', () => {
  const attacker = mkPlayer({ id: 'A' });
  const front = mkPlayer({ id: 'B', x: 70, y: 0 });
  const side = mkPlayer({ id: 'C', x: 0, y: 55 });
  const hits = calcAttackHits(attacker, [attacker, front, side], 'straight');
  assert.deepEqual(hits.map(h => h.target.id), ['B']);
});

test('훅은 넓은 각도의 근거리 타겟을 맞힌다', () => {
  const attacker = mkPlayer({ id: 'A' });
  const angled = mkPlayer({ id: 'B', x: 35, y: 40 });
  const hits = calcAttackHits(attacker, [attacker, angled], 'hook');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].force, ATTACKS.hook.knockback);
});

test('킥은 주먹보다 강하고 후딜이 길다', () => {
  assert.equal(ATTACKS.straight.knockback, 16);
  assert.equal(ATTACKS.hook.knockback, 23);
  assert.equal(ATTACKS.frontKick.knockback, 51);
  assert.equal(ATTACKS.roundKick.knockback, 44);
  assert.ok(ATTACKS.frontKick.recovery > ATTACKS.straight.recovery);
  assert.ok(ATTACKS.roundKick.recovery > ATTACKS.hook.recovery);
});

test('이미 맞은 타겟은 같은 공격에서 중복 히트하지 않는다', () => {
  const attacker = mkPlayer({ id: 'A' });
  const target = mkPlayer({ id: 'B', x: 70, y: 0 });
  const hits = calcAttackHits(attacker, [attacker, target], 'straight', new Set(['B']));
  assert.equal(hits.length, 0);
});

test('회피 무적과 죽은 플레이어는 맞지 않는다', () => {
  const attacker = mkPlayer({ id: 'A' });
  const invincible = mkPlayer({ id: 'B', x: 70, y: 0, isInvincible: true });
  const dead = mkPlayer({ id: 'C', x: 65, y: 0, alive: false });
  const hits = calcAttackHits(attacker, [attacker, invincible, dead], 'straight');
  assert.equal(hits.length, 0);
});
