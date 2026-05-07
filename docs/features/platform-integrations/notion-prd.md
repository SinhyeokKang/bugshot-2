# Platform Integrations — Notion 3차 (PRD)

## 배경

bugshot-2는 Jira / GitHub / Linear 3개 어댑터로 "요소 선택 → 이슈 등록" 흐름을 지원한다. Linear까지 도달하면서 어댑터 패턴(`PlatformId` union, `Accounts` dict, `BgRequest` namespace, ConnectForm/IssueFields/SubmitDialog 분기, settings/issues 마이그레이션)이 안정화됐다. Notion은 4번째 플랫폼으로, 이 패턴을 그대로 복제하되 두 가지 본질적 차이를 흡수한다.

Notion 도입 근거 + 핵심 차이:
- **이슈 트래커가 아니다**: 페이지/DB 시스템. v1 스코프는 "DB에 페이지 생성" 모델로 한정해 기존 어댑터와 1:1 매핑한다(부모 페이지 free-form 모드는 비목표).
- **블록 기반 본문**: Markdown 원본을 그대로 보내는 Linear와 달리 Notion은 `children: NotionBlock[]` 구조를 요구한다. 6종 block(heading_2/paragraph/code/image/bulleted_list_item/table)으로 변환한다.
- **OAuth long-lived bot token**: refresh token이 없는 대신 토큰 만료가 없다. proxy `/notion/token` 라우트만 신설하고 refresh 라우트·hook은 불필요.
- **PKCE 미지원**: 그래서 Linear와 달리 client_secret 보호용 proxy가 필요하다(GitHub 패턴에 가깝다).
- **외부 file_upload API GA**: 2024년 GA된 `/v1/file_uploads` 3-step 흐름(create → send → reference)으로 첨부를 실제 업로드. data:URI 인라인 불가.

## 목표

1. Notion에 페이지를 등록할 수 있다(Database 필수 + Title 자동 + Status select 옵션 + DB의 select/multi_select properties 동적 입력).
2. 인증 두 가지 모두 지원: OAuth(public integration, workspace 단위 install) + Internal Integration Token(워크스페이스 admin이 발급한 PAT 유사).
3. 사용자는 Jira·GitHub·Linear·Notion 네 플랫폼을 동시에 연결하고 등록 시 선택할 수 있다.
4. 본문이 Notion blocks(heading_2/paragraph/code/image/bulleted_list_item/table)로 변환되고, 이미지·영상·로그가 file_upload API로 실제 업로드된다.
5. IssueListTab에서 등록된 Notion 페이지의 Status를 다시 fetch해 갱신할 수 있다(DB에 Status 속성이 있을 때만).
6. 기존 Jira·GitHub·Linear 워크플로우는 회귀 없이 동일하게 동작한다.

## 비목표 (Non-goals)

- **부모 페이지 아래 자유 페이지 생성** — DB 모드만. free-form 모드는 후속.
- DB 스키마의 모든 타입 입력 UI — title/status/select/multi_select 4종만. text/number/date/people/url/checkbox 등은 후속.
- Notion 페이지 코멘트·@mention·동기 블록·임베드 등 고급 콘텐츠 기능.
- 페이지 제목 변경 동기화 — Status만 동기화(IssueListTab 새로고침).
- 다중 워크스페이스 동시 연결 — 1 워크스페이스만.
- 양방향 동기화·webhook·Notion 측 수정 알림.
- file_upload size 초과(이미지 5MB) 자동 분할 — 초과 시 인라인 제외하고 첨부 섹션으로 fallback만.
- Notion ADF 블록(callout/toggle/quote/divider 등 미지원 block) — table 포함 6종에서 종료.

## 사용자 시나리오

1. **Notion OAuth 연결**: 사이드패널 → [연동] 탭 → [Notion] sub-tab → "Notion으로 연결" 버튼 → `chrome.identity.launchWebAuthFlow`로 authorize URL 새 창. 사용자가 워크스페이스 + integration이 접근할 페이지를 선택 후 승인 → 콜백 code → proxy `/notion/token` 경유 access_token 교환 → "Workspace 이름 + Bot 이름" 카드 표시.
2. **Internal Integration Token 연결**: 동일 sub-tab의 "Internal Token" 다이얼로그에 token 붙여넣기 → `GET /v1/users/me`(`Authorization: Bearer <token>`) 검증 → 연결됨. SettingsTab에 "Notion 워크스페이스에서 페이지에 integration을 connect 해야 등록 가능"이라는 주의 텍스트 명시.
3. **이슈 등록 (4 플랫폼 활성)**: Jira/GitHub/Linear/Notion 모두 연결. 등록 다이얼로그 상단 4-tab. Notion 선택 시:
   - Database 콤보박스(필수): 사용자 입력 query → `POST /v1/search`로 DB 검색.
   - DB 선택 → schema fetch(`GET /v1/databases/{id}`) → Status select(있을 때만) + select/multi_select properties 동적 렌더.
   - 등록 → 본문이 Notion blocks 6종으로 변환 → 첨부는 file_upload API로 업로드(이미지는 본문에 image block 인라인, 영상·로그는 본문 끝 "## 첨부" heading 아래 file block) → `POST /v1/pages` → 토스트에 페이지 URL.
4. **본문 내용**: heading_2/paragraph/code/image/bulleted_list_item/table 6종. 빈 paragraph 섹션은 `(없음)`(`md.noValue`)로 통일.
5. **Status 동기화**: IssueListTab에서 Notion entry의 새로고침 → `GET /v1/pages/{page_id}` → properties에서 Status 추출. DB에 Status 없으면 `last_edited_time`만 갱신.
6. **OAuth 만료/integration 제거**: 등록 시 401 → `notion-api.ts`가 `OAuthError({ platform: "notion" })` throw → BG가 `body.platform: "notion"` + `body.oauthRefreshFailed: true` 직렬화 → App.tsx의 `onOAuthExpired` AlertDialog가 "Notion" 레이블로 재인증 안내, IntegrationsTab/[Notion] 이동.
7. **기존 사용자 업그레이드**: Jira/GitHub/Linear 연결 보존. [Notion] sub-tab에 빈 온보딩 UI. settings v5→v6 + issues v4→v5는 additive 마이그레이션(데이터 변환 없음, 멱등 가드).

## 성공 기준

- Notion OAuth 연결 → 임의 DB 1개에 페이지 등록 → 본문에 heading/paragraph/image/table 정확히 변환되어 Notion UI에서 정상 렌더.
- Internal Token 연결 → 동일 시나리오 통과.
- 이미지 첨부: 본문 내 image block으로 인라인. 영상·로그·기타: 본문 끝 file block.
- DB에 Status 속성이 있는 경우: 등록 시 Status 옵션 선택 + 등록 후 새로고침으로 상태 갱신.
- DB에 Status 속성이 없는 경우: Status select UI 비노출, 새로고침은 `last_edited_time`만 갱신.
- 4 플랫폼 동시 연결 → 같은 draft를 네 곳 각각 등록 가능.
- `settings-store` v5→v6, `issues-store` v4→v5 마이그레이션: 기존 사용자 회귀 없음.
- `PlatformId` union에 `"notion"` 추가, `getOAuthErrorPlatform`/`PLATFORM_FALLBACK_ORDER`/`PLATFORM_TAB_KEYS` 등 union을 좁게 검사하는 곳 모두 갱신.
- 단위 테스트: notion-api(error mapping/header), notion-oauth(callback parsing/취소 화이트리스트), buildNotionIssueBody(6종 block + attachment 분기 + table), initialNotionFields(우선순위), settings-store(v5→v6).
- i18n: ko/en 키 패리티 유지(`locales.test.ts` 통과).
- 기존 Jira·GitHub·Linear 단독 사용자 회귀 없음.
