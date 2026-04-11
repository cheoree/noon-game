# 전투 개선 설계 — 배치기 크리티컬 + 이동 민감도 + 크로스카운터

**날짜**: 2026-04-11  
**브랜치**: feat/combat-overhaul (예정)  
**배경**: 실제 멀티플레이 테스트에서 나온 피드백 3종 반영

---

## 변경 범위

1. 배치기 버튼 차징 캔슬 버그 수정
2. 이동 민감도 감소 (미끄러워서 혼자 죽는 빈도 줄이기)
3. 배치기 파워 전면 상향 + 크리티컬 시스템 신설
4. 크로스카운터 감지 및 연출

---

## 1. 배치기 버튼 캔슬 버그 수정 (`public/js/game.js`)

### 원인
`dashBtn.addEventListener('touchend', ...)` 가 버튼 엘리먼트에 바인딩되어 있음.  
손가락이 버튼 경계 밖으로 조금만 벗어나면 `touchend` 발생 → `releasePunch()` 호출 → 캔슬.  
`touchcancel` 도 OS 멀티터치/스크롤 감지 시 동일하게 동작.

### 해결
- `touchstart` 시 touch identifier 저장 (`game.punchTouchId`)
- `touchend` / `touchcancel` 을 **document 레벨**에 바인딩, 저장된 ID와 일치할 때만 `releasePunch()` 호출
- 버튼 자체의 `touchend` / `touchcancel` 제거

```
dashBtn: touchstart → startPunchCharge() + game.punchTouchId = t.identifier
document: touchend / touchcancel → changedTouches 중 punchTouchId 일치하면 releasePunch()
```

---

## 2. 이동 민감도 조절 (`server.js`)

| 상수 | 현재 | 변경 후 |
|---|---|---|
| `FRICTION` | `0.92` | `0.85` |
| `MOVE_SPEED` | `2` | `1.6` |

- 터미널 속도: 25 → 10.7 (58% 감소)
- 관성은 남아 있되 엣지 근처에서 입력을 놓으면 훨씬 빠르게 감속
- 배치기로 날아가는 거리는 여전히 긴 이유: 넉백은 velocity에 직접 더하는 방식이라 MOVE_SPEED와 무관

---

## 3. 배치기 파워 상향 + 크리티컬 시스템 (`server.js`)

### 수치 변경

| 상수 | 현재 | 변경 후 | 비고 |
|---|---|---|---|
| `PUNCH_MAX_FORCE` | `28` | `40` | 일반 풀차징 |
| `PUNCH_CRITICAL_RANGE` | (없음) | `55` | 밀착 판정 거리 (플레이어 반지름 ~2배) |
| `PUNCH_CRITICAL_FORCE` | (없음) | `60` | 크리티컬 넉백 |

### 크리티컬 조건
`punch-release` 처리 시점에 타겟까지 거리 < `PUNCH_CRITICAL_RANGE` 이면 크리티컬.  
크리티컬은 거리에 상관없이 **무조건 `PUNCH_CRITICAL_FORCE` 적용** (chargeRatio 무관).

크리티컬 이동거리 추정:
- `PUNCH_CRITICAL_FORCE = 60`, FRICTION=0.85 → 총 이동거리 ≈ 60/(1-0.85) = 400
- 아레나 반지름 380 → 중앙에서 맞아도 엣지 도달, 80~90% 탈락 현실적

### 서버 → 클라이언트 신호
`punch-impact` 이벤트에 `isCritical: true` 필드 추가.

### 클라이언트 크리티컬 이펙트 (`public/js/game.js`)
- 화면 전체 흰색 플래시 오버레이 (300ms 페이드아웃, CSS div)
- 카메라 셰이크: 강도 ×3, 지속 250ms
- 충격파 링 3개 연속 (50ms 간격)
- 파티클 색상 `#ffdd00` / `#ffffff` (골드/흰색)
- "CRITICAL!" 텍스트 팝업 (타격 좌표 기준 캔버스 오버레이, 800ms)

---

## 4. 크로스카운터 (`server.js` + `public/js/game.js`)

### 감지 조건
두 플레이어 A, B가 아래 조건을 모두 만족하면 크로스카운터 판정:
1. A의 `punch-release` 처리 시 B가 크리티컬 범위 내 (거리 < `PUNCH_CRITICAL_RANGE`)
2. B의 `punch-release` 처리 시 A가 크리티컬 범위 내
3. 두 이벤트 간격이 **10틱 이내** (≈167ms)

### 구현 방식
각 플레이어에 `receivedCritFrom: { id, tick }` 필드 추가.

1. A가 B를 크리티컬로 타격 → `B.receivedCritFrom = { id: A.id, tick: room.tick }` 기록
2. B의 `punch-release` 처리 시, B가 A를 크리티컬 범위에서 타격하면:
   - `A.receivedCritFrom.id === B.id` 이고
   - `room.tick - A.receivedCritFrom.tick <= 10` 이면 → **크로스카운터**
3. 크로스카운터 판정 시 양쪽 모두 크리티컬 포스 적용 후 `isCrossCounter: true` 브로드캐스트

### 크로스카운터 동작
- 양쪽 모두 `PUNCH_CRITICAL_FORCE` 적용 (일반 크리티컬과 동일)
- 양쪽 모두 `isCritical: true` + `isCrossCounter: true` 신호 전송

### 클라이언트 크로스카운터 이펙트
- 크리티컬 이펙트 + 추가:
  - "CLASH!!" 텍스트 팝업 (양쪽 중간 지점, 1200ms, 더 크게)
  - 화면 플래시 오렌지/흰색 번갈아 (150ms × 3회)
  - 두 충돌 지점 모두에서 충격파 발생

---

## 파일별 변경 요약

| 파일 | 변경 내용 |
|---|---|
| `server.js` | 상수 4개 추가/수정, punch-release 로직에 크리티컬+크로스카운터 판정 추가 |
| `public/js/game.js` | 터치 이벤트 재구조화, 크리티컬/크로스카운터 이펙트 함수 추가, punch-impact 핸들러 수정 |

---

## 제외 범위
- 사운드 (기존 이펙트 시스템 외)
- AI 봇 크리티컬 판정 (봇은 기존 로직 유지, 차후 개선)
- 배치기 외 다른 조작 변경
