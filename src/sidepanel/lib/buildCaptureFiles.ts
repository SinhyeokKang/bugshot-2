import type { ConsoleLog } from "@/types/console";
import type { NetworkLog } from "@/types/network";
import { blobToDataUrl } from "@/store/blob-db";
import { buildLogsHtml } from "./buildLogsHtml";
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
  pageUrl?: string;
}

export async function buildCaptureFiles(
  input: BuildCaptureFilesInput,
): Promise<CaptureFiles> {
  const result: CaptureFiles = { images: [], logs: [] };

  if (input.captureMode === "video" && input.videoBlob) {
    result.video = {
      filename: recordingFilename(input.videoBlob.type),
      dataUrl: await blobToDataUrl(input.videoBlob),
    };
  }

  if (input.captureMode === "video" || input.captureMode === "freeform" || input.captureMode === "screenshot") {
    if (input.networkLog || input.consoleLog) {
      const html = buildLogsHtml(input.networkLog ?? null, input.consoleLog ?? null, input.pageUrl ?? "");
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
