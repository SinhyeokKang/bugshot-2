// cross-origin 스타일 보강(css.fetchSheets)에서 background가 페이지 제어 href를
// fetch하기 전 통과시키는 SSRF 가드. http(s) 공개 origin만 허용하고
// loopback·link-local·사설 IP·비-http 스킴을 차단해 내부망/클라우드 메타데이터
// 엔드포인트(169.254.169.254 등) 노출을 막는다.
export function isFetchableSheetUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return !isBlockedHost(u.hostname);
}

function isBlockedHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1); // FQDN 후행 점 (localhost. / 127.0.0.1.)
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.startsWith("[") && host.endsWith("]")) {
    return isBlockedIpv6(host.slice(1, -1));
  }
  const v4 = parseIpv4(host);
  if (v4) return isBlockedIpv4(v4);
  // 일반 도메인은 DNS 단계라 정적 판정 범위 밖 — 허용. (잔여 위험: fetch가 DNS를 재해석하므로
  // 내부 IP로 rebinding되는 도메인은 못 막음. redirect:"manual"+credentials 미포함으로 영향 완화.)
  return false;
}

type Ipv4 = [number, number, number, number];

function parseIpv4(host: string): Ipv4 | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((n) => n > 255)) return null;
  return parts as Ipv4;
}

function isBlockedIpv4([a, b]: Ipv4): boolean {
  if (a === 0) return true; // 0.0.0.0/8 unspecified
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

function isBlockedIpv6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a === "::1" || a === "::") return true; // loopback / unspecified
  if (/^fe[89ab]/.test(a)) return true; // link-local fe80::/10
  if (/^f[cd]/.test(a)) return true; // ULA fc00::/7
  const mapped = mappedIpv4(a); // ::ffff:a.b.c.d (dotted) 또는 ::ffff:HHHH:HHHH (hex)
  if (mapped) return isBlockedIpv4(mapped);
  return false;
}

// IPv4-mapped IPv6. WHATWG URL은 `[::ffff:127.0.0.1]`를 hex hextet 형태
// `::ffff:7f00:1`로 직렬화하므로 dotted·hex 두 표기를 모두 v4로 환원해야 우회를 막는다.
function mappedIpv4(a: string): Ipv4 | null {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(a);
  if (dotted) return parseIpv4(dotted[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  }
  return null;
}
