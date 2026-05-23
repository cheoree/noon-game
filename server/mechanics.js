// ─── 배치기 순수 로직 — 테스트 가능한 순수 함수만 포함 ──────────────────────

const PUNCH_MIN_FORCE = 8;
const PUNCH_MAX_FORCE = 40;      // ↑ 28에서 상향 (일반 풀차징 넉백)
const PUNCH_RANGE = 120;         // 배치기 유효 범위
const PUNCH_MAX_CHARGE = 120;    // 최대 차지 틱 (2초)
const PUNCH_MIN_CHARGE = 6;      // 최소 차지 틱 (0.1초)
const PUNCH_DURATION = 15;       // 펀치 애니메이션 틱
const PUNCH_CRITICAL_RANGE = 55; // 밀착 판정 거리 (플레이어 지름 딱 붙는 거리)
const PUNCH_CRITICAL_FORCE = 60; // 크리티컬 넉백

// ─── 난투 공격 데이터 ───────────────────────────────────────────────────────

const ATTACKS = {
  straight: {
    family: 'punch',
    startup: 2,
    active: 3,
    recovery: 6,
    range: 72,
    arc: 0.55,
    knockback: 16,
    selfSlow: 0.65,
    hitstun: 10,
  },
  hook: {
    family: 'punch',
    startup: 3,
    active: 4,
    recovery: 8,
    range: 64,
    arc: 1.9,
    knockback: 23,
    selfSlow: 0.5,
    hitstun: 14,
  },
  frontKick: {
    family: 'kick',
    startup: 4,
    active: 4,
    recovery: 28,
    range: 98,
    arc: 0.65,
    knockback: 51,
    selfSlow: 0.35,
    hitstun: 27,
    whiffSlide: 3,
  },
  roundKick: {
    family: 'kick',
    startup: 5,
    active: 5,
    recovery: 30,
    range: 78,
    arc: 1.55,
    knockback: 44,
    selfSlow: 0.35,
    hitstun: 27,
    whiffSlide: 2,
  },
};

function normalize(x, y, fallbackX = 1, fallbackY = 0) {
  const mag = Math.sqrt(x * x + y * y);
  if (mag > 0.01) return { x: x / mag, y: y / mag };
  return { x: fallbackX, y: fallbackY };
}

function getAttackDirection(player) {
  return normalize(player.facingX || 0, player.facingY || 0, 1, 0);
}

function getInputDirection(player) {
  return normalize(player.inputDx || 0, player.inputDy || 0, player.facingX || 1, player.facingY || 0);
}

function getTargetInfos(attacker, allPlayers) {
  const facing = getAttackDirection(attacker);
  const infos = [];

  for (const target of allPlayers) {
    if (target.id === attacker.id || !target.alive) continue;

    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= 0.01) continue;

    const nx = dx / dist;
    const ny = dy / dist;
    const dot = nx * facing.x + ny * facing.y;
    infos.push({ target, dist, dot });
  }

  infos.sort((a, b) => a.dist - b.dist);
  return infos;
}

/**
 * 주먹/킥 버튼 입력을 실제 기술로 변환한다.
 *
 * @param {object} attacker
 * @param {Iterable} allPlayers
 * @param {'punch'|'kick'} family
 * @returns {'straight'|'hook'|'frontKick'|'roundKick'|null}
 */
function chooseAttackType(attacker, allPlayers, family) {
  const infos = getTargetInfos(attacker, allPlayers);
  const inputMag = Math.sqrt((attacker.inputDx || 0) ** 2 + (attacker.inputDy || 0) ** 2);

  const front75 = Math.cos(75 * Math.PI / 180);
  const front60 = Math.cos(60 * Math.PI / 180);
  const side120 = Math.cos(120 * Math.PI / 180);

  const close = infos.filter(info => info.dist < 70);
  const crowdedSide = infos.filter(info => info.dist < 95 && info.dot >= side120);
  const frontPunch = infos.find(info => info.dot >= front75);
  const frontKick = infos.find(info => info.dot >= front60 && info.dist >= 70);

  if (family === 'punch') {
    if (close.length > 0 || crowdedSide.length >= 2) return 'hook';
    if (frontPunch) return 'straight';
    return inputMag > 0.2 ? 'straight' : 'hook';
  }

  if (family === 'kick') {
    if (close.length > 0 || crowdedSide.length >= 2) return 'roundKick';
    if (frontKick) return 'frontKick';
    return inputMag > 0.2 ? 'frontKick' : 'roundKick';
  }

  return null;
}

/**
 * 난투 공격의 히트 결과 계산 — 순수 함수 (상태 변경 없음).
 *
 * @param {object} attacker      공격자 { id, x, y, facingX, facingY }
 * @param {Iterable} allPlayers  방의 전체 플레이어 목록
 * @param {string} attackType    ATTACKS 키
 * @param {Set<string>} hitTargets 이미 맞은 타겟 id 집합
 * @returns {Array<{target, force, nx, ny, dist, attack}>}
 */
function calcAttackHits(attacker, allPlayers, attackType, hitTargets = new Set()) {
  const attack = ATTACKS[attackType];
  if (!attack) return [];

  const dir = getAttackDirection(attacker);
  const minDot = Math.cos(attack.arc / 2);
  const hits = [];

  for (const target of allPlayers) {
    if (target.id === attacker.id || !target.alive || target.isInvincible) continue;
    if (hitTargets.has(target.id)) continue;

    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const targetRadius = target.radius || 0;
    if (dist > attack.range + targetRadius) continue;

    let nx, ny;
    if (dist > 0.01) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      const fallback = getInputDirection(attacker);
      nx = fallback.x;
      ny = fallback.y;
    }

    const dot = nx * dir.x + ny * dir.y;
    if (dot < minDot) continue;

    hits.push({ target, force: attack.knockback, nx, ny, dist, attack });
  }

  return hits;
}

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
  calcAttackHits,
  chooseAttackType,
  ATTACKS,
  PUNCH_MIN_FORCE, PUNCH_MAX_FORCE, PUNCH_RANGE,
  PUNCH_MAX_CHARGE, PUNCH_MIN_CHARGE, PUNCH_DURATION,
  PUNCH_CRITICAL_RANGE, PUNCH_CRITICAL_FORCE,
};
