# 이슈 파일 첨부 — 기술 설계

## 개요

사용자 첨부 파일은 임의 크기·임의 MIME이므로 캡처 이미지(dataURL)처럼 `chrome.storage.session`에 못 담는다(quota). 따라서 **로그의 `pending:${tabId}` 패턴을 그대로 차용**한다: 파일 선택 즉시 IndexedDB의 새 `attachments` object store에 Blob을 영속하고, 세션/IssueRecord에는 **메타(id·파일명·MIME·크기)만** 둔다. drafting 중엔 `pending:${tabId}` 네임스페이스, `confirmDraft` 시 `issueId`로 rekey(로그와 동일). 제출 시 각 플랫폼 핸들러가 메타를 보고 IndexedDB에서 Blob을 로드→dataURL 변환해 기존 업로드 배열(`captureFiles`)에 합류시킨다. 본문 인라인은 하지 않고, 플랫폼별로 네이티브 첨부 영역 또는 본문 하단 링크 섹션에만 노출한다. 본문 설정의 독립 boolean `attachmentsEnabled`(기본 false, `replayEnabled` 패턴)로 기능을 게이팅한다.

## 변경 범위

### 신규 파일

- **`src/types/attachment.ts`** — 첨부 메타 타입.
  ```typescript
  export interface UserAttachmentMeta {
    id: string;          // 짧은 uuid (파일별 고유)
    filename: string;    // 원본 파일명
    contentType: string; // file.type (빈 문자열이면 "application/octet-stream")
    size: number;        // bytes
  }
  ```

- **`src/sidepanel/lib/attachmentLimits.ts`** — 플랫폼 한도 + 검증 순수 함수.
  ```typescript
  export const MAX_ATTACHMENT_COUNT = 10;
  // 플랫폼별 파일 단건 한도(bytes). 0/undefined = 코드상 명시 한도 없음(경고 안 함).
  export const PLATFORM_FILE_SIZE_LIMIT: Record<PlatformId, number | null>;
  export interface AttachmentLimitWarning {
    overCount: boolean;                 // 개수 상한 초과
    oversizeIds: string[];              // 플랫폼 한도 초과 파일 id
  }
  export function checkAttachmentLimits(
    attachments: UserAttachmentMeta[],
    platform: PlatformId,
  ): AttachmentLimitWarning;
  // 다중 선택 시 상한까지만 받기 위한 헬퍼
  export function takeWithinCount(
    existing: number, incoming: number,
  ): { accept: number; dropped: number };
  ```

- **`src/sidepanel/components/AttachmentSection.tsx`** — drafting 첨부 UI. 구성:
  - **업로드 버튼**: 기존 DraftingPanel 표준인 `Button variant="outline"`(캡처 버튼들과 동형, 예: `DraftingPanel.tsx:476/612`). 라벨에 **카운터 내장** — `파일 첨부 (n/10)`. `n === MAX_ATTACHMENT_COUNT`면 `disabled`. 카운터+비활성으로 상한을 직관 표현하므로 별도 안내 문구 불필요.
  - **숨김** `<input type="file" multiple>` — 버튼 클릭 시 트리거.
  - **파일 리스트**: shadcn에 파일 전용 컴포넌트 없음 → **shadcn `item` 컴포넌트 설치**(`npx shadcn@latest add item`, `src/components/ui/item.tsx` 위치 확인)해서 사용. 항목 1개 = `Item`:
    - `ItemMedia` — MIME 기반 형식 아이콘(`fileIcon` 헬퍼)
    - `ItemContent` — `ItemTitle`(파일명) + `ItemDescription`(MIME · 크기, `formatBytes`)
    - `ItemActions` — 삭제 버튼(`Button size="icon" variant="ghost"` + lucide `Trash2`)
  - **한도 경고**: 타깃 플랫폼 한도 초과 파일(`checkAttachmentLimits.oversizeIds`)에 해당 Item에 경고 색/배지 + 제출 영역 경고 문구.

- **`src/sidepanel/lib/fileMeta.ts`**(신규) — 순수 헬퍼. `fileCategory(contentType, filename): FileCategory`(`"image"|"video"|"audio"|"pdf"|"archive"|"text"|"file"`)와 `formatBytes(n: number): string`. 아이콘 컴포넌트 매핑은 AttachmentSection에서 카테고리→lucide(`FileImage`/`FileVideo`/`FileAudio`/`FileText`/`FileArchive`/`File`)로(테스트 가능하도록 카테고리 판정만 순수 함수로 분리).

- 테스트: `src/sidepanel/lib/__tests__/attachmentLimits.test.ts`, `src/sidepanel/lib/__tests__/fileMeta.test.ts`(카테고리 판정·바이트 포맷), `buildCaptureFiles` 첨부 분기 테스트.

### 변경 파일

- **`src/store/blob-db.ts`** — `DB_VERSION` 6→7. `STORE_ATTACHMENTS = "attachments"` object store 추가(`onupgradeneeded`). 키 형식 `${owner}:${id}`(owner = `pending:${tabId}` 또는 issueId). 함수 추가(기존 image/log 함수 패턴 동일):
  - `saveAttachmentBlob(owner: string, id: string, blob: Blob): Promise<boolean>`
  - `getAttachmentBlob(owner: string, id: string): Promise<Blob | null>`
  - `deleteAttachmentBlobs(owner: string): Promise<void>` — prefix `${owner}:` 스캔 삭제
  - `getAttachmentBlobKeys(): Promise<string[]>` — orphan prune용
  - `rekeyAttachmentBlobs(fromOwner: string, toOwner: string, ids: string[]): Promise<boolean>` — `pending → issueId` 이동(로그의 save+delete 패턴을 복수 키로 일반화)

- **`src/store/settings-ui-store.ts`** — `attachmentsEnabled: boolean`(기본 false) + `setAttachmentsEnabled(on: boolean)` 추가. `persist` 버전 5→6, `migrate`에서 누락 시 false 주입. `replayEnabled`와 동형.

- **`src/store/editor-store.ts`**:
  - `EditorState`에 `attachments: UserAttachmentMeta[]` 추가(기본 `[]`).
  - 액션 `addAttachments(files: File[]): Promise<void>` — 상한 내에서 받아 각 파일을 `saveAttachmentBlob('pending:'+tabId, id, file)` 저장 후 메타 push. `removeAttachment(id: string): void` — 메타 제거 + `deleteAttachmentBlobs` 단건(또는 단건 delete 헬퍼). `clearAttachments(tabId)` — 폐기 시.
  - `EditorSnapshot`(Pick)에 `attachments` 추가(메타만이라 직렬화 안전).
  - `confirmDraft()`: `id` 확정 후 `rekeyAttachmentBlobs('pending:'+tabId, id, attachments.map(a=>a.id))` 호출(로그 `persistAttachedLogs`와 같은 블록, **모든 captureMode 공통**). IssueRecord에 `attachments` 메타 저장.
  - `reset()`/draft 폐기 경로: `deleteAttachmentBlobs('pending:'+tabId)`.

- **`src/sidepanel/hooks/useEditorSessionSync.ts`** — `snapshotFromState()`에 `attachments` 포함. hydrate 시 메타는 스냅샷에서 복원되고 Blob은 IndexedDB에 `pending:${tabId}`로 살아있으므로 별도 로드 불필요(제출 시점에만 Blob 읽음). 로그처럼 "복원 시 존재 확인"은 선택 — 메타와 Blob 정합이 깨질 일은 prune 외엔 없으므로 생략.

- **`src/store/issues-store.ts`**:
  - `IssueRecord`에 `attachments?: UserAttachmentMeta[]` 추가.
  - `markSubmitted`/`removeIssue`에서 `deleteAttachmentBlobs(id)` 호출.
  - `stripSubmitted`에서 `attachments: undefined`.
  - `pruneOrphanBlobs()`에 attachment 정리 추가: `getAttachmentBlobKeys()`의 `${issueId}:${id}` 키에서 issueId 추출, 현존 issue 아니고 `pending:` 아니면 `deleteAttachmentBlobs(issueId)`.

- **`src/sidepanel/lib/buildCaptureFiles.ts`** — `CaptureFiles`에 `attachments: CaptureFile[]` 추가. `BuildCaptureFilesInput`에 `userAttachments?: { meta: UserAttachmentMeta; blob: Blob }[]` 추가. 각 blob을 `blobToDataUrl`로 변환해 `result.attachments`에 `{ filename: meta.filename, dataUrl }` push. **파일명 충돌 방지**: 업로드 식별용으로 `${meta.id}__${meta.filename}` 같은 고유 filename을 쓰되, 본문/네이티브 첨부에 보이는 표시명은 원본 유지(플랫폼별 처리에서 분리). → 단순화를 위해 `CaptureFile`에 옵셔널 `displayName?`를 추가하거나, attachments 항목은 filename을 고유화하고 표시는 그대로 두는 방식 중 **고유 filename + 원본 displayName**을 택한다.

- **`src/sidepanel/tabs/DraftingPanel.tsx`** — `attachmentsEnabled`가 true일 때 `<AttachmentSection>` 렌더(미디어/로그 카드 영역 인접). editor-store의 `attachments`·액션 연결.

- **`src/sidepanel/tabs/SettingsTab.tsx`** — 본문 구성(`bodyComposition`) 섹션에 "파일 첨부" 토글 row 추가. `IssueSectionRow`와 같은 시각 형태지만 `issueSections` 배열이 아닌 `attachmentsEnabled` boolean에 바인딩. help 문구에 "권장하지 않음 — 캡처·로그를 우선" 뉘앙스. `id="setting-attachments-enabled"`(e2e용).

- **`src/sidepanel/tabs/IssueCreateModal.tsx`**:
  - `buildEditorCaptureFiles(ctx)`(현 251-282)에서 `attachmentsEnabled && attachments.length`면 각 메타의 Blob을 `getAttachmentBlob(issueId, id)`로 로드해 `buildCaptureFiles`의 `userAttachments`로 전달. (issueId는 `confirmDraft`에서 확정된 `currentIssueId`.)
  - 각 `handle*Submit`에서 `captureFiles.attachments`를 업로드 배열에 합류(아래 플랫폼별 표).

- **플랫폼 submit·본문 빌더** (플랫폼별 표 참조):
  - `src/sidepanel/lib/submitToGithub.ts`, `submitToGitlab.ts`, `submitToLinear.ts`, `submitToNotion.ts`, `submitToAsana.ts`
  - `src/sidepanel/lib/buildGithubIssueBody.ts`, `buildGitlabIssueBody.ts`, `buildLinearIssueBody.ts`, `buildNotionIssueBody.ts`
  - Jira는 `IssueCreateModal.handleJiraSubmit`의 `rawAttachments`에 합류(messages `jira.submitIssue`가 자동으로 issue attachment 등록 — 본문 placeholder 불필요).

- **`src/i18n/ko.ts`·`en.ts`** — 토글 라벨/help, 버튼, 리스트, 경고 문구 키 동시 추가.

## 데이터 흐름

```
[파일 선택]
  AttachmentSection → editor.addAttachments(File[])
    → takeWithinCount로 상한 컷
    → 각 File: saveAttachmentBlob("pending:"+tabId, id, file)  [IndexedDB]
    → attachments 메타 push (editor-store state)
      ↳ useEditorSessionSync: 메타만 chrome.storage.session 저장 (Blob 제외)

[draft 확정] editor.confirmDraft()
    → id = currentIssueId ?? newIssueId()
    → rekeyAttachmentBlobs("pending:"+tabId, id, ids)  [IndexedDB pending→issueId]
    → IssueRecord.attachments = 메타  (issues-store.saveDraft)

[제출] IssueCreateModal.handle*Submit
    → buildEditorCaptureFiles: getAttachmentBlob(issueId, id) → buildCaptureFiles
        → CaptureFiles.attachments: [{ filename(고유), displayName(원본), dataUrl }]
    → 플랫폼별 업로드 배열 합류 → sendBg(...uploadFiles/submitIssue)
    → (GitHub/GitLab/Linear) 업로드 URL을 본문 하단 "Attachments" 링크로
      (Jira/Asana/Notion) 네이티브 첨부 영역/파일 블록

[제출 완료/폐기] markSubmitted/removeIssue
    → deleteAttachmentBlobs(issueId)  [IndexedDB 정리]
[orphan] pruneOrphanBlobs → 미존재 issueId의 attachment 키 삭제
```

## 플랫폼별 첨부 노출 처리

| 플랫폼 | 합류 지점 | 노출 방식 | 비고 |
|---|---|---|---|
| **Jira** | `IssueCreateModal.handleJiraSubmit` `rawAttachments`에 push | 이슈 attachment 영역(업로드 시 자동 등록) | 본문 ADF placeholder 불필요. `annotateAttachmentDimensions`는 이미지 외엔 dimension 없음 → 그대로 통과 |
| **GitHub** | `submitToGithub` `allFiles`에 push | 본문 하단 `## Attachments` 링크 목록 `- [displayName](href)` | `buildGithubIssueBody`에 `attachments: {filename, displayName, url}[]` 파라미터 추가 |
| **GitLab** | `submitToGitlab` `allFiles`에 push | 본문 하단 `## Attachments` 링크 목록 | `buildGitlabIssueBody` 동일 확장. logs.html 역링크 재업로드 흐름과 무관 |
| **Linear** | `submitToLinear` 업로드 promise에 추가 | 본문 하단 `## Attachments` 링크 목록(assetUrl) | `buildLinearIssueBody`에 attachments 파라미터 추가 |
| **Notion** | `submitToNotion` → `buildNotionIssueBody` attachments(category `"other"`) | 페이지 하단 file block | 기존 logs 첨부와 동일 경로. 5MiB 한도 경고 대상 |
| **Asana** | `submitToAsana` `allFiles`에 push | task attachment 영역 | **webpToJpeg 변환 금지**(임의 파일) — 캡처 이미지만 변환하는 기존 로직과 분리. `imageRefs` 인라인 안 함 |

> "인라인 미리보기 없음" 원칙: GitHub/GitLab/Linear는 `![](url)` 임베드가 아니라 `[name](url)` 링크. Jira/Asana/Notion은 네이티브 첨부라 본문 손 안 댐.

## 인터페이스 설계

```typescript
// src/types/attachment.ts
export interface UserAttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

// src/store/blob-db.ts (추가)
export function saveAttachmentBlob(owner: string, id: string, blob: Blob): Promise<boolean>;
export function getAttachmentBlob(owner: string, id: string): Promise<Blob | null>;
export function deleteAttachmentBlob(owner: string, id: string): Promise<void>;
export function deleteAttachmentBlobs(owner: string): Promise<void>;
export function getAttachmentBlobKeys(): Promise<string[]>;
export function rekeyAttachmentBlobs(fromOwner: string, toOwner: string, ids: string[]): Promise<boolean>;

// src/store/settings-ui-store.ts (추가)
attachmentsEnabled: boolean;                       // 기본 false
setAttachmentsEnabled: (on: boolean) => void;

// src/store/editor-store.ts (추가)
attachments: UserAttachmentMeta[];                 // 기본 []
addAttachments: (files: File[]) => Promise<void>;
removeAttachment: (id: string) => void;

// src/sidepanel/lib/fileMeta.ts (신규)
export type FileCategory = "image" | "video" | "audio" | "pdf" | "archive" | "text" | "file";
export function fileCategory(contentType: string, filename: string): FileCategory;
export function formatBytes(n: number): string;

// src/sidepanel/lib/buildCaptureFiles.ts (변경)
export interface CaptureFile { filename: string; dataUrl: string; displayName?: string; }
export interface CaptureFiles { video?: CaptureFile; images: CaptureFile[]; logs: CaptureFile[]; attachments: CaptureFile[]; }
export interface BuildCaptureFilesInput {
  /* ...기존... */
  userAttachments?: { meta: UserAttachmentMeta; blob: Blob }[];
}

// src/store/issues-store.ts (변경)
export interface IssueRecord { /* ... */ attachments?: UserAttachmentMeta[]; }
```

## 기존 패턴 준수

- **세션 영속화 비대칭**: Blob은 session 직렬화 제외, 메타만. videoBlob 제외 / 캡처 dataURL 포함 정책과 동선 일치. 첨부는 "메타는 session, Blob은 IndexedDB"로 로그(`networkLogBlobKey` + `pending:` rekey) 패턴을 따른다.
- **pending → issueId rekey**: 로그 `persistAttachedLogs`와 같은 위치/타이밍(`confirmDraft`).
- **orphan prune**: `pruneOrphanBlobs`에 동일 패턴 추가(image 키 issueId 추출 로직 복제).
- **부분 실패 흡수**: 업로드 실패는 기존 캡처 파일과 동일한 플랫폼별 try-catch/부분성공 경로로 흡수. 첨부 전용 에러 UI 신설 안 함.
- **i18n 동시 갱신**: ko/en 키 대칭(PostToolUse 훅 검사 통과).
- **shadcn 우선**: 업로드 버튼은 기존 `Button variant="outline"` 재사용, 삭제는 ghost icon 버튼. 파일 리스트는 신규로 shadcn `item` 설치(`src/components/ui/item.tsx` 위치 확인 — shadcn이 `@/` 루트에 생성할 수 있음). 직접 스타일링 금지.
- **테스트 우선**: `attachmentLimits.ts`·`buildCaptureFiles` 첨부 분기 단위 테스트를 구현 전 작성(`/tdd interface`).

## 대안 검토

1. **메모리-only(비디오 방식)**: 첨부를 `File[]`로 메모리에만 들고 session/IndexedDB 영속 생략, `confirmDraft`에서만 IndexedDB 저장.
   - 기각: 사이드패널 재오픈/탭 전환 시 사용자가 직접 고른 파일이 유실된다. 비디오는 재녹화 비용이 낮지만 "사용자가 디스크에서 찾아 고른 파일"의 재선택 비용은 높다. PRD의 영속 보장과 충돌.
2. **`issueSections` 배열에 `attachments` 항목 추가**: 본문 섹션 토글과 한 배열로 관리.
   - 기각: `issueSections`는 텍스트 섹션(renderAs paragraph/orderedList, `draft.sections` 텍스트 보유) 전용. 본문 빌드 루프(`buildIssueAdf`/`buildGithubIssueBody`)가 모든 enabled 섹션을 텍스트로 emit하므로 첨부를 섞으면 빈 heading이 본문에 찍힌다. 독립 boolean(`replayEnabled` 동형)이 단순하고 안전.
3. **session에 dataURL로 첨부 저장(캡처 방식)**: 캡처 이미지처럼 dataURL을 session에 직렬화.
   - 기각: `chrome.storage.session` quota(~10MB)와 항목 크기 제한. 임의 파일은 수십 MB까지 가능 → 즉시 초과.
4. **본문 인라인 임베드**: 이미지 첨부를 본문에 `![](url)`로.
   - 기각: 사용자가 명시적으로 인라인 불필요라고 결정. 링크/네이티브 첨부로 단순화.

## 위험 요소

- **IndexedDB 마이그레이션**: `DB_VERSION` 6→7 `onupgradeneeded`에 store 추가만 하면 기존 데이터 무손상. 단 기존 사용자 DB 업그레이드 경로 수동 확인 필요(기존 store 누락 분기 보존).
- **파일명 충돌**: 동일 파일명 다중 첨부 시 업로드 결과 매핑(`Map<filename, href>`)이 덮어써진다. 업로드 filename을 `${id}__${filename}`로 고유화하고 표시는 `displayName`(원본)으로 분리. 본문 빌더가 displayName을 쓰도록 주의.
- **Asana 변환 분리**: `webpToJpeg`가 캡처 이미지 전용임을 유지. 사용자 첨부(이미지 포함)는 변환 없이 그대로 업로드 — 변환 루프에 섞이지 않도록 `allFiles` 합류 지점을 분리.
- **큰 파일 메모리**: 제출 시 Blob→dataURL(base64)은 메모리 ~1.33배. 매우 큰 파일 다중 첨부 시 service worker/패널 메모리 압박 가능. 개수 상한(10) + 한도 경고로 완화하되, 하드 차단은 안 함(PRD대로).
- **토글 OFF 시 잔여 Blob**: 토글을 끈 채 제출하면 첨부는 업로드 스킵되지만 IndexedDB Blob은 남는다 → `confirmDraft`에서 토글 OFF면 첨부 rekey 생략 + `pending` 삭제, 또는 제출/폐기 시 `deleteAttachmentBlobs`가 issueId/pending 양쪽을 정리하도록 보장.
- **privacy.md**: manifest 권한 변동은 없으나(파일 선택은 `<input type=file>`, 추가 권한 불요), **"사용자가 직접 고른 임의 파일을 외부 플랫폼에 전송"하는 새 데이터 흐름**이다. `docs/privacy.md` 대조·시행일 갱신 필요(권한 문자열이 아니라 동작에 묶이는 게이트).
