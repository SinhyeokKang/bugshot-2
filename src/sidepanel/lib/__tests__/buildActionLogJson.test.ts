import { describe, it, expect } from "vitest";
import { buildActionLogJson as rawBuildActionLogJson } from "../buildActionLogJson";
import type { ActionLog } from "@/types/action";

// version은 이제 인자 — 테스트 호출부 유지를 위해 래퍼로 주입.
const buildActionLogJson = (log: ActionLog) => rawBuildActionLogJson(log, "9.9.9");

function makeLog(overrides: Partial<ActionLog> = {}): ActionLog {
  return {
    id: "act-1",
    startedAt: 0,
    endedAt: 1000,
    totalSeen: 3,
    captured: 2,
    entries: [],
    ...overrides,
  };
}

describe("buildActionLogJson", () => {
  it("메타·creator·ISO 타임스탬프 변환", () => {
    const out = buildActionLogJson(
      makeLog({ startedAt: 0, endedAt: 1000 }),
    ) as Record<string, unknown>;

    expect(out.version).toBe(1);
    expect(out.creator).toEqual({ name: "BugShot", version: "9.9.9" });
    expect(out.startedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(out.endedAt).toBe("1970-01-01T00:00:01.000Z");
    expect(out.totalSeen).toBe(3);
    expect(out.captured).toBe(2);
  });

  it("엔트리 타임스탬프도 ISO, 정의된 필드만 직렬화", () => {
    const out = buildActionLogJson(
      makeLog({
        entries: [
          {
            id: "e1",
            kind: "click",
            timestamp: 500,
            pageUrl: "https://x.test",
            target: "Submit 버튼",
            selector: "#submit",
          },
        ],
      }),
    ) as { entries: Record<string, unknown>[] };

    const e = out.entries[0];
    expect(e.kind).toBe("click");
    expect(e.timestamp).toBe("1970-01-01T00:00:00.500Z");
    expect(e.pageUrl).toBe("https://x.test");
    expect(e.target).toBe("Submit 버튼");
    expect(e.selector).toBe("#submit");
    // 미정의 필드는 키 자체가 없어야 함
    expect("navType" in e).toBe(false);
    expect("value" in e).toBe(false);
    expect("masked" in e).toBe(false);
  });

  it("value가 빈 문자열이어도 직렬화, masked=false면 키 생략", () => {
    const out = buildActionLogJson(
      makeLog({
        entries: [
          {
            id: "e1",
            kind: "input",
            timestamp: 0,
            pageUrl: "",
            fieldLabel: "email",
            value: "",
            masked: false,
          },
        ],
      }),
    ) as { entries: Record<string, unknown>[] };

    const e = out.entries[0];
    expect("value" in e).toBe(true);
    expect(e.value).toBe("");
    expect("masked" in e).toBe(false);
  });

  it("masked=true면 masked 키 포함", () => {
    const out = buildActionLogJson(
      makeLog({
        entries: [
          {
            id: "e1",
            kind: "input",
            timestamp: 0,
            pageUrl: "",
            fieldLabel: "password",
            value: "***",
            masked: true,
          },
        ],
      }),
    ) as { entries: Record<string, unknown>[] };

    const e = out.entries[0];
    expect(e.masked).toBe(true);
    expect(e.value).toBe("***");
  });
});
