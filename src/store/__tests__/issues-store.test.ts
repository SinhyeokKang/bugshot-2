import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  getVideoBlobKeys,
  getImageBlobKeys,
  getNetworkLogKeys,
  getConsoleLogKeys,
  getActionLogKeys,
  getAttachmentBlobKeys,
} from "../blob-db";
import {
  mergeIssueLists,
  mergeIssuesState,
  migrateIssuesState,
  rehydrateIssuesFromExternalWrite,
  shouldPruneAfterRehydrate,
  shouldSyncIssuesChange,
  stripSubmitted,
  useIssuesStore,
  type IssueRecord,
  type IssuesState,
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

  // markSubmitted가 b{i}-before/after blob을 이미 지우므로, 플래그만 남으면 blob과 불일치한
  // 스타일 덤프가 제출된 이슈에 영구 잔존한다.
  it("bufferedElements를 폐기한다 (blob 삭제와 짝)", () => {
    const withBuffer = {
      ...draft,
      bufferedElements: [
        {
          selector: "div.a",
          tagName: "div",
          frameId: 0,
          origin: "",
          styleEdits: { classList: [], inlineStyle: {}, text: "" },
          selectionSnapshot: {
            classList: [],
            specifiedStyles: {},
            computedStyles: {},
            text: null,
            viewport: { width: 1, height: 1 },
            capturedAt: 0,
          },
          hasBefore: true,
          hasAfter: false,
        },
      ],
    } as IssueRecord;
    const out = stripSubmitted(withBuffer, { key: "BUG-1" });
    expect(out.bufferedElements).toBeUndefined();
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

  // draft.environment가 비워진 뒤 남는 유일한 캡처 문맥 — 사내 호스트명이 제출 후에도
  // chrome.storage.local에 무기한 잔류한다. 비우기 목록이 열거식이라 새 필드는 자동으로 살아남는다.
  it("apiHostsDerived를 비운다 (제출 후 사내 호스트명 잔류 방지)", () => {
    const withDerived = { ...draft, apiHostsDerived: "internal-admin.acme.com" } as IssueRecord;
    expect(stripSubmitted(withDerived, { key: "BUG-1" }).apiHostsDerived).toBeUndefined();
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

// saveDraft가 레코드를 통째로 교체하던 시절엔, confirmDraft가 만드는 record에 없는 필드는
// 재확정 한 번에 전부 사라졌다 — patchIssue로만 세팅되는 필드(logsAttached·attachments·
// 제출 결과 등)가 그 사각지대다.
describe("saveDraft (재확정 시 optional 필드 보존)", () => {
  const base: IssueRecord = {
    id: "dr-1",
    status: "draft",
    platform: "jira",
    title: "x",
    createdAt: 10,
    updatedAt: 10,
    pageUrl: "https://example.com",
    draft: { title: "t", sections: { description: "d" } },
    snapshot: { before: false, after: false },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useIssuesStore.setState({ issues: [] });
  });

  it("record에 없는 필드는 기존 레코드에서 살린다", () => {
    const store = useIssuesStore.getState();
    store.saveDraft({ ...base });
    store.patchIssue("dr-1", { logsAttached: false, attachments: [] });

    store.saveDraft({ ...base, title: "y" });

    const out = useIssuesStore.getState().issues[0];
    expect(out.title).toBe("y");
    expect(out.logsAttached).toBe(false);
    expect(out.attachments).toEqual([]);
  });

  it("record가 undefined로 명시한 필드는 비운다 (로그 첨부 해제)", () => {
    const store = useIssuesStore.getState();
    store.saveDraft({ ...base, networkLogBlobKey: "dr-1" });

    store.saveDraft({ ...base, networkLogBlobKey: undefined });

    expect(useIssuesStore.getState().issues[0].networkLogBlobKey).toBeUndefined();
  });

  it("apiHostsDerived를 저장·보존한다 (재제출 strip의 판정 재료)", () => {
    const store = useIssuesStore.getState();
    store.saveDraft({ ...base, apiHostsDerived: "api.acme.com" });

    expect(useIssuesStore.getState().issues[0].apiHostsDerived).toBe("api.acme.com");
  });

  // confirmDraft가 키를 조건부로 빼면 병합이 직전 세션 값을 되살린다 — editor-store.test.ts는
  // saveDraft가 mock이라 인자만 볼 수 있어 여기서만 검증 가능하다.
  it("같은 id 재확정 시 null을 명시하면 이전 파생값이 되살아나지 않는다", () => {
    const store = useIssuesStore.getState();
    store.saveDraft({ ...base, apiHostsDerived: "api.acme.com" });

    store.saveDraft({ ...base, apiHostsDerived: null });

    expect(useIssuesStore.getState().issues[0].apiHostsDerived).toBeNull();
  });

  it("createdAt은 최초 생성 시각을 유지하고 updatedAt만 갱신한다", () => {
    const store = useIssuesStore.getState();
    store.saveDraft({ ...base });
    const first = useIssuesStore.getState().issues[0];

    store.saveDraft({ ...base, createdAt: 999 });

    const out = useIssuesStore.getState().issues[0];
    expect(out.createdAt).toBe(10);
    expect(out.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
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

  it.each([null, {}, { issues: null }])("sparse·손상 state %j를 빈 목록으로 보정한다", async (persisted) => {
    const out = await migrateIssuesState(persisted, 0);

    expect(out.issues).toEqual([]);
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

// 참조 집합(= 저장된 이슈 목록) 계산이 실패했는데 그걸 "저장분 없음"으로 오독하면
// 살아있는 blob 전부가 orphan으로 판정돼 삭제된다 — POSTMORTEM 2026-07-23의 재발방지 (4)가
// "storage 조회 reject 시 삭제 0건 회귀 테스트를 반드시 둔다"고 적어둔 그물이다.
describe("pruneOrphanBlobs — rehydrate 실패 시 fail-closed", () => {
  const KEY = "bugshot-issues";
  let getItem: ReturnType<typeof vi.fn>;

  const allDeletes = () => [
    deleteVideoBlob,
    deleteImageBlobs,
    deleteNetworkLog,
    deleteConsoleLog,
    deleteActionLog,
    deleteAttachmentBlobs,
  ];

  // prune은 rehydrate 콜백에서 void로 띄워지므로 await 대상이 없다.
  // 매크로태스크 한 번이면 즉시 resolve하는 목들의 마이크로태스크 체인이 전부 소진된다.
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    vi.clearAllMocks();
    getItem = vi.fn();
    vi.stubGlobal("chrome", {
      storage: { local: { get: getItem, set: vi.fn(async () => {}), remove: vi.fn(async () => {}) } },
    });
    // 확장 기동 직후의 상태 — 메모리에는 아직 이슈가 없고 저장소에만 있다.
    useIssuesStore.setState({ issues: [] });
    vi.mocked(getVideoBlobKeys).mockResolvedValue(["issue-1"]);
    vi.mocked(getImageBlobKeys).mockResolvedValue(["issue-1:b0-before"]);
    vi.mocked(getNetworkLogKeys).mockResolvedValue(["issue-1"]);
    vi.mocked(getConsoleLogKeys).mockResolvedValue(["issue-1"]);
    vi.mocked(getActionLogKeys).mockResolvedValue(["issue-1"]);
    vi.mocked(getAttachmentBlobKeys).mockResolvedValue(["issue-1:a0"]);
  });

  afterEach(() => {
    // setState는 persist의 setItem을 태우므로 chrome 스텁이 살아있는 동안 되돌린다.
    useIssuesStore.setState({ issues: [] });
    vi.unstubAllGlobals();
  });

  it("에러가 있으면 prune 판정이 false, 없으면 true", () => {
    expect(shouldPruneAfterRehydrate(new Error("io"))).toBe(false);
    expect(shouldPruneAfterRehydrate(undefined)).toBe(true);
  });

  it("storage 조회가 reject하면 삭제가 0건 (전부 orphan 오판 금지)", async () => {
    getItem.mockRejectedValue(new Error("storage io"));

    await useIssuesStore.persist.rehydrate();
    await flush();

    for (const del of allDeletes()) expect(del).not.toHaveBeenCalled();
  });

  // video/network/console/action/attachment 루프엔 전부 있는 pending 가드가 image 루프에만
  // 없었다. "pending:5:before".split(":")[0] === "pending"이 currentIds에 있을 리 없으므로
  // 썸네일을 pending으로 미러링하는 순간 전 탭 pending 이미지가 일괄 삭제된다.
  it("pending: 키의 이미지는 고아 판정에서 제외한다", async () => {
    getItem.mockResolvedValue({
      [KEY]: JSON.stringify({ state: { issues: [{ id: "keep" }] }, version: 5 }),
    });
    vi.mocked(getImageBlobKeys).mockResolvedValue([
      "pending:5:before",
      "keep:before",
      "orphan:before",
    ]);

    await useIssuesStore.persist.rehydrate();
    await flush();

    expect(deleteImageBlobs).toHaveBeenCalledWith("orphan");
    expect(deleteImageBlobs).not.toHaveBeenCalledWith("pending");
    expect(deleteImageBlobs).not.toHaveBeenCalledWith("keep");
  });

  it("정상 rehydrate에서는 진짜 고아만 삭제한다 (과잉 스킵 방지)", async () => {
    getItem.mockResolvedValue({
      [KEY]: JSON.stringify({ state: { issues: [{ id: "keep" }] }, version: 5 }),
    });
    vi.mocked(getVideoBlobKeys).mockResolvedValue(["keep", "orphan"]);

    await useIssuesStore.persist.rehydrate();
    await flush();

    expect(deleteVideoBlob).toHaveBeenCalledWith("orphan");
    expect(deleteVideoBlob).not.toHaveBeenCalledWith("keep");
  });

  // 다른 인스턴스의 write로 촉발된 rehydrate에서 prune을 돌리면, 캡처를 막 끝내 blob을
  // issue id로 rekey했지만 레코드가 아직 storage에 안 들어간 인스턴스의 살아있는 blob이
  // 지워진다(pending 접두사 가드는 rekey 전까지만 보호). prune은 마운트 1회만.
  it("외부 write로 촉발된 rehydrate에서는 prune을 돌리지 않는다", async () => {
    getItem.mockResolvedValue({
      [KEY]: JSON.stringify({ state: { issues: [{ id: "keep" }] }, version: 5 }),
    });
    vi.mocked(getVideoBlobKeys).mockResolvedValue(["keep", "orphan"]);

    await rehydrateIssuesFromExternalWrite();
    await flush();

    expect(deleteVideoBlob).not.toHaveBeenCalled();
  });

  // 억제는 1회성이어야 한다 — 플래그가 켜진 채 남으면 다음 마운트의 prune이 영구 무력화돼
  // 고아 blob이 무기한 누적된다(용량 축).
  it("외부 rehydrate 이후의 마운트 rehydrate는 다시 prune한다", async () => {
    getItem.mockResolvedValue({
      [KEY]: JSON.stringify({ state: { issues: [{ id: "keep" }] }, version: 5 }),
    });
    vi.mocked(getVideoBlobKeys).mockResolvedValue(["keep", "orphan"]);

    await rehydrateIssuesFromExternalWrite();
    await flush();
    await useIssuesStore.persist.rehydrate();
    await flush();

    expect(deleteVideoBlob).toHaveBeenCalledWith("orphan");
  });
});

// #240: 사이드패널 인스턴스가 둘 이상이면 각자 마운트 시점 스냅샷을 계속 재직렬화해
// 마지막 write가 issues 배열을 통째로 덮었다 — 제출된 이슈가 Draft로 되돌아가고(중복 제출),
// 삭제된 이슈가 미디어 없이 되살아났다. persist merge가 그 병합 규칙의 단일 출처다.
describe("mergeIssueLists (크로스 인스턴스 병합 규칙)", () => {
  const rec = (patch: Partial<IssueRecord> & { id: string }): IssueRecord => ({
    status: "draft",
    platform: "jira",
    title: patch.id,
    createdAt: 0,
    updatedAt: 0,
    pageUrl: "https://example.com",
    draft: { title: "", sections: {} },
    snapshot: { before: false, after: false },
    ...patch,
  });

  // 역행은 단순 스냅샷 지연이 아니라 비용을 만든다 — Draft로 보이면 사용자가 다시 제출해
  // 목적지 플랫폼에 중복 티켓이 생긴다. 그래서 updatedAt보다 우선하는 규칙으로 둔다.
  it("submitted를 draft로 되돌리지 않는다 — updatedAt이 더 새로워도", () => {
    const persisted = [rec({ id: "a", status: "draft", updatedAt: 999 })];
    const current = [rec({ id: "a", status: "submitted", updatedAt: 100, key: "BUG-1" })];

    const out = mergeIssueLists(persisted, current);

    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("submitted");
    expect(out[0].key).toBe("BUG-1");
  });

  it("다른 인스턴스의 제출 결과를 받아들인다 (정방향)", () => {
    const persisted = [rec({ id: "a", status: "submitted", updatedAt: 200, key: "BUG-2", url: "https://x/2" })];
    const current = [rec({ id: "a", status: "draft", updatedAt: 100 })];

    const out = mergeIssueLists(persisted, current);

    expect(out[0].status).toBe("submitted");
    expect(out[0].key).toBe("BUG-2");
    expect(out[0].url).toBe("https://x/2");
  });

  // 존재 권위를 메모리에 주면 A가 삭제한 이슈가 B의 배열로 되살아난다 — removeIssue가 blob을
  // 즉시 지웠으므로 미디어 없는 좀비 레코드가 목록에 남는다.
  it("저장분에서 사라진 레코드는 드롭한다 (삭제 좀비 금지)", () => {
    const persisted = [rec({ id: "a" })];
    const current = [rec({ id: "a" }), rec({ id: "b" })];

    expect(mergeIssueLists(persisted, current).map((i) => i.id)).toEqual(["a"]);
  });

  it("저장분에만 있는 레코드를 받아들이고 저장분 순서를 따른다", () => {
    const persisted = [rec({ id: "b" }), rec({ id: "a" })];
    const current = [rec({ id: "a" })];

    expect(mergeIssueLists(persisted, current).map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("status가 같으면 updatedAt 최신이 이긴다 (양방향)", () => {
    const persisted = [
      rec({ id: "a", updatedAt: 100, title: "old-a" }),
      rec({ id: "b", updatedAt: 300, title: "new-b" }),
    ];
    const current = [
      rec({ id: "a", updatedAt: 200, title: "new-a" }),
      rec({ id: "b", updatedAt: 200, title: "old-b" }),
    ];

    const out = mergeIssueLists(persisted, current);

    expect(out.map((i) => i.title)).toEqual(["new-a", "new-b"]);
  });

  // 무변경 병합이 새 배열을 반환하면, 자기 write가 촉발한 onChanged마다 set(replace)로
  // 전 레코드 identity가 갈려 issue 구독 effect가 재실행되고 storage write가 한 번 더 돈다
  // (그 write가 다시 onChanged를 깨워 ping-pong). 참조 보존이 그 두 개를 동시에 막는다.
  it("변경이 없으면 현재 배열을 참조까지 그대로 반환한다 (에코·리렌더 방지)", () => {
    const current = [rec({ id: "a", updatedAt: 100 }), rec({ id: "b", updatedAt: 200 })];
    const persisted = JSON.parse(JSON.stringify(current)) as IssueRecord[];

    expect(mergeIssueLists(persisted, current)).toBe(current);
  });
});

describe("mergeIssuesState (persist merge 진입점)", () => {
  const state = (): IssuesState => useIssuesStore.getState();

  // zustand persist는 merge 결과를 set(state, true)로 **replace** 한다. issues만 담아
  // 돌려주면 액션 전체가 사라져 스토어가 죽는다.
  it("액션을 보존한다 (set replace=true 대응)", () => {
    const current = state();
    const out = mergeIssuesState({ issues: [{ id: "a" }] }, current);

    expect(typeof out.addIssue).toBe("function");
    expect(out.removeIssue).toBe(current.removeIssue);
    expect(out.issues.map((i) => i.id)).toEqual(["a"]);
  });

  // 최초 실행(저장분 없음)에도 merge는 호출된다 — persistedState가 undefined다.
  it("저장분이 없으면 현재 상태를 그대로 돌려준다", () => {
    const current = state();
    const out = mergeIssuesState(undefined, current);

    expect(out.issues).toBe(current.issues);
  });

  // 버전이 같으면 migrate가 돌지 않아 issues 비배열 오염이 merge까지 그대로 온다.
  // 그걸 []로 읽으면 메모리의 살아있는 초안이 통째로 날아간다(fail-closed).
  it("저장분의 issues가 배열이 아니면 현재 목록을 유지한다", () => {
    const current = state();
    const out = mergeIssuesState({ issues: "corrupt" }, current);

    expect(out.issues).toBe(current.issues);
  });
});

describe("shouldSyncIssuesChange (에코 가드)", () => {
  it("변경 없음·동일 값 에코는 무시한다", () => {
    expect(shouldSyncIssuesChange(undefined)).toBe(false);
    expect(shouldSyncIssuesChange({ oldValue: "x", newValue: "x" })).toBe(false);
  });

  it("값이 바뀌었거나 새로 생겼으면 동기화한다", () => {
    expect(shouldSyncIssuesChange({ oldValue: "x", newValue: "y" })).toBe(true);
    expect(shouldSyncIssuesChange({ newValue: "y" })).toBe(true);
  });
});

describe("shouldPruneAfterRehydrate — external 인자", () => {
  it("외부 write로 촉발된 rehydrate면 정상 응답에서도 prune하지 않는다", () => {
    expect(shouldPruneAfterRehydrate(undefined, true)).toBe(false);
    expect(shouldPruneAfterRehydrate(undefined, false)).toBe(true);
    expect(shouldPruneAfterRehydrate(new Error("io"), true)).toBe(false);
  });
});
