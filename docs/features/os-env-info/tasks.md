# OS 환경 정보 — 구현 태스크

## 선행 조건
- `navigator.userAgentData.getHighEntropyValues(["platformVersion"])` 타입이 TS에서 인식되는지 확인. 미인식 시 타입 선언 파일 추가 필요.

## 태스크

### Task 1: osInfo 모듈 + 단위 테스트

- **변경 대상**: `src/sidepanel/lib/osInfo.ts` (NEW), `src/sidepanel/lib/__tests__/osInfo.test.ts` (NEW)
- **작업 내용**:
  1. `formatOsInfo(platform: string, platformVersion: string): string` 순수 함수 구현
     - macOS: `"macOS"` + 버전 첫 2 세그먼트 (`"15.2.0"` → `"macOS 15.2"`, `""` → `"macOS"`)
     - Windows: major ≥ 13 → `"Windows 11"`, major 1-12 → `"Windows 10"`, 그 외 → `"Windows"`
     - Linux: `"Linux"`
     - Chrome OS: `"Chrome OS"` + 버전 첫 2 세그먼트
     - 기타: `platform` 그대로
  2. `resolveOsInfo(): Promise<string | null>` — API 호출 + 캐싱
  3. `getOsInfo(): string | null` — 동기 getter
  4. 테스트: `formatOsInfo` 순수 함수 케이스 (macOS 정상/빈 버전, Windows 11/10/미매핑, Linux, Chrome OS, 알 수 없는 platform, 빈 platform)
- **검증**:
  - [ ] `pnpm test` — osInfo.test.ts 전체 통과
  - [ ] `pnpm typecheck` — 타입 에러 없음

### Task 2: environmentRows에 os 필드 추가 + 테스트

- **변경 대상**: `src/sidepanel/lib/environmentRows.ts`, `src/sidepanel/lib/__tests__/environmentRows.test.ts`
- **작업 내용**:
  1. `ReadonlyEnvInput`에 `os?: string | null` 추가
  2. `deriveReadonlyEnvRows()` 본문 시작부에 `os`가 truthy면 `{ label: "OS", value: input.os }` 를 rows 맨 앞에 삽입 (기존 Browser 삽입 로직 앞)
  3. 테스트 추가: os 있을 때 첫 행이 OS, os+browser 순서(OS → Browser), os null이면 OS 행 없음, os 미전달 시 기존 동작 유지
- **검증**:
  - [ ] `pnpm test` — environmentRows.test.ts 전체 통과
  - [ ] 기존 browser 관련 테스트가 깨지지 않음

### Task 3: MarkdownContext + 5개 빌더 업데이트

- **변경 대상**:
  - `src/sidepanel/lib/buildIssueMarkdown.ts`
  - `src/sidepanel/lib/buildGithubIssueBody.ts`
  - `src/sidepanel/lib/buildLinearIssueBody.ts`
  - `src/sidepanel/lib/buildIssueAdf.ts`
  - `src/sidepanel/lib/buildNotionIssueBody.ts`
- **작업 내용**:
  1. `MarkdownContext`에 `os?: string | null` 필드 추가
  2. 5개 빌더 모두의 환경 섹션에서 `ctx.os`가 truthy면 Browser 행 위에 OS 행 출력
     - Markdown/GitHub/Linear: `- **OS**: ${ctx.os}`
     - ADF (Jira): `keyValueItem("OS", ctx.os)` (element/non-element 양쪽 분기)
     - Notion: `{ type: "bulleted_list_item", text: \`OS: ${ctx.os}\` }`
     - HTML: `<li><strong>OS</strong>: ${escapeHtml(ctx.os)}</li>`
  3. `buildGithubIssueBody.test.ts`에 os 테스트 블록 추가 (browser 테스트 블록과 동일 패턴)
- **검증**:
  - [ ] `pnpm test` — buildGithubIssueBody.test.ts 전체 통과
  - [ ] 기존 browser 테스트가 깨지지 않음

### Task 4: main.tsx 초기화 + UI 컴포넌트 call site 업데이트

- **변경 대상**:
  - `src/sidepanel/main.tsx`
  - `src/sidepanel/tabs/DraftingPanel.tsx`
  - `src/sidepanel/tabs/PreviewPanel.tsx`
  - `src/sidepanel/tabs/DraftDetailDialog.tsx`
  - `src/sidepanel/tabs/IssueCreateModal.tsx`
- **작업 내용**:
  1. `main.tsx`: `root.render()` 전에 `void resolveOsInfo()` 호출 추가
  2. `DraftingPanel.tsx` (line 366): `deriveReadonlyEnvRows({ os: getOsInfo(), browser: ..., ... })`
  3. `PreviewPanel.tsx`:
     - `handleCopyMarkdown()` (line 106): MarkdownContext에 `os: getOsInfo()` 추가
     - `NonElementEnvSection` (line 398): OS 행 추가 (Browser 위). `const os = getOsInfo();` → truthy면 div 렌더
     - `EnvParagraph` (line 438): `os` prop 추가, rows 배열 맨 앞에 삽입
  4. `DraftDetailDialog.tsx`:
     - `buildCtxForSubmit()` (line 232): `os: getOsInfo()` 추가
     - `EnvBlock` (line 755): OS 행 추가 (Browser 위)
  5. `IssueCreateModal.tsx` (line 121): `os: getOsInfo()` 추가
- **검증**:
  - [ ] `pnpm typecheck` — 타입 에러 없음
  - [ ] Chrome에서 side panel 열고 element 캡처 → 환경 섹션에 OS 행이 Browser 위에 표시되는지 확인
  - [ ] screenshot/video/freeform 모드에서도 동일하게 표시되는지 확인
  - [ ] 마크다운 복사 시 OS가 포함되는지 확인
  - [ ] 이슈 히스토리(DraftDetailDialog)에서 OS가 표시되는지 확인

## 테스트 계획

### 단위 테스트
- `osInfo.test.ts`: `formatOsInfo` 순수 함수 8+ 케이스
- `environmentRows.test.ts`: `deriveReadonlyEnvRows` os 관련 4케이스 추가
- `buildGithubIssueBody.test.ts`: os 환경 정보 3케이스 추가

### 수동 테스트 (Chrome)
- [ ] element 캡처 → DraftingPanel 환경 섹션에 OS → Browser → Page → DOM → Viewport → Captured 순서 확인
- [ ] screenshot 캡처 → PreviewPanel 환경 섹션에 OS 행 확인
- [ ] video 캡처 → PreviewPanel 환경 섹션에 OS 행 확인
- [ ] freeform → 환경 섹션에 OS 행 확인
- [ ] 마크다운 복사 → 클립보드에 `- **OS**: macOS ...` 포함 확인
- [ ] GitHub 이슈 제출 → 본문에 OS 행 포함 확인
- [ ] 이슈 히스토리에서 과거 이슈 열기 → OS 행 표시 확인

## 구현 순서 권장

```
Task 1 (osInfo 모듈 + 테스트)
  ↓
Task 2 (environmentRows os 필드 + 테스트)
  ↓
Task 3 (MarkdownContext + 5개 빌더 + 테스트)  ← Task 2와 병렬 가능
  ↓
Task 4 (main.tsx 초기화 + UI call site)        ← Task 1,2,3 완료 후
```

Task 2와 Task 3은 서로 독립적이라 병렬 진행 가능하나, 둘 다 Task 1의 `getOsInfo()`에 의존한다.
