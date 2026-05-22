# Browser 환경 정보 — 구현 태스크

## 선행 조건
- 없음. 추가 권한·의존성·환경 변수 불필요.

## 태스크

### Task 1: parseChromeVersion 유틸 + 테스트
- **변경 대상**: `src/sidepanel/lib/environmentRows.ts`, `src/sidepanel/lib/__tests__/environmentRows.test.ts`
- **작업 내용**:
  1. `parseChromeVersion(ua: string): string` 함수 추가
  2. 테스트 추가:
     - 일반 Chrome UA → `"Chrome 128.0.6613.85"`
     - 버전 없는 UA → `"Unknown"`
- **검증**:
  - [ ] `pnpm test` — parseChromeVersion 테스트 통과

### Task 2: ReadonlyEnvInput + deriveReadonlyEnvRows 확장
- **변경 대상**: `src/sidepanel/lib/environmentRows.ts`, `src/sidepanel/lib/__tests__/environmentRows.test.ts`
- **작업 내용**:
  1. `ReadonlyEnvInput`에 `browser?: string | null` 추가
  2. `deriveReadonlyEnvRows` 시작부에 browser 행 삽입 로직 추가
  3. 테스트 추가/수정:
     - browser 전달 시 첫 행이 Browser
     - browser 미전달 시 기존 동작 유지 (하위호환)
- **검증**:
  - [ ] `pnpm test` — 전체 통과
  - [ ] `pnpm typecheck` — 타입 오류 없음

### Task 3: DraftingPanel 호출부 연결
- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx` (line 365 부근)
- **작업 내용**: `deriveReadonlyEnvRows` 호출에 `browser: parseChromeVersion(navigator.userAgent)` 추가
- **검증**:
  - [ ] `pnpm typecheck` — 타입 오류 없음
  - [ ] 수동: 확장 로드 → 요소 선택 → 이슈 작성 화면에서 Browser 행이 첫 번째에 표시

## 테스트 계획
- **단위 테스트**: `parseChromeVersion` (파싱), `deriveReadonlyEnvRows` (browser 행 포함/미포함)
- **수동 테스트**:
  - [ ] element 모드: Browser → Page → DOM → Viewport → Captured 순서 확인
  - [ ] screenshot 모드: Browser → Page → Viewport → Captured 순서 확인
  - [ ] freeform 모드: Browser → Page 순서 확인
  - [ ] GitHub/Jira/Linear/Notion 중 하나로 이슈 등록 후 본문에 Browser 정보 포함 확인

## 구현 순서 권장
Task 1 → Task 2 → Task 3 (순차. 각 단계가 이전 단계에 의존)
