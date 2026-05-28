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
| `src/log-viewer/App.tsx` | 네이티브 `<video>` → `<VideoPlayer>` 교체. `activeTab` 상태를 마커 필터로 연동. `activeTs` 전달로 비디오→로그 하이라이트 완성. `scrollToEntryId` 상태 추가. |
| `src/log-viewer/i18n.ts` | 커스텀 controls + 툴팁용 i18n 키 추가 |
| `src/log-viewer/timeline.ts` | 변경 없음 — 기존 `toVideoSeconds`, `findActiveIndex` 재사용 |

### 변경하지 않는 파일

- `src/sidepanel/components/ConsoleLogContent.tsx` — 이미 `activeTs` prop 지원. App.tsx에서 전달만 추가.
- `src/sidepanel/components/NetworkLogContent.tsx` — 동일.
- `src/sidepanel/components/ActionLogContent.tsx` — 동일.
- `src/sidepanel/components/LogSeekChip.tsx` — 변경 없음.
- `src/sidepanel/lib/logRow.ts` — 변경 없음.

## 데이터 흐름

### 마커 생성

```
LogViewerData + activeTab + videoDurationMs + videoStartedAt
       │
       ▼
  markers.ts: buildMarkers(data, activeTab, videoDurationMs, videoStartedAt)
       │
       ├─ activeTab === "console"  → consoleLog.entries.filter(e => e.level === "error" || "warn")
       ├─ activeTab === "network"  → networkLog.requests.filter(r => r.phase === "pending" || "error")
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
              ├─ video.currentTime = toVideoSeconds(absTs, startedAt)
              └─ App: setScrollToEntryId(marker.id) → 로그 패널 스크롤
```

### 비디오 → 로그 하이라이트 (기존 미완성 → 완성)

현재 `ConsoleLogContent`/`NetworkLogContent`/`ActionLogContent`는 `activeTs` prop을 받으면 `findActiveIndex`로 활성 행을 계산하지만, `App.tsx`가 `activeTs`를 전달하지 않아 비활성 상태. 이번에 `VideoPlayer`의 `onTimeUpdate` 콜백으로 `currentTimeMs` 상태를 갱신하고, `activeTs`로 전달해 완성한다.

```
video timeupdate → VideoPlayer onTimeUpdate(currentTimeSec)
  → App: setCurrentTimeMs(startedAt + currentTimeSec * 1000)
    → ConsoleLogContent activeTs={currentTimeMs}
    → NetworkLogContent activeTs={currentTimeMs}
    → ActionLogContent activeTs={currentTimeMs}
```

### 마커 클릭 → 로그 스크롤

마커의 `id`는 원본 로그 항목의 `id`를 그대로 사용한다. 마커 클릭 시 `App`이 `scrollToEntryId` 상태를 세팅하면, 각 LogContent 컴포넌트가 해당 id를 가진 행으로 `scrollIntoView`. 현재 LogContent 컴포넌트들은 이 기능이 없으므로, `scrollToEntryId` prop을 추가하고 `useEffect`로 스크롤 처리한다.

## 인터페이스 설계

### markers.ts

```typescript
type MarkerType = "console" | "network" | "action";

interface TimelineMarker {
  id: string;           // 원본 로그 항목 id
  type: MarkerType;
  absTs: number;        // 절대 timestamp (ms)
  positionPct: number;  // 0~100, 비디오 내 상대 위치 %
  label: string;        // 툴팁 텍스트 (로그 요약)
}

function buildMarkers(
  data: LogViewerData,
  activeTab: "console" | "network" | "action",
  videoDurationMs: number,
  videoStartedAt: number,
): TimelineMarker[];
```

- `activeTab`에 따라 해당 종류만 마커 생성
- **Console 필터**: `entry.level === "error" || entry.level === "warn"` 만 포함
  - `label`: `[ERROR] args 앞 80자` 또는 `[WARN] args 앞 80자`
- **Network 필터**: `request.phase === "pending" || request.phase === "error"` 만 포함
  - `label`: `[{status}] {method} {url 뒤 60자}` (pending이면 status 대신 "Pending")
- **Action 필터**: 전체 entries
  - `label`: click → `Click: {target}`, navigation → `Nav: {toUrl 뒤 60자}`, input → `Input: {fieldLabel}`
- `positionPct = clamp(0, 100, toVideoSeconds(absTs, videoStartedAt) / (videoDurationMs / 1000) * 100)`
- 비디오 범위 밖 타임스탬프는 경계에 클램프

### 마커 색상

탭이 곧 필터이므로 한 번에 한 종류만 표시된다. 종류별 구분은 탭 전환으로 이미 명확하므로 마커 색상은 단일 기본색으로 통일해도 되지만, 서브타입 구분이 유의미한 경우:

- **Console**: error=`red-500`, warn=`amber-500`
- **Network**: error=`red-500`, pending=`amber-500`
- **Action**: 단일 색 `primary`

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

- 내부에서 `<video ref={videoRef}>` (controls 없음)을 렌더
- 하단 controls: play/pause 버튼 + `ProgressBar` + 시간 표시 (`MM:SS / MM:SS`)
- play/pause는 `videoRef.current.play()` / `.pause()` 직접 호출
- `seekTo(absTs)` 메서드를 `forwardRef` + `useImperativeHandle`로 노출 — App에서 로그 항목 클릭 시 비디오 seek에 사용

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
- 마커: `left: {positionPct}%` absolute 위치의 작은 세로 마커 (3~4px 폭, bar 높이)
- 마커 클릭 vs 드래그 판별: `pointerdown` 후 5px 이상 이동 → 드래그, 아니면 클릭
- **툴팁**: 마커 `onMouseEnter` → 내부 상태에 hovered marker 세팅 → 마커 위에 절대 위치 div로 `marker.label` 표시. `onMouseLeave` → 해제. CSS: `bg-popover text-popover-foreground shadow-md rounded px-2 py-1 text-xs`, 마커 위쪽에 표시, 화면 밖으로 넘어가면 아래쪽으로 전환.

### 로그 패널 스크롤 (scrollToEntryId prop)

`ConsoleLogContent` / `NetworkLogContent` / `ActionLogContent`에 optional `scrollToEntryId?: string` prop 추가. 값이 변경되면 해당 id의 DOM 행을 `scrollIntoView({ block: "center", behavior: "smooth" })`. 행의 DOM에 `data-entry-id={entry.id}` 속성 추가 (아직 없는 경우). 해당 항목이 현재 레벨/타입 필터에 의해 숨겨져 있으면 필터를 "전체"로 리셋 후 스크롤.

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
2. **마커 과밀집**: 한 종류 내에서도 밀집 가능 (error 50개가 1초 내). 마커 폭 3~4px 기준 물리적 겹침은 불가피하지만, 호버 툴팁으로 개별 확인 가능하고 클릭 시 가장 가까운 마커 선택.
3. **비디오 duration 0/NaN**: `duration > 0` 가드 필수. 로드 전에는 마커 렌더 스킵.
4. **LogContent scrollToEntryId**: 공용 컴포넌트 변경. optional prop이고 미전달 시 no-op이라 낮은 위험.
5. **툴팁 위치 계산**: progress bar가 화면 상단에 가까울 수 있으므로 위쪽 공간 부족 시 아래쪽 표시 fallback 필요.
6. **log-viewer 번들 크기**: 순수 UI 컴포넌트 추가라 크게 늘지 않을 것. 현재 ~328KB.
