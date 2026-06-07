# 요소 캡처 (Element Screenshot) — 스크린샷 모드의 세부 모드

## 배경

지금까지 element 모드는 "요소를 골라 스타일을 수정하지 않아도(diff 없이) drafting으로 넘어가 그 요소를 스크린샷처럼 미디어 섹션에 담는" no-diff 흐름을 겸했다. 이 겸용이 `isElementNoDiff` 동적 모드 강등을 코드 곳곳에 퍼뜨려, [[multi-element-buffer]](복수 element 스타일 변경) 도입을 복잡하게 만든다.

해법은 **"요소를 골라 캡처"하는 흐름을 스크린샷 모드의 세부 모드로 편입**하는 것이다. picker(요소 선택)는 살리되, 선택 완료 시 styling을 건너뛰고 **바로 drafting**으로 요소 크롭 스크린샷을 넘긴다. 결정적으로, **이슈 구성 정책(로그·마크다운·본문 빌더·IssueRecord·captureFiles)을 전부 screenshot 모드 생태계에 종속**시킨다 — captureMode를 `"screenshot"`으로 재사용해 분기를 늘리지 않는다. 이로써 element 모드는 "스타일 수정(diff) 전용"으로 깨끗해지고, 요소 단위 캡처(범위 area select로는 안 되는 정확한 요소 크롭)는 살아남으며, 유지보수가 간단해진다.

함께 idle 진입 화면의 캡처 모드 버튼 위계를 정리한다.

## 모드 아키텍처

크게 **3개 모드**, 그 아래 세부 모드:

```
1. 엘리먼트 모드 (captureMode: "element")    — 스타일 수정. picking → styling → drafting.
                                              → multi-element-buffer 대상.
2. 스크린샷 모드 (captureMode: "screenshot") — 이미지 캡처. 이슈 구성 정책(로그/MD/빌더/IssueRecord/captureFiles)의 단일 기준.
   2a. 범위 캡처   — area select로 영역 캡처 (기존)
   2b. 요소 캡처   — element picker로 요소 선택 → 요소 크롭 캡처 (신설, 본 문서)
3. 녹화 모드 (captureMode: "video")           — 영상.
   3a. 수동 녹화   — (기존)
   3b. 30초 리플레이 — (기존)
```

- 세부 모드는 **진입 방식 + 캡처 소스**만 다르고, 결과물과 이슈 구성 정책은 상위 모드에 종속된다.
- 요소 캡처는 `captureMode: "screenshot"`을 그대로 쓴다. 새 captureMode 추가 없음 → 로그 게이팅·본문 빌더·IssueRecord·blob 키가 자동으로 screenshot 정책.
- 자유양식(freeform)은 이 분류와 별개의 텍스트 전용 진입으로 그대로 유지.

## 상호보완 — multi-element-buffer의 선행 과제

이 기능은 **[[multi-element-buffer]]의 선행 과제**다.
- multi-element-buffer는 "element 모드 = diff 필수"로 가며 no-diff 흐름을 폐지한다.
- 폐지된 no-diff 유스케이스(요소 골라 캡처)의 **대체재가 이 요소 캡처(스크린샷 세부 모드)**다.
- 따라서 이 문서를 **먼저 구현**해야 multi-element-buffer가 no-diff를 안전하게 떼어낸다. multi-element-buffer prd/design의 "no-diff 폐지" 항목이 이 모드를 대체재로 명시한다(양방향 참조).

## 목표

- **요소 캡처 세부 모드 신설**: idle "요소 캡처" 선택 → picker로 요소 선택 → **styling 없이 drafting** 진입. 캡처 결과는 `captureMode: "screenshot"`의 요소 크롭 이미지.
- **screenshot 생태계 종속**: 로그(`supportsConsoleNetworkLog`)·마크다운/본문 빌더·captureFiles·IssueRecord·blob 키를 screenshot과 동일하게 — 별도 분기 없음.
- **DOM selector를 사용자가 보는 모든 면에 일관 노출**: ① 등록 이슈 본문 Environment의 `- **DOM**: {selector}` 줄, ② `buildMetaComment`의 AI 메타(`<!-- bugshot-meta-for-ai -->`), ③ drafting 미리보기 Environment, ④ PreviewPanel "마크다운 복사" 결과물, ⑤ 로그 뷰어 Report 탭 프리뷰, ⑥ AI 초안 생성 입력. 제출본·미리보기·복사·Report·AI가 같은 selector로 일치한다.
  - 메타: `buildMetaComment`가 `captureMode !== "freeform"`이면 `meta.selector`를 넣으므로 `ctx.selector`만 채우면 자동.
  - 본문 env: 빌더가 두 갈래다. Group A(buildIssueMarkdown md/html·GitHub·GitLab·Asana)는 `ctx.selector` 기반이라 조건만 완화하면 되고, Group B(Linear·Notion·Adf)는 DOM 줄을 `formatElementName(tagName)`로 만들고 screenshot을 게이트로 막으므로 **selector 기반으로 전환**해 6개 빌더 + 메타가 동일한 selector 문자열로 일관. 범위 캡처는 selector가 `""`라 미표시 — 자연 분기. (상세: design.md)
- **annotation 지원**: 요소 크롭 이미지도 screenshot과 동일하게 주석 가능. `captureElementSnapshot`의 크롭 결과를 `screenshotRaw`에 세팅하면 `DraftingPanel`의 `AnnotationOverlay`(→ `onAnnotated` → `screenshotAnnotated`)가 그대로 동작 — 별도 작업 없음.
- **idle 캡처 모드 위계 재구성**: 진입 버튼 정리(아래 UI).
- element 모드(스타일 수정)는 변경 없음 — 독립.

## 비목표 (Non-goals)

- **스타일 수정 없음**: 요소 캡처는 styleEdits·diff 테이블을 다루지 않는다. before/after도 없다(단일 스냅샷).
- **복수 요소 없음**: 단일 요소 캡처.
- **새 captureMode 없음**: `"element-screenshot"` 같은 별도 모드를 만들지 않는다(screenshot 재사용이 핵심).
- 기존 범위 캡처·녹화·리플레이·자유양식 동작 변경 없음(라벨/배치만 조정).

## 사용자 시나리오

### 주요 플로우
1. idle에서 **"요소 캡처"** 클릭 → picker 모드 진입(`picking`, captureMode `"screenshot"`).
2. 페이지에서 요소 클릭 선택.
3. **styling을 건너뛰고 바로 drafting** — 선택 즉시 요소 크롭 스냅샷 캡처(screenshot 이미지로 세팅) + selector 확보.
4. drafting에서 제목·본문 작성. 미리보기는 screenshot 정책(미디어 섹션 + 이미지) + Environment에 DOM selector.
5. 이슈 등록 → screenshot과 동일한 본문 골격 + DOM 줄.

### idle UI 재구성
```
[ 요소 스타일 편집 ]               ← col-span-2, 주력(primary). 엘리먼트 모드(스타일 수정)
[ 요소 캡처 ] [ 범위 캡처 ]         ← 스크린샷 모드의 2세부: 요소 캡처(신설) / 범위 캡처(기존 "화면 캡처" 라벨 변경)
[ 화면 녹화 ] [ 30초 리플레이 ]     ← 녹화 모드의 2세부 ("영상 녹화"→"화면 녹화")
( footer: 이슈 작성 — 자유양식 )    ← 유지
```
라벨 세트: 모드를 동사로 구분(편집/캡처/녹화)해 위계를 드러냄.

### 엣지 케이스
- **요소 선택 취소**: picker 취소 → idle 복귀(기존 picking 취소).
- **미지원 페이지/iframe**: 기존 element picker 제약 그대로.
- **drafting에서 뒤로**: styling 단계가 없으므로 스타일 모드의 backToStyling을 쓰지 않는다. **범위 캡처(area)의 drafting 뒤로 동작과 동일**하게 처리(둘 다 styling 없는 screenshot 모드).
- **요소 크롭 캡처 실패**: `captureElementSnapshot`이 null 반환(권한 만료·캡처 실패) 시 drafting 진입하지 않고 idle 복귀/에러 안내(빈 이미지로 진입 금지).

## 성공 기준

- idle "요소 캡처" → 요소 선택 → styling 없이 drafting 진입.
- 등록 이슈가 **screenshot과 동일한 구성**(미디어 섹션·로그·IssueRecord·blob 키)으로 나오며, 6개 플랫폼 전부 Environment에 동일한 DOM selector 줄 + AI 메타에 selector가 추가된다.
- DOM selector가 drafting 미리보기·마크다운 복사·로그 뷰어 Report 탭·AI 초안 입력에서도 동일하게 노출된다(제출본과 일치).
- 요소 크롭 이미지를 drafting에서 annotation(주석)할 수 있다(screenshot과 동일 UI).
- element 모드(스타일 수정)·기존 범위 캡처·녹화·리플레이 회귀 없음.
- captureMode union에 새 값이 추가되지 않음(screenshot 재사용 확인).
- idle 버튼이 재구성된 배치/라벨로 표시되고 각 버튼이 올바른 모드로 진입한다.
- multi-element-buffer의 no-diff 폐지 대체재로 동작(요소 골라 캡처 가능).
