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
  - [ ] 비문자열 본문(`{kind:"truncated"}`, `{kind:"binary"}`)일 때 throw 없이 동작, 본문으로는 매칭 안 됨
  - [ ] 대소문자 무시 (lowerQuery 전제 — 대문자 섞인 본문도 매칭)
  - [ ] 어디에도 없으면 false
  - [ ] 마스킹된 값(`***`)은 그대로 검색됨 / 원문은 매칭 안 됨
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
  - [ ] (훅 단위 테스트는 tdd 분류상 스킵 가능 — 동작은 Task 5 수동 확인)

### Task 4: NetworkLogContent 검색 분기 교체
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**:
  - `useDebouncedValue`·`requestMatchesQuery` import.
  - `const debouncedQuery = useDebouncedValue(query, 200);` 추가.
  - `filteredRequests` useMemo의 검색 분기를 `requestMatchesQuery(r, lower)`로 교체, 의존성 `query` → `debouncedQuery`, 내부에서 `debouncedQuery.toLowerCase()` 사용.
  - Input `value`·clear 버튼·resetFilters는 즉시값 `query` 유지(변경 없음).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 입력값이 input에 즉시 반영(반응성 유지), 필터는 디바운스 후 적용

### Task 5: i18n placeholder 갱신
- **변경 대상**: `src/i18n/namespaces/logs.ts`
- **작업 내용**: `networkLog.search` — ko `"검색…"`, en `"Search…"`로 변경(URL 한정 표현 제거).
- **검증**:
  - [ ] 저장 시 PostToolUse 훅의 `locales.test.ts` 통과(ko/en 대칭)
  - [ ] 사이드패널에서 placeholder 변경 확인

## 테스트 계획

- **단위 테스트**: `network-search.test.ts` — Task 1의 케이스 목록 전체. 순수 함수라 커버리지 확보 용이.
- **e2e 시나리오**:
  - "네트워크 로그가 쌓인 상태에서 검색창에 응답 본문에만 있는 문자열을 입력하면, URL에는 없어도 해당 요청 행만 목록에 남는다."
  - (e2e는 실제 네트워크 캡처가 필요 — 캡처 가능한 테스트 페이지가 e2e 픽스처에 있으면 자동화, 없으면 수동으로 강등)
- **수동 테스트** (Chrome):
  - [ ] 본문에 특정 문자열이 든 요청을 발생시키고 그 문자열로 검색 → 행 필터링 확인
  - [ ] 헤더 값(예: `application/json`)으로 검색 → 매칭 확인
  - [ ] 이미지 등 binary 본문 요청 섞인 상태에서 검색 → 에러 없음
  - [ ] 빠르게 타이핑 시 렉 없이 입력되고 디바운스 후 1회 필터

## 구현 순서 권장

Task 1 → 2 (테스트 우선, 직렬) → Task 3·4·5는 병렬 가능하나 4가 3을 import하므로 3→4 순서. 5는 독립.

권장: `/tdd interface`(Task 1) → `/implement`(Task 2~5) → `/code-review` → `/guide` → `/push`.

## 가이드 영향

사용자 노출 UX 변경(검색 범위 확대 + placeholder). 구현 후 `/guide`로 갱신:
- `guide/ko/logs/live.md`·`guide/en/logs/live.md` (ko·en) — "네트워크 > 필터·검색" 항목: 검색이 URL뿐 아니라 요청/응답 본문·헤더까지 찾는다는 설명 추가.

작성 기준은 `guide/AUTHORING.md` 우선 로드.
