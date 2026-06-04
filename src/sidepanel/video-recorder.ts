import { useEditorStore } from "@/store/editor-store";
import {
  stopConsoleRecorder,
  stopNetworkRecorder,
  stopActionRecorder,
} from "./picker-control";
import { pickVideoRecorderMime } from "./lib/video-mime";

const MAX_DURATION_SEC = 60;

interface RecorderState {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  startTime: number;
  tabId: number;
  maxTimer: number;
}

let state: RecorderState | null = null;

export async function startRecording(tabId: number): Promise<void> {
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

  const stream = await navigator.mediaDevices.getUserMedia({
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

  const mimeType = pickVideoRecorderMime();
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    // 2Mbps — 1080p 텍스트를 선명히 인코딩할 헤드룸. 일반(저모션)은 quality-bound라 안 닿고
    // 작게 유지, 과모션 세션만 이 선까지 써서 선명+커짐(소수 업로드 실패는 수용한 트레이드오프).
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
    s.stream.getTracks().forEach((t) => t.stop());

    // Strip codec parameter — mp4 recorder mime contains
    // `codecs="avc1.42E01E,mp4a.40.2"` whose comma breaks downstream data URL
    // parsers (GitHub asset upload uses a strict regex).
    const recorderMime = s.recorder.mimeType || mimeType || "video/webm";
    const blobType = recorderMime.split(";")[0] || "video/webm";
    const blob = new Blob(chunks, { type: blobType });
    const localTabId = s.tabId;
    const localStartTime = s.startTime;
    state = null;

    let thumbnail: string;
    try {
      thumbnail = await generateThumbnail(blob);
    } catch {
      thumbnail = "";
    }

    let viewport = { width: 0, height: 0 };
    try {
      const tab = await chrome.tabs.get(localTabId);
      viewport = { width: tab.width ?? 0, height: tab.height ?? 0 };
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

    useEditorStore
      .getState()
      .onRecordingComplete(blob, thumbnail, viewport, localStartTime, localEndedAt);
  };

  recorder.start(1000);

  const maxTimer = window.setTimeout(() => {
    stopRecording();
  }, MAX_DURATION_SEC * 1000);

  state = {
    stream,
    recorder,
    chunks,
    startTime: Date.now(),
    tabId,
    maxTimer,
  };
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
  if (!state) return;
  window.clearTimeout(state.maxTimer);
  state.recorder.ondataavailable = null;
  state.recorder.onstop = null;
  if (state.recorder.state === "recording") {
    state.recorder.stop();
  }
  state.stream.getTracks().forEach((t) => t.stop());
  state = null;
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

async function generateThumbnail(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("video load failed"));
      video.load();
    });

    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = 0.001;
    });

    const MAX_W = 480;
    const scale = Math.min(1, MAX_W / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}
