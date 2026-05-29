import type { ConsoleLog } from "@/types/console";
import type { NetworkLog } from "@/types/network";
import type { ActionLog } from "@/types/action";
import type { LogViewerData } from "@/types/log-viewer";
import { blobToDataUrl } from "@/store/blob-db";
import { buildLogsHtml } from "./buildLogsHtml";
import { supportsConsoleNetworkLog, supportsActionLog } from "./captureLogSupport";
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
  issueTitle?: string;
}

export async function buildCaptureFiles(
  input: BuildCaptureFilesInput,
): Promise<CaptureFiles> {
  const result: CaptureFiles = { images: [], logs: [] };

  // 영상 dataUrl은 인라인 recording.mp4(본문 첨부)와 logs.html 임베드 양쪽에서 쓰므로 한 번만 변환해 재사용.
  let videoDataUrl: string | null = null;
  if (input.captureMode === "video" && input.videoBlob) {
    videoDataUrl = await blobToDataUrl(input.videoBlob);
    result.video = {
      filename: recordingFilename(input.videoBlob.type),
      dataUrl: videoDataUrl,
    };
  }

  if (supportsConsoleNetworkLog(input.captureMode)) {
    const actionLog = supportsActionLog(input.captureMode) ? input.actionLog ?? null : null;
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
      const html = buildLogsHtml(input.networkLog ?? null, input.consoleLog ?? null, actionLog, videoEmbed, input.pageUrl ?? "", undefined, input.issueTitle);
      const htmlBlob = new Blob([html], { type: "text/html" });
      result.logs.push({
        filename: "logs.html",
        dataUrl: await blobToDataUrl(htmlBlob),
      });
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
