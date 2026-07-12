# AI 프롬프트 tier 분리

## 배경

Bugshot의 AI 기능(이슈 초안 생성 · 요소 스타일링)은 두 가지 프로바이더 위에서 돈다.

- **Chrome 온디바이스 빌트인 AI (Gemini Nano)** — 기본값. BYOK를 설정하지 않은 모든 사용자가 이 경로를 탄다. 무료지만 컨텍스트 창이 ~4–6k 토큰이고, 이미지를 못 받으며, 긴 지시·부정 지시·다중 제약에 취약하다.
- **BYOK 고급 모델** — 사용자가 API 키를 넣은 OpenAI/Anthropic/Gemini/Groq 등. 컨텍스트 창이 수십만 토큰이고 멀티모달이며 복잡한 지시를 따른다.

지금은 **하나의 프롬프트가 양쪽을 동시에 감당**한다(`buildAiDraftPrompt.ts`, `buildAiStylingPrompt.ts`). 프롬프트 빌더는 어느 프로바이더로 나가는지조차 모른다. 그 결과 양방향으로 손해가 난다.

**나노는 이 프롬프트를 감당하지 못한다.** 규칙 9줄에 부정 지시가 12개고(한 줄에 5개가 압축된 곳도 있다), `responseConstraint`가 이미 구조적으로 강제하는 JSON 형식을 말로 또 시켜 토큰을 태운다. 로그·기존 초안이 무제한으로 system prompt에 실리는데, 나노의 system prompt는 컨텍스트 오버플로에서 **절대 잘리지 않아** 창을 다 먹으면 응답 공간 없이 즉사한다.

**고급 모델은 나노 기준에 눌려 있다.** 컨텍스트 상한이 전부 나노 예산(디자인 토큰 10개, 스타일 30개)이고, 스타일링 프롬프트의 첫 4줄은 통째로 소형 모델의 거절을 막는 방어 문구(`"You CAN and MUST change CSS. That is your only job."`)다. 사고 구조도 few-shot도 없이 규칙 나열뿐이라, 액션 로그 타임라인과 콘솔 에러 발생 시점을 상관지어 원인 가설을 세우는 일을 시키지 못한다.

동시에, 이 분리의 전제가 되는 **정합성 버그 3건**이 사전 진단에서 드러났다. 이건 프롬프트 길이 문제가 아니라 지금 깨져 있는 동작이다.

- **나노는 존재하지 않는 이미지를 "분석"하고 있다.** `createChromeAIProvider`의 세션은 `options.images`를 읽지도 않는데(`ai-provider.ts:178-184`), 프롬프트는 screenshot 모드에서 *"The user will provide a screenshot image… Analyze the screenshot"* 을 무조건 넣는다(`buildAiDraftPrompt.ts:144`). BYOK 미설정 사용자 전원이 이 경로이므로, **기본 상태의 스크린샷 모드 AI 초안은 통째로 환각**이다. 게다가 버릴 데이터를 만드느라 IndexedDB blob→dataURL resolve까지 매번 돈다.
- **AI가 섹션 키를 빠뜨리면 사용자가 쓴 텍스트가 삭제된다.** `mergeAiSectionsPreservingImages`가 `if (id in aiSections)` 게이트라(`mergeAiDraftSections.ts:20-23`), 모델이 `notes`를 누락하면 그 섹션이 결과에서 빠지고 `setDraft`가 사용자 텍스트를 통째로 날린다. 무고지 데이터 손실이다. 나노는 필드 누락이 잦아 compact 프롬프트로 갈아탄 뒤 더 자주 터진다.
- **스타일 cap이 사용자의 최신 편집을 먼저 자른다.** `{...specifiedStyles, ...styleEdits.inlineStyle}` spread 순서상 사용자가 방금 넣은 prop이 객체 tail인데, `slice(0, 30)`이 tail부터 버린다. 선언이 30개 넘는 요소(Tailwind 컴포넌트에서 흔하다)에선 **AI가 사용자 편집을 보지 못하고 되돌린다.**

## 목표

1. **프로바이더 능력이 프롬프트 빌더에 도달한다.** `AIProvider`가 `ProviderCapabilities`(`promptStyle` · `supportsImages` · `contextBudgetChars`)를 노출하고, 프롬프트·컨텍스트 조립이 그 값에 따라 갈린다. **등급 스칼라(`tier`)가 아니라 독립된 3개 축**이다 — 이유는 design.md 개요 참조(저가 BYOK 모델이 나노와 같은 칸에 안 들어간다).
2. **compact 프롬프트가 나노 예산 안에서 동작한다.** system prompt는 500토큰 이하, 지시는 긍정형, `responseConstraint`가 강제하는 규칙은 삭제. 전송 전 문자 예산으로 절삭하고 `measureInputUsage()`로 실측해, 초과가 확정되면 전용 에러로 안내한다.
3. **rich 프롬프트가 나노 제약에서 해방된다.** 역할·분석 절차·few-shot을 넣고, 컨텍스트 상한을 고급 모델 예산으로 확대하며, 나노 거절방지 문구를 제거한다. 스타일링에는 이미 수집돼 있는 레이아웃 컨텍스트(computed `display`/`position`/flex, 뷰포트)를 실어 "가운데 정렬해줘" 류를 풀 수 있게 한다.
4. **정합성 버그 3건이 사라진다.** 이미지 미지원 프로바이더는 이미지 언급 없는 프롬프트를 받고 이미지 resolve를 건너뛴다. 섹션 누락이 사용자 텍스트를 지우지 않는다. 사용자가 편집한 prop이 cap에서 살아남는다.
5. **회귀 안전망이 생긴다.** `createChromeAIProvider`·`createSession`에 테스트가 붙고, 프롬프트 테스트가 워딩 인질에서 불변식 검증으로 바뀐다.

### 이번에 출하하는 능력 좌표는 2개다

| 프로필 | `promptStyle` | `supportsImages` | `contextBudgetChars` |
|---|---|---|---|
| BYOK 미설정 (Chrome 나노) | `compact` | `false` | 2000 |
| BYOK 설정 (모든 모델) | `rich` | `true` | 무제한 |

즉 **`compact` = 지금은 나노 전용**이다. 축을 분리해 둔 것은 미래 대비(저가 BYOK 좌표 추가 시 프롬프트 파일 재사용)일 뿐, 이번에 3번째 좌표를 만들지는 않는다.

## 비목표 (Non-goals)

이번 스코프에서 **명시적으로 제외**한다. 사전 진단에서 발견됐으나 별도 작업으로 남긴다.

- `AIProvider.generate` 죽은 코드 제거 (프로덕션 호출부 0, 테스트만 호출)
- AI 요청 실패 시 사용자 입력이 소실되는 문제 (`setInput("")`이 요청 *전*에 실행됨)
- `explanation`을 필수로 파싱해놓고 UI에 노출하지 않는 문제
- 에러 원인별 문구 분화 (401 / 컨텍스트 초과 / 오프라인이 전부 generic 토스트) — **단, 컨텍스트 초과 전용 에러는 목표 2에 포함**
- **저가 BYOK 모델 전용 프로필** (Ollama 로컬 소형, gpt-4o-mini 등). `PROVIDER_PRESETS`에 Ollama가 이미 있어 실사용 경로지만, `modelId`가 임의 문자열이라 자동 판정이 불가능하고 수동 토글은 설정 UI 추가가 필요하다. **축(`ProviderCapabilities`)만 쪼개두고 좌표는 추가하지 않는다** — 나중에 `{compact, images:false, budget:8000}` 한 줄로 대응 가능한 구조만 남긴다.
- `AbortController` · 타임아웃 · 스트리밍
- BYOK structured output 제대로 연결 (OpenAI `json_schema` strict / Anthropic `tool_use`) — 현재 OpenAI는 스키마를 전송조차 안 하고 Anthropic은 문자열로 append한다. **풀 프롬프트가 JSON 규칙을 텍스트로 유지하는 이유가 이것이며, 이 비목표가 해소되기 전까지 그 규칙은 남긴다.**
- 나노의 출력 언어 동작 변경. Chrome Prompt API 문서상 한국어는 미지원 언어지만 **실측상 현재 한국어를 출력한다**(사용자 확인). `CHROME_AI_LANG_OPTIONS`의 `outputLanguage: "en"`과 "한국어로 써라" 지시를 **둘 다 그대로 둔다** — 지금 되는 것을 깨지 않는다. `outputLanguage: "ko"`로 바꾸는 시도는 `NotSupportedError` 위험이 있어 금지한다.
- buffered(멀티) 요소가 초안 프롬프트에 안 들어가는 문제
- 프롬프트 인젝션 방어 (페이지가 통제하는 콘솔 메시지·토큰 이름이 프롬프트에 실림)

## 사용자 시나리오

### S1. 나노 사용자가 스크린샷 버그를 리포트한다

BYOK 미설정 사용자가 스크린샷을 캡처하고 AI 초안을 연다.

- **현재**: 다이얼로그에 설명을 안 써도 제출된다(element 모드만 허용되지만 스크린샷도 텍스트 없이는 제출 불가). 프롬프트는 "스크린샷을 분석하라"고 하는데 이미지는 전송조차 되지 않는다. 나노는 URL과 페이지 제목만 보고 버그를 지어낸다.
- **변경 후**: 나노 프롬프트에 스크린샷 언급이 없다. 사용자 설명·URL·선택자만으로 초안을 쓴다. 이미지 resolve도 건너뛴다(불필요한 IndexedDB 작업 제거). 사용자 설명이 유일한 근거이므로 스크린샷 모드에서도 설명 입력을 필수로 유지한다.

### S2. BYOK 사용자가 같은 스크린샷 버그를 리포트한다

- 풀 프롬프트가 스크린샷(annotated + raw 둘 다)을 받는다. 시니어 QA 엔지니어 역할과 분석 절차를 지시받아, 사용자 서술과 이미지·로그를 대조해 확증된 것만 기술하고 추론은 `notes`에 가설로 분리한다.

### S3. 나노 사용자가 로그가 많은 페이지에서 video 모드 초안을 만든다

- **현재**: 네트워크 에러 5건 + 콘솔 에러 5건 + 액션 로그 20건 + 기존 초안 전문이 전부 system prompt에 실린다. 나노 창을 넘기면 `QuotaExceededError`가 나고 사용자는 "AI 초안 생성에 실패했습니다. 다시 시도해주세요"만 본다. 다시 시도해도 같은 결과다.
- **변경 후**: 나노 캡(에러 3건 / 액션 5건)으로 먼저 줄이고, 전송 전 `measureInputUsage()`로 실측한다. 그래도 초과하면 로그 → 기존 초안 → 스타일 diff 순으로 절삭한다. 절삭으로도 못 맞추면 전용 에러로 "컨텍스트가 너무 큽니다 — 로그를 줄이거나 API 키를 연결하세요"를 안내한다(재시도가 무의미함을 알린다).

### S4. 사용자가 요소를 여러 번 편집한 뒤 AI 스타일링을 요청한다

- **현재**: 선언이 30개 넘는 요소면 사용자가 방금 넣은 편집이 cap에서 잘려 AI에게 안 보인다. AI는 원본 상태를 보고 답하며 사용자 편집을 되돌린다.
- **변경 후**: 사용자가 편집한 prop이 cap에서 우선 보존된다. AI는 항상 현재 상태를 정확히 본다.

### S5. BYOK 사용자가 "이거 가운데 정렬해줘"라고 요청한다

- **현재**: 프롬프트에 부모의 `display`도, computed box model도, 뷰포트 폭도 없다. 고급 모델도 원리적으로 못 푼다 — `margin: auto`가 맞는지 `justify-content: center`가 맞는지 판단할 근거가 없다.
- **변경 후**: rich 프롬프트가 레이아웃 관련 computed 값과 뷰포트를 싣는다. 모델이 근거를 갖고 답하고, `explanation`에 가정과 부작용을 적는다.

### S6. 나노 사용자가 같은 요소에 스타일링을 5번 연속 요청한다

- **현재**: 세션이 유지되며 매 턴 `[Current state]` 30줄이 전량 재주입된다. 이 블록은 시스템 프롬프트의 "Current styles"와 **완전 중복**이라 첫 턴에 요소 상태가 두 번 들어간다. 턴마다 선형 증가해 나노는 몇 턴 만에 터진다.
- **변경 후**: 첫 턴은 시스템 프롬프트만으로 충분하므로 중복 블록을 보내지 않는다. 이후 턴은 직전 턴 대비 **변경된 prop만** delta로 보낸다.

### 엣지 케이스

- 나노에서 디자인 토큰이 300개인 Tailwind v4 페이지: 알파벳 앞 5개가 아니라, **요소가 실제 `var()`로 참조하는 토큰 → 같은 family 순**으로 선별된다.
- 세션 중간에 BYOK를 연결/해제: `useAI`의 `provider` memo가 `llm` 변경에 재생성되고 `capabilities`가 바뀐다. 진행 중인 요청은 옛 능력으로 끝나고, 다음 요청부터 새 능력이 적용된다.
- `measureInputUsage`가 없는 구버전 Chrome: 옵셔널 호출로 감싸고, 부재 시 고정 캡만 적용한다(측정 실패가 기능을 막지 않는다).

## 성공 기준

1. compact 초안 system prompt가 **컨텍스트 없는 기본 상태에서 500토큰 이하**다 (테스트로 문자 예산 단언).
2. 이미지 미지원 좌표(나노)의 프롬프트에 **이미지·스크린샷 언급이 없고**, 그 경로에서 `images`가 `undefined`로 전달되며 인라인 이미지 resolve가 호출되지 않는다.
3. AI 응답이 `notes` 섹션을 누락해도 **사용자가 쓴 `notes` 텍스트가 보존**된다.
4. 사용자가 편집한 prop이 30개를 넘는 요소에서도 **cap 이후 프롬프트에 남아 있다**.
5. rich의 컨텍스트 상한이 compact보다 크고(diffs·토큰·스타일), rich 스타일링 프롬프트에 레이아웃 컨텍스트가 포함된다.
6. rich 스타일링 프롬프트에 `"You CAN and MUST change CSS"` 류의 거절방지 문구가 없다.
7. compact에서 `responseConstraint`가 강제하는 규칙(JSON only / no fences / no extra fields / denied prop 목록)이 프롬프트에 없다. rich에는 **남아 있다**(BYOK structured output 미연결이 비목표이므로).
8. 나노 스타일링 멀티턴에서 첫 턴에 요소 상태가 중복 전송되지 않고, 이후 턴은 delta만 보낸다.
9. `createChromeAIProvider`·`createSession`에 단위 테스트가 존재한다.
10. `pnpm test` · `pnpm typecheck` 통과. 기존 AI e2e(`ai-styling.spec.ts`) green 유지.
