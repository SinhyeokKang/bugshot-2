# Log Viewer — Screenshot 좌측 패널 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변경 없음.
- 빌드 의존성: `App.tsx`/`ImageViewer`는 로그 뷰어 번들(`pnpm build:log-viewer`)이 `dist-log-viewer/index.html`을 갱신해야 사이드패널이 inline. 단 구현 단계에선 `pnpm typecheck`로 충분, 실제 확인 시 `/build`.
- 이미지 소스는 상위에서 이미 `screenshotAnnotated ?? screenshotRaw`로 해소되어 `screenshotImage`로 들어옴(재해소 금지).

## 태스크

### Task 1: `LogViewerData`에 `screenshot` 필드 추가
- **변경 대상**: `src/types/log-viewer.ts`
- **작업 내용**: `video` 필드 옆에 `screenshot: { dataUrl: string } | null` 추가.
- **검증**:
  - [ ] `pnpm typecheck` — 필드 추가로 `buildLogsHtml`/`App.tsx`가 미충족 시 타입 에러가 떠야 함(다음 태스크로 해소).

### Task 2: `buildCaptureFiles` screenshot 임베드 테스트 선작성
- **변경 대상**: `src/sidepanel/lib/__tests__/buildCaptureFiles.test.ts`
- **검증 메커니즘 (중요)**: 이 파일은 `buildLogsHtml`을 **`vi.mock` 스파이**로 잡고 호출 인자를 검사한다(`__BUGSHOT_DATA__` 디코드는 `buildLogsHtml.test.ts`의 real-함수 패턴이라 이 파일과 다름 — 혼동 금지). 기존 `lastVideoArg() = call[3]`(video, 4번째 인자)을 미러링해 **`lastScreenshotArg() = call[4]`(screenshot, 5번째 인자) 헬퍼를 신규 추가**한다.
- **작업 내용**: 기존 "video 임베드 (logs.html)" describe를 미러링해 케이스 추가:
  - screenshot 모드 + consoleLog 존재 + `screenshotImage` → `lastScreenshotArg()`가 `{ dataUrl: screenshotImage }`.
  - screenshot 모드 + 로그 없음 → `logs` 빈 배열(게이팅 유지, 기존 동작 — `buildLogsHtml` 미호출).
  - screenshot 모드 + 로그 있음 + `screenshotImage` 없음 → `lastScreenshotArg()`가 `null`(전폭 폴백 데이터).
  - video 모드 → `lastScreenshotArg()`가 `null`(혼입 방지).
- **검증**:
  - [ ] `pnpm test` — Task 4(프로덕션에 5번째 인자 추가) 전이라 `call[4]`가 `undefined`인 것으로 신규 케이스가 실패함을 확인(red). green은 Task 4에서.

### Task 3: `buildLogsHtml` 시그니처에 `screenshot` 추가
- **변경 대상**: `src/sidepanel/lib/buildLogsHtml.ts`
- **작업 내용**: `video` 인자 바로 뒤에 `screenshot: LogViewerData["screenshot"]` 추가하고 `data` 객체에 `screenshot` 포함.
- **함께 갱신**: `screenshot`을 `video` 뒤(5번째)에 끼우면 `pageUrl`·`issueUrl`·`issueTitle` 위치가 밀린다. **`src/sidepanel/lib/__tests__/buildLogsHtml.test.ts`의 `buildLogsHtml(...)` 호출 11곳**도 5번째 인자(`null` 또는 테스트용 screenshot)를 끼워 동시 갱신.
- **검증**:
  - [ ] `pnpm typecheck` — 프로덕션 호출처(`buildCaptureFiles.ts:70`)·테스트 호출 11곳이 미갱신이면 에러.
  - [ ] `pnpm test` — `buildLogsHtml.test.ts`가 인자 밀림 없이 통과.

### Task 4: `buildCaptureFiles`에서 screenshot 임베드 전달
- **변경 대상**: `src/sidepanel/lib/buildCaptureFiles.ts`
- **작업 내용**: line 70의 `buildLogsHtml(...)` 호출에서 `video` 인자 뒤에 screenshot 임베드 전달:
  `input.captureMode === "screenshot" && input.screenshotImage ? { dataUrl: input.screenshotImage } : null` (video 임베드가 있으면 자연히 screenshot은 null — 모드 배타).
- **검증**:
  - [ ] Task 2의 `pnpm test` 케이스 통과(green).
  - [ ] `pnpm typecheck` 통과.

### Task 5: `ImageViewer` 컴포넌트 신규 작성
- **변경 대상**: `src/log-viewer/components/ImageViewer.tsx` (신규)
- **작업 내용**: `VideoPlayer`의 래퍼(`group relative h-full`)·이미지영역(`flex h-full items-center justify-center bg-black`, `<img className="h-full w-full object-contain">`)·상단 타이틀 오버레이 블록을 그대로 가져오되, center play/pause·하단 컨트롤·ProgressBar·재생 상태/seek/forwardRef 제거. **이미지영역 div의 `cursor-pointer`와 `onClick={togglePlay}`(VideoPlayer:82-85)도 제거**(정적 이미지는 클릭 무동작). props `{ src, issueTitle?, issueKey?, issueUrl? }`. `<img alt={issueTitle}>`로 alt 채움(접근성). `<img onError>` → 에러 state → `t("logViewer.image.error")` 박스 표시(`App.tsx:211-214` video 에러 박스 클래스 미러링). 타이틀 오버레이는 video와 동일 `group-hover` 호버 전용. dataUrl 인라인이라 로딩 스피너 없음.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] 코드 리뷰: VideoPlayer와 타이틀 오버레이·배경·정렬 클래스가 동일한지 대조.

### Task 6: `logViewer.image.error` i18n 키 추가
- **변경 대상**: `src/log-viewer/i18n.ts`
- **작업 내용**: ko/en 양쪽에 `logViewer.image.error` 추가(ko: "이미지를 불러올 수 없습니다", en: "Unable to load image" 등).
- **검증**:
  - [ ] ko/en 키 대칭 확인(이 파일은 `src/i18n/` PostToolUse 훅 대상 아님 — 수동 대조).

### Task 7: `App.tsx` 좌측 패널 분기 확장
- **변경 대상**: `src/log-viewer/App.tsx`
- **작업 내용**:
  - `const screenshot = data?.screenshot ?? null;`
  - 전폭 분기 조건을 `!video && !screenshot`로 변경(둘 다 없으면 기존 전폭 로그).
  - 좌측 `ResizablePanel` 내부: `video`면 기존 VideoPlayer/error 박스, 아니면 `<ImageViewer src={screenshot!.dataUrl} issueTitle={data.meta.issueTitle} issueKey={data.meta.issueKey} issueUrl={data.meta.issueUrl} />`.
  - `markers`/`sync`/`scrollProps`는 변경 없음(video 기준 유지 → screenshot은 로그 sync 없음).
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] 수동(빌드 후): screenshot 모드 이슈의 `logs.html` 열어 좌측 스크린샷·우측 로그 60/40 분할, 하단 컨트롤 없음, 호버 시 타이틀 오버레이 확인.
  - [ ] 회귀: video 모드 `logs.html` 열어 재생·seek·마커·다운로드 정상.
  - [ ] 회귀: 로그 없는 screenshot은 `logs.html` 미생성(첨부 목록에 없음).

## 테스트 계획

- **단위 테스트** (`buildCaptureFiles.test.ts`, `buildLogsHtml` 스파이 `lastScreenshotArg()=call[4]`):
  - screenshot 모드 + 로그 + 이미지 → `lastScreenshotArg()` = `{ dataUrl }` 일치.
  - screenshot 모드 무로그 → `logs` 빈(`buildLogsHtml` 미호출).
  - screenshot 모드 + 로그 + 이미지 없음 → `lastScreenshotArg()` = `null`(전폭 폴백).
  - video 모드 → `lastScreenshotArg()` = `null`(혼입 방지).
- **수동 테스트** (Chrome, `/build` 후):
  - [ ] screenshot 모드 캡처 → 이슈 등록 → 첨부 `logs.html` 열기 → 좌측 스크린샷 표시·하단 컨트롤 없음.
  - [ ] annotated(주석 그린) 스크린샷이 좌측에 반영.
  - [ ] 좌측 호버 → 타이틀/키 오버레이 페이드.
  - [ ] 리사이즈 핸들로 좌우 비율 조절 동작.
  - [ ] video 모드 회귀(재생/seek/마커/다운로드).
  - [ ] 이미지 로드 실패 시 에러 문구(임시로 깨진 src로 확인 가능).

## 구현 순서 권장

Task 1 → 2(red) → 3 → 4(green) 순서로 데이터 경로 먼저 완성(테스트로 검증 가능). 이후 Task 5·6은 병렬 가능, 마지막 Task 7로 UI 결선. Task 7은 5·6 완료 후.

## 가이드 영향

사용자 노출 UX 변화(로그 뷰어 좌측에 스크린샷 표시). 갱신 검토 대상:
- `guide/ko`·`guide/en`의 로그 뷰어/캡처 결과물 설명 페이지 — screenshot 모드에서도 로그 뷰어 좌측에 캡처 화면이 보인다는 점 반영. 정확한 페이지는 `guide/AUTHORING.md` IA 대조 후 `/guide`로 처리(로그 뷰어를 다루는 페이지가 없으면 "없음").
