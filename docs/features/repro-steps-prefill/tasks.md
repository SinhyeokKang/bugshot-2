# Repro Steps Prefill — 구현 태스크

## 선행 조건

- 새 권한·env·OAuth·외부 API **없음**. 기존 `useAI`/AI provider/액션 로그 인프라만 재사용.
- 대상 타입 확인: `ActionLog`/`ActionEntry`(`src/types/action.ts`), `CaptureMode`/`EditorDraft`/`EditorSnapshot`(`src/store/editor-store.ts`), `IssueSectionId`/`LocaleMode`(`src/store/settings-ui-store.ts`), `ProviderCapabilities`/`AIProvider`(`src/sidepanel/lib/ai-provider.ts`).
- `OrderedListEditor`의 `value.split(/\r?\n/)` "한 줄=한 단계" 계약 1줄 확인(`buildReproSteps` 출력 근거).

## 태스크

### Task 1: 룰 기반 변환기 `buildReproSteps` (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/buildReproSteps.ts`(신규), `src/sidepanel/lib/__tests__/buildReproSteps.test.ts`(신규)
- **작업 내용**: `buildReproSteps(log: ActionLog): string`. design "룰 기반 변환 규칙"대로 — kind별 중립 서술 줄, keypress·초기 load 제외, 연속 input dedup, 연속 중복 병합, `MAX_STEPS`(≈15) 상한(초과 시 최근 우선), masked 값 `***` 유지. 출력은 `\n` 구분(번호 없음). **필터 후 0줄이면 빈 문자열**.
- **검증**:
  - [x] navigation(load 제외) → `Go to <url>` 줄 생성
  - [x] 같은 selector 연속 input이 마지막 값 한 줄로 dedup
  - [x] keypress 엔트리가 결과에 없음
  - [x] 20개 초과 로그가 `MAX_STEPS` 이하로 잘리고 최근 단계 우선
  - [x] masked input 값이 `***`로 유지
  - [x] `captured === 0`(빈 entries) → 빈 문자열
  - [x] **`captured > 0`이나 전부 keypress/load라 필터 후 0줄 → 빈 문자열**
  - [x] `pnpm test` 통과

### Task 2: AI 경로 오케스트레이션 `generateReproStepsWithAI` (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/generateReproPrefill.ts`(신규), `src/sidepanel/lib/__tests__/generateReproPrefill.test.ts`(신규)
- **작업 내용**: `generateReproStepsWithAI(input): Promise<ReproPrefillResult>`. `enabledSections=[{id:"stepsToReproduce"}]`, `buildAiDraftSchema(["stepsToReproduce"])`, `AiDraftSessionContext` 조립(userPrompt·existingDraft·이미지·diff 없음), **`getDraftFewShot` 재사용해 `createSession(sys, fewShot)`**, `session.prompt({responseSchema, signal})`, `parseAiDraftResponse(raw, ["stepsToReproduce"])` → `sections.stepsToReproduce`. title 무시. 성공=`{ok:true,steps}`, 빈 값/파싱실패=`{ok:false,reason:"other"}`, provider throw는 quota/auth/other로 분류. `signal` 전달·abort 반영.
- **검증**:
  - [x] fake provider(고정 JSON 반환)로 `stepsToReproduce`만 추출, title 무시 확인
  - [x] 스키마 required가 `["title","stepsToReproduce"]`인지(`buildAiDraftSchema` 반환 검증)
  - [x] 프롬프트에 stepsToReproduce 섹션 설명만 포함(다른 섹션 설명 부재) + **few-shot 주입 확인**
  - [x] provider throw(quota) → `{ok:false, reason:"quota"}`, auth 오류 → `reason:"auth"` (LlmAuthError 신설)
  - [x] 응답에 stepsToReproduce 빈 문자열 → `{ok:false, reason:"other"}`
  - [x] `pnpm test` 통과

### Task 3: 트리거 훅 `useReproPrefill` (테스트 우선)
- **변경 대상**: `src/sidepanel/hooks/useReproPrefill.ts`(신규), `src/sidepanel/hooks/__tests__/useReproPrefill.test.tsx`(신규)
- **작업 내용**: design "데이터 흐름"의 발화 판정·오케스트레이션을 useEffect로. 발화 조건 전부(autoReproPrefill / captureMode video / !trimming / sectionEnabled / supportsActionLog / captured>0 / steps 비어있음 / `aiStatus!=="checking"` / `reproPrefillDone===false`). 발화 시 `setReproPrefillDone(true)` 먼저, `aiStatus==="available"`이면 로컬 `setLoading(true)` → `generateReproStepsWithAI` → 성공 steps, quota/auth면 룰 폴백+토스트, other면 조용한 룰 폴백 → `setLoading(false)`. `unavailable`이면 즉시 룰. 결과 `steps.trim()` 있고 `!cancelled`일 때만 `setDraft`. `AbortController` + `cancelled` cleanup. `aiStatus`를 의존성에 포함. 반환 `{ loading }`.
- **검증**:
  - [x] 조건 만족(unavailable) 시 setDraft 1회, stepsToReproduce 채워짐
  - [x] `stepsToReproduce`에 기존 값 있으면 미발화
  - [x] `captureMode !== "video"`면 미발화
  - [x] `actionLog === null` 또는 `captured===0`이면 미발화
  - [x] **`aiStatus==="checking"`이면 보류, `available`로 바뀌면 그때 AI 발화**(레이스 방지)
  - [x] **`reproPrefillDone===true`면 미발화**(재개·삭제 후 부활 방지)
  - [x] **`autoReproPrefill===false`면 미발화**
  - [x] **`sectionEnabled===false`면 미발화**
  - [x] **`trimming===true`면 미발화**
  - [x] AI 실패(other) 시 룰 폴백으로 채워짐 / quota·auth 시 토스트 호출
  - [x] **룰/AI 결과 공백이면 `setDraft` 미호출**(빈 값 주입·재시도 루프 방지)
  - [x] **AI in-flight 중 언마운트 → 응답 도착해도 `setDraft` 미호출**(abort/cancelled)
  - [x] **AI in-flight 중 무관한 편집(제목 등)이 취소·유실 유발 안 함**(deps 원시화+ref 병합 회귀 가드)
  - [x] `pnpm test` 통과

### Task 4: store·설정 상태 추가
- **변경 대상**: `src/store/editor-store.ts`, `src/store/settings-ui-store.ts`
- **작업 내용**: editor-store에 `reproPrefillDone: boolean` + `setReproPrefillDone`, **`EditorSnapshot`(persist)에 포함**, `reset`/새 캡처 진입 시 false 초기화. settings-ui-store에 `autoReproPrefill: boolean`(기본 true) + `setAutoReproPrefill`(persist).
- **검증**:
  - [x] `reproPrefillDone`이 snapshot 직렬화/복원에 포함됨(hydrate 후 유지) — EditorSnapshot Pick + snapshotFromState
  - [x] 새 캡처 세션 진입 시 false로 리셋 — `...initial` 스프레드
  - [x] `autoReproPrefill` 기본값 true, persist 왕복 — 마이그레이션 v7→v8 단위 테스트
  - [x] `pnpm typecheck` 통과

### Task 5: `DraftingPanel` 배선 + 로딩 치환 + disclaimer
- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**: draft 시딩 useEffect(119-129행) 이후 `useReproPrefill({...})` 호출(이미 보유한 값 + `trimming`·`sectionEnabled`·`autoReproPrefill`·`reproPrefillDone`·`setReproPrefillDone` 전달). `stepsToReproduce` 섹션 렌더에서 `loading`이면 `OrderedListEditor`를 **스피너(`Loader2`)로 치환**(clobber 방지 — 입력 차단). AI 경로로 채운 경우 disclaimer 힌트("AI 생성 — 검토") 노출. 로딩 인디케이터·steps 편집기에 e2e용 `data-testid` 부착(예: `repro-prefill-loading`, `draft-section-stepsToReproduce`).
- **검증**:
  - [ ] video 캡처 후 drafting 진입 시 stepsToReproduce가 채워짐(수동/e2e)
  - [ ] AI 가용 프로필에서 로딩 스피너가 편집기를 치환하고, 그동안 타이핑 불가(수동/e2e)
  - [ ] disclaimer 힌트 노출(AI 경로)(수동/e2e)
  - [x] `data-testid` 부착됨 (`draft-section-stepsToReproduce`, `repro-prefill-loading`, `repro-prefill-ai-hint`)
  - [x] `pnpm typecheck` 통과

### Task 6: 설정 토글 UI + i18n
- **변경 대상**: 설정 탭 컴포넌트, `src/i18n/namespaces/*`(ko/en 동시)
- **작업 내용**: `autoReproPrefill` 토글 1개를 설정 UI에 추가(기존 토글 패턴 재사용). 로딩 라벨·disclaimer·토글 라벨/설명 문구 ko/en 추가. PostToolUse 훅이 `locales.test.ts` 자동 실행 — 대칭 유지.
- **검증**:
  - [ ] 토글 on/off가 `autoReproPrefill` 반영, off 시 자동 채움 미발화(수동)
  - [x] ko/en 키 대칭, placeholder 토큰 일치(훅 자동 검사 통과)

## 테스트 계획

- **단위 테스트**:
  - `buildReproSteps.test.ts` — Task 1 검증 항목(kind 매핑, dedup, 상한, 마스킹, 빈 로그, 필터 후 0줄).
  - `generateReproPrefill.test.ts` — Task 2 검증 항목(섹션 좁힘, few-shot, title 무시, quota/auth 분류, 빈 값 `ok:false`).
  - `useReproPrefill.test.tsx` — Task 3 발화 조건 매트릭스(checking 레이스, done 가드, opt-out, sectionEnabled, trimming, abort, 공백 스킵).
- **회귀 테스트(기존 기능 무간섭)**:
  - **draft-preservation 상호작용**: prefill로 채운 steps가 있는 상태에서 AI draft 버튼 실행 시, `existingDraft`로 실려 `mergeAiSectionsPreservingImages`가 갱신하는 동작을 명시적으로 검증(design의 "무간섭 아님" 정정 반영). AiDraftDialog 기존 spec에 케이스 추가 또는 신규.
  - **aiDraftLoading vs reproPrefill 로딩 비간섭**: 자동 prefill 로딩이 기존 `aiDraftLoading`(preview 버튼·AI 배너·inline capture 게이팅)에 영향 주지 않음 확인.
- **e2e 시나리오**(`/e2e-write` 입력, 나노 부재 → 룰 경로가 기본 대상):
  - "video 모드로 캡처하고 drafting에 진입하면, 액션 로그가 있을 때 `draft-section-stepsToReproduce`가 비어 있지 않다."
  - "stepsToReproduce에 이미 텍스트가 있으면 drafting 재진입 시 그 값이 유지된다(덮어쓰지 않음)."
  - "설정에서 autoReproPrefill을 끄면 video 캡처 후에도 stepsToReproduce가 비어 있다."
  - (BYOK/나노 경로는 수동. e2e는 룰 경로 + 값 보존 + opt-out만 커버.)
- **수동 테스트**(Chrome):
  - 나노 있는 크롬에서 video 캡처 → AI 경로로 자연어 재현 단계 채움 + disclaimer 확인.
  - BYOK 설정 후 video 캡처 → BYOK 자동 호출·채움 확인(네트워크 탭 1회 호출).
  - 30s Replay 트림 구간 변경 → 재트림된 로그로 채워지는지(stale 아님) 확인.
  - AI 강제 실패(잘못된 BYOK 키) → quota/auth 토스트 + 룰 baseline 폴백 확인.
  - ko 프로필에서 룰 경로 영어 출력이 나오는지(의도된 결정) 수용 확인.
  - 대량(수백 개) 액션 로그에서 `MAX_STEPS` 절삭 품질(앞부분 손실) 체감 확인.

## 구현 순서 권장

Task 1·2는 독립 병렬 가능(순수 함수/오케스트레이션). Task 4(store)도 병렬 착수 가능. Task 3은 1·2·4 완료 후. Task 5는 3·4 완료 후. Task 6은 4·5와 병행. 권장: **1‖2‖4 → 3 → 5 → 6**.

## 가이드 영향

사용자 노출 UX 추가(재현 단계 자동 채움 + 설정 토글) → `/guide` 대상.
- `guide/ko`·`guide/en`의 video 녹화 / 리포트 작성 관련 페이지에 "재현 단계 자동 채움" + "설정에서 끄기" 설명 추가(정확한 파일은 `guide/AUTHORING.md` IA 확인 후 결정).
- **문서 영향(권한 아님)**: `docs/privacy.{ko,en}.md` — BYOK 자동 호출로 액션 로그가 **자동으로** 외부 LLM에 전송되는 동작 + **opt-out 토글 존재**를 추가. manifest diff는 0이지만 기존 권한을 새 목적(자동 전송)으로 쓰므로 ko/en 본문+시행일 대조·갱신 필요. `/push` 전 처리.
- `CLAUDE.md`/`docs/DIRECTORY.md` — 신규 `src/sidepanel/lib/buildReproSteps.ts`·`generateReproPrefill.ts`·`src/sidepanel/hooks/useReproPrefill.ts` 추가 반영.
