import type { EditorSnapshot } from "@/store/editor-store";

// 이미지·영상 썸네일을 뺀 경량 스냅샷. session storage 쿼터 초과 시의 2차 시도용.
// 이미지 계열을 한 곳이라도 빠뜨리면(특히 주석본) 2차 시도도 초과해 lite가 목적을 잃는다.
export function toLiteSnapshot(snap: EditorSnapshot): EditorSnapshot {
  return {
    ...snap,
    beforeImage: null,
    afterImage: null,
    beforeAnnotated: null,
    afterAnnotated: null,
    // captureContext는 남긴다 — 기준이 사라지면 resolveCaptureRect의 0×0 가드(요소 소실 시
    // 마진 조각 대신 이미지 없음)가 함께 풀린다. 짝 없는 기준보다 그 가드가 값이 크다.
    // bufferedElements는 배열 안 base64라 얕은 스프레드로는 안 비워짐 → 명시 변환.
    bufferedElements: snap.bufferedElements.map((e) => ({
      ...e,
      beforeImage: null,
      afterImage: null,
      beforeAnnotated: null,
      afterAnnotated: null,
    })),
    screenshotRaw: null,
    screenshotAnnotated: null,
    videoThumbnail: null,
  };
}
