# diff table before/after 이미지 어노테이션 — 구현 태스크

## 선행 조건

- 새 권한·env·의존성 없음. `AnnotationOverlay`(Konva lazy 청크)는 이미 사이드패널에 실려 있다.
- shadcn 설치 불요 — `button-group.tsx`·`button.tsx` 기존 것.
- 신규 i18n 키 없음(`editor.image.annotate`·`editor.image.reset` 재사용). 새 키를 만들 것 같으면 그 전에 기존 키로 되는지 확인.
- 착수 전 `docs/POSTMORTEM.md`를 `-e StyleChangesTable -e capture -e 세션 -e 스냅샷`으로 grep.

## 태스크

### Task 1: `resolveAnnotated` 순수 헬퍼

- **변경 대상**: `src/sidepanel/lib/annotatedImage.ts`(신규), `src/sidepanel/lib/__tests__/annotatedImage.test.ts`(신규)
- **작업 내용**: `resolveAnnotated(raw, annotated)` = 주석본 우선, 없으면 원본, 둘 다 없으면 null. 표시·오버레이 입력·제출·IDB 저장 네 소비처가 공유한다.
- **검증**:
  - [ ] `resolveAnnotated("raw", "ann") === "ann"`
  - [ ] `resolveAnnotated("raw", null) === "raw"` / `undefined`도 동일(구버전 스냅샷)
  - [ ] `resolveAnnotated(null, "ann") === "ann"` — 원본이 유실돼도 주석본은 살린다
  - [ ] `resolveAnnotated(null, null) === null`

### Task 2: store 필드·액션 + after 폐기 규율

- **변경 대상**: `src/store/editor-store.ts`, `src/store/__tests__/editor-store.test.ts`
- **작업 내용**:
  - `EditorState`에 `beforeAnnotated`/`afterAnnotated`, `BufferedElement`에 optional 동명 2필드.
  - 액션 `setBeforeAnnotated`/`setAfterAnnotated`.
  - **after 폐기를 액션 안에 넣는다**: `setAfterImage`는 `afterAnnotated: null`을 함께 set, `backToStyling`도 함께 null, `patchBufferedElement`는 patch에 `afterImage` 키가 있으면 `afterAnnotated: null`을 강제. 호출부가 잊을 수 없어야 한다.
  - `bufferCurrentElement`가 현재 요소를 버퍼로 승격할 때 `beforeAnnotated`/`afterAnnotated`도 함께 옮긴다(안 옮기면 버퍼링 순간 주석이 증발한다).
  - `onSubmitted`·`reset` 계열의 초기화 목록에 두 필드 추가.
  - `confirmDraft`의 `saveImageBlob` 4곳이 `resolveAnnotated`를 거치게 한다.
- **검증**:
  - [ ] `setAfterImage(x)` 후 `afterAnnotated === null`
  - [ ] `backToStyling()` 후 `afterAnnotated === null`
  - [ ] `patchBufferedElement(sel, fid, { afterImage: x })` 후 그 항목의 `afterAnnotated === null`
  - [ ] `patchBufferedElement(sel, fid, { styleEdits })`(afterImage 없는 patch)는 `afterAnnotated`를 **보존**
  - [ ] `bufferCurrentElement`가 두 annotated 필드를 승격 항목에 싣는다
  - [ ] `setBeforeAnnotated(x)`는 `beforeImage`를 안 건드린다

### Task 3: 세션 영속화

- **변경 대상**: `src/store/editor-store.ts`(`EditorSnapshot` Pick 목록), `src/sidepanel/hooks/useEditorSessionSync.ts`
- **작업 내용**: `snapshotFromState()`에 top-level 2필드 추가, `toLiteSnapshot`의 top-level·`bufferedElements` map 양쪽에서 두 필드를 null로.
- **검증**:
  - [ ] 주석 후 패널 닫았다 열면 주석본이 복원된다(수동 또는 e2e)
  - [ ] `toLiteSnapshot` 결과에 annotated 계열이 남지 않는다(단위)
  - [ ] `EditorSnapshot` 타입에 추가했는데 `snapshotFromState`에 안 넣으면 타입 에러가 나는지 확인 — 안 나면 저장 누락이 조용해지므로 테스트로 고정

### Task 4: `ImageActions` 컴포넌트

- **변경 대상**: `src/sidepanel/components/ImageActions.tsx`(신규), `src/sidepanel/components/__tests__/ImageActions.test.tsx`(신규)
- **작업 내용**: `ButtonGroup` + `Button variant="outline" size="icon" className="h-8 w-8"`. `onReset`이 있을 때만 `[RotateCcw]`를 **조건부 렌더**(hidden 속성 금지). 아이콘 순서는 인라인 이미지와 동일하게 `[초기화][연필]`. 래퍼는 `absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100`.
- **검증**:
  - [ ] `onReset` 없으면 버튼 1개, 있으면 2개
  - [ ] 각 버튼 클릭이 해당 핸들러를 1회 호출
  - [ ] `aria-label`/`title`이 `editor.image.annotate`·`editor.image.reset`
  - [ ] 키보드 포커스로도 그룹이 보인다(`group-focus-within`)

### Task 5: `StyleChangesTable` optional 액션 prop

- **변경 대상**: `src/sidepanel/components/StyleChangesTable.tsx`, `src/sidepanel/components/__tests__/StyleChangesTable.test.tsx`(신규 또는 기존)
- **작업 내용**: `SnapshotCell`이 `annotated`·`onAnnotate`·`onReset`을 받아 `src = resolveAnnotated(...)`로 그리고, `onAnnotate`가 있을 때만 `ImageActions`를 렌더. 이미지 래퍼 `Card`에 `group relative` 추가. 이미지 없는 칸은 지금과 동일.
- **검증**:
  - [ ] 핸들러 미전달 시 `ImageActions`가 DOM에 없다(preview·상세 보호)
  - [ ] `annotated`가 있으면 `img src`가 주석본, 없으면 원본
  - [ ] `annotated`가 있을 때만 초기화 버튼이 뜬다
  - [ ] 이미지가 null이면 버튼도 없고 `styleTable.noSnapshot`만 나온다

### Task 6: `mergeStyleElements` 필드 통과

- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`, `src/sidepanel/lib/__tests__/buildIssueMarkdown.test.ts`
- **작업 내용**: `StyleElementContext`에 optional `beforeAnnotated`/`afterAnnotated` 추가, `current` 인자에 두 필드 추가, buffered→resolved 매핑에서도 통과. **여기서 resolve하지 않는다.**
- **검증**:
  - [ ] 현재 요소의 annotated가 출력 항목에 그대로 실린다
  - [ ] 버퍼 요소의 annotated가 인덱스에 맞게 실린다
  - [ ] 필드가 없는 구버전 버퍼 항목도 예외 없이 통과(undefined 유지)
  - [ ] 마크다운 본문 산출물은 무변경(기존 테스트 green)

### Task 7: 제출 경로 resolve

- **변경 대상**: `src/sidepanel/lib/buildEditorCapture.ts`, `src/sidepanel/lib/__tests__/buildEditorCapture.test.ts`
- **작업 내용**: `beforeImages`/`afterImages` 매핑을 `resolveAnnotated`로.
- **검증**:
  - [ ] 주석이 있으면 `beforeImages[i]`가 주석본
  - [ ] 없으면 원본
  - [ ] `buildCaptureFiles` 파일명·인덱스는 불변(`before-0.webp` …)

### Task 8: `DraftingPanel` 배선 + 오버레이

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**:
  - `annotatingDiff: { selector, frameId, slot, url } | null` state.
  - `StyleChangesTable`에 `beforeAnnotated`/`afterAnnotated`/`onAnnotate`/`onReset` 전달(element 모드 diff table 렌더 지점만).
  - `onAnnotate(slot)` → `resolveAnnotated`로 배경 이미지를 정해 state set. `onReset(slot)` → 해당 annotated를 null로.
  - 쓰기 라우팅: `sameElementKey({ selector, frameId }, selection)`이면 store 액션, 아니면 `patchBufferedElement`.
  - 오버레이는 기존 스크린샷 주석 블록 옆에 같은 `Suspense` 관례로 마운트. `onComplete`에서 라우팅 후 state를 null로, `onCancel`은 state만 null.
  - `[다음]`·취소 시 `setAnnotatingDiff(null)`(기존 `setAnnotating(false)`와 같은 자리).
- **검증**:
  - [ ] before/after 각각 오버레이가 열리고 완료 시 해당 칸만 바뀐다
  - [ ] 버퍼 요소 카드의 주석이 현재 요소 카드에 안 붙는다
  - [ ] 재주석이 주석본 위에서 시작한다
  - [ ] 초기화 후 원본으로 돌아가고 버튼이 1개로 준다

## 테스트 계획

### 단위 테스트

- `annotatedImage.test.ts` — Task 1의 4케이스.
- `editor-store.test.ts` — Task 2의 폐기·승격·보존 6케이스. 특히 **"afterImage 없는 patch는 annotated를 보존"** 케이스가 폐기 규율의 과잉 적용을 막는다.
- `buildIssueMarkdown.test.ts` / `buildEditorCapture.test.ts` — Task 6·7.
- `useEditorSessionSync`의 `toLiteSnapshot` — Task 3.
- **jsdom(`*.test.tsx`)**: `ImageActions`(버튼 개수·핸들러), `StyleChangesTable`(핸들러 없으면 버튼 없음 — 읽기 전용 화면 보호가 이 테스트의 본체).

### e2e 시나리오

`e2e/diff-image-annotation.spec.ts`(신규). element 모드 진입·스타일 편집은 기존 헬퍼(`enterDebugAndPick`·`typeStyleValue`) 재사용. **캡처 quota 함정**(`e2e/GOTCHAS.md`)에 걸리므로 pick 직후 `fixture.bringToFront()` + spaced 대기를 쓰고, 새 캡처를 유발하는 단계를 최소화한다.

- before 이미지에 hover하면 주석 버튼이 뜨고, 주석 전에는 초기화 버튼이 없다.
- 주석 완료 후 diff table의 before `img src`가 바뀌고 초기화 버튼이 생긴다.
- 초기화를 누르면 `img src`가 주석 전 값으로 돌아가고 초기화 버튼이 사라진다.
- 요소 2개(버퍼 1 + 현재 1)에서 버퍼 카드에 주석하면 현재 카드의 이미지는 안 바뀐다.
- 주석 후 스타일 값을 다시 고쳐 after가 재캡처되면 after 초기화 버튼이 사라진다(폐기).
- `to-preview`로 넘어간 preview 화면의 diff table에는 주석 버튼이 없다.
- 패널을 닫았다 다시 열면 주석본이 유지된다.

**공허해질 위험**: 주석 결과는 canvas 픽셀이라 "그림이 맞나"는 판정 불가다. `img src` 문자열의 **변화 여부**와 버튼 개수로만 판정하고, 그게 실제로 주석 경로를 탄 것인지 확인하려면 도형을 드래그로 커밋해야 한다(`e2e/GOTCHAS.md`의 Konva Stage 드래그 항목). 드래그 없이 `[완료]`만 누르면 도형 0으로 원본과 같은 이미지가 나올 수 있다.

### 수동 테스트

- 작은 캡처(요소 bbox+24px)에서 버튼 2개가 이미지를 얼마나 덮는지 — 위험 5.
- 다크모드에서 버튼 대비.
- 요소 3~4개 + 각 before/after 주석 후 **세션 스냅샷 쿼터** — DevTools에서 `chrome.storage.session` 사용량을 재고, lite 강등이 얼마나 빨리 오는지 확인(위험 1). 강등되면 패널 재오픈 시 이미지가 전부 빈다.
- 제출까지 완주해 실제 이슈의 `before-0.webp`가 주석본인지 육안 확인.

## 구현 순서 권장

```
Task 1 (헬퍼)
   ├─→ Task 2 (store) ─→ Task 3 (세션)
   ├─→ Task 6 (merge) ─→ Task 7 (제출)
   └─→ Task 4 (ImageActions) ─→ Task 5 (테이블)
                                   └─→ Task 8 (배선) ← Task 2·6도 선행
```

- Task 1이 모든 것의 선행.
- Task 2·3 / Task 4·5 / Task 6·7 세 갈래는 서로 독립이라 병렬 가능.
- Task 8은 2·5·6이 끝나야 붙는다. e2e는 Task 8 이후.

## 가이드 영향

`guide/ko/element/`·`guide/en/element/`의 스타일 편집·리포트 작성 흐름 페이지 — before/after 이미지에 주석을 달 수 있다는 문장 한 줄과 버튼 설명이 필요하다. 정확한 대상 페이지는 `guide/AUTHORING.md`의 IA 표를 보고 정하고, 작성은 구현 후 `/guide`로 처리한다. 스크린샷 주석 설명이 이미 있는 페이지가 있으면 그 옆에 붙이는 게 자연스럽다.
