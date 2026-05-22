# Element 모드: 스타일 수정 없이 이슈 작성 — 구현 태스크

## 선행 조건

- 없음. 외부 의존성·권한·환경 변수 추가 없음.

## 태스크

### Task 1: StyleEditorPanel — Next 버튼 활성화 조건 완화

- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`
- **작업 내용**: line 438의 `disabled={proceeding || !hasChange}`를 `disabled={proceeding}`으로 변경
- **검증**:
  - [ ] Element 선택 직후 styling 화면에서 아무 수정 없이 "Next" 버튼 활성 상태
  - [ ] 스타일 수정 시에도 "Next" 버튼 정상 작동 (기존 동작 유지)
  - [ ] proceeding 중에는 여전히 비활성

### Task 2: DraftingPanel — 미디어 섹션 분기

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**: lines 119-126의 element 모드 media block 렌더링 분기를 변경
  - `diffs.length > 0`: 기존 StyleChangesTable ("스타일 변경사항" 섹션)
  - `diffs.length === 0`: 이미지 1장 ("미디어" 섹션), screenshot 모드 이미지 표시와 동일한 스타일 (`aspect-video w-full overflow-hidden rounded-lg border bg-muted/70`)
  - 이미지 source: `beforeImage`
- **검증**:
  - [ ] 스타일 변경 없이 drafting 진입 시 "미디어" 섹션에 element 스냅샷 이미지 1장 표시
  - [ ] 스타일 변경 있을 때 기존 "스타일 변경사항" 섹션 + diff table 정상 표시
  - [ ] beforeImage가 null일 때 빈 섹션 (크래시 없음)

### Task 3: DraftDetailDialog — 저장된 draft 미디어 표시 분기

- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**: `DraftDetailSections` 컴포넌트(line 704-712)의 `hasStyleBlock` 분기를 세분화
  - `hasStyleBlock && diffs.length > 0`: 기존 StyleChangesTable
  - `hasStyleBlock && diffs.length === 0`: 이미지 1장 ("미디어" 섹션), `beforeUrl` 사용, `aspect-video w-full overflow-hidden rounded-md border bg-muted/70` 스타일 (기존 screenshot 모드 DraftDetailSections와 동일)
- **검증**:
  - [ ] 스타일 변경 없이 저장된 draft를 열면 "미디어" 섹션에 element 스냅샷 표시
  - [ ] 스타일 변경 있는 draft는 기존 StyleChangesTable 정상 표시

### Task 4: buildCtxForSubmit — 제출 시 captureFiles 분기

- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx` (`buildCtxForSubmit` 함수)
- **작업 내용**: `diffs.length === 0`인 element 모드에서 `buildCaptureFiles`에 `captureMode: "screenshot"`, `screenshotImage: beforeDataUrl`로 전달. `beforeImage`/`afterImage`는 null.
  - `ctx.captureMode`는 변경하지 않음 (`"element"` 유지) — 환경 정보(selector, tagName 등) 보존
  - 변수 `isElementNoDiff`로 분기: `!isScreenshot && !isVideo && !isFreeform && diffs.length === 0`
- **검증**:
  - [ ] 스타일 변경 없는 element 이슈 제출 시 `captureFiles.images`에 `screenshot.webp` 1개만 포함
  - [ ] 스타일 변경 있는 element 이슈 제출 시 `before.webp` + `after.webp` 포함 (기존 동작)
  - [ ] `ctx.captureMode`는 항상 `"element"`

### Task 4-1: IssueCreateModal — 라이브 제출 경로 captureFiles 분기

- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx` (`buildEditorCaptureFiles` 함수)
- **작업 내용**: Task 4와 동일한 `isElementNoDiff` 분기를 적용. `diffs.length === 0`인 element 모드에서 `buildCaptureFiles`에 `captureMode: "screenshot"`, `screenshotImage: beforeDataUrl`로 전달. `beforeImage`/`afterImage`는 null.
  - 이 경로는 DraftingPanel에서 바로 제출하는 "라이브 제출" 경로
  - 누락 시 body 빌더가 `screenshot.webp`를 찾지 못해 이미지 미포함
- **검증**:
  - [ ] 라이브 제출 경로에서 스타일 변경 없는 element 이슈 제출 시 `captureFiles.images`에 `screenshot.webp` 1개만 포함
  - [ ] 라이브 제출 경로에서 스타일 변경 있는 element 이슈 제출 시 `before.webp` + `after.webp` 포함 (기존 동작)

### Task 5: buildIssueMarkdown + buildIssueHtml — 클립보드 복사 및 HTML 미리보기 분기

- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`
- **작업 내용**:
  - `buildIssueMarkdown`: element 모드 분기(lines 99-112)에서 `ctx.diffs.length === 0`이면 "Media" 섹션 + `t("md.imageAttached")` 출력 (screenshot 모드와 동일). `ctx.diffs.length > 0`이면 기존 Style Changes table 유지.
  - `buildIssueHtml`: 동일 파일 내 함수(lines 192-204)에도 동일한 분기 추가. PreviewPanel HTML 미리보기 렌더에 사용됨.
- **검증**:
  - [ ] `buildIssueMarkdown` 단위 테스트: captureMode=element, diffs=[] → "Media" 섹션 출력
  - [ ] `buildIssueMarkdown` 단위 테스트: captureMode=element, diffs 비어있지 않음 → "Style Changes" 테이블 출력
  - [ ] `buildIssueHtml` 단위 테스트: captureMode=element, diffs=[] → "Media" 섹션 HTML 출력
  - [ ] `buildIssueHtml` 단위 테스트: captureMode=element, diffs 비어있지 않음 → "Style Changes" 테이블 HTML 출력

### Task 6: buildIssueAdf — Jira body 분기

- **변경 대상**: `src/sidepanel/lib/buildIssueAdf.ts`
- **작업 내용**: element 모드 else 절(lines 101-108)에서 `ctx.diffs.length === 0`이면 Media heading + `IMAGE_PLACEHOLDER` 출력 (screenshot 모드와 동일). `ctx.diffs.length > 0`이면 기존 table 유지.
- **검증**:
  - [ ] `buildIssueAdf` 단위 테스트: captureMode=element, diffs=[] → heading "Media" + IMAGE_PLACEHOLDER 노드
  - [ ] `buildIssueAdf` 단위 테스트: captureMode=element, diffs 존재 → 기존 table 노드

### Task 7: buildGithubIssueBody — GitHub body 분기

- **변경 대상**: `src/sidepanel/lib/buildGithubIssueBody.ts`
- **작업 내용**: element 모드 `isElement` 분기(lines 98-121) 안에서, `hasSnapshots === false && ctx.diffs.length === 0`일 때 `screenshot.webp` 이미지를 찾아 Media 섹션으로 출력.
- **검증**:
  - [ ] `buildGithubIssueBody` 단위 테스트: captureMode=element, diffs=[], images=[{filename:"screenshot.webp",url:"..."}] → "Media" 섹션 + 이미지 마크다운
  - [ ] 기존 테스트 통과 (스타일 변경 있는 element 케이스)

### Task 8: buildLinearIssueBody — Linear body 분기

- **변경 대상**: `src/sidepanel/lib/buildLinearIssueBody.ts`
- **작업 내용**: element 모드 else 절(lines 111-135) 안에서, before/after 이미지 없고 `ctx.diffs.length === 0`이면 `screenshot.webp`를 찾아 Media 섹션으로 출력.
- **검증**:
  - [ ] `buildLinearIssueBody` 단위 테스트: captureMode=element, diffs=[], images=[{filename:"screenshot.webp",assetUrl:"..."}] → "Media" 섹션 + 이미지 마크다운
  - [ ] 기존 테스트 통과

### Task 9: buildNotionIssueBody — Notion body 분기

- **변경 대상**: `src/sidepanel/lib/buildNotionIssueBody.ts`
- **작업 내용**: element 모드 else 절(lines 158-191) 안에서, before/after 이미지 없고 `ctx.diffs.length === 0`이면 screenshot 모드와 동일한 Media heading + image block. images에서 `screenshot.webp`를 찾아 placeholder 할당.
- **검증**:
  - [ ] `buildNotionIssueBody` 단위 테스트: captureMode=element, diffs=[], images=[{filename:"screenshot.webp",...}] → heading_2 "Media" + image block
  - [ ] 기존 테스트 통과

## 테스트 계획

### 단위 테스트

| 대상 함수 | 테스트 파일 | 추가 케이스 |
|---|---|---|
| `buildIssueMarkdown` | `src/sidepanel/lib/__tests__/buildIssueMarkdown.test.ts` | element + diffs=[] → Media 섹션 |
| `buildIssueHtml` | `src/sidepanel/lib/__tests__/buildIssueMarkdown.test.ts` | element + diffs=[] → Media 섹션 HTML |
| `buildIssueAdf` | `src/sidepanel/lib/__tests__/buildIssueAdf.test.ts` | element + diffs=[] → Media heading + IMAGE_PLACEHOLDER |
| `buildGithubIssueBody` | `src/sidepanel/lib/__tests__/buildGithubIssueBody.test.ts` | element + diffs=[] + screenshot.webp → Media 섹션 |
| `buildLinearIssueBody` | `src/sidepanel/lib/__tests__/buildLinearIssueBody.test.ts` | element + diffs=[] + screenshot.webp → Media 섹션 |
| `buildNotionIssueBody` | `src/sidepanel/lib/__tests__/buildNotionIssueBody.test.ts` | element + diffs=[] + screenshot.webp → Media heading + image |
| `buildCaptureFiles` | `src/sidepanel/lib/__tests__/buildCaptureFiles.test.ts` | element + diffs=0 + captureMode="screenshot" → screenshot.webp 1개 |

### 수동 테스트 (Chrome에서 확인)

- [ ] Element 선택 → 스타일 수정 없이 Next → drafting에 "미디어" 섹션 + 스냅샷 이미지 표시
- [ ] 위 이슈를 각 플랫폼에 제출 → body에 Media 섹션 + 이미지 정상 포함
- [ ] Element 선택 → 스타일 수정 → Next → 기존 "스타일 변경사항" + diff table 정상 (회귀 없음)
- [ ] 위 이슈를 각 플랫폼에 제출 → 기존 style changes table 형식 유지 (회귀 없음)
- [ ] 스타일 수정 후 되돌림(원래 값으로) → Next → "미디어" 섹션 (diff 없음 처리)
- [ ] 저장된 draft(스타일 변경 없음)를 DraftDetailDialog에서 열기 → "미디어" 섹션 + 이미지
- [ ] 클립보드 복사 → 마크다운에 "Media" 섹션 포함
- [ ] AI 드래프트: element 모드 + diffs=0 상태에서 AI가 생성한 본문과 미디어 섹션의 정합성 확인

## 구현 순서 권장

```
Task 1 (StyleEditorPanel) → Task 2 (DraftingPanel) → Task 3 (DraftDetailDialog 미디어)
                                                       ↓
                                                    Task 4 (buildCtxForSubmit)
                                                    Task 4-1 (IssueCreateModal)
                                                       ↓
                              Task 5~9 (빌더 6개) — 병렬 가능
```

Task 1~3은 순차 (UI 흐름을 따라 검증). Task 4 + 4-1은 Task 3 이후 (두 제출 경로 모두 수정). Task 5~9는 서로 독립적이므로 병렬 구현 가능.

> **참고**: 라인 번호는 작성 시점 기준이며, 앞선 태스크의 변경으로 밀릴 수 있다. 구현 시 파일명과 함수명 기준으로 탐색할 것.
