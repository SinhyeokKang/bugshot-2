import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { relToRepo, walkSources } from "@/test/sourceFiles";

// statusBadges 트리거는 갱신 중 `aria-disabled`로 잠긴다(진짜 `disabled`를 쓰면 shadcn base의
// `disabled:pointer-events-none`이 스피너·툴팁까지 죽인다 — DESIGN §14). 그런데 `aria-disabled`는
// 포인터를 살려두므로 커서가 여전히 pointer라 "눌리는데 안 눌린다"가 된다. 잠금 클래스에 단일
// 출처가 없어 배지마다 각자 들고 있고, 8번째 플랫폼이 붙을 때 조용히 빠지는 게 이 계열의
// 실패 모드다 — 그래서 렌더가 아니라 전수 스캔으로 잠근다.
//
// **대상 선정은 파일명이 아니라 내용이다.** `*StatusBadge.tsx`로 고르면 필터 자체가 사각을
// 만들고, 그 필터 출력을 앵커로 다시 대조하면 항등식이라 다른 이름의 배지는 무음으로 빠진다
// (이 저장소가 반복해 밟은 "열거하면 목록 밖에서 샌다"의 파일명 판). 잠금 트리거를 든 파일은
// 전부 대상이고, 아래 census가 그 집합이 말없이 줄거나 늘지 않았는지만 지킨다.
const BADGE_DIR = join(process.cwd(), "src/sidepanel/tabs/statusBadges");

const CURSOR_LOCK = "aria-disabled:cursor-not-allowed";

/**
 * `aria-disabled`를 든 raw <button>의 여는 태그. 트리거가 아닌 옵션 행 버튼은 걸리지 않는다.
 * `[^>]*`로는 못 자른다 — `onClick={(e) => …}`의 화살표가 태그 끝으로 오인된다. JSX 표현식
 * 중괄호 깊이를 세되, 따옴표 구간은 통째로 건너뛴다(`title="a > b"`·`className="a{b"`가
 * 깊이 카운터를 오염시켜 태그를 영영 못 닫는 걸 막는다).
 */
function lockedButtonTag(src: string): string | null {
  for (const m of src.matchAll(/<button\b/g)) {
    const start = m.index;
    let depth = 0;
    let quote = "";
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
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

/** 잠금 트리거를 든 파일 전부. 파일명 관례가 아니라 내용이 대상 자격이다. */
function badgeFiles(): string[] {
  return walkSources(BADGE_DIR)
    .filter((p) => lockedButtonTag(readFileSync(p, "utf-8")) !== null)
    .map(relToRepo)
    .sort();
}

describe("statusBadges 잠금 어포던스", () => {
  // 스캐너가 통째로 망가지면 대상이 0이 되고 아래 it.each가 조용히 사라진다 — 앵커가 먼저 붙는다.
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
    expect(lockedButtonTag(src)).toContain('className="x"');
    expect(lockedButtonTag(`<button type="button">B</button>`)).toBeNull();
  });

  // 따옴표 구간을 안 건너뛰면 둘 다 null이 된다 — 문자열 속성 하나 추가에 무관한 배지가 red.
  it("스캐너가 따옴표 안의 `>`·`{`에 안 걸린다 (자기검증 앵커)", () => {
    expect(lockedButtonTag(`<button title="a > b" aria-disabled={updating}>X</button>`))
      .toContain("aria-disabled={updating}");
    expect(lockedButtonTag(`<button className="a{b" aria-disabled={updating}>X</button>`))
      .toContain("aria-disabled={updating}");
  });

  // 내용 기반 선정이라 이름이 무엇이든 새 잠금 트리거는 자동으로 대상이 된다. 이 census는
  // 그 집합이 **줄어드는** 쪽(트리거 소실·디렉터리 이동)을 잡는다. 늘어나면 여기가 red가 되고,
  // 그때 목록에 추가하는 행위가 곧 "새 배지도 잠금 규칙을 지키는지" 확인이다.
  it("잠금 트리거를 든 파일이 7종이다 (census)", () => {
    expect(badgeFiles()).toEqual([
      "src/sidepanel/tabs/statusBadges/AsanaStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/ClickupStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/GithubStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/GitlabStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/JiraStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/LinearStatusBadge.tsx",
      "src/sidepanel/tabs/statusBadges/NotionStatusBadge.tsx",
    ]);
  });

  it.each(badgeFiles())("%s 트리거가 커서 잠금을 건다", (rel) => {
    const tag = lockedButtonTag(readFileSync(join(process.cwd(), rel), "utf-8"));
    expect(tag).toContain(CURSOR_LOCK);
  });

  // 표준 잠금 관용구를 통째로 복사하면 여기가 깨진다 — 이 트리거들은 갱신 중 Loader2를
  // 띄우므로 DESIGN §14의 "스피너를 든 버튼은 opacity-50을 뺀다"가 적용된다.
  // (내부 Badge의 조건부 `opacity-50`은 별개 — 버튼 태그에 잠금 opacity를 얹지 않는다.)
  it.each(badgeFiles())("%s 트리거에 잠금 opacity를 얹지 않는다", (rel) => {
    const tag = lockedButtonTag(readFileSync(join(process.cwd(), rel), "utf-8"));
    expect(tag).not.toContain("aria-disabled:opacity");
  });
});
