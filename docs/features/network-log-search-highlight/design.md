# 네트워크 로그 검색어 하이라이트 — 기술 설계

## 개요

순수 함수 `splitHighlight(text, query)`가 텍스트를 매칭/비매칭 세그먼트로 쪼개고(`toLowerCase` 후 `indexOf` 루프 — 정규식 미사용), 표시 컴포넌트 `<HighlightedText>`가 매칭 세그먼트만 `<mark>`(파랑 배경, 곡률 없음)로 감싼다. 하이라이트 대상은 실제 검색(`requestMatchesQuery`)이 훑는 필드(URL·헤더 key/value·바디)로 한정한다. 네트워크 상세 렌더 경로(`HeadersPanel` / `BodyPanel` / `BodyBlock`)에 현재 검색어(`debouncedQuery`)를 흘려 넣고, JSON 트리(`JsonTreeViewer`)에는 React Context로 쿼리를 전달해 재귀 노드 시그니처를 건드리지 않고 leaf(문자열·숫자·키)만 하이라이트한다. 검색어가 비면 `<HighlightedText>`는 원문 텍스트를 그대로 반환하므로 렌더·동작이 검색 전과 동일하다.

## 변경 범위

### 신규 파일

- **`src/lib/highlight-text.ts`** — 순수 함수. 텍스트를 대소문자 무시로 쿼리 기준 분할.
  - `splitHighlight(text: string, query: string): HighlightSegment[]`
  - **구현: `text.toLowerCase()`에서 `query.toLowerCase()`를 `indexOf`로 반복 탐색하며 세그먼트를 쪼갠다(정규식·`escapeRegExp` 불필요).** 기존 검색(`network-search`의 `.toLowerCase().includes()`)과 문자 폴딩 규칙이 자동 일치하고, 정규식 특수문자가 그대로 리터럴 매칭된다.

- **`src/lib/__tests__/highlight-text.test.ts`** — `splitHighlight` 단위 테스트(Vitest).

- **`src/sidepanel/components/__tests__/jsonTreeMatch.test.ts`(또는 동등 위치)** — `collectMatchExpandedPaths` 단위 테스트(Vitest). 함수 자체는 `JsonTreeViewer.tsx`에서 export.

- **`src/sidepanel/components/HighlightedText.tsx`** — 표시 컴포넌트 + JSON 트리용 Context.
  - `<HighlightedText text query className? />`
  - `HighlightQueryContext`(문자열, 기본 `""`) export — `JsonTreeViewer`가 Provider, leaf 행이 consumer.

### 변경 파일

- **`src/sidepanel/components/NetworkLogContent.tsx`**
  - 현재 역할: 네트워크 로그 목록 + 상세 패널 렌더. `debouncedQuery`(200ms) 상태 보유.
  - 변경: 상세 렌더 자식에 `query={debouncedQuery}` 전달.
    - `<HeadersPanel req={activeReq} query={debouncedQuery} />`
    - `<BodyPanel body={activeReq.requestBody} query={debouncedQuery} />` / `responseBody` 동일.
  - `HeadersPanel`: General 섹션은 **URL `dd`만** `<HighlightedText>`로 교체(method·status·time·contentType은 검색 대상이 아니므로 하이라이트 안 함 — 검색 표면과 하이라이트 표면 일치). `HeadersTable`의 `dt`(헤더명)·`dd`(헤더값, `***` 마스킹 아닌 브랜치만)를 `<HighlightedText text=… query=…>`로 교체.
  - `BodyPanel` → `BodyBlock`에 `query` 전달. `BodyBlock`:
    - JSON 트리 경로: `<JsonTreeViewer data={parsed} highlightQuery={query} />`
    - `<pre>` 경로: 내부 텍스트를 `<HighlightedText text={formatBody(body)} query={query} />`로 교체. (raw 텍스트라 오프셋이 검색 매칭과 일치 — 구문 걸친 매칭 한계 없음.)

- **`src/sidepanel/components/JsonTreeViewer.tsx`**
  - 현재 역할: JSON을 접힘/펼침 트리로 재귀 렌더(네트워크 바디·WS 프레임 전용 — 타 사용처 없음, grep 확인).
  - 신규 순수 함수 `collectMatchExpandedPaths(data, query)`를 **같은 파일에 정의**(트리의 path 스킴 `SEP="\0"`·`root`·`path+SEP+key`를 공유해야 하므로). 별도 export로 단위 테스트.
  - 변경: `JsonTreeViewer`에 optional `highlightQuery?: string` prop 추가 → 루트 출력을 `<HighlightQueryContext.Provider value={highlightQuery ?? ""}>`로 감쌈.
  - **매칭 조상 자동 펼침 (최초 1회 시딩 + collapse 존중)**: `highlightQuery`가 바뀔 때만 매칭 조상 path를 사용자 `expanded` state에 **한 번 병합(seed)**한다. 이후 사용자가 그 노드를 접으면(토글 → `expanded`에서 제거) 그 상태가 유지된다(매 렌더 강제 재-union 안 함). `defaultExpandDepth=1`이라 depth 2+ 매칭이 기본 접힘인 문제를 해소하되, 클릭이 무시되는 인상을 피한다.
    ```tsx
    useEffect(() => {
      if (!highlightQuery) return;
      const matchPaths = collectMatchExpandedPaths(data, highlightQuery);
      if (matchPaths.size) setExpanded((prev) => new Set([...prev, ...matchPaths]));
    }, [highlightQuery, data]);
    // JsonNode에는 기존 expanded 그대로 전달(effectiveExpanded 불필요).
    ```
    - 검색어를 바꾸면 새 매칭 기준으로 다시 최초 1회 시딩.
    - **collapse 존중**: 자동 펼친 노드를 사용자가 접으면 다시 열지 않는다. chevron 첫 클릭도 정상 동작(노드가 실제 `expanded`에 들어가 있으므로).
    - 검색어를 지워도 시딩된 펼침은 사용자 상태로 남아 자동 재접힘하지 않는다(collapse 존중의 대가 — 하이라이트 mark는 사라지므로 시각 혼선 없음).
  - leaf 3종만 consumer로 수정(재귀 노드 `JsonNode`·`ArrayChildren` 시그니처 불변):
    - `StringRow`: 표시 문자열 `display`를 `<HighlightedText>`로. **또한 truncate 판정에 매칭 시 펼침 조건 추가**(아래).
    - `PrimitiveRow`: `display`(number/boolean)를 `<HighlightedText>`로.
    - `KeyLabel`: `keyName`을 `<HighlightedText>`로.
  - 각 leaf에서 `const q = useContext(HighlightQueryContext)`. `q === ""`이면 `<HighlightedText>`가 원문 반환 → 기존 렌더와 동일.
  - **`StringRow` truncate 개선**: 300자 초과 문자열이라도 현재 쿼리가 그 값에 매칭되면 자동으로 전체 표시(잘린 뒤쪽 매칭이 안 보이는 문제 해소). 검색 안 할 땐 기존 truncate 동작 그대로.
    ```tsx
    const q = useContext(HighlightQueryContext);
    const hasMatch = q !== "" && value.toLowerCase().includes(q.toLowerCase());
    const truncated = value.length > STRING_TRUNCATE_LENGTH && !showFull && !hasMatch;
    ```

## 데이터 흐름

```
NetworkLogContent
  query(useState) ──debounce200──▶ debouncedQuery
       │                               │
       │(목록 필터: requestMatchesQuery) │(상세 하이라이트)
       ▼                               ▼
   필터된 목록                    HeadersPanel / BodyPanel  (query prop)
                                        │
                    ┌───────────────────┼─────────────────────┐
                    ▼                   ▼                     ▼
              HeadersTable          <pre> 바디            BodyBlock(JSON)
           (dt/dd, URL만)          HighlightedText      JsonTreeViewer(highlightQuery)
              HighlightedText                                 │ ├ useEffect: collectMatchExpandedPaths → setExpanded 시딩(최초 1회)
                                                              │ └ Context.Provider
                                                              ▼
                                                   StringRow/PrimitiveRow/KeyLabel
                                                   useContext → HighlightedText
```

- 새 상태·스토리지·메시지 없음. 하이라이트는 기존 `debouncedQuery`(컴포넌트 로컬 state) 파생 표시 계층뿐.
- `debouncedQuery`를 쓰는 이유: 목록 필터와 동일 값이라 "목록에 뜬 요청 = 이 쿼리로 매칭" 일관성 유지. 즉시값(`query`)을 쓰면 타이핑 중 목록과 하이라이트가 어긋난다.

## 인터페이스 설계

```typescript
// src/lib/highlight-text.ts
export interface HighlightSegment {
  text: string;      // 원문 조각(원래 대소문자 보존)
  match: boolean;    // 검색어 매칭 여부
}

// query가 빈 문자열이거나 매칭 없으면 [{ text, match: false }] 단일 세그먼트.
// toLowerCase + indexOf 반복(정규식 미사용) → 정규식 특수문자 리터럴, 좌→우 비중첩 매칭.
export function splitHighlight(text: string, query: string): HighlightSegment[];
```

```tsx
// src/sidepanel/components/HighlightedText.tsx
import { createContext } from "react";

export const HighlightQueryContext = createContext<string>("");

export function HighlightedText(props: {
  text: string;
  query: string;
  className?: string;   // mark에 추가할 클래스(선택)
}): JSX.Element;
// query 비면 <>{text}</> 반환. 매칭 세그먼트는:
//   <mark data-testid="log-highlight"
//     className="-mx-1 bg-blue-200 px-1 py-0.5 text-inherit dark:bg-blue-400/30">…</mark>
// - text-inherit: JSON 구문색(빨강 문자열·보라 키·파랑 숫자) 보존. 단 파랑 숫자값 위 파랑 배경은 대비가 약하니 실측(사용자 선택).
// - 곡률(rounded)·border 없음.
// - px-1 py-0.5로 배경 확대(좌우 4px·상하 2px)하되 정렬은 불변: 가로는 -mx-1로 padding을 상쇄(리플로우 0), 세로는 inline 요소라 vertical padding이 line box 높이를 안 바꿔 배경만 위아래로 확장(인접 줄과 겹칠 수 있으나 의도된 확대).
```

```tsx
// JsonTreeViewer 시그니처 변경(추가 prop만)
export function JsonTreeViewer({
  data,
  defaultExpandDepth = 1,
  highlightQuery,          // 신규 optional
}: JsonTreeViewerProps & { highlightQuery?: string }): JSX.Element;

// JsonTreeViewer.tsx에서 export하는 신규 순수 함수.
// query가 매칭되는 노드(키, 또는 String(value)가 매칭되는 문자열·숫자·불리언·null)까지의 모든 조상 컨테이너 path를 반환.
// query 비면 빈 Set. path 포맷은 트리 내부와 동일(SEP="\0", root 기준).
export function collectMatchExpandedPaths(data: unknown, query: string): Set<string>;
```

## 기존 패턴 준수

- **테스트 우선(CLAUDE.md)**: `splitHighlight`·`collectMatchExpandedPaths` 둘 다 신규 순수 함수 → `/tdd interface`로 테스트 먼저 작성 후 구현. `splitHighlight` 테스트는 `src/lib/__tests__/`(기존 `network-search` 등과 동일 위치), `collectMatchExpandedPaths` 테스트는 함수가 사는 `src/sidepanel/components/__tests__/`. 후자는 반환 path의 `SEP="\0"` 인코딩을 정확한 문자열로 assert(계약 고정).
- **UI 컨벤션(DESIGN.md)**: 색상은 Tailwind 토큰(`bg-blue-200`/`dark:bg-blue-400/30`), 다크모드 양쪽 지정. `<mark>`는 시맨틱 태그 + `text-inherit`로 주변 텍스트 색 보존. DESIGN.md가 요구하는 "새 raw 색 light/dark 대비 눈으로 확인"을 구현 시 실측(특히 파랑 배경 위 `text-muted-foreground` 헤더명·**파랑 숫자값(blue-700/blue-400) 위 파랑 배경 대비 약함**). 파랑은 사용자 선택. 곡률은 제거, 크기는 padding으로 키우되 정렬 불변(위 참조).
- **surgical**: 상세 렌더 leaf에서만 텍스트 래핑 교체. 목록·검색·필터·정렬·store 로직 무변경. `JsonTreeViewer` 재귀 시그니처 불변(Context로 우회).
- **i18n**: 새 사용자 노출 문자열 없음(`<mark>`은 텍스트 미포함) → `src/i18n/` 변경 없음.

## 대안 검토

- **(대안 1) JSON 트리에 `highlightQuery`를 prop drilling으로 전달** — `JsonNode`·`ArrayChildren`·leaf 전부 시그니처에 prop 추가. 기존 `expanded`/`onToggle` 스레딩과 스타일은 일치하나 재귀 노드 5곳 시그니처를 건드려 diff가 크다. → **Context 채택**(변경 대상을 `JsonTreeViewer` + leaf 3종으로 축소, 재귀 시그니처 불변).
- **(대안 2) 콘솔·액션까지 하이라이트** — 레벨·종류별 행 배경색과 하이라이트 배경이 겹쳐 시각 충돌. 사용자 결정으로 네트워크 상세로 한정. → 기각.
- **(대안 3) 접힌 행 URL도 하이라이트** — 행은 `LinkifiedText`로 URL을 링크화(파란 글자)하고 행 높이가 촘촘해 하이라이트가 산만. 사용자 결정으로 상세만. → 기각.
- **(대안 4) `dangerouslySetInnerHTML`로 `<mark>` 주입** — XSS 위험(로그 값은 페이지 유래 신뢰 불가 데이터). → 기각. 세그먼트 배열 → React 노드 방식이 안전.
- **(대안 5) 자동 펼침을 렌더 시점 union(`effectiveExpanded`)으로** — 매 렌더 `expanded ∪ matchPaths`를 계산해 넘기면 "검색 중 접어도 다시 열림"이 되어 첫 클릭이 무반응처럼 보인다. → **기각**, `useEffect` 최초 1회 시딩으로 변경(collapse 존중). 대가: 검색어 clear 시 자동 재접힘 없음(mark는 사라져 혼선 없음).
- **(대안 6) `escapeRegExp` + 정규식** — 사용자 입력을 정규식으로 넘기려면 이스케이프 헬퍼(코드베이스에 없음) + 테스트가 필요하고 오이스케이프 버그 위험. → **기각**, `indexOf` 스캔이 더 단순하고 검색 semantics와 자동 일치.

## 위험 요소

- **깊이 접힌 JSON 매칭 은폐**: `defaultExpandDepth=1`이라 depth 2+ 접힌 노드 안의 매칭은 아코디언에 가려 안 보임 → `collectMatchExpandedPaths` + `useEffect` 시딩으로 조상 자동 펼침(위 변경). **path 인코딩 계약이 핵심 회귀 포인트**: 트리 내부(`buildInitialExpanded`/`JsonNode`/`ArrayChildren`)의 `SEP="\0"`·root=`"root"`·`path+SEP+key`(배열=`String(i)`) 규칙과 **정확히 일치**해야 union이 노드를 연다. 어긋나면 무음 no-op(자동 펼침이 거짓으로 안 됨). 같은 파일에 정의해 스킴 공유 + 단위 테스트가 정확한 path 문자열을 assert.
- **배열 청크 캡 한계(문서화)**: `ArrayChildren`은 전역 `expanded`가 아니라 로컬 `visibleCount`(초기 `ARRAY_CHUNK_SIZE=100`)로 렌더를 자른다. 100번째 이후 배열 원소 안의 매칭은 렌더 트리에 없어 자동 펼침·하이라이트가 무력하다. **이번 스코프에서 처리하지 않는 알려진 한계**(드문 케이스, surgical 유지). `visibleCount` 외부화는 비목표.
- **JSON 구문/공백 걸친 매칭 한계(문서화)**: 검색은 raw body substring 매칭이지만 트리는 파싱된 구조를 키/값 별개 노드로 렌더한다. `"id":1`·`},{` 처럼 JSON 구문·들여쓰기를 걸친 쿼리는 트리에 연속 문자열이 없어 하이라이트 0(헤더도 `"key: value"` 걸친 쿼리는 `dt`/`dd` 분리라 동일). **목록엔 매칭으로 뜨는데 상세 트리엔 하이라이트가 없을 수 있다** — 본질적 한계. `<pre>` 경로(비-JSON 바디)는 raw라 해당 없음.
- **JSON `StringRow` truncate**: 300자 초과 문자열도 쿼리 매칭 시 자동 전체 표시로 해소(위 변경). 검색 안 할 때만 기존 truncate 유지.
- **성능**: 상세는 선택된 1개 요청만 렌더 + leaf 단위 짧은 문자열 분할이라 부담 없음. `splitHighlight`·`collectMatchExpandedPaths`는 키스트로크마다가 아니라 `debouncedQuery`(200ms) 변경 시에만 동작. 대형 JSON도 트리가 이미 청크·펼침 노드만 렌더하므로 하이라이트가 렌더량을 늘리지 않음.
- **`<mark>` 텍스트 색**: `text-inherit`이 없으면 `<mark>` 기본 검정 글자로 JSON 구문색이 깨진다. 단 className이 `HighlightedText` **단일 출처**라 한 번만 지정하면 되고 회귀 여지는 낮다 — 호출부가 `className` prop으로 텍스트 색을 덮어쓰지만 않으면 안전.
- **WS 격리 트랩**: WS 프레임(`FrameBody`)도 같은 `JsonTreeViewer`를 쓴다. 격리는 **Provider를 `JsonTreeViewer` 내부에 두고 `highlightQuery` prop 값으로 주입**하는 구조로 성립한다(`FrameBody`는 prop 미전달 → Context 기본 `""` → 하이라이트 0). 구현자가 Provider를 `NetworkLogContent` 루트로 올리면 WS로 하이라이트가 새어 Non-goal이 깨진다 — 회귀 트랩. `FrameBody`는 손대지 않고, "WS messages 매칭 시 mark 0개"를 e2e 가드로 둔다.
