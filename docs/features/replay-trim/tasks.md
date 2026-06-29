# 30초 리플레이 트리밍 — 구현 태스크

## 선행 조건

- shadcn `Slider` 설치: `npx shadcn@latest add slider` (`components/ui/slider.tsx` 생성). Radix Slider 2-thumb 레인지 사용.
- 새 권한·env·OAuth·외부 API 없음. manifest 변경 없음.
- `computeFrameDurationsUs`(`mp4-encoder.ts`)·`trimByTime`/`replayLogBounds`(`log-merge.ts`)·`*Persist.discard`(`usePickerMessages.ts`)가 이미 export됨 — 신규 trim 로직 없이 재사용.

## 태스크

### Task 1: trim-math 순수 함수 + 단위 테스트 (테스트 우선)
- **변경 대상**: `src/sidepanel/30s-replay/trim-math.ts`(신규), `src/sidepanel/30s-replay/__tests__/trim-math.test.ts`(신규)
- **작업 내용**: `frameOffsetsMs`(누적 표시 오프셋 ms, `computeFrameDurationsUs` 재사용), `secondsToFrameRange`(초→프레임 인덱스 스냅·clamp·최소 길이), `isFullRange`(in=0&&out=last) 구현. `/tdd interface`로 테스트 먼저.
- **검증**:
  - [ ] `frameOffsetsMs`: 빈 배열 `[]`, 단일 프레임 `[0]`, 등간격(600ms) 프레임의 누적 오프셋이 단조 증가.
  - [ ] `secondsToFrameRange`: startSec=0 → inIndex=0; endSec≥총길이 → outIndex=last; 중간값은 가장 가까운 프레임에 스냅; in==out으로 좁혀지면 최소 길이 보장.
  - [ ] `isFullRange`: (0,last)=true, 그 외 false.
  - [ ] `pnpm test` 통과.

### Task 2: editor-store `replaceVideo` 액션
- **변경 대상**: `src/store/editor-store.ts` (타입 ≈164, 구현 ≈501)
- **작업 내용**: `replaceVideo(blob, thumbnail, startedAt, endedAt)` 추가 — `set({ videoBlob, videoThumbnail, videoCapturedAt: Date.now(), videoStartedAt, videoEndedAt })`. phase·attach·target 불변.
- **검증**:
  - [ ] `editor-store.test.ts`에 케이스 추가: drafting 상태에서 `replaceVideo` 호출 시 영상 메타만 바뀌고 phase/attach 토글 불변.
  - [ ] `pnpm typecheck` 통과.

### Task 3: `applyReplayTrim` 백엔드
- **변경 대상**: `src/sidepanel/30s-replay/apply-trim.ts`(신규)
- **작업 내용**: design의 `applyReplayTrim` 구현 — `secondsToFrameRange` → slice → `isFullRange`면 no-op → `encodeToMp4` → `replayLogBounds(newLower,newUpper)` → `*Persist.discard()` → `trimByTime`로 store 로그 재trim → `set*Log` + `save*Log(`pending:${tabId}`)` → `editor.replaceVideo`. 실패 시 throw(호출부에서 토스트).
- **검증**:
  - [ ] 전체 구간 입력 시 재인코딩·로그 재trim 미발생(no-op) — 단위 또는 수동.
  - [ ] (수동) 실제 캡처에서 앞뒤 자른 뒤 첨부 로그가 새 경계 밖 항목을 포함하지 않음.

### Task 4: `use30sReplay` pendingTrim/resolveTrim 노출
- **변경 대상**: `src/sidepanel/30s-replay/use-30s-replay.ts`
- **작업 내용**: `Use30sReplayReturn`에 `pendingTrim`·`resolveTrim` 추가. `capture()`가 `onRecordingComplete` **이후** 보존한 `frames`·`fullBlob`·`captureTime`으로 `pendingTrim` state set(프레임 2개 미만이면 생략). `resolveTrim(applied)`가 `pendingTrim=null`로 정리(프레임 참조 해제). 기존 로그/인코딩/phase 시퀀스 불변.
- **검증**:
  - [ ] 프레임 2개 이상 캡처 시 `capture()` 후 `pendingTrim != null`.
  - [ ] `resolveTrim` 호출 시 `pendingTrim == null`.
  - [ ] 기존 `editor-store.test.ts:196`(capture 동등 흐름) 회귀 없음.

### Task 5: `ReplayTrimDialog` UI
- **변경 대상**: `src/sidepanel/tabs/ReplayTrimDialog.tsx`(신규), `src/components/ui/slider.tsx`(shadcn 설치)
- **작업 내용**: `<Dialog>` + `<video src={objectURL(videoBlob)}>` + 듀얼 핸들 `Slider value={[startSec,endSec]}`. `onLoadedMetadata`로 duration, 핸들 변경 시 움직이는 쪽 currentTime seek. 푸터 **적용/전체 유지**. `busy` 시 버튼 잠금·스피너. objectURL revoke 정리(`VideoPreview` 패턴 참고: `DraftingPanel.tsx:848`).
- **검증**:
  - [ ] (수동) 다이얼로그에서 핸들 드래그 → 영상이 경계로 seek됨.
  - [ ] (수동) 적용/전체 유지 동작 정상.

### Task 6: App 와이어링 + i18n
- **변경 대상**: `src/sidepanel/App.tsx`, `src/i18n/namespaces/issue.ts`
- **작업 내용**: `replay.pendingTrim` 있으면 `<ReplayTrimDialog>` 렌더. `onApply`에서 `applyReplayTrim(...)` 호출, `.catch`로 `issue.replay.encodeFailed` 토스트, `.finally`로 `resolveTrim`. `onKeepFull`은 `resolveTrim(false)`. `issue.replay.trim.{title,apply,keepFull,hint}` ko/en 동시 추가.
- **검증**:
  - [ ] (수동) 30s 리플레이 캡처 → drafting 위에 다이얼로그 자동 등장.
  - [ ] i18n PostToolUse 훅(ko/en 대칭) 통과.
  - [ ] `pnpm typecheck` 통과.

## 테스트 계획

- **단위 테스트**: `trim-math.test.ts` (Task 1 케이스 전부). `editor-store.test.ts`에 `replaceVideo` 케이스.
- **e2e 시나리오**(`/e2e-write` 입력 — 자동 판정 가능 문장):
  - 30s 리플레이를 캡처하면 drafting 진입과 동시에 트리밍 다이얼로그가 보인다(다이얼로그 `data-testid` 노출).
  - 트리밍 다이얼로그에서 "전체 유지"를 누르면 다이얼로그가 닫히고 drafting 미리보기 영상이 보인다.
  - 트리밍 다이얼로그에서 in/out 핸들을 좁힌 뒤 "적용"을 누르면 다이얼로그가 닫히고 drafting으로 진입한다.
  - (참고) captureVisibleTab 실제 프레임·재인코딩 결과 영상 길이 검증은 e2e에서 결정적이지 않으므로 수동.
  - **src 수정은 `data-testid` 추가만**(다이얼로그 컨테이너·적용/전체유지 버튼).
- **수동 테스트**(Chrome, captureVisibleTab/WebCodecs 의존):
  - [ ] 실제 페이지에서 30s 리플레이 → 앞뒤 자르고 적용 → drafting 영상 길이가 선택 구간으로 줄어듦.
  - [ ] 적용 후 첨부 로그(console/network/action)가 새 영상 구간 경계 밖 항목 미포함.
  - [ ] "전체 유지" 결과가 트리밍 없는 기존 동작과 동일.
  - [ ] 재인코딩 실패(코덱 미지원 등) 시 토스트 + 전체 클립 유지.
  - [ ] 일반 녹화(탭/화면) 흐름은 다이얼로그가 뜨지 않고 기존대로 동작(회귀 없음).

## 구현 순서 권장

1. **Task 1**(trim-math + 테스트) — 다른 태스크의 토대, 독립.
2. **Task 2**(replaceVideo) — 독립, Task 1과 병렬 가능.
3. **Task 3**(applyReplayTrim) — Task 1·2 의존.
4. **Task 4**(use30sReplay pendingTrim) — Task 3과 독립이나 통합은 Task 3 이후.
5. **Task 5**(다이얼로그 UI) — Task 1~4와 독립, 병렬 가능(slider 설치 선행).
6. **Task 6**(App 와이어링 + i18n) — Task 3·4·5 통합, 마지막.

## 가이드 영향

사용자 노출 UX(리플레이 캡처 직후 트리밍 다이얼로그) 추가 → `/guide`로 갱신. 30초 리플레이/영상 캡처를 다루는 `guide/ko`·`guide/en` 페이지(예: 영상·리플레이 설명 페이지)에 "캡처 후 앞뒤를 잘라 버그 구간만 남길 수 있다" 흐름 추가. 정확한 페이지·라벨은 구현 후 `guide/AUTHORING.md` 규칙대로 ko·en 동시 갱신.
