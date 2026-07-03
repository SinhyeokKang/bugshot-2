# 컴포넌트/코드 공통화 리팩터 — 구현 태스크

각 태스크(클러스터)는 **순차 착수 가능**하다 — 단, 같은 파일을 복수 태스크가 수정하므로 **병렬 착수는 금지**(아래 겹침 매트릭스). 토큰 예산에 따라 하나씩 처리한다. 공통 검증: 모든 태스크는 `pnpm typecheck` 통과 + 대상 화면 Chrome 실제 렌더 회귀 무 + 관련 `data-testid` 보존(e2e 커버 항목은 `pnpm test:e2e` green, 미커버 항목은 grep+수동).

**문서 운용**: 클러스터 완료마다 이 문서의 해당 태스크에 완료 체크를 커밋하며 문서를 유지하고, 12개 전체 완료 시점에 `docs/features/component-consolidation/`을 삭제한다(부분 완료 장기 지속 전제).

## 파일 겹침 매트릭스 (병렬 금지 쌍)

| 파일 | 관련 태스크 |
|---|---|
| `tabs/IntegrationsTab.tsx` | U3 + U4 + U7 + P3 |
| `tabs/connect/*ConnectForm.tsx` (8파일) | U2 + P2 (+P3: github/gitlab/slack 인라인 아이콘) |
| `tabs/styleEditor/StyleChangesDialog.tsx` | U2 + U3 + U7 |
| `IssueListTab.tsx` | U2 + U3 + U4 |
| `tabs/DraftingPanel.tsx` | U2 + U4 + U7 |
| `App.tsx` | U2 + U3 |
| `tabs/IssueRow.tsx` | U3 + U7 |
| `tabs/settings/LlmConnectForm.tsx` | U3 + U4 + U7 |
| `IssueTab.tsx` | U2 + U4 |
| `tabs/{linear,github,gitlab}Fields/LabelCombobox.tsx` (3파일) | U1 + U8 |
| `tabs/statusBadges/*StatusBadge.tsx` (7파일) | U6 전담 (스피너 포함 — U2 제외) |

## 선행 조건

- 신규 UI 프리미티브는 `src/components/ui/`, 합성 컴포넌트는 `src/sidepanel/components/`, background 헬퍼는 `background/lib/`(또는 `background/oauth/`)에 둔다.
- shadcn 신규 설치 불필요(전부 기존 프리미티브 조합). 필요 시 `npx shadcn@latest add <component>`.
- 신규 순수 함수는 테스트 우선(`__tests__/*.test.ts`).
- i18n 신규 키는 최소(대부분 기존 키 재사용). 추가 시 ko/en 동시.

## 태스크

### Task U1: 필드 콤보박스를 `SingleLazyCombobox`로 이관 [최우선]
- **변경 대상**: `tabs/ProjectCombobox.tsx`, `tabs/IssueTypeCombobox.tsx`, `tabs/linearFields/{Project,Team,Assignee,Label}Combobox.tsx`, `tabs/githubFields/{Assignee,Label}Combobox.tsx`, `tabs/gitlabFields/{Project,Assignee,Label}Combobox.tsx`, `tabs/asanaFields/{Workspace,Project,Assignee}Combobox.tsx`, `tabs/notionFields/DatabaseCombobox.tsx` + `SingleLazyCombobox.tsx`(`getSearchValue?` prop 추가)
- **제외**: `githubFields/RepoCombobox.tsx`(디바운스 서버검색), `jiraFields/FieldCombobox.tsx`(경쟁 제네릭 셸 — 관계 정리는 별도 후속), `notionFields/PropertySelectCombobox.tsx`(동기 옵션 + single/multi 전환) — design.md U1 제외 사유 참조. **U1b(다중선택)는 철회** — Label 3종은 단일선택이라 본 태스크 대상이고, CC 계열은 `CcMultiCombobox`로 기공통화.
- **작업 내용**: 각 파일의 Popover+Command 마크업을 제거하고 `SingleLazyCombobox<T>`에 기존 fetch를 `load`로, 표시/선택 로직을 `getKey`/`getName`/`selectedKey`/`onSelect`로 주입. `ProjectCombobox`(key 검색)·`linearFields/AssigneeCombobox`(email/id 검색)는 `getSearchValue`로 복합 검색 보존. Label 3종의 색 dot은 `renderItem`으로(U8 연동). clickup/slack 필드 채택 형태를 참고.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 주력 플랫폼(예: jira/github/linear) 필드 콤보박스 open→로딩→목록→선택→재선택 해제 실검증, 나머지 플랫폼은 typecheck+코드 대조
  - [ ] **종속 로드**: 상위 필드 변경 시 하위 필드 리로드·리셋 보존(repo→assignee/label, workspace→project→assignee, database→property 체인)
  - [ ] `ProjectCombobox` key 검색·`linearFields/AssigneeCombobox` email/id 검색 동작 보존(`getSearchValue`)
  - [ ] 로딩 스피너·에러 문구·빈 상태가 이전과 동일
  - [ ] 대상 파일 LOC 각 100~120줄 → 로더 중심으로 축소 확인

### Task U2: 스피너 공용 컴포넌트
- **변경 대상**: 신규 `src/components/ui/spinner.tsx`; 소비처 실측 56곳(`connect/*ConnectForm.tsx`, `IssueListTab.tsx:215`, `tabs/SubmitFieldsDialog.tsx`, `tabs/settings/LlmConnectDialog.tsx`, 오버레이 `App.tsx:357`·`tabs/DraftingPanel.tsx:484`·`components/AnnotationOverlay.tsx:429`, 사이즈 미지정 `IssueTab.tsx:269`·`tabs/styleEditor/StyleChangesDialog.tsx:283` 등). **`statusBadges/*StatusBadge.tsx` 7파일은 제외**(U6에 위임).
- **작업 내용**: `<Spinner size>` + `<SpinnerOverlay>` + `<SpinnerButton loading>` 추가 후 인라인 `Loader2` 교체. 사이즈 3단계 정규화(sm=h-3/md=h-4/lg=h-6+muted 내장). **미지정 2곳은 md 확정**(현재 실질 렌더와 동일 — 무손실). 이탈 클래스(`mr-1` 7곳, md+muted 3곳, lg 비-muted 1곳 `log-viewer/main.tsx:32`)는 `className` 통과로 흡수.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 콤보박스·저장버튼·오버레이 스피너 크기가 이전 관용과 일치(미지정 2곳 포함 시각 변화 0)
  - [ ] `log-viewer/main.tsx:32` 색 유지(muted 미적용)
  - [ ] 버튼 내 라벨 감춤(opacity-0) 유지, 레이아웃 점프 없음

### Task U3: `ActionDialog` 추출 (확인형 + 알림형 통합)
- **변경 대상**: 신규 `src/sidepanel/components/ActionDialog.tsx`; **확인형** `tabs/IssueRow.tsx:138`, `tabs/DraftDetailDialog.tsx:907`, `IssueListTab.tsx:188`, `tabs/IntegrationsTab.tsx:225`·`262`, `tabs/settings/LlmConnectForm.tsx:144`, `tabs/styleEditor/StyleChangesDialog.tsx:160`; **알림형** `App.tsx:240-351`(통지 다이얼로그 6개); `CancelConfirmDialog.tsx` 재구현
- **작업 내용**: `type: "confirm" | "notice"` discriminated union 단일 컴포넌트. `confirm`=trigger+cancel+confirm(2버튼)+`stopPropagation`(Content 전담 — 트리거 쪽은 caller ReactNode 책임)/`confirmTestId`/`disabled`. `notice`=controlled(`open`/`onOpenChange`)+닫기(1버튼)+**`onClose?` 액션 콜백**(oauthExpired 탭 이동·permissionExpired `window.close()`)+**`dialogTestId?`/`actionTestId?`**(notice 4개 testid 보존). shell(Content/Header/Footer)은 한 번만 정의. App.tsx의 `blurActiveElement()` 관행 유실 주의.
- **검증**:
  - [ ] `pnpm typecheck` 통과 (union 오용은 컴파일 차단 확인)
  - [ ] `IssueRow`에서 삭제 트리거 클릭이 카드를 열지 않음(트리거 `{...hoverGuard}`+차단, Content stopPropagation 보존)
  - [ ] `data-testid="reset-all"`/`reset-all-confirm` 보존 → e2e green (style-changes-dialog.spec)
  - [ ] notice 4개 testid(`picker-unavailable-dialog/-ok`, `iframe-unsupported-dialog/-ok`) grep 보존 확인 (e2e 미커버 — 수동)
  - [ ] 확인형 7곳 + 알림형 6곳의 title/body/버튼 라벨 이전과 동일
  - [ ] oauthExpired OK→통합 탭 이동, permissionExpired OK→패널 닫힘 동작 보존(`onClose`)

### Task U4: `EmptyState` 승격
- **변경 대상**: 신규 `src/sidepanel/components/EmptyState.tsx`(`IssueTab.tsx:415`의 로컬 **`EmptyShell`** 승격 + `description?`); 흡수처 9곳 — `IssueListTab.tsx:141`·`148`, `tabs/DraftingPanel.tsx:356`, `tabs/settings/LlmConnectForm.tsx:65`, `SubmitSuccessView.tsx:17`, `tabs/IntegrationsTab.tsx:172`·`205`, `IssueTab.tsx:176`; `IssueTab.tsx:166`의 별개 로컬 `EmptyState`(녹화 액션 그리드)는 **리네임**(이름 충돌 해소)
- **제외**: 로그 콘텐츠 빈 상태 6곳(`Console/Action/NetworkLogContent`) — 서브탭 보조 UI의 의도적 작은 타이포(`text-sm muted`), 표준 수렴 시 뚜렷한 시각 변화라 제외. 녹화 화면·red 배지형도 제외.
- **작업 내용**: `EmptyShell`을 공용으로 옮기고 마진을 `mb-3`로 통일. `IntegrationsTab` 2곳 + `IssueTab.tsx:176`(px-6/gap-4 이탈)도 표준 gap·padding으로 수렴 → 옵션 prop 없이 단일 컴포넌트.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 각 빈 상태의 아이콘 배지·제목·본문·버튼 렌더 동일
  - [ ] 통합 탭·모드 선택 여백이 표준으로 바뀐 게 어색하지 않은지 **라이트/다크 양쪽** 육안 확인(의도된 변화)
  - [ ] 로그 콘텐츠 빈 상태 6곳 미변경 확인

### Task U5: `LogPreviewDialog` 껍데기 추출
- **변경 대상**: 신규 `components/LogPreviewDialog.tsx`; `components/{Console,Action,Network}LogPreviewDialog.tsx`
- **작업 내용**: 껍데기(Content/Header/Footer/close·attach 버튼)를 공용화, 내부 `*LogContent`는 children. `onToggleAttach: (attach: boolean) => void`. `startedAt`/`scrollToEntryId` 유무 차이는 각 컨텐츠가 소유.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 3개 로그 프리뷰 다이얼로그 열기·닫기·attach/detach 동작 동일
  - [ ] 3개 testid grep 보존 확인 (**e2e 미커버 — 수동**: 어떤 spec도 이 testid를 사용하지 않음)

### Task U6: `StatusBadgeSelect` 통일
- **변경 대상**: 신규 `tabs/statusBadges/StatusBadgeSelect.tsx`; `statusBadges/{Asana,Linear,Gitlab,Github,Clickup,Notion,Jira}StatusBadge.tsx`
- **작업 내용**: 트리거/드롭다운 골격 공용화, 플랫폼별 state 로더·색 매핑 주입. 내부 로딩 표시는 `<Spinner>` 사용(U2 위임 경계 — U2 미착수면 인라인 유지 후 추후 교체).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 각 플랫폼 상태 배지 열기·상태 변경·로딩 표시 동일
  - [ ] 색 매핑 플랫폼별 유지

### Task U7 (옵션): `IconDeleteButton` 프리셋
- **변경 대상**: 신규 `src/components/ui/icon-delete-button.tsx`; `tabs/IssueRow.tsx:143`, `tabs/IntegrationsTab.tsx:230`, `tabs/settings/LlmConnectForm.tsx:149`, `tabs/styleEditor/StyleChangesDialog.tsx:276`, `AttachmentSection.tsx:87`, `components/annotation/AnnotationToolbar.tsx:163`, `tabs/DraftingPanel.tsx:614`·`651`·`838`
- **작업 내용**: `<IconDeleteButton size="header"|"field">` 프리셋으로 리터럴 교체. 색은 이미 통일됨.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 아이콘 크기(h-8/h-9)·hover 빨강 동일
  - [ ] `attachment-remove` 보존 → e2e green (attachments.spec) — 그 외 testid는 grep 확인

### Task U8: 라벨 색 dot을 `ColorSwatch`로 통일 [정합 개선 동반] ✅ 구현 완료 (육안 확인 잔여)
- **변경 대상**: `src/components/ui/`의 `ColorSwatch`(shape prop + 색 정규화); `tabs/{linear,github,gitlab}Fields/LabelCombobox.tsx`
- **작업 내용**: `ColorSwatch`에 `shape="round"` 추가, 3곳 인라인 dot 교체. 색 값 정규화(`#` 유무 흡수)를 `ColorSwatch` 경계 한 곳으로 — **주의: github의 `#${color}`는 버그가 아니라 API 포맷 차이 보정(GitHub API만 `#` 없는 hex 반환). `#`를 제거하면 안 된다.** 시각 정합은 linear dot border 누락 1건.
- **검증**:
  - [x] `pnpm typecheck` 통과 + 색 정규화 순수 함수 단위 테스트(`#` 유무 입력 → 동일 출력 — `normalizeSwatchColor.test.ts` 6케이스)
  - [x] **정규화 후에도 세 플랫폼 라벨 색 표시가 이전과 동일** (코드 대조: github bare hex→`#` 부여 = 이전 하드코딩과 등가, gitlab/linear `#` 포함 → 통과. 기존 ColorSwatch 소비처는 `isRenderableColorLiteral` 게이트로 bare hex 도달 불가)
  - [ ] linear dot에 border가 생기고 3플랫폼 dot 렌더가 동일 표기로 통일(**라이트/다크** 육안 확인 — 의도된 변화) — 수동 잔여
- **리뷰 후속(2026-07-03 /code-review→/refactor 반영)**: DESIGN.md·DIRECTORY.md에 `shape="round"`·LabelCombobox 소비처 갱신.

### Task P1: 어댑터 물리 중복 추출 (refresh 골격 4개 + GFM 2종) [최우선] ✅ 구현 완료
- **변경 대상**: 신규 `background/lib/createRefreshRunner.ts`·`sidepanel/lib/prepareUpload.ts`·`sidepanel/lib/buildMarkdownIssueBody.ts`(sidepanel 배치 사유는 design.md P1); `background/{github,gitlab,asana,linear}-api.ts`, `sidepanel/lib/submitTo{Github,Gitlab}.ts`, `sidepanel/lib/build{Github,Gitlab}IssueBody.ts`
- **작업 내용**: (1) refresh 골격(`ensureFresh`+hook+401 retry)만 팩토리로 공용화 — **doFetch(github 헤더 3종/gitlab baseUrl/asana `.data` 언랩/linear GraphQL)는 각 api 파일 잔류**. 팩토리 인스턴스는 api 모듈 top-level 1회 발급 + `setRefreshHook` 동일명 재수출(이중 발급 금지 — design.md hook 소유권 위험 참조). (2) `prepareUpload` 헬퍼로 업로드+inline 해소 공용화. (3) `buildMarkdownIssueBody(ctx, {platform, videoEmbed})`로 github/gitlab 본문 통합(videoEmbed는 미디어+첨부 두 지점). Jira/Notion/ClickUp/Slack 제외.
- **검증**:
  - [x] `pnpm typecheck` 통과 + `prepareUpload`/`buildMarkdownIssueBody` 단위 테스트(videoEmbed 두 지점·platform 키·inline 해소·logsDropped·requireMediaUpload) — 기존 `build*IssueBody.test.ts`는 thin wrapper 경유로 공용 헬퍼를 그대로 커버(이관 대신 회귀망 유지)
  - [x] 401→refresh→재요청→재401시 `OAuthError` 경로 모킹 테스트 (`createRefreshRunner.test.ts` 8케이스)
  - [x] `github-oauth.test.ts`의 load-time hook 등록 전제 테스트 green 유지 (전체 2579 green)
  - [ ] github/gitlab 실제 이슈 생성 회귀(본문·이미지·비디오 임베드 동일) — 수동 잔여
- **리뷰 후속(2026-07-03 /code-review→/refactor 반영)**: `createRefreshRunner` cfg 객체 → platform plain 인자, `build{Github,Gitlab}IssueBody`의 미사용 타입 알리아스(`*MediaInput`/`*BuildResult`) 삭제, `submitToGithub`의 `someUploadMissing` re-export shim 삭제(테스트는 `prepareUpload` 직수입).

### Task P2: `useOAuthConnect` 훅 + 공용 connect UI
- **변경 대상**: 신규 `src/sidepanel/hooks/useOAuthConnect.ts`, `<PlatformConnectButton>`, 파라미터화 `<PatDialog>`; `tabs/connect/*ConnectForm.tsx` 8파일
- **작업 내용**: OAuth 연결 상태·핸들러를 훅으로, 버튼/PAT 다이얼로그 공용화. **메시지 타입은 명시적 매핑 테이블**(jira만 `oauth.available` — prefix 없음, 템플릿 조립 금지). Slack은 `methods`/`handleClick` 미사용(직결 `startOAuth`), Jira `connecting`의 사이트선택 finalize 재사용·전용 에러 분류는 Jira 폼 잔류. Jira 사이트선택·Slack PAT부재·GitLab 인스턴스는 slot/children.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] **연결된 계정 플랫폼은 토큰 발급 완주, 미연결 플랫폼은 authorize 화면 진입까지** 확인(축소 기준)
  - [ ] Jira `oauth.available` 조회 정상(매핑 테이블 — 템플릿 조립 회귀 없음)
  - [ ] Jira 사이트 선택, Slack(PAT 없음), GitLab 인스턴스 입력 특수분기 보존

### Task P3: `PLATFORM_META` registry
- **변경 대상**: `src/types/platform.ts`(또는 신규 `platformMeta.tsx`); `tabs/IntegrationsTab.tsx:56`, `tabs/SubmitFieldsDialog.tsx:111`, `statusBadges/PlatformChip.tsx`(7 if + github default fallback), `statusBadges/SubmittedBadge.tsx`, connect 폼 인라인 아이콘
- **작업 내용**: `PLATFORM_META` 단일 registry로 아이콘·labelKey·invertOnDark 통합. if 체인 → registry 조회. `satisfies Record<PlatformId, ...>`로 exhaustiveness.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 8개 플랫폼 아이콘·라벨·다크모드 invert가 각 화면(통합 탭·제출 다이얼로그·칩·배지)에서 이전과 동일
  - [ ] Slack 커스텀 아이콘 렌더 정상

### Task P4: `OAUTH_CONFIG` 테이블 ✅ 구현 완료
- **변경 대상**: 신규 `background/oauth/config.ts`; `background/oauth.ts`(jira), `background/{github,linear,notion,gitlab,asana,clickup,slack}-oauth.ts`, `background/messages.ts`(8-`available` 핸들러, 약 204~655행)
- **작업 내용**: configured/assertConfigured/cancelCodes를 테이블+공용 함수로 — **jira 포함 `Record<PlatformId>` 8키 완성**(exhaustiveness 유지). `messages.ts` 8-`available` 핸들러를 map 한 곳으로. 교환 함수는 어댑터별 유지. linear/gitlab `needsProxy:false`.
- **검증**:
  - [x] `pnpm typecheck` 통과 + `isConfigured`/`isCancellation` 단위 테스트(env 유무·취소 코드 매칭 — `oauth/__tests__/config.test.ts` 11케이스)
  - [x] 각 플랫폼(jira 포함 8개) OAuth available 판정·취소 처리 동일 (기존 `*-oauth.test.ts` 8종 green + 삭제 코드 대조 — i18n 키 3계층·cancel Set 전수 일치)
  - [x] env 누락 시 해당 플랫폼 OAuth UI 비활성 동작 보존 (isConfigured false 경로 테스트 + getter lazy 조회로 `vi.stubEnv` 호환 유지)
- **리뷰 후속(2026-07-03 /code-review→/refactor 반영)**: `OAuthError`를 `oauth/errors.ts` leaf로 분리해 config↔oauth 순환 제거(oauth.ts는 re-export — 기존 importer 무변경), `notConfiguredProxyKey` optional화(linear/gitlab 필러 제거 + client 키 폴백), 8개 `*-oauth.ts`의 local `CLIENT_ID`/`PROXY_URL` const 삭제 → `OAUTH_CONFIG` getter 일원화, 고아 wrapper 4개(jira `isOAuthConfigured`·linear·notion·gitlab) 삭제 + CLAUDE.md/PERMISSION.md env 가드 서술 갱신.

> **P5(Submit 디스패치 테이블화)는 이 이니셔티브에서 제외** — `SubmitFieldsDialog` 3중 switch + 모달 8핸들러는 필드 state 클로저 의존·exhaustiveness 제약으로 난도가 높다. 필요 시 별도 `/feature`로 분리해 독립 설계한다.

## 테스트 계획

- **단위 테스트**: U8 색 정규화, P1 `prepareUpload`/`buildMarkdownIssueBody`(기존 `build*IssueBody.test.ts` 이관·통폐합 포함)+401 refresh 모킹, P4 `isConfigured`/`isCancellation`. 순수 함수만 대상(컴포넌트는 /tdd 분류상 스킵 가능). 선례: `background/lib/__tests__/`, `*-oauth.test.ts`의 chrome stub 패턴.
- **e2e**: 순수 리팩터라 신규 시나리오 없음. **실제 e2e 게이트는 `attachment-remove`(attachments.spec)·`reset-all`/`reset-all-confirm`(style-changes-dialog.spec)뿐** — 이 spec들이 green이면 통과. 그 외 testid(로그 프리뷰 3종, notice 4종, `annotation-delete` 등)는 e2e 미커버라 grep+수동 렌더로 보존 확인한다.
- **수동 테스트(Chrome)**: 시각 정합(U4 마진, U8 dot — 라이트/다크, U2 스피너 크기), 실제 이슈 생성 회귀(P1 github/gitlab 본문·미디어), OAuth 연결(P2 — 연결 계정 완주/미연결 authorize 진입), 다크모드 아이콘 invert(P3). **축소 기준**: U1·P2는 주력 플랫폼 실검증 + 나머지 typecheck·코드 대조.

## 구현 순서 권장

1. **U1** (규모 최대·기존 컴포넌트 수렴 + `getSearchValue` 소폭 확장)
2. **P1** (코드량 최다·바이트 중복, refresh 골격 한정으로 회귀 위험 낮음)
3. **U2 → U4 → U5** (저위험 기계적 — 단 U2↔U4는 `IssueTab`·`IssueListTab`·`DraftingPanel` 겹침으로 **순차**, U5는 겹침 없음)
4. **P3** (저위험·기계적)
5. **U3 · U6 · U7 · U8 · P2 · P4** (중위험 — 겹침 매트릭스 확인 후 순차 개별)

U8 착수 시 주의: github `#` prefix는 유지(정답) — 정합 대상은 linear border 누락.
(P5는 이 이니셔티브 제외 — 별도 `/feature`.)

각 태스크는 겹침 매트릭스만 지키면 위 순서와 무관하게 단건 착수 가능하다.

## 가이드 영향: 없음

전부 내부 리팩터로 사용자 노출 UX·기능 변화가 없다(시각 정합 개선만). `guide/` 갱신 불요.
