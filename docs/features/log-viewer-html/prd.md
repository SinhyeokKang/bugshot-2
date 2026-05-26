# Self-Contained HTML Log Viewer

## 배경

현재 bugshot은 이슈 첨부 시 `network-log.har`와 `console-log.json`을 별도 파일로 첨부한다. 이 파일들은 raw 데이터라 수신자가 Chrome DevTools에 수동 import하거나 텍스트 에디터로 열어야 한다. 대부분의 수신자(PM, 디자이너, QA)는 이 파일을 열어보지 않는다.

HTML로 래핑하면 더블클릭만으로 브라우저에서 bugshot의 로그 UI를 그대로 볼 수 있어 로그 활용도가 올라간다.

## 목표

1. `network-log.har` + `console-log.json` → 단일 `logs.html`로 대체
2. `logs.html`을 브라우저에서 열면 bugshot side panel의 로그 UI를 그대로 재현
3. 필터(타입/레벨) + 검색 기능 완전 제공
4. HTML 내부에서 원본 HAR/JSON을 다운로드할 수 있는 버튼 제공
5. 다크/라이트 모드 지원 (시스템 감지 + 수동 토글)

## 비목표 (Non-goals)

- 로그 수집/저장 로직 변경 — 기존 NetworkLog/ConsoleLog 타입 및 recorder 코드 유지
- 실시간 로그 스트리밍 — HTML은 스냅샷 데이터만 포함
- 로그 편집/삭제 기능 — 읽기 전용
- side panel 내 로그 UI 변경 — 기존 UI 그대로 유지
- logs.html 단독 열기 시 로그 녹화 기능 — 확장 없이는 불가

## 사용자 시나리오

### 기본 플로우
1. 사용자가 bugshot에서 이슈 작성 (screenshot/video/freeform 모드)
2. 네트워크/콘솔 로그가 수집된 상태에서 로그 첨부 토글 ON
3. 이슈 제출 시 `logs.html` 하나가 첨부됨 (기존 HAR/JSON 2파일 대신)
4. 이슈 수신자가 `logs.html`을 다운로드 → 브라우저에서 열기
5. 상단 탭으로 Network/Console 전환, 필터/검색으로 원하는 로그 찾기
6. 필요 시 "Download HAR" / "Download JSON" 버튼으로 원본 데이터 추출

### 엣지 케이스
- **네트워크 로그만 있는 경우**: Console 탭 비활성화 또는 빈 상태 표시, Network 탭 자동 선택
- **콘솔 로그만 있는 경우**: Network 탭 비활성화 또는 빈 상태 표시, Console 탭 자동 선택
- **둘 다 없는 경우**: 발생 불가 — `buildCaptureFiles`에서 둘 다 null이면 logs.html 미생성
- **대용량 로그**: 5000 네트워크 요청 + 2000 콘솔 항목 = 최대 수 MB. HTML 성능은 가상 스크롤 없이도 허용 범위 (기존 extension UI와 동일)
- **응답 body에 `</script>` 포함**: JSON 직렬화 시 `<` → `<` 이스케이프로 HTML 파싱 충돌 방지

## 성공 기준

1. `pnpm build` 성공 (log viewer 빌드 + 메인 빌드 통합)
2. 이슈 첨부 시 `logs.html` 1파일만 생성됨 (HAR/JSON 미생성)
3. logs.html을 Chrome/Safari/Firefox에서 열면 로그 UI 정상 렌더링
4. Network 탭: 필터(8종), URL 검색, 2분할(리스트+상세), Headers/Request/Response 서브탭, cURL 복사 동작
5. Console 탭: 필터(6종), 메시지 검색, 어코디언 펼침, 스택트레이스 표시 동작
6. HAR 다운로드 버튼 → 표준 HAR 1.2 파일, JSON 다운로드 버튼 → 기존 console-log.json 포맷
7. 다크/라이트 모드 토글 동작
8. 4개 플랫폼(Jira/GitHub/Linear/Notion) 첨부 정상
