export type FileCategory = "image" | "video" | "audio" | "pdf" | "archive" | "text" | "file";

const ARCHIVE_MIME_RE = /(zip|x-tar|gzip|x-rar|x-7z|x-bzip|compress)/;
const ARCHIVE_EXT = new Set(["zip", "gz", "tar", "tgz", "rar", "7z", "bz2", "xz"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac"]);
const TEXT_EXT = new Set(["txt", "md", "csv", "log", "json", "xml", "yml", "yaml", "html"]);

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  if (i < 0 || i === filename.length - 1) return "";
  return filename.slice(i + 1).toLowerCase();
}

export function fileCategory(contentType: string, filename: string): FileCategory {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  if (ct === "application/pdf") return "pdf";
  if (ct && ARCHIVE_MIME_RE.test(ct)) return "archive";
  if (ct.startsWith("text/")) return "text";

  // contentType이 비었거나 octet-stream 같은 미상이면 확장자로 폴백.
  const ext = extOf(filename);
  if (ext) {
    if (IMAGE_EXT.has(ext)) return "image";
    if (VIDEO_EXT.has(ext)) return "video";
    if (AUDIO_EXT.has(ext)) return "audio";
    if (ext === "pdf") return "pdf";
    if (ARCHIVE_EXT.has(ext)) return "archive";
    if (TEXT_EXT.has(ext)) return "text";
  }
  return "file";
}

export function fileExtLabel(filename: string, _contentType: string): string {
  const ext = extOf(filename);
  return ext ? ext.toUpperCase() : "FILE";
}
