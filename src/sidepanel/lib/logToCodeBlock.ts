import type { NetworkRequest, NetworkRequestBody } from "@/types/network";
import type { ConsoleEntry } from "@/types/console";
import { networkLogPath } from "@/lib/network-log-path";
import { formatBytes } from "./formatBytes";

const MAX_CHARS = 16384;

export interface LogCodeBlock {
  text: string;
  language?: string;
}

function truncate(s: string): string {
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}…(truncated)` : s;
}

// tiptap-markdown은 코드블럭을 항상 3백틱으로 감싸고 본문을 escape하지 않는다 — 본문에 들여쓰기
// 0~3칸의 백틱 런이 있으면 fence가 거기서 닫혀 나머지가 이슈 본문으로 새고 8개 빌더 전부로 전파된다.
// 4칸 들여쓰면 닫힘 fence 조건(들여쓰기 ≤3)을 벗어나 본문으로 남는다.
function neutralizeFences(s: string): string {
  return s.replace(/^ {0,3}(`{3,})/gm, "    $1");
}

// 표시용 formatBody/bodyLabel(NetworkLogContent)과 공유하지 않는다 — 표시는 i18n 라벨·빈 문자열이
// 필요하지만 삽입은 코드블럭에 박히는 영문 고정 라벨이라 요구가 다르다.
function serializeBody(body: NetworkRequestBody): { text: string; json: boolean } {
  if (typeof body !== "string") {
    switch (body.kind) {
      case "truncated":
        return {
          text: `[truncated ${formatBytes(body.size)}/${formatBytes(body.limit)}]`,
          json: false,
        };
      case "binary":
        return { text: `[binary ${body.contentType} ${formatBytes(body.size)}]`, json: false };
      case "stream":
        return { text: `[stream ${body.contentType}]`, json: false };
      case "omitted":
        return { text: `[omitted: ${body.reason}]`, json: false };
    }
  }
  try {
    return { text: truncate(JSON.stringify(JSON.parse(body), null, 2)), json: true };
  } catch {
    return { text: truncate(body), json: false };
  }
}

function statusSuffix(req: NetworkRequest): string {
  if (req.phase === "pending") return " → (pending)";
  if (!req.status) return "";
  return req.statusText ? ` → ${req.status} ${req.statusText}` : ` → ${req.status}`;
}

export function serializeNetworkRequest(req: NetworkRequest): LogCodeBlock {
  // WS는 프레임 스트림이라 request/response body 개념이 없다 — 헤더 라인만.
  if (req.webSocket) {
    return { text: neutralizeFences(`WS ${networkLogPath(req.url)}${statusSuffix(req)}`) };
  }

  const lines = [`${req.method} ${networkLogPath(req.url)}${statusSuffix(req)}`];
  let json = false;

  for (const [label, body] of [
    ["payload", req.requestBody],
    ["response", req.responseBody],
  ] as const) {
    if (!body) continue;
    const out = serializeBody(body);
    json = json || out.json;
    lines.push(`--- ${label} ---`, out.text);
  }

  return { text: neutralizeFences(lines.join("\n")), language: json ? "json" : undefined };
}

export function serializeConsoleEntry(entry: ConsoleEntry): LogCodeBlock {
  // 로그 목록 확장 영역(ConsoleLogContent)이 보여주는 것과 같은 것을 같은 순서로 —
  // 메시지 → 스택 → 발생 페이지. 목록에서 보고 고른 걸 그대로 넣는 기능이라 화면과 결과가
  // 갈리면 안 된다. 스택은 **레벨 무관**하게 있으면 담는다(UI도 `entry.stack &&`로만 건다) —
  // console.warn도 스택을 갖고, 그게 경고의 출처라 버리면 목록에 보이던 게 사라진다.
  // pageUrl은 "어느 페이지에서 났나"라 이슈 받는 쪽에 필요하고, 캡처 시점에 이미 마스킹된 값이다.
  const lines = [`[${entry.level}] ${truncate(entry.args)}`];
  if (entry.stack) lines.push(truncate(entry.stack));
  if (entry.pageUrl) lines.push(truncate(entry.pageUrl));
  return { text: neutralizeFences(lines.join("\n")) };
}
