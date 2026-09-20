// Tailwind JIT 정적 추출을 위해 full class 문자열을 매핑.
const TABS_GRID_COLS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

// 이 위로는 셀을 더 쪼개도 트리거의 아이콘+패딩이 안 줄어 잘린다 → 가로 스크롤로 간다.
// 폭이 아니라 개수로 가르는 건, 폭으로 갈랐다면 패널을 드래그하는 동안 탭 줄 모양이 오가기
// 때문이다. 그래서 넓은 패널에서도 접는다. 뒤집으면 8이 안전선이라는 뜻은 아니다 —
// 최소 폭 패널에선 8등분도 이미 넘친다(선행 증상, 여기서 안 건드린다).
export const SUBMIT_TABS_GRID_MAX = 8;

export type SubmitTabsLayout = {
  wrapperClass: string;
  listClass: string;
  triggerClass: string;
  forceCollapsed: boolean;
};

export function submitTabsLayout(count: number): SubmitTabsLayout {
  if (count > SUBMIT_TABS_GRID_MAX) {
    return {
      // overflow-x-auto는 overflow-y도 auto로 만든다 — 세로 여유가 없으면 트리거의 포커스
      // 링이 잘린다. -my-1/py-1이 그 여유를 만들고 상쇄한다(선례 IssueListTab).
      wrapperClass: "-my-1 overflow-x-auto py-1",
      // 래퍼가 스크롤을 맡으므로 pill은 자연 폭(TabsList 기본 inline-flex)으로 두되,
      // 패널을 넓히면 좌측 덩어리로 남으므로 min-w-full로 바닥을 깐다. w-full·flex로 고정하면
      // TabsList 기본 justify-center가 넘친 트리거를 양쪽으로 밀어 왼쪽 탭에 도달할 수 없다.
      listClass: "h-9 min-w-full",
      triggerClass: "shrink-0 gap-1.5",
      forceCollapsed: true,
    };
  }
  return {
    // 스크롤 컨테이너를 그리드 경로까지 씌우면 좁은 패널에서 없던 가로 스크롤바가 생긴다.
    wrapperClass: "",
    listClass: `grid h-9 w-full ${TABS_GRID_COLS[count] ?? "grid-cols-2"}`,
    triggerClass: "min-w-0 gap-1.5",
    forceCollapsed: false,
  };
}
