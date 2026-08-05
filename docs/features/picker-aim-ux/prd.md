# 피커 조준 UX — 키보드 탐색 · 실렌더 폰트 · 오버레이 자가치유

## 배경

요소 스타일 편집의 첫 관문은 "원하는 요소를 집는 것"인데, 지금은 **마우스 위치 하나로만** 집는다. 여기서 세 가지가 걸린다.

### 1. 픽셀 단위로 겹친 요소를 못 집는다

`onKeyDown`(`src/content/picker.ts:1108`)이 `Escape`만 본다. 마우스로 못 닿는 요소가 실전에 흔하다.

- 자식이 부모를 꽉 채워 부모를 클릭할 픽셀이 0인 래퍼
- 아이콘 안의 `<path>`, 링크를 덮은 투명 오버레이
- 리스트에서 옆 항목으로 정확히 한 칸 이동

parent/child 이동은 사이드패널 버튼(`handleNavigate`, `picker.ts:654`)으로 가능하지만 **요소를 확정한 뒤**에만 쓸 수 있다. 확정 전, 즉 조준 단계에는 아무 수단이 없다.

### 2. 인스펙터 카드의 `font`가 거짓말을 한다

`buildInspectorHtml`(`src/content/overlay.ts:696`)이 `parseFirstFontFamily`로 **선언된 스택의 첫 항목**을 보여준다. `font-family: Pretendard, -apple-system, sans-serif`면 Pretendard가 로드되지 않았어도 `Pretendard`라고 뜬다. 폰트 폴백은 버그 리포트에서 흔한 원인(자간·줄바꿈·글자 잘림)인데 도구가 정반대 정보를 준다.

### 3. SPA가 `documentElement`를 갈아치우면 picking이 조용히 죽는다

`removeOrphanOverlay`(`picker.ts:198`)는 **생성 시점 방어**만 한다. 세션 도중 페이지가 `documentElement.innerHTML`을 통째로 교체하거나 우리 호스트 노드를 제거하면 오버레이가 사라지고, 사용자에겐 "갑자기 아무 반응이 없다"로 보인다. 복구 수단은 사이드패널에서 picker를 다시 시작하는 것뿐이고, 그래야 한다는 걸 알 방법이 없다.

## 목표

- **G1** — 조준 단계(hover 모드)에서 화살표 4방향으로 DOM을 이동할 수 있다. 마우스로 닿지 않는 요소를 집을 수 있다.
- **G2** — 키보드 탐색 중 마우스 이동이 선택을 되돌리지 않는다(freeze). freeze는 <kbd>Space</kbd>로 수동 토글도 된다.
- **G3** — 인스펙터 카드가 **실제로 렌더된** 폰트를 보여주고, 선언과 다르면 그 사실이 드러난다.
- **G4** — 오버레이 호스트가 페이지에 의해 제거되면 자동으로 되살아난다. 사용자 개입 없이 picking이 이어진다.
- **G5** — 페이지 단축키를 통째로 죽이지 않는다. **우리가 처리하는 키만** 삼킨다.

## 비목표 (Non-goals)

- **하이라이트 좌표계를 문서 좌표로 전환** (브리프 #5) — 조사 결과 이번 범위에서 뺀다. 근거는 아래 "조사 후 제외한 항목".
- **인스펙터 카드의 커서 회피 배치** (브리프 별건) — 카드는 대상 rect 기준으로 배치되고 `pointer-events: none`(`overlay.ts:107`)이라 클릭을 막지 않는다. 시각적 겹침만 남는 순수 미관 항목이라 뺀다.
- **`inspectorCache` stale 가드** (브리프 별건) — 코드 확인 결과 **해당 문제가 없다**. 아래 참조.
- **selected 모드 화살표 탐색** — 확정 후에는 사이드패널의 parent/child 버튼과 DOM 트리 다이얼로그가 이미 있다. 포커스가 패널에 있을 때 키가 어디로 갈지 모호해지므로 hover 모드 전용으로 둔다.
- 새 권한·env·의존성. 없음.

## 조사 후 제외한 항목

### `inspectorCache` stale 가드 — 문제가 성립하지 않는다

브리프는 `picker.ts:933-938`에 stale 가드가 없다고 지적했지만, 실제 코드에서 그 경로는 **완전히 동기**다. `render()`는 호출 시점의 `lastHover`를 읽고, 캐시는 `WeakMap<Element, InspectorInfo>`라 다른 요소의 정보가 반환될 수 없다. 비동기 재수집 경로(`scheduleInspectorRefresh`, `:135-156`)는 캐시를 통째로 비운 뒤 **현재** `lastHover`로 다시 그린다. 늦게 도착한 결과가 이전 요소에 붙을 틈이 없다.

### 문서 좌표 하이라이트 (브리프 #5) — 이득이 예상보다 작고 위험은 그대로

브리프는 "scroll rAF 루프를 통째로 삭제"할 수 있다고 봤지만, 조사해 보니 **루프를 지울 수 없다.**

- `position: sticky` 요소는 스크롤 중 위치가 계속 변한다 — 문서 좌표로도 뷰포트 좌표로도 추적이 안 되고 리스너가 필요하다.
- 스크롤 연동 애니메이션(패럴랙스, scroll-driven animation)도 마찬가지다.
- 즉 얻는 것은 "정적 요소에서 스크롤 시 1프레임 지연이 사라진다"뿐이고, `onViewportChange`(`picker.ts:1015`)는 남는다.

반면 위험은 그대로다.

- 호스트가 `position: fixed; inset: 0`(`overlay.ts:245-250`)이라 SVG가 그 밖으로 못 나간다 → **문서 좌표용 호스트를 하나 더 만들어야 한다**. `marginEl`/`paddingEl`/`gapEl`/`borderEl`/`previewEl`/`boxLabelsEl` 6개 도형의 좌표계가 전부 바뀐다(`overlay.ts:500-578`, `:797`).
- 절대 배치 자식이 `overflow: visible`로 문서 밖을 그리면 **페이지의 스크롤 영역이 커질 수 있다**.
- 스크롤 캡처의 blocker 양보 로직(`overlay.ts:301`)·fixed/sticky 은폐 로직과 상호작용한다.
- `isFixed` 판정 자체가 함정이다 — 조상의 `transform`/`filter`/`will-change`가 `fixed`의 containing block을 바꾼다.

다음 라운드에서 다루되, 그때는 **"루프 삭제"가 아니라 "정적 요소 지연 제거"**로 목표를 다시 잡아야 한다.

## 사용자 시나리오

### S1. 겹친 요소를 화살표로 집는다

1. 사용자가 아이콘 버튼 위에 마우스를 올린다. 하이라이트가 안쪽 `<path>`에 잡힌다.
2. <kbd>↑</kbd>를 누른다 → 대상이 `<svg>`로 올라가고 **freeze가 자동으로 켜진다**.
3. <kbd>↑</kbd>를 한 번 더 → `<button>`. 인스펙터 카드가 따라 갱신된다.
4. 마우스를 움직여도 대상이 바뀌지 않는다(frozen).
5. 클릭 또는 <kbd>Enter</kbd>로 확정한다. 이후는 기존 플로우와 동일하다.

### S2. 형제 이동으로 리스트 항목을 훑는다

1. 리스트의 세 번째 항목에 마우스를 올린다.
2. <kbd>→</kbd>로 네 번째, <kbd>←</kbd>로 두 번째 항목으로 이동한다. 각 항목의 크기·색·폰트가 카드에 뜬다.
3. <kbd>Space</kbd>로 freeze를 풀면 다시 마우스 추적으로 돌아간다.

### S3. 폰트 폴백을 발견한다

1. 사용자가 본문 텍스트에 마우스를 올린다.
2. 카드의 `font` 행이 `16px / 400 / Pretendard → sans-serif`로 뜬다.
3. 선언은 Pretendard인데 실제로는 시스템 sans-serif로 렌더 중임을 즉시 안다.
4. 폴백이 없으면 오늘과 같이 `16px / 400 / Pretendard`만 뜬다.

### S4. SPA 라우트 전환에서 오버레이가 살아난다

1. picking 중 페이지가 라우트를 바꾸며 `documentElement`의 자식을 전부 교체한다.
2. 오버레이 호스트가 사라진다.
3. **자동으로 재생성**되고, 현재 모드에 맞는 리스너가 다시 붙고, 마지막 대상이 다시 그려진다.
4. 사용자는 끊김을 느끼지 못한다.

### 엣지 케이스

- **E1. 탐색 대상이 우리 UI** — `<html>`의 자식에는 오버레이 호스트가 있다. 화살표 이동은 `isOwnUi` 요소를 **건너뛴다**.
- **E2. 탐색 대상 없음** — `<html>`에서 <kbd>↑</kbd>, 자식 없는 요소에서 <kbd>↓</kbd>. 아무 일도 일어나지 않는다(오류·경고 없음).
- **E3. 페이지 입력 요소에 포커스** — `input`/`textarea`/`contenteditable`이 활성이면 화살표·Space를 삼키지 않고 페이지로 흘린다. picking 중엔 blocker가 hit target이라 드문 경우지만 방어한다.
- **E4. freeze 중 요소가 DOM에서 사라짐** — 다음 렌더에서 `isConnected`가 false면 freeze를 풀고 하이라이트를 숨긴다.
- **E5. iframe 핸드오프 중** — 등록된 자식 iframe 위에서는 안쪽 picker가 그린다(`onMouseMove:1046-1057`). freeze·화살표는 **이벤트를 받은 프레임 안에서만** 동작한다. 프레임 경계를 넘는 키보드 탐색은 하지 않는다.
- **E6. 자가치유 무한 루프** — 페이지가 우리 노드를 계속 지우면 재생성이 반복된다. 연속 재생성 횟수에 상한을 두고, 초과하면 포기하고 `picker.cancelled`를 보낸다.
- **E7. 폰트 판정 불가** — `document.fonts`나 canvas 2D 컨텍스트가 없으면 오늘과 같이 선언 첫 항목을 그대로 보여준다.

## 성공 기준

1. hover 모드에서 화살표 4방향 이동이 동작하고, 이동 시 freeze가 자동으로 켜진다.
2. <kbd>Space</kbd>로 freeze를 토글할 수 있고, frozen 상태가 시각적으로 구분된다.
3. `Escape`·화살표·`Space`·`Enter` **외의 키는 페이지로 그대로 흐른다** — picking 중 페이지 단축키가 죽지 않는다.
4. 사이드패널의 picking 화면(`PickingState`)에 조작 힌트가 ko/en 양쪽으로 표시된다.
5. 로드되지 않은 폰트를 선언한 요소에서 카드가 실제 렌더 폰트를 보여준다.
6. 오버레이 호스트를 강제로 제거해도 자동 복구되고 picking이 이어진다.
7. `pnpm test` + `pnpm typecheck` 통과, 기존 e2e(특히 `picker-guard`·`picker-iframe`·`hover-shield`·`dom-tree-nav`) green.
