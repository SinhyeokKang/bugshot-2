import type { ConsoleLog } from "@/types/console";
import type { NetworkLog } from "@/types/network";
import { blobToDataUrl } from "@/store/blob-db";
import { buildConsoleLogJson, serializeConsoleLog } from "./buildConsoleLogJson";
import { buildHar, serializeHar } from "./buildHar";
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

  if (input.captureMode === "video" || input.captureMode === "freeform") {
    if (input.networkLog) {
      const harBlob = new Blob([serializeHar(buildHar(input.networkLog))], {
        type: "application/json",
      });
      result.logs.push({
        filename: "network-log.har",
        dataUrl: await blobToDataUrl(harBlob),
      });
    }
    if (input.consoleLog) {
      const jsonBlob = new Blob(
        [serializeConsoleLog(buildConsoleLogJson(input.consoleLog))],
        { type: "application/json" },
      );
      result.logs.push({
        filename: "console-log.json",
        dataUrl: await blobToDataUrl(jsonBlob),
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
