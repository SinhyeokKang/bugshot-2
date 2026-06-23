// 저장된 API 키의 평문 노출만 차단하는 난독화(XOR+base64). 암호화가 아니다 —
// SALT가 코드에 박혀 있어 복원 가능하며, 기밀성이 아니라 우발적 노출 방지가 목적.
const SALT = "bugshot-key-guard";
const OBF_PREFIX = "obf:";

export function obfuscateApiKey(plain: string): string {
  if (!plain) return "";
  const bytes = new TextEncoder().encode(plain);
  const saltBytes = new TextEncoder().encode(SALT);
  const xored = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    xored[i] = bytes[i] ^ saltBytes[i % saltBytes.length];
  }
  return OBF_PREFIX + btoa(String.fromCharCode(...xored));
}

export function deobfuscateApiKey(encoded: string): string {
  if (!encoded) return "";
  if (!encoded.startsWith(OBF_PREFIX)) return encoded;
  const b64 = encoded.slice(OBF_PREFIX.length);
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  const saltBytes = new TextEncoder().encode(SALT);
  const xored = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    xored[i] = bytes[i] ^ saltBytes[i % saltBytes.length];
  }
  return new TextDecoder().decode(xored);
}
