import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
    },
  };
});

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  setLocale: () => {},
  useT: () => (key: string) => key,
  dateBcp47: () => "en-US",
}));

import { DraftEditDialog } from "../DraftEditDialog";
import type { DraftEditTarget } from "@/sidepanel/lib/applyDraftFieldEdit";

const TITLE = "Draft title";
const DESC = "- first line\n- second line";

const titleTarget: DraftEditTarget = { kind: "title", value: TITLE };
const sectionTarget: DraftEditTarget = {
  kind: "section",
  section: { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
  value: DESC,
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

describe("DraftEditDialog — 대상 전환 시 값 seed", () => {
  // jsdom에서 lazy 청크가 처음 해석되는 마운트는 Tiptap 뷰가 붙기 전에 값 동기화 effect가 돌아
  // 트리째 unmount된다. 청크를 한 번 해석해 두고 각 테스트는 해석된 lazy로 시작한다.
  beforeAll(async () => {
    render(<Harness target={sectionTarget} />);
    await new Promise((r) => setTimeout(r, 200));
    cleanup();
  });
  afterEach(cleanup);

  // #234: 본문 섹션 편집을 연 뒤(취소) 제목 편집을 열면 입력칸이 본문 내용으로 채워졌다.
  it("섹션 편집 → 닫기 → 제목 편집이면 입력칸은 제목이다", async () => {
    const { rerender } = render(<Harness target={sectionTarget} />);
    await waitFor(() =>
      expect(document.querySelector('[contenteditable="true"]')).not.toBeNull(),
      { timeout: 5000 },
    );

    rerender(<Harness target={null} />);
    rerender(<Harness target={titleTarget} />);

    const input = await screen.findByRole<HTMLInputElement>("textbox");
    await new Promise((r) => setTimeout(r, 50));
    expect(input.value).toBe(TITLE);
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it("섹션 편집 → 닫기 → 다른 섹션 편집이면 에디터는 새 섹션 내용이다", async () => {
    const expectedTarget: DraftEditTarget = {
      kind: "section",
      section: { id: "expectedResult", enabled: true, renderAs: "paragraph", builtIn: true },
      value: "expected body",
    };
    const { rerender } = render(<Harness target={sectionTarget} />);
    await waitFor(() =>
      expect(document.querySelector('[contenteditable="true"]')).not.toBeNull(),
      { timeout: 5000 },
    );

    rerender(<Harness target={null} />);
    rerender(<Harness target={expectedTarget} />);

    await new Promise((r) => setTimeout(r, 50));
    const editor = document.querySelector('[contenteditable="true"]');
    expect(editor?.textContent).toBe("expected body");
  });

  // 닫힘 애니메이션이 끝나기 전에 다음 대상을 여는 빠른 연속 클릭.
  it("섹션 편집에서 닫힘 없이 바로 제목 편집으로 넘어가도 입력칸은 제목이다", async () => {
    const { rerender } = render(<Harness target={sectionTarget} />);
    await waitFor(() =>
      expect(document.querySelector('[contenteditable="true"]')).not.toBeNull(),
      { timeout: 5000 },
    );

    rerender(<Harness target={titleTarget} />);

    const input = await screen.findByRole<HTMLInputElement>("textbox");
    await new Promise((r) => setTimeout(r, 50));
    expect(input.value).toBe(TITLE);
  });
});
