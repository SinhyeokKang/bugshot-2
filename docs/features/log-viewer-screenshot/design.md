# Log Viewer — Screenshot 좌측 패널 — 기술 설계

## 개요

`LogViewerData`에 `screenshot` 필드를 추가하고, screenshot 모드의 `buildCaptureFiles`가 첨부 이미지를 그 필드로 임베드한다. 로그 뷰어 `App.tsx`는 `video`가 없고 `screenshot`이 있으면 좌측 패널에 새 `ImageViewer` 컴포넌트를 렌더한다. `ImageViewer`는 `VideoPlayer`의 컨테이너·타이틀 오버레이 스타일을 그대로 따르되 `<img>`를 표시하고 하단 컨트롤을 두지 않는다. 데이터 흐름은 기존 video 임베드 경로(`buildCaptureFiles → buildLogsHtml → LogViewerData → App`)를 그대로 재사용한다.

## 변경 범위

### `src/types/log-viewer.ts`
- 현재 역할: 로그 뷰어에 임베드되는 `LogViewerData` 구조 정의.
- 변경: `video` 옆에 `screenshot: { dataUrl: string } | null` 필드 추가. (시간 동기화가 없으므로 `startedAt`·`thumbnail` 불필요 — `dataUrl`만.)

### `src/sidepanel/lib/buildLogsHtml.ts`
- 현재 역할: `LogViewerData`를 조립해 `dist-log-viewer/index.html` 템플릿에 JSON 임베드.
- 변경: 시그니처에 `screenshot: LogViewerData["screenshot"]` 인자 추가(`video` 인자 바로 뒤). `data` 객체에 `screenshot` 포함. 호출처가 단일(`buildCaptureFiles`)이므로 위치 인자 추가의 파급은 1곳.

### `src/sidepanel/lib/buildCaptureFiles.ts`
- 현재 역할: 캡처 모드별로 video/images/logs 첨부 파일 생성. screenshot 모드는 `screenshot.webp`(images)와, 로그 존재 시 `logs.html`을 생성.
- 변경: `logs.html` 생성 블록(line 54-77)에서 `buildLogsHtml` 호출 시 screenshot 임베드 인자를 전달. screenshot 모드 & `input.screenshotImage` 존재 시 `{ dataUrl: input.screenshotImage }`, 아니면 `null`.
  - `input.screenshotImage`는 이미 본문 첨부에 쓰는 값(상위에서 `screenshotAnnotated ?? screenshotRaw` 해소, `editor-store.ts:483`)이라 동일 이미지가 좌측 패널에도 들어간다.
  - video와 screenshot은 상호 배타(같은 캡처에 둘 다 없음)지만, 방어적으로 video 임베드가 있으면 screenshot은 `null`로 둔다(App에서 video 우선).

### `src/log-viewer/components/ImageViewer.tsx` (신규)
- 위치/역할: 로그 뷰어 좌측 패널의 정적 스크린샷 뷰어. `VideoPlayer.tsx`의 래퍼·이미지영역·타이틀 오버레이 마크업을 그대로 가져오되 video 전용 요소(center play/pause, 하단 컨트롤, ProgressBar, seek/재생 상태)를 제거.
- props: `{ src: string; issueTitle?: string; issueKey?: string; issueUrl?: string }`.
- 내부: `<img>` 로드 실패 시 에러 상태(`useState`)로 전환해 `logViewer.image.error` 문구 표시(video error box와 대칭). seek/forwardRef 불필요(handle 없음).

### `src/log-viewer/App.tsx`
- 현재 역할: video 유무로 좌측 패널/전폭 분기. `video && !videoError`일 때만 로그에 sync·marker props 공급.
- 변경:
  - `const screenshot = data?.screenshot ?? null;` 추가.
  - 분기 조건을 `video || screenshot`로 확장: 둘 다 없으면 기존처럼 전폭 로그(`return <div className="flex h-screen flex-col">{tabsPanel}</div>`).
  - `ResizablePanelGroup`의 좌측 `ResizablePanel` 내부: `video`면 기존 VideoPlayer(또는 videoError 박스), 아니면 `<ImageViewer src={screenshot!.dataUrl} issueTitle/Key/Url={data.meta...} />`.
  - markers/sync는 변경 없음 — `video` 기준 그대로라 screenshot일 땐 빈 객체(로그가 라이브 서브탭처럼 일반 렌더). seek/타임라인 미적용.

### `src/log-viewer/i18n.ts`
- 변경: `logViewer.image.error` 키를 ko/en 양쪽에 추가(`logViewer.video.error`와 대칭 문구). 로그 뷰어 자체 i18n 사전(`src/i18n/`이 아님)이라 PostToolUse 훅 대상은 아니지만 ko/en 동시 갱신 원칙 적용.

## 데이터 흐름

```
[캡처/제출] editor-store: screenshotImage = screenshotAnnotated ?? screenshotRaw
        │
        ▼
buildCaptureFiles(captureMode="screenshot", screenshotImage)
   ├─ images: screenshot.webp        (기존, 본문 첨부)
   └─ logs.html (로그 존재 시에만)
         └─ buildLogsHtml(..., video=null, screenshot={dataUrl: screenshotImage}, ...)
                 └─ LogViewerData.screenshot 임베드 (JSON)
        │
        ▼
[뷰어 열람] main.tsx: JSON 파싱 → App({data})
        └─ data.video=null, data.screenshot≠null
                └─ ResizablePanelGroup
                      ├─ 좌(60%): <ImageViewer src=screenshot.dataUrl />
                      └─ 우(40%): tabsPanel (로그, sync 없음)
```

## 인터페이스 설계

```ts
// src/types/log-viewer.ts
export interface LogViewerData {
  // ...기존...
  video: { dataUrl: string; startedAt: number; thumbnail?: string } | null;
  screenshot: { dataUrl: string } | null; // 신규
  meta: { /* ...기존... */ };
}

// src/sidepanel/lib/buildLogsHtml.ts
export function buildLogsHtml(
  networkLog: NetworkLog | null,
  consoleLog: ConsoleLog | null,
  actionLog: ActionLog | null,
  video: LogViewerData["video"],
  screenshot: LogViewerData["screenshot"], // 신규 (video 바로 뒤)
  pageUrl: string,
  issueUrl?: string,
  issueTitle?: string,
): string

// src/log-viewer/components/ImageViewer.tsx (신규)
interface ImageViewerProps {
  src: string;
  issueTitle?: string;
  issueKey?: string;
  issueUrl?: string;
}
export function ImageViewer(props: ImageViewerProps): JSX.Element
```

## 기존 패턴 준수

- **단일 진실 게이팅**: `logs.html` 생성은 `supportsConsoleNetworkLog` + 로그 존재 조건 그대로(`captureLogSupport.ts`). screenshot 표시는 이 게이팅에 종속 — 별도 우회 생성 안 함.
- **video 임베드 패턴 미러링**: `buildCaptureFiles`의 video 임베드(line 58-69)와 동일한 형태의 조건부 임베드 객체.
- **스타일 동일성**: `ImageViewer`는 `VideoPlayer`의 Tailwind 클래스(`group relative h-full` / `flex h-full items-center justify-center bg-black` / `h-full w-full object-contain` / 타이틀 오버레이 블록)를 그대로 사용. shadcn 외 직접 스타일링 추가 최소화.
- **i18n 동시 갱신**: ko/en 양쪽에 `logViewer.image.error` 추가.
- **테스트 우선**: `buildCaptureFiles` 순수 함수 변경 → `__tests__/buildCaptureFiles.test.ts`에 screenshot 임베드 케이스 선작성.

## 대안 검토

1. **VideoPlayer에 `controls`/`media-type` prop을 추가해 한 컴포넌트로 분기** — 채택 안 함. video 전용 상태(재생/seek/duration/마커/forwardRef)가 대부분이라 prop 분기가 컴포넌트를 복잡하게 만든다. 스타일만 공유하면 되므로 별도 `ImageViewer`가 더 단순하고 외과적. (요청한 "스타일 동일 + 컨트롤 제거"에 정확히 부합)
2. **`screenshot.webp` 첨부를 좌측 패널이 fetch** — 불가/복잡. `logs.html`은 단일 self-contained 파일이고 첨부 간 상대경로 접근이 보장되지 않음. video와 동일하게 dataUrl 인라인 임베드가 일관적.
3. **`video` 필드를 일반화한 `media: {type, dataUrl}`로 통합** — 채택 안 함. video는 `startedAt`(동기화 앵커)·`thumbnail`을 갖고 screenshot은 안 가져, 통합 타입이 옵셔널 범벅이 된다. 별도 필드가 의미가 명확하고 마이그레이션 부담 없음.

## 위험 요소

- **이미지 이중 임베드 용량**: 스크린샷이 `screenshot.webp`(본문)와 `logs.html`(인라인 dataUrl) 양쪽에 들어가 `logs.html` 크기가 webp 1장만큼 증가. webp는 작아 실무상 무시 가능하며 video 임베드도 동일 트레이드오프를 이미 수용 중.
- **App.tsx 분기 회귀**: video/screenshot/none 3분기로 확장하므로 video 모드 좌측 패널·sync·marker 경로가 그대로인지 확인 필요(수동: video 이슈 logs.html 열어 재생·seek·마커 동작).
- **buildLogsHtml 위치 인자 추가**: `screenshot`를 `video` 뒤에 끼우면 `pageUrl`·`issueUrl`·`issueTitle` 위치가 한 칸씩 밀린다. 단일 호출처지만 인자 순서 갱신 누락 시 타입 에러로 잡힘(`pnpm typecheck`).
- **annotated 타이밍**: 본문 첨부와 좌측 패널 이미지가 어긋나지 않도록 동일 `screenshotImage`를 재사용(별도 재해소 금지).
