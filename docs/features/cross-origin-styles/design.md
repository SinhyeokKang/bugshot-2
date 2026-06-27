# Cross-origin 스타일 보강 — 기술 설계

## 개요

cross-origin stylesheet는 `cssRules` 접근이 `SecurityError`라 CSSStyleRule 인스턴스를 얻을 수 없다. 따라서 기존 same-origin 경로(CSSOM rule 인스턴스를 key로 한 raw 매핑)에 끼워넣을 수 없고, **background가 fetch한 원문 CSS 텍스트를 `parseStylesheet`로 파싱한 `ParsedRule`을 `el.matches(selectorText)`로 직접 매칭하는 병행 경로**를 추가한다. content(ISOLATED)는 cross-origin을 직접 fetch할 수 없으므로 background에 위임하고, background는 `chrome.permissions.contains({origins:["<all_urls>"]})`로 권한을 확인한 뒤에만 fetch한다(미보유/실패 시 null → 조용히 skip). 보강된 specified/소스는 기존 `picker.selectionUpdated` 메시지로 sidepanel에 합류한다.

## 변경 범위

### `src/background/messages.ts` (+ `bgRequestTypes.ts`, `src/types/messages.ts`)
- 현재 역할: `handleMessage()`가 `switch (message.type)`로 background RPC를 디스패치. host_permissions origin을 CORS 우회 fetch(GitHub/Notion API 선례).
- 변경: 새 메시지 타입 `css.fetchSheets` 핸들러 추가. 입력 `{ urls: string[] }`, 출력 `{ sheets: Array<{ url: string; text: string }> }`. 핸들러는 먼저 `chrome.permissions.contains({ origins: ["<all_urls>"] })`로 게이트 → false면 빈 배열 반환. true면 각 url을 `fetch(url, { credentials: "omit" })` → `res.ok`면 `res.text()`, 실패는 결과에서 제외(부분 성공 허용). `BG_REQUEST_TYPES` Set과 `BgRequest`/`BgResponse` union에 타입 추가.

### `src/content/css-source-cache.ts`
- 현재 역할: `ensureLoaded()`가 모든 sheet를 로드해 raw CSS를 CSSStyleRule에 매핑. `fetchSheetText`가 cross-origin을 skip. `getMatchingRules(el)`은 same-origin CSSStyleRule[] 반환.
- 변경:
  - `loadSheet()`의 cross-origin link 분기: 현재 `fetchSheetText` → null로 끝나는 대신, cross-origin link href를 **수집만** 해 둔다(여기서 직접 background 호출하지 않고 별도 단계로 모아 1회 배치 fetch).
  - 새 모듈 전역: `crossOriginRules: CrossOriginIndexedRule[]`, `crossOriginCustomProps: Record<string,string>`.
  - 새 export `ensureCrossOriginLoaded(): Promise<void>` — cross-origin link href 목록을 모아 `sendBg({type:"css.fetchSheets", urls})` 1회 호출 → 응답 텍스트를 `parseStylesheet`로 파싱 → `indexCrossOriginRules`로 seq/source(`external · <basename>`) 부여해 `crossOriginRules`에 적재, `:root`/전역 `--*` 선언은 `crossOriginCustomProps`에 수집. 멱등(loadPromise 패턴). `invalidate()`에서 함께 초기화.
  - 새 export `getMatchingCrossOriginRules(el: Element): CrossOriginRule[]` — `crossOriginRules`를 `el.matches(selectorText)`로 필터 + seq 정렬해 반환.
  - 새 export `getCrossOriginCustomProps(): Record<string,string>`.
  - 순수 헬퍼 `indexCrossOriginRules(parsed: ParsedRule[], href: string, startSeq: number): CrossOriginIndexedRule[]` (단위 테스트 대상 — DOM 불필요).

### `src/content/css-resolve.ts`
- 현재 역할: `collectRulesForElement(el, out, sources, customProps, wantedProps?)`가 `getMatchingRules`로 same-origin rule을 머지. `collectSpecifiedStylesWithSources`가 이를 호출하고 `resolveVarChain`으로 토큰 해석.
- 변경: `collectRulesForElement` 끝에 cross-origin 머지 루프 추가. `getMatchingCrossOriginRules(el)`로 받은 각 rule의 `decls`(Map)를 **빈 prop만** `out`/`sources`(source = rule.source)에 채우고, `--*`는 `customProps`에 보충. `getCrossOriginCustomProps()`를 `customProps`에 병합(없는 키만). same-origin이 채운 prop은 덮지 않음(`out[name]`이 이미 있으면 skip — cascade 단순화). `extractVarPropsFromMap` 재사용 가능.
- `collectSpecifiedStylesWithSources`는 동기 유지. cross-origin 데이터는 `ensureCrossOriginLoaded` 완료 후 재수집 시점에만 채워져 있으면 됨(전역 상태 조회).

### `src/content/picker.ts`
- 현재 역할: `emitSelected(el)`가 `picker.selected`(동기) → `ensureCssCacheLoaded()` 후 `picker.selectionUpdated` 발송. `scheduleSelectionUpdate`도 동일.
- 변경: `ensureCssCacheLoaded()`(same-origin) 후 추가로 `ensureCrossOriginLoaded()`를 await하고, 그 다음 `collectSelection` 재수집 → `picker.selectionUpdated` 발송. 요소 변경 가드(`selectedEl !== el`) 동일 적용. cross-origin 보강은 same-origin 보강보다 늦게 도착할 수 있으므로 **두 번째 selectionUpdated**가 될 수 있음(멱등 갱신이라 무해).

### sidepanel / store
- 변경 없음. `usePickerMessages`의 `picker.selectionUpdated` → `updateSelectionStyles` → `mergeSelectionStyles` 경로를 그대로 재사용. `sectionDefaultOpen`은 specified가 채워지면 specified 기준으로 자연 동작(직전 픽스와 공존).

### `src/content/post-to-runtime.ts` / 메시지 헬퍼
- content → background 요청에 `sendBg` 사용. content script에서 `sendBg`가 import 가능한지 확인(현재 sidepanel 위주 — 불가하면 `chrome.runtime.sendMessage` Promise 래퍼를 content용으로 동일 패턴 추가). **pre-arm IIFE 제약 무관**(picker.ts 계열은 async loader 청크).

## 데이터 흐름

```
picker 선택
  └─ collectSelection (동기, same-origin specified만)
       └─ postToRuntime("picker.selected")           → store.onElementSelected
  └─ await ensureCssCacheLoaded()  (same-origin raw)
       └─ collectSelection 재수집 → "picker.selectionUpdated"  (기존)
  └─ await ensureCrossOriginLoaded()                  ← 신규
       ├─ cross-origin link href 수집
       ├─ sendBg("css.fetchSheets", {urls})           → background
       │     └─ permissions.contains(<all_urls>)?  →  fetch each → text
       ├─ parseStylesheet(text) → ParsedRule[]
       ├─ indexCrossOriginRules → crossOriginRules / crossOriginCustomProps
       └─ collectSelection 재수집 (cross-origin 머지) → "picker.selectionUpdated"
            └─ store.updateSelectionStyles → mergeSelectionStyles → UI 갱신
```

## 인터페이스 설계

```ts
// src/types/messages.ts — BgRequest union에 추가
interface CssFetchSheetsRequest {
  type: "css.fetchSheets";
  urls: string[];
}
interface CssFetchSheetsResult {
  sheets: Array<{ url: string; text: string }>; // 권한 없으면 빈 배열, 실패 url은 제외
}

// src/content/css-source-cache.ts
interface CrossOriginRule {
  selectorText: string;
  decls: Map<string, string>; // prop → raw value (ParsedRule.decls 재사용)
  source: string;             // "external · main.css"
}
interface CrossOriginIndexedRule extends CrossOriginRule {
  seq: number;
}
export function ensureCrossOriginLoaded(): Promise<void>;
export function getMatchingCrossOriginRules(el: Element): CrossOriginRule[];
export function getCrossOriginCustomProps(): Record<string, string>;
// 순수(테스트 대상)
export function indexCrossOriginRules(
  parsed: ParsedRule[], href: string, startSeq: number,
): CrossOriginIndexedRule[];
```

`ParsedRule`(`{ selectorText: string; decls: Map<string,string> }`)·`parseStylesheet`는 기존 css-source-cache 내부 구현 재사용(export 필요 시 노출).

## 기존 패턴 준수

- **background RPC**: `handleMessage` switch + `sendBg`/`BgResponse` 패턴, `BG_REQUEST_TYPES` 화이트리스트(GitHub/Notion fetch 핸들러와 동형).
- **권한 게이트**: `chrome.permissions.contains` (RecordingSettingsCard·tab-bindings 선례). 새 요청 UI 없음 — contains만.
- **selection 2-pass 보강**: `picker.selected` → `picker.selectionUpdated`(부분 갱신) 기존 흐름 확장. `mergeSelectionStyles`의 필드 정체성 보존 규칙 준수.
- **var 토큰 resolve**: `resolveVarChain` + `customProps` 누적 패턴 재사용(`--_` private만 펼침 규칙 불변).
- **테스트 우선**: `indexCrossOriginRules`·매칭 로직 단위 테스트(jsdom `el.matches`) 후 구현.
- **privacy/PERMISSION 문서**: 기존 `<all_urls>`를 **새 목적**(외부 CSS fetch)으로 사용 → manifest diff 0이어도 `docs/privacy.md`·`PERMISSION.md` 갱신 필수(CLAUDE.md 신선도 규칙, 30s Replay 전례).

## 대안 검토

- **통합 rule 인터페이스로 리팩터**: `getMatchingRules` 반환을 `{selectorText, getDecls()}` 추상화해 same/cross-origin을 한 경로로. → 기존 CSSStyleRule 기반 코드(shorthand explode·inline 처리)를 광범위 수정해야 하고 회귀면이 큼. **병행 경로(채택)**가 외과적.
- **content script에서 직접 cross-origin fetch**: ISOLATED world fetch는 페이지 CORS를 따라 cross-origin CSS 본문을 못 받음(opaque). background 위임이 유일.
- **CSSOM `getMatchedCSSRules`/DevTools Protocol**: 전자는 deprecated·cross-origin 동일 제약, 후자는 확장에서 디버거 권한 필요(과함). 기각.
- **required `<all_urls>` 승격으로 전원 동작**: 설치 경고 강화·재심사 리스크. 사용자 결정으로 optional 재사용 채택.

## 위험 요소

- **cascade 단순화**: "빈 prop만 채움 + same-origin 우선"이라 same/cross-origin이 같은 prop을 다른 specificity로 정의한 경우 실제 적용값과 다를 수 있음. 보강은 "비어 있던 걸 채우는" 용도라 허용 범위. 문서에 명시.
- **fetch 도착 타이밍**: cross-origin 보강이 늦게 와 두 번째 `selectionUpdated`가 편집 중 도착하면 입력값을 덮을 위험. `mergeSelectionStyles`가 `inlineEdits` 기반으로 편집값을 보존하는지 재확인 필요(기존 same-origin 2-pass도 동일 위험을 이미 처리).
- **권한 경계**: `permissions.contains`는 background에서 체크 — content가 url을 보내도 권한 없으면 fetch 0. 권한 우회 경로 없음.
- **성능**: cross-origin sheet가 여러 개·대용량(naver main.css 750KB)이면 fetch+파싱 비용. 1회 배치 + 멱등 캐시 + picker 세션 단위 무효화로 제한. 파싱은 기존 `parseStylesheet` 재사용(같은 비용 클래스).
- **e2e 권한 전제**: dist-e2e manifest는 host_permissions에 `<all_urls>`를 포함(captureVisibleTab용) → `permissions.contains`가 항상 true라 보강 경로가 e2e에서 자동 활성. 권한 미보유 분기는 단위/수동 테스트로 커버.
- **2번 픽스 상호작용**: 보강 성공 시 specified가 채워져 `sectionDefaultOpen`이 specified 기준으로 전환. 기존 `style-cross-origin-section.spec`(computed fallback 전제)은 보강 후에도 섹션이 펼쳐져 green 유지되지만, 단언이 "computed fallback"임을 의도와 어긋나지 않게 주석 보강 또는 spec 분리 검토.
