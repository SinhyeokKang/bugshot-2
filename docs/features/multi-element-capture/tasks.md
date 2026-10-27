# 다중 요소 캡처 — 구현 태스크

## 선행 조건

- 이 문서는 설계 산출물이다. 구현 코드는 아직 변경하지 않았다.
- 새 권한·env·OAuth·외부 API·의존성·IndexedDB 버전 변경은 필요하지 않다.
- `prd.md`의 사용자 합의 및 `design.md`의 데이터 계약을 구현 기준으로 사용한다.
- 구현 전 `docs/ARCHITECTURE.md`의 편집 세션·첨부 복구·탭 모드와 관련 POSTMORTEM을 다시 읽는다.
- 범위가 여러 서브시스템에 걸치므로 일반 `/ship` 대상이 아니다. 설계 리뷰 후 별도 구현 지시 또는 명시적인 `/ship bypass`로 진행한다.

## 태스크

### Task 1: 캡처 데이터 계약과 순수 함수 테스트

- **변경 대상**: 신규 `src/types/element-shot.ts`, `src/sidepanel/lib/elementShots.ts`, `elementShotBudget.ts` 및 대응 `__tests__`.
- **작업 내용**: 고유 ID·메타·원본/주석 모델, 레거시 단일 정규화, selector 순서 결합, 유효 이미지 선택, 제출 manifest와 용량 판정 함수를 정의한다. 구현 전에 테스트를 작성한다.
- **검증**:
  - [ ] A/B/A가 세 항목이고 동일 selector가 dedup되지 않는다.
  - [ ] 중간/첫 항목 삭제 후 나머지 ID·이미지·selector 대응이 유지된다.
  - [ ] 주석본 우선, raw 폴백, 이미지 누락을 구분한다.
  - [ ] 레거시 한 항목 승격과 새 배열 우선 규칙이 중복을 만들지 않는다.
  - [ ] 추가/주석 후보 크기, logs.html 재임베드, 세션 타 키 사용량, 상한 직전/초과/조회 실패를 판정한다.
  - [ ] manifest의 ID와 Blob 슬롯은 표시 순서 변경에도 안정적이고 파일명은 표시 순서를 따른다.

### Task 2: 편집 상태·피커 추가 전이

- **변경 대상**: `src/store/editor-store.ts`, `src/sidepanel/picker-control.ts`, `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/tabs/IssueTab.tsx` 및 기존 store/picker 훅 테스트.
- **작업 내용**: 최초 선택과 추가 선택을 구분한다. 추가 시작은 초안을 초기화하지 않는다. requestId 기반 결과 수락·취소·실패 복귀, 항목별 수정·삭제, 마지막 장 보호를 구현한다.
- **검증**:
  - [ ] 첫 선택은 한 장으로 drafting, 추가 성공은 목록 뒤에 한 장을 붙이고 drafting.
  - [ ] 취소 버튼·ESC·주입 실패·권한 실패·캡처 실패에서 기존 draft/미디어/주석/로그/첨부/플랫폼 값 보존.
  - [ ] append 취소 → 같은 탭에서 재시작 → 이전 성공/실패 응답이 새 상태나 피커를 바꾸지 않는다.
  - [ ] 중복 클릭·중복 선택 메시지가 중복 커밋을 만들지 않는다.
  - [ ] 마지막 장 삭제 액션이 no-op이다.
  - [ ] 초기 캡처 취소·CSS 스타일 repick·inline 영역 캡처의 기존 동작이 유지된다.
  - [ ] iframe 프레임 토큰 검증과 탭 모드 hold의 실제 훅 조합 테스트가 유지된다.

### Task 3: 세션·초안 저장·Blob 수명

- **변경 대상**: `editor-store.ts`, `issues-store.ts`, `blob-db.ts`, `useEditorSessionSync.ts`, `liteSnapshot.ts`, `useIssueImages.ts` 및 관련 테스트.
- **작업 내용**: snapshot 키와 직렬화, append picking hydrate, 구 단일 데이터 승격, optional 저장 배열과 안정적 슬롯, 저장 완료 확인, 참조 수집 및 보호된 정리를 구현한다. `confirmDraft`의 호출부는 필요한 저장 완료를 기다리도록 변경한다.
- **검증**:
  - [ ] snapshot 키 집합과 실제 저장 필드가 같다. 배열 내부 주석까지 왕복한다.
  - [ ] append picking 중 닫았다 열면 기존 drafting으로 복귀하며 오래된 요청은 무효다.
  - [ ] 초기 picking은 기존 idle 복구, 일반 screenshot/video/element 세션은 기존 동작.
  - [ ] lite 변환이 배열 raw/annotated를 모두 비우고 누락 이미지는 제출을 막는다.
  - [ ] 저장 쓰기 실패/부분 실패에서 원본과 기존 저장 초안을 보존한다.
  - [ ] 저장 도중 삭제·주석 변경·세션 교체가 이전 결과로 최신 상태를 덮지 않는다.
  - [ ] 구 before 슬롯 레코드, 새 배열 레코드, 누락 Blob 각각을 올바르게 읽는다.
  - [ ] 이미지 삭제·이슈 삭제·GC가 활성 recovery 및 다른 참조를 지우지 않는다.
  - [ ] 변경 레코드 updatedAt과 크로스 인스턴스 병합 규약을 유지한다.

### Task 4: 작성·미리보기·상세·환경 행

- **변경 대상**: 신규 `ElementShotMedia.tsx`, `DraftingPanel.tsx`, `PreviewPanel.tsx`, `DraftDetailDialog.tsx`, `buildEditorCapture.ts`, `buildMarkdownContext.ts`, `buildReportData.ts`, i18n 및 UI/본문 테스트.
- **작업 내용**: 요소 추가 버튼과 세로 미디어 목록, 각 이미지의 편집·다운로드·삭제, ID 기반 어노테이션을 구현한다. selector 결합 헬퍼를 모든 환경 행 생산 경로에 연결한다.
- **검증**:
  - [ ] 요소 추가가 섹션 우상단 액션의 첫 버튼이며 진한 기본 스타일이다.
  - [ ] 각 이미지 우상단 액션은 hover 없이 보이고 접근명이 있다. 삭제 팝오버는 없다.
  - [ ] 마지막 장 삭제 버튼은 없고 삭제 후 포커스가 유효한 컨트롤에 남는다.
  - [ ] 두 번째 이미지 주석 편집·제거·다운로드가 다른 이미지를 건드리지 않는다.
  - [ ] 일반 영역/화면/페이지 캡처에는 요소 추가 버튼이 없다.
  - [ ] A/B/A 추가와 B 삭제가 작성·미리보기·복사·저장 상세의 DOM 행에 동일하게 반영된다.
  - [ ] 기존 본문 언어·사용자 환경 행·API Hosts·로그 토글의 의미가 유지된다.
  - [ ] 첫 장 삭제 시 Viewport/Captured는 다음 장 메타로 전환된다.

### Task 5: 파일 생성·최초 제출·복구·재제출

- **변경 대상**: `buildCaptureFiles.ts`, `submissionRecovery.ts`, `submissionAdapter.ts`, `uploadPayload.ts`, `PreviewPanel.tsx`, `DraftDetailDialog.tsx`, 필요한 `submitTo*.ts` 입력 배선 및 계약 테스트.
- **작업 내용**: 공용 manifest 기반 파일 생성/기대 원본/저장 슬롯 연결. 실제 전송 요청의 용량 검증을 생성 이전에 수행한다. 기존 images 배열 기반 업로드·body slot·journal을 이용한다.
- **검증**:
  - [ ] 라이브/저장 재제출 모두 같은 순서·내용·파일명·안정적 파일 ID를 만든다.
  - [ ] 레거시 screenshot.webp 및 기존 진행 중 journal을 계속 읽고 재시도할 수 있다.
  - [ ] 원본 한 장 누락 또는 용량 초과면 생성 API 호출 0회, 기존 초안 유지.
  - [ ] 9개 제출 대상이 전 이미지를 전달하고 결과를 ID로 대응한다.
  - [ ] Jira 본문 filename 대응, Asana 변환본 originalSource, Notion ZIP 참조가 일치한다.
  - [ ] 두 번째 파일 업로드 실패 후 재시도에서 그 파일만 전송하고 이슈 생성은 총 1회다.
  - [ ] Slack 공유 후 승격에도 전체 원본이 남아 있고 완료 정리가 미완료 파일을 지우지 않는다.
  - [ ] 사용자 첨부와 같은 파일명이 있어도 파일 ID 충돌이 없다.

### Task 6: 로그 HTML·AI 입력 일치

- **변경 대상**: `buildCaptureFiles.ts`, `buildLogsHtml.ts`, `buildEditorCapture.ts`, `DraftDetailDialog.tsx`, `src/types/log-viewer.ts`, `src/log-viewer/App.tsx`, `AiDraftDialog.tsx` 및 관련 테스트.
- **작업 내용**: optional screenshots와 구 screenshot 폴백, 세로 정적 이미지 목록, 전 이미지 AI 입력을 추가한다. 기존 이미지/토큰 예산과 누락 안내를 재사용한다.
- **검증**:
  - [ ] 라이브 다운로드·저장 상세 다운로드·제출 logs.html이 같은 이미지 순서를 가진다.
  - [ ] 새 복수 이미지를 legacy screenshot에 다시 넣지 않아 중복 임베드하지 않는다.
  - [ ] 구 단일 로그 HTML과 영상/로그 전용 레이아웃이 유지된다.
  - [ ] AI에 선택 순서와 주석본이 전달되고 상한 초과분은 기존 droppedImages 안내에 포함된다.
  - [ ] AI 절삭이 저장 미디어를 삭제하지 않는다. 외부 전송은 사용자 실행 시에만 발생한다.

### Task 7: 통합 검증·가이드·문서

- **변경 대상**: 신규 `e2e/multi-element-capture.spec.ts`, 관련 기존 e2e, 아래 가이드와 필요한 아키텍처 문서.
- **작업 내용**: 전체 테스트·typecheck, e2e 작성/연속 통과, 수동 픽셀 확인, ko/en 사용자 문서와 화면 캡처를 갱신한다. 실제 구현에서 확인된 사실만 영속 문서에 반영한다.
- **검증**:
  - [ ] `pnpm test`, `pnpm typecheck` 통과.
  - [ ] i18n 및 log-viewer 사전 대칭 테스트 통과.
  - [ ] `/e2e-write`에서 대상 spec 연속 통과. 배포 빌드는 별도 승인/스킬 범위에서만 실행.
  - [ ] 관련 문서 및 guide ko/en 내용·스크린샷이 구현과 일치.
  - [ ] 단일 screenshot 소비처 검색 결과를 변경/레거시 유지/다른 모드로 전부 분류.

## 테스트 계획

### 단위·통합 테스트

Tasks 1–6의 검증 항목을 각 경계에 둔다. 특히 fake store만으로 끝내지 말고 실제 picker 훅→store 전이, store→snapshot 왕복, 저장 레코드→expectedSubmissionSources→준비 파일의 조합을 검증한다. 플랫폼 테스트는 네트워크를 mock하고 파일 순서·ID·본문 참조를 단언한다.

### e2e 시나리오

- 요소 A 캡처 → 제목/본문 입력 → 요소 추가로 B 선택 → 제목/본문 유지, 미디어 2장, DOM 값 A/B.
- A 재선택 → 3장 → B 삭제 → A/A 2장. 첫 장 삭제 후 한 장이며 삭제 버튼이 없다.
- 추가 피커 ESC/취소 → 원래 본문과 미디어가 그대로 보인다.
- 추가 피커 중 패널 재열기 → 기존 작성 화면 복구, 새 항목 없음.
- 두 번째 장에 주석 → 미리보기/초안 저장/상세 열기 → 올바른 장에만 주석이 있다.
- 다중 캡처 저장 후 제출 → mock 플랫폼의 이미지 개수·순서와 DOM 본문이 일치.
- 첨부 하나 실패 → 복구 실행 → 생성 호출 1회 유지, 실패 파일만 재시도.
- 로그 HTML을 열면 미디어가 선택 순서대로 보인다. 구 단일 HTML도 한 장으로 열린다.
- 일반 영역 캡처와 CSS 스타일 편집을 열면 기존 UI와 동작을 유지한다.

### 수동 테스트

- 실제 captureVisibleTab 이미지에서 다른 요소가 정확히 크롭됐는지, 오버레이가 찍히지 않는지 확인.
- 지원되는 cross-origin iframe 요소를 추가 캡처해 top viewport 기준 이미지·복귀를 확인.
- 탭 모드에서 추가 선택 동안 대상 탭으로 이동하고 완료/취소 후 패널로 복귀하는지 확인.
- 좁은 패널·라이트/다크에서 이미지 우상단 액션의 가독성과 가림 정도 확인.

## 구현 순서 권장

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7. 상태/저장 계약이 정해진 뒤 UI와 로그/AI 소비처는 파일 소유권을 분리하면 병렬 가능하지만, Task 5의 제출 manifest 계약을 공유해야 한다. 미디어 UI만 먼저 출시하지 않고 저장·제출·복구까지 한 기능으로 검증한다.

## 가이드 영향

`guide/AUTHORING.md` 기준으로 아래 ko/en 양쪽을 구현 후 갱신한다.

- `guide/{ko,en}/screenshot/capture.md`: 요소 캡처 후 작성 화면에서 추가 선택하는 흐름.
- `guide/{ko,en}/screenshot/issue.md`: 요소 추가, 이미지별 액션, 삭제와 엘리먼트 행 동기화.
- `guide/{ko,en}/screenshot/annotation.md`: 이미지별 주석 대상과 다운로드.
- `guide/{ko,en}/logs/viewer.md`: 복수 정적 이미지 표시.
- 관련 assets: 추가 버튼·다중 이미지·이미지별 액션이 보이는 컷 갱신.

`docs/ARCHITECTURE.md`는 세션/저장/복구 계약, `docs/DIRECTORY.md`는 신규 모듈, `docs/DESIGN.md`는 공유 미디어 컴포넌트를 갱신한다. 원본 CLAUDE/스킬 변경은 이 기능의 기본 범위에 넣지 않는다. 개인정보 전송 경로·권한은 바뀌지 않으며 README/privacy는 구현 diff에 실제 설명 불일치가 있을 때만 대칭 갱신한다.
