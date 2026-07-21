import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateIssueToV4 } from "../issues-migrations";
import type { PlatformId } from "@/types/platform";

// 보존/폐기 분기 검증: delete*Blob 호출 자체를 감시해야 하므로 blob-db를 모킹.
// (state 필드만 보면 실수로 delete가 들어가도 통과하므로 — design.md 위험 요소)
vi.mock("../blob-db", () => ({
  deleteVideoBlob: vi.fn(() => Promise.resolve()),
  clearVideoBlobs: vi.fn(() => Promise.resolve()),
  getVideoBlobKeys: vi.fn(() => Promise.resolve([])),
  deleteImageBlobs: vi.fn(() => Promise.resolve()),
  clearImageBlobs: vi.fn(() => Promise.resolve()),
  getImageBlobKeys: vi.fn(() => Promise.resolve([])),
  deleteNetworkLog: vi.fn(() => Promise.resolve()),
  clearNetworkLogs: vi.fn(() => Promise.resolve()),
  getNetworkLogKeys: vi.fn(() => Promise.resolve([])),
  deleteConsoleLog: vi.fn(() => Promise.resolve()),
  clearConsoleLogs: vi.fn(() => Promise.resolve()),
  getConsoleLogKeys: vi.fn(() => Promise.resolve([])),
  deleteActionLog: vi.fn(() => Promise.resolve()),
  clearActionLogs: vi.fn(() => Promise.resolve()),
  getActionLogKeys: vi.fn(() => Promise.resolve([])),
  deleteAttachmentBlobs: vi.fn(() => Promise.resolve()),
  clearAttachmentBlobs: vi.fn(() => Promise.resolve()),
  getAttachmentBlobKeys: vi.fn(() => Promise.resolve([])),
  saveImageBlobRaw: vi.fn(() => Promise.resolve()),
  dataUrlToBlob: vi.fn(),
}));

import {
  deleteVideoBlob,
  deleteImageBlobs,
  deleteNetworkLog,
  deleteConsoleLog,
  deleteActionLog,
  deleteAttachmentBlobs,
} from "../blob-db";
import {
  migrateIssuesState,
  stripSubmitted,
  useIssuesStore,
  type IssueRecord,
} from "../issues-store";
import { dataUrlToBlob, saveImageBlobRaw } from "../blob-db";

interface LegacyShape {
  id: string;
  status: "submitted" | "draft";
  title: string;
  createdAt: number;
  updatedAt: number;
  pageUrl: string;
  draft: { title: string; sections: Record<string, string> };
  snapshot: { before: boolean; after: boolean };
  platform?: PlatformId;
  key?: string;
  url?: string;
  jiraSiteId?: string;
}

const baseLegacy: LegacyShape = {
  id: "x",
  status: "submitted",
  title: "t",
  createdAt: 0,
  updatedAt: 0,
  pageUrl: "https://example.com",
  draft: { title: "t", sections: {} },
  snapshot: { before: false, after: false },
};

describe("issues-store v3→v4 마이그레이션 (platform 필드 채우기)", () => {
  it("platform 없는 entry → jira로 채움", () => {
    const out = migrateIssueToV4({ ...baseLegacy });
    expect(out.platform).toBe("jira");
  });

  it("platform 이미 있는 entry → 변경 없음 (멱등)", () => {
    const out = migrateIssueToV4({ ...baseLegacy, platform: "github" });
    expect(out.platform).toBe("github");
  });

  it("다른 필드 보존", () => {
    const out = migrateIssueToV4({
      ...baseLegacy,
      key: "BUG-1",
      url: "https://x.atlassian.net/browse/BUG-1",
      jiraSiteId: "x.atlassian.net",
    });
    expect(out.key).toBe("BUG-1");
    expect(out.url).toBe("https://x.atlassian.net/browse/BUG-1");
    expect(out.jiraSiteId).toBe("x.atlassian.net");
    expect(out.platform).toBe("jira");
  });

  it("두 번 호출해도 결과 동일 (멱등)", () => {
    const first = migrateIssueToV4({ ...baseLegacy });
    const second = migrateIssueToV4(first);
    expect(second).toEqual(first);
  });
});

describe("stripSubmitted (제출 시 record 정리)", () => {
  const draft: IssueRecord = {
    id: "abc",
    status: "draft",
    platform: "github",
    title: "x",
    createdAt: 0,
    updatedAt: 0,
    pageUrl: "https://example.com",
    pageTitle: "page",
    selector: "div.x",
    tagName: "div",
    viewport: { width: 100, height: 100 },
    draft: { title: "t", sections: { description: "d" } },
    snapshot: { before: true, after: true },
    styleEdits: { classList: [], inlineStyle: {}, text: "" },
    networkLogBlobKey: "abc",
    consoleLogBlobKey: "abc",
  };

  it("video/image 메타와 함께 network/console log 키도 비운다", () => {
    const out = stripSubmitted(draft, { key: "BUG-1" });
    expect(out.status).toBe("submitted");
    expect(out.snapshot).toEqual({ before: false, after: false });
    expect(out.styleEdits).toBeUndefined();
    expect(out.networkLogBlobKey).toBeUndefined();
    expect(out.consoleLogBlobKey).toBeUndefined();
    expect(out.key).toBe("BUG-1");
  });

  it("패치가 원본 필드를 덮어쓴다", () => {
    const out = stripSubmitted(draft, { platform: "linear", url: "https://linear.app/x" });
    expect(out.platform).toBe("linear");
    expect(out.url).toBe("https://linear.app/x");
  });

  // 승격(일반 트래커로 제출) 시 Slack 보존 플래그까지 폐기 — 일반 submitted와 동격 (목표 6).
  it("slackPreserved 플래그를 폐기한다 (승격 후 잔존 방지)", () => {
    const preserved = {
      ...draft,
      status: "submitted",
      platform: "slack",
      slackPreserved: true,
    } as IssueRecord;
    const out = stripSubmitted(preserved, { platform: "jira", key: "BUG-1" });
    expect(out.slackPreserved).toBeUndefined();
  });
});

describe("markSlackShared (Slack 제출 데이터 보존)", () => {
  const draft: IssueRecord = {
    id: "slk-1",
    status: "draft",
    platform: "jira",
    title: "x",
    createdAt: 0,
    updatedAt: 0,
    pageUrl: "https://example.com",
    draft: { title: "t", sections: { description: "d" } },
    snapshot: { before: true, after: true },
    styleEdits: { classList: [], inlineStyle: {}, text: "" },
    networkLogBlobKey: "slk-1",
    consoleLogBlobKey: "slk-1",
    actionLogBlobKey: "slk-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useIssuesStore.setState({ issues: [{ ...draft }] });
  });

  it("status=submitted, platform=slack, slackPreserved=true, key/url 세팅", () => {
    useIssuesStore.getState().markSlackShared("slk-1", {
      key: "C123",
      url: "https://slack.com/archives/C123/p1",
    });
    const out = useIssuesStore.getState().issues[0];
    expect(out.status).toBe("submitted");
    expect(out.platform).toBe("slack");
    expect(out.slackPreserved).toBe(true);
    expect(out.key).toBe("C123");
    expect(out.url).toBe("https://slack.com/archives/C123/p1");
  });

  it("draft/snapshot/styleEdits/blob 키를 보존한다 (폐기 안 함)", () => {
    useIssuesStore.getState().markSlackShared("slk-1", { key: "C", url: "u" });
    const out = useIssuesStore.getState().issues[0];
    expect(out.draft).toEqual({ title: "t", sections: { description: "d" } });
    expect(out.snapshot).toEqual({ before: true, after: true });
    expect(out.styleEdits).toEqual({ classList: [], inlineStyle: {}, text: "" });
    expect(out.networkLogBlobKey).toBe("slk-1");
    expect(out.consoleLogBlobKey).toBe("slk-1");
    expect(out.actionLogBlobKey).toBe("slk-1");
  });

  it("delete*Blob을 일절 호출하지 않는다 (보존의 핵심)", () => {
    useIssuesStore.getState().markSlackShared("slk-1", { key: "C", url: "u" });
    expect(deleteVideoBlob).not.toHaveBeenCalled();
    expect(deleteImageBlobs).not.toHaveBeenCalled();
    expect(deleteNetworkLog).not.toHaveBeenCalled();
    expect(deleteConsoleLog).not.toHaveBeenCalled();
    expect(deleteActionLog).not.toHaveBeenCalled();
    expect(deleteAttachmentBlobs).not.toHaveBeenCalled();
  });
});

describe("markSubmitted (대비 — 데이터 폐기 경로)", () => {
  const draft: IssueRecord = {
    id: "sub-1",
    status: "draft",
    platform: "jira",
    title: "x",
    createdAt: 0,
    updatedAt: 0,
    pageUrl: "https://example.com",
    draft: { title: "t", sections: { description: "d" } },
    snapshot: { before: true, after: true },
    networkLogBlobKey: "sub-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useIssuesStore.setState({ issues: [{ ...draft }] });
  });

  it("제출 시 delete*Blob을 모두 호출한다 (markSlackShared와 정반대)", () => {
    useIssuesStore.getState().markSubmitted("sub-1", {
      platform: "jira",
      key: "BUG-1",
      url: "https://x.atlassian.net/browse/BUG-1",
    });
    expect(deleteVideoBlob).toHaveBeenCalledWith("sub-1");
    expect(deleteImageBlobs).toHaveBeenCalledWith("sub-1");
    expect(deleteNetworkLog).toHaveBeenCalledWith("sub-1");
    expect(deleteConsoleLog).toHaveBeenCalledWith("sub-1");
    expect(deleteActionLog).toHaveBeenCalledWith("sub-1");
    expect(deleteAttachmentBlobs).toHaveBeenCalledWith("sub-1");
  });

  it("제출 후 draft/blob 키가 비워진다", () => {
    useIssuesStore.getState().markSubmitted("sub-1", { key: "BUG-1" });
    const out = useIssuesStore.getState().issues[0];
    expect(out.status).toBe("submitted");
    expect(out.networkLogBlobKey).toBeUndefined();
    expect(out.draft).toEqual({ title: "", sections: {}, environment: [] });
  });
});

// persist migrate 콜백 본체. 구버전에서 올라오는 사용자의 초안·이미지가 지나는 유일한 경로라
// 여기서 유실되면 복구 수단이 없다 (감사 🔴 항목).
describe("migrateIssuesState (persist migrate 본체)", () => {
  beforeEach(() => {
    vi.mocked(saveImageBlobRaw).mockClear();
    vi.mocked(saveImageBlobRaw).mockResolvedValue(undefined);
    vi.mocked(dataUrlToBlob).mockReturnValue(new Blob(["x"]));
  });

  it("v0: submitted 이슈를 stripSubmitted로 정리한다", async () => {
    const out = await migrateIssuesState(
      {
        issues: [
          {
            ...baseLegacy,
            status: "submitted",
            draft: { title: "남은 초안", sections: { description: "본문" } },
            networkLogBlobKey: "x",
          },
        ],
      },
      0,
    );
    expect(out.issues[0].draft).toEqual({ title: "", sections: {}, environment: [] });
    expect(out.issues[0].networkLogBlobKey).toBeUndefined();
  });

  it("v0: draft 이슈는 strip하지 않는다", async () => {
    const out = await migrateIssuesState(
      {
        issues: [
          { ...baseLegacy, status: "draft", draft: { title: "초안", sections: { description: "본문" } } },
        ],
      },
      0,
    );
    expect(out.issues[0].draft.title).toBe("초안");
  });

  it("v1: snapshot의 dataURL을 blob으로 옮기고 boolean으로 정규화한다", async () => {
    const out = await migrateIssuesState(
      {
        issues: [
          {
            ...baseLegacy,
            status: "draft",
            snapshot: { before: "data:image/png;base64,AAA", after: null },
          },
        ],
      },
      1,
    );
    expect(saveImageBlobRaw).toHaveBeenCalledWith("x", "before", expect.anything());
    expect(out.issues[0].snapshot).toEqual({ before: true, after: false });
  });

  // blob 저장이 실패해도 스키마는 boolean으로 정합해야 한다 — 문자열이 남으면 이후 로딩이 깨진다.
  it("v1: blob 저장이 실패해도 snapshot을 boolean으로 정규화한다", async () => {
    vi.mocked(saveImageBlobRaw).mockRejectedValueOnce(new Error("quota"));
    const out = await migrateIssuesState(
      {
        issues: [
          {
            ...baseLegacy,
            status: "draft",
            snapshot: { before: "data:image/png;base64,AAA", after: null },
          },
        ],
      },
      1,
    );
    expect(out.issues[0].snapshot).toEqual({ before: false, after: false });
  });

  it("v2: legacy draft의 body/expectedResult를 sections로 이관한다", async () => {
    const out = await migrateIssuesState(
      {
        issues: [
          {
            ...baseLegacy,
            status: "draft",
            draft: { title: "제목", body: "본문", expectedResult: "기대" },
          },
        ],
      },
      2,
    );
    expect(out.issues[0].draft).toEqual({
      title: "제목",
      sections: { description: "본문", expectedResult: "기대" },
    });
  });

  it("v2: 이미 sections가 있으면 건드리지 않는다", async () => {
    const sections = { description: "그대로" };
    const out = await migrateIssuesState(
      { issues: [{ ...baseLegacy, status: "draft", draft: { title: "t", sections } }] },
      2,
    );
    expect(out.issues[0].draft.sections).toEqual(sections);
  });

  it("v3: platform 없는 entry를 jira로 채운다", async () => {
    const out = await migrateIssuesState(
      { issues: [{ ...baseLegacy, status: "draft", platform: undefined }] },
      3,
    );
    expect(out.issues[0].platform).toBe("jira");
  });

  it("최신 버전(v5)이면 아무 분기도 타지 않는다", async () => {
    const issue = { ...baseLegacy, status: "draft" as const, platform: "github" as const };
    // 입력 객체를 그대로 기대값으로 쓰면 in-place 변형 시 기대값도 같이 변해 무력해진다 — 깊은 복사로 고정.
    const before = structuredClone(issue);
    const out = await migrateIssuesState({ issues: [issue] }, 5);
    expect(out.issues[0]).toEqual(before);
    expect(saveImageBlobRaw).not.toHaveBeenCalled();
  });

  it("빈 목록도 안전하게 통과한다", async () => {
    const out = await migrateIssuesState({ issues: [] }, 0);
    expect(out.issues).toEqual([]);
  });
});
