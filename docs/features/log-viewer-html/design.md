# Self-Contained HTML Log Viewer — 기술 설계

## 개요

React + Tailwind로 작성된 log viewer 앱을 별도 Vite 빌드로 **단일 HTML 파일**로 출력하고, 메인 확장 빌드에서 이를 raw string으로 임포트하여 런타임에 로그 데이터를 주입한다. 기존 `NetworkLogContent`, `ConsoleLogContent`, `JsonTreeViewer` 컴포넌트를 직접 재사용하여 UI 품질을 보장한다.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|------|------|
| `vite.log-viewer.config.ts` | log viewer 전용 Vite 설정. `vite-plugin-singlefile`으로 단일 HTML 출력 |
| `src/log-viewer/index.html` | Vite 엔트리 HTML. `<div id="root">` + `<script type="module" src="main.tsx">` |
| `src/log-viewer/main.tsx` | React 엔트리. 데이터 읽기 + `<App>` 렌더 |
| `src/log-viewer/App.tsx` | 상단 바(타이틀, 테마 토글, 다운로드 버튼) + Network/Console 탭 전환 |
| `src/log-viewer/i18n.ts` | `useT()` 경량 대체. `navigator.language` 기반 ko/en 감지 |
| `src/log-viewer/styles.css` | Tailwind 엔트리 + `globals.css`의 CSS 변수(:root, .dark) 복사 |
| `src/lib/network-log-path.ts` | `networkLogPath()` 유틸 — `buildIssueMarkdown.ts`에서 분리. log viewer/메인 빌드 양쪽에서 직접 import |

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `package.json` | `build:log-viewer` 스크립트 추가. `build`/`build:store`에 선행 단계로 연결 |
| `src/sidepanel/lib/buildLogsHtml.ts` | (신규) 빌드된 template HTML에 JSON 데이터를 주입하여 최종 HTML 문자열 반환. 메인 빌드 영역 — `chrome.runtime.getManifest()` 접근 필요 |
| `src/sidepanel/lib/buildCaptureFiles.ts` | HAR/JSON 2파일 생성 → `buildLogsHtml()` 호출로 `logs.html` 1파일 생성 |
| `src/i18n/namespaces/logs.ts` | `logSummary.network.detail` + `logSummary.console.detail` → 통합 키 `logSummary.logs.detail`로 병합. `"(상세: logs.html 첨부)"` 한 줄로 출력 |
| `src/sidepanel/lib/buildIssueMarkdown.ts` | `filename: "network-log.har"` → `"logs.html"` |
| `src/sidepanel/lib/buildIssueAdf.ts` | 동일 변경 |
| `src/sidepanel/lib/buildGithubIssueBody.ts` | `filename: "network-log.json"` → `"logs.html"` |
| `src/sidepanel/lib/buildLinearIssueBody.ts` | 동일 변경 |
| `src/sidepanel/lib/buildNotionIssueBody.ts` | 변경 불필요 — `logSummary.*.detail` 미사용, code block으로 직접 출력 |
| `submitToGithub.ts` / `submitToLinear.ts` / `submitToNotion.ts`의 `guessMime()` | `.html` → `text/html` 분기 추가. Jira는 `FormData.append` blob 경유라 `guessMime` 불필요 |
| `src/sidepanel/components/NetworkLogContent.tsx` | `networkLogPath` import를 `@/lib/network-log-path`로 변경 |
| `src/sidepanel/lib/__tests__/buildCaptureFiles.test.ts` | 기대 파일명 `["logs.html"]`로 변경 |

## 데이터 흐름

```
[확장 런타임]
NetworkLog + ConsoleLog
       ↓  buildLogsHtml()
       ├── buildHar(networkLog) → har (JSON object)
       ├── buildConsoleLogJson(consoleLog) → consoleLogJson (JSON object)
       ├── template HTML string (빌드 시점에 ?raw 임포트)
       └── JSON.stringify({ networkLog, consoleLog, har, consoleLogJson, meta })
            → template 내 placeholder 치환
            → logs.html Blob
                  ↓
            CaptureFiles.logs[0] = { filename: "logs.html", dataUrl }
                  ↓
            플랫폼별 upload (기존 흐름 그대로)

[logs.html 열렸을 때]
<script> 태그 내 JSON 데이터
       ↓  main.tsx
       ├── window.__BUGSHOT_DATA__ 파싱
       ├── React 렌더 (App → NetworkLogContent / ConsoleLogContent)
       └── 다운로드 버튼 클릭 → Blob URL 생성 → 브라우저 다운로드
```

## 인터페이스 설계

### 데이터 주입 형태

```typescript
// src/sidepanel/lib/buildLogsHtml.ts (메인 빌드 영역)
interface LogViewerData {
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  har: object | null;
  consoleLogJson: object | null;
  meta: {
    version: string;
    createdAt: string;
    pageUrl: string;
  };
}

export function buildLogsHtml(
  networkLog: NetworkLog | null,
  consoleLog: ConsoleLog | null,
  pageUrl: string,
): string;
```

### i18n 대체 인터페이스

```typescript
// src/log-viewer/i18n.ts
import type { TranslationFn } from "@/i18n";

// 기존 useT()와 동일 시그니처 — 컴포넌트 수정 불필요
export function useT(): TranslationFn;
```

기존 `src/i18n/index.ts`의 `useT()`는 `useSettingsUiStore(s => s.locale)`에 의존. log viewer용 `useT()`는 `navigator.language`로 locale을 정적 감지하고, logs + app 네임스페이스의 로그 관련 키만 포함한 경량 사전 사용 (`debug.network.empty`, `debug.console.empty` 등 `app.ts` 네임스페이스 키도 포함 필수).

**타입 호환**: log viewer의 `useT()`는 원본 `@/i18n`의 `TranslationFn` 시그니처와 동일한 타입을 export해야 한다. `TranslationKey`는 원본 전체 키 union을 그대로 사용하되, 런타임 사전에는 로그 관련 키만 포함. 미등록 키 호출 시 키 문자열을 그대로 반환하는 fallback으로 타입 안전성과 빌드 호환을 모두 보장.

### App 컴포넌트

```typescript
// src/log-viewer/App.tsx
interface AppProps {
  data: LogViewerData;
}
```

상단 바 구성:
- 좌: "BugShot Logs" 타이틀 + 페이지 URL 표시 (`truncate` + hover 시 title 툴팁으로 전체 URL)
- 중: Network / Console 탭 (Tabs 컴포넌트)
- 우: 다크/라이트 토글 (2-state: 시스템 감지로 초기값 결정 + 수동 토글) + "Download HAR" + "Download JSON" 버튼

다운로드 버튼 상태: 데이터가 null인 쪽의 다운로드 버튼은 `disabled` 처리 (Network만 있으면 "Download JSON" disabled, 반대도 동일).

`flush` prop: 기존 컴포넌트의 `flush` prop은 `true`로 전달. 풀스크린 독립 앱이므로 외곽 border 없이 상단 바의 `border-b`가 구분선 역할.

## 풀스크린 레이아웃 적응

기존 컴포넌트는 ~400px 사이드패널에 최적화되어 있다. logs.html은 풀 브라우저에서 열리므로 다음 전략을 적용:

- **외곽 컨테이너**: `<div class="max-w-screen-xl mx-auto">` — 최대 1280px로 제한. 기존 컴포넌트의 레이아웃을 거의 수정 없이 적절한 폭으로 유지
- **NetworkLogContent 리스트 폭**: 기존 `defaultListWidth=260`은 패널용. logs.html의 `App.tsx`에서 `260` 그대로 사용 — max-width 컨테이너(1280px) 안에서 260:~1020 비율은 충분히 실용적
- 기존 컴포넌트에 prop 추가 없음. 외곽 컨테이너만으로 해결

## Dark Mode 활성화

logs.html `main.tsx`에서 시스템 테마를 감지하여 `<html>` 클래스를 설정:

```typescript
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.classList.toggle("dark", prefersDark);
```

수동 토글은 `App.tsx`의 Sun/Moon 아이콘 버튼이 `document.documentElement.classList.toggle("dark")`로 전환. `localStorage`에 저장하지 않음 — 매번 열리는 독립 파일이라 영속 불필요.

## 스코프 한정: element 모드

`buildCaptureFiles.ts`의 로그 첨부 블록은 `captureMode === "video" || "freeform" || "screenshot"` 조건 안에 있다. `element` 모드(diff 비교)에서는 로그를 첨부하지 않으며, 이번 변경에서도 이 동작을 유지한다.

## 빌드 파이프라인

### vite.log-viewer.config.ts

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: "src/log-viewer",
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "../../dist-log-viewer",
    emptyOutDir: true,
  },
});
```

### package.json 스크립트 변경

```json
{
  "build:log-viewer": "vite build --config vite.log-viewer.config.ts",
  "build": "pnpm build:log-viewer && tsc -b && vite build",
  "build:store": "pnpm build:log-viewer && BUGSHOT_STORE_BUILD=1 tsc -b && BUGSHOT_STORE_BUILD=1 vite build"
}
```

### 메인 빌드에서 template 임포트

```typescript
// src/sidepanel/lib/buildLogsHtml.ts (메인 빌드 영역)
import template from "../../../dist-log-viewer/index.html?raw";
```

Vite의 `?raw` 임포트는 파일을 문자열로 가져옴. TypeScript는 `vite/client` 타입에 `*.html?raw` 선언이 포함되어 있어 별도 타입 선언 불필요.

`dist-log-viewer/`는 `.gitignore`에 추가.

### tsconfig 고려사항

`tsconfig.app.json`의 `include: ["src"]`는 `src/log-viewer/` 내 파일도 포함. 단, log viewer 빌드 시 `@/i18n`의 `useT()`를 log viewer용으로 override하려면 **import path를 다르게** 해야 한다.

**접근**: `NetworkLogContent` 등 기존 컴포넌트가 `import { useT } from "@/i18n"` 하고 있으므로, log viewer 빌드에서는 Vite alias로 `@/i18n` → `src/log-viewer/i18n.ts`로 redirect:

```typescript
// vite.log-viewer.config.ts 의 resolve.alias
alias: {
  "@/i18n": path.resolve(__dirname, "./src/log-viewer/i18n.ts"),
  "@": path.resolve(__dirname, "./src"),
},
```

순서가 중요: `@/i18n`이 `@`보다 먼저 매칭되어야 한다.

`networkLogPath`는 `src/lib/network-log-path.ts`로 분리하여 log viewer/메인 빌드 양쪽에서 직접 import하므로, `buildIssueMarkdown` stub은 불필요. 단, `NetworkLogContent`의 다른 import가 log viewer 빌드에서 해결 불가능하면 추가 alias/stub 처리 (빌드 시 에러로 발견).

## 기존 패턴 준수

- **외과적 변경**: `buildCaptureFiles.ts`의 logs 블록만 교체. images/video 로직 미접촉
- **CaptureFile 인터페이스 유지**: `{ filename: string; dataUrl: string }` — 기존 플랫폼 submit 코드와 호환
- **i18n 동시 갱신**: ko/en 키 동시 수정 (PostToolUse 훅이 자동 검증)
- **테스트 우선**: `buildLogsHtml` 단위 테스트 + `buildCaptureFiles` 테스트 갱신

## 대안 검토

### Vanilla JS + 인라인 CSS (미채택)

별도 빌드 없이 `template.html`을 `?raw`로 직접 임포트. ~15KB 템플릿.

**미채택 이유**: UI 품질 저하. 기존 React 컴포넌트(2분할 리사이즈, Radix Tabs/Collapsible, JsonTreeViewer 재귀 렌더)를 vanilla JS로 재구현하면 동작/스타일 차이가 불가피. 유지보수 시 두 벌의 UI 코드를 동기화해야 함. React 번들 방식은 빌드 복잡성을 대가로 **컴포넌트 소스 하나**만 관리하면 됨.

## 위험 요소

1. **빌드 순서 의존성**: `pnpm build:log-viewer`가 실패하면 메인 빌드도 실패. CI에서 log viewer 빌드 캐시 필요 가능.
2. **Tailwind 클래스 누락**: log viewer 빌드의 Tailwind content 경로가 기존 컴포넌트를 포함해야 함. `content: ["./src/log-viewer/**/*.{ts,tsx}", "../sidepanel/components/{NetworkLogContent,ConsoleLogContent,JsonTreeViewer}.tsx", "../components/ui/**/*.tsx"]`처럼 명시 필요.
3. **`</script>` 이스케이프**: 네트워크 응답 body에 `</script>`가 포함되면 HTML 파싱이 깨짐. 구체 전략: `JSON.stringify(data).replace(/</g, "\\u003c")` — JSON 내 모든 `<`를 유니코드 이스케이프로 치환. `JSON.parse`는 `<`를 `<`로 복원하므로 데이터 무손실. XSS 방지도 겸함.
4. **alias 충돌**: `@/i18n` redirect가 log viewer 빌드에서만 적용되어야 함. 메인 빌드에 영향 없음 (별도 Vite config).
5. **컴포넌트 import chain**: `NetworkLogContent`가 `networkLogPath` (from `buildIssueMarkdown`)을 import → `networkLogPath`를 `src/lib/network-log-path.ts`로 분리하여 해결. 기타 불필요 import는 빌드 시 에러로 발견 후 alias/stub 처리.
6. **Pretendard 폰트**: 확장은 `pretendard` 패키지를 CSS import로 사용. logs.html에서는 폰트 파일을 인라인할 수 없으므로 system sans-serif 폴백.
