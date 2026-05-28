# Log Viewer Timeline Markers — 구현 태스크

## 선행 조건

- 없음. 새 외부 의존성·권한·환경 변수 불필요.

## 태스크

### Task 1: markers.ts — 마커 변환 순수 함수 + 테스트

- **변경 대상**: `src/log-viewer/markers.ts` (신규), `src/log-viewer/__tests__/markers.test.ts` (신규)
- **작업 내용**:
  - `MarkerType`, `TimelineMarker` 타입 정의 및 export
  - `buildMarkers(data, activeTab, videoDurationMs, videoStartedAt)` 구현:
    - `activeTab === "console"`: `consoleLog.entries` 중 `level === "error" || "warn"` 만 마커화
      - `label`: `[ERROR] {args 앞 80자}` / `[WARN] {args 앞 80자}`
    - `activeTab === "network"`: `networkLog.requests` 중 `phase === "pending" || "error"` 만 마커화
      - `label`: pending → `[Pending] {method} {url 뒤 60자}`, error → `[{status}] {method} {url 뒤 60자}`
    - `activeTab === "action"`: `actionLog.entries` 전체 마커화
      - `label`: click → `Click: {target}`, navigation → `Nav: {toUrl 뒤 60자}`, input → `Input: {fieldLabel}`
    - `positionPct = clamp(0, 100, toVideoSeconds(absTs, videoStartedAt) / (videoDurationMs / 1000) * 100)`
    - 해당 로그가 null이면 빈 배열 반환
    - `videoDurationMs <= 0`이면 빈 배열 반환
  - 단위 테스트:
    - 빈 데이터 → 빈 배열
    - console 탭: error/warn만 포함, log/info/debug 제외
    - network 탭: pending/error만 포함, complete 제외
    - action 탭: 전체 포함
    - positionPct 계산 정확성
    - 범위 밖 timestamp 클램프 (0%, 100%)
    - duration 0 → 빈 배열
    - label 생성 (truncation 포함)
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
    - 마커 색상:
      - Console: error=`bg-red-500`, warn=`bg-amber-500`
      - Network: error=`bg-red-500`, pending=`bg-amber-500`
      - Action: `bg-primary`
    - 색상 결정은 `marker.type` + label 접두사 또는 별도 `variant` 필드로
  - 클릭 seek: 바 영역 클릭 → `(clientX - rect.left) / rect.width * 100` → `onSeek(pct)`
  - 드래그: `onPointerDown` → `setPointerCapture` → `onPointerMove`(실시간 seek) → `onPointerUp`(해제)
  - 마커 클릭 vs 드래그 판별: `pointerdown` 위치에서 5px 이상 이동하면 드래그, 아니면 `onMarkerClick`
  - 툴팁:
    - 마커 `onMouseEnter` → 내부 상태에 `hoveredMarker` + 마우스 위치 세팅
    - 마커 위쪽에 절대 위치 div: `bg-popover text-popover-foreground shadow-md rounded px-2 py-1 text-xs max-w-xs truncate`
    - `onMouseLeave` → 해제
    - 위쪽 공간 부족 시(bar가 화면 상단에 가까울 때) 아래쪽 표시
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
  - 시간 포맷: `formatPlayerTime(sec)` 내부 헬퍼 — `Math.floor(sec/60):pad2(sec%60)`
- **검증**:
  - [ ] play/pause 토글 동작
  - [ ] progress bar가 재생 중 실시간 갱신
  - [ ] 시간 표시가 MM:SS / MM:SS 형식
  - [ ] 비디오 에러 시 에러 메시지 표시
  - [ ] `seekTo` 메서드가 외부에서 호출 가능

### Task 4: App.tsx 통합 — VideoPlayer 교체 + 양방향 동기화

- **변경 대상**: `src/log-viewer/App.tsx`
- **작업 내용**:
  - 네이티브 `<video controls>` 블록을 `<VideoPlayer>` 로 교체
  - 상태 추가:
    - `currentTimeMs: number | null` — 비디오의 현재 absolute timestamp
    - `videoDurationMs: number` — 비디오 전체 길이 (ms)
    - `scrollToEntryId: string | null` — 마커 클릭 시 세팅
  - `buildMarkers(data, activeTab, videoDurationMs, video.startedAt)` 호출 → `useMemo`로 메모이제이션
  - `onTimeUpdate(sec)` → `setCurrentTimeMs(video.startedAt + sec * 1000)`
  - `onDurationChange(sec)` → `setVideoDurationMs(sec * 1000)`
  - `onMarkerClick(marker)`:
    1. VideoPlayer ref의 `seekTo(toVideoSeconds(marker.absTs, video.startedAt))`
    2. `setScrollToEntryId(marker.id)`
    3. 마커 type ≠ 현재 activeTab이면 `setActiveTab(marker.type)` — 실제로는 탭 연동이라 항상 같은 type이지만, 방어적으로
  - 기존 `seekTo` 함수 수정: `videoRef.current` 직접 접근 대신 VideoPlayer ref의 `seekTo` 사용
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
    3. 리셋 후 다음 렌더에서 재시도 (useEffect dependency로 자연스럽게)
    4. 찾으면: `scrollIntoView({ block: "center", behavior: "smooth" })`
    5. 스크롤 후 `onScrollComplete?.()` 호출
- **검증**:
  - [ ] 마커 클릭 시 로그 패널이 해당 항목으로 스크롤
  - [ ] 필터로 숨겨진 항목도 필터 리셋 후 스크롤
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
