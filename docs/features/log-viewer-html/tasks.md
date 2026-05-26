# Self-Contained HTML Log Viewer — 구현 태스크

## 선행 조건

- [ ] `vite-plugin-singlefile` 설치: `pnpm add -D vite-plugin-singlefile`
- [ ] `.gitignore`에 `dist-log-viewer/` 추가

## 태스크

### Task 1: Log Viewer 빌드 파이프라인

- **변경 대상**: `vite.log-viewer.config.ts` (신규), `package.json`
- **작업 내용**:
  - `vite.log-viewer.config.ts` 작성: react 플러그인 + `viteSingleFile` 플러그인, root를 `src/log-viewer`, output을 `dist-log-viewer`, `@/` alias 설정. `@/i18n` → `src/log-viewer/i18n.ts` redirect alias 추가
  - `package.json` scripts에 `"build:log-viewer": "vite build --config vite.log-viewer.config.ts"` 추가
  - `build`를 `"pnpm build:log-viewer && tsc -b && vite build"`로 변경
  - `build:store`도 동일하게 선행 단계 추가
  - `.gitignore`에 `dist-log-viewer/` 추가
- **검증**:
  - [ ] `pnpm build:log-viewer` 실행 → `dist-log-viewer/index.html` 생성
  - [ ] index.html이 단일 파일 (외부 CSS/JS 참조 없음)

### Task 2: Log Viewer i18n 대체

- **변경 대상**: `src/log-viewer/i18n.ts` (신규)
- **작업 내용**:
  - `src/i18n/namespaces/logs.ts`에서 로그 관련 키만 추출하여 ko/en 사전 구성
  - `navigator.language.startsWith("ko")` 기반 locale 감지
  - `useT()` hook 구현 — 기존 `@/i18n`의 `TranslationFn` 시그니처와 동일
  - `TranslationKey` 타입도 로그 관련 키만 포함하는 로컬 타입으로 정의
- **검증**:
  - [ ] `useT()` 반환 함수가 `t("networkLog.search")` 등 호출 시 올바른 문자열 반환
  - [ ] ko/en 키가 동일 (기존 locales.test.ts와 같은 검증 로직 적용)

### Task 3: Log Viewer React 앱

- **변경 대상**: `src/log-viewer/index.html`, `main.tsx`, `App.tsx`, `styles.css` (모두 신규)
- **작업 내용**:
  - `index.html`: 최소 HTML 뼈대. `<div id="root">`, `<script type="module" src="./main.tsx">`
  - `styles.css`: `@tailwind base/components/utilities` + `globals.css`의 `:root`/`.dark` CSS 변수 복사 (Pretendard import 제외 — system sans-serif 폴백)
  - `main.tsx`:
    - `<script id="__BUGSHOT_DATA__" type="application/json">` 에서 데이터 파싱
    - 시스템 다크모드 감지 → `<html>` 클래스 설정
    - `<App data={parsedData} />` 렌더
  - `App.tsx`:
    - 상단 바: "BugShot Logs" + 페이지 URL + 테마 토글 (Sun/Moon 아이콘) + 다운로드 버튼 2개
    - `<Tabs>` 로 Network/Console 전환 — `data-[state=inactive]:hidden` 적용
    - Network 탭: `<NetworkLogContent requests={data.networkLog.requests} />`
    - Console 탭: `<ConsoleLogContent entries={data.consoleLog.entries} startedAt={data.consoleLog.startedAt} />`
    - 데이터가 null인 탭은 비활성화 (disabled + 빈 상태 메시지)
    - 다운로드: `data.har`/`data.consoleLogJson` → `JSON.stringify` → `Blob` → `URL.createObjectURL` → `<a download>` 트리거
- **검증**:
  - [ ] `pnpm build:log-viewer` 성공
  - [ ] 생성된 index.html을 브라우저에서 열면 빈 상태(데이터 없음) 렌더링
  - [ ] placeholder 데이터를 수동 주입 후 필터/검색/탭/다크모드 동작 확인

### Task 4: Log Viewer alias stub 처리

- **변경 대상**: `vite.log-viewer.config.ts`, `src/log-viewer/stubs/` (신규)
- **작업 내용**:
  - `NetworkLogContent.tsx`가 `import { networkLogPath } from "@/sidepanel/lib/buildIssueMarkdown"` 하고 있음
  - log viewer에서 이 import는 불필요하므로 stub 모듈 작성:
    ```typescript
    // src/log-viewer/stubs/buildIssueMarkdown.ts
    export const networkLogPath = "";
    ```
  - `vite.log-viewer.config.ts`의 alias에 해당 경로 redirect 추가
  - 기타 불필요 import가 있으면 동일하게 stub 처리 (빌드 시 에러로 발견)
- **검증**:
  - [ ] `pnpm build:log-viewer` 성공 (미사용 import로 인한 빌드 에러 없음)

### Task 5: buildLogsHtml 함수

- **변경 대상**: `src/log-viewer/buildLogsHtml.ts` (신규)
- **작업 내용**:
  - `import template from "../../dist-log-viewer/index.html?raw"` 로 빌드된 템플릿 임포트
  - `buildLogsHtml(networkLog, consoleLog)` 함수:
    - `buildHar(networkLog)` / `buildConsoleLogJson(consoleLog)`로 HAR/JSON pre-compute
    - `chrome.runtime.getManifest().version`으로 버전 추출
    - `LogViewerData` 객체 구성
    - `JSON.stringify(data).replace(/</g, "\\u003c")` 로 안전한 JSON 문자열 생성
    - template 내 placeholder를 데이터로 치환하여 최종 HTML 반환
  - placeholder 방식: template의 `<script id="__BUGSHOT_DATA__" type="application/json">` 태그 내용을 치환
- **검증**:
  - [ ] 단위 테스트: mock NetworkLog/ConsoleLog 입력 → 출력 HTML이 유효한 HTML5
  - [ ] 출력 HTML 내에 주입된 JSON 데이터가 `JSON.parse`로 정상 파싱

### Task 6: buildCaptureFiles 변경

- **변경 대상**: `src/sidepanel/lib/buildCaptureFiles.ts`
- **작업 내용**:
  - 기존 HAR/JSON 2파일 생성 블록 (라인 44-62) → `buildLogsHtml()` 호출로 교체:
    ```typescript
    if (input.networkLog || input.consoleLog) {
      const html = buildLogsHtml(input.networkLog ?? null, input.consoleLog ?? null);
      const htmlBlob = new Blob([html], { type: "text/html" });
      result.logs.push({
        filename: "logs.html",
        dataUrl: await blobToDataUrl(htmlBlob),
      });
    }
    ```
  - `buildHar`, `serializeHar`, `buildConsoleLogJson`, `serializeConsoleLog` import 제거 (buildLogsHtml 내부로 이동)
- **검증**:
  - [ ] 기존 테스트 `buildCaptureFiles.test.ts` 갱신 후 통과
  - [ ] 출력 `logs`에 `{ filename: "logs.html", dataUrl: "data:text/html;base64,..." }` 포함

### Task 7: 이슈 본문 파일명 참조 갱신

- **변경 대상**: 이슈 본문 빌더 + i18n
- **작업 내용**:
  - `src/i18n/namespaces/logs.ts`:
    - `logSummary.network.detail`의 `{filename}` 파라미터는 호출부에서 전달 → 호출부 변경으로 처리
    - `logSummary.console.detail`의 하드코딩 `console-log.json` → `logs.html`로 변경 (ko/en 동시)
  - `src/sidepanel/lib/buildIssueMarkdown.ts`: `filename: "network-log.har"` → `"logs.html"` (2곳)
  - `src/sidepanel/lib/buildIssueAdf.ts`: 동일 변경
  - `src/sidepanel/lib/buildLinearIssueBody.ts`: 동일 변경
  - 두 로그가 하나의 파일이 되었으므로, 본문에서 "network-log.har 참조"와 "console-log.json 참조"가 중복. 둘을 합쳐 "logs.html 참조" 한 줄로 통합하는 것이 자연스러움
- **검증**:
  - [ ] `pnpm test` 통과 (i18n key 대칭 검증 포함)
  - [ ] 이슈 본문에 `logs.html` 참조 문구 포함

### Task 8: 플랫폼 MIME 타입 처리

- **변경 대상**: 각 플랫폼 submit 파일의 `guessMime()` 함수
- **작업 내용**:
  - `guessMime()` 또는 MIME 판단 로직에 `.html` → `"text/html"` 분기 추가
  - 대상 파일 식별: `submitToGithub.ts`, `submitToLinear.ts`, `submitToNotion.ts`, `messages.ts`(Jira) 내 MIME 관련 코드 확인
- **검증**:
  - [ ] 각 플랫폼에서 logs.html이 `text/html` MIME으로 업로드됨
  - [ ] 수동 테스트로 4개 플랫폼 첨부 확인

### Task 9: 테스트 갱신 및 추가

- **변경 대상**: 테스트 파일들
- **작업 내용**:
  - `src/sidepanel/lib/__tests__/buildCaptureFiles.test.ts`:
    - 기대 파일명 `["network-log.har", "console-log.json"]` → `["logs.html"]`
    - 네트워크만/콘솔만/둘 다 있는 경우 각각 검증
  - `src/log-viewer/__tests__/buildLogsHtml.test.ts` (신규):
    - mock 데이터로 HTML 생성 검증
    - placeholder 치환 정상
    - `</script>` 이스케이프 검증
    - networkLog null / consoleLog null 케이스
  - `src/log-viewer/__tests__/i18n.test.ts` (신규):
    - ko/en 키 대칭 검증
- **검증**:
  - [ ] `pnpm test` 전체 통과

## 테스트 계획

### 단위 테스트
- `buildLogsHtml`: 데이터 주입 → 유효한 HTML, 이스케이프, null 케이스
- `buildCaptureFiles`: 파일명 `logs.html`, 네트워크만/콘솔만/둘 다 케이스
- log viewer i18n: ko/en 키 대칭, 파라미터 치환

### 수동 테스트 (Chrome에서)
- [ ] 이슈 작성 → 첨부 파일에 logs.html 1개만 표시
- [ ] logs.html 다운로드 → 브라우저에서 열기
- [ ] Network 탭: 리스트 표시, 필터 전환, URL 검색, 상세 패널(Headers/Request/Response), cURL 복사
- [ ] Console 탭: 항목 표시, 레벨 필터, 메시지 검색, 어코디언 펼침, 스택트레이스
- [ ] 탭 전환 정상
- [ ] 다크/라이트 토글 + 시스템 감지
- [ ] "Download HAR" → `network-log.har` 다운로드
- [ ] "Download JSON" → `console-log.json` 다운로드
- [ ] 네트워크만 있는 경우: Console 탭 비활성화
- [ ] 콘솔만 있는 경우: Network 탭 비활성화
- [ ] Jira/GitHub/Linear/Notion 각각 이슈 생성 시 logs.html 첨부 정상

## 구현 순서 권장

```
Task 1 (빌드 파이프라인)
   ↓
Task 2 (i18n 대체)  ─┐
Task 4 (alias stub) ─┤── 병렬 가능
                      ↓
Task 3 (React 앱)
   ↓
Task 5 (buildLogsHtml)
   ↓
Task 6 (buildCaptureFiles) ─┐
Task 7 (파일명 참조 갱신)   ─┤── 병렬 가능
Task 8 (MIME 타입)          ─┘
   ↓
Task 9 (테스트)
```

Task 1이 선행 필수. Task 2/4는 병렬. Task 3은 2/4 완료 후. Task 5는 3 완료 후. Task 6/7/8은 5 완료 후 병렬. Task 9는 전체 완료 후.
