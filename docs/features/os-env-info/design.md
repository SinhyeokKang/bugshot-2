# OS 환경 정보 — 기술 설계

## 개요
browser-env-info와 동일한 2경로 패턴(UI 표시 + 이슈 본문)으로 OS 행을 추가한다. 핵심 차이: Chrome 107+ 이후 UA 문자열의 OS 버전이 frozen되어 `navigator.userAgentData.getHighEntropyValues(["platformVersion"])`(비동기)를 사용한다. side panel 로드 시 한 번 resolve해서 모듈 캐시에 저장하고, 이후 call site에서 동기적으로 읽는다.

## 변경 범위

### `src/sidepanel/lib/osInfo.ts` (NEW)
- **역할**: OS 정보 파싱·캐싱 모듈
- **내용**:
  1. `formatOsInfo(platform: string, platformVersion: string): string` — 순수 함수. 플랫폼별 표시 문자열 생성
  2. `resolveOsInfo(): Promise<string | null>` — `getHighEntropyValues()` 호출 후 `formatOsInfo`로 포맷팅, 결과를 모듈 캐시에 저장
  3. `getOsInfo(): string | null` — 캐시된 값을 동기적으로 반환

### `src/sidepanel/main.tsx`
- **현재 역할**: side panel 엔트리포인트 (canvas patch, storage listener, React root render)
- **변경**: `root.render()` 전에 `void resolveOsInfo()` 호출 추가 (fire-and-forget). `getHighEntropyValues`는 로컬 브라우저 API라 < 1ms에 resolve되며, App의 hydration gate(`editorHydrated && settingsHydrated`)보다 훨씬 빠르다.

### `src/sidepanel/lib/environmentRows.ts`
- **현재 역할**: readonly 환경 행 파생 + 커스텀 행 필터링 유틸리티
- **변경**:
  1. `ReadonlyEnvInput`에 `os?: string | null` 필드 추가
  2. `deriveReadonlyEnvRows()`에서 `os`가 truthy면 rows 맨 앞에 `{ label: "OS", value: input.os }` 삽입 (Browser 앞)

### `src/sidepanel/lib/buildIssueMarkdown.ts`
- **현재 역할**: `MarkdownContext` 타입 정의 + `buildIssueMarkdown()` / `buildIssueHtml()` 빌더
- **변경**:
  1. `MarkdownContext`에 `os?: string | null` 필드 추가
  2. `buildIssueMarkdown()` / `buildIssueHtml()`의 환경 섹션에서 `ctx.os`가 truthy면 Browser 행 위에 OS 행 출력

### `src/sidepanel/lib/buildGithubIssueBody.ts`
- **현재 역할**: GitHub 이슈 본문 빌더
- **변경**: 환경 섹션에서 `ctx.os`가 truthy면 Browser 행 위에 `- **OS**: <value>` 출력

### `src/sidepanel/lib/buildLinearIssueBody.ts`
- **현재 역할**: Linear 이슈 본문 빌더
- **변경**: 환경 섹션에서 `ctx.os`가 truthy면 Browser 행 위에 OS 행 출력

### `src/sidepanel/lib/buildIssueAdf.ts`
- **현재 역할**: Jira ADF 본문 빌더
- **변경**: 환경 섹션에서 `ctx.os`가 truthy면 Browser 행 위에 OS 행 출력 (element/non-element 양쪽 분기 모두)

### `src/sidepanel/lib/buildNotionIssueBody.ts`
- **현재 역할**: Notion blocks 본문 빌더
- **변경**: 환경 섹션에서 `ctx.os`가 truthy면 Browser 행 위에 OS 행 출력

### `src/sidepanel/tabs/DraftingPanel.tsx` (line 366 부근)
- **변경**: `deriveReadonlyEnvRows()` 호출 시 `os: getOsInfo()` 전달

### `src/sidepanel/tabs/PreviewPanel.tsx`
- **변경**:
  1. `NonElementEnvSection` (line 398 부근): OS 행 추가 (Browser 위)
  2. `EnvParagraph` (line 438 부근): `os` prop 추가, rows 배열 맨 앞에 삽입
  3. `handleCopyMarkdown()` (line 106 부근): MarkdownContext 생성부에 `os: getOsInfo()` 추가

### `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **변경**:
  1. `EnvBlock` (line 754 부근): OS 행 추가 (Browser 위)
  2. `buildCtxForSubmit()` (line 232 부근): MarkdownContext 생성부에 `os: getOsInfo()` 추가

### `src/sidepanel/tabs/IssueCreateModal.tsx`
- **변경**: `buildCtx()` (line 121 부근): MarkdownContext 생성부에 `os: getOsInfo()` 추가

### `src/sidepanel/lib/__tests__/osInfo.test.ts` (NEW)
- **역할**: `formatOsInfo` 순수 함수 단위 테스트
- **케이스**: macOS 정상, macOS 버전 없음, Windows 11 (major ≥ 13), Windows 10 (major 1-12), Linux, Chrome OS, 알 수 없는 platform

### `src/sidepanel/lib/__tests__/environmentRows.test.ts`
- **변경**: `deriveReadonlyEnvRows` 테스트에 `os` 필드 관련 케이스 추가 (os 있을 때 첫 행, os+browser 순서, os null일 때 생략)

### `src/sidepanel/lib/__tests__/buildGithubIssueBody.test.ts`
- **변경**: browser 테스트 블록과 동일한 패턴으로 os 테스트 블록 추가 (os 있을 때 Browser 위 위치, null 시 미출력, 미전달 시 하위호환)

## 데이터 흐름

```
main.tsx (side panel 로드)
  → resolveOsInfo()
    → navigator.userAgentData.getHighEntropyValues(["platformVersion"])
    → formatOsInfo(platform, platformVersion) → "macOS 15.2" | "Windows 11" | ...
    → 모듈 캐시 저장

경로 1 — UI 표시 (DraftingPanel):
  getOsInfo() → ReadonlyEnvInput.os
  → deriveReadonlyEnvRows() → [OS?, Browser?, Page, DOM?, Viewport?, Captured?]
  → ReproEnvironmentSection readonly rows

경로 2 — 이슈 본문 (빌더 5개 + PreviewPanel + DraftDetailDialog):
  getOsInfo() → MarkdownContext.os
  → buildGithubIssueBody() / buildLinearIssueBody() / buildIssueAdf() / buildNotionIssueBody() / buildIssueMarkdown() / buildIssueHtml()
  → 이슈 본문 환경 섹션 첫 행

경로 2b — UI 표시 (PreviewPanel·DraftDetailDialog):
  getOsInfo() → EnvParagraph / NonElementEnvSection / EnvBlock 컴포넌트에서 직접 렌더
```

## 인터페이스 설계

```typescript
// osInfo.ts
export function formatOsInfo(platform: string, platformVersion: string): string;
export function resolveOsInfo(): Promise<string | null>;
export function getOsInfo(): string | null;

// environmentRows.ts
export interface ReadonlyEnvInput {
  os?: string | null;       // 추가
  browser?: string | null;
  url: string;
  selector?: string | null;
  viewport?: { w: number; h: number } | null;
  capturedAt?: number | null;
}

// buildIssueMarkdown.ts
export interface MarkdownContext {
  os?: string | null;       // 추가
  browser?: string | null;
  // ... 기존 필드 유지
}
```

### `formatOsInfo` 매핑 규칙

| platform | platformVersion 예시 | 출력 |
|---|---|---|
| `"macOS"` | `"15.2.0"` | `"macOS 15.2"` |
| `"macOS"` | `""` | `"macOS"` |
| `"Windows"` | `"15.0.0"` (major ≥ 13) | `"Windows 11"` |
| `"Windows"` | `"10.0.0"` (major 1-12) | `"Windows 10"` |
| `"Windows"` | `"0.0.0"` 또는 `""` | `"Windows"` |
| `"Linux"` | (무시) | `"Linux"` |
| `"Chrome OS"` | `"120.0.6099"` | `"Chrome OS 120.0"` |
| 기타 | - | `platform` 그대로 |

버전 축약: `platform`이 `"macOS"` 또는 `"Chrome OS"`일 때 `platformVersion`의 첫 2 세그먼트만 사용 (`"15.2.0"` → `"15.2"`).

Windows 매핑 근거: Chrome의 `getHighEntropyValues`에서 Windows 11은 major ≥ 13, Windows 10은 major 1-12를 반환한다.

## 기존 패턴 준수
- readonly 행은 `deriveReadonlyEnvRows`에서만 생성 (ARCHITECTURE.md 환경 행 파생 패턴)
- 순수 함수(`formatOsInfo`) + 입력 기반 파생 — 기존 `parseChromeVersion` 분리 패턴과 동일
- 빌더는 `MarkdownContext` 개별 필드 참조 패턴 그대로 따름
- PreviewPanel·DraftDetailDialog 내부 환경 렌더링도 기존 하드코딩 패턴 유지 (OS 행만 추가)
- 파싱 실패 시 `null` → 행 생략 (browser와 동일한 방어적 패턴)

## 대안 검토

| 대안 | 불채택 사유 |
|---|---|
| UA 문자열만 파싱 (동기, browser와 동일 패턴) | Chrome 107+ 이후 UA의 OS 버전이 frozen (macOS는 항상 10_15_7, Windows는 항상 NT 10.0). 정확한 버전을 얻을 수 없어 기능 가치가 반감됨. |
| Zustand 스토어에 OS 정보 저장 | 세션 중 변하지 않는 값 하나를 위해 스토어를 만들거나 기존 스토어에 끼우는 건 과도. 모듈 캐시가 가장 단순. |
| React Context로 OS 정보 전달 | 전달 경로가 길어지고 (App → 각 탭 → 각 컴포넌트), 빌더 함수는 React 외부라 context에서 접근 불가. |
| `navigator.platform` 사용 | deprecated이며 "MacIntel", "Win32" 등 부정확한 값만 반환. |

## 위험 요소
- **TypeScript 타입**: `navigator.userAgentData`는 TS 5.x DOM lib에 포함돼 있으나, `getHighEntropyValues`의 반환 타입이 프로젝트 설정에서 인식되는지 확인 필요. 미인식 시 `src/types/` 아래 `userAgentData.d.ts` 선언 추가.
- **그 외 없음**: Chrome 116+ 전용 확장이므로 `userAgentData` API 가용성이 보장됨. resolve 실패 시 null fallback으로 OS 행만 생략.
