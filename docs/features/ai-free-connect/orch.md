# ai-free-connect — 지휘 계획 (orch)

원본: [prd.md](./prd.md) · [design.md](./design.md) · [tasks.md](./tasks.md) — 여기에 복제하지 않는다.

- 착수 범위: tasks.md Task 1~6 전부 (Task 0 스파이크는 완료 — tasks.md "스파이크 결과")
- 시작 dev 해시: `cee113d5`
- 지휘자: Claude Code (이 세션)

## 결정 기록

| # | 결정 | 출처 |
|---|---|---|
| D1 | **패밀리 교차 허가**: 구현 워커는 Codex `gpt-6-astra`, `model_reasoning_effort="high"` | 사용자 2026-10-18 ("astra high 사용 허가") |
| D2 | 독립 리뷰는 지휘자 패밀리(Claude Opus 서브에이전트, 리포트 전용)로 돈다. 구현 패밀리와 다른 시각을 얻는 것이 목적 | 지휘자 판단 (D1 범위 안) |
| D3 | 제품 결정은 tasks.md "설계 반영 (2026-10-18 사용자 결정)"과 prd·design에 확정돼 있다. 워커는 재질문하지 않는다 | /feature·/feature-review |
| D4 | Gemini 무료 키 실호출은 미수행(키 없음). 워커 A는 T0-2 갱신안대로 `GEMINI_MODELS`를 고치고, 실호출 확인은 런타임 검증 목록으로 넘긴다 | Task 0 |
| D5 | OpenRouter [거부] 리다이렉트 형태가 미확인이다. 워커 B는 `error` 파라미터가 있으면 cancelled, `code`·`error`가 모두 없으면 throw로 구현한다. 실측은 런타임 검증으로 넘긴다 | Task 0 |
| D6 | 핫스팟 문서 `docs/ARCHITECTURE.md`·`docs/DIRECTORY.md`는 지휘자가 통합 시점에 문서별 커밋으로 맞춘다. privacy·PERMISSION·guide는 워커 C 소유 | /orchestrate 0-4 |

## 배치

| 배치 | 항목 | 소유 파일 | 선행 | 모델/effort | 상태 |
|---|---|---|---|---|---|
| **A** | Task 1 + Task 2 | `src/lib/llm-provider-ids.ts`(신규) · `src/background/analytics.ts` · `src/sidepanel/lib/track-llm.ts`(신규) · `src/sidepanel/lib/ai-provider.ts` · `src/store/settings-ui-store.ts` · `src/sidepanel/tabs/settings/LlmConnectDialog.tsx` · `src/store/__tests__/bundleBoundary.test.ts` · 해당 `__tests__` | 없음 | astra / high — 집계 가드·persist migration 불변식 | 대기 |
| **B** | Task 3 + Task 4 | `src/sidepanel/lib/free-llm.ts`(신규) · `src/sidepanel/openrouter-auth.ts`(신규) · `scripts/coverage-report.mjs` · `src/sidepanel/lib/__tests__/free-llm.test.ts` | 없음 (ai-provider.ts는 **읽기만** — 기존 `ModelEntry`·`LlmRedirectError` import) | astra / high — PKCE·콜백 파싱 보안 경로 | 대기 |
| **C** | Task 5 + Task 6(privacy·PERMISSION) + `/guide` | `src/sidepanel/tabs/settings/FreeLlmConnectDialog.tsx`(신규) · `LlmConnectForm.tsx` · `src/i18n/namespaces/settings.ts` · `e2e/fixtures/settings.ts` · e2e spec · `docs/privacy.{ko,en}.md` · `docs/PERMISSION.md` · `guide/{ko,en}/settings/*` · 해당 `__tests__` | A·B가 dev에 통합된 뒤 | astra / high — 상태 전이·세대 가드·집계 1회 규칙 | 대기 |

### 파일 겹침 행렬

| | A | B | C |
|---|---|---|---|
| A | — | `ai-provider.ts`(B는 읽기만 → 충돌 없음) | `LlmConnectDialog.tsx`(C가 export된 `LlmModelDialog` 소비) · `ai-provider.ts` |
| B | | — | `free-llm.ts`(C가 소비) |
| C | | | — |

→ **A ∥ B 병렬**, C는 A·B 통합 후 직렬. 핫스팟 체크: i18n은 C만, `coverage-report.mjs`는 B만, `bundleBoundary.test.ts`는 A만, 메시지 등록 3중은 아무 배치도 안 건드린다.

### 워커 공통 게이트

`pnpm typecheck && pnpm test && pnpm sync:agents:check` (종료 코드만 근거, 파이프 금지). `/ship bypass` 11단계 커밋까지만 진행한다.

## 진행 기록

(배치별 라운드·통합 해시·검증 결과를 여기에 누적)

## 런타임 검증 목록 (e2e가 원리적으로 못 보는 축)

- Gemini 무료 키 실호출: `/models` ID 표기와 이미지 chat (D4)
- OpenRouter 실 OAuth: 신규 가입(인증 창 안 Google SSO 포함)·기존 계정·[거부]·창 닫기 (D5)
- 무료 vision 모델로 실 AI 초안 생성(스크린샷 포함)
- PostHog `llm_connect` 도착·props 3개
- (배치 인계 문서의 (b) 항목을 여기 합친다)
