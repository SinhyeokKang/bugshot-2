import { blobToDataUrl, dataUrlToBlob } from "@/store/blob-db";

// Notion 업로드 경로의 Cloudflare WAF가 평문 HTML(콘솔/네트워크 로그의 stack trace·URL·따옴표 패턴)을
// "공격 페이로드"로 오탐해 403을 친다. store-mode zip도 내부 바이트가 평문이라 같은 사유로 차단됨 →
// DEFLATE 압축으로 평문 패턴을 가려서 우회한다. (Chrome 80+ CompressionStream 네이티브, MV3 호환)
// 부수효과로 size도 ~30%로 줄어 무료 워크스페이스 5 MiB 한도에 여유.

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Blob.stream()으로 우회 — writer.write(Uint8Array)는 ArrayBuffer 타입 요구라 ArrayBufferLike와 충돌.
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function zipLogsHtml(
  innerFilename: string,
  innerDataUrl: string,
): Promise<{ filename: string; contentType: string; dataUrl: string }> {
  const data = new Uint8Array(await dataUrlToBlob(innerDataUrl).arrayBuffer());
  const nameBytes = new TextEncoder().encode(innerFilename);
  const crc = crc32(data);
  const uncSize = data.length;
  const compressed = await deflateRaw(data);
  const compSize = compressed.length;
  // bit 11 = UTF-8 filename (Notion의 zip preview에서 비ASCII 파일명도 안전하게 표시).
  const FLAGS = 0x0800;
  // 1980-01-01 00:00:00 — DOS time/date 최소값. 첨부 파일 메타라 실제 시간 무관.
  const DOS_TIME = 0;
  const DOS_DATE = 0x21;
  // 8 = deflate (Cloudflare WAF가 평문 패턴 매칭 못 하도록 압축 필수).
  const METHOD_DEFLATE = 8;

  const lfh: number[] = [
    ...u32(0x04034b50), // local file header signature
    ...u16(20),         // version needed
    ...u16(FLAGS),
    ...u16(METHOD_DEFLATE),
    ...u16(DOS_TIME),
    ...u16(DOS_DATE),
    ...u32(crc),
    ...u32(compSize),
    ...u32(uncSize),
    ...u16(nameBytes.length),
    ...u16(0),          // extra field length
    ...nameBytes,
  ];

  const cdfh: number[] = [
    ...u32(0x02014b50), // central directory file header signature
    ...u16(0x031e),     // version made by — UNIX (3) / 3.0
    ...u16(20),         // version needed
    ...u16(FLAGS),
    ...u16(METHOD_DEFLATE),
    ...u16(DOS_TIME),
    ...u16(DOS_DATE),
    ...u32(crc),
    ...u32(compSize),
    ...u32(uncSize),
    ...u16(nameBytes.length),
    ...u16(0),          // extra
    ...u16(0),          // comment
    ...u16(0),          // disk number
    ...u16(0),          // internal attrs
    ...u32(0),          // external attrs
    ...u32(0),          // relative offset of local header
    ...nameBytes,
  ];

  const cdOffset = lfh.length + compSize;
  const eocd: number[] = [
    ...u32(0x06054b50),
    ...u16(0),          // disk number
    ...u16(0),          // disk start
    ...u16(1),          // entries on disk
    ...u16(1),          // total entries
    ...u32(cdfh.length),
    ...u32(cdOffset),
    ...u16(0),          // comment length
  ];

  const out = new Uint8Array(lfh.length + compSize + cdfh.length + eocd.length);
  let off = 0;
  out.set(lfh, off); off += lfh.length;
  out.set(compressed, off); off += compSize;
  out.set(cdfh, off); off += cdfh.length;
  out.set(eocd, off);

  const outerFilename = innerFilename.replace(/\.html?$/i, "") + ".zip";
  const dataUrl = await blobToDataUrl(new Blob([out], { type: "application/zip" }));
  return { filename: outerFilename, contentType: "application/zip", dataUrl };
}
