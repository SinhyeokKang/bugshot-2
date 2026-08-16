import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BadgeFallback } from "../BadgeFallback";
import { STATUS_CATEGORY_COLORS } from "../constants";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));

const DELETED = STATUS_CATEGORY_COLORS.deleted;

describe("BadgeFallback", () => {
  it("kind별 문구가 다르다", () => {
    const { rerender } = render(<BadgeFallback kind="deleted" />);
    expect(screen.getByText("issueList.deleted")).toBeTruthy();

    rerender(<BadgeFallback kind="error" />);
    expect(screen.getByText("issueList.unknown")).toBeTruthy();

    rerender(<BadgeFallback kind="loading" />);
    expect(screen.getByText("issueList.submitted")).toBeTruthy();
  });

  it("deleted만 빨강 계열 색 클래스를 입는다", () => {
    const { container } = render(<BadgeFallback kind="deleted" />);
    const cls = container.firstElementChild!.className;

    expect(cls).toContain(DELETED.bg);
    expect(cls).toContain(DELETED.text);
    expect(cls).toContain(DELETED.darkBg);
    expect(cls).toContain(DELETED.darkText);
    expect(cls).toContain("border-transparent");
  });

  // 색을 무조건 입히는 구현이면 위 케이스만으로는 통과한다 — 음성 케이스가 판별자다.
  it("error·loading에는 색 클래스가 없다", () => {
    for (const kind of ["error", "loading"] as const) {
      const { container, unmount } = render(<BadgeFallback kind={kind} />);
      const cls = container.firstElementChild!.className;

      expect(cls, kind).not.toContain(DELETED.bg);
      expect(cls, kind).not.toContain(DELETED.text);
      expect(cls, kind).not.toContain("border-transparent");
      unmount();
    }
  });

  it("kind 3종이 공통 배지 치수 클래스를 공유한다", () => {
    for (const kind of ["deleted", "error", "loading"] as const) {
      const { container, unmount } = render(<BadgeFallback kind={kind} />);
      const cls = container.firstElementChild!.className;

      expect(cls, kind).toContain("w-fit");
      expect(cls, kind).toContain("shrink-0");
      expect(cls, kind).toContain("text-[11px]");
      unmount();
    }
  });
});
