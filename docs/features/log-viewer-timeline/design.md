# Log Viewer 통합 타임라인 패널 — 기술 설계

## 개요

log-viewer 좌측 패널(현재 영상/이미지 단일)을 **세로 리사이저블 2분할**로 바꿔 하단에 병합 타임라인 패널을 넣는다. 병합은 3종 로그(`ConsoleLog`/`NetworkLog`/`ActionLog`)를 절대 ms로 정렬하는 **순수 함수 `buildTimeline`** 하나가 담당하고, 렌더는 기존 로그 행 프리미티브(`LogSeekChip`·`formatRelativeTime`·타입별 아이콘·면색 틴트·`log-colors`)를 재사용하는 신규 경량 컴포넌트가 맡는다. 영상 playhead는 현재 `VideoPlayer` 내부 state에 갇혀 있으므로 `App`으로 lift-up해 `findActiveIndex`로 active 행을 계산한다. Timeline은 **영상이 있을 때만**(`video && !videoError`) 렌더된다.

## 변경 범위

### 신규 파일

- **`src/log-viewer/timeline-merge.ts`** — `TimelineItem` 판별 유니온 + `buildTimeline()` 순수 함수 + `timelineFillClass()` 면색 규칙. 부수효과·DOM 없음(node 테스트 대상). 스크러버용 `markers.ts`(`TimelineMarker`, `positionPct`·`labelParts`)와 **별개** — 이쪽은 원본 엔트리를 참조하는 리스트 아이템.
- **`src/log-viewer/components/TimelinePanel.tsx`** — 병합 리스트 컨테이너. 스크롤·active 계산·자동 스크롤(수동 스크롤 가드) 담당. `TimelineItem[]` + `currentAbsMs` + `onSeek` + `onOpenNetworkDetail` 수신.
- **`src/log-viewer/components/TimelineRow.tsx`** — 1행 렌더. 카테고리별 아이콘/토큰/텍스트/우측메타 + 스파인 레일 + 면색 + console chevron 확장. (파일 분리 또는 `TimelinePanel` 내부 함수 컴포넌트 — 규모 보고 판단, 기본 분리.)

### 변경 파일

- **`src/log-viewer/components/VideoPlayer.tsx`**
  - 현재 역할: 영상 재생 + 스크러버 마커. `currentTimeSec`가 내부 state(외부 미노출).
  - 변경: `VideoPlayerProps`에 `onTimeUpdate?: (sec: number) => void` 추가. 기존 `handleTimeUpdate`(55행 `setCurrentTimeSec(el.currentTime)`) 안에서 콜백 호출. `VideoPlayerHandle`은 그대로(seek 전용).

- **`src/log-viewer/App.tsx`**
  - 현재 역할: 좌(영상/이미지 60) / 우(탭 40) 가로 분할 오케스트레이션.
  - 변경:
    - `currentTimeSec` state 추가 + `VideoPlayer onTimeUpdate`로 갱신. `currentAbsMs = video.startedAt + currentTimeSec * 1000` 파생.
    - `timelineItems = useMemo(() => buildTimeline(data.consoleLog, data.networkLog, data.actionLog), [...])`.
    - 좌측 `ResizablePanel`의 **video 브랜치**(264행)를 `ResizablePanelGroup direction="vertical"`로 감싸: 상단 `VideoPlayer`, 하단 `TimelinePanel`. **screenshot 브랜치·`if (!video && !screenshot)` early return(260행)은 손대지 않음** → Timeline은 영상일 때만.
    - `TimelinePanel`에 `onSeek={seekTo}`(기존 79행 재사용), `onOpenNetworkDetail={(id) => { setActiveTab("network"); setSelectedNetworkId(id); }}` 배선.
    - `selectedNetworkId` state 추가 → 우측 `NetworkLogContent`에 `selectedId`로 전달.

- **`src/sidepanel/components/NetworkLogContent.tsx`**
  - 현재 역할: 마스터-디테일 네트워크 뷰. 선택은 내부 `activeId` state(154행)로만.
  - 변경: `selectedId?: string | null` prop 추가(`ConsoleLogContent`의 `selectedId` 선례와 동일). 값 변경 시 내부 `activeId`를 동기화(useEffect)해 외부에서 요청 pre-select 가능. **라이브 서브탭·삽입 다이얼로그 경로는 미공급이라 무영향**.

- **`src/log-viewer/i18n.ts`**
  - 변경: `koDict`/`enDict`에 Timeline 전용 키 추가 — `timeline.detail`("상세"/"Detail"), `timeline.empty`(로그 0건 표시, 필요 시). action 행 텍스트는 재사용하는 `renderActionContent`가 기존 i18n 경로로 해결하므로 **추가 없음**. `src/log-viewer/__tests__/i18n.test.ts`가 ko/en 대칭·placeholder를 검증하므로 양쪽 동시 갱신.

### 재사용 프리미티브 (신규 로직 최소화)

- `@/sidepanel/lib/logRow`: `formatRelativeTime`, `LogSeekChip`(있으면 export 확인, 없으면 그 파일에서 export).
- `@/lib/log-colors`: `consoleLevelTextClass`, `networkMethodTextClass`(토큰 텍스트 색).
- 타입별 렌더 헬퍼: `KindIcon`·`renderActionContent`(ActionLogContent), `LevelIcon`·`LinkifiedText`(ConsoleLogContent), content-type 아이콘·`methodColor`·`isError`·`isPending`(NetworkLogContent) — TimelineRow에서 쓰도록 **각 컴포넌트에서 export**(작은 프레젠테이션 헬퍼). 로직 이동 아님, export만.

## 데이터 흐름

```
data.{consoleLog,networkLog,actionLog}
        │  buildTimeline(순수)  → 절대 ms 정렬 + 타입 타이브레이크
        ▼
   TimelineItem[]  ──────────────► TimelinePanel
                                     │  currentAbsMs (= video.startedAt + currentTimeSec*1000)
        VideoPlayer.onTimeUpdate ────┘        │ findActiveIndex(absTs[], currentAbsMs) → activeIdx
                                              ▼
                                   TimelineRow[i] (active면 스파인 foreground + scrollIntoView)
   행 클릭 ─► onSeek(absTs) ─► playerRef.seekToSec(toVideoSeconds)   (기존 79행 경로)
   network "상세" ─► onOpenNetworkDetail(id) ─► setActiveTab("network") + setSelectedNetworkId(id)
                                                          ▼
                                          NetworkLogContent selectedId → 내부 activeId 동기화
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

// 면색 = "문제"만. console error/warn, network error(status>=400|phase error)/pending. action·기타 = "".
// 반환 클래스는 기존 ConsoleLogContent.levelBgColor / NetworkLogContent.rowBg 값과 동일해야 우측 탭과 일치.
export function timelineFillClass(item: TimelineItem): string;
```

```ts
// TimelinePanel props
interface TimelinePanelProps {
  items: TimelineItem[];
  currentAbsMs: number;                 // 영상 playhead 절대 ms
  videoStartedAt: number;               // LogSeekChip base + toVideoSeconds base
  onSeek: (absTs: number) => void;      // 행 클릭
  onOpenNetworkDetail: (id: string) => void; // network "상세"
}

// VideoPlayer 추가 prop
onTimeUpdate?: (sec: number) => void;

// NetworkLogContent 추가 prop
selectedId?: string | null;            // 외부 pre-select (log-viewer "상세" 라우팅 전용)
```

**행 골격** (TimelineRow):
`[스파인 border-l] [LogSeekChip M:SS] [카테고리 아이콘] [토큰] [주 텍스트] [우측 메타]`
- 토큰 문법: action=소문자 동사(칩 없음) / network=`METHOD·status` 컬러칩 / console=`ERROR`·`WARN` 배지(info/log/debug는 배지·면색 없음)
- 스파인: 모든 행 `border-l-2`, active `border-l-foreground` / 그 외 `border-l-muted`
- 면색: `timelineFillClass(item)`
- console 에러/경고: chevron → `entry.stack` 인라인 확장(ConsoleLogContent expand 패턴 준용)
- network: 우측 메타 옆 "상세" 링크 → `onOpenNetworkDetail(req.id)`
- 행 전체 `onClick` → `onSeek(absTs)` (chevron·"상세"는 `stopPropagation`)

## 기존 패턴 준수

- **순수 함수 분리 + node 테스트**: `buildTimeline`/`timelineFillClass`는 `timeline.ts`(findActiveIndex 등)와 같은 결의 순수 모듈 → `__tests__/*.test.ts`.
- **면색/토큰 색 단일 출처**: 텍스트·아이콘 색은 `log-colors.ts` 재사용. 면색 틴트 클래스는 기존 로그 탭 값과 동일하게 맞춰 발산 방지(DESIGN.md §2·§로그 semantic 색).
- **채널 직교(DESIGN 선례)**: status=면색 / active=스파인 레일(muted↔foreground) / 선택=ring. `ConsoleLogContent` "선택은 배경 아니라 ring(레벨 틴트·sync 하이라이트와 경합)" 주석과 동일 원칙 — active를 배경으로 표현하지 않는다.
- **log-viewer 복제 사전**: 신규 문자열은 `src/log-viewer/i18n.ts` koDict/enDict 양쪽 + 대칭 테스트.
- **최소 설계·외과적 변경**: 우측 4탭·screenshot·노미디어 경로 무변경. 프리미티브는 이동이 아니라 export만.

## 대안 검토

1. **markers.ts의 `TimelineMarker` 재사용** — 스크러버 마커용이라 `positionPct`·`labelParts`(툴팁 조각) 중심이고 원본 엔트리 참조가 없다. 리스트 행은 seek·확장·"상세" 라우팅에 원본 엔트리가 필요 → 별도 `TimelineItem` 유니온 채택.
2. **기존 `ConsoleLogContent`/`NetworkLogContent`/`ActionLogContent` 행 컴포넌트를 그대로 병합 렌더** — 마스터-디테일·collapsible·검색 무게를 지고 있어 고밀도 타임라인엔 과함. 경량 `TimelineRow` 신규 + 프리미티브만 재사용으로 결정(사용자 확정).
3. **active를 배경(`bg-accent`)으로 강조** — 면색(status)과 경합. 스파인 레일(muted→foreground)로 직교 분리.
4. **screenshot에도 정적 병합 리스트 노출** — 시간 앵커·seek 대상이 없어 가치 낮고 우측 탭과 중복. 영상 게이트로 미노출.

## 위험 요소

- **playhead lift-up 리렌더 비용**: `onTimeUpdate`(video `timeupdate` ~4회/초)로 `App` state 갱신 시 리렌더 범위 주의. `currentAbsMs`는 `TimelinePanel`까지만 흘리고, active 계산·`scrollIntoView`는 패널 내부에서. 필요 시 활성 인덱스 memo/비교로 불필요 리렌더 억제.
- **자동 스크롤 vs 수동 스크롤 경합**: 사용자가 스크롤 중이면 auto-`scrollIntoView` 금지(스크롤 싸움). `userScrolling` 플래그 + 짧은 타임아웃(예: 스크롤 후 2s)로 가드. 재생 재개/seek 시 해제.
- **동일 ms 타이브레이크**: click→navigation처럼 같은 ms 다발의 순서가 흔들리면 인과가 어긋남 → 안정 정렬 + kind 우선순위 고정, 단위 테스트로 박기.
- **프리미티브 export 회귀**: `KindIcon`·`LevelIcon`·`renderActionContent`·`LinkifiedText` 등을 export하며 기존 컴포넌트 동작 불변 확인(시그니처·내부 사용 유지).
- **NetworkLogContent `selectedId` 동기화**: 외부 selectedId ↔ 내부 activeId 동기화가 사용자의 내부 클릭 선택을 덮지 않도록(외부 값 변경 시에만 반영). 라이브 서브탭·삽입 다이얼로그 경로 무영향 확인.
- **세로 예산**: 영상 하단 Timeline은 좌측 높이의 일부만 → 기본 비율(영상 62 / Timeline 38, minSize 30/20)로 최소 가시행 확보. 리사이저블로 사용자 조정.
- **jsdom 한계**: 자동 스크롤·리사이즈·영상 재생 동기화는 jsdom으로 완전 검증 불가 → e2e/수동이 안전망(POSTMORTEM 패턴).
