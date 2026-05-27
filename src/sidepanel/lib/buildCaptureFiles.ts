import type { ConsoleLog } from "@/types/console";
import type { NetworkLog } from "@/types/network";
import type { ActionLog } from "@/types/action";
import type { LogViewerData } from "@/types/log-viewer";
import { blobToDataUrl } from "@/store/blob-db";
import { buildLogsHtml } from "./buildLogsHtml";
import { buildHar } from "./buildHar";
import { buildConsoleLogJson } from "./buildConsoleLogJson";
import { buildActionLogJson } from "./buildActionLogJson";
import { recordingFilename } from "./video-mime";

export type CaptureMode = "element" | "screenshot" | "video" | "freeform";

export interface CaptureFile {
  filename: string;
  dataUrl: string;
}

export interface CaptureFiles {
  video?: CaptureFile;
  images: CaptureFile[];
  logs: CaptureFile[];
  jsonLogs: CaptureFile[];
}

export interface BuildCaptureFilesInput {
  captureMode: CaptureMode;
  videoBlob?: Blob | null;
  screenshotImage?: string | null;
  beforeImage?: string | null;
  afterImage?: string | null;
  networkLog?: NetworkLog | null;
  consoleLog?: ConsoleLog | null;
  actionLog?: ActionLog | null;
  videoStartedAt?: number;
  videoEndedAt?: number;
  videoThumbnail?: string | null;
  pageUrl?: string;
}

export async function buildCaptureFiles(
  input: BuildCaptureFilesInput,
): Promise<CaptureFiles> {
  const result: CaptureFiles = { images: [], logs: [], jsonLogs: [] };

  // 영상 dataUrl은 인라인 recording.mp4(본문 첨부)와 logs.html 임베드 양쪽에서 쓰므로 한 번만 변환해 재사용.
  let videoDataUrl: string | null = null;
  if (input.captureMode === "video" && input.videoBlob) {
    videoDataUrl = await blobToDataUrl(input.videoBlob);
    result.video = {
      filename: recordingFilename(input.videoBlob.type),
      dataUrl: videoDataUrl,
    };
  }

  if (input.captureMode === "video" || input.captureMode === "freeform" || input.captureMode === "screenshot") {
    // actionLog는 video(수동 녹화 + 30s-replay)에서만 log-viewer에 주입. freeform/screenshot은 null.
    const actionLog = input.captureMode === "video" ? input.actionLog ?? null : null;
    if (input.networkLog || input.consoleLog || actionLog) {
      // video 모드 & blob & 앵커 모두 존재 시에만 logs.html에 영상을 추가 임베드(동기화용). 아니면 null(graceful).
      const videoEmbed: LogViewerData["video"] =
        input.captureMode === "video" &&
        input.videoBlob &&
        videoDataUrl &&
        input.videoStartedAt != null &&
        input.videoEndedAt != null
          ? {
              dataUrl: videoDataUrl,
              startedAt: input.videoStartedAt,
              ...(input.videoThumbnail ? { thumbnail: input.videoThumbnail } : {}),
            }
          : null;
      const html = buildLogsHtml(input.networkLog ?? null, input.consoleLog ?? null, actionLog, videoEmbed, input.pageUrl ?? "");
      const htmlBlob = new Blob([html], { type: "text/html" });
      result.logs.push({
        filename: "logs.html",
        dataUrl: await blobToDataUrl(htmlBlob),
      });

      if (input.networkLog) {
        const harBlob = new Blob([JSON.stringify(buildHar(input.networkLog), null, 2)], { type: "application/json" });
        result.jsonLogs.push({ filename: "network-log.json", dataUrl: await blobToDataUrl(harBlob) });
      }
      if (input.consoleLog) {
        const jsonBlob = new Blob([JSON.stringify(buildConsoleLogJson(input.consoleLog), null, 2)], { type: "application/json" });
        result.jsonLogs.push({ filename: "console-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
      if (actionLog) {
        const jsonBlob = new Blob([JSON.stringify(buildActionLogJson(actionLog), null, 2)], { type: "application/json" });
        result.jsonLogs.push({ filename: "action-log.json", dataUrl: await blobToDataUrl(jsonBlob) });
      }
    }
  }

  if (input.captureMode === "screenshot") {
    if (input.screenshotImage) {
      result.images.push({
        filename: "screenshot.webp",
        dataUrl: input.screenshotImage,
      });
    }
  } else if (input.captureMode === "element") {
    if (input.beforeImage) {
      result.images.push({ filename: "before.webp", dataUrl: input.beforeImage });
    }
    if (input.afterImage) {
      result.images.push({ filename: "after.webp", dataUrl: input.afterImage });
    }
  }

  return result;
}
