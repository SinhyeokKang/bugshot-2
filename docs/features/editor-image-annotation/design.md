# 에디터 삽입 이미지 어노테이션 — 기술 설계

## 개요

인라인 이미지는 `@tiptap/extension-image` 기본 노드로 렌더되고, blob은 IndexedDB `inlineImages` store에 `refId`로 저장되며 markdown에는 `![](inline:refId)`만 남는다(`TiptapEditor.tsx`, `resolveInlineImages.ts`, `blob-db.ts`). 이 구조를 최대한 건드리지 않기 위해 **직렬화 문법(`inline:refId`)과 refId를 그대로 유지하고 blob만 스왑**한다. 어노테이션 결과 webp를 `inlineImages[refId]`에 덮어쓰고, 어노테이션 직전 원본은 prune 대상 밖의 새 store `inlineImageOrigins[refId]`에 백업한다. 오버레이 버튼은 표준 Image 노드를 `Image.extend({ addNodeView })`로 감싼 **vanilla NodeView**가 그리고, 코드블럭이 쓰는 `createBlockActions` 팩토리를 재사용한다. 어노테이션 편집 자체는 기존 `AnnotationOverlay`를 `TiptapEditor` 내부에서 lazy 렌더해 재사용한다.

## 변경 범위

### 1. `src/store/blob-db.ts` — 원본 백업 store 추가
- **현재 역할**: IndexedDB(`bugshot-video`, `DB_VERSION=7`)에 video/image/log/inlineImages/attachments store 관리.
- **변경**:
  - `DB_VERSION` 7 → **8**. `onupgradeneeded`에 `STORE_INLINE_ORIGINS = "inlineImageOrigins"` object store 생성 추가(기존 store는 손대지 않아 데이터 무손실 — v7→v8은 새 store 생성만).
  - 새 API(기존 inlineImages API와 대칭): `saveInlineOrigin(refId, blob)`, `getInlineOrigin(refId)`, `hasInlineOrigin(refId): Promise<boolean>`, `deleteInlineOrigins(refIds: string[])`, `getInlineOriginKeys()`, `clearInlineOrigins()`.
  - `pruneOrphanInlineImages(activeRefIds)` 확장: 기존 `inlineImages` orphan 삭제에 더해, 동일 `globalRefs` 기준으로 `inlineImageOrigins`의 orphan도 삭제(refId 공간이 같음). markdown에서 사라진 이미지의 원본 백업까지 정리.
  - `clearInlineImages()` 호출처가 있으면(전체 초기화) `clearInlineOrigins()`도 함께 호출. → 호출처 확인 후 대칭 유지.

### 2. `src/sidepanel/lib/inlineImageAnnotation.ts` — 신규, 어노테이션 blob 스왑 순수 헬퍼
- **역할**: NodeView·overlay 콜백에서 부르는 blob-db 조작 로직을 순수 함수로 모아 테스트 가능하게 한다.
- 함수:
  - `annotateInlineImage(refId, annotatedDataUrl): Promise<Blob>` — (1) `hasInlineOrigin(refId)`가 false면 현재 `getInlineImage(refId)` 결과를 `saveInlineOrigin(refId, ...)`로 백업(최초 1회만, 재어노테이션 시 원본 보존). (2) `dataUrlToBlob(annotatedDataUrl)` → `saveInlineImage(refId, blob)`로 표시 blob 교체. (3) 새 표시 blob 반환.
  - `resetInlineImage(refId): Promise<Blob | null>` — `getInlineOrigin(refId)` → 있으면 `saveInlineImage(refId, orig)`로 복원 후 `deleteInlineOrigins([refId])`, 복원된 blob 반환. 없으면 null(no-op).
- **주의**: 원본 백업은 압축을 다시 걸지 않는다(이미 삽입 시 `compactImage`를 통과한 blob). 어노테이션 결과 webp는 `AnnotationOverlay`가 이미 quality 0.92 webp로 export하므로 추가 압축 불필요.

### 3. `src/sidepanel/extensions/InlineImage.ts` — 신규, 커스텀 Image extension + NodeView
- **역할**: `Image.extend()`로 표준 이미지 노드에 vanilla NodeView를 붙인다. 스키마·직렬화는 기본 Image 그대로(추가 attribute 없음 → markdown 왕복 무손상).
- `addOptions`: 콜백 주입 슬롯.
  ```ts
  interface InlineImageOptions {
    // 기본 Image 옵션 + 아래
    resolveRefId: (src: string) => string | undefined;   // blobUrl → refId (urlToRefMap 조회)
    onAnnotate: (ctx: { refId: string; getPos: () => number }) => void;
    labels: () => { annotate: string; reset: string; delete: string };
  }
  ```
- `addNodeView(): () => NodeView` — vanilla NodeView. 코드블럭 `CodeCollapseNodeView`와 동형:
  - `dom`: `<div class="inline-image">` (position: relative 래퍼) 안에 `<img contenteditable="false">` + `createBlockActions([...])`의 `el`.
  - 버튼 스펙 3개(순서 `[초기화][어노테이션][삭제]`):
    - `reset` (icon: `rotate-ccw` — blockActions ICON_PATHS에 추가 필요) → `resetInlineImage(refId)` → 성공 시 새 blob URL 만들어 `updateImageSrc(getPos, newUrl)` + 초기화 버튼 숨김.
    - `annotate` (icon: `pencil` — 추가 필요) → `options.onAnnotate({ refId, getPos })` 로 상위에 위임.
    - `delete` (icon: `trash`) → `editor.chain().deleteRange({ from: getPos(), to: getPos() + node.nodeSize }).run()`.
  - **초기화 버튼 노출 조건**: 마운트/`update` 시 `hasInlineOrigin(refId)`를 비동기 조회해 reset 버튼 `hidden` 토글. 어노테이션 직후에는 상위 콜백이 즉시 표시하도록 로컬 플래그도 반영(아래 데이터 흐름 참조).
  - locale: 코드블럭 NodeView와 동일하게 `useSettingsUiStore.subscribe`로 label getter 재적용(`options.labels()` 재호출 → `actions.setLabel`).
  - `ignoreMutation`/`stopEvent`: 버튼(`contenteditable=false`) 클릭이 PM 편집으로 새지 않게 코드블럭 셸과 동일 처리. img는 leaf 노드라 `contentDOM` 없음.
- **src 갱신 헬퍼** `updateImageSrc(getPos, url)`: `editor.chain().command(({tr}) => { tr.setNodeAttribute(getPos(), "src", url); return true; }).run()`. refId 불변이라 결과 markdown은 동일 `inline:refId`(역치환) — 문서 정합만 갱신.

### 4. `src/sidepanel/lib/blockActions.ts` — 아이콘 추가
- **변경**: `ICON_PATHS`에 lucide `rotate-ccw`, `pencil` path 인라인 추가(기존 copy/check/trash/chevron 옆). 주석 규칙(출처 표기, 값 안정성) 준수. `BlockActionIcon` 유니온이 자동 확장된다.
- **주의**: `createBlockActions` 자체는 이미 제네릭("블럭(코드블럭·이미지 등)")이라 로직 변경 없음. `setHidden(testId, hidden)` 메서드가 없으므로 reset 버튼 조건부 노출을 위해 **`setHidden` 추가**(또는 reset 버튼을 조건부로 `el.append`/`remove`). 최소 변경으로 `setHidden(testId, hidden)` 추가 권장.

### 5. `src/sidepanel/components/TiptapEditor.tsx` — extension 교체 + 오버레이 렌더
- **현재 역할**: `Image` 기본 extension 사용, inline blob resolve/역치환/orphan 정리 담당.
- **변경**:
  - `Image` → `InlineImage` (신규 extension). `.configure({ resolveRefId, onAnnotate, labels })` 로 클로저 주입.
    - `resolveRefId`: `(src) => urlToRefMap.current.get(src)` (기존 맵 재사용).
    - `onAnnotate`: `({refId, getPos}) => setAnnotatingInline({ refId, getPos })` (신규 React state).
    - `labels`: i18n `t()` getter.
  - useEditor는 1회 생성이라 최신 클로저 캡처 문제 → 기존 `handleImageFileRef` 패턴대로 **ref 우회**(`onAnnotate`가 `annotateRef.current`를 호출).
  - **신규 state** `annotatingInline: { refId: string; getPos: () => number } | null`.
  - **AnnotationOverlay lazy 렌더**(컴포넌트 반환부, 기존 dragOver div 옆):
    ```tsx
    {annotatingInline && (
      <Suspense fallback={null}>
        <AnnotationOverlay
          imageUrl={/* refId → 현재 표시 blob dataUrl */}
          onComplete={(url) => void handleInlineAnnotated(annotatingInline, url)}
          onCancel={() => setAnnotatingInline(null)}
        />
      </Suspense>
    )}
    ```
    `AnnotationOverlay`는 `imageUrl: string`(dataUrl)만 받으므로, 오버레이 열기 직전 `getInlineImage(refId)` → `blobToDataUrl`로 현재 표시 이미지를 dataUrl로 만들어 넘긴다.
  - `handleInlineAnnotated({refId, getPos}, annotatedUrl)`:
    1. `annotateInlineImage(refId, annotatedUrl)` → 새 표시 blob.
    2. 기존 blob URL revoke, `URL.createObjectURL(newBlob)` → `urlToRefMap`/`refToUrlMap`/`blobUrls` 갱신(같은 refId 재매핑).
    3. `updateImageSrc(getPos, newUrl)`(editor 커맨드)로 노드 src 교체.
    4. `setAnnotatingInline(null)`.
  - `AnnotationOverlay` import는 `DraftingPanel`처럼 `lazy(() => import("./AnnotationOverlay"))`. **주의**: `DraftingPanel`도 별도로 `AnnotationOverlay`를 lazy import 중 — 같은 청크를 공유하므로 중복 로드는 아니다(Vite dedupe).
- **DraftEditDialog 자동 커버**: `DraftEditDialog`도 `TiptapEditor`를 쓰므로 오버레이가 그 안에서도 뜬다. 단 `AnnotationOverlay`는 `fixed inset-0 z-50` 풀스크린이라 다이얼로그 위에도 정상 노출됨(z-index 확인 필요 — 위험 요소 참조).

### 6. `src/store/blob-db.ts` orphan prune 호출처 — 확인만
- `pruneOrphanInlineImages`가 origins도 정리하도록 2번에서 확장했으므로, 호출처(세션 sync·마운트 정리)는 무변경. 삭제 버튼으로 markdown에서 refId가 사라지면 다음 prune 사이클에 inlineImages+origins가 함께 정리된다.

### 7. i18n — `src/i18n/` (ko/en 동시)
- 신규 키(본문 이미지 버튼 label): `editor.image.annotate`, `editor.image.reset`, `editor.image.delete`(또는 기존 `draft.addAnnotation`/`draft.removeAnnotation`/`common.delete` 재사용 검토). 아이콘 버튼 aria-label/툴팁용.
- ko/en 양쪽 동시 갱신(훅이 대칭 검사). log-viewer 사전(`src/log-viewer/i18n.ts`)은 이 컴포넌트를 재사용하지 않으므로 갱신 불필요.

## 데이터 흐름

```
[삽입] file → compactImage → inlineImages[refId]=blob, markdown `![](inline:refId)`   (기존, 무변경)

[어노테이션]
 NodeView annotate 클릭
   → onAnnotate({refId, getPos})  (extension option → TiptapEditor ref)
   → getInlineImage(refId) → blobToDataUrl → AnnotationOverlay(imageUrl)
   → 사용자 편집 → onComplete(annotatedUrl webp)
   → annotateInlineImage(refId, url):
        hasInlineOrigin(refId)? no → saveInlineOrigin(refId, 현재 inlineImages blob)   // 원본 백업(최초 1회)
        saveInlineImage(refId, dataUrlToBlob(url))                                     // 표시 blob 교체
   → 새 blobURL 재매핑 → tr.setNodeAttribute(pos, src, newUrl)                          // 표시 갱신
   → NodeView reset 버튼 노출(hasInlineOrigin=true)

[초기화]
 NodeView reset 클릭
   → resetInlineImage(refId):
        getInlineOrigin(refId) → saveInlineImage(refId, orig) → deleteInlineOrigins([refId])
   → 새 blobURL 재매핑 → tr.setNodeAttribute(pos, src, restoredUrl)
   → reset 버튼 숨김

[삭제]
 NodeView delete 클릭
   → editor.deleteRange(pos..pos+nodeSize)                    // 노드 제거 → markdown에서 refId 소실
   → (다음 prune 사이클) inlineImages[refId]+inlineOrigins[refId] orphan 정리

[직렬화·제출]  editorMarkdown 역치환 → `inline:refId`(불변).  최종 제출은 resolveInlineImages가 inlineImages[refId](=현재 표시)만 dataUrl화. origins는 외부로 안 나감.
```

**핵심 불변식**: refId는 이미지 수명 내내 고정. 어노테이션/초기화는 `inlineImages[refId]`의 blob 내용만 바꾼다. 따라서 markdown·세션 스냅샷·orphan prune·최종 제출 경로 전부 무변경으로 재사용된다.

## 인터페이스 설계

```ts
// blob-db.ts (신규)
export function saveInlineOrigin(refId: string, blob: Blob): Promise<boolean>;
export function getInlineOrigin(refId: string): Promise<Blob | null>;
export function hasInlineOrigin(refId: string): Promise<boolean>;
export function deleteInlineOrigins(refIds: string[]): Promise<void>;
export function getInlineOriginKeys(): Promise<string[]>;
export function clearInlineOrigins(): Promise<void>;
// pruneOrphanInlineImages는 시그니처 불변, 내부에서 origins도 정리

// inlineImageAnnotation.ts (신규)
export function annotateInlineImage(refId: string, annotatedDataUrl: string): Promise<Blob>;
export function resetInlineImage(refId: string): Promise<Blob | null>;

// blockActions.ts (확장)
type BlockActionIcon = "copy" | "check" | "trash" | "chevronDown" | "chevronUp"
  | "rotateCcw" | "pencil";           // 2개 추가
interface BlockActions {
  el: HTMLDivElement;
  setIcon(testId: string, icon: BlockActionIcon): void;
  setLabel(testId: string, label: string): void;
  setHidden(testId: string, hidden: boolean): void;   // 신규 — reset 조건부 노출
  destroy(): void;
}

// InlineImage.ts (신규)
interface InlineImageOptions {
  resolveRefId: (src: string) => string | undefined;
  onAnnotate: (ctx: { refId: string; getPos: () => number }) => void;
  labels: () => { annotate: string; reset: string; delete: string };
}
export const InlineImage: Node;   // Image.extend(...)

// TiptapEditor.tsx (신규 로컬 state)
type AnnotatingInline = { refId: string; getPos: () => number } | null;
```

## 기존 패턴 준수

- **vanilla NodeView + createBlockActions 재사용**: 코드블럭(`codeCollapseShell.ts`, `CodeCollapseNodeView`)이 이미 확립한 "React 미도달 DOM에 shadcn 버튼을 vanilla로 재현" 패턴을 그대로 따른다. `block-actions.css`(top-2/right-2, hover opacity, 병합 코너)를 그대로 상속.
- **refId 스왑으로 직렬화 불변**: `inline:refId` 문법·`INLINE_REF_RE`·`replaceInlineRefs`·`editorMarkdown` 역치환·`collectAllActiveInlineRefs` 전부 무변경. CLAUDE.md의 "외과적 변경" 원칙.
- **prune 대상 밖 원본 store**: `pruneOrphanInlineImages`가 markdown 미참조 blob을 지우는 구조를 존중하면서, 원본 백업을 별도 store로 분리해 실수로 지워지지 않게 한다.
- **IndexedDB 마이그레이션**: `DB_VERSION` bump + `onupgradeneeded`에서 새 store만 추가(기존 store 무손상). 기존 v1→v7 확장과 동일 관례.
- **i18n 동시 갱신**: ko/en 대칭(PostToolUse 훅). 컴포넌트는 log-viewer 미재사용이라 복제 사전 갱신 불필요.
- **테스트 우선**: 신규 순수 헬퍼(`annotateInlineImage`/`resetInlineImage`, blob-db origin API)는 테스트 먼저.
- **세션 영속화**: 어노테이션 상태는 blob 내용으로만 표현되므로 기존 세션 sync(`useEditorSessionSync`)가 자동 커버. 별도 상태 필드 없음.

## 대안 검토

- **A. markdown 문법 확장 `![](inline:displayRef;orig=origRef)`** — 원본ref를 markdown에 실어 세션·prune에 태우는 방식. 기각: `INLINE_REF_RE`·`replaceInlineRefs`·`extractInlineRefs`·`scanInlineRefs`(blob-db) 등 정규식 5곳을 전부 확장해야 하고, 최종 제출 markdown에 비표준 토큰이 샐 위험. refId 스왑 방식이 직렬화 로직 0변경으로 같은 목표를 달성.
- **B. 노드 attribute에 `origRef`/`annotated` 저장** — 기각: `tiptap-markdown`이 이미지를 `![](src)`로만 직렬화해 커스텀 attr이 markdown 왕복에서 소실. 세션 복원(setContent가 markdown 기반) 후 원본 참조·기록 유무가 사라져 초기화 불가.
- **C. ReactNodeViewRenderer로 이미지 노드 React화** — 기각: 버튼 UI를 JSX로 새로 그리게 돼 코드블럭과 스타일 출처가 갈리고("코드블럭 식" 요구와 어긋남), 에디터에 이미지 개수만큼 React 루트가 심겨 무거워진다. vanilla NodeView + `createBlockActions`가 기존 패턴과 정합.
- **D. 원본 백업을 `inlineImages`에 `${refId}:orig` key로** — 기각: 그 key는 markdown에 안 나타나 `pruneOrphanInlineImages`가 orphan으로 삭제 → 초기화 불가. 별도 store가 필요한 이유.

## 위험 요소

- **AnnotationOverlay z-index vs DraftEditDialog**: 오버레이는 `fixed inset-0 z-50`. `DraftEditDialog`(shadcn Dialog)가 오버레이보다 높은 z-index/portal이면 어노테이션이 가려질 수 있다. `DraftEditDialog` 내부에서 어노테이션 열 때 오버레이가 다이얼로그 위에 정상 노출되는지 **수동 확인 필수**(필요 시 오버레이 z-index 상향 또는 portal 조정).
- **useEditor 클로저 stale**: `onAnnotate`/`labels` 콜백이 마운트 시점 클로저를 캡처. 기존 `handleImageFileRef` 패턴(ref 우회)을 반드시 따라야 최신 state/t()를 참조.
- **blob URL 수명**: 어노테이션·초기화로 blob URL을 교체할 때 이전 URL revoke 타이밍. 너무 일찍 revoke하면 setNodeAttribute 반영 전 이미지가 깨진다. 새 URL로 attr 갱신 → 다음 tick에 이전 URL revoke, 또는 언마운트 일괄 revoke(`blobUrls.current`)에 위임. jsdom으로 못 잡으므로 실제 탭 확인.
- **NodeView 재생성 시 초기화 버튼 상태**: `hasInlineOrigin` 비동기 조회 결과가 오기 전엔 reset 버튼 숨김이 기본. 조회 완료 후 표시. 깜빡임 최소화를 위해 첫 렌더는 hidden, 조회 후 show.
- **getPos 안정성**: 문서 편집으로 위치가 바뀐 뒤의 어노테이션 완료 콜백에서 `getPos()`가 최신 위치를 반환하는지(PM NodeView `getPos`는 항상 최신). 삭제된 노드에 대한 setNodeAttribute 방어(pos 유효성) 필요.
- **드래그·캔버스는 jsdom 사각지대**: 어노테이션 오버레이 상호작용은 e2e·수동만 안전망(POSTMORTEM 기록). 이 기능의 자동 테스트는 blob 스왑·직렬화 불변·버튼 노출 조건에 집중하고, 실제 그리기는 수동.
