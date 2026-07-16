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
      selectable
      selectedId={selectedId}
      onActiveChange={(id) => {
        setSelectedId(id);
        onActiveChange(id);
      }}
    />
  );
}

describe("ConsoleLogContent — selectable 모드", () => {
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
  it("selectable 미공급이면 ring 하이라이트가 없고 클릭은 펼치기만 한다", async () => {
    render(<ConsoleLogContent entries={ENTRIES} />);

    await clickRow("e1");

    expect(screen.getByText(/at foo/)).toBeTruthy();
    expect(row("e1").className).not.toContain("ring-primary");
  });
});
