import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActionLogContent, NAV_ICON } from "../ActionLogContent";
import { TONE_TEXT } from "@/lib/log-colors";
import type { ActionEntry } from "@/types/action";

const VERB_TEMPLATES: Record<string, string> = {
  "actionLog.verb.input": "Entered {value} in {field}",
  "actionLog.verb.drag": "Dragged {source}",
};

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => VERB_TEMPLATES[key] ?? key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

const ENTRIES: ActionEntry[] = [
  { id: "a1", kind: "click", timestamp: 1000, pageUrl: "https://example.com/", target: "Submit" },
];

const CHIP_ENTRIES: ActionEntry[] = [
  { id: "in1", kind: "input", timestamp: 2000, pageUrl: "https://example.com/", fieldLabel: "Email", value: "hello@example.com" },
  { id: "in2", kind: "input", timestamp: 3000, pageUrl: "https://example.com/", fieldLabel: "Password", masked: true },
  { id: "dr1", kind: "drag", timestamp: 4000, pageUrl: "https://example.com/", dragSource: { name: "10743" } },
];

function row(id: string): HTMLElement {
  const el = document.querySelector(`[data-entry-id="${id}"]`);
  if (!el) throw new Error(`row ${id} not found`);
  return el as HTMLElement;
}

describe("ActionLogContent — mono 표면", () => {
  it("콘텐츠 span이 font-mono다(콘솔 인라인과 통일)", () => {
    render(<ActionLogContent entries={ENTRIES} />);
    const content = row("a1").querySelector(".flex-1") as HTMLElement;
    expect(content.className).toContain("font-mono");
  });

  it("콘텐츠 span에 leading-relaxed가 남지 않는다(text-mono 18px 행간에 합류)", () => {
    render(<ActionLogContent entries={ENTRIES} />);
    const content = row("a1").querySelector(".flex-1") as HTMLElement;
    expect(content.className).not.toContain("leading-relaxed");
  });
});

describe("ActionLogContent — Kbd chip 통일", () => {
  it("input value chip이 shadcn Kbd로 렌더 + testid 보존", () => {
    render(<ActionLogContent entries={CHIP_ENTRIES} />);
    const chip = row("in1").querySelector('[data-testid="action-value-chip"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.getAttribute("data-slot")).toBe("kbd");
  });

  it("masked input chip도 Kbd + testid + aria-label 보존", () => {
    render(<ActionLogContent entries={CHIP_ENTRIES} />);
    const chip = row("in2").querySelector('[data-testid="action-value-chip"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.getAttribute("data-slot")).toBe("kbd");
    expect(chip.getAttribute("aria-label")).toBe("actionLog.maskedValue");
  });

  it("drag source chip이 Kbd로 렌더", () => {
    render(<ActionLogContent entries={CHIP_ENTRIES} />);
    const chip = row("dr1").querySelector('[data-slot="kbd"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("10743");
  });

  // 값 칩은 mono 표면이라 형제 행 텍스트(text-mono=13px)와 같은 크기여야 한다. Kbd 기본 text-xs를
  // CHIP_CLS가 text-mono로 덮지 않으면 한 줄에 13px 텍스트 + 12px 칩이 섞인다(POSTMORTEM 2026-07-17
  // "표면 하나 누락" 재발 패턴). tailwind-merge라 렌더된 className에 text-xs가 남으면 안 덮였다는 뜻.
  it("input value chip이 text-mono로 렌더된다 (Kbd 기본 text-xs를 덮음)", () => {
    render(<ActionLogContent entries={CHIP_ENTRIES} />);
    const chip = row("in1").querySelector('[data-testid="action-value-chip"]') as HTMLElement;
    expect(chip.className).toContain("text-mono");
    expect(chip.className).not.toContain("text-xs");
  });
});

describe("ActionLogContent — 영상 seek 동기화(onSeek 공급)", () => {
  it("행 클릭이 onSeek(timestamp)을 발화한다", async () => {
    const onSeek = vi.fn();
    render(<ActionLogContent entries={ENTRIES} syncBaseMs={0} onSeek={onSeek} />);

    await userEvent.click(row("a1"));

    expect(onSeek).toHaveBeenCalledWith(1000);
  });

  it("mm:ss 칩 클릭은 stopPropagation으로 onSeek을 한 번만 발화(행 이중발화 없음)", async () => {
    const onSeek = vi.fn();
    render(<ActionLogContent entries={ENTRIES} syncBaseMs={0} onSeek={onSeek} />);

    const chip = row("a1").querySelector('[data-testid="log-rel-time"]') as HTMLElement;
    await userEvent.click(chip);

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(1000);
  });
});

// ko 문구는 {target}이 문두라 TimelineRow의 truncate가 판별어를 통째로 자른다(en은 동사 선두라
// 무사 — 로케일 비대칭). 즉 ko에선 아이콘이 유일한 판별축이라 두 유형이 같은 아이콘을 받으면
// 화면상 완전히 동일해진다. 타입은 오타만 잡고 "같은 아이콘 배정"은 못 잡아서 여기서 고정한다.
describe("NAV_ICON", () => {
  it("navigation 유형 4종이 서로 다른 아이콘을 쓴다", () => {
    const icons = [...NAV_ICON.values()];
    expect(icons).toHaveLength(4);
    expect(new Set(icons).size).toBe(4);
  });

  it("방향 판정이 되는 4종에만 배정된다", () => {
    expect([...NAV_ICON.keys()].sort()).toEqual(["back", "forward", "reload", "traverse"]);
  });
});

function navEntry(id: string, navType?: string): ActionEntry {
  return {
    id,
    kind: "navigation",
    timestamp: 1000,
    pageUrl: "https://example.com/",
    toUrl: "https://example.com/",
    navType: navType as ActionEntry["navType"],
  };
}

function iconClass(id: string): string {
  return row(id).querySelector("svg")?.getAttribute("class") ?? "";
}

describe("KindIcon — navigation 유형별 아이콘", () => {
  it("판정된 유형은 전용 아이콘, 구 값·미상은 MapPin 폴백", () => {
    render(
      <ActionLogContent
        entries={[
          navEntry("back", "back"),
          navEntry("reload", "reload"),
          navEntry("legacy", "load"),
          navEntry("none"),
        ]}
      />,
    );
    expect(iconClass("back")).toContain("lucide-arrow-left");
    expect(iconClass("reload")).toContain("lucide-rotate-cw");
    expect(iconClass("legacy")).toContain("lucide-map-pin");
    expect(iconClass("none")).toContain("lucide-map-pin");
  });

  // navType은 페이지가 위조한 __bugshot_action_data__로 임의 문자열이 될 수 있고(ARCHITECTURE
  // "등록 핸드셰이크" — sentinel은 페이지가 읽는다), 패널은 엔트리 필드를 검증하지 않는다.
  // 룩업 테이블이 Object.prototype을 상속하면 "constructor"가 truthy 함수로 잡혀 React가
  // 그걸 컴포넌트로 호출하고, ErrorBoundary가 저장소에 0건이라 패널 트리 전체가 내려간다.
  // 같은 KindIcon을 로그뷰어가 쓰므로 이슈에 첨부된 logs.html을 여는 팀원도 백지를 본다.
  it.each(["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"])(
    "위조된 navType %s도 크래시 없이 MapPin으로 접힌다",
    (forged) => {
      expect(() => render(<ActionLogContent entries={[navEntry("f", forged)]} />)).not.toThrow();
      expect(iconClass("f")).toContain("lucide-map-pin");
    },
  );
});

// POSTMORTEM 2026-08-14가 이월로 남긴 항목 — 이 파일이 로컬 text-sky-600·text-red-700을
// 들고 있어 TONE_TEXT와 값이 갈렸다(같은 파일 :69는 이미 TONE_TEXT.blue를 쓴다).
describe("ActionLogContent — 톤 단일 출처", () => {
  const TAG_ENTRY: ActionEntry[] = [
    {
      id: "t1",
      kind: "click",
      timestamp: 1000,
      pageUrl: "https://example.com/",
      tagName: "button",
      tagType: "submit",
    },
  ];

  it("태그명·타입값이 TONE_TEXT 클래스를 쓴다", () => {
    render(<ActionLogContent entries={TAG_ENTRY} />);
    const tag = document.querySelector('[data-testid="action-tag"]') as HTMLElement;
    const classes = Array.from(tag.querySelectorAll("span")).map((el) => el.className);

    expect(classes).toContain(TONE_TEXT.blue);
    expect(classes).toContain(TONE_TEXT.amber);
    expect(classes).toContain(TONE_TEXT.red);
  });
});
