# 감사 후속 태스크

원인·발생 조건은 [report.md](./report.md), 배치 소유권·검증 게이트는 [orch.md](./orch.md)를 따른다.

## AUTH — A01·A03
- [x] 별도 인증 설계와 검수 후 구현한다.
- [x] 다른 신원·재연결 grant의 stored auth와 진행 중 refresh를 기존 요청에 재사용하지 않는다.
- [x] 정상 회전 재사용은 유지하고, 서로 다른 플랫폼·패널 설정 저장과 refresh의 교차 쓰기에서 최신 토큰을 보존한다.
- [x] 동시성 테스트는 읽기/쓰기 순서를 제어하고 최종 저장 토큰과 실제 요청 대상/헤더를 단언한다.

## CAPTURE — A02·A04
- [x] screenshot/video/freeform 확정→세션 재개 시 issue 소유 로그를 복원한다. 늦은 복원이 새 세션을 덮지 않는다.
- [x] 복구한 로그가 제출 logs.html과 본문 요약에 포함된다. logsAttach off·element 제외는 유지한다.
- [x] 마지막 첨부·일부 첨부 삭제 후 재확정 시 IssueRecord 메타데이터와 blob이 일치한다.
- [x] 저장 초안 제출 검증까지 실행하고 삭제한 파일을 MissingSubmissionFilesError로 처리하지 않는다.

## CONNECT — A05
- [x] notion.testToken의 잘못된 신규 토큰은 연결 폼 오류만 발생시킨다.
- [x] 기존 저장 인증의 401은 기존 전역 만료 이벤트를 유지한다.
- [x] 메시지 경계 직렬화와 bg-client 소비까지 회귀 검증한다.

## VIEWER — A06·A07·A08
- [x] MP4/WebM의 실제 MIME과 다운로드 파일명이 일치한다. 별도 빌드 import 경계를 유지한다.
- [x] 탐색 막대 Tab 접근, 방향키, Home/End, 경계 clamp, aria 값·시간 설명·포커스 표시를 검증한다.
- [x] titlePrefix와 Linear priority 표시 라벨을 컨트롤에 연결한다. 라벨 조회·클릭 포커스를 검증한다.
- [x] UI 동작은 DOM 또는 e2e로 검증한다. 신규 의존성·전역 디자인 변경은 도입하지 않는다.

## 공통 완료 조건
- [x] 배치별 TDD·자체 검증·독립 리뷰, typecheck/test/sync gate.
- [x] 지휘자 문서 신선도·회고·가이드 영향 처리.
- [ ] dev 통합 후 재검증·build·가능한 런타임 검증.
- [ ] 최종 원격 dev HEAD 일치와 해당 SHA CI verify/e2e-gate 성공.

## 가이드 영향
기존 동작 복원은 기능 설명 변경이 필요한지 대조한다. 영상 키보드 탐색은 기존 로그 뷰어 안내의 ko/en 동시 갱신 여부를 판정한다. 공용 가이드 수정은 지휘자가 통합 시 수행한다.
