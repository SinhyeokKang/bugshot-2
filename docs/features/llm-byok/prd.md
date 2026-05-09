# LLM BYOK (Bring Your Own Key)

## 배경

BugShot의 AI 기능(AI Draft, AI Styling)은 현재 Chrome 내장 LanguageModel API(Gemini Nano on-device)에만 의존한다. 이 API는 Chrome 특정 버전 + 플래그 활성화 + 모델 다운로드가 필요해 가용성이 제한적이다. 사용자가 이미 보유한 OpenAI, Anthropic(Claude), Groq, Together, OpenRouter, 로컬 Ollama 등의 API 키를 직접 설정해 더 높은 품질과 안정적인 AI 기능을 사용할 수 있어야 한다.

## 목표

1. 사용자가 OpenAI-호환 또는 Anthropic 엔드포인트(base URL + API key)를 설정할 수 있다.
2. 엔드포인트에서 사용 가능한 모델 목록을 가져와 선택할 수 있다. (Anthropic은 하드코딩 목록)
3. base URL 호스트네임으로 프로바이더를 자동 감지한다 (`api.anthropic.com` → Anthropic, 그 외 → OpenAI-호환).
4. 설정된 외부 API가 모든 AI 기능(Draft + Styling)에 단일 모델로 적용된다.
5. 외부 API가 미설정이면 Chrome AI로 자동 폴백한다.

## 비목표 (Non-goals)

- Anthropic · OpenAI 외 프로바이더별 전용 SDK/어댑터 (Google AI SDK 등)
- AI Draft용 / AI Styling용 모델 분리 설정
- 스트리밍 응답
- 사용량 추적 · 비용 추정
- API 키 암호화 (Chrome storage sandbox 수준 유지)

## 사용자 시나리오

### 시나리오 1: OpenAI 키로 설정

1. 설정 탭 → [AI 설정] 하위 탭 → "API 키 연결" 클릭
2. 다이얼로그에서 프로바이더 Combobox → "OpenAI" 선택 (기본값), API Key 입력 → "연결"
3. Chrome 호스트 권한 허용 프롬프트 승인 → 모델 목록 fetch 성공 → 다이얼로그 종료
4. 연결됨 패널에서 모델 콤보박스로 `gpt-4o-mini` 선택
5. AI Draft · AI Styling 배너 뱃지가 "Beta" → "OpenAI"로 변경
6. 이후 AI Draft · AI Styling 모두 GPT-4o-mini로 동작

### 시나리오 2: Groq/Together 등 대체 프로바이더

1. 다이얼로그에서 프로바이더 Combobox → "Groq" 선택
2. Groq API Key 입력 → "연결"
3. 모델 목록에서 `llama-3.3-70b-versatile` 선택

### 시나리오 3: Anthropic (Claude)

1. 다이얼로그에서 프로바이더 Combobox → "Anthropic" 선택, API Key 입력 → "연결"
2. 프리셋으로 Anthropic 감지 → 모델 목록 fetch 없이 즉시 연결
3. 연결됨 패널에서 하드코딩 모델 목록(claude-sonnet-4-6, claude-haiku-4-5-20251001 등)에서 선택

### 시나리오 3-1: Gemini

1. 다이얼로그에서 프로바이더 Combobox → "Gemini" 선택, API Key 입력 → "연결"
2. OpenAI-호환 엔드포인트로 모델 목록 fetch → 연결
3. 연결됨 패널에서 모델 선택 (gemini-2.5-flash 등)

### 시나리오 4: 로컬 Ollama

1. 다이얼로그에서 프로바이더 Combobox → "Ollama" 선택
2. API Key는 비워둠 (Ollama는 키 불필요)
3. "연결" → 모델 목록에서 로컬 모델 선택

### 시나리오 5: 미설정 (기존 사용자)

1. LLM 설정을 건드리지 않음
2. Chrome AI 사용 가능 → 기존과 동일하게 동작
3. Chrome AI도 불가 → AI 버튼 미표시 (기존 동작 유지)

### 시나리오 6: API 키 만료 · 오류

1. AI Draft 또는 Styling 시도 → API 호출 실패 (401 등)
2. 에러 토스트 표시 ("API 호출 실패. 설정에서 API 키를 확인하세요.")
3. 사용자가 설정에서 키 갱신

### 시나리오 7: 연결 해제

1. 설정에서 "연결 해제" 클릭
2. 저장된 base URL · API key · model 초기화
3. Chrome AI 폴백으로 복귀

## 성공 기준

- [ ] 설정 UI에서 base URL + API key + 모델을 설정할 수 있다
- [ ] "연결" 시 `/models` 엔드포인트로 모델 목록을 가져와 콤보박스에 표시한다
- [ ] 잘못된 API 키 / 도달 불가 URL에 대해 명확한 에러 메시지를 보여준다
- [ ] AI Draft가 설정된 외부 모델로 동작한다
- [ ] AI Styling이 설정된 외부 모델로 동작한다 (멀티턴 포함)
- [ ] LLM 미설정 시 Chrome AI로 폴백한다
- [ ] Chrome AI도 불가 시 AI 버튼이 표시되지 않는다 (기존 동작 유지)
- [ ] 설정이 세션 간 영속된다 (chrome.storage.local)
- [ ] API 키 없이 base URL만으로 연결 가능하다 (Ollama 등)
