import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, cleanup, waitFor } from "@testing-library/react";

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

import TiptapEditor, { type TiptapEditorHandle } from "../TiptapEditor";

// BlockImage의 직렬화기는 자기 테스트(blockImageMarkdown.test.tsx)가 잡는다. 잡히지 않던 건
// **그게 실제 에디터에 꽂혀 있는가**다 — 확장 배열의 BlockImage를 stock Image로 되돌려도
// 전 스위트가 green이었다(뮤테이션 실측). 직렬화기를 각자 세운 Editor로만 검증하면
// 배선은 원리적으로 못 본다. 여기서만 진짜 컴포넌트가 만든 인스턴스를 쓴다.
describe("TiptapEditor — 이미지 블록 직렬화 배선", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("실제 에디터가 내보내는 마크다운에서 이미지와 다음 문단이 갈린다", async () => {
    const onChange = vi.fn();
    const ref = createRef<TiptapEditorHandle>();
    render(
      <TiptapEditor
        ref={ref}
        value={"intro\n\n![](https://e.com/x.png)\n\nhello"}
        onChange={onChange}
      />,
    );

    // onUpdate에서만 onChange가 나온다. jsdom엔 elementFromPoint·getClientRects가 없어
    // 포인터·키보드 입력이 ProseMirror에서 죽으므로, 노출된 핸들로 편집을 유발한다.
    await waitFor(() => expect(ref.current).not.toBeNull());
    ref.current!.insertCodeBlock("x");

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const emitted = onChange.mock.calls.at(-1)![0] as string;

    expect(emitted).toContain("![](https://e.com/x.png)");
    expect(emitted).toContain("hello");
    // 배선이 stock Image로 되돌아가면 "![](…)hello"로 붙어 이 단언이 깨진다.
    expect(emitted).toMatch(/\)\n\n/);
    expect(emitted).not.toMatch(/\)hello/);
  });
});
