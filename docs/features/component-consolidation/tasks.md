# 컴포넌트/코드 공통화 리팩터 — 구현 태스크

각 태스크(클러스터)는 **독립 착수 가능**하다. 토큰 예산에 따라 하나씩 처리한다. 공통 검증: 모든 태스크는 `pnpm typecheck` 통과 + 대상 화면 Chrome 실제 렌더 회귀 무 + 관련 `data-testid` 보존(`pnpm test:e2e` green).

## 선행 조건

- 신규 UI 프리미티브는 `src/components/ui/`, 합성 컴포넌트는 `src/sidepanel/components/`, background 헬퍼는 `background/lib/`(또는 `background/oauth/`)에 둔다.
- shadcn 신규 설치 불필요(전부 기존 프리미티브 조합). 필요 시 `npx shadcn@latest add <component>`.
- 신규 순수 함수는 테스트 우선(`__tests__/*.test.ts`).
- i18n 신규 키는 최소(대부분 기존 키 재사용). 추가 시 ko/en 동시.

## 태스크

### Task U1: 필드 콤보박스를 `SingleLazyCombobox`로 이관 [최우선]
- **변경 대상**: `tabs/ProjectCombobox.tsx`, `tabs/IssueTypeCombobox.tsx`, `tabs/linearFields/{Project,Team,Assignee}Combobox.tsx`, `tabs/githubFields/{Repo,Assignee}Combobox.tsx`, `tabs/gitlabFields/{Project,Assignee}Combobox.tsx`, `tabs/asanaFields/{Workspace,Project,Assignee}Combobox.tsx`, `tabs/notionFields/{Database,PropertySelect}Combobox.tsx`, `tabs/jiraFields/FieldCombobox.tsx` (**단일선택만**)
- **작업 내용**: 각 파일의 Popover+Command 마크업을 제거하고 `SingleLazyCombobox<T>`에 기존 fetch를 `load`로, 표시/선택 로직을 `getKey`/`getName`/`selectedKey`/`onSelect`로 주입. clickup/slack 필드 채택 형태를 참고.
- **분리**: 다중선택 Label/multi-assignee, `CcMultiCombobox`는 Task U1b(별도 컴포넌트, **이번 이니셔티브 포함**).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 각 플랫폼 필드 콤보박스 open→로딩→목록→선택→재선택 해제 동작 육안 확인
  - [ ] 로딩 스피너·에러 문구·빈 상태가 이전과 동일
  - [ ] 대상 파일 LOC 각 100~120줄 → 로더 중심으로 축소 확인

### Task U1b: 다중선택 콤보박스 `MultiLazyCombobox` 추출
- **변경 대상**: 신규 `src/sidepanel/components/MultiLazyCombobox.tsx`; `*Fields/LabelCombobox.tsx`(체크박스형), multi-assignee, `CcMultiCombobox.tsx`
- **작업 내용**: `SingleLazyCombobox`의 open-시 lazy load·loading/error/empty 골격을 공유하되 다중선택 상태(`selectedKeys`)·체크 표시·다중 그룹을 지원하는 별도 컴포넌트 추출 후 대상 이관. 라벨 색 dot은 `renderItem`으로(U8 연동).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 다중선택·부분선택·해제·검색 동작 보존
  - [ ] 라벨 색 dot 렌더 동일(U8 반영 시)

### Task U2: 스피너 공용 컴포넌트
- **변경 대상**: 신규 `src/components/ui/spinner.tsx`; 소비처 ~45곳(`connect/*ConnectForm.tsx`, `IssueListTab.tsx:215`, `SubmitFieldsDialog.tsx`, `settings/LlmConnectDialog.tsx`, 오버레이 `App.tsx:357`·`DraftingPanel.tsx:484`·`AnnotationOverlay.tsx:429`, 사이즈 미지정 이탈 `IssueTab.tsx:269`·`StyleChangesDialog.tsx:283`)
- **작업 내용**: `<Spinner size>` + `<SpinnerOverlay>` + `<SpinnerButton loading>` 추가 후 인라인 `Loader2` 교체. 사이즈 3단계로 정규화(sm=h-3/md=h-4/lg=h-6+muted).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 콤보박스·저장버튼·오버레이 스피너 크기가 이전 관용과 일치
  - [ ] 버튼 내 라벨 감춤(opacity-0) 유지, 레이아웃 점프 없음

### Task U3: `ActionDialog` 추출 (확인형 + 알림형 통합)
- **변경 대상**: 신규 `src/sidepanel/components/ActionDialog.tsx`; **확인형** `IssueRow.tsx:138`, `DraftDetailDialog.tsx:907`, `IssueListTab.tsx:188`, `IntegrationsTab.tsx:236`·`262`, `settings/LlmConnectForm.tsx:145`, `styleEditor/StyleChangesDialog.tsx:160`; **알림형** `App.tsx:246-350`(통지 다이얼로그 6개); `CancelConfirmDialog.tsx` 재구현
- **작업 내용**: `type: "confirm" | "notice"` discriminated union 단일 컴포넌트로 두 형태 커버. `confirm`=trigger+cancel+confirm(2버튼)+`stopPropagation`/`confirmTestId`/`disabled` prop, `notice`=controlled(`open`/`onOpenChange`)+닫기(1버튼). shell(Content/Header/Footer)은 한 번만 정의.
- **검증**:
  - [ ] `pnpm typecheck` 통과 (union 오용은 컴파일 차단 확인)
  - [ ] IssueRow/DraftDetailDialog에서 삭제 트리거 클릭이 카드를 열지 않음(stopPropagation 보존)
  - [ ] `data-testid="reset-all"` 및 각 확인 다이얼로그 testid 보존 → e2e green
  - [ ] 확인형 6~7곳 + 알림형 6곳의 title/body/버튼 라벨 이전과 동일
  - [ ] App.tsx 통지형이 열림/닫힘 state로 정상 제어(트리거 없이)

### Task U4: `EmptyState` 승격
- **변경 대상**: 신규 `src/sidepanel/components/EmptyState.tsx`(IssueTab 로컬 버전 승격 + `description`); 흡수처 `IssueListTab.tsx:141`·`148`, `DraftingPanel.tsx:356`, `settings/LlmConnectForm.tsx:65`, `SubmitSuccessView.tsx:17`, 로그 콘텐츠 빈 상태
- **작업 내용**: 로컬 EmptyState를 공용으로 옮기고 마진을 `mb-3`로 통일. **`IntegrationsTab`(px-6/gap-4) 2곳도 표준 gap·padding으로 수렴** → 옵션 prop 없이 17곳 전부 단일 컴포넌트. 녹화 화면·red 배지형은 제외.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 각 빈 상태의 아이콘 배지·제목·본문·버튼 렌더 동일
  - [ ] 통합 탭 여백이 표준으로 바뀐 게 어색하지 않은지 육안 확인(의도된 변화)

### Task U5: `LogPreviewDialog` 껍데기 추출
- **변경 대상**: 신규 `components/LogPreviewDialog.tsx`; `components/{Console,Action,Network}LogPreviewDialog.tsx`
- **작업 내용**: 껍데기(Content/Header/Footer/close·attach 버튼)를 공용화, 내부 `*LogContent`는 children. `startedAt`/`scrollToEntryId` 유무 차이는 각 컨텐츠가 소유.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 3개 로그 프리뷰 다이얼로그 열기·닫기·attach/detach 동작 동일
  - [ ] 각 다이얼로그 testid 보존

### Task U6: `StatusBadgeSelect` 통일
- **변경 대상**: 신규 `tabs/statusBadges/StatusBadgeSelect.tsx`; `statusBadges/{Asana,Linear,Gitlab,Github,Clickup,Notion,Jira}StatusBadge.tsx`
- **작업 내용**: 트리거/드롭다운 골격 공용화, 플랫폼별 state 로더·색 매핑 주입.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 각 플랫폼 상태 배지 열기·상태 변경·로딩 표시 동일
  - [ ] 색 매핑 플랫폼별 유지

### Task U7 (옵션): `IconDeleteButton` 프리셋
- **변경 대상**: 신규 `src/components/ui/icon-delete-button.tsx`; `IssueRow.tsx:143`, `IntegrationsTab.tsx:230`, `settings/LlmConnectForm.tsx:149`, `styleEditor/StyleChangesDialog.tsx:276`, `AttachmentSection.tsx:87`, `annotation/AnnotationToolbar.tsx:163`, `DraftingPanel.tsx:614`·`651`·`838`
- **작업 내용**: `<IconDeleteButton size="header"|"field">` 프리셋으로 리터럴 교체. 색은 이미 통일됨.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 아이콘 크기(h-8/h-9)·hover 빨강 동일, testid 보존

### Task U8: 라벨 색 dot을 `ColorSwatch`로 통일 [버그 수정 동반]
- **변경 대상**: `src/components/ui/`의 `ColorSwatch`(shape prop 추가); `tabs/{linear,github,gitlab}Fields/LabelCombobox.tsx`
- **작업 내용**: `ColorSwatch`에 `shape="round"` 추가, 3곳 인라인 dot 교체. **색 값 정규화(`#` prefix)를 한 곳으로 — github의 `#${color}` vs 나머지 raw 불일치 버그 수정.**
- **검증**:
  - [ ] `pnpm typecheck` 통과 + 색 정규화 순수 함수 단위 테스트(`#` 유무 입력 → 동일 출력)
  - [ ] linear/github/gitlab 라벨 색 dot이 동일 표기·동일 border로 렌더
  - [ ] github 라벨 색이 실제 색으로 표시(버그 수정 확인)

### Task P1: 어댑터 물리 중복 추출 (GFM/hook 4개) [최우선]
- **변경 대상**: 신규 `background/lib/createHookedAdapter.ts`·`prepareUpload.ts`·`buildMarkdownIssueBody.ts`; `background/{github,gitlab,asana,linear}-api.ts`, `submitTo{Github,Gitlab}.ts`, `build{Github,Gitlab}IssueBody.ts`
- **작업 내용**: (1) `createHookedAdapter` 팩토리로 4개 api의 authedFetch/hook 발급, (2) `prepareUpload` 헬퍼로 업로드+inline 해소 공용화, (3) `buildMarkdownIssueBody(ctx, opts)`로 github/gitlab 본문 통합(`opts.videoEmbed` 콜백). Jira/Notion/ClickUp/Slack 제외.
- **검증**:
  - [ ] `pnpm typecheck` 통과 + `prepareUpload`/`buildMarkdownIssueBody` 단위 테스트(스타일 diff·env·cc·footer·비디오 임베드 케이스)
  - [ ] 401→refresh→재요청→재401시 `OAuthError` 경로 모킹 테스트
  - [ ] github/gitlab 실제 이슈 생성 회귀(본문·이미지·비디오 임베드 동일)

### Task P2: `useOAuthConnect` 훅 + 공용 connect UI
- **변경 대상**: 신규 `src/sidepanel/hooks/useOAuthConnect.ts`, `<PlatformConnectButton>`, 파라미터화 `<PatDialog>`; `tabs/connect/*ConnectForm.tsx` 8파일
- **작업 내용**: OAuth 연결 상태·핸들러를 훅으로, 버튼/PAT 다이얼로그 공용화. Jira 사이트선택·Slack PAT부재·GitLab 인스턴스는 slot/children.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 8개 플랫폼 connect 버튼·OAuth 시작·PAT 검증 흐름 동일
  - [ ] Jira 사이트 선택, Slack(PAT 없음), GitLab 인스턴스 입력 특수분기 보존

### Task P3: `PLATFORM_META` registry
- **변경 대상**: `src/types/platform.ts`(또는 신규 `platformMeta.tsx`); `IntegrationsTab.tsx:56`, `SubmitFieldsDialog.tsx:115`, `statusBadges/PlatformChip.tsx`, `statusBadges/SubmittedBadge.tsx`, connect 폼 인라인 아이콘
- **작업 내용**: `PLATFORM_META` 단일 registry로 아이콘·labelKey·invertOnDark 통합. if 체인 → registry 조회. `satisfies Record<PlatformId, ...>`로 exhaustiveness.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 8개 플랫폼 아이콘·라벨·다크모드 invert가 각 화면(통합 탭·제출 다이얼로그·칩·배지)에서 이전과 동일
  - [ ] Slack 커스텀 아이콘 렌더 정상

### Task P4: `OAUTH_CONFIG` 테이블
- **변경 대상**: 신규 `background/oauth/config.ts`; `background/{github,linear,notion,gitlab,asana,clickup,slack}-oauth.ts`, `background/messages.ts:203-651`
- **작업 내용**: configured/assertConfigured/cancelCodes를 테이블+공용 함수로. `messages.ts` 8-`available` 핸들러를 map 한 곳으로. 교환 함수는 어댑터별 유지. linear/gitlab `needsProxy:false`.
- **검증**:
  - [ ] `pnpm typecheck` 통과 + `isConfigured`/`isCancellation` 단위 테스트(env 유무·취소 코드 매칭)
  - [ ] 각 플랫폼 OAuth available 판정·취소 처리 동일
  - [ ] env 누락 시 해당 플랫폼 OAuth UI 비활성 동작 보존

> **P5(Submit 디스패치 테이블화)는 이 이니셔티브에서 제외** — `SubmitFieldsDialog` 3중 switch + 모달 8핸들러는 필드 state 클로저 의존·exhaustiveness 제약으로 난도가 높다. 필요 시 별도 `/feature`로 분리해 독립 설계한다.

## 테스트 계획

- **단위 테스트**: U8 색 정규화, P1 `prepareUpload`/`buildMarkdownIssueBody`, P4 `isConfigured`/`isCancellation`. 순수 함수만 대상(컴포넌트는 /tdd 분류상 스킵 가능).
- **e2e 시나리오**: 순수 리팩터라 신규 시나리오는 없음. 기존 e2e가 회귀 게이트 역할 — testid 이동 후에도 green이면 통과. 특히 "삭제 트리거 클릭 시 확인 다이얼로그가 뜬다"(U3), "attachment 제거 버튼이 동작한다"(U7) 등 기존 spec 유지.
- **수동 테스트(Chrome)**: 시각 정합(U4 마진, U8 dot, U2 스피너 크기), 실제 이슈 생성 회귀(P1 github/gitlab 본문·미디어), OAuth 연결(P2), 다크모드 아이콘 invert(P3).

## 구현 순서 권장

1. **U1** (규모 최대·기존 컴포넌트 수렴, 신규 추상화 리스크 0) → 이어서 **U1b**(다중선택, U1과 같은 패턴 공유)
2. **P1** (코드량 최다·바이트 중복, 대상 4개 한정으로 회귀 위험 낮음)
3. **U2 · U4 · U5** (저위험 기계적 묶음 — 병렬 가능, 서로 독립)
4. **P3** (저위험·기계적)
5. **U3 · U6 · U7 · U8 · P2 · P4** (중위험, 서로 독립 — 예산 따라 개별)

즉시 챙길 버그: **U8의 github `#` prefix 색 표기 불일치** — U8 착수 시 최우선.
(P5는 이 이니셔티브 제외 — 별도 `/feature`.)

각 태스크는 독립이므로 위 순서는 권장일 뿐, 예산·우선도에 따라 단건 착수 가능.

## 가이드 영향: 없음

전부 내부 리팩터로 사용자 노출 UX·기능 변화가 없다(시각 정합 개선만). `guide/` 갱신 불요.
