# es/de 로케일 오케스트레이션

계획 원본: [tasks.md](./tasks.md). 별도 PRD/design 없음(기존 fr 추가 구조 재사용).

## 착수·결정

- 시작 dev: `3f0d44a377c0ece19fcdd6f4f40621d4b60df348`, 미커밋 변경 없음.
- 사용자 요청: 스페인어·독일어 i18n을 orch로 진행, 원어민 검수 없음.
- 모델 합의: 구현 sol high, 리뷰 astra medium. astra high는 비용 사유로 제외. 다른 모델/effort를 임의로 추가하지 않는다.
- 구현은 두 언어를 한 워커가 담당한다. 사전 파일이 겹치므로 언어별 병렬 분할을 하지 않는다.
- 종착점: 사용자 제공 AGENTS.md에 따라 로컬 dev 통합·커밋 후 Claude Code `/push` 인계. 원격 CI는 이 세션에서 완료 주장하지 않는다.

## 배치·소유권

| 배치 | 소유 범위 | 선행 | 모델 / effort | 게이트 | 상태 |
|---|---|---|---|---|---|
| 구현 | src/i18n, src/log-viewer/i18n.ts, public/_locales, localeLabels/aiLanguage, 관련 unit/e2e, 가이드·README 등 지원 언어 안내 | 계획 커밋 | gpt-6-sol / high — 기존 패턴의 번역·등록 | TDD, typecheck, 전체 test, mirror check, 관련 e2e | 진행 |
| 독립 리뷰 | 구현 diff 읽기, .scratch 리뷰 보고만 | 구현 완료 | gpt-6-astra / medium — 누락·회귀 검증, 사용자 비용 제한 | 계획·증거 대조, 미해소 red/yellow 판정 | 대기 |
| 수정 | 리뷰 지적의 구현 소유 파일 | 리뷰 결과 | gpt-6-sol / high | 변경 범위 검증 및 필수 게이트 | 필요시 |
| 통합 | cherry-pick, tasks/orch 상태·문서 신선도 | 리뷰 통과 | 지휘자 | typecheck, 전체 test, mirror check | 대기 |

## 겹침·순서

| 작업 쌍 | 겹침 | 운영 |
|---|---|---|
| es / de 구현 | namespaces 전체·레지스트리·로그 뷰어·테스트 | 구현 한 배치 |
| 구현 / 리뷰 | 같은 diff, 리뷰는 읽기 전용 | 직렬 |
| 구현 / 지휘자 | 계획 상태·공통 문서 | 지휘자는 배치 코드 수정 금지, 구현 종료 후 문서 통합 |

## 실행 기록

- 계획 커밋: `266903e8`.
- Orca Run: `run_641efb0b48d5`, 구현 Task: `task_bef729a635da`.
- 구현 worktree: `/Users/sinhyeokkang/orca/workspaces/bugshot-2/es-de-locales`, 시작 HEAD `266903e8`, 시작 상태 clean 확인.
- 최초 Dispatch `ctx_5c33af04e509`는 Codex CLI 업데이트 안내에서 task 전달 전 실패. 업데이트를 건너뛰고 동일 sol/high 프로세스를 재사용했다(설치·권한 변경 없음).
- 활성 Dispatch: `ctx_5321c45c9d2d`, terminal `term_4be190ca-0e55-4a6f-a718-1841ff7e36ac`. 모델/effort는 최초 launch.effective에서 `gpt-6-sol`/`high` 확인. 재사용 작업의 turn_started 확인.

## 잔여

- 구현 진행 중, 검증·독립 리뷰·통합 대기.
- 원어민 검수 제외(사용자 결정). push 및 원격 CI는 Claude Code 인계 대상.
