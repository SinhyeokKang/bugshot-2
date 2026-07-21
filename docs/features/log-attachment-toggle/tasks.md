# 로그 첨부 단일 토글 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변경 없음(순수 UI/스토어 리팩터).
- 저장 스키마(이슈 레코드 blob 키)·logs.html 빌드·manifest 무변경.
- 착수 전 `docs/POSTMORTEM.md`를 "log"·"attach"·"session sync"·"editor-store"로 grep해 과거 함정 소환.

## 태스크

### Task 1: `selectAttachedLogs` / `logCardTypeCounts` / `deriveLogsAttach` 단위 테스트 먼저 (TDD)

- **변경 대상**: `src/store/__tests__/editor-store.test.ts`(또는 신규), `src/sidepanel/components/__tests__/logCardTypeCounts.test.ts`, `src/sidepanel/hooks/__tests__/deriveLogsAttach.test.ts`(신규)
- **작업 내용**:
  - `selectAttachedLogs`: `logsAttach=false`면 세 로그 모두 null, `true`면 captured>0인 타입만 반환하는 케이스. **주의**: 이 함수는 모듈 private(비-export). 기존 `editor-store.test.ts`는 `useEditorStore.getState().startCapturing()` → 상태 assert의 **store 인스턴스 경유** 패턴이다. 순수 테스트하려면 **`selectAttachedLogs`를 export**하거나(권장 — 순수 함수라 부작용 없음), store 인스턴스로 `logsAttach` 세팅 후 결과가 드러나는 지점을 간접 assert. 어느 쪽인지 구현 시 확정(기본: export).
  - `logCardTypeCounts`: 캡처된 타입만 세그먼트 포함, 에러 건수 반영, 전부 0이면 빈 문자열 등. **에러 건수 입력 모델**: raw `NetworkLog`/`ConsoleLog`에는 에러 필드가 없으므로(`captured`만), 기존 export 순수 헬퍼(`src/sidepanel/lib/buildLogSummary.ts` — `buildNetworkLogSummary().errors[]`·`buildConsoleLogSummary().errorCount`)로 파생한 값을 입력받거나 헬퍼 내부에서 재사용한다(자체 계산 금지). 세그먼트 순서 `console → network → action`.
  - `deriveLogsAttach(snap)`: 구 3플래그 → 단일 `logsAttach` OR 파생. 케이스: 하나라도 true→true / 셋 다 false→false / 전부 undefined(신규 스냅샷)→true / 부분 정의(network:false, console:true)→true.
- **검증**:
  - [ ] 새 테스트가 (아직 없는 `logsAttach`/헬퍼에 대해) red
  - [ ] `pnpm test` 대상 파일 실행

### Task 2: editor-store 단일 플래그 교체

- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  - `networkLogAttach`/`consoleLogAttach`/`actionLogAttach` 상태·세터 → `logsAttach`/`setLogsAttach`.
  - `initial`, `preserveLogs` 대상 타입, 진입점 4곳(`startCapturing`/`startFreeform`/`startElementShot`/`onRecordingComplete`)의 `true` 세팅, `selectAttachedLogs` 게이트, `EditorSnapshot` 필드 반영.
- **검증**:
  - [ ] Task 1의 `selectAttachedLogs` 테스트 green
  - [ ] `pnpm typecheck` (하위 사용처 타입 에러가 남은 태스크를 가리킴)

### Task 3: 세션 스냅샷/복원 단일화

- **변경 대상**: `src/sidepanel/hooks/useEditorSessionSync.ts`
- **작업 내용**:
  - 스냅샷 빌더 3필드 → `logsAttach`.
  - 복원: 세 로그를 attach와 무관하게 pending IDB에서 항상 로드(각 조회 실패/부재 시 null 유지, 예외 삼킴). `logsAttach`는 hydrate. **주의**: 현행은 blob 부재 시 attach를 false로 자가 강등(`useEditorSessionSync.ts:103-126`)하는데, 신규는 이 강등을 제거하고 데이터만 로드 — `logsAttach`는 스냅샷 hydrate 값 유지.
  - 레거시 스냅샷 폴백: 순수 함수 `deriveLogsAttach(snap)`(Task 1에서 테스트) OR 파생을 `migrateLegacyDraft` 안에서 호출(위치 확정 — 인라인 아님).
- **검증**:
  - [ ] `pnpm typecheck`
  - [ ] Task 1의 `deriveLogsAttach` 테스트 green
  - [ ] 수동: drafting에서 토글 off → 패널 닫기 → 재오픈 시 카드가 유지되고 off 상태 복원

### Task 4: `LogAttachmentCards` 단일 카드화

- **변경 대상**: `src/sidepanel/components/LogAttachmentCards.tsx` + `logCardTypeCounts` 헬퍼
- **작업 내용**:
  - Props 단일화(`logsAttach`/`onToggle?`/`onClick`/`readOnly` + 3 로그).
  - 단일 카드 렌더(title `logCard.title`, 아이콘 1개, desc = `logCardTypeCounts`, 스위치 1개/readOnly 숨김, `data-testid="log-attachment-card"`).
  - desc는 기존 `truncate text-sm` 단일 라인 유지(결합 desc 잘림은 수용 — 시각 확인 후 후속 대응).
  - **키보드 접근성**: 카드 컨테이너에 `role="button"` + `tabIndex={0}` + `onKeyDown`(Enter/Space → `onClick`). 스위치의 `stopPropagation`은 유지.
- **검증**:
  - [ ] Task 1의 `logCardTypeCounts` 테스트 green
  - [ ] `pnpm typecheck`
  - [ ] 수동: 키보드(Tab→Enter/Space)로 카드에서 다이얼로그 열림

### Task 5: `LogPreviewDialog` 신설 + preview 3파일 제거

- **변경 대상**: 신규 `src/sidepanel/components/LogPreviewDialog.tsx`; 삭제 `NetworkLogPreviewDialog.tsx`/`ConsoleLogPreviewDialog.tsx`/`ActionLogPreviewDialog.tsx`
- **작업 내용**:
  - 탭형(console/network/action, 캡처된 타입만) + 개수 Badge + forceMount + 뷰 모드 Content 재사용. 탭 UI 스타일은 `LogInsertDialog`를 그대로 따르되 차이 3점(design 참조): ①action 탭 포함 ②console 선택 상태 없음(조회 전용, network는 영상 스크롤 동기화만 유지) ③푸터 첨부/해제.
  - 기본 활성 탭: 캡처된 탭 중 `console → network → action` 순 첫 번째(log-viewer와 동일).
  - 푸터: 닫기 + (`onToggleAttach`면) 첨부/해제.
- **검증**:
  - [ ] `pnpm typecheck` (삭제로 인한 import 에러가 Task 6 사용처를 가리킴)
  - [ ] 수동: 캡처된 타입 조합별 기본 탭이 console→network→action 순으로 열림

### Task 5b: `LogInsertDialog` 기본 탭 로직 통일

- **변경 대상**: `src/sidepanel/components/LogInsertDialog.tsx`
- **작업 내용**: 기본 활성 탭을 network-first(현행 `useState("network")` + `useEffect` 49-54) → **`console → network` 순 첫 번째**(캡처된 탭 기준)로 변경. 그 외 로직 무변경.
- **검증**:
  - [ ] `pnpm typecheck`
  - [ ] 수동: 로그 추가 다이얼로그를 열면 console 탭이 기본(console 비었으면 network)

### Task 6: 3개 사용처 배선 교체

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`, `PreviewPanel.tsx`, `DraftDetailDialog.tsx`
- **작업 내용**:
  - store 구독·다이얼로그 open state를 단일화.
  - `<LogAttachmentCards>` 단일 props, preview 3블록 → `<LogPreviewDialog>` 1개.
  - PreviewPanel/DraftDetailDialog는 readOnly(첨부 버튼 없음). DraftDetailDialog 카드/탭은 로드된 로그 데이터 존재로 파생.
- **검증**:
  - [ ] `pnpm typecheck` 전체 통과
  - [ ] 수동: 스크린샷/영상/자유형 각 모드에서 카드 1개·탭 다이얼로그·첨부 토글 동작

### Task 7: `buildEditorCapture` 통짜 게이트

- **변경 대상**: `src/sidepanel/lib/buildEditorCapture.ts`
- **작업 내용**: 두 함수의 3 attach 게이트 → `logsAttach` 치환. **비대칭 주의**(현행 유지, 동작 불변): `buildEditorMarkdownContext`(함수 선언 line 19, 게이트 37-40)의 action 게이트에는 `supportsActionLog(captureMode)`가 있어 그대로 유지, 반면 `buildEditorLogsCaptureInput`(함수 선언 line 132, 게이트 152-154)의 `hasAct`에는 `supportsActionLog`가 **없다** — 여기선 `actionLogAttach → logsAttach` 치환만 하고 모드 가드를 새로 추가하지 않는다.
- **검증**:
  - [ ] `pnpm typecheck`
  - [ ] 수동: 토글 on 제출 → logs.html에 캡처 전 타입 포함 / off 제출 → logs.html 미첨부

### Task 8: i18n 키 추가·정리

- **변경 대상**: `src/i18n/namespaces/logs.ts` (ko/en 동시)
- **작업 내용**: `src/i18n/namespaces/logs.ts`에 `logCard.title` + 타입별 count 키 추가(logCard 키는 이 파일에 있음 — `actionLog.cardDescription` ko 70/en 196, `logCard.description` ko 119/en 245). 미사용된 `logCard.description`/`actionLog.cardDescription`은 실제 미참조 확인 후 제거.
- **검증**:
  - [ ] PostToolUse 훅(`locales.test.ts`) 통과(ko/en 대칭·placeholder)
  - [ ] `logCard.description`/`actionLog.cardDescription` 전 코드베이스 grep 0건 확인 후 제거
  - [ ] log-viewer 사전(`src/log-viewer/i18n.ts`)에 해당 키 없음 재확인(불필요 갱신 방지 — logCard 키는 log-viewer 사전에 원래 없음, 확인됨)

## 테스트 계획

- **단위 테스트**:
  - `selectAttachedLogs`: `logsAttach` on/off × 타입별 captured 조합.
  - `logCardTypeCounts`: 타입 부분 존재·에러 건수·전무(빈 문자열).
  - `deriveLogsAttach`: OR 파생 4케이스(Task 1).
- **e2e 시나리오** (`/e2e-write` 입력):
  - 스크린샷 캡처 후 drafting에 로그 카드가 정확히 1개 뜬다.
  - 카드 스위치를 off로 하면 첨부 상태가 off가 된다(제출 입력에서 logs 미포함).
  - 카드를 클릭하면 탭 다이얼로그가 열리고, 캡처된 타입 탭(console/network/action)만 보인다.
  - 다이얼로그 [첨부 해제]를 누르면 스위치가 off로 바뀐다.
  - `e2e/action-log-scope.spec.ts` 갱신: 이 spec의 실제 참조는 `action-log-card`(60/91/100/122)·`console-log-card`(101/123) **2종·6개 어서션**(`network-log-card`는 미참조)이다. "타입별 카드 존재/부재" 시맨틱이 단일 카드로 사라지므로, **탭 노출 여부**(action 탭이 캡처됐을 때만 노출)로 대체 검증한다. `log-attachment-card` 단일 + 탭 확인으로 재작성.
- **문서/e2e 부수 갱신** (testid·컴포넌트 삭제 파급):
  - `e2e/COVERAGE.md`(구 testid 명시)·`e2e/GOTCHAS.md`에서 `*-log-card` 언급 갱신.
  - `docs/DESIGN.md`·`docs/DIRECTORY.md`가 preview 3파일을 문서화 중 — 삭제 후 stale. `/doc-check`/push 신선도에서도 걸리나 태스크에 명시.
- **수동 테스트** (자동화 어려운 것):
  - 세션 복원: 토글 off → 패널 닫기 → 재오픈 시 카드 유지·off 복원.
  - 제출 후 실제 첨부된 logs.html을 열어 캡처 전 타입이 담겼는지(on) / 첨부 안 됐는지(off).
  - DraftDetailDialog에서 저장된 이슈(과거 per-type 부분 첨부 포함)의 단일 카드·탭 렌더 정합.

## 구현 순서 권장

- Task 1(테스트) → Task 2(store) → Task 3(세션) 순차(스토어 계약 먼저 고정).
- Task 4(카드)·Task 5(다이얼로그)·Task 5b(insert 기본 탭)는 Task 2 이후 **병렬 가능**(5b는 store 무의존이라 사실상 독립).
- Task 6(배선)은 Task 4·5 완료 후(삭제·신설이 선행돼야 import 정리).
- Task 7(빌드 게이트)·Task 8(i18n)은 Task 2 이후 언제든. Task 8은 Task 4 desc 확정 후가 안전.
- 마무리: `pnpm test` + `pnpm typecheck` 전체 green.

## 가이드 영향

사용자 노출 UX 변경(로그 첨부 카드 3개→1개, 상세 다이얼로그 탭형). `guide/{ko,en}/logs/` 관련 페이지 대조·갱신 필요.
- `guide/ko/logs/*`·`guide/en/logs/*` 중 로그 첨부 카드·상세 다이얼로그를 설명하는 페이지(로그 첨부 토글·타입별 카드 스크린샷/문구) — 단일 카드+탭 다이얼로그로 갱신.
- 구현 후 `/guide`로 처리(AUTHORING.md 규칙 준수, ko/en 동시).
