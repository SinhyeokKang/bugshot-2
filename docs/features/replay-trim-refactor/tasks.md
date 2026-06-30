# Replay Trim 탭 리팩터 — 구현 태스크

## 선행 조건
- 신규 권한·env·OAuth·외부 API 없음. shadcn 신규 컴포넌트 설치 없음(`tabs`·`badge` 기존 사용).
- `MAX_FRAME_DURATION_MS`(`mp4-encoder.ts`), `REPLAY_LOG_GUARD_MS`(`log-merge.ts`)는 기존 export 사용.

## 태스크

### Task 1: 트림 경계 공유 헬퍼 (순수 함수)
- **변경 대상**: `src/sidepanel/30s-replay/trim-math.ts`
- **작업 내용**: `ReplayLogBounds` 타입, `replayLogTrimBounds(frames, inIndex, outIndex)`, `previewTrimBounds(frames, startSec, endSec, maxFrameDurationMs)`(전체 구간이면 `null`), `isTrimmedOut(absTs, bounds)` 추가. 경계 산출은 현재 `apply-trim.ts` 인라인 로직과 동일: `lower = inIndex===0 ? frames[inIndex].timestamp - REPLAY_LOG_GUARD_MS : frames[inIndex].timestamp`, `upper = outIndex===frames.length-1 ? undefined : frames[outIndex].timestamp`.
- **검증**:
  - [x] (선행 작성된) `trim-math` 단위 테스트 통과 — Task 2 참조
  - [x] `pnpm typecheck` 통과

### Task 2: 헬퍼 단위 테스트 (`/tdd interface` 선행)
- **변경 대상**: `src/sidepanel/30s-replay/__tests__/trim-math.test.ts`(기존 파일에 추가)
- **작업 내용**: `previewTrimBounds`/`replayLogTrimBounds`/`isTrimmedOut` 케이스 작성.
- **검증**:
  - [x] 전체 구간 선택 → `previewTrimBounds` `null`
  - [x] 시작만 트림(inIndex>0) → `lower = frames[inIndex].timestamp`, `upper = undefined`
  - [x] 끝만 트림(outIndex<last) → `lower = frames[0].timestamp - 1500`, `upper = frames[outIndex].timestamp`
  - [x] 양쪽 트림 → lower/upper 둘 다 내부 프레임 timestamp
  - [x] `isTrimmedOut`: 경계 안/밖/`upper===undefined`(상한 없음) 분기
  - [x] **parity(최우선)**: 같은 `frames`·`startSec`·`endSec`에 대해 `previewTrimBounds(frames, s, e, MAX_FRAME_DURATION_MS)`가, apply-trim 경로(=`secondsToFrameRange`로 얻은 inIndex/outIndex → `replayLogTrimBounds`)와 **동일한 lower/upper**를 내는지 비교. `maxFrameDurationMs` 동일값까지 한 테스트로 고정 → "흐림 = 실제 잘림" 회귀 차단.
  - [x] 빈 배열 `previewTrimBounds([], ...)` → `null`(크래시 없음), 단일 프레임도 `null`
  - [x] `pnpm test` 통과

### Task 3: apply-trim 헬퍼 사용으로 리팩터 (동작 불변)
- **변경 대상**: `src/sidepanel/30s-replay/apply-trim.ts`
- **작업 내용**: 인라인 `lower`/`upper` 계산을 `replayLogTrimBounds(frames, inIndex, outIndex)` 호출로 대체. `videoStartedAt`/`videoEndedAt`/`sliced` 계산은 유지.
- **검증**:
  - [x] 기존 `trim-math.test.ts`·`apply-trim.test.ts`(둘 다 실재) 그대로 통과 — 회귀 없음
  - [x] `videoStartedAt`(=`sliced[0].timestamp`)는 `replaceVideo`에도 쓰이므로 그대로 유지
  - [x] 리팩터 후 apply-trim의 `lower`/`upper`는 `replayLogTrimBounds` 출력과 동일 — apply-trim 직접 단위테스트는 영상 인코딩이 끼어 무겁다. 경계 정확성 보증은 Task 2의 헬퍼 parity 테스트로 충분(apply-trim은 그 헬퍼를 호출만 함). 별도 apply-trim 통합 테스트는 만들지 않는다.
  - [x] `pnpm typecheck` 통과

### Task 4: `*LogContent` muted prop 추가
- **변경 대상**: `src/sidepanel/components/ConsoleLogContent.tsx`, `NetworkLogContent.tsx`, `ActionLogContent.tsx`
- **작업 내용**: 공통 optional prop `isMuted?: (absTs: number) => boolean` 추가. 각 row 래퍼(`EntryAccordion`/`RequestRow`/`ActionRow`)에서 row timestamp(console·action=`timestamp`, network=`startTime`)로 호출, 참이면 `opacity-40` 클래스 + `data-muted` 속성. prop 미공급 시 무변화.
- **검증**:
  - [x] prop 없이 렌더 시 기존 동작 동일 — console/network는 라이브 서브탭·로그 뷰어·미리보기, **action은 로그 뷰어·미리보기 2곳**(라이브 서브탭 없음) 무영향
  - [x] `isMuted` 참인 row에 `opacity-40` + `data-muted` 적용, 레벨/상태 배경색은 유지
  - [x] network: `isMuted`는 좌측 `RequestRow`에만, 우측 상세 패널은 흐림 없음
  - [x] `pnpm typecheck` 통과

### Task 5: ReplayTrimDialog 탭 구조 전환
- **변경 대상**: `src/sidepanel/tabs/ReplayTrimDialog.tsx`
- **작업 내용**:
  - `frames: CapturedFrame[]` prop 추가, `activeTab: TrimTab` 상태(기본 `"video"`).
  - 정보 bar: 좌측 `selection` 초 표시 유지, 우측에 아이콘 4단 plain `Tabs`(영상=`Film`/콘솔/네트워크/동작, 아이콘 전용 + `aria-label`). 로그 탭에 카운트 `Badge`(`ml-1 h-5 min-w-5 shrink-0 px-1.5 text-[10px]`, 1000+ 는 `999+`). 영상 탭 Badge 없음. 로그 없는 탭 `disabled`. testid `replay-trim-tab-{video|console|network|action}`.
  - 가운데 영역: `<video>`는 상시 마운트, 로그 탭 3종 `*LogContent`(flush)는 **첫 활성화 때 마운트 후 유지**(`mounted` Record + `activate()`) — 숨긴 채 마운트 시 NetworkLogContent 폭 측정·tail 자동스크롤 무력화 방지. 비활성은 `hidden`(상태 보존). 각 LogContent에 `syncBaseMs={videoStartedAt ?? undefined}`, `isMuted`, `scrollToEntryId={activeTab===탭 ? focusEntryId : null}`, `onScrollComplete`로 focus 리셋.
  - muted: `bounds = useMemo(previewTrimBounds(frames, startSec, endSec, MAX_FRAME_DURATION_MS))`, `isMuted=useCallback((ts)=>bounds!=null && isTrimmedOut(ts, bounds), [bounds])`.
  - 재생: 로그 탭 진입 시 자동 일시정지, 재생 버튼 `disabled` 조건에 `activeTab!=="video"` 추가. 재생 버튼에 testid `replay-trim-play` 부착(e2e 판정용).
  - 마커 클릭: `setActiveTab(m.type) + setFocusEntryId(m.id)`. 수동 탭 전환 시 `setFocusEntryId(null)`.
  - 3개 `*LogPreviewDialog` import·렌더 제거(이 파일 한정). 고아 상태/ButtonGroup(정보 bar) import 정리.
- **검증**:
  - [ ] 4개 탭 전환·아이콘·카운트 Badge 표시(Badge 판정: 탭 trigger 내 텍스트 또는 Badge testid)
  - [ ] 탭 전환 후 재진입 시 필터/검색/스크롤 상태 보존(hidden 마운트)
  - [ ] 로그 탭에서 핸들 드래그 시 잘림 후보 row 흐림이 실시간 갱신
  - [ ] 트림/언두/리두/취소/제출이 모든 탭에서 동작
  - [ ] 재생 중 로그 탭 전환 시 자동 일시정지 + 재생버튼(`replay-trim-play`) 비활성
  - [ ] 마커 클릭 시 탭 전환 + 스크롤
  - [ ] PreviewDialog 제거가 타 호스트(PreviewPanel·DraftingPanel·DraftDetailDialog) 렌더에 무영향(타입체크 + 해당 화면 수동 1회)
  - [x] `pnpm typecheck` 통과

### Task 6: App.tsx frames 전달
- **변경 대상**: `src/sidepanel/App.tsx`
- **작업 내용**: `<ReplayTrimDialog frames={replay.pendingTrim.frames} ... />` 추가.
- **검증**:
  - [x] `pnpm typecheck` 통과

### Task 7: i18n 탭 라벨
- **변경 대상**: `src/i18n/namespaces/issue.ts`
- **작업 내용**: `issue.replay.trim.tab.video`(ko "영상" / en "Video") ko·en 동시 추가.
- **검증**:
  - [x] i18n PostToolUse 훅(locales.test) 통과(ko/en 대칭)

## 테스트 계획
- **단위 테스트**: `trim-math.test.ts` — `previewTrimBounds`(full/시작/끝/양쪽), `replayLogTrimBounds`, `isTrimmedOut` 경계. apply-trim 리팩터 전후 경계 동일성 고정.
- **e2e 시나리오**(`/e2e-write` 입력, 기존 `replay-trim*.spec.ts` 패턴 재사용):
  - `replay-trim-tab-console` 클릭하면 콘솔 로그 리스트가 보인다.
  - 각 로그 탭 trigger에 카운트 Badge 숫자가 로그 개수와 일치한다(탭 trigger 텍스트 또는 Badge testid로 판정).
  - 트림 핸들(슬라이더 키보드 드래그)을 안쪽으로 옮기면 구간 밖 로그 row에 `data-muted` 속성이 붙고, 구간 안 row엔 없다.
  - **흐림=실제잘림**: 콘솔 탭에서 `data-muted` row id를 기록 → 제출(`replay-trim-confirm`) → 오버레이가 닫히므로 **drafting preview(`replay-trim-logs.spec.ts`의 개수 N→M 패턴)에서** 그 row가 제거됐는지 단언(오버레이 안이 아니라 제출 후 화면에서 판정).
  - 재생(`replay-trim-play`) 시작 후 `replay-trim-tab-console` 전환 → `replay-trim-play`가 disabled.
  - 에러 마커 클릭 시 해당 로그 탭(`replay-trim-tab-{console|network}`)으로 전환된다.
- **수동 테스트**(captureVisibleTab/시각 의존):
  - 숨긴 영상이 로그 탭에서 멈춘 채 타임라인 스크럽이 정상인지.
  - muted opacity와 레벨/상태 색상이 동시에 식별되는지(다크모드 포함).
  - 네트워크 탭 상대 timestamp 표시.

## 구현 순서 권장
1. **Task 2(테스트) → Task 1(헬퍼)** — TDD. (`/tdd interface`로 Task 2 먼저)
2. **Task 3(apply-trim 리팩터)** — 헬퍼 확정 후, 회귀 테스트로 고정.
3. **Task 4(`*LogContent` prop)** — 독립적, Task 1과 병렬 가능.
4. **Task 5(ReplayTrimDialog)** — Task 1·4 완료 의존.
5. **Task 6(App)·Task 7(i18n)** — Task 5와 함께/직후. 서로 병렬 가능.

## 가이드 영향
사용자 노출 UX 변경(트림 오버레이에 로그 탭·muted 미리보기 추가) → 구현 후 `/guide`로 ko·en 갱신. 판단·작성 기준은 `guide/AUTHORING.md`.
- 30s Replay 트리밍을 설명하는 가이드 페이지(ko·en) — 트림 화면에서 로그 탭으로 잘림 후보를 미리 확인하는 절차 추가. (정확한 페이지 경로는 `/guide`가 `guide/` IA에서 확인.)
