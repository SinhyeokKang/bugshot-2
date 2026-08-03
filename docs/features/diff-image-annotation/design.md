# diff table before/after 이미지 어노테이션 — 기술 설계

## 개요

`screenshotRaw`/`screenshotAnnotated` 쌍을 before/after에 그대로 복제한다. 저장 위치가 두 곳(현재 선택 = store top-level / 버퍼 = `bufferedElements[i]`)이라 필드도 두 벌 생기고, 표시·미리보기·AI·제출은 전부 `annotated ?? raw` 한 규칙으로 수렴한다. hover 액션 버튼만 React로 새로 만든다 — 기존 `createBlockActions`는 ProseMirror NodeView 전용 vanilla DOM이라 React 트리에 심을 수 없다. `AnnotationOverlay`는 **접근성 보강 때문에 변경 대상**이며(아래 Task 분리) 그 변경은 인라인 이미지 주석과 공유된다.

## 변경 범위

### 신규

| 파일 | 역할 |
|---|---|
| `src/sidepanel/components/ImageActions.tsx` | 이미지 우상단 hover 액션 그룹(React). shadcn `ButtonGroup` + `TooltipIconButton` 2개. **표면은 annotation 툴바 선례**(`bg-background/90 shadow-md backdrop-blur-sm` — `AnnotationToolbar`·`ZoomControl`)를 따르고 hover 피드백은 배경이 아니라 글자색(`hover:text-primary`)으로 낸다. `block-actions.css`의 hover 처리를 그대로 가져오면 안 된다 — 그건 코드블럭/muted 표면 관용구이고, 이 버튼이 얹힐 `SnapshotCell`의 Card는 `bg-muted/30`이라 `hover:bg-accent`가 피드백 0이 된다(DESIGN.md). 인라인 이미지의 `[삭제]`는 없다 |
| `src/sidepanel/lib/__tests__/annotatedImage.test.ts` | 아래 순수 헬퍼 테스트 |

`resolveAnnotated(raw, annotated)` = `annotated ?? raw`는 **신규 모듈로 만들지 않는다.** 같은 규칙이 이미 6곳에서 인라인 `??`로 살아 있고(`PreviewPanel`·`DraftingPanel`·`AiDraftDialog`·`buildEditorCapture`·`editor-store`), 헬퍼 호출을 잊는 것과 `??`를 잊는 것은 같은 실패라 헬퍼가 게이트를 만들지 못한다. 기존 `sidepanel/lib`의 적당한 모듈에 export를 얹거나 인라인 관례를 그대로 따른다.

### 변경

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/store/editor-store.ts` | element 캡처 상태 소유 | `beforeAnnotated`/`afterAnnotated` 필드 2개 + `BufferedElement`에 같은 필드 2개. 액션 `setBeforeAnnotated`/`setAfterAnnotated` 추가. `patchBufferedElement`의 patch 타입 `Partial<Pick<BufferedElement, …>>`에 두 필드 추가(**현재는 `"styleEdits" \| "afterImage"`뿐이라 annotated 쓰기가 컴파일되지 않는다**). `EditorSnapshot` 키 목록에 top-level 2개 추가. **after 폐기는 값 비교 하나**(아래 참조). `confirmDraft`의 IDB 저장은 resolve된 이미지를 쓴다 |
| `src/sidepanel/lib/buildIssueMarkdown.ts` | `mergeStyleElements`가 현재+버퍼를 병합해 `StyleElementContext[]` 생성 | `current`에 `beforeAnnotated`/`afterAnnotated`를 받고, `StyleElementContext`에 두 필드를 추가해 **그대로 실어 보낸다**(여기서 resolve하지 않는다 — 표시 쪽이 "주석이 있나"를 알아야 제거 버튼을 낸다) |
| `src/sidepanel/lib/buildEditorCapture.ts` | 제출용 컨텍스트·캡처 파일 입력 생성 | `buildEditorMarkdownContext`가 top-level annotated를 `mergeStyleElements`에 넘기고, **`buildEditorLogsCaptureInput`의** `beforeImages`/`afterImages` 매핑에서 `annotated ?? raw`로 접는다 |
| `src/sidepanel/components/StyleChangesTable.tsx` | diff table 렌더(3화면 공용) | `SnapshotCell`에 `slot`·`annotated`·`onAnnotate`·`onReset` optional prop. 핸들러가 없으면 지금과 동일하게 렌더하되 **`annotated`만 주면 표시는 주석본**(preview용). `slot`으로 `alt`를 before/after로 가른다 |
| `src/sidepanel/tabs/DraftingPanel.tsx` | drafting 화면 | diff table에 핸들러 주입 + 주석 오버레이 마운트(`annotatingDiff` state). 쓰기 라우팅(현재 vs 버퍼)을 여기서 판정 |
| `src/sidepanel/tabs/PreviewPanel.tsx` | 미리보기 | `beforeAnnotated`/`afterAnnotated`만 전달(핸들러 미전달 → 버튼 미렌더). 안 하면 **미리보기는 원본, 제출물은 주석본**이 된다 |
| `src/sidepanel/tabs/AiDraftDialog.tsx` | AI 초안 | `getModeImages`의 element 분기를 `annotated ?? raw`로. screenshot 분기는 이미 같은 규칙이다 |
| `src/sidepanel/components/AnnotationOverlay.tsx` | 주석 오버레이(공용) | dialog role/label, Escape 취소, 실행 버튼 포커스 복귀, 완료 처리 중 done 비활성. **인라인 이미지 주석과 공유되므로 별도 Task + 회귀 검증**(아래 위험 8) |
| 3화면 diff section의 React key | | `key={el.selector}` → `elementKey(el)`. `DraftingPanel`·`PreviewPanel`·`DraftDetailDialog` **3곳 모두** — 한 곳만 고치면 나머지에 동일 selector·다른 frameId 중복 key가 남는다 |
| `src/i18n/{ko,en}.ts` | | 툴팁은 **`draft.addAnnotation`/`editAnnotation`/`removeAnnotation` 재사용**(같은 화면의 스크린샷 주석 버튼과 같은 계열, add/edit 분기 있음). `editor.image.*`는 쓰지 않는다. **`alt` 키는 신규 2~3개** — 현재 before/after 두 칸이 `alt.capturedImage` 하나를 공유해 스크린 리더가 구분하지 못한다 |

### 무변경(확인만)

- `buildCaptureFiles` — `beforeImages[i]`가 이미 주석본으로 들어오므로 파일명·인덱스 규칙 불변.
- 본문 마크다운(`before-{i}.webp` 참조) — 파일 바이트만 바뀐다.
- `background/injectSnapshotRows.ts` — 테이블 구조 불변.
- `useDraftStyleElements`·`DraftDetailDialog` 재제출 매핑 — 저장된 초안은 IDB에 이미 resolve된 이미지 한 장뿐이라 표시·재제출 모두 무변경(단 React key는 위 표대로 고친다).

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
  StyleChangesTable (DraftingPanel · PreviewPanel 공용)
    └ SnapshotCell: src = annotated ?? raw
                    버튼 = 핸들러 없으면 없음(preview·상세)
                           annotated ? [주석 제거][주석 수정] : [주석 추가]

[주석 쓰기]  ※ DraftingPanel에서만
SnapshotCell.onAnnotate(slot)
  → DraftingPanel: setAnnotatingDiff({ el, slot, url: annotated ?? raw })
  → AnnotationOverlay(imageUrl=url) → onComplete(dataUrl)
  → sameElementKey(el, selection)
       ? store.setBeforeAnnotated(dataUrl) / setAfterAnnotated(dataUrl)
       : store.patchBufferedElement(el.selector, el.frameId, { beforeAnnotated: dataUrl })

[after 폐기]  ※ 지점 열거가 아니라 값 비교
afterImage를 쓰는 모든 커밋(setAfterImage · patchBufferedElement · bufferCurrentElement)에서
  next !== prev  → afterAnnotated = null
  next === prev  → 보존   ← rebindStylingSession의 복원 왕복이 여기 걸린다

[AI]
AiDraftDialog.getModeImages(element) → [before, after] 각각 annotated ?? raw

[제출]
buildEditorCapture
  → buildEditorMarkdownContext가 현재 요소 annotated까지 mergeStyleElements에 전달
  → buildEditorLogsCaptureInput의 beforeImages/afterImages 매핑에서 annotated ?? raw
  → buildCaptureFiles → before-{i}.webp (주석본)

[저장]
confirmDraft → resolve 결과를 blob 저장 조건·snapshot.before/after·버퍼 hasBefore/hasAfter·
               saveImageBlob 4슬롯에 동일하게 사용 — 슬롯 추가 없음
```

**쓰기 라우팅이 이 설계의 핵심 위험**이다. `mergeStyleElements`의 출력은 파생 배열이라 쓰기 대상이 아니고, 같은 요소가 `selection`과 `bufferedElements`에 **동시에 존재하는 창**이 있다(버퍼 승격 전 비동기 구간). `mergeStyleElements`는 이때 현재 쪽을 남기고 버퍼 쪽을 밀어내므로(`merged.filter(r => !sameElementKey(r, curResolved))`), **`sameElementKey(el, selection)`가 참이면 그 카드는 반드시 현재 요소**다. 이 불변식 위에 라우팅을 세운다.

## 인터페이스 설계

```ts
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

  // patch 타입 확장 — 현재는 "styleEdits" | "afterImage"뿐이다.
  patchBufferedElement: (
    selector: string,
    frameId: number,
    patch: Partial<
      Pick<
        BufferedElement,
        "styleEdits" | "afterImage" | "beforeAnnotated" | "afterAnnotated"
      >
    >,
  ) => void;
}

// src/sidepanel/lib/buildIssueMarkdown.ts (추가분)
export interface StyleElementContext {
  beforeAnnotated?: string | null;
  afterAnnotated?: string | null;
}

// src/sidepanel/components/ImageActions.tsx
export function ImageActions({
  onAnnotate,
  onReset,      // undefined면 [주석 제거] 미렌더
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
  // annotated만 주면 표시만 주석본(PreviewPanel).
  beforeAnnotated?: string | null;
  afterAnnotated?: string | null;
  // 핸들러가 있을 때만 액션 버튼을 렌더한다(읽기 전용 화면 보호).
  onAnnotate?: (slot: SnapshotSlot) => void;
  onReset?: (slot: SnapshotSlot) => void;
}
```

`TooltipIconButton`은 `label`·`active`·`disabled`·`ariaDisabled`·`testId`·`className`·`onClick`·`children`만 받는다 — **`variant`/`size`는 없고**(넘기면 TS 에러) `h-8 w-8`은 이미 내부 하드코딩이다. `title` 속성도 붙이지 않고 Radix `TooltipContent` + `aria-label`만 쓰므로 검증 기준은 `aria-label` 단독이다.

## 기존 패턴 준수

- **세션 영속화**: 새 top-level 필드는 `EditorSnapshot` Pick 목록과 `snapshotFromState()` 양쪽에 넣어야 한다(한쪽만 넣으면 타입은 통과하고 값이 조용히 안 저장된다). `toLiteSnapshot`은 `bufferedElements`를 map으로 비우므로 거기에도 두 필드를 추가한다 — 안 하면 쿼터 초과 2차 시도에서 주석본만 남아 lite의 목적이 깨진다. 단 **`snapshotFromState`는 순수 모듈로 옮기지 않는다** — 36개 필드를 손으로 나열하고 `useEditorStore.getState()`를 직접 읽는 함수라, 옮기다 하나 빠지면 타입 에러도 런타임 에러도 없이 조용히 초기값이 된다(ARCHITECTURE.md의 명시된 함정). 영향 범위가 이 기능이 아니라 편집 세션 전체다. `toLiteSnapshot`만 분리해 테스트하고, `snapshotFromState`에는 "결과 키 집합 === `EditorSnapshot` Pick 키 집합" 가드 테스트를 붙인다.
- **구버전 스냅샷 폴백**: `BufferedElement`의 신규 필드는 optional + 소비 시 `?? null`(기존 `propSources`·`captureContext`와 동일 관례). 스토어 마이그레이션 함수는 필요 없다.
- **요소 전환**: `onElementSelected`가 버퍼 요소를 현재 요소로 승격할 때 annotated 두 필드를 함께 복원하고, 신규 요소 선택에서는 둘 다 null로 초기화한다.
- **i18n 동시 갱신**: 툴팁은 기존 `draft.*`를 쓰지만 `alt` 키 2~3개는 신규다 — ko/en 양쪽을 함께 갱신한다. `src/log-viewer/i18n.ts` 복제 사전은 `StyleChangesTable`을 렌더하지 않아 영향 없다.
- **UI 컨벤션**: IconButton은 패널 내부라 `h-8 w-8`(DESIGN.md, `TooltipIconButton` 내부 기본값). `ButtonGroup`으로 묶고, 표면·hover는 위 신규 표대로 annotation 툴바 선례를 따른다.
- **테스트 2트랙**: store 액션·세션 헬퍼·라우팅 헬퍼는 `*.test.ts`, `ImageActions`와 `StyleChangesTable`의 버튼 조건부 렌더는 `*.test.tsx`(jsdom).

## 대안 검토

**A. 원본을 IndexedDB에 백업하고 표시본만 세션에 둔다(tiptap 인라인 이미지 방식).**
세션 스토리지 부담이 0이라는 게 유일한 장점이다. 채택하지 않은 이유: 인라인 이미지는 애초에 blob이 IDB에 사는 구조라 백업 슬롯을 하나 더 두는 게 자연스럽지만, before/after는 **store의 data URL 문자열**이라 IDB 왕복·prune 경로·비동기 조회(`hasInlineOrigin` 같은 레이스 방어)가 통째로 새로 생긴다. 요구 하나에 비해 기계가 너무 는다. 다만 세션 쿼터 부담은 실재하므로 위험 요소에 남긴다.

**B. `annotated`가 `raw`를 덮어쓴다(원본 미보관).**
용량·구조 변화 0이지만 `[주석 제거]`를 만들 수 없어 요구사항과 충돌한다.

**C. `StyleElementContext`에 `source: "current" | "buffered"`를 추가해 라우팅한다.**
`ChangeGroup`(`styleChangeGroups.ts`)이 이미 쓰는 방식이라 대칭적이다. 채택하지 않은 이유: 그 타입은 background `injectSnapshotRows`까지 흐르는 제출 컨텍스트라, 표시 전용 메타를 얹으면 경계가 흐려진다. `sameElementKey(el, selection)`로 같은 판정을 화면 쪽에서 할 수 있고 그게 더 좁다.

**D. `mergeStyleElements`가 `annotated ?? raw`를 미리 접어서 내보낸다.**
제출 경로가 자동으로 주석본을 쓰게 돼 `buildEditorCapture` 수정이 없어진다. 채택하지 않은 이유: 그러면 표시 쪽이 "주석이 있는가"를 알 수 없어 `[주석 제거]` 버튼 조건을 못 만든다. 접는 지점은 **소비처**여야 한다.

**E. 이미지 액션 버튼을 이미지 위 hover 오버레이가 아니라 셀 하단에 상시 배치한다.**
아래 위험 5·9(덮음·저높이 관통·유령 탭 정지점)가 한 번에 사라진다. 채택하지 않은 이유: 인라인 이미지·스크린샷 주석과 진입 방식이 갈려 PRD 목표 4(두 번 배우지 않는다)를 정면으로 깬다. 대신 위험 5를 "수동 확인"에서 **설계 결정 항목**으로 승격하고 수용 범위를 명시한다. 승인선을 못 넘으면 이 대안으로 되돌린다.

## 위험 요소

1. **세션 쿼터 — 승인선은 조건부다.** 요소 N개 × 최대 4장(before/after × raw/annotated)이 data URL로 `chrome.storage.session`(10MB)에 얹힌다. 검증된 사실: element 크롭에는 **다운스케일도 픽셀 캡도 없다**(`capture.ts`가 `scale = naturalWidth / viewport.width`로 DPR·페이지 줌을 그대로 흡수, 1:1 `drawImage`, `toDataURL("image/webp", 0.92)`). `MAX_OUTPUT_PIXELS`(4M px)는 스크롤 스티치 전용이라 이 경로에 안 걸린다. 주석본은 `pixelRatio: 1` + natural 좌표 Stage라 **원본과 동일 해상도**다. base64 ×1.34를 포함한 추정: 작은 요소 ≈250KB/요소(40요소 수용), 조상 컨테이너 확장 상한(뷰포트 40%·DPR2) ≈2.2MB/요소(4요소), 풀뷰포트급 bbox ≈5.6MB/요소(**2요소째 초과**). 쿼터는 확장 전역이고 보존 phase 세션은 탭마다 남는다. → 승인선은 **확장 상한 크기 × DPR2 × 요소 2개**로 읽고, 실패 시 대안은 압축이 아니라 **`capture.ts` 크롭에 `stitchGeometry`와 동일한 sqrt 픽셀 캡 적용**이다. 사전 크기 측정 코드는 없어(사후 try/catch + lite 2차 시도뿐) 예측은 불가하다.
2. **after 폐기 — 지점을 세지 말고 값을 비교한다.** 세어 보면 `setAfterImage`·`patchBufferedElement`·`bufferCurrentElement` 셋이고, 마지막 하나는 호출부에 따라 정반대 규율을 요구한다: `useBufferThenSwitch`(repick·DOM 이동)는 **새로 찍은** after를 싣지만 `picker-control`의 `rebindStylingSession`은 **`state.afterImage`를 그대로** 넣는 복원 왕복이다. 따라서 폐기 조건은 `next !== prev` 하나로 통일한다 — 그러면 네 경로가 자동으로 갈린다. `backToStyling`에는 별도 규칙을 두지 않는다(PRD 시나리오 4 참조).
3. **라우팅 오배치.** 버퍼 승격 전 비동기 창에서 판정이 어긋나면 A 요소 주석이 B 카드에 붙는다. `sameElementKey` 단일 출처(`@/lib/element-key`)를 쓰고, 버퍼 2개 + 현재 1개 상황을 e2e로 고정한다.
4. **읽기 전용 화면 누출.** `StyleChangesTable`은 `PreviewPanel`·`DraftDetailDialog`에서도 쓴다. prop을 optional로 두고 **핸들러가 없으면 버튼 자체를 렌더하지 않는다**. 기본값으로 `() => {}`를 넣으면 조용히 새므로 금지. 단 `annotated` 값 자체는 preview에 전달한다(위험 10).
5. **테이블 셀에서 hover 오버레이가 이미지를 덮는다 — 수용 범위를 명시한다.** `table-fixed` + colgroup `22%/auto/auto`로 before/after 각 39%, `DocTable`의 `px-3`·Card border·`p-1`·Section `px-4`를 빼면 **400px 패널에서 이미지 실효 최대폭 ≈105px, 320px(`html,body{min-width:320px}` 하한)에서 ≈74px**. `ButtonGroup`은 gap 0이라 버튼 2개 64px + `right-2` 8px = **72px 점유** → 400px에서 폭의 69%, 320px에서 사실상 전면.
   더 나쁜 축은 **높이**다. 이미지 클래스가 `max-h-40 w-auto max-w-full object-contain`이라 폭 105px에서는 `max-w-full`이 먼저 걸려 `max-h-40`이 거의 발동하지 않는다. 조상 컨테이너로 확장된 가로로 긴 캡처(다이얼로그·`tr`·`li`)는 표시 높이가 **30~35px**로 내려가고, 거기에 `top-2`(8px) + `h-8`(32px)를 얹으면 **버튼이 이미지 아래로 뚫고 나간다** — PRD 배경이 "가장 주석이 필요하다"고 지목한 바로 그 케이스다.
   수용 근거는 hover에서만 뜬다는 것 하나이고, 그 대가로 발견성을 잃는다(위험 9). 수동 확인에서 이 두 케이스(작은 bbox / 저높이 확장 캡처)를 반드시 본다. 견딜 수 없으면 대안 E로 되돌린다.
6. **`[주석 제거]` 렌더 조건과 ButtonGroup 모서리.** 인라인 이미지는 `hidden` 속성으로 숨겨서 `:first-child`가 계속 점유되는 버그가 있었고 CSS(`[hidden] + .block-actions-button`)로 우회했다. React에서는 **조건부 렌더**라 그 함정이 없다 — `hidden` prop을 쓰지 말 것.
7. **오버레이 z-index.** `AnnotationOverlay`는 `DraftingPanel`에서 portal 없이 `fixed inset-0 z-50`로 뜬다(스크린샷 주석과 같은 자리). diff table은 패널 본문이라 문제없지만, 나중에 다이얼로그 안에서 열게 되면 portal이 필요하다 — 이번 스코프에서는 drafting 전용이라 현행 방식을 그대로 쓴다.
8. **오버레이 접근성 보강이 인라인 이미지 주석과 공유된다.** 확인된 사실: 루트 div에 `role`/`aria-label` 없음, Escape 핸들러는 텍스트 편집 textarea 전용이라 오버레이 취소로 이어지지 않음, 트리거 ref·포커스 복귀 없음. 그런데 이 컴포넌트는 `TiptapEditor`에서도 lazy 마운트되고 그 에디터는 **`DraftEditDialog`(Radix Dialog) 안**에서도 뜬다 — Escape 취소를 그냥 달면 같은 키가 부모 다이얼로그까지 닫아 작성 중이던 초안 편집이 함께 날아간다. 기존 키 핸들러의 `if (editing) return` 가드도 새 Escape에 그대로 필요하다. **별도 Task로 분리하고 인라인 이미지 주석 회귀를 검증한다.** 겸해서 `handleDone`이 단일 rAF 안에서 `toDataURL` → 즉시 `onComplete`라 비활성화도 스피너도 없다 — 고해상도 확장 캡처에서 체감 프리즈가 되므로 완료 처리 중 done 비활성을 같이 넣는다.
9. **hover 전용 노출의 접근성 비용.** `opacity-0`은 탭 순서에서 요소를 빼주지 않는다 — 요소 N개 × 2칸 × 최대 2버튼 = **최대 4N개의 보이지 않는 탭 정지점**이 diff table 구간에 생기고 스크린 리더에도 항상 노출된다. `group-focus-within`은 "포커스되면 보인다"만 해결한다. → `opacity-0`이 아니라 **hover/focus-within 시 조건부 렌더**로 구현해 안 보일 때는 DOM에 없게 한다. 겸해서 105px 셀에서 Radix 툴팁이 뜨면 그것이 다시 이미지를 덮는다(기존 block-actions는 네이티브 `title`이라 이 문제가 없었다) — 툴팁 배치를 수동 확인 항목에 둔다.
10. **미리보기와 제출물의 불일치.** 대안 D를 기각해 `mergeStyleElements`가 접지 않으므로, `DraftingPanel`만 배선하면 `PreviewPanel`은 원본을 보여주고 제출물만 주석본이 된다. `PreviewPanel`에도 `annotated` 두 필드를 전달한다(핸들러는 전달하지 않는다).
11. **lite 강등의 무음 손실.** 강등 폴백은 `.catch(() => {})`로 조용히 삼킨다. 기존엔 잃는 게 "다시 찍으면 되는 캡처"였고 이제는 **손으로 그린 주석**이라, 같은 코드 경로인데 손실의 체감이 다르다. 이번 스코프에서는 고지를 넣지 않고 기록만 한다 — 위험 1의 승인선을 통과하면 발생 빈도 자체가 낮다.
