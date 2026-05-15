# Inline Area Capture

## 배경

현재 DraftingPanel의 위지윅 에디터에서 이미지를 추가하려면 로컬 파일을 첨부(ImagePlus 버튼)하거나 클립보드에서 붙여넣기해야 한다. 하지만 사용자가 보고 있는 웹 페이지의 특정 영역을 캡처해서 이슈 본문에 직접 넣고 싶은 경우, 별도의 스크린샷 도구를 쓰고 파일로 저장한 뒤 다시 첨부하는 번거로운 과정이 필요하다.

기존에 screenshot 캡처 모드(IssueTab → area capture → 메인 스크린샷)는 있지만, 이는 이슈의 대표 스크린샷 한 장을 위한 것이고, drafting 중 편집기 안에 인라인 이미지를 추가하는 용도가 아니다.

## 목표

1. DraftingPanel의 위지윅 에디터(paragraph 섹션)에서 한 번의 클릭 + 드래그로 뷰포트 영역을 캡처해 해당 에디터의 마지막 노드로 삽입할 수 있다.
2. 캡처 진행 중 사용자가 취소할 수 있다.
3. 기존 screenshot 캡처 모드의 area-select UX를 그대로 재사용한다.

## 비목표 (Non-goals)

- 인라인 캡처 이미지에 대한 주석(annotation) 모드 지원. 명시적으로 제외.
- 전체 페이지 스크롤 캡처. 뷰포트 가시 영역만.
- OrderedList 타입 섹션 지원 (TiptapEditor를 사용하지 않으므로 해당 없음).
- 캡처 영역 크기 제한 추가 (기존 area-select의 최소 10×10px 제한만 유지).

## 사용자 시나리오

### 주요 플로우

1. 사용자가 DraftingPanel에서 이슈를 작성 중이다 (captureMode 무관 — element/screenshot/video/freeform 모두).
2. paragraph 타입 섹션(설명, 재현 단계 등)의 헤더에서 [캡처] 아이콘 버튼을 클릭한다. 이 버튼은 기존 [첨부] 아이콘 좌측에 위치한다.
3. DraftingPanel 전체가 "캡처 영역을 선택하세요" 다이얼로그로 전환된다 (기존 CapturingState와 유사한 EmptyShell 패턴).
4. 사용자가 웹 페이지에서 드래그하여 영역을 선택한다 (crosshair 커서, 딤 오버레이, 크기 라벨 표시 — 기존 area-select UX 동일).
5. 영역 선택 완료 → captureVisibleTab으로 스크린샷 → 선택 영역 크롭 → 압축 → IndexedDB 저장 → 해당 섹션 에디터의 마지막 노드로 이미지 삽입.
6. DraftingPanel이 원래 drafting 뷰로 복귀하고, 해당 섹션의 TiptapEditor에 캡처 이미지가 보인다.

### 취소 플로우

- 다이얼로그의 [취소] 버튼 클릭 → area-select 중단, DraftingPanel 원래 뷰로 복귀.
- 웹 페이지에서 ESC 키 → content script가 `picker.cancelled` 전송 → 동일하게 복귀.

### 엣지 케이스

- 탭이 닫히거나 unsupported URL로 이동한 경우: 기존 area capture와 동일하게 에러 처리 후 인라인 캡처 상태만 해제.
- 연속 캡처: 한 섹션에 여러 번 캡처 가능. 각 캡처마다 에디터 끝에 이미지 추가.
- element 모드에서 인라인 캡처 시 picker가 area-select 모드로 전환되어 기존 선택 요소의 오버레이가 사라짐. 캡처 완료 후 picker는 idle 복귀. "스타일링으로 돌아가기" 클릭 시 요소 재선택 필요 — 기존 동작과 동일하므로 별도 처리 불요.

## 성공 기준

1. DraftingPanel의 모든 paragraph 섹션에 캡처 버튼이 노출된다.
2. 캡처 버튼 클릭 → 영역 드래그 → 이미지가 해당 섹션 에디터 끝에 삽입된다.
3. 삽입된 이미지가 이슈 제출 시 정상적으로 플랫폼(Jira/GitHub/Linear/Notion)에 첨부된다.
4. 취소(버튼/ESC) 시 drafting 상태가 손상 없이 복귀된다.
5. 기존 screenshot 캡처 모드와 충돌 없이 동작한다.
