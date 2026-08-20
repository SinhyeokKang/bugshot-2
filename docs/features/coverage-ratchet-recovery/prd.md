# 커버리지 래칫 회복 (coverage-ratchet-recovery)

## 배경

**베이스라인이 4개 릴리스 동안 얼어 있다.** `coverage/baseline.json`의 마지막 갱신은 `34ac3380`(2026-08-14, v1.7.23)이고 그 뒤 v1.7.24·25·26·27이 전부 베이스라인을 못 올렸다. 래칫은 "직전 기준점 대비 파일 커버 하락"으로 회귀를 잡는데, 그 기준점이 5일·4릴리스치 뒤에 멈춰 있으면 **다음 회귀를 감지하는 능력 자체가 삭는다.** 2026-08-19 측정의 래칫 경고 8건(−0.1~−1.8pp)은 그 정체의 증상이다 — 그 수치 자체는 아무것도 막지 않는다(`/coverage`는 "막지는 않는다", `/merge`의 커버리지 리포트는 비차단).

**그리고 이 배치가 노리는 코드는 유닛 0 + e2e 0이다.** `e2e/*.spec.ts` 전체에서 플랫폼 API를 `route()`로 인터셉트하는 spec은 **0건**이다(URL 문자열만 등장). 8개 플랫폼 어댑터의 fetch 래퍼는 어떤 그물도 없이 이슈를 만들고 첨부를 올리고 상태를 전이시킨다. `docs/features/DROPPED.md`의 판정 기준 4번("검증 수단이 있는가")을 정면으로 만족하는 자리다.

미커버 라인을 함수에 매핑하면 흩어진 잔여가 아니라 **네 갈래의 체계적 구멍**이다.

1. **어댑터의 fetch 래퍼.** 8개 어댑터에 테스트 파일이 전부 있는데 덮인 건 순수 매퍼(`mapCreateIssueBody`·`normalize*`·`messageFor*`·에러 추출) 위주다. 어댑터별 실측 커버는 clickup 11.1% / gitlab 20.9% / slack 21.1% / jira 33.9% / notion 36.2% / linear 37.1% / asana 45.8% / github 57.4%이고, **fetch 래퍼 커버가 0인 어댑터는 slack 하나**다(나머지는 clickup `getSpaces`·asana `searchUsers`·notion `listUsers`·jira `createIssue`·linear `createIssue` 등 1~2개 함수에만 이 축이 적용돼 있다). never-called 함수는 `searchProjects`·`getLabels`·`getMembers`·`upload*`·`update*State`·`get*Status`·`transitionIssue` 계열로 8파일 합계 ~1267줄이다(미커버 총계 1532줄과는 다른 축의 수치다).
2. **골든 매트릭스가 상수로 고정한 두 축.** `bodyOutputGolden.test.ts`의 스냅샷 62장은 10개 출력(플랫폼 8 + 클립보드 md/html) × captureMode × 섹션 순서를 덮지만, `makeCtx`가 (a) `stepsToReproduce`를 항상 비지 않게(`:84`), (b) 로그 에러 수를 항상 0보다 크게(`LOG_SUMMARIES:55-70`에 `errorCount: 0`이 0건) 고정한다. 그래서 **같은 분기가 여러 빌더에서 동시에 비어 있다** — `md.noValue`(빈 orderedList)가 markdown·linear·clickup·slack·notion 5빌더, `logSummary.*.lineNoError`(에러 0건)가 adf·slack·notion·html에서 미커버다. 에러가 하나도 없는 세션의 로그 요약과 재현과정이 빈 이슈 본문을 **아무 테스트도 만들지 않는다.** (`buildAsanaIssueBody`는 이미 100%라 이 구멍 밖이다.)
3. **`blob-db`의 대칭 패밀리 4개.** 이미지·첨부 패밀리는 `fake-indexeddb/auto`로 왕복 검증하는데, video·network·console·action 패밀리의 `save`/`get`/`delete`/`getKeys`/`clear` **20개 함수가 never-called**다. 게다가 형태가 완전 동형이 아니다 — `getVideoBlob`은 `req.result instanceof Blob` 런타임 가드를 두고 로그 3종은 `(req.result as T) ?? null` 무검증 캐스트다. 키 스코프도 갈린다(video는 `issueId` 단일, 로그 3종은 `issueId`와 `pendingKey(tabId)` 두 네임스페이스가 섞인다).
4. **`notion-api:expandBlock`.** 15개 블록 타입 switch(129줄) 중 `mention_paragraph` 한 케이스만 테스트돼 95줄이 미커버다. Notion 본문 블록 변환의 유일한 지점인데 사실상 무검증이다.

### 검수가 발굴한 프로덕션 결함 3건 (이번 스코프)

문서 검수 중 코드에서 확인된 것들이다. 커버리지와 별개로 이번 배치에서 고친다.

- **asana 첨부 파일명 충돌 → 캡처가 본문에서 무음 누락.** `submitToAsana.ts:135`가 만든 `userAttachmentNames`(`:138`)가 `:194`의 `if (r.ok && !userAttachmentNames.has(r.filename))` 가드에 쓰인다. 사용자가 `before-0.jpg`·`screenshot.jpg`처럼 캡처와 같은 이름의 파일을 첨부하면 **동명의 캡처가 `imageRefs`에서 제외돼 Asana 본문에서 사라진다**(첨부 패널엔 남는다). `logs.html`이면 `logsDropped`(`:198`)가 true가 돼 "용량 초과" 경고까지 잘못 뜬다. v1.7.27이 고친 "첨부 거짓말" 계열과 같은 종류다.
- ~~**jira만 2차 본문 갱신 실패 격리가 없다.**~~ — **전제 오류(2026-08-20 정정).** `background/messages.ts:850-868`을 실물 대조하니 jira도 `try{}catch{}`로 삼키고 `{key, url, logsDropped}`를 그대로 반환한다(`b4b98df9` 이래, 다른 4플랫폼과 같은 계약). 5플랫폼 전부 격리가 있고 관용구만 3갈림(`try{}catch{}` / `.catch(()=>null)` / 블록 전체 감싸기)이다. 남은 일은 픽스가 아니라 **현행 격리를 고정하는 회귀 테스트**뿐이다.
- **`logSummary.console.lineNoError` 문면이 warn 축을 버린다.** `logs.ts:125` `"콘솔: {n}건 (에러 없음)"` / `:266` `"Console: {n} logs (no errors)"`. 분기 조건이 `errorCount > 0 || warnCount > 0`이라 이 줄이 나올 때 경고도 0인데, 독자는 경고가 0인지 안 센 건지 알 수 없다.

### `regression-net`(2026-08-09 드랍)과 무엇이 다른가

`DROPPED.md`는 `regression-net`을 *"다섯 목표가 서로 독립이고 각각이 별개 기획 규모"* + *"그물을 짓는 일인데 그 그물을 검증할 그물이 없다"*로 기각했고, 더 일반적으로 `:141`에 *"묶음 기획 생존율이 0/3이 됐다 … 문서가 큰 이유가 깊이가 아니라 갈래 수일 때가 신호다"*를 남겼다. 이 기획은 그 신호에 걸리는 형태이므로 차별점을 명시한다.

- **메커니즘이 하나다.** 네 갈래가 서로 호출하지 않는 건 사실이지만, 전부 *"이미 있는 하네스(`fake-indexeddb/auto` · `vi.stubGlobal("fetch")` · `vi.mock("@/i18n")`)로 이미 있는 테스트 파일을 확장"*하는 동일 작업이다. `regression-net`의 다섯은 각각 다른 장치(레지스트리 / 전제 큐 / dev 배너 / e2e 승격 / 코퍼스)였다.
- **그물을 검증할 그물이 있다.** 정답 판정이 `pnpm test` green + `pnpm coverage:report` 하락 0이고, 그 측정이 이미 돌고 있다.
- **`blob-db` 4패밀리 대조는 `DROPPED.md:201`이 남긴 "다시 볼 조건"의 이행이다.** `regression-net`의 다섯 중 유일하게 살려도 된다고 판정된 게 *"목표 1(복제본 대조 테스트)만 떼어 별도 기획으로 … 구현이 `pnpm test` 안에서 닫혀 검증 가능"*이었고, 4패밀리(및 4벌 복제된 `lineNoError` 분기) 대조가 정확히 그 형태다.
- **규모는 이 저장소 중위값 이하다** — 9태스크 / 208·72·162줄. 다만 Task 5가 8 서브태스크라 실효 16단위이므로 "작다"고 주장하지 않는다. 주장하는 건 위 세 가지뿐이다.

**단, `DROPPED.md`의 판정 기준 중 "사정거리가 이름값보다 좁은가"는 이 기획의 일부에 실제로 걸린다** — css-* 후보가 그렇고, 그래서 비목표로 뺀다(아래).

## 목표

1. **래칫 경고 8건 → 0건.** 파일별 담당 태스크:

   | 래칫 하락 파일 | 베이스라인 → 현재 | 담당 |
   |---|---|---|
   | `sidepanel/components/annotation/presets.ts` | 95.6% → 93.8% | Task 7 |
   | `sidepanel/lib/submitToAsana.ts` | 86.0% → 84.8% | Task 7 (+ Task 8 픽스) |
   | `store/settings-store.ts` | 65.6% → 65.0% | Task 6 |
   | `sidepanel/lib/buildSlackBody.ts` | 97.0% → 96.7% | Task 2 |
   | `sidepanel/lib/buildNotionIssueBody.ts` | 96.3% → 96.2% | Task 2 |
   | `background/jira-api.ts` | 62.1% → 62.0% | Task 5-8 |
   | `sidepanel/lib/submitToClickup.ts` | 99.0% → 98.9% | Task 7 |
   | `background/notion-api.ts` | 43.7% → 43.6% | Task 5-1 + Task 4 |

   `submitToAsana`는 `webpToJpeg`(canvas 실동작)가 남으므로 함수 단위로는 미커버가 남지만 **파일 %는 베이스라인 위로 회복**된다.
2. 8개 어댑터의 never-called fetch 래퍼에 **인코딩 · 필수 쿼리 파라미터 · 요청 body ↔ 매퍼 일치 · 응답 봉투 경로 · 에러 전파** 5축 검증을 붙인다. **커버리지 수치는 합격 판정이 아니라 보조 지표다** — 각 태스크는 mutation(구현을 한 군데 망가뜨려 red를 실측)으로 그물의 사정거리를 증명한다.
3. 골든 매트릭스에 **"빈 orderedList"·"로그 에러 0건"** 두 축을 추가한다. **이 그물의 사정거리는 소별자(빌더)까지이고 생산자는 밖이다** — "에러 0건 세션이 실제로 `errorCount: 0`을 만드는가"는 `buildEditorCapture.test.ts`에 짝 케이스로 따로 넣는다.
4. `blob-db`의 4패밀리 20함수를 이미지 패밀리와 같은 왕복 검증으로 덮고, **`get*`의 가드 비대칭과 2네임스페이스 키 스코프를 명시 축으로 돌린다.**
5. `expandBlock`을 15개 블록 타입 전수 테이블로 덮고, **새 블록 타입 추가 시 `pnpm typecheck`가 깨지게** 한다.
6. 위 3건의 프로덕션 결함을 고치고 `docs/POSTMORTEM.md`에 회고를 남긴다.
7. 베이스라인을 `pnpm coverage:update`로 래칫한다.

**정량 목표**: 로직 스코프 Lines **83.3%(20513/24632) → 88% 이상.** 태스크별 목표치를 전부 달성하면 커버 증가분 ~1360줄로 88.8%가 되므로 ~200줄의 미달 여유가 있다. **이 수치는 전부 테스트에서 나온다** — 분모를 재정의해 올리는 항목은 없다(아래 비목표).

## 비목표 (Non-goals)

- **`usePickerMessages.ts`를 `BROWSER_BOUND_EXACT`에 등재하는 것(분모 교정).** 초안에 있었고 로직 다이얼을 테스트 없이 +1.3pp 올리는 가장 싼 수단이었는데, 검수에서 기각됐다. 이유: 그 파일에만 사는 판정이 **7개**다 — `resumeAfterRepickCancel()`(`:381-391`) · `isStalePickerDocument()` documentId 대조(`:87-94`, 6분기 게이트) · `selectionGeneration`+`sameSelection()` 4중 논리곱 · `beforeCaptureInflight` 카운터(`:31,173,190-193` — 주석이 boolean→카운터 회귀를 명시) · `deferredActiveTabExpiry` 교차 결합 · `picker.areaSelected`의 비대칭 세션 게이트(`:213-218`) · `acceptedSelectionSessions` dedup. `coverage-report.mjs:59-64`가 `mp4-encoder.ts`를 **일부러 등재하지 않은** 사유(*"「브라우저 API를 부른다」와 「유닛으로 못 고정한다」는 다르다"*)가 정확히 이 형태이고, 훅 제외 선례는 0건에 반례 3건(`useAiRun` 84/84 · `useReproPrefill` 106/106 · `useLazyListOnOpen` 41/41)이다. 등재하면 `coverage-report.mjs:173`의 `if (cur.browserBound) continue`로 **래칫 회귀 검출에서 영구 면제**되는 부작용도 있다. 회고 그물 태그 1위가 `unit`(57건/47%)인데 유닛이 잡아야 할 파일을 분모에서 빼는 건 방향이 반대다. → 분모에 남기고 개선 후보로 노출한다. 파일 471줄 / **커버리지 계수는 377줄**(v8은 statement 단위)이라는 구분을 기록해 둔다.
- **`content/css-source-cache.ts`·`content/css-resolve.ts`(미커버 564줄, +2.3pp).** 숫자로는 최대 후보인데 가치가 최저다. CLAUDE.md가 이 영역을 *"브라우저 실동작이라 유닛으로 못 고정하고 `e2e/style-shorthand-var.spec.ts`가 유일한 그물"*로 표시했고, 실제로 이 영역을 물었던 회귀는 `var()`가 낀 shorthand의 longhand가 CSSOM에서 빈 문자열로 오는 **실브라우저 동작**이었다. `CSSStyleRule` 형태의 객체 리터럴로 `indexStyleRule`·`getMatchingRules`를 덮으면 다이얼은 오르지만 **그 함정은 재현되지 않는다** — "사정거리가 이름값보다 좁은가"에 정면으로 걸린다. 순수 문자열 파서(`findMatchingBrace`·`parseDeclBlock`) 잔여 ~22줄도 단독 배치 값이 없어 밖으로 둔다.
- **`usePlatformFields`(116줄, 1.8%) 훅 본문.** renderHook 선례가 있어 원리상 가능하지만 8플랫폼 필드 로더 상태기계라 비용이 다르다. **분모에 남긴다**(브라우저 API를 직접 안 부르므로 등재 대상이 아니다 — 테스트로 덮을 대상이다). 개선 후보 12위로 계속 노출된다.
- **`submitToAsana.webpToJpeg`(`:66-85`).** `canvas.getContext("2d")`+`toDataURL`이라 jsdom에 실구현이 없다. e2e/수동 영역. (단 `:67`의 non-webp 조기 반환과 `:82-83` catch 폴백은 canvas 없이 도달 가능하다.)
- **`dataUrlToBlob` 3판본 통합.** `store/blob-db.ts:732` · `background/notion-api.ts:294` · `background/github-upload.ts:61-66` 세 판본이 있고, 셋째는 `pageBatchUploadFn`이 `toString()`으로 문자열화돼 MAIN world에서 재평가되므로 **영구히 통합 불가**다. 앞의 둘도 상위집합 관계가 아니라 **양방향으로 갈린다**(`data:;base64,QUJD` → blob-db는 `type:""`로 성공/notion은 throw, 빈 payload는 반대). 통합은 확장이 아니라 소비처 동작 변경이므로 하지 않고, **각 판본을 테스트하고 갈림을 테스트에 명시**한다.
- **기존 8벌 로컬 `mockFetch` 통합.** 외과적 범위 밖. 배치 종료 시점에 공용 헬퍼 + 기존 로컬이 공존하며, `github-api.test.ts`는 `globalThis.fetch` 직접 대입이라 통합 비용이 별도로 크다. **마이그레이션 조건을 `DROPPED.md`에 등재**해 다음 감사가 같은 걸 재발굴하지 않게 한다.
- **기존 골든 스냅샷 62장(8888줄 / 189,662B)의 갱신.** 새 축은 스냅샷을 늘리지 않고 명시적 assertion으로 검증한다(사유: design.md 대안 2).

## 사용자 시나리오

사용자 노출 기능이 아니다. 개발자 플로우로 기술한다.

1. 개발자가 배치 하나를 집는다. **먼저 그 태스크의 mutation 항목을 읽는다** — 무엇을 망가뜨려 red를 확인할지가 검증의 정의다.
2. `/tdd`로 테스트를 먼저 쓴다. red가 나면 두 갈래다:
   - 기대와 구현이 어긋남 = **실제 버그**다. 테스트를 정답으로 두고 `/implement`로 고친 뒤 `/postmortem`으로 회고를 남긴다.
   - 기대가 틀렸음 = 테스트를 구현에 맞춘다. **구현을 복사해 붙이는 건 금지**(design.md "구현 재진술 금지" + "기대값 리터럴").
3. green 확인 후 **mutation 실측**: 구현을 한 군데 망가뜨려 그 테스트가 red가 되는지 본다. red가 안 나면 그 테스트는 그물이 아니다.
4. 배치를 다 돌린 뒤 `pnpm test:coverage` → `pnpm coverage:report`.
5. 하락 0이면 `pnpm coverage:update` + `chore(coverage): ratchet baseline` 커밋.

**중단 조건**: 프로덕션 픽스가 **3건을 초과**하면(Task 8의 계획된 3건 외에 red가 새 버그를 4번째로 드러내면) 배치를 세우고 잔여를 별건 기획으로 이월한다. "테스트 추가"가 버그 수정 마라톤으로 번지는 유일한 축이다.

**엣지 케이스**: 배치 중간엔 래칫 경고가 늘어날 수 있다(한 파일만 덮으면 파일 단위 델타가 요동). 래칫 판정은 **전 배치 완료 후 1회**만 한다.

## 성공 기준

- [ ] `pnpm test` green.
- [ ] `pnpm coverage:report`의 래칫 경고 **0건**(위 8건 표의 모든 행이 베이스라인 위로 회복).
- [ ] 로직 스코프 Lines **≥ 88%**, 그리고 그 상승분에 분모 재정의 기여가 **0**이다.
- [ ] 8개 어댑터 각각이 **인코딩 1 + 필수 쿼리 파라미터 1 + 에러 전파 1** 케이스를 갖는다(단순 "호출됨"이 아니다).
- [ ] **9개 태스크 전부가 mutation 실측 기록을 갖는다** — 무엇을 망가뜨려 어느 테스트가 red가 됐는지.
- [ ] 테이블 순회 4곳(blob-db 4패밀리 / `update*Account` 8 / `expandBlock` 15 / `AnnotationTool` 7)의 기대값이 **리터럴**이고 SUT가 계산한 값이 아니다.
- [ ] `expandBlock` 테이블이 `NotionBlock["type"]` 15종을 타입 수준으로 전수 강제한다(더미 타입 추가 → typecheck red 실측).
- [ ] `blob-db` 4패밀리 20함수가 왕복 + keys + delete + clear를 갖고, 2네임스페이스 키 스코프와 `get*` 가드 비대칭이 각각 assert된다.
- [ ] `md.noValue`·`logSummary.*.lineNoError`가 미커버 목록에서 사라진다.
- [ ] 프로덕션 픽스 3건이 각각 재현 테스트 + `docs/POSTMORTEM.md` 항목을 갖는다.
- [ ] `coverage/baseline.json`이 갱신되고 별도 커밋으로 남는다. **갱신 게이트는 "하락 파일 0" 하나이고 ≥88%는 기획 성공 기준으로만 쓴다**(회귀가 없으면 기준선은 전진시킨다 — 그게 래칫의 목적이다).
