// ─── 배치기 순수 로직 — 테스트 가능한 순수 함수만 포함 ──────────────────────

const PUNCH_MIN_FORCE = 8;
const PUNCH_MAX_FORCE = 40;      // ↑ 28에서 상향 (일반 풀차징 넉백)
const PUNCH_RANGE = 120;         // 배치기 유효 범위
const PUNCH_MAX_CHARGE = 120;    // 최대 차지 틱 (2초)
const PUNCH_MIN_CHARGE = 6;      // 최소 차지 틱 (0.1초)
const PUNCH_DURATION = 15;       // 펀치 애니메이션 틱
const PUNCH_CRITICAL_RANGE = 55; // 밀착 판정 거리 (플레이어 지름 딱 붙는 거리)
const PUNCH_CRITICAL_FORCE = 60; // 크리티컬 넉백

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
