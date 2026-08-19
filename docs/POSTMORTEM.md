# 회고 (Postmortems)

회귀·버그를 잡아 고칠 때마다 "왜 틀렸나 → 다음에 어떻게 막나"를 한 항목으로 남긴다. e2e 8회 루프 같은 자동 복구는 **그 자리에서** 문제를 메우지만, 같은 함정을 다음에 또 밟지 않으려면 사후분석이 코드 옆에 남아 있어야 한다. git에 커밋되는 이 파일이 그 정본이다.

작성은 `/postmortem` 스킬이 직전 픽스 컨텍스트로 자동 추가한다. 손으로 쓸 때도 아래 형식을 따른다.

## 작성 형식

각 항목은 최신순(위가 최신)으로 추가한다.

```
## YYYY-MM-DD — <한 줄 제목>

- **영역**: `background`, `store`          ← 1개 이상
- **계열**: `미검증단언`, `드리프트`            ← 0개 이상 (해당 없으면 줄 생략)
- **그물**: `unit`                        ← 정확히 1개
- **증상**: 사용자가 관측한 잘못된 동작.
- **근본 원인**: 코드상의 진짜 원인(표면 증상 말고).
- **재발 방지**: 다음에 같은 류를 막는 구체적 체크(grep 패턴·전수 대상·테스트).
- **관련**: 손댄 파일·핵심 함수.
```

자명한 것(git diff만 봐도 아는 것)은 빼고, **코드만 읽어선 안 보이는 구조적 함정·재발 패턴**만 남긴다.

## 태그 (집계용)

기록만 쌓고 집계가 없으면 "어느 영역이 반복 함정인가"를 못 센다. 세 축을 태그로 달아 `pnpm postmortem:report`가 랭킹을 재생산한다. **vocab 단일 출처는 `scripts/postmortem-report.mjs`의 `AREAS`·`PATTERNS`·`NETS`** — 여기 없는 값은 `pnpm postmortem:check`가 거부한다(오타·태그 누락·헤딩 유실도 함께 잡는다).

| 축 | 개수 | 값 |
|---|---|---|
| **영역** — 어디서 깨졌나 | 1+ | `디자인` `스타일해석` `어댑터` `에디터` `AI` `background` `content` `store` `e2e` `툴체인` `i18n` `컴포넌트` `미디어` `lib` |
| **계열** — 왜 깨졌나 | 0+ | `복제본`(같은 수정을 N곳에) `라이브러리전제`(프리미티브의 숨은 기본동작) `미검증단언`(문서·설계를 실측 없이 전제) `fail-open`(에러 삼킴·전량 폐기) `취소래치`(비동기 취소↔상태 레인) `드리프트`(하드코딩·버전이 단일 출처와 갈라짐) `cross-origin` |
| **그물** — 무엇이 잡았어야 했나 | 1 | `unit` `jsdom` `e2e` `시각`(레이아웃·색·포인터) `수동`(실제 탭 조작) `없음`(외부·인프라) |

새 값이 필요하면 vocab에 추가하되, **축이 잘게 쪼개질수록 반복이 안 드러난다** — 기존 값으로 억지가 아니면 기존 값을 쓴다.

---

## 2026-08-19 — red가 틀린 이유로 빨갰고, 스캔 그물은 대상이 0건이라 정규식이 망가져도 green이었다

- **영역**: `컴포넌트`, `i18n`, `툴체인`
- **계열**: `미검증단언`
- **그물**: `unit`
- **증상**: 사용자 관측 증상은 없다 — 세 건 다 **그물이 거짓으로 green/red였다**는 형태다. (a) "`<div onClick>`은 키보드로 못 누른다"를 증명한다던 red가 실은 버튼이 렌더되지 않아 빨갰다. (b) import 표기 전수 스캔이 4스코프 전부 0건이라 정규식이 통째로 망가져도 통과했다. (c) i18n 키를 리터럴로 펴며 `Record<K,V>`가 주던 컴파일 전수성이 사라져, 새 필터가 추가되면 마지막 else가 조용히 남의 라벨을 붙일 상태가 됐다.
- **근본 원인**: ① **red의 실패 메시지를 읽지 않으면 red는 아무것도 증명하지 않는다.** `ARRAY_CHUNK_SIZE`가 100인데 픽스처가 배열 60개라 "n개 더" 버튼 자체가 없었고, `getByRole("button", …)`은 "역할이 없다"가 아니라 "요소가 없다"로 실패했다. 두 실패는 메시지가 거의 같고(`Unable to find an accessible element with the role "button"`) 전자만 의도한 증명이다. 구현 단계에서 픽스처를 130개로 고쳐 green이 됐지만 **red 단계의 증명력은 회수되지 않는다** — 그 시점에 통과했을 수도 있는 구현(예: `<div role="button" tabindex="0">`)을 배제하지 못했다. ② **전수 스캔의 대상 집합이 비면 스캔 자체가 항진명제다.** `expect(offenders).toEqual([])`는 offenders를 만드는 정규식이 어떤 이유로든 0을 내면 통과하고, 4스코프가 전부 이미 0건이라 그 구분이 관측되지 않았다. 같은 배치가 log-viewer i18n 테스트에는 "대조 교집합이 비어 있지 않다" 앵커를 이미 넣어놨는데 이쪽만 빠졌다. ③ **스캐너 가시성과 컴파일 전수성은 서로 다른 축이고, 한쪽을 얻으려 형태를 바꾸면 다른 쪽이 조용히 빠진다.** `Record<TimelineFilter, string>` 테이블은 멤버 추가를 컴파일 에러로 잡았지만 `t()` 인자가 리터럴이 아니라 스캐너 사각이었다. 삼항 체인으로 펴면 스캐너는 보지만 마지막 else가 전수성을 삼킨다. `switch` + **명시 반환 타입**이 둘을 다 지킨다(반환 타입 annotation을 지우면 추론이 `string | undefined`로 넓어져 그물이 사라진다 — `noImplicitReturns`는 이 저장소에 없다). ④ **문서에 "예외 목록"을 만들면 독자는 그걸 전수로 읽는다.** raw `<button>` 예외를 표로 만들자 미등재 계열 6개가 즉시 "누락"이 됐다 — 목록의 문제가 아니라 **서문이 약속한 범위**의 문제였다.
- **재발 방지**: (1) **red를 확인할 때 실패 메시지가 의도한 원인인지 읽는다** — "요소가 없다"와 "요소의 역할·이름이 다르다"는 다른 실패다. 특히 `getByRole`/`getByText`는 두 경우의 메시지가 비슷하므로, 픽스처가 **대상 요소를 실제로 렌더하는지** 먼저 확인한다(임계값·청크 크기·조건부 렌더가 걸린 컴포넌트가 대상 부류: `grep -n "CHUNK_SIZE\|TRUNCATE_LENGTH\|_THRESHOLD" src/`). red가 끝난 뒤 픽스처를 고쳐야 했다면 그 red는 증명력이 없었다는 뜻이고, **구현 후 뮤테이션으로 회수**한다. (2) **`toEqual([])`·`toHaveLength(0)`로 끝나는 전수 스캔에는 자기검증 앵커를 짝으로 둔다** — 스캐너가 위반 문자열을 실제로 잡는다는 것 자체를 케이스로 고정한다(`expect(scan('...위반...'))`이 비지 않음). 대상 집합이 이미 0건인 래칫형 스캔은 **전부** 이 부류다: `grep -rln "toEqual(\[\])" src/**/__tests__/`. (3) **매핑 테이블을 스캐너용으로 펼 때는 전수성을 어떻게 유지할지 함께 정한다** — `switch` + 명시 반환 타입이 기본형이고, 삼항 체인은 쓰지 않는다. 반대로 테이블을 유지하면서 스캐너를 만족시키려면 값이 아니라 **썽크**(`Record<K, () => string>`)로 두면 된다. (4) **주석에 스캐너가 세는 형태를 예시로 쓰지 않는다** — `t("literal")`을 설명용으로 적었더니 스캐너가 그걸 참조 키로 잡아 사전 대조가 red가 됐다. 소스 스캔 그물이 있는 축은 주석도 스캔 대상이다. (5) **문서에 목록을 만들 때 "전수"인지 "판정 완료분"인지 서문에 쓴다** — 전수라고 읽히면 미등재분이 전부 결함으로 승격되고, 그 목록을 완성할 예산이 없으면 목록 자체가 부채가 된다.
- **관련**: `src/sidepanel/components/__tests__/JsonTreeViewer.test.tsx`(픽스처 60→130, `ARRAY_CHUNK_SIZE` 100), `src/lib/__tests__/import-convention.test.ts`(자기검증 앵커 + 부수효과 import·단일따옴표·bare index 커버), `src/log-viewer/components/TimelinePanel.tsx:filterLabel`(switch + 명시 반환 타입), `src/log-viewer/__tests__/i18n.test.ts`(테이블·삼항 키 6개 앵커 — 이 파일의 기존 앵커 2개가 (2)의 선례다), `docs/DESIGN.md`(raw `<button>` 예외 표 서문). 계열 선행: **2026-08-11**(자기검증 앵커를 달아놓고도 스캐너가 소비자 하나를 통째로 안 봤다 — 앵커의 *범위* 축) · **2026-08-06**(그물을 그것이 지킬 코드와 같은 시점에 써서 맹점 상속 — 빈 그물 3연속) · **2026-08-15**(`toEqual`이 무엇을 배제하는지 안 물었다 — 같은 *단언이 공허* 축).

## 2026-08-19 — 기본값을 뒤집는 변경은 반대 방향이 본체이고, read를 큐에 태우면 stale read는 사라지는 게 아니라 뒤로 밀린다

- **영역**: `background`, `lib`
- **계열**: `미검증단언`, `복제본`, `fail-open`
- **그물**: `unit`
- **증상**: (a) 연동한 적 없는 사용자에게 "세션이 만료되었습니다" 배너가 떴다(최초 연결 실패가 401 레인으로 오분류). (b) 그걸 고치자 이번엔 **진짜 refresh 실패 8지점이 400으로 떨어져 배너가 아예 안 떴다**. (c) `apply`의 read를 activation 큐에 태우자, 큐가 긴 상황(탭 여러 개 복원)에서 방금 연 사이드패널이 수십~수백 ms 뒤 스스로 닫혔다.
- **근본 원인**: 세 축이 서로 다른 형태다. ① **기본값 반전은 "고치려던 방향"보다 "반대 방향"이 어렵다.** `serializeOAuthError`의 401 fallthrough를 명시 플래그로 좁히는 순간, 플래그를 **안 단 모든 기존 throw**가 반대편으로 넘어간다 — 고친 쪽(최초 연결)은 테스트가 있었지만 넘어간 쪽(refresh 8지점)은 아무도 안 셌고 자체 검증 3관점도 못 봤다(code-review에서야 잡혔다). 처방은 지점 열거가 아니라 **경계 래핑**이었다: 4플랫폼의 refresh가 전부 `refreshHook` 호출 2곳을 지나므로 거기만 감싸면 8지점이 한 번에 덮인다. ② **read를 큐에 태우면 stale read의 창은 닫히는 게 아니라 이동한다.** 큐 밖 read는 "이르게" 읽어 stale이었고, 큐 안 read는 "늦게" 읽는다 — 그래서 `activateTab`이 패널을 연 **뒤에** 앞서 큐에 든 apply가 옛 값을 읽고 그 패널을 닫는, 이전엔 없던 순서가 생겼다. 직렬화는 순서를 **보장**할 뿐 어느 순서가 맞는지는 안 정해준다. ③ **단일 출처 통합이 사본을 늘렸다.** `picker-clear`로 뗀 `sendAll`은 `lib/sendToTabAllFrames`와 의미가 같았고, 그걸 만든 커밋 제목이 하필 "collapse the four duplicated single sources"였다 — **떼어내기(추출)와 모으기(통합)를 한 배치에서 하면 추출 쪽이 통합 대상을 안 본다.** 같은 형태로 `MarkdownIt` 팩토리는 4벌 하드코딩이던 `html: false`를 `...options` **뒤**가 아니라 앞에 둬, 호출부가 XSS 게이트를 덮을 수 있는 seam을 새로 열었다(렌더 결과가 `dangerouslySetInnerHTML`로 직행한다).
- **재발 방지**: (1) **기본값·fallthrough를 뒤집는 변경은 "넘어가는 쪽"을 전수로 센다** — `grep -rn "new OAuthError\|throw new .*Error" <영역>`으로 그 기본값에 의존하던 지점을 모두 열거하고, 각각이 어느 레인으로 가야 하는지 표로 적은 뒤 착수한다. 열거가 8곳을 넘으면 그건 손 태깅이 아니라 **경계가 잘못 잡힌 신호**다(공통 통로를 찾아 거기서 감싼다). (2) **설계 문서의 "X는 Y를 안다"·"Z는 양쪽에서 불린다" 같은 전제는 착수 전에 grep으로 확인한다** — 이 배치의 design.md에서만 세 번 틀렸다(`loadPromise === p`가 래퍼를 놓친 것 / runner가 두 레인을 구별할 신호가 있다는 것 / `persistOAuthTokens`가 양쪽에서 불린다는 것 — 실제 호출부는 refresh 한 곳). **호출부 개수·필드 유무는 5초짜리 grep이고 문서는 그걸 대신해주지 않는다.** (3) **직렬화(큐·락)를 도입할 때는 "누가 먼저 큐에 드는가"를 시나리오로 적는다** — 순서 보장이 곧 올바른 순서는 아니다. 사용자 제스처처럼 큐 밖에서 즉시 반영되는 축이 있으면, 큐 안 판정이 그걸 **모른 채** 늦게 읽는다(처방: gesture 시점에 in-memory로 의도를 남기고 큐 안 판정이 그걸 OR로 본다). (4) **leaf를 새로 뗄 때 그 leaf가 들고 갈 헬퍼를 `src/lib`·`src/sidepanel/lib`에서 먼저 grep한다** — "이 파일에서 떼어낸다"는 시야가 저장소 전체를 안 본다. 이번 건 `grep -rn "chrome.tabs.sendMessage" src/sidepanel/`가 즉시 잡았을 것이다. (5) **N벌을 팩토리로 모을 때는 하드코딩이 곧 보안 게이트인지 본다** — 4벌이 각자 박고 있던 값은 "덮을 자리가 없다"는 성질까지 함께 갖고 있었고, 팩토리의 `...options` 위치 하나로 그게 사라진다. 고정값은 스프레드 **뒤**에 둔다.
- **관련**: `src/background/oauth.ts:serializeOAuthError`(401 → refreshFailed 전용)·`refreshOAuthToken`, `src/background/oauth/errors.ts`(`refreshFailed` 옵션), `src/background/lib/connectLane.ts`(`inRefreshLane`/`inConnectLane`/`tagRefreshFailure` — 원본 에러를 변이하지 않는다: refresh in-flight promise를 동시 대기자가 공유한다), `src/background/lib/createRefreshRunner.ts`(refreshHook 호출 2곳 래핑), `src/background/jira-api.ts:refreshOnce`(runner 밖 예외 — 통째 래핑), `src/background/notion-api.ts`(refresh 함수 부재라 직접 태깅), `src/background/tab-bindings.ts:apply`·`pendingActivation`, `src/sidepanel/lib/markdownIt.ts:createMarkdownIt`, `src/sidepanel/picker-clear.ts`↔`src/sidepanel/lib/sendToTabAllFrames.ts`. 그물: `src/background/lib/__tests__/connectLane.test.ts`·`connect-reason-coverage.test.ts`(401 레인 전수 스캔 — 지점을 열거하지 않고 래핑 경계를 검사)·`src/store/__tests__/bundleBoundary.test.ts`·`tab-bindings.test.ts`(head-of-line 케이스). 계열 선행: **2026-08-19**(design.md 스니펫의 동일성 비교가 래퍼를 놓쳐 픽스가 무효 — 같은 문서, 같은 배치) · **2026-08-14**(중복을 이름으로 세면 매번 모자란다 — ④의 계열) · **2026-07-30**(401 fallthrough를 축 추가로 우회하려다 "근본 해법은 기본값 반전"으로 미뤄둔 그 항목이 이번 배치다).

## 2026-08-19 — 설계 스니펫의 동일성 비교가 래퍼를 놓쳐 픽스가 무효였고, 방어는 숨김 축만 닫고 복원 축을 열어둬 실패 모드가 "매달림"에서 "탭 브릭"으로 옮겨갈 뻔했다

- **영역**: `content`, `e2e`
- **계열**: `미검증단언`, `fail-open`
- **그물**: `unit`
- **증상**: (a) 스크롤 캡처가 실패하면 사이드패널의 `await`가 무기한 매달려 blocker·숨긴 fixed 요소·스크롤이 페이지에 남았다. (b) css raw 캐시는 한 번 실패하면 세션 내내 같은 rejection을 돌려줘 요소 선택마다 빈 캐시로 확정 발화했다. (c) 클립보드 복사의 `text/html` flavor가 사라져도 e2e 3개가 전부 green이었다.
- **근본 원인**: 세 가지가 같은 형태다. ① **설계 문서의 코드 스니펫을 실측 없이 옮기면 무효 픽스가 green으로 남는다** — design.md는 `loadPromise = p.catch(err => { if (loadPromise === p) loadPromise = null; throw err })`를 지시했는데 슬롯에 들어가는 건 `p`가 아니라 **`p.catch(...)` 래퍼**라 그 조건은 영원히 false다. 그대로 구현했으면 "실패 슬롯 비우기"가 한 줄도 동작하지 않은 채 타입체크·기존 테스트를 전부 통과한다. ② **방어를 한 축에만 걸면 실패 모드가 이동할 뿐 사라지지 않는다** — `settle`에 try/catch를 넣어 hang은 막았지만, `hideRepeatedElements`가 **인자 배열에 in-place push하고 반환으로만 세션에 돌려주는** 형태라 첫 타일에서 `?? []` 임시 배열이 대입 전에 소실됐고(이미 숨긴 요소가 복원 목록에서 사라짐), 대칭인 `endScrollCapture` 복원 루프는 per-element 가드가 없어 한 요소의 style write throw가 나머지를 영구 hidden으로 남겼다. 게다가 `finishScrollCapture`가 `endScrollCapture`를 **finally 없이 첫 줄에** 둬 그 throw가 `scrollSession = null`·`handleClear()`까지 날렸다 — 다음 `begin`이 같은 지점에서 다시 죽어 **그 탭의 스크롤 캡처가 영구 브릭**된다. ③ **재시도를 열면 loader의 비멱등성이 그 순간부터 reachable해진다** — `loadCrossOrigin`은 시트별로 전역 배열에 push하므로 중간 파싱 throw가 부분 적재를 남기고, 새로 열린 재시도가 같은 규칙을 선택마다 다시 쌓는다(자기 함수 주석의 "멱등"이 그 시점에 거짓이 된다). ④ 그물 쪽 형태도 같다 — **스텁이 읽는 범위가 곧 계약**이라, `getType("text/plain")`만 읽는 클립보드 스텁 3곳 앞에서는 `text/html`을 통째로 지워도 3개 spec이 green이었다(없는 타입이면 `getType`이 throw → `write` reject → 앱이 `writeText` 폴백을 타고 plain 배열은 정상적으로 채워진다).
- **재발 방지**: (1) **설계 문서의 스니펫에 담긴 동일성 비교·조건식은 옮기기 전에 "이 값이 실제로 그 슬롯에 들어가는가"를 확인한다** — promise 슬롯은 특히 위험하다(`.catch`/`.then`이 새 객체를 만든다). 이 저장소는 같은 판정을 위한 술어를 이미 갖고 있는 경우가 많으니(`isStaleLoad`) 새 비교를 만들기 전에 `grep -n "isStale\|=== p\|=== promise" src/content/`로 기존 술어를 먼저 찾는다. (2) **정리/복원 코드에 방어를 넣을 때는 짝이 되는 반대 축을 같은 커밋에서 센다** — `grep -rn "for (const .* of .*hidden\|prevValue\|removeProperty" src/content/`가 이 부류의 전수 대상이고, 정리 함수를 호출하는 쪽은 `try { cleanup() } finally { 상태 해제 }` 형태인지 확인한다(첫 줄 cleanup + 뒤따르는 상태 해제는 throw 하나로 세션이 영구히 안 닫히는 형태다). (3) **인자 배열에 in-place 누적하고 반환으로 돌려주는 함수는 소유권을 호출 전에 넘긴다**(`session.x ??= []` 후 그걸 전달) — `?? []`로 임시 배열을 만들어 넘기면 중간 throw에서 통째로 증발한다. (4) **재시도 경로를 새로 여는 변경은 그 loader가 멱등인지 함께 판정한다** — 전역 배열 push가 `await` 뒤에 있으면 로컬에 모아 한 번에 커밋한다. (5) **스텁·목이 읽는 필드 집합이 곧 그 축의 커버리지다** — 다중 flavor·다중 필드를 쓰는 API를 스텁할 때 실제 소비 코드가 쓰는 키를 전부 읽고, 각 키에 대한 단언을 따로 둔다(하나만 읽으면 나머지 삭제가 조용히 통과). 이번엔 뮤테이션(`text/html` 제거)으로 3개 spec red를 실측해 확인했다. (6) **rAF 콜백 안의 throw는 동기 rAF 스텁으로 재현 불가** — 스텁이 동기면 `new Promise` executor가 예외를 삼켜 **reject로 관측**되고 실제 hang이 안 나온다. 비동기(`setTimeout`) + 콜백 예외 비전파(브라우저 실동작)로 스텁해야 매달림이 재현된다.
- **관련**: `src/content/css-source-cache.ts:ensureLoaded`·`ensureCrossOriginLoaded`·`loadCrossOrigin`(원자 커밋), `src/content/scroll-capture.ts:scrollCaptureTo`(settle try/catch + `hiddenFixed ??= []`)·`endScrollCapture`(per-element 가드), `src/content/picker.ts:finishScrollCapture`·`handleBeginScrollCapture`(try/finally)·`picker.scrollCaptureTo` 수신부(rejection → `sendResponse(undefined)`), `src/sidepanel/scroll-capture.ts:runScrollCapture`(`typeof ack.y` shape 가드 — `{ok:false}`가 truthy라 `!ack`를 통과했다), 그물 `src/content/__tests__/scroll-capture.test.tsx`(비동기 rAF 스텁)·`css-source-cache-epoch.test.tsx`(실패 재시도·멱등)·`src/sidepanel/__tests__/scroll-capture.test.ts`(shape), e2e 스텁 3곳 `e2e/freeform-draft.spec.ts`·`issue-body-locale.spec.ts`·`code-block-collapse.spec.ts`, 계획 `docs/features/audit-refactor-7/`(design.md G1 스니펫이 ①의 출처). 계열 선행: **2026-07-23**(스크롤 캡처 sticky 복원 축 — 같은 파일의 복원 불변식) · **2026-07-16**(단일 출처 승격 주석이 거짓 — 문서·주석을 실측 없이 전제하는 같은 축) · **2026-08-06**(그물이 공허 — 스텁·골든의 관측면이 좁아 삭제가 통과).

## 2026-08-16 — fixture가 호출부의 *값*만 흉내내고 *모양*은 안 흉내내자, 셸이 새로 연 구멍 두 개가 나란히 안 잡혔다

- **영역**: `컴포넌트`, `어댑터`
- **계열**: `미검증단언`, `라이브러리전제`
- **그물**: `jsdom`
- **증상**: 6개 커넥트 폼의 공통 셸(`PlatformConnectFlow`)을 뽑으면서 구멍 두 개를 만들었고, **둘 다 내가 그 자리에 깐 그물이 통과시켰다.** ① OAuth 요청 prop을 `BgRequest`로만 타이핑해 `platform="github"` + `startOAuthRequest={{type:"notion.startOAuth"}}`가 컴파일을 통과했다 — 남의 플랫폼 토큰이 이 계정 슬롯에 저장되는 경로다. ② `availableRequest`를 `useEffect` 의존성에 둬서, 호출부 6곳이 전부 인라인 리터럴이라 조상이 리렌더할 때마다 `oauth.available`을 다시 조회했다(`IntegrationsTab`은 CSS `hidden`으로만 감춰져 **언마운트되지 않는다** — 리뷰어 실측으로 트림 인코딩 진행률 틱 한 번에 수백 회 왕복이 날 경로였다). ②의 회귀 테스트를 쓴 **직후에도** 의존성을 되돌리는 뮤테이션이 11/11 green이었다.
- **근본 원인**: fixture가 호출부의 **값**은 같게 주면서 **모양**을 다르게 줬고, 두 구멍이 정확히 그 모양 축에 살았다. ①의 렌더 테스트는 요청 3개를 `as never`로 넘긴다 — 편의를 위한 캐스트인데 그게 *컴파일 시점 계약*을 통째로 우회하므로, 타입 게이트가 있든 없든 테스트는 같은 결과를 낸다. ②의 fixture는 요청 객체를 **모듈 상수**로 넘긴다 — 값은 같지만 참조가 고정되고, 재현하려던 버그가 바로 *참조가 매번 새로 생긴다*는 것이라 실패 모드가 애초에 재현되지 않는다. 한 겹 더 있다: ①을 고치려고 `Extract<BgRequest, {type: \`${P}.startOAuth\`}>`를 넣었는데 **아무것도 안 잡았고**, 교차 타입으로 바꿔도 마찬가지였다 — `P`가 그 자리에서도 추론 후보를 얻어 넓어지기 때문이고, 조건부 타입은 미해결 상태에서 할당 검사가 관대하기까지 하다. 즉 **타입을 조였다고 믿은 두 번의 시도가 연속으로 무음**이었고, 최소 재현으로 명시 인스턴스화와 비교해보고서야 `NoInfer<P>`가 필요하다는 게 드러났다.
- **재발 방지**: (1) **공용 셸을 뽑을 땐 "호출부가 이 prop을 어떤 *모양*으로 넘기는가"를 fixture에 그대로 옮긴다** — 인라인 리터럴이면 인라인 리터럴로(부모 컴포넌트를 하나 두고 `rerender`), 캐스트 없이. `as never`·`as any`가 fixture에 있으면 **그 prop의 타입 계약은 이 테스트의 사정거리 밖**임을 주석으로 남기고 별도 그물을 판다. 전수: `grep -rn "as never\|as any" src/**/__tests__/*.tsx`. (2) **참조 동일성이 계약인 값(effect 의존성·memo 키·`useCallback` 인자)은 fixture를 모듈 상수로 두면 항등식이 된다** — 렌더마다 새 객체가 오는 상황을 만들어야 잰다. 판정법: 그 값을 상수로 바꿨을 때 테스트가 여전히 통과하면 그 축은 안 재고 있다. (3) **제네릭으로 두 prop을 상관시킬 땐 추론원을 한쪽으로 못 박는다** — `NoInfer<P>`. `Extract<…>`·교차 타입은 추론 후보를 막지 못해 무력하다(둘 다 실측). 조인 뒤엔 **반드시 어긋난 조합을 주입해 `error TS`를 눈으로 본다** — 타입은 테스트가 못 도는 레인이라 "썼으니 된다"가 유일한 검증이 되기 쉽다. (4) **컴파일 시점 계약엔 소스 스캔 그물을 같이 둔다** — 누가 `NoInfer`를 군더더기로 빼도 `pnpm test`는 green이다. 이 저장소는 `ts-expect-error` 선례가 0건이므로(`styles/__tests__/tokens.test.ts:47`) 억제 주석 대신 스캔 + 자기검증 앵커를 쓴다(`locale-registry.test.ts` 형태).
- **관련**: `src/sidepanel/tabs/connect/PlatformConnectFlow.tsx`(요청 2개 `BgRequest & { type: \`${NoInfer<P>}.…\` }` · `availableRef` + `[platform]` 의존 · 계정 리터럴은 `buildAccount` prop으로 호출부 잔류), 그물 `src/sidepanel/tabs/connect/__tests__/PlatformConnectFlow.test.tsx`(`InlinePropParent` 부모 리렌더 케이스 + "요청 prop의 platform 결속" 소스 스캔 describe + 앵커), 계획 `docs/features/audit-refactor-6/tasks.md`(배치 완료와 함께 삭제 — 안 하고 남긴 판단은 `docs/features/DROPPED.md` 2026-08-16)(Task 4-1 — 세 함정을 본문에 편입). 계열 선행: **2026-08-15**(`toEqual`이 배제하는 입력을 안 물었다 — fixture 키 집합이 출력과 같으면 항등식이라는 *값* 축) · **2026-08-14**(excess property check는 객체 리터럴에만 걸린다 — 같은 셸 추출이 타입 게이트를 내리는 형태) · **2026-08-12**(그물 세 겹이 전부 "있기만 하면 통과").

---

## 2026-08-15 — 모듈을 옮기며 반경을 import로만 셌더니, `vi.mock` 문자열과 상대경로 import가 통째로 빠졌다

- **영역**: `툴체인`, `lib`
- **계열**: `미검증단언`, `복제본`
- **그물**: `unit`
- **증상**: `src/types/messages.ts`의 런타임 6심볼을 `src/lib/bg-client.ts`로 옮기는 태스크에서 계획 문서의 반경(90파일)을 못 믿고 재실측했는데, **그 재실측도 틀렸다.** `"@/types/messages"`를 import하며 6심볼을 쓰는 파일 79개를 세어 전량 치환한 직후 `pnpm test`가 **21파일 119케이스 red**를 냈다. 원인은 `vi.mock("@/types/messages", () => ({ sendBg }))` **22개** — import가 아니라 모듈 **문자열**이라 어떤 import grep에도 안 걸린다. 이어서 `pnpm typecheck`가 `src/types/__tests__/messages.test.ts`를 뱉었다. 그 파일은 `from "../messages"` **상대경로**라 alias 기준 실측의 사각이었다. 실제 접촉 파일은 79가 아니라 **약 101개**.
- **근본 원인**: "이 모듈을 참조하는 곳"을 **한 가지 표기**로만 셌다. 모듈 참조는 최소 세 표기로 존재한다 — ① alias import(`@/types/messages`) ② 상대경로 import(`../messages`) ③ **모듈 문자열을 인자로 받는 API**(`vi.mock`·`importOriginal<typeof import(...)>`·동적 `import()`). ③은 코드가 아니라 **문자열 리터럴**이라 타입 검사도 import grep도 못 본다. 하루 전 이 배치가 "중복을 이름이 아니라 본문으로 세라"를 문서에 박았는데, 그건 *무엇을* 세는가의 축이었고 이번에 빠진 건 *어떤 표기로* 세는가의 축이다 — 같은 교훈의 다른 절반이라 앞 회고를 읽고도 그대로 밟았다. 이번엔 ③의 실패 모드가 시끄러웠지만(mock이 무효화되니 실제 `chrome.runtime`을 때려 red), **조용해지는 형태가 있다는 게 진짜 위험이다** — 옮긴 심볼이 부수효과 없는 순수 함수였다면 mock 무효화가 "실물이 잘 도네"로 green을 유지했을 것이다.
- **재발 방지**: (1) **모듈을 옮길 땐 세 축을 각각 세고 각각 0을 확인한다.** alias `grep -rn '"@/old/path"' src/ e2e/ scripts/` · 상대경로 `grep -rn 'from "\.\{1,2\}/[^"]*old-name"' src/` · 모듈 문자열 `grep -rn 'vi\.mock("@/old/path"\|import("@/old/path")' src/`. 세 수를 **따로 적어두고** 각각 0을 확인한다 — 합계만 보면 어느 축이 안 끝났는지 안 보인다. (2) **`vi.mock` 대상 목록은 이동 *전에* 뽑는다** — 이동 후엔 무효화를 red로만 알 수 있고, 순수 함수면 red조차 안 난다. (3) **계획 문서의 반경을 재실측하되 재실측의 *방법*도 의심한다** — 이번 실측은 문서의 90을 79로 고쳤지만 여전히 20% 모자랐다. "숫자를 다시 쟀다"는 "맞게 쟀다"의 근거가 아니다. (4) 이동 대상이 **부수효과를 가진 심볼**(전역 이벤트 발화·네트워크)이면 mock 무효화가 시끄럽고 **순수 함수**면 조용하다 — 순수 함수를 옮길 때 ③ 축을 더 세게 본다.
- **관련**: `src/lib/bg-client.ts`·`src/lib/app-events.ts`(신설 — `src/types/messages.ts`에서 이동), 무효화된 mock 22곳(`src/sidepanel/lib/__tests__/submitTo*.test.ts`·`src/sidepanel/tabs/*Fields/__tests__/*`·`src/content/__tests__/css-source-cache-epoch.test.tsx` 등), 사각이던 상대경로 `src/types/__tests__/messages.test.ts`(삭제 — 새 `src/lib/__tests__/bg-client.test.ts`가 흡수), 계획 `docs/features/audit-refactor-6/tasks.md`(배치 완료와 함께 삭제 — 안 하고 남긴 판단은 `docs/features/DROPPED.md` 2026-08-16)(Task 6-2 — 실측치와 세 축 규칙을 본문에 편입). 계열 선행: **2026-08-14**(중복을 이름으로 세면 매번 모자란다 — *무엇을* 세는가 축) · **2026-07-26**(그물의 스캔 범위가 번들 그래프보다 좁아 조용히 green — 검사 **대상 집합**이 틀리면 검사 내용이 무의미하다는 같은 뿌리).

---

## 2026-08-15 — `toEqual`을 엄격함의 최대치로 골라놓고, 그게 무엇을 배제하는지는 안 물었다

- **영역**: `어댑터`, `lib`
- **계열**: `미검증단언`
- **그물**: `unit`
- **증상**: 제출 인자 매핑 어댑터의 유닛 테스트 21케이스가 전부 green인데, **그중 9개가 자기가 지킨다고 이름 붙인 실패 모드를 못 잡고 있었다.** ① `*LastSubmitFields` 8케이스 중 7개는 어댑터 본문을 `(f) => ({ ...f })`로 통째 접어도 green이다 — 그 함수의 존재 이유가 "화이트리스트"인데. ② `requireMediaUpload` pass-through는 3경로 중 2개를 상수 `false`로 바꿔도 green이다 — Slack 승격 시 원본 유실을 막는 가드의 배선인데. 둘 다 **뮤테이션을 넣어보고서야** 드러났고, 그전까지는 `toEqual`(정확 일치)을 썼다는 사실이 엄밀함의 증거처럼 읽혔다.
- **근본 원인**: 메커니즘이 둘인데 뿌리는 하나다. ① **fixture의 키 집합이 출력 키 집합과 정확히 같으면 화이트리스트 검증은 항등식이 된다.** 화이트리스트가 막겠다는 건 "입력에 목록 밖 키가 있을 때 그게 안 새는 것"인데 fixture에 그 키가 없으니 그 상황이 **재현조차 안 된다**. 타입도 안 도와준다 — 변수 전달이라 excess property check가 안 걸린다(이 배치가 사흘 전 기록한 바로 그 항목). ② **`toEqual`은 값이 `undefined`인 키를 무시한다.** 그래서 "이 플랫폼엔 이 키가 없어야 한다"를 `toEqual`로는 못 고정하고, `x ?? false`류 pass-through도 **기대값이 `false`인 케이스만 있으면** 상수 `false`와 구별되지 않는다. 공통 뿌리: `toEqual`이 `toMatchObject`보다 강하다는 건 맞고 그 근거를 커밋 메시지에 길게 적기까지 했는데, **"그래서 이 단언이 배제하는 입력이 무엇인가"를 한 번도 안 물었다.** 강한 도구를 골랐다는 사실이 그 질문을 대신해버렸다.
- **재발 방지**: (1) **매핑·필터 함수의 fixture에는 "통과하면 안 되는 입력"을 반드시 섞는다** — 화이트리스트면 목록 밖 키를, 블랙리스트면 목록 안 키를. 판정법: fixture 키 집합과 기대 출력 키 집합이 **같으면 그 테스트는 항등식**이다. 전수 대상은 "입력을 골라 담는" 함수 전부 — `grep -rn "LastSubmitFields\|Args(" src/sidepanel/lib/__tests__/`. (2) **`toEqual`로는 "키가 없어야 한다"를 못 고정한다** — 값이 `undefined`인 키를 무시하므로 `expect("k" in obj).toBe(false)`를 따로 쓴다. (3) **pass-through 인자는 기본값 케이스만 두면 상수와 구별되지 않는다** — `input.x ?? false` 형태는 **`true`를 넣어 `true`가 나오는** 케이스가 있어야 고정된다. 전수: `grep -rn "?? false\|?? true" src/sidepanel/lib/`. (4) **판별자는 뮤테이션뿐이다** — 새 테스트에 "이걸 막는다"는 이름표를 붙이기 전에 그 형태를 실제로 주입해 red를 본다. 이 배치에서만 세 번째 사례다.
- **관련**: `src/sidepanel/lib/submitAdapters.ts`(`*LastSubmitFields` 8종 화이트리스트 · `MediaGuard` pass-through 3종), 그물 `src/sidepanel/lib/__tests__/submitAdapters.test.ts`(fixture에 `UI_ONLY` 키 주입 + `requireMediaUpload: true` pass-through 3경로 + 키 부재 축 describe), 계획 `docs/features/audit-refactor-6/tasks.md`(배치 완료와 함께 삭제 — 안 하고 남긴 판단은 `docs/features/DROPPED.md` 2026-08-16)(G3 — 검증 항목에 "뮤테이션으로 비공허성 확인"을 추가했다). 계열 선행: **2026-08-14**(골든 스냅샷에 `inline:`이 0회라 공허 — 같은 *그물이 그 축을 안 덮는다* 축) · **2026-07-31**(다단 게이트의 앞 항이 잘라서 뒤 항 단언이 공허) · **2026-08-14**(excess property check가 스프레드·변수 전달에서 사라진다 — 이번 ①의 타입 쪽 절반).

---

## 2026-08-14 — 중복을 이름으로 세면 매번 모자란다: 한 배치에서 네 번 틀렸고, 마지막 한 번은 그 교훈을 문서에 박은 직후였다

- **영역**: `어댑터`, `lib`
- **계열**: `복제본`, `미검증단언`
- **그물**: `unit`
- **증상**: 중복 제거 배치(audit-refactor-6)에서 **통합 대상 개수가 네 번 연속 틀렸다.** 인라인 파일명 하드코딩 9→**11**곳 · `toUploadEntry` 통합 대상 3→**2**벌(slack은 본문이 달라 제외) · `emitLogSummary` 4→**5**벌 · `footerMarkdown` 4→**5**곳. 전부 착수 후 실측에서 드러났고, 문서대로 따랐으면 사본이 조용히 남아 다음 드리프트의 씨앗이 됐다. 마지막 건이 특히 나쁘다 — 앞의 셋을 겪고 "**이름이 아니라 본문으로 세라**"를 `tasks.md` 선행 조건에 박은 **바로 그 세션에서**, `grep "function footerMarkdown"`으로 세어 함수가 아닌 asana의 인라인 리터럴 사본을 놓쳤다.
- **근본 원인**: 열거를 **선언 형태**(`function <name>`)로 한다. 그런데 복제는 선언 형태를 안 지킨다 — ① 이름이 다르거나(`emitLogSummaryMd`는 plain `emitLogSummary` grep에 안 걸리는데 출력은 바이트 동일이었다) ② 본문이 미묘하게 다르거나(slack `toUploadEntry`는 `contentType`이 없어 "동일 3벌"이 거짓) ③ **아예 함수가 아니거나**(asana 푸터는 `lines.push(리터럴)` 인라인). grep이 찾는 건 *이름*이고 통합해야 하는 건 *본문*이라, 둘이 어긋나는 만큼이 그대로 오차가 된다. 여기에 검증 항목이 "치환한 개수"로 쓰여 있어 오차를 못 잡는다 — N곳을 고쳤는지만 세면 N+1번째가 남아도 green이다. "규칙을 알면 안 밟는다"가 성립하지 않는다는 게 네 번째 사례의 요점이다. 기계적 절차가 아니면 같은 자리에서 또 센다.
- **재발 방지**: (1) **개수는 선언이 아니라 *산출물*로 센다** — `footerMarkdown`이면 `grep -rn "Reported via" src/`(결과 리터럴), 파일명 헬퍼면 `grep -rn 'inline-\${' src/`. 선언 grep(`grep "function X"`)은 **하한만** 준다. (2) **통합 후보는 본문 해시로 그룹핑한다** — `for f in <파일들>; do awk '/^function X/,/^}/' $f | md5; done | sort -u | wc -l`. 이름이 달라도 같은 그룹에 묶이고, 그룹 수가 곧 "진짜 몇 종인가"다(이 배치에서 `listItems` 8벌이 2종으로 나온 게 인자명 차이뿐임을 이 방법이 5초에 밝혔다). (3) **검증 항목을 "치환한 개수"가 아니라 "남아야 할 것의 화이트리스트"로 쓴다** — `grep -rn "function emitLogSummary" src/sidepanel/lib/` 결과가 정확히 `{slack, notion, adf, html}` 4개여야 한다처럼. 개수는 새 사본이 어떤 이름으로 생겨도 통과하지만 집합은 red가 된다(CLAUDE.md가 캐스케이드 판정에 박아둔 "열거가 아니라 화이트리스트"의 같은 형태). (4) **감사·설계 문서에 적힌 개수는 전부 재실측 대상**이고, 실측치가 다르면 코드가 아니라 **문서를 그 자리에서 고친다**(개수를 미충족으로 남기면 다음 세션이 "아직 할 일이 남았다"로 읽는다).
- **관련**: `src/lib/inline-ref.ts:inlineUploadFilename`(11곳)·`src/sidepanel/lib/prepareUpload.ts:toUploadEntry`↔`submitToSlack.ts:toUploadEntry`(통합 안 한 예외)·`src/sidepanel/lib/issueBodyShared.ts:footerMarkdown`·`emitMarkdownLogSummary`(5벌씩), 잔여 화이트리스트를 검증에 쓴 예 `docs/features/audit-refactor-6/tasks.md`(배치 완료와 함께 삭제 — 안 하고 남긴 판단은 `docs/features/DROPPED.md` 2026-08-16)(Task 2-3), 배치 전역 규칙을 박은 자리 같은 문서 "선행 조건". 계열 선행: **2026-08-14**("골든 스냅샷이 생산자를 안 거쳐…" — 검증 칸 자체가 미검증 단언이라는 같은 축) · **2026-08-06**(`errors[]` 길이를 개수로 쓴 소비처 8곳 — 세는 대상을 잘못 고른 형태).

---

## 2026-08-14 — 중복을 헬퍼로 모으면 그 자리에서 타입 게이트가 사라진다 — excess property check는 객체 리터럴에만 걸린다

- **영역**: `store`, `어댑터`
- **계열**: `라이브러리전제`
- **그물**: `unit`
- **증상**: 같은 배치의 **독립된 두 리팩터가 같은 구멍을 만들었다.** ① `confirmDraft`의 공통 필드를 `baseDraftRecord()`로 뽑아 `saveDraft({...baseDraftRecord(), …})`로 넘기자, 헬퍼 안에서 `pageTitle`을 `pageTitl`로 오타내도 `pnpm typecheck`가 통과하고 필드만 조용히 빠졌다(리터럴이던 직전까지는 TS2561로 잡히던 자리다). ② `submitToSlack`의 로컬 `toUploadEntry`를 공용판으로 통합하려 했는데, `slack.uploadFiles`의 페이로드 타입은 `{filename, dataUrl}`뿐이라 공용판이 얹는 `contentType`이 **타입 검사 없이** 메시지 경계를 넘어간다. 둘 다 커밋 전 리뷰에서 잡혔고 출시되지 않았다.
- **근본 원인**: TypeScript의 excess property check는 **객체 리터럴을 직접 할당·전달할 때만** 돈다. 스프레드 소스(`...helper()`)나 `.map(fn)` 결과처럼 **한 단계를 거친 값**에는 안 걸린다. 필수 필드 누락은 여전히 잡히므로, 구멍은 정확히 **optional 필드**에서 열린다 — ①의 `pageTitle`·`apiHostsDerived`는 `IssueRecord`에서 optional이고, ②의 `contentType`은 좁은 쪽 타입에 아예 없다. 이 배치의 주제가 "복제된 조립을 한 곳으로 모으기"라 **모든 태스크가 리터럴을 함수 뒤로 옮기는 형태**였고, 그때마다 같은 게이트가 조용히 내려간다. 중복 제거의 대가로 타입 안전을 내주는데 그 거래가 diff에 안 보인다.
- **재발 방지**: (1) **리터럴을 헬퍼 뒤로 옮기면 반환 타입을 명시한다** — `function base(): Pick<Target, "a"|"b"> => ({…})`. 그래야 오타가 헬퍼 안에서 TS2561로 잡힌다. 전수: `grep -rn '\.\.\.[a-zA-Z_]*(' src/ --include=*.ts --include=*.tsx`로 스프레드 호출을 뽑아 **반환 타입이 명시됐는지**만 본다(추론에 맡긴 것이 위험군). (2) **좁은 메시지 페이로드에 넓은 객체를 넣지 않는다** — `sendBg({… files: xs.map(toEntry)})` 형태는 `BgRequest` union이 좁아도 통과한다. 전수: `grep -rn '\.map(to[A-Z]' src/sidepanel`로 뽑고, 각 페이로드 타입(`src/types/messages.ts`)과 매퍼 반환 필드를 대조한다. (3) **타입이 못 지키는 걸 알았으면 그 자리에 테스트를 둔다** — ①은 `Object.keys(record)` 키 존재 단언, ②는 `expect(upload.files).toEqual([...])`(부분 일치가 아니라 **정확 일치**)가 각각 유일한 그물이다. `toMatchObject`·`objectContaining`은 넓어진 객체를 통과시키므로 이 축에선 쓰지 않는다. (4) **판정 기준은 "필드가 optional인가"** — 필수 필드는 컴파일러가 계속 지켜주므로 헬퍼로 옮겨도 안전하다. optional만 세면 된다.
- **관련**: `src/store/editor-store.ts:baseDraftRecord`(반환 타입 `Pick<IssueRecord, …>` 명시 — 오타 주입으로 전후 실측), `src/sidepanel/lib/prepareUpload.ts:toUploadEntry`↔`src/sidepanel/lib/submitToSlack.ts:toUploadEntry`(통합하지 않고 남긴 예외 + 사유 주석), 계약 `src/types/messages.ts`(`slack.uploadFiles` 페이로드), 그물 `src/store/__tests__/editor-store.test.ts`(공통 필드 키 존재)·`src/sidepanel/lib/__tests__/submitToSlack.test.ts`(`toEqual` 정확 일치), 계획 `docs/features/audit-refactor-6/tasks.md`(배치 완료와 함께 삭제 — 안 하고 남긴 판단은 `docs/features/DROPPED.md` 2026-08-16)(G7·G1 — 이 배치의 남은 그룹 G2~G8도 전부 같은 형태라 착수 시 이 항목을 먼저 읽는다).

---

## 2026-08-14 — 부수효과 실행을 boolean 식으로 접자 문법이 강제하던 순서가 단축 평가에 걸렸고, 조합이 없어 스위트는 전부 green이었다

- **영역**: `store`
- **계열**: `미검증단언`
- **그물**: `unit`
- **증상**: `confirmDraft`의 영속 꼬리(모드별 blob 저장 → 로그 3종 저장 → 실패 보고 1회)를 3분기 공통 헬퍼로 뽑자, **blob 저장이 이미 실패한 세션에서 로그 저장과 pending 로그 정리가 통째로 건너뛰어질 수 있는 형태**가 됐다. 사용자에겐 같은 에러 토스트가 뜨므로 구분되지 않는다. `pnpm typecheck`·전체 스위트 5,645건이 전부 green이라 출하 전 자체 검증에서만 드러났다.
- **근본 원인**: 원래 코드는 `if (await persistAttachedLogs(...)) failed = true;` 라는 **독립 문**이었다 — 로그 저장이 먼저 실행되는 것이 문법으로 강제된다. 헬퍼가 "로그를 저장했나"와 "blob이 실패했나" 두 사실을 한 boolean 식(`(await persistAttachedLogs(...)) || blobFailed`)으로 합치면서, **피연산자 순서가 유일한 안전장치**가 됐다. 다음 사람이 가독성을 이유로 `blobFailed || await persistAttachedLogs(...)`로 뒤집으면 단축 평가가 부수효과째로 건너뛴다. 그물이 없던 이유는 따로다 — 테스트의 blob mock이 전부 `true`를 resolve해 **`blobFailed=true` × `logsAttach=true` 조합이 스위트에 0건**이었고 `onBlobSaveFailed.fire`를 단언하는 테스트도 0건이었다. 같은 리팩터를 덮으려고 먼저 박아둔 골든 스냅샷 8건은 관측면이 **`saveDraft` 인자**라 async 꼬리를 원리적으로 못 본다 — "스냅샷이 있으니 덮였다"가 이번의 미검증 전제였다.
- **재발 방지**: (1) **`await`를 논리 연산자의 피연산자로 옮기는 리팩터는 순서가 곧 동작이다** — 전수: `grep -rn "await [^;]*||\|||[^|;]*await\|await [^;]*&&\|&&[^&;]*await" src/`로 뽑고, 각각 "좌항이 조건과 무관하게 반드시 실행돼야 하나"를 답한다. 반드시면 식으로 합치지 말고 **문으로 남긴다**(문법이 지켜주는 걸 주석으로 대체하지 않는다). (2) **부수효과 실행을 boolean으로 접기 전에 "실패 플래그 × 부수효과" 조합이 테스트에 있는지 먼저 센다** — `src/store/blob-db.ts`의 저장 함수는 throw가 아니라 **falsy를 resolve**하므로 `mockRejectedValue`가 아니라 `mockResolvedValueOnce(false)`로 걸어야 그 조합이 생긴다(그래서 "에러 케이스는 있겠지"가 빗나간다). (3) **골든 스냅샷을 안전망으로 삼기 전에 그 관측면을 한 줄로 적어라** — 여기선 "`saveDraft`에 넘어간 인자"였고, 리팩터가 건드린 코드(async IIFE)는 그 면 밖이었다. 면 밖이면 스냅샷 개수와 무관하게 별도 그물이 필요하다.
- **관련**: `src/store/editor-store.ts:confirmDraft`(영속 꼬리 3분기 — freeform·video·screenshot. element는 로그를 안 붙여 이 꼬리가 없다)·`persistAttachedLogs`, 그물 `src/store/__tests__/editor-store.test.ts`("이미지 저장 실패 + logsAttach → 로그는 저장되고 실패 보고는 1회" — 뒤집기를 주입해 red 확인), 관측면이 좁았던 골든 `src/store/__tests__/__snapshots__/editor-store.test.ts.snap`(G0-4 8건), 계획 `docs/features/audit-refactor-6/tasks.md`(배치 완료와 함께 삭제 — 안 하고 남긴 판단은 `docs/features/DROPPED.md` 2026-08-16)(G7). 계열 선행: **2026-07-31**("다단 게이트의 안 생긴다 테스트" — 같은 *조합이 없어 green* 축의 e2e 판).

---

## 2026-08-14 — "생성 직후 적용"이라는 지시를 그대로 따랐더니 재사용 경로가 통째로 빠졌다

- **영역**: `content`
- **계열**: `미검증단언`
- **그물**: `e2e`
- **증상**: picker 인스펙터 카드의 다크 전환을 OS가 아니라 앱 theme에 묶는 작업에서, 요소를 한 번 고른 뒤 설정에서 theme을 바꾸고 다시 선택(repick)하거나 element shot을 시작하면 카드가 **옛 톤 그대로** 떴다. 확장을 리로드하고 첫 picker를 띄우는 흐름에선 항상 맞게 나와서, 수동 검증 체크리스트(앱 theme × OS theme 조합)를 그대로 돌면 안 보인다.
- **근본 원인**: 설계 문서가 "`picker.start`가 실어온 theme을 모듈 로컬에 보관하고 **`createOverlay()` 직후** 적용한다"고 지시했고 그대로 구현했다. 그런데 `handleStop`은 overlay를 파괴하지 않는다(파괴는 `handleClear`뿐). 선택 확정마다 `picker.stop`이 뿌려지므로 **overlay가 살아있는 채 두 번째 `picker.start`가 도착하는 경로가 오히려 흔한 쪽**이고, 그 경로는 `if (!overlay)` 블록에 안 들어가 `pickerTheme`만 갱신되고 DOM은 안 바뀐다. 지시가 값의 **수명**이 아니라 **생성 시점**만 말한 형태다 — "재생성 3경로를 한 번에 덮어라"라는 요구가 워낙 뚜렷해서, 정작 "재생성이 없는 경우"가 사각에 남았다.
- **재발 방지**: (1) **"X 직후 적용"류 지시를 받으면 X가 안 일어나는 재진입 경로를 먼저 센다** — 여기선 `grep -n "overlay = createOverlay()" src/content/picker.ts`(생성 3곳)와 `grep -n "destroyOverlay\|overlay = null" src/content/picker.ts`(파괴 경로)를 대조해 "생성 없이 재진입"이 가능한지 본다. 생성보다 진입이 잦으면 적용 지점은 생성부가 아니라 **진입부**다. (2) 상태를 모듈 로컬로 승격하는 수정은 **보관과 적용을 같은 줄에서 보지 말 것** — `pickerTheme = …`(매 start)과 `setOverlayTheme(…)`(생성 시)이 서로 다른 빈도로 도는 걸 그 자리에서 눈치채기 어렵다. (3) 이 축은 유닛·jsdom 사정권 밖이다(`picker.ts`·`overlay.ts`가 로직 스코프 제외). 자동으로 잡으려면 확장을 띄워 theme 전환 → repick → shadow root의 `data-theme`을 읽는 e2e가 필요하고 현재는 없다 — 수동 확인 항목에 **"두 번째 picker"** 를 명시해 두는 게 그 전까지의 대체물이다.
- **관련**: `src/content/picker.ts:handleStart`(적용 지점 — `if (!overlay)` 밖), `src/content/overlay.ts:setOverlayTheme`, `src/sidepanel/picker-control.ts:currentTheme`(송신 3곳), `src/sidepanel/lib/resolveDark.ts`. 이 작업 자체가 **2026-08-14 "배치 문서가 다른 배치가 만들 코드를 전제로…"** 항목이 배치 5로 이월한 그 태스크다(전제 6단계 중 앞 5단계를 이번에 만들었다).

---

## 2026-08-14 — shadcn `Button` 이행에서 base cva의 `display` 축만 대조 목록에서 빠졌다

- **영역**: `컴포넌트`, `디자인`
- **계열**: `라이브러리전제`
- **그물**: `시각`
- **증상**: 스타일 편집기에서 `margin`·`padding` 같은 4면 속성을 **묶어서(linked)** 편집할 때만 값 콤보박스 행이 몇 px 높아져, 옆 링크 토글 버튼(`h-9`)과 세로 중심이 어긋났다. 개별 편집(unlinked)으로 풀면 정상이라 재현 조건이 좁다.
- **근본 원인**: raw `<button>`(`flex`)을 shadcn `Button`으로 이행하면서 base cva의 **`inline-flex`** 를 안 덮었다. 설계 문서는 base와의 차이를 `justify-center`·`font-medium`·`gap-2`·`[&_svg]:size-4`·`shadow-sm`·`bg-background`·`hover:*`까지 **하나씩 열거**해 뒀는데 `display` 축만 그 목록에 없었다 — 눈에 띄는 축(색·크기·간격)은 세고 가장 기본적인 축은 안 센 형태다. 대부분의 호출부는 부모가 grid/flex라 인라인 박스가 blockify돼 무해했고, 하필 `MergedSideField`의 래퍼만 블록 컨테이너(`div.min-w-0.flex-1`)라 line-box strut의 디센더만큼 여백이 생겼다.
- **재발 방지**: (1) **프리미티브 교체 시 대조 목록의 첫 줄은 `display`다** — cva base 문자열을 열어 `inline-flex`/`inline-block`/`grid` 여부를 먼저 보고, 교체 대상이 블록 컨테이너 안에 놓일 수 있으면 명시적으로 덮는다. 전수: `grep -rn "variant=\"outline\"" src/sidepanel | ...`로 이행된 트리거를 뽑아 각각의 부모가 flex/grid인지 확인. (2) **이 축은 jsdom으로 원리상 못 잡는다**(레이아웃이 없어 line box가 생기지 않는다). 그래서 className 토큰 대조가 유일한 자동 그물이고, 그 단언은 **뮤테이션으로 이름표를 확정해야** 의미가 있다 — `flex`를 지웠을 때 정확히 그 테스트만 red가 되는 걸 실측했다. 주석만 남기면 다음 사람이 className을 정리하다 무음으로 되돌린다. (3) 같은 이행에서 `[&_svg]:size-4`가 **자손 셀렉터(0,1,1)라 자식의 `h-3.5`(0,1,0)를 이긴다**는 것도 같은 계열이다 — twMerge는 다른 엘리먼트라 중재하지 못한다. 크기를 수용하기로 했으면 **죽은 `h-3.5`를 남기지 말 것**(코드가 14px이라고 거짓말한다).
- **관련**: `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx`(트리거 className — `flex` 오버라이드 + 이유 주석), `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx:MergedSideField`(블록 래퍼)·`LinkToggle`, 그물 `src/sidepanel/tabs/styleEditor/__tests__/ValueCombobox.test.tsx`("트리거가 blockify돼 라인박스 여백을 만들지 않는다"), base `src/components/ui/button.tsx`. 계열 선행: **2026-07-20**(shadcn `Kbd`의 `inline-flex`+`justify-center`가 `truncate`를 무력화 — 같은 프리미티브의 같은 축).

---

## 2026-08-14 — 한 배치의 설계 문서와 태스크 문서가 갈려, 재검증으로 편입한 작업이 태스크에 없었다

- **영역**: `툴체인`
- **계열**: `드리프트`
- **그물**: `없음`
- **증상**: 배치 착수 직전 계획 문서를 읽는데, `design.md`의 "재검증 편입 사항"이 **새 작업으로 편입**했다고 명시한 항목 셋(N-1 로그 텍스트 색 단일 출처 확장 / N-4 다크 판정 세 번째 복제본 제거 / N-5 번들 경계 위반 승격)이 같은 배치의 `tasks.md` 어느 태스크에도 없었다. 태스크 목록만 보고 구현했으면 "⚪ 9건이 정리된다"는 PRD 약속과 실제 결과가 조용히 어긋난 채 배치가 닫혔을 것이다.
- **근본 원인**: 한 배치의 문서가 셋(`prd.md`·`design.md`·`tasks.md`)인데, 재검증이 `design.md` **본문**과 그 문서의 "편입" 절을 갱신하면서 `tasks.md`에는 일부만(N-3 같은 항목만) 반영했다. `design.md` 안에서도 갈렸다 — C-1 소비처 목록은 안 고치고 편입 절에만 "소비처에 추가하라"고 적혀 있었다. 즉 **"결정을 적은 곳"과 "실행 목록"이 다른 파일이고, 갱신이 전자에서 멈춘다**. 2026-08-14의 배치 간 드리프트("다른 배치가 만들 코드를 전제")와 같은 뿌리이고, 이번엔 축이 배치 **안**이다.
- **재발 방지**: (1) **착수 전 `design.md`의 "편입/취소" 절과 `tasks.md`의 태스크 목록을 1:1로 대조한다** — `grep -n "편입\|축소\|취소\|N-[0-9]" docs/features/<slug>/design.md`로 결정 항목을 뽑고, 각각이 tasks.md에 태스크나 명시적 비목표로 존재하는지 센다. 어느 쪽에도 없으면 그게 구멍이다. (2) **결정을 두 파일에 적었으면 갱신도 두 파일에 한다** — 재검증이 design 본문만 고치고 tasks를 안 고치면 실행자는 tasks만 본다. (3) **이 축은 코드로 못 막는다**(문서 대 문서). 사람이 착수 시점에 grep하는 게 유일한 그물이고, 갈린 걸 발견하면 임의로 넓히지 말고 **범위를 사용자에게 확인**한다 — 이번엔 그렇게 배치 6으로 이월했다. (4) 이월 결정은 문서가 아니라 **다음 배치의 태스크**로 남겨야 같은 사고가 반복되지 않는다.
- **관련**: `docs/features/audit-refactor-5/design.md`("2026-08-14 재검증 편입 사항" N-1·N-4·N-5)·`tasks.md`(대응 태스크 부재) — **배치 완료와 함께 삭제**(v1.7.24 `7c5e1cfa`), 안 하고 남긴 판단은 `docs/features/DROPPED.md` 2026-08-16, 이월 대상 `src/sidepanel/components/ActionLogContent.tsx`(로컬 `text-sky-600`·`text-red-700` — `TONE_TEXT`와 값이 갈렸다)·`src/sidepanel/tabs/styleEditor/CssCodeMirror.tsx`(`resolveDark` 세 번째 복제본)·`src/store/editor-store.ts`(`annotation/presets` value import). 계열 선행: **2026-08-14**(배치 간 문서 드리프트 — 같은 형태의 배치 내 판).

---

## 2026-08-14 — 골든 스냅샷이 생산자를 안 거쳐 "게이트를 정반대로 뒤집어도 green"이었고, 설계 문서가 그걸 유일한 검증 근거로 인용하고 있었다

- **영역**: `store`, `lib`
- **계열**: `미검증단언`
- **그물**: `unit`
- **증상**: 재현 환경 `API Hosts` 행의 제출 게이트를 리팩터하는 태스크가 "본문 골든 스냅샷 diff 0"을 회귀 그물로 지정하고 있었다. 실측하니 `bodyOutputGolden.test.ts`의 스냅샷엔 `API Hosts`가 **0회**, `inline:`도 **0회**다 — 게이트를 정반대로 뒤집어도, 인라인 이미지 생성기를 바꿔도 그 골든은 green이다. 같은 배치의 다른 태스크(`inline:` 리터럴 생성기 통합)도 같은 골든을 근거로 삼고 있었다.
- **근본 원인**: 그 골든은 **생산자를 호출하지 않는다.** `buildEditorMarkdownContext()`(제출 ctx 조립 = 게이트가 사는 자리)를 거치지 않고 `ctx` 리터럴을 손으로 조립해 빌더에 직접 먹인다(`vi.mock("@/i18n")`까지 걸려 있다). 그래서 실제로 잠그는 건 "**ctx가 주어진 뒤의** 빌더 출력"이고 ctx를 **만드는** 코드는 사정거리 밖이다. 이름(`bodyOutputGolden` = 본문 출력 골든)이 그 경계를 안 드러내서, 본문에 영향을 주는 변경이면 무엇이든 이 골든이 잡아준다고 읽히는 게 함정이다. 2026-08-12 "그물 세 겹이 전부 있기만 하면 통과"의 재발이고, 이번엔 **설계 문서가 그 공허한 그물을 처방으로 적어 두어** 구현자가 문서를 그대로 따르면 반드시 밟는 형태였다.
- **재발 방지**: (1) **골든·스냅샷을 회귀 그물로 지정하기 전에 스냅샷 본문에 그 문자열이 실제로 있는지 센다** — `grep -c "<대상 문자열>" src/**/__snapshots__/*` 또는 인라인 스냅샷 본문. 0이면 그 골든은 이 축의 그물이 아니다. (2) **테스트가 "생산자를 호출하는가"를 먼저 본다** — 입력을 리터럴로 조립하는 테스트는 그 리터럴을 만드는 코드를 원리상 검증하지 못한다. 전수: `grep -rln "const ctx" src/sidepanel/lib/__tests__/`처럼 입력을 손으로 짓는 테스트를 뽑고, 각각 "이 테스트가 지키는 건 생산자인가 소비자인가"를 한 줄로 답한다. (3) **설계 문서(`docs/features/*/tasks.md`)의 "검증" 칸도 미검증 단언이다** — 2026-07-31이 "대안 기각 사유"에, 2026-07-18이 "위험표의 완화 칸"에 낸 처방을 **검증 칸까지** 확장한다. 착수 시 각 검증 항목이 red를 만들 수 있는지(mutation) 확인하고, 못 만들면 그 항목을 문서에서 정정한다. (4) 이번 대체 그물: `buildEditorCapture.test.ts`에 환경 행 케이스를 신설했다(기존 케이스는 전부 `environment: []`라 커버리지가 0이었다) + `inline-ref.test.ts`의 생성↔파싱 왕복.
- **관련**: 공허한 그물 `src/sidepanel/lib/__tests__/bodyOutputGolden.test.ts`(ctx 리터럴 직접 조립 + `vi.mock("@/i18n")`), 실제 생산자 `src/sidepanel/lib/buildEditorCapture.ts:buildEditorMarkdownContext`, 대체 그물 `src/sidepanel/lib/__tests__/buildEditorCapture.test.ts`("environment API Hosts 게이트")·`src/lib/__tests__/inline-ref.test.ts`, 잘못된 처방 원문은 `docs/features/audit-refactor-4/tasks.md`(Task 2·12)였고 배치 완료와 함께 삭제됐다 — 그 문서를 만든 배치는 v1.7.24 커밋 `64eea020`, 선행 회고 `2026-08-12`·`2026-07-31`.

---

## 2026-08-14 — 배치 문서가 "다른 배치가 만들 코드"를 전제로 태스크를 적어, 구현 착수 시점에야 실행 불가로 드러났다

- **영역**: `content`, `툴체인`
- **계열**: `미검증단언`, `드리프트`
- **그물**: `없음`
- **증상**: 감사 후속 배치 4의 한 태스크가 "`picker.start`가 실어온 theme을 모듈 로컬에 보관하고 `createOverlay()` 직후 적용해 세 경로를 한 번에 덮는다"를 지시했는데, 착수해 보니 `picker.start` 메시지 타입에 `theme` 필드가 **없고**, `resolveDark.ts`도 **없고**, overlay CSS에 `data-theme` 적용이 **0줄**이었다. 보관할 값 자체가 존재하지 않아 태스크를 실행할 수 없었다. 그 전제를 만드는 작업은 **아직 착수도 안 된 배치 5**의 태스크였다.
- **근본 원인**: 두 배치가 `picker.ts`의 같은 블록을 고치는 걸 발견하고 "충돌을 막으려" 배치 5의 항목을 배치 4로 **합쳐 적었는데**, 합쳐진 항목의 **전제(메시지 필드·헬퍼 모듈·CSS)는 배치 5에 남겨둔 채**였다. 문서상으로는 "배치 5 D-1은 이 태스크를 참조만 한다"로 정리돼 한 곳에서 읽히지만, 실행 순서로 보면 후행 배치의 산출물에 선행 배치가 의존하는 역전이다. 배치 문서가 서로를 인용할 때 **"무엇을 고치나"만 옮기고 "그게 성립하려면 무엇이 먼저 있어야 하나"를 안 옮긴** 형태다. 같은 배치의 인용 줄번호가 v1.7.21~23을 거치며 전부 밀린 것도 같은 뿌리(문서가 코드의 현재 상태를 실측 없이 전제)이고, 이번 재검증에서 이미 한 번 정정된 이력이 있다.
- **재발 방지**: (1) **배치 간 태스크를 합칠 때는 "이 태스크가 읽는 값·부르는 함수·import하는 모듈"을 나열하고 각각이 *지금 코드에* 있는지 grep으로 확인한다** — 없으면 합치는 방향이 반대다(전제를 가진 배치로 옮겨야 한다). 전수: `grep -rn "편입\|D-[0-9]\|배치 [0-9]" docs/features/*/tasks.md`로 교차 참조 태스크를 뽑고 각각의 전제를 대조. (2) **설계 문서가 인용하는 심볼은 착수 전 존재 확인이 기본이다** — 줄번호는 밀려도 읽으면 되지만 심볼 부재는 태스크를 통째로 못 하게 만든다. 그 배치가 **만드는 것**과 **이미 있는 것**을 문서에서 분리해 적는다. (3) **이 축은 코드로 막을 수 없다** — 문서 대 문서의 순서 의존이라 테스트·타입이 관여하지 않는다. 착수 시 tasks.md의 인용 심볼을 grep하는 것이 유일한 그물이고, 이번엔 그 grep이 착수 직후에 잡아 중단 없이 스코프 분리로 처리했다. (4) 분리 결정은 문서에 남긴다 — 무엇을 왜 이월했는지, 이월받는 배치가 지킬 것(`createOverlay()` 3경로를 모듈 로컬로 한 번에 덮기)까지.
- **관련**: 이월 사유·후속 지시는 **`docs/features/audit-refactor-5/tasks.md` Task 5**로 옮겨 두었다 — **그 문서도 배치 완료와 함께 삭제됐다**(2026-08-16). 즉 이 회고의 요지가 이 줄에서 두 번 실증된 셈이다: 배치 문서는 수명이 짧아 교차 참조가 남으면 끊긴다. 이월분은 Task 5로 실행됐고(`picker.start`의 `theme` 필드가 그 산출물), 안 하고 남긴 판단은 `docs/features/DROPPED.md` 2026-08-16. 전제 6단계 중 앞 5단계가 그 배치 소관, 대상 코드 `src/content/picker.ts:handleSelectByPath`·`handleStart`·`handleStartAreaSelect`(`createOverlay()` 3경로), 부재 확인한 심볼 `src/types/picker.ts`의 `picker.start`.

---

## 2026-08-13 — 분석 축 하나를 훅으로 "구독"했더니, 미리보기를 여는 것만으로 Jira 요청이 나가고 무관한 사용자에게 재로그인 안내가 떴다

- **영역**: `컴포넌트`
- **계열**: `라이브러리전제`
- **그물**: `jsdom`
- **증상**: Jira를 연동해 둔 사용자가 **이슈 미리보기를 열기만 해도** `GET /rest/api/3/issue/createmeta/…`가 나간다. 제출 다이얼로그를 연 적이 없어도, GitHub·Slack으로만 제출하는 사용자여도 마찬가지다. 토큰이 만료된 상태면 그 401이 전역 **"Jira 인증이 만료되었습니다"** 모달까지 띄운다 — 사용자는 Jira를 건드린 적이 없는데 재로그인을 요구받는다.
- **근본 원인**: 제출 시점에 **한 번 읽으면 되는 값**(`sprint_field_shown` 분석 축)에 조회 훅을 붙였다. 훅은 값을 읽는 게 아니라 **구독**하므로, 그 부수효과(네트워크 요청)가 컴포넌트 렌더 수명 전체로 퍼진다. 그 위에 두 전제가 겹쳐 폭이 커졌다 — ① `SubmitFieldsDialog`는 `<Dialog open={open}>` 형태라 **닫혀 있어도 함수 본문(=훅)이 매 렌더 실행**되고, 부모 `IssueCreateModal`은 미리보기 패널에서 **상시 마운트**다 ② 훅에 플랫폼 게이트가 없어 `platform !== "jira"`에서도 돌았다. 결정타는 실패 경로다: `jira.*` 읽기 메시지의 401은 `serializeOAuthError`가 `oauthRefreshFailed`를 실어 `sendBg`가 **reject 이전에 `onOAuthExpired`를 전역 발화**시키므로, 훅의 `.catch(() => {})`로는 막을 수 없다. 즉 "값 하나 읽기"가 조용한 요청 하나가 아니라 **다른 플랫폼 사용자에게 뜨는 모달**로 끝났다.
- **재발 방지**: (1) **제출·전송 시점에 한 번 필요한 값은 훅으로 구독하지 말고 동기 조회 함수로 읽는다** — 캐시가 이미 있으면 `peek*` 형태로 노출한다(`peekSprintFieldMeta`). 판별 질문은 "이 값이 렌더에 영향을 주나?"이고, 답이 아니오면 훅이 아니다. `grep -rn "use[A-Z].*(" src/sidepanel/tabs/SubmitFieldsDialog.tsx`로 제출 다이얼로그가 구독하는 훅을 전수하고, 각각 **닫힌 상태에서도 요청을 내는지** 확인한다. (2) **`open` prop을 받는 다이얼로그 컴포넌트는 닫혀 있어도 본문이 돈다** — 마운트 여부와 열림 여부를 혼동하지 말 것. `grep -rn "open={.*}" src/sidepanel/tabs/*.tsx | grep -i dialog`로 상시 마운트 다이얼로그를 훑는다. (3) **플랫폼 전용 조회에는 플랫폼 게이트를 붙인다** — 8개 어댑터 중 하나의 요청이 나머지 7개 사용자에게 새면 증상이 그 플랫폼과 무관한 자리에서 나타난다. (4) 그물: `useSprintFieldMeta.test.tsx`의 "peek은 캐시만 읽고 요청하지 않는다". 다만 **"컴포넌트가 훅을 구독한다"는 훅 테스트로는 못 잡는다** — `SubmitFieldsDialog` 렌더 테스트가 없어서 4관점 자체 검증(4명 전원 🔴)이 유일한 발견 경로였다. 같은 계열 401→전역 안내 오발화는 아래 e2e 회고와 같은 뿌리다.
- **관련**: `src/sidepanel/tabs/SubmitFieldsDialog.tsx`(`handleSubmit`의 `sprintFieldShown`), `src/sidepanel/tabs/jiraFields/useSprintFieldMeta.ts`(`peekSprintFieldMeta` — 캐시 키 조립을 훅과 공유), `src/lib/bg-client.ts:sendBg`(2026-08-15에 `src/types/messages.ts`에서 이동)(`isOAuthRefreshFailed` → `onOAuthExpired.fire`), 그물 `src/sidepanel/tabs/jiraFields/__tests__/useSprintFieldMeta.test.tsx`.

---

## 2026-08-13 — 가짜 토큰을 seed한 e2e에서 스파이가 앱 부팅보다 늦어, 401이 띄운 전역 모달이 이후 모든 클릭을 삼켰다

- **영역**: `e2e`
- **계열**: `라이브러리전제`
- **그물**: `e2e`
- **증상**: 새 spec의 **두 번째 케이스부터** 60초 타임아웃. 실패 지점이 `enterDebug` → `mode-freeform` → `to-preview`로 실행할 때마다 옮겨 다녀 클릭 대상 쪽을 아무리 봐도 원인이 안 보였다. 첫 케이스만 green이라 "패널을 여러 개 열어서 그런가" 쪽으로 세 번 헛다리를 짚었다(탭 분리·`bringToFront`·앞 케이스 탭 닫기 — 전부 증상을 옮기기만 했다).
- **근본 원인**: 진짜 원인은 클릭이 아니라 **오버레이**였다. 앞 케이스가 이슈를 하나 남기면 다음 패널이 부팅될 때 이슈 목록의 상태 뱃지가 즉시 `jira.getIssueStatus`를 쏘는데, `openPanel`(goto) **뒤에** `page.evaluate`로 심은 스파이는 그때 아직 없다. 그래서 그 요청만 진짜 background로 나가 seed한 가짜 토큰이 401을 받고 → `onOAuthExpired` → 전역 "인증이 만료되었습니다" 다이얼로그 → 그 `fixed inset-0 z-50` 오버레이가 이후 **모든** 클릭을 `intercepts pointer events`로 가로챘다. 첫 케이스가 green이었던 건 그때는 남은 이슈가 없어 뱃지 조회 자체가 없었기 때문이다. `page.evaluate`가 "페이지가 로드된 뒤"에 도는 건 자명한데, **앱 부팅 시 자동으로 나가는 요청**이 있다는 걸 전제에서 빠뜨렸다.
- **재발 방지**: (1) **가짜 자격증명을 storage seed하는 spec은 스파이를 `addInitScript` + `reload`로 심는다** — `page.evaluate`는 부팅 시 자동 발사되는 요청(상태 뱃지·목록 새로고침)을 놓치고, 그 하나가 401이면 전역 모달이 뜬다. `grep -rn "openPanel" e2e/*.spec.ts | xargs -I{} grep -l "evaluate.*sendMessage" ` 류로 seed+evaluate 조합을 전수하고, 각 spec이 `*.getIssueStatus`·목록 조회까지 fake 목록에 넣었는지 확인한다. (2) **"클릭이 타임아웃"의 원인을 클릭 대상에서 찾지 마라** — actionability 로그의 `intercepts pointer events` 줄이 범인을 이미 말하고 있다. 진단은 `document.querySelectorAll("body > *")`를 덤프해 **열린 레이어의 텍스트를 읽는 것**이 가장 빠르다. `[role=dialog]` 조회는 **시점이 어긋나면 빈 배열**이 나와(레이어가 나중에 열린다) 두 번 오판하게 만들었다. (3) 곁들여 밟은 것: 케이스마다 탭을 가르면 뒤에 연 패널이 **배경 탭이라 rAF가 throttle**돼 Playwright 안정성 검사(연속 두 프레임 bbox 일치)가 끝나지 않는다 — `openPanel` 직후 `bringToFront()`(`pickElement`가 같은 이유로 이미 그렇게 한다). (4) 상세는 `e2e/GOTCHAS.md`에 두 항목으로 박았다.
- **관련**: `e2e/jira-sprint-field.spec.ts`(`spySendMessage`가 `addInitScript`, `openOn`의 `bringToFront`), `e2e/GOTCHAS.md`, `src/lib/bg-client.ts:sendBg`(2026-08-15에 `src/types/messages.ts`에서 이동)(401→`onOAuthExpired` 레인 — 위 회고와 같은 뿌리).


## 2026-08-13 — 로딩 고착을 고치려 effect deps에서 뺀 값이, 같은 가드를 stale closure로 만들어 재조회를 없앴다 (한 줄 수정이 증상만 옮김)

- **영역**: `컴포넌트`
- **계열**: `라이브러리전제`
- **그물**: `jsdom`
- **증상**: Jira 제출 다이얼로그에서 프로젝트를 바꾸면 이슈타입 콤보가 자동으로 열리는데, 목록이 비고 "일치하는 이슈 타입이 없습니다"가 뜬 채 멈춘다. 이슈타입이 필수라 제출 버튼은 잠긴 채다. 콤보를 손으로 닫았다 다시 열면 복구된다. 발동 조건은 "전환 전에 이슈타입 콤보를 한 번이라도 연 적 있음"이라, 두 번째 전환부터는 항상 걸린다. **`pnpm test` 5431개가 전부 green인 상태로 커밋 직전까지 갔다.**
- **근본 원인**: 한 가드가 **두 실패 모드 사이를 오간다.** `IssueTypeField`의 조회 effect는 `if (items.length > 0) return`으로 재조회를 막는데, `items.length`가 deps에 있으면 `setItems(list)` → 리렌더 → cleanup(`cancelled = true`) → effect 재실행이 `.finally`보다 **먼저** 끼어 `setLoading(false)`가 영영 안 불린다(로딩 고착 — jsdom/act에서 상시 재현). 그래서 deps에서 뺐더니, 이번엔 `projectKey` 변경 커밋에서 reset effect의 `setItems([])`가 **예약만 된** 시점의 옛 `items`(length>0)를 조회 effect가 읽고 조기 반환한다. 다음 렌더에서 `items`가 비어도 deps 세 개가 그대로라 재실행이 없다. **`items`는 비동기 응답으로 갱신되는 값이라 캐시 키로 쓸 수 없다** — deps에 넣으면 취소 레이스, 빼면 stale closure. 진짜 캐시 키는 "어느 프로젝트로 받은 목록인가"이지 "목록이 비었나"가 아니었다.
  - 그 위에 **취소된 fetch가 상태를 정리하지 못하는** 3단계가 하나 더 있었다. `loadedFor` ref로 옮긴 뒤에도, A→B 전환 후 B 응답 전에 B→A로 되돌아오면 B의 `.then`·`.finally`가 `cancelled` 가드로 둘 다 no-op이라 `loadedFor`는 "A"로 남고 `loading`은 true로 굳는다 → 재실행된 effect가 `loadedFor === "A"`로 조기 반환해 **영구 로딩**. CTO 게이트가 잡았고, reset effect에서 `loadedFor`를 함께 비워야 닫힌다.
- **재발 방지**: (1) **비동기로 채워지는 state를 "이미 받았나" 판정에 쓰지 마라** — deps에 넣으면 취소 레이스, 빼면 stale closure로 양쪽 다 깨진다. 판정 키는 **요청을 규정한 입력**(여기선 `projectKey`)이어야 하고, 그건 ref/state로 따로 들되 **입력이 바뀔 때 함께 비운다**. `grep -rn "items.length > 0) return\|\.length > 0) return" src/sidepanel`로 같은 형태를 전수. (2) **cleanup의 `cancelled` 가드는 `.then`뿐 아니라 `.finally`·캐시 키 갱신까지 막는다** — 취소된 요청이 남긴 `loading: true`와 stale 캐시 키를 **다음 요청이 덮는다는 보장이 없다**. 취소 가능한 fetch에 캐시 키를 붙이면 "입력 변경 → 키 무효화"를 cleanup이 아니라 **입력 effect**에 둔다. (3) **증상이 바뀌면 고쳐진 게 아니다** — 로딩 고착이 "빈 목록"으로 바뀐 걸 green 스위트가 승인했다. 한 줄로 deps를 건드릴 때 그 값이 가드에도 쓰이면 두 실패 모드를 모두 재현 테스트로 박는다. (4) 그물: `IssueTypeField.test.tsx`의 `SwitchHarness` 2케이스(전환 후 재조회 / A→B→A 취소 응답이 로딩을 안 붙듦). 둘 다 **뮤테이션으로 red 확인**하고 넣었다 — 순수 함수로는 원리적으로 못 잡는 부류다.
- **관련**: `src/sidepanel/tabs/jiraFields/IssueTypeField.tsx`(`loadedFor` ref + reset effect의 무효화), 그물 `src/sidepanel/tabs/jiraFields/__tests__/IssueTypeField.test.tsx`("프로젝트 전환" describe). 계열 선행: **2026-07-14**(같은 `jiraFields/` 콤보에서 두 값의 **수명**이 어긋난 건 — 그때는 uncontrolled 입력 vs 살아남는 state, 이번엔 비동기 state vs effect 클로저).

---

## 2026-08-13 — 콤보를 닫으며 다음 콤보를 열었더니, Radix 포커스 복원이 갓 열린 레이어를 즉시 dismiss했다

- **영역**: `컴포넌트`
- **계열**: `라이브러리전제`
- **그물**: `jsdom`
- **증상**: Jira 제출 다이얼로그에서 프로젝트를 바꾸면 이슈타입 콤보가 자동으로 열려야 하는데(제출 버튼이 즉시 잠기는 것에 대한 **유일한 단서**로 설계됨) 열리자마자 닫힌다. `aria-expanded`는 `false`인데 `jira.listIssueTypes` 요청은 나가 있다 — 한 프레임 열렸다 닫힌다는 뜻. 화면상으로는 "아무 일도 안 일어났는데 제출 버튼만 잠긴" 상태가 된다.
- **근본 원인**: 프로젝트 항목 선택 → `onChange`로 부모가 `setIssueTypeOpen(true)` → 같은 흐름에서 프로젝트 팝오버가 닫힌다. Radix `PopoverContent`는 닫히면서 `onCloseAutoFocus`로 **트리거에 포커스를 되돌리는데**, 그 포커스 이동이 이미 열린 이슈타입 레이어의 바깥 포커스로 판정돼 dismiss된다. **타이밍 문제가 아니다** — `setTimeout(…, 0)`으로 미뤄도 그대로 닫히고 120ms를 줘야 열린다(실측). 즉 "한 틱 미루기"류 완화는 우연히 통과할 뿐 원인을 안 건드린다.
- **재발 방지**: (1) **레이어를 닫으며 다른 레이어를 여는 흐름은 `onCloseAutoFocus`에서 `event.preventDefault()` + 열기**로 연결한다 — 포커스 복원 자체를 막아야 dismiss 트리거가 사라진다. 여는 시점을 지연시키는 방식은 재현 환경에 따라 통과·실패가 갈린다. `grep -rn "onOpenChange" src/sidepanel/tabs/*Fields src/sidepanel/components`로 연쇄 오픈이 있는 곳을 전수. (2) **"열렸다"를 요청 발생으로 확인하지 마라** — fetch가 나간 것은 `open`이 한 프레임 true였다는 뜻일 뿐이다. 단언은 `aria-expanded`나 실제 렌더된 `option`으로 한다. (3) 그물: `JiraIssueFields.test.tsx`("프로젝트를 바꾸면 이슈타입 콤보가 열린 채로 새 프로젝트의 목록을 보여준다") — 뮤테이션으로 red 확인. jsdom에서 재현되는 이유가 Radix 포커스 복원이라 실브라우저에서도 같은 원인이고, e2e가 붙으면 이중으로 덮인다.
- **관련**: `src/sidepanel/tabs/jiraFields/JiraIssueFields.tsx`(`pendingIssueTypeOpen` ref + `handleProjectClosed`), `src/sidepanel/tabs/jiraFields/FieldCombobox.tsx`(`onCloseAutoFocus` 패스스루), `src/sidepanel/tabs/jiraFields/ProjectField.tsx`. 설계 근거: `docs/features/jira-project-switch/design.md` §6·§12(자동 오픈이 유일한 단서인 이유 — i18n 신규 키 0 제약으로 보조 문구를 못 넣었다).

---

## 2026-08-12 — 누출을 막겠다고 깐 그물 세 겹이 전부 "있기만 하면 통과"였다: 공허한 실증·공존 판정·없는 realm

- **영역**: `i18n`, `background`, `툴체인`
- **계열**: `미검증단언`, `복제본`, `fail-open`
- **그물**: `unit`
- **증상**: (사전 차단 — 같은 라운드의 `/code-review`가 잡음) 이슈 본문 언어(`bodyLocale`)는 전역 로케일을 동기 스왑하는 설계라 **누출**이 유일한 실패 모드다. 그래서 그물을 겹겹이 깔았고 5300여 개가 green이었는데, 실제로는 **막겠다고 선언한 형태 넷이 전부 통과**하고 있었다: 래퍼 밖 `t()`, 이미 감싼 파일에 추가된 2번째 진입점, 하위 디렉터리의 새 빌더, `export default` 진입점. background realm은 아예 등가 그물이 없었고, 거기로 오염된 `bodyLocale`이 오면 `t()`가 TypeError로 죽는데 **Jira는 `submitIssue`의 `try/catch`가 그 throw를 `console.warn`으로 삼켜서 `IMAGE_PLACEHOLDER` 센티널이 남은 본문을 그대로 등록**한다(무음 손상 — Notion은 같은 값에 시끄럽게 실패해 두 경로의 귀결이 갈렸다).
- **근본 원인**: 세 겹이 **각자 다른 방식으로 "존재"를 "충족"으로 착각**했다. ① 래핑 게이트는 `t(`와 `withLocale(`이 한 파일에 **같이 있기만 하면** 통과했다 — `const h = t(…); return withLocale(l, () => inner(h))`는 두 토큰이 다 있으므로 green인데 `h`만 화면 언어로 굳는다. 대상 집합도 `build*.ts` 파일명 규칙 + `readdirSync` 비재귀 + `t` 직접 import라, 세 축 어디로든 벗어나면 검사 자체가 안 돈다. ② "빌더는 store에 write하지 않는다"는 불변식의 **비공허성 실증 케이스가 그 자체로 공허**했다 — 같은 로케일 값을 write했는데 실제 구독자(`TiptapEditor.tsx:221`·`:383`)엔 `if (s.locale === prev.locale) return` 가드가 있어 **아무 일도 안 일어나는 걸 "안 덮였다"로 읽었다**. ③ background는 `currentLocale`이 별도 인스턴스라 사이드패널 게이트가 원리적으로 안 닿는데, 그 사실을 문서에만 적고 그물은 안 깔았다. 공통 뿌리는 **"그물이 있다"를 "그 그물이 이 형태를 잡는다"로 승격시킨 것**이고, 아무도 자기가 막겠다던 형태를 실제로 주입해 red를 본 적이 없다. 2026-07-26·2026-08-11이 남긴 "앵커는 0건이 아님만 증명한다"의 다음 단계 — **앵커가 있어도 판정식이 느슨하면 앵커는 느슨한 판정이 돌았다는 것만 증명한다.**
- **재발 방지**: (1) **소스 스캔 그물을 쓸 땐 판정식이 "공존"인지 "포함"인지 먼저 묻는다.** 두 토큰이 한 스코프에 있다는 건 순서·중첩을 아무것도 말해주지 않는다 — 래퍼 안이어야 한다면 래퍼 호출을 괄호 매칭으로 **도려낸 나머지**에서 찾아야 판정이 의미를 얻는다(`src/test/withLocaleScan.ts:stripWithLocaleCalls`). (2) **대상 집합은 세 축을 각각 확인한다 — 파일명 규칙 / 디렉터리 재귀 / import 형태.** 셋 중 하나만 어긋나도 스캔이 통째로 비켜간다. 이번엔 셋 다 어긋나 있었다. 새 그물은 "분류되지 않은 파일이 있으면 red"(화이트리스트 + 면제 목록)로 짜서 **새 파일이 어느 쪽에도 없을 때 실패**하게 만든다 — 열거는 다음 파일에서 구멍이 난다. (3) **"이 단언이 공허하지 않음을 실증한다"는 케이스는 시작 상태를 기대값과 다르게 심는다.** 같은 값을 넣고 같은 값을 확인하면 그 경로가 아예 안 돌아도 통과한다. 실증하려는 메커니즘에 가드가 있는지(`if (a === b) return`) 실제 소스를 열어 확인할 것. (4) **realm이 갈리면 그물도 갈린다.** `grep -rn "getLocale\|currentLocale" src/background/`처럼 전역 상태를 realm별로 따로 세고, 사이드패널 게이트가 안 닿는 구간엔 등가물을 깐다(여기선 본문 네임스페이스 키 화이트리스트). 접두사만 보면 안 된다 — `notion.attachmentSection`은 **플랫폼 접두 키**라 `asana.attachmentSection` 복제가 그대로 샌다(접미로도 잡을 것). (5) **realm 경계는 정규화 지점이다.** 내부에서 "trusted by construction"이 옳아도 `chrome.runtime` 메시지는 `type`만 검증되므로 진입에서 `resolveBodyLocale`로 흡수한다. 그리고 **에러를 삼키는 `try/catch` 안에서 문자열을 만들면 실패가 무음 손상이 된다** — `grep -rn "console.warn" src/background/messages.ts`로 삼키는 블록을 뽑아 그 안에서 나가는 본문이 있는지 본다. (6) **새로 깐 그물은 막겠다던 형태를 실제로 주입해 red를 실측한다.** 이번 라운드는 10종을 주입해 10건 red를 확인했고, 그 절차가 없었으면 "게이트도 있고 앵커도 있으니 됐다"로 끝났을 것이다.
- **관련**: 공용 스캐너 `src/test/withLocaleScan.ts`(`exportedSegments`·`stripWithLocaleCalls` — 게이트 두 벌이 공유해야 한쪽만 강화되는 드리프트가 안 생긴다), 게이트 `src/sidepanel/lib/__tests__/builderLocaleWrap.test.ts`(대상 집합 완전성 + 함수 단위 + 래퍼 안팎)·`src/background/__tests__/bodyLocaleBackground.test.ts`(본문 키 화이트리스트 + 래퍼 안팎), 불변식 `src/sidepanel/lib/__tests__/bodyLocaleIntegration.test.ts`(실증 케이스), 정규화 `src/background/messages.ts:buildJiraDescriptionContent`·`notion-api.ts:expandPageBlocks`(`resolveBodyLocale`), 삼키는 블록 `src/background/messages.ts:submitIssue`, 구독자 `src/sidepanel/components/TiptapEditor.tsx:221`·`:383`. 계열 선행: **2026-07-26**(자기검증 앵커의 출처 — 앵커는 0건 아님만 증명) · **2026-08-11**(`manifest-locales` — 앵커가 통과해도 소비자를 빠뜨리면 같은 구멍 / 기대값이 기본값과 같으면 단독으로 아무것도 증명 못 함) · **2026-08-06**(골든이 오답을 계약으로 봉인 — 여기선 골든 62장이 `@/i18n` 통째 모킹으로 이 축에 눈이 멀어 있는 게 같은 구조).

## 2026-08-12 — 설계가 처방한 "대칭 수정"이 대칭이 아니었고, 그대로 넣었으면 없던 회귀를 만들었다

- **영역**: `content`
- **계열**: `미검증단언`
- **그물**: `e2e`
- **증상**: 액션 로그 네비게이션 유형 기능의 설계 문서가 곁다리로 `clear` 핸들러에 `entryNavEmitted = false`를 넣으라고 처방했다("grace 만료 경로와 동일한 대칭"). 그대로 구현해 유닛 5231개가 전부 green이었는데, 검증 에이전트가 **녹화 중 탭 전환 후 복귀하면 일어나지도 않은 새로고침 항목이 녹화 중간 시각으로 찍힌다**는 걸 잡았다. 하류 `mergeLogItems`는 id로만 dedup해 흡수 장치가 없어 이슈 본문·JSON·AI 요약까지 그대로 나간다.
- **근본 원인**: 처방의 근거인 "대칭"이 **성립하지 않는 전제**였다. grace 만료 경로는 `if (armedOnce) return;` 가드를 달고 **arm 이전에만** 돌고, `clear` 리스너는 `setSentinel` **안에서만** 등록되며 같은 함수가 `armedOnce = true`를 세운다 — 즉 clear 핸들러가 도는 시점엔 `armedOnce`가 **항상 true**라 두 경로는 배타적 구간에서 돈다. 그래서 grace의 가드를 그대로 옮기면 죽은 코드가 되고, 가드 없이 리셋만 옮기면 회귀가 된다. 더 근본은 **`clear` 발신자가 둘인데 의미가 반대**라는 걸 아무도 안 센 것이다 — `logClear`(네비게이션 경계, 패널 로그도 비움 → 보충해야 함)와 `video-capture.prepareRecorders`(세션 준비, 같은 문서 유지 → 보충하면 안 됨). MAIN world는 "패널 로그도 비워졌는가"를 **원리적으로 알 수 없어서**, 수신자에서 판정하려는 시도는 어떤 형태든 틀린다. 손익도 뒤집혀 있었다 — 막으려던 유실은 이 기능 이전부터 있던 조건이고(같은 race에서 `load` 항목을 잃었다), 유령 항목은 새로 생기는 회귀다.
- **재발 방지**: (1) **설계가 "X와 동일한 대칭"이라고 쓰면 두 경로의 가드와 실행 구간을 실제로 대조한다** — 리셋문만 복사하고 그 앞의 조건을 빼면 대칭이 아니라 다른 코드다. `grep -n "armedOnce\|entryNavEmitted" src/content/action-recorder.ts`로 래치를 건드리는 지점을 전수한다. (2) **수신자가 판정할 수 없는 건 발신자가 의도를 실어 보낸다** — `PickerMessage`의 `actionRecorder.clear`가 `resupplyEntryNav`를 싣고, **필드 부재 = 안 함**이 fail-safe 방향이다(새 발신자가 잊으면 회귀가 아니라 기존 동작으로 떨어진다). 발신자를 늘릴 때 `grep -rn "clearActionRecorder" src`로 의미를 다시 가른다. (3) **설계 문서의 실패한 처방을 지우지 말고 왜 틀렸는지와 함께 남긴다** — 지우면 다음 사람이 같은 처방을 다시 제안한다(design.md "1차 처방이 왜 틀렸나"). (4) **부수적으로 딸려온 처방("겸사겸사 이것도 고치자")은 본 기능과 손익을 따로 센다** — 이 항목은 기능의 요구가 아니라 리뷰가 발견한 별건이었고, 선재 조건을 못 고치는 것보다 새 거짓말을 만드는 게 나쁘다.
- **관련**: `src/content/action-recorder.ts`(`clear` 핸들러 — `detail.resupplyEntryNav`일 때만 래치 리셋), 발신자 `src/store/editor-store.ts:clearActionLog`(켬)·`src/sidepanel/video-capture.ts:prepareRecorders`(안 켬), 계약 `src/types/picker.ts`·`src/sidepanel/recorder-control.ts`·`src/content/recorder-bridge.ts:handleActionClear`, 그물 `e2e/action-log-nav-type.spec.ts` E7(유닛으로는 안 잡힌다 — 뮤테이션으로 확인) + U6(발신자 의도).

---

## 2026-08-12 — popstate를 "히스토리 이동 신호"로 전제해, 링크 클릭이 "앞으로가기"로 기록됐다

- **영역**: `content`
- **계열**: `미검증단언`, `라이브러리전제`
- **그물**: `e2e`
- **증상**: `<a href="#x">` 클릭 한 번에 액션 로그가 `Clicked hash x` 바로 뒤에 **`Went forward to …#x`** 를 찍었다. 사용자는 앞으로가기를 누른 적이 없다. 유닛 5245개·타입체크 전부 green이었고, e2e를 쓰면서 행을 덤프해 보고서야 드러났다.
- **근본 원인**: 설계가 "같은 문서 traverse는 `popstate` 시점의 히스토리 인덱스 델타로 방향까지 판정"으로 잡았고, 그 전제는 **popstate가 히스토리 이동에서만 발화한다**는 것이었다. 실제로는 HTML 스펙상 **같은 문서 프래그먼트 네비게이션도 popstate를 쏘고** 인덱스를 +1 한다. 그래서 부호만 보면 링크 클릭이 forward가 된다 — 이 기능이 가른다고 선언한 축(히스토리 조작 여부)과 **정반대**이고, 정보가 없는 게 아니라 **틀린 정보**라 폴백(`"popstate"`)보다 나쁘다. 설계가 대안 검토에서 `navigate` 이벤트를 기각하며 popstate 경로를 "이미 존재하는 리스너에 몇 줄"이라고 평가할 때도 이 전제는 재확인되지 않았다. 인접한 함정 하나를 더 깔고 있었다 — 같은 문서의 `<a href="#x">`가 popstate 없이 인덱스를 올린다고 적힌 부분(미러 변수 금지 처방)은 **맞는 방향의 처방이지만 이유가 틀렸다**(popstate는 발화한다). 처방이 우연히 옳아 그 오해가 e2e까지 살아남았다.
- **재발 방지**: (1) **브라우저 이벤트의 발화 조건을 "내가 아는 용도"로 전제하지 않는다** — 이벤트 이름이 용도를 좁혀 읽히게 만든다(popstate = pop = 이동). 판정에 쓰기 전에 **의도한 트리거 외의 경로로도 발화하는지** 실제 페이지에서 한 번 찍어 본다. (2) **방향·부호처럼 값이 뒤집히는 판정은 "판정 불가"보다 "틀린 값"이 훨씬 비싸다** — 게이트를 하나 더 요구한다. 여기선 도착 `NavigationHistoryEntry.id`를 전에 본 적 있어야 이동으로 인정하고(밀어 넣어진 엔트리는 새 id), 모르면 기존 값으로 접는다. (3) **레코더 본문처럼 유닛이 못 닿는 곳은 e2e에서 단언을 쓰기 전에 행을 통째로 덤프해 눈으로 읽는다** — 기대한 항목의 존재만 단언하면 **옆에 생긴 틀린 항목은 영원히 안 보인다**(E1·E2·E6이 전부 green인 채로 이 버그가 살아 있었다). (4) 그물이 실제로 무는지는 **뮤테이션으로 확인한다** — 판정을 인덱스 델타만으로 되돌려 E5가 red가 되는 걸 봤다.
- **관련**: `src/content/action-recorder-helpers.ts:popstateNavType`(id 게이트 + 폴백), `src/content/action-recorder.ts`(`seenEntryIds` 적재 지점 — `recordNavigation` 진입마다), `src/content/recorder-globals.ts`(`NavigationLike.currentEntry.id`), 그물 `e2e/action-log-nav-type.spec.ts` E5(`forward` 0건 단언) + 유닛 `popstateNavType`.

---

## 2026-08-12 — 페이지가 조작 가능한 값을 객체 리터럴 키로 쓰면 `Object.prototype`이 렌더를 죽인다

- **영역**: `컴포넌트`, `lib`
- **계열**: `라이브러리전제`
- **그물**: `jsdom`
- **증상**: (사전 차단 — 같은 라운드의 `/code-review`가 잡음) 액션 로그 항목의 `navType`으로 아이콘을 고르는 룩업 `NAV_ICON[navType]`이 객체 리터럴이라, `navType: "constructor"`면 truthy 함수가 잡히고 React가 그걸 컴포넌트로 호출해 *"Objects are not valid as a React child"* 로 throw했다. 저장소에 ErrorBoundary가 0건이라 **패널 트리 전체가 내려간다**. 같은 `KindIcon`을 로그뷰어가 쓰므로 이슈에 첨부된 `logs.html`을 여는 팀원 쪽도 백지가 된다. 짝으로 `buildLogSummary`의 `NAV_VERB_EN[...] ?? "…"`은 `??`가 undefined만 걸러서 함수 소스가 LLM 프롬프트에 보간됐다.
- **근본 원인**: `navType`이 **페이지가 통제하는 값**이라는 걸 렌더 시점에 잊었다. sentinel은 비밀이 아니고(ARCHITECTURE "등록 핸드셰이크"가 인정), 위조 `__bugshot_action_data__`로 임의 엔트리를 밀어 넣을 수 있으며, 브리지·`mergeLogItems` 어디도 엔트리 필드를 검증하지 않는다. 기존 선례(`CONSOLE_LEVEL_TONE[level]`)도 같은 형태지만 결과가 className **문자열**이라 프로토타입 값이 무해하게 흡수됐다 — 이번에 처음으로 룩업 결과가 **컴포넌트 타입**으로 쓰이면서 같은 패턴의 위험 등급이 바뀌었다. 게다가 직전 리뷰에서 "캐스트로 두면 오타가 조용히 폴백된다"는 지적을 받고 `Partial<Record<…>>`로 **타입만** 조인 게 안전해졌다는 착각을 더했다(타입은 런타임 프로토타입 체인과 무관하다). ARCHITECTURE가 위조 주입의 영향을 "해당 탭 로그 무결성 한정"으로 못박아 둔 경계를 렌더 크래시로 넓힌 것이다.
- **재발 방지**: (1) **외부·페이지 유래 문자열로 조회하는 테이블은 `Map`을 쓴다**(또는 `Object.create(null)`·`hasOwnProperty` 게이트). 객체 리터럴은 `constructor`·`__proto__`·`toString`·`valueOf`에 전부 truthy를 돌려준다. `grep -rnE "\[(e\.|entry\.|msg\.|payload\.)" src/sidepanel src/log-viewer`로 외부 값 인덱싱을 훑는다. (2) **`??` 폴백은 프로토타입 오염을 못 막는다** — 상속 값은 `undefined`가 아니다. 폴백을 방어로 쓰려면 `||`도 부족하고 조회 자체가 안전해야 한다. (3) **룩업 결과가 컴포넌트·함수로 쓰이면 위험 등급이 문자열일 때와 다르다** — 같은 패턴이 저장소에 있다고 안전 근거로 삼지 않는다. (4) 회귀 테스트는 **위조 키를 실제로 렌더**해 크래시 부재 + 폴백 아이콘을 단언한다(`ActionLogContent.test.tsx`). 타입 단언은 이 축을 못 잡는다.
- **관련**: `src/sidepanel/components/ActionLogContent.tsx:NAV_ICON`(Map), `src/sidepanel/lib/buildLogSummary.ts:NAV_VERB_EN`(Map), 주입 경로 `src/content/recorder-bridge.ts:handleActionData`·`src/sidepanel/hooks/usePickerMessages.ts`(엔트리 필드 미검증 — 수용된 설계), 경계 서술 `docs/ARCHITECTURE.md` "등록 핸드셰이크".

---

## 2026-08-12 — 방어를 넣으면서 "이제 막힌다"를 실측 없이 문장으로 먼저 확정했고, 세 번 다 틀렸다

- **영역**: `content`
- **계열**: `미검증단언`, `복제본`
- **그물**: `수동`
- **증상**: MAIN world 레코더를 적대적 페이지로부터 굳히는 배치였는데, 리뷰가 돌 때마다 **코드가 문서보다 약하다**는 발견이 같은 모양으로 세 번 나왔다. ① sentinel을 다중 등록으로 바꿔 "위조를 무해한 추가 구독자로 격하시킨다"고 적었지만, `dispatch()`가 `buffer.slice()` 하나를 모든 sentinel에 **같은 배열 객체로** 넘겨서, 먼저 등록된 위조 sentinel의 리스너가 `detail.entries.length = 0` 한 줄이면 뒤이어 발화되는 진짜 세션 배치를 비웠다 — 막으려던 가용성 공격이 그대로 열려 있었다. ② `JSON.parse`/`stringify`를 스냅샷하고 "본문 마스킹 무력화를 막는다"고 적었지만 `maskJsonBody`의 `Object.entries`, `maskUrl`의 `URL`·`URLSearchParams`, `maskHeaders`의 `Object.entries`가 전부 ambient로 남아 있었다(`Object.entries`를 throw로 바꾸면 catch 폴백이 원문을 통과시키고, **변조**로 바꾸면 `isMaskedHeader`가 빗나가 Authorization 원문이 남는다). ③ "페이지가 `document.addEventListener`를 후킹해 진짜 sentinel 문자열을 관측할 수 없다"고 적었지만, 브리지가 `setSentinel`을 `detail: { sentinel }` **평문**으로 dispatch하고 `document_idle`이라 페이지 인라인 스크립트가 고정 이름에 리스너 하나만 걸면 후킹 없이 UUID를 읽는다 — 문서가 계산한 "공격 비용 8이벤트/2이벤트"의 실제 하한은 **1이벤트**였다. 덤으로 grace 타이머는 ambient `clearTimeout`에 해제를 걸어, 페이지가 그걸 no-op으로 바꾸면 **정당하게 arm된 세션**이 60초 뒤 죽는 새 취약점을 만들었다.
- **근본 원인**: 셋 다 "방어 조치를 골랐다 → 그 조치가 무엇을 막는지 **문장으로 먼저 확정했다** → 코드를 그 문장에 맞춰 넣었다"의 산물이다. 설계 문서(`design.md` 위협 모델 판정)가 완화의 효과를 단정형으로 적어 뒀고, 구현이 그 문장을 옮겨 적은 뒤 소스 주석 4곳·ARCHITECTURE·PRD로 복제됐다. 실제로는 (a) 격리를 **컨테이너 단위로만** 생각했고(배열은 새로 떴지만 그 안의 엔트리 객체는 여전히 공유 참조다 — 지금도 그렇다), (b) 우회 경로를 **한 개만 열거**했고(마스킹은 파싱·순회·직렬화·URL 파싱이 다 같은 등급의 입구인데 파싱만 봤다), (c) **채널의 반대편을 안 봤다**(레코더가 sentinel을 어떻게 *쓰는지*만 보고 브리지가 어떻게 *보내는지*를 안 읽었다). 공통점은 방어 대상을 코드로 재현해 보지 않은 것이다 — 위조 스크립트를 실제로 한 번 돌렸으면 셋 다 첫 시도에서 드러났다.
- **재발 방지**: (1) **"이제 막힌다"를 적기 전에 공격을 코드로 재현한다.** 유닛으로 못 부르는 IIFE라도 우회는 대개 한 줄이다(`Object.entries = () => { throw 0 }` 뒤 `maskBody` 호출). 순수 헬퍼로 내려올 수 있는 부분은 오염 테스트로 고정하고(`network-recorder-helpers.test.ts`의 전역 오염 케이스 6종), 못 내려오는 배선은 `tasks.md` 수동 체크리스트에 **공격 스크립트 그대로** 적는다. (2) **전역 스냅샷은 "이 함수가 부르는 내장 전부"를 세고 시작한다** — `grep -nE '\b(JSON|Object|Array|URL|URLSearchParams|crypto|setTimeout|clearTimeout)\b' src/content/*.ts`로 뽑고, 마스킹·id·타이머처럼 **실패가 조용한** 경로부터 덮는다. 스냅샷은 **참조 고정까지**라는 것도 함께 적는다 — `crypto`만 잡으면 `crypto.randomUUID = …` 속성 재정의가 통하고(그래서 `bind`로 함수를 떠야 한다), `URLCtor`를 잡아도 `URL.prototype.toString` 재정의는 못 막는다. (3) **양방향 채널은 양쪽 파일을 같이 읽는다** — sentinel 은닉을 논하면서 `recorder-bridge.ts`를 안 열었다. `grep -rn "dispatchEvent(new CustomEvent" src/content/`로 **보내는 쪽**을 전수하고 detail에 뭐가 실리는지 본다. (4) **해제를 페이지가 바꿀 수 있는 함수에 의존하지 않는다** — `clearTimeout` 대신 콜백 첫 줄에 래치(`armedOnce`). 래치는 "지금 녹화 중"(`recording`)이 아니라 **타이머의 조건 그 자체**("arm이 한 번도 안 왔다")여야 한다. (5) **설계 문서의 단정형 문장은 구현 시점에 정정하고 그 사실을 남긴다** — 이번엔 `design.md`·`prd.md`에 "(구현 시점 정정 — 초안의 X 전제는 틀렸다)"를 인라인으로 박았다. 문서만 고치고 소스 주석 4곳을 안 고쳐 다음 사람이 소스만 읽고 "위협이 닫혔다"고 믿을 뻔한 것도 같은 회로다 — 보증 문구는 한 곳(모듈 헤더)에 두고 나머지는 포인터로 만든다.
- **관련**: `src/content/sentinel-registry.ts`(헤더가 보증 문구 단일 출처 — 무엇을 없앴고 무엇이 남는지), `src/content/recorder-globals.ts`(스냅샷 8종 + `randomUUID`는 `crypto`에 bind, "은닉이 목적이 아니다" 명시), `src/content/network-recorder.ts:dispatch`(sentinel마다 `buffer.slice()`)·`:maskHeaders`(objectEntries)·grace 타이머 `armedOnce` 래치(3파일 복제), `src/content/network-recorder-helpers.ts:maskBody`·`maskUrl`·`maskJsonBody`, 반대편 `src/content/recorder-bridge.ts:handleSetSentinel`(평문 detail·`document_idle`), 그물 `src/content/__tests__/network-recorder-helpers.test.ts`(전역 오염 6케이스) + `docs/features/audit-refactor-3/tasks.md` 수동 체크리스트. 계열: **2026-08-11**(자격증명 가드가 폼에만 있던 건 — 그때도 "판정 함수가 있다"를 "막힌다"로 읽었다).

## 2026-08-11 — 자격증명 가드가 입력 폼에만 있어서, 저장된 설정으로 도는 요청은 아무도 안 봤다

- **영역**: `background`, `어댑터`
- **계열**: `복제본`, `미검증단언`
- **그물**: `unit`
- **증상**: Jira를 API Token으로 연결할 때 워크스페이스 URL에 `http://`를 넣으면 그대로 저장되고, 이후 모든 요청이 `Authorization: Basic base64(email:apiToken)`을 **평문으로** 전송했다. 같은 자리의 GitLab PAT·BYOK LLM 키는 막혀 있었다.
- **근본 원인**: 판정 함수(`isCredentialSafeUrl`)는 이미 있었고 소비처가 셋이어야 했는데 **둘만 불렀다**. 그런데 진짜 함정은 "하나 빠뜨렸다"가 아니라 **가드가 있던 두 곳도 잘못된 층에 있었다**는 것이다 — GitLab은 `gitlabInstanceUrl.normalizeInstanceUrl`, BYOK는 `LlmConnectDialog`, 즉 **둘 다 사이드패널 입력 폼**이다. 폼은 연결하는 순간 한 번만 지나간다. 저장된 계정으로 도는 이후 요청은 폼을 다시 통과하지 않고, `gitlab.testPat`처럼 폼을 우회해 baseUrl을 직접 받는 핸들러도 있다. GitLab만 해도 baseUrl을 쓰는 핸들러가 14개인데 감사가 지목한 건 그중 하나였다 — 그 하나를 고쳤으면 나머지 13개가 그대로 남았을 것이다. **"입력을 검사한다"와 "나가는 요청을 검사한다"는 다른 문제이고, 자격증명은 후자여야 한다.**
- **재발 방지**: (1) **자격증명이 실리는 요청은 egress 단일 관문에서 검사한다** — 지금은 Jira `jira-api.ts:resolveUrl`의 apiKey 분기, GitLab `gitlab-api.ts:gitlabFetch`의 상대경로 분기 둘이고, 새 플랫폼을 붙이면 그 어댑터의 `*Fetch`에 같은 줄이 들어가야 한다. 폼 가드는 안내용으로 **추가로** 둔다(에러를 입력 시점에 보여주려는 것이지 방어선이 아니다). 전수: `grep -rn "auth.baseUrl\|normalizeBaseUrl" src/background/`가 baseUrl을 쓰는 지점 전부를 뽑고, 각각이 관문을 지나는지 본다. (2) **헬퍼에 테스트가 있다고 호출부가 지켜지는 게 아니다** — `assertCredentialSafeBase` 자체 테스트 6개는 처음부터 있었는데, 그 상태로 `jira-api`·`gitlab-api`의 게이트 호출을 통째로 지워도 5103 케이스가 전부 green이었다. 호출부를 고정하는 테스트(`http` base면 **fetch mock이 호출되지 않음**)를 따로 박아야 한다. 이번엔 자체검증이 잡았지만 그 전까지 "전체 green"을 근거로 넘어갈 뻔했다. (3) **로컬 예외를 함께 고정한다** — loopback http는 통과해야 한다(로컬 GitLab·ollama). 가드를 넣을 때 거부 케이스만 테스트하면 이 예외가 조용히 사라진다. (4) **이미 저장된 설정은 어느 폼도 재검증하지 않는다** — 폼 가드가 나중에 생긴 플랫폼(GitLab은 2026-07-26, Jira는 이번)은 그 이전에 http로 연결한 계정이 스토리지에 남아 있을 수 있고, egress 가드를 켜는 순간 "연결됨으로 보이는데 모든 조회가 실패"하는 상태가 된다. 의도된 차단이지만 복구 경로(연결 해제 → https 재연결)를 사용자가 유추해야 한다.
- **관련**: `src/lib/credential-url.ts:assertCredentialSafeBase`(판정은 `@/lib/loopback-host:isCredentialSafeUrl`에 위임, i18n 문구만 입힘 — 키 접두사를 2-멤버 union으로 받아 `t()` 캐스트를 없앴다), 관문 `src/background/jira-api.ts:resolveUrl`·`src/background/gitlab-api.ts:gitlabFetch`, 폼 가드 `src/sidepanel/tabs/connect/JiraConnectForm.tsx:handleValidate`·`connect/gitlabInstanceUrl.ts:normalizeInstanceUrl`·`settings/LlmConnectDialog.tsx:handleConnect`, 그물 `src/lib/__tests__/credential-url.test.ts`(헬퍼) + `src/background/__tests__/{jira,gitlab}-api.test.ts`(호출부 — fetch 미호출 단언). 같은 배치에서 `ai-provider.ts:fetchModels`도 리다이렉트 차단이 빠져 있었는데, **기존 테스트가 그 부재를 `toBeUndefined()`로 정답처럼 고정**하고 있어 기대값을 뒤집어야 했다 — 그물이 결함을 승인한 상태였다.

## 2026-08-11 — 발신처를 막으려고 `sender.tab`을 봤는데, 그건 "content script인가"가 아니라 "탭에서 열렸나"였다

- **영역**: `background`, `e2e`
- **계열**: `라이브러리전제`, `미검증단언`
- **그물**: `e2e`
- **증상**: (사전 차단 — 같은 라운드의 자체검증이 잡음) `captureVisibleTab` 핸들러에 content script 발신을 거부하는 가드를 넣었는데, 그대로 나갔으면 **e2e의 캡처 의존 spec 전량이 죽고** `e2e-gate`(main required check)가 머지를 막았을 것이다. 프로덕션은 멀쩡했을 것이라 로컬 유닛·빌드로는 아무 신호도 안 났다.
- **근본 원인**: `chrome.runtime.MessageSender.tab`은 **"연결이 탭에서 열렸는가"**를 뜻하고 Chrome 문서가 "including content scripts"라고 적은 대로 content script는 그 부분집합일 뿐이다. 막고 싶었던 건 "content script인가"인데 잰 것은 "탭에 있는가"였다. 프로덕션 사이드패널은 `chrome.sidePanel`로 열려 탭이 아니라서 우연히 통과했고, e2e fixture는 패널을 `context.newPage()` + `goto("chrome-extension://…/index.html")`로 **탭에 띄운다**(`e2e/fixtures/extension.ts:openPanel`). 즉 같은 코드가 프로덕션에선 통과하고 테스트에선 막히는 갈림이 판별식 하나에서 생겼다. 설계 문서에는 "한 줄 가드가 위험의 100%를 덮는다"라고 적혀 있었는데, 그 문장은 **발신처 목록을 세어 본 결과**였지 판별식이 그 목록과 일치하는지 확인한 결과가 아니었다. 올바른 축은 origin이다 — content script의 `sender.origin`은 페이지 origin이고 확장 페이지는 탭에 있든 패널에 있든 `chrome-extension://<id>`다.
- **재발 방지**: (1) **발신처 판별은 `sender.origin`으로 한다** — `sender.tab`은 위치 축이라 "확장 페이지를 탭으로 띄우는" 경로(e2e·디버그용 탭 열기)를 함께 막는다. 새 핸들러에 발신처 가드를 넣을 땐 `grep -rn "sender\.tab\|sender\.origin" src/background/`로 기존 판별식을 먼저 보고 축을 맞춘다. (2) **fail-closed 가드를 추가할 땐 "지금 통과해야 하는 발신처"를 전수 열거하고 각각이 실제로 통과하는지 확인한다** — 이번 발신처는 `sidepanel/capture.ts`·`scroll-capture.ts`·`usePickerMessages.ts`·`30s-replay/use-30s-replay.ts` 넷이고, 그중 어느 것도 유닛 테스트가 없다(`messages.ts`는 커버리지 로직 스코프 제외). **그래서 이 축은 e2e가 유일한 그물이고, push 전에 `capture.spec.ts`·`capture-methods.spec.ts`를 로컬에서 돌리는 게 CI 왕복보다 싸다.** (3) **e2e 픽스처가 프로덕션과 다른 실행 형태를 쓰는 지점을 기억한다** — `e2e/GOTCHAS.md`가 이미 "e2e에선 사이드패널이 탭이다"를 적어 뒀는데 가드를 설계할 때 그걸 안 봤다. 실행 컨텍스트에 의존하는 판정(탭 여부·window 종류·포커스)을 넣을 때 이 파일을 먼저 grep한다. (4) 같은 배치의 인접 사례: URL 인코딩을 통일하면서 asana 쿼리를 `URLSearchParams`로 바꿨더니 `opt_fields=name,email`의 쉼표가 `%2C`가 돼 **정상 값에서 URL 문자열이 달라졌다**. 설계가 "정상 id에서는 변경 전과 동일"을 검증 기준으로 박아둔 덕에 잡혔다 — **인코딩·정규화를 "통일"할 때는 통일 자체가 회귀를 만들 수 있으므로 무변화 케이스를 먼저 단언한다.**
- **관련**: `src/background/messages.ts`(`captureVisibleTab` case의 origin 가드), 발신처 4곳 `src/sidepanel/capture.ts`·`scroll-capture.ts`·`hooks/usePickerMessages.ts`·`30s-replay/use-30s-replay.ts`, 픽스처 `e2e/fixtures/extension.ts:openPanel`(패널을 탭으로 연다), 그물 `e2e/capture.spec.ts`·`capture-methods.spec.ts`. 계열 선행: **2026-06-29**(captureVisibleTab 쿼터 — 실제 API 호출을 `messages.ts` 1곳 + `capture-throttle` 경유로 유지하라는 제약. 이번 가드는 case 최상단 1줄이라 그 구조를 안 건드렸다).

## 2026-08-11 — 자기검증 앵커를 달아놓고도 스캐너가 소비자 하나를 통째로 안 봤다

- **영역**: `i18n`, `툴체인`
- **계열**: `복제본`, `미검증단언`
- **그물**: `unit`
- **증상**: (사전 차단 — 같은 라운드의 `/code-review`가 잡음) `public/_locales/`(확장 이름·설명·단축키 라벨)에 처음으로 그물을 깔았는데, **그 그물이 정작 막으려던 케이스를 못 잡는 상태로 green이었다.** `chrome.i18n.getMessage("NEW_KEY")`를 부르면서 사전에 키를 안 넣으면 무검출이고, 반대로 런타임에서만 쓰는 키를 넣으면 "죽은 문자열"로 오탐된다.
- **근본 원인**: 이 사전의 소비자는 **둘**이다 — `manifest.config.ts`의 `__MSG_` 치환과 `src/background/index.ts:54`의 런타임 `chrome.i18n.getMessage`. 스캐너는 앞의 하나만 읽었다. 통과하고 있던 이유는 하필 `EXT_NAME_SHORT`가 **양쪽 모두에** 있어서고, 우연이 없었으면 첫 실행부터 빨간불이었을 것이다. 더 중요한 건 이게 **바로 전날 읽은 2026-07-26 회고와 같은 함정**이라는 점이다. 그 회고의 처방 두 개 중 **자기검증 앵커는 착실히 넣었는데**(`referencedKeys`가 `EXT_NAME`을 찾는지) 그게 통과해도 아무 소용이 없었다 — **앵커는 "정규식이 0건이 아님"을 증명할 뿐 "이게 참조의 전부임"은 증명하지 못한다.** 2026-07-26의 교훈을 "디렉터리 말고 import 그래프 BFS를 써라"라는 **순회 방식**으로 좁게 기억한 게 뿌리다. 실제 교훈은 순회 방식이 아니라 **대상 집합의 완전성**이고, 이번엔 BFS가 문제가 아니라 애초에 다른 파일을 안 본 것이다 — 방식을 아무리 정교하게 골라도 소비자를 하나 빠뜨리면 같은 구멍이 난다.
- **재발 방지**: (1) **스캐너를 쓰기 전에 "이 데이터를 읽는 곳이 몇 군데인가"를 먼저 전수 열거한다.** 순회 알고리즘을 고르는 건 그다음이다. 이 저장소의 사전류는 소비자가 여럿인 게 기본이다 — `_locales`는 manifest + `chrome.i18n`, log-viewer 복제 사전은 자기 디렉터리 + 재사용하는 사이드패널 공용 컴포넌트. `grep -rn "chrome.i18n" src/`가 이 사전의 두 번째 소비자를 찾는 명령이었고, 그걸 안 돌린 게 전부다. (2) **앵커는 "0건이 아님"이 아니라 "각 소스가 독립적으로 뭔가를 찾음"을 재야 한다.** 합집합만 단언하면 큰 소스가 작은 소스의 공허함을 가린다 — 그래서 `manifestKeys`·`runtimeKeys`를 따로 이름 붙여 노출하고 **런타임 스캔 단독으로 앵커를 걸었다**. 소스가 N개면 앵커도 N개다. (3) **새 그물은 그것이 막으려던 결함을 실제로 주입해 red를 확인한다** — 사전에 없는 `chrome.i18n.getMessage("TOTALLY_MISSING_KEY")`를 임시로 넣어 red를 실측했다. 이 절차가 없었으면 "앵커도 있고 green이니 됐다"로 끝났다. (4) 회고를 소환할 땐 **처방 문장이 아니라 그 처방이 막으려던 실패 모드**를 읽는다 — 처방은 그때의 구현에 맞춰 쓰여 있어 다음 사례에선 형태가 다르다.
- **관련**: `src/i18n/__tests__/manifest-locales.test.ts`(`manifestKeys`·`runtimeKeys` 분리 + 런타임 스캔 전용 앵커 + `walk()` src 순회), 소비자 `manifest.config.ts`(`__MSG_`)·`src/background/index.ts:54`(`chrome.i18n.getMessage`), 사전 `public/_locales/{ko,en}/messages.json`. 계열 선행: **2026-07-26**(복제 사전 그물의 스캔 범위가 번들 그래프보다 좁아 조용히 green — 이번 건이 그 교훈의 **재적용 실패** 사례다) · **2026-06-28**(log-viewer 복제 dict 미동기화).

## 2026-08-11 — 별도 번들의 alias가 prefix 매칭이라, 공용 모듈을 `@/` 경로로 못 부르고 그래서 그 모듈이 의존성 0이어야 했다

- **영역**: `i18n`, `툴체인`
- **계열**: `복제본`, `라이브러리전제`
- **그물**: `unit`
- **증상**: (사전 차단) 로케일 축을 `src/i18n/locales.ts`로 승격해 사이드패널·background SW·log-viewer 셋이 공유하게 만들었다. log-viewer에서 관례대로 `@/i18n/locales`로 import했다면 **모듈을 못 찾아 별도 빌드가 깨진다.** typecheck는 통과한다 — tsconfig의 `@/*`는 정상 해석되고, 깨지는 건 vite 빌드 시점이라 다른 레인이다.
- **근본 원인**: `vite.log-viewer.config.ts`가 `"@/i18n"` → `src/log-viewer/i18n.ts`(복제 사전)로 alias하는데, vite의 **문자열 alias는 exact가 아니라 prefix 매칭**이다. 그래서 `@/i18n/locales`가 `.../log-viewer/i18n.ts/locales`로 재작성된다. alias를 "이 한 모듈만 갈아끼운다"로 읽으면 안 보이고, 실제로는 **`@/i18n` 하위 전체가 그 파일로 접힌다.** 여기서 파생 제약이 하나 더 나온다 — log-viewer는 공용 모듈을 **상대경로(`../i18n/locales`)로만** 부를 수 있고, 그러면 그 모듈이 통째로 log-viewer 번들에 들어간다. 즉 `locales.ts`의 "런타임 import 0"은 취향이 아니라 **번들 제약이 강제하는 불변식**이다. store를 하나만 import해도 zustand+chrome.storage가 별도 번들과 service worker에 딸려온다. 이 인과(alias prefix → 상대경로 강제 → 의존성 0)가 세 파일에 흩어져 있어 어느 한 파일만 읽어선 보이지 않는다.
- **재발 방지**: (1) **log-viewer 번들이 쓰는 공용 모듈을 추가할 땐 `@/` 경로가 alias prefix에 걸리는지 먼저 본다** — `grep -n "alias" vite.log-viewer.config.ts`로 접히는 prefix를 확인하고, 걸리면 상대경로로 부른다. 현재 걸리는 건 `@/i18n` 하나지만 alias가 늘면 같은 함정이 재장전된다. (2) **상대경로로 끌어간 공용 모듈은 의존성 0을 소스 스캔 테스트로 고정한다** — `locale-registry.test.ts`의 "locales.ts 순수성" describe가 런타임 import·`chrome.`·`navigator.` 부재를 강제한다. 타입체크로는 안 잡히는 축이라(둘 다 정상 해석된다) 스캔이 유일한 자동 그물이다. (3) **"문자열 X가 소스에 없어야 한다"류 검사는 주석을 걷어낸 뒤 재고, 자기검증 앵커를 같이 둔다** — 초안이 주석의 `chrome.storage` 설명 문구에 걸려 false positive를 냈다. 주석을 지우는 쪽으로 고치면 스트리퍼가 통째로 지웠을 때 vacuous green이 되므로, 2026-07-26의 앵커 처방을 그대로 적용해 "스트리퍼 통과 후에도 `export function normalizeLocale`이 남아있다"를 별도 `it`으로 고정했다. (4) 이 계열의 선행 두 건(2026-06-28·2026-07-26)은 복제 사전의 *내용* 발산을 다뤘다 — 이번은 *모듈 해석 경로*다. 별도 번들을 건드릴 땐 **내용·경로 두 축을 따로** 확인한다.
- **관련**: `src/i18n/locales.ts`(런타임 import 0 — 레지스트리 단일 출처), `src/log-viewer/i18n.ts`(상대경로 `../i18n/locales` + 이유 주석), `vite.log-viewer.config.ts`(`@/i18n` alias — prefix 매칭의 출처), 그물 `src/i18n/__tests__/locale-registry.test.ts`("locales.ts 순수성" describe + 주석 스트리퍼 자기검증 앵커). 계열 선행: **2026-06-28**(log-viewer 복제 dict 미동기화) · **2026-07-26**(복제 사전 그물의 스캔 범위가 번들 그래프보다 좁아 조용히 green — 앵커 처방의 출처).

## 2026-08-10 — 영속 테스트가 남의 describe에서 키 상수를 물려받아, 빈 저장소를 읽고 기본값으로 통과했다

- **영역**: `store`
- **계열**: `미검증단언`, `드리프트`
- **그물**: `unit`
- **증상**: (구현 중 자체 검증이 잡음 — 미출시) `aiLanguage`의 persist `merge` 재정규화를 덮으려고 쓴 rehydrate 테스트가 **검증 대상과 무관하게 통과**했다. `store["bugshot-settings-ui"]`에 오염값 `Klingon`을 심고 `useSettingsUiStore.persist.rehydrate()` 후 `"auto"`를 기대했는데, 실제 persist `name`은 `bugshot-app-settings`라 rehydrate가 **빈 저장소를 읽었다**. 상태는 스토어 기본값 `"auto"`에 머물렀고, 단언의 통과 근거는 정규화가 아니라 기본값이었다. `merge`의 `normalizeAiLanguage` 호출을 통째로 지워도 green이다.
- **근본 원인**: 같은 파일의 `apiKeyObfuscatingStorage` describe가 `const KEY = "bugshot-settings-ui"`를 들고 있었고, 거기에 케이스를 이어 붙이며 그 상수를 그대로 썼다. **그 describe에서는 임의 키가 정답이다** — 저장 래퍼의 `getItem`/`setItem` 왕복만 재므로 키가 무엇이든 무관하다. rehydrate는 반대로 **persist `name`과 일치해야만** 입력이 도달하는데, 상수 이름이 `KEY`로 같아 그 차이가 보이지 않았다. 여기에 **기대값(`auto`)이 하필 기본값과 같다**는 조건이 겹쳐, 입력이 0바이트여도 단언이 성립하는 구조가 됐다. 영속 계층을 실제로 태우는 테스트는 식별자가 어긋나면 예외가 아니라 **조용한 빈 입력**으로 실패한다는 게 핵심이다. 들킨 경로는 같은 describe에 넣은 **반대 방향 케이스**(유효값 `French` 보존)가 red가 된 것 하나뿐이었다 — 그게 없었으면 공허한 green이 그대로 커밋됐다.
- **재발 방지**: (1) **영속·저장소를 실제로 태우는 테스트의 키·이름은 프로덕션 상수와 대조한다** — 손으로 적은 리터럴이면 `grep -n "name:" src/store/*.ts`로 persist `name`을 확인하고, 이상적으로는 프로덕션에서 export해 import한다. 남의 describe에서 상수를 물려받을 때 **그 describe가 그 값에 의존하는지**를 먼저 묻는다(왕복 테스트는 의존하지 않고 rehydrate는 의존한다). (2) **기대값이 기본값과 같으면 그 케이스는 단독으로 아무것도 증명하지 못한다** — 시작 상태를 기대값과 **다르게** 심고(`setAiLanguage("French")` 후 오염값 rehydrate), 같은 축의 **반대 방향 케이스를 쌍으로** 둔다. 이번에 유일한 탐지 경로가 그 쌍이었다. `grep -rn "persist.rehydrate\|persist\.setOptions" src/`가 이 부류의 전수 대상이다. (3) 2026-08-06 두 항목("기대값을 SUT가 계산" · "빈 그물 3연속")의 재발방지 — **그물은 작성 직후 뮤테이션으로 비공허를 증명한다** — 를 이번에도 적용해 `merge`의 `normalizeAiLanguage` 삭제·`aiLanguageLabel`의 조회 축 뒤집기 두 뮤턴트로 red를 실측했다. 같은 계열의 **새로운 트리거**(부분열 충돌·SUT 경유 기대값이 아니라 *영속 키 불일치*)이니, 공허성의 원인 목록에 "입력이 도달하지 않았다"를 추가한다.
- **관련**: `src/store/__tests__/settings-ui-store.test.ts`("rehydrate 재정규화 (merge)" describe — `PERSIST_KEY`를 persist `name`과 일치시키고 시작 상태를 심음), `src/store/settings-ui-store.ts`(`merge`의 `normalizeAiLanguage` · persist `name: "bugshot-app-settings"`), `src/sidepanel/lib/aiLanguage.ts:aiLanguageLabel`(같은 라운드에서 무검증으로 드러나 테스트 추가). 선행 회고: **2026-08-06**(테스트 중복 제거가 기대값을 SUT에 넘겨 항진명제) · **2026-08-06**(그물을 같은 시점에 써서 맹점 상속 — 빈 그물 3연속).

## 2026-08-10 — 라이브러리 필터를 열자 그 필터가 겸하던 두 번째 일(값 검사)까지 같이 열렸다

- **영역**: `content`
- **계열**: `라이브러리전제`
- **그물**: `unit`
- **증상**: (구현 중 `/code-review` security 관점이 잡음 — 미출시) `data-testid="user-jane@acme.com"`·`data-cy="010-1234-5678"`·`data-qa="order-2026-0810-KR"` 같은 값이 생성 selector에 그대로 실렸다. 그 selector는 이슈 본문 재현 환경 행 → 8개 플랫폼 제출 페이로드·저장 초안·사용자가 고른 LLM endpoint로 나간다. 변경 **전에는 전부 차단**되던 값들이다.
- **근본 원인**: `@medv/finder`의 기본 `attr` predicate는 이름과 값을 **한 함수에서** 검사한다 — `acceptedAttrNames.has(name) || (name.startsWith('data-') && wordLike(name))` **그리고** `wordLike(value) && value.length < 100`. 우리가 연 것은 **이름 게이트**뿐이었다(`wordLike`가 `data-e2e`·`data-cy`·`data-qa`·`data-pw`·`data-test-id`·`data-automation-id` 6개를 후보로도 안 만들어서). 그런데 훅을 통째로 교체하는 API라 이름만 바꿀 수가 없고, 새 술어를 쓰는 순간 **값 게이트도 함께 사라진다**. 1차 구현의 값 검사는 길이 100자·제어문자·"8자 이상 연속 hex" 셋뿐이었는데, 하이픈이 hex 런을 끊어 `010-1234-5678`·`order-2026-0810`이 그대로 통과했다. 더해서 `id`는 아예 값 정책이 없었고 finder penalty가 0이라 `#user-jane@acme.com`이 stage 0에서 **최우선** 채택된다 — 같은 문자열이 `for` 속성에서는 막히고 `id`에서는 통과하는 비대칭이 남아 있었다. "test contract 속성은 개발자가 붙인 계약"이라는 전제가 뿌리인데, 실제로는 리스트 행마다 `data-testid={user.email}`·`` data-testid={`row-${order.id}`} ``로 값을 넣는 코드가 흔하다.
- **재발 방지**: (1) **라이브러리 훅을 교체할 땐 그 훅의 기본 구현을 읽고 "이게 몇 가지 일을 하고 있나"를 먼저 센다** — 이름 검사를 열려고 교체했는데 값 검사가 딸려 나갔다. `grep -n "export function attr\|export function idName\|export function className" node_modules/@medv/finder/finder.js`로 기본 술어를 열어 각 절이 무엇을 막는지 항목화한 뒤 대체 술어를 쓴다. (2) **selector·식별자처럼 "기계 문자열"로 분류된 값도 페이지가 내용을 통제하면 PII 경로다** — 새로 selector에 들어갈 수 있게 된 축(attribute name·id·class)마다 이메일·전화번호·주문번호·비ASCII 샘플로 단위 테스트를 박는다(`element-locator.test.ts`의 "test contract 속성이어도 PII·런타임 식별자 값은 통과시키지 않는다"). (3) **같은 문자열이 축에 따라 갈리면 게이트 하나를 빼먹은 것이다** — `for="jane@acme.com"`은 막고 `id="jane@acme.com"`은 통과하던 게 신호였다. finder가 값을 받는 축은 `attr`·`idName`·`className` 셋이고 셋 다 같은 술어를 태워야 한다. (4) 좁히는 방향의 손실은 **compat 단계가 흡수**하므로(변경 전 동작으로 폴백) 애매하면 거부한다 — 이 게이트는 기능을 죽이지 않고 앵커만 포기한다.
- **관련**: `src/content/element-locator.ts:isHandWrittenIdentifier`(trusted·semantic·`isStableIdName` 공용 게이트)·`isStableAttribute`·`isStableIdName`, 기본 구현 `node_modules/@medv/finder/finder.js:attr`(이름+값 한 함수), 그물 `src/content/__tests__/element-locator.test.ts`(PII 8케이스 + id 대칭), e2e `e2e/stable-locator.spec.ts`(3번 — `data-testid="user-jane@acme.com"`).

## 2026-08-10 — 한 생산자를 둘로 쪼개자, 그 출력을 문자열로 비교하던 곳이 무음으로 죽었다

- **영역**: `content`, `컴포넌트`
- **계열**: `드리프트`, `미검증단언`
- **그물**: `jsdom`
- **증상**: (구현 중 CTO 게이트가 잡음 — 미출시) DOM 트리 다이얼로그에서 **현재 선택된 노드의 하이라이트가 사라진다.** 에러도 폴백도 로그도 없고 트리 이동·확장·선택은 전부 정상이라, "어느 노드가 지금 편집 중인지"만 안 보인다. 게다가 **기능이 잘 동작할 때만** 죽는다 — 아래 이유로 두 문자열이 갈리는 조건이 곧 새 selector가 앵커를 채택하는 조건이다.
- **근본 원인**: `DomTreeDialog`의 `isCurrent`가 `node.selector === currentSelector`인데, 왼쪽은 `dom-describe.ts:buildSelector`(트리 직렬화) 산출이고 오른쪽은 스토어의 `selection.selector`(picker payload) 산출이다. **변경 전엔 둘 다 같은 함수라 이 비교가 공짜로 성립했다.** 요소 선택 경로만 새 빌더(`element-locator.ts:buildStableSelector`)로 갈아타면서 두 문자열이 다른 알고리즘의 출력이 됐는데, 설계 문서는 "DOM Tree의 `TreeNode.selector` 계약은 유지한다"·"DOM Tree는 기존 경량 경로를 유지한다"고 **안 건드린다는 결정만** 적었고 *안 건드린 결과 비교 가능하지 않게 된다*는 귀결을 안 적었다. 구현자가 문서를 그대로 따르면 반드시 밟는다. 두 알고리즘 출력이 등가 비교되는 곳은 코드베이스 전체에서 이 한 줄뿐이었고(`expanded` Set·`ancestorPath`·`contextSelector`는 전부 compat끼리라 일관), 하필 그 한 줄에 유닛도 e2e 단언도 없었다.
- **재발 방지**: (1) **한 값의 생산자를 둘로 쪼개면, 그 값을 `===`로 비교하던 지점을 전수로 센다** — 쪼개기 전엔 "같은 함수니까"로 성립하던 비교가 전부 후보다. `grep -rn "\.selector ===\|=== .*[Ss]elector" src/`가 이 축의 전수 목록이고 현재 유효한 교차 비교는 0곳(하이라이트는 트리 응답 `ancestorPath` 꼬리로 옮겨 compat끼리 비교한다). (2) **"A는 안 건드린다"는 설계 결정을 쓸 때 *그 결과 A와 B의 관계가 어떻게 바뀌는지*를 같은 문단에 쓴다** — 결정만 적으면 귀결은 구현 시점에 발견된다. (3) **시각 신호 하나로만 드러나는 계약은 그 계약을 순수 함수 층에서 따로 고정한다** — 하이라이트 자체는 클래스 유무라 e2e/시각 판정이지만, 그 밑에 깔린 "`ancestorPath` 꼬리와 트리 노드가 같은 빌더 산출"은 jsdom으로 잰다(`dom-describe.test.tsx`). 겸사겸사 그 테스트가 두 빌더의 출력이 **실제로 갈린다**는 것도 함께 단언해, 비교를 되돌리려는 시도가 red로 잡힌다. (4) 계열은 2026-08-06 "필드를 고쳐 놓고 소비처 8곳을 안 바꿨다"와 같다 — 그쪽은 필드 교체, 이쪽은 생산자 분기이고 둘 다 **소비처 전수 세기**가 처방이다.
- **관련**: `src/sidepanel/tabs/DomTreeDialog.tsx`(`isCurrent` — 스토어 구독 → 트리 응답 `ancestorPath.at(-1)`), 생산자 `src/content/dom-describe.ts:buildSelector`·`buildInitialTree`(compat) ↔ `src/content/element-locator.ts:buildStableSelector`(stable), 그물 `src/content/__tests__/dom-describe.test.tsx`("ancestorPath의 마지막 항목이 선택 요소 트리 노드의 selector와 같다" + "그 selector는 stable 빌더 산출과 다를 수 있다"), 문서 `docs/ARCHITECTURE.md` "요소 selector 생성 (실행 키)".


## 2026-08-08 — 리뷰 루프가 8라운드 연속 자기 픽스로 다음 결함을 만들었는데, 종료 조건이 그걸 못 세게 돼 있었다

- **영역**: `툴체인`
- **계열**: `미검증단언`
- **그물**: `없음`
- **증상**: 한 기능에 `/code-review` → `/refactor`를 **10라운드** 돌렸는데 종료 조건("연속 2회 심각 0건")에 한 번도 도달하지 못했다. 라운드 3에서 한 번 0이 나온 뒤 4~10은 전부 심각이 났다. 매 라운드 테스트는 green이었고 CI도 통과했다. 누적 🔴 19건.
- **근본 원인**: 두 가지가 겹쳤다. **(1) 종료 조건과 진행 방식이 모순이었다.** 루프 규약이 "이미 쓴 리뷰 각도는 중복하면 소득이 없으니 매 라운드 새 각도를 투입하라"고 정해두었는데, 새 각도는 정의상 새 결함을 찾는다. 그래서 🔴 카운트가 코드 품질의 함수가 아니라 **각도 신선도의 함수**였다 — 각도가 고갈되기 전엔 0이 안 나오고, 규약이 각도를 계속 공급했다. 유일하게 0이 나온 라운드 3은 앞뒤가 같은 4관점을 재탕한 구간이었다. 게다가 심각도를 리뷰어(에이전트)가 매기므로 "심각 0건"은 코드 상태가 아니라 **리뷰어의 재량**이다. **(2) 라운드 3~10의 심각이 예외 없이 직전 라운드의 픽스가 원인이었다.** 8/8. 이건 개별 픽스가 조잡해서가 아니라 손대는 대상이 국소 수정을 허용하지 않는 구조(게이트·래치·소유권이 서로 다른 변수에 흩어진 동시성 코드)라는 신호였는데, 루프는 그걸 "리뷰 규율 문제"로 읽고 규율 항목을 늘리는 처방을 반복했다. 라운드 9는 산출물 전체가 net-negative였다 — 그 라운드가 추가한 send-cap과 네비게이션 판정 둘 다 라운드 10에서 되돌렸고, 그중 하나는 앵커 클릭만으로 사용자 편집이 날아가는 **새 결함**이었다. 커버리지도 로직 파일 8개가 하락해 베이스라인 래칫을 못 올렸다.
- **재발 방지**: (1) **리뷰 루프의 종료 조건은 "새 각도를 넣어도 안 나온다"가 아니라 *고정된* 판정 기준으로 세운다.** 각도를 계속 바꾸는 루프에 "연속 N회 0건"을 붙이면 종료가 구조적으로 불가능하다 — 라운드 수 상한이나 "같은 각도 재실행에서 0건"처럼 분모가 고정된 조건을 쓴다. (2) **같은 파일에서 3라운드 연속 심각이 나오면 리뷰를 멈추고 그 파일의 구조를 의심한다.** 표면 패치의 실증 실패율이 이미 나와 있는데(여기선 8/8) 근본 개편의 미측정 위험을 더 크게 보는 건 거꾸로다 — 루프의 실패가 루프를 못 벗어나는 근거로 재활용된다. (3) **라운드 산출물의 순증감을 센다.** 되돌린 픽스 수와 새로 만든 결함 수를 라운드별로 적으면 net-negative 라운드가 즉시 보인다. 안 세면 "🔴을 N건 잡았다"만 남아 루프가 항상 생산적으로 보인다. (4) **10라운드가 못 잡은 것을 실물 5분이 잡았다.** 이 기능은 마지막에 "모든 사이트에서 실패한다"는 제보를 받았는데 원인은 stale `dist`였고, 정상 동작을 확인하는 데 재로드 한 번이면 됐다. 코드 리뷰를 몇 라운드 더 도는 것보다 **실브라우저 확인 한 번**이 더 많은 사실을 준다 — 자동 그물 밖의 축(`시각`·`수동`)이 비어 있으면 리뷰 라운드로 그걸 메울 수 없다.
- **관련**: 드랍된 기능의 전체 이력과 라운드별 인과 표는 `archive/device-viewport` 브랜치의 `docs/features/device-viewport/review-log.md`. 이 회고를 낳은 루프의 대상 파일은 그 브랜치의 `src/sidepanel/device-viewport-controller.ts`(816줄)·`src/background/device-frame-coordinator.ts`(586줄).

## 2026-08-07 — 새 기능이 옛 주석의 전제를 거짓으로 만들었는데, 필드를 골라 담는 조립이 그 사실을 조용히 삼켰다

- **영역**: `content`, `미디어`
- **계열**: `미검증단언`, `복제본`
- **그물**: `e2e`
> 이 회고를 낳은 디바이스 뷰포트 기능은 2026-08-08에 드랍됐다(코드는 `archive/device-viewport` 브랜치). 아래의 사라진 파일 참조는 그 브랜치 기준이고, **재발 방지 항목은 기능과 무관하게 그대로 유효하다** — 조립 유실도 optional의 의미 과적도 이 저장소 전역의 형태다.

- **증상**: 확장이 심은 same-origin 프레임 안에서 컨테이너(다이얼로그·표의 행) 안 요소를 편집하면 **before 이미지는 컨테이너까지 확장돼 찍히는데 after 이미지는 요소 bbox로만** 찍혔다. 에러도 stale 표시도 없어서 두 이미지의 크롭 범위가 다르다는 것 말고는 단서가 없었다.
- **근본 원인**: 디바이스 래퍼를 확장 허용 원점에 넣으면서(`allowsContextExpansion() = window === window.top || isDeviceFrame()`) **비-top 프레임도 확장 판정을 돌리게 됐는데**, 비-top 응답 조립부인 `picker.ts:respondWithTopRect`가 응답 필드를 하나씩 골라 옮겨 담는 구조라 `contextSelector`가 그 목록에 없어 떨어졌다. 그 함수 바로 위 주석이 **"iframe은 확장 판정을 하지 않으므로 contextSelector는 항상 null"** 이라고 전제를 못 박고 있었고, 그 전제는 이번 기능으로 이미 거짓이었다. 유실된 `null`은 다음 문에서 뜻이 뒤집힌다 — `resolveExpandRequest`가 `contextSelector == null`을 "판정했고 **거부**함"으로 읽어 after에 `expandContext: false`를 실어 보내고, 이상 감지를 맡는 `sameCaptureBasis`는 before·after 양쪽이 `null`이라 "같은 기준"으로 통과시킨다. **셋이 겹쳐 완전 무증상이 됐다.** 같은 불변식("before/after는 같은 기준을 쓴다")이 뚫린 게 이번이 세 번째 문이다 — 2026-07-29는 `?? undefined` 변환이었고, 그때 남긴 재발방지가 "기준을 **읽는** 경로를 전수로 세라(`grep expandContext`)"였는데 이번엔 기준을 **실어 보내는** 경로에서 샜다. 더해서 `docs/ARCHITECTURE.md`가 바로 그 안티패턴을 요구사항으로 적어두고 있었다 — "`respondWithTopRect`의 조립 3분기는 `scrollX`/`scrollY`를 각각 명시적으로 실어야 한다". 문서가 "필드를 손으로 나열하라"고 지시하는 한 다음 필드도 같은 자리에서 샌다.
- **재발 방지**: (1) **메시지 응답을 재조립할 땐 필드를 골라 담지 말고 `{...prep}`로 펼치고 바꿀 것만 덮어쓴다.** 골라 담는 조립은 "지금 존재하는 필드 목록"을 코드에 굳혀서, 나중에 늘어난 필드가 타입 에러 없이 사라진다. 전수 대상: `grep -n "sendResponse({ " src/content/*.ts` — 리터럴을 새로 만드는 지점이 곧 유실 후보다. (2) **선택적 필드(`?:`)가 "값 없음"이 아니라 *의미*를 실어 나르면 optional을 걷어낸다.** `PrepareCaptureResponse.contextSelector`를 `string | null` 필수로 바꾸자 유실 지점 5곳이 컴파일 타임에 한 번에 드러났다(3곳이 실제 버그, 2곳은 암묵적 `undefined`). `null`과 `undefined`가 다른 것을 뜻하는 필드는 optional로 두지 않는다 — 2026-07-29의 `?? undefined` 항목과 같은 뿌리다. (3) **"X는 항상 Y다"라고 못 박은 주석 옆에서 X의 전제를 넓히는 변경을 하면 그 주석을 grep해 함께 뒤집는다.** 이번 전제 확장은 `allowsContextExpansion` 하나였고 `grep -rn "window === window.top" src/content/`가 그 전수 목록이었다. (4) **무증상 회귀에 그물을 심었으면 픽스를 되돌려 red를 실측한다.** 종횡비 단언을 넣고 `respondWithTopRect`를 버그 버전으로 되돌리자 `before`는 통과하고 `after`만 실패했다 — 그 서명이 나와야 그 단언이 이 버그를 잡는다는 게 증명된다(안 하면 픽스와 무관하게 늘 green인 단언을 심고 안심하게 된다).
- **관련**: `src/content/picker.ts:respondWithTopRect`(조립 3분기)·`handlePrepareCapture`, `src/content/device-frame.ts:allowsContextExpansion`, `src/types/picker.ts:PrepareCaptureResponse`(optional→필수), 뜻이 뒤집히는 지점 `src/sidepanel/lib/capture-basis.ts:resolveExpandRequest`·`sameCaptureBasis`, 그물 `e2e/device-viewport.spec.ts`("컨테이너 확장 기준이 before·after 양쪽에 똑같이 걸린다") + 공용 판정 `e2e/fixtures/capture-aspect.ts`, 선행 회고 `2026-07-29 — ?? undefined가 …`.

## 2026-08-07 — 스킬이 시킨 문서 갱신을 건너뛰자, 다음 세션이 "그물이 없다"고 오판할 근거가 남았다

- **영역**: `e2e`
- **계열**: `드리프트`
- **그물**: `없음`
> 사례로 든 spec은 2026-08-08 드랍된 디바이스 뷰포트의 것이다(`archive/device-viewport`). **재발 방지의 개수 대조는 spec 전반에 그대로 적용된다.**

- **증상**: `e2e/COVERAGE.md`(커버리지 맵의 단일 출처)에 그때 막 추가된 spec 행이 **통째로 없었다**. spec 파일 345줄·9 테스트는 이미 커밋돼 있었는데도 문서상으로는 그 기능에 e2e가 0건인 것으로 읽혔다.
- **근본 원인**: 직전 `/e2e-write` 실행이 6단계(README·COVERAGE·GOTCHAS 갱신)를 건너뛰고 spec만 커밋했다(`dd717016`의 diff는 `device-viewport.spec.ts` + `fixtures/extension.ts` 둘뿐). 스킬 절차에 명시돼 있어도 **실행이 그 단계를 빼먹으면 남는 흔적이 없다** — 테스트는 green이고 CI도 통과하므로 어떤 게이트도 안 걸린다. 비용은 나중에 나온다: 이번 라운드에서 "이 회귀를 잡는 e2e가 있나"를 판단할 때 COVERAGE.md가 근거가 못 돼 spec 본문을 직접 읽어야 했고, 없었다면 중복 spec을 새로 썼을 것이다. 문서를 **쓰기만 하고 안 읽으면 죽은 로그**라는 POSTMORTEM 소환 회로의 거울상이다 — 여기선 **읽히긴 하는데 안 쓰여서** 죽었다.
- **재발 방지**: **spec 파일 수와 COVERAGE.md 행 수를 기계적으로 대조한다** — `ls e2e/*.spec.ts e2e/logview/*.spec.ts | wc -l` vs `grep -c '^| \`.*\.spec\.ts\`' e2e/COVERAGE.md`. 두 수가 갈리면 맵에 안 올라간 spec이 있다는 뜻이고, 이건 사람이 기억할 게 아니라 `/e2e-write` 6단계에서 돌릴 한 줄이다(장기적으론 `pnpm check:e2e-coverage` 같은 스크립트가 제자리다 — 현재 없음). 같은 형태의 다른 단일 출처(`docs/DIRECTORY.md`의 파일 목록, `guide/AUTHORING.md`의 페이지 수)도 "산출물 개수 ↔ 문서 행 개수" 대조가 가능한 축이다.
- **관련**: `e2e/COVERAGE.md`(누락된 단일 출처), `e2e/device-viewport.spec.ts`(누락 대상), `.claude/commands/e2e-write.md` 6단계(건너뛴 절차), 커밋 `dd717016`.

## 2026-08-06 — 테스트 중복을 지우다 기대값을 SUT가 계산하게 만들어, 그물이 항진명제가 됐다

- **영역**: `background`
- **계열**: `미검증단언`
- **그물**: `unit`
- **증상**: 사용자에게 보이는 회귀가 아니라 **그물이 조용히 빈 것**이다. `classifyConnectReason`을 `err.reason === "token_exchange_rejected" ? "other" : err.reason`로 망가뜨려도 `src/background` 432 테스트가 **전부 통과**했다. 같은 뮤테이션이 한 커밋 전에는 red였다. 즉 테스트 정리 커밋 하나가 오분류 검출력을 잃게 만들었고, `pnpm test`는 그 전후 모두 green이라 diff만 봐선 알 수 없었다.
- **근본 원인**: `/code-review`가 "`result ↔ reason` 정합성 표의 `classifyConnectReason` 단언이 앞 describe와 중복"이라 지적했고, 그 지적을 `it.each(cases.map(err => ({ err, label: classifyConnectReason(err) })))`로 해소했다 — 기대 라벨을 **검증 대상 함수가** 만들게 한 것이다. 그러면 오분류가 기대값에도 똑같이 반영돼 단언이 항진명제가 된다. 부수 피해로 **테스트 이름 자체가 뮤테이션에 따라 바뀌어** 실패는커녕 diff에도 안 남는다. 더 근본은 지적의 대상과 처방의 대상이 어긋난 것이다: 중복의 실체는 "앞 describe와 겹치는 **케이스**"였는데 "겹치는 **단언 줄**"을 지웠다. 둘 다 green이라 어긋남이 드러나지 않았고, 리뷰 지적을 가장 값싼 방법으로 닫은 게 그대로 통과했다.
- **재발 방지**: (1) **테스트 기대값은 리터럴로 박는다.** `expect(f(x)).toBe(g(x))`에서 `g`가 `f`를 경유하면 그 단언은 죽은 것이다 — `it.each` 라벨·`toEqual` 우변·픽스처 생성 전부 포함. `grep -rn 'it\.each(.*\.map(' src/`로 파생 테이블을 훑고, 각각 기대값이 SUT를 타는지 확인한다. (2) **테스트를 간결하게 만드는 리팩터는 코드 리팩터보다 위험하다** — 코드는 테스트가 지키지만 테스트를 지키는 건 뮤테이션뿐이다. 그물 파일을 건드리는 커밋은 전후 뮤테이션 비교 없이 통과시키지 않는다. (3) 리뷰가 "중복"을 지적하면 **케이스 중복인지 단언 중복인지 먼저 특정한다** — 처방이 정반대다(전자는 행을 지우고, 후자는 대개 지우면 안 된다).
- **관련**: `src/background/__tests__/connect-tracking.test.ts`("result ↔ reason 정합성 불변식" describe — 리터럴 표로 복원), `src/background/connect-tracking.ts:classifyConnectReason`, 커밋 `4ff0413`. 검출은 `/refactor` 6단계 codehealth 에이전트가 사본 워크트리에서 돌린 뮤테이션 실측(메인 스레드는 green만 보고 넘어갈 뻔했다).

## 2026-08-06 — 그물을 그것이 지킬 코드와 같은 시점에 쓰면 같은 맹점을 물려받는다 (빈 그물 3연속)

- **영역**: `background`
- **계열**: `미검증단언`
- **그물**: `unit`
- **증상**: 셋 다 사용자 노출 회귀가 아니라 **그물이 비어 있던 것**이고, 전부 `pnpm test` green 상태에서 뮤테이션으로만 드러났다. ① `platform_connect`의 `reason` 태깅을 slack 토큰 교환에서 삭제해도 4856 테스트가 전부 통과 ② 호출부를 `cancelled:` 명시에서 shorthand `cancelled,`로 바꾸자 원문 스캐너의 필터가 0건 매칭이 됐는데 **파일별 단언이 vacuous pass** ③ 뒤늦게 추가한 `profile_fetch_failed` 태깅 3곳이 스캐너 레인 밖이라 통째로 무커버.
- **근본 원인**: 그물을 대상 코드와 **같은 세션·같은 가정으로** 썼다. 코드에서 놓친 실패 레인은 테스트에서도 똑같이 놓친다 — 같은 머리가 같은 전제로 두 번 쓰기 때문이다. 특히 원문 스캔 그물은 "지금 내가 아는 레인"만 정규식에 담게 되어, **레인 발견이 아직 진행 중일 때는 구조적으로 뒤처진다**(이번엔 3라운드에 걸쳐 3레인 → 5레인으로 늘었고 그때마다 스캐너가 한 발 늦었다). ②는 그 위에 겹친 별개 함정이다: 파일별 `toBeGreaterThan(0)`은 **그 파일에 지점이 있을 때만** 비공허성을 보장하고, 필터가 통째로 빗나가면 0건이 되어 루프가 안 돌아 통과한다. 2026-07-30 항목의 재발방지 (4)("그물의 비공허성을 뮤테이션으로 증명한다")를 **지침으로 들고 착수했는데도** 세 번 걸렸는데, 그걸 "마지막에 한 번 검증"으로 읽은 게 원인이다.
- **재발 방지**: (1) **뮤테이션은 커밋 단위가 아니라 그물 단위다.** 그물을 작성한 직후, 다음 코드로 넘어가기 전에 그 그물이 지킨다고 주장하는 지점마다 1회 돌린다. 마지막에 몰아서 하면 이번처럼 라운드마다 새 구멍이 생긴다. (2) **파일별 비공허성 단언만으로는 부족하다** — 레인 보유 파일 집합을 `toEqual`로 고정하거나 총합 하한을 함께 건다. 이번에 shorthand 전환을 잡은 건 정확히 총합 단언이었고, 파일별 단언은 전부 green이었다. (3) **원문 스캔 그물은 레인이 확정된 뒤에 쓴다.** 발견이 진행 중이면 스캐너가 아니라 인벤토리 표(어느 파일이 어떤 실패 레인을 갖는지)를 먼저 만든다 — 스캐너는 확정된 목록을 잠그는 도구이지 목록을 찾는 도구가 아니다. (4) 뮤테이션 복원에 `git checkout --`을 쓰지 않는다 — 미커밋 구현이 함께 날아간다(이번에 3파일 유실, `cp` 백업으로 전환).
- **관련**: `src/background/__tests__/connect-reason-coverage.test.ts`(5레인 원문 스캐너 — HTTP·grant·redirect·`!redirect`·프로필조회), `src/background/oauth/errors.ts`(`ConnectReason`·`httpReason`·`grantRejection`·`authorizeRejection`), `src/background/connect-tracking.ts:classifyConnectReason`, 커밋 `f7845b3`·`4ff0413`. 선행 회고는 2026-07-30 항목(같은 `platform_connect` 집계 자리).

## 2026-08-06 — modal Dialog는 자기 자신이 pointer-events 기준선이라, 위에 쌓인 팝오버가 dim 클릭을 막아주지 않는다

- **영역**: `컴포넌트`, `lib`
- **계열**: `라이브러리전제`, `미검증단언`
- **그물**: `jsdom`
- **증상**: 이슈 제출 다이얼로그에서 프로젝트·담당자 콤보박스를 열어두고 **콤보박스만 닫으려고** dim 영역을 클릭하면 다이얼로그가 통째로 닫혔다. 골라둔 필드가 날아간다. 같은 상황에서 **Escape는 정상**(콤보박스만 닫힘)이라 포인터와 키보드 두 축이 어긋나 있었는데, 어긋남 자체가 눈에 안 띄어 "dim은 원래 닫는 자리"로 넘어가기 쉬웠다.
- **근본 원인**: Radix `DismissableLayer`는 outside pointerdown을 **스택 최상단에만 보내지 않는다**. `isPointerEventsEnabled = index >= highestLayerWithOutsidePointerEventsDisabledIndex`(`react-dismissable-layer/dist/index.mjs:42`)인데 그 `highest`의 주인이 modal Dialog 자신이므로 **Dialog도 `>=`를 만족**한다. 그래서 dim 클릭 한 번이 non-modal Popover와 Dialog 양쪽의 dismiss 조건을 동시에 충족한다. Escape가 멀쩡했던 건 같은 파일 60행이 `isHighestLayer`(`index === layers.size - 1`)로 **최상단만** dismiss하기 때문 — **두 축이 서로 다른 판정 규칙을 쓴다.** "Escape가 되니 dim도 같은 규칙이겠지"가 정확히 틀린 지점이다.
- **부수 함정(픽스가 남길 뻔한 것)**: 첫 구현은 "열린 마커 레이어가 있으면 막는다"로 끝냈는데, 그건 Dialog **아래** 깔린 레이어까지 셌다. 그런 레이어는 `isPointerEventsEnabled=false`라 **자기 outside 이벤트조차 못 받아 스스로 닫히지도 못하고**, 결과적으로 dim 클릭이 다이얼로그 수명 내내 죽는다(Esc·X만 유효). "현재 도달 경로가 없다"고 판단해 이 전제를 **주석으로 적고 넘어갔던 것**을 `/code-review`가 "주석보다 한 단계 더 나쁘다"로 잡았다. Radix가 하위 레이어에 인라인 `pointerEvents:"none"`을 거는 것(같은 파일 104행)이 값싼 판별자였고, 한 줄로 latent 자체가 사라졌다.
- **재발 방지**: (1) **2026-07-22 회고의 "이 부류는 jsdom·순수 테스트로 안 잡힌다 — e2e/수동이 유일한 그물"은 pointer 축에 한해 틀렸다.** jsdom에 `window.PointerEvent`가 실재해 `fireEvent.pointerDown`이 `Event`로 폴백하지 않고(`@testing-library/dom` `events.js:56` `window[EventType] || window.Event`), `DismissableLayerContext`가 Provider 없는 **모듈 싱글턴**이라 Dialog와 Popover가 같은 `layers` 배열에 들어간다 — 결함 메커니즘이 프로덕션 그대로 재현된다. **그 문구를 좁히지 않으면 다음에 jsdom 그물을 근거 없이 건너뛴다.** 다만 focus·레이아웃 축은 여전히 미검증이다. (2) **Radix 프리미티브를 감쌀 때 "outside 이벤트는 최상단만 받는다"를 전제하지 말 것** — `grep -n "isPointerEventsEnabled\|isHighestLayer" node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs`로 두 규칙을 직접 읽고 대조한다. 축마다 다르다. (3) **레이어 소유 판정은 포커스 위치가 아니라 그 레이어가 심은 DOM 마커로** — 2026-07-22·Escape 3판 회고와 같은 결론이 세 번째로 나왔다. (4) **"지금은 도달 불가"인 latent를 주석에 적고 넘어가지 말 것.** 판별자가 값싸면 제거가 정답이고, 특히 그 latent가 *한 번 걸리면 영구*인 종류면 더욱 그렇다. (5) 뮤턴트로 그물 비공허를 확인했다 — 마커 제거·가드 제거 → 통합 테스트 1·3 red, 가드를 항상 true로 → 정상 닫기 케이스 red, 소비처 병합 제거 → 3 red. **미커버로 남긴 것**: exit 애니메이션 중 `data-state="closed"` 잔존(jsdom은 즉시 언마운트라 합성 DOM 유닛만이 그물), 터치(`pointerType==="touch"` 지연 click)·우클릭 경로는 코드 독해만.
- **관련**: `src/lib/dismiss-guard.ts:hasOpenDismissLayer`(마커 + pointer-events 이중 판정), `src/components/ui/dialog.tsx:DialogContent`(`onPointerDownOutside` 소비처 병합 가드 — 모든 다이얼로그가 이 한 경로를 지난다), `src/components/ui/popover.tsx:PopoverContent`(`data-dismiss-layer` 마커, 소비처가 못 덮게 스프레드 뒤), 그물 `src/components/ui/__tests__/dialog-popover-dismiss.test.tsx`(Dialog×Popover 통합 3케이스)·`src/lib/__tests__/dismiss-guard.test.tsx`(합성 DOM 7케이스), 계약 정본 `docs/DESIGN.md` §6. 마커 불필요 확인: `AlertDialog`(Radix가 이미 outside preventDefault)·`Select`(`disableOutsidePointerEvents:true`)·`Tooltip`(`data-state`가 `delayed-open`/`instant-open`). 선행 회고: **2026-07-22**(같은 Dialog×오버레이 pointer 축 — 그쪽은 body-portal 비-Radix 오버레이라 마커가 없어 이 계약 **밖**이고 금지 규칙이 그대로 유효).

## 2026-08-06 — 필드를 고쳐 놓고 소비처 8곳을 안 바꿨다: 골든 스냅샷이 틀린 숫자를 봉인했고, UI는 3인데 이슈 본문만 1이었다

- **영역**: `어댑터`
- **계열**: `복제본`, `드리프트`
- **그물**: `unit`
- **증상**: 같은 `PUT /api/.../evaluation`이 400으로 **3번** 실패했는데 Jira·GitHub·Linear·Notion·Slack·Asana·ClickUp·GitLab로 나가는 이슈 본문에는 `네트워크: 7건 (에러 1건)`으로 찍혔다. 심각도가 축소돼 나갔다. 정작 사이드패널 로그 카드는 같은 로그에 **3건**을 표시하고 있었다 — 같은 숫자를 두 경로가 따로 파생해 갈라진 채로 굴러갔다.
- **근본 원인**: `NetworkLogSummary.errors[]`는 `method+path+status`로 dedup되고 `MAX_ERRORS=5`로 cap된 **표시용 샘플 목록**인데 본문 빌더가 그 `length`를 개수로 썼다. 통짜 카운트 `errorCount`는 **이미 존재했고 주석까지 `errors[]는 … 개수 표시엔 부적합`이라고 경고를 달아뒀는데**(`buildLogSummary.ts:24-25`) 소비처는 **한 곳도 전환되지 않았다** — `net.errorCount`를 읽는 본문 빌더가 0곳이었다. 필드를 추가하며 "다음에 쓰겠지"로 남긴 게 그대로 굳었다. 콘솔은 `con.errorCount`를 옳게 써서 **같은 함수 안에서 두 줄이 비대칭**이었는데도 눈에 안 띄었다. **더 나쁜 건 그물이 오답을 봉인하고 있었다는 것**이다: `bodyOutputGolden.test.ts`의 픽스처가 `errorCount: 3` + `errors: [1개]`로 **정확히 이 상황을 재현하도록** 만들어져 있었고, 골든 스냅샷 58장이 `errors=1`을 고정하고 있었다. 골든은 "올바른 출력"이 아니라 **"현재 출력"**을 고정한다 — 버그가 있는 채로 스냅샷을 뜨면 버그가 계약이 된다.
- **부수 함정(픽스가 만들 뻔한 2차 회귀)**: AI 메타 주석의 element 필드 게이트를 `captureMode !== "freeform"`에서 **데이터 존재 기준으로 "바꾸자"**, freeform 제외가 통째로 사라져 freeform 본문에 잔여 `selector`가 실리기 시작했다. 골든이 이걸 잡았다(diff에 `+ "selector": ...`가 떴다). 옳은 형태는 교체가 아니라 **AND로 얹기**(`captureMode !== "freeform" && (els.length > 0 || ctx.selector)`)였다 — 기존 게이트는 "freeform엔 직전 element 세션의 잔여가 남을 수 있다"는 별개 계약을 담고 있었는데, 새 조건이 그걸 대체할 수 있다고 가정한 게 오류다.
- **재발 방지**: (1) **"개수 표시엔 부적합" 같은 경고를 필드 주석에 다는 것으로 끝내지 말 것** — 주석은 소비처에서 안 보인다. 올바른 값을 반환하는 **함수를 export하고 그걸로만 접근**하게 만든다(`networkErrorCount`). 지금은 `grep -rn "net\.errors\.length" src/`가 `buildLogSummary.ts` 내부 1건이어야 참이다. (2) **필드를 추가하는 커밋에서 소비처 전환까지 같이 한다** — 안 하면 `grep`으로 "이 필드를 읽는 곳이 0곳"임이 드러날 때까지 아무도 모른다. 새 필드가 기존 필드의 **대체**라면 기존 필드 읽기를 그 커밋에서 0으로 만든다. (3) **골든 스냅샷을 새로 뜰 땐 픽스처가 의도적으로 심어둔 엣지케이스가 출력에 제대로 반영됐는지 눈으로 본다** — 픽스처에 `errorCount: 3`을 넣은 사람은 그걸 검증하려던 것인데, 골든이 `errors=1`을 받아 적었다. 골든 갱신(`-u`) 시 diff를 **줄 단위로 집계해** 의도한 변화만 있는지 확인하는 절차가 필요하다(이번엔 그 집계가 freeform 회귀도 같이 잡았다). (4) **같은 값을 두 표면이 각자 파생하면 대조 테스트로 묶는다** — 로그 카드(`logCardTypeCounts`)와 이슈 본문이 "에러 N건"을 따로 계산해 3 vs 1로 갈렸다. (5) **게이트 조건을 "바꿀" 때 기존 조건이 담고 있던 별개 계약이 있는지 먼저 묻는다** — 교체인지 AND인지. 계열: 2026-07-14 "본문 노출은 8곳에 동시 전파된다", 2026-06-21 "본문 빌더 8개가 전부 같은 게이트를 복제".
- **관련**: 단일 출처 `src/sidepanel/lib/buildLogSummary.ts:networkErrorCount`, 전환된 9개 호출부(`buildIssueMarkdown`[md+html 2곳]·`buildIssueAdf`·`buildMarkdownIssueBody`·`buildNotionIssueBody`·`buildLinearIssueBody`·`buildSlackBody`·`buildAsanaIssueBody`·`buildClickupIssueBody`), 두 번째 파생 표면 `src/sidepanel/components/logCardTypeCounts.ts`, 메타 게이트 `src/sidepanel/lib/buildIssueMarkdown.ts:buildMetaComment`, 그물 `src/sidepanel/lib/__tests__/buildLogSummary.test.ts`(헬퍼 유닛)·빌더 테스트 8종(4개는 네트워크 요약 단언이 아예 없어서 드리프트가 안 보였다)·`bodyOutputGolden.test.ts.snap`(58장 갱신).

## 2026-08-06 — 요약 표면이 상세를 흉내 냈는데, 그 상세가 원본보다 빈약했다 (`entry.stack` ≠ `entry.args`의 스택)

- **영역**: `컴포넌트`
- **계열**: `미검증단언`
- **그물**: `jsdom`
- **증상**: log-viewer 통합 타임라인의 콘솔 행에 스택 펼침 chevron이 있었는데, 펼치면 우측 콘솔 탭보다 **정보가 적었다**. 실제 리포트(`logs.html`)에서 `args`는 5프레임짜리 axios 에러 스택을 담고 있는데 펼침이 보여준 `stack`은 무관한 2프레임(`Object.R [as onError]` / `gf.execute`)뿐이었다. 게다가 펼친 `<pre>`가 행의 `onClick` 안에 있어 스택 텍스트를 드래그 선택하거나 안의 링크를 누르면 영상이 seek됐다.
- **근본 원인**: 두 겹이다. ① **`ConsoleEntry.stack`은 `args`의 부분집합이 아니다.** `console.error(err)`를 하면 레코더가 `err.stack`을 **args 문자열로 직렬화**하고, 별도 `stack` 필드에는 **로깅 호출 지점**의 스택이 들어간다 — 둘은 서로 다른 프레임 집합이다. "전용 `stack` 필드니까 args보다 상세하겠지"라는 암묵 전제가 틀렸고, 실데이터로 확인한 적이 없었다. ② **행의 역할 계약이 이미 두 곳에 있었는데 세 번째 지점이 어겼다.** `activateTimelineItem`(`App.tsx:137-141`)이 seek + `setActiveTab(kind)` + `setScrollToEntryId`를 발화해 **상세는 우측 탭이 담당한다**는 배선이 있었고, `guide/ko/logs/viewer.md:53,56`도 "한 줄에 한 이벤트 … 누르면 오른쪽이 그 종류의 로그 탭으로 전환되어 상세까지"라고 이미 **변경 후 동작을 기술**하고 있었다. 그런데 `TimelineRow`가 자체 상세를 또 들었다. **그리고 jsdom 테스트가 그 위반을 오히려 고정하고 있었다** — `expect(screen.getByTestId("timeline-row-expand")).toBeTruthy()`가 "chevron이 있어야 한다"를 계약으로 박아, 그물이 잡기는커녕 되돌리기를 막는 쪽으로 서 있었다.
- **재발 방지**: (1) **`entry.stack`과 `entry.args`를 서로의 대체재로 가정하지 말 것** — 한쪽만 렌더할 거면 실제 캡처본(`logs.html` 하나 열어 `__BUGSHOT_DATA__` 디코드)으로 두 값을 나란히 찍어보고 정한다. 지금 콘솔 탭(`ConsoleLogContent.tsx:250-260`)이 args pre + stack pre를 **둘 다** 보여주는 게 옳은 형태다. (2) **상세를 담당하는 표면이 이미 있으면 요약 표면에 상세를 복제하지 않는다** — 타임라인·마커·프리뷰처럼 "인덱스" 역할인 UI에 펼침을 넣기 전에, 클릭 핸들러가 이미 상세 표면으로 보내고 있는지 먼저 본다. (3) **UI가 `guide/`의 서술과 어긋나면 어느 쪽이 계약인지 먼저 정한다** — 여기선 가이드가 맞았고 코드가 틀렸다. 가이드는 스펙의 사후 기록이 아니라 이미 합의된 계약일 수 있다. (4) **클릭 가능한 컨테이너 안에 텍스트 선택이 필요한 블록(`<pre>`·코드·스택)을 넣지 않는다** — 넣어야 하면 그 블록에서 `stopPropagation`.
- **관련**: `src/log-viewer/components/TimelineRow.tsx`(아코디언 제거), 그물 `src/log-viewer/components/__tests__/TimelineRow.test.tsx`(계약을 "확장 UI 없음"으로 반전), 상세 담당 `src/sidepanel/components/ConsoleLogContent.tsx:250-260`, 배선 `src/log-viewer/App.tsx:137-141`, 계약 서술 `guide/ko/logs/viewer.md:53,56`.

## 2026-08-04 — 오버레이 Escape는 "누가 처리하나"와 "누가 못 받게 하나"가 다른 판정인데 한 조건으로 묶었고, 두 번 뒤집혔다

- **영역**: `컴포넌트`, `에디터`
- **계열**: `라이브러리전제`, `미검증단언`
- **그물**: `jsdom`
- **증상**: (구현 중 `/code-review`·CTO 게이트가 잡음 — 미출시) diff table 이미지 주석을 위해 `AnnotationOverlay`에 Escape 취소를 얹는 과정에서 같은 핸들러가 **세 번 다른 얼굴로 틀렸다**. ① 첫 판: window **버블**에 달아 부모 `DraftEditDialog`가 함께 닫혔다. ② capture로 옮기고 "오버레이 루트 밖이 target이면 비킨다"로 줌 Select를 피하려 했더니, **연 직후 포커스가 아직 트리거 버튼(루트 밖)이라 Escape가 통째로 죽었다** — 캔버스를 한 번 클릭해 activeElement가 body가 된 뒤에야 동작. ③ popper 판정으로 고친 뒤 `isComposing`·`completing` guard를 추가했는데 그 둘을 `stopPropagation` **앞**에 둬, 우리가 처리하지 않는 Escape가 부모 Dialog까지 올라갔다(②의 재발).
- **근본 원인**: Escape 하나에 **서로 다른 세 판정**이 겹쳐 있는데 조건 하나로 뭉갰다 — (a) *누가 처리하나*(오버레이 vs 열린 Radix 레이어), (b) *누가 못 받게 하나*(부모 DismissableLayer는 언제나 차단), (c) *지금 처리할 상태인가*(IME 조합 중·완료 rAF 대기 중). (b)는 (a)가 "내 몫이 아니다"라고 답한 경우를 **제외한 전부**에 걸리고 (c)와 무관한데, 코드에선 (c)의 early-return이 (b)보다 앞서면 (b)가 통째로 건너뛰어진다. 게다가 (a)를 "포커스 위치"로 근사한 게 ②였다 — 오버레이는 초기 포커스를 가져가지 않으므로 **"루트 밖"과 "다른 레이어가 소유"는 같은 말이 아니다**. Radix `useEscapeKeydown`이 `document` **capture**에 붙고 `event.key`만 보며(`isComposing` 미검사) `DismissableLayer`가 `isHighestLayer`만 dismiss한다는 세 전제를 실측 없이 뭉뚱그린 것이 ①③의 공통 뿌리다.
- **재발 방지**: (1) **풀스크린 비-Radix 오버레이에 Escape를 달 땐 순서를 고정한다** — ⓐ 열린 팝퍼 레이어 판정(`target.closest("[data-radix-popper-content-wrapper]")`) → 비킴, ⓑ `stopPropagation()`(무조건), ⓒ 상태 guard(`isComposing`·처리 중) → return, ⓓ `preventDefault()` + 실제 처리. **ⓑ가 ⓒ보다 뒤로 가면 부모가 닫힌다.** grep: `grep -rn 'keydown.*true)' src/sidepanel/components`로 capture 리스너를 찾아 이 순서를 대조. (2) **"레이어 소유"를 포커스 위치로 근사하지 말 것** — 오버레이가 초기 포커스를 가져가지 않으면 activeElement는 여전히 트리거다. 소유 판정은 그 레이어의 DOM 마커로 한다. (3) **jsdom으로 고정 가능하다** — `loadImage`를 영원히 pending으로 모킹하면 Konva가 안 뜬 채 껍데기만 렌더돼 role/aria-label·Escape 라우팅·전파 차단·포커스 복귀를 전부 잴 수 있다(`AnnotationOverlay.test.tsx`). 캔버스가 있다고 컴포넌트 전체를 e2e로 미루지 말 것. (4) 전파 차단 테스트는 **`document`에 capture 리스너를 걸고 미호출을 단언**해야 부모 Dialog 보호를 실증한다 — `onCancel` 호출 여부만 보면 ③이 green으로 통과한다.
- **관련**: `src/sidepanel/components/AnnotationOverlay.tsx`(Escape capture 핸들러 ⓐ~ⓓ 순서·`completing`·포커스 복귀), 그물 `src/sidepanel/components/__tests__/AnnotationOverlay.test.tsx`("우리가 처리하지 않는 Escape(IME 조합 중)도 전파는 막는다"가 ③ 전용), 호스트 `src/sidepanel/tabs/DraftingPanel.tsx`(비-modal)·`src/sidepanel/components/TiptapEditor.tsx`→`DraftEditDialog`(Radix modal). 선행 회고: **2026-07-22**(같은 오버레이×다이얼로그 조합의 pointer 축).

## 2026-08-04 — 값 비교 폐기 규율이 `null → null`을 "안 바뀜"으로 읽었고, 그 구멍을 막던 게 호출 순서라는 우연이었다

- **영역**: `store`
- **계열**: `미검증단언`
- **그물**: `unit`
- **증상**: (구현 중 `/code-review`가 잡음 — 미출시) diff table의 after 주석은 after가 재캡처되면 버려야 하는데(옛 좌표가 새 픽셀 위에서 엉뚱한 곳을 가리키면 주석이 없는 것보다 나쁘다), `backToStyling`으로 styling에 돌아갔다가 기준이 갈려 `setAfterImage(null)`이 다시 오는 경로에서 **짝 없는 주석본이 살아남아 after 칸에 옛 주석이 부활하고 그대로 제출**될 수 있었다. 게다가 그 사이 구간 내내 수 MB 주석본이 세션 스냅샷에 실렸다.
- **근본 원인**: 폐기 조건을 `next !== prev` **하나**로 통일한 게 설계 의도였는데(지점을 열거하면 `rebindStylingSession`의 복원 왕복까지 폐기돼 버린다), `null → null`이 그 술어에서 "안 바뀜"으로 떨어진다. **`null` 커밋은 "값이 같다"가 아니라 "after를 버린다"는 뜻**이라 의미가 정반대인데 술어가 그걸 구별하지 못했다. 더 나쁜 건 이게 **부활까지 가지 않은 이유가 코드가 아니라 호출 순서**였다는 점 — styling→drafting의 유일 통로인 `handleNext`가 dirty 체크 없이 항상 `setAfterImage`를 부르는 덕에 우연히 덮였다. "diff 0건이면 after 캡처 스킵" 류의 최적화가 하나만 들어와도 되살아난다. 설계 문서(`design.md`)도 `backToStyling`을 "별도 규칙 불요"로 명시해 **틀린 근거가 문서에 박혀 있었다**.
- **재발 방지**: (1) **값 비교 폐기 술어에 sentinel(`null`·`""`)이 들어올 수 있으면 "같다"의 의미를 먼저 나눈다** — `keepsAnnotation(next, prev) = next !== null && next === prev`처럼 **보존 쪽을 좁게** 쓴다(폐기가 기본, 보존이 예외). `grep -rn '!== s\.\|=== s\.' src/store`로 store의 값 비교 게이트를 훑어 sentinel 취급을 대조. (2) **"이 경로는 다른 호출이 덮어 준다"는 근거로 규율에서 빼지 말 것** — 덮는 쪽이 조건부가 되는 순간 조용히 깨지고, 그 사이 구간의 잔여 상태(여기선 세션 쿼터)는 그때도 실재한다. 상태를 버리는 액션이 그 짝도 같은 `set()`에서 버린다. (3) **store 액션을 우회하는 직접 `setState`를 전수한다** — `grep -rn 'useEditorStore.setState' src/`로 훑어 새 필드를 청소 목록에 넣는다(`picker-control.ts`의 두 곳이 이번에 빠져 있었다). (4) 폐기 규율은 **과잉·과소를 양쪽에서** 고정한다 — "다른 값이면 버린다"와 "같은 값이면 보존한다"를 쌍으로 두고, sentinel 케이스를 별도 케이스로 추가.
- **관련**: `src/store/editor-store.ts`(`keepsAnnotation` 단일 출처·`backToStyling`·`setAfterImage`·`patchBufferedElement`·`bufferCurrentElement`), `src/sidepanel/picker-control.ts`(`releaseDetachedSelection`·`expireStylingSession` 직접 setState), 그물 `src/store/__tests__/editor-store.test.ts`(null 커밋 3케이스), 문서 `docs/ARCHITECTURE.md` "편집 세션 영속화".

## 2026-08-04 — `userEvent.tab()`은 focusout/focusin을 한 배치로 묶어, 그 가드를 지워도 green인 테스트를 만든다

- **영역**: `컴포넌트`, `e2e`
- **계열**: `라이브러리전제`, `미검증단언`
- **그물**: `jsdom`
- **증상**: (구현 중 `/code-review`가 잡음 — 미출시) hover/focus로만 뜨는 액션 그룹에서 **카드→자식 버튼으로 Tab해 들어가는 순간 그룹이 언마운트**되는 버그를 `relatedTarget` 가드로 고치고 `userEvent.tab()` 두 번으로 테스트를 박았는데, **가드를 지워도 그 테스트가 통과**했다. 같은 파일의 다른 테스트("제거해도 남은 버튼이 보인다")는 두 플래그(hovered/focused) 분리를 검증한다고 적혀 있었지만 `focused` state를 통째로 지워도 green이었다.
- **근본 원인**: 두 개의 서로 다른 라이브러리·DOM 전제를 실측 없이 믿었다. ① **`userEvent.tab()`은 스크립트에서 `.focus()`를 호출**하므로 focusout과 focusin이 한 태스크에 묶여 React act 큐에서 배치된다 → `setFocused(false)` → `setFocused(true)` 순으로 **최종값이 true로 수렴**해 가드 유무가 결과에 안 나타난다(실제 브라우저는 네이티브 focusout 리스너 반환 직후 microtask checkpoint가 돌아 React가 먼저 flush → 버튼이 언마운트된다). ② **포커스된 요소가 DOM에서 제거될 때 focusout은 발화하지 않는다** — "제거 버튼이 사라지면 포커스가 body로 빠지고 focusout이 온다"는 전제 자체가 거짓이라, 그 경로로는 두 플래그가 애초에 갈리지 않았고 근거 주석까지 틀려 있었다.
- **재발 방지**: (1) **포커스 이동 가드는 `fireEvent.focusOut(el, { relatedTarget })`로 단독 dispatch해 검증한다** — `userEvent.tab()`은 이동 *결과*를 보기엔 좋지만 이동 *중간의 이벤트 순서*에 걸린 로직은 못 잰다. (2) **새 테스트는 "구현을 되돌리면 red인가"를 실제로 돌려 확인한다** — 특히 조건부 렌더·포커스·타이밍 가드처럼 상태가 수렴해 버리는 축은 통과가 아무것도 증명하지 않을 수 있다. `grep -rn 'userEvent.tab()' src/**/__tests__`로 같은 계열을 훑는다. (3) **DOM 이벤트 전제는 주석에 쓰기 전에 재현해 본다** — "요소가 제거되면 blur가 온다" 같은 상식은 틀린다. 틀린 근거 주석은 다음 사람이 그 축을 다시 안 보게 만들어 버그보다 오래 산다.
- **관련**: `src/sidepanel/components/StyleChangesTable.tsx`(`SnapshotCell`의 hovered/focused 분리 + `relatedTarget` 가드 + 제거 후 카드 포커스 복귀), 그물 `src/sidepanel/components/__tests__/StyleChangesTable.test.tsx`(focusOut 단독 dispatch 2케이스).

## 2026-08-03 — 전파 축을 막은 회고가 hit-test 축을 "같이 막혔다"로 읽혔다 — blocker가 물러나는 두 순간에 hover가 스냅샷으로 굳었다

- **영역**: `content`, `e2e`
- **계열**: `라이브러리전제`, `미검증단언`
- **그물**: `e2e`
- **증상**: element picking 중엔 페이지 hover가 안 뜨는데, **요소를 선택 커밋하는 순간** 커서 밑 요소가 hover 상태로 켜지고 그게 before/after 스냅샷에 그대로 찍혔다. "가끔"이라 오래 안 잡혔다 — 요소에 hover 규칙이 있고 캡처가 그 창에 떨어져야 보인다.
- **근본 원인**: 2026-08-01 회고가 hover를 **전파 축**(document 위임 핸들러)과 **hit-test 축**(CSS `:hover`) 둘로 갈라 놓고 전파 축을 닫았는데, hit-test 축의 방어는 **blocker가 서 있는 동안에만** 유효하다는 조건이 어디에도 안 적혔다. blocker가 물러나는 순간이 둘이다: `setMode("selected")`의 `display:none`, 그리고 `beginCapturePrep`의 `hostEl.style.visibility = "hidden"`. 후자가 더 나쁘다 — **캡처를 깨끗이 찍으려고 오버레이를 숨기는 그 동작이 곧 hit target 포기**라서, 정작 셔터가 열리는 순간에 방어가 0이다(`visibility:hidden`은 그리지 않을 뿐 아니라 hit-test 대상에서도 빠진다). 커밋과 캡처 사이엔 사이드패널 왕복(`picker.selected` → `prepareCapture`)이 끼어 수십~수백 ms가 비고, 그 동안 커서는 방금 클릭한 요소 위에 그대로 있다.
- **픽스가 만든 2차 노출**: 투명 방패를 세우자 **hit-test 프로브가 blocker만 비켜세운다**는 사실이 결함이 됐다 — `withBlockerHitTest`가 blocker의 `pointer-events`만 내리므로 `elementFromPoint`가 방패(=우리 host)를 돌려주고, 호출부는 그걸 `isOwnUi`로 읽어 조기 return한다. **에러도 로그도 없이 picking이 죽는다**(아웃라인도 안 뜨고 클릭도 안 먹는다). 같은 shadow root의 hit target을 컨트롤러 둘이 나눠 갖기 시작하면, 한쪽만 아는 프로브·모드 전환이 전부 결함 후보가 된다.
- **재발 방지**: (1) **"덮었다"의 유효 조건을 덮개의 수명으로 적어라** — 회고가 축을 갈라 놓아도 각 축의 방어가 *언제* 유효한지 안 적으면 다음 사람은 "그 축은 닫혔다"로 읽는다. 전수: `grep -n 'visibility = "hidden"\|style.display = "none"' src/content/*.ts`로 **우리 UI를 숨기는 자리**를 뽑고, 그 자리마다 "숨기는 동안 hit target을 누가 갖나"를 답한다. 숨김은 곧 hit target 양보다. (2) **hit-test를 나눠 갖는 레이어가 둘이 되면 프로브·모드 전환을 전수한다** — `grep -n 'elementFromPoint' src/content`로 프로브를, `grep -n 'setBlockerVisible' src/content/picker.ts`로 모드 전환을 세고 **두 컨트롤러를 모두 아는지** 확인한다. 여기선 프로브(`withBlockerHitTest`)와 `setBlockerVisible(true)` 둘이 서로 이중 방어라 **개별 격리 테스트가 원리적으로 불가**하다 — 뮤턴트도 둘을 동시에 지워야 red가 된다(그 사실을 `e2e/COVERAGE.md`에 적어 "이 테스트가 저 가드를 문다"는 오해를 막았다). (3) **자가치유 타이머가 있는 축은 재시도 헬퍼와 조합하면 조용히 공허해진다** — 방패의 1.5s 만료 폴백과 `pickElement`의 15s 클릭 재시도가 만나 회귀를 **테스트가 대신 복구**했다(정상 0.5s / 회귀 3.0s, 둘 다 pass). 남는 흔적이 소요 시간뿐이라 단언으로 안 잡힌다. 판정을 **만료보다 짧은 창**의 다른 신호로 옮긴다. (4) **커밋 직후처럼 "사이드패널 왕복 사이"의 상태는 폴링으로 못 잡는다** — `ext.evalInExt`로 `picker.prepareCapture`/`endCapture`를 직접 보내 그 상태를 만들고, 반대 방향(캡처가 영영 안 오는 경로)은 패널의 `chrome.tabs.sendMessage` 스파이로 만든다. **대조군(방패가 내려간 평시엔 `:hover`가 성립)을 같은 테스트에 넣어야** 커서가 딴 데 있어서 통과하는 공허한 green이 안 된다. (5) 미커버로 남긴 것: `dialog.showModal()`의 **top layer는 방패·blocker 둘 다 위**라 그 안 요소는 여전히 `:hover`를 받는다(blocker와 같은 기존 수용 한계).
- **관련**: `src/content/hover-shield.ts`(신규 — 이유 집합 `selection-commit`/`capture-prep` + 만료 타이머 + `withHitTest`), `src/content/overlay.ts:createOverlay`(`.hover-shield` — `visibility:visible`로 host 숨김을 뚫는다)·`withBlockerHitTest`(두 레이어 동시 비켜세우기)·`setBlockerVisible`(blocker 복귀 시 방패 이유 비우기), `src/content/picker.ts:onClickCommit`·`beginCapturePrep`(인계)·`handleEndCapture`, 그물 `e2e/hover-shield.spec.ts`(뮤턴트 4종으로 red 확인) + `src/content/__tests__/hover-shield.test.ts`(이유 집합 — 뮤턴트 4종 kill 확인), 선행 회고 2026-08-01(전파 축).

## 2026-08-03 — 툴팁만 cross-origin을 안 기다렸고, 그 공백을 메우던 "값이 같으면 그 토큰"이 엉뚱한 토큰 이름을 확신 있게 보여줬다

- **영역**: `스타일해석`, `content`
- **계열**: `복제본`, `미검증단언`, `cross-origin`
- **그물**: `수동`
- **증상**: naver.com(cross-origin 시트)에서 로그인 버튼을 호버하면 툴팁 `bg-color`가 `#03A94D` hex인데, 같은 요소를 사이드패널 스타일 편집에서 보면 `--color-primary-background-default` 토큰이었다. 패널에서 **재선택한 뒤** 다시 호버하면 툴팁도 토큰으로 정상 출력 — "같은 요소, 같은 prop, 두 화면이 다른 답"이다. 같은 툴팁에 `color: --normal-bg`(초록 버튼 위 흰 글자색에 **배경** 토큰), `padding: 17px --toast-svg-margin-end`(상하만 리터럴), `radius: --toast-icon-margin-end`(radius에 **마진** 토큰)도 함께 찍혔다.
- **근본 원인**: 두 겹이다. ① `ensureCrossOriginLoaded()` 호출부가 저장소 전체에 셋뿐인데 **전부 선택·패널 경로**였다(`picker.ts`의 `collectTokens` 핸들러·`postSelectionUpdate`·`scheduleSelectionUpdate`). 호버 렌더는 `collectInspectorInfo`를 **동기로** 부르고 그 로드를 트리거하지도 기다리지도 않아, 선택을 한 번도 안 한 세션에서는 `getMatchingCrossOriginRules`가 빈 배열 → `refs`가 비고 → computed hex로 폴백했다. 재선택이 고친 게 아니라, 선택이 그제야 fetch를 깨운 것이다. ② 그 공백을 `buildTokenLookup`의 **값→이름 역참조**가 메우고 있었는데, 이건 `!map.has(key)` first-write-wins라 같은 값을 가진 토큰이 여럿이면 먼저 걸린 이름이 그 값을 독점한다. **2026-08-01 회고가 "값 일치는 선언 identity의 증명이 아니다 — 승자와 일치하는 후보가 정확히 하나일 때만 이름을 쓴다"를 이미 못박았지만, 그 교훈은 `substituteFromComputed`에만 적용되고 같은 파일의 이 함수는 그대로 남아 있었다.** 결정적으로 `matchToken`은 `firstVarName(refs)`가 실패했을 때만 발화하는데, 그 경우는 "author가 `var()`를 안 썼다"(→ 토큰 이름은 항상 거짓) 아니면 "refs가 비었다"(→ 그게 ①)뿐이라, **②는 ①의 우회책이었고 ①을 닫자 존재 이유를 잃었다**(순감 ~40줄).
- **재발 방지**: (1) **비동기 보강을 소비하는 화면이 둘이면 "둘 다 그 보강을 기다리는가"를 호출부 전수로 확인한다** — `grep -n 'ensureCrossOriginLoaded\|ensureCssCacheLoaded' src/content/picker.ts`로 세고, **호버·선택 두 진입점 모두에 있는지** 본다. 한쪽만 있으면 그 화면은 항상 폴백을 본다. 2026-08-01의 "화면 간 불일치는 경로가 갈렸다는 신호"의 **타이밍 판**이다 — 수집기가 같아도 *대기*가 갈리면 같은 증상이 난다. (2) **회고가 세운 규칙은 그 규칙이 적용될 수 있는 함수를 전수로 훑어 적용한다** — 이번엔 같은 파일 안에서조차 한 함수만 고쳐졌다. 값→이름 역참조를 새로 쓸 때 `grep -n 'normalizeForLookup' src/content/css-resolve.ts`로 identity 증명 없이 이름을 붙이는 자리가 또 생겼는지 본다. (3) **폴백이 상위 결함을 가리고 있는지 의심하라** — "이 폴백은 언제 발화하나"를 적어 보면 발화 조건 전체가 다른 버그의 증상일 수 있고, 그러면 폴백을 고칠 게 아니라 지워야 한다. (4) **외부 요청 트리거 시점이 당겨지면 privacy 문서를 갱신한다** — 전송 대상·성격이 그대로여도 *언제 나가는가*는 사용자 관측 대상이다(cross-origin 시트 fetch가 "첫 선택"에서 "picker 시작"으로 이동 → `docs/privacy.{ko,en}.md` 본문·시행일 갱신). manifest diff 0을 이유로 건너뛰지 말 것.
- **관련**: `src/content/picker.ts:scheduleInspectorRefresh`(구 `scheduleTokenBuild` — same-origin·cross-origin 2-phase 무효화+재렌더)·`render`(호버 분기), `src/content/css-resolve.ts:collectInspectorInfo`(`tokens` 파라미터 제거)·`resolveBoxLabel`·삭제된 `buildTokenLookup`/`matchToken`/`TokenLookup`(`normalizeForLookup`은 `sameResolvedValue`가 써서 잔존), 그물 `src/content/__tests__/inspector-refs.test.tsx`(시그니처 고정 + 값 충돌 픽스처에서 이름 미표시 — 내부 역참조 재도입 mutation으로 red 확인), 문서 `docs/privacy.{ko,en}.md`. **자동 그물 한계**: ①의 양성 종단은 e2e 불가 — `e2e/GOTCHAS.md`의 SSRF 가드 항목대로 loopback cross-origin 보강이 항상 inert라 naver 수동이 유일하다.

## 2026-08-03 — 판정을 정밀화하면 안전망이 함께 사라진다: opaque 문맥을 **열거**한 순간 "나머지는 안전하다"가 됐고, 그 목록은 다른 파일이 정하고 있었다

- **영역**: `스타일해석`, `content`, `e2e`
- **계열**: `미검증단언`, `라이브러리전제`
- **그물**: `e2e`
- **증상**: specificity 판정을 넣은 직후, ① 조건이 **거짓이라 적용도 안 된** `@container` 규칙의 값이 편집/CSS 뷰에 승자로 확정 표시됐다(종전엔 uncertain → computed 폴백이라 브라우저 진실이 보였다). ② Tailwind `2xl:`류 숫자 시작 클래스를 쓰는 페이지에서 그 규칙이 실제보다 높은 specificity로 계산돼, 동률이라 문서순으로 갈렸어야 할 승부를 가로챘다. 둘 다 **틀린 값을 자신 있게** 보여주는 방향이라 uncertain보다 나쁘다.
- **근본 원인**: 둘 다 "정밀화가 판정 불가의 범위를 좁힌다"는 성질에서 나왔다. ① `hasOpaqueCascadeContext`가 승자를 확정할 수 없는 문맥을 `@layer`/`@scope`로 **열거**했다. 열거는 자동으로 반대 전제를 만든다 — *나머지 그룹 규칙은 전부 투명(=조건이 참이라 경쟁 자격이 있다)*. 그런데 그 전제가 참인지는 이 파일이 아니라 **인덱서**(`css-source-cache.ts:walkRulesForIndex`)가 정한다: 거기서 조건을 실제로 평가하고 하강하는 건 `@media`·`@supports` **둘뿐**이고, `@container`·`@starting-style`은 `nested` 폴백으로 조건 무관하게 인덱싱된다. 즉 계약이 두 파일에 쪼개져 있는데 한쪽만 목록을 들고 있었다. ② `selectorSpecificity`의 토크나이저가 이스케이프를 `i += 2` 고정으로 소비했다. CSS 이스케이프는 hex 1–6자리 + **종결 whitespace 1개**까지가 한 시퀀스인데(그 공백은 구분자가 아니라 이스케이프의 일부다), 2문자만 먹으면 남은 hex와 종결 공백이 새어나와 뒤 ident가 **별개 type 셀렉터**로 한 번 더 세진다. 하필 Chrome CSSOM이 숫자로 시작하는 클래스를 정확히 그 형태로 직렬화한다(`2xl:mt-4` → `.\32 xl\:mt-4`) — 실서비스에서 흔한 입력이 곧장 이 경로를 탄다.
- **재발 방지**: (1) **"승자를 확정할 수 없는 경우"는 열거하지 말고 화이트리스트로 뒤집는다.** 모르는 입력의 기본값이 "안전(=판정 포기)"이어야, 다음 CSS at-rule이 추가돼도 구멍이 안 생긴다. 열거형 가드를 볼 때마다 "이 목록 밖은 정말 안전한가, 그 판단의 출처는 어디인가"를 묻는다. (2) **판정 정밀화 커밋은 안전망을 걷어내는 커밋이다** — 폴백(여기선 uncertain → computed)이 덮어주던 케이스가 이제 확정 표시로 나가므로, 좁힌 범위 전수가 픽스의 일부다. "정확도가 올라갔으니 나빠질 리 없다"가 정확히 틀리는 지점. (3) **계약이 두 파일에 쪼개졌으면 그 사실을 코드에 적고 대조를 grep으로 남긴다**: `grep -n 'TRANSPARENT_GROUP_RULES' src/content/css-resolve.ts`와 `grep -n 'CSSMediaRule\|CSSSupportsRule' src/content/css-source-cache.ts`의 **목록이 일치해야 한다**(인덱서가 조건 평가를 추가/제거하면 화이트리스트도 함께 움직인다). (4) **파서에서 `\`를 2문자로 소비하는 코드는 전부 의심한다** — `grep -n '"\\\\\\\\"' src/content/css-resolve.ts`로 이스케이프 처리가 `skipEscape` 단일 출처를 거치는지 본다(복제본이 생기면 한쪽만 고쳐진다). (5) **캐스케이드 판정을 색으로 검증하지 말 것** — CSSOM이 리터럴을 `rgb()`로 정규화하는 데다(raw 파서 경로는 값에 `var(`가 있을 때만 탄다) **computed가 곧 승자 값**이라, 판정이 죽어 computed 폴백으로 떨어져도 같은 문자열이 나와 테스트가 공허해진다. `12rem`(specified) vs `192px`(computed)처럼 **computed에서 표기가 바뀌는 축**을 쓴다. (6) mutation 검증 중 **분기를 들어내면 그 분기만 쓰던 상수가 미참조가 돼 `TS6133`으로 `build:e2e`가 죽고, 직전 `dist-e2e`로 실행돼 "이 mutation은 안 문다"로 읽힌다**(2026-07-31의 "테스트 파일도 함께 되돌려야" 함정과 같은 실패 모드, 다른 원인). 빌드 출력에 `built in`이 있는지 매번 확인한다.
- **관련**: `src/content/css-resolve.ts:hasOpaqueCascadeContext`(열거 → 화이트리스트 `TRANSPARENT_GROUP_RULES`)·`skipEscape`(신규 — hex 1–6자리 + 종결 whitespace, CRLF 1개)·`consumeIdent`·`selectorSpecificity`·`noteClaim`(verdict 반환), 계약 상대편 `src/content/css-source-cache.ts:walkRulesForIndex`(조건 평가 대상이 `@media`·`@supports`뿐), 그물 `e2e/style-specificity.spec.ts` + 픽스처 `e2e/fixtures/pages/specificity.html`(mutation 3종으로 각 테스트 red 확인), 단위 `src/content/__tests__/css-resolve.test.ts`, 문서 `docs/ARCHITECTURE.md`("CSSOM shorthand 한계 우회" — 남은 근사 2개 명시).

## 2026-08-01 — computed는 캐스케이드 승자지만 표기를 파괴한다 — 승자로 덮는 순간 디자인 토큰 이름이 사라졌고, 같은 요소의 두 화면이 서로를 반증했다

- **영역**: `스타일해석`
- **계열**: `라이브러리전제`, `복제본`
- **그물**: `unit`
- **증상**: 실사이트(course-chatbot)에서 `button.icon-btn`을 고르면 **피커 툴팁은 `--color-semantic-informative-label`·`--color-semantic-status-accent-*`를 정확히 보여주는데, 편집 탭과 CSS 뷰는 같은 값을 `#fff`·`#266bff40` 리터럴로** 표시했다. 토큰을 못 읽는 게 아니라 **화면마다 답이 달랐다**. `--_` 별칭을 경유하는 값(color·background-color·padding·radius)만 그랬고, `font-size: var(--font-size-16)`처럼 public 토큰을 직접 쓴 값은 멀쩡해서 "토큰 수집이 깨졌다"로 오진하기 쉬웠다.
- **근본 원인**: `hydrateReferencedCustomProps`가 수집한 원문을 **무조건 `getComputedStyle` 값으로 덮었다**(`customProps[name] = effective`). 그 덮어쓰기 자체는 정당했다 — `customProps` 수집은 first-write-wins(소스 순서)라 캐스케이드를 역전할 수 있고, computed가 유일한 승자 판정이었다. 놓친 건 **Chrome이 custom property의 computed value를 완전 치환해 준다**는 사실이다(실측: `getComputedStyle(el).getPropertyValue("--_text")` → `#fff`). 그래서 승자를 취하는 순간 `--_text: var(--color-semantic-informative-label)`라는 **표기**가 사라지고, `resolveVarChain`이 private alias를 펼칠 때 도착지가 이미 리터럴이라 토큰 이름을 잃는다. 승자 판정과 표기 보존이 한 대입문에서 충돌하는데 그게 안 보였던 이유는 **같은 요소를 그리는 두 화면이 서로 다른 수집기를 쓰기 때문**이다 — 툴팁(`collectInspectorSpecRefs`)은 hydrate를 안 타서 원문이 살아 있었고, 편집/CSS 뷰(`collectSpecifiedStylesWithSources`)만 hydrate를 탄다. 한쪽이 정상이라 "수집은 되는데 표시만 다르다"는 모순이 생겼고, 그 모순이 사실은 원인을 가리키는 화살표였다.
- **픽스가 만든 2차 노출**: 원문을 유지하기로 하자 **큐가 정확성 경로로 승격**됐다. 유지한 원문이 참조하는 이름이 hydrate되지 않으면 그 이름은 검증 안 된 수집 raw로 펼쳐진다. 그런데 이름 수집이 `VAR_REF_RE`(`[^)]*`)라 `var(--a, var(--b))`의 `--b`를 첫 `)`에서 놓쳤고, 반복 캡 `i < 100`은 초기 값 개수와 합산이라 prop이 많은 페이지에서 큐에 실은 참조가 **한 번도 처리되지 않고 굶었다**. 둘 다 변경 전에는 무해했던 코드다(원문이 늘 덮이니 큐가 무의미).
- **재발 방지**: (1) **"승자를 취한다"와 "표기를 보존한다"는 다른 요구다 — 한 대입문이 둘을 겸하면 조용히 하나를 버린다.** custom property를 computed로 보강하는 코드를 손댈 땐 `getComputedStyle(el).getPropertyValue('--x')`를 **콘솔에서 실제로 찍어** 치환 여부를 확인하고(브라우저는 완전 치환한다), 표기가 필요한 소비처(토큰 칩·swatch·CSS 뷰)가 그 값을 쓰는지 본다. 해법은 승자를 버리는 게 아니라 **원문을 승자로 검증**하는 것 — 원문을 computed로 치환해 승자와 같은지 본다. **단 값 일치는 선언 identity의 증명이 아니다**(후속 리뷰에서 정정): 서로 다른 토큰이 지금 같은 값이면 패자 이름을 노출하므로, 한 스코프가 같은 이름을 여러 값으로 선언했을 땐 후보를 모아 두고 승자와 일치하는 후보가 **정확히 하나일 때만** 이름을 쓴다. (2) **같은 데이터를 그리는 화면이 둘이면 수집기도 둘인지 먼저 확인한다** — `grep -n "collectInspectorSpecRefs\|collectSpecifiedStylesWithSources" src/content/css-resolve.ts`로 경로를 세고, 두 경로의 전처리(docEl 보강·hydrate) 목록을 나란히 놓는다. **화면 간 불일치는 버그의 증상이 아니라 경로가 갈렸다는 신호다.** (후속 커밋들에서 해소했다 — 두 경로를 `finalizeCustomProps`로 묶고, custom property 수집을 상속 prop 조상 순회에서 **분리**해 체인 전체를 돌게 했다. **여기서 한 번 더 배웠다: 그 순회에 캐시를 붙였더니 클래스 토글·우리 인라인 편집·cross-origin 시트의 늦은 도착이 캐시 세대를 안 올려 무효화 계약이 호출부로 샜고, 새는 순간 같은 증상이 재발하는 구조가 됐다.** 캐시를 걷어내고 "값에 `var()`가 없으면 순회 자체를 건너뛴다"는 게이트로 대체해 대다수 요소의 비용을 0으로 만들었다 — **캐시로 비용을 숨기기 전에, 그 일을 아예 안 할 수 있는 조건이 있는지 먼저 본다.**) (3) **무해하던 방어(캡·정규식)가 갑자기 정확성에 걸리는 전환점을 의심하라** — "이 값이 안 쓰이니 대충이어도 된다"가 전제였던 코드는, 그 값이 쓰이기 시작하는 커밋에서 함께 승격돼야 한다. 캡은 `values.length + N`처럼 입력과 분리하고, var 이름 스캔은 괄호 균형(`replaceVarRefs`) 단일 출처를 쓴다(현재 `collectReferencedTokenNames`가 아직 정규식이라 같은 구멍이 남아 있다).
- **관련**: `src/content/css-resolve.ts:hydrateReferencedCustomProps`·`substituteFromComputed`(신규 — 원문 검증)·`sameResolvedValue`(표기 차 흡수, `normalizeForLookup` 재사용)·`varRefNames`(신규 — 괄호 균형 스캔)·`resolveUncertainSpecified`(토큰 보존 트레이드오프의 적용 면적이 alias 체인 전체로 넓어짐 — 테스트로 고정), 두 수집 경로 `collectInspectorSpecRefs`↔`collectSpecifiedStylesWithSources`, 그물 `src/content/__tests__/css-resolve.test.ts`.

---

## 2026-08-01 — cmdk 하이라이트 역통보와 팝오버 입력 리셋이 외부 값을 덮었다

- **영역**: `컴포넌트`, `에디터`
- **계열**: `라이브러리전제`
- **그물**: `jsdom`
- **증상**: 스타일 편집 탭 값 콤보박스에서 값을 직접 타이핑한 뒤 Enter를 눌러도 **아무 일도 일어나지 않았다**(팝오버조차 안 닫힘). 확정 수단은 Esc·바깥 클릭뿐. 고치려고 Enter를 열자 이번엔 하이라이트가 "초기화"에 있어 **값이 지워졌다**.
- **근본 원인**: 셋이 겹쳤다. ① Enter를 무조건 `preventDefault`한 방어가 원인 표기 없이 최초 도입부터 있었다 — cmdk는 리스트 첫 항목을 자동 선택하고 그 첫 그룹이 초기화/unset이라, 그걸 안 막으면 Enter가 값 삭제였다. 방어는 옳았지만 **확정 수단을 대신 마련하지 않아** 자유입력이 갇혔다. ② 하이라이트를 밖에서 잡으려고 `Command`에 `value`/`onValueChange`를 controlled로 물렸다. cmdk 1.1.1은 prop 변경을 layout effect로 내부 store에 반영하지만, 항목 집합 변경 때 첫 항목을 자동 선택하는 store 갱신도 같은 `onValueChange`로 역통보한다. 그 통보가 외부 controlled 값을 다시 덮어 하이라이트가 초기화로 돌아갔다. ③ 항목 선택으로 팝오버가 닫히면 **cmdk Input이 언마운트되며 검색어를 `""`로 리셋**하고, 입력을 controlled로 쓰는 우리 쪽엔 그게 `onValueChange("")`로 도착해 **라이브 적용 경로를 타고 방금 커밋한 토큰 값을 빈 값으로 덮었다**(2026-07-14 "콤보박스 검색어 state 수명 불일치"와 같은 가족 — 그때는 리셋이 *안* 와서 깨졌고 이번엔 리셋이 *와서* 깨졌다).
- **재발 방지**: (1) **controlled prop만으로 라이브러리 내부 선택 상태를 안정적으로 소유한다고 가정하지 않는다** — prop→store 동기화뿐 아니라 항목 mount/unmount가 만드는 store 갱신과 `onValueChange` 역통보까지 소스로 확인한다. 외부 값과 내부 자동 선택이 같은 콜백을 왕복하면 UI 의미(Enter가 무엇을 하나)를 그 상태에 걸지 않는다 — 이번 해법은 Enter를 컴포넌트가 직접 처리하는 것(cmdk root는 `defaultPrevented`를 스스로 확인하므로 `preventDefault`가 차단의 본체이고 `stopPropagation`은 상위 핸들러용 이중 방어다). (2) **팝오버 안 controlled 입력은 언마운트 리셋이 콜백으로 되돌아온다** — 그 콜백이 부수효과(라이브 적용·저장)를 태우면 닫는 순간 값이 날아간다. `grep -rn "onValueChange" src/sidepanel`로 콜백 안에 쓰기가 있는 곳을 전수하고, **열림 상태 ref로 게이트**한다(state로는 못 막는다 — 리셋이 닫기와 같은 커밋에서 온다). (3) **키 입력 방어를 넣을 땐 그 키의 정당한 용도를 대신 제공했는지 확인한다** — `preventDefault`만 남기면 사용자는 그 키가 고장 났다고 느낀다. 목록 탐색은 cmdk가 실제 처리하는 키 전부(`ArrowUp`·`ArrowDown`·`Home`·`End` + vim 바인딩 `Ctrl+N/P/J/K` — 기본 on)를 구분하고, IME 조합 Enter는 기본 동작을 막기 전에 반환한다. (4) 이 부류는 순수 함수 테스트로 안 잡힌다 — jsdom + user-event로 "타이핑→Enter", "방향키→Enter", "IME Enter"를 각각 고정한다. 검증 하네스에서 **controlled `set`을 `vi.fn()`으로만 두면 value가 되돌아오지 않아** 실제와 다른 경로(draft가 매 글자 리셋)를 테스트하게 되니, store 왕복을 흉내내는 래퍼로 감싼다.
- **관련**: `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx`(`onKeyDown` 직접 처리·`navigatedRef`·`openRef`·`typing`·`showRawItem`), `src/sidepanel/tabs/styleEditor/__tests__/ValueCombobox.test.tsx`(Harness + Enter 11케이스), 같은 가족 회고 2026-07-14(콤보박스 검색어 수명), 최초 도입 커밋 `56f32d5f`(Enter 차단 유입).

---

## 2026-08-01 — 이름 보존 규칙을 값 판정에 재사용해 alias 토큰이 목록에서 사라졌고, 시트 열거가 모듈마다 갈려 `@import` 토큰은 제안에만 뜰 뻔했다

- **영역**: `스타일해석`, `store`
- **계열**: `복제본`, `미검증단언`
- **그물**: `unit`
- **증상**: 디자인 토큰을 alias로 쓰는 페이지(`--color-primary: var(--blue-500)`)에서 그 토큰이 편집 탭 콤보박스·CSS 뷰 자동완성 **양쪽 목록에서 통째로 빠졌다**. 이름은 값 문자열에서 뽑히니 CSS 뷰엔 보이는데 고를 수는 없는 상태. 별개로 요소를 연달아 고르면 **직전 요소의 토큰 목록이 남아 있어** 새 요소에 그대로 적용할 수 있었고, `@import`로 토큰 파일을 나눠 놓은 페이지는 토큰이 아예 안 잡혔다.
- **근본 원인**: 셋 다 "한 곳에서 잘 도는 규칙을 그 옆에서도 쓴다"에서 왔다. ① `resolveVarChain`은 **specified 표기**용 규칙이라 public 토큰을 만나면 이름에서 멈춘다(디자인 토큰 이름 노출이 목적). 그런데 토큰 목록의 값도 이 결과를 그대로 썼다 — 값이 `var(--blue-500)`로 남으면 `categorizeToken`이 `unknown`을 내고, `groupTokensByFamily`가 base(=category 일치)와 extra(=`unknown` 제외) **둘 다에서** 그 토큰을 떨어뜨린다. 표기 규칙과 값 판정 규칙이 다르다는 걸 함수 하나가 가리고 있었다. ② 선택 전환의 stale 가드(`sameElementKey`)는 **늦게 도착한 응답의 덮어쓰기**만 막는다 — 그 사이 낡은 데이터의 *소비*는 못 막는다. 가드가 있다는 사실이 "그 창이 안전하다"로 읽혔다. ③ 시트 열거가 `css-resolve.allStyleSheets`와 `css-source-cache.collectAllSheets` **두 복제본**이었고 둘 다 `document.styleSheets`만 봤다 — `@import` 시트는 거기 안 잡히고 부모의 `CSSImportRule.styleSheet` 아래에만 있다. 한쪽(토큰 수집)만 하강시키면 "제안 목록엔 뜨는데 specified엔 안 잡히는" 비대칭이 생긴다. 평탄화로 통합하자 파생 전제가 둘 더 딸려왔다 — `@import`의 `media`/`supports` 조건(비활성 import까지 펴면 안 쓰는 토큰이 섞인다)과 raw 로드의 `MAX_SHEETS=50` 캡(import가 슬롯을 먹어 **부모 시트의 pending-substitution 복구가 탈락**한다).
- **재발 방지**: (1) **"이름을 보존한다"와 "값을 판정한다"는 다른 규칙이다 — 소비처가 무엇을 필요로 하는지로 갈라라.** `grep -rn "resolveVarChain" src`로 소비처를 전수하고, 각각이 표기(사용자에게 보일 문자열)인지 판정(category·매칭·swatch)인지 표시한다. 판정 경로는 `resolveTokenValue`(public도 끝까지 펼침)를 쓴다. (2) **`category === "unknown"`은 필터에서 조용히 사라지는 값이다** — `grep -n 'unknown' src/sidepanel/tabs/styleEditor/tokenSuggest.ts`로 제외 지점을 확인하고, 새 값 경로를 만들면 unknown이 나오는 조건을 먼저 센다. (3) **stale 가드는 "쓰기"만 막는다 — 읽는 쪽도 막고 싶으면 상태를 스코프로 비운다.** 비동기 재수집이 뒤따르는 store 필드는 선택 전환 시 초기화하고, "빈 값"이 그 도메인의 정상 상태인지(여기선 토큰 미사용 페이지와 동형) 확인해 로딩 게이트 도입 여부를 정한다 — 정상 상태와 동형이면 게이트는 새 실패 모드만 만든다. (4) **같은 질문("이 문서의 시트는 무엇인가")에 답이 둘이면 하나를 지운다** — `grep -rn "document.styleSheets" src/content`가 2건 이상이면 경계가 갈라진 것이다. 그리고 **열거 대상을 넓히면 그 열거에 걸린 캡·조건을 전수한다**(`MAX_SHEETS` slice, media/supports 활성 판정 — `walkRulesForIndex`가 이미 조건을 보고 있다는 게 신호였다). (5) **그룹 분배에서 선점(첫 매칭 승)은 입력 순서에 의존한다** — 접두가 중첩되는 분류는 "가장 구체적인 것"처럼 순서 무관 기준으로 귀속한다.
- **관련**: `src/content/css-resolve.ts:resolveTokenValue`(신규 — 값 판정 전용)·`collectTokens`(1패스 맵 → 2패스 해석)·`allStyleSheets`, `src/content/css-source-cache.ts:flattenSheets`·`isActiveImport`·`selectSheetsForRawLoad`·`loadSheet`(imported 분기), `src/sidepanel/tabs/styleEditor/tokenSuggest.ts:groupTokensByFamily`·`tokenCompletionQuery`, `src/store/editor-store.ts:onElementSelected`(두 분기 모두 `tokens: []`), 그물 `src/content/__tests__/css-resolve.test.ts`·`css-source-cache.test.ts`·`src/sidepanel/tabs/styleEditor/__tests__/tokenSuggest.test.ts`·`src/store/__tests__/editor-store.test.ts`, 문서 `docs/ARCHITECTURE.md`("토큰 체인 resolve 룰"). 수용 한계는 그 문서의 토큰 수집 경계 문단 — cross-origin 스코프 정의·cross-origin `@import`·정확한 cascade layer 우선순위.

## 2026-08-01 — blocker가 hit target이어도 이벤트는 document까지 간다 — "가린다"와 "안 닿는다"를 같은 것으로 읽어 picking 중 페이지 hover가 살아 있었다

- **영역**: `content`
- **계열**: `미검증단언`, `복제본`
- **그물**: `수동`
- **증상**: element picking 중인데 페이지가 hover에 반응했다 — 드롭다운이 열리고 툴팁이 떠서 고르려던 요소를 덮었다. 전체 화면을 덮는 blocker가 있는데도 그랬다.
- **근본 원인**: 두 갈래가 겹쳤고 둘 다 "blocker가 있으니 안 닿는다"는 전제에서 왔다. (1) **blocker가 hit target이어도 이벤트는 document까지 버블한다** — 페이지가 `document.addEventListener("mousemove"/"mouseover"/"pointermove")`로 만든 위임 hover UI는 blocker와 무관하게 계속 반응한다. 가리는 것과 도달을 막는 것은 다른 얘기다. (2) **blocker의 `pointer-events`를 끄는 주체가 넷인데 각자 자기가 유일한 소유자인 줄 알았다** — 휠 양보 타이머·iframe 핸드오프·`elementFromPoint` hit-test 프로브·visibility 전환. 프로브가 매 호출 끝에 **무조건 `auto`로 복원**해 진행 중인 스크롤 양보를 무단 취소했고(그래서 스크롤이 안 먹었다), 반대로 양보 창(120ms) 동안은 커서 밑 페이지 요소가 진짜 `:hover`를 받았다. 픽스에도 함정이 둘 더 있었다. 양보 회수를 "mousemove가 오면"으로 걸었더니 **스크롤 뒤 브라우저가 hover 재계산용으로 쏘는 mousemove**와 매직마우스처럼 이동·스크롤이 한 제스처인 입력까지 포인팅으로 읽혀 매 틱 양보가 닫혔고(커서 밑 스크롤 컨테이너가 안 밀린다), pointer 계열을 mouse 계열과 똑같이 window capture에서 끊으려다 **`action-recorder`가 document capture로 듣고 있어** picking 중 사용자 액션 로그가 통째로 빌 뻔했다.
- **재발 방지**: (1) **"오버레이로 덮었다"는 입력 차단의 증거가 아니다** — 덮개는 hit target만 가져간다. 차단이 목적이면 `document`/`window` 위임까지 끊었는지 별도로 확인한다. 전수: `grep -rn "addEventListener(\"mouse\|addEventListener(\"pointer" src/content`로 차단 지점을 뽑고, 페이지가 같은 이벤트를 위임으로 듣는 경우를 상정한다. (2) **확장 전체가 같은 DOM 이벤트 경로를 공유한다 — 전파를 끊기 전에 우리 리스너의 등록 단계를 먼저 센다.** `action-recorder`(document capture, MAIN world)·`area-select`(window capture)·`annotation`(window capture)이 각각 무엇을 듣는지 확인하고, window capture에서 끊으면 document capture가 죽는다는 순서를 계산한다. 같은 노드 리스너는 `stopPropagation`으로 안 죽지만(그건 `stopImmediatePropagation`), **더 뒤 단계의 리스너는 죽는다**. (3) **한 스타일 속성을 여러 이유가 켜고 끄면 이유 집합에서 파생시킨다** — 직접 쓰기는 last-writer-wins라 남의 이유를 무단 취소한다. 적용까지 상태가 맡게 해서 호출부가 apply를 빠뜨릴 수 없게 한다. 전수: `grep -rn "style.pointerEvents" src/content`로 직접 쓰기가 재출현하는지 감시(현재 `annotation.ts`에 같은 형태의 결함이 남아 있다 — pen ON이 진행 중 양보를 무단 취소). (4) **"입력이 왔다 = 사용자 의도다"가 아니다** — 브라우저가 스크롤·레이아웃 변경 후 hover 재계산용으로 합성 입력을 쏜다. 시간 창(마지막 휠로부터 60ms)처럼 **다른 축의 신호**로 가른다. 좌표 비교는 합성 입력만 걸러 실제 이동이 섞이는 입력장치를 놓친다. (5) **이 부류는 유닛·jsdom으로 못 잡는다** — 전파·hit-test·스크롤 체이닝은 실제 브라우저 동작이고, `picker.ts`·`overlay.ts`는 커버리지 로직 스코프 제외라 배선을 지워도 green이다. 순수 판정(`isScrollIntent`·투과 컨트롤러)만 유닛으로 내리고 나머지는 실탭 수동 확인으로 남긴다.
- **관련**: `src/content/blocker-state.ts:createBlockerPassthrough`·`isScrollIntent`, `src/content/overlay.ts:setScrollYield`·`_cancelScrollYield`·`SCROLL_YIELD_MS`/`SCROLL_INTENT_MS`(대소 관계가 깨지면 회수 경로 사망)·`setBlockerHandoff`·`withBlockerHitTest`, `src/content/picker.ts:stopHoverPropagation`·`PAGE_HANDLER_EVENTS`·`onMouseMove`·`elementAtPoint`, 공존 리스너 `src/content/action-recorder.ts`(document capture pointer 계열)·`src/content/area-select.ts`, 그물 `src/content/__tests__/blocker-state.test.ts`, 문서 `docs/ARCHITECTURE.md`("blocker 투과 소유권").

## 2026-08-01 — `visibility="hidden"`을 세팅한 같은 태스크에서 응답하면 캡처는 아직 오버레이가 보이는 프레임을 찍는다 — 그리고 그 대기를 한 곳에 넣으면 다른 렌더러는 안 덮인다

- **영역**: `content`
- **계열**: `미검증단언`, `cross-origin`
- **그물**: `시각`
- **증상**: element·영역 캡처 스크린샷에 **확장 자신의 UI가 이따금 찍혔다** — picker의 파란 outline·selector badge·상단 뷰포트 배너(`1920 × 1080` pill), area-select의 dim·선택 사각형·크기 라벨. 매번이 아니라 간헐적이라 "가끔 그러네"로 넘기기 쉬웠고, 실패 토스트도 없이 결과물 품질만 떨어진다.
- **근본 원인**: `beginCapturePrep`이 `hostEl.style.visibility = "hidden"`을 세팅한 뒤 **같은 태스크에서 `sendResponse`** 했고, 사이드패널이 그 응답을 받자마자 `captureVisibleTab`을 호출했다. DOM 속성 세팅은 즉시지만 화면 반영은 다음 합성 커밋이라, 그 사이에 캡처가 끼면 숨기기 전 프레임이 찍힌다 — **"숨겼다"와 "안 보인다"가 다른 레이어**인데 동기 코드가 그 둘을 같은 것으로 취급했다. 픽스 자체도 두 번 어긋났다. (1) 대기(`afterPaint`)를 자식 프레임의 응답 직전 한 곳에 넣었더니 **iframe 경로는 안 고쳐졌다** — top 오버레이 숨김은 offset 응답기(top realm)에서 일어나는데 cross-origin iframe은 **별도 렌더러 프로세스**라 자식의 rAF 2틱이 부모의 커밋을 보증하지 못한다. "대기를 넣었다"와 "그 대기가 문제의 프레임을 덮는다"가 다르다. (2) 응답을 비동기로 미루자 `handlePickerMessage`의 try/catch **밖으로 나가** throw 시 사이드패널의 `await send()`가 영구 매달렸다 — 동기→비동기 전환이 에러 회수 경로를 조용히 끊었다. (3) 확정을 지연시키자 없던 취소·재진입 창이 생겼다(대기 중 `cancelAreaSelect`가 오면 취소한 영역이 캡처됨, `areaHandle`이 2프레임 좀비로 남아 새 세션을 덮어씀).
- **재발 방지**: (1) **화면 상태를 바꾼 뒤 캡처를 트리거하는 코드는 그 사이에 프레임 커밋을 끼운다** — 전수: `grep -rn 'visibility = "hidden"\|style.display = "none"' src/content`로 은폐 지점을 뽑고, 각각이 `captureVisibleTab`으로 이어지는 경로에 `afterPaint()`(또는 자체 rAF×2)가 있는지 본다. `grep -rn "captureVisibleTab" src/sidepanel`로 호출 직전 경로를 역추적하면 짝이 맞는다. (2) **여러 realm이 관여하는 은폐는 "누가 숨기는가"와 "누가 기다리는가"가 같은 realm인지 확인한다** — cross-origin iframe·worker처럼 렌더러가 갈리면 남의 커밋을 대신 기다릴 수 없다. 전수: `grep -n "onChildCapturePrep\|beginCapturePrep" src/content`로 은폐 훅의 호출 realm을 확인. (3) **동기 응답을 비동기로 바꿀 땐 감싸던 try/catch가 따라오는지 본다** — `sendResponse`가 `.then()` 안으로 들어가면 핸들러 catch 밖이다. `.catch()`를 붙이지 않으면 상대편 `await`가 영원히 안 풀린다. (4) **지연 자체가 새 상태 공간을 만든다** — 확정을 N프레임 미루면 그 창에 도착하는 취소·재진입을 전부 열거해야 한다(`_cancelled`는 **모든** 취소 경로가 세팅해야 하고, 핸들 슬롯은 덮어쓰기 전에 취소해야 한다). (5) **그물이 없다는 걸 알고 넘긴다** — `picker.ts`·`area-select.ts`는 coverage 로직 스코프 제외라 유닛이 없고, `e2e/capture.spec.ts`에도 "결과 픽셀에 dim/outline이 없다"는 단언이 없어 **배선을 통째로 되돌려도 green**이다. 순수 헬퍼(`afterPaint`)만 유닛으로 고정돼 있다.
- **후속(같은 날)**: 이 픽스가 CI e2e 9건을 깼다. **대기를 넣는 것은 그 사이 전제가 바뀔 창을 여는 것**이다 — `captureVisibleTab` 관문(`captureOwnedTab`)이 대상 탭의 활성 여부를 **캡처 시점에 재확인**하므로, 확정이 150ms 늦어지자 그 사이 e2e가 `panel.bringToFront()`로 탭을 비활성화해 `tab is no longer the active tab`으로 전부 거부됐다. 진단이 세 번 빗나갔다(폴백 길이 → 창 위치 → 테스트 예산). **셋 다 "얼마나 기다리나"만 봤고 "기다리는 동안 무엇이 바뀌나"를 안 봤다.** 값을 바꿔가며 green을 찾는 대신 로그 한 줄(`console.log` + `page.on("console")`)을 심었더니 즉시 드러났다 — 예산을 2500→8000ms로 올려도 실패한다는 사실이 이미 "시간이 아니다"라고 말하고 있었는데 그 신호를 늦게 읽었다. 재발 방지: **비동기 대기를 기존 동기 경로에 끼울 때는 그 경로의 종착점이 "지금 상태"를 재검증하는지 먼저 확인한다**(`grep -rn "tab.active\|isActiveTab" src/background`). 그리고 **실패가 시간과 무관함이 한 번 확인되면 즉시 계측으로 전환한다** — 값 스윕은 그 뒤다.
- **관련**: `src/content/after-paint.ts:afterPaint`(rAF×2 + 150ms 폴백 — 폴백은 실패가 아니라 진행. 길게 잡으면 탭 전환 창이 넓어진다), `src/background/capture-throttle.ts:captureOwnedTab`(활성 탭 재확인), e2e `e2e/fixtures/extension.ts:pickElement`·`enterDebugAndPick`(`keepFixtureActive`), `src/content/picker.ts:beginCapturePrep`·`respondAfterPaint`·`respondWithTopRect`·`handleStartAreaSelect`, `src/content/frame-geometry.ts:installFrameOffsetResponder`(top realm 대기), `src/content/area-select.ts:settleAfterPaint`(`_cancelled`/`_settling`), 소비처 `src/sidepanel/capture.ts:captureWithPrep`, 그물 `src/content/__tests__/after-paint.test.ts`·`src/content/__tests__/frame-geometry.test.ts`.

## 2026-07-31 — "앞선 값을 밀어낸다"를 도입하니 "앞뒤·중요도 무관하게 항상 이긴다"가 됐다 — 밀어낼 대상을 열거하지 않은 덮어쓰기는 회귀를 2라운드 낳는다

- **영역**: `스타일해석`, `content`
- **계열**: `미검증단언`, `복제본`
- **그물**: `e2e`
- **증상**: 편집 탭 Border 섹션이 `border-width: 0px` / `border-color: currentcolor` / `border-style: none`을 보여주는데, 같은 화면의 CSS 코드 뷰와 개발자 도구에는 `border: 0.1rem solid var(--color-semantic-divider-medium)`이 있었다. shorthand와 longhand가 한 화면에서 자기모순. 이걸 고치자 이번엔 **`!important`가 무시되고**(`.a{border-color:red !important}` 뒤 `.b{border:… var(--c)}` → var가 이김), **뒤 규칙의 리터럴 longhand가 앞 규칙에 지고**(`.c2{border-top-color:red}`가 무시됨), **`padding: calc(100% / 3)`이 통째로 사라졌다**. 그 1차 수정이 또 3차 회귀를 만들었다 — 둘 다 `!important`일 때 문서 순서상 뒤가 이겨야 하는데 앞이 이겼다.
- **근본 원인**: `var()`가 낀 shorthand는 Chrome CSSOM에서 **longhand가 전부 빈 문자열**이다(pending-substitution). ARCHITECTURE와 코드 주석은 이 조건을 *"shorthand + 같은 shorthand의 longhand override 조합"*으로 좁게 적어놨지만 실측하면 override가 없어도 그렇다 — 이 좁은 기술이 "그럼 대부분은 CSSOM이 채워주겠지"라는 전제를 만들어, 수동 전개가 **유일한 출처**라는 사실이 가려져 있었다. 그래서 `border`(`SHORTHAND_MAP` 밖 — width|style|color 혼합)는 longhand를 아예 전개하지 못했고, 앞서 순회된 리셋 `*{border:0}`(var가 없어 CSSOM이 `0px/none/currentcolor`로 정상 explode)이 자리를 선점한 채 남았다. 2값 shorthand(`gap`·`overflow`·논리 속성)는 값을 두 longhand에 통째 복사했는데, **논리 속성은 var 없이도 Chrome이 물리 longhand로 explode하지 않아 상시 발동**이었다. 픽스의 회귀는 별개 축이다: "리셋을 밀어낸다"는 목적으로 덮어쓰기를 넣으면서 **밀어내면 안 될 대상을 열거하지 않았다** — `!important`(raw 파서가 값에서 벗겨내 정보가 도달 못 함), 뒤 규칙의 직접 선언(원래 `border` 키 하나에만 걸린 "토큰 보존" 가드가 12개 longhand로 확대), author가 쓴 var 토큰이 각각 **다른 이유로** 보호 대상인데 한 덩어리로 취급됐다. 3차 회귀는 그 보호를 "영구 잠금"으로 구현한 탓(중요도는 순서와 곱해져야 하는데 순서를 버렸다).
- **재발 방지**: (1) **CSSOM 동작 가정은 실측하고 e2e로 고정한다** — 이 파일의 유닛은 `all`/`declared` 맵을 손으로 만들어 넣으므로 "브라우저가 무엇을 돌려주는가"를 **원리상** 검증하지 못한다. `e2e/style-shorthand-var.spec.ts`가 그물이고 mutation(수정 전 파일로 되돌려 red 확인)까지 거쳤다. 이때 `build:e2e`가 typecheck를 먼저 돌리므로 **테스트 파일도 함께 되돌려야** 한다 — 안 그러면 빌드가 죽고 직전 `dist-e2e`로 실행돼 green이 나와 mutation이 통과한 것처럼 보인다(실제로 한 번 속았다). (2) **"앞선 값을 밀어낸다"류 덮어쓰기는 밀어낼 대상과 보호할 대상을 먼저 열거한다** — 전수: `grep -rn "out\[.*\] = " src/content/css-resolve.ts`로 쓰기 경로를 뽑고 각각 중요도·후속 직접 선언·author 토큰 세 축에 어떻게 답하는지 대조. 판정은 `shouldOverwriteSpecified`/`claimSpecified` **단일 출처**를 거쳐야 한다(`grep -n 'shouldOverwriteSpecified\|claimSpecified' src/content/css-resolve.ts`). (3) **가드를 쓰기 경로마다 복제하지 말 것 — 이 파일에서 두 번째다**(2026-06-28 cross-origin 가드 누락이 같은 함정). 감시: `grep -n 'includes("var(")' src/content/css-resolve.ts`에 복제본이 재출현하는지. (4) **문서가 브라우저 동작의 발동 조건을 적을 땐 조건을 좁히지 말 것** — 좁게 적힌 조건은 "나머지는 안전하다"는 반대 전제를 만든다.
- **관련**: `src/content/css-resolve.ts:shouldOverwriteSpecified`·`claimSpecified`(판정 단일 출처)·`claimBorderProp`·`declaredAfter`·`importantProps`(CSSOM `getPropertyPriority` — 값이 빈 pending longhand에서도 중요도는 정확히 나온다)·`splitShorthandValue`·`hasTopLevelSlash`, 그물 `e2e/style-shorthand-var.spec.ts` + 픽스처 `e2e/fixtures/pages/shorthand-var.html`, 단위 `src/content/__tests__/css-resolve.test.ts`, 문서 `docs/ARCHITECTURE.md`("CSSOM shorthand 한계 우회").

## 2026-07-31 — 다단 게이트의 "안 생긴다" 테스트는 앞 게이트가 이미 잘라서 통과한다 — 게이트를 하나씩 지워 red를 확인해야 이름표가 정해진다

- **영역**: `e2e`, `store`
- **계열**: `미검증단언`
- **그물**: `e2e`
- **증상**: 재현 환경 `API Hosts` 자동 행의 **element 모드 누출 방지**를 검증하는 e2e가 green이었는데, `apiHostRowFor`에서 `supportsConsoleNetworkLog` 모드 게이트를 **통째로 지워도 계속 green**이었다. 즉 "모드 게이트 회귀 가드"라는 이름표를 단 테스트가 그 게이트를 전혀 물지 않았다. 출하 전 mutation 검사로만 드러났다.
- **근본 원인**: `apiHostRowFor`는 `supportsConsoleNetworkLog(mode) && logsAttach && networkLog` **3단 게이트**인데, spec이 만든 상태에서는 **두 번째 항이 먼저 잘랐다**. `logsAttach`의 initial이 `false`(`editor-store.ts`)고 `startPicking`(element 진입)은 `preserveLogs`로 **넘기기만** 하지 켜지 않는다 — idle에서 로그만 적재하고 element로 들어가면 `logsAttach === false`라 모드 게이트에 도달조차 못 한다. 그래서 앞 항이 죽어도 뒤 항이 같은 답(`null`)을 내 테스트가 통과한다. `logsAttach: true`를 세팅하는 진입은 `startCapturing`·`startFreeform`·`startElementShot`·`onRecordingComplete` 넷뿐인데, 그중 하나로 켠 뒤 **취소 경로를 잘못 고르면 또 공전한다** — `mode-screenshot`의 취소는 `cancelAreaCapture` → **`reset()`**이라 `networkLog`·`logsAttach`를 통째로 날려 이번엔 세 번째 항이 대신 자른다. 실제로 통과하는 조합은 `mode-element-shot`(logsAttach 켬) → `picking-cancel`(`stopPicker` → `cancelPicking` = `preserveLogs`) → `mode-element` 하나뿐이었다. `design.md`가 "`reset()`을 타는 취소는 게이트를 exercise하지 못한다"고 경고해 뒀는데, 경고한 축(networkLog)이 아니라 **옆 축(logsAttach)으로 같은 공전이 재발**했다.
- **재발 방지**: (1) **음성 단언(`toHaveCount(0)`·`not.toBeVisible`)에는 이름표를 붙이기 전에 mutation을 돌린다** — 전수: `grep -rn "toHaveCount(0)\|not\.toBeVisible\|toBeNull()" e2e/*.spec.ts`로 뽑고, 각 단언이 지킨다고 주장하는 가드를 **하나씩 무력화해 red를 확인**한다. red가 안 나오면 원인이 셋이고 구분해야 한다 — 이름표가 틀렸거나 / 테스트가 공허하거나 / **시나리오가 그 코드 경로를 애초에 안 탄다**(이번은 셋째). 2026-07-18 항목이 같은 처방을 코드 가드에 냈는데, 이번엔 **다단 게이트의 개별 항**으로 변주됐다. (2) **`&&` 체인 게이트를 테스트할 땐 "내가 만든 상태에서 몇 번째 항이 자르고 있나"를 먼저 답한다** — 전수: `grep -rn "return null;" src/sidepanel/lib/*.ts -B3 | grep "&&"`로 다단 게이트를 뽑고, 각 항을 참으로 만드는 진입 경로가 spec에 실제로 있는지 대조한다. (3) **상태를 켜는 액션과 보존하는 액션을 혼동하지 않는다** — 전수: `grep -n "logsAttach: true" src/store/editor-store.ts`(켜는 곳)와 `grep -n "preserveLogs\|\.\.\.initial" src/store/editor-store.ts`(넘기는 곳/지우는 곳)를 나란히 놓고, 테스트 진입 경로가 어느 쪽인지 확인한다. `...initial`을 타면 켜둔 게 사라진다.
- **관련**: `src/sidepanel/lib/apiHostRow.ts:apiHostRowFor`(3단 게이트), `src/store/editor-store.ts:preserveLogs`·`startPicking`·`startElementShot`(logsAttach 세팅 유무), `src/sidepanel/picker-control.ts:cancelAreaCapture`(`reset()`)·`stopPicker`(`cancelPicking`), 그물 `e2e/api-hosts-env-row.spec.ts`("element 모드는 로그가 보존돼 있어도 …"), 경고 원문 `docs/features/api-host-env-row/design.md`("기존 패턴 준수" 절).

## 2026-07-31 — 근사의 실패 방향을 "덜 잡힌다"로 오판해 정확한 라이브러리를 기각했다 — 실제 방향은 과대포함이라 유출이었다

- **영역**: `lib`
- **계열**: `미검증단언`
- **그물**: `unit`
- **증상**: 재현 환경 `API Hosts` 행이 **남의 조직 hostname을 실을 수 있는** 상태로 설계가 확정됐다. `a.github.io` 페이지에서 `b.github.io`(남의 GitHub Pages), `my-bucket.s3.amazonaws.com`에서 다른 테넌트의 버킷, `snu.ac.kr`에서 다른 대학의 `*.ac.kr`이 전부 "같은 조직"으로 판정돼 이슈 본문·Slack 채널 메시지에 나갈 수 있었다. 코드 리뷰에서야 드러났다.
- **근본 원인**: `design.md`의 대안 검토가 `tldts`(public suffix list) 도입을 기각하면서 사유를 *"오판정의 대가가 '행이 하나 안 뜬다' 수준이라 근사로 충분하다"*로 적었다. **대가 산정의 방향이 반대였다.** 하드코딩 접미사 목록(`TWO_LEVEL_SUFFIXES` 19개)의 근사가 틀리는 방향은 부재(false negative)가 아니라 **과대포함(false positive)** 이다 — 목록에 없는 다단 접미사에서 registrable domain이 실제보다 짧게 잡혀 형제 hostname이 동족으로 묶인다. 부재는 "정보가 하나 덜 나온다"라 사용자 수정으로 흡수되지만, 과대포함은 **이미 제출한 이슈에서 남의 조직 hostname이 노출된 것**이라 "사용자가 지우면 된다"로 흡수되지 않는다. 기각 사유의 전제가 틀렸으므로 결론도 뒤집혀야 했는데, 그 문장이 검증 없이 구현까지 내려갔다. 뒤늦게 붙인 `HOSTING_DOMAINS` 하드 가드도 같은 계열의 땜질이었다(그룹 전체를 버려서 Vercel same-host API가 침묵하는 새 결함을 만들었다). 최종 해법은 `getDomain(host, {allowPrivateDomains:true})` 위임 — PSL private 섹션이 `github.io`·`vercel.app`·`s3.amazonaws.com`을 접미사로 인정해 형제가 **자동으로** 갈린다.
- **재발 방지**: (1) **설계 문서가 대안을 기각할 때 쓴 "대가는 X 수준" 문장은 단언이지 사실이 아니다** — 구현 전에 X의 **방향**(정보 부재 vs 잘못된 정보 포함)을 한 번 묻는다. 방향이 "잘못된 정보가 나간다"면 사용자 수정으로 흡수된다는 완화가 **성립하지 않는다**(제출 후엔 늦다). 전수: `grep -rn "채택하지 않\|기각\|충분하다" docs/features/*/design.md`로 기각 사유를 뽑고 각각 방향을 판정. 2026-07-18의 *"design.md 위험표의 '완화' 칸은 구현 전 가설"* 처방을 **대안 기각 사유 칸까지** 확장한다. (2) **도메인·경로·식별자 근사를 손으로 만들 땐 반례를 먼저 테스트로 박는다** — 목록 기반 판정(`SUFFIXES`·`ALLOWLIST` 등)은 목록에 **없는** 입력이 어떻게 떨어지는지가 본체다. 전수: `grep -rn "ReadonlySet<string>\|Set(\[" src/ --include=*.ts`로 목록 상수를 뽑고, 각각 "미등재 입력이 안전 방향으로 떨어지는가"를 단위 테스트로 고정. (3) **외부로 나가는 값의 오판정은 fail-closed가 기본** — 못 넣는 건 불편이고 잘못 넣는 건 유출이다.
- **관련**: `src/sidepanel/lib/apiHostRow.ts:registrableDomain`(tldts 위임)·`deriveApiHostsRow`, 그물 `src/sidepanel/lib/__tests__/apiHostRow.test.ts`(github.io·vercel.app·s3 형제 케이스), 결정 기록 `docs/features/api-host-env-row/design.md`("대안 D — 채택").

## 2026-07-30 — 프롬프트 지시가 가리키는 대상을 인쇄된 컨텍스트로 검증하지 않으면, 예산 절삭이 기준점을 지우고 인쇄 순서가 "이후"를 반대로 뒤집는다

- **영역**: `AI`, `lib`
- **계열**: `복제본`, `미검증단언`
- **그물**: `unit`
- **증상**: 사내에서 BugShot으로 발행한 지라 티켓의 AI 자동 생성 제목이 `…403 오류 발생 및 **성공** 알림 표시`였다. 실제로는 실패 토스트가 떴고(코드상 onError 경로) 사람이 지라에서 "실패 알림 표시"로 고쳐야 했다 — 첨부 `logs.html`의 actionLog 타임스탬프로 확증했다(토스트 클릭이 "수정하기" 클릭보다 앞선다). 즉 모델이 **실패 응답 이전**의 성공 토스트를 결과로 읽었다. 같은 티켓에서 두 번째 결함: `expectedResult`가 "정상 동작 + 실패 시 오류 메시지"를 한 문장에 뭉쳐서, API만 고쳐지고 FE 오류 메시지는 미처리인 채 티켓이 닫혔다. **정작 비자명한 건 이걸 고치는 과정에서 밟은 함정 두 개다** — 둘 다 유닛·타입체크 green이었고 자체 검증 에이전트가 잡았다.
- **근본 원인**: 두 함정 모두 **"지시가 가리키는 대상이 인쇄된 프롬프트에 실제로, 그 자리에 있는가"를 확인하지 않은 것**이다. ① **게이트를 캡처 모드 축으로 잡아 기준점이 사라졌다.** 앵커("실패 응답 이후 관측된 것만 결과로 판정")를 `supportsConsoleNetworkLog(ctx.captureMode)`로 게이트했는데, `promptBudget.ts`의 `trimDraftContext`가 level≥1에서 `networkLogSummary`·`consoleLogSummary`·`requests`를 전부 떨구면서 **`captureMode`는 그대로 남긴다**. 그래서 절삭된 프롬프트는 "실패 응답 후보 0건 + 그것을 지목하는 지시 유지"가 **보장**된다(지원 모드인데 로그가 애초에 0건인 경우도 같다 — `AiDraftDialog`가 `captured > 0`일 때만 summary를 싣는다). 이 파일의 기존 지시는 전부 데이터 존재 게이트였는데(matched `m*` 지시·warn 헤더) 새 지시만 모드 게이트를 쓴 게 어긋남의 시작이다. ② **문구가 "위치"를 가리켜 시간 순서와 반대를 지목했다.** compact 앵커를 `read the outcome from **the entries after** the failing response`로 썼는데, 두 빌더의 인쇄 순서는 Network errors → Console errors → User actions다. "실패 뒤 entries"를 위치로 읽으면 액션 로그를 가리키는데 **액션은 시간상 실패를 유발한 이전 사건**이다 — 앵커가 정확히 반대를 지목했다. rich는 `what was observed after`(시간 표현)로 우연히 피했고 compact만 위치 표현으로 남아, 같은 지시의 두 복제본이 반대 의미를 갖게 됐다. 같은 계열의 선행 실수도 있었다: 첫 rich 문구가 `A success notice that sits earlier in **the action timeline**`이라고 위치를 못 박았는데, `ActionEntryKind`는 click/navigation/input/keypress/toggle/select/drag 전부 **사용자 발화 이벤트**뿐이고 페이지 반응(토스트)은 사용자가 그걸 클릭했을 때만 우연히 실린다 — 데이터 구조가 그 위치 주장을 뒷받침하지 않았다. ③ (부수) `expectedResult` 분리 지시를 `SECTION_DESC_BASE`에 넣자 element 모드에도 인쇄됐다. element는 스타일 diff라 실패 경로도 오류 UX도 없어 `Never invent details not given`과 경합하고, `MODE_HINTS` suffix 뒤에 붙어 원래 수식 대상(` (desired 값 기준으로 작성)`)도 밀렸다.
- **재발 방지**: (1) **프롬프트 지시가 인쇄된 산출물을 지목하면 게이트도 그 산출물 존재로 걸어라 — 모드·설정 축은 절삭·0건에서 살아남아 dangling이 된다.** `grep -rn 'ctx.captureMode' src/sidepanel/lib/prompts/`로 모드 게이트를 전수 뽑고, 각각 "이 지시가 프롬프트에 인쇄된 무언가를 가리키는가"를 묻는다. 가리키면 `cand.network.length > 0`처럼 **인쇄 조건과 동일한 식**으로 바꾼다(현재 `selectLogCandidates`가 미지원 모드에 빈 배열을 반환하므로 데이터 축이 모드 축을 함의한다 — 이중 게이트 불필요). 역으로 지시가 리포트의 *형태* 속성이면(`HAS_FAILURE_PATH`) 모드 축이 맞다 — 두 축을 통일하려는 "정리"가 오히려 회귀다. (2) **지시문에 위치어(after/above/below/earlier/first/last)를 쓰면 인쇄 순서와 시간 순서가 같은지 실측하라.** `grep -rn 'above\|after\|earlier\|below' src/sidepanel/lib/prompts/draft*.ts src/sidepanel/lib/prompts/styling*.ts`로 전수 확인한다. 이 저장소의 프롬프트는 **블록별로 묶어 인쇄하고(Network→Console→Matched→Actions) 시각으로 인터리브하지 않으므로, 위치어는 거의 항상 시간을 뜻하지 않는다** — 시간을 뜻하려면 시간 표현(`what happened after`)을 쓴다. (3) **프롬프트 문구 변경은 렌더한 실물을 눈으로 봐라.** 유닛의 `toContain`은 substring 존재만 재고 문구가 **가리키는 대상**은 못 잰다. 임시 probe 테스트로 `buildRichDraftPrompt`·`buildCompactDraftPrompt`를 모드·로케일 조합별로 출력해 지시문 줄과 데이터 블록의 실제 순서를 대조했고, 그제야 ②가 보였다. 전수 대상은 rich/compact **두 벌 + styling 두 벌**이다 — 한쪽만 고치면 이번처럼 두 복제본이 반대 의미를 갖는다. (4) **모델에게 사실을 단정시키는 문구는 조건형으로 쓴다** — `belongs to a previous attempt`는 무관한 다른 작업일 수 있는데 서사를 짓게 지시한다(`may belong`으로 완화). `Never invent details not given`과 경합하는 명령형이 같은 프롬프트 안에 공존하면 후자가 진다.
- **후속 보완**: ① 시간축 없는 요약으로 전후를 판정시키지 않고, 성공 신호는 컨텍스트가 실패 동작과 명시적으로 연결할 때만 결과로 인정하도록 rich/compact 지시를 바꿨다. ② `markdownToMrkdwn`이 실제 줄바꿈 앞 홀수 개 trailing backslash에서 hard-break 표식 하나만 소비하게 해, 두 줄 `expectedResult`가 Slack에 `\` 리터럴로 노출되지 않으면서 짝수 개·문서 끝 백슬래시는 보존한다.
- **관련**: `src/sidepanel/lib/prompts/draftRich.ts:HAS_FAILURE_PATH`·`EXPECTED_SPLIT_HINT`·`getSectionDesc`(형태 축 게이트)·앵커 push(데이터 축 게이트), `src/sidepanel/lib/prompts/draftCompact.ts`(앵커 문구 — 위치→시간 표현), `src/sidepanel/lib/prompts/logCandidates.ts:selectLogCandidates`(미지원 모드 빈 배열 — 데이터 축이 모드 축을 함의하는 근거), `src/sidepanel/lib/prompts/promptBudget.ts:trimDraftContext`(level≥1이 요약만 떨군다), `src/sidepanel/lib/buildLogSummary.ts`(타임스탬프 부재 — 후속 보완 ①이 시간축 판정을 버린 근거), `src/sidepanel/lib/markdownToMrkdwn.ts`(후속 보완 ② — 실제 줄바꿈 앞 홀수 trailing backslash 하나를 소비), 그물 `src/sidepanel/lib/prompts/__tests__/draftRich.test.ts`("실패 응답 후보가 없으면 양쪽 모두 앵커를 붙이지 않는다"·"en 로케일 + expectedResult ON에서도 후보 0건이면 앵커가 없다"·모드 전수 순회·"compact: 분리 지시를 싣지 않는다"), `src/sidepanel/lib/__tests__/markdownToMrkdwn.test.ts`(hard-break 백슬래시 3케이스).
- **추가 함정(그물)**: 음성 가드(`not.toContain`)를 **다른 지시와 겹치는 부분열**로 걸면 무력화된다. 이 항목의 앵커 부재 테스트는 `failed operation`으로 쟀는데 그 문자열이 `EXPECTED_SPLIT_HINT.en`에도 있어, **en 로케일 + expectedResult ON**이면 앵커가 없어도 걸렸다(픽스처가 ko·description ON이라 우연히 green). 재발 방지: 프롬프트 지시의 존재/부재를 재는 문자열은 **그 지시에만 있는지 `grep -rn '<문자열>' src/sidepanel/lib/prompts/`로 확인**하고, 음성 가드는 지시가 붙는 다른 축(로케일·섹션·모드)을 켠 조합으로 한 케이스 더 둔다 — 양성 케이스만으로는 부분열 충돌이 안 드러난다.

## 2026-07-30 — Promise형 `launchWebAuthFlow`는 창 닫기를 `undefined` resolve가 아니라 **reject**로 알린다: 취소 분기 8곳이 dead code였고 가장 흔한 이탈이 `failed`로 집계됐다

- **영역**: `background`
- **계열**: `라이브러리전제`, `미검증단언`
- **그물**: `수동`
- **증상**: PostHog `platform_connect`의 `result: "failed"` 비중이 8개 플랫폼 전부에서 비정상적으로 높았다. 사용자 제보가 아니라 **지표 이상으로만** 드러났고, 로컬에서 OAuth를 성공시키면 재현되지 않는다(성공 경로는 멀쩡하다). 부수적으로 인증 창만 닫은 사용자에게 한국어 UI에 `The user did not approve access.` 영문 원문 토스트가 떴다.
- **근본 원인**: `chrome.identity.launchWebAuthFlow`는 **콜백 형태에선** 취소를 "`undefined` 전달 + `chrome.runtime.lastError`"로 알리지만 **Promise 형태에선 reject**한다(Chromium `identity_constants.h`의 `kUserRejected` = "The user did not approve access.", `identity_launch_web_auth_flow_function.cc`가 `WebAuthFlow::WINDOW_CLOSED`에서 유일 매핑). 콜백 시절 관습을 그대로 옮긴 코드가 8개 플랫폼 전부에 `if (!redirect) → OAuthError({cancelled:true})` 분기를 두고 있었는데 **그 8곳이 통째로 도달 불가**였다. 실제 취소는 `launchOAuthWebFlow`의 catch로 떨어졌고 거기선 `/could not be loaded/i` 하나만 감싸고 나머지를 raw Error로 rethrow했다 — `classifyConnectResult`는 `err instanceof OAuthError && err.cancelled`만 cancelled로 보므로 **가장 흔한 이탈 경로가 통째로 `failed`**가 됐다. 정상 분류되던 취소는 동의 화면의 [거부] 버튼(`error=access_denied` 리다이렉트)뿐 — 창 닫기보다 훨씬 드문 쪽이다. **더 비자명한 건 픽스가 만든 2차 함정이다**: non-cancelled 4종을 `OAuthError`로 감싸자 `serializeOAuthError`의 401 fallthrough에 걸려 `oauthRefreshFailed`가 서고, `sendBg`가 `onOAuthExpired`를 발화해 **한 번도 연결한 적 없는 사용자에게 "세션이 만료되었습니다"** 다이얼로그가 떴다. 감싸기 전엔 raw Error라 토스트만 떴으니, **에러를 제대로 감싸는 행위 자체가 회귀를 만든 것**. `errors.ts`가 주석으로 기록한 A-23과 같은 자리이고, 그때 `notConfigured`만 400으로 빼낸 부분 픽스가 남긴 구멍이 그대로 재발했다.
- **재발 방지**: (1) **promisify된 chrome API의 실패 표현을 콜백 시절 관습으로 추측하지 말 것.** `grep -rn "await chrome\." src/background/ src/sidepanel/`로 await하는 호출을 뽑고, 각각 "취소·실패가 resolve로 오는가 reject로 오는가"를 **문서나 Chromium 소스로** 확인한다. 특히 `if (!result)` 형태의 취소 분기가 있으면 그게 실제로 도달하는지 의심한다 — 이번엔 8곳 전부 dead였다. (2) **외부 시스템의 에러 문자열에 의존하는 매칭은 원문을 직접 대조한다.** 내가 쓴 문자열과 내가 쓴 매처를 대조하는 유닛 테스트는 **자기충족이라 통과해도 아무것도 증명하지 않는다** — Chromium `identity_constants.h` 6종을 verbatim 대조하고 나서야 매처가 의미를 얻었고, 같은 대조 과정에서 `web_auth_flow.cc`의 `MaybeStartTimeout()`이 `mode_ != SILENT`면 즉시 return한다는 걸 발견해 **발생 불가능한 `kPageLoadTimedOut` 엔트리와 i18n 키를 만들 뻔한 것도 되돌렸다**. 2026-07-26 항목의 "OAuth·iframe picker는 e2e 커버가 없으니 처방을 코드로 옮기기 전에 프로토콜 양쪽 끝을 읽는다"가 그대로 적중. (3) **raw Error를 도메인 에러로 감싸는 변경은 그 도메인 에러의 기본 직렬화 레인을 함께 본다** — 감싸는 순간 fallthrough에 걸린다. `serializeOAuthError`는 cancelled·notConfigured·launchFailed가 아닌 **모든** `OAuthError`를 401 + `oauthRefreshFailed`로 내리는 구조라, 새 에러를 이 타입으로 표현할 때마다 같은 함정이 재장전된다. 근본 해법은 축을 늘리는 게 아니라 **refresh 경로에서만 401을 세우고 기본을 400으로 뒤집는 것**이고, 현재 `stateMismatch`·`codeMissing`·`tokenExchange`가 아직 이 함정에 노출돼 있다(미해결 — 다음 라운드). (4) **그물의 비공허성을 뮤테이션으로 증명한다** — `t(classified.key)` → `classified.key`로 바꿔도 4365 테스트가 전부 green이었다(사용자에게 번역 키가 그대로 뜨는 회귀가 무검출). 지금은 그 단언이 있고, 제거 시 정확히 1 red인 것을 실측했다.
- **관련**: `src/background/oauth.ts:classifyLaunchFlowError`·`launchOAuthWebFlow`(분류 테이블 — 문자열 출처 주석)·`serializeOAuthError`(401 레인), `src/background/oauth/errors.ts:OAuthError`(`launchFailed` 축), `src/background/connect-tracking.ts:classifyConnectResult`(집계 분기), 도달 불가로 판명된 `if (!redirect)` 분기 8곳(`src/background/{github,linear,notion,gitlab,asana,clickup,slack}-oauth.ts` + `oauth.ts` — 방어용으로 유지), 그물 `src/background/__tests__/oauth-launch-flow.test.ts`·`__tests__/oauth.test.ts`("인증 창 실패 → status 400").

## 2026-07-29 — `?? undefined`가 "판정이 거부함"과 "판정한 적 없음"을 뭉개, before는 폴백인데 after만 확장됐다

- **영역**: `content`, `lib`
- **계열**: `미검증단언`
- **그물**: `unit`
- **증상**: element 스타일 편집의 before/after 이미지가 **서로 다른 기준으로** 잘린다 — before는 요소 bbox인데 after만 감싼 다이얼로그까지 확장돼, 두 이미지를 나란히 놓으면 무엇이 바뀐 건지 읽을 수 없다. 유닛·타입체크 전부 green.
- **근본 원인**: before 캡처가 확장 게이트에서 떨어지면 `contextSelector: null`(= **판정했고 거부함**)을 저장한다. 그런데 after 호출부가 이걸 `ctx?.contextSelector ?? undefined`로 변환해 메시지에 실었고, picker 쪽에서 `undefined`는 "**저장된 판정이 없음**"과 완전히 같은 값이 된다. 그래서 `if (msg.contextSelector)` 분기를 못 타고 `findContextAncestor`부터 **판정을 처음부터 새로 돌려**, before 시점과 다른 화면 상태(리플로우로 면적이 40% 아래로 내려갔거나, 사용자가 스크롤해 뷰포트 포함 판정이 뒤집힘)에서 이번엔 게이트를 통과해버린다. 지켜야 할 불변식("before/after는 같은 기준을 쓴다")을 in-flight 잠금으로 한쪽 문에서만 막고 있었고, 잠금이 볼 수 없는 **다른 문**으로 같은 불변식이 뚫렸다. 설계 문서의 데이터 흐름도 after에 `expandContext: true`를 무조건 싣고 있어서, 구현은 설계의 구멍을 충실히 옮긴 것이었다 — 코드 리뷰가 아니라 설계 검토에서 걸렸어야 했다.
- **재발 방지**: (1) **`null`과 `undefined`가 서로 다른 것을 뜻하는 값을 `??`로 변환하지 말 것.** `grep -rn '?? undefined' src/`로 변환 지점을 훑고, 각각에 대해 "받는 쪽이 이 둘을 구별해야 하는가"를 묻는다. 구별해야 하면 필드를 쪼개거나(`expandContext` 같은 별도 플래그) 유니온에 `| null`을 허용한다 — 여기선 "before가 확장에 성공했을 때만 after도 확장한다"를 `shouldExpandAfter(ctx) === (ctx?.contextSelector != null)` 순수 함수로 못 박아 해결했다(**당시 심볼** — 후속 리팩터에서 `resolveExpandRequest`·`sameCaptureBasis`로 대체되고 삭제됐다. 전수 grep은 `expandContext`로 계속 유효하다). (2) **"A와 B가 같은 기준을 써야 한다"류 불변식은 그 기준을 실제로 정하는 지점을 전수로 세라** — 잠금·가드 하나로 지켜지는 것처럼 보여도, 기준을 읽는 경로가 2개면 문 2개다. `grep -rn 'expandContext' src/`가 그 전수 목록이고 현재 3곳(before 1·after 2)이다. (3) **설계 문서의 데이터 흐름도에 "같은 값을 두 번 쓰는" 구간이 있으면 두 번째 사용처가 첫 번째의 *결과*를 보는지 확인**한다 — design.md는 after 흐름을 before와 독립적으로 그려놨고 그게 그대로 버그가 됐다.
- **관련**: `src/sidepanel/lib/capture-basis.ts:shouldExpandAfter`(해법·순수 함수), 호출부 `src/sidepanel/tabs/StyleEditorPanel.tsx:handleNext`·`src/sidepanel/hooks/useBufferThenSwitch.ts`, 판정 `src/content/picker.ts:handlePrepareCapture`·`src/content/capture-context.ts:resolveContextRect`, 그물 `src/sidepanel/lib/__tests__/capture-basis.test.ts`, 설계 `docs/features/element-capture-context/design.md`.

## 2026-07-29 — 폴백이 정상 동작인 기능은 테스트 실패가 "구현 회귀"인지 "전제 붕괴"인지 구별되지 않는다

- **영역**: `e2e`
- **계열**: `미검증단언`
- **그물**: `e2e`
- **증상**: 캡처 컨텍스트 확장 spec이 "after 이미지가 다이얼로그 크기여야 한다"에서 계속 실패했다. 관측값은 정확히 **요소 bbox 크기** — 즉 제품이 확장을 안 걸고 폴백했다. 구현을 몇 번이나 다시 읽었지만 무결했고, 실제 원인은 **픽스처**였다: 모달 높이를 `12vw`로 잡았더니 내용보다 작아 버튼이 모달 박스 **밖으로 밀려나** G2(컨테이너가 요소를 완전히 포함)가 깨져 있었다.
- **근본 원인**: 이 기능은 게이트 3개를 전부 통과할 때만 확장하고 **하나라도 어긋나면 조용히 현행 동작으로 폴백**한다 — 폴백이 설계상 정상이라 에러도 경고도 없다. 그래서 "확장이 안 걸림"이라는 관측 하나에 원인 후보가 둘(구현 회귀 / 전제 붕괴) 붙는데, spec은 결과만 단언해 둘을 가르지 못했다. 같은 뿌리에서 두 번째 함정도 나왔다: 픽스처를 `vh`로 잡으면 창 비율에 따라 "컨테이너로 잘랐을 때"와 "요소로 잘랐을 때"의 종횡비가 0.02까지 붙어, 단언이 **통과해도 아무것도 증명하지 않는** 상태가 된다.
- **재발 방지**: (1) **게이트·임계값이 걸린 기능의 테스트는 결과 전에 전제를 단언한다.** 픽스처가 게이트를 실제로 만족하는지(`assertGatesSatisfied` — 뷰포트 포함·요소 포함·면적비를 페이지에서 직접 재서 검사) 먼저 통과시켜야, 실패 메시지가 "구현이 틀렸다"와 "픽스처가 무너졌다"를 갈라준다. (2) **두 가설이 관측값에서 실제로 갈리는지도 단언한다**(`assertHypothesesSeparable`) — 이 가드가 실제로 `vh` 함정을 잡았고, 없었으면 조용한 green이었다. (3) **뷰포트 비율에 의존하는 픽스처 치수는 한 축으로 통일**한다(여기선 폭·높이 둘 다 `vw`) — `vw`/`vh`를 섞으면 창 비율이 도형을 바꾼다. `grep -rn 'vh;' e2e/fixtures/pages/`가 점검 지점. (4) 곁가지지만 같은 계열: **캡처 픽셀 폭을 CSS px로 환산하지 말 것** — `captureVisibleTab`은 실제 backing store 해상도로 찍는데 Playwright는 페이지 `devicePixelRatio`를 1로 고정해 환산이 성립하지 않고(기대 252 → 실측 500), 크롭 조각이라 이미지에서 배율을 유도할 수도 없다. **종횡비로 판정하면 배율이 약분돼 사라진다.**
- **관련**: `e2e/capture-context.spec.ts:assertGatesSatisfied`·`assertHypothesesSeparable`·`afterImageAspect`, 픽스처 `e2e/fixtures/pages/capture-context.html`, 게이트 본체 `src/content/capture-context.ts:passesContextGates`, `e2e/GOTCHAS.md`(3항목 추가).

## 2026-07-29 — 배포될 명령과 **다른 형태**로 검증하고 통과로 읽었다: `pnpm test:e2e -- --shard=`의 `--`가 플래그를 positional 필터로 만들어 CI 4샤드가 전멸

- **영역**: `툴체인`, `e2e`
- **계열**: `미검증단언`, `복제본`
- **그물**: `없음`
- **증상**: e2e를 CI로 옮긴 첫 런에서 **4개 샤드가 전부** `Error: No tests found`로 죽었다. `verify` job은 통과했고, 로컬 `pnpm test:e2e`는 242개 전량 green이었다. 증상만 보면 xvfb·확장 SW 미기동·`.env.ci` 미적용 같은 **환경 가설**이 먼저 떠오르는데(설계 문서가 그 셋을 위험으로 꼽고 폴백까지 준비해뒀다) 전부 무관했다. 테스트가 한 개도 실행되지 않아 그 가설들은 검증 지점에 도달조차 못 했다.
- **근본 원인**: 워크플로가 `pnpm test:e2e -- --shard=N/4`로 불렀다. **pnpm은 `--`를 리터럴로 하위 명령에 넘기고, Playwright CLI는 `--` 뒤를 전부 positional 인자(=테스트 파일 필터 정규식)로 읽는다.** 그래서 `--shard=N/4`는 플래그가 아니라 파일명 패턴이 되어 매칭 0건이 됐다. 헷갈리는 건 **같은 `--`가 이름 필터에선 정상 동작한다**는 것이다 — `pnpm test:e2e -- onboarding`은 `onboarding`이 유효한 positional이라 잘 돌고, 그 형태가 이미 `e2e/README.md`에 문서화돼 있었다. 그래서 "`--`는 인자 전달용"이라는 일반화가 성립하는 것처럼 보였다. 진짜 실패는 그 앞이다: 샤드 분배가 맞는지 확인할 때 나는 `pnpm exec playwright test --config e2e/playwright.config.ts --shard=1/4`로 **직접 호출**해 60/63/57/59라는 그럴듯한 숫자를 얻고 통과로 판정했다. 워크플로가 실행할 명령은 그게 아니었다. **검증한 명령과 배포된 명령이 달랐고, 숫자가 맞게 나왔다는 사실이 그 차이를 덮었다.** 게다가 같은 깨진 형태를 `e2e/README.md`의 "샤드 재현" 안내와 feature 문서 2곳에도 그대로 적어, 고치지 않았으면 문서가 오답을 전파했을 것이다.
- **재발 방지**: (1) **워크플로·스크립트가 실행할 명령은 그 문자열 자체를 실행해 검증한다.** 손으로 "동등하다고 생각하는" 명령을 대신 돌리지 않는다. 이번엔 YAML에서 명령을 파싱해 matrix 값만 치환한 뒤 그대로 실행하는 식으로 다시 검증했다 — `ruby -ryaml -e '...steps.find{...}["run"]'` → `sub("${{ matrix.shard }}", "1")` → 실행. (2) **npm/pnpm 스크립트에 인자를 넘길 땐 `--`가 플래그를 죽인다**: `grep -rn 'pnpm .* -- --' .github/ *.md docs/`로 전수하고, 플래그(`--shard`·`--project`·`--list`)는 `--` 없이, 이름 필터만 `--` 뒤에 둔다. 이 구분을 `e2e/README.md`에 규칙으로 박았다. (3) **"숫자가 그럴듯하다"는 통과 근거가 아니다** — 검증 대상이 실물과 같은지를 먼저 확인한다. 2026-07-28 항목의 vacuous green(픽스처가 오버플로를 안 내 스크롤 단언이 공허했던 건)과 같은 계열이다: 그쪽은 *전제*가 성립 안 했고 이쪽은 *대상*이 달랐다. (4) 이 축은 저장소 안의 자동 그물로는 못 잡는다 — 유닛·typecheck·로컬 e2e가 전부 green이었고 CI 런 자체가 유일한 검출기였다. 그래서 CI 워크플로를 바꿀 땐 **첫 런을 반드시 관측**하고, 관측 전에 후속 단계(로컬 게이트 제거·브랜치 프로텍션)를 진행하지 않는 2단계 전환을 지켰다.
- **관련**: `.github/workflows/ci.yml`(`e2e` job의 shard 스텝 — `--` 제거 + 사유 주석), `e2e/README.md`(실행 섹션 — `--`는 이름 필터에만), `e2e/playwright.config.ts`(샤딩 대상 config). 계열: **2026-07-28**(vacuous green — 검증이 실제로 무는지), **2026-07-16**(미검증 단언이 설계에 박힘).

## 2026-07-28 — 값을 다른 표면으로 옮기면 전제가 따라오지 않는다: `pre`의 `padding-left`는 스크롤 영역이라 가로 스크롤이 코드를 행 번호 위로 밀어 올렸다

- **영역**: `에디터`, `디자인`, `e2e`
- **계열**: `라이브러리전제`, `미검증단언`
- **그물**: `e2e`
- **증상**: 코드블럭 행 번호 열을 붙인 뒤, 가로로 긴 줄(로그·JSON 블럭에선 기본값)을 오른쪽으로 스크롤하면 **코드 글자와 번호가 같은 픽셀에 겹쳐 찍혀** 둘 다 못 읽는다. 스크롤 전에는 멀쩡해 보이고, `pnpm test`·typecheck·기존 e2e 전부 green이었다. 부수로, 번호 색이 라이트 테마에서 코드블럭 배경 대비 4.34:1로 **AA(4.5) 미달**이었다.
- **근본 원인**: 셋 다 "이 값이 저기서 잘 돌았으니 여기서도 잘 돌 것"이라는 **표면 이전 전제**가 깨진 것이다. ① 번호 열을 `pre` **밖**에 absolute로 얹고 `pre`의 `padding-left`로 자리를 비웠는데, **`padding-left`는 스크롤 포트가 아니라 스크롤 영역의 일부**다 — `scrollLeft > 0`이면 그 패딩이 왼쪽으로 밀려나면서 코드가 번호가 앉은 x 구간까지 들어온다. 배치(`position: absolute`)는 번호를 **제자리에 남기는** 것까지만 하고, 밀려온 코드를 **가리는** 건 별도로 배경이 해야 하는데 그 한 줄이 없었다. 같은 파일의 `.code-collapse-fade`가 이미 `hsl(var(--muted))`로 같은 문제를 푸는 관용구를 갖고 있었는데도 놓쳤다. ② 색은 CSS 코드 뷰의 gutter(`CssCodeMirror`)에서 `--muted-foreground`를 그대로 베껴왔는데, **그쪽 배경은 투명(=`--background`)이고 이쪽은 `--muted`다** — 대비는 토큰 이름이 아니라 **밑에 깔린 표면**이 정한다(4.76:1 → 4.34:1). ③ 그 겹침을 잡으려고 쓴 e2e가 하마터면 아무것도 증명 못 할 뻔했다: 픽스처(`/e2e-bigjson`) 원소가 15자라 **실제로는 가로 오버플로가 안 나** `scrollLeft`가 0에 머물렀고, "스크롤해도 번호가 안 움직였다"가 **vacuous green**이 된다.
- **재발 방지**: (1) **`overflow-x: auto`인 요소의 패딩으로 자리를 비우고 그 위에 무언가를 얹었으면, 그 얹은 것은 반드시 불투명 배경을 가져야 한다** — 패딩은 스크롤과 함께 움직이기 때문이다. `grep -n "overflow-x: auto" src/**/*.css`로 스크롤 컨테이너를 세고, 각각에 absolute 형제가 얹혀 있으면 `background` 선언 유무를 대조한다. (2) **CSS 값을 다른 셀렉터로 복사할 때는 그 값이 무엇을 전제했는지 함께 옮긴다** — 특히 글자색은 배경 토큰과 쌍이다. `--muted` 표면 위에 `--muted-foreground`를 얹는 조합은 AA 미달이므로 옅은 `--foreground`를 쓴다. 하한은 `styles/__tests__/tokens.test.ts`가 CSS에서 알파를 읽어 blend 대비를 **계산**해 지킨다(토큰 이름 매칭이 아니라 값 계산이라 색을 바꿔도 따라온다). (3) **레이아웃 축 e2e는 "전제 자체"를 첫 줄에서 단언한다** — `expect(pre.scrollWidth - pre.clientWidth).toBeGreaterThan(0)`처럼. 전제가 깨지면 조용한 green이 아니라 그 자리에서 red가 나야 한다. 그리고 새 가드는 **mutation으로 이름표를 확정한다**(배경을 `transparent`로 바꿔 그 테스트만 red가 되는지 실측 — 2026-07-17·07-18에서 이미 두 번 처방된 절차인데, 이번엔 CSS 선언을 대상으로 적용했다). (4) 이 축은 **jsdom으로 원리상 불가**다(layout이 없어 `ch` 환산·정렬·클리핑을 못 본다). CSS 선언 문자열 대조 테스트가 잡는 건 "값이 그대로인가"지 "그 값이 실제로 맞는가"가 아니라는 걸 혼동하지 말 것.
- **관련**: `src/sidepanel/components/code-collapse.css:.code-collapse-gutter`(`background`·`color`·안쪽 반경), `src/sidepanel/lib/codeCollapseShell.ts:renderGutter`(자릿수 → `--code-gutter-digits`), `src/sidepanel/components/doc-section-body.css`·`tiptap-editor.css`(`pre`의 `padding-left`가 `--code-gutter-width`를 읽는 역방향 결합), 그물 `e2e/code-block-collapse.spec.ts`(겹침·정렬·스크롤 기하 3건 + 오버플로 전제 단언)·`src/styles/__tests__/tokens.test.ts`(blend 대비 계산)·`e2e/fixtures/extension.ts`(`/e2e-bigjson` 원소 패딩). 계열: **2026-07-17**(`--accent`==`--muted` — 관용구를 다른 표면으로 옮기며 방향이 뒤집힘), **2026-07-18**(가드의 이름표는 mutation으로 정한다).

## 2026-07-28 — 취소 레인을 훅 하나로 단일화했더니, run보다 오래 사는 두 축(cleanup deps의 의미·sessionRef 소유권)이 남아 각각 회귀를 만들었다

- **영역**: `AI`
- **계열**: `취소래치`, `미검증단언`
- **그물**: `jsdom`
- **증상**: 둘 다 **에러도 토스트도 없이** 품질만 떨어지는 종류라 육안으로 안 잡힌다. ① AI 진행 중 provider(BYOK/모델)를 바꾸면 세션은 죽는데 로딩 오버레이와 `중단` 버튼이 요청이 settle될 때까지 남는다 — Chrome 내장 AI는 abort를 무시해 그 지연이 수 초다. ② 스타일링을 중단하고 곧바로 재제출하면, 먼저 시작한 run이 뒤늦게 깨어나 **새 run의 멀티턴 세션에 자기 turn을 실어보내거나**(대화 오염) 그 세션을 destroy한다. 사용자에겐 "AI가 방금 지시를 잊은 것"으로만 보인다.
- **근본 원인**: 리팩터가 `isActive` 술어 하나로 취소 판정을 통일했지만, **run 수명과 무관하게 살아 있는 축 두 개**를 그대로 남겼다. ① **cleanup effect의 deps가 `[createSession]`이라 그 effect의 의미는 "언마운트"가 아니라 "provider 교체"다.** run 정리를 헬퍼의 언마운트 effect로 옮겼는데 그쪽 deps는 안정 참조라 provider 교체에서 발화하지 않는다 — 두 경로가 같아 보여서 `design.md` "통일되는 미세 차이" 표가 이 행을 **"동작 변경: 없음(경로만 이동)"으로 단언**했고, 그 단언이 검증 없이 구현으로 내려갔다. ② **`sessionRef`는 컴포넌트 소유라 run보다 오래 산다.** `await isPromptOverBudget(...)`·`await resolveInlineImagesForSections(...)`에서 재개한 뒤 `sessionRef.current`를 **다시 읽으면** 그건 이미 다음 run의 세션이다. 취소 레인은 "이 run이 유효한가"를 통일했을 뿐 "이 세션이 내 것인가"는 다루지 않는다 — 두 질문이 다르다는 게 안 보였다.
- **재발 방지**: (1) **effect cleanup의 deps가 `[]`가 아니면 그 cleanup은 언마운트 전용이 아니다.** 정리 로직을 훅으로 옮길 때 deps에 실린 값의 의미(여기선 provider identity)가 함께 옮겨지는지 확인한다 — 전수: `grep -rn "return () =>" src/sidepanel --include=*.tsx -A0 -B8 | grep -n "}, \[.\+\]"`로 비어 있지 않은 deps를 가진 cleanup을 뽑고, 각각 "이게 언제 도는가"를 답한다. 헬퍼로 옮겼다면 그 경로를 덮는 테스트는 **언마운트가 아니라 prop만 바꾼 rerender**여야 한다(`AiDraftDialog.test.tsx`의 "provider가 교체되면 …" 케이스가 선례 — 언마운트 케이스는 이 회귀를 통과시킨다). (2) **await 재개 지점에서 ref를 다시 읽지 않는다** — 비동기 작업이 잡은 리소스는 시작 시점에 **지역 변수**로 고정한다. 전수: `grep -n "await" src/sidepanel/tabs/AiDraftDialog.tsx src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`로 재개 지점을 뽑고, 그 아래에서 `Ref.current`를 읽는 자리가 있는지 본다. "취소 가드가 있으니 안전"은 답이 아니다 — 가드는 *결과 적용*을 막을 뿐, 가드 이전에 ref를 만지는 부수효과(세션 destroy 등)는 못 막는다. (3) **설계 문서의 "동작 변경 없음" 셀은 단언이지 사실이 아니다.** 리팩터 표에 그렇게 적힌 행은 구현 전에 각각 "그럼 이 경로에서는?"을 한 번씩 물어야 한다 — 이번엔 세 검증 관점이 **독립적으로 같은 행**을 지목해서야 드러났다. (4) 두 픽스 모두 **뮤테이션으로 그물을 확인**했다(가드만 되돌려 red 확인 후 복구) — 취소 계열은 "테스트가 green이니 됐다"가 반복해서 거짓이었으므로(2026-07-28 signal mock 항목) 그물의 비공허성을 증명한 뒤에만 닫는다.
- **관련**: `src/sidepanel/hooks/useAiRun.ts`(`disposeCurrent` — 언마운트와 provider 교체가 공유하는 단일 정리 경로), `src/sidepanel/tabs/AiDraftDialog.tsx`·`src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`(run-local 세션 + 예산 확인 뒤 가드, `[createSession]` cleanup에서 `disposeCurrent()` 호출), 가드 `src/sidepanel/tabs/__tests__/AiDraftDialog.test.tsx`·`src/sidepanel/tabs/styleEditor/__tests__/AiStylingDialog.test.tsx`(provider 교체 rerender · 중단 후 재제출 2종), 설계 정본 `docs/ARCHITECTURE.md`("AI 취소"). 선행 회고: **2026-07-28**(같은 리팩터가 겨냥한 원 함정)·**2026-07-21**(3콜사이트 복제).

## 2026-07-28 — 리뷰가 "abort 누락"이라 부른 것이 re-adopt의 생명줄이었고, signal을 무시하는 mock이 그 회귀를 green으로 통과시켰다

- **영역**: `AI`
- **계열**: `미검증단언`, `취소래치`
- **그물**: `jsdom`
- **증상**: 재현 단계 AI 자동 채움이 진행 중일 때 게이트를 왕복하면(트림 오버레이 개폐·섹션 토글 등) `stepsToReproduce`가 **영구히 안 채워지고** 그 위에 실패 토스트까지 떴다. `reproPrefillDone`이 이미 래치돼 재시도도 없다. 출하 전에 잡았지만 `pnpm test` 4236개가 **전부 green인 채로** 커밋 직전까지 갔다.
- **근본 원인**: `/code-review`가 "cleanup에 `controller.abort()`가 없다"를 🟡로 지목했고 그대로 1줄을 넣었는데, **그 부재가 설계였다.** effect cleanup은 언마운트와 deps 변경 재실행을 구분하지 못한다. 그래서 `cancelled`는 "비자발 취소 — 되살릴 수 있음"으로 정의돼 있고, 게이트가 다시 열리면 상단 re-adopt 분기가 `prev.cancelled = false`로 **같은 in-flight 요청을 되살려** 결과를 이어받는다(`useReproPrefill.ts:92-100`). cleanup에서 진짜로 끊으면 되살릴 요청이 이미 죽어 있고, 되살아난 `cancelled=false` 탓에 catch의 `if (!run.cancelled)` 가드까지 통과해 AbortError 토스트가 뜬다. abort가 정당한 자리는 `userCancelled`를 함께 세우는 canceller뿐이다 — 거기만 re-adopt가 되살리지 않는다.
- **재발 방지**:
  1. **AbortSignal을 넘기는 코드에 회귀 테스트를 걸 땐 mock이 signal을 존중하는지 먼저 본다.** 이 함정을 막으려고 존재하던 테스트("in-flight 중 게이트가 껐다 켜져도 …이어받는다")가 green이었던 이유는 `generateReproStepsWithAI` mock이 `input.signal`을 그냥 버려서다. `grep -rn "signal" src/sidepanel/**/__tests__/` 로 signal을 받는 mock을 훑고, 단언이 결과값에만 걸려 있으면 `signal.aborted`를 직접 단언하는 케이스를 더한다. 픽스 검증은 "테스트가 green"이 아니라 **문제 코드를 임시로 되돌려 red를 확인**해야 성립한다(이번에도 그렇게 해서 새 케이스만 red, 기존 케이스는 여전히 green임을 확인했다).
  2. **취소 레인이 둘 이상이면(되살릴 수 있는 취소 / 영구 포기) abort는 되살리지 않는 레인에만 건다.** `grep -rn "controller.abort()\|userCancelled" src/sidepanel`로 콜사이트를 전수하고 각 abort 옆에 되살림 분기가 있는지 본다. cleanup처럼 **호출 이유를 구분할 수 없는 자리**엔 파괴적 동작을 넣지 않는다.
  3. **리뷰 리포트의 "누락" 판정은 그 부재가 의도인지 먼저 확인한다.** 방어 코드가 없는 게 아니라 **없어야 하는** 경우가 있다 — 근처 주석·되살림 분기·기존 테스트 제목이 그 근거를 들고 있었다.
- **관련**: `src/sidepanel/hooks/useReproPrefill.ts:92-100`(re-adopt 분기)·`:122-128`(canceller — `userCancelled`와 함께 abort)·`:154-160`(cleanup, abort 금지 근거 주석), 그물 `src/sidepanel/hooks/__tests__/useReproPrefill.test.tsx`("게이트 왕복 cleanup은 in-flight 요청을 abort하지 않는다" — `signal.aborted` 직접 단언). 계열: 같은 날 **2026-07-28**(같은 `미검증단언` — 그때는 설계 문서·헬퍼 계약을 실측 없이 전제), 취소 레인은 **2026-07-16/17**과 같은 구역.

## 2026-07-28 — 계약을 구현 대신 문서·직관으로 읽어 방어 코드 3개가 조용히 무력화됐다 (소비형 가드·falsy resolve·손으로 맞춘 화이트리스트)

- **영역**: `미디어`, `store`, `background`
- **계열**: `미검증단언`, `fail-open`, `드리프트`
- **그물**: `unit`
- **증상**: recording-trim 구현 중 **셋 다 green인 채로** 커밋 직전까지 갔다. ① 녹화 정지 직후 취소를 누르면 아무 일도 안 일어나고 그대로 작성 화면으로 커밋된다(취소 버튼은 살아 있다). ② 트림본 로그 저장이 실패해도 사용자에게 아무 안내가 없다 — 재오픈하면 "잘린 영상 + 안 잘린 로그"가 된다. ③ 새로 추가한 `trim_source` 지표가 PostHog에 **도달하지 않는다**(전송은 되고 수신에서 버려진다).
- **근본 원인**: 세 방어가 전부 **"이 함수는 이렇게 동작할 것"이라는 미검증 전제** 위에 세워졌다. 셋 다 구현을 열어보면 5초면 반증됐다.
  1. **소비형 가드의 창을 이미 닫은 뒤에 await을 추가했다.** `createFinalizeGuard().end(id)`는 `win = null`로 **창을 소비**한다(`video-recorder.ts:47-52`). `end()` 뒤에 `await syncAndSettleLogs`를 두면 그 구간엔 `state === null`이라 `cancelRecording()`이 `finalizing.cancel()` → `win === null` → `false` → 그냥 return. 즉 **취소가 통째로 no-op**이 되고 continuation이 커밋을 밀어붙인다. 이건 같은 파일 상단 주석(*"state가 null이라 cancelRecording이 통째로 no-op이 되어 취소가 씹히고 녹화가 drafting으로 커밋됐다"*)이 명시한 그 버그의 재발이고, `__tests__/video-recorder.test.ts`가 `end()` 후 `cancel()`이 `false`임을 이미 단언하고 있었다. **경계를 만드는 호출 뒤에 await을 넣으면 경계가 뒤로 밀리는 게 아니라 사라진다.**
     - 선행 오염: `docs/features/recording-trim/design.md`가 `finalizing.end(finalizeId) === "commit"`이라는 **실존하지 않는 조건문**을 지시했다(실제는 `=== "discard"` 조기 리턴). 그대로 조건을 *추가*했다면 두 번째 `end()`가 항상 `"discard"`를 반환해 **모든 녹화가 조용히 폐기**됐다.
  2. **`Promise.allSettled` + `status === "rejected"`를 썼는데 그 Promise는 reject하지 않는다.** `blob-db`의 save 헬퍼 9개가 전부 내부 `try/catch`로 삼키고 `Promise<boolean>`을 **resolve**한다(`return false;` 9곳). 그래서 실패 감지가 **런타임에 절대 발화하지 않는 죽은 코드**였고, design.md가 "위험 8"로 식별해 둔 위험이 코드로는 전혀 막히지 않았다. 테스트 mock도 `async () => true`뿐이라 false 경로가 없어 그냥 통과했다.
  3. **양쪽을 손으로 맞추는 계약인데 한쪽만 늘렸다.** `background/analytics.ts:26`의 `ALLOWED_EVENTS.issue_submitted`는 사이드패널 송신부와 손으로 동기화하는 화이트리스트다. `track-submit.ts`에 `trim_source`를 추가하고 배선까지 했지만 허용목록은 4키 그대로라 `filterProperties`가 통째로 버렸다. 양쪽 테스트가 각자 자기 숫자(송신 5키 / 수신 4키)를 하드코딩해 **둘 다 green**이었다. 게다가 이건 privacy 문서로 연쇄된다 — 고치기 전에 `docs/privacy.*`에 `trim_source`를 적었으면 **거짓 서술**이 됐다.
- **재발 방지**:
  1. **소비형(one-shot) 가드 뒤에 await을 추가하지 않는다.** `grep -n "finalizing\.\(end\|cancel\|begin\)" src/sidepanel/video-recorder.ts`로 창의 시작·끝을 뽑고, 그 사이에 새 `await`을 넣을 때는 **그 구간에서 취소·이중 stop이 어떻게 처리되는지** 먼저 확인한다. 이번엔 settle을 `end()` **앞**으로 옮겨 해결했다(`video-recorder.ts:136` → `:141`). 같은 형태(`begin/end`가 상태를 소비하는 가드)를 새로 만들면 "창 안에서만 유효" 주석을 함수 옆에 박는다.
  2. **`allSettled`의 `rejected` 판정 전에 그 Promise가 실제로 reject하는지 구현을 연다.** 이 저장소의 `src/store/blob-db.ts`는 **전 함수가 catch-and-return-falsy 패턴**이다 — `grep -c "return false;" src/store/blob-db.ts`(현재 9). 판정은 `r.status === "rejected" || r.value === false`처럼 **값까지** 봐야 하고, 회귀 테스트는 mock을 `mockResolvedValueOnce(false)`로 걸어야 잡힌다(`apply-trim.test.ts`의 "IDB save가 false를 resolve하면 TrimLogsPersistError로 알린다").
  3. **손으로 맞추는 계약은 한쪽을 다른 쪽에 실제로 먹여 보는 대조 테스트로 잠근다.** 양쪽이 각자 리터럴을 단언하면 드리프트가 안 잡힌다. `analytics.test.ts`에 `submitEventProperties(...)` → `filterProperties(...)` 왕복이 항등인지 보는 테스트를 추가했다. 같은 구조를 찾으려면 `grep -rn "ALLOWED_EVENTS\|BG_REQUEST_TYPES" src/background/` — 메시지 union 3곳 일치도 같은 계열이다.
  4. **설계 문서의 코드 인용은 구현으로 검증하고 착수한다.** 이번엔 `/feature-review`의 CTO 에이전트가 ①의 선행 오염(존재하지 않는 조건문)을 **구현 전에** 잡았고, `/code-review`의 dataflow·codehealth가 ①의 실제 발생과 ②를, `/doc-check`의 3개 에이전트가 독립적으로 ③을 잡았다. 리뷰 단계가 없었으면 셋 다 나갔다 — 문서를 계획 원본으로 쓰는 `/ship bypass` 경로에서 특히 위험하다.
- **관련**: `src/sidepanel/video-recorder.ts:47-52`(`createFinalizeGuard.end` — 창 소비)·`:136-141`(settle을 `end()` 앞으로), `src/sidepanel/30s-replay/apply-trim.ts:143-147`(`settleLogSaves` — 값 판정)·`:56`(`TrimLogsPersistError`), `src/store/blob-db.ts`(save 9종 catch-and-false), `src/background/analytics.ts:26`(`ALLOWED_EVENTS`)·`src/sidepanel/lib/track-submit.ts:21`, 그물 `src/background/__tests__/analytics.test.ts`(송신↔허용목록 왕복)·`src/sidepanel/30s-replay/__tests__/apply-trim.test.ts`(false resolve)·`src/sidepanel/__tests__/video-recorder.test.ts`(`end()` 후 `cancel()`=false). 계열: **2026-07-27**×2(같은 `미검증단언` — 그때는 기록·권한 문서를 실측 없이 확장 추론).

## 2026-07-27 — 최종 본문은 복수 스타일 요소를 합쳤지만 AI 초안 경로는 현재 selector 하나만 전송했다

- **영역**: `AI`, `에디터`
- **계열**: `드리프트`
- **그물**: `unit`
- **증상**: 여러 DOM 요소의 스타일을 차례로 수정한 뒤 AI 초안을 작성하면, 모델이 전체 변경이 아니라 마지막으로 선택한 selector 하나의 변경처럼 리포트를 작성했다. 버퍼 요소만 변경되고 현재 선택은 무변경인 경우에는 selector와 diff가 서로 다른 요소를 가리킬 수도 있었다.
- **근본 원인**: 최종 이슈 본문과 스타일 변경 표는 `mergeStyleElements(bufferedElements, current)`를 사용했지만, AI 다이얼로그 prop과 프롬프트 컨텍스트는 현재 `selection`의 `selector`·`tagName`·`styleEdits`만 별도로 조립했다. 같은 캡처 상태를 소비하는 두 출력 경로가 서로 다른 데이터 모델을 사용해 저장은 정상인데 LLM endpoint 경계에서 복수 요소 정보가 소실됐다.
- **재발 방지**: 캡처 상태를 새 소비처로 전달할 때 `grep -rn 'mergeStyleElements\|bufferedElements\|styleElements\|elementDiffs' src/sidepanel`로 최종 본문·미리보기·AI 요청의 입력 모델을 함께 대조한다. 복수 요소 selector 보존, 버퍼만 변경+현재 무변경, frameId 구분, compact/rich 전역 diff·이미지 cap을 요청 경계 단위 테스트로 고정한다.
- **관련**: `src/sidepanel/tabs/DraftingPanel.tsx`(`styleElements`), `src/sidepanel/tabs/AiDraftDialog.tsx`(`AiDraftDialog`), `src/sidepanel/lib/prompts/draftStyleElements.ts`(`resolveAiDraftStyleElements`), `src/sidepanel/lib/buildAiDraftRequest.ts`(`buildAiDraftRequest`).

## 2026-07-27 — 정적 스킴 화이트리스트가 런타임 권한 토글을 안 봐서, 파일 접근 ON인데도 https→file: 이동에 패널이 닫혔다

- **영역**: `background`
- **계열**: `미검증단언`, `라이브러리전제`
- **그물**: `unit`
- **증상**: "파일 URL 액세스" 토글이 **ON**인데도, `https://` 페이지에서 `file://`로 탭 내 이동하면 사이드패널이 닫혔다. 토글 ON이면 `<all_urls>`가 file:을 영속 커버해 캡처가 되는데도 deactivate 분기를 탔다.
- **근본 원인**: `isBroadCoveredUrl`이 커버 판정을 `BROAD_COVERED_SCHEMES`(http/https) **정적 집합**으로만 했고, file:은 무조건 배제였다. 주석은 "file: 캡처는 별도 토글 요구라 배제"라고만 적어 **토글 ON이면 커버된다는 반대 케이스를 통째로 빠뜨렸다.** 커버 능력은 스킴만으로 정해지지 않고 **런타임 권한 토글(`chrome.extension.isAllowedFileSchemeAccess()`)에 묶인다** — 정적 화이트리스트가 그 축을 접었다.
- **재발 방지**:
  1. **"이 스킴은 못 한다"류 정적 배제는 런타임 권한 축이 붙는지 먼저 본다.** file:은 스킴이 아니라 사용자 토글이 게이트다. `grep -rn 'BROAD_COVERED_SCHEMES\|isBroadCoveredUrl\|SUPPORTED_SCHEMES' src/`로 스킴 집합 판정부를 소환해, 각 판정이 정적으로 끝나도 되는지(권한 토글·`isAllowedFileSchemeAccess`에 의존해야 하는지) 재확인.
  2. **주석이 "왜 배제"만 적고 반대 조건을 안 적었으면 그게 빠진 분기 신호다.** "X라서 배제"는 "X가 아니면?"을 강제로 묻게 한다.
  3. **activeTab의 file 스킴 커버는 시점 비대칭이다(실측).** 토글 OFF여도 file:// 페이지에서 **아이콘 클릭(fresh invoke)**하면 activeTab이 file 스킴까지 커버해 캡처·picker·`tab.url` 판독이 된다(2026-07-27 실측 — 문서상 "activeTab은 file 못 준다" 예측과 어긋남). 단 **크로스오리진 네비게이션은 그 grant를 회수**하므로 https→file: 이동 후엔 토글 OFF면 캡처 불가 — 이 비대칭이 "토글 ON일 때만 keep"의 근거다. `grep -rn 'isAllowedFileSchemeAccess\|activeTab' src/ docs/`.
  4. **파생부 테스트를 이번엔 걸었다(2026-07-27 상단 회귀 대응 계승).** `deactivatePanelIfCrossOrigin`이 export라, async 파생 줄(`isAllowedFileSchemeAccess` resolve → `isBroadCoveredUrl` 주입)을 `chrome.extension` 스텁 + 리스너 직접 호출로 행동 레벨 잠금. 순수함수(`isBroadCoveredUrl`)만이 아니라 파생부까지 커버.
- **관련**: `src/background/tab-bindings.ts`(`isBroadCoveredUrl`·`deactivatePanelIfCrossOrigin`), `src/background/__tests__/tab-bindings.test.ts`, `src/sidepanel/hooks/useTabSupport.ts`(:7-8 주석이 "file:+토글 off → 빈 tab.url"이라 단언하나 실측 반증 — stale 정정 후보), `docs/ARCHITECTURE.md`·`docs/PERMISSION.md` 패널 종료/유지 정책.

## 2026-07-27 — 검증 안 된 "권한상 못 읽는다"가 설계를 한 단계 크게 만들 뻔했다 (+ 상태 키를 안 갱신해 기능이 hop 1에서만 살았다)

- **영역**: `background`
- **계열**: `미검증단언`, `드리프트`
- **그물**: `unit`
- **증상**: (사전 차단) 미지원 URL 이동 시 패널을 살리는 Phase 2가 **① 착수 자체를 막을 뻔했고 ② 구현 후에도 첫 이동에서만 동작했다.** ①은 "background가 새 URL을 못 읽으니 `webNavigation` 권한 배관을 더하거나 기능을 별도로 분리해야 한다"는 판단이었고, ②는 `https → chrome://settings`(패널 유지 ✅) → `chrome://downloads`(패널 닫힘 ❌).
- **근본 원인 ①**: 저장소에 *"`chrome://` 탭은 `tab.url`을 못 읽는다(호스트 권한 밖)"*(`e2e/unsupported-url.spec.ts:3`)는 **참인** 기록이 있었다. 거기서 "그러니 네비게이션 중의 `changeInfo.url`도 redact된다"로 넘어간 **확장 추론이 검증 없이 설계에 박혔다.** 리뷰 에이전트 3명이 독립적으로 같은 결론을 냈고(같은 문장을 근거로), 기획 문서는 그걸 전제로 "webNavigation 프로브 → 실패 시 별도 feature 분리"라는 게이트까지 만들었다. 실측하니 정반대였다 — `status:"loading"` 시점(= `deactivatePanelIfCrossOrigin` 호출 시점)의 `changeInfo.url`에는 `chrome://settings/`가 **그대로 실려 온다**. 원 기록은 **정착된** 탭을 말한 것이고, 그 둘은 다른 시점이다. 새 권한도 새 배관도 필요 없었다.
- **근본 원인 ②**: `sidePanel:url:{tabId}`는 `activateTab`에서 **한 번만** 쓰이고 이후 갱신되지 않는다(`deactivate`도 이 키는 안 지운다 — 지우는 곳은 `onRemoved`뿐). 그래서 hop 2에서 `refUrl`은 여전히 최초 https URL이다. 게다가 그때는 activeTab 그랜트가 회수돼 새 URL이 판독 불가라, "판독 불가 → `file:` 보호를 위해 현행 `deactivate`"라는 보수적 폴백이 **의도한 적 없는 케이스(미지원 → 미지원 이동)까지 삼켰다.** 순수함수 표는 촘촘했지만 그 표의 **입력을 만드는 파생 3줄**(`info.url ?? tab.url` → `readable` → `supported`)에 테스트가 0개였고, 이 결함도 같은 자리의 `!= null`(빈 문자열을 "판독됨"으로 통과시킴)도 전부 거기 있었다.
- **재발 방지**:
  1. **"권한상 못 읽는다"류 제약은 시점을 명시해 기록하고, 다른 시점으로 확장하기 전에 실측한다.** 같은 API라도 navigation 중(`changeInfo`)·정착 후(`tab.url`)·이벤트 종류별로 가시성이 다르다. `grep -rn 'redact\|호스트 권한 밖\|못 읽' src/ e2e/ docs/`로 기존 기록을 소환하되, 그 문장이 **어느 시점**을 말하는지 확인하고 인용한다.
  2. **권한 추가·기능 분리를 결론으로 내기 전에 30줄짜리 프로브를 먼저 붙인다.** 이번엔 `chrome.webNavigation.onCommitted`·`tabs.onUpdated`·`isAllowedFileSchemeAccess`를 한 번에 찍는 임시 리스너 하나로 3분 만에 판정됐고, 그 결과가 "별도 feature 분리"를 취소시켰다. 비용 대비 회수가 압도적이다.
  3. **순수함수 표를 늘릴 때 그 표의 입력을 만드는 파생부에도 테스트가 있는지 확인한다.** 표가 촘촘할수록 "검증됐다"는 착시가 커진다. 대상: `grep -n 'resolveNavigationAction({' src/background/tab-bindings.ts` 같은 호출부. `describe("activateTab")`이 이미 `chrome` 스텁으로 background를 직접 두드리는 선례를 만들어 뒀으므로 `setupTabBindings()` + 리스너 직접 호출로 행동 레벨 잠금이 가능하다.
  4. **`url != null` 대신 `Boolean(url)`.** 이 저장소의 URL 소비자(`isSupportedUrl`·`originOf`·`pageKeyOf`·`isBroadCoveredUrl`·`activateTab`)는 전부 빈 문자열을 "없음"으로 취급한다. 한 곳만 `!= null`을 쓰면 자기모순 입력 튜플이 만들어진다.
  5. **"상태 키를 언제 갱신하나"를 기능 추가 시 함께 본다.** 이동 판정이 참조하는 키가 이동마다 갱신되지 않으면 그 기능은 첫 이동에서만 산다. POSTMORTEM 2026-07-26의 "열린다 vs 열린 채로 있다"와 같은 계열 — 이번엔 "한 번 유지된다 vs 계속 유지된다"였다.
- **관련**: `src/background/tab-bindings.ts`(`resolveNavigationAction`·`deactivatePanelIfCrossOrigin`), `src/background/__tests__/tab-bindings.test.ts`, `e2e/activetab-broad-permission.spec.ts`, `docs/ARCHITECTURE.md` 패널 종료/유지 정책 표.

## 2026-07-26 — 설계 문서가 "Phase 2 문제"로 분류한 가드가 실은 Phase 1의 전제였다 (+ jsdom×chrome 스텁 2함정)

- **영역**: `background`
- **계열**: `미검증단언`
- **그물**: `e2e`
- **증상**: (사전 차단) `activateTab`의 미지원 가드만 지우면 미지원 페이지에서 패널이 열리지만, **다음 탭 전환·네비게이션에 조용히 다시 닫힌다.** 설계 문서는 이 수정(`apply()`의 `supported` 조건 제거)을 Phase 2 태스크로 두고 *"안 고치면 Phase 2가 무효화된다"*고만 적어, Phase 1 단독 커밋이 목표를 달성한다고 읽혔다. 단위·타입체크·e2e 전부 green이라 자동 그물에 안 걸린다(패널 지속성을 관측하는 테스트가 0개).
- **근본 원인**: `apply()`가 **수동 reader처럼 이름 붙어 있지만 실제로는 disable 액션**이다 — `if (!(activated && supported)) setOptions({enabled:false})`. 설계 검토가 `activateTab`(쓰기)만 "표시 결정" 경로로 보고 `apply()`는 "재적용" 이름값대로 읽기 취급했다. 호출 경로가 셋(`onActivated`, `onUpdated`+`info.url`, `onUpdated`+`status==="complete"`)이라 사용자가 탭을 한 번 오가는 것만으로 발화하고, `shouldPreserveSession` 조기 반환은 idle 세션에선 보호막이 아니다. **불변식을 한쪽(진입점)에서만 바꾸면 그 불변식을 강제하는 다른 지점이 원복시킨다.**
- **재발 방지**: (1) **불변식을 바꿀 때는 그 불변식을 *쓰는* 곳이 아니라 *강제하는* 곳을 전수 grep한다** — 이번 경우 `grep -n 'enabled: false\|setActivated' src/background/tab-bindings.ts`가 `apply()`·`deactivatePanelIfCrossOrigin` 둘을 즉시 드러낸다. 함수명이 read-only처럼 보이는 것(`apply`·`sync`·`refresh`)일수록 본문의 부수효과를 직접 읽어야 한다. (2) **"열린다"와 "열린 채로 있다"를 별개 성공 기준으로 쓴다** — 실물 프로브도 오픈만 확인하면 지속성 회귀를 놓친다(수동 체크리스트에 "다른 탭 갔다 복귀" 추가). (3) feature 문서의 Phase 분리는 **각 Phase 단독 배포가 일관된지**로 검증한다 — `/feature-review`의 CTO·QA 관점에 이 질문을 명시적으로 넣는다.
- **부수 함정 2건 (jsdom에서 chrome을 스텁하는 최초 사례라 둘 다 저장소 선례가 없었다)**:
  - **`afterEach` 등록 역순**: vitest는 afterEach를 등록 역순으로 실행한다. `src/test/setup-dom.ts`가 `afterEach(cleanup)`을 먼저 등록하므로, 테스트 파일의 `afterEach(vi.unstubAllGlobals)`가 **먼저** 돌고 그 뒤 RTL 언마운트가 일어나 훅 cleanup의 `chrome.tabs.onUpdated.removeListener`가 `chrome is not defined`로 죽는다. → 테스트 파일에서 `cleanup()`을 명시적으로 먼저 호출한 뒤 unstub한다. 대상: `grep -rln 'stubGlobal("chrome"' $(git ls-files '*.test.tsx')`.
  - **`vi.mock` 팩토리 호이스팅**: 팩토리는 파일 최상단으로 끌어올려지므로 top-level 변수(`const resolved = () => vi.fn(...)`)를 참조하면 `Cannot access before initialization`으로 **수집 자체가 실패**한다(테스트 0개 실행 → "no tests"라 red 사유가 안 보인다). 팩토리 안에 인라인할 것.
- **부수 함정 3건**: 계획 문서가 지시한 순수 술어 추출(`debugTabGates.ts`)이 **같은 커밋에서 근거를 잃었다** — 추출 이유는 "DebugTab 풀 렌더가 tiptap·sonner를 끌어와 비싸다"였는데, 서브탭 본체를 `vi.mock`으로 갈면 셸만 싸게 렌더된다는 걸 테스트 작성 중에 알게 됐다. 계획을 그대로 따랐더니 64줄이 4줄 조건식을 감싸고 `EditorPhase` 타입까지 잃었다. → **tasks.md의 "테스트가 어려우니 추출한다" 지시는 실제로 테스트를 써 본 뒤 재확인한다.**
- **관련**: `src/background/tab-bindings.ts`(`activateTab`·`apply`), `src/sidepanel/hooks/useTabSupport.ts`, `src/sidepanel/hooks/__tests__/useTabSupport.test.tsx`, `src/sidepanel/tabs/__tests__/DebugTab.test.tsx`.

## 2026-07-26 — 감사 리포트가 지목한 "1줄 수정"이 프로토콜을 깨뜨리는 경우 (A-51/A-04)

- **영역**: `content`
- **계열**: `미검증단언`
- **그물**: `e2e`
- **증상**: 감사 항목 A-51의 처방("`OFFSET_REQ`도 PRESENT처럼 `data.token !== frameToken`이면 거부 — 1줄")을 그대로 적용하면 **모든 iframe 요소 캡처가 조용히 실패**한다. 유닛·타입체크는 통과하고, iframe 캡처는 e2e 커버가 없어 빨강도 안 뜬다.
- **근본 원인**: 같은 이름의 필드가 두 메시지에서 **다른 것을 뜻했다.** `PRESENT`의 `token`은 사이드패널이 `picker.start`로 broadcast한 **세션 토큰**이고, `OFFSET_REQ`의 `token`은 자식이 `crypto.randomUUID()`로 만들어 응답을 짝짓는 **1회성 correlation nonce**다. 리포트는 "한쪽만 대조를 안 한다"는 표면 비대칭을 보고 처방을 냈고, 그 비대칭은 결함이 아니라 **의미 차이**였다. 부수적으로 A-04(토큰이 `postMessage(..., "*")`로 페이지에 노출)를 파고들다 보니 원 서술의 위협 전제도 과대평가였음이 드러났다 — picker는 `all_frames: true`라 **악성 페이지가 만든 iframe에도 진짜 picker가 주입돼 정상 announce로 등록된다.** 토큰을 훔칠 필요가 없다. 즉 유출의 실제 증분 위험은 "picker가 없는 iframe(sandbox·2-depth+)을 등록시키는 것"뿐이다.
- **재발 방지**: (1) **감사·리뷰 리포트의 "1줄 수정"은 그 줄이 읽는 값이 어디서 오는지를 먼저 역추적한다** — 특히 같은 이름의 필드가 여러 메시지 타입에 걸쳐 있으면(`grep -n 'token' src/content/frame-geometry.ts`) 이름이 아니라 **생성 지점**으로 동일성을 판단한다. 여기선 `requestFrameOffset`의 `crypto.randomUUID()` 한 줄이 답이었다. (2) **e2e 커버가 없는 영역의 리포트 처방은 "적용 후 유닛 green"을 근거로 삼지 않는다** — iframe picker·OAuth가 그 영역이다. 처방을 코드로 옮기기 전에 프로토콜 양쪽 끝(발신·수신)을 같이 읽는다. (3) **보안 처방은 위협 전제부터 재확인한다** — "값이 새면 위조 가능"은 공격자가 그 값 없이는 같은 결과를 못 얻을 때만 성립한다. `all_frames` 주입처럼 공격자가 정공법으로 같은 상태를 만들 수 있으면 그 값은 애초에 인증 수단이 아니다. 결론은 코드가 아니라 문서(`docs/ARCHITECTURE.md` "등록 핸드셰이크" 경고 블록)에 남겼다.
- **관련**: `src/content/frame-geometry.ts`(`OFFSET_REQ`에 세션 토큰을 별도 `frameToken` 필드로 추가·`childFrames` WeakSet 세션 교체), `requestFrameOffset`(nonce 생성 지점), `docs/ARCHITECTURE.md`·`CLAUDE.md`(registry는 인증이 아니라 힌트), `docs/features/audit-remediation/tasks.md`("A-04 재결정").

## 2026-07-26 — zustand persist 병합은 "키 없음"과 "명시적 undefined"를 구분한다 (A-11)

- **영역**: `store`
- **계열**: `라이브러리전제`
- **그물**: `unit`
- **증상**: `saveDraft`를 통째 교체에서 병합(`{...existing, ...record}`)으로 바꾸자, 사용자가 지운 버퍼 요소·해제한 요소 selector가 **재확정 한 번에 되살아날 수** 있는 상태가 됐다. 원 결함(patchIssue로만 세팅되는 `logsAttached`·`attachments`가 재확정에 사라짐)은 고쳐지지만 반대 방향 구멍이 열린다.
- **근본 원인**: `confirmDraft`가 만드는 record에 **조건부 스프레드**(`...(state.bufferedElements.length > 0 ? {...} : {})`)가 있었다. 통째 교체 시절엔 키가 없으면 결과에도 없어서 동작이 같았지만, 병합에서는 **"키 없음 = 기존 값 유지"**로 의미가 뒤집힌다. 반면 `networkLogBlobKey: logs.networkLog ? id : undefined`처럼 **값이 undefined인 키는 스프레드가 그대로 덮어써서** 의도대로 비워진다 — 두 표기의 차이가 병합 도입 순간 동작 차이가 된다.
- **재발 방지**: (1) **교체 → 병합 전환 시 소스 객체의 조건부 스프레드를 전수한다** — `grep -n '\.\.\.(' src/store/editor-store.ts`. 조건부 스프레드는 전부 `key: cond ? v : undefined` 형태로 펴서 "비운다"는 의도를 명시로 만든다. (2) **"의도적으로 비운 필드"가 있는지는 소비처가 아니라 생산처(record를 만드는 함수)에서 확인한다** — `removeBufferedElement`·`resetAllStyleEdits`처럼 상태를 비우는 액션이 존재하면 그 필드는 반드시 명시 undefined여야 한다. (3) 회귀 테스트는 양방향으로 둔다 — "record에 없는 필드는 살아남는다" + "record가 undefined로 명시한 필드는 비워진다".
- **관련**: `src/store/issues-store.ts:saveDraft`(병합), `src/store/editor-store.ts:confirmDraft`(`bufferedElements`·`selector`/`tagName` 조건부 스프레드 → 명시 키), 그물 `src/store/__tests__/issues-store.test.ts`("saveDraft — 재확정 시 optional 필드 보존").

## 2026-07-26 — 프로덕션에선 옳은 `tab.active` 가드가 e2e 하네스의 구조적 전제를 깨서 캡처 spec이 전멸

- **영역**: `e2e`, `background`
- **계열**: `드리프트`
- **그물**: `e2e`
- **증상**: 캡처 소유권 가드(A-05)를 background 관문에 넣자 `capture-methods.spec.ts`의 "screenshot 뷰포트 캡처 → drafting 진입"이 40초 타임아웃으로 죽었다. 같은 파일의 "스크롤 캡처"는 통과해서 원인이 캡처 관문으로 안 보였다. `pnpm test --run`·`pnpm typecheck`는 둘 다 green이라 **e2e만이 유일한 검출 경로**였다.
- **근본 원인**: e2e 하네스의 `openPanel`은 사이드패널을 `context.newPage()`로 **탭**으로 연다(실제 제품에선 사이드패널이 탭이 아니다). 그래서 패널이 앞에 있으면 fixture 탭의 `tab.active`가 false다. 스크롤 캡처는 **예전부터 자체적으로** 타일마다 `active`를 확인했기 때문에 그 spec만 이미 `fixture.bringToFront()` + `locator.evaluate(el => el.click())` 우회를 갖고 있었고, 그 우회의 이유가 **그 spec 안 주석에만** 적혀 있었다. A-05가 같은 검사를 **모든 캡처 경로가 지나는 관문으로 승격**시키자 우회가 없는 나머지 spec이 무너졌다. 즉 결함은 프로덕션 코드가 아니라 **하네스 전제를 아는 지식이 spec 하나에 갇혀 있던 것** — 가드를 넓히면서 그 지식이 따라 넓어지지 않았다.
- **재발 방지**: (1) **개별 호출처에 있던 가드를 공용 관문으로 승격할 때는, 그 가드를 이미 우회하고 있던 테스트를 먼저 찾아 우회 이유를 확인한다** — `grep -rn 'bringToFront\|el.click()' e2e/`. 우회가 존재한다는 것 자체가 "이 검사는 하네스에서 자연히 성립하지 않는다"는 신호다. (2) 하네스 전제(사이드패널=탭, eval-host 탭 상주 등)는 spec 주석이 아니라 **`e2e/GOTCHAS.md`에 적고, 적용 범위가 넓어지면 그 항목도 같이 넓힌다**. (3) 캡처·탭 소유권처럼 e2e가 유일한 안전망인 영역은 유닛 green을 근거로 삼지 않는다 — 웨이브 사이 `/e2e-run` 게이트가 실제로 잡아낸 사례다.
- **관련**: `src/background/capture-throttle.ts:captureOwnedTab`(가드 본체), `src/background/messages.ts`(`captureVisibleTab` 관문), `e2e/capture-methods.spec.ts`(뷰포트 spec에 우회 적용), `e2e/GOTCHAS.md`(적용 범위 확대 반영), 선례 `src/sidepanel/scroll-capture.ts:isTabActive`.

## 2026-07-26 — persist storage 실패를 "전파하면 안전"으로 일반화하면 사이드패널이 통째로 빈 화면으로 굳는다

- **영역**: `store`
- **계열**: `라이브러리전제`, `fail-open`, `미검증단언`
- **그물**: `unit`
- **증상**: (사전 차단) `chromeLocalStorage.getItem`의 에러 삼킴이 `pruneOrphanBlobs`에 "저장분 없음"으로 읽혀 살아있는 blob을 전부 고아로 삭제하는 결함(A-02)을 고치려 했는데, 설계 문서가 권한 것은 **`chromeLocalStorage.getItem` 전체를 rethrow로 바꾸는 것**이었다. 그대로 했으면 storage 일시 오류 한 번에 사이드패널이 **영구 빈 화면**이 됐다.
- **근본 원인**: 설계 시점의 예측("실패를 전파해도 사용자 눈엔 똑같이 '빈 상태'")이 틀렸다. zustand v5 persist는 rehydrate가 reject하면 `postRehydrationCallback(undefined, error)`만 부르고 **`hasHydrated`를 false로 남긴 채 `onFinishHydration`을 영영 발화하지 않는다**(`node_modules/zustand/middleware.js`). 그런데 `src/sidepanel/App.tsx`는 `useSettingsHydrated()`가 그 `onFinishHydration`을 기다리고 `if (!editorHydrated || !settingsHydrated) return null;`로 **패널 전체 렌더를 막는다**. 즉 storage 어댑터는 공유 모듈이지만 **실패 전파의 결과는 스토어마다 다르다** — 렌더 게이트에 물린 스토어(settings/editor)는 전파가 곧 화면 사망이고, 게이트에 안 물린 스토어(issues)만 전파가 안전하다. 어댑터 파일만 읽어선 이 차이가 안 보인다.
- **재발 방지**: (1) persist storage 어댑터의 에러 정책을 바꿀 땐 **그 어댑터를 쓰는 스토어 전수**를 먼저 뽑고(`grep -rn 'chromeLocalStorage\|createJSONStorage' src/store`), 각 스토어의 hydration이 **렌더 게이트에 물려 있는지** 확인한다(`grep -rn 'onFinishHydration\|hasHydrated\|Hydrated' src/sidepanel`). 하나라도 물려 있으면 공용 어댑터를 바꾸지 말고 **fail-closed 어댑터를 따로 만들어 해당 스토어에만** 연결한다(`failClosedLocalStorage`). (2) 미들웨어의 에러 경로 동작은 추측하지 말고 `node_modules`의 구현을 직접 읽어 확인한다 — "실패해도 빈 상태로 뜨겠지"는 라이브러리가 보장한 적 없는 가정이다. (3) 설계 문서의 위험도 예측은 **착수 시 코드로 재검증**한다. 문서가 틀렸으면 문서도 같은 커밋에서 고친다.
- **관련**: `src/store/chrome-storage.ts`(`chromeLocalStorage` 삼킴 유지 + `failClosedLocalStorage` 신설), `src/store/issues-store.ts`(`shouldPruneAfterRehydrate`·`onRehydrateStorage`), 그물 `src/store/__tests__/issues-store.test.ts`, 렌더 게이트 `src/sidepanel/App.tsx:59-68,208`.

## 2026-07-26 — 복제 사전 그물의 스캔 범위가 번들 그래프보다 좁으면 누락을 못 잡고 조용히 green

- **영역**: `i18n`
- **계열**: `복제본`
- **그물**: `unit`
- **증상**: log-viewer 번들에서 WebSocket 로그 라벨 10개가 i18n 키 문자열 그대로 노출됐다(`networkLog.ws.frames` 등). ko/en 대칭·placeholder 일치·메인 테이블 drift를 다 검사하는 전용 테스트(`src/log-viewer/__tests__/i18n.test.ts`)가 **이미 있었는데도** 계속 green이었다.
- **근본 원인**: 그 테스트의 키 스캐너가 `walk(srcRoot)` — **`src/log-viewer/` 디렉터리만** 훑었다. 하지만 log-viewer 번들은 사이드패널 공용 컴포넌트(`NetworkLogContent`·`ConsoleLogContent`·`ActionLogContent`·`IssuePreviewView`)를 재사용하고, `vite.log-viewer.config.ts`가 `@/i18n`을 복제 사전으로 alias하므로 **그 컴포넌트들의 `t()` 키도 복제 사전에서 해결돼야 한다**. 스캐너의 스캔 범위와 번들러의 실제 모듈 그래프가 어긋난 것 — 검사 대상 집합이 틀리면 검사 내용이 아무리 정교해도 무의미하다. 2026-06-28 회고("복제 dict 미동기화")로 그물을 깔았는데 **그물 자체의 구멍**은 그때 안 잡혔다.
- **재발 방지**: (1) 복제·부분집합 사전을 검사하는 그물은 디렉터리가 아니라 **엔트리에서 출발한 import 그래프 BFS**로 대상을 정한다 — 스캐너를 고쳐 `resolveImport()`(`@/` alias·상대경로·index 해석, `import type` 제외)로 그래프를 타게 했다. 새 공용 컴포넌트가 log-viewer에 유입돼도 자동으로 사정권에 든다. (2) 스캐너류 테스트에는 **자기검증 앵커**를 같이 둔다 — 여기선 "그래프가 `NetworkLogContent` 등 4개에 실제로 도달한다"를 별도 `it`으로 고정했다. 앵커가 없으면 resolver가 조용히 아무것도 못 찾을 때 vacuous green으로 되돌아간다. (3) 트레이드오프를 남긴다: 그래프에 들어오지만 log-viewer가 렌더하지 않는 경로의 키(`common.expand`/`collapse` — `Section`의 collapsible 토글)도 사전을 요구한다. 모듈 그래프로는 렌더 도달성을 못 가리므로 **몇 개 더 넣는 쪽**을 택했다 — 조용한 누락보다 나은 실패 모드.
- **관련**: `src/log-viewer/__tests__/i18n.test.ts`(`resolveImport`·`bundledFiles` BFS·앵커 `it`), `src/log-viewer/i18n.ts`(WS 키 10개 + `common.expand`/`collapse` 추가), `vite.log-viewer.config.ts`(`@/i18n` alias).

## 2026-07-25 — 도구가 청소하는 출력 디렉터리 안에 git-tracked 파일을 두면 매 실행마다 삭제된다

- **영역**: `툴체인`
- **계열**: `라이브러리전제`, `드리프트`
- **그물**: `없음`
- **증상**: 커버리지 트렌드 베이스라인(`coverage/baseline.json`, git-tracked)이 `pnpm test:coverage`를 한 번 돌릴 때마다 워킹트리에서 사라졌다. 그 결과 `pnpm coverage:report`가 "베이스라인 없음"으로 떨어져 이전→지금 비교(래칫 회귀 감지)가 아예 작동하지 않았다.
- **근본 원인**: vitest v8 커버리지는 `reportsDirectory`(기본 `coverage/`)를 매 실행 **청소(clean)**한다 — 그 디렉터리를 자기 스크래치로 소유한다는 전제. 트렌드 기준선을 편의상 같은 `coverage/baseline.json`에 두면서 그 디렉터리가 **도구 소유**라는 걸 놓쳤다. `.gitignore`가 `coverage/*` + `!coverage/baseline.json`로 파일을 tracked로 지켜도, 파일 삭제는 git이 아니라 **vitest가** 하므로 무력하다. 커밋 diff·gitignore만 봐선 "베이스라인 커밋됨"으로 보여 결함이 숨는다 — 실제 실행을 두 번 돌려봐야 드러난다.
- **재발 방지**: (1) 빌드/테스트 도구의 **출력·캐시·리포트 디렉터리 안에 소스나 tracked 산출물을 co-locate하지 않는다** — 도구가 그 디렉터리를 clean/overwrite한다는 전제로 본다. 트렌드·기준선 같은 영속 파일은 도구가 안 건드리는 별도 경로에 둔다(여기선 리포트를 `coverage/report/` 하위로 격리하고 베이스라인은 `coverage/` 루트에 잔류). (2) `clean`·`reportsDirectory`·`outDir`·`cacheDir` 옵션이 있는 도구를 새로 붙일 때 그 청소 범위를 먼저 확인한다 — `grep -rn 'reportsDirectory\|outDir\|cacheDir\|clean' *.config.ts vite*.config.ts vitest.config.ts`. (3) 영속 파일이 실행에 견디는지 **연속 2회 실행 + 파일 존재 확인**으로 잠근다(1회만 돌리면 첫 생성과 삭제가 안 구분된다).
- **관련**: `vitest.config.ts`(coverage `reportsDirectory: "coverage/report"`), `scripts/coverage-report.mjs`(`SUMMARY_PATH`=`coverage/report/…`, `BASELINE_PATH`=`coverage/baseline.json`), `.gitignore`(`coverage/*` + `!coverage/baseline.json`).

## 2026-07-23 — 공유 캡(MAX_LOG_REFS)에 새 후보 소스를 더하면 초과 시 전량 폐기가 기존 삽입까지 죽인다

- **영역**: `AI`
- **계열**: `fail-open`
- **그물**: `unit`
- **증상**: AI 초안이 원인 로그를 코드블럭으로 삽입할 때, 모델이 로그를 여러 개 지목하면 **기존에 잘 삽입되던 에러 로그까지 하나도 안 붙는** 경우가 생긴다(전멸). 200 매칭 후보(`m*`)를 새로 도입하자 발현 확률이 올랐다.
- **근본 원인**: `renderLogRefBlocks`는 resolved ref가 `MAX_LOG_REFS(3)`를 넘으면 `slice`가 아니라 `return []`로 **전부 버렸다**(원래는 "나열 신호로 보고 폐기"라는 의도). 에러 후보(`n*`/`c*`)와 새 매칭 후보(`m*`)가 **같은 3칸을 두고 경쟁**하면서, 에러 2 + 매칭 2 = 4개 인용 시 검증된 에러 로그 삽입까지 통째로 사라졌다. 새 ref 소스를 공유 캡에 얹으면서 그 캡의 초과 정책(drop-all)을 재검토하지 않은 게 핵심. **문서(ARCHITECTURE 불변식 ③·DIRECTORY renderLogRefs)조차 "전량 폐기"를 의도된 동작으로 박아두고 있어** 코드만 봐선 회귀로 안 보였다.
- **재발 방지**: (1) 공유 상한에 **새 후보/ref 소스를 추가할 때는 초과 정책이 drop-all인지 slice인지 반드시 확인**한다 — `grep -rn 'MAX_LOG_REFS\|return \[\]' src/sidepanel/lib/renderLogRefs.ts`. (2) 여러 종류의 ref가 한 캡을 공유하면 **우선순위 정렬**(검증된 것 우선) 후 slice해 기존 가치가 새 소스에 밀려 잘리지 않게 한다(여기선 `ref.startsWith("m")`로 에러 우선). (3) 초과-폐기/절삭은 **단위로 고정**한다 — `["n1","n2","m1","m2"] → 3블록(에러 우선)`을 유닛+e2e로 잠가 다음 소스 추가 때 회귀가 소리 없이 확대되지 않게. (4) 캡 동작을 바꾸면 그 동작을 서술한 **문서(불변식)도 같은 커밋에서** 고친다 — 문서가 옛 동작을 "의도"로 못박으면 회귀 진단이 늦어진다.
- **관련**: `src/sidepanel/lib/renderLogRefs.ts:renderLogRefBlocks`(에러 우선 정렬+slice), `src/sidepanel/lib/prompts/logCandidates.ts:selectMatchedLogCandidates`(새 `m*` 소스), 그물 `src/sidepanel/lib/__tests__/renderLogRefs.test.ts`·`e2e/ai-draft-matching-log.spec.ts`(CAP 회귀), 문서 `docs/ARCHITECTURE.md` 불변식 ③.

## 2026-07-23 — "데이터성 키 redact" 정규식이 접두-토큰 레코드ID를 통과시켜 문서의 수용 경계와 코드가 어긋났다

- **영역**: `AI`
- **계열**: `미검증단언`
- **그물**: `unit`
- **증상**: AI 초안이 성공 응답의 shape 다이제스트(키·타입, 값 제외)를 LLM에 보낼 때, 맵/딕셔너리형 응답(`{"cus_H3k9xY2z":{…}, "user_88213":{…}}`)의 **키가 곧 실제 데이터(레코드ID·세션토큰)**인데도 그대로 LLM에 실렸다. "값은 안 나간다"는 프라이버시 약속의 사각.
- **근본 원인**: 데이터성 키를 가리려 만든 `safeKey` 정규식 `^[A-Za-z_][A-Za-z0-9_]{0,39}$`는 이메일(`@`)·UUID(`-`)·공백만 redact하고, **식별자 모양의 접두-토큰 ID(`cus_…`·`user_88213`)는 코드 식별자와 구분 불가라 통과**시킨다. 설계 문서엔 이 한계를 "수용 경계"로 적었으나, 실제로는 `u_8471` 같은 좁은 예시만 들어 커버리지를 과장했다(주석도 "근본적으로 키를 안 내보낸다"고 과장). 정규식이 "스키마 키만 통과"라는 **의도를 실제로 달성하는지**를 흔한 ID 포맷으로 검증하지 않은 게 원인. dictionary-shape collapse(키 >8 + 값 타입 균일)로 주경로는 막았으나 작은 맵·혼합 맵은 여전히 잔존.
- **재발 방지**: (1) 프라이버시 필터(마스킹·redaction·allowlist)를 **"이런 걸 가린다"로 서술할 땐 흔한 실제 포맷(Stripe `cus_`·`sess_`·전화·계좌)으로 통과 테스트**를 두고, 안 걸리는 것을 negative case로 잠근다 — `grep -rn 'safeKey\|SCHEMA_KEY_RE\|maskJsonBody\|MASKED' src`로 필터 전수. (2) 주석·설계 문서의 커버리지 주장은 **정규식이 실제로 achieve하는 범위**로 정확히 적는다(과장 금지 — "근본 차단"과 "주경로 차단+잔여 경계"는 다르다). (3) 코드→문서 방향 리뷰(외부 눈)가 self-review의 확증편향을 깬다 — 이 건도 self-verify는 통과시켰고 fresh `/code-review`가 잡았다.
- **관련**: `src/sidepanel/lib/prompts/responseDigest.ts:safeKey`·`digestResponseShape`(dictionary collapse), 그물 `src/sidepanel/lib/prompts/__tests__/responseDigest.test.ts`, 경계 서술 `docs/features/ai-draft-matching-log/design.md` 위험 요소·`docs/privacy.{ko,en}.md`.

## 2026-07-23 — 스크롤 캡처에서 sticky를 전부 숨기면 콘텐츠가 사라지고, 첫 후보 스냅샷만 쓰면 늦게 고정된 헤더가 반복된다

- **영역**: `content`
- **그물**: `시각`
- **증상**: 페이지 전체 스크린샷에서 fixed 헤더와 sticky 메뉴가 타일마다 반복해서 찍혔다. 단순히 sticky를 후속 타일에서 모두 숨기는 픽스는 아직 처음 등장하지 않은 섹션 헤더와 뷰포트보다 긴 sticky 사이드바의 일부를 결과에서 영구 누락시킬 수 있었다.
- **근본 원인**: 반복 요소 판정에 `position` 값만 사용하면 **이미 캡처된 반복분**과 **아직 캡처하지 않은 문서 콘텐츠**를 구별할 수 없다. sticky는 원래 흐름 위치·실제 고착 위치·요소 전체 노출 여부를 함께 봐야 한다. 또한 positioned 후보를 첫 후속 타일에서 한 번만 수집하면 더 아래 스크롤 임계점에서 `static → fixed/sticky`로 바뀌거나 동적으로 추가된 요소를 놓친다.
- **재발 방지**: (1) `grep -rn 'position.*fixed\|position.*sticky\|getComputedStyle.*position' src/content`로 스크롤 캡처의 positioned 처리 전수를 확인하고, sticky는 top/bottom 고착 + 원래 흐름 위치 통과 + 전체 기노출 조건을 함께 테스트한다. (2) 요소 전체를 `visibility:hidden` 처리할 때는 뷰포트보다 긴 top/bottom sticky 음성 케이스를 둔다. (3) 스크롤 반응형 후보 목록은 1회 스냅샷으로 끝내지 말고 class/style mutation·추가 subtree를 증분 재탐색하며, 확장이 자체 visibility mutation을 다시 dirty로 만들지 않게 한다. (4) 단위 predicate뿐 아니라 첫 타일 보존·후속 은폐·원래 priority/스크롤 복원·후행 전환·동적 삽입을 DOM 테스트와 실제 캡처 픽셀 e2e로 함께 고정한다.
- **관련**: `src/content/scroll-capture.ts:isRepeatedPositionedElement`·`beginScrollCapture`·`hideRepeatedElements`, 그물 `src/content/__tests__/scroll-capture.test.ts`·`scroll-capture.test.tsx`, `e2e/capture-methods.spec.ts`, fixture `e2e/fixtures/pages/scroll-capture.html`.

## 2026-07-23 — 살아있는 대상 계산 실패를 빈 집합으로 오독해 참조 중인 로컬 데이터까지 orphan prune할 뻔했다

- **영역**: `store`
- **계열**: `fail-open`
- **그물**: `unit`
- **증상**: service worker 부팅 race·storage 잠시 실패·persist JSON 손상 시, 살아있는 탭의 pending 로그·영상·첨부와 다른 탭/저장 draft가 참조 중인 inline image·원본 백업을 orphan으로 판정해 영구 삭제할 수 있었다.
- **근본 원인**: 삭제 대상을 계산하는 두 경로가 같은 fail-open 패턴을 가졌다. `getActiveTabIds()`는 `chrome.tabs.query()` reject를 빈 `Set`으로 바꿔 모든 pending owner를 비활성으로 만들었고, `collectAllActiveInlineRefs()`는 session/local 조회·parse 실패를 삼켜 불완전한 ref 집합을 정상 결과로 넘겼다. 즉 **"살아있는 것 계산 실패"와 "살아있는 것 0개"를 구별하지 않은 채 비가역 삭제를 계속**했다.
- **재발 방지**: (1) orphan/GC/prune 코드에서 `catch { return []|new Set() }`를 금지한다 — `grep -rn 'catch.*\|return \[\]\|new Set' src/store src/lib` 결과 중 반환값이 삭제 predicate로 쓰이는 경로를 전수 확인한다. (2) 참조/활성 집합 계산이 하나라도 실패하면 **삭제 전체를 skip**하는 fail-closed를 기본으로 한다. (3) 세션 1회 prune flag는 삭제 성공 **후**에만 기록해 실패 후 재시도를 막지 않는다. (4) storage/tabs 조회 reject 시 삭제가 0건인 회귀 테스트를 반드시 둔다.
- **관련**: `src/lib/pending-log-prune.ts:getActiveTabIds`·`pruneOrphanPendingLogsOncePerSession`, `src/store/blob-db.ts:collectAllActiveInlineRefs`·`pruneOrphanInlineImages`, 그물 `src/lib/__tests__/pending-log-prune.test.ts`·`src/store/__tests__/blob-db-inline-origins.test.ts`.

## 2026-07-23 — MAIN world 레코더가 원본 XHR.open보다 먼저 기록하면 idle에서도 페이지 요청을 깨뜨린다

- **영역**: `content`
- **계열**: `라이브러리전제`
- **그물**: `unit`
- **증상**: 페이지가 `XMLHttpRequest.open()`에 커스텀 `URL`/`toString()` 객체를 넘겨 변환 중 throw하거나, 다른 라이브러리가 XHR 인스턴스에 충돌 속성을 만든 페이지에서 BugShot 기록 로직의 예외가 정상 요청 흐름으로 전파될 수 있었다. 특히 기존 wrapper는 recorder idle인 때도 `url.toString()`과 `maskUrl()`을 원본 `open()`보다 먼저 실행했다.
- **근본 원인**: MAIN world 후킹의 불변식은 **"원본 동작 성공이 최우선, 기록은 best-effort"인데**, XHR `open` wrapper만 메타데이터 생성을 원본 호출 앞에 두고 예외 격리도 하지 않았다. 단순히 원본 호출을 앞으로 옮긴 뒤에도, 재사용 XHR의 stale `__bugshot` 제거가 throw하는 경로까지 같은 격리 범위에 넣어야 했다.
- **재발 방지**: (1) `grep -rn 'XMLHttpRequest\|\.open =\|\.send =\|sendBeacon\|window.fetch =' src/content` 로 MAIN world 후킹을 전수하고, 각 wrapper가 **비활성 gate → 원본 호출 우선 → 기록 전체 try/catch** 순서를 지키는지 본다(원본이 요청 정규화를 해야 하는 XHR `open`은 원본 성공 후 gate). (2) recorder off일 때는 기록용 변환을 실행하지 않고, 재사용 객체의 stale metadata는 예외 격리 안에서 무효화한다. (3) 후킹 검증은 "기록 성공"뿐 아니라 record hook·`toString()`·metadata 조작이 throw해도 원본 반환/예외가 그대로인지를 고정한다. (4) `recorders-entry` 동기 IIFE 제약 때문에 공용 helper import로 빼지 말고 self-contained를 유지한다.
- **관련**: `src/content/network-recorder.ts:networkRecorderScript`(`XHR.open` wrapper), 비교 패턴 `src/content/network-recorder-helpers.ts:createPatchedFetch`, 그물 `src/content/__tests__/network-recorder.test.ts`·`network-recorder-helpers.test.ts`.

## 2026-07-22 — body-portal 풀스크린 오버레이를 Radix modal Dialog 안에서 트리거하면 캔버스 클릭이 다이얼로그를 닫는다 (latent — 기능 프로토타입은 롤백)

- **영역**: `에디터`
- **계열**: `라이브러리전제`
- **그물**: `수동`
- **증상**: 저장된 초안 편집 창(`DraftEditDialog`, Radix `Dialog`)의 본문 tiptap에 인라인 이미지를 넣고 `[주석 달기]`를 눌러 어노테이션 오버레이가 떠도, 캔버스에 그리려 클릭하면 **편집 다이얼로그가 통째로 닫혀** 주석이 불가능하다. **작성 화면(`DraftingPanel`, 비-modal 패널)에선 같은 오버레이가 정상 동작**해 "여기서만 안 됨"으로 갈린다. (이 경로는 편집 창에 이미지를 붙여넣기/드래그로만 닿아 눈에 잘 안 띄었고, COVERAGE.md에 "DraftEditDialog 오버레이 z-index·focus-trap"이 수동 잔여로만 적혀 있었다. 편집 창에 이미지 추가/로그 삽입 툴바를 얹으려던 시도에서 실사용 경로로 드러났으나 그 기능 자체는 롤백했다 — 함정만 남긴다.)
- **근본 원인**: 표면(주석이 안 됨)과 원인(오버레이가 다이얼로그를 닫음)이 다른 레이어. `AnnotationOverlay`는 `createPortal(document.body)` + `fixed inset-0 z-50` **풀스크린**이라 DOM상 **Radix `Dialog`의 서브트리 바깥**에 렌더된다. Radix modal Dialog는 `DismissableLayer`로 콘텐츠 **바깥의 pointerdown을 "interact outside"로 잡아 `onOpenChange(false)`**(닫기)를 부른다 → 오버레이 캔버스(=다이얼로그 바깥 DOM) 클릭이 곧 다이얼로그 닫힘 트리거. **z-index를 올려도 안 된다** — 스택 순서가 아니라 pointer/focus 소유권 문제다. DraftingPanel은 비-modal이라 DismissableLayer가 없어 무사하다.
- **재발 방지**: (1) **`createPortal(document.body)` 풀스크린 인터랙티브 오버레이를 Radix modal `Dialog`/`AlertDialog` 안에서 트리거하지 말 것**. `grep -rn 'createPortal' src/sidepanel/components`로 body-portal 오버레이를 찾고, 그 트리거가 `Dialog`/`AlertDialog`(`src/components/ui/dialog.tsx`·`alert-dialog.tsx`) 안에서 발화하는지 본다. 해법 셋 — ⓐ 그 컨텍스트에서 기능을 끈다(예: 편집 창에선 인라인 이미지 주석을 비활성) ⓑ 오버레이를 다이얼로그 콘텐츠 **안**에 렌더(풀스크린이면 부적합) ⓒ 다이얼로그의 `onInteractOutside`/`onPointerDownOutside`를 오버레이 오픈 동안 `preventDefault`(오버레이 상태를 다이얼로그로 끌어올려야 함). (2) **"A에선 되는데 B에선 안 됨"은 컴포넌트가 아니라 호스트의 래핑(modal vs 비-modal) 차이를 먼저 의심**한다 — pointer/focus 정책이 다르다. (3) **이 부류는 jsdom·순수 테스트로 안 잡힌다** — Radix DismissableLayer 실동작이라 e2e/수동이 유일한 그물. **(→ 2026-08-06 정정: pointer 축은 jsdom이 잡는다. jsdom에 `PointerEvent`가 실재하고 `DismissableLayerContext`가 모듈 싱글턴이라 Dialog×Popover 결함이 그대로 재현된다 — 이 문장을 근거로 jsdom 그물을 건너뛰지 말 것. focus·레이아웃 축은 여전히 미검증.)** (4) **COVERAGE의 "수동 잔여"에 이미 적힌 위험은 그 경로를 실사용에 노출하기 전에 되짚는다** — 예견됐으나 방치된 항목이 신기능 배선으로 활성화되는 계열.
- **관련**: `src/sidepanel/components/AnnotationOverlay.tsx`(`fixed inset-0 z-50` + `createPortal(document.body)`), 호스트 `src/components/ui/dialog.tsx`(Radix `DismissableLayer`), 트리거 `src/sidepanel/components/TiptapEditor.tsx`(인라인 이미지 어노테이션 NodeView → 오버레이 오픈), 노출 컨텍스트 `src/sidepanel/tabs/DraftEditDialog.tsx`(Radix Dialog가 tiptap 편집기를 호스트). 계열: **2026-07-01**(두 lazy 청크 동시 마운트 — 같은 "오버레이×다이얼로그" 조합의 다른 함정).

## 2026-07-21 — AI 오버레이 '중단'(소프트취소)을 3개 AI 콜사이트에 얹을 때, 취소 가드가 한 곳만 있었고 사용자 취소가 re-adopt로 되살아났다

- **영역**: `AI`
- **계열**: `복제본`, `취소래치`
- **그물**: `jsdom`
- **증상**: (구현 중 `/code-review`가 잡음 — 미출시) AI 로딩 오버레이에 공용 '중단' 버튼을 달았는데, ① repro에서 사용자가 중단을 눌러도 게이트 왕복(trimming 등 dep 변경)으로 effect가 재발화하면 취소한 요청이 **되살아나 늦게 온 재현 단계가 적용**됐다. ② draft·styling 다이얼로그에서 중단을 누르면 배경 호출이 실패로 끝날 때(특히 `isPromptOverBudget` await 창에서 취소 → canceller가 `sessionRef=null` → 다음 줄 `sessionRef.current.prompt()`가 **null-deref TypeError**) 사용자가 방금 취소한 작업에 **AI 에러 토스트**가 떴다.
- **근본 원인**: 취소↔래치 구역(2026-07-16/17)의 두 함정이 새 기능에서 변주로 재발. ① **취소 의미가 두 종류인데 플래그가 하나였다** — `useReproPrefill`의 re-adopt 경로는 원래 **비자발적 취소**(언마운트·게이트 왕복)를 되살려 in-flight를 이어받게 설계됐다(`prev.cancelled = false`). 사용자 명시 중단을 같은 `run.cancelled`로 표현하니, re-adopt가 그것까지 되살려 "영구 포기"가 "되살아나 적용"으로 뒤집혔다. ② **소프트 취소는 세 콜사이트에 동시에 가드가 필요한데 한 곳만 있었다** — `useReproPrefill`은 catch에 `if(!run.cancelled) toast`가 있었지만(2026-07-16 유산), 새로 얹은 두 다이얼로그 catch엔 그 가드가 없어, 결과-폐기 가드(`await prompt()` 직후)가 **못 미치는 이른 await 창**의 취소가 catch로 새 토스트를 띄웠다. "복제된 로직에 같은 수정을 동시에" 원칙을 놓친 것.
- **재발 방지**: (1) **비동기 취소에 "복구 가능(비자발)"과 "영구(사용자)"가 공존하면 플래그를 분리한다** — 되살리는 경로(re-adopt·재시도)가 있으면 사용자 취소는 별도 플래그(`userCancelled`)로 표시하고 되살림 분기가 그걸 먼저 검사(`if(prev.userCancelled) return`). grep: `grep -rn 'cancelled = false\|\.cancelled =' src/sidepanel`로 되살림 지점을 훑고, 사용자 취소와 충돌하는지 본다. (2) **소프트 취소를 여러 AI 콜사이트에 얹을 땐 세 지점을 한 벌로 본다** — `grep -rn 'setAiCancel\|run.cancelled' src/sidepanel`로 canceller 등록·결과폐기 가드·**catch 가드** 세 짝이 모든 콜사이트에 있는지 확인(현재 콜사이트: `useReproPrefill`·`AiDraftDialog`·`AiStylingDialog`). 한 곳(reproPrefill)만 catch 가드가 있으면 나머지도 맞춘다. (3) **결과-폐기 가드는 `await prompt()` 직후에만 두면 이른 await 창의 취소를 놓친다** — canceller가 세션을 null로 만드는 설계면 그 뒤 동기 접근이 null-deref로 catch에 빠지므로, **catch 최상단에도 `if(run.cancelled) return`을 둔다**(가드를 두 겹으로). (4) **소프트 취소는 진짜 abort가 아님을 인지** — ai-provider엔 AbortSignal이 없고 nano `destroy()`가 prompt를 끊는다는 근거도 없다. 백그라운드 호출은 완주하고 결과만 버려진다(느린 nano에서 중단해도 연산은 계속됨). 단일 슬롯 `aiCancel`이 충분한 이유는 오버레이가 `pointer-events`로 동시 op 시작을 구조적으로 막기 때문(App.tsx 오버레이 div가 하위 클릭 흡수) — 이 전제가 깨지면(오버레이에 `pointer-events-none`가 붙거나 op가 오버레이 밖에서 발화) 단일 슬롯 clobber가 되살아난다.
- **관련**: `src/store/editor-store.ts`(`aiCancel`·`setAiCancel` — 비영속 단일 슬롯, `EditorSnapshot` Pick 제외·`...initial` 청소), `src/sidepanel/hooks/useReproPrefill.ts`(`userCancelled` 분리 + re-adopt `if(prev.userCancelled) return` + canceller), `src/sidepanel/tabs/AiDraftDialog.tsx`·`src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`(canceller 등록 + `await prompt()` 직후·catch 최상단 이중 가드), `src/sidepanel/App.tsx`(오버레이 '중단' 버튼 — `aiSurface` 게이트, `aiCancel?.()`), 그물 `src/sidepanel/hooks/__tests__/useReproPrefill.test.tsx`("사용자 중단…결과 폐기"·"게이트 왕복해도 되살리지 않는다")·`src/store/__tests__/editor-store.test.ts`("aiCancel…레지스트리"). 선행 회고: **2026-07-16**·**2026-07-17**(같은 취소↔래치 구역).
## 2026-07-20 — mono 통일이 `Kbd` base에 가려진 값 칩을 빠뜨렸고, twMerge가 커스텀 `text-mono`를 조용히 삭제했다


- **영역**: `디자인`
- **계열**: `라이브러리전제`, `복제본`
- **그물**: `jsdom`
- **증상**: mono 코드 표면을 13px/18px로 통일(`text-xs`→`text-mono`)했는데, 액션 로그 한 줄 안에서 행 텍스트(13px) 옆의 **값 칩만 12px**로 남아 섞였다. `pnpm test`·typecheck 전부 green — v1.6.0이 Tiptap을 빠뜨린 것과 **같은 "표면 하나 누락"** 패턴이 재발했고, 이번엔 `/code-review` 에이전트가 잡았다(커밋 후·미출시).
- **근본 원인**: 함정이 둘이 겹쳤다. ① **칩의 크기 출처가 `text-xs`가 아니라 `Kbd` base였다** — 칩은 `Kbd`(base `font-sans text-xs`)를 `CHIP_CLS="font-mono … text-foreground"`로 오버라이드하는데, CHIP_CLS엔 크기 클래스가 없어 base `text-xs`가 살아남았다. `grep 'font-mono.*text-xs'`엔 안 걸린다(칩 자체엔 `text-xs`가 없고 감싼 프리미티브 base에 있다). ② **`text-mono`를 `cn()`의 twMerge가 삭제했다** — `text-mono`는 커스텀 fontSize 토큰이라 tailwind-merge 기본 config가 모른다. twMerge는 이걸 **text-color 그룹으로 오분류**해, CHIP_CLS의 뒤따르는 `text-foreground`(같은 그룹으로 본다)에 밀려 `text-mono`를 통째로 제거하고 base `text-xs`와도 dedupe하지 않았다. 즉 CHIP_CLS에 `text-mono`를 더해도 렌더 결과엔 `text-xs`만 남았다.
- **재발 방지**: (1) **커스텀 `text-*`(및 Tailwind 클래스 그룹과 충돌하는 임의 유틸)를 도입하면 `cn()`의 `extendTailwindMerge`에 그 그룹으로 등록한다** — 안 하면 `cn()` 경유 컴포넌트에서 같은 그룹 클래스와 만날 때 조용히 사라진다. grep: `grep -rn 'text-mono\|fontSize' src/lib/utils.ts tailwind.config.js`로 토큰↔twMerge 등록 짝을 확인. (2) **"표면 전수"는 리터럴 클래스뿐 아니라 감싼 프리미티브의 base 크기까지 본다** — 표면이 `Kbd`·`Badge`·`Button` 등 shadcn 프리미티브를 쓰면 크기가 그 base에서 올 수 있어 grep에 안 잡힌다. (3) **단위 테스트로 `cn()` 렌더 결과의 className을 단언한다** — `render` 후 `chip.className`에 `text-mono` 포함 + `text-xs` 미포함을 확인하면 twMerge 삭제를 red로 잡는다(`ActionLogContent.test.tsx`). 이건 순수 문자열 대조가 아니라 실제 `cn()`을 태워야 걸린다. 계열: **2026-07-17 mono**(한 셀렉터로 안 잡히는 표면 누락)·2026-07-20 Kbd truncate(프리미티브 교체가 box 모델 전제를 깸) — 둘 다 "프리미티브가 조용히 얹는 것"이 근원.
- **관련**: `src/lib/utils.ts`(`cn`의 `extendTailwindMerge` — `text-mono`를 font-size 그룹 등록), `src/sidepanel/components/ActionLogContent.tsx:CHIP_CLS`(`text-mono` 추가), `src/components/ui/kbd.tsx`(base `text-xs`), `src/styles/globals.css`·`log-viewer/styles.css`(`--mono-size`/`--mono-leading` `:root` 단일 출처), 그물 `src/sidepanel/components/__tests__/ActionLogContent.test.tsx`·`src/styles/__tests__/tokens.test.ts`·`src/sidepanel/lib/__tests__/codeCollapse.test.ts`. 정본: `docs/DESIGN.md` §4.

## 2026-07-20 — shadcn `Kbd`(inline-flex)에 `truncate`를 얹었더니 ellipsis가 안 뜨고 `justify-center`가 양끝을 잘랐다

- **영역**: `디자인`
- **계열**: `라이브러리전제`
- **그물**: `시각`
- **증상**: 액션 로그 칩을 `InlineChip`(bespoke, `inline-block`)에서 shadcn `Kbd`로 통일하며 긴 값에 `max-w-[40%] truncate`를 그대로 옮겼다. 짧은 값(`10743`)은 멀쩡했지만, 긴 값은 `앞부분…`이 아니라 **문자열 중간만** 보이고 말줄임표가 없었다. `pnpm test`·typecheck·자체검증 순수 로직은 전부 green — jsdom이 못 잡는 계층이라 자체검증 에이전트의 CSS 추론으로만 걸렸다(커밋 전 발견, 미출시).
- **근본 원인**: `truncate` = `overflow-hidden text-ellipsis whitespace-nowrap`인데 **`text-overflow: ellipsis`는 block 컨테이너에서만 적용된다**. shadcn `Kbd`/`Badge` 등은 base가 `inline-flex`라 텍스트가 익명 flex item이 되어 ellipsis가 **무효**(하드 클립)다. 게다가 `Kbd` base엔 `justify-center`가 있어 넘친 텍스트가 가운데 정렬로 **양끝이 잘린다**. `InlineChip`은 `inline-block`이라 우연히 정상 동작했던 것 — 프리미티브를 바꾸며 box 모델 전제가 조용히 깨졌다.
- **재발 방지**: (1) **shadcn `inline-flex` 칩(`Kbd`·`Badge`·`ButtonGroup*`)에 `truncate`를 직접 얹지 말 것** — ellipsis가 필요하면 내부에 `<span className="min-w-0 truncate">`로 감싸 flex item을 block화하고 `min-w-0`으로 축소 허용(선례 `ActionLogContent`의 `DragNodeChip`·`valueChip`). (2) grep: `grep -rn 'truncate' src` 결과 중 대상이 `inline-flex`(shadcn Kbd/Badge/Toggle 등)면 냄새 — 부모 `display`를 확인한다. (3) **말줄임·클리핑은 jsdom·순수 테스트로 못 막는다**(레이아웃 계층) — computed style을 읽는 e2e나 육안이 유일한 그물. 이번엔 자체검증 에이전트의 CSS 규칙 추론이 대신 잡았다. 계열: `text-overflow`처럼 **특정 `display`에서만 작동하는 속성**을 프리미티브 교체와 함께 옮기면 조용히 무력화된다.
- **관련**: `src/sidepanel/components/ActionLogContent.tsx`(`DragNodeChip`·`valueChip` — 내부 `min-w-0 truncate` span), `src/components/ui/kbd.tsx`(base `inline-flex justify-center`), `docs/DESIGN.md` §관련 변형 컴포넌트(`Kbd` 항목).

## 2026-07-18 — `DB_VERSION`을 올렸더니 무관한 슬랙 spec이 `VersionError`로 죽었다 — e2e가 IndexedDB 버전을 하드코딩 seed

- **영역**: `e2e`, `store`
- **계열**: `복제본`, `드리프트`
- **그물**: `e2e`
- **증상**: 인라인 이미지 어노테이션(blob-db에 `inlineImageOrigins` store 추가)만 건드렸는데, `/push` e2e 게이트에서 **전혀 무관한** `slack-promote-media-guard.spec`이 `VersionError: The requested version (7) is less than the existing version (8)`로 빨강. 정작 내가 만든 `inline-image-annotation.spec`은 green이었다.
- **근본 원인**: `DB_VERSION`을 7→8로 bump하면 앱 `openDb`는 `onupgradeneeded`로 새 store를 만들지만, **e2e가 IndexedDB를 직접 seed하는 곳**(`slack-promote-media-guard.spec:seedBeforeImage`)이 `indexedDB.open("bugshot-video", 7)`로 **버전을 하드코딩**한다. 앱이 먼저 DB를 v8로 올려놓은 뒤 테스트가 v7로 열면 IndexedDB 규약상 요청 버전 < 기존 버전이라 **즉시 throw**. 스키마 단일 출처(`blob-db.ts`)와 e2e의 복제 seed가 조용히 갈라졌다 — 증상이 터진 파일과 원인이 있는 파일이 무관하다.
- **재발 방지**: (1) **`DB_VERSION`을 bump할 땐 `grep -rn 'indexedDB.open("bugshot-video"' e2e/`로 하드코딩 seed를 전수**하고, **버전 숫자 + store 목록 둘 다** 앱 스키마에 맞춘다(store만 추가하고 버전을 안 올리면 반대로 기존 커넥션에서 upgrade가 안 돈다). GOTCHAS의 seed 함정 항목에 "DB_VERSION bump 시 seed의 버전·store도 함께"를 명시했다. (2) **무관한 spec에서 터지므로 변경 spec만 돌리면 절대 안 잡힌다** — 전체 스위트(`/push` e2e 게이트 = `pnpm test:e2e` 전량)가 유일한 그물이다. 이번에도 `inline-image-annotation`만 돌렸을 땐 green, 전체를 돌려서야 잡혔다.
- **관련**: `src/store/blob-db.ts`(`DB_VERSION=8`·`STORE_INLINE_ORIGINS`·`onupgradeneeded`), `e2e/slack-promote-media-guard.spec.ts:seedBeforeImage`(하드코딩 v7→v8 + `inlineImageOrigins` 추가), `e2e/GOTCHAS.md`(IndexedDB seed 함정).

## 2026-07-18 — `hidden` 속성으로 숨긴 버튼이 여전히 `:first-child`를 차지해 ButtonGroup 좌측 모서리가 각졌다

- **영역**: `디자인`
- **계열**: `라이브러리전제`
- **그물**: `시각`
- **증상**: 본문 인라인 이미지에 hover하면 뜨는 액션 그룹(`[초기화][주석][삭제]`)에서, 어노테이션 기록이 없어 **초기화 버튼이 숨겨진** 상태일 때 보이는 첫 버튼(연필)의 **좌측 모서리가 둥글지 않고 각지게** 나왔다(좌상단·좌하단 라운딩 소실 + 좌측 테두리 처리도 어긋남). 어노테이션을 한 번 넣어 초기화가 보이면 정상.
- **근본 원인**: `blockActions.setHidden`이 버튼을 **`hidden` 속성(=`display:none`)** 으로 숨기는데, `display:none` 요소도 **DOM 자식으로 남아 CSS `:first-child`를 계속 차지**한다. `block-actions.css`의 ButtonGroup 라운딩은 `.block-actions-button:first-child`(좌측 라운딩)·`:not(:first-child){border-left:0}` 같은 **구조 선택자**에 걸려 있어서, 숨은 초기화 버튼이 여전히 `:first-child`고 실제 보이는 첫 버튼(연필)은 `:nth-child(2)` → 좌측 라운딩도 좌측 테두리도 못 받는다. 증상은 CSS(모서리)인데 원인은 **"visibility를 `hidden` 속성으로 표현"과 "구조 선택자"의 상호작용** — 서로 다른 레이어다. (feature-review에서 CDO가 "hover 중 라운딩 점프" 위험을 지적했으나 실제 버그는 그 async 타이밍이 아니라 hidden이 상시 `:first-child`를 점유하는 정적 문제였다 — 예측한 위험과 실제 버그가 갈렸다.)
- **재발 방지**: **`hidden`/`display:none`으로 요소를 숨기면서 `:first-child`/`:last-child`/`:nth-child`에 의존하는 스타일이 있으면 반드시 깨진다.** 숨김을 "보이는 것 중 첫/막"으로 해석하려면 `[hidden] + sibling` 인접 선택자로 다음 요소를 승격하거나(이번 픽스), 아예 DOM에서 detach한다. `grep -rn ":first-child\|:last-child\|:only-child" src/**/*.css`로 구조 선택자 쓰는 그룹을 찾아, 그 소비처가 `setHidden`·조건부 `hidden`을 쓰는지 대조. **e2e 판정 주의**: Playwright `toBeVisible()`은 `opacity:0`은 visible로, `display:none`(hidden 속성)만 not-visible로 친다 — 모서리 라운딩은 `toHaveCSS("border-top-left-radius", ...)`로 실측해야 하고(버그 시 `0px`), `inline-image-annotation.spec`이 이 값으로 가드한다.
- **관련**: `src/sidepanel/components/block-actions.css`(`.block-actions-button:first-child, .block-actions-button[hidden] + .block-actions-button` 승격 — specificity (0,3,0)로 `:not(:first-child)` (0,2,0)를 이겨 border-left 복원), `src/sidepanel/lib/blockActions.ts:setHidden`(`btn.hidden` 토글), `e2e/inline-image-annotation.spec.ts`(border-radius 실측 가드).

## 2026-07-18 — 접힘=readonly로 들어가는 경로가 둘인데 caret 보정은 한쪽(pill 클릭)에만 있었다

- **영역**: `에디터`
- **계열**: `복제본`
- **그물**: `e2e`
- **증상**: 에디터에서 코드블럭에 타이핑으로 16번째 줄을 치는 순간 블럭이 접히는데, caret이 잘린(접힌) 영역 안에 갇힌 채 접힌다 — 브라우저가 caret을 보이게 pre를 스크롤해 둔 상태라 **로그 중간이 보인 채 접히고**, 안 보이는 줄이 keymap 키(Enter·Backspace)로 계속 편집된다(문자 입력은 `contenteditable="false"`로 죽지만 keymap은 `state.selection`에 트랜잭션을 넣어 **편집은 되는데 안 보이는** 비대칭).
- **근본 원인**: **readonly(접힘)로 진입하는 경로가 둘인데 보정이 한쪽에만 있었다.** ① pill 클릭 → `setExpanded(false)`: caret 축출(`onCollapse`=`moveCaretOut`)·`scrollTop=0` 보정을 **한다**. ② 타이핑·붙여넣기로 줄 수가 임계값을 넘음 → `update()`→`render()`: `contenteditable="false"`만 걸고 **caret 축출도 스크롤 리셋도 안 한다**. `setExpanded`가 실사용 제보로 정확히 이 "로그 중간이 보인 채 접힘" 아티팩트를 고쳤는데(주석까지 달아뒀는데), 그 보정이 두 번째 진입로엔 복제되지 않았다 — "펼침 전이는 pill로만 일어난다"는 암묵 전제가 틀렸다. 픽스는 보정을 복제하는 대신 **편집 중엔 접지 않는다**로 갔다(read/edit 모델: caret이 블럭 안이면 `update()`가 `setExpanded(true)`로 승격) — 접기 자체를 안 하니 갇힐 caret이 없다.
- **재발 방지**: (1) **같은 종단 상태(readonly)로 가는 진입로가 여럿이면 보정도 전수한다** — 상태 전이 보정을 한 경로(`setExpanded`)에만 넣으면 다른 경로(`update()`)가 조용히 우회한다. `grep -n "contenteditable" src/sidepanel/lib/codeCollapseShell.ts`로 readonly를 거는 지점을 세고, 각 지점이 같은 후처리(caret 축출·scroll 리셋)를 지나는지 대조. (2) **이 축은 jsdom·클릭 e2e로 안 잡힌다** — 2026-07-17 항목대로 접힌 블럭 **클릭**은 우리 핸들러가 먼저 펼쳐 프로브를 무효화하고, "타이핑으로 임계 돌파"는 살아있는 PM view + keymap이 필요해 단위 테스트가 불가. e2e에서 **펼친 블럭에 타이핑으로 16줄을 만들어** `data-collapsed=false` 유지 + caret이 블럭 안에서 정상 편집됨을 실측해야 갈린다. (3) **잔존 경로(미해결 관찰)**: 16줄+ 코드블럭을 **통째로 붙여넣어 새 노드가 생기는 constructor 경로**는 `update()`가 아니라 constructor라 auto-expand를 안 타고 접힌 채 만들어진다 — 단 e2e가 "삽입된 로그는 접힘"을 의도 UX로 단언하므로 여기서 auto-expand하면 그 계약이 깨진다. 붙여넣기 후 caret 유입 여부는 실기 확인 후 판단.
- **관련**: `src/sidepanel/components/TiptapEditor.tsx:CodeCollapseNodeView.update`(전이 시점 `setExpanded(true)` 승격 + `selectionInside` — `moveCaretOut`의 교차 판정 여집합)·`moveCaretOut`, `src/sidepanel/lib/codeCollapseShell.ts:setExpanded`(pill 경로 보정 — `onCollapse`+`scrollTop=0`)·`render`(update 경로 — `contenteditable`만 걸던 자리). 계열: **2026-07-17**(같은 접기 기능의 guard-label·프로브 무효화 — 그땐 방향키로만, 이번엔 타이핑으로만 갈렸다).

## 2026-07-17 — 설계가 단언한 "이 가드가 이 회귀를 막는다"가 넷 다 틀렸고, 그 문장을 이름표로 옮긴 e2e가 공허했다 (같은 실수를 같은 세션에서 두 번)

- **영역**: `에디터`, `e2e`
- **계열**: `미검증단언`
- **그물**: `e2e`
- **증상**: 코드엔 증상이 없었다 — 결론(가드를 둔다)이 옳아서 아무도 못 느꼈다. 드러난 건 e2e에서다. `design.md` 위험 3이 *"`stopEvent` 누락 → pill 클릭이 커서를 점프시킨다"*라 못박았고 그걸 근거로 e2e 시나리오를 **"`stopEvent` 회귀 가드"**로 승격시켰는데, `stopEvent`를 통째로 `return false`로 만들어도 **전 테스트가 green**이었다. "회귀 가드" 이름표를 단 채 그 회귀를 전혀 안 무는 테스트가 머지될 뻔했다.
- **근본 원인**: 설계 단계에서 **검증 없이 인과를 단언**하고, 구현·테스트가 그 문장을 이름표로 옮겼다. 가드를 하나씩 무력화해 실측하니 넷 다 달랐다 — ① **커서를 지키는 건 `stopEvent`가 아니라 `contenteditable="false"`**(위험 11)다. ② **셸 중첩을 막는 건 `closest` 가드가 아니라 cleanup의 `unwrap()`**이다(위험 10은 반대로 적었다): 가드만 빼면 green, `unwrap()`만 빼면 리스너 없는 죽은 pill이 남는다 — **실패 모드가 서로 다르다**. ③ `useMemo`는 펼침 리셋을 막지 않는다(위험 12): `html`은 문자열이라 `Object.is`·React의 innerHTML diff 모두 **값 비교**라 내용이 같으면 dep이 안 변한다 — 실익은 markdown-it 재실행 회피뿐. ④ 같은 계열로 리뷰가 승인한 **`+10px` 스크롤바 보정**은 "오버플로 없는 16줄" 케이스를 모델링하지 않아 `max-height` 313px > 자연 높이 312px가 되어, **안 잘리는데 pill만 뜨고 클릭해도 무반응인 유령 접힘**을 만들었다.
- **같은 세션에서 재발 — 이게 이 항목의 핵심**: 위를 적어놓고 곧바로 **또 밟았다.** UI를 접힘=readonly 모델로 개편한 뒤 "접힌 블럭에 caret이 안 들어간다"를 **클릭으로** 검증했는데, 접힌 블럭 클릭은 **우리 핸들러가 먼저 펼쳐버려서** caret이 들어와도 이미 편집 가능 상태라 가드 유무가 결과에 안 나타난다. 세 가드(`contenteditable`·`stopEvent`의 readonly 분기·`moveCaretOut`)를 각각 빼고 돌려도 관측값이 **한 글자도 안 바뀌었다** — 프로브가 셋을 구분조차 못 했다. 갈린 건 **방향키**뿐이었다(우리 핸들러를 안 거치고 PM/브라우저가 직접 caret을 옮기는 유일한 경로): `contenteditable`을 빼면 anchor가 코드 안으로 들어가고 **타이핑이 접힌 줄에 유입**된다.
- **재발 방지**: (1) **가드의 이름표는 mutation으로 정한다** — "이 가드가 이 회귀를 막는다"를 테스트 이름·주석에 쓰기 전에 그 가드를 하나씩 무력화해 **red를 확인**한다. (2) **red가 안 나오면 원인이 셋이고 구분해야 한다** — 이름표가 틀렸거나 / 테스트가 공허하거나 / **시나리오가 그 코드 경로를 애초에 안 탄다**. 셋째가 이번의 함정이었다: 무력화해도 값이 안 변하면 "가드가 무해하다"가 아니라 **그 시나리오가 가드를 안 건드린다**는 뜻이다. 가드를 우회하는 다른 진입 경로를 찾아야 갈린다(여기선 클릭 대신 **방향키**). (3) **2026-07-16이 이미 "가드의 비공허성은 분기를 일시 제거해 red를 확인한다"고 처방했는데 코드 가드에만 적용되고 설계 문서의 인과 문장엔 적용되지 않았다** — `docs/features/*/design.md` 위험표의 "완화" 칸은 **구현 전 가설**이다. 구현이 끝나면 각 칸이 실제로 그 위험을 막는지 되짚고 틀렸으면 문서를 고친다. (4) **CSS가 분기할 수 없는 조건**(오버플로 유무·스크롤바 존재)을 상수로 보정하면 보정이 불필요한 다수 케이스에서 임계값 경계를 넘는다. `codeCollapse.test.ts`가 `code-collapse.css`·`doc-section-body.css`·`tiptap-editor.css` **3파일을 읽어** 접힘 높이가 임계값+1줄을 실제로 자르는지 대조한다 — 산식을 테스트에 복제하면 CSS가 바뀌어도 green이라 무의미하다(그 함정도 밟았다).
- **관련**: `e2e/code-block-collapse.spec.ts`("접힌 블럭에 방향키로 들어가 타이핑해도 글자가 안 들어간다" — `contenteditable` 제거 시 red 실증), `src/sidepanel/lib/codeCollapseShell.ts`(`contenteditable`·`destroy`/`unwrap` 분리), `src/sidepanel/hooks/useCodeCollapse.ts`(`closest`는 2차 방어), `src/sidepanel/lib/__tests__/codeCollapse.test.ts`(CSS 3파일 대조 — 유령 접힘 가드), `e2e/GOTCHAS.md`(동명 함정). 계열: **2026-07-16**(미검증 단언·"왜"의 실측), **2026-07-04**(단위 green인데 e2e만 잡음).

## 2026-07-17 — `--accent`가 `--muted`와 같은 값이라, 관용구대로 넣은 `hover:bg-accent`가 pill을 코드블럭에 녹여버림

- **영역**: `디자인`
- **계열**: `라이브러리전제`
- **그물**: `시각`
- **증상**: 코드블럭 접기 pill에 마우스를 올리면 **pill이 코드블럭 배경에 녹아 글자만 남았다**(다크에선 테두리까지 사라짐). hover가 이 pill의 **유일한 출현 경로**라 체감이 컸다. 더 나쁜 건 경로다 — 자체 검증(4관점)이 *"저장소 텍스트 버튼 관용구(`Button variant="outline"`)를 안 따랐다 — `hover:bg-accent`·`shadow-sm` 누락"*이라 지적했고, **그 지적을 그대로 따르자 회귀가 생겼다**.
- **근본 원인**: `--accent`·`--secondary`·`--muted`가 **라이트·다크 모두 값이 같다**(라이트 `210 40% 96.1%` / 다크 `0 0% 14.9%`). shadcn outline variant의 `bg-background → hover:bg-accent`는 **`--background` 표면 위에 놓일 걸 전제한 "떠오름"**인데, 이 pill은 코드블럭(`--muted`) 위에 앉아서 hover가 곧 주변과 동일색이 됐다 — 관용구의 방향이 표면을 옮기며 뒤집힌 것이다. 다크는 `--border`·`--input`·`--ring`까지 같은 `0 0% 14.9%`라 테두리·포커스 링도 그 표면 위에선 소실된다. 그런데 `docs/DESIGN.md` 토큰 표는 셋을 "hover 강조"/"보조 텍스트·비활성 배경"/"보조 버튼·탭 바 바탕"으로 **용도만** 적어둬 값이 같다는 사실이 어디에도 없었다(§9가 `--ring`==`--border`는 경고하면서 이 셋은 침묵).
- **재발 방지**: (1) **관용구는 그것이 얹히는 표면을 전제한다** — shadcn variant를 `background`가 아닌 표면(`muted`·`secondary`·`card`)으로 이식할 땐 `grep -nE '\-\-(accent|secondary|muted|border|input|ring):' src/styles/globals.css`로 **값 충돌을 먼저 본다**. muted·secondary 표면 위 컨트롤의 hover는 배경이 아니라 **등장(opacity)·글자색·그림자**로 낸다. (2) **토큰 표의 "용도"는 의미 구분이지 시각 구분이 아니다** — `docs/DESIGN.md` §2에 동일값 사실과 그 귀결을 명시했다. 토큰을 고를 땐 이름이 아니라 `globals.css`의 값을 본다. (3) **자체 검증의 "관용구 위반" 지적은 관용구의 전제가 이 자리에서도 성립하는지 확인한 뒤 따른다** — 이번엔 **지적이 맞고 처방이 틀렸다**(치수·`shadow-sm`·`user-select`는 옳았고 hover만 아니었다). 에이전트 지적을 통째로 수용/기각하지 말 것.
- **관련**: `src/sidepanel/components/code-collapse.css:.code-collapse-toggle`(hover 배경 미채택 근거 주석), `src/styles/globals.css`(`--accent`/`--secondary`/`--muted` 동일값), `docs/DESIGN.md` §2(동일값·귀결 명시)·§1(React 미도달 DOM의 vanilla CSS 예외 관례), `src/components/ui/button.tsx`(outline variant 원본). 계열: **2026-07-17 mono**(짝을 한쪽만 고치면 조용히 갈라짐 — 여기선 "표를 값이 아니라 이름으로 읽으면 갈라짐").

## 2026-07-17 — "mono 표면"이 한 셀렉터로 안 잡혀 v1.6.0의 13px 통일이 표면을 빠뜨렸고, 폰트를 안 열어본 리거처 단언 탓에 `--`가 CSS 토큰마다 그리드를 무너뜨림

- **영역**: `디자인`
- **계열**: `복제본`
- **그물**: `unit`
- **증상**: v1.6.0이 Geist Mono를 실은 뒤, CSS 코드 뷰에서 `var(--space-lg)` 같은 토큰의 `--`가 **한 글자로 뭉쳐** 회색 칩을 삐져나왔다. 이슈 본문 코드블럭은 긴 줄이 접히며 **들여쓰기가 소실**됐고(중첩 JSON에서 즉시 보임), 코드 표면 크기는 13 / 12.25 / 11px로 제각각이었다. 폰트는 정상 로드됐고(e2e가 `@font-face`를 고정), `pnpm test`·`typecheck`·e2e 전부 green — **어느 게이트에도 안 걸렸다.**
- **근본 원인**: 세 겹이고, 전부 "코드만 읽어선 안 보이는" 층에 있었다.
  1. **폰트 파일을 안 열어본 단언.** v1.6.0 design.md가 *"Geist Mono엔 코딩 리거처가 없어 `calt`가 작용할 대상이 없다"*고 단언했다. fontTools로 열어보니 **절반만 맞았다** — `calt`·`rlig`는 없지만 **`liga`가 있고** 그 안에 `hyphen + [hyphen] → hyphen_hyphen.liga`가 실재한다. `liga`는 브라우저 **기본 ON**이라 켠 적이 없어도 작동하고, 그 리거처의 **advance가 600으로 hyphen 하나와 같다**(1200이 아니다) — 즉 잉크 오버플로가 아니라 **2셀이 1셀로 붕괴**해 `--` 뒤 텍스트가 통째로 한 칸 밀린다. CSS 커스텀 프로퍼티는 전부 `--`로 시작하므로 **에디터의 모든 토큰이 이걸 밟았다.**
  2. **"mono 표면"은 한 셀렉터로 안 잡히는데 v1.6.0은 한 곳만 봤다.** Geist는 **세 짝**으로 갈려 들어온다 — (a) `.font-mono` 유틸(CSS 뷰·DOM 트리·로그 5곳) vs **Tailwind preflight**의 `pre`/`code`(Tiptap·프리뷰), 만나는 지점이 없다. (b) `tiptap-editor.css`(에디터)와 `doc-section-body.css`(프리뷰)는 code/pre 규칙이 **바이트 동일한 클론**이다. (c) `log-viewer`는 별도 빌드라 `globals.css`를 **안 받는데** `App.tsx`가 사이드패널 컴포넌트를 import해 mono 표면이 실재한다. v1.6.0은 (a)의 `.font-mono` 쪽만 보고 "13px 2표면 통일"을 **불변식으로 선언**했고, Tiptap 12.25px가 조용히 갈렸다. **셋 다 sans였을 땐 안 보이다가 mono로 통일되니 드러났다.**
  3. **범인 CSS가 grep에 안 잡힌다.** 코드블럭 줄바꿈은 `@tiptap/core`가 `src/style.ts`를 **런타임에 `<style data-tiptap-style>`로 주입**하는 `.ProseMirror pre { white-space: pre-wrap }` 때문이었다. 소스에도 `dist/assets/*.css`에도 없다. 그래서 `tiptap-editor.css`의 `overflow-x: auto`는 **죽은 코드**였다(pre-wrap이면 넘칠 일이 없다). `code-block-collapse/prd.md`가 이 지점에서 *"`grep -rn "prosemirror.css" src/` → 0건이라 안 걸린다"*로 전제를 세웠는데, **grep 결과는 지금도 사실이고 틀린 건 "출처가 하나"라는 추론**이었다 — `prosemirror-view`의 CSS 파일은 정말 import 안 하지만 Tiptap이 같은 내용을 자체 주입한다.
- **재발 방지**:
  1. **폰트 feature를 근거로 뭔가를 단언하려면 파일을 연다.** `python -c "from fontTools.ttLib import TTFont; ..."`로 GSUB feature 목록과 치환 규칙을 뽑는 게 유일한 검증이다. "이 폰트엔 리거처가 없다"는 **검증 가능한 단언**이지 수사가 아니다(2026-07-16 "JSON 팔레트"와 같은 계열 — 주석·설계 문장의 단언은 grep/실측으로 참을 확인한 것만 쓴다).
  2. **mono 전역 값을 손대면 세 짝을 전수한다.** `docs/DESIGN.md` §4 "mono 표면 불변식"이 정본이다. 전수: `grep -rn 'font-mono' src --include='*.tsx'`(유틸 경로) + `tiptap-editor.css`↔`doc-section-body.css` 나란히 diff + `log-viewer/styles.css`. **`tokens.test.ts`가 globals↔log-viewer의 mono 블록 일치를 강제**하므로 (c)는 자동으로 잡히지만, (a)·(b)는 여전히 사람이 봐야 한다. **한쪽만 고치면 테스트·typecheck·e2e 전부 green인 채로 갈라진다.**
  3. **Tiptap 주입 스타일은 DevTools의 `style[data-tiptap-style]`로만 보인다** — `id`가 아니라 **속성**이라 `#tiptap-style`로 찾으면 0건이다. 파일은 pnpm 레이아웃이라 루트 `node_modules/@tiptap/core`에 없고 `.pnpm/@tiptap+core@<ver>/…/dist/index.js`의 `// src/style.ts` 구간이다. **메이저 업그레이드 시 특이도 싸움이 조용히 뒤집힌다.**
  4. **`letter-spacing`이 리거처 mutation 대조군을 오염시킨다.** Chrome은 `letter-spacing`이 0이 아니면 리거처를 **덤으로 끈다**(CSS Text). 튜닝 중 자간이 있던 동안 `font-variant-ligatures: none` 한 줄만 지우는 대조군이 **green**이라 "단언이 공허하다"고 오판할 뻔했다 — 자간이 대신 막고 있었다. 자간을 0으로 확정한 지금은 대조군이 명확하다(그 한 줄 → red 확인). **mono에 자간을 도입하면 대조군은 블록 전체 제거로 바꿔야 한다**(`e2e/GOTCHAS.md`).
  5. **`letter-spacing`의 `em`은 선언 요소 자신의 font-size로 resolve된 뒤 절대길이로 상속된다.** `CssCodeMirror`의 래퍼는 크기 클래스 없이 `font-mono`만 달아 body(16px) 기준으로 굳어, 12px인 다른 표면과 **자간만 33% 갈렸다**(-0.16 vs -0.12px). "전 표면 균일"이 불변식인 값에 `em`을 쓰면 **선언 위치가 값을 바꾼다.**
  6. **"이걸 쓰면 X를 잃는다"류 기각 사유도 실측 대상이다.** design.md가 `font-feature-settings`를 기각하며 *"body의 `rlig`/`calt`를 날린다"*고 썼는데, preflight가 **이미** `code,kbd,samp,pre`에 `font-feature-settings: normal`을 직접 걸어 상속분이 항상 져서 **잃을 게 없었다**. 결론(안 쓴다)은 옳았지만 근거가 거짓이라 다음 리뷰에 뒤집힐 문장이었다 — 2026-07-16의 *"'왜'를 실측하지 않으면 맞는 결론도 다음 리뷰에 뒤집힌다"*가 그대로 반복됐다.
- **관련**: `src/styles/globals.css`(mono 블록 — `@layer base`, 두 진입 경로를 한 셀렉터 리스트로 묶음)·`src/log-viewer/styles.css`(손복사본), `src/sidepanel/components/tiptap-editor.css`↔`doc-section-body.css`(짝 — `white-space: pre`는 에디터만), `src/sidepanel/tabs/styleEditor/CssCodeMirror.tsx`(인라인 theme 12px/1.5)·`DomTreeDialog.tsx`(`text-xs`)·`NetworkLogContent.tsx:576`(`text-xs`), 가드 `src/styles/__tests__/tokens.test.ts`("mono 타이포그래피" — 파서 자기검증 앵커 포함)·`e2e/style-code-view.spec.ts`(`--` 렌더 폭 실측 + 12px/18px computed). 정본: `docs/DESIGN.md` §4. 선행 회고: **2026-07-16**(미검증 단언·"왜"의 실측).

## 2026-07-17 — zustand 전이와 React state 게이트가 다른 레인이라 한 렌더가 새고, 그 틈에 발화한 재현 단계 자동 채움이 취소↔래치 함정으로 영구 미충전 (2026-07-16 함정의 하루 만의 재발)

- **영역**: `store`, `AI`
- **계열**: `취소래치`
- **그물**: `jsdom`
- **증상**: 30s 리플레이로 캡처 → 트림 오버레이에서 구간 확정 → 작성 화면의 **재현 과정이 빈 값**. 실패 토스트도 없다. **매번** 재현되고, 탭/화면 녹화는 멀쩡하다. 2026-07-16 항목의 증상과 **글자 그대로 같다** — 그 항목이 이미 고쳤다고 기록한 그 증상이 하루 만에 돌아왔다.
- **근본 원인**: **기존 회고 두 개의 교차점**이고, 어느 한쪽만 읽어선 안 보인다. (1) **2026-07-01 픽스가 이번 트리거를 심었다** — 흰 화면을 막으려 "트림 중엔 DraftingPanel을 마운트하지 않는다"는 게이트를 넣었는데, 그 게이트가 `use-30s-replay`의 **React state**(`pendingTrim`)인 반면 drafting 전이는 **zustand**다. zustand 5는 `useSyncExternalStore`(SyncLane), `setState`는 DefaultLane이라 같은 동기 블록에서 연달아 불러도 **두 렌더로 갈린다**(추론이 아니라 실측 — mount count를 세는 최소 probe로 확인). 그래서 `phase="drafting"`인데 `trimming=false`인 렌더가 **정확히 한 번** 새고, 그 틈에 DraftingPanel이 마운트된다. BYOK면 `aiStatus`가 즉시 `available`이라 `useReproPrefill`이 그 한 렌더 안에서 발화하고 `reproPrefillDone`을 래치한다. (2) **2026-07-16이 심은 인수인계가 여기선 무력하다** — 그때 취소↔래치 함정을 `runRef`로 이어받게 고쳤지만, 그 인수인계는 **같은 컴포넌트 인스턴스** 전제다. 다음 렌더에서 `trimming=true`가 되며 패널이 **언마운트**되면 cleanup이 `run.cancelled=true`를 놓고, 사용자가 트림 구간 고르는 몇 초 사이 AI 응답이 도착해 `if (run.cancelled) return`으로 **조용히 폐기**된다(취소는 에러가 아니라 토스트도 없다). 트림 확정 후 **재마운트**되면 `runRef.current`는 새 인스턴스라 `null`인데 `doneRef`는 store에서 `true`로 살아 돌아와 `if (!prev) return` — **이어받을 요청이 없으니 영구 포기**. 즉 2026-07-16이 기록한 "취소는 원래 '다시 하겠다'는 뜻인데 래치가 '다시 안 한다'고 못박아 취소가 곧 영구 포기로 뒤집힌다"가 **트리거만 deps 재실행 → 언마운트/재마운트로 바뀐 채 그대로 재발**했다.
- **재발 방지**: (1) **불변식 — store 전이가 마운트를 여는 쪽이면, 그걸 막는 게이트는 반드시 같은 `set()`에 실려야 한다.** React state 게이트 + zustand 전이 조합은 레인이 갈려 게이트가 늦게 닫히고, 그 한 렌더가 마운트를 흘린다. 반대 방향(게이트가 store보다 늦게 **열리는** 쪽)은 안전 — `useEditorSessionSync.ts:97,138`(`hydrate` → `setHydrated`)이 그 예로, `App.tsx`의 `if (!editorHydrated) return null`이 새는 렌더를 삼킨다. 전수: `grep -rn "useEditorStore.getState()\.\|useEditorStore.setState" src/sidepanel`로 store 전이 **직후 React setState**가 오는 자리를 뽑고, 그 setState가 마운트를 게이팅하는지 본다(특히 `grep -rn "lazy(" src/sidepanel`의 청크 게이트). **순서 스왑은 해결책이 아니다** — DefaultLane은 SyncLane 렌더에 안 실린다(실측 확인). 게이트를 store로 올리는 것만이 답. (2) **레인 분리는 추론하지 말고 probe로 실측한다** — 마운트 횟수를 세는 10줄짜리 테스트가 며칠치 코드 리딩을 이긴다. (3) **테스트는 "전이를 보는 첫 알림에 게이트가 이미 켜져 있나"를 `subscribe`로 단언**한다 — `editor-store.test.ts`의 "전이 원자성" 케이스가 선례이고, `set()`을 둘로 쪼개는 미세 회귀까지 잡는 **유일한** 가드다. (4) **jsdom fixture가 실물 컴포넌트를 못 올려 게이트를 복사하면, 그 테스트는 배선을 원리적으로 못 잡는다** — 이번에 그 사실을 모른 채 163줄짜리 통합 테스트를 짰다가 **mutation(픽스 무력화 후 무엇이 빨개지나)으로 확인하고 통째로 삭제**했다. 새 테스트가 회귀 가드라고 주장하기 전에 mutation으로 검증할 것. "잡는 척하는 테스트"는 없느니만 못하다. (5) `useReproPrefill`의 취소↔래치 함정 **자체는 여전히 살아있다** — 이번엔 트리거만 없앴다. 잔존 트리거는 "in-flight 중 패널 닫기" 1건이고, `reproPrefillDone`의 "결과 무관 세션 1회" 설계가 의도한 귀결이라 남긴다. **DraftingPanel을 언마운트시키는 새 게이트를 추가하면 이 함정이 즉시 되살아난다** — `grep -n "return null" src/sidepanel/tabs/IssueTab.tsx`. (6) **주석이 아직 없는 회고를 가리키면 거짓말이 된다** — 이번에 `(POSTMORTEM 2026-07-17)`을 코드에 먼저 박았고 CTO 게이트가 `grep -n "2026-07-17" docs/POSTMORTEM.md` → 0건으로 잡았다. 회고 참조 주석을 쓰면 push 전 그 항목의 존재를 grep으로 확인할 것.
- **관련**: `src/store/editor-store.ts:replayTrim`(게이트이자 페이로드인 단일 값 — 비영속. 후속 리팩터로 `replayTrimPending: boolean` + 훅 로컬 페이로드였던 이중 장부를 합쳤다)·`onRecordingComplete`(`trim`·`reproPrefillDone: false`를 같은 set에), `src/store/editor-store.ts:resolveReplayTrim`, `src/sidepanel/30s-replay/use-30s-replay.ts:capture`(게이트 원자화)·`resolveTrim`, `src/sidepanel/App.tsx`(`trimming` 소스 + ReplayTrimDialog 게이트 — DraftingPanel과 **같은** 값이어야 2026-07-01 흰 화면이 안 되살아난다), `src/sidepanel/hooks/useReproPrefill.ts:82-89`(인수인계 — 같은 인스턴스 전제), 가드 `src/store/__tests__/editor-store.test.ts`("전이 원자성"·"reset이 replayTrim까지 청소한다"). 선행 회고: **2026-07-16**(같은 취소↔래치 함정, 다른 트리거)·**2026-07-01**(이번 트리거를 심은 흰 화면 픽스).

## 2026-07-16 — vitest에서 멀쩡히 되는 `import`가 typecheck만 깨, 설정 파일 읽는 방식을 두 번 갈아엎음

- **영역**: `툴체인`
- **계열**: `라이브러리전제`
- **그물**: `없음`
- **증상**: `tokens.test.ts`가 `tailwind.config.js`의 `fontFamily.mono`를 단언해야 했다. `import config from "../../../tailwind.config.js"`는 `pnpm test` 8/8 green인데 `pnpm typecheck`만 **TS7016**(`Could not find a declaration file`)으로 실패한다. 한쪽 게이트만 돌리면 안 잡힌다.
- **근본 원인**: **런타임 게이트와 타입 게이트가 서로 다른 판정을 한다.** 런타임은 통과한다 — vite-node가 모든 모듈에 `require`를 주입해(`node_modules/vite-node/dist/client.mjs:371` `require: createRequire(href)`) config 마지막 줄의 `require("tailwindcss-animate")`가 `"type":"module"`에서도 살아난다. 하지만 `tsconfig.app.json`엔 `allowJs`가 없고(기본 false) `strict:true`(→`noImplicitAny`)라 tsc가 선언 파일 없는 `.js` import를 거부한다. **더 나쁜 건 근거가 두 번 다 틀렸다는 것**: 1판은 "config가 `require()`를 쓰니 vitest에서 터진다"는 **미검증 전제**로 텍스트 파싱을 택했고(거짓 — 런타임은 성공), 리뷰가 그걸 반박해 `import`로 갈아탔더니 typecheck가 깨졌다. 결론(텍스트 파싱)은 처음부터 맞았는데 **이유가 두 번 다 달랐다** — 즉 "왜"를 실측하지 않으면 맞는 결론도 다음 리뷰에 뒤집힌다.
- **재발 방지**: (1) **"돌아가더라"는 절반의 검증** — 게이트가 둘(`pnpm test` + `pnpm typecheck`)이면 **둘 다 돌려야** 판정이다. 한쪽 green을 근거로 설계를 확정하지 말 것. (2) **`src/**/__tests__/`에서 저장소 루트의 `.js` 설정 파일(`tailwind.config.js`·`postcss.config.js`)을 읽어야 하면 `import` 금지, `readFileSync`+정규식** — `tokens.test.ts:parseTokens`/`parseFontStack`이 선례다. 확인: `grep -n "allowJs" tsconfig.app.json`(없으면 import 불가) + `grep -rn "@ts-expect-error\|@ts-ignore" src/`(**0건이 저장소 관례** — 테스트 하나 때문에 첫 사례를 만들지 말 것). (3) 코드를 읽는 정규식은 **주석 선제거 후 따옴표 리터럴만 추출**해야 배열 내 주석·prettier 리플로우에 안 깨진다. 파서를 새로 쓰면 **기존 배열로 먼저 검증**한다(`parseFontStack("sans")`가 12개·`sans-serif` 종료를 내는지).
- **관련**: `src/styles/__tests__/tokens.test.ts:parseFontStack`(+ 옆의 `parseTokens`가 같은 기법의 원조), `tsconfig.app.json`(`allowJs` 부재), `tailwind.config.js:88`(`require()` 2개 — 마지막 줄이 아니라 `:89`가 `};`).

## 2026-07-16 — `pnpm add pkg@X`가 박은 정확 고정을 손으로 캐럿으로 고쳐, lockfile specifier가 드리프트해 `--frozen-lockfile`이 깨짐

- **영역**: `툴체인`
- **계열**: `드리프트`
- **그물**: `없음`
- **증상**: `pnpm install --frozen-lockfile`이 `ERR_PNPM_OUTDATED_LOCKFILE`로 실패한다(`@fontsource-variable/geist-mono` — lockfile: `5.2.8`, manifest: `^5.2.8`). **로컬에선 아무 증상이 없다** — `.github/workflows`에 install 잡이 없어 깨지는 게이트가 지금은 없고, 다음에 누가 `pnpm install`을 돌리면 무관한 커밋에 lockfile 변경이 딸려온다.
- **근본 원인**: `pnpm add pkg@5.2.8`은 manifest에 **정확 고정**(`"5.2.8"`)을 쓴다. 그런데 이 저장소는 캐럿이 관례라(`dependencies` 47개 중 캐럿 46 : 정확 1) 손으로 `^`를 붙이게 되는데, **`pnpm install`을 다시 안 돌리면 lockfile의 `specifier` 필드는 옛 값 그대로** 남는다. `version`은 같아서 설치 결과물은 동일하고, 그래서 테스트·빌드·typecheck가 전부 green이라 **어느 게이트에도 안 걸린다**. 설계 문서가 "`minimumReleaseAge` 때문에 버전을 명시한다"고 적은 것도 혼동을 키웠다 — 그건 **설치 명령**에 버전을 쓰라는 논거이지 manifest를 정확 고정하라는 논거가 아니다(재결정은 lockfile이 이미 막는다).
- **재발 방지**: (1) **새 의존성을 추가하고 manifest 범위를 손으로 고쳤으면 반드시 `pnpm install`을 다시 돌린다.** 확인은 `pnpm install --frozen-lockfile`이 `Already up to date`를 내는지 — 이게 유일한 자동 검사다(로컬 test/build/typecheck는 전부 통과한다). (2) 범위 표기는 저장소 관례를 따른다: `node -e 'const d=Object.entries(require("./package.json").dependencies); console.log("caret",d.filter(([,v])=>v.startsWith("^")).length,"exact",d.filter(([,v])=>/^\d/.test(v)).length)'`. (3) 이 함정은 **specifier만 갈리고 version은 같아** diff에서 두 파일을 대조해야 보인다 — `git diff -- package.json pnpm-lock.yaml`을 같이 본다.
- **관련**: `package.json`(`dependencies`), `pnpm-lock.yaml`(`importers` 아래 `specifier`/`version` 쌍), `pnpm-workspace.yaml`(`minimumReleaseAge: 1440` — 설치 명령 버전 명시의 진짜 이유).

## 2026-07-16 — 본문에 삽입한 로그가 Slack에서 평문화되고 엉뚱한 섹션이 코드블럭에 씌워짐 (4000자 초과분을 Slack이 임의로 쪼개 fence를 끊음)

- **영역**: `어댑터`
- **계열**: `라이브러리전제`
- **그물**: `unit`
- **증상**: 실사용 리포트. 로그 삽입 기능으로 만든 이슈를 Slack에 보냈더니 한 건은 **로그가 코드블럭이 아니라 일반 인라인 텍스트**로 나왔고, 다른 건은 **코드블럭이 엉뚱한 "재현 과정" 섹션에 씌워졌다.** 결정적 단서는 "짧은 로그는 정상"이었다 — 내용이 아니라 **크기**에 걸린 문제.
- **근본 원인**: 2층이다. ① `chat.postMessage`의 `text`는 **4000자 한계**이고 넘으면 **Slack이 알아서 여러 메시지로 쪼갠다**(리포트에 `[오후 9:15]`가 여러 번 찍힌 게 그 증거였다). 코드블럭 fence는 메시지 경계를 못 넘으므로 첫 조각만 블록으로 닫히고 나머지는 평문으로 흐르며, 경계가 펜스 사이에 떨어지면 뒤 섹션이 통째로 코드블럭에 말려든다. `submitToSlack`은 본문 전체를 `text` 하나로 넘기고 **어디에도 길이 처리가 없었다** — 삽입 로그는 body당 16384자 캡이라 4000을 우습게 넘는다. ② 그 전에 심어둔 `neutralizeFences`(본문의 라인 시작 백틱 런을 4칸 들여써 무해화)는 **CommonMark의 닫힘 fence 들여쓰기 ≤3 규칙**을 전제하는데, Slack의 `markdownToMrkdwn`만 손으로 짠 라인 스캐너라 `/^```/.test(line.trim())` — `.trim()`이 들여쓰기를 지워 무해화가 무력화됐다. **8개 빌더 중 7개(markdown-it 계열·GFM)는 통하고 Slack만 샜다.**
- **재발 방지**: (1) **본문에 들어가는 텍스트의 상한을 정할 땐 "가장 빡빡한 소비처"를 기준으로 센다** — 설계 때 Notion 2000자는 잡았으면서 Slack의 per-message 4000자는 계산에 없었다. `grep -rn "postMessage\|chat\.\|/messages" src/background/*-api.ts`로 메시지형 API의 길이 한계를 먼저 확인할 것. 트래커(이슈 본문)와 **메시지 앱은 길이 축이 다르다**. (2) **"짧으면 정상, 길면 깨짐"은 렌더러가 아니라 전송 계층을 의심**한다 — 마크다운 문법을 아무리 봐도 안 나온다. (3) **8개 빌더에 공통으로 나가는 텍스트를 만들 땐 빌더별 파서 전제를 전수 확인**한다: markdown-it 계열(Jira ADF·Notion·Asana)·GFM(GitHub·GitLab·Linear·ClickUp)은 CommonMark 규칙을 따르지만 **Slack만 자체 라인 스캐너**다. `grep -rn "inFence\|```" src/sidepanel/lib/markdownToMrkdwn.ts`로 그 예외를 확인. (4) 단위 `splitSlackText.test.ts`(펜스 보존 분할·하드 분할 원문 보존)·`submitToSlack.test.ts > 긴 본문 분할`(답글 N개·조각마다 펜스 짝수·각 ≤4000자)·`markdownToMrkdwn.test.ts`(들여쓰기 ≤3 규칙)가 고정. (5) **Slack 화면의 실제 렌더는 저장소 안에서 검증 불가** — mrkdwn은 CommonMark가 아니라 4칸 들여쓴 백틱이 Slack에서 어떻게 보이는지는 실제 제출로만 확인된다(수동 잔여).
- **관련**: `src/sidepanel/lib/splitSlackText.ts`(`SLACK_TEXT_LIMIT=3800`·펜스 보존 분할), `src/sidepanel/lib/submitToSlack.ts`(스레드 답글 N개 순차 전송), `src/sidepanel/lib/markdownToMrkdwn.ts`(fence 판정 `/^ {0,3}```/`), `src/sidepanel/lib/logToCodeBlock.ts:neutralizeFences`(tiptap-markdown이 fence를 3백틱으로 하드코딩하고 본문을 escape하지 않는 게 이 계열의 뿌리). 계열: 2026-07-14 "로그 지원 매트릭스 단일 출처 우회"(본문 노출은 8곳에 동시 전파된다).

## 2026-07-16 — 접힌 섹션에서 로그를 삽입하면 다이얼로그만 닫히고 아무 일도 안 일어남 (Section이 children을 언마운트해 editorRef가 null)

- **영역**: `에디터`
- **계열**: `라이브러리전제`
- **그물**: `수동`
- **증상**: 섹션을 접은 채 헤더의 [로그 추가]를 누르면 다이얼로그가 정상으로 열리고, 탭을 고르고 행을 선택하고 [추가]까지 눌러도 **다이얼로그만 닫히고 본문엔 아무것도 안 들어간다.** 에러도 토스트도 없다.
- **근본 원인**: 표면(삽입 실패)과 원인(레이아웃 컴포넌트)이 다른 레이어. `Section.tsx`가 `{(!collapsible || open) && <div>{children}</div>}`로 **접히면 children을 통째로 언마운트**하는데, 액션 버튼은 헤더에 있어 접힌 상태에서도 살아 있다. 그래서 `editorRef.current`가 null인 채 `editorRef.current?.insertCodeBlock(...)`이 **optional chaining으로 조용히 no-op**된다. ref를 통한 명령형 호출 + 조건부 언마운트 + `?.`의 조합이 "실패를 성공처럼" 만든다.
- **재발 방지**: (1) **명령형 ref 호출의 대상이 조건부로 언마운트되는지 확인한다** — `grep -rn "Ref.current?\." src/sidepanel/tabs src/sidepanel/components`로 `?.` 호출을 훑고, 그 ref가 가리키는 컴포넌트가 `collapsible`·탭·Suspense 안에 있으면 no-op 경로가 있다. `?.`는 null을 **정상 흐름으로 삼켜** 실패가 안 보인다. (2) **트리거와 대상이 같은 마운트 스코프에 있는지 본다** — 헤더(항상 렌더)에서 body(조건부 렌더)를 조작하는 구조가 이 함정의 형태다. (3) 고칠 땐 트리거가 **먼저 펼치게** 한다(`Section`에 optional 제어 `open`/`onOpenChange` 추가, 미공급 시 기존 비제어 동작 유지 — 공용 컴포넌트라 비침습이 조건). (4) **같은 함정이 `draft.addImage`에 그대로 남아 있다**(`DraftingPanel.tsx`의 `editorRef.current?.insertImageFile`) — 접힌 섹션에서 이미지 추가도 조용히 사라진다. 캡처 버튼은 store 경로(`startInlineCapture` → `appendInlineImage`)라 무관. (5) 이 부류는 **순수 함수 테스트로 절대 안 잡힌다** — 직렬화도 다이얼로그도 전부 green인데 화면만 아무 일이 없다. 렌더 테스트나 실제 클릭이 유일한 감지 수단.
- **관련**: `src/sidepanel/components/Section.tsx`(제어 `open`/`onOpenChange` + 비제어 폴백), `src/sidepanel/tabs/DraftingPanel.tsx:SectionTextarea`(로그 버튼이 `setSectionOpen(true)` 후 다이얼로그 오픈), 미해결 잔여 `draft.addImage`.

## 2026-07-16 — "팔레트를 단일 출처로 승격했다"는 주석·커밋 메시지가 거짓인 채 머지됨 (복제본이 그대로 남아 있었다)

- **영역**: `디자인`
- **계열**: `복제본`, `미검증단언`
- **그물**: `unit`
- **증상**: 코드 동작엔 증상이 없었다. `highlightJson.ts` 헤더 주석이 "JsonTreeViewer와도 팔레트를 공유해 세 화면이 안 갈린다"고 단언하고 커밋 메시지도 "palette lifted out of the component"라고 했는데, **실제로는 `JsonTreeViewer.tsx`가 자기 `VALUE_COLORS`를 그대로 들고 있었고 `highlightJson`을 import조차 안 했다.** 값이 같아서 아무도 못 느낀 잠복 상태.
- **근본 원인**: 새 파일(`highlightJson.ts`)에 팔레트를 **복사해 넣고 원본을 안 지웠다.** diff에는 신규 파일과 그 주석만 보이고 `JsonTreeViewer.tsx`는 등장하지 않으니 **리뷰에서 diff만 봐선 구조적으로 안 보인다** — "승격했다"는 주장은 diff 밖 파일의 상태에 대한 것이라 diff 리뷰의 사각이다. 정작 2026-06-28 항목이 같은 계열에 "**복제본은 늘 대조 테스트로 묶는다**"고 못박아 뒀는데 그걸 다시 밟았다.
- **재발 방지**: (1) **"단일 출처로 승격/통합했다"고 쓸 땐 원본이 실제로 사라졌는지 grep으로 확인**한다 — `grep -rn "<옛 상수명>" src`가 0이어야 주장이 참이다. 주석·커밋 메시지의 "공유한다/단일 출처다"는 **검증 가능한 단언**이지 수사가 아니다. (2) **새 모듈에 값 테이블을 만들 땐 그 값이 이미 어딘가 있는지 먼저 찾는다** — `grep -rn "text-purple-700\|text-red-700" src`류로 같은 값의 복제를 잡는다. (3) 이 건은 **`/doc-check`가 잡았다**(문서 에이전트 2개가 주석을 읽고 코드로 대조) — 주석이 코드보다 앞서 나간 거짓말은 diff 리뷰가 아니라 **문서↔코드 양방향 대조**에 걸린다. 코드 주석도 검사 대상으로 취급할 것. (4) 복제가 불가피하면(별도 번들 등) 대조 테스트로 묶는다 — 선례 `log-viewer/__tests__/i18n.test.ts`(메인 테이블 drift 대조), `styles/__tests__/tokens.test.ts`(두 토큰 표 동등성).
- **관련**: `src/sidepanel/lib/highlightJson.ts:JSON_TOKEN_CLASS`(단일 출처), `src/sidepanel/components/JsonTreeViewer.tsx`(`VALUE_COLORS` 삭제 → import). 계열: 2026-06-28 "log-viewer 복제 dict 미동기화", 2026-07-03 "같은 로그를 두 독립 렌더 경로가 그림".

## 2026-07-16 — 배경용으로 설계된 shadcn `--destructive`를 글자색으로만 소비해, 다크에서 "작성 취소"가 대비 2:1로 안 읽힘

- **영역**: `디자인`
- **계열**: `복제본`
- **그물**: `unit`
- **증상**: 다크 테마에서 `destructive-outline` 버튼(작성 취소 등) 레이블이 **엄청 흐리게** 보였다. 라이트에선 멀쩡해서 오래 방치됐다.
- **근본 원인**: 토큰의 **설계 용도와 실제 소비처가 어긋났다**. shadcn 다크 프리셋의 `--destructive: 0 62.8% 30.6%`는 `bg-destructive` + `text-destructive-foreground`(흰 글자) 조합, 즉 **배경색**으로 쓰라고 어두운 빨강(= red-900)으로 잡힌 값이다. 그런데 이 앱은 `variant="destructive"`(bg 형)를 **한 번도 안 쓰고** `text-destructive`(27곳)·`destructive-outline`(5곳)로 **글자색으로만** 소비한다 → 거의 검은 배경(`0 0% 3.9%`) 위 red-900 글자 = **실측 2.0:1**(WCAG AA 4.5:1의 절반 미만). 라이트가 무증상인 건 우연 — 라이트 `--destructive`는 같은 토큰인데 shadcn이 red-500(`0 84.2% 60.2%`)으로 잡아둬서 글자로 써도 3.76:1은 나온다. **한 토큰이 테마별로 다른 용도를 전제**하는데 코드는 한 용도로만 쓰는 구조라, 라이트만 보면 영원히 안 보인다.
- **재발 방지**: (1) **shadcn 프리셋 값을 그대로 받을 땐 "그 값이 어느 용도로 잡혔나"를 확인**한다 — `--destructive`·`--primary`처럼 `bg`/`text` 양쪽으로 쓸 수 있는 토큰은, 실제 소비 형태를 `grep -rn 'variant="destructive"' src`(bg 형 사용 여부) / `grep -rEoh '\b(text|bg)-destructive\b' src | sort | uniq -c`로 **먼저 세고** 값을 고른다. bg 소비처가 0이면 프리셋의 bg용 값은 그냥 틀린 값이다. (2) **대비는 눈이 아니라 수치로 고정**한다 — `src/styles/__tests__/tokens.test.ts`가 hsl→상대휘도→대비비로 다크 destructive 4.5:1 하한을 박았다. 색은 단위 테스트로 "예쁨"은 못 잡아도 **대비는 잡는다**. (3) **테마 한쪽만 증상이 나는 버그는 반대 테마 검증을 통과한다** — 색 토큰을 건드리면 라이트/다크를 **양쪽 다** 계산하거나 눈으로 본다(같은 교훈: 2026-07-03 로그뷰어 툴팁 항목의 "다크 전용 발산은 라이트/일반 테스트에 안 잡힌다"). (4) 같은 토큰이 **라이트에서도 3.76:1로 AA 미달**이었다(shadcn red-500). 다크가 워낙 심해서(2:1) 라이트는 "읽히니까" 안 보였던 것 — **증상이 심한 테마를 고칠 때 반대 테마도 같이 재라.** 지금은 라이트 red-600(4.83:1)/다크 red-500(5.26:1)으로 갈라 양쪽 AA를 넘겼고, `tokens.test.ts`가 두 테마 모두 4.5 하한으로 고정한다.
- **관련**: `src/styles/globals.css`(`.dark`의 `--destructive`), `src/log-viewer/styles.css`(복제 토큰 표 — 함께 갱신), `src/components/ui/button.tsx`(`destructive-outline` = `text-destructive`, 미사용 `destructive` = `bg-destructive`), `src/styles/__tests__/tokens.test.ts`(대비 하한 + 두 표 동등성). 토큰 표가 두 파일에 복제된 구조 자체는 "별도 번들이 메인 모듈을 복제" 계열(아래 2026-06-28 log-viewer i18n dict 항목의 "복제본은 늘 대조 테스트로 묶는다")을 이 쌍에 적용한 것 — 이 쌍이 실제로 발산한 적은 아직 없다.

## 2026-07-16 — "결과 무관 1회" 래치와 effect cleanup 취소가 만나, 취소된 AI 요청을 아무도 이어받지 않아 재현 단계가 영구 미충전

- **영역**: `AI`
- **계열**: `취소래치`
- **그물**: `jsdom`
- **증상**: video 캡처 후 작성 화면에서 재현 단계 자동 채움이 **조용히 안 됐다** — 로딩 오버레이는 떴다 사라지고, 실패 토스트도 없고, BYOK 호출은 1회 소진됐는데 섹션은 빈 채로 남고 재시도도 없다. 재현 조건이 좁아(in-flight 중 `trimming` 왕복, 또는 설정 변경으로 `capabilities`/`createSession` 정체성 변경) 육안으론 잡히지 않았고, `/code-review`는 이 자리를 **"dev StrictMode 이중 발화(⚪ dev 전용 비용)"로만 분류**해 지나갔다.
- **근본 원인**: 각각 옳은 두 설계의 **결합**이 함정이었다. (1) `setReproPrefillDone(true)`를 응답 **전에** 선기록한다 — 실패·공백이어도 세션 1회로 못박아 BYOK 할당량 반복 소모를 막는 의도된 설계. (2) effect cleanup이 `cancelled = true`로 in-flight를 취소한다 — stale 적용을 막는 표준 패턴. 둘이 만나면: effect 재실행 시 cleanup이 요청을 취소하고, 재실행된 setup은 done 래치에 걸려 early-return하므로 **아무도 그 요청을 이어받지 않는다.** 응답이 도착해도 `if (cancelled) return`으로 폐기되고 done은 이미 true라 재발화도 없다. **취소는 원래 "다시 하겠다"는 뜻인데 래치가 "다시 안 한다"고 못박아, 취소가 곧 영구 포기로 뒤집힌 것.** deps의 `trimming`·`capabilities`·`createSession`(`useAI`가 `llm`에 memo)이 prod에서 실제로 재실행을 만든다. StrictMode는 이 결함의 **원인이 아니라 드러내는 특수 케이스**였을 뿐인데, 그 표면만 보고 dev 이슈로 오분류한 게 진단 실패의 핵심. 더 나쁜 건 1차 픽스였다 — 이중 발화를 막으려 `doneRef.current = true` 래치를 **추가**하자, 같은 함정의 반대쪽으로 빠져 dev에서 결과 유실이 100% 재현되게 됐다(호출 2회·적용 1회 → 호출 1회·적용 0회).
- **재발 방지**: (1) **"결과 무관 1회" 래치와 cleanup 취소를 같은 흐름에 두면, 재실행이 in-flight를 이어받는 경로가 반드시 있어야 한다** — 래치를 추가할 땐 "취소된 요청은 누가 이어받나?"를 먼저 답한다. `grep -rn "Done(true)\|doneRef\|cancelled = true" src/sidepanel/hooks/`로 래치+취소 결합 지점을 훑는다. (2) **"dev 전용"·"StrictMode 한정" 분류를 의심하라** — StrictMode 이중 실행은 prod에 없지만 그것이 드러내는 결함(cleanup↔래치 결합)은 **prod의 deps 변경으로 똑같이 터진다.** StrictMode 발견은 dev 비용이 아니라 **prod 재실행 경로의 리허설**로 취급하고, non-StrictMode deps 왕복 테스트로 환산해 재현해 본다(이번에 그 환산이 prod 유실을 드러냈다). (3) **비동기 1회성 작업의 가드는 호출 횟수가 아니라 결과를 단언** — 1차 픽스의 테스트는 `generateReproStepsWithAI` 1회만 봐서 `setDraft` 0회(유실)를 green으로 통과시켰다. "몇 번 불렀나"와 "채워졌나"를 **함께** 본다. (4) **가드의 비공허성은 분기를 일시 제거해 red를 확인**한다 — 채택 분기를 지우면 "게이트 왕복"·"StrictMode" 2케이스가 red가 되는 걸 실증했다.
- **관련**: `src/sidepanel/hooks/useReproPrefill.ts`(`runRef` 채택 분기 + `doneRef.current` 선래치, cleanup 재등록), 테스트 `src/sidepanel/hooks/__tests__/useReproPrefill.test.tsx`("in-flight 중 게이트가 껐다 켜져도…"·"StrictMode 이중 마운트…"), 의도된 선기록 설계 `src/store/editor-store.ts`(`reproPrefillDone`, 재캡처 시 `...initial`로 리셋).

## 2026-07-16 — toLocaleString의 timeZoneName 옵션이 ko 시간 스켈레톤을 바꿔 콜론 포맷이 깨짐

- **영역**: `lib`
- **계열**: `라이브러리전제`
- **그물**: `unit`
- **증상**: Captured 시각에 타임존 표기를 추가(`timeZoneName: "shortOffset"`)했더니, ko-KR UI에서 시간이 `09:01:50`(콜론) → `09시 1분 50초`로 바뀌고 분 2-digit 패딩까지 깨졌다(`1분`). en-US는 `09:01:50 AM GMT+9`로 멀쩡. 단위테스트는 `dateBcp47`을 en-US로 고정 mock해서 **green이었는데도 ko 화면이 깨진** 상태 — 사용자가 육안으로 발견.
- **근본 원인**: `Intl.DateTimeFormat`(`toLocaleString`)에 `timeZoneName`을 옵션으로 섞으면 **ICU가 로케일별 time skeleton을 재선택**한다. ko 기본 패턴은 timezone 동반 시 `시/분/초` 한글 표기를 쓰고, 그 과정에서 `hour/minute/second: "2-digit"` 지정이 무력화된다. "오프셋을 뒤에 붙인다"는 의도와 달리 옵션 한 줄이 시간 표기 스타일 전체를 갈아치웠다. en 패턴은 timezone에도 콜론을 유지해 **en-only 테스트로는 구조적으로 못 잡힌다**.
- **재발 방지**: (1) **표시용 날짜/시각에 오프셋·타임존을 넣을 땐 `timeZoneName` 옵션이 아니라 offset suffix를 수동 조립**한다(`getTimezoneOffset` → `GMT+9`). `grep -rn "timeZoneName" src/`로 신규 유입 감시. (2) **로케일 의존 포맷 함수 테스트는 en 하나로 끝내지 않는다** — `dateBcp47` mock을 `vi.hoisted` ref로 가변화해 **ko-KR 등 CJK 로케일 케이스**를 반드시 포함(콜론 시간 유지 + `시/분/초` 미전환 단언). `grep -rn "toLocaleString\|Intl.DateTimeFormat" src/`가 로케일 편차 위험 지점. (3) 넓게 퍼지는 표시 헬퍼(`formatTimestamp`는 Captured 13곳 단일 출처)는 로케일 회귀가 전 트래커 본문에 번지므로 mock 로케일 스윕이 값싸고 필수.
- **관련**: `src/sidepanel/lib/formatTimestamp.ts`(`gmtOffset` suffix 조립, `timeZoneName` 제거), 테스트 `src/sidepanel/lib/__tests__/formatTimestamp.test.ts`(가변 로케일 mock + ko 회귀 케이스). 커밋 `2a2ed6c`.

## 2026-07-14 — 액션 로그 마스킹이 값 경로만 막아, 이름 경로(accessibleName)로 저작물·PII가 그대로 유출

- **영역**: `content`
- **그물**: `unit`
- **증상**: 액션 로그의 민감 입력 마스킹은 "구현돼 있다"고 믿고 있었는데, 실제로는 리치 에디터(Gmail·Notion·Slack) 본문을 클릭하거나 그 안에서 Enter만 눌러도 **작성 중인 글 80자가 엔트리의 `target`에 그대로 실렸다.** 값(`value`)은 마스킹되는데 이름(`target`)으로 같은 텍스트가 도로 나가는 구조. 스크린샷 캡처에도 액션 로그가 붙기 시작하면서(v1.5.8) 이 구멍이 가장 흔한 경로에 올라탔다.
- **근본 원인**: 마스킹 게이트가 **값을 쓰는 함수에만** 붙어 있었다(`recordInput`·`recordSelect`). 그런데 액션 엔트리에 텍스트가 실리는 경로는 값 말고 **이름**이 하나 더 있다 — `accessibleName()`이 aria-label이 없으면 `el.textContent`로 폴백하고, 그 결과가 click·drag·keypress의 `target`이 된다. 즉 "무엇을 입력했나"는 막았는데 "무엇을 클릭했나"가 같은 텍스트를 실어 날랐다. 두 경로가 대칭이라는 걸 못 본 게 핵심. 부수적으로 라벨 판정(`shouldMaskField`)이 `fieldLabel()`이 이미 읽는 소스(`label[for]`·암묵 라벨·`aria-labelledby`·placeholder)를 안 받고 있어서 `<label for>Card number</label>` 같은 평범한 폼이 통째로 새고 있었고, 정규식이 영문 전용이라 **한국어 라벨 폼은 전부 미탐**이었다.
- **재발 방지**: (1) **액션 엔트리에 페이지 텍스트가 실리는 경로는 값·이름 둘 다** — `grep -n "accessibleName\|fieldLabel\|recordInput\|recordSelect" src/content/action-recorder.ts`로 네 곳을 전수 확인한다. 새 `record*` 함수를 추가하면 **어느 필드로 페이지 텍스트가 들어가는지**를 먼저 묻고, 값이면 `isSensitiveValue`, 이름이면 `accessibleName`/`fieldLabel`을 경유시킨다(직접 `textContent`를 읽지 않는다). (2) **마스킹 판정 소스는 라벨 추출 소스와 같아야 한다** — `fieldLabel()`이 읽는 것(`aria-label`·`label[for]`·`aria-labelledby`·placeholder·name)과 `shouldMaskField`의 `MaskFieldInput`이 어긋나면 그 차집합이 곧 유출 경로다. 한쪽에 소스를 추가하면 다른 쪽도 본다. (3) **라벨 기반 판정만으론 구조적으로 못 막는다** — 생성된 id(`:r3:`)·커스텀 폼·라벨 없는 입력이 항상 남으므로 값 형태 판정(`isSensitiveValue`)이 2층으로 필요하다. (4) **판정 소스를 넓히면 부분일치 오탐이 터진다** — placeholder·라벨은 사람이 읽는 문구라 `pin`⊂ship**pin**g, `auth`⊂**auth**or, `card`⊂dis**card**가 정상 폼을 죽인다. 영문은 `\b` + `normalizeName`(camel/snake 분해)로 끊는다. 반대로 구분자에 `.`을 넣으면 소수(`1234.56789`)·IP가 9자리 숫자열로 승격돼 **재현에 필요한 값이 마스킹된다** — 마스킹 강화는 항상 오탐 쪽도 테스트로 고정한다(`action-recorder-helpers.test.ts`의 "부분일치 오탐 방지"·"소수·IP는 원문 유지").
- **관련**: `src/content/action-recorder-helpers.ts`(`shouldMaskField` 라벨 소스 확대 + `\b`·`normalizeName`, 신규 `isSensitiveValue`), `src/content/action-recorder.ts`(`accessibleName`→`rawAccessibleName` + 마스킹 게이트, `fieldLabel`→`rawFieldLabel` + 게이트, `labelForText` 암묵 라벨·`aria-labelledby`, `recordInput` contentEditable 값 미기록, `recordSelect` 판정 적용), 테스트 `src/content/__tests__/action-recorder-helpers.test.ts`. `recordToggle`은 값이 `checked`/`unchecked`뿐이라 의도적 제외.

## 2026-07-14 — 로그 지원 매트릭스 단일 출처를 우회한 하드코딩 1곳이 남아, 액션 로그가 UI 없이 침묵 첨부

- **영역**: `어댑터`
- **계열**: `복제본`, `드리프트`
- **그물**: `unit`
- **증상**: `supportsActionLog`를 확장해(video 전용 → screenshot·freeform) 액션 로그를 스크린샷 리포트에도 붙였는데, drafting 화면에 **액션 로그 카드도 첨부 토글도 안 나타났다.** 그런데 첨부는 정상으로 됐다 — 즉 사용자는 액션 로그(입력값 포함)가 리포트에 실려 나가는 걸 보지도, 끄지도 못하는 상태. preview로 넘어가면 그제야 카드가 나타나 같은 세션에서 UI가 모순됐다.
- **근본 원인**: `captureLogSupport.ts`가 "로그 정책 매트릭스 단일 진실"이고 소비처가 5곳이라 믿었는데 **6번째가 있었다** — `DraftingPanel.tsx`가 `supportsActionLog`를 import조차 안 하고 `isVideoMode`를 하드코딩해 카드를 게이트하고 있었다. 계약(함수)을 고쳐도 그 함수를 안 쓰는 곳은 따라오지 않는다. 더 나쁜 건 방향이었다 — **첨부 경로(`buildCaptureFiles`)는 게이트를 경유해 새 계약을 따랐고 UI만 옛 계약에 남아서**, "첨부는 되는데 안 보인다"는 최악의 조합(침묵 첨부)이 됐다. 반대 방향(보이는데 첨부 안 됨)이었으면 즉시 눈에 띄었을 것이다. 이건 POSTMORTEM 2026-06-25(video+action-only에서 본문이 첨부를 참조 못 해 고아가 됨)와 **같은 계열**이다 — 단일 출처를 우회한 지점이 하나라도 있으면 첨부·본문·UI 중 하나가 조용히 어긋난다.
- **재발 방지**: (1) **게이트 함수를 고칠 땐 그 함수를 "안 쓰는" 곳을 찾는다** — `grep -rn "supportsActionLog\|supportsConsoleNetworkLog" src/`로 소비처를 세는 것만으론 부족하고, `grep -rn 'isVideoMode\|=== "video"' src/sidepanel/ | grep -i "log\|action"`처럼 **같은 판정을 하드코딩한 잔여**를 반대로 훑어야 한다. 이번에도 이 역방향 grep이 6번째를 잡았다. (2) **첨부·본문·UI 세 표면이 항상 같은 게이트를 타는지 확인** — 하나만 새 계약을 따르면 침묵 첨부(UI 없음) 또는 고아 첨부(본문 참조 없음)가 된다. `captureLogSupport`의 소비처는 현재 6곳: `DraftingPanel`·`PreviewPanel`·`DraftDetailDialog`(UI) / `buildCaptureFiles`(첨부) / `buildEditorCapture`(본문 ctx) / `captureLogSupport` 자신. (3) **프라이버시 데이터의 노출 확대는 opt-out UI가 같은 커밋에 없으면 미완성** — 첨부 스코프를 넓히는 변경은 그 데이터를 끌 수 있는 UI가 함께 노출되는지를 완료 조건으로 본다. (4) e2e `action-log-scope.spec`이 스크린샷 drafting에서 카드 노출 + 토글 기본 ON + element 부재를 고정한다(과거엔 액션 UI가 video 전용이라 e2e로 못 잡았고, 그게 COVERAGE의 제외 사유였다 — 스코프 확장이 오히려 테스트 표면을 열었다).
- **관련**: `src/sidepanel/lib/captureLogSupport.ts`(`supportsActionLog` 계약), 우회 지점 `src/sidepanel/tabs/DraftingPanel.tsx:showActionCard`(`isVideoMode` → `supportsActionLog`), 동반 누락 `src/sidepanel/tabs/PreviewPanel.tsx`(마크다운 복사 ctx의 로그 요약 — screenshot 분기는 3종 전부, freeform은 action이 빠져 제출 본문과 갈렸다), 테스트 `src/sidepanel/lib/__tests__/buildEditorCapture.test.ts`(ctx 게이트)·`captureLogSupport.test.ts`, e2e `e2e/action-log-scope.spec.ts`. 선행 회고: 2026-06-25(같은 단일 출처 우회 계열).

## 2026-07-14 — 토큰 갱신이 authedFetch 안에만 갇혀, Jira 영상이 간헐적으로 본문에서 누락

- **영역**: `어댑터`
- **계열**: `복제본`
- **그물**: `unit`
- **증상**: Jira(OAuth) 이슈 제출 시 영상이 본문에 인라인되지 않고 "(첨부 녹화 파일 참조)" 텍스트로 폴백. **일부 이슈에서만** 발생하고 파일 크기와 무관(173KB짜리도 발생). 영상 파일 자체는 첨부 패널에 정상으로 남아 있어 "업로드는 됐는데 본문에만 없음". 이미지·로그는 멀쩡해서 영상만 골라 사라지는 것처럼 보였다.
- **근본 원인**: 갱신된 토큰이 **갱신을 수행한 함수 밖으로 안 나간다**. `authedFetch`는 401이면 `refreshOnce`로 토큰을 갱신하지만 그 결과를 **지역 변수에만** 담는다(`jira-api.ts`). 반면 `submitIssue`(`messages.ts`)는 `loadAuth()`로 읽은 auth 객체를 **값으로** 들고 전 호출 체인에 넘긴다 — 그래서 `createIssue`·`uploadAttachment`는 각자 내부 갱신으로 성공하지만(그래서 **파일은 첨부됨**), `submitIssue`가 쥔 사본은 끝까지 낡은 accessToken이다. 그리고 `getMediaFileId`만 유일하게 `authedFetch`를 안 탄다 — redirect된 `res.url`을 봐야 해서 생 `fetch`를 쓰고, `res.ok`를 검사하지 않는다. 결과적으로 **401 응답과 "아직 media 변환 전이라 리다이렉트가 없음"이 둘 다 `extractMediaId(res.url) === undefined`로 수렴**해 구분되지 않고, mediaId 없이 external 폴백 → 영상만 텍스트로 강등(이미지는 external media로도 렌더링돼 무증상). **간헐적인 이유**: 제출 직전에 필드 조회(프로젝트·이슈타입·담당자)가 돌면 그 갱신본이 storage에 박혀 `loadAuth()`가 fresh 토큰을 읽는다. 폼을 오래 열어뒀거나 드래프트에서 바로 제출해 **만료 토큰으로 submit에 진입한 경우**에만 이 경로를 밟는다.
- **재발 방지**: (1) **갱신 경로를 우회하는 fetch를 의심하라** — `grep -n "await fetch(" src/background/*.ts`로 `authedFetch`/`*Fetch` 래퍼를 안 타는 생 `fetch`를 전수하고, 각각 401을 어떻게 다루는지 확인한다. 리다이렉트 URL·헤더처럼 **응답 본문이 아닌 걸 봐야 해서 래퍼를 못 쓰는 함수**가 이 사각지대의 전형이다. (2) **실패와 "아직 안 됨"이 같은 값(undefined/null)으로 수렴하면 재시도는 영원히 무의미하다** — probe류는 상태 코드를 분기하고, 재시도로 흡수할 것(변환 지연)과 흡수 못 할 것(401)을 갈라라. (3) **auth를 값으로 넘기는 긴 호출 체인은 갱신본을 못 받는다** — 갱신이 호출자에게 전파되는지 확인하고, 안 되면 진입점에서 한 번 신선화(`ensureFreshAuth`)한다. 안 그러면 낡은 `expiresAt` 때문에 호출마다 refresh가 새로 트리거되고, Atlassian은 refresh token을 rotate하므로 **같은 rotate-out된 토큰 재사용 → `invalid_grant` 연결 끊김**으로도 번질 수 있다. (4) 회귀 테스트는 `__tests__/jira-media-id.test.ts > getMediaFileId`(만료 토큰 → 갱신 후 probe / probe 401 → 갱신 재시도 / 갱신 후에도 401이면 refresh 1회로 상한 / apiKey는 갱신 안 함 / 재시도 예산 ≥5초). e2e로는 못 잡는다 — 실제 만료 토큰과 Jira media API의 302가 필요해 결정적이지 않다.
- **관련**: `src/background/jira-api.ts`(`getMediaFileId` — `ensureFreshAuth`+401 재시도, `probeMediaRedirect`가 `Response` 반환, 재시도 예산 `[400,900]`→`[400,900,1500,2500]`), `src/background/messages.ts`(`jira.submitIssue` 진입 신선화, `logs.html`은 mediaId를 안 쓰므로 probe 스킵), `src/background/__tests__/jira-media-id.test.ts`.

---

## 2026-07-14 — 콤보박스 검색어 state가 팝오버 언마운트와 수명이 달라 "선택자 상단 고정"이 영구히 꺼짐

- **영역**: `컴포넌트`
- **계열**: `라이브러리전제`
- **그물**: `jsdom`
- **증상**: Jira 담당자 필드(이슈 제출/드래프트 다이얼로그)에서 선택된 사람이 목록 최상단에 안 나온다. 스펙(v1.4.5)대로 구현돼 있고 `orderSelectedFirst`도 그대로인데 실제로는 거의 항상 안 보인다 — 다이얼로그를 갓 열고 **검색을 한 번도 안 한 채** 열었을 때만 핀이 뜬다. CC·참조자·Slack 멘션(`CcMultiCombobox`)도 동일.
- **근본 원인**: 핀 정책에는 "검색 중이면 핀 해제"(결과가 화면 밖으로 밀리는 걸 막는 의도된 가드)가 붙어 있고, 그 판정이 컴포넌트 state `query`다. 그런데 **검색어의 실제 소유자는 cmdk의 `CommandInput`(uncontrolled)이고, 그건 `PopoverContent`와 함께 언마운트되며 리셋된다**. 반면 `query`는 필드 컴포넌트에 살아남는다. 즉 두 값의 **수명이 다르다** — 팝오버를 닫으면 입력창은 비었는데 `query`는 `"홍길"`로 남아 `searching === true`가 고착되고, 재오픈 시 목록은 전체로 다시 채워지는데 핀만 계속 꺼진 채다. 담당자를 검색해서 고르는 게 정상 흐름이라 사실상 상시 재현. 게다가 **`AssigneeField`의 항목 선택 경로가 `setOpen(false)`를 직접 호출해 `onOpenChange` 핸들러를 우회**하고 있어서, 닫기 핸들러에만 리셋을 넣은 1차 픽스는 여전히 red였다(핸들러를 안 타는 닫힘 경로가 따로 있었다).
- **재발 방지**: (1) **팝오버/다이얼로그 내부 입력의 파생 state는 열림 상태에 종속시켜라** — 언마운트로 리셋되는 uncontrolled 입력과 살아남는 `useState`를 짝지으면 조용히 어긋난다. `grep -rn "useState(\"\")" src/sidepanel/components src/sidepanel/tabs | grep -i "query\|search"`로 검색어 state를 전수하고, 각각 닫힐 때 리셋되는지 확인. (2) **팝오버를 닫는 경로가 하나인지 확인** — `grep -rn "setOpen(false)" src/sidepanel`에서 `onOpenChange` 핸들러를 우회하는 호출이 있으면 리셋·정리 로직이 새는 지점이다. 닫기 부수효과가 생기면 전부 단일 핸들러로 모은다. (3) 이 부류는 **순수 함수 테스트로 절대 안 잡힌다** — `ccOptions.test.ts`(`orderSelectedFirst`/`pinSelectedFirst`)는 도입 때부터 전부 green이었고 버그는 그 함수를 *호출하지 않는* 조건 쪽에 있었다. 헬퍼가 green인데 화면이 틀리면 **호출 게이트를 의심**하라. 회귀 테스트는 렌더 테스트로만 가능해서 이 픽스에서 jsdom + @testing-library를 처음 도입했다(`*.test.tsx`만 jsdom, 순수 함수 테스트는 node 유지 — `vitest.config.ts`의 `environmentMatchGlobs`). 재현 시나리오: **검색어를 타이핑해서** 고른 뒤 재오픈 — 검색 없이 고르면 통과한다. (4) 같은 v1.4.5가 GitHub·GitLab 담당자에는 핀 자체를 안 넣었다(이메일/동명이인 사유로 세 정책을 한꺼번에 제외) — 미해결로 남아 있음.
- **관련**: `src/sidepanel/tabs/jiraFields/AssigneeField.tsx`(`handleOpenChange`, `searching`), `src/sidepanel/components/CcMultiCombobox.tsx`(`handleOpenChange`), `src/sidepanel/components/ccOptions.ts`, `__tests__/AssigneeField.test.tsx`·`__tests__/CcMultiCombobox.test.tsx`(신규 렌더 테스트), 커밋 `5152a6f`(핀 도입 = 버그 유입).

---

## 2026-07-14 — 어노테이션 드래그: pointer capture 상실을 "제스처 취소"로 오독해 두 번째 도형부터 커서를 따라다님

- **영역**: `미디어`
- **계열**: `라이브러리전제`
- **그물**: `수동`
- **증상**: 스크린샷 주석에서 **첫 도형은 정상**인데, 두 번째부터 클릭(down→up) 후에도 도형이 커밋되지 않고 **마우스를 놓은 뒤에도 커서를 계속 따라다녔다**. 이후 모든 클릭이 먹지 않는다(진행 중 draft가 down 가드에 걸려). 캔버스 줌·팬을 붙이며 mouse → pointer 이벤트 + `setPointerCapture`로 전환한 것이 원인.
- **근본 원인**: **캡처 상실(`lostpointercapture`)은 제스처 취소가 아니다.** 포인터 아래에 이미 도형이 있는 상태에서 down하면 Chrome이 `stage.content`의 DOM pointer capture를 **제스처 도중 암묵적으로 놓는다**(첫 도형은 빈 캔버스라 hit이 없어 안 일어남 → "두 번째부터"라는 비대칭이 여기서 나온다). 이걸 취소 신호로 받아 `abortGesture`가 `drawPointerRef`를 비웠고, 뒤이어 도착한 **진짜 `pointerup`이 id 불일치로 early-return**해 `draftShape`가 영원히 살아남았다. 표면(그리기 UI)과 원인(브라우저 캡처 수명주기)이 다른 레이어. 그 위에 Konva의 두 함정이 겹쳐 3연속 오진을 만들었다: (1) Konva는 리스너를 `stage.container()`가 아니라 자식 `.konvajs-content`에 걸어서 container에 캡처를 걸면 드래그가 통째로 죽고, (2) Konva는 DOM `pointercancel`을 받아도 **노드 `pointercancel`을 발화하지 않고** 포인터 아래 도형이 있으면 **`pointerup`으로 둔갑시켜 쏜다**(`Stage.js:_pointercancel`) — 그래서 취소가 커밋으로 뒤집힌다. **최종 해법은 캡처를 쓰지 않는 것**: `pointerdown`만 Konva에서 받고 `pointermove`/`pointerup`/`pointercancel`은 **window에서** 받는다(좌표는 `stage.setPointersPositions(e)` → `getPointerPosition()`으로 얻어 CSS transform 역보정 유지).
- **재발 방지**: (1) **`lostpointercapture`를 종료 신호로 쓰지 말 것.** 제스처의 끝은 `pointerup`/`pointercancel`뿐이다. `grep -rn "lostpointercapture\|setPointerCapture" src/`로 캡처 의존 코드를 점검하고, 캡처는 "이벤트 배달 보조"로만 취급한다. (2) **Konva에 pointer 이벤트를 맡기지 말 것** — `grep -rn "onPointerCancel\|onPointerUp" src/sidepanel/components/annotation/`이 0이어야 한다(드래그 종료는 window). konva 업그레이드 시 `Stage.js`의 `_pointercancel`/`_bindContentEvents`를 재확인. (3) **드래그·포인터 로직은 단위 테스트로 절대 못 잡는다** — 순수 함수(`viewport.ts`) 46개가 전부 green인데 실제 캔버스는 먹통이었다. 게다가 **Playwright 합성 입력에서도 재현되지 않았다**(CDP 입력은 실제 Chrome의 암묵적 캡처 해제를 유발하지 않음 — 영역/전체 캡처·클릭/드래그 3조건 프로브 전부 통과). 이 부류는 **실제 Chrome + 콘솔 계측(어떤 이벤트가 어떤 순서로 오는가)만이 진실**이다. 의심되면 추론하지 말고 down/move/up/cancel/lostpointercapture를 전부 찍어라 — 로그 6줄이 3번의 잘못된 가설을 한 번에 끝냈다. (4) 회귀 감지: 실 브라우저에서 **도형을 두 개 연속으로, 두 번째를 첫 도형 위에서 시작**해 그린다(한 개만 그리면 통과한다).
- **관련**: `src/sidepanel/components/AnnotationOverlay.tsx`(`handlePointerDown`은 Konva, `onWindowMove`/`onWindowUp`/`onWindowCancel`은 window 리스너 + `gestureRef`, `stagePoint`), `konva/lib/Stage.js`(`_pointercancel`·`_bindContentEvents`), 커밋 `b3269ea`(캡처 도입)·`293e8bf`(잘못된 1차 픽스).

---

## 2026-07-10 — CodeMirror changeFilter의 protected range가 프로그램적 doc 교체를 삼켜 CSS 뷰 본문 전멸

- **영역**: `스타일해석`
- **계열**: `라이브러리전제`
- **그물**: `unit`
- **증상**: element 스타일 편집기 CSS 탭에서 AI 스타일링을 돌리거나 "모든 스타일 리셋"을 누르면, 코드 뷰가 선택자 1행(`a:nth-child(4) {`)만 남고 선언이 통째로 사라졌다. 편집 탭으로 갔다 돌아오면 멀쩡히 복구돼 "가끔 그러는 것 같은 느낌"으로만 보였다.
- **근본 원인**: 1행(가려진 `{`) 보호용 `EditorState.changeFilter`가 `[0, firstLineTo]`를 protected range로 반환한다. CodeMirror는 protected range와 **겹치는 변경 조각을 통째로 드롭**하는데(`ChangeSet.filter`), `@uiw/react-codemirror`는 `value` prop 동기화를 `{from:0, to:doc.length, insert:newDoc}` **전체 교체**로 dispatch한다. 이 교체는 1행과 겹치므로 삽입 텍스트가 붙은 조각이 드롭되고 **삭제만 살아남아** doc이 1행으로 붕괴한다. 즉 "1행만 보호"가 실제로는 "프로그램적 doc 교체 전체를 파괴"였다. 표면(본문 전멸)과 원인(다른 레이어의 필터가 상위 React 동기화를 클립)이 어긋난 케이스. **함정 포인트 3개**: (1) 타이핑은 본문 안에서만 변경하므로 필터가 무해해 보인다 — 회귀는 오직 *프로그램적* 재동기화에서만 터진다. (2) `StyleCssView`는 CSS 탭에서만 마운트되고 `key`로 remount되므로, **탭을 한 번만 왕복해도 `EditorState.create({doc: value})`로 재파생돼 증상이 사라진다**(create는 changeFilter를 안 거친다) — 재현·판정 시 탭 전환 금지. (3) 이 경로를 처음 노출시킨 건 직전 픽스([2026-07-08](#2026-07-08--ai-스타일-적용이-css-code-view-포커스-중이면-다음-타이핑에-조용히-덮어써짐))의 "AI 적용 시 포커스 무관 강행 재동기화"였다 — 강행 재동기화가 없었으면 setValue가 안 일어나 잠복했다. `onChange`가 안 불린 건 uiw가 외부 dispatch에 `External` 어노테이션을 달아 스킵해준 덕 — 안 그랬으면 `computeOverrides({}, specified)`가 전 속성을 `initial`로 방출해 페이지까지 리셋됐다.
- **재발 방지**: (1) **`changeFilter`/`transactionFilter`로 문서 일부를 보호할 땐 "사용자 입력에만" 걸어라** — 프로그램적 dispatch엔 `userEvent`가 없다. 판별은 `tr.annotation(Transaction.userEvent) !== undefined`. grep: `grep -rn "changeFilter\|transactionFilter" src/`. (2) **React 바인딩(`value` prop)이 doc을 어떻게 밀어넣는지 확인** — uiw는 full-range replace다. 부분 보호 필터와 full-range replace는 항상 충돌한다. (3) 마운트 조건이 붙은 에디터(`styleEditorView === "code"` + `key=elementKey`)는 **탭 왕복이 증상을 지운다** — 회귀 판정은 탭에 머문 채. e2e는 `ai-styling.spec.ts`의 "CSS 탭 유지 상태에서 AI 스타일링" 케이스가 그 지점(픽스를 되돌리면 red 확인됨). (4) 단위는 `selectorLock.test.ts`가 실제 `EditorState.update`로 전체 교체를 태워 본문 보존을 단언한다 — `@codemirror/state`는 직접 dep가 아니라 `@uiw/react-codemirror`의 re-export로 import.
- **관련**: `src/sidepanel/tabs/styleEditor/selectorLock.ts`(`selectorLineChangeFilter`), `CssCodeMirror.tsx`(`lockSelectorLine`), `__tests__/selectorLock.test.ts`, `e2e/ai-styling.spec.ts`.

---

## 2026-07-08 — AI 스타일 적용이 CSS code view 포커스 중이면 다음 타이핑에 조용히 덮어써짐

- **영역**: `스타일해석`, `AI`
- **계열**: `취소래치`
- **그물**: `unit`
- **증상**: element 스타일 편집기의 CSS code view(CodeMirror)에 포커스한 채 AI 스타일링을 실행하면, AI가 넣은 값이 store·DOM엔 반영되지만 에디터 doc은 옛 상태로 남고, 사용자가 이어서 한 글자라도 치면 AI가 넣은 inlineStyle이 흔적 없이 사라졌다.
- **근본 원인**: 표면(AI 편집 손실)과 원인(포커스 가드로 인한 store↔doc divergence)이 다른 레이어. `StyleCssView`는 타이핑 커서 튐·늦은 cross-origin specified 보강을 막으려고 **포커스 중엔 외부 재동기화(doc 통째 교체)를 스킵**한다. AI 응답이 `setStyleEdits`로 store를 갱신할 때 마침 포커스면 이 가드에 걸려 doc이 stale해지고, 이후 `handleChange`가 stale doc 기준으로 override를 재계산해 store를 덮어쓴다. **함정 포인트**: read-only 잠금만으론 못 막는다 — `AiStylingDialog`가 `setStyleEdits(merged)`(응답 적용)를 `setAiStylingLoading(false)`보다 **먼저** 호출하므로, 로딩이 풀리는 순간 doc은 이미 stale 확정. 로딩 해제 전이 시점에 포커스 무관 강행 재동기화가 있어야 store가 진실의 원천으로 회복된다.
- **재발 방지**: (1) **store↔로컬 파생 상태(에디터 doc 등)를 포커스/편집 가드로 스킵하는 곳에선, 외부 프로그램적 변경(AI·자동 적용)이 그 가드를 뚫는 예외 경로가 있는지 확인** — 사용자 편집 충돌 방지 가드가 프로그램적 write까지 막으면 조용한 손실이 된다. `StyleCssView`의 `shouldResyncDoc({focused, aiApplied})`가 선례(평시 포커스 스킵 + AI 적용 시 강행). (2) grep: `grep -rn "focusedRef\|focused.*current" src/sidepanel` — 포커스 가드가 store 재동기화를 막는 지점에 프로그램적 변경 예외가 있는지 점검. (3) **적용(setState)과 로딩 플래그 해제의 순서에 의존하지 말 것** — 적용이 먼저면 "로딩 중 read-only"는 이미 늦다. 상태 전이(true→false) 자체를 트리거로 삼아 만회한다. (4) 이 로직은 순수함수(`docSync.ts`)로 뽑아 `docSync.test.ts`에서 `focused=true, aiApplied=true → true` 조합이 회귀 감지 지점 — 컴포넌트 통합은 인프라 부재로 스킵.
- **관련**: `src/sidepanel/tabs/styleEditor/docSync.ts`(`shouldResyncDoc`), `StyleCssView.tsx`(`prevAiLoadingRef` + 재동기화 effect), `AiStylingDialog.tsx`(`setStyleEdits`→`setAiStylingLoading(false)` 순서), `docSync.test.ts`.

---

## 2026-07-05 — e2e 전 스위트가 "시작도 안 됨"으로 hang — Playwright `worker.evaluate`가 crxjs 모듈 SW에서 무한 대기

- **영역**: `e2e`
- **계열**: `라이브러리전제`
- **그물**: `e2e`
- **증상**: 어느 순간부터 `pnpm test:e2e`가 첫 테스트에서 멈춰 스위트가 통째로 진행 안 됨("시작도 안 됨"). 브라우저는 뜨는데 안 보이던 **크롬 번역 버블**까지 관측돼 "환경이 바뀌었다"는 오해를 부름. 코드 diff는 무관(직전 green 이후 guide 이미지 1개뿐).
- **근본 원인**: 표면(스위트 hang·번역 버블)과 원인이 다른 레이어. crxjs가 서비스워커를 `type:module`(`service-worker-loader.js`가 real 청크를 `import`)로 emit하는데, **Playwright `worker.evaluate`가 이 모듈 SW의 실행 컨텍스트를 못 잡아 무한 대기**한다. fixture(`fixtureTabId`)와 여러 spec이 `sw.evaluate`에 의존하고 `workers:1`이라 **첫 `sw.evaluate` 한 번이 전 스위트를 정지**시킴. SW 자체는 정상(로드 예외 0, `chrome` 바인딩 OK) — 순전히 Playwright 한계. 오진 유발 요소: node 버전(22·25·26 전부 동일 실패), chromium 버전, 번역 UI는 **전부 무관**. 그리고 **Playwright `CDPSession.send(method, params)`는 3번째 sessionId 인자를 조용히 무시**해서, raw CDP로 SW 타깃에 붙어 우회하려던 시도가 전부 앵커 페이지 컨텍스트에서 돌아(`chrome` undefined) 삽질을 길게 만듦.
- **재발 방지**: (1) **e2e에서 `chrome.*`는 SW가 아니라 확장 페이지에서 평가** — fixture `ext.evalInExt(fn, arg)`(빈 특권 확장 페이지 `e2e-eval.html`, `vite.config.ts`의 `e2eEvalHostPlugin`이 `dist-e2e`에만 emit). `grep -rn "serviceWorkers()\|\.evaluate" e2e | grep -i worker` 로 `worker.evaluate` 신규 유입 감시 — 모듈 SW에선 반드시 hang한다. (2) **`worker.evaluate`가 hang하면 node/chromium/브라우저 UI를 의심하지 말 것** — crxjs=type:module SW가 원인. `dist-e2e/manifest.json`의 `background.type==="module"` + `service-worker-loader.js`가 `import`만 하는 셔틀인지 확인. (3) **Playwright `CDPSession.send`에 sessionId 3번째 인자는 안 먹는다** — flatten 자식 세션(SW 등) 라우팅을 이걸로 시도 말 것(앵커 페이지에서 돌아 조용히 오답). (4) 진단 중 `brew install node@22`가 simdutf를 올려 시스템 node를 dyld로 깨뜨린 전례 — **버전 가설 검증하겠다고 brew로 형제 node 깔지 말 것**(공유 의존 churn), 필요하면 격리된 바이너리를 쓴다.
- **관련**: `e2e/fixtures/extension.ts`(`evalInExt`·`getEvalHost`·`fixtureTabId`), `vite.config.ts`(`e2eEvalHostPlugin`), 마이그레이션 spec `unsupported-url`·`activetab-broad-permission`·`recording-annotation`, `e2e/GOTCHAS.md` 최상단 항목.

---

## 2026-07-04 — Radix Tabs 정렬 편집기 "재클릭 해제" 구현이 정상 설정까지 지움 (pointerdown에서 값 변경 → click은 리렌더 후 발화)

- **영역**: `컴포넌트`
- **계열**: `라이브러리전제`
- **그물**: `e2e`
- **증상**: element 스타일 편집기의 AlignmentProp(text-align 등)에서 비활성 정렬 탭(center)을 한 번 눌렀는데, 적용됐다가 **즉시 지워져** 기본값(start)으로 남았다. `pnpm test`(2645개)·자체 검증 에이전트의 순수 로직 리뷰는 전부 통과 — **e2e(`style-changes-stacked`)만** 잡아냈다.
- **근본 원인**: 표면(정렬이 안 먹음)과 원인(이벤트 순서/리렌더 타이밍)이 다른 레이어. Radix Tabs는 **pointerdown**(포커스→automatic activation)에서 값을 바꾸고, **활성 탭 재클릭 시엔 `onValueChange`를 안 쏜다**. toggle-off(재클릭 해제)를 `onClick`에서 `value && o.v === resolvedValue`로 판정했는데, click은 pointerdown→store set→**리렌더 후** 발화한다. 그래서 비활성 center를 누르면: pointerdown이 center로 set → resolvedValue가 "center"로 리렌더 → click 핸들러의 클로저가 갱신된 상태를 보고 "활성 탭을 다시 눌렀다"고 오판 → `set("")`로 clear. 정상 설정과 toggle-off가 click 시점 상태로는 구분 불가능했던 게 함정. 순수 함수가 아니라 **DOM 이벤트 순서에 의존**하는 로직이라 단위/코드리뷰가 못 잡고 실제 클릭을 구동하는 e2e만 재현.
- **재발 방지**: (1) **controlled Radix(Tabs/Toggle/RadioGroup 등)의 클릭 판정을 렌더 상태로 하지 말 것** — 컴포넌트가 pointerdown/focus에서 값을 먼저 바꾸므로 `onClick` 클로저의 값은 이미 갱신된 뒤다. 클릭 직전 상태가 필요하면 **`onPointerDownCapture`(캡처 페이즈, 라이브러리 핸들러보다 먼저)로 ref에 스냅샷**하고 `onClick`에서 그 ref를 읽는다(AlignmentProp가 선례). (2) grep: `grep -rn "onValueChange\|onPressedChange" src/sidepanel/tabs/styleEditor` — 재클릭/토글 판정을 하는 곳이 렌더 상태(`resolvedValue`/`value`)를 직접 비교하면 냄새. (3) **정렬·토글류 인터랙션은 순수 단위 테스트로 못 막는다** — 상태 전이가 라이브러리 이벤트 순서에 걸리므로 `/tdd` 분류상 컴포넌트=스킵이 맞고, **e2e(실제 `.click()`)가 유일한 안전망**. 이런 인터랙션 수정 후엔 e2e 재실행 필수. (4) `setAlignment` 헬퍼를 쓰는 `style-changes-stacked`가 회귀 감지 지점.
- **관련**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx`(`AlignmentProp` — `preClick` ref + `onPointerDownCapture`), e2e `style-changes-stacked.spec.ts:96`(`setAlignment`), 커밋 `92204ea`.

---

## 2026-07-03 — GitHub Pages 배포가 몇 시간째 실패 (build job은 성공, deploy job만 실패 = GitHub 백엔드 stuck, 코드 무관)

- **영역**: `툴체인`
- **그물**: `없음`
- **증상**: `/deploy`(tag push + #125 main 머지) 후 privacy.md 공개용 GitHub Pages가 `Deployment failed, try again later`로 **몇 시간 반복 실패**. 워크플로우 재실행·강제 빌드해도 계속 빨강.
- **근본 원인**: 우리 코드/docs 무관. `pages-build-deployment` 워크플로우에서 **build job은 매번 success(Jekyll 빌드·아티팩트 정상 생성)**, `actions/deploy-pages`의 **deploy job만** "Getting Pages deployment status…"에서 즉시 실패. 배포 자체는 생성되는데(`Created deployment`) 상태 조회에서 서버가 실패 반환 → **GitHub Pages 배포 백엔드가 이 repo에 대해 stuck**. 전역 status는 green, github-pages 환경 branch policy(main)도 허용, docs Jekyll도 통과 — 전부 정상인데 배포 파이프라인만 잠김. "빌드 실패"로 보이지만 실제론 빌드 성공 후 배포단 단독 실패라 원인 레이어가 표면과 다르다.
- **재발 방지**: (1) **진단은 build job vs deploy job 분리부터**: `gh run view <id> --json jobs --jq '.jobs[]|"\(.name):\(.conclusion)"'`. **build=success & deploy=failure면 GitHub 백엔드 문제(코드 아님)** — `docs/` 콘텐츠 뒤지느라 시간 낭비 말 것. 우리 콘텐츠 문제는 build 단계 실패여야 성립. (2) **긴급도 체크**: 새 배포가 실패해도 **직전 성공본은 계속 서빙**된다. `curl -sS -o /dev/null -w "%{http_code}\n" https://sinhyeokkang.github.io/bugshot-2/privacy.html`가 200이면 사이트 살아있음 → 안 올라간 건 최신 편집분뿐이라 급하지 않음. (3) **효과 없던 조치**(백엔드 stuck엔 무력): 워크플로우 재실행, `gh api -X POST .../pages/builds`(강제 빌드), `gh api -X PUT .../pages`(source 재저장). (4) **먹힌 조치 = Pages 완전 삭제 후 재생성**: `gh api -X DELETE repos/<o>/<r>/pages` → `gh api -X POST repos/<o>/<r>/pages -f 'source[branch]=main' -f 'source[path]=/docs'`. 파이프라인을 통째 teardown/rebuild해 stuck 해소(이번에 deploy job success로 복구). 단 재생성 사이 **잠깐 404 위험** — privacy는 스토어 심사 제출 URL이라, 200으로 서빙 중이면 급하지 않은 한 강행 전 재고.
- **관련**: 인프라(코드 파일 없음) — GitHub Pages 설정(source `main` `/docs`, build_type `legacy` Jekyll), `docs/` 콘텐츠, `/deploy` 스킬의 Pages 배포 단계.

---

## 2026-07-03 — 로그 색이 탭/다이얼로그와 마커 툴팁에서 발산 (같은 로그를 두 독립 렌더 경로가 그림 — 값+패턴 둘 다 어긋남)

- **영역**: `디자인`
- **계열**: `복제본`
- **그물**: `unit`
- **증상**: 로그뷰어 타임라인 마커에 hover하면 뜨는 툴팁의 문구 색이 좌/하단 로그 탭·다이얼로그와 미묘하게 달랐다. (1) **다크모드에서** 툴팁의 레벨/메서드 색이 탭보다 어두웠다(탭은 밝은 `-400`, 툴팁은 `-600` 고정). (2) action **navigation**은 탭이 URL만 파랑인데 툴팁은 **문장 전체가 파랑**이었다.
- **근본 원인**: "같은 로그"를 **완전히 분리된 두 렌더 경로**가 그린다 — 사이드패널 `{Console,Network,Action}LogContent.tsx`(React, 아이콘·`InlineLink`·`renderVerb`)와 로그뷰어 `markers.ts`(plain `labelParts`의 text+className, 별도 Vite 빌드). 공유 색 소스가 없어 두 축이 독립적으로 어긋났다. **값 축**: 탭은 `text-*-600 dark:text-*-400` 쌍, 툴팁은 `dark:` 없이 `-600`만 → 다크에서 발산. **패턴 축**(어느 토큰을 칠하나): 탭은 `renderVerb`+`splitTemplate`로 `{target}` 슬롯(URL)만 `InlineLink` 처리, 툴팁은 `label` 문장 전체에 `text-blue-600`를 통짜로 입힘 → navigation 과채색. 값만 통일하면 패턴은 여전히 어긋나는 **2층 구조**가 함정.
- **재발 방지**: (1) **로그 텍스트 색은 두 표면을 항상 함께 고친다** — `src/sidepanel/components/{Console,Network,Action}LogContent.tsx`와 `src/log-viewer/markers.ts`. 한쪽만 바꾸면 발산. markers는 별도 빌드라 잊기 쉬운 게 이 함정의 뿌리. (2) **값은 반드시 `src/lib/log-colors.ts` 경유**(`TONE_TEXT`/`consoleLevelTextClass`/`networkMethodTextClass`). `grep -rnE "text-(red|amber|blue|green)-600" src/sidepanel/components/*LogContent.tsx src/log-viewer/markers.ts`로 우회 인라인 색을 잡는다 — 로그 표면의 인라인 색은 냄새. (3) **패턴은 슬롯 헬퍼를 공유**: 툴팁 `labelParts`가 탭 `renderVerb`의 슬롯 채색과 일치하도록 markers.ts도 `splitTemplate`를 재사용한다(navigation이 그 선례). 새 action verb에 색 구간을 추가하면 두 경로 모두 갱신. (4) **다크 전용 발산은 라이트/일반 테스트에 안 잡힌다** — 로그 UI 색을 건드리면 **다크모드에서 툴팁 vs 탭을 눈으로** 대조. (5) 단위 `markers.test.ts > labelParts: navigation`(URL 조각만 `TONE_TEXT.blue`, verb 텍스트 무색).
- **관련**: 단일 출처 `src/lib/log-colors.ts`(`TONE_TEXT`·`CONSOLE_LEVEL_TONE`·`NETWORK_METHOD_TONE`), 소비처 `src/log-viewer/markers.ts`(툴팁 labelParts + navigation `splitTemplate` 재사용)·`src/sidepanel/components/{Console,Network,Action}LogContent.tsx`(아이콘/메서드 색), 툴팁 컨테이너 `src/log-viewer/components/TimelineMarkers.tsx`.

---

## 2026-07-01 — 30s replay 트림 진입 시 흰 화면 (두 lazy 청크 동시 첫 마운트 → tiptap storage 레이스)

- **영역**: `에디터`
- **계열**: `라이브러리전제`
- **그물**: `수동`
- **증상**: 30s replay 캡처 직후 트림 오버레이가 떠야 하는데 **사이드패널 전체가 흰 화면**. 콘솔에 `Cannot read properties of undefined (reading 'getMarkdown')`. element·스크린샷·일반 녹화 모드는 멀쩡하고 **오직 30s replay만** 깨짐.
- **근본 원인**: 표면(getMarkdown of undefined)과 원인(컴포넌트 마운트 레이스)이 다른 레이어. 30s replay만 캡처 직후 `phase=drafting`(DraftingPanel→`LazyTiptapEditor`)과 `pendingTrim`(`ReplayTrimDialog`)을 **같은 커밋에 set**해서, 두 `lazy()` 청크가 같은 Suspense 사이클에서 동시 첫 로드된다. 그 레이스 중 tiptap editor 인스턴스는 살아있는데 `editor.storage.markdown`이 아직 없는(초기화 미완/stale) 순간이 생기고, value-sync useEffect의 `editorMarkdown`이 `storage.markdown.getMarkdown()`을 호출 → throw → 에러 바운더리가 없어 **App 트리 전체 unmount**. 다른 모드는 DraftingPanel만(overlay 없음) 마운트라 동시 로드가 안 일어나 무사. replay-trim(원본)은 ReplayTrimDialog가 가벼웠는데 refactor로 LogContent 3개를 정적 import해 청크가 무거워지며 이 레이스를 깨움.
- **재발 방지**: (1) **lazy 컴포넌트 두 개가 같은 트리에 동시 첫 마운트되는 구조를 피한다** — 한쪽이 모달/오버레이로 다른 쪽을 덮으면, 덮이는 쪽은 아예 마운트하지 않는다(트림 대기 중 IssueTab이 DraftingPanel을 마운트 안 함, `ReplayContext.trimming` 플래그). `grep -rn "lazy(" src/sidepanel`로 동시 마운트 후보를 점검. **덮는 쪽과 덮이는 쪽이 반드시 같은 값에서 파생돼야 한다** — 게이트를 둘로 나누면 해제 순간 둘 다 뜬다(2026-07-17에서 store `replayTrim` 단일 값으로 합침). (2) **외부 라이브러리 storage 접근 전 존재 가드** — `editor.storage.markdown` 같은 비동기 초기화 storage는 throw 대신 빈 값 반환(`editorMarkdown`가 안전망). `grep -rn "\.storage\." src/sidepanel/components/TiptapEditor.tsx`. (3) **이 증상이 e2e capture flaky(captureVisibleTab cold-start)에 가려져 한참 "환경 문제"로 오판**했다 — 캡처 의존 e2e가 빨갛다고 환경 탓만 하지 말고, **실제 빌드+Chrome 수동 재현**으로 src 회귀를 분리한다. "특정 모드만 깨짐"(여기선 replay만)이 src 인과의 결정적 단서. (4) 단위 `TiptapEditor.test.ts > editorMarkdown`(storage 없으면 "" 반환).
- **관련**: `src/sidepanel/tabs/IssueTab.tsx`(trimming 가드), `src/sidepanel/30s-replay/replay-context.ts`(`trimming` 플래그)·`src/sidepanel/App.tsx`(`replayTrim != null` 전달 + 같은 값으로 오버레이 게이팅), 안전망 `src/sidepanel/components/TiptapEditor.tsx:editorMarkdown`, 전이 지점 `src/store/editor-store.ts:onRecordingComplete`(`phase`·`replayTrim`을 같은 set에 — 당시엔 `use-30s-replay`가 `onRecordingComplete` + `setPendingTrim`으로 나눠 불렀고 그 레인 분리가 2026-07-17을 낳았다).

---

## 2026-06-30 — Slack 승격 미디어 가드를 7개 트래커로 확장 (업로드 모델이 달라 균일 복제 불가 — 가능한 곳만 가드, 불가한 곳은 명시)

- **영역**: `어댑터`
- **계열**: `복제본`
- **그물**: `unit`
- **증상**: GitHub 단독 픽스(아래 항목)의 `requireMediaUpload` 가드가 **GitHub 핸들러에만** 있었다. Slack 보존 이슈를 GitHub *외* 트래커로 승격하면 동일한 미디어 업로드 부분 실패에서 여전히 `markSubmitted`가 원본을 비가역 파괴한다(아래 항목 재발방지 (3)이 경고했던 미수정 갭).
- **근본 원인**: 7개 어댑터의 업로드 모델이 제각각이라 GitHub 패턴을 그대로 복제할 수 없다. **업로드→생성 + soft-fail(href/url:null)** 인 GitHub·GitLab만 "생성 전 누락 감지 후 throw" 가드가 성립한다. 나머지는 (a) **Linear**: 미디어를 생성 전 업로드하되 실패 시 **throw**(soft-fail 맵 없음) → 가드 효과가 이미 내재, (b) **Notion**: 이미지·비디오는 생성 전 strict throw라 안전하고 **사용자 첨부(category `other`)만 soft-fail** 갭, (c) **ClickUp·Asana**: **생성→업로드 역순**(첨부에 task id/parent gid 필요)이라 업로드 실패를 안 시점엔 task가 이미 존재 → 사전 throw 가드 **구조적 불가**, (d) **Jira**: 업로드+생성이 **단일 atomic 호출**이라 프론트가 첨부 부분 실패를 신호받지 못함. "전 플랫폼에 같은 한 줄"이라는 직관이 어긋나는 지점.
- **재발 방지**: (1) **가능한 곳만 가드, 불가한 곳은 코드 주석 + 이 문서로 명시**한다(은폐 금지). 추가분: **GitLab** = GitHub 가드 직접 복제(`someUploadMissing` 재사용, `href`→`url`), **Notion** = 승격 시 `other` 첨부도 strict throw(`requireMediaUpload && category==="other"`). (2) **소실 위험이 남은 트래커**: ClickUp·Asana(생성→업로드)·Jira(atomic). 보호하려면 *사전 upload-probe* 또는 *생성 task 롤백* 또는 *background 핸들러가 첨부 실패를 반환*하도록 프로토콜 변경이 필요 — 단순 가드로 안 됨. 새 작업 전 `grep -n "승격 가드" src/sidepanel/tabs/DraftDetailDialog.tsx`로 현 상태 확인. (3) **새 트래커 어댑터를 추가할 때** 그 업로드 모델이 위 (a)~(d) 중 무엇인지 먼저 분류하고, 승격 가드 가능 여부를 `markSubmitted` 옆 주석에 박는다. (4) 단위 `submitToGitlab.test.ts`/`submitToNotion.test.ts > requireMediaUpload`(미디어/첨부 실패 → submit 0회, 로그 실패는 best-effort).
- **관련**: `src/sidepanel/lib/submitToGitlab.ts`·`submitToNotion.ts`(가드 추가), `src/sidepanel/lib/submitToGithub.ts:someUploadMissing`(재사용), 소비처 `src/sidepanel/tabs/DraftDetailDialog.tsx`(handleGitlab/Notion 가드 + Jira/Linear/Asana/ClickUp 주석), i18n `gitlab.error.mediaUploadFailed`.

---

## 2026-06-30 — Slack 이슈 GitHub 승격 실패 시 원본까지 소실 (업로드 soft-fail이 실패로 안 잡혀 비가역 파괴 진행)

- **영역**: `어댑터`
- **계열**: `fail-open`
- **그물**: `unit`
- **증상**: Slack으로 제출한 이슈를 GitHub로 승격 시도 → GitHub 인증 문제로 실패했는데, 실패 후 원본 **Slack 보존 이슈까지 목록에서 사라짐**(복구 불가).
- **근본 원인**: 승격이 **원자적이지 않다**. `submitToGithub`은 2단계(`github.uploadFiles`→`github.submitIssue`)이고, 성공 resolve 시 `markSubmitted`→`stripSubmitted`가 `slackPreserved`·draft·snapshot·blob을 **전부 파괴**한다(되돌릴 수 없음). 그런데 파일 업로드 `uploadGithubFiles`는 **모든 실패 경로**(github.com 쿠키 세션 401·403, S3 에러, 탭 없음, injection 실패)를 throw가 아니라 `href: null`로 **soft-fail 반환**하고, `submitToGithub`은 `logsDropped`만 계산하고 그대로 `submitIssue`로 진행했다. 그래서 **OAuth 토큰은 살아있고(=submitIssue 성공) github.com 쿠키 세션만 죽은** 부분 실패에서, 깨진 이미지 링크의 GitHub 이슈가 생성되며 `markSubmitted`가 돌아 원본을 폐기했다. 표면("실패 후 소실")과 원인("업로드 soft-fail이 실패로 취급 안 됨 + 비가역 파괴가 업로드 성공과 무관")이 다른 레이어. 역설적으로 **OAuth 토큰 자체가 죽으면** `loadGithubAuth`가 업로드 *전에* throw해 오히려 안전 — 쿠키 세션만 죽는 부분 실패가 유일한 소실 경로라 재현이 까다로웠다.
- **재발 방지**: (1) **원본을 비가역 파괴하는 흐름(markSubmitted의 slackPreserved 폐기·blob 삭제)은 미디어 업로드 성공을 확인한 뒤에만** 진행한다 — `submitToGithub({requireMediaUpload})`가 미디어(로그 제외) href 누락 시 `submitIssue` 전에 throw해 markSubmitted 미도달·원본 보존. 승격(`isSlackPreserved`)일 때만 엄격, 일반 제출은 best-effort 유지. (2) **`uploadGithubFiles`는 절대 throw하지 않는 계약**임을 기억 — `grep -n "href: null" src/background/github-upload.ts`로 모든 실패가 soft-fail임을 확인. 호출부가 null href를 실패로 *해석*해야 하며, sendBg가 throw해 주리라 가정하면 안 된다. (3) 새 플랫폼 승격/비가역 제출을 추가할 때 `await submitToXxx` 다음 줄에서 `markSubmitted`를 부르기 전에, 그 submit이 **업로드 부분 실패를 어떻게 신호하는지**(throw인지 silent인지) 확인 — `grep -rn "markSubmitted" src/sidepanel/tabs/DraftDetailDialog.tsx`. (4) e2e `slack-promote-media-guard.spec`(미디어 업로드 실패 → submitIssue 0회·원본 불변) + 단위 `submitToGithub.test.ts > requireMediaUpload`.
- **관련**: `src/sidepanel/lib/submitToGithub.ts`(`someUploadMissing`·`requireMediaUpload` 가드), 절대 throw 안 하는 `src/background/github-upload.ts:uploadGithubFiles`, 소비처 `src/sidepanel/tabs/DraftDetailDialog.tsx:handleGithubSubmit`, 비가역 파괴 `src/store/issues-store.ts:stripSubmitted`/`markSubmitted`.

---

## 2026-06-30 — Slack 채널·멘션 직전값 미기억 (7개 어댑터 중 Slack만 prefill 우선순위 역전)

- **영역**: `어댑터`
- **계열**: `복제본`
- **그물**: `unit`
- **증상**: Slack 이슈를 제출할 때 직전에 고른 채널·멘션이 기본값으로 안 떴다. 통합 설정에 "기본 채널"을 지정해 둔 경우 그 기본 채널만 뜨고, 직전에 쓴 채널과 멘션은 매번 사라짐.
- **근본 원인**: `initialSlackFields`가 `defaults?.channelId ?? last?.channelId`로 **사용자 지정 기본 채널을 직전 제출 채널보다 우선**했다. 기본 채널이 한 번 설정되면 직전 채널이 영구히 가려지고, 멘션 복원이 `sameChannel`(last.channelId === 해석된 channelId) 게이트에 묶여 있어 기본 채널 ≠ 직전 채널이면 **멘션까지 드롭**된다. GitHub·Linear·Notion·GitLab은 동일 위상 필드(repo/team/database/project = 제출 목적지)에서 전부 **last 우선**(`last?.x ?? defaults` 또는 `last?.x ? last : defaults`)인데 Slack의 channel만 역전돼 있었다. 7개 플랫폼의 `initial*Fields`가 "제출 목적지 필드는 last 우선"이라는 같은 규칙을 공유해야 하는데 하나만 어긋난 케이스. (Asana/ClickUp이 `defaults` 우선인 건 그게 **workspace = 가장 거친 스코프**라 의도적이고, 하위 project/assignee는 `sameWs ? last : defaults`로 여전히 last를 반영 — Slack의 channel은 거친 스코프가 아니라 제출 목적지 자체라 repo/team에 대응.)
- **재발 방지**: (1) **새 플랫폼 IssueFields의 `initial*Fields`는 주 제출 목적지 필드를 last 우선**으로 박는다(`defaults`는 last가 없을 때 fallback). `grep -rn "defaults?\." src/sidepanel/tabs/*Fields/*.tsx` 또는 `grep -rln "initial.*Fields" src`로 7개 어댑터의 우선순위 일관성을 전수 대조 — `defaults?.x ?? last` 패턴이 **제출 목적지 필드**에 보이면 역전 의심. (2) Asana/ClickUp의 `defaults` 우선은 **workspace(거친 스코프) 한정** 예외임을 기억 — channel/repo/team/project/database 같은 목적지 필드는 last 우선이 규칙. (3) 단위 `SlackIssueFields.test.ts`(기본≠직전일 때 last 우선·멘션 복원) + e2e `slack-submit-gating.spec`(채널/멘션 복원).
- **관련**: `src/sidepanel/tabs/slackFields/SlackIssueFields.tsx:initialSlackFields`, 대조군(last 우선) `GithubIssueFields`/`LinearIssueFields`/`NotionIssueFields`/`GitlabIssueFields`, 소비 `src/sidepanel/hooks/usePlatformFields.ts`.

---

## 2026-06-29 — captureVisibleTab 쿼터 초과로 스냅샷 실패 (캡처 호출처 N개가 직렬화 큐 없이 경쟁)

- **영역**: `background`, `미디어`
- **그물**: `unit`
- **증상**: 30s 리플레이가 켜진 상태에서 엘리먼트 스냅샷·스타일 before/after를 찍으면 `BgError: This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.` → 콘솔에 `[bugshot] snapshot failed`, 스냅샷 null 반환.
- **근본 원인**: Chrome `chrome.tabs.captureVisibleTab`는 **윈도우 단위로 초당 2회**(`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`) 제한인데, 캡처를 쏘는 경로가 4개(30s 리플레이 폴링 600ms·`use-30s-replay.ts`, 엘리먼트 스냅샷·`capture.ts`, 스타일 next after·`StyleEditorPanel`, element 전환 buffer·`useBufferThenSwitch`)고 전부 background `captureVisibleTab` 핸들러를 **직렬화·간격 제어 없이** 그대로 호출했다. 리플레이 폴링 단독으로도 한계 근처(~1.67회/초)라, 사용자 액션 캡처가 같은 1초 창에 끼면 초과. 표면("스냅샷 1건 실패")과 원인(**전역 캡처 호출 빈도가 쿼터를 넘음** — 한 호출처가 아니라 경합)이 다른 레이어. 리플레이 tick은 에러를 `catch {}`로 삼켜 증상이 사용자 액션 경로에서만 드러났다.
- **재발 방지**: (1) **captureVisibleTab은 반드시 한 큐로 직렬화 + 최소 간격**을 거친다 — background 핸들러가 `captureThrottle.run()` 경유(`src/background/capture-throttle.ts`). 새 캡처 경로를 추가할 때 background 핸들러를 우회해 `chrome.tabs.captureVisibleTab`을 직접 부르면 다시 깨진다. `grep -rn "captureVisibleTab" src/` 결과는 **호출처(sendBg type 발신)만** 늘어야 하고 실제 API 호출은 `messages.ts` 1곳·`capture-throttle` 경유로 유지. (2) **rate-limit은 정상 동작 — 재시도로 흡수**한다(`isCaptureRateLimitError` 매칭 시만 백오프, 그 외 에러는 즉시 throw해 탭 닫힘 등을 무한 재시도하지 않음). (3) 단위 테스트(`capture-throttle.test.ts`)로 직렬화·최소 간격·재시도·실패 격리 고정.
- **관련**: `src/background/capture-throttle.ts`(`createCaptureThrottle`·`captureThrottle`·`isCaptureRateLimitError`), 소비처 `src/background/messages.ts:captureVisibleTab` 핸들러, 테스트 `src/background/__tests__/capture-throttle.test.ts`.

---

## 2026-06-29 — 스타일 패널 Transition 섹션이 트랜지션 없어도 항상 펼침 (computed longhand 유령 기본값)

- **영역**: `스타일해석`
- **계열**: `라이브러리전제`
- **그물**: `unit`
- **증상**: 스타일 에디터에서 섹션 초기 펼침 조건을 손본 뒤, Transition 섹션만 어떤 요소를 골라도 **항상 펼쳐진** 상태로 떴다. 실제로 transition이 걸린 요소가 아닌데도 "값 있음"으로 취급.
- **근본 원인**: `sectionDefaultOpen`은 specified에 키가 없으면 computed 값이 `isKnownDefault`인지로 펼침을 판단한다. 그런데 `getComputedStyle`은 **트랜지션이 전혀 없는 요소에도 transition-* longhand 4개를 항상 채워** 돌려준다(`transition-property: all`, `transition-duration: 0s`, `transition-timing-function: ease`, `transition-delay: 0s`). 이 4개가 `KNOWN_DEFAULTS`(propMetadata.ts)에 빠져 있어 `isKnownDefault`가 `false`(테이블에 prop 없음 → 기본값 아님) → 늘 "값 있음" → 항상 펼침. 표면("섹션 펼침 로직 버그")과 원인(특정 longhand 그룹의 computed 기본값 미등록)이 다른 레이어다. **getComputedStyle이 longhand로 항상 채우는 단축 프롭(transition·animation·background·font·grid 등)은 전부 같은 함정** — shorthand 섹션을 추가할 때마다 재발한다.
- **재발 방지**: (1) **새 스타일 섹션을 `SECTION_PROPS`에 추가하면 그 prop들의 computed 기본값을 `KNOWN_DEFAULTS`에 동시 등록**한다 — 안 하면 그 섹션은 무조건 펼침. `grep -n "transition\|animation\|background-\|grid-" src/sidepanel/tabs/styleEditor/propMetadata.ts`로 longhand 그룹 커버리지 확인. (2) **전수 체크**: `SECTION_PROPS`(StyleEditorPanel.tsx)의 모든 prop이 `KNOWN_DEFAULTS` 또는 `isInactiveBorderColor` 같은 별도 가드로 "기본값 판정"이 가능한지 — getComputedStyle은 거의 모든 prop을 빈값 아닌 resolve값으로 돌려주므로, KNOWN_DEFAULTS에 없으면 그 prop은 항상 활성으로 샌다. (3) 단위 테스트(`propMetadata.test.ts`)로 computed 기본값 → `isKnownDefault` true, 실제 값 → false를 섹션별로 고정.
- **관련**: `src/sidepanel/tabs/styleEditor/propMetadata.ts:KNOWN_DEFAULTS`(transition longhand 4개 추가), 판정 `isKnownDefault`, 소비처 `src/sidepanel/lib/sectionDefaultOpen.ts:sectionDefaultOpen`(StyleEditorPanel.tsx `sectionOpen`이 호출), 테스트 `styleEditor/__tests__/propMetadata.test.ts`.

---

## 2026-06-28 — 내보낸 로그 뷰어 라벨이 i18n 키 raw 노출 + 검색 placeholder stale (복제 dict 미동기화)

- **영역**: `i18n`
- **계열**: `복제본`
- **그물**: `unit`
- **증상**: 다운로드한 `logs.html`(로그 뷰어)에서 액션 로그 필터가 번역 대신 `actionLog.filter.keypress`처럼 **키 문자열 그대로** 노출. 네트워크 탭 검색 placeholder도 "URL 검색…"이라 본문(body)까지 검색되는 걸 안내 못 함.
- **근본 원인**: log-viewer는 사이드패널과 **별도 standalone 번들**(`dist-log-viewer`, 빌드 시 사이드패널에 inline)이라 메인 React i18n 시스템을 import 못 하고 `src/log-viewer/i18n.ts`에 ko/en dict를 **수작업 복제**한다. 메인 테이블(`src/i18n/namespaces/logs.ts`)에 키가 추가(`actionLog.filter.keypress/toggle/select`)되거나 문구가 갱신(`networkLog.search`에 "·본문" 추가)될 때 복제본이 안 따라온 게 근본. 두 실패 모드가 다른 얼굴을 한다: (1) **누락** = 복제 dict에 키 자체가 없어 `t()`가 키 문자열로 폴백 → raw 노출. (2) **drift** = 키는 있는데 값이 옛 문구 → 조용히 stale. 기존 log-viewer 테스트의 ko/en 대칭 검사는 **양쪽 dict에 동시에 빠지면** 대칭이 유지돼 누락을 못 걸렀다(대칭 ≠ 완전성).
- **재발 방지**: (1) **복제 dict의 회귀는 ko/en 대칭으론 안 잡힌다 — 메인 테이블을 source of truth로 대조**해야 한다. 추가한 두 검사(`log-viewer/__tests__/i18n.test.ts`): 코드가 `t("리터럴")`로 참조하는 키 전부가 dict에 존재(누락 차단) + 메인과 공통 키는 값도 일치(drift 차단). (2) **메인 i18n 키·문구를 바꾸면 log-viewer dict도 본다** — `grep -nE '"(actionLog|networkLog|consoleLog|debug)\.' src/log-viewer/i18n.ts`로 복제 범위 확인. (3) **이미 내보낸 `logs.html`은 빌드 시점 i18n이 박혀 소급 수정 안 됨** — `pnpm build:log-viewer` 후 재내보내기 필요(고쳐도 옛 파일은 그대로). (4) 같은 "standalone 번들이 메인 모듈을 복제" 함정 류: recorder pre-arm 청크(외부 static import 0 제약, `content/log-throttle.ts` vs `sidepanel/lib/trailing-throttle.ts` 복제)도 동일 구조 — **복제본은 늘 대조 테스트로 묶는다.**
- **관련**: `src/log-viewer/i18n.ts`(복제 dict — `koDict`/`enDict`), 정본 `src/i18n/namespaces/logs.ts:logs`, 회귀 검사 `src/log-viewer/__tests__/i18n.test.ts`(`referencedKeys` 코드 스캔 + 메인 테이블 drift 대조).

---

## 2026-06-28 — 사이드패널 탭 녹화가 cross-origin 이동 후 권한 에러 (activeTab은 패널에선 재취득 불가)

- **영역**: `미디어`, `background`
- **계열**: `cross-origin`
- **그물**: `수동`
- **증상**: A origin에서 사이드패널을 연 뒤 B origin으로 이동하고 탭 녹화를 누르면 `getMediaStreamId`가 "extension has not been invoked"로 거부됐다. `host_permissions: <all_urls>`를 required로 갖고 있는데도 막혀서 "광역 권한 있는데 왜?"
- **근본 원인**: 두 겹의 비자명 함정. (1) **`<all_urls>`는 `tabCapture`를 커버하지 못한다** — `captureVisibleTab`은 `<all_urls> OR activeTab`이라 30s Replay가 광역 권한으로 우회됐지만, `tabCapture.getMediaStreamId`는 host permission으로 대체 불가하고 **"현재 페이지에서 확장이 invoke됨"(activeTab) 상태가 필수**다(Chrome이 `<all_urls`로 tabCapture 허용하는 옵션을 의도적으로 거부). (2) **사이드패널 열기는 activeTab을 부여하지 않는다** — Chrome 공식 입장("패널 열기는 충분한 user intent가 아님", 변경 계획 없음). 그래서 패널을 연 invoke(아이콘 클릭/단축키)의 activeTab은 그 origin에만 유효하고, cross-origin 이동 시 회수된다. 패널 내부 버튼 클릭은 invoke가 아니라 activeTab을 새로 주지 못한다. Jam이 같은 증상을 안 겪는 건 **popup 기반**이라 매 녹화가 아이콘 클릭(=invoke)에서 시작해 현재 탭에 activeTab을 fresh하게 받기 때문 — 아키텍처 차이지 우회 트릭이 아니다.
- **재발 방지**: (1) **`chrome.permissions.request(['activeTab'])`로 activeTab을 "재취득"하려는 시도는 무효다** — activeTab은 optional permission처럼 request로 부여되지 않고 오직 사용자 invoke(action click·command 단축키·contextMenu)로만 생긴다. Jam popup이 이걸 부르는 건 popup이 이미 아이콘클릭 activeTab을 가진 상태의 보강일 뿐, 사이드패널에선 효과 없다(첫 패치가 이걸로 실패함). (2) **사이드패널에서 tabCapture가 막히면 정공법은 getDisplayMedia 폴백** — 단 user activation 보존이 관건이다. 스트림 획득(`getMediaStreamId`)을 핸들러의 **첫 await**로 빼야, 실패 시점에 activation이 살아있어 곧장 getDisplayMedia picker를 띄울 수 있다. `getMediaStreamId`는 미디어 캡처 API가 아니라 실패해도 activation을 소비하지 않는다. (3) **스트림 획득과 recorder 시작을 분리**(`startTabStream`/`beginTabRecording`)해 그 사이에 `prepareRecorders`(로그 레코더 준비)를 끼운다 — 붙여두면 폴백 위해 분리할 때 streamId 만료(수초) 위험. 로그가 녹화 시작 시점부터 잡히도록 recorder.start는 prepareRecorders 뒤. (4) 새 캡처 진입점을 추가할 때 `grep -rn 'getMediaStreamId\|getDisplayMedia\|captureVisibleTab' src`로 권한 모델(activeTab 요구 vs 광역 허용)을 분기별로 확인 — 셋이 권한 요구가 다 다르다.
- **관련**: `src/sidepanel/video-capture.ts:startVideoCapture`(첫 await로 스트림 시험 + 실패 시 `startScreenCapture(tabId,{preferTab:true})` 자동 폴백), `startScreenCapture`(폴백은 `displaySurface:"browser"`로 탭 우선, 일반은 `"monitor"`), `src/sidepanel/video-recorder.ts:startTabStream`/`beginTabRecording`(스트림 획득/recorder 시작 분리). 판정은 `isTabCaptureUnavailable`(video-capture.ts) / `isActiveTabPermissionError`(capture-error.ts).

---

## 2026-06-28 — 하드코딩 색(placeholder)·입력중·diff에서 색 swatch 누락 (value 분기만 칠함)

- **영역**: `디자인`, `스타일해석`
- **계열**: `복제본`
- **그물**: `시각`
- **증상**: 요소 색이 `#444444`처럼 하드코딩이면 스타일 편집기 필드에 색 미리보기 사각형(swatch)이 안 떴다. 같은 hex를 사용자가 combobox로 직접 입력하면 swatch가 떴다. "prefill인데 왜 색 칩만 없나?"
- **근본 원인**: swatch가 **렌더 분기마다 따로 인라인**돼 있고 각 분기가 독립적으로 swatch 여부를 결정했다. `ValueCombobox`는 `value`(사용자 입력 = `inlineStyle[prop]`) 분기에만 swatch를 그렸고, 페이지 하드코딩 색은 `value`가 아니라 `placeholder`(`specifiedStyles`/`computedStyles`)로 들어온다. placeholder 분기는 토큰 참조(`var(...)`)만 칠하고 일반 색 리터럴은 텍스트만 표시 → 누락. 같은 누락이 manual-input 드롭다운 항목·diff 비교 뷰(`DiffValue`)에도 독립적으로 존재했다. "색이 있으면 swatch"라는 불변식이 한 곳이 아니라 **N개 렌더 분기에 흩어져** 있어, 한 분기(value)만 충족하고 나머지는 조용히 빠진 게 핵심.
- **재발 방지**: (1) **swatch는 분기마다 인라인하지 말고 단일 컴포넌트(`ColorSwatch`)를 거치게** 한다 — 색 표시 지점이 늘 때 swatch를 빠뜨릴 구조적 여지를 없앤다. 색을 텍스트로 그리는 새 지점을 추가하면 `isRenderableColorLiteral(v)`면 `ColorSwatch`도 같이. (2) **전수 점검 grep**: `grep -rn 'backgroundColor\|isRenderableColorLiteral\|ColorSwatch' src/sidepanel`로 색 렌더 지점을 모아 swatch 동반 여부 확인 — value/placeholder/manual-input/diff처럼 분기가 갈리면 각각 본다. (3) swatch 스타일도 분기·content script마다 제각각이었다(필드 10px/12px·radius 4px vs picker 툴팁 12px/3px) — `ColorSwatch`로 필드를 picker `.pl-swatch`에 통일. content script(`overlay.ts`)는 raw HTML이라 컴포넌트 공유 불가, 시각만 맞춤(리팩터 시 양쪽 동기 주의). (4) `isRenderableColorLiteral=false`(`currentColor`·`inherit`·`calc()`)는 미리보기 불가라 의도적 텍스트-only — computed는 이미 `rgb()`로 resolve돼 통과.
- **관련**: `src/sidepanel/components/ColorSwatch.tsx`(신규 — 공용 swatch, picker `.pl-swatch` 스타일 정본), `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx`(placeholder·manual-input 분기 swatch 추가), `src/sidepanel/tabs/styleEditor/TokenChip.tsx`(`TokenChip`·`TokenItem` swatch 교체), `src/sidepanel/components/StyleChangesTable.tsx:DiffValue`(diff 색값 swatch), 판정은 `colorLiteral.ts:isRenderableColorLiteral`. 같은 element 색 resolve 가족 버그는 아래 항목들 참조.

---

## 2026-06-28 — 테두리 없는 요소에 유령 border-color(글자색)가 실제 값처럼 노출

- **영역**: `스타일해석`
- **계열**: `라이브러리전제`
- **그물**: `unit`
- **증상**: `course-chatbot-nine.vercel.app`의 form(`.welcome-form form`)은 DevTools Styles에 border/border-color 선언이 **전혀 없는데** BugShot 스타일 편집기가 `rgb(45, 49, 54)`를 border-color로 뿌렸다(= 그 요소의 글자색). border 섹션도 자동으로 펼쳐졌다. "DevTools엔 없는 색이 왜 뜨나?"
- **근본 원인**: 증상(border-color 값)과 원인(다른 레이어)이 어긋났다. `getComputedStyle`은 테두리가 없어도(`border-style:none`/`border-width:0`) `border-{side}-color`를 **항상 `currentColor`의 resolve값**(= `color`, 여기선 `rgb(45,49,54)`)으로 돌려준다. `propMetadata.ts`의 `KNOWN_DEFAULTS`엔 `"border-*-color": ["rgb(0, 0, 0)", "currentcolor"]`로 기본값을 박아뒀지만 **`"currentcolor"` 엔트리는 dead** — `getComputedStyle`은 그 키워드를 절대 리터럴로 안 돌려주고 이미 concrete rgb로 해석해 준다. 그래서 `isKnownDefault`가 매칭에 실패 → 유령색이 non-default로 판정 → `sectionDefaultOpen`이 섹션을 펼치고 `ValueCombobox`가 값을 실값처럼 표시. **border-color는 단독으로 의미가 없고 같은 side의 style/width에 종속**인데 그 cross-prop 가드가 없었던 게 핵심.
- **재발 방지**: (1) **dead keyword default 패턴** — `KNOWN_DEFAULTS`에 `currentcolor`/`auto`/`medium`처럼 *getComputedStyle이 concrete로 resolve해 버리는 키워드*를 적는 건 무효다. `getComputedStyle`이 그 키워드를 그대로 돌려주는지 콘솔로 먼저 확인하고 박을 것. 같은 함정이 `width/height: ["auto"]`에도 잠재(이번엔 실해 없어 미수정 — `auto`→used px라 Size 섹션이 늘 펼쳐지지만 진짜 크기라 무해). (2) **cross-prop 종속 값** — 한 prop의 의미가 다른 prop에 묶이면(border-color↔style/width) 단일 `isKnownDefault(prop, value)`로는 못 거른다. computedStyles 전체를 받는 가드(`isInactiveBorderColor`)가 필요. 비활성 = `style===none OR width===0px`(가시 조건 `style!=none AND width>0`의 드모르간). (3) 같은 판정을 쓰는 **3곳을 동시에** 맞춰야 한다 — `grep -rn 'isInactiveBorderColor\|isKnownDefault' src/sidepanel`로 `sectionDefaultOpen`(섹션 펼침)·`ValueCombobox`(값 디밍) 누락 점검. author가 명시한 값은 가드를 우회해야(`specifiedStyles` 존중) 두 경로가 일관. 순수 함수는 `propMetadata.test.ts`·`sectionDefaultOpen.test.ts`로 고정.
- **관련**: `src/sidepanel/tabs/styleEditor/propMetadata.ts:isInactiveBorderColor`(신규 — cross-prop 가드), `src/sidepanel/lib/sectionDefaultOpen.ts`(섹션 펼침 가드), `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx`(`isDefault` 디밍 + specified 우회). 색 resolve의 같은 cross-origin 가족 버그는 아래 06-28 항목들 참조.

---

## 2026-06-28 — cross-origin 전용 custom prop 토큰은 이름만 뜨고 swatch/hex hint 누락

- **영역**: `스타일해석`
- **계열**: `cross-origin`
- **그물**: `unit`
- **증상**: naver(`#account > div > a`)에서 `--color-primary-background-default` 같은 변수가 스타일 편집기에 **이름은 잘 뜨는데** 옆의 색 swatch·hex 미리보기가 안 떴다. 값(`var(--…)`)도 정상 표시. "이름은 찾았는데 왜 색 칩만 없나?"
- **근본 원인**: **변수 이름과 swatch가 서로 다른 데이터 경로**에서 나온다. 이름은 속성 값 문자열을 `extractTokenRefs`가 정규식으로 뽑아 항상 표시되지만, swatch는 `findTokenValue(tokens, name)`로 store `tokens` 배열에서 그 변수를 찾아야 칠해진다. 그 배열을 만드는 `collectTokens`(`css-resolve.ts`)는 same-origin `cssRules`(cross-origin이면 `sheet.cssRules`가 throw→`catch{}`로 skip)와 inline만 모아서, cross-origin 시트에 정의된 변수는 `tokens`에 안 들어가 `findTokenValue`가 undefined → swatch 누락. 값 경로(`mergeCrossOriginDecls`)는 이미 cross-origin 보강을 소비하는데 토큰 수집 경로만 비대칭으로 빠져 있었다(2026-06-28 위 항목·06-27 항목과 **같은 "same-origin/cross-origin 경로 비대칭" 가족**).
- **1차 fix가 불충분했던 이유 (핵심 교훈)**: 처음엔 `collectTokens`가 `getCrossOriginCustomProps()`를 merge하도록 고쳤다(변수 **정의** 수집). 그런데 그게 잡는 건 cross-origin **`:root`/`html`/`*` 전역 셀렉터** 정의뿐(`GLOBAL_CUSTOM_PROP_SELECTORS` 필터). naver는 토큰을 **스코프 셀렉터**(테마 클래스/`[data-theme]`)에 정의해서 그 필터를 빠져나가 여전히 누락. **정의 수집은 fetch 성공 + 전역 스코프 두 전제에 의존**한다. 진짜 해법은 정의가 아니라 **참조**를 모으는 것: 요소의 specified 값에 남아있는 `var(--x)` 참조 이름만 `seen`에 넣고(`collectReferencedTokenNames`), 값은 `getComputedStyle(el).getPropertyValue('--x')`가 채우게 한다 — `getComputedStyle`은 **출처·스코프·fetch 여부 무관**하게 적용된 custom prop을 concrete 값으로 해석(콘솔에서 `--color-primary-background-default` → `#03A94D` 확인). 즉 cross-origin enrichment 자체에 매달리지 말고, **브라우저가 이미 해석해 둔 computed 값을 쓰라**.
- **재발 방지**: (1) cross-origin custom prop을 다룰 땐 **"정의를 어디서 읽나"가 아니라 "computed로 이미 해석되나"**를 먼저 본다 — `getComputedStyle(el).getPropertyValue('--x')`가 값을 주면 정의 출처/스코프를 추적할 필요가 없다. 정의 수집(`getCrossOriginCustomProps`)은 전역 스코프 + fetch 성공에만 동작하는 **부분해**임을 기억(드롭다운 보조용으로는 유지). (2) cross-origin author 스타일 소비 경로가 여럿(값 resolve=`mergeCrossOriginDecls`, 토큰 수집=`collectTokens`, 역참조=`buildTokenLookup`)이라 한 곳만 고치면 조용히 빠진다 — `grep -n 'getCrossOriginCustomProps\|getMatchingCrossOriginRules' src/content/css-resolve.ts`로 점검. (3) 순수 헬퍼는 `css-resolve.test.ts > collectReferencedTokenNames`·`mergeCrossOriginTokens`로 고정. loopback e2e는 SSRF 가드로 보강 fetch가 막혀 inert지만 **참조 수집 경로는 fetch 무관**이라 same-origin var 페이지로는 e2e 가능(추후). 양성 검증은 공개 CDN·naver 수동.
- **관련**: `src/content/css-resolve.ts:collectReferencedTokenNames`(신규 — 참조 var 이름 수집, 실해법), `collectTokens`(specified 값에서 참조 수집 + `mergeCrossOriginTokens` 전역 정의 보조), `mergeCrossOriginTokens`(1차 부분해 — 전역 정의 gap-fill), `src/content/picker.ts`(`picker.collectTokens`에 `ensureCrossOriginLoaded()` await — specified에 cross-origin 룰이 잡히게), `src/content/__tests__/css-resolve.test.ts`. swatch 렌더는 `ValueCombobox.tsx`의 `findTokenValue`. 같은 element의 다른 레이어는 아래 항목들 참조.

---

## 2026-06-28 — cross-origin author 스타일에서 var() 토큰이 일부 prop만 computed로 강등

- **영역**: `스타일해석`
- **계열**: `cross-origin`
- **그물**: `unit`
- **증상**: naver 로그인 버튼(`#account > div > a`)에서 `background-color`는 토큰(`var(--…)`)으로 잡히는데 `color`·`border-color`는 computed 리터럴로 표시. DevTools Styles엔 셋 다 `var()` 존재. "왜 일부 prop만 토큰?"
- **근본 원인**: `mergeCrossOriginDecls`(`css-resolve.ts`)가 cross-origin 매칭 룰을 seq 오름차순 **무조건 last-wins**로 병합했다. same-origin 경로(`collectRulesForElement`의 decl 루프)엔 있던 var 보존 가드(`out[name]?.includes("var(") && !val.includes("var(")` → skip)가 cross-origin 병합엔 빠져 있었다(8c949b4가 shorthand-claim 가드만 추가하며 누락). `<a>`처럼 한 prop이 여러 룰에서 재선언되면(테마 `color: var(--fg)` → 일반 `a { color:#333 }` 리셋) 이른 토큰을 나중 리터럴이 덮어 강등. `background-color`는 `<a>`에 단일 선언이라 안 덮여서 토큰 유지 → "일부 prop만 토큰" 비대칭. `styleHooks`의 `placeholder = specified || computed`라 specified가 비어서가 아니라 **리터럴로 채워져** computed처럼 보였다(빈 폴백 아님 — 강등).
- **두 번째 메커니즘 (같은 증상, 다른 원인)**: border는 naver가 `border: 1px solid var(--color-neutral-stroke-subtle-2)` **shorthand**로 선언. `border`는 width|style|color 혼합이라 `SHORTHAND_MAP`(동질 longhand 리스트/TRBL split 전제)에 없어 `expandShorthands`가 border-*-color로 전개하지 못했다 → color 토큰이 specified에 안 잡혀 computed로 폴백. 토큰 클로버(첫 메커니즘)와 별개로, **shorthand 미전개**가 원인. `parseBorderShorthand`(토큰을 width/style/color로 분류, 모호한 var는 color로)로 분해해 `border`/`border-{side}`를 변별 longhand에 fill-if-absent 전개.
- **재발 방지**: (1) specified 수집의 same-origin·cross-origin 두 경로는 **동일 시맨틱**(var 보존·shorthand claim)이어야 한다 — 가드를 한쪽에만 넣지 말 것. `grep -n 'includes("var(")' src/content/css-resolve.ts`로 대칭 점검. (2) 새 CSS shorthand를 패널에 노출할 땐 `SHORTHAND_MAP`/`TRBL_SHORTHANDS`/`BORDER_SHORTHAND_SIDES` 전개 경로에 등록됐는지 확인 — 등록 안 된 shorthand는 longhand가 통째로 빈다(border가 그 사각지대였다). 한 prop이 여러 규칙에서 재선언되는 케이스(`<a>` color + 리셋)와 shorthand-only 선언(`border: … var()`)을 회귀 테스트로 고정. 토큰 우선은 specificity 무시하는 **의도된 근사**(same-origin도 동일) — 정확한 computed는 별도 표시되므로 수용.
- **관련**: `src/content/css-resolve.ts:mergeCrossOriginDecls`(var 가드), `expandShorthands`+`parseBorderShorthand`(border 전개), `collectRulesForElement`(미러 원본), `src/content/__tests__/css-resolve.test.ts`. 같은 element(`#account > div > a`)의 다른 레이어 버그는 아래 2026-06-27 항목(섹션 펼침) 참조.

---

## 2026-06-27 — cross-origin stylesheet면 스타일 섹션이 전부 접혀 "값 있는데 안 보임"

- **영역**: `스타일해석`
- **계열**: `cross-origin`
- **그물**: `e2e`
- **증상**: naver.com 로그인 버튼(`#account > div > a`)을 picker로 선택하면 BugShot 스타일 편집기에 클래스명만 보이고 스타일 섹션이 전부 비어 보였다. 개발자도구 Styles 패널에선 정상으로 보였다.
- **근본 원인**: 두 레이어가 겹쳤다. (1) 스타일 수집의 specified(author rule) 채널은 `sheet.cssRules` 접근 시 cross-origin이면 SecurityError, fetch도 cross-origin이면 skip(`css-source-cache.ts:fetchSheetText`) → naver는 CSS가 `pstatic.net`(페이지는 `naver.com`)이라 specified가 통째로 빈다. (2) `StyleEditorPanel.tsx`의 섹션 `defaultOpen`이 specified 채널에만 묶여 있어(`props.some(p => p in specifiedStyles)`), specified가 비면 **모든 섹션이 접힌 채 시작**. computed 값(getComputedStyle, cross-origin 무관)은 살아있어 수동으로 펼치면 보였다 — 그래서 "값은 있는데 안 보임". 표면 증상은 "스타일 수집 실패"인데 사용자 체감 원인은 UI 펼침 상태였다.
- **재발 방지**: cross-origin이면 비는 채널(specifiedStyles·propSources·var() 토큰 전개)에 UI 가시성/상태를 **단독으로** 묶지 말 것 — computed fallback을 함께 본다. `grep "specifiedStyles\|propSources"`로 그 채널에 의존하는 UI 분기를 점검. 단순 `specified || computed` OR는 금물(computed는 `INTERESTING_PROPS` 전부 항상 채워서 모든 섹션이 늘 펼쳐짐) → "specified 전무일 때만 computed fallback" 분기. e2e는 `127.0.0.1` 페이지 + `localhost` stylesheet로 cross-origin 재현(`style-cross-origin-section.spec.ts`, fixture 서버 `.css`는 `text/css`로 — text/html이면 strict MIME 거부).
- **관련**: `src/sidepanel/lib/sectionDefaultOpen.ts`(신규 순수함수), `src/sidepanel/tabs/StyleEditorPanel.tsx`(`sectionOpen`), `src/content/css-source-cache.ts:fetchSheetText`(cross-origin skip 지점), `e2e/style-cross-origin-section.spec.ts`.

---

## 2026-06-25 — video + action-only일 때 logs.html이 본문에서 누락

- **영역**: `어댑터`
- **계열**: `복제본`
- **그물**: `unit`
- **증상**: 녹화(video) 모드에서 콘솔/네트워크 로그 없이 **액션 로그만** 있을 때, logs.html이 이슈에 첨부되지 않는 것처럼 보였다.
- **근본 원인**: `MarkdownContext`에 액션 로그 요약 필드가 아예 없었다. 이슈 본문 빌더 8개(`emitLogSummary*`)가 전부 `if (!net && !con) return`으로 로그 요약 섹션을 게이트해, 액션만 있으면 섹션을 통째로 스킵했다. `buildCaptureFiles`는 logs.html을 정상 생성·업로드했지만 본문이 참조(href/링크 노드)를 안 넣어 첨부가 고아가 됐다(GitLab/GitHub는 링크 누락, Jira ADF는 `injectLogsLink`가 붙을 노드 자체가 없음).
- **재발 방지**: 로그/미디어 종류를 본문에 노출·변경할 땐 `grep "emitLogSummary"`로 **8개 빌더**(buildIssueMarkdown md/html · buildIssueAdf · linear/github/gitlab/asana/notion)와 ctx 생성 **4곳**(buildMarkdownContext 헬퍼 · buildEditorMarkdownContext · PreviewPanel · DraftDetailDialog)을 전수 확인한다. 빌더 한 곳만 고치면 나머지 7곳이 조용히 빠진다. 빌더별 회귀 테스트 필수.
- **관련**: `src/sidepanel/lib/buildIssueMarkdown.ts`(`MarkdownContext.actionLogCaptured`), `buildMarkdownContext.ts`, `buildEditorCapture.ts`, 6개 플랫폼 body 빌더, `src/i18n/namespaces/logs.ts`(`logSummary.action.line`).
