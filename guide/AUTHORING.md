# 가이드 문서 작성 매뉴얼 (AUTHORING)

`guide/ko`·`guide/en` 사용자 가이드를 **만들거나 고칠 때 이 문서를 먼저 읽는다.** 운영 방식·IA·톤·사실 대조·검증까지 가이드 작성에 필요한 모든 규칙이 여기 있다. 기능별 PRD/설계 문서(`docs/features/<slug>/`)는 구현 후 삭제되므로, 영속 지식은 이 파일이 단일 출처다.

> 이 파일은 `guide/` 루트(ko/en 상위)에 있어 **docs-portal 서빙 대상이 아니다** — 레포에만 남는 내부 문서다. 사용자에게 노출되지 않는다.

---

## 1. 운영 방식

- `guide/ko`·`guide/en`은 사용자 가이드의 in-repo 소스다(코드가 진실, 원격에서 직접 편집하지 않는다). **bugshot-web docs-portal이 빌드타임에 `guide/{ko,en}`를 fetch해 `bug-shot.com/{locale}/docs`로 서빙**한다(guide 변경 시 `.github/workflows/trigger-web-deploy.yml`이 Vercel 재배포 트리거).
- **언어별 독립**이다:
  - ko → `https://bug-shot.com/ko/docs`
  - en → `https://bug-shot.com/en/docs`
  - URL 정의: `src/lib/external-links.ts`의 `USER_GUIDE_URLS`. 사이드패널의 "BugShot 가이드" 버튼이 로케일에 맞춰 이 URL로 보낸다.
- 언어별 독립이라 **assets도 언어별로 따로** 둔다(`guide/ko/assets/`, `guide/en/assets/`).
- 커밋 prefix는 **`docs(guide): ...`** (`/push` 신선도 검사의 guide 트리거 대상).

## 2. IA / 파일 트리 (언어당 동일 — ko/en 양쪽 대칭)

25페이지 × 2언어 = 50개 마크다운 + 언어별 `SUMMARY.md`(= 총 52파일) + 언어별 더미 이미지.

```
README.md                       # 1. BugShot 소개 (SUMMARY 최상단 라벨)
quick-start.md                  # 1-1. 빠른 시작
faq.md                          # 1-2. 자주 묻는 질문 (강점 간접 안내 — 단일 페이지, SUMMARY상 소개 하위)
integrations/README.md          # 2. 연동 설정 (개요 + 바로가기)
integrations/platforms.md       # 2-1. 플랫폼 연동
integrations/issue-tracking.md  # 2-2. 이슈 트래킹
settings/README.md              # 3. 기본 설정 (개요 + 바로가기)
settings/issue.md               # 3-1. 이슈 설정
settings/ai.md                  # 3-2. AI LLM 연동
settings/general.md             # 3-3. 일반 (언어·테마·가이드/후기/문의)
element/README.md               # 4. 요소 선택 & 스타일링 (개요 + 바로가기)
element/picker.md               # 4-1. 요소 선택
element/styling.md              # 4-2. 스타일링
element/issue.md                # 4-3. 이슈 작성 (요소 모드, 자기완결)
screenshot/README.md            # 5. 스크린샷 캡처 (개요 + 바로가기)
screenshot/capture.md           # 5-1. 스크린샷 캡처
screenshot/annotation.md        # 5-2. 어노테이션
screenshot/issue.md             # 5-3. 이슈 작성 (스크린샷 모드, 자기완결)
video/README.md                 # 6. 녹화 (개요 + 바로가기)
video/record.md                 # 6-1. 실시간 녹화
video/replay.md                 # 6-2. 30초 리플레이
video/issue.md                  # 6-3. 이슈 작성 (녹화 모드, 자기완결)
logs/README.md                  # 7. 로그 (개요 + 바로가기)
logs/live.md                    # 7-1. 실시간 로그 (+ freeform 흡수)
logs/viewer.md                  # 7-2. 로그 뷰어 (logs.html, 개발자 관점)
assets/<page-slug>-<N>.jpg      # 페이지별 스크린샷 (예: integrations-issue-tracking-1.jpg)
assets/dummy.jpg                # 더미 원본 (placeholder 복사용)
```

**섹션 README는 개요 1~2문단 + 하위 페이지 바로가기**로만 구성한다. 각 섹션 `issue.md`는 캡처 모드별로 **자기완결**(반복 허용) — 사용자가 자기 모드 문서 하나만 열어도 전체 흐름을 알게 한다.

`SUMMARY.md`는 위 트리를 그대로 중첩 리스트로 반영한다(ko 한글 제목 / en 영문 제목, 경로는 동일).

## 3. 페이지 구성 원칙

각 페이지는 헤딩 아래에 (a) 스크린샷 자리 (b) 단계/항목 설명 순서로 구성한다 — **섹션 헤딩 바로 다음에 스크린샷, 그 아래 본문**(과거 "본문 → 스크린샷" 순에서 전환함). 이미지는 해당 섹션 헤딩 직후 한 줄 띄우고 배치하고, 설명 본문이 뒤따른다. 새 페이지를 추가하면 **ko·en을 그 자리에서 동시에** 작성한다(분리 금지 — 드리프트·컨텍스트 손실 방지).

- **H1(페이지 제목) 섹션**은 예외: `H1 → 스크린샷 → 도입 문단` 순. (과거 H1 바로 아래 `🌐` 언어 전환 링크는 §7대로 전부 제거됨.)
- **README(섹션 개요) 페이지**는 현행 유지 — 개요 이미지는 도입 문단 아래(바로가기 직전)에 그대로 둔다.

### 이슈 작성 공통 흐름 (단일 출처 — 3개 `issue.md` 드리프트 방지)

element/screenshot/video 세 `issue.md`는 아래 7단계를 **그대로 반복**하고, 각 페이지는 "고유분"(미디어 종류 + AI 근거)만 다르게 쓴다. 로그 정책은 더 이상 녹화 고유분이 아니다 — 요소 모드를 뺀 세 모드가 동일하다. 본문 섹션(4) 바로 뒤에는 번호 없는 **강조 섹션 `## ✨ AI 초안 작성`(en `## ✨ AI Draft`)** 을 끼운다 — 세 페이지 공통 흐름에 모드별 근거 한 문장만 다르다.

| 단계 | 내용 |
|---|---|
| 1. 제목 | 설정의 제목 접두어(prefill) 적용 |
| 2. 재현 환경 | 자동 메타(OS/브라우저/URL/뷰포트/시각) readonly + 사용자 추가 변수 row |
| 3. 미디어 | **모드별 고유** — 요소=before/after 스타일 표 / 스크린샷=주석 이미지 / 녹화=영상 |
| 4. 본문 섹션 | 발생 현상·재현 과정·기대 결과·비고(설정 토글대로). **문단 섹션 헤더 우측 `[로그 추가][영역 캡처][이미지 추가]`** — 로그 추가는 로그 1건을 본문에 코드블럭으로 넣는다(요소 모드는 로그가 없어 비활성, 재현 과정은 번호 목록이라 버튼 없음). 아래 사실 스냅샷 "로그 본문 추가" 참조 |
| ✨ AI 초안 작성 | 번호 없는 강조 섹션. 배너(AI 연결 시) → 입력창에 버그 한 줄(요소 모드는 비워도 됨) → **제목+본문 한 번에** 채움(켜 둔 섹션만, 접두어 유지). 사용자가 **이미 적어 둔 제목·본문도 컨텍스트로 참고**하고, 본문에 붙인 **inline 이미지는 보존(텍스트만 교체)**. **모드별 근거**: 요소=before/after 스타일·전후 이미지 / 스크린샷=주석 이미지 / 녹화=콘솔·네트워크·액션 로그 요약. **주의 — 로그 첨부 스코프와 AI 근거 스코프는 다르다**: 로그는 요소 모드를 뺀 전 모드에 *첨부*되지만, AI 초안의 *근거로 들어가는 건 녹화·이슈 작성(freeform)뿐*이다. 스크린샷은 로그가 첨부돼도 AI 근거는 주석 이미지다 — "스크린샷 AI가 액션 로그를 본다"고 쓰지 말 것 |
| 5. 로그 첨부 | 요소=없음 / **스크린샷·녹화·이슈 작성 모두 콘솔·네트워크·액션 3종 기본 on** (로그별로 해제 가능) |
| 6. 미리보기 | 제출 전 본문 확인 + 복사 |
| 7. 제출 | 플랫폼 필드 입력(필드 맨 아래 **참조**(CC) 멀티셀렉트 포함 — 본문 푸터 직전 `cc @이름` 멘션 + 알림, 직전 선택 prefill) → 완료 URL |

## 4. 사실 대조 소스 (코드가 진실 — 추측 금지)

가이드의 사실이 코드와 어긋나면 안 된다. 불확실하면 **반드시 아래 소스를 재확인**한다.

| 사실 | 소스 경로 |
|---|---|
| 단축키 | `manifest.config.ts` commands (배정값 신뢰 — 화면은 `chrome.commands.getAll()`로 동적 표시) |
| 본문 섹션 기본값·형식 | `src/store/settings-ui-store.ts` (`DEFAULT_ISSUE_SECTIONS`) |
| 본문 섹션 라벨/플레이스홀더 | `src/i18n/namespaces/issue.ts`, `editor.ts` |
| 캡처 모드·freeform 버튼 라벨 | `src/i18n/namespaces/issue.ts` (`issue.mode.*`, `issue.startDraft`) |
| 스타일 패널 섹션·순서 | `src/sidepanel/tabs/StyleEditorPanel.tsx` (라벨은 `editor.ts`) |
| 스타일 편집/CSS 뷰·왕복 | `src/sidepanel/tabs/StyleEditorPanel.tsx`(탭·아이콘 Paintbrush/Code2) · `styleEditor/StyleCssView.tsx`(CSS 뷰)·`CssCodeMirror.tsx`(CodeMirror·하이라이트·swatch·자동완성) · `styleEditor/cssBlock.ts`(serializeCssBlock/parseCssBlock/computeOverrides·collapseTrbl/expandTrbl) · `inlineCssText.ts`(재사용) · `settings-ui-store.ts`(`styleEditorView` 영속) · 탭 라벨 `editor.ts` `editor.view.*`(편집/CSS) |
| AI 배너 라벨 | `src/i18n/namespaces/ai.ts`, `editor.ts` |
| AI 가용성·폴백 흐름 | `src/sidepanel/hooks/useAI.ts`, `ai-provider.ts` (BYOK → Chrome 내장 AI → 미노출) |
| 캡처 방식 3축(영역·화면·페이지 전체)·스크롤 캡처 | `src/sidepanel/scroll-capture.ts`(오케스트레이터·truncated 판정) · `src/content/scroll-capture.ts`(자동 스크롤·fixed 요소 은폐/복원) · `src/sidepanel/lib/scroll-capture-plan.ts`(타일 계획·상한·스티치 좌표) · 라벨 `src/i18n/namespaces/issue.ts`(`issue.capturing.method.*`/`.scrolling`/`.canceling`/`.progress`/`.truncated`) · UI `src/sidepanel/tabs/IssueTab.tsx`(CapturingState 하단 툴바) |
| 어노테이션(스크린샷 주석) | `src/sidepanel/components/AnnotationOverlay.tsx` + `annotation/AnnotationToolbar.tsx`·`presets.ts` (BugShot 자체 konva 툴바 — 도구/색상/두께, 라벨은 `editor.ts` `annotation.*`로 ko/en 현지화) + **줌·팬**: `annotation/ZoomControl.tsx`(컨트롤 UI) · `annotation/viewport.ts`(fit-width/fit-all 계산·줌 스톱·중앙 앵커·팬 델타 순수 함수 단일 출처) |
| 녹화 중 그리기(펜·사각형·형광펜) | `src/content/annotation.ts`(SVG 오버레이·EMA 스무딩·트레일 페이드 / 사각형은 `annotation-draw.ts:rectPoints`로 네 꼭짓점을 같은 시각에 찍어 통째로 만료 — 펜은 꼬리부터, 박스는 한 번에 사라진다) + `src/sidepanel/annotation-control.ts`(`setAnnotationTool` — `annotation.setTool`은 메시지 타입) + `src/sidepanel/components/annotation/{ToolbarGroups,recording-pen}.ts`(konva와 공유 툴바·스타일) + editor-store `annotationTool/Color/Thickness` + i18n `annotation.pen`/`.rect`/`.highlight`/`.color.*`/`.thickness.*`(`issue.recording.penHint`는 Esc 툴팁) — **스크린샷 주석(konva)과 벡터 스타일 동일·별개 기능** |
| 리플레이 트리밍 | `src/sidepanel/tabs/ReplayTrimDialog.tsx`·`TrimTimeline.tsx`, 백엔드 `src/sidepanel/30s-replay/trim-math.ts`·`apply-trim.ts`, 라벨 `src/i18n/namespaces/issue.ts` (`issue.replay.trim.*`) |
| 로그 본문 추가(문단 섹션 [로그 추가] → 다이얼로그 → 코드블럭 삽입) | `src/sidepanel/lib/logToCodeBlock.ts`(직렬화) · `src/sidepanel/components/LogInsertDialog.tsx` · `src/sidepanel/tabs/DraftingPanel.tsx`(SectionTextarea), 게이트 `src/sidepanel/lib/captureLogSupport.ts`, 라벨 `src/i18n/namespaces/editor.ts`(`draft.insertLog`/`.empty`, `logInsert.*`)·`logs.ts`(`debug.tab.*` 재사용) |
| 로그 정책(모드별 기본 on/off) | `src/sidepanel/lib/captureLogSupport.ts`, `src/store/editor-store.ts` |
| 네트워크 캡처 대상·WebSocket | `src/content/network-recorder.ts`(fetch/XHR/sendBeacon/WebSocket 후킹), WS 라벨 `src/i18n/namespaces/logs.ts` (`networkLog.filter.ws`/`tab.messages`/`ws.*`) |
| 로그 출처 필터(iframe) | `src/sidepanel/lib/logOrigin.ts` (`originKey`/`originHostLabel`/`originCounts`/`UNKNOWN_ORIGIN`), `src/sidepanel/components/OriginFilterBar.tsx`, 라벨 `src/i18n/namespaces/logs.ts` (`log.originFilter.unknown`) |
| iframe 요소 선택 지원 | picker `all_frames`(`manifest.config.ts`), 거부 문구 `src/i18n/namespaces/app.ts` (`app.iframeUnsupported.*`) |
| 로그 뷰어 마커 | `src/log-viewer/markers.ts` (`MarkerType`: console/network/action, navigate는 action variant) |
| 액션 로그 동작 종류 | `src/types/action.ts` (`ActionEntryKind`), 라벨 `src/i18n/namespaces/logs.ts` (`actionLog.filter.*`/`verb.*`), 렌더 `src/sidepanel/components/ActionLogContent.tsx` |
| 녹화 모드·파일 첨부·리플레이 설정 라벨 | `src/i18n/namespaces/settings.ts` + `src/sidepanel/components/RecordingSettingsCard.tsx` + `src/store/settings-ui-store.ts` |
| 가이드 URL (bug-shot.com/{locale}/docs) | `src/lib/external-links.ts` (`USER_GUIDE_URLS`) |
| 연동 탭 **서브탭** 자동 선택(내 연동/플랫폼 추가) | `src/sidepanel/tabs/integrationsTabUtils.ts` (`pickInitialSubTab`) |
| 연동 CTA 배너(연동 0개 유도) | `src/sidepanel/components/IntegrationsCta.tsx`, 라벨 `src/i18n/namespaces/app.ts` (`platform.cta.body`/`.action`) |
| 참조(CC) 멀티셀렉트·멘션 | `src/sidepanel/lib/ccMention.ts`(멘션 노드) · `buildMarkdownIssueBody.ts`(푸터 직전 삽입) · `hooks/usePlatformFields.ts`(상위값 스코프 prefill) · 라벨 `src/i18n/namespaces/settings.ts`(`field.cc.*`). **CC는 Slack 제외 7개 플랫폼** — Slack만 CC 대신 `mentions`(`src/types/platform.ts`) |

### 현재 사실 스냅샷 (작성 시점 기준 — 코드 변경 시 갱신)

- **단축키**: `Cmd/Ctrl+Shift+E`(패널 토글) **1개만**. best-effort라 OS·타 확장 충돌 시 미배정될 수 있음을 한 줄 안내(그땐 툴바 아이콘으로). **캡처 단축키는 모두 제거됨** — 요소 선택·스크린샷·요소 캡처·탭/화면 녹화 등 캡처는 전부 **버튼 전용**(과거 캡처 단축키는 모두 제거됨 — manifest commands엔 패널 토글만 남음). 패널 토글만 유일한 command라 가이드 본문의 단축키 표기도 `quick-start`의 `Cmd/Ctrl+Shift+E` 1곳뿐이다(video/issue·logs/viewer의 "단축키 입력"은 액션 로그가 기록하는 사용자 동작 설명이지 확장 단축키가 아님 — 무관).
- **본문 섹션**: 발생 현상(켜짐·문단) / 재현 과정(켜짐·번호 목록) / 기대 결과(켜짐·문단) / 비고(꺼짐·문단). 라벨·플레이스홀더 override 가능.
- **연동 0개일 때의 진입 동작**: 사이드패널을 열면 연동 여부와 무관하게 **디버그(캡처) 탭에 착지**한다. 패널을 닫았다 열어도 같다. **과거의 "연동 0개면 연동 탭으로 자동 전환" 동작은 제거됐으니 가이드에 쓰지 않는다**(stale). 대신 연동이 0개인 동안 노란색 CTA 배너가 **캡처 진입 화면·미리보기 화면 하단**(그리고 저장된 초안 상세에서 제출 가능한 플랫폼이 없을 때)에 노출된다 — 문구 ko `플랫폼을 추가해 이슈를 등록하세요.` / en `Add a platform to start filing issues.`, 우측 액션 ko `플랫폼 추가` / en `Add platform`, 누르면 연동 탭으로 이동. 배너는 **닫기(dismiss)가 없고** 연동이 생길 때까지 계속 뜬다. 다만 어떤 탭도 비활성화되지 않고 **캡처·초안 작성·미리보기·복사는 연동 0개에서도 그대로 동작**한다 — 막히는 건 "플랫폼에 이슈 제출"뿐. (과거 미리보기·초안 상세의 회색 안내 박스 "연결된 플랫폼이 없습니다 / 연동 탭에서 플랫폼을 먼저 연결하세요."는 이 배너로 대체·삭제됨.) 대상: `README.md`(탭 소개)·`quick-start.md`(3. 플랫폼 연결하기)·`integrations/README.md`. 연동 탭 **안**의 서브탭 자동 선택(연결 0개→`플랫폼 추가`, 1개+→`내 연동`)은 별개 동작이며 그대로 유효하다(`integrations/platforms.md`).
- **스타일 편집/CSS 뷰**: 요소 스타일 편집 패널 상단(요소 이름 밴드 아래, sticky, `border-t` 구분)에 **편집/CSS 2탭**(`editor.view.form`/`.code` = `편집`/`CSS`, en `Edit`/`CSS`, 아이콘 Paintbrush/Code2, shadcn Tabs). 기본 **편집**. **CSS** 탭은 **CodeMirror 6 CSS 에디터**(신택스 하이라이팅·줄번호·자동완성[prop명 lang-css + 값 커스텀])로, 요소의 현재 `specifiedStyles`를 `selector { … }` 블록으로 **prefill**(빈 출발 아님)한다. 표시는 borderless로 섹션을 채우고, 4면 longhand를 shorthand로 **병합**(`collapseTrbl`, 폼 링크 병합과 동형), selector 파랑·property 앰버 하이라이트, 색상 값 좌측 인라인 **swatch**(`var(--x)` 토큰은 computed의 resolve 색), `{}` 표시 truncate. 편집은 v1 `styleEdits.inlineStyle` 오버라이드 모델 계승 — prefill 값을 그대로 두면 변경 0(phantom diff 없음), 값 변경/추가는 그 prop만 오버라이드, **선언 라인 삭제=`initial` 원복**(순수함수 `computeOverrides`). 임의 속성(`cursor` 등)·`!important`(값 끝에 붙이면 적용) 입력 채널은 유지. 두 탭은 같은 `inlineStyle` 단일 출처를 공유해 **양방향 동기화**(왕복 무손실). 고른 탭은 **영속**(`styleEditorView` in `settings-ui-store.ts`, 기본 `form` — 값은 그대로 `"form"|"code"`). **class·Text 섹션은 편집 탭 전용**(CSS 탭에서 hidden — v1의 '두 모드 공통'에서 바뀜). 변경사항 보기·AI 배너·푸터는 두 탭 공통. CodeMirror는 사이드패널 전용 lazy 청크(메인 번들 미포함). 대상: `element/styling.md`(ko "편집 탭과 CSS 탭" / en "The Edit and CSS tabs").
- **파일 첨부 토글**: 설정 > 이슈 설정 > 본문 구성에 `파일 첨부`(en `File attachments`) 토글, **기본 꺼짐**(`attachmentsEnabled` in `settings-ui-store.ts`). 켜면 이슈 작성(drafting) 화면에 `첨부 파일`(en `Attachments`, `section.attachments`) 영역 노출 → 임의 로컬 파일 선택. **최대 10개·합계 50MB** 하드캡(`src/sidepanel/lib/attachmentLimits.ts`), 플랫폼별 단건 경고(Notion 5MB·GitLab 10MB, 초과 시 "용량 초과" 표시·차단 아님). 제출 시 8개 플랫폼에 함께 업로드(Slack은 메시지 스레드 첨부). 기능 위치상 settings/issue.md에만 두고 중립적 기능 설명 톤으로 기술한다(3개 mode issue.md 공통 흐름엔 미편입).
- **재현 단계 자동 채움**: 설정 > 이슈 설정에 **AI 설정** 섹션(`settings.aiSection` = `AI 설정`/en `AI settings`, 녹화 설정과 본문 구성 사이)이 있고, 그 안에 **재현 과정 채우기** 토글(`settings.autoReproPrefill.label` = `재현 과정 채우기`/en `Fill steps to reproduce`, `autoReproPrefill` in `settings-ui-store.ts`, **기본 켜짐**). 켜져 있으면 **녹화(video) 모드**로 이슈 작성(drafting)에 진입할 때 재현 과정(stepsToReproduce)이 비어 있고 AI(BYOK/Chrome 내장)가 가용하면, **액션 로그를 근거로 재현 과정을 자동 작성**한다(`useReproPrefill`). 본문 설정에서 **재현 과정 섹션이 꺼져 있으면** 자동 채움은 발화하지 않고(`isReproSectionEnabled` 단일 출처 — `sidepanel/lib/reproSectionEnabled.ts`), 설정의 이 토글도 **ON/OFF 값을 유지한 채 비활성**이 된다(설명 문구는 비활성 여부와 무관하게 `settings.autoReproPrefill.help` 고정). AI 미가용·빈응답이면 **채우지 않고** 비워 둔다(토스트로 재시도 안내). 채우는 동안 AI 초안과 **같은 패널 전역 보라색 오버레이**(App.tsx `useAiLoading`)가 덮인다. 동작 시 액션 로그가 연결된 AI로 전송된다(프라이버시 고지 — settings/issue.md·privacy). 재현 과정 섹션 헤더 우측엔 **전체 초기화** 휴지통 버튼(`draft.stepsReset` = `전체 초기화`/en `Clear all`, 값 있을 때만 활성)이 있어 한 번에 비운다. **video 전용**(element/screenshot엔 자동 채움 없음 — captureMode 게이트). 대상: `settings/issue.md`(AI 설정 절)·`video/issue.md`(본문 섹션 재현 과정 자동 채움). manual 전체 `✨ AI 초안 작성`(제목+본문 일괄)과는 별개 기능이다.
- **녹화 모드 설정**: 캡처 진입 화면(디버그 탭)의 **녹화 버튼은 1개**(`mode-record`)이고, 탭/화면 중 무엇을 녹화할지는 **설정 > 이슈 설정 > 녹화 설정 > 녹화 모드** Tabs에서 고른다(`recordingMode` in `settings-ui-store.ts`, 기본 `tab`). 설정 섹션 제목은 `녹화 설정`/en `Recording settings`(`settings.recording` 키, 30초 리플레이도 같은 섹션). 설정 Tabs 라벨은 짧게 `탭`/`화면`(en `Tab`/`Screen`, `settings.recordingMode.tab`/`.screen`, **아이콘 없음**) — 캡처 화면 녹화 버튼 라벨 `탭 녹화`/`화면 녹화`(`issue.mode.video`/`.screenRecord`)와 **키·문구 분리**. 고른 모드는 캡처 화면 녹화 버튼 아이콘·라벨에 라이브 반영(`recordModeMeta`: tab→AppWindow, screen→MonitorPlay). **캡처 진입 화면 레이아웃은 1x2x2**: Row1 `[요소 스타일 편집]`(primary 단독, 전체폭) / Row2 `[요소 캡처][스크린샷]`(ButtonGroup) / Row3 `[녹화 버튼][30초 리플레이]`(ButtonGroup). 녹화 모드 변경은 **설정 탭 단일 경로** — 진입 화면엔 ⚙ 톱니바퀴·녹화 설정 다이얼로그가 **없다**(revert-idle-capture-layout에서 제거). **비활성 30초 리플레이 버튼**을 클릭하면 다이얼로그가 아니라 **설정 탭(이슈 설정)으로 이동**한다(`navTo("settings","issue")`). 설정 탭의 녹화 설정 카드는 공용 컴포넌트(`RecordingSettingsCard`, store 단일 출처)다. (과거 Row3 3-segment `[녹화][리플레이][⚙]` + `RecordingSettingsDialog`는 제거됨 — `video/record.md`·`settings/issue.md`·`video/replay.md` 대상.)
- **리플레이 트리밍**: 30초 리플레이 캡처 직후 이슈 초안 위로 **트리밍 오버레이**가 자동으로 **한 번만** 뜬다(설정값 아님 — 순수 캡처 후 단계). 오버레이 상단은 **아이콘 4탭**(`영상`/`콘솔`/`네트워크`/`액션` — en `Video`/`Console`/`Network`/`Action`, 라벨 키 `issue.replay.trim.tab.video`·`issue.replay.trim.log.*`)이고 각 로그 탭엔 캡처 개수 Badge가 붙는다(0건도 표시·999 초과 `999+`). 영상 탭은 가운데에서 `<video>`로 재생, 로그 탭으로 전환하면 같은 자리에 로그 뷰어와 동일한 로그 목록이 인라인으로 펼쳐진다(0건이어도 empty로 조회 가능, 네트워크 탭은 상대 timestamp 표시·2-pane 유지). **타임라인 손잡이·재생/일시정지·되돌리기/다시 실행/확정/작성 취소는 전 탭 전역**. 영상 양쪽 끝의 **시작 지점·끝 지점**(en `Start`/`End`) 손잡이를 끌어 버그 구간만 남긴다. 손잡이를 끌면 **잘려나갈 로그가 로그 탭에서 실시간으로 흐림(opacity-40) 처리**돼 무엇이 빠질지 미리 확인된다(레벨/status 색상과 병렬일 때도 구분됨, 네트워크는 요청 리스트 row만 흐림·상세 pane 영향 없음). **재생은 영상 탭에서** — 로그 탭에선 자동 일시정지되고, play 버튼을 누르면 영상 탭으로 돌아가 재생된다. 타임라인의 **콘솔·네트워크 에러 마커 + 페이지 이동(action navigate) 마커**를 누르면 해당 로그 탭으로 전환된다(과거 마커 클릭→로그 다이얼로그 방식은 제거). **확정**(en `Apply`)하면 그 구간만 영상이 재인코딩되고 첨부 로그도 같은 구간으로 좁혀진다(흐림으로 표시됐던 로그가 그대로 빠짐 — 미리보기=실제 일치, 전체 그대로 확정하면 30초 유지). **작성 취소**(en `Discard`)는 캡처를 폐기하고 진입 화면으로. 확정하면 원본은 정리돼 재편집 불가. UI 라벨은 `issue.replay.trim.*`(§6 영문 식별자 금지 대상 — 확정/작성 취소 등 현지화 라벨 사용). 대상: `video/replay.md`(ko "구간 자르기" / en "Trimming the clip"). (과거 로그별 미리보기 다이얼로그 방식 → 인라인 탭 + muted 미리보기로 전환됨 — replay-trim-refactor.)
- **캡처 방식 3축(스크린샷 안)**: `스크린샷`(en `Screenshot`)을 누르면 십자선이 뜨고 **사이드패널 하단에 캡처 방식 아이콘 버튼 3개**(ButtonGroup, 호버 시 툴팁)가 노출된다 — `영역 캡처`/en `Area capture`(기본 활성, 드래그) · `화면 캡처`/en `Screen capture`(보이는 뷰포트 전체, 드래그 없이 1클릭) · `페이지 캡처`/en `Page capture`(스크롤하며 타일 캡처 → 세로 스티칭). 라벨 키 `issue.capturing.method.area`/`.viewport`/`.fullPage`(`src/i18n/namespaces/issue.ts`). 페이지 캡처 진행 중엔 EmptyShell 문구가 `페이지를 캡처하는 중…`(en `Capturing the page…`)으로 바뀌고 **% 진행률 + 진행 바**가 뜨며, `취소`를 누르면 `캡처를 취소하는 중…` 후 페이지 스크롤·고정 요소가 원복되고 idle로 돌아간다. 제약(가이드에 명시): ① `position: fixed` 헤더는 **첫 타일에만** 남기고 이후 타일에선 숨김(반복 인쇄 방지) ② **세로만** 스티칭(가로 오버플로는 보이는 폭까지) ③ 아주 긴 페이지는 상한까지만 담고 `페이지가 길어 일부만 캡처했습니다` toast ④ 캡처 중 페이지 **클릭·스크롤 모두 차단**(blocker가 wheel/touchmove를 `preventDefault` — 휠 조작이 먹지 않는다. 페이지가 밀리면 타일이 어긋나게 스티칭되기 때문). 코드: `src/sidepanel/scroll-capture.ts`(오케스트레이터)·`src/content/scroll-capture.ts`(스크롤·고정 요소)·`src/sidepanel/lib/scroll-capture-plan.ts`(타일 계획·스티치 좌표). 대상: `screenshot/capture.md`(ko/en), `quick-start.md`(스크린샷 한 줄).
- **어노테이션 도구**: 스크린샷 주석 편집기는 BugShot **자체 toolbar(konva 기반**, `AnnotationOverlay.tsx` + `annotation/AnnotationToolbar.tsx`)이고 **라벨이 ko/en 현지화**돼 있다(`editor.ts` `annotation.*`) — **과거 "markerjs2 영문 툴바" 안내는 stale이니 쓰지 않는다.** 각 아이콘 버튼은 **호버 시 툴팁**을 띄운다(캡처 방식 툴바와 같은 공용 `TooltipIconButton` — 이미지·녹화 어노테이션 툴바 공통). 도구: 선택/펜/화살표/사각형/원/텍스트/형광펜(`ANNOTATION_TOOLS` 순서 — 펜이 화살표 앞), 색상 5종(빨강·노랑·초록·파랑·검정), 선 두께 3단계(얇게·보통·굵게 — 선·도형·펜·형광펜에 적용. 텍스트는 두께 대신 글자 크기 3단계(작게·보통·크게)), 실행 취소·다시 실행, 삭제, 취소·주석 완료. **선택 도구와 그리기 도구는 상호 배타**다 — 2단 스타일 행(색상 + 두께/글자 크기)은 **항상 렌더되지만 선택 도구(=그리기 도구 미선택)에선 disabled**이고, 잠긴 동안에도 직전 그리기 도구의 형태(두께 vs 글자 크기)를 유지한다. 선택한 도형의 색·두께를 나중에 바꾸는 재스타일 기능은 **없다**(과거엔 있었으나 제거 — 가이드에 쓰지 말 것). 추가·수정·제거 진입 버튼은 drafting 화면(`draft.addAnnotation`/`.editAnnotation`/`.removeAnnotation`). **캔버스 줌·팬**: 편집기는 **선택 도구가 켜진 채로** 열리고, 진입 배율은 **너비 맞춤**(fit-width — 이전의 전체 맞춤에서 바뀜. 페이지 전체 캡처가 15%로 열려 식별 불가하던 문제). 캔버스 **하단**에 플로팅 배율 컨트롤 `[−][n% ▾][+]`(`annotation.zoomOut`/`zoomLevel`/`zoomIn`)와, 배율을 조작했을 때만 나타나는 **너비 맞춤** 버튼(`annotation.zoomFit`)이 뜬다. 콤보박스 항목 순서는 `이미지 전체(n%)`(`annotation.zoomFitAll` — fit-all, 세로로 긴 이미지에서만 노출) → `너비 맞춤(n%)` → fit보다 큰 프리셋(최대 400%) — 오름차순이라 전체가 맨 위. 확대·축소 앵커는 **뷰포트 중앙**. **팬**은 선택 도구로 빈 캔버스를 드래그(커서 `grab`), 도형 위 드래그는 도형 이동. 캔버스 뷰포트는 포커스 가능해 **화살표 키 스크롤** 지원. 배율 컨트롤은 도구와 무관하게 **항상 활성**이고, 배율을 바꾸면 `applyScale`이 **그리기 도구를 `select`로 강제 해제**한다(컨트롤이 캔버스 하단을 가리므로 그 위를 눌렀다면 그리려던 게 아니라는 전제). 컨트롤이 없는 영역은 `pointer-events-none`으로 통과시켜 그리기·팬을 막지 않는다. **완료 결과물은 배율과 무관하게 원본 해상도**. 가이드엔 내부 라이브러리명 노출 없이 "한국어로 표시되는 자체 툴바" 수준으로 기술. 대상: `screenshot/annotation.md`.
- **녹화 중 그리기(펜·형광펜)**: 탭/화면 녹화 중 사이드패널 RecordingState **하단 그리기 툴바**(취소·제출 액션이 없는 순수 툴바라 흰 배경 `bg-background` — action footer 아님) — `[펜(annotation.pen)·사각형(annotation.rect)·형광펜(annotation.highlight)] [색 스와치 5개(annotation.color.*)] [두께 얇게/보통/굵게(annotation.thickness.*)]` — 도구가 좌측, 색이 중앙. `[취소][녹화 완료]`는 그 위 중앙 클러스터. 펜/형광펜을 골라(같은 툴 재클릭=끄기) 페이지를 드래그해 자유 곡선을 그린다. 형광펜=반투명·두께 배율(마커 느낌). 색·두께는 이미지 어노테이션(konva)과 **동일 프리셋·공유 컴포넌트**(`ToolbarGroups.tsx`) 재사용이라 **벡터 스타일이 동일**하다(EMA 스무딩). 각 획은 **그린 순서대로 시작점부터 ~3초에 걸쳐 꼬리부터 페이드**(Jam식 트레일 — 과거 "통째로 3초 후 사라짐"에서 전환). `[취소][녹화 완료]`는 중앙 클러스터에 유지되고 그리기 툴바만 footer로 분리. 페이지 **Esc** 또는 켠 툴 재클릭으로 끈다. 그린 획은 녹화 영상에 그대로 포함(순수 시각 효과 — 저장·첨부 없음). **화면 녹화로 다른 창/모니터를 공유 중이면 BugShot을 연 탭 위에만 그려져** 그 영상엔 안 담길 수 있다(인앱 안내 없음 — 가이드에만 명시). 상태는 editor-store `annotationTool/Color/Thickness`(비영속), 메시지 `annotation.setTool`. **스크린샷 어노테이션(konva 툴바)과 별개 기능**(`src/content/annotation.ts` — SVG 오버레이). (과거 단일 "화면에 그리기" 토글 버튼 `issue.recording.pen`은 제거됨 — `penHint`만 Esc 툴팁으로 잔존.) 대상: `video/record.md`.
- **로그 정책**: 요소=로그 없음 / **스크린샷·이슈 작성(freeform)·녹화 = 콘솔·네트워크·액션 3종 모두 토글 기본 on**. 액션 로그가 녹화 전용이라는 과거 서술은 **stale이니 쓰지 않는다**(v1.5.8에서 세 로그가 동일 스코프가 됨 — 요소 모드만 로그 없음). 로그는 **사이드패널이 열려 있는 동안 캡처 시작 전부터** 수집되고, 캡처에 진입하면 그 버퍼가 그대로 이월된다("캡처를 켜야 모이기 시작한다"고 쓰지 말 것). 자동 수집은 trailing throttle로 실시간 스트리밍(레코더 ~200ms flush, 사이드패널 IDB 저장은 ~1s로 묶음) — 과거 "~1.5초" 표기는 stale이니 가이드엔 구체 숫자 대신 "실시간"으로.
- **로그 본문 추가**: 발생 현상·기대 결과·비고 같은 **문단(paragraph) 섹션** 헤더 우측 ButtonGroup `[로그 추가][영역 캡처][이미지 추가]`의 첫 버튼(`draft.insertLog` = `로그 추가`/en `Add log`, 아이콘 FileCode). 재현 과정은 번호 목록이라 이 그룹이 없다. 누르면 **로그 추가** 다이얼로그(`logInsert.dialog.title` = `로그 추가`/en `Add log`) — 상단 **콘솔·네트워크 2탭**(라벨은 디버그 하위탭과 공유 `debug.tab.console`/`.network` = `콘솔`/`네트워크`, en `Console`/`Network`, 각 탭에 개수 배지)이고 하단은 로그 탭과 같은 목록·검색·필터·상세 뷰. 한 건을 고르고 **추가**(`logInsert.insert` = `추가`/en `Add`)를 누르면 커서 위치에 코드블럭으로 들어간다. 네트워크=요청 경로·상태 코드 + 요청·응답 본문(JSON이면 정렬), 콘솔=메시지(+error면 스택). **로그가 없거나 로그를 안 싣는 모드(요소)면 버튼 비활성**(툴팁 `draft.insertLog.empty` = `추가할 로그가 없습니다`/en `No logs to add`). 삽입 결과는 **그냥 마크다운 텍스트**라 이후 자유롭게 수정·삭제 가능하고 영속 상태가 없다. **긴 코드블럭은 접혀서 렌더된다**(아래 "코드블럭 접기" 참조). **`logs.html` 첨부(로그 카드 토글)와 별개 기능** — 첨부는 파일을 열어야 보이고, 이건 이슈 본문 평문에 노출된다. **프라이버시**: 캡처 시점 마스킹만 적용되고 콘솔 args·stack은 **마스킹이 없어 원문 그대로** 들어가니 가이드에 주의를 함께 쓴다(privacy.{ko,en}.md와 같은 사실). 코드: `sidepanel/lib/logToCodeBlock.ts`(직렬화)·`components/LogInsertDialog.tsx`·`tabs/DraftingPanel.tsx`(SectionTextarea), 게이트 `lib/captureLogSupport.ts`. 대상: `screenshot/issue.md`·`video/issue.md`(본문 섹션 절)·`logs/live.md`(freeform 절).
- **코드블럭 접기**: **16줄 이상**(임계값 15 — `CODE_COLLAPSE_LINE_THRESHOLD` in `src/sidepanel/lib/codeCollapse.ts`) 코드블럭은 15줄 높이로 **접힌 채** 렌더되고 하단이 페이드 처리된다. 코드블럭에 hover하면 하단 중앙에 pill이 뜬다 — 접힘 `펼치기 ({count}줄)`/en `Expand ({count} lines)`, 펼침 `접기`/en `Collapse`(`codeBlock.expand`/`.collapse` in `src/i18n/namespaces/editor.ts`). 괄호 안 숫자는 **블럭의 전체 줄 수**다. **로그 코드블럭만이 아니라 모든 코드블럭**에 같은 규칙이 적용된다(삽입된 로그와 손으로 친 코드블럭은 마크다운상 구분 불가). 적용 표면은 이슈 작성 에디터·미리보기·저장된 초안 상세·`logs.html` 리포트 탭. 에디터에서 **접힌 블럭 안에 커서를 넣으면 자동으로 펼쳐지고**, 커서가 나가도 펼침이 유지된다. **접힘은 순수 표시 상태다** — 영속되지 않고(화면을 옮기면 다시 접힌 상태로 시작), 마크다운 복사·8개 트래커로 나가는 이슈 본문·`logs.html`엔 **전문이 그대로** 들어간다. 가이드엔 "긴 로그는 접혀서 들어가고 pill로 펼친다 + 등록되는 본문엔 전문이 그대로"를 안심 톤으로 쓰고, 임계값 숫자(15줄)는 노출해도 무방. 대상: `screenshot/issue.md`·`video/issue.md`(로그 본문 넣기 절 — `logs/live.md`는 그 두 페이지로 상세를 위임하므로 미기술).
- **액션 로그 프라이버시**(가이드에 반드시 반영): 입력값(최대 500자)·드롭다운 선택값은 **마스킹에 걸리지 않으면 원문 그대로 기록·첨부**된다. 클릭·드래그한 **요소의 화면 표시 텍스트(접근가능 이름, 최대 80자)도 함께 기록**된다. 마스킹은 2층 — ① 필드 종류·라벨(비밀번호 타입, autocomplete, 이름/id/aria-label/연결 라벨/placeholder의 민감 키워드, 한국어 포함) ② 값 형태(이메일, 9자리 이상 숫자열=전화·카드·주민·계좌). 마스킹의 값 형태 기준은 **입력값뿐 아니라 요소 이름·필드 라벨에도 적용**된다. 리치 텍스트 편집기(메일 본문·문서)는 **값으로도 요소 이름으로도 안 남기고** 입력 사실만 기록. 다만 **라벨·값 어느 쪽에도 단서가 없는 값(검색어·일반 텍스트)은 원문이 남으므로**, 민감 화면에선 제출 전 로그 첨부를 끄라고 안내한다. 로그 첨부는 기본 on이고 작성 화면의 로그 카드에서 로그별로 해제 가능. 대상: `logs/viewer.md`·각 `issue.md`의 로그 첨부 단계.
- **네트워크 캡처 범위** (`src/content/network-recorder.ts`): fetch·XHR·`sendBeacon`에 더해 **WebSocket** 연결·프레임도 캡처한다. 연결은 네트워크 목록에 행 1개(status 101)로 뜨고, 행을 열면 상세 **메시지**(en `Messages`) 탭에서 송수신 프레임을 시간순으로 본다(방향 필터 전체/송신/수신, `WS` 목록 필터). **텍스트 프레임만** 담고 바이너리(이미지·파일 등)는 내용 없이 드롭하며 담기지 않은 프레임 개수(바이너리 + 연결당 상한 초과분)를 메시지 탭 상단에 표시. 가이드엔 내부 메커니즘 노출 없이 "실시간 양방향 통신을 주고받은 메시지로 본다" 수준으로만 기술. 대상: `logs/live.md`.
- **콘솔 캡처 범위** (`src/content/console-recorder.ts`): `log`/`info`/`debug`는 상시 wrap, `console.error`/`console.warn`은 **패널이 arm된(디버그·녹화로 캡처 중인) 동안만** wrap해 캡처(chrome://extensions 오류 로그 attribution 오염을 arm 구간으로 한정). `trace`/`assert`(→error)/`dir`/`dirxml`/`table`/`group*`/`count*`/`time*`/`timeStamp`/`clear`도 기존 5레벨(주로 log)에 매핑, uncaught 예외·unhandled rejection은 상시 error로. 가이드엔 내부 메커니즘(arm-스코프 wrap) 노출 없이 "정보·경고·에러까지 빠짐없이 모아 본다" 수준으로만 기술.
- **iframe 요소 선택**: 요소 선택(picker)이 **1-depth iframe**(페이지에 직접 박힌 프레임) 내부 요소까지 지원한다 — cross-origin(결제 창·임베드 위젯 등) 포함해 선택·스타일 편집·캡처 가능. **중첩(프레임 안의 프레임)·sandbox**로 막힌 프레임만 안쪽 접근 불가 → 안내 다이얼로그(`app.iframeUnsupported.title/body`, ko "이 iframe은 선택할 수 없습니다" / en "This iframe can't be selected") + 선택 취소. 거부 문구가 안내하는 폴백은 **스크린샷**(en Screenshot). 가이드엔 내부 메커니즘(프레임 핸드셰이크·좌표 변환) 노출 없이 "대부분의 iframe 내부 요소도 그대로 다룬다, 중첩·sandbox만 예외" 수준으로. 대상: `element/picker.md`(ko/en, "iframe 안의 요소" 소절). (과거 "iframe 내부는 선택 불가" 안내는 stale — 쓰지 않는다.)
- **로그 출처(iframe) 필터**: 콘솔·네트워크 로그는 cross-origin iframe(결제 위젯·임베드 등) 로그까지 수집한다. 출처가 2개 이상 섞이면 콘솔·네트워크·액션 로그 탭 모두에 출처 필터 바(`OriginFilterBar`, 사이드패널 서브탭·로그 다이얼로그·log-viewer 공용) 노출 — 호스트별 버튼(각 버튼에 출처별 로그 개수 muted 표시) + opaque(`data:`/`about:blank`) 묶음 라벨 ko "(알 수 없음)" · en "(unknown)". **"전체" 버튼은 없음** — 아무것도 선택하지 않은 상태가 전체이고, 선택된 출처 버튼을 다시 누르면 해제(toggle)된다. (초기엔 액션 로그를 출처 필터에서 제외했으나, top↔iframe 액션이 섞이면 navigation만으론 출처 추적이 안 돼 액션에도 추가함.)
- **AI 가용성**: BYOK LLM 연결 시 그 모델(배지=프로바이더명) → 미연결 시 Chrome 내장 AI 자동 폴백(배지="Chrome AI", `globalThis.LanguageModel` 가용 시) → 그것도 불가하면 AI 스타일링·초안 배너 **미노출**. "키 없으면 미노출"이 아니다.
- **로그 뷰어 마커**: 콘솔/네트워크/액션 3종. 페이지 이동은 액션 마커의 variant(별도 타입 아님). `logs.html`은 빌드 산출물 → 일반 사용자는 "이슈 첨부로 받은 리포트를 여는" 개발자 관점으로만 기술.
- **액션 로그가 잡는 동작 종류**(`ActionEntryKind`): 클릭 / 텍스트 입력 / 페이지 이동 / **키 입력(keypress — 단축키·특수키만, 인쇄 문자·필드 입력값은 제외)** / **토글(체크박스·라디오)** / **선택(드롭다운 `<select>`)** / **드래그(drag — 요소를 끌어다 놓기)**. 가이드엔 영문 식별자 대신 "단축키·특수키 입력, 체크박스·라디오 토글, 드롭다운 선택, 드래그 앤 드롭"으로 풀어 쓰고, keypress는 "글자 하나하나가 아니라 어떤 키를 눌렀는지"로 안내(프라이버시 톤). **드래그는 포인터 방식(출발 요소 위주)과 네이티브 방식(출발·도착)으로 잡는 정밀도가 갈리지만, 이건 내부 구현이라 가이드엔 "드래그를 기록한다"로만 노출**(출발/도착 차이 비노출). 출처: 세 `issue.md`(로그 첨부 단계 — 액션 로그는 요소 모드를 뺀 전 모드 공통)·`logs/live.md`·`logs/README.md`·`logs/viewer.md`(액션 마커).
- **연결 후 기본값**(Connect 탭에서 지정 — `connect/*ConnectForm.tsx`): **위치**(Jira·GitLab=프로젝트 / GitHub=저장소 / Linear=팀→프로젝트 / Notion=DB / Asana=워크스페이스→프로젝트 / ClickUp=워크스페이스→스페이스→리스트 / Slack=채널) + **이슈에 채워질 값**(담당자 6개[Jira·GitHub·GitLab·Linear·Asana·ClickUp — **Notion·Slack은 담당자 개념 없음**] / 라벨 3개[GitHub·GitLab·Linear] / 기본 이슈 타입[Jira] / 상태·select 속성값[Notion]). 라벨은 실제 UI 문구로: `담당자`/`Assignee`·`라벨`/`Label`·`기본 이슈 타입`/`Default issue type`. **3가지 규칙을 반드시 함께 안내**: ① **직전 제출값이 기본값보다 우선**(기본 담당자를 정해도 마지막에 다른 사람을 골랐으면 그 사람이 이어진다 — 기본값이 직전값을 가리지 않는다) ② **후보 조회에 상위 값이 선행 필요**(GitHub=저장소, GitLab=프로젝트, Linear=팀, Asana·ClickUp=워크스페이스. 미선택 시 콤보박스 비활성 + "먼저 선택하세요" 안내. **Jira만 예외** — 유저 검색이 사이트 전역이라 프로젝트 없이도 고를 수 있다) ③ **상위 값을 바꾸면 하위 담당자·라벨 기본값이 비워진다**(다른 저장소·프로젝트의 멤버라 무효 — 조용히 엉뚱한 사람이 배정되는 것보다 낫다). 출처: `integrations/platforms.md`("연결 후 기본값" 절).
- **플랫폼 표** (현 시점 8개 스냅샷):

  | 플랫폼 | 연결 방식 | 토큰 입력 시 필요값 | 토큰 발급 |
  |---|---|---|---|
  | Jira | OAuth / API Token | baseUrl, email, apiToken | id.atlassian.com → API tokens |
  | GitHub | OAuth / PAT | PAT | github.com/settings/tokens |
  | Linear | OAuth / API Key | apiKey | linear.app 보안 설정 |
  | Notion | OAuth / Internal Token | token | notion.so 통합 |
  | GitLab | OAuth / PAT | instanceUrl(기본 gitlab.com prefill — self-managed면 변경), pat | gitlab.com PAT |
  | Asana | OAuth / PAT | pat | app.asana.com my-apps |
  | ClickUp | OAuth / API Token | pat(`pk_...`) | app.clickup.com 설정 > Apps |
  | Slack | OAuth 전용 | — (토큰 입력 없음) | — |

  > ClickUp은 이슈 대상이 **Workspace → Space → List 3단계**다(다른 플랫폼은 1~2단계). 연결 후 기본값·이슈 제출 모두 이 3단계로 List를 고른다. 토큰은 만료가 없어 재연결만 있고 자동 갱신은 없다.
  > **Slack은 이슈 트래커가 아니라 메시지 앱**이다(8번째 플랫폼). 다른 7개와 갈리는 점: OAuth **user token 전용**(BYOK·토큰 입력 없음 — connect 다이얼로그 없이 바로 OAuth), 대상은 **채널/비공개 채널/DM**(본인이 멤버인 대화만), 전송 구조는 **제목=부모 메시지 / 상세 본문·첨부=스레드 답글**, **멘션** 멤버 지정(`@이름` 알림), 메시지엔 상태가 없어 **폴링 없는 "전송됨" 정적 배지**(배지 자체는 클릭 불가 — permalink 이동은 **카드 본문** 클릭). 연결 후 기본값은 채널. 대상: `integrations/platforms.md`(ko/en, "Slack — 채널·DM" 소절), `integrations/README.md`, `faq.md`.
  > **Slack 이슈 승격(slack-issue-promotion)**: Slack 제출 이슈는 다른 플랫폼과 달리 원본 데이터(캡처·영상·로그·draft)를 **폐기하지 않고 보존**한다(`slackPreserved` 플래그). Slack 제외 트래커가 1개 이상 연결돼 있으면 이슈 목록 카드 우측에 **자세히**(en `View details`, `issueList.viewDetail`)·**트래커로 등록**(en `Promote to tracker`, `issueList.promote`) 두 버튼이 동적 노출(트래커 연결 상태 기준 — 미연결이면 미노출 + 기존 "전송됨" 배지 유지). [자세히]=보존 원본 확인 + **draft 필드 편집 가능**(`canEditDraftFields` = draft or slackPreserved — 승격 전 문구 다듬기, 로컬 draft만 갱신·발송된 Slack 메시지 불변·트래커 승격에만 반영), [승격]=Slack 제외 제출 다이얼로그로 정식 트래커 등록(등록 후 일반 이슈로 강등, Slack 이력 폐기). **카드 본문 클릭은 항상 permalink 이동(불변)**. **승격 백링크(slack-promotion-thread-link)**: 트래커 등록 성공 시 원 Slack 메시지 스레드에 트래커 이슈 링크 댓글이 1개 남는다(`{platform}에 이슈로 등록되었습니다.\n<url>` — 본인 user token 후속 댓글, best-effort·실패해도 승격은 정상). 가이드엔 내부 동작(파싱·조용한 drop) 노출 없이 "원 스레드에 트래커 링크 댓글이 남아 팀원이 어디 정리됐는지 안다" 수준으로만. 대상: `integrations/platforms.md`(ko/en, "나중에 정식 트래커로 승격하기" 소절).
  > **플랫폼 표는 stale 위험이 크다.** 신규 플랫폼(예: azure-devops)이 머지되면 이 표와 `integrations/platforms.md`(ko/en)를 즉시 갱신한다. 플랫폼 추가는 별도 `docs(guide)` 갱신 대상.

## 5. 톤앤매너

bug-shot.com 랜딩 기준. **친절하고 캐주얼하게.** ko/en은 같은 정보를 담되 **직역하지 않고** 각 언어 톤으로 자연스럽게 쓴다.

### 한국어

- **"-습니다" 종결어미 유지**(해요체로 바꾸지 않는다). 그 위에 캐주얼·친절한 톤을 입힌다.
- 공감형 도입 한 마디("~하던 작업, 막막했던 적 있으시죠.").
- 쿠션어를 자연스럽게(과하지 않게): "혹시 ~라면", "걱정 마세요", "어렵지 않습니다", "괜찮습니다", "딱 한 번만 해두면 됩니다", "신경 쓰지 않으셔도 됩니다".

```
[Before] 사이드패널은 네 개의 탭으로 나뉩니다.
[After]  복잡해 보여도 걱정 마세요. 사이드패널은 딱 네 개의 탭으로 나뉘어 있어서, 하나씩 보면 금방 익숙해집니다.
```

### English

- 친절·격려 톤. ko의 공감/쿠션에 대응하되 영어식으로(직역 아님): "No worries", "don't worry", "It's simpler than it sounds", "so don't sweat it", "nothing to worry about", "with peace of mind".
- 동사 시작·짧은 문장 선호. 핵심어: "in one shot / one click", "automatically".

```
[Before] BugShot is a Chrome side panel extension that lets you pick DOM elements...
[After]  Ever spotted a bug and thought, "how do I even explain this?" That's exactly the moment BugShot was built for. BugShot is a Chrome side panel extension...
```

## 6. UI 라벨 표기 규칙 (중요)

- 가이드 본문은 **로케일별 실제 화면 라벨**을 인용한다(ko 가이드=ko UI, en 가이드=en UI). 실제 문구는 i18n 기준(`src/i18n/namespaces/`).
- **영문 식별자를 그대로 쓰지 않는다.** 코드/설계의 영문 라벨(Element/Repick/Stop 등)은 식별용일 뿐이다. 예시(과거 실제 교정 사례):
  - `dom.repick` → ko "다시 선택" / en "Pick another element" (❌ "Repick")
  - `issue.recording.stop` → ko "녹화 완료" / en "Stop recording" (❌ "Stop")
  - `networkLog.clear` → ko "로그 지우기" / en "Clear Log" (❌ "Clear")
  - `networkLog.detail.copyCurl` → ko "cURL 복사" / en "Copy as cURL" (❌ "Copy cURL")
- **예외**: 실제 UI가 영문인 항목(스타일 패널 섹션명 Class/Layout/… 등)은 영문 그대로 쓰되 "화면에서 영문 표시"라고 한 줄 안내.
- 캡처 모드 라벨: ko "요소 스타일 편집 / 요소 캡처 / 스크린샷 / 탭 녹화 / 화면 녹화" · en "Edit element style / Capture element / Screenshot / Record tab / Record screen". (`issue.mode.screenshot`은 과거 `범위 캡처`/`Capture area`였으나, 이 버튼이 캡처 방식 3축의 진입점이 되면서 하위 `화면 캡처`/`Screen capture`와 이름이 겹쳐 `스크린샷`/`Screenshot`으로 개명 — 옛 라벨은 stale이니 쓰지 않는다.) `요소 캡처`/`Capture element`는 screenshot 세부 모드(요소를 클릭해 그 요소만 크롭한 스크린샷 + 이슈 env에 DOM selector 노출) — `screenshot/capture.md`에서 다룬다. `탭 녹화`(`issue.mode.video`)=현재 탭 캡처(tabCapture), `화면 녹화`(`issue.mode.screenRecord`)=화면/창 선택(getDisplayMedia) 구분. **단, 캡처 진입 화면엔 녹화 버튼이 1개**이고 이 두 라벨은 선택된 녹화 모드에 따라 그 버튼에 번갈아 표시된다. 설정 녹화 모드 Tabs는 **별도 키·짧은 라벨**(`settings.recordingMode.tab`/`.screen` = `탭`/`화면`)을 써 이슈 버튼 라벨과 분리 — 위 사실 스냅샷의 "녹화 모드 설정" 참조.
- freeform 진입 버튼: ko "이슈 작성" · en "Write issue".
- **"이슈 작성 / Write an Issue"로 통일**한다(과거 video만 "버그 리포트 작성"이었다가 통일함). 모드 간 라벨을 일관되게.

## 7. 마크다운 규칙

- **비표준 확장 문법(`{% hint %}` 등) 미사용.** 주의/경고/선행조건은 plain 인용구(`>`)로.
  - **예외**: 외부 사이트 OG 카드용 `{% embed url="..." %}`만 허용한다. 현재 사용처는 ko/en `README.md` 도입부의 **Chrome 웹스토어 설치 페이지**(`chromewebstore.google.com/detail/bugshot/<id>`) 카드 1곳 — 최초 유입자에게 설치 CTA를 카드 UI로 노출하기 위함. (과거엔 `https://bug-shot.com` 랜딩 카드였으나, 가이드가 bug-shot.com에 올라가면 자기참조라 웹스토어 설치 링크로 교체함.) 그 외 hint·tabs 등은 계속 금지.
- **이미지**: 모든 스크린샷 자리에 placeholder + 의미 있는 alt/캡션.
  - **파일명은 페이지 경로 기반**: 경로 세그먼트를 `-`로 잇고(소문자, `README`→`readme`) 끝에 페이지 내 순번. 예: `element/issue.md`의 3번째 → `element-issue-3.jpg`, `integrations/issue-tracking.md`의 1번째 → `integrations-issue-tracking-1.jpg`. (과거 `<섹션>.<페이지>.<N>` 번호식·단일 `dummy.jpg` 공유 방식에서 전환함.)
  - 경로 깊이를 페이지 위치에 맞춘다: 루트 페이지(`README.md`, `quick-start.md`)는 `![설명](assets/readme-1.jpg)`, 1단계 하위(`integrations/*.md` 등)는 `![설명](../assets/integrations-platforms-1.jpg)`.
  - 캡션은 "여기엔 무슨 스크린샷"인지 사용자가 나중에 교체할 수 있게 구체적으로.
  - 더미 원본은 `~/Desktop/bugshot-guide-dummy.jpg` → 언어별 `assets/dummy.jpg`. 새 이미지 자리는 `dummy.jpg`를 위 규칙명으로 **복사해 placeholder**로 두고(ko·en 양쪽), 실제 스크린샷 교체는 사용자 몫(비목표).
- **언어 전환 링크 없음**: 본문 페이지 상단의 per-page `🌐` 언어 전환 링크는 **전부 제거됐다**(과거엔 H1 바로 아래 1줄). 언어 전환은 **bug-shot.com/docs의 글로벌 로케일 스위처**가 담당하므로 문서 본문엔 언어 링크를 넣지 않는다. 새 페이지는 `H1 → 빈 줄 → (스크린샷) → 본문`으로 시작한다.
  - **slug 매핑은 여전히 유효**(문서 상호참조 상대 `.md` 링크 + docs-portal 라우팅용). docs slug는 파일 경로 기반, ko/en 동일 경로:
    - `<dir>/<name>.md` → `/<dir>/<name>` (예: `element/issue.md` → `/element/issue`)
    - `<dir>/README.md` (섹션 개요) → `/<dir>` (예: `integrations/README.md` → `/integrations`)
    - 루트 `README.md` (소개) → 홈(경로 없음, `…/en` · `…/ko`)
    - 루트 `quick-start.md`·`faq.md` → `/quick-start`·`/faq` (docs-portal은 **파일 경로 기반 flat slug** — SUMMARY 소개 하위 중첩은 사이드바 그룹만 바꾸고 slug엔 영향 없음.)

## 8. ko/en 대칭 원칙

- 파일 트리·페이지 수·섹션 구성(헤딩)이 ko/en 1:1 대응이어야 한다.
- 한쪽만 페이지/섹션을 추가·삭제하지 않는다.
- 헤딩 텍스트를 바꿀 땐 ko/en 양쪽을 함께(의미 일치 유지).

## 9. 검증 체크리스트 (작업 후 실행)

순수 문서라 `pnpm test` 영향 없음. 아래 정적 점검으로 대체한다(`cd guide`).

```bash
# 1. 플레이스홀더 잔존 0건
grep -rn "작성 예정\|coming soon" ko en

# 2. ko/en 파일 트리 대칭
diff <(cd ko && find . -name '*.md'|sort) <(cd en && find . -name '*.md'|sort)

# 3. ko/en 페이지별 헤딩 수 대칭
for p in $(cd ko && find . -name '*.md'|sort); do
  kc=$(grep -c '^#' "ko/$p"); ec=$(grep -c '^#' "en/$p")
  [ "$kc" != "$ec" ] && echo "MISMATCH $p ko=$kc en=$ec"
done

# 4. 내부 .md 링크 깨짐 (앵커·외부 URL 제외)
for lang in ko en; do
  while IFS= read -r line; do
    f="${line%%:*}"; rest="${line#*:}"; dir=$(dirname "$f")
    echo "$rest" | grep -oE '\]\([^)]+\.md[^)]*\)' | sed 's/^](//; s/)$//' | while read -r link; do
      case "$link" in http*) continue;; esac
      [ ! -f "$dir/${link%%#*}" ] && echo "BROKEN: $f -> $link"
    done
  done < <(grep -rnE '\]\([^)]+\.md' "$lang")
done

# 5. 이미지 참조가 실제 파일로 해소 (경로 깊이: 루트 assets/, 하위 ../assets/)
for lang in ko en; do
  while IFS= read -r line; do
    f="${line%%:*}"; rest="${line#*:}"; dir=$(dirname "$f")
    echo "$rest" | grep -oE '\]\(([^)]*\.jpg)\)' | sed 's/^](//; s/)$//' | while read -r img; do
      [ ! -f "$dir/$img" ] && echo "BROKEN IMG: $f -> $img"
    done
  done < <(grep -rn '\.jpg' "$lang/"*/*.md "$lang/"*.md 2>/dev/null)
done

# 5b. ko/en assets 트리 대칭
diff <(cd ko && find assets -name '*.jpg'|sort) <(cd en && find assets -name '*.jpg'|sort)

# 6. per-page 언어 전환 링크(🌐) 완전 제거 확인 (0건이어야 — 글로벌 스위처가 대체)
grep -rn '🌐' ko en && echo "REMAINING 🌐 (should be none)" || echo "OK: no 🌐"
```

수동: docs-portal 로컬 미리보기로 좌측 트리·이미지·내부 링크 렌더 확인.

## 10. 작업 팁

- 섹션 단위로 끊어 ko·en을 함께 작성(52파일을 한 번에 쓰면 품질 편차). 톤 일관성을 위해 소개(README)를 먼저 써서 어휘·문체 기준을 잡는다.
- 라벨/사실 일괄 변경은 `sed`로, 톤 워싱은 페이지별 재작성으로(문맥 의존).
- 이 문서(`guide/AUTHORING.md`)도 IA·톤·운영 방식·사실 스냅샷이 바뀌면 함께 갱신한다.
- 가이드 작성·갱신은 **`/guide` 스킬**이 이 매뉴얼을 로드해 실행한다(`.claude/commands/guide.md`). `/feature` tasks의 "가이드 영향" + `/implement` 보고의 "가이드 영향 ⚠️" 플래그가 진입 신호. `/push`는 stale을 감지하는 게이트일 뿐, 무거운 작성은 `/guide`로 분리한다.
