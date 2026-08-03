# diff table before/after 이미지 어노테이션 — 기술 설계

## 개요

`screenshotRaw`/`screenshotAnnotated` 쌍을 before/after에 그대로 복제한다. 저장 위치가 두 곳(현재 선택 = store top-level / 버퍼 = `bufferedElements[i]`)이라 필드도 두 벌 생기고, 표시·제출은 전부 `annotated ?? raw` 한 규칙으로 수렴한다. 주석 오버레이(`AnnotationOverlay`)는 무변경 재사용이고, hover 액션 버튼만 React로 새로 만든다 — 기존 `createBlockActions`는 ProseMirror NodeView 전용 vanilla DOM이라 React 트리에 심을 수 없다.

## 변경 범위

### 신규

| 파일 | 역할 |
|---|---|
| `src/sidepanel/components/ImageActions.tsx` | 이미지 우상단 hover 액션 그룹(React). shadcn `ButtonGroup` + `Button size="icon"` 2개, `group-hover:opacity-100`로 노출. `block-actions.css`와 시각 동일(h-8 w-8 · size-4 아이콘 · outline). 인라인 이미지의 `[삭제]`는 없다 |
| `src/sidepanel/lib/__tests__/annotatedImage.test.ts` | 아래 순수 헬퍼 테스트 |
| `src/sidepanel/lib/annotatedImage.ts` | `resolveAnnotated(raw, annotated)` = `annotated ?? raw`. 표시·제출·오버레이 입력이 같은 규칙을 쓰게 하는 단일 출처(3곳에 `??`를 흩뿌리면 한 곳만 빠져도 조용히 원본이 제출된다) |

### 변경

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/store/editor-store.ts` | element 캡처 상태 소유 | `beforeAnnotated`/`afterAnnotated` 필드 2개 + `BufferedElement`에 같은 필드 2개. 액션 `setBeforeAnnotated`/`setAfterAnnotated` 추가. `EditorSnapshot` 키 목록에 top-level 2개 추가. **after 폐기 지점 3곳**(`setAfterImage`·`backToStyling`·`patchBufferedElement`의 afterImage 패치)에서 대응 annotated를 null로. `confirmDraft`의 IDB 저장은 resolve된 이미지를 쓴다 |
| `src/sidepanel/lib/buildIssueMarkdown.ts` | `mergeStyleElements`가 현재+버퍼를 병합해 `StyleElementContext[]` 생성 | `current`에 `beforeAnnotated`/`afterAnnotated`를 받고, `StyleElementContext`에 두 필드를 추가해 **그대로 실어 보낸다**(여기서 resolve하지 않는다 — 표시 쪽이 "주석이 있나"를 알아야 초기화 버튼을 낸다) |
| `src/sidepanel/lib/buildEditorCapture.ts` | 제출용 컨텍스트·캡처 파일 입력 생성 | `beforeImages`/`afterImages` 매핑에서 `resolveAnnotated`로 접는다 |
| `src/sidepanel/components/StyleChangesTable.tsx` | diff table 렌더(3화면 공용) | `SnapshotCell`에 `annotated`·`onAnnotate`·`onReset` optional prop. 셋 다 없으면 지금과 완전히 동일하게 렌더(preview·상세 무변경) |
| `src/sidepanel/tabs/DraftingPanel.tsx` | drafting 화면 | diff table에 핸들러 주입 + 주석 오버레이 마운트(`annotatingDiff` state). 쓰기 라우팅(현재 vs 버퍼)을 여기서 판정 |
| `src/i18n/{ko,en}.ts` | | 신규 키 없음 — `editor.image.annotate`/`editor.image.reset` 재사용 |

### 무변경(확인만)

- `AnnotationOverlay` — props 그대로(`imageUrl`/`onComplete`/`onCancel`).
- `buildCaptureFiles` — `beforeImages[i]`가 이미 주석본으로 들어오므로 파일명·인덱스 규칙 불변.
- 본문 마크다운(`before-{i}.webp` 참조) — 파일 바이트만 바뀐다.
- `background/injectSnapshotRows.ts` — 테이블 구조 불변.
- `useDraftStyleElements`·`DraftDetailDialog` — 저장된 초안은 IDB에 이미 resolve된 이미지 한 장뿐.

## 데이터 흐름

```
[표시]
editor-store
  ├ 현재 선택: beforeImage / beforeAnnotated, afterImage / afterAnnotated
  └ bufferedElements[i]: 같은 4개
        │
        ▼ mergeStyleElements(buffered, current)   ← 4필드 그대로 통과
  StyleElementContext[] { beforeImage, beforeAnnotated, afterImage, afterAnnotated, ... }
        │
        ▼ DraftingPanel
  StyleChangesTable
    └ SnapshotCell: src = resolveAnnotated(raw, annotated)
                    버튼 = annotated ? [초기화][연필] : [연필]

[주석 쓰기]
SnapshotCell.onAnnotate(slot)
  → DraftingPanel: setAnnotatingDiff({ el, slot, url: resolveAnnotated(...) })
  → AnnotationOverlay(imageUrl=url) → onComplete(dataUrl)
  → sameElementKey(el, selection)
       ? store.setBeforeAnnotated(dataUrl) / setAfterAnnotated(dataUrl)
       : store.patchBufferedElement(el.selector, el.frameId, { beforeAnnotated: dataUrl })

[제출]
buildEditorCapture
  → beforeImages: styleElements.map(e => resolveAnnotated(e.beforeImage, e.beforeAnnotated))
  → buildCaptureFiles → before-{i}.webp (주석본)

[저장]
confirmDraft → saveImageBlob(id, `b${i}-before`, resolveAnnotated(...)) — 슬롯 추가 없음
```

**쓰기 라우팅이 이 설계의 핵심 위험**이다. `mergeStyleElements`의 출력은 파생 배열이라 쓰기 대상이 아니고, 같은 요소가 `selection`과 `bufferedElements`에 **동시에 존재하는 창**이 있다(버퍼 승격 전 비동기 구간). `mergeStyleElements`는 이때 현재 쪽을 남기고 버퍼 쪽을 밀어내므로(`merged.filter(r => !sameElementKey(r, curResolved))`), **`sameElementKey(el, selection)`가 참이면 그 카드는 반드시 현재 요소**다. 이 불변식 위에 라우팅을 세운다.

## 인터페이스 설계

```ts
// src/sidepanel/lib/annotatedImage.ts
export function resolveAnnotated(
  raw: string | null,
  annotated: string | null | undefined,
): string | null;

// src/store/editor-store.ts (추가분)
interface EditorState {
  beforeAnnotated: string | null;
  afterAnnotated: string | null;
}
interface BufferedElement {
  beforeAnnotated?: string | null; // 구버전 스냅샷엔 없다 — 소비 시 ?? null
  afterAnnotated?: string | null;
}
interface EditorActions {
  setBeforeAnnotated: (dataUrl: string | null) => void;
  setAfterAnnotated: (dataUrl: string | null) => void;
}

// src/sidepanel/lib/buildIssueMarkdown.ts (추가분)
export interface StyleElementContext {
  beforeAnnotated?: string | null;
  afterAnnotated?: string | null;
}

// src/sidepanel/components/ImageActions.tsx
export function ImageActions({
  onAnnotate,
  onReset,      // undefined면 [초기화] 미렌더
  className,
}: {
  onAnnotate: () => void;
  onReset?: () => void;
  className?: string;
}): JSX.Element;

// src/sidepanel/components/StyleChangesTable.tsx (SnapshotCell prop 추가)
type SnapshotSlot = "before" | "after";
interface StyleChangesTableProps {
  beforeImage: string | null;
  afterImage: string | null;
  diffs: StyleDiffRow[];
  // 아래 3개가 전부 있을 때만 액션 버튼을 렌더한다(읽기 전용 화면 보호).
  beforeAnnotated?: string | null;
  afterAnnotated?: string | null;
  onAnnotate?: (slot: SnapshotSlot) => void;
  onReset?: (slot: SnapshotSlot) => void;
}
```

## 기존 패턴 준수

- **세션 영속화**: 새 top-level 필드는 `EditorSnapshot` Pick 목록과 `snapshotFromState()` 양쪽에 넣어야 한다(한쪽만 넣으면 타입은 통과하고 값이 조용히 안 저장된다). `toLiteSnapshot`은 `bufferedElements`를 map으로 비우므로 거기에도 두 필드를 추가한다 — 안 하면 쿼터 초과 2차 시도에서 주석본만 남아 lite의 목적이 깨진다.
- **구버전 스냅샷 폴백**: `BufferedElement`의 신규 필드는 optional + 소비 시 `?? null`(기존 `propSources`·`captureContext`와 동일 관례). 스토어 마이그레이션 함수는 필요 없다.
- **store는 `sidepanel/tabs`를 import하지 않는다**: `resolveAnnotated`는 `sidepanel/lib/`에 두고 store가 그걸 import한다(`initialJiraFields` 선례).
- **i18n 동시 갱신**: 신규 키가 없어 해당 없음. 기존 `editor.image.*`를 쓴다.
- **UI 컨벤션**: IconButton은 패널 내부라 `h-8 w-8`(DESIGN.md). 직접 스타일링 대신 shadcn `Button`+`ButtonGroup`.
- **테스트 2트랙**: `resolveAnnotated`·store 액션은 `*.test.ts`, `StyleChangesTable`의 버튼 조건부 렌더는 `*.test.tsx`(jsdom).

## 대안 검토

**A. 원본을 IndexedDB에 백업하고 표시본만 세션에 둔다(tiptap 인라인 이미지 방식).**
세션 스토리지 부담이 0이라는 게 유일한 장점이다. 채택하지 않은 이유: 인라인 이미지는 애초에 blob이 IDB에 사는 구조라 백업 슬롯을 하나 더 두는 게 자연스럽지만, before/after는 **store의 data URL 문자열**이라 IDB 왕복·prune 경로·비동기 조회(`hasInlineOrigin` 같은 레이스 방어)가 통째로 새로 생긴다. 요구 하나에 비해 기계가 너무 는다. 다만 세션 쿼터 부담은 실재하므로 위험 요소에 남긴다.

**B. `annotated`가 `raw`를 덮어쓴다(원본 미보관).**
용량·구조 변화 0이지만 `[초기화]`를 만들 수 없어 요구사항과 충돌한다.

**C. `StyleElementContext`에 `source: "current" | "buffered"`를 추가해 라우팅한다.**
`ChangeGroup`(`styleChangeGroups.ts`)이 이미 쓰는 방식이라 대칭적이다. 채택하지 않은 이유: 그 타입은 background `injectSnapshotRows`까지 흐르는 제출 컨텍스트라, 표시 전용 메타를 얹으면 경계가 흐려진다. `sameElementKey(el, selection)`로 같은 판정을 화면 쪽에서 할 수 있고 그게 더 좁다.

**D. `mergeStyleElements`가 `annotated ?? raw`를 미리 접어서 내보낸다.**
제출 경로가 자동으로 주석본을 쓰게 돼 `buildEditorCapture` 수정이 없어진다. 채택하지 않은 이유: 그러면 표시 쪽이 "주석이 있는가"를 알 수 없어 `[초기화]` 버튼 조건을 못 만든다. 접는 지점은 **소비처**여야 한다.

## 위험 요소

1. **세션 쿼터.** 요소 N개 × 최대 4장(before/after × raw/annotated)이 data URL로 `chrome.storage.session`(10MB)에 얹힌다. 주석본은 Konva 캔버스 export라 원본보다 클 수 있다. 초과 시 기존 lite 강등이 이미지를 전부 버리므로 **데이터 손실은 아니고 복원 실패**지만, 강등 빈도가 올라간다. 실측 없이 압축·다운스케일을 미리 넣지 않는다(요청 밖) — 태스크에 실측 항목을 둔다.
2. **after 폐기 누락.** 폐기 지점이 3곳(`setAfterImage`·`backToStyling`·`patchBufferedElement`)인데 하나만 빠뜨려도 "옛 주석이 새 픽셀 위에 남는" 최악의 증상이 나온다. 세 곳 모두 **store 액션 안에서** 함께 null 처리해 호출부가 잊을 수 없게 한다(`blocker-state`의 "적용까지 상태가 맡는다"와 같은 규율).
3. **라우팅 오배치.** 버퍼 승격 전 비동기 창에서 판정이 어긋나면 A 요소 주석이 B 카드에 붙는다. `sameElementKey` 단일 출처(`@/lib/element-key`)를 쓰고, 버퍼 2개 + 현재 1개 상황을 e2e로 고정한다.
4. **읽기 전용 화면 누출.** `StyleChangesTable`은 `PreviewPanel`·`DraftDetailDialog`에서도 쓴다. prop을 optional로 두고 **핸들러가 없으면 버튼 자체를 렌더하지 않는다**. 기본값으로 `() => {}`를 넣으면 조용히 새므로 금지.
5. **테이블 셀의 좁은 이미지.** `max-h-40 w-auto`라 이미지가 작으면 h-8 버튼 2개(64px)가 이미지 폭을 넘길 수 있다. 버튼은 이미지 래퍼 기준 `absolute right-2 top-2`라 넘쳐도 잘리지 않지만, 아주 작은 캡처에서는 이미지를 거의 덮는다. hover에서만 뜨므로 수용하고, 수동 확인 항목에 둔다.
6. **`[초기화]` 렌더 조건과 ButtonGroup 모서리.** 인라인 이미지는 `hidden` 속성으로 숨겨서 `:first-child`가 계속 점유되는 버그가 있었고 CSS(`[hidden] + .block-actions-button`)로 우회했다. React에서는 **조건부 렌더**라 그 함정이 없다 — `hidden` prop을 쓰지 말 것.
7. **오버레이 z-index.** `AnnotationOverlay`는 `DraftingPanel`에서 portal 없이 `absolute inset-0 z-50`로 뜬다(스크린샷 주석과 같은 자리). diff table은 패널 본문이라 문제없지만, 나중에 다이얼로그 안에서 열게 되면 portal이 필요하다 — 이번 스코프에서는 drafting 전용이라 현행 방식을 그대로 쓴다.
