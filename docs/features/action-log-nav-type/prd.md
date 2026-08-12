# 액션 로그 네비게이션 유형 판별

## 배경

액션 로그의 `navigation` 항목은 지금 **"어디로 갔는지"만 말하고 "어떻게 갔는지"는 말하지 않는다.**

- 브라우저 뒤로가기 버튼은 크롬 UI라 페이지에 `click` 이벤트가 남지 않는다. 그래서 재현 단계를 읽는 사람에게는 URL이 갑자기 이전 주소로 되돌아간 것으로만 보이고, 그게 뒤로가기인지 일반 이동인지 구분할 근거가 없다.
- SPA 경로는 `navType: "popstate"`까지 기록되지만(`action-recorder.ts`의 `popstate` 리스너), popstate는 뒤로/앞으로/`history.go(n)`/페이지가 부른 `history.back()`을 전부 같은 값으로 찍는다. 게다가 이 필드는 JSON 내보내기(`buildActionLogJson.ts`)에만 실리고 로그 UI·타임라인 마커에는 노출되지 않아, 화면상으로는 모든 네비게이션이 동일한 "이동"이다.
- 문서가 새로 로드되는 뒤로가기는 `navType: "load"`로만 남아 일반 이동과 완전히 동일하다. 증거가 0이다.
- 새로고침도 마찬가지로 "load"다. `shouldClearLogs`(`src/lib/navigation-clear.ts`)가 reload에서 로그를 클리어하는 phase에서는 사용자 입장에서 **로그가 비었는데 왜 비었는지 알 수 없는** 상태가 된다.

"뒤로가기를 눌렀더니 폼 값이 날아간다", "새로고침하면 재현된다" 류의 버그는 네비게이션 방식 자체가 재현 단계의 핵심인데, 지금 리포트에는 그 단계가 빠진 채 나간다.

> 이 기능이 가르는 축은 **히스토리 조작 여부**다. 링크 클릭과 주소창 입력은 도착 문서에서 구분할 수단이 없어 둘 다 기존 `load`로 남는다(비목표).

## 목표

1. 액션 로그의 `navigation` 항목이 **뒤로가기 / 앞으로가기 / 히스토리 이동(방향 미상) / 새로고침**을 기존 일반 이동과 구분해 기록한다.
2. 같은 구분이 **액션 로그 목록과 log-viewer 타임라인 양쪽**에 문구와 아이콘으로 드러난다.
3. AI 재현 단계 자동채움의 입력(`buildActionLogSummary`)에도 같은 구분이 실린다.
4. 기존 `navigation` 항목의 렌더·필터·검색·트림 동작이 회귀하지 않는다. 구 로그(유형 없는 `load`/`popstate`)는 기존 문구 그대로 나온다.

## 비목표 (Non-goals)

- **문서 재로드 경로의 back/forward 방향 구분.** 도착 문서의 `PerformanceNavigationTiming.type`은 `"back_forward"`까지만 주고 방향을 주지 않는다. 떠나는 페이지에서 Navigation API `navigate` 이벤트를 잡아 방향을 기록하는 방법이 있으나, 그 페이지가 armed 상태여야 하고 flush 타이밍(`pagehide` / `onBeforeNavigate` sync)에 의존해 놓치면 무음으로 값이 사라진다. 이번엔 `traverse`(방향 미상)에서 멈춘다.
- **링크 클릭 vs 주소창 입력 구분.** 둘 다 `PerformanceNavigationTiming.type === "navigate"`로 도착해 도착 문서에서는 원리상 구분되지 않는다. 기존 `load`로 남는다.
- **bfcache 복원에서 항목 남기기.** `pageshow(persisted)` 후크로 항목을 만들 수는 있으나, 그 시점엔 `recording=true`라 pre-arm 예외 마커가 안 붙어 cross-origin 복귀에서는 뒤늦게 도착하는 `logClear`에 `shouldDropPreArmEntry`로 폐기된다(`capturing=false` 상태면 `pushAction`이 아예 조기 반환). **더불어 bfcache 복원 페이지는 `console-recorder.ts`의 `pagehide` 핸들러가 콘솔 래핑을 되돌린 뒤 재설치 경로가 없어 error/warn 수집이 죽어 있다** — 액션 항목만 남기면 "여기서도 수집 중"으로 오독된다. 이 두 개를 함께 풀어야 의미가 있으므로 이번 스코프에서 뺀다.
- **액션 필터·검색 세분화.** 로그 탭 필터 칩은 `navigation` 하나를 유지한다(`ACTION_FILTERS`). `actionSearchText`도 `navType`을 인덱싱하지 않으므로 유형으로 검색되지 않는다 — 기존 동사들과 동일한 패턴이라 회귀가 아니고, 이번 스코프에 넣지 않는다.
- **`shouldClearLogs` 동작 변경.** reload·cross-origin 클리어 정책은 그대로 둔다. 이번 기능은 그 정책을 바꾸는 게 아니라 **왜 클리어됐는지 보이게** 한다.
- **타임라인 마커 variant 추가.** `MarkerVariant`의 `"navigate"`를 모든 유형이 공유한다(`markers.ts`). 즉 타임라인 **핀 색은 4종이 전부 파랑**이고, 유형 구분은 hover 이후 라벨과 액션 목록 아이콘에서만 드러난다.
- **해시 traverse의 중복 항목 정리.** 아래 엣지 케이스 참조 — 기존 동작을 그대로 보존한다.
- **background `webNavigation` 경로 활용.** `onCommitted`의 `transitionQualifiers`에 `"forward_back"`이 오지만, 같은 정보를 MAIN world 안의 `PerformanceNavigationTiming`으로 얻을 수 있어 background→content 순서 보장 문제를 지는 값이 없다(design.md "대안 검토" 참조).
- **제품 지표 측정.** 유형별 발생 빈도 등은 집계하지 않는다.

## 사용자 시나리오

> 아래 문구는 **실제 렌더 문자열**이다. 화살표·회전 기호는 문구가 아니라 `KindIcon`이 그리는 아이콘이며, i18n 값에는 들어가지 않는다.

### S1. SPA 뒤로가기 (방향까지 기록)

1. 리액트 라우터 앱에서 목록 → 상세로 이동하고 캡처를 시작한다.
2. 브라우저 뒤로가기를 누른다. 상세 → 목록으로 같은 문서 안에서 라우팅된다.
3. 액션 로그에 **`example.com/list(으)로 뒤로가기`** 가 `ArrowLeft` 아이콘과 함께 쌓인다. 앞으로가기를 누르면 **`example.com/detail(으)로 앞으로가기`** + `ArrowRight`.

### S2. 멀티페이지 뒤로가기 (방향 미상)

1. same-origin 멀티페이지 사이트에서 A → B로 링크 이동 후 뒤로가기를 누른다. 문서가 새로 로드된다.
2. `shouldClearLogs`는 same-origin이므로 로그를 보존한다.
3. 액션 로그에 **`example.com/a(으)로 히스토리 이동`** 이 `History` 아이콘과 함께 쌓인다(방향 미상 — S1과 달리 뒤로/앞으로를 가리지 않는다).

### S3. 새로고침

1. 캡처 중 새로고침을 누른다.
2. **phase가 idle/picking/capturing이면** `shouldClearLogs`가 true → 사이드패널 로그가 클리어된다. **recording/drafting/previewing/done에서는 `shouldPreserveBackgroundLogs`가 `logClear`를 조기 반환해 로그가 보존되고**, 새로고침 항목은 기존 로그 뒤에 이어서 쌓인다.
3. 클리어가 일어난 경우, pre-arm 버퍼가 새 문서 초반부터 다시 적재하고 **클리어 이후 첫 항목이 `example.com/detail 새로고침`**(`RotateCw`)이 된다. 로그가 왜 비었는지가 로그 자신으로 설명된다.
4. 클리어 직후 첫 항목이 도착하기 전까지는 기존 빈 상태(`actionLog.empty`)가 잠깐 노출된다.

### S4. AI 재현 단계 자동채움

1. 뒤로가기·새로고침이 섞인 세션에서 AI 초안을 실행한다.
2. `buildActionLogSummary`가 `Went back to:` / `Went forward to:` / `Reloaded:` / `Navigated via history to:`로 유형을 실어 보낸다 — 프롬프트가 "이동"만 보던 상태에서 벗어난다.

### S5. 구 로그 하위호환

1. 기능 도입 전에 만들어져 IndexedDB에 저장된 초안의 액션 로그를 다시 연다.
2. `navType`이 `"load"`/`"popstate"`인 항목은 기존 **`… 으로 이동`** 문구 + `MapPin` 아이콘으로 그대로 렌더된다. 빈 문구·raw 키가 뜨지 않는다.

### 엣지 케이스

- **해시 traverse**: 해시만 바뀌는 뒤로가기는 `popstate`와 `hashchange`가 함께 발화하고, `hashchange` 핸들러는 `(e.oldURL, e.newURL)`을 넘겨 두 값이 항상 다르므로 **기존 `fromUrl === toUrl` dedup을 통과한다**. 즉 지금도 항목이 2개(popstate 유래 + hashchange 유래) 남으며, 이번 변경은 그중 popstate 유래 항목에 방향 라벨을 붙일 뿐 **개수를 바꾸지 않는다**. 중복 정리는 비목표.
- **해시 라우팅의 인덱스 드리프트**: `<a href="#x">` 클릭은 `popstate` 없이 히스토리 인덱스를 +1 한다. 방향 판정은 미러 변수를 두지 않고 **판정 시점에 히스토리 인덱스를 매번 읽어** 갱신하므로 HashRouter 앱에서도 방향이 유지된다(design.md 참조).
- **cross-origin 뒤로가기**: `shouldClearLogs`가 로그를 클리어하므로 traverse 항목은 새 세션의 첫 항목이 된다(S3와 동형).
- **iframe 내부 traverse**: 레코더는 `all_frames: true`라 iframe에서도 발화한다. origin 필터로 구분된다(기존 동작).
- **Navigation API 부재**: `minimum_chrome_version: 116`이라 실제로는 항상 존재하지만, 페이지가 `window.navigation`을 덮어썼거나 값이 이상하면 방향 판정이 `null`로 떨어지고 **기존 `popstate` 값으로 폴백**한다. 기능이 죽지 않고 정보만 줄어든다.
- **`history.back()`을 페이지가 직접 호출**: 사용자가 버튼을 누른 게 아니어도 `back`으로 기록된다. 브라우저 UI와 프로그래매틱 호출은 원리상 구분되지 않는다 — 이 한계는 문서화하고 받아들인다.

## 성공 기준

- [ ] SPA 뒤로가기/앞으로가기가 각각 `navType: "back"` / `"forward"`로 기록되고 로그 목록·타임라인에 다른 문구와 다른 아이콘으로 뜬다.
- [ ] HashRouter 앱(`#/a` → `#/b` → 뒤로가기)에서도 `"back"`으로 기록된다.
- [ ] same-origin 문서 재로드 뒤로가기가 `navType: "traverse"`로 기록된다.
- [ ] 새로고침이 `navType: "reload"`로 기록되고, 클리어가 일어나는 phase에서는 클리어 직후 첫 항목이 된다.
- [ ] `buildActionLogSummary`가 유형별 영문 문구를 낸다.
- [ ] `navType`이 없거나 구 값인 항목이 기존 "이동" 문구 + `MapPin`으로 렌더된다.
- [ ] `pnpm test` 통과, `pnpm typecheck` 통과.
- [ ] `pnpm build:e2e && pnpm check:prearm dist-e2e` 통과 — recorders-entry가 여전히 동기 IIFE로 emit된다.
- [ ] e2e에서 `page.goBack()` / `goForward()` / `reload()` 각각에 대해 기대 `data-nav-type` 값이 액션 로그에 뜬다.
