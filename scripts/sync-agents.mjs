#!/usr/bin/env node
// Claude Code 원본 → Codex 미러 생성기.
//   CLAUDE.md            → AGENTS.md                                  (.agents/PREAMBLE.md 를 앞에 붙임)
//   .claude/commands/*.md → .agents/skills/source-command-<n>/SKILL.md (래퍼만 씌우고 본문은 원문 그대로)
// 본문은 치환하지 않는다 — 미러가 `CLAUDE.md`·`.claude/commands/` 원본을 그대로 가리켜야 정확하다.
// Codex 런타임 차이(훅 부재·미제공 스킬 등)는 전부 PREAMBLE 로 몰아둔다.
//
// 사용: node scripts/sync-agents.mjs [--check]
//   --check  파일을 쓰지 않고 드리프트만 검출 (드리프트 있으면 exit 1)

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

// 원격·릴리스 상태를 바꾸는 스킬은 Codex 런타임에서 쓰지 않으므로 미러하지 않는다.
// (릴리스 파이프라인 게이트는 단일 창구여야 한다 — e2e/.last-green 해시·버전 bump·tag가 경쟁하면 깨진다.)
// (`ship`은 미러한다 — 12단계 `/e2e-run`까지가 전부 로컬이고, 13·14단계 중단 규칙은 스킬 본문에 박혀 있다.)
const EXCLUDE = new Set(["push", "merge", "deploy", "sync"]);

const read = (p) => readFileSync(join(ROOT, p), "utf8");

function parseCommand(src, name) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!m) throw new Error(`.claude/commands/${name}.md: frontmatter 없음`);
  const desc = /^description:\s*(.*)$/m.exec(m[1]);
  if (!desc) throw new Error(`.claude/commands/${name}.md: description 없음`);
  return { description: desc[1].trim(), body: src.slice(m[0].length).replace(/^\n+/, "") };
}

function buildAgentsMd() {
  const preamble = read(".agents/PREAMBLE.md").trimEnd();
  const claude = read("CLAUDE.md");
  const [first, ...rest] = claude.split("\n");
  if (first.trim() !== "# CLAUDE.md") {
    throw new Error(`CLAUDE.md 첫 줄이 "# CLAUDE.md"가 아니다 (실제: ${first})`);
  }
  return `${preamble}\n\n${rest.join("\n").replace(/^\n+/, "")}`;
}

function buildSkill(name, { description, body }) {
  return [
    "---",
    `name: "source-command-${name}"`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    `# source-command-${name}`,
    "",
    `Use this skill when the user asks to run the migrated source command \`${name}\`.`,
    "",
    "## Command Template",
    "",
    body.trimEnd(),
    "",
  ].join("\n");
}

const outputs = new Map([["AGENTS.md", buildAgentsMd()]]);
const mirrored = new Set();

for (const file of readdirSync(join(ROOT, ".claude/commands")).sort()) {
  if (!file.endsWith(".md")) continue;
  const name = file.slice(0, -3);
  if (EXCLUDE.has(name)) continue;
  mirrored.add(`source-command-${name}`);
  outputs.set(
    `.agents/skills/source-command-${name}/SKILL.md`,
    buildSkill(name, parseCommand(read(`.claude/commands/${file}`), name)),
  );
}

const orphans = existsSync(join(ROOT, ".agents/skills"))
  ? readdirSync(join(ROOT, ".agents/skills")).filter((d) => !mirrored.has(d))
  : [];

const drift = [];
for (const [rel, content] of outputs) {
  const abs = join(ROOT, rel);
  const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  if (current === content) continue;
  drift.push(`${current === null ? "missing" : "stale"}: ${rel}`);
  if (!CHECK) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}
for (const d of orphans) {
  drift.push(`orphan: .agents/skills/${d}`);
  if (!CHECK) rmSync(join(ROOT, ".agents/skills", d), { recursive: true, force: true });
}

if (CHECK) {
  if (drift.length) {
    console.error("Codex 미러 드리프트 — `pnpm sync:agents` 실행 필요:");
    for (const d of drift) console.error(`  - ${d}`);
    process.exit(1);
  }
  console.log("Codex 미러 최신 상태.");
} else {
  console.log(drift.length ? `Codex 미러 동기화 (${drift.length}건):` : "Codex 미러 변경 없음.");
  for (const d of drift) console.log(`  - ${d}`);
}
