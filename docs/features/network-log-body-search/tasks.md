# 네트워크 로그 본문 검색 — 구현 태스크

## 선행 조건

- 신규 권한·env·의존성 없음. 순수 in-memory 필터 변경.
- 테스트 우선: Task 1(테스트)을 Task 2(구현)보다 먼저.

## 태스크

### Task 1: `requestMatchesQuery` 테스트 작성 (`/tdd interface`)
- **변경 대상**: `src/lib/__tests__/network-search.test.ts` (신규)
- **작업 내용**: 아직 없는 `requestMatchesQuery(req, lowerQuery)`에 대한 단위 테스트. `NetworkRequest` 픽스처 헬퍼로 케이스 구성.
- **검증**:
  - [ ] URL에만 문자열 포함 → true
  - [ ] requestBody(string)에만 포함 → true
  - [ ] responseBody(string)에만 포함 → true
  - [ ] requestHeaders 키에 포함 → true
  - [ ] requestHeaders 값에 포함 → true
  - [ ] responseHeaders 키/값에 포함 → true
  - [ ] 비문자열 본문 전 variant(`{kind:"truncated"}`·`{kind:"binary"}`·`{kind:"stream"}`·`{kind:"omitted"}`)일 때 throw 없이 동작, 본문으로는 매칭 안 됨
  - [ ] 본문 `undefined`(필드 없음)·헤더 `{}`(빈 객체)일 때 throw 없이 동작
  - [ ] 대소문자 무시 (lowerQuery 전제 — 대문자 섞인 본문도 매칭)
  - [ ] 어디에도 없으면 false
  - [ ] 마스킹된 값(헤더 `***[len:N]` / 본문 `***`)은 그대로 검색됨 / 원문은 매칭 안 됨
  - [ ] `pnpm test` 실행 시 이 파일이 (미구현이라) red

### Task 2: `requestMatchesQuery` 구현
- **변경 대상**: `src/lib/network-search.ts` (신규)
- **작업 내용**: design.md 시그니처대로 구현. 필드 순서대로 검사하고 첫 매칭에서 `return true`. 본문은 `typeof body === "string"` 가드 후 검사. 헤더는 `Object.entries`로 키·값 모두 검사.
- **검증**:
  - [ ] Task 1 테스트 전부 green
  - [ ] `pnpm typecheck` 통과

### Task 3: 값 디바운스 훅
- **변경 대상**: `src/sidepanel/lib/useDebouncedValue.ts` (신규)
- **작업 내용**: `useDebouncedValue<T>(value, delayMs)` — `useState`+`useEffect`+`setTimeout`, cleanup으로 timer clear. 표준 패턴.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (훅 단위 테스트는 tdd 분류상 스킵 가능 — 동작은 Task 4 수동 확인)

### Task 4: NetworkLogContent 검색 분기 교체
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**:
  - `useDebouncedValue`·`requestMatchesQuery` import.
  - `const debouncedQuery = useDebouncedValue(query, 200);` 추가.
  - `filteredRequests` useMemo의 검색 분기를 `requestMatchesQuery(r, lower)`로 교체, 의존성 `query` → `debouncedQuery`, 내부에서 `debouncedQuery.toLowerCase()` 사용.
  - Input `value`·clear 버튼·resetFilters는 즉시값 `query` 유지(변경 없음).
  - 검색 Input에 `data-testid="network-search"` 부착(e2e selector — Task 7).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 입력값이 input에 즉시 반영(반응성 유지), 필터는 디바운스 후 적용

### Task 5: useScrollToEntry 즉시값 query 반영 (회귀 차단)
- **변경 대상**: `src/sidepanel/lib/useScrollToEntry.ts`, `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**: 디바운스 도입으로 `resetFilters()` 후 retry가 `debouncedQuery`(옛값) 때문에 대상을 못 찾는 회귀를 막는다. caller가 즉시값 `query`를 훅에 전달하고, 훅의 재시도/필터 가시성 판정이 즉시값을 반영하도록 한다. (design.md 위험 요소 "디바운스 ↔ useScrollToEntry" 참조)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 회귀 테스트(아래 테스트 계획) green
  - [ ] 검색어+type/origin 필터가 대상을 가린 상태에서 로그 항목→영상 싱크 점프가 동작

### Task 6: i18n placeholder 갱신
- **변경 대상**: `src/i18n/namespaces/logs.ts`
- **작업 내용**: `networkLog.search` — ko `"URL·본문 검색…"`, en `"Search URL & body…"`로 변경(형제 탭 `[대상] 검색…` 패턴 유지 + 본문 검색 멘탈모델 제공).
- **검증**:
  - [ ] 저장 시 PostToolUse 훅의 `locales.test.ts` 통과(ko/en 대칭)
  - [ ] 사이드패널에서 placeholder 변경 확인

### Task 7: e2e 픽스처 + 시나리오 (`/e2e-write`)
- **변경 대상**: `e2e/` (픽스처 페이지/엔드포인트 + spec), 필요 시 `data-testid`(Task 4에서 부착)
- **작업 내용**: 기존 픽스처는 404만 반환해 검색 가능한 본문 문자열이 없다. **알려진 본문 문자열을 반환하는 엔드포인트/페이지**를 추가하고(응답이 `string` variant로 캡처되는 content-type — JSON 등), "응답 본문에만 있는 문자열로 검색 시 해당 행만 남는다" 시나리오 spec 작성. selector는 `data-testid="network-search"`.
- **검증**:
  - [ ] 픽스처 응답 본문이 `string` variant로 캡처됨(truncated/binary 아님) 확인
  - [ ] `/e2e-write` 루프로 spec green

## 테스트 계획

- **단위 테스트**: `network-search.test.ts` — Task 1의 케이스 목록 전체. 순수 함수라 커버리지 확보 용이.
- **회귀 테스트** (`/tdd regression`, Task 5): useScrollToEntry × 디바운스 reset 경쟁. "검색어 + type/origin 필터가 대상 엔트리를 가린 상태에서 scrollToEntryId가 들어오면, resetFilters 후 retry가 (즉시값 query 기준으로) 대상을 찾아 스크롤한다." 디바운스 도입이 이 동작을 깨지 않음을 고정.
- **e2e 시나리오** (Task 7, 자동화 확정):
  - "네트워크 로그가 쌓인 상태에서 `data-testid=network-search`에 응답 본문에만 있는 문자열을 입력하면, URL에는 없어도 해당 요청 행만 목록에 남는다."
  - 선결: 본문 문자열 반환 픽스처 추가 + 응답이 `string` variant로 캡처되는지 확인.
- **수동 테스트** (Chrome):
  - [ ] 본문에 특정 문자열이 든 요청을 발생시키고 그 문자열로 검색 → 행 필터링 확인
  - [ ] 헤더 값(예: `application/json`)으로 검색 → 매칭 확인
  - [ ] 이미지 등 binary 본문 요청 섞인 상태에서 검색 → 에러 없음
  - [ ] 빠르게 타이핑 시 렉 없이 입력되고 디바운스 후 1회 필터

## 구현 순서 권장

Task 1 → 2 (테스트 우선, 직렬). Task 3(디바운스 훅)은 독립. Task 4는 2·3 import. Task 5(useScrollToEntry 회귀)는 Task 4에 의존(디바운스가 들어가야 회귀가 성립). Task 6(i18n)·Task 7(e2e)은 Task 4 이후. Task 6은 독립적으로 병렬 가능.

권장: `/tdd interface`(Task 1) → `/implement`(Task 2~6) → `/code-review` → `/tdd regression`(Task 5 회귀 테스트) → `/e2e-write`(Task 7) → `/guide` → `/push`.

## 가이드 영향

사용자 노출 UX 변경(검색 범위 확대 + placeholder). 구현 후 `/guide`로 갱신:
- `guide/ko/logs/live.md`·`guide/en/logs/live.md` (ko·en) — "네트워크 > 필터·검색" 항목: 검색이 URL뿐 아니라 요청/응답 본문·헤더까지 찾는다는 설명 추가.

작성 기준은 `guide/AUTHORING.md` 우선 로드.
