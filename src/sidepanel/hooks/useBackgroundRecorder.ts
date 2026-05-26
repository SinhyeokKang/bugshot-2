import { useEffect, useRef } from "react";
import { useEditorStore, type EditorPhase } from "@/store/editor-store";
import {
  activateNetworkRecorder,
  activateConsoleRecorder,
  stopNetworkRecorder,
  stopConsoleRecorder,
  syncNetworkRecorder,
  syncConsoleRecorder,
  clearNetworkRecorder,
  clearConsoleRecorder,
} from "@/sidepanel/picker-control";
import { deleteNetworkLog, deleteConsoleLog } from "@/store/blob-db";
import { pageKeyOf } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";

// recording은 사용자가 의도적으로 페이지를 이동하며 버그 시나리오를 재현하는 중,
// drafting/previewing/done은 캡처한 자산을 편집·확인·제출하는 단계 — URL 변경에도 폐기하지 않는다.
export function shouldPreserveBackgroundLogs(phase: EditorPhase): boolean {
  return (
    phase === "recording" ||
    phase === "drafting" ||
    phase === "previewing" ||
    phase === "done"
  );
}

// 사이드패널이 열린 동안 네트워크/콘솔 레코더를 항상 주입해 백그라운드 캡처. 녹화 종료 후엔
// 자산 보존을 위해 재주입을 억제하고, idle 복귀 시 다시 재주입한다.
export function useBackgroundRecorder(tabId: number | null): void {
  const recordersStopped = useRef(false);
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (tabId == null) return;
    const localTabId = tabId;
    let cancelled = false;

    async function inject(): Promise<void> {
      if (cancelled) return;
      // chrome:// / 웹스토어 / 정책 차단 페이지 사전 필터 → PickerUnavailableError noise 방지.
      try {
        const tab = await chrome.tabs.get(localTabId);
        if (cancelled || !isSupportedUrl(tab.url)) return;
      } catch {
        return;
      }
      try {
        await Promise.all([
          activateNetworkRecorder(localTabId),
          activateConsoleRecorder(localTabId),
        ]);
      } catch (err) {
        if (!cancelled) {
          console.warn("[bugshot] background recorder inject failed", err);
        }
      }
    }

    void chrome.tabs.get(localTabId).then((tab) => {
      if (cancelled) return;
      // onUpdated가 먼저 baseline을 채운 경우 stale 값으로 덮지 않는다.
      if (lastUrlRef.current == null) lastUrlRef.current = tab.url ?? null;
      void inject();
    }).catch((err) => {
      if (!cancelled) console.warn("[bugshot] background recorder mount failed", err);
    });

    const onTabUpdated = (
      updatedTabId: number,
      info: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId !== localTabId) return;

      if (info.url) {
        if (lastUrlRef.current == null) {
          lastUrlRef.current = info.url;
        } else {
          const prevKey = pageKeyOf(lastUrlRef.current);
          const newKey = pageKeyOf(info.url);
          lastUrlRef.current = info.url;
          if (prevKey !== newKey) {
            // idle 표준대기 중 네비게이션엔 누적기를 리셋하지 않는다(cross-page 누적). 세션 경계
            // 리셋은 이슈 완료→idle 복귀 블록이 담당. 재주입만 허용한다.
            recordersStopped.current = false;
          }
        }
      }

      if (info.status === "complete" && !recordersStopped.current) {
        void inject();
      }
    };
    chrome.tabs.onUpdated.addListener(onTabUpdated);

    const unsubStore = useEditorStore.subscribe((state, prev) => {
      const phaseChanged = state.phase !== prev.phase;
      const modeChanged = state.captureMode !== prev.captureMode;
      if (!phaseChanged && !modeChanged) return;

      if (state.phase === "capturing" && state.captureMode === "screenshot") {
        syncNetworkRecorder(localTabId).catch(() => {});
        syncConsoleRecorder(localTabId).catch(() => {});
        return;
      }

      // 녹화 정상 종료(stopRecording → onstop → phase=drafting)부터 재주입 억제.
      // 패널 재오픈 시 ref가 false로 초기화되지만, 첨부된 로그는 IndexedDB에 영속돼 있어 표시는 영향 없음.
      // cancelRecording은 stop을 호출하지 않아 레코더가 살아 있으므로 별도 처리 불필요.
      if (prev.phase === "recording" && state.phase === "drafting") {
        recordersStopped.current = true;
        return;
      }

      // idle 복귀(취소/제출 후 reset) 시 pending IDB + MAIN buffer 정리.
      // clear → inject 순서: setSentinel이 먼저 처리되면 이전 sentinel listener가 detach돼 clear가 무시되는 race 가능.
      if (state.phase === "idle" && shouldPreserveBackgroundLogs(prev.phase)) {
        recordersStopped.current = false;
        void (async () => {
          await clearNetworkRecorder(localTabId).catch(() => {});
          await clearConsoleRecorder(localTabId).catch(() => {});
          deleteNetworkLog(`pending:${localTabId}`).catch(() => {});
          deleteConsoleLog(`pending:${localTabId}`).catch(() => {});
          await inject();
        })();
      }
    });

    return () => {
      cancelled = true;
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      unsubStore();
      stopNetworkRecorder(localTabId).catch(() => {});
      stopConsoleRecorder(localTabId).catch(() => {});
      // pending IDB는 tab close 시 tab-bindings.ts가 정리. 여기서 지우면 패널 재오픈 시 networkLogAttach 복원이 깨진다.
    };
  }, [tabId]);
}
