# Element 모드: 스타일 수정 없이 이슈 작성 — 기술 설계

## 개요

StyleEditorPanel의 "Next" 버튼 활성화 조건에서 `hasChange` 게이트를 제거한다. Drafting 화면과 이슈 제출 파이프라인에 "스타일 변경 없는 element 모드" 분기를 추가해, diff table 대신 element 스냅샷 이미지 1장을 screenshot 모드와 동일한 미디어 섹션으로 노출한다.

핵심 판별 기준: `diffs.length > 0`으로 스타일 변경 유무를 런타임에 결정. 별도 플래그 없이 기존 `buildStyleDiff` 결과를 그대로 사용한다.

## 변경 범위

### 1. `src/sidepanel/tabs/StyleEditorPanel.tsx`
- **현재**: "Next" 버튼 `disabled={proceeding || !hasChange}` (line 438)
- **변경**: `disabled={proceeding}` — 스타일 변경 없이도 진행 가능
- `handleNext`의 `captureElementSnapshot` + `setAfterImage` + `confirmStyles` 로직은 변경 없음. 스타일 변경 없이 호출하면 afterImage는 beforeImage와 시각적으로 동일한 스냅샷이 됨. **afterImage 정책: (c) 캡처+저장하되 제출 시 무시**. `confirmDraft`의 blob 저장 로직이 `!!state.afterImage`로 분기하므로 afterImage를 null로 두면 `snapshot.after === false`가 되어 `hasStyleBlock` 계산 등 하위 분기가 복잡해진다. 캡처 비용은 무시할 수준이고 저장된 after blob은 사용되지 않으므로, 기존 코드 변경을 최소화하기 위해 이 정책을 채택한다.

### 2. `src/sidepanel/tabs/DraftingPanel.tsx`
- **현재**: element 모드는 항상 `StyleChangesTable`을 "스타일 변경사항" 섹션으로 렌더 (lines 119-126)
- **변경**: `diffs.length === 0`일 때 screenshot 모드와 유사한 미디어 섹션(이미지 1장)을 렌더

```typescript
// 변경 후 element 모드 분기 (lines 119-126 교체)
isElementMode ? (
  diffs.length > 0 ? (
    <Section key="__media" title={t("section.styleChanges")} collapsible>
      <StyleChangesTable
        beforeImage={beforeImage}
        afterImage={afterImage}
        diffs={diffs}
      />
    </Section>
  ) : (
    <Section key="__media" title={t("section.media")} collapsible>
      {beforeImage ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted/70">
          <img
            src={beforeImage}
            alt={t("section.media")}
            className="h-full w-full object-contain"
          />
        </div>
      ) : null}
    </Section>
  )
)
```

- beforeImage 사용 근거: element 선택 시점에 캡처된 원본 스냅샷. 스타일 변경 없으므로 before가 유일한 의미 있는 이미지.
- `aspect-video w-full overflow-hidden rounded-lg border bg-muted/70` + `h-full w-full object-contain` — screenshot 모드의 이미지 표시와 동일한 스타일 (DraftingPanel.tsx lines 160-165).

### 3. `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **현재**: `hasStyleBlock` 판별 후 `DraftDetailSections`에 전달, `DraftDetailSections`는 `hasStyleBlock`이면 `StyleChangesTable` 렌더 (lines 704-711)
- **변경**: `DraftDetailSections`에서 `hasStyleBlock && diffs.length > 0`일 때만 StyleChangesTable을 렌더하고, `hasStyleBlock && diffs.length === 0`일 때는 screenshot과 유사한 이미지 표시

```typescript
// DraftDetailSections mediaBlock 분기 (lines 704-712 교체)
hasStyleBlock && diffs.length > 0 ? (
  <FieldSection key="__media" label={t("section.styleChanges")}>
    <StyleChangesTable beforeImage={beforeUrl} afterImage={afterUrl} diffs={diffs} />
  </FieldSection>
) : hasStyleBlock ? (
  <FieldSection key="__media" label={t("section.media")}>
    {beforeUrl ? (
      <div className="aspect-video w-full overflow-hidden rounded-md border bg-muted/70">
        <img src={beforeUrl} alt="Element snapshot" className="h-full w-full object-contain" />
      </div>
    ) : null}
  </FieldSection>
) : null
```

- `hasStyleBlock`은 `!isScreenshot && (!!issue.snapshot.before || !!issue.snapshot.after || diffs.length > 0)`으로 계산됨 (line 216-218). 스타일 변경 없이 저장해도 `snapshot.before === true`이므로 `hasStyleBlock === true`.
- **분기 삽입 순서가 중요**: 기존 코드에서 `hasStyleBlock`이면 `StyleChangesTable`을 렌더하는 분기가 있으므로, 새 `hasStyleBlock && diffs.length === 0` 분기를 **기존 분기 앞에** 삽입하거나, 기존 분기의 조건을 `hasStyleBlock && diffs.length > 0`으로 변경해야 한다.

### 4. `src/sidepanel/lib/buildCaptureFiles.ts`
- **현재**: element 모드는 `before.webp` + `after.webp` 생성 (lines 72-79)
- **변경**: `diffs`가 비어있으면 `beforeImage`를 `screenshot.webp`로 하나만 내보내고, diffs가 있으면 기존대로.

단, 이 함수는 `diffs` 정보를 받지 않는다. `buildCtxForSubmit`에서 호출 시 분기를 처리하는 것이 더 적합하다.

### 5. `src/sidepanel/tabs/DraftDetailDialog.tsx` — `buildCtxForSubmit` 함수
- **현재**: element 모드에서 `beforeImage`/`afterImage`를 분리해서 `buildCaptureFiles`에 전달 (lines 261-269)
- **변경**: `diffs.length === 0`일 때 **`screenshotImage` 파라미터에 `beforeDataUrl`을 매핑**하고 `beforeImage`/`afterImage`는 null 처리. `captureMode`도 `"screenshot"`으로 전달해 `buildCaptureFiles`가 `screenshot.webp` 파일명을 생성하게 한다. **핵심은 captureMode 변경만이 아니라 입력 필드 매핑도 함께 변경**하는 것 — `buildCaptureFiles`의 screenshot 분기는 `input.screenshotImage`를 읽고, element 분기는 `input.beforeImage`/`input.afterImage`를 읽으므로, captureMode만 바꾸면 이미지가 누락된다.

```typescript
const noDiffs = diffs.length === 0;
const isElementNoDiff = !isScreenshot && !isVideo && !isFreeform && noDiffs;
const captureFiles = await buildCaptureFiles({
  captureMode: isElementNoDiff ? "screenshot" : (issue.captureMode ?? "element"),
  videoBlob,
  screenshotImage: isScreenshot || isElementNoDiff ? beforeDataUrl : null,
  beforeImage: isScreenshot || isElementNoDiff ? null : beforeDataUrl,
  afterImage: isElementNoDiff ? null : afterDataUrl,
  networkLog,
  consoleLog: consoleLogForSubmit,
});
```

`captureMode`를 `"screenshot"`으로 넘기면 `buildCaptureFiles`가 `screenshot.webp`로 파일을 만든다. `ctx.captureMode`는 여전히 `"element"`이므로 환경 정보(selector, tagName 등)는 정상 포함.

### 5-1. `src/sidepanel/tabs/IssueCreateModal.tsx` — `buildEditorCaptureFiles` 함수
- **현재**: element 모드에서 `afterImage`를 그대로 전달 (lines 217-229)
- **변경**: `DraftDetailDialog.buildCtxForSubmit`과 동일한 `isElementNoDiff` 분기를 적용. `diffs.length === 0`이면 `captureMode: "screenshot"`, `screenshotImage: beforeDataUrl`, `beforeImage: null`, `afterImage: null`로 전달.
- 이 경로는 DraftingPanel에서 바로 제출하는 "라이브 제출" 경로로, 누락 시 body 빌더가 `screenshot.webp`를 찾지 못해 이미지가 포함되지 않는다.

### 6. 이슈 body 빌더 6개 파일

`ctx.captureMode`는 `"element"`이지만 `ctx.diffs`가 빈 배열이고 images에 `screenshot.webp`가 오는 경우를 처리해야 한다. `buildIssueHtml`(동일 파일 내)도 동일한 분기가 필요하다.

#### 6-1. `src/sidepanel/lib/buildIssueMarkdown.ts` (클립보드 복사 + HTML 미리보기)
- **현재**: element 모드 → "Style Changes" 섹션 + diff table (lines 99-112)
- **변경**: `ctx.diffs.length === 0`이면 screenshot 모드와 동일한 "Media" 섹션 (이미지 첨부 안내 텍스트)

```typescript
} else {
  if (ctx.diffs.length > 0) {
    lines.push(`## ${t("md.section.styleChanges")}`);
    // ... 기존 diff table 로직
  } else {
    lines.push(`## ${t("md.section.media")}`);
    lines.push("");
    lines.push(t("md.imageAttached"));
    lines.push("");
  }
}
```

**`buildIssueHtml`** (동일 파일, line 192-204)도 동일한 element 모드 분기가 있으며, PreviewPanel의 HTML 미리보기 렌더에 사용된다. `buildIssueMarkdown`과 동일한 `ctx.diffs.length === 0` 분기를 추가해야 한다.

#### 6-2. `src/sidepanel/lib/buildIssueAdf.ts` (Jira)
- **현재**: element 모드 else 절에서 항상 Style Changes heading + diff table (lines 101-108). **주의: 현재 코드에 `diffs.length` 가드가 없어 diffs가 비면 헤더만 있는 빈 ADF 테이블이 생성됨** (`buildIssueMarkdown`은 `diffs.length > 0` 가드가 있는 반면, ADF 빌더에는 없음).
- **변경**: `ctx.diffs.length === 0`이면 Media heading + IMAGE_PLACEHOLDER (screenshot 모드와 동일). `ctx.diffs.length > 0`이면 기존 table 유지.

```typescript
} else {
  if (ctx.diffs.length > 0) {
    content.push(heading(2, t("md.section.styleChanges")));
    content.push(table([t("md.column.property"), "As is", "To be"], ctx.diffs.map(d => [d.prop, d.asIs, d.toBe])));
  } else {
    content.push(heading(2, t("md.section.media")));
    content.push(paragraph([textNode(IMAGE_PLACEHOLDER)]));
  }
}
```

#### 6-3. `src/sidepanel/lib/buildGithubIssueBody.ts` (GitHub)
- **현재**: element 모드에서 before/after 이미지를 찾아 style changes table 생성 (lines 98-121)
- **변경**: `ctx.diffs.length === 0`이면 screenshot 모드와 동일한 Media 섹션. images에 `screenshot.webp`가 오므로 기존 screenshot 분기 (`!isVideo && images[0]?.url`, lines 128-134)에 자연스럽게 진입.

구체적으로: element 모드 `isElement` 분기 안에서 `ctx.diffs.length === 0`이고 `before`/`after` 이미지가 없을 때 (screenshot.webp로 왔으므로) screenshot 이미지를 찾아 Media 섹션을 출력.

```typescript
} else if (isElement) {
  const before = images.find((i) => i.filename.startsWith("before"));
  const after = images.find((i) => i.filename.startsWith("after"));
  const hasSnapshots = !!(before?.url || after?.url);

  if (hasSnapshots || ctx.diffs.length > 0) {
    // 기존 style changes table 로직
  } else {
    // diffs 없고 before/after 없음 → screenshot.webp로 왔을 것
    const screenshot = images.find((i) => i.filename.startsWith("screenshot"));
    if (screenshot?.url) {
      lines.push(`## ${t("md.section.media")}`, "");
      lines.push(`![${screenshot.filename}](${screenshot.url})`);
      attached.push(screenshot.filename);
      mediaHandled.add(screenshot.filename);
      lines.push("");
    }
  }
}
```

#### 6-4. `src/sidepanel/lib/buildLinearIssueBody.ts` (Linear)
- **현재**: element 모드 else 절에서 snapshot + diff table (lines 111-135)
- **변경**: `ctx.diffs.length === 0`이고 before/after 이미지 없으면 screenshot.webp를 찾아 Media 섹션으로 출력. screenshot 모드 분기(lines 104-110)와 동일한 형식.

#### 6-5. `src/sidepanel/lib/buildNotionIssueBody.ts` (Notion)
- **현재**: element 모드 else 절에서 Before/After 섹션 분리 + bullet list (lines 158-191)
- **변경**: `ctx.diffs.length === 0`이고 before/after 이미지 없으면 screenshot 모드와 동일한 Media heading + image block. images에서 screenshot.webp를 찾아 placeholder 할당.

### 7. `src/store/editor-store.ts` — `confirmDraft` (element 분기)
- **변경 없음**. `styleEdits`, `selectionSnapshot`, `snapshot` 저장 로직은 스타일 변경 유무와 무관하게 동일하게 동작한다. `styleEdits`가 selection의 원본 값과 동일할 뿐이고, `snapshot.before`/`snapshot.after`는 이미지 존재 여부로 결정된다.

## 데이터 흐름

### 스타일 변경 없는 element 모드

```
picking → styling (Next 버튼 활성, 변경 없이도)
  → handleNext: captureElementSnapshot → afterImage 세팅 → confirmStyles
  → drafting: diffs = buildStyleDiff(selection, styleEdits) → 빈 배열
    → DraftingPanel: diffs.length === 0 → "미디어" 섹션 + beforeImage
  → previewing → confirmDraft:
    snapshot: { before: true, after: true }
    styleEdits: selection과 동일한 값
  → DraftDetailDialog: diffs 재계산 → 빈 배열
    → DraftDetailSections: hasStyleBlock=true, diffs.length===0 → 이미지 1장
  → submit: buildCtxForSubmit
    → isElementNoDiff=true → captureFiles에 screenshotImage로 beforeDataUrl 전달
    → buildCaptureFiles: captureMode="screenshot" → screenshot.webp 생성
    → ctx.captureMode="element" (환경 정보 유지), ctx.diffs=[]
    → 각 플랫폼 빌더: element 모드이나 diffs 빈 배열 → Media 섹션으로 이미지 삽입
```

### 스타일 변경 있는 element 모드 (기존, 변경 없음)

```
picking → styling → handleNext (동일)
  → drafting: diffs.length > 0 → "스타일 변경사항" 섹션 + StyleChangesTable
  → 이하 기존 흐름 그대로
```

## 인터페이스 설계

기존 타입/인터페이스 변경 없음. 새로운 타입 추가 없음.

유일한 시그니처 변경은 함수 내부의 분기 로직이며, 외부 인터페이스는 불변.

## 기존 패턴 준수

- **세션 영속화 패턴**: `confirmDraft`의 저장 로직 변경 없음. `styleEdits`/`selectionSnapshot`은 스타일 변경 유무와 무관하게 항상 저장.
- **미디어 섹션 위치**: `POST_MEDIA_SECTION_IDS` 기반 삽입 위치 로직 그대로. 키를 `"__media"`로 유지.
- **i18n**: 기존 `section.media` / `md.section.media` 키 재사용. 새 키 불필요.
- **이미지 표시 스타일**: screenshot 모드의 `aspect-video w-full overflow-hidden rounded-lg border bg-muted/70` + `h-full w-full object-contain` 그대로 사용.

## 대안 검토

### 대안 1: afterImage 캡처 스킵

스타일 변경 없으면 `handleNext`에서 `captureElementSnapshot`을 호출하지 않고 `afterImage`를 null로 두는 방안. beforeImage만 사용하므로 캡처 비용을 아낄 수 있다.

**불채택 사유**: `confirmDraft`의 blob 저장 로직이 `!!state.afterImage`로 분기하므로, afterImage가 null이면 `snapshot.after === false`로 저장된다. 이후 DraftDetailDialog에서 `hasStyleBlock` 계산이 `!!snapshot.after`를 포함하므로 분기가 복잡해진다. 현재 방식(afterImage는 캡처하되 제출 시 사용하지 않음)이 기존 코드 변경을 최소화한다.

### 대안 2: 새로운 captureMode 추가 (`"element-no-style"`)

별도 모드로 분리하면 분기가 깔끔해질 수 있지만, `CaptureMode` 유니온 타입을 확장하면 코드베이스 전체의 exhaustive switch/if 분기를 모두 수정해야 한다. `diffs.length`로 런타임 판별하는 것이 영향 범위가 훨씬 작다.

## 위험 요소

1. **빌더 분기 누락**: 5개 body 빌더(markdown, ADF, GitHub, Linear, Notion)에 모두 분기를 추가해야 함. 하나라도 빠지면 스타일 변경 없는 element 이슈의 body가 깨짐. → 각 빌더에 대한 테스트 케이스로 검증.
2. **buildCaptureFiles에 `captureMode: "screenshot"` 전달**: `ctx.captureMode`는 `"element"`인데 `captureFiles`의 `captureMode`만 `"screenshot"`으로 바꾸는 불일치. 현재 `buildCaptureFiles`는 파일명 결정에만 `captureMode`를 사용하므로 안전하지만, 향후 이 함수가 `captureMode`로 다른 결정을 하게 되면 영향받을 수 있음.
3. **buildStyleDiff의 빈 결과와 "변경 후 되돌림"**: 사용자가 스타일을 수정했다가 되돌리면 `diffs`가 빈 배열이 됨. 이 경우도 "스타일 변경 없음"으로 올바르게 처리됨 (의도한 동작).
