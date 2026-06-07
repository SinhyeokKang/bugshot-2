# 복수 Element 스타일 변경 버퍼 — 기술 설계

## 개요

세 가지를 함께 바꾼다.

**(0) 선행 정리 — no-diff 폐지** — element 모드는 **diff가 있는 element만** drafting으로 넘긴다. styling→drafting 진입("다음")에 diff 게이트를 두고, 코드 전반의 `isElementNoDiff` 동적 모드 강등(element↔screenshot) 분기를 **제거**한다. 이로써 element 모드는 항상 "diff 있는 element 1개 이상 + before/after 존재"가 보장돼, 그 위에 복수 element를 배열로 얹기만 하면 된다. (기존 no-diff 요소 스크린샷은 **요소 캡처 모드 [[element-screenshot]] — 본 기능의 선행 과제**가 대체.)

**(1) 데이터 레이어** — editor-store에 `bufferedElements: BufferedElement[]` 배열을 추가한다. 각 항목은 한 element의 스타일 변경 컨텍스트(selection 스냅샷 + styleEdits + before/after 이미지) 한 묶음이다. "다시 선택"(RepickButton) 시 현재 element의 after 스냅샷을 캡처해 버퍼에 push(현재 element는 diff 게이트로 항상 diff 보장)하고 picker를 재시작한다. 이슈 등록 시점에 `buildCtx`가 **버퍼 + 현재 element**를 `MarkdownContext.styleElements` 배열로 합쳐, 6개 플랫폼 본문 빌더가 element별 섹션을 반복 출력한다. 버퍼는 `EditorSnapshot`에 포함돼 기존 selection과 동일하게 세션 영속화된다.

**(2) 페이지 시각 레이어 (누적 프리뷰)** — content script(`src/content/picker.ts`)의 단일 `selectedEl` 추적을 **편집된 element 레지스트리**(`editedEls: Map<Element, OriginalState>`)로 바꿔, 변경이 가해진 모든 element를 추적하고 element 전환 시 이전 element를 복원하지 않고 유지한다. cleanup 경로(취소/제출 완료/idle/탭이동)에서만 `restoreAll()`로 전체를 일괄 원복한다.

`IssueRecord`(draft 영속)와 DraftDetailDialog(재편집)는 신규 복수 element를 위해선 손대지 않는다 — 복수 element는 첫 제출 세션 안에서만 존재한다. (단 no-diff 폐지의 레거시 하위호환은 DraftDetailDialog에 남긴다.)

## 변경 범위

### A. no-diff 폐지 (선행)

#### A-1. `src/sidepanel/tabs/StyleEditorPanel.tsx` — diff 진입 게이트
- **현재 역할**: "다음" 버튼(line 436)이 `disabled={proceeding}`뿐이라 diff 없이도 `handleNext`로 drafting 진입.
- **변경 내용**: "다음" 버튼을 `disabled={proceeding || !hasChange}`로(이미 정의된 `hasChange`, line 122 활용). diff 없을 때 안내(헬퍼 텍스트/툴팁: "스타일을 변경하거나 요소 캡처 모드로 캡처하세요"). `handleNext`에도 방어적 early return(`if (!hasChange) return`).

#### A-2. `src/sidepanel/tabs/IssueCreateModal.tsx` — isElementNoDiff 제거
- **현재 역할**: `buildEditorCaptureFiles`(line 247~250)에서 `isElementNoDiff`로 element를 screenshot으로 강등(beforeImage를 screenshot으로).
- **변경 내용**: `isElementNoDiff` 분기 삭제. element 모드는 항상 before/after를 가진다. `buildCtx`의 element 분기도 diff 항상 존재 전제(단, 복수 처리는 C 참조).

#### A-3. `src/sidepanel/lib/buildIssueMarkdown.ts` — media 폴백 제거 + 형식 전환
- **현재 역할**: `emitMedia`(line 91~108 / 189~204)에서 element 모드일 때 `ctx.diffs.length > 0`이면 단일 `## Style Changes` 테이블, 아니면 media 섹션(imageAttached). env의 `- **DOM**: {selector}`는 단일(line 63~65).
- **변경 내용**: element 모드는 항상 styleChanges 경로(`else media` 폴백 삭제). 단일 `## Style Changes` → **`styleElements.map`으로 `## Style Changes ({selector})` 반복**(C-2 본문 직렬화 형식). env DOM 줄은 `styleElements`의 selector **쉼표 나열**. (screenshot/video/freeform media 경로는 그대로.)

#### A-4. 6개 플랫폼 본문 빌더 — diff 0 폴백 제거 + 복수 반복
- `buildGithubIssueBody.ts` / `buildLinearIssueBody.ts` / `buildGitlabIssueBody.ts` / `buildAsanaIssueBody.ts` / `buildNotionIssueBody.ts` / `buildIssueAdf.ts`
- **현재 역할**: 각 빌더가 `ctx.diffs.length > 0`이면 styleChanges, 아니면 screenshot/media로 폴백(예: github line 97, notion line 195).
- **변경 내용**: element 모드 diff 0 폴백 삭제. `ctx.styleElements`를 element별 반복하며 헤더를 `## Style Changes ({selector})`로(본문 직렬화 형식). 단수·복수 동일 코드(`styleElements.map`). before/after는 `before-${i}`/`after-${i}` 매칭.

#### A-5. `src/sidepanel/lib/buildCaptureFiles.ts` — screenshot 강등 입력 정리
- **현재 역할**: element 모드에서 before/after 생성, 호출부(IssueCreateModal)가 isElementNoDiff면 screenshot으로 강등해 호출.
- **변경 내용**: element 모드는 항상 before/after 경로(복수면 `before-${i}`/`after-${i}`, C 참조). 강등 입력 제거.

#### A-6. `src/sidepanel/tabs/DraftDetailDialog.tsx` — 레거시 폴백 유지(변경 최소)
- **현재 역할**: `buildCtxForSubmit`(line 293~294)에서 `isElementNoDiff`로 레거시 처리.
- **변경 내용**: **신규 경로는 diff 보장**되므로 평상시 미발동. 단 폐지 이전에 저장된 no-diff element draft 하위호환을 위해 이 분기는 **그대로 남긴다**(주석으로 "legacy no-diff draft fallback" 명시). 마이그레이션 불필요. 복수 element 복원은 비목표라 단일 유지.

### B. content script 누적 프리뷰

#### B-1. `src/content/picker.ts`
- **현재 역할**: 단일 `selectedEl`(line 198)과 원본 1벌(`originalClassName`/`originalStyle`/`editableHandle`/`originalTextContent`, line 200~203)만 추적. 전환·정리 시 `restoreOriginal()`(line 489)로 현재 element 원복.
- **변경 내용**:
  - `editedEls: Map<Element, OriginalState>` 도입(`OriginalState = { className, style, editable, text }`).
  - `captureOriginal(el)`(481): 레지스트리에 없을 때만 원본 기록(최초 원본 유지). 전역 `original*`는 현재 selectedEl 캐시로 레지스트리에서 채움(`handleApplyStyles` 호환).
  - **restoreOriginal 호출 제거(누적 유지)**: `handleStart`(396)·`handleNavigate`(443)·`onClickCommit`(641)·`onKeyDown` Escape(656)·iframe 분기(634). (`handleNavigate`는 C-4b의 navigate 정책과 짝 — diff 있는 element는 페이지 유지, diff 없으면 레지스트리 미등록이라 잔여 없음.)
  - element 떠날 때 diff 없으면 레지스트리에서 제거(빈 항목 정리).
  - **`restoreAll()` 신설** → `handleClear`(412)에서 `restoreOriginal` 대신 호출(전체 원복 + Map clear).
  - `handleResetEdits`(475)는 현재 element만 원복 + 레지스트리 제거(단일 reset 유지).
  - `handleApplyStyles`(459)의 원본 리셋은 레지스트리의 해당 element 원본 기준.

### C. 복수 element 데이터·직렬화

#### C-1. `src/store/editor-store.ts` — 버퍼 상태·액션
- `BufferedElement` 인터페이스 신설(인터페이스 설계 참조).
- `EditorState`에 `bufferedElements: BufferedElement[]`, `initial`에 `[]`.
- `bufferCurrentElement(afterImage)`: 현재 selection의 diff가 있으면(가드로 항상 보장되나 방어적으로 체크) `{selectionSnapshot, styleEdits, beforeImage, afterImage}`를 push. **같은 selector면 갱신**(diff·after 교체, 최초 before 유지).
- `preserveBuffer(state)` 헬퍼 + `startPicking`의 `...initial`에 적용(모드 진입 시 버퍼 보존).
- `onSubmitted`에 `bufferedElements: []` 추가. `reset`/`cancelPicking`은 `...initial`이라 자동.

#### C-2. `src/sidepanel/lib/buildIssueMarkdown.ts` — MarkdownContext 확장 + 머지
- `StyleElementContext` 인터페이스 + `MarkdownContext.styleElements?: StyleElementContext[]` 추가.
- `mergeStyleElements(buffered, current)` 순수 함수: 버퍼 항목 → StyleElementContext 변환(각 항목 `buildStyleDiff`, `before-${i}`/`after-${i}` 파일명), 현재 element 합치고 selector dedup(현재 우선). diff 0 항목은 제외(안전장치 — 가드로 현재 element는 항상 diff).
- **본문 골격(아래 "본문 직렬화 형식" 참조)**: Environment 섹션의 `- **DOM**:` 줄을 `styleElements`의 selector **쉼표 나열**로, Style Changes는 element마다 **`## Style Changes ({selector})` 섹션을 반복**(단수·복수 동일 형식, 분기 없음). `buildIssueMarkdown`/`buildIssueHtml`/6개 빌더 모두 `styleElements.map`으로 동일 처리.

#### C-3. `src/sidepanel/lib/buildCaptureFiles.ts` — element별 파일
- 입력에 element별 이미지 배열 추가. element 모드에서 항목별 `before-${i}.webp`/`after-${i}.webp` 생성.

#### C-4. `src/sidepanel/tabs/IssueCreateModal.tsx` — buildCtx/captureFiles 머지
- `buildCtx`의 element 분기에서 `mergeStyleElements(bufferedElements, 현재 element)` → `ctx.styleElements`. 기존 단일 필드(selector/diffs 등)는 첫 element로 채워 하위호환(meta comment 등).
- `buildEditorCaptureFiles`에서 styleElements의 before/after 이미지 배열을 buildCaptureFiles에 전달.

#### C-4b. element 전환 진입점 — RepickButton + DomNavButton (push + 시각 위계)
- **현재 역할**: `RepickButton`(StyleEditorPanel.tsx:449)이 `startPicker(tabId)`만 호출(`variant="outline"`, `h-8 w-8`). `DomNavButton`(DomTreeDialog.tsx:32, 부모/자식 이동)이 `navigatePicker(tabId, direction)`만 호출. 둘 다 element를 전환하지만 현재 diff를 버퍼에 담지 않는다.
- **변경 내용**:
  - **공유 push 로직**: 두 버튼 모두 onClick을 async로 — diff가 있으면(`hasChange`) `captureElementSnapshot(tabId)`로 after 캡처 → `bufferCurrentElement(after)` → 이어서 `startPicker`/`navigatePicker` 호출. diff 없으면 push 생략하고 전환만(페이지는 아래 navigate 정합으로 복원). 캡처 중 중복 클릭 방지 플래그. → **repick·navigate가 버퍼 적재에서 완전 동일 정책**(사용자 결정).
  - **navigate 페이지 정합**: B-1의 `handleNavigate` `restoreOriginal` 제거는 "diff 있어 버퍼에 담은 element는 페이지 유지"를 위함. diff 없는 element를 navigate로 떠날 땐 레지스트리 미등록(=변경 없음)이라 자연히 잔여 없음 — 별도 복원 불필요. 즉 editedEls 등록 여부(=diff 유무)가 페이지 유지/정리를 자동 결정.
  - **시각 위계 상승(RepickButton)**: 복수 element 누적의 핵심 진입점으로 중요도가 올라가, `variant="outline"` → **`variant="default"`**(shadcn primary = 까만 배경 + 흰 아이콘; 다크모드는 테마 변수 자동 반전). 커스텀 색상 없이 shadcn 변수만(CLAUDE.md). `h-8 w-8` 유지. (DomNavButton 스타일은 현행 유지 — 위계 변경은 repick만.)

#### C-5. `src/sidepanel/hooks/useEditorSessionSync.ts` — 세션 영속화
- `EditorSnapshot`(editor-store.ts)·`snapshotFromState`에 `bufferedElements` 추가. lite 강등 객체에서 버퍼 항목 이미지도 제거하도록 보강.

#### C-6. `src/i18n/namespaces/issue.ts`(또는 editor.ts) — 라벨
- element 소제목 키 / "diff 없이 다음" 안내 문구 추가 시 ko/en 동시(PostToolUse 훅 검사).

### 변경 없음 (명시적)
- `src/store/issues-store.ts` `IssueRecord`/마이그레이션/`ISSUES_STORE_VERSION` — 변경 없음.
- `src/store/blob-db.ts` blob 키 체계 — 변경 없음(draft 영속 이미지는 `id:before`/`id:after` 단일 유지). 복수 element 이미지는 IndexedDB에 영속하지 않고 첫 제출 시 플랫폼 업로드용 CaptureFiles로만 생성.

## 데이터 흐름

```
                   [sidepanel 데이터]                       [content script 페이지 시각]
[picker 선택 A] → onElementSelected (styleEdits 리셋)      captureOriginal(A) → editedEls{A}
                → captureElementSnapshot → setBeforeImage(A.before)
[A 수정]        → setStyleEdits (A.diff)                   applyStyles(A) → 페이지에 A 변경
[diff 없으면]    → "다음" 비활성(no-diff 폐지) → 진행 불가
[RepickButton]  → captureElementSnapshot(A.after)
                → bufferCurrentElement(A.after)            picker.start → handleStart
                → startPicker(...preserveBuffer)             (restoreOriginal 제거 → A 변경 유지)
[picker 선택 B] → onElementSelected (버퍼 보존)            onClickCommit(B): restore 안 함
                → setBeforeImage(B.before)                   captureOriginal(B) → editedEls{A,B}
[B 수정]        → handleNext(가드 통과) → confirmStyles     applyStyles(B) → 페이지에 A·B 동시 적용
[이슈 등록]     → buildCtx: mergeStyleElements(buffer[A]+B) → ctx.styleElements=[A,B]
                → buildEditorCaptureFiles: before-0/after-0(A), before-1/after-1(B)
                → 플랫폼 빌더 element별 섹션 반복 → 제출
[제출/취소]     → onSubmitted/reset: bufferedElements=[]   clearPicker → handleClear → restoreAll()
```

### 세션 영속화
`snapshotFromState`/`EditorSnapshot`에 `bufferedElements` 추가 → 기존 selection처럼 `chrome.storage.session`에 자동 저장·복원. 직렬화 실패 시 lite 강등(이미지 제거)에 버퍼 항목 이미지도 포함.

## 본문 직렬화 형식

단수·복수 **분기 없이** `styleElements` 배열을 그대로 map한다(단일 = 1개짜리 배열). 단일 element 출력도 기존(`## Style Changes` + env `- **DOM**: selector`)에서 아래 형식으로 **바뀐다**(의도된 변경, 회귀 아님 — 기존 단위 테스트 갱신 필요).

- **Environment**: `- **DOM**:` 줄에 `styleElements`의 selector를 **쉼표로 나열**.
- **Style Changes**: element마다 `## Style Changes ({selector})` 섹션 + 자기 테이블(`before-${i}`/`after-${i}` Snapshot 행 + diff 행).

```markdown
## Environment

- **OS**: macOS 15.5
- **Browser**: Chrome 130
- **Page**: https://example.com
- **DOM**: button.cta, div.course.card        ← diff 있는 element selector 쉼표 나열
- **Viewport**: 1440×900
- **Captured**: 2026-06-08 14:30

## Style Changes (button.cta)

| Property | As is | To be |
| --- | --- | --- |
| **Snapshot** | ![before-0.webp](url) | ![after-0.webp](url) |
| color | #000000 | #ffffff |

## Style Changes (div.course.card)

| Property | As is | To be |
| --- | --- | --- |
| **Snapshot** | ![before-1.webp](url) | ![after-1.webp](url) |
| padding | 10px | 20px |
```

- **플랫폼별 변형**(골격 동일, Style Changes 헤더만 `({selector})` 부여):
  - `buildIssueMarkdown`(범용 복사): Snapshot 행 없이 diff 테이블만.
  - github/gitlab/linear: 위 예시대로 Snapshot 행 포함.
  - notion: `## Style Changes ({selector})` 아래 before/after를 heading_3로 분리(기존 구조에 selector만 부여).
  - asana: inline 이미지 + diff. jira(ADF): heading + 테이블 노드.
- **이미지 인덱스 `i`**: `styleElements`(머지·dedup 후) 배열 인덱스. element 섹션과 `before-${i}`/`after-${i}`가 1:1.
- Style Changes 헤더 라벨은 i18n `md.section.styleChanges` + `({selector})` 조합. 새 키 불필요(selector는 동적 삽입).

## 인터페이스 설계

```typescript
// src/content/picker.ts - 누적 프리뷰 레지스트리
interface OriginalState {
  className: string | null;
  style: string | null;
  editable: EditableHandle | null;
  text: string | null;
}
let editedEls: Map<Element, OriginalState>;   // 변경이 가해진 모든 element 추적
function captureOriginal(el: Element): void;   // editedEls에 없을 때만 원본 기록
function restoreAll(): void;                    // 전체 원복 + Map clear (handleClear에서 호출)
// restoreOriginal(현재 element 1벌 복원)은 handleResetEdits 전용으로 축소
```

```typescript
// src/store/editor-store.ts
export interface BufferedElement {
  selector: string;
  tagName: string;
  selectionSnapshot: {
    classList: string[];
    specifiedStyles: Record<string, string>;
    computedStyles: Record<string, string>;
    text: string | null;
    viewport: { width: number; height: number };
    capturedAt: number;
  };
  styleEdits: EditorStyleEdits;       // { classList, inlineStyle, text }
  beforeImage: string | null;
  afterImage: string | null;
}

interface EditorState {
  // ...기존...
  bufferedElements: BufferedElement[];
  bufferCurrentElement: (afterImage: string | null) => void;
}
```

```typescript
// src/sidepanel/lib/buildIssueMarkdown.ts
export interface StyleElementContext {
  selector: string;
  tagName: string;
  classListBefore: string[];
  classListAfter: string[];
  specifiedStyles: Record<string, string>;
  diffs: StyleDiffRow[];
  beforeFilename?: string;   // "before-0.webp"
  afterFilename?: string;    // "after-0.webp"
}

export interface MarkdownContext {
  // ...기존 단일 필드 유지(첫 element 기준 하위호환)...
  styleElements?: StyleElementContext[];
}

// 버퍼 + 현재 element를 selector dedup 머지. diff 0 항목 제외(안전장치). 순수 함수.
export function mergeStyleElements(
  buffered: BufferedElement[],
  current: { selection: EditorSelection; styleEdits: EditorStyleEdits; before: string | null; after: string | null } | null,
): StyleElementContext[];
```

## 부가 흐름 처리 (체크 결과 보강)

- **AI 스타일링**: AI 결과는 `setStyleEdits(merged)` 경유로 현재 element의 `styleEdits`에 반영된다(AiStylingDialog). 따라서 버퍼 push·직렬화에 **자동 포함** — 별도 처리 불필요. `aiStylingLoading`은 transient 상태라 버퍼와 무관(BufferedElement에 안 담음).
- **tokens**: `tokens`는 element 전환 시마다 `collectTokens`로 재수집되는 현재 element 기준 값이다. 본문 diff 테이블은 `buildStyleDiff`로 만들어 tokens가 필요 없으므로, **BufferedElement에는 tokens를 담지 않는다**. `buildMetaComment`의 `meta.selector`/`cssChanges`/`tokens`는 기존대로 **현재(첫) element 기준 단일 유지**(AI 메타 첨부 `buildAiMetaAttachment`도 동일). → 복수 element의 meta 정보는 축약되지만, 사람이 읽는 본문(styleElements)은 완전하다. meta를 element별 배열로 확장하는 것은 이번 비목표(필요 시 후속).
- **EditorSnapshot 하위호환**: 기존 세션 스냅샷에는 `bufferedElements` 필드가 없다. `hydrate`/초기화 시 `bufferedElements: snap.bufferedElements ?? []`로 기본값 처리(마이그레이션 불필요). lite 강등 시 버퍼 항목 이미지 제거(C-5).
- **confirmDraft → IssueRecord**: 복수 element여도 `confirmDraft`(editor-store)는 **현재(마지막) selection 하나만** IssueRecord에 저장한다(기존 동작 유지). draft 재편집(DraftDetailDialog)은 그 단일 element만 복원 — 복수 draft 영속은 비목표(prd). 즉 "첫 제출 본문은 복수 정상, 로컬 draft 백업은 마지막 element만"이며, 제출 본문(플랫폼 등록)에는 영향 없다.
- **sessionExpired와 버퍼**: element styling 중 페이지 만료(`sessionExpired`) → SessionExpiredDialog `onConfirm`의 `reset()`이 `...initial`로 버퍼까지 비운다(별도 작업 불필요). 페이지 변경은 만료된 페이지라 복원 불가(자연 소실).

## 하위호환 — 레거시 no-diff draft

no-diff 폐지 이전에 이슈 목록에 저장된 element draft 중 `styleEdits` diff가 0인 것이 있을 수 있다(드물지만 가능). 처리:
- **신규 생성 경로**(IssueCreateModal → confirmDraft): diff 게이트로 no-diff draft가 새로 생기지 않는다.
- **기존 저장분**(DraftDetailDialog 열람/재제출): `buildCtxForSubmit`의 레거시 `isElementNoDiff` 분기를 **유지**해 기존처럼 screenshot 미디어로 표시. 마이그레이션·스키마 변경 없음.
- 출시 초기라 잔존 데이터는 미미할 것으로 보고, 적극 변환/삭제는 하지 않는다(외과적 범위).

## 기존 패턴 준수

- **세션 영속화 패턴**: `EditorSnapshot`/`snapshotFromState`에 필드 추가 → 기존 `selection`·`styleEdits`와 동일. lite 강등 규칙 일관.
- **`...initial` + preserve 헬퍼**: `preserveLogs`와 동형의 `preserveBuffer`.
- **순수 함수 재사용**: `buildStyleDiff`를 element별 호출. 새 diff 로직 없음.
- **store가 chrome API 직접 호출 회피**: after 스냅샷 캡처는 컴포넌트(RepickButton)에서 수행 후 store 액션에 주입(기존 handleNext와 동일).
- **content script 복원 모델**: `captureOriginal`/`restore` 패턴 유지하되 단일 변수 → `Map`. cleanup 종착점(`handleClear`)에 복원 일원화하는 기존 구조 유지.
- **i18n 동시 갱신**: 새 키 ko/en 양쪽.
- **테스트 우선**: `bufferCurrentElement`·`mergeStyleElements`·element별 파일명은 순수 함수로 분리해 단위 테스트 먼저.

## 대안 검토

1. **no-diff 폴백 유지 + merge.length로 분기 (기각)**: breaking 없이 갈 수 있으나, `isElementNoDiff` 동적 강등이 5곳(buildCtx/buildEditorCaptureFiles/DraftDetailDialog/buildCaptureFiles/6개 빌더)에 잔존해 복수 element 도입 시 분기가 가장 미묘해진다. element 모드 = diff 전용으로 책임을 가르면 이 분기를 통째로 삭제 가능. 출시 초기라 breaking 비용이 최소인 지금이 정리 적기 → 폐지 채택.
2. **IssueRecord에 element 배열을 넣어 draft 영속까지 지원 (기각)**: 스키마+버전 bump+마이그레이션+blob 키+DraftDialog 전면 확장. 회귀 위험 크고 "UI 0" 방향과 어긋남.
3. **빌더를 element별로 호출해 문자열 머지 (기각)**: env/log/section 공통 머리말이 element 수만큼 중복. styleChanges 섹션만 element 반복하는 `MarkdownContext.styleElements` 내부 반복 채택.
4. **페이지 시각은 현재 element만, 데이터만 버퍼 (기각)**: content script 무변경으로 단순하나 B 편집 중 페이지에서 A 변경이 사라져 "누적 비교" 가치 하락. 사용자가 누적 프리뷰 명시 → 레지스트리화 채택.

## 위험 요소

- **세션 storage 용량**: element별 base64 before/after 누적으로 한계 도달 시 lite 강등(이미지 제거) → 버퍼 이미지 손실 가능(텍스트 diff·페이지 변경은 유지). 버퍼 이미지를 lite 강등 대상에 포함하는 보강 필수.
- **회귀 위험의 무게중심은 "텍스트 형식"이 아니라 "이미지 인덱싱/첨부"**: 와꾸(`## Style Changes ({selector})` 반복) 자체는 분기 없는 `styleElements.map`이라 회귀 표면적이 작다. 진짜 위험은 두 가지에 몰려 있다:
  - **이미지 파일명 매칭**: 기존 `images.find(i => i.filename.startsWith("before"))`는 `before-0`/`before-1`을 모두 첫 번째로 잡는다. 루프에서 **정확 일치(`=== \`before-${i}\``)** 또는 인덱스 기반으로 바꿔야 한다. 안 바꾸면 모든 element가 같은 이미지를 가리키는 조용한 버그.
  - **첨부 중복 방지(attached/mediaHandled)**: 기존엔 before/after 1쌍만 등록. 복수면 N쌍 전부 등록해야 — 누락 시 일부 이미지가 본문 아래 Attachments에 중복으로 뜨거나 업로드 누락.
- **플랫폼별 이미지 삽입 모델 차이**: github `imageCell`(`![](url)`), linear `assetUrl`, notion `nextPlaceholder`+`queueAttachment`, asana inline 순서, jira ADF media 노드 — "마크다운 규칙"이 아니라 이미지를 본문에 꽂는 메커니즘이 플랫폼마다 달라, element별 인덱스로 N번 호출할 때 빌더마다 다르게 틀릴 수 있다(특히 notion placeholder 카운터·asana inline 순서). → 빌더별 복수 element 단위 테스트(스냅샷) + 플랫폼별 실제 제출 검증이 안전망.
- **빈 styleElements 방어**: no-diff 폐지로 element 모드는 항상 1+개지만, 레거시 draft 재제출 등 엣지에서 비면 `## Style Changes ()` 깨짐 가능 → map 전 길이 가드.
- **현재 element 중복 직렬화**: 마지막 element가 같은 selector로 버퍼에도 있으면 `mergeStyleElements`의 dedup으로 현재 것 우선. 테스트로 고정.
- **페이지 오염(restoreAll 누락)**: 누적 유지로 자동 복원이 사라지므로 **모든 종료 경로가 `handleClear`(→`restoreAll`)로 수렴**해야 한다. 현황: `clearPicker`는 작성 취소(StyleEditorPanel)·세션 만료/탭이동(useEditorSessionSync)·이슈 삭제·재편집(issues-store, DraftDetailDialog)·`IssueTab.tsx:68`의 `phase→idle` subscribe에서 발화. 제출 완료는 `done`→`reset()`→idle 전환 때 정리. ⚠️ **잔여 케이스**: `done` 상태로 패널/탭을 닫으면 idle 전환이 안 일어나 페이지 변경이 남을 수 있음 → onSubmitted(또는 done 진입)에 페이지 복원 동반 검토.
- **레지스트리 메모리**: `Map<Element,…>`는 강참조. element 전환 시 diff 없는 항목 정리 + `restoreAll`에서 clear로 라이프사이클 종료 시 해제(restoreAll 순회 위해 WeakMap 아닌 Map 사용).
- **diff 게이트 판정 일치**: 진입 게이트(`hasChange`, StyleEditorPanel)와 직렬화(`buildStyleDiff`)의 diff 판정이 어긋나면(예: shorthand collapse 차이) "게이트는 통과했는데 직렬화 결과 0개" 같은 모순 가능. 가드를 `buildStyleDiff(...).length > 0` 기준으로 통일하는 것을 권장(또는 `hasChange`와 동치임을 테스트로 확인).
