---
description: e2e 시나리오를 Playwright spec으로 변환하고 실행-수정 루프로 green까지 자기완결. 유일하게 빌드(build:e2e)가 허용되는 작성 단계.
---

tasks.md의 "e2e 시나리오" 섹션(또는 사용자 지시)을 `e2e/*.spec.ts` 코드로 변환하고, 실행-수정 루프를 돌려 green까지 만든다. e2e spec은 셀렉터·타이밍 함정 때문에 실행 없이는 검증 불가 — 그래서 이 스킬만 빌드·실행이 허용된다.

## 사용

- `/e2e-write` — 직전 컨텍스트(방금 끝낸 `/feature`·`/implement`의 tasks.md "e2e 시나리오")에서 대상 자동 판단.
- `/e2e-write <시나리오 설명 또는 spec 경로>` — 대상 명시.

## 절차

1. **대상 시나리오 확정.** tasks.md "e2e 시나리오" 섹션 또는 사용자 지시에서 변환할 시나리오를 추린다. "~하면 ~가 된다"로 스크립트 판정 가능한 문장만 대상 — 판정 불가 항목(시각 정합 등)은 수동 잔여로 보고.

2. **spec 작성/갱신.** `e2e/` 컨벤션을 따른다:
   - fixture·헬퍼는 `e2e/fixtures/extension.ts`의 것을 사용 (`ext` worker fixture, `pickElement`/`typeStyleValue`/`setQuadLinkedValue`/`closeAllPopovers`).
   - 셀렉터는 `data-testid` 우선. 섹션 제목 등 i18n 텍스트 의존 금지. CSS prop 라벨(`color`, `padding`)은 하드코딩이라 허용.
   - [다음]류 `aria-disabled`+가드 버튼은 클릭 전 `aria-disabled` 부재 단언 필수 (actionability가 막지 않음).
   - 상태 연속 플로우는 `test.describe.serial`.

3. **빌드.** `pnpm build:e2e` — **dist-e2e 전용**. `pnpm build`(dist) 금지.

4. **실행-수정 루프.** `pnpm test:e2e`(또는 대상 spec만)를 돌리고 실패를 수정한다. **최대 8회** — 초과하면 남은 빨강을 보고하고 종료.
   - 수정 허용 범위: `e2e/**` 전체 + **src의 `data-testid` 속성 추가만** (로직·구조·스타일 변경 금지).
   - 그 외 src 변경이 필요해 보이면(구현 결함) **수정하지 말고 보고 후 종료** — `/implement` 영역.

5. **연속 통과 확인.** green 후 동일 spec을 1회 재실행해 연속 통과(flaky 없음)를 확인한다.

6. **보고 + 종료.** 작성/갱신한 spec 목록, 루프 횟수, 수동 잔여 항목을 보고. **커밋 안 함.**

## 금지 사항

- `pnpm build`(dist 산출) 금지 — 이 스킬의 빌드는 `build:e2e`뿐.
- src 수정은 `data-testid` 속성 추가만. 그 외는 보고 후 종료.
- 기존에 green이던 spec의 기대값을 통과 목적으로 약화 금지 — 회귀로 보고.
- flaky 대응으로 retry 추가·timeout 늘리기 남발 금지 — 원인(셀렉터·타이밍)을 고친다.
- 커밋·푸시 안 함.
