# 자유 작성 (Freeform Draft)

## 배경

Bugshot은 현재 DOM 요소·스크린샷·영상 녹화 3가지 캡처 모드를 제공한다. 모두 "캡처 → 편집 → 작성 → 제출" 플로우를 거치는데, 때로는 캡처 없이 재현 환경 정보(URL, 뷰포트)와 콘솔/네트워크 로그만으로 이슈를 작성하고 싶은 경우가 있다. 최근 도입된 Tiptap WYSIWYG 에디터가 이 "자유 작성" 경험을 자연스럽게 지원한다.

## 목표

1. 캡처 단계 없이 곧바로 이슈 작성(drafting phase)에 진입하는 `freeform` 캡처 모드를 추가한다.
2. 진입점 3곳: EmptyState 캡처 모드 선택 / 콘솔 로그 탭 PageFooter / 네트워크 로그 탭 PageFooter.
3. 기존 이슈 섹션(description, stepsToReproduce, expectedResult, notes)과 AI 초안 생성을 그대로 사용한다.
4. 환경 정보(Page URL, Viewport, Captured timestamp)와 로그(수동 토글) 첨부를 지원한다.

## 비목표 (Non-goals)

- Style diff, before/after 스냅샷, 미디어(스크린샷/영상) 블록 — freeform에서 제외.
- 로그 자동 첨부 — 진입 경로와 무관하게 항상 수동 토글.
- 콘솔/네트워크 로그 탭 자체의 기능 변경 — PageFooter 버튼 추가만.

## 사용자 시나리오

### 시나리오 1: EmptyState에서 자유 작성 진입

1. 사용자가 Bugshot 사이드패널을 열면 EmptyState(캡처 모드 선택)가 노출된다.
2. 기존 3개 버튼(요소 선택, 화면 캡처, 영상 녹화) 아래에 **"자유 작성"** 버튼이 추가되어 있다.
3. 클릭 시 즉시 DraftingPanel(drafting phase)로 진입한다.
4. 미디어 블록 없이 제목 + 이슈 섹션 편집기가 노출된다.
5. 로그 카드(네트워크/콘솔)가 있으면 토글로 첨부 가능하다.
6. AI 초안 생성 버튼 클릭 시 AiDraftDialog가 열리고, 환경 정보 + 로그 요약 기반으로 초안이 생성된다.
7. 프리뷰 → 플랫폼 선택 → 제출 — 기존 플로우와 동일.

### 시나리오 2: 콘솔 로그 탭에서 자유 작성 진입

1. 사용자가 콘솔 로그 서브탭에서 에러 로그를 확인하고 있다.
2. 탭 하단에 새로 추가된 PageFooter의 **"자유 작성"** 버튼을 클릭한다.
3. 이슈 서브탭으로 자동 전환되고 즉시 DraftingPanel로 진입한다.
4. 이후 시나리오 1의 4~7번과 동일.

### 시나리오 3: 네트워크 로그 탭에서 자유 작성 진입

- 시나리오 2와 동일하되, 네트워크 로그 서브탭에서 시작.

### 엣지 케이스

- **탭이 unsupported URL인 경우**: freeform은 DOM 캡처가 없으므로, content script가 주입 불가한 페이지(chrome://, extension pages 등)에서도 진입 가능해야 한다. 단, 뷰포트 조회가 실패하면 환경 정보에서 뷰포트를 생략한다.
- **이미 drafting 중일 때**: 다른 모드로 drafting 중이면 freeform 버튼은 비활성화하거나, 기존 작업 취소 확인을 거친다. 기존 모드 전환 시 확인 패턴을 따른다.
- **세션 만료(탭 이동)**: freeform은 페이지 상태에 의존하지 않지만, 환경 정보의 정확성을 위해 기존 `SessionExpiredDialog` 패턴을 유지한다.

## 성공 기준

- [ ] EmptyState에서 "자유 작성" 버튼으로 미디어 없는 drafting phase 진입 가능
- [ ] 콘솔/네트워크 로그 탭 하단 PageFooter에서 동일하게 진입 가능
- [ ] 제목 + 이슈 섹션(Tiptap WYSIWYG) + 인라인 이미지 첨부가 정상 동작
- [ ] 네트워크/콘솔 로그 수동 토글 첨부 정상 동작
- [ ] AI 초안 생성이 환경 정보 + 로그 요약 컨텍스트로 정상 동작
- [ ] 4개 플랫폼(Jira ADF, GitHub MD, Linear MD, Notion blocks) 제출 시 미디어 섹션 없이 올바른 포맷 출력
- [ ] 마크다운 복사(프리뷰)에서 미디어 섹션 없이 올바른 출력
- [ ] IssueListTab에서 freeform 이슈가 정상 노출·재편집·재제출 가능
- [ ] i18n 한/영 모두 대응
