import type { NetworkRequest } from "@/types/network";
import type { ConsoleEntry } from "@/types/console";
import {
  findCandidate,
  type LogCandidateKind,
  type LogCandidates,
} from "./prompts/logCandidates";
import {
  serializeConsoleEntry,
  serializeNetworkRequest,
  type LogCodeBlock,
} from "./logToCodeBlock";
import { extractCodeBlocks } from "./markdownBlocks";

// 상한이자 "나열해버림" 임계값. 근거 없는 임의값 — 조정 신호는 실사용에서 안 쌓이고
// (초과 폐기와 후보 없음이 화면상 동일 + warn은 로컬 전용) dogfooding만이 트리거다.
export const MAX_LOG_REFS = 3;

export interface LogRefSource {
  // 프롬프트에 인쇄된 집합 — 요약을 직접 넘기면 안 된다. 위조된 [n2] 텍스트는 후보를
  // 만들 수 없고, 미지 ref는 여기 역참조에서 걸러진다(이게 방어선이다 — oneLine이 아니라).
  candidates: LogCandidates;
  // 요약을 만든 것과 같은 store 스냅샷 (await 이전에 잡은 것).
  requests: NetworkRequest[];
  entries: ConsoleEntry[];
}

export function renderLogRefBlocks(
  refs: string[],
  src: LogRefSource,
): LogCodeBlock[] {
  const seen = new Set<string>();
  const resolved: { id: string; kind: LogCandidateKind }[] = [];
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    const found = findCandidate(src.candidates, ref);
    if (!found) continue;
    seen.add(ref);
    resolved.push(found);
  }

  if (resolved.length > MAX_LOG_REFS) {
    console.warn(
      `[bugshot] AI draft returned ${resolved.length} log refs (max ${MAX_LOG_REFS}) — dropped all`,
    );
    return [];
  }

  const blocks: LogCodeBlock[] = [];
  for (const { id, kind } of resolved) {
    if (kind === "network") {
      const req = src.requests.find((r) => r.id === id);
      if (req) blocks.push(serializeNetworkRequest(req));
    } else {
      const entry = src.entries.find((e) => e.id === id);
      if (entry) blocks.push(serializeConsoleEntry(entry));
    }
  }
  return blocks;
}

export function codeBlockMarkdown(block: LogCodeBlock): string {
  return `\`\`\`${block.language ?? ""}\n${block.text}\n\`\`\``;
}

// fence 문자열이 아니라 내부 텍스트로 비교한다 — 기존 블록은 Tiptap 왕복을 거쳐 fence
// 생성 주체가 다르므로, 전체 문자열 비교는 유닛만 green이고 실제 패널에서 블록이 는다.
function innerText(fenced: string): string {
  const lines = fenced.split("\n");
  return lines.slice(1, -1).join("\n");
}

// 섹션 끝에 블록 추가. 섹션에 이미 같은 텍스트의 블록이 있으면 그 블록은 건너뛴다
// (재생성 시 누적 중복 방어 — 직렬화가 결정론적이라 같은 로그 → 같은 텍스트).
export function appendLogBlocks(
  section: string,
  blocks: LogCodeBlock[],
): string {
  let out = section;
  let existing = extractCodeBlocks(section).map(innerText);
  for (const block of blocks) {
    if (existing.includes(block.text)) continue;
    out = out ? `${out}\n\n${codeBlockMarkdown(block)}` : codeBlockMarkdown(block);
    existing = [...existing, block.text];
  }
  return out;
}
