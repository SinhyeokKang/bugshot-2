import { describe, it, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (params) {
      let s = key;
      for (const [k, v] of Object.entries(params)) s += ` ${k}=${v}`;
      return s;
    }
    return key;
  },
  dateBcp47: () => "en-US",
}));

import {
  prepareUpload,
  toInlineUploadFiles,
  type PrepareUploadInput,
  type UploadFn,
} from "../prepareUpload";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
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
    ...overrides,
  };
}

// href를 filename 기반으로 돌려주는 업로더 스텁. null 지정으로 업로드 실패 재현.
function makeUploadFn(failFor: string[] = []): UploadFn & ReturnType<typeof vi.fn> {
  return vi.fn(async (files: Array<{ filename: string; contentType: string; dataUrl: string }>) =>
    files.map((f) => ({
      filename: f.filename,
      href: failFor.includes(f.filename) ? null : `https://up/${f.filename}`,
    })),
  );
}

function baseInput(overrides: Partial<PrepareUploadInput> = {}): PrepareUploadInput {
  return {
    ctx: makeCtx(),
    images: [{ filename: "shot.webp", dataUrl: "data:image/webp;base64,AA" }],
    video: { filename: "recording.webm", dataUrl: "data:video/webm;base64,BB" },
    logs: [{ filename: "logs.html", dataUrl: "data:text/html;base64,CC" }],
    inlineImages: [{ refId: "ref1", dataUrl: "data:image/webp;base64,DD" }],
    attachments: [
      { filename: "att-1.png", dataUrl: "data:image/png;base64,EE", displayName: "원본.png" },
    ],
    ...overrides,
  };
}

describe("prepareUpload — 파일 수집·업로드", () => {
  it("images → video → logs → inline → attachments 순서로 uploadFn에 전달", async () => {
    const uploadFn = makeUploadFn();
    await prepareUpload(baseInput(), uploadFn, { platform: "github" });

    expect(uploadFn).toHaveBeenCalledTimes(1);
    const sent = uploadFn.mock.calls[0][0] as Array<{ filename: string; dataUrl: string }>;
    expect(sent.map((f) => f.filename)).toEqual([
      "shot.webp",
      "recording.webm",
      "logs.html",
      "inline-ref1.webp",
      "att-1.png",
    ]);
    expect(sent[0].dataUrl).toBe("data:image/webp;base64,AA");
  });

  it("toMedia: 업로드 href를 url로 매핑, 누락(null)은 undefined", async () => {
    const out = await prepareUpload(baseInput(), makeUploadFn(["logs.html"]), {
      platform: "github",
    });
    expect(out.toMedia({ filename: "shot.webp", dataUrl: "x" }).url).toBe(
      "https://up/shot.webp",
    );
    expect(out.toMedia({ filename: "logs.html", dataUrl: "x" }).url).toBeUndefined();
  });

  it("toAttachmentMedia: 본문 표시명은 displayName, url 매칭은 업로드 filename", async () => {
    const out = await prepareUpload(baseInput(), makeUploadFn(), { platform: "github" });
    const media = out.toAttachmentMedia({
      filename: "att-1.png",
      dataUrl: "x",
      displayName: "원본.png",
    });
    expect(media.filename).toBe("원본.png");
    expect(media.url).toBe("https://up/att-1.png");
  });
});

describe("prepareUpload — inline ref 해소", () => {
  it("sections의 inline:refId가 업로드 href로 치환된 resolvedCtx 반환", async () => {
    const input = baseInput({
      ctx: makeCtx({ sections: { description: "설명 ![img](inline:ref1)" } }),
    });
    const out = await prepareUpload(input, makeUploadFn(), { platform: "github" });
    expect(out.resolvedCtx.sections.description).toBe(
      "설명 ![img](https://up/inline-ref1.webp)",
    );
  });

  it("inline 업로드 실패 시 해당 ref는 원본 유지", async () => {
    const input = baseInput({
      ctx: makeCtx({ sections: { description: "설명 ![img](inline:ref1)" } }),
    });
    const out = await prepareUpload(input, makeUploadFn(["inline-ref1.webp"]), {
      platform: "github",
    });
    expect(out.resolvedCtx.sections.description).toBe("설명 ![img](inline:ref1)");
  });
});

describe("prepareUpload — logsDropped / requireMediaUpload", () => {
  it("logs 업로드 실패 시 logsDropped=true, 성공 시 false", async () => {
    const dropped = await prepareUpload(baseInput(), makeUploadFn(["logs.html"]), {
      platform: "github",
    });
    expect(dropped.responses.find((r) => r.filename === "logs.html")?.ok).toBe(false);

    const ok = await prepareUpload(baseInput(), makeUploadFn(), { platform: "github" });
    expect(ok.responses.find((r) => r.filename === "logs.html")?.ok).toBe(true);
  });

  // 캡처 이미지·영상은 url 없이도 본문의 미첨부 목록(extras→notInlined)에 이름이 남지만,
  // **인라인 이미지는 그 목록에 들어가지 않는다** — 치환만 건너뛰어 `![](inline:ref)` 원문이
  // 남을 뿐이라 제출자도 독자도 알 길이 없다. 그래서 이 축은 신호가 필요하다.
  it("캡처 이미지 업로드 실패 시 mediaDropped=true", async () => {
    const out = await prepareUpload(baseInput(), makeUploadFn(["shot.webp"]), {
      platform: "github",
    });
    expect(out.responses.filter((r) => ["shot.webp", "recording.webm", "inline-ref1.webp"].includes(r.filename ?? "")).some((r) => !r.ok)).toBe(true);
  });

  it("영상 업로드 실패 시 mediaDropped=true", async () => {
    const out = await prepareUpload(baseInput(), makeUploadFn(["recording.webm"]), {
      platform: "github",
    });
    expect(out.responses.filter((r) => ["shot.webp", "recording.webm", "inline-ref1.webp"].includes(r.filename ?? "")).some((r) => !r.ok)).toBe(true);
  });

  it("인라인 이미지 업로드 실패 시 mediaDropped=true", async () => {
    const out = await prepareUpload(baseInput(), makeUploadFn(["inline-ref1.webp"]), {
      platform: "github",
    });
    expect(out.responses.filter((r) => ["shot.webp", "recording.webm", "inline-ref1.webp"].includes(r.filename ?? "")).some((r) => !r.ok)).toBe(true);
  });

  it("logs.html만 실패하면 mediaDropped는 false로 남는다 — 두 신호는 별개 축이다", async () => {
    const out = await prepareUpload(baseInput(), makeUploadFn(["logs.html"]), {
      platform: "github",
    });
    expect(out.responses.filter((r) => ["shot.webp", "recording.webm", "inline-ref1.webp"].includes(r.filename ?? "")).some((r) => !r.ok)).toBe(false);
    expect(out.responses.find((r) => r.filename === "logs.html")?.ok).toBe(false);
  });

  it("사용자 첨부만 실패하면 mediaDropped를 켜지 않는다 — 본문 인라인 대상이 아니다", async () => {
    const out = await prepareUpload(baseInput(), makeUploadFn(["att-1.png"]), {
      platform: "github",
    });
    expect(out.responses.filter((r) => ["shot.webp", "recording.webm", "inline-ref1.webp"].includes(r.filename ?? "")).some((r) => !r.ok)).toBe(false);
  });

  it("전부 성공하면 두 신호 모두 false", async () => {
    const out = await prepareUpload(baseInput(), makeUploadFn(), { platform: "github" });
    expect(out.responses.filter((r) => ["shot.webp", "recording.webm", "inline-ref1.webp"].includes(r.filename ?? "")).some((r) => !r.ok)).toBe(false);
    expect(out.responses.find((r) => r.filename === "logs.html")?.ok).toBe(true);
  });

  it("requireMediaUpload: 미디어 업로드 누락이면 플랫폼 키로 throw", async () => {
    await expect(
      prepareUpload(
        baseInput({ requireMediaUpload: true }),
        makeUploadFn(["shot.webp"]),
        { platform: "github" },
      ),
    ).rejects.toThrow("github.error.mediaUploadFailed");

    await expect(
      prepareUpload(
        baseInput({ requireMediaUpload: true }),
        makeUploadFn(["shot.webp"]),
        { platform: "gitlab" },
      ),
    ).rejects.toThrow("gitlab.error.mediaUploadFailed");
  });

  it("requireMediaUpload: logs 누락은 best-effort라 통과", async () => {
    await expect(
      prepareUpload(
        baseInput({ requireMediaUpload: true }),
        makeUploadFn(["logs.html"]),
        { platform: "github" },
      ),
    ).resolves.toMatchObject({ responses: expect.arrayContaining([expect.objectContaining({ filename: "logs.html", ok: false })]) });
  });
});

// 업로드 목록과 업로드 후 조회가 같은 짝을 봐야 인라인 이미지가 본문에 남는다.
describe("toInlineUploadFiles", () => {
  it("refId·filename·dataUrl을 짝지어 입력 순서대로 돌려준다", () => {
    expect(
      toInlineUploadFiles([
        { refId: "r1", dataUrl: "data:IMG1" },
        { refId: "r2", dataUrl: "data:IMG2" },
      ]),
    ).toEqual([
      { refId: "r1", filename: "inline-r1.webp", dataUrl: "data:IMG1" },
      { refId: "r2", filename: "inline-r2.webp", dataUrl: "data:IMG2" },
    ]);
  });

  it("undefined면 빈 배열 (인라인 이미지 없는 제출 경로)", () => {
    expect(toInlineUploadFiles(undefined)).toEqual([]);
  });
});
