import { describe, it, expect } from "vitest";
import { injectLogsMarkdownLink } from "../markdown-logs-link";

// 실제 본문의 로그 안내 줄 형태(ko/en) — buildLinearIssueBody의 emitLogSummary가
// `_${t("logSummary.logs.detail", { file: "logs.html" })}_` 로 출력한다.
const KO_LINE = "_첨부된 logs.html을 열면 콘솔·네트워크·클릭 동작을 시간순으로 살펴볼 수 있습니다._";
const EN_LINE = "_Open the attached logs.html to review console, network, and click activity in chronological order._";
const URL = "https://uploads.linear.app/abc/logs.html";

describe("injectLogsMarkdownLink", () => {
  it("wraps the bare logs.html token in the ko detail line as a markdown link", () => {
    expect(injectLogsMarkdownLink(KO_LINE, URL)).toBe(
      `_첨부된 [logs.html](${URL})을 열면 콘솔·네트워크·클릭 동작을 시간순으로 살펴볼 수 있습니다._`,
    );
  });

  it("wraps the bare logs.html token in the en detail line", () => {
    expect(injectLogsMarkdownLink(EN_LINE, URL)).toBe(
      `_Open the attached [logs.html](${URL}) to review console, network, and click activity in chronological order._`,
    );
  });

  it("returns the body unchanged when no logs.html token exists", () => {
    const body = "## Environment\n- OS: macOS\n\n_no logs here_";
    expect(injectLogsMarkdownLink(body, URL)).toBe(body);
  });

  it("returns the body unchanged when url is empty", () => {
    expect(injectLogsMarkdownLink(KO_LINE, "")).toBe(KO_LINE);
  });

  it("is idempotent — does not double-wrap an already-linked logs.html", () => {
    const linked = `_첨부된 [logs.html](${URL})을 열면…_`;
    expect(injectLogsMarkdownLink(linked, "https://new/logs.html")).toBe(linked);
  });

  it("does not touch logs.html that is part of a URL path", () => {
    const body = "see https://x.example.com/attachment/1/logs.html for details";
    expect(injectLogsMarkdownLink(body, URL)).toBe(body);
  });

  it("replaces only the first bare occurrence", () => {
    const body = "logs.html and again logs.html";
    expect(injectLogsMarkdownLink(body, URL)).toBe(
      `[logs.html](${URL}) and again logs.html`,
    );
  });
});
