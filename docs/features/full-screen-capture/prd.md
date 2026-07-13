# 전체 화면 캡처 (Full Screen Capture)

## 배경

스크린샷 모드는 현재 **영역 드래그 하나뿐**이다. 사이드패널에서 [스크린샷]을 누르면 `capturing` phase로 들어가고, 페이지에 크로스헤어 blocker가 깔리며, 사용자는 반드시 드래그해서 사각형을 그려야 한다(`area-select.ts`가 10px 미만 드래그는 무시).

하지만 실제 버그 리포트에서 "보이는 화면 전체"를 그대로 담고 싶은 경우가 잦다. 지금은 뷰포트 끝에서 끝까지 정확히 드래그해야 하는데, 가장자리 픽셀을 놓치기 쉽고 매번 손이 많이 간다.

진입(idle) 화면에 캡처 모드 버튼을 하나 더 늘리는 건 부담스럽다 — 이미 element / screenshot / element-shot / video / screen / replay 버튼이 경합한다.

## 목표

- 스크린샷 모드의 `capturing` 단계 사이드패널에서 **[전체 화면 캡처]** 버튼 한 번으로 현재 뷰포트 전체를 캡처하고 `drafting`으로 진입한다.
- idle(진입) 화면의 버튼 개수는 **그대로 유지**한다.
- 캡처 결과물에 picker 오버레이(dim 4분면·선택 사각형·크기 라벨·크로스헤어 blocker)가 **찍히지 않는다**.
- 브라우저 줌이 100%가 아니어도 캡처 가장자리에 빈 픽셀이 생기지 않는다.

## 비목표 (Non-goals)

- **스크롤 포함 페이지 전체 캡처(full-page stitching)** — 이번 스코프는 "보이는 뷰포트"뿐이다. 여러 번 스크롤·캡처·합성하는 로직은 만들지 않는다.
- **인라인 영역 캡처(drafting 중 본문 이미지 삽입, `DraftingPanel.tsx:349-368`)에 같은 버튼 추가** — 같은 `picker.startAreaSelect` 경로를 쓰지만 UI는 별도 컴포넌트다. 1차 제외.
- element 모드 / element-shot / video / freeform 흐름 변경.
- 페이지 오버레이 안에 in-page 버튼·힌트 텍스트 추가.
- 캡처 단축키 부활.

## 사용자 시나리오

### 주 플로우
1. 사이드패널 진입 화면에서 [스크린샷] 클릭 → `phase: capturing`, 페이지에 크로스헤어 blocker.
2. 사이드패널에는 "캡처 영역을 선택하세요" 안내 + **[취소] [전체 화면 캡처]** 두 버튼이 보인다.
3. 사용자가 [전체 화면 캡처] 클릭.
4. 페이지의 picker 오버레이가 즉시 걷히고, 보이는 뷰포트 전체가 캡처된다.
5. `phase: drafting` — 캡처 이미지가 어노테이션 가능한 상태로 초안 화면에 올라온다.

기존 드래그 플로우(2에서 페이지를 드래그)는 **그대로 유지**된다. 버튼은 대안 경로다.

### 엣지 케이스
- **드래그 완료 직후 버튼 클릭(레이스)**: 이미 `picker.areaSelected`가 발화해 drafting으로 넘어가면 `CapturingState`가 언마운트되어 버튼이 사라진다. 메시지가 늦게 도착해도 content script의 area handle이 이미 null이라 no-op.
- **캡처 실패(activeTab 만료 / captureVisibleTab rate-limit)**: 기존 드래그 경로와 동일하게 `captureAndCrop`이 권한 만료 안내를 띄우거나 `reset()`으로 idle 복귀한다.
- **브라우저 줌 ≠ 100%**: 뷰포트 CSS px × DPR로 계산한 크롭 rect가 캡처 이미지 경계를 넘을 수 있다 → 크롭 rect를 이미지 경계로 클램프해 빈 픽셀을 막는다.
- **Esc**: 기존과 동일하게 area-select를 취소한다(버튼 유무와 무관).
- **미지원 페이지 / content script 미주입**: `startAreaCapture`가 이미 `ensureSupportedTab`으로 걸러 `capturing`에 진입하지 않는다. 버튼이 노출될 일이 없다.

## 성공 기준

- [ ] 스크린샷 모드 capturing 단계에서 [취소] 우측에 [전체 화면 캡처] 버튼이 보인다 (ko "전체 화면 캡처" / en "Capture screen").
- [ ] 버튼 클릭 → 드래그 없이 drafting 진입, 캡처 이미지가 뷰포트 전체다.
- [ ] 캡처 이미지에 dim·선택 사각형·크기 라벨·크로스헤어가 없다.
- [ ] 줌 80% / 100% / 150%에서 캡처 가장자리에 빈(투명) 픽셀이 없다.
- [ ] idle 화면 버튼 구성이 변하지 않았다.
- [ ] 기존 드래그 영역 캡처 e2e(`e2e/capture.spec.ts`)가 계속 통과한다.
