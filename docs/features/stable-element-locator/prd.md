# 안정적 요소 식별 정보

## 배경

BugShot의 요소 스타일 편집 모드는 선택한 DOM 요소마다 CSS selector를 생성하고, 복수
요소를 한 이슈에 묶으면 재현 환경의 `DOM` 행과 각 스타일 변경 섹션에 selector를
표시한다. 현재 생성기는 `@medv/finder` 4.0.2이며, 현재 DOM에서 짧고 유일한 경로를
찾는 데 최적화돼 있다. finder의 고정 penalty는 id 0, class 1, attribute 2,
tag 5, `nth-of-type` 10이라 안정적인 `data-e2e` 조상보다 전역에서 흔한 스타일
클래스와 위치 selector가 선택될 수 있다.

예를 들어 다음 DOM에서 현재 결과는
`article:nth-of-type(1) .text-semantic-informative-primary-low`다.

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
   임의 `data-*`보다 우선한다. 선택 요소에서 사용자가 편집할 수 있는 class는 안정 후보에서
   제외하고, 위치 표현은 다른 유일한 후보가 없을 때만 사용한다.
3. 요소 스타일 편집 이슈의 `DOM` 행을 selector 나열에서 번호가 붙은 짧은 식별 목록으로
   바꾼다. 각 항목은 안정적 앵커와 대상 태그만 표시하며 선택 요소의 text는 포함하지 않는다.
4. 각 스타일 변경 섹션을 같은 요소 번호로 연결하고, 실행 가능한 전체 selector는 그
   섹션 바로 아래에 별도 표시한다.
5. 단일·복수 요소, top frame·iframe, 라이브 작성·저장 초안 재열기, 클립보드와 8개
   제출 플랫폼에서 같은 요소 번호·요약·selector를 출력한다.

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

## 사용자 시나리오

### 단일 요소

1. 사용자가 `data-e2e="enrollment-card"` 조상 아래의 `span`을 선택해 스타일을 바꾼다.
2. BugShot은 안정적 앵커를 우선한 CSS selector를 만들고 현재 frame document에서 선택
   요소만 매치하는지 검증한다.
3. 이슈의 재현 환경에는 다음처럼 한 줄이 표시된다. text는 포함하지 않는다.

   ```text
   DOM
   1. Element 1 · [data-e2e="enrollment-card"] › span
   ```

4. 스타일 변경 섹션에는 같은 번호와 실행 가능한 selector가 표시된다.

   ```text
   Style changes — Element 1
   Selector: [data-e2e="enrollment-card"] span.text-semantic-informative-primary-low
   ```

### 복수 요소

1. 사용자가 요소 3개를 차례로 수정해 한 이슈에 담는다.
2. `DOM` 행은 `Element 1`부터 최종 `styleElements` 순서대로 한 항목씩 표시한다.
3. 각 Style changes 섹션은 동일 번호를 사용한다. selector가 길어도 DOM 목록에는 반복하지
   않고 해당 섹션 아래에만 한 번 표시한다.
4. 버퍼 요소를 삭제하거나 현재 요소가 기존 버퍼 요소를 대체하면 번호는 최종 병합 결과를
   기준으로 연속 재부여된다. 저장 데이터의 영구 ID로 사용하지 않는다.

### 안정적 앵커가 없는 요소

1. 선택 요소와 조상에 신뢰 가능한 test attribute·ID가 없고 클래스도 생성값뿐이다.
2. BugShot은 현재처럼 유일한 fallback selector를 생성하되 위치 표현 사용을 허용한다.
3. DOM 요약은 거짓 안정성을 만들지 않고 `Element N · <tag>`만 표시한다.
4. 전체 위치 selector는 Style changes 섹션 아래 `Selector`로 남아 개발자가 필요할 때
   복사할 수 있다.

### 반복 test attribute

1. 목록의 모든 카드가 `data-e2e="enrollment-card"`를 공유한다.
2. 이 속성은 사람이 컴포넌트 종류를 찾는 앵커로는 표시할 수 있지만, 그것만으로 완성
   selector를 확정하지 않는다.
3. 후보 조합이 선택 요소 하나를 가리키지 못하면 추가 안정 후보를 결합하고, 그래도
   불가능하면 위치 표현으로 유일성을 확보한다.

### iframe 요소

1. 사용자가 1-depth iframe 안의 요소를 수정한다.
2. selector 유일성은 해당 frame document 안에서 검증한다.
3. DOM 요약의 iframe 항목에만 frame origin host를 조건부로 표시해 top document의 같은
   selector와 구분한다. Style changes는 같은 Element 번호로 연결하고 origin을 반복하지 않는다.

### 저장 초안과 구버전 초안

1. 사용자가 복수 요소 이슈를 저장하고 나중에 다시 연다.
2. optional 구조화 locator가 저장돼 있으면 라이브 작성과 동일한 요약을 복원한다.
3. locator가 없는 구버전 초안은 `tagName`과 기존 selector로 안전하게 폴백한다. 초안
   마이그레이션이나 데이터 폐기는 하지 않는다.

## 성공 기준

- 예시 DOM에서 전역 유일 조건이 충족되면 `data-e2e` 앵커를 포함한 selector가 클래스+
  `nth-of-type` 후보보다 먼저 선택된다.
- 동적 ID·해시 클래스·상태/순서 `data-*`가 안정 앵커로 승격되지 않는 테스트가 있다.
- 선택 요소에서 편집 가능한 class는 안정 class 후보에 쓰지 않으며, class 삭제·교체 뒤에도
  현재 편집·버퍼 승격·재선택·패널 재오픈·캡처가 같은 요소를 유지하거나 기존 best-effort
  fallback으로 명시적으로 처리된다.
- 생성된 selector는 항상 현재 frame document에서 정확히 선택 요소 하나만 매치한다.
- finder timeout·후보 부재 때 기존 위치 fallback이 유지되고 선택·재선택·편집 적용·캡처가
  동작한다.
- DOM 목록과 Style changes가 단일·복수 요소에서 동일한 `Element N` 번호를 사용한다.
- DOM 목록에는 선택 요소 text와 전체 selector가 없고, 각 Style changes에는 전체 selector가
  정확히 한 번 표시된다.
- Jira, GitHub, Linear, Notion, GitLab, Asana, ClickUp, Slack, 클립보드 HTML/Markdown,
  미리보기, 저장 초안 상세이 동일한 정보를 보존한다.
- top frame의 같은 selector와 iframe selector가 origin 표기로 구분된다.
- picker의 안정 locator 생성은 선택 요소 1개에만 적용되며 DOM Tree의 기존 로딩 비용을
  증가시키지 않는다. locator 탐색은 전체 500ms/2000 path check 상한 안에서 끝난다.
- 새 권한·env·OAuth·외부 API·서버 전송 경로가 없다. 캡처 데이터는 기존처럼 브라우저에서
  사용자가 선택한 플랫폼으로 직접 전송된다.
- 관련 단위 테스트와 `pnpm test`, `pnpm typecheck`가 통과한다. 빌드는 실행하지 않는다.
