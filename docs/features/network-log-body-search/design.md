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

- **`src/sidepanel/lib/useScrollToEntry.ts`**
  - 현재 역할: 대상 엔트리가 필터로 가려지면 `resetFilters()`로 1회 재시도 후 스크롤(`scrollResetRef` 1-shot).
  - 변경: 검색어 즉시값(`query`)을 의존성/재시도 판정에 포함. 디바운스 도입 후 `resetFilters`가 `setQuery("")`해도 `debouncedQuery`는 ~200ms 옛값을 유지하므로, retry가 즉시값을 보지 못하면 대상이 계속 가려져 스크롤이 실패한다(위험 요소 참조). caller(`NetworkLogContent`)가 즉시값 `query`를 훅에 넘기도록 한다.

- **`src/i18n/namespaces/logs.ts`**
  - `networkLog.search` placeholder 갱신: ko `"URL 검색…"` → `"URL·본문 검색…"`, en `"Search URL…"` → `"Search URL & body…"`. (형제 탭의 `[대상] 검색…` 패턴 유지 + 본문도 검색된다는 멘탈모델 제공. ko/en 동시 갱신 — i18n PostToolUse 훅이 대칭 검사)

## 데이터 흐름

```
Input onChange → setQuery(즉시값)
  ├─ Input value = query (즉시 바인딩, 입력 반응성)
  ├─ clear 버튼·resetFilters → setQuery("") (즉시값 쓰기)
  ├─ useScrollToEntry ← query (즉시값 읽어 retry 판정)
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

- **(채택 안 함) 검색 텍스트 사전계산 캐시**: 각 request의 검색 대상 문자열을 미리 lowercase해 메모이즈. 키 입력당 비용은 줄지만 캐시 메모리(문자열 본문 총량 상한 ~50MB의 사본)·코드 복잡도가 늘고, request 배열이 stream으로 계속 갱신돼(`mergeLogItems` evict) 캐시 무효화가 잦다. 실제 스캔 대상은 `MEMORY_CAP = 50MB`로 바운드되고(초과 시 oldest body가 `{kind:"omitted"}`로 evict) 디바운스+short-circuit 매칭으로 충분하다고 판단. 부족하면 후속 과제.
- **(채택 안 함) 매칭을 컴포넌트 내부에 그대로 인라인 확장**: 테스트 불가. 신규 로직(헤더·본문 순회·타입 가드)이 생기므로 순수 함수 분리가 테스트 우선 원칙에 맞다.
- **(채택 안 함) 디바운스 대신 ConsoleLog처럼 즉시 필터**: 콘솔은 `args` 단일 문자열이라 가볍지만, 네트워크 본문은 3MB×5000건이라 즉시 필터는 렉 위험. 디바운스 선택(사용자 결정).

## 위험 요소

- **short-circuit 순서 의존**: 매칭이 필드 순서대로 첫 true에서 반환하므로, 테스트는 "URL에만 있는 케이스"와 "응답 본문에만 있는 케이스"를 분리해 각 분기가 실제로 도달하는지 확인할 것.
- **비문자열 본문 가드 누락**: `requestBody`/`responseBody`가 `{kind:...}` 객체일 때 `.toLowerCase()` 호출하면 throw. `typeof body === "string"` 가드 필수 — 테스트로 강제.
- **헤더 검색 범위 혼동**: 헤더는 키·값 모두 검사. 마스킹된 헤더 값은 `***[len:N]`(원문 길이 노출), 본문 마스킹 값은 `***`로 저장됨 → 둘 다 원문 검색 불가(의도). 테스트에 명시.
- **🔴 디바운스 ↔ `useScrollToEntry` 회귀 (실제 위험, 처리 필요)**: `useScrollToEntry`는 대상이 필터로 가려지면 `resetFilters()` 후 1회만 재시도(`scrollResetRef` 1-shot). 디바운스 도입 전엔 `setQuery("")`가 `filteredRequests`를 즉시 갱신해 retry가 성공했지만, 도입 후엔 `debouncedQuery`가 ~200ms 옛값을 유지해 query 필터가 남아 있어 retry가 대상을 못 찾고 `onScrollComplete()`로 포기 → 스크롤 실패. **처리**: caller가 즉시값 `query`를 `useScrollToEntry`에 넘기고, 훅이 retry 판정에 즉시값을 반영한다(위 변경 파일). regression 테스트로 고정.
- **성능/GC 압력**: 실제 비용 드라이버는 CPU 스캔이 아니라 **대용량 문자열 `toLowerCase` 재할당**이다. `requestMatchesQuery`가 매 필터 패스마다 각 body에 `body.toLowerCase()`를 호출하면 본문당 동일 크기 문자열을 새로 할당(총량 상한 ~50MB의 GC churn/패스). 디바운스+short-circuit으로 흡수. 사전계산 캐시 기각이 정확히 이 비용을 후속으로 미루는 trade-off.
- **input 반응성**: `value`는 반드시 즉시값 `query`에 바인딩(디바운스값에 바인딩하면 입력이 끊겨 보임).
