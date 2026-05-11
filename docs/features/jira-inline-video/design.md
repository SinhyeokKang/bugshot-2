# Jira 인라인 비디오 임베드 — 기술 설계

## 개요

기존 스크린샷의 ADF 인라인 삽입 패턴(`IMAGE_PLACEHOLDER` → `mediaSingle > media`)을 비디오에도 적용한다. 제출 시점에 WebM을 WebCodecs API + `mp4-muxer` 라이브러리로 MP4(H.264)로 변환한 뒤 Jira에 업로드하고, ADF 본문의 비디오 플레이스홀더를 media 노드로 치환한다.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|------|------|
| `src/sidepanel/lib/webm-to-mp4.ts` | WebM Blob → MP4 Blob 변환 유틸. WebCodecs `VideoEncoder`(H.264) + `mp4-muxer`로 트랜스코딩. |

### 변경 파일

| 파일 | 현재 역할 | 변경 내용 |
|------|-----------|-----------|
| `src/lib/adf-sentinels.ts` | `IMAGE_PLACEHOLDER` 상수 정의 | `VIDEO_PLACEHOLDER` 상수 추가 |
| `src/sidepanel/lib/buildIssueAdf.ts` | ADF 문서 빌드 | video 캡처 모드일 때 `t("md.videoAttached")` 텍스트 대신 `VIDEO_PLACEHOLDER` 텍스트 노드 삽입 |
| `src/background/messages.ts` | Jira 이슈 생성 + 첨부 업로드 + ADF 갱신 | `recording.mp4` 업로드 결과로 `VIDEO_PLACEHOLDER`를 `mediaSingle > media` 노드로 치환 |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | 이슈 생성 모달 | `handleJiraSubmit`에서 WebM → MP4 변환 후 filename `recording.mp4`로 전송 |
| `src/sidepanel/tabs/DraftDetailDialog.tsx` | 드래프트 상세/재제출 | `handleJiraSubmit`에서 동일하게 변환 적용 |

### 변경 없는 파일 (참고)

- `src/sidepanel/video-recorder.ts` — WebM 녹화 로직 그대로
- `src/store/blob-db.ts` — IndexedDB 저장은 WebM 그대로
- GitHub/Linear/Notion 제출 함수 — 변경 없음

## 데이터 흐름

```
[Jira 제출 트리거]
    ↓
IssueCreateModal.handleJiraSubmit (또는 DraftDetailDialog.handleJiraSubmit)
    ↓
videoBlob (WebM, IndexedDB에서 로드)
    ↓
webmToMp4(videoBlob) → MP4 Blob    ← 변환 실패 시 WebM 그대로 사용
    ↓
blobToDataUrl(mp4Blob) → dataUrl
    ↓
attachments: [{ filename: "recording.mp4", dataUrl }]   ← 기존 "recording.webm" 대신
    ↓
sendBg("jira.submitIssue", { payload, attachments })
    ↓
[Background: messages.ts#submitIssue]
    ↓
uploadAttachment(auth, issueKey, "recording.mp4", blob)
    ↓
uploadMap.set("recording.mp4", { kind: "media", mediaId } | { kind: "external", url })
    ↓
ADF content에서 VIDEO_PLACEHOLDER 텍스트를 찾아 mediaSingle > media 노드로 치환
    ↓
updateIssueDescription(auth, issueKey, updatedAdf)
```

## 인터페이스 설계

### `src/sidepanel/lib/webm-to-mp4.ts`

```typescript
export interface ConvertProgress {
  /** 0–1 변환 진행률 */
  ratio: number;
}

/**
 * WebM Blob을 MP4(H.264) Blob으로 변환한다.
 * WebCodecs API 미지원 또는 인코딩 오류 시 null을 반환한다.
 */
export async function webmToMp4(
  webmBlob: Blob,
  onProgress?: (progress: ConvertProgress) => void,
): Promise<Blob | null>;
```

### `src/lib/adf-sentinels.ts` (추가)

```typescript
export const VIDEO_PLACEHOLDER = "__BUGSHOT_VIDEO__";
```

## 변환 구현 전략

### WebCodecs + mp4-muxer

1. WebM Blob → `<video>` 요소에 로드
2. `video.requestVideoFrameCallback`으로 프레임 순회 (elevated `playbackRate`로 실시간보다 빠르게)
3. 각 프레임을 `new VideoFrame(video, { timestamp })` 로 캡처
4. `VideoEncoder`(H.264 Baseline, `avc1.42001f`)로 인코딩
5. `mp4-muxer`의 `Muxer`로 MP4 컨테이너 패키징
6. `muxer.finalize()` → `ArrayBuffer` → `Blob`

**주의사항**:
- H.264는 width/height가 짝수여야 한다. 홀수면 1px 패딩.
- `requestVideoFrameCallback`는 Chrome 83+. 우리 최소 버전(116)에서 지원.
- `VideoEncoder`는 Chrome 94+. 역시 116에서 지원.
- 60초 영상 변환 시간: 약 5~15초 (하드웨어 가속 가능 여부에 따라 다름).

### Fallback

`VideoEncoder` 미지원, `isConfigSupported` 실패, 또는 인코딩 중 에러 발생 시:
- `webmToMp4()`가 `null` 반환
- 호출부에서 원본 WebM을 `recording.webm`으로 전송 (기존 동작)
- ADF에는 `VIDEO_PLACEHOLDER`가 남아 있으므로, backend에서 `recording.webm`으로도 media 노드 치환 시도 (WebM도 Jira media로 인라인 표시 가능성 있음)

## 기존 패턴 준수

- **ADF placeholder 치환 패턴**: `IMAGE_PLACEHOLDER`와 동일한 방식으로 `VIDEO_PLACEHOLDER` 처리. `messages.ts#submitIssue`의 기존 스크린샷 치환 로직 옆에 비디오 치환 로직 추가.
- **첨부 업로드 패턴**: `JiraAttachmentInput` 구조체 그대로 사용. filename만 `.mp4`로 변경.
- **i18n**: `md.videoAttached` 키는 fallback 경로에서 여전히 사용될 수 있으므로 삭제하지 않음.
- **에러 처리**: 변환 실패가 이슈 제출 자체를 막지 않는 graceful degradation.

## 대안 검토

### FFmpeg.wasm
- WASM 바이너리 ~25MB. Chrome 확장의 번들 크기를 크게 증가시킨다.
- 기능적으로는 가장 강력하지만, 단순 VP9→H.264 변환에는 과도하다.
- **불채택**: 번들 크기 제약.

### MediaRecorder를 MP4로 녹화
- Chrome 120+에서 `video/mp4;codecs=avc1` MIME 지원이 실험적으로 존재.
- 그러나 모든 Chrome 116+ 환경에서 보장되지 않고, 기존 WebM 저장 파이프라인 전체를 변경해야 한다.
- **불채택**: 사용자가 명시한 "제출 시점에만 변환" 방침과 불일치.

### 비디오 변환 없이 WebM ADF 임베드만
- Jira media 노드에 WebM을 그대로 올려도 일부 환경에서 재생 가능.
- 그러나 Jira의 미디어 플레이어가 WebM 재생을 보장하지 않고, Windows 환경 등에서 문제가 발생할 수 있다.
- **불채택**: MP4 변환이 호환성 면에서 우월.

## 위험 요소

1. **변환 시간**: 60초 영상의 경우 변환에 10초 이상 걸릴 수 있다. 제출 버튼의 기존 로딩 UI가 커버하지만, 사용자가 오래 기다린다고 느낄 수 있다.
2. **메모리 사용**: 비디오 디코딩 + H.264 인코딩이 동시에 진행되면 메모리 스파이크 발생 가능. `VideoFrame.close()`를 즉시 호출해 해제해야 한다.
3. **H.264 하드웨어 가속**: 시스템에 따라 하드웨어 가속이 안 될 수 있다. 소프트웨어 인코딩 fallback은 Chrome이 자동 처리하지만 속도가 느려진다.
4. **Jira media 노드의 비디오 렌더링**: Jira Cloud에서 `mediaSingle > media` 노드로 비디오 첨부를 참조하면 인라인 플레이어가 나오는 것이 확인되어야 한다. 만약 Jira가 이미지만 인라인 렌더하고 비디오는 링크로 표시한다면, ADF 임베드의 효과가 제한적이다 (이 경우에도 첨부 자체는 정상 동작).
