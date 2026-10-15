import { useEditorStore } from "@/store/editor-store";
import { emitCaptureFailure } from "./lib/capture-error";
import { captureFullViewport } from "./picker-control";
import { holdTarget } from "./tab-mode";

// ok 뒤 picker.areaSelected가 끝내 안 오면 capturing에 머문다 — 그때 대상 탭만 앞에 남아 패널의
// 진행 표시·취소가 가려지지 않게 hold에 상한을 둔다(정상 경로는 수백 ms).
const VIEWPORT_HOLD_MAX_MS = 5000;

// 뷰포트 버튼 ~ crop 완료. content가 afterPaint로 프레임을 기다린 뒤 picker.areaSelected를 보내
// captureAndCrop가 찍으므로, 대상 탭 hold는 응답이 아니라 capturing 이탈까지 잡는다.
export async function runViewportCapture(tabId: number): Promise<void> {
  const release = await holdTarget(tabId, "viewport");
  let released = false;
  const unsub = useEditorStore.subscribe((state) => {
    if (state.phase !== "capturing") releaseOnce();
  });
  const timer = setTimeout(releaseOnce, VIEWPORT_HOLD_MAX_MS);
  function releaseOnce() {
    if (released) return;
    released = true;
    clearTimeout(timer);
    unsub();
    void release();
  }
  if (useEditorStore.getState().phase !== "capturing") {
    releaseOnce();
    return;
  }
  // send()가 예외를 삼켜 false로 오므로 throw 경로는 없다.
  const ok = await captureFullViewport(tabId);
  if (ok) return;
  // content가 area-select 상태가 아니면(주입 소실·레이스) 갇히지 않게 idle로 되돌리고 알린다.
  if (useEditorStore.getState().phase === "capturing") {
    // reset보다 먼저 — idle 전이가 지연 권한 만료 플래그를 소비하면 토스트까지 이중으로 뜬다.
    emitCaptureFailure("other");
    useEditorStore.getState().reset();
  }
  releaseOnce();
}
