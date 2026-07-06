# 네트워크 로그 검색어 하이라이트 — 구현 태스크

## 선행 조건

- 신규 권한·env·의존성 없음.
- `splitHighlight`는 `toLowerCase`+`indexOf` 방식 → `escapeRegExp`·정규식 불필요(신규 헬퍼 없음).
- `JsonTreeViewer`는 `NetworkLogContent`(바디 559행·WS `FrameBody` 716행)에서만 사용 → optional prop 추가가 타 사용처에 무영향(grep 확인). **WS 격리는 Provider를 `JsonTreeViewer` 내부에 둬 성립(FrameBody는 prop 미전달)** — 구현 시 Provider를 상위로 올리지 말 것.
- e2e 자산: `e2e/network-body-search.spec.ts` + fixture(`/e2e-json → {"note":"zqxbodyneedle"}`, 마커가 본문에만) 실재 → 하이라이트 e2e 스크립트화 확정 가능.

## 태스크

### Task 1: `splitHighlight` 순수 함수 + 테스트 (TDD interface)
- **변경 대상**: `src/lib/highlight-text.ts`(신규), `src/lib/__tests__/highlight-text.test.ts`(신규)
- **작업 내용**: `HighlightSegment` 타입과 `splitHighlight(text, query)` 구현. **`toLowerCase`+`indexOf` 반복으로 세그먼트 분할(정규식·escapeRegExp 없음)**, 좌→우 비중첩. 빈 쿼리/무매칭 시 `[{ text, match: false }]`. (테스트 red 먼저.)
- **검증**:
  - [x] `pnpm test src/lib/__tests__/highlight-text.test.ts` 통과
  - [x] 빈 쿼리 → 단일 비매칭 세그먼트 (하이라이트 DOM 미삽입 근거)
  - [x] `"Screenshot annotated screenshot"` + `"screenshot"` → 매칭 2곳, 원문 대소문자 보존
  - [x] 정규식 특수문자 쿼리(`api.v2(x)`) 리터럴 매칭, 예외 없음
  - [x] 무매칭 → 단일 비매칭 세그먼트
  - [x] 쿼리가 텍스트보다 김 → 단일 비매칭 세그먼트

### Task 2: `HighlightedText` 컴포넌트 + Context
- **변경 대상**: `src/sidepanel/components/HighlightedText.tsx`(신규)
- **작업 내용**: `splitHighlight` 결과를 렌더. 매칭 세그먼트만 `<mark data-testid="log-highlight" className="-mx-1 bg-blue-200 px-1 py-0.5 text-inherit dark:bg-blue-400/30">`(곡률 없음. px-1 py-0.5로 배경 확대[좌우 4px·상하 2px]하되 -mx-1로 가로 상쇄·inline 세로라 reflow 0). 쿼리 비면 `<>{text}</>`. `HighlightQueryContext = createContext<string>("")` export. (이 repo는 RTL/jsdom 미보유·vitest env=node라 컴포넌트 렌더 테스트는 안 함 — 로직은 Task 1 `splitHighlight` 단위테스트로 커버, mark 래핑은 e2e·수동 검증.)
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] 쿼리 있을 때 매칭 세그먼트가 `<mark>`로 감싸짐(Task 6 e2e/수동으로 육안 확인)
  - [x] `text-inherit` 포함 확인(JSON 구문색 보존)
  - [ ] 라이트 `bg-blue-200`·다크 `dark:bg-blue-400/30` 대비 육안 확인(muted 헤더명·red-400 문자열 값 위 + **파랑 숫자값(text-blue-700/blue-400) 위 파랑 배경 가독성**)

### Task 3: `JsonTreeViewer` 하이라이트 지원
- **변경 대상**: `src/sidepanel/components/JsonTreeViewer.tsx`
- **`collectMatchExpandedPaths(data, query)` 순수 함수 + 테스트 (TDD 우선, red 먼저)**: 매칭 노드까지의 조상 컨테이너 path 집합 반환(query 비면 빈 Set). **path 인코딩 계약**: 트리 내부와 동일하게 `SEP="\0"`·root=`"root"`·`path+SEP+key`(배열=`String(i)`). `JsonTreeViewer.tsx`에서 export, `src/sidepanel/components/__tests__/`에 단위 테스트 — **반환 path의 정확한 문자열(예: `"root\0data\0items\00"`)을 assert**해 계약 고정. 어긋나면 자동 펼침이 무음 no-op.
- **작업 내용**: `JsonTreeViewer`에 optional `highlightQuery?: string` 추가, 루트를 `<HighlightQueryContext.Provider value={highlightQuery ?? ""}>`로 감쌈(**Provider는 JsonTreeViewer 내부에만** — WS FrameBody 격리). `StringRow`·`PrimitiveRow`·`KeyLabel`에서 `useContext(HighlightQueryContext)`로 쿼리를 받아 표시 텍스트를 `<HighlightedText>`로 교체. 재귀 노드(`JsonNode`/`ArrayChildren`) 시그니처 불변.
- **자동 펼침(최초 시딩 + collapse 존중)**: `useEffect([highlightQuery, data])`로 매칭 조상 path를 `expanded` state에 최초 1회 병합. 이후 사용자 collapse 존중(강제 재-union 안 함). `effectiveExpanded` 불필요.
  ```tsx
  useEffect(() => {
    if (!highlightQuery) return;
    const matchPaths = collectMatchExpandedPaths(data, highlightQuery);
    if (matchPaths.size) setExpanded((prev) => new Set([...prev, ...matchPaths]));
  }, [highlightQuery, data]);
  ```
- **`StringRow` truncate 개선**: 매칭되는 값이면 전체 표시.
  ```tsx
  const q = useContext(HighlightQueryContext);
  const hasMatch = q !== "" && value.toLowerCase().includes(q.toLowerCase());
  const truncated = value.length > STRING_TRUNCATE_LENGTH && !showFull && !hasMatch;
  ```
- **검증**:
  - [x] `pnpm test`에서 `collectMatchExpandedPaths` 통과(빈 쿼리→빈 Set·depth 2+ 중첩 객체/배열 매칭 시 조상 path 전부·키 매칭·값 매칭·무매칭·null). path 문자열 exact assert.
  - [x] `pnpm typecheck` 통과
  - [x] `highlightQuery` 미전달 시 렌더 불변(WS `FrameBody` 경로 회귀 없음 — Provider 격리 확인. effect가 `!highlightQuery`로 early-return)
  - [x] `defaultExpandDepth` 등 기존 prop 동작 유지
  - [ ] 300자 초과 문자열에 매칭 시 자동 전체 표시(truncate 안 됨) — 수동(Task 6)
  - [ ] depth 2+ 접힌 노드 안 매칭 시 조상 아코디언 자동 펼침 + 펼쳐진 노드 collapse 가능(첫 클릭 정상 동작) — 수동(Task 6)
  - [ ] 배열 100개 캡 이후 매칭은 자동 펼침 안 됨(알려진 한계 — 검증 항목이 아니라 인지 확인)

### Task 4: `NetworkLogContent` 상세에 쿼리 배선 — 헤더
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**: `HeadersPanel`에 `query` prop 추가, 상세 렌더에서 `query={debouncedQuery}` 전달. General 섹션은 **URL `dd`만** `<HighlightedText>`로 교체(method·status·time·contentType 제외 — 검색 대상 아님). `HeadersTable` `dt`/`dd`(마스킹 `***` 아닌 브랜치)를 `<HighlightedText>`로 교체.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] 검색어 입력 후 헤더 매칭 문구가 파랑 배경(Task 6)
  - [x] method/status/time/contentType은 우연히 매칭돼도 하이라이트 안 됨(코드상 URL dd만 HighlightedText)
  - [ ] 검색어 비면 헤더 렌더 불변(Task 6)

### Task 5: `NetworkLogContent` 상세에 쿼리 배선 — 바디 + e2e testid
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`
- **작업 내용**: `BodyPanel`/`BodyBlock`에 `query` prop 추가, `request`/`response` 탭에서 `query={debouncedQuery}` 전달. `BodyBlock`의 `<pre>` 경로는 `<HighlightedText text={formatBody(body)} query={query} />`, JSON 경로는 `<JsonTreeViewer data={parsed} highlightQuery={query} />`.
- **e2e testid 부착**: `<TabsTrigger value="request">`/`value="response">`에 `data-testid="detail-tab-request"`/`"detail-tab-response"` 추가(현재 `detail-tab-headers`·`detail-tab-messages`만 있음). e2e가 매칭 탭을 열 셀렉터 확보.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] JSON 바디·non-JSON 바디 양쪽에서 매칭 하이라이트(Task 6)
  - [x] WS `messages` 탭·`FrameBody`에는 하이라이트 없음(코드상 highlightQuery 미전달 → Context "" → mark 0)

### Task 6: 통합 검증
- **변경 대상**: 없음(검증 전용)
- **작업 내용**: 실제 탭에서 네트워크 로그 캡처 → 검색 → 상세 3탭 육안 확인. + NetworkLogContent 재사용처 회귀 확인.
- **검증**:
  - [ ] headers/request/response 3탭에서 매칭 문구 파랑 하이라이트
  - [ ] URL로만 매칭된 요청: General URL만 하이라이트
  - [ ] 검색어 clear 시 하이라이트 사라짐(자동 펼친 아코디언은 유지돼도 무방 — collapse 존중)
  - [ ] 콘솔·액션 로그, 접힌 네트워크 행에 하이라이트 없음
  - [ ] 빈 바디 GET·pending·blocked 요청: request 탭 빈 상태 정상, 예외 없음
  - [ ] 라이트/다크 모드 양쪽에서 가독성(JSON 구문색 보존, muted 헤더명·red-400 문자열 값 위 대비)
  - [ ] **`NetworkLogPreviewDialog`**(검색 인풋 재사용)에서도 하이라이트 동작 확인
  - [ ] **log-viewer**(`logs.html`)는 별도 빌드 산출 — 검증하려면 `pnpm build:log-viewer` 후 확인(dist-log-viewer inline). 필수는 아니나 회귀 인지.

## 테스트 계획

- **단위 테스트**:
  - `splitHighlight`(Task 1) — 빈 쿼리, 단일/다중 매칭, 대소문자 보존, 정규식 이스케이프, 무매칭, 쿼리가 텍스트보다 김.
  - `collectMatchExpandedPaths`(Task 3) — 빈 쿼리→빈 Set, depth 2+ 중첩 객체/배열 매칭 시 조상 path 전부 포함, 키 매칭·값 매칭, 무매칭→빈 Set.
- **e2e 시나리오 (스크립트화 확정 — `e2e/network-body-search.spec.ts` 픽스처 재사용)**:
  1. 응답 바디에 마커(`zqxbodyneedle`)가 있는 요청을 캡처 → 검색창(`network-search`)에 마커 입력 → 목록에서 요청 클릭 → `detail-tab-response` 클릭 → `mark[data-testid="log-highlight"]` count ≥ 1.
  2. 검색창 clear → `mark[data-testid="log-highlight"]` count == 0.
  3. **WS 격리 가드**: WS 요청(`websocket-log.spec.ts` 픽스처)에서 검색어 매칭 시 `messages` 탭에 `mark[data-testid="log-highlight"]` count == 0.
- **수동 테스트**: 라이트/다크 시각 정합, JSON 트리 구문색 위 파랑 가독성, PreviewDialog·log-viewer 반영(Task 6).

## 구현 순서 권장

Task 1 → 2 (순수 함수·표시 컴포넌트 기반) → 3·4·5 병렬 가능(모두 2에 의존, 서로 독립: 3=JSON 트리, 4=헤더, 5=바디 배선) → 6 통합 검증.

## 가이드 영향

사용자 노출이지만 경미(기존 네트워크 검색의 시각 보강). 로그 관련 가이드 페이지가 있으면 "네트워크 로그 상세에서 검색어가 강조된다" 한 줄 반영 여부를 `/guide`에서 `guide/AUTHORING.md` 기준으로 판단(ko·en 동시). 신규 페이지·기능 아님이라 없을 수도 있음 — `/guide`에 위임.
