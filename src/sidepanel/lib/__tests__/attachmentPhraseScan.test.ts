import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { walkSources, relToRepo } from "@/test/sourceFiles";

// ─────────────────────────────────────────────────────────────────────────────
// 첨부 문구 ↔ 클립보드 복사 축 대조 스캔
//
// "첨부 파일을 보라"고 말하는 문구는 **제출 경로에서만 참이다.** 클립보드 복사본에는
// 첨부가 없어서 같은 문구가 거짓이 된다(사용자 보고: Media 섹션과 로그 요약이 존재하지
// 않는 파일을 가리켰다).
//
// 지점을 열거하지 않고 화이트리스트로 판정한다 — 열거는 다음에 추가되는 문구에서 구멍이
// 난다(POSTMORTEM 2026-08-19 "스캔 그물은 대상이 0건이라 정규식이 망가져도 green",
// 2026-07-14 "단일 출처를 우회한 하드코딩 1곳이 남아 침묵 첨부"). 모든 등장 지점은
// **축 경유** 또는 **제출 전용 면제** 둘 중 하나로 분류돼야 하고, 어느 쪽도 아니면 red다.
// ─────────────────────────────────────────────────────────────────────────────

// 첨부의 존재를 주장하는 문구 키.
const ATTACHMENT_PHRASE_KEYS = [
  "md.imageAttached",
  "md.videoAttached",
  "logSummary.logs.lead",
] as const;

// 복사 축 이름. 판정은 **파일 단위**다 — 줄 단위로 좁히면 구현 형태를 강제하게 된다(로그 리드는
// 문장이 길어 3항의 else 가지가 다음 줄로 넘어간다). 파일 안의 개별 지점 누락은 이 스캔이 아니라
// 축을 뒤집어 출력을 대조하는 동작 테스트가 잡는다. 여기서 막고 싶은 건 "새 문구·새 파일이 분류
// 밖에 생기는 것"이고, 그건 파일 단위로도 충분히 걸린다.
const AXIS = "forClipboard";

// 제출 전용 빌더 — 첨부가 실제로 존재하므로 축이 필요 없다.
// 죽은 항목(더는 문구를 쓰지 않는 파일)이 남으면 red다.
const SUBMIT_ONLY_EXEMPT = [
  "src/background/messages.ts",
  "src/sidepanel/lib/buildIssueAdf.ts",
  "src/sidepanel/lib/buildNotionIssueBody.ts",
  "src/sidepanel/lib/buildLinearIssueBody.ts",
  "src/sidepanel/lib/buildSlackBody.ts",
] as const;

// 사전 정의 파일은 키의 출처라 대상이 아니다.
const isDictionary = (rel: string) =>
  rel.startsWith("src/i18n/") || rel === "src/log-viewer/i18n.ts";

interface Hit {
  rel: string;
  line: number;
  text: string;
}

function collectHits(): Hit[] {
  const hits: Hit[] = [];
  for (const abs of walkSources(join(process.cwd(), "src"))) {
    const rel = relToRepo(abs);
    if (isDictionary(rel)) continue;
    const lines = readFileSync(abs, "utf8").split("\n");
    lines.forEach((text, i) => {
      if (ATTACHMENT_PHRASE_KEYS.some((k) => text.includes(k))) {
        hits.push({ rel, line: i + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

describe("첨부 문구는 복사 축을 경유하거나 제출 전용으로 면제돼야 한다", () => {
  const hits = collectHits();

  // 정규식이 망가져 0건이 되면 아래 단언들이 공허해진다.
  it("스캔 대상이 0건이 아니다(그물 자기검증)", () => {
    expect(hits.length).toBeGreaterThan(0);
  });

  it("분류되지 않은 첨부 문구 파일이 없다", () => {
    const axisFiles = new Set(
      hits
        .filter((h) => readFileSync(join(process.cwd(), h.rel), "utf8").includes(AXIS))
        .map((h) => h.rel),
    );
    const unclassified = [...new Set(hits.map((h) => h.rel))].filter(
      (rel) => !axisFiles.has(rel) && !SUBMIT_ONLY_EXEMPT.some((e) => e === rel),
    );

    expect(
      unclassified,
      "축을 경유하지도, 제출 전용으로 면제되지도 않은 파일",
    ).toEqual([]);
  });

  it("면제 목록에 죽은 항목이 없다", () => {
    const used = new Set(hits.map((h) => h.rel));
    const dead = SUBMIT_ONLY_EXEMPT.filter((e) => !used.has(e));

    expect(dead, "더는 첨부 문구를 쓰지 않는 면제 항목").toEqual([]);
  });

  // 복사 경로가 타는 두 파일은 반드시 축을 참조해야 한다 — 면제로 빠져나가면
  // 이 버그가 그대로 되살아난다.
  it("복사 경로가 타는 파일은 축을 참조한다", () => {
    for (const rel of [
      "src/sidepanel/lib/buildIssueMarkdown.ts",
      "src/sidepanel/lib/issueBodyShared.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src, `${rel}에 ${AXIS} 축이 없다`).toContain(AXIS);
    }
  });
});
