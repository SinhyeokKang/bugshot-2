# 네트워크 로그 검색어 하이라이트 — 구현 태스크

## 선행 조건

- 신규 권한·env·의존성 없음.
- `escapeRegExp`가 코드베이스에 없음을 확인함(grep 0건) → `highlight-text.ts` 내부에 정의.
- `JsonTreeViewer`는 `NetworkLogContent`(바디·WS 프레임)에서만 사용 → optional prop 추가가 타 사용처에 무영향(grep 확인).

## 태스크

### Task 1: `splitHighlight` 순수 함수 + 테스트 (TDD interface)
- **변경 대상**: `src/lib/highlight-text.ts`(신규), `src/lib/__tests__/highlight-text.test.ts`(신규)
- **작업 내용**: `HighlightSegment` 타입과 `splitHighlight(text, query)` 구현. 대소문자 무시, `escapeRegExp`로 리터럴 처리, 좌→우 비중첩 분할. 빈 쿼리/무매칭 시 `[{ text, match: false }]`.
- **검증**:
  - [ ] `pnpm test src/lib/__tests__/highlight-text.test.ts` 통과
  - [ ] 빈 쿼리 → 단일 비매칭 세그먼트
  - [ ] `"Screenshot annotated screenshot"` + `"screenshot"` → 매칭 2곳, 원문 대소문자 보존
  - [ ] 정규식 특수문자 쿼리(`api.v2(x)`) 리터럴 매칭, 예외 없음
  - [ ] 무매칭 → 단일 비매칭 세그먼트

### Task 2: `HighlightedText` 컴포넌트 + Context
- **변경 대상**: `src/sidepanel/components/HighlightedText.tsx`(신규)
- **작업 내용**: `splitHighlight` 결과를 렌더. 매칭 세그먼트만 `<mark data-testid="log-highlight" className="rounded-sm bg-amber-200 text-inherit dark:bg-amber-500/40">`. 쿼리 비면 `<>{text}</>`. `HighlightQueryContext = createContext<string>("")` export.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 쿼리 있을 때 매칭 세그먼트가 `<mark>`로 감싸짐(Task 6 e2e/수동으로 육안 확인)
  - [ ] `text-inherit` 포함 확인(JSON 구문색 보존)

### Task 3: `JsonTreeViewer` 하이라이트 지원
- **변경 대상**: `src/sidepanel/components/JsonTreeViewer.tsx`
- **작업 내용**: `JsonTreeViewer`에 optional `highlightQuery?: string` 추가, 루트를 `<HighlightQueryContext.Provider value={highlightQuery ?? ""}>`로 감쌈. `StringRow`·`PrimitiveRow`·`KeyLabel`에서 `useContext(HighlightQueryContext)`로 쿼리를 받아 표시 텍스트를 `<HighlightedText>`로 교체. 재귀 노드(`JsonNode`/`ArrayChildren`) 시그니처 불변.
- **`collectMatchExpandedPaths(data, query)` 순수 함수 + 테스트**: 매칭 노드까지의 조상 컨테이너 path 집합 반환(query 비면 빈 Set). `JsonTreeViewer.tsx`에서 export, `__tests__`에 단위 테스트. `JsonTreeViewer`에서 `useMemo`로 `matchPaths` 계산 → `effectiveExpanded = new Set([...expanded, ...matchPaths])`를 `JsonNode`에 전달(사용자 `expanded` state 불변).
- **`StringRow` truncate 개선**: 매칭되는 값이면 전체 표시.
  ```tsx
  const q = useContext(HighlightQueryContext);
  const hasMatch = q !== "" && value.toLowerCase().includes(q.toLowerCase());
  const truncated = value.length > STRING_TRUNCATE_LENGTH && !showFull && !hasMatch;
  ```
- **검증**:
  - [ ] `pnpm test`에서 `collectMatchExpandedPaths` 통과(빈 쿼리·depth 2+ 중첩 매칭·배열 인덱스·무매칭)
  - [ ] `pnpm typecheck` 통과
  - [ ] `highlightQuery` 미전달 시 렌더 불변(기존 스냅샷 동일 — WS `FrameBody` 경로가 회귀 없어야 함)
  - [ ] `defaultExpandDepth` 등 기존 prop 동작 유지
  - [ ] 300자 초과 문자열에 매칭 시 자동 전체 표시(truncate 안 됨)
  - [ ] depth 2+ 접힌 노드 안 매칭 시 조상 아코디언 자동 펼침 + 검색 clear 시 재접힘

### Task 4: `NetworkLogContent` 상세에 쿼리 배선 — 헤더
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**: `HeadersPanel`에 `query` prop 추가, 상세 렌더에서 `query={debouncedQuery}` 전달. General 섹션 `dd`(URL·method·정상 status 텍스트·time·contentType)와 `HeadersTable` `dt`/`dd`(마스킹 `***` 아닌 브랜치)를 `<HighlightedText>`로 교체.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 검색어 입력 후 헤더 매칭 문구가 앰버 배경(Task 6)
  - [ ] 검색어 비면 헤더 렌더 불변

### Task 5: `NetworkLogContent` 상세에 쿼리 배선 — 바디
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**: `BodyPanel`/`BodyBlock`에 `query` prop 추가, `request`/`response` 탭에서 `query={debouncedQuery}` 전달. `BodyBlock`의 `<pre>` 경로는 `<HighlightedText text={formatBody(body)} query={query} />`, JSON 경로는 `<JsonTreeViewer data={parsed} highlightQuery={query} />`.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] JSON 바디·non-JSON 바디 양쪽에서 매칭 하이라이트(Task 6)
  - [ ] WS `messages` 탭·`FrameBody`에는 하이라이트 없음(Non-goal 확인)

### Task 6: 통합 검증
- **변경 대상**: 없음(검증 전용)
- **작업 내용**: 실제 탭에서 네트워크 로그 캡처 → 검색 → 상세 3탭 육안 확인.
- **검증**:
  - [ ] headers/request/response 3탭에서 매칭 문구 앰버 하이라이트
  - [ ] URL로만 매칭된 요청: General URL만 하이라이트
  - [ ] 검색어 clear 시 하이라이트 사라지고 원래 렌더
  - [ ] 콘솔·액션 로그, 접힌 네트워크 행에 하이라이트 없음
  - [ ] 라이트/다크 모드 양쪽에서 가독성(JSON 구문색 보존)

## 테스트 계획

- **단위 테스트**:
  - `splitHighlight`(Task 1) — 빈 쿼리, 단일/다중 매칭, 대소문자 보존, 정규식 이스케이프, 무매칭, 쿼리가 텍스트보다 김.
  - `collectMatchExpandedPaths`(Task 3) — 빈 쿼리→빈 Set, depth 2+ 중첩 객체/배열 매칭 시 조상 path 전부 포함, 키 매칭·값 매칭, 무매칭→빈 Set.
- **e2e 시나리오**: "네트워크 로그가 있는 상태에서 검색어를 입력하고 매칭 요청 상세를 열면, 상세 패널에 `mark[data-testid=\"log-highlight\"]`가 1개 이상 나타난다. 검색어를 비우면 `mark[data-testid=\"log-highlight\"]`가 0개가 된다." — 기존 네트워크 로그 e2e 픽스처(캡처된 요청)가 있으면 스크립트화 가능. 없으면 수동으로 대체.
- **수동 테스트**: 라이트/다크 시각 정합, JSON 트리 구문색 위 앰버 가독성, truncate된 긴 문자열 매칭의 "전체 보기" 상호작용(Task 6).

## 구현 순서 권장

Task 1 → 2 (순수 함수·표시 컴포넌트 기반) → 3·4·5 병렬 가능(모두 2에 의존, 서로 독립: 3=JSON 트리, 4=헤더, 5=바디 배선) → 6 통합 검증.

## 가이드 영향

사용자 노출이지만 경미(기존 네트워크 검색의 시각 보강). 로그 관련 가이드 페이지가 있으면 "네트워크 로그 상세에서 검색어가 강조된다" 한 줄 반영 여부를 `/guide`에서 `guide/AUTHORING.md` 기준으로 판단(ko·en 동시). 신규 페이지·기능 아님이라 없을 수도 있음 — `/guide`에 위임.
