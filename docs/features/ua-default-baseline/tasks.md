# UA 기본값 기준선 — 구현 태스크

## 선행 조건

- **착수 전 `docs/POSTMORTEM.md`에서 2026-06-29(Transition 항상 펼침)·2026-06-28(유령 border-color) 두 항목 전문을 읽는다.** 이 기능은 그 두 회고의 재발 방지책을 구조로 바꾸는 작업이라, 원 증상을 모르면 검증 항목이 공허해진다.
- 권한·env·의존성 변경 **없음**.
- `css-cascade-fidelity`와 **독립**이다 — 순서 제약이 없고 병렬 진행 가능하다. 단 둘 다 `css-resolve.ts`를 건드리므로 같은 브랜치에서 동시 편집은 피한다.

---

## 태스크

### Task 1: 순수 비교 함수 (테스트 먼저)

- **변경 대상**: `src/content/css-resolve.ts`, `src/content/__tests__/css-resolve.test.ts`
- **작업 내용**:
  - 테스트를 먼저 써서 red를 만든다(CLAUDE.md 테스트 우선).
  - `propsMatchingBaseline(computed, baseline)` 구현. `baseline`이 `null`이면 `[]`.
  - 레이아웃 의존 prop 제외 상수를 함께 둔다:
    ```ts
    // display:none iframe엔 레이아웃이 없어 used value가 무의미하다. 비교 대상에서 뺀다.
    const LAYOUT_DEPENDENT = new Set([
      "width", "height", "min-width", "max-width", "min-height", "max-height",
    ]);
    ```
- **검증** — 단위 테스트:
  - [ ] `baseline === null` → `[]`
  - [ ] 값이 같은 prop만 반환 (`{color:"rgb(0,0,0)"}` vs 동일 → `["color"]`)
  - [ ] 값이 다르면 제외
  - [ ] `LAYOUT_DEPENDENT` prop은 값이 같아도 반환하지 않는다
  - [ ] baseline에만 있고 computed에 없는 키는 무시
  - [ ] `pnpm test` + `pnpm typecheck` 통과

### Task 2: `ua-baseline.ts` — iframe 수명 + tagName 캐시

- **변경 대상**: `src/content/ua-baseline.ts`(신규), `scripts/coverage-report.mjs`
- **작업 내용**:
  - design.md 골자대로 `getUaBaseline` / `disposeUaBaseline` / `removeOrphanBaselineFrame` 구현.
  - `unavailable` 래치 필수 — CSP 차단 페이지에서 요소 선택마다 재시도하면 콘솔이 위반 로그로 도배된다.
  - `doc.createElement(tagName)`을 try/catch로 감싼다.
  - `BROWSER_BOUND_EXACT`에 `"src/content/ua-baseline.ts"` 추가 (CLAUDE.md — 유닛 불가 런타임 파일 등재 규칙).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm coverage:report` 실행 시 새 파일이 로직 스코프 분모에 **들어가지 않는다**
  - [ ] 수동: `chrome://` 아닌 일반 페이지에서 picker 진입 후 `document.getElementById("__bugshot_ua_baseline__")`이 존재하고, 같은 태그 요소를 5개 연속 선택해도 `document.querySelectorAll("iframe").length`가 1만 증가한다

### Task 3: 페이로드 배선

- **변경 대상**: `src/types/picker.ts`, `src/content/css-resolve.ts`, `src/content/picker.ts`
- **작업 내용**:
  - `PickerSelectionPayload` / `PickerSelectionUpdatePayload`에 `uaDefaultProps?: string[]` 추가. **optional 필수** — 세션 스냅샷 복원 경로가 이 필드 없이 돌아온다.
  - `collectSelection`이 `getUaBaseline(el.tagName)` → `propsMatchingBaseline`으로 채운다.
  - `postSelectionUpdate`(`picker.ts:1123`)도 같은 필드를 싣는다.
  - `handleClear`에 `disposeUaBaseline()` 추가 (`inspectorCache = new WeakMap()` 옆).
  - `handleSelectByPath`의 overlay 재생성 경로(`picker.ts:1216-1221`)에 `removeOrphanBaselineFrame()` 추가 — `removeOrphanOverlay()`와 같은 자리.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] e2e에서 요소 선택 후 store의 `selection.uaDefaultProps`가 비어 있지 않다
  - [ ] picker 세션 종료 후 `document.querySelectorAll("iframe").length`가 세션 진입 전과 같다
  - [ ] `uaDefaultProps`를 `undefined`로 강제한 스냅샷 복원에서 패널이 정상 렌더된다

### Task 4: 판정 진입점 통합 (`isDefaultValue`)

이 태스크는 **동작 무변경 리팩터**다. UA 축은 Task 5에서 연결한다.

- **변경 대상**: `src/sidepanel/tabs/styleEditor/propMetadata.ts`, `sidepanel/lib/sectionDefaultOpen.ts`, `styleEditor/ValueCombobox.tsx`, `styleEditor/StylePropEditors.tsx`, `styleEditor/__tests__/propMetadata.test.ts`
- **작업 내용**:
  - `isDefaultValue(input)` 추가. 이 시점엔 `uaDefaultProps` 인자를 아무도 안 넘기므로 결과가 기존과 동일해야 한다.
  - 콜사이트 4곳을 교체(design.md 표).
  - **`isSpecified` 전달을 4곳 전부 확인한다** — 빠뜨리면 author가 명시한 값이 조용히 디밍된다.
  - `isKnownDefault`·`isInactiveBorderColor` export는 유지(기존 테스트가 직접 호출).
- **검증**:
  - [ ] `grep -rn "isKnownDefault\|isInactiveBorderColor" src/sidepanel | grep -v __tests__ | grep -v propMetadata.ts` 결과가 **0건** (전부 `isDefaultValue`를 거친다)
  - [ ] 기존 `propMetadata.test.ts`·`sectionDefaultOpen.test.ts` **무수정 통과**
  - [ ] `pnpm test:e2e -- style-` green — 동작 무변경이라 red가 나오면 교체를 잘못한 것

### Task 5: UA 축 연결

- **변경 대상**: `src/sidepanel/tabs/styleEditor/styleHooks.ts`, 콜사이트 4곳, `propMetadata.test.ts`
- **작업 내용**:
  - `useUaDefaultProps(): ReadonlySet<string>` 훅 추가. `useEditorStore((s) => s.selection?.uaDefaultProps)`를 읽고 `useMemo`로 `Set`을 고정한다 — 매 렌더 새 `Set`을 만들면 하위 `memo` 컴포넌트가 전부 깨진다.
  - 콜사이트 4곳이 이 훅의 결과를 `isDefaultValue`에 넘긴다. `sectionDefaultOpen`은 순수 함수라 인자로 받아 `StyleEditorPanel`에서 주입한다.
- **검증** — 단위 테스트 (`propMetadata.test.ts`):
  - [ ] `uaDefaultProps`에 있는 prop + `isSpecified: false` → `true`
  - [ ] `uaDefaultProps`에 있는 prop + `isSpecified: true` → `false` (author 명시가 우선)
  - [ ] `uaDefaultProps`가 `undefined` → 기존 판정과 동일 (폴백)
  - [ ] `isKnownDefault`가 true면 `isSpecified` 무관하게 `true` (기존 동작 보존)
  - [ ] `pnpm test` + `pnpm typecheck` 통과

### Task 6: 회귀 테스트 고정 (POSTMORTEM 2건)

- **변경 대상**: `src/sidepanel/lib/__tests__/sectionDefaultOpen.test.ts`, `e2e/`
- **작업 내용**: 두 회고의 원 증상을 테스트로 못 박는다.
  1. **Transition 항상 펼침** — `KNOWN_DEFAULTS`에서 `transition-*` 4개를 **일부러 뺀 상태**를 가정한 케이스: `uaDefaultProps`에 그 4개가 있으면 `sectionDefaultOpen`이 `false`를 돌려준다. 이게 "테이블 등록을 잊어도 안 터진다"의 증명이다.
  2. **유령 border-color** — `uaDefaultProps`에 `border-top-color`가 **없고**(기준선 글자색 ≠ 페이지 글자색) `border-top-style: none`일 때 여전히 `isInactiveBorderColor`가 잡아 `true`가 된다. UA 축이 이 케이스를 못 잡는다는 것을 테스트로 명시한다.
- **검증**:
  - [ ] 두 케이스가 테스트로 존재하고 통과
  - [ ] 각 테스트에 POSTMORTEM 날짜를 주석으로 남긴다

---

## 테스트 계획

### 단위 테스트

| 대상 | 파일 | 케이스 |
|---|---|---|
| `propsMatchingBaseline` | `content/__tests__/css-resolve.test.ts` | Task 1 검증 항목 5건 |
| `isDefaultValue` | `styleEditor/__tests__/propMetadata.test.ts` | Task 5 검증 항목 4건 |
| `sectionDefaultOpen` | `lib/__tests__/sectionDefaultOpen.test.ts` | Task 6 회귀 2건 + 기존 케이스 유지 |

`getUaBaseline`은 jsdom의 iframe `contentDocument`가 실제 UA 스타일을 재현하지 않아 **유닛 대상이 아니다**. e2e와 수동이 그물이다.

### e2e 시나리오 (`/e2e-write`의 입력)

신규 spec `e2e/style-ua-baseline.spec.ts`. fixture는 `e2e/fixtures/pages/basic.html`에 요소를 추가하거나 신규 페이지를 둔다.

1. transition이 전혀 없는 요소를 선택하면 **Transition 섹션이 접힌 채로 뜬다**.
2. `transition: opacity 200ms`가 걸린 요소를 선택하면 **Transition 섹션이 펼쳐진 채로 뜬다**.
3. `border` 선언이 전혀 없는 요소를 선택하면 **Border 섹션이 접힌 채로 뜨고 border-color 필드에 색이 실값처럼 표시되지 않는다**.
4. picker 세션 진입 → 요소 3개 선택 → 세션 종료 후 **페이지의 `iframe` 개수가 진입 전과 같다**.
5. CSP `frame-src 'none'` fixture 페이지에서 요소를 선택하면 **패널이 정상 렌더되고 섹션 펼침이 변경 전과 같다** (폴백 경로).
6. picker 세션 중 console/network 로그의 origin 목록에 **`about:blank`가 나타나지 않는다** (design.md 위험 6).

### 수동 테스트 (Chrome)

`pnpm build` 선행 필요 — dist가 stale이면 헛테스트다.

- [ ] `<table>`/`<td>`/`<li>`/`<input>`/`<svg>` 등 UA 기본이 특이한 태그를 선택했을 때 섹션 펼침이 자연스러운지 (특히 Table 섹션의 `border-collapse`·`vertical-align`)
- [ ] 커스텀 엘리먼트(`<my-widget>`)를 선택했을 때 오류 없이 동작하는지
- [ ] `notion.so`처럼 CSP가 빡빡한 사이트에서 폴백이 조용히 동작하는지 (콘솔에 반복 CSP 위반이 없어야 한다)
- [ ] 같은 태그를 연속 선택할 때 체감 지연이 없는지 (캐시 확인)
- [ ] 시각 회귀: picker 세션 중 페이지 렌더가 변하지 않고, 캡처한 스크린샷에 빈 프레임 흔적이 없는지

## 구현 순서 권장

```
Task 1 (순수 비교)  ┐
                    ├─► Task 3 (배선) ──► Task 5 (UA 축 연결) ──► Task 6 (회귀 고정)
Task 2 (iframe)     ┘                 ▲
                                      │
Task 4 (판정 통합, 동작 무변경) ───────┘
```

- **Task 1·2·4는 서로 독립** — 병렬 가능. 4는 content script를 전혀 안 건드린다.
- **Task 4를 별도 커밋으로 끊는다.** 동작 무변경 리팩터라 여기까지 e2e가 green이어야 하고, 그 green이 Task 5 이후 회귀를 판정하는 기준점이 된다.
- Task 3은 1·2 둘 다 필요. Task 5는 3·4 둘 다 필요.

## 가이드 영향

**없음.** 사용자 노출 문자열·조작 방식이 변하지 않는다 — 같은 화면에서 섹션 펼침과 값 디밍이 더 정확해질 뿐이다.

`docs/privacy.{ko,en}.md`는 **대조 대상이다.** 새 캡처·수집·전송은 없지만 `about:blank` iframe을 페이지에 삽입하는 **새 DOM 동작**이 생긴다. 프라이버시 문서는 "권한 문자열이 아니라 실제 동작에 묶인다"(CLAUDE.md)는 규칙이 있으므로, 구현 후 다음을 확인해 기록한다: 이 iframe은 네트워크 요청을 하지 않고, 페이지 콘텐츠를 복사하지 않으며(`innerHTML` 미복사 — 명시적 설계 결정), 세션 종료 시 제거된다. **대조 결과 갱신 불필요라고 판단되면 그 판단 자체를 커밋 메시지에 남긴다.**
