# 안정적 요소 식별 정보

## 배경

BugShot의 요소 스타일 편집 모드는 선택한 DOM 요소마다 CSS selector를 생성하고, 복수
요소를 한 이슈에 묶으면 재현 환경의 `DOM` 행과 각 스타일 변경 섹션에 selector를
표시한다. 현재 생성기는 `@medv/finder` 4.0.2다.

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

이 selector는 카드 순서가 바뀌면 다른 요소를 가리킬 수 있고, selector만 여러 개
쉼표로 나열한 `DOM` 행은 이슈 처리자가 어느 변경 표와 어느 요소가 대응하는지 읽기
어렵다. 반대로 모든 조상 속성·fallback 경로를 본문에 펼치면 복수 요소 이슈가 과밀해진다.

## 목표

1. 선택 요소와 조상에서 안정성 높은 앵커를 우선 사용하되, 완성 selector가 현재
   frame document에서 선택 요소 하나만 가리킨다는 런타임 계약을 유지한다.
2. `data-testid`·`data-e2e`·`data-cy` 같은 테스트 계약 속성을 생성 ID·해시 클래스·
   임의 `data-*`보다 우선한다. 선택 요소가 가진 class 이름은 안정 후보에서 제외하고,
   위치 표현은 다른 유일한 후보가 없을 때만 사용한다.
3. 요소 스타일 편집 이슈의 `DOM` 행을 selector 나열에서 짧은 식별 목록으로 바꾼다.
   각 항목은 안정적 앵커와 대상 태그만 표시하며 선택 요소의 text는 포함하지 않는다.
   복수 요소일 때만 `Element N` 번호를 부여한다.
4. 각 스타일 변경 섹션 제목에 같은 요소 번호와 앵커 요약을 함께 표시해 제목만으로
   어느 요소인지 식별되게 하고, 실행 가능한 전체 selector는 그 섹션 바로 아래에
   별도 표시한다.
5. 단일·복수 요소, top frame·iframe, 라이브 작성·저장 초안 재열기, 클립보드와 8개
   제출 플랫폼, logs.html 리포트에서 같은 요소 번호·요약·selector를 출력한다.

## 비목표 (Non-goals)

- selector가 페이지 새로고침·재배포 후에도 같은 요소를 가리킨다고 보증하지 않는다.
  런타임 DOM 한 장만으로 속성의 장기 안정성을 증명할 수 없다.
- selector를 소스 파일·React/Vue/Svelte 컴포넌트 위치로 역매핑하지 않는다.
- 대상 사이트별 selector allowlist, 사용자 설정, 프레임워크 자동 감지 기능을 추가하지 않는다.
- Playwright role/text locator, XPath, text selector를 생성하지 않는다. BugShot의 재선택·
  편집 적용 경로는 표준 CSS selector를 계속 사용한다.
- 선택 요소의 text, accessible name, 가까운 라벨·제목을 새 식별 정보에 포함하지 않는다.
- 임의 `data-*`를 모두 안정적 앵커로 취급하지 않는다.
- Shadow DOM 내부 지원 범위를 넓히지 않는다. 기존처럼 캡슐화된 내부 대신 host가 선택된다.
- action log의 `buildLightSelector`는 이번 범위에서 변경하지 않는다. 이 기능은 요소 스타일
  편집과 요소 캡처에 쓰는 `dom-describe.ts:buildSelector` 경로만 다룬다.
- 조상이 선택 요소와 **같은 이름의 class**를 가지면 그 class도 함께 안정 후보에서
  빠진다. finder 훅에 element 인자가 없어 소유자를 구분할 수 없기 때문이며, 이 손실은
  compatibility fallback으로 보전한다(아래 위험 요소 2).
- screenshot 요소 캡처(`ShotSelector`)의 단일 DOM 행 표기는 바꾸지 않는다. 이번 목록은
  `styleElements`가 있는 element 스타일 편집 모드에만 적용한다.

## 사용자 시나리오

### 단일 요소

1. 사용자가 `data-e2e="enrollment-card"` 조상 아래의 `span`을 선택해 스타일을 바꾼다.
2. BugShot은 안정적 앵커를 우선한 CSS selector를 만들고 현재 frame document에서 선택
   요소만 매치하는지 검증한다.
3. 이슈의 재현 환경에는 다음처럼 한 줄이 표시된다. 요소가 하나뿐이라 번호를 붙이지
   않고, text도 포함하지 않는다.

   ```text
   DOM
   [data-e2e="enrollment-card"] › span
   ```

4. 스타일 변경 섹션 제목은 앵커 요약을 그대로 달고, 실행 가능한 selector가 바로
   아래 행에 표시된다.

   ```text
   Style changes — [data-e2e="enrollment-card"] › span
   Selector: [data-e2e="enrollment-card"] span
   ```

### 복수 요소

1. 사용자가 요소 3개를 차례로 수정해 한 이슈에 담는다.
2. `DOM` 행은 `Element 1`부터 최종 `styleElements` 순서대로 한 항목씩 표시한다.
3. 각 Style changes 섹션 제목은 `Style changes — Element 1 · [data-e2e="…"] › span`처럼
   번호와 앵커를 함께 쓴다. 전체 selector는 DOM 목록에 반복하지 않고 해당 섹션 아래에만
   한 번 표시한다.
4. 버퍼 요소를 삭제하거나 현재 요소가 기존 버퍼 요소를 대체하면 번호는 최종 병합 결과를
   기준으로 연속 재부여된다. 저장 데이터의 영구 ID로 사용하지 않는다.
5. before/after 업로드 파일명도 표시 번호와 맞춘 `element-1-before.webp` 형태를 쓴다.

### 안정적 앵커가 없는 요소

1. 선택 요소와 조상에 신뢰 가능한 test attribute·ID가 없고 클래스도 생성값뿐이다.
2. BugShot은 현재처럼 유일한 fallback selector를 생성하되 위치 표현 사용을 허용한다.
3. DOM 요약은 거짓 안정성을 만들지 않고 태그와 selector의 마지막 compound만 표시한다
   (예: `div › .card-body:nth-of-type(3)`).
4. 전체 위치 selector는 Style changes 섹션 아래 `Selector`로 남아 개발자가 필요할 때
   복사할 수 있다.

### 반복 test attribute

1. 목록의 모든 카드가 `data-e2e="enrollment-card"`를 공유한다.
2. 이 속성은 사람이 컴포넌트 종류를 찾는 앵커로는 표시할 수 있지만, 그것만으로 완성
   selector를 확정하지 않는다.
3. 후보가 선택 요소 하나를 가리키지 못하면 위치 표현으로 유일성을 확보한다.

### iframe 요소

1. 사용자가 1-depth iframe 안의 요소를 수정한다.
2. selector 유일성은 해당 frame document 안에서 검증한다.
3. DOM 요약의 iframe 항목에만 frame origin host를 조건부로 표시해 top document의 같은
   selector와 구분한다. Style changes 제목은 같은 요소 참조로 연결하고 origin을 반복하지 않는다.

### 저장 초안과 구버전 초안

1. 사용자가 복수 요소 이슈를 저장하고 나중에 다시 연다.
2. optional 구조화 locator가 저장돼 있으면 라이브 작성과 동일한 요약을 복원한다.
3. locator가 없는 구버전 초안은 `tagName`과 기존 selector로 안전하게 폴백한다. 초안
   마이그레이션이나 데이터 폐기는 하지 않는다.

## 위험 요소

`docs/features/DROPPED.md`의 판정 기준 4개 중 둘에 저촉된다. 기각 사유가 아니라 기획
시점에 인지하고 넘어가는 항목으로 기록한다.

1. **기준 1 (브라우저·기존 도구가 이미 하는가)** — 부분 저촉. Chrome DevTools의
   Copy selector / Copy JS path가 요소 식별 경로를 이미 준다. 이 기능의 값어치는
   selector를 **만드는 것**이 아니라 이슈 본문·8개 플랫폼으로 **운반하고 복수 요소를
   번호로 연결하는 것**이며, DevTools는 그 일을 하지 않는다. 이 논거가 무너지면
   기능 전체가 무너진다.
2. **기준 3 (사정거리가 이름값보다 좁은가)** — 저촉. "안정적"이라는 이름과 달리 실제
   사정거리는 ① 세션 내 rebind·버퍼 재선택 신뢰성 ② 사람이 컴포넌트를 grep할 단서
   두 개다. 페이지 리로드·재배포 후 동일성은 위 비목표에서 명시적으로 부인한다.
   기준 2(페이지에 무언가를 심는가)와 기준 4(검증 수단이 있는가)는 저촉하지 않는다 —
   노드 주입 없이 `querySelectorAll` 읽기만 하고, 핵심 판정이 전부 순수 함수라 유닛으로
   고정된다.
3. **selector 비결정성** — selector 문자열은 `sameElementKey(selector, frameId)`의 동등성
   키다. 시간 예산 소진 여부에 따라 같은 요소·같은 DOM에서 다른 selector가 나오면 같은
   요소가 버퍼에 두 번 쌓이고 이전 편집이 조용히 소실된다. 이를 막기 위해 예산 소진 시
   부분 결과를 쓰지 않고 항상 결정적인 `pathSelector`로 수렴한다(성공 기준 참조).
4. **finder 훅의 소유자 구분 불가** — 위 비목표 마지막 항목. 조상이 선택 요소와 같은
   class 이름을 쓰면 함께 배제된다(디자인 시스템에서 흔하다). 이 경우 안정 후보가
   비고 compatibility fallback으로 내려간다.

## 성공 기준

- 예시 DOM에서 전역 유일 조건이 충족되면 `data-e2e` 앵커를 포함한 selector가 클래스+
  `nth-of-type` 후보보다 먼저 선택된다. 기대 결과는
  `[data-e2e="enrollment-card"] span` — 선택 요소 자신의 class는 포함하지 않는다.
- 동적 ID·해시 클래스·상태/순서 `data-*`가 안정 앵커로 승격되지 않는 테스트가 있다.
- 선택 요소가 가진 class 이름은 안정 class 후보에 쓰지 않으며, class 삭제·교체 뒤에도
  현재 편집·버퍼 승격·재선택·패널 재오픈·캡처가 같은 요소를 유지한다. compatibility
  fallback이 불가피하게 그 class를 쓴 경우만 예외이며, 그 경우도 기존 best-effort
  경로가 세션 만료로 명시 처리한다.
- 같은 요소·같은 DOM에서 selector 생성 결과는 시간 예산 소진 여부와 무관하게
  결정적이다. 예산이 끊기면 부분 결과를 쓰지 않고 `pathSelector`로 수렴한다.
- 생성된 selector는 항상 현재 frame document에서 정확히 선택 요소 하나만 매치한다.
- finder timeout·throw·후보 부재 때 기존 위치 fallback이 유지되고 선택·재선택·편집 적용·
  캡처가 동작한다.
- DOM 목록과 Style changes가 복수 요소에서 동일한 `Element N` 번호를 사용하고, 단일
  요소에서는 양쪽 모두 번호 없이 앵커 요약만 쓴다.
- DOM 목록에는 선택 요소 text와 전체 selector가 없고, 각 Style changes에는 전체 selector가
  정확히 한 번 표시된다. Style changes 제목만 읽고도 어느 요소인지 식별된다.
- Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp, Slack, 클립보드 HTML/Markdown,
  미리보기, 저장 초안 상세, logs.html 리포트가 동일한 정보를 보존한다.
- top frame의 같은 selector와 iframe selector가 origin 표기로 구분된다.
- before/after 업로드 파일명·alt 텍스트의 요소 번호가 본문 `Element N`과 일치한다.
  Asana의 webp→jpeg rename 경로에서도 대응이 유지된다.
- AI 프롬프트가 찍는 요소 번호가 본문 `Element N`과 같은 배열에서 파생된다.
- picker의 안정 locator 생성은 선택 요소 1개에만 적용되며, 같은 요소에 대해 선택 1회당
  한 번만 계산한다(`postSelectionUpdate` 보강 메시지는 캐시를 재사용). DOM Tree의 기존
  로딩 비용은 고정 픽스처에서 열기 3회 중앙값 기준 변경 전 대비 +20% 이내다.
- 새 권한·env·OAuth·외부 API·서버 전송 경로가 없다. 다만 iframe origin host가 이슈
  본문·제출 페이로드에 처음 실리므로 privacy ko/en에 수집·전달 항목으로 명시한다.
  캡처 데이터는 기존처럼 브라우저에서 사용자가 선택한 플랫폼으로 직접 전송된다.
- 관련 단위 테스트와 `pnpm test`, `pnpm typecheck`가 통과한다. 빌드는 실행하지 않는다.
