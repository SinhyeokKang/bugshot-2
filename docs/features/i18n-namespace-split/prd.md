# i18n Namespace Split

## 배경

`src/i18n/ko.ts`와 `src/i18n/en.ts`가 각 642줄, 537개 키를 보유한 단일 flat 객체로 존재한다. 38개 의미 namespace가 한 파일에 혼재해 다음 문제가 누적되어 있다.

- **diff 가독성**: 새 기능 추가 시 ko/en 한 쌍에 키가 들어가는데, 540줄짜리 객체의 어느 줄에 들어갔는지 PR 리뷰가 어렵다.
- **병렬 수정 비용**: ko·en 한 쌍을 함께 갱신하려면 두 큰 파일을 동시에 스크롤하면서 위치를 맞춰야 한다.
- **conflict 빈도**: 두 사람이 다른 namespace의 키를 추가해도 같은 파일 인접 위치를 건드려 머지 충돌이 생긴다.
- **/audit 🔴 시급 #5로 분류된 작업**. 정책 변경이나 새 기능 없이도 다음 작업 직전이 가장 적기.

키 분포 (ko.ts 기준, `awk` 카운트):

```
linear      46    networkLog  41    issueList  36    github     36    notion     33
llm         29    jira        29    platform   23    consoleLog 22    draft      18
common      18    settings    17    prop       16    app        16    field      15
editor      15    md          14    issue      14    section    13    oauth      12
logSummary   8    dom          8    debug       8    value       7    aiStyling  7
create       6    time         4    aiDraft     4    project     3    preview    3
cancelConfirm 3   bg           3    styleTable  2    json        2    annotation 2
logCard      1    issueType    1    draftDetail 1    ai          1
```

`diff <(sort ko keys) <(sort en keys)`로 검증: **ko/en 대칭 완벽** (현재 0 diff). 이 상태를 유지하면서 namespace 단위로 묶어내면 된다.

## 목표

- ko.ts·en.ts를 도메인별 namespace 파일로 분할해, **하나의 namespace 파일이 ko/en 한 쌍을 같이 들고 있도록** 한다. 한 기능을 수정할 때 한 파일만 열면 ko·en 양쪽이 보인다.
- 분할 후 `import { t, useT } from "@/i18n"` 호출처 일체 변경 없음. `t("common.ok")` 같은 호출 시그니처 동일.
- TypeScript 타입 시스템으로 ko·en 키 집합 일치를 강제 (한쪽에 키 누락 시 `pnpm typecheck` 실패).
- 키 이름·값·번역 텍스트 변경 없음. 순수 파일 위치 재배열.

## 비목표 (Non-goals)

- **번역 텍스트 수정 없음**. 오역·어색한 표현이 보여도 이번 스코프 밖. 별건으로 처리.
- **새 namespace나 키 추가 없음**.
- **누락된 키나 미사용 키 제거 없음**. 분할 작업 중 발견하면 별도 메모만, 이 PR에서 안 건드림.
- **i18n 런타임 동작 변경 없음**. `t()`/`useT()`/`setLocale()`/`getLocale()`/`dateBcp47()` API 그대로.
- **TranslationKey 타입 alias 변경 없음**. `keyof typeof ko`로 정의되는 현재 패턴 유지.
- **자동화 스크립트 도입 없음**. ts-loader 변환이나 빌드 타임 merge 스크립트 같은 것 없이, 순수 TypeScript spread merge로만 처리.
- **bg-init.ts / index.ts 동작 변경 없음**.

## 사용자 시나리오

엔드유저 시야의 동작은 0건 변경. 개발자 워크플로우만 개선:

1. **새 기능에 i18n 키 추가** — 기능이 GitHub 영역이라면 `src/i18n/namespaces/integrations.ts` 한 파일만 열어 ko·en 양쪽에 키를 추가한다 (현재는 ko.ts·en.ts 두 파일).
2. **번역 검토** — 한국어 윤문가가 settings 영역의 ko 표현을 검토할 때 `namespaces/settings.ts`만 열어 ko 객체만 본다. en 객체는 같은 파일에서 즉시 비교 가능.
3. **PR 리뷰** — 분할 후 GitHub diff에서 어느 namespace가 바뀌었는지 파일 경로로 즉시 판단.
4. **conflict 회피** — 두 사람이 다른 영역(예: GitHub vs Notion)을 동시에 작업하면 어차피 같은 integrations.ts를 건드려 머지 충돌은 그대로지만, 다른 도메인(예: app vs ai)이라면 다른 파일이라 머지 충돌 면제.

## 성공 기준

- `src/i18n/namespaces/` 디렉터리 신설, 8개 ns 파일 보유 (`common`, `app`, `issue`, `editor`, `integrations`, `settings`, `logs`, `ai`).
- 각 ns 파일이 `{ ko, en }` 두 객체를 export. en이 `Record<keyof typeof ko, string>` 타입으로 선언되어 ko 키 누락 시 typecheck fail.
- `src/i18n/ko.ts` < 50줄: 8개 namespace import + spread merge + TranslationKey type alias만.
- `src/i18n/en.ts` < 50줄: 8개 namespace import + Record<TranslationKey, string>로 spread.
- `pnpm typecheck` 통과.
- `pnpm test` 통과 (i18n에 기존 테스트 있으면 함께 통과 — `src/i18n/__tests__/`에 있다면 손대지 않음).
- 호출처 어디에서도 `import { t } from "@/i18n"` 외 새 import 추가 불필요.
- `grep -c '"' src/i18n/ko.ts src/i18n/en.ts src/i18n/namespaces/*.ts` 총 큰따옴표 개수가 분할 전후로 동일하거나 정확히 차이 (en 키 라벨이 새 파일들로 분산된 만큼).
- `diff <(awk -F'"' '/^  "[a-z]/ { print $2 }' <분할전백업> | sort) <(node -e 'console.log(Object.keys(require("./dist/i18n/ko")).join("\\n"))' | sort)` 결과 0 diff. (실용적으로는 분할 전 `awk` 출력을 기록해두고 분할 후 다시 `awk`로 namespaces 파일 합집합 추출하여 비교.)
