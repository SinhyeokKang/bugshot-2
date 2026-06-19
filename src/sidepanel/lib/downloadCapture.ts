import { dataUrlToBlob } from "@/store/blob-db";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import { buildLogsHtml } from "./buildLogsHtml";
import { recordingFilename } from "./video-mime";

// data URL의 image/<subtype>에서 다운로드 확장자를 뽑는다. image가 아니거나 파싱 실패 시
// 캡처 기본 포맷인 webp로 폴백(buildCaptureFiles의 screenshot.webp와 동일 가정).
export function imageExtFromDataUrl(dataUrl: string): string {
  const m = /^data:image\/([a-z0-9.+-]+)/i.exec(dataUrl);
  if (!m) return "webp";
  const sub = m[1].toLowerCase();
  return sub === "jpeg" ? "jpg" : sub === "svg+xml" ? "svg" : sub;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadImageDataUrl(dataUrl: string, base = "screenshot"): void {
  triggerDownload(dataUrlToBlob(dataUrl), `${base}.${imageExtFromDataUrl(dataUrl)}`);
}

export function downloadVideoBlob(blob: Blob): void {
  triggerDownload(blob, recordingFilename(blob.type));
}

// 로그 섹션에 표시된 network/console/action 로그를 logs.html(rich 로그 뷰어)로 묶어 받는다.
// 영상·스크린샷 임베드는 생략(로그만). 첨부 여부와 무관하게 받은 인자를 그대로 직렬화.
export async function downloadLogsHtml(args: {
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog: ActionLog | null;
  pageUrl: string;
  issueTitle?: string;
}): Promise<void> {
  const html = await buildLogsHtml(
    args.networkLog,
    args.consoleLog,
    args.actionLog,
    null,
    null,
    args.pageUrl,
    undefined,
    args.issueTitle,
  );
  triggerDownload(new Blob([html], { type: "text/html" }), "logs.html");
}
