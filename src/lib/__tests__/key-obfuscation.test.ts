import { describe, it, expect } from "vitest";
import { obfuscateApiKey, deobfuscateApiKey } from "../key-obfuscation";

describe("key-obfuscation", () => {
  it("encode → decode roundtrip", () => {
    const key = "sk-proj-abc123xyz456";
    expect(deobfuscateApiKey(obfuscateApiKey(key))).toBe(key);
  });

  it("인코딩 결과가 원본과 다름 (평문 아님)", () => {
    const key = "sk-test-key-12345";
    const encoded = obfuscateApiKey(key);
    expect(encoded).not.toBe(key);
    expect(encoded).not.toContain(key);
  });

  it("빈 문자열 roundtrip", () => {
    expect(deobfuscateApiKey(obfuscateApiKey(""))).toBe("");
  });

  it("특수 문자 포함 키 roundtrip", () => {
    const key = "sk-ant_key+with/special=chars==";
    expect(deobfuscateApiKey(obfuscateApiKey(key))).toBe(key);
  });

  it("긴 API key roundtrip", () => {
    const key = "sk-" + "a".repeat(200);
    expect(deobfuscateApiKey(obfuscateApiKey(key))).toBe(key);
  });
});
