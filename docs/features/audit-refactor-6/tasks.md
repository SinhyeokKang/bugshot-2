# audit-refactor-6 — 구현 태스크

## 선행 조건

- **이 배치는 "한 번에 다 한다"가 목표가 아니다.** 아래 그룹 하나가 **독립 PR 하나**에 대응한다. 그룹 간 파일 충돌이 없도록 묶었으므로 순서를 바꿔도 되고, P0만 하고 멈춰도 유효하다. 세션 한도로 중단되면 **그룹 경계에서 끊는다**(그룹 중간에서 끊지 않는다).
- **CLAUDE.md "기존 dead code는 언급만 하고 삭제하지 않는다"의 명시적 예외 배치다.** 이 배치는 감사가 연번으로 지목한 데드 코드 정리가 목적이다. 단 **감사 연번이 붙은 것만** 대상이고, 삭제 전 grep 재확인이 모든 삭제 태스크의 검증 항목이다. 이 문단을 읽고 시작한다 — 원칙 위반이 아니다.
- **⚪ 항목(68·93~114)은 감사 리포트 기재이고 개별 검증을 생략했다. 착수 시 해당 파일·라인을 재확인**하고, 리포트와 다르면 그 항목을 스킵하고 사유를 남긴다.
- **감사가 적은 *개수*는 전부 재실측 대상이다 (2026-08-14 — 이 배치에서만 세 번 틀렸다).** Task 1-2 9→**11**곳 · Task 1-3 `toUploadEntry` 1→**2**벌 · Task 2-3 4→**5**벌. 세 번 다 원인이 같다 — 감사가 **이름으로 열거**해서, 이름이 다르거나(`emitLogSummaryMd`) 본문이 미묘하게 다른(slack `toUploadEntry`) 것을 놓쳤다. **이름이 아니라 본문으로 센다.** 그리고 검증 항목은 "치환한 개수"가 아니라 **"남아야 할 것의 화이트리스트"**로 쓴다 — 개수는 다음 사본이 생겨도 green이지만 화이트리스트는 red가 된다(CLAUDE.md가 캐스케이드 판정에 박아둔 "열거가 아니라 화이트리스트"와 같은 형태).
- 새 의존성·권한·env 없음. shadcn 컴포넌트 추가 없음.
- 다른 audit-refactor 배치(특히 5)가 진행 중이면 **G4·G5를 뒤로 미룬다**(connect 폼·배지 파일 충돌).
- **`docs/features/french-locale/`와 G6는 같은 `src/i18n/index.ts`를 만진다 — 동시 진행 금지.** fr Task 4(`LOCALES`·`locales.fr` 등록)는 쪼갤 수 없는 원자 커밋이고 그 브랜치는 long-lived다. **fr Task 4가 dev에 들어온 뒤 G6를 착수하거나(권장), G6를 먼저 끝내고 fr 브랜치가 rebase로 흡수한다.** ⚪102의 `issueListUtils.ts`도 fr Task 7이 그 테스트를 `LOCALES` 순회로 바꾸므로 같은 규칙을 따른다. 배치 4는 무관하다(만지는 i18n 파일이 `bg-init.ts`뿐).
- **줄번호·항목 유효성은 2026-08-14에 v1.7.23(`34ac3380`) 기준으로 `/feature-review` 전수 재검증했다.** 요약: ⚪106 무효 · ⚪102에서 `issueListUtils.ts` 제외 · **🟡54(G6-1)는 배치에서 제외** · **Task 9-2는 세 갈래로 재작성**(순수 데드 4개뿐) · **항목 59의 `ContentMessage`는 코드에 없어 전제가 거짓** · G3에 `requireMediaUpload` 축 추가 · 신규 중복 2건 편입. 상세는 design.md §2026-08-14 재검증 편입 사항.
  - **주요 줄번호 이동**: `background/messages.ts` `:866`→**`:934`** · `i18n/index.ts` `useT` `:47`→**`:66`** · `buildLogSummary.ts` `extractPath` `:122`→**`:132`** · `confirmDraft` `:842-1093`→**`:845-1113`** · `buildIssueMarkdown` `sectionLabel` `:222`→**`:225`**·`listItems` `:226`→**`:229`** · `coverage-report.mjs` `:66`→**`:72`** · `picker.ts` `PickerMessage` `:139`→**`:98`** · `types/platform.ts` `:73`→**`:78`·`:100`·`:119`·`:129`** · `network-recorder.ts` `:9`→**`:12`** · `buildEditorCapture.ts` same-dir alias **6건→9건(`:5-16`)** · DDD/ICM 범위 `:158-531`/`:403-820`→**`:158-538`/`:417-838`**
- 리팩터 시작 전 `docs/POSTMORTEM.md`를 변경 영역 키워드로 grep한다(`saveDraft`·`inline`·`submitTo`·`prearm`·`settings-storage`·**`markSlackShared`·`승격`·`connect`·`번들`·`alias`·`log-viewer`**). 마지막 셋이 G6-1을 걸러냈을 키워드다.

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

#### Task 0-2: 본문 빌더 골든 출력 고정 (R1·R2) — **축소 (2026-08-14)**

> **`src/sidepanel/lib/__tests__/bodyOutputGolden.test.ts`(341줄) + 189KB 스냅샷이 이미 존재하고 8빌더 × 4 captureMode + 섹션 변주까지 고정한다.** 새로 만들지 말고 **누락 케이스 보강**(`logsHref` 유무 2케이스)만 한다 — 이중화하면 리팩터마다 두 벌을 갱신해야 한다.
>
> **다만 이 골든은 로케일 회귀에 눈이 멀었다** — `:15`가 `vi.mock("@/i18n")`으로 `t`를 키 에코, `withLocale`을 패스스루로 대체한다(`builderLocaleWrap.test.ts:7-8`이 그 사실을 명시). G2가 `sectionLabel`을 옮길 때의 로케일 스왑 회귀는 **`builderLocaleWrap.test.ts` + `e2e/issue-body-locale.spec.ts`**가 그물이므로 G2 검증 항목에 둘 다 넣는다.
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
  - [x] 4 captureMode × 2 로그 조합 = 8 스냅샷 (`src/store/__tests__/__snapshots__/editor-store.test.ts.snap`)
  - [x] 공통 12필드(`id`·`status`·`platform`·`title`·`createdAt`·`updatedAt`·`pageUrl`·`pageTitle`·`draft`·3 blobKey)가 4분기 전부에 존재함을 단언 — **실제 공통은 10개다**(로그 blobKey 3종을 뺀 9개 + `apiHostsDerived`). 위 "9개" 정정치는 audit-refactor-4가 넣은 `apiHostsDerived`를 못 세서 하나 낮았다. 단언은 키 존재 기준으로 건다 — `saveDraft` 병합에서 "키 없음"과 "값 undefined"의 의미가 갈리므로 값만 봐선 못 잡는다
  - [x] `pnpm test` green

---

### G7. `confirmDraft` 공통 필드 통합 (🟡62)

> G0-4 완료 후 착수. 무음 데이터 유실 지점이라 P0.

#### Task 7-1: `baseDraftRecord` 헬퍼 추출
- **변경 대상**: `src/store/editor-store.ts` (:842-1093 `confirmDraft`)
- **작업 내용**: 공통 필드 12줄을 `baseDraftRecord(state, id, logs)` 지역 헬퍼로 뽑고, 4분기가 `{ ...baseDraftRecord(...), captureMode: "…", <고유 필드> }`로 얹게 한다. **`saveDraft`는 병합이므로 고유 필드를 조건부 스프레드로 빼지 않는다**(파일 내 주석이 명시 — 항상 명시). ~~`persistAttachedLogs` 호출 블록 4벌도 분기 밖으로 1벌.~~ **2026-08-14 정정: 4벌이 아니라 3벌이다**(`editor-store.ts:908`·`951`·`989` — element 분기는 로그를 안 붙인다). 분기 밖으로 빼면 **element 모드에 로그가 새로 붙는 동작 변경**이 된다. **3분기 공통으로만 묶는다.** 같은 이유로 Task 0-4의 "공통 12필드가 4분기 전부에 존재" 단언도 지금 red다 — 공통 필드는 **9개**(로그 blobKey 3종 제외)로 정정한다.
- **검증**:
  - [x] G0-4 스냅샷 8건이 **문자 단위로 동일**(스냅샷을 갱신하지 않는다 — 다르면 리팩터가 틀린 것)
  - [ ] ~~`confirmDraft` 함수 길이가 줄었다(~252줄 → 목표 150줄 이하)~~ **목표치가 자기 설계와 모순이라 미충족으로 남긴다.** 실측 276 → 246줄(문서의 "~252줄"도 stale). 남은 246줄의 출처는 중복이 아니라 jira sticky 복원 33줄 + element 레코드 리터럴 ~75줄 + element 영속 IIFE ~35줄이고, 150에 닿으려면 분기별 함수 분리가 필요한데 그건 **design.md 대안 D가 명시적으로 기각한 방향**이다(같은 문단이 "함수 길이는 부작용이지 이 항목의 문제가 아니다"라고 못박았다). 길이를 정말 줄이려면 jira sticky 블록 추출을 G7 밖 별도 항목으로 뗀다
  - [x] `pnpm typecheck` + `pnpm test` green

---

### G1. 인라인 이미지 파일명·업로드 엔트리 단일 출처 (🟡47·48·49)

> G0-1 완료 후 착수. 파일명이 갈리면 이미지가 무음으로 사라지는 계열.

#### Task 1-1: `inlineUploadFilename` 도입
- **변경 대상**: `src/lib/inline-ref.ts`(추가) + **신규** `src/lib/__tests__/inline-ref.test.ts`에 케이스 추가
- **작업 내용**: `inlineUploadFilename(refId, ext = "webp")` 추가. **`src/lib/inline-ref.ts`에 두는 이유**: background(`messages.ts:866`)·store(`blob-db.ts:5`)·sidepanel 셋 다 import 가능한 유일한 중립 위치이고, 파일 상단 주석이 이미 그 역할을 선언했다.
- **검증**:
  - [x] 기본 확장자 webp / 명시 확장자(asana의 `png`·`jpg`) 케이스
  - [x] `pnpm test` green
  - [x] **2026-08-14 추가**: `inlinePlaceholderId(refId)`도 함께 뒀다(Task 1-2 판단 결과 — 아래). `inlineUploadFilename`이 그 접두사를 빌려 쓰므로 접두사 정의는 한 곳이다

#### Task 1-2: **11곳** 하드코딩 치환 (2026-08-14 재실측 — `.webp` 10곳 + asana 동적 1곳. 이전 판의 "9곳"은 과소였고 전수 개수가 틀리면 R3 검증이 무력해진다)
- **변경 대상**: `src/sidepanel/lib/prepareUpload.ts`(:69·:101) · `submitToClickup.ts`(:48·:122) · `submitToNotion.ts`(:48·:139) · `submitToLinear.ts:60` · `submitToSlack.ts:44` · `submitToJira.ts:37` · `submitToAsana.ts:137` · `src/background/messages.ts:866`
- **작업 내용**: 전부 `inlineUploadFilename(...)` 호출로. `submitToNotion.ts:137`의 `placeholderId`(확장자 없는 `inline-${refId}`)와 `buildNotionIssueBody.ts:269`의 같은 형태는 **파일명이 아니라 placeholder id**라 별개 — 함께 묶을지 판단하고, 묶는다면 `inlinePlaceholderId(refId)`를 따로 둔다.
- **검증**:
  - [x] `grep -rn 'inline-\${' src/` 결과가 헬퍼 정의 1곳만 남는다(placeholder도 `inlinePlaceholderId`로 묶었다 — 두 축이 접두사를 공유해 한쪽만 바꾸면 조용히 갈린다)
  - [x] 생성 측(업로드 filename)과 조회 측(`hrefMap`·`urlMap`·`uploadMap.get`)이 **같은 함수**를 부르는지 파일별 확인 — 8경로 전수. linear·slack은 이름 조회 자체가 없어(반환 URL 직결) 갈릴 표면이 없다
  - [x] `pnpm typecheck` + `pnpm test` green

#### Task 1-3: `toUploadEntry` 로컬 재정의 제거 (🟡49)
- **변경 대상**: `src/sidepanel/lib/submitToClickup.ts:33` · `submitToAsana.ts:63` · `submitToSlack.ts:32`
- **작업 내용**: `prepareUpload.ts:52`의 export판을 import한다. ~~로컬판은 입력 타입만 좁혔을 뿐 본문이 동일~~ **2026-08-14 정정 — Slack은 본문이 다르다.** clickup·asana 2벌은 3필드 동일이라 통합했지만, `submitToSlack.ts`의 로컬판은 `contentType`이 **없다**: `slack.uploadFiles` 페이로드 타입(`types/messages.ts`)이 `Array<{filename, dataUrl}>`뿐이라 공용판을 쓰면 미사용 필드가 메시지 경계를 넘고, `.map()` 결과라 excess property check도 그걸 안 잡는다. **대상은 clickup·asana 2벌이고 slack은 예외로 남긴다**(파일에 사유 주석). `inlineFiles` 매핑 3중 복제는 `toInlineUploadFiles(inlineImages)` 하나로 — 반환에 `refId`를 실어 호출부가 파일명을 두 번째로 조립하지 않게 한다.
- **검증**:
  - [x] `grep -c "function toUploadEntry" src/` = **2** (prepareUpload 공용판 + slack 예외 1). ~~= 1~~은 위 거짓 전제에서 나온 수치라 정정한다 — 미충족이 아니라 목표치가 틀렸다
  - [x] `pnpm typecheck` + `pnpm test` green

#### Task 1-4: `imageExtFromDataUrl` 통합 (🟡48) — **조건부**
- **변경 대상**: `src/sidepanel/lib/submitToAsana.ts:39` 삭제 → `src/sidepanel/lib/downloadCapture.ts:6` export판 import
- **작업 내용**: **먼저 R6 확인**. Asana 경로의 `img.dataUrl`이 항상 `data:image/*`인지 역추적한다(인라인 이미지 출처: 에디터 캡처 blob / 붙여넣기 이미지). 증명되면 폴백 차이(`png` vs `webp`)는 도달 불가이므로 통합한다. **증명 안 되면 이 태스크만 스킵하고 사유를 커밋 메시지에 남긴다.**
  - 감사 리포트의 경로 `src/lib/downloadCapture.ts`는 오류 — 실제는 `src/sidepanel/lib/downloadCapture.ts`.
- **검증**:
  - [x] 도달 불가 증명 기록됨 — `saveInlineImage` 호출처 4곳이 전부 `data:image/*`를 만든다: `compactImage.ts:shouldCompact`가 `image/webp`·`image/jpeg`(폭 상한 이하)에만 false를 주고 나머지는 `convertToBlob({type:"image/webp"})`로 재인코딩, 인라인 캡처·어노테이션은 canvas 산출물. 더해 `dataUrlToBlob`이 `;base64,` 없는 URL에 throw해 파싱 불가 dataUrl은 저장에 도달조차 못 한다. **폴백값이 `webpToJpeg`의 `/\.webp$/i` 게이트와 연동된다는 사실은 호출부 주석에 남겼다**(도달하면 확장자뿐 아니라 변환 여부까지 갈린다)
  - [x] `grep -c "function imageExtFromDataUrl" src/` = 1
  - [x] `submitToAsana` 테스트에 인라인 확장자 케이스 1건 — 기존 `submitToAsana.test.ts`가 이미 `inline-REF1.png`를 단언해 동적 확장자 축을 덮는다(신규 추가 불요)
  - [x] `pnpm test` green

---

## P1 — 드리프트 면적이 큰 중복

### G2. 본문 빌더 공용 헬퍼 (🟡44·45·46 + ⚪99·103)

> G0-2 완료 후 착수.

#### Task 2-1: `issueBodyShared.ts` 신규
- **변경 대상**: **신규** `src/sidepanel/lib/issueBodyShared.ts` + `__tests__/issueBodyShared.test.ts` + **`src/sidepanel/lib/__tests__/builderLocaleWrap.test.ts`(EXEMPT 등록)**
- **⚠ `builderLocaleWrap.test.ts` 갱신을 빠뜨리면 확정 red다 (2026-08-14).** 그 테스트 `:81-88`("대상 집합 완전성")은 `sidepanel/lib` 전체를 재귀 스캔해 `@/i18n`에서 `t`/`dateBcp47`를 import하는 **모든** 파일이 `WRAPPED`(9) 또는 `EXEMPT`(4) 목록에 있어야 통과시킨다. `issueBodyShared.ts`는 `sectionLabel`이 `t()`를 부르므로 필연적으로 걸린다.
  - **`EXEMPT`에 등록한다** — 사유 문자열: `"빌더 내부 헬퍼 — 진입점이 아니라 감싸진 구간 안에서만 불린다"`(`markdownToAdf.ts`와 동일 분류).
  - 역방향도 red다 — 목록에만 있고 `t`를 안 쓰면 유령 항목으로 잡힌다.
  - **`submitAdapters.ts`(G3)는 `t`를 직접 import하지 않도록 설계 제약으로 못박는다** — 가드 메시지는 호출처에 남긴다. import하게 되면 같은 처리가 필요하다.
- **작업 내용**: `sectionLabel`·`listItems`·`emitMarkdownLogSummary` 3개. `emitMarkdownLogSummary`는 `logsHref?` optional을 **반드시 유지**(없으면 평문 `logs.html`, 있으면 `[logs.html](href)` — R2).
- **검증**:
  - [x] 3함수 단위 테스트(`labelOverride` 우선 / 빈 문자열 trim / `logsHref` 유무 2케이스 / 로그 3종 조합)
  - [x] `pnpm test` green
  - [x] **`builderLocaleWrap.test.ts` EXEMPT 등록** — 문서 예고대로 등록 전 확정 red였고(`expected ['issueBodyShared.ts'] to deeply equal []`), 등록 후 green

#### Task 2-2: `sectionLabel`·`listItems` 8곳 치환
- **변경 대상**: `buildIssueMarkdown.ts`(:222·:226) · `buildMarkdownIssueBody.ts`(:46·:50) · `buildNotionIssueBody.ts`(:47·:51) · `buildLinearIssueBody.ts`(:33·:37) · `buildSlackBody.ts`(:26·:30) · `buildAsanaIssueBody.ts`(:33·:37) · `buildIssueAdf.ts`(:34·:38) · `buildClickupIssueBody.ts`(:36·:40)
- **작업 내용**: 로컬 정의 삭제 후 import. 인자명 차이(`l` vs `line`)는 본문 동일이라 무관.
- **검증**:
  - [x] `grep -c "function sectionLabel" src/sidepanel/lib/` = 1, `listItems`도 1
  - [x] G0-2 골든 스냅샷 8건 **무변경**(`git diff -- '**/__snapshots__/*'`가 0줄. 착수 전 이 골든이 이 축의 진짜 그물인지 먼저 셌다 — `md.section` 306회·`^- ` 359회·`logs.html` 링크형 25/평문 45. G1의 `inline:` 0회 건과 달리 실재한다)
  - [x] `pnpm test` green

#### Task 2-3: `emitLogSummary` ~~4곳~~ **5곳** 치환 (🟡46)
- **변경 대상**: `buildMarkdownIssueBody` · `buildClickupIssueBody` · `buildLinearIssueBody` · `buildAsanaIssueBody` + **`buildIssueMarkdown.ts:emitLogSummaryMd`(2026-08-14 추가)**
- **작업 내용**: 로컬 정의 삭제 후 `emitMarkdownLogSummary` import. **`buildSlackBody`(mrkdwn 마크업)·`buildNotionIssueBody`(NotionBlock[])·`buildIssueAdf`(`emitLogSummaryAdf`)·`buildIssueMarkdown:emitLogSummaryHtml`(HTML)은 건드리지 않는다** — 출력 매체가 다르다.
  - **2026-08-14 정정 — 4벌이 아니라 5벌이었다.** 감사가 plain `emitLogSummary`라는 **이름으로** 열거해 접미사가 붙은 둘(`emitLogSummaryMd`·`emitLogSummaryHtml`)을 안 열어봤다. `Md`판은 `lines.push(a); lines.push("")` vs `lines.push(a, "")` 차이뿐 **출력이 바이트 동일**이라 통합 대상이었고, `Html`판은 진짜로 다르다. 이름이 아니라 본문으로 세라(선행 조건 참조).
- **검증**:
  - [x] **잔여 화이트리스트**: `grep -rn "function emitLogSummary" src/sidepanel/lib/` 결과가 정확히 **{slack, notion, adf, html} 4개** — 개수 대신 집합으로 단언한다(개수만 세면 새 사본이 어떤 이름으로 생겨도 green이다)
  - [x] G0-2 골든 스냅샷 8건 무변경(특히 slack의 `•`·`*` 마크업 — 골든에 slack형 푸터 5회가 실재)
  - [x] `markdown-logs-link.test.ts` green
  - [x] `pnpm test` green

#### Task 2-4: ⚪99·103 정리
- **변경 대상**: `buildClickupIssueBody.ts`(:52 `footerMarkdown`·:47 `imageCell`) · `buildNotionIssueBody.ts:119` · `submitToNotion.ts:43,134` · `buildEditorCapture.ts:110`
- **작업 내용**: 미세 복제 통합 + 재진술 주석 삭제. **감사 리포트 기재 — 착수 시 해당 라인 재확인.**
- **검증 (2026-08-14 — 부분 완료)**:
  - [x] 각 라인이 리포트 기술과 일치(불일치 시 스킵 + 사유) — **인용 라인이 전부 어긋나 내용으로 재확인했다.**
    - **`footerMarkdown` — 통합함.** 마크다운형 **5곳**(함수 4 + asana의 인라인 리터럴 1)이 바이트 동일이라 모았다. slack은 mrkdwn 링크 문법(`<url|text>`), adf는 노드, buildIssueMarkdown의 HTML판은 `<a href>`라 각자 유지. **처음엔 `function footerMarkdown`을 이름으로 세서 asana를 놓쳤다** — 위 선행 조건의 규칙을 그 규칙을 쓴 배치가 곧바로 어긴 형태다(`grep -n "Reported via"`로 본문을 세면 6곳이 나오고 그중 매체가 같은 게 5곳이다).
    - **`imageCell` — 스킵.** linear가 `media.assetUrl`, clickup·markdown이 `media.url`로 **필드명이 다르다.** 통합하려면 접근자를 주입해야 하는데 그건 요청하지 않은 추상화다(clickup·markdown 2벌만 동일 — 남은 복제는 그 한 쌍).
    - **`buildNotionIssueBody`·`submitToNotion`·`buildEditorCapture`의 "재진술 주석" — 스킵.** 그 자리에 리포트가 기술한 주석이 없다(현재 각각 `// 환경 섹션`·없음·`// element`로, 전부 정상적인 구획 주석이다).
  - [x] `pnpm test` green

---

### G3. 제출 어댑터 (🟡43)

> 이 배치에서 가장 위험한 그룹(R4). 단독 PR로 낸다.

#### Task 3-1: 어댑터 8개 신규 + 테스트
- **변경 대상**: **신규** `src/sidepanel/lib/submitAdapters.ts`(또는 플랫폼별 파일) + `__tests__/`
- **작업 내용 (2026-08-14 형태 변경 — 순수 매핑)**: 플랫폼별로 `xSubmitArgs`·`xLastSubmitFields` **인자 매핑 함수 2개**를 둔다. **어댑터는 아무것도 실행하지 않는다** — `submitToX` 호출도, `setLastSubmitFields`도 호출처에 남는다. ~~어댑터가 `submitToX` 호출 + `setLastSubmitFields` + `setLastSubmittedPlatform`까지 담는다~~는 원안을 버린 이유: 실행형은 `setLastSubmitFields`를 `markSubmitted`·`clearPicker`/`reset` **앞으로 당긴다**(두 컴포넌트 모두 현재 submit → markSubmitted → (재제출은 reset) → setLastSubmitFields 순). 상세는 design.md §G3의 같은 날짜 정정.
  - `setLastSubmittedPlatform`은 인자가 플랫폼 상수뿐이라 매핑할 게 없어 어댑터에 없다.
  - **`markSubmitted`·`onSubmitted`·`clearPicker`·`reset`은 넣지 않는다**(호출처마다 의미가 다르다 — R4). 순수 매핑은 이걸 **구조적으로** 보장한다 — 실행이 0이라 넣을 자리가 없다.
  - **⚠ 어댑터 입력에 `requireMediaUpload?: boolean`을 추가한다 (2026-08-14).** 두 컴포넌트의 인자 매핑이 8/8 동일하다는 전제가 **틀렸다** — **github(`DraftDetailDialog:506`)·notion(`:624`)·gitlab(`:675`) 셋만** `requireMediaUpload: isSlackPreserved(issue)`를 넘긴다(Slack 승격 시 미디어 업로드가 실패하면 등록 전 중단하는 **데이터 보호 가드**이고, POSTMORTEM "GitHub 승격 원본 소실"의 직계 방어선이다). 입력에 없으면 통합하는 순간 **무음으로 사라져 사용자 데이터가 유실된다.** 기본 false로 두고 호출처가 결정한다.
  - **⚠ `src/sidepanel/tabs/__tests__/jiraSubmitSymmetry.test.ts`를 함께 옮긴다 (2026-08-14).** 이 테스트(v1.7.22 신설)는 `IssueCreateModal.tsx`·`DraftDetailDialog.tsx` **소스 원문**에서 `submitToJira({`·`setLastSubmitFields("jira", {` 리터럴을 찾아(`:34` `toBeGreaterThan(-1)`) 5키 대칭을 단언한다. 어댑터로 옮기면 두 진입점에서 마커가 사라져 **확정 red**다. **지우지 말고** 스캔 대상을 `submitAdapters.ts`로 바꾸고 "어댑터 1곳에 5키가 다 있다"로 축소한다 — 대칭의 *의미*는 어댑터 통합이 구조적으로 보장하므로 단언이 약해져도 무방하다.
- **작업 내용(위치)**: `sidepanel/lib/`에 둔다 — CLAUDE.md "store는 `sidepanel/tabs`를 import하지 않는다" 게이트와 `initialJiraFields` 선례.
- **검증**:
  - [x] **8플랫폼 × 2매핑 인자 테스트** — 순수 함수라 `vi.mock` 없이 직접 호출하고 `toEqual`(정확 일치)로 고정한다. 부분 일치(`toMatchObject`)는 키가 새로 끼는 방향을 못 잡는다
  - [x] 어댑터에 `markSubmitted`·`onSubmitted`·`reset`·`clearPicker` 참조 0건 (주석 1회 언급뿐)
  - [x] `grep -rn "requireMediaUpload" src/sidepanel/` 결과에 github·notion·gitlab 3경로가 **그대로 남아 있다** — 이제 타입으로도 강제된다(`MediaGuard`를 그 셋의 입력 타입에만 믹스인해, 4번째 플랫폼이 물려받으면 컴파일 에러)
  - [x] `pnpm test src/sidepanel/tabs/__tests__/jiraSubmitSymmetry.test.ts` green (스캔 대상 교체 후)
  - [x] `pnpm test` green
  - [x] **그물 비공허성을 뮤테이션으로 확인** — 화이트리스트를 `(f) => ({...f})`로 접기 / `requireMediaUpload` pass-through를 상수로 바꾸기 둘 다 red. **처음엔 둘 다 green이었다**: fixture 키 집합이 출력과 정확히 같으면 화이트리스트 검증이 항등식이 되고, `toEqual`은 값이 `undefined`인 키를 무시한다. fixture에 화이트리스트 밖 키를 심어 고쳤다

#### Task 3-2: `IssueCreateModal` 8핸들러 치환
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx` (:158-531)
- **작업 내용**: 각 핸들러가 어댑터 호출 + `if (currentIssueId) markSubmitted(...)` + `onSubmitted({...})`만 남긴다.
- **검증**:
  - [x] `onSubmitted` 호출이 8핸들러 전부에 남아 있다
  - [x] `markSubmitted`의 `currentIssueId` 가드가 유지된다 — **slack만 `markSlackShared`**(문서가 DDD에만 적었는데 ICM도 같다)
  - [x] `pnpm typecheck` green

#### Task 3-3: `DraftDetailDialog` 8핸들러 치환
- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx` (:403-820)
- **작업 내용**: 각 핸들러가 `resolveInlineImagesForSections(...)` + 어댑터 호출 + `markSubmitted(issue.id, ...)`(무조건) + `useEditorStore` 확인 후 `clearPicker`/`reset`만 남긴다. **POSTMORTEM 주석은 jira 단독이 아니라 asana(`:725`)·clickup(`:775`)에도 있다 — 셋 다 유실하지 않는다.**
  - **⚠ `markSubmitted`는 8핸들러가 아니라 7이다(2026-08-14 정정).** **slack은 `markSlackShared`**(`DraftDetailDialog:803-838` → `issues-store.ts:377`)로 blob을 지우지 않고 `slackPreserved: true`를 남긴다. 뭉개면 Slack 공유 후 원본 blob이 조기 삭제된다.
- **검증**:
  - [x] `markSubmitted`가 **무조건** 호출된다(create 쪽의 조건부가 유입되지 않았다) — **단 slack 경로는 `markSlackShared`이며 치환 대상이 아니다**
  - [x] `clearPicker`/`reset` 블록이 8핸들러 전부에 남아 있다
  - [x] POSTMORTEM 주석 존재 — jira뿐 아니라 linear·asana·clickup까지 **4건 전부** 보존
  - [x] `pnpm typecheck` + `pnpm test` green
  - [ ] **수동 (범위 축소 — 2026-08-14)**: 순수 매핑이라 호출 시점·순서가 안 바뀌고 인자 값은 8플랫폼 `toEqual`이 고정하므로, 원안 6회 대신 **배선만 2회** 본다 — ① 승격 경로 1회(gitlab 또는 notion. e2e가 github 승격만 태운다) ② jira 재제출 1회(siteId sticky + projectKey 계정 fallback)

---

### G6. 타입 경계 (🟡54·55·57·58·59 + ⚪111·112)

> import 반경이 104개 파일. 커밋을 5개로 쪼갠다.
> **⚪106은 무효**라 G6에서 빠졌다(아래 Task 6-1).

#### ~~Task 6-1: `useT` 분리 (🟡54)~~ — **배치에서 제외 (2026-08-14)**

> **`docs/POSTMORTEM.md` 2026-08-11(`:173`)에 이미 기록된 함정으로 직행한다.** `vite.log-viewer.config.ts:10`이 `"@/i18n"` → `src/log-viewer/i18n.ts`로 alias하는데 **vite 문자열 alias는 prefix 매칭**이라, `@/i18n/useT`는 `.../log-viewer/i18n.ts/useT`로 재작성된다. log-viewer는 `NetworkLogContent`·`ConsoleLogContent`·`ActionLogContent`를 재사용하고 셋 다 `import { useT } from "@/i18n"`를 쓰므로, 별도 빌드가 깨지거나 실물 store 모듈이 log-viewer 번들에 유입된다.
>
> **`pnpm typecheck`·`pnpm test`는 전부 green으로 통과한다** — `pnpm build:log-viewer`만 깨지는데 이전 판의 6-1 검증 체크리스트엔 그게 **없었다**(6-2에만 있다). design.md도 "이 배치는 i18n 키를 추가·리네임하지 않으므로 복제 사전은 무관"이라며 이 위험을 명시적으로 기각했는데, **위험 축이 사전 내용이 아니라 모듈 해석 경로**라 그 기각이 빗나갔다.
>
> 항목 54(`index.ts:4`의 store 값 import → 순환)의 이득이 이 위험을 정당화하지 못한다. **다시 볼 조건**: log-viewer가 `@/i18n` alias를 쓰지 않게 되거나, alias가 정확 매칭으로 바뀌면. 그때는 아래 원안을 쓰되 검증에 `pnpm build:log-viewer`를 반드시 넣는다.

<details>
<summary>원안 (보류)</summary>

- **변경 대상**: `src/i18n/index.ts`(:4·**:66-70**) + **신규** `src/i18n/useT.ts` + `useT` 사용처
- **추가 주의(보류 해제 시)**: `currentLocale`은 `index.ts:10`의 **비-export 모듈 스코프 `let`**이고 `useT`가 직접 대입한다(`:68`). 분리하면 대입이 불가능해 `setLocale()` 경유로 바꿔야 하고, 그 순간 `withLocale` 구간 중 렌더가 끼면 임시 로케일이 영구화될 수 있다.
- **작업 내용**: `useT`를 `src/i18n/useT.ts`로 옮긴다(스토어 값 import는 이쪽만). `index.ts`는 `t`·`setLocale`·`getLocale`·`dateBcp47`만 남기고 **`@/store/settings-ui-store` 값 import를 제거**한다(`LocaleMode`는 이제 `@/i18n/locales`가 정의하므로 store에서 가져올 이유 자체가 없다 — `./locales`에서 `import type`). **이 분리가 성립시키는 것**: `settings-ui-store.ts:9`가 `@/i18n/locales`를 값으로 import하고 같은 파일 `:12-13`이 "방향은 store → i18n 단방향"이라 선언해뒀는데, `index.ts:4`의 값 import가 그걸 깨고 있다. 즉 이 태스크는 번들 감량이자 **선언된 불변식 복구**다.
- **`src/i18n/locales.ts`는 건드리지 않는다** — 의존성 0을 `src/i18n/__tests__/locale-registry.test.ts`가 소스 스캔으로 강제한다(log-viewer 별도 번들이 상대경로로 직접 끌어간다). 공용 심볼을 그쪽으로 옮기는 해법은 즉시 red.
- **⚪106 `getLocale` 삭제는 무효 — 하지 않는다.** 리베이스 후 프로덕션 사용처가 생겼다: `src/sidepanel/tabs/issueListUtils.ts:176`의 `dateMonthStyle(getLocale())`(로케일별 월 표기).
- **선행/후행 순서**: `docs/features/french-locale/` Task 4가 같은 `src/i18n/index.ts`를 원자 커밋으로 고친다. 동시 진행 금지(design.md 위험 요소).
- **검증**:
  - [ ] `grep -n "settings-ui-store" src/i18n/index.ts` 결과 0줄
  - [ ] `grep -rn "getLocale" src/ e2e/ scripts/`에 `issueListUtils.ts:176`이 그대로 있다(삭제하지 않았다는 증거)
  - [ ] `pnpm typecheck` + `pnpm test` green — `locale-registry.test.ts` 포함
  - [ ] **`pnpm build:log-viewer` 통과** ← 이 항목이 원안에 없어서 alias 함정을 못 걸렀다. 보류 해제 시 필수.
  - [ ] `pnpm build` 후 `pnpm check:prearm` 통과

</details>

#### Task 6-2: `bg-client.ts` 분리 (🟡57)
- **변경 대상**: **신규** `src/lib/bg-client.ts` + `__tests__/bg-client.test.ts`, `src/types/messages.ts`(:255-326), `"@/types/messages"` import 파일들 — **반경은 104개가 아니라 90개**(테스트 제외 87). `src/content/`에서 값 import는 **`css-source-cache.ts:15`(`sendBg`) 하나뿐**이고 변경 대상에 명시한다
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
- **작업 내용 (2026-08-14 축소): 쪼개기를 포기하고 ⚪111만 한다.** 인라인 `import("@/types/network")`·`import("@/types/console")`·`import("@/types/action")` **3곳(`picker.ts:143`·`:148`·`:154`)을 상단 `import type`으로** 올리는 것까지.
  - **왜 쪼개지 않나**: 원안은 "`ContentMessage` 합집합을 유지해 기존 사용처를 안 건드린다"고 했는데 **`ContentMessage`는 코드에 존재하지 않는다**(grep 0건). 지금은 `PickerMessage`가 곧 전체 합집합이라, 그걸 `picker.*`로 좁히는 순간 `recorder-bridge.ts:152`·`recorder-control.ts:5`·`annotation-control.ts:8`·`usePickerMessages.ts:297·321·344` 등 recorder·annotation 수신부가 전부 깨진다. typecheck가 잡아주긴 하나 기계적 치환 ~40곳이 붙고, 항목 59의 실이득이 그 diff를 정당화하지 못한다.
  - 정직하게 하려면 "`ContentMessage`를 **신설**하고 사용처 ~40곳을 치환한다"로 써야 한다. 그건 별건으로 미룬다.
- **검증**:
  - [ ] 기존 `PickerMessage` 사용처가 **전부 무변경**(쪼개지 않았으므로 diff 0이어야 한다)
  - [ ] `pnpm typecheck` green
  - [ ] `pnpm build` 후 `pnpm check:prearm` 통과 (**content script가 새 import를 타지 않는지** — 이 태스크의 최대 위험)

#### Task 6-5: `extractPath` 제거 + coverage 근거 갱신 (🟡55·58)
- **변경 대상**: `src/sidepanel/lib/buildLogSummary.ts:122` · `scripts/coverage-report.mjs:66`
- **작업 내용**: `extractPath`(`buildLogSummary.ts:132`) 삭제, 호출처를 `@/lib/network-log-path`의 `networkLogPath`로. **⚠ 외부 호출처가 하나 더 있다(2026-08-14): `src/sidepanel/lib/prompts/logCandidates.ts:5,151`.** 변경 대상에 없어서 그대로 두면 아래 `grep 0건` 검증을 못 넘는다. 테스트는 `logCandidates.test.ts:179`. `networkLogPath`에만 있는 `if (!url) return url` 가드는 **유지**(둘 다 `""`를 반환하므로 실동작 동일). `isBrowserBound()`의 `src/types/` 제외 근거 주석(`coverage-report.mjs` **`:72`** — `:66` 아님)을 사실에 맞게 갱신하고, `src/types/platform.ts`의 런타임 상수 3개(`PLATFORM_TAB_KEYS`·`CC_PREFIX`·`CC_SEPARATOR`)를 **의도적 예외로 명시**한다.
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
- **작업 내용 (2026-08-14 정정 — prop이 1개가 아니라 2개다)**: `FieldRow`에 `htmlFor?: string`(입력 연결 **10곳** 커버)과 **`labelAction?: ReactNode`**를 추가한다. 34곳 중 **7곳은 라벨이 `flex items-center justify-between` 안에서 "토큰 발급" `<a>`와 나란히** 있어 `FieldRow`의 label→children 세로 구조로 표현할 수 없다. 또 **원본 34곳은 전부 `flex flex-col gap-1.5`인데 `FieldRow`는 `grid gap-1.5`**라 컨테이너 클래스가 바뀐다 — 명시적 수용 사항으로 적거나 해당 7곳을 대상에서 제외한다. "새 추상화 0 / prop 1개"는 성립하지 않는다.
  - 감사의 "27회"는 실측 34회(asana 4·clickup 5·github 4·gitlab 5·jira 7·linear 5·notion 3·slack 1).
- **검증**:
  - [ ] `grep -c '<label' src/sidepanel/tabs/connect/*ConnectForm.tsx` 합계 0
  - [ ] `htmlFor`가 있던 **10곳**이 여전히 입력과 연결됨(렌더 테스트 또는 수동 라벨 클릭 → 포커스 이동)
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

### Task 9-2: 미참조 export **재분류** (⚪107·108·110·109)

> **⚠ 2026-08-14 전면 재작성.** 이전 판은 16개 심볼을 "삭제" 대상으로 나열하고 규칙을 "`grep` 0건일 때만 삭제"로 뒀는데, **실측 결과 순수 데드는 4개뿐이고 나머지는 전부 내부·테스트 참조를 갖는다.** 즉 규칙을 성실히 지키면 **한 건도 안 지워지고 태스크가 통째로 빈 PR이 된다** — 문서가 자기모순이었다. 세 갈래로 나눈다.

**(a) 순수 삭제 — 참조 0**
- `src/store/blob-db.ts:458` `deleteInlineImages` · `:470` `getInlineImageKeys`
- `src/store/editor-store.ts`의 `IssueStatus`·`IssueTokenSnapshot` 계열(착수 시 재확인)

**(b) `export` 키워드만 제거 — 파일 내부에서 쓰인다** (→ 성격상 Task 9-3과 같다)
- `src/store/blob-db.ts:551` · `src/lib/pending-log-prune.ts:66`(`pruneOrphanPendingLogs` — 같은 파일 `:97`이 호출) · `src/store/issues-store.ts:133`·`:161` · `src/store/settings-store.ts:27` · `src/lib/url-support.ts:37` · `src/lib/log-colors.ts:7` · `src/store/editor-store.ts`의 `SubmitResult`·`EditorTarget`·`ShotSelector`·`ReplayTrim`(내부 15참조)

**(c) 유지 + 주석 — 테스트·e2e 계약이 참조한다** (⚪98과 같은 취급)
- `blob-db.ts:483` `clearInlineImages`(`blob-db-inline-origins.test.ts`가 호출) · `getInlineOriginKeys`(동일) · `src/lib/loopback-host.ts:7` `isLoopbackHost`(테스트 12참조) · `issues-store.ts:260` `ISSUES_STORE_VERSION` · `settings-store` `SETTINGS_STORE_VERSION`(둘 다 `e2e/GOTCHAS.md`가 계약으로 문서화) · `TabSupport` · `LogTone`
- **`blob-db.ts:497`의 "`clearInlineImages`는 호출처 0(dead)" 주석은 지금 거짓이다** — 테스트가 부른다. 주석을 정정한다.

**앵커 정정**: `src/types/platform.ts:73`은 **v1.7.23이 넣은 살아있는 `sprintName?: string`**이다. 의도한 미참조 타입 4종은 `:78`·`:100`·`:119`·`:129`이고 **넷 다 `:159~163`에서 내부 참조**되므로 (b)에 속한다. `:20`의 런타임 상수 3개는 그대로 유지(design.md 판정표).

- **검증**:
  - [ ] (a)는 삭제 전 `grep -rn "<심볼>" src/ e2e/ scripts/` **0건 기록**
  - [ ] (b)는 `export` 제거 후 `pnpm typecheck` green — 외부 참조가 있었으면 여기서 red
  - [ ] (c)는 코드 변경 0, 주석만
  - [ ] `pnpm typecheck` + `pnpm test` green
  - [ ] `pnpm build` + `pnpm build:log-viewer` 통과 (별도 그래프 확인)

### Task 9-3: 파일 내부 전용 export의 `export` 제거 (⚪102·98)
- **변경 대상**: `src/sidepanel/picker-control.ts:459` · ~~`src/sidepanel/tabs/issueListUtils.ts:161`~~(아래 참조) · `src/sidepanel/30s-replay/frame-buffer.ts:6` · `src/sidepanel/lib/markdown-logs-link.ts:5` · `src/sidepanel/lib/renderLogRefs.ts:17` · `src/sidepanel/lib/buildAiStylingPrompt.ts:37` · `src/sidepanel/tabs/statusBadges/GithubStatusBadge.tsx:18` · `src/content/element-locator.ts:166`
- **작업 내용**: 외부 참조 0 확인 후 `export` 키워드만 제거(코드 이동 없음). **`element-locator.ts:166`은 테스트 전용 export라 삭제하면 테스트가 깨진다 — `// 테스트 전용 export` 주석만 붙인다.**
- **`issueListUtils.ts`는 대상에서 뺀다(리베이스 재확인 결과).** 감사가 지목한 `:161`은 `dateLabel`이었고 지금은 `:173`으로 밀렸는데, 로케일 인프라 공사로 `src/sidepanel/tabs/__tests__/issueListUtils.test.ts`가 이걸 직접 import해 단언한다(ko/en 날짜 표기 회귀). 같은 공사로 생긴 형제 `dateMonthStyle`(`:169`)도 테스트 전용 export다. **둘 다 ⚪98과 같은 취급 — `export`를 떼지 말고 `// 테스트 전용 export` 주석만 붙인다.**
- **검증**:
  - [ ] 심볼마다 `grep -rn "<심볼>" src/ e2e/` 결과가 자기 파일(+ `element-locator`·`dateLabel`·`dateMonthStyle`은 테스트)뿐
  - [ ] `pnpm typecheck` + `pnpm test` green

### Task 9-4: 중복 헬퍼 2건 (⚪100·101·94)
- **변경 대상**: `src/sidepanel/annotation-control.ts:8` ↔ `src/sidepanel/recorder-control.ts:5`(`send()`) · `src/sidepanel/lib/video-thumbnail.ts:8` ↔ `src/sidepanel/30s-replay/encode-range.ts:75`(`withTimeout`) · `src/background/notion-api.ts:291`(`dataUrlToBlob` 로컬 사본)
- **작업 내용 (2026-08-14 정정 — 둘 다 "동일"이 아니다)**:
  - **`withTimeout`은 시그니처가 다르다** — `encode-range.ts:75`는 `(p, timeoutMs, label)` **3인자**, `video-thumbnail.ts:8`은 `(p, label)` **2인자 + 모듈 상수 `LOAD_TIMEOUT_MS`**. 3인자로 통일하고 **video-thumbnail 호출 2곳을 함께 고친다.** 또 둘 다 `window.setTimeout`을 쓰므로 "순수 함수"가 아니다 — `src/lib/` 승격은 가능하되 근거를 "순수"로 적지 않는다.
  - **`dataUrlToBlob`은 동치가 아니다** — notion판(`notion-api.ts:291`)은 `{blob, contentType}`를 반환하고 percent-encoding을 지원하는데, blob-db판(`:728-739`)은 `Blob`만 반환하고 base64 전용이다. **Task 1-4가 `imageExtFromDataUrl`에 요구한 "도달 불가 증명 또는 스킵"과 같은 게이트를 여기에도 건다.**
  - **커버리지 분모 주의**: `annotation-control.ts`·`recorder-control.ts`·`video-thumbnail.ts`·`encode-range.ts` 넷 다 현재 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 있어 로직 스코프 밖이다. `src/lib/`·`src/sidepanel/lib/`로 옮기면 분모에 편입되므로 `send()`에도 테스트를 붙인다.
- **검증**:
  - [ ] `grep -c "function withTimeout\|const withTimeout" src/` = 1, `send` / `dataUrlToBlob`도 각 1
  - [ ] `withTimeout` 단위 테스트 추가(타임아웃 / 정상 resolve / reject)
  - [ ] `pnpm typecheck` + `pnpm test` green

### Task 9-5: 주석·별칭·미세 정리 (⚪68·93·95·96·97·103·104·105·114)
- **변경 대상**: `src/content/overlay.ts:678`(swatch 불변식 주석 추가) · `src/background/github-upload.ts:39`(`created` 항상 true) · `src/background/github-oauth.ts:20`(1회용 wrapper 군집) · `src/content/css-source-cache.ts:624`(WHAT 재진술 영어 주석 5건) · `src/content/network-recorder.ts:12`(재진술 주석 — `:9`는 빈 줄) · `src/sidepanel/components/AnnotationOverlay.tsx:231`(재진술 주석) · `src/sidepanel/lib/trailing-throttle.ts:17`(이중 단언) · `src/sidepanel/lib/buildEditorCapture.ts`(same-dir alias **9건**, `:5-16`) · ⚪114 배치·명명 8곳
- **작업 내용**: **감사 리포트 기재 — 착수 시 각 라인 재확인.** 리포트와 다르면 스킵 + 사유. `css-source-cache.ts`·`network-recorder.ts`는 **회고 1위 영역 / pre-arm 청크**라(단 `css-source-cache.ts`는 pre-arm 청크가 **아니라 picker 그래프**다 — 2026-08-14 정정. 주의 수준은 그대로 유지) 주석만 건드리고 코드는 손대지 않는다.
- **⚪114의 `src/lib/external-url.ts`는 미변경이다.** 리베이스로 바뀐 건 이름이 비슷한 **`src/lib/external-links.ts`**(로케일별 가이드 URL — `USER_GUIDE_URLS`·`userGuideUrl`이 `@/i18n/locales`의 `LocaleTable`을 쓴다)이고, ⚪114 대상이 아니다. 두 파일을 혼동하지 말 것.
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
