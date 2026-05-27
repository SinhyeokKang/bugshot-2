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

// buildLogsHtml은 issueUrl을 항상 meta의 마지막 키로 빈 자리("issueUrl":"")로 둔다.
const baseHtml = `<!DOCTYPE html><html><body><script id="__BUGSHOT_DATA__" type="application/json">{"networkLog":null,"consoleLog":null,"har":null,"consoleLogJson":null,"meta":{"version":"1.0.0","createdAt":"2025-01-01T00:00:00.000Z","pageUrl":"https://example.com","issueUrl":""}}</script></body></html>`;

function extract(html: string): Record<string, any> {
  return JSON.parse(
    html.match(/<script id="__BUGSHOT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)![1],
  );
}

describe("injectIssueUrl", () => {
  it("빈 issueUrl 자리에 주입", async () => {
    const result = await injectIssueUrl(makeDataUrl(baseHtml), "https://jira.example.com/browse/BUG-1");
    expect(extract(decodeDataUrl(result)).meta.issueUrl).toBe("https://jira.example.com/browse/BUG-1");
  });

  it("기존 meta 필드 보존", async () => {
    const result = await injectIssueUrl(makeDataUrl(baseHtml), "https://example.com/issue/1");
    const data = extract(decodeDataUrl(result));
    expect(data.meta.version).toBe("1.0.0");
    expect(data.meta.pageUrl).toBe("https://example.com");
  });

  it("유효하지 않은 dataUrl → 원본 반환", async () => {
    expect(await injectIssueUrl("not-a-data-url", "https://x.com")).toBe("not-a-data-url");
  });

  it("__BUGSHOT_DATA__ 태그 없음 → 원본 반환", async () => {
    const dataUrl = makeDataUrl("<html><body>no data</body></html>");
    expect(await injectIssueUrl(dataUrl, "https://x.com")).toBe(dataUrl);
  });

  it("유니코드 콘텐츠 포함 HTML 처리", async () => {
    const dataUrl = makeDataUrl(baseHtml.replace("</body>", "<p>한글 테스트</p></body>"));
    const html = decodeDataUrl(await injectIssueUrl(dataUrl, "https://linear.app/team/BUG-1"));
    expect(html).toContain("한글 테스트");
    expect(extract(html).meta.issueUrl).toBe("https://linear.app/team/BUG-1");
  });

  it("pageUrl 값에 marker 리터럴이 박혀도 진짜 issueUrl만 치환 (충돌 회귀)", async () => {
    const evilUrl = 'https://x.com/?q="issueUrl":""';
    const data = {
      networkLog: null,
      meta: { version: "1.0.0", createdAt: "2025-01-01T00:00:00.000Z", pageUrl: evilUrl, issueUrl: "" },
    };
    const html = `<!DOCTYPE html><html><body><script id="__BUGSHOT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
    const parsed = extract(decodeDataUrl(await injectIssueUrl(makeDataUrl(html), "https://jira.example.com/browse/BUG-2")));
    expect(parsed.meta.pageUrl).toBe(evilUrl); // pageUrl 내부 marker는 건드리지 않음
    expect(parsed.meta.issueUrl).toBe("https://jira.example.com/browse/BUG-2");
  });

  it("영상 임베드 대용량 dataUrl도 video 보존 + issueUrl 주입 (전체 재파싱 회피 회귀)", async () => {
    const fakeVideo = "data:video/mp4;base64," + "A".repeat(1_000_000);
    const data = {
      networkLog: null,
      video: { dataUrl: fakeVideo, startedAt: 1000 },
      meta: { version: "1.0.0", createdAt: "2025-01-01T00:00:00.000Z", pageUrl: "https://example.com", issueUrl: "" },
    };
    const html = `<!DOCTYPE html><html><body><script id="__BUGSHOT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
    const parsed = extract(decodeDataUrl(await injectIssueUrl(makeDataUrl(html), "https://jira.example.com/browse/BUG-9")));
    expect(parsed.meta.issueUrl).toBe("https://jira.example.com/browse/BUG-9");
    expect(parsed.video.dataUrl).toBe(fakeVideo);
    expect(parsed.video.startedAt).toBe(1000);
  });
});
