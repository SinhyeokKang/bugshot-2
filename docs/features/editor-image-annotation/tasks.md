# 에디터 삽입 이미지 어노테이션 — 구현 태스크

## 선행 조건

- **신규 devDependency 1개: `fake-indexeddb`** — Task 1의 blob-db origin store 왕복·prune을 실경로로 단위 테스트하려면 필요하다(저장소에 IndexedDB fake 없음, blob-db는 다른 테스트에서 전부 `vi.mock`). **주의**: `pnpm-workspace.yaml`의 `minimumReleaseAge: 1440`(24h) 정책 대상 — 최신 버전이 24h 미경과면 직전 버전이 설치된다. 런타임 의존이 아니라 devDependency라 배포 산출물엔 안 실린다.
- IndexedDB `DB_VERSION` 7 → 8 bump 필요(새 store `inlineImageOrigins`). dev에서 기존 DB는 v8 upgrade가 새 store만 추가 → 무손상.
- 권한·env·OAuth 변화 없음. manifest 변화 없음 → privacy 문서 트리거 아님(캡처·전송 동작 신설 없이 기존 인라인 이미지 blob의 내용만 교체).

## 태스크

### Task 1: blob-db 원본 백업 store + prune 확장 (테스트 우선)
- **변경 대상**: `src/store/blob-db.ts`, `src/store/__tests__/blob-db.test.ts`(있으면 확장, 없으면 신규)
- **작업 내용**:
  - `DB_VERSION` 7 → 8. `STORE_INLINE_ORIGINS = "inlineImageOrigins"` 상수 + `onupgradeneeded`에 store 생성.
  - inlineImages 대칭 API: `saveInlineOrigin`, `getInlineOrigin`, `hasInlineOrigin`, `deleteInlineOrigins`, `getInlineOriginKeys`. **`clearInlineOrigins`는 만들지 않는다** — 대칭 함수 `clearInlineImages`가 이미 호출처 0(dead API)이라 대칭 추가 시 dead code(외과적 변경 원칙).
  - `pruneOrphanInlineImages` 내부에서 **기존 `inlineImages` orphan 계산에 쓰는 동일 `orphans` 집합을 재사용**해 origin key도 삭제(독립 재계산 금지 — 참조 중 refId 원본 오삭제 방지).
- **검증**(단위는 `fake-indexeddb`로 blob-db 실경로 구동 — 테스트 상단에서 `import "fake-indexeddb/auto"`):
  - [ ] `save`/`get`/`has`/`delete` 왕복 단위 테스트.
  - [ ] `hasInlineOrigin`이 미존재 시 false, 저장 후 true.
  - [ ] prune이 markdown 미참조 origin을 지우고, 참조 중 refId의 origin은 보존.
  - [ ] prune이 origin orphan을 **inlineImages와 동일 orphan 집합**으로 정리(별도 재계산 아님)함을 검증.
  - [ ] `pnpm typecheck` 통과.

### Task 2: 어노테이션 blob 스왑 헬퍼 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/inlineImageAnnotation.ts`(신규), `src/sidepanel/lib/__tests__/inlineImageAnnotation.test.ts`(신규)
- **작업 내용**:
  - `annotateInlineImage(refId, annotatedDataUrl)`: 최초만 원본 백업(`hasInlineOrigin` 가드, **`getInlineImage(refId)`가 null이면 백업 스킵**) → 표시 blob 교체 → 새 blob 반환.
  - `resetInlineImage(refId)`: origin 있으면 복원 + origin 삭제 후 복원 blob 반환, 없으면 null.
- **검증**(`fake-indexeddb` 실경로 또는 blob-db 모킹 — Task 1 방식과 통일):
  - [ ] 최초 어노테이션: origin에 원본 저장됨, inlineImages는 annotated로 교체.
  - [ ] 재어노테이션: origin은 **최초 원본** 유지(두 번째 원본으로 덮이지 않음).
  - [ ] `getInlineImage`가 null일 때: origin 백업 스킵(빈 origin 저장 안 됨), 표시 blob만 교체.
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

### Task 4: 이미지 NodeView — 신규 extension + 셸 (코드블럭 `props.nodeViews` 방식)
- **변경 대상**: `src/sidepanel/extensions/imageAnnotation.ts`(신규), `src/sidepanel/lib/inlineImageShell.ts`(신규 셸), `src/sidepanel/components/tiptap-editor.css`(min-width)
- **방식**: `Image.extend({addNodeView})`가 **아니라**, 코드블럭 collapse와 동일하게 stock `Image`는 유지하고 별도 `Extension.create({ name: "imageAnnotation", addProseMirrorPlugins })`가 `props.nodeViews.image`에 팩토리를 등록(`codeBlockCollapse` → `props.nodeViews.codeBlock` 대칭).
- **작업 내용**:
  - `inlineImageShell.ts`: `createInlineImageShell(labels, specs)` → `{ el, actions, img, destroy }`. `<div class="inline-image">`(position:relative) + `<img contenteditable=false>` + `createBlockActions([reset, annotate, delete])`(순서 `[초기화][어노테이션][삭제]`).
  - `imageAnnotation.ts`: `addOptions`로 `ImageAnnotationOptions`(resolveRefId/onAnnotate/**onReset**/labels) 주입 + 플러그인이 `props.nodeViews.image` 등록.
  - NodeView 클래스(`ImageAnnotationNodeView`, TiptapEditor 내부 배치 — `CodeCollapseNodeView` 옆):
    - reset → `options.onReset({refId, getPos})` (NodeView가 직접 URL 안 만듦, 상위 위임).
    - annotate → `options.onAnnotate({refId, getPos})`.
    - delete → `editor.deleteRange(pos..pos+nodeSize)`.
    - **마운트 시점**(hover 이전)에 `hasInlineOrigin(refId)`로 reset 버튼 노출 토글 + **버튼 자리(width) 예약**으로 코너 라운딩 점프 방지.
    - `useSettingsUiStore.subscribe`로 locale 변경 시 label 재적용(코드블럭 패턴).
    - 버튼 `contenteditable=false` + `stopEvent`로 PM 편집 누수 방지.
  - `tiptap-editor.css`: 인라인 이미지 `img`에 `min-width`(버튼 그룹 폭 이상, 예 `7rem`) 추가 — 소형 이미지 오버플로우 방지.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] (수동/e2e) 이미지 hover 시 우상단 버튼 그룹 노출, 스타일이 코드블럭과 동일.
  - [ ] (수동/e2e) delete 클릭 시 노드 즉시 제거.
  - [ ] (수동) 소형 이미지(≈60px)에서 버튼 그룹이 이미지 밖으로 안 넘침.

### Task 5: TiptapEditor 배선 — extension 등록 + AnnotationOverlay 렌더
- **변경 대상**: `src/sidepanel/components/TiptapEditor.tsx`
- **작업 내용**:
  - stock `Image` 유지 + `imageAnnotation.configure({ resolveRefId, onAnnotate, onReset, labels })`를 확장 배열에 추가. 콜백은 ref 우회(`handleImageFileRef` 패턴 — `annotateRef`/`resetRef`).
  - 신규 state `annotatingInline`. `onAnnotate`가 이걸 세팅.
  - `AnnotationOverlay` lazy import + `annotatingInline`일 때 **`createPortal(<Suspense>…</Suspense>, document.body)`** 렌더(Radix Dialog focus-trap·스태킹 탈출). `imageUrl`은 열기 직전 `getInlineImage(refId)` → `blobToDataUrl`.
  - **reset/annotate 둘 다 상위 콜백으로 통일**: `onReset` → `handleInlineReset`, `onComplete` → `handleInlineAnnotated`. URL 재매핑(urlToRefMap/refToUrlMap/blobUrls)을 TiptapEditor가 단일 관리 — NodeView가 직접 `createObjectURL` 하지 않음(raw `blob:` 마크다운 누수·revoke 누락 차단).
  - **getPos stale 방어**: 완료 콜백에서 `getPos()`를 맹신하지 말고 **`refId`로 doc를 스캔해 최신 pos 재탐색** 후 `updateImageSrc(pos, newUrl)`. 노드가 사라졌으면 no-op.
- **검증**:
  - [ ] (수동) 어노테이션 → 이미지 갱신 → 재hover 시 초기화 버튼 등장.
  - [ ] (수동) 초기화 → 원본 복귀 → 초기화 버튼 사라짐.
  - [ ] (수동) 재어노테이션 2회 후 초기화 → **최초 원본**으로 복귀(전체 루프).
  - [ ] (수동) 사이드패널 닫았다 열기 → 어노테이션 상태·초기화 버튼 유지, 최종 제출 이미지가 어노테이션 버전.
  - [ ] (수동) 오버레이 열린 상태에서 패널/세션 닫기 → Cancel과 동치(무해), 재오픈 시 원상.
  - [ ] (수동) `DraftEditDialog`에서 오버레이가 다이얼로그 위에 정상 노출 + 그리기·Escape 동작(focus-trap 충돌 없음).

### Task 6: i18n 키 추가 (ko/en 동시)
- **변경 대상**: `src/i18n/`(ko·en), 필요 시 label getter 배선
- **작업 내용**: 본문 이미지 버튼 label 신규 키 **확정** — `editor.image.annotate`/`editor.image.reset`/`editor.image.delete`(기존 `draft.*`/`common.*` 재사용 안 함, 의미 혼선). ko/en 대칭.
- **검증**:
  - [ ] PostToolUse 훅(locales.test.ts) 통과(대칭·placeholder).
  - [ ] 버튼 aria-label/툴팁이 locale 따라 전환.

## 테스트 계획

- **단위 테스트**:
  - `blob-db`: origin API 왕복, `hasInlineOrigin`, prune이 **동일 orphan 집합**으로 origin orphan 정리·참조 보존(Task 1, `fake-indexeddb`).
  - `inlineImageAnnotation`: annotate 최초 백업/재어노테이션 원본 보존/`getInlineImage` null 시 백업 스킵/reset 복원·삭제/reset no-op(Task 2).
  - `blockActions`: 신규 아이콘 렌더, `setHidden` 토글(Task 3).
  - **refId 불변 회귀**(설계 핵심 불변식): annotate → `getInlineImage(refId)`가 새 blob 반환 → `resolveInlineImages`가 새 dataUrl 산출, **markdown의 `inline:refId`는 불변**(모킹으로 검증 가능). design.md "핵심 불변식" 대응.
- **e2e 시나리오**(`/e2e-write` 입력):
  - **전제 하니스(신규 필요)**: 현재 Tiptap 에디터에 이미지를 삽입하는 e2e가 0개다. 아래 spec 전에 **Playwright 이미지 삽입 하니스(파일 drop 또는 인라인 캡처 배선)**를 `/e2e-write`에서 신규 구축한다. 이게 선행 게이트.
  - "본문에 이미지를 삽입하고 hover 하면 우상단에 어노테이션·삭제 버튼이 보인다"(초기화는 안 보인다).
  - "이미지의 삭제 버튼을 누르면 본문에서 이미지가 사라진다".
  - "어노테이션 버튼을 누르면 어노테이션 오버레이가 열린다"(오버레이 진입까지 — 캔버스 그리기 판정은 수동).
  - data-testid: NodeView 버튼에 `inline-image-annotate`/`inline-image-reset`/`inline-image-delete` 부여(src 수정은 testid 추가만 허용).
- **수동 테스트**(자동화 불가):
  - **Image→NodeView 스왑 회귀(최우선)**: stock Image에 NodeView를 얹은 뒤에도 drop/paste/인라인캡처로 이미지가 여전히 삽입되고, 저장·재로드(markdown `inline:refId` 왕복)에서 유실 없는지. (스왑이 깨지면 조용히 전 경로 이미지 유실.)
  - 어노테이션 실제 그리기 → Done → 이미지 픽셀 갱신(캔버스 export, Konva 드래그라 jsdom 사각).
  - 빈 Done(도형 0개) → 변경 없음(Cancel 동치) 확인.
  - 초기화 후 원본 픽셀 정확 복귀(시각 정합), 재어노테이션 2회 후 초기화도 최초 원본.
  - `DraftEditDialog` 위 오버레이 노출 + focus-trap/Escape 충돌 없음(createPortal 효과).
  - 세션 닫기/열기 후 어노테이션 상태·초기화 버튼 유지, 최종 제출 이미지가 어노테이션 버전.
  - 소형 이미지(≈60px) 버튼 그룹 오버플로우 없음.
  - 이미지 여러 개일 때 각자 독립.

## 구현 순서 권장

1. **Task 1**(blob-db) → **Task 2**(헬퍼) → **Task 3**(blockActions): 서로 독립, 병렬 가능. 전부 순수·테스트 우선.
2. **Task 4**(imageAnnotation extension + 셸 NodeView): Task 2·3 의존.
3. **Task 5**(TiptapEditor 배선): Task 4 의존. 여기서 실동작 확인.
4. **Task 6**(i18n): Task 4·5의 label 확정 후. 또는 Task 4와 병행.

## 가이드 영향

사용자 노출 UX 추가 → `guide/` 갱신 필요. 구현 후 `/guide`로 처리(작성 규칙은 `guide/AUTHORING.md`).
- 본문 에디터 이미지 편집을 다루는 페이지(ko·en). 정확한 파일은 `/guide`에서 IA 대조로 확정하되, "리포트 작성/본문 편집" 계열 페이지에 "삽입한 이미지에 마우스를 올려 어노테이션·초기화·삭제" 항목 추가.
