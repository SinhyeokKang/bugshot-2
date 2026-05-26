import { describe, it, expect } from "vitest";
import { shouldClearLogs } from "../navigation-clear";

describe("shouldClearLogs", () => {
  it("returns true for cross-origin navigation", () => {
    expect(
      shouldClearLogs("https://a.com/page", "https://b.com/page", "link"),
    ).toBe(true);
  });

  it("returns true for cross-origin even with same path", () => {
    expect(
      shouldClearLogs("https://a.com/foo", "https://b.com/foo", "typed"),
    ).toBe(true);
  });

  it("returns true for http→https same host (different origin)", () => {
    expect(
      shouldClearLogs("http://example.com/", "https://example.com/", "link"),
    ).toBe(true);
  });

  it("returns true for same-origin reload", () => {
    expect(
      shouldClearLogs("https://a.com/page", "https://a.com/page", "reload"),
    ).toBe(true);
  });

  it("returns true for same-origin reload with different query/hash", () => {
    expect(
      shouldClearLogs("https://a.com/p?q=1", "https://a.com/p?q=2", "reload"),
    ).toBe(true);
  });

  it("returns false for same-origin link navigation", () => {
    expect(
      shouldClearLogs("https://a.com/page1", "https://a.com/page2", "link"),
    ).toBe(false);
  });

  it("returns false for same-origin typed navigation", () => {
    expect(
      shouldClearLogs("https://a.com/", "https://a.com/about", "typed"),
    ).toBe(false);
  });

  it("returns false for same-origin form submit", () => {
    expect(
      shouldClearLogs(
        "https://a.com/form",
        "https://a.com/result",
        "form_submit",
      ),
    ).toBe(false);
  });

  it("returns true for subdomain change (cross-origin)", () => {
    expect(
      shouldClearLogs("https://app.a.com/", "https://api.a.com/", "link"),
    ).toBe(true);
  });

  it("returns true for port change (cross-origin)", () => {
    expect(
      shouldClearLogs(
        "https://a.com:3000/",
        "https://a.com:4000/",
        "link",
      ),
    ).toBe(true);
  });

  it("returns true when previousUrl is empty (first navigation)", () => {
    expect(shouldClearLogs("", "https://a.com/", "link")).toBe(true);
  });

  it("returns true when previousUrl is invalid", () => {
    expect(shouldClearLogs("not-a-url", "https://a.com/", "link")).toBe(true);
  });
});
