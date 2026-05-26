import { describe, expect, it } from "vitest";
import { classifyTabSupport, isSupportedUrl } from "../url-support";

describe("isSupportedUrl", () => {
  it("http URL → true", () => {
    expect(isSupportedUrl("http://example.com")).toBe(true);
  });

  it("https URL → true", () => {
    expect(isSupportedUrl("https://example.com/page")).toBe(true);
  });

  it("file URL → true", () => {
    expect(isSupportedUrl("file:///Users/test/index.html")).toBe(true);
  });

  it("chrome:// → false", () => {
    expect(isSupportedUrl("chrome://extensions")).toBe(false);
  });

  it("chrome-extension:// → false", () => {
    expect(isSupportedUrl("chrome-extension://abc/popup.html")).toBe(false);
  });

  it("chromewebstore.google.com → false", () => {
    expect(isSupportedUrl("https://chromewebstore.google.com")).toBe(false);
    expect(isSupportedUrl("https://chromewebstore.google.com/detail/ext/abc")).toBe(false);
  });

  it("chrome.google.com/webstore → false", () => {
    expect(isSupportedUrl("https://chrome.google.com/webstore")).toBe(false);
    expect(isSupportedUrl("https://chrome.google.com/webstore/detail/abc")).toBe(false);
  });

  it("chrome.google.com 비-webstore 경로 → true", () => {
    expect(isSupportedUrl("https://chrome.google.com/intl/en/chrome/")).toBe(true);
  });

  it("undefined → false", () => {
    expect(isSupportedUrl(undefined)).toBe(false);
  });

  it("빈 문자열 → false", () => {
    expect(isSupportedUrl("")).toBe(false);
  });

  it("잘못된 URL → false", () => {
    expect(isSupportedUrl("not a url")).toBe(false);
  });
});

describe("classifyTabSupport", () => {
  it("읽히는 지원 URL → supported", () => {
    expect(
      classifyTabSupport({ url: "https://example.com", contentUrl: undefined }),
    ).toBe("supported");
  });

  it("읽히는 미지원 URL → unsupported", () => {
    expect(
      classifyTabSupport({ url: "chrome://extensions", contentUrl: undefined }),
    ).toBe("unsupported");
  });

  it("tab.url 미확인 + content script가 지원 URL 보고 → permission-expired", () => {
    expect(
      classifyTabSupport({ url: undefined, contentUrl: "https://mobbin.com/x" }),
    ).toBe("permission-expired");
  });

  it("tab.url 빈 문자열도 미확인 취급 → permission-expired", () => {
    expect(
      classifyTabSupport({ url: "", contentUrl: "https://mobbin.com/x" }),
    ).toBe("permission-expired");
  });

  it("tab.url 미확인 + content script가 미지원 URL 보고 → unsupported", () => {
    expect(
      classifyTabSupport({ url: undefined, contentUrl: "chrome://extensions" }),
    ).toBe("unsupported");
  });

  it("tab.url 미확인 + content script 응답 없음 → unsupported", () => {
    expect(
      classifyTabSupport({ url: undefined, contentUrl: undefined }),
    ).toBe("unsupported");
  });
});
