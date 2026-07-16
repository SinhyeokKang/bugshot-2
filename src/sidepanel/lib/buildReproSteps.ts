import type { ActionLog, ActionEntry, ActionNode } from "@/types/action";

// OrderedListEditor가 value.split(/\r?\n/)로 한 줄=한 단계 렌더 → 출력은 개행 구분·번호 없음.
const MAX_STEPS = 15;

// 액션 로그를 사용자 노출용 재현 단계 텍스트로 압축. buildActionLogSummary(AI 프롬프트 참고용)와
// 출력 계약이 다르다 — 명령형·중립 서술. 필터 후 0줄이면 빈 문자열(호출부 스킵 신호).
export function buildReproSteps(log: ActionLog): string {
  const lines: string[] = [];
  let lastInputSelector: string | null = null;
  for (const e of log.entries) {
    const line = describe(e);
    if (line === null) {
      lastInputSelector = null;
      continue;
    }
    if (e.kind === "input" && e.selector && e.selector === lastInputSelector) {
      // 같은 selector 연속 입력은 마지막 값 한 줄로 dedup.
      lines[lines.length - 1] = line;
    } else if (lines.length > 0 && lines[lines.length - 1] === line) {
      // 연속 중복 줄 병합.
    } else {
      lines.push(line);
    }
    lastInputSelector = e.kind === "input" ? e.selector ?? null : null;
  }
  // 상한 초과 시 최근 단계 우선(시연 흐름의 끝이 재현에 더 유의).
  const capped = lines.length > MAX_STEPS ? lines.slice(-MAX_STEPS) : lines;
  return capped.join("\n");
}

function describe(e: ActionEntry): string | null {
  switch (e.kind) {
    case "navigation":
      if (e.navType === "load") return null; // 초기 로드는 사용자 이동이 아님.
      return `Go to ${e.toUrl ?? ""}`;
    case "input":
      return `Type "${e.value ?? ""}" in "${e.fieldLabel ?? ""}"`;
    case "toggle":
      return `Toggle "${e.fieldLabel ?? ""}"`;
    case "select":
      return `Select "${e.value ?? ""}" in "${e.fieldLabel ?? ""}"`;
    case "drag": {
      const src = nodeName(e.dragSource);
      return e.dragTarget ? `Drag ${src} to ${nodeName(e.dragTarget)}` : `Drag ${src}`;
    }
    case "click":
      if (!e.target && !e.selector) return null; // 대상 없는 클릭은 노이즈.
      return `Click "${e.target ?? e.selector ?? ""}"`;
    default:
      return null; // keypress 등 제외.
  }
}

function nodeName(node?: ActionNode): string {
  return node?.name?.trim() || node?.selector || "element";
}
