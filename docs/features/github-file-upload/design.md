# GitHub 이슈 파일 첨부 — 기술 설계

## 개요

GitHub 웹 UI의 비공식 upload API를 활용해 파일을 업로드하고, 반환된 영구 URL을 이슈 본문에 마크다운 이미지/링크로 삽입한다. 이 API는 OAuth/PAT이 아닌 **브라우저 세션 쿠키**로 인증하므로, Chrome extension의 `chrome.cookies` API로 `github.com`의 `user_session` 쿠키를 읽어 사용한다. 세션 쿠키가 없으면 기존 방식(파일명 나열)으로 fallback.

## GitHub 비공식 Upload API 상세

GitHub 웹 UI가 drag-and-drop 시 내부적으로 사용하는 3단계 플로우:

### Step 1: Upload Policy 요청

```
POST https://github.com/upload/policies/assets
Content-Type: multipart/form-data
Cookie: user_session=...; __Host-user_session_same_site=...

Form fields:
  name: "screenshot.webp"
  size: 12345
  content_type: "image/webp"
  authenticity_token: "<CSRF token>"
  repository_id: 123456789
```

응답 (201):
```json
{
  "upload_url": "https://uploads.github.com/...",
  "header": { ... },
  "asset": {
    "id": 12345,
    "href": "https://github.com/user-attachments/assets/<uuid>"
  },
  "form": { "key": "...", ... },
  "asset_upload_url": "https://github.com/upload/assets/12345",
  "asset_upload_authenticity_token": "..."
}
```

### Step 2: S3 업로드

Step 1 응답의 `upload_url`로 파일 바이너리 + `form` 필드를 multipart POST.

### Step 3: 완료 확인

```
PUT https://github.com/upload/assets/12345
Content-Type: multipart/form-data
Cookie: user_session=...

Form fields:
  authenticity_token: "<asset_upload_authenticity_token from step 1>"
```

응답의 `asset.href`가 이슈 본문에 삽입할 영구 URL.

### 인증 요구사항

- `user_session` 쿠키 필수 (OAuth/PAT 불가 — 422 반환)
- CSRF token (`authenticity_token`): repo 페이지 HTML의 `<meta name="csrf-token" content="...">` 에서 추출
- `repository_id`: REST API `GET /repos/{owner}/{repo}` 응답의 `id` 필드 (이미 `GithubRepo.id`로 보유)

### 제약 사항

- **비공식 API**: GitHub이 언제든 변경 가능. 깨지면 자동으로 fallback(파일명 나열)으로 전환됨.
- **세션 쿠키 필요**: 사용자가 해당 Chrome 프로필에서 GitHub.com에 로그인되어 있어야 함.
- **파일 크기 제한**: 이미지 10MB, 비디오 10MB(무료)/100MB(유료), 기타 25MB.
- **WebP 지원 미확인**: 공식 문서에 WebP 미기재. 테스트 필요 — 미지원 시 후속 작업.

## 변경 범위

### 1. `manifest.config.ts` — 권한 추가
- 현재: `permissions`에 `cookies` 없음, `host_permissions`에 `api.github.com`만 있음
- 변경: `permissions`에 `"cookies"` 추가, `host_permissions`에 `"https://github.com/*"`, `"https://uploads.github.com/*"` 추가

### 2. `src/types/github.ts` — 업로드 관련 타입 추가
- 새 타입: `GithubUploadPolicyResponse`, `GithubUploadedAsset`, `GithubFileInput`

### 3. `src/types/messages.ts` — 메시지 타입 추가
- 새 메시지: `github.getRepoId`, `github.uploadFile`
- `github.submitIssue` 시그니처는 변경 없음 (body에 URL이 이미 삽입된 채로 전달)

### 4. `src/background/github-upload.ts` — 새 파일, 업로드 로직
- `getGithubSessionCookie()`: `chrome.cookies.get()` → `user_session` 쿠키
- `fetchCsrfToken(cookie, owner, repo)`: repo 페이지 HTML fetch → `<meta name="csrf-token">` 정규식 추출
- `requestUploadPolicy(...)`: Step 1 POST
- `uploadToStorage(...)`: Step 2 S3 POST
- `finalizeUpload(...)`: Step 3 PUT
- `uploadGithubFile(owner, repo, repoId, filename, contentType, blob)`: 3단계 통합 — 성공 시 `href` 반환, 실패 시 `null` 반환 (throw하지 않음)

세션 쿠키 / CSRF / S3 업로드는 기존 `githubFetch` 헬퍼와 완전히 다른 인증·헤더 체계를 사용하므로 별도 파일로 분리.

### 5. `src/background/messages.ts` — 핸들러 추가
- `github.getRepoId`: `loadGithubAuth()` → `githubFetch` → repo id 반환
- `github.uploadFile`: `loadGithubAuth()`로 owner/repo 확인 + `github-upload.ts`의 `uploadGithubFile` 호출

### 6. `src/sidepanel/lib/submitToGithub.ts` — 업로드 후 이슈 생성
- 현재: `buildGithubIssueBody` → `sendBg(github.submitIssue)`
- 변경: Linear 패턴과 동일하게 파일 먼저 업로드 → URL 확보 → `buildGithubIssueBody`에 URL 전달 → 이슈 생성
- `GithubSubmitInput`의 미디어 필드를 `GithubFileInput` (filename + dataUrl)으로 변경 (Blob → dataUrl, Linear과 동일 패턴)

### 7. `src/sidepanel/lib/buildGithubIssueBody.ts` — URL 기반 인라인 삽입
- `GithubMediaInput`에 optional `url?: string` 추가
- `url`이 있으면: 이미지는 `![name](url)`, 비디오는 `[🎬 name](url)`, 기타 파일은 `[📎 name](url)`
- `url`이 없으면: 기존 동작 (파일명 나열)
- 전체 파일에 URL이 없을 때만 "drag-drop 안내" 출력 (부분 업로드 시 안내 생략)

### 8. `src/sidepanel/tabs/IssueCreateModal.tsx` — handleGithubSubmit 수정
- 현재: `GithubMediaInput[]` (filename + Blob) 조립 → `submitToGithub()`
- 변경: `GithubFileInput[]` (filename + dataUrl) 조립 → `submitToGithub()` (Linear의 `handleLinearSubmit`과 동일 패턴)
- `buildAiMetaAttachment(ctx)` 호출 추가

### 9. `src/sidepanel/lib/buildAiMetaAttachment.ts` — 변경 없음
- 이미 `{ filename, dataUrl }` 반환. GitHub에서도 그대로 사용.

## 데이터 흐름

```
IssueCreateModal.handleGithubSubmit
  │
  ├─ media를 GithubFileInput[] (filename + dataUrl)로 조립
  ├─ buildAiMetaAttachment(ctx) → aiMeta
  │
  └─ submitToGithub(input)
       │
       ├─ sendBg(github.getRepoId, { owner, repo }) → repoId
       │
       ├─ 각 파일에 대해 sendBg(github.uploadFile, { owner, repo, repoId, filename, contentType, dataUrl })
       │   │
       │   └─ background/github-upload.ts:
       │       ├─ getGithubSessionCookie() → cookie (없으면 null 반환)
       │       ├─ fetchCsrfToken(cookie, owner, repo) → csrfToken
       │       ├─ requestUploadPolicy(cookie, csrfToken, repoId, filename, size, contentType) → policy
       │       ├─ uploadToStorage(policy.upload_url, policy.form, blob) → S3 응답
       │       └─ finalizeUpload(cookie, policy.asset_upload_url, policy.asset_upload_authenticity_token) → href
       │
       ├─ 결과를 GithubMediaInput[] { filename, blob, url? }로 변환
       │
       ├─ buildGithubIssueBody({ ctx, images, video, logs })
       │   └─ url이 있으면 인라인, 없으면 파일명 나열
       │
       └─ sendBg(github.submitIssue, { payload }) → 이슈 생성
```

## 인터페이스 설계

### 새 타입 (`src/types/github.ts`)

```typescript
export interface GithubUploadPolicyResponse {
  upload_url: string;
  header: Record<string, string>;
  asset: { id: number; href: string };
  form: Record<string, string>;
  asset_upload_url: string;
  asset_upload_authenticity_token: string;
}

export interface GithubUploadedAsset {
  id: number;
  href: string;
}
```

### 새 메시지 (`src/types/messages.ts`)

```typescript
| { type: "github.getRepoId"; owner: string; repo: string }
| { type: "github.uploadFile"; owner: string; repo: string; repoId: number; filename: string; contentType: string; dataUrl: string }
```

### `github.uploadFile` 응답

```typescript
{ href: string | null }
```

`href`가 `null`이면 업로드 실패 — 해당 파일은 fallback(파일명 나열).

### 변경되는 타입

```typescript
// buildGithubIssueBody.ts
export interface GithubMediaInput {
  filename: string;
  blob: Blob;
  url?: string;  // 업로드 성공 시 채워짐
}
```

### submitToGithub 입력

```typescript
// submitToGithub.ts
export interface GithubFileInput {
  filename: string;
  dataUrl: string;
}

export interface GithubSubmitInput {
  ctx: MarkdownContext;
  images?: GithubFileInput[];
  video?: GithubFileInput;
  logs?: GithubFileInput[];
  aiMeta?: GithubFileInput;   // buildAiMetaAttachment 결과
  owner: string;
  repo: string;
  label?: string;
  assignees?: string[];
}
```

## 기존 패턴 준수

- **메시지 비동기 응답 패턴**: `github.uploadFile` 핸들러는 `messages.ts`의 기존 switch-case에 추가. 응답은 `{ ok, result }` envelope.
- **에러 처리**: upload 실패는 throw하지 않고 `null` 반환 — 이슈 등록 자체는 항상 성공해야 함.
- **Linear 패턴 참조**: `submitToLinear.ts`의 병렬 업로드 + body 빌드 + 이슈 생성 패턴을 그대로 따름.
- **AI 메타 첨부**: `buildAiMetaAttachment(ctx)` 결과를 업로드 대상에 포함 (Jira·Linear·Notion과 동일).
- **i18n**: 새 에러 메시지는 `src/i18n/` 양쪽 로케일 동시 갱신.

## 대안 검토

### 대안 1: GitHub Gist API로 파일 호스팅

GitHub Gist API (`POST /gists`)는 공식 API이므로 PAT/OAuth로 호출 가능. 그러나:
- Gist는 텍스트 전용 — 바이너리(이미지/비디오)는 base64 인코딩해야 하고, raw URL이 바이너리로 서빙되지 않아 이미지 인라인 렌더 불가.
- public gist = 파일이 공개됨 (private repo의 스크린샷이 공개되는 보안 문제).

→ **채택하지 않음**. 인라인 렌더 불가 + 보안 문제.

### 대안 2: 외부 스토리지(Cloudflare R2) 경유

파일을 R2에 업로드하고 public URL을 이슈에 삽입. GitHub 마크다운이 외부 이미지 URL을 렌더하므로 기술적으로 가능.

→ **채택하지 않음**. 추가 인프라 비용·운영 부담. 스토리지 라이프사이클 관리 복잡.

### 대안 3: 이슈 등록 후 Comment로 이미지 삽입

이슈 본문 대신 comment에 이미지를 삽입. 하지만 GitHub Comments API도 공식 attachment upload가 없어 동일한 비공식 API 필요. 본문에 넣는 것이 더 나은 UX.

→ **채택하지 않음**. 동일한 기술적 제약 + 열등한 UX.

## 위험 요소

1. **비공식 API 변경 위험**: GitHub이 upload endpoint를 변경하면 업로드가 깨진다. 단, fallback이 있어 이슈 등록은 계속 동작. 깨진 것을 감지하는 수단은 HTTP 에러 코드 확인 + 주기적 수동 테스트.

2. **세션 쿠키 부재**: PAT이나 OAuth로 Bugshot에 연결했지만 Chrome 브라우저에서 GitHub.com에 로그인하지 않은 사용자는 업로드 불가. 이 경우 자동 fallback으로 기존 방식 동작.

3. **WebP 지원 미확인**: GitHub 공식 문서의 지원 파일 타입에 WebP 미기재. 실제 테스트 필요. 미지원 시 `image/png`로 변환하는 후속 작업 필요.

4. **권한 추가에 따른 웹스토어 심사**: `cookies` 권한과 `github.com` host_permissions 추가. 기존 사용자에게 권한 승인 프롬프트가 뜰 수 있고, 웹스토어 심사에서 추가 설명이 필요할 수 있다.

5. **MV3 서비스 워커에서 Cookie 헤더 설정**: `fetch()`의 `Cookie` 헤더는 Fetch 스펙상 forbidden header. Chrome extension의 host_permissions이 있으면 서비스 워커에서도 설정 가능한지 실제 테스트 필요. 불가능하면 `chrome.offscreen` API로 offscreen document에서 요청하거나 `declarativeNetRequest`로 우회해야 한다.

6. **Rate limit 미확인**: GitHub이 이 비공식 endpoint에 rate limit을 두는지 문서화되지 않음. 다수 파일 동시 업로드 시 throttle 가능성 — 필요 시 직렬 업로드로 전환.
