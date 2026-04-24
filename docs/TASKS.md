# TASKS

PRD(`docs/PRD.md`) 기준 작업 목록. 다른 환경에서 이어서 작업할 때 참고. Claude Code 세션의 TodoWrite 상태를 보강하는 용도 — 권위 있는 소스는 아니지만 방향성 유지용 스냅샷.

**마지막 갱신: 2026-04-26**

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
- [x] #31 마크다운 → ADF 변환 (`buildIssueAdf.ts`)
- [x] #32 Background: Jira 제출 시퀀스 (이슈 생성 → attachment → issueLink)
- [x] #34 단계 5 UI: 완료 다이얼로그 (이슈 키 + 열기 링크 + 새 이슈 시작)
- [x] #41 이슈 상태 트래킹 (생성된 이슈 key/url 저장, IssueListTab에 상태 표시)
- [x] OAuth 3LO 인증 (Cloudflare Worker 프록시 경유 `/token` 교환, accessible-resources 사이트 선택, 401 시 자동 refresh)
- [x] 설정 스토어 v2 마이그레이션 (flat → discriminated `auth` union)
- [x] manifest dev `key` 고정 + `build:store` (스토어 업로드 시 `key` 제거)
- [x] host_permissions 동적 주입 (`VITE_OAUTH_PROXY_URL` origin)
- [x] DOM 트리 Dialog lazy load (조상 path expand + `describeChildren` 온디맨드 → 큰 페이지 freeze 해결)
- [x] Picker interaction-blocker 오버레이 (disabled 요소 hover/click 처리 + 페이지 상호작용 전면 차단, ui-inspector 참고)
- [x] Picker 토큰 매핑 v2 (adoptedStyleSheets 병합, 리터럴 shorthand trbl 분해, var fallback 추적, `--_` private alias 컨벤션)
- [x] Dialog / AlertDialog 시각 통일 (라운드·헤더 스페이싱·타이틀 타이포그래피)
- [x] 토큰 콤보박스 active 강조 + Typography 레이아웃 정리 + PageFooter 톤 조정
- [x] CSSOM shorthand+longhand 혼용 한계 CLAUDE.md 기록
- [x] Jira 연동 플로우 리디자인 (OnboardingView + ApiKeyDialog + ProjectDialog)
- [x] 탭 라벨 "Jira 설정" → "Jira 연동" + 미연결 시 초기 탭 자동 전환
- [x] 이슈 타입 필수 표시 + 기본값 라벨 선입력 버그 수정
- [x] 프리뷰 Jira 미연결 Alert 추가 + "설정 탭" → "연동 탭" 문구 통일
- [x] 앱 아이콘 교체 (BugShot SVG → 16/32/48/128 PNG)
- [x] #27 단계 3 UI: 이슈 작성 편집 다듬기 (Dialog/AlertDialog 스타일링, 레이블 통일, 커서 UX 등)
- [x] #35 Origin 변경 감지 + 편집 중 경고 (origin+pathname 기준 세션 클리어 + SessionExpiredDialog)
- [x] #30 이슈 필드 마지막값 영속화 (lastSubmitFields → chrome.storage.local, projectKey 일치 시 복원)
- [x] #33 클립보드 마크다운 추출 (buildIssueMarkdown + buildIssueHtml + ClipboardItem 복사)
- [x] #36 에러 처리 표준화 (네트워크 에러 한국어화, sendBg 에러 메시지 통일)
- [x] #37 미지원 URL 폴백 화면 (tabId 없을 때 UnsupportedPage 렌더)
- [x] 스크린샷 영역 캡처 + 주석(markerjs2) 모드 추가
  - store `capturing`/`annotating` phase + `screenshotRaw`/`screenshotAnnotated`
  - content script 영역 선택 오버레이 (crosshair + drag rect + dimming)
  - markerjs2 주석 에디터 (annotation 페이지, iframe 오버레이)
  - DraftingPanel/PreviewPanel 캡처 모드 분기 (미디어 섹션)
  - Jira 제출: ADF 미디어 heading + mediaSingle 인라인 이미지
- [x] DOM 타이틀 영역 sticky 고정
- [x] 작성 취소 → 모드 선택 화면 복귀 (startPicker 자동 호출 제거)
- [x] DraftDetailDialog 스크린샷 모드 대응 (미디어 섹션 + screenshot.png 첨부)
- [x] OAuth refresh 실패 시 재인증 AlertDialog + Jira 연동 탭 이동
- [x] 이슈 상태 뱃지 fetch 실패 시 "알 수 없음" fallback 뱃지
- [x] 스크린샷 모드 viewport/capturedAt 메타 전체 표면 반영 (프리뷰/드래프트/마크다운/ADF)

## 진행 중

(없음)

## 대기 — 리팩터

- [x] `IssueTab.tsx` 분리 (1973줄 → 242줄) — `StyleEditorPanel.tsx`(1447줄) + `DomTreeDialog.tsx`(283줄) + `CancelConfirmDialog.tsx`(36줄)
- [ ] `picker.ts` 분리 (1582줄) — 영역 선택 오버레이 추가로 더 비대해짐
- [ ] `picker-control.ts` 에러 처리 공통 래퍼

## 배포 로드맵 (순서대로)
1. ~~스크린샷 영역 캡처 + 주석(markerjs2) 모드 추가~~ ✅
2. `picker.ts` 리팩터 (영역 선택 오버레이 분리)
3. 비디오 탭 녹화(tabCapture + offscreen) 모드 추가
4. en locale 지원
5. 웹스토어 배포 (`pnpm build:store`)
