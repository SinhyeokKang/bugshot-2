# Chrome Nano `downloadable` 유도 배너 — 기술 설계

> 상태: **초안 (context capture)**. 코드 대조는 2026-07-20 시점 기준. 후속 세션에서 라인 번호 재확인 필요.

## 개요

`useAI` 훅이 `availability()`의 4상태를 그대로 노출하도록 상태 타입을 넓히고, 3개 진입점(`DraftingPanel`·`StyleEditorPanel`·`useReproPrefill`)이 `downloadable`/`downloading`을 새로 처리한다. 다운로드는 `LanguageModel.create({monitor})`로 트리거하며 `downloadprogress` 이벤트로 진행률을 받는다. 순수 폴백 로직·BYOK 경로는 불변.

## 현재 코드 지형 (as-of 2026-07-20)

### `src/sidepanel/hooks/useAI.ts`
- `AIStatus = "checking" | "available" | "unavailable"` (L14).
- `availability` 결과를 `=== "available" || === "readily"` → `available`, 그 외 전부 → `unavailable`로 접음 (L39–43). **`downloadable`/`downloading` 정보 소실 지점.**
- `"readily"`는 폐기된 옛 명칭 — 죽은 체크.
- `status = llm?.modelId ? "available" : chromeAIStatus` (L64) — BYOK 우선.
- provider는 `createChromeAIProvider()` (ai-provider.ts) 반환. **다운로드 모니터 코드 없음.**

### 진입점 (모두 `aiStatus === "available"` 게이팅)
- `src/sidepanel/tabs/DraftingPanel.tsx:423` — AI 초안 트리거 배너(`ai-draft-trigger`, purple).
- `src/sidepanel/tabs/StyleEditorPanel.tsx:488` — AI 스타일링 트리거 배너(`ai-styling-trigger`, teal).
- `src/sidepanel/hooks/useReproPrefill.ts:85` — `aiStatus !== "available"` 이면 자동 채움 보류.

### `src/sidepanel/lib/ai-provider.ts`
- `createChromeAIProvider()` (L322) — `LanguageModel.create({ initialPrompts, ...CHROME_AI_LANG_OPTIONS })`. monitor 옵션 미사용.
- `CHROME_AI_LANG_OPTIONS` (L50) — availability/create 양쪽에 동일 옵션 필수(단일 출처).

## 변경 설계

### 1. `AIStatus` 상태 확장 — `useAI.ts`
- 타입을 4상태 + checking으로: `"checking" | "available" | "downloadable" | "downloading" | "unavailable"`.
- availability 매핑을 **원문 보존**으로 교체:
  ```
  available → "available"
  downloadable → "downloadable"
  downloading → "downloading"
  그 외(unavailable/미지원/throw) → "unavailable"
  ```
- **순수 함수로 분리해 단위 테스트 대상화**: `mapAvailability(raw: string): AIStatus`를 `ai-provider.ts`(또는 `sidepanel/lib`)에 두고 `useAI`가 호출. availability 문자열 → 상태 매핑이 테스트 우선 대상(신규 인터페이스).
- 레거시 `"readily"`: 매핑에서 `available`로 흡수하거나 제거(무해하므로 매핑 함수 안에서 정리).
- BYOK 경로(`llm?.modelId`)는 불변 — 여전히 `available` 즉시.

### 2. 다운로드 트리거 — provider/hook
- `createChromeAIProvider`에 다운로드 유도 진입점 추가, 또는 `useAI`가 노출하는 `startNanoDownload(onProgress)` 액션:
  ```ts
  const session = await LanguageModel.create({
    ...CHROME_AI_LANG_OPTIONS,
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => onProgress(e.loaded)); // 0..1
    },
  });
  ```
- `create()` 자체가 다운로드를 트리거하므로 별도 API 없음. 진행 중 상태는 `downloading`으로 로컬 반영, 완료 시 availability 재확인 → `available`.
- **재확인 타이밍**: 다운로드 완료 후 `useAI`가 availability를 재폴링(또는 create 성공 자체를 available 신호로)해서 배너가 자연 전환되게. useEffect 의존성/수동 refetch 훅 필요.
- 에러(용량 부족·네트워크): catch → 토스트 + `downloadable`로 원복(재시도 가능).

### 3. 유도 배너 컴포넌트 — 공용화 검토
- Drafting(purple)·StyleEditor(teal)는 색만 다른 동형 배너다. `downloadable`/`downloading` 배너도 두 곳에 필요하므로 **공용 컴포넌트**(예: `AiEntryBanner` 또는 `NanoDownloadBanner`)로 뽑아 색 토큰만 주입하는 편이 중복을 막는다.
  - 단, 기존 배너를 무리하게 리팩터하지 말고(외과적 원칙) — 신규 `downloadable`/`downloading` 배너만 공용으로, 기존 available 트리거는 그대로 두는 선택도 가능. 후속 세션 판단.
- 배너 상태별:
  - `downloadable` → "AI 모델 받기 (무료)" + 다운로드 아이콘. 클릭 → `startNanoDownload`.
  - `downloading` → 진행률(%) 또는 인디케이터 + "받는 중" 라벨. 클릭 비활성.
  - `available` → 기존 트리거(변경 없음).
  - `unavailable`/`checking` → 렌더 안 함(현행 유지).

### 4. 진입점 3곳 반영
- `DraftingPanel.tsx:423` / `StyleEditorPanel.tsx:488`: `aiStatus === "available"` 단일 분기를 상태별 분기로 확장.
- `useReproPrefill.ts:85`: 자동 채움은 계속 `available`일 때만(다운로드 중엔 미발화 유지). 변경 최소.

### 5. i18n — `src/i18n/namespaces/ai.ts`
- 신규 키(ko/en 동시): 예)
  - `nano.downloadBanner` — "AI 모델 받기 (무료)" / "Download AI model (free)"
  - `nano.downloading` — "AI 모델 받는 중…" / "Downloading AI model…"
  - `nano.downloadFailed` — 토스트 문구
- ko는 `-습니다`/친절 톤, en은 번역. `locales.test.ts` 훅이 대칭 검사.

### 6. [선택·권장 선행] PostHog availability 로깅 — `src/background/analytics.ts`
- availability 반환 문자열(enum)만 익명 이벤트로. **캡처 데이터 아님** → 코어밸류 무관.
- 스토어 빌드만 동작(dev/e2e no-op). `downloadable` 필드 비중 실측용.
- PRD 열린 질문 참조 — 배너 구현과 분리해 먼저 심을 수 있음.

## 데이터 흐름

- availability 조회는 기존대로 `useAI`의 useEffect. 다운로드는 사용자 제스처(배너 클릭) → `create({monitor})` → progress 콜백 → 로컬 `downloading` 상태 → 완료 시 available 재확인.
- **user gesture 주의**: `create()` 다운로드 트리거가 제스처 요구 여부 확인 필요(배너 클릭이 제스처라 안전할 가능성 높음).
- 캡처 데이터 흐름 변화 없음(온디바이스, 서버 미경유).

## 인터페이스 설계 (테스트 우선 대상)

- `mapAvailability(raw: string): AIStatus` — 순수 함수. `"available"→available`, `"downloadable"→downloadable`, `"downloading"→downloading`, `"readily"→available`(레거시), 그 외 `→unavailable`. **`/tdd interface`로 먼저 박는다.**
- `useAI` 반환 확장: `status`(넓힌 union) + `startNanoDownload(onProgress?)` + 진행률 상태. 구체 시그니처는 구현 시 확정.

## 위험 요소

- **다운로드 트리거 API 실동작**: `create({monitor})`의 progress 이벤트·완료 신호·제스처 요구는 실제 Chrome에서만 검증됨(jsdom 불가) → 수동/실기기 필수.
- **availability 재확인 타이밍**: 완료 후 배너가 안 바뀌면 사용자가 다운로드했는데도 못 씀. refetch 경로 확실히.
- **`downloadable`이 실제로 안 뜨는 환경**: 대부분 사용자가 `unavailable`(하드웨어 미달)이면 이 작업의 ROI가 낮음 → PostHog 실측이 리스크 헤지.
- **user gesture 소실**: `create()`가 제스처를 요구하는데 비동기 체인에서 끊기면 실패 → 클릭 핸들러 최상단에서 호출.
- **두 벌 사전(log-viewer)**: 이 배너는 사이드패널 전용이라 `src/log-viewer/i18n.ts` 복제 사전과 무관(확인).

## 대안 검토

- **대안 A: 호스팅 AI로 전 사용자 커버.** 기각 — 프라이버시 코어밸류 충돌 + 추론 비용 사비 소모. (PRD 배경 참조.)
- **대안 B: `unavailable`도 같은 배너로 BYOK 유도.** 이번 스코프 밖(비목표). 하드웨어 미달층은 나노 불가라 메시지가 달라야 함 → 별도 후속.
- **대안 C: 실측 없이 바로 배너.** 저비용이라 가능하나 `downloadable` 비중 미상이면 헛수고 위험 → PostHog 선행 권장(열린 질문).
