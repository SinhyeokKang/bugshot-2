# 드랍한 기획 (Dropped specs)

기획까지 갔다가 **안 하기로 한** 것들의 사유 기록. 문서를 그냥 지우면 몇 달 뒤 같은 아이디어가 같은 근거로 다시 기획되고, 그때 이미 한 번 계산한 비용을 다시 계산하게 된다. 이 파일은 그 재계산을 막는 용도다.

각 항목은 **왜 안 하는지**와 **무엇이 바뀌면 다시 볼 만한지**를 적는다. "지금은 안 한다"와 "영원히 안 한다"는 다르므로 구분해서 쓴다.

---

## 2026-08-19 — audit-refactor-7이 **의도적으로 안 하고 남긴 것 6건**

배치는 P0·P1·P2 세 묶음으로 전부 dev에 들어갔다. 여기 남기는 건 착수 전 검수(`/feature-review`)나 배치 중 판정으로 **안 하기로 한 것들**이다.

**① #21 `DomTreeDialog` raw button → shadcn `Button`** — 이행하면 손해다.
근거로 든 "DESIGN §10 등재 예외 4계열"이 그때 **문서에 없었다**(실제 2계열). 교체하면 `Button variant="ghost"`의 base cva `inline-flex h-9 px-4`가 원본 `block w-full truncate text-2xl`과 충돌해 행 높이 +4px, 텍스트 폭 −32px, hover가 `opacity-70` 전이 대신 면색 블록이 되고, 무엇보다 **`truncate`가 파손된다**(익명 flex item이 되어 하드 클립). e2e는 testid만 잡아 이 회귀를 아무 테스트도 못 잡는다.
**항목 자체가 소멸했다** — Task 11-5가 DESIGN.md에 "raw `<button>` 예외" 표를 만들고 이 계열(sticky 헤더의 클릭 가능한 제목)을 등재했다. 다시 볼 조건 없음.

**② #28 `SingleLazyCombobox` 미채택 6파일 수렴** — 동치 통합이 아니다.
`DESIGN.md:270`이 이 파일들을 "로드 모델이 달라 의도적으로 밖에 있다"고 이미 등재해 뒀고, 이행은 동작 변경 다발이다: `shouldFilter={false}`+수동 `includes()`가 매치 집합·순서를 바꾸고, `tabs/ProjectCombobox`는 `JiraAccount`에 `projectName`이 없어 트리거가 `"Name (KEY)"` → **`"KEY"`로 퇴화**하며, linear `LabelCombobox`는 로드 목록 우선 라벨이 저장 이름 고정으로 퇴화한다. 대상 6파일 테스트 0·e2e 0.
**다시 볼 조건**: 아래 ⑤(`query` 리셋 부재)가 먼저 고쳐진 뒤. 그 컴포넌트가 아직 결함을 들고 있는 채로 소비처를 늘리는 건 순서가 거꾸로다.

**③ #29 원격 검색 3벌 → `useDebouncedSearch`** — 실측이 문서와 다르다.
디바운스가 문서엔 "300ms 3벌"인데 실측 **250/250/300ms**이고, 3파일은 `setLoading(true)`를 타이머 **안**에서 부르는데 훅은 타이머 **앞**(leading edge)에서 부른다 → 이행하면 키 입력마다 목록이 스피너로 교체돼 400px 패널에서 깜빡인다. 훅엔 `if (!open) return` 게이트도 `items` reset도 없다(`JiraIssueFields.tsx:215`가 `key` remount로 우회 중).
**다시 볼 조건**: 훅이 `open` 게이트·`items` reset·loading 타이밍 옵션을 갖게 되면.

**④ #26 배지 셸 7벌 추출 · #27 PatDialog 6벌 추출** — 추출 대상이 아직 안 정해졌다.
둘 다 "N벌이 있다"는 것까지만 확인됐고 무엇을 공통 셸로 뽑을지는 미정이다. 이 배치가 `imageCell`·`escapeHtml`·`MarkdownIt`에서 배운 대로, **공통 부분이 무엇인지 정하지 않은 채 추출하면 사본이 하나 더 는다**(P1에서 `picker-clear`의 `sendToTabAllFrames`이 `sendToTabAllFrames`의 다섯 번째 사본이 될 뻔했다).
**다시 볼 조건**: 배지·PatDialog를 다른 이유로 손대며 공통 셸의 경계가 드러날 때.

**⑤ #34의 `src/sidepanel/**` 전역 import 표기 통일** — 규모가 다르다.
이 배치는 이탈 **10건**(background 7 · types 3)만 고치고 신규 유입 그물(`src/lib/__tests__/import-convention.test.ts`)을 깔았다. `sidepanel`은 445건 혼용이라 스캔 대상에서 뺐다 — 예외 목록을 박으면 그물이 아니라 장부가 된다.
**다시 볼 조건**: sidepanel을 한 번에 치환할 의지가 있을 때. 부분 치환은 혼용을 유지하면서 diff만 키운다.

**⑥ `BgResponseMap` 도입** — 국소 처리로 갈음했다.
#4(업로드 응답 판별자)를 근본적으로 고치려면 `BgRequest["type"]` → 응답 타입 map으로 `sendBg`가 추론하게 해야 한다. 이번엔 판별자 union + 양단 명시 + 목 갱신으로 국소 처리했다. `handleMessage`가 `Promise<unknown>`이고 `sendBg<T>`가 호출자 단언인 구조는 그대로 남는다.
**다시 볼 조건**: 응답 shape 불일치가 또 나올 때. 그때는 map이 국소 수정보다 싸다.

### 다음 배치 후보 3건 (검수가 발굴, 이번 배치 밖)

- **`SingleLazyCombobox`의 `query` 리셋 부재** — `query`를 컴포넌트 state로 들고 `shouldFilter={false}` + 수동 필터를 돌리는데 `setQuery("")` 리셋이 어디에도 없다. 컴포넌트가 팝오버와 수명이 달라 살아남으므로 **재오픈 시 입력창은 비어 보이는데 목록은 stale query로 필터된 채**다. 이미 11파일이 쓴다. 위 ②의 선행 조건.
- **`send`/`sendToTabAllFrames`의 포트 닫힘 ↔ 의도적 `undefined` 미구별** — 둘 다 `catch { return undefined }`로 `lastError`를 지운다. P0가 `scrollCaptureTo` 한 경로에 shape 가드를 넣었지만 구조 자체는 남았다.
- **seq-guard 4·5번째 사본** — `useLazyListOnOpen.ts:18`·`NotionConnectForm.tsx:74`가 같은 `reqIdRef` 패턴이다.

### 이 배치가 얻은 판별 기준

**"지배 패턴이 저장소에 있다"만으로 수렴을 정당화하지 않는다** — 대상이 그 패턴의 전제(로드 모델·variant·타이포그래피)를 공유하는지까지 본다. ②·③·①이 전부 이 기준에서 걸렀고, 셋 다 "N벌 중복"이라는 표면은 참이었다.

**설계 문서의 전제는 착수 전에 grep으로 확인한다** — 이 배치의 design.md에서만 네 번 틀렸다(`loadPromise === p`가 래퍼를 놓침 / runner가 두 레인을 구별할 신호가 있다 / `persistOAuthTokens`가 양쪽에서 불린다 / DESIGN에 예외 4계열이 등재돼 있다). 호출부 개수·필드 유무는 5초짜리 grep이고 문서는 그걸 대신해주지 않는다.

---

## 2026-08-16 — audit-refactor-6이 **의도적으로 안 하고 남긴 것 6건**

배치 자체는 8그룹 전부 dev에 들어갔고 기획 문서는 삭제했다. 여기 남기는 건 그 안에서 **착수했다가/계획에 있었다가 안 하기로 판정한 것들**이다 — 전부 사유가 실측이라, 안 적어두면 다음에 같은 계산을 다시 한다.

**① `useT`를 `src/i18n/index.ts`에서 분리 (항목 🟡54)** — 착수 직전 제외.
`index.ts:4`가 store를 값으로 import해 `settings-ui-store`가 선언한 "store → i18n 단방향"을 깨고 있고, 떼면 번들도 준다. 그런데 `vite.log-viewer.config.ts:10`이 `"@/i18n"` → `src/log-viewer/i18n.ts`로 alias하는데 **vite 문자열 alias는 prefix 매칭**이라 `@/i18n/useT`가 `.../log-viewer/i18n.ts/useT`로 재작성된다. log-viewer는 `NetworkLogContent`·`ConsoleLogContent`·`ActionLogContent`를 재사용하고 셋 다 `import { useT } from "@/i18n"`를 쓴다. **`pnpm typecheck`·`pnpm test`는 전부 green이고 `pnpm build:log-viewer`만 깨진다** — 원안 검증 체크리스트에 그게 없어서 못 걸렀다(POSTMORTEM 2026-08-11이 같은 함정의 선례).
파생 함정 하나 더: `currentLocale`은 `index.ts:10`의 비-export 모듈 스코프 `let`이고 `useT`가 직접 대입한다. 분리하면 `setLocale()` 경유로 바꿔야 하고, 그 순간 `withLocale` 구간 중 렌더가 끼면 임시 로케일이 영구화될 수 있다.
**다시 볼 조건**: log-viewer가 `@/i18n` alias를 안 쓰게 되거나 alias가 정확 매칭으로 바뀌면. 그때도 검증에 `pnpm build:log-viewer`를 반드시 넣는다.
**2026-08-19 재소환**: audit-refactor-7 전체 재감사에서 같은 항목이 다시 나왔다. 다시 볼 조건은 여전히 미충족. (ar-7 #59 — `useT()`의 렌더 중 전역 write 축으로 다시 걸렸다. 조건에 붙은 **`pnpm build:log-viewer` 필수** 조항도 함께 살아 있다.)

**② `ContentMessage` 신설 + `PickerMessage` 쪼개기 (항목 🟡59)** — 전제가 거짓이라 축소.
원안은 "`ContentMessage` 합집합을 유지해 기존 사용처를 안 건드린다"였는데 **`ContentMessage`는 코드에 없다**(grep 0). 지금은 `PickerMessage`가 곧 전체 합집합이라, 그걸 `picker.*`로 좁히는 순간 recorder·annotation 수신부가 전부 깨진다 — typecheck가 잡아주긴 하나 기계적 치환 ~40곳이 붙는다. 배치에선 인라인 `import("@/types/network")` 3곳을 상단 `import type`으로 올리는 것만 했다.
**다시 볼 조건**: content 메시지 union이 더 커져 `PickerMessage` 하나로는 수신부에서 분기가 안 읽힐 때. 그땐 "`ContentMessage`를 신설하고 사용처 ~40곳을 치환한다"로 정직하게 쓴다.

**③ `ConnectButton` 추출 (G4 잔여)** — 사정거리가 이름값보다 좁다.
연결 버튼 마크업(`relative w-full justify-center gap-2 aria-disabled:cursor-not-allowed` + absolute 스피너 + `opacity-0` 스왑)이 `PlatformConnectFlow`·`JiraConnectForm`·`SlackConnectForm` **3벌 바이트 동일**이다. 그런데 `JiraConnectForm.tsx:401`(토큰 검증 버튼)이 같은 골격을 다른 모양으로 또 쓰고, Slack은 술어가 다르다(`disabled={connected || !oauthAvailable}` + 인라인 클릭 가드). **connect 전용 추출은 4벌 중 3만 걷고 패턴 중복은 남긴다.**
**다시 볼 조건**: 스피너 오버레이 셸을 일반화할 때 — 그때 4벌을 한 번에 걷는다. 버튼 스타일을 바꿔야 할 일이 생기면 그게 신호다(지금은 3벌이 갈려도 브라우저 없이 아무도 못 잡는다).

**④ `dataUrlToBlob` 통합 (항목 ⚪94)** — 동치가 아니다.
`background/notion-api.ts:292`판은 percent-encoding 페이로드를 처리하고 `{blob, contentType}`을 반환하는데, `store/blob-db.ts:728`판은 정규식이 `/^data:(.*?);base64,(.+)$/`로 base64 전용이고 `Blob`만 반환한다. 통합하면 한쪽 파싱을 넓히거나(동작 변경) 좁혀야(회귀) 하고, notion 경로에 percent-encoded가 도달 불가하다는 걸 증명할 수 없다.
**다시 볼 조건**: notion 첨부 경로의 입력이 base64로 좁혀졌음을 실측할 수 있을 때. (같은 형태의 선례: `submitToSlack.ts:toUploadEntry`도 `contentType` 차이 때문에 통합 안 하고 사유 주석만 남겼다.)
**2026-08-19 재소환**: audit-refactor-7 전체 재감사에서 같은 항목이 다시 나왔다. 다시 볼 조건은 여전히 미충족. (ar-7 #24. 그 감사 리포트가 **"3벌"이라 했지만 실제 정의는 2벌**이다 — `store/blob-db.ts`·`background/notion-api.ts`. 위 본문이 처음부터 2벌로 적었으니 이름이 아니라 본문으로 세라는 POSTMORTEM 2026-07-16을 리포트 쪽이 밟은 것이다.)

**⑤ `confirmDraft` 150줄 목표 (G7)** — 목표치가 자기 설계와 모순이다.
실측 276 → 246줄로 줄었고 남은 246줄의 출처는 중복이 아니라 jira sticky 복원 33줄 + element 레코드 리터럴 ~75줄 + element 영속 IIFE ~35줄이다. 150에 닿으려면 분기별 함수 분리가 필요한데 **그건 같은 기획의 design.md 대안 D가 명시적으로 기각한 방향**이고, 그 문단이 "함수 길이는 부작용이지 이 항목의 문제가 아니다"라고 못박았다.
**다시 볼 조건**: 길이를 정말 줄여야 하면 jira sticky 블록 추출을 별도 항목으로 뗀다 — 그건 중복 제거이지 분기 분리가 아니라 대안 D에 안 걸린다.

**⑥ `github-upload.ts`의 항상-true `created`·`github-oauth.ts`의 1회용 wrapper 군집 (항목 ⚪95·96)** — ⚪ 이득 vs 실탭 회귀 비용.
`ensureGithubTab`은 반환 타입이 `{tabId, created: boolean}`인데 `created: true` 하나뿐이고, 호출부 `:170`이 정리 조건으로 쓴다. 그런데 그 파일은 `chrome.scripting.executeScript({func})` 주입 대상이라 CLAUDE.md가 **리팩터 시 실제 탭 회귀를 필수로** 요구한다. `github-oauth.ts`의 wrapper 4개(`assertConfigured`·`redirectUri`·`proxyTokenUrl`·`proxyRefreshUrl`)도 OAuth 경로다.
**다시 볼 조건**: 같은 파일을 다른 이유로 손대며 실탭 회귀를 어차피 돌릴 때 곁들인다.
**2026-08-19 재소환**: audit-refactor-7 전체 재감사에서 같은 항목이 다시 나왔다. 다시 볼 조건은 여전히 미충족. (ar-7 #31. ar-7 G5가 `github-upload.ts`의 **함수 반환 타입**을 판별자 union으로 바꿨지만 `executeScript({func: pageBatchUploadFn})` 주입부는 안 건드렸고 실탭 회귀도 안 돌렸다 — 조건 미충족.)

---

## 2026-08-16 — audit-refactor-5가 **의도적으로 안 하고 남긴 것 6건**

배치는 v1.7.24(`7c5e1cfa`)로 머지됐고 기획 문서는 삭제했다. 아래는 그 안에서 **하지 않기로 판정한 것들**이다. 전부 "지금은 안 한다"이고 "영원히"는 없다.

**① i18n 네임스페이스 재편 (⚪87)** — 898개 키의 prefix 재구성은 전 파일 리네임 + ko/en 동시 갱신 + log-viewer 복제 사전 동기를 부르는 대공사인데 얻는 게 정연함뿐이다. 배치에선 측정치만 기록하고 실제 버그인 조각(dead key·열린 집합)만 고쳤다.
**다시 볼 조건**: 네임스페이스 혼선이 실제 키 충돌·오배치를 낳을 때. 그 전까진 정연함이 근거가 못 된다.

**② `--ring`을 `--border`에서 분리 (DESIGN §9 "개선 후보")** — 토큰 값 변경이라 `tokens.test.ts` 3표 동기 + 전 화면 시각 회귀가 붙는다. 이 배치의 국소 수정 성격과 규모가 다르다.
**다시 볼 조건**: 포커스 링이 테두리와 구별 안 돼 접근성 리포트가 올 때.

**③ `t()`를 async·lazy·plural 지원으로 확장 (🟡32)** — 폴백 한 줄만 추가했다.
**다시 볼 조건**: 복수형이 실제로 어색한 언어를 추가할 때(현재 로케일 집합엔 없다).

**④ overlay 폰트 스택 semantic화 (⚪89)** — Shadow DOM `all: initial`이라 CSS 변수를 못 받는 게 원인이고, DESIGN §2가 이미 "`hsl()` 리터럴로 복제"를 불가피한 사본으로 인정했다. 문서 등재만 했다.
**다시 볼 조건**: Shadow DOM에 변수를 주입하는 경로가 생기면(그 자체가 별건 기획이다).

**⑤ picking 세션 중 `theme` 실시간 반영 (🟡29)** — `picker.start` 시점 스냅샷으로 충분하다. **요소를 고르는 중에 설정 탭으로 가서 테마를 바꾸는 플로우가 제품에 존재하지 않는다**(picker 활성 중 사이드패널은 캡처 화면에 있다).
**다시 볼 조건**: picking 중에도 설정에 닿는 경로가 생기면.

**⑥ `rounded-[4px]`를 `rounded-[3px]`로 통일 (⚪84, 취소)** — 유일 선례인 `ColorSwatch.tsx:28`은 overlay `.pl-swatch`와의 **cross-file 앵커**라, 무관한 표면을 끌어오면 앵커 의미가 희석된다. 대신 DESIGN §6에 4px을 등재했다. **`grep -rn "rounded-\[4px\]" src/`에 2건이 남는 것이 기대값이다**(실측 확인: 3px 1건 · 4px 2건).
**다시 볼 조건**: overlay와 사이드패널의 swatch가 더 이상 시각적으로 짝지어지지 않게 되면.

**해소된 항목 하나** — "`connect/*ConnectForm.tsx`를 `FieldRow`로 이행하지 않는다"(⚪92 관련)는 **audit-refactor-6 G4가 실제로 했다**(34곳 전량, `htmlFor`·`labelAction` 두 prop 추가). DESIGN §13의 "`tabs/connect/`는 아직 안 따른다" 문구는 이 커밋에서 함께 정리했다 — G4 push 때 놓쳤던 stale이다. 여기 남기는 건 "안 한다고 적혀 있던 게 나중에 됐다"는 기록이 다음 독자를 헷갈리게 하지 않도록.

---

## 2026-08-10 — 요소 식별 정보 표시 재설계 (`stable-element-locator`의 절반)

이슈 본문의 재현 환경 `DOM` 행을 selector 쉼표 나열에서 번호 붙은 목록(`Element 1 · [data-e2e="card"] › span`)으로 바꾸고, 각 Style changes 제목을 요소 참조로 연결하며, 전체 selector를 제목에서 빼 별도 행으로 내리려던 절반. **같은 기획의 나머지 절반(selector 생성 알고리즘)은 진행했다** — `src/content/element-locator.ts`로 착지(기획 문서는 구현 완료 후 삭제).

**두 기획이 서로를 호출하지 않았다.** selector 품질이 좋아지는 것과 본문에 그 selector를 어떻게 배치하느냐는 독립이다. 표시 절반만 오늘 해도 되고, 알고리즘 절반만 해도 각자 가치가 성립한다. 묶음 기획 생존율 0/3(`regression-net`·`css-cascade-fidelity`·`picker-aim-ux`)에 넷째가 될 참이었다.

**비용이 근거보다 크다.** 소비처가 본문 빌더 8곳(`buildMarkdownIssueBody`·`buildLinearIssueBody`·`buildSlackBody`·`buildAsanaIssueBody`·`buildClickupIssueBody`·`buildIssueMarkdown`·`buildIssueAdf`·`buildNotionIssueBody`) + DOM 행 생산자 4곳(`environmentRows.ts`·`PreviewPanel`·`DraftDetailDialog`·`buildReportData.ts`) + 공용 렌더러 1곳(`IssuePreviewView`)이고, 골든 스냅샷 `bodyOutputGolden.test.ts.snap`(189KB / 58장)을 일괄 무효화한다. 여기에 `IssuePreviewView`는 log-viewer가 재사용하므로 복제 사전까지 파급된다. 반면 얻는 것은 "복수 요소 이슈가 읽기 쉬워짐"이고 **측정 수단이 없다.**

**근거가 실측이 아니다.** 복수 요소를 한 이슈에 담는 빈도도, "어느 변경 표가 어느 요소인지 모르겠다"는 리포트도 확인된 게 없다. `picker-aim-ux` G4와 `css-cascade-fidelity`를 죽인 것과 같은 축이다.

**검수가 발굴한, 표시 절반과 무관하게 남아 있는 사실 3건** — 묻어두지 않는다.

1. **before/after 업로드 파일명이 0-index인데 사람이 세는 순서와 어긋난다.** `before-${i}.webp`/`after-${i}.webp`(`buildIssueMarkdown.ts:157`)라 요소 3개 이슈의 Jira 첨부 패널·GitHub 업로드 목록에 `before-0`부터 나온다. `submitToAsana.ts:105`가 webp→jpeg로 rename하는 경로도 같은 index를 쓴다.
2. **before/after alt 텍스트가 고정 문구다.** `alt.beforeSnapshot`/`alt.afterSnapshot`(`StyleChangesTable.tsx:128`)이라 요소 3개 이슈를 스크린리더로 읽으면 동일 alt 6개가 연달아 나온다. 요소 번호 없이도 alt에 selector 꼬리를 넣는 국소 수정으로 개선된다.
3. **Style changes 제목의 selector는 400px에서 이미 잘린다.** `Section`의 `h3`가 `min-w-0 truncate`인데 `title` 폴백이 없어(`Section.tsx:86`) 식별에도 복사에도 못 쓰인다. 제목 전체 재설계 없이 `title` 속성만 붙여도 hover로 전문이 보인다.

**다시 볼 조건**: 복수 요소 이슈에서 요소↔변경 표 대응이 안 읽힌다는 **실사용 리포트가 실제로 올 때**. 그때는 표시 모델만 별도 기획으로 쓰면 되고, 위 사실 3건은 그와 무관하게 각각 국소 픽스로 처리할 수 있다. 알고리즘 절반이 먼저 안착하면 `selector` 문자열 자체가 짧고 읽기 좋아지므로 표시 압력이 줄어들 가능성도 있다 — 그 관찰이 판단 근거가 된다.

---

## 2026-08-09 — 피커 조준 UX (`picker-aim-ux`)

키보드 화살표로 DOM을 훑고(G1), Space로 마우스 추적을 얼리고(G2), 인스펙터 카드가 실제 렌더 폰트를 보여주고(G3), 오버레이 호스트가 제거되면 자가치유하는(G4) 네 갈래 기획. `/feature-review`의 4인 검수(CPO·CDO·CTO·QA)에서 갈래마다 독립적으로 무너졌다.

**G1·G2·G5 — 전제가 코드로 반증됐다.** `startPicker`(`src/sidepanel/picker-control.ts`) 전 경로에 **포커스를 페이지로 넘기는 코드가 없다.** 사용자는 사이드패널 버튼을 눌러 picking을 시작하므로 포커스는 사이드패널 문서에 남고, `picker.ts`의 `window.addEventListener("keydown", …)`는 발화하지 않는다. 마우스 이동은 포커스를 옮기지 않고, 페이지를 클릭하면 그 순간 확정돼 hover 모드가 끝난다 — **"조준 단계를 유지한 채 페이지에 포커스를 주는" 조작이 제품에 존재하지 않는다.** design.md에서 "포커스"라는 단어가 나오는 유일한 줄은 iframe 경계 항목이었다.

**G4 — 사정거리가 이름값보다 좁다.** 실측 사례가 0건이고(POSTMORTEM에도 PRD에도 인용 없음), 문서가 약속한 "SPA 라우트 전환"은 실제로 커버되지 않는다. React/Vue/Next의 라우트 전환은 body 안 루트 div의 자식만 바꿔 `<html>` 직속인 오버레이 호스트를 건드리지 않고, `documentElement` 자체가 교체되면 observer는 detach된 옛 노드에 붙어 발화조차 안 한다. 실제로 잡히는 건 `documentElement.innerHTML` 대입과 호스트 직접 제거뿐이다. 여기에 🔴 2건(치유가 `area-select` 세션을 복구 불가능하게 파괴 / `picker.cancelled`가 `handleClear`의 세션 초기화 뒤라 dead code)과 🟡 다수(healCount 누적↔연속 모순, iframe별 독립 카운터 탓에 광고 iframe 하나가 top 세션을 취소, 캡처 중 치유가 hover-shield 상태 유실)가 전부 이 갈래에서 나왔다.

**G3 — 브라우저가 이미 한다.** Chrome DevTools의 Computed 패널에 **"Rendered Fonts"** 섹션이 있고 정확히 같은 정보를 준다. 드랍 기준 1번에 걸린다. 네 갈래 중 설계 품질은 가장 좋았지만(판정을 `isRendered`로 주입해 순수 함수로 분리), 그것만 남기면 기획 하나를 유지할 이유가 되지 못한다.

**부수적으로 — 묶음 기획 생존율이 0/3이 됐다.** `regression-net`·`css-cascade-fidelity`에 이어 셋째다. 네 갈래가 서로 호출하지 않았고, 태스크 5개로 최소인데 design.md가 357줄이었다. 문서가 큰 이유가 깊이가 아니라 갈래 수일 때가 신호다.

**다시 볼 조건**: G1·G2는 "picking 중 페이지에 포커스를 주는 방법"이 먼저 정해져야 성립한다. 그 자체가 별도 결정이고, 확장이 사용자 포커스를 빼앗는 동작이라 before/after 스냅샷 신뢰와 충돌할 여지가 있다. G3는 DevTools로 안 되는 구체적 시나리오가 나올 때.

### 이 검수가 발굴한, 기획과 무관하게 **남아 있는 사실 2건**

기획은 접지만 아래는 실제 코드의 상태다. 묻어두지 않는다.

1. **페이지 쪽 `Escape`가 사문(死文)일 가능성이 높다.** `picker.ts`의 `onKeyDown`은 페이지 `window`에 붙는데 위 이유로 포커스가 페이지에 없다. e2e의 Escape 단언 21건 중 20건은 `panel.keyboard.press`(패널 문맥)이고, 페이지 문맥 단언은 `pickElement`가 부르는 `fixture.bringToFront()` 덕에 통과한다 — **자동화가 만든 포커스 전환이라 제품 동작이 아니다**(헬퍼 주석이 그렇게 적어놨다). 즉 "페이지에서 Escape로 picking을 취소한다"가 실사용에서 동작하는지 **검증된 적이 없다.** 패널의 `[취소]` 버튼이라는 대체 경로가 있어 가려져 있었다. 확인해서 사실이면 별도 픽스 대상이다.
2. **`parseFirstFontFamily`(`src/content/css-resolve.ts`)가 `split(",")[0]`이라 따옴표 안 콤마에서 틀린 답을 준다.** `"Font, With Comma", serif`에서 `"Font`를 돌려준다. 인스펙터 카드의 `font` 행에 그대로 나간다. 기획과 무관한 독립 버그다.

**키보드 e2e를 앞으로 쓸 때의 함정**: `pickElement` 헬퍼가 `fixture.bringToFront()`를 부르므로 **e2e에서만 페이지가 키보드 포커스를 갖는다.** 키 입력에 의존하는 spec은 이 환경에서 green이어도 실사용을 보장하지 못한다.

---

## 2026-08-08 — 디바이스 뷰포트 (구현까지 갔다가 드랍)

**유일하게 코드까지 만들었다가 드랍한 항목이다.** 전체 이력은 `archive/device-viewport` 브랜치, 회고는 `docs/POSTMORTEM.md`의 2026-08-08 항목.

페이지에 same-origin iframe 래퍼를 심어 390/768/1024px 폭으로 재로드하는 기능이었다. **Chrome DevTools의 디바이스 툴바가 실제 뷰포트를 리사이즈하고 BugShot이 그 안에서 정상 동작한다**는 실측이 결정타였다 — 브라우저가 이미 하는 일에 in-page 래퍼, background 판정 상태머신, cross-origin handoff 기제, picker·로그·캡처 전 경로의 분기를 지불하고 있었다. 10라운드 리뷰에서 🔴 19건이 나왔고 라운드 3~10의 심각은 **예외 없이** 직전 라운드 픽스가 원인이었다(8/8).

부차 사유: github·naver가 프레임 삽입을 거부했고(`net::ERR_BLOCKED_BY_RESPONSE`), 뚫으려면 사용자가 캡처하는 바로 그 문서의 CSP를 `declarativeNetRequest`로 벗겨야 했다.

**다시 볼 조건**: DevTools 디바이스 모드로 안 되는 구체적 시나리오가 나올 때. 그때도 in-page 래퍼가 아니라 다른 수단부터 검토한다.

---

## 2026-08-09 — 자동 버그 감지 트리거 (`anomaly-capture-trigger`)

uncaught error·unhandled rejection·5xx·네트워크 실패를 감지해 캡처 진입 화면에 배지를 띄우고, 리플레이를 자동으로 잘라 AI 초안까지 실행하려던 기획.

**이름이 약속하는 범위와 실제 작동 창이 크게 어긋난다.** PRD 자신이 적어놨듯 구제 대상은 "BugShot을 안 켠 사람"이 아니라 **"켜두고 Debug>이슈 화면에 머물러 있는데 캡처 버튼을 안 누른 사람"** 이다. 배지는 `EmptyState`에만 있고, console/network 서브탭을 보는 동안엔 `IssueTab`이 언마운트돼 감지가 멈추며, 5xx 갱신은 `activeMainTab === "debug" && sub === "issue"`에서만 도는 1500ms 강제 sync에 의존한다. 그 창을 넓히려면 배선이 여러 진입점으로 퍼지는데, 그게 디바이스 뷰포트가 무너진 방식과 같다.

여기에 **`replayEnabled` 기본값을 `false → true`로 뒤집는 것**이 목표에 포함돼 있었다. 저장소 최초의 기본값 뒤집기이고, 30s Replay는 privacy 문서 미갱신으로 웹스토어 심사에서 한 번 탈락한 바로 그 기능이다.

**다시 볼 조건**: 알림 표면이 `EmptyState`·`IssueTab` 마운트에 묶이지 않는 구조가 먼저 생길 때(예: 툴바 배지·`chrome.action` 배지). 감지 로직 자체는 이미 수집 중인 신호를 읽는 것뿐이라 싸다 — 비싼 건 **알림을 어디에 띄우느냐**다. 순서를 뒤집어 표면부터 풀면 그때 다시 볼 만하다.

---

## 2026-08-09 — UA 기본값 기준선 (`ua-default-baseline`)

숨김 `about:blank` iframe에 같은 태그의 빈 요소를 넣어 순수 UA 기본 스타일을 뜨고, 선택 요소의 computed와 차분해 "저자가 손댄 것"만 남기려던 기획. 손으로 적은 `KNOWN_DEFAULTS`(58개 prop) 테이블을 대체하는 것이 목적이었다.

**두 가지가 걸린다.**

1. **디바이스 뷰포트와 구조가 같다.** 페이지에 iframe을 심고, 그것이 스크린샷·스크롤 캡처·로그 수집·DOM 트리 네비게이터에 영향을 주지 않도록 방어해야 한다(원 PRD의 G4). 방금 드랍한 기능이 정확히 그 방어에서 반복적으로 샜다.
2. **문제를 없애는 게 아니라 옮긴다.** PRD의 "사정거리" 절이 직접 적었다 — 실효 범위는 `INTERESTING_PROPS` ∩ 비상속 ∩ 레이아웃 비의존 ∩ `KNOWN_DEFAULTS` 미등록의 교집합이고, **"손으로 채워야 할 목록이 사라지는 게 아니라 `KNOWN_DEFAULTS` → `INTERESTING_PROPS` 하나로 줄어든다."** 인용된 회고 2건 중 1건만 구조로 풀리고 나머지(border-color)는 기존 가드 `isInactiveBorderColor`가 그대로 지킨다.

**대신 할 것**: `KNOWN_DEFAULTS`에 `transition-*`·`animation-*` 같은 shorthand longhand 계열을 손으로 채운다. POSTMORTEM 2026-06-29가 터진 자리가 정확히 거기이고, 위 위험을 지는 것보다 싸다.

**다시 볼 조건**: 페이지에 노드를 심지 않고 UA 기본값을 얻는 수단이 생길 때. 그런 API가 없는 한 비용 구조는 안 바뀐다.

---

## 2026-08-09 — 회귀 검출 그물 (`regression-net`)

복제본 레지스트리 / `ASSUMPTIONS.md` 전제 큐 / dev 전용 불변식 배너 / e2e 위반 승격 / CSSOM 코퍼스 대조 — 다섯 목표를 한 문서에 담고 있었다.

**하나의 기능이 아니라 다섯 개 프로젝트다.** 서로 독립이고 각각이 별개 기획 규모인데, 전부 메타 도구라 사용자 가치는 0이고 개발 효율 투자다. 그리고 **그물을 짓는 일인데 그 그물을 검증할 그물이 없다** — 디바이스 뷰포트에서 배운 것이 "검증 수단 없이 크게 지으면 자기 픽스가 다음 결함을 만든다"이므로, 이 형태는 특히 위험하다.

**다시 볼 조건**: 목표 1(복제본 대조 테스트)만 떼어 별도 기획으로. `복제본` 계열이 회고 23건(29%)으로 실증된 반복 함정이고, 구현이 `pnpm test` 안에서 닫혀 검증 가능하다는 점에서 다섯 중 유일하게 조건을 만족한다. 나머지 넷, 특히 dev 배너와 CSSOM 코퍼스는 비용이 가장 크고 이득이 가장 불확실하다.

---

## 2026-08-09 — CSS 캐스케이드 충실도 (`css-cascade-fidelity`)

cross-origin author 규칙을 `CSSStyleRule`로 수렴시켜 same-origin과 같은 인덱스·같은 판정 함수를 태우려던 기획(G1). 조건 평가(G2)·정상 캐스케이드(G3)·uncertain 축소(G4)가 딸려 있었다.

**CLAUDE.md가 "회고 1위 영역(13건/16%)"이라 경고한 자리이고, 그 영역의 검증 수단은 e2e 하나뿐이다.** 브라우저 실동작에 걸려 유닛으로 고정이 안 된다. 거기서 G1은 수집 경로 전면 재작성이라 위험 프로필이 디바이스 뷰포트와 같다 — 검증이 약한 영역을, 크게, 한 번에.

**대신 할 것**: **G2만 별도로 떼어낸다.** 지금 데스크톱에서 cross-origin 시트의 `@media (max-width: 400px)` 규칙이 섞여 들어오는 건 명백한 오답이고, `parseRulesFrom`(`css-source-cache.ts:762`)에 조건 평가를 붙이는 국소 수정으로 잡힌다. 이건 별도 기획으로 다시 쓸 값어치가 있다.

**다시 볼 조건**: G2가 먼저 안착한 뒤, cross-origin specificity 역전이 실사용에서 실제로 관측될 때. 지금은 이론적 오답이고 실측 사례가 없다.

---

## 2026-08-09 — CSS Inspector 백로그 (`css-inspector-backlog.md`)

Hoverify v4.8.6 분해 조사에서 스코프 밖으로 뺀 항목들을 모아둔 문서. 이 문서가 참조하던 세 기획 중 둘(`css-cascade-fidelity`·`ua-default-baseline`)이 위에서 드랍됐고, 핵심 항목 B1(상태 pseudo 스타일)이 `css-cascade-fidelity`에 의존한다고 스스로 기록하고 있어 전제가 무너졌다.

**조사 결과 중 값어치가 있어 여기 압축해 남긴다:**

- **`:hover` 규칙은 오늘 100% 누락된다.** `getMatchingRules`가 `el.matches(rule.selectorText)`로 판정하는데 `.btn:hover`는 마우스가 실제로 그 위에 있어야 true이고, picking 중엔 blocker가 hit target이며 hover-shield가 hover를 의도적으로 억제한다(`overlay.ts:88-102`).
- **수집 방법은 확정돼 있다**: 셀렉터에서 상태 pseudo만 벗겨 `.btn:hover` → `el.matches(".btn")`으로 판정하고 specificity는 원본 셀렉터로 계산한다. `debugger` 권한도, 클래스 치환도, 규칙 재삽입도 불필요하다.
- **라이브러리를 새로 넣을 필요 없다** — `css-source-cache.ts`의 `lastCompound`·`splitSelectorList`로 의존성 0의 depth-aware 제거가 된다.
- **Hoverify의 버그를 베끼지 말 것**: 그쪽 pseudo 추출기는 마지막 compound만 봐서 `.card:hover .title`이 hover 규칙으로 안 잡힌다. "셀렉터 어느 compound에든 상태 pseudo가 있으면 상태 규칙"이 옳다.
- **hover 상태 스크린샷은 어느 설계로도 불가**하다. `:hover` 강제는 CDP `forceElementState`뿐이고 `debugger` 권한이 필요하다.

**다시 볼 조건**: 상태 pseudo 스타일을 독립 기획으로 다룰 때. cross-origin 시트의 hover까지 보려면 CSSOM 통일이 선행이지만, **same-origin 한정으로 좁히면 그 의존 없이도 성립한다** — 그 범위로 다시 쓰는 것이 현실적이다.
