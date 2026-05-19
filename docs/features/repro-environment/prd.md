# 재현 환경 섹션 + drafting 패널 어코디언

## 배경

이슈 본문에는 이미 "재현 환경"(Environment) 섹션이 들어간다 — `buildIssueMarkdown`/`buildIssueAdf`/`buildGithubIssueBody`/`buildLinearIssueBody`/`buildNotionIssueBody`가 본문 최상단에 Page URL · DOM 선택자(element 한정) · 뷰포트 · 캡처 시각을 자동으로 넣는다. 그러나 drafting 패널(`DraftingPanel.tsx`)에는 이 환경 정보가 **표시되지 않고**, 사용자가 OS·브라우저 버전·계정·기기 같은 추가 맥락을 넣을 방법도 없다.

또한 drafting 패널은 제목·재현 과정·기대 결과·미디어·로그 등 섹션이 모두 항상 펼쳐져 있어 화면이 과중하다. styling 패널(`StyleEditorPanel`)은 `Section` 컴포넌트의 `collapsible` 기능으로 섹션을 접을 수 있는데 drafting 패널은 그 기능을 쓰지 않는다.

## 목표

- drafting 패널 제목 섹션 바로 아래에 "재현 환경" 섹션을 추가한다.
- 각 캡처 모드가 자동 수집한 환경 메타(Page URL, DOM 선택자, 뷰포트, 캡처 시각 — 이슈 Environment 섹션과 동일 항목)를 **readonly row**로 보여준다. 수정·삭제 불가.
- 사용자가 **custom row**(Label + Value 한 쌍)를 자유롭게 추가/삭제할 수 있다. 개수 제한 없음.
- 각 row는 Label 입력(고정 너비 200~300px)과 Value 입력(나머지 너비 가득)을 인라인 1×1로 배치한다.
- custom row는 최종 제출되는 이슈 본문의 Environment 섹션에 bullet으로 포함된다 (5개 빌드 함수 전부).
- drafting 패널의 모든 섹션(제목 섹션 제외)에 접기/펼치기 UI를 추가한다. `Section` 컴포넌트의 기존 `collapsible` 패턴을 그대로 쓴다.

## 비목표 (Non-goals)

- readonly 메타의 수정/삭제 기능 — 자동 수집 값은 불변.
- 환경 메타 자동 수집 항목 확대 (userAgent, OS 등 신규 수집) — 이번 스코프 아님. custom row로 사용자가 직접 적는다.
- custom row의 타입·검증 (선택지, 형식 강제) — 자유 텍스트 label/value.
- 접힘 상태의 영속화 — styling 패널과 동일하게 로컬 컴포넌트 상태. 패널 재마운트 시 기본값으로 리셋.
- 제목 섹션의 collapse — 필수 입력이라 항상 펼침.
- AI 메타 주석(`buildMetaComment`의 숨김 JSON)에 custom row 추가 — 본문 Environment 섹션에만 반영.

## 사용자 시나리오

### 주요 플로우
1. 사용자가 캡처(요소/화면/영상/자유작성) 후 drafting 패널에 진입한다.
2. 제목 섹션 아래에 "재현 환경" 섹션이 있다. 기본 접힘 상태다.
3. 섹션을 펼치면 readonly 메타 row(Page URL, 뷰포트, 캡처 시각, element 모드면 DOM)가 보인다.
4. "행 추가" 버튼을 눌러 custom row를 추가하고 Label에 "브라우저", Value에 "Chrome 140 / macOS 15"를 입력한다.
5. 필요 없는 custom row는 행 우측 휴지통 버튼으로 삭제한다.
6. 미리보기/제출 시 이슈 본문 Environment 섹션에 `- **브라우저**: Chrome 140 / macOS 15`가 포함된다.

### 섹션 접기
1. drafting 패널의 재현 과정·미디어·로그 등 섹션 헤더 우측의 토글 버튼을 눌러 접는다.
2. 화면이 정리돼 원하는 섹션만 펼쳐 작업한다.

### 엣지 케이스
- **custom row 0개**: "재현 환경" 섹션엔 readonly 메타만. custom row 영역은 "행 추가" 버튼만 보인다.
- **Label 또는 Value가 빈 custom row**: drafting 패널엔 입력한 그대로 유지되나, 이슈 본문 빌드 시 제외된다.
- **뷰포트 미수집(freeform에서 executeScript 실패 등)**: 뷰포트 readonly row를 생략한다.
- **AI 초안 생성**: AI가 제목·섹션 본문을 덮어써도 custom row(`draft.environment`)는 보존된다.
- **저장된 초안 재오픈**: 이전에 입력한 custom row가 복원된다. `environment` 필드가 없는 구 초안은 빈 배열로 처리.

## 성공 기준

- drafting 패널 제목 아래에 "재현 환경" 섹션이 보이고, 모드별 readonly 메타가 이슈 Environment 섹션과 동일하게 표시된다.
- custom row 추가/삭제가 동작하고, 입력 내용이 세션 영속화되며 미리보기/제출 이슈 본문 Environment 섹션에 반영된다 (Jira·GitHub·Linear·Notion 전부).
- 제목 외 모든 drafting 섹션에 접기 토글이 있고, 재현 환경 섹션만 기본 접힘·나머지는 기본 펼침이다.
- `filterEnvironmentRows` 등 순수 함수 단위 테스트 + 빌드 함수 테스트(custom row 포함/빈 row 제외)가 통과하고 `pnpm typecheck` 클린.
