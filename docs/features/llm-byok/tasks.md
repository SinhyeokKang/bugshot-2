# LLM BYOK — 구현 태스크

## 선행 조건

- shadcn `Command` 컴포넌트 설치 여부 확인 (`src/components/ui/command.tsx`). 모델 콤보박스에 `Popover + Command` 패턴 사용. 없으면 `npx shadcn@latest add command` 실행.
- `src/components/ui/alert-dialog.tsx` 존재 확인 (IntegrationsTab에서 이미 사용 중이므로 있을 것).
- `src/components/ui/badge.tsx` 존재 확인 (GithubSummary에서 사용 중).

## 태스크

### Task 1: 스토어 확장 — `LlmConfig` 타입 + settings-ui-store 필드

- **변경 대상**: `src/store/settings-ui-store.ts`
- **작업 내용**:
  1. `LlmConfig` 인터페이스 정의 및 export (`baseUrl`, `apiKey`, `modelId`)
  2. `SettingsUiState`에 `llm: LlmConfig | null` 필드 추가 (초기값 `null`)
  3. `setLlm: (config: LlmConfig | null) => void` 액션 추가
  4. 스토어 버전 v2 → v3 bump. 마이그레이션: v2 데이터에 `llm` 없으면 `null` 세팅
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `LlmConfig` 타입이 정상 export 되는지 확인
  - [ ] 단위 테스트: `setLlm` 호출 시 상태 갱신, `null` 전달 시 초기화

### Task 2: AI 프로바이더 추상화 — `ai-provider.ts`

- **변경 대상**: 새 파일 `src/sidepanel/lib/ai-provider.ts`
- **작업 내용**:
  1. `AISession`, `AIProvider`, `ProviderKind`, `ProviderPreset`, `ModelEntry` 타입 정의 및 export
  2. `PROVIDER_PRESETS: ProviderPreset[]` — 7개 프리셋 (OpenAI, Anthropic, Gemini, Groq, Together, OpenRouter, Ollama). 각 항목에 `id`, `label`, `baseUrl`, `kind`
  3. `detectProviderKind(baseUrl: string): ProviderKind` — 프리셋 매칭 우선, 커스텀은 호스트네임 `api.anthropic.com` 체크 후 fallback `"openai"`
  4. `getProviderLabel(baseUrl: string): string` — 프리셋 매칭 → `label`, 없으면 `"Custom"`
  5. `createChromeAIProvider(): AIProvider` — 기존 `useChromeAI.ts`의 세션 생성/프롬프트 로직 이동
  6. `createOpenAICompatibleProvider(config: LlmConfig): AIProvider` — Chat Completions 호출 + 멀티턴 메시지 관리
  7. `createAnthropicProvider(config: LlmConfig): AIProvider` — Messages API 호출 + 시스템 프롬프트 분리 + 멀티턴
  8. `fetchModels(baseUrl, apiKey): Promise<ModelEntry[]>` — `/models` 엔드포인트 호출
  9. `ANTHROPIC_MODELS: ModelEntry[]` — 하드코딩 모델 목록
  10. `requestHostPermission(baseUrl): Promise<boolean>` — 동적 호스트 권한 요청
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 단위 테스트 `src/sidepanel/lib/__tests__/ai-provider.test.ts`:
    - `detectProviderKind` — 프리셋 URL 매칭 + 커스텀 anthropic URL + 커스텀 기타 URL
    - `getProviderLabel` — 프리셋 → 라벨, 커스텀 → `"Custom"`
    - OpenAI provider `callChatCompletions` — 메시지 구성, JSON mode 플래그, 응답 추출 (fetch를 vi.fn으로 모킹)
    - Anthropic provider `callMessages` — 헤더(`x-api-key`, `anthropic-version`), system 필드 분리, 응답 추출 (fetch 모킹)
    - 멀티턴 세션: 메시지 배열 누적 확인

### Task 3: `useAI` 훅

- **변경 대상**: 새 파일 `src/sidepanel/hooks/useAI.ts`
- **작업 내용**:
  1. settings-ui-store에서 `llm` 읽기
  2. `llm?.modelId` 존재 → `detectProviderKind` → 해당 프로바이더 생성, `status = "available"`
  3. `llm` 없거나 `modelId` 없음 → Chrome AI availability 체크 (기존 `useChromeAI.ts` 로직)
  4. `useMemo`로 provider 인스턴스 관리 (`llm` 변경 시 재생성)
  5. Chrome AI 세션 cleanup (`useEffect` return)
  6. `{ status, providerLabel, generate, createSession }` 반환. `providerLabel`은 BYOK 설정 시 `getProviderLabel(llm.baseUrl)`, 미설정 시 `null`
- **삭제 대상**: `src/sidepanel/hooks/useChromeAI.ts` (기능이 Task 2 + 3으로 이동)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 `useChromeAI` import가 없는지 grep 확인

### Task 4: manifest 변경

- **변경 대상**: `manifest.config.ts`
- **작업 내용**:
  1. `optional_host_permissions: ["https://*/*", "http://*/*"]` 추가
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 빌드 후 생성된 `manifest.json`에 `optional_host_permissions` 필드 존재 확인

### Task 5: i18n 키 추가

- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**:
  1. `settings.tab.issue`, `settings.tab.ai`, `settings.tab.general` 키 추가
  2. `llm.*` 네임스페이스 키 추가 (design.md의 i18n 키 섹션 참고)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] ko/en 양쪽 키가 1:1 대응

### Task 6: SettingsTab 하위 탭 분리

- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용**:
  1. IntegrationsTab과 동일한 `Tabs` > `TabsList`(grid-cols-3) > `TabsTrigger` > `TabsContent` 구조 도입
  2. `useState<"issue" | "ai" | "general">("issue")` — 기본 탭은 이슈 설정
  3. [이슈 설정] TabsContent: 기존 이슈 설정 Section(title prefix + issue composition)을 그대로 이동
  4. [AI 설정] TabsContent: `LlmConnectForm` 렌더 (Task 7에서 구현)
  5. [기타] TabsContent: 기존 언어 + 테마 Section 이동 + PageFooter(개인정보/리뷰/문의)
  6. 모든 TabsContent에 `data-[state=inactive]:hidden` 적용
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 설정 기능(title prefix, issue composition, theme, locale) 동작 확인 (수동)
  - [ ] 탭 전환 시 콘텐츠 정상 전환 확인 (수동)

### Task 7: LlmConnectForm + LlmConnectDialog

- **변경 대상**: 새 파일 `src/sidepanel/tabs/settings/LlmConnectForm.tsx`, `src/sidepanel/tabs/settings/LlmConnectDialog.tsx`
- **작업 내용**:

  **LlmConnectForm** (`GithubConnectForm` 패턴):
  1. `llm` 설정 읽기 → 미연결이면 `LlmOnboarding` 렌더
  2. `LlmOnboarding`: 중앙 정렬 EmptyState (Bot 아이콘 + 제목 + 설명 + "API 키 연결" 버튼 + Chrome AI fallback 안내)
  3. 연결됨 상태: `PageScroll` > `Section("연결 정보")` > Summary Card + `Section("모델")` > 모델 콤보박스
  4. Summary Card: 호스트네임 + 마스킹된 API 키 + 녹색 "연결됨" Badge (`GithubSummary`와 동일)
  5. 모델 콤보박스: `Popover + Command` 패턴. OpenAI → `fetchModels` 결과 사용, Anthropic → `ANTHROPIC_MODELS` 사용. 검색 + 자유 입력 허용.
  6. 모델 선택 시 `setLlm({ ...llm, modelId })` 호출
  7. `PageFooter`: "연결 해제" 버튼 → `AlertDialog` 확인 → `setLlm(null)`

  **LlmConnectDialog** (`PatDialog` 패턴):
  1. `Dialog` > `DialogContent` (w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6)
  2. **프로바이더 Combobox** (`Popover + Command`): `PROVIDER_PRESETS` 항목 + 마지막 "직접 입력" 옵션. 기본 선택 OpenAI. 프리셋 선택 시 `baseUrl` 자동 채움.
  3. **엔드포인트 URL Input**: "직접 입력" 선택 시에만 표시 (placeholder: `https://...`)
  4. **API Key Input** (autoComplete="off", spellCheck=false)
  5. "연결" 클릭:
     - `requestHostPermission(baseUrl)` → 실패 시 에러 Alert
     - `detectProviderKind(baseUrl)`:
       - `"openai"` → `fetchModels(baseUrl, apiKey)` → 실패 시 에러 Alert
       - `"anthropic"` → 검증 스킵
     - 성공: `setLlm({ baseUrl, apiKey, modelId: "" })` → 다이얼로그 닫기
  6. 로딩 상태: "연결" 버튼에 Loader2 스피너 (absolute overlay 패턴)
  7. 에러 표시: `Alert variant="destructive"` (기존 패턴)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 미연결 상태에서 EmptyState 정상 렌더 (수동)
  - [ ] 프로바이더 Combobox에서 프리셋 선택 시 base URL 자동 채움 (수동)
  - [ ] "직접 입력" 선택 시 URL Input 노출, 커스텀 URL 입력 가능 (수동)
  - [ ] 프로바이더 선택 + API key 입력 후 연결 동작 (수동, 실제 API 키 필요)
  - [ ] 연결 후 모델 콤보박스에서 모델 선택 동작 (수동)
  - [ ] 연결 해제 후 EmptyState 복귀 (수동)
  - [ ] Anthropic 프리셋 선택 시 즉시 연결 (모델 fetch 없이) (수동)

### Task 8: DraftingPanel 연동 + 배너 뱃지

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**:
  1. `import { useChromeAI }` → `import { useAI }` 교체
  2. `const { status: aiStatus, generateDraft } = useChromeAI()` → `const { status: aiStatus, providerLabel, generate } = useAI()`
  3. `handleAIDraft` 내부:
     - `const raw = await generateDraft(ctx, { responseSchema })` → `const raw = await generate({ prompt: ctx, responseSchema })`
  4. AI 배너 뱃지: `<Badge ...>Beta</Badge>` → `<Badge ...>{providerLabel ?? "Beta"}</Badge>`
  5. 나머지 로직(파싱, 에러 핸들링) 변경 없음
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] BYOK 설정 상태에서 배너 뱃지에 프로바이더명 표시 (수동)
  - [ ] BYOK 미설정 시 "Beta" 표시 (수동)
  - [ ] BYOK 설정 상태에서 AI Draft 동작 확인 (수동)
  - [ ] BYOK 미설정 + Chrome AI 가용 시 기존 동작 확인 (수동)
  - [ ] API 에러 시 에러 토스트 표시 확인 (수동)

### Task 9: AiStylingDialog 연동 + StyleEditorPanel 배너 뱃지

- **변경 대상**: `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`, `src/sidepanel/tabs/StyleEditorPanel.tsx`
- **작업 내용**:

  **AiStylingDialog**:
  1. `useAI()` import
  2. props 또는 훅에서 `{ createSession }` 가져오기
  3. `sessionRef` 타입을 `LanguageModelInstance | null` → `AISession | null`로 변경
  4. 세션 생성: `globalThis.LanguageModel.create({ systemPrompt })` → `createSession(systemPromptStr)` 사용
  5. 프롬프트 호출: `session.prompt(msg, { responseConstraint: schema })` → `session.prompt(msg, { responseSchema: schema })`
  6. cleanup: 기존 `session.destroy()` 호출 유지 (인터페이스 동일)
  7. `globalThis.LanguageModel` 직접 참조 모두 제거

  **StyleEditorPanel** (배너 뱃지):
  1. `useAI()` 훅에서 `providerLabel` 구독 (이미 `aiStatus`를 쓰고 있으므로 훅 호출은 DraftingPanel이 할 것 — StyleEditorPanel에서도 `useAI()` 호출 필요)
  2. AI Styling 배너: `<Badge ...>Beta</Badge>` → `<Badge ...>{providerLabel ?? "Beta"}</Badge>`
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] BYOK 설정 상태에서 Styling 배너에 프로바이더명 표시 (수동)
  - [ ] BYOK 미설정 시 "Beta" 표시 (수동)
  - [ ] BYOK 설정 상태에서 AI Styling 동작 확인 (수동, 요소 선택 후 스타일 변경 요청)
  - [ ] 멀티턴 동작 확인 (연속 스타일 요청) (수동)
  - [ ] BYOK 미설정 + Chrome AI 시 기존 동작 확인 (수동)

### Task 10: useChromeAI 삭제 + 정리

- **변경 대상**: `src/sidepanel/hooks/useChromeAI.ts` 삭제
- **작업 내용**:
  1. 파일 삭제
  2. 프로젝트 전체에서 `useChromeAI` import 잔존 여부 grep 확인
  3. `LanguageModelInstance` / `LanguageModel` 글로벌 타입 선언이 `ai-provider.ts`로 이동됐는지 확인
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `grep -r "useChromeAI" src/` 결과 0건
  - [ ] `pnpm test` 통과

## 테스트 계획

### 단위 테스트

| 파일 | 대상 | 케이스 |
|---|---|---|
| `src/sidepanel/lib/__tests__/ai-provider.test.ts` | `detectProviderKind` | 프리셋 URL → 해당 kind, 커스텀 anthropic → `"anthropic"`, 기타 → `"openai"` |
| 〃 | `getProviderLabel` | 프리셋 URL → 라벨 ("OpenAI", "Anthropic", "Gemini" 등), 커스텀 → `"Custom"` |
| 〃 | OpenAI provider | 메시지 구성, headers(Authorization), JSON mode, 응답 추출, 멀티턴 메시지 누적, HTTP 에러 throw |
| 〃 | Anthropic provider | 메시지 구성, headers(x-api-key, anthropic-version), system 분리, max_tokens, 응답 추출, 멀티턴, HTTP 에러 |
| 〃 | `fetchModels` | 정상 응답 파싱, 정렬, 에러 throw |
| `src/store/__tests__/settings-ui-store.test.ts` | `setLlm` | 설정/해제/갱신, v2→v3 마이그레이션 |

### 수동 테스트

- [ ] 설정 탭 하위 3탭 전환 + 기존 기능 동작 (title prefix, issue composition, theme, locale)
- [ ] 미연결 상태 EmptyState 렌더
- [ ] 프로바이더 Combobox에서 프리셋 선택 / 직접 입력 전환
- [ ] 다이얼로그 연결 흐름 (OpenAI 키)
- [ ] 다이얼로그 연결 흐름 (Anthropic 키)
- [ ] 다이얼로그 연결 흐름 (Gemini 키)
- [ ] 잘못된 키로 연결 시 에러 표시
- [ ] 연결 후 모델 콤보박스 동작 + 모델 선택
- [ ] AI Draft 배너 뱃지: BYOK 시 프로바이더명, 미설정 시 "Beta"
- [ ] AI Styling 배너 뱃지: 동일
- [ ] AI Draft 동작 (BYOK 설정 상태)
- [ ] AI Styling 동작 + 멀티턴 (BYOK 설정 상태)
- [ ] 연결 해제 후 Chrome AI 폴백 확인
- [ ] BYOK 미설정 시 기존 Chrome AI 동작 확인
- [ ] 확장 재시작 후 설정 영속 확인

## 구현 순서 권장

```
Task 1 (스토어)
  ↓
Task 2 (프로바이더 추상화)  ←  Task 5 (i18n) [병렬 가능]
  ↓
Task 3 (useAI 훅)  ←  Task 4 (manifest) [병렬 가능]
  ↓
Task 6 (SettingsTab 분리)
  ↓
Task 7 (LlmConnectForm + Dialog)
  ↓
Task 8 (DraftingPanel)  ←→  Task 9 (AiStylingDialog) [병렬 가능]
  ↓
Task 10 (useChromeAI 삭제)
```

Task 1 → 2 → 3은 순차 (타입 의존). Task 4 · 5는 2와 병렬 가능. Task 6은 UI 컨테이너이므로 7 전에 완료. Task 8 · 9는 독립적이라 병렬 가능. Task 10은 최종 정리.
