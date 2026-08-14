import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConsoleLogContent } from "../ConsoleLogContent";
import type { ConsoleEntry } from "@/types/console";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

const ENTRIES: ConsoleEntry[] = [
  {
    id: "e1",
    level: "error",
    timestamp: 1000,
    args: "boom",
    stack: "  at foo (app.js:1:1)",
    pageUrl: "https://example.com/",
  },
  { id: "e2", level: "warn", timestamp: 2000, args: "careful", pageUrl: "https://example.com/" },
];

function row(id: string): HTMLElement {
  const el = document.querySelector(`[data-entry-id="${id}"]`);
  if (!el) throw new Error(`row ${id} not found`);
  return el as HTMLElement;
}

// 펼치면 args가 헤더·pre 두 곳에 렌더되므로 텍스트가 아니라 헤더 영역을 클릭한다.
async function clickRow(id: string): Promise<void> {
  await userEvent.click(row(id).firstElementChild as HTMLElement);
}

function SelectableHarness({ onActiveChange }: { onActiveChange: (id: string | null) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <ConsoleLogContent
      entries={ENTRIES}
      selectedId={selectedId}
      onActiveChange={(id) => {
        setSelectedId(id);
        onActiveChange(id);
      }}
    />
  );
}

describe("ConsoleLogContent — 선택 모드(selectedId 공급)", () => {
  it("행 클릭이 선택을 통지하고 ring 하이라이트가 뜬다", async () => {
    const onActiveChange = vi.fn();
    render(<SelectableHarness onActiveChange={onActiveChange} />);

    await clickRow("e1");

    expect(onActiveChange).toHaveBeenCalledWith("e1");
    expect(row("e1").className).toContain("ring-primary");
    expect(row("e2").className).not.toContain("ring-primary");
  });

  it("행 클릭은 선택과 동시에 펼쳐 stack을 보여준다", async () => {
    render(<SelectableHarness onActiveChange={vi.fn()} />);
    expect(screen.queryByText(/at foo/)).toBeNull();

    await clickRow("e1");

    expect(screen.getByText(/at foo/)).toBeTruthy();
  });

  it("재클릭은 접기만 하고 선택은 유지한다", async () => {
    render(<SelectableHarness onActiveChange={vi.fn()} />);
    await clickRow("e1");

    await clickRow("e1");

    expect(screen.queryByText(/at foo/)).toBeNull();
    expect(row("e1").className).toContain("ring-primary");
  });
});

describe("ConsoleLogContent — 비선택(기존) 모드", () => {
  it("선택 prop 미공급이면 ring 하이라이트가 없고 클릭은 펼치기만 한다", async () => {
    render(<ConsoleLogContent entries={ENTRIES} />);

    await clickRow("e1");

    expect(screen.getByText(/at foo/)).toBeTruthy();
    expect(row("e1").className).not.toContain("ring-primary");
  });
});

describe("ConsoleLogContent — mono 표면", () => {
  it("접힌 행 메시지 span이 font-mono다(펼친 pre와 서체 통일)", () => {
    render(<ConsoleLogContent entries={ENTRIES} />);

    const msg = row("e2").querySelector(".flex-1") as HTMLElement;
    expect(msg.className).toContain("font-mono");
  });

  it("펼친 상세의 페이지 URL 링크가 font-mono다(펼침 본문 서체 통일)", async () => {
    render(<ConsoleLogContent entries={ENTRIES} />);
    await clickRow("e1");

    const link = row("e1").querySelector('a[href="https://example.com/"]') as HTMLElement;
    expect(link.className).toContain("font-mono");
  });
});

describe("ConsoleLogContent — 펼침 상세 정렬", () => {
  // timestamp(LogSeekChip) 있을 때: 헤더 메시지 시작점 82px에 맞춰 pl-[82px].
  it("timestamp 있으면 pl-[82px]로 헤딩 텍스트에 정렬", async () => {
    render(<ConsoleLogContent entries={ENTRIES} startedAt={500} />);
    await clickRow("e1");

    const detail = row("e1").querySelector(".pt-1") as HTMLElement;
    expect(detail.className).toContain("pl-[82px]");
  });

  // timestamp 없을 때: 기존 pl-10 유지(아이콘 뒤 38px에 근사).
  it("timestamp 없으면 pl-10 유지", async () => {
    render(<ConsoleLogContent entries={ENTRIES} />);
    await clickRow("e1");

    const detail = row("e1").querySelector(".pt-1") as HTMLElement;
    expect(detail.className).toContain("pl-10");
    expect(detail.className).not.toContain("pl-[82px]");
  });
});

describe("ConsoleLogContent — 영상 seek 동기화(onSeek 공급)", () => {
  it("행 클릭이 펼치기와 함께 onSeek(timestamp)을 발화한다", async () => {
    const onSeek = vi.fn();
    render(<ConsoleLogContent entries={ENTRIES} startedAt={500} onSeek={onSeek} />);

    await clickRow("e1");

    expect(onSeek).toHaveBeenCalledWith(1000);
    // 펼치기 기존 동작 유지 — 상세 pre가 나타난다
    expect(row("e1").querySelector(".pt-1")).not.toBeNull();
  });

  it("mm:ss 칩 클릭은 stopPropagation으로 onSeek을 한 번만 발화(펼치기 미발동)", async () => {
    const onSeek = vi.fn();
    render(<ConsoleLogContent entries={ENTRIES} startedAt={500} onSeek={onSeek} />);

    const chip = row("e1").querySelector('[data-testid="log-rel-time"]') as HTMLElement;
    await userEvent.click(chip);

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(1000);
    expect(row("e1").querySelector(".pt-1")).toBeNull();
  });
});

// 레벨별 코드블럭 배경은 log-colors.ts 단일 출처(TONE_BG_STRONG)에서만 와야 한다. 로컬에
// 제3의 스케일을 두면 행 배경 축과 조용히 갈린다. 특히 log/debug의 neutral은 TONE_BG가
// 빈 문자열이라, 잘못 연결하면 코드블럭 면이 통째로 사라진다(다크에서 먼저 티가 난다).
describe("ConsoleLogContent — 레벨별 코드블럭 배경", () => {
  const LEVELS: { id: string; level: ConsoleEntry["level"]; bg: string }[] = [
    { id: "L1", level: "error", bg: "bg-red-200" },
    { id: "L2", level: "warn", bg: "bg-amber-200" },
    { id: "L3", level: "info", bg: "bg-blue-200" },
    { id: "L4", level: "log", bg: "bg-muted" },
  ];

  const LEVEL_ENTRIES: ConsoleEntry[] = LEVELS.map(({ id, level }) => ({
    id,
    level,
    timestamp: 1000,
    args: `msg-${id}`,
    pageUrl: "https://example.com/",
  }));

  function codeBlock(id: string): HTMLElement {
    const pre = row(id).querySelector("pre");
    if (!pre) throw new Error(`code block for ${id} not found`);
    return pre as HTMLElement;
  }

  for (const { id, level, bg } of LEVELS) {
    it(`${level} 레벨 코드블럭이 ${bg}를 쓴다`, async () => {
      render(<ConsoleLogContent entries={LEVEL_ENTRIES} />);

      await clickRow(id);

      expect(codeBlock(id).className).toContain(bg);
    });
  }

  it("log 레벨도 면을 잃지 않는다 (neutral 빈 문자열 연결 방지)", async () => {
    render(<ConsoleLogContent entries={LEVEL_ENTRIES} />);

    await clickRow("L4");

    expect(codeBlock("L4").className).not.toContain("bg-red");
    expect(codeBlock("L4").className).toContain("bg-muted");
  });
});
