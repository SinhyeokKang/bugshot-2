# Log Viewer 통합 타임라인 패널 — 기술 설계

## 개요

log-viewer 좌측 패널(현재 영상/이미지 단일)을 **세로 리사이저블 2분할**로 바꿔 하단에 병합 타임라인 패널을 넣는다. 병합은 3종 로그(`ConsoleLog`/`NetworkLog`/`ActionLog`)를 절대 ms로 정렬하는 **순수 함수 `buildTimeline`** 하나가 담당하고, 렌더는 기존 로그 행 프리미티브(`LogSeekChip`·`formatRelativeTime`·타입별 아이콘·면색·`log-colors`)를 재사용하는 신규 경량 컴포넌트가 맡는다. 영상 playhead는 **App state로 올리지 않는다** — `VideoPlayer`의 `onTimeUpdate` 콜백을 ref 중계로 `TimelinePanel` 내부 state에 직결해, 초당 ~4회의 timeupdate 리렌더를 타임라인 서브트리에 격리한다(우측 탭 무영향). Timeline은 **영상이 있을 때만**(`video && !videoError`) 렌더된다.

리포트 파일의 AI 소비 표면(`__BUGSHOT_AI__` 매뉴얼·`__BUGSHOT_DATA__` 임베드 — `buildLogsHtml.ts`)은 무변경 — Timeline은 이미 임베드된 3종 로그의 런타임 뷰라 AI readability에 영향이 없다.

## 변경 범위

### 신규 파일

- **`src/log-viewer/timeline-merge.ts`** — `TimelineItem` 판별 유니온 + `buildTimeline()` 순수 함수 + `matchesTimelineItem()`(타입 필터·검색 매칭) + `timelineFillClass()`(면색 — 기존 배경색 함수에 위임). 부수효과·DOM 없음(node 테스트 대상). 스크러버용 `markers.ts`(`TimelineMarker`, `positionPct`·`labelParts`)와 **별개** — 이쪽은 원본 엔트리를 참조하는 리스트 아이템.
- **`src/log-viewer/components/TimelinePanel.tsx`** — 병합 리스트 컨테이너. 상단 컴팩트 바(타입 토글 3개 + 검색 인풋), 스크롤·active 계산·자동 스크롤(수동 스크롤 가드), 빈 상태(로그 0건/필터 결과 0건) 담당. playhead는 `setTimeListener` 등록으로 **내부 state(`currentAbsMs`)** 구독.
- **`src/log-viewer/components/TimelineRow.tsx`** — 1행 렌더. 카테고리별 아이콘/토큰/텍스트/우측메타 + 스파인 레일 + 면색 + console chevron 확장. **`React.memo`로 감싼다** — active 전이 시 이전/현재 2행만 재렌더(아래 위험 요소).

### 변경 파일

- **`src/log-viewer/components/VideoPlayer.tsx`**
  - 현재 역할: 영상 재생 + 스크러버 마커. `currentTimeSec`가 내부 state(외부 미노출).
  - 변경: `VideoPlayerProps`에 `onTimeUpdate?: (sec: number) => void` 추가. 기존 `handleTimeUpdate`(55행 `setCurrentTimeSec(el.currentTime)`) 안에서 콜백 호출. `VideoPlayerHandle`은 그대로(seek 전용).

- **`src/log-viewer/App.tsx`**
  - 현재 역할: 좌(영상/이미지 60) / 우(탭 40) 가로 분할 오케스트레이션.
  - 변경:
    - `timelineItems = useMemo(() => buildTimeline(data.consoleLog, data.networkLog, data.actionLog), [...])`.
    - playhead ref 중계: `const timeListener = useRef<((sec: number) => void) | null>(null)`. `VideoPlayer onTimeUpdate`에는 안정 콜백(`useCallback((sec) => timeListener.current?.(sec), [])`)을, `TimelinePanel`에는 등록 함수(`setTimeListener`)를 전달. **App엔 시간 state가 없다** — timeupdate 리렌더는 TimelinePanel 내부로 격리.
    - 좌측 `ResizablePanel`의 **video 브랜치**(264행)를 `ResizablePanelGroup direction="vertical"`로 감싸: 상단 `VideoPlayer`, 하단 `TimelinePanel`. 세로 `ResizableHandle`은 기존 가로 핸들의 blue hover 커스텀(293행)을 shadow 축만 바꿔 미러링. **screenshot 브랜치·`if (!video && !screenshot)` early return(260행)은 손대지 않음** → Timeline은 영상일 때만.
    - `TimelinePanel`에 `onSeek={seekTo}`(기존 76행 선언 재사용), `onOpenNetworkDetail={(id) => { setActiveTab("network"); setScrollToEntryId(id); }}` 배선 — **기존 마커 클릭(`handleMarkerClick`, 92행)과 동일 경로 재사용**. `NetworkLogContent`는 `useScrollToEntry`의 `onFound`에서 `setActiveId`로 선택까지 수행하고, 필터에 걸려 행이 안 보이면 `resetFilters()` 보정도 내장(`useScrollToEntry.ts:27-31`) — **우측 컴포넌트 무변경**.

- **`src/sidepanel/components/*` 프리미티브 export** — 로직 이동 없이 export만(기존 동작 불변):
  - `ConsoleLogContent.tsx`: `LevelIcon`, `levelBgColor`
  - `NetworkLogContent.tsx`: `isError`, `isPending`, `methodColor`, content-type 아이콘. `rowBg`는 hover·선택 변형이 구워진 함수라 그대로 위임 불가 — **base 틴트 함수를 분리 export**해 기존 `rowBg` 합성부와 `timelineFillClass`가 공유(단일 출처).
  - `ActionLogContent.tsx`: `KindIcon`, `renderActionContent`, `searchText`(검색 매칭용)

- **`src/log-viewer/i18n.ts`**
  - 변경: `koDict`/`enDict`에 Timeline 전용 키 추가 — `timeline.detail`("상세"/"Detail"), `timeline.empty`(로그 0건 — **필수**), `timeline.searchPlaceholder`, `timeline.filterEmpty`(필터·검색 결과 0건). 타입 토글 라벨은 기존 탭 라벨 키가 있으면 재사용, 없으면 `timeline.*` 신설. action 행 텍스트는 재사용하는 `renderActionContent`가 기존 i18n 경로로 해결하므로 **추가 없음**. `src/log-viewer/__tests__/i18n.test.ts`가 ko/en 대칭·placeholder를 검증하므로 양쪽 동시 갱신.

### 재사용 프리미티브 (신규 로직 최소화)

- `src/sidepanel/components/LogSeekChip.tsx`: `LogSeekChip` — **이미 export**, 사이드패널 전용 의존 없음. M:SS 텍스트는 호출부가 `formatRelativeTime`으로 만들어 넘기는 계약.
- `src/sidepanel/lib/logRow.ts`: `formatRelativeTime` (파일 확장자는 `.ts`).
- `src/sidepanel/components/LinkifiedText.tsx`: **이미 독립 export 모듈** — export 작업 불필요.
- `@/lib/log-colors`: `consoleLevelTextClass`, `networkMethodTextClass`(토큰 텍스트 색).
- `@/lib/network-search`: `requestMatchesQuery` — **이미 export**, network 행 검색 매칭 재사용.
- 위 "변경 파일"의 프리미티브 export 목록 — 로직 이동 아님, export만.

## 데이터 흐름

```
data.{consoleLog,networkLog,actionLog}
        │  buildTimeline(순수)  → 절대 ms 정렬 + 타입 타이브레이크
        ▼
   TimelineItem[]  ──────────────► TimelinePanel
                                     │  타입 토글·검색 → matchesTimelineItem 필터
   VideoPlayer.onTimeUpdate          │  currentAbsMs = startedAt + sec*1000 (패널 내부 state)
     └─(App ref 중계, state 없음)────┘        │ findActiveIndex(absTs[], currentAbsMs) → activeIdx
                                              ▼
                                   TimelineRow[i] (active면 스파인 primary + scrollIntoView)
   행 클릭 ─► onSeek(absTs) ─► playerRef.seekToSec(toVideoSeconds)   (기존 seekTo 경로)
   network "상세" ─► onOpenNetworkDetail(id) ─► setActiveTab("network") + setScrollToEntryId(id)
                                                          ▼
                              NetworkLogContent useScrollToEntry (스크롤 + onFound 선택 + 필터 보정 — 무변경)
```

## 인터페이스 설계

```ts
// src/log-viewer/timeline-merge.ts
import type { ConsoleLog, ConsoleEntry } from "@/types/console";
import type { NetworkLog, NetworkRequest } from "@/types/network";
import type { ActionLog, ActionEntry } from "@/types/action";

export type TimelineItem =
  | { kind: "action"; id: string; absTs: number; entry: ActionEntry }
  | { kind: "console"; id: string; absTs: number; entry: ConsoleEntry }
  | { kind: "network"; id: string; absTs: number; req: NetworkRequest };

// 3종 flatten → absTs 오름차순 안정 정렬. 동일 absTs는 kind 우선순위(action<network<console)로 타이브레이크.
export function buildTimeline(
  consoleLog: ConsoleLog | null,
  networkLog: NetworkLog | null,
  actionLog: ActionLog | null,
): TimelineItem[];

// 타입 토글 + 검색 매칭. query: console=entry.args includes / network=requestMatchesQuery(req, query) / action=searchText(entry) includes.
export function matchesTimelineItem(
  item: TimelineItem,
  kinds: ReadonlySet<TimelineItem["kind"]>,
  query: string,
): boolean;

// 면색 — 기존 배경색 함수 위임(단일 출처, 우측 탭과 완전 sync).
// console=levelBgColor(entry.level) — info blue 틴트 포함. network=rowBg base 틴트(isError/isPending 분기). action="".
export function timelineFillClass(item: TimelineItem): string;
```

```ts
// TimelinePanel props
interface TimelinePanelProps {
  items: TimelineItem[];
  videoStartedAt: number;               // LogSeekChip base + toVideoSeconds base
  setTimeListener: (fn: ((sec: number) => void) | null) => void; // playhead 구독 등록(ref 중계)
  onSeek: (absTs: number) => void;      // 행 클릭
  onOpenNetworkDetail: (id: string) => void; // App: setActiveTab("network") + setScrollToEntryId(id)
}

// VideoPlayer 추가 prop
onTimeUpdate?: (sec: number) => void;
```

**행 골격** (TimelineRow):
`[스파인 border-l] [LogSeekChip M:SS] [카테고리 아이콘] [토큰] [주 텍스트] [우측 메타]`
- 토큰 문법: action=소문자 동사(칩 없음) / network=`METHOD·status` 컬러칩(`methodColor`·status 색) / console=**토큰 없음** — 레벨은 기존 탭과 동일하게 `LevelIcon` + 면색으로만 표현(텍스트 배지 도입 안 함 — 좌우 패널 문법 통일)
- 스파인: 모든 행 `border-l-2`, active `border-l-primary`(우측 탭 재생 동기 `syncRowClass`의 primary와 동일 색 문법) / 그 외 `border-l-muted`. 기존 탭 비active 행은 `border-l-transparent`지만 Timeline은 상시 muted 레일 — 시간축 시각화 의도(의도된 차이).
- 면색: `timelineFillClass(item)` — 우측 탭 배경색 함수 위임
- console 에러/경고: chevron → `entry.stack` 인라인 확장(ConsoleLogContent expand 패턴 준용)
- network: 우측 메타 옆 "상세" 링크 → `onOpenNetworkDetail(req.id)`. 텍스트가 작으므로 패딩으로 최소 히트 영역 확보.
- 행 전체 = `<button>`(row 시맨틱이 필요하면 `role="button"` + `tabIndex`) — 클릭/Enter=`onSeek(absTs)`. chevron·"상세"는 별도 포커스 스톱 + `stopPropagation`. active 행에 `aria-current="true"`.

## 기존 패턴 준수

- **순수 함수 분리 + node 테스트**: `buildTimeline`/`matchesTimelineItem`/`timelineFillClass`는 `timeline.ts`(findActiveIndex 등)와 같은 결의 순수 모듈 → `__tests__/*.test.ts`.
- **면색/토큰 색 단일 출처**: 텍스트·아이콘 색은 `log-colors.ts`, 면색은 기존 컴포넌트의 배경색 함수(`levelBgColor`·`rowBg` base 틴트)를 export해 **함수 위임** — 값 복제 없음, 발산 원천 차단(DESIGN.md §2·§로그 semantic 색).
- **채널 직교(DESIGN 선례)**: status=면색 / active=스파인 레일(muted↔primary). `ConsoleLogContent` "선택은 배경 아니라 ring(레벨 틴트·sync 하이라이트와 경합)" 주석과 동일 원칙 — active를 배경으로 표현하지 않는다. active 색은 우측 탭 sync 문법(primary)과 통일.
- **log-viewer 복제 사전**: 신규 문자열은 `src/log-viewer/i18n.ts` koDict/enDict 양쪽 + 대칭 테스트.
- **최소 설계·외과적 변경**: 우측 4탭·screenshot·노미디어 경로 무변경. 프리미티브는 이동이 아니라 export만. network "상세"는 기존 경로 재사용으로 우측 컴포넌트 무변경.

## 대안 검토

1. **markers.ts의 `TimelineMarker` 재사용** — 스크러버 마커용이라 `positionPct`·`labelParts`(툴팁 조각) 중심이고 원본 엔트리 참조가 없다. 리스트 행은 seek·확장·"상세" 라우팅에 원본 엔트리가 필요 → 별도 `TimelineItem` 유니온 채택.
2. **기존 `ConsoleLogContent`/`NetworkLogContent`/`ActionLogContent` 행 컴포넌트를 그대로 병합 렌더** — 마스터-디테일·collapsible·검색 무게를 지고 있어 고밀도 타임라인엔 과함. 경량 `TimelineRow` 신규 + 프리미티브만 재사용으로 결정(사용자 확정).
3. **active를 배경(`bg-accent`)으로 강조** — 면색(status)과 경합. 스파인 레일(muted→primary)로 직교 분리.
4. **screenshot에도 정적 병합 리스트 노출** — 시간 앵커·seek 대상이 없어 가치 낮고 우측 탭과 중복. 영상 게이트로 미노출.
5. **playhead를 App state로 lift-up** — 기각. 우측 탭 JSX는 App 본문 인라인 변수라 매 렌더 통째 재생성되고, `sync`/`scrollProps`가 매 렌더 새 객체라 memo도 무력 — 최대 5000행 network 탭이 초당 4회 리렌더된다. ref 중계로 타임라인 서브트리에 격리(채택).
6. **NetworkLogContent `selectedId` prop 신설** — 기각. "Console `selectedId` 선례"는 삽입 다이얼로그 전용 ring 표시라 선례가 아니며, useEffect 양방향 동기화는 탭 재마운트 소실·재클릭 토글 부활·필터 미보정 함정을 안는다. 기존 `scrollToEntryId` → `useScrollToEntry` 경로가 탭 전환+스크롤+선택+필터 보정을 이미 수행 — 재사용(채택)으로 우측 컴포넌트 무변경.
7. **console ERROR/WARN 텍스트 배지** — 기각. 기존 console 탭에 배지 문법이 없어 좌우 패널이 같은 로그를 다른 문법으로 그리게 됨. `LevelIcon`+면색으로 통일.

## 위험 요소

- **playhead 리렌더 격리**: ref 중계(위 인터페이스)로 timeupdate 리렌더를 TimelinePanel 내부로 한정. `TimelineRow`는 `React.memo` — active 전이 시 이전/현재 2행만 재렌더되는 구조를 유지할 것(`isActive` 외 props 참조 안정 필수).
- **병합 리스트 규모**: cap 합산 worst-case 8000행(console 2000 + network 5000 + action 1000 — `log-merge.ts` cap). TimelinePanel은 탭과 달리 **상시 마운트**라 활성 탭 DOM에 가산된다. 가상화는 도입하지 않는다(저장소 가상화 의존성 0, network 탭 5000행 비가상 선례) — 대신 `TimelineRow` memo + cap 최대치 수동 테스트로 담보. 타입 필터·검색이 실사용 노이즈 완화 수단.
- **자동 스크롤 vs 수동 스크롤 경합**: 사용자가 스크롤 중이면 auto-`scrollIntoView` 금지. `userScrolling` 플래그 + 짧은 타임아웃(예: 2s)로 가드하되, **programmatic 스크롤(scrollIntoView 자신)이 발화한 scroll 이벤트는 가드 판정에서 제외**(자기 오염 순환 방지). 재생 재개/seek 시 해제. `scrollIntoView`는 `block: "nearest"` — `center`는 이미 보이는 요소도 끌어오고 스크롤 가능한 조상(세로 split·페이지)까지 전파될 수 있다.
- **동일 ms 타이브레이크**: click→navigation처럼 같은 ms 다발의 순서가 흔들리면 인과가 어긋남 → 안정 정렬 + kind 우선순위 고정, 단위 테스트로 박기.
- **프리미티브 export 회귀**: `KindIcon`·`LevelIcon`·`renderActionContent`·`searchText`·`levelBgColor`·`rowBg` base 분리 등을 export하며 기존 컴포넌트 동작 불변 확인 — 판정은 기존 3종 렌더 테스트 포함 `pnpm test` + 기존 e2e green.
- **세로 예산**: 영상 하단 Timeline은 좌측 높이의 일부만 → 기본 비율(영상 62 / Timeline 38, minSize 30/20)로 최소 가시행 확보. 리사이저블로 사용자 조정. minSize 30%(≈240px)에선 하단 컨트롤 오버레이가 영상을 크게 덮을 수 있어 하한 체감을 수동 테스트로 확인.
- **중첩 vertical ResizablePanelGroup 첫 선례**: 프리미티브(`src/components/ui/resizable.tsx`)는 vertical을 지원하나 기존 horizontal 그룹 안 중첩은 처음 — 중첩 상호작용을 수동 테스트로 확인.
- **jsdom 한계**: 자동 스크롤·리사이즈·영상 재생 동기화는 jsdom으로 완전 검증 불가 → e2e/수동이 안전망(POSTMORTEM 패턴). 단 렌더·클릭·확장·stopPropagation은 jsdom 테스트 대상.
