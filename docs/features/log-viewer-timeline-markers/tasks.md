# Log Viewer Timeline Markers — 구현 태스크

## 선행 조건

- 없음. 새 외부 의존성·권한·환경 변수 불필요.

## 태스크

### Task 1: markers.ts — 마커 변환 순수 함수 + 테스트

- **변경 대상**: `src/log-viewer/markers.ts` (신규), `src/log-viewer/__tests__/markers.test.ts` (신규)
- **작업 내용**:
  - `MarkerType`, `MarkerVariant`, `TimelineMarker` 타입 정의 및 export
    - `MarkerVariant = "error" | "warn" | "pending" | "default"` — 마커 색상 결정용
  - `buildMarkers(data, activeTab, videoDurationSec, videoStartedAt)` 구현:
    - `activeTab === "console"`: `consoleLog.entries` 중 `level === "error" || "warn"` 만 마커화
      - `absTs`: `entry.timestamp`
      - `variant`: error → `"error"`, warn → `"warn"`
      - `label`: `[ERROR] {args 앞 80자}` / `[WARN] {args 앞 80자}`
    - `activeTab === "network"`: `networkLog.requests` 중 `phase === "error"` OR `phase === "pending"` OR (`phase !== "pending"` AND `status >= 400`) 만 마커화
      - `absTs`: `request.startTime` (NetworkRequest는 `timestamp`가 아닌 `startTime` 필드 사용)
      - `variant`: phase=error 또는 status≥400 → `"error"`, phase=pending → `"pending"`
      - `label`: pending → `[Pending] {method} {url 뒤 60자}`, error → `[{status}] {method} {url 뒤 60자}`
    - `activeTab === "action"`: `actionLog.entries` 전체 마커화
      - `absTs`: `entry.timestamp`
      - `variant`: `"default"`
      - `label`: click → `Click: {target}`, navigation → `Nav: {toUrl 뒤 60자}`, input → `Input: {fieldLabel}`
    - `positionPct = clamp(0, 100, toVideoSeconds(absTs, videoStartedAt) / videoDurationSec * 100)`
    - 해당 로그가 null이면 빈 배열 반환
    - `videoDurationSec <= 0`이면 빈 배열 반환
  - 단위 테스트:
    - 빈 데이터 → 빈 배열
    - console 탭: error/warn만 포함, log/info/debug 제외
    - network 탭: phase=error, phase=pending, status≥400 포함. phase=complete + status<400 제외
    - network 탭: status 500 + phase complete는 마커에 포함 (서버 에러 응답)
    - action 탭: 전체 포함
    - positionPct 계산 정확성
    - 범위 밖 timestamp 클램프 (0%, 100%)
    - duration 0 → 빈 배열
    - label 생성 (truncation 포함)
    - variant 값 정확성 (error/warn/pending/default)
- **검증**:
  - [ ] `pnpm test` 통과
  - [ ] 서브타입 필터가 정확히 동작
  - [ ] label truncation이 80자/60자 기준으로 동작

### Task 2: ProgressBar.tsx — progress bar + 마커 오버레이 + 툴팁

- **변경 대상**: `src/log-viewer/components/ProgressBar.tsx` (신규)
- **작업 내용**:
  - 가로 바 (`div`, relative, `h-2 bg-muted rounded-full`) + 진행 표시 (`div`, 비율 width, `bg-primary`)
  - 마커 렌더: `markers.map(m => <button>)`, `left: {m.positionPct}%` absolute 위치
    - 마커 크기: 3~4px 폭, bar 높이 채움
    - 마커 색상: `marker.variant` 기반 (label 파싱 금지)
      - `"error"` → `bg-red-500`, `"warn"` → `bg-amber-500`, `"pending"` → `bg-amber-500`, `"default"` → `bg-primary`
  - 클릭 seek: 바 영역 클릭 → `(clientX - rect.left) / rect.width * 100` → `onSeek(pct)`
  - 드래그: `onPointerDown` → `setPointerCapture` → `onPointerMove`(실시간 seek) → `onPointerUp`(해제)
  - 마커 클릭 vs 드래그 판별: `pointerdown` 위치에서 5px 이상 이동하면 드래그, 아니면 `onMarkerClick`
  - 툴팁 (picker overlay DOM 정보 툴팁 패턴 — `src/content/overlay.ts` inspector 모드 참조):
    - 마커 `onMouseEnter` → 내부 상태에 `hoveredMarker` + 마우스 위치 세팅
    - 마커 위쪽에 절대 위치 div: `bg-popover text-popover-foreground shadow-md rounded-xl px-2 py-1.5 text-xs max-w-xs truncate`
    - `onMouseLeave` → 해제
    - 위쪽 공간 부족 시 아래쪽 표시 (overlay.ts `placeLabel` 동일 로직)
    - Radix Tooltip 미사용: 마커가 3~4px로 매우 작아 trigger 영역 부적절 + 포인터 추적 필요
- **검증**:
  - [ ] bar 클릭 시 비디오 seek 동작
  - [ ] 마커가 시간 비례 위치에 표시
  - [ ] 드래그 seek 동작
  - [ ] 마커 클릭 시 `onMarkerClick` 호출 (드래그와 미충돌)
  - [ ] 마커 호버 시 툴팁 표시, 마우스 떠나면 사라짐

### Task 3: VideoPlayer.tsx — 커스텀 비디오 플레이어

- **변경 대상**: `src/log-viewer/components/VideoPlayer.tsx` (신규)
- **작업 내용**:
  - `<video>` 렌더 (controls 제거, poster/src 전달, `object-contain`, `bg-black`)
  - 하단 controls 레이아웃 (`flex items-center gap-2 px-3 py-2 bg-muted/50 border-t`):
    - 왼쪽: play/pause 버튼 (lucide `Play`/`Pause` 아이콘, `h-8 w-8`)
    - 중앙: `ProgressBar` (flex-1, 마커 포함)
    - 오른쪽: `currentTime / duration` 텍스트 (`text-xs font-mono text-muted-foreground`, `MM:SS / MM:SS`)
  - 비디오 이벤트 연결:
    - `onTimeUpdate` → `props.onTimeUpdate(video.currentTime)` + 내부 `currentTimeSec` 상태 갱신
    - `onLoadedMetadata` / `onDurationChange` → `props.onDurationChange(video.duration)` + 내부 `durationSec` 상태
    - `onPlay`/`onPause` → 내부 `isPlaying` 상태 갱신
    - `onError` → `props.onError()`
    - `onEnded` → `isPlaying = false`
  - bar seek: `onSeek(pct)` → `video.currentTime = durationSec * pct / 100`
  - `forwardRef` + `useImperativeHandle`: `seekTo(timeSec: number)` 메서드 노출 — App에서 로그 항목 클릭 시 사용
  - 시간 포맷: `formatPlayerTime(sec)` 순수 함수 — `Math.floor(sec/60):pad2(sec%60)`. export하여 단위 테스트 대상.
  - `seekToSec(timeSec)` 메서드를 `forwardRef` + `useImperativeHandle`로 노출. 파라미터는 video-relative 초 단위 (기존 `seekTo(absTs)` — absolute ms — 와 구분).
- **검증**:
  - [ ] play/pause 토글 동작
  - [ ] progress bar가 재생 중 실시간 갱신
  - [ ] 시간 표시가 MM:SS / MM:SS 형식
  - [ ] 비디오 에러 시 에러 메시지 표시
  - [ ] `seekToSec` 메서드가 외부에서 호출 가능
  - [ ] `formatPlayerTime` 단위 테스트: 정상 값, 0, NaN, Infinity, 음수

### Task 4: App.tsx 통합 — VideoPlayer 교체 + 양방향 동기화

- **변경 대상**: `src/log-viewer/App.tsx`
- **작업 내용**:
  - 네이티브 `<video controls>` 블록을 `<VideoPlayer>` 로 교체
  - 상태 추가:
    - `currentTimeMs: number | null` — 비디오의 현재 absolute timestamp
    - `videoDurationSec: number` — 비디오 전체 길이 (초). video API가 초 단위이므로 불필요한 ms↔sec 변환 제거.
    - `scrollToEntryId: string | null` — 마커 클릭 시 세팅
  - `buildMarkers(data, activeTab, videoDurationSec, video.startedAt)` 호출 → `useMemo`로 메모이제이션
  - `onTimeUpdate(sec)` → `setCurrentTimeMs(video.startedAt + sec * 1000)`
  - `onDurationChange(sec)` → `setVideoDurationSec(sec)`
  - `onMarkerClick(marker)`:
    1. VideoPlayer ref의 `seekToSec(toVideoSeconds(marker.absTs, video.startedAt))` — seek만, play 호출 안 함 (재생 상태 유지)
    2. `setScrollToEntryId(marker.id)`
    3. 마커 type ≠ 현재 activeTab이면 `setActiveTab(marker.type)` — 실제로는 탭 연동이라 항상 같은 type이지만, 방어적으로
  - 기존 `seekTo` 함수 수정: `videoRef.current` 직접 접근 대신 VideoPlayer ref의 `seekToSec` 사용. `sync.onSeek`에 전달되는 함수도 absTs → `toVideoSeconds` → `seekToSec` 체인으로 교체. LogSeekChip의 기존 동작 유지 확인 필수.
  - `activeTs={currentTimeMs}` 를 ConsoleLogContent / NetworkLogContent / ActionLogContent에 전달
  - `scrollToEntryId={scrollToEntryId}` 전달 + 스크롤 완료 후 `onScrollComplete={() => setScrollToEntryId(null)}` 콜백
- **검증**:
  - [ ] 비디오 재생 중 현재 로그 항목이 하이라이트됨
  - [ ] 탭 전환 시 마커가 해당 종류로 변경됨
  - [ ] 마커 클릭 → 비디오 seek + 로그 스크롤
  - [ ] 로그 항목의 LogSeekChip 클릭 → 비디오 seek (기존 동작 유지)
  - [ ] 비디오 없을 때 기존 동작 유지

### Task 5: LogContent 컴포넌트에 scrollToEntryId 지원 추가

- **변경 대상**: `src/sidepanel/components/ConsoleLogContent.tsx`, `NetworkLogContent.tsx`, `ActionLogContent.tsx`
- **작업 내용**:
  - optional prop 추가: `scrollToEntryId?: string`, `onScrollComplete?: () => void`
  - 행의 DOM에 `data-entry-id={entry.id}` 속성 추가 (아직 없는 경우)
  - `useEffect`로 `scrollToEntryId` 변경 감지:
    1. 해당 id의 행을 `querySelector(`[data-entry-id="${id}"]`)` 로 찾기
    2. 못 찾으면: 현재 필터(level/type 등)에 의해 숨겨진 상태 → 필터를 "전체"로 리셋
    3. 리셋 후에도 못 찾으면 **bail out** — `onScrollComplete?.()` 호출해 `scrollToEntryId`를 null로 초기화 (무한 루프 방지). `useEffect` dependency에 필터 상태 포함해 리셋 후 재실행되도록.
    4. 찾으면: `scrollIntoView({ block: "center", behavior: "smooth" })`
    5. 스크롤 후 `onScrollComplete?.()` 호출
  - **NetworkLogContent 특수 처리**: list-detail 2분할 구조이므로:
    - 좌측 리스트 ScrollArea 내에서 행을 찾아 스크롤
    - `setActiveId(marker.id)` 호출로 detail 패널도 연동
  - **Radix ScrollArea 호환성**: `scrollIntoView`가 Radix ScrollArea viewport를 올바르게 인식하는지 구현 시 검증
- **검증**:
  - [ ] 마커 클릭 시 로그 패널이 해당 항목으로 스크롤
  - [ ] 필터로 숨겨진 항목도 필터 리셋 후 스크롤
  - [ ] 리셋 후에도 못 찾으면 bail out (무한 루프 없음)
  - [ ] NetworkLogContent: 스크롤 + detail 패널 연동 (activeId 설정)
  - [ ] 사이드패널에서 prop 미전달 시 기존 동작 변화 없음

### Task 6: i18n 키 추가

- **변경 대상**: `src/log-viewer/i18n.ts`
- **작업 내용**:
  - ko/en 동시 추가:
    - `logViewer.player.play`: "재생" / "Play"
    - `logViewer.player.pause`: "일시정지" / "Pause"
- **검증**:
  - [ ] `pnpm test` 통과

## 테스트 계획

### 단위 테스트

- `markers.test.ts`:
  - `buildMarkers` — 빈 데이터, 서브타입 필터, positionPct 계산, 클램프, duration 가드, label truncation

### 수동 테스트 (Chrome)

- [ ] logs.html 열어서 커스텀 플레이어가 정상 렌더되는지
- [ ] play/pause 동작
- [ ] progress bar 클릭 → seek
- [ ] progress bar 드래그 → 실시간 seek
- [ ] Console 탭: error/warn 마커만 표시. 마커 색상 구분 (red/amber)
- [ ] Network 탭: pending/error 마커만 표시
- [ ] Action 탭: 전체 마커 표시
- [ ] 탭 전환 시 마커가 즉시 변경
- [ ] 마커 호버 → 로그 요약 툴팁 표시
- [ ] 마커 클릭 → 비디오 seek + 로그 스크롤 + 하이라이트
- [ ] 비디오 재생 중 로그 항목 하이라이트가 따라가는지
- [ ] 로그 항목의 시간 칩 클릭 → 비디오 seek (기존 동작 유지)
- [ ] 비디오 없는 logs.html → 로그만 표시 (회귀 없음)
- [ ] 비디오 에러 시 에러 메시지 표시

## 구현 순서 권장

```
Task 1 (markers.ts + 테스트)  ─┐
Task 6 (i18n)                 ─┤─ 독립, 병렬 가능
                               │
                               ▼
Task 2 (ProgressBar)          ─── Task 1 의존 (TimelineMarker 타입)
                               │
                               ▼
Task 3 (VideoPlayer)          ─── Task 2 의존
                               │
                               ▼
Task 5 (LogContent scroll)    ─── 독립 가능하지만 통합 전 준비
                               │
                               ▼
Task 4 (App.tsx 통합)          ─── Task 3, 5 의존. 최종 통합.
```

Task 1과 Task 6은 병렬 가능. Task 5는 Task 4 전에만 완료되면 된다.
