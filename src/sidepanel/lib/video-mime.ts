// MediaRecorder mime priority. mp4 first so Jira's media services can
// transcode quickly (webm processing is slow / fails in many workspaces).
// Fall back to webm on browsers where mp4 container isn't supported.
const RECORDER_MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

export function pickVideoRecorderMime(
  isSupported: (mime: string) => boolean = (m) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
): string {
  for (const mime of RECORDER_MIME_CANDIDATES) {
    if (isSupported(mime)) return mime;
  }
  return "";
}

export function videoMimeToExt(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.startsWith("video/mp4")) return ".mp4";
  return ".webm";
}

export function recordingFilename(mime: string, base = "recording"): string {
  return `${base}${videoMimeToExt(mime)}`;
}
