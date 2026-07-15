# Repro Steps Prefill — 구현 태스크

## 선행 조건

- 새 권한·env·OAuth·외부 API **없음**. 기존 `useAI`/AI provider/액션 로그 인프라만 재사용.
- 대상 타입 확인: `ActionLog`/`ActionEntry`(`src/types/action.ts`), `CaptureMode`/`EditorDraft`(`src/store/editor-store.ts`), `IssueSectionId`/`LocaleMode`(`src/store/settings-ui-store.ts`), `ProviderCapabilities`/`AIProvider`(`src/sidepanel/lib/ai-provider.ts`).

## 태스크

### Task 1: 룰 기반 변환기 `buildReproSteps` (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/buildReproSteps.ts`(신규), `src/sidepanel/lib/__tests__/buildReproSteps.test.ts`(신규)
- **작업 내용**: `buildReproSteps(log: ActionLog): string`. design "룰 기반 변환 규칙"대로 — kind별 중립 서술 줄, keypress·초기 load 제외, 연속 input dedup, 연속 중복 병합, `MAX_STEPS`(≈15) 상한(초과 시 최근 우선), masked 값 `***` 유지. 출력은 `\n` 구분(번호 없음).
- **검증**:
  - [ ] navigation(load 제외) → `Go to <url>` 줄 생성
  - [ ] 같은 selector 연속 input이 마지막 값 한 줄로 dedup
  - [ ] keypress 엔트리가 결과에 없음
  - [ ] 20개 초과 로그가 `MAX_STEPS` 이하로 잘리고 최근 단계 우선
  - [ ] masked input 값이 `***`로 유지
  - [ ] `captured === 0`(빈 entries) → 빈 문자열
  - [ ] `pnpm test` 통과

### Task 2: AI 경로 오케스트레이션 `generateReproStepsWithAI` (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/generateReproPrefill.ts`(신규), `src/sidepanel/lib/__tests__/generateReproPrefill.test.ts`(신규)
- **작업 내용**: `generateReproStepsWithAI(input: ReproPrefillInput): Promise<string | null>`. `enabledSections=[{id:"stepsToReproduce"}]`, `buildAiDraftSchema(["stepsToReproduce"])`, `AiDraftSessionContext` 조립(userPrompt·existingDraft·이미지·diff 없음), `createSession`+`session.prompt({responseSchema})`, `parseAiDraftResponse(raw, ["stepsToReproduce"])` → `sections.stepsToReproduce`. title 무시. 빈 값/파싱실패/throw → `null`. `signal` 전달·abort 반영.
- **검증**:
  - [ ] fake provider(고정 JSON 반환)로 `stepsToReproduce`만 추출, title 무시 확인
  - [ ] 스키마 required가 `["title","stepsToReproduce"]`인지(`buildAiDraftSchema` 반환 검증)
  - [ ] 프롬프트에 stepsToReproduce 섹션 설명만 포함(다른 섹션 설명 부재)
  - [ ] provider throw 시 `null` 반환
  - [ ] 응답에 stepsToReproduce 빈 문자열 → `null` 반환
  - [ ] `pnpm test` 통과

### Task 3: 트리거 훅 `useReproPrefill`
- **변경 대상**: `src/sidepanel/hooks/useReproPrefill.ts`(신규)
- **작업 내용**: design "데이터 흐름"의 발화 판정·오케스트레이션을 useEffect로. `attemptedRef`(1회 가드), `cancelled` 플래그 + `AbortController`(언마운트 시 abort·setDraft 스킵). `aiStatus==="available"`이면 `generateReproStepsWithAI` → 실패 시 `buildReproSteps` 폴백, 아니면 즉시 `buildReproSteps`. 결과를 `setDraft`로 `sections.stepsToReproduce`만 병합.
- **검증**:
  - [ ] jsdom 컴포넌트 테스트(`useReproPrefill.test.tsx`) 또는 훅 래퍼로: 조건 만족 시 setDraft 1회 호출, stepsToReproduce 채워짐
  - [ ] `stepsToReproduce`에 기존 값 있으면 미발화
  - [ ] `captureMode !== "video"`면 미발화
  - [ ] `actionLog === null` 또는 `captured===0`이면 미발화
  - [ ] AI 실패 시 룰 폴백으로 채워짐
  - [ ] `pnpm test` 통과

### Task 4: `DraftingPanel` 배선 + 로딩 상태
- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`, `src/store/editor-store.ts`
- **작업 내용**: `editor-store`에 `reproPrefillLoading: boolean` + `setReproPrefillLoading`(`aiDraftLoading` 패턴 복제). `DraftingPanel`의 draft 시딩 useEffect(119-129행) 이후 `useReproPrefill({...})` 호출(이미 보유한 값 전달). `stepsToReproduce` `OrderedListEditor` 영역에 `reproPrefillLoading`이면 로딩 인디케이터(`Loader2`) 표시.
- **검증**:
  - [ ] video 캡처 후 drafting 진입 시 stepsToReproduce가 채워짐(수동/e2e)
  - [ ] AI 가용 프로필에서 로딩 인디케이터가 잠깐 뜬 뒤 채워짐
  - [ ] `pnpm typecheck` 통과

### Task 5: i18n (로딩·안내 문구)
- **변경 대상**: `src/i18n/namespaces/issue.ts`(또는 해당 네임스페이스), ko/en 동시
- **작업 내용**: 로딩 라벨(예: `repro.prefill.loading` "재현 단계 생성 중…" / "Generating steps…") 등 신규 문구가 필요하면 ko/en 양쪽 추가. PostToolUse 훅이 `locales.test.ts` 자동 실행 — 대칭 유지.
- **검증**:
  - [ ] ko/en 키 대칭, placeholder 토큰 일치(훅 자동 검사 통과)

## 테스트 계획

- **단위 테스트**:
  - `buildReproSteps.test.ts` — Task 1 검증 항목(kind 매핑, dedup, 상한, 마스킹, 빈 로그).
  - `generateReproPrefill.test.ts` — Task 2 검증 항목(섹션 좁힘, title 무시, 폴백 신호 `null`).
  - `useReproPrefill` 훅 테스트(가능하면 `.test.tsx`) — 발화 조건 매트릭스.
- **e2e 시나리오**(`/e2e-write` 입력):
  - "video 모드로 캡처하고 drafting에 진입하면, 액션 로그가 있을 때 stepsToReproduce 필드가 비어 있지 않다."
  - "stepsToReproduce에 이미 텍스트가 있으면 drafting 재진입 시 그 값이 유지된다(덮어쓰지 않음)."
  - (AI 프로필은 e2e에서 나노 부재 → 룰 경로가 기본 검증 대상. BYOK/나노 경로는 수동.)
- **수동 테스트**(Chrome):
  - 나노 있는 크롬에서 video 캡처 → AI 경로로 자연어 재현 단계 채움 확인.
  - BYOK 설정 후 video 캡처 → BYOK 자동 호출·채움 확인(네트워크 탭에서 1회 호출).
  - 30s Replay 트림 구간 변경 → 재트림된 로그로 채워지는지(stale 아님) 확인.
  - AI 강제 실패(잘못된 BYOK 키) → 룰 baseline 폴백 확인.

## 구현 순서 권장

Task 1·2는 독립 병렬 가능(순수 함수). Task 3은 1·2 완료 후. Task 4는 3 완료 후. Task 5는 4와 병행. 권장: **1‖2 → 3 → 4 → 5**.

## 가이드 영향

사용자 노출 UX 추가(재현 단계 자동 채움) → `/guide` 대상.
- `guide/ko`·`guide/en`의 video 녹화 / 리포트 작성 관련 페이지에 "재현 단계 자동 채움" 설명 추가(정확한 파일은 `guide/AUTHORING.md` IA 확인 후 결정 — 캡처·작성 흐름 페이지).
- **문서 영향(권한 아님)**: `docs/privacy.{ko,en}.md` — BYOK 자동 호출로 액션 로그가 **자동으로** 외부 LLM에 전송되는 동작 추가. manifest diff는 0이지만 기존 권한을 새 목적(자동 전송)으로 쓰므로 ko/en 본문+시행일 대조·갱신 필요. `/push` 전 처리.
- `CLAUDE.md`/`docs/DIRECTORY.md` — 신규 `src/sidepanel/lib/buildReproSteps.ts`·`generateReproPrefill.ts`·`src/sidepanel/hooks/useReproPrefill.ts` 추가 반영.
