# TASKS

PRD(`docs/PRD.md`) 기준 작업 목록. 다른 환경에서 이어서 작업할 때 참고. Claude Code 세션의 TodoWrite 상태를 보강하는 용도 — 권위 있는 소스는 아니지만 방향성 유지용 스냅샷.

**마지막 갱신: 2026-04-22**

## 완료

- [x] #18 Side Panel Tabs 레이아웃 (이슈 작성 / 설정)
- [x] #19 Jira config 스토리지 (chrome.storage.local)
- [x] #20 설정 탭: Jira 자격 입력 + /myself 검증
- [x] #21 설정 탭: 전역 프로젝트 드롭다운
- [x] #22 편집 세션 store + state machine
- [x] #23 Background: Jira API 래퍼
- [x] #24 Picker content script (Shadow DOM + finder + Port)
- [x] #25 단계 1+2 UI: 요소 선택 + Style 수정
- [x] #26 마크다운 본문 생성기
- [x] #38 설정 탭: 기본 이슈 타입 + 제목 prefix
- [x] #39 요소 크롭 스냅샷 캡처 (before/after)
- [x] #40 Text 편집 섹션 (문구 오탈자 교정)
- [x] #28 Jira 필드 Combobox (담당자/우선순위/Epic) — search-as-you-type, 패밀리 그룹핑
- [x] #29 단계 4 UI: 프리뷰 + Jira 필드 + CTA — 이슈 생성 모달
- [x] 토큰 매핑 개선 (CSS 상속 속성, shorthand→longhand 분해, var() 래핑 인식)
- [x] 스타일 편집 UX (토큰 패밀리 그룹, quad 속성 링크 토글, 콤보박스 너비)
- [x] Picker 배너: 뷰포트 사이즈 상시 표시 + resize 실시간 갱신
- [x] 우클릭 컨텍스트 메뉴 ("BugShot")
- [x] 브랜딩: BugShot 파스칼 케이스 통일, 앱 설명 문구 개선
- [x] en locale 추가
- [x] PRD v0.4 최신화 (구현 기준 스펙 반영)
- [x] AI 메타데이터 블록 (`<!-- bugshot-meta-for-ai -->`) — 마크다운 최상단, 구조화 JSON

## 진행 중

- [ ] #27 단계 3 UI: 이슈 작성 편집
- [ ] #35 Origin 변경 감지 + 편집 중 경고 (origin+pathname 기준 세션 클리어까지 구현됨, 편집 중 경고 UX는 미구현)

## 대기
- [ ] #30 이슈 필드 마지막값 영속화
- [ ] #31 마크다운 → ADF 변환
- [ ] #32 Background: Jira 제출 시퀀스
- [ ] #33 클립보드 마크다운 추출
- [ ] #34 단계 5 UI: 완료 다이얼로그
- [ ] #36 에러 처리 표준화
- [ ] #37 미지원 URL 폴백 화면
- [ ] #41 이슈 상태 트래킹 (생성된 이슈 key 저장 → status fetch)
