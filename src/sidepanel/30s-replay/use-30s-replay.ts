import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sendBg } from "@/types/messages";
import { useEditorStore } from "@/store/editor-store";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { syncAndSettleLogs } from "@/sidepanel/picker-control";
import { trimByTime } from "@/sidepanel/lib/log-merge";
import { saveNetworkLog, saveConsoleLog } from "@/store/blob-db";
import { useT } from "@/i18n";
import { FrameBuffer } from "./frame-buffer";
import { encodeToMp4 } from "./mp4-encoder";

const CAPTURE_INTERVAL_MS = 600;
const MIN_READY_FRAMES = 10;
export const REPLAY_ORIGINS = ["https://*/*", "http://*/*"];

export interface Use30sReplayReturn {
  isReady: boolean;
  isEncoding: boolean;
  capture: () => Promise<void>;
}

export function use30sReplay(
  tabId: number | null,
  enabled: boolean,
): Use30sReplayReturn {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;

  const [isReady, setIsReady] = useState(false);
  const [isEncoding, setIsEncoding] = useState(false);

  const bufferRef = useRef<FrameBuffer>(new FrameBuffer());
  const inFlightRef = useRef(false);
  const pausedRef = useRef(false);
  const encodingRef = useRef(false);
  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const buffer = bufferRef.current;
    if (!enabled || tabId == null) {
      buffer.clear();
      setIsReady(false);
      return;
    }

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function tick(): Promise<void> {
      if (cancelled || inFlightRef.current || pausedRef.current) return;
      if (useEditorStore.getState().phase !== "idle") return;
      const id = tabIdRef.current;
      if (id == null) return;
      inFlightRef.current = true;
      try {
        const tab = await chrome.tabs.get(id);
        if (cancelled || !tab.active) return;
        const dataUrl = await sendBg<string>({
          type: "captureVisibleTab",
          tabId: id,
          format: "jpeg",
          quality: 65,
        });
        const blob = await (await fetch(dataUrl)).blob();
        if (cancelled) return;
        buffer.push(blob, Date.now());
        if (buffer.size >= MIN_READY_FRAMES) setIsReady(true);
      } catch {
        // 탭 닫힘·네비게이션·rate limit 등 — 조용히 스킵
      } finally {
        inFlightRef.current = false;
      }
    }

    void (async () => {
      try {
        const granted = await chrome.permissions.contains({
          origins: REPLAY_ORIGINS,
        });
        if (cancelled) return;
        if (!granted) {
          useSettingsUiStore.getState().setReplayEnabled(false);
          toast.error(tRef.current("issue.replay.permissionRevoked"));
          return;
        }
        intervalId = setInterval(() => void tick(), CAPTURE_INTERVAL_MS);
      } catch {
        // permissions API 실패 시 미시작
      }
    })();

    return () => {
      cancelled = true;
      if (intervalId != null) clearInterval(intervalId);
      buffer.clear();
      setIsReady(false);
    };
  }, [tabId, enabled]);

  const capture = useCallback(async () => {
    const id = tabIdRef.current;
    if (id == null || encodingRef.current) return;

    pausedRef.current = true;
    const frames = bufferRef.current.snapshot();
    if (frames.length === 0) {
      pausedRef.current = false;
      return;
    }
    encodingRef.current = true;
    setIsEncoding(true);
    try {
      const { blob, thumbnail } = await encodeToMp4({ frames });
      const phaseIdle = useEditorStore.getState().phase === "idle";
      if (!enabledRef.current || !phaseIdle) return;
      bufferRef.current.clear();
      setIsReady(false);

      let viewport = { width: 0, height: 0 };
      let target = { tabId: id, url: "", title: "" };
      try {
        const tab = await chrome.tabs.get(id);
        viewport = { width: tab.width ?? 0, height: tab.height ?? 0 };
        target = { tabId: id, url: tab.url ?? "", title: tab.title ?? "" };
      } catch {
        // 탭 닫힘 — 0 viewport·빈 target으로 진행
      }

      // 최신 sync를 누적기에 반영한 뒤 mp4 프레임 버퍼 구간으로 트림. settle 후엔 await을 두지 않아
      // 지연 sync가 끼어들 갭을 없애고, 직후 onRecordingComplete로 drafting 전환(프리즈)해 첨부 로그를 고정한다.
      const captureTime = Date.now();
      const lower = frames[0].timestamp;
      await syncAndSettleLogs(id);
      const { networkLog, consoleLog } = useEditorStore.getState();
      if (networkLog) {
        const requests = trimByTime(networkLog.requests, (r) => r.startTime, lower, captureTime);
        const trimmed = { ...networkLog, requests, captured: requests.length };
        useEditorStore.getState().setNetworkLog(trimmed);
        saveNetworkLog(`pending:${id}`, trimmed).catch(() => {});
      }
      if (consoleLog) {
        const entries = trimByTime(consoleLog.entries, (e) => e.timestamp, lower, captureTime);
        const trimmed = { ...consoleLog, entries, captured: entries.length };
        useEditorStore.getState().setConsoleLog(trimmed);
        saveConsoleLog(`pending:${id}`, trimmed).catch(() => {});
      }

      // idle 직접 진입이라 startRecording이 하던 target 설정을 여기서 대신 — confirmDraft 가드 통과용.
      useEditorStore.setState({ target });
      useEditorStore.getState().onRecordingComplete(blob, thumbnail, viewport);
    } catch {
      toast.error(tRef.current("issue.replay.encodeFailed"));
    } finally {
      encodingRef.current = false;
      pausedRef.current = false;
      setIsEncoding(false);
    }
  }, []);

  return { isReady, isEncoding, capture };
}
