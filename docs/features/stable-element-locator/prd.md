# 안정적 요소 selector 생성

> **스코프 축소 (2026-08-10)**: 초안은 selector 생성 알고리즘과 이슈 본문 표시 재설계
> (`Element N` 번호 목록·Style changes 제목 변경·전체 selector 행 분리)를 한 문서에
>담고 있었다. 표시 절반은 근거가 실측이 아니고 소비처 13곳 + 골든 58장을 흔드는 데
> 비해 성공 판정 수단이 없어 드랍했다 — 사유와 다시 볼 조건은
> [`docs/features/DROPPED.md`](../DROPPED.md)의 2026-08-10 항목. 이 문서는 알고리즘
> 절반만 다룬다.

## 배경

BugShot의 요소 스타일 편집 모드는 선택한 DOM 요소마다 CSS selector를 생성한다. 이
selector는 표시용이 아니라 **실행 키**다 — 세션 rebind(`picker-control.ts:474`
`rebindStylingSession` → `picker.ts:1216 document.querySelector`), 편집 적용, 캡처,
버퍼 dedup(`sameElementKey(selector, frameId)`)이 전부 이 문자열에 걸린다. 현재 생성기는
`@medv/finder` 4.0.2다.

finder가 테스트 계약 속성을 놓치는 원인은 penalty 경쟁이 아니라 **후보 생성 게이트**다.
finder의 기본 `attr` predicate는 `role`·`name`·`aria-label`·`rel`·`href`와, `data-*` 중
`wordLike`를 통과하는 이름만 허용한다. `wordLike`는 `/^[a-z\-]{3,}$/i`(숫자 불허)에
더해 하이픈·대문자 분절 후 각 토큰이 3자 이상일 것을 요구한다. 그 결과:

| 속성 | finder 기본 허용 | 거부 사유 |
|---|---|---|
| `data-testid`, `data-test` | ✅ | — |
| `data-e2e` | ❌ | 숫자 포함 |
| `data-cy`, `data-qa`, `data-pw` | ❌ | 토큰 2자 |
| `data-test-id`, `data-automation-id` | ❌ | `id` 토큰 2자 |

즉 흔히 쓰는 테스트 계약 속성 8개 중 6개는 **후보로 생성조차 되지 않는다.** penalty
표(id 0, class 1, attribute 2, tag 5, `nth-of-type` 10, `nth-child` 50)는 그다음 문제로,
게이트를 통과한 test attribute(2)조차 전역에서 흔한 스타일 class(1)에 진다.

예를 들어 다음 DOM에서 현재 결과는
`article:nth-of-type(1) .text-semantic-informative-primary-low`다. `data-e2e`는 경쟁에서
진 게 아니라 링에 오르지 못했다.

```html
<article data-e2e="enrollment-card">
  <header>
    <p>
      신청일시
      <span class="text-semantic-informative-primary-low inline-block w-112 text-right">
        2026.08.03 09:45
      </span>
    </p>
  </header>
</article>
```

이 결과는 두 가지를 동시에 나쁘게 만든다. ① 카드 순서가 바뀌면 rebind가 다른 요소를
집는다. ② 선택 요소 **자신의 class**가 selector에 들어가 있어, 사용자가 스타일 편집기로
그 class를 지우면(`picker.applyClasses` → `picker.ts:672 handleApplyClasses`) 자기 자신이
만든 selector가 자기 손에 깨진다.

## 목표

1. 선택 요소와 조상에서 안정성 높은 앵커를 우선 사용하되, 완성 selector가 현재
   frame document에서 선택 요소 하나만 가리킨다는 런타임 계약을 유지한다.
2. `data-testid`·`data-e2e`·`data-cy` 같은 테스트 계약 속성을 생성 ID·해시 클래스·
   임의 `data-*`보다 우선한다. **선택 요소가 가진 class 이름은 안정 후보에서 제외**하고,
   위치 표현은 다른 유일한 후보가 없을 때만 사용한다.
3. 한 세션 안에서 같은 요소는 항상 같은 selector 문자열을 얻는다. 선택 메시지와
   cross-origin 스타일 보강 메시지가 서로 다른 selector를 내지 않고, 시간 예산 소진
   여부로 결과가 갈리지 않는다.

## 비목표 (Non-goals)

- **이슈 본문 표시 재설계를 하지 않는다.** `DOM` 행의 selector 나열, Style changes 제목,
  전체 selector 위치는 전부 현행 유지다. 사유는 `docs/features/DROPPED.md` 2026-08-10.
  이번 변경으로 selector **문자열 값**은 바뀌지만 표시 **형식**은 바뀌지 않는다.
- `ElementLocator` 같은 구조화 메타데이터를 만들거나 저장하지 않는다. `IssueRecord`·
  `IssueBufferedElement` 스키마는 손대지 않는다 — 표시 절반이 없으면 소비처가 없다.
- selector가 페이지 새로고침·재배포 후에도 같은 요소를 가리킨다고 보증하지 않는다.
  런타임 DOM 한 장만으로 속성의 장기 안정성을 증명할 수 없다.
- selector를 소스 파일·React/Vue/Svelte 컴포넌트 위치로 역매핑하지 않는다.
- 대상 사이트별 selector allowlist, 사용자 설정, 프레임워크 자동 감지 기능을 추가하지 않는다.
- Playwright role/text locator, XPath, text selector를 생성하지 않는다. BugShot의 재선택·
  편집 적용 경로는 표준 CSS selector를 계속 사용한다.
- 임의 `data-*`를 모두 안정적 앵커로 취급하지 않는다.
- Shadow DOM 내부 지원 범위를 넓히지 않는다. 기존처럼 캡슐화된 내부 대신 host가 선택된다.
- action log의 `buildLightSelector`는 이번 범위에서 변경하지 않는다. 이 기능은 요소 스타일
  편집과 요소 캡처에 쓰는 `dom-describe.ts:buildSelector` 경로만 다룬다.
- DOM Tree(`buildInitialTree`·`buildChildrenResponse`)의 selector 생성은 기존 단일 finder
  경량 경로를 유지한다. 노드마다 다단계 탐색을 얹으면 트리 열기가 초 단위로 늘어난다.
- 조상이 선택 요소와 **같은 이름의 class**를 가지면 그 class도 함께 안정 후보에서
  빠진다. finder 훅에 element 인자가 없어 소유자를 구분할 수 없기 때문이며, 이 손실은
  compatibility fallback으로 보전한다(아래 위험 요소 4).

## 사용자 시나리오

### 안정적 앵커가 있는 요소

1. 사용자가 `data-e2e="enrollment-card"` 조상 아래의 `span`을 선택해 스타일을 바꾼다.
2. BugShot은 `[data-e2e="enrollment-card"] span`을 만든다. 선택 요소 자신의 class는
   들어가지 않는다.
3. 사용자가 그 요소의 class를 편집기로 지워도 재선택·버퍼 승격·before/after 재캡처가
   같은 요소를 계속 집는다.
4. 이슈 본문의 `DOM` 행에는 현행 그대로 이 selector 문자열이 표시된다.

### 안정적 앵커가 없는 요소

1. 선택 요소와 조상에 신뢰 가능한 test attribute·ID가 없고 클래스도 생성값뿐이다.
2. BugShot은 현재처럼 유일한 fallback selector를 생성하되 위치 표현 사용을 허용한다.
3. 사용자가 보는 것은 지금과 다르지 않다 — 이 경로는 회귀가 없다는 것이 목표다.

### 반복 test attribute

1. 목록의 모든 카드가 `data-e2e="enrollment-card"`를 공유한다.
2. 그것만으로는 유일해지지 않으므로 finder가 위치 표현을 더해 현재 target 하나만
   가리키게 한다. 반복 속성이 있다는 이유로 유일성 계약을 완화하지 않는다.

### iframe 요소

1. 사용자가 1-depth iframe 안의 요소를 수정한다.
2. selector 유일성은 해당 frame document 안에서 검증한다. top document에서 검사하면
   항상 실패하거나 다른 프레임의 같은 selector와 잘못 합쳐진다.

### cross-origin 스타일 보강

1. 선택 직후 `picker.selected`가 나가고, cross-origin 시트 원문이 확보되면
   `picker.selectionUpdated`가 스타일을 보강한다(선택당 최대 2회).
2. 사이드패널은 `sameElementKey`로 stale 가드를 걸므로 두 메시지의 selector가 다르면
   보강이 무음 드랍된다. 같은 요소에 대해서는 항상 같은 문자열이 나가야 한다.

## 위험 요소

`docs/features/DROPPED.md`의 판정 기준 4개 중 둘에 저촉된다. 기각 사유가 아니라 기획
시점에 인지하고 넘어가는 항목으로 기록한다.

1. **기준 1 (브라우저·기존 도구가 이미 하는가)** — 부분 저촉. Chrome DevTools의
   Copy selector가 selector를 만들어 준다. 이 기능의 값어치는 selector를 **만드는 것**이
   아니라 BugShot이 **자기 실행 키로 쓰는 문자열의 품질**이다. DevTools가 만든 selector를
   BugShot의 rebind·dedup에 주입할 경로는 없다.
2. **기준 3 (사정거리가 이름값보다 좁은가)** — 저촉. "안정적"이라는 이름과 달리 실제
   사정거리는 ① 세션 내 rebind·버퍼 재선택 신뢰성 ② 이슈를 읽는 사람이 컴포넌트를
   grep할 단서 두 개다. 페이지 리로드·재배포 후 동일성은 위 비목표에서 명시적으로
   부인한다. 기준 2(페이지에 무언가를 심는가)와 기준 4(검증 수단이 있는가)는 저촉하지
   않는다 — 노드 주입 없이 `querySelectorAll` 읽기만 하고, 핵심 판정이 전부 순수 함수라
   유닛으로 고정된다.
3. **selector 비결정성** — selector 문자열은 `sameElementKey(selector, frameId)`의 동등성
   키다. 시간 예산 소진 여부에 따라 같은 요소·같은 DOM에서 다른 selector가 나오면 같은
   요소가 버퍼에 두 번 쌓이고 이전 편집이 소실된다. 예산 소진 시 부분 결과를 쓰지 않고
   결정적인 `pathSelector`로 수렴해 막는다.
4. **finder 훅의 소유자 구분 불가** — 위 비목표 마지막 항목. 조상이 선택 요소와 같은
   class 이름을 쓰면 함께 배제된다(디자인 시스템에서 흔하다). 이 경우 안정 후보가
   비고 compatibility fallback으로 내려간다.
5. **selector 값 변경 자체가 회귀 표면이다.** 표시는 안 바꿔도 문자열이 바뀌므로
   `sameElementKey`를 소비하는 8파일·12지점(버퍼 dedup, 버퍼 재선택 시 편집 복원,
   `mergeStyleElements` dedup)과 골든 스냅샷이 전부 영향을 받는다.

## 성공 기준

- 예시 DOM에서 전역 유일 조건이 충족되면 `[data-e2e="enrollment-card"] span`이
  `article:nth-of-type(1) .text-semantic-informative-primary-low`보다 먼저 선택된다.
- 동적 ID·해시 클래스·상태/순서 `data-*`가 안정 앵커로 승격되지 않는 테스트가 있다.
- 선택 요소가 가진 class 이름은 안정 class 후보에 쓰지 않으며, class 삭제·교체 뒤에도
  현재 편집·버퍼 승격·재선택·패널 재오픈·캡처가 같은 요소를 유지한다. compatibility
  fallback이 불가피하게 그 class를 쓴 경우만 예외이며, 그 경우도 기존 best-effort
  경로가 세션 만료로 명시 처리한다.
- 같은 요소·같은 DOM에서 selector 생성 결과는 시간 예산 소진 여부와 무관하게
  결정적이다. 예산이 끊기면 부분 결과를 쓰지 않고 `pathSelector`로 수렴한다.
- `picker.selected`와 `picker.selectionUpdated`가 같은 요소에 대해 같은 selector를 내
  cross-origin 스타일 보강이 stale 가드에 드랍되지 않는다.
- 생성된 selector는 항상 현재 frame document에서 정확히 선택 요소 하나만 매치한다.
- finder timeout·throw·후보 부재 때 기존 위치 fallback이 유지되고 선택·재선택·편집 적용·
  캡처가 동작한다.
- 안정 locator 생성은 선택 요소 1개, 선택 1회당 한 번만 계산한다. DOM Tree의 기존
  로딩 비용은 고정 픽스처에서 열기 3회 중앙값 기준 변경 전 대비 +20% 이내다.
- **새 권한·env·OAuth·외부 API·서버 전송 경로가 없고 privacy 갱신도 불필요하다.**
  수집·전달 항목이 늘지 않는다 — 조상 test attribute 값은 finder 기본 `data-*` 허용으로
  오늘도 selector에 실려 나가고 `privacy.ko.md` L42가 "요소를 고른 경우 그 요소의 CSS
  selector"로 이미 공개한다. 새 데이터 범주가 아니라 같은 범주의 다른 문자열이다.
- 관련 단위 테스트와 `pnpm test`, `pnpm typecheck`가 통과한다. 빌드는 실행하지 않는다.
