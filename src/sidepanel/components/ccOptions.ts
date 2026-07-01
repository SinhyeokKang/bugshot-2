export interface CcUserOption {
  key: string;
  label: string;
  email?: string;
  avatarUrl?: string;
}

// 선택된 유저를 목록 최상단으로 고정한다 (복수 참조 시 제거 편의).
// - 순서: selected가 준 순서. 상단 표시는 options의 리치 데이터(email/avatar)를 우선 사용,
//   현재 검색 결과에 없으면 selected 항목 자체로 노출(제거 항상 가능).
// - 하단은 미선택 options를 원래 순서대로. 중복 없음.
export function pinSelectedFirst(
  options: CcUserOption[],
  selected: CcUserOption[],
): CcUserOption[] {
  if (selected.length === 0) return options;
  const selectedKeys = new Set(selected.map((s) => s.key));
  const head = selected.map(
    (s) => options.find((o) => o.key === s.key) ?? s,
  );
  const tail = options.filter((o) => !selectedKeys.has(o.key));
  return [...head, ...tail];
}

// 이미 목록 안에 있는 선택 항목을 상단으로 올린다 (단일선택 담당자용 — 원본 객체 렌더 유지).
export function orderSelectedFirst<T>(
  items: T[],
  isSelected: (item: T) => boolean,
): T[] {
  const selected = items.filter(isSelected);
  if (selected.length === 0) return items;
  const rest = items.filter((item) => !isSelected(item));
  return [...selected, ...rest];
}
