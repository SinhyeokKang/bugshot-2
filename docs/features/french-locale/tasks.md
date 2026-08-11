# 프랑스어 UI 로케일 (fr) — 구현 태스크

## 선행 조건

- **feature 브랜치에서 작업한다.** `dev`는 항상 green을 유지해야 하는데, `LOCALES`에 fr을 넣는 순간 997키를 다 채우기 전까지 red다(design.md "릴리스 전략").
- 권한·env·OAuth·외부 API 변경 **없음**. `manifest.config.ts`도 안 건드린다.
- 착수 직후 Task 0을 먼저 확인할 것 — 이걸 놓치면 Task 4에서 원인 불명의 red를 만난다.

---

## Task 0: 미등록 로케일 픽스처 점검

- **변경 대상**: `src/i18n/__tests__/locale-registry.test.ts`
- **작업 내용**: 현재 이 파일이 **`fr`을 "등록되지 않은 로케일"의 예시로 쓰고 있다.** 실측한 두 줄은 fr 등록과 동시에 깨진다:
  - `:25` — `expect(normalizeLocale("fr")).toBe(DEFAULT_LOCALE)` → fr이 등록되면 `"fr"`을 그대로 돌려주므로 red
  - `:97` — `expect(detectLocale("fr-FR")).toBe(DEFAULT_LOCALE)` → `"fr"`로 매칭되므로 red

  둘 다 **미등록 코드로 교체**한다(예: `"ja"`·`"xx"`). 단언의 의도는 "미지 로케일은 기본값으로"이지 "프랑스어는 지원 안 함"이 아니므로, 값만 바꾸면 의미가 보존된다.

  `:109`의 round-trip 목록(`["ko-KR","en-US","fr","",undefined,"xx-YY"]`)은 **그대로 둔다** — "반환값은 항상 등록된 로케일"을 재는 단언이라 fr이 등록돼도 green이고, 오히려 fr 경로를 한 번 더 태우는 셈이다.
- **검증**:
  - [ ] `:25`·`:97`이 미등록 코드로 교체됨
  - [ ] `pnpm test --run src/i18n/__tests__/locale-registry.test.ts` green (fr 등록 **전** 상태에서도 통과해야 한다 — 교체한 코드가 지금도 미등록이므로)

---

## Task 1: 메인 사전 8파일에 fr 추가 (875키)

- **변경 대상**: `src/i18n/namespaces/{common,app,issue,editor,integrations,settings,logs,ai}.ts`
- **작업 내용**: 각 파일에 `const fr = {...} satisfies Bundle;`을 추가하고 export를 `{ ko, en, fr }`로 바꾼다. 번역은 en을 원문으로 삼는다(ko는 기준 키 집합 정의용).
  - 플랫폼 고유명사(`Jira`·`GitHub`·`Linear`·`Notion`·`GitLab`·`Asana`·`ClickUp`·`Slack`)·제품명(`BugShot`)·기술 약어(`CSS`·`URL`·`JSON`·`HTML`·`OAuth`)는 **번역하지 않는다**. ko 사전이 이미 그렇게 하고 있다.
  - placeholder 토큰(`{n}`·`{count}`·`{max}` 등)은 이름·개수를 그대로 유지한다.
  - 분량 배분: `integrations` 271 · `editor` 151 · `issue` 131 · `logs` 117 · `settings` 95 · `app` 52 · `ai` 29 · `common` 29.
- **검증**:
  - [ ] `pnpm typecheck` — `Bundle` 타입이 키 누락을 잡으므로 0 에러면 8파일 모두 키가 완전하다
  - [ ] 이 시점엔 `pnpm test`가 여전히 green (fr이 아직 아무 레지스트리에도 없어 검사 대상 밖)

> 파일별로 커밋을 쪼개도 된다. 아직 어디에도 등록되지 않은 dead data라 중간 상태가 안전하다.

---

## Task 2: `src/i18n/fr.ts` 진입점

- **변경 대상**: `src/i18n/fr.ts` (신규)
- **작업 내용**: `src/i18n/en.ts`를 그대로 미러 — 8개 네임스페이스의 `.fr`을 spread하고 `export default fr satisfies TranslationMap`.
- **검증**:
  - [ ] `pnpm typecheck` 0 에러 (`TranslationMap` 불만족이면 여기서 걸린다)
  - [ ] `pnpm test` 여전히 green (아직 `index.ts`가 import하지 않음)

---

## Task 3: log-viewer 복제 사전 (122키)

- **변경 대상**: `src/log-viewer/i18n.ts`
- **작업 내용**: `frDict: Record<string, string>` 상수를 추가한다. **`DICTS`에는 아직 넣지 않는다**(Task 4와 원자적이어야 함 — `Record<LocaleMode, …>`라 fr이 `LOCALES`에 없으면 컴파일이 막힌다).
  - 이 사전은 메인 테이블(`logs`·`editor` 네임스페이스)의 부분집합이고 **공통 키는 문자열이 동일해야 한다**. Task 1의 fr 값을 그대로 가져온다.
- **검증**:
  - [ ] `pnpm typecheck` 0 에러
  - [ ] `pnpm test` 여전히 green

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
- **작업 내용**: 폴백 **허용** 테이블(`SECTION_DESC_BASE`·`MODE_HINTS`·`EXPECTED_SPLIT_HINT`·`SECTION_DESC`·`MONTH_STYLE`·`USER_GUIDE_URLS`)은 **건드리지 않는다.** 컴파일러가 요구하지도 않는다.
- **검증**:
  - [ ] `pnpm typecheck` 0 에러 — 폴백 금지 5개가 전부 채워졌다는 증거
  - [ ] `pnpm test` 전체 green — 사전 세 벌 대칭·빈 값 0·placeholder 일치
  - [ ] `locales.test.ts`의 "LOCALES의 모든 코드가 실제 사전을 갖는다"·"BCP47이 모든 등록 로케일을 커버한다" green
  - [ ] `manifest-locales.test.ts`의 커버리지·`findExtraneous` green
  - [ ] `log-viewer/__tests__/i18n.test.ts`의 "메인 테이블과 공통인 키는 값도 일치" green (복제 사전 drift 0)

---

## Task 5: 고유명사 보존 가드

- **변경 대상**: `src/i18n/__tests__/proper-nouns.test.ts` (신규)
- **작업 내용**: 사람 검수를 안 하기로 한 결정을 메우는 자동 가드. 어떤 키의 **ko와 en 값이 둘 다** 고유명사 N을 포함하면, 같은 키의 fr 값도 N을 포함해야 한다. ko/en 중 한쪽에만 있으면 검사 제외(표현이 갈리는 문장).
  - 대상: `Jira`·`GitHub`·`Linear`·`Notion`·`GitLab`·`Asana`·`ClickUp`·`Slack`·`BugShot`·`Chrome`·`OAuth`·`CSS`·`URL`·`JSON`·`HTML`
  - `locales` 레지스트리를 순회해 **등록된 모든 비-기준 로케일**에 적용한다(fr 전용으로 짜지 말 것 — 다음 로케일에서 또 만들게 된다).
- **검증**:
  - [ ] fr 값 하나에서 `Jira`를 일부러 `Jira Logiciel` 같은 게 아니라 아예 다른 단어로 바꿔 **red 확인** 후 되돌린다 (그물이 공허하지 않다는 증거)
  - [ ] `pnpm test` green

---

## Task 6: 언어 셀렉터 e2e

- **변경 대상**: `src/sidepanel/tabs/SettingsTab.tsx`(testid 추가) · `e2e/settings-language.spec.ts`(신규)
- **작업 내용**:
  - 언어 `SelectTrigger`에 `data-testid="settings-language"`를 붙인다(e2e 규율상 src 변경은 testid까지만 허용).
  - spec: 설정 탭 → 일반 서브탭 진입 후 셀렉터를 열어 옵션이 **3개**이고 텍스트가 `한국어 · English · Français` **순서**인지 단언한다.
  - 진입 패턴은 `e2e/settings-sections.spec.ts`의 hydration 폴링(`expect(async () => { click; toHaveAttribute("data-state","active") }).toPass()`)을 복제한다.
  - **이 단언은 `e2e/GOTCHAS.md`의 "locale 비결정" 금지에 걸리지 않는다** — 옵션 라벨이 자기 언어 표기라 현재 앱 로케일과 무관하게 같은 문자열이다. spec 주석에 그 근거를 남길 것.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e --grep settings-language` green
  - [ ] `LOCALE_LABELS`에서 fr을 임시로 빼면(컴파일은 막히므로 라벨 문자열만 변경) spec이 red

---

## Task 7: 회귀 확인

- **변경 대상**: 없음 (확인만)
- **작업 내용**: ko/en 동작이 한 바이트도 안 바뀌었는지 확인한다.
- **검증**:
  - [ ] `pnpm test` 전체 green — 특히 `prompts/__tests__/draftRich.test.ts`·`buildAiDraftPrompt.test.ts`(프롬프트 출력 불변)
  - [ ] `pnpm typecheck` 0 에러
  - [ ] `pnpm check:prearm` 통과 (i18n은 pre-arm 청크와 무관하나 확인)
  - [ ] `pnpm build` 성공 — `build:log-viewer`가 복제 사전을 포함해 통과하는지

---

## 테스트 계획

**단위 테스트**
- 기존 그물이 fr을 자동으로 검사한다(변경 불필요): `locales.test.ts`(레지스트리 순회 대칭·커버리지·BCP47) · `log-viewer/__tests__/i18n.test.ts`(복제 사전 + drift) · `manifest-locales.test.ts`(세 번째 사전 + `__MSG_`/`chrome.i18n` 참조).
- 추가: `proper-nouns.test.ts`(Task 5) · `localeLabels.test.ts`에 `Français` 회귀 핀 한 줄.

**e2e 시나리오** (`/e2e-write` 입력)
- 설정 > 일반의 화면 언어 셀렉터를 열면 옵션이 `한국어 · English · Français` 3개가 그 순서로 나온다.

**수동 테스트** (자동화 불가 — 레이아웃·실브라우저)
- [ ] fr로 전환 후 **캡처 진입 화면 버튼 5개**가 넘치거나 잘리지 않는다 (프랑스어는 en 대비 15~20% 길다)
- [ ] 제출 다이얼로그·설정 탭 트리거·연동 카드에서 텍스트 오버플로 없음
- [ ] `chrome://extensions`에서 확장 이름·설명이 프랑스어 (브라우저 언어를 fr로 두고 확인)
- [ ] `navigator.language=fr`인 새 프로필에서 첫 실행이 프랑스어로 뜬다
- [ ] fr 상태에서 이슈를 제출해 `logs.html`을 받고, **영어 브라우저**로 열면 영어로 보인다(리포터 로케일 미박제)
- [ ] fr 상태에서 가이드 버튼 → 영어 페이지로 이동(무표시 폴백, 의도된 동작)
- [ ] AI 작성 언어 `자동` + fr → 초안이 프랑스어
- [ ] 번역 검수는 하지 않는다(PRD "품질 정책"). 다만 **명백한 깨짐**(문장이 잘림·키 문자열 노출·플레이스홀더 리터럴 `{n}` 노출)만 훑는다

---

## 구현 순서 권장

```
Task 0 (픽스처 점검)
   ↓
Task 1 (메인 사전 875키) ──┐   ← 파일별 병렬·분할 커밋 가능
Task 2 (fr.ts 진입점)      │   ← Task 1 완료 후
Task 3 (log-viewer 122키)  ┘   ← Task 1의 값을 가져오므로 Task 1 이후
   ↓
Task 4 (등록 스위치 — 원자적 1커밋)   ← 여기서 처음 fr이 검사 대상이 된다
   ↓
Task 5 (고유명사 가드) ─┬─ 병렬 가능
Task 6 (e2e) ───────────┘
   ↓
Task 7 (회귀 확인)
```

Task 1이 전체 공수의 대부분이다. Task 2·3은 Task 1에 의존하고, Task 4는 1·2·3 전부에 의존한다. Task 5·6은 Task 4 이후 서로 독립이다.

## 가이드 영향

**없음.** 가이드를 프랑스어로 번역하지 않기로 했고(PRD 비목표), `USER_GUIDE_URLS`가 폴백 허용 테이블이라 fr → en 가이드로 가는 게 코드에 이미 반영돼 있다. `guide/ko`·`guide/en` 본문도 변경 대상이 아니다 — 지원 언어 목록을 가이드가 명시하고 있지 않다.

단, **`README.md`·`README.ko.md`의 기능 목록은 갱신 대상이다** — 현재 `**i18n** — Korean / English` / `**다국어** — 한국어 / 영어`로 적혀 있어 fr 추가와 함께 stale이 된다. 두 파일을 같은 커밋에서 함께 고친다(en 원본 ↔ ko 번역 대칭 규칙).
