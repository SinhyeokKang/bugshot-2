# diff table before/after 이미지 어노테이션 — 구현 태스크

## 선행 조건

- 새 권한·env·의존성 없음. `AnnotationOverlay`(Konva lazy 청크)는 이미 사이드패널에 실려 있다.
- shadcn 설치 불요 — `button-group.tsx`·`button.tsx` 기존 것.
- 툴팁 i18n 키는 신규 없음 — `draft.addAnnotation`·`draft.editAnnotation`·`draft.removeAnnotation` 재사용(같은 화면의 스크린샷 주석 버튼과 같은 계열). **단 `alt` 키는 신규 2~3개**(Task 5) — 지금 before/after 두 칸이 `alt.capturedImage` 하나를 공유한다. ko/en 동시 갱신.
- `resolveAnnotated` 전용 모듈은 만들지 않는다 — 같은 `annotated ?? raw`가 이미 6곳에 인라인으로 산다(design.md 신규 표).
- 착수 전 `docs/POSTMORTEM.md`를 `-e StyleChangesTable -e capture -e 세션 -e 스냅샷`으로 grep.

## 태스크

### Task 1: store 필드·액션 + after 폐기 규율

- **변경 대상**: `src/store/editor-store.ts`, `src/store/__tests__/editor-store.test.ts`
- **작업 내용**:
  - `EditorState`에 `beforeAnnotated`/`afterAnnotated`, `BufferedElement`에 optional 동명 2필드.
  - 액션 `setBeforeAnnotated`/`setAfterAnnotated`.
  - **`patchBufferedElement`의 patch 타입을 확장한다** — 현재 `Partial<Pick<BufferedElement, "styleEdits" | "afterImage">>`라 annotated 쓰기가 컴파일되지 않는다. 두 필드를 Pick에 추가.
  - **after 폐기는 값 비교 하나로 통일한다**: `afterImage`를 쓰는 모든 커밋(`setAfterImage`·`patchBufferedElement`·`bufferCurrentElement`)에서 **새 값이 기존 값과 다를 때만** `afterAnnotated`를 null로. `patchBufferedElement`는 `"afterImage" in patch`로 정확히 판정한다 — "afterImage 키가 있으면"을 느슨하게 구현하면 `{ afterAnnotated: x }` 단독 패치가 자기를 지운다. `backToStyling`에는 별도 규칙을 두지 않는다.
  - `bufferCurrentElement`가 현재 요소를 버퍼로 승격할 때 `beforeAnnotated`를 함께 옮기고, `afterAnnotated`는 위 값 비교를 따른다. `useBufferThenSwitch`(repick·DOM 이동)는 새로 찍은 after를 넘기므로 폐기되고, `picker-control`의 `rebindStylingSession`은 `state.afterImage`를 그대로 넘기므로 보존된다.
  - `onElementSelected`가 버퍼 요소를 재선택하면 두 annotated 필드를 top-level로 함께 복원하고, 신규 요소 선택이면 둘 다 null로 초기화한다.
  - `onSubmitted`·`reset` 계열의 초기화 목록에 두 필드 추가.
  - `confirmDraft`는 `annotated ?? raw` 결과를 blob 저장 조건, `snapshot.before/after`, 버퍼 `hasBefore/hasAfter`, `saveImageBlob` 4곳에 동일하게 사용한다.
- **검증**:
  - [ ] `setAfterImage(x)`가 기존과 **다른** 값이면 `afterAnnotated === null`
  - [ ] `setAfterImage(same)`처럼 값이 같으면 `afterAnnotated` **보존**
  - [ ] `patchBufferedElement(sel, fid, { afterImage: x })`(다른 값) 후 그 항목의 `afterAnnotated === null`
  - [ ] `patchBufferedElement(sel, fid, { styleEdits })`(afterImage 없는 patch)는 `afterAnnotated`를 **보존**
  - [ ] `patchBufferedElement(sel, fid, { afterAnnotated: x })` 단독 패치가 그 값을 반영하고 **자기를 지우지 않으며** `afterImage`도 안 건드린다
  - [ ] `bufferCurrentElement(newAfter, …)`는 `afterAnnotated`를 버리고, `bufferCurrentElement(state.afterImage, …)`(rebind)는 보존한다 — 이 두 케이스가 폐기 규율의 본체다
  - [ ] `bufferCurrentElement`가 `beforeAnnotated`를 승격 항목에 싣는다
  - [ ] 버퍼 요소 재선택은 두 annotated 필드를 복원하고, 신규 요소 선택은 직전 annotated를 null로 초기화한다
  - [ ] `setBeforeAnnotated(x)`는 `beforeImage`를 안 건드린다
  - [ ] `confirmDraft` — 현재 요소·버퍼 요소 각각에 대해 raw·annotated가 모두 있을 때 `saveImageBlob`에 넘어간 dataUrl이 **주석본**이다(4슬롯 전부). blob 저장이 `void (async () => …)()` fire-and-forget이므로 flush 후 단언한다(안 하면 조용히 통과한다)
  - [ ] 버퍼 `hasBefore`/`hasAfter`가 resolve 기준으로 계산된다 — raw가 null이고 annotated만 있어도 true

### Task 2: 세션 영속화

- **변경 대상**: `src/store/editor-store.ts`(`EditorSnapshot` Pick 목록), `src/sidepanel/hooks/useEditorSessionSync.ts`, `toLiteSnapshot` 순수 헬퍼 모듈·테스트(신규 — 파일 경로를 착수 시 확정하고 여기 적는다)
- **작업 내용**:
  - `EditorSnapshot` Pick 목록과 `snapshotFromState`에 top-level 2필드를 **함께** 추가한다.
  - `toLiteSnapshot`만 순수 헬퍼 모듈로 분리해 export하고, top-level·`bufferedElements` map 양쪽에서 두 필드를 null로 만든다.
  - **`snapshotFromState`는 옮기지 않는다** — 36필드 손나열 + `getState()` 직접 호출이라 이동 중 하나가 빠지면 타입·런타임 에러 없이 조용히 초기값이 되고, 영향 범위가 편집 세션 전체다.
- **검증**:
  - [ ] `toLiteSnapshot` 결과에 annotated 계열이 남지 않는다(top-level·버퍼 양쪽, 단위)
  - [ ] `snapshotFromState` 결과 **키 집합 === `EditorSnapshot` Pick 키 집합** (회귀 그물 — 이 기능과 무관하게 앞으로도 지킨다)
  - [ ] `snapshotFromState` 결과가 top-level annotated 두 필드를 값까지 보존한다
  - [ ] 주석 후 패널 닫았다 열면 주석본이 복원된다(수동)

### Task 3: `ImageActions` 컴포넌트

- **변경 대상**: `src/sidepanel/components/ImageActions.tsx`(신규), `src/sidepanel/components/__tests__/ImageActions.test.tsx`(신규)
- **작업 내용**: `ButtonGroup` + `TooltipIconButton` 2개. **`variant`/`size`/`className="h-8 w-8"`을 넘기지 않는다** — 그 props는 존재하지 않고(TS 에러) `h-8 w-8`은 내부 하드코딩이다. `onReset`이 있을 때만 `[RotateCcw]`를 **조건부 렌더**(hidden 속성 금지). 아이콘 순서는 인라인 이미지와 동일하게 `[제거][주석]`. 라벨은 `draft.removeAnnotation` / `draft.addAnnotation`·`draft.editAnnotation`(주석 유무로 분기).
  - 표면은 `bg-background/90 shadow-md backdrop-blur-sm`(annotation 툴바 선례), hover 피드백은 배경이 아니라 글자색. `bg-muted/30` Card 위라 `hover:bg-accent`는 피드백이 0이다.
  - 래퍼는 `absolute right-2 top-2`. **`opacity-0`을 쓰지 않는다** — 투명해도 탭 순서에 남아 요소당 최대 4개의 보이지 않는 정지점을 만든다. hover/focus-within 상태를 부모가 판정해 **조건부 렌더**한다.
  - `data-testid` 부착: `diff-image-annotate` / `diff-image-reset`(인라인의 `inline-image-annotate`·`inline-image-reset` 선례). `aria-label`은 로케일 의존이라 e2e 셀렉터로 못 쓴다.
- **검증**:
  - [ ] `onReset` 없으면 버튼 1개, 있으면 2개
  - [ ] 각 버튼 클릭이 해당 핸들러를 1회 호출
  - [ ] `aria-label`이 `draft.*` 문구다(`title`은 붙지 않으므로 기준에서 제외)
  - [ ] 안 보이는 상태에서는 버튼이 DOM에 없다(탭 정지점 0)
  - [ ] 키보드 포커스로 진입하면 그룹이 보인다

### Task 4: `StyleChangesTable` optional 액션 prop + alt 분리

- **변경 대상**: `src/sidepanel/components/StyleChangesTable.tsx`, `src/sidepanel/components/__tests__/StyleChangesTable.test.tsx`(**신규** — 이 컴포넌트 전용 테스트는 현재 0건이다), `src/i18n/{ko,en}` alt 키
- **작업 내용**:
  - `SnapshotCell`이 `slot`·`annotated`·`onAnnotate`·`onReset`을 받아 `src = annotated ?? raw`로 그리고, `onAnnotate`가 **있을 때만** `ImageActions`를 렌더한다. `annotated`만 받고 핸들러가 없으면 표시만 주석본(`PreviewPanel`).
  - `slot`으로 `alt`를 before/after로 가른다 — 지금 두 칸이 `alt.capturedImage` 하나를 공유해 스크린 리더가 구분하지 못한다. 주석본일 때 문구를 달리한다. 신규 키 ko/en 동시 추가.
  - 이미지 래퍼 `Card`에 `group relative` 추가. 이미지 없는 칸은 지금과 동일.
- **검증**:
  - [ ] 핸들러 미전달 시 `ImageActions`가 DOM에 없다 — **`PreviewPanel`·`DraftDetailDialog`의 실제 호출부 형태 그대로 렌더해서** 확인(읽기 전용 화면 보호가 이 테스트의 본체)
  - [ ] 핸들러 미전달 + `annotated` 전달 시 `img src`가 주석본이고 버튼은 없다
  - [ ] `annotated`가 있으면 `img src`가 주석본, 없으면 원본
  - [ ] `annotated`가 있을 때만 제거 버튼이 뜬다
  - [ ] 이미지가 null이면 버튼도 없고 `styleTable.noSnapshot`만 나온다
  - [ ] before/after 칸의 `alt`가 서로 다르다
  - [ ] 핸들러·annotated 모두 미전달 시 기존 마크업이 무변경이다

### Task 5: `mergeStyleElements` 필드 통과

- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`, `src/sidepanel/lib/__tests__/buildIssueMarkdown.test.ts`
- **작업 내용**: `StyleElementContext`에 optional `beforeAnnotated`/`afterAnnotated` 추가, `current` 인자에 두 필드 추가, buffered→resolved 매핑에서도 통과. **여기서 resolve하지 않는다.**
- **검증**:
  - [ ] 현재 요소의 annotated가 출력 항목에 그대로 실린다
  - [ ] 버퍼 요소의 annotated가 인덱스에 맞게 실린다
  - [ ] 필드가 없는 구버전 버퍼 항목도 예외 없이 통과(undefined 유지)
  - [ ] 마크다운 본문 산출물은 무변경(기존 테스트 green)

### Task 6: 제출·미리보기·AI 경로 resolve

- **변경 대상**: `src/sidepanel/lib/buildEditorCapture.ts`, `src/sidepanel/lib/__tests__/buildEditorCapture.test.ts`, `src/sidepanel/tabs/PreviewPanel.tsx`, `src/sidepanel/tabs/AiDraftDialog.tsx`, `src/sidepanel/tabs/__tests__/getModeImages.test.ts`
- **작업 내용**:
  - `buildEditorMarkdownContext`가 top-level annotated 두 필드를 `mergeStyleElements`의 current 입력에 전달한다.
  - **`buildEditorLogsCaptureInput`의** `beforeImages`/`afterImages` 매핑을 `annotated ?? raw`로 접는다(`buildEditorMarkdownContext`가 아니다).
  - `PreviewPanel`이 `StyleChangesTable`에 `beforeAnnotated`/`afterAnnotated`를 전달한다(핸들러는 전달하지 않는다). 안 하면 미리보기는 원본, 제출물은 주석본이 된다.
  - `getModeImages`의 element 분기를 `annotated ?? raw`로. screenshot 분기는 이미 같은 규칙이다. **주석이 LLM으로 나가는 새 전송이므로 `docs/privacy.{ko,en}.md` 대조 대상**(`/push` 트리거).
  - `DraftDetailDialog`의 재제출 매핑은 무변경 — IDB에 이미 resolve된 이미지 한 장뿐이다.
- **검증**:
  - [ ] 주석이 있으면 `beforeImages[i]`가 주석본, 없으면 원본
  - [ ] 현재+버퍼 혼합 제출에서 각 annotated가 같은 인덱스의 이미지로 들어간다
  - [ ] `buildCaptureFiles` 파일명·인덱스는 불변(`before-0.webp` …)
  - [ ] `getModeImages(element)`가 주석본을 반환하고, 주석이 없으면 원본을 반환한다
  - [ ] `PreviewPanel`의 diff table `img src`가 주석본이고 액션 버튼은 없다

### Task 7: `AnnotationOverlay` 접근성·완료 상태 보강 (독립 — 인라인 이미지 주석과 공유)

- **변경 대상**: `src/sidepanel/components/AnnotationOverlay.tsx`, 관련 테스트
- **작업 내용**: dialog role/label, Escape 취소, 닫힌 뒤 실행 버튼 포커스 복귀, 완료 처리 중 done 버튼 비활성.
  - **이 컴포넌트는 `TiptapEditor`에서도 마운트되고 그 에디터는 `DraftEditDialog`(Radix Dialog) 안에서도 뜬다.** Escape를 그냥 달면 같은 키가 부모 다이얼로그까지 닫아 작성 중이던 초안 편집이 함께 날아간다 — 이벤트 전파를 막아야 한다.
  - 기존 키 핸들러의 `if (editing) return` 가드를 새 Escape에도 적용한다(텍스트 도형 편집 중 Escape는 textarea 취소 전용).
  - 슬롯 구분용 `data-testid`를 추가한다 — 현재 `annotation-overlay` 하나뿐이라 e2e가 스크린샷 주석과 diff 주석을 구분할 수 없다.
- **검증**:
  - [ ] 오버레이가 dialog role/label로 식별된다
  - [ ] Escape로 취소되고 닫힌 뒤 포커스가 실행 버튼으로 돌아간다
  - [ ] 텍스트 도형 편집 중 Escape는 textarea만 취소하고 오버레이는 남는다
  - [ ] **`DraftEditDialog` 안 인라인 이미지 주석에서 Escape가 다이얼로그를 닫지 않는다**
  - [ ] 완료 처리 중 done 버튼이 비활성이다
  - [ ] 기존 `e2e/annotation-overlay.spec.ts`·`inline-image-annotation.spec.ts` green 유지

### Task 8: `DraftingPanel` 배선 + React key

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`, `src/sidepanel/tabs/PreviewPanel.tsx`, `src/sidepanel/components/DraftDetailDialog.tsx`
- **작업 내용**:
  - `annotatingDiff: { selector, frameId, slot, url } | null` state.
  - `StyleChangesTable`에 `beforeAnnotated`/`afterAnnotated`/`onAnnotate`/`onReset` 전달(element 모드 diff table 렌더 지점만).
  - `onAnnotate(slot)` → `annotated ?? raw`로 배경 이미지를 정해 state set. `onReset(slot)` → 해당 annotated를 null로.
  - 쓰기 라우팅: `sameElementKey({ selector, frameId }, selection)`이면 store 액션, 아니면 `patchBufferedElement`.
  - **3화면의 diff section React key를 `elementKey(el)`로 바꾼다** — `DraftingPanel`·`PreviewPanel`·`DraftDetailDialog` 모두 현재 `key={el.selector}`라, 한 곳만 고치면 나머지에 동일 selector·다른 frameId 중복 key가 남는다(표시 전용이라 리스크는 낮다).
  - 카드 컨테이너에 `elementKey(el)` 기반 `data-testid` 추가 — 현재 Section testid가 전 카드 공통 `draft-media-block`이라 "버퍼 카드 vs 현재 카드"를 e2e로 판정할 수 없다.
  - 오버레이는 기존 스크린샷 주석 블록 옆에 같은 `Suspense` 관례로 마운트. `onComplete`에서 라우팅 후 state를 null로, `onCancel`은 state만 null.
  - `[다음]`·취소 시 `setAnnotatingDiff(null)`(기존 `setAnnotating(false)`와 같은 자리).
- **검증**:
  - [ ] before/after 각각 오버레이가 열리고 완료 시 해당 칸만 바뀐다
  - [ ] 버퍼 요소 카드의 주석이 현재 요소 카드에 안 붙는다
  - [ ] 재주석이 주석본 위에서 시작하고, 그 뒤 제거하면 **최초** 원본으로 돌아간다
  - [ ] 제거 후 버튼이 1개로 준다
  - [ ] cancel은 어느 슬롯도 변경하지 않는다
  - [ ] 동일 selector·서로 다른 frameId 카드의 key와 쓰기 대상이 충돌하지 않는다(순수 라우팅 헬퍼 단위 테스트)

## 테스트 계획

### 단위 테스트

- `editor-store.test.ts` — Task 1의 폐기·승격·보존 케이스. 특히 **"`bufferCurrentElement`가 같은 after면 보존, 다른 after면 폐기"** 와 **"afterImage 없는 patch는 annotated를 보존"** 두 쌍이 폐기 규율의 과잉/과소 적용을 양쪽에서 막는다. `confirmDraft`의 `saveImageBlob` 4슬롯 단언은 fire-and-forget이라 flush가 필요하다.
- `toLiteSnapshot` 순수 헬퍼 + `snapshotFromState` 키 집합 가드 — Task 2.
- `buildIssueMarkdown.test.ts` / `buildEditorCapture.test.ts` / `getModeImages.test.ts` — Task 5·6.
- `DraftingPanel` 배선에서 추출한 **순수 라우팅 헬퍼** — 현재/버퍼, before/after, 동일 selector·다른 frameId, cancel 무변경을 고정. e2e에서 내려온 시나리오가 여기 앉는다.
- **jsdom(`*.test.tsx`)**: `ImageActions`(버튼 개수·핸들러·미표시 시 DOM 부재), `StyleChangesTable`(핸들러 없으면 버튼 없음 — 읽기 전용 화면 보호가 이 테스트의 본체. **현재 이 컴포넌트 전용 테스트는 0건이라 신규다**).

### e2e 시나리오

`e2e/diff-image-annotation.spec.ts`(신규). element 모드 진입·스타일 편집은 기존 헬퍼(`enterDebugAndPick`·`typeStyleValue`) 재사용.

**시나리오를 3개로 제한한다.** `e2e/GOTCHAS.md`에 캡처를 진입로로 쓰는 spec 5개가 quota·cold-start flaky로 **전부 삭제된 전례**가 기록돼 있고, "캡처를 진입로로 쓰는 새 spec은 같은 함정을 밟는다"고 명시돼 있다. pick 직후 `fixture.bringToFront()` + spaced 대기를 쓰고, 새 캡처를 유발하는 단계를 최소화한다.

1. before 이미지의 액션에서 주석 전에는 제거 버튼이 없고, 도형 1개를 커밋해 완료하면 `img src`가 바뀌며 제거 버튼이 생긴다.
2. 제거를 누르면 `img src`가 주석 전 값으로 돌아가고 제거 버튼이 사라진다.
3. `to-preview`로 넘어간 preview 화면의 diff table에는 액션 버튼이 없고 `img src`는 주석본이다.

내려보낸 시나리오와 이유:

| 내려간 것 | 대체 |
|---|---|
| 버퍼 1 + 현재 1의 카드 분리 | 순수 라우팅 헬퍼 단위 테스트 |
| 동일 selector·다른 frameId | 순수 라우팅 헬퍼 단위 테스트 (iframe 픽스처 비용이 다른 시나리오의 몇 배다) |
| after 재캡처 후 폐기 | `editor-store.test.ts`의 값 비교 케이스 |
| 패널 닫았다 열기(세션 복원) | 수동 (Task 2 선행이라 e2e 순서상으로도 뒤) |

**드래그는 선택이 아니라 전제다.** `handleDone`은 `shapes.length === 0`이면 아무것도 하지 않고 `[완료]` 버튼 자체가 disabled다 — 도형 커밋 없이는 시나리오가 **진행조차 안 된다**(증상은 "원본과 같은 이미지"가 아니라 "오버레이가 안 닫힘"). 따라서 모든 시나리오에 Konva Stage 드래그 선행 단계를 명시하고, rect/ellipse는 대각선 드래그로 width·height 둘 다 0이 아니게 한다(`e2e/GOTCHAS.md`).

**공허해질 위험**: 주석 결과는 canvas 픽셀이라 "그림이 맞나"는 판정 불가다. `img src` 문자열의 **변화 여부**와 버튼 개수로만 판정한다.

### 수동 테스트

- **위험 5의 두 케이스** — ① 작은 캡처(요소 bbox+24px)에서 버튼 2개가 이미지를 얼마나 덮는지 ② **조상 컨테이너로 확장된 가로로 긴 캡처**(표시 높이 30~35px)에서 버튼이 이미지 아래로 뚫고 나오는지. ②가 PRD 배경이 지목한 주 사용 케이스다. 320px 폭에서도 본다. 견딜 수 없으면 대안 E(셀 하단 상시 배치)로 되돌린다.
- 105px 셀에서 Radix 툴팁이 이미지를 덮는 정도 — 위험 9.
- 다크모드에서 버튼 대비.
- **세션 스냅샷 쿼터 — 승인선은 조건부다**(위험 1). `조상 컨테이너 확장 상한(뷰포트 40%) × DPR 2 × 요소 2개`에서 before/after 네 장을 모두 주석한 뒤 DevTools로 `chrome.storage.session` 사용량을 재고, lite 강등 없이 패널 재오픈 후 네 주석본이 모두 복원되는지 확인한다. 실패하면 구현 승인 불가이며 **`capture.ts` 크롭에 `stitchGeometry`와 동일한 sqrt 픽셀 캡을 적용**한다.
- 요소 3~4개, 그리고 작은 캡처(≈250KB/요소)에서도 같은 사용량을 측정해 보장선 밖의 강등 시점을 참고값으로 기록한다.
- 초안 확정 → 상세에서 다시 열기 → diff table에 주석본이 보이고 액션 버튼은 없는지(PRD 시나리오 6).
- 제출까지 완주해 실제 이슈의 `before-0.webp`가 주석본인지 육안 확인.
- AI 초안 실행 시 첨부 이미지가 주석본인지(네트워크 페이로드 또는 결과 품질로 확인).

## 구현 순서 권장

```
Task 1 (store) ─→ Task 2 (세션)
                    └─────────────┐
Task 5 (merge) ─→ Task 6 (제출·preview·AI)
                    └─────────────┤
Task 3 (ImageActions) ─→ Task 4 (테이블)
                    └─────────────┴─→ Task 8 (배선) ─→ e2e

Task 7 (오버레이 a11y) — 독립. 단 e2e 앞에 끝나야 한다
```

- 세 갈래(1·2 / 3·4 / 5·6)는 서로 독립이라 병렬 가능. `annotated ?? raw`는 인라인이라 선행 태스크가 없다.
- Task 8은 1·4·5가 끝나야 붙는다.
- **Task 7은 다른 기능(인라인 이미지 주석)과 공유**되므로 독립적으로 먼저 끝내도 되고, 회귀 검증이 붙으므로 배선과 섞지 않는다.
- e2e는 Task 8 이후. 세션 복원 확인(수동)은 Task 2 선행.

## 문서 영향

- **가이드**: `guide/ko/element/`·`guide/en/element/`의 스타일 편집·리포트 작성 흐름 페이지 — before/after 이미지에 주석을 달 수 있다는 문장 한 줄과 버튼 설명이 필요하다. **`guide/ko/element/picker.md`의 "스크린샷에 주석을 달아 전달하는 편이 빠릅니다" 우회 안내는 삭제 대상**이다(이 기능이 그 우회의 이유를 없앤다 — PRD 촉발 신호). 정확한 대상 페이지는 `guide/AUTHORING.md`의 IA 표를 보고 정하고, 작성은 구현 후 `/guide`로 처리한다.
- **privacy**: Task 6이 AI 초안에 주석본을 실어 보낸다 — 사용자가 손으로 그린 주석이 LLM endpoint로 나가는 **새 전송**이라 manifest diff가 0이어도 `docs/privacy.ko.md`(원본)·`docs/privacy.en.md`(번역) 본문과 상단 시행일을 대조·갱신한다.
- **ARCHITECTURE.md**: 세션 영속화 절에 annotated 필드·폐기 규율·lite 폴백 동작을 **구현 커밋과 함께** 추가한다. 구현 전에 넣으면 `/doc-check` 양방향 대조가 거짓 green을 낸다.
