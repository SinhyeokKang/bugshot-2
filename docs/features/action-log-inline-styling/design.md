# 액션 로그 인라인 텍스트 디자인 강화 — 기술 설계

## 개요
i18n 동사 템플릿 문자열은 그대로 두고, 렌더 레이어만 바꾼다. 템플릿을 `{슬롯}` 단위로 분할해 텍스트는 그대로 출력하고 슬롯 자리에 React 노드(값 칩 / 클릭 대상 / URL 링크)를 끼운다. 클릭 대상 태그 정보(`tagName`, `tagType`)는 `action-recorder`가 추가 캡처한다. 인라인 외부 링크와 값 칩은 공용 컴포넌트(`InlineLink`, `InlineChip`)로 추출해 기존 중복(`ConsoleLogContent`)을 통합한다. 순수 함수 2개(`splitTemplate`, `resolveClickTarget`)를 분리해 단위 테스트한다.

## 변경 범위

### `src/types/action.ts`
- 변경: `ActionEntry`에 optional 필드 2개.
  ```ts
  tagName?: string;  // click 대상 태그명 (예: "button", "div")
  tagType?: string;  // click 대상 type 속성 (예: "submit", "text")
  ```

### `src/content/action-recorder.ts`
- 변경: 내부 `CapturedAction`에 `tagName?`/`tagType?` 추가(`ActionEntry`와 동기화). `recordClick(el)`에서 `tagName: el.tagName.toLowerCase()`, `tagType: el.getAttribute("type") ?? undefined` 캡처.
- **빈 접근성 이름 정규화**: `accessibleName(el)`이 빈 문자열(`""`)을 반환하면 `target`을 `undefined`로 저장한다(`name || undefined`). 이래야 `resolveClickTarget` 1순위(`entry.target` 있으면 name)가 빈 이름에서 falsy로 떨어져 `tagName`(tag 모드)으로 넘어간다. `""`를 그대로 저장하면 빈 강조 텍스트가 렌더되므로 금지.
- 클릭 정규화: click 핸들러(`action-recorder.ts:278-281`)가 `target.closest("button, a, [role=button], input[type=submit]")`로 인터랙티브 조상으로 정규화한 뒤 `recordClick`에 넘긴다. 따라서 아이콘 버튼(SVG 내부 `<path>` 클릭)도 대부분 `<button>`/`<a>`로 잡힌다. 인터랙티브 조상이 없는 경우에만 raw 태그(`path` 등)가 노출되는데, 이는 기존 selector 동작과 동일한 한계(수용).
- 제약: `import type`(빌드 시 erase) + 인라인 `getAttribute`만 추가. `recorders-entry.ts` 동기 IIFE 제약(외부 static import 0) 무영향 — 현재 `@/` static value import 0, 상대경로만 사용. (`action-recorder.ts:1-10` 확인.)

### `src/sidepanel/lib/actionInline.ts` (신규)
- 역할: DOM·React 비의존 순수 함수 2개.
  ```ts
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

  export function shouldRenderChip(value: string | undefined, masked: boolean): boolean;
  ```
- `splitTemplate`: 슬롯 정규식은 `/(\{[a-zA-Z_][a-zA-Z0-9_]*\})/`. **슬롯 명명 규칙**(`[a-zA-Z_][a-zA-Z0-9_]*`)은 i18n locales 테스트(`locales.test.ts:33`의 `/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g`)와 일치하나, 정규식 자체는 다르다 — `String.split`용이라 캡처 그룹이 중괄호를 **포함**해야 토큰에 `{name}`이 남는다(locales 테스트는 중괄호 제외 캡처 + global). split 후 빈 문자열 제거, `{name}`은 slot, 나머지는 text.
- `shouldRenderChip(value, masked)`: 칩 렌더 여부 순수 함수. `masked`면 항상 `true`(MASKED_DISPLAY 칩), 아니면 `value`가 비어있지 않을 때만 `true`. input/select/keypress 빈값 가드를 JSX 조건이 아닌 순수 헬퍼로 빼 Task 1에서 단위 검증(jsdom 부재로 렌더 분기는 단위 불가하므로 가드 로직만 분리).
- `resolveClickTarget` 우선순위(단일·확정 시그니처):
  1. `entry.target` 있으면(non-empty) → `{ mode: "name", name: entry.target }` (recorder가 빈 이름을 `undefined`로 정규화하나, 레거시 세션 방어로 `entry.target?.trim()` 기준 truthy 검사)
  2. else `entry.tagName` 있으면 → `{ mode: "tag", tagName: entry.tagName, tagType: entry.tagType }`
  3. else `entry.selector` 있으면 → `{ mode: "name", name: entry.selector }` (레거시 세션 fallback)
  4. else → `{ mode: "empty" }`

### `src/sidepanel/components/InlineLink.tsx` (신규, 공용)
- 역할: 인라인 외부 링크. i18n 비의존(순수 URL 렌더).
  ```ts
  function InlineLink(props: { href: string; children?: ReactNode; title?: string; className?: string; "data-testid"?: string }): JSX.Element;
  ```
- 기본 className `text-blue-600 underline dark:text-blue-400`(+ 호출부 `className` 병합), `target="_blank" rel="noopener noreferrer"`. children 미지정 시 `href`를 텍스트로.
- **`data-testid` passthrough**: 공용 컴포넌트라 testid를 컴포넌트 자체에 하드코딩하지 않고 prop으로 전달. `ActionLogContent` navigation 분기에서만 `data-testid="action-nav-link"`를 넘기고, `ConsoleLogContent` 호출부는 미전달 → 콘솔 링크 testid 오염 없음.

### `src/sidepanel/components/InlineChip.tsx` (신규, 공용)
- 역할: 인라인 값 칩.
  ```ts
  function InlineChip(props: { children: ReactNode; muted?: boolean; "aria-label"?: string }): JSX.Element;
  ```
- 기본: `rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs [box-decoration-break:clone] break-words`.
- **텍스트 색**: 미지정 → 부모 색(`kindColor`) 상속 = 무채색 monospace. 값 칩은 테두리+monospace로만 구분하고, 색 강조는 클릭 태그(sky/amber/red)에만 둔다(시각 위계 의도). 신규 색 도입 0.
- **부모 `break-all` 우선순위**: `ActionRow`의 텍스트 span은 현재 `break-all`(글자 단위 강제 분할)이라, 그대로면 `box-decoration-break:clone`로 라운드는 살아도 칩이 **글자 중간**에서 갈린다. 칩 영역은 단어 단위 줄바꿈이 맞으므로, 칩 래퍼에 `break-words`를 두되 부모 `break-all`이 자식 inline에 전파되지 않도록 span의 `break-all`을 `break-words`로 조정한다(액션 행은 단어 단위 줄바꿈이 자연스러움 — URL/이메일도 칩·링크로 감싸므로 글자 단위 강제 분할 불필요).
- `muted`(마스킹): `border-dashed text-muted-foreground`(테두리·텍스트만 교체). 호출부에서 `aria-label="masked value"` 전달.

### `src/sidepanel/components/ActionLogContent.tsx`
- import 추가: `splitTemplate`/`resolveClickTarget`(actionInline), `InlineLink`, `InlineChip`, `Fragment`, `type ReactNode`.
- **제거(내 변경이 만든 고아)**: `roleWord`, `clickTarget`, `NavigateText`.
- **추가**:
  - `ClickTarget({ entry })` — `resolveClickTarget` 결과 분기: `name`은 강조 텍스트(`font-medium`), `tag`는 디자인 규칙 색으로 `<tag type="...">` 하이라이트(괄호 `aria-hidden`), `empty`는 빈 출력.
  - `renderVerb(template, slots)` — `splitTemplate(template)` 순회, slot은 `slots[name] ?? ""`, text는 그대로(`Fragment` key).
  - `renderActionContent(t, entry)` — kind별 분기:
    - `click`: `renderVerb(t("actionLog.verb.click"), { target: <ClickTarget entry={entry}/> })`
    - `input`: `renderVerb(t("actionLog.verb.input"), { value: <ValueChipForInput entry/>, field: fieldText(entry) })`
    - `select`: `renderVerb(t("actionLog.verb.select"), { value: entry.value ? <InlineChip>{entry.value}</InlineChip> : "", field: fieldText(entry) })`
    - `keypress`: `renderVerb(t("actionLog.verb.keypress"), { keys: <InlineChip>{entry.value ?? ""}</InlineChip> })`
    - `toggle`: value로 키 선택 후 `renderVerb(t(entry.value === "checked" ? "actionLog.verb.toggle.check" : "actionLog.verb.toggle.uncheck"), { field: fieldText(entry) })`
    - `navigation`: `renderVerb(t("actionLog.verb.navigate"), { target: entry.toUrl ? <InlineLink href={entry.toUrl} title={entry.toUrl}/> : "" })`
  - `fieldText(entry) = `"${entry.fieldLabel ?? entry.selector ?? ""}"`` — 따옴표 유지(칩 아님).
  - 빈 값 처리: `shouldRenderChip(entry.value, masked)` 순수 헬퍼로 판정 — masked면 항상 칩(`MASKED_DISPLAY`), 아니면 `entry.value` non-empty일 때만 칩, 빈값이면 슬롯에 `""`(placeholder 없음). input/select/keypress 공통.
  - input value 칩: masked면 `<InlineChip muted aria-label="masked value">{MASKED_DISPLAY}</InlineChip>`, 아니면 `shouldRenderChip` 통과 시 `<InlineChip>{entry.value}</InlineChip>`.
- `ActionRow`의 kind별 보간 블록 → `{renderActionContent(t, entry)}` 한 줄, span에 `leading-relaxed`.

### `src/sidepanel/components/ConsoleLogContent.tsx`
- 현재: 페이지 URL을 `<a ... className="block text-xs text-blue-600 underline dark:text-blue-400">`(`:257`)로 인라인 렌더.
- 변경: 해당 `<a>`를 `<InlineLink href={entry.pageUrl} className="block text-xs">{entry.pageUrl}</InlineLink>`로 치환. 시각·동작 동일.
- **두 호출부 className 비대칭(의도)**: 콘솔은 `block text-xs`(풀폭 블록·12px), 액션 navigation은 className 미전달(인라인·부모 13px 상속). 공용화는 색/underline/target 등 링크 본질을 통합하되, 레이아웃(블록 vs 인라인)·폰트 크기는 호출부 맥락이 결정 — InlineLink 기본값에 `text-xs`를 넣지 않아 액션 링크가 현재(13px 상속)와 무회귀.
- 비치환: `JsonTreeViewer.tsx:176`의 "더보기"는 `<div onClick>`(외부 링크 아님) → 대상 아님.

### `src/log-viewer/i18n.ts`
- 감사: `actionLog.verb.keypress` / `actionLog.verb.toggle.check` / `actionLog.verb.toggle.uncheck` / `actionLog.verb.select` 키가 ko/en 양쪽에 존재하는지 확인. 누락 시 `src/i18n/namespaces/logs.ts`와 동일 문자열로 보강(ActionLogContent가 log-viewer에서 모든 kind를 렌더하므로 키 미스 방지).
- **이 누락은 신규 회귀가 아니라 선재 버그다**: `log-viewer/markers.ts:128-139`도 이미 동일 키를 `t()`로 호출하는데, log-viewer `t()`는 미스 시 raw 키 문자열을 반환(`i18n.ts:194 if (!text) return key`)한다. 즉 현재도 영상 마커에서 keypress/toggle/select 액션은 `actionLog.verb.keypress` 같은 날 키가 노출되고 있을 가능성이 높다. 이번 보강은 그 버그를 동반 수정하며, **보강 후 markers.ts 라벨도 정상화됨을 함께 검증**한다(Task 6).

### 미변경 확인
- `src/i18n/namespaces/logs.ts` 동사 템플릿·`actionLog.role.*` 키 유지(`log-viewer/markers.ts:108-110`가 role 키 사용).
- `src/sidepanel/lib/buildActionLogJson.ts` 화이트리스트 방식 → `tagName`/`tagType` export 무유출.
- `searchText`(ActionLogContent) 무변경 — `target/fieldLabel/value/toUrl` 원본 기반이라 칩 래핑과 무관하게 검색 동작 유지.
- `kindColor`/`kindBgColor`(navigation 파랑) 유지.

## 데이터 흐름
```
DOM click → action-recorder.recordClick(el)
   target  = accessibleName(el)         (기존)
   tagName = el.tagName.toLowerCase()   (신규)
   tagType = el.getAttribute("type")    (신규)
 → CapturedAction → buffer → dispatch(CustomEvent) → (sidepanel/log-viewer 수신) ActionEntry[]
 → ActionLogContent / ActionRow → renderActionContent(t, entry)

슬롯명 ↔ 데이터 필드 매핑 (renderActionContent가 연결):
  click       verb.click     {target} ← <ClickTarget entry/>            (resolveClickTarget: target→tagName/tagType→selector)
  input       verb.input     {value}  ← entry.value (masked면 MASKED_DISPLAY), {field} ← entry.fieldLabel ?? selector
  select      verb.select    {value}  ← entry.value, {field} ← entry.fieldLabel ?? selector
  keypress    verb.keypress  {keys}   ← entry.value         (주의: 슬롯명 keys, 데이터는 value 필드)
  toggle      verb.toggle.check|uncheck  {field} ← entry.fieldLabel ?? selector   (value로 키 선택)
  navigation  verb.navigate  {target} ← entry.toUrl (InlineLink)
```
i18n 키는 kind와 이름이 다름에 주의: `navigation` kind → `actionLog.verb.navigate` 키.

## 인터페이스 설계
```ts
// types/action.ts
export interface ActionEntry { /* ...기존 */ tagName?: string; tagType?: string; }

// sidepanel/lib/actionInline.ts
export type TemplateToken = { type: "text"; value: string } | { type: "slot"; name: string };
export function splitTemplate(template: string): TemplateToken[];
export type ClickTargetView =
  | { mode: "name"; name: string }
  | { mode: "tag"; tagName: string; tagType?: string }
  | { mode: "empty" };
export function resolveClickTarget(
  entry: Pick<ActionEntry, "target" | "selector" | "tagName" | "tagType">,
): ClickTargetView;
export function shouldRenderChip(value: string | undefined, masked: boolean): boolean;

// sidepanel/components/InlineLink.tsx
export function InlineLink(props: { href: string; children?: ReactNode; title?: string; className?: string; "data-testid"?: string }): JSX.Element;
// sidepanel/components/InlineChip.tsx
export function InlineChip(props: { children: ReactNode; muted?: boolean; "aria-label"?: string }): JSX.Element;

// ActionLogContent.tsx (내부, export 안 함)
function ClickTarget(props: { entry: ActionEntry }): JSX.Element;
function renderVerb(template: string, slots: Record<string, ReactNode>): ReactNode;
function renderActionContent(t: TranslationFn, entry: ActionEntry): ReactNode;
```

## 기존 패턴 준수
- **i18n 동시 갱신**: 동사 템플릿 불변이라 ko/en 대칭 자동 보존(`locales.test.ts` PostToolUse 훅 무영향). 단 `log-viewer/i18n.ts` 보강 시 ko/en 동시 추가.
- **순수 함수 분리 + TDD**: `action-recorder-helpers.ts` 패턴 답습(`actionInline.ts`).
- **UI는 shadcn 우선**: 칩은 shadcn `Badge`(rounded-full)를 검토했으나, 레퍼런스의 각진 코드 칩(rounded-md, monospace)과 형태가 달라 `InlineChip` 별도 — 정식 토큰(`border-border`, `bg-background`, `text-xs`)만 사용해 직접 스타일링 컨벤션과 충돌 회피.
- **색 토큰 재사용**: 신규 색 없이 `DomTreeDialog`·`JsonTreeViewer.VALUE_COLORS` 기존 팔레트 차용.
- **MAIN world 제약**: `action-recorder.ts`에 런타임 외부 import 추가 금지(`import type`만).

## 대안 검토
- **(채택 안 함) 클릭에 이름+태그 동시 표시**: 한 줄이 길어짐. "이름 우선, 없으면 태그" 선택.
- **(채택 안 함) `type` 외 `name`/`role`까지 캡처 + allowlist 헬퍼**: 비목표. `type` 단일이라 2필드로 최소화.
- **(채택 안 함) 문법 하이라이트 emerald/rose 신규 색**: 코드베이스 미사용 + `DomTreeDialog`와 도메인 중복. sky/amber/red(기존)로 통일.
- **(채택 안 함) i18n 값에 마크업 삽입**: ko/en 대칭·번역 부담. 렌더 split이 단순.
- **(채택 안 함) 콘솔/네트워크에 값 칩 디자인까지 도입**: 비목표. 링크 공용화(시각 동일)만.
- **(채택 안 함) `InlineChip`·`ClickTarget`을 ActionLogContent 내부 비공개 유지**: 사용자가 공용 추출 + 링크 중복 통합 요구. `InlineLink`/`InlineChip`을 `components/`로 승격.

## 위험 요소
- **레거시 세션 회귀**: `tagName` 없는 구 세션은 `target → selector → empty`로 graceful degrade. 마이그레이션 불필요. `resolveClickTarget` 단위 테스트로 고정.
- **공유 컴포넌트 양면**: `ActionLogContent`는 사이드패널·로그 뷰어 공용. `InlineLink` 치환은 `ConsoleLogContent`에도 영향 → 양쪽 시각 확인 필요.
- **log-viewer i18n 키 누락(선재 버그)**: `log-viewer/i18n.ts`에 keypress/toggle/select 동사 키가 없어 해당 kind 렌더·마커 라벨에서 raw 키 노출 — 이번 변경이 만든 게 아니라 기존 `markers.ts` 호출에서도 이미 발생 중. 감사·보강 태스크로 동반 수정·차단.
- **칩 줄바꿈**: `break-all` 부모 안에서 칩이 갈라지는 문제 → `InlineChip`에 `[box-decoration-break:clone] break-words`로 양 끝 라운드 보존. 좁은 패널 수동 확인.
- **마커 비대칭**: `log-viewer/markers.ts`는 미변경 → 영상 마커 라벨은 기존 `"name" role` 표기 유지. 본문(칩/태그)과 표현이 갈리나 의도된 비목표.
- **DOM 캡처 미검증**: `tagName`/`tagType` 캡처는 jsdom 부재로 단위 테스트 불가 → e2e/수동 검증. SVG 내부 클릭 시 정규화 한계(위 변경 범위 참조).
- **고아 제거 안전**: `roleWord`/`clickTarget`/`NavigateText`는 내부 비-export, 외부 참조 0(grep 확인). `actionLog.role.*` 키는 markers.ts 사용 → 삭제 금지.
