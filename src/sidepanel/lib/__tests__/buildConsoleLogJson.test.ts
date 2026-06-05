import { describe, expect, it } from "vitest";
import type { ConsoleLog } from "@/types/console";
import { buildConsoleLogJson, serializeConsoleLog } from "../buildConsoleLogJson";

const log: ConsoleLog = {
  id: "log-1",
  startedAt: 1700000000000,
  endedAt: 1700000060000,
  totalSeen: 10,
  captured: 5,
  entries: [
    {
      id: "e1",
      level: "log",
      timestamp: 1700000001000,
      args: "hello world",
      pageUrl: "https://example.com",
    },
    {
      id: "e2",
      level: "error",
      timestamp: 1700000002000,
      args: "oops",
      stack: "Error: oops\n  at fn (file.js:1)",
      pageUrl: "https://example.com",
    },
  ],
};

describe("buildConsoleLogJson", () => {
  it("version·creator·시간대 포함", () => {
    const result = buildConsoleLogJson(log, "1.0.0") as Record<string, unknown>;
    expect(result.version).toBe(1);
    expect(result.creator).toEqual({ name: "BugShot", version: "1.0.0" });
    expect(result.startedAt).toBe(new Date(1700000000000).toISOString());
    expect(result.endedAt).toBe(new Date(1700000060000).toISOString());
  });

  it("entries를 ISO timestamp로 변환", () => {
    const result = buildConsoleLogJson(log, "1.0.0") as Record<string, unknown>;
    const entries = result.entries as Record<string, unknown>[];
    expect(entries).toHaveLength(2);
    expect(entries[0].timestamp).toBe(new Date(1700000001000).toISOString());
    expect(entries[0].message).toBe("hello world");
  });

  it("stack 있으면 포함, 없으면 미포함", () => {
    const result = buildConsoleLogJson(log, "1.0.0") as Record<string, unknown>;
    const entries = result.entries as Record<string, unknown>[];
    expect(entries[0]).not.toHaveProperty("stack");
    expect(entries[1].stack).toContain("Error: oops");
  });

  it("totalSeen·captured 그대로 전달", () => {
    const result = buildConsoleLogJson(log, "1.0.0") as Record<string, unknown>;
    expect(result.totalSeen).toBe(10);
    expect(result.captured).toBe(5);
  });
});

describe("serializeConsoleLog", () => {
  it("pretty JSON 문자열 반환", () => {
    const str = serializeConsoleLog({ a: 1 });
    expect(str).toBe('{\n  "a": 1\n}');
  });
});
