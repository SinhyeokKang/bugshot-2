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

// 400px 패널의 탭 그리드 가용 폭은 304px인데 트리거 최소폭은 아이콘 14px + px-3 24px = 38px다.
// 9등분하면 33.8px라 grid-cols-9를 더해도 아이콘이 잘린다 → 그 위부터는 가로 스크롤로 간다.
// 판정은 폭이 아니라 개수다. 패널을 넓히면(다이얼로그 상한 800px) 9탭이 라벨째 들어가지만
// 그때도 접는다 — 폭으로 갈랐다면 드래그 중에 탭 줄 모양이 오간다.
// 뒤집으면 이 상수는 "8까지는 안전하다"를 보장하지 않는다: 패널 최소 폭 320px에선 8등분도
// 29px라 이미 넘친다. 그건 이 픽스 이전부터 있던 증상이라 여기서 건드리지 않는다.
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
      // 링이 잘린다(선례 IssueListTab.tsx:112). -my-1/py-1이 그 4px을 만들고 상쇄한다.
      wrapperClass: "-my-1 overflow-x-auto py-1",
      // 래퍼가 스크롤을 맡으므로 pill은 자연 폭(TabsList 기본 inline-flex)으로 두되,
      // 패널을 넓히면 좌측 덩어리로 남으므로 min-w-full로 바닥을 깐다. w-full·flex로 고정하면
      // TabsList 기본 justify-center가 넘친 트리거를 양쪽으로 밀어 왼쪽 탭에 도달할 수 없다.
      listClass: "h-9 min-w-full",
      triggerClass: "shrink-0 gap-1.5",
      forceCollapsed: true,
    };
  }
  // 그리드 경로는 래퍼가 빈 문자열이라 이 픽스 이전과 렌더 결과가 같다. 스크롤 컨테이너를
  // 여기까지 씌우면 좁은 패널에서 없던 가로 스크롤바가 생겨 "회귀 없음"이 깨진다.
  return {
    wrapperClass: "",
    listClass: `grid h-9 w-full ${TABS_GRID_COLS[count] ?? "grid-cols-2"}`,
    triggerClass: "min-w-0 gap-1.5",
    forceCollapsed: false,
  };
}
