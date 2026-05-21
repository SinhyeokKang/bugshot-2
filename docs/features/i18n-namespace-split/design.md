# i18n Namespace Split — 기술 설계

## 개요

`src/i18n/ko.ts`·`en.ts`를 그대로 두지 않고, **하나의 namespace 파일이 ko/en 두 객체를 같이 export**하는 8개 파일로 쪼갠다. ko.ts·en.ts는 namespace 파일을 import해 spread merge로 합치는 얇은 진입점 역할만 한다. TypeScript의 `Record<keyof typeof ko, string>` 패턴으로 ko·en 키 일치를 컴파일 타임에 강제한다.

## 변경 범위

### 신설 디렉터리: `src/i18n/namespaces/`

8개 ns 파일. 한 파일이 `{ ko, en }` 두 객체를 export. 각 ns에 묶을 prefix와 키 수:

| 파일 | 키 수 | 묶는 prefix |
|---|---|---|
| `common.ts` | 25 | `common.*`, `time.*`, `bg.*` |
| `app.ts` | 47 | `app.*`, `platform.*`, `debug.*` |
| `issue.ts` | 64 | `issue.*`, `section.*`, `issueList.*`, `issueType.*` |
| `editor.ts` | 81 | `editor.*`, `draft.*`, `draftDetail.*`, `prop.*`, `value.*`, `dom.*`, `styleTable.*`, `annotation.*`, `create.*`, `cancelConfirm.*`, `preview.*` |
| `integrations.ts` | 156 | `jira.*`, `github.*`, `linear.*`, `notion.*`, `oauth.*` |
| `settings.ts` | 64 | `settings.*`, `field.*`, `llm.*`, `project.*` |
| `logs.ts` | 88 | `networkLog.*`, `consoleLog.*`, `md.*`, `logSummary.*`, `logCard.*`, `json.*` |
| `ai.ts` | 12 | `ai.*`, `aiDraft.*`, `aiStyling.*` |
| **합계** | **537** | (현 ko.ts 키 수와 일치) |

### 신설 파일 내부 형식

각 ns 파일은 다음 구조:

```ts
// src/i18n/namespaces/common.ts

const ko = {
  "common.ok": "확인",
  "common.close": "닫기",
  // ... time.*, bg.* 포함
} as const;

const en: Record<keyof typeof ko, string> = {
  "common.ok": "Confirm",
  "common.close": "Close",
  // ...
};

export const common = { ko, en };
```

**핵심 타입 강제**: `en`에 `Record<keyof typeof ko, string>` 타입을 명시한다. ko가 ground truth → en이 ko 키를 모두 갖지 않으면 typecheck fail. 또한 en 객체 리터럴이 ko에 없는 키를 가지면 `Object literal may only specify known properties`로 fail.

ko에 있는 키와 en에 있는 키가 정확히 일치하도록 컴파일러가 양방향 검사.

### 수정 파일: `src/i18n/ko.ts`

분할 후 ~30줄:

```ts
import { common } from "./namespaces/common";
import { app } from "./namespaces/app";
import { issue } from "./namespaces/issue";
import { editor } from "./namespaces/editor";
import { integrations } from "./namespaces/integrations";
import { settings } from "./namespaces/settings";
import { logs } from "./namespaces/logs";
import { ai } from "./namespaces/ai";

const ko = {
  ...common.ko,
  ...app.ko,
  ...issue.ko,
  ...editor.ko,
  ...integrations.ko,
  ...settings.ko,
  ...logs.ko,
  ...ai.ko,
} as const;

export default ko;
export type TranslationKey = keyof typeof ko;
```

### 수정 파일: `src/i18n/en.ts`

분할 후 ~30줄:

```ts
import { common } from "./namespaces/common";
import { app } from "./namespaces/app";
import { issue } from "./namespaces/issue";
import { editor } from "./namespaces/editor";
import { integrations } from "./namespaces/integrations";
import { settings } from "./namespaces/settings";
import { logs } from "./namespaces/logs";
import { ai } from "./namespaces/ai";
import type { TranslationKey } from "./ko";

const en: Record<TranslationKey, string> = {
  ...common.en,
  ...app.en,
  ...issue.en,
  ...editor.en,
  ...integrations.en,
  ...settings.en,
  ...logs.en,
  ...ai.en,
};

export default en;
```

`en`이 `Record<TranslationKey, string>`로 선언됨으로써 8개 ns의 ko/en 키 합집합이 정확히 일치하지 않으면 typecheck fail. 이중 안전장치 (ns 파일 내부 + ko/en 진입점 모두).

### 비변경 파일

- `src/i18n/index.ts`: 변경 없음. `import ko, { type TranslationKey } from "./ko"; import en from "./en";` 그대로 동작.
- `src/i18n/bg-init.ts`: 변경 없음.
- `src/i18n/__tests__/*`: 만약 존재하면 손대지 않음 (현재 ls에서 `__tests__/` 디렉터리 있음 — 안의 테스트는 통과 유지).
- 호출처 약 200+ 위치 (`t("common.ok")` 같은 호출): 변경 없음. TranslationKey 타입이 동일하게 추론되므로 자동완성·타입 체크 그대로.

## 데이터 흐름

import 그래프:

```
src/i18n/index.ts
├─ ko.ts
│  └─ namespaces/{common,app,issue,editor,integrations,settings,logs,ai}.ts
└─ en.ts
   ├─ namespaces/{common,app,issue,editor,integrations,settings,logs,ai}.ts
   └─ type-only import: ko.ts (TranslationKey)
```

호출처는 모두 `@/i18n` (== `src/i18n/index.ts`)에서 `t`/`useT`/`TranslationFn` import. 새 디렉터리 노출 없음.

## 인터페이스 설계

신규 인터페이스 없음. 이번 작업은 **공개 API 변경 0** 임을 명시적으로 검증.

- `t(key, params)` 시그니처 동일.
- `useT()`·`setLocale()`·`getLocale()`·`dateBcp47()` 동일.
- `TranslationKey` 타입 동일 (537개 키 union).
- `TranslationFn` 동일.

## 기존 패턴 준수

- **CLAUDE.md "더 단순한 방법 우선"**: namespace 파일이 ko/en을 같이 들고 있는 옵션 (B)이 가장 단순. 디렉터리 분리(`namespaces/ko/`·`namespaces/en/`)나 파일 분리(`common.ko.ts`·`common.en.ts`)는 파일 수만 2배 늘리고 동시 검토 비용 증가.
- **CLAUDE.md "@/ 경로"**: ko.ts/en.ts 내부에서는 상대 경로(`./namespaces/common`) 사용 — 기존 i18n 내부 import도 상대 경로(`./ko`, `./en`).
- **CLAUDE.md "테스트 우선"**: 새 인터페이스가 없으므로 단위 테스트 신규 추가 불필요. 기존 `__tests__/`는 통과 유지.
- **CLAUDE.md "외과적 변경"**: 키 이름·값·번역 텍스트 모두 그대로. 발견된 오역·미사용 키도 손대지 않음.
- **TranslationKey 타입 추론**: `keyof typeof ko`로 정의되는 패턴 유지. `as const` 단언으로 좁은 string literal union 유지.

## 대안 검토

### 대안 1: ko/en 별도 파일 (`common.ko.ts` + `common.en.ts`)

- 장점: 한 파일이 단일 책임.
- 단점: 파일 수 16개. ko·en 병렬 수정 시 두 파일 동시 열기 — 분할 전 ko.ts·en.ts 두 파일 다 여는 부담과 동일. PRD "한 파일만 열기" 목적 달성 못함.
- **불채택**.

### 대안 2: 디렉터리 분리 (`namespaces/ko/common.ts` + `namespaces/en/common.ts`)

- 장점: 디렉터리로 locale 격리.
- 단점: 대안 1과 동일한 비용. 디렉터리 트리도 깊어짐.
- **불채택**.

### 대안 3: namespace 더 잘게 (플랫폼별 분리)

`integrations.ts` 156키를 `jira.ts`·`github.ts`·`linear.ts`·`notion.ts`·`oauth.ts` 5개로 더 쪼개는 안.

- 장점: 한 플랫폼 작업 시 더 좁은 파일.
- 단점: 파일 수 12개. oauth.ts는 4 플랫폼이 다 쓰는 공용이라 위치가 어색. 다른 도메인은 묶이는데 integrations만 더 쪼개면 깊이 불일치. /audit 보고서의 "8개 ns 분할" 권고와 어긋남.
- **불채택**.

### 대안 4: 빌드 타임 merge 스크립트 + JSON 자동 생성

`scripts/build-i18n.ts`로 namespace 폴더의 JSON/YAML을 읽어 ko.ts·en.ts 생성.

- 장점: 비개발자(번역가) 친화적 JSON 포맷.
- 단점: 빌드 파이프라인에 단계 추가, `chrome.tabs` 권한 자동 해석 같은 빌드 시스템 영향 가능, CLAUDE.md "더 단순한 방법" 위반. TypeScript spread만으로도 충분.
- **불채택**.

### 대안 5: i18next 같은 외부 라이브러리 도입

- 장점: namespace·lazy load·plural rule 등 풍부.
- 단점: 537키 정도 규모에 패키지 추가는 과한 대응. 현재 `t()` 구현은 17줄. CLAUDE.md "추상화 남발 금지" 위반.
- **불채택**.

## 위험 요소

- **ko/en 비대칭 잠재**: 분할 작업 중 한쪽에서 키를 빠뜨릴 위험. `Record<keyof typeof ko, string>` 타입이 1차 방어선, ko.ts/en.ts 진입점의 `Record<TranslationKey, string>`이 2차 방어선. 두 곳 모두에서 typecheck fail이 일어나면 작업이 중단되도록 강제.
- **키 누락 detection**: 분할 전후 키 개수가 정확히 537개로 일치하는지 검증 필요. design.md "성공 기준"의 awk 카운트 비교가 보호 장치. 분할 전 `awk -F'"' '/^  "[a-z]/ { print $2 }' src/i18n/ko.ts | sort > /tmp/i18n-keys-before.txt`로 베이스라인 기록 → 분할 후 namespace 파일 합집합과 diff 0.
- **prefix 분류 모호한 키**: 일부 키는 어느 ns에 묶을지 애매할 수 있다 (예: `bg.*`는 background 메시지인데 common에 둘지 app에 둘지). 현재 매핑은 키 수 균형과 의미 응집도 양쪽 고려 — bg는 service worker 동작 안내 메시지라 common 묶음에 포함. 작업자가 더 자연스럽다고 판단하는 다른 매핑이 있다면 design 갱신 후 진행.
- **TranslationKey 타입 union 폭발**: 537개 string literal union → TypeScript 컴파일 시간 영향. 현재 ko.ts에서 이미 동작 중이므로 분할로 악화되지 않음. spread merge가 union 추론을 망가뜨릴 가능성은 낮지만, `as const` 단언이 보존되는지 확인 필수 (없으면 `Record<string, string>`로 broaden되어 타입 안전성 손실).
- **import 순환 의존**: 없음. ns 파일은 다른 ns·ko/en을 import하지 않는 leaf. ko.ts는 namespaces를 import, en.ts는 namespaces + ko(type only) import. 사이클 없음.
- **번들 사이즈**: tree-shaking 관점에서 ko.ts·en.ts가 모든 namespace를 spread해 합치므로 사용 안 하는 키도 번들에 들어감. 이건 분할 전과 동일 (어차피 동적 t() 호출이라 정적 tree shake 불가능). 회귀 없음.
- **i18n/index.ts의 BCP47/setLocale 동작**: 분할과 무관. ko·en 객체 구조가 동일(Record<string, string>)하므로 그대로 동작.
- **bg-init.ts와 service worker context**: i18n 모듈이 SW에서 import되면 분할된 ns 파일들도 SW 번들에 들어감. 현재 ko.ts·en.ts 통째로 들어가는 상태와 등가.
