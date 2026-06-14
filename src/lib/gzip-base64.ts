// 0xc000 = 3의 배수라 청크별 btoa 결과를 그대로 이어 붙여도 유효한 base64가 된다(마지막 청크만 패딩).
const CHUNK = 0xc000;

// bytes를 청크 단위 btoa로 base64 인코딩. 단일 거대 btoa·문자열 누적의 블로킹을 피한다.
// opts.yield=true면 매 ~1MB마다 매크로태스크에 양보해 SW/UI가 다른 이벤트를 처리할 수 있게 한다
// (영상 임베드 ~20MB 등 대용량 인코딩에서 사용).
export async function bytesToBase64(
  bytes: Uint8Array,
  opts?: { yield?: boolean },
): Promise<string> {
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    let binary = "";
    for (let j = 0; j < slice.length; j += 0x8000) {
      binary += String.fromCharCode(...slice.subarray(j, j + 0x8000));
    }
    out += btoa(binary);
    if (opts?.yield && i % (CHUNK * 16) === 0) {
      await new Promise((r) => setTimeout(r));
    }
  }
  return out;
}

export async function gzipToBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return bytesToBase64(bytes);
}

export async function base64ToGunzip(b64: string): Promise<string> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
