# 컴포넌트/코드 공통화 리팩터 — 기술 설계

## 개요

파편화된 12개 클러스터를 (a) **기존 컴포넌트로의 수렴**과 (b) **신규 공용 컴포넌트/헬퍼 추출** 두 방식으로 정리한다. 각 클러스터는 **순차 착수**를 전제로 한다 — 같은 파일을 공유하는 태스크 쌍이 있어 병렬 금지(tasks.md 겹침 매트릭스 참조). 신규 추상화는 감사에서 3곳 이상 실증된 반복만 대상으로 하며, 플랫폼 고유 차이는 slot/opts/콜백으로 열어두고 억지 통합하지 않는다.

---

## 변경 범위 (클러스터별)

### UI 컴포넌트 층

#### U1 — 필드 콤보박스를 `SingleLazyCombobox`로 수렴 [최우선]
- **현재**: `src/sidepanel/components/SingleLazyCombobox.tsx`(제네릭, `load`/`getKey`/`getName`/`renderItem`/`selectedKey`/`onSelect`/`pinSelected` props, 내부에서 `useLazyListOnOpen`로 open-시 lazy load + loading/error/empty 3분기 렌더)가 이미 존재하고 **clickup/slack 필드만 채택**. 나머지 플랫폼 단일선택 콤보박스가 동일 마크업을 파일마다 복붙.
- **대상(손수 구현, 이관)**:
  - `tabs/ProjectCombobox.tsx`, `tabs/IssueTypeCombobox.tsx`
  - `tabs/linearFields/{Project,Team,Assignee,Label}Combobox.tsx`
  - `tabs/githubFields/{Assignee,Label}Combobox.tsx`
  - `tabs/gitlabFields/{Project,Assignee,Label}Combobox.tsx`
  - `tabs/asanaFields/{Workspace,Project,Assignee}Combobox.tsx`
  - `tabs/notionFields/DatabaseCombobox.tsx`
  - ※ Label 콤보박스 3종은 실측 전부 **단일선택**(선택 시 close)이라 U1 대상이 맞다. 라벨 색 dot은 `renderItem`으로 흡수(U8과 연동).
- **제외(모델 부적합 — 현행 유지)**:
  - `githubFields/RepoCombobox.tsx` — open-시 1회 로드가 아니라 입력마다 250ms 디바운스 후 `github.searchRepos` **서버 재쿼리**. 이관하면 전체 레포 검색이 최초 로드분 로컬 필터로 기능 축소된다.
  - `jiraFields/FieldCombobox.tsx` — leaf가 아니라 **경쟁 제네릭 셸**(`onSearch` 서버검색 모드 `shouldFilter={!onSearch}`, `clearable` 해제를 별도 Actions CommandGroup으로 렌더, `groupLabel`, children 슬롯. 소비처 `EpicField`/`AssigneeField`가 디바운스 서버검색 사용). 두 제네릭의 관계 정리는 본 이니셔티브 밖 — 필요 시 별도 후속 검토.
  - `notionFields/PropertySelectCombobox.tsx` — lazy load 없음(`schema.options` 동기 취득, 검색창·loading/error 없음) + `schema.type`에 따른 single/multi 동적 전환. 어느 모델에도 부적합.
- **확장**: `SingleLazyCombobox`에 `getSearchValue?: (item: T) => string` prop 추가 — `ProjectCombobox`(프로젝트 key 검색)·`linearFields/AssigneeCombobox`(name+email+id 검색)의 복합 검색을 보존한다("동작 변경 금지"). 미지정 시 기존 `getName` 필터.
- **U1b 철회**: 감사 초안의 "다중선택 콤보박스 공통화(`MultiLazyCombobox` 신규 추출)"는 검수 결과 대상 실체가 없다 — `*Fields/LabelCombobox` 3종은 전부 단일선택(위 U1 대상), "multi-assignee 콤보박스"는 코드베이스에 존재하지 않으며, 실존 다중선택(CC 계열)은 이미 `CcMultiCombobox`(+`*Fields/CcCombobox` 래퍼)로 공통화돼 있다(lazy load 부모 주입·서버검색 `onSearch`·아바타 렌더·`onClear` 그룹 — 별개 모델, 실증된 추가 반복 없음). 신규 추출하지 않는다.

#### U2 — 스피너 공용 컴포넌트
- **현재**: `Loader2 animate-spin` 인라인 실측 **56곳**, 사이즈 3종 혼재 — `h-3 w-3` 28곳(콤보박스, 그중 `mr-1` 동반 7곳) / `h-4 w-4` 22곳(저장·제출 버튼, 그중 `text-muted-foreground` 동반 3곳) / `h-6 w-6` 4곳(오버레이, 그중 muted 없는 1곳 = `log-viewer/main.tsx:32`) + 사이즈 미지정 2곳(`IssueTab.tsx:269`, `tabs/styleEditor/StyleChangesDialog.tsx:283` — 둘 다 Button 내부라 shadcn `[&_svg]:size-4`로 현재 실질 md 렌더).
- **신규**: `src/components/ui/spinner.tsx` — `<Spinner size="sm"|"md"|"lg" className?>`(sm=h-3, md=h-4, lg=h-6+`text-muted-foreground` 내장). **정규화 규칙**: 미지정 2곳은 **md 확정**(현재 실질 렌더와 동일 — 무손실). 이탈 클래스(`mr-1`, md의 muted 3곳, lg의 비-muted 1곳)는 `className` 통과로 흡수 — `log-viewer/main.tsx:32`는 `className`으로 현재 색 유지. 오버레이형은 `<SpinnerOverlay>`(`absolute inset-0 flex items-center justify-center`, DESIGN §14). 버튼 내 "라벨 감춤" 패턴(11파일)은 U2 하위 `<SpinnerButton loading disabled onClick variant>`로 별도(P2 connect 폼과 파일 겹침 — 순차).
- **경계**: `statusBadges/*StatusBadge.tsx` 7파일의 인라인 Loader2는 U2 대상에서 **제외** — U6(StatusBadgeSelect)이 공용 골격을 만들 때 내부에서 `<Spinner>`를 쓰도록 위임(중복 작업 방지).

#### U3 — `ActionDialog` 추출 (확인형 + 알림형 통합)
- **현재**: 두 종류의 다이얼로그 보일러플레이트가 복붙됨.
  - **확인형**(취소+확인 2버튼) 7곳: `tabs/IssueRow.tsx:138`, `tabs/DraftDetailDialog.tsx:907`, `IssueListTab.tsx:188`, `tabs/IntegrationsTab.tsx:225`·`262`, `tabs/settings/LlmConnectForm.tsx:144`, `tabs/styleEditor/StyleChangesDialog.tsx:160`. `CancelConfirmDialog.tsx`가 이미 1케이스 컴포넌트화한 선례.
  - **알림형**(닫기 1버튼, no-cancel) 6곳: `App.tsx:240-351` 통지 다이얼로그.
- **신규**: `src/sidepanel/components/ActionDialog.tsx` — **`type: "confirm" | "notice"`** discriminated union prop 하나로 두 형태 커버. `confirm`은 `trigger`+cancel+confirm(2버튼), `notice`는 controlled(`open`/`onOpenChange`)+닫기(1버튼)+**`onClose?` 액션 콜백**(`oauthExpired`의 `setTab("integrations")` 이동, `permissionExpired`의 `window.close()` 커버)+**`dialogTestId?`/`actionTestId?`**(`picker-unavailable-dialog/-ok`, `iframe-unsupported-dialog/-ok` 4개 testid 보존). `CancelConfirmDialog`도 `type="confirm"`으로 재구현.
- **주의**: `stopPropagation`이 실제 필요한 곳은 `tabs/IssueRow.tsx` **하나뿐**(트리거 145행 — `{...hoverGuard}` spread 동반 — + Content 151행, 카드 클릭 전파 차단). `DraftDetailDialog.tsx:907`엔 원래 없음(Dialog Footer 내부라 불필요). `stopPropagation` prop은 **Content 쪽만** 담당하고 트리거 쪽 차단은 caller가 넘기는 `trigger` ReactNode의 책임 — 이 이원 처리를 지켜야 구현 누락이 없다. StyleChangesDialog는 트리거 `disabled`/`data-testid`, action `data-testid`(`reset-all-confirm`) 필요. 알림형은 open state 기반(App.tsx 통지는 트리거 없이 상태로 열림). notice 이관 시 App.tsx의 `blurActiveElement()` 관행(DESIGN §9)이 컴포넌트 경계 뒤로 유실되지 않게 주의.

#### U4 — `EmptyState` 공용 컴포넌트 승격
- **현재**: `IssueTab.tsx:415`에 로컬 **`EmptyShell`**(icon/title/action)이 이미 존재. **주의 — 이름 충돌**: 같은 파일 166행의 로컬 `EmptyState`는 녹화 액션 그리드로 전혀 별개 컴포넌트다. 인라인 재구현(`rounded-full bg-muted p-3` 아이콘 배지 + 제목)은 실측 **15곳**이며 앞 마진 3종 불일치(mb-3/mb-1/무).
- **신규**: `src/sidepanel/components/EmptyState.tsx`로 승격(`EmptyShell` 기반 + `description?` 슬롯). 기존 `IssueTab.tsx:166`의 로컬 `EmptyState`(녹화 액션 그리드)는 **리네임해 충돌 해소**. 흡수 대상 **9곳**: `IssueListTab.tsx:141`·`148`, `tabs/DraftingPanel.tsx:356`, `tabs/settings/LlmConnectForm.tsx:65`, `SubmitSuccessView.tsx:17`, `tabs/IntegrationsTab.tsx:172`·`205`, `IssueTab.tsx:176`(모드 선택 빈 상태 — IntegrationsTab과 같은 `gap-4 px-6` 이탈 패턴).
- **제외**: 로그 콘텐츠 빈 상태 6곳(`ConsoleLogContent:169`, `ActionLogContent:271`, `NetworkLogContent:340`·`396`·`525`·`631`) — 제목이 `text-sm text-muted-foreground`로 서브탭 내 보조 UI에 맞춘 의도적 작은 타이포. 표준(`h3 text-lg font-semibold`) 수렴 시 뚜렷한 시각 변화가 생겨 대상에서 제외한다. `IssueTab.tsx` 녹화 화면(red 배지 + progress bar)도 흡수 대상 아님.
- **주의**: `IntegrationsTab.tsx:172`·`205`·`IssueTab.tsx:176`은 `px-6 gap-4`로 spacing이 다르지만 **표준 spacing으로 수렴**시켜 옵션 prop 없이 단일 컴포넌트로 통일한다(여백이 미세하게 바뀌는 의도된 시각 변화 — 라이트/다크 양쪽 육안 확인).

#### U5 — `LogPreviewDialog` 껍데기 추출
- **현재**: `components/{Console,Action,Network}LogPreviewDialog.tsx` 3파일이 껍데기 거의 완전 복붙(`DialogContent w-[80vw] max-w-[80vw] h-[80vh] gap-5 rounded-3xl p-6` + Header + `DialogFooter !flex-row justify-end` + close/attach 버튼).
- **신규**: `components/LogPreviewDialog.tsx` — `title`/`testId`/`children`/`attach?`/`onToggleAttach?: (attach: boolean) => void`/`attachDisabled?`/`open`/`onOpenChange`. 내부 컨텐츠는 children 슬롯(`*LogContent`).
- **주의**: NetworkLog는 `startedAt` 없음, Action은 `scrollToEntryId` 없음 → 껍데기만 공용, 그 props는 각 컨텐츠가 소유. 로그 프리뷰 3개 testid는 e2e 미커버 — 보존 확인은 grep+수동.

#### U6 — `StatusBadgeSelect` 통일
- **현재**: `tabs/statusBadges/{Asana,Linear,Gitlab,Github,Clickup,Notion,Jira}StatusBadge.tsx` 7파일이 트리거(`button` + `Badge variant="outline"` + `Loader2`/`ChevronDown`)·드롭다운(로딩·`Check` 항목) 골격 동일.
- **신규**: `tabs/statusBadges/StatusBadgeSelect.tsx` — 트리거/드롭다운 골격 공용, 플랫폼별 state 로더·색 매핑만 주입. 내부 로딩 표시는 `<Spinner>` 사용(U2에서 위임받은 경계 — U2 미착수 상태면 인라인 유지 후 추후 교체). DESIGN §13 합성 컴포넌트 표에 추가.

#### U7 — `IconDeleteButton` 프리셋
- **현재**: `h-8 w-8 shrink-0 hover:text-destructive`(6곳)·`h-9 w-9 shrink-0 hover:text-destructive`(3곳) 아이콘 삭제 버튼 리터럴 반복(`tabs/IssueRow.tsx:143`, `tabs/IntegrationsTab.tsx:230`, `tabs/settings/LlmConnectForm.tsx:149`, `tabs/styleEditor/StyleChangesDialog.tsx:276`, `AttachmentSection.tsx:87`, `components/annotation/AnnotationToolbar.tsx:163`, `tabs/DraftingPanel.tsx:614`·`651`·`838`). 색은 DESIGN §10 규정대로라 올바름.
- **신규**: `src/components/ui/icon-delete-button.tsx` — `Button` 위 얇은 프리셋 래퍼 `<IconDeleteButton size="header"|"field">`(header=h-8, field=h-9). DESIGN §10 두 사이즈 규칙을 코드로 고정.
- **주의**: 낮은 우선순위(색은 이미 통일됨, 순수 중복 제거). 옵션성.

#### U8 — 라벨 색 dot을 `ColorSwatch`로 통일 [정합 개선 동반]
- **현재**: `ColorSwatch` 프리미티브(현 props `color?`/`image?`/`className?`, `h-3 w-3 rounded-[3px] border`)가 존재·다곳 소비 중인데 `tabs/{linear,github,gitlab}Fields/LabelCombobox.tsx`만 인라인 `style={{ backgroundColor }}` span으로 우회. **색 표기 차이는 버그가 아니라 API 포맷 차이 대응이다**: GitHub API만 `#` 없는 hex를 반환해 github이 `#${l.color}`로 보정(정답), linear/gitlab API는 `#` 포함 반환이라 raw 사용(정답) — 셋 다 현재 정상 렌더 중. 진짜 시각 이탈은 **linear dot만 border 없음**(github·gitlab은 둘 다 border 있음).
- **변경**: `ColorSwatch`에 `shape="round"` prop 추가 후 3곳 교체. 색 값 정규화(`#` 유무 흡수)를 `ColorSwatch` 경계 한 곳으로 모아 파일별 제각각 대응을 제거하고, **linear dot의 border 누락을 정합**한다(의도된 시각 변화 — 라이트/다크 육안 확인). 정규화 후에도 세 플랫폼 색 표시는 이전과 동일해야 한다.

### 플랫폼/어댑터 층

#### P1 — 어댑터 물리 중복 추출 (refresh 골격 4개 + GFM 2종) [최우선]
- **현재**:
  - refresh/hook 골격: `background/{github,gitlab,asana,linear}-api.ts` 4개가 `refreshHook` 모듈변수 + `setRefreshHook` + `ensureFresh`(pre-refresh, 60s threshold — **4개 전부 보유**, 플랫폼별 pre-refresh 유무 분기를 만들지 말 것) + 401→refresh→재요청→재401시 `OAuthError` 골격을 공유. 단 **요청 본체(doFetch)는 플랫폼별로 다르다**: github는 `Accept`/`X-GitHub-Api-Version`/`User-Agent` 헤더 3종, gitlab은 self-managed `${auth.baseUrl}/api/v4`, asana는 응답 `.data` 언랩, **linear는 REST가 아닌 GraphQL**(`authedGraphQL`, HTTP 200+`errors` 배열 → `LinearError`).
  - `submitTo{Github,Gitlab}.ts`: 파일 수집→`uploadFiles`→`hrefMap/urlMap`→`requireMediaUpload`→inline ref 해소(`resolvedCtx`)→`toMedia`/`toAttachmentMedia`→body 빌드→`submitIssue`가 ~90% 동일.
  - `build{Github,Gitlab}IssueBody.ts`: 정규화 후 diff 18줄(비디오 임베드 방식 차이만 — 미디어 섹션과 첨부 섹션 두 지점).
- **신규**:
  - `background/lib/createRefreshRunner.ts`(가칭) — **refresh 골격만** 공용화: `{ensureFresh, runWithAuthRetry, setRefreshHook}`을 발급하는 소형 팩토리. **doFetch(헤더·baseUrl·언랩·GraphQL)는 각 api 파일에 잔류** — linear 포함 4개 전부 골격만 공유. `error401Key`류 파라미터는 두지 않는다(4개 모두 동일 키 `oauth.error.refreshExhausted` — 변하는 건 `platform` 리터럴뿐).
  - `background/lib/prepareUpload.ts` — `prepareUpload(input, uploadFn)` → `{allFiles, keyMap, resolvedCtx, toMedia, toAttachmentMedia, logsDropped}`.
  - `background/lib/buildMarkdownIssueBody.ts` — `buildMarkdownIssueBody(ctx, opts)`. `opts.videoEmbed` 콜백은 미디어 섹션과 첨부 섹션(`emitAttachments`) **두 지점**을 커버하고, `opts.platform`으로 플랫폼 접두어 i18n 키(`attachmentNotInline`·`requireMediaUpload`)를 해소. `buildMarkdownContext`/`classDiff`/`ccMarkdownLine`은 이미 공용.
- **hook 소유권·등록 타이밍 (위험)**: 현재 hook 등록은 각 `*-oauth.ts`의 **top-level side-effect**이고 `messages.ts` 정적 import 체인이 SW 콜드 스타트마다 등록을 보장한다. 팩토리 전환 시 ① 인스턴스는 **api 모듈 top-level 1회 발급 + `setRefreshHook` 동일명 재수출** 필수(oauth 모듈에서 발급하면 순환 의존 — oauth→api `getMyself` import 기존재), ② 이중 발급 시 hook과 fetch가 **다른 클로저**가 되어 401→refresh가 무음 사망(실토큰 만료에서만 재현), ③ `github-oauth.test.ts:2-9`가 load-time 등록을 전제로 chrome stub — 세 경로 모두 주의.
- **주의(제외)**: Jira(즉시 refresh, ADF 경로), Notion/ClickUp/Slack(만료 없음→즉시 throw)은 hook 모델 부적합 → **4개만**. GitLab 사후 `injectIssueUrl` 재업로드·Slack 2-step 업로드·Jira ADF는 생성/후처리 어댑터별 유지.

#### P2 — `useOAuthConnect` 훅 + 공용 connect UI
- **현재**: `tabs/connect/*ConnectForm.tsx` 8파일이 `oauthAvailable`(useState+useEffect로 `{platform}.oauth.available` 조회) / `startOAuth` / `handleClick`(methods 분기) / 버튼 렌더 / `PatDialog`를 라인 오프셋까지 복붙. `connectMethods`는 이미 공용.
- **신규**: `src/sidepanel/hooks/useOAuthConnect.ts` — `useOAuthConnect(platform)` → `{oauthAvailable, connecting, methods, startOAuth, handleClick}`. `<PlatformConnectButton>` + 파라미터화 `<PatDialog platform tokenType>`.
- **메시지 타입 매핑 (함정)**: jira만 `{type:"oauth.available"}`/`{type:"oauth.start"}`(플랫폼 prefix 없음), 나머지 7개는 `{platform}.oauth.available` — 훅이 `` `${platform}.oauth.available` `` 템플릿으로 조립하면 **Jira에서 조회 실패**. 명시적 타입 매핑 테이블로 처리한다.
- **플랫폼별 미사용 반환 필드**: Slack은 `connectMethods`/`handleClick`/PatDialog 자체가 부재(직결 `startOAuth`만 사용 — `methods`/`handleClick` 미사용). Jira는 `connecting`을 OAuth 후 사이트 선택 finalize 단계에도 재사용하며, Jira 전용 에러 분류(`classifyOAuthClassified`+커스텀 toast)는 훅 공통부에 하드코딩 금지 — Jira 폼에 잔류.
- **주의(slot)**: Jira는 OAuth 성공 후 사이트 선택 추가단계(`JiraConnectForm.tsx:100-150`), Slack은 OAuth 전용·PAT 없음, GitLab은 인스턴스 URL 입력 → 훅은 공용, PAT 본문은 children/slot으로 열어둠. 억지 단일 컴포넌트화 금지.

#### P3 — `PLATFORM_META` 단일 registry
- **현재**: 아이콘 + labelKey + `dark:invert`가 최소 6곳 산발(`types/platform.ts:20` `PLATFORM_TAB_KEYS`(라벨키), `tabs/IntegrationsTab.tsx:56` `PLATFORMS`, `tabs/SubmitFieldsDialog.tsx:111` `PLATFORM_TABS`, `statusBadges/PlatformChip.tsx` **7분기 if + github default fallback**(비대칭 자체가 리팩터 가치), `statusBadges/SubmittedBadge.tsx` 8분기, connect 폼 인라인). `dark:invert`는 8회/6파일 중복.
- **신규**: `src/types/platform.ts`(또는 `platformMeta.tsx`)에 `PLATFORM_META: Record<PlatformId, {Icon: ComponentType<{className?: string}>; labelKey: string; invertOnDark: boolean}>`. `PlatformChip`/`SubmittedBadge` if 체인은 `PLATFORM_META[platform]` 조회로 대체. `PLATFORMS`/`PLATFORM_TABS`는 여기에 `ConnectFlow`/`ConnectedBody`만 얹어 파생.
- **주의**: Slack은 simple-icons 미지원 커스텀 `SlackIcon`(color prop 없음), lucide는 `color="default"` 미지원 → Icon 필드를 `ComponentType`로 통일해 흡수. `satisfies Record<PlatformId, ...>`로 exhaustiveness 강제.

#### P4 — `OAUTH_CONFIG` 테이블
- **현재**: `background/oauth.ts`(jira) + `background/{github,linear,notion,gitlab,asana,clickup,slack}-oauth.ts` **8파일**이 `is{Platform}OAuthConfigured()` / `assertConfigured()` / `{PLATFORM}_CANCEL_ERROR_CODES`+`is{Platform}Cancellation()` / `redirectUri()`를 반복(jira도 `oauth.ts`에 동일 패턴 — `isOAuthConfigured`:240, `assertConfigured`:85, `ATLASSIAN_CANCEL_ERROR_CODES`:71, `redirectUri`:94). 소비부 `messages.ts`의 `{ available: isXOAuthConfigured() }` 8분기 나열(약 204~655행).
- **신규**: `background/oauth/config.ts` — `OAUTH_CONFIG: Record<PlatformId, {clientIdEnv; needsProxy: boolean; cancelCodes: Set<string>}>` **8키 완성**(jira 포함 — `Record<PlatformId>` exhaustiveness가 그대로 살아 새 플랫폼 추가 시 컴파일 강제) + 공용 `isConfigured(cfg)`/`assertConfigured(cfg)`/`isCancellation(cfg, code)`. `messages.ts` 8-`available` 핸들러는 `PLATFORM.map` 한 곳으로.
- **주의**: linear/gitlab은 PKCE(public)라 proxy 불요(테이블 `needsProxy:false`로 표현 — 진짜 차이). 토큰 교환 body 형태(폼 vs JSON, Slack `authed_user.access_token` 추출)는 플랫폼마다 달라 **교환 함수 자체는 어댑터별 유지**.

> **P5(Submit 디스패치 테이블화)는 이 이니셔티브에서 제외.** `SubmitFieldsDialog`의 3중 switch·모달 8핸들러는 필드 state 클로저 의존으로 리팩터 난도가 높고 회귀 위험 대비 ROI가 낮아, 필요 시 **별도 `/feature`로 분리**한다. (exhaustive `never` 가드 보존 등 제약이 커 독립 설계가 안전.)

---

## 데이터 흐름

순수 리팩터라 상태/메시지/스토리지 흐름은 **불변**이다. U1/U5/U3 등은 마크업만 컴포넌트 경계 뒤로 이동하고 props로 기존 데이터를 그대로 전달한다. P1/P4는 함수 발급 방식만 팩토리/테이블로 바뀔 뿐 실제 fetch·토큰 흐름은 동일.

## 인터페이스 설계

```ts
// U1 — 기존 재사용 + getSearchValue 확장
function SingleLazyCombobox<T>(props: {
  disabled: boolean;
  load: () => Promise<T[]>;
  getKey: (item: T) => string;
  getName: (item: T) => string;
  getItemValue?: (item: T) => string;
  getSearchValue?: (item: T) => string;  // 신규 — key/email 복합 검색 보존
  renderItem?: (item: T) => ReactNode;
  pinSelected?: boolean;
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

// U3 — 확인형 + 알림형 통합 (discriminated union)
type ActionDialogProps =
  | { type: "confirm"; trigger: ReactNode; title: string; body: string;
      confirmLabel: string; onConfirm: () => void; cancelLabel?: string;
      stopPropagation?: boolean;    // Content 클릭 전파 차단 (IssueRow 용 — 트리거 쪽은 caller의 ReactNode 책임)
      confirmTestId?: string }      // StyleChangesDialog reset-all-confirm 용
  | { type: "notice"; title: string; body: string; closeLabel?: string;
      open: boolean; onOpenChange: (open: boolean) => void;
      onClose?: () => void;                          // oauthExpired 탭 이동 · permissionExpired window.close()
      dialogTestId?: string; actionTestId?: string }; // picker-unavailable/iframe-unsupported 4개 testid 보존
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
  onToggleAttach?: (attach: boolean) => void;
  attachDisabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element;

// U7
function IconDeleteButton(props: ButtonProps & { size?: "header" | "field" }): JSX.Element;

// U8 — 기존 ColorSwatch 확장
// shape?: "square" | "round" 추가 + color 정규화(`#` 유무 흡수)를 내부로

// P1 — refresh 골격만 공용 (doFetch는 각 api 파일 잔류)
function createRefreshRunner(cfg: {
  platform: PlatformId;                       // OAuthError 직렬화용 리터럴
  refresh: () => Promise<void>;               // hook 주입 지점
}): {
  ensureFresh: (auth: OAuthAuth) => Promise<void>;              // pre-refresh (60s threshold)
  runWithAuthRetry: <R>(run: () => Promise<R>, is401: (r: R) => boolean) => Promise<R>;  // 401→refresh→재시도→재401시 OAuthError
  setRefreshHook: (h: RefreshHook) => void;
};

function prepareUpload(input: SubmitInput, uploadFn: UploadFn): Promise<{
  allFiles: FileInput[]; keyMap: Map<string, string>; resolvedCtx: MarkdownContext;
  toMedia: (...) => Media; toAttachmentMedia: (...) => Media; logsDropped: boolean;
}>;

function buildMarkdownIssueBody(ctx: MarkdownContext, opts: {
  platform: "github" | "gitlab";              // i18n 키 접두어 해소
  videoEmbed?: (url: string) => string;       // 미디어 섹션 + 첨부 섹션 두 지점 커버
}): string;

// P2
function useOAuthConnect(platform: PlatformId): {
  oauthAvailable: boolean | null; connecting: boolean;
  methods: ConnectMethod[]; startOAuth: () => Promise<void>; handleClick: () => void;
  // Slack: methods/handleClick 미사용(직결 startOAuth), Jira: 메시지 타입 매핑 테이블 경유
};

// P3
const PLATFORM_META: Record<PlatformId, {
  Icon: ComponentType<{ className?: string }>;
  labelKey: string;
  invertOnDark: boolean;
}>;

// P4 — jira 포함 8키
const OAUTH_CONFIG: Record<PlatformId, { clientIdEnv: string; needsProxy: boolean; cancelCodes: Set<string> }>;
function isConfigured(cfg: OAuthConfig): boolean;
function assertConfigured(cfg: OAuthConfig): void;
function isCancellation(cfg: OAuthConfig, code: string): boolean;
```
(P1 `runWithAuthRetry` 등 세부 타입은 구현 시 기존 코드에서 확정 — 골격만 공용이라는 경계는 불변.)

## 기존 패턴 준수

- **테스트 우선**(CLAUDE.md): 신규 헬퍼(P1 `prepareUpload`/`buildMarkdownIssueBody`, P4 `isConfigured`/`isCancellation`, U8 색 정규화)는 순수 함수 단위 테스트를 `__tests__/*.test.ts`에 먼저 작성. 선례: `background/lib/__tests__/`(adf 헬퍼), 플랫폼별 `*-oauth.test.ts` 8종(`vi.stubGlobal("chrome", ...)` stub 패턴).
- **UI 컨벤션**(DESIGN.md): 신규 UI 프리미티브는 `src/components/ui/`에, 합성 컴포넌트는 `src/sidepanel/components/`에. 색은 토큰만(raw hex 금지). 신규 공용 컴포넌트는 DESIGN §13/§14에 반영.
- **i18n**: 새 키 추가 시 ko/en 동시 갱신(PostToolUse 훅이 대칭 검사). 대부분 기존 키 재사용이라 신규 키는 최소.
- **어댑터 패턴**(ARCHITECTURE.md): P1/P4는 어댑터 경계를 넘지 않음. 플랫폼 고유 분기는 어댑터에 남김.
- **pre-arm/청크 제약**: 이 리팩터는 content script 청크(`recorders-entry`)를 건드리지 않음 — 대상은 sidepanel/background/components뿐.

## 대안 검토

- **U1b(`MultiLazyCombobox` 신규 추출)**: 검수 결과 대상 실체 없음(Label 3종은 단일선택, multi-assignee는 부재, CC 계열은 `CcMultiCombobox`로 기공통화)으로 **철회**.
- **U1에 RepoCombobox/FieldCombobox/PropertySelect까지 흡수(`onSearch`·`clearable` 확장)**: 공용 컴포넌트가 무거워지고 서버검색·동기옵션·multi 전환까지 얹으면 prop 폭증 → 3건 제외, 현행 유지.
- **U3을 `ConfirmActionDialog`/`NoticeDialog` 2개로 분리**: 두 다이얼로그가 shell(Content/Header/Footer)을 공유하므로 컴포넌트 2개는 그 껍데기가 또 중복됨. → **`type` union 단일 `ActionDialog`**로 껍데기 1회 공유.
- **P1을 `createHookedAdapter` 단일 팩토리로 doFetch까지 흡수**: doFetch가 플랫폼별(헤더 3종/baseUrl/`.data` 언랩/GraphQL)로 달라 파라미터 폭증 → **refresh 골격만 공용**, 요청 본체는 각 api 파일 잔류.
- **P1/P2/P4를 하나의 "플랫폼 프레임워크"로 대통합**: 플랫폼 고유 차이(401 분류, 렌더 모델 4종, PAT 유무)가 특수분기로 오염됨. → 클러스터별 소단위 추출로 한정.
- **P5(Submit 디스패치)를 이 이니셔티브에 포함**: 필드 state 클로저 의존·exhaustiveness 제약으로 난도가 높아 저·중위험 리팩터와 섞으면 전체 회귀 위험이 커짐. → **제외하고 별도 `/feature`로 분리.**
- **U7을 안 함**: 색은 이미 통일됐고 순수 중복 제거라 ROI 낮음 → 옵션. 예산 여유 시만.

## 위험 요소

- **시각 회귀**: U4(EmptyState 마진 흡수 시 IntegrationsTab·IssueTab 모드선택 spacing 변화), U8(linear dot border 정합)은 실제 렌더에서 이전 대비 미세 변화 가능 → Chrome 라이트/다크 육안 확인 필수.
- **e2e testid 손실**: e2e가 실제 커버하는 `attachment-remove`(U7)·`reset-all`/`reset-all-confirm`(U3)은 이동 후에도 보존돼 `pnpm test:e2e` green이어야 한다. e2e 미커버 testid(U5 로그 프리뷰 3종, U3 notice 4종, `annotation-delete` 등)는 grep+수동으로 보존 확인.
- **stopPropagation 누락**: U3에서 `IssueRow`의 카드 클릭 전파 차단(Content `stopPropagation` prop + 트리거 ReactNode의 자체 차단)을 안 넘기면 삭제 트리거 클릭이 카드 열림으로 샘.
- **P1 401 로직 회귀**: refresh hook의 재401→`OAuthError` 경로는 실제 토큰 만료에서만 재현됨 → 단위 테스트로 401→refresh→재요청 경로를 모킹 검증 + 실제 계정 회귀 권장.
- **P1 hook 소유권**: 팩토리 인스턴스는 api 모듈 top-level 1회 발급 + `setRefreshHook` 동일명 재수출. 이중 발급 시 hook과 fetch가 다른 클로저가 되어 401→refresh 무음 사망(실토큰 만료에서만 재현). oauth 모듈 발급은 순환 의존. `github-oauth.test.ts`의 load-time 등록 전제도 주의.
- **U1 검색 회귀**: `getSearchValue` 미주입 시 `ProjectCombobox`(key)·`linearFields/AssigneeCombobox`(email/id) 검색이 소실 — 이관 체크리스트에 포함.
- **U3 union 오용**: `type="notice"`인데 `onConfirm`을 기대하거나 `type="confirm"`에 `open`을 넘기는 실수는 discriminated union이 컴파일 타임에 차단 → 타입 정의를 정확히 유지.
- **`chrome.scripting MAIN world` 무관**: 본 리팩터 대상 아님(`github-upload.ts:pageBatchUploadFn` 등은 안 건드림).
