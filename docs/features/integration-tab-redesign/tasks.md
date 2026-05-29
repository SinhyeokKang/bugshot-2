# 연동 탭 UX 개편 — 구현 태스크

## 선행 조건

- 권한·manifest·env 변경 없음.
- shadcn 컴포넌트(`Section`, `AlertDialog`, `Dialog`, `Card`, `Button`)는 이미 설치됨. 신규 설치 불필요.
- 변경 전 `grep -rn "ConnectForm" src` 로 4개 플랫폼 `ConnectForm`이 `IntegrationsTab`에서만 import되는지 재확인.

## 태스크

### Task 1: i18n 키 추가
- **변경 대상**: `src/i18n/namespaces/app.ts` (ko/en 블록 동시)
- **작업 내용**: design.md "i18n" 절의 신규 키 추가
  (`platform.subtab.connected`, `platform.subtab.add`, `platform.add.title`, `platform.connectPlatform`, `platform.connectMethod.title/body/oauth`).
- **검증**:
  - [ ] ko/en 양쪽에 동일 키 존재, `{platform}` placeholder 일치
  - [ ] PostToolUse 훅(`locales.test.ts`) 통과

### Task 2: `ConnectMethodDialog` 공용 컴포넌트
- **변경 대상**: `src/sidepanel/tabs/connect/ConnectMethodDialog.tsx` (신규)
- **작업 내용**: `AlertDialog` 기반 OAuth/토큰 선택 다이얼로그. design.md 시그니처대로. OAuth 버튼 → `onChooseOAuth`, 토큰 버튼 → `onChooseToken`, 둘 다 선택 후 `onOpenChange(false)`.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 두 버튼 클릭 시 각 콜백 호출 + 닫힘 (수동)

### Task 3: 각 ConnectForm을 `*ConnectedBody` + `*ConnectFlow`로 분리
- **변경 대상**: `connect/JiraConnectForm.tsx`, `GithubConnectForm.tsx`, `LinearConnectForm.tsx`, `NotionConnectForm.tsx`
- **작업 내용**: design.md "변경 범위"대로 각 파일에서
  - `*ConnectedBody` export: 기존 connected 분기의 Summary + 설정 필드를 외곽 `PageScroll`/`Section` 없이 반환. (Jira는 `SetupDialog` 포함)
  - `*ConnectFlow({ connected, onConnected })` export: 행 버튼 + `*.oauth.available` 조회 + 분기(둘 다 가능→`ConnectMethodDialog`, 토큰만→토큰 다이얼로그 직접 오픈) + 기존 토큰 다이얼로그/OAuth 시작 로직 이동.
  - **`onConnected()` 호출 시점**: 연결이 실제 완료된 시점(`setAccount` 직후)에서만 1회. 토큰=검증 성공 직후, OAuth 단일 사이트=`finalize` 직후. **Jira 다중 사이트=사이트 선택 다이얼로그 닫히고 `finalize` 끝난 뒤에만**. OAuth 응답/사이트 다이얼로그 오픈 시점에 미리 호출 금지(중간 탭 전환으로 다이얼로그 끊김).
  - 기존 `*ConnectForm`, `*Onboarding` 제거.
  - Jira: 인라인 `candidate` 사이트 목록 → `Dialog`(`JiraSiteDialog`, 같은 파일 내부 컴포넌트 허용)로 이전, `jira.selectSite` 재사용.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 각 플랫폼 OAuth/토큰 연결 → store에 account 저장 (수동, 탭 4종)
  - [ ] Jira 다중 사이트 계정에서 사이트 선택 다이얼로그 동작 (수동)
  - [ ] Jira 연결 후 projectKey 없으면 SetupDialog 자동 오픈, 취소 시 해제 (수동)

### Task 4: `IntegrationsTab` 재구성
- **변경 대상**: `src/sidepanel/tabs/IntegrationsTab.tsx`
- **작업 내용**:
  - 플랫폼 메타 배열(`id/Icon/ConnectedBody/ConnectFlow/iconClassName`) 정의.
  - "내 연동" / "플랫폼 추가" 두 하위 탭(`Tabs` 또는 단순 분기 + `data-[state=inactive]:hidden`).
  - **내 연동**: `connectedPlatforms(accounts)` 순회 → 플랫폼별 `Section`(collapsible, defaultOpen, title=아이콘+이름, action=연동 해제 `AlertDialog` `h-8 w-8`) + `<ConnectedBody/>`. 연결 0개면 빈 상태(아이콘+`platform.empty.*`+CTA→`sub="add"`). `connectedCount>=2`면 `PageFooter`에 "전체 연결 해제"(`removeAllAccounts`)만.
  - **플랫폼 추가**: idle 레이아웃(`PageShell`+중앙 정렬+아이콘 버블+`platform.add.title`) + 1열 버튼 그룹 `flex flex-col gap-2`로 4개 `<ConnectFlow connected={!!accounts[id]} onConnected={()=>setSub("connected")}/>`.
  - 하위 탭 라우팅: `activeMainTab` prop 수신, "integrations"로 전환 시 `connectedCount>0?"connected":"add"`. 초기 state 동일.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 연결 0개 → 상위 탭 진입 시 "플랫폼 추가" 기본 (수동)
  - [ ] 연결 1개+ → 상위 탭 진입 시 "내 연동" 기본 (수동)
  - [ ] 섹션 collapse 토글, 섹션별 해제, 2개+ 시 전체 해제 (수동)
  - [ ] 연결된 플랫폼 버튼 disabled (수동)

### Task 5: `App.tsx`에 `activeMainTab` 전달
- **변경 대상**: `src/sidepanel/App.tsx`
- **작업 내용**: `<IntegrationsTab />` → `<IntegrationsTab activeMainTab={tab} />`.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 상위 탭 진입 라우팅 정상 (수동)

## 테스트 계획

- **단위 테스트** (Vitest, 대상 디렉터리 `__tests__/*.test.ts`):
  - 하위 탭 결정 로직을 순수 함수로 추출(예: `pickIntegrationSubTab(connectedCount): "connected"|"add"`)하고 테스트: 0→"add", 1·n→"connected".
  - 연결 가능 수단 판정 로직을 순수 함수로 추출(예: `connectMethods(oauthAvailable): ("oauth"|"token")[]`)하고 테스트: oauth true→["oauth","token"], false→["token"]. (컨펌 생략 분기 근거)
  - 기존 `connectedPlatforms`/`pickInitialPlatform` 등 store 헬퍼는 변경 없으므로 기존 테스트 유지.
- **수동 테스트** (Chrome, `pnpm dev`):
  - [ ] 4개 플랫폼 각각 OAuth 연결 / 토큰 연결 성공
  - [ ] OAuth env 미설정 플랫폼: 컨펌 생략, 바로 토큰 다이얼로그
  - [ ] Jira 다중 사이트 / projectKey 미선택 플로우
  - [ ] 내 연동 탭: collapse, 섹션별 해제, 전체 해제(2개+), 빈 상태 CTA
  - [ ] 상위 탭 진입 라우팅(0개/1개+)
  - [ ] 연결 성공 후 "내 연동" 자동 전환
  - [ ] 라이트/다크 모드 브랜드 아이콘(GitHub/Notion invert)

## 구현 순서 권장

1. **Task 1(i18n)** — 독립, 먼저.
2. **Task 2(ConnectMethodDialog)** — 독립, Task 3 선행.
3. **Task 3(ConnectForm 분리)** — Task 2 의존. 4개 파일은 병렬 가능하나 Jira(사이트 다이얼로그·SetupDialog)가 가장 무거움.
4. **Task 4(IntegrationsTab)** — Task 1·2·3 산출물(export) 의존.
5. **Task 5(App prop)** — Task 4의 prop 시그니처 의존. 마지막.

> Task 1·2는 병렬 가능. Task 3의 4개 플랫폼도 병렬 가능. Task 4·5는 순차.
