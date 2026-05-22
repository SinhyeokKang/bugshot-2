# Browser 환경 정보 — 기술 설계

## 개요
`deriveReadonlyEnvRows()`가 반환하는 readonly 행 배열의 맨 앞에 Browser 행을 추가한다. Chrome 버전은 `navigator.userAgent`에서 파싱하며, 순수 함수로 분리해 테스트 가능하게 한다.

## 변경 범위

### `src/sidepanel/lib/environmentRows.ts`
- **현재 역할**: readonly 환경 행 파생 + 커스텀 행 필터링 유틸리티
- **변경**:
  1. `parseChromeVersion(ua: string): string` export 추가 — `Chrome/(\d[\d.]+)` 매칭 → `"Chrome <version>"`, 실패 시 `"Unknown"`
  2. `ReadonlyEnvInput`에 `browser?: string | null` 필드 추가
  3. `deriveReadonlyEnvRows()` 본문 시작부에 `browser`가 truthy면 `{ label: "Browser", value: input.browser }` 를 rows 맨 앞에 삽입

### `src/sidepanel/tabs/DraftingPanel.tsx` (line 365 부근)
- **현재 역할**: 이슈 작성 패널 컴포넌트
- **변경**: `deriveReadonlyEnvRows()` 호출 시 `browser: parseChromeVersion(navigator.userAgent)` 전달

### `src/sidepanel/lib/__tests__/environmentRows.test.ts`
- **현재 역할**: filterEnvironmentRows, deriveReadonlyEnvRows 단위 테스트
- **변경**:
  1. `parseChromeVersion` describe 블록 추가
  2. `deriveReadonlyEnvRows` 기존 테스트 중 전체 행 순서 검증하는 케이스에 browser 필드 반영 (기존 동작도 browser 미전달로 그대로 유지)

## 데이터 흐름

```
navigator.userAgent (side panel context)
  → parseChromeVersion() → "Chrome 128.0.6613.85"
  → ReadonlyEnvInput.browser
  → deriveReadonlyEnvRows() → [Browser, Page, DOM?, Viewport?, Captured?]
  → DraftingPanel readonlyRows 렌더
  → buildXxxIssueBody() → 이슈 본문에 포함
```

이슈 본문 빌더(`buildGithubIssueBody`, `buildLinearIssueBody`, `buildNotionIssueBody`, `buildIssueAdf`, `buildIssueMarkdown`)는 readonlyRows 배열을 순회하며 출력하므로 **빌더 코드 변경 불필요** — 입력 배열에 Browser 행이 들어오면 자동으로 출력됨.

## 인터페이스 설계

```typescript
// environmentRows.ts
export function parseChromeVersion(ua: string): string;

export interface ReadonlyEnvInput {
  browser?: string | null;  // 추가
  url: string;
  selector?: string | null;
  viewport?: { w: number; h: number } | null;
  capturedAt?: number | null;
}
```

## 기존 패턴 준수
- readonly 행은 `deriveReadonlyEnvRows`에서만 생성 (ARCHITECTURE.md의 환경 행 파생 패턴)
- 순수 함수 + 입력 기반 파생 (테스트 용이성)
- 파싱 로직을 별도 export 함수로 분리 (기존 `formatTimestamp` 분리 패턴과 동일)

## 대안 검토

| 대안 | 불채택 사유 |
|---|---|
| `navigator.userAgentData.brands` 사용 | Chrome 전용이라 가능하지만, brands 배열에서 "Google Chrome"을 찾아 버전을 조합하는 로직이 UA 파싱보다 복잡. 결과도 동일. |
| `deriveReadonlyEnvRows` 내부에서 직접 `navigator.userAgent` 접근 | 함수가 impure해져 테스트 시 global mock 필요. 입력으로 받는 게 기존 패턴과 일관적. |

## 위험 요소
- 없음. Chrome 전용 확장이라 `navigator.userAgent`에 `Chrome/` 토큰이 항상 존재. fallback `"Unknown"`은 방어적 안전망.
