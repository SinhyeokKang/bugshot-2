import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useRef } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
}));

// 실 Tiptap은 떠나는 순간 포커스 트랜잭션 → appendTransaction으로 onUpdate를 쏘지만, jsdom에서
// 그 타이밍은 결정적이지 않다. 계약만 고정한다: 언마운트 시점에 최신 onChange로 늦게 쓴다.
vi.mock("@/sidepanel/components/TiptapEditor", () => ({
  default: function LateEmitEditor({
    value,
    onChange,
  }: {
    value: string;
    onChange: (next: string) => void;
  }) {
    const latest = useRef(onChange);
    latest.current = onChange;
    const valueRef = useRef(value);
    valueRef.current = value;
    useEffect(() => () => latest.current(`${valueRef.current}\n`), []);
    return (
      <button data-testid="fake-editor" onClick={() => onChange("typed body")}>
        {value}
      </button>
    );
  },
}));

import { DraftEditDialog } from "../DraftEditDialog";
import type { DraftEditTarget } from "@/sidepanel/lib/applyDraftFieldEdit";

const titleTarget: DraftEditTarget = { kind: "title", value: "Draft title" };
const sectionTarget: DraftEditTarget = {
  kind: "section",
  section: { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
  value: "- first line",
};

function Harness({ target }: { target: DraftEditTarget | null }) {
  return (
    <DraftEditDialog
      open={target !== null}
      target={target}
      onOpenChange={() => {}}
      onSave={() => {}}
    />
  );
}

describe("DraftEditDialog — 떠나는 에디터의 늦은 onChange", () => {
  afterEach(cleanup);

  it("이전 대상 에디터가 언마운트하며 쓴 값은 새 대상의 값을 덮어쓰지 않는다", async () => {
    const { rerender } = render(<Harness target={sectionTarget} />);
    await screen.findByTestId("fake-editor");

    rerender(<Harness target={titleTarget} />);

    const input = await screen.findByRole<HTMLInputElement>("textbox");
    expect(input.value).toBe("Draft title");
  });

  it("현재 대상 에디터의 onChange는 저장 값에 반영된다(대조군)", async () => {
    const onSave = vi.fn();
    render(
      <DraftEditDialog
        open
        target={sectionTarget}
        onOpenChange={() => {}}
        onSave={onSave}
      />,
    );
    fireEvent.click(await screen.findByTestId("fake-editor"));
    fireEvent.click(screen.getByTestId("draft-edit-save"));
    expect(onSave).toHaveBeenCalledWith("typed body");
  });
});
