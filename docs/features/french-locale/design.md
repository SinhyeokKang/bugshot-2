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

`DICTS`는 `Record<LocaleMode, …>`라 **fr이 `LOCALES`에 들어간 뒤에만** 엔트리를 넣을 수 있다(순서 제약 — 아래 참조). 이 사전은 메인 테이블(`logs`·`editor` 네임스페이스)의 부분집합 + 동일 문구를 의도하므로, **공통 키는 메인 사전의 fr 값과 문자열이 같아야 한다** — `log-viewer/__tests__/i18n.test.ts`의 drift 대조가 강제한다. 즉 ①을 먼저 하고 거기서 값을 가져오는 게 맞다.

### 사전 ③ manifest `_locales` (4키)

| 파일 | 변경 |
|---|---|
| `public/_locales/fr/messages.json` (신규) | `EXT_NAME` · `EXT_NAME_SHORT` · `EXT_DESCRIPTION` · `CMD_TOGGLE_PANEL` |

`EXT_NAME_SHORT`는 `BugShot` 그대로 둔다(제품명). `manifest.config.ts`는 **변경 없다** — `default_locale: "en"` 유지.

### 레지스트리 + 폴백 금지 5개

| 파일 | 변경 |
|---|---|
| `src/i18n/locales.ts` | `LOCALES = ["ko", "en", "fr"]` · `BCP47.fr = "fr-FR"` |
| `src/i18n/index.ts` | `locales.fr = fr` (신규 `./fr` import) |
| `src/sidepanel/lib/aiLanguage.ts` | `LOCALE_AI_PRESET.fr = "French"` — `AI_LANGUAGE_OPTIONS`에 이미 있는 값이라 새 프리셋 추가 불필요 |
| `src/sidepanel/lib/localeLabels.ts` | `LOCALE_LABELS.fr = "Français"` (자기 언어 표기) |
| `src/log-viewer/i18n.ts` | `DICTS.fr` (위 ②) |

### 폴백 허용 — 손대지 않음

`SECTION_DESC_BASE`·`MODE_HINTS`·`EXPECTED_SPLIT_HINT`(`draftRich.ts`) · `SECTION_DESC`(`draftCompact.ts`) · `MONTH_STYLE`(`issueListUtils.ts`) · `USER_GUIDE_URLS`(`external-links.ts`) 전부 **fr 엔트리를 만들지 않는다.** `LocaleTable<T>`이 `en`만 필수라 컴파일이 요구하지도 않는다.

근거는 축마다 다르다:
- 프롬프트 4개 — 영어 스캐폴딩이 설계이고 언어는 `Write in French` 한 줄이 옮긴다(CLAUDE.md "AI 출력 언어").
- `MONTH_STYLE` — en 폴백 `short`가 `15 janv. 2026`. 실측 확인함.
- `USER_GUIDE_URLS` — 가이드를 번역하지 않기로 했으므로 en 폴백이 **의도된 결과**다.

### 테스트

| 파일 | 변경 |
|---|---|
| `src/i18n/__tests__/locales.test.ts` | **변경 없음** — 레지스트리를 순회하므로 fr이 자동으로 검사 대상 |
| `src/log-viewer/__tests__/i18n.test.ts` | **변경 없음** — `LOCALES` 순회 |
| `src/i18n/__tests__/manifest-locales.test.ts` | **변경 없음** — `findUncovered(LOCALES, registry)` |
| `src/sidepanel/lib/__tests__/localeLabels.test.ts` | 회귀 핀에 `Français` 한 줄 추가 |
| `src/i18n/__tests__/locale-registry.test.ts` | `detectLocale`·`normalizeLocale`의 "등록되지 않은 로케일" 케이스가 예시로 `"ja"`/`"fr"`을 쓴다 — **`fr`을 쓰는 곳이 있으면 다른 미등록 코드로 교체**해야 한다(그렇지 않으면 fr 등록으로 그 케이스가 깨진다) |
| `src/i18n/__tests__/proper-nouns.test.ts` (신규) | 아래 "품질 가드" |
| `e2e/settings-language.spec.ts` (신규) | 셀렉터 옵션 3개 |

> `locale-registry.test.ts`의 미등록 로케일 픽스처는 **반드시 확인할 것.** 실증 과정에서 `"ja"`를 임시 등록했을 때 정확히 이 두 케이스가 깨졌던 전례가 있다.

## 순서 제약 — 중간 상태가 red가 되는 지점

**`public/_locales/fr/`와 `DICTS.fr`와 `LOCALES += "fr"`는 한 커밋이어야 한다.**

- `_locales/fr/`를 **먼저** 만들면 `manifest-locales.test.ts`의 `findExtraneous(LOCALES, registry)`가 "LOCALES에 없는 로케일 디렉터리"로 red를 낸다.
- `DICTS.fr`을 **먼저** 넣으면 `Record<LocaleMode, …>` 타입이 `fr`을 모르므로 컴파일이 막힌다.
- 반대로 `LOCALES += "fr"`을 **먼저** 넣으면 5개 테이블 + 사전 세 벌이 전부 red다.

반면 **네임스페이스의 `fr` 엔트리와 `src/i18n/fr.ts`는 먼저 넣어도 안전하다** — `index.ts`가 import하기 전까지 아무도 안 보는 데이터라 타입·테스트 모두 무관하다. `frDict` 상수도 `DICTS`에 안 넣으면 마찬가지다.

그래서 번역 데이터(큰 덩어리)를 먼저 쌓고 **등록 1커밋으로 스위치를 켜는** 구조가 된다.

## 릴리스 전략

**장기 feature 브랜치 → 997키 완성 후 단일 PR.** `dev`는 항상 green을 유지한다.

대칭 테스트가 빈 값을 금지하므로 "절반만 번역된 fr"을 dev에 머지할 수 없다. 그물을 일시 완화하는 선택지(테스트에 `IN_PROGRESS = ["fr"]` 예외)는 **기각했다** — 예외를 지우는 걸 잊으면 영구 구멍이 되고, 그건 이 인프라를 만든 이유와 정면으로 충돌한다.

브랜치가 오래 사는 대가는 감수한다. 다만 위 순서 제약 덕에 브랜치 안에서도 커밋을 쪼갤 수 있어, 충돌 위험은 `namespaces/*.ts` 8파일에 국한된다(다른 작업이 i18n 키를 추가하면 겹친다).

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

### 품질 가드 (신규, 사람 검수 대체)

```ts
// src/i18n/__tests__/proper-nouns.test.ts
// ko·en 양쪽 값에 공통으로 등장하는 라틴 고유명사는 fr 값에도 살아 있어야 한다.
// ko가 이미 "Jira"·"GitHub"을 라틴 그대로 두는 선례가 근거이고,
// AI 번역이 가장 흔히 망치는 축이다("Problème" 같은 오역이 아니라
// "Jira" → "Jira"가 유지되는지를 잰다).
const PROPER_NOUNS = [
  "Jira", "GitHub", "Linear", "Notion", "GitLab", "Asana", "ClickUp", "Slack",
  "BugShot", "Chrome", "OAuth", "CSS", "URL", "JSON", "HTML",
];
```

판정: 어떤 키의 `ko`와 `en` 값이 **둘 다** 명사 N을 포함하면, 같은 키의 `fr` 값도 N을 포함해야 한다. ko/en 중 한쪽에만 있으면 검사하지 않는다(그 키는 애초에 표현이 갈리는 문장이다).

**오탐이 구조적으로 없다** — 정확 부분문자열 매칭이고, 대조군을 ko∩en으로 좁혀 "영어 문장에만 우연히 등장한 단어"를 배제한다.

## 데이터 흐름

변경 없음. 기존 경로를 값만 하나 늘려 그대로 탄다.

```
navigator.language ─→ detectLocale() ─┐
                                       ├─→ settings-ui-store.locale ─→ persist(chrome.storage.local)
사용자 셀렉터 선택 ─→ setLocale() ─────┘                    │
                                                            ├─→ useT() ─→ locales[locale] (사이드패널)
                                                            └─→ storage.onChanged ─→ bg-init ─→ setLocale (SW)

logs.html (별도 번들) ─→ detectLocale(navigator.language) ─→ DICTS[locale]   ※ persist를 안 봄
manifest / chrome.i18n ─→ Chrome이 _locales/<code> 선택, 없으면 default_locale(en)
```

**persist 마이그레이션 없음.** `locale`은 v1부터 있던 필드이고 `"fr"`은 값 확장이라 하위호환이다. `version: 10` 유지. 방어가 필요한 방향은 반대(다운그레이드)이고 `normalizeLocale`이 `migrateSettingsUi`·`mergePersistedSettings` 양쪽에 이미 있다.

## 기존 패턴 준수

- **폴백 금지/허용 구분** (CLAUDE.md "로케일별 테이블") — 금지 5개는 채우고 허용 6개는 안 채운다. 잘못 분류하면 타입도 테스트도 안 잡는다.
- **사전 세 벌 동시 갱신** (CLAUDE.md "사전은 셋이다") — 하나라도 빠지면 그 표면에서만 폴백·raw 키가 뜬다.
- **`locales.ts` 런타임 import 0** — 이번엔 값만 늘리므로 자동 유지. `locale-registry.test.ts`의 소스 스캔이 지킨다.
- **log-viewer 복제 사전 drift 대조** — 공통 키는 메인 테이블과 문자열 동일.
- **e2e 로케일 비결정 함정 회피** (`e2e/GOTCHAS.md`) — 셀렉터 옵션 라벨은 **자기 언어 표기라 현재 로케일과 무관**하므로 텍스트 단언이 정당하다. 이건 GOTCHAS가 금지하는 "번역 라벨 단언"에 해당하지 않는다.

## 대안 검토

**A. 그물을 일시 완화해 점진적 머지** — `locales.test.ts`에 `IN_PROGRESS` 예외를 두고 절반씩 dev에 넣는다. *기각*: 예외 제거를 잊으면 영구 구멍이고, "빈 값 금지"는 이 인프라의 핵심 계약이다. 장기 브랜치의 머지 충돌 비용이 그 위험보다 싸다.

**B. `LOCALES` 등록을 마지막에 두고 사전만 먼저 머지** — 미등록 사전은 dead code라 테스트를 안 탄다. *기각*: 검사를 받지 않는 데이터가 dev에 오래 머무는 게 장기 브랜치보다 나을 게 없고, `_locales/fr`은 애초에 이 방식이 불가능하다(`findExtraneous`가 잡는다).

**C. 가이드도 프랑스어로** — *기각*: UI-only 결정을 뒤집는 규모(16,318단어 + 스크린샷 73장). 별도 기획 대상.

**D. 사람 검수를 릴리스 게이트로** — *기각*: 사용자 결정. 대신 자동 가드(고유명사 보존)로 AI가 가장 흔히 망치는 축만 막고, 나머지는 실사용 피드백에 맡긴다. PRD "품질 정책"에 그 트레이드오프를 명시했다.

## 위험 요소

- **`locale-registry.test.ts`의 미등록 로케일 픽스처** — `detectLocale`·`normalizeLocale` 케이스가 `"fr"`을 "등록 안 된 예시"로 쓰고 있으면 fr 등록과 동시에 깨진다. 착수 시 가장 먼저 확인할 것.
- **프랑스어 텍스트 팽창** — 영어 대비 15~20% 길다. 사이드패널은 좁고 버튼 라벨이 많다. 자동으로 못 잡으므로(레이아웃은 jsdom 밖) **수동 확인이 유일한 그물**이다. 특히 캡처 진입 화면 버튼 5개, 제출 다이얼로그, 설정 탭 트리거.
- **`integrations.ts` 271키가 전체의 31%** — 플랫폼 8개의 에러 문구·다이얼로그가 몰려 있고, 고유명사가 가장 많이 등장하는 곳이라 자동 가드가 가장 자주 걸릴 파일이다.
- **log-viewer drift 대조의 방향** — 메인 사전 fr을 고치고 복제 사전을 안 고치면 red다. 두 벌을 항상 같이 만진다.
- **번역 품질 회귀 리포트** — 오역 신고가 오면 그건 버그가 아니라 PRD가 예고한 경로다. `docs/POSTMORTEM.md` 대상이 아니다.
- **폰트는 위험이 아니다** — `é è ç à ù œ É ê` 전부 Pretendard dynamic subset이 덮는 것을 unicode-range 대조로 확인했다. CJK와 달리 시스템 폰트 폴백이 섞이지 않는다.
