// 0xc000 = 3의 배수라 청크별 btoa 결과를 그대로 이어 붙여도 유효한 base64가 된다(마지막 청크만 패딩).
const CHUNK = 0xc000;

export async function gzipToBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    let binary = "";
    for (let j = 0; j < slice.length; j += 0x8000) {
      binary += String.fromCharCode(...slice.subarray(j, j + 0x8000));
    }
    out += btoa(binary);
  }
  return out;
}

export async function base64ToGunzip(b64: string): Promise<string> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
