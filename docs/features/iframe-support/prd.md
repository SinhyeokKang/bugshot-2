# iframe 내부 요소 편집·캡처 지원

## 배경

현재 picker(`src/content/picker.ts`)는 top frame에만 주입된다(`manifest.config.ts`의 content_scripts[0]에 `all_frames` 미설정). 그래서 iframe 내부 DOM은:

- hover/click으로 **선택 불가** (`document.elementFromPoint`이 cross-document 경계를 못 넘음)
- 스타일 편집·요소 캡처 **불가**

사용자가 iframe 안 요소(임베드 위젯, Stripe 결제 폼, 광고, 문서 뷰어 등)를 클릭하면 `picker.ts:637-645`가 IFRAME 태그를 감지해 `picker.iframeUnsupported`를 발화하고 "iframe 내부 요소는 선택할 수 없습니다" 다이얼로그를 띄운다.

반면 로그 레코더(recorder-bridge / recorders-entry)는 이미 `all_frames: true`로 모든 프레임에 주입돼 cross-origin iframe의 console/network 로그까지 캡처한다. picker만 이 커버리지에서 빠져 있다.

### 우선순위 근거 (Why now)

현 트랙션 병목은 리텐션이 아니라 **유입**이고, 이 기능은 신규 유입 훅이라기보다 **기존 편집 기능의 커버리지 확장**(엣지 케이스)에 가깝다. 명시적 사용자 문의·이탈 사유 같은 수요 증거는 아직 없다. 정당화 근거는 (1) 로그 레코더가 이미 all_frames로 iframe을 커버하는데 picker만 빠져 있어 **일관성 결손**이고, (2) "위젯이 깨졌다" 유형 리포트에서 임베드/결제 iframe이 흔한 대상이라는 정성 판단이다. 정량 신호가 필요하면 **`picker.iframeUnsupported` 발화 빈도 텔레메트리**를 먼저 수집해 우선순위를 재검증한다(현재 미수집). 고복잡도(위험 요소 다수·실기기 수동검증 필수) 작업이므로, 유입 개선 작업과 경합 시 후순위가 될 수 있음을 명시한다.

## 목표

- iframe **내부** DOM 요소를 hover/click으로 **선택**할 수 있다 (same-origin·cross-origin 모두).
- 선택한 iframe 내부 요소의 **스타일을 편집·프리뷰**할 수 있다 (기존 top-frame 요소와 동일한 UX).
- 선택한 iframe 내부 요소를 **요소 캡처(스크린샷)** 할 수 있다 — top-frame 뷰포트 좌표로 정확히 크롭된다(요소 스크린샷 세부 모드 포함).
- iframe 요소와 top-frame 요소를 **한 세션에 섞어서 다중 편집**(bufferedElements)할 수 있다. 다중 편집 리뷰 화면에서 각 요소의 **출처(프레임 origin)를 배지로 구분**한다.

## 비목표 (Non-goals)

- **중첩 iframe(iframe 안의 iframe, 2-depth 이상) 지원**. top → iframe 한 단계(1-depth)만. 중첩 프레임 내부 요소는 기존처럼 선택 불가로 두되, 크래시 없이 graceful하게 거부한다.
- **iframe 요소의 area/freeform 캡처, 30s Replay, 영상 녹화** 지원. 이번 스코프는 element 모드(요소 선택 기반 편집·요소 스크린샷)만. area/freeform 모드는 iframe 위에서도 기존처럼 **top 프레임 좌표 기준**으로 동작한다(iframe 내부 진입 없음 — 아래 엣지 케이스 참조).
- iframe을 **하나의 element로** 선택(현재 거부 동작)을 되살리는 것. 여전히 안쪽으로 진입한다. ("위젯 통째 캡처" 니즈는 area/freeform 모드로 iframe 박스 영역을 드래그해 대체 가능 — element 모드에서 iframe-as-element 선택은 지원하지 않는다.)
- **iframe 내부 요소의 키보드-only 진입**. 최초 iframe 진입은 마우스 hover→click에 의존한다(진입 후 DOM 트리 내비/부모·자식 이동은 지원). top-frame 최초 선택도 마우스라 신규 회귀는 아니나, iframe은 대안 경로가 원천 부재다.
- 샌드박스 iframe(`sandbox` 속성으로 스크립트 차단) 지원. content script 주입이 막히면 기존과 동일하게 거부.

## 사용자 시나리오

### S1. iframe 내부 요소 스타일 편집
1. 사용자가 사이드패널에서 element picker를 시작한다.
2. 마우스를 iframe 위로 옮긴다 → iframe **내부** 요소가 하이라이트된다(iframe 박스 전체가 아니라).
3. 내부 요소를 클릭 → 사이드패널 스타일 에디터에 해당 요소의 스타일이 로드된다.
4. 색상·크기 등을 편집 → iframe 내부 요소에 실시간 프리뷰가 적용된다.
5. 이슈로 등록하면 before/after 이미지와 스타일 diff가 포함된다.

### S2. iframe 내부 요소 캡처
1. 요소 캡처(screenshot) 모드로 picker 시작.
2. iframe 내부 요소를 클릭 → 그 요소만 크롭된 스크린샷이 drafting에 들어간다. 크롭 영역은 iframe의 top-frame 상 위치가 반영돼 정확하다.

### S3. top + iframe 혼합 다중 편집
1. top-frame 요소 A를 편집 → 버퍼에 담고 repick.
2. iframe 내부 요소 B를 편집 → 버퍼에 담는다.
3. 두 요소의 편집이 모두 유지되고 이슈 본문에 각각의 diff로 들어간다.

### 엣지 케이스
- **cross-origin iframe**: content script는 origin 무관하게 주입되므로 선택·편집은 동작. CSS 원문 텍스트 보강은 각 프레임이 자기 문서 기준으로 처리(cross-origin author sheet는 background fetch 경유, 기존 SSRF 가드 재사용).
- **중첩 iframe(2-depth+) 내부 요소**: picker가 top의 1-depth 자식만 핸드오프 대상으로 등록하므로, 중첩 프레임은 registry에 없어 핸드오프 제외 → top blocker가 유지돼 클릭이 iframeUnsupported 거부 경로로 간다(크래시·무피드백 없음).
- **sandbox/CSP로 주입 차단된 iframe**: 그 프레임은 picker가 없어 registry에 등록되지 않음 → top이 blocker를 유지 → 클릭이 top `onClickCommit`에 IFRAME으로 잡혀 iframeUnsupported 거부. (registry 없이 핸드오프하면 blocker가 내려가 클릭이 iframe으로 통과·무피드백되는 함정이 있어, 핸드오프 게이팅이 필수다.)
- **캡처 시점 iframe이 사라짐/네비게이트**: 좌표 해석(postMessage offset) 실패 → 캡처 null, 빈 drafting 진입 금지(기존 폴백 재사용).
- **iframe 내부 스크롤**: 내부 요소가 iframe 스크롤로 이동한 상태에서 캡처 시, inner rect(iframe 뷰포트 기준)는 스크롤을 이미 반영하므로 offset 합산만으로 정확. 단 iframe 자체가 top 뷰포트 밖으로 스크롤된 경우는 캡처 대상 밖(부분 크롭 또는 null).
- **area/freeform 모드 + iframe 위**: iframe 내부로 진입하지 않고 top 좌표 기준 영역 선택. iframe 박스를 포함해 드래그하면 그 화면 영역이 그대로 캡처된다(내부 DOM 접근 아님).
- **여러 iframe이 동시에 존재**: 각 프레임 독립 picker. 마우스가 올라간 프레임만 hover 활성. 선택은 `sender.frameId`로 유일 식별.

## 성공 기준

- same-origin·cross-origin iframe 내부 요소를 hover 하이라이트 → 클릭 선택 → 스타일 편집 프리뷰까지 동작한다. 편집 중인 요소가 iframe 내부이면 리뷰 화면에 프레임 origin 배지로 구분된다.
- iframe 내부 요소 캡처 이미지의 크롭 박스가 **top-frame 요소 캡처와 동일한 픽셀 오차 범위** 내로 실제 요소 위치와 일치한다(기존 element 캡처의 `DEFAULT_MARGIN=24px` 여백 규칙 동일 적용, 좌표 변환으로 인한 추가 오차 0을 목표). 캡처 이미지에 top 프레임 overlay/blocker가 찍히지 않는다.
- **top·iframe에 동일 selector 요소가 있어도** 각각 올바른 프레임에 편집이 적용·유지·재적용된다(다중 편집·재바인딩·재선택 전 구간).
- top-frame 요소 선택·편집·캡처 동작에 **회귀가 없다** (전체 뷰포트 blocker, 다중 편집, 재바인딩, area/freeform 캡처, 요소 스크린샷 모드, 30s replay).
- iframe에서 ESC·취소 시 top 프레임 picker까지 함께 정리된다(유령 picker 없음).
- 중첩(2-depth)·sandbox iframe 클릭 시 거부 다이얼로그가 뜨고, 콘솔 에러 누적·크래시·의도치 않은 iframe 내부 상호작용이 없다.
