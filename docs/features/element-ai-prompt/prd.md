# Element mode AI draft — user prompt 입력

## 배경

현재 AI 초안 생성은 mode별로 진입 동작이 비대칭이다.

- `element` 모드: AI 버튼 클릭 즉시 LLM 호출. 스타일 diff + 디자인 토큰만으로 초안 자동 생성. 사용자가 맥락(상황 설명, 의도, 이름·도메인 용어)을 주입할 수단이 없다.
- `screenshot` / `video` / `freeform`: AI 버튼 → `AiDraftDialog` → textarea로 사용자 설명 입력 → LLM 호출.

element 모드의 결과물은 "스타일 X를 A에서 B로 바꿔야 한다" 수준의 기계적 서술이라, 실제 버그 상황(예: 다크 모드 전환 시 / 폼 검증 실패 시 / 특정 권한 사용자에게서만 발생)을 담지 못한다. 사용자가 한두 문장만 더 주면 초안 품질이 크게 올라가지만 입력 경로가 없다.

또한 모드 간 UX 비대칭(한 번 클릭 vs 다이얼로그 입력 → 클릭)이 학습 부담을 키운다.

## 목표

1. element 모드에서도 AI 초안 생성 시 사용자가 prompt를 입력할 수 있다. 입력은 **선택적**이다 — 비워두면 기존 element 동작(스타일 diff 기반 자동 생성)이 유지된다.
2. element 모드 AI 호출 시 picker가 찍은 element 캡처 이미지(`beforeImage` + `afterImage`)를 LLM에 동봉한다. prompt 유무와 무관하게 항상 첨부한다.
3. AI draft 진입 UX가 모드 간 일관된다 — 어느 모드에서도 AI 버튼은 `AiDraftDialog`를 띄운다.

## 비목표 (Non-goals)

- element 모드에 콘솔/네트워크 로그 자동 첨부. (사용자가 명시적으로 제외)
- 다이얼로그 안에 스타일 diff 미리보기 추가. 다이얼로그는 textarea + 제출 버튼만 유지.
- 다른 모드(screenshot/video/freeform)의 동작 변경.
- LLM 프로바이더 추가나 비용·토큰 산정 UI 변경.
- AI 초안 결과의 후처리·UX(가독성 개선, 인라인 편집 등) 변경.

## 사용자 시나리오

### 시나리오 1: 빈 prompt로 기존 동작 유지

1. 사용자가 element 모드로 요소를 선택하고 스타일을 변경한다.
2. drafting 단계로 진입. AI 버튼이 보인다.
3. AI 버튼 클릭 → `AiDraftDialog`가 뜬다.
4. 사용자가 입력 없이 "생성" 버튼을 누른다.
5. LLM이 스타일 diff + 토큰 + element 캡처 이미지(before/after)를 받아 초안을 생성한다.
6. draft 폼이 채워진다. 기존 동작과 동일한 결과 품질을 유지.

### 시나리오 2: prompt로 맥락 추가

1. 사용자가 다크 모드에서만 발생하는 색상 대비 버그를 발견. element 모드로 잡아 색상을 desired 값으로 바꾼다.
2. drafting 진입 → AI 버튼 클릭 → 다이얼로그가 뜬다.
3. textarea에 "다크 모드에서만 텍스트가 배경에 묻혀 안 보임. light에선 정상." 입력.
4. "생성" 클릭. LLM이 prompt + 스타일 diff + 이미지를 모두 보고 초안을 생성.
5. description/expectedResult가 사용자 맥락을 반영한 서술로 작성된다.

### 시나리오 3: 다른 모드 회귀 미발생

1. screenshot 모드로 캡처 → AI 버튼 → 다이얼로그 뜸 → prompt 입력 → 생성. 이전과 동일.
2. freeform 모드도 동일. textarea가 비어 있으면 "생성" 비활성 유지.

### 엣지 케이스

- element 캡처가 없을 때(이미지가 null): AI 호출 시 이미지 없이 진행. 다이얼로그는 정상 뜬다.
- element 모드인데 selection이 사라진 상태(이미 drafting): 기존 UI 가드(`if (captureMode === "element" && !selection) return null`)가 컴포넌트 자체를 안 그리므로 본 변경의 영향 없음.
- LLM 프로바이더가 이미지를 지원하지 않을 때(예: 텍스트 전용 provider 사용 중): 이미지 옵션이 무시되고 텍스트 prompt만 사용. 기존 screenshot 모드의 동작 패턴 그대로 (LLM provider 추상화가 알아서 처리).

## 성공 기준

- element 모드 AI 버튼이 `AiDraftDialog`를 띄운다.
- 다이얼로그의 "생성" 버튼은 element 모드일 때 빈 textarea여도 활성 상태다.
- element 모드 + 빈 prompt 제출 시: 기존 element 동작과 동일한 컨텍스트(스타일 diff + 토큰) + element 캡처 이미지가 LLM에 전달된다.
- element 모드 + prompt 입력 제출 시: 사용자 prompt가 시스템 prompt에 포함되고 초안 본문에 반영된다.
- screenshot/video/freeform 모드는 동작 회귀 없음.
- `pnpm test` 통과 — 새로 추가된 `buildAiDraftSessionPrompt`의 element 케이스 단위 테스트 포함.
- `pnpm typecheck` 통과.
