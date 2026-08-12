# 액션 로그 네비게이션 유형 판별

## 배경

액션 로그의 `navigation` 항목은 지금 **"어디로 갔는지"만 말하고 "어떻게 갔는지"는 말하지 않는다.**

- 브라우저 뒤로가기 버튼은 크롬 UI라 페이지에 `click` 이벤트가 남지 않는다. 그래서 재현 단계를 읽는 사람에게는 URL이 갑자기 이전 주소로 되돌아간 것으로만 보이고, 그게 뒤로가기인지 링크 클릭인지 주소창 입력인지 구분할 근거가 없다.
- SPA 경로는 `navType: "popstate"`까지 기록되지만(`src/content/action-recorder.ts:598`), popstate는 뒤로/앞으로/`history.go(n)`/페이지가 부른 `history.back()`을 전부 같은 값으로 찍는다. 게다가 이 필드는 JSON 내보내기(`buildActionLogJson.ts:21`)에만 실리고 로그 UI·타임라인 마커에는 노출되지 않아, 화면상으로는 모든 네비게이션이 동일한 "이동"이다.
- 문서가 새로 로드되는 뒤로가기는 `navType: "load"`로만 남아(`action-recorder.ts:580`) 주소창 입력·링크 클릭과 완전히 동일하다. 증거가 0이다.
- 새로고침도 마찬가지로 "load"다. `shouldClearLogs`(`src/lib/navigation-clear.ts:8`)가 reload에서 로그를 통째로 클리어하기 때문에, 사용자 입장에서는 **로그가 비었는데 왜 비었는지 알 수 없는** 상태가 된다.

"뒤로가기를 눌렀더니 폼 값이 날아간다", "새로고침하면 재현된다" 류의 버그는 네비게이션 방식 자체가 재현 단계의 핵심인데, 지금 리포트에는 그 단계가 빠진 채 나간다.

## 목표

1. 액션 로그의 `navigation` 항목이 **뒤로가기 / 앞으로가기 / 히스토리 이동(방향 미상) / 새로고침**을 기존 일반 이동과 구분해 기록한다.
2. 같은 구분이 **사이드패널 액션 로그 탭과 log-viewer 타임라인 양쪽**에 문구로 드러난다.
3. bfcache 복원(뒤로가기 캐시 히트)에서도 항목이 남는다 — 지금은 항목 자체가 생기지 않는다.
4. 기존 `navigation` 항목의 렌더·필터·검색·트림 동작이 회귀하지 않는다. 구 로그(유형 없는 `load`/`popstate`)는 기존 문구 그대로 나온다.

## 비목표 (Non-goals)

- **문서 재로드 경로의 back/forward 방향 구분.** 도착 문서의 `PerformanceNavigationTiming.type`은 `"back_forward"`까지만 주고 방향을 주지 않는다. 떠나는 페이지에서 Navigation API `navigate` 이벤트를 잡아 방향을 기록하는 방법이 있으나, 그 페이지가 armed 상태여야 하고 flush 타이밍(`pagehide` / `onBeforeNavigate` sync)에 의존해 놓치면 무음으로 값이 사라진다. 이번엔 `traverse`(방향 미상)에서 멈춘다.
- **액션 필터 세분화.** 로그 탭 필터 칩은 `navigation` 하나를 유지한다(`ACTION_FILTERS`, `ActionLogContent.tsx:24`). 유형별 필터는 요청되지 않았다.
- **`shouldClearLogs` 동작 변경.** reload·cross-origin 클리어 정책은 그대로 둔다. 이번 기능은 그 정책을 바꾸는 게 아니라 **왜 클리어됐는지 보이게** 한다.
- **타임라인 마커 variant 추가.** `MarkerVariant`의 `"navigate"`를 모든 유형이 공유한다(`markers.ts:9`).
- **background `webNavigation` 경로 활용.** `onCommitted`의 `transitionQualifiers`에 `"forward_back"`이 오지만, 같은 정보를 MAIN world 안의 `PerformanceNavigationTiming`으로 얻을 수 있어 background→content 순서 보장 문제를 지는 값이 없다(design.md "대안 검토" 참조).

## 사용자 시나리오

### S1. SPA 뒤로가기 (방향까지 기록)

1. 리액트 라우터 앱에서 목록 → 상세로 이동하고 캡처를 시작한다.
2. 브라우저 뒤로가기를 누른다. 상세 → 목록으로 같은 문서 안에서 라우팅된다.
3. 액션 로그에 **`← example.com/list 로 뒤로가기`** 가 쌓인다. 앞으로가기를 누르면 **`→ example.com/detail 로 앞으로가기`**.

### S2. 멀티페이지 뒤로가기 (방향 미상)

1. same-origin 멀티페이지 사이트에서 A → B로 링크 이동 후 뒤로가기를 누른다. 문서가 새로 로드된다.
2. `shouldClearLogs`는 same-origin이므로 로그를 보존한다.
3. 액션 로그에 **`↻ example.com/a 로 히스토리 이동`** 이 쌓인다(방향 미상 — S1과 달리 뒤로/앞으로를 가리지 않는다).

### S3. 새로고침

1. 캡처 중 새로고침을 누른다.
2. `shouldClearLogs`가 true → 사이드패널 로그가 클리어된다.
3. pre-arm 버퍼가 새 문서 초반부터 다시 적재하고, **클리어 이후 첫 항목이 `↻ example.com/detail 새로고침`** 이 된다. 로그가 왜 비었는지가 로그 자신으로 설명된다.

### S4. bfcache 복원

1. A에서 B로 이동했다가 뒤로가기로 A에 돌아오는데, Chrome이 A를 bfcache에서 복원한다(문서 재실행 없음).
2. 지금은 레코더 스크립트가 다시 돌지 않아 **아무 항목도 생기지 않는다.**
3. 변경 후 `pageshow`(`persisted === true`)가 **`↻ example.com/a 로 히스토리 이동`** 을 남긴다.

### S5. 구 로그 하위호환

1. 기능 도입 전에 만들어져 IndexedDB에 저장된 초안의 액션 로그를 다시 연다.
2. `navType`이 `"load"`/`"popstate"`인 항목은 기존 **`📍 … 으로 이동`** 문구로 그대로 렌더된다. 빈 문구·raw 키가 뜨지 않는다.

### 엣지 케이스

- **해시 traverse**: 해시만 바뀌는 뒤로가기는 `popstate`와 `hashchange`가 함께 발화한다. 기존 dedup(`fromUrl === toUrl`이면 스킵, `action-recorder.ts:308`)이 그대로 적용되고, 살아남는 항목이 방향 라벨을 갖는다.
- **cross-origin 뒤로가기**: `shouldClearLogs`가 로그를 클리어하므로 traverse 항목은 새 세션의 첫 항목이 된다(S3와 동형).
- **iframe 내부 traverse**: 레코더는 `all_frames: true`라 iframe에서도 발화한다. origin 필터로 구분된다(기존 동작).
- **Navigation API 부재**: `minimum_chrome_version: 116`이라 실제로는 항상 존재하지만, 페이지가 `window.navigation`을 덮어썼거나 값이 이상하면 방향 판정이 `null`로 떨어지고 **기존 `popstate` 값으로 폴백**한다. 기능이 죽지 않고 정보만 줄어든다.
- **`history.back()`을 페이지가 직접 호출**: 사용자가 버튼을 누른 게 아니어도 `back`으로 기록된다. 브라우저 UI와 프로그래매틱 호출은 원리상 구분되지 않는다 — 이 한계는 문서화하고 받아들인다.

## 성공 기준

- [ ] SPA 뒤로가기/앞으로가기가 각각 `navType: "back"` / `"forward"`로 기록되고 로그 탭·타임라인에 다른 문구로 뜬다.
- [ ] same-origin 문서 재로드 뒤로가기가 `navType: "traverse"`로 기록된다.
- [ ] 새로고침이 `navType: "reload"`로, 클리어 직후 첫 항목으로 기록된다.
- [ ] bfcache 복원에서 `traverse` 항목이 생긴다.
- [ ] `navType`이 없거나 구 값인 항목이 기존 "이동" 문구로 렌더된다.
- [ ] `pnpm test` 통과, `pnpm typecheck` 통과.
- [ ] `pnpm build && pnpm check:prearm` 통과 — recorders-entry가 여전히 동기 IIFE로 emit된다.
- [ ] e2e에서 `page.goBack()` / `goForward()` / `reload()` 각각에 대해 기대 문구가 액션 로그에 뜬다.
