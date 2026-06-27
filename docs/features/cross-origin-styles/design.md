# Cross-origin 스타일 보강 — 기술 설계

## 개요

cross-origin stylesheet는 `cssRules` 접근이 `SecurityError`라 CSSStyleRule 인스턴스를 얻을 수 없다. 따라서 기존 same-origin 경로(CSSOM rule 인스턴스를 key로 한 raw 매핑)에 끼워넣을 수 없고, **background가 fetch한 원문 CSS 텍스트를 `parseStylesheet`로 파싱한 `ParsedRule`을 `el.matches(selectorText)`로 직접 매칭하는 병행 경로**를 추가한다. content(ISOLATED)는 cross-origin을 직접 fetch할 수 없으므로 background에 위임하고, background는 **스킴·사설 IP 가드를 통과한 href만** fetch한다(`<all_urls>`가 required라 권한 게이트는 불필요 — 항상 보유. 차단/실패 url은 결과에서 제외 → 조용히 skip). 보강된 specified/소스는 기존 `picker.selectionUpdated` 메시지로 sidepanel에 합류하며, 소스 라벨은 same-origin과 동일하게 셀렉터 텍스트를 재사용한다(전용 출처 파일명 UI 없음 — descope).

## 변경 범위

### `src/background/messages.ts` (+ `bgRequestTypes.ts`, `src/types/messages.ts`)
- 현재 역할: `handleMessage()`가 `switch (message.type)`로 background RPC를 디스패치. host_permissions origin을 CORS 우회 fetch(GitHub/Notion API 선례).
- 변경: 새 메시지 타입 `css.fetchSheets` 핸들러 추가. 입력 `{ urls: string[] }`, 출력 `{ sheets: Array<{ url: string; text: string }> }`. **권한 게이트 없음**(`<all_urls>` required). 각 url을 **SSRF 가드**(순수 함수 `isFetchableSheetUrl`: `http(s)` 스킴만 허용 + loopback·link-local·사설 IP 차단)로 필터 → 통과분만 `Promise.allSettled(urls.map(u => fetch(u,{credentials:"omit"})))` → `res.ok` && `content-type`이 CSS류면 `res.text()`, 그 외/네트워크 실패는 결과에서 제외(부분 성공 허용). `BG_REQUEST_TYPES` Set과 `BgRequest`/`BgResponse` union에 타입 추가. 가드는 단위 테스트로 고정.

### `src/content/css-source-cache.ts`
- 현재 역할: `ensureLoaded()`가 모든 sheet를 로드해 raw CSS를 CSSStyleRule에 매핑. `fetchSheetText`가 cross-origin을 skip. `getMatchingRules(el)`은 same-origin CSSStyleRule[] 반환.
- 변경:
  - `loadSheet()`의 cross-origin link 분기: 현재 `fetchSheetText` → null로 끝나는 대신, cross-origin link href를 **수집만** 해 둔다(여기서 직접 background 호출하지 않고 별도 단계로 모아 1회 배치 fetch).
  - 새 모듈 전역: `crossOriginRules: CrossOriginIndexedRule[]`, `crossOriginCustomProps: Record<string,string>`.
  - 새 export `ensureCrossOriginLoaded(): Promise<void>` — cross-origin link href 목록을 모아 `sendBg({type:"css.fetchSheets", urls})` 1회 호출 → 응답 텍스트를 `parseStylesheet`로 파싱 → `indexCrossOriginRules`로 seq 부여해 `crossOriginRules`에 적재(소스 라벨은 별도 부여 안 함 — css-resolve가 `selectorText`를 source로 사용), `:root`/전역 `--*` 선언은 `crossOriginCustomProps`에 수집. 멱등(loadPromise 패턴). `invalidate()`에서 함께 초기화.
  - 새 export `getMatchingCrossOriginRules(el: Element): CrossOriginRule[]` — `crossOriginRules`를 `el.matches(selectorText)`로 필터 + seq 정렬해 반환. `el.matches`는 malformed/비표준 selector에서 throw할 수 있으므로 **try-catch로 감싸 해당 rule만 skip**(same-origin `getMatchingRules`의 동일 가드 유무 확인 후 맞춤).
  - 새 export `getCrossOriginCustomProps(): Record<string,string>`.
  - 순수 헬퍼 `indexCrossOriginRules(parsed: ParsedRule[], href: string, startSeq: number): CrossOriginIndexedRule[]` (단위 테스트 대상 — DOM 불필요).

### `src/content/css-resolve.ts`
- 현재 역할: `collectRulesForElement(el, out, sources, customProps, wantedProps?)`가 `getMatchingRules`로 same-origin rule을 머지. `collectSpecifiedStylesWithSources`가 이를 호출하고 `resolveVarChain`으로 토큰 해석.
- 변경: `collectRulesForElement` 끝에 cross-origin 머지 루프 추가. `getMatchingCrossOriginRules(el)`로 받은 각 rule의 `decls`(Map)를 **빈 prop만** `out`/`sources`(source = `rule.selectorText` — same-origin과 동일 라벨)에 채우고, `--*`는 `customProps`에 보충. `getCrossOriginCustomProps()`를 `customProps`에 병합(없는 키만). same-origin이 채운 prop은 덮지 않음(`out[name]`이 이미 있으면 skip — cascade 단순화). `extractVarPropsFromMap` 재사용 가능.
- `collectSpecifiedStylesWithSources`는 동기 유지. cross-origin 데이터는 `ensureCrossOriginLoaded` 완료 후 재수집 시점에만 채워져 있으면 됨(전역 상태 조회).

### `src/content/picker.ts`
- 현재 역할: `emitSelected(el)`가 `picker.selected`(동기) → `ensureCssCacheLoaded()` 후 `picker.selectionUpdated` 발송. `scheduleSelectionUpdate`도 동일.
- 변경: `ensureCssCacheLoaded()`(same-origin) 후 추가로 `ensureCrossOriginLoaded()`를 await하고, 그 다음 `collectSelection` 재수집 → `picker.selectionUpdated` 발송. **요소 변경 가드는 두 경로 모두에 적용**: `emitSelected`는 이미 `selectedEl !== el` 가드가 있으나 `scheduleSelectionUpdate`는 await 후 재확인이 없으므로, cross-origin await(fetch+파싱 수백 ms) 뒤 `selectedEl !== target` 재확인을 **추가**한다. cross-origin 보강은 same-origin보다 늦게 도착할 수 있으므로 **두 번째 selectionUpdated**가 될 수 있음(멱등 갱신이라 무해).
- **payload에 selector 동봉**: 수신부 가드(아래)를 위해 `picker.selectionUpdated` 페이로드에 현재 요소 selector를 포함시킨다.

### sidepanel / store
- **수신부 stale 가드 추가**: 현재 `usePickerMessages`/`updateSelectionStyles`에는 요소 식별 가드가 없어, A요소의 늦은 cross-origin 보강이 B선택 중 도착하면 `mergeSelectionStyles`가 B baseline에 A patch를 머지해 맵이 오염될 수 있다. → `picker.selectionUpdated` 핸들러가 페이로드 selector와 현재 `selectedElement` selector를 비교해 **불일치면 무시**(`picker.selected` 핸들러의 selector 재확인 패턴과 동형). 회귀 테스트 동반.
- 그 외는 `picker.selectionUpdated` → `updateSelectionStyles` → `mergeSelectionStyles` 경로를 재사용. `mergeSelectionStyles`는 `inlineEdits` 키를 force-restore하므로 **편집 중 prop은 늦은 보강이 덮지 않는다(검증 완료)** — 단, 그 때문에 편집한 prop에는 cross-origin 값이 반영 안 되는 트레이드오프가 있다(위험 요소 참조). `sectionDefaultOpen`은 specified가 채워지면 specified 기준으로 전환되므로 **부분 보강 회귀**(아래)에 주의.

### `src/content/post-to-runtime.ts` / 메시지 헬퍼
- content → background 요청에 **기존 `sendBg`(`src/types/messages.ts`) 재사용** 확정 — 공유 모듈이라 content에서 import 가능(CTO 검증). picker가 쓰는 `postToRuntime`은 fire-and-forget이라 sheets 응답을 못 받으므로 부적합. **pre-arm IIFE 제약 무관**(picker.ts 계열은 async loader 청크 — content_scripts[0], self-contained IIFE 청크 아님).

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
       │     └─ SSRF 가드 통과 url만  →  fetch each → text
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
  sheets: Array<{ url: string; text: string }>; // 가드 차단·실패 url은 제외
}

// src/content/css-source-cache.ts
interface CrossOriginRule {
  selectorText: string;       // 소스 라벨로도 재사용(descope — external·filename 없음)
  decls: Map<string, string>; // prop → raw value (ParsedRule.decls 재사용)
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
- **SSRF 가드**: 기존 background fetch는 host 하드코딩(GitHub `api.github.com`·Notion `api.notion.com`)이라 URL이 페이지 제어 대상이 아니었다. 이번엔 처음으로 페이지 제어 href를 fetch하므로 스킴·사설 IP 가드를 **신설**(순수 함수+단위 테스트). 권한 게이트는 없음(`<all_urls>` required, 코드베이스에 `chrome.permissions.contains` 사용처 0건이라 새 선례 도입도 아님).
- **selection 2-pass 보강**: `picker.selected` → `picker.selectionUpdated`(부분 갱신) 기존 흐름 확장. `mergeSelectionStyles`의 필드 정체성 보존 규칙 준수.
- **var 토큰 resolve**: `resolveVarChain` + `customProps` 누적 패턴 재사용(`--_` private만 펼침 규칙 불변).
- **테스트 우선**: `indexCrossOriginRules`·매칭 로직 단위 테스트(jsdom `el.matches`) 후 구현.
- **privacy/PERMISSION 문서**: 기존 `<all_urls>`를 **새 목적**(외부 CSS fetch)으로 사용 → manifest diff 0이어도 `docs/privacy.md`·`PERMISSION.md` 갱신 필수(CLAUDE.md 신선도 규칙, 30s Replay 전례).

## 대안 검토

- **통합 rule 인터페이스로 리팩터**: `getMatchingRules` 반환을 `{selectorText, getDecls()}` 추상화해 same/cross-origin을 한 경로로. → 기존 CSSStyleRule 기반 코드(shorthand explode·inline 처리)를 광범위 수정해야 하고 회귀면이 큼. **병행 경로(채택)**가 외과적.
- **content script에서 직접 cross-origin fetch**: ISOLATED world fetch는 페이지 CORS를 따라 cross-origin CSS 본문을 못 받음(opaque). background 위임이 유일.
- **CSSOM `getMatchedCSSRules`/DevTools Protocol**: 전자는 deprecated·cross-origin 동일 제약, 후자는 확장에서 디버거 권한 필요(과함). 기각.
- **(해소됨) optional `<all_urls>` 재사용 한정**: 본 feature 초안은 optional 권한 보유자만 동작이었으나, `docs/features/all-urls-required/`가 `<all_urls>`를 required로 승격해 전원 동작으로 단순화됨 → 권한 게이트·미보유 분기 제거.

## 위험 요소

- **🔴 SSRF**: content가 보낸 임의 href를 background가 `<all_urls>`로 fetch하고 본문을 content로 반환한다. 악성 페이지가 `<link rel=stylesheet href="http://169.254.169.254/latest/meta-data/...">`·`http://localhost:6379/...`·사설 IP를 주입하면 내부망/메타데이터 본문이 동일 출처 isolated world로 exfil될 수 있다. content의 기존 `url.origin !== location.origin` 가드를 background로 옮기면 사라지므로, background 핸들러에 가드(`http(s)` 스킴만 + loopback·link-local·사설 IP 차단, `credentials:"omit"`)를 신설하고 **단위 테스트로 고정**. `credentials:"omit"`은 IMDSv1·비인증 내부 엔드포인트엔 무력하므로 IP/스킴 차단이 본 방어선.
- **🔴 부분 보강 → 섹션 재접힘 회귀(fa81d63 전제 붕괴)**: 직전 픽스(`sectionDefaultOpen`)는 "cross-origin ⇒ specified 빔 ⇒ computed fallback으로 펼침"이 전제다. 보강이 specified를 채우면 `sectionDefaultOpen`이 specified 분기로 복귀 → **일부 sheet만 fetch 성공**하면 specified 없는 섹션이 다시 접혀 "값 있는데 안 보임" 회귀가 재현된다. 또 "기존 `style-cross-origin-section.spec` green 유지"는 **틀린 안전망**(specified 분기로 green이지만 computed fallback 분기를 더는 안 밟음). → ① 보강 실패 시 computed-only fallback이 유지되는 케이스를 별도 보존, ② 부분 보강 e2e 추가, ③ `sectionDefaultOpen.test.ts`에 "cross-origin specified 채워짐" 케이스 추가.
- **🔴/🟡 stale selectionUpdated 머지**: cross-origin fetch 지연으로 A요소 보강이 B선택 중 도착할 윈도우가 넓어진다. `scheduleSelectionUpdate` await 후 가드 + 수신부 selector 가드(위 sidepanel/store) 둘 다 필요. 회귀 테스트 동반.
- **성능**: cross-origin sheet가 여러 개·대용량(naver main.css 750KB)이면 fetch+파싱 비용이 **신규 부하**(기존엔 same-origin sheet만 파싱). `parseStylesheet`는 char 단위 상태머신이라 content 스레드를 블록한다 — "같은 비용 클래스"가 아니라 sheet 수·바이트가 증가. 1회 배치 + 멱등 캐시 + picker 세션 단위 무효화 + **sheet당 사이즈 캡**으로 제한.
- **편집 prop의 cross-origin 값 드롭(🟡)**: `mergeSelectionStyles`가 편집 중 prop을 pass-1 baseline(cross-origin-empty)으로 복원하므로, 늦게 온 cross-origin specified가 **편집한 prop에서는 안 보인다**. 편집값 보존의 트레이드오프 — 허용 범위지만 단위 테스트로 동작을 고정.
- **cascade 단순화**: "빈 prop만 채움 + same-origin 우선"이라 same/cross-origin이 같은 prop을 다른 specificity로 정의한 경우 실제 적용값과 다를 수 있음. 보강은 "비어 있던 걸 채우는" 용도라 허용 범위. 문서에 명시.
- **e2e 전제**: dist-e2e manifest는 `<all_urls>`를 required로 포함 → 보강 경로가 e2e에서 자동 활성. 권한 미보유 분기는 **존재하지 않으므로**(required) 별도 커버 불필요. fetch 실패/가드 차단 fallback은 fixture로 자동 판정.
