import { buildAsanaIssueBody, type AsanaMediaInput } from "./buildAsanaIssueBody";
import {
  markdownToAsanaHtml,
  type AsanaInlineImage,
} from "./markdownToAsanaHtml";
import { buildAiMetaAttachment } from "./buildAiMetaAttachment";
import { loadImage } from "@/sidepanel/capture";
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
}

function asanaFilename(name: string): string {
  return name.endsWith(".har") ? name.replace(/\.har$/, ".json") : name;
}

function guessMime(filename: string): string {
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg"))
    return "image/jpeg";
  if (filename.endsWith(".webm")) return "video/webm";
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".html")) return "text/html";
  if (filename.endsWith(".md")) return "text/markdown";
  if (filename.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function toUploadEntry(f: AsanaFileInput) {
  const name = asanaFilename(f.filename);
  return { filename: name, contentType: guessMime(name), dataUrl: f.dataUrl };
}

function toMedia(f: AsanaFileInput): AsanaMediaInput {
  const name = asanaFilename(f.filename);
  return { filename: name, contentType: guessMime(name) };
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
  const logs = [...(input.logs ?? []), buildAiMetaAttachment(input.ctx)];
  const allFiles = [
    ...imageInputs,
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
    // per-file 격리는 background 핸들러가 처리 (개별 실패 시 gid null) — task는 보존.
    const results = await sendBg<
      Array<{ filename: string; gid: string | null; viewUrl?: string }>
    >({
      type: "asana.uploadFiles",
      parent: task.gid,
      files: allFiles.map(toUploadEntry),
    });

    // 업로드된 이미지 GID로 본문을 갱신해 인라인(<img data-asana-gid>) 표시.
    // Asana는 선(先)첨부 → 후(後)본문참조라 create 후 update 2-write가 필요하다.
    // 원본 픽셀 크기를 직접 박아 썸네일 크기 렌더와 Asana 후처리 지연을 회피한다.
    const byName = new Map<string, { gid: string; viewUrl?: string }>();
    for (const r of results) {
      if (r.gid) byName.set(r.filename, { gid: r.gid, viewUrl: r.viewUrl });
    }
    const imageRefs: Record<string, AsanaInlineImage> = {};
    await Promise.all(
      imageInputs.map(async (f) => {
        const name = asanaFilename(f.filename);
        const uploaded = byName.get(name);
        if (!uploaded) return;
        const ref: AsanaInlineImage = {
          gid: uploaded.gid,
          viewUrl: uploaded.viewUrl,
        };
        try {
          const img = await loadImage(f.dataUrl);
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            ref.width = img.naturalWidth;
            ref.height = img.naturalHeight;
          }
        } catch {
          // 크기 측정 실패해도 gid만으로 인라인 (graceful).
        }
        imageRefs[name] = ref;
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
