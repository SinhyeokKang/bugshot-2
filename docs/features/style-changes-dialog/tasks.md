# 스타일 변경사항 확인 다이얼로그 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 변경 없음. manifest 변경 없음.
- 신규 shadcn 컴포넌트 불필요 (Dialog·AlertDialog·Badge·Button 기존 보유).
- `docs/privacy.md` 영향 없음 — `captureVisibleTab`은 기존 element mode 캡처 목적의 연장(after 스냅샷 갱신)으로 새 수집·전송 동작이 아님.

## 태스크

### Task 1: 순수 헬퍼 `styleChangeGroups.ts` (+ 테스트 먼저)
- **변경 대상**: `src/sidepanel/lib/styleChangeGroups.ts` (신규), `src/sidepanel/lib/__tests__/styleChangeGroups.test.ts` (신규), `src/sidepanel/components/StyleChangesTable.tsx` (`SHORTHAND_GROUPS` export)
- **작업 내용**: design.md 인터페이스대로 `buildChangeGroups` / `countChangeRows` / `removeDiffRow` 구현. `/tdd interface`로 테스트 먼저. 테스트 파일은 기존 `hasStyleChange.test.ts`처럼 `vi.mock("@/i18n", ...)` 필요 — `StyleChangesTable` import 체인에 `@/i18n`이 딸려온다.
- **검증**: `pnpm test`
  - [x] buildChangeGroups: 버퍼 2개 + 현재 선택 diff 有 → 그룹 3개, 순서(버퍼 순 → 현재), source 플래그 정확
  - [x] buildChangeGroups: 현재 선택 diff 없음 → 현재 그룹 제외 / selection null → 버퍼만
  - [x] buildChangeGroups: 중복 selector(버퍼 항목 == 현재 선택) → 두 그룹 모두 포함
  - [x] countChangeRows: shorthand collapse 반영된 행 수 합
  - [x] removeDiffRow: `"text"` → text 원복 / `"class"` → classList 원복 / 일반 prop → 키 삭제
  - [x] removeDiffRow: collapsed shorthand 행(`padding`) → longhand 4종 + `padding` 키 모두 삭제 / inlineStyle에 `padding` 직접 키만 있는 경우도 삭제

### Task 2: picker 메시지 — selector 기반 부분 원복·캡처 준비
- **변경 대상**: `src/types/picker.ts`, `src/content/picker.ts`, `src/sidepanel/picker-control.ts`, `src/sidepanel/capture.ts`
- **작업 내용**: design.md대로 `picker.applyEditsBySelector` / `picker.prepareCaptureBySelector` 추가, `handleEndCapture`에 스크롤 복원 추가, `applyEditsBySelector`·`prepareCaptureBySelector`·`captureElementSnapshotBySelector` 헬퍼 추가. `prepareCaptureBySelector` 핸들러는 비동기 `sendResponse`(`return true`).
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] (수동, Task 6에서 일괄) 뷰포트 밖 버퍼 요소 원복 시 스크롤 이동·복원 동작

### Task 3: store 액션 — 버퍼 항목 패치·제거
- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**: `patchBufferedElement(selector, patch)` / `removeBufferedElement(selector)` 추가. selector 미일치 시 no-op.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] `src/store/__tests__/editor-store.test.ts`에 신규 액션 단위 테스트 추가(기존 `resetAllStyleEdits` 테스트와 동일 패턴, 테스트 우선 원칙) — patch가 다른 항목을 건드리지 않는지 / selector 미일치 시 no-op / remove가 이미지 포함 항목을 제거하는지. `pnpm test` 통과

### Task 4: `StyleChangesDialog` 컴포넌트
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StyleChangesDialog.tsx` (신규)
- **작업 내용**: 트리거 버튼([변경사항 보기] + `Badge variant="secondary"` N, N=0이면 badge 미노출 + disabled) + Dialog 본문(요소당 shadcn `Card` 1장 — 헤더 좌측 `formatElementName`(`truncate`+`title`)·우측 [↺](요소 전체 초기화, 확인 없음), 내부에 diff 행마다 muted 라운드 컨테이너 + 우측 [↺](행 초기화, 확인 없음), IconButton `RotateCcw` `h-8 w-8` + `title`/`aria-label`(i18n `resetRow`/`resetElement`); 카드 리스트는 `min-h-0 flex-1 overflow-y-auto`) + 푸터(`!flex-row items-center !justify-between`, 좌 `outline`+`text-destructive` [전체 초기화]→AlertDialog 재확인, 우 [확인]=`common.ok`). 초기화 핸들러는 design.md 데이터 흐름대로(행/요소 × 현재/버퍼/중복 분기, busy 중 `Loader2` 스피너 + 전체 초기화 버튼 disabled, 0건 자동 닫힘은 reactive). **제약**: 행 초기화 로직은 `removeDiffRow` + 기존 `apply*`/신규 `applyEditsBySelector`만 사용 — DOM 직접 조작 금지.
- **검증**:
  - [x] `pnpm typecheck` 통과

### Task 5: footer 교체 + i18n
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`, `src/i18n/namespaces/editor.ts`
- **작업 내용**: 기존 AlertDialog 블록(448-476행)을 `<StyleChangesDialog />`로 교체, 인라인 `changeCount`/`totalChangeCount` 계산 제거(다이얼로그 내부로 이동), `canProceed`는 [다음]용 유지. i18n 키 6종 ko/en 동시 추가 (design.md 목록).
- **검증**:
  - [x] `pnpm test` 통과 (i18n PostToolUse 훅 — ko/en 키 대칭)
  - [x] `pnpm typecheck` 통과
  - [x] `editor.resetChanges` 키가 AlertDialog 재확인에서 계속 사용됨 (고아 키 없음)

### Task 6: 수동 테스트 (Chrome) + e2e PoC
- **변경 대상**: 없음 (`/build` 후 확장 로드. PoC 스크립트는 커밋하지 않는 일회성)
- **작업 내용**: 아래 수동 테스트 체크리스트 수행. 이번 과업에서 **Playwright e2e PoC**를 병행 — `launchPersistentContext` + `--load-extension=dist` 로드, 패널은 `chrome-extension://<id>/...?tabId=N` 직접 진입(SW evaluate로 tabId·storage.session 세팅), 로컬 fixture 페이지 대상. 체크리스트 중 DOM·UI 플로우(원복·badge·자동 닫힘 등)를 스크립트로 수행하고, captureVisibleTab 의존 항목(afterImage 일치·quota)·스크롤 복원은 수동 유지.
- **검증**: 체크리스트 전부 통과 (자동+수동 합산)
- **PoC 판정 기준** (충족 시 영구 e2e 스위트를 별도 `/feature`로 문서화):
  - [x] 패널 직접 진입 + picker 선택 → 수정 → 다이얼로그 플로우가 스크립트로 완주
  - [x] 수동 체크리스트 중 10개 이상 자동 대체 (16개 체크, 아래 "(PoC 자동)" 표기)
  - [x] 동일 스크립트 3회 연속 통과 (flaky 없음 — 3×16/16)
- **PoC 비망** (일회성 스크립트는 검증 후 폐기 — 영구 e2e `/feature`의 입력):
  - Chrome 137+ 스테이블은 `--load-extension` 무시 → Playwright 캐시의 Chrome for Testing 사용.
  - 최신 Chrome의 `captureVisibleTab`은 특정 host permission으로 부족, `<all_urls>` 또는 activeTab 필요(자동화에선 activeTab 부여 불가) → poc.js가 dist/manifest.json에 `<all_urls>`를 후처리 주입. **실행 후 dist는 오염 상태 — 배포 전 `pnpm build` 재실행 필수.**
  - Radix Popover content도 `role=dialog` / Dialog 열림 중 배경 `aria-hidden`이라 role 기반 셀렉터 주의.

## 테스트 계획

### 단위 테스트
- `styleChangeGroups.test.ts` — Task 1 케이스 전체.
- 기존 `hasStyleChange.test.ts` 회귀 없음 확인 (`pnpm test`).

### 수동 테스트 (Chrome) — "(PoC 자동)"은 Playwright PoC가 3회 연속 검증 (스크립트는 폐기)
- [x] 변경 0건: 버튼 비활성 + badge 없음. 속성 1개 수정 → [변경사항 보기 · 1] 활성. (PoC 자동)
- [x] 요소 A(color, padding 4면 동일값), 요소 B(class) 수정 → badge N=3 (padding collapse), 다이얼로그 카드 2장·행 3개. (PoC 자동)
- [ ] 요소를 5개 이상 수정해 카드가 다이얼로그 높이를 넘으면 카드 리스트만 스크롤되고 푸터는 고정.
- [ ] 현재 요소 행 개별 초기화 → 페이지 즉시 원복 + 패널 인풋(ValueCombobox·ClassEditor·TextEditor) 원래 값 표시 + badge 감소. (PoC 부분 자동 — ValueCombobox 표시값만 수동 확인 남음)
- [ ] 버퍼 요소 행 개별 초기화 → 페이지 원복 + afterImage 재캡처(drafting 진입해 버퍼 표에서 after 이미지가 현재 화면과 일치하는지 확인). (PoC 부분 자동 — afterImage 일치만 수동)
- [ ] 뷰포트 밖 버퍼 요소 행 초기화 → 스크롤 이동 후 원위치 복원, 캡처 정상.
- [ ] 버퍼 요소의 마지막 행 초기화 → 카드 사라짐(버퍼 제거), drafting 버퍼 표에서도 제외. (PoC 부분 자동 — drafting 표 확인만 수동)
- [x] 카드 우상단 [↺] (버퍼 요소) → 재확인 없이 해당 요소 전체 원복 + 카드 제거. (PoC 자동)
- [x] 카드 우상단 [↺] (현재 선택 요소) → 재확인 없이 styleEdits 원복 + 패널 인풋 갱신 + 선택 유지. (PoC 자동)
- [x] 마지막 변경 항목 초기화 → 다이얼로그 자동 닫힘 + 버튼 비활성. (PoC 자동)
- [ ] [전체 초기화] → AlertDialog 재확인 → 전 요소 DOM 원복 + 다이얼로그 닫힘 + 선택 유지(패널 그대로, 인풋 원복). (PoC 부분 자동 — 인풋 원복 표시만 수동)
- [ ] 버퍼 요소 재선택 후 그 요소의 버퍼 행 초기화 → 재선택(re-emit) 발생, 패널 인풋 새 베이스라인, 작성 중이던 미버퍼 편집 폐기 확인.
- [x] text 있는 요소의 text 행 / class 행 초기화 각각 동작. (PoC 자동)
- [x] 페이지 reload 후(세션 복원) 버퍼 항목 행 초기화 → 요소 소실 시에도 store 항목 제거되고 에러 없음. (PoC 자동)
- [ ] 행 [↺] 빠른 연속 클릭 → 중복 실행 없음, busy 동안 스피너 표시 + 다른 초기화 버튼 disabled. (PoC 부분 자동 — 중복 실행 없음 확인, 스피너·disabled 표시만 수동)
- [ ] 버퍼 행 초기화를 짧은 간격으로 반복(quota 유발)해 재캡처 실패 시 → 기존 afterImage 유지(사라지지 않음) + 에러 없음, store 변경만 반영.
- [x] 다이얼로그 열린 채 같은 페이지 reload → 세션 보존(다이얼로그·badge 유지, pageKey 동일). 다른 페이지로 이동(styling 세션 폐기) → 세션 만료 확인 후 reset → 0건 reactive 닫힘, 빈 다이얼로그 잔존 없음. (PoC 자동 — 원 문구 "reload 시 0건 닫힘"은 실제 정책과 달라 정정: 같은 URL reload는 세션 키를 지우지 않음)
- [ ] AI 스타일링·[다음] 진입 등 인접 플로우 회귀 없음.

## 구현 순서 권장

1. Task 1 (테스트 → 구현) — 다른 태스크와 독립.
2. Task 2 / Task 3 — 상호 독립, 병렬 가능.
3. Task 4 — Task 1·2·3 의존.
4. Task 5 — Task 4 의존.
5. Task 6 — 전체 완료 후.

## 가이드 영향

- `element/styling.md` (ko·en) — "변경사항 초기화" 버튼 언급(ko 24행)을 [변경사항 보기] 다이얼로그 흐름으로 갱신(변경 목록 확인·개별 초기화·전체 초기화 위치 변경). ko 47행의 "담은 요소를 따로 빼거나 목록으로 관리하는 화면은 아직 없습니다" 문구도 stale해짐 — 다이얼로그에서 요소별 변경 확인·개별 초기화가 가능해진다.
- 작성 기준은 `guide/AUTHORING.md`. 구현 후 `/guide`로 처리.
