# audit-refactor-6 — 중복 제거·타입 경계 정리·데드 코드

> 제품 기능이 아니라 코드베이스 감사(2026-08-11 `/audit`) 후속 정리다. 사용자 노출 동작 변경은 없다(순수 내부 구조 정리).

## 코드 기준 갱신 (1차: v1.7.20 / 2차: v1.7.23 — 2026-08-14)

이 문서는 커밋 `225efb7b`(v1.7.18) 시점 코드로 감사한 결과를 옮긴 것이고, 그 뒤 v1.7.19와 **N-way 로케일 인프라 대공사**(프랑스어 추가 준비 — `src/i18n/locales.ts` 신설, `LocaleMode`·`detectLocale`·`normalizeLocale`이 store에서 그쪽으로 이관)가 리베이스로 들어왔다. **재검증 결과 이 배치의 항목은 그 변경으로 해소되지 않았다.** 달라진 것은 셋뿐이다:

- **🟡54 — 근거가 하나 늘었다.** `i18n/index.ts`의 스토어 값 import는 그대로인데, 타입 의존이 반대로 뒤집혀 이제 **선언된 단방향(store → i18n) 위반**이기도 하다(아래 배경 §54).
- **⚪106 — 무효.** `getLocale`에 프로덕션 사용처가 생겼다(`src/sidepanel/tabs/issueListUtils.ts:176`). 삭제하지 않는다.
- **⚪102 — 대상 1건 변경.** `issueListUtils.ts`의 파일 내부 전용 export였던 `dateLabel`이 테스트에서 import되기 시작해 **삭제·비공개화 대상이 아니라 주석 대상**(⚪98과 같은 취급)이 됐다.

~~그 외 인용 파일·줄번호는 대부분 그대로다.~~ 예외로 `src/lib/external-links.ts`가 이 공사로 바뀌었는데, ⚪114가 가리키는 `src/lib/external-url.ts`와는 **다른 파일**이다(이름이 비슷해 혼동 주의).

### 2차 재검증 (v1.7.23 — 2026-08-14)

**위 문단의 "대부분 그대로다"는 더 이상 사실이 아니다.** 그 뒤 v1.7.21~23이 들어와 **73개 소스 파일**이 바뀌었고, 특히 v1.7.21의 `issue-body-locale`이 **`sidepanel/lib`의 빌더 11개 진입점을 `withLocale`로 감쌌다** — 이 배치의 중복 제거 대상 상당수가 바로 그 빌더들이다. `/feature-review` 전수 재검증 결과:

**집계: 유효 24 / 줄번호만 이동 12 / 사실오류 8 / 삭제금지 재분류 1덩어리(16심볼) / 신규 중복 3 / 이미 해소 0**

- **🟡54(G6-1 `useT` 분리) — 배치에서 제외.** log-viewer의 `@/i18n` alias가 prefix 매칭이라 `@/i18n/useT`가 `log-viewer/i18n.ts/useT`로 재작성된다(POSTMORTEM 2026-08-11 `:173`). **typecheck·유닛은 전부 green이고 `build:log-viewer`만 깨지는데** 원안 검증에 그게 없었다.
- **⚪107·108·110(Task 9-2) — 전면 재작성.** "미참조 export 삭제" 대상 16종 중 **순수 데드는 4개뿐**이고 나머지는 내부·테스트 참조를 갖는다. 실제 작업은 삭제가 아니라 `export` 키워드 제거이며, 이전 목록대로 착수하면 자기모순으로 멈춘다.
- **항목 59 — 전제가 거짓.** `ContentMessage`는 코드에 존재하지 않는다. `PickerMessage`를 좁히면 recorder·annotation 수신부 ~40곳이 깨진다. **⚪111만 남긴다.**
- **항목 43·46·47·50·51·55·57·101 — 수치·근거 정정**(판정은 유지). 상세는 design.md §2026-08-14 재검증 편입 사항.
- **신규 그물 2개가 확정 red를 낸다** — `builderLocaleWrap.test.ts`(G2), `jiraSubmitSymmetry.test.ts`(G3). 둘 다 이 문서보다 나중에 생겨 언급이 0이었다.
- **신규 중복 2건 편입** — `FieldCombobox` 셸 미사용 2벌(v1.7.22가 세 번째 Jira 프로젝트 피커 추가), `useLazyListOnOpen` 손조립 5벌(v1.7.23이 1벌 추가).
- **G3에 `requireMediaUpload` 축 추가** — github·notion·gitlab 3개만 넘기는 Slack 승격 데이터 보호 가드가 어댑터 입력에 없었다.

예외 없음. 이 배치의 모든 항목은 **동일 출력·동일 동작을 유지한 채** 구현을 한 곳으로 모으거나 죽은 코드를 걷어내는 것이다. 단 항목 48만 **폴백 값 통일**이라 이론상 출력이 바뀔 수 있는데, 바뀌는 대상은 "Asana 인라인 이미지의 파일 확장자"이고 실제 도달 조건(파싱 실패 data URL)이 캡처 파이프라인에 존재하지 않는다 — design.md "위험 요소" R6 참조.

## 배치 지도

이 감사는 6개 배치로 쪼개 순차 처리한다. 배치 간 파일 충돌이 없도록 계열별로 묶었다.

| 배치 | 주제 | 항목 | 규모 |
|---|---|---|---|
| ~~audit-refactor-1~~ (완료·문서 삭제) | 요청 경계·자격증명 가드 | 🔴1 · 🟡3~5,10,11,36~41 · ⚪63~65,69,70 | 소 |
| ~~audit-refactor-2~~ (완료·문서 삭제) | 콤보박스 race·lazy-load 단일 출처 이행 | 🔴2 · 🟡42 | 중 |
| ~~audit-refactor-3~~ (완료·문서 삭제) | 레코더 게이트·무결성 | 🟡6~9,15,16,31,35 · ⚪66,67,77 | 중 |
| ~~audit-refactor-4~~ (완료·문서 삭제) | 세션·데이터 정합 | 🟡12,14,17,18 · ⚪71,73~76 (13 제외) | 중 |
| audit-refactor-5 | UI 접근성·디자인 토큰·i18n 정합 | 🟡19~30,32~34,60 · ⚪72,78~92 | 중 |
| **audit-refactor-6** | **중복 제거·데드 코드** | **🟡43~59,61,62 · ⚪68,93~114** | **대** |

## 배경

이 배치는 **"같은 규칙이 N곳에 복제돼 있어 한쪽만 고치면 갈리는 것"** 과 **"참조가 0인 채 남아 있는 것"** 을 한 계열로 묶었다. 앞의 다섯 배치가 *잘못된 동작*을 고쳤다면 이 배치는 *다음 버그의 씨앗*을 걷어낸다.

코드베이스는 8개 플랫폼(jira·github·linear·notion·gitlab·asana·clickup·slack)을 어댑터 패턴으로 지원하는데, **어댑터를 늘리는 방식이 "직전 플랫폼 파일을 복사해 이름만 바꾸는 것"** 이었다. 그 결과가 이 배치의 절반이다:

- 본문 빌더 8벌에 `sectionLabel`·`listItems`가 **바이트 단위로 동일하게** 8번 있고(🟡44·45), `emitLogSummary`는 md↔clickup이 25줄 완전 동일, linear↔asana가 24줄 완전 동일이다(🟡46). 정작 같은 계열의 `networkErrorCount`는 `src/sidepanel/lib/buildLogSummary.ts:58-61`이 **"8곳에 복붙하면 그게 다음 드리프트 씨앗이다(POSTMORTEM 2026-08-06)"** 라고 못박아 단일 출처로 뽑아둔 상태다 — 즉 이 파일 안에 정답과 오답이 나란히 있다.
- 커넥트 폼 6개의 `*ConnectFlow`는 86줄이 **줄 수까지 같고** diff 전량이 플랫폼 id·아이콘·계정 타입·토큰 다이얼로그·i18n 키뿐이다(🟡50, 실측 확인).
- `src/lib/settings-storage.ts`는 `readStoredXAuth` 8벌 + `writeStoredXOAuthTokens` 5벌 = **13개 export가 같은 골격**이다(🟡56).
- 제출 핸들러는 **파일을 넘어** 복제됐다 — `IssueCreateModal.tsx:158-531`(374줄)과 `DraftDetailDialog.tsx:403-820`이 같은 8개 핸들러를 각각 갖는다(🟡43). 신규 제출과 재제출이 다른 코드를 타므로 한쪽만 고치면 경로가 갈린다.

여기에 **경계가 흐려진 것** 두 계열이 붙는다:

- `src/types/messages.ts`는 이름과 달리 선언 전용이 아니다 — `BgError` 클래스·`sendBg`·에러 판독 4개·emitter 7개가 들어 있고, `src/types/` 나머지 17개 파일은 선언 전용이다(🟡57). 이 불일치가 툴링까지 오염시켰다: `scripts/coverage-report.mjs:66`의 `isBrowserBound()`가 `src/types/`를 **"타입 선언 (실행 코드 없음)"** 이라는 근거로 통째 제외하는데, 그 근거가 사실이 아니다(🟡58).
- `src/i18n/index.ts:4`가 `useSettingsUiStore`를 **값 import**한다(🟡54). 그런데 스토어가 필요한 건 React 훅인 `useT`(:47)뿐이고, background가 쓰는 건 `t()`다. 결과적으로 `t()` 하나 때문에 zustand persist 스토어 전체가 SW 번들로 들어간다 — `src/store/settings-ui-store.ts:232-233`이 **"이 스토어는 background service worker 번들에 포함되므로 UI DnD 라이브러리를 그래프에 끌어들이면 안 된다"** 고 경고하는 그 스토어다. CLAUDE.md의 "store는 `sidepanel/tabs`를 import하지 않는다" 게이트와 같은 방향의 위반이 반대편에서 일어나고 있다.
  - **N-way 로케일 인프라 이후 근거가 하나 더 붙었다 — 이제 *선언된* 의존 방향 위반이다.** `LocaleMode` 정의가 store에서 신설 `src/i18n/locales.ts`로 이관되면서 **store가 `@/i18n/locales`를 값으로 import**하고(`settings-ui-store.ts:9` — `detectLocale`·`normalizeLocale`), 같은 파일 `:12-13`이 re-export 위에 **"방향은 store → i18n 단방향이다"** 라고 못박았다. `i18n/index.ts:4`의 값 import가 정확히 그 단방향을 깨서 i18n ↔ store 순환을 만든다. 즉 이 항목은 감사 시점의 "SW 번들 비대"에 더해 **문서화된 불변식 위반**이 됐다.
  - **해법의 제약도 그만큼 명확해졌다.** `src/i18n/locales.ts`는 **의존성 0을 유지해야 하는** 모듈이고(log-viewer 별도 번들이 상대경로로 직접 끌어가고, SW도 탄다), `src/i18n/__tests__/locale-registry.test.ts`가 **소스를 읽어 런타임 import 0을 강제**한다. 따라서 `useT`를 떼어낸 뒤 `index.ts`에 남는 것도 `./ko`·`./en`·`./locales`(타입+상수)까지여야 하고, **`locales.ts` 쪽으로 무언가를 밀어 넣는 해법은 그 테스트가 즉시 red로 잡는다.**

마지막으로 **무음 데이터 유실 지점 하나** — `src/store/editor-store.ts:867`의 `confirmDraft`는 captureMode 4분기가 각자 `saveDraft({...})`를 부르는데, 그 안의 공통 필드 12줄(`id`·`status`·`platform`·`title`·`createdAt`·`updatedAt`·`pageUrl`·`pageTitle`·`draft`·3개 로그 blobKey)이 **4벌 복제**돼 있다(🟡62, 함수 전체 ~252줄). 한 분기에서 필드를 빠뜨리면 typecheck도 테스트도 통과하고 데이터만 조용히 사라진다.

### 감사 리포트와 실제 코드가 어긋난 5곳 (기획 중 확인)

🟡 항목(43~62)은 전부 소스로 대조했다. 다음 다섯은 감사 원문을 그대로 따르면 안 된다.

1. **경로 오류(항목 48)** — `src/lib/downloadCapture.ts`는 실제로 `src/sidepanel/lib/downloadCapture.ts`다.
2. **항목 55의 "완전 동일"은 과장** — `src/lib/network-log-path.ts`의 `networkLogPath`에는 `if (!url) return url` 가드가 하나 더 있고 `extractPath`(`buildLogSummary.ts:122`)에는 없다. 통합 시 **빈 문자열 입력의 동작이 바뀌는 쪽은 `extractPath` 호출처**다(둘 다 `""`를 반환하므로 실동작은 같다 — 확인 완료). 통합 방향은 `networkLogPath` 쪽으로 간다(테스트가 이미 있다: `src/lib/__tests__/network-log-path.test.ts`).
3. **항목 46의 "8개 본문 빌더"는 통합 대상이 아니다** — `emitLogSummary`는 7개 파일에 있지만 출력 매체가 셋으로 갈린다. **markdown·clickup·linear·asana 4개만 동형**이고, slack은 마크업이 다르며(`*`/`•`), notion은 `NotionBlock[]`을 쌓고, adf는 `emitLogSummaryAdf`로 이름부터 다르다. 통합 범위는 4개다.
4. **항목 53의 "27회"는 34회이고 대상 설명이 틀렸다** — `FieldRow`(`src/sidepanel/components/FieldRow.tsx`)의 실제 사용처는 connect 폼이 아니라 `*IssueFields` 8개 + 스타일 에디터 2개다. connect 폼 8개는 `<label className="text-xs text-muted-foreground">`를 **34회** 수기 반복한다(`grep -c '<label'` 실측: asana 4·clickup 5·github 4·gitlab 5·jira 7·linear 5·notion 3·slack 1).
5. **항목 43의 "통째 복제"는 절반만 맞다** — 두 파일의 핸들러는 `submitToX(...)` 인자 매핑과 `setLastSubmitFields(...)`가 동일하지만, **전후 처리가 갈린다.** `IssueCreateModal`은 `inlineImages`를 인자로 받고 `markSubmitted`를 `currentIssueId` 가드 뒤에서 부르고 `onSubmitted(...)`로 끝난다. `DraftDetailDialog`는 핸들러 안에서 `resolveInlineImagesForSections`를 직접 호출하고, `markSubmitted`를 무조건 부르고, `useEditorStore` 상태를 확인해 `clearPicker` + `reset()`을 한다(그리고 Jira 핸들러엔 "승격 가드 없음" POSTMORTEM 주석이 이쪽에만 있다). **핸들러 전체가 아니라 중간의 인자 매핑 계층만 뽑을 수 있다** — 설계는 이 사실을 따른다.

### CLAUDE.md "dead code는 삭제하지 않는다" 원칙과의 관계

CLAUDE.md 작업 원칙은 **"기존 dead code는 언급만 하고 삭제하지 않는다 — 내 변경이 만든 고아만 제거"** 다. 이 배치는 그 원칙의 **명시적 예외**다. 이유:

- 이 배치의 목적 자체가 "감사가 지목한 데드 코드 정리"다. 원칙은 *다른 작업 중 곁다리로 남의 코드를 지우지 마라*는 외과적 변경 규율이지, *데드 코드 정리를 의뢰받았을 때도 하지 마라*가 아니다.
- 다만 **"사용처 0"은 감사의 주장이지 검증된 사실이 아니다.** 삭제 태스크마다 착수 시점 `grep` 재확인을 **검증 체크박스로 강제**한다(tasks.md의 모든 삭제 태스크에 동일 항목). 특히 `src/store/blob-db.ts`·`src/lib/settings-storage.ts`처럼 background·sidepanel·log-viewer 세 진입점에서 각각 import되는 파일은 **세 진입점 전부**를 grep한다.
- 반대로 **이 배치 밖에서 눈에 띈 데드 코드는 여전히 건드리지 않는다.** 감사 연번이 붙은 것만 대상이다.

다음 세션이 이 문단을 읽지 않고 "CLAUDE.md가 삭제하지 말랬는데?"로 멈추지 않도록, tasks.md 선행 조건에도 같은 취지를 한 줄 남긴다.

## 목표

1. **본문 빌더의 공용 헬퍼가 단일 출처를 갖는다**(🟡44·45·46) — `sectionLabel`·`listItems`가 각 1벌, 마크다운 계열 `emitLogSummary`가 1벌. `buildLogSummary.ts`의 `networkErrorCount`가 이미 취한 형태와 같아진다.
2. **인라인 이미지 업로드 파일명이 한 함수에서 나온다**(🟡47) — 확장자를 바꿔도 `hrefMap` 조회가 무음으로 miss나지 않는다. 6개 파일 9곳의 하드코딩이 사라진다.
3. **`imageExtFromDataUrl`이 1벌이다**(🟡48) — Asana 로컬 사본을 지우고 `downloadCapture.ts`의 export판을 쓴다(폴백 `webp`로 수렴).
4. **`toUploadEntry`가 1벌이고 `inlineFiles` 매핑이 1벌이다**(🟡49) — clickup·asana의 로컬 재정의 제거.
5. **제출 인자 매핑이 신규/재제출 두 경로에서 공유된다**(🟡43) — 플랫폼별 어댑터 8개가 `src/sidepanel/lib/`에 서고, 두 컴포넌트는 그걸 호출한 뒤 각자의 후처리만 한다. **`submitToX` 인자 한 필드를 빠뜨리면 두 경로가 함께 깨진다**(지금은 한쪽만 깨진다).
6. **`*ConnectFlow` 6개가 1개 컴포넌트가 된다**(🟡50) — jira·slack은 형태가 달라 제외(design.md 판정표).
7. **`SubmittedBadge` 7개의 error/deleted·loading 렌더가 1벌이 된다**(🟡51) — 본체는 그대로 둔다(판정표 참조).
8. **connect 폼의 라벨 행이 `FieldRow`를 쓴다**(🟡53) — 새 추상화 없이 기존 단일 출처로 치환만.
9. **`t()`가 zustand 스토어를 끌고 들어가지 않는다**(🟡54) — `useT`를 분리해 background 번들에서 `settings-ui-store`가 빠지고, **`settings-ui-store.ts:12-13`이 선언한 "store → i18n 단방향"이 실제로 성립한다**(지금은 양방향 값 import라 순환).
10. **`networkLogPath`가 단일 출처다**(🟡55) — `extractPath` 제거.
11. **`settings-storage`의 13벌 골격이 테이블 1개로 수렴한다**(🟡56) — 9번째 플랫폼을 추가할 때 read/write 함수를 새로 쓰지 않는다.
12. **`src/types/`가 선언 전용이 된다**(🟡57) — 런타임 코드가 `src/lib/`으로 나가고, 그 결과 `scripts/coverage-report.mjs:66`의 제외 근거가 **사실**이 된다(🟡58). emitter 7종은 팩토리 1개로 수렴한다(⚪112).
13. **`PickerMessage`가 picker 채널만 담는다**(🟡59) — 레코더·어노테이션은 별도 union. 인라인 `import("@/types/network")` 3곳도 정리(⚪111).
14. **`INLINE_REF_RE`에 고정 테스트가 생긴다**(🟡61) — `src/lib/inline-ref.ts`의 주석이 명시한 불변식("삭제 판정과 해석이 같은 패턴")이 자동 검증 대상이 된다. 항목 47 계열 작업의 **안전망**이므로 가장 먼저 한다.
15. **`confirmDraft` 4분기가 공통 레코드 헬퍼를 공유한다**(🟡62) — 분기는 captureMode 고유 필드만 남는다. 필드 누락이 구조적으로 불가능해진다.
16. **⚪ 항목 22건이 정리된다** — 대부분 미참조 export 삭제·재진술 주석 제거·1회용 wrapper 인라인. 개별 검증은 착수 시 grep으로 한다.

## 비목표 (Non-goals)

- **한 번에 끝내는 것이 목표가 아니다 — 독립 실행 단위로 나눠 여러 턴에 걸쳐 소화한다.** tasks.md의 그룹 하나가 PR 하나에 대응한다. 그룹 간 파일 충돌이 없도록 묶었으므로 순서를 바꿔도 되고, P2를 안 해도 P0·P1만으로 의미가 있다. **"배치 6 완료"를 게이트로 삼지 않는다.**
- **`src/store/blob-db.ts`의 7 objectStore CRUD 골격을 제네릭화하지 않는다**(⚪113). 736줄을 제네릭 트랜잭션 래퍼로 접으면 IndexedDB 타입 안전성(스토어별 키·인덱스)을 런타임 문자열로 내리게 되고, 회귀가 나면 사용자 데이터 유실이다. 이득 대비 위험이 안 맞는다. 같은 파일의 데드 export 삭제(⚪107)만 한다.
- **`*StatusBadge` 7개를 통합하지 않는다**(🟡51의 후반부). 상태 도메인이 플랫폼마다 다르다(asana는 boolean `completed`, clickup·jira는 카테고리, github·gitlab은 open/closed, notion은 select). 제네릭화하면 prop 폭발 + 타입 파라미터 3개짜리 컴포넌트가 되고 CLAUDE.md "요청하지 않은 유연성·추상화 추가 금지"에 정면으로 걸린다. `SubmittedBadge` 쪽의 **공통 셸만** 뽑는다.
- **jira·slack의 `ConnectFlow`를 통합 대상에 넣지 않는다**(🟡50). jira는 100줄(baseUrl 입력 경로가 더 있다), slack은 61줄(OAuth 전용)이라 6개 동형 그룹과 형태가 다르다. 억지로 넣으면 optional prop 5개가 늘어난다.
- **새 어댑터 레이어·플러그인 레지스트리를 만들지 않는다.** 항목 43·50·56의 통합은 전부 **기존 코드를 한 곳으로 옮기는 것**이지 새 확장 지점을 설계하는 게 아니다. "9번째 플랫폼을 쉽게 추가하기 위한 프레임워크"는 이 배치의 목표가 아니다.
- **i18n 키를 리네임·통폐합하지 않는다.** 항목 44~46 통합 시 `t()` 호출은 문자열 그대로 옮긴다. ko/en 동시 갱신 churn을 만들지 않는다.
- **동작을 고치지 않는다.** 이 배치에서 발견되는 버그는 **기록만 하고** 해당 배치로 넘긴다(예: 항목 48의 폴백 불일치는 "통일"이지 "수정"이 아니다 — 도달 불가 경로임을 확인한 뒤 통일한다).
- **`scripts/coverage-report.mjs`의 로직 스코프 정의를 넓히지 않는다**(🟡58). `src/types/` 제외 **근거 주석**을 사실에 맞추고, 57에서 옮겨나간 파일이 분모에 들어오는 것만 확인한다. `.tsx` 제외·OAuth 런처 제외 규칙은 건드리지 않는다.
- **가이드·i18n·privacy 문서는 갱신 대상이 아니다.** 사용자 노출 동작이 안 바뀐다.

## 회귀 감시 지점

`/feature` 템플릿의 "사용자 시나리오"를 이 성격에 맞게 대체한다. **고치다가 깨질 수 있는 기존 동작과 그 확인법**이다. 대규모 리팩터라 이 절이 이 문서에서 가장 중요하다.

### R1. 8개 플랫폼 본문이 문자 단위로 같게 나온다 (🟡44·45·46 리스크)

본문 빌더 통합의 유일한 성공 조건이다. `sectionLabel`·`listItems`는 8곳이 동일하지만 **`emitLogSummary`는 4곳만 동일**하고 slack·notion·adf는 다르다. 통합 범위를 잘못 잡으면 slack에 `##`가 찍히거나 notion 블록이 문자열로 들어간다.

- 확인: 통합 **전에** 8개 빌더의 골든 출력 테스트가 있는지 확인하고, 없는 빌더는 먼저 추가한다(tasks.md P0). 기존 테스트: `src/sidepanel/lib/__tests__/`의 빌더 테스트들 + `markdown-logs-link.test.ts`(linear의 `emitLogSummary` 출력 형태를 고정하는 회귀 테스트가 이미 있다).

### R2. `logs.html` 링크가 있는 빌더와 없는 빌더가 안 섞인다 (🟡46 리스크)

markdown·clickup은 `emitLogSummary(lines, ctx, logsHref)`로 **링크를 건 파일명**을 찍고, linear·asana는 3번째 인자 없이 평문 `logs.html`을 찍는다. 통합 함수의 `logsHref`를 optional로 유지하지 않으면 linear·asana 본문에 `[logs.html](undefined)`가 나간다.

- 확인: `markdown-logs-link.test.ts`가 이미 평문 쪽을 고정한다. 링크 쪽 케이스를 clickup·markdown 빌더 테스트에 추가한다.

### R3. 인라인 이미지가 계속 인라인으로 붙는다 (🟡47·48·49·61 리스크)

`inline-${refId}.webp` 문자열은 **생성 측**(업로드 파일명)과 **조회 측**(`hrefMap.get`) 두 곳에서 쓰이고 **반드시 같아야** 한다. `src/background/messages.ts:866`에도 조회 측 사본이 하나 더 있다(background 경로 — sidepanel 헬퍼를 import할 수 있는지 확인 필요). Asana만 확장자가 가변(`inline-${refId}.${imageExtFromDataUrl(...)}`)이라 통합 헬퍼는 확장자를 인자로 받아야 한다.

- 확인: `src/sidepanel/lib/__tests__/submitToJira.test.ts:76`이 이미 `inline-${refId}.webp` 규칙을 고정한다. 나머지 플랫폼(linear·clickup·notion·slack·asana·github/gitlab via prepareUpload)에도 같은 케이스를 추가한 **뒤에** 헬퍼를 도입한다.
- 확인: `INLINE_REF_RE` 테스트(🟡61)를 **먼저** 넣는다 — 마크다운 참조 해석과 blob GC 판정이 같은 패턴을 쓴다는 불변식이 깨지면 살아있는 이미지가 지워진다(`src/lib/inline-ref.ts` 주석).

### R4. 신규 제출과 재제출이 같은 이슈를 만든다 (🟡43 리스크 — 최대)

`IssueCreateModal`(신규)과 `DraftDetailDialog`(재제출)의 핸들러는 **후처리가 다르다**(배경 §5). 어댑터를 뽑을 때 후처리까지 끌고 가면:
- `DraftDetailDialog` 쪽의 무조건 `markSubmitted` → 조건부로 바뀌어 재제출 기록이 안 남거나,
- `IssueCreateModal` 쪽에 `reset()`·`clearPicker`가 유입돼 제출 직후 에디터가 날아간다.

- 확인: 어댑터는 **인자 매핑만** 담는다 — 실행 0건. `submitToX` 호출·`setLastSubmitFields`·`markSubmitted`·`onSubmitted`·`reset`·`clearPicker`가 전부 호출처에 남는다(2026-08-14 정정 — 원안은 앞의 둘을 어댑터에 넣었는데, 그러면 설정 기록이 `markSubmitted`·`reset` 앞으로 당겨진다. design.md §G3 참조. 기준을 낮춘 게 아니라 올린 정정이다).
- 확인: 어댑터 단위 테스트가 **8플랫폼 × 2매핑을 `toEqual`(정확 일치)로** 고정한다 — 순수 함수라 `vi.mock` 없이 직접 호출한다. 수동 실연은 값 매핑이 아니라 **배선**을 보는 것이므로 축을 좁힌다: ① 승격 경로 1회(`isSlackPreserved` → `requireMediaUpload`가 유일하게 값이 갈리는 축이고 e2e는 github 승격만 태우므로 **gitlab 또는 notion**) ② **jira 재제출 1회**(siteId sticky — 이 항목의 발단이자 `projectKey` 계정 fallback이 어댑터 인자로 넘어간 유일한 자리).
- 확인: `DraftDetailDialog`의 Jira 핸들러에만 있는 "승격 가드 없음" POSTMORTEM 주석이 유실되지 않는지.

### R5. 커넥트 버튼이 8개 플랫폼 전부에서 계속 동작한다 (🟡50 리스크)

통합 컴포넌트가 받아야 하는 축은 실측 diff 기준 6개다: 플랫폼 id(`"linear"`), bg 메시지 타입 2개(`X.oauth.available`·`X.startOAuth`), 계정 타입(`LinearAccount`), 아이콘 컴포넌트, i18n 라벨 키 2개(`platform.tab.X`·토큰 버튼 키), 토큰 다이얼로그 컴포넌트. **`sendBg` 메시지 타입이 문자열 조립(`` `${id}.startOAuth` ``)이 되면 `BgRequest` union 타입 검사가 죽는다** — 메시지 객체를 prop으로 받거나 타입 맵으로 좁힌다.

- 확인: 6개 플랫폼 각각 연결 해제 → 재연결(OAuth 경로 1개 + 토큰 경로 1개). OAuth env가 없는 플랫폼은 토큰 경로만.
- 확인: `oauthAvailable === null`(응답 전) 동안 버튼이 disabled인 기존 동작 유지 — `methods.length === 0` 계산이 `connectMethods(oauthAvailable)` 안에 있다.

### R6. Asana 인라인 이미지 확장자가 안 바뀐다 (🟡48 리스크)

두 구현의 폴백이 다르다:

| 입력 | asana 로컬판 | `downloadCapture` export판 |
|---|---|---|
| `data:image/png;...` | `png` | `png` |
| `data:image/jpeg;...` | `jpg` | `jpg` |
| `data:image/svg+xml,...` | `svg` | `svg` |
| `data:text/plain,...` / 비-data URL | **`png`** | **`webp`** |

- 확인: Asana 경로에 들어오는 `img.dataUrl`이 항상 `data:image/*`인지 grep으로 확인한다(인라인 이미지는 에디터가 만든 캡처 blob 또는 붙여넣기 이미지). 확인되면 폴백 차이는 도달 불가이므로 안전하게 통일한다. **확인이 안 되면 이 항목을 스킵하고 사유를 남긴다.**
- 확인: `src/sidepanel/lib/__tests__/downloadCapture.test.ts`가 이미 export판 전 케이스를 고정한다. Asana 사본 삭제 후 이 테스트가 유일한 그물이 되므로 asana 제출 테스트에도 확장자 케이스 1건 추가.

### R7. background 번들이 계속 빌드되고 커진 곳이 없다 (🟡54·57 리스크)

`src/i18n/index.ts`에서 `useT`를 떼면 **`t()` 호출처 104개 중 컴포넌트가 아닌 곳**은 영향이 없어야 하고, 컴포넌트는 import 경로가 바뀐다. 반대로 `src/types/messages.ts`에서 `sendBg`·emitter를 옮기면 **`"@/types/messages"`를 import하는 104개 파일**이 영향권이다.

- 확인: `pnpm typecheck` — import 누락은 전량 컴파일 에러로 잡힌다(이 항목의 그물은 타입 체커다).
- 확인: `pnpm build` 후 `pnpm check:prearm` 통과. **content script 청크(`recorders-entry`)에 `src/content/` 밖 static import가 유입되면 pre-arm이 무음으로 죽는다** — `types/messages.ts`를 쪼갤 때 content 쪽 import가 새 파일을 타지 않는지 확인.
- 확인: `src/log-viewer/`가 재사용하는 공용 컴포넌트가 옮겨간 심볼을 쓰면 `pnpm build:log-viewer`가 깨진다.

### R8. `chrome.storage` 저장 포맷이 안 바뀐다 (🟡56 리스크 — 데이터 유실 위험)

`settings-storage.ts`의 write 함수 5개는 **필드 목록이 다르다**: jira/linear/gitlab/asana는 `accessToken`·`refreshToken`·`expiresAt`, github는 거기에 `tokenType`·`scope`가 더 있고 `refreshToken`·`expiresAt`에 `?? cur.X` 폴백이 붙는다. 제네릭화하며 이 차이를 뭉개면 **토큰 갱신 시 기존 필드가 지워진다** → 사용자가 재로그인해야 한다.

- 확인: read 8개는 순수 조회라 안전하게 테이블화 가능. **write 5개는 "필드 목록 + 폴백 여부"를 데이터로 들고 간다**(design.md 인터페이스).
- 확인: `src/lib/__tests__/settings-storage.test.ts`가 이미 존재한다 — write 5개 각각의 **저장 후 envelope 스냅샷**을 리팩터 전에 추가한다(P0 회귀 테스트 선행).
- 확인: jira의 legacy 폴백(`envelope?.state?.jiraConfig?.auth`, :45)은 **jira에만 있는 마이그레이션 경로**다. 테이블화하며 유실하지 않는다.

### R9. `confirmDraft`가 4개 captureMode에서 같은 레코드를 만든다 (🟡62 리스크)

공통 필드를 헬퍼로 뽑을 때 **분기 고유 필드가 헬퍼에 흡수되면 안 된다.** `saveDraft`는 **병합**이라(`editor-store.ts` 인근 주석: "조건부 스프레드로 키를 빼면 saveDraft 병합이 이전 selector를 살려낸다 — 항상 명시") 키를 조건부로 빼면 이전 값이 되살아난다. 헬퍼는 공통 필드만 만들고, 분기가 스프레드로 얹는 구조여야 한다.

- 확인: `src/store/__tests__/`의 editor-store 테스트에 **4 captureMode × saveDraft 인자 스냅샷**을 리팩터 전에 추가한다(P0).
- 확인: 리팩터 후 스냅샷이 문자 단위로 동일.

### R10. 데드 코드 삭제가 실제로 데드였다 (⚪107·108·110·102 리스크)

감사가 "사용처 0"이라 한 것들은 **감사 리포트 기재이지 검증된 사실이 아니다.** 특히:
- `src/store/blob-db.ts`는 background·sidepanel 양쪽에서 import된다.
- `src/lib/`의 것들은 log-viewer도 쓸 수 있다(`src/log-viewer/`는 별도 빌드).
- 테스트 파일에서만 쓰이는 export(⚪98 `element-locator.ts:166`)는 **삭제 대상이 아니라 주석 대상**이다.

- 확인: 삭제 전 `grep -rn "<심볼명>" src/ e2e/ scripts/`(테스트·e2e·스크립트 포함). 0건일 때만 삭제.
- 확인: `pnpm typecheck` + `pnpm test` + `pnpm build` + `pnpm build:log-viewer`.

### R11. 커버리지 로직 스코프가 하락하지 않는다 (🟡57·58 리스크)

`src/types/messages.ts`의 런타임 코드가 `src/lib/`으로 나가면 **지금까지 분모에서 빠져 있던 코드가 분모에 들어온다**. 테스트가 없으면 로직 스코프 라인 %가 떨어진다.

- 확인: 옮기는 코드(`sendBg`·에러 판독 4개·emitter 팩토리)에 **이동과 같은 PR에서** 테스트를 붙인다. `sendBg`는 `chrome.runtime.sendMessage` 목킹으로 node 트랙 테스트 가능하다.
- 확인: `pnpm coverage:report`로 이전 대비 비교. 하락하면 그 PR은 미완이다.

## 성공 기준

- `pnpm typecheck` + `pnpm test` green (각 PR마다).
- **회귀 테스트가 리팩터보다 먼저 들어갔다** — R1·R8·R9의 스냅샷 테스트가 해당 리팩터 커밋 **이전** 커밋에 존재한다(git 로그로 확인 가능).
- **`src/types/`에 `export class`·`export function`·`export const <값>`이 0건이다**(🟡57). `grep -n "^export \(class\|function\|const\)" src/types/*.ts`가 빈 결과이거나, 남은 것(`platform.ts`의 `PLATFORM_TAB_KEYS`·`CC_PREFIX`·`CC_SEPARATOR`)에 대한 판단이 문서화돼 있다.
- **`scripts/coverage-report.mjs:66`의 주석이 사실이다**(🟡58) — `src/types/` 제외 근거가 코드와 일치한다.
- **`sectionLabel`·`listItems`·`toUploadEntry`·`imageExtFromDataUrl`·`extractPath`의 정의가 각 1건이다** — `grep -c` 확인.
- **`inline-${` 하드코딩이 헬퍼 정의 1곳으로 줄었다**(🟡47).
- **`INLINE_REF_RE` 테스트가 존재하고, 패턴을 좁히면 깨진다**(🟡61) — 캡처 그룹 2개(alt·refId), 전역 플래그, 다중 매치, 중첩 괄호 케이스.
- **9번째 플랫폼 추가 시 커넥트 폼·토큰 저장 함수를 새로 쓰지 않는다**(🟡50·56) — 통합 컴포넌트 prop 1세트 + 테이블 1행으로 끝난다(시뮬레이션으로 확인 후 되돌린다).
- `pnpm build` 후 `pnpm check:prearm` 통과, `pnpm build:log-viewer` 통과.
- `pnpm coverage:report`에서 로직 스코프 라인 %가 베이스라인 대비 **하락하지 않는다**(57·61이 순수 모듈 + 테스트를 추가하므로 상승이 기대값).
- 회귀 감시 R1~R11 중 자동화 가능한 R1·R2·R3·R6·R7·R8·R9·R10·R11은 green, 수동 대상 R4(3플랫폼 × 2경로)·R5(6플랫폼 재연결)는 체크리스트 완료.
- **P0 그룹만 끝나도 배치가 유효하다** — P1·P2 미완이 P0를 되돌릴 이유가 되지 않는다.

## 가이드 영향

없음 — 사용자 노출 UX·동작 변화가 0이다.
