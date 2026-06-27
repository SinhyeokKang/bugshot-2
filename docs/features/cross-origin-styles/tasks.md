# Cross-origin 스타일 보강 — 구현 태스크

## 선행 조건

- 권한·env 변경 없음. `<all_urls>`는 기존 optional 유지. 새 OAuth/외부 엔드포인트 없음.
- 동작 검증에는 `<all_urls>` grant 상태가 필요 — 로컬은 Replay 토글로 1회 허용, e2e는 dist-e2e manifest가 이미 `<all_urls>` 포함.
- `parseStylesheet`/`ParsedRule`이 css-source-cache 내부 비공개 — 재사용을 위해 export 또는 동일 모듈 내 사용 여부 먼저 확인.

## 태스크

### Task 1: background `css.fetchSheets` 메시지 핸들러
- **변경 대상**: `src/types/messages.ts`, `src/background/bgRequestTypes.ts`, `src/background/messages.ts`
- **작업 내용**: `BgRequest` union에 `{ type: "css.fetchSheets"; urls: string[] }` + 결과 타입 `{ sheets: Array<{url:string;text:string}> }` 추가. `BG_REQUEST_TYPES`에 `"css.fetchSheets"` 추가. `handleMessage` switch에 case 추가: `chrome.permissions.contains({origins:["<all_urls>"]})`가 false면 `{sheets:[]}`; true면 `Promise.allSettled(urls.map(u => fetch(u,{credentials:"omit"}).then(r => r.ok ? r.text() : null)))` → 성공·non-null만 `{url,text}`로 수집.
- **검증**:
  - [ ] 단위: 핸들러 로직을 순수 함수로 분리 가능하면 권한 false→빈배열, 일부 실패→부분결과 케이스 테스트. (fetch/chrome 모킹 부담 크면 e2e로 대체)
  - [ ] `pnpm typecheck` 통과 (union·Set 타입 정합)

### Task 2: cross-origin rule 인덱싱 순수 헬퍼
- **변경 대상**: `src/content/css-source-cache.ts` (+ `__tests__/`)
- **작업 내용**: `indexCrossOriginRules(parsed, href, startSeq): CrossOriginIndexedRule[]` 구현 — 각 ParsedRule에 `seq`(startSeq부터) + `source`(`external · <basename(href)>`) 부여. `:root`/전역 `*` 선택자의 `--*` 선언을 분리 수집하는 헬퍼도(또는 동일 함수 반환에 customProps 포함).
- **검증**:
  - [ ] 단위: ParsedRule 입력 → seq 연속·source 포맷·`--*` 분리 검증
  - [ ] `pnpm test` 통과

### Task 3: cross-origin 로드·매칭 API
- **변경 대상**: `src/content/css-source-cache.ts`
- **작업 내용**: 모듈 전역 `crossOriginRules`·`crossOriginCustomProps` 추가. `ensureCrossOriginLoaded()` — cross-origin link href 수집(`collectAllSheets` 중 `url.origin !== location.origin`인 `<link>`) → `sendBg("css.fetchSheets",{urls})` → 각 text `parseStylesheet` → `indexCrossOriginRules` 적재. 멱등(loadPromise). `getMatchingCrossOriginRules(el)`(el.matches 필터+seq sort), `getCrossOriginCustomProps()`. `invalidate()`에 초기화 추가. content용 `sendBg` 래퍼 없으면 추가.
- **검증**:
  - [ ] 단위(jsdom): `crossOriginRules`에 주입한 규칙이 `el.matches`로 올바로 필터·정렬되는지 (매칭 로직을 인자 받는 순수 함수로 빼면 테스트 용이)
  - [ ] 권한 없을 때(빈 응답) `crossOriginRules` 비고 throw 없음

### Task 4: collectRulesForElement에 cross-origin 머지
- **변경 대상**: `src/content/css-resolve.ts`
- **작업 내용**: `collectRulesForElement` 끝에 `getMatchingCrossOriginRules(el)` 루프 추가 — 각 rule.decls를 `out`에 **빈 prop만** 채우고 `sources[prop]=rule.source`, `--*`는 `customProps` 보충. `getCrossOriginCustomProps()`를 `customProps`에 없는 키만 병합. same-origin이 채운 prop은 불변(덮지 않음). 상속(`INHERITED_PROPS`) 부모 순회에도 동일 적용되는지 확인.
- **검증**:
  - [ ] 단위(jsdom): cross-origin 규칙 주입 후 `collectSpecifiedStylesWithSources(el)`가 specified·source를 채우고 `var()` 토큰이 cross-origin customProps로 해석되는지
  - [ ] same-origin 우선: 같은 prop이 both면 same-origin 값 유지
  - [ ] `pnpm test` 통과

### Task 5: picker 보강 흐름 연결
- **변경 대상**: `src/content/picker.ts`
- **작업 내용**: `emitSelected`/`scheduleSelectionUpdate`에서 `ensureCssCacheLoaded()` 후 `await ensureCrossOriginLoaded()` 추가 → 요소 변경 가드 통과 시 `collectSelection` 재수집 → `picker.selectionUpdated` 발송. same-origin 보강과 cross-origin 보강이 각각 selectionUpdated를 보낼 수 있음(멱등).
- **검증**:
  - [ ] e2e(아래 시나리오)에서 specified 보강 도착 확인
  - [ ] 요소 빠르게 전환 시 stale 보강이 반영 안 되는지(가드 동작)

### Task 6: 문서 갱신 (privacy / PERMISSION)
- **변경 대상**: `docs/privacy.md`, `PERMISSION.md`
- **작업 내용**: 기존 `<all_urls>` 권한을 **외부 stylesheet fetch**라는 새 목적에 사용함을 명시(시행일 포함). PERMISSION.md의 `<all_urls>` 용도 목록에 "cross-origin 스타일시트 원문 fetch(스타일 보강)" 추가.
- **검증**:
  - [ ] privacy.md에 cross-origin CSS fetch 동작·목적·시행일 반영
  - [ ] `/push` 신선도 검사 통과

## 테스트 계획

- **단위 테스트**:
  - `indexCrossOriginRules`: seq 연속성, `source` 포맷(`external · main.css`), `--*` 분리 (Task 2)
  - cross-origin 매칭 순수 함수: 선택자별 `el.matches` 필터·seq 정렬 (jsdom, Task 3)
  - `collectSpecifiedStylesWithSources` + cross-origin: 빈 prop 채움, same-origin 우선, `var()` 해석 (jsdom, Task 4)
- **e2e 시나리오** (`/e2e-write` 입력):
  - cross-origin stylesheet(127.0.0.1 페이지 + localhost CSS)에서만 스타일받는 `#target`을 선택하면, 스타일 필드에 author 값(예: `padding` 12px, `background-color`)이 채워진다.
  - 그 prop의 소스 툴팁/표시가 `external · <파일명>`을 포함한다.
  - cross-origin CSS의 `var(--token)`로 정의한 prop이 토큰 문자열이 아니라 해석된 실제 값으로 표시된다.
  - 기존 `style-cross-origin-section.spec`이 보강 후에도 green(섹션 펼침 유지).
  - 기존 same-origin 스타일 spec(style-edit-flow 등) 회귀 없음.
  - 픽스 임시 롤백 시 빨강(보강 경로 제거하면 specified 빈 채로 남음) — 회귀 검출력 확인.
- **수동 테스트** (Chrome, 자동화 불가):
  - 실제 naver.com 로그인 버튼 선택 → Replay로 `<all_urls>` 허용 후 specified·소스·var 값 노출 확인.
  - `<all_urls>` 미허용 상태에서 네트워크 탭에 cross-origin CSS fetch가 0건인지 + computed fallback 유지 확인.

## 구현 순서 권장

- Task 1(background) · Task 2(인덱싱 순수) 병렬 가능 — 서로 독립.
- Task 3은 Task 1·2 완료 후(둘 다 의존).
- Task 4는 Task 3 후. Task 5는 Task 3·4 후.
- Task 6 문서는 언제든(권장: 구현 green 후 `/push` 전).
- 권장: 1·2 → 3 → 4 → 5 → e2e → 6.

## 가이드 영향

- `guide/ko`·`guide/en`의 element 스타일 편집 페이지: cross-origin(외부 CDN) 스타일도 권한이 있으면 읽어 채운다는 한 줄 보강 — **단 새 UI/토글이 없는 자동 동작**이라 사용자 노출 surface가 작음. `guide/AUTHORING.md` 확인 후 `/guide`로 판단(추가 가치 낮으면 "없음" 처리 가능).
- privacy.md·PERMISSION.md는 가이드가 아니라 Task 6에서 직접 갱신.
