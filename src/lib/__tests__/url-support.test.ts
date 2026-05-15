import { describe, expect, it } from "vitest";
import { isSupportedUrl } from "../url-support";

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
