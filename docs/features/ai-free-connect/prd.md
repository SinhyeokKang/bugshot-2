# 무료 AI 연결 (ai-free-connect)

## 배경

AI 초안·AI 스타일링을 제대로 쓰려면 rich 경로가 필요하고, rich 경로는 BYOK 연결이 있어야 열린다. 그런데 지금 연결 화면은 [API 키 연결] 하나뿐이다. 사용자가 키 발급처를 스스로 찾아가 키를 만들고, 다시 돌아와 붙여넣어야 한다. 키가 없는 신규 사용자는 여기서 이탈하고, 결국 Chrome 내장 AI(compact — 이미지 없음, 컨텍스트 1만 자)에 머문다.

무료로 쓸 수 있는 LLM 중 BugShot 요구(OpenAI 호환 + 이미지 입력)를 충족하는 것은 두 곳이다.

- **Gemini (Google AI Studio 무료 티어)**: 키 발급 API가 없다. 다만 발급 페이지(`aistudio.google.com/apikey`)는 고정 URL이라, 그 페이지로 곧장 보내는 동선을 줄일 수 있다.
- **OpenRouter**: OAuth PKCE를 공식 지원한다. 로그인하면 사용자 명의 API 키가 발급돼 돌아온다. client secret이 없어 `oauth-proxy`를 거치지 않는다. 즉 **브라우저 → OpenRouter 직행**이라 클라이언트 온리 구조(CLAUDE.md 코어 밸류)와 충돌하지 않는다.

두 곳 모두 무료 티어의 데이터 취급이 유료와 다르다. Gemini 무료 티어는 프롬프트를 Google 제품 개선(학습)에 쓸 수 있고(EEA·UK·CH 제외), OpenRouter 무료 모델은 상류 provider가 프롬프트를 로그로 남길 수 있다. BugShot 프롬프트에는 스크린샷·로그 요약이 실리므로 **연결 전에 이 차이를 고지하는 것이 기능의 일부**다.

`docs/features/DROPPED.md`에 관련 드랍 항목 없음(키워드 `openrouter`·`gemini`·`byok`·`llm`·`무료`·`free`·`onboard` grep 0건).

## 목표

1. AI 설정 연결 전 화면에서 [API 키 연결](primary) 왼쪽에 **[무료 AI 연결]**(outline) 버튼이 보인다.
2. [무료 AI 연결]을 누르면 모달 1단계에 프리셋 카드 2개(Gemini·OpenRouter)가 뜬다. 각 카드에는 모델 정보·무료 한도·프라이버시 주의사항이 함께 보인다. 카드를 고르고 [다음]을 누르는 것이 고지 확인이다(체크박스 없음).
3. **Gemini**: [다음]을 누르면 AI Studio 키 발급 페이지가 **팝업 창**으로 열린다. 모달은 2단계(키 입력)로 넘어간다. 키를 넣고 [연결]하면 기존 모델 선택 다이얼로그가 뜨고, 목록에는 무료 티어 모델만 보인다. 고르면 연결이 끝난다.
4. **OpenRouter**: [다음]을 누르면 OpenRouter 로그인 창이 뜨고(`chrome.identity.launchWebAuthFlow`), 승인하면 키가 자동 발급된다. 이어서 모델 선택 다이얼로그가 뜨는데, 목록은 `:free`이면서 이미지 입력을 받는 모델로 제한된다. 고르면 연결이 끝난다.
5. 그런 모델이 0개면 연결하지 않는다. 대신 "지금 쓸 수 있는 무료 이미지 모델이 없다" 토스트를 띄우고 Gemini 경로를 권한다.
6. 연결 후에는 기존 `LlmConnected` 화면을 재사용한다. 무료 경로로 연결한 경우에만 모델 변경 목록이 무료 모델로 필터된다(OpenRouter = `:free`+이미지, Gemini = 무료 티어 플래그).
7. PostHog `llm_connect` 이벤트를 무료 경로와 BYOK 경로 **양쪽에서** 집계한다. props는 `provider`(프리셋 ID 또는 `custom`)·`path`(`free`|`byok`)·`result`(`success`|`cancelled`|`failed`) 셋뿐이다.

## 비목표 (Non-goals)

- **BugShot이 키를 대신 보유·중계하는 것.** 자체 키 내장은 키가 노출되고, 프록시 경유는 캡처 데이터가 BugShot 서버를 지난다. 어느 쪽이든 코어 밸류와 충돌한다.
- **Gemini 키 자동 발급.** 공개 발급 API가 없다. 사용자마다 GCP 프로젝트를 만들고 민감 scope 심사를 받아야 하는 OAuth 경로는 채택하지 않는다.
- **Groq 등 다른 무료 티어 추가.** Groq 무료 모델은 텍스트 전용이라 원격 BYOK의 `supportsImages: true` 전제와 맞지 않는다.
- **모델 단위 capability 강등.** 텍스트 전용 무료 모델로 폴백하는 경로는 만들지 않는다(목표 5에서 차단).
- **연결 해제 시 OpenRouter 키 폐기(revoke).** 로컬 설정만 지운다. 발급된 키는 사용자 OpenRouter 계정에 남는다는 사실을 카드와 privacy 문서에 적는다.
- **BYOK 경로(`LlmConnectDialog`)의 UX 변경.** 연결 로직 추출과 집계 호출 추가 외에는 손대지 않는다.
- **무료 한도 실시간 표시.** 한도 수치는 카드의 정적 문구로만 안내한다.

## 사용자 시나리오

### S1. Gemini로 무료 연결
1. 설정 > AI 모델 서브탭(연결 전)에서 [무료 AI 연결]을 누른다.
2. 모달 1단계에서 Gemini 카드를 고르고 [다음]을 누른다.
3. AI Studio 키 페이지가 팝업 창으로 뜨고, 모달은 2단계(API 키 입력)로 넘어간다. 원래 탭과 사이드패널은 그대로 보인다.
4. 팝업에서 키를 만들어 복사한 뒤 패널 입력란에 붙여넣고 [연결]을 누른다.
5. 모델 선택 다이얼로그에서 무료 티어 모델을 고르면 연결 화면으로 바뀐다.

엣지:
- 팝업을 닫아버렸다 → 2단계의 "발급 페이지 다시 열기"로 다시 연다.
- 잘못된 키 → 기존 `llm.error.fetch` 토스트가 뜨고 2단계에 머문다.
- 2단계에서 [이전] → 1단계로 돌아가고 입력값은 지워진다.
- 모델 선택 다이얼로그를 닫으면 연결되지 않고 2단계로 돌아간다(키 입력값 유지).

### S2. OpenRouter로 무료 연결
1. 모달 1단계에서 OpenRouter 카드를 고르고 [다음]을 누른다.
2. OpenRouter 로그인·승인 창이 뜬다. 계정이 없으면 그 창에서 가입한다. 대기 중에는 [다음]에 스피너가 돈다.
3. 승인하면 키 교환이 끝나고 무료+이미지 모델 목록을 가져와 모델 선택 다이얼로그를 띄운다.
4. 모델을 고르면 연결 화면으로 바뀐다.

엣지:
- 로그인 창을 닫거나 거부한다 → 토스트 없이 1단계에 머문다(`result: cancelled`).
- `state` 불일치, `code` 누락, 교환 실패 → `llm.free.error.openrouter` 토스트를 띄우고 1단계에 머문다(`failed`).
- 무료+이미지 모델이 0개 → `llm.free.error.noFreeVisionModel` 토스트를 띄우고 1단계에 머문다(`failed`). 발급된 키는 저장하지 않는다.
- 모델 선택 다이얼로그를 닫는다 → 연결하지 않고 1단계로 돌아간다. 발급된 키는 버린다(OpenRouter 계정에는 남는다).
- [다음]을 연타한다 → 진행 중에는 버튼이 비활성이라 flow가 두 번 뜨지 않는다.

### S3. 무료 경로로 연결한 뒤 모델 변경
1. 연결 화면의 모델 콤보에서 목록을 연다.
2. OpenRouter는 `:free`+이미지 모델만, Gemini는 무료 티어 모델만 보인다.
3. 이후 [API 키 연결]로 다시 연결하면(해제 후 재연결) `freeTier` 표식이 없어 전체 목록이 보인다.

## 성공 기준

- S1·S2를 실제 계정으로 끝까지 수행해 AI 초안이 스크린샷 포함으로 생성된다(수동).
- 무료 경로·BYOK 경로 모두에서 `llm_connect` 이벤트가 PostHog에 도착하고, props가 세 키로 제한되며, `provider` 값이 프리셋 ID 또는 `custom`만 나온다.
- `pnpm typecheck`·`pnpm test` green.
- docs/privacy ko/en과 guide/settings/ai ko/en이 새 동작을 반영한다.
