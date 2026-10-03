# B6 provider contract research

조사일: 2026-10-04 KST. supporting research only — 최종 독립 승인 아님. 소스·테스트는 읽기만 했으며 설치/빌드/테스트/실계정 요청은 하지 않았다. 이 보고서만 작성했다. 기준: `docs/features/attachment-failure-recovery/design.md`의 Phase 2 및 accountIdentity 표, 현재 background API/OAuth 코드.

## 결론과 남은 검증

- Slack complete 응답 유실뿐 아니라 `internal_error`/`fatal_error`도 일부 실행 가능성이 문서화돼 있다. 일반 실패로 재업로드하지 말고 ambiguous로 보존해야 한다.
- Notion 업로드 ID와 조회된 파일 블록의 동일성을 추측하지 않는다. `file_upload.id`가 쓰기 입력에 존재한다는 사실만으로 조회 응답에도 그대로 남는다고 보장할 수 없다. append 응답 ID를 잃고 대상을 확정할 근거가 없으면 재append 금지다.
- GitHub numeric ID와 Linear organization ID는 API가 제공하므로 저장 필드 누락을 API 불가로 분류하면 안 된다. Notion 최신 `/users/me`도 `bot.workspace_id`를 제공하지만 고정 `2022-06-28`의 필드 제공 여부는 별도 확인이 남는다.
- Notion `after`는 구버전 공식 SDK에서도 확인된다. 다만 이번 구현은 설계대로 위치 인자 없는 끝 append를 기본으로 하고, 최신 `position`을 쓰거나 API 버전을 올릴 이유는 없다.

## 1. Notion: 버전·블록 계약

**문서 사실.** [children 조회](https://developers.notion.com/reference/get-block-children)는 첫 단계 자식만 반환하고 `start_cursor`, `page_size`, `has_more`, `next_cursor`로 페이지를 순회한다. 요청 수보다 적게 반환될 수 있으므로 결과 개수로 끝을 판단하지 않는다. 중첩 위치를 검색해야 할 때만 `has_children`에 따라 재귀 조회한다. read content capability가 필요하며 접근 불가도 404가 될 수 있다.

**고정 버전 근거.** 공식 SDK [v2.2.15 Client.ts](https://github.com/makenotion/notion-sdk-js/blob/v2.2.15/src/Client.ts#L128)는 default version이 `2022-06-28`이다. 같은 버전 [api-endpoints.ts](https://github.com/makenotion/notion-sdk-js/blob/v2.2.15/src/api-endpoints.ts#L10850)는 list의 cursor/page_size와 append body의 `children`, optional `after`를 정의한다. 이는 구버전 클라이언트 계약의 직접 근거이나 현재 실계정 서버 호환성 실증은 아니다.

**문서 사실.** [append](https://developers.notion.com/reference/patch-block-children)는 기본으로 마지막에 추가하고 요청당 자식 100개 이하, insert content capability를 요구한다. 최신 문서는 `position` 및 deprecated `after`를 설명한다. 반환 결과는 새 블록 ID를 포함한다. [update](https://developers.notion.com/reference/update-a-block)는 블록 타입에 맞는 필드를 갱신하며 주어진 필드는 통째 교체한다. children 갱신은 이 endpoint가 아니라 append로 한다. [delete](https://developers.notion.com/reference/delete-a-block)는 휴지통 이동이며 update content capability가 필요하다. 최신 `in_trash` 표현을 구버전 응답 필수 필드로 강제하지 않는다.

**메시지/체크포인트 함의.** pageId 기반 children 조회 메시지는 모든 페이지를 읽어야 한다. append 메시지는 100개 이하 배치 및 기본 끝 추가로 제한한다. 배치 성공마다 blockId를 내구 저장하고 다음 배치로 진행한다. paragraph→image 타입 전환 대신 새 image/file/video 블록을 추가한다. 실패 안내는 재조회한 내용이 우리가 기록한 안내와 정확히 일치할 때만 삭제하고, 삭제 실패는 첨부 재업로드로 되돌리지 않는다. create 성공은 read/update capability 증거가 아니다. 403/404를 “없으니 새로 추가”로 해석하지 않는다.

**미검증.** 고정 버전에서 현재 file upload 관련 응답 형태 및 `after` 실동작, 해당 연결의 read/insert/update capability. 위 fixture는 문서 기반 테스트를 가능하게 하지만 실권한을 입증하지 않는다.

## 2. Notion: 업로드 만료와 재조정

**문서 사실.** [FileUpload](https://developers.notion.com/reference/file-upload)의 상태는 pending/uploaded/expired/failed이며 `expiry_time`은 nullable이다. [직접 업로드 가이드](https://developers.notion.com/docs/uploading-small-files#file-lifecycle-and-reuse)는 최초 생성 후 한 시간 안에 연결해야 하며, 한번 연결되면 만료가 제거되고 같은 ID를 재사용할 수 있다고 설명한다. [upload 조회](https://developers.notion.com/reference/retrieve-file-upload)는 `GET /v1/file_uploads/{file_upload_id}`로 상태를 읽는다. [file object](https://developers.notion.com/reference/file-object)는 Notion-hosted `file.url`과 URL의 만료, 쓰기용 `file_upload.id`, 외부 URL 타입을 구분한다. [block 조회](https://developers.notion.com/reference/retrieve-a-block)로 이미 연결된 파일의 다운로드 URL을 다시 얻을 수 있다.

**추론/안전 경계.** `expiry_time:null`은 어딘가에 연결됐다는 증거이지 목표 page의 목표 블록에 붙었다는 증거는 아니다. 파일 이름·크기만 같거나 signed URL 경로가 닮았다는 이유로 같은 파일이라고 판정하지 않는다. 현재 공식 문서만으로 append 후 children GET이 원래 `file_upload.id`를 돌려주는 안정적 round-trip을 입증하지 못했다. 따라서 조회·파일 매칭 메시지는 확인 불가 결과를 표현해야 하며 “못 찾음=미첨부”를 단정하면 안 된다.

**체크포인트.** upload ID, 서버 expiry(또는 null), status, append 반환 block ID만 필요한 범위에서 저장한다. 기존 `notion-api.ts:createFileUpload`는 expiry를 읽지만 생성 응답형은 string으로 잡혀 있다; retrieve용 DTO에서는 nullable 계약을 별도로 반영한다. 업로드 성공과 페이지 연결 성공을 분리한다. 오래된 로컬 expiry만 보고 이미 연결된 파일을 재업로드하지 않는다. 미연결 만료가 확정된 경우에만 보존 Blob으로 새로 업로드한다. signed upload/download URL이나 응답 전체를 journal에 저장하지 않는다.

## 3. Slack: 단계 분리와 ambiguous 범위

**문서 사실.** [grant](https://docs.slack.dev/reference/methods/files.getUploadURLExternal/)는 file ID와 업로드 URL을 반환한다. bytes는 그 URL에 POST(raw 또는 multipart)하며 문서상 성공은 HTTP 200이다. 그 뒤 [complete](https://docs.slack.dev/reference/methods/files.completeUploadExternal/)를 실행한다. complete는 업로드당 한번만 호출 가능하고, 생략하면 업로드와 메타데이터가 폐기된다. channel을 생략하면 private이며 `thread_ts`는 답글의 ts가 아닌 부모 ts, 한 채널을 사용한다. HTTP 성공만 아니라 API `ok`를 확인한다. 같은 문서의 internal_error/fatal_error는 일부 작업이 이미 성공했을 수 있음을 명시한다.

**현재 코드.** `slack-oauth.ts:USER_SCOPES`는 chat:write, channels:read, groups:read, im:read, mpim:read, files:write, users:read다. [files.info](https://docs.slack.dev/reference/methods/files.info/)에는 files:read가 필요하다. [conversations.replies](https://docs.slack.dev/reference/methods/conversations.replies/)는 대화 유형에 맞는 history scope가 필요하다. 채널 목록 read는 history 권한이 아니다. 현재 `slack-api.ts:uploadFiles`는 bytes 뒤 ok를 만들고 complete 예외를 link 실패로 바꾸므로 단계형 recovery에서는 이 실패 묶음을 그대로 retryable로 쓰면 안 된다.

**권고하는 메시지 경계.** grant→(fileId 내구 저장)→bytes→(bytes 확인 저장)→complete 준비 상태 내구 저장→complete→성공 확인 저장. upload URL은 worker/background 실행 메모리에만 둔다. 이 상태 기록은 중단 위치를 보존할 뿐 exactly-once 원격 호출을 보장하지 않는다. complete 직전 기록 뒤 중단도 실제 발송 여부를 모르면 ambiguous다. complete 응답 유실·연결 중단·불명확한 서버 오류에서는 자동 complete 재호출 및 새 ID 재업로드를 모두 멈춘다. 명확한 pre-complete 실패만 새 grant로 재시도한다. 기존 channelId/parent ts를 고정하고 새 부모/상세 메시지를 만들지 않는다. 현재 scope로 확인할 수 없는 결과는 스레드 열기/다운로드로 남긴다. scope 추가는 이번 범위 밖이다.

## 4. GitHub / Linear

**GitHub 문서 사실.** [Update an issue](https://docs.github.com/en/rest/issues/issues#update-an-issue)는 PATCH `/repos/{owner}/{repo}/issues/{issue_number}`이며 body는 선택 필드다. issue owner 또는 push/Triage 권한 사용자가 편집할 수 있다; fine-grained token에는 Issues write 또는 Pull requests write가 필요하다. 따라서 기존 이슈를 GET한 뒤 `{body: patchedBody}`만 PATCH하며 title/state/labels/assignees를 보내지 않는다. 만들 수 있다는 사실이 모든 기존 이슈 편집 가능성을 뜻하지 않는다. 본문 PATCH 실패에서도 이미 업로드한 파일 URL/ID는 보존한다. 이 문서에서 조건부 PATCH 보장을 확인하지 못했으므로 임의 If-Match 헤더로 경쟁 편집 방지를 보장하지 않는다.

**Linear 문서 사실.** [GraphQL guide](https://linear.app/developers/graphql)는 issueUpdate에서 success를 조회하며 HTTP 200에도 GraphQL errors가 존재할 수 있다고 설명한다. [공식 schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql)의 IssuePayload에는 operation 성공 여부인 `success:Boolean!`가 있다. `{issueUpdate:{success:false}}`는 완료 체크포인트를 만들 수 없다. success 누락/null도 확인되지 않은 성공이다. 현재 description update의 `success !== true` 방어를 유지한다. `{description}`만 update input에 넣고 파일 업로드/attachment 생성/본문 갱신을 각각 기록한다. [OAuth scope](https://linear.app/developers/oauth-2-0-authentication)는 read와 write, issues:create를 구분하며 현재 OAuth 코드는 세 scope를 요청한다; 제한된 API key의 실제 권한은 별도다.

## 5. accountIdentity: 저장 누락과 제공 불가 구분

| 대상 | 공식 응답/현재 관찰 | 처리 함의 |
|---|---|---|
| GitHub | [GET /user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)의 numeric id. 현재 getMyself도 이미 raw.id를 반환. [공식 durable ID 지침](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app#use-the-durable-unique-id-to-store-the-user)은 user ID가 바뀌거나 타 사용자로 재사용되지 않는다고 명시 | 저장 누락이지 API 불가가 아님. 기존 credential로 읽어 저장; login/email fallback 금지. 새 scope 불필요 |
| Linear | [공식 schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql) Query.organization:Organization!, Query.viewer:User!, 양쪽 id 제공. `query { viewer { id } organization { id } }` 가능. 현재 getMyself는 viewer만 요청 | organization ID 저장 누락을 보완할 읽기 경로가 있음. OAuth read는 위 공식 scope 문서상 기본. 팀 ID/조직 이름을 organization ID로 대체하지 않음. 실제 API key 거부는 capability 실패로 표시 |
| Notion OAuth | [token 응답](https://developers.notion.com/reference/create-a-token)의 workspace_id + bot_id가 현재 저장됨 | 두 ID를 사용. owner 이름/이메일 불가. bot ID가 바뀐 재설치는 보수적으로 다른 연결로 취급 |
| Notion API key | [GET /users/me](https://developers.notion.com/reference/get-self)는 모든 capability 수준에서 호출 가능. 최신 schema의 top-level id는 bot user ID, bot.workspace_id는 workspace ID. [user 문서](https://developers.notion.com/reference/user)도 설명. 현재 NotionUserResponse/getMyself 및 ApiKeyAuth는 이 ID들을 버림 | “API key로 workspace ID를 절대 얻을 수 없음”은 최신 문서와 맞지 않음. 다만 2022-06-28 공식 구 SDK의 bot 응답형에는 workspace_id가 없었으므로 현재 고정 버전 제공 여부는 실응답 fixture가 필요. 고정 버전 조회에서 두 값이 확인되면 저장, 누락되면 identity unavailable로 fail closed. 토큰 hash/이름/임의 workspace 추론 및 버전 변경 금지 |
| Slack | [User object](https://docs.slack.dev/reference/objects/user-object/)는 display_name 대신 id+team_id 사용을 권고 | 저장된 team+user를 사용. 파일 읽기 권한이나 대화 접근성을 identity 일치만으로 추정하지 않음 |

그 외 Jira cloudId+accountId, GitLab baseUrl+user ID, Asana workspace gid+user gid, ClickUp team+user ID는 이번 조사에서 반대 계약을 발견한 대상이 아니며, 이 보고서가 각 제공자의 모든 ID 생명주기를 인증한 것은 아니다. 모든 플랫폼에서 identity 일치는 계정 혼동 방어이지 원격 대상 read/write 권한 검증의 대체가 아니다. 과거 journal에 identity가 없으면 현재 계정 ID를 역으로 채워 원래 작성자라고 단정할 수 없다.

## 6. 후속 검증 목록 (실행하지 않음)

1. Notion 2022-06-28 fixture: children 다중 페이지, append 응답/후속 GET의 파일 참조 모양, fileUpload retrieve nullable expiry, API-key users/me의 bot.workspace_id. 파일 일치가 불명확하면 fail closed가 green 조건.
2. Notion 권한 분리: create 성공이어도 read/update가 거절되는 경우 첨부 중복 없이 안내/다운로드.
3. Slack grant 후 중단, bytes 후 중단, complete 준비 기록 후 중단, 응답 유실, internal_error/fatal_error를 각각 구분. complete 자동 재호출은 0회.
4. GitHub PATCH payload 키 body 단독; Linear HTTP 200+success:false/errors에서 완료 없음.
5. ID 저장/조회 보강은 기존 scope만 사용하고 누락된 과거 identity는 불명확 상태로 유지. signed URL 및 token이 journal, 보고서, 에러 문자열에 유입되지 않는지 확인.
