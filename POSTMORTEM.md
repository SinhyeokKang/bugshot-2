# 회고 (Postmortems)

회귀·버그를 잡아 고칠 때마다 "왜 틀렸나 → 다음에 어떻게 막나"를 한 항목으로 남긴다. e2e 8회 루프 같은 자동 복구는 **그 자리에서** 문제를 메우지만, 같은 함정을 다음에 또 밟지 않으려면 사후분석이 코드 옆에 남아 있어야 한다. git에 커밋되는 이 파일이 그 정본이다.

작성은 `/postmortem` 스킬이 직전 픽스 컨텍스트로 자동 추가한다. 손으로 쓸 때도 아래 형식을 따른다.

## 작성 형식

각 항목은 최신순(위가 최신)으로 추가한다.

```
## YYYY-MM-DD — <한 줄 제목>

- **증상**: 사용자가 관측한 잘못된 동작.
- **근본 원인**: 코드상의 진짜 원인(표면 증상 말고).
- **재발 방지**: 다음에 같은 류를 막는 구체적 체크(grep 패턴·전수 대상·테스트).
- **관련**: 손댄 파일·핵심 함수.
```

자명한 것(git diff만 봐도 아는 것)은 빼고, **코드만 읽어선 안 보이는 구조적 함정·재발 패턴**만 남긴다.

---

## 2026-06-27 — cross-origin stylesheet면 스타일 섹션이 전부 접혀 "값 있는데 안 보임"

- **증상**: naver.com 로그인 버튼(`#account > div > a`)을 picker로 선택하면 BugShot 스타일 편집기에 클래스명만 보이고 스타일 섹션이 전부 비어 보였다. 개발자도구 Styles 패널에선 정상으로 보였다.
- **근본 원인**: 두 레이어가 겹쳤다. (1) 스타일 수집의 specified(author rule) 채널은 `sheet.cssRules` 접근 시 cross-origin이면 SecurityError, fetch도 cross-origin이면 skip(`css-source-cache.ts:fetchSheetText`) → naver는 CSS가 `pstatic.net`(페이지는 `naver.com`)이라 specified가 통째로 빈다. (2) `StyleEditorPanel.tsx`의 섹션 `defaultOpen`이 specified 채널에만 묶여 있어(`props.some(p => p in specifiedStyles)`), specified가 비면 **모든 섹션이 접힌 채 시작**. computed 값(getComputedStyle, cross-origin 무관)은 살아있어 수동으로 펼치면 보였다 — 그래서 "값은 있는데 안 보임". 표면 증상은 "스타일 수집 실패"인데 사용자 체감 원인은 UI 펼침 상태였다.
- **재발 방지**: cross-origin이면 비는 채널(specifiedStyles·propSources·var() 토큰 전개)에 UI 가시성/상태를 **단독으로** 묶지 말 것 — computed fallback을 함께 본다. `grep "specifiedStyles\|propSources"`로 그 채널에 의존하는 UI 분기를 점검. 단순 `specified || computed` OR는 금물(computed는 `INTERESTING_PROPS` 전부 항상 채워서 모든 섹션이 늘 펼쳐짐) → "specified 전무일 때만 computed fallback" 분기. e2e는 `127.0.0.1` 페이지 + `localhost` stylesheet로 cross-origin 재현(`style-cross-origin-section.spec.ts`, fixture 서버 `.css`는 `text/css`로 — text/html이면 strict MIME 거부).
- **관련**: `src/sidepanel/lib/sectionDefaultOpen.ts`(신규 순수함수), `src/sidepanel/tabs/StyleEditorPanel.tsx`(`sectionOpen`), `src/content/css-source-cache.ts:fetchSheetText`(cross-origin skip 지점), `e2e/style-cross-origin-section.spec.ts`.

---

## 2026-06-25 — video + action-only일 때 logs.html이 본문에서 누락

- **증상**: 녹화(video) 모드에서 콘솔/네트워크 로그 없이 **액션 로그만** 있을 때, logs.html이 이슈에 첨부되지 않는 것처럼 보였다.
- **근본 원인**: `MarkdownContext`에 액션 로그 요약 필드가 아예 없었다. 이슈 본문 빌더 8개(`emitLogSummary*`)가 전부 `if (!net && !con) return`으로 로그 요약 섹션을 게이트해, 액션만 있으면 섹션을 통째로 스킵했다. `buildCaptureFiles`는 logs.html을 정상 생성·업로드했지만 본문이 참조(href/링크 노드)를 안 넣어 첨부가 고아가 됐다(GitLab/GitHub는 링크 누락, Jira ADF는 `injectLogsLink`가 붙을 노드 자체가 없음).
- **재발 방지**: 로그/미디어 종류를 본문에 노출·변경할 땐 `grep "emitLogSummary"`로 **8개 빌더**(buildIssueMarkdown md/html · buildIssueAdf · linear/github/gitlab/asana/notion)와 ctx 생성 **4곳**(buildMarkdownContext 헬퍼 · buildEditorMarkdownContext · PreviewPanel · DraftDetailDialog)을 전수 확인한다. 빌더 한 곳만 고치면 나머지 7곳이 조용히 빠진다. 빌더별 회귀 테스트 필수.
- **관련**: `src/sidepanel/lib/buildIssueMarkdown.ts`(`MarkdownContext.actionLogCaptured`), `buildMarkdownContext.ts`, `buildEditorCapture.ts`, 6개 플랫폼 body 빌더, `src/i18n/namespaces/logs.ts`(`logSummary.action.line`).
