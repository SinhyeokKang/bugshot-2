#!/usr/bin/env node
// POSTMORTEM 집계기. docs/POSTMORTEM.md의 항목 태그(영역·계열·그물)를 읽어
//   1. 어느 영역이 반복 함정인지 랭킹하고
//   2. 어느 그물(unit/jsdom/e2e/시각/수동)이 비어 있는지 세고
//   3. 태그 누락·오타·헤딩 유실 같은 형식 결함을 --check로 차단한다.
//
// 사용:
//   node scripts/postmortem-report.mjs           집계 리포트
//   node scripts/postmortem-report.mjs --check    형식 검사만 (결함 있으면 exit 1)
//
// "기록은 쌓이는데 집계가 없다"를 메우는 회로다 — 항목을 늘리는 것 자체보다
// 반복 축을 드러내는 게 목적이므로 vocab은 좁게 유지한다(새 값 추가는 여기 단일 출처).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC_PATH = join(ROOT, "docs/POSTMORTEM.md");

// ── vocab (단일 출처) ────────────────────────────────────────────────
// 영역은 서브시스템(디렉터리) 이름을 그대로 쓴다. 새 서브시스템이 생기면 여기 추가.
export const AREAS = [
  "디자인", // 색 토큰·레이아웃·shadcn 프리미티브 등 시각 표면
  "스타일해석", // 스타일 에디터·CSSOM resolve
  "어댑터", // 8개 플랫폼 제출·본문 빌더
  "에디터", // tiptap·오버레이·Radix 호스트
  "AI", // 프롬프트·초안·취소
  "background", // SW·탭 생명주기·권한·캡처 관문
  "content", // content script 레코더·스크롤 캡처·iframe
  "store", // zustand·persist·IndexedDB·GC
  "e2e", // Playwright 하네스
  "툴체인", // 빌드·의존성·CI·인프라
  "i18n", // 사전(복제본 포함)
  "컴포넌트", // 공용 UI 컴포넌트 상태
  "미디어", // 캡처·영상·캔버스 어노테이션
  "lib", // 순수 유틸
];

// 계열은 "왜 틀렸나"의 재발 축. 겹칠 수 있어 복수 허용.
export const PATTERNS = [
  "복제본", // 같은 수정을 N곳에 해야 했다 (단일 출처 위반)
  "라이브러리전제", // 라이브러리·프리미티브의 숨은 기본 동작이 전제를 깼다
  "미검증단언", // 문서·설계·리포트의 단언을 실측 없이 전제로 삼았다
  "fail-open", // 에러 삼킴·전량 폐기·실패를 빈 값으로 오독
  "취소래치", // 비동기 취소↔래치·상태 레인 불일치
  "드리프트", // 하드코딩·버전·경로가 단일 출처와 갈라짐
  "cross-origin", // cross-origin 특유의 가시성·권한 제약
];

// 그물은 "무엇이 잡았어야 했나" 단일값. 시각/수동이 쌓이면 자동화 구멍이다.
export const NETS = [
  "unit", // vitest node 순수 함수
  "jsdom", // *.test.tsx 렌더 테스트
  "e2e", // Playwright
  "시각", // 레이아웃·색·포인터 — 스크린샷 diff나 육안만
  "수동", // 실제 탭·실기기 조작
  "없음", // 외부·인프라 (코드로 못 막음)
];

const TAG_RE = {
  areas: /^- \*\*영역\*\*:\s*(.+)$/,
  patterns: /^- \*\*계열\*\*:\s*(.+)$/,
  net: /^- \*\*그물\*\*:\s*(.+)$/,
};
const HEADING_RE = /^## (\d{4}-\d{2}-\d{2}) — (.+)$/;
const SYMPTOM_RE = /^- \*\*증상\*\*:/;

function tagValues(raw) {
  return [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

export function parseEntries(md) {
  const lines = md.split("\n");
  const entries = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = HEADING_RE.exec(line);
    if (heading) {
      cur = {
        date: heading[1],
        title: heading[2],
        line: i + 1,
        areas: [],
        patterns: [],
        nets: [],
        symptomLines: [],
      };
      entries.push(cur);
      continue;
    }
    if (!cur) continue;
    for (const [key, re] of Object.entries(TAG_RE)) {
      const m = re.exec(line);
      if (!m) continue;
      const values = tagValues(m[1]);
      if (key === "net") cur.nets.push(...values);
      else cur[key].push(...values);
    }
    if (SYMPTOM_RE.test(line)) cur.symptomLines.push(i + 1);
  }
  return entries.map((e) => ({ ...e, net: e.nets[0] ?? null }));
}

export function validateEntries(entries) {
  const errors = [];
  const push = (entry, kind, value) =>
    errors.push({ kind, date: entry.date, title: entry.title, line: entry.line, value });

  for (const entry of entries) {
    // 헤딩을 잃은 항목은 앞 항목에 흡수돼 증상이 2개가 된다 (실제 발생 사례).
    for (const line of entry.symptomLines.slice(1)) {
      errors.push({
        kind: "orphan-body",
        date: entry.date,
        title: entry.title,
        line,
        value: null,
      });
    }
    if (entry.areas.length === 0) push(entry, "missing-area");
    if (entry.nets.length === 0) push(entry, "missing-net");
    if (entry.nets.length > 1) push(entry, "multi-net", entry.nets.join(", "));
    for (const a of entry.areas) if (!AREAS.includes(a)) push(entry, "unknown-area", a);
    for (const p of entry.patterns)
      if (!PATTERNS.includes(p)) push(entry, "unknown-pattern", p);
    for (const n of entry.nets) if (!NETS.includes(n)) push(entry, "unknown-net", n);
  }
  return errors;
}

function rank(counts) {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function tally(entries, pick) {
  const counts = new Map();
  for (const e of entries)
    for (const v of pick(e)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return rank(counts);
}

export function aggregate(entries) {
  const cross = new Map();
  for (const e of entries)
    for (const a of e.areas)
      for (const p of e.patterns) {
        const key = `${a}|${p}`;
        cross.set(key, (cross.get(key) ?? 0) + 1);
      }
  const crossTop = rank(cross).map(({ key, count }) => {
    const [area, pattern] = key.split("|");
    return { area, pattern, count };
  });

  return {
    total: entries.length,
    areas: tally(entries, (e) => e.areas),
    patterns: tally(entries, (e) => e.patterns),
    nets: tally(entries, (e) => (e.net ? [e.net] : [])),
    months: tally(entries, (e) => [e.date.slice(0, 7)]).sort((a, b) =>
      b.key.localeCompare(a.key),
    ),
    crossTop,
  };
}

// ── 리포트 출력 ──────────────────────────────────────────────────────
function bar(count, max, width = 24) {
  return "█".repeat(Math.max(1, Math.round((count / max) * width)));
}

function printRank(title, rows, total) {
  if (rows.length === 0) return;
  console.log(`\n${title}`);
  const max = rows[0].count;
  for (const { key, count } of rows) {
    const pct = ((count / total) * 100).toFixed(0).padStart(3);
    console.log(
      `  ${key.padEnd(14)} ${String(count).padStart(3)}  ${pct}%  ${bar(count, max)}`,
    );
  }
}

function main() {
  const md = readFileSync(DOC_PATH, "utf8");
  const entries = parseEntries(md);
  const errors = validateEntries(entries);
  const check = process.argv.includes("--check");

  if (errors.length > 0) {
    console.error(`docs/POSTMORTEM.md 형식 결함 ${errors.length}건:`);
    for (const e of errors) {
      const what = e.value ? `${e.kind} (${e.value})` : e.kind;
      console.error(`  L${e.line}  ${e.date ?? "?"}  ${what}`);
    }
    console.error("\nvocab: scripts/postmortem-report.mjs의 AREAS·PATTERNS·NETS");
    process.exit(1);
  }
  if (check) {
    console.log(`✓ docs/POSTMORTEM.md ${entries.length}개 항목 태그 정상`);
    return;
  }

  const agg = aggregate(entries);
  console.log(`docs/POSTMORTEM.md — 회고 ${agg.total}건`);
  console.log(
    `기간 ${entries[entries.length - 1]?.date} ~ ${entries[0]?.date}` +
      `  (${agg.months.map((m) => `${m.key} ${m.count}건`).join(", ")})`,
  );

  printRank("영역별 — 어디서 깨지나", agg.areas, agg.total);
  printRank("계열별 — 왜 깨지나 (복수 태그)", agg.patterns, agg.total);
  printRank("그물별 — 무엇이 잡았어야 했나", agg.nets, agg.total);

  const repeats = agg.crossTop.filter((c) => c.count >= 2).slice(0, 8);
  if (repeats.length > 0) {
    console.log("\n반복 함정 (영역 × 계열, 2건 이상)");
    for (const { area, pattern, count } of repeats) {
      console.log(`  ${`${area} × ${pattern}`.padEnd(30)} ${count}건`);
    }
  }

  const manual = agg.nets
    .filter((n) => n.key === "시각" || n.key === "수동")
    .reduce((sum, n) => sum + n.count, 0);
  if (manual > 0) {
    const pct = ((manual / agg.total) * 100).toFixed(0);
    console.log(
      `\n자동 그물 밖(시각·수동): ${manual}건 / ${pct}% — 스크린샷 diff 도입 시 사정권`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
