---
name: "source-command-e2e-run"
description: "e2e 전체 스위트를 로컬에서 실행 + 리포트 전용. fix·spec 수정 금지."
---

# source-command-e2e-run

Use this skill when the user asks to run the migrated source command `e2e-run`.

## Command Template

e2e 스위트를 빌드·실행하고 결과만 리포트한다.

**게이트가 아니다.** e2e 차단 게이트는 CI(`.github/workflows/ci.yml`의 `e2e` 4샤드 → `e2e-gate` required check)가 단독으로 맡는다. 이 스킬은 **CI를 기다리지 않고 미리 보고 싶을 때** 쓰는 로컬 도구다 — 예: 광범위한 리팩터 직후, spec을 여러 개 건드린 뒤, CI가 빨간 이유를 로컬에서 재현할 때. 특정 샤드만 재현하려면 `pnpm test:e2e --shard=N/4`(플래그엔 `--`를 붙이지 않는다 — 붙이면 positional 필터로 읽혀 매칭 0건이 된다).

> ⚠️ **dist-e2e는 테스트 전용이다.** manifest에 `<all_urls>`가 들어가므로 Chrome에 수동 로드하거나 스토어에 업로드하지 않는다. 배포 산출물은 `pnpm build`(dist)·`pnpm build:store`만.

## 절차

1. **빌드.** `pnpm build:e2e` — dist-e2e 산출. `pnpm build`(dist) 금지.

2. **실행.** `pnpm test:e2e`.

3. **리포트.** exit code와 무관하게 결과를 요약하고 종료:
   - 통과 N / 실패 N
   - 실패별: `spec:체크명 — 1줄 원인 + trace 경로` (`trace: retain-on-failure`라 실패 시 `e2e/test-results/`에 trace 존재)

## 금지 사항

- **빨강이어도 수정 시도 금지** — spec·src 일체 수정 없음. 리포트 전용. fix는 `/e2e-write`(spec 결함) 또는 `/implement`(구현 결함)로 사용자가 별도 호출.
- `pnpm build`(dist) 금지.
- 커밋·푸시 안 함.
- 후속 스킬 자동 제안 금지.
