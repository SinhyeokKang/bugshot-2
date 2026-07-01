# 컴포넌트/코드 공통화 리팩터 — 기술 설계

## 개요

파편화된 13개 클러스터를 (a) **기존 컴포넌트로의 수렴**과 (b) **신규 공용 컴포넌트/헬퍼 추출** 두 방식으로 정리한다. 각 클러스터는 서로 의존이 거의 없어 독립 착수 가능하다. 신규 추상화는 감사에서 3곳 이상 실증된 반복만 대상으로 하며, 플랫폼 고유 차이는 slot/opts/콜백으로 열어두고 억지 통합하지 않는다.

---

## 변경 범위 (클러스터별)

### UI 컴포넌트 층

#### U1 — 필드 콤보박스를 `SingleLazyCombobox`로 수렴 [최우선]
- **현재**: `src/sidepanel/components/SingleLazyCombobox.tsx`(제네릭, `load`/`getKey`/`getName`/`renderItem`/`selectedKey`/`onSelect` props, 내부에서 `useLazyListOnOpen`로 open-시 lazy load + loading/error/empty 3분기 렌더)가 이미 존재하고 **clickup/slack 필드만 채택**. 나머지 플랫폼 단일선택 콤보박스가 동일 마크업을 파일마다 복붙.
- **대상(손수 구현, 이관 후보)**:
  - `tabs/ProjectCombobox.tsx`, `tabs/IssueTypeCombobox.tsx`
  - `tabs/linearFields/{Project,Team,Assignee,Label}Combobox.tsx`
  - `tabs/githubFields/{Repo,Assignee,Label}Combobox.tsx`
  - `tabs/gitlabFields/{Project,Assignee,Label}Combobox.tsx`
  - `tabs/asanaFields/{Workspace,Project,Assignee}Combobox.tsx`
  - `tabs/notionFields/{Database,PropertySelect}Combobox.tsx`
  - `tabs/jiraFields/FieldCombobox.tsx`
- **변경**: 각 파일을 `load` 함수(기존 데이터 fetch 로직)만 주입하는 `SingleLazyCombobox<T>` 사용으로 축소. 라벨 색 dot이 있는 `*Label*Combobox`는 `renderItem`으로 흡수(U8과 연동).
- **U1b 다중선택 포함**: **다중선택** 콤보박스(체크박스형 Label, multi-assignee)와 `CcMultiCombobox`는 `SingleLazyCombobox`(단일선택)에 맞지 않으므로, 이번 이니셔티브에 **`MultiLazyCombobox` 신규 추출**을 포함한다. open-시 lazy load·loading/error/empty 골격은 `SingleLazyCombobox`와 동일 패턴을 공유하되 다중선택 상태·체크 표시·다중 그룹을 지원. 단일선택(U1)과는 마크업·상태가 달라 별도 컴포넌트로 두되, 같은 이니셔티브 안에서 처리.

#### U2 — 스피너 공용 컴포넌트
- **현재**: `Loader2 animate-spin` 인라인 ~45곳, 사이즈 3종 혼재(`h-3 w-3` 콤보박스 / `h-4 w-4` 저장·제출 버튼 / `h-6 w-6 text-muted-foreground` 오버레이) + 사이즈 미지정 이탈 2곳(`IssueTab.tsx:269`, `styleEditor/StyleChangesDialog.tsx:283`).
- **신규**: `src/components/ui/spinner.tsx` — `<Spinner size="sm"|"md"|"lg" />`(sm=h-3, md=h-4, lg=h-6+`text-muted-foreground`). 오버레이형은 `<SpinnerOverlay>`(`absolute inset-0 flex items-center justify-center`, DESIGN §14). 버튼 내 "라벨 감춤" 패턴(11파일)은 U2 하위 `<SpinnerButton loading disabled onClick variant>`로 별도(아래 P2·connect 폼과 겹침).

#### U3 — `ActionDialog` 추출 (확인형 + 알림형 통합)
- **현재**: 두 종류의 다이얼로그 보일러플레이트가 복붙됨.
  - **확인형**(취소+확인 2버튼) 6~7곳: `IssueRow.tsx:138`, `DraftDetailDialog.tsx:907`, `IssueListTab.tsx:188`, `IntegrationsTab.tsx:236`·`262`, `settings/LlmConnectForm.tsx:145`, `styleEditor/StyleChangesDialog.tsx:160`. `CancelConfirmDialog.tsx`가 이미 1케이스 컴포넌트화한 선례.
  - **알림형**(닫기 1버튼, no-cancel) 6곳: `App.tsx:246-350` 통지 다이얼로그.
- **신규**: `src/sidepanel/components/ActionDialog.tsx` — **`type: "confirm" | "notice"`** discriminated union prop 하나로 두 형태 커버. `confirm`은 `trigger`+cancel+confirm(2버튼), `notice`는 controlled(`open`/`onOpenChange`)+닫기(1버튼). `CancelConfirmDialog`도 `type="confirm"`으로 재구현.
- **주의**: IssueRow/DraftDetailDialog는 트리거 및 `AlertDialogContent`에 `onClick=stopPropagation` 필수(카드 클릭 전파 차단) → prop 노출. StyleChangesDialog는 트리거 `disabled`/`data-testid`, action `data-testid` 필요. 확인형은 trigger 기반, 알림형은 open state 기반(App.tsx 통지는 트리거 없이 상태로 열림)이라 union으로 분기.

#### U4 — `EmptyState` 공용 컴포넌트 승격
- **현재**: `IssueTab.tsx:417`에 로컬 `EmptyState`(icon/title/action) 이미 존재. 다른 17곳이 `rounded-full bg-muted p-3` 아이콘 배지 + 제목을 인라인 재구현하며 앞 마진 3종 불일치(mb-3 / mb-1 / 무).
- **신규**: `src/sidepanel/components/EmptyState.tsx`로 승격 + `description?` 슬롯 추가. 흡수 대상: `IssueListTab.tsx:141`·`148`, `DraftingPanel.tsx:356`, `settings/LlmConnectForm.tsx:65`, `SubmitSuccessView.tsx:17`, 로그 콘텐츠 빈 상태(`Network/Console/ActionLogContent`).
- **주의**: `IntegrationsTab.tsx:172`·`205`는 `px-6 gap-4`로 spacing이 다르지만 **표준 spacing(다른 곳과 동일한 gap·padding)으로 수렴**시켜 17곳 전부 옵션 prop 없이 단일 컴포넌트로 통일한다(통합 탭 여백이 미세하게 바뀌는 의도된 시각 변화 — 육안 확인). `IssueTab.tsx:342`의 녹화 화면(red 배지 + progress bar)은 흡수 대상 아님.

#### U5 — `LogPreviewDialog` 껍데기 추출
- **현재**: `components/{Console,Action,Network}LogPreviewDialog.tsx` 3파일이 껍데기 거의 완전 복붙(`DialogContent w-[80vw] max-w-[80vw] h-[80vh] gap-5 rounded-3xl p-6` + Header + `DialogFooter !flex-row justify-end` + close/attach 버튼).
- **신규**: `components/LogPreviewDialog.tsx` — `title`/`testId`/`children`/`attach?`/`onToggleAttach?`/`attachDisabled?`/`open`/`onOpenChange`. 내부 컨텐츠는 children 슬롯(`*LogContent`).
- **주의**: NetworkLog는 `startedAt` 없음, Action은 `scrollToEntryId` 없음 → 껍데기만 공용, 그 props는 각 컨텐츠가 소유.

#### U6 — `StatusBadgeSelect` 통일
- **현재**: `tabs/statusBadges/{Asana,Linear,Gitlab,Github,Clickup,Notion,Jira}StatusBadge.tsx` 7파일이 트리거(`button` + `Badge variant="outline"` + `Loader2`/`ChevronDown`)·드롭다운(로딩·`Check` 항목) 골격 동일.
- **신규**: `tabs/statusBadges/StatusBadgeSelect.tsx` — 트리거/드롭다운 골격 공용, 플랫폼별 state 로더·색 매핑만 주입. DESIGN §13 합성 컴포넌트 표에 추가.

#### U7 — `IconDeleteButton` 프리셋
- **현재**: `h-8 w-8 shrink-0 hover:text-destructive`(6곳)·`h-9 w-9 shrink-0 hover:text-destructive`(3곳) 아이콘 삭제 버튼 리터럴 반복(`IssueRow.tsx:143`, `IntegrationsTab.tsx:230`, `settings/LlmConnectForm.tsx:149`, `styleEditor/StyleChangesDialog.tsx:276`, `AttachmentSection.tsx:87`, `annotation/AnnotationToolbar.tsx:163`, `DraftingPanel.tsx:614`·`651`·`838`). 색은 DESIGN §10 규정대로라 올바름.
- **신규**: `src/components/ui/icon-delete-button.tsx` — `Button` 위 얇은 프리셋 래퍼 `<IconDeleteButton size="header"|"field">`(header=h-8, field=h-9). DESIGN §10 두 사이즈 규칙을 코드로 고정.
- **주의**: 낮은 우선순위(색은 이미 통일됨, 순수 중복 제거). 옵션성.

#### U8 — 라벨 색 dot을 `ColorSwatch`로 통일 [버그 동반]
- **현재**: `ColorSwatch` 프리미티브 존재·다곳 소비 중인데 `tabs/{linear,github,gitlab}Fields/LabelCombobox.tsx`만 인라인 `style={{ backgroundColor }}` span으로 우회. 게다가 불일치: gitlab=`border border-border`, linear=border 없음, **github=`` `#${l.color}` `` prefix vs 나머지 raw `l.color`(색 표기 버그)**.
- **변경**: `ColorSwatch`에 `shape="round"` prop 추가 후 3곳 교체, 색 값 정규화(`#` prefix)를 한 곳으로. **github `#` 불일치는 즉시 수정 대상 버그**.

### 플랫폼/어댑터 층

#### P1 — 어댑터 물리 중복 추출 (GFM/hook 4개 한정) [최우선]
- **현재**:
  - `authedFetch`/refresh hook: `background/{github,gitlab,asana,linear}-api.ts`가 `refreshHook` 모듈변수 + `setRefreshHook` + `ensureFresh` + `doFetch` + `authedFetch`(401→refresh→재요청→재401시 `OAuthError`)를 플랫폼 리터럴만 빼면 바이트 동일.
  - `submitTo{Github,Gitlab}.ts`: 파일 수집→`uploadFiles`→`hrefMap/urlMap`→`requireMediaUpload`→inline ref 해소(`resolvedCtx`)→`toMedia`/`toAttachmentMedia`→body 빌드→`submitIssue`가 ~90% 동일.
  - `build{Github,Gitlab}IssueBody.ts`: 정규화 후 diff 18줄(비디오 임베드 방식 차이만).
- **신규**:
  - `background/lib/createHookedAdapter.ts` — `createHookedAdapter({platform, buildAuthHeader, error401Key})` → `{authedFetch, fetch, setRefreshHook}` 클로저 발급. **대상 4개만**(github/gitlab/asana/linear).
  - `background/lib/prepareUpload.ts` — `prepareUpload(input, uploadFn)` → `{allFiles, keyMap, resolvedCtx, toMedia, toAttachmentMedia, logsDropped}`.
  - `background/lib/buildMarkdownIssueBody.ts` — `buildMarkdownIssueBody(ctx, opts)`, 비디오 렌더 등 소수 차이는 `opts.videoEmbed` 콜백. `buildMarkdownContext`/`classDiff`/`ccMarkdownLine`은 이미 공용.
- **주의(제외)**: Jira(즉시 refresh, ADF 경로), Notion/ClickUp/Slack(만료 없음→즉시 throw)은 hook 모델 부적합 → **4개만**. GitLab 사후 `injectIssueUrl` 재업로드·Slack 2-step 업로드·Jira ADF는 생성/후처리 어댑터별 유지.

#### P2 — `useOAuthConnect` 훅 + 공용 connect UI
- **현재**: `tabs/connect/*ConnectForm.tsx` 8파일이 `oauthAvailable`(useState+useEffect로 `{platform}.oauth.available` 조회) / `startOAuth` / `handleClick`(methods 분기) / 버튼 렌더 / `PatDialog`를 라인 오프셋까지 복붙. `connectMethods`는 이미 공용.
- **신규**: `src/sidepanel/hooks/useOAuthConnect.ts` — `useOAuthConnect(platform)` → `{oauthAvailable, connecting, methods, startOAuth, handleClick}`. `<PlatformConnectButton>` + 파라미터화 `<PatDialog platform tokenType>`.
- **주의(slot)**: Jira는 OAuth 성공 후 사이트 선택 추가단계(`JiraConnectForm.tsx:100-150`), Slack은 OAuth 전용·PAT 없음(`handleClick`/PatDialog 부재), GitLab은 인스턴스 URL 입력 → 훅은 공용, PAT 본문은 children/slot으로 열어둠. 억지 단일 컴포넌트화 금지.

#### P3 — `PLATFORM_META` 단일 registry
- **현재**: 아이콘 + labelKey + `dark:invert`가 최소 6곳 산발(`types/platform.ts:22` `PLATFORM_TAB_KEYS`(라벨키), `IntegrationsTab.tsx:56` `PLATFORMS`, `SubmitFieldsDialog.tsx:115` `PLATFORM_TABS`, `statusBadges/PlatformChip.tsx` 8분기 if, `statusBadges/SubmittedBadge.tsx` 8분기, connect 폼 인라인). `dark:invert`만 7중복.
- **신규**: `src/types/platform.ts`(또는 `platformMeta.tsx`)에 `PLATFORM_META: Record<PlatformId, {Icon: ComponentType<{className?: string}>; labelKey: string; invertOnDark: boolean}>`. `PlatformChip`/`SubmittedBadge` if 체인은 `PLATFORM_META[platform]` 조회로 대체. `PLATFORMS`/`PLATFORM_TABS`는 여기에 `ConnectFlow`/`ConnectedBody`만 얹어 파생.
- **주의**: Slack은 simple-icons 미지원 커스텀 `SlackIcon`(color prop 없음), lucide는 `color="default"` 미지원 → Icon 필드를 `ComponentType`로 통일해 흡수. `satisfies Record<PlatformId, ...>`로 exhaustiveness 강제.

#### P4 — `OAUTH_CONFIG` 테이블
- **현재**: `background/{github,linear,notion,gitlab,asana,clickup,slack}-oauth.ts`가 `is{Platform}OAuthConfigured()` / `assertConfigured()` / `{PLATFORM}_CANCEL_ERROR_CODES`+`is{Platform}Cancellation()` / `redirectUri()`를 반복. 소비부 `messages.ts:203-651`에 `{ available: isXOAuthConfigured() }` 8분기 나열.
- **신규**: `background/oauth/config.ts` — `OAUTH_CONFIG: Record<PlatformId, {clientIdEnv; needsProxy: boolean; cancelCodes: Set<string>}>` + 공용 `isConfigured(cfg)`/`assertConfigured(cfg)`/`isCancellation(cfg, code)`. `messages.ts` 8-`available` 핸들러는 `PLATFORM.map` 한 곳으로.
- **주의**: linear/gitlab은 PKCE(public)라 proxy 불요(테이블 `needsProxy:false`로 표현 — 진짜 차이). 토큰 교환 body 형태(폼 vs JSON, `authed_user.access_token` 추출)는 플랫폼마다 달라 **교환 함수 자체는 어댑터별 유지**.

> **P5(Submit 디스패치 테이블화)는 이 이니셔티브에서 제외.** `SubmitFieldsDialog`의 3중 switch·모달 8핸들러는 필드 state 클로저 의존으로 리팩터 난도가 높고 회귀 위험 대비 ROI가 낮아, 필요 시 **별도 `/feature`로 분리**한다. (exhaustive `never` 가드 보존 등 제약이 커 독립 설계가 안전.)

---

## 데이터 흐름

순수 리팩터라 상태/메시지/스토리지 흐름은 **불변**이다. U1/U5/U3 등은 마크업만 컴포넌트 경계 뒤로 이동하고 props로 기존 데이터를 그대로 전달한다. P1/P4는 함수 발급 방식만 팩토리/테이블로 바뀔 뿐 실제 fetch·토큰 흐름은 동일. P5만 필드 state 접근을 클로저→인자로 바꾸는 데이터 전달 경로 변경이 있으나 값 자체는 불변.

## 인터페이스 설계

```ts
// U1 — 기존, 그대로 재사용 (신규 아님)
function SingleLazyCombobox<T>(props: {
  disabled: boolean;
  load: () => Promise<T[]>;
  getKey: (item: T) => string;
  getName: (item: T) => string;
  getItemValue?: (item: T) => string;
  renderItem?: (item: T) => ReactNode;
  selectedKey: string | null;
  onSelect: (item: T | null) => void;
  triggerLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
}): JSX.Element;

// U2
function Spinner(props: { size?: "sm" | "md" | "lg"; className?: string }): JSX.Element;
function SpinnerOverlay(): JSX.Element;
function SpinnerButton(props: ButtonProps & { loading: boolean }): JSX.Element;

// U1b — 다중선택 신규 추출
function MultiLazyCombobox<T>(props: {
  disabled: boolean;
  load: () => Promise<T[]>;
  getKey: (item: T) => string;
  getName: (item: T) => string;
  renderItem?: (item: T) => ReactNode;
  selectedKeys: string[];
  onToggle: (item: T) => void;
  triggerLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
}): JSX.Element;

// U3 — 확인형 + 알림형 통합 (discriminated union)
type ActionDialogProps =
  | { type: "confirm"; trigger: ReactNode; title: string; body: string;
      confirmLabel: string; onConfirm: () => void; cancelLabel?: string;
      stopPropagation?: boolean;   // IssueRow/DraftDetailDialog 용
      confirmTestId?: string }     // StyleChangesDialog 용
  | { type: "notice"; title: string; body: string; closeLabel?: string;
      open: boolean; onOpenChange: (open: boolean) => void };  // App.tsx 통지형
function ActionDialog(props: ActionDialogProps): JSX.Element;

// U4
function EmptyState(props: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element;

// U5
function LogPreviewDialog(props: {
  title: string;
  testId: string;
  children: ReactNode;
  attach?: boolean;
  onToggleAttach?: () => void;
  attachDisabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element;

// U7
function IconDeleteButton(props: ButtonProps & { size?: "header" | "field" }): JSX.Element;

// U8 — 기존 ColorSwatch 확장
// shape?: "square" | "round" 추가

// P1
function createHookedAdapter(cfg: {
  platform: PlatformId;
  buildAuthHeader: (token: string) => Record<string, string>;
  error401Key: string;
}): { authedFetch: (...) => Promise<Response>; fetch: (...) => Promise<Response>; setRefreshHook: (h: RefreshHook) => void };

function prepareUpload(input: SubmitInput, uploadFn: UploadFn): Promise<{
  allFiles: FileInput[]; keyMap: Map<string, string>; resolvedCtx: MarkdownContext;
  toMedia: (...) => Media; toAttachmentMedia: (...) => Media; logsDropped: boolean;
}>;

function buildMarkdownIssueBody(ctx: MarkdownContext, opts: { videoEmbed?: (url: string) => string }): string;

// P2
function useOAuthConnect(platform: PlatformId): {
  oauthAvailable: boolean | null; connecting: boolean;
  methods: ConnectMethod[]; startOAuth: () => Promise<void>; handleClick: () => void;
};

// P3
const PLATFORM_META: Record<PlatformId, {
  Icon: ComponentType<{ className?: string }>;
  labelKey: string;
  invertOnDark: boolean;
}>;

// P4
const OAUTH_CONFIG: Record<PlatformId, { clientIdEnv: string; needsProxy: boolean; cancelCodes: Set<string> }>;
function isConfigured(cfg: OAuthConfig): boolean;
function assertConfigured(cfg: OAuthConfig): void;
function isCancellation(cfg: OAuthConfig, code: string): boolean;

```
(P1 시그니처의 구체 타입은 구현 시 기존 코드에서 확정 — 여기선 형태만.)

## 기존 패턴 준수

- **테스트 우선**(CLAUDE.md): 신규 헬퍼(P1 `prepareUpload`/`buildMarkdownIssueBody`, P4 `isConfigured`/`isCancellation`, U8 색 정규화)는 순수 함수 단위 테스트를 `__tests__/*.test.ts`에 먼저 작성.
- **UI 컨벤션**(DESIGN.md): 신규 UI 프리미티브는 `src/components/ui/`에, 합성 컴포넌트는 `src/sidepanel/components/`에. 색은 토큰만(raw hex 금지). 신규 공용 컴포넌트는 DESIGN §13/§14에 반영.
- **i18n**: 새 키 추가 시 ko/en 동시 갱신(PostToolUse 훅이 대칭 검사). 대부분 기존 키 재사용이라 신규 키는 최소.
- **어댑터 패턴**(ARCHITECTURE.md): P1/P4는 어댑터 경계를 넘지 않음. 플랫폼 고유 분기는 어댑터에 남김.
- **pre-arm/청크 제약**: 이 리팩터는 content script 청크(`recorders-entry`)를 건드리지 않음 — 대상은 sidepanel/background/components뿐.

## 대안 검토

- **U1 다중선택을 단일 `SingleLazyCombobox`에 억지 통합**: 다중선택은 마크업·상태가 달라(체크박스, 다중 그룹) 한 컴포넌트로 합치면 prop 폭증. → 골격만 공유하는 **별도 `MultiLazyCombobox`(U1b)**로 분리하되 같은 이니셔티브에서 처리.
- **U3을 `ConfirmActionDialog`/`NoticeDialog` 2개로 분리**: 두 다이얼로그가 shell(Content/Header/Footer)을 공유하므로 컴포넌트 2개는 그 껍데기가 또 중복됨. → **`type` union 단일 `ActionDialog`**로 껍데기 1회 공유.
- **P1/P2/P4를 하나의 "플랫폼 프레임워크"로 대통합**: 플랫폼 고유 차이(401 3분류, 렌더 모델 4종, PAT 유무)가 특수분기로 오염됨. → 클러스터별 소단위 추출로 한정.
- **P5(Submit 디스패치)를 이 이니셔티브에 포함**: 필드 state 클로저 의존·exhaustiveness 제약으로 난도가 높아 저·중위험 리팩터와 섞으면 전체 회귀 위험이 커짐. → **제외하고 별도 `/feature`로 분리.**
- **U7을 안 함**: 색은 이미 통일됐고 순수 중복 제거라 ROI 낮음 → 옵션. 예산 여유 시만.

## 위험 요소

- **시각 회귀**: U4(EmptyState 마진 흡수 시 IntegrationsTab spacing 변화), U8(dot border 유무 통일)은 실제 렌더에서 이전 대비 미세 변화 가능 → Chrome 육안 확인 필수.
- **e2e testid 손실**: U3/U7/U5 이동 시 `data-testid`(`reset-all`, `attachment-remove`, `annotation-delete`, `replay-trim-cancel`, 로그 프리뷰 testid)를 새 컴포넌트가 반드시 통과시켜야 함.
- **stopPropagation 누락**: U3에서 IssueRow/DraftDetailDialog의 카드 클릭 전파 차단(`stopPropagation`)을 prop으로 안 넘기면 삭제 트리거 클릭이 카드 열림으로 샘.
- **P1 401 로직 회귀**: refresh hook의 재401→`OAuthError` 경로는 실제 토큰 만료에서만 재현됨 → 단위 테스트로 401→refresh→재요청 경로를 모킹 검증 + 실제 계정 회귀 권장.
- **U3 union 오용**: `type="notice"`인데 `onConfirm`을 기대하거나 `type="confirm"`에 `open`을 넘기는 실수는 discriminated union이 컴파일 타임에 차단 → 타입 정의를 정확히 유지.
- **`chrome.scripting MAIN world` 무관**: 본 리팩터 대상 아님(`github-upload.ts:pageBatchUploadFn` 등은 안 건드림).
