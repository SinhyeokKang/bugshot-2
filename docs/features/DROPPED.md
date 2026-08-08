# 드랍한 기획 (Dropped specs)

기획까지 갔다가 **안 하기로 한** 것들의 사유 기록. 문서를 그냥 지우면 몇 달 뒤 같은 아이디어가 같은 근거로 다시 기획되고, 그때 이미 한 번 계산한 비용을 다시 계산하게 된다. 이 파일은 그 재계산을 막는 용도다.

각 항목은 **왜 안 하는지**와 **무엇이 바뀌면 다시 볼 만한지**를 적는다. "지금은 안 한다"와 "영원히 안 한다"는 다르므로 구분해서 쓴다.

---

## 2026-08-09 — 피커 조준 UX (`picker-aim-ux`)

키보드 화살표로 DOM을 훑고(G1), Space로 마우스 추적을 얼리고(G2), 인스펙터 카드가 실제 렌더 폰트를 보여주고(G3), 오버레이 호스트가 제거되면 자가치유하는(G4) 네 갈래 기획. `/feature-review`의 4인 검수(CPO·CDO·CTO·QA)에서 갈래마다 독립적으로 무너졌다.

**G1·G2·G5 — 전제가 코드로 반증됐다.** `startPicker`(`src/sidepanel/picker-control.ts`) 전 경로에 **포커스를 페이지로 넘기는 코드가 없다.** 사용자는 사이드패널 버튼을 눌러 picking을 시작하므로 포커스는 사이드패널 문서에 남고, `picker.ts`의 `window.addEventListener("keydown", …)`는 발화하지 않는다. 마우스 이동은 포커스를 옮기지 않고, 페이지를 클릭하면 그 순간 확정돼 hover 모드가 끝난다 — **"조준 단계를 유지한 채 페이지에 포커스를 주는" 조작이 제품에 존재하지 않는다.** design.md에서 "포커스"라는 단어가 나오는 유일한 줄은 iframe 경계 항목이었다.

**G4 — 사정거리가 이름값보다 좁다.** 실측 사례가 0건이고(POSTMORTEM에도 PRD에도 인용 없음), 문서가 약속한 "SPA 라우트 전환"은 실제로 커버되지 않는다. React/Vue/Next의 라우트 전환은 body 안 루트 div의 자식만 바꿔 `<html>` 직속인 오버레이 호스트를 건드리지 않고, `documentElement` 자체가 교체되면 observer는 detach된 옛 노드에 붙어 발화조차 안 한다. 실제로 잡히는 건 `documentElement.innerHTML` 대입과 호스트 직접 제거뿐이다. 여기에 🔴 2건(치유가 `area-select` 세션을 복구 불가능하게 파괴 / `picker.cancelled`가 `handleClear`의 세션 초기화 뒤라 dead code)과 🟡 다수(healCount 누적↔연속 모순, iframe별 독립 카운터 탓에 광고 iframe 하나가 top 세션을 취소, 캡처 중 치유가 hover-shield 상태 유실)가 전부 이 갈래에서 나왔다.

**G3 — 브라우저가 이미 한다.** Chrome DevTools의 Computed 패널에 **"Rendered Fonts"** 섹션이 있고 정확히 같은 정보를 준다. 드랍 기준 1번에 걸린다. 네 갈래 중 설계 품질은 가장 좋았지만(판정을 `isRendered`로 주입해 순수 함수로 분리), 그것만 남기면 기획 하나를 유지할 이유가 되지 못한다.

**부수적으로 — 묶음 기획 생존율이 0/3이 됐다.** `regression-net`·`css-cascade-fidelity`에 이어 셋째다. 네 갈래가 서로 호출하지 않았고, 태스크 5개로 최소인데 design.md가 357줄이었다. 문서가 큰 이유가 깊이가 아니라 갈래 수일 때가 신호다.

**다시 볼 조건**: G1·G2는 "picking 중 페이지에 포커스를 주는 방법"이 먼저 정해져야 성립한다. 그 자체가 별도 결정이고, 확장이 사용자 포커스를 빼앗는 동작이라 before/after 스냅샷 신뢰와 충돌할 여지가 있다. G3는 DevTools로 안 되는 구체적 시나리오가 나올 때.

### 이 검수가 발굴한, 기획과 무관하게 **남아 있는 사실 2건**

기획은 접지만 아래는 실제 코드의 상태다. 묻어두지 않는다.

1. **페이지 쪽 `Escape`가 사문(死文)일 가능성이 높다.** `picker.ts`의 `onKeyDown`은 페이지 `window`에 붙는데 위 이유로 포커스가 페이지에 없다. e2e의 Escape 단언 21건 중 20건은 `panel.keyboard.press`(패널 문맥)이고, 페이지 문맥 단언은 `pickElement`가 부르는 `fixture.bringToFront()` 덕에 통과한다 — **자동화가 만든 포커스 전환이라 제품 동작이 아니다**(헬퍼 주석이 그렇게 적어놨다). 즉 "페이지에서 Escape로 picking을 취소한다"가 실사용에서 동작하는지 **검증된 적이 없다.** 패널의 `[취소]` 버튼이라는 대체 경로가 있어 가려져 있었다. 확인해서 사실이면 별도 픽스 대상이다.
2. **`parseFirstFontFamily`(`src/content/css-resolve.ts`)가 `split(",")[0]`이라 따옴표 안 콤마에서 틀린 답을 준다.** `"Font, With Comma", serif`에서 `"Font`를 돌려준다. 인스펙터 카드의 `font` 행에 그대로 나간다. 기획과 무관한 독립 버그다.

**키보드 e2e를 앞으로 쓸 때의 함정**: `pickElement` 헬퍼가 `fixture.bringToFront()`를 부르므로 **e2e에서만 페이지가 키보드 포커스를 갖는다.** 키 입력에 의존하는 spec은 이 환경에서 green이어도 실사용을 보장하지 못한다.

---

## 2026-08-08 — 디바이스 뷰포트 (구현까지 갔다가 드랍)

**유일하게 코드까지 만들었다가 드랍한 항목이다.** 전체 이력은 `archive/device-viewport` 브랜치, 회고는 `docs/POSTMORTEM.md`의 2026-08-08 항목.

페이지에 same-origin iframe 래퍼를 심어 390/768/1024px 폭으로 재로드하는 기능이었다. **Chrome DevTools의 디바이스 툴바가 실제 뷰포트를 리사이즈하고 BugShot이 그 안에서 정상 동작한다**는 실측이 결정타였다 — 브라우저가 이미 하는 일에 in-page 래퍼, background 판정 상태머신, cross-origin handoff 기제, picker·로그·캡처 전 경로의 분기를 지불하고 있었다. 10라운드 리뷰에서 🔴 19건이 나왔고 라운드 3~10의 심각은 **예외 없이** 직전 라운드 픽스가 원인이었다(8/8).

부차 사유: github·naver가 프레임 삽입을 거부했고(`net::ERR_BLOCKED_BY_RESPONSE`), 뚫으려면 사용자가 캡처하는 바로 그 문서의 CSP를 `declarativeNetRequest`로 벗겨야 했다.

**다시 볼 조건**: DevTools 디바이스 모드로 안 되는 구체적 시나리오가 나올 때. 그때도 in-page 래퍼가 아니라 다른 수단부터 검토한다.

---

## 2026-08-09 — 자동 버그 감지 트리거 (`anomaly-capture-trigger`)

uncaught error·unhandled rejection·5xx·네트워크 실패를 감지해 캡처 진입 화면에 배지를 띄우고, 리플레이를 자동으로 잘라 AI 초안까지 실행하려던 기획.

**이름이 약속하는 범위와 실제 작동 창이 크게 어긋난다.** PRD 자신이 적어놨듯 구제 대상은 "BugShot을 안 켠 사람"이 아니라 **"켜두고 Debug>이슈 화면에 머물러 있는데 캡처 버튼을 안 누른 사람"** 이다. 배지는 `EmptyState`에만 있고, console/network 서브탭을 보는 동안엔 `IssueTab`이 언마운트돼 감지가 멈추며, 5xx 갱신은 `activeMainTab === "debug" && sub === "issue"`에서만 도는 1500ms 강제 sync에 의존한다. 그 창을 넓히려면 배선이 여러 진입점으로 퍼지는데, 그게 디바이스 뷰포트가 무너진 방식과 같다.

여기에 **`replayEnabled` 기본값을 `false → true`로 뒤집는 것**이 목표에 포함돼 있었다. 저장소 최초의 기본값 뒤집기이고, 30s Replay는 privacy 문서 미갱신으로 웹스토어 심사에서 한 번 탈락한 바로 그 기능이다.

**다시 볼 조건**: 알림 표면이 `EmptyState`·`IssueTab` 마운트에 묶이지 않는 구조가 먼저 생길 때(예: 툴바 배지·`chrome.action` 배지). 감지 로직 자체는 이미 수집 중인 신호를 읽는 것뿐이라 싸다 — 비싼 건 **알림을 어디에 띄우느냐**다. 순서를 뒤집어 표면부터 풀면 그때 다시 볼 만하다.

---

## 2026-08-09 — UA 기본값 기준선 (`ua-default-baseline`)

숨김 `about:blank` iframe에 같은 태그의 빈 요소를 넣어 순수 UA 기본 스타일을 뜨고, 선택 요소의 computed와 차분해 "저자가 손댄 것"만 남기려던 기획. 손으로 적은 `KNOWN_DEFAULTS`(58개 prop) 테이블을 대체하는 것이 목적이었다.

**두 가지가 걸린다.**

1. **디바이스 뷰포트와 구조가 같다.** 페이지에 iframe을 심고, 그것이 스크린샷·스크롤 캡처·로그 수집·DOM 트리 네비게이터에 영향을 주지 않도록 방어해야 한다(원 PRD의 G4). 방금 드랍한 기능이 정확히 그 방어에서 반복적으로 샜다.
2. **문제를 없애는 게 아니라 옮긴다.** PRD의 "사정거리" 절이 직접 적었다 — 실효 범위는 `INTERESTING_PROPS` ∩ 비상속 ∩ 레이아웃 비의존 ∩ `KNOWN_DEFAULTS` 미등록의 교집합이고, **"손으로 채워야 할 목록이 사라지는 게 아니라 `KNOWN_DEFAULTS` → `INTERESTING_PROPS` 하나로 줄어든다."** 인용된 회고 2건 중 1건만 구조로 풀리고 나머지(border-color)는 기존 가드 `isInactiveBorderColor`가 그대로 지킨다.

**대신 할 것**: `KNOWN_DEFAULTS`에 `transition-*`·`animation-*` 같은 shorthand longhand 계열을 손으로 채운다. POSTMORTEM 2026-06-29가 터진 자리가 정확히 거기이고, 위 위험을 지는 것보다 싸다.

**다시 볼 조건**: 페이지에 노드를 심지 않고 UA 기본값을 얻는 수단이 생길 때. 그런 API가 없는 한 비용 구조는 안 바뀐다.

---

## 2026-08-09 — 회귀 검출 그물 (`regression-net`)

복제본 레지스트리 / `ASSUMPTIONS.md` 전제 큐 / dev 전용 불변식 배너 / e2e 위반 승격 / CSSOM 코퍼스 대조 — 다섯 목표를 한 문서에 담고 있었다.

**하나의 기능이 아니라 다섯 개 프로젝트다.** 서로 독립이고 각각이 별개 기획 규모인데, 전부 메타 도구라 사용자 가치는 0이고 개발 효율 투자다. 그리고 **그물을 짓는 일인데 그 그물을 검증할 그물이 없다** — 디바이스 뷰포트에서 배운 것이 "검증 수단 없이 크게 지으면 자기 픽스가 다음 결함을 만든다"이므로, 이 형태는 특히 위험하다.

**다시 볼 조건**: 목표 1(복제본 대조 테스트)만 떼어 별도 기획으로. `복제본` 계열이 회고 23건(29%)으로 실증된 반복 함정이고, 구현이 `pnpm test` 안에서 닫혀 검증 가능하다는 점에서 다섯 중 유일하게 조건을 만족한다. 나머지 넷, 특히 dev 배너와 CSSOM 코퍼스는 비용이 가장 크고 이득이 가장 불확실하다.

---

## 2026-08-09 — CSS 캐스케이드 충실도 (`css-cascade-fidelity`)

cross-origin author 규칙을 `CSSStyleRule`로 수렴시켜 same-origin과 같은 인덱스·같은 판정 함수를 태우려던 기획(G1). 조건 평가(G2)·정상 캐스케이드(G3)·uncertain 축소(G4)가 딸려 있었다.

**CLAUDE.md가 "회고 1위 영역(13건/16%)"이라 경고한 자리이고, 그 영역의 검증 수단은 e2e 하나뿐이다.** 브라우저 실동작에 걸려 유닛으로 고정이 안 된다. 거기서 G1은 수집 경로 전면 재작성이라 위험 프로필이 디바이스 뷰포트와 같다 — 검증이 약한 영역을, 크게, 한 번에.

**대신 할 것**: **G2만 별도로 떼어낸다.** 지금 데스크톱에서 cross-origin 시트의 `@media (max-width: 400px)` 규칙이 섞여 들어오는 건 명백한 오답이고, `parseRulesFrom`(`css-source-cache.ts:762`)에 조건 평가를 붙이는 국소 수정으로 잡힌다. 이건 별도 기획으로 다시 쓸 값어치가 있다.

**다시 볼 조건**: G2가 먼저 안착한 뒤, cross-origin specificity 역전이 실사용에서 실제로 관측될 때. 지금은 이론적 오답이고 실측 사례가 없다.

---

## 2026-08-09 — CSS Inspector 백로그 (`css-inspector-backlog.md`)

Hoverify v4.8.6 분해 조사에서 스코프 밖으로 뺀 항목들을 모아둔 문서. 이 문서가 참조하던 세 기획 중 둘(`css-cascade-fidelity`·`ua-default-baseline`)이 위에서 드랍됐고, 핵심 항목 B1(상태 pseudo 스타일)이 `css-cascade-fidelity`에 의존한다고 스스로 기록하고 있어 전제가 무너졌다.

**조사 결과 중 값어치가 있어 여기 압축해 남긴다:**

- **`:hover` 규칙은 오늘 100% 누락된다.** `getMatchingRules`가 `el.matches(rule.selectorText)`로 판정하는데 `.btn:hover`는 마우스가 실제로 그 위에 있어야 true이고, picking 중엔 blocker가 hit target이며 hover-shield가 hover를 의도적으로 억제한다(`overlay.ts:88-102`).
- **수집 방법은 확정돼 있다**: 셀렉터에서 상태 pseudo만 벗겨 `.btn:hover` → `el.matches(".btn")`으로 판정하고 specificity는 원본 셀렉터로 계산한다. `debugger` 권한도, 클래스 치환도, 규칙 재삽입도 불필요하다.
- **라이브러리를 새로 넣을 필요 없다** — `css-source-cache.ts`의 `lastCompound`·`splitSelectorList`로 의존성 0의 depth-aware 제거가 된다.
- **Hoverify의 버그를 베끼지 말 것**: 그쪽 pseudo 추출기는 마지막 compound만 봐서 `.card:hover .title`이 hover 규칙으로 안 잡힌다. "셀렉터 어느 compound에든 상태 pseudo가 있으면 상태 규칙"이 옳다.
- **hover 상태 스크린샷은 어느 설계로도 불가**하다. `:hover` 강제는 CDP `forceElementState`뿐이고 `debugger` 권한이 필요하다.

**다시 볼 조건**: 상태 pseudo 스타일을 독립 기획으로 다룰 때. cross-origin 시트의 hover까지 보려면 CSSOM 통일이 선행이지만, **same-origin 한정으로 좁히면 그 의존 없이도 성립한다** — 그 범위로 다시 쓰는 것이 현실적이다.
