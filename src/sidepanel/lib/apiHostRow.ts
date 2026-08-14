import { getDomain } from "tldts";

import type { EnvironmentRow } from "@/types/environment";
import type { NetworkLog, NetworkRequest } from "@/types/network";
import type { CaptureMode } from "./buildCaptureFiles";
import { supportsConsoleNetworkLog } from "./captureLogSupport";

export const API_HOSTS_LABEL = "API Hosts";

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

export function registrableDomain(hostname: string): string {
  const host = normalizeHostname(hostname);
  if (host === "" || IPV4_RE.test(host) || host.startsWith("[")) return host;
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
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

// "로그가 아직 안 왔다"와 "로그가 없다"를 가른다. hydrate는 draft를 동기 복원하지만 networkLog는
// 뒤따르는 IDB promise로 오므로, 그 구간을 후자로 읽으면 복원된 행을 지웠다가 되살리게 된다.
export function isApiHostsUndetermined(input: {
  captureMode: CaptureMode;
  logsAttach: boolean;
  networkLog: NetworkLog | null;
}): boolean {
  return (
    supportsConsoleNetworkLog(input.captureMode) &&
    input.logsAttach &&
    input.networkLog === null
  );
}

// 제출 본문 조립 직전의 2차 방어 — 행 주입은 컴포넌트가 마운트돼 있을 때만 도는데,
// 본문 빌더는 environment를 게이트 없이 흘린다.
export function stripApiHostsRows(
  rows: readonly EnvironmentRow[],
  lastDerived: string | null,
): readonly EnvironmentRow[] {
  const isUnmodified = (row: EnvironmentRow): boolean =>
    row.source === "api-hosts" &&
    row.label === API_HOSTS_LABEL &&
    row.value === lastDerived;
  return rows.some(isUnmodified)
    ? rows.filter((r) => !isUnmodified(r))
    : rows;
}

// 제출 ctx 조립 경로의 게이트 — lib에 두는 이유는 위 apiHostRowFor와 같다.
// PreviewPanel(라이브 프리뷰·copy-markdown)은 아직 안 지난다: DraftingPanel의
// syncApiHostsRow가 행 자체를 지워서인데, 그건 그 패널의 로그 카드가 readOnly인 동안만 성립한다.
// lastDerived의 undefined는 여기서만 null로 흡수한다 — 구 draft의 "판정 재료 없음"이
// stripApiHostsRows에 그대로 전달돼 no-op가 되어야 한다.
export function environmentForSubmit(input: {
  captureMode: CaptureMode | undefined;
  logsAttach: boolean;
  rows: readonly EnvironmentRow[] | undefined;
  lastDerived: string | null | undefined;
}): EnvironmentRow[] {
  const rows = input.rows ?? [];
  if (supportsConsoleNetworkLog(input.captureMode) && input.logsAttach) return [...rows];
  return [...stripApiHostsRows(rows, input.lastDerived ?? null)];
}

// 자동 행 동기화 판정. 변화가 없으면 입력 rows 참조를 그대로 돌려주고, 호출부는 그때 write를
// 생략한다 — setDraft가 전체 교체라 무조건 write하면 draft identity가 매번 바뀌어 루프가 된다.
// dismissed는 삭제 버튼 핸들러 말고 아래 promoteEditedRow()도 세운다 — 사용자가 파생 행을 고치면
// 그 행은 손으로 쓴 행이 되고, 파생이 다시 덮으면 "고칠 수 있다"가 깨지기 때문.
export function syncApiHostsRow(input: {
  rows: readonly EnvironmentRow[];
  apiRow: EnvironmentRow | null;
  dismissed: boolean;
  lastDerived: string | null;
}): {
  rows: readonly EnvironmentRow[];
  lastDerived: string | null;
  dismissed: boolean;
} {
  const { rows, apiRow, dismissed, lastDerived } = input;
  const idx = rows.findIndex((r) => r.source === "api-hosts");
  const promoteEditedRow = (): {
    rows: readonly EnvironmentRow[];
    lastDerived: null;
    dismissed: true;
  } => {
    const next = [...rows];
    next[idx] = { label: next[idx].label, value: next[idx].value };
    return { rows: next, lastDerived: null, dismissed: true };
  };

  if (!apiRow) {
    if (idx === -1) return { rows, lastDerived: null, dismissed };
    // 사용자가 타이핑한 문자열은 파생 부재로 지우지 않는다 — 로그 첨부 off든 hydrate 지연이든
    // 무관한 컨트롤 하나로 손으로 쓴 값이 사라지면 목표 2가 깨진다.
    if (rows[idx].label !== API_HOSTS_LABEL || rows[idx].value !== lastDerived) {
      return promoteEditedRow();
    }
    return { rows: rows.filter((_, i) => i !== idx), lastDerived: null, dismissed };
  }

  if (idx === -1) {
    if (dismissed) return { rows, lastDerived, dismissed };
    return { rows: [...rows, apiRow], lastDerived: apiRow.value, dismissed };
  }

  // 사용자가 고친 행은 파생 결과로 덮지 않는다 — 고친 값이 되돌아오면 "고칠 수 있다"가 깨진다.
  if (rows[idx].label !== API_HOSTS_LABEL || rows[idx].value !== lastDerived) {
    return promoteEditedRow();
  }
  if (rows[idx].value === apiRow.value) return { rows, lastDerived, dismissed };

  const next = [...rows];
  next[idx] = { ...next[idx], value: apiRow.value };
  return { rows: next, lastDerived: apiRow.value, dismissed };
}
