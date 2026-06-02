const DEFAULT_INSTANCE = "https://gitlab.com";

// Instance URL을 정규화: 빈 값→gitlab.com, 스킴 없으면 https:// 부착, trailing slash 제거.
// 호스트 없는 무효 입력(`https://`)은 throw — 폼이 catch해 안내한다.
export function normalizeInstanceUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_INSTANCE;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (!url.hostname) throw new Error("invalid instance url");
  // gitlab.com은 항상 https로 고정 — http://gitlab.com 입력이 self-managed로 오분류돼
  // 평문으로 PAT가 전송되는 것을 막는다 (gitlab.com은 manifest host_permission 보유).
  const protocol = url.hostname === "gitlab.com" ? "https:" : url.protocol;
  return `${protocol}//${url.host}`;
}
