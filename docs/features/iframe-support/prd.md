# iframe 내부 요소 편집·캡처 지원

## 배경

현재 picker(`src/content/picker.ts`)는 top frame에만 주입된다(`manifest.config.ts`의 content_scripts[0]에 `all_frames` 미설정). 그래서 iframe 내부 DOM은:

- hover/click으로 **선택 불가** (`document.elementFromPoint`이 cross-document 경계를 못 넘음)
- 스타일 편집·요소 캡처 **불가**

사용자가 iframe 안 요소(임베드 위젯, Stripe 결제 폼, 광고, 문서 뷰어 등)를 클릭하면 `picker.ts:637-645`가 IFRAME 태그를 감지해 `picker.iframeUnsupported`를 발화하고 "iframe 내부 요소는 선택할 수 없습니다" 다이얼로그를 띄운다.

반면 로그 레코더(recorder-bridge / recorders-entry)는 이미 `all_frames: true`로 모든 프레임에 주입돼 cross-origin iframe의 console/network 로그까지 캡처한다. picker만 이 커버리지에서 빠져 있다.

## 목표

- iframe **내부** DOM 요소를 hover/click으로 **선택**할 수 있다 (same-origin·cross-origin 모두).
- 선택한 iframe 내부 요소의 **스타일을 편집·프리뷰**할 수 있다 (기존 top-frame 요소와 동일한 UX).
- 선택한 iframe 내부 요소를 **요소 캡처(스크린샷)** 할 수 있다 — top-frame 뷰포트 좌표로 정확히 크롭된다.
- iframe 요소와 top-frame 요소를 **한 세션에 섞어서 다중 편집**(bufferedElements)할 수 있다.

## 비목표 (Non-goals)

- **중첩 iframe(iframe 안의 iframe, 2-depth 이상) 지원**. top → iframe 한 단계(1-depth)만. 중첩 프레임 내부 요소는 기존처럼 선택 불가로 두되, 크래시 없이 graceful하게 거부한다.
- **iframe 요소의 area/freeform 캡처, 30s Replay, 영상 녹화** 지원. 이번 스코프는 element 모드(요소 선택 기반 편집·요소 스크린샷)만.
- iframe을 **하나의 element로** 선택(현재 거부 동작)을 되살리는 것. 여전히 안쪽으로 진입한다.
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
- **중첩 iframe 내부 요소**: 선택 시도 시 크래시 없이 무시하거나 안내(기존 iframeUnsupported 다이얼로그 재사용).
- **sandbox/CSP로 주입 차단된 iframe**: 그 프레임은 picker가 없으므로 top frame이 iframe 박스로만 인식 → 기존 iframeUnsupported 경로.
- **캡처 시점 iframe이 사라짐/네비게이트**: 좌표 해석 실패 → 캡처 null, 빈 drafting 진입 금지(기존 폴백 재사용).

## 성공 기준

- same-origin·cross-origin iframe 내부 요소를 hover 하이라이트 → 클릭 선택 → 스타일 편집 프리뷰까지 top-frame 요소와 구분 없이 동작한다.
- iframe 내부 요소 캡처 이미지의 크롭 박스가 실제 요소 위치와 ±margin 내로 일치한다(top-frame 요소 캡처와 동일한 정확도).
- top-frame 요소 선택·편집·캡처 동작에 **회귀가 없다** (전체 뷰포트 blocker, 다중 편집, 재바인딩, area/freeform 캡처).
- 중첩 iframe·sandbox iframe에서 콘솔 에러 누적이나 크래시가 없다.
