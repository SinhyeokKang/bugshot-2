# 복수 Element 스타일 변경 버퍼 — 기술 설계

## 개요

세 가지를 함께 바꾼다.

**(0) 선행 정리 — no-diff 폐지** — element 모드는 **diff가 있는 element만** drafting으로 넘긴다. styling→drafting 진입("다음")에 diff 게이트를 두고, 코드 전반의 `isElementNoDiff` 동적 모드 강등(element↔screenshot) 분기를 **제거**한다. 이로써 element 모드는 항상 "diff 있는 element 1개 이상 + before/after 존재"가 보장돼, 그 위에 복수 element를 배열로 얹기만 하면 된다. (기존 no-diff 요소 스크린샷은 **요소 캡처 모드 [[element-screenshot]] — 본 기능의 선행 과제**가 대체.)

**(1) 데이터 레이어** — editor-store에 `bufferedElements: BufferedElement[]` 배열을 추가한다. 각 항목은 한 element의 스타일 변경 컨텍스트(selection 스냅샷 + styleEdits + before/after 이미지) 한 묶음이다. "다시 선택"(RepickButton) 시 현재 element의 after 스냅샷을 캡처해 버퍼에 push(현재 element는 diff 게이트로 항상 diff 보장)하고 picker를 재시작한다. 이슈 등록 시점에 `buildCtx`가 **버퍼 + 현재 element**를 `MarkdownContext.styleElements` 배열로 합쳐, 6개 플랫폼 본문 빌더가 element별 섹션을 반복 출력한다. 버퍼는 `EditorSnapshot`에 포함돼 기존 selection과 동일하게 세션 영속화된다.

**(2) 페이지 시각 레이어 (누적 프리뷰)** — content script(`src/content/picker.ts`)의 단일 `selectedEl` 추적을 **편집된 element 레지스트리**(`editedEls: Map<Element, OriginalState>`)로 바꿔, 변경이 가해진 모든 element를 추적하고 element 전환 시 이전 element를 복원하지 않고 유지한다. cleanup 경로(취소/제출 완료/idle/탭이동)에서만 `restoreAll()`로 전체를 일괄 원복한다.

> **⚠️ 설계 이후 변경(구현 현황)**: 아래 설계 초안은 "복수 element는 첫 제출 세션 안에서만 존재 / `IssueRecord`·blob 키 무변경 / DraftDetailDialog 단일 복원"을 전제했으나, **구현에서 복수 element draft 영속화가 추가**되었다. 핵심 차이는 다음과 같다(상세는 아래 각 변경 범위 섹션의 정정 표기 참조; tasks.md "Phase 3 — 설계 이후 추가 구현"과 짝):
> 1. **draft 영속화**: `IssueRecord.bufferedElements`(optional) + blob 키 `b{i}-before`/`b{i}-after` 추가 → DraftDetailDialog **표시·마크다운 복사·재제출**에 복수 element 복원(`resolveDraftStyleElements`/`useDraftStyleElements`). *styling 패널 재편집*만 미지원.
> 2. **AI 메타 복수 직렬화**: `buildMetaComment`가 `meta.elements` 배열로 element별 cssChanges 직렬화(아래 "부가 흐름"은 단일 유지로 적혔으나 철회).
> 3. **UI 프리뷰 element별 섹션**: drafting/preview/DraftDetailDialog가 element마다 `Style Changes ({selector})` 독립 섹션으로 렌더 + DOM 줄 `joinStyleSelectors` 공용(설계는 본문 직렬화만 다뤘음).
> 4. **reset-all 시 selection 재수집**: content script `handleResetAllEdits`가 `scheduleSelectionUpdate`로 패널 입력 표시값 갱신.
> 5. **함수/파일명**: 설계 초안의 `restoreOriginal`/`handleResetEdits`는 실제 `restoreAll`/`restoreElState`/`handleResetAllEdits`(picker) · `resetAllStyleEdits`(store). jira 후처리·게이트 헬퍼·repick push는 `injectSnapshotRows.ts`/`hasStyleChange.ts`/`useBufferThenSwitch.ts`로 추출됨.

`IssueRecord`(draft 영속)는 **복수 element 영속화를 위해 `bufferedElements`(optional)를 추가**한다 — draft 저장 시 버퍼 전체가 저장돼 DraftDetailDialog 표시·재제출에 복원된다(styling 재편집은 단일도 미지원). (no-diff 폐지의 레거시 하위호환도 DraftDetailDialog에 남긴다.)

## 변경 범위

### A. no-diff 폐지 (선행)

#### A-1. `src/sidepanel/tabs/StyleEditorPanel.tsx` — diff 진입 게이트
- **현재 역할**: "다음" 버튼(line 436)이 `disabled={proceeding}`뿐이라 diff 없이도 `handleNext`로 drafting 진입.
- **변경 내용**: "다음" 버튼을 `disabled={proceeding || !hasChange}`로(이미 정의된 `hasChange`, line 122 활용). `handleNext`에도 방어적 early return(`if (!hasChange) return`).
  - **diff 없을 때 안내 — 단순 텍스트만(결정 #2)**: 헬퍼는 **상시 정보성 텍스트**로 둔다("스타일을 변경하거나, 요소만 캡처하려면 요소 캡처 모드를 쓰세요"). **인라인 전환 액션(클릭→캡처 모드)은 만들지 않는다** — 요소 캡처 모드(element-screenshot)는 idle/EmptyState에서 진입하는 구조라, styling 화면에선 안내만 하고 사용자가 작성 취소 후 idle에서 진입한다. UX 미세조정(인라인 전환 등)은 후속 UXUI 고도화로.
  - **접근성(review #7)**: 헬퍼 텍스트에 `id` 부여 + disabled "다음" Button에 `aria-describedby` 연결(disabled 버튼은 툴팁이 안 떠 SR 사용자가 비활성 이유를 모름). 노출 조건은 **diff 0일 때만**(이미 diff 준 사용자에겐 노이즈). 스타일은 기존 muted 관습(`text-xs text-muted-foreground`), PageFooter `flex flex-col gap-2`에 한 줄.

#### A-2. `src/sidepanel/tabs/IssueCreateModal.tsx` — isElementNoDiff 제거
- **현재 역할**: `buildEditorCaptureFiles`(`IssueCreateModal.tsx:244`, `isElementNoDiff` 판정 line 248, 사용처 253~257)에서 `isElementNoDiff`로 element를 screenshot으로 강등(beforeImage를 screenshot으로).
- **변경 내용**: `isElementNoDiff` 분기 삭제. element 모드는 항상 before/after를 가진다. `buildCtx`의 element 분기도 diff 항상 존재 전제(단, 복수 처리는 C 참조).

#### A-3. `src/sidepanel/lib/buildIssueMarkdown.ts` — media 폴백 제거 + 형식 전환
- **현재 역할**: `emitMedia`(line 91~108 / 189~204)에서 element 모드일 때 `ctx.diffs.length > 0`이면 단일 `## Style Changes` 테이블, 아니면 media 섹션(imageAttached). env의 `- **DOM**: {selector}`는 단일(line 63~65).
- **변경 내용**: element 모드는 항상 styleChanges 경로(`else media` 폴백 삭제). 단일 `## Style Changes` → **`styleElements.map`으로 `## Style Changes ({selector})` 반복**(C-2 본문 직렬화 형식). env DOM 줄은 `styleElements`의 selector **쉼표 나열**. (screenshot/video/freeform media 경로는 그대로.)

#### A-4. 6개 플랫폼 본문 빌더 — diff 0 폴백 제거 + 복수 반복
- `buildGithubIssueBody.ts` / `buildLinearIssueBody.ts` / `buildGitlabIssueBody.ts` / `buildAsanaIssueBody.ts` / `buildNotionIssueBody.ts` / `buildIssueAdf.ts`
- **현재 역할**: 각 빌더가 `ctx.diffs.length > 0`이면 styleChanges, 아니면 screenshot/media로 폴백(github는 폴백 `startsWith("screenshot")` line 113, before/after 매칭 `startsWith` line 93/94; notion은 폴백 `startsWith("screenshot")` line 189, before/after 매칭 line 153/154; gitlab before line 91, linear 102, asana 78 — 라인은 함수명 기준으로 보라).
- **변경 내용**: element 모드 diff 0 폴백 삭제. `ctx.styleElements`를 element별 반복하며 헤더를 `## Style Changes ({selector})`로(본문 직렬화 형식). 단수·복수 동일 코드(`styleElements.map`). before/after는 `before-${i}`/`after-${i}` 매칭.

#### A-4b. jira(ADF) 이미지 인라인 — `src/background/messages.ts` 후처리 (review 추가)
- **현재 역할(정정)**: `buildIssueAdf.ts`의 styleChanges 경로(`ctx.diffs.map(d => [d.prop, d.asIs, d.toBe])` line 86)는 **이미지를 본문에 넣지 않고** `[Property, As is, To be]` 순수 텍스트 table만 만든다. before/after 이미지의 본문 인라인은 **jira 제출 후처리(`messages.ts:612~625` — `before.webp` 613, `after.webp` 614, table `findIndex` 616, `splice(1,0,...)` 621, `snapshotRow` 정의 663)** 가 담당한다 — 업로드 후 `uploadMap.get("before.webp")`/`"after.webp")`로 파일을 찾아 `snapshotRow(beforeFile, afterFile)`(mediaSingle 셀)를 만들어 **첫 번째 table(`findIndex(n => n.type === "table")`)의 인덱스 1에 splice**한다. (= jira는 다른 5개 빌더와 모델이 다르다. design 초안의 "buildIssueAdf media 노드 N회"는 부정확.)
- **변경 내용(복수 element)**: `messages.ts` 후처리를 복수 대응 —
  - 파일명을 단일 `before.webp`/`after.webp` → **`before-${i}.webp`/`after-${i}.webp`** 로 element별 조회.
  - `findIndex`로 첫 table 1개가 아니라 **content의 모든 styleChanges table을 순서대로 순회**하며 i번째 table에 i번째 element의 `snapshotRow` 주입(table 순서 = `styleElements` 인덱스 i 매칭). styleChanges table을 식별하는 기준(heading `## Style Changes (...)` 직후 table 등)을 명확히.
  - **단일 element도 C-2b 통일안에 따라 `before-0.webp`/`after-0.webp`** 로 생성되므로, messages.ts는 `before-${i}`만 순회하면 된다(무인덱스 `before.webp` 폴백 불필요 — 레거시 draft 재제출도 buildCaptureFiles가 제출 시점에 `before-0`로 생성). 단, 스크린샷 모드(`screenshot.webp`)·video 후처리 경로는 기존 그대로(element 모드 전용 변경).

#### A-5. `src/sidepanel/lib/buildCaptureFiles.ts` — screenshot 강등 입력 정리
- **현재 역할**: element 모드에서 before/after 생성, 호출부(IssueCreateModal)가 isElementNoDiff면 screenshot으로 강등해 호출.
- **변경 내용**: element 모드는 항상 before/after 경로(복수면 `before-${i}`/`after-${i}`, C 참조). 강등 입력 제거.

#### A-6. `src/sidepanel/tabs/DraftDetailDialog.tsx` — 레거시 폴백 유지(변경 최소)
- **현재 역할**: `buildCtxForSubmit`(line 248)에서 `noDiffs`(292)·`isElementNoDiff`(293) 판정 + 사용처(293~299 블록)로 레거시 처리.
- **변경 내용**: **신규 경로는 diff 보장**되므로 평상시 미발동. 단 폐지 이전에 저장된 no-diff element draft 하위호환을 위해 이 293~299 분기는 **그대로 남긴다**(주석으로 "legacy no-diff draft fallback" 명시). 마이그레이션 불필요. 복수 element 복원은 비목표라 단일 유지. **단, C-2b 개별 주입에 따라 buildCtxForSubmit도 단일 element를 1개짜리 `styleElements`(`before-0`/`after-0`)로 정규화**해 빌더·messages.ts가 일관 동작하게 한다(레거시 no-diff 분기는 별개로 유지).

### B. content script 누적 프리뷰

#### B-1. `src/content/picker.ts`
- **현재 역할**: 단일 `selectedEl`(line 198)과 원본 1벌(`originalClassName`/`originalStyle`/`editableHandle`/`originalTextContent`, line 200~203)만 추적. 전환·정리 시 `restoreOriginal()`(line 489)로 현재 element 원복.
- **변경 내용**:
  - `editedEls: Map<Element, OriginalState>` 도입(`OriginalState = { className, style, editable, text }`).
  - `captureOriginal(el)`(481): 레지스트리에 없을 때만 원본 기록(최초 원본 유지). 전역 `original*`는 현재 selectedEl 캐시로 레지스트리에서 채움.
  - **restoreOriginal 호출 제거(누적 유지)**: `handleStart`(**391**)·`handleNavigate`(**438**)·`onClickCommit`(**622**)·`onKeyDown` Escape(656)·iframe 분기(634), **그리고 `handleSelectByPath`(724, restoreOriginal 호출 733)** — DOM 트리 다이얼로그 노드 클릭도 element 전환이라 누적 유지 대상(C-4b의 DomNavButton과 별개 경로). (`handleNavigate`는 C-4b navigate 정책과 짝 — diff 있는 element는 페이지 유지, diff 없으면 레지스트리 미등록이라 잔여 없음.)
  - element 떠날 때 diff 없으면 레지스트리에서 제거(빈 항목 정리).
  - **`restoreAll()` 신설**(각 element는 `restoreElState(el, state)`로 원복) → `handleClear`에서 호출(전체 원복 + Map clear).
  - **reset-all 경로(구현)**: 스토어 `resetAllStyleEdits`(현재 styleEdits 초기화 + 버퍼 비움)와 content script `handleResetAllEdits`(`restoreAll()` + `render()`)가 짝. 설계 초안의 `handleResetEdits`(현재 element만)는 채택 안 됨 — reset은 **전체 reset**만 있고(StyleEditorPanel "변경사항 초기화"), 속성/클래스 부분 되돌리기는 별도 DOM reset 없이 `applyStyles`/`applyClasses` 재적용으로 처리.
  - **⚠️ reset 후 selection 재수집(구현 보강)**: `handleResetAllEdits`는 `restoreAll()` 후 **`scheduleSelectionUpdate()`를 호출**해 원복된 DOM에서 selection의 specified/computed 스타일을 다시 읽는다. 안 그러면 class 편집·재선택으로 `scheduleSelectionUpdate`가 갱신해둔 `selection.specifiedStyles`가 편집값에 머물러, 패널 입력 필드 표시값(placeholder·Select)이 초기화 안 된 것처럼 보인다.
  - **전역 `original*` 캐시 의존 함수 전부 점검**: `handleApplyStyles`(459)·`handleApplyClasses`(450)·`handleApplyText`(511) 모두 리셋/원본 기준으로 전역 `original*`(혹은 `editableHandle`)를 쓴다. 단일→Map 전환 시 "전역 `original*`는 **현재 selectedEl** 캐시"라는 전제를 이 셋이 모두 만족해야 한다 — element 전환·재선택·navigate 왕복 후 캐시가 이전 element 것이면 class/text 리셋이 어긋남. element 전환 시 `captureOriginal`로 레지스트리에서 현재 element 원본을 전역 캐시에 채우는 지점을 셋 모두에 보장.

### C. 복수 element 데이터·직렬화

#### C-1. `src/store/editor-store.ts` — 버퍼 상태·액션
- `BufferedElement` 인터페이스 신설(인터페이스 설계 참조).
- `EditorState`에 `bufferedElements: BufferedElement[]`, `initial`에 `[]`.
- `bufferCurrentElement(afterImage)`: 현재 selection의 diff가 있으면(가드로 항상 보장되나 방어적으로 체크) `{selectionSnapshot, styleEdits, beforeImage, afterImage}`를 push. **같은 selector면 갱신**(diff·after 교체, 최초 before 유지).
- `preserveBuffer(state)` 헬퍼 + `startPicking`의 `...initial`에 적용(모드 진입 시 버퍼 보존).
- `onSubmitted`에 `bufferedElements: []` 추가. `reset`/`cancelPicking`은 `...initial`이라 자동.
- **`onSubmitted`에 페이지 복원 동반(review 결정)**: `onSubmitted`(**editor-store.ts:652** — 문서 초안의 618은 `backToDraft`이니 주의)는 `phase:"done"` + 이미지/로그 필드 null만 만들고 `clearPicker`/`restoreAll`을 부르지 않아, done에서 idle 전환 전 패널/탭을 닫으면 누적 변경이 페이지에 남을 수 있다(누적 프리뷰는 자동 복원이 사라져 단일보다 오염 면적 큼). 여기에 `bufferedElements: []`도 추가(`reset`/`cancelPicking`은 `...initial`이라 자동). → **제출 완료 시 페이지 전체 복원**을 동반한다. store는 chrome API를 직접 안 부르므로(기존 패턴), 제출 완료를 구독하는 지점(IssueCreateModal 제출 성공 콜백 권장)에서 `clearPicker`(→`restoreAll`)를 호출하도록 한다. "done 상태 패널 닫기 잔여 0"을 성공 기준으로 못박음.
  - **단, 구현 전 실측(review #12)**: "패널을 그냥 닫는" 경우는 content script port `onDisconnect` → `handleClear`(picker.ts) → `restoreAll`이 **이미 자동 발화**할 가능성이 있다(기존 패턴). useEditorSessionSync의 `onTabUpdated`도 `phase==="done"` + 탭 네비게이션에서 이미 `clearPicker`를 부른다 → "탭 이동" 잔여는 이미 막혀 있다. 진짜 구멍은 "done에서 패널/탭을 닫는데 port disconnect가 restoreAll까지 도달하지 못하는" 경우뿐. **구현 시 port disconnect 경로를 실측해, 자동 복원되면 이 명시 보강은 over-engineering이므로 생략**하고 성공 기준만 테스트로 검증한다.

#### C-2. `src/sidepanel/lib/buildIssueMarkdown.ts` — MarkdownContext 확장 + 머지
- `StyleElementContext` 인터페이스 + `MarkdownContext.styleElements?: StyleElementContext[]` 추가.
- `mergeStyleElements(buffered, current)` 순수 함수: 버퍼 항목 + 현재 element를 합쳐 selector dedup(현재 우선)한 **최종 배열을 만든 뒤, 그 최종 배열 인덱스로 `before-${i}`/`after-${i}` 파일명을 부여**한다(각 항목 `buildStyleDiff`). diff 0 항목은 제외(안전장치 — 가드로 현재 element는 항상 diff).
  - **인덱스 `i` 단일 출처(review)**: 파일명 인덱스는 **dedup·머지가 끝난 최종 배열**의 인덱스여야 한다. dedup으로 현재 element가 버퍼 항목을 덮으면 길이·순서가 바뀌므로, `mergeStyleElements`가 매긴 `styleElements[i].beforeFilename`과 `buildCaptureFiles`가 생성하는 `before-${i}.webp`가 **같은 i를 보도록** 한 곳(머지 후)에서 결정한다. styleElements와 CaptureFiles 입력을 같은 최종 배열에서 파생(C-4 참조).
- **본문 골격(아래 "본문 직렬화 형식" 참조)**: Environment 섹션의 `- **DOM**:` 줄을 `styleElements`의 selector **쉼표 나열**로, Style Changes는 element마다 **`## Style Changes ({selector})` 섹션을 반복**(단수·복수 동일 형식, 분기 없음). `buildIssueMarkdown`/`buildIssueHtml`/6개 빌더 모두 `styleElements.map`으로 동일 처리.

#### C-2b. ctx.styleElements를 채우는 경로 — 3곳 개별 주입 (review 정정)
- **현재 ctx 생성 경로 3개는 공통 함수를 안 거친다(검증 결과)**: ① `IssueCreateModal.tsx:143 buildCtx`(제출 **본선**)는 `MarkdownContext`를 **인라인 객체 리터럴로 조립**하며 `buildMarkdownContext`를 **import조차 안 한다**. ② `PreviewPanel.tsx`("마크다운 복사")만 별도 파일 `src/sidepanel/lib/buildMarkdownContext.ts:41 buildMarkdownContext()`를 호출한다(element 분기 line 217, 그 외 187/202/239). ③ `DraftDetailDialog.tsx:248 buildCtxForSubmit`(레거시 draft 재제출)도 **인라인 조립**. → 빌더가 `ctx.styleElements`를 반복하도록 바뀌면, styleElements를 안 채우는 **제출 본선 ①까지 빈 본문**이 된다(②=복수 누락, ③=`before.webp` 무인덱스 이미지 매칭 깨짐).
- **결정 — 3곳 각각에서 styleElements를 채운다(개별 주입)**: "ctx 생성 공통 지점 하나"가 실재하지 않으므로, **세 경로 모두에 styleElements 주입을 개별 추가**한다(공통화 선행 리팩터는 외과적 범위를 넘어 채택 안 함). 빌더에 단일 폴백을 두지 않고, 단일 element도 1개짜리 `styleElements`(`before-0`/`after-0`)로 정규화한다.
  - ① IssueCreateModal.buildCtx(인라인): `mergeStyleElements(bufferedElements, { selection, styleEdits, before: beforeImage, after: afterImage })` → `ctx.styleElements`(C-4).
  - ② PreviewPanel(buildMarkdownContext 경유): `buildMarkdownContext` 시그니처에 buffered/현재 입력 추가 → `mergeStyleElements(bufferedElements, 현재)`로 버퍼 포함(마크다운 복사에 A·B 섹션). **이미지 URL 없는 복사 본문이므로 Snapshot 행 없이 element별 diff 테이블만 반복**(`before-${i}` 셀 없음 — 범용 buildIssueMarkdown 동일).
  - ③ DraftDetailDialog.buildCtxForSubmit(인라인): 레거시 단일을 1개짜리 styleElements(`before-0`/`after-0`)로(레거시 no-diff 분기는 별개 유지).
  - → 세 경로가 모두 styleElements를 채우면 빌더·후처리(messages.ts 포함)는 `styleElements`/`before-${i}`만 보면 됨(단일 폴백 분기 불필요).

#### C-3. `src/sidepanel/lib/buildCaptureFiles.ts` — element별 파일 (배열 교체)
- **현재**: `BuildCaptureFilesInput`(line 24)의 단수 `beforeImage?`/`afterImage?`(28/29)를 받아 고정 `before.webp`/`after.webp` 1쌍 push(96~100).
- **변경(결정 — 배열 교체)**: element 모드 입력의 단수 `beforeImage`/`afterImage`를 **element별 이미지 배열로 교체**해 항목별 `before-${i}.webp`/`after-${i}.webp` 생성(단수 필드 병존 안 함 — element 경로 일원화). screenshot/video 모드의 단수 필드(`screenshotImage` 등)는 그대로 유지(element 전용 변경). 호출부(IssueCreateModal `buildEditorCaptureFiles`, DraftDetailDialog)는 단일도 1개짜리 배열(`before-0`/`after-0`)로 넘겨 회귀 없게.
- **혼선 주의**: `getModeImages`(AiDraftDialog 전용 before/after 배열)는 파일 생성과 **무관** — 이름이 유사하나 건드리지 않는다.

#### C-4. `src/sidepanel/tabs/IssueCreateModal.tsx` — buildCtx/captureFiles 머지
- `buildCtx`의 element 분기에서 `mergeStyleElements(bufferedElements, 현재 element)` → `ctx.styleElements`. 기존 단일 필드(selector/diffs 등)는 첫 element로 채워 하위호환(meta comment 등).
- **`current` 입력 조립(review)**: `mergeStyleElements`의 `current: { selection, styleEdits, before, after }`에서 `before`/`after`는 store의 별도 필드 `beforeImage`/`afterImage`(selection·styleEdits와 별개)에서 가져와 주입한다. buildCtx에서 `{ selection, styleEdits, before: beforeImage, after: afterImage }`로 조립.
- `buildEditorCaptureFiles`에서 **머지·dedup이 끝난 최종 `styleElements` 배열을 단일 출처로** before/after 이미지 배열을 만들어 buildCaptureFiles에 전달(C-2 인덱스 일치 — styleElements[i] ↔ before-${i}.webp). styleElements 파생과 CaptureFiles 파생이 같은 최종 배열을 보도록.

#### C-4b. element 전환 진입점 — RepickButton + DomNavButton (push + 시각 위계)
- **현재 역할**: `RepickButton`(StyleEditorPanel.tsx:449)이 `startPicker(tabId)`만 호출(`variant="outline"`, `h-8 w-8`). `DomNavButton`(DomTreeDialog.tsx:32, 부모/자식 이동)이 `navigatePicker(tabId, direction)`만 호출. 둘 다 element를 전환하지만 현재 diff를 버퍼에 담지 않는다.
- **변경 내용**:
  - **공유 push 로직**: 두 버튼 모두 onClick을 async로 — diff가 있으면(`hasChange`) `captureElementSnapshot(tabId)`로 after 캡처 → `bufferCurrentElement(after)` → 이어서 `startPicker`/`navigatePicker` 호출. diff 없으면 push 생략하고 전환만(페이지는 아래 navigate 정합으로 복원). 캡처 중 중복 클릭 방지 플래그. → **repick·navigate가 버퍼 적재에서 완전 동일 정책**(사용자 결정).
  - **navigate 페이지 정합**: B-1의 `handleNavigate` `restoreOriginal` 제거는 "diff 있어 버퍼에 담은 element는 페이지 유지"를 위함. diff 없는 element를 navigate로 떠날 땐 레지스트리 미등록(=변경 없음)이라 자연히 잔여 없음 — 별도 복원 불필요. 즉 editedEls 등록 여부(=diff 유무)가 페이지 유지/정리를 자동 결정.
  - **시각 위계 상승(RepickButton)**: 복수 element 누적의 핵심 진입점으로 중요도가 올라가, `variant="outline"` → **`variant="default"`**(shadcn primary = 까만 배경 + 흰 아이콘; 다크모드는 테마 변수 자동 반전). 커스텀 색상 없이 shadcn 변수만(CLAUDE.md). `h-8 w-8` 유지. (DomNavButton 스타일은 현행 유지 — 위계 변경은 repick만.) **결정(review): default primary 강행**. 헤더 RepickButton과 footer "다음"(line 436, primary CTA)이 화면에 primary 2개로 공존하나, 둘은 역할이 다르고(헤더=다음 element 담기, footer=drafting 진행) 의도된 배치로 둔다. 헤더 nav 2버튼(outline) 사이에서 repick만 강조되는 것도 "누적 진입점" 신호로 의도. (UX 미세조정은 후속 UXUI 고도화에서.)

#### C-5. `src/sidepanel/hooks/useEditorSessionSync.ts` — 세션 영속화
- `EditorSnapshot`(editor-store.ts)·`snapshotFromState`에 `bufferedElements` 추가.
- **lite 강등 얕은 스프레드 함정(review)**: 현 lite(useEditorSessionSync.ts:144)는 `{...snap, beforeImage:null, ...}`로 top-level 필드만 null 처리한다. `bufferedElements`는 배열 안 base64라 `...snap`으로 **그대로 살아남아** lite 재저장도 동일 용량 초과로 실패한다. → `bufferedElements: snap.bufferedElements.map(e => ({ ...e, beforeImage: null, afterImage: null }))`로 **명시 변환**(얕은 복사로는 안 비워짐).
- 하위호환: hydrate/초기화 시 키 없는 구 스냅샷은 `initial`의 `bufferedElements: []`가 유지됨(부분 머지라 자동). `snapshotFromState`가 명시적 undefined를 쓸 때만 `?? []` 필요.

#### C-6. `src/i18n/namespaces/issue.ts`(또는 editor.ts) — 라벨
- element 소제목 키 / "diff 없이 다음" 안내 문구 추가 시 ko/en 동시(PostToolUse 훅 검사).

#### C-7. UI 프리뷰 element별 섹션 정합 (설계 이후 추가 — 본문뿐 아니라 화면도)
설계 초안의 "본문 직렬화 형식"은 마크다운/플랫폼 *제출 본문*만 다뤘으나, **사이드패널 화면 프리뷰 3곳도 본문과 동일하게 element별 독립 섹션으로 정합**시켰다.
- **`joinStyleSelectors(styleElements, fallback)` 공용 순수 함수**(`buildIssueMarkdown.ts`): `styleElements`가 있으면 selector를 `, `로 나열, 없으면 fallback. `styleDomLabel`(본문 DOM 줄)이 이걸 위임하고, UI 3곳의 env `DOM` 줄도 공용 → 본문·화면 단일 출처.
- **element별 섹션 렌더**(`drafting`=DraftingPanel / `preview`=PreviewPanel / DraftDetailDialog): 단일 `Style Changes` 래퍼 안에서 셀렉터 라벨만 붙이던 방식(`StyleElementsTable`)을 폐지하고, **element마다 `Section`/`FieldSection`(제목 `Style Changes ({selector})`) + 자기 `StyleChangesTable`** 로 분리 — 제출 본문의 `## Style Changes ({selector})` 반복과 일맥상통. `StyleElementsTable`은 고아가 되어 제거, 3곳 모두 `StyleChangesTable`을 직접 map.
- 각 UI의 env `DOM` 줄은 `joinStyleSelectors(styleElements, selection?.selector ?? issue.selector)`로 복수 selector 쉼표 나열. DraftDetailDialog는 `resolveDraftStyleElements`(이미지 빈 값) 결과로 join.

### 변경 없음 (명시적)
- ~~`src/store/issues-store.ts` `IssueRecord` — 변경 없음~~ → **변경됨**: `IssueBufferedElement[]`를 담는 `IssueRecord.bufferedElements?`(optional) 추가. optional이라 **마이그레이션·`ISSUES_STORE_VERSION` bump 불필요**(현 버전 5는 무관한 `migrateIssueToV4`).
- ~~`src/store/blob-db.ts` blob 키 — 변경 없음~~ → **변경됨**: 현재 element는 기존 `id:before`/`id:after`, **버퍼 element는 `id:b{i}-before`/`id:b{i}-after` 키로 영속**(`confirmDraft`가 저장, `loadDraftStyleImages`가 로드). 복수 element draft 영속화를 위해 IndexedDB에 저장된다(설계 초안의 "영속 안 함"은 철회).

## 데이터 흐름

```
                   [sidepanel 데이터]                       [content script 페이지 시각]
[picker 선택 A] → onElementSelected (styleEdits 리셋)      captureOriginal(A) → editedEls{A}
                → captureElementSnapshot → setBeforeImage(A.before)
[A 수정]        → setStyleEdits (A.diff)                   applyStyles(A) → 페이지에 A 변경
[diff 없으면]    → "다음" 비활성(no-diff 폐지) → 진행 불가
[RepickButton]  → captureElementSnapshot(A.after)
                → bufferCurrentElement(A.after)            picker.start → handleStart
                → startPicker(...preserveBuffer)             (restoreOriginal 제거 → A 변경 유지)
[picker 선택 B] → onElementSelected (버퍼 보존)            onClickCommit(B): restore 안 함
                → setBeforeImage(B.before)                   captureOriginal(B) → editedEls{A,B}
[B 수정]        → handleNext(가드 통과) → confirmStyles     applyStyles(B) → 페이지에 A·B 동시 적용
[이슈 등록]     → buildCtx: mergeStyleElements(buffer[A]+B) → ctx.styleElements=[A,B]
                → buildEditorCaptureFiles: before-0/after-0(A), before-1/after-1(B)
                → 플랫폼 빌더 element별 섹션 반복 → 제출
[제출/취소]     → onSubmitted/reset: bufferedElements=[]   clearPicker → handleClear → restoreAll()
```

### 세션 영속화
`snapshotFromState`/`EditorSnapshot`에 `bufferedElements` 추가 → 기존 selection처럼 `chrome.storage.session`에 자동 저장·복원. 직렬화 실패 시 lite 강등(이미지 제거)에 버퍼 항목 이미지도 포함.

## 본문 직렬화 형식

단수·복수 **분기 없이** `styleElements` 배열을 그대로 map한다(단일 = 1개짜리 배열). 단일 element 출력도 기존(`## Style Changes` + env `- **DOM**: selector`)에서 아래 형식으로 **바뀐다**(의도된 변경, 회귀 아님 — 기존 단위 테스트 갱신 필요).

- **Environment**: `- **DOM**:` 줄에 `styleElements`의 selector를 **쉼표로 나열**.
- **Style Changes**: element마다 `## Style Changes ({selector})` 섹션 + 자기 테이블(`before-${i}`/`after-${i}` Snapshot 행 + diff 행).

```markdown
## Environment

- **OS**: macOS 15.5
- **Browser**: Chrome 130
- **Page**: https://example.com
- **DOM**: button.cta, div.course.card        ← diff 있는 element selector 쉼표 나열
- **Viewport**: 1440×900
- **Captured**: 2026-06-08 14:30

## Style Changes (button.cta)

| Property | As is | To be |
| --- | --- | --- |
| **Snapshot** | ![before-0.webp](url) | ![after-0.webp](url) |
| color | #000000 | #ffffff |

## Style Changes (div.course.card)

| Property | As is | To be |
| --- | --- | --- |
| **Snapshot** | ![before-1.webp](url) | ![after-1.webp](url) |
| padding | 10px | 20px |
```

- **플랫폼별 변형**(골격 동일, Style Changes 헤더만 `({selector})` 부여):
  - `buildIssueMarkdown`(범용 복사): Snapshot 행 없이 diff 테이블만.
  - github/gitlab/linear: 위 예시대로 Snapshot 행 포함.
  - notion: `## Style Changes ({selector})` 아래 before/after를 heading_3로 분리(기존 구조에 selector만 부여).
  - asana: inline 이미지 + diff. jira(ADF): `buildIssueAdf`는 heading + **텍스트 테이블 노드만**(이미지 셀 없음). before/after Snapshot 행은 **제출 후처리 `messages.ts:snapshotRow`** 가 업로드 후 각 styleChanges table에 splice(A-4b — element별 `before-${i}`/모든 table 순회).
- **이미지 인덱스 `i`**: `styleElements`(머지·dedup 후) 배열 인덱스. element 섹션과 `before-${i}`/`after-${i}`가 1:1.
- Style Changes 헤더 라벨은 i18n `md.section.styleChanges` + `({selector})` 조합. 새 키 불필요(selector는 동적 삽입).

## 인터페이스 설계

```typescript
// src/content/picker.ts - 누적 프리뷰 레지스트리
interface OriginalState {
  className: string | null;
  style: string | null;
  editable: EditableHandle | null;
  text: string | null;
}
let editedEls: Map<Element, OriginalState>;   // 변경이 가해진 모든 element 추적
function captureOriginal(el: Element): void;   // editedEls에 없을 때만 원본 기록
function restoreAll(): void;                    // 전체 원복 + Map clear (handleClear에서 호출)
// restoreOriginal(현재 element 1벌 복원)은 handleResetEdits 전용으로 축소
```

```typescript
// src/store/editor-store.ts
export interface BufferedElement {
  selector: string;
  tagName: string;
  selectionSnapshot: {
    classList: string[];
    specifiedStyles: Record<string, string>;
    computedStyles: Record<string, string>;
    text: string | null;
    viewport: { width: number; height: number };
    capturedAt: number;
  };
  styleEdits: EditorStyleEdits;       // { classList, inlineStyle, text }
  beforeImage: string | null;
  afterImage: string | null;
}

interface EditorState {
  // ...기존...
  bufferedElements: BufferedElement[];
  bufferCurrentElement: (afterImage: string | null) => void;
}
```

```typescript
// src/sidepanel/lib/buildIssueMarkdown.ts
export interface StyleElementContext {
  selector: string;
  tagName: string;
  classListBefore: string[];
  classListAfter: string[];
  specifiedStyles: Record<string, string>;
  diffs: StyleDiffRow[];
  beforeFilename?: string;   // "before-0.webp"
  afterFilename?: string;    // "after-0.webp"
}

export interface MarkdownContext {
  // ...기존 단일 필드 유지(첫 element 기준 하위호환)...
  styleElements?: StyleElementContext[];
}

// 버퍼 + 현재 element를 selector dedup 머지. diff 0 항목 제외(안전장치). 순수 함수.
export function mergeStyleElements(
  buffered: BufferedElement[],
  current: { selection: EditorSelection; styleEdits: EditorStyleEdits; before: string | null; after: string | null } | null,
): StyleElementContext[];
```

## 부가 흐름 처리 (체크 결과 보강)

- **AI 스타일링**: AI 결과는 `setStyleEdits(merged)` 경유로 현재 element의 `styleEdits`에 반영된다(AiStylingDialog). 따라서 버퍼 push·직렬화에 **자동 포함** — 별도 처리 불필요. `aiStylingLoading`은 transient 상태라 버퍼와 무관(BufferedElement에 안 담음).
- **tokens**: `tokens`는 element 전환 시마다 `collectTokens`로 재수집되는 현재 element 기준 값이다. 본문 diff 테이블은 `buildStyleDiff`로 만들어 tokens가 필요 없으므로, **BufferedElement에는 tokens를 담지 않는다**. `buildMetaComment`의 top-level `meta.selector`/`cssChanges`/`tokens`는 현재(마지막) element 기준 단일 유지.
  - **~~meta를 element별 배열로 확장하는 것은 비목표~~ → 구현됨**: `buildMetaComment`가 `resolveStyleElements(ctx).length > 1`일 때 **`meta.elements` 배열**(element별 `selector`/`tagName`/`classListBefore`/`classListAfter`/`specifiedStyles`/`cssChanges`)을 추가 직렬화한다. 단일/레거시는 top-level 단일 필드만(회귀 0). `buildAiMetaAttachment`(=`bugshot.md`)·`buildIssueHtml`도 같은 `buildMetaComment`라 자동 반영. → AI 메타도 복수 element를 완전 반영.
- **EditorSnapshot 하위호환**: 기존 세션 스냅샷에는 `bufferedElements` 필드가 없다. `hydrate`/초기화 시 `bufferedElements: snap.bufferedElements ?? []`로 기본값 처리(마이그레이션 불필요). lite 강등 시 버퍼 항목 이미지 제거(C-5).
- **confirmDraft → IssueRecord (설계 이후 변경 — 복수 영속화)**: `confirmDraft`(editor-store)는 현재 selection + **버퍼의 모든 element를 `IssueRecord.bufferedElements`에 저장**한다(`selector`/`tagName`/`styleEdits`/`selectionSnapshot` + 이미지 존재 플래그 `hasBefore`/`hasAfter`; 이미지 자체는 blob `b{i}-before`/`b{i}-after`). → DraftDetailDialog 재열람 시 `resolveDraftStyleElements`(+`useDraftStyleElements` 훅)가 버퍼+현재를 라이브와 동일 규칙으로 머지해 **표시·마크다운 복사·재제출 본문에 복수 element를 복원**한다. **단 styling 패널로 돌아가 다시 picker 편집하는 UX는 미지원**(단일도 재편집 안 함 — 표시·재제출만). ⚠️ 이는 *저장 후 재열람* 경로이며, *현재 세션 styling↔drafting 왕복*(backToStyling)은 별개로 항상 복수 유지(정상 동작).
- **sessionExpired와 버퍼**: element styling 중 페이지 만료(`sessionExpired`) → SessionExpiredDialog `onConfirm`의 `reset()`이 `...initial`로 버퍼까지 비운다(별도 작업 불필요). 페이지 변경은 만료된 페이지라 복원 불가(자연 소실).

## 하위호환 — 레거시 no-diff draft

no-diff 폐지 이전에 이슈 목록에 저장된 element draft 중 `styleEdits` diff가 0인 것이 있을 수 있다(드물지만 가능). 처리:
- **신규 생성 경로**(IssueCreateModal → confirmDraft): diff 게이트로 no-diff draft가 새로 생기지 않는다.
- **기존 저장분**(DraftDetailDialog 열람/재제출): `buildCtxForSubmit`의 레거시 `isElementNoDiff` 분기를 **유지**해 기존처럼 screenshot 미디어로 표시. 마이그레이션·스키마 변경 없음.
- 출시 초기라 잔존 데이터는 미미할 것으로 보고, 적극 변환/삭제는 하지 않는다(외과적 범위).

## 기존 패턴 준수

- **세션 영속화 패턴**: `EditorSnapshot`/`snapshotFromState`에 필드 추가 → 기존 `selection`·`styleEdits`와 동일. lite 강등 규칙 일관.
- **`...initial` + preserve 헬퍼**: `preserveLogs`와 동형의 `preserveBuffer`.
- **순수 함수 재사용**: `buildStyleDiff`를 element별 호출. 새 diff 로직 없음.
- **store가 chrome API 직접 호출 회피**: after 스냅샷 캡처는 컴포넌트(RepickButton)에서 수행 후 store 액션에 주입(기존 handleNext와 동일).
- **content script 복원 모델**: `captureOriginal`/`restore` 패턴 유지하되 단일 변수 → `Map`. cleanup 종착점(`handleClear`)에 복원 일원화하는 기존 구조 유지.
- **i18n 동시 갱신**: 새 키 ko/en 양쪽.
- **테스트 우선**: `bufferCurrentElement`·`mergeStyleElements`·element별 파일명은 순수 함수로 분리해 단위 테스트 먼저.

## 대안 검토

1. **no-diff 폴백 유지 + merge.length로 분기 (기각)**: breaking 없이 갈 수 있으나, `isElementNoDiff` 동적 강등이 5곳(buildCtx/buildEditorCaptureFiles/DraftDetailDialog/buildCaptureFiles/6개 빌더)에 잔존해 복수 element 도입 시 분기가 가장 미묘해진다. element 모드 = diff 전용으로 책임을 가르면 이 분기를 통째로 삭제 가능. 출시 초기라 breaking 비용이 최소인 지금이 정리 적기 → 폐지 채택.
2. **IssueRecord에 element 배열을 넣어 draft 영속까지 지원 (기각)**: 스키마+버전 bump+마이그레이션+blob 키+DraftDialog 전면 확장. 회귀 위험 크고 "UI 0" 방향과 어긋남.
3. **빌더를 element별로 호출해 문자열 머지 (기각)**: env/log/section 공통 머리말이 element 수만큼 중복. styleChanges 섹션만 element 반복하는 `MarkdownContext.styleElements` 내부 반복 채택.
4. **페이지 시각은 현재 element만, 데이터만 버퍼 (기각)**: content script 무변경으로 단순하나 B 편집 중 페이지에서 A 변경이 사라져 "누적 비교" 가치 하락. 사용자가 누적 프리뷰 명시 → 레지스트리화 채택.

## 위험 요소

- **세션 storage 용량**: element별 base64 before/after 누적으로 한계 도달 시 lite 강등(이미지 제거) → 버퍼 이미지 손실 가능(텍스트 diff·페이지 변경은 유지). 버퍼 이미지를 lite 강등 대상에 포함하는 보강 필수.
  - **computedStyles 용량 검토(review #13)**: `BufferedElement.selectionSnapshot.computedStyles`는 요소당 수십~수백 키를 통째로 담는다. 이미지와 달리 **텍스트라 lite 강등으로도 안 비워진다**. 본문 직렬화는 `buildStyleDiff`로 만들어지므로 `computedStyles`가 실제로 필요한지 구현 시 검토 — 불필요하면 `BufferedElement`에서 빼서 누적 용량/lite 압박을 더 줄인다(현 selection 스냅샷이 collectTokens·재선택 복원에 쓰이는지 확인 후 결정).
- **회귀 위험의 무게중심은 "텍스트 형식"이 아니라 "이미지 인덱싱/첨부"**: 와꾸(`## Style Changes ({selector})` 반복) 자체는 분기 없는 `styleElements.map`이라 회귀 표면적이 작다. 진짜 위험은:
  - **이미지 파일명 매칭**: 기존 `images.find(i => i.filename.startsWith("before"))`(github:93/94, gitlab:91, asana:78, linear:102, notion:153 — 실측, 6개 빌더 전부 확인)는 `before-0`/`before-1`을 모두 첫 번째로 잡는다. 루프에서 **정확 일치(`=== \`before-${i}\``)** 또는 인덱스 기반으로 바꿔야 한다. 안 바꾸면 모든 element가 같은 이미지를 가리키는 조용한 버그.
  - **첨부 중복 방지(attached/mediaHandled)**: github은 `mediaHandled.add(...)`(before/after add 123/124) 후 `extras = images.filter(i => !mediaHandled.has(i.filename))`(github:165)로 하단 Attachments를 만든다. 기존엔 before/after 1쌍만 `mediaHandled`에 등록 → 복수면 첫 쌍만 등록되고 **before-1/after-1이 `mediaHandled`에 안 들어가 하단 Attachments에 중복 노출**. 복수면 N쌍 전부 `mediaHandled`에 등록해야. (notion/asana는 `mediaHandled` 없이 placeholder/queueAttachment 방식이라 빌더별 처리가 실제로 다름.)
- **플랫폼별 이미지 삽입 모델 차이(빌더마다 메커니즘이 다름)**: github `imageCell`(`![](url)`), linear `assetUrl`, notion `nextPlaceholder`+`queueAttachment`, asana inline 순서, **jira는 빌더가 아니라 `messages.ts` 후처리 `snapshotRow` splice(A-4b)** — element별 인덱스로 N번 처리할 때 빌더마다 다르게 틀릴 수 있다(특히 notion placeholder 카운터·asana inline 순서·jira table 순회). → 빌더별 복수 element 단위 테스트(스냅샷) + 플랫폼별 실제 제출 검증이 안전망.
  - **jira 후처리 단위화(review #9)**: jira splice는 `messages.ts` 후처리라 5개 빌더 단위 테스트(`buildXxxIssueBody.test.ts`)로 **안 잡힌다** — 현재 수동 제출에만 의존. "모든 styleChanges table 순회 → i번째 table에 i번째 element snapshotRow 주입" 로직을 **순수 함수로 추출**해 "table N개 ↔ element N개 인덱스 일치" 단위 테스트를 Task 1-6b에 추가한다. 실제 jira 제출은 최종 스모크로 남기되 결정적 검증은 단위로 전진.
- **빈 styleElements 방어**: no-diff 폐지로 element 모드는 항상 1+개지만, 엣지에서 비면 `## Style Changes ()` 깨짐 가능 → map 전 길이 가드.
- **현재 element 중복 직렬화**: 마지막 element가 같은 selector로 버퍼에도 있으면 `mergeStyleElements`의 dedup으로 현재 것 우선. 테스트로 고정.
- **페이지 오염(restoreAll 누락)**: 누적 유지로 자동 복원이 사라지므로 **모든 종료 경로가 `handleClear`(→`restoreAll`)로 수렴**해야 한다. 현황: `clearPicker`는 작성 취소(StyleEditorPanel)·세션 만료/탭이동(useEditorSessionSync)·이슈 삭제·재편집(issues-store, DraftDetailDialog)·`IssueTab.tsx:68`의 `phase→idle` subscribe에서 발화. **제출 완료(done) 잔여는 review에서 확정 해결**(C-1): 제출 완료 구독 지점에서 `clearPicker`(→`restoreAll`)를 동반해 done 상태 패널/탭 닫기 잔여를 0으로. ("검토"가 아니라 성공 기준에 못박음.)
- **레지스트리 메모리**: `Map<Element,…>`는 강참조. element 전환 시 diff 없는 항목 정리 + `restoreAll`에서 clear로 라이프사이클 종료 시 해제(restoreAll 순회 위해 WeakMap 아닌 Map 사용).
- **diff 게이트 판정 일치(review 확인)**: 진입 게이트(`hasChange`, StyleEditorPanel:120~122 = inlineCount + classDirty + textDirty)와 직렬화(`buildStyleDiff`, collapseShorthands 적용)의 `>0` 경계는 **검증 결과 일치한다**(collapse는 비어있지 않은 입력을 0으로 만들지 않고, inlineStyle 빈 값은 setStyleEdits에서 안 들어옴). 따라서 게이트를 `buildStyleDiff().length>0`로 바꾸는 건 불필요(over-engineering). → **`hasChange` 유지 + 둘이 `>0`에서 동치임을 단위 테스트로 고정**.
  - **동치 테스트 실현성(review #10)**: `hasChange`는 현재 StyleEditorPanel 컴포넌트에 **인라인 파생값**이라 단위 테스트에서 직접 호출 불가. → `hasChange` 계산식(inlineCount/classDirty/textDirty 합성)을 **순수 헬퍼로 추출**한 뒤 동일 selection/edits 입력에서 `hasChange(...) === (buildStyleDiff(...).length>0)` boolean 일치를 테스트한다(추출 없이는 `buildStyleDiff` 경계만 테스트되고 게이트 동치가 검증 안 됨).
