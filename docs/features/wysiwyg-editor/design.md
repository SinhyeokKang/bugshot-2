# WYSIWYG Editor for Issue Sections — 기술 설계

## 개요

`renderAs: "paragraph"` 섹션(description, expectedResult, notes)의 `<Textarea>`를 Tiptap 기반 WYSIWYG 에디터로 교체한다. 저장 포맷은 마크다운 문자열을 유지하므로 `EditorDraft.sections: Record<string, string>` 타입은 변경하지 않는다. 마크다운 ↔ Tiptap JSON 직렬화는 `tiptap-markdown` 패키지가 담당하고, 이미지는 기존 blob-db 패턴을 따라 IndexedDB에 저장한다.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|------|------|
| `src/sidepanel/components/TiptapEditor.tsx` | Tiptap 에디터 React 컴포넌트 (마크다운 InputRules + 이미지 드래그앤드롭/붙여넣기) |
| `src/sidepanel/components/tiptap-editor.css` | ProseMirror 콘텐츠 영역 스타일 (placeholder, 리스트, 이미지) |
| `src/sidepanel/lib/markdownToAdf.ts` | 마크다운 → Jira ADF 노드 변환기 |
| `src/sidepanel/lib/markdownToNotionBlocks.ts` | 마크다운 → Notion Block API 변환기 |
| `src/sidepanel/lib/resolveInlineImages.ts` | `inline:refId` 참조 → data URL 해소 유틸 |
| `src/sidepanel/lib/compactImage.ts` | 이미지 webp 변환 + 리사이즈 (max-width 1280px) |
| `src/sidepanel/lib/__tests__/markdownToAdf.test.ts` | ADF 변환기 단위 테스트 |
| `src/sidepanel/lib/__tests__/markdownToNotionBlocks.test.ts` | Notion 변환기 단위 테스트 |
| `src/sidepanel/lib/__tests__/resolveInlineImages.test.ts` | 이미지 해소 유틸 테스트 |
| `src/sidepanel/lib/__tests__/compactImage.test.ts` | 이미지 compact 순수 함수 테스트 |

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `package.json` | Tiptap 패키지 추가 |
| `src/sidepanel/tabs/DraftingPanel.tsx` | `SectionTextarea`의 `<Textarea>` → `<TiptapEditor>` 교체 (renderAs="paragraph" 분기) |
| `src/sidepanel/components/DocSectionBody.tsx` | paragraph 섹션의 `whitespace-pre-wrap` → markdown-it 렌더링 (`html: false` 필수, `javascript:` 스킴 차단) |
| `src/sidepanel/lib/buildIssueAdf.ts` | paragraph 섹션에서 `textBlock(raw)` → `markdownToAdf(raw)` 호출 |
| `src/sidepanel/lib/buildNotionIssueBody.ts` | paragraph 섹션에서 plain text → `markdownToNotionBlocks(raw)` 호출 |
| `src/sidepanel/lib/buildIssueMarkdown.ts` | `buildIssueHtml`(같은 파일 내)의 `paragraphize()` → `markdownIt.render()` 교체. `buildIssueMarkdown` 자체는 paragraph를 이미 pass-through하므로 변경 불필요. 클립보드 복사 시 `inline:refId`를 data URL로 치환하는 전처리 추가 |
| `src/sidepanel/lib/buildGithubIssueBody.ts` | paragraph 섹션 emit 전 인라인 이미지 참조 해소 |
| `src/sidepanel/lib/buildLinearIssueBody.ts` | paragraph 섹션 emit 전 인라인 이미지 참조 해소 |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | 제출 흐름에 `resolveInlineImages()` 단계 추가 |
| `src/sidepanel/tabs/DraftDetailDialog.tsx` | 저장된 드래프트 제출 시 동일 이미지 해소 |
| `src/sidepanel/tabs/PreviewPanel.tsx` | DocSectionBody의 마크다운 렌더링 활용 (변경 없을 수 있음 — DocSectionBody 변경으로 자동 반영) |
| `src/store/blob-db.ts` | `inlineImages` 오브젝트 스토어 추가, DB_VERSION 4→5, CRUD 함수 추가 |
| `src/types/notion.ts` | `NotionBlock` union에 리치텍스트 지원 variant 추가 |
| `src/background/notion-api.ts` | 블록→Notion API 변환에서 리치텍스트 어노테이션 처리 |
| `src/styles/globals.css` | ProseMirror 기본 스타일 (또는 별도 css 파일) |

## 데이터 흐름

```
[편집]
DraftingPanel
  └─ SectionTextarea (renderAs="paragraph")
     └─ TiptapEditor (value=markdown, onChange=markdown)
        ├─ 로드: markdown → tiptap-markdown → Tiptap JSON (editor state)
        ├─ 편집: 사용자 입력 + InputRules 자동변환
        ├─ 저장: Tiptap JSON → tiptap-markdown → markdown string
        └─ 이미지: drop/paste → blob-db 저장 → editor에 blob: URL 표시
                   markdown 직렬화 시 → ![](inline:refId) 형태

[저장]
EditorDraft.sections["description"] = "**볼드** 텍스트\n\n![](inline:abc123)"
  ↓ chrome.storage (session)

[프리뷰]
DocSectionBody
  └─ markdown-it.render(value) → dangerouslySetInnerHTML

[제출]
IssueCreateModal
  ├─ resolveInlineImages(sections) → inline:refId를 data URL로 변환
  ├─ GitHub/Linear: 이미지 업로드 → URL로 치환 → buildGithubIssueBody / buildLinearIssueBody (마크다운 그대로 emit)
  ├─ Jira: markdownToAdf(content) → ADF 노드로 변환 → buildIssueAdf
  └─ Notion: markdownToNotionBlocks(content) → Notion blocks로 변환 → buildNotionIssueBody
```

## 인터페이스 설계

### TiptapEditor 컴포넌트

```typescript
// src/sidepanel/components/TiptapEditor.tsx
interface TiptapEditorProps {
  value: string;                    // 마크다운 문자열
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
}
```

- 초기화: `value` 마크다운을 `tiptap-markdown`으로 파싱해 에디터에 로드
- 변경: `editor.on('update')` → `editor.storage.markdown.getMarkdown()` → `onChange` 호출
- 외부 값 변경 (AI 드래프트 등): `value` prop 변경 감지 → 에디터 콘텐츠 갱신. 내부/외부 변경 구분을 위해 ref 사용
- 이미지: 커스텀 플러그인으로 `handleDrop`/`handlePaste` 인터셉트
- 외관: shadcn/ui Textarea와 동일한 border/focus ring/text-sm. `min-h-32`(128px) 최소 높이 적용 (`[field-sizing:content]`는 contentEditable div에서 미작동 — ProseMirror 자체 높이 확장에 의존)
- 접근성: `EditorContent` wrapper에 `aria-label={sectionLabel}` 추가하여 스크린리더 지원
- 리스트 중첩: 2단까지 허용 (side panel ~400px 폭 제약). StarterKit의 `listItem` 확장에 중첩 깊이를 제한하거나 CSS로 indent 상한 적용

### Tiptap 확장 구성

```typescript
const extensions = [
  StarterKit.configure({
    heading: false,        // 섹션 내 헤딩 비활성화
    codeBlock: false,      // 코드 블록 비활성화
    blockquote: false,     // 버그 리포트 섹션에서 불필요
  }),
  Link.configure({
    openOnClick: false,    // side panel에서 링크 클릭 시 이동 방지
    autolink: true,        // URL 자동 감지
  }),
  Image,                   // 인라인 이미지
  Placeholder.configure({
    placeholder: props.placeholder,
  }),
  Markdown.configure({
    html: false,           // HTML 태그 비활성화
    breaks: true,          // 줄바꿈 보존
    transformPastedText: true,
    transformCopiedText: true,
  }),
];
```

### 마크다운 지원 범위

**인라인 마크** (문자 단위 서식):
- `**text**` → Bold
- `*text*` → Italic
- `` `text` `` → Code
- `~~text~~` → Strike
- `[text](url)` → Link (커스텀 InputRule)
- 텍스트 선택 후 URL 붙여넣기 → 선택 텍스트에 링크 적용 (Link 확장 built-in)

**블록 레벨** (줄/단락 단위):
- `- ` / `* ` → Bullet list
- `1. ` → Ordered list
- `---` → Horizontal rule
- `![alt](src)` → Image (인라인 이미지)

**명시적 제외** (StarterKit에서 비활성화):
- Heading (`#`): 섹션 헤딩은 시스템이 관리
- Code block (`` ``` ``): 버그 리포트 섹션에서 불필요
- Blockquote (`>`): 버그 리포트 섹션에서 불필요

모든 변환기(`markdownToAdf`, `markdownToNotionBlocks`)와 렌더러(`DocSectionBody`)는 위 범위만 매핑한다.

### blob-db 확장

```typescript
// src/store/blob-db.ts 추가
const STORE_INLINE_IMAGES = "inlineImages";

// DB_VERSION 4 → 5
// onupgradeneeded에 inlineImages store 생성 추가
// db.onversionchange = () => { db.close(); dbPromise = null; } 핸들러 추가
// req.onblocked 핸들러 추가 (동시 연결 충돌 방지)

export async function saveInlineImage(refId: string, blob: Blob): Promise<boolean>;
export async function getInlineImage(refId: string): Promise<Blob | null>;
export async function deleteInlineImages(refIds: string[]): Promise<void>;
export async function getInlineImageKeys(): Promise<string[]>;
export async function pruneOrphanInlineImages(activeRefIds: string[]): Promise<void>;
// pruneOrphanInlineImages: 현재 sections의 inline:refId 목록과 비교하여 미참조 blob 정리
```

키 형식: `inline-{crypto.randomUUID().slice(0,8)}` (예: `inline-a1b2c3d4`)

### 인라인 이미지 마크다운 참조

```
![](inline:a1b2c3d4)
```

- 에디터 내: `src`를 `URL.createObjectURL(blob)`로 표시, `title` 또는 커스텀 attribute에 `refId` 저장
- 마크다운 직렬화: `tiptap-markdown`이 `![alt](src)` 형태로 출력 → 후처리로 blob: URL을 `inline:refId`로 치환
- 마크다운 파싱(로드): 전처리로 `inline:refId`를 blob-db에서 로드한 blob: URL로 치환

### compactImage

```typescript
// src/sidepanel/lib/compactImage.ts
const COMPACT_MAX_WIDTH = 1280;

export function calcCompactDimensions(
  w: number, h: number, maxWidth?: number,
): { width: number; height: number };

export function shouldCompact(
  w: number, h: number, mimeType: string,
): boolean;

export async function compactImage(blob: Blob): Promise<Blob>;
```

- `calcCompactDimensions`: maxWidth(기본 1280px) 초과 시 비율 유지 축소 치수 계산. 이하면 원본 치수 반환. 소수점은 `Math.round()`.
- `shouldCompact`: webp이면서 maxWidth 이하 → `false` (불필요), 그 외 → `true` (형식 변환 또는 리사이즈 필요).
- `compactImage`: `createImageBitmap` → `OffscreenCanvas` 리사이즈 → `canvas.convertToBlob({ type: "image/webp", quality: 0.85 })`. 브라우저 API 의존이므로 단위 테스트 대상이 아님 — 위 두 순수 함수만 TDD.
- 호출 위치: TiptapEditor의 이미지 드래그앤드롭/붙여넣기 플러그인에서 blob-db 저장 직전

### resolveInlineImages

```typescript
// src/sidepanel/lib/resolveInlineImages.ts
interface ResolvedImage {
  refId: string;
  dataUrl: string;
  blob: Blob;
}

export async function resolveInlineImages(
  markdown: string
): Promise<{ resolved: string; images: ResolvedImage[] }>;
```

- `![...](inline:XYZ)` 패턴을 정규식으로 찾아 blob-db에서 로드
- `blobToDataUrl()`로 변환
- 반환: 인라인 참조가 data URL로 치환된 마크다운 + 이미지 목록
- 정규식 파싱 로직(`extractInlineRefs`, `replaceInlineRefs`)은 순수 함수로 분리하여 단위 테스트 가능하게 구성. blob-db I/O는 통합 흐름(수동 테스트)으로 커버
- 호출 위치: `IssueCreateModal`/`DraftDetailDialog`의 submit 핸들러에서 호출. `buildCtx()` 단계에 통합하는 것이 더 깔끔할 수 있으므로 구현 시 재검토

### markdownToAdf

```typescript
// src/sidepanel/lib/markdownToAdf.ts
import type { AdfNode } from "./buildIssueAdf";

export function markdownToAdf(markdown: string): AdfNode[];
```

- `markdown-it` (tiptap-markdown의 의존성으로 이미 번들에 포함)로 파싱 → 토큰 배열
- 토큰을 순회하며 ADF 노드 생성:
  - `paragraph_open/close` → `{ type: "paragraph" }`
  - `inline` 토큰의 children → 인라인 마크(`strong`, `em`, `code`, `s`, `link`) 적용된 `text` 노드
  - `bullet_list_open/close` → `{ type: "bulletList" }`
  - `ordered_list_open/close` → `{ type: "orderedList" }`
  - `list_item_open/close` → `{ type: "listItem" }`
  - `hr` → `{ type: "rule" }`
  - `image` → 이미지는 ADF에서 별도 처리 (첨부 파일 참조 또는 mediaGroup)
- 빈 입력 → `[paragraph([textNode(t("md.noValue"))])]` (기존 textBlock 동작 유지)

### markdownToNotionBlocks

```typescript
// src/sidepanel/lib/markdownToNotionBlocks.ts
import type { NotionBlock } from "@/types/notion";

export function markdownToNotionBlocks(markdown: string): NotionBlock[];
```

- `markdown-it`로 파싱 → 토큰 배열
- Notion Block API 형식으로 변환:
  - paragraph → `{ type: "paragraph", richText: [...] }`
  - bullet list → `{ type: "bulleted_list_item", richText: [...] }`
  - ordered list → `{ type: "numbered_list_item", richText: [...] }`
  - 인라인 서식 → `richText` 배열의 `annotations` (bold, italic, strikethrough, code) 
  - 링크 → `richText[].text.link`
  - horizontal rule → `{ type: "divider" }` (Notion divider block)
  - 이미지 → `{ type: "image", ... }` (외부 URL 형태)
- 빈 입력 → `[{ type: "paragraph", text: t("md.noValue") }]`

### NotionBlock 타입 확장

```typescript
// src/types/notion.ts — 기존 union에 추가
export interface NotionRichText {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
}

// NotionBlock union 확장
| { type: "rich_paragraph"; richText: NotionRichText[] }
| { type: "rich_bulleted_list_item"; richText: NotionRichText[] }
| { type: "numbered_list_item"; text: string }
| { type: "rich_numbered_list_item"; richText: NotionRichText[] }
| { type: "divider" }
```

기존 `{ type: "paragraph"; text: string }` 등은 유지하여 하위 호환. `notion-api.ts`에서 `rich_*` variant를 Notion API 포맷으로 변환하는 분기 추가.

## 기존 패턴 준수

- **blob-db 패턴**: 기존 video/image/network/console 스토어와 동일한 CRUD 함수 시그니처 (`save*/get*/delete*/getKeys*/clear*`)
- **섹션 데이터 모델**: `EditorDraft.sections: Record<string, string>` 타입 유지. 마크다운은 string이므로 변경 없음.
- **빌드 함수 패턴**: `ctx.sectionConfig` iterate + `section.renderAs` 분기 패턴 유지
- **i18n**: 에디터 관련 새 문자열이 필요하면 기존 ko.ts/en.ts 패턴 따름
- **lazy loading**: `React.lazy(() => import(...))` 패턴 — 기존 코드에 유사 패턴 있으면 참조
- **컴포넌트 스타일**: shadcn/ui Textarea와 시각적으로 동일한 외관 (border, focus ring, text-sm)

## 대안 검토

### Lexical (Meta) — 채택하지 않음

- 경량이고 접근성 우수하나, 마크다운 직렬화 생태계가 Tiptap보다 빈약
- `lexical-markdown` 패키지가 있지만 양방향 변환 안정성이 `tiptap-markdown`보다 낮음
- 확장 생태계(Extension)가 Tiptap/ProseMirror에 비해 좁아 향후 기능 확장 시 제약

### 저장 포맷: HTML — 채택하지 않음

- Tiptap 에디터의 자연스러운 출력이 HTML이라 변환 단계가 줄어들지만:
  - 기존 plain text 데이터와 호환성 문제 (마이그레이션 필요)
  - GitHub/Linear는 마크다운을 받으므로 HTML→마크다운 역변환 필요
  - 마크다운은 plain text 상위 호환이라 마이그레이션 불필요

### 저장 포맷: Tiptap JSON — 채택하지 않음

- 데이터 충실도 최고지만:
  - 기존 plain text 데이터 전체 마이그레이션 필요
  - 빌드 함수 전면 재작성 필요
  - chrome.storage 용량 비효율적

## 위험 요소

1. **번들 크기**: Tiptap + ProseMirror + markdown-it ≈ +95KB gzipped. `React.lazy` lazy loading으로 DraftingPanel 진입 시점까지 로드를 지연시켜 초기 로드 영향 최소화. Vite `manualChunks`로 별도 청크 분리 고려.

2. **마크다운 라운드트립 손실**: markdown → Tiptap JSON → markdown 변환 과정에서 공백, 개행 등 미세한 차이 발생 가능. 지원 범위(bold/italic/strike/code/link/list/image)에서는 안정적이나, 사용자가 직접 입력한 비표준 마크다운(참조 링크, 중첩 blockquote 등)은 변환 시 손실될 수 있다. 지원하지 않는 구문은 plain text로 유지되므로 데이터 손실은 없다.

3. **Chrome Extension CSP**: ProseMirror/Tiptap은 인라인 스크립트나 eval을 사용하지 않아 MV3 기본 CSP(`script-src 'self'`)와 호환. 인라인 스타일은 MV3에서 허용되므로 문제 없음.

4. **ADF 변환 복잡도**: Jira ADF는 규격이 까다롭다. 특히 중첩 리스트, 혼합 인라인 마크가 ADF에서 정확히 표현되는지 충분한 테스트 필요. 초기 구현은 1단계 리스트 + 단일 인라인 마크만 지원하고, 중첩/혼합은 점진적으로 개선.

5. **IndexedDB 버전 업**: DB_VERSION 4→5 업그레이드 시 기존 4개 스토어 유지 + inlineImages만 추가. 기존 `onupgradeneeded` 핸들러가 `!db.objectStoreNames.contains()` 가드를 사용하므로 안전.

6. **Object URL 누수**: 에디터 마운트 시 blob-db에서 로드한 이미지의 `URL.createObjectURL()` 결과를 에디터 언마운트 시 `URL.revokeObjectURL()`로 정리해야 한다. 정리 누락 시 메모리 누수.

7. **Side panel 폭 제약**: ~400px 폭에서 이미지가 과도하게 크지 않도록 `max-width: 100%` + 적절한 패딩 적용. 리스트 들여쓰기도 좁은 폭에서 자연스러운지 확인 필요.

8. **Notion 리치텍스트 확장**: 기존 `NotionBlock`이 `{ type: "paragraph"; text: string }` 형태라 `notion-api.ts`의 블록→API 변환 코드에 리치텍스트 분기를 추가해야 한다. 기존 plain text 블록과의 하위 호환 유지 필수.

9. **XSS 보안 (DocSectionBody)**: `markdown-it.render()` 결과를 `dangerouslySetInnerHTML`로 주입한다. `markdown-it` 인스턴스 생성 시 반드시 `{ html: false }` 설정하고, `linkify` 옵션 사용 시 `javascript:` 스킴을 차단해야 한다. 수동 테스트에 XSS 벡터(`<script>`, `<img onerror>`, `[link](javascript:alert(1))`) 검증 포함.
