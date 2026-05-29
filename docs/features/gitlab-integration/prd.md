# GitLab 연동

## 배경

bugshot-2는 현재 Jira·GitHub·Linear·Notion 4개 이슈 트래커로 버그 리포트를 등록할 수 있다. GitLab은 셀프호스팅·SaaS 양쪽에서 널리 쓰이는 이슈 트래커이며, 특히 사내 GitLab(self-managed)을 쓰는 팀은 현재 어떤 연동도 쓸 수 없다. GitLab을 5번째 플랫폼으로 추가해 커버리지를 넓힌다.

## 목표

- GitLab을 기존 4개 플랫폼과 **동일한 UX 수준**(GitHub 풀세트)으로 추가한다: 프로젝트 선택 + 라벨 + 담당자 + 스크린샷/영상 첨부 + 이슈 상태 추적/업데이트.
- **gitlab.com(SaaS)과 self-managed(자체 호스팅)를 모두** 지원한다. 둘은 별개 플랫폼이 아니라 같은 `gitlab` 플랫폼의 base URL 변형으로 처리한다.
- 인증은 **OAuth(PKCE)** 와 **Personal Access Token(PAT)** 두 경로를 모두 제공한다.
- 기존 플랫폼의 어댑터·메시지·스토어·UI 패턴을 그대로 따른다. 새 추상화·공유 인터페이스를 도입하지 않는다. (단 첨부 업로드는 정식 `/uploads` REST API가 있어 GitHub의 page injection이 아닌 **Linear의 `uploadFile` 패턴**이 가장 가까운 선례 — 첨부 메커니즘은 Linear를 미러한다.)

## 비목표 (Non-goals)

- GitLab **milestone·epic·iteration** 지원 — GitHub 수준(라벨·담당자)에 맞춘다. milestone은 이번 스코프 제외.
- self-managed 인스턴스의 **OAuth 지원** — OAuth는 gitlab.com 전용. self-managed는 PAT로만 연결한다. (인스턴스마다 OAuth App·client ID가 따로라 우리 client ID로는 불가)
- GitLab **Merge Request·Wiki·Snippet** 등 이슈 외 객체 등록.
- 기존 4개 플랫폼 코드의 리팩터 — GitLab 추가에 필요한 분기만 더한다.
- 다중 담당자 — GitHub와 동일하게 단일 담당자 1명(GitLab API는 `assignee_ids[]` 배열이지만 UI는 1명만 노출).

## 사용자 시나리오

> 연동 탭 리디자인 이후 진입 경로: 설정 > 연동 탭 > **플랫폼 추가** 하위 탭에 `[GitLab 연결]` 행 버튼이 있다. 클릭 시 OAuth/토큰 두 수단이 모두 가능하면 공용 **`ConnectMethodDialog`**로 선택, OAuth 미설정(`VITE_GITLAB_CLIENT_ID` 없음)이면 수단이 토큰 1개라 컨펌 생략하고 PAT 다이얼로그가 바로 열린다. 연결 성공 시 **"내 연동"** 하위 탭으로 자동 전환되어 GitLab 섹션이 나타난다.

### 시나리오 A: gitlab.com OAuth 연결

1. **플랫폼 추가** 탭에서 `[GitLab 연결]` 클릭 → `ConnectMethodDialog`에서 **`OAuth로 연결`** 선택.
2. `chrome.identity.launchWebAuthFlow`로 gitlab.com 인증 → 토큰 교환(PKCE) → 본인(`/user`) 조회 → 연결 완료. "내 연동" 탭의 연결 카드에 username·email 표시.

### 시나리오 B: PAT 연결 (gitlab.com 또는 self-managed)

1. `[GitLab 연결]` 클릭 → `ConnectMethodDialog`에서 **`Personal Token`** 선택(OAuth 미설정 시 컨펌 없이 바로) → 다이얼로그 오픈.
2. 다이얼로그에 입력 필드 2개:
   - **Instance URL** (기본값 `https://gitlab.com`, 비우면 gitlab.com으로 간주)
   - **Personal Access Token** (`glpat-…`)
   - "토큰 받기" 링크는 `${instanceUrl}/-/user_settings/personal_access_tokens`로 동적 생성.
3. 확인 → (self-managed면) 해당 origin 런타임 권한 요청 → `${baseUrl}/api/v4/user`로 토큰 검증 → 성공 시 `auth = { kind: "pat", pat, baseUrl, viewerUsername }` 저장.
4. 분기는 **토큰 문자열이 아니라 Instance URL 필드값**으로 결정. gitlab.com이면 SaaS, 그 외면 self-managed. 이후 모든 API 호출이 이 base URL 기준.

### 시나리오 C: 이슈 등록

1. 요소/스크린샷/영상/로그 캡처 후 이슈 작성 화면 진입.
2. GitLab 선택 시 필드: **프로젝트**(필수, 콤보박스 검색) + **라벨**(선택) + **담당자**(선택).
3. 제출 → `POST /projects/:id/uploads`로 첨부 업로드(스크린샷·영상·인라인 이미지·로그) → 반환된 마크다운을 본문에 인라인 → `POST /projects/:id/issues`로 이슈 생성.
4. 등록 후 결과 카드에 이슈 IID(`#123`)와 web URL 표시.

### 시나리오 D: 상태 추적

1. 등록된 이슈 목록에서 GitLab 이슈 배지가 현재 상태(opened/closed)를 표시. (자동 폴링이 아니라 기존 플랫폼과 동일하게 사용자 트리거 refresh 시 조회.)
2. 배지에서 close/reopen 액션 → `PUT /projects/:id/issues/:iid { state_event }`.

### 엣지 케이스

- **self-managed 권한 거부**: PAT 연결 시 런타임 권한(`chrome.permissions.request`)을 거부하면 연결 실패 토스트.
- **OAuth 미설정**: `VITE_GITLAB_CLIENT_ID` 누락 시 `connectMethods(false)===["token"]`라 `ConnectMethodDialog`를 거치지 않고 `[GitLab 연결]` 클릭이 곧장 PAT 다이얼로그를 연다(리디자인 단일수단 패턴). 기존 플랫폼과 동일.
- **토큰 만료**: OAuth access token 만료 시 refresh token으로 자동 갱신(GitHub/Linear 동일 패턴). PAT는 만료 없음(혹은 사용자가 만료 설정 시 401 → 재연결 안내).
- **프로젝트 미선택 제출 시도**: GitHub의 `requireRepo`와 동일하게 제출 차단 + 안내.
- **대용량 첨부 업로드 제한 초과**: gitlab.com `/uploads`는 기본 10MB(self-managed는 인스턴스마다 가변), 30s Replay MP4가 자주 초과한다. Linear의 `submitToLinear` 패턴처럼 **첨부 업로드 실패는 격리**(`.catch`)해 이슈 자체는 생성하고 실패한 첨부만 토스트로 안내한다. 첨부 1건 실패가 이슈 생성 전체를 실패시키지 않는다.

## 성공 기준

- gitlab.com OAuth/PAT, self-managed PAT 3가지 경로로 연결 가능.
- 프로젝트·라벨·담당자 선택 후 첨부(스크린샷+영상+인라인+로그) 포함 이슈가 GitLab에 생성되고, 본문에 이미지가 인라인 렌더된다. (업로드 제한 초과 첨부는 격리되어 이슈는 생성되고 해당 첨부만 실패 안내된다.)
- 등록 이슈의 상태 배지가 opened/closed를 정확히 표시하고(refresh 시 조회), close/reopen이 동작한다.
- `pnpm typecheck` 통과(모든 exhaustive switch에 gitlab 분기 추가됨), `pnpm test` 통과(gitlab-api 순수 함수 단위 테스트 포함).
- 기존 4개 플랫폼 동작에 회귀 없음.
