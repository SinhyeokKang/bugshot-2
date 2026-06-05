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

// buildLogsHtml은 issueUrl/issueKey를 평문 META 태그의 빈 자리로 둔다(무거운 데이터는 별도 gzip DATA 태그).
const META_JSON = `{"version":"1.0.0","createdAt":"2025-01-01T00:00:00.000Z","pageUrl":"https://example.com","issueKey":"","issueUrl":""}`;
const baseHtml = `<!DOCTYPE html><html><body><script id="__BUGSHOT_DATA__" type="application/gzip-base64">H4sICOMPRESSED</script><script id="__BUGSHOT_META__" type="application/json">${META_JSON}</script></body></html>`;

function extractMeta(html: string): Record<string, any> {
  return JSON.parse(
    html.match(/<script id="__BUGSHOT_META__" type="application\/json">([\s\S]*?)<\/script>/)![1],
  );
}

function extractDataTag(html: string): string {
  return html.match(/<script id="__BUGSHOT_DATA__" type="application\/gzip-base64">([\s\S]*?)<\/script>/)![1];
}

describe("injectIssueUrl", () => {
  it("빈 issueUrl 자리에 주입", async () => {
    const result = await injectIssueUrl(makeDataUrl(baseHtml), "https://jira.example.com/browse/BUG-1");
    expect(extractMeta(decodeDataUrl(result)).issueUrl).toBe("https://jira.example.com/browse/BUG-1");
  });

  it("기존 meta 필드 보존", async () => {
    const result = await injectIssueUrl(makeDataUrl(baseHtml), "https://example.com/issue/1");
    const meta = extractMeta(decodeDataUrl(result));
    expect(meta.version).toBe("1.0.0");
    expect(meta.pageUrl).toBe("https://example.com");
  });

  it("issueKey도 함께 주입", async () => {
    const result = await injectIssueUrl(makeDataUrl(baseHtml), "https://jira.example.com/browse/BUG-1", "BUG-1");
    const meta = extractMeta(decodeDataUrl(result));
    expect(meta.issueKey).toBe("BUG-1");
    expect(meta.issueUrl).toBe("https://jira.example.com/browse/BUG-1");
  });

  it("issueKey 미전달 시 빈 문자열 유지", async () => {
    const result = await injectIssueUrl(makeDataUrl(baseHtml), "https://example.com/issue/1");
    expect(extractMeta(decodeDataUrl(result)).issueKey).toBe("");
  });

  it("유효하지 않은 dataUrl → 원본 반환", async () => {
    expect(await injectIssueUrl("not-a-data-url", "https://x.com")).toBe("not-a-data-url");
  });

  it("__BUGSHOT_META__ 태그 없음 → 원본 반환", async () => {
    const dataUrl = makeDataUrl("<html><body>no meta</body></html>");
    expect(await injectIssueUrl(dataUrl, "https://x.com")).toBe(dataUrl);
  });

  it("유니코드 콘텐츠 포함 HTML 처리", async () => {
    const dataUrl = makeDataUrl(baseHtml.replace("</body>", "<p>한글 테스트</p></body>"));
    const html = decodeDataUrl(await injectIssueUrl(dataUrl, "https://linear.app/team/BUG-1"));
    expect(html).toContain("한글 테스트");
    expect(extractMeta(html).issueUrl).toBe("https://linear.app/team/BUG-1");
  });

  it("pageUrl 값에 marker 리터럴이 박혀도 진짜 issueUrl만 치환 (충돌 회귀)", async () => {
    const evilUrl = 'https://x.com/?q="issueUrl":""';
    const meta = `{"version":"1.0.0","createdAt":"2025-01-01T00:00:00.000Z","pageUrl":${JSON.stringify(evilUrl)},"issueKey":"","issueUrl":""}`;
    const html = `<!DOCTYPE html><html><body><script id="__BUGSHOT_META__" type="application/json">${meta}</script></body></html>`;
    const parsed = extractMeta(decodeDataUrl(await injectIssueUrl(makeDataUrl(html), "https://jira.example.com/browse/BUG-2")));
    expect(parsed.pageUrl).toBe(evilUrl); // pageUrl 내부 marker는 건드리지 않음(lastIndexOf가 진짜 issueUrl을 잡음)
    expect(parsed.issueUrl).toBe("https://jira.example.com/browse/BUG-2");
  });

  it("압축 DATA 태그(대용량)는 injectIssueUrl이 건드리지 않는다 — META만 치환", async () => {
    // injectIssueUrl은 평문 META만 다룬다. 무거운 gzip DATA blob은 byte-identical로 보존.
    const bigBlob = "H4sI" + "A".repeat(1_000_000);
    const html = `<!DOCTYPE html><html><body><script id="__BUGSHOT_DATA__" type="application/gzip-base64">${bigBlob}</script><script id="__BUGSHOT_META__" type="application/json">${META_JSON}</script></body></html>`;
    const out = decodeDataUrl(await injectIssueUrl(makeDataUrl(html), "https://jira.example.com/browse/BUG-9", "BUG-9"));
    expect(extractDataTag(out)).toBe(bigBlob); // 압축 blob 불변
    const meta = extractMeta(out);
    expect(meta.issueUrl).toBe("https://jira.example.com/browse/BUG-9");
    expect(meta.issueKey).toBe("BUG-9");
  });
});
