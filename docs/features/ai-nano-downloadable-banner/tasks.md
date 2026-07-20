# Chrome Nano `downloadable` 유도 배너 — 구현 태스크

> 상태: **초안 (context capture)**. 후속 세션 착수 시 `docs/POSTMORTEM.md`를 `useAI`·`ai-provider`·nano로 grep해 과거 함정 소환 후 시작.

## 선행 조건

- 신규 의존성·권한·env·OAuth 없음. `<all_urls>` + 기존 Chrome AI 접근으로 충분.
- 착수 전 라인 번호 재확인(design.md의 as-of 2026-07-20 기준이 드리프트했을 수 있음).

## 태스크

### Task 0 [선택·권장 선행]: PostHog availability 실측
- **대상**: `src/background/analytics.ts` (+ 조회 지점에서 이벤트 발화)
- **작업**: `LanguageModel.availability()` 반환 문자열을 익명 이벤트로 로깅(스토어 빌드만). 캡처 데이터 아님 — 코어밸류 무관.
- **목적**: `downloadable` 필드 비중 실측 → 배너 ROI 판단. 1~2주 수집.
- **검증**:
  - [ ] dev/e2e에서 no-op(키 부재).
  - [ ] 로깅 값이 enum 문자열뿐(페이로드에 캡처 데이터 없음 확인).
  - [ ] `docs/privacy.{ko,en}.md` 대조 — 능력 enum 집계가 기존 분석 서술 범위 내인지 확인(범위 밖이면 갱신).

> Task 0은 배너 구현(1~6)과 독립. 실측 선행 결정 시 먼저, 아니면 스킵.

### Task 1: `mapAvailability` 순수 함수 (TDD interface)
- **대상**: `src/sidepanel/lib/ai-provider.ts` (또는 인접 lib) + `__tests__/`
- **작업**: `mapAvailability(raw: string): AIStatus` — `available`/`readily`→available, `downloadable`→downloadable, `downloading`→downloading, 그 외→unavailable.
- **검증**:
  - [ ] `/tdd interface`로 테스트 **먼저** 작성(4상태 + 미지 문자열 + 레거시 readily).
  - [ ] `pnpm test` green.

### Task 2: `useAI` 상태 확장
- **대상**: `src/sidepanel/hooks/useAI.ts`
- **작업**:
  - `AIStatus`를 `"checking" | "available" | "downloadable" | "downloading" | "unavailable"`로 확장.
  - availability 매핑을 `mapAvailability`로 교체(L39–43). 레거시 `"readily"` 인라인 체크 제거(함수로 흡수).
  - BYOK 경로(L64) 불변.
- **검증**:
  - [ ] `useReproPrefill.ts`의 status 타입 참조(L17)와 정합.
  - [ ] BYOK 설정 시 여전히 `available` 즉시.
  - [ ] `pnpm test` green(useAI 관련 테스트가 있으면 확장).

### Task 3: 다운로드 트리거 + 진행 상태
- **대상**: `useAI.ts` (+ `ai-provider.ts` `createChromeAIProvider`)
- **작업**:
  - `startNanoDownload(onProgress?)` 노출 — `LanguageModel.create({ ...CHROME_AI_LANG_OPTIONS, monitor })`로 `downloadprogress` 구독.
  - 진행 중 `downloading` 상태 로컬 반영, 완료 시 availability 재확인 → `available` 전환.
  - 에러 catch → `downloadable` 원복 + 실패 신호.
- **검증**:
  - [ ] 클릭 핸들러 최상단에서 `create()` 호출(user gesture 소실 방지).
  - [ ] 완료 후 배너가 available로 자연 전환(refetch 경로).
  - [ ] **실기기 수동**: 실제 `downloadable` 환경에서 다운로드→진행률→완료→사용까지 왕복. *(jsdom 불가)*

### Task 4: 유도 배너 렌더 (3 진입점)
- **대상**: `DraftingPanel.tsx:423`, `StyleEditorPanel.tsx:488`, (`useReproPrefill.ts:85`)
- **작업**:
  - `aiStatus === "available"` 단일 분기를 상태별로: `downloadable`→다운로드 유도 배너, `downloading`→진행 배너, `available`→기존 트리거.
  - 신규 배너는 공용 컴포넌트로 뽑을지 판단(design §3 — 무리한 기존 리팩터는 지양).
  - `useReproPrefill` 자동 채움은 `available`일 때만 유지(변경 최소).
- **검증**:
  - [ ] Drafting/StyleEditor 양쪽에서 상태별 배너 렌더(컴포넌트 테스트 — jsdom, 상태 주입).
  - [ ] `unavailable`/`checking`에선 배너 부재(현행 유지).
  - [ ] `downloadable` 배너 클릭 → `startNanoDownload` 호출(테스트).
  - [ ] 라이트/다크 시각 정합(수동).

### Task 5: i18n 키
- **대상**: `src/i18n/namespaces/ai.ts`
- **작업**: `nano.downloadBanner`·`nano.downloading`·`nano.downloadFailed` 등 ko/en 동시 추가(ko `-습니다`/친절 톤).
- **검증**:
  - [ ] PostToolUse 훅(`locales.test.ts`) 통과(ko/en 대칭·placeholder).
  - [ ] log-viewer 복제 사전 무관 확인(사이드패널 전용 키).

### Task 6: 문서 갱신
- **대상**: 필요 시 `docs/ARCHITECTURE.md`(AI 폴백 서술)·`docs/privacy.{ko,en}.md`(Task 0 채택 시)·`guide/`(사용자 노출 UX 신설 — AI 배너/다운로드 흐름).
- **검증**:
  - [ ] `guide/AUTHORING.md` 규칙대로 ko/en 동시(가이드 영향 있음 — 새 사용자 노출 흐름).
  - [ ] `/doc-check` 또는 `/push` 신선도 검사 통과.
  - [ ] 구현 완료 시 이 `docs/features/ai-nano-downloadable-banner/` 삭제(기획 문서 라이프사이클).

## 테스트 계획

- **단위(node, `*.test.ts`)**: `mapAvailability` 4상태 + 미지/레거시 문자열(Task 1, 테스트 우선).
- **컴포넌트(jsdom, `*.test.tsx`)**: 상태 주입 시 Drafting/StyleEditor 배너 분기 렌더 + `downloadable` 클릭 → 다운로드 콜백 호출.
- **수동/실기기(자동화 불가)**: 실제 `downloadable` 환경에서 다운로드 왕복, 진행률 표시, 완료 전환, user gesture, 라이트/다크. *(다운로드 API는 jsdom·e2e로 못 잡음)*
- **e2e**: 나노 다운로드는 실제 모델·하드웨어 의존이라 e2e 부적합 → 수동이 유일 안전망.

## 가이드 영향

**있음.** 새 사용자 노출 흐름(무료 AI 모델 다운로드 배너)이라 `guide/ko`·`guide/en` 대조·갱신 대상. `/implement` 후 `/guide`.
