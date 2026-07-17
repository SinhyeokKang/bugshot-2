# 에디터 삽입 이미지 어노테이션 — 구현 태스크

## 선행 조건

- 신규 의존성 없음(Tiptap·Konva·IndexedDB 전부 기존 보유).
- IndexedDB `DB_VERSION` 7 → 8 bump 필요(새 store `inlineImageOrigins`). dev에서 기존 DB는 v8 upgrade가 새 store만 추가 → 무손상.
- 권한·env·OAuth 변화 없음. manifest 변화 없음 → privacy 문서 트리거 아님(캡처·전송 동작 신설 없이 기존 인라인 이미지 blob의 내용만 교체).

## 태스크

### Task 1: blob-db 원본 백업 store + prune 확장 (테스트 우선)
- **변경 대상**: `src/store/blob-db.ts`, `src/store/__tests__/blob-db.test.ts`(있으면 확장, 없으면 신규)
- **작업 내용**:
  - `DB_VERSION` 7 → 8. `STORE_INLINE_ORIGINS = "inlineImageOrigins"` 상수 + `onupgradeneeded`에 store 생성.
  - inlineImages 대칭 API: `saveInlineOrigin`, `getInlineOrigin`, `hasInlineOrigin`, `deleteInlineOrigins`, `getInlineOriginKeys`, `clearInlineOrigins`.
  - `pruneOrphanInlineImages` 내부에서 `getInlineOriginKeys()`도 조회해 `globalRefs`에 없는 origin key 삭제.
  - `clearInlineImages` 호출처(전체 초기화)가 있으면 `clearInlineOrigins`도 대칭 호출.
- **검증**:
  - [ ] `save`/`get`/`has`/`delete` 왕복 단위 테스트(fake-indexeddb 또는 기존 테스트 환경 관례 따름).
  - [ ] `hasInlineOrigin`이 미존재 시 false, 저장 후 true.
  - [ ] prune이 markdown 미참조 origin을 지우고, 참조 중 refId의 origin은 보존.
  - [ ] `pnpm typecheck` 통과.

### Task 2: 어노테이션 blob 스왑 헬퍼 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/inlineImageAnnotation.ts`(신규), `src/sidepanel/lib/__tests__/inlineImageAnnotation.test.ts`(신규)
- **작업 내용**:
  - `annotateInlineImage(refId, annotatedDataUrl)`: 최초만 원본 백업(`hasInlineOrigin` 가드) → 표시 blob 교체 → 새 blob 반환.
  - `resetInlineImage(refId)`: origin 있으면 복원 + origin 삭제 후 복원 blob 반환, 없으면 null.
- **검증**:
  - [ ] 최초 어노테이션: origin에 원본 저장됨, inlineImages는 annotated로 교체.
  - [ ] 재어노테이션: origin은 **최초 원본** 유지(두 번째 원본으로 덮이지 않음).
  - [ ] reset: inlineImages가 origin으로 복원 + origin 삭제 + 이후 `hasInlineOrigin` false.
  - [ ] reset(기록 없음): null 반환, 부작용 없음.

### Task 3: blockActions 아이콘·setHidden 추가
- **변경 대상**: `src/sidepanel/lib/blockActions.ts`
- **작업 내용**:
  - `ICON_PATHS`에 lucide `rotate-ccw`(→ `rotateCcw`), `pencil` path 인라인 추가(출처 주석 규칙 준수).
  - `BlockActions`에 `setHidden(testId, hidden)` 추가(버튼 `hidden` 속성/`display` 토글).
- **검증**:
  - [ ] `createBlockActions`로 rotateCcw/pencil 아이콘 렌더 확인(단위 — DOM에 svg path 존재).
  - [ ] `setHidden` 토글이 버튼 표시/숨김 반영.
  - [ ] 코드블럭 소비처(`codeCollapseShell.ts`) 회귀 없음(기존 copy/delete 그대로).

### Task 4: 커스텀 InlineImage extension + NodeView
- **변경 대상**: `src/sidepanel/extensions/InlineImage.ts`(신규)
- **작업 내용**:
  - `Image.extend<InlineImageOptions>({ addOptions, addNodeView })`. 스키마·직렬화 기본 유지(추가 attr 없음).
  - vanilla NodeView: `<div class="inline-image">` + `<img>` + `createBlockActions([reset, annotate, delete])`(순서 `[초기화][어노테이션][삭제]`).
  - reset → `resetInlineImage` → `updateImageSrc` + reset 버튼 숨김.
  - annotate → `options.onAnnotate({refId, getPos})`.
  - delete → `editor.deleteRange(pos..pos+nodeSize)`.
  - 마운트/`update` 시 `hasInlineOrigin(refId)`로 reset 버튼 노출 토글(첫 렌더 hidden → 조회 후 반영).
  - `useSettingsUiStore.subscribe`로 locale 변경 시 label 재적용(코드블럭 패턴).
  - 버튼 `contenteditable=false` + `stopEvent`로 PM 편집 누수 방지.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] (수동/e2e) 이미지 hover 시 우상단 버튼 그룹 노출, 스타일이 코드블럭과 동일.
  - [ ] (수동/e2e) delete 클릭 시 노드 즉시 제거.

### Task 5: TiptapEditor 배선 — extension 교체 + AnnotationOverlay 렌더
- **변경 대상**: `src/sidepanel/components/TiptapEditor.tsx`
- **작업 내용**:
  - `Image` → `InlineImage.configure({ resolveRefId, onAnnotate, labels })`. 콜백은 ref 우회(`handleImageFileRef` 패턴).
  - 신규 state `annotatingInline`. `onAnnotate`가 이걸 세팅.
  - `AnnotationOverlay` lazy import + `annotatingInline`일 때 `<Suspense>` 렌더. `imageUrl`은 열기 직전 `getInlineImage(refId)` → `blobToDataUrl`.
  - `handleInlineAnnotated`: `annotateInlineImage` → blob URL 재매핑(urlToRefMap/refToUrlMap/blobUrls) → `updateImageSrc(getPos, newUrl)` → state 초기화.
  - reset도 동일 재매핑 경로 필요(NodeView reset이 새 URL을 만들어야 하므로, reset 후 src 갱신을 NodeView가 직접 하되 urlToRefMap 갱신을 위해 extension option에 `onSwapUrl(refId, newUrl)` 콜백을 하나 더 두거나, reset/annotate 둘 다 `handleInlineAnnotated`류 상위 경로로 통일). **구현 시 결정**: reset도 상위 콜백(`onReset`)으로 올려 URL 재매핑을 TiptapEditor가 단일 관리하는 편이 맵 일관성에 안전.
- **검증**:
  - [ ] (수동) 어노테이션 → 이미지 갱신 → 재hover 시 초기화 버튼 등장.
  - [ ] (수동) 초기화 → 원본 복귀 → 초기화 버튼 사라짐.
  - [ ] (수동) 사이드패널 닫았다 열기 → 어노테이션 상태·초기화 버튼 유지.
  - [ ] `DraftEditDialog`에서도 오버레이가 다이얼로그 위에 정상 노출(z-index).

### Task 6: i18n 키 추가 (ko/en 동시)
- **변경 대상**: `src/i18n/`(ko·en), 필요 시 label getter 배선
- **작업 내용**: 본문 이미지 버튼 label 키 추가 또는 기존 `draft.*`/`common.*` 재사용 확정. ko/en 대칭.
- **검증**:
  - [ ] PostToolUse 훅(locales.test.ts) 통과(대칭·placeholder).
  - [ ] 버튼 aria-label/툴팁이 locale 따라 전환.

## 테스트 계획

- **단위 테스트**:
  - `blob-db`: origin API 왕복, `hasInlineOrigin`, prune이 origin orphan 정리·참조 보존(Task 1).
  - `inlineImageAnnotation`: annotate 최초 백업/재어노테이션 원본 보존/reset 복원·삭제/reset no-op(Task 2).
  - `blockActions`: 신규 아이콘 렌더, `setHidden` 토글(Task 3).
- **e2e 시나리오**(`/e2e-write` 입력):
  - "본문에 이미지를 삽입하고 hover 하면 우상단에 어노테이션·삭제 버튼이 보인다"(초기화는 안 보인다).
  - "이미지의 삭제 버튼을 누르면 본문에서 이미지가 사라진다".
  - "어노테이션 버튼을 누르면 어노테이션 오버레이가 열린다"(오버레이 진입까지 — 캔버스 그리기 판정은 수동).
  - data-testid: NodeView 버튼에 `inline-image-annotate`/`inline-image-reset`/`inline-image-delete` 부여(src 수정은 testid 추가만 허용).
- **수동 테스트**(자동화 불가):
  - 어노테이션 실제 그리기 → Done → 이미지 픽셀 갱신(캔버스 export, captureVisibleTab 무관하나 Konva 드래그라 jsdom 사각).
  - 초기화 후 원본 픽셀 정확 복귀(시각 정합).
  - `DraftEditDialog` 위 오버레이 z-index 노출.
  - 세션 닫기/열기 후 어노테이션 상태·초기화 버튼 유지, 최종 제출 이미지가 어노테이션 버전.
  - 이미지 여러 개일 때 각자 독립.

## 구현 순서 권장

1. **Task 1**(blob-db) → **Task 2**(헬퍼) → **Task 3**(blockActions): 서로 독립, 병렬 가능. 전부 순수·테스트 우선.
2. **Task 4**(InlineImage NodeView): Task 2·3 의존.
3. **Task 5**(TiptapEditor 배선): Task 4 의존. 여기서 실동작 확인.
4. **Task 6**(i18n): Task 4·5의 label 확정 후. 또는 Task 4와 병행.

## 가이드 영향

사용자 노출 UX 추가 → `guide/` 갱신 필요. 구현 후 `/guide`로 처리(작성 규칙은 `guide/AUTHORING.md`).
- 본문 에디터 이미지 편집을 다루는 페이지(ko·en). 정확한 파일은 `/guide`에서 IA 대조로 확정하되, "리포트 작성/본문 편집" 계열 페이지에 "삽입한 이미지에 마우스를 올려 어노테이션·초기화·삭제" 항목 추가.
