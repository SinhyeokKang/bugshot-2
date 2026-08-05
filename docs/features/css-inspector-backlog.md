# CSS Inspector 백로그 — 이번 라운드에서 뺀 항목

Hoverify v4.8.6 CSS Inspector 분해 조사(리서치 브리프 11항목)에서 **이번 라운드 스코프 밖으로 뺀** 것들. 각 항목에 뺀 근거와, 다시 집을 때 필요한 사전 정보를 남긴다. 조사 자체를 다시 하지 않기 위한 문서다.

이번 라운드에 들어간 것: [`css-cascade-fidelity`](./css-cascade-fidelity/) (브리프 #1·#2·#8) · [`ua-default-baseline`](./ua-default-baseline/) (#3) · [`picker-aim-ux`](./picker-aim-ux/) (#4·#7·#10).

---

## B1. 상태 pseudo 스타일 (`:hover`/`:focus`) — **다음 라운드 별도 스펙 확정**

브리프 #6. 사용자 결정으로 다음 라운드에 독립 스펙으로 다룬다.

### 확정된 것

- **오늘은 `:hover` 규칙이 100% 누락된다.** `getMatchingRules`가 `el.matches(rule.selectorText)`로 판정하는데 `.btn:hover`는 마우스가 실제로 그 위에 있어야 true다. picking 중엔 blocker가 hit target이고 hover-shield가 hover를 **일부러 억제**하므로(`overlay.ts:88-102`) 구조적으로 매칭되지 않는다.
- **수집 방법**: 셀렉터에서 상태 pseudo만 벗겨 `.btn:hover` → `el.matches(".btn")`으로 판정하고, specificity는 **원본 셀렉터로** 계산한다. debugger 권한도 클래스 치환도 규칙 재삽입도 불필요.
- **라이브러리 불필요**: `css-selector-parser`를 새로 넣지 말고 `css-source-cache.ts`의 `lastCompound`(`:259`)·`splitSelectorList`(`:241`)로 의존성 0 depth-aware 제거를 짠다.
- **Hoverify 버그를 베끼지 말 것**: 그쪽 pseudo 추출기(`base.js:8397`)는 **마지막 compound만** 본다. `.card:hover .title`은 마지막이 `.title`이라 `pseudo = null`이 되어 hover 전용 스타일이 기본 블록에 섞인다. 우리는 "셀렉터 어느 compound에든 상태 pseudo가 있으면 상태 규칙"으로 판정한다.
- **`css-cascade-fidelity`에 의존한다** — cross-origin 시트의 hover 규칙까지 보이려면 CSSOM 통일이 먼저다.

### 사용자와 합의된 정보 위계

같은 요소의 idle/hover를 **별개 편집 대상**으로 취급한다. `elementKey`(`src/lib/element-key.ts` — 현재 `selector + frameId` 복합키)에 `state` 축을 더하면 편집 레지스트리·부분 원복·`StyleChangesTable`·리포트 본문이 전부 재사용된다.

```
[1행]  div.card > button.btn        (DOM 트리 — 기존)
[2행]  ⟨ 기본 | :hover | :focus ⟩   (조건부 노출 — 상태 규칙이 있을 때만)
[3행]  ⟨ 편집 | CSS ⟩                (기존 — 기본 탭에서만)
```

### 미결 — 다음 라운드의 결정 지점

**"적용"을 어떻게 하나**가 유일한 갈림길이다.

| | 페이지 적용 | 눈으로 확인 | before/after 스크린샷 | 필요한 것 |
|---|---|---|---|---|
| (a) 값만 입력 + diff | ✗ | ✗ | ✗ | B1 + 입력 UI |
| (b) `<style>` 주입 | ✓ | ✓ (마우스 올리면 보임) | ✗ | B1 + **B4** |

- **hover 상태 스크린샷은 어느 쪽이든 불가**다. `:hover` 강제는 CDP `forceElementState`뿐이고 `debugger` 권한이 필요하다.
- **`:focus`는 예외적으로 재현 가능하다** — `el.focus()`로 실제 focus 상태가 되고 computed도 얻고 스크린샷도 찍힌다. 다만 데이터 채널이 두 벌이 되고, `el.focus()`가 페이지 스크롤을 점프시키거나 페이지 focus 핸들러를 발화시켜 before/after 스냅샷을 오염시킬 위험이 있다.
- **상태 탭에서 기존 섹션 트리를 재사용하면 안 된다.** hover의 computed를 얻을 방법이 없는데 `sectionDefaultOpen`·`ValueCombobox` placeholder·`isKnownDefault`가 전부 computed에 의존한다. 상태 탭 본문은 "그 상태가 덮어쓰는 선언 목록" 한 벌이어야 한다.
- **표시 범위**: 브리프의 화이트리스트 17개(`base.js:8396`) 전부인지, `hover`/`focus`/`focus-visible`/`active`/`disabled` 5개로 줄일지. 나머지는 폼 요소 전용이라 노이즈가 크다.

---

## B2. 문서 좌표 하이라이트 (scroll 지연 제거) — 목표를 다시 잡아야 한다

브리프 #5. **브리프의 전제("scroll rAF 루프를 통째로 삭제")가 틀렸다.**

- `position: sticky` 요소는 스크롤 중 위치가 계속 변한다 — 문서 좌표로도 뷰포트 좌표로도 추적이 안 되고 리스너가 필요하다. 스크롤 연동 애니메이션도 마찬가지.
- 즉 `onViewportChange`(`picker.ts:1015`)는 남고, 얻는 것은 **"정적 요소에서 스크롤 시 1프레임 지연이 사라진다"**뿐이다.

위험은 그대로다:

- 호스트가 `position: fixed; inset: 0`(`overlay.ts:245-250`)이라 SVG가 그 밖으로 못 나간다 → **문서 좌표용 호스트를 하나 더** 만들어야 하고, `marginEl`/`paddingEl`/`gapEl`/`borderEl`/`previewEl`/`boxLabelsEl` 6개 도형의 좌표계가 전부 바뀐다(`overlay.ts:500-578`, `:797`).
- 절대 배치 자식이 `overflow: visible`로 문서 밖을 그리면 **페이지의 스크롤 영역이 커질 수 있다.**
- 스크롤 캡처의 blocker 양보(`overlay.ts:301`)·fixed/sticky 은폐 로직과 상호작용한다.
- `isFixed` 판정 자체가 함정 — 조상의 `transform`/`filter`/`will-change`가 `fixed`의 containing block을 바꾼다.

다시 집을 때는 목표를 **"루프 삭제"가 아니라 "정적 요소 지연 제거"**로 잡고, e2e를 먼저 깐 뒤 착수한다.

Hoverify 참조 지점: `base.js:6009`(문서 좌표 변환), `:6026`(fixed 분기), `:5195`(`Te.isFixed` — `offsetParent` 체인 순회).

---

## B3. 선언 단위 토글 (거터 체크박스) — 구조적으로 막혀 있다

브리프 #9. **아키텍처 조사 결과 "주석 처리"로는 표현이 안 된다.**

CSS 뷰의 doc은 사용자가 친 원문이 아니라 **specified + override 병합 재구성**이다(`StyleCssView.tsx:32-33`). specified 줄을 주석 처리하면 `evaluateCssDraft`가 그 prop을 override에 없는 것으로 읽고 `canonicalized: true`를 세워 **원문을 되살린다**(`cssDraftStatus.ts:33-43`).

- "페이지가 선언한 값을 잠깐 끄기"는 주석이 아니라 `prop: initial`/`unset` 주입이라는 **다른 의미**가 된다.
- override 줄(사용자 편집)만 토글하는 것으로 좁혀도, canonicalization이 doc을 재구성할 때 주석이 소실된다.

착수하려면 `evaluateCssDraft`의 round-trip 계약을 먼저 재설계해야 한다. **POSTMORTEM 2026-07-10**(CodeMirror `changeFilter`의 protected range가 프로그램적 doc 교체를 삼켜 CSS 뷰 본문 전멸)이 바로 이 파일에 있으니 착수 전 필독.

Hoverify 참조 지점: `base.js:20146`(거터 `lineMarker`), `:20141-20144`(주석 토글), `:8569`(`Ti.compareMaps` — 변경분 차분), `:20576`("Copy changes").

> "변경분만 복사"(브리프 #9의 나머지 절반)는 우리에겐 가치가 낮다 — `StyleChangesTable`의 as-is/to-be가 이미 이슈 본문에 실린다.

---

## B4. 요소별 `<style>` 태그로 pseudo/`@media` 편집 개방 — 사용자 결정으로 제외

브리프 #11. 이번 라운드 제외가 **사용자 결정**이다. 다만 조사 중 **제외 근거가 뒤집혔으므로** 기록해 둔다.

원래 근거는 "before/after 스냅샷 원복 판정이 규칙 단위로는 훨씬 어렵다"였는데, `style-overlay.ts`를 읽어보니 반대다.

- **inline이 어려운 이유는 `el.style`을 페이지와 공유하기 때문**이다. "우리가 쓴 값 vs 페이지가 덮어쓴 값"을 가리려고 `originals`/`applied`/`externalMutations` 3중 장부 + MutationObserver + baseline 승격(`style-overlay.ts:129`)이 붙어 있다.
- **`<style>` 주입은 소유권이 분리된다.** 우리가 만든 노드를 페이지는 모른다. 원복은 `styleEl.remove()` 한 줄이고 장부도 observer도 불필요하다.

대신 `<style>`에는 **다른** 함정 2개가 있고, 이게 실제 판단 근거가 되어야 한다.

1. **specificity 경쟁** — inline은 author 규칙을 거의 항상 이긴다. `<style>` 규칙은 페이지의 `!important`나 더 높은 specificity에 진다. 이기려면 `!important`를 붙이거나 specificity를 부풀려야 하는데, 그러면 **적용된 것과 리포트에 적는 CSS가 달라진다**.
2. **셀렉터 안정성** — 규칙은 selector로 대상을 잡으니 SPA 리렌더로 클래스가 바뀌면 다른 요소에 붙거나 아무데도 안 붙는다. inline은 요소 참조라 이 문제가 없다. **Hoverify가 정확히 이 버그를 갖고 있다**(고아 `<style>`이 `nth-child` 경로로 다른 요소에 계속 적용 — detach 감지 전무).

Hoverify 참조 지점: `base.js:8883`(직렬화), `:8928`(쓰기), `:21432`(요소 expando `el.hvStyle`에 `<style>` 노드 생성).

---

## B5. 조사했으나 **문제가 성립하지 않은** 항목

브리프의 "우리 코드에서 발견된 별건" 중 확인 결과 실해가 없던 것들. 다시 조사하지 않도록 남긴다.

### `inspectorCache` stale 가드 (브리프 `picker.ts:933-938`)

**문제 없음.** 그 경로는 완전히 동기다. `render()`는 호출 시점의 `lastHover`를 읽고, 캐시는 `WeakMap<Element, InspectorInfo>`라 다른 요소의 정보가 반환될 수 없다. 비동기 재수집(`scheduleInspectorRefresh`, `picker.ts:135-156`)은 캐시를 통째로 비운 뒤 **현재** `lastHover`로 다시 그린다.

### 인스펙터 카드의 커서 회피 배치 (브리프 별건)

**순수 미관.** 카드는 커서가 아니라 **대상 rect** 기준으로 배치되고(`placeLabel`, `overlay.ts:602`) `pointer-events: none`(`:107`)이라 클릭을 막지 않는다. `elementAtPoint`도 `withBlockerHitTest`를 거쳐 정상 동작한다.

---

## B6. 아직 판단하지 않은 항목

### frameToken 노출 완화 (브리프 별건)

Hoverify는 프레임 간 협조에 postMessage 대신 **확장 메시징 브로드캐스트**를 쓴다(`base.js:22559` → `bg.js:27378` → frameId 없는 `chrome.tabs.sendMessage`는 전 프레임 도달). 페이지 스크립트가 접근 불가라 origin/token 검증 자체가 불필요하다.

우리 `frameToken`은 `postMessage(..., "*")`로 부모 페이지에 노출되는 수용 위험이 있다(`docs/ARCHITECTURE.md` "등록 핸드셰이크"). **"지금 누가 포인터 주인인가" 신호만이라도 chrome 경로로 옮기면** 그 축의 노출이 사라진다. 좌표 offset 합성은 top 좌표로 크롭해야 해서 못 없앤다.

보안 개선이라 CSS Inspector 라운드와 성격이 다르다 — 별도로 다룰 것.

### `isFixed` 술어를 캡처 컨텍스트 확장에 재사용 (브리프 별건)

`findContextAncestor`(`content/capture-context.ts` · `sidepanel/lib/capture-basis.ts`)가 fixed 조상을 특별 취급하지 않는다. B2에서 `isFixed`를 만들게 되면 그때 함께 검토한다.
