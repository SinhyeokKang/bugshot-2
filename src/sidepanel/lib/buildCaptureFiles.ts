import type { ConsoleLog } from "@/types/console";
import type { NetworkLog } from "@/types/network";
import type { ActionLog } from "@/types/action";
import type { LogViewerData } from "@/types/log-viewer";
import type { UserAttachmentMeta } from "@/types/attachment";
import { blobToDataUrl } from "@/store/blob-db";
import { buildLogsHtml } from "./buildLogsHtml";
import { buildReportData, type BuildReportDataInput } from "./buildReportData";
import { supportsConsoleNetworkLog, supportsActionLog } from "./captureLogSupport";
import { recordingFilename } from "./video-mime";

export type CaptureMode = "element" | "screenshot" | "video" | "freeform";

export interface CaptureFile {
  filename: string;
  dataUrl: string;
  // 사용자 첨부는 업로드 식별용 filename을 고유화하고 표시명을 별도 유지.
  displayName?: string;
}

export interface CaptureFiles {
  video?: CaptureFile;
  images: CaptureFile[];
  logs: CaptureFile[];
  attachments: CaptureFile[];
}

export interface BuildCaptureFilesInput {
  captureMode: CaptureMode;
  videoBlob?: Blob | null;
  screenshotImage?: string | null;
  // element 모드: element별 before/after 배열. 항목별 before-${i}.webp / after-${i}.webp.
  beforeImages?: (string | null)[];
  afterImages?: (string | null)[];
  networkLog?: NetworkLog | null;
  consoleLog?: ConsoleLog | null;
  actionLog?: ActionLog | null;
  videoStartedAt?: number;
  videoEndedAt?: number;
  videoThumbnail?: string | null;
  pageUrl?: string;
  issueTitle?: string;
  // 로그 게이팅 통과 시 logs.html에 임베드할 Report 데이터 입력(없으면 report=null).
  report?: BuildReportDataInput | null;
  // 사용자가 직접 첨부한 로컬 파일(메타+Blob). captureMode 무관하게 attachments로 합류.
  userAttachments?: { meta: UserAttachmentMeta; blob: Blob }[];
}

export async function buildCaptureFiles(
  input: BuildCaptureFilesInput,
): Promise<CaptureFiles> {
  const result: CaptureFiles = { images: [], logs: [], attachments: [] };

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
      // screenshot 모드 & 이미지 존재 시에만 좌측 패널용 정적 이미지 임베드(모드 배타라 video와 동시 비존재).
      const screenshotEmbed: LogViewerData["screenshot"] =
        input.captureMode === "screenshot" && input.screenshotImage
          ? { dataUrl: input.screenshotImage }
          : null;
      const report = input.report ? await buildReportData(input.report) : null;
      const html = await buildLogsHtml(input.networkLog ?? null, input.consoleLog ?? null, actionLog, videoEmbed, screenshotEmbed, input.pageUrl ?? "", undefined, input.issueTitle, report);
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
    const befores = input.beforeImages ?? [];
    const afters = input.afterImages ?? [];
    const count = Math.max(befores.length, afters.length);
    for (let i = 0; i < count; i++) {
      const before = befores[i];
      const after = afters[i];
      if (before) result.images.push({ filename: `before-${i}.webp`, dataUrl: before });
      if (after) result.images.push({ filename: `after-${i}.webp`, dataUrl: after });
    }
  }

  if (input.userAttachments?.length) {
    for (const { meta, blob } of input.userAttachments) {
      result.attachments.push({
        filename: `${meta.id}__${meta.filename}`,
        displayName: meta.filename,
        dataUrl: await blobToDataUrl(blob),
      });
    }
  }

  return result;
}
