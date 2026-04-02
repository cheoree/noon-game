# Noon Arena (점심아레나)

점심 먹고 커피내기용 모바일 웹 배틀로얄 게임.

## 기술 스택
- **서버**: Node.js + Express + Socket.io (`server.js`)
- **클라이언트**: HTML5 Canvas + 바닐라 JS (`public/`)
- **물리**: 자체 2D 원형 충돌 엔진

## 실행
```bash
npm install
node server.js   # http://localhost:3000
```

## 프로젝트 구조
```
server.js              # 게임 서버 (물리, 방 관리, 소켓 통신)
public/
  index.html           # SPA 메인 페이지
  css/style.css        # UI 스타일
  js/game.js           # 게임 로직 + Canvas 렌더링
  js/network.js        # Socket.io 클라이언트 통신
  js/ui.js             # UI 컨트롤러 (로비, 대기실, 결과)
GAME_DESIGN.md         # 게임 기획서
```

## 코딩 컨벤션
- 바닐라 JS (프레임워크 없음), ES6+
- 서버/클라이언트 모두 한글 주석 사용
- 상수는 UPPER_SNAKE_CASE, server.js 상단에 정의
- 게임 루프는 60fps 틱 기반 (`TICK_RATE = 60`)

## 에이전트 워크플로우
Planner → Generator → Evaluator 3축 서브에이전트 파이프라인.

### 서브에이전트 정의 (`.claude/agents/`)
| 에이전트 | 페르소나 | 도구 권한 |
|----------|----------|-----------|
| `planner` | 시니어 게임 아키텍트 | Read, Glob, Grep (읽기 전용) |
| `generator` | 시니어 풀스택 개발자 | Read, Write, Edit, Glob, Grep, Bash |
| `evaluator` | QA 엔지니어 / 코드 리뷰어 | Read, Glob, Grep, Bash (읽기 전용) |

### 사용법
```
/orchestrate 대시 이펙트에 파티클 추가
```
또는 개별 에이전트를 직접 호출:
```
planner 에이전트로 아이템 시스템 설계해줘
generator 에이전트로 이 계획 구현해줘
evaluator 에이전트로 변경사항 검증해줘
```

### 데이터 흐름
```
[요구사항] → planner(계획) → generator(코드) → evaluator(검증)
                                                    ↓
                              ✅ 통과 / ❌ → generator 재실행
```

### 프로그래매틱 실행 (Agent SDK)
`agents/` 디렉토리에 동일 파이프라인의 TypeScript 구현체 (CI/CD/스크립트용)
