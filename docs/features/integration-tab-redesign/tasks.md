# 연동 탭 UX 개편 — 구현 태스크

## 선행 조건

- 권한·manifest·env 변경 없음.
- shadcn 컴포넌트(`Section`, `AlertDialog`, `Dialog`, `Card`, `Button`)는 이미 설치됨. 신규 설치 불필요.
- 변경 전 `grep -rn "ConnectForm" src` 로 4개 플랫폼 `ConnectForm`이 `IntegrationsTab`에서만 import되는지 재확인.
- **`oauth.available` 메시지 타입은 플랫폼별 비대칭**(`oauth.available` / `github.oauth.available` / `linear.oauth.available` / `notion.oauth.available`). Task 3에서 4개 ConnectFlow를 병렬 작업할 때 각자 자기 메시지 타입을 그대로 보존할 것 — 공용화 유혹에 빠지면 회귀.

## 태스크

### Task 1: i18n 키 추가
- **변경 대상**: `src/i18n/namespaces/app.ts` (ko/en 블록 동시)
- **작업 내용**: design.md "i18n" 절의 신규 키 추가
  (`platform.subtab.connected`, `platform.subtab.add`, `platform.add.title`, **`platform.add.empty.title`, `platform.add.empty.body`**, `platform.connectPlatform`, `platform.connectMethod.title/body/oauth`).
  - **빈 상태 키는 신규로 판다**: 기존 `platform.empty.*`는 PreviewPanel·DraftDetailDialog·IssueCreateModal에서 "연동 탭으로 가라"는 안내라 연동 탭 *내부* 빈 상태로 재사용 불가(자기참조). 기존 키는 수정하지 않는다.
- **검증**:
  - [ ] ko/en 양쪽에 동일 키 존재, `{platform}` placeholder 일치
  - [ ] 기존 `platform.empty.*` 미수정 확인
  - [ ] PostToolUse 훅(`locales.test.ts`) 통과

### Task 2: `ConnectMethodDialog` 공용 컴포넌트
- **변경 대상**: `src/sidepanel/tabs/connect/ConnectMethodDialog.tsx` (신규)
- **작업 내용**: **`Dialog` 기반**(`AlertDialog` 아님) OAuth/토큰 선택 다이얼로그. design.md 시그니처대로. 두 버튼은 기존 입력 다이얼로그의 `DialogFooter` 패턴대로 가로 배열·우측 정렬. OAuth 버튼 → `onChooseOAuth`, 토큰 버튼 → `onChooseToken`, 둘 다 선택 후 `onOpenChange(false)`. `DialogTitle`=`platform.connectMethod.title`, 설명=`platform.connectMethod.body`.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 두 버튼 클릭 시 각 콜백 호출 + 닫힘 (수동)
  - [ ] ~400px 폭에서 두 버튼 가로 배치 줄바꿈/잘림 없음 (수동)

### Task 3: 각 ConnectForm을 `*ConnectedBody` + `*ConnectFlow`로 분리
- **변경 대상**: `connect/JiraConnectForm.tsx`, `GithubConnectForm.tsx`, `LinearConnectForm.tsx`, `NotionConnectForm.tsx`
- **작업 내용**: design.md "변경 범위"대로 각 파일에서
  - `*ConnectedBody` export: 기존 connected 분기의 Summary + 설정 필드를 외곽 `PageScroll`/`Section` 없이 반환. (Jira는 `SetupDialog` 포함)
  - `*ConnectFlow({ connected, onConnected })` export: 행 버튼 + `*.oauth.available` 조회 + 분기(둘 다 가능→`ConnectMethodDialog`, 토큰만→토큰 다이얼로그 직접 오픈) + 기존 토큰 다이얼로그/OAuth 시작 로직 이동. 분기 판정은 `connectMethods(oauthAvailable)` 순수 함수 사용(`[] `=조회 중→버튼 disabled).
  - **GitHub/Linear/Notion ConnectFlow는 단순**: 사이트 선택 단계가 없으므로 OAuth 성공/토큰 검증 성공 → `setAccount` → `onConnected` 단순 흐름. **Jira만** 사이트 선택 2단계(`JiraSiteDialog`)를 추가로 가진다. 4종을 동일 형태로 과잉 일반화하지 말 것(대안 C 기각 사유).
  - **`onConnected()` 호출 시점**: 연결이 실제 완료된 시점(`setAccount` 직후)에서만 1회. 토큰=검증 성공 직후, OAuth 단일 사이트=`finalize` 직후. **Jira 다중 사이트=사이트 선택 다이얼로그 닫히고 `finalize` 끝난 뒤에만**. OAuth 응답/사이트 다이얼로그 오픈 시점에 미리 호출 금지(중간 탭 전환으로 다이얼로그 끊김). `setAccount` → `onConnected`는 동일 렌더 사이클 동기 연속 호출(중간 await 금지).
  - 기존 `*ConnectForm`, `*Onboarding` 제거.
  - Jira: 인라인 `candidate` 사이트 목록 → `Dialog`(`JiraSiteDialog`, 같은 파일 내부 컴포넌트 허용)로 이전, `jira.selectSite` 재사용. `DialogTitle` 필수.
  - SetupDialog는 `JiraConnectedBody`가 소유(끌어올리지 않음). `sub="connected"` 마운트 후 `projectKey` 없음 effect로 자동 오픈.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 각 플랫폼 OAuth/토큰 연결 → store에 account 저장 (수동, 탭 4종)
  - [ ] `oauthAvailable === null`(조회 중)에 행 버튼 disabled — 조회 전 클릭으로 잘못된 분기 안 됨 (수동)
  - [ ] Jira 다중 사이트 계정에서 사이트 선택 다이얼로그 동작 (수동)
  - [ ] **Jira 연결 직후 아직 "플랫폼 추가" 탭에 있어도** projectKey 없으면 "내 연동" 전환 후 SetupDialog 자동 오픈, 취소 시 해제 (수동)

### Task 4: `IntegrationsTab` 재구성
- **변경 대상**: `src/sidepanel/tabs/IntegrationsTab.tsx`
- **작업 내용**:
  - 플랫폼 메타 배열(`id/Icon/ConnectedBody/ConnectFlow/iconClassName`) 정의.
  - "내 연동" / "플랫폼 추가" 두 하위 탭(`Tabs` 또는 단순 분기 + `data-[state=inactive]:hidden`).
  - **내 연동**: `connectedPlatforms(accounts)` 순회 → 플랫폼별 `Section`(collapsible, defaultOpen, title=아이콘+이름, action=연동 해제 `AlertDialog` `h-8 w-8`) + `<ConnectedBody/>`. 연결 0개면 빈 상태(아이콘+**`platform.add.empty.*`**+CTA→`sub="add"`). `connectedCount>=2`면 `PageFooter`에 "전체 연결 해제"(`removeAllAccounts`)만.
  - **플랫폼 추가**: idle 레이아웃(`PageShell`+중앙 정렬+아이콘 버블+`platform.add.title`, 헤딩 크기는 복제 대상 `IssueTab` EmptyState의 `text-lg`) + 1열 버튼 그룹 `flex flex-col gap-2`로 4개 `<ConnectFlow connected={!!accounts[id]} onConnected={()=>setSub("connected")}/>`.
  - 하위 탭 라우팅: `activeMainTab` prop 수신, "integrations"로 **전환되는 순간**에만 `pickInitialSubTab(connectedCount)`로 설정(prev-ref 비교 — 매 렌더 덮어쓰면 사용자가 고른 sub가 튐). 초기 `useState`도 `pickInitialSubTab` 사용.
  - **해제로 `connectedCount → 0` 전이 시 `sub="add"` 자동 전환**(빈 "내 연동" 방지). 현재 IntegrationsTab의 `setSub("jira")` 복귀 대체.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 연결 0개 → 상위 탭 진입 시 "플랫폼 추가" 기본 (수동)
  - [ ] 연결 1개+ → 상위 탭 진입 시 "내 연동" 기본 (수동)
  - [ ] "플랫폼 추가"를 수동 선택 후 다른 탭 갔다 돌아와도 강제로 "내 연동"으로 안 튐 (수동)
  - [ ] 섹션 collapse 토글, 섹션별 해제, 2개+ 시 전체 해제 (수동)
  - [ ] 섹션별/전체 해제로 0개 되면 "플랫폼 추가" 탭으로 자동 전환 (수동)
  - [ ] 연결된 플랫폼 버튼 disabled (수동)

### Task 5: `App.tsx`에 `activeMainTab` 전달
- **변경 대상**: `src/sidepanel/App.tsx`
- **작업 내용**: `<IntegrationsTab />` → `<IntegrationsTab activeMainTab={tab} />`.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 상위 탭 진입 라우팅 정상 (수동)

## 테스트 계획

- **단위 테스트** (Vitest, 대상 디렉터리 `__tests__/*.test.ts`) — **테스트 우선: 구현 전 작성**:
  - 하위 탭 결정 순수 함수 `pickInitialSubTab(connectedCount): "connected"|"add"` 테스트: 0→"add", 1·n→"connected".
  - 연결 가능 수단 판정 순수 함수 `connectMethods(oauthAvailable: boolean|null): ("oauth"|"token")[]` 테스트: true→["oauth","token"], false→["token"], **null→[]**(조회 중·pending — 버튼 disabled 근거). 컨펌 생략 분기 근거.
  - 기존 `connectedPlatforms`/`pickInitialPlatform` 등 store 헬퍼는 변경 없으므로 기존 테스트 유지.
- **컴포넌트 테스트** (RTL + mock store):
  - `*ConnectFlow`의 `onConnected` 콜백이 **연결 완료 시점에 1회만** 호출되는지 검증. 특히 토큰 검증 성공 직후 1회, OAuth 응답/사이트 다이얼로그 오픈 시점엔 미호출. (수동에만 의존하던 onConnected 타이밍 회귀를 자동화)
- **수동 테스트** (Chrome, `pnpm dev`):
  - [ ] 4개 플랫폼 각각 OAuth 연결 / 토큰 연결 성공
  - [ ] OAuth env 미설정 플랫폼: 컨펌 생략, 바로 토큰 다이얼로그
  - [ ] Jira 다중 사이트 / projectKey 미선택 플로우
  - [ ] 내 연동 탭: collapse, 섹션별 해제, 전체 해제(2개+), 빈 상태 CTA
  - [ ] 상위 탭 진입 라우팅(0개/1개+)
  - [ ] 연결 성공 후 "내 연동" 자동 전환
  - [ ] 라이트/다크 모드 브랜드 아이콘(GitHub/Notion invert)

## 구현 순서 권장

0. **순수 함수 테스트(`pickInitialSubTab`/`connectMethods`)** — 테스트 우선 원칙상 해당 함수 구현 직전 작성.
1. **Task 1(i18n)** — 독립, 먼저.
2. **Task 2(ConnectMethodDialog)** — 독립, Task 3 선행.
3. **Task 3(ConnectForm 분리)** — Task 2 의존. 4개 파일은 병렬 가능하나 Jira(사이트 다이얼로그·SetupDialog)가 가장 무거움.
4. **Task 4(IntegrationsTab)** — Task 1·2·3 산출물(export) 의존.
5. **Task 5(App prop)** — Task 4의 prop 시그니처 의존. 마지막.

> Task 1·2는 병렬 가능. Task 3의 4개 플랫폼도 병렬 가능. Task 4·5는 순차.
