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
// 판정에서 빠지면 보안 구멍이 아니라 **정당한 사내 주소가 저장조차 안 되는** 기능 제약으로
// 나온다(실패 방향이 전부 거부). ssrf-guard.ts:isBlockedHost가 같은 개념을 반대 방향으로
// 보고 있어 축을 맞춘다 — 저쪽은 적대적 href를 막고 여기는 사용자가 직접 친 주소를 허용한다.
function isPrivateHost(host: string): boolean {
  // 후행 점은 DNS 루트 표기(`localhost.`)라 같은 호스트다. 안 떼면 아래 비교가 전부 빗나간다.
  const h = host.toLowerCase().replace(/\.$/, "");
  // `::1`을 따로 보지 않는다 — WHATWG URL의 hostname은 IPv6를 항상 대괄호 형태로 준다.
  if (h === "localhost" || h === "[::1]") return true;
  // IPv4-mapped IPv6(`::ffff:127.0.0.1`)은 URL이 `[::ffff:7f00:1]`로 직렬화하기도 한다.
  // 두 표기를 모두 환원하지 않으면 루프백이 공인으로 읽힌다.
  const mapped = /^\[::ffff:([0-9a-f.:]+)\]$/.exec(h);
  if (mapped) {
    const inner = mapped[1];
    if (inner.includes(".")) return isPrivateHost(inner);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(inner);
    if (hex) {
      const n = (Number.parseInt(hex[1], 16) << 16) | Number.parseInt(hex[2], 16);
      return isPrivateHost([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
    }
  }
  // IPv6 ULA(fc00::/7)·링크로컬(fe80::/10). 없으면 사내 IPv6 엔드포인트가 공인망으로 오판된다.
  if (/^\[(f[cd]|fe[89ab])[0-9a-f]*:/.test(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // 점이 없는 단일 호스트명은 사내 DNS 이름이다(tracker, gitlab 등).
  if (!h.includes(".") && !h.startsWith("[")) return true;

  const m = V4.exec(h);
  if (!m) return false;
  // 옥텟 범위를 다시 보지 않는다 — `new URL("http://256.1.1.1")`이 먼저 throw하므로
  // 여기까지 온 dotted-quad는 이미 유효하다(실측).
  const [a, b] = m.slice(1).map(Number);
  if (a === 127 || a === 10) return true;
  // 0.0.0.0/8 — 로컬 바인드 주소. 개발 서버가 흔히 이 주소로 뜬다.
  if (a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  // CGNAT 100.64/10 — 사내망·VPN이 실제로 쓴다. 100.128 이상은 공인이다.
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function normalizeWebhookUrl(input: string): WebhookUrlVerdict {
  const raw = input.trim();
  if (!raw) throw new WebhookUrlError("invalid");

  // 스킴이 없으면 https를 보정한다. 다른 스킴이 앞에 붙어 있으면 그대로 두고 아래에서 거른다.
  // `//`까지 봐야 한다 — `:`만 보면 `bugs.acme.io:8443`의 호스트가 스킴으로 읽혀, 포트를
  // 적은 정당한 주소가 scheme 거부로 떨어진다. `javascript:`·`data:`는 `//`가 없어 보정
  // 대상이 되지만 그 뒤 파싱에서 invalid로 걸린다.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

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
