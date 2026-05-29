# Log Viewer Timeline Markers — 기술 설계

## 개요

log-viewer의 네이티브 `<video controls>`를 제거하고, `VideoPlayer` 컴포넌트로 교체한다. VideoPlayer는 play/pause 버튼 + progress bar + 시간 표시로 구성되며, progress bar 위에 로그 마커를 오버레이한다. 마커는 우측 로그 탭 선택(`activeTab`)에 따라 해당 종류만 표시하고, 종류별로 의미 있는 서브타입만 필터링한다. 마커 호버 시 툴팁, 클릭 시 비디오 seek + 로그 패널 스크롤. 기존 동기화 패턴(`onSeek`/`syncBaseMs`/`activeTs`/`findActiveIndex`)을 그대로 활용한다.

## 변경 범위

### 새로 추가하는 파일

| 파일 | 역할 |
|---|---|
| `src/log-viewer/components/VideoPlayer.tsx` | 커스텀 비디오 플레이어 컴포넌트. `<video>` (controls 없음) + 하단 controls UI |
| `src/log-viewer/components/ProgressBar.tsx` | progress bar + 마커 오버레이 + 마커 툴팁. 클릭/드래그 seek 처리 |
| `src/log-viewer/markers.ts` | 로그 데이터 → 마커 배열 변환 순수 함수 (서브타입 필터 포함) |
| `src/log-viewer/__tests__/markers.test.ts` | markers.ts 단위 테스트 |

### 변경하는 파일

| 파일 | 변경 내용 |
|---|---|
| `src/log-viewer/App.tsx` | 네이티브 `<video>` → `<VideoPlayer>` 교체. `activeTab` 상태를 마커 필터로 연동. `scrollToEntryId` 상태 추가. |
| `src/log-viewer/i18n.ts` | 커스텀 controls + 툴팁용 i18n 키 추가 |
| `src/sidepanel/components/ConsoleLogContent.tsx` | `scrollToEntryId` + `onScrollComplete` optional prop 추가. 행에 `data-entry-id` 속성 추가. `useEffect`로 스크롤 처리. |
| `src/sidepanel/components/NetworkLogContent.tsx` | 동일 + 스크롤 시 `setActiveId` 호출로 detail 패널도 연동. |
| `src/sidepanel/components/ActionLogContent.tsx` | `scrollToEntryId` + `onScrollComplete` optional prop 추가. 행에 `data-entry-id` 속성 추가. `useEffect`로 스크롤 처리. |
| `src/log-viewer/timeline.ts` | `formatPlayerTime` 추가 |

### 변경하지 않는 파일

- `src/sidepanel/components/LogSeekChip.tsx` — 변경 없음.
- `src/sidepanel/lib/logRow.ts` — 변경 없음.

## 데이터 흐름

### 마커 생성

```
LogViewerData + activeTab + videoDurationSec + videoStartedAt
       │
       ▼
  markers.ts: buildMarkers(data, activeTab, videoDurationSec, videoStartedAt)
       │
       ├─ activeTab === "console"  → consoleLog.entries.filter(e => e.level === "error" || "warn")
       ├─ activeTab === "network"  → networkLog.requests.filter(r => r.phase === "error" || "pending" || (r.phase !== "pending" && r.status >= 400))
       └─ activeTab === "action"   → actionLog.entries (전체)
       │
       ▼
  TimelineMarker[] ─── 각 마커: { id, type, positionPct, absTs, label }
       │
       ▼
  ProgressBar ─── 마커를 bar 위에 absolute 위치로 렌더
```

### 마커 인터랙션

```
마커 호버 → ProgressBar 내부 tooltip 상태 → 마커 위에 로그 요약 표시
마커 클릭 → onMarkerClick(marker)
              │
              ├─ video.currentTime = toVideoSeconds(absTs, startedAt) (재생 상태 유지 — seek만, play 호출 안 함. LogSeekChip 클릭도 동일)
              └─ App: setScrollToEntryId(marker.id) → 로그 패널 스크롤 (필터/검색에 숨겨져 있으면 필터·검색 리셋 후 스크롤, 리셋 후에도 못 찾으면 bail out)
```

### 마커 클릭 → 로그 스크롤

마커의 `id`는 원본 로그 항목의 `id`를 그대로 사용한다. 마커 클릭 시 `App`이 `scrollToEntryId` 상태를 세팅하면, 각 LogContent 컴포넌트가 해당 id를 가진 행으로 `scrollIntoView`. 현재 LogContent 컴포넌트들은 이 기능이 없으므로, `scrollToEntryId` prop을 추가하고 `useEffect`로 스크롤 처리한다.

## 인터페이스 설계

### markers.ts

```typescript
type MarkerType = "console" | "network" | "action";

type MarkerVariant = "error" | "warn" | "pending" | "navigate" | "default";

interface TimelineMarker {
  id: string;           // 원본 로그 항목 id
  type: MarkerType;
  variant: MarkerVariant; // 마커 색상 결정용 (ProgressBar는 이 필드만 보고 색상 적용)
  absTs: number;        // 절대 timestamp (ms)
  positionPct: number;  // 0~100, 비디오 내 상대 위치 %
  label: string;        // 툴팁 텍스트 (로그 요약, 영문 접두사 — 로그 데이터 자체가 원문이므로 i18n 미적용)
}

function buildMarkers(
  data: LogViewerData,
  activeTab: "console" | "network" | "action",
  videoDurationSec: number,
  videoStartedAt: number,
): TimelineMarker[];
```

- `activeTab`에 따라 해당 종류만 마커 생성
- **Console 필터**: `entry.level === "error" || entry.level === "warn"` 만 포함
  - `variant`: error → `"error"`, warn → `"warn"`
  - `label`: `[ERROR] args 앞 80자` 또는 `[WARN] args 앞 80자`
  - `absTs`: `entry.timestamp`
- **Network 필터**: `request.phase === "error"` OR `request.phase === "pending"` OR (`request.phase !== "pending"` AND `request.status >= 400`). OR 조건이므로 하나의 request는 최대 하나의 마커.
  - `variant`: phase=error 또는 status≥400 → `"error"`, phase=pending → `"pending"`
  - `label`: `[{status}] {method} {url 뒤 60자}` (pending이면 status 대신 "Pending")
  - `absTs`: `request.startTime`
- **Action 필터**: 전체 entries
  - `variant`: type=navigation → `"navigate"`, 그 외 → `"default"`
  - `label`: click → `Click: {target}`, navigation → `Nav: {toUrl 뒤 60자}`, input → `Input: {fieldLabel}`
  - `absTs`: `entry.timestamp`
- `positionPct = clamp(0, 100, toVideoSeconds(absTs, videoStartedAt) / videoDurationSec * 100)`
- 비디오 범위 밖 타임스탬프는 경계에 클램프

### 마커 색상

탭이 곧 필터이므로 한 번에 한 종류만 표시된다. 종류별 구분은 탭 전환으로 이미 명확하므로 마커 색상은 단일 기본색으로 통일해도 되지만, 서브타입 구분이 유의미한 경우:

`variant` 필드 기반으로 결정 (label 파싱 금지 — i18n 변경 시 깨짐):

- `"error"` → `bg-red-500`
- `"warn"` → `bg-amber-500`
- `"pending"` → `bg-amber-500`
- `"navigate"` → `bg-sky-500`
- `"default"` → `bg-primary`

### VideoPlayer.tsx

```typescript
interface VideoPlayerProps {
  src: string;
  poster?: string;
  markers: TimelineMarker[];
  onMarkerClick: (marker: TimelineMarker) => void;
  onTimeUpdate: (currentTimeSec: number) => void;
  onDurationChange: (durationSec: number) => void;
  onError: () => void;
}
```

- 내부에서 `<video ref={videoRef}>` (controls 없음)을 렌더. 비디오 영역 클릭 시 play/pause 토글.
- 하단 controls (`flex items-center gap-2 px-3 py-2 bg-muted border-t`): play/pause 버튼 + `ProgressBar` + 시간 표시 (`MM:SS / MM:SS`)
- play/pause는 `videoRef.current.play()` / `.pause()` 직접 호출
- `seekToSec(timeSec: number)` 메서드를 `forwardRef` + `useImperativeHandle`로 노출 — App에서 `toVideoSeconds(absTs, startedAt)`로 변환 후 호출. 기존 `seekTo` 함수가 absTs를 받는 것과 구분하기 위해 `seekToSec` 명명. seek만 수행하고 play 호출하지 않음 (재생 상태 유지). LogSeekChip 클릭도 동일.
- `formatPlayerTime(sec)`: `Math.floor(sec/60):pad2(sec%60)`. 순수 함수이므로 `timeline.ts`에 추가하고 단위 테스트 대상.
- log-viewer 전용 i18n: `import { t } from "../i18n"` 직접 호출 (사이드패널의 `useT` 훅이 아님).

### ProgressBar.tsx

```typescript
interface ProgressBarProps {
  currentPct: number;         // 0~100
  markers: TimelineMarker[];
  onSeek: (pct: number) => void;
  onMarkerClick: (marker: TimelineMarker) => void;
}
```

- bar 클릭: `(clientX - rect.left) / rect.width * 100` → `onSeek(pct)`
- 드래그: `pointerdown` → `setPointerCapture` → `pointermove` → `pointerup`
- 마커: `left: {positionPct}%` absolute 위치의 **pin 형태** 마커. progress bar와 겹치지 않고 **bar 상단에 위치**한다. 레이아웃: bar 위에 2px gap + 마커 전용 영역(~12px 높이). pin 바늘 끝과 bar 상단 사이에 2px 간격을 유지한다.
- **pin 형태**: 상단 원형 head(6~8px) + 하단 뾰족한 바늘(~4px). SVG 또는 CSS clip-path로 구현. head 부분에 variant 색상 적용, 바늘은 동일 색상 또는 약간 어둡게. 호버 시 `scale(1.1)` 효과 적용.
- **마커 영역**: 마커 0개여도 높이 유지 (탭 전환 시 레이아웃 점프 방지).
- 마커 색상: `marker.variant` 기반 — `"error"` → `bg-red-500`, `"warn"` → `bg-amber-500`, `"pending"` → `bg-amber-500`, `"navigate"` → `bg-sky-500`, `"default"` → `bg-primary`
- 마커 클릭 vs 드래그 판별: `pointerdown` 후 5px 이상 이동 → 드래그, 아니면 클릭
- **툴팁**: picker overlay의 DOM 정보 툴팁(`src/content/overlay.ts` inspector 모드)과 동일한 디자인 패턴 적용. 마커 `onMouseEnter` → 내부 상태에 hovered marker 세팅 → pin 위에 절대 위치 div로 `marker.label` 표시. `onMouseLeave` → 해제. CSS: `bg-popover text-popover-foreground shadow-md rounded-xl px-2 py-1.5 text-xs max-w-xs line-clamp-2`, pin 위쪽에 표시, 위쪽 공간 부족 시 아래쪽으로 전환 (`placeLabel` 동일 로직). Radix Tooltip 미사용 — pin이 6~8px로 작아 Radix trigger 영역이 부적절하고, 포인터 이동에 따른 위치 추적이 필요하므로 직접 구현.

### 로그 패널 스크롤 (scrollToEntryId prop)

`ConsoleLogContent` / `NetworkLogContent` / `ActionLogContent`에 optional `scrollToEntryId?: string` + `onScrollComplete?: () => void` prop 추가. 값이 변경되면 해당 id의 DOM 행을 `scrollIntoView({ block: "center", behavior: "smooth" })`. 행의 DOM에 `data-entry-id={entry.id}` 속성 추가 (아직 없는 경우). 해당 항목이 현재 레벨/타입 필터 또는 검색 쿼리에 의해 숨겨져 있으면 필터·검색을 모두 리셋 후 스크롤. 리셋 시도 횟수를 ref로 1회 제한하여 무한 루프 방지. **리셋 후에도 해당 id를 찾지 못하면 bail out** — `onScrollComplete`를 호출해 `scrollToEntryId`를 null로 초기화.

**NetworkLogContent 특수 처리**: list-detail 2분할 구조이므로, 스크롤 시 좌측 리스트 ScrollArea 내에서 행을 찾아 스크롤하고, 동시에 `setActiveId(marker.id)` 호출로 detail 패널도 연동한다.

**Radix ScrollArea 호환성**: 세 컴포넌트 모두 Radix `ScrollArea`를 사용하므로, `scrollIntoView`가 viewport를 올바르게 인식하는지 구현 시 검증 필요.

optional이고 미전달 시 no-op이므로 사이드패널 동작에 영향 없음.

## 기존 패턴 준수

- **컴포넌트 스타일**: shadcn CSS 변수 사용. 마커·툴팁도 shadcn 토큰(`primary`, `destructive`, `popover` 등) 기반.
- **i18n**: `src/log-viewer/i18n.ts`에 ko/en 동시 추가. log-viewer 전용 i18n이라 사이드패널 `src/i18n/`과 무관 — PostToolUse 훅 대상 아님.
- **순수 함수 분리**: 마커 변환·서브타입 필터 로직은 `markers.ts`에 순수 함수로 분리, 단위 테스트 작성.
- **data-[state=inactive]:hidden**: 해당 없음 (탭 구조 변경 없음).

## 대안 검토

### 별도 마커 필터 토글 UI

progress bar 옆이나 아래에 C/N/A 토글 버튼을 두는 방식. 탭과 독립적이라 "Console 탭을 보면서 Network 마커도 같이 보기" 가능. 하지만 컨텍스트가 분산되고 UI가 복잡해진다. **기각**: 탭 연동이 더 직관적이고 단순하다. 3종 동시 표시가 필요해지면 나중에 추가 가능.

### 네이티브 controls 유지 + 별도 마커 바

비디오 아래에 별도의 마커 타임라인 바를 추가. progress bar가 2개가 되어 혼란. **기각**: UX 품질이 떨어진다.

## 위험 요소

1. **드래그 seek vs 마커 클릭 충돌**: `pointerdown` 후 일정 거리(5px) 이동이 있으면 드래그로, 없으면 클릭으로 판별.
2. **마커 과밀집**: 한 종류 내에서도 밀집 가능 (error 50개가 1초 내). 물리적 겹침은 불가피하지만, 호버 툴팁으로 개별 확인 가능. 겹친 마커 클릭 시 DOM z-order(마지막 렌더된 마커)가 선택됨. 별도 hitTest 계산 없음.
3. **비디오 duration 0/NaN**: `duration > 0` 가드 필수. 로드 전에는 마커 렌더 스킵.
4. **LogContent scrollToEntryId**: 공용 컴포넌트 변경. optional prop이고 미전달 시 no-op이라 낮은 위험.
5. **툴팁 위치 계산**: progress bar가 화면 상단에 가까울 수 있으므로 위쪽 공간 부족 시 아래쪽 표시 fallback 필요.
6. **log-viewer 번들 크기**: 순수 UI 컴포넌트 추가라 크게 늘지 않을 것. 현재 ~328KB.
