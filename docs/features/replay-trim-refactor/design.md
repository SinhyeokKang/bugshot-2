# Replay Trim 탭 리팩터 — 기술 설계

## 개요
`ReplayTrimDialog`의 가운데 영역을 "영상 전용"에서 "탭 전환 영역"으로 바꾼다. 상단 로그 선택 ButtonGroup을 아이콘 4단 shadcn `Tabs`(영상/콘솔/네트워크/동작)로 교체하고, 가운데 영역에 활성 탭에 맞춰 `<video>`(영상 탭) 또는 기존 `*LogContent`(로그 탭)를 렌더한다. 트림 타임라인·재생·언두/리두/취소/제출은 탭과 무관하게 항상 렌더되는 전역 컨트롤로 둔다. 로그 탭의 muted 미리보기는 **실제 트림 경계 계산을 공유하는 순수 헬퍼**(`apply-trim`에서 추출)로 산출해 잘림 결과와 정확히 일치시킨다. `*LogContent`에는 시간 기반 muted 판정용 optional prop 하나만 추가한다.

## 변경 범위

### `src/sidepanel/30s-replay/trim-math.ts` (헬퍼 추출 + 신규)
- **현재 역할**: 초↔프레임 인덱스 변환(`secondsToFrameRange`, `frameOffsetsMs`, `isFullRange`).
- **변경**: 로그 trim 경계(wall-clock ms) 계산 헬퍼를 신규 추가. 현재 `apply-trim.ts`에 인라인된 `lower`/`upper` 산출 로직을 이 헬퍼로 옮겨 **apply-trim과 muted 미리보기가 동일 코드를 공유**하게 한다.
  - `replayLogTrimBounds(frames, inIndex, outIndex)` — 인덱스 → `{ lower, upper }`.
  - `previewTrimBounds(frames, startSec, endSec, maxFrameDurationMs)` — 초 구간 → `{ lower, upper } | null`(전체 구간이면 `null` = muted 없음). 내부에서 `secondsToFrameRange` + `isFullRange` + `replayLogTrimBounds` 조합.
  - `isTrimmedOut(absTs, bounds)` — `ts < lower || (upper != null && ts > upper)`.
  - 계약: `replayLogTrimBounds`는 **비어있지 않은 `frames` 가정**(직접 호출 시 호출자 책임). `previewTrimBounds`는 빈/단일 프레임에서 `isFullRange` early-return으로 `null` 반환을 보장(크래시 없음).
- `REPLAY_LOG_GUARD_MS`를 `@/sidepanel/lib/log-merge`에서 import. 순환 없음 — log-merge가 trim-math/frame-buffer/mp4-encoder를 역참조하지 않아 `trim-math → log-merge` 단방향(log-merge 자체는 `@/lib/session-keys`의 런타임 값을 쓰지만 trim-math와 무관). `apply-trim.ts`가 이미 동일 import를 쓰는 선례 있음.

### `src/sidepanel/30s-replay/apply-trim.ts` (회귀 무손실 리팩터)
- **현재 역할**: 선택 구간 프레임 재인코딩 + 로그 재trim.
- **변경**: 인라인 `lower`/`upper` 계산(현재 37~38행)을 `replayLogTrimBounds(frames, inIndex, outIndex)` 호출로 대체. 결과 값은 기존과 동일해야 한다(동작 불변). `videoStartedAt`/`videoEndedAt` 계산은 그대로 유지.

### `src/sidepanel/tabs/ReplayTrimDialog.tsx` (핵심 변경)
- **현재 역할**: 트림 오버레이 오케스트레이터(상태·ButtonGroup·3개 다이얼로그·영상).
- **변경**:
  1. `frames: CapturedFrame[]` prop 추가(muted 경계 계산용).
  2. 로컬 상태 `activeTab: TrimTab` 추가(`"video" | "console" | "network" | "action"`, 기본 `"video"`).
  3. 상단 정보 bar의 로그 선택 ButtonGroup(현재 153~163행)을 아이콘 4단 `Tabs`로 교체. 좌측 `selection` 초 표시(`issue.replay.trim.selection`)는 그대로 유지하고, 탭은 우측(기존 ButtonGroup 자리)에 둔다. 각 로그 탭에 카운트 Badge(로그 뷰어 탭과 동일 className) 부착, 단 4자리 이상은 `999+`로 cap(영상 탭은 Badge 없음 — 정렬 비대칭은 감수). 로그 없는 탭은 `disabled`.
  4. 가운데 영역: `<video>`는 항상 마운트 유지(타임라인·재생·playhead가 ref에 의존)하되 `activeTab !== "video"`면 `hidden`. 로그 탭 3종 `*LogContent`(flush)는 **첫 활성화 때(=보이는 상태) 마운트하고 이후 유지**(`mounted` Record + `activate()`), 비활성 탭은 `hidden`. 숨긴 채로 처음 마운트하면 `NetworkLogContent`의 폭 측정(`clientWidth*0.3`)·tail 자동스크롤이 `display:none`(clientWidth/scrollHeight 0)에서 무력화되므로, 첫 마운트를 visible로 보장하면서 재진입 시 필터/검색/스크롤 상태도 보존한다.
  5. muted 경계: `const bounds = useMemo(() => previewTrimBounds(frames, startSec, endSec, MAX_FRAME_DURATION_MS), [frames, startSec, endSec])`. `isMuted`는 `useCallback((ts) => bounds != null && isTrimmedOut(ts, bounds), [bounds])`로 안정화해 각 `*LogContent`에 전달(후속 row `React.memo` 도입 시에도 무해). 각 LogContent는 자신의 타임스탬프 필드로 호출.
  6. 마커 클릭: 다이얼로그 open 대신 `setActiveTab(m.type)` + `setFocusEntryId(m.id)`. 활성 로그 탭의 `*LogContent`에 `scrollToEntryId={focusEntryId}` 전달, 스크롤 완료/수동 탭 전환 시 `null` 리셋.
  7. 3개 `*LogPreviewDialog` import·렌더 제거(이 파일에서만). 컴포넌트 파일은 유지(타 사용처 존재).
  8. 네트워크/콘솔/동작 탭 모두 `syncBaseMs={videoStartedAt ?? undefined}` 전달 → 네트워크 탭에 상대 timestamp(`LogSeekChip`) 표시(로그 뷰어와 동일).
  9. 재생 제어: `activeTab`이 `"video"`가 아니게 바뀌면 영상을 자동 일시정지(`videoRef.current?.pause()`, `onValueChange`에서 또는 `useEffect([activeTab])`). 재생 버튼은 `disabled={busy || duration <= 0 || activeTab !== "video"}`로 로그 탭에서 비활성. (영상이 hidden이고 재생↔로그 동기화가 비목표라 로그 탭 재생은 의미 없음.)
  10. 사용하지 않게 되는 상태/import 정리: `consoleOpen`/`networkOpen`/`actionOpen`, `ButtonGroup`(정보 bar 한정 — 언두/리두·취소/제출 ButtonGroup은 유지) 등 내 변경이 만든 고아만 제거.

### `src/sidepanel/components/ConsoleLogContent.tsx` / `NetworkLogContent.tsx` / `ActionLogContent.tsx` (optional prop 추가)
- **현재 역할**: 로그 리스트 렌더(필터·검색·origin·상세). 라이브 서브탭·로그 뷰어·미리보기 공용.
- **변경**: optional prop `isMuted?: (absTs: number) => boolean` 추가. 각 row 컴포넌트(`EntryAccordion`/`RequestRow`/`ActionRow`)에서 row의 timestamp(console·action=`timestamp`, network=`startTime`)로 호출해 참이면 row 래퍼에 흐림 스타일(`opacity-40`)과 `data-muted` 속성 부여. prop 미공급 시 기존과 완전히 동일(무변화).
- **네트워크 상세 패널은 muted 무관**: `isMuted`는 좌측 `RequestRow`(요청 리스트)에만 적용한다. 트림 후보 row도 그대로 클릭·선택되고 우측 상세(headers/request/response, WS messages)는 흐림 없이 전체 표시 — 잘리기 전 내용 확인이 목적. 상세 렌더 경로(`HeadersPanel`/`BodyPanel`/`MessagesPanel`)는 변경 없음.

### `src/sidepanel/App.tsx` (prop 전달)
- **변경**: `<ReplayTrimDialog frames={replay.pendingTrim.frames} ... />` 한 줄 추가. `frames`는 이미 보유(360~366행 인근에서 `applyReplayTrim`에 전달 중).

### `src/i18n/namespaces/issue.ts` (라벨 1개 추가)
- **변경**: `issue.replay.trim.tab.video`(ko: "영상" / en: "Video") 추가. 나머지 탭 aria-label/title은 기존 `issue.replay.trim.log.console|network|action` 재사용. ko/en 동시 갱신(PostToolUse 훅이 대칭 검사).

## 데이터 흐름
```
App (replay.pendingTrim.frames, videoBlob)
  → ReplayTrimDialog
      value=[startSec,endSec]  (드래그 라이브)
         │
         └─ previewTrimBounds(frames, startSec, endSec, MAX_FRAME_DURATION_MS) → bounds|null   [useMemo]
                │
                └─ isMuted=(ts)=> bounds && isTrimmedOut(ts, bounds)
                      → ConsoleLogContent / NetworkLogContent / ActionLogContent (row opacity-40)

  제출(onConfirm) → applyReplayTrim({frames,startSec,endSec})
      → secondsToFrameRange → replayLogTrimBounds(frames,inIndex,outIndex) → trimByTime
      (미리보기와 동일 경계 → 흐렸던 로그 = 실제 제거 로그)
```
- 타임베이스: muted 미리보기와 실제 trim 모두 `frames` 기반 wall-clock 경계 사용(가드밴드 포함) → 일치.
- 마커 위치는 기존대로 `videoStartedAt` 기준(`buildErrorMarkers`) — 변경 없음.

## 인터페이스 설계
```ts
// trim-math.ts (신규)
export interface ReplayLogBounds { lower: number; upper: number | undefined; }

export function replayLogTrimBounds(
  frames: CapturedFrame[],
  inIndex: number,
  outIndex: number,
): ReplayLogBounds;

export function previewTrimBounds(
  frames: CapturedFrame[],
  startSec: number,
  endSec: number,
  maxFrameDurationMs: number,
): ReplayLogBounds | null; // null = 전체 구간(잘림 없음)

export function isTrimmedOut(absTs: number, bounds: ReplayLogBounds): boolean;

// *LogContent props 공통 추가
isMuted?: (absTs: number) => boolean;

// ReplayTrimDialog
type TrimTab = "video" | "console" | "network" | "action";
interface ReplayTrimDialogProps {
  videoBlob: Blob;
  frames: CapturedFrame[];           // 신규
  onConfirm: (startSec: number, endSec: number) => void;
  onCancel: () => void;
  busy?: boolean;
}
```

탭 UI(아이콘 + 카운트 Badge, 로그 뷰어 패턴 재사용):
```tsx
<Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as TrimTab); setFocusEntryId(null); }}>
  <TabsList className="grid h-9 grid-cols-4">
    <TabsTrigger value="video" data-testid="replay-trim-tab-video" aria-label={t("issue.replay.trim.tab.video")}>
      <Film className="h-4 w-4" />
    </TabsTrigger>
    <TabsTrigger value="console" disabled={!consoleLog} data-testid="replay-trim-tab-console" aria-label={t("issue.replay.trim.log.console")}>
      <Terminal className="h-4 w-4" />
      {consoleLog && consoleLog.entries.length > 0 && (
        <Badge className="ml-1 h-5 min-w-5 shrink-0 px-1.5 text-[10px]">{consoleLog.entries.length}</Badge>
      )}
    </TabsTrigger>
    {/* network: requests.length, action: entries.length 동일 패턴 */}
  </TabsList>
</Tabs>
```
- 영상 탭은 카운트 Badge 없음. 아이콘은 영상=`Film`(lucide), 콘솔=`Terminal`, 네트워크=`ArrowLeftRight`, 동작=`MousePointerClick`(기존과 동일).

가운데 영역(상태 보존 위해 전부 마운트, 비활성은 `hidden`):
```tsx
<div className="flex min-h-0 flex-1 ...">
  {src && (
    <video ref={videoRef} src={src}
      className={cn("h-full w-full object-contain", activeTab !== "video" && "hidden")}
      onLoadedMetadata={...} onTimeUpdate={...} onPlay={...} onPause={...} />
  )}
  {consoleLog && (
    <div className={cn("flex min-h-0 flex-1", activeTab !== "console" && "hidden")}>
      <ConsoleLogContent flush entries={consoleLog.entries} startedAt={consoleLog.startedAt}
        syncBaseMs={videoStartedAt ?? undefined} isMuted={isMuted}
        scrollToEntryId={focusEntryId} onScrollComplete={() => setFocusEntryId(null)} />
    </div>
  )}
  {/* network: NetworkLogContent requests=... ; action: ActionLogContent entries=... 동일하게 hidden 토글 */}
</div>
```
- 비활성 탭을 언마운트하지 않고 `hidden`으로 숨겨 필터/검색/스크롤 상태를 보존(로그 뷰어 `data-[state=inactive]:hidden`과 동일 의도). 마커 클릭 → 탭 전환 → `scrollToEntryId` 스크롤도 이미 마운트된 리스트라 타이밍 안정적.

muted row 스타일(각 row 래퍼):
```tsx
const muted = isMuted?.(entry.timestamp) ?? false; // network: req.startTime
className={cn(syncRowClass(...), muted && "opacity-40")}
data-muted={muted || undefined}
```

## 기존 패턴 준수
- **공용 `*LogContent` optional prop 패턴**: `syncBaseMs`/`onSeek`/`scrollToEntryId`처럼 `isMuted`도 optional로 추가해 기존 사용처(라이브 서브탭·로그 뷰어·미리보기) 무영향.
- **트림 타임베이스 분리**: `apply-trim`의 가드밴드/프레임 스냅 경계 로직을 헬퍼로 추출하되 동작 불변(회귀 테스트로 보증).
- **i18n 동시 갱신**: ko/en 키 함께 추가(훅 강제).
- **shadcn 우선**: 탭은 기존 `@/components/ui/tabs`·`@/components/ui/badge` 재사용(신규 컴포넌트·설치 없음). **아이콘 전용 plain `TabsList`**(라벨 없음, `aria-label`로 접근성 이름 부여) — 로그 뷰어의 `CollapsingTabsList`(아이콘+라벨+접힘)는 4탭·400px엔 라벨이 거의 접혀 실익 적고 접힘 시 a11y 갭이 있어 채택 안 함. Badge className만 로그 뷰어와 동일.
- **단위 테스트 우선**: 신규 순수 헬퍼(`previewTrimBounds`/`replayLogTrimBounds`/`isTrimmedOut`)는 구현 전 테스트 작성.

## 대안 검토
1. **muted 경계: videoStartedAt 상대초 근사(채택 안 함)** — 프레임 없이 `(ts - videoStartedAt)/1000`로 판정. 가볍지만 `apply-trim`의 프레임 스냅 + 가드밴드와 경계 한두 프레임 어긋나 "흐린 로그 ≠ 실제 제거 로그"가 될 수 있어 기각. 정확 일치를 위해 frames 전달 + 공유 헬퍼 채택.
2. **마커 클릭 시 다이얼로그 유지(채택 안 함)** — 탭과 다이얼로그 공존은 UI 중복·전역 트리밍 정책과 충돌. 탭 전환 + 스크롤로 통일.
3. **muted 스타일 grayscale(채택 안 함)** — 탈색은 레벨/상태 색을 죽여 정책 4-2(색상+흐림 병렬 구분) 위반. opacity 저감은 색조를 유지해 채택.
4. **로그 탭 재생 동기화(채택 안 함)** — activeTs 하이라이트/자동스크롤은 스코프 밖(비목표). 정적 리스트 + muted만.

## 위험 요소
- **경계 드리프트**: 미리보기와 `apply-trim`이 다른 경로로 경계를 계산하면 "흐림 ≠ 실제 잘림" 발생. → 단일 헬퍼(`replayLogTrimBounds`) 공유 + `apply-trim` 리팩터 회귀 테스트로 차단. `MAX_FRAME_DURATION_MS`도 양쪽 동일 값 사용 필수.
- **숨긴 `<video>` 상태 유지**: `hidden`(display:none) 비디오도 `currentTime`/`duration` 접근·seek가 유지됨(미디어 요소는 표시와 무관). 로그 탭에서 자동 일시정지하므로 재생은 멈추지만 타임라인 트림/스크럽은 정상. 구현 시 실제 탭에서 확인 필요(수동).
- **드래그 중 대량 row 재렌더**: 핸들 드래그마다 `value` 변경 → `*LogContent` 재렌더(최대 network 5000행). 30s Replay 로그는 보통 소량이라 실사용 영향 낮지만, 큰 로그에서 끊김 가능. 필요 시 `bounds`를 `useMemo`로 안정화(이미 설계), 추가 최적화(row `React.memo`)는 측정 후 판단 — 선제 추상화는 보류.
- **탭 콘텐츠 마운트**: 영상은 항상 마운트(video ref 의존), 로그 탭 3종은 첫 활성화 때 마운트하고 이후 `hidden`으로 유지(lazy-mount-then-keep). 숨긴 채 마운트 시 `NetworkLogContent` 폭 측정(`clientWidth*0.3`)이 0이 되고 tail 자동스크롤이 no-op이 되는 문제를 첫 마운트 visible 보장으로 차단하면서 재진입 상태 보존. (Radix `TabsContent`는 inactive를 언마운트해 video 상시 마운트와 양립 불가라 수동 hidden-div + mounted Record 사용.)
- **네트워크 2분할 @ ~400px (수용된 알려진 제약)**: `NetworkLogContent`는 좌(리스트)/splitter/우(상세) 2분할이고 초기 리스트 폭 `clientWidth*0.3`(400px면 ~120px, 드래그 최소 160px보다 작음). 트림 미리보기 핵심인 리스트가 좁아 method/path가 truncate되지만, **무변경 재사용을 우선해 현 설계 유지**(listOnly 모드 미도입). 실사용 시야는 수동 확인 대상.
- **마커 ↔ 로그 리스트 겹침**: `TimelineMarkers`는 타임라인 위쪽(`bottom-full mb-1.5 h-4`)에 뜬다. 영상 탭에선 위가 영상 영역이라 무해하나, 로그 탭에선 위가 로그 리스트라 에러 핀이 마지막 row 위에 겹쳐 보일 수 있다(컨트롤러 bar `py-2`=8px로 h-4=16px 마커를 못 담음). 구현 시 실제 탭에서 확인 — 필요 시 로그 탭에서 마커 레이어 여백 보정(수동검증).
- **세로 높이 예산**: 로그 탭에서 고정 bar 3개(상단 탭바 + 영상 컨트롤러 + 액션바) + LogContent 자체 헤더(필터탭+검색)가 쌓여 낮은 화면에선 리스트 가시 행이 적다. 전역 트리밍 정책상 컨트롤러 유지는 불가피 — 수동 확인 대상.
