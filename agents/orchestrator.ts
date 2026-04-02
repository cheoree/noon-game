#!/usr/bin/env tsx
// 오케스트레이터 — Planner → Generator → Evaluator 파이프라인
//
// 사용법:
//   npx tsx orchestrator.ts "아이템 시스템 추가"           # 전체 파이프라인
//   npx tsx orchestrator.ts --stage plan "아이템 시스템"    # Planner만
//   npx tsx orchestrator.ts --stage generate "계획 텍스트"  # Generator만
//   npx tsx orchestrator.ts --stage evaluate "변경 요약"    # Evaluator만

import { runPlanner } from "./planner.js";
import { runGenerator } from "./generator.js";
import { runEvaluator } from "./evaluator.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const ARTIFACTS_DIR = join(
  "/Users/user/Documents/workspace/noon-game",
  "agents",
  ".artifacts",
);

// ─── 유틸 ──────────────────────────────────────────────────────────────────────

function saveArtifact(name: string, content: string): void {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const path = join(ARTIFACTS_DIR, `${name}.md`);
  writeFileSync(path, content, "utf-8");
  console.log(`  저장: ${path}`);
}

function loadArtifact(name: string): string | null {
  const path = join(ARTIFACTS_DIR, `${name}.md`);
  if (existsSync(path)) {
    return readFileSync(path, "utf-8");
  }
  return null;
}

// ─── 스테이지 실행 ────────────────────────────────────────────────────────────

async function stagePlan(task: string): Promise<string> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  📋 PLANNER — 구현 계획 수립              ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const plan = await runPlanner(task);
  saveArtifact("plan", plan);
  console.log("\n--- Planner 출력 ---\n");
  console.log(plan);
  return plan;
}

async function stageGenerate(plan: string): Promise<string> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  🔨 GENERATOR — 코드 생성                 ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const generatorOutput = await runGenerator(plan);
  saveArtifact("generator-output", generatorOutput);
  console.log("\n--- Generator 출력 ---\n");
  console.log(generatorOutput);
  return generatorOutput;
}

async function stageEvaluate(context: string): Promise<string> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  🔍 EVALUATOR — 품질 검증                 ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const evaluation = await runEvaluator(context);
  saveArtifact("evaluation", evaluation);
  console.log("\n--- Evaluator 출력 ---\n");
  console.log(evaluation);
  return evaluation;
}

// ─── 전체 파이프라인 ──────────────────────────────────────────────────────────

async function runPipeline(task: string): Promise<void> {
  const startTime = Date.now();

  console.log("━".repeat(50));
  console.log(`🎯 작업: ${task}`);
  console.log("━".repeat(50));

  // Stage 1: Plan
  const plan = await stagePlan(task);

  // Stage 2: Generate
  const generatorOutput = await stageGenerate(plan);

  // Stage 3: Evaluate
  const evaluation = await stageEvaluate(generatorOutput);

  // 결과 요약
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "━".repeat(50));
  console.log("📊 파이프라인 완료");
  console.log("━".repeat(50));
  console.log(`  소요 시간: ${elapsed}초`);
  console.log(`  산출물 위치: ${ARTIFACTS_DIR}/`);

  // 수정 필요 판정이면 재시도 루프 안내
  if (evaluation.includes("❌ 수정 필요")) {
    console.log("\n⚠️  Evaluator가 수정을 요청했습니다.");
    console.log("   재실행: npx tsx orchestrator.ts --stage generate \"<evaluation 내용>\"");
  }
}

// ─── CLI 파싱 ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("사용법:");
    console.log('  npx tsx orchestrator.ts "요구사항"               # 전체 파이프라인');
    console.log('  npx tsx orchestrator.ts --stage plan "요구사항"   # Planner만');
    console.log('  npx tsx orchestrator.ts --stage generate "계획"   # Generator만');
    console.log('  npx tsx orchestrator.ts --stage evaluate "변경"   # Evaluator만');
    process.exit(1);
  }

  const stageIdx = args.indexOf("--stage");

  if (stageIdx !== -1) {
    const stage = args[stageIdx + 1];
    const input = args.slice(stageIdx + 2).join(" ");

    // 입력이 없으면 이전 단계 산출물을 로드
    const resolvedInput =
      input || (() => {
        switch (stage) {
          case "generate":
            return loadArtifact("plan") ?? "";
          case "evaluate":
            return loadArtifact("generator-output") ?? "";
          default:
            return "";
        }
      })();

    if (!resolvedInput) {
      console.error(`❌ 입력이 필요합니다. 직접 전달하거나 이전 단계를 먼저 실행하세요.`);
      process.exit(1);
    }

    switch (stage) {
      case "plan":
        await stagePlan(resolvedInput);
        break;
      case "generate":
        await stageGenerate(resolvedInput);
        break;
      case "evaluate":
        await stageEvaluate(resolvedInput);
        break;
      default:
        console.error(`❌ 알 수 없는 스테이지: ${stage}`);
        console.error("   사용 가능: plan, generate, evaluate");
        process.exit(1);
    }
  } else {
    // 전체 파이프라인
    const task = args.join(" ");
    await runPipeline(task);
  }
}

main().catch((err) => {
  console.error("❌ 오류:", err);
  process.exit(1);
});
