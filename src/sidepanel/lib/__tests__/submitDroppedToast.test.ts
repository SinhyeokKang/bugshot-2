import { describe, expect, it } from "vitest";
import { submissionPresentation } from "../attachmentResults";

describe("submission feedback has one owner", () => {
  it.each(["capture:screenshot", "video", "inline:a", "logs", "user:a"])("shows a panel without a duplicate toast for %s", (fileId) => {
    expect(submissionPresentation("created", [{ fileId, delivery: "failed", presentation: "failed" }]))
      .toEqual({ screen: "partial", showPanel: true, showToast: false });
  });
  it("keeps unknown creation separate from successful empty-file submission", () => {
    expect(submissionPresentation("unknown", [])).toEqual({ screen: "unknown", showPanel: true, showToast: false });
    expect(submissionPresentation("created", [])).toEqual({ screen: "success", showPanel: false, showToast: false });
  });
  it("does not hide simultaneous independent failures", () => {
    expect(submissionPresentation("created", ["logs", "video"].map((fileId) => ({ fileId, delivery: "failed", presentation: "failed" }))))
      .toEqual({ screen: "partial", showPanel: true, showToast: false });
  });
});
