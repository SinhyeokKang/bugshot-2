# 네트워크 로그 본문 검색 — 기술 설계

## 개요

매칭 로직을 컴포넌트 useMemo 인라인에서 **순수 함수**로 분리(`src/lib/network-search.ts`)해 테스트 가능하게 만들고, 검색 대상을 URL → URL+본문+헤더로 확장한다. 큰 본문에서의 입력 렉은 **값 디바운스 훅**(`useDebouncedValue`)으로 흡수한다. input의 즉시값(`query`)과 필터에 쓰는 디바운스값(`debouncedQuery`)을 분리해 입력 반응성과 필터 비용을 떼어 놓는다.

## 변경 범위

### 신규 파일

- **`src/lib/network-search.ts`** — 순수 매칭 함수.
  - `requestMatchesQuery(req: NetworkRequest, lowerQuery: string): boolean`
  - 필드를 순서대로(URL → req body → res body → req headers → res headers) 검사하고 **첫 매칭에서 즉시 true 반환**(거대 문자열 concat 회피 + short-circuit). 비문자열 본문은 건너뜀.
  - `lowerQuery`는 호출부에서 이미 lowercase·non-empty임을 전제(빈 쿼리는 caller가 단축 처리).

- **`src/lib/__tests__/network-search.test.ts`** — 위 함수 단위 테스트.

- **`src/sidepanel/lib/useDebouncedValue.ts`** — 제네릭 값 디바운스 훅.
  - `useDebouncedValue<T>(value: T, delayMs: number): T`
  - 기존 `useDebouncedSearch`(jiraFields, async fetch용)와 별개 — 그건 fetch 트리거형이라 로컬 값 지연에 부적합.

### 변경 파일

- **`src/sidepanel/components/NetworkLogContent.tsx`**
  - 현재 역할: 네트워크 로그 목록·필터·검색·상세 패널 렌더.
  - 변경: 
    1. `const debouncedQuery = useDebouncedValue(query, 200)` 추가.
    2. `filteredRequests` useMemo의 검색 분기를 `r.url.toLowerCase().includes(lower)` → `requestMatchesQuery(r, lower)`로 교체. 의존성 배열의 `query` → `debouncedQuery`.
    3. `query`(즉시값)는 Input `value`·clear(X)·`useScrollToEntry`의 resetFilters에 그대로 사용(입력 반응성 유지).

- **`src/i18n/namespaces/logs.ts`**
  - `networkLog.search` placeholder 갱신: ko `"URL 검색…"` → `"검색…"`, en `"Search URL…"` → `"Search…"`. (URL 한정 표현 제거. ko/en 동시 갱신 — i18n PostToolUse 훅이 대칭 검사)

## 데이터 흐름

```
Input onChange → setQuery(즉시값)
  ├─ Input value / clear 버튼 / resetFilters  ← query 직접 사용
  └─ useDebouncedValue(query, 200) → debouncedQuery
        └─ filteredRequests useMemo
              → requestMatchesQuery(req, debouncedQuery.toLowerCase()) 로 필터
```

새 타입·스토리지·메시지 없음. 순수 in-memory 필터 계산만 변경.

## 인터페이스 설계

```typescript
// src/lib/network-search.ts
import type { NetworkRequest } from "@/types/network";

/** lowerQuery는 비어있지 않고 이미 소문자임을 전제. URL·본문(문자열)·헤더(키/값)를 순차 검사. */
export function requestMatchesQuery(req: NetworkRequest, lowerQuery: string): boolean;
```

```typescript
// src/sidepanel/lib/useDebouncedValue.ts
export function useDebouncedValue<T>(value: T, delayMs: number): T;
```

호출부:

```typescript
// NetworkLogContent.tsx
const debouncedQuery = useDebouncedValue(query, 200);
const filteredRequests = useMemo(() => {
  let result = filter === "all" ? requests : requests.filter((r) => classifyRequest(r) === filter);
  if (originFilter !== null) result = result.filter((r) => originKey(r.pageUrl) === originFilter);
  if (debouncedQuery) {
    const lower = debouncedQuery.toLowerCase();
    result = result.filter((r) => requestMatchesQuery(r, lower));
  }
  return result;
}, [requests, filter, originFilter, debouncedQuery]);
```

## 기존 패턴 준수

- **테스트 우선**(CLAUDE.md): 신규 인터페이스 `requestMatchesQuery`는 `/tdd interface`로 테스트 먼저 박고 구현. 매칭 로직을 순수 함수로 분리하는 이유가 이 검증성 확보다.
- **i18n 동시 갱신**: `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts` 자동 실행 → ko/en 키 대칭·placeholder 토큰 일치 강제. search 키엔 토큰 없음.
- **외과적 변경**: 콘솔/액션 로그 컴포넌트는 손대지 않음(이미 본문 검색 중). 필터 체인 순서·구조 유지, 검색 분기만 교체.
- **순수 함수 테스트 위치**: `src/lib/__tests__/network-search.test.ts` (대상과 동일 디렉터리 규칙).

## 대안 검토

- **(채택 안 함) 검색 텍스트 사전계산 캐시**: 각 request의 검색 대상 문자열을 미리 lowercase해 메모이즈. 키 입력당 비용은 줄지만 메모리(최대 50MB×2)·코드 복잡도가 늘고, request 배열이 stream으로 계속 갱신돼 캐시 무효화가 잦다. 디바운스+short-circuit 매칭으로 충분하다고 판단. 부족하면 후속 과제.
- **(채택 안 함) 매칭을 컴포넌트 내부에 그대로 인라인 확장**: 테스트 불가. 신규 로직(헤더·본문 순회·타입 가드)이 생기므로 순수 함수 분리가 테스트 우선 원칙에 맞다.
- **(채택 안 함) 디바운스 대신 ConsoleLog처럼 즉시 필터**: 콘솔은 `args` 단일 문자열이라 가볍지만, 네트워크 본문은 3MB×5000건이라 즉시 필터는 렉 위험. 디바운스 선택(사용자 결정).

## 위험 요소

- **short-circuit 순서 의존**: 매칭이 필드 순서대로 첫 true에서 반환하므로, 테스트는 "URL에만 있는 케이스"와 "응답 본문에만 있는 케이스"를 분리해 각 분기가 실제로 도달하는지 확인할 것.
- **비문자열 본문 가드 누락**: `requestBody`/`responseBody`가 `{kind:...}` 객체일 때 `.toLowerCase()` 호출하면 throw. `typeof body === "string"` 가드 필수 — 테스트로 강제.
- **헤더 검색 범위 혼동**: 헤더는 키·값 모두 검사. 마스킹된 헤더 값은 `***`로 저장됨 → 원문 검색 불가(의도). 테스트에 명시.
- **디바운스와 `useScrollToEntry` 상호작용**: resetFilters는 `setQuery("")`로 즉시값을 비움 → 디바운스 후 debouncedQuery도 ""가 되어 필터 해제됨. 스크롤-투-엔트리 직후 타이밍에서 200ms 지연이 영향 없는지 관찰(현재 resetFilters는 검색을 비우는 방향이라 위험 낮음).
- **input 반응성**: `value`는 반드시 즉시값 `query`에 바인딩(디바운스값에 바인딩하면 입력이 끊겨 보임).
