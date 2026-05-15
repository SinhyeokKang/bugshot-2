# WYSIWYG Editor for Issue Sections — 구현 태스크

## 선행 조건

- Node.js / pnpm 환경 정상 동작
- 기존 `pnpm test` / `pnpm typecheck` 통과 상태
- Tiptap 공식 문서 참조: https://tiptap.dev/docs

## 태스크

### ~~Task 1: 패키지 설치~~ ✅

- **변경 대상**: `package.json`
- **작업 내용**: Tiptap 관련 패키지 설치
  ```
  pnpm add @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image @tiptap/extension-placeholder @tiptap/pm tiptap-markdown markdown-it
  pnpm add -D @types/markdown-it
  ```
- **검증**:
  - [x] `pnpm install` 정상 완료
  - [x] `pnpm typecheck` 통과

### ~~Task 2: TiptapEditor 컴포넌트 생성~~ ✅

- **변경 대상**: `src/sidepanel/components/TiptapEditor.tsx` (신규), `src/sidepanel/components/tiptap-editor.css` (신규)
- **작업 내용**:
  - `TiptapEditorProps` 인터페이스: `{ value: string; onChange: (md: string) => void; placeholder?: string; className?: string; ariaLabel?: string }`
  - StarterKit (heading/codeBlock/blockquote 비활성) + Link + Image + Placeholder + Markdown 확장 구성
  - `onUpdate` → `editor.storage.markdown.getMarkdown()` → blob URL→`inline:refId` 후처리 → `onChange` 호출
  - 외부 `value` 변경 시 에디터 콘텐츠 동기화 (ref로 내부/외부 구분)
  - CSS: ProseMirror 콘텐츠 영역 스타일 (outline 제거, 리스트 패딩, 이미지 max-width, placeholder). 리스트 중첩은 2단까지 CSS indent 제한
  - 외관: shadcn/ui Textarea와 동일한 border/focus ring/text-sm 적용. `min-h-32`(128px) 최소 높이
  - 접근성: `EditorContent` wrapper에 `aria-label` 추가
  - ProseMirror 플러그인으로 이미지 drop/paste 처리 (Task 5b 통합)
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] Task 3에서 DraftingPanel 교체 후 확인

### ~~Task 3: DraftingPanel에서 Textarea 교체~~ ✅

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**:
  - `SectionTextarea`에서 `renderAs === "paragraph"` 분기의 `<Textarea>` → `<LazyTiptapEditor>` 교체
  - `React.lazy`로 lazy loading, `Suspense` fallback은 disabled Textarea
  - `onChange` 콜백 단순화: TiptapEditor가 마크다운 문자열 직접 반환
  - `cursorToEnd`는 다른 곳(Input)에서 사용 중이라 유지
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] Chrome에서 Side panel 열고 DraftingPanel 진입 → 에디터 정상 렌더링
  - [ ] 텍스트 입력 → `**bold**` 자동 변환 확인
  - [ ] `*italic*`, `` `code` ``, `~~strike~~` 자동 변환 확인
  - [ ] `- ` → bullet list, `1. ` → numbered list 변환 확인
  - [ ] AI 드래프트로 생성된 텍스트가 에디터에 정상 로드
  - [ ] AI 드래프트 적용 시 사용자가 타이핑 중이면 콘텐츠 충돌 없음 (ref 기반 내부/외부 구분 동작 확인)
  - [ ] AI 드래프트에 heading(#)/code block(```) 문법이 포함되어도 plain text로 안전하게 표시
  - [ ] 기존 plain text 데이터가 에디터에서 깨지지 않고 표시
  - [ ] 다크모드에서 에디터 배경/텍스트/placeholder 색상 정상

### ~~Task 4: blob-db inlineImages 스토어~~ ✅

- **변경 대상**: `src/store/blob-db.ts`
- **작업 내용**:
  - `DB_VERSION` 4 → 5
  - `STORE_INLINE_IMAGES = "inlineImages"` 상수 추가
  - `onupgradeneeded`에 `!db.objectStoreNames.contains(STORE_INLINE_IMAGES)` 가드 추가
  - CRUD 함수: `saveInlineImage`, `getInlineImage`, `deleteInlineImages`, `getInlineImageKeys`, `clearInlineImages`, `pruneOrphanInlineImages`
  - `db.onversionchange` 핸들러 추가 (동시 연결 충돌 방지)
  - `req.onblocked` 핸들러 추가
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] `pnpm test` 통과 (기존 테스트 영향 없음)
  - [ ] Chrome DevTools Application → IndexedDB → `bugshot-video` DB에 `inlineImages` 스토어 생성 확인

### ~~Task 5a: 이미지 compact 유틸~~ ✅

- **변경 대상**: `src/sidepanel/lib/compactImage.ts` (신규), `src/sidepanel/lib/__tests__/compactImage.test.ts` (신규)
- **작업 내용**:
  - `calcCompactDimensions(w, h, maxWidth=1280)`: 비율 유지 리사이즈 목표 치수 계산 (순수 함수)
  - `shouldCompact(w, h, mimeType)`: webp이면서 maxWidth 이하 → false, 그 외 → true (순수 함수)
  - `compactImage(blob)`: `createImageBitmap` → `OffscreenCanvas` 리사이즈 → `canvas.convertToBlob({ type: "image/webp", quality: 0.85 })` (브라우저 API)
- **검증**:
  - [x] `compactImage.test.ts` 단위 테스트 통과 (`calcCompactDimensions`, `shouldCompact` 순수 함수)
  - [x] `pnpm test` 통과

### ~~Task 5b: 이미지 드래그앤드롭/붙여넣기~~ ✅ (Task 2에 통합)

- **변경 대상**: `src/sidepanel/components/TiptapEditor.tsx`
- **작업 내용**: Task 2 TiptapEditor 컴포넌트에 ProseMirror 플러그인으로 통합 구현
  - `createImageDropPlugin`: `handleDrop`/`handlePaste` 인터셉트
  - 이미지 파일 감지 → `shouldCompact()` → `compactImage()` → webp 변환 + 리사이즈
  - `crypto.randomUUID().slice(0,8)` 기반 refId → `saveInlineImage()` → blob-db 저장
  - `URL.createObjectURL()` → Image 노드 삽입, `blobUrlToRefId` Map으로 blob URL↔refId 매핑
  - 마크다운 직렬화 후처리: blob URL → `inline:refId` 치환
  - 에디터 언마운트 시 `URL.revokeObjectURL()` 정리 (useEffect cleanup)
- **검증**:
  - [ ] 이미지 파일을 에디터로 드래그앤드롭 → 에디터 내 인라인 표시
  - [ ] Cmd+V로 클립보드 이미지 붙여넣기 → 에디터 내 인라인 표시
  - [ ] 큰 PNG(2560px) 드롭 → IndexedDB에 webp로 저장, 폭 1280px 이하 확인
  - [ ] 이미 작은 webp → compact 스킵 확인
  - [ ] DevTools IndexedDB → inlineImages에 blob 저장 확인
  - [ ] 에디터의 `onChange`로 전달되는 마크다운에 `![](inline:refId)` 형태 확인
  - [ ] 이슈 저장 후 DraftingPanel 재진입 시 이미지 정상 로드

### Task 6: DocSectionBody 마크다운 렌더링

- **변경 대상**: `src/sidepanel/components/DocSectionBody.tsx`
- **작업 내용**:
  - paragraph 섹션의 기존 `<div className="whitespace-pre-wrap">` → markdown-it 렌더링
  - `markdown-it` 인스턴스 생성: `{ html: false, breaks: true, linkify: true }` — `html: false`는 XSS 방지 핵심 설정
  - `linkify` 사용 시 `javascript:` 스킴 차단 설정 (`md.linkify.set({ fuzzyLink: false })` 또는 `validateURL` 커스텀)
  - `dangerouslySetInnerHTML={{ __html: md.render(value) }}` 사용
  - 인라인 이미지 (`inline:refId`) 참조를 blob: URL로 치환하는 전처리 (비동기 → useEffect + state)
  - CSS: `prose prose-sm` 또는 직접 스타일링 — 기존 `text-sm leading-relaxed`와 시각적 일관성 유지
- **검증**:
  - [ ] PreviewPanel에서 `**bold**` 마크다운이 실제 Bold로 렌더링
  - [ ] 리스트, 링크, 인라인 코드, 취소선 정상 렌더링
  - [ ] 인라인 이미지 정상 표시
  - [ ] IssueDetailDialog에서도 동일하게 렌더링
  - [ ] 빈 값 → "(없음)" 표시 유지
  - [ ] 기존 plain text 데이터가 자연스럽게 표시 (마크다운 구문 없으면 plain text 그대로)
  - [ ] XSS 벡터 테스트: `<script>alert(1)</script>`, `<img onerror=alert(1)>`, `[link](javascript:alert(1))` 입력 시 스크립트 실행 없음

### ~~Task 7: markdownToAdf 변환기~~ ✅

- **변경 대상**: `src/sidepanel/lib/markdownToAdf.ts` (신규)
- **작업 내용**:
  - `markdownToAdf(markdown: string): AdfNode[]` 구현 완료
  - markdown-it 파싱 → 토큰 순회 → ADF 노드 생성
  - 지원: paragraph, strong, em, code, strike, link, bulletList, orderedList, listItem, rule, hardBreak, image(텍스트 대체)
  - 빈 입력 → noValue paragraph
  - **`buildIssueAdf.ts` 교체는 아직 미적용** (Task 9에서 통합)
- **검증**:
  - [x] `markdownToAdf.test.ts` 단위 테스트 전체 통과 (12 케이스)
  - [x] `pnpm test` 통과
  - [ ] Chrome에서 Jira 이슈 제출 → 서식이 정확히 반영된 이슈 확인

### ~~Task 8: markdownToNotionBlocks 변환기~~ ✅

- **변경 대상**: `src/sidepanel/lib/markdownToNotionBlocks.ts` (신규), `src/types/notion.ts`, `src/background/notion-api.ts`
- **작업 내용**:
  - `NotionRichText` 인터페이스 + `NotionBlock` union에 `rich_paragraph`, `rich_bulleted_list_item`, `rich_numbered_list_item`, `divider` variant 추가
  - `markdownToNotionBlocks(markdown: string): NotionBlock[]` 구현 완료
  - `notion-api.ts`에 `expandRichText()` 헬퍼 + `rich_*` / `divider` 분기 추가 + `default: return null` 반환 타입 수정
  - **`buildNotionIssueBody.ts` 교체는 아직 미적용** (Task 9에서 통합)
- **검증**:
  - [x] `markdownToNotionBlocks.test.ts` 단위 테스트 전체 통과 (12 케이스)
  - [x] `pnpm test` 통과
  - [ ] Chrome에서 Notion 이슈 제출 → 서식이 정확히 반영된 페이지 확인

### Task 9: buildIssueHtml + GitHub/Linear 인라인 이미지

- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`, `src/sidepanel/lib/buildGithubIssueBody.ts`, `src/sidepanel/lib/buildLinearIssueBody.ts`
- **작업 내용**:
  - `buildIssueHtml` (같은 파일 내): paragraph 분기의 `paragraphize(content)` → `markdownIt.render(content)` 교체. `inline:refId` 참조는 data URL로 치환하여 클립보드 복사 시 이미지가 깨지지 않도록 처리
  - `buildIssueMarkdown`: paragraph 섹션은 마크다운 그대로 emit하므로 변경 불필요. 클립보드 복사 시 `inline:refId`를 data URL로 치환하는 전처리 추가
  - GitHub/Linear: paragraph 섹션 emit 시 `content`에 `inline:refId` 참조가 있으면 이미 해소된 URL로 치환된 상태여야 함 → `IssueCreateModal`에서 전처리 (Task 10a)
- **검증**:
  - [ ] `buildIssueHtml`로 생성된 HTML에서 `**bold**`가 `<strong>bold</strong>`로 변환 확인
  - [ ] 클립보드 복사(HTML) 시 인라인 이미지가 data URL `<img>`로 정상 출력
  - [ ] 클립보드 복사(마크다운) 시 인라인 이미지가 data URL `![](data:...)` 형태로 정상 출력
  - [ ] `pnpm typecheck` 통과
  - [ ] 마크다운 복사(클립보드) 시 서식 정상 반영

### ~~Task 10a: resolveInlineImages 유틸 구현 + 테스트~~ ✅

- **변경 대상**: `src/sidepanel/lib/resolveInlineImages.ts` (신규), `src/sidepanel/lib/__tests__/resolveInlineImages.test.ts` (신규)
- **작업 내용**:
  - `extractInlineRefs(markdown)`: 정규식으로 `inline:refId` 추출 (중복 제거)
  - `replaceInlineRefs(markdown, refToUrl)`: 순수 치환 함수
  - `resolveInlineImages(markdown)`: orchestrator — blob-db에서 로드 → data URL 변환 → 치환된 마크다운 + 이미지 목록 반환
- **검증**:
  - [x] `resolveInlineImages.test.ts` 단위 테스트 전체 통과 (9 케이스)
  - [x] `pnpm test` 통과

### Task 10b: IssueCreateModal/DraftDetailDialog 제출 흐름 통합

- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**:
  - `IssueCreateModal`: 제출 전 `draft.sections`의 각 paragraph 섹션에 대해 `resolveInlineImages()` 호출. 호출 위치는 `buildCtx()` 단계 통합 검토
  - 플랫폼별 이미지 처리:
    - GitHub: 해소된 data URL 이미지를 GitHub 파일 업로드 API로 업로드 → 반환된 URL로 마크다운 참조 치환
    - Linear: Linear 파일 업로드 API 활용 (기존 패턴 참조)
    - Jira: ADF 변환 전에 이미지를 첨부 파일로 업로드 → ADF에서 media 노드로 참조
    - Notion: 이미지를 NotionAttachmentInput으로 추가 → 기존 첨부 파일 업로드 흐름 활용
  - `DraftDetailDialog`: 저장된 드래프트 제출 시 동일 처리
  - 이슈 저장 시 `pruneOrphanInlineImages()` 호출하여 미참조 blob 정리
- **검증**:
  - [ ] Chrome에서 인라인 이미지가 포함된 이슈를 각 플랫폼에 제출 → 이미지 정상 표시
  - [ ] 이미지 삽입 → 삭제 → 다른 이미지 삽입 → 이슈 저장 시 orphan blob 정리 확인

### Task 11: 번들 최적화 + 정리

- **변경 대상**: `vite.config.ts` (필요 시), `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**:
  - TiptapEditor가 `React.lazy`로 로드되는지 확인
  - Vite `build.rollupOptions.output.manualChunks`에 tiptap/prosemirror 관련 패키지를 별도 청크로 분리 (필요 시)
  - 불필요한 import 정리
  - `pnpm build` 후 번들 크기 확인 (before/after 비교)
- **검증**:
  - [ ] `pnpm build` 성공
  - [ ] DraftingPanel 진입 전에는 Tiptap 청크가 로드되지 않음 (Network 탭 확인)
  - [ ] Tiptap/ProseMirror lazy 청크 크기 < 300KB gzipped
  - [ ] 초기 로드 번들 크기가 도입 전 대비 유의미하게 증가하지 않음

## 테스트 계획

### 단위 테스트

| 테스트 파일 | 대상 함수 | 주요 케이스 |
|---|---|---|
| `markdownToAdf.test.ts` | `markdownToAdf` | plain text, bold, italic, strike, code, link, bullet list, ordered list, horizontal rule, mixed marks, empty input, softbreak |
| `markdownToNotionBlocks.test.ts` | `markdownToNotionBlocks` | plain text, rich text annotations, lists, links, horizontal rule (divider), empty input |
| `resolveInlineImages.test.ts` | `extractInlineRefs`, `replaceInlineRefs` (순수 함수) | no references, single ref, multiple refs, 치환 정확성 |
| `compactImage.test.ts` | `calcCompactDimensions`, `shouldCompact` (순수 함수) | maxWidth 이하/초과, 비율 유지, 소수점 반올림, webp 스킵 판단 |

### 수동 테스트 체크리스트

- [ ] DraftingPanel에서 3개 paragraph 섹션 모두 WYSIWYG 에디터 렌더링
- [ ] 마크다운 자동 변환: `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `[text](url)`, `- `, `1. `
- [ ] 이미지 드래그앤드롭 → 에디터 내 인라인 표시 (webp 변환 + 리사이즈 확인)
- [ ] 이미지 Cmd+V 붙여넣기 → 에디터 내 인라인 표시 (webp 변환 + 리사이즈 확인)
- [ ] 이슈 저장 → 재진입 시 서식 + 이미지 유지
- [ ] PreviewPanel에서 마크다운 렌더링 정상
- [ ] IssueDetailDialog에서 마크다운 렌더링 정상
- [ ] AI 드래프트 → 에디터 로드 정상
- [ ] 기존 plain text 이슈 데이터 → 에디터에서 정상 표시
- [ ] Jira 제출 → ADF에 서식 반영
- [ ] GitHub 제출 → 마크다운 본문에 서식 + 이미지 URL
- [ ] Linear 제출 → 마크다운 본문에 서식
- [ ] Notion 제출 → 리치텍스트 블록 + 이미지
- [ ] Side panel 좁은 폭에서 에디터 UI 정상
- [ ] 다크모드에서 에디터 배경/텍스트/placeholder/선택 영역 색상 정상
- [ ] OrderedListEditor (재현 과정) 기존 동작 유지

## 구현 순서 권장

```
Task 1 (패키지 설치)
  ↓
Task 2 (TiptapEditor 컴포넌트) → Task 3 (DraftingPanel 교체)
  ↓
Task 4 (blob-db 확장) → Task 5a (compactImage 유틸) → Task 5b (이미지 드래그앤드롭)
  ↓                                                      ↓
Task 6 (DocSectionBody)   Task 7 (markdownToAdf)   Task 8 (markdownToNotionBlocks)
  ↓                        ↓                        ↓
Task 9 (buildIssueHtml)   ← Task 6과 병렬 가능 (markdown-it만 필요)
  ↓
Task 10a (resolveInlineImages 유틸) → Task 10b (제출 흐름 통합)
  ↓
Task 11 (번들 최적화)
```

- Task 2, 3은 순차 (에디터 먼저 만들고 교체)
- Task 4, 5a, 5b는 순차 (스토어 → compact 유틸 → 이미지 기능)
- Task 5a는 Task 4와 독립이지만 Task 5b 선행 필수
- Task 6, 7, 8, 9는 병렬 가능 (독립적인 변환기/빌더, markdown-it만 필요)
- Task 10a는 Task 5b 완료 후 (blob-db 의존)
- Task 10b는 Task 7, 8, 9, 10a 완료 후
- Task 11은 마지막
