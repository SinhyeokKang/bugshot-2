# 프랑스어 UI 로케일 (fr) — 기술 설계

## 개요

새 로직은 거의 없다. `LOCALES`에 `"fr"`을 넣으면 `LocaleMode`가 파생 확장되고, 폴백 금지 5개 테이블이 컴파일 에러로 자기를 지목하며, 대칭 테스트가 사전 세 벌의 누락을 잡는다. 실제 작업의 95%는 **번역 데이터 입력**이고, 설계가 정할 것은 **어떤 순서로 넣어야 중간 상태가 red가 되지 않는가**와 **사람 검수를 안 하는 대신 무엇을 자동으로 막는가** 둘이다.

## 변경 범위

### 사전 ① 메인 (875키)

| 파일 | 현재 | 변경 |
|---|---|---|
| `src/i18n/namespaces/{common,app,issue,editor,integrations,settings,logs,ai}.ts` | 각 파일이 `const ko` → `type Bundle = Record<keyof typeof ko, string>` → `const en satisfies Bundle` → `export const X = { ko, en }` | `const fr = {...} satisfies Bundle` 추가 + export를 `{ ko, en, fr }`로 |
| `src/i18n/fr.ts` (신규) | — | `en.ts`를 그대로 미러 — 8개 네임스페이스의 `.fr`을 spread하고 `satisfies TranslationMap` |

키 배분: `integrations` 271 · `editor` 151 · `issue` 131 · `logs` 117 · `settings` 95 · `app` 52 · `ai` 29 · `common` 29.

`Bundle` 타입이 `keyof typeof ko`라 **키를 하나라도 빠뜨리면 그 파일에서 컴파일이 막힌다.** 대칭 테스트 이전에 타입이 먼저 잡는다.

### 사전 ② log-viewer 복제 (122키)

| 파일 | 변경 |
|---|---|
| `src/log-viewer/i18n.ts` | `frDict: Record<string, string>` 추가 + `DICTS`에 `fr: frDict` |

`DICTS`는 `Record<LocaleMode, …>`라 **fr이 `LOCALES`에 들어간 뒤에만** 엔트리를 넣을 수 있다(순서 제약 — 아래 참조).

**"메인 사전의 부분집합"이 아니다.** 실측 내역:

| 출처 | 키 수 | drift 대조 대상 | 값 조달 |
|---|---|---|---|
| `logs` 네임스페이스 | 81 | ✅ | 사전 ①에서 그대로 복사 |
| `editor` 네임스페이스 | 4 | ✅ | 사전 ①에서 그대로 복사 |
| `common` 네임스페이스 | 3 (`expand`·`collapse`·`clearSearch`) | ❌ | 사전 ①과 맞추되 강제되지 않음 |
| 어느 메인 사전에도 없음 | **34** (`logViewer.*` 20 · `timeline.*` 13 · `networkLog.marker.pending` · `networkLog.counter.captured`) | ❌ | **독립 번역** |

`i18n.test.ts:155`의 `MAIN_NAMESPACES = [logs, editor]`이므로 값 일치가 강제되는 건 **85키뿐이고, 37키(30%)는 어떤 그물도 값을 검증하지 않는다.** Task 3의 공수를 "복사 85 + 신규 37"로 잡는다.

### 사전 ③ manifest `_locales` (4키)

| 파일 | 변경 |
|---|---|
| `public/_locales/fr/messages.json` (신규) | `EXT_NAME` · `EXT_NAME_SHORT` · `EXT_DESCRIPTION` · `CMD_TOGGLE_PANEL` |

`EXT_NAME_SHORT`는 `BugShot` 그대로 둔다(제품명). `manifest.config.ts`는 **변경 없다** — `default_locale: "en"` 유지.

**길이 예산 (Chrome 강제).** `description` **≤ 132자**, `name` ≤ 75자. 현재 en `EXT_DESCRIPTION`이 **131자**로 여유 1자이고 ko는 94자다. 프랑스어를 직역하면 150~157자가 되어 **확장 로드 실패 또는 CWS 업로드 거부**로 이어진다. 저장소에 이걸 잡는 테스트가 **현재 0건**이라 `typecheck`·`test` 모두 green으로 통과한 뒤 스토어에서 터진다 — 그래서 fr은 en 직역이 아니라 **길이에 맞춘 별도 카피**를 쓰고, 동시에 `manifest-locales.test.ts`에 길이 단언을 넣는다(신규 로케일마다 재발하는 축이라 자동 가드가 맞다).

### 레지스트리 + 폴백 금지 5개

| 파일 | 변경 |
|---|---|
| `src/i18n/locales.ts` | `LOCALES = ["ko", "en", "fr"]` · `BCP47.fr = "fr-FR"` |
| `src/i18n/index.ts` | `locales.fr = fr` (신규 `./fr` import) |
| `src/sidepanel/lib/aiLanguage.ts` | `LOCALE_AI_PRESET.fr = "French"` — `AI_LANGUAGE_OPTIONS`에 이미 있는 값이라 새 프리셋 추가 불필요 |
| `src/sidepanel/lib/localeLabels.ts` | `LOCALE_LABELS.fr = "Français"` (자기 언어 표기) |
| `src/log-viewer/i18n.ts` | `DICTS.fr` (위 ②) |

옵션 순서는 `LOCALES` 배열 순 = **등록 순**이다(사용 비중 순이 아니다). 4번째 로케일도 배열 끝에 붙인다.

### 팽창 대응 (레이아웃)

프랑스어는 en 대비 15~20% 길다. 수동 확인 전에 **구조적 안전판을 먼저** 친다.

| 파일 | 변경 | 이유 |
|---|---|---|
| `src/sidepanel/tabs/IssueTab.tsx` (`ReplayButton`) | 라벨을 `<span className="truncate">`로 감싼다 | 캡처 5버튼 중 유일하게 raw 텍스트. `Button` base에 `whitespace-nowrap`만 있고 `overflow-hidden`이 없어 **잘림이 아니라 옆 버튼 위로 겹친다** |
| `SettingsFooter.tsx` · `PreviewPanel.tsx` · `StyleEditorPanel.tsx` · `DraftingPanel.tsx` · `DraftDetailDialog.tsx` | 3버튼 푸터에 `flex-wrap` 허용 | 아래 표 참조 |
| `src/sidepanel/tabs/IssueListTab.tsx` | `TabsList`를 `<div className="min-w-0 overflow-x-auto">`로 감싼다 | console/network/action 3곳은 이미 이 래퍼가 있는데 여기만 없다 |

**실측 위험 지점 (400px 기준).** `DialogFooter`의 기본값은 `flex-col-reverse sm:flex-row`이고 `sm:`(640px)은 사이드패널에서 절대 발동하지 않으므로 **기본 상태는 자동 세로 스택 = 안전**하다. 그런데 코드베이스가 이 보호를 **19곳에서 `flex-row`/`!flex-row`로 명시 해제**했다. 진짜 위험은 그 중 `justify-between` + `whitespace-nowrap` + `flex-wrap` 0건인 3버튼 푸터다:

| 파일:라인 | 버튼 | fr 추정 폭 | 가용 |
|---|---|---|---|
| `StyleEditorPanel.tsx:545` | Cancel editing / Review changes / Next | ≈439px | 368px |
| `PreviewPanel.tsx:415` | New issue / Back / Submit issue | ≈420px | 368px |
| `DraftDetailDialog.tsx:955` | Delete issue / Close / Submit issue | ≈404px | **312px** |
| `SettingsFooter.tsx:13` | Guide / Contact / Review | en에서 이미 한계선 | 368px |
| `DraftingPanel.tsx:486` | Cancel editing / Back / Issue preview | 경계 | 368px |

**제출 다이얼로그(`SubmitFieldsDialog.tsx:327`)는 오히려 안전하다** — 2버튼 ≈205px / 312px. 초기 위험 목록이 지목한 곳이지만 실측에서 빠졌다.

**연동 그리드의 "연결됨" 라벨**은 코드가 아니라 번역으로 푼다. `IntegrationsTab.tsx:179`가 `grid-cols-2 max-w-[336px]`라 셀 텍스트 가용이 ≈108px이고, `grid-cols-2`는 `minmax(0,1fr)`라 셀이 못 커진다. `t("platform.connected", {platform})`을 fr에서 짧게 쓴다(`ClickUp connecté`가 초과). 같은 마크업이 `connect/*ConnectForm.tsx` 8파일에 복제돼 있어 코드 수정 비용이 크다.

**두 녹화 모드 라벨**은 자수 제약을 둔다. `issue.mode.video` / `issue.mode.screenRecord`가 `Enregistrer l'onglet` / `Enregistrer l'écran`이면 `truncate`가 둘 다 `Enregistrer l'…`로 잘라 **구별이 불가능**해진다. `CONTENT_MAX_W = "max-w-[336px]"`는 패널 폭과 무관한 고정 상한이라 패널을 넓혀도 안 풀린다. 앞쪽에서 갈리는 문구를 고른다(예: `Onglet` / `Écran`).

### 폴백 허용 — 손대지 않음

`SECTION_DESC_BASE`·`MODE_HINTS`·`EXPECTED_SPLIT_HINT`(`draftRich.ts`) · `SECTION_DESC`(`draftCompact.ts`) · `MONTH_STYLE`(`issueListUtils.ts`) · `USER_GUIDE_URLS`(`external-links.ts`) 전부 **fr 엔트리를 만들지 않는다.** `LocaleTable<T>`이 `en`만 필수라 컴파일이 요구하지도 않는다.

근거는 축마다 다르다:
- 프롬프트 4개 — 영어 스캐폴딩이 설계이고 언어는 `Write in French` 한 줄이 옮긴다(CLAUDE.md "AI 출력 언어").
- `MONTH_STYLE` — en 폴백 `short`가 `15 janv. 2026`. 실측 확인함.
- `USER_GUIDE_URLS` — 가이드를 번역하지 않기로 했으므로 en 폴백이 **의도된 결과**다.

### 테스트

| 파일 | 변경 |
|---|---|
| `src/test/locale-parity.ts` | **변경 없음** — `findExtraneous`·`findUncovered`·`findParityViolations`·`placeholderTokens`의 실제 소재지. `locales.test.ts`·`log-viewer/i18n.test.ts`·`manifest-locales.test.ts` 셋이 공유한다 |
| `src/test/__tests__/locale-parity.test.ts` | **변경 없음** — 3번째 로케일(`ja`) 합성 픽스처로 검사기 자체의 비공허성을 고정. 신규 가드도 이 형태를 따른다 |
| `src/i18n/__tests__/locales.test.ts` | **변경 없음** — 레지스트리를 순회하므로 fr이 자동으로 검사 대상 |
| `src/log-viewer/__tests__/i18n.test.ts` | **변경 없음** — `LOCALES` 순회 |
| `src/i18n/__tests__/manifest-locales.test.ts` | **길이 단언 추가** — `EXT_DESCRIPTION` ≤132 · `EXT_NAME` ≤75 · `EXT_NAME_SHORT === "BugShot"` |
| `src/sidepanel/lib/__tests__/localeLabels.test.ts` | 회귀 핀에 `Français` 한 줄 추가 |
| `src/i18n/__tests__/locale-registry.test.ts` | "등록되지 않은 로케일" 픽스처에서 `fr`을 미등록 코드로 교체 (Task 0) |
| `src/sidepanel/lib/__tests__/formatTimestamp.test.ts` | en/ko 2케이스 하드코딩 → **`LOCALES` 순회로 전환** |
| `src/sidepanel/tabs/__tests__/issueListUtils.test.ts` | `dateLabel`의 ko/en 리터럴 → **`LOCALES` 순회로 전환** |
| `src/test/proper-nouns.ts` + `src/test/__tests__/proper-nouns.test.ts` (신규) | 검사기 + 합성 픽스처 |
| `src/i18n/__tests__/proper-nouns.test.ts` (신규) | 실사전 적용 |
| `e2e/settings-language.spec.ts` (신규) | 셀렉터 옵션 3개 |
| `e2e/code-block-collapse.spec.ts` | ko\|en 교대 정규식 → `data-collapsed` 속성 판정 |

`src/sidepanel/tabs/SettingsTab.tsx`도 변경 대상이다(e2e testid 2개 — `settings-sub-general`, `settings-language`).

> `locale-registry.test.ts`의 미등록 로케일 픽스처는 **반드시 확인할 것.** 실증 과정에서 `"ja"`를 임시 등록했을 때 정확히 그 두 케이스가 깨졌던 전례가 있다.

### 날짜·시각 포맷 — LOCALES 순회로 전환하는 이유

`BCP47.fr = "fr-FR"`은 폴백 금지 테이블이라 `toLocaleString` 전반에 영향을 준다. 그런데 현재 그물이 없다:

- `formatTimestamp.test.ts`는 `dateBcp47`를 가변 mock으로 두고 **en/ko 2케이스를 하드코딩**한다. `LOCALES` 순회가 아니다.
- `issueListUtils.test.ts`는 `dateMonthStyle`만 순회하고 `dateLabel`은 ko(`"1월"`)/en(`"Jan"`) 실 ICU 출력을 하드코딩한다. 위에서 "실측 확인함"이라 쓴 `15 janv. 2026`을 고정하는 테스트가 **어디에도 없다.**

`docs/POSTMORTEM.md:786`의 재발 방지 (2)가 **"로케일 의존 포맷 함수 테스트는 en 하나로 끝내지 않는다"**이고, `formatTimestamp.ts:20` 주석이 기록한 ko 회귀(`timeZoneName` 옵션이 시간 스켈레톤을 바꿔 콜론 포맷이 깨짐)가 정확히 이 축이다. 두 테스트를 순회형으로 바꾸면 fr뿐 아니라 다음 로케일도 자동으로 덮인다.

## 순서 제약 — 중간 상태가 red가 되는 지점

**`public/_locales/fr/`와 `DICTS.fr`와 `LOCALES += "fr"`는 한 커밋이어야 한다.**

- `_locales/fr/`를 **먼저** 만들면 `findExtraneous`가 "LOCALES에 없는 로케일 디렉터리"로 red를 낸다. 이 함수는 `readdirSync(localesDir)`로 **디스크를 스캔**하므로 디렉터리 존재만으로 걸린다(파일 내용 무관).
- `DICTS.fr`을 **먼저** 넣으면 `Record<LocaleMode, …>` 타입이 `fr`을 모르므로 컴파일이 막힌다.
- 반대로 `LOCALES += "fr"`을 **먼저** 넣으면 5개 테이블 + 사전 세 벌이 전부 red다.

반면 **네임스페이스의 `fr` 엔트리와 `src/i18n/fr.ts`는 먼저 넣어도 안전하다** — `index.ts`가 import하기 전까지 아무도 안 보는 데이터라 타입·테스트 모두 무관하다. `frDict` 상수도 `DICTS`에 안 넣으면 마찬가지다. `locale-registry.test.ts`의 소스 스캔은 `readFileSync(.../locales.ts)` **단일 파일 하드코딩**이라 신규 `src/i18n/fr.ts`를 보지 않는다.

그래서 번역 데이터(큰 덩어리)를 먼저 쌓고 **등록 1커밋으로 스위치를 켜는** 구조가 된다.

## 릴리스 전략

**장기 feature 브랜치 → 1,001키 완성 후 dev로 합쳐 단일 PR.** `dev`는 항상 green을 유지한다.

대칭 테스트가 빈 값을 금지하므로("절반만 번역된 fr"의 dev 머지가 `locale-parity.ts:29`에서 구조적으로 불가능하다) 점진 머지가 안 된다. 그물을 일시 완화하는 선택지(테스트에 `IN_PROGRESS = ["fr"]` 예외)는 **기각했다** — 예외를 지우는 걸 잊으면 영구 구멍이 되고, 그건 이 인프라를 만든 이유와 정면으로 충돌한다.

**CI는 이 브랜치에서 안 돈다.** `.github/workflows/ci.yml`의 트리거가 `push: [dev]` + `pull_request: [main]`뿐이고 `/merge`도 `gh run list --branch dev`를 본다. 즉 feature 브랜치에서는 로컬 `pnpm typecheck` + `pnpm test`가 유일한 게이트이고, **CI가 처음 도는 건 dev로 합친 시점**이다.

### 상류 흡수 — 실패 모드는 충돌이 아니라 무음 자동머지

브랜치가 오래 사는 진짜 비용은 머지 충돌이 아니다. 상류는 `ko`/`en` 블록에 키를 append하고 fr 브랜치는 별도 `fr` 블록을 추가하므로, **git이 깨끗하게 자동머지하고 fr에만 키가 빠진 채 통과한다.** 걸리는 곳은 머지가 아니라 `findParityViolations`의 `fr <key>: 누락`이고, 흡수할 때마다 재번역 + 사전 ② 미러링이 따라온다.

churn 실측: 최근 100커밋 중 **38%가 `namespaces/`를 건드렸다**(파일별로도 `editor.ts` 17회 / `issue.ts` 16회 / `integrations.ts` 11회로 8파일 전부 활성). 충돌·누락 표면은 `namespaces/*.ts` 8파일 **+ `src/log-viewer/i18n.ts`**(최근 120커밋 중 14회 변경)다.

→ **주 1회 이상 `dev`를 rebase**하고, 매번 `pnpm test`로 parity를 확인한 뒤 빠진 fr 키를 채운다. 몰아서 하면 머지 시점에 누적 red를 한 번에 맞는다.

## 인터페이스 설계

새 함수·타입이 없다. 기존 시그니처의 값 확장뿐이다.

```ts
// src/i18n/locales.ts
export const LOCALES = ["ko", "en", "fr"] as const;
// LocaleMode = "ko" | "en" | "fr" 로 자동 확장

export const BCP47: Record<LocaleMode, string> = {
  ko: "ko-KR", en: "en-US", fr: "fr-FR",
};

// src/i18n/fr.ts (신규 — en.ts 미러)
import { common } from "./namespaces/common";
// … 8개
import type { TranslationMap } from "./ko";
const fr = { ...common.fr, ...app.fr, /* … */ };
export default fr satisfies TranslationMap;

// src/sidepanel/lib/localeLabels.ts
export const LOCALE_LABELS: Record<LocaleMode, string> = {
  ko: "한국어", en: "English", fr: "Français",
};
```

`BCP47`의 프로덕션 소비처는 `src/i18n/index.ts`의 `dateBcp47()` 하나이고, 그걸 쓰는 곳은 `formatTimestamp.ts`(`toLocaleString`)와 `issueListUtils.ts:173`(`toLocaleDateString`) **둘뿐**이다. `document.documentElement.lang`에 대입하는 코드는 0건이다(아래 대안 F).

### 품질 가드 (신규, 사람 검수 대체)

**`locale-parity.ts` 패턴을 따른다** — 순수 검사기를 `src/test/`에 두고, 합성 픽스처로 검사기 자체를 red/green 고정한 뒤, 실사전에 적용한다. 저장소에 이미 있는 형태이고, "fr 값 하나를 손으로 망가뜨려 red를 확인한다"는 방식과 달리 **증거가 커밋에 남는다.**

```ts
// src/test/proper-nouns.ts
export function findProperNounViolations(
  registry: LocaleRegistry,   // locales · DICTS · _locales 파생 — 사전 세 벌 모두에 적용
  nouns: readonly string[],
): string[];
```

판정: 어떤 키의 `ko`와 `en` 값이 **둘 다** 명사 N을 포함하면, 같은 키의 다른 등록 로케일 값도 N을 포함해야 한다. fr 전용으로 짜지 않는다 — 다음 로케일에서 또 만들게 된다.

```ts
const PROPER_NOUNS = [
  "Jira", "GitHub", "Linear", "Notion", "GitLab", "Asana", "ClickUp", "Slack",
  "BugShot", "Chrome", "OAuth", "CSS", "URL", "JSON",
];
```

**`HTML`은 목록에서 뺐다** — ko/en 어디에도 없다(유일한 등장은 `logs.html` 소문자)라 영구히 아무것도 단언하지 않는 죽은 항목이다. `JSON`은 1건뿐이지만 남긴다.

### 가드의 실제 사정거리 — "오탐이 구조적으로 없다"는 과장이었다

실측: (key, noun) 쌍 **98개 / 875키 중 87키(9.9%)** 커버. 분포는 `OAuth 20 · URL 13 · Notion 8 · GitHub 8 · Jira 7 · GitLab 7 · BugShot 7 · ClickUp 6 · Linear 5 · Asana 5 · Chrome 4 · Slack 4 · CSS 3 · JSON 1`.

- **ko∩en 필터의 효용은 거의 없다.** 걸러내는 키가 98쌍 중 딱 1쌍(`app.captureUnsupported.body` — en에만 `BugShot`)이다. ko 사전에 한글 음역(크롬·지라·노션)이 0건이라 애초에 걸러낼 게 없다. 필터는 유지하되 근거로 내세우지 않는다.
- **98쌍 중 20쌍이 vacuous** — ko값 = en값 = 토큰 그 자체(`platform.tab.*`, `*.auth.kind.oauth`, `editor.view.code`, `networkLog.filter.{css,json}`)라 복붙이면 통과한다. 실질 단언은 78개, 그중 57개가 `integrations.ts`다.
- **부분문자열 매칭의 우연 통과**: `networkLog.detail.copyCurl`의 `cURL`이 토큰 `URL`을 만족시킨다.
- **정당한 번역이 토큰을 떨구는 반례 3건** — 이건 가드를 고치는 게 아니라 **번역 문구를 토큰이 살아남는 쪽으로 고정**해 해소한다:
  - `logs.networkLog.search` `Search URL & body…` → `Rechercher dans l'adresse…`가 자연스럽지만 `URL`을 유지한다
  - `integrations.jira.error.404` `Not found: check workspace URL or site.`
  - `issue.issueList.deleteAll.body` `Only BugShot's list will be cleared.`

가드가 **놓치는 더 큰 축**은 서드파티 UI 경로 문자열(`Settings > Account > Security & Access > Personal API keys`, `Notion Settings > Integrations`)이다. 번역되면 사용자가 그 경로를 못 찾는다 — 고유명사보다 오역 확률도 피해도 크다. 이번엔 자동 가드를 만들지 않고 **번역 브리프의 금지 항목**으로 처리한다(tasks.md Task 1).

## 데이터 흐름

변경 없음. 기존 경로를 값만 하나 늘려 그대로 탄다.

```
navigator.language ─→ detectLocale() ─┐   ※ 최초 시딩에만
                                       ├─→ settings-ui-store.locale ─→ persist(chrome.storage.local)
사용자 셀렉터 선택 ─→ setLocale() ─────┘                    │
                                                            ├─→ useT() ─→ locales[locale] (사이드패널)
                                                            └─→ storage.onChanged ─→ bg-init ─→ setLocale (SW)

logs.html (별도 번들) ─→ detectLocale(navigator.language) ─→ DICTS[locale]   ※ persist를 안 봄
manifest / chrome.i18n ─→ Chrome이 _locales/<code> 선택, 없으면 default_locale(en)
BCP47 ─→ dateBcp47() ─→ formatTimestamp · issueListUtils  ※ <html lang>은 안 감
```

**persist 마이그레이션 없음.** `locale`은 v1부터 있던 필드이고 `"fr"`은 값 확장이라 하위호환이다. `version: 10` 유지. 방어가 필요한 방향은 반대(다운그레이드)이고 `normalizeLocale`이 `migrateSettingsUi`·`mergePersistedSettings` 양쪽에 이미 있다.

## 기존 패턴 준수

- **폴백 금지/허용 구분** (CLAUDE.md "로케일별 테이블") — 금지 5개는 채우고 허용 6개는 안 채운다. 잘못 분류하면 타입도 테스트도 안 잡는다.
- **사전 세 벌 동시 갱신** (CLAUDE.md "사전은 셋이다") — 하나라도 빠지면 그 표면에서만 폴백·raw 키가 뜬다.
- **`locales.ts` 런타임 import 0** — 이번엔 값만 늘리므로 자동 유지. `locale-registry.test.ts`의 소스 스캔이 지킨다.
- **log-viewer 복제 사전 drift 대조** — 공통 85키는 메인 테이블과 문자열 동일.
- **검사기는 순수 함수 + 합성 픽스처** (`src/test/locale-parity.ts` 선례) — 신규 고유명사 가드도 같은 형태.
- **e2e 로케일 비결정 함정 회피** (`e2e/GOTCHAS.md`) — 셀렉터 옵션 라벨은 **자기 언어 표기라 현재 로케일과 무관**하므로 텍스트 단언이 정당하다. 이건 GOTCHAS가 금지하는 "번역 라벨 단언"에 해당하지 않는다. 단 트리거(`SelectValue`)는 영속 로케일에 좌우되므로 단언 대상이 아니다.

## 대안 검토

**A. 그물을 일시 완화해 점진적 머지** — `locales.test.ts`에 `IN_PROGRESS` 예외를 두고 절반씩 dev에 넣는다. *기각*: 예외 제거를 잊으면 영구 구멍이고, "빈 값 금지"는 이 인프라의 핵심 계약이다. 장기 브랜치의 흡수 비용이 그 위험보다 싸다.

**B. `LOCALES` 등록을 마지막에 두고 사전만 먼저 머지** — 미등록 사전은 dead code라 테스트를 안 탄다. *기각*: 검사를 받지 않는 데이터가 dev에 오래 머무는 게 장기 브랜치보다 나을 게 없고, `_locales/fr`은 애초에 이 방식이 불가능하다(`findExtraneous`가 잡는다).

**C. 가이드도 프랑스어로** — *기각*: UI-only 결정을 뒤집는 규모(en 16,318단어 + 스크린샷 74장). 별도 기획 대상.

**D. 사람 검수를 릴리스 게이트로** — *기각*: 사용자 결정. 대신 자동 가드(고유명사 보존 + manifest 길이)로 가장 흔히 망치는 축만 막고, 나머지는 실사용 피드백에 맡긴다. PRD "품질 정책"에 그 트레이드오프와 철회 기준을 명시했다.

**E. 화면 언어 셀렉터에 `auto`(시스템 언어 따르기) 추가** — AI 작성 언어 셀렉터엔 `Auto ({lang})`가 있는데 화면 언어엔 없어서, 한 번 수동 선택하면 시스템 추종으로 되돌아갈 수 없다. *기각*: 기존 결함이고 fr이 만든 게 아니다. 로케일이 3개로 늘며 드러났을 뿐이라 별건으로 뺀다.

**F. `<html lang>`을 로케일에 동기화** — 현재 `src/sidepanel/index.html`이 `lang="ko"` 하드코딩이라 **en 사용자도 이미 틀렸다**(하이픈네이션·맞춤법검사·스크린리더 발음에 영향). `BCP47`이 이미 있어 `root.lang = dateBcp47()` 1줄이면 된다. *기각*: "기존 ko/en 동작을 한 바이트도 바꾸지 않는다"는 목표와 충돌한다. fr은 세 번째 피해자일 뿐이라 별건.

**G. `CollapsingTabsList` 접힘 상태의 `aria-label` 부여** — 트리거 하나라도 넘치면 전 탭 라벨을 `display:none`으로 숨기는데 `aria-label`이 0건이라 스크린리더에서 **무명 탭**이 된다(DESIGN.md §9 위반). fr이 그 붕괴 범위를 넓힌다. *기각*: 위와 같은 이유로 별건. 다만 fr에서 "글자가 잘린다"가 아니라 **라벨이 통째로 사라진다**는 실패 모드는 수동 체크리스트에 남긴다.

## 위험 요소

- **`locale-registry.test.ts`의 미등록 로케일 픽스처** — `detectLocale`·`normalizeLocale` 케이스가 `"fr"`을 "등록 안 된 예시"로 쓰고 있어 fr 등록과 동시에 깨진다. 착수 시 가장 먼저 확인할 것(Task 0).
- **`EXT_DESCRIPTION` 길이** — 위 사전 ③ 참조. 실패가 `test`·`typecheck`를 통과해 **스토어에서만 나타난다.** 이 프로젝트는 privacy 미갱신으로 심사 탈락한 전례가 있는 영역이다.
- **프랑스어 텍스트 팽창** — 위 "팽창 대응" 표. 구조적 안전판을 친 뒤에도 **레이아웃은 jsdom 밖이라 수동 확인이 유일한 그물**이다(400px 기준).
- **`integrations.ts` 271키가 전체의 31%** — 플랫폼 8개의 에러 문구·다이얼로그가 몰려 있고, 실질 고유명사 단언 78개 중 57개가 여기다.
- **상류 키 churn** — `issue-body-locale` 기획이 `src/i18n/namespaces/settings.ts`에서 `settings.titleSettings`를 **삭제**하고 `settings.issueCommon`·`settings.titlePrefix.label`·`settings.bodyLocale{,.auto,.help}` 5키를 **추가**했다. 이 브랜치가 1,001키 완성까지 dev에 못 들어가는 장기 브랜치라, 리베이스 때 git이 ko/en append를 무음 자동머지하고 **fr에만 키가 빠질 수 있다**(`locales.test.ts`가 잡지만 red를 만난 뒤다). 리베이스 직후 `pnpm test`를 먼저 돌린다.
- **log-viewer drift 대조의 방향** — 메인 사전 fr을 고치고 복제 사전을 안 고치면 red다. 두 벌을 항상 같이 만진다. 반대로 34키는 그물이 없어 **안 고쳐도 green**이라는 게 더 위험하다.
- **프랑스어 개발 머신에서만 red가 나는 e2e** — `code-block-collapse.spec.ts`가 ko|en 교대 정규식을 쓴다. 등록 전에는 `fr-*` 머신도 en으로 떨어져 우연히 green이었지만, 등록 후엔 `fr`로 hydrate돼 안 맞는다. CI(ubuntu, en_US)는 통과하므로 발견이 늦다.
- **e2e 샤드 전역 상태** — `ext` fixture가 `{ scope: "worker" }` + `workers: 1`이라 한 샤드의 모든 spec이 하나의 프로필·`chrome.storage`를 공유한다. 언어 spec에서 `Français`를 실제로 선택하고 복원하지 않으면 후속 spec 전부가 fr UI로 돈다.
- **번역 품질 회귀 리포트** — 오역 신고가 오면 그건 버그가 아니라 PRD가 예고한 경로다. `docs/POSTMORTEM.md` 대상이 아니다. 단 PRD "철회 기준"의 두 부류(의미 반전 / 구조 문제)는 예외다.
- **폰트는 대체로 위험이 아니다** — `é è ç à ù œ Œ É Ê « » ’` 전부 Pretendard dynamic subset(92개 `unicode-range`)이 덮는 것을 전수 파싱으로 확인했다. **단 U+202F(narrow no-break space)와 U+0178(Ÿ)은 subset 밖이다.** 프랑스어는 `: ; ? !` 앞과 « » 안쪽에 NNBSP를 쓰는 관례가 있고 AI 번역기가 이걸 자주 내보내므로, 번역 브리프에서 금지한다(U+00A0 또는 일반 공백으로).
