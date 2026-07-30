import type { CaptureMode } from "./buildCaptureFiles";
import type { EnvironmentRow } from "@/types/environment";
import type { NetworkLog, NetworkRequest } from "@/types/network";
import { supportsConsoleNetworkLog } from "./captureLogSupport";

export const API_HOSTS_LABEL = "API Hosts";

// 마지막 2레이블을 registrable domain으로 보되, 여기 걸리면 3레이블.
// public suffix list 전량을 번들하지 않는 근사 — 미등재 다단 접미사(github.io 등)는 서로 다른
// 주체의 도메인을 동족으로 과대포함한다. 사용자가 행을 고칠 수 있다는 것이 그 대가의 완화책.
const TWO_LEVEL_SUFFIXES: ReadonlySet<string> = new Set([
  "co.kr", "or.kr", "ne.kr", "co.jp", "ne.jp", "or.jp", "co.uk", "org.uk",
  "com.au", "com.br", "com.cn", "com.tw", "com.hk", "com.sg", "co.in",
  "co.nz", "co.za", "com.mx", "com.tr",
]);

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

export function registrableDomain(hostname: string): string {
  const host = normalizeHostname(hostname);
  if (host === "" || IPV4_RE.test(host) || host.startsWith("[")) return host;

  const labels = host.split(".");
  if (labels.length <= 2) return host;

  const lastTwo = labels.slice(-2).join(".");
  const take = TWO_LEVEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join(".");
}

function httpHostname(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return normalizeHostname(parsed.hostname);
}

// 페이지와 같은 registrable domain을 쓰는 다른 hostname을 요청 수 내림차순으로 나열한다.
// scheme·port·path·query는 버리고 hostname만 남겨 노출 면적을 좁힌다.
export function deriveApiHostsRow(
  requests: readonly Pick<NetworkRequest, "url">[],
  pageUrl: string | undefined,
): EnvironmentRow | null {
  if (!pageUrl) return null;
  const pageHostname = httpHostname(pageUrl);
  if (pageHostname === null) return null;
  const pageDomain = registrableDomain(pageHostname);

  const counts = new Map<string, number>();
  for (const req of requests) {
    const hostname = httpHostname(req.url);
    if (hostname === null || hostname === pageHostname) continue;
    if (registrableDomain(hostname) !== pageDomain) continue;
    counts.set(hostname, (counts.get(hostname) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  // Map은 삽입 순서를 보존하므로 동률이면 먼저 등장한 hostname이 앞에 남는다.
  const hostnames = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hostname]) => hostname);

  return { label: API_HOSTS_LABEL, value: hostnames.join(", "), source: "api-hosts" };
}

// 게이트 + 파생의 단일 진입점. 게이트를 컴포넌트가 아니라 여기 두는 이유는 DraftingPanel에
// 테스트 파일이 없어 element 누출·logsAttach 무시가 전부 green으로 통과하기 때문이다.
export function apiHostRowFor(input: {
  captureMode: CaptureMode;
  logsAttach: boolean;
  networkLog: NetworkLog | null;
  pageUrl: string | undefined;
}): EnvironmentRow | null {
  if (!supportsConsoleNetworkLog(input.captureMode)) return null;
  if (!input.logsAttach || !input.networkLog) return null;
  return deriveApiHostsRow(input.networkLog.requests, input.pageUrl);
}

// 자동 행 동기화 판정. 변화가 없으면 입력 rows 참조를 그대로 돌려주고, 호출부는 그때 write를
// 생략한다 — setDraft가 전체 교체라 무조건 write하면 draft identity가 매번 바뀌어 루프가 된다.
// dismissed 전이는 여기서 하지 않는다(삭제 버튼 핸들러가 직접 세운다).
export function syncApiHostsRow(input: {
  rows: readonly EnvironmentRow[];
  apiRow: EnvironmentRow | null;
  dismissed: boolean;
  lastDerived: string | null;
}): { rows: readonly EnvironmentRow[]; lastDerived: string | null } {
  const { rows, apiRow, dismissed, lastDerived } = input;
  const idx = rows.findIndex((r) => r.source === "api-hosts");

  if (!apiRow) {
    if (idx === -1) return { rows, lastDerived: null };
    return { rows: rows.filter((_, i) => i !== idx), lastDerived: null };
  }

  if (idx === -1) {
    if (dismissed) return { rows, lastDerived };
    return { rows: [...rows, apiRow], lastDerived: apiRow.value };
  }

  // 사용자가 고친 행은 파생 결과로 덮지 않는다 — 고친 값이 되돌아오면 "고칠 수 있다"가 깨진다.
  if (rows[idx].value !== lastDerived) return { rows, lastDerived };
  if (rows[idx].value === apiRow.value) return { rows, lastDerived };

  const next = [...rows];
  next[idx] = { ...next[idx], value: apiRow.value };
  return { rows: next, lastDerived: apiRow.value };
}
