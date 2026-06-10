# 스타일 변경사항 확인 다이얼로그 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 변경 없음. manifest 변경 없음.
- 신규 shadcn 컴포넌트 불필요 (Dialog·AlertDialog·Badge·Button 기존 보유).
- `docs/privacy.md` 영향 없음 — `captureVisibleTab`은 기존 element mode 캡처 목적의 연장(after 스냅샷 갱신)으로 새 수집·전송 동작이 아님.

## 태스크

### Task 1: 순수 헬퍼 `styleChangeGroups.ts` (+ 테스트 먼저)
- **변경 대상**: `src/sidepanel/lib/styleChangeGroups.ts` (신규), `src/sidepanel/lib/__tests__/styleChangeGroups.test.ts` (신규), `src/sidepanel/components/StyleChangesTable.tsx` (`SHORTHAND_GROUPS` export)
- **작업 내용**: design.md 인터페이스대로 `buildChangeGroups` / `countChangeRows` / `removeDiffRow` 구현. `/tdd interface`로 테스트 먼저.
- **검증**: `pnpm test`
  - [ ] buildChangeGroups: 버퍼 2개 + 현재 선택 diff 有 → 그룹 3개, 순서(버퍼 순 → 현재), source 플래그 정확
  - [ ] buildChangeGroups: 현재 선택 diff 없음 → 현재 그룹 제외 / selection null → 버퍼만
  - [ ] buildChangeGroups: 중복 selector(버퍼 항목 == 현재 선택) → 두 그룹 모두 포함
  - [ ] countChangeRows: shorthand collapse 반영된 행 수 합
  - [ ] removeDiffRow: `"text"` → text 원복 / `"class"` → classList 원복 / 일반 prop → 키 삭제
  - [ ] removeDiffRow: collapsed shorthand 행(`padding`) → longhand 4종 + `padding` 키 모두 삭제 / inlineStyle에 `padding` 직접 키만 있는 경우도 삭제

### Task 2: picker 메시지 — selector 기반 부분 원복·캡처 준비
- **변경 대상**: `src/types/picker.ts`, `src/content/picker.ts`, `src/sidepanel/picker-control.ts`, `src/sidepanel/capture.ts`
- **작업 내용**: design.md대로 `picker.applyEditsBySelector` / `picker.prepareCaptureBySelector` 추가, `handleEndCapture`에 스크롤 복원 추가, `applyEditsBySelector`·`prepareCaptureBySelector`·`captureElementSnapshotBySelector` 헬퍼 추가. `prepareCaptureBySelector` 핸들러는 비동기 `sendResponse`(`return true`).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (수동, Task 6에서 일괄) 뷰포트 밖 버퍼 요소 원복 시 스크롤 이동·복원 동작

### Task 3: store 액션 — 버퍼 항목 패치·제거
- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**: `patchBufferedElement(selector, patch)` / `removeBufferedElement(selector)` 추가. selector 미일치 시 no-op.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (선택) zustand 액션은 컴포넌트·스토리지 의존이 없으므로 스토어 단위 테스트 추가 가능 — patch가 다른 항목을 건드리지 않는지, remove가 이미지 포함 항목을 제거하는지

### Task 4: `StyleChangesDialog` 컴포넌트
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StyleChangesDialog.tsx` (신규)
- **작업 내용**: 트리거 버튼([변경사항 확인] + `Badge variant="secondary"` N, N=0이면 badge 미노출 + disabled) + Dialog 본문(요소당 shadcn `Card` 1장 — 헤더 좌측 `formatElementName`·우측 [x](요소 전체 초기화, 확인 없음), 내부에 diff 행마다 muted 라운드 컨테이너 + 우측 [x](행 초기화, 확인 없음), IconButton `X` `h-8 w-8`; 카드 리스트는 y 오버플로 시 스크롤) + 푸터(`sm:justify-between`, 좌 destructive [전체 초기화]→AlertDialog 재확인, 우 [확인]=`common.ok`). 초기화 핸들러는 design.md 데이터 흐름대로(행/요소 × 현재/버퍼/중복 분기, busy ref, 0건 시 자동 닫힘).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 행 초기화 로직이 `removeDiffRow` + 기존 `apply*`/신규 `applyEditsBySelector`만 사용 (DOM 직접 조작 없음)

### Task 5: footer 교체 + i18n
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`, `src/i18n/namespaces/editor.ts`
- **작업 내용**: 기존 AlertDialog 블록(448-476행)을 `<StyleChangesDialog />`로 교체, 인라인 `changeCount`/`totalChangeCount` 계산 제거(다이얼로그 내부로 이동), `canProceed`는 [다음]용 유지. i18n 키 6종 ko/en 동시 추가 (design.md 목록).
- **검증**:
  - [ ] `pnpm test` 통과 (i18n PostToolUse 훅 — ko/en 키 대칭)
  - [ ] `pnpm typecheck` 통과
  - [ ] `editor.resetChanges` 키가 AlertDialog 재확인에서 계속 사용됨 (고아 키 없음)

### Task 6: 수동 테스트 (Chrome)
- **변경 대상**: 없음 (`/build` 후 확장 로드)
- **작업 내용**: 아래 수동 테스트 체크리스트 수행.
- **검증**: 체크리스트 전부 통과

## 테스트 계획

### 단위 테스트
- `styleChangeGroups.test.ts` — Task 1 케이스 전체.
- 기존 `hasStyleChange.test.ts` 회귀 없음 확인 (`pnpm test`).

### 수동 테스트 (Chrome)
- [ ] 변경 0건: 버튼 비활성 + badge 없음. 속성 1개 수정 → [변경사항 확인 · 1] 활성.
- [ ] 요소 A(color, padding 4면 동일값), 요소 B(class) 수정 → badge N=3 (padding collapse), 다이얼로그 카드 2장·행 3개.
- [ ] 요소를 5개 이상 수정해 카드가 다이얼로그 높이를 넘으면 카드 리스트만 스크롤되고 푸터는 고정.
- [ ] 현재 요소 행 개별 초기화 → 페이지 즉시 원복 + 패널 인풋(ValueCombobox·ClassEditor·TextEditor) 원래 값 표시 + badge 감소.
- [ ] 버퍼 요소 행 개별 초기화 → 페이지 원복 + afterImage 재캡처(drafting 진입해 버퍼 표에서 after 이미지가 현재 화면과 일치하는지 확인).
- [ ] 뷰포트 밖 버퍼 요소 행 초기화 → 스크롤 이동 후 원위치 복원, 캡처 정상.
- [ ] 버퍼 요소의 마지막 행 초기화 → 카드 사라짐(버퍼 제거), drafting 버퍼 표에서도 제외.
- [ ] 카드 우상단 [x] (버퍼 요소) → 재확인 없이 해당 요소 전체 원복 + 카드 제거.
- [ ] 카드 우상단 [x] (현재 선택 요소) → 재확인 없이 styleEdits 원복 + 패널 인풋 갱신 + 선택 유지.
- [ ] 마지막 변경 항목 초기화 → 다이얼로그 자동 닫힘 + 버튼 비활성.
- [ ] [전체 초기화] → AlertDialog 재확인 → 전 요소 DOM 원복 + 다이얼로그 닫힘 + 선택 유지(패널 그대로, 인풋 원복).
- [ ] 버퍼 요소 재선택 후 그 요소의 버퍼 행 초기화 → 재선택(re-emit) 발생, 패널 인풋 새 베이스라인, 작성 중이던 미버퍼 편집 폐기 확인.
- [ ] text 있는 요소의 text 행 / class 행 초기화 각각 동작.
- [ ] 페이지 reload 후(세션 복원) 버퍼 항목 행 초기화 → 요소 소실 시에도 store 항목 제거되고 에러 없음.
- [ ] AI 스타일링·[다음] 진입 등 인접 플로우 회귀 없음.

## 구현 순서 권장

1. Task 1 (테스트 → 구현) — 다른 태스크와 독립.
2. Task 2 / Task 3 — 상호 독립, 병렬 가능.
3. Task 4 — Task 1·2·3 의존.
4. Task 5 — Task 4 의존.
5. Task 6 — 전체 완료 후.

## 가이드 영향

- `element/styling.md` (ko·en) — "변경사항 초기화" 버튼 언급(ko 24행)을 [변경사항 확인] 다이얼로그 흐름으로 갱신(변경 목록 확인·개별 초기화·전체 초기화 위치 변경). ko 47행의 "담은 요소를 따로 빼거나 목록으로 관리하는 화면은 아직 없습니다" 문구도 stale해짐 — 다이얼로그에서 요소별 변경 확인·개별 초기화가 가능해진다.
- 작성 기준은 `guide/AUTHORING.md`. 구현 후 `/guide`로 처리.
