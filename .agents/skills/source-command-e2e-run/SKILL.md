---
name: "source-command-e2e-run"
description: "e2e 전체 스위트 실행 + 리포트 전용. fix·spec 수정 금지. green & 클린 트리면 e2e/.last-green에 커밋 해시 기록."
---

# source-command-e2e-run

Use this skill when the user asks to run the migrated source command `e2e-run`.

## Command Template

e2e 스위트를 빌드·실행하고 결과만 리포트한다. `/push`·`/merge`의 e2e 게이트가 이 절차를 내장 호출한다.

> ⚠️ **dist-e2e는 테스트 전용이다.** manifest에 `<all_urls>`가 들어가므로 Chrome에 수동 로드하거나 스토어에 업로드하지 않는다. 배포 산출물은 `pnpm build`(dist)·`pnpm build:store`만.

## 절차

1. **빌드.** `pnpm build:e2e` — dist-e2e 산출. `pnpm build`(dist) 금지.

2. **실행.** `pnpm test:e2e`.

3. **리포트.** exit code와 무관하게 결과를 요약하고 종료:
   - 통과 N / 실패 N
   - 실패별: `spec:체크명 — 1줄 원인 + trace 경로` (`trace: retain-on-failure`라 실패 시 `e2e/test-results/`에 trace 존재)

4. **green 해시 기록.** 전체 green이면:
   - **워킹 트리 클린**(`git status --porcelain` 비어있음)일 때만 `git rev-parse HEAD > e2e/.last-green`.
   - dirty면 기록을 생략하고 **보고에 명시** (dirty 상태의 green은 커밋 해시와 코드가 불일치하므로 캐시 부적격).

## 금지 사항

- **빨강이어도 수정 시도 금지** — spec·src 일체 수정 없음. 리포트 전용. fix는 `/e2e-write`(spec 결함) 또는 `/implement`(구현 결함)로 사용자가 별도 호출.
- `pnpm build`(dist) 금지.
- 커밋·푸시 안 함.
- 후속 스킬 자동 제안 금지.
