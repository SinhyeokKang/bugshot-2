# Browser 환경 정보 — 기술 설계

## 개요
환경 정보에 Browser 행을 추가한다. 두 경로가 존재:
1. **UI 표시**: `deriveReadonlyEnvRows()`가 반환하는 readonly 행 배열 맨 앞에 삽입 (DraftingPanel)
2. **이슈 본문/미리보기**: `MarkdownContext.browser` 필드를 5개 빌더 + PreviewPanel + DraftDetailDialog에서 참조

Chrome 버전은 `navigator.userAgent`에서 파싱하며, 순수 함수로 분리해 테스트 가능하게 한다. 파싱 실패 시 `null`을 반환하고 Browser 행을 생략한다.

## 변경 범위

### `src/sidepanel/lib/environmentRows.ts`
- **현재 역할**: readonly 환경 행 파생 + 커스텀 행 필터링 유틸리티
- **변경**:
  1. `parseChromeVersion(ua: string): string | null` export 추가 — `Chrome/(\d[\d.]+)` 매칭 → `"Chrome <version>"`, 실패 시 `null`
  2. `ReadonlyEnvInput`에 `browser?: string | null` 필드 추가
  3. `deriveReadonlyEnvRows()` 본문 시작부에 `browser`가 truthy면 `{ label: "Browser", value: input.browser }` 를 rows 맨 앞에 삽입

### `src/sidepanel/lib/buildIssueMarkdown.ts`
- **현재 역할**: `MarkdownContext` 타입 정의 + `buildIssueMarkdown()` / `buildIssueHtml()` 빌더
- **변경**:
  1. `MarkdownContext`에 `browser?: string | null` 필드 추가
  2. `buildIssueMarkdown()` / `buildIssueHtml()`의 환경 섹션에서 `ctx.browser`가 truthy면 Page 행 위에 `**Browser**: <value>` 출력

### `src/sidepanel/lib/buildGithubIssueBody.ts`
- **현재 역할**: GitHub 이슈 본문 빌더
- **변경**: 환경 섹션(line 59 부근)에서 `ctx.browser`가 truthy면 Page 행 위에 `- **Browser**: <value>` 출력

### `src/sidepanel/lib/buildLinearIssueBody.ts`
- **현재 역할**: Linear 이슈 본문 빌더
- **변경**: 환경 섹션에서 `ctx.browser`가 truthy면 Page 행 위에 Browser 행 출력

### `src/sidepanel/lib/buildIssueAdf.ts`
- **현재 역할**: Jira ADF 본문 빌더
- **변경**: 환경 섹션에서 `ctx.browser`가 truthy면 Page 행 위에 Browser 행 출력

### `src/sidepanel/lib/buildNotionIssueBody.ts`
- **현재 역할**: Notion blocks 본문 빌더
- **변경**: 환경 섹션에서 `ctx.browser`가 truthy면 Page 행 위에 Browser 행 출력

### `src/sidepanel/tabs/DraftingPanel.tsx` (line 365 부근)
- **현재 역할**: 이슈 작성 패널 컴포넌트
- **변경**: `deriveReadonlyEnvRows()` 호출 시 `browser: parseChromeVersion(navigator.userAgent)` 전달

### `src/sidepanel/tabs/PreviewPanel.tsx`
- **현재 역할**: 이슈 미리보기 + 마크다운 복사
- **변경**:
  1. `EnvParagraph`(element 모드, line 424)·`NonElementEnvSection`(기타 모드, line 371)에 Browser 행 추가
  2. `handleCopyMarkdown()`의 MarkdownContext 생성부(line 105)에 `browser: parseChromeVersion(navigator.userAgent)` 추가

### `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **현재 역할**: 과거 이슈 상세 다이얼로그
- **변경**:
  1. `EnvBlock`(line 753)에 Browser 행 추가
  2. `buildCtxForSubmit()`(line 220)의 MarkdownContext 생성부에 `browser: parseChromeVersion(navigator.userAgent)` 추가

### `src/sidepanel/tabs/IssueCreateModal.tsx`
- **현재 역할**: 이슈 생성 모달
- **변경**: `buildCtx()`(line 118)의 MarkdownContext 생성부에 `browser: parseChromeVersion(navigator.userAgent)` 추가

### `src/sidepanel/lib/__tests__/environmentRows.test.ts`
- **현재 역할**: filterEnvironmentRows, deriveReadonlyEnvRows 단위 테스트
- **변경**:
  1. `parseChromeVersion` describe 블록 추가 (일반 UA, 빈 문자열, Edge UA, HeadlessChrome 등)
  2. `deriveReadonlyEnvRows` 기존 테스트 중 전체 행 순서 검증하는 케이스에 browser 필드 반영

## 데이터 흐름

```
navigator.userAgent (side panel context)
  → parseChromeVersion() → "Chrome 128.0.6613.85" | null

경로 1 — UI 표시 (DraftingPanel):
  → ReadonlyEnvInput.browser
  → deriveReadonlyEnvRows() → [Browser?, Page, DOM?, Viewport?, Captured?]
  → ReproEnvironmentSection readonly rows

경로 2 — 이슈 본문 (빌더 5개 + PreviewPanel + DraftDetailDialog):
  → MarkdownContext.browser
  → buildGithubIssueBody() / buildLinearIssueBody() / buildIssueAdf() / buildNotionIssueBody() / buildIssueMarkdown() / buildIssueHtml()
  → 이슈 본문 환경 섹션 첫 행

경로 2b — UI 표시 (PreviewPanel·DraftDetailDialog):
  → EnvParagraph / NonElementEnvSection / EnvBlock 컴포넌트에서 직접 렌더
```

**주의**: 빌더는 `readonlyRows`를 사용하지 않고 `MarkdownContext`의 개별 필드(url, selector, viewport, capturedAt)를 직접 참조해 환경 행을 구성한다. `ctx.environment`는 사용자 커스텀 행만 담기므로, Browser 행은 `ctx.browser` 필드로 별도 전달해야 한다.

## 인터페이스 설계

```typescript
// environmentRows.ts
export function parseChromeVersion(ua: string): string | null;

export interface ReadonlyEnvInput {
  browser?: string | null;  // 추가
  url: string;
  selector?: string | null;
  viewport?: { w: number; h: number } | null;
  capturedAt?: number | null;
}

// buildIssueMarkdown.ts
export interface MarkdownContext {
  browser?: string | null;  // 추가
  // ... 기존 필드 유지
}
```

## 기존 패턴 준수
- readonly 행은 `deriveReadonlyEnvRows`에서만 생성 (ARCHITECTURE.md의 환경 행 파생 패턴)
- 순수 함수 + 입력 기반 파생 (테스트 용이성)
- 파싱 로직을 별도 export 함수로 분리 (기존 `formatTimestamp` 분리 패턴과 동일)
- 빌더는 `MarkdownContext` 개별 필드 참조 패턴을 그대로 따름
- PreviewPanel·DraftDetailDialog 내부 환경 렌더링도 기존 하드코딩 패턴 유지 (Browser 행만 추가)

## 대안 검토

| 대안 | 불채택 사유 |
|---|---|
| `navigator.userAgentData.brands` 사용 | Chrome 전용이라 가능하지만, brands 배열에서 "Google Chrome"을 찾아 버전을 조합하는 로직이 UA 파싱보다 복잡. 결과도 동일. |
| `deriveReadonlyEnvRows` 내부에서 직접 `navigator.userAgent` 접근 | 함수가 impure해져 테스트 시 global mock 필요. 입력으로 받는 게 기존 패턴과 일관적. |
| readonlyRows를 빌더에 전달하도록 구조 리팩터 | 5개 빌더 + 3개 ctx 생성부 전체를 리팩터해야 하며, 기존 패턴(개별 필드 참조)과 괴리. Browser 1개 추가에 비해 과도한 변경. |

## 위험 요소
- 없음. Chrome 전용 확장이라 `navigator.userAgent`에 `Chrome/` 토큰이 항상 존재. fallback `null`은 방어적 안전망으로, Browser 행을 숨긴다.
