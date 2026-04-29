import { useEditorStore } from "@/store/editor-store";

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

function pickMimeType(): string {
  for (const mime of [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

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
      },
    },
  } as MediaStreamConstraints);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 1_500_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = async () => {
    const s = state;
    if (!s) return;
    window.clearTimeout(s.maxTimer);
    s.stream.getTracks().forEach((t) => t.stop());

    const blob = new Blob(chunks, { type: "video/webm" });
    const localTabId = s.tabId;
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
      .onRecordingComplete(blob, thumbnail, viewport);
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
