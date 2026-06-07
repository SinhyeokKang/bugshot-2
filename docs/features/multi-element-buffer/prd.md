# 복수 Element 스타일 변경 버퍼 (Multi-Element Buffer)

## 배경

현재 element 모드는 한 번에 **하나의 element**만 다룬다. 스타일링 패널에서 A 요소를 수정하다가 우상단 "다시 선택"(RepickButton)으로 B 요소를 고르면, A의 스타일 변경사항(`styleEdits`)과 before/after 스냅샷이 모두 초기화된다(`onElementSelected`가 `styleEdits`를 빈 값으로 리셋).

하지만 실제 버그 리포트는 "버튼 색 + 그 옆 라벨 정렬 + 카드 패딩"처럼 **여러 요소의 변경을 하나의 이슈로 묶고 싶은** 경우가 많다. 지금은 요소마다 별도 이슈를 만들거나, 한 요소만 정식으로 담고 나머지는 본문에 수기로 적어야 한다.

또한 이번 작업에서 **element 모드의 "diff 없이 drafting" 경로(no-diff 폴백)를 폐지**한다. 기존엔 요소를 고르고 스타일을 안 바꿔도 drafting으로 넘어가 그 요소를 screenshot처럼 미디어 섹션에 담았는데, 이는 캡처 기능과 중복되고 element 모드 전반(`isElementNoDiff` 동적 강등)에 분기를 퍼뜨려 복수 element 도입을 복잡하게 만든다. **element 모드 = 스타일 변경(diff) 전용**으로 책임을 가른다.

> **선행 의존**: 폐지되는 no-diff 유스케이스(요소 골라 캡처)의 대체재는 **[[element-screenshot]](요소 캡처 — screenshot 모드의 세부 모드)** 이며, 이 기능의 **선행 과제**다. element-screenshot을 먼저 구현해야 no-diff를 안전하게 떼어낸다. 양 문서는 상호 참조한다.

## 목표

- **element 모드 diff 필수화**: 스타일 변경(diff)이 있는 element만 drafting으로 넘어간다. diff가 없으면 진입을 막고 **요소 캡처 모드([[element-screenshot]])**를 안내한다. → element 모드의 `isElementNoDiff` 동적 강등(element↔screenshot) 분기를 코드 전반에서 제거.
- **복수 element 버퍼**: A 요소를 수정한 뒤 "다시 선택"으로 B 요소로 이동할 때, A의 스타일 diff와 before/after 스냅샷을 버퍼에 보존한다.
- **누적 프리뷰**: 버퍼 초기화(이슈 작성 취소/제출 완료/reset) 전까지, 버퍼에 담긴 모든 요소의 스타일 변경을 실제 페이지(MAIN world DOM)에서도 동시에 계속 보이게 유지한다.
- **하나의 이슈로 직렬화**: 이슈 등록 시 버퍼의 모든 요소 + 현재 요소의 변경을 element별 섹션으로 직렬화한다(6개 플랫폼 전부).
- **세션 영속화**: 버퍼(데이터)는 기존 `selection`과 동일하게 세션 영속화되어 사이드패널을 닫았다 열어도 복원된다.

## 비목표 (Non-goals)

- **버퍼 관리 UI 없음**: 담긴 요소 목록·재편집·개별 삭제 UI는 제외. 이번엔 완전 헤드리스(상태/직렬화 로직 + 최소 진입 가드만). 목록 UI는 후속.
- **draft 영속/재편집 미지원**: 이슈를 draft로 저장한 뒤 *이슈 목록 → DraftDetailDialog*에서 다시 열어 편집/재제출하는 경로는 **단일 element만 복원**(기존 동작 유지). 복수 element는 첫 제출 세션 안에서만 산다. `IssueRecord` 스키마·마이그레이션·blob 키 변경 없음.
- element 모드 외(screenshot/video/freeform)는 무관 — 변경 없음. **diff 없는 요소를 캡처하고 싶으면 요소 캡처 모드([[element-screenshot]])**가 대체한다.
- 버퍼 개수 상한·경고 UI 없음(용량 위험은 design.md 참조).

## 사용자 시나리오

### 주요 플로우
1. 사용자가 페이지에서 A 요소를 picker로 선택 → 스타일링 패널 진입(`phase: "styling"`). 선택 직후 A의 before 스냅샷 자동 캡처.
2. A의 색·여백 등을 수정(`styleEdits`에 diff 쌓임). 이때 페이지에 A 변경이 적용돼 보인다.
3. 우상단 "다시 선택"(RepickButton) 클릭 → A의 after 스냅샷 캡처 후 `{selection, styleEdits, before, after}`를 **버퍼에 push**, picker 재시작. **A의 페이지 변경은 되돌리지 않고 유지**.
4. B 요소 선택 → 스타일링 패널 진입. A 변경은 버퍼에 남고 페이지에도 그대로 보인다. B는 빈 `styleEdits`로 시작.
5. B 수정 후 "다음"(handleNext) → drafting → 이슈 작성. 페이지엔 A·B 변경이 동시 적용.
6. 이슈 등록 시 본문에 A·B 각각의 element 섹션(selector 소제목 + before/after 스냅샷 + diff 테이블)이 들어간다.
7. 제출 성공 → 버퍼 비움 + 페이지 복원.

### 엣지 케이스
- **diff 없이 "다음" 시도**: 스타일 변경이 없으면 "다음" 버튼이 비활성(`disabled`)이고, 요소를 그냥 캡처하려면 요소 캡처 모드([[element-screenshot]])를 쓰도록 안내한다. → drafting으로 못 넘어간다(no-diff 폐지).
- **같은 selector 재선택**: 이미 버퍼에 있는 selector를 다시 골라 수정하면 그 항목을 갱신(덮어쓰기) — 한 element당 최종 상태 하나만 유지(before 스냅샷은 최초 캡처분 유지, diff·after만 갱신). 페이지에서도 최종 변경만 반영.
- **styling ↔ drafting 왕복**(backToStyling/backToDraft): 버퍼·페이지 변경 유지. 현재 element는 아직 버퍼에 안 담긴 상태로 유지되며 이슈 등록 시점에 합쳐진다(중복 방지).
- **이슈 작성 취소**(reset/cancelPicking) 또는 **탭/페이지 만료**: 버퍼 비움 + 페이지의 모든 누적 변경을 원본 복원(content script `restoreAll`). 기존 `...initial` 리셋 + `clearPicker`로 일원화.
- **페이지 리로드/네비게이션**: 페이지 DOM 파괴 시 누적 시각 변경은 자연 소실(복원 불필요). 버퍼 데이터는 세션 만료 정책(`sessionExpired`)을 따른다.
- **세션 storage 용량 초과**: element별 base64 이미지 누적으로 한계 도달 시, 기존 lite 강등 로직(이미지 제거 후 저장)이 작동 → 스냅샷 일부 손실 가능(텍스트 diff·페이지 변경은 유지). design.md 위험 요소 참조.
- **레거시 no-diff draft**(하위호환): 폐지 이전에 no-diff로 저장된 element draft가 이슈 목록에 남아있을 수 있다. DraftDetailDialog는 이를 기존처럼 screenshot 미디어로 계속 표시(레거시 폴백 유지). 신규 생성 경로에서만 diff를 강제한다 → 마이그레이션 불필요.

## 성공 기준

- element 모드에서 diff 없이는 drafting으로 진행할 수 없다("다음" 비활성 + 안내). 요소 캡처 모드([[element-screenshot]])가 요소 캡처를 대체한다.
- A 수정 → 다시 선택 → B 선택 시 A의 `styleEdits`/스냅샷이 버퍼에 보존되고, 페이지에서도 A 변경이 그대로 유지된다(B 편집 중에도 A·B 동시 적용).
- 이슈 등록 시 6개 플랫폼(Jira/GitHub/Linear/Notion/GitLab/Asana) 본문에 A·B element 섹션이 각각 selector·diff·before/after와 함께 들어간다.
- 사이드패널을 닫았다 열어도 버퍼가 복원된다.
- 이슈 작성 취소/제출 완료/reset 시 버퍼가 비워지고 페이지의 모든 누적 변경이 원본으로 복원된다(잔여 오염 0).
- 같은 selector를 두 번 다루면 본문에 한 번만(최종 상태) 나타난다.
- `buildStyleDiff`·버퍼 머지 등 순수 함수 단위 테스트 통과(`pnpm test`).
- draft 재편집(DraftDetailDialog)은 기존대로 단일 element로 동작하며, 레거시 no-diff draft 표시도 회귀 없다.
- 본문은 단수·복수 분기 없이 `## Style Changes ({selector})` 섹션을 element마다 반복하고, env DOM은 selector를 쉼표로 나열한다. 단일 element도 이 형식으로 출력된다(기존 `## Style Changes`에서 바뀜 — 의도된 변경).
