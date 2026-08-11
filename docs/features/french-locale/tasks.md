# 프랑스어 UI 로케일 (fr) — 구현 태스크

## 선행 조건

- **feature 브랜치에서 작업한다.** `dev`는 항상 green을 유지해야 하는데, `LOCALES`에 fr을 넣는 순간 1,001키를 다 채우기 전까지 red다(design.md "릴리스 전략").
- **이 브랜치에선 CI가 안 돈다** — `ci.yml` 트리거가 `push: [dev]` + `pull_request: [main]`뿐이고 `/merge`도 `gh run list --branch dev`를 본다. 로컬 `pnpm typecheck` + `pnpm test`가 유일한 게이트이고, CI는 dev로 합친 뒤 처음 돈다.
- **주 1회 이상 `dev`를 rebase한다.** 상류가 ko/en에 키를 append하면 git이 무음으로 자동머지하고 fr에만 키가 빠진다(design.md "상류 흡수"). 매 rebase 후 `pnpm test`로 parity를 확인하고 빠진 fr 키를 채운다.
- 권한·env·OAuth·외부 API 변경 **없음**. `manifest.config.ts`도 안 건드린다.
- **PostToolUse 훅 마찰을 미리 알아둘 것** — `.claude/settings.json`이 `src/i18n/` Edit마다 `locales.test.ts`를 돌리고 실패 시 차단한다. Task 4는 원자적이어야 하는데 편집은 파일 단위라 **중간 편집마다 훅이 red로 실패**하고, 매번 `pretest`의 `build:log-viewer` 풀 빌드가 붙는다. CLAUDE.md가 인정한 상황이니 **롤백하지 말고 끝까지 진행**한다.
- 착수 직후 Task 0을 먼저 확인할 것 — 이걸 놓치면 Task 4에서 원인 불명의 red를 만난다.

---

## Task 0: 미등록 로케일 픽스처 점검

- **변경 대상**: `src/i18n/__tests__/locale-registry.test.ts`
- **작업 내용**: 현재 이 파일이 **`fr`을 "등록되지 않은 로케일"의 예시로 쓰고 있다.** 실측한 두 줄은 fr 등록과 동시에 깨진다:
  - `:25` — `expect(normalizeLocale("fr")).toBe(DEFAULT_LOCALE)` → fr이 등록되면 `"fr"`을 그대로 돌려주므로 red
  - `:97` — `expect(detectLocale("fr-FR")).toBe(DEFAULT_LOCALE)` → `"fr"`로 매칭되므로 red

  둘 다 **미등록 코드로 교체**한다. 단언의 의도는 "미지 로케일은 기본값으로"이지 "프랑스어는 지원 안 함"이 아니므로, 값만 바꾸면 의미가 보존된다.

  **교체 값은 `:25`를 `"de"`, `:97`을 `"de-DE"`로 한다.** 문서 초안이 제안했던 `"ja"`·`"xx"`는 쓰지 말 것 — `:24`가 이미 `normalizeLocale("ja")`, `:98`이 이미 `detectLocale("ja")`, `:99`가 `"zh-CN"`, `:109`가 `"xx-YY"`라 **같은 `it` 블록 안에 동일 단언이 두 줄** 생기고, 구현자가 "중복이네" 하고 지울 공산이 크다. 게다가 `src/store/__tests__/settings-ui-store.test.ts:421`·`:430`·`:441`도 `"ja"`를 미등록 픽스처로 쓴다 — `"ja"`는 저장소 전반의 관용어라 **언젠가 ja를 등록하면 4개 파일이 동시에 깨진다.**

  교체한 줄에 주석 한 줄을 남긴다: *이 픽스처엔 앞으로도 등록 후보 언어를 쓰지 않는다.*

  **그대로 두는 줄 2개** (헷갈리기 쉬움):
  - `:68` — `matchLocaleTag("fr-fr", ["pt", "en"])`은 후보 배열이 하드코딩이라 fr 등록과 무관하게 green.
  - `:109` — round-trip 목록(`["ko-KR","en-US","fr","",undefined,"xx-YY"]`)은 "반환값은 항상 등록된 로케일"을 재는 단언이라 fr이 등록돼도 green이고, 오히려 fr 경로를 한 번 더 태우는 셈이다.
- **검증**:
  - [ ] `:25`·`:97`이 `"de"`·`"de-DE"`로 교체됨 (`:68`·`:109`는 무변경)
  - [ ] `npx vitest run src/i18n/__tests__/locale-registry.test.ts` green (fr 등록 **전** 상태에서도 통과해야 한다 — 교체한 코드가 지금도 미등록이므로)
  - > `pnpm test <path>`도 동작하지만 `pretest`가 붙어 **파일 하나만 돌려도 `vite build --config vite.log-viewer.config.ts`가 먼저 돈다.** 단일 파일 반복 실행엔 `npx vitest run`이 빠르다.

---

## Task 1: 메인 사전 8파일에 fr 추가 (875키)

- **변경 대상**: `src/i18n/namespaces/{common,app,issue,editor,integrations,settings,logs,ai}.ts`
- **작업 내용**: 각 파일에 `const fr = {...} satisfies Bundle;`을 추가하고 export를 `{ ko, en, fr }`로 바꾼다.
- **진행 방식**: **파일 하나씩, 작은 것부터** — `common`(29) → `ai`(29) → `app`(52) → `settings`(95) → `logs`(117) → `issue`(131) → `editor`(151) → `integrations`(271). 파일별로 커밋을 쪼갠다. `integrations` 271키는 플랫폼 단위(Jira / GitHub / Linear / Notion / GitLab / Asana / ClickUp / Slack)로 나눠 진행한다.

### 번역 브리프

- **원문은 en.** ko는 기준 키 집합 정의용이다(`BASE_LOCALE`).
- **레지스터는 vouvoiement 통일** — 존댓말 톤. ko/en의 어조와 맞춘다. 자동으로 못 잡으니 파일 안에서 일관되게.
- **번역하지 않는 것**:
  - 플랫폼 고유명사 `Jira`·`GitHub`·`Linear`·`Notion`·`GitLab`·`Asana`·`ClickUp`·`Slack`, 제품명 `BugShot`, 기술 약어 `CSS`·`URL`·`JSON`·`HTML`·`OAuth`·`Chrome`. ko 사전이 이미 그렇게 하고 있고, Task 5의 자동 가드가 이 축을 잰다.
  - **서드파티 UI 경로 문자열** — `Settings > Account > Security & Access > Personal API keys`, `Notion Settings > Integrations` 등. 사용자가 실제로 영어 UI에서 그 경로를 찾아야 하므로 번역하면 못 찾는다. **자동 가드가 없는 축이라 여기서 지키는 수밖에 없다.**
  - 자연스러운 프랑스어라면 떨어져 나갈 토큰이라도 **유지**한다. 실측 반례 3건: `logs.networkLog.search`(`Search URL & body…`) · `integrations.jira.error.404`(`check workspace URL or site`) · `issue.issueList.deleteAll.body`(`Only BugShot's list…`).
- **placeholder 토큰**(`{n}`·`{count}`·`{max}` 등)은 이름·개수를 그대로 유지한다.
- **문자 제약**: **U+202F(narrow no-break space)와 U+0178(Ÿ)을 쓰지 않는다.** Pretendard dynamic subset 92개 `unicode-range` 밖이라 시스템 폰트로 폴백한다. 프랑스어 조판 관례상 `: ; ? !` 앞과 « » 안쪽에 NNBSP를 넣는 AI 출력이 흔하니 후처리로 U+00A0 또는 일반 공백으로 바꾼다.
- **자수 제약** (레이아웃 — design.md "팽창 대응"):
  - `issue.mode.video` / `issue.mode.screenRecord` — `truncate`가 같은 지점에서 자르면 둘 다 `Enregistrer l'…`이 되어 구별 불가. **앞쪽에서 갈리는 문구**를 고른다(예: `Onglet` / `Écran`).
  - `platform.connected` — 연동 그리드 셀 텍스트 가용이 ≈108px이고 `grid-cols-2`라 셀이 못 커진다. `ClickUp connecté`가 이미 초과.
  - 3버튼 푸터 5곳의 버튼 라벨(design.md 표) — 짧게.
- **검증**:
  - [ ] `pnpm typecheck` — `Bundle` 타입이 키 누락을 잡으므로 0 에러면 8파일 모두 키가 완전하다
  - [ ] 이 시점엔 `pnpm test`가 여전히 green
  - > **왜 green인가**(재조사 방지): `locales.test.ts`는 `index.ts`의 `locales` 레지스트리만 본다. `locale-registry.test.ts`의 소스 스캔은 `readFileSync(.../locales.ts)` **단일 파일 하드코딩**이라 네임스페이스도 신규 `fr.ts`도 안 본다. `manifest-locales.test.ts`·`log-viewer/i18n.test.ts`는 `LOCALES` 순회다.

---

## Task 2: `src/i18n/fr.ts` 진입점

- **변경 대상**: `src/i18n/fr.ts` (신규)
- **작업 내용**: `src/i18n/en.ts`를 그대로 미러 — 8개 네임스페이스의 `.fr`을 spread하고 `export default fr satisfies TranslationMap`.
- **검증**:
  - [ ] `pnpm typecheck` 0 에러 (`TranslationMap` 불만족이면 여기서 걸린다)
  - [ ] `pnpm test` 여전히 green (아직 `index.ts`가 import하지 않음)

---

## Task 3: log-viewer 복제 사전 (122키 = 복사 85 + 신규 37)

- **변경 대상**: `src/log-viewer/i18n.ts`
- **작업 내용**: `frDict: Record<string, string>` 상수를 추가한다. **`DICTS`에는 아직 넣지 않는다**(Task 4와 원자적이어야 함 — `Record<LocaleMode, …>`라 fr이 `LOCALES`에 없으면 컴파일이 막힌다).

  **"메인의 부분집합"이 아니다.** 실측 내역:

  | 출처 | 키 수 | drift 대조 | 작업 |
  |---|---|---|---|
  | `logs` 네임스페이스 | 81 | ✅ 강제 | Task 1의 fr 값 **그대로 복사** |
  | `editor` 네임스페이스 | 4 | ✅ 강제 | 그대로 복사 |
  | `common` 네임스페이스 (`expand`·`collapse`·`clearSearch`) | 3 | ❌ | 사전 ①과 맞추되 테스트가 강제하지 않음 |
  | 어디에도 없음 (`logViewer.*` 20 · `timeline.*` 13 · `networkLog.marker.pending` · `networkLog.counter.captured`) | **34** | ❌ | **독립 번역** |

  `i18n.test.ts:155`의 `MAIN_NAMESPACES = [logs, editor]`이라 값 일치가 강제되는 건 85키뿐이다. **37키는 안 고쳐도 green이라는 게 더 위험하다** — 빠뜨리면 로그 뷰어의 그 표면만 조용히 폴백한다.
- **검증**:
  - [ ] `pnpm typecheck` 0 에러
  - [ ] `pnpm test` 여전히 green
  - [ ] 37키(common 3 + 독립 34)를 하나도 안 빠뜨렸는지 **눈으로** 확인 — 그물이 없다

---

## Task 4: 등록 스위치 — 한 커밋으로

**이 태스크는 쪼갤 수 없다.** 아래를 따로 넣으면 각각 red다(design.md "순서 제약").

- **변경 대상**:
  - `src/i18n/locales.ts` — `LOCALES = ["ko", "en", "fr"]`, `BCP47.fr = "fr-FR"`
  - `src/i18n/index.ts` — `import fr from "./fr"` + `locales.fr = fr`
  - `src/sidepanel/lib/aiLanguage.ts` — `LOCALE_AI_PRESET.fr = "French"`
  - `src/sidepanel/lib/localeLabels.ts` — `LOCALE_LABELS.fr = "Français"`
  - `src/log-viewer/i18n.ts` — `DICTS.fr = frDict`
  - `public/_locales/fr/messages.json` (신규) — `EXT_NAME`·`EXT_NAME_SHORT`(=`BugShot` 그대로)·`EXT_DESCRIPTION`·`CMD_TOGGLE_PANEL`
  - `src/i18n/__tests__/manifest-locales.test.ts` — 길이 단언 추가
  - `src/sidepanel/lib/__tests__/localeLabels.test.ts` — 회귀 핀에 `Français` 한 줄
- **`_locales/fr/` 생성 순서 주의**: `findExtraneous`는 `readdirSync(localesDir)`로 **디스크를 스캔**하므로 **디렉터리가 존재하는 것만으로** red다(파일 내용 무관). 원자 커밋 안에서도 파일 생성이 중간 테스트·훅에 노출되니, `LOCALES`를 먼저 고친 뒤 디렉터리를 만든다.
- **길이 예산 (Chrome 강제 — 반드시 지킬 것)**: `EXT_DESCRIPTION` **≤ 132자**, `EXT_NAME` ≤ 75자. 현재 en `EXT_DESCRIPTION`이 **131자**(여유 1자)라 프랑스어 직역은 확실히 초과하고, **확장 로드 실패 또는 CWS 업로드 거부**로 이어진다. fr은 en 직역이 아니라 **길이에 맞춘 별도 카피**를 쓴다.
- **폴백 허용 테이블은 건드리지 않는다** (`SECTION_DESC_BASE`·`MODE_HINTS`·`EXPECTED_SPLIT_HINT`·`SECTION_DESC`·`MONTH_STYLE`·`USER_GUIDE_URLS`). 컴파일러가 요구하지도 않는다.
- **검증**:
  - [ ] `pnpm typecheck` 0 에러 — 폴백 금지 5개가 전부 채워졌다는 증거
  - [ ] `pnpm test` 전체 green — 사전 세 벌 대칭·빈 값 0·placeholder 일치
  - [ ] `locales.test.ts`의 "LOCALES의 모든 코드가 실제 사전을 갖는다"·"BCP47이 모든 등록 로케일을 커버한다" green
  - [ ] `manifest-locales.test.ts`의 커버리지·`findExtraneous` green
  - [ ] **신규 길이 단언 green** — `EXT_DESCRIPTION` ≤132 · `EXT_NAME` ≤75 · `EXT_NAME_SHORT === "BugShot"`(제품명 보존 핀)
  - [ ] `log-viewer/__tests__/i18n.test.ts`의 "메인 테이블과 공통인 키는 값도 일치" green (복제 사전 drift 0)

---

## Task 5: 고유명사 보존 가드

- **변경 대상**: `src/test/proper-nouns.ts`(신규) · `src/test/__tests__/proper-nouns.test.ts`(신규) · `src/i18n/__tests__/proper-nouns.test.ts`(신규)
- **작업 내용**: 사람 검수를 안 하기로 한 결정을 메우는 자동 가드. **`src/test/locale-parity.ts` 패턴을 그대로 따른다** — 순수 검사기를 `src/test/`에 두고, 합성 픽스처로 검사기 자체를 red/green 고정한 뒤, 실사전에 적용한다.

  ```ts
  // src/test/proper-nouns.ts
  export function findProperNounViolations(
    registry: LocaleRegistry,
    nouns: readonly string[],
  ): string[];
  ```

  - 판정: 어떤 키의 **ko와 en 값이 둘 다** 고유명사 N을 포함하면, 같은 키의 다른 등록 로케일 값도 N을 포함해야 한다. ko/en 중 한쪽에만 있으면 검사 제외.
  - **fr 전용으로 짜지 말 것** — `LocaleRegistry` 인자형으로 만들어 다음 로케일에서 재사용한다.
  - **사전 세 벌 전부에 적용**: `locales`(①) · `DICTS`(②, 같은 레지스트리 모양) · `_locales` 파생(③). ③엔 `BugShot`이 들어 있고 **그 값이 웹스토어 등록정보로 나간다.**
  - 목록에서 **`HTML`을 뺀다** — ko/en 어디에도 없어(유일한 등장은 `logs.html` 소문자) 영구히 아무것도 단언하지 않는 죽은 항목이다.

  ```ts
  const PROPER_NOUNS = [
    "Jira", "GitHub", "Linear", "Notion", "GitLab", "Asana", "ClickUp", "Slack",
    "BugShot", "Chrome", "OAuth", "CSS", "URL", "JSON",
  ];
  ```

  - **알려진 한계를 주석으로 남길 것**(다음 사람이 과신하지 않게): 98쌍 중 20쌍은 ko값=en값=토큰이라 vacuous(복붙 통과) · `cURL`이 `URL`을 우연 만족 · ko∩en 필터가 실제로 거르는 건 98쌍 중 1쌍뿐 · **서드파티 UI 경로 문자열은 이 가드 밖**(번역 브리프 소관).
- **검증**:
  - [ ] `src/test/__tests__/proper-nouns.test.ts` — 깨진 합성 레지스트리(`{ko:{k:"Jira 연결"}, en:{k:"Connect Jira"}, fr:{k:"Connecter Logiciel"}}`)로 **검사기가 위반을 잡는다** + 온전한 픽스처로 green. 그물이 공허하지 않다는 증거가 커밋에 남는다.
  - [ ] `src/i18n/__tests__/proper-nouns.test.ts` — 실사전 세 벌 전부 green
  - [ ] `pnpm test` green

---

## Task 6: e2e — 언어 셀렉터 + 기존 spec 로케일 내성

- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`(testid 2개) · `e2e/settings-language.spec.ts`(신규) · `e2e/code-block-collapse.spec.ts` · `e2e/COVERAGE.md`
- **작업 내용**:

  **(a) testid 2개** — e2e 규율상 src 변경은 testid까지만 허용.
  - `SettingsTab.tsx:68`의 General `TabsTrigger`에 `data-testid="settings-sub-general"`. **현재 testid는 `settings-sub-issue` 하나뿐이고 general 서브탭에 진입하는 spec이 0개다.** Radix `TabsTrigger`는 DOM에 `value`를 안 남기고 라벨은 `t("settings.tab.general")`이라, 라벨 텍스트 클릭은 `GOTCHAS.md:46`(i18n 텍스트 의존 금지)·`:75`(locale 비결정) 이중 위반이다.
  - `SettingsTab.tsx:282`의 언어 `SelectTrigger`에 `data-testid="settings-language"`.

  **(b) `e2e/settings-language.spec.ts`** — 설정 탭 → 일반 서브탭 진입 후 셀렉터를 열어 옵션이 **3개**이고 텍스트가 `한국어 · English · Français` **순서**인지 단언.
  - 진입 패턴은 `e2e/settings-sections.spec.ts`의 hydration 폴링(`expect(async () => { click; toHaveAttribute("data-state","active") }).toPass()`)을 복제.
  - **옵션 목록을 열어 읽기만 하고 선택하지 않는다.** `ext` fixture가 `{ scope: "worker" }` + `workers: 1`이라 한 샤드의 모든 spec이 하나의 프로필·`chrome.storage`를 공유한다 — `Français`를 실제로 고르고 복원하지 않으면 **후속 spec 전부가 fr UI로 돈다**(`settings-sections.spec.ts:63-65`가 `finally` 복원을 쓰는 이유). 굳이 선택해야 하면 `finally`에서 원래 로케일로 되돌린다.
  - **트리거(`SelectValue`) 텍스트는 단언하지 않는다** — 영속 로케일에 좌우돼 비결정이다(GOTCHAS:75). 열린 목록의 `SelectItem`만 잰다.
  - **옵션 라벨 단언은 GOTCHAS의 "locale 비결정" 금지에 걸리지 않는다** — 자기 언어 표기(endonym)라 현재 앱 로케일과 무관하게 같은 문자열이다. spec 주석에 그 근거를 남길 것.

  **(c) `code-block-collapse.spec.ts`를 속성 판정으로 전환** — `:10-11`이 ko|en 교대 정규식(`/^(펼치기 \(36줄\)|Expand \(36 lines\))$/`)이고 `:146`·`:148`도 `not.toContain("펼치기")`다. 앱 locale은 `--lang=ko`로 확정되지 않고 워커 프로필 `navigator.language`를 탄다(GOTCHAS:75) — **fr 등록 전에는 `fr-*` 머신도 en으로 떨어져 우연히 green이었지만, 등록 후엔 `fr`로 hydrate돼 안 맞는다.** CI(ubuntu, en_US)는 통과하고 로컬에서만 터지는 최악의 형태다. `data-collapsed` 속성 판정으로 바꾼다(GOTCHAS:96이 이미 "locale 무관 속성이라 안전"하다고 적어둔 축).

  **(d) `e2e/COVERAGE.md`** — `settings-language.spec.ts` 행 추가.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e --grep settings-language` green
  - [ ] `pnpm test:e2e --grep code-block-collapse` green (전환 후)
  - [ ] `LOCALE_LABELS`에서 fr 라벨 문자열을 임시로 바꾸면 spec이 red
  - [ ] 언어 spec 실행 **후** 다른 spec을 이어 돌려도 로케일이 오염되지 않음

---

## Task 7: 팽창 대응 + 날짜 그물

- **변경 대상**: `IssueTab.tsx`(ReplayButton) · `IssueListTab.tsx` · 3버튼 푸터 5곳 · `formatTimestamp.test.ts` · `issueListUtils.test.ts`
- **작업 내용**:

  **(a) 구조적 안전판** (design.md "팽창 대응" 표):
  - `IssueTab.tsx`의 `ReplayButton` 라벨을 `<span className="truncate">`로 감싼다. 캡처 5버튼 중 **유일하게** raw 텍스트라 잘림이 아니라 옆 버튼 위로 겹친다.
  - `SettingsFooter.tsx:13` · `PreviewPanel.tsx:415` · `StyleEditorPanel.tsx:545` · `DraftingPanel.tsx:486` · `DraftDetailDialog.tsx:955`의 3버튼 푸터에 `flex-wrap`을 허용한다. 이들은 `DialogFooter`의 `flex-col-reverse sm:flex-row` 안전판을 `flex-row`로 명시 해제한 곳이다.
  - `IssueListTab.tsx:111`의 `TabsList`를 `<div className="min-w-0 overflow-x-auto">`로 감싼다(console/network/action 3곳엔 이미 있다).

  **(b) 날짜·시각 테스트를 `LOCALES` 순회로 전환**:
  - `formatTimestamp.test.ts` — `dateBcp47` 가변 mock + en/ko **2케이스 하드코딩**을 레지스트리 순회로 바꾼다.
  - `issueListUtils.test.ts` — `dateLabel`의 ko(`"1월"`)/en(`"Jan"`) 리터럴을 순회형으로. 기대값 테이블을 로케일별로 두되 `LOCALES`에 새 코드가 들어오면 컴파일/테스트가 지목하게 한다.
  - 이유: `docs/POSTMORTEM.md:786` 재발 방지 (2)가 **"로케일 의존 포맷 함수 테스트는 en 하나로 끝내지 않는다"**이고, `formatTimestamp.ts:20` 주석의 ko 회귀가 정확히 이 축이다. design.md가 "실측 확인함"이라 주장한 `15 janv. 2026`을 고정하는 테스트가 현재 없다.
- **검증**:
  - [ ] `pnpm test` green — 순회 전환 후 ko/en 기대값이 그대로 통과
  - [ ] fr 기대값(`janv.` 등)이 실제로 단언된다
  - [ ] `pnpm typecheck` 0 에러

---

## Task 8: 문서 갱신

- **변경 대상**: 아래 목록
- **작업 내용**: fr 추가로 stale이 되는 문서를 전부 갱신한다. **문서별 별도 커밋**(`docs(README): ...` / `docs(CLAUDE): ...` …).
  - `README.md:192` (`**i18n** — Korean / English`) · `README.ko.md:185` (`**다국어** — 한국어 / 영어`) — **같은 커밋에서 양쪽 함께**(en 원본 ↔ ko 번역 대칭 규칙).
  - `CLAUDE.md:151` — "**사전은 두 벌이다** — `koDict`/`enDict` 복제 사전", "ko/en 대칭·placeholder … 대조" 서술.
  - `docs/ARCHITECTURE.md:256` — "손복제 `koDict`/`enDict`".
  - `docs/DIRECTORY.md:99-101` — "다국어 (ko/en 로케일…)", "`ko.ts`/`en.ts`는 … 진입점"(fr.ts 누락), 폴백 금지 5개·사전 셋 서술. `:121`의 `log-viewer.spec.ts … ko/en`도 대조.
  - `.claude/settings.json:19` — `statusMessage: "i18n ko/en 대칭 검사"`.
  - **`AGENTS.md`·`.agents/skills/`는 직접 편집하지 않는다** — `CLAUDE.md` 편집 시 PostToolUse 훅이 `pnpm sync:agents`를 돌려 재생성한다. **CLAUDE.md를 먼저 고치고** 미러가 갱신됐는지 확인할 것(`/push`의 `sync:agents:check` 게이트에 걸린다).
  - **가이드 사실오류 수정** — `guide/ko/settings/general.md`와 `guide/en/settings/general.md`의 `:9`("한국어와 English 중에서 선택할 수 있어요")와 `:11`("사용 가이드도 언어에 맞춰 열립니다" — **S3 무표시 en 폴백과 정면 모순**). 번역은 안 하지만 기존 본문의 거짓말은 고친다. 작성 전 `guide/AUTHORING.md`를 읽을 것.
  - **스크린샷 재촬영** — `guide/{ko,en}/assets/settings-general-1.jpg`가 옵션 2개라 stale. `/guide-shots`로 다시 찍는다.
- **검증**:
  - [ ] `pnpm sync:agents:check` 통과
  - [ ] README ko/en이 같은 내용·같은 섹션 구성
  - [ ] 가이드 `:9`·`:11`이 실제 동작과 일치(옵션 3개 / 가이드는 en 폴백)
  - [ ] 스크린샷에 `Français`가 보인다

---

## Task 9: 회귀 확인

- **변경 대상**: 없음 (확인만)
- **작업 내용**: ko/en 동작이 한 바이트도 안 바뀌었는지 확인한다.
- **검증**:
  - [ ] `pnpm test` 전체 green — 특히 `prompts/__tests__/draftRich.test.ts`·`buildAiDraftPrompt.test.ts`(프롬프트 출력 불변)
  - [ ] `pnpm typecheck` 0 에러
  - > `pnpm test`의 `pretest`가 `build:log-viewer`를 재빌드하므로 **복제 사전이 산출물에 실리는지는 자동 검증된다.** `pnpm build`·`pnpm check:prearm`은 돌리지 않는다 — 전자는 `pretest`·`typecheck`가 이미 커버하는 데다 CLAUDE.md "빌드는 자동 실행하지 않는다"와 충돌하고, 후자는 i18n과 무관하며 `dist/manifest.json`(직전 빌드 산출물)을 읽어 무의미한 green을 낸다.
  - [ ] **커버리지 베이스라인을 래칫하지 않는다.** fr 데이터 ≈+1,016줄(네임스페이스 875 + `fr.ts` 19 + `frDict` 122)이 **전부 covered로** 들어와 로직 스코프가 74.28% → ~75.5%로 자동 상승한다(사전 파일은 이미 100% 계상). 여기서 `pnpm coverage:update`를 돌리면 이후 실제 로직 커버리지가 1%p 떨어져도 감지되지 않는다.

---

## 테스트 계획

**단위 테스트**
- 기존 그물이 fr을 자동으로 검사한다(변경 불필요): `locales.test.ts`(레지스트리 순회 대칭·커버리지·BCP47) · `log-viewer/__tests__/i18n.test.ts`(복제 사전 + drift) · `manifest-locales.test.ts`(세 번째 사전 + `__MSG_`/`chrome.i18n` 참조). 검사기 본체는 `src/test/locale-parity.ts`이고 `src/test/__tests__/locale-parity.test.ts`가 그 비공허성을 고정한다.
- 추가: `proper-nouns` 검사기 + 실사전 적용(Task 5) · `manifest-locales.test.ts` 길이 단언(Task 4) · `localeLabels.test.ts` `Français` 회귀 핀(Task 4).
- 전환: `formatTimestamp.test.ts`·`issueListUtils.test.ts`를 `LOCALES` 순회로(Task 7).

**e2e 시나리오** (`/e2e-write` 입력)
- 설정 > 일반의 화면 언어 셀렉터를 열면 옵션이 `한국어 · English · Français` 3개가 그 순서로 나온다.
- `code-block-collapse`의 펼치기/접기 판정이 라벨 텍스트가 아니라 `data-collapsed` 속성으로 이뤄진다.

**수동 테스트** (자동화 불가 — 레이아웃·실브라우저). **기준 폭 400px.** 잘림(`truncate`)은 허용하되 오버플로는 금지.
- [ ] **캡처 진입 화면 버튼 5개** — 4개는 `truncate`, `ReplayButton`은 Task 7 수정 후 확인. 오버플로 없음
- [ ] **탭 녹화 / 화면 녹화 두 라벨이 서로 구별된다**(같은 지점에서 잘려 `Enregistrer l'…`이 되지 않는다)
- [ ] **3버튼 푸터 5곳** — `StyleEditorPanel`(최악) · `PreviewPanel` · `DraftDetailDialog`(콘텐츠폭 312px) · `SettingsFooter` · `DraftingPanel`. wrap은 허용, 겹침·잘림 금지
- [ ] **연동 카드 — 연결됨 상태**. 미연결 화면만 보고 통과시키지 말 것(브랜드명뿐이라 안전하다)
- [ ] **탭 바** — `CollapsingTabsList`는 트리거 하나만 넘쳐도 **전 탭 라벨을 동시에 숨긴다**. fr에서 라벨이 통째로 사라지는지 확인(오버플로가 아니라 전소실이 실패 모드). 특히 설정 탭(`grid-cols-3`)
- [ ] **이슈 목록 필터 바** — Task 7의 `overflow-x-auto` 래퍼 적용 후 가로 스크롤로 접근 가능한지
- [ ] `chrome --lang=fr --user-data-dir=$(mktemp -d)`로 새 프로필을 띄우고 `dist`를 unpacked 로드 → **`chrome://extensions`의 확장 이름·설명이 프랑스어** + **첫 실행이 프랑스어로 뜬다** (한 프로필에서 둘 다 확인)
- [ ] fr 상태에서 이슈를 제출해 `logs.html`을 받고, **프랑스어 브라우저로 열면 프랑스어로 보인다** — 복제 사전이 `dist-log-viewer/index.html`에 실렸다는 **유일한 증거**다(`buildLogsHtml.test.ts`가 `?raw` import를 mock으로 대체해 유닛 테스트가 0개)
- [ ] 같은 `logs.html`을 **영어 브라우저**로 열면 영어로 보인다(리포터 로케일 미박제)
- [ ] fr 상태에서 가이드 버튼 → 영어 페이지로 이동(무표시 폴백, 의도된 동작)
- [ ] AI 작성 언어 `자동` + fr + **직접 연결한 LLM** → 초안이 프랑스어 (내장 AI면 영어가 정상)
- [ ] fr 타임스탬프·날짜 표기가 깨지지 않음(`15 janv. 2026`, `15/01/2026 14:03:07`)
- [ ] 번역 검수는 하지 않는다(PRD "품질 정책"). 다만 **명백한 깨짐**(문장이 잘림·키 문자열 노출·플레이스홀더 리터럴 `{n}` 노출·글리프 폴백)만 훑는다

---

## 구현 순서 권장

```
Task 0 (픽스처 점검)
   ↓
Task 1 (메인 사전 875키) ──┐   ← 파일별 분할 커밋. 작은 파일부터
Task 2 (fr.ts 진입점)      │   ← Task 1 완료 후
Task 3 (log-viewer 122키)  ┘   ← Task 1의 값을 가져오므로 Task 1 이후
   ↓
Task 4 (등록 스위치 — 원자적 1커밋)   ← 여기서 처음 fr이 검사 대상이 된다
   ↓
Task 5 (고유명사 가드) ─┬─ 병렬 가능
Task 6 (e2e) ───────────┤
Task 7 (팽창 + 날짜)  ──┘
   ↓
Task 8 (문서) → Task 9 (회귀 확인)
```

Task 1이 전체 공수의 대부분이다. Task 2·3은 Task 1에 의존하고, Task 4는 1·2·3 전부에 의존한다. Task 5·6·7은 Task 4 이후 서로 독립이다. Task 7의 레이아웃 수정은 수동 확인 **전에** 끝내둔다(안전판을 먼저 치고 나서 확인하는 순서).

## 가이드 영향

**있다** — 번역은 안 하지만 기존 본문이 거짓이 된다. Task 8 참조.

- `guide/{ko,en}/settings/general.md:9` — 지원 언어를 2개로 못 박고 있다.
- 같은 파일 `:11` — "사용 가이드도 언어에 맞춰 열립니다"가 **S3(무표시 en 폴백)와 정면 모순**이다.
- `guide/{ko,en}/assets/settings-general-1.jpg` — 옵션 2개 스크린샷. `/guide-shots`로 재촬영.

`guide/fr`은 만들지 않는다(PRD 비목표). `USER_GUIDE_URLS`가 폴백 허용 테이블이라 fr → en 가이드로 가는 게 코드에 이미 반영돼 있다.
