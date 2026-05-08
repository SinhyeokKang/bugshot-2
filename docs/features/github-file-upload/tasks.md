# GitHub 이슈 파일 첨부 — 구현 태스크

## 선행 조건

1. **WebP 지원 테스트**: 수동으로 GitHub 이슈에 .webp 파일을 drag-and-drop해서 업로드 및 인라인 렌더 가능 여부 확인. 불가 시 PNG 변환 로직 추가 필요 (별도 태스크).
2. **MV3 서비스 워커 Cookie 헤더 테스트**: `chrome.cookies.get()`으로 읽은 쿠키를 `fetch()`의 `Cookie` 헤더에 설정 가능한지 host_permissions 환경에서 확인. 불가 시 offscreen document 우회 설계 필요.

## 태스크

### Task 1: manifest 권한 추가

- **변경 대상**: `manifest.config.ts`
- **작업 내용**:
  - `permissions` 배열에 `"cookies"` 추가
  - `host_permissions` 배열에 `"https://github.com/*"`, `"https://uploads.github.com/*"` 추가
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 빌드 후 `manifest.json`에 `cookies` 권한과 새 host_permissions 포함 확인
  - [ ] Chrome에서 확장 로드 시 새 권한 경고 확인

### Task 2: 타입 정의

- **변경 대상**: `src/types/github.ts`, `src/types/messages.ts`
- **작업 내용**:
  - `github.ts`에 추가:
    ```typescript
    export interface GithubUploadPolicyResponse {
      upload_url: string;
      header: Record<string, string>;
      asset: { id: number; href: string };
      form: Record<string, string>;
      asset_upload_url: string;
      asset_upload_authenticity_token: string;
    }
    ```
  - `messages.ts`의 `BgRequest` union에 추가:
    ```typescript
    | { type: "github.getRepoId"; owner: string; repo: string }
    | { type: "github.uploadFile"; owner: string; repo: string; repoId: number; filename: string; contentType: string; dataUrl: string }
    ```
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `BgRequest` union의 exhaustive switch에서 새 타입 누락 없음

### Task 3: 업로드 모듈 구현 (`github-upload.ts`)

- **변경 대상**: `src/background/github-upload.ts` (신규)
- **작업 내용**:
  - `getGithubSessionCookie(): Promise<string | null>` — `chrome.cookies.get({ url: "https://github.com", name: "user_session" })`
  - `fetchCsrfToken(cookie: string, owner: string, repo: string): Promise<string>` — `fetch("https://github.com/{owner}/{repo}")` + 정규식 `<meta name="csrf-token" content="([^"]+)"` 추출
  - `requestUploadPolicy(cookie: string, csrfToken: string, repoId: number, filename: string, size: number, contentType: string): Promise<GithubUploadPolicyResponse>` — `POST /upload/policies/assets` multipart/form-data
  - `uploadToStorage(uploadUrl: string, formFields: Record<string, string>, headers: Record<string, string>, blob: Blob): Promise<void>` — S3 presigned POST
  - `finalizeUpload(cookie: string, assetUploadUrl: string, assetUploadAuthenticityToken: string): Promise<void>` — `PUT /upload/assets/{id}`
  - `uploadGithubFile(owner: string, repo: string, repoId: number, filename: string, contentType: string, blob: Blob): Promise<string | null>` — 3단계 통합. 실패 시 `null` 반환 (throw 안 함)
- **검증**:
  - [ ] 순수 헬퍼 함수(`buildFormData`, `extractCsrfToken` 등)에 대한 단위 테스트
  - [ ] `pnpm typecheck` 통과
  - [ ] GitHub.com 로그인 상태에서 수동 테스트: 실제 파일 업로드 성공 + href URL 접근 가능
  - [ ] GitHub.com 미로그인 시 `getGithubSessionCookie()` → `null` 반환 확인

### Task 4: 메시지 핸들러 추가

- **변경 대상**: `src/background/messages.ts`
- **작업 내용**:
  - `github.getRepoId` 핸들러: `loadGithubAuth()` → `githubFetch<{ id: number }>(auth, /repos/{owner}/{repo})` → `{ id: result.id }`
  - `github.uploadFile` 핸들러: `dataUrlToBlob(dataUrl)` → `uploadGithubFile(owner, repo, repoId, filename, contentType, blob)` → `{ href: string | null }`
  - `github-upload.ts` import 추가
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] BgRequest switch의 exhaustive check 통과

### Task 5: `buildGithubIssueBody` URL 인라인 지원

- **변경 대상**: `src/sidepanel/lib/buildGithubIssueBody.ts`
- **작업 내용**:
  - `GithubMediaInput` 타입에 `url?: string` 추가
  - `emitMedia()` 내부 로직 변경:
    - `url`이 있는 파일: 이미지(`image/`)는 `![name](url)`, 비디오(`video/`)는 비디오 링크, 기타는 파일 링크로 본문에 인라인
    - `url`이 없는 파일: 기존대로 파일명 나열
    - 인라인된 파일과 나열된 파일을 분리 출력
    - 모든 파일이 인라인되면 "drag-drop 안내" 텍스트 생략
  - 파일 상단 주석 갱신 (현재 "실제 첨부는 사용자가 drag&drop" → 업로드 가능 시 인라인 설명 추가)
- **검증**:
  - [ ] 단위 테스트: URL 있는 입력 → 마크다운 이미지/링크 삽입 확인
  - [ ] 단위 테스트: URL 없는 입력 → 기존 파일명 나열 확인
  - [ ] 단위 테스트: 혼합(일부 URL 있고 없고) → 인라인 + 나열 혼합 확인
  - [ ] 단위 테스트: 모든 파일 URL 있으면 drag-drop 안내 없음 확인
  - [ ] `pnpm test` 통과

### Task 6: `submitToGithub` 업로드 플로우 통합

- **변경 대상**: `src/sidepanel/lib/submitToGithub.ts`
- **작업 내용**:
  - `GithubFileInput` 타입 추가: `{ filename: string; dataUrl: string }`
  - `GithubSubmitInput`의 미디어 필드를 `GithubFileInput`으로 변경
  - `guessMime()` 헬퍼 추가 (Linear의 것과 동일 로직)
  - 플로우 변경:
    1. `sendBg(github.getRepoId)` → repoId 확보
    2. 모든 파일(images + video + logs + aiMeta)에 대해 `sendBg(github.uploadFile)` 병렬 호출
    3. 결과에서 `href`를 `GithubMediaInput.url`로 매핑 (null이면 url 미설정)
    4. `dataUrlToBlob`으로 blob 변환 → `GithubMediaInput` 조립
    5. `buildGithubIssueBody()`에 전달
    6. `sendBg(github.submitIssue)` 호출
  - `buildAiMetaAttachment`는 이 파일에서 호출 (Linear 패턴: submit 함수 안에서 AI 메타 조립)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동 테스트: GitHub.com 로그인 → 이슈 생성 → 이미지 인라인 렌더 확인
  - [ ] 수동 테스트: GitHub.com 미로그인 → fallback 동작 확인
  - [ ] 수동 테스트: 3가지 캡처 모드(element/screenshot/video) 모두 확인

### Task 7: `IssueCreateModal` handleGithubSubmit 수정

- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`
- **작업 내용**:
  - `handleGithubSubmit`에서 `GithubMediaInput[]` (Blob) 대신 `GithubFileInput[]` (dataUrl) 조립
  - 기존: `dataUrlToBlob(image)` → `{ filename, blob }`
  - 변경: `{ filename, dataUrl: image }` (이미지는 이미 dataUrl), 비디오는 `blobToDataUrl(videoBlob)` 변환
  - `buildAiMetaAttachment(ctx)` 호출 제거 — `submitToGithub` 내부에서 처리
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 Jira·Linear·Notion 제출 동작에 영향 없음 확인

### Task 8: i18n 메시지 추가

- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**:
  - 기존 `github.attachmentNotInline` 메시지 유지 (fallback 시 사용)
  - 필요 시 업로드 관련 에러 메시지 추가 (현재 설계에서는 upload 실패가 사용자에게 노출되지 않으므로 최소한만)
- **검증**:
  - [ ] ko/en 양쪽 키 일치 확인
  - [ ] `pnpm typecheck` 통과

## 테스트 계획

### 단위 테스트

- `buildGithubIssueBody.ts`:
  - URL 있는 이미지 → `![filename](url)` 포함
  - URL 있는 비디오 → 비디오 링크 포함
  - URL 있는 로그 → 파일 링크 포함
  - URL 없는 파일 → 기존 파일명 나열
  - 혼합 → 인라인 + 나열 공존
  - 전체 URL 있으면 drag-drop 안내 없음
  - 미디어 없으면 attachments 섹션 없음 (기존 동작 유지)
- `github-upload.ts`:
  - `extractCsrfToken(html)`: 정규식 추출 테스트 — 정상 HTML / meta 태그 없는 HTML / 빈 값
  - `guessMime(filename)`: .webp → image/webp, .webm → video/webm 등

### 수동 테스트 (Chrome 확장 로드)

- [ ] GitHub.com 로그인 + element 모드 → before/after 이미지 인라인 + bugshot.md 링크
- [ ] GitHub.com 로그인 + screenshot 모드 → 스크린샷 이미지 인라인
- [ ] GitHub.com 로그인 + video 모드 → 비디오 인라인 + 로그 링크 + bugshot.md 링크
- [ ] GitHub.com 미로그인 → 기존 동작 (파일명 나열 + drag-drop 안내)
- [ ] private repo에서 업로드 → 이미지 URL이 인증 없이 접근 불가한지 확인
- [ ] 대용량 파일 업로드 → 10MB 제한 초과 시 실패 + fallback 확인
- [ ] Jira/Linear/Notion 제출 → 기존 동작 변화 없음

## 구현 순서 권장

```
Task 1 (manifest) ─┐
Task 2 (타입)     ─┼─ 병렬 가능
Task 8 (i18n)     ─┘
        │
        ▼
Task 3 (github-upload.ts) ──── Task 5 (buildGithubIssueBody) ← 병렬 가능
        │                              │
        ▼                              │
Task 4 (messages.ts)                   │
        │                              │
        ▼                              ▼
Task 6 (submitToGithub.ts) ← 3, 4, 5 의존
        │
        ▼
Task 7 (IssueCreateModal.tsx) ← 6 의존
```

선행 조건(WebP 테스트, Cookie 헤더 테스트)은 Task 3 시작 전에 수동으로 확인해야 한다.
