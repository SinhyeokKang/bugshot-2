import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { relToRepo, walkSources } from "@/test/sourceFiles";

// statusBadges 7종의 팝오버 트리거는 갱신 중 `aria-disabled`로 잠긴다(진짜 `disabled`를
// 쓰면 shadcn base의 `disabled:pointer-events-none`이 스피너·툴팁까지 죽인다 — DESIGN §14).
// 그런데 `aria-disabled`는 포인터를 살려두므로 커서가 여전히 pointer라 "눌리는데 안 눌린다"가
// 된다. 잠금 클래스에 단일 출처가 없어 7벌이 각자 들고 있고, 8번째 플랫폼이 붙을 때
// 조용히 빠지는 게 이 계열의 실패 모드다 — 그래서 렌더가 아니라 전수 스캔으로 잠근다.
const BADGE_DIR = join(process.cwd(), "src/sidepanel/tabs/statusBadges");

/**
 * `aria-disabled`를 든 raw <button>의 여는 태그. 트리거가 아닌 옵션 행 버튼은 걸리지 않는다.
 * `[^>]*`로는 못 자른다 — `onClick={(e) => …}`의 화살표가 태그 끝으로 오인된다.
 * JSX 표현식 중괄호 깊이를 세서 depth 0의 `>`만 종료로 본다.
 */
function lockedButtonTag(src: string): string | null {
  for (const m of src.matchAll(/<button\b/g)) {
    const start = m.index;
    let depth = 0;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        const tag = src.slice(start, i + 1);
        if (tag.includes("aria-disabled")) return tag;
        break;
      }
    }
  }
  return null;
}

function badgeFiles(): string[] {
  return walkSources(BADGE_DIR).filter((p) => p.endsWith("StatusBadge.tsx"));
}

describe("statusBadges 잠금 어포던스", () => {
  // 정규식이 통째로 망가져도 아래 검사는 "태그를 못 찾음"이 아니라 조용한 통과가 될 수 있다.
  it("스캐너가 트리거만 집는다 (자기검증 앵커)", () => {
    const src = `<button type="button" className="y">B</button>
      <button
        type="button"
        className="x"
        onClick={(e) => e.stopPropagation()}
        aria-disabled={updating}
      >A</button>`;
    // 화살표 함수의 `>`를 태그 끝으로 오인하면 여기서 null이 나온다.
    expect(lockedButtonTag(src)).toContain("aria-disabled={updating}");
    expect(lockedButtonTag(src)).toContain("className=\"x\"");
    expect(lockedButtonTag(`<button type="button">B</button>`)).toBeNull();
  });

  // 디렉터리 이동·파일명 변경이 스캔 대상을 0으로 만들면 it.each가 통째로 사라진다.
  it("스캔 대상이 7종이다 (앵커)", () => {
    expect(badgeFiles().map(relToRepo).sort()).toEqual([
      "src/sidepanel/tabs/statusBadges/AsanaStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/ClickupStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/GithubStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/GitlabStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/JiraStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/LinearStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/NotionStatusBadge.tsx",
    ]);
  });

  it.each(badgeFiles().map(relToRepo))("%s 트리거가 커서 잠금을 건다", (rel) => {
    const tag = lockedButtonTag(readFileSync(join(process.cwd(), rel), "utf-8"));
    expect(tag).not.toBeNull();
    expect(tag).toContain("aria-disabled:cursor-not-allowed");
  });

  // 표준 잠금 관용구를 통째로 복사하면 여기가 깨진다 — 이 트리거들은 갱신 중 Loader2를
  // 띄우므로 DESIGN §14의 "스피너를 든 버튼은 opacity-50을 뺀다"가 적용된다.
  // (내부 Badge의 조건부 `opacity-50`은 별개 — 버튼 태그에 잠금 opacity를 얹지 않는다.)
  it.each(badgeFiles().map(relToRepo))("%s 트리거에 잠금 opacity를 얹지 않는다", (rel) => {
    const tag = lockedButtonTag(readFileSync(join(process.cwd(), rel), "utf-8"));
    expect(tag).not.toContain("aria-disabled:opacity");
  });
});
