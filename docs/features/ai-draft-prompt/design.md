# AI 드래프트 버그 설명 프롬프트 — 기술 설계

## 개요

AiStylingDialog와 동일한 UI/UX 패턴의 `AiDraftDialog`를 만들어 스크린샷·비디오 모드에서 사용자의 버그 설명을 입력받는다. `AIProvider`/`AISession` 인터페이스에 `images` 파라미터를 추가해 멀티모달을 지원하고, 세션 기반 멀티턴 대화로 초안을 반복 개선할 수 있게 한다.

## 변경 범위

### 새 파일

| 파일 | 역할 |
|------|------|
| `src/sidepanel/tabs/AiDraftDialog.tsx` | 버그 설명 프롬프트 다이얼로그. AiStylingDialog와 동일한 구조. |

### 변경 파일

| 파일 | 현재 역할 | 변경 내용 |
|------|-----------|-----------|
| `src/sidepanel/lib/ai-provider.ts` | AI 프로바이더 팩토리 (Chrome AI / OpenAI-compatible / Anthropic) | `generate()`와 `AISession.prompt()`에 `images?: string[]` 파라미터 추가. 각 프로바이더 구현에서 이미지를 content block으로 변환. |
| `src/sidepanel/lib/buildAiDraftPrompt.ts` | 단일 프롬프트 빌더 | `buildAiDraftSessionPrompt()` 함수 추가 (세션용 시스템 프롬프트). 기존 `buildAiDraftPrompt()`는 요소 모드용으로 유지. |
| `src/sidepanel/tabs/DraftingPanel.tsx` | 초안 작성 UI | 스크린샷 모드 AI 버튼 숨김 조건 제거. 스크린샷·비디오 모드에서 AI 버튼 클릭 시 `AiDraftDialog` 열기. 로딩 shimmer 오버레이 추가. |
| `src/sidepanel/hooks/useAI.ts` | AI 상태 + generate/createSession 노출 | 인터페이스 변경에 따른 타입 반영 (실제 로직 변경 없음, 프로바이더가 처리). |
| `src/store/editor-store.ts` | 에디터 전역 상태 | `aiDraftLoading: boolean` 상태 추가 (shimmer 오버레이용). |
| `src/i18n/ko.ts` | 한국어 번역 | `aiDraft.*` 키 추가 |
| `src/i18n/en.ts` | 영어 번역 | `aiDraft.*` 키 추가 |

## 데이터 흐름

### 스크린샷 모드 흐름

```
[DraftingPanel]
  ├── AI 버튼 클릭
  └── AiDraftDialog open
        ├── 사용자 입력: "로그인 버튼 클릭 시 반응 없음"
        ├── 제출 → 다이얼로그 닫힘
        ├── store.aiDraftLoading = true
        ├── (첫 제출) createSession(systemPrompt) → sessionRef
        │     systemPrompt = buildAiDraftSessionPrompt({
        │       captureMode: "screenshot",
        │       locale, url, pageTitle, enabledSections
        │     })
        ├── session.prompt(userDescription, {
        │     responseSchema: buildAiDraftSchema(sectionIds),
        │     images: [screenshotImage]  ← 첫 메시지에만 이미지 포함
        │   })
        ├── parseAiDraftResponse(raw, sectionIds)
        ├── store.setDraft(parsed)
        └── store.aiDraftLoading = false
```

### 비디오 모드 흐름

```
[DraftingPanel]
  ├── AI 버튼 클릭
  └── AiDraftDialog open
        ├── 사용자 입력: "결제 버튼 클릭 후 500 에러"
        ├── 제출 → 다이얼로그 닫힘
        ├── store.aiDraftLoading = true
        ├── createSession(systemPrompt) → sessionRef
        │     systemPrompt = buildAiDraftSessionPrompt({
        │       captureMode: "video",
        │       locale, url, pageTitle, enabledSections,
        │       networkLogSummary, consoleLogSummary  ← 비디오 모드 전용
        │     })
        ├── session.prompt(userDescription, {
        │     responseSchema: buildAiDraftSchema(sectionIds)
        │     // images 없음 — 비디오 썸네일 전송 안 함
        │   })
        ├── parseAiDraftResponse(raw, sectionIds)
        ├── store.setDraft(parsed)
        └── store.aiDraftLoading = false
```

### 멀티턴 (2회차 이후)

```
[AiDraftDialog 재오픈]
  ├── 사용자 입력: "재현 단계를 더 구체적으로 써줘"
  ├── 제출
  ├── sessionRef 재사용 (세션 유지)
  ├── session.prompt(followUpMessage, { responseSchema })
  │   // images 없음 — 첫 메시지에서만 이미지 전송
  ├── parseAiDraftResponse → store.setDraft
  └── 반복 가능
```

## 인터페이스 설계

### AIProvider / AISession 확장

```typescript
// ai-provider.ts

export interface AIProvider {
  generate(params: {
    systemPrompt?: string;
    prompt: string;
    images?: string[];  // ← 추가: data URL (e.g. "data:image/png;base64,...")
    responseSchema?: Record<string, unknown>;
  }): Promise<string>;

  createSession(systemPrompt: string): Promise<AISession>;
}

export interface AISession {
  prompt(
    input: string,
    options?: {
      responseSchema?: Record<string, unknown>;
      images?: string[];  // ← 추가
    },
  ): Promise<string>;
  destroy(): void;
}
```

### 프로바이더별 이미지 처리

**OpenAI-compatible** (`createOpenAICompatibleProvider`):
```typescript
// images가 있으면 content를 배열로 구성
const content = images?.length
  ? [
      ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      { type: "text" as const, text: input },
    ]
  : input;

messages.push({ role: "user", content });
```

**Anthropic** (`createAnthropicProvider`):
```typescript
// data URL에서 media_type + base64 추출
const content = images?.length
  ? [
      ...images.map((dataUrl) => {
        const [meta, data] = dataUrl.split(",");
        const mediaType = meta.match(/data:(.*?);/)?.[1] ?? "image/png";
        return {
          type: "image" as const,
          source: { type: "base64" as const, media_type: mediaType, data },
        };
      }),
      { type: "text" as const, text: input },
    ]
  : input;

messages.push({ role: "user", content });
```

**Chrome AI** (`createChromeAIProvider`):
- `images` 파라미터 무시 (현재 LanguageModel API는 텍스트 전용)
- 텍스트 프롬프트만 전달

### buildAiDraftSessionPrompt

```typescript
// buildAiDraftPrompt.ts에 추가

export interface AiDraftSessionContext {
  captureMode: "screenshot" | "video";  // element 제외
  locale: LocaleMode;
  url: string;
  pageTitle: string;
  networkLogSummary?: NetworkLogSummary;   // video 모드 전용
  consoleLogSummary?: ConsoleLogSummary;   // video 모드 전용
  enabledSections: { id: IssueSectionId; renderAs: IssueSectionRenderAs }[];
}

export function buildAiDraftSessionPrompt(ctx: AiDraftSessionContext): string
```

시스템 프롬프트 내용 (기존 `buildAiDraftPrompt`와 유사하되 구조 변경):
- 역할 정의: QA assistant, 버그 리포트 작성
- 언어 지시: locale에 따라 Korean / English
- 페이지 컨텍스트: URL, 페이지 제목, 캡처 모드
- 비디오 모드 한정: 네트워크/콘솔 에러 요약
- 출력 포맷: JSON with title + enabled sections (기존과 동일한 섹션 설명)
- 규칙: 사용자의 설명과 제공된 컨텍스트(이미지 포함)에 기반해 작성, 사실을 날조하지 않음
- **사용자 설명은 시스템 프롬프트에 포함하지 않음** — 세션의 user 메시지로 전달

### AiDraftDialog 컴포넌트

```typescript
// AiDraftDialog.tsx

interface AiDraftDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  createSession: AIProvider["createSession"];
}
```

내부 구조:
- `input` 상태 (textarea 값)
- `sessionRef` (AISession 유지)
- `handleSubmit()`: 세션 생성/재사용 → 프롬프트 전송 → 응답 파싱 → store.setDraft
- UI: AiStylingDialog와 동일 (Dialog + Textarea + Cancel/Submit 버튼)
- 다이얼로그 제출 시 즉시 닫힘 → DraftingPanel에 shimmer 오버레이

### 에디터 스토어 확장

```typescript
// editor-store.ts에 추가
aiDraftLoading: boolean;
setAiDraftLoading: (loading: boolean) => void;
```

### i18n 키

```typescript
// 추가할 키
"aiDraft.title": "AI 초안 작성" / "AI Draft"
"aiDraft.placeholder": "버그를 간단히 설명해주세요..." / "Briefly describe the bug..."
"aiDraft.generate": "초안 작성" / "Generate"
"aiDraft.disclaimer": "AI는 실수할 수 있습니다. 생성된 초안을 확인해주세요." / "AI can make mistakes. Please review the generated draft."
```

## 기존 패턴 준수

- **세션 영속화**: AiStylingDialog와 동일한 `useRef<AISession>` 패턴으로 세션 유지. 컴포넌트 unmount 시 `session.destroy()` 호출.
- **메시지 비동기 응답 패턴**: 해당 없음 (background script 미사용, side panel 내 직접 API 호출).
- **i18n 동시 갱신**: ko.ts / en.ts 양쪽에 키 추가.
- **에러 처리**: `LlmQuotaError` → `t("llm.error.quota")`, 일반 에러 → `t("draft.aiError")`, 파싱 실패 → `t("draft.aiParseError")`. 기존 에러 메시지 키 재사용.
- **타이틀 프리픽스**: `parseAiDraftResponse` 후 `defaultTitle(titlePrefix)` 적용 (기존 handleAIDraft 로직과 동일).
- **shimmer 오버레이**: AiStylingDialog가 `aiStylingLoading`으로 StyleEditorPanel에 shimmer를 보여주는 것과 동일하게, `aiDraftLoading`으로 DraftingPanel에 shimmer 표시.

## 대안 검토

### 대안 1: `generate()` 단일 호출 + userDescription 파라미터

`buildAiDraftPrompt`에 `userDescription` 필드를 추가하고 기존 `generate()` 원샷 호출을 유지하는 방안.

**기각 이유**: 사용자가 "멀티턴 대화"를 명시적으로 요구. AiStylingDialog와 동일한 세션 기반 패턴이 UX 일관성과 초안 개선 가능성 측면에서 적합.

### 대안 2: 이미지를 시스템 프롬프트에 포함

시스템 프롬프트 빌더에서 이미지를 base64 텍스트로 직접 포함하는 방안.

**기각 이유**: 시스템 프롬프트는 텍스트 전용이 표준. 멀티모달 콘텐츠는 user 메시지에 포함하는 것이 API 스펙에 부합. 또한 멀티턴 시 매 턴마다 이미지가 시스템 프롬프트에 중복 포함되는 비효율 발생.

## 위험 요소

1. **이미지 크기**: 스크린샷 data URL이 수 MB일 수 있음. API 요청 크기 제한에 걸릴 수 있으나, 일반적인 스크린샷은 문제 없을 것으로 판단. 필요 시 리사이즈 로직 추가 가능하나 이번 스코프에서는 제외.
2. **Chrome AI 멀티모달 미지원**: Chrome AI 사용 시 이미지가 무시되므로 스크린샷 모드에서 AI 품질이 다소 떨어질 수 있음. 사용자 설명 텍스트가 이를 보완.
3. **비디오 모드 동작 변경**: 기존에는 AI 버튼 클릭 시 즉시 생성됐으나, 이제 다이얼로그가 먼저 열림. 한 단계 추가되지만 초안 품질 향상이 이를 상쇄.
4. **세션 수명**: 다이얼로그를 열고 닫을 때마다 세션이 유지되므로, 사용자가 모드를 전환하거나 새 캡처를 시작하면 세션을 초기화해야 함. `reset()` 시점에 세션 정리 필요 — 이는 AiDraftDialog의 unmount cleanup으로 자연스럽게 해결됨 (모드 전환 시 DraftingPanel이 unmount).
