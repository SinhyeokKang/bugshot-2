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
  beginIssueSubmit,
  endIssueSubmit,
  mergeIssueLists,
  withIssueSubmitGuard,
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
    expect(shouldPruneAfterRehydrate(new Error("io"), false)).toBe(false);
    expect(shouldPruneAfterRehydrate(undefined, false)).toBe(true);
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
  // 전 레코드 identity가 갈려 issue 구독 effect가 재실행된다. (storage write는 안 늘어난다 —
  // zustand는 migrated일 때만 setItem을 태운다. 참조 보존이 막는 건 리렌더 쪽이다.)
  it("내용이 같고 순서만 다르면 새 배열이다 (위치도 상태다)", () => {
    const a = rec({ id: "a", updatedAt: 100 });
    const b = rec({ id: "b", updatedAt: 200 });
    const current = [a, b];
    const persisted = [
      JSON.parse(JSON.stringify(b)) as IssueRecord,
      JSON.parse(JSON.stringify(a)) as IssueRecord,
    ];

    const out = mergeIssueLists(persisted, current);

    expect(out).not.toBe(current);
    expect(out.map((i) => i.id)).toEqual(["b", "a"]);
  });

  // 존재 권위를 예외 없이 적용하면 다른 인스턴스가 지운 순간 이쪽 메모리에서도 사라지고,
  // 이어지는 markSubmitted가 무음 no-op이 된다 — 티켓은 생겼는데 로컬에 key/url이 없다.
  // 제출이 나가 있는 레코드는 저장분에서 사라져도 보전한다 — 안 그러면 응답이 돌아왔을 때
  // markSubmitted가 .map에 안 걸려 무음 no-op이 되고, 티켓은 목적지에 생겼는데 로컬엔
  // key/url이 없다. 편집 소유권(currentIssueId)이 아니라 **실제 in-flight 구간**이 기준이다
  // — 목록 상세창 제출은 currentIssueId를 안 쓰고, 소유권은 제출 후에도 안 풀린다.
  it("제출 중인 레코드는 저장분에 없어도 보전한다", () => {
    const persisted = [rec({ id: "a" })];
    const current = [rec({ id: "a" }), rec({ id: "sending" })];

    const out = mergeIssueLists(persisted, current, new Set(["sending"]));

    expect(out.map((i) => i.id)).toEqual(["a", "sending"]);
  });

  // Slack 보존 이슈의 트래커 승격은 이미 submitted인 레코드를 제출한다. status로 게이트하면
  // 그 경로가 보호 밖으로 샌다 — in-flight 구간은 status와 무관하게 보전한다.
  it("제출 중이면 submitted 레코드도 보전한다 (Slack 승격 경로)", () => {
    const persisted = [rec({ id: "a" })];
    const current = [rec({ id: "a" }), rec({ id: "promoting", status: "submitted" })];

    const out = mergeIssueLists(persisted, current, new Set(["promoting"]));

    expect(out.map((i) => i.id)).toEqual(["a", "promoting"]);
  });

  it("보전 대상이 저장분에도 있으면 중복 추가하지 않는다", () => {
    const persisted = [rec({ id: "sending", status: "submitted", updatedAt: 9 })];
    const current = [rec({ id: "sending", updatedAt: 1 })];

    const out = mergeIssueLists(persisted, current, new Set(["sending"]));

    expect(out.map((i) => i.id)).toEqual(["sending"]);
    expect(out[0].status).toBe("submitted");
  });

  // 보전은 제출 요청 구간으로 유한해야 한다 — 무기한이면 다른 창이 지운 레코드가 영영
  // 살아남아 blob 없는 좀비가 된다.
  it("제출 중이 아닌 레코드는 예외 없이 드롭한다", () => {
    const persisted = [rec({ id: "a" })];
    const current = [rec({ id: "a" }), rec({ id: "gone" })];

    expect(mergeIssueLists(persisted, current, new Set(["sending"])).map((i) => i.id))
      .toEqual(["a"]);
    expect(mergeIssueLists(persisted, current).map((i) => i.id)).toEqual(["a"]);
  });

  // 동률 = 무변경이 전제다(모든 뮤테이터가 updatedAt을 올린다). 저장분 채택으로 바꾸면
  // 한 write 뒤처진 저장분이 메모리의 최신 편집을 조용히 덮는 반대 방향이 열린다.
  it("동률이면 메모리를 유지한다", () => {
    const persisted = [rec({ id: "a", updatedAt: 5, title: "theirs" })];
    const current = [rec({ id: "a", updatedAt: 5, title: "mine" })];

    expect(mergeIssueLists(persisted, current)[0].title).toBe("mine");
  });

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
    // 앵커: 이 단언이 없으면 앞선 rehydrate 케이스가 스토어를 액션 없는 상태로 replace해둔
    // 경우 아래가 undefined === undefined로 통과한다 — 잡겠다던 실패 모드가 그물을 무력화한다.
    expect(typeof current.saveDraft).toBe("function");
    const out = mergeIssuesState({ issues: [{ id: "a" }] }, current);

    expect(out.saveDraft).toBe(current.saveDraft);
    expect(out.removeIssue).toBe(current.removeIssue);
    expect(out.issues.map((i) => i.id)).toEqual(["a"]);
  });

  // 최초 실행(저장분 없음)에도 merge는 호출된다 — persistedState가 undefined다.
  it("저장분이 없으면 현재 상태를 그대로 돌려준다", () => {
    const current = state();
    const out = mergeIssuesState(undefined, current);

    expect(out.issues).toBe(current.issues);
  });

  // 제출은 실패한다 — 네트워크·권한·업로드 어느 단계에서든 throw한다. 해제가 finally에
  // 없으면 그 레코드가 영구 보전되고, 다음 로컬 뮤테이션의 직렬화에 실려 저장분으로
  // 되돌아간다(blob 없이, 모든 인스턴스에).
  it("withIssueSubmitGuard는 run이 reject해도 보호를 해제한다", async () => {
    const current = {
      ...state(),
      issues: [{ id: "boom", status: "draft", updatedAt: 1 } as IssueRecord],
    };

    let protectedDuringRun: string[] = [];
    await expect(
      withIssueSubmitGuard("boom", async () => {
        protectedDuringRun = mergeIssuesState({ issues: [] }, current).issues.map((i) => i.id);
        throw new Error("submit failed");
      }),
    ).rejects.toThrow("submit failed");

    expect(protectedDuringRun).toEqual(["boom"]);
    expect(mergeIssuesState({ issues: [] }, current).issues).toEqual([]);
  });

  it("withIssueSubmitGuard는 id가 없으면 그대로 실행한다", async () => {
    await expect(withIssueSubmitGuard(null, async () => "ok")).resolves.toBe("ok");
  });

  // 보전 축이 persist 경로에 실제로 배선됐는지 — mergeIssueLists 인자만 테스트하면
  // mergeIssuesState가 in-flight 집합을 안 넘겨도 green이다.
  it("in-flight 제출 집합을 보전 대상으로 넘긴다", () => {
    const current = {
      ...state(),
      issues: [{ id: "sending", status: "draft", updatedAt: 1 } as IssueRecord],
    };
    beginIssueSubmit("sending");
    try {
      expect(mergeIssuesState({ issues: [] }, current).issues.map((i) => i.id))
        .toEqual(["sending"]);
    } finally {
      endIssueSubmit("sending");
    }
    expect(mergeIssuesState({ issues: [] }, current).issues).toEqual([]);
  });

  // 버전이 같으면 migrate가 돌지 않아 issues 비배열 오염이 merge까지 그대로 온다.
  // 그걸 []로 읽으면 메모리의 살아있는 초안이 통째로 날아간다(fail-closed).
  it("저장분의 issues가 배열이 아니면 현재 목록을 유지한다", () => {
    const current = state();
    const out = mergeIssuesState({ issues: "corrupt" }, current);

    expect(out.issues).toBe(current.issues);
  });
});

describe("shouldSyncIssuesChange (에코 가드 + 자기 write 소비)", () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async (items: Record<string, string>) => {
            for (const v of Object.values(items)) written.push(v);
          }),
          remove: vi.fn(async () => {}),
        },
      },
    });
  });

  afterEach(() => {
    useIssuesStore.setState({ issues: [] });
    vi.unstubAllGlobals();
  });

  // persist가 실제로 쓴 문자열을 얻는다 — 손으로 만든 리터럴은 어댑터 배선을 안 태운다.
  const writeOnce = async (id: string): Promise<string> => {
    useIssuesStore.setState({ issues: [{ id } as IssueRecord] });
    await Promise.resolve();
    return written[written.length - 1];
  };

  it("변경 없음·동일 값 에코는 무시한다", () => {
    expect(shouldSyncIssuesChange(undefined)).toBe(false);
    expect(shouldSyncIssuesChange({ oldValue: "x", newValue: "x" })).toBe(false);
  });

  it("값이 바뀌었거나 새로 생겼으면 동기화한다", () => {
    expect(shouldSyncIssuesChange({ oldValue: "x", newValue: "y" })).toBe(true);
    expect(shouldSyncIssuesChange({ newValue: "y" })).toBe(true);
  });

  // 모든 뮤테이터가 updatedAt을 올리므로 값 비교로는 자기 write가 안 걸러진다.
  it("자기가 방금 쓴 값이면 무시한다", async () => {
    const mine = await writeOnce("a");
    expect(shouldSyncIssuesChange({ oldValue: "old", newValue: mine })).toBe(false);
  });

  // 토큰이 1회용이어야 한다. "마지막으로 쓴 값"으로 남겨두면, 다른 인스턴스가 우연히 같은
  // 상태로 되돌리는 write(추가했다 삭제)가 영구히 자기 write로 오판돼 그 변경을 영영 못 받는다.
  it("같은 값이 다시 와도 두 번째는 남의 write로 본다", async () => {
    const mine = await writeOnce("a");
    expect(shouldSyncIssuesChange({ oldValue: "old", newValue: mine })).toBe(false);
    expect(shouldSyncIssuesChange({ oldValue: "other", newValue: mine })).toBe(true);
  });

  // write는 버스트로 나가고 onChanged는 그보다 늦게 도착한다. 토큰을 하나만 들고 있으면
  // 버스트 N건 중 N-1건이 남의 write로 오판돼 그만큼 전량 rehydrate가 돈다.
  it("버스트로 쓴 값들을 전부 자기 write로 본다", async () => {
    const first = await writeOnce("a");
    const second = await writeOnce("b");
    expect(first).not.toBe(second);

    expect(shouldSyncIssuesChange({ oldValue: "old", newValue: first })).toBe(false);
    expect(shouldSyncIssuesChange({ oldValue: first, newValue: second })).toBe(false);
  });

  it("자기 write와 다른 값은 토큰을 소비하지 않는다", async () => {
    const mine = await writeOnce("a");
    expect(shouldSyncIssuesChange({ oldValue: mine, newValue: "theirs" })).toBe(true);
    expect(shouldSyncIssuesChange({ oldValue: "old", newValue: mine })).toBe(false);
  });
});

describe("shouldPruneAfterRehydrate — external 인자", () => {
  it("외부 write로 촉발된 rehydrate면 정상 응답에서도 prune하지 않는다", () => {
    expect(shouldPruneAfterRehydrate(undefined, true)).toBe(false);
    expect(shouldPruneAfterRehydrate(undefined, false)).toBe(true);
    expect(shouldPruneAfterRehydrate(new Error("io"), true)).toBe(false);
  });
});

// merge 규칙을 함수로만 테스트하면 persist 옵션에 배선하는 줄을 지워도 전부 green이다
// (POSTMORTEM: migrate 콜백이 never-called여도 단계 테스트는 통과했다와 같은 축).
describe("persist 옵션 배선", () => {
  it("merge 옵션이 mergeIssuesState다", () => {
    expect(useIssuesStore.persist.getOptions().merge).toBe(mergeIssuesState);
  });

  it("배선된 merge가 역행 금지 규칙을 태운다", () => {
    const merge = useIssuesStore.persist.getOptions().merge!;
    const current = {
      ...useIssuesStore.getState(),
      issues: [
        {
          id: "a",
          status: "submitted",
          updatedAt: 1,
          key: "BUG-9",
        } as unknown as IssueRecord,
      ],
    };

    const out = merge({ issues: [{ id: "a", status: "draft", updatedAt: 99 }] }, current);

    expect((out as IssuesState).issues[0].status).toBe("submitted");
  });
});

// mergeIssuesState는 저장분의 issues만 취한다. IssuesState에 영속 필드가 추가되면 migrate는
// 돌지만 값은 하이드레이트에서 조용히 버려지고 메모리 기본값이 남는다 — 타입도 런타임도
// 안 잡으므로 필드 축을 소스에서 센다.
describe("영속 필드는 issues 단독", () => {
  it("IssuesState의 비-액션 필드가 늘면 red (mergeIssuesState에 명시해야 한다)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../issues-store.ts", import.meta.url),
      "utf8",
    );
    const body = /export interface IssuesState \{([\s\S]*?)\n\}/.exec(src)?.[1];
    expect(body).toBeTruthy();
    // 액션은 값이 `(`로 시작한다(여러 줄에 걸친 시그니처도 첫 줄이 `(`로 끝난다).
    const fields = body!
      .split("\n")
      .map((line) => /^ {2}(?:readonly )?(\w+)\??: (?!\()/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]);

    expect(fields).toEqual(["issues"]);
  });
});

describe("patch* 액션의 updatedAt", () => {
  const base = (): IssueRecord => ({
    id: "p1",
    status: "draft",
    platform: "jira",
    title: "t",
    createdAt: 1,
    updatedAt: 1,
    pageUrl: "https://example.com",
    draft: { title: "", sections: {} },
    snapshot: { before: false, after: false },
    bufferedElements: [
      {
        selector: "div",
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
        hasBefore: false,
        hasAfter: false,
      },
    ],
  });

  const at = () => useIssuesStore.getState().issues[0].updatedAt;

  // 액션이 persist setItem을 태우므로 스텁이 없으면 chrome is not defined 스택이 출력에 쌓인다.
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      },
    });
  });

  afterEach(() => {
    useIssuesStore.setState({ issues: [] });
    vi.unstubAllGlobals();
  });

  // updatedAt을 안 올리면 다른 인스턴스와 동률이 되어 이 변경이 병합에서 무음으로 버려진다.
  // logsAttached·platform·attachments는 사용자 데이터고, snapshot·buffered 플래그는
  // 레코드↔blob 정합 보정이라 유실되면 없는 blob을 참조하는 레코드가 남는다.
  it("patchIssue가 updatedAt을 올린다 (사용자 데이터 보전)", () => {
    useIssuesStore.setState({ issues: [base()] });
    useIssuesStore.getState().patchIssue("p1", { logsAttached: false });
    expect(at()).toBeGreaterThan(1);
  });

  it("patchDraftSnapshot이 updatedAt을 올린다", () => {
    useIssuesStore.setState({ issues: [base()] });
    useIssuesStore.getState().patchDraftSnapshot("p1", { before: true });
    expect(at()).toBeGreaterThan(1);
  });

  it("patchDraftBufferedImageFlags가 updatedAt을 올린다", () => {
    useIssuesStore.setState({ issues: [base()] });
    useIssuesStore.getState().patchDraftBufferedImageFlags("p1", 0, { hasBefore: true });
    expect(at()).toBeGreaterThan(1);
  });
});

// pickIssue의 "동률은 메모리 유지"는 **동률 = 무변경**을 전제한다. 레코드를 바꾸면서
// updatedAt을 안 올리는 뮤테이터가 하나라도 생기면 그 변경만 크로스 인스턴스에서 무음으로
// 사라진다 — 타입도 런타임도 안 잡으므로 소스에서 센다(현재 예외 0건이라 래칫으로 건다).
describe("레코드를 바꾸는 액션은 updatedAt을 올린다", () => {
  it("issues.map 뮤테이터 전수에 updatedAt이 있다", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../issues-store.ts", import.meta.url),
      "utf8",
    );
    // 콜백 인자명에 고정하지 않는다 — set((state) => ...) 로 쓴 신규 뮤테이터가 새면
    // 래칫이 아니라 장부가 된다.
    const blocks = src.split(/issues:\s*\w+\.issues\.map\(/).slice(1);
    expect(blocks.length).toBeGreaterThan(0);

    const missing = blocks.filter((block) => {
      // 다음 액션 정의 전까지를 그 뮤테이터의 본문으로 본다.
      const body = block.split(/\n {6}\w+: \(/)[0];
      return !/updatedAt/.test(body) && !/stripSubmitted/.test(body);
    });

    expect(missing).toEqual([]);
  });
});

// 역행 금지가 읽기(merge) 측에만 있으면 쓰기가 그걸 우회한다. A가 previewing 중 B가 같은
// 이슈를 제출하면 A는 submitted를 정상 반영하지만 editor는 previewing 그대로고, backToDraft
// 후 재확정하면 confirmDraft의 baseDraftRecord가 status: "draft"를 실어 submitted를 덮는다
// (레이스도 콜드스타트도 필요 없다). 정상 흐름은 기존 레코드가 draft라 이 가드에 안 걸린다.
describe("saveDraft — submitted 역행 금지 (쓰기 측)", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      },
    });
  });

  afterEach(() => {
    useIssuesStore.setState({ issues: [] });
    vi.unstubAllGlobals();
  });

  const submitted = (): IssueRecord => ({
    id: "s1",
    status: "submitted",
    platform: "jira",
    title: "t",
    createdAt: 1,
    updatedAt: 1,
    pageUrl: "https://example.com",
    draft: { title: "", sections: {} },
    snapshot: { before: false, after: false },
    key: "BUG-1",
    url: "https://jira/BUG-1",
  });

  it("기존 레코드가 submitted면 draft로 되돌리지 않는다", () => {
    useIssuesStore.setState({ issues: [submitted()] });
    useIssuesStore.getState().saveDraft({
      ...submitted(),
      status: "draft",
      title: "edited",
    });

    const out = useIssuesStore.getState().issues[0];
    expect(out.status).toBe("submitted");
    expect(out.key).toBe("BUG-1");
  });

  // status만 고정하고 나머지를 병합하면 하이브리드가 된다 — platform이 이쪽 targetPlatform으로
  // 갈려 배지가 다른 트래커를 조회하고, stripSubmitted가 지운 apiHostsDerived·로그 blob 키가
  // 부활하며, updatedAt이 최신이라 그 오염이 다음 merge에서 이겨 storage로 나간다.
  it("쓰기 자체를 건너뛴다 (하이브리드 레코드를 만들지 않는다)", () => {
    useIssuesStore.setState({ issues: [submitted()] });
    useIssuesStore.getState().saveDraft({
      ...submitted(),
      status: "draft",
      title: "edited",
      platform: "github",
      apiHostsDerived: "internal-admin.acme.com",
    });

    const out = useIssuesStore.getState().issues[0];
    expect(out.title).toBe("t");
    expect(out.platform).toBe("jira");
    expect(out.apiHostsDerived).toBeUndefined();
  });

  it("기존이 draft면 그대로 draft다 (정상 재확정 무영향)", () => {
    useIssuesStore.setState({ issues: [{ ...submitted(), status: "draft", key: undefined }] });
    useIssuesStore.getState().saveDraft({ ...submitted(), status: "draft" });

    expect(useIssuesStore.getState().issues[0].status).toBe("draft");
  });
});

// in-flight 보전은 제출 관문이 등록해야만 동작한다. 관문은 지금 둘(IssueCreateModal·
// DraftDetailDialog의 handleSubmit)이고 각각 플랫폼 9분기를 감싼다 — 분기 18곳을 열거하면
// 다음 플랫폼이 목록 밖에서 새므로, "markSubmitted를 부르는 파일은 보호도 건다"는 불변식으로
// 센다. 셋째 제출 경로가 생기면 보호 없이는 red다.
//
// 주석은 코드가 아니다 — 삭제 뮤테이션은 흔히 주석 처리다(pageUrl-callsites.test.ts가 같은
// 이유로 codeOnly를 쓴다). 스코프도 디렉터리 하나가 아니라 sidepanel 전체를 재귀로 훑는다:
// tabs/statusBadges/가 이미 서브디렉터리이고, 관문이 components/로 옮겨가도 걸려야 한다.
describe("제출 경로의 in-flight 보호", () => {
  const load = async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const walk = (dir: URL): URL[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name === "__tests__") return [];
        const child = new URL(e.isDirectory() ? `${e.name}/` : e.name, dir);
        if (e.isDirectory()) return walk(child);
        return /\.tsx?$/.test(e.name) ? [child] : [];
      });
    const codeOnly = (f: URL) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, ""))
        .join("\n");
    const files = walk(new URL("../../sidepanel/", import.meta.url));
    return files.map((f) => ({ path: f.pathname, code: codeOnly(f) }));
  };

  it("스캔 대상이 비어 있지 않다", async () => {
    const files = await load();
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => /\bmarkSubmitted\(/.test(f.code))).toBe(true);
  });

  it("markSubmitted/markSlackShared를 부르는 파일은 withIssueSubmitGuard로 감싼다", async () => {
    const files = await load();
    const offenders = files
      .filter((f) => /\b(markSubmitted|markSlackShared)\(/.test(f.code))
      .filter((f) => !/\bwithIssueSubmitGuard\(/.test(f.code))
      .map((f) => f.path);

    expect(offenders).toEqual([]);
  });

  // 해제를 호출부에 맡기면 빠뜨릴 수 있고, 빠뜨린 보전은 무기한이 되어 그 레코드가 다음
  // 로컬 뮤테이션의 직렬화에 실려 저장분으로 되돌아간다(blob 없이, 모든 인스턴스에).
  it("관문이 begin/end를 직접 부르지 않는다 (해제를 못 빠뜨리게)", async () => {
    const files = await load();
    const offenders = files
      .filter((f) => /\b(beginIssueSubmit|endIssueSubmit)\(/.test(f.code))
      .map((f) => f.path);

    expect(offenders).toEqual([]);
  });
});
