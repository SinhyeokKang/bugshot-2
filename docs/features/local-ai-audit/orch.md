# 감사 후속 수정 지휘 기록

## 범위·기준

- 원본 계획: [tasks.md](./tasks.md), 직전 대화 감사 항목 1–6.
- 시작 dev: `d3df521443013b50b073f970cde7042457872b0d`.
- 구현은 Orca Codex 워커의 격리 워크트리, 지휘자는 리뷰·통합·문서·검증을 소유한다.
- 기존 미추적 `.scratch/brief-{viewer,connect,capture}.md`는 사용자 작업으로 보존하며 커밋하지 않는다.

## 결정 기록

- 사용자: 6건 전부 수정, orchestrate 수행 승인. dev push·CI 확인까지이며 main은 건드리지 않는다.
- C: AI 생성 동안 배경을 실제로 비활성화하는 최소 수정으로 편집 유실을 방지한다.
- D: 한국어에서 영어 폴백+안내 또는 로컬 AI 비활성화 여부를 질문했다. 답변 전 언어 관련 구현은 보류한다.
- 모델·effort: 사용자 모델 지정이 없어 Orca의 설정된 Codex 모델·effort를 상속한다(현재 CLI coordinator-loop 규칙). 시작 영수증의 실제 값을 기록한다.

## 배치·소유권

| 배치 | 항목 | 소유 파일 | 선행 | 상태 |
|---|---|---|---|---|
| A settings | 1 | settings-ui-store, 새 app-settings 저장/동기화 leaf, main.tsx 및 해당 테스트 | 없음 | 준비 |
| B blobs | 2 | editor-store, blob 저장 회귀 테스트 | 없음 | 준비 |
| C overlay | 3 | App.tsx, AI overlay 접근성 컴포넌트/테스트, 관련 e2e | 없음 | 준비 |
| D chrome-ai | 4–6 | useAI, ai-provider, compact prompt, 재현 생성, AI 설정 UI, i18n ai 사전 및 테스트/e2e | A·C 통합, 언어 결정 | 대기 |

## 겹침·순서

A/B/C 소유 파일은 서로 겹치지 않으며 병렬 실행한다. D는 UI와 settings 소비처를 건드리므로 A/C 뒤에 실행한다. 모든 배치에서 CLAUDE.md·AGENTS.md·스킬·ARCHITECTURE·DIRECTORY·POSTMORTEM·coverage baseline·계획 문서는 편집 금지이며 필요한 갱신 내용을 인계한다. i18n은 D만 소유한다. 예기치 않은 파일 겹침은 수정 전에 지휘자에게 보고한다.

## 검증·통합 기록

- 워커 게이트: `pnpm typecheck`, `pnpm test`, `pnpm sync:agents:check` 종료 코드. 파이프 필터 금지.
- 회귀를 고정한 테스트, 독립 리뷰, 수정 라운드, 커밋, 문서·런타임 검증, CI 증거를 아래 누적한다.
- 실제 Nano 다운로드·언어 출력은 mock으로 증명하지 않는다. 가능한 실제 Chrome 환경을 확인하고 미검증이면 명시한다.
