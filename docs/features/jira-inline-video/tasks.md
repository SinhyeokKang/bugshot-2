# Jira 인라인 비디오 임베드 — 구현 태스크

## 선행 조건

- `mp4-muxer` npm 패키지 설치: `pnpm add mp4-muxer`
- Jira Cloud 테스트 환경에서 `mediaSingle > media` 노드로 비디오가 인라인 렌더되는지 수동 확인 (Jira REST API로 ADF에 video 첨부 ID를 media 노드로 삽입 후 이슈 조회)

## 태스크

### Task 1: VIDEO_PLACEHOLDER 상수 추가

- **변경 대상**: `src/lib/adf-sentinels.ts`
- **작업 내용**: `VIDEO_PLACEHOLDER = "__BUGSHOT_VIDEO__"` export 추가
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 `IMAGE_PLACEHOLDER` import에 영향 없음

### Task 2: ADF 빌더에서 비디오 플레이스홀더 사용

- **변경 대상**: `src/sidepanel/lib/buildIssueAdf.ts`
- **작업 내용**: `emitMedia()` 함수의 `isVideo` 분기에서 `t("md.videoAttached")` 텍스트 대신 `VIDEO_PLACEHOLDER` 텍스트 노드를 삽입. 스크린샷의 `IMAGE_PLACEHOLDER` 패턴과 동일하게 paragraph 노드로 감싸기.
- **검증**:
  - [ ] `buildIssueAdf()` 단위 테스트: video 캡처 모드에서 ADF content에 `VIDEO_PLACEHOLDER` 텍스트가 포함된 paragraph 노드가 존재하는지 확인
  - [ ] screenshot/element 캡처 모드에서는 기존 동작과 동일한지 확인 (회귀 테스트)

### Task 3: WebM → MP4 변환 유틸 구현

- **변경 대상**: `src/sidepanel/lib/webm-to-mp4.ts` (신규)
- **작업 내용**:
  - `webmToMp4(webmBlob: Blob, onProgress?): Promise<Blob | null>` 구현
  - `<video>` 요소로 WebM 로드 → `requestVideoFrameCallback` + elevated `playbackRate`로 프레임 순회
  - 각 프레임을 `VideoFrame`으로 캡처 → `VideoEncoder`(H.264 Baseline `avc1.42001f`)로 인코딩
  - `mp4-muxer`의 `Muxer` + `ArrayBufferTarget`으로 MP4 컨테이너 생성
  - width/height 홀수 시 짝수로 라운드 업
  - 에러 발생 시 리소스 정리 후 `null` 반환 (try/finally)
  - `VideoEncoder.isConfigSupported()` 로 사전 체크, 미지원 시 즉시 `null`
- **검증**:
  - [ ] 순수 함수 단위 테스트 (WebCodecs mock 환경에서의 시그니처/에러 핸들링 테스트)
  - [ ] 수동 테스트: 실제 WebM 파일을 변환해 MP4가 Chrome에서 재생되는지 확인
  - [ ] 변환 실패 시 null 반환 확인 (에러 throw 안 함)

### Task 4: IssueCreateModal Jira 제출에 변환 적용

- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`
- **작업 내용**:
  - `handleJiraSubmit()` 내 `captureMode === "video"` 분기에서:
    1. `webmToMp4(videoBlob)` 호출
    2. 성공 시: 결과 MP4 Blob을 `blobToDataUrl()`로 변환, filename `"recording.mp4"`로 attachments에 추가
    3. 실패 시 (null 반환): 기존대로 WebM Blob을 `"recording.webm"`으로 추가
- **검증**:
  - [ ] 수동 테스트: Jira 이슈 생성 시 첨부파일이 `recording.mp4`로 올라가는지 확인
  - [ ] 변환 실패 시 `recording.webm`으로 정상 제출되는지 확인
  - [ ] screenshot/element 캡처 모드의 Jira 제출에 회귀 없음

### Task 5: DraftDetailDialog Jira 제출에 변환 적용

- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**: Task 4와 동일한 로직을 `handleJiraSubmit()`에 적용
- **검증**:
  - [ ] 수동 테스트: 이슈 목록에서 미제출 비디오 드래프트를 Jira로 제출할 때 MP4로 변환되는지 확인
  - [ ] 변환 실패 시 WebM fallback 확인

### Task 6: Backend ADF 비디오 노드 치환

- **변경 대상**: `src/background/messages.ts`
- **작업 내용**:
  - `submitIssue()` 함수에서 `uploadMap` 처리 후, `recording.mp4` (또는 fallback으로 `recording.webm`) 파일의 업로드 결과를 확인
  - ADF content에서 `VIDEO_PLACEHOLDER` 텍스트를 포함한 paragraph 노드를 찾아 `mediaSingle > media` 노드로 치환 (스크린샷 치환 로직과 동일한 패턴)
  - `VIDEO_PLACEHOLDER`를 import하기 위해 `adf-sentinels.ts` import 추가
- **검증**:
  - [ ] 단위 테스트: VIDEO_PLACEHOLDER가 포함된 ADF content에서 recording.mp4 업로드 결과로 mediaSingle 노드가 생성되는지 확인
  - [ ] 수동 테스트: Jira 이슈 본문에서 비디오가 인라인으로 표시되는지 확인
  - [ ] 스크린샷/element 캡처 이슈의 ADF 치환에 회귀 없음

## 테스트 계획

### 단위 테스트

| 대상 | 파일 | 케이스 |
|------|------|--------|
| `buildIssueAdf` | `src/sidepanel/lib/__tests__/buildIssueAdf.test.ts` | video 모드에서 `VIDEO_PLACEHOLDER` paragraph 존재 확인; screenshot/element 모드 기존 동작 회귀 |
| `webmToMp4` | `src/sidepanel/lib/__tests__/webm-to-mp4.test.ts` | `VideoEncoder.isConfigSupported` false → null 반환; 에러 시 null 반환 + 리소스 정리 |

### 수동 테스트

- [ ] 화면 녹화 → Jira 제출 → Jira 이슈에서 비디오 인라인 재생 확인
- [ ] 60초 녹화 → Jira 제출 → 변환 완료 대기 후 정상 제출 확인
- [ ] 변환 불가 환경 시뮬레이션 → WebM fallback으로 정상 제출 확인
- [ ] 스크린샷 캡처 → Jira 제출 → 인라인 이미지 정상 (회귀)
- [ ] 엘리먼트 캡처 → Jira 제출 → before/after 이미지 정상 (회귀)
- [ ] DraftDetailDialog에서 비디오 드래프트 Jira 재제출 → MP4 변환 + 인라인 임베드 확인
- [ ] GitHub/Linear/Notion 비디오 제출 → 기존 WebM 그대로 첨부 (변경 없음 확인)

## 구현 순서 권장

```
Task 1 (상수 추가)
  ↓
Task 2 (ADF 빌더) ─── 병렬 ──→ Task 3 (WebM→MP4 유틸)
  ↓                                ↓
Task 6 (Backend 치환)          Task 4 + 5 (프론트 제출 적용)
```

- Task 1은 단독 선행 (다른 태스크들이 의존).
- Task 2와 Task 3은 독립적으로 병렬 진행 가능.
- Task 6은 Task 2에 의존 (VIDEO_PLACEHOLDER가 ADF에 있어야 치환 가능).
- Task 4, 5는 Task 3에 의존 (변환 유틸이 있어야 호출 가능).
- Task 4와 Task 5는 동일 패턴이므로 순차로 빠르게 진행.
