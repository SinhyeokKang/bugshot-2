import { describe, it, expect } from "vitest";
import { isLoopbackHost, isCredentialSafeUrl } from "../loopback-host";

describe("isLoopbackHost", () => {
  it("localhost 계열을 인정한다", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("localhost.")).toBe(true);
    expect(isLoopbackHost("foo.localhost")).toBe(true);
  });

  it("127.0.0.0/8 전체를 인정한다", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.0.0.2")).toBe(true);
    expect(isLoopbackHost("127.255.255.254")).toBe(true);
  });

  it("IPv6 loopback을 인정한다", () => {
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });

  it("사내망·공개 호스트는 loopback이 아니다", () => {
    expect(isLoopbackHost("gitlab.corp")).toBe(false);
    expect(isLoopbackHost("192.168.0.10")).toBe(false);
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
    expect(isLoopbackHost("notlocalhost")).toBe(false);
    // 이름에 localhost가 들어간 공개 도메인을 통과시키면 예외가 새어나간다.
    expect(isLoopbackHost("localhost.evil.com")).toBe(false);
  });
});

describe("isCredentialSafeUrl", () => {
  it("https는 호스트와 무관하게 통과", () => {
    expect(isCredentialSafeUrl(new URL("https://gitlab.corp"))).toBe(true);
  });

  it("loopback http만 예외로 통과 (ollama)", () => {
    expect(isCredentialSafeUrl(new URL("http://localhost:11434/v1"))).toBe(true);
    expect(isCredentialSafeUrl(new URL("http://127.0.0.1:11434/v1"))).toBe(true);
  });

  it("그 외 평문 http는 거부 — PAT·API 키 평문 전송 차단", () => {
    expect(isCredentialSafeUrl(new URL("http://gitlab.corp"))).toBe(false);
    expect(isCredentialSafeUrl(new URL("http://192.168.0.10:8080"))).toBe(false);
  });

  it("http(s) 아닌 스킴은 거부", () => {
    expect(isCredentialSafeUrl(new URL("ftp://localhost"))).toBe(false);
  });
});
