# 발생 현상 로그 첨부 (Symptom Log Attach)

## 배경

버그를 제보한 팀 개발자가 문제되는 API response를 리포트에 담았는데, "이게 logs.html을 열어야만 보이냐"는 피드백을 남겼다. 확인 결과 맞다.

현재 이슈 본문(예: Jira ADF)에 들어가는 로그 정보는 요약 카운트 한 줄뿐이다 (`emitLogSummaryAdf`, `src/sidepanel/lib/buildIssueAdf.ts:263` — "네트워크: N건 (에러 X건)"). 실제 request/response body 등 payload는 첨부된 `logs.html`(gzip+base64)을 다운로드해 열어야만 보인다. 리포터가 "이 응답이 문제다"라고 트래커 본문에서 바로 보여줄 방법이 없다.

특히 status 코드로 에러를 자동 판별하는 접근은 범용적이지 못하다 — HTTP 200인데 body가 `{ "result": "FAILED" }`인 API를 놓친다. 따라서 어떤 로그를 노출할지는 사람(리포터)이 직접 골라야 한다.

## 목표

- 발생 현상(및 기타 문단 섹션) 에디터에서, 캡처된 네트워크/콘솔 로그 중 하나를 골라 **코드블럭 텍스트로 본문에 삽입**할 수 있다.
- 삽입된 로그는 이슈 트래커 본문에 코드블럭으로 그대로 렌더되어, logs.html을 열지 않아도 트래커에서 바로 보인다.
- 네트워크 로그는 endpoint·status·payload(request body)·response body를 담는다. payload는 "200인데 FAILED" 케이스 재현에 필수다.
- 8개 트래커 전부에서 코드블럭이 정상 렌더된다 (Notion 2000자 제약 포함해 깨지지 않는다).

## 비목표 (Non-goals)

- 로그를 "핀"·"활성화"하는 영속 상태를 만들지 않는다. 삽입은 1회성 에디터 커맨드이며, 삽입 후엔 그냥 마크다운 콘텐츠(중복·수정·삭제 자유).
- 여러 로그를 한 번에 다중 선택하지 않는다. 단일 선택 → 삽입. 여러 개 붙이려면 다이얼로그를 반복해서 연다.
- 기존 `logs.html` 첨부 토글(`NetworkLogPreviewDialog`/`ConsoleLogPreviewDialog`의 attach/detach)을 대체·변경하지 않는다. 이건 별개 기능으로 공존한다.
- action 로그는 삽입 대상이 아니다 (네트워크·콘솔만).
- WebSocket 프레임 직렬화는 하지 않는다 (WS 항목은 목록엔 보이되 바디 없이 헤더 라인만 삽입).

## 사용자 시나리오

### 주 플로우 — 네트워크 응답 삽입
1. 리포터가 drafting 화면에서 발생 현상 섹션을 작성 중이다.
2. 섹션 헤더 우측 버튼그룹의 **로그 첨부 버튼**을 누른다.
3. 다이얼로그가 열린다. 상단 탭으로 네트워크/콘솔 전환, 하단은 기존 로그 뷰(필터·검색·origin 필터·좌측 리스트 / 우측 상세).
4. 문제된 요청을 클릭하면 하이라이트되고 우측에 상세(headers/request/response)가 뜬다. 응답을 눈으로 확인한다.
5. **확인(삽입)** 버튼을 누른다.
6. 다이얼로그가 닫히고, 발생 현상 에디터 커서 위치에 아래 형태의 코드블럭이 삽입된다:
   ```
   POST /api/orders/123 → 200
   --- payload ---
   { 정렬된 request body }
   --- response ---
   { "result": "FAILED", ... }
   ```
7. 제출하면 트래커 본문에 코드블럭으로 그대로 나타난다.

### 콘솔 로그 삽입
- 콘솔 탭에서 에러/경고 항목 선택 → 확인 → `[error] 메시지` + (error면 stack) 형태 코드블럭 삽입.

### 엣지 케이스
- **로그 없음**: 캡처된 네트워크·콘솔 로그가 둘 다 없으면 버튼은 비활성(disabled).
- **body 없음(GET 등)**: payload/response 섹션 중 없는 것은 생략, 헤더 라인만.
- **body가 JSON 아님**: 정렬 실패 시 raw 텍스트 그대로.
- **body descriptor**(truncated/binary/stream/omitted): 원문이 없으므로 `[truncated 5MB/1MB]` 같은 라벨 한 줄로 대체.
- **16KB 초과 body**: 16KB에서 자르고 `…(truncated)` 표시.
- **WebSocket 항목**: 목록엔 보이되, 삽입 시 `WS <url> → 101` 같은 헤더 라인만 (payload/response 섹션 없음).
- **Notion 제출**: 2000자를 넘는 코드블럭도 청킹으로 정상 제출된다.

## 성공 기준

- 발생 현상 섹션(및 기타 문단 섹션)에서 네트워크 로그 1건을 골라 삽입하면, 지정 포맷 코드블럭이 에디터에 들어간다.
- 삽입된 리포트를 Jira·GitHub·Linear·Notion·GitLab·Asana·ClickUp·Slack에 제출하면 코드블럭이 본문에 정상 렌더된다 (특히 Notion에서 2000자 초과 시에도 400 없이 제출 성공).
- 삽입된 코드블럭은 일반 텍스트라 이후 자유롭게 편집·삭제 가능하다.
- 순수 직렬화 함수의 단위 테스트가 통과한다 (JSON 정렬, body 없음, descriptor, truncate, WS, 콘솔 stack).
