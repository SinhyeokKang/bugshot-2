# Browser 환경 정보 — 구현 태스크

## 선행 조건
- 없음. 추가 권한·의존성·환경 변수 불필요.

## 태스크

### Task 1: parseChromeVersion 유틸 + 테스트
- **변경 대상**: `src/sidepanel/lib/environmentRows.ts`, `src/sidepanel/lib/__tests__/environmentRows.test.ts`
- **작업 내용**:
  1. `parseChromeVersion(ua: string): string | null` 함수 추가 — 실패 시 `null` 반환
  2. 테스트 추가:
     - 일반 Chrome UA → `"Chrome 128.0.6613.85"`
     - 버전 없는 UA → `null`
     - 빈 문자열 `""` → `null`
     - Edge UA (`Edg/` 포함, Chrome 토큰도 존재) → Chrome 버전 정상 추출
     - HeadlessChrome UA → `null` (일반 사용자 환경 아님)
- **검증**:
  - [ ] `pnpm test` — parseChromeVersion 테스트 통과

### Task 2: ReadonlyEnvInput + deriveReadonlyEnvRows 확장
- **변경 대상**: `src/sidepanel/lib/environmentRows.ts`, `src/sidepanel/lib/__tests__/environmentRows.test.ts`
- **작업 내용**:
  1. `ReadonlyEnvInput`에 `browser?: string | null` 추가
  2. `deriveReadonlyEnvRows` 시작부에 browser가 truthy면 Browser 행 삽입, `null`이면 생략
  3. 테스트 추가/수정:
     - browser 전달 시 첫 행이 Browser
     - browser `null` 전달 시 Browser 행 없음
     - browser 미전달 시 기존 동작 유지 (하위호환)
- **검증**:
  - [ ] `pnpm test` — 전체 통과
  - [ ] `pnpm typecheck` — 타입 오류 없음

### Task 3: UI 호출부 연결 (DraftingPanel + PreviewPanel + DraftDetailDialog)
- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`, `src/sidepanel/tabs/PreviewPanel.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**:
  1. `DraftingPanel`: `deriveReadonlyEnvRows` 호출에 `browser: parseChromeVersion(navigator.userAgent)` 추가
  2. `PreviewPanel`: `EnvParagraph`(line 424)·`NonElementEnvSection`(line 371)에 browser 행 추가
  3. `DraftDetailDialog`: `EnvBlock`(line 753)에 browser 행 추가
- **검증**:
  - [ ] `pnpm typecheck` — 타입 오류 없음
  - [ ] `pnpm test` — 전체 통과
  - [ ] 수동: 확장 로드 → 요소 선택 → 이슈 작성 화면에서 Browser 행이 첫 번째에 표시
  - [ ] 수동: PreviewPanel에서 Browser 행 표시 확인
  - [ ] 수동: 과거 이슈 상세 다이얼로그에서 Browser 행 표시 확인

### Task 4: MarkdownContext + 빌더 5개 + ctx 생성부 수정
- **변경 대상**:
  - `src/sidepanel/lib/buildIssueMarkdown.ts` (MarkdownContext 타입 + buildIssueMarkdown + buildIssueHtml)
  - `src/sidepanel/lib/buildGithubIssueBody.ts`
  - `src/sidepanel/lib/buildLinearIssueBody.ts`
  - `src/sidepanel/lib/buildIssueAdf.ts`
  - `src/sidepanel/lib/buildNotionIssueBody.ts`
  - `src/sidepanel/tabs/PreviewPanel.tsx` (handleCopyMarkdown ctx 생성부)
  - `src/sidepanel/tabs/DraftDetailDialog.tsx` (buildCtxForSubmit ctx 생성부)
  - `src/sidepanel/tabs/IssueCreateModal.tsx` (buildCtx ctx 생성부)
- **작업 내용**:
  1. `MarkdownContext`에 `browser?: string | null` 추가
  2. 5개 빌더의 환경 섹션에서 `ctx.browser`가 truthy면 Page 행 위에 Browser 행 출력
  3. ctx 생성부 3곳에 `browser: parseChromeVersion(navigator.userAgent)` 추가
  4. 빌더 테스트에 browser 포함/미포함 케이스 추가
- **검증**:
  - [ ] `pnpm test` — 전체 통과
  - [ ] `pnpm typecheck` — 타입 오류 없음
  - [ ] 수동: GitHub/Jira/Linear/Notion 중 하나로 이슈 등록 후 본문에 Browser 정보 포함 확인

## 테스트 계획
- **단위 테스트**: `parseChromeVersion` (파싱 + 엣지 케이스), `deriveReadonlyEnvRows` (browser 행 포함/미포함/null), 빌더별 browser 출력
- **수동 테스트**:
  - [ ] element 모드: Browser → Page → DOM → Viewport → Captured 순서 확인
  - [ ] screenshot 모드: Browser → Page → Viewport → Captured 순서 확인
  - [ ] video 모드: Browser → Page → Viewport → Captured 순서 확인
  - [ ] freeform 모드: Browser → Page 순서 확인
  - [ ] PreviewPanel: 각 모드에서 Browser 행 표시 확인
  - [ ] DraftDetailDialog: 과거 이슈에서 Browser 행 표시 확인
  - [ ] 마크다운 복사 후 붙여넣기 시 Browser 정보 포함 확인
  - [ ] GitHub/Jira/Linear/Notion 중 하나로 이슈 등록 후 본문에 Browser 정보 포함 확인

## 구현 순서 권장
Task 1 → Task 2 → Task 3 → Task 4 (순차. 각 단계가 이전 단계에 의존)
