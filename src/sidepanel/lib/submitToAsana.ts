import { buildAsanaIssueBody, type AsanaMediaInput } from "./buildAsanaIssueBody";
import {
  markdownToAsanaHtml,
  type AsanaInlineImage,
} from "./markdownToAsanaHtml";
import { buildAiMetaAttachment } from "./buildAiMetaAttachment";
import type { InlineImageInput } from "./resolveInlineImages";
import { guessUploadMime } from "./uploadMime";
import { loadImage } from "@/sidepanel/capture";
import { injectIssueUrl } from "@/lib/inject-issue-url";
import { sendBg } from "@/types/messages";
import type { AsanaCreateTaskResult } from "@/types/asana";
import type { NormalizedSubmitResult } from "@/types/platform";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface AsanaFileInput {
  filename: string;
  dataUrl: string;
}

export interface AsanaSubmitInput {
  ctx: import("./buildIssueMarkdown").MarkdownContext;
  images?: AsanaFileInput[];
  video?: AsanaFileInput;
  logs?: AsanaFileInput[];
  workspaceGid: string;
  projectGid?: string;
  assigneeGid?: string;
  // 본문(섹션)에 직접 붙여넣은 인라인 이미지 — 캡처 이미지와 동일하게 업로드 후 GID로 인라인.
  inlineImages?: InlineImageInput[];
}

function imageExtFromDataUrl(dataUrl: string): string {
  const subtype = (/^data:image\/([a-zA-Z0-9.+-]+)/.exec(dataUrl)?.[1] ?? "png").toLowerCase();
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return subtype;
}

async function buildInlineRef(
  uploaded: { gid: string; viewUrl?: string },
  dataUrl: string,
): Promise<AsanaInlineImage> {
  const ref: AsanaInlineImage = { gid: uploaded.gid, viewUrl: uploaded.viewUrl };
  try {
    const img = await loadImage(dataUrl);
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      ref.width = img.naturalWidth;
      ref.height = img.naturalHeight;
    }
  } catch {
    // 크기 측정 실패해도 gid만으로 인라인 (graceful).
  }
  return ref;
}

function toUploadEntry(f: AsanaFileInput) {
  return {
    filename: f.filename,
    contentType: guessUploadMime(f.filename),
    dataUrl: f.dataUrl,
  };
}

function toMedia(f: AsanaFileInput): AsanaMediaInput {
  return { filename: f.filename, contentType: guessUploadMime(f.filename) };
}

// Asana는 webp를 본문 인라인 이미지로 지원하지 않으므로 jpeg로 폴백 변환한다.
// jpeg는 투명도 미지원이라 흰 배경을 먼저 깐다.
async function webpToJpeg(f: AsanaFileInput): Promise<AsanaFileInput> {
  if (!/\.webp$/i.test(f.filename)) return f;
  try {
    const img = await loadImage(f.dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0) return f;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return {
      filename: f.filename.replace(/\.webp$/i, ".jpg"),
      dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    };
  } catch {
    return f; // 변환 실패 시 원본 유지 (graceful)
  }
}

export async function submitToAsana(
  input: AsanaSubmitInput,
): Promise<NormalizedSubmitResult> {
  const imageInputs = await Promise.all((input.images ?? []).map(webpToJpeg));
  // 인라인 이미지는 refId 기반 파일명을 부여해 업로드하고, 본문 src(`inline:refId`)로 ref 매핑한다.
  const inlineEntries = await Promise.all(
    (input.inlineImages ?? []).map(async (img) => ({
      refId: img.refId,
      file: await webpToJpeg({
        filename: `inline-${img.refId}.${imageExtFromDataUrl(img.dataUrl)}`,
        dataUrl: img.dataUrl,
      }),
    })),
  );
  const logs = [...(input.logs ?? []), buildAiMetaAttachment(input.ctx)];
  const allFiles = [
    ...imageInputs,
    ...inlineEntries.map((e) => e.file),
    ...(input.video ? [input.video] : []),
    ...logs,
  ];

  const { body } = buildAsanaIssueBody({
    ctx: input.ctx,
    images: imageInputs.length > 0 ? imageInputs.map(toMedia) : undefined,
  });
  const htmlNotes = markdownToAsanaHtml(body);

  // Asana attachment는 parent task gid가 필수 → createTask 먼저, 그다음 첨부 (Jira 패턴).
  const task = await sendBg<AsanaCreateTaskResult>({
    type: "asana.submitIssue",
    payload: {
      workspaceGid: input.workspaceGid,
      projectGid: input.projectGid,
      name: input.ctx.title.trim(),
      htmlNotes,
      assigneeGid: input.assigneeGid,
    },
  });

  if (allFiles.length > 0) {
    // create가 upload보다 먼저라 task URL을 이미 알고 있음 → logs.html에 백링크를 미리 주입해
    // 1회 업로드로 끝낸다 (GitLab처럼 생성 후 재업로드 불필요).
    const uploadFiles = await Promise.all(
      allFiles.map(async (f) =>
        f.filename === "logs.html"
          ? { ...f, dataUrl: await injectIssueUrl(f.dataUrl, task.permalinkUrl, task.gid) }
          : f,
      ),
    );

    // per-file 격리는 background 핸들러가 처리 (개별 실패 시 gid null) — task는 보존.
    const results = await sendBg<
      Array<{ filename: string; gid: string | null; viewUrl?: string }>
    >({
      type: "asana.uploadFiles",
      parent: task.gid,
      files: uploadFiles.map(toUploadEntry),
    });

    // 업로드된 이미지 GID로 본문을 갱신해 인라인(<img data-asana-gid>) 표시.
    // Asana는 선(先)첨부 → 후(後)본문참조라 create 후 update 2-write가 필요하다.
    // 원본 픽셀 크기를 직접 박아 썸네일 크기 렌더와 Asana 후처리 지연을 회피한다.
    const byName = new Map<string, { gid: string; viewUrl?: string }>();
    for (const r of results) {
      if (r.gid) byName.set(r.filename, { gid: r.gid, viewUrl: r.viewUrl });
    }
    const imageRefs: Record<string, AsanaInlineImage> = {};
    // 캡처 이미지: 본문 src = 파일명.
    await Promise.all(
      imageInputs.map(async (f) => {
        const uploaded = byName.get(f.filename);
        if (uploaded) imageRefs[f.filename] = await buildInlineRef(uploaded, f.dataUrl);
      }),
    );
    // 본문 붙여넣기 인라인 이미지: 본문 src = `inline:refId`.
    await Promise.all(
      inlineEntries.map(async ({ refId, file }) => {
        const uploaded = byName.get(file.filename);
        if (uploaded) imageRefs[`inline:${refId}`] = await buildInlineRef(uploaded, file.dataUrl);
      }),
    );
    if (Object.keys(imageRefs).length > 0) {
      try {
        await sendBg({
          type: "asana.updateTaskNotes",
          taskGid: task.gid,
          htmlNotes: markdownToAsanaHtml(body, imageRefs),
        });
      } catch {
        // 본문 갱신 실패해도 task·첨부는 보존 (이미지는 task 첨부로 남음).
      }
    }
  }

  return { key: task.gid, url: task.permalinkUrl };
}
