# e2e 테스트 워크플로우

## 배경

style-changes-dialog 구현에서 Playwright PoC를 수행한 결과, 사이드패널 확장의 핵심 UI 플로우(패널 진입 → picker 선택 → 스타일 수정 → 다이얼로그 조작)를 스크립트로 완주·검증할 수 있음이 입증됐다(16개 체크 × 3회 연속 통과). 현재 수동 테스트 체크리스트는 상태 분기가 많은 UI일수록 반복 비용이 크고, 단위 테스트·4관점 리뷰가 못 잡는 통합 동작(예: reload 시 세션 보존 정책과 다이얼로그 상호작용)이 존재한다. PoC에서 확보한 인프라 노하우(Chrome for Testing, manifest 후처리, Radix 셀렉터 함정)를 영구 스위트와 스킬 라인업으로 정착시킨다.

## 목표

- 커밋된 영구 e2e 스위트: 스모크 1본 + style-changes-dialog 회귀(PoC 16개 체크 이식)가 `pnpm test:e2e` 한 번으로 실행된다.
- e2e 전용 빌드(`dist-e2e/`)가 배포용 `dist/`를 절대 오염시키지 않는다.
- 스킬 2개 신설: `/e2e-write`(spec 작성 + 실행-수정 루프 → green 자기완결), `/e2e-run`(실행 + 리포트 전용).
- 기존 스킬 편입: `/build`가 e2e를 자동 실행해 결과를 리포트하고, `/merge`가 e2e 게이트(빨강이면 중단)를 통과해야 PR을 만든다.
- 중복 실행 회피: green 시점의 커밋 해시를 기록해 `/merge`가 동일 HEAD면 재실행을 스킵한다.
- `/feature` 산출물(tasks.md)에 "e2e 시나리오" 섹션이 표준으로 들어가고, `/implement` 보고에 "e2e 영향" 플래그가 추가된다.

## 비목표 (Non-goals)

- CI(GitHub Actions) 실행 — 1차는 로컬 전용. 러너·headless 검증이 안정된 뒤 별도 과업.
- 기존 전체 플로우(스크린샷·freeform·로그 탭 등)의 e2e 커버 — 스모크 + 다이얼로그 회귀만. 이후 기능 작업마다 `/e2e-write`로 증분 추가.
- captureVisibleTab 이미지 정합·quota·스크롤 복원 검증 자동화 — 기술적으로 불가, 수동 체크리스트로 유지.
- headless 실행 — 1차는 headed. CI 과업에서 검토.
- 멀티 브라우저/멀티 OS.

## 사용자 시나리오

### S1. 기능 구현 후 e2e spec 작성 (`/e2e-write`)
1. `/implement` 완료 보고에 "e2e 영향: 시나리오 N개 추가 필요 ⚠️"가 표시된다.
2. 사용자가 `/e2e-write`를 실행한다.
3. 스킬이 tasks.md의 "e2e 시나리오" 섹션을 읽어 spec 파일을 작성/갱신하고, `dist-e2e`를 빌드해 실행-수정 루프를 돌아 green까지 만든 뒤 보고한다.
4. spec이 요구하는 `data-testid`가 소스에 없으면 속성 추가에 한해 src를 수정한다(로직 변경 금지).

### S2. 작업 중 검증 (`/build`)
1. 사용자가 `/build`를 실행한다.
2. `pnpm build` 성공 후 자동으로 e2e가 실행된다(`dist-e2e` 빌드 + 스위트 실행).
3. 결과가 통합 보고된다: e2e 통과/실패 요약 + 자동화 안 된 항목만 추린 수동 체크리스트.
4. e2e가 빨강이어도 `/build`는 리포트만 하고 종료한다 — fix는 사용자 결정.
5. green이면 현재 커밋 해시가 `e2e/.last-green`에 기록된다.

### S3. 머지 게이트 (`/merge`)
1. 사용자가 `/merge`를 실행한다.
2. 버전 bump 전에 e2e 게이트: `e2e/.last-green`이 HEAD와 일치하면 "직전 green" 한 줄로 스킵, 아니면 실행.
3. 빨강이면 실패 리포트를 남기고 **중단** — PR을 만들지 않는다.
4. 사용자가 명시적으로 우회를 요청한 경우("skip e2e")에만 게이트를 건너뛴다.

### S4. 시나리오의 출생 (`/feature` → `/feature-review`)
1. `/feature`가 tasks.md 테스트 계획에 "e2e 시나리오"(자동화 가능 문장) / "수동 테스트"(자동화 불가) 섹션을 분리해 작성한다.
2. `/feature-review`의 QA Lead가 e2e 시나리오의 검증 가능성(스크립트로 판정 가능한 문장인가)을 검수한다.

### 엣지 케이스
- 미커밋 변경이 있는 상태의 `/e2e-run` green: 해시 기록은 워킹 트리가 클린할 때만 — dirty면 기록을 생략하고 보고에 명시.
- spec 실행 중 flaky 의심(간헐 실패): `/e2e-write`는 green 후 동일 spec을 1회 재실행해 연속 통과를 확인한다. retries는 0으로 둔다(flaky를 숨기지 않음).
- `dist-e2e` 빌드 실패: e2e 실행 전 단계에서 중단하고 빌드 에러를 보고.

## 성공 기준

- [ ] `pnpm test:e2e`가 클린 체크아웃(+ `pnpm install`, `playwright install chromium`, `pnpm build:e2e`)에서 스모크 + 다이얼로그 회귀 전부 green.
- [ ] 3회 연속 실행 green (flaky 없음).
- [ ] `pnpm build` 산출물 `dist/manifest.json`에 `<all_urls>`가 절대 포함되지 않음.
- [ ] `/build` 1회 실행으로 "빌드 + e2e 결과 + 잔여 수동 체크리스트"가 한 번에 보고됨.
- [ ] e2e 빨강 상태에서 `/merge`가 PR 생성 전에 중단됨.
- [ ] `/merge`가 `.last-green == HEAD`일 때 e2e를 재실행하지 않음.
