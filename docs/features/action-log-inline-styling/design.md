# 액션 로그 인라인 텍스트 디자인 강화 — 기술 설계

## 개요
i18n 동사 템플릿 문자열은 그대로 두고, `ActionLogContent`의 렌더 레이어만 바꾼다. 템플릿을 `{슬롯}` 단위로 분할해 텍스트는 그대로 출력하고 슬롯 자리에 React 노드(값 칩 / 클릭 대상 / URL 링크)를 끼워 넣는다. 클릭 대상의 태그 정보(`tagName`, `tagType`)는 `action-recorder`가 추가로 캡처한다. 두 순수 함수(`splitTemplate`, `resolveClickTarget`)를 분리해 단위 테스트한다.

## 변경 범위

### `src/types/action.ts`
- 현재 역할: `ActionEntry`/`ActionLog` 타입 정의.
- 변경: `ActionEntry`에 optional 필드 2개 추가.
  ```ts
  tagName?: string;  // click 대상 태그명 (예: "button", "div")
  tagType?: string;  // click 대상 type 속성 (예: "submit", "text"). 없으면 미설정
  ```

### `src/content/action-recorder.ts`
- 현재 역할: MAIN world IIFE. DOM 이벤트를 `CapturedAction`으로 적재.
- 변경:
  - 내부 `CapturedAction` 인터페이스에 `tagName?: string`, `tagType?: string` 추가(`ActionEntry`와 동기화).
  - `recordClick(el)`에서 `tagName: el.tagName.toLowerCase()`, `tagType: el.getAttribute("type") ?? undefined` 캡처. (allowlist·헬퍼 불필요 — `type` 단일 속성이라 인라인 `getAttribute`로 충분.)
- 제약: 이 파일은 `recorders-entry.ts` 청크에 번들된다. 추가하는 것은 `import type`(빌드 시 erase)과 인라인 DOM 호출뿐이라 동기 IIFE 제약(외부 static import 0)에 영향 없음.

### `src/sidepanel/lib/actionInline.ts` (신규)
- 역할: 액션 인라인 렌더용 순수 함수 2개. DOM·React 비의존이라 단위 테스트 대상.
  ```ts
  export type TemplateToken =
    | { type: "text"; value: string }
    | { type: "slot"; name: string };
  export function splitTemplate(template: string): TemplateToken[];

  export type ClickTargetView =
    | { mode: "name"; name: string }       // 접근성 이름 우선
    | { mode: "tag"; tagName: string; tagType?: string }
    | { mode: "empty" };
  export function resolveClickTarget(entry: Pick<ActionEntry, "target" | "selector" | "tagName">): ClickTargetView;
  ```
- `splitTemplate`: `template.split(/(\{[a-zA-Z]+\})/)` 후 빈 문자열 제거, `{name}` 매칭은 slot, 나머지는 text.
- `resolveClickTarget` 우선순위:
  1. `entry.target`(접근성 이름) 있으면 → `{mode:"name", name}`
  2. else `entry.tagName` 있으면 → `{mode:"tag", tagName, tagType: entry.tagName ? ... }` — `tagType`은 `entry`에서 받되 타입은 위 시그니처에 맞춰 `tagName`만 보고 분기하므로 호출부에서 `tagType`도 함께 넘긴다(아래 주: 시그니처에 `tagType` 포함).
  3. else `entry.selector` 있으면 → `{mode:"name", name: selector}` (레거시 fallback — 따옴표 처리)
  4. else → `{mode:"empty"}`
  > 시그니처 정정: `resolveClickTarget(entry: Pick<ActionEntry, "target" | "selector" | "tagName" | "tagType">)`.

### `src/sidepanel/components/ActionLogContent.tsx`
- 현재 역할: 액션 로그 필터·검색·렌더. `ActionRow`가 kind별로 `t("actionLog.verb.*", {params})` 보간 문자열을 출력. `NavigateText`만 `{target}` split으로 링크 삽입.
- 변경:
  - import: `splitTemplate`, `resolveClickTarget`, `ActionTagAttr` 불필요(type만이라 미사용). `Fragment`, `type ReactNode` 추가.
  - **제거(내 변경이 만든 고아)**: `roleWord`, `clickTarget`, `NavigateText`. (이름 우선/태그 렌더로 대체되어 role 단어 조립이 사라짐.)
  - **추가 컴포넌트**:
    - `ValueChip({children, muted})` — monospace 박스 칩. 일반: `border bg-muted/60 text-foreground`, masked: `border-dashed text-muted-foreground`. 공통 `rounded-md px-1.5 py-0.5 font-mono text-[12px]`.
    - `ClickTarget({entry})` — `resolveClickTarget` 결과로 분기: `name`은 강조 텍스트(`font-medium`), `tag`는 문법 하이라이팅(`<` `>` muted, 태그명 emerald, `type` amber, `"값"` rose), `empty`는 빈 출력.
    - `NavLink({url})` — 기존 `NavigateText`의 `<a>` 부분 추출(blue+underline, 새 탭).
    - `renderVerb(template, slots)` — `splitTemplate(template)`를 돌며 slot은 `slots[name]`, text는 그대로. `Fragment` key로 감쌈.
    - `renderActionContent(t, entry)` — kind별 `renderVerb(t("actionLog.verb.*"), {슬롯})` 호출. 슬롯에 위 노드 주입.
  - `ActionRow`의 kind별 `&&` 보간 블록을 `{renderActionContent(t, entry)}` 한 줄로 교체. 칩 줄높이 여유로 span에 `leading-relaxed` 추가.
- 미변경: `KindIcon`, `kindColor`(navigation 파랑 유지), `kindBgColor`, 필터/검색/스크롤/origin 로직, `searchText`(target 포함 유지 → 이름 미표시여도 검색 가능).

### 미변경 확인
- `src/i18n/namespaces/logs.ts`, `src/log-viewer/i18n.ts` — 동사 템플릿·`actionLog.role.*` 키 모두 유지. `actionLog.role.*`는 `src/log-viewer/markers.ts`가 여전히 사용하므로 삭제하지 않는다.
- `src/sidepanel/lib/buildActionLogJson.ts` — 필드 화이트리스트 방식이라 `tagName`/`tagType`이 export에 새지 않음. 변경 불필요.

## 데이터 흐름
```
DOM click
  → action-recorder.recordClick(el)
      target = accessibleName(el)        (기존)
      tagName = el.tagName.toLowerCase() (신규)
      tagType = el.getAttribute("type")  (신규)
  → CapturedAction → buffer → dispatch(CustomEvent)
  → (sidepanel 수신) ActionEntry[]
  → ActionLogContent / ActionRow
      → renderActionContent(t, entry)
          click  → renderVerb("Clicked {target}", { target: <ClickTarget entry={entry}/> })
          input  → renderVerb("Entered {value} in {field}", { value:<ValueChip/>, field:`"label"` })
          select → renderVerb("Selected {value} in {field}", { value:<ValueChip/>, field:`"label"` })
          keypress → renderVerb("Pressed {keys}", { keys:<ValueChip/> })
          toggle → renderVerb("Checked {field}", { field:`"label"` })
          navigation → renderVerb("Navigated to {target}", { target:<NavLink/> })
```
`field` 슬롯은 칩이 아닌 일반 따옴표 문자열(`"라벨"`)로 유지된다.

## 인터페이스 설계
```ts
// types/action.ts
export interface ActionEntry {
  // ...기존 필드
  tagName?: string;
  tagType?: string;
}

// sidepanel/lib/actionInline.ts
export type TemplateToken =
  | { type: "text"; value: string }
  | { type: "slot"; name: string };
export function splitTemplate(template: string): TemplateToken[];

export type ClickTargetView =
  | { mode: "name"; name: string }
  | { mode: "tag"; tagName: string; tagType?: string }
  | { mode: "empty" };
export function resolveClickTarget(
  entry: Pick<ActionEntry, "target" | "selector" | "tagName" | "tagType">,
): ClickTargetView;

// ActionLogContent.tsx (내부, export 안 함)
function ValueChip(props: { children: ReactNode; muted?: boolean }): JSX.Element;
function ClickTarget(props: { entry: ActionEntry }): JSX.Element;
function NavLink(props: { url: string }): JSX.Element;
function renderVerb(template: string, slots: Record<string, ReactNode>): ReactNode;
function renderActionContent(t: TranslationFn, entry: ActionEntry): ReactNode;
```

## 기존 패턴 준수
- **i18n 동시 갱신 불필요**: 템플릿 문자열을 건드리지 않으므로 ko/en 대칭이 자동 보존된다(`src/i18n/__tests__/locales.test.ts` PostToolUse 훅 무영향).
- **순수 함수 분리 + 단위 테스트**: `action-recorder-helpers.ts`가 DOM 비의존 순수 함수를 분리해 테스트하는 패턴을 따라, 렌더 결정 로직을 `actionInline.ts`로 분리.
- **슬롯 split 렌더**: 기존 `NavigateText`의 `t(...).split("{target}")` 접근을 `splitTemplate`로 일반화(다중 슬롯 지원).
- **MV3 MAIN world 제약**: `action-recorder.ts`에 런타임 외부 import를 추가하지 않는다(`import type`만).
- **주석 최소**: `src/components/ui/` 외 WHY가 비자명할 때만.

## 대안 검토
- **(채택 안 함) 클릭 대상에 이름+태그 동시 표시** (`<button type="submit">Save</button>`): 정보량은 많지만 한 줄이 길어지고, 사용자가 "이름 우선, 없으면 태그"를 선택. 기각.
- **(채택 안 함) `type` 외 `name`/`role`까지 캡처해 allowlist 헬퍼(`pickTagAttrs`) 도입**: 식별력은 오르나 비목표. `type` 단일이면 헬퍼·배열 필드가 과한 일반화 → `tagName`/`tagType` 2필드로 최소화.
- **(채택 안 함) i18n 값에 마크업/플레이스홀더 인덱스 삽입**: 템플릿 변경 → ko/en 대칭·번역 부담. 렌더 레이어 split이 더 단순.
- **(채택 안 함) recorder가 미리 조합된 하이라이트 문자열 저장**: 렌더 시 재파싱 필요 + 색 정책이 데이터에 박힘. 구조화 필드(`tagName`/`tagType`) 저장이 분리에 유리.

## 위험 요소
- **레거시 세션 회귀**: 기존 저장 세션의 클릭 항목은 `tagName` 없음 → `resolveClickTarget`이 `target`(없으면 `selector`)을 `name` 모드로 처리. 마이그레이션 불필요하지만, `target`·`tagName`·`selector` 모두 없는 항목은 `empty`(빈 출력) — 기존에도 빈 따옴표였으므로 동등 이하. 단위 테스트로 fallback 경로 고정.
- **공유 컴포넌트**: `ActionLogContent`는 사이드패널·로그 뷰어 공용. 변경이 양쪽에 반영되므로 로그 뷰어 빌드 후 시각 확인 필요.
- **줄바꿈 시 칩 박스 분리**: 부모 span의 `break-all`이 칩 내부 텍스트도 끊어 박스가 두 줄로 갈라질 수 있음. 값(이메일 등)이 길 때 발생. 허용 범위로 보되 수동 확인 항목.
- **고아 함수 제거**: `roleWord`/`clickTarget`/`NavigateText` 제거 시 다른 참조가 없는지 확인(grep 확인 완료: 사용처 없음). `actionLog.role.*` i18n 키는 `markers.ts`가 사용하므로 **삭제 금지**.
- **DOM 캡처 미검증 위험**: `tagName`/`tagType` 캡처는 jsdom 부재로 단위 테스트 불가 → e2e/수동으로만 검증.
