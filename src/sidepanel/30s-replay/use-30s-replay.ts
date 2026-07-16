import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sendBg } from "@/types/messages";
import { useEditorStore } from "@/store/editor-store";
import { syncAndSettleLogs } from "@/sidepanel/picker-control";
import { trimByTime, replayLogBounds } from "@/sidepanel/lib/log-merge";
import { saveNetworkLog, saveConsoleLog, saveActionLog } from "@/store/blob-db";
import { networkLogPersist, consoleLogPersist, actionLogPersist } from "@/sidepanel/hooks/usePickerMessages";
import { useT } from "@/i18n";
import { FrameBuffer, REPLAY_MAX_DURATION_MS } from "./frame-buffer";
import type { CapturedFrame } from "./frame-buffer";
import { encodeToMp4 } from "./mp4-encoder";

const CAPTURE_INTERVAL_MS = 600;
const MIN_READY_FRAMES = 10;

export interface Use30sReplayReturn {
  isReady: boolean;
  isEncoding: boolean;
  bufferedSeconds: number;
  capture: () => Promise<void>;
  pendingTrim: { videoBlob: Blob; frames: CapturedFrame[] } | null;
  resolveTrim: () => void;
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
  const [bufferedSeconds, setBufferedSeconds] = useState(0);
  const [pendingTrim, setPendingTrim] = useState<{ videoBlob: Blob; frames: CapturedFrame[] } | null>(null);

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
      setBufferedSeconds(0);
      return;
    }

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let displayId: ReturnType<typeof setInterval> | null = null;

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
          quality: 80,
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

    // <all_urls>가 required라 권한 확인 없이 바로 폴링을 시작한다.
    intervalId = setInterval(() => void tick(), CAPTURE_INTERVAL_MS);
    // 표시값은 푸시 성공이 아니라 벽시계 1초 타이머로 갱신 — 캡처 스킵(rate limit·in-flight)으로
    // 숫자가 멈췄다 확 뛰는 현상을 없앤다. oldest 프레임 시각에 앵커돼 30초 캡에서 자연히 멈춘다.
    displayId = setInterval(() => {
      if (cancelled || useEditorStore.getState().phase !== "idle") return;
      const oldest = buffer.oldestTimestamp;
      setBufferedSeconds(
        oldest == null
          ? 0
          : Math.min(REPLAY_MAX_DURATION_MS / 1000, Math.ceil((Date.now() - oldest) / 1000)),
      );
    }, 1000);

    return () => {
      cancelled = true;
      if (intervalId != null) clearInterval(intervalId);
      if (displayId != null) clearInterval(displayId);
      buffer.clear();
      setIsReady(false);
      setBufferedSeconds(0);
    };
  }, [tabId, enabled]);

  // non-idle → idle 전환(picking/styling/recording/drafting 취소) 시 스테일 프레임을 버리고
  // 새 30초 윈도우를 시작한다. capture()가 frames[0].timestamp 기준으로 로그를 트림하므로
  // 영상-액션 로그 동기화는 자동으로 따라온다 — 로그를 따로 건드릴 필요 없음.
  useEffect(() => {
    return useEditorStore.subscribe((state, prev) => {
      if (prev.phase !== "idle" && state.phase === "idle") {
        bufferRef.current.clear();
        setIsReady(false);
        setBufferedSeconds(0);
      }
    });
  }, []);

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
      setBufferedSeconds(0);

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
      // 영상 기준점(lower)은 그대로 두되, 로그 trim 하한만 가드밴드로 당겨 첫 프레임 직전
      // 초반 로그가 캡처 폴링 지연으로 잘리는 걸 막는다.
      const { lower: logLower, upper: logUpper } = replayLogBounds(lower, captureTime);
      // syncAndSettleLogs가 network/console/action 모두 sync한다.
      await syncAndSettleLogs(id);
      // 수신부 가드에 대기 중인 전체 버퍼 write를 폐기 — 아래 trim 직접 save가 덮어쓰여
      // trim 경계 밖 로그가 IDB에서 부활하는 걸 막는다.
      networkLogPersist.discard();
      consoleLogPersist.discard();
      actionLogPersist.discard();
      const { networkLog, consoleLog, actionLog } = useEditorStore.getState();
      if (networkLog) {
        const requests = trimByTime(networkLog.requests, (r) => r.startTime, logLower, logUpper);
        const trimmed = { ...networkLog, requests, captured: requests.length };
        useEditorStore.getState().setNetworkLog(trimmed);
        saveNetworkLog(`pending:${id}`, trimmed).catch(() => {});
      }
      if (consoleLog) {
        const entries = trimByTime(consoleLog.entries, (e) => e.timestamp, logLower, logUpper);
        const trimmed = { ...consoleLog, entries, captured: entries.length };
        useEditorStore.getState().setConsoleLog(trimmed);
        saveConsoleLog(`pending:${id}`, trimmed).catch(() => {});
      }
      if (actionLog) {
        const entries = trimByTime(actionLog.entries, (e) => e.timestamp, logLower, logUpper);
        const trimmed = { ...actionLog, entries, captured: entries.length };
        useEditorStore.getState().setActionLog(trimmed);
        saveActionLog(`pending:${id}`, trimmed).catch(() => {});
      }

      // idle 직접 진입이라 startRecording이 하던 target 설정을 여기서 대신 — confirmDraft 가드 통과용.
      useEditorStore.setState({ target });
      // 보존한 프레임으로 trim 오버레이 대기 상태를 켠다(2프레임 미만이면 trim 무의미 → 전체 클립 직행).
      // 게이트(replayTrimPending)는 drafting 전이와 같은 set()에 실어 원자적으로 켜고, pendingTrim은
      // 오버레이 페이로드 전용이다 — 게이트를 이 로컬 state에 두면 레인이 갈려 한 렌더가 샌다.
      const trimPending = frames.length >= 2;
      useEditorStore.getState().onRecordingComplete(blob, thumbnail, viewport, lower, captureTime, trimPending);
      if (trimPending) setPendingTrim({ videoBlob: blob, frames });
    } catch {
      toast.error(tRef.current("issue.replay.encodeFailed"));
    } finally {
      encodingRef.current = false;
      pausedRef.current = false;
      setIsEncoding(false);
    }
  }, []);

  const resolveTrim = useCallback(() => {
    setPendingTrim(null);
    useEditorStore.getState().resolveReplayTrim();
  }, []);

  return { isReady, isEncoding, bufferedSeconds, capture, pendingTrim, resolveTrim };
}
