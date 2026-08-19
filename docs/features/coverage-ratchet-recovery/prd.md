# 커버리지 래칫 회복 (coverage-ratchet-recovery)

## 배경

2026-08-19 측정에서 로직 스코프 Lines가 **83.3%(20513/24632)**, 베이스라인(2026-08-14) 대비 +0.9pp였다. 그런데 같은 리포트가 **래칫 경고 8건**을 냈다 — v1.7.25·v1.7.27이 추가한 라인 일부가 미커버로 들어와 파일 단위 커버가 베이스라인 아래로 내려갔다. 테스트가 삭제된 게 아니라 **분모가 늘고 새 라인이 안 덮인** 형태다.

미커버 라인을 함수에 매핑해 보니 흩어진 잔여가 아니라 **네 갈래의 체계적 구멍**이었다.

1. **어댑터의 fetch 래퍼 전량.** 8개 플랫폼 어댑터에 테스트 파일이 전부 있는데, 덮인 건 순수 매퍼(`mapCreateIssueBody`·`normalize*`·`messageFor*`·에러 추출)뿐이다. 그걸 감싸는 `createIssue`·`searchProjects`·`upload*`·`updateIssueState`·`get*Status`는 **한 번도 호출되지 않는다**(never-called 합계 ~1267줄). URL 조립·쿼리 파라미터·페이지네이션·응답→매퍼 배선이 전부 무검증이다. `clickup`의 "URL 경로 인코딩"과 `asana`의 "URL 경로·쿼리 인코딩" describe 블록이 이 축을 이미 1~2개 함수에만 적용해 둔 선례다.
2. **골든 매트릭스가 상수로 고정한 두 축.** `bodyOutputGolden.test.ts`의 스냅샷 58장은 8빌더 × captureMode × 섹션 순서를 덮지만, `makeCtx`가 (a) 재현과정을 항상 비지 않게, (b) 로그 에러 수를 항상 0보다 크게 고정한다. 그 결과 **같은 분기가 여러 빌더에서 동시에 비어 있다** — `md.noValue`(빈 orderedList)가 markdown·linear·clickup·slack·notion **5빌더 전부**, `logSummary.*.lineNoError`(에러 0건)가 adf·slack·notion에서 미커버다. 에러가 하나도 없는 세션의 로그 요약 문장과 재현과정이 빈 이슈 본문을 **아무 테스트도 만들지 않는다.**
3. **`blob-db`의 대칭 패밀리 4개.** 이미지·첨부 패밀리는 `fake-indexeddb/auto`로 왕복 검증하는데, video·network·console·action 로그 패밀리의 `save`/`get`/`getKeys`/`clear` **12개 함수가 never-called**다. 같은 12줄 형태가 4벌 복제된 구조라, 한 패밀리에서만 키 스코프가 틀려도 지금은 아무것도 안 잡는다.
4. **`notion-api:expandBlock`.** 15개 블록 타입 switch(129줄) 중 `mention_paragraph` 한 케이스만 테스트돼 95줄이 미커버다. Notion 본문 블록 변환의 유일한 지점인데 사실상 무검증이다.

여기에 로직 다이얼 자체의 왜곡이 하나 있다. `usePickerMessages.ts`(471줄)가 **0% 커버로 로직 분모에 들어와 있다.** 이 파일의 순수 판정은 이미 `log-persist-guard`·`log-prearm-filter`·`tab-scope`·`log-merge` 4개 헬퍼로 떼어져 각각 테스트되고, 남은 471줄은 `picker-control`·`capture`(둘 다 이미 `BROWSER_BOUND_EXACT` 등재) 오케스트레이션 글루다. `scripts/coverage-report.mjs`가 스스로 *"유닛테스트 불가능한 새 런타임 파일을 추가하면 이 목록에 넣어야 로직 다이얼이 노이즈로 눌리지 않는다"*고 지시한 자리인데 등재가 빠져 있다.

### `regression-net`(2026-08-09 드랍)과 무엇이 다른가

`docs/features/DROPPED.md`의 `regression-net`은 *"다섯 목표가 서로 독립이고 각각이 별개 기획 규모"* + *"그물을 짓는 일인데 그 그물을 검증할 그물이 없다"*로 드랍됐다. 이 기획은 그 함정이 아니다.

- **메타 도구를 짓지 않는다.** 복제본 레지스트리·불변식 배너 같은 새 검증 장치가 아니라, **기존 코드에 vitest 유닛테스트를 붙이는 일**이다. 배치 전부가 같은 메커니즘(이미 있는 하네스 + 이미 있는 테스트 파일 확장)이라 다섯 프로젝트가 아니라 하나다.
- **그물을 검증할 그물이 있다.** 산출물의 정답은 `pnpm test` green + `pnpm coverage:report`의 래칫 하락 0이다. 측정 수단이 이미 돌고 있다.

`DROPPED.md`의 판정 기준 4개 중 **"사정거리가 이름값보다 좁은가"** 하나가 css-* 후보에 걸려서, 그 영역은 비목표로 명시한다(아래).

## 목표

1. 래칫 경고 8건을 **0건**으로 만든다 — 단, `submitToAsana.webpToJpeg`는 canvas 실동작이라 그 함수는 남긴다(파일 %는 베이스라인 위로 회복된다).
2. 8개 플랫폼 어댑터의 never-called fetch 래퍼에 **URL·쿼리·요청 body·응답 배선** 검증을 붙인다.
3. 골든 매트릭스에 **"빈 orderedList"·"로그 에러 0건"** 두 축을 추가해 5~6빌더에 동시에 걸린 분기 구멍을 닫는다.
4. `blob-db`의 video·network·console·action 로그 패밀리를 이미지 패밀리와 **같은 왕복 검증**으로 덮는다.
5. `expandBlock`을 15개 블록 타입 전수 테이블로 덮고, **새 블록 타입 추가 시 컴파일이 깨지게** 한다.
6. `usePickerMessages.ts`를 `BROWSER_BOUND_EXACT`에 등재하고, **어떤 파일을 등재해도 되는지 판정 기준을 문서에 남긴다.**
7. 위가 끝난 상태를 `pnpm coverage:update`로 베이스라인에 래칫한다.

**정량 목표**: 로직 스코프 Lines **83.3% → 89% 이상**. (never-called 함수의 정상 경로만 덮고 에러·재시도 경로는 제외한 보수 추정으로 ~90.7%가 나오지만, 목표는 89%로 둔다.)

## 비목표 (Non-goals)

- **`content/css-source-cache.ts`·`content/css-resolve.ts`(미커버 564줄, +2.3pp).** 숫자로는 최대 후보인데 가치가 최저다. CLAUDE.md가 이 영역을 *"회고 상위(13건/11%), 브라우저 실동작이라 유닛으로 못 고정하고 `e2e/style-shorthand-var.spec.ts`가 유일한 그물"*로 표시했고, 실제로 이 영역을 물었던 회귀는 `var()`가 낀 shorthand의 longhand가 CSSOM에서 전부 빈 문자열로 오는 **실브라우저 동작**이었다. `CSSStyleRule` 형태의 객체 리터럴을 먹여 `indexStyleRule`·`getMatchingRules`를 덮으면 다이얼은 +2.3pp 오르지만 **그 함정은 재현되지 않는다** — `DROPPED.md`의 "사정거리가 이름값보다 좁은가"에 정면으로 걸린다. 순수 문자열 파서(`findMatchingBrace`·`parseDeclBlock`) 잔여 ~22줄도 이번 스코프 밖으로 둔다(단독으로 배치를 만들 값이 없다).
- **`usePickerMessages`·`usePlatformFields` 훅 본문에 renderHook 테스트를 붙이는 것.** 전자는 분모에서 걷어내는 쪽이 정직하고(목표 6), 후자(116줄, 1.8%)는 8플랫폼 필드 로더 상태기계라 renderHook + `sendBg` 목으로 원리상 가능하지만 이번 배치의 성격(기존 하네스 확장)과 비용이 다르다. **`usePlatformFields`는 분모에 그대로 남긴다** — 브라우저 API를 직접 부르지 않으므로 `BROWSER_BOUND` 등재 대상이 아니고, 다음 기획 후보로 남긴다.
- **`submitToAsana.webpToJpeg`(17줄).** `canvas.getContext("2d")`+`toDataURL`이라 jsdom에 실구현이 없다. e2e/수동 영역.
- **어떤 프로덕션 코드의 리팩터도 하지 않는다.** 특히 아래 두 건은 발견했지만 **고치지 않는다**(design.md 위험 요소에 기록):
  - `dataUrlToBlob`이 두 판본이다 — `store/blob-db.ts:732`(base64 전용, 비-base64면 throw)와 `background/notion-api.ts:294`(percent-encoding까지 처리 + `contentType` 반환). notion 판본이 상위집합이라 **통합은 동작 변경**이고, 두 파일이 다른 번들 realm이라 경계 문제도 낀다. 이번엔 **양쪽을 각각 테스트하고 갈림을 테스트에 명시**한다.
  - `mockFetch` 헬퍼가 테스트 파일 6곳에 8벌 복제돼 있다(jira·asana는 파일 내 2벌). 기존 8벌은 **건드리지 않는다**(외과적 범위).
- **기존 골든 스냅샷 58장의 갱신.** 새 축은 스냅샷을 늘리지 않고 명시적 assertion으로 검증한다(사유: design.md).

## 사용자 시나리오

사용자 노출 기능이 아니다. 개발자 플로우로 기술한다.

1. 개발자가 배치 하나(예: Task 3 `blob-db` 로그 패밀리)를 집는다.
2. `/tdd`로 테스트를 먼저 쓴다. **여기서 red가 나면 두 갈래로 갈린다**:
   - 기대와 구현이 어긋남 = **실제 버그를 찾은 것**이다. 테스트를 정답으로 두고 `/implement`로 프로덕션 코드를 고친 뒤 `/postmortem`으로 회고를 남긴다. 이 기획의 부산물로 가장 값어치 있는 결과다.
   - 기대가 틀렸음 = 테스트를 구현에 맞춘다. **단, 구현을 그대로 복사해 붙이는 건 금지**(design.md "구현 재진술 금지").
3. `pnpm test` green 확인.
4. 배치를 다 돌린 뒤 `pnpm test:coverage` → `pnpm coverage:report`로 래칫 하락 0을 확인한다.
5. 마지막에 `pnpm coverage:update` + `chore(coverage): ratchet baseline` 커밋.

**엣지 케이스**: 배치 중간에 래칫 경고가 *늘어날* 수 있다 — 어댑터 테스트가 한 파일의 정상 경로만 덮으면 그 파일의 분기 커버는 오르는데 다른 파일은 그대로이므로, 파일 단위 하락은 배치 완료 전엔 판단하지 않는다. 판정은 **전 배치 완료 후 1회**만 한다.

## 성공 기준

- [ ] `pnpm test` green (신규 테스트 포함).
- [ ] `pnpm coverage:report`의 래칫 경고가 **0건**.
- [ ] 로직 스코프 Lines **≥ 89%**.
- [ ] 8개 어댑터 각각에서 `createIssue`(또는 `createTask`/`createPage`/`postMessage`) · `search*`/`list*` · `upload*` · `update*State` 계열이 최소 1회 호출되는 테스트가 존재한다.
- [ ] `expandBlock` 테스트가 `NotionBlock["type"]` 15종을 **타입 수준으로 전수 강제**한다 — 새 블록 타입을 union에 추가하면 `pnpm typecheck`가 깨진다.
- [ ] `blob-db`의 video·network·console·action 패밀리가 save→get 왕복 + keys + clear를 각각 검증한다.
- [ ] `md.noValue`·`logSummary.*.lineNoError`가 미커버 파일 목록에서 사라진다.
- [ ] `scripts/coverage-report.mjs`에 `usePickerMessages.ts`가 등재되고, **등재 판정 기준**이 주석으로 남는다.
- [ ] `coverage/baseline.json`이 갱신되고 별도 커밋으로 남는다.
- [ ] 프로덕션 코드 변경은 **red가 실제 버그를 찾은 경우에만** 있고, 그 경우 `docs/POSTMORTEM.md` 항목이 함께 남는다.
