# Log Viewer 통합 타임라인 패널 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변경 **없음**(클라이언트 온리, 기존 로그 데이터 정렬만). AI 임베드(`__BUGSHOT_AI__`/`__BUGSHOT_DATA__`)·`buildLogsHtml.ts` 무변경.
- 신규 의존성 **없음**(ResizablePanel·lucide·log-colors 모두 기존. 가상화 미도입).
- 참조 프리미티브 위치 확인 완료:
  - `src/sidepanel/components/LogSeekChip.tsx` — `LogSeekChip`(export됨)
  - `src/sidepanel/lib/logRow.ts` — `formatRelativeTime`, `syncRowClass`
  - `src/sidepanel/components/LinkifiedText.tsx` — 독립 export 모듈(export 작업 불필요)
  - `src/sidepanel/components/ConsoleLogContent.tsx` — `LevelIcon`(56, 로컬), `levelBgColor`(38, 로컬), expand 패턴
  - `src/sidepanel/components/ActionLogContent.tsx` — `KindIcon`(44, 로컬), `renderActionContent(t, entry)`(125, `t` 파라미터화), `searchText`(162, 로컬)
  - `src/sidepanel/components/NetworkLogContent.tsx` — `rowBg`(57, 로컬 — hover 변형 포함이라 base 틴트 분리 필요), `isError`(47), `isPending`(53), `methodColor`, content-type 아이콘, `useScrollToEntry` 배선(256-264)
  - `src/lib/log-colors.ts` — `consoleLevelTextClass`, `networkMethodTextClass`
  - `src/lib/network-search.ts` — `requestMatchesQuery`(export됨)
  - `src/log-viewer/timeline.ts` — `findActiveIndex`, `toVideoSeconds`
  - `src/log-viewer/App.tsx` — `seekTo`(76), `handleMarkerClick`(92, `setActiveTab`+`setScrollToEntryId` — network "상세"가 재사용할 경로), early return(257 부근), video 브랜치(264)

## 태스크

### Task 1: 프리미티브 export + `buildTimeline`·`matchesTimelineItem`·`timelineFillClass` 순수 모듈 (테스트 우선)
- **변경 대상**: `src/sidepanel/components/ConsoleLogContent.tsx`·`NetworkLogContent.tsx`·`ActionLogContent.tsx`(export만), `src/log-viewer/timeline-merge.ts` (신규), `src/log-viewer/__tests__/timeline-merge.test.ts` (신규)
- **작업 내용**:
  - 프리미티브 export(로직 이동 없음, 기존 동작 불변): `levelBgColor`(Console), `isError`·`isPending`(Network), `searchText`(Action). Network `rowBg`는 hover·선택 변형이 구워져 있으므로 **base 틴트 함수를 분리 export**하고 기존 `rowBg` 합성부가 그걸 쓰도록 재구성(단일 출처).
  - `TimelineItem` 판별 유니온(action/console/network, 각 `id`·`absTs`·원본 참조) 정의.
  - `buildTimeline(consoleLog, networkLog, actionLog)`: 3종 flatten(console `timestamp` / network `startTime` / action `timestamp` → `absTs`) → `absTs` 오름차순 **안정 정렬**, 동일 `absTs`는 kind 우선순위(action=0<network=1<console=2) 타이브레이크. null 로그·빈 entries 안전 처리.
  - `matchesTimelineItem(item, kinds, query)`: 타입 토글 + 검색 매칭. console=`entry.args` includes / network=`requestMatchesQuery` / action=`searchText` includes.
  - `timelineFillClass(item)`: **기존 배경색 함수 위임** — console=`levelBgColor(entry.level)`(info blue 포함, 우측 탭과 완전 sync), network=`isError`/`isPending` 분기로 base 틴트, action=`""`. 값 복제 금지.
- **검증**:
  - [x] 3종 혼합 입력이 시간순으로 병합됨
  - [x] 동일 `absTs` 다발이 action→network→console 순으로 안정 정렬됨
  - [x] null/빈 로그에서 빈 배열 또는 단일 타입만 반환
  - [x] `matchesTimelineItem` — 타입 토글·검색어(kind별 매칭 경로)·빈 query 케이스
  - [x] `timelineFillClass`가 위임 함수 반환값과 동일(console 전 레벨 — info blue 포함, network error/pending, action `""`)
  - [x] 기존 3종 컴포넌트 렌더 테스트 회귀 없음(export·rowBg base 분리 후) — `pnpm test` 통과

### Task 2: VideoPlayer playhead 콜백
- **변경 대상**: `src/log-viewer/components/VideoPlayer.tsx`
- **작업 내용**: `VideoPlayerProps`에 `onTimeUpdate?: (sec: number) => void` 추가, 기존 `handleTimeUpdate`(55행 부근)에서 `setCurrentTimeSec` 직후 콜백 호출. `VideoPlayerHandle`·기존 마커/seek 동작 불변.
- **검증**:
  - [x] `onTimeUpdate` 미공급 시 기존 동작 완전 동일
  - [ ] 재생 시 콜백이 초 단위 현재 시각을 방출 — jsdom 렌더 테스트에서 `<video>`에 `timeupdate` dispatch로 판정(어려우면 Task 5 수동 검증으로 이연 명시)
  - [x] `pnpm typecheck` 통과

### Task 3: TimelineRow 컴포넌트 (+ jsdom 테스트)
- **변경 대상**: `src/log-viewer/components/TimelineRow.tsx` (신규), `src/log-viewer/components/__tests__/TimelineRow.test.tsx` (신규), 잔여 프리미티브 export(`LevelIcon`·`KindIcon`·`renderActionContent`·`methodColor`·content-type 아이콘)
- **작업 내용**:
  - 행 골격: `[스파인 border-l] [LogSeekChip M:SS] [아이콘] [토큰] [주 텍스트] [우측 메타]`. `React.memo`로 감싼다(`isActive` 외 props 참조 안정 전제).
  - 스파인: 전 행 `border-l-2`, `isActive ? "border-l-primary" : "border-l-muted"`. active 행 `aria-current="true"`.
  - 면색: `timelineFillClass(item)`.
  - 카테고리별 렌더:
    - action → `KindIcon` + `renderActionContent(t, entry)`(log-viewer `t` 주입), 토큰 없음, 면색 없음.
    - console → `LevelIcon` + 메시지(`LinkifiedText`), **텍스트 배지 없음**(레벨은 아이콘+면색으로만 — 기존 탭 문법 통일), 우측=`file:line`, 에러/경고는 chevron→`entry.stack` 인라인 확장.
    - network → content-type/Globe 아이콘 + `METHOD·status`(color=`methodColor`/status) + 경로, 우측=소요시간 + "상세" 링크(패딩으로 히트 영역 확보).
  - 접근성: 행 전체 `<button>`(또는 `role="button"`+`tabIndex`) — 클릭/Enter=`onSeek(absTs)`. chevron·"상세"는 별도 포커스 스톱 + `stopPropagation`.
- **검증** (`TimelineRow.test.tsx` — jsdom):
  - [x] 3종 행이 카테고리별 아이콘·토큰 문법으로 구분 렌더됨
  - [x] active 행만 스파인 `primary` + `aria-current`, 나머지 `muted`
  - [x] 면색이 `timelineFillClass` 결과와 일치(console info blue 포함)
  - [x] console 에러 chevron 확장/접기 동작
  - [x] 행 클릭=onSeek 호출, chevron·"상세" 클릭 시 onSeek 미호출(stopPropagation)
  - [x] 기존 Console/Network/Action 탭 렌더 회귀 없음 — `pnpm test` 통과

### Task 4: TimelinePanel (병합 리스트 + 필터·검색 + 동기화)
- **변경 대상**: `src/log-viewer/components/TimelinePanel.tsx` (신규)
- **작업 내용**:
  - props: `items`·`videoStartedAt`·`setTimeListener`·`onSeek`·`onOpenNetworkDetail`.
  - playhead: `setTimeListener`로 구독 등록 → 내부 state `currentAbsMs = videoStartedAt + sec*1000`. **App state 없음**(리렌더 격리).
  - 상단 컴팩트 바: 타입 토글 3개(console/network/action) + 검색 인풋. `matchesTimelineItem`으로 필터된 리스트 렌더. **패널 타이틀 없음**.
  - `activeIdx = findActiveIndex(filtered.map(i => i.absTs), currentAbsMs)`. `activeIdx === -1`(첫 행 이전)이면 active 행 없음 + 자동 스크롤 스킵.
  - 자동 스크롤: `activeIdx` 변경 시 active 행 `scrollIntoView({ block: "nearest" })`. `userScrolling` 플래그(스크롤 이벤트 후 ~2s) 동안 스킵하되 **programmatic 스크롤이 발화한 scroll 이벤트는 가드 판정에서 제외**. seek/재생 재개 시 해제.
  - 빈 상태: 로그 0건 → `timeline.empty`, 필터·검색 결과 0건 → `timeline.filterEmpty`(DESIGN.md §14 관용 — `text-sm text-muted-foreground/70`).
- **검증**:
  - [ ] 재생 중 active 행이 뷰에 유지(자동 스크롤), `activeIdx === -1`이면 강조·스크롤 없음(크래시 없음)
  - [ ] 수동 스크롤 중엔 자동 스크롤이 끼어들지 않고, 자동 스크롤 자신이 가드를 오염시키지 않음
  - [ ] 타입 토글·검색이 리스트에 적용되고 결과 0건 시 `timeline.filterEmpty` 표시
  - [ ] 로그 0건 시 `timeline.empty` 표시(크래시 없음)

### Task 5: App 배선 + 좌측 세로 split + network 상세 라우팅
- **변경 대상**: `src/log-viewer/App.tsx` (**NetworkLogContent 무변경** — 기존 경로 재사용)
- **작업 내용**:
  - `timelineItems = useMemo(buildTimeline(...))`.
  - playhead ref 중계: `timeListener` ref + 안정 콜백(useCallback)을 `VideoPlayer onTimeUpdate`에, 등록 함수를 `TimelinePanel setTimeListener`에 전달.
  - 좌측 `ResizablePanel`의 **video 브랜치**를 `ResizablePanelGroup direction="vertical"`로 감싸 상단 `VideoPlayer`·하단 `TimelinePanel`(기본 62/38, minSize 30/20). 세로 `ResizableHandle`에 기존 가로 핸들 blue hover 커스텀을 축 반전 미러링. screenshot 브랜치·`if (!video && !screenshot)` early return **무변경**.
  - `onOpenNetworkDetail={(id) => { setActiveTab("network"); setScrollToEntryId(id); }}` — 기존 `handleMarkerClick` 경로 재사용.
- **검증**:
  - [ ] 영상 리포트: 좌하 Timeline 뜨고 세로 리사이즈 동작(중첩 그룹 상호작용 포함)
  - [ ] 스크린샷 리포트: Timeline 없음, 이미지 그대로
  - [ ] 노미디어 리포트: 우측 풀너비 그대로(early return 무변경)
  - [ ] 행 클릭 → 영상 seek
  - [ ] network "상세" → 우측 Network 탭 전환 + 요청 스크롤·선택(필터에 걸린 요청도 `resetFilters` 보정으로 도달)
  - [ ] 재생 중 우측 탭·VideoPlayer가 timeupdate로 리렌더되지 않음(React DevTools 확인)
  - [ ] 기존 마커 클릭 동선(우측 탭 전환+스크롤) 현행 유지
  - [x] `pnpm typecheck` 통과

### Task 6: i18n (log-viewer 복제 사전)
- **변경 대상**: `src/log-viewer/i18n.ts`, `src/log-viewer/__tests__/i18n.test.ts`(자동 검증)
- **작업 내용**: `koDict`/`enDict`에 `timeline.detail`("상세"/"Detail"), `timeline.empty`(필수), `timeline.searchPlaceholder`, `timeline.filterEmpty` 추가(양쪽 동시). 타입 토글 라벨은 기존 탭 라벨 키 재사용 우선, 없으면 신설. action 텍스트는 `renderActionContent`가 처리 → 추가 없음.
- **검증**:
  - [x] ko/en 키 대칭·placeholder 일치(테스트 green)
  - [x] `pnpm test` 통과

## 테스트 계획

- **단위 테스트 (node)**: `timeline-merge.test.ts` — `buildTimeline` 병합·안정 정렬·타이브레이크·null 처리, `matchesTimelineItem` 타입·검색 매칭, `timelineFillClass` 위임 동일성. (`findActiveIndex`·`toVideoSeconds`는 기존 `timeline.test.ts`가 이미 커버.)
- **단위 테스트 (jsdom)**: `TimelineRow.test.tsx` — 카테고리 렌더·active 스파인·면색·chevron 확장·stopPropagation. (Task 3 참조.)
- **기존 테스트 회귀**: 프리미티브 export·`rowBg` base 분리 후 기존 3종 LogContent 렌더 테스트 포함 `pnpm test` green.
- **e2e 시나리오**(`/e2e-write` 입력, `data-testid` 추가 대상):
  - 영상+로그 리포트의 log-viewer를 열면 좌하에 Timeline 패널이 렌더된다.
  - Timeline 행을 클릭하면 영상 currentTime이 해당 시점으로 이동한다.
  - 타입 토글을 끄면 해당 kind 행이 사라지고, 검색어 입력 시 매칭 행만 남는다(0건이면 빈 문구).
  - network 행 "상세"를 클릭하면 우측 탭이 Network로 전환되고 해당 요청 상세가 열린다.
  - 스크린샷만 있는 리포트에선 Timeline 패널이 렌더되지 않는다.
  - 노미디어 리포트에선 우측 탭이 풀너비다.
  - **기존 spec green 유지**: `e2e/logview/log-viewer-sync.spec.ts`(마커 렌더·마커 클릭→탭 전환·행 클릭→seek·`log-rel-time` 칩)·`e2e/logview/log-viewer.spec.ts`(분할 모드)·`e2e/log-insert.spec.ts`(`[data-entry-id]` 클릭 경로) — 기존 `data-testid`·`[data-entry-id]` DOM 위치 보존.
  - (영상 재생에 따른 active-follow·자동 스크롤은 재생 타이밍 의존이라 e2e 신뢰도 낮음 → 수동.)
- **수동 테스트**(Chrome, `pnpm build` 선행):
  - 재생 중 active 행이 스파인 `primary`로 강조되고 자동 스크롤로 따라오는지(수동 스크롤 시 멈추는지, 자동 스크롤이 스스로 가드를 켜지 않는지).
  - 행 면색이 우측 탭과 색 일치하는지 — console info blue 포함(라이트/다크 모두).
  - console 에러 chevron 인라인 스택 확장.
  - 세로 split 리사이즈·기본 비율 체감 + minSize 30%에서 영상 컨트롤 오버레이 잠식 + 가로·세로 중첩 그룹 상호작용.
  - **cap 최대치 로그**(console 2000+network 5000+action 1000 근사)에서 재생·스크롤 체감(비가상 렌더 검증).

## 구현 순서 권장

1. **Task 1**(프리미티브 export + 순수 모듈·테스트) — 먼저. export가 여기 포함되므로 이후 태스크의 전제.
2. **Task 2**(VideoPlayer 콜백)·**Task 3**(TimelineRow) — **Task 1 완료 후** 병렬 가능.
3. **Task 4**(TimelinePanel) — Task 1·3 의존.
4. **Task 5**(App 배선·network 라우팅) — Task 2·4 의존.
5. **Task 6**(i18n) — Task 3·4·5의 문자열 확정 후. (`src/i18n`이 아니라 log-viewer 사전이라 저장 훅 미적용 → `pnpm test`로 검증.)

## 가이드 영향

사용자 노출 UX(로그뷰어에 새 패널·필터·검색·인터랙션) → 아래 ko·en 대조·갱신 필요. `/guide`로 처리(`guide/AUTHORING.md` 규칙).
- `guide/ko/logs/*`·`guide/en/logs/*` — 로그 확인 흐름에 통합 타임라인 뷰(필터·검색 포함) 설명 추가
- `guide/ko/video/replay.md`·`guide/en/video/replay.md` — 리플레이(영상+로그 동기화) 설명에 Timeline 패널·행 클릭 seek 반영
