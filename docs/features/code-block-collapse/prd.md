# 코드블럭 접기/펼치기 (Linear 스타일)

## 배경

`/feature symptom-log-attach`로 들어온 로그 삽입 기능이 배포된 뒤, 본문에 삽입한 네트워크 응답 하나가 사이드패널 한 화면을 통째로 먹는 상황이 생겼다. `logToCodeBlock.ts`의 상한이 `MAX_CHARS = 16384`라 최대 16KB짜리 JSON이 한 코드블럭에 들어갈 수 있고, `pre`에 높이 제한이 없어 그대로 다 그려진다. 그 결과:

- drafting 에디터에서 코드블럭 아래 문단으로 가려면 한참 스크롤해야 한다.
- preview에서 "재현 절차 → 로그 → 기대 결과" 같은 섹션 구조가 로그에 파묻혀 한눈에 안 들어온다.

로그는 **증거**지 본문의 주인공이 아니다. 기본은 접혀 있고 필요할 때 펼치는 게 맞다. Linear의 코드블럭이 정확히 이 모델이고(레퍼런스 스크린샷), 사용자가 이미 익숙한 관용구다.

## 목표

- 16줄 이상인 코드블럭은 기본적으로 **15줄 높이로 접혀서** 렌더된다. 접힌 블럭 하단은 페이드 처리돼 "잘렸다"가 시각적으로 드러난다.
- 코드블럭에 hover하면 하단 중앙에 pill 버튼이 뜬다. 접힘 상태엔 `펼치기 (38줄)` / `Expand (38 lines)`, 펼침 상태엔 `접기` / `Collapse`. 숫자는 **블럭의 전체 줄 수**다.
- pill 클릭으로 그 블럭만 펼쳐지고, 다시 클릭하면 접힌다.
- **코드블럭을 렌더하는 5개 표면 전부**에서 동작한다. 같은 임계값·같은 라벨·같은 모양을 쓴다.

  | 표면 | 부착 |
  |---|---|
  | `DraftingPanel`의 tiptap 에디터 | NodeView |
  | `DraftEditDialog`의 tiptap 에디터 (섹션 연필 버튼) | NodeView (같은 `TiptapEditor.tsx`라 자동) |
  | `PreviewPanel` (사이드패널 preview) | `useCodeCollapse` |
  | `DraftDetailDialog`의 `DocSectionBody` | `useCodeCollapse` |
  | `log-viewer/App`의 Report 탭 (logs.html) | `useCodeCollapse` |

  > log-viewer는 풀 브라우저 폭·높이라 "한 화면을 먹는다"는 동기가 약하지만, `IssuePreviewView`를 공유하므로 **제외하는 쪽이 오히려 분기 코드를 요구한다** → 같은 임계값 15로 포함. 단 log-viewer는 탭이 `data-[state=inactive]:hidden`이라 언마운트되지 않아 **접힘 상태가 탭을 옮겨도 유지된다**(사이드패널은 phase 전환 시 언마운트되어 리셋). 같은 컴포넌트의 의도된 수명 차이다.
- 접기는 **순수 표시 상태**다. `getMarkdown()` 결과, 클립보드 복사 본문, 8개 트래커로 나가는 이슈 본문은 이 기능 도입 전후로 바이트 단위 동일하다.
- 키보드로도 도달·조작 가능하다(pill이 hover 전엔 투명하지만 `:focus-visible`이면 나타난다).

## 비목표 (Non-goals)

- **접힘 상태 영속화 안 함.** `chrome.storage`·draft에 아무것도 저장하지 않는다. 새로고침·탭 전환·에디터 재마운트하면 전부 접힌 초기 상태로 돌아간다. 원 PRD(`symptom-log-attach`)의 비목표 "영속 상태를 만들지 않는다"를 그대로 승계한다.
- **"로그 코드블럭만" 선별 안 함.** 아래 "결정된 전제" 참조 — 모든 코드블럭에 같은 규칙이 적용된다.
- **임계값 사용자 설정 안 함.** 15줄 고정.
- **트래커 본문에서의 접기 안 함.** Jira·Linear 등에 등록된 이슈가 어떻게 렌더되는지는 우리 손 밖이다.
- **접기 애니메이션(height transition) 안 함.** opacity transition만.
- **성능 개선이 아니다.** 접기는 `max-height` + `overflow-y: hidden`일 뿐 DOM은 전부 그려진다. 배경의 "한 화면을 통째로 먹는다"는 **시각·탐색 문제**지 렌더 비용 문제가 아니다. 이 기능으로 에디터가 빨라지길 기대하지 않는다.
- **가로 스크롤은 접힘 상태에서도 유지한다**(기존 `overflow-x: auto` 보존). `overflow: hidden` shorthand를 쓰면 기존 규칙을 덮어 긴 줄을 못 읽게 되므로 `overflow-y: hidden`으로 세로만 자른다. `logToCodeBlock`의 `truncate()`가 non-JSON body를 **한 줄 16KB**로 내므로 이 구분이 실재하는 케이스다.

## 결정된 전제 (코드 조사로 확정 — 설계 선택지가 아님)

### 1. `renderMarkdown`을 건드리면 트래커 본문이 오염된다

`sidepanel/lib/renderMarkdown.ts`는 preview 전용이 아니다. `buildIssueMarkdown.ts:319`의 `buildIssueHtml()`이 같은 함수를 호출하고(`:403`이 그 내부의 `renderMarkdown(content)` 호출), 그 HTML이 두 갈래로 나간다:

- `PreviewPanel.tsx:355` → **클립보드 HTML 복사** (사용자가 트래커에 직접 붙여넣는 본문)
- `buildReportData.ts:66` → logs.html 리포트의 `report.html`

따라서 접기 마크업(wrapper·pill·fade)을 `renderMarkdown` 출력에 넣으면 **붙여넣기 본문에 "펼치기 (38줄)" 버튼이 딸려 들어간다.** → 접기는 renderMarkdown 바깥, **렌더된 DOM 위에서만** 붙인다.

### 2. "로그 코드블럭만" 타게팅은 불가능하다

`logToCodeBlock.ts`의 `serializeConsoleEntry()`는 language를 안 붙인다(콘솔 로그 = 언어 없는 ` ``` ` fence). `serializeNetworkRequest()`도 body가 JSON일 때만 `json`을 단다. 즉 삽입된 로그의 절반은 사용자가 손으로 친 코드블럭과 마크다운상 **완전히 동일**하다. 구분 표식을 넣으려면 마크다운이 바뀌고, 그건 전제 1에 걸려 트래커로 샌다.

→ **모든 코드블럭 공통 규칙.** 실질적으로 16줄을 넘기는 코드블럭은 삽입된 로그가 거의 전부라 체감 차이가 없고, 사용자가 손으로 넣은 긴 코드블럭도 접히는 게 오히려 일관적이다.

### 3. `pre`는 줄바꿈이 없어서 "줄 수 = 화면 높이"가 정확히 성립한다

`doc-section-body.css:81`·`tiptap-editor.css:103`의 `pre`는 `overflow-x: auto`에 `white-space` 재정의가 없다 → 기본값 `white-space: pre` → **줄바꿈이 일어나지 않는다.** 논리 줄 1개 = 화면 줄 1개다.

> ⚠ 이 전제는 **`prosemirror.css`를 로드하지 않는다**는 사실에 의존한다. `prosemirror-view/style/prosemirror.css:14-15`가 `.ProseMirror pre { white-space: pre-wrap; }`인데, `grep -rn "prosemirror.css" src/` → 0건이라 현재는 안 걸린다. 누군가 PM의 콘솔 경고를 없애려고 이 CSS를 import하는 순간 **에디터의 접기 높이가 줄 수와 조용히 분리된다.** 리팩터 시 이 의존을 기억할 것.

→ 접기 판정을 `scrollHeight` 같은 **레이아웃 측정 없이 텍스트의 `\n` 개수만으로** 할 수 있다. 이건 단순한 구현 편의가 아니라 **테스트 가능성의 문제**다: jsdom은 `scrollHeight`를 항상 0으로 준다. 줄 수 기반이면 판정 로직이 순수 함수가 되고(node 트랙), 접힘/펼침 전이가 jsdom 렌더 테스트로 잡힌다(tsx 트랙). px 측정으로 갔다면 둘 다 못 잡고 수동 검증만 남는다. POSTMORTEM 2026-07-14·2026-07-04가 반복해서 경고하는 "단위 테스트 전부 green인데 화면만 틀린" 부류를 구조적으로 회피한다.

## 사용자 시나리오

### A. 긴 네트워크 로그를 본문에 삽입 → preview 확인

1. drafting의 `설명` 섹션 헤더에서 `FileCode` 버튼을 눌러 `LogInsertDialog`를 열고, network 탭에서 40줄짜리 JSON 응답을 골라 삽입한다. (로그 탭에는 삽입 진입점이 없다 — `DraftingPanel.tsx:749-765, 781-789`가 유일한 경로다.)
2. drafting 에디터에서 그 코드블럭은 15줄 높이로 접혀 있고, 하단이 페이드로 흐려진다.
3. 블럭에 마우스를 올리면 하단 중앙에 `펼치기 (41줄)` pill이 뜬다.
4. 클릭 → 블럭이 전체 높이로 펼쳐지고 페이드가 사라진다. hover하면 pill이 `접기`로 바뀌어 있다.
5. preview 단계로 넘어가면 같은 블럭이 **다시 접힌 상태**로 보인다(접힘은 표면별 ephemeral 상태 — 비목표 참조). 여기서도 hover → pill → 펼침이 동일하게 동작한다.
6. `마크다운 복사`를 누르면 클립보드 본문에 접기 흔적이 전혀 없다.

> A-5는 탭 전환이 아니라 **phase 전환**이다. `IssueTab.tsx:211/232`가 `drafting`/`previewing`을 상호배타 early return으로 갈라 DraftingPanel을 통째로 언마운트한다. 전환 트리거도 명시적 버튼 2개뿐이다(`DraftingPanel.tsx:463` → `confirmDraft()` / `PreviewPanel.tsx:403` → `backToDraft()`). 즉 리셋 시점이 "다른 화면으로 갔다 왔다"는 사용자 인지와 정확히 일치한다. 접힘 비영속은 튀는 결정이 아니라 **형제 UI와 동일**하다 — `Section.tsx:67`(섹션 접힘)·`JsonTreeViewer.tsx:68`(JSON 트리)·모든 origin/레벨 필터가 이미 `useState` ephemeral이고, `settings-ui-store.ts`의 영속 대상은 preference뿐이다.

### B. 접힌 블럭을 편집

1. 접힌 코드블럭 안쪽을 클릭해 커서를 놓는다.
2. 블럭이 **자동으로 전체 높이로 펼쳐지고**, 페이드와 pill이 사라진다 — 편집 중엔 방해물이 없다.
3. 커서를 블럭 밖으로 옮기면 **펼친 상태가 유지된다.** pill이 `접기`로 다시 나타나고, 접고 싶으면 사용자가 누른다.

> **왜 자동 펼침이 필수인가**: 없으면 커서가 40번째 줄에 있는데 블럭은 15줄만 보이는 상태가 만들어진다. 타이핑은 되는데 결과가 안 보인다. 선례가 이미 이 판단을 내렸다 — `DraftingPanel.tsx:754-757`이 로그 삽입 전에 접힌 섹션을 펼친다.
>
> **왜 이탈 시 재접힘이 아닌가**: 40줄 블럭이 15줄로 도로 접히면 아래 본문이 25줄만큼 위로 점프한다. 저장소 관용구도 반대다 — `JsonTreeViewer.tsx:72`가 `// 이후 사용자 collapse는 존중(강제 재펼침 안 함)`을 명시한다. **커서 진입은 펼침을 승격시키고, 되돌리지 않는다.** 사용자 의도(펼쳐둠)를 시스템이 뒤집지 않는다는 원칙의 귀결이다.

### C. 짧은 코드블럭

- 15줄 이하면 접히지 않는다. hover해도 pill이 안 뜨고 페이드도 없다. 기존 렌더와 완전히 동일하다.

### D. 엣지 케이스

| 상황 | 기대 동작 |
|---|---|
| 정확히 15줄 | 안 접힘 |
| 정확히 16줄 | 접힘 (15줄 + 16번째 줄 절반이 보이고 페이드) |
| 펼친 상태에서 내용이 15줄 이하로 줄어듦(에디터) | `data-collapsible=false`로 바뀌며 pill·페이드 사라짐 |
| 접힌 상태에서 내용이 16줄 이상으로 늘어남(에디터) | pill 라벨의 줄 수가 즉시 갱신됨 |
| **펼친 상태 → 15줄 이하로 줄임 → 다시 16줄 이상으로 늘림** | **펼친 채로 돌아온다** (pill은 `접기`). `update()`가 줄 수만 갱신하고 `expanded`는 안 건드린다 — 시나리오 B와 같은 원칙(사용자 의도 존중) |
| 커서 진입으로 펼쳐진 뒤 커서 이탈 | 펼침 유지 (시나리오 B-3) |
| 코드블럭 3개가 한 섹션에 | 각각 독립적으로 접힘/펼침 |
| 긴 줄(가로 오버플로) | 접힘·펼침 **양쪽 다 가로 스크롤** (`overflow-y: hidden`으로 세로만 자름 — 비목표 참조) |
| 접힌 블럭을 드래그 선택 → 복사 | 안 보이는 줄까지 클립보드에 들어간다. `overflow-y: hidden`은 시각만 자르고 텍스트 선택은 막지 않는다 — "접기는 순수 표시 상태"와 일관되므로 의도된 동작 |
| 키보드 Tab 이동 | pill에 `:focus-visible` 걸리면 hover 없이도 보임 |

## 성공 기준

1. 16줄 이상 코드블럭이 위 목표의 **5개 표면 전부**에서 15줄 높이(+ 16번째 줄 절반)로 접혀 렌더되고, 하단에 페이드가 보인다.
2. hover 시 pill이 뜨고, 클릭하면 해당 블럭만 펼쳐진다. 재클릭하면 접힌다. pill 라벨의 줄 수 = 블럭 전체 줄 수.
3. 15줄 이하 블럭에는 pill·페이드가 전혀 나타나지 않는다.
4. 접힌 블럭에 커서를 넣으면 자동으로 펼쳐지고, **커서가 나가도 펼침이 유지된다.**
5. 이 기능 도입 전후로 `buildIssueMarkdown()` / `buildIssueHtml()` 출력이 동일하다 — 회귀 테스트로 증명.
6. 페이드의 종단 색이 `pre` 배경과 **같은 토큰**(`hsl(var(--muted))`)이고, `code-collapse.css`에 `dark:`·하드코딩 색상이 **0건**이다(grep 검증). `--muted`가 라이트 `210 40% 96.1%` / 다크 `0 0% 14.9%`로 `tokens.test.ts`에 고정돼 있어 다크모드가 자동 대응된다.
7. ko/en 라벨이 양쪽 다 있고 `locales.test.ts`(키 대칭·placeholder 토큰 일치)를 통과한다. log-viewer의 별도 사전에도 같은 키가 있다.
8. `pnpm test` 통과, `pnpm test:e2e` green.
