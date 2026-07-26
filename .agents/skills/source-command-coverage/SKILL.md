---
name: "source-command-coverage"
description: "커버리지를 측정하고 베이스라인 대비 이전→지금을 비교, 회귀·개선 후보를 리포트. 개선 시 베이스라인 래칫 갱신. fix·빌드·커밋 안 함."
---

# source-command-coverage

Use this skill when the user asks to run the migrated source command `coverage`.

## Command Template

테스트 커버리지를 측정하고 **로직 스코프**(테스트 대상 코드) 다이얼을 중심으로 이전→지금 변화를 리포트한다. TDD 개발 원칙의 정량 지표. 리포트 전용 — 코드·테스트 수정, 빌드, 커밋은 하지 않는다.

## 왜 로직 스코프인가

전체 라인 % 는 의도적으로 유닛테스트하지 않는 코드(content DOM 스크립트, `*.tsx` 렌더, OAuth 런처, 미디어/캔버스 런타임, SW 엔트리)가 분모에 섞여 있어 아무리 로직 테스트를 늘려도 잘 안 움직인다. 그래서 **주 지표는 "로직 스코프" 라인 %**(브라우저 전용 코드를 분모에서 제외)이고, 전체 %·Branch·Func 는 병기한다. 제외 규칙 단일 출처는 `scripts/coverage-report.mjs`의 `isBrowserBound()` — 유닛테스트 불가능한 새 런타임 파일을 추가했으면 여기에 등록한다(안 그러면 로직 다이얼이 노이즈로 눌린다).

## 실행

1. `pnpm test:coverage` 실행 (timeout 300000ms 넉넉히). vitest v8 커버리지가 `coverage/coverage-summary.json` 산출. 테스트가 하나라도 실패하면 커버리지 수치는 무의미 — 실패부터 보고하고 멈춘다.
2. `pnpm coverage:report` 실행 → 로직/전체 지표 + 베이스라인 대비 델타 + 래칫 회귀 + 개선 후보 출력.

## 리포트 원칙

- **헤드라인**: 로직 스코프 Lines % (델타 pp 포함) 를 맨 위에. 전체 Lines/Branch/Func 는 그 아래 병기.
- **래칫**: 베이스라인 대비 커버가 떨어진 로직 파일을 경고로 나열. 하락 없으면 "✅ 래칫 통과" 한 줄. **막지는 않는다**(리포트 + 경고 게이트).
- **개선 후보**: 스크립트가 뽑은 상위 목록(로직 스코프·미커버 라인 많은 순)을 그대로 옮기고, 그중 **실제로 유닛테스트를 붙일 만한 것**(순수 함수·파서·요청빌더 위주)을 2~3개 골라 "다음에 뭘 테스트하면 지표가 얼마나 오르는지"를 한두 줄로 제안한다. 브라우저 실동작에 걸린 후보(있으면)는 e2e/수동 영역이라고 표시.
- 수치는 반올림 1자리, 간결하게.

## 베이스라인 래칫

- 커버리지가 **개선됐고**(로직 % 상승 또는 하락 파일 0) 그 상태를 트렌드로 고정하고 싶으면 `pnpm coverage:update` 로 `coverage/baseline.json` 을 갱신하라고 **제안**한다. 자동 갱신하지 않는다 — 사용자가 확인 후 결정.
- `coverage/baseline.json` 은 git-tracked (트렌드 공유). 갱신했으면 `chore(coverage): ratchet baseline` 류 커밋으로 남긴다(이 스킬은 커밋 안 하므로 안내만).
- 회귀(하락 파일)가 있으면 베이스라인 갱신을 **제안하지 않는다** — 회귀를 덮으면 래칫이 무의미해진다. 하락 원인(삭제된 테스트·새 미커버 코드)을 짚어준다.

## 주의

- 이 스킬은 **측정·비교·제안만** 한다. 테스트 작성은 `/tdd`, 반영은 `/implement`·`/refactor` 소관.
- `coverage/` 리포트 본체는 `.gitignore` (커밋 대상은 `baseline.json` 하나).
