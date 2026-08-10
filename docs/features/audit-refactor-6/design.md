# audit-refactor-6 — 기술 설계

## 개요

**한 방향으로만 움직인다: N벌 → 1벌, 또는 삭제.** 새 확장 지점·플러그인 레지스트리·설정 축을 만들지 않는다. 통합 대상은 *실제 diff를 읽고* 골랐고, diff가 "이름만 다름"인 것만 합친다. 형태가 갈리는 것(플랫폼별 상태 도메인, IndexedDB 스토어별 스키마, jira/slack 커넥트 폼)은 **그대로 둔다** — 아래 판정표가 이 배치의 핵심 산출물이다.

작업 단위는 **독립 PR**이다. 그룹 간 파일 충돌이 없도록 묶었고(tasks.md), 각 그룹은 "회귀 테스트 선행 → 리팩터 → 검증" 3단으로 자기완결한다. 대규모 리팩터의 유일한 안전장치는 **리팩터 전에 출력을 고정하는 것**이므로, 골든/스냅샷 테스트가 없는 대상은 테스트를 먼저 넣는다.

## 공통화 대상 / 제외 판정 표

각 항목을 **실제 diff를 읽고** 판정했다. "중복이니까 합친다"가 아니라, **합쳤을 때 늘어나는 파라미터 수 vs 줄어드는 드리프트 면적**으로 갈랐다.

| # | 대상 | 판정 | 근거 (한 줄) |
|---|---|---|---|
| 44 | `sectionLabel` ×8 | **합친다** | 8곳 바이트 단위 동일, 파라미터 추가 0. 의존은 `t`·`sectionMdLabelKey`뿐 |
| 45 | `listItems` ×8 | **합친다** | 동일(adf·markdown만 인자명 `line` vs `l`). 순수 함수, 추가 파라미터 0 |
| 46 | `emitLogSummary` — markdown·clickup·linear·asana | **합친다 (4개만)** | md↔clickup 25줄 완전 동일, linear↔asana 24줄 완전 동일. 두 쌍의 차이는 이미 시그니처에 있는 `logsHref?` 하나뿐 |
| 46 | `emitLogSummary` — slack | **그대로 둔다** | 마크업이 Slack mrkdwn(`*제목*`, `•` 불릿). 통합하면 마크업 축 prop이 는다 |
| 46 | `emitLogSummary` — notion / adf | **그대로 둔다** | 출력이 문자열이 아니다(`NotionBlock[]` / ADF 노드). 시그니처가 근본적으로 다름 |
| 47 | `inline-${refId}.webp` 9곳 | **합친다** | 순수 문자열 함수 1개. 생성 측·조회 측이 갈리면 무음 miss라 통합 이득이 가장 크다 |
| 48 | `imageExtFromDataUrl` ×2 | **합친다 (조건부)** | 폴백 불일치(`png` vs `webp`)가 이미 잠재 버그. 단 R6 확인(도달 불가 증명) 통과 시에만 |
| 49 | `toUploadEntry` ×3 + `inlineFiles` 매핑 ×3 | **합친다** | `prepareUpload.ts:52`에 export판이 이미 있고 본문이 동일. 로컬 재정의는 타입만 좁힌 것 |
| 43 | 제출 핸들러 — `submitToX` 인자 매핑 + `setLastSubmitFields` | **합친다** | 두 파일에서 이 구간만 문자 단위 동일. 필드 하나 누락이 곧 데이터 유실이라 통합 이득 최대 |
| 43 | 제출 핸들러 — 후처리(`markSubmitted` 가드·`onSubmitted`·`reset`·`clearPicker`) | **그대로 둔다** | 두 경로가 의미상 다르다(신규는 조건부 + 콜백, 재제출은 무조건 + 에디터 리셋). 합치면 분기 prop이 늘고 R4 회귀 |
| 50 | `*ConnectFlow` — linear·asana·clickup·github·gitlab·notion | **합친다 (6개)** | 86줄이 줄 수까지 동일, diff 전량이 6개 축(id·bg 메시지·계정 타입·아이콘·라벨 키·토큰 다이얼로그) |
| 50 | `*ConnectFlow` — jira | **그대로 둔다** | 100줄. baseUrl/email 입력 경로가 더 있어 optional prop 추가를 부른다 |
| 50 | `*ConnectFlow` — slack | **그대로 둔다** | 61줄. OAuth 전용이라 토큰 다이얼로그 축 자체가 없다 |
| 51 | `*SubmittedBadge` — error/deleted 블록 + loading 블록 | **합친다 (셸만)** | 7곳 동일(`STATUS_CATEGORY_COLORS.deleted` + `issueList.deleted/unknown/submitted`). prop 2개(`kind`)면 끝 |
| 51 | `*SubmittedBadge` — 본체(coords·bg 호출·자식 배지) | **그대로 둔다** | 상태 타입·bg 메시지·자식 prop명(`asStatus`/`cuStatus`, `taskGid`/`taskId`)이 전부 달라 타입 파라미터 3개짜리 제네릭이 된다 |
| 51 | `*StatusBadge` ×7 | **그대로 둔다** | 상태 도메인이 플랫폼마다 다름(boolean / 카테고리 / open-closed / select). 옵션 목록·전이 규칙까지 prop화하면 원본보다 길어진다 |
| 52 | `DocSectionBody.emptyVariant` | **삭제** | 호출처 0, `"hide"` 분기 2곳 도달 불가 |
| 53 | connect 폼 라벨 행 34회 | **합친다 (치환만)** | `FieldRow`가 이미 단일 출처이고 `*IssueFields` 8개가 쓴다. **새 추상화 0** — 마크업을 기존 컴포넌트로 바꾸는 것뿐 |
| 53 | `htmlFor` 붙은 라벨 (jira-email·gitlab-instance 등 9곳) | **조건부** | `FieldRow`에 `htmlFor` prop이 없다. **prop 1개 추가는 허용**(접근성 회귀 방지). 추가가 싫으면 그 9곳은 제외 |
| 54 | `i18n/index.ts`의 `useT` 분리 | **합친다(분리)** | `t()`는 스토어 무의존, `useT`만 훅. 파일을 쪼개면 background 그래프에서 zustand가 빠진다 |
| 55 | `extractPath` → `networkLogPath` | **합친다** | 3줄 동일. `src/lib/network-log-path.ts`에 테스트까지 이미 있다 |
| 56 | `readStoredXAuth` ×8 | **합친다** | 순수 조회, 차이는 계정 키 1개(+jira의 legacy 폴백 1건). 테이블 8행 |
| 56 | `writeStoredXOAuthTokens` ×5 | **합친다 (필드 목록을 데이터로)** | 골격 동일, 차이는 "복사할 필드 목록 + 폴백 여부". 이걸 데이터로 들면 R8 위험이 구조적으로 사라진다 |
| 57 | `types/messages.ts`의 `sendBg`·`BgError`·에러 판독 4개 | **옮긴다** | `src/lib/bg-client.ts`. types/는 선언 전용이 원칙이고 나머지 17파일이 그걸 지킨다 |
| 57/112 | emitter 7종 | **옮긴다 + 팩토리** | `src/lib/app-events.ts` + `createEmitter<T>()`. 7벌 × 4줄이 팩토리 1개 + 호출 7줄로 |
| 58 | `coverage-report.mjs`의 `src/types/` 제외 근거 | **주석·조건 갱신** | 57 완료 후에만 의미가 있다. 57과 같은 그룹 |
| 59/111 | `PickerMessage` union 분리 | **쪼갠다** | picker / recorder / annotation은 소비 계층이 다르다. 인라인 `import("@/types/...")` 3곳도 상단 import로 |
| 61 | `INLINE_REF_RE` 테스트 | **추가** | 리팩터가 아니라 안전망. 47 계열 착수 전 선행 |
| 62 | `confirmDraft` 공통 필드 12줄 ×4 | **합친다** | 헬퍼 1개(인자 2개: `state`, `id`). 분기는 고유 필드만 스프레드로 얹는다 |
| 113 | `blob-db.ts` 7 objectStore CRUD ~30벌 | **그대로 둔다** | 제네릭 트랜잭션 래퍼는 스토어별 키·인덱스 타입을 런타임 문자열로 내린다. 회귀 = 사용자 데이터 유실. 이득 < 위험 |
| 109 | `types/platform.ts:20`의 런타임 상수 3개 | **그대로 둔다 (주석만)** | `PLATFORM_TAB_KEYS`·`CC_PREFIX`·`CC_SEPARATOR`는 타입과 1:1 대응하는 상수 테이블이라 types/ 콜로케이션이 합리적. 57과 달리 옮길 이유가 없다 — 대신 coverage 제외 근거 주석에 이 예외를 적는다 |
| 100 | `annotation-control.ts` ↔ `recorder-control.ts`의 `send()` | **합친다** | 동일 3줄. `src/sidepanel/lib/`로 |
| 101 | `withTimeout` ×2 | **합친다** | 동일. `src/lib/`로 (양쪽 다 브라우저 바운드 파일이지만 헬퍼 자체는 순수) |
| 98 | `element-locator.ts:166` 테스트 전용 export | **주석만** | 삭제하면 테스트가 깨진다. `// 테스트 전용 export` 한 줄 |
| 102 | 파일 내부 전용 export 7건 | **`export` 제거** | 외부 참조 0 확인 후 키워드만 뗀다(코드 이동 없음) |
| 107·108·110 | 미참조 export·데드 함수 | **삭제** | 착수 시 grep 재확인 필수(R10) |
| 93·94·95·96·97·99·103·104·105·106·114 | ⚪ 사소 | **감사 리포트 기재, 착수 시 재확인** | 개별 검증 생략. 주석 정리·별칭 제거·1회용 wrapper 인라인 |

## 변경 범위

그룹 단위로 적는다(= PR 단위). 파일 목록은 tasks.md와 1:1.

### G0. 안전망 (🟡61 + 회귀 테스트 선행)

- **신규** `src/lib/__tests__/inline-ref.test.ts` — `INLINE_REF_RE` 고정.
- **신규/보강** `src/sidepanel/lib/__tests__/`의 빌더 골든 테스트, `src/lib/__tests__/settings-storage.test.ts`의 write 스냅샷, `src/store/__tests__/`의 `confirmDraft` 4분기 스냅샷.
- 프로덕션 코드 변경 0.

### G1. 인라인 이미지 파일명·업로드 엔트리 단일 출처 (🟡47·48·49)

- `src/lib/inline-ref.ts` — 현재 역할: `INLINE_REF_RE` 단일 출처. 변경: `inlineUploadFilename(refId, ext?)` 추가. **이 파일이 이미 "중립 위치"로 선언돼 있고**(파일 상단 주석) background·store·sidepanel 셋 다 import 가능한 유일한 자리다.
- `src/sidepanel/lib/prepareUpload.ts` — `toUploadEntry` export 유지, `inlineFiles` 매핑을 `toInlineUploadFiles(inlineImages)` 헬퍼로. 파일명 하드코딩 2곳(:69·:101) 제거.
- `src/sidepanel/lib/submitToClickup.ts` `:33` 로컬 `toUploadEntry` 삭제 → prepareUpload판 import. `:48`·`:122` 파일명 헬퍼로.
- `src/sidepanel/lib/submitToAsana.ts` `:39` 로컬 `imageExtFromDataUrl` 삭제 → `downloadCapture` export판 import. `:63` 로컬 `toUploadEntry` 삭제. `:137` 파일명 헬퍼로(확장자 인자 사용).
- `src/sidepanel/lib/submitToLinear.ts:60` · `submitToNotion.ts:48,139` · `submitToSlack.ts:44` · `submitToJira.ts:37` — 파일명 헬퍼로.
- `src/background/messages.ts:866` — 조회 측 하드코딩을 헬퍼로. **background에서 `@/lib/inline-ref` import는 안전**(이미 `src/store/blob-db.ts:5`가 같은 파일을 쓰고 blob-db는 background 그래프에 있다).

### G2. 본문 빌더 공용 헬퍼 (🟡44·45·46 + ⚪99·103)

- **신규** `src/sidepanel/lib/issueBodyShared.ts` — `sectionLabel(section)`, `listItems(content)`, `emitMarkdownLogSummary(lines, ctx, logsHref?)`.
- `buildIssueMarkdown.ts`(:222·:226) · `buildMarkdownIssueBody.ts`(:46·:50·:233) · `buildClickupIssueBody.ts`(:36·:40·:172) · `buildLinearIssueBody.ts`(:33·:37·:164) · `buildAsanaIssueBody.ts`(:33·:37·:146) — 로컬 정의 삭제 후 import.
- `buildNotionIssueBody.ts`(:47·:51) · `buildSlackBody.ts`(:26·:30) · `buildIssueAdf.ts`(:34·:38) — `sectionLabel`·`listItems`만 import. `emitLogSummary`는 **유지**.
- ⚪99(`footerMarkdown`·`imageCell` 미세 복제)는 같은 파일군이라 이 그룹에 붙인다.

### G3. 제출 어댑터 (🟡43)

- **신규** `src/sidepanel/lib/submitAdapters.ts`(또는 플랫폼별 8파일) — 각 플랫폼에 대해:
  - 입력: 계정·필드·title·`ctx`·`inlineImages`·`captureFiles`
  - 동작: `submitToX(...)` 호출 + `useSettingsStore.getState().setLastSubmitFields(...)` + `setLastSubmittedPlatform(...)`
  - 출력: `NormalizedSubmitResult`
- `src/sidepanel/tabs/IssueCreateModal.tsx`(:158-531) — 8핸들러가 어댑터 호출 + `markSubmitted`(currentIssueId 가드) + `onSubmitted`만 남긴다.
- `src/sidepanel/tabs/DraftDetailDialog.tsx`(:403-820) — 8핸들러가 `resolveInlineImagesForSections` + 어댑터 호출 + `markSubmitted`(무조건) + `clearPicker`/`reset`만 남긴다. **Jira 핸들러의 "승격 가드 없음" POSTMORTEM 주석은 호출처에 남긴다.**
- **CLAUDE.md 게이트 확인**: 어댑터는 `sidepanel/lib/`에 둔다. `sidepanel/tabs/`에 두면 store가 import할 수 없고(현재 store는 안 쓰지만 `initialJiraFields` 선례가 같은 이유로 `lib/`에 있다), 무엇보다 두 tabs 컴포넌트가 서로를 import하는 형태를 피한다.

### G4. 커넥트 폼 통합 (🟡50 + 🟡53)

- **신규** `src/sidepanel/tabs/connect/PlatformConnectFlow.tsx` — 6개 폼의 공통 86줄.
- `LinearConnectForm.tsx`(:42) · `AsanaConnectForm.tsx` · `ClickupConnectForm.tsx` · `GithubConnectForm.tsx` · `GitlabConnectForm.tsx` · `NotionConnectForm.tsx` — `*ConnectFlow`를 `PlatformConnectFlow` 호출 1개로.
- `JiraConnectForm.tsx` · `SlackConnectForm.tsx` — **변경 없음**(50 제외).
- `src/sidepanel/components/FieldRow.tsx` — `htmlFor?: string` prop 추가(53의 9곳 커버).
- connect 폼 8개 — `<label className="text-xs text-muted-foreground">` 34곳을 `FieldRow`로 치환.

### G5. 배지 셸 (🟡51)

- **신규** `src/sidepanel/tabs/statusBadges/BadgeFallback.tsx` — `{ kind: "error" | "deleted" | "loading" }` 한 축.
- `AsanaSubmittedBadge.tsx`(:54-71) · `ClickupSubmittedBadge` · `GithubSubmittedBadge` · `GitlabSubmittedBadge` · `JiraSubmittedBadge` · `LinearSubmittedBadge` · `NotionSubmittedBadge` — 두 블록을 `<BadgeFallback>` 호출로.
- `*StatusBadge.tsx` 7개 — **변경 없음**.

### G6. 타입 경계 (🟡54·55·57·58·59 + ⚪111·112)

- **신규** `src/lib/bg-client.ts` — `BgError`·`sendBg`·`isOAuthRefreshFailed`·`isOAuthCancelled`·`isOAuthNotConfigured`·`getOAuthErrorPlatform`.
- **신규** `src/lib/app-events.ts` — `createEmitter<T>()` + emitter 7종.
- `src/types/messages.ts`(:255~) — 위 심볼 제거, 선언만 남긴다. `BgResponse`·`BgRequest`·`BgInternalMessage`는 유지.
- `src/types/picker.ts`(:139) — `PickerMessage` / `RecorderMessage` / `AnnotationMessage`로 분리, `ContentMessage = PickerMessage | RecorderMessage | AnnotationMessage` 합집합 유지(기존 사용처 무변경). 인라인 `import("@/types/network")` 3곳(:143 등)을 상단 `import type`으로.
- **신규** `src/i18n/useT.ts` — `useT` 훅(스토어 의존). `src/i18n/index.ts`는 `t`·`setLocale`·`getLocale`·`dateBcp47`만(스토어 무의존).
- `src/sidepanel/lib/buildLogSummary.ts`(:122) — `extractPath` 삭제, `@/lib/network-log-path`의 `networkLogPath` 사용.
- `scripts/coverage-report.mjs`(:66) — `src/types/` 제외 근거 주석을 사실에 맞게 갱신(`platform.ts` 상수 예외 명시).
- **영향 반경 주의**: `"@/types/messages"` import는 **104개 파일**이다. 이동은 typecheck가 전량 잡지만 PR diff가 크다 — G6 안에서 커밋을 쪼갠다(bg-client / app-events / picker / i18n / network-path 각 1커밋).

### G7. `confirmDraft` 공통화 (🟡62)

- `src/store/editor-store.ts`(:842-1093) — `baseDraftRecord(state, id, logs)` 지역 헬퍼 추가, 4분기가 스프레드로 고유 필드만 얹는다. `persistAttachedLogs` 호출 블록도 4벌 → 1벌.

### G8. 데드 코드·사소 정리 (🟡52 + ⚪ 22건)

- `src/sidepanel/components/DocSectionBody.tsx`(:16·:20·:29·:43) — `emptyVariant` 제거.
- `src/store/blob-db.ts`(:483·:458·:470·:551) · `src/lib/pending-log-prune.ts:66` · `src/lib/loopback-host.ts:7` · `src/store/editor-store.ts:25` · `src/store/issues-store.ts`(:133·:161·:260) · `src/store/settings-store.ts:27` · `src/lib/url-support.ts:37` · `src/lib/log-colors.ts:7` · `src/types/platform.ts:73` — grep 0 확인 후 삭제.
- `src/i18n/index.ts:14` `getLocale` — 사용처 0이면 삭제(단 G6에서 파일을 만지므로 그때 함께).
- 파일 내부 전용 export 7건(⚪102) — `export` 키워드만 제거.
- 재진술 주석(⚪96·97·103) · 1회용 wrapper(⚪95) · `dataUrlToBlob` 로컬 사본(⚪94) · `created` 항상 true(⚪93) · 이중 단언(⚪104) · same-dir alias(⚪105) · 배치·명명(⚪114) · swatch 불변식 주석(⚪68) · `send()` 중복(⚪100) · `withTimeout` 중복(⚪101).

## 데이터 흐름

동작 불변이 목표라 흐름 자체는 안 바뀐다. 바뀌는 건 **호출 그래프의 모양**뿐이다.

```
[전] 8개 빌더 각자 sectionLabel/listItems/emitLogSummary
[후] 8개 빌더 → issueBodyShared (emitLogSummary는 4개만)

[전] IssueCreateModal.handleXSubmit ──→ submitToX
     DraftDetailDialog.handleXSubmit ─→ submitToX      (인자 매핑 2벌)
[후] IssueCreateModal.handleXSubmit ──┐
     DraftDetailDialog.handleXSubmit ─┴→ submitXAdapter → submitToX
     (후처리는 각 호출처에 남음)

[전] i18n/index.ts ──(값)──> settings-ui-store ──> zustand persist ──> SW 번들
[후] i18n/useT.ts ───(값)──> settings-ui-store          (sidepanel만)
     i18n/index.ts (t) ─── 의존 없음                     (background 공용)

[전] types/messages.ts = 선언 + BgError + sendBg + 판독4 + emitter7
[후] types/messages.ts = 선언
     lib/bg-client.ts  = BgError + sendBg + 판독4
     lib/app-events.ts = createEmitter + emitter7
```

`settings-storage`의 저장 포맷은 **바이트 단위로 동일하게 유지**된다(마이그레이션 없음). 테이블화는 write 함수가 *어떤 필드를 복사하는지*를 데이터로 옮길 뿐, 결과 envelope는 같다.

## 인터페이스 설계

```ts
// src/lib/inline-ref.ts (추가)
// 인라인 이미지 업로드 파일명의 단일 출처. 생성 측(업로드)과 조회 측(hrefMap.get)이
// 반드시 같은 문자열을 만들어야 한다 — 갈리면 href가 무음으로 miss나 이미지가 사라진다.
export function inlineUploadFilename(refId: string, ext = "webp"): string;

// src/sidepanel/lib/issueBodyShared.ts (신규)
export function sectionLabel(section: IssueSection): string;
export function listItems(content: string): string[];
// markdown 계열 4개 빌더 공용. logsHref가 있으면 파일명을 링크로 감싼다.
// slack(mrkdwn)·notion(blocks)·adf는 출력 매체가 달라 각자 유지한다.
export function emitMarkdownLogSummary(
  lines: string[],
  ctx: MarkdownContext,
  logsHref?: string,
): void;

// src/sidepanel/lib/submitAdapters.ts (신규) — 플랫폼별 8개. jira 예시.
export type JiraSubmitAdapterInput = {
  ctx: MarkdownContext;
  inlineImages: InlineImageInput[];
  captureFiles: CaptureFiles;
  account: JiraAccount;          // auth·projectKey·issueTypeName
  fields: JiraIssueFieldsState;  // issueTypeId·assigneeId·priorityId·parentKey·relates·cc
  title: string;
};
// submitToJira 호출 + setLastSubmitFields("jira", …) + setLastSubmittedPlatform("jira")까지.
// markSubmitted·onSubmitted·reset·clearPicker는 호출처 책임(경로마다 의미가 다르다).
export function submitJiraAdapter(
  input: JiraSubmitAdapterInput,
): Promise<NormalizedSubmitResult>;

// src/sidepanel/tabs/connect/PlatformConnectFlow.tsx (신규)
// sendBg 메시지는 문자열 조립이 아니라 완성된 객체로 받는다 — 조립하면 BgRequest union
// 타입 검사가 죽는다.
export type PlatformConnectFlowProps = ConnectFlowProps & {
  platformId: "linear" | "asana" | "clickup" | "github" | "gitlab" | "notion";
  availableRequest: BgRequest;             // { type: "linear.oauth.available" }
  startOAuthRequest: BgRequest;            // { type: "linear.startOAuth" }
  buildAccount: (auth: unknown) => Account; // 플랫폼별 계정 레코드 조립
  Icon: ComponentType<{ className?: string; color?: string }>;
  platformLabelKey: TranslationKey;        // "platform.tab.linear"
  tokenLabelKey: TranslationKey;           // "linear.apiKeyButton"
  TokenDialog: ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void; onConnected: () => void }>;
};

// src/sidepanel/tabs/statusBadges/BadgeFallback.tsx (신규)
export function BadgeFallback(props: { kind: "error" | "deleted" | "loading" }): JSX.Element;

// src/sidepanel/components/FieldRow.tsx (prop 추가)
htmlFor?: string;   // <label htmlFor>가 필요한 입력 행(connect 폼 9곳)

// src/lib/app-events.ts (신규)
export type Emitter<A extends unknown[] = []> = {
  subscribe(fn: (...args: A) => void): () => void;
  fire(...args: A): void;
};
export function createEmitter<A extends unknown[] = []>(): Emitter<A>;
export const onOAuthExpired: Emitter<[PlatformId | null]>;
export const onPickerUnavailable: Emitter;
export const onPickerPermissionExpired: Emitter;
export const onPickerIframeUnsupported: Emitter;
export const onBlobSaveFailed: Emitter;
export const onStateSaveFailed: Emitter;
export const onSessionSaveExhausted: Emitter;

// src/lib/settings-storage.ts (테이블화)
// read: 계정 키 + (jira만) legacy 폴백
type AuthReadSpec<A> = {
  account: keyof SettingsAccounts;
  legacy?: (env: SettingsEnvelope) => A | null | undefined;
};
// write: "복사할 필드 + 기존값 폴백 여부"를 데이터로 든다. 이 목록을 뭉개면
// 토큰 갱신 시 tokenType·scope가 지워져 재로그인이 필요해진다(R8).
type OAuthWriteSpec = {
  account: keyof SettingsAccounts;
  fields: readonly string[];          // 항상 덮어쓰는 필드
  keepIfAbsent?: readonly string[];   // `auth.X ?? cur.X` 폴백 필드 (github: refreshToken·expiresAt)
};

// src/types/picker.ts (분리)
export type PickerMessage = /* picker.* 만 */;
export type RecorderMessage = /* networkRecorder.* | consoleRecorder.* | actionRecorder.* */;
export type AnnotationMessage = /* annotation.* */;
export type ContentMessage = PickerMessage | RecorderMessage | AnnotationMessage;

// src/store/editor-store.ts (지역 헬퍼)
// saveDraft는 병합이라 키를 조건부로 빼면 이전 값이 되살아난다 — 헬퍼는 공통 필드만
// 만들고 분기가 고유 필드를 스프레드로 얹는다.
function baseDraftRecord(
  state: EditorState,
  id: string,
  logs: AttachedLogs,
): Omit<IssueRecord, "captureMode">;
```

## 기존 패턴 준수

- **"store는 `sidepanel/tabs`를 import하지 않는다"**(CLAUDE.md 게이트) — G3의 제출 어댑터를 `sidepanel/lib/`에 두는 이유. `initialJiraFields`가 같은 이유로 `lib/`에 있는 선례를 따른다.
- **"기존 dead code는 언급만 하고 삭제하지 않는다"** — 이 배치는 명시적 예외(prd.md 배경 참조). 단 대상은 감사 연번이 붙은 것뿐이고, 삭제 전 grep 재확인이 강제된다.
- **"요청하지 않은 유연성·설정 가능성·추상화 추가 금지"** — 판정표의 "그대로 둔다" 6건이 이 원칙의 적용 결과다. 특히 `blob-db` 제네릭화(⚪113)와 `*StatusBadge` 통합을 거부한 근거.
- **"테스트 우선"** — 신규 인터페이스(`issueBodyShared`·`inlineUploadFilename`·어댑터 8개·`createEmitter`·`BadgeFallback`)는 테스트를 먼저 쓴다. 기존 로직 이동도 R1·R8·R9의 스냅샷이 선행한다.
- **테스트 2트랙** — 순수 함수는 `*.test.ts`(node), `PlatformConnectFlow`·`BadgeFallback`·`FieldRow`는 렌더·인터랙션이 상태 전이를 좌우하므로 `*.test.tsx`(jsdom + testing-library).
- **pre-arm 청크 제약** — G6에서 `src/types/`를 쪼갤 때 `src/content/` 파일이 새 `src/lib/` 모듈을 static import하게 되면 `recorders-entry` 청크가 async loader로 되돌아간다. `pnpm check:prearm`이 게이트.
- **i18n 사전 2벌** — 이 배치는 i18n 키를 추가·리네임하지 않으므로 `src/log-viewer/i18n.ts` 복제 사전은 무관. 단 G5·G6이 log-viewer가 재사용하는 공용 컴포넌트(`NetworkLogContent` 등)의 import를 건드리면 `pnpm build:log-viewer` 확인.
- **커버리지 로직 스코프** — G6이 `src/types/`의 런타임을 `src/lib/`으로 옮기면 분모가 늘어난다. 같은 PR에서 테스트를 붙인다(R11).

## 대안 검토

### 대안 A — "플랫폼 어댑터 레지스트리"로 한 번에 통합

항목 43·50·51·56이 전부 "8개 플랫폼 × 같은 골격"이므로, `PLATFORM_ADAPTERS: Record<PlatformId, {connect, submit, badge, storage}>` 하나로 묶어 4개 항목을 동시에 없애는 안.

**채택하지 않음.** 세 가지 이유:
1. **실제 축이 항목마다 다르다.** 커넥트는 6/8만 동형(jira·slack 제외), 배지는 7/8이 셸만 동형, 제출은 8/8이지만 후처리가 호출처마다 다르다, 스토리지는 read 8/write 5로 개수부터 안 맞는다. 한 레지스트리에 넣으면 optional 필드가 절반이 된다.
2. **CLAUDE.md "요청하지 않은 유연성·미래 대비 추상화 금지"에 정면으로 걸린다.** 9번째 플랫폼 계획이 없다.
3. **독립 PR로 못 쪼갠다.** 이 배치의 목표는 "여러 턴에 나눠 소화"인데 레지스트리는 전부 하나의 거대 PR이 된다.

### 대안 B — 항목 43을 "제출 오케스트레이터 훅" 하나로

`useIssueSubmit({ mode: "create" | "detail" })` 커스텀 훅이 8플랫폼 × 2경로를 전부 흡수하는 안.

**채택하지 않음.** `mode` 분기가 훅 안에서 `markSubmitted` 조건부 / `reset` 여부 / `onSubmitted` 유무를 갈라야 하고, 그건 지금 호출처에 명시적으로 보이는 차이를 훅 내부의 if로 숨기는 것이다. R4가 정확히 그 지점의 회귀다. **인자 매핑만 뽑고 후처리는 보이는 곳에 남기는** 쪽이 안전하다.

### 대안 C — 항목 57을 "재export"로 무중단 처리

`src/lib/bg-client.ts`를 만들고 `src/types/messages.ts`가 `export * from "@/lib/bg-client"`로 재export해 104개 import를 안 고치는 안.

**채택하지 않음.** import는 그대로 남으므로 `src/types/`가 여전히 런타임 그래프의 일부가 되고, 🟡58(coverage 제외 근거)이 해결되지 않는다. 목표가 "경계를 실제로 옮기는 것"이라 우회는 무의미하다. 다만 **PR을 쪼개는 도구로는 유용**하므로, G6이 한 커밋에 안 들어가면 중간 상태로 재export를 두었다가 마지막 커밋에서 제거하는 것은 허용한다.

### 대안 D — 항목 62를 `confirmDraft` 분리 함수 4개로

captureMode별 `confirmFreeform`·`confirmVideo`·`confirmScreenshot`·`confirmElement`로 쪼개는 안.

**채택하지 않음.** 공통 필드 12줄이 여전히 4벌 남는다(문제가 그대로다). 헬퍼로 공통 필드를 뽑는 쪽이 목표에 직접 대응한다. 함수 길이(~252줄)는 부작용이지 이 항목의 문제가 아니다.

## 위험 요소

### 대규모 리팩터의 회귀 위험 — 완화: 테스트 선행

이 배치는 **8개 플랫폼 × 여러 경로**를 동시에 건드린다. 회귀가 나면 "특정 플랫폼의 특정 필드가 안 실린다" 같은 무음 형태다. 완화책:

1. **모든 그룹은 회귀 테스트가 먼저 들어간 뒤에 시작한다.** G0가 P0 맨 앞인 이유. 골든 출력·인자 스냅샷이 없는 대상은 리팩터를 시작하지 않는다.
2. **한 그룹 = 한 PR.** 회귀가 나면 되돌릴 단위가 명확하다.
3. **동작 불변이 판정 기준이다.** 스냅샷이 문자 단위로 같지 않으면 리팩터가 틀린 것이다(스냅샷을 갱신하는 게 아니라).

### 항목별 구체 위험

- **🟡43 (최대)** — 후처리 통합 시 재제출 기록 유실 또는 신규 제출 후 에디터 리셋. → R4. 어댑터 경계를 `setLastSubmitFields`까지로 못 박는다.
- **🟡56** — write 함수 테이블화 시 github의 `tokenType`·`scope`·폴백 유실 = 사용자 재로그인. → R8. `OAuthWriteSpec.keepIfAbsent`로 폴백을 데이터화하고, 5개 각각의 envelope 스냅샷 테스트를 선행.
- **🟡56** — jira read의 legacy 폴백(`state.jiraConfig.auth`) 유실 = 구버전 사용자 연결 해제. → 테이블에 `legacy` 필드.
- **🟡62** — `saveDraft`가 병합이라 키를 빠뜨리면 이전 값이 되살아난다(파일 내 주석이 명시). → R9. 헬퍼는 공통 필드만.
- **🟡47** — 생성 측과 조회 측이 헬퍼로 갈 때 **한쪽만 옮기면** 무음 miss. `src/background/messages.ts:866`이 다른 진입점이라 놓치기 쉽다. → R3. 9곳 전수 grep을 검증 항목으로.
- **🟡48** — 폴백 차이(`png` vs `webp`). → R6. 도달 불가 증명이 안 되면 **이 항목만 스킵**한다.
- **🟡50** — `sendBg` 메시지 타입을 문자열 조립하면 `BgRequest` union 검사가 무력화된다. → 완성된 메시지 객체를 prop으로.
- **🟡54** — `useT`를 옮기면 import 경로가 바뀌는 컴포넌트가 많다. typecheck가 전량 잡으므로 위험은 낮으나 diff가 크다.
- **🟡57** — `"@/types/messages"` import가 104개 파일. → 대안 C의 중간 재export를 쪼개기 도구로 허용.
- **🟡57/59 + pre-arm** — content script가 새 `src/lib/` 모듈을 static import하면 `recorders-entry`가 async loader로 되돌아가 pre-arm이 무음으로 죽는다. 빌드·typecheck·유닛 전부 green인 채로. → `pnpm build` 후 `pnpm check:prearm`. G6에서 **유일하게 빌드 확인이 필요**하다.
- **⚪107·108·110·102 (데드 코드)** — 감사의 "사용처 0"이 틀릴 수 있다. e2e·scripts·log-viewer는 별도 그래프다. → R10. `grep -rn <심볼> src/ e2e/ scripts/` 0건 확인을 삭제 태스크마다 체크박스로.
- **⚪98** — `element-locator.ts:166`은 테스트 전용 export다. **삭제하면 테스트가 깨진다** — 주석만 붙인다.
- **커버리지 하락** — G6이 분모를 늘린다. → R11. 이동과 테스트를 같은 PR에.
- **머지 충돌** — 다른 audit-refactor 배치와 파일이 겹칠 수 있다(특히 배치 5의 UI 항목이 connect 폼·배지를 건드리면 G4·G5와 충돌). → 배치 5가 진행 중이면 G4·G5를 뒤로 미룬다.
