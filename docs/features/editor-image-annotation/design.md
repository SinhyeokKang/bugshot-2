# 에디터 삽입 이미지 어노테이션 — 기술 설계

## 개요

인라인 이미지는 `@tiptap/extension-image` 기본 노드로 렌더되고, blob은 IndexedDB `inlineImages` store에 `refId`로 저장되며 markdown에는 `![](inline:refId)`만 남는다(`TiptapEditor.tsx`, `resolveInlineImages.ts`, `blob-db.ts`). 이 구조를 최대한 건드리지 않기 위해 **직렬화 문법(`inline:refId`)과 refId를 그대로 유지하고 blob만 스왑**한다. 어노테이션 결과 webp를 `inlineImages[refId]`에 덮어쓰고, 어노테이션 직전 원본은 prune 대상 밖의 새 store `inlineImageOrigins[refId]`에 백업한다. 오버레이 버튼은 stock Image 노드에 **`props.nodeViews.image` 팩토리로 vanilla NodeView를 붙여** 그린다 — 코드블럭 collapse가 별도 `Extension.create` + `props.nodeViews.codeBlock`으로 stock `codeBlock`에 NodeView를 얹는 것과 **동형**이다(`TiptapEditor.tsx:272-279`, `CodeCollapseNodeView`). NodeView 셸은 코드블럭이 쓰는 `createBlockActions` 팩토리를 재사용한다. 어노테이션 편집 자체는 기존 `AnnotationOverlay`를 `TiptapEditor` 내부에서 lazy 렌더해 재사용한다.

> **범위 명시(스코프)**: "AnnotationOverlay 재사용"은 편집 캔버스만 공유한다는 뜻이고, 이 기능은 순수 추가분으로 **① stock Image에 얹는 신규 이미지 NodeView(props.nodeViews.image), ② N개 인라인 이미지용 원본 백업 store `inlineImageOrigins` + DB v7→8**을 새로 도입한다(현재 원본/어노테이션 페어링은 스크린샷 단일쌍 `editor-store.screenshotRaw/Annotated`뿐). 재사용은 캔버스에 국한되고 배선·저장 모델은 신규다.

## 변경 범위

### 1. `src/store/blob-db.ts` — 원본 백업 store 추가
- **현재 역할**: IndexedDB(`bugshot-video`, `DB_VERSION=7`)에 video/image/log/inlineImages/attachments store 관리.
- **변경**:
  - `DB_VERSION` 7 → **8**. `onupgradeneeded`에 `STORE_INLINE_ORIGINS = "inlineImageOrigins"` object store 생성 추가(기존 store는 손대지 않아 데이터 무손실 — v7→v8은 새 store 생성만).
  - 새 API(기존 inlineImages API와 대칭): `saveInlineOrigin(refId, blob)`, `getInlineOrigin(refId)`, `hasInlineOrigin(refId): Promise<boolean>`, `deleteInlineOrigins(refIds: string[])`, `getInlineOriginKeys()`. **`clearInlineOrigins()`는 만들지 않는다** — 대칭 함수 `clearInlineImages()`가 이미 `src/` 전체에 호출처 0(dead API, `blob-db.ts:478`)이라, 대칭으로 추가하면 그것도 dead code가 된다(CLAUDE.md "요청 안 한 유연성 금지 / 외과적 변경").
  - `pruneOrphanInlineImages(activeRefIds)` 확장: 기존 `inlineImages` orphan을 계산할 때 쓰는 **동일 `orphans` 집합**(`blob-db.ts:527`)을 그대로 재사용해 `inlineImageOrigins`의 orphan도 삭제한다(refId 공간이 같음). **origin orphan을 독립 재계산하지 않는다** — 재계산하면 참조 중 refId의 원본이 오삭제될 위험. markdown에서 사라진 이미지의 원본 백업까지 정리.

### 2. `src/sidepanel/lib/inlineImageAnnotation.ts` — 신규, 어노테이션 blob 스왑 순수 헬퍼
- **역할**: NodeView·overlay 콜백에서 부르는 blob-db 조작 로직을 순수 함수로 모아 테스트 가능하게 한다.
- 함수:
  - `annotateInlineImage(refId, annotatedDataUrl): Promise<Blob>` — (1) `hasInlineOrigin(refId)`가 false면 현재 `getInlineImage(refId)` 결과를 `saveInlineOrigin(refId, ...)`로 백업(최초 1회만, 재어노테이션 시 원본 보존). **`getInlineImage(refId)`가 null이면(blob 유실) `saveInlineOrigin`을 건너뛴다** — null을 origin으로 저장하면 이후 reset가 빈 origin으로 복원하는 사고가 난다. (2) `dataUrlToBlob(annotatedDataUrl)` → `saveInlineImage(refId, blob)`로 표시 blob 교체. (3) 새 표시 blob 반환.
  - `resetInlineImage(refId): Promise<Blob | null>` — `getInlineOrigin(refId)` → 있으면 `saveInlineImage(refId, orig)`로 복원 후 `deleteInlineOrigins([refId])`, 복원된 blob 반환. 없으면 null(no-op).
- **주의**: 원본 백업은 압축을 다시 걸지 않는다(이미 삽입 시 `compactImage`를 통과한 blob). 어노테이션 결과 webp는 `AnnotationOverlay`가 이미 quality 0.92 webp로 export하므로 추가 압축 불필요.

### 3. 이미지 NodeView — 신규 extension + 셸 (코드블럭 방식 미러)
> **방식 결정**: `Image.extend({ addNodeView })`가 아니라, 코드블럭 collapse와 **동일한 컨벤션**을 따른다 — stock `Image`는 그대로 두고, 별도 `Extension.create` 확장이 `props.nodeViews.image`에 팩토리를 등록한다(`TiptapEditor.tsx:272-279`의 `codeBlockCollapse` → `props.nodeViews.codeBlock`과 대칭). 마운트 스타일 일관성을 위해 이 방식으로 확정.

- **신규 셸** `src/sidepanel/lib/inlineImageShell.ts` (코드블럭의 `codeCollapseShell.ts` 대응): `<div class="inline-image">`(position:relative 래퍼) 안에 `<img contenteditable="false">` + `createBlockActions([...])`의 `el`을 구성하는 vanilla DOM 팩토리. `createInlineImageShell(labels, specs)` → `{ el, actions, img, destroy }`.
- **신규 extension** `src/sidepanel/extensions/imageAnnotation.ts` — `Extension.create({ name: "imageAnnotation", addProseMirrorPlugins })`. `addOptions`로 콜백 주입 슬롯:
  ```ts
  interface ImageAnnotationOptions {
    resolveRefId: (src: string) => string | undefined;   // blobUrl → refId (urlToRefMap 조회)
    onAnnotate: (ctx: { refId: string; getPos: () => number }) => void;
    onReset:    (ctx: { refId: string; getPos: () => number }) => void;
    labels: () => { annotate: string; reset: string; delete: string };
  }
  ```
  플러그인의 `props.nodeViews.image = (node, view, getPos) => new ImageAnnotationNodeView(...)`. stock Image 스키마·직렬화·`setImage` 커맨드는 그대로 상속 → markdown 왕복 무손상.
- **`ImageAnnotationNodeView`** (TiptapEditor.tsx 내부, `CodeCollapseNodeView`와 동형 배치):
  - `dom`: 위 `createInlineImageShell` 산출물. 버튼 3개(순서 `[초기화][어노테이션][삭제]`):
    - `reset` (icon: `rotate-ccw` — blockActions ICON_PATHS에 추가) → **`options.onReset({ refId, getPos })`로 상위에 위임**(URL 재매핑을 TiptapEditor가 단일 관리 — 5번 참조). NodeView가 직접 blob URL을 만들지 않는다.
    - `annotate` (icon: `pencil` — 추가) → `options.onAnnotate({ refId, getPos })`.
    - `delete` (icon: `trash`) → `editor.chain().deleteRange({ from: getPos(), to: getPos() + node.nodeSize }).run()`.
  - **초기화 버튼 노출 조건**: `hasInlineOrigin(refId)`를 **마운트 시점에 조회**(hover 이전)해 `setHidden` 토글. 버튼 자리(width)를 예약해 두어, 조회 결과가 늦게 와도 first/last/only-child 코너 라운딩(`block-actions.css:35-46`)이 **hover 중에 재계산되며 시각 점프**가 나지 않게 한다. 어노테이션/초기화 직후에는 상위 콜백이 즉시 `setHidden(false/true)`을 호출.
  - locale: `useSettingsUiStore.subscribe`로 label getter 재적용(`options.labels()` 재호출 → `actions.setLabel`).
  - `ignoreMutation`/`stopEvent`: 버튼(`contenteditable=false`) 클릭이 PM 편집으로 새지 않게 코드블럭 셸과 동일 처리. img는 leaf 노드라 `contentDOM` 없음.
- **작은 이미지 오버플로우 처리**: 인라인 이미지는 intrinsic 크기로 렌더(`tiptap-editor.css` img는 `max-width:100%`만, `min-width` 없음)라 60px 파비콘·아이콘 캡처는 60px인데 버튼 그룹은 ~96px(2rem×3). `top/right:0.5rem` 앵커라 그룹이 이미지를 넘친다. → **`tiptap-editor.css`의 img에 `min-width`(버튼 그룹 폭 이상, 예 `min-width: 7rem`)를 강제**해 소형 이미지에서도 그룹이 안에 들어가게 한다.
- **src 갱신 헬퍼** `updateImageSrc(getPos, url)`: `editor.chain().command(({tr}) => { tr.setNodeAttribute(getPos(), "src", url); return true; }).run()`. refId 불변이라 결과 markdown은 동일 `inline:refId`(역치환) — 문서 정합만 갱신.

### 4. `src/sidepanel/lib/blockActions.ts` — 아이콘 추가
- **변경**: `ICON_PATHS`에 lucide `rotate-ccw`, `pencil` path 인라인 추가(기존 copy/check/trash/chevron 옆). 주석 규칙(출처 표기, 값 안정성) 준수. `BlockActionIcon` 유니온이 자동 확장된다.
- **주의**: `createBlockActions` 자체는 이미 제네릭("블럭(코드블럭·이미지 등)")이라 로직 변경 없음. `setHidden(testId, hidden)` 메서드가 없으므로 reset 버튼 조건부 노출을 위해 **`setHidden` 추가**(또는 reset 버튼을 조건부로 `el.append`/`remove`). 최소 변경으로 `setHidden(testId, hidden)` 추가 권장.

### 5. `src/sidepanel/components/TiptapEditor.tsx` — extension 등록 + 오버레이 렌더
- **현재 역할**: stock `Image` extension 사용, inline blob resolve/역치환/orphan 정리 담당.
- **변경**:
  - stock `Image`는 유지하고, **신규 `imageAnnotation` extension을 추가**(코드블럭 `codeBlockCollapse`와 동일하게 확장 배열에 append). `.configure({ resolveRefId, onAnnotate, onReset, labels })`로 클로저 주입.
    - `resolveRefId`: `(src) => urlToRefMap.current.get(src)` (기존 맵 재사용).
    - `onAnnotate`: `({refId, getPos}) => setAnnotatingInline({ refId, getPos })` (신규 React state).
    - `onReset`: `({refId, getPos}) => void handleInlineReset({ refId, getPos })` — **reset도 상위 콜백으로 올려 URL 재매핑을 TiptapEditor가 단일 관리**한다(맵 일관성). NodeView가 직접 `createObjectURL`을 만들면 `urlToRefMap`/`blobUrls` 갱신을 빠뜨려 raw `blob:` URL이 `editorMarkdown`(TiptapEditor.tsx:337-350)에 직렬화 → 다음 hydrate에 이미지 소실 + revoke 누락(leak). 상위 단일 경로로 원천 차단.
    - `labels`: i18n `t()` getter.
  - useEditor는 1회 생성이라 최신 클로저 캡처 문제 → 기존 `handleImageFileRef` 패턴대로 **ref 우회**(`onAnnotate`/`onReset`이 `annotateRef.current`/`resetRef.current`를 호출).
  - **신규 state** `annotatingInline: { refId: string; getPos: () => number } | null`.
  - **AnnotationOverlay lazy 렌더**(컴포넌트 반환부, 기존 dragOver div 옆). **`createPortal(…, document.body)`로 감싸** DraftEditDialog(Radix Dialog)의 focus-trap·스태킹 컨텍스트를 탈출한다(위험 요소 참조):
    ```tsx
    {annotatingInline && createPortal(
      <Suspense fallback={null}>
        <AnnotationOverlay
          imageUrl={/* refId → 현재 표시 blob dataUrl */}
          onComplete={(url) => void handleInlineAnnotated(annotatingInline, url)}
          onCancel={() => setAnnotatingInline(null)}
        />
      </Suspense>, document.body)}
    ```
    `AnnotationOverlay`는 `imageUrl: string`(dataUrl)만 받으므로, 오버레이 열기 직전 `getInlineImage(refId)` → `blobToDataUrl`로 현재 표시 이미지를 dataUrl로 만들어 넘긴다.
  - **getPos stale 방어**: 오버레이가 열린 동안 value-sync effect(`TiptapEditor.tsx:497-534`)나 세션 hydrate가 `setContent`를 때리면 NodeView가 재생성돼 저장된 `getPos` 클로저가 무효화된다. `handleInlineAnnotated`/`handleInlineReset`는 **`getPos()`를 맹신하지 말고, 완료 시점에 `refId`(안정 식별자)로 doc를 스캔해 해당 이미지 노드의 최신 pos를 재탐색**한 뒤 `setNodeAttribute`한다(노드가 사라졌으면 no-op). getPos는 힌트로만.
  - `handleInlineAnnotated({refId}, annotatedUrl)`:
    1. `annotateInlineImage(refId, annotatedUrl)` → 새 표시 blob.
    2. 기존 blob URL revoke, `URL.createObjectURL(newBlob)` → `urlToRefMap`/`refToUrlMap`/`blobUrls` 갱신(같은 refId 재매핑).
    3. refId로 pos 재탐색 → `updateImageSrc(pos, newUrl)`로 노드 src 교체.
    4. `setAnnotatingInline(null)`.
  - `handleInlineReset({refId})`: `resetInlineImage(refId)` → null이면 no-op / blob이면 위 2·3과 동일 재매핑·재탐색·src 교체 + NodeView reset 버튼 숨김(`hasInlineOrigin` 다시 false).
  - `AnnotationOverlay` import는 `DraftingPanel`처럼 `lazy(() => import("./AnnotationOverlay"))`. **주의**: `DraftingPanel`도 별도로 `AnnotationOverlay`를 lazy import 중 — 같은 청크를 공유하므로 중복 로드는 아니다(Vite dedupe).
- **DraftEditDialog 자동 커버**: `DraftEditDialog`도 `TiptapEditor`를 쓰므로 오버레이가 그 안에서도 뜬다. `createPortal(document.body)`로 Dialog 밖에 렌더하므로 z-index·focus-trap 충돌을 회피(위험 요소 참조 — 그래도 수동 확인).

### 6. `src/store/blob-db.ts` orphan prune 호출처 — 확인만
- `pruneOrphanInlineImages`가 origins도 정리하도록 2번에서 확장했으므로, 호출처(세션 sync·마운트 정리)는 무변경. 삭제 버튼으로 markdown에서 refId가 사라지면 다음 prune 사이클에 inlineImages+origins가 함께 정리된다.

### 7. i18n — `src/i18n/` (ko/en 동시)
- 신규 키(본문 이미지 버튼 label) **확정**: `editor.image.annotate`, `editor.image.reset`, `editor.image.delete`. 아이콘 버튼 aria-label/툴팁용. (기존 `draft.*`/`common.*` 재사용은 의미 혼선 — 본문 이미지 전용 신규 키로 확정.)
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

- **AnnotationOverlay vs DraftEditDialog — z-index만이 아니다**: 오버레이는 `fixed inset-0 z-50`. `DraftEditDialog`는 Radix Dialog(overlay+content 둘 다 `z-50`, body portal)라 **focus-trap + Escape/outside-click 자동 dismiss**가 걸린다. 오버레이도 자체 Escape(텍스트 편집 취소)·window 포인터 드래그를 쓰므로, 다이얼로그 안에서 오버레이를 열면 ① 캔버스 포커스가 Dialog에 트랩되거나 ② Escape가 다이얼로그를 닫아버리는 충돌이 난다. → **해소책 확정**: 오버레이를 `createPortal(document.body)`로 Dialog 밖에 렌더(5번). 그래도 Escape 우선순위·스태킹은 **수동 확인 필수**(DraftEditDialog에서 어노테이션 열고 그리기·Escape 동작).
- **useEditor 클로저 stale**: `onAnnotate`/`onReset`/`labels` 콜백이 마운트 시점 클로저를 캡처. 기존 `handleImageFileRef` 패턴(ref 우회)을 반드시 따라야 최신 state/t()를 참조.
- **blob URL 수명**: 어노테이션·초기화로 blob URL을 교체할 때 이전 URL revoke 타이밍. 너무 일찍 revoke하면 setNodeAttribute 반영 전 이미지가 깨진다. 새 URL로 attr 갱신 → 다음 tick에 이전 URL revoke, 또는 언마운트 일괄 revoke(`blobUrls.current`)에 위임. jsdom으로 못 잡으므로 실제 탭 확인.
- **초기화 버튼 노출 = 시각 점프 회피**: `hasInlineOrigin` 조회를 **마운트 시점(hover 이전)에 끝내고 버튼 자리(width)를 예약**한다. hover 중 async 결과가 오면 first/last/only-child 코너 라운딩이 재계산돼 시각 점프가 나므로, 자리 예약으로 라운딩을 고정.
- **getPos stale**: 오버레이 열린 동안 `setContent`(value-sync/세션 hydrate)가 NodeView를 재생성하면 저장된 `getPos` 클로저가 무효화된다. 완료 콜백은 **`refId`로 doc를 재스캔해 최신 pos를 찾는다**(5번 getPos stale 방어). 삭제된 노드면 no-op.
- **드래그·캔버스는 jsdom 사각지대**: 어노테이션 오버레이 상호작용은 e2e·수동만 안전망(POSTMORTEM 기록). 이 기능의 자동 테스트는 blob 스왑·직렬화 불변·버튼 노출 조건에 집중하고, 실제 그리기는 수동.
