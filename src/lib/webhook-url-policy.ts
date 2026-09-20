export type WebhookUrlRejection =
  | "invalid"
  | "scheme"
  | "insecure-public"
  | "credentials";

export interface WebhookUrlVerdict {
  // 정규화 결과. path·query를 보존한다 — 엔드포인트 경로 자체가 사용자가 지정한 목적지라
  // origin만 남기면 안 된다.
  url: string;
  // true면 UI가 평문 경고 배지를 띄운다.
  plaintext: boolean;
}

export class WebhookUrlError extends Error {
  constructor(readonly reason: WebhookUrlRejection) {
    super(reason);
    this.name = "WebhookUrlError";
  }
}

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// RFC1918 + loopback + link-local. 공인망 평문만 막는 것이 목적이라 이 바깥은 전부 거부한다.
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "[::1]" || h === "::1") return true;
  // IPv6 ULA(fc00::/7)·링크로컬(fe80::/10). 없으면 사내 IPv6 엔드포인트가 공인망으로 오판된다.
  if (/^\[(f[cd]|fe[89ab])[0-9a-f]*:/.test(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // 점이 없는 단일 호스트명은 사내 DNS 이름이다(tracker, gitlab 등).
  if (!h.includes(".") && !h.startsWith("[")) return true;

  const m = V4.exec(h);
  if (!m) return false;
  const [a, b] = m.slice(1).map(Number);
  if (m.slice(1).some((p) => Number(p) > 255)) return false;
  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function normalizeWebhookUrl(input: string): WebhookUrlVerdict {
  const raw = input.trim();
  if (!raw) throw new WebhookUrlError("invalid");

  // 스킴이 없으면 https를 보정한다. 다른 스킴이 앞에 붙어 있으면 그대로 두고 아래에서 거른다.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new WebhookUrlError("invalid");
  }

  const protocol = u.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") throw new WebhookUrlError("scheme");
  if (!u.hostname) throw new WebhookUrlError("invalid");
  // URL에 박힌 자격증명은 Request 생성자가 TypeError로 거부해 "network"로 뭉개진다 —
  // 원인 불명 실패가 되고 비밀번호가 저장소에 URL 문자열로 남는다.
  if (u.username || u.password) throw new WebhookUrlError("credentials");

  const plaintext = protocol === "http:";
  if (plaintext && !isPrivateHost(u.hostname)) throw new WebhookUrlError("insecure-public");
  // 루트 경로의 후행 슬래시는 떼어낸다 — 사용자가 입력한 문자열과 저장값이 갈리면
  // 연결 폼이 "고치지도 않았는데 값이 바뀌었다"로 보인다.
  const bare = u.pathname === "/" && !u.search && !u.hash;
  const url = bare ? u.toString().replace(/\/$/, "") : u.toString();
  return { url, plaintext };
}
