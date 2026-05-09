# AI 드래프트 버그 설명 프롬프트 — 구현 태스크

## 선행 조건

- LLM 설정(BYOK)이 완료된 상태에서 테스트 가능 (Chrome AI 또는 커스텀 LLM)
- shadcn Dialog, Textarea, Button 컴포넌트 이미 설치됨 (AiStylingDialog에서 사용 중)

## 태스크

### Task 1: AIProvider/AISession 인터페이스에 `images` 파라미터 추가

- **변경 대상**: `src/sidepanel/lib/ai-provider.ts`
- **작업 내용**:
  1. `AIProvider.generate()` 파라미터에 `images?: string[]` 추가
  2. `AISession.prompt()` options에 `images?: string[]` 추가
  3. `createOpenAICompatibleProvider`:
     - `callChatCompletions()` 메시지 구성 시 images가 있으면 content를 `[{ type: "image_url", image_url: { url } }, { type: "text", text }]` 배열로 변환
     - `generate()` 및 세션 `prompt()`에 images 전달
  4. `createAnthropicProvider`:
     - `callMessages()` 메시지 구성 시 images가 있으면 content를 `[{ type: "image", source: { type: "base64", media_type, data } }, { type: "text", text }]` 배열로 변환
     - data URL에서 media_type과 base64 데이터 분리
     - `generate()` 및 세션 `prompt()`에 images 전달
  5. `createChromeAIProvider`: images 파라미터 무시 (기존 동작 유지)
- **검증**:
  - [ ] 기존 텍스트 전용 호출 (images 미전달)이 정상 동작
  - [ ] images를 전달할 때 OpenAI-compatible 프로바이더가 올바른 content 배열 구성
  - [ ] images를 전달할 때 Anthropic 프로바이더가 올바른 content 배열 구성
  - [ ] Chrome AI에서 images 전달해도 에러 없이 동작 (무시)
  - [ ] 세션 기반 멀티턴에서 첫 메시지에 images, 후속 메시지에 images 없이 정상 동작

### Task 2: `buildAiDraftSessionPrompt()` 함수 추가

- **변경 대상**: `src/sidepanel/lib/buildAiDraftPrompt.ts`
- **작업 내용**:
  1. `AiDraftSessionContext` 인터페이스 정의: `captureMode: "screenshot" | "video"`, `locale`, `url`, `pageTitle`, `networkLogSummary?`, `consoleLogSummary?`, `enabledSections`
  2. `buildAiDraftSessionPrompt(ctx: AiDraftSessionContext): string` 함수 구현
     - 기존 `buildAiDraftPrompt`의 프롬프트 구조를 기반으로 하되, 세션의 system prompt로 사용하기 적합한 형태
     - 역할 정의, 언어 지시, 페이지 컨텍스트, 비디오 에러 로그(있으면), 출력 포맷 + 섹션 설명, 규칙
     - 사용자 설명은 포함하지 않음 (user 메시지로 전달)
     - 스크린샷 모드: "사용자가 제공한 스크린샷 이미지와 설명을 참고하라"는 지시 포함
- **검증**:
  - [ ] screenshot 모드: URL, 페이지 제목, 이미지 참조 지시 포함
  - [ ] video 모드: URL, 페이지 제목 포함. 에러 로그 있으면 포함, 없으면 생략
  - [ ] enabledSections에 따라 출력 포맷 섹션 설명이 달라짐
  - [ ] locale에 따라 언어 지시가 달라짐
  - [ ] 사용자 설명 텍스트가 시스템 프롬프트에 포함되지 않음

### Task 3: 에디터 스토어에 `aiDraftLoading` 추가

- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  1. `aiDraftLoading: boolean` 상태 추가 (초기값 `false`)
  2. `setAiDraftLoading(loading: boolean)` setter 추가
  3. `reset()` 시 `aiDraftLoading: false`로 초기화
- **검증**:
  - [ ] 초기값 `false`
  - [ ] setter로 값 변경 가능
  - [ ] `reset()` 호출 시 `false`로 복원

### Task 4: `AiDraftDialog` 컴포넌트 구현

- **변경 대상**: 신규 `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**:
  1. AiStylingDialog의 구조를 복제하여 AiDraftDialog 구현
     - Props: `open`, `onOpenChange`, `createSession`
     - Dialog + DialogContent + DialogHeader + DialogTitle + Textarea + DialogFooter + Button(Cancel/Submit)
     - 스타일: AiStylingDialog와 동일 (`w-[80vw] max-w-[80vw] rounded-3xl gap-5 p-6`)
  2. 내부 상태:
     - `input: string` (textarea 값)
     - `sessionRef: useRef<AISession>` (세션 유지)
     - `isFirstMessage: useRef<boolean>` (첫 메시지 여부 — 이미지 포함 판단용)
  3. `handleSubmit()` 구현:
     - 다이얼로그 닫기 → `store.setAiDraftLoading(true)`
     - 첫 메시지: `createSession(buildAiDraftSessionPrompt(ctx))` → `sessionRef`에 저장
     - `session.prompt(userDescription, { responseSchema, images })`:
       - screenshot 모드 + 첫 메시지: `images: [screenshotImage]`
       - 그 외: images 없음
     - `parseAiDraftResponse(raw, sectionIds)` → titlePrefix 적용 → `store.setDraft(parsed)`
     - 에러 처리: LlmQuotaError / 파싱 실패 / 일반 에러 → 기존 에러 키 재사용
     - finally: `store.setAiDraftLoading(false)`
  4. IME 처리: `e.nativeEvent.isComposing` 체크 (AiStylingDialog와 동일)
  5. Cleanup: unmount 시 `sessionRef.current?.destroy()` 호출
- **검증**:
  - [ ] 다이얼로그 열고 닫기 (취소 시 아무 동작 없음)
  - [ ] 빈 입력 시 제출 버튼 비활성화
  - [ ] Enter로 제출, Shift+Enter로 줄바꿈
  - [ ] 스크린샷 모드: 첫 제출 시 이미지 포함, 이후 메시지는 이미지 없음
  - [ ] 비디오 모드: 이미지 전송 없음
  - [ ] 멀티턴: 세션 유지 상태에서 추가 지시 → 초안 갱신
  - [ ] 응답이 title + 각 섹션에 채워짐
  - [ ] titlePrefix가 적용됨
  - [ ] 에러 시 토스트 노출, 세션 유지
  - [ ] 모드 전환(unmount) 시 세션 정리

### Task 5: DraftingPanel에 AiDraftDialog 통합

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**:
  1. AI 버튼의 `captureMode !== "screenshot"` 조건 제거 → 모든 모드에서 AI 버튼 노출
  2. 로컬 상태 추가: `aiDialogOpen: boolean`
  3. AI 버튼 클릭 핸들러 분기:
     - `captureMode === "element"`: 기존 `handleAIDraft()` 즉시 호출 (변경 없음)
     - `captureMode === "screenshot" | "video"`: `setAiDialogOpen(true)` → AiDraftDialog 열기
  4. `AiDraftDialog` 렌더링: `<AiDraftDialog open={aiDialogOpen} onOpenChange={setAiDialogOpen} createSession={createSession} />`
     - `useAI()`에서 `createSession`도 가져오기 (현재는 `generate`만 사용 중)
  5. shimmer 오버레이 추가: `store.aiDraftLoading`이 true일 때 DraftingPanel에 AiStylingLoading과 동일한 backdrop-blur + shimmer 렌더링
  6. AI 버튼 disabled 조건: `aiLoading || aiDraftLoading` (둘 중 하나라도 로딩 중이면 비활성화)
- **검증**:
  - [ ] 요소 모드: AI 버튼 클릭 → 즉시 생성 (기존 동작 유지)
  - [ ] 스크린샷 모드: AI 버튼 노출 + 클릭 → 다이얼로그 열림
  - [ ] 비디오 모드: AI 버튼 클릭 → 다이얼로그 열림 (기존: 즉시 생성)
  - [ ] 로딩 중 shimmer 오버레이 표시
  - [ ] 로딩 중 AI 버튼 비활성화

### Task 6: i18n 키 추가

- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**:
  ```typescript
  "aiDraft.title": "AI 초안 작성" / "AI Draft"
  "aiDraft.placeholder": "버그를 간단히 설명해주세요..." / "Briefly describe the bug..."
  "aiDraft.generate": "초안 작성" / "Generate"
  "aiDraft.disclaimer": "AI는 실수할 수 있습니다. 생성된 초안을 확인해주세요." / "AI can make mistakes. Please review the generated draft."
  ```
- **검증**:
  - [ ] ko, en 양쪽에 키 존재
  - [ ] 다이얼로그 UI에서 locale에 따라 올바른 텍스트 표시

## 테스트 계획

### 단위 테스트

- `src/sidepanel/lib/__tests__/buildAiDraftPrompt.test.ts`에 추가:
  - `buildAiDraftSessionPrompt` 테스트 스위트:
    - screenshot 모드: URL, 페이지 제목, 이미지 참조 지시 포함 확인
    - video 모드: URL, 페이지 제목 포함 확인
    - video 모드 + 에러 로그: 에러 요약 포함 확인
    - video 모드 + 에러 로그 없음: 에러 관련 텍스트 미포함 확인
    - locale별 언어 지시 확인
    - enabledSections 반영 확인
    - 사용자 설명 텍스트 미포함 확인

### 수동 테스트

- [ ] LLM 설정 완료 상태에서 스크린샷 캡처 → AI 버튼 → 다이얼로그 → 설명 입력 → 초안 생성 확인
- [ ] 생성된 초안에서 AI 버튼 재클릭 → 추가 지시 → 초안 갱신 확인
- [ ] 다이얼로그 취소 → 아무 동작 없음 확인
- [ ] 비디오 녹화 → AI 버튼 → 다이얼로그 → 초안 생성 확인
- [ ] 요소 모드 → AI 버튼 → 다이얼로그 없이 즉시 생성 확인 (기존 동작)
- [ ] LLM 미설정 상태 → AI 버튼 미노출 확인
- [ ] API 에러 발생 시 에러 토스트 확인
- [ ] 한/영 전환 후 다이얼로그 텍스트 확인

## 구현 순서 권장

```
Task 1 (ai-provider 인터페이스)  ─┐
Task 2 (buildAiDraftSessionPrompt) ─┤── 병렬 가능
Task 3 (에디터 스토어)             ─┤
Task 6 (i18n)                      ─┘
          │
          ▼
Task 4 (AiDraftDialog) ← Task 1~3, 6에 의존
          │
          ▼
Task 5 (DraftingPanel 통합) ← Task 4에 의존
```

Task 1, 2, 3, 6은 서로 독립적이므로 병렬 작업 가능. Task 4는 이들 모두를 사용하므로 이후에 진행. Task 5는 Task 4의 컴포넌트를 통합하므로 마지막.
