# 연동 탭 UX 개편 — 기술 설계

## 개요

`IntegrationsTab`을 플랫폼별 하위 탭에서 **목적별 하위 탭("내 연동" / "플랫폼 추가")**으로 재구성한다. 각 플랫폼의 `ConnectForm`은 현재 [연결된 뷰]와 [온보딩(OAuth/토큰)]을 한 컴포넌트에 묶고 있는데, 이를 ① **연결된 뷰**(카드 + 설정 필드)와 ② **연결 플로우**(OAuth 시작 + 토큰 다이얼로그)로 분리해 두 하위 탭에서 각각 재사용한다. OAuth/토큰 선택은 공용 컨펌 다이얼로그로 분리하고, 기존 토큰 입력 다이얼로그·검증 로직·백그라운드 메시지는 그대로 둔다.

## 변경 범위

### `src/sidepanel/tabs/IntegrationsTab.tsx` — 전면 재구성
- **현재**: 플랫폼 4개 하위 탭 + 하단 footer(현재 플랫폼 해제 / 전체 해제).
- **변경**: "내 연동" / "플랫폼 추가" 두 하위 탭.
  - 플랫폼 메타 배열 정의: `{ id, label, Icon, Body, Flow }` × 4.
  - **내 연동 탭**: `connectedPlatforms(accounts)`를 순회하며 플랫폼별 `Section`(collapsible, defaultOpen) 렌더. 섹션 `title`=아이콘+이름, `action`=연동 해제 버튼(확인 다이얼로그). 본문=`<XConnectedBody/>`. 연결이 0이면 빈 상태(아이콘+안내+CTA→"플랫폼 추가"). `connectedCount >= 2`이면 하단 `PageFooter`에 "전체 연결 해제"만 표시.
  - **플랫폼 추가 탭**: 이슈 작성 idle 레이아웃(`PageShell` + 중앙 정렬 컬럼 + 아이콘 버블 + 타이틀)을 따르되, 버튼 그룹을 `flex flex-col gap-2`(1열)로. 각 플랫폼 `<XConnectFlow connected={...} onConnected={...} />` 렌더.
  - **하위 탭 라우팅(상위 탭 진입 시)**: App에서 `activeMainTab` prop을 받아, `activeMainTab === "integrations"`로 전환될 때 `connectedCount > 0 ? "connected" : "add"`로 `sub` 설정. 초기 `useState`도 동일 규칙.
  - **연결 성공 시**: `onConnected` 콜백으로 `sub="connected"` 전환.

### `src/sidepanel/App.tsx` — prop 1개 추가
- `<IntegrationsTab />` → `<IntegrationsTab activeMainTab={tab} />`. (DebugTab과 동일 패턴.)
- 기존 "연결 0개 → setTab('integrations')" 효과는 유지.

### `src/sidepanel/tabs/connect/JiraConnectForm.tsx` — 분리
- export `JiraConnectedBody`: 현재 connected 분기의 `<JiraSummary/>` + 설정 필드(ProjectCombobox, IssueTypeCombobox)를 `PageScroll`/외곽 `Section` 없이 반환. `SetupDialog`도 여기에 포함(연결됐고 projectKey 없으면 자동 오픈 — 기존 동작 유지).
- export `JiraConnectFlow({ connected, onConnected })`: "플랫폼 추가" 탭의 행 버튼 + 연결 로직.
  - 버튼: 아이콘+`{platform} 연결` 라벨, `connected`면 disabled.
  - `oauth.available` 조회(기존 로직 이동). 클릭 시: OAuth 가능하면 `ConnectMethodDialog` 오픈, 불가하면 바로 `ApiKeyDialog` 오픈.
  - OAuth 선택 → 기존 `startOAuth`. 사이트 2개 이상이면 **`JiraSiteDialog`(신규, 인라인 패널 → Dialog)**로 선택, 1개면 즉시 `finalize`. 성공 시 `onConnected()`.
  - `ApiKeyDialog`(기존) 검증 성공 시 `onConnected()`.
- `JiraConnectForm`, `JiraOnboarding`(중앙 정렬 패널), 인라인 `candidate` 사이트 렌더는 제거(이 변경이 만든 고아).

### `src/sidepanel/tabs/connect/GithubConnectForm.tsx` — 분리
- export `GithubConnectedBody`: `<GithubSummary/>` + 설정 필드(DefaultRepoField, DefaultIssueSettingsFields).
- export `GithubConnectFlow({ connected, onConnected })`: 행 버튼 + `github.oauth.available` + `ConnectMethodDialog` + 기존 `PatDialog`. OAuth 성공/PAT 검증 성공 시 `onConnected()`.
- `GithubConnectForm`, `GithubOnboarding` 제거.

### `src/sidepanel/tabs/connect/LinearConnectForm.tsx` — 분리
- export `LinearConnectedBody`: `<LinearSummary/>` + 설정 필드(DefaultTeamField, DefaultIssueSettingsFields).
- export `LinearConnectFlow({ connected, onConnected })`: 행 버튼 + `linear.oauth.available` + `ConnectMethodDialog` + 기존 `ApiKeyDialog`.
- `LinearConnectForm`, `LinearOnboarding` 제거.

### `src/sidepanel/tabs/connect/NotionConnectForm.tsx` — 분리
- export `NotionConnectedBody`: `<NotionSummary/>` + `<NotionDefaultsBlock/>`.
- export `NotionConnectFlow({ connected, onConnected })`: 행 버튼 + `notion.oauth.available` + `ConnectMethodDialog` + 기존 `InternalTokenDialog`.
- `NotionConnectForm`, `NotionOnboarding` 제거.

### `src/sidepanel/tabs/connect/ConnectMethodDialog.tsx` — 신규 (공용)
- OAuth/토큰 선택. **`Dialog` 기반**(`AlertDialog` 아님 — OAuth/토큰은 확인/취소가 아니라 동등한 두 선택지라 `AlertDialog`의 destructive 톤·2지선다 시맨틱과 안 맞고, `AlertDialogContent`의 `max-w-[360px]`도 좁음).
- props: `{ open, onOpenChange, platformLabel, oauthLabel, tokenLabel, onChooseOAuth, onChooseToken }`.
- 본문: 제목 `{platform} 연결 방식`, 설명 `platform.connectMethod.body`. 두 액션 버튼(OAuth / 토큰)은 **기존 입력 다이얼로그의 `DialogFooter` 패턴 그대로 가로 배열·우측 정렬**(연동 해제 `AlertDialog`와 시각적으로 구분). 라벨이 짧아(`OAuth로 연결` / `API 토큰` 등) ~400px 폭에서 가로 배치 가능. 토큰 라벨은 플랫폼별 기존 키 재사용(`jira.apiTokenButton` 등), OAuth 라벨은 신규 공용 키(`platform.connectMethod.oauth`). 토큰/OAuth 라벨 문체 비대칭은 기존 키 재사용 정책상 허용.
- 버튼 클릭 시 각 콜백(`onChooseOAuth`/`onChooseToken`) 호출 후 `onOpenChange(false)`.

### `src/sidepanel/tabs/connect/JiraSiteDialog.tsx` — 신규 (Jira 전용, 또는 JiraConnectForm 내부 컴포넌트)
- 기존 인라인 `candidate` 사이트 목록을 `Dialog`로 이전. `jira.selectSite` + 사이트 버튼 목록 재사용. 선택 시 `finalize`.
- **접근성**: `DialogTitle`(=`jira.selectSite`) 필수(Radix Dialog는 title 누락 시 스크린리더 경고). 사이트 1개면 다이얼로그 미표시, 즉시 `finalize`.
- 별도 파일 대신 `JiraConnectForm.tsx` 내부 컴포넌트로 두는 것도 허용(현재 다이얼로그들이 같은 파일에 있음).

### i18n — `src/i18n/namespaces/app.ts` (ko/en 동시)
신규 키:
- `platform.subtab.connected` = "내 연동" / "My connections"
- `platform.subtab.add` = "플랫폼 추가" / "Add platform"
- `platform.add.title` = "플랫폼 추가" / "Add a platform" (idle 레이아웃 헤딩)
- `platform.add.empty.title` = "연결된 플랫폼이 없어요" / "No connected platforms" ("내 연동" 탭 빈 상태 — 신규)
- `platform.add.empty.body` = "플랫폼을 추가해 이슈를 등록하세요." / "Add a platform to start filing issues." (신규)
- `platform.connectPlatform` = "{platform} 연결" / "Connect {platform}" (행 버튼 라벨)
- `platform.connectMethod.title` = "{platform} 연결 방식" / "Connect {platform}"
- `platform.connectMethod.body` = "연결 방식을 선택하세요." / "Choose how to connect."
- `platform.connectMethod.oauth` = "OAuth로 연결" / "Connect with OAuth"

> **빈 상태 키 분리 이유**: 기존 `platform.empty.title/body`는 PreviewPanel·DraftDetailDialog·IssueCreateModal에서 "연동 탭에서 먼저 연결하라"는 *연동 탭으로 보내는* 안내라, 연동 탭 *내부* 빈 상태로 재사용하면 자기참조가 된다. 따라서 `platform.add.empty.*`를 신규로 판다(기존 키는 미수정).

재사용 키: `platform.disconnect.*`, `platform.disconnectAll*`, `platform.disconnectPlatform`, `platform.connect`, 플랫폼별 토큰 버튼/온보딩 라벨(`*.apiTokenButton`, `*.patButton`, `*.apiKeyButton`, `notion.internalToken.button`), `jira.selectSite`.

> i18n PostToolUse 훅이 ko/en 대칭을 검사하므로 두 블록 동시 갱신.

## 데이터 흐름

```
App (tab state) ──activeMainTab──▶ IntegrationsTab
                                      │
       ┌──────────────────────────────┴───────────────────────────┐
       ▼ sub="connected"                                           ▼ sub="add"
  연결된 플랫폼 순회                                          4개 플랫폼 ConnectFlow
  <Section collapsible>                                        행 버튼 클릭
    action=해제(AlertDialog→removeAccount)                       │
    body=<XConnectedBody/>                                  oauthAvailable?
  </Section> × n                                          ┌──────┴───────┐
  PageFooter: 전체 해제(removeAllAccounts) [n>=2]          예(둘 다)      아니오(토큰만)
                                                     ConnectMethodDialog   ↓
                                                       ├ OAuth→startOAuth  토큰 다이얼로그
                                                       └ 토큰→토큰 다이얼로그   │
                                                              │               검증→setAccount
                                                       성공→setAccount(store) ─┘
                                                              │
                                                       onConnected()→sub="connected"
```

- 연결 상태 단일 출처: `useSettingsStore(s => s.accounts)`. 섹션 목록·버튼 disabled·footer 노출 모두 여기서 파생.
- 연동 해제: 기존 `removeAccount(platform)` / `removeAllAccounts()` 재사용(lastSubmitFields 정리 포함).
- **해제로 `connectedCount → 0` 전이 시 `sub="add"`로 자동 전환**(섹션별/전체 해제 공통). 빈 "내 연동" 화면에 머무르지 않도록 `accounts` 변화를 보는 effect에서 처리. (현재 IntegrationsTab은 전체 해제 후 `setSub("jira")`로 복귀 — 신 구조엔 플랫폼 sub가 없으므로 `"add"`로 대체.)
- 세션 영속화·하이드레이션은 store가 담당하므로 추가 작업 없음.

## 인터페이스 설계

```ts
// 순수 함수 (테스트 우선 — __tests__/*.test.ts로 단위테스트 먼저 작성)
// 하위 탭 결정: 연결 0개면 "add", 1개+면 "connected"
export function pickInitialSubTab(connectedCount: number): IntegrationSubTab;
//   0 → "add", 1·n → "connected"
// 연결 가능 수단 판정 (컨펌 생략 분기 근거). null=조회 중 → [](pending)
export function connectMethods(oauthAvailable: boolean | null): ("oauth" | "token")[];
//   true → ["oauth","token"], false → ["token"], null → []

// IntegrationsTab.tsx
type IntegrationSubTab = "connected" | "add";

interface PlatformEntry {
  id: PlatformId;
  Icon: (props: { className?: string; color?: string }) => JSX.Element;
  ConnectedBody: () => JSX.Element;            // 카드 + 설정
  ConnectFlow: (p: ConnectFlowProps) => JSX.Element; // 행 버튼 + 연결 로직
  iconClassName?: string;                      // github/notion: "dark:invert"
}

export function IntegrationsTab({ activeMainTab }: { activeMainTab: string }): JSX.Element;

// 각 connect/*ConnectForm.tsx 공통 시그니처
interface ConnectFlowProps {
  connected: boolean;
  onConnected: () => void;   // 연결 성공 → IntegrationsTab이 sub="connected"로 전환
}
export function JiraConnectedBody(): JSX.Element;
export function JiraConnectFlow(p: ConnectFlowProps): JSX.Element;
// Github/Linear/Notion 동일

// ConnectMethodDialog.tsx
interface ConnectMethodDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  platformLabel: string;
  oauthLabel: string;
  tokenLabel: string;
  onChooseOAuth: () => void;
  onChooseToken: () => void;
}
export function ConnectMethodDialog(p: ConnectMethodDialogProps): JSX.Element;
```

## 기존 패턴 준수

- **Section/collapse**: `@/sidepanel/components/Section`의 `Section`(collapsible, action 슬롯), `PageScroll`, `PageFooter` 재사용. 다른 탭과 동일 구조.
- **idle 레이아웃 재사용**: `IssueTab`의 `EmptyState` 레이아웃(중앙 정렬 + 아이콘 버블 + 타이틀 + 버튼 그룹)을 그대로 따르되 버튼만 1열. `EmptyState` 자체는 캡처 전용이라 추출하지 않고 레이아웃만 복제(UI 패턴 일치 원칙).
- **다이얼로그**: 파괴적 컨펌(연동 해제)은 `AlertDialog`, 입력(토큰)·**연결 방식 선택(ConnectMethodDialog)**·사이트 선택은 `Dialog`(연결 방식 선택은 동등 선택지라 `AlertDialog` 아님).
- **IconButton 사이즈**: 섹션 헤더 액션(연동 해제)은 `h-8 w-8`.
- **탭 컨텐츠**: 하위 탭에 `Tabs`를 쓸 경우 `data-[state=inactive]:hidden` 유지(기존 IntegrationsTab과 동일).
- **i18n 동시 갱신**: ko/en 양쪽 갱신, PostToolUse 훅 통과.
- **브랜드 아이콘**: `Si{Name}` + `color="default"`, GitHub/Notion만 `dark:invert`(기존 그대로).

## 대안 검토

- **대안 A — 플랫폼 하위 탭 유지하고 "연결됨 요약"만 상단에 추가**: 변경은 작지만 요구한 두-탭 구조·collapse 일관성을 달성 못함. 기각.
- **대안 B — `ConnectFlow`를 imperative 핸들(ref)로 노출하고 행 버튼은 IntegrationsTab이 직접 렌더**: 다이얼로그 상태를 부모로 끌어올려야 해 결합이 늘고, 플랫폼별 분기(사이트 선택 등)가 부모로 샌다. 각 ConnectFlow가 자기 버튼+다이얼로그를 자기완결로 소유하는 편이 단순. 기각.
- **대안 C — 단일 제네릭 `PlatformConnectFlow`로 4종 통합**: OAuth 시작·토큰 검증·Jira 사이트 선택이 플랫폼마다 달라 추상화 비용이 큼. 기존 파일 구조(플랫폼별 파일)를 유지하는 게 외과적. 기각.

## 위험 요소

- **Jira 사이트 선택 인라인 → Dialog 이전**: 다중 사이트 계정에서 회귀 가능. `finalize`/`candidate` 로직을 그대로 옮기고 실제 다중 사이트 계정으로 수동 검증 필요.
- **Jira SetupDialog 소유·자동 오픈 타이밍(못박음)**: SetupDialog는 **`JiraConnectedBody`가 소유**한다(다른 컴포넌트로 끌어올리지 않음). `JiraConnectedBody`는 `sub="connected"`에서만 마운트되므로, 연결 직후 아직 "플랫폼 추가" 탭(`sub="add"`)에 머무는 동안은 SetupDialog가 마운트되지 않는다 → **`onConnected()`가 `sub="connected"`로 전환시켜야** `JiraConnectedBody`+SetupDialog가 마운트되고 `projectKey` 없음 effect가 발동해 자동 오픈된다. 따라서 호출 순서는 `setAccount`(zustand) → `onConnected()`(부모 sub 전환)를 **동일 렌더 사이클에서 동기 연속 호출**로 보장(중간 await 금지). 이미 connected이고 `projectKey`가 채워진 상태에서는 effect 재발동 안 함(기존 멱등 동작 유지).
- **`onConnected()` 호출 위치(필수 못박음)**: 연결이 **실제로 완료된 단일 시점**에서만 호출한다. 토큰 방식은 검증 성공(`setAccount`) 직후, OAuth 단일 사이트는 `finalize`의 `setAccount` 직후. **Jira 다중 사이트는 사이트 선택 다이얼로그가 닫히고 `finalize`가 끝난 뒤(= `setAccount` 직후)에만 호출**한다. OAuth 응답 수신 시점이나 사이트 선택 다이얼로그를 띄우는 시점에 미리 호출하면 안 됨 — 중간 `sub` 전환으로 "플랫폼 추가" 탭이 사라지며 선택 다이얼로그가 끊긴다.
- **`oauthAvailable === null`(조회 중) 상태**: 행 버튼이 조회 완료 전 클릭되면 컨펌/토큰 분기를 못 정함. `connectMethods(null) → []`(pending)로 명시 처리하고, 빈 배열이면 행 버튼 비활성(기존 `JiraOnboarding`의 `disabled={oauthAvailable === null}` 가드를 ConnectFlow로 그대로 이전). 4개 폼이 각자 독립 조회하므로 진입 시 잠깐 동시 disabled 깜빡임은 기존 동작 유지(탭 레벨 일괄 조회는 비채택 — 4개 폼 자기완결성 보존).
- **ConnectForm 기존 export 제거**: `IntegrationsTab`만 import하므로 안전하나, 제거 전 grep로 재확인.
- **하위 탭 라우팅이 매 전환마다 sub를 덮어쓰면** 사용자가 "플랫폼 추가"를 보다가 다른 탭 갔다 오면 강제로 "내 연동"으로 튈 수 있음 → `activeMainTab`이 "integrations"로 **전환되는 순간**에만 라우팅(이전 값과 비교 또는 effect 의존성 관리).
