import type { JiraAttachmentInput } from "@/types/jira";
import { loadImage } from "@/sidepanel/capture";

const IMAGE_RE = /\.(webp|png|jpe?g)$/i;
const VIDEO_RE = /^recording\.(webm|mp4)$/i;

function videoSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () =>
      resolve(
        v.videoWidth > 0 && v.videoHeight > 0
          ? { width: v.videoWidth, height: v.videoHeight }
          : null,
      );
    v.onerror = () => resolve(null);
    v.src = src;
  });
}

// 첨부 미디어에 원본 픽셀 크기를 채워 ADF media 노드가 종횡비를 잡게 한다.
// 이미지·비디오 모두 실제 디코드 크기로 측정한다(탭 윈도우 viewport는 콘텐츠 영역
// 종횡비와 어긋나므로 쓰지 않는다). 실패/미지원은 dims 없이 통과(graceful).
export async function annotateAttachmentDimensions(
  attachments: JiraAttachmentInput[],
): Promise<JiraAttachmentInput[]> {
  return Promise.all(
    attachments.map(async (att) => {
      try {
        if (VIDEO_RE.test(att.filename)) {
          const size = await videoSize(att.dataUrl);
          return size ? { ...att, ...size } : att;
        }
        if (IMAGE_RE.test(att.filename)) {
          const img = await loadImage(att.dataUrl);
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            return { ...att, width: img.naturalWidth, height: img.naturalHeight };
          }
        }
      } catch {
        // ignore — fall back to no dims
      }
      return att;
    }),
  );
}
