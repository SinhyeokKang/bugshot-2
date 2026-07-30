#!/usr/bin/env node
// recorders-entry가 **동기 IIFE**로 emit되는지 검사한다.
//
// 왜 필요한가: `recorders-entry`는 self-contained 청크(외부 static import 0)여야 crxjs가
// 동기 IIFE로 emit하고, 그래야 document_start 후크가 페이지 인라인 스크립트보다 먼저 깔려
// pre-arm 버퍼링(로드 초반 로그 소급 수집)이 동작한다. 외부 import가 하나라도 유입되면
// crxjs는 async loader(`*-loader-*.js`)로 되돌아가고, **pre-arm이 조용히 죽는다** —
// 빌드는 성공하고 typecheck·유닛 테스트도 전부 통과한다.
//
// 행동 검증은 `e2e/logs-prearm.spec.ts`가 CI의 e2e job(xvfb로 headed)에서 맡는다.
// 이건 브라우저 없이 몇 초로 끝나는 1차 그물이라, e2e green을 기다리지 않고 형태 회귀를
// 먼저 알린다(`verify` job).
//
// 사용: pnpm build (또는 build:e2e) 후 `node scripts/check-prearm-chunk.mjs [outDir]`

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? "dist");
const ENTRY = "recorders-entry";

function fail(msg) {
  console.error(`✗ pre-arm 청크 검사 실패 — ${msg}`);
  console.error(
    "  → recorders-entry에 src/content/ 밖 static import가 들어왔는지 확인하라.\n" +
      "    (CLAUDE.md 'pre-arm 버퍼링 (동기 IIFE 빌드 제약)' 참조)",
  );
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(resolve(outDir, "manifest.json"), "utf8"));
} catch (e) {
  fail(`${outDir}/manifest.json을 읽을 수 없다 (빌드 먼저). ${e.message}`);
}

const scripts = manifest.content_scripts ?? [];
const entry = scripts.find((cs) => (cs.js ?? []).some((p) => p.includes(ENTRY)));
if (!entry) fail(`manifest.content_scripts에 ${ENTRY} 항목이 없다`);

// world/run_at도 pre-arm의 전제다 — 하나라도 바뀌면 후크 시점이 밀린다.
if (entry.world !== "MAIN") fail(`${ENTRY}의 world가 "MAIN"이 아니다 (${entry.world})`);
if (entry.run_at !== "document_start") {
  fail(`${ENTRY}의 run_at이 "document_start"가 아니다 (${entry.run_at})`);
}

const file = entry.js.find((p) => p.includes(ENTRY));
// crxjs는 동기 emit이 불가능하면 `*-loader-*.js`를 대신 끼운다 — 그 자체가 실패 신호다.
if (file.includes("-loader-")) {
  fail(`${ENTRY}가 async loader로 emit됐다 (${file})`);
}

const code = readFileSync(resolve(outDir, file), "utf8");
if (!code.trimStart().startsWith("(function(")) {
  fail(`${ENTRY} 청크가 IIFE로 시작하지 않는다 (${file}: ${code.slice(0, 40)}…)`);
}
if (/(^|\n)\s*import[\s{*"']/.test(code)) {
  fail(`${ENTRY} 청크에 static import가 남아 있다 (${file})`);
}

console.log(`✓ pre-arm 청크 정상 — ${file} (동기 IIFE, world=MAIN, document_start)`);
