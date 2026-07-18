import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MAX_LOG_REFS,
  renderLogRefBlocks,
  codeBlockMarkdown,
  appendLogBlocks,
  type LogRefSource,
} from "../renderLogRefs";
import { selectLogCandidates } from "../prompts/logCandidates";
import { serializeNetworkRequest, serializeConsoleEntry } from "../logToCodeBlock";
import { buildNetworkLogSummary, buildConsoleLogSummary } from "../buildLogSummary";
import { BYOK_CAPABILITIES, NANO_CAPABILITIES } from "../ai-provider";
import type { AiDraftSessionContext } from "../buildAiDraftPrompt";
import type { NetworkLog, NetworkRequest } from "@/types/network";
import type { ConsoleLog, ConsoleEntry } from "@/types/console";

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: "nr-1700000000000-0",
    url: "https://example.com/api/pay",
    method: "POST",
    status: 500,
    statusText: "Internal Server Error",
    startTime: 0,
    durationMs: 50,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "",
    phase: "complete",
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    id: "cl-1700000000000-0",
    level: "error",
    timestamp: 0,
    args: "TypeError: boom",
    pageUrl: "https://example.com/page",
    ...overrides,
  };
}

function makeNetworkLog(requests: NetworkRequest[]): NetworkLog {
  return {
    id: "net-1",
    startedAt: 0,
    endedAt: 1000,
    totalSeen: requests.length,
    captured: requests.length,
    warnings: [],
    requests,
  };
}

function makeConsoleLog(entries: ConsoleEntry[]): ConsoleLog {
  return {
    id: "con-1",
    startedAt: 0,
    endedAt: 1000,
    totalSeen: entries.length,
    captured: entries.length,
    entries,
  };
}

// 실제 파이프라인과 같은 경로로 후보를 만든다: store 스냅샷 → 요약 → 후보 선별.
function makeSource(
  requests: NetworkRequest[],
  entries: ConsoleEntry[],
  caps = BYOK_CAPABILITIES,
): LogRefSource {
  const ctx: AiDraftSessionContext = {
    caps,
    captureMode: "video",
    locale: "ko",
    url: "https://example.com/page",
    pageTitle: "Example Page",
    enabledSections: [{ id: "description" }],
    networkLogSummary: buildNetworkLogSummary(makeNetworkLog(requests)),
    consoleLogSummary: buildConsoleLogSummary(makeConsoleLog(entries)),
  };
  return { candidates: selectLogCandidates(ctx), requests, entries };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("MAX_LOG_REFS", () => {
  it("상한은 3 (임의값 — PRD 결정 2)", () => {
    expect(MAX_LOG_REFS).toBe(3);
  });
});

describe("renderLogRefBlocks", () => {
  it("유효 ref → 기존 직렬화 함수와 동일한 블록 (앱이 직렬화, AI 텍스트 미개입)", () => {
    const req = makeRequest();
    const entry = makeEntry();
    const src = makeSource([req], [entry]);
    const blocks = renderLogRefBlocks(["n1", "c1"], src);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual(serializeNetworkRequest(req));
    expect(blocks[1]).toEqual(serializeConsoleEntry(entry));
  });

  it("후보에 없는 ref → 조용히 스킵, throw 없음", () => {
    const src = makeSource([makeRequest()], []);
    expect(() => renderLogRefBlocks(["n9", "zzz"], src)).not.toThrow();
    expect(renderLogRefBlocks(["n9"], src)).toEqual([]);
  });

  it("compact에서 캡 밖 ref(n4·n5)는 후보가 아니므로 스킵 — 모델이 본 적 없는 로그는 안 들어간다", () => {
    const requests = Array.from({ length: 5 }, (_, i) =>
      makeRequest({ id: `nr-${i}`, url: `https://example.com/api/e${i}` }),
    );
    const src = makeSource(requests, [], NANO_CAPABILITIES);
    expect(src.candidates.network).toHaveLength(3);
    expect(renderLogRefBlocks(["n4"], src)).toEqual([]);
    expect(renderLogRefBlocks(["n5"], src)).toEqual([]);
  });

  it("중복 ref는 1개로 접힘", () => {
    const src = makeSource([], [makeEntry()]);
    expect(renderLogRefBlocks(["c1", "c1"], src)).toHaveLength(1);
  });

  it("유효 3개 → 3블록 (상한 이하 전부 삽입)", () => {
    const requests = [
      makeRequest({ id: "nr-0", url: "https://example.com/a" }),
      makeRequest({ id: "nr-1", url: "https://example.com/b" }),
    ];
    const src = makeSource(requests, [makeEntry()]);
    expect(renderLogRefBlocks(["n1", "n2", "c1"], src)).toHaveLength(3);
  });

  it("유효 4개 → 전부 버림 + [bugshot] console.warn", () => {
    const requests = Array.from({ length: 3 }, (_, i) =>
      makeRequest({ id: `nr-${i}`, url: `https://example.com/e${i}` }),
    );
    const src = makeSource(requests, [makeEntry()]);
    expect(renderLogRefBlocks(["n1", "n2", "n3", "c1"], src)).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).toContain("[bugshot]");
  });

  it("미지 ref를 뺀 유효 개수로 상한 판정 (미지 2 + 유효 3 → 3블록)", () => {
    const requests = Array.from({ length: 3 }, (_, i) =>
      makeRequest({ id: `nr-${i}`, url: `https://example.com/e${i}` }),
    );
    const src = makeSource(requests, []);
    expect(renderLogRefBlocks(["n1", "n2", "n3", "n8", "n9"], src)).toHaveLength(3);
  });
});

describe("codeBlockMarkdown", () => {
  it("language 있으면 ```lang fence", () => {
    const md = codeBlockMarkdown({ text: '{\n  "a": 1\n}', language: "json" });
    expect(md).toBe('```json\n{\n  "a": 1\n}\n```');
  });

  it("language 없으면 bare fence", () => {
    const md = codeBlockMarkdown({ text: "[error] boom" });
    expect(md).toBe("```\n[error] boom\n```");
  });

  it("본문에 백틱 3개가 있어도 비들여쓰기 fence는 정확히 2개 (neutralizeFences 경유)", () => {
    const req = makeRequest({
      responseBody: "before\n```\ninjected\n```\nafter",
    });
    const md = codeBlockMarkdown(serializeNetworkRequest(req));
    const fences = md.match(/^`{3,}/gm) ?? [];
    expect(fences).toHaveLength(2);
  });
});

describe("appendLogBlocks", () => {
  const block = { text: "[error] TypeError: boom" };

  it("빈 블록 배열 → 섹션 원문 그대로 (identity)", () => {
    expect(appendLogBlocks("본문", [])).toBe("본문");
  });

  it("섹션 끝에 빈 줄 구분으로 블록 추가", () => {
    expect(appendLogBlocks("본문", [block])).toBe(
      "본문\n\n```\n[error] TypeError: boom\n```",
    );
  });

  it("빈 섹션 → 선행 개행 없이 블록만", () => {
    expect(appendLogBlocks("", [block])).toBe("```\n[error] TypeError: boom\n```");
  });

  it("섹션에 이미 같은 텍스트의 블록이 있으면 그 블록은 스킵", () => {
    const section = appendLogBlocks("본문", [block]);
    expect(appendLogBlocks(section, [block])).toBe(section);
  });

  it("일부만 중복이면 새 블록만 추가", () => {
    const other = { text: "GET /api/user → 404 Not Found" };
    const section = appendLogBlocks("본문", [block]);
    const result = appendLogBlocks(section, [block, other]);
    expect(result).toBe(`${section}\n\n\`\`\`\nGET /api/user → 404 Not Found\n\`\`\``);
  });
});
