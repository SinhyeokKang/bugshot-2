# 회귀 검출 그물 — 구현 태스크

## 선행 조건

- 신규 npm 의존성 없음. Tailwind·Bootstrap CSS는 **정적 파일 커밋**이라 `minimumReleaseAge` 정책과 무관하다.
- 권한·env·OAuth 변경 없음. `docs/PERMISSION.md`·`docs/privacy.{ko,en}.md` 갱신 대상 아님(새 캡처·수집·전송 동작이 없다).
- Phase 4-3(어댑터 픽스처)만 **실제 Jira·Slack·GitHub 계정**이 필요하다. 수집은 일회성 수동 절차.
- 착수 전 `docs/POSTMORTEM.md`를 `복제본`·`미검증단언`·`라이브러리전제`로 grep해 이 문서가 인용한 회고를 확인한다.

---

## Phase 1 — 쌍 레지스트리

### Task 1-1: `paired-files.ts` 순수 함수 + 테스트 (TDD)

- **변경 대상**: `src/test/paired-files.ts`(신규), `src/test/__tests__/paired-files.test.ts`(신규)
- **작업 내용**: `parsePairMarker`·`verifyPairs`·`similarity`·`findUnregisteredDuplicates`를 design.md 시그니처대로. 파일 IO는 받지 않고 문자열·주입 함수로만 동작한다. `/tdd interface`로 테스트를 먼저 작성.
- **검증**:
  - [ ] 마커 3줄 파싱 — `.ts`·`.css`(`/* */`)·`.md`(`<!-- -->`) 세 주석 형식 모두
  - [ ] 마커가 21번째 줄에 있으면 파싱되지 않는다(첫 20줄 제한)
  - [ ] `verifyPairs`가 C1~C4 각각에 대해 정확한 `kind`를 낸다 (위반 4종 개별 케이스)
  - [ ] 쌍방향 마커가 정상이면 위반 0
  - [ ] `similarity`가 동일 파일 1.0, 완전 무관 0에 가까운 값
  - [ ] 주석·빈 줄만 다른 두 파일의 유사도가 1.0 (정규화 확인)
  - [ ] `pnpm test` 통과

### Task 1-2: 저장소 전수 스캔 테스트

- **변경 대상**: `src/test/__tests__/paired-files.test.ts` (Task 1-1에 이어서)
- **작업 내용**: `src/**`·`docs/**`를 실제로 읽어 `verifyPairs` 위반이 0임을 단언. `.worktrees/`·`node_modules`·`dist*` 제외(`vitest.config.ts`의 exclude와 같은 사각을 만들지 않도록 경로를 명시적으로 화이트리스트).
- **검증**:
  - [ ] 현재 저장소에서 green (Task 1-3 완료 후)
  - [ ] 편도 마커를 인위적으로 만들면 red (뮤턴트 1)
  - [ ] `@paired-checker`를 없는 경로로 바꾸면 red (뮤턴트 2)
  - [ ] checker에서 한쪽 경로 언급을 지우면 red (뮤턴트 3)

### Task 1-3: 초기 쌍 7개 마커 부착 + 신규 checker 4개

- **변경 대상**:
  - 마커만: `src/content/log-throttle.ts` ↔ `src/sidepanel/lib/trailing-throttle.ts`, `src/i18n/namespaces/{logs,editor}.ts` ↔ `src/log-viewer/i18n.ts`, `src/styles/globals.css` ↔ `src/log-viewer/styles.css`
  - 마커 + 신규 checker: `src/content/css-resolve.ts` ↔ `src/content/css-source-cache.ts`, `draftRich.ts` ↔ `draftCompact.ts`, `stylingRich.ts` ↔ `stylingCompact.ts`, `src/content/capture-context.ts` ↔ `src/sidepanel/lib/capture-basis.ts`
- **작업 내용**: 마커 3줄씩. 신규 checker 4개는 각 쌍의 `__tests__/`에 대조 테스트를 추가한다:
  - `css-resolve` ↔ `css-source-cache`: `TRANSPARENT_GROUP_RULES`와 인덱서가 조건을 평가하는 at-rule 목록이 **같은 집합**임을 단언 (2026-08-03 회고의 grep 대조를 테스트로 승격)
  - `draftRich` ↔ `draftCompact` / `stylingRich` ↔ `stylingCompact`: 같은 모드·로케일 입력으로 두 빌더를 돌려 **지시문 집합이 같은 의미 축을 갖는지** 단언. 최소한 위치어(`after`/`above`/`earlier`)가 한쪽에만 있으면 실패 (2026-07-2x 회고)
  - `capture-context` ↔ `capture-basis`: 게이트 3개(뷰포트 포함/요소 포함/면적 40%) 판정이 같은 입력에 같은 답을 내는지
- **검증**:
  - [ ] Task 1-2 전수 스캔이 green
  - [ ] 신규 checker 4개가 각각 한쪽만 바꾸는 뮤턴트에서 red
  - [ ] `pnpm test` 통과

### Task 1-4: 미등록 복제본 탐지(C5) 활성화

- **변경 대상**: `src/test/paired-files.ts`(`SIMILARITY_EXEMPT`), `src/test/__tests__/paired-files.test.ts`
- **작업 내용**: 전수 스캔에 `findUnregisteredDuplicates`를 추가. 먼저 **임계값 없이 상위 20쌍의 유사도를 출력**해 실측하고, 오탐(어댑터 보일러플레이트 등)을 면제 목록에 사유 주석과 함께 등록한다. 임계값은 실측 후 확정(초안 0.75).
- **검증**:
  - [ ] 실측 유사도 분포를 확인하고 임계값 근거를 코드 주석에 남김
  - [ ] 면제 목록 각 항목에 "왜 복제본이 아닌가" 한 줄
  - [ ] 면제 목록이 5쌍을 넘으면 임계값 조정 전에 **정말 복제본이 아닌지** 재검토
  - [ ] 임의의 파일을 복사해 넣으면 red

---

## Phase 2 — 전제 큐

### Task 2-1: `docs/ASSUMPTIONS.md` 생성 + 시드

- **변경 대상**: `docs/ASSUMPTIONS.md`(신규)
- **작업 내용**: design.md의 항목 형식 + 상단에 "쓰는 스킬 / 읽는 스킬 / 비우는 조건"을 명시. `docs/POSTMORTEM.md`의 최근 회고에서 **아직 자동 그물이 없는 전제** 5개 이상으로 시드한다(예: `el.matches()`의 `:has()` throw, `dialog.showModal()` top layer가 blocker 위, cross-origin 시트 fetch 실패 시 조용한 빈 배열).
- **검증**:
  - [ ] 항목 5개 이상, 각각 `의존 코드`가 실존 `file:func`
  - [ ] 각 항목의 `틀렸을 때 증상`이 관측 가능한 문장

### Task 2-2: `/audit`·`/code-review`에 전제 열거 추가

- **변경 대상**: `.claude/commands/audit.md`, `.claude/commands/code-review.md`
- **작업 내용**: 각 전문 에이전트 지침에 "담당 차원에서 이 코드가 참이라고 믿는 외부 동작을 열거하고, 각각이 무엇으로 검증됐는지 답하라(없으면 `미검증`)" 추가. 리포트 템플릿에 `## 미검증 외부 전제` 섹션 추가. **파일 쓰기는 사용자 요청 시에만**이라는 예외를 명시(두 스킬 모두 리포트 전용).
- **검증**:
  - [ ] `pnpm sync:agents:check` 통과 (PostToolUse 훅이 자동 실행하지만 확인)
  - [ ] `/code-review`를 실제로 돌려 섹션이 나오는지 확인
  - [ ] 리포트 항목이 `docs/ASSUMPTIONS.md` 형식으로 바로 옮겨지는지

### Task 2-3: `/e2e-write`에 큐 읽기 단계 추가

- **변경 대상**: `.claude/commands/e2e-write.md`
- **작업 내용**: 착수 시 `docs/ASSUMPTIONS.md`를 읽어 이번 변경 영역과 겹치는 미검증 항목을 spec 후보로 삼고, green이 된 항목을 삭제하는 단계 추가. **이 단계가 없으면 큐가 죽은 로그가 된다.**
- **검증**:
  - [ ] `pnpm sync:agents:check` 통과
  - [ ] 큐 항목 1개를 실제로 spec으로 고정하고 항목이 제거되는 왕복을 1회 수행

---

## Phase 3 — dev 불변식

### Task 3-1: `__DEV_CHECKS__` define + `invariant.ts` (TDD)

- **변경 대상**: `vite.config.ts`, `src/types/globals.d.ts`(신규), `src/lib/invariant.ts`(신규), `src/lib/__tests__/invariant.test.ts`(신규)
- **작업 내용**: define 추가(`!isStoreBuild`), 전역 타입 선언, `invariant`/`getViolations`/`clearViolations`/`setInvariantContext`. 테스트 먼저.
- **검증**:
  - [ ] 조건 true면 기록 없음, false면 위반 1건
  - [ ] cap 50 초과 시 FIFO로 오래된 것부터 밀려남
  - [ ] `detail` 콜백이 조건 true일 때 **호출되지 않음**(지연 평가)
  - [ ] `globalThis.__bugshotInvariants__`가 같은 배열을 참조
  - [ ] `pnpm typecheck` 통과 (테스트 환경에서 `__DEV_CHECKS__` 정의 필요 — `vitest.config.ts`의 `define`에도 추가)

### Task 3-2: 초기 불변식 4개 삽입

- **변경 대상**: I1 `src/sidepanel/…` 캡처 커밋 지점(`sameCaptureBasis` 호출부), I2 `src/content/picker.ts:beginCapturePrep`, I3 AI run 응답 수신부(`useAiRun`), I4 `src/sidepanel/lib/apiHostRow.ts` 소비 지점
- **작업 내용**: 각 지점에 `invariant(...)` 한 줄. **기존 동작을 바꾸지 않는다** — 기록만 하고 흐름은 그대로. 기존 가드를 `invariant`로 치환하지 않는다(외과적 변경).
- **검증**:
  - [ ] 4개 각각을 인위적으로 위반시키면 `getViolations()`에 잡힌다
  - [ ] 정상 플로우에서 위반 0 (기존 e2e 전체 green)
  - [ ] `pnpm check:prearm` 통과 — `recorders-entry` 청크에 `invariant.ts`가 유입되지 않았는지

### Task 3-3: 컨텍스트 간 전달

- **변경 대상**: `src/types/messages.ts`, content 위반 전송부, background 브로드캐스트, 사이드패널 수신부
- **작업 내용**: `dev.invariant` 메시지 1건 추가. content → runtime, background → 사이드패널. 사이드패널이 로컬 배열에 병합.
- **검증**:
  - [ ] content에서 유발한 위반이 사이드패널 배열에 도달
  - [ ] store 빌드에서 이 메시지가 발화하지 않음(호출부가 죽은 코드)

### Task 3-4: `DevInvariantBanner` (TDD, jsdom)

- **변경 대상**: `src/sidepanel/components/DevInvariantBanner.tsx`(신규), `src/sidepanel/components/__tests__/DevInvariantBanner.test.tsx`(신규), `src/sidepanel/App.tsx`
- **작업 내용**: 위반 0건이면 `null`. 접힘/펼침, 복사, 비우기. `__DEV_CHECKS__ === false`면 최상단에서 `null`.
- **검증**:
  - [ ] 위반 0건 → DOM에 아무것도 없음
  - [ ] 1건 → 한 줄 요약 + 배지, 클릭 시 목록 전개
  - [ ] 비우기 후 다시 0건 → 언마운트
  - [ ] DESIGN.md 준수 — `bg-destructive`를 글자색으로 쓰지 않음
  - [ ] i18n 키를 추가하지 않았는지 확인(사전 두 벌 동기화 회피)

### Task 3-5: store 빌드 죽은 코드 확인

- **변경 대상**: 없음(검증 전용). 필요 시 `.claude/commands/build.md`에 체크 1줄.
- **작업 내용**: `pnpm build:store` 후 산출물에서 불변식 문자열 부재 확인.
- **검증**:
  - [ ] `grep -r "invariant" dist/` 결과 0건
  - [ ] I1~I4 메시지 문자열이 산출물에 0건
  - [ ] 번들 크기가 `pnpm build` 대비 줄었거나 같음

### Task 3-6: e2e 수집 (경고 단계)

- **변경 대상**: `e2e/fixtures/extension.ts`
- **작업 내용**: 각 테스트 종료 시 세 컨텍스트 위반을 수집해 **콘솔에 출력만** 한다. 아직 실패로 승격하지 않는다.
- **검증**:
  - [ ] 전체 스위트 1회 실행 후 위반 로그를 수집해 목록화
  - [ ] 각 위반이 진짜 버그인지 불변식 오류인지 판정하고 기록

### Task 3-7: e2e 실패 승격

- **변경 대상**: `e2e/fixtures/extension.ts`, 필요 시 개별 spec의 `test.use({ allowInvariants: [...] })`
- **작업 내용**: Task 3-6에서 나온 위반을 모두 해소한 뒤 실패 승격으로 전환. 의도적 위반 spec에 면제 옵션.
- **검증**:
  - [ ] 전체 스위트 green
  - [ ] 인위적 위반을 넣은 spec이 red
  - [ ] 면제 옵션을 쓴 spec이 있으면 그 사유를 `e2e/COVERAGE.md`에 기록

---

## Phase 4 — 경계별 오라클

### Task 4-1: 프레임워크 코퍼스 픽스처

- **변경 대상**: `e2e/fixtures/pages/cascade/`(신규 — `vendor/tailwind.min.css`·`vendor/bootstrap.min.css` + `frameworks.html`·`at-rules.html`·`tokens.html`)
- **작업 내용**: 정적 파일 커밋. 각 vendor 파일 상단에 출처 URL·버전·라이선스 주석. 페이지는 design.md의 3장 구성.
- **검증**:
  - [ ] 세 페이지가 브라우저에서 렌더되고 콘솔 에러 0
  - [ ] `at-rules.html`에서 `@container` 조건 거짓 규칙이 실제로 적용되지 않는지 `getComputedStyle`로 선확인 (GOTCHAS "픽스처 게이트 만족을 spec이 먼저 단언")
  - [ ] `frameworks.html`에 escape 클래스(`2xl:*`)가 실제로 존재하고 Chrome이 hex escape로 직렬화하는지 확인

### Task 4-2: cascade 프로브 엔트리

- **변경 대상**: `vite.config.ts`(e2e 빌드에서만 `e2e-cascade-probe.js` emit)
- **작업 내용**: `e2eEvalHostPlugin` 선례를 따라 e2e 빌드에서만 프로브를 emit. `collectSpecifiedStylesWithSources`를 `window.__bugshotProbe__`에 노출.
- **검증**:
  - [ ] `pnpm build:e2e` 후 `dist-e2e/e2e-cascade-probe.js` 존재
  - [ ] `pnpm build` 후 `dist/`에 **미포함**
  - [ ] 픽스처 페이지에서 `<script src>`로 로드해 함수 호출 성공

### Task 4-3: cascade project + 적용 왕복 spec

- **변경 대상**: `e2e/playwright.config.ts`(project 추가), `e2e/cascade-differential.spec.ts`(신규)
- **작업 내용**: design.md의 적용 왕복 알고리즘. shorthand·`all`·`transition` 계열 제외. 요소 표본 페이지당 40개 캡. 폴백률 출력.
- **검증**:
  - [ ] 세 페이지 green
  - [ ] 캡·제외 목록·폴백률을 `log()`로 출력 (silent truncation 금지)
  - [ ] 뮤턴트 3종에서 각각 red — `matchedSpecificity` 비교 제거 / `skipEscape` 종결자 제거 / opaque 화이트리스트 반전
  - [ ] **뮤턴트마다 `build:e2e` 출력에 `built in`이 있는지 확인** (GOTCHAS — 빌드 실패 시 직전 dist로 돌아 공허한 green)
  - [ ] 실행 시간 측정 후 `docs/CI.md` 스위트 카운트·소요 갱신

### Task 4-4: 시각 diff — 오버레이 누출 (베이스라인 불필요)

- **변경 대상**: 기존 캡처 spec 중 하나 또는 `e2e/capture-overlay-leak.spec.ts`(신규)
- **작업 내용**: 캡처 산출물 이미지를 canvas로 읽어 픽커 오버레이 고유색 픽셀이 0인지 단언. **스크린샷 비교가 아니라 픽셀 색 부재 단언**이라 베이스라인·렌더 차이에 면역.
- **검증**:
  - [ ] 로컬·CI 둘 다 green
  - [ ] hover-shield를 무력화하는 뮤턴트에서 red
  - [ ] GOTCHAS의 "캡처 이미지 픽셀 폭을 CSS px로 환산 금지" 함정을 밟지 않았는지(색만 보므로 무관하지만 확인)

### Task 4-5: 시각 diff — 어노테이션 캔버스 + 다크모드 상단

- **변경 대상**: `e2e/visual/`(신규 디렉터리), `e2e/playwright.config.ts`
- **작업 내용**: `toHaveScreenshot`(`maxDiffPixelRatio: 0.01`). 로컬에서는 `test.skip(!process.env.CI)`. 베이스라인은 CI에서 생성해 커밋.
- **검증**:
  - [ ] CI에서 베이스라인 생성 → 커밋 → 재실행 green
  - [ ] 로컬에서 skip됨
  - [ ] 색 토큰을 바꾸는 뮤턴트에서 다크모드 spec이 red
  - [ ] 연속 3회 CI 실행에서 flaky 0

### Task 4-6: 어댑터 record-replay (Jira·Slack·GitHub)

- **변경 대상**: `src/lib/adapters/__tests__/fixtures/<platform>/`(신규), 각 어댑터의 `__tests__/`
- **작업 내용**: 실계정으로 1회 수집 → 스크러빙 → 커밋. 응답 파싱·에러 분류·필드 매핑 테스트.
- **검증**:
  - [ ] **스크러빙 체크리스트 전 항목 통과** — 토큰·이메일·실명·워크스페이스 URL·조직 ID·업무 내용
  - [ ] `grep -riE 'bearer |ghp_|xox[baprs]-|@[a-z0-9.-]+\.(com|net|org)'` 결과 0건
  - [ ] 각 픽스처에 수집일·엔드포인트·스크러빙 수행자 주석
  - [ ] 세 어댑터의 기존 유닛 테스트가 그대로 green

---

## 테스트 계획

### 단위 테스트

| 대상 | 케이스 |
|---|---|
| `paired-files.ts` | 마커 파싱(3 주석 형식·20줄 경계), C1~C4 위반 4종, 유사도 정규화, 면제 적용 |
| `invariant.ts` | 조건 참/거짓, cap 50 FIFO, detail 지연 평가, globalThis 참조 동일성 |
| 신규 checker 4개 | 각 쌍에 대해 한쪽만 바꾸는 뮤턴트에서 red |
| `DevInvariantBanner` | 0건 미렌더, 전개, 비우기, 토큰 준수 (jsdom) |

### e2e 시나리오

`/e2e-write`의 입력이 되는 문장:

- 픽스처 코퍼스의 요소를 훑어 확장이 고른 specified를 다시 적용하면 computed가 변하지 않는다
- `@container` 조건이 거짓인 규칙은 승자를 가로채지 못한다 (기존 `style-specificity`의 코퍼스 확장판)
- escape 클래스(`.\32 xl\:*`)가 있는 페이지에서 specificity가 부풀지 않는다
- 캡처 산출물 이미지에 픽커 오버레이 색 픽셀이 존재하지 않는다
- 어떤 spec이든 종료 시 남아 있는 불변식 위반이 없다 (면제 scope 제외)
- 어노테이션 캔버스가 베이스라인과 1% 이내로 일치한다 (CI 전용)
- 다크모드 사이드패널 상단이 베이스라인과 1% 이내로 일치한다 (CI 전용)

### 수동 테스트

자동화 불가한 것만. **`pnpm build` 선행 필요**(dist stale 방지).

- [ ] dist를 언팩 로드하고 element 모드로 스타일 편집 → 불변식 배너가 뜨지 않는지(정상 경로)
- [ ] I1을 인위적으로 위반시켜 배너 노출·복사 버튼 동작 확인
- [ ] `build:store` 산출물을 언팩 로드해 배너 코드가 없는지(위반을 유발해도 아무 일 없음)
- [ ] naver.com 등 cross-origin 시트 페이지에서 cascade 판정이 코퍼스와 같은 품질인지 눈으로 확인 — **코퍼스가 못 잡는 잔여 축**(e2e/GOTCHAS의 loopback cross-origin inert 제약)

---

## 구현 순서 권장

```
Phase 1 ──┐
Phase 2 ──┼── 병렬 가능 (서로 독립)
Phase 3 ──┘
              └─> Phase 4 (2의 큐를 대상 선정에 쓰면 유리, 의존은 아님)
```

- **Phase 1**: 1-1 → 1-2 → 1-3 → 1-4 (순차. 1-3이 끝나야 1-2가 green)
- **Phase 2**: 2-1 → 2-2 → 2-3 (순차. 큐 파일이 있어야 스킬이 가리킬 수 있다)
- **Phase 3**: 3-1 → 3-2 → 3-3 → 3-4 → 3-5 → 3-6 → **(위반 해소 후)** → 3-7
- **Phase 4**: 4-1 → 4-2 → 4-3 순차. 4-4는 독립(먼저 넣어도 됨 — 셋 중 가장 값싸고 가장 큰 회귀를 막는다). 4-5·4-6은 독립.

**가장 먼저 손댈 것**: Task 1-1~1-3. 결정적이고, 오탐이 없고, `복제본` 29%를 영구 차단한다. Task 4-4를 그다음에 끼우면 값싸게 시각 축 하나를 덮는다.

## 가이드 영향

없음.
