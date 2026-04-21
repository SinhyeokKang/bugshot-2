# Bugshot-2 PRD v0.3

스펙 정의서. UX 플로우와 기능/통합/기술 제약만 나열.

> **v0.3 스코프**: 단일 요소 = 단일 이슈. 5단계 선형 플로우. Tailwind + 일반 CSS 병행 편집. 출력은 Jira 이슈 생성 또는 마크다운 추출(클립보드).

## 1. UX 플로우

### 1.1 초기 설정 (최초 1회)
1. Side Panel 열기 → **설정** 탭
2. Jira `baseUrl` / `email` / `API token` 입력 → **[검증]** 버튼
3. `GET /rest/api/3/myself` 성공 시 저장 (chrome.storage.local)
4. **프로젝트 선택** (전역 1개). 프로젝트 목록은 저장 직후 로드

### 1.2 이슈 등록 (메인 플로우)
선형 5단계. 단계 간 **[← 뒤로]** 버튼으로 이전 단계 수정 가능.

**[1] DOM 선택**
- [요소 선택 시작] → Background가 picker content script를 현재 탭에 on-demand 주입
- 호버로 요소 하이라이트, 클릭으로 선택 (ESC로 취소)

**[2] Style 수정**
- Tailwind 클래스명 편집 + 일반 CSS(property/value) 편집 **병행**
- 타이핑 즉시 페이지에 반영 (To-Be 실시간 확인)
- As-Is는 `getComputedStyle` 스냅샷으로 자동 기록

**[3] 이슈 작성**
- 시스템이 **제목 / 본문 자동 초안** 생성 (템플릿 기반, §2.5)
- 사용자가 초안을 편집 가능 (제목/본문 둘 다 editable)

**[4] 프리뷰**
- 본문 read-only (수정은 3단계로 [← 뒤로])
- **Jira 필드 섹션** (접힘/펼침):
  - 이슈 타입 *, 담당자 *, 우선순위 * (이전 이슈의 마지막 선택값 채움)
  - 부모 에픽 (opt, `parent`), 연결 에픽 (opt, 단일, Issue Link `Relates`)
- CTA 3개:
  - [Jira로 생성]
  - [마크다운 추출] (클립보드 복사)
  - [마크다운 추출 + Jira 생성]
- **Jira 미설정 시**: [Jira로 생성] / [마크다운 추출 + Jira 생성] disabled + 툴팁 "설정 탭에서 Jira를 먼저 연결하세요" + 설정 탭 바로가기 링크. [마크다운 추출]은 항상 활성

**[5] 완료 다이얼로그**
- Jira 생성: 이슈 키 + 브라우저에서 이슈 열기 링크
- 마크다운 추출: "클립보드에 복사됨" 토스트 + 본문 프리뷰 재확인
- [새 이슈 작성] 버튼 → [1]로 리셋

### 1.3 편집 세션 라이프사이클
- Side Panel 로컬 상태(Zustand in-memory). 영속화 ❌ — 탭 닫히면 소멸
- 상태 단계: `idle` → `picking` → `editing` → `drafting` → `previewing` → `submitting` → `done`
- 같은 origin 내 이동 / 새로고침: 편집 중 상태 유지 (선택 요소 selector는 재검증 안 함)
- 다른 origin으로 navigation: 편집 중이면 "편집 중인 내용이 사라집니다. 계속?" 확인, 이후 `idle`로 리셋
- 탭 닫힘 / 브라우저 재시작: 세션 소멸

---

## 2. 기능 스펙

### 2.1 화면 (Side Panel)
상단 Tabs 2개.

**탭 1: 이슈 작성**
- 편집 세션 상태에 따라 단계별 화면 전환 (1→2→3→4→5)
- 각 단계에 [← 뒤로] 버튼 (단계 1 제외)

**탭 2: 설정**
- **Jira 연결**: baseUrl / email / apiToken / [검증]
- **프로젝트**: 검증 후 프로젝트 드롭다운 (전역 1개)
- 담당자/우선순위 기본값 ❌ — 이슈별 마지막 선택값으로만 관리 (설정 탭엔 노출 안 함)

### 2.2 요소 선택 (picker)
- on-demand 주입 (`chrome.scripting.executeScript`, `activeTab` + `scripting`)
- **오버레이 렌더링**: picker가 페이지에 생성하는 하이라이트/툴팁은 **Shadow DOM**(`attachShadow({ mode: "open" })`) 내부에만. `:host { all: initial !important }`로 페이지 CSS 오염 방지, 내부 스타일도 외부 영향 차단
- 호버: 경계 오버레이 + 태그/클래스 툴팁
- ESC: 취소, 클릭: 선택 확정
- 선택 시 패널로 전달: `{ selector, tagName, className, rect, computedStyle 스냅샷 }`
- Selector 생성: [`@medv/finder`](https://github.com/antonmedv/finder) (DevTools cssPath 수준 + `id`/`data-testid` 자동 우선)
- **메시징**: picker 세션은 `chrome.runtime.onConnect`/`connect` 장수명 Port. 선택 이벤트 Port 스트리밍, ESC/세션 종료 시 Port disconnect로 자동 cleanup. 단발성 요청(`captureVisibleTab` 등)은 `sendMessage`
- 선택 확정 직후 picker cleanup (Shadow DOM 제거, Port disconnect)
- **DOM 동적 변경 추적 out-of-scope**: selector는 선택 시점에만 유효성 확인. 이후 DOM 변경/재렌더링은 추적 안 함

### 2.3 편집 세션 스키마
```ts
IssueDraft {
  tabId: number
  pageUrl: string
  pageTitle: string

  // 선택된 요소
  selector: string
  tagName: string
  classNameBefore: string     // 선택 시점의 element.className

  // 수정 내용
  classNameAfter: string      // 편집된 className (Tailwind 포함)
  cssChanges: CssChange[]     // inline style로 주입한 CSS 속성

  // 첨부
  screenshotDataUrl: string   // viewport PNG (제출 직전 캡처)

  // 이슈 내용 (자동 초안 → 사용자 편집)
  summary: string             // ≤255자 (Jira 제목 제한)
  body: string                // 마크다운 원문 (ADF 변환은 제출 시)

  // Jira 필드 (프리뷰에서 선택)
  issueType: string           // 필수
  assigneeAccountId: string   // 필수
  priorityName: string        // 필수
  parentEpicKey?: string      // 옵셔널
  relatedEpicKey?: string     // 옵셔널, 단일

  createdAt: number
}
CssChange { property: string; asIs: string; toBe: string; important: boolean }
```
- 저장: Zustand in-memory만 (영속화 ❌)
- **이슈별 필드 기억값**은 `chrome.storage.local`에 따로 (`lastIssueType` / `lastAssignee` / `lastPriority`)

### 2.4 Jira 필드 섹션 (프리뷰 내부)
- **이슈 타입** (필수): 프로젝트의 이슈 타입 목록에서 선택. 마지막 사용값 pre-filled
- **담당자** (필수): `/user/assignable/search?project={key}&query=`로 debounce 검색. 마지막 사용값 pre-filled
- **우선순위** (필수): `/priority` 목록. 마지막 사용값 pre-filled
- **부모 에픽** (opt): 프로젝트의 Epic 검색 Combobox (`jql=project={key} AND issuetype=Epic`)
- **연결 에픽** (opt): 동일 방식, 단일 선택, Issue Link type `Relates`로 생성 후 연결

### 2.5 이슈 본문 템플릿 (확정)

**제목 기본값** (자동 초안, 편집 가능):
```
[디자인 QA] {pageTitle} — {tagName} 스타일 수정
```

**본문 구조** — 5개 블록 고정:

```markdown
## [Issue Summary]
{제목과 동일한 한 줄 요약. 자동 생성}

## [Context]
{자동 초안: 선택한 요소(`{selector}`, {tagName})의 스타일을 수정합니다. — 사용자 편집 가능}

Page: {pageUrl}
Captured: {localized timestamp}

## [CSS Changes] ({count})
### className
- **As-Is**: `{classNameBefore}`
- **To-Be**: `{classNameAfter}`

### properties
| 속성 | As-Is | To-Be | !important |
|---|---|---|---|
| color | #000 | #333 |  |
| border-radius | 4px | 999px | ✓ |

## [Expected Result]
{빈 칸 — 사용자가 수정 의도/요청사항 서술}

## [Media]
![screenshot](data:image/png;base64,...)
```

**편집 가능성**
- `[Issue Summary]`: 제목과 연동, 사용자 편집
- `[Context]` 첫 문단: 사용자 편집 가능 (Page/Captured 라인은 자동 유지)
- `[CSS Changes]` 전체: read-only (자동 생성 결과)
- `[Expected Result]`: 사용자 서술 영역 (핵심)
- `[Media]`: read-only

**편집 UI (3단계)**
- 제목 Input + Context Textarea + Expected Result Textarea 각각 노출
- CSS Changes / Media는 프리뷰 형태로만 표시

**저장 형식**: 마크다운 원문 보관 → Jira 전송 시 ADF로 변환, 마크다운 추출 시 원문 그대로

### 2.6 마크다운 추출
- **출력**: 클립보드 복사 (`navigator.clipboard.writeText`)
- **스크린샷 포함**: base64 data URI 인라인 (`![](data:image/png;base64,...)`)
- **문법**: GFM (GitHub-flavored Markdown)
- 사용 후 토스트 "클립보드에 복사됨"
- "마크다운 추출 + Jira 생성" 옵션: 마크다운 클립보드 복사 → 바로 Jira 생성 진행

---

## 3. Jira 통합 스펙

### 3.1 대상
- **Jira Cloud 전용** (v1). DC/Server는 v1 미지원
- baseUrl: `https://{workspace}.atlassian.net`

### 3.2 인증
- Basic Auth: `Authorization: Basic base64("{email}:{apiToken}")`
- 저장: `chrome.storage.local.jiraConfig` (sync ❌ — 기기 간 토큰 동기화 회피)
- UI는 토큰 마스킹 + "교체" 패턴 (원문 재표시 없음)
- 모든 API 호출은 background service worker에서 수행

### 3.3 엔드포인트
| 용도 | 메서드 + 경로 |
|---|---|
| 자격증명 검증 | `GET /rest/api/3/myself` |
| 프로젝트 목록 | `GET /rest/api/3/project/search` |
| 이슈 타입 / 필드 메타 | `GET /rest/api/3/project/{key}` |
| 담당자 검색 | `GET /rest/api/3/user/assignable/search?project={key}&query=` |
| 우선순위 | `GET /rest/api/3/priority` |
| Epic 검색 | `GET /rest/api/3/search?jql=project={key} AND issuetype=Epic&fields=summary` |
| Issue Link 타입 목록 | `GET /rest/api/3/issueLinkType` (Relates 찾기 위함, 캐시) |
| 이슈 생성 | `POST /rest/api/3/issue` |
| Issue Link 생성 | `POST /rest/api/3/issueLink` (이슈 생성 후 2단계) |
| 첨부 업로드 | `POST /rest/api/3/issue/{idOrKey}/attachments` (multipart, `X-Atlassian-Token: no-check`) |

### 3.4 필드 매핑
- 필수: `project.key`, `issuetype.name`, `summary`, `description(ADF)`, `assignee.accountId`, `priority.name`
- 옵셔널: `parent.key` (부모 에픽)
- 2단계: 이슈 생성 후 연결 에픽이 있으면 `POST /issueLink` 로 Relates 생성

### 3.5 제출 시퀀스
1. 마크다운 본문 → ADF 변환
2. `POST /issue` with 필수+옵셔널 필드 + ADF + summary
3. 성공 응답 이슈 키 획득
4. 스크린샷 첨부: `POST /issue/{key}/attachments`
5. 연결 에픽 있으면: `POST /issueLink`
6. 성공 시 완료 다이얼로그 표시

### 3.6 에러 처리
- `401/403`: 토큰 재입력 안내
- `429 / 5xx`: 지수 백오프 (3회, base 1s)
- 이슈 생성 성공 + 첨부 실패: 이슈 유지, UI에 부분 성공 + 첨부만 재시도 버튼
- 이슈 생성 성공 + 링크 실패: 이슈 유지, 부분 성공 + 링크만 재시도 버튼

---

## 4. 스타일 편집 스펙

### 4.1 입력 모드 (병행)
- **className 에디터**: `element.className` 원문을 텍스트 에디터에 노출, 사용자가 Tailwind 클래스 추가/삭제/수정. 변경 즉시 `element.className = newValue`로 반영
  - 입력한 클래스가 페이지 CSS에 없으면 (JIT 미생성) 시각 반영 안 됨 → ⚠ 배지로 안내, 이슈에는 문자열로 기록
- **CSS 에디터**: 멀티라인 `property: value;` 페어. 파싱해서 `CssChange[]`로 인코딩, inline `element.style`에 주입
- 두 입력은 서로 독립적. 둘 다 이슈에 기록

### 4.2 To-Be 즉시 반영
- className 변경: `element.className = value`
- CSS 변경: `element.style.setProperty(prop, value, important ? 'important' : '')`
- 디바운스 없이 입력 즉시 (성능 이슈 발생 시 조정)

### 4.3 As-Is 캡처
- 선택 즉시 `getComputedStyle` 스냅샷 저장
- `className`은 `element.className` 원문 저장 (class 문자열 diff용)
- 원본 inline style 문자열도 별도 보관 (되돌리기용)

### 4.4 `!important`
- CSS 편집에서만 해당, 속성별 토글
- ADF 표 및 마크다운 표에 표시

### 4.5 변경 취소
- 제출 전: **[초기화]** → className 원복 + inline style 원복
- 제출 후: 페이지 새로고침 시 자연 원복 (Bugshot이 cleanup 보장 ❌)

---

## 5. 주석/설명

v0.3에선 별도 "주석" 필드 ❌ — 이슈 본문 자동 초안을 사용자가 편집하는 방식으로 흡수.

---

## 6. 기술 제약

### 6.1 Manifest v3 / 권한
- `permissions`: `sidePanel`, `activeTab`, `scripting`, `storage`, `commands`
- `host_permissions`: `https://*.atlassian.net/*` (Cloud 한정)
- 클립보드 쓰기: Side Panel 내 사용자 클릭 컨텍스트에서 `navigator.clipboard.writeText()` 사용 (별도 `clipboardWrite` 권한 불필요)
- 상시 `content_scripts` 없음 — picker만 `chrome.scripting.executeScript`로 on-demand 주입

### 6.2 Chrome 최소 버전
- **116+** (Side Panel API 안정)

### 6.3 단축키
- `Alt+Shift+B`: Side Panel 토글 (`_execute_action`)

### 6.4 i18n
- `default_locale: ko`
- `_locales/ko/messages.json` 우선 (manifest 레벨만). UI 내부 텍스트는 v1에서 하드코딩 한국어 허용

### 6.5 스크린샷
- `chrome.tabs.captureVisibleTab` — 뷰포트만, PNG, 원본 해상도
- 이슈당 1장 (프리뷰 진입 또는 제출 직전 To-Be 상태 캡처)
- 전체 페이지 스크롤 스티칭은 out-of-scope

### 6.6 Side Panel 동작
- 액션 아이콘 클릭 또는 `Alt+Shift+B` → 현재 창에 Side Panel 오픈
- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
- **탭 바인딩**: background에서 `chrome.tabs.onActivated` / `onUpdated` 수신해 각 탭에 `chrome.sidePanel.setOptions({ tabId, path: "src/sidepanel/index.html?tabId=" + id, enabled: true })` 호출. 패널 HTML은 로드 시 `URL.searchParams.get("tabId")`로 소속 탭 식별
- **Origin 변경 처리**: Side Panel이 자신의 탭 `chrome.tabs.onUpdated`를 직접 구독. `editing`/`drafting`/`previewing` 상태일 때만 경고, `idle`은 무조건 리셋

### 6.7 지원 URL 스킴
- 지원: `http://`, `https://`, `file://`
- 미지원: `chrome://`, `chrome-extension://`, `about:`, Chrome 내장 PDF 뷰어, 웹스토어 페이지 등
- 처리: background의 `tabs.onActivated` / `onUpdated` 핸들러에서 tab URL 스킴 체크 → 미지원 시 `chrome.sidePanel.setOptions({ tabId, enabled: false })`
- 안전장치: 패널이 이미 열린 상태에서 미지원 URL로 이동 시 패널 내부에 "이 페이지는 지원하지 않습니다" 폴백 화면

### 6.8 스토리지 레이어
| 데이터 | 위치 | 수명 |
|---|---|---|
| `jiraConfig` (baseUrl/email/token) | `chrome.storage.local` | 영구 |
| 전역 프로젝트 (projectKey) | `chrome.storage.local` | 영구 |
| 이슈 필드 마지막값 (issueType/assignee/priority) | `chrome.storage.local` | 영구 |
| 편집 세션 (IssueDraft) | Zustand in-memory | Side Panel 인스턴스 수명 |

---

## 7. Out-of-scope (v1 미포함, 추후 검토 가능)
- **배치(cart) 작성** — 여러 요소를 한 이슈에 묶음 (v2 우선 후보)
- 편집 세션 영속화 (origin/탭 재방문 시 복원)
- 액션 아이콘 뱃지 표시
- 스크린샷 위 주석(그리기/화살표/블러)
- DC/Server 지원, 다중 Jira 인스턴스
- 전체 페이지 캡처, 화면 녹화
- GitHub / Linear / Notion 등 다른 트래커 연동
- 이슈 업데이트/댓글 기능 (v1은 신규 생성만)
- 팀 단위 설정 공유 (sync 스토리지)
- Jira 필드 확장: `components`, `fixVersions`, `sprint`, `reporter`, labels, 커스텀 필드
- Tailwind Play CDN 주입으로 JIT 런타임 지원
- 마크다운 추출 시 이미지 별도 파일 + .zip
