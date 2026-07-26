import { isCredentialSafeUrl } from "@/lib/loopback-host";

const DEFAULT_INSTANCE = "https://gitlab.com";

// reason으로 안내 문구가 갈린다 — "주소가 틀렸다"와 "평문이라 막았다"는 사용자가 할 일이 다르다.
export class InstanceUrlError extends Error {
  constructor(readonly reason: "invalid" | "insecure") {
    super(reason);
    this.name = "InstanceUrlError";
  }
}

// Instance URL을 정규화: 빈 값→gitlab.com, 스킴 없으면 https:// 부착, trailing slash 제거.
// 호스트 없는 무효 입력(`https://`)과 평문 http는 throw — 폼이 catch해 reason별로 안내한다.
export function normalizeInstanceUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_INSTANCE;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InstanceUrlError("invalid");
  }
  if (!url.hostname) throw new InstanceUrlError("invalid");
  // gitlab.com은 항상 https로 고정 — http://gitlab.com 입력이 self-managed로 오분류돼
  // 평문으로 PAT가 전송되는 것을 막는다 (gitlab.com은 manifest host_permission 보유).
  const protocol = url.hostname === "gitlab.com" ? "https:" : url.protocol;
  const normalized = new URL(`${protocol}//${url.host}`);
  // self-managed도 평문 http는 거부한다 — PAT는 보통 `api` 전체 스코프라 헤더가 그대로 샌다.
  // loopback만 예외(로컬 개발 인스턴스).
  if (!isCredentialSafeUrl(normalized)) throw new InstanceUrlError("insecure");
  return `${protocol}//${url.host}`;
}
