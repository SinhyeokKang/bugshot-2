# 액션 로그 인라인 텍스트 디자인 강화 — 구현 태스크

## 선행 조건
- 권한·env·OAuth·외부 API 변경 없음. 새 의존성 없음.
- `actionLog.role.*` i18n 키는 `src/log-viewer/markers.ts`에서 사용 중 → 삭제 금지.
- 색 토큰은 기존 팔레트 차용: 태그명 `text-sky-600 dark:text-sky-400`, type 속성명 `text-amber-600 dark:text-amber-400`, 속성값 `text-red-700 dark:text-red-400`, 링크 `text-blue-600 underline dark:text-blue-400`.

## 태스크

### Task 1: 순수 함수 + 단위 테스트 (`actionInline.ts`)
- **변경 대상**: `src/sidepanel/lib/actionInline.ts`(신규), `src/sidepanel/lib/__tests__/actionInline.test.ts`(신규)
- **작업 내용**: `splitTemplate`(정규식 `/(\{[a-zA-Z_][a-zA-Z0-9_]*\})/` — **슬롯 명명 규칙**만 locales 테스트와 일치, 정규식 자체는 split용이라 중괄호 포함 캡처), `resolveClickTarget`(target→tagName/tagType→selector→empty), `shouldRenderChip(value, masked)`. TDD 우선.
- **검증**:
  - [x] `splitTemplate("Entered {value} in {field}")` → text/slot 4토큰
  - [x] `splitTemplate("{target} 클릭")` → slot + text
  - [x] `splitTemplate("Recording started")` → text 1토큰
  - [x] `splitTemplate("{a}{b}")` → slot,slot (빈 문자열 없음)
  - [x] 슬롯명에 `_`/숫자 포함 시에도 토큰 인식 (정규식 일치 확인)
  - [x] `resolveClickTarget({target:"Save"})` → name
  - [x] `resolveClickTarget({target:""})` → tag/empty 폴백 (빈 문자열은 name으로 안 빠짐 — `trim()` truthy 가드)
  - [x] `resolveClickTarget({tagName:"button",tagType:"submit"})` → tag(+tagType)
  - [x] `resolveClickTarget({tagName:"div"})` → tag(tagType 없음)
  - [x] `resolveClickTarget({selector:"div.foo"})` → name(레거시)
  - [x] `resolveClickTarget({})` → empty
  - [x] `shouldRenderChip("x", false)` → true / `shouldRenderChip("", false)` → false / `shouldRenderChip(undefined, false)` → false / `shouldRenderChip("", true)` → true (masked는 항상 칩)
  - [x] `pnpm test -- actionInline` green

### Task 2: 데이터 타입 확장
- **변경 대상**: `src/types/action.ts`
- **작업 내용**: `ActionEntry`에 `tagName?: string`, `tagType?: string`(click 전용 주석).
- **검증**: [ ] `pnpm typecheck` 통과

### Task 3: recorder 태그 캡처
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**: `CapturedAction`에 `tagName?`/`tagType?`. `recordClick`에서 `tagName: el.tagName.toLowerCase()`, `tagType: el.getAttribute("type") ?? undefined`. 빈 접근성 이름은 `target`을 `undefined`로 정규화(`name || undefined`)해 tag 모드 진입 보장.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] `import type`만 추가됐는지 확인(동기 IIFE 제약 — 런타임 외부 import 0 유지)
  - [ ] (간접) Task 7 e2e에서 tagName 채워짐 확인

### Task 4: 공용 컴포넌트 (`InlineLink`, `InlineChip`)
- **변경 대상**: `src/sidepanel/components/InlineLink.tsx`(신규), `src/sidepanel/components/InlineChip.tsx`(신규)
- **작업 내용**:
  - `InlineLink`: `text-blue-600 underline dark:text-blue-400` + `className` 병합, `target="_blank" rel="noopener noreferrer"`, `title?`, children 미지정 시 href.
  - `InlineChip`: `rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs [box-decoration-break:clone] break-words`. `muted`→`border-dashed text-muted-foreground`. `aria-label` passthrough.
  - 두 컴포넌트는 i18n 비의존.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] (Task 6 시각) 칩 흰배경+rounded-md, 마스킹 점선, 링크 blue+underline

### Task 5: ActionLogContent 렌더 교체
- **변경 대상**: `src/sidepanel/components/ActionLogContent.tsx`
- **작업 내용**:
  - `ClickTarget`(색 규칙대로, 괄호 `aria-hidden`), `renderVerb`, `renderActionContent`, `fieldText` 추가.
  - 값 칩: input은 masked→`InlineChip muted aria-label="masked value"` children `MASKED_DISPLAY`, 아니면 `shouldRenderChip` 통과 시 `InlineChip`. select/keypress도 `shouldRenderChip` 가드 후 `InlineChip`.
  - toggle은 value로 check/uncheck 키 분기 후 renderVerb.
  - navigation은 `InlineLink`.
  - `ActionRow` 보간 블록 → `{renderActionContent(t, entry)}`, span에 `leading-relaxed`. 텍스트 span의 `break-all` → `break-words`로 변경(칩 글자 중간 분할 방지 — 값/URL은 칩·링크로 감싸므로 단어 단위 줄바꿈으로 충분).
  - 고아 `roleWord`/`clickTarget`/`NavigateText` 제거.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] `pnpm test` 전체 green (locales 대칭 포함)
  - [x] grep으로 `roleWord`/`clickTarget`/`NavigateText` 잔존 0
  - [x] `searchText` 미변경 — 칩 래핑 후에도 검색 동작(target/value 등 매칭) 유지
  - [x] role 단어(`button`/`link`) 미표시는 **의도된 동작**(회귀 아님)

### Task 6: 콘솔 링크 공용화 + log-viewer i18n 감사
- **변경 대상**: `src/sidepanel/components/ConsoleLogContent.tsx`, `src/log-viewer/i18n.ts`
- **작업 내용**:
  - `ConsoleLogContent.tsx:257`의 페이지 URL `<a>` → `<InlineLink href={entry.pageUrl} className="block text-xs">{entry.pageUrl}</InlineLink>`(시각 동일, `data-testid` 미전달 — 콘솔 링크 오염 방지).
  - `log-viewer/i18n.ts`에 `actionLog.verb.keypress`/`toggle.check`/`toggle.uncheck`/`select` 키 존재 확인, 누락 시 `logs.ts`와 동일 문자열로 ko/en 보강. **이 누락은 신규 회귀가 아닌 선재 버그**(`markers.ts:128-139`도 동일 키 호출, log-viewer `t()`는 미스 시 raw 키 반환) — 동반 수정.
- **검증**:
  - [x] `pnpm typecheck`·`pnpm test` 통과
  - [ ] (시각) 콘솔 로그 페이지 URL 링크 무회귀
  - [x] log-viewer에서 keypress/toggle/select 액션 렌더 시 키 미스 없음
  - [ ] (시각) 보강 후 `markers.ts` 영상 마커 라벨도 raw 키 대신 정상 동사 노출(선재 버그 동반 수정 확인)

### Task 7: 빌드 시각 검증
- **변경 대상**: 없음(빌드만)
- **작업 내용**: 사용자가 `/build` 또는 `pnpm build` 후 Chrome 재로드.
- **검증**:
  - [ ] 사이드패널 액션 탭에서 PRD 9개 시나리오 시각 확인
  - [ ] 로그 뷰어(영상 동기화)에서 동일 렌더
  - [ ] 좁은 패널(~400px)에서 긴 값/멀티 select 칩 줄바꿈 시 박스 라운드 유지
  - [ ] 다크모드 색 대비(sky/amber/red/blue)
  - [ ] 콘솔 로그 페이지 URL 링크 무회귀

### Task 8: e2e (선택 — `/e2e-write`)
- **변경 대상**: `e2e/` spec, e2e fixture(`actions.html`), 필요 시 `data-testid` 추가
- **작업 내용**: 기존 `e2e/replay-action-log.spec.ts`(Replay→drafting→action-log-card→다이얼로그 진입 패턴)에 칩/태그/링크 assertion을 **얹는다**(신규 진입 흐름 재작성 회피).
  - **fixture 보강**: tag 모드(이름 없는 클릭) 판정을 위해 `actions.html`에 접근성 이름 없는 인터랙티브 요소(예: `<button type="submit"></button>` 또는 `<div role="button"></div>`) 추가. 현재 fixture는 클릭 요소가 전부 접근성 이름이 있어 `mode:"tag"` 재현 불가.
  - **`data-testid` 주입 위치**: `action-value-chip`은 `InlineChip` 호출부, `action-tag`는 `ClickTarget` tag 분기, `action-nav-link`는 `InlineLink`의 `data-testid` prop을 ActionLogContent navigation 분기에서만 전달(공용 컴포넌트 자체엔 하드코딩 금지 — 콘솔 링크 오염 방지).
- **검증**: 아래 e2e 항목 참조.

## 테스트 계획
- **단위 테스트**: `actionInline.test.ts` — `splitTemplate`(다중/선행/없음/연속 슬롯 + `_`·숫자 슬롯명), `resolveClickTarget`(target/빈 target/tag/tag+type/selector/empty 6 분기), `shouldRenderChip`(non-empty/빈문자열/undefined/masked 4 케이스 — 빈값 가드 자동 회귀 그물).
- **e2e 시나리오**(스크립트 판정 가능, 기존 spec에 얹기):
  - 텍스트 입력 후 액션 탭에 값이 `InlineChip`(테두리+`font-mono`, `data-testid="action-value-chip"`) 요소로 렌더된다.
  - 이름 없는 요소(fixture에 추가한 빈 인터랙티브 요소)를 클릭하면 액션 행에 `<tag ...>` 문법 하이라이트(`data-testid="action-tag"`)가 보인다.
  - 페이지 이동 시 액션 행에 해당 URL `<a href>`(`data-testid="action-nav-link"`)가 렌더된다.
  - **선행**: (1) `actions.html`에 접근성 이름 없는 인터랙티브 요소 추가(tag 시나리오 재현용 — fixture 보강). (2) 칩/태그/링크 호출부에 `data-testid` 부착(`action-nav-link`는 공용 `InlineLink`가 아닌 ActionLogContent 호출부에서만 주입). 기존 액션 spec(`replay-action-log.spec.ts`·`action-log-coverage.spec.ts`)은 `data-kind`만 검증 — 칩 단위 셀렉터 신규.
- **수동 테스트**(자동화 불가):
  - 칩/태그/링크 색·정렬·줄높이, 좁은 패널 줄바꿈(긴 이메일·멀티 select), 다크모드 대비.
  - keypress `⌘`/`+` 기호 monospace 글리프 렌더.
  - 로그 뷰어 빌드 산출물 동일성, 콘솔 링크 무회귀.
  - 기존 저장 세션(태그 정보 없는 클릭) 로드 시 깨짐 없음.
  - (jsdom 부재 → DOM 캡처 단위 테스트 불가 확정: `vitest.config.ts`에 `environment` 미설정 = node 기본.)

## 회귀 리스크
- ActionLogContent 공유(사이드패널+로그뷰어) → 양쪽.
- `InlineLink` 치환 → ConsoleLogContent 시각.
- i18n locales 대칭 PostToolUse 훅(동사 템플릿 불변이라 무영향, log-viewer 보강은 ko/en 동시).
- 필터/검색/스크롤/origin 동작 무변경 확인.

## 구현 순서 권장
- Task 1·2·4는 상호 독립(병렬 가능). Task 4(공용 컴포넌트)는 Task 5·6의 선행.
- Task 3(recorder)은 Task 2 이후.
- Task 5(ActionLogContent)는 Task 1·2·4 이후. Task 6(콘솔·i18n)은 Task 4 이후.
- 권장: (1·2·4 병렬) → 3 → 5 → 6 → (사용자 빌드) 7 → (선택) 8.

## 가이드 영향
없음 — 액션 로그 내부 표시(렌더) 변경이라 사용자 동작·플로우 불변. 콘솔 링크 공용화도 시각 동일. (`/implement` 보고의 "가이드 영향" 플래그로 재확인.)
