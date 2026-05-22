# Browser 환경 정보 자동 포함

## 배경
이슈에 자동 포함되는 환경 정보(Page, DOM, Viewport, Captured)에 브라우저 버전이 빠져 있다. Chrome 버전별 렌더링·API 차이가 존재하므로, 버그 재현 시 브라우저 버전은 필수 맥락이다. 현재는 사용자가 수동으로 커스텀 행을 추가해야 알 수 있음.

## 목표
- 모든 캡처 모드(element, screenshot, video, freeform)에서 Browser 버전을 readonly 환경 정보의 첫 행으로 자동 노출한다.
- 사용자 조작 없이 자동 수집되며, 편집 불가(readonly).

## 비목표
- OS 정보 표시 (별도 기능으로 검토 가능)
- 풀 User-Agent 문자열 노출
- 타 브라우저(Firefox, Edge 등) 지원 — Chrome 전용 확장이므로 불필요

## 사용자 시나리오
1. 사용자가 아무 페이지에서 요소를 선택하고 이슈 작성 화면에 진입한다.
2. "재현 환경" 섹션의 readonly 영역 첫 행에 `Browser | Chrome 128.0.6613.85` 형태로 표시된다.
3. 이슈를 등록하면 본문의 환경 정보 블록 첫 줄에 `**Browser**: Chrome 128.0.6613.85`가 포함된다.
4. screenshot, video, freeform 모드에서도 동일하게 표시된다.

## 성공 기준
- 모든 모드에서 이슈 작성 화면(DraftingPanel)·미리보기(PreviewPanel)·이슈 상세(DraftDetailDialog)의 환경 정보 첫 행이 Browser이다.
- 등록된 이슈(Jira, GitHub, Linear, Notion) 본문에 Browser 정보가 포함된다.
- 마크다운 복사 시에도 Browser 정보가 포함된다.
- 파싱 실패 시 Browser 행은 노출하지 않는다 (Chrome 확장이라 실제 발생하지 않지만, 방어적 처리).
- 단위 테스트로 Browser 첫 행 순서가 보장된다.
- 기존 환경 정보(Page, DOM, Viewport, Captured)의 순서·내용에 영향 없다.
