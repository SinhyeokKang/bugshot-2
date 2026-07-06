# 네트워크 로그 검색어 하이라이트 — 기술 설계

## 개요

순수 함수 `splitHighlight(text, query)`가 텍스트를 매칭/비매칭 세그먼트로 쪼개고, 표시 컴포넌트 `<HighlightedText>`가 매칭 세그먼트만 `<mark>`(앰버 배경)로 감싼다. 네트워크 상세 렌더 경로(`HeadersPanel` / `BodyPanel` / `BodyBlock`)에 현재 검색어(`debouncedQuery`)를 흘려 넣고, JSON 트리(`JsonTreeViewer`)에는 React Context로 쿼리를 전달해 재귀 노드 시그니처를 건드리지 않고 leaf(문자열·숫자·키)만 하이라이트한다. 검색어가 비면 `<HighlightedText>`는 원문 텍스트를 그대로 반환하므로 렌더·동작이 검색 전과 동일하다.

## 변경 범위

### 신규 파일

- **`src/lib/highlight-text.ts`** — 순수 함수. 텍스트를 대소문자 무시로 쿼리 기준 분할.
  - `splitHighlight(text: string, query: string): HighlightSegment[]`
  - `escapeRegExp` 내부 헬퍼(코드베이스에 기존 것 없음 — grep 확인, 신규 정의).

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
  - `HeadersPanel`: General 섹션 `dd` 값(URL·method·status 텍스트·time·contentType)과 `HeadersTable`의 `dt`(헤더명)·`dd`(헤더값, `***` 마스킹 아닌 브랜치만)를 `<HighlightedText text=… query=…>`로 교체.
  - `BodyPanel` → `BodyBlock`에 `query` 전달. `BodyBlock`:
    - JSON 트리 경로: `<JsonTreeViewer data={parsed} highlightQuery={query} />`
    - `<pre>` 경로: 내부 텍스트를 `<HighlightedText text={formatBody(body)} query={query} />`로 교체.
  - status 텍스트(`${req.status} ${req.statusText}`)는 조건 분기(pending/blocked/정상)가 있으므로 정상 분기의 문자열만 하이라이트.

- **`src/sidepanel/components/JsonTreeViewer.tsx`**
  - 현재 역할: JSON을 접힘/펼침 트리로 재귀 렌더(네트워크 바디·WS 프레임 전용 — 타 사용처 없음, grep 확인).
  - 신규 순수 함수 `collectMatchExpandedPaths(data, query)`를 **같은 파일에 정의**(트리의 path 스킴 `SEP="\0"`·`root`·`path+SEP+key`를 공유해야 하므로). 별도 export로 단위 테스트.
  - 변경: `JsonTreeViewer`에 optional `highlightQuery?: string` prop 추가 → 루트 출력을 `<HighlightQueryContext.Provider value={highlightQuery ?? ""}>`로 감쌈.
  - **매칭 조상 자동 펼침**: `highlightQuery`가 매칭되는 노드까지의 조상 컨테이너를 강제로 열어, 깊이 접힌 아코디언 뒤에 매칭이 가려지지 않게 한다(`defaultExpandDepth=1`이라 depth 2+ 매칭은 기본 접힘). 사용자 `expanded` state는 건드리지 않고 렌더 시점에 매칭 경로만 union.
    ```tsx
    const matchPaths = useMemo(
      () => collectMatchExpandedPaths(data, highlightQuery ?? ""),
      [data, highlightQuery]
    );
    const effectiveExpanded = useMemo(
      () => (matchPaths.size ? new Set([...expanded, ...matchPaths]) : expanded),
      [expanded, matchPaths]
    );
    // JsonNode에 expanded 대신 effectiveExpanded 전달
    ```
    - 검색어 지우면 `matchPaths` 빈 Set → `expanded`(사용자 상태)로 원복, 아코디언 재접힘.
    - 검색 중 매칭 노드를 사용자가 접어도 다시 열림(의도 — 매칭 노출 유지).
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
              HighlightedText       HighlightedText      JsonTreeViewer(highlightQuery)
                                                              │ ├ collectMatchExpandedPaths → effectiveExpanded(조상 자동 펼침)
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
// 대소문자 무시, 정규식 특수문자 리터럴 처리, 좌→우 비중첩 매칭.
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
//     className="rounded-sm bg-amber-200 text-inherit dark:bg-amber-500/40">…</mark>
// text-inherit로 JSON 구문색(빨강 문자열·보라 키·파랑 숫자) 보존.
```

```tsx
// JsonTreeViewer 시그니처 변경(추가 prop만)
export function JsonTreeViewer({
  data,
  defaultExpandDepth = 1,
  highlightQuery,          // 신규 optional
}: JsonTreeViewerProps & { highlightQuery?: string }): JSX.Element;

// JsonTreeViewer.tsx에서 export하는 신규 순수 함수.
// query가 매칭되는 노드(키·문자열·숫자·불리언)까지의 모든 조상 컨테이너 path를 반환.
// query 비면 빈 Set. path 포맷은 트리 내부와 동일(SEP="\0", root 기준).
export function collectMatchExpandedPaths(data: unknown, query: string): Set<string>;
```

## 기존 패턴 준수

- **테스트 우선(CLAUDE.md)**: `splitHighlight`는 신규 순수 함수 → `/tdd interface`로 테스트 먼저 작성 후 구현. 테스트 파일은 대상과 같은 계층 `src/lib/__tests__/`(기존 `network-search` 등과 동일 위치).
- **UI 컨벤션(DESIGN.md)**: 색상은 Tailwind 토큰(`bg-amber-200`/`dark:bg-amber-500/40`), 다크모드 양쪽 지정. `<mark>`는 시맨틱 태그 + `text-inherit`로 주변 텍스트 색 보존.
- **surgical**: 상세 렌더 leaf에서만 텍스트 래핑 교체. 목록·검색·필터·정렬·store 로직 무변경. `JsonTreeViewer` 재귀 시그니처 불변(Context로 우회).
- **i18n**: 새 사용자 노출 문자열 없음(`<mark>`은 텍스트 미포함) → `src/i18n/` 변경 없음.

## 대안 검토

- **(대안 1) JSON 트리에 `highlightQuery`를 prop drilling으로 전달** — `JsonNode`·`ArrayChildren`·leaf 전부 시그니처에 prop 추가. 기존 `expanded`/`onToggle` 스레딩과 스타일은 일치하나 재귀 노드 5곳 시그니처를 건드려 diff가 크다. → **Context 채택**(변경 대상을 `JsonTreeViewer` + leaf 3종으로 축소, 재귀 시그니처 불변).
- **(대안 2) 콘솔·액션까지 하이라이트** — 레벨·종류별 행 배경색과 하이라이트 배경이 겹쳐 시각 충돌. 사용자 결정으로 네트워크 상세로 한정. → 기각.
- **(대안 3) 접힌 행 URL도 하이라이트** — 행은 `LinkifiedText`로 URL을 링크화(파란 글자)하고 행 높이가 촘촘해 앰버가 산만. 사용자 결정으로 상세만. → 기각.
- **(대안 4) `dangerouslySetInnerHTML`로 `<mark>` 주입** — XSS 위험(로그 값은 페이지 유래 신뢰 불가 데이터). → 기각. 세그먼트 배열 → React 노드 방식이 안전.

## 위험 요소

- **깊이 접힌 JSON 매칭 은폐**: `defaultExpandDepth=1`이라 depth 2+ 접힌 노드 안의 매칭은 아코디언에 가려 안 보임 → `collectMatchExpandedPaths`로 조상 자동 펼침(위 변경). path 스킴이 트리 내부와 어긋나면 안 열리므로 `SEP`·root 규칙을 트리와 **동일 파일에서 공유**(회귀 포인트). 대형 JSON 전수 순회지만 상세 1개 요청 한정이라 부담 낮음.
- **JSON `StringRow` truncate**: 300자 초과 문자열도 쿼리 매칭 시 자동 전체 표시로 해소(위 변경). 검색 안 할 때만 기존 truncate 유지.
- **정규식 이스케이프 누락 시 오작동/예외**: `.`·`(`·`*`·`\` 등이 포함된 검색어(URL·페이로드에 흔함). `escapeRegExp` 유닛 테스트로 커버.
- **성능**: 상세는 선택된 1개 요청만 렌더 + leaf 단위 짧은 문자열 분할이라 부담 없음. 대형 JSON도 트리가 이미 청크(`ARRAY_CHUNK_SIZE=100`)·펼침 노드만 렌더하므로 하이라이트가 렌더량을 늘리지 않음.
- **`<mark>` 텍스트 색**: `text-inherit`이 없으면 `<mark>` 기본 검정 글자로 JSON 구문색이 깨진다. 단 className이 `HighlightedText` **단일 출처**라 한 번만 지정하면 되고 회귀 여지는 낮다 — 호출부가 `className` prop으로 텍스트 색을 덮어쓰지만 않으면 안전.
- **WS 프레임(`FrameBody`)은 같은 `JsonTreeViewer`를 쓰지만 `highlightQuery` 미전달** → messages 탭은 하이라이트 안 됨(의도된 Non-goal). `FrameBody`는 손대지 않음.
