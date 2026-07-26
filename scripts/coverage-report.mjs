#!/usr/bin/env node
// 커버리지 리포트 & 트렌드 비교기.
//   1. coverage/coverage-summary.json(json-summary reporter 산출)을 읽어
//   2. 전체(정직한 분모) vs "로직 스코프"(브라우저 전용·UI 코드 제외) 두 지표를 계산하고
//   3. git-tracked 베이스라인(coverage/baseline.json)과 비교해 이전→지금 변화·회귀·개선 후보를 리포트한다.
//
// 사용:
//   node scripts/coverage-report.mjs           비교 리포트만 (베이스라인 안 건드림)
//   node scripts/coverage-report.mjs --update   현재 수치로 베이스라인 갱신(래칫)
//
// "로직 스코프"가 핵심: 전체 % 는 의도적으로 유닛테스트하지 않는 코드(content DOM 스크립트,
// *.tsx 렌더, OAuth 런처, 미디어/캔버스 런타임, SW 엔트리)가 분모에 섞여 TDD 다이얼로 안 맞다.
// 아래 isBrowserBound() 가 그 코드를 로직 분모에서 걷어낸다 — 단일 출처이므로 여기만 고치면 된다.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UPDATE = process.argv.includes("--update");
// 리포트 산출물은 coverage/report/ (vitest가 매 실행 청소). 베이스라인은 그 밖의
// coverage/baseline.json 에 두어 청소를 피한다 (git-tracked 트렌드 기준선).
const SUMMARY_PATH = join(ROOT, "coverage/report/coverage-summary.json");
const BASELINE_PATH = join(ROOT, "coverage/baseline.json");

// ── 로직 분모에서 제외할 브라우저 전용/UI 코드 (전체 지표엔 그대로 포함) ──────────
// 여기 없는 .ts 는 전부 "테스트해야 할 로직"으로 간주된다. 유닛테스트 불가능한 새 런타임
// 파일을 추가하면 이 목록에 넣어야 로직 다이얼이 노이즈로 눌리지 않는다.
const BROWSER_BOUND_EXACT = new Set([
  // content: DOM 을 직접 만지는 런타임 (helpers·prearm·throttle·css-*·frame-geometry·scroll·draw 는 순수라 로직에 남긴다)
  "src/content/picker.ts",
  "src/content/overlay.ts",
  "src/content/area-select.ts",
  "src/content/annotation.ts",
  "src/content/dom-describe.ts",
  "src/content/post-to-runtime.ts",
  "src/content/console-recorder.ts",
  "src/content/network-recorder.ts",
  "src/content/action-recorder.ts",
  "src/content/recorder-bridge.ts",
  "src/content/recorders-entry.ts",
  // background: SW 엔트리·메시지 라우터·타입 테이블·MAIN world 주입
  "src/background/index.ts",
  "src/background/messages.ts",
  "src/background/bgRequestTypes.ts",
  "src/background/github-upload.ts",
  // sidepanel: 캡처·미디어·picker·annotation 오케스트레이션 런타임 (엔트리 포함)
  "src/sidepanel/picker-control.ts",
  "src/sidepanel/video-recorder.ts",
  "src/sidepanel/video-capture.ts",
  "src/sidepanel/capture.ts",
  "src/sidepanel/annotation-control.ts",
  "src/sidepanel/recorder-control.ts",
  "src/sidepanel/tab-nav.ts",
  // 기타 글루
  "src/i18n/bg-init.ts",
  "src/lib/external-links.ts",
]);

function isBrowserBound(rel) {
  if (rel.endsWith(".tsx")) return true; // React 컴포넌트·엔트리는 선택적 렌더테스트 대상, 커버리지 다이얼 아님
  if (rel.startsWith("src/types/")) return true; // 타입 선언 (실행 코드 없음)
  if (
    rel.startsWith("src/background/") &&
    (rel.endsWith("-oauth.ts") || rel.endsWith("/oauth.ts"))
  ) {
    return true; // OAuth 런처 (launchWebAuthFlow 브라우저 플로우)
  }
  return BROWSER_BOUND_EXACT.has(rel);
}

function loadSummary() {
  if (!existsSync(SUMMARY_PATH)) {
    console.error(
      "coverage/report/coverage-summary.json 없음. 먼저 `pnpm test:coverage` 로 커버리지를 측정해라.",
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));
}

function pct(covered, total) {
  return total === 0 ? 100 : (100 * covered) / total;
}

// 파일별 라인 커버리지 + 로직/전체 합계 집계
function aggregate(summary) {
  const files = {}; // rel -> {covered, total, browserBound}
  const logic = { covered: 0, total: 0 };
  for (const [abs, v] of Object.entries(summary)) {
    if (abs === "total") continue;
    const rel = relative(ROOT, abs).split("\\").join("/");
    const total = v.lines.total;
    if (total === 0) continue; // 실행 코드 없는 파일(타입 배럴 등)은 신호 없음
    const covered = v.lines.covered;
    const bb = isBrowserBound(rel);
    files[rel] = { covered, total, browserBound: bb };
    if (!bb) {
      logic.covered += covered;
      logic.total += total;
    }
  }
  const t = summary.total;
  const global = {
    lines: { covered: t.lines.covered, total: t.lines.total, pct: t.lines.pct },
    branches: { covered: t.branches.covered, total: t.branches.total, pct: t.branches.pct },
    functions: { covered: t.functions.covered, total: t.functions.total, pct: t.functions.pct },
  };
  return { files, logic: { ...logic, pct: pct(logic.covered, logic.total) }, global };
}

function fmtDelta(cur, prev) {
  if (prev == null) return "";
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return "  (±0.0)";
  const s = (d > 0 ? "+" : "") + d.toFixed(1);
  return `  (${s}pp ${d > 0 ? "▲" : "▼"})`;
}

function main() {
  const summary = loadSummary();
  const { files, logic, global } = aggregate(summary);
  const baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
    : null;

  const pv = baseline
    ? {
        logic: baseline.logic.pct,
        gLines: baseline.global.lines.pct,
        gBranch: baseline.global.branches.pct,
        gFunc: baseline.global.functions.pct,
      }
    : {};

  console.log("");
  console.log("════════════════ 커버리지 리포트 ════════════════");
  if (baseline?.generatedAt) console.log(`베이스라인: ${baseline.generatedAt}`);
  console.log("");
  console.log(`▶ 로직 스코프 (테스트 대상 다이얼)`);
  console.log(
    `    Lines   ${logic.pct.toFixed(1)}%${fmtDelta(logic.pct, pv.logic)}   (${logic.covered}/${logic.total})`,
  );
  console.log("");
  console.log(`▶ 전체 (정직한 분모 — 브라우저/UI 코드 포함)`);
  console.log(
    `    Lines   ${global.lines.pct.toFixed(1)}%${fmtDelta(global.lines.pct, pv.gLines)}   (${global.lines.covered}/${global.lines.total})`,
  );
  console.log(
    `    Branch  ${global.branches.pct.toFixed(1)}%${fmtDelta(global.branches.pct, pv.gBranch)}`,
  );
  console.log(
    `    Funcs   ${global.functions.pct.toFixed(1)}%${fmtDelta(global.functions.pct, pv.gFunc)}`,
  );

  // ── 회귀 감지: 베이스라인 대비 라인 커버가 떨어진 로직 파일 ──────────────────
  if (baseline?.files) {
    const regressions = [];
    for (const [rel, cur] of Object.entries(files)) {
      if (cur.browserBound) continue;
      const prev = baseline.files[rel];
      if (!prev) continue;
      const curPct = pct(cur.covered, cur.total);
      const prevPct = pct(prev.covered, prev.total);
      if (curPct < prevPct - 0.05) {
        regressions.push({ rel, curPct, prevPct, drop: prevPct - curPct });
      }
    }
    regressions.sort((a, b) => b.drop - a.drop);
    console.log("");
    if (regressions.length === 0) {
      console.log("✅ 래칫: 로직 파일 커버리지 하락 없음");
    } else {
      console.log(`⚠️  래칫 경고: ${regressions.length}개 로직 파일 커버리지 하락`);
      for (const r of regressions.slice(0, 20)) {
        console.log(
          `    ${r.rel}   ${r.prevPct.toFixed(1)}% → ${r.curPct.toFixed(1)}%  (−${r.drop.toFixed(1)}pp)`,
        );
      }
    }
  } else {
    console.log("");
    console.log("ℹ️  베이스라인 없음 — 첫 측정. `--update` 로 베이스라인을 심어라.");
  }

  // ── 개선 후보: 로직 스코프에서 미커버 라인이 많은 순 ──────────────────────────
  const candidates = Object.entries(files)
    .filter(([, f]) => !f.browserBound && f.covered < f.total)
    .map(([rel, f]) => ({ rel, uncovered: f.total - f.covered, pct: pct(f.covered, f.total) }))
    .sort((a, b) => b.uncovered - a.uncovered)
    .slice(0, 15);
  console.log("");
  console.log("▶ 개선 후보 (로직 스코프 · 미커버 라인 많은 순)");
  for (const c of candidates) {
    console.log(
      `    ${(c.pct.toFixed(1) + "%").padStart(6)}  −${String(c.uncovered).padStart(4)}줄  ${c.rel}`,
    );
  }
  console.log("");

  if (UPDATE) {
    const nowIso = new Date().toISOString();
    const baselineOut = {
      generatedAt: nowIso,
      logic: { covered: logic.covered, total: logic.total, pct: logic.pct },
      global,
      files: Object.fromEntries(
        Object.entries(files).map(([rel, f]) => [rel, { covered: f.covered, total: f.total }]),
      ),
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baselineOut, null, 2) + "\n");
    console.log(`📌 베이스라인 갱신됨: coverage/baseline.json (${nowIso})`);
    console.log("");
  }
}

main();
