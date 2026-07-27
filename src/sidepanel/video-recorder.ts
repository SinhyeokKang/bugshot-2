import { useEditorStore, type RecordingSource } from "@/store/editor-store";
import {
  stopConsoleRecorder,
  stopNetworkRecorder,
  stopActionRecorder,
  syncAndSettleLogs,
} from "./picker-control";
import { pickVideoRecorderMime } from "./lib/video-mime";
import { generateThumbnail } from "./lib/video-thumbnail";
import { trackViewport } from "./lib/trackViewport";
import { hideAnnotation } from "./annotation-control";

const MAX_DURATION_SEC = 60;

interface RecorderState {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  startTime: number;
  tabId: number;
  maxTimer: number;
  source: RecordingSource;
  endedTrack?: MediaStreamTrack;
  endedHandler?: () => void;
}

let state: RecorderState | null = null;

// finalize 창 = onstop이 `state`를 비운 뒤 썸네일 생성·탭 조회를 await 하는 구간. 그 사이엔
// state가 null이라 cancelRecording이 통째로 no-op이 되어 취소가 씹히고 녹화가 drafting으로
// 커밋됐다. state를 되살리면 이중 stop 재진입이 열리므로 별도 플래그로 받는다.
// id는 뒤이은 녹화의 finalize가 창을 덮어쓴 뒤 늦은 continuation이 남의 창을 닫는 걸 막는다.
export function createFinalizeGuard() {
  let win: { id: number; cancelled: boolean } | null = null;
  let seq = 0;
  return {
    begin(): number {
      win = { id: ++seq, cancelled: false };
      return win.id;
    },
    // 열린 창이 있으면 취소로 표시하고 true. 없으면(= 진짜 idle) false.
    cancel(): boolean {
      if (!win) return false;
      win.cancelled = true;
      return true;
    },
    end(id: number): "commit" | "discard" {
      if (!win || win.id !== id) return "discard";
      const { cancelled } = win;
      win = null;
      return cancelled ? "discard" : "commit";
    },
  };
}

const finalizing = createFinalizeGuard();

// 스트림 획득 이후 공통 본문 — tabCapture(startRecording)·getDisplayMedia(startScreenRecording)가 공유.
// source가 "screen"이면 viewportHint(track 해상도)를 viewport로 쓰고, 사용자의 "공유 중지"(track ended)에
// stopRecording을 바인딩한다. tab은 onstop에서 chrome.tabs.get으로 viewport를 잡는다.
function beginRecording(
  stream: MediaStream,
  tabId: number,
  opts: { source: RecordingSource; viewportHint?: { width: number; height: number } },
): void {
  const mimeType = pickVideoRecorderMime();
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    // 2Mbps — 텍스트를 선명히 인코딩할 헤드룸. 일반(저모션)은 quality-bound라 안 닿고 작게 유지,
    // 과모션 세션만 이 선까지 써서 선명+커짐(소수 업로드 실패는 수용한 트레이드오프).
    videoBitsPerSecond: 2_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = async () => {
    const localEndedAt = Date.now();
    const s = state;
    if (!s) return;
    window.clearTimeout(s.maxTimer);
    if (s.endedTrack && s.endedHandler) {
      s.endedTrack.removeEventListener("ended", s.endedHandler);
    }
    s.stream.getTracks().forEach((t) => t.stop());

    // Strip codec parameter — mp4 recorder mime contains
    // `codecs="avc1.42E01E,mp4a.40.2"` whose comma breaks downstream data URL
    // parsers (GitHub asset upload uses a strict regex).
    const recorderMime = s.recorder.mimeType || mimeType || "video/webm";
    const blobType = recorderMime.split(";")[0] || "video/webm";
    const blob = new Blob(chunks, { type: blobType });
    const localTabId = s.tabId;
    const localStartTime = s.startTime;
    const localSource = s.source;
    state = null;
    const finalizeId = finalizing.begin();

    // 어노테이션 오버레이 정리 — send가 내부에서 예외를 삼키므로 fire-and-forget(녹화 결과물 흐름 무간섭).
    void hideAnnotation(localTabId);

    let thumbnail: string;
    try {
      thumbnail = await generateThumbnail(blob);
    } catch {
      thumbnail = "";
    }

    // 화면 녹화 viewport는 track 해상도(다른 모니터일 수 있어 현재 탭 크기 폴백 금지 — undefined면 {0,0}).
    let viewport =
      localSource === "screen" ? opts.viewportHint ?? { width: 0, height: 0 } : { width: 0, height: 0 };
    try {
      const tab = await chrome.tabs.get(localTabId);
      if (localSource === "tab") {
        viewport = { width: tab.width ?? 0, height: tab.height ?? 0 };
      }
      const store = useEditorStore.getState();
      if (store.target && (tab.url || tab.title)) {
        useEditorStore.setState({
          target: {
            ...store.target,
            url: tab.url ?? store.target.url,
            title: tab.title ?? store.target.title,
          },
        });
      }
    } catch { /* tab closed */ }

    // 정지 직전 로그 꼬리를 정착시킨다 — drafting 전이가 로그를 동결하므로 늦게 도착한 flush는
    // 드롭된다. 자르기 화면이 로그를 표·마커로 보여주게 되면서 그 누락이 눈에 보인다.
    // 반드시 finalize 창을 닫기 **전**에 — end()가 창을 소비한 뒤에 await을 두면 그 사이의
    // 취소가 cancelRecording에서 통째로 no-op이 되어 씹힌다(이 파일 상단 주석의 그 버그).
    await syncAndSettleLogs(localTabId);

    // await 사이에 사용자가 취소를 눌렀으면 커밋하지 않는다(store는 cancelRecording이 이미 리셋).
    // end()는 호출 즉시 창을 소비하므로 이 가드를 두 번 부르면 뒤쪽이 항상 discard가 된다 —
    // "commit" 체크를 추가하지 말 것.
    if (finalizing.end(finalizeId) === "discard") return;

    // 트림 오버레이 페이로드 — 길이 무관 항상 만든다(자를 게 없으면 그대로 확정하면 되고 그
    // 경로는 재인코딩이 없다). 별도 setter 없이 onRecordingComplete 인자로만 넘겨야 게이트가
    // drafting 전이와 같은 set()에 실린다(POSTMORTEM 2026-07-17).
    const trim = {
      videoBlob: blob,
      source: { kind: "recording" as const, startedAt: localStartTime, endedAt: localEndedAt },
      ownerTabId: localTabId,
    };
    useEditorStore
      .getState()
      .onRecordingComplete(blob, thumbnail, viewport, localStartTime, localEndedAt, trim);
  };

  recorder.start(1000);

  const maxTimer = window.setTimeout(() => {
    stopRecording();
  }, MAX_DURATION_SEC * 1000);

  let endedTrack: MediaStreamTrack | undefined;
  let endedHandler: (() => void) | undefined;
  if (opts.source === "screen") {
    endedTrack = stream.getVideoTracks()[0];
    endedHandler = () => stopRecording();
    endedTrack?.addEventListener("ended", endedHandler);
  }

  state = {
    stream,
    recorder,
    chunks,
    startTime: Date.now(),
    tabId,
    maxTimer,
    source: opts.source,
    endedTrack,
    endedHandler,
  };
}

// 탭 스트림만 획득(getMediaStreamId + getUserMedia). activeTab 만료 시 getMediaStreamId가 reject —
// 호출자는 그 시점의 user activation으로 getDisplayMedia 폴백을 시작할 수 있다. 스트림 획득과
// recorder 시작(beginTabRecording)을 분리해, 그 사이에 로그 레코더 준비(prepareRecorders)를 끼운다.
export async function startTabStream(tabId: number): Promise<MediaStream> {
  if (state) cancelRecording();

  const streamId = await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError || !id) {
        reject(new Error(chrome.runtime.lastError?.message ?? "no streamId"));
      } else {
        resolve(id);
      }
    });
  });

  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        // 720p — 용량 우선. 픽셀이 적어 정적 녹화가 작다. 텍스트 절대 디테일은 1080p보다 낮지만
        // bitrate 헤드룸(2Mbps)으로 아티팩트를 줄여 가독성을 끌어올린다.
        maxWidth: 1280,
        maxHeight: 720,
        // ~30fps→12fps. fps는 per-frame 선명도(멈춰서 읽는 화질)와 무관하고 프레임 수만 줄여 용량↓.
        maxFrameRate: 12,
      },
    },
  } as MediaStreamConstraints);
}

export function beginTabRecording(stream: MediaStream, tabId: number): void {
  beginRecording(stream, tabId, { source: "tab" });
}

// 화면 전체 녹화 — getDisplayMedia 스트림은 video-capture에서 미리 획득(user activation 보존).
export function startScreenRecording(stream: MediaStream, tabId: number): void {
  if (state) cancelRecording();
  // getDisplayMedia 획득~셋업 사이에 사용자가 OS "공유 중지"를 누르면 track이 이미 ended —
  // ended 리스너 바인딩 전이라 빈 세션으로 시작된다. throw해 호출자 catch가 stream·store를 정리한다.
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState === "ended") {
    throw new Error("screen capture track ended before recording started");
  }
  beginRecording(stream, tabId, { source: "screen", viewportHint: trackViewport(stream) });
}

export function stopRecording(): void {
  if (!state) return;
  void stopNetworkRecorder(state.tabId);
  void stopConsoleRecorder(state.tabId);
  void stopActionRecorder(state.tabId);
  if (state.recorder.state === "recording") {
    state.recorder.stop();
  }
}

export function cancelRecording(): void {
  if (!state) {
    // finalize 창 안이면 플래그만 세우고 store를 되돌린다 — continuation이 커밋 직전 이걸 보고 폐기한다.
    if (finalizing.cancel()) useEditorStore.getState().cancelRecording();
    return;
  }
  const localTabId = state.tabId;
  window.clearTimeout(state.maxTimer);
  if (state.endedTrack && state.endedHandler) {
    state.endedTrack.removeEventListener("ended", state.endedHandler);
  }
  state.recorder.ondataavailable = null;
  state.recorder.onstop = null;
  if (state.recorder.state === "recording") {
    state.recorder.stop();
  }
  state.stream.getTracks().forEach((t) => t.stop());
  state = null;
  void hideAnnotation(localTabId);
  useEditorStore.getState().cancelRecording();
}

export function getElapsedSec(): number {
  if (!state) return 0;
  return Math.floor((Date.now() - state.startTime) / 1000);
}

export function isRecording(): boolean {
  return state !== null && state.recorder.state === "recording";
}

export function getMaxDuration(): number {
  return MAX_DURATION_SEC;
}

