export interface HrAfterBreakContext {
  /** 매칭된 `---` 바로 앞 노드의 타입 이름 (없으면 null) */
  nodeBeforeTypeName: string | null;
}

/**
 * 문단 내에서 Shift+Enter(hardBreak)로 줄만 바꾼 뒤 `---`를 친 경우인지.
 * 이때만 수평선으로 변환한다. StarterKit 기본 규칙(`^---$`)은 블록 맨 앞만
 * 처리하므로 hardBreak 뒤 `---`는 발동하지 않던 사각지대를 채운다.
 * 텍스트 바로 뒤(`abc---`)나 대시 4개 이상(`----`)은 앞 노드가 hardBreak가
 * 아니므로 대상이 아니다.
 */
export function shouldInsertHrAfterBreak(ctx: HrAfterBreakContext): boolean {
  return ctx.nodeBeforeTypeName === "hardBreak";
}
