export interface ListBackspaceContext {
  /** 선택 영역이 비어있는지 (커서만 있는 상태) */
  selectionEmpty: boolean;
  /** 커서의 부모(텍스트블록) 내 오프셋 */
  parentOffset: number;
  /** 부모 텍스트블록의 콘텐츠 크기 (0이면 빈 항목) */
  parentContentSize: number;
  /** 커서 위치의 depth */
  parentDepth: number;
  /** 부모의 부모 노드 타입 이름 (list item이면 "listItem") */
  grandParentTypeName: string | null;
}

/**
 * 빈 list item 시작에 커서가 있어 Backspace로 리스트를 빠져나가야 하는지.
 * 내용이 있는 항목이나 항목 중간 커서에서는 기본 Backspace 동작을 유지한다.
 */
export function shouldLiftListItem(ctx: ListBackspaceContext): boolean {
  return (
    ctx.selectionEmpty &&
    ctx.parentOffset === 0 &&
    ctx.parentContentSize === 0 &&
    ctx.parentDepth >= 1 &&
    ctx.grandParentTypeName === "listItem"
  );
}
