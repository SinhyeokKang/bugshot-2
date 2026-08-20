import type { UploadFileResult } from "@/types/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

// url이 채워지면 다른 본문을 반환 → 2차 갱신(updateTaskMarkdown) 트리거 검증용.
const buildBody = vi.fn(
  (input: { images?: Array<{ url?: string }>; cc?: string[] }) => ({
    body: input.images?.[0]?.url ? "WITH_URL" : "NO_URL",
    attached: [],
  }),
);
vi.mock("../buildClickupIssueBody", () => ({
  buildClickupIssueBody: (...a: unknown[]) => buildBody(...(a as [never])),
}));
const replaceInlineRefs = vi.fn((s: string, _map?: Map<string, string>) => s);
vi.mock("../resolveInlineImages", () => ({
  replaceInlineRefs: (s: string, map: Map<string, string>) => replaceInlineRefs(s, map),
}));
const injectIssueUrl = vi.fn();
vi.mock("@/lib/inject-issue-url", () => ({
  injectIssueUrl: (...a: unknown[]) => injectIssueUrl(...a),
}));

import { submitToClickup } from "../submitToClickup";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(): MarkdownContext {
  return {
    bodyLocale: "ko",
    captureMode: "screenshot",
    title: "Test",
    sections: { description: "본문" },
    sectionConfig: [
      { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
    ],
    url: "https://example.com",
    selector: "div",
    tagName: "div",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    tokens: [],
    viewport: { width: 1024, height: 768 },
    capturedAt: 1700000000000,
    diffs: [],
    environment: [],
  };
}

const TASK = { id: "t1", url: "https://app.clickup.com/t/t1" };

beforeEach(() => {
  sendBg.mockReset();
  injectIssueUrl.mockReset();
  buildBody.mockClear();
  replaceInlineRefs.mockClear();
});

describe("submitToClickup CC 멘션", () => {
  it("CC는 본문 빌더에 id가 아닌 이름으로 넘어간다 (name 없으면 id 폴백)", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) =>
      msg.type === "clickup.submitIssue" ? TASK : undefined,
    );

    await submitToClickup({
      ctx: makeCtx(),
      listId: "l1",
      cc: [{ id: "1", name: "Alice" }, { id: "2" }],
    });

    expect(buildBody.mock.calls[0][0]).toMatchObject({ cc: ["Alice", "2"] });
  });
});

describe("submitToClickup 제출 순서", () => {
  it("create(submitIssue) → upload → updateTaskMarkdown 순서로 호출", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "clickup.submitIssue") return TASK;
      if (msg.type === "clickup.uploadFile")
        return [{ ok: true, filename: "screenshot.png", href: "https://att/screenshot.png" }];
      return undefined;
    });

    const res = await submitToClickup({
      ctx: makeCtx(),
      images: [{ filename: "screenshot.png", dataUrl: "data:IMG" }],
      listId: "l1",
    });

    const types = sendBg.mock.calls.map(([m]) => m.type);
    expect(types).toEqual([
      "clickup.submitIssue",
      "clickup.uploadFile",
      "clickup.updateTaskMarkdown",
    ]);

    // create는 url 없는 본문, update는 url 채워진 본문.
    const create = sendBg.mock.calls.find(([m]) => m.type === "clickup.submitIssue")![0];
    expect(create.payload.markdownContent).toBe("NO_URL");
    expect(create.payload.listId).toBe("l1");
    const update = sendBg.mock.calls.find(([m]) => m.type === "clickup.updateTaskMarkdown")![0];
    expect(update.markdownContent).toBe("WITH_URL");

    expect(res).toEqual({ key: "t1", url: TASK.url, logsDropped: false });
  });

  it("첨부가 없으면 업로드·2차 갱신을 건너뛴다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "clickup.submitIssue") return TASK;
      return undefined;
    });

    await submitToClickup({ ctx: makeCtx(), listId: "l1" });

    expect(sendBg.mock.calls.map(([m]) => m.type)).toEqual(["clickup.submitIssue"]);
  });
});

describe("submitToClickup logsDropped", () => {
  it("logs.html 업로드가 null이면 logsDropped: true", async () => {
    injectIssueUrl.mockResolvedValue("data:aug");
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "clickup.submitIssue") return TASK;
      if (msg.type === "clickup.uploadFile")
        return [{ ok: false, filename: "logs.html" }];
      return undefined;
    });

    const res = await submitToClickup({
      ctx: makeCtx(),
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
      listId: "l1",
    });

    expect(res.logsDropped).toBe(true);
  });
});

// bespoke 업로드 경로를 가진 어댑터(notion/slack/linear/clickup) 중 clickup이 미커버였다.
describe("submitToClickup — 인라인 이미지", () => {
  const TASK = { id: "T1", url: "https://app.clickup.com/t/T1" };

  function mockUpload(results: UploadFileResult[]) {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "clickup.submitIssue") return TASK;
      if (msg.type === "clickup.uploadFile") return results;
      return undefined;
    });
  }

  it("inline-{refId}.webp 이름으로 업로드 목록에 넣는다", async () => {
    mockUpload([{ ok: true, filename: "inline-r1.webp", href: "https://att/r1.webp" }]);
    await submitToClickup({
      ctx: makeCtx(),
      listId: "L",
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);
    const upload = sendBg.mock.calls.find((c) => c[0].type === "clickup.uploadFile")![0];
    expect(upload.files.map((f: { filename: string }) => f.filename)).toContain("inline-r1.webp");
  });

  it("업로드 URL로 본문의 ref를 치환한다", async () => {
    mockUpload([{ ok: true, filename: "inline-r1.webp", href: "https://att/r1.webp" }]);
    await submitToClickup({
      ctx: makeCtx(),
      listId: "L",
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);
    const map = replaceInlineRefs.mock.calls[0][1]!;
    expect(map.get("r1")).toBe("https://att/r1.webp");
  });

  // url이 null이면 치환할 게 없다 — 깨진 ref로 본문을 갱신하지 않는다.
  it("업로드 url이 null이면 치환하지 않는다", async () => {
    mockUpload([{ ok: false, filename: "inline-r1.webp" }]);
    await submitToClickup({
      ctx: makeCtx(),
      listId: "L",
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);
    expect(replaceInlineRefs).not.toHaveBeenCalled();
  });
});

describe("submitToClickup 업로드 판별자", () => {
  it("판별자 형태에서 성공분은 첨부되고 실패분만 실패로 판정된다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "clickup.submitIssue") return TASK;
      if (msg.type === "clickup.uploadFile")
        return [
          { ok: true, filename: "logs.html", href: "LOGS_HREF" },
          { ok: false, filename: "screenshot.png" },
        ];
      return undefined;
    });

    const res = await submitToClickup({
      ctx: makeCtx(),
      listId: "l1",
      images: [{ filename: "screenshot.png", dataUrl: "data:IMG" }],
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(res.logsDropped).toBe(false);
    // 값 축 — 성공분 href가 본문 조립까지 도달하고 실패분은 url 없이 넘어간다.
    const arg = buildBody.mock.calls.at(-1)?.[0] as {
      logs?: Array<{ filename: string; url?: string | null }>;
      images?: Array<{ filename: string; url?: string | null }>;
    };
    expect(arg.logs?.[0]).toMatchObject({ filename: "logs.html", url: "LOGS_HREF" });
    expect(arg.images?.[0]?.url).toBeFalsy();
  });
});


// ── 2차 본문 갱신 실패 시 graceful degradation — 전수 표 (clickup 행) ─────────────
// 이슈/태스크를 만든 **뒤** 본문을 다시 쓰는 2차 write 경로를 가진 플랫폼은 실측 5개다.
// 관용구가 3갈림이라 한 파일에서 순회할 수 없어(각 어댑터의 모듈 목이 파일 스코프다)
// 같은 계약을 파일별 "행"으로 나눠 잠근다 — `grep -rn "전수 표"` 로 행이 모인다.
//   clickup  submitToClickup.ts:132-140   try {} catch {}
//   asana    submitToAsana.ts:215-225     try {} catch {}
//   linear   submitToLinear.ts:140-144    .catch(() => null)
//   gitlab   submitToGitlab.ts:76-97      보강 블록 전체를 감싼 try {} catch {}
//   jira     background/messages.ts:850-868  try {} catch {} (b4b98df9 이래 — 사이드패널이
//            아니라 background 안이라 행이 이 디렉터리에 없다. 그 행은
//            `src/background/__tests__/jiraSubmitIssue.test.ts`에 있다.)
// notion·github·slack은 2차 write 자체가 없어 대상이 아니다(notion submitToNotion.ts:123의
// catch는 *업로드* 격리이고 image/video는 의도적으로 strict — 다른 계약이라 섞지 않는다).
//
// 각 행이 잠그는 계약 3개:
//   ① 2차 갱신이 reject해도 제출이 reject되지 않는다
//   ② 반환값(key·url·logsDropped)이 완전 성공 경로와 동일하다
//   ③ 1차 생성과 첨부 업로드는 그대로 남는다(첨부 보존)
//
// **정직성은 이 표의 범위가 아니다.** clickup의 bare `catch {}`는 rethrow·플래그·로그가 없어
// 반환값이 완전 성공과 구분되지 않고, 사용자는 초록 체크만 본다. 그때 본문에 없는 것:
// 스크린샷 임베드 · As-is/To-be 스냅샷 행 · 영상 링크 · logs.html 하이퍼링크, 그리고
// 미해석 `inline:xxxx` 플레이스홀더가 그대로 보인다(파일은 첨부로 남으니 손실은 아니다).
// v1.7.27이 고친 게 정확히 이 계열이므로 나중에 경고 토스트/플래그를 붙일 수 있는데,
// 그 변경은 이 표를 red로 만들면 안 된다 — ②는 "성공으로 끝난다"를 잠그는 것이고
// "실패를 사용자에게 알리지 않는다"를 잠그는 게 아니다. 별개 이슈로 다룬다.
describe("submitToClickup — 2차 본문 갱신 실패 (전수 표 clickup 행)", () => {
  it("updateTaskMarkdown이 reject해도 제출은 성공하고 task·첨부가 보존된다", async () => {
    injectIssueUrl.mockResolvedValue("data:LOGS+url");
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "clickup.submitIssue") return TASK;
      if (msg.type === "clickup.uploadFile")
        return [
          { ok: true, filename: "screenshot.png", href: "https://att/screenshot.png" },
          { ok: true, filename: "logs.html", href: "https://att/logs.html" },
        ];
      if (msg.type === "clickup.updateTaskMarkdown") throw new Error("PUT 500");
      return undefined;
    });

    const res = await submitToClickup({
      ctx: makeCtx(),
      listId: "l1",
      images: [{ filename: "screenshot.png", dataUrl: "data:IMG" }],
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    // ①② 완전 성공 경로와 동일한 반환값 — 여기가 위 "정직성" 주석이 가리키는 지점이다.
    expect(res).toEqual({ key: "t1", url: TASK.url, logsDropped: false });
    // ③ 생성·업로드는 그대로, 2차 갱신을 시도했다는 사실까지 고정.
    expect(sendBg.mock.calls.map(([m]) => m.type)).toEqual([
      "clickup.submitIssue",
      "clickup.uploadFile",
      "clickup.updateTaskMarkdown",
    ]);
    const upload = sendBg.mock.calls.find(([m]) => m.type === "clickup.uploadFile")![0];
    expect(upload.files.map((f: { filename: string }) => f.filename)).toEqual([
      "screenshot.png",
      "logs.html",
    ]);
  });
});
