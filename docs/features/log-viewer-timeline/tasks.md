# Log Viewer 통합 타임라인 패널 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변경 **없음**(클라이언트 온리, 기존 로그 데이터 정렬만).
- 신규 의존성 **없음**(ResizablePanel·lucide·log-colors 모두 기존).
- 참조 프리미티브 위치 확인 완료:
  - `src/sidepanel/components/LogSeekChip.tsx` — `LogSeekChip`(export됨)
  - `src/sidepanel/lib/logRow.tsx` — `formatRelativeTime`, `syncRowClass`
  - `src/sidepanel/components/ConsoleLogContent.tsx` — `LevelIcon`(56, 로컬), 메시지 렌더 헬퍼(`LinkifiedText`), `levelBgColor`, expand 패턴, `selectedId` 선례
  - `src/sidepanel/components/ActionLogContent.tsx` — `KindIcon`(44, 로컬), `renderActionContent(t, entry)`(125, `t` 파라미터화)
  - `src/sidepanel/components/NetworkLogContent.tsx` — `rowBg`, `isError`, `isPending`, `methodColor`, content-type 아이콘, 내부 `activeId`
  - `src/lib/log-colors.ts` — `consoleLevelTextClass`, `networkMethodTextClass`
  - `src/log-viewer/timeline.ts` — `findActiveIndex`, `toVideoSeconds`

## 태스크

### Task 1: `buildTimeline` + `timelineFillClass` 순수 모듈 (테스트 우선)
- **변경 대상**: `src/log-viewer/timeline-merge.ts` (신규), `src/log-viewer/__tests__/timeline-merge.test.ts` (신규)
- **작업 내용**:
  - `TimelineItem` 판별 유니온(action/console/network, 각 `id`·`absTs`·원본 참조) 정의.
  - `buildTimeline(consoleLog, networkLog, actionLog)`: 3종 flatten(console `timestamp` / network `startTime` / action `timestamp` → `absTs`) → `absTs` 오름차순 **안정 정렬**, 동일 `absTs`는 kind 우선순위(action=0<network=1<console=2) 타이브레이크. null 로그·빈 entries 안전 처리.
  - `timelineFillClass(item)`: console error→red / warn→amber, network `isError`→red / `isPending`→amber, 그 외(action·info·log)→`""`. 반환 클래스 문자열은 기존 `levelBgColor`·`rowBg` 값과 동일.
- **검증**:
  - [ ] 3종 혼합 입력이 시간순으로 병합됨
  - [ ] 동일 `absTs` 다발이 action→network→console 순으로 안정 정렬됨
  - [ ] null/빈 로그에서 빈 배열 또는 단일 타입만 반환
  - [ ] `timelineFillClass`가 error/warn/실패/pending만 틴트, 나머지 `""`
  - [ ] `pnpm test` 통과

### Task 2: VideoPlayer playhead lift-up
- **변경 대상**: `src/log-viewer/components/VideoPlayer.tsx`
- **작업 내용**: `VideoPlayerProps`에 `onTimeUpdate?: (sec: number) => void` 추가, 기존 `handleTimeUpdate`(55행 부근)에서 `setCurrentTimeSec` 직후 콜백 호출. `VideoPlayerHandle`·기존 마커/seek 동작 불변.
- **검증**:
  - [ ] `onTimeUpdate` 미공급 시 기존 동작 완전 동일
  - [ ] 재생 시 콜백이 초 단위 현재 시각을 방출
  - [ ] `pnpm typecheck` 통과

### Task 3: TimelineRow 컴포넌트
- **변경 대상**: `src/log-viewer/components/TimelineRow.tsx` (신규), 프리미티브 export(아래)
- **작업 내용**:
  - 행 골격: `[스파인 border-l] [LogSeekChip M:SS] [아이콘] [토큰] [주 텍스트] [우측 메타]`.
  - 스파인: 전 행 `border-l-2`, `isActive ? "border-l-foreground" : "border-l-muted"`.
  - 면색: `timelineFillClass(item)`.
  - 카테고리별 렌더:
    - action → `KindIcon` + `renderActionContent(t, entry)`(log-viewer `t` 주입), 토큰 없음, 면색 없음.
    - console → `LevelIcon` + 메시지, 토큰=`ERROR`/`WARN` 배지(info/log 생략), 우측=`file:line`, 에러/경고는 chevron→`entry.stack` 인라인 확장.
    - network → content-type/Globe 아이콘 + `METHOD·status`(color=`methodColor`/status) + 경로, 우측=소요시간 + "상세" 링크.
  - `onClick`(행 전체)→`onSeek(absTs)`. chevron·"상세"는 `stopPropagation`.
  - 필요한 로컬 헬퍼를 각 컴포넌트에서 **export**: `LevelIcon`·(console 메시지 헬퍼) from ConsoleLogContent, `KindIcon`·`renderActionContent` from ActionLogContent, content-type 아이콘·`methodColor`·`isError`·`isPending` from NetworkLogContent. (로직 이동 아님, export만 — 기존 동작 불변.)
- **검증**:
  - [ ] 3종 행이 카테고리별 아이콘·토큰 문법으로 구분됨
  - [ ] active 행만 스파인 `foreground`, 나머지 `muted`
  - [ ] error/warn/실패 행만 면색, action·info 투명
  - [ ] console 에러 chevron 확장/접기 동작
  - [ ] 기존 Console/Network/Action 탭 렌더 회귀 없음(export 후)

### Task 4: TimelinePanel (병합 리스트 + 동기화)
- **변경 대상**: `src/log-viewer/components/TimelinePanel.tsx` (신규)
- **작업 내용**:
  - props: `items`·`currentAbsMs`·`videoStartedAt`·`onSeek`·`onOpenNetworkDetail`.
  - `activeIdx = findActiveIndex(items.map(i => i.absTs), currentAbsMs)`.
  - `overflow-y-auto` 컨테이너에 `TimelineRow` 매핑. **타이틀·필터 없음**.
  - 자동 스크롤: `activeIdx` 변경 시 active 행 `scrollIntoView`, 단 `userScrolling` 플래그(스크롤 이벤트 후 ~2s) 동안은 스킵. seek/재생 재개 시 해제.
- **검증**:
  - [ ] 재생 중 active 행이 뷰에 유지(자동 스크롤)
  - [ ] 수동 스크롤 중엔 자동 스크롤이 끼어들지 않음
  - [ ] 로그 0건 시 빈 상태 처리(크래시 없음)

### Task 5: App 배선 + 좌측 세로 split + network 상세 라우팅
- **변경 대상**: `src/log-viewer/App.tsx`, `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**:
  - App: `currentTimeSec` state + `VideoPlayer onTimeUpdate` 배선, `currentAbsMs` 파생. `timelineItems = useMemo(buildTimeline(...))`.
  - App: 좌측 `ResizablePanel`의 **video 브랜치**를 `ResizablePanelGroup direction="vertical"`로 감싸 상단 `VideoPlayer`·하단 `TimelinePanel`(기본 62/38, minSize 30/20). screenshot 브랜치·`if (!video && !screenshot)` early return **무변경**.
  - App: `selectedNetworkId` state, `onOpenNetworkDetail={(id) => { setActiveTab("network"); setSelectedNetworkId(id); }}`. 우측 `NetworkLogContent`에 `selectedId={selectedNetworkId}` 전달.
  - NetworkLogContent: `selectedId?: string | null` prop 추가 → 값 변경 시 내부 `activeId` 동기화(외부 변경 시에만, 사용자 내부 선택 비파괴).
- **검증**:
  - [ ] 영상 리포트: 좌하 Timeline 뜨고 세로 리사이즈 동작
  - [ ] 스크린샷 리포트: Timeline 없음, 이미지 그대로
  - [ ] 노미디어 리포트: 우측 풀너비 그대로(early return 무변경)
  - [ ] 행 클릭 → 영상 seek
  - [ ] network "상세" → 우측 Network 탭 전환 + 요청 선택
  - [ ] `pnpm typecheck` 통과

### Task 6: i18n (log-viewer 복제 사전)
- **변경 대상**: `src/log-viewer/i18n.ts`, `src/log-viewer/__tests__/i18n.test.ts`(자동 검증)
- **작업 내용**: `koDict`/`enDict`에 `timeline.detail`("상세"/"Detail") + 필요 시 `timeline.empty` 추가(양쪽 동시). action 텍스트는 `renderActionContent`가 처리 → 추가 없음.
- **검증**:
  - [ ] ko/en 키 대칭·placeholder 일치(테스트 green)
  - [ ] `pnpm test` 통과

## 테스트 계획

- **단위 테스트**: `timeline-merge.test.ts` — `buildTimeline` 병합·안정 정렬·타이브레이크·null 처리, `timelineFillClass` 매핑. (`findActiveIndex`·`toVideoSeconds`는 기존 `timeline.test.ts`가 이미 커버.)
- **e2e 시나리오**(`/e2e-write` 입력, `data-testid` 추가 대상):
  - 영상+로그 리포트의 log-viewer를 열면 좌하에 Timeline 패널이 렌더된다.
  - Timeline 행을 클릭하면 영상 currentTime이 해당 시점으로 이동한다.
  - network 행 "상세"를 클릭하면 우측 탭이 Network로 전환되고 해당 요청 상세가 열린다.
  - 스크린샷만 있는 리포트에선 Timeline 패널이 렌더되지 않는다.
  - 노미디어 리포트에선 우측 탭이 풀너비다.
  - (영상 재생에 따른 active-follow·자동 스크롤은 재생 타이밍 의존이라 e2e 신뢰도 낮음 → 수동.)
- **수동 테스트**(Chrome, `pnpm build` 선행):
  - 재생 중 active 행이 스파인 `foreground`로 강조되고 자동 스크롤로 따라오는지(수동 스크롤 시 멈추는지).
  - error/warn/실패 행 면색이 우측 탭과 색 일치하는지(라이트/다크 모두).
  - console 에러 chevron 인라인 스택 확장.
  - 세로 split 리사이즈·기본 비율 체감.

## 구현 순서 권장

1. **Task 1**(순수 모듈·테스트) — 독립, 먼저.
2. **Task 2**(VideoPlayer lift-up)·**Task 3**(TimelineRow, 프리미티브 export) — 병렬 가능.
3. **Task 4**(TimelinePanel) — Task 1·3 의존.
4. **Task 5**(App 배선·network 라우팅) — Task 2·4 의존.
5. **Task 6**(i18n) — Task 3·5의 문자열 확정 후. (`src/i18n`이 아니라 log-viewer 사전이라 저장 훅 미적용 → `pnpm test`로 검증.)

## 가이드 영향

사용자 노출 UX(로그뷰어에 새 패널·인터랙션) → 아래 ko·en 대조·갱신 필요. `/guide`로 처리(`guide/AUTHORING.md` 규칙).
- `guide/ko/logs/*`·`guide/en/logs/*` — 로그 확인 흐름에 통합 타임라인 뷰 설명 추가
- `guide/ko/video/replay.md`·`guide/en/video/replay.md` — 리플레이(영상+로그 동기화) 설명에 Timeline 패널·행 클릭 seek 반영
