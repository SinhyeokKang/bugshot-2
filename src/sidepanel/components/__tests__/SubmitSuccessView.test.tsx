import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

import { SubmitSuccessView } from "../SubmitSuccessView";

describe("SubmitSuccessView", () => {
  it("식별자가 있으면 그 링크를 건다", () => {
    const { container } = render(
      <SubmitSuccessView result={{ key: "WEB-12", url: "https://x/WEB-12" }} onClose={() => {}} />,
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://x/WEB-12");
    expect(link?.textContent).toContain("WEB-12");
  });

  // webhook json 모드는 응답을 읽지 않아 식별자가 없다. 빈 href를 걸면 화살표만 있는
  // 링크가 확장 페이지로 이동시킨다 — 링크 자체를 그리지 않는다.
  it("식별자가 없으면 링크를 아예 그리지 않는다", () => {
    const { container } = render(
      <SubmitSuccessView result={{ key: "", url: "" }} onClose={() => {}} />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("submit.success")).toBeTruthy();
  });
});

it("hides the review request for a known-created zero-file recovery", () => {
  render(<SubmitSuccessView result={{ key: "1", url: "https://example.com/1", attachments: [], submissionFailure: { stage: "body", code: "network" } }} onClose={() => {}} />);
  expect(screen.getByTestId("submit-success-partial")).toBeTruthy();
  expect(screen.getByText("recovery.createdTitle")).toBeTruthy();
  expect(screen.queryByText("settings.review")).toBeNull();
});

it.each(["partial", "unknown"] as const)("renders authoritative %s recovery even with an empty result list", (state) => {
  render(<SubmitSuccessView result={{ key: "", url: "", attachments: [], recovery: { state, issueId: "i", attemptId: "a", storageFailed: true } }} onClose={() => {}} />);
  expect(screen.getByTestId(`submit-success-${state}`)).toBeTruthy();
  expect(screen.getByText(state === "unknown" ? "recovery.error" : "recovery.storageFailed")).toBeTruthy();
  expect(screen.queryByText("settings.review")).toBeNull();
});
