# CLAUDE.md

bugshot-2: Chrome MV3 Side Panel 확장. 웹 페이지의 DOM 요소를 골라 스타일을 수정·비교한 후 Jira 이슈로 등록한다.

사용자는 한국어로 간결한 답변을 선호한다. 불필요한 꾸밈말·서두 금지.

## 스택

- React 18 + TypeScript + Vite (via `@crxjs/vite-plugin`)
- Tailwind CSS v3 + shadcn/ui (style `new-york`, base color `slate`)
- Zustand + `chrome.storage` (session/local 혼용)
- 아이콘: lucide-react, 폰트: Pretendard
- MV3 service worker + content script + side panel

## 명령어

| 용도 | 명령 |
|---|---|
| 개발 서버 | `pnpm dev` |
| 빌드 | `pnpm build` |
| 타입 체크만 | `pnpm typecheck` |

**빌드는 자동 실행하지 않는다.** 사용자가 명시적으로 요청하거나 `/build` 스킬을 실행할 때만 돌린다. 타입 확인이 필요하면 `pnpm typecheck` 선호.

## 디렉터리 구조

```
src/
├── background/      # service worker
│   ├── index.ts         # 메시지 라우터 + 전역 sidePanel 비활성화
│   ├── tab-bindings.ts  # 탭별 side panel on/off (활성화 셋 기반)
│   ├── jira-api.ts      # Jira REST 래퍼
│   └── messages.ts      # 메시지 핸들러 디스패치
├── content/
│   └── picker.ts        # DOM picker (Shadow DOM + @medv/finder + Port)
├── sidepanel/
│   ├── App.tsx          # Radix Tabs 4개 (이슈 작성/목록/설정/앱 설정)
│   ├── main.tsx
│   ├── capture.ts       # 요소 크롭 스냅샷
│   ├── picker-control.ts
│   ├── hooks/           # useBoundTabId, useEditorSessionSync, usePickerMessages, useThemeEffect
│   ├── components/      # 공통 UI (Section/PageShell/PageScroll/PageFooter 등)
│   ├── tabs/            # 탭별 진입점 (IssueTab/IssueListTab/SettingsTab/AppSettingsTab) + 편집 패널들
│   └── lib/             # buildIssueMarkdown 등 순수 유틸
├── store/               # Zustand 스토어 (editor/issues/settings/app-settings)
├── components/ui/       # shadcn 컴포넌트
├── content/
├── styles/
└── types/
docs/
├── PRD.md           # v1 스펙
└── design.md        # 톤앤매너
```

## 아키텍처 원칙

### Side Panel은 탭 스코프

ui-inspector 참고. **활성화한 탭에서만 side panel이 보이고, 탭을 이동하면 자동으로 닫힌다.** 돌아오면 다시 열린다.

구현:
- `chrome.storage.session`의 `sidePanel:activated` 키에 활성화된 tabId 셋을 저장
- `chrome.action.onClicked`에서 해당 탭을 셋에 추가하고 `sidePanel.setOptions({tabId, enabled:true, path:...?tabId=X})` + `sidePanel.open({tabId})`
- `chrome.tabs.onActivated` / `onUpdated`에서 각 탭이 활성화 셋에 있으면 enable, 없으면 disable
- **manifest의 `side_panel.default_path`가 전역 fallback을 제공하므로** `onInstalled`/`onStartup`에서 `chrome.sidePanel.setOptions({ enabled: false })`로 전역 비활성화 필수

### user gesture 보존

`chrome.sidePanel.open()`은 **user gesture 안에서만** 동작한다. `chrome.action.onClicked` 리스너에서:

```ts
// ❌ 잘못된 예: await 때문에 user gesture 소실
chrome.action.onClicked.addListener(async (tab) => {
  await setActivated(tab.id, true);
  await chrome.sidePanel.setOptions(...);
  await chrome.sidePanel.open({ tabId: tab.id }); // silently fails
});

// ✅ 올바른 예: open을 동기적으로 호출
chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null || !isSupportedUrl(tab.url)) return;
  void chrome.sidePanel.setOptions({ tabId: tab.id, path, enabled: true });
  void chrome.sidePanel.open({ tabId: tab.id });
  void setActivated(tab.id, true); // fire-and-forget
});
```

### 편집 세션 영속화

- tabId별로 `chrome.storage.session`의 `editor:${tabId}` 키에 저장
- `useEditorSessionSync(tabId)` 훅이 hydration + debounced save(300ms) 담당 (zustand persist 미들웨어 대신 직접 구현 — tabId-scoped 키가 persist의 "one store, one key" 모델에 맞지 않음)
- origin 변경 시 해당 탭의 세션은 버림 (`clearIfOriginChanged` in `tab-bindings.ts`)
- 탭 닫히면 `onRemoved`에서 정리

### 마크다운 복사 (Preview)

Jira는 마크다운 원본을 파싱하지 않고, 붙여넣기는 **ProseMirror가 HTML을 해석**한다. 그래서 `ClipboardItem`으로 `text/plain` + `text/html` **둘 다** 쓴다.

- `text/plain`: GFM 파이프 테이블 포함 MD (Slack/Gmail fallback)
- `text/html`: `<h1>/<h2>/<p>/<table>` — Jira·Notion·Confluence가 네이티브 테이블로 변환
- base64 이미지는 Jira가 sanitize하므로 클립보드 출력에서 **제외**

구현: `src/sidepanel/lib/buildIssueMarkdown.ts` — `buildIssueMarkdown()` + `buildIssueHtml()` 페어.

## 코드 컨벤션

- 스타일: `src/components/ui/` 이외에 주석 최소화. WHY가 비자명할 때만 한 줄.
- 경로: `@/` → `src/`
- Tailwind: shadcn CSS 변수 사용, 커스텀 색상 남발 금지
- 버튼 사이즈: shadcn 기본 + `xl` 추가 (`h-11 px-10 text-base`, CTA용)
- 탭 컨텐츠: `data-[state=inactive]:hidden` 필수 (비활성 탭 동시 렌더 버그 방지)

## 게이트웨이 (알아두면 유용)

- 매니페스트 `minimum_chrome_version: "116"` — sidePanel API 요구사항
- 지원 URL 스킴: `http:`, `https:`, `file:`만. 그 외에서는 side panel을 enable하지 않는다.
- 단축키: `Alt+Shift+B` (`_execute_action`)
- host_permissions: `https://*.atlassian.net/*` (Jira API용)

## 메모리 & 참고 문서

- `docs/PRD.md` — v1 스펙 (Phase A/B, 필드 정의, 단계별 UI 요구사항)
- `docs/design.md` — UI 톤앤매너
- 사용자 개인 메모리: `~/.claude/projects/-Users-sinhyeokkang-code-bugshot-2/memory/`에 있음 (머신 로컬, git에 안 올라감)
