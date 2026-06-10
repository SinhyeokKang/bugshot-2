# e2e 테스트 워크플로우 — 구현 태스크

## 선행 조건

- 권한·OAuth·외부 API 변경 없음. **배포용 manifest(dist/) 무변경** — `<all_urls>`는 `BUGSHOT_E2E_BUILD=1` 산출물(dist-e2e/)에만 들어간다. `docs/privacy.md` 영향 없음(테스트 전용 로컬 산출물, 스토어 업로드 경로와 분리).
- `@playwright/test` devDependency 설치 + `pnpm exec playwright install chromium` (1회, 로컬 캐시).
- PoC 비망(docs/features/style-changes-dialog/tasks.md Task 6) 참조 — Chrome for Testing, `<all_urls>` 요구, Radix 셀렉터 함정.

## 태스크

### Task 1: 빌드 인프라 — dist-e2e 분리
- **변경 대상**: `manifest.config.ts`, `vite.config.ts`, `package.json`(scripts·devDependencies), `.gitignore`, `vitest.config.ts`
- **작업 내용**: `BUGSHOT_E2E_BUILD=1` 분기(manifest `host_permissions`에 `<all_urls>` 추가, vite `outDir: "dist-e2e"`), scripts `build:e2e`·`test:e2e` 추가, `@playwright/test` devDep, `.gitignore`에 `e2e/.last-green`·`test-results`·`playwright-report` 추가. 기존 `BUGSHOT_STORE_BUILD` 분기와 동형으로. `vitest.config.ts` `test.exclude`에 `e2e/**` 추가 — vitest 기본 include(`**/*.spec.ts`)가 e2e spec을 수집해 `pnpm test`가 깨지는 것을 차단.
- **검증**:
  - [ ] `pnpm build:e2e` → `dist-e2e/manifest.json`의 `host_permissions`에 `<all_urls>` 포함, dev `key` 유지 (빌드는 `/e2e-write` 단계에서)
  - [ ] `pnpm build` → `node -p "JSON.parse(require('fs').readFileSync('dist/manifest.json','utf8')).host_permissions.includes('<all_urls>')"` 가 `false` (오염 0 — 성공 기준 핵심. content_scripts `matches`에는 원래 `<all_urls>`가 있으므로 문자열 grep·육안 확인 금지, host_permissions 배열 기준 판정)
  - [x] `pnpm typecheck` 통과

### Task 2: data-testid 부착
- **변경 대상**: `src/sidepanel/App.tsx`, `src/sidepanel/tabs/IssueTab.tsx`, `src/sidepanel/tabs/StyleEditorPanel.tsx`, `src/sidepanel/tabs/styleEditor/StyleChangesDialog.tsx`, `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**: design.md 표의 17개 testid 부착(속성 추가만 — 로직·구조·스타일 변경 금지. 단 `row-reset`/`element-reset`은 공용 `ResetButton`이라 **testid 전달용 prop 신설 허용** — 속성 전달 한정). `changes-card`엔 `data-source`/`data-selector`, `changes-row`엔 `data-prop` 데이터 속성 동반.
- **검증**:
  - [x] `pnpm typecheck` + `pnpm test` 통과 (기존 단위 테스트 회귀 없음 — 1555 tests green)
  - [x] `git diff`에 className·로직 변경 0건 (속성 추가만 — UI 검증 에이전트가 17개 전수 확인)

### Task 3: e2e 하네스 — fixture·config
- **변경 대상**: `e2e/playwright.config.ts`(신규), `e2e/fixtures/extension.ts`(신규), `e2e/fixtures/pages/basic.html`(신규), `tsconfig.e2e.json`(신규), `tsconfig.json`(references 추가)
- **작업 내용**: design.md 인터페이스대로 worker-scoped `ext` fixture(정적 서버는 포트 0(ephemeral) 바인딩 — 실포트를 `fixtureUrl`에 반영·persistent context·extension id·teardown) + 헬퍼(`pickElement`/`typeStyleValue`/`setQuadLinkedValue`/`closeAllPopovers`/`openPanel`/`fixtureTabId`). config는 workers:1·retries:0·headed·`trace: "retain-on-failure"`. basic.html은 PoC fixture 승계(#title color+padding 명시, #card.card.box 텍스트 보유). `tsconfig.e2e.json`으로 `e2e/**`를 `pnpm typecheck`에 편입(Playwright는 transpile만 하고 타입체크 안 함).
- **검증**:
  - [ ] `dist-e2e` 부재 시 "pnpm build:e2e 먼저" 에러로 즉시 실패
  - [ ] 빈 spec(`test("boot", ...)` 수준)으로 패널 진입까지 동작 확인
  - [ ] Playwright Chromium에서 `captureVisibleTab`(`<all_urls>`) 동작 확인 — PoC의 Chrome for Testing과 런타임이 달라 별도 검증 필수
  - [x] e2e 파일에 고의 타입 오류 삽입 시 `pnpm typecheck`가 잡음 (확인 후 원복 — TS2322 검출 확인)

### Task 4: smoke.spec
- **변경 대상**: `e2e/smoke.spec.ts`(신규)
- **작업 내용**: 패널 직접 진입 → 디버그 탭 → element 모드 → `#title` 선택 → color 수정 → [다음] → drafting 패널(`drafting-panel`) 표시. 1 test. fresh 프로필의 integrations 탭 자동 전환 비고(design.md)에 유의.
- **검증**:
  - [ ] `pnpm test:e2e -- smoke` green (실행은 `/e2e-write` 단계에서)
  - [x] `pnpm test` green (vitest가 e2e spec 미수집)

### Task 5: style-changes-dialog 회귀 spec
- **변경 대상**: `e2e/style-changes-dialog.spec.ts`(신규)
- **작업 내용**: design.md의 16개 체크 목록(1차 출처 — PoC 스크립트는 폐기됨)을 `test.describe.serial`로 구현(체크 1개 = test 1개, 순서 유지). 셀렉터는 Task 2 testid 기반으로 재작성(라벨·Tailwind 클래스 결합 제거).
- **검증**:
  - [x] design.md 체크 목록 16개와 test가 1:1 대응 (dataflow 검증 에이전트가 상태 전이·기대값 전수 대조)
  - [ ] `pnpm test:e2e` 전체 green (실행은 `/e2e-write` 단계에서)
  - [ ] 3회 연속 green (flaky 없음)
  - [x] `pnpm test` green (vitest가 e2e spec 미수집)

### Task 6: 스킬 신설 — e2e-write.md·e2e-run.md
- **변경 대상**: `.claude/commands/e2e-write.md`(신규), `.claude/commands/e2e-run.md`(신규)
- **작업 내용**: design.md 명세대로. e2e-write — 시나리오→spec, 실행-수정 루프 최대 8회, green 후 1회 재실행, 수정 범위 `e2e/**`+testid 속성만, `build:e2e`만 허용. e2e-run — 실행·리포트 전용, green&클린 시 `.last-green` 기록, dist-e2e 테스트 전용 경고 포함.
- **검증**:
  - [ ] `/e2e-run` 실행 → 리포트 출력(실패 시 trace 경로 포함) + `.last-green`에 HEAD 기록
  - [ ] 워킹 트리 dirty 상태에서 `/e2e-run` green → 기록 생략 + 보고 명시
  - [ ] `/e2e-write`로 시나리오 1건을 spec 변환 → green + 동일 spec 1회 재실행 통과까지 자기완결 (PRD 성공 기준)

### Task 7: 기존 스킬 편입 — push·merge·feature·implement·feature-review
- **변경 대상**: `.claude/commands/push.md`, `merge.md`, `feature.md`, `implement.md`, `feature-review.md` (build.md는 무변경 — e2e 비편입, 사용자 결정)
- **작업 내용**: design.md 명세대로 — push(푸시 직전 e2e 게이트: 해시 일치 스킵 / 빨강이면 푸시 중단 / green이면 클린 트리 한정 `.last-green` 기록 후 푸시), merge(절차 3·4 사이 게이트 교차 — 통상 /push 기록 해시로 스킵 / 빨강 중단 / 명시 우회만 허용), feature(테스트 계획 3분할 템플릿), implement(보고에 "e2e 영향" 줄), feature-review(QA Lead에 e2e 시나리오 검증 가능성).
- **검증**:
  - [ ] `.last-green`을 HEAD로 만든 뒤 `/push` → "직전 green" 한 줄 스킵 후 푸시
  - [ ] `.last-green` 삭제 + spec 1개 고의 실패를 **커밋**한 뒤 `/push` → 푸시 전 중단 확인 → `git reset --hard HEAD~1`로 원복 (게이트가 푸시 앞이라 원격 부작용 없음)
  - [ ] `/merge` 게이트가 절차 4(푸시) 진입 전에 판정됨 — `.last-green == HEAD`로 만들어 "직전 green" 스킵 확인 (게이트 판정 직후 중단 — 푸시·bump 커밋·PR 미발생)

### Task 8: 문서 — CLAUDE.md·DIRECTORY.md
- **변경 대상**: `CLAUDE.md`, `DIRECTORY.md`
- **작업 내용**: 명령어 표(`build:e2e`·`test:e2e`), 워크플로우 라인업(`/e2e-write`·`/e2e-run` 신설 + `/push`·`/merge` 게이트 반영 + 권장 흐름), 빌드 원칙 문구에 dist-e2e 예외 명시, 게이트웨이 섹션에 `BUGSHOT_E2E_BUILD=1` 항목(dist-e2e 전용·`<all_urls>`·스토어 업로드 금지 — `BUGSHOT_STORE_BUILD`와 동형). DIRECTORY.md에 `e2e/` 항목.
- **검증**:
  - [x] 라인업·권장 흐름·명령어 표가 구현과 일치 (codehealth 검증 에이전트 대조)

## 테스트 계획

- **단위 테스트**: 없음 — 순수 함수 신설 없음(인프라·스킬 문서·spec). CLAUDE.md 테스트 우선 원칙의 예외 사유: 검증 대상이 e2e 스위트 자체이며 Task 4·5의 green이 곧 테스트.
- **e2e 시나리오**: Task 4(스모크 1) + Task 5(다이얼로그 회귀 16) — 이 기능의 산출물 그 자체.
- **수동 테스트**:
  - [ ] `dist-e2e/`를 Chrome에 수동 로드하지 않았는지 확인 습관 공유(문서 경고로 갈음)
  - [ ] `/push`·`/merge` 게이트 시나리오 3종(Task 7 검증 항목)

  (dist `<all_urls>` 오염 검증은 Task 1의 host_permissions 판정 명령으로 자동화 — 육안 확인 불요)

## 구현 순서 권장

1. Task 1 (빌드 인프라) — 모든 것의 전제.
2. Task 2 (testid) / Task 3 (하네스) — 상호 독립, 병렬 가능.
3. Task 4 → Task 5 (spec — 하네스·testid 의존, 스모크로 하네스 검증 후 회귀 이식).
4. Task 6 → Task 7 (스킬 — 스위트가 green인 상태에서 절차 명문화).
5. Task 8 (문서) — 마지막.

## 가이드 영향

없음 — 개발 워크플로우 내부 변경. 사용자 노출 UX·기능 변화 없음 (`data-testid`는 렌더 속성일 뿐 시각·동작 무영향).
