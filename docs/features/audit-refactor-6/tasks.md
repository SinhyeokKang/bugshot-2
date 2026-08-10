# audit-refactor-6 — 구현 태스크

## 선행 조건

- **이 배치는 "한 번에 다 한다"가 목표가 아니다.** 아래 그룹 하나가 **독립 PR 하나**에 대응한다. 그룹 간 파일 충돌이 없도록 묶었으므로 순서를 바꿔도 되고, P0만 하고 멈춰도 유효하다. 세션 한도로 중단되면 **그룹 경계에서 끊는다**(그룹 중간에서 끊지 않는다).
- **CLAUDE.md "기존 dead code는 언급만 하고 삭제하지 않는다"의 명시적 예외 배치다.** 이 배치는 감사가 연번으로 지목한 데드 코드 정리가 목적이다. 단 **감사 연번이 붙은 것만** 대상이고, 삭제 전 grep 재확인이 모든 삭제 태스크의 검증 항목이다. 이 문단을 읽고 시작한다 — 원칙 위반이 아니다.
- **⚪ 항목(68·93~114)은 감사 리포트 기재이고 개별 검증을 생략했다. 착수 시 해당 파일·라인을 재확인**하고, 리포트와 다르면 그 항목을 스킵하고 사유를 남긴다.
- 새 의존성·권한·env 없음. shadcn 컴포넌트 추가 없음.
- 다른 audit-refactor 배치(특히 5)가 진행 중이면 **G4·G5를 뒤로 미룬다**(connect 폼·배지 파일 충돌).
- 리팩터 시작 전 `docs/POSTMORTEM.md`를 변경 영역 키워드로 grep한다(`saveDraft`·`inline`·`submitTo`·`prearm`·`settings-storage`).

---

## P0 — 안전망과 무음 데이터 유실 지점

이 셋만 끝나도 배치의 가치가 대부분 확보된다.

### G0. 회귀 테스트 선행 (🟡61 + R1·R8·R9 스냅샷)

**프로덕션 코드를 한 줄도 고치지 않는다.** 이후 모든 그룹의 그물이다.

#### Task 0-1: `INLINE_REF_RE` 고정 테스트 (🟡61)
- **변경 대상**: **신규** `src/lib/__tests__/inline-ref.test.ts`
- **작업 내용**: `src/lib/inline-ref.ts`의 주석이 명시한 불변식("삭제 판정과 해석이 같은 패턴이어야 산 이미지를 안 지운다")을 고정한다. 캡처 그룹 1=alt, 2=refId. 케이스: 기본 매치 / 빈 alt / alt에 공백·유니코드 / 한 문자열에 다중 매치(전역 플래그) / `inline:` 아닌 일반 이미지 비매치 / refId에 하이픈·숫자 / `lastIndex` 상태 오염(같은 정규식 재사용) 확인.
- **검증**:
  - [ ] `pnpm test src/lib/__tests__/inline-ref.test.ts` green
  - [ ] 패턴을 임의로 좁혀보면(예: alt를 `[^\]]+`로) 테스트가 red — 확인 후 되돌린다
  - [ ] `src/sidepanel/lib/resolveInlineImages.ts`와 `src/store/blob-db.ts:565`가 같은 상수를 쓰는지 grep으로 재확인

#### Task 0-2: 본문 빌더 골든 출력 고정 (R1·R2)
- **변경 대상**: `src/sidepanel/lib/__tests__/` — 빌더별 테스트(없으면 신규)
- **작업 내용**: 8개 빌더 각각에 대해 **로그 요약 3종(network·console·action)이 모두 있는 ctx**로 전체 출력 스냅샷을 고정한다. `logsHref`가 있는 경우(markdown·clickup)와 없는 경우(linear·asana)를 **둘 다** 넣는다. slack의 `*`/`•` 마크업, notion의 `NotionBlock[]`, adf 노드 구조도 각자 고정.
- **검증**:
  - [ ] 8개 빌더 전부 스냅샷 존재
  - [ ] `markdown-logs-link.test.ts`의 기존 케이스와 중복·충돌 없음
  - [ ] `pnpm test` green

#### Task 0-3: `settings-storage` write 5종 envelope 스냅샷 (R8)
- **변경 대상**: `src/lib/__tests__/settings-storage.test.ts`
- **작업 내용**: `writeStoredOAuthTokens`(jira)·`writeStoredGithubOAuthTokens`·`writeStoredLinearOAuthTokens`·`writeStoredGitlabOAuthTokens`·`writeStoredAsanaOAuthTokens` 각각에 대해 **저장 후 `chrome.storage.local.set`에 넘어간 envelope**를 스냅샷한다. github는 `tokenType`·`scope`가 실리는 것과 `refreshToken`/`expiresAt`이 **없을 때 기존값이 보존**되는 것을 별도 케이스로. jira read의 legacy 폴백(`state.jiraConfig.auth`) 케이스도 추가.
- **검증**:
  - [ ] 5종 각각 스냅샷 + github 폴백 케이스 + jira legacy read 케이스
  - [ ] `pnpm test` green

#### Task 0-4: `confirmDraft` 4분기 인자 스냅샷 (R9)
- **변경 대상**: `src/store/__tests__/` (editor-store 테스트, 없으면 신규)
- **작업 내용**: `captureMode`를 freeform·video·screenshot·element로 두고 `confirmDraft()`를 호출해 `useIssuesStore.saveDraft`가 받은 인자를 각각 스냅샷한다. 로그 3종 attach 상태(전부 on / 전부 off) 2조합.
- **검증**:
  - [ ] 4 captureMode × 2 로그 조합 = 8 스냅샷
  - [ ] 공통 12필드(`id`·`status`·`platform`·`title`·`createdAt`·`updatedAt`·`pageUrl`·`pageTitle`·`draft`·3 blobKey)가 4분기 전부에 존재함을 단언
  - [ ] `pnpm test` green

---

### G7. `confirmDraft` 공통 필드 통합 (🟡62)

> G0-4 완료 후 착수. 무음 데이터 유실 지점이라 P0.

#### Task 7-1: `baseDraftRecord` 헬퍼 추출
- **변경 대상**: `src/store/editor-store.ts` (:842-1093 `confirmDraft`)
- **작업 내용**: 공통 필드 12줄을 `baseDraftRecord(state, id, logs)` 지역 헬퍼로 뽑고, 4분기가 `{ ...baseDraftRecord(...), captureMode: "…", <고유 필드> }`로 얹게 한다. **`saveDraft`는 병합이므로 고유 필드를 조건부 스프레드로 빼지 않는다**(파일 내 주석이 명시 — 항상 명시). `persistAttachedLogs` 호출 블록 4벌도 분기 밖으로 1벌.
- **검증**:
  - [ ] G0-4 스냅샷 8건이 **문자 단위로 동일**(스냅샷을 갱신하지 않는다 — 다르면 리팩터가 틀린 것)
  - [ ] `confirmDraft` 함수 길이가 줄었다(~252줄 → 목표 150줄 이하)
  - [ ] `pnpm typecheck` + `pnpm test` green

---

### G1. 인라인 이미지 파일명·업로드 엔트리 단일 출처 (🟡47·48·49)

> G0-1 완료 후 착수. 파일명이 갈리면 이미지가 무음으로 사라지는 계열.

#### Task 1-1: `inlineUploadFilename` 도입
- **변경 대상**: `src/lib/inline-ref.ts`(추가) + **신규** `src/lib/__tests__/inline-ref.test.ts`에 케이스 추가
- **작업 내용**: `inlineUploadFilename(refId, ext = "webp")` 추가. **`src/lib/inline-ref.ts`에 두는 이유**: background(`messages.ts:866`)·store(`blob-db.ts:5`)·sidepanel 셋 다 import 가능한 유일한 중립 위치이고, 파일 상단 주석이 이미 그 역할을 선언했다.
- **검증**:
  - [ ] 기본 확장자 webp / 명시 확장자(asana의 `png`·`jpg`) 케이스
  - [ ] `pnpm test` green

#### Task 1-2: 9곳 하드코딩 치환
- **변경 대상**: `src/sidepanel/lib/prepareUpload.ts`(:69·:101) · `submitToClickup.ts`(:48·:122) · `submitToNotion.ts`(:48·:139) · `submitToLinear.ts:60` · `submitToSlack.ts:44` · `submitToJira.ts:37` · `submitToAsana.ts:137` · `src/background/messages.ts:866`
- **작업 내용**: 전부 `inlineUploadFilename(...)` 호출로. `submitToNotion.ts:137`의 `placeholderId`(확장자 없는 `inline-${refId}`)와 `buildNotionIssueBody.ts:269`의 같은 형태는 **파일명이 아니라 placeholder id**라 별개 — 함께 묶을지 판단하고, 묶는다면 `inlinePlaceholderId(refId)`를 따로 둔다.
- **검증**:
  - [ ] `grep -rn 'inline-\${' src/` 결과가 헬퍼 정의 + placeholder 경로만 남는다
  - [ ] 생성 측(업로드 filename)과 조회 측(`hrefMap.get`)이 **같은 함수**를 부르는지 파일별 확인
  - [ ] `pnpm typecheck` + `pnpm test` green

#### Task 1-3: `toUploadEntry` 로컬 재정의 제거 (🟡49)
- **변경 대상**: `src/sidepanel/lib/submitToClickup.ts:33` · `submitToAsana.ts:63` · `submitToSlack.ts:32`
- **작업 내용**: `prepareUpload.ts:52`의 export판을 import한다. 로컬판은 입력 타입만 좁혔을 뿐 본문이 동일 — 필요하면 `UploadFileInput`을 구조적으로 만족하는지 확인 후 제네릭 완화. `inlineFiles` 매핑 3중 복제도 `toInlineUploadFiles(inlineImages)` 하나로.
- **검증**:
  - [ ] `grep -c "function toUploadEntry" src/` = 1
  - [ ] `pnpm typecheck` + `pnpm test` green

#### Task 1-4: `imageExtFromDataUrl` 통합 (🟡48) — **조건부**
- **변경 대상**: `src/sidepanel/lib/submitToAsana.ts:39` 삭제 → `src/sidepanel/lib/downloadCapture.ts:6` export판 import
- **작업 내용**: **먼저 R6 확인**. Asana 경로의 `img.dataUrl`이 항상 `data:image/*`인지 역추적한다(인라인 이미지 출처: 에디터 캡처 blob / 붙여넣기 이미지). 증명되면 폴백 차이(`png` vs `webp`)는 도달 불가이므로 통합한다. **증명 안 되면 이 태스크만 스킵하고 사유를 커밋 메시지에 남긴다.**
  - 감사 리포트의 경로 `src/lib/downloadCapture.ts`는 오류 — 실제는 `src/sidepanel/lib/downloadCapture.ts`.
- **검증**:
  - [ ] 도달 불가 증명 또는 스킵 사유가 기록됨
  - [ ] `grep -c "function imageExtFromDataUrl" src/` = 1 (통합 시)
  - [ ] `submitToAsana` 테스트에 인라인 확장자 케이스 1건 추가
  - [ ] `pnpm test` green

---

## P1 — 드리프트 면적이 큰 중복

### G2. 본문 빌더 공용 헬퍼 (🟡44·45·46 + ⚪99·103)

> G0-2 완료 후 착수.

#### Task 2-1: `issueBodyShared.ts` 신규
- **변경 대상**: **신규** `src/sidepanel/lib/issueBodyShared.ts` + `__tests__/issueBodyShared.test.ts`
- **작업 내용**: `sectionLabel`·`listItems`·`emitMarkdownLogSummary` 3개. `emitMarkdownLogSummary`는 `logsHref?` optional을 **반드시 유지**(없으면 평문 `logs.html`, 있으면 `[logs.html](href)` — R2).
- **검증**:
  - [ ] 3함수 단위 테스트(`labelOverride` 우선 / 빈 문자열 trim / `logsHref` 유무 2케이스 / 로그 3종 조합)
  - [ ] `pnpm test` green

#### Task 2-2: `sectionLabel`·`listItems` 8곳 치환
- **변경 대상**: `buildIssueMarkdown.ts`(:222·:226) · `buildMarkdownIssueBody.ts`(:46·:50) · `buildNotionIssueBody.ts`(:47·:51) · `buildLinearIssueBody.ts`(:33·:37) · `buildSlackBody.ts`(:26·:30) · `buildAsanaIssueBody.ts`(:33·:37) · `buildIssueAdf.ts`(:34·:38) · `buildClickupIssueBody.ts`(:36·:40)
- **작업 내용**: 로컬 정의 삭제 후 import. 인자명 차이(`l` vs `line`)는 본문 동일이라 무관.
- **검증**:
  - [ ] `grep -c "function sectionLabel" src/sidepanel/lib/` = 1, `listItems`도 1
  - [ ] G0-2 골든 스냅샷 8건 **무변경**
  - [ ] `pnpm test` green

#### Task 2-3: `emitLogSummary` 4곳만 치환 (🟡46)
- **변경 대상**: `buildMarkdownIssueBody.ts:233` · `buildClickupIssueBody.ts:172` · `buildLinearIssueBody.ts:164` · `buildAsanaIssueBody.ts:146`
- **작업 내용**: 4개 로컬 정의 삭제 후 `emitMarkdownLogSummary` import. **`buildSlackBody.ts:113`(mrkdwn 마크업)·`buildNotionIssueBody.ts:284`(NotionBlock[])·`buildIssueAdf.ts:262`(`emitLogSummaryAdf`)는 건드리지 않는다** — 감사가 말한 "8개 빌더"는 통합 대상이 아니다.
- **검증**:
  - [ ] slack·notion·adf 파일에 `emitLogSummary` 로컬 정의가 그대로 남아 있다
  - [ ] G0-2 골든 스냅샷 8건 무변경(특히 slack의 `•`·`*` 마크업)
  - [ ] `markdown-logs-link.test.ts` green
  - [ ] `pnpm test` green

#### Task 2-4: ⚪99·103 정리
- **변경 대상**: `buildClickupIssueBody.ts`(:52 `footerMarkdown`·:47 `imageCell`) · `buildNotionIssueBody.ts:119` · `submitToNotion.ts:43,134` · `buildEditorCapture.ts:110`
- **작업 내용**: 미세 복제 통합 + 재진술 주석 삭제. **감사 리포트 기재 — 착수 시 해당 라인 재확인.**
- **검증**:
  - [ ] 각 라인이 리포트 기술과 일치(불일치 시 스킵 + 사유)
  - [ ] `pnpm test` green

---

### G3. 제출 어댑터 (🟡43)

> 이 배치에서 가장 위험한 그룹(R4). 단독 PR로 낸다.

#### Task 3-1: 어댑터 8개 신규 + 테스트
- **변경 대상**: **신규** `src/sidepanel/lib/submitAdapters.ts`(또는 플랫폼별 파일) + `__tests__/`
- **작업 내용**: 플랫폼별로 `submitToX(...)` 인자 매핑 + `setLastSubmitFields(...)` + `setLastSubmittedPlatform(...)`까지만 담는다. **`markSubmitted`·`onSubmitted`·`clearPicker`·`reset`은 넣지 않는다**(호출처마다 의미가 다르다 — R4).
- **작업 내용(위치)**: `sidepanel/lib/`에 둔다 — CLAUDE.md "store는 `sidepanel/tabs`를 import하지 않는다" 게이트와 `initialJiraFields` 선례.
- **검증**:
  - [ ] `submitToX`를 `vi.mock`으로 잡고 **8플랫폼 각각 인자 스냅샷** 테스트
  - [ ] 어댑터에 `markSubmitted`·`onSubmitted`·`reset`·`clearPicker` 참조 0건 (grep)
  - [ ] `pnpm test` green

#### Task 3-2: `IssueCreateModal` 8핸들러 치환
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx` (:158-531)
- **작업 내용**: 각 핸들러가 어댑터 호출 + `if (currentIssueId) markSubmitted(...)` + `onSubmitted({...})`만 남긴다.
- **검증**:
  - [ ] `onSubmitted` 호출이 8핸들러 전부에 남아 있다
  - [ ] `markSubmitted`의 `currentIssueId` 가드가 유지된다
  - [ ] `pnpm typecheck` green

#### Task 3-3: `DraftDetailDialog` 8핸들러 치환
- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx` (:403-820)
- **작업 내용**: 각 핸들러가 `resolveInlineImagesForSections(...)` + 어댑터 호출 + `markSubmitted(issue.id, ...)`(무조건) + `useEditorStore` 확인 후 `clearPicker`/`reset`만 남긴다. **Jira 핸들러의 "승격 가드 없음"(POSTMORTEM) 주석을 유실하지 않는다.**
- **검증**:
  - [ ] `markSubmitted`가 **무조건** 호출된다(create 쪽의 조건부가 유입되지 않았다)
  - [ ] `clearPicker`/`reset` 블록이 8핸들러 전부에 남아 있다
  - [ ] Jira 핸들러의 POSTMORTEM 주석 존재
  - [ ] `pnpm typecheck` + `pnpm test` green
  - [ ] **수동**: jira·github·slack 각각 신규 제출 1회 + 이슈 목록에서 재제출 1회 = 6회 (R4)

---

### G6. 타입 경계 (🟡54·55·57·58·59 + ⚪106·111·112)

> import 반경이 104개 파일. 커밋을 5개로 쪼갠다.

#### Task 6-1: `useT` 분리 (🟡54 + ⚪106)
- **변경 대상**: `src/i18n/index.ts`(:4·:14·:47-51) + **신규** `src/i18n/useT.ts` + `useT` 사용처
- **작업 내용**: `useT`를 `src/i18n/useT.ts`로 옮긴다(스토어 값 import는 이쪽만). `index.ts`는 `t`·`setLocale`·`dateBcp47`만 남기고 **`@/store/settings-ui-store` 값 import를 제거**한다(`LocaleMode` 타입 import는 유지 — `import type`). ⚪106 `getLocale` 사용처 0이면 함께 삭제.
- **검증**:
  - [ ] `grep -n "settings-ui-store" src/i18n/index.ts` 결과가 `import type`만
  - [ ] `grep -rn "getLocale" src/ e2e/ scripts/` 0건 확인 후 삭제
  - [ ] `pnpm typecheck` + `pnpm test` green
  - [ ] `pnpm build` 후 `pnpm check:prearm` 통과

#### Task 6-2: `bg-client.ts` 분리 (🟡57)
- **변경 대상**: **신규** `src/lib/bg-client.ts` + `__tests__/bg-client.test.ts`, `src/types/messages.ts`(:255-326), `"@/types/messages"` import 파일들
- **작업 내용**: `BgError`·`sendBg`·`isOAuthRefreshFailed`·`isOAuthCancelled`·`isOAuthNotConfigured`·`getOAuthErrorPlatform`을 옮긴다. import 반경이 크면 **중간 커밋에서 `export * from "@/lib/bg-client"` 재export를 두었다가 마지막 커밋에서 제거**한다(대안 C).
- **검증**:
  - [ ] `sendBg` 테스트 추가(`chrome.runtime.sendMessage` 목킹 — `lastError` / `ok:false` / 성공 3케이스)
  - [ ] 에러 판독 4개 테스트 추가
  - [ ] `src/types/messages.ts`에 재export가 남아 있지 않다
  - [ ] `pnpm typecheck` + `pnpm test` green
  - [ ] `pnpm build:log-viewer` 통과

#### Task 6-3: `app-events.ts` + `createEmitter` (🟡57 + ⚪112)
- **변경 대상**: **신규** `src/lib/app-events.ts` + `__tests__/app-events.test.ts`, `src/types/messages.ts`(:328-375)
- **작업 내용**: `createEmitter<A>()` 팩토리 + emitter 7종. 각 emitter 위의 설명 주석(`onStateSaveFailed` 등)은 **그대로 옮긴다**(WHY 주석이라 삭제 대상 아님).
- **검증**:
  - [ ] `createEmitter` 테스트(subscribe/fire/unsubscribe/다중 리스너)
  - [ ] emitter 7개 전부 이동, `src/types/messages.ts`에 `export const` 0건
  - [ ] `pnpm typecheck` + `pnpm test` green

#### Task 6-4: `PickerMessage` 분리 (🟡59 + ⚪111)
- **변경 대상**: `src/types/picker.ts`(:139-159) + 사용처
- **작업 내용**: `PickerMessage`(picker.*) / `RecorderMessage`(networkRecorder·consoleRecorder·actionRecorder.*) / `AnnotationMessage`(annotation.*)로 쪼개고 `ContentMessage` 합집합을 유지해 **기존 사용처를 안 건드린다**. 인라인 `import("@/types/network")`·`import("@/types/console")`·`import("@/types/action")` 3곳을 상단 `import type`으로.
- **검증**:
  - [ ] 기존 `PickerMessage` 사용처가 컴파일 에러 없이 남거나 `ContentMessage`로 명시 치환됨
  - [ ] `pnpm typecheck` green
  - [ ] `pnpm build` 후 `pnpm check:prearm` 통과 (**content script가 새 import를 타지 않는지** — 이 태스크의 최대 위험)

#### Task 6-5: `extractPath` 제거 + coverage 근거 갱신 (🟡55·58)
- **변경 대상**: `src/sidepanel/lib/buildLogSummary.ts:122` · `scripts/coverage-report.mjs:66`
- **작업 내용**: `extractPath` 삭제, 호출처를 `@/lib/network-log-path`의 `networkLogPath`로. `networkLogPath`에만 있는 `if (!url) return url` 가드는 **유지**(둘 다 `""`를 반환하므로 실동작 동일). `isBrowserBound()`의 `src/types/` 제외 근거 주석을 사실에 맞게 갱신하고, `src/types/platform.ts`의 런타임 상수 3개(`PLATFORM_TAB_KEYS`·`CC_PREFIX`·`CC_SEPARATOR`)를 **의도적 예외로 명시**한다.
- **검증**:
  - [ ] `grep -rn "extractPath" src/` 0건
  - [ ] `grep -n "^export \(class\|function\|const\)" src/types/*.ts` 결과가 `platform.ts`의 상수 3개뿐
  - [ ] `pnpm test` green
  - [ ] `pnpm coverage:report` — 로직 스코프 라인 % **하락 없음**(R11)

---

### G4. 커넥트 폼 통합 (🟡50 + 🟡53)

#### Task 4-1: `PlatformConnectFlow` 신규
- **변경 대상**: **신규** `src/sidepanel/tabs/connect/PlatformConnectFlow.tsx` + `__tests__/PlatformConnectFlow.test.tsx`
- **작업 내용**: 6개 폼의 공통 86줄. **`sendBg` 메시지는 완성된 `BgRequest` 객체를 prop으로 받는다** — 문자열 조립(`` `${id}.startOAuth` ``)하면 union 타입 검사가 죽는다.
- **검증**:
  - [ ] jsdom 렌더 테스트: `oauthAvailable === null` 동안 버튼 disabled / OAuth 있으면 `ConnectMethodDialog` 열림 / 없으면 토큰 다이얼로그 직행 / `connecting` 중 스피너 + `aria-disabled`
  - [ ] `pnpm test` green

#### Task 4-2: 6개 폼 치환
- **변경 대상**: `LinearConnectForm.tsx`(:42) · `AsanaConnectForm.tsx` · `ClickupConnectForm.tsx` · `GithubConnectForm.tsx` · `GitlabConnectForm.tsx` · `NotionConnectForm.tsx`
- **작업 내용**: 각 `*ConnectFlow`를 `PlatformConnectFlow` 호출 1개로. **`JiraConnectForm.tsx`·`SlackConnectForm.tsx`는 건드리지 않는다.**
- **검증**:
  - [ ] jira·slack 두 파일 diff 0
  - [ ] `pnpm typecheck` green
  - [ ] **수동**: 6개 플랫폼 각각 연결 해제 → 재연결(OAuth env가 있으면 OAuth 1회 + 토큰 1회, 없으면 토큰만) (R5)

#### Task 4-3: connect 폼 라벨 34곳 → `FieldRow` (🟡53)
- **변경 대상**: `src/sidepanel/components/FieldRow.tsx`(prop 추가) + connect 폼 8개
- **작업 내용**: `FieldRow`에 `htmlFor?: string` 추가(입력 연결이 있는 9곳 커버). `<label className="text-xs text-muted-foreground">` 34곳을 `FieldRow`로 치환. **새 추상화 없음 — 기존 단일 출처로의 치환뿐.**
  - 감사의 "27회"는 실측 34회(asana 4·clickup 5·github 4·gitlab 5·jira 7·linear 5·notion 3·slack 1).
- **검증**:
  - [ ] `grep -c '<label' src/sidepanel/tabs/connect/*ConnectForm.tsx` 합계 0
  - [ ] `htmlFor`가 있던 9곳이 여전히 입력과 연결됨(렌더 테스트 또는 수동 라벨 클릭 → 포커스 이동)
  - [ ] `pnpm typecheck` + `pnpm test` green

---

### G5. 배지 셸 (🟡51)

#### Task 5-1: `BadgeFallback` 신규 + 7곳 치환
- **변경 대상**: **신규** `src/sidepanel/tabs/statusBadges/BadgeFallback.tsx` + `__tests__/`, `Asana`·`Clickup`·`Github`·`Gitlab`·`Jira`·`Linear`·`Notion` `SubmittedBadge.tsx`
- **작업 내용**: error/deleted 블록(`STATUS_CATEGORY_COLORS.deleted` + `issueList.deleted`/`issueList.unknown`)과 loading 블록(`issueList.submitted`)을 `<BadgeFallback kind="…" />`로. **`*StatusBadge` 7개와 `SubmittedBadge.tsx`(디스패처)·`SlackSubmittedBadge.tsx`(17줄)는 건드리지 않는다.**
- **검증**:
  - [ ] `grep -rn "STATUS_CATEGORY_COLORS.deleted" src/sidepanel/tabs/statusBadges/` = 1 (BadgeFallback만)
  - [ ] `*StatusBadge.tsx` 7개 diff 0
  - [ ] jsdom 렌더 테스트: kind 3종 각각의 문구·색상 클래스
  - [ ] `pnpm typecheck` + `pnpm test` green

---

### G8-a. 스토리지 테이블화 (🟡56)

> G0-3 완료 후 착수. R8(데이터 유실) 때문에 단독 PR로 낸다.

#### Task 8a-1: read 8종 테이블화
- **변경 대상**: `src/lib/settings-storage.ts`(:43·:50·:83·:102·:107·:126·:144·:149)
- **작업 내용**: `AuthReadSpec` 테이블 8행 + 제네릭 read 1개. **jira의 legacy 폴백(`envelope?.state?.jiraConfig?.auth`)을 테이블의 `legacy` 필드로 보전한다.** 기존 export 이름 8개는 **그대로 유지**(호출처 무변경).
- **검증**:
  - [ ] 8개 export 이름·시그니처 무변경
  - [ ] jira legacy 폴백 테스트 green (G0-3)
  - [ ] `pnpm typecheck` + `pnpm test` green

#### Task 8a-2: write 5종 테이블화
- **변경 대상**: `src/lib/settings-storage.ts`(:55·:68·:88·:112·:131)
- **작업 내용**: `OAuthWriteSpec{ account, fields, keepIfAbsent? }` 테이블 5행. **github의 `tokenType`·`scope`와 `refreshToken`/`expiresAt`의 `?? cur.X` 폴백을 `keepIfAbsent`로 데이터화한다** — 뭉개면 토큰 갱신 시 필드가 지워져 재로그인이 필요해진다(R8).
- **검증**:
  - [ ] G0-3 envelope 스냅샷 5종 + github 폴백 케이스 **문자 단위 동일**
  - [ ] 저장 포맷 변경 0(마이그레이션 불필요 확인)
  - [ ] `pnpm typecheck` + `pnpm test` green

---

## P2 — 데드 코드·사소 정리

> 개별 PR로 쪼갤 필요 없이 1~2개 PR로 묶어도 된다. **모든 삭제 태스크에 grep 재확인이 검증 항목으로 붙는다**(R10).

### Task 9-1: `DocSectionBody.emptyVariant` 제거 (🟡52)
- **변경 대상**: `src/sidepanel/components/DocSectionBody.tsx`(:16·:20·:29·:43)
- **작업 내용**: prop과 `"hide"` 분기 2곳 삭제.
- **검증**:
  - [ ] `grep -rn "emptyVariant" src/ e2e/` 0건
  - [ ] `pnpm typecheck` + `pnpm test` green

### Task 9-2: 미참조 export 삭제 (⚪107·108·110·109)
- **변경 대상**: `src/store/blob-db.ts`(:483 `clearInlineImages` · :458 · :470 · :551) · `src/lib/pending-log-prune.ts:66` · `src/lib/loopback-host.ts:7` · `src/store/editor-store.ts:25`(`SubmitResult`·`EditorTarget`·`ShotSelector`·`ReplayTrim`) · `src/store/issues-store.ts`(:133·:161·:260) · `src/store/settings-store.ts:27` · `src/lib/url-support.ts:37` · `src/lib/log-colors.ts:7` · `src/types/platform.ts:73`(미참조 타입 4종)
- **작업 내용**: **감사 리포트 기재 — 착수 시 재확인.** 심볼마다 `grep -rn "<심볼>" src/ e2e/ scripts/` 0건일 때만 삭제. `src/types/platform.ts:20`의 런타임 상수 3개는 **삭제하지 않는다**(design.md 판정표 — types/ 콜로케이션이 합리적).
- **검증**:
  - [ ] 삭제한 심볼마다 grep 0건 기록(삭제 전)
  - [ ] `pnpm typecheck` + `pnpm test` green
  - [ ] `pnpm build` + `pnpm build:log-viewer` 통과 (별도 그래프 확인)

### Task 9-3: 파일 내부 전용 export의 `export` 제거 (⚪102·98)
- **변경 대상**: `src/sidepanel/picker-control.ts:459` · `src/sidepanel/tabs/issueListUtils.ts:161` · `src/sidepanel/30s-replay/frame-buffer.ts:6` · `src/sidepanel/lib/markdown-logs-link.ts:5` · `src/sidepanel/lib/renderLogRefs.ts:17` · `src/sidepanel/lib/buildAiStylingPrompt.ts:37` · `src/sidepanel/tabs/statusBadges/GithubStatusBadge.tsx:18` · `src/content/element-locator.ts:166`
- **작업 내용**: 외부 참조 0 확인 후 `export` 키워드만 제거(코드 이동 없음). **`element-locator.ts:166`은 테스트 전용 export라 삭제하면 테스트가 깨진다 — `// 테스트 전용 export` 주석만 붙인다.**
- **검증**:
  - [ ] 심볼마다 `grep -rn "<심볼>" src/ e2e/` 결과가 자기 파일(+ `element-locator`는 테스트)뿐
  - [ ] `pnpm typecheck` + `pnpm test` green

### Task 9-4: 중복 헬퍼 2건 (⚪100·101·94)
- **변경 대상**: `src/sidepanel/annotation-control.ts:8` ↔ `src/sidepanel/recorder-control.ts:5`(`send()`) · `src/sidepanel/lib/video-thumbnail.ts:8` ↔ `src/sidepanel/30s-replay/encode-range.ts:75`(`withTimeout`) · `src/background/notion-api.ts:291`(`dataUrlToBlob` 로컬 사본)
- **작업 내용**: 각각 단일 출처로. `withTimeout`은 순수 함수라 `src/lib/`으로 승격 가능(테스트 추가). `dataUrlToBlob`은 `src/store/blob-db.ts`의 export판이 background 그래프에 이미 있으므로 그걸 쓴다.
- **검증**:
  - [ ] `grep -c "function withTimeout\|const withTimeout" src/` = 1, `send` / `dataUrlToBlob`도 각 1
  - [ ] `withTimeout` 단위 테스트 추가(타임아웃 / 정상 resolve / reject)
  - [ ] `pnpm typecheck` + `pnpm test` green

### Task 9-5: 주석·별칭·미세 정리 (⚪68·93·95·96·97·103·104·105·114)
- **변경 대상**: `src/content/overlay.ts:678`(swatch 불변식 주석 추가) · `src/background/github-upload.ts:39`(`created` 항상 true) · `src/background/github-oauth.ts:20`(1회용 wrapper 군집) · `src/content/css-source-cache.ts:624`(WHAT 재진술 영어 주석 5건) · `src/content/network-recorder.ts:9`(재진술 주석) · `src/sidepanel/components/AnnotationOverlay.tsx:231`(재진술 주석) · `src/sidepanel/lib/trailing-throttle.ts:17`(이중 단언) · `src/sidepanel/lib/buildEditorCapture.ts:4`(same-dir alias 6건) · ⚪114 배치·명명 8곳
- **작업 내용**: **감사 리포트 기재 — 착수 시 각 라인 재확인.** 리포트와 다르면 스킵 + 사유. `css-source-cache.ts`·`network-recorder.ts`는 **회고 1위 영역 / pre-arm 청크**라 주석만 건드리고 코드는 손대지 않는다.
- **검증**:
  - [ ] `src/content/` 파일들은 주석 외 diff 0
  - [ ] `pnpm typecheck` + `pnpm test` green
  - [ ] `pnpm build` 후 `pnpm check:prearm` 통과

---

## 테스트 계획

**대전제: 리팩터 전에 회귀 테스트가 먼저 들어간다(G0).** 스냅샷이 리팩터 후 달라지면 스냅샷을 갱신하는 게 아니라 **리팩터가 틀린 것**이다.

### 단위 테스트 — `*.test.ts` (node)
- `src/lib/__tests__/inline-ref.test.ts` — `INLINE_REF_RE`(캡처 그룹·전역 플래그·다중 매치·`lastIndex` 오염) + `inlineUploadFilename`(기본/명시 확장자)
- `src/sidepanel/lib/__tests__/issueBodyShared.test.ts` — `sectionLabel`(labelOverride 우선·공백 trim) · `listItems`(CRLF·빈 줄·trim) · `emitMarkdownLogSummary`(`logsHref` 유무 × 로그 3종 조합)
- `src/sidepanel/lib/__tests__/` 빌더 8개 골든 출력(G0-2)
- `src/sidepanel/lib/__tests__/submitAdapters.test.ts` — `submitToX` `vi.mock` 후 8플랫폼 인자 스냅샷 + `setLastSubmitFields` 인자 스냅샷
- `src/lib/__tests__/settings-storage.test.ts` — write 5종 envelope 스냅샷 + github `keepIfAbsent` 폴백 + jira legacy read
- `src/store/__tests__/` — `confirmDraft` 4 captureMode × 2 로그 조합 인자 스냅샷
- `src/lib/__tests__/bg-client.test.ts` — `sendBg`(lastError / `ok:false` / 성공) + 에러 판독 4개
- `src/lib/__tests__/app-events.test.ts` — `createEmitter`(subscribe/fire/unsubscribe/다중)
- `src/lib/__tests__/withTimeout.test.ts` — 타임아웃/resolve/reject

### 컴포넌트 테스트 — `*.test.tsx` (jsdom + testing-library)
- `PlatformConnectFlow.test.tsx` — `oauthAvailable === null` disabled / OAuth 경로 → 메서드 다이얼로그 / 토큰 전용 → 토큰 다이얼로그 직행 / `connecting` 스피너 + `aria-disabled`
- `BadgeFallback.test.tsx` — kind 3종의 문구·색상 클래스
- `FieldRow` — `htmlFor` prop 추가 시 라벨-입력 연결(`getByLabelText`)

### e2e 시나리오
**없음.** 이 배치는 사용자 노출 동작을 바꾸지 않으므로 새 spec을 쓰지 않는다. 기존 e2e 스위트가 **회귀 그물로 그대로 유지**되면 된다 — 특히 G3·G4 이후 CI e2e 결론을 확인한다.

### 수동 테스트 (Chrome, `pnpm build` 선행)
- [ ] **R4** jira·github·slack 각각: 신규 제출 1회 + 이슈 목록에서 재제출 1회 (6회)
- [ ] **R5** linear·asana·clickup·github·gitlab·notion 각각 연결 해제 → 재연결
- [ ] **R6** Asana 인라인 이미지 1건 제출 후 첨부 확장자 확인 (Task 1-4 수행 시)
- [ ] **R7** `pnpm build` 후 `pnpm check:prearm` + `pnpm build:log-viewer`
- [ ] 이슈 목록에서 8플랫폼 배지가 정상/삭제/오류 상태로 렌더 (G5 이후)

---

## 구현 순서 권장

```
P0: G0 (테스트 선행) ──┬─→ G7 (confirmDraft)      [독립]
                       └─→ G1 (인라인 파일명)      [독립]

P1: G0-2 ─→ G2 (본문 빌더)                         [독립]
    G3 (제출 어댑터)                                [단독 PR — 최대 위험]
    G6 (타입 경계, 커밋 5개)                        [G6-1~6-5 순차]
    G4 (커넥트 폼)                                  [배치 5와 충돌 주의]
    G5 (배지 셸)                                    [배치 5와 충돌 주의]
    G0-3 ─→ G8-a (스토리지 테이블화)                [단독 PR — 데이터 유실 위험]

P2: G8 나머지 (데드 코드·사소)                       [1~2 PR로 묶음]
```

- **G0은 전부 선행**이지만 태스크 단위로 쪼개 대응 그룹 직전에 넣어도 된다(0-1→G1, 0-2→G2, 0-3→G8-a, 0-4→G7).
- **병렬 가능**: G1·G2·G7은 파일이 안 겹친다. G4·G5도 서로 안 겹친다.
- **직렬 필수**: G6은 커밋 순서를 지킨다(6-2의 재export를 6-2 안에서 정리). G3는 G1(파일명 헬퍼) 이후가 편하다(제출 경로가 겹친다).
- **중단 지점**: 세션 한도로 끊길 때는 **그룹 경계**에서 끊는다. 그룹 중간(예: G2의 8곳 중 4곳만 치환)에서 끊으면 정의가 중복된 상태로 남는다.

## 가이드 영향

없음 — 사용자 노출 UX·기능 변화가 0이다(prd.md 상단 참조). `guide/ko`·`guide/en` 갱신 대상 없음, i18n 키 추가·리네임 없음, `docs/privacy.{ko,en}.md` 트리거 없음(새 권한·캡처·수집·전송 동작 없음).
