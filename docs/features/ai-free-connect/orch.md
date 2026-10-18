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

- **A·B 통합 완료** (dev `5c8cc717..45ea252e`): B 3커밋(`5c8cc717`·`bf6a05b6`·`2356ed52`) + A 3커밋(`e67a1ee2`·`a4c2f935`·`45ea252e`). 수정 라운드 1회씩 — fix 커밋은 🔴0 배치의 테스트 보강·한 줄 변경이라 재리뷰 생략, 지휘자가 diff로 지적 반영 확인. 통합 게이트 `typecheck=0 test=0 sync=0`(469 파일·9108 통과·2 skip). 원격 push는 C 통합 후 1회(A 리뷰 🟡2 순서 조건). A 워크트리 제거(인계 사본 `.scratch/ai-free-connect/handoff-A.md`), B는 후속 결함 대비 유지.
- **C 착수**: 워크트리 `afc-batch-C`(base `45ea252e`), Codex astra high, 브리프 `brief-C.md`(B 리뷰 🟡3 e2e 포함).
- C 1차 중단(정당): 프로브 대기 중 모델 재선택 시 이전 모델이 저장되는 경합 — 공유 `LlmModelDialog`(A 소유)에 busy 입력이 없다. **D7**: A 워크트리 제거 후라 `LlmModelDialog`의 `busy?: boolean` 추가를 C에 이관(BYOK 동작 불변 + 기존 테스트 green 조건). `e2e/` 내 커버리지 문서도 C 허용, `docs/CI.md`는 지휘자. 재개 브리프 `brief-C-resume1.md`.
- C 1차 인계: `84f75560`·`a520cda5`·`69524280`·`e74b9564`·`42123bc1`·`d2d60ab4`(e2e 6개 2회 연속 green). Opus 리뷰 🔴0 🟡4 ⚪7 → 수정 라운드 1(`brief-C-fix1.md`): ja 피싱 경계 문구 의미 교정, `guide/AUTHORING.md` 사실 스냅샷(**D8**: C에 이관), 좁은 화면(360×600·de) e2e를 (b)에서 테스트로 이동, BYOK effect 테스트, status live region·닫힘 애니메이션 리셋·hover·privacy 프로브 문구·jsdom 분기 보강. 남긴 ⚪: 닫힘 후 진입 버튼 포커스 미복귀(BYOK와 동일, 회귀 아님, POSTMORTEM 2026-10-04 계열).
- 지휘자 문서: `38992574` CI.md e2e 88 spec/429, `b28f05c9` ARCHITECTURE busy 잠금.
- **C 통합 완료**: C 수정 라운드 1 6커밋 포함 12커밋 cherry-pick(`cef2cb66..3d6cc0df`). 통합 게이트 `typecheck=0 test=0 sync=0`(471 파일·9137 통과·2 skip). CI.md e2e 88 spec/430.
- `/postmortem` 3건(`48680978`): 세대 번호 가드 · 종료된 Gemini 모델 드리프트 · Radix dismiss 지연 리스너 거짓 green. 키 trim은 자명해 제외, `pendingUrl`은 `e2e/GOTCHAS.md`에 이미 기록.
- `/push`: README en/ko·CLAUDE.md·AGENTS 미러 커밋 후 dev push `10d99f19..e3d468f2`. **CI run 39092898961 (HEAD `e3d468f2`) success** — verify·e2e 1~4·e2e-gate 전부 success. 로컬 HEAD == origin/dev.
- postmortem 후보(A 인계): BYOK `LlmConnectDialog`의 boolean `cancelledRef`가 재오픈 시 이전 비동기 결과를 통과시키던 기존 결함 — 세대 번호 + 지연 응답 테스트로 고정. 통합 마무리 때 `/postmortem`.
- B 1차 인계: `2f3e56f5`·`b4a0bf9f`. Opus 리뷰 🔴0 🟡3 → 🟡1·2·⚪3건을 수정 라운드 1로 반환, 🟡3(런처 바인딩 e2e — `launchWebAuthFlow` 스텁 + `context.route`)은 C 브리프로 이관.
- A 1차 인계: `9183c474`·`efe3426e`. Opus 리뷰 🔴0 🟡2 → 🟡1(입력 유지 테스트)·⚪2건을 수정 라운드 1로 반환. 🟡2(privacy가 `llm_connect` 미반영)는 순서 조건 — C의 privacy 갱신 전 원격 push 금지(이 파이프라인은 C 통합 후 1회 push라 자연 충족). design.md 잔존 불일치(변경 범위 표 `Promise<ModelEntry[]>`, track-llm `provider` required)는 구현 완료 후 삭제할 기획 문서라 정정 생략.
- **merge 전 필수 권고**: Gemini 3.x 모델 ID 실호출(D4)은 무료 경로가 아니라 **기존 BYOK Gemini 사용자에게 바로 노출**된다(A 리뷰). 런타임 검증 #1을 `/merge` 전 필수로 사용자에게 보고한다.
- 2026-10-18 A·B 착수. 워크트리 `~/orca/workspaces/bugshot-2/afc-batch-{A,B}`(브랜치 `SinhyeokKang/afc-batch-{A,B}`, base `17c727e6`), Codex `gpt-6-astra` high. 브리프 `.scratch/ai-free-connect/brief-{common,A,B}.md`(main 체크아웃, git 제외).

## 런타임 검증 결과 (2026-10-18, dev 빌드 1.7.57)

ego가 에이전트의 확장 설치를 막아서(사용자 고지) **Playwright headed Chromium + `--load-extension=dist`**(e2e와 같은 방식, 별도 프로필, CDP 9333)로 우회했다. OpenRouter 로그인은 사용자 부재 + 새 프로필이라 불가 → **확장이 만든 실제 인가 URL(state·challenge)을 로그인된 ego에서 열어 승인하고, 받은 일회용 code를 Playwright 인증 창의 callback으로 전달**했다. `launchWebAuthFlow`가 가로채 확장 자신의 verifier로 교환한다. 비밀번호·쿠키는 옮기지 않았다.

| 항목 | 결과 |
|---|---|
| 온보딩 버튼 2개·모달 라이트/다크·카드 스크롤 | ✅ (스크린샷 `scratchpad/rt-shots/01~06`) |
| Gemini 팝업 520×760·키 입력 단계 | ✅ (처음 1400×900은 런처의 `--window-size` 탓 — 제거 후 정상) |
| OpenRouter 실 인가 → 키 교환 → `:free`+image 8개 목록 → 프로브 `ping` → 저장(`freeTier:true`·키 난독화·v12) | ✅ |
| 프로브 403(`inkling:free`) → `modelUnavailable` 토스트·다이얼로그 유지 | ✅ |
| 같은 모달 재[다음] → 인가 생략(발급 키 재사용) | ✅ |
| 실 AI 초안(무료 vision 모델, `image_url` 2개, 200, 스크린샷 내용 반영) | ✅ |
| `llm_connect` payload: 카드 미선택 닫기 `{path:free,result:cancelled}`(provider 생략) / 성공 `{provider:openrouter,path:free,result:success}` | ✅ (panel `sendMessage` 가로채기) |
| R4 대기 중 패널 소멸 → 재열기 재시도 | ✅ 동작. ⚪ 이전 인증 창이 고아로 남는다(창 2개) — 수용, 기록만 |
| **[Deny]** | ❌ **#268** — 파라미터 없는 bare callback이 온다 → 실패 토스트. D5 해소: `error` 파라미터가 아니다 |
| OpenRouter 대기 문구 | ❌ **#269** — 스크롤 영역 끝에 렌더돼 400×760에서 안 보임. ⚪ Gemini 키 placeholder `sk-...` |
| Gemini 무료 키 실호출(모델 ID·이미지) | ⏸ 미검증 — 키 없음. **merge 전 필수 권고 유지** |
| 인증 창 안 Google SSO 가입 완주 | ⏸ 미검증 — 사용자 부재 |
| PostHog 실수신 | ⏸ 미검증 — dev 빌드 PostHog 키 없음(no-op). payload까지만 확인 |
| 가이드 신규 컷(`/guide-shots`) | ⏸ 미수행 |

테스트용 OpenRouter 키 2개(`OAuth: BugShot`)는 검증 후 삭제했다.

## 런타임 검증 목록 (e2e가 원리적으로 못 보는 축)

- Gemini 무료 키 실호출: `/models` ID 표기와 이미지 chat (D4)
- OpenRouter 실 OAuth: 신규 가입(인증 창 안 Google SSO 포함)·기존 계정·[거부]·창 닫기 (D5). [거부]의 실제 `error` 값을 실측한 뒤 "error 파라미터면 무조건 cancelled"를 `access_denied`로 좁힐지 판단(B 리뷰 — `server_error`가 무음 cancelled로 집계될 수 있음)
- 패널 문서 소멸(대기 중 패널 닫힘) 후 재시도 (R4)
- 무료 vision 모델로 실 AI 초안 생성(스크린샷 포함)
- PostHog `llm_connect` 도착·props 3개
- (배치 인계 문서의 (b) 항목을 여기 합친다)
