import { useEffect, useRef } from "react";
import { useEditorStore, type EditorPhase } from "@/store/editor-store";
import {
  injectNetworkRecorder,
  injectConsoleRecorder,
  stopNetworkRecorder,
  stopConsoleRecorder,
  syncNetworkRecorder,
  syncConsoleRecorder,
  clearNetworkRecorder,
  clearConsoleRecorder,
} from "../picker-control";
import { deleteNetworkLog, deleteConsoleLog } from "@/store/blob-db";
import { pageKeyOf } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";

// drafting/previewing/done은 사용자가 캡처한 자산을 편집·확인·제출하는 단계 →
// URL 변경(예: 새 탭 nav)에도 캡처해둔 로그를 폐기하지 않는다.
// recording은 사용자가 의도적으로 페이지를 이동하며 버그 시나리오를 재현하는 중 → 로그 누적 유지.
export function shouldPreserveBackgroundLogs(phase: EditorPhase): boolean {
  return (
    phase === "recording" ||
    phase === "drafting" ||
    phase === "previewing" ||
    phase === "done"
  );
}

// 사이드패널이 열려 있는 동안 네트워크/콘솔 레코더를 항상 주입해 백그라운드 로그를 캡처.
// 녹화 모드 진입 시에는 재주입을 억제하고(handleStartVideo가 직접 클리어/재주입), 종료 후 idle 복귀 시 다시 재주입.
export function useBackgroundRecorder(tabId: number | null): void {
  const recordersStopped = useRef(false);
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (tabId == null) return;
    let cancelled = false;

    async function inject(): Promise<void> {
      if (cancelled) return;
      // chrome://, 웹스토어, 정책 차단 페이지 등에서는 content script 주입이 불가하므로
      // 사전에 걸러서 PickerUnavailableError noise를 막는다.
      try {
        const tab = await chrome.tabs.get(tabId!);
        if (cancelled || !isSupportedUrl(tab.url)) return;
      } catch {
        return;
      }
      try {
        await Promise.all([
          injectNetworkRecorder(tabId!),
          injectConsoleRecorder(tabId!),
        ]);
      } catch (err) {
        if (!cancelled) {
          console.warn("[bugshot] background recorder inject failed", err);
        }
      }
    }

    void chrome.tabs.get(tabId).then((tab) => {
      if (cancelled) return;
      // onUpdated가 먼저 도착해 baseline을 채운 경우 stale 값으로 덮어쓰지 않는다.
      lastUrlRef.current ??= tab.url ?? null;
      void inject();
    }).catch((err) => {
      if (!cancelled) console.warn("[bugshot] background recorder mount failed", err);
    });

    const onTabUpdated = (
      updatedTabId: number,
      info: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId !== tabId) return;

      if (info.url) {
        // chrome.tabs.get resolve 전에 onUpdated가 먼저 도착하면 baseline만 채우고 비교 스킵.
        if (lastUrlRef.current == null) {
          lastUrlRef.current = info.url;
        } else {
          const prevKey = pageKeyOf(lastUrlRef.current);
          const newKey = pageKeyOf(info.url);
          lastUrlRef.current = info.url;
          if (prevKey !== newKey) {
            if (!shouldPreserveBackgroundLogs(useEditorStore.getState().phase)) {
              useEditorStore.setState({ networkLog: null, consoleLog: null });
              deleteNetworkLog(`pending:${tabId}`).catch(() => {});
              deleteConsoleLog(`pending:${tabId}`).catch(() => {});
              // SPA navigation은 status === "complete"가 발화하지 않아 MAIN world가 유지된다.
              // 이전 path의 버퍼가 다음 sync에 섞이지 않도록 명시 클리어. full reload면 send가 silent fail 후 complete에서 재주입.
              clearNetworkRecorder(tabId).catch(() => {});
              clearConsoleRecorder(tabId).catch(() => {});
            }
            recordersStopped.current = false;
            // 페이지 reload(MAIN world 초기화) 시 status === "complete"가 따라 오므로 여기서 inject 중복하지 않는다.
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
        syncNetworkRecorder(tabId).catch(() => {});
        syncConsoleRecorder(tabId).catch(() => {});
        return;
      }

      // 녹화 정상 종료(stopRecording → stopNetworkRecorder/stopConsoleRecorder → recorder.onstop → phase=drafting) 시점부터
      // 재주입 억제. 이전엔 recording 진입 즉시 세팅했지만 그러면 녹화 중 페이지 reload 시 MAIN world가 초기화돼도
      // status==="complete" 핸들러가 차단되어 재주입이 안 되고 로그가 누락됨.
      // cancelRecording 경로는 stop을 호출하지 않아 레코더가 살아 있으므로 별도 처리 불필요.
      if (prev.phase === "recording" && state.phase === "drafting") {
        recordersStopped.current = true;
        return;
      }

      // 작업 종료(작성 취소 / 제출 완료 후 reset / 녹화 중 취소) 후 idle 복귀 시
      // pending IndexedDB와 MAIN world 누적 버퍼를 정리해 다음 캡처가 stale 데이터를 가져가지 않도록 한다.
      // 정상 제출 경로는 confirmDraft가 pending을 issueId로 옮겼으므로 deleteNetworkLog는 no-op.
      // clear → inject(setSentinel) 순서 보장: setSentinel이 먼저 처리되면 이전 sentinel listener가
      // detach돼 clear가 무시되는 race 가능성이 있어 sequential await.
      if (state.phase === "idle" && shouldPreserveBackgroundLogs(prev.phase)) {
        recordersStopped.current = false;
        void (async () => {
          await clearNetworkRecorder(tabId).catch(() => {});
          await clearConsoleRecorder(tabId).catch(() => {});
          deleteNetworkLog(`pending:${tabId}`).catch(() => {});
          deleteConsoleLog(`pending:${tabId}`).catch(() => {});
          await inject();
        })();
      }
    });

    return () => {
      cancelled = true;
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      unsubStore();
      stopNetworkRecorder(tabId).catch(() => {});
      stopConsoleRecorder(tabId).catch(() => {});
      // pending IndexedDB는 tab close 시 tab-bindings.ts가 정리.
      // 여기서 지우면 패널 재오픈 시 useEditorSessionSync의 networkLogAttach 복원이 깨진다.
    };
  }, [tabId]);
}
