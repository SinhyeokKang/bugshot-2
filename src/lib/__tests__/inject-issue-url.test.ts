import { describe, expect, it } from "vitest";
import { injectIssueUrl } from "../inject-issue-url";

function makeDataUrl(html: string): string {
  const encoded = new TextEncoder().encode(html);
  let binary = "";
  for (let i = 0; i < encoded.length; i++) binary += String.fromCharCode(encoded[i]);
  return `data:text/html;base64,${btoa(binary)}`;
}

function decodeDataUrl(dataUrl: string): string {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const baseHtml = `<!DOCTYPE html><html><body><script id="__BUGSHOT_DATA__" type="application/json">{"networkLog":null,"consoleLog":null,"har":null,"consoleLogJson":null,"meta":{"version":"1.0.0","createdAt":"2025-01-01T00:00:00.000Z","pageUrl":"https://example.com"}}</script></body></html>`;

describe("injectIssueUrl", () => {
  it("issueUrl을 meta에 주입", () => {
    const dataUrl = makeDataUrl(baseHtml);
    const result = injectIssueUrl(dataUrl, "https://jira.example.com/browse/BUG-1");
    const html = decodeDataUrl(result);
    const match = html.match(/<script id="__BUGSHOT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const data = JSON.parse(match![1]);
    expect(data.meta.issueUrl).toBe("https://jira.example.com/browse/BUG-1");
  });

  it("기존 meta 필드 보존", () => {
    const dataUrl = makeDataUrl(baseHtml);
    const result = injectIssueUrl(dataUrl, "https://example.com/issue/1");
    const data = JSON.parse(
      decodeDataUrl(result).match(/<script id="__BUGSHOT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)![1],
    );
    expect(data.meta.version).toBe("1.0.0");
    expect(data.meta.pageUrl).toBe("https://example.com");
  });

  it("유효하지 않은 dataUrl → 원본 반환", () => {
    expect(injectIssueUrl("not-a-data-url", "https://x.com")).toBe("not-a-data-url");
  });

  it("__BUGSHOT_DATA__ 태그 없음 → 원본 반환", () => {
    const dataUrl = makeDataUrl("<html><body>no data</body></html>");
    expect(injectIssueUrl(dataUrl, "https://x.com")).toBe(dataUrl);
  });

  it("유니코드 콘텐츠 포함 HTML 처리", () => {
    const htmlWithUnicode = baseHtml.replace("</body>", "<p>한글 테스트</p></body>");
    const dataUrl = makeDataUrl(htmlWithUnicode);
    const result = injectIssueUrl(dataUrl, "https://linear.app/team/BUG-1");
    const html = decodeDataUrl(result);
    expect(html).toContain("한글 테스트");
    const data = JSON.parse(
      html.match(/<script id="__BUGSHOT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)![1],
    );
    expect(data.meta.issueUrl).toBe("https://linear.app/team/BUG-1");
  });
});
