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

25페이지 × 2언어 = 50개 마크다운 + 언어별 `SUMMARY.md` + 언어별 더미 이미지.

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

element/screenshot/video 세 `issue.md`는 아래 7단계를 **그대로 반복**하고, 각 페이지는 "고유분"(미디어 종류 + AI 근거 + 녹화 모드 로그 정책)만 다르게 쓴다. 본문 섹션(4) 바로 뒤에는 번호 없는 **강조 섹션 `## ✨ AI 초안 작성`(en `## ✨ AI Draft`)** 을 끼운다 — 세 페이지 공통 흐름에 모드별 근거 한 문장만 다르다.

| 단계 | 내용 |
|---|---|
| 1. 제목 | 설정의 제목 접두어(prefill) 적용 |
| 2. 재현 환경 | 자동 메타(OS/브라우저/URL/뷰포트/시각) readonly + 사용자 추가 변수 row |
| 3. 미디어 | **모드별 고유** — 요소=before/after 스타일 표 / 스크린샷=주석 이미지 / 녹화=영상 |
| 4. 본문 섹션 | 발생 현상·재현 과정·기대 결과·비고(설정 토글대로) |
| ✨ AI 초안 작성 | 번호 없는 강조 섹션. 배너(AI 연결 시) → 입력창에 버그 한 줄(요소 모드는 비워도 됨) → **제목+본문 한 번에** 채움(켜 둔 섹션만, 접두어 유지). 사용자가 **이미 적어 둔 제목·본문도 컨텍스트로 참고**하고, 본문에 붙인 **inline 이미지는 보존(텍스트만 교체)**. **모드별 근거**: 요소=before/after 스타일·전후 이미지 / 스크린샷=주석 이미지 / 녹화=콘솔·네트워크·액션 로그 요약 |
| 5. 로그 첨부 | 요소=없음 / 스크린샷=콘솔·네트워크 기본 on / 녹화=콘솔·네트워크·액션 기본 on |
| 6. 미리보기 | 제출 전 본문 확인 + 마크다운 복사 |
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
| AI 배너 라벨 | `src/i18n/namespaces/ai.ts`, `editor.ts` |
| AI 가용성·폴백 흐름 | `src/sidepanel/hooks/useAI.ts`, `ai-provider.ts` (BYOK → Chrome 내장 AI → 미노출) |
| 어노테이션(스크린샷 주석) | `src/sidepanel/components/AnnotationOverlay.tsx` + `annotation/AnnotationToolbar.tsx`·`presets.ts` (BugShot 자체 konva 툴바 — 도구/색상/두께, 라벨은 `editor.ts` `annotation.*`로 ko/en 현지화) |
| 녹화 중 그리기(펜) | `src/content/annotation.ts`(SVG 오버레이) + `src/sidepanel/annotation-control.ts` + editor-store `annotationPenOn` + i18n `issue.recording.pen` — **스크린샷 주석(konva)과 별개 기능** |
| 리플레이 트리밍 | `src/sidepanel/tabs/ReplayTrimDialog.tsx`·`TrimTimeline.tsx`, 백엔드 `src/sidepanel/30s-replay/trim-math.ts`·`apply-trim.ts`, 라벨 `src/i18n/namespaces/issue.ts` (`issue.replay.trim.*`) |
| 로그 정책(모드별 기본 on/off) | `src/sidepanel/lib/captureLogSupport.ts`, `src/store/editor-store.ts` |
| 네트워크 캡처 대상·WebSocket | `src/content/network-recorder.ts`(fetch/XHR/sendBeacon/WebSocket 후킹), WS 라벨 `src/i18n/namespaces/logs.ts` (`networkLog.filter.ws`/`tab.messages`/`ws.*`) |
| 로그 출처 필터(iframe) | `src/sidepanel/lib/logOrigin.ts` (`originKey`/`originHostLabel`/`originCounts`/`UNKNOWN_ORIGIN`), `src/sidepanel/components/OriginFilterBar.tsx`, 라벨 `src/i18n/namespaces/logs.ts` (`log.originFilter.unknown`) |
| iframe 요소 선택 지원 | picker `all_frames`(`manifest.config.ts`), 거부 문구 `src/i18n/namespaces/app.ts` (`app.iframeUnsupported.*`) |
| 로그 뷰어 마커 | `src/log-viewer/markers.ts` (`MarkerType`: console/network/action, navigate는 action variant) |
| 액션 로그 동작 종류 | `src/types/action.ts` (`ActionEntryKind`), 라벨 `src/i18n/namespaces/logs.ts` (`actionLog.filter.*`/`verb.*`), 렌더 `src/sidepanel/components/ActionLogContent.tsx` |
| 가이드 URL (bug-shot.com/{locale}/docs) | `src/lib/external-links.ts` (`USER_GUIDE_URLS`) |
| 연동 탭 자동 진입 | `src/sidepanel/tabs/integrationsTabUtils.ts` |

### 현재 사실 스냅샷 (작성 시점 기준 — 코드 변경 시 갱신)

- **단축키**: `Cmd/Ctrl+Shift+E`(패널 토글) **1개만**. best-effort라 OS·타 확장 충돌 시 미배정될 수 있음을 한 줄 안내(그땐 툴바 아이콘으로). **캡처 단축키는 모두 제거됨** — 요소 선택·범위 캡처·요소 캡처·탭/화면 녹화 등 캡처는 전부 **버튼 전용**(과거 캡처 단축키는 모두 제거됨 — manifest commands엔 패널 토글만 남음). 패널 토글만 유일한 command라 가이드 본문의 단축키 표기도 `quick-start`의 `Cmd/Ctrl+Shift+E` 1곳뿐이다(video/issue·logs/viewer의 "단축키 입력"은 액션 로그가 기록하는 사용자 동작 설명이지 확장 단축키가 아님 — 무관).
- **본문 섹션**: 발생 현상(켜짐·문단) / 재현 과정(켜짐·번호 목록) / 기대 결과(켜짐·문단) / 비고(꺼짐·문단). 라벨·플레이스홀더 override 가능.
- **파일 첨부 토글**: 설정 > 이슈 설정 > 본문 구성에 `파일 첨부`(en `File attachments`) 토글, **기본 꺼짐**(`attachmentsEnabled` in `settings-ui-store.ts`). 켜면 이슈 작성(drafting) 화면에 `첨부 파일`(en `Attachments`, `section.attachments`) 영역 노출 → 임의 로컬 파일 선택. **최대 10개·합계 50MB** 하드캡(`src/sidepanel/lib/attachmentLimits.ts`), 플랫폼별 단건 경고(Notion 5MB·GitLab 10MB, 초과 시 "용량 초과" 표시·차단 아님). 제출 시 8개 플랫폼에 함께 업로드(Slack은 메시지 스레드 첨부). 기능 위치상 settings/issue.md에만 두고 중립적 기능 설명 톤으로 기술한다(3개 mode issue.md 공통 흐름엔 미편입).
- **녹화 모드 설정**: 캡처 진입 화면(디버그 탭)의 **녹화 버튼은 1개**(`mode-record`)이고, 탭/화면 중 무엇을 녹화할지는 **설정 > 이슈 설정 > 녹화 설정 > 녹화 모드** Tabs에서 고른다(`recordingMode` in `settings-ui-store.ts`, 기본 `tab`). 설정 섹션 제목은 `녹화 설정`/en `Recording settings`(`settings.recording` 키, 30초 리플레이도 같은 섹션). 설정 Tabs 라벨은 짧게 `탭`/`화면`(en `Tab`/`Screen`, `settings.recordingMode.tab`/`.screen`, **아이콘 없음**) — 캡처 화면 녹화 버튼 라벨 `탭 녹화`/`화면 녹화`(`issue.mode.video`/`.screenRecord`)와 **키·문구 분리**. 고른 모드는 캡처 화면 녹화 버튼 아이콘·라벨에 라이브 반영(`recordModeMeta`: tab→AppWindow, screen→MonitorPlay). **캡처 진입 화면 레이아웃은 1x2x2**: Row1 `[요소 스타일 편집]`(primary 단독, 전체폭) / Row2 `[요소 캡처][범위 캡처]`(ButtonGroup) / Row3 `[녹화 버튼][30초 리플레이]`(ButtonGroup). 녹화 모드 변경은 **설정 탭 단일 경로** — 진입 화면엔 ⚙ 톱니바퀴·녹화 설정 다이얼로그가 **없다**(revert-idle-capture-layout에서 제거). **비활성 30초 리플레이 버튼**을 클릭하면 다이얼로그가 아니라 **설정 탭(이슈 설정)으로 이동**한다(`navTo("settings","issue")`). 설정 탭의 녹화 설정 카드는 공용 컴포넌트(`RecordingSettingsCard`, store 단일 출처)다. (과거 Row3 3-segment `[녹화][리플레이][⚙]` + `RecordingSettingsDialog`는 제거됨 — `video/record.md`·`settings/issue.md`·`video/replay.md` 대상.)
- **리플레이 트리밍**: 30초 리플레이 캡처 직후 이슈 초안 위로 **트리밍 오버레이**가 자동으로 **한 번만** 뜬다(설정값 아님 — 순수 캡처 후 단계). 오버레이 상단은 **아이콘 4탭**(`영상`/`콘솔`/`네트워크`/`액션` — en `Video`/`Console`/`Network`/`Action`, 라벨 키 `issue.replay.trim.tab.video`·`issue.replay.trim.log.*`)이고 각 로그 탭엔 캡처 개수 Badge가 붙는다(0건도 표시·999 초과 `999+`). 영상 탭은 가운데에서 `<video>`로 재생, 로그 탭으로 전환하면 같은 자리에 로그 뷰어와 동일한 로그 목록이 인라인으로 펼쳐진다(0건이어도 empty로 조회 가능, 네트워크 탭은 상대 timestamp 표시·2-pane 유지). **타임라인 손잡이·재생/일시정지·되돌리기/다시 실행/확정/작성 취소는 전 탭 전역**. 영상 양쪽 끝의 **시작 지점·끝 지점**(en `Start`/`End`) 손잡이를 끌어 버그 구간만 남긴다. 손잡이를 끌면 **잘려나갈 로그가 로그 탭에서 실시간으로 흐림(opacity-40) 처리**돼 무엇이 빠질지 미리 확인된다(레벨/status 색상과 병렬일 때도 구분됨, 네트워크는 요청 리스트 row만 흐림·상세 pane 영향 없음). **재생은 영상 탭에서** — 로그 탭에선 자동 일시정지되고, play 버튼을 누르면 영상 탭으로 돌아가 재생된다. 타임라인의 **콘솔·네트워크 에러 마커 + 페이지 이동(action navigate) 마커**를 누르면 해당 로그 탭으로 전환된다(과거 마커 클릭→로그 다이얼로그 방식은 제거). **확정**(en `Apply`)하면 그 구간만 영상이 재인코딩되고 첨부 로그도 같은 구간으로 좁혀진다(흐림으로 표시됐던 로그가 그대로 빠짐 — 미리보기=실제 일치, 전체 그대로 확정하면 30초 유지). **작성 취소**(en `Discard`)는 캡처를 폐기하고 진입 화면으로. 확정하면 원본은 정리돼 재편집 불가. UI 라벨은 `issue.replay.trim.*`(§6 영문 식별자 금지 대상 — 확정/작성 취소 등 현지화 라벨 사용). 대상: `video/replay.md`(ko "구간 자르기" / en "Trimming the clip"). (과거 로그별 미리보기 다이얼로그 방식 → 인라인 탭 + muted 미리보기로 전환됨 — replay-trim-refactor.)
- **어노테이션 도구**: 스크린샷 주석 편집기는 BugShot **자체 toolbar(konva 기반**, `AnnotationOverlay.tsx` + `annotation/AnnotationToolbar.tsx`)이고 **라벨이 ko/en 현지화**돼 있다(`editor.ts` `annotation.*`) — **과거 "markerjs2 영문 툴바" 안내는 stale이니 쓰지 않는다.** 도구: 선택/펜/화살표/사각형/원/텍스트/형광펜(`ANNOTATION_TOOLS` 순서 — 펜이 화살표 앞), 색상 5종(빨강·노랑·초록·파랑·검정), 선 두께 3단계(얇게·보통·굵게 — 선·도형·펜·형광펜에 적용. 텍스트는 두께 대신 글자 크기 S/M/L), 실행 취소·다시 실행, 삭제, 취소·주석 완료. 추가·수정·제거 진입 버튼은 drafting 화면(`draft.addAnnotation`/`.editAnnotation`/`.removeAnnotation`). 가이드엔 내부 라이브러리명 노출 없이 "한국어로 표시되는 자체 툴바" 수준으로 기술. 대상: `screenshot/annotation.md`.
- **녹화 중 그리기(펜)**: 탭/화면 녹화 중 사이드패널 RecordingState의 펜 토글 버튼(`issue.recording.pen` — ko "화면에 그리기 (Esc로 끄기)" / en "Draw on screen (Esc to turn off)")으로 켜면 페이지를 드래그해 자유 곡선을 그리고, 각 획은 **약 3초 후 자동 페이드**된다. 펜 버튼을 다시 누르거나 페이지에서 **Esc**로 끈다. 그린 획은 녹화 영상에 그대로 포함(순수 시각 효과 — 저장·첨부 없음). **화면 녹화로 다른 창/모니터를 공유 중이면 BugShot을 연 탭 위에만 그려져** 그 영상엔 안 담길 수 있다(인앱 안내 없음 — 가이드에만 명시). **스크린샷 어노테이션(konva 툴바)과 별개 기능**(`src/content/annotation.ts` — SVG 오버레이·`annotationPenOn` state). 대상: `video/record.md`.
- **로그 정책**: 요소=로그 없음 / 스크린샷=콘솔·네트워크 토글 **기본 on** / 녹화=콘솔·네트워크·액션 **기본 on**. 액션 로그는 **녹화 모드 전용**. 자동 수집은 trailing throttle로 실시간 스트리밍(레코더 ~200ms flush, 사이드패널 IDB 저장은 ~1s로 묶음) — 과거 "~1.5초" 표기는 stale이니 가이드엔 구체 숫자 대신 "실시간"으로.
- **네트워크 캡처 범위** (`src/content/network-recorder.ts`): fetch·XHR·`sendBeacon`에 더해 **WebSocket** 연결·프레임도 캡처한다. 연결은 네트워크 목록에 행 1개(status 101)로 뜨고, 행을 열면 상세 **메시지**(en `Messages`) 탭에서 송수신 프레임을 시간순으로 본다(방향 필터 전체/송신/수신, `WS` 목록 필터). **텍스트 프레임만** 담고 바이너리(이미지·파일 등)는 내용 없이 드롭하며 건너뛴 개수를 메시지 탭 상단에 표시. 가이드엔 내부 메커니즘 노출 없이 "실시간 양방향 통신을 주고받은 메시지로 본다" 수준으로만 기술. 대상: `logs/live.md`.
- **콘솔 캡처 범위** (`src/content/console-recorder.ts`): `log`/`info`/`debug`는 상시 wrap, `console.error`/`console.warn`은 **패널이 arm된(디버그·녹화로 캡처 중인) 동안만** wrap해 캡처(chrome://extensions 오류 로그 attribution 오염을 arm 구간으로 한정). `trace`/`assert`(→error)/`dir`/`dirxml`/`table`/`group*`/`count*`/`time*`/`timeStamp`/`clear`도 기존 5레벨(주로 log)에 매핑, uncaught 예외·unhandled rejection은 상시 error로. 가이드엔 내부 메커니즘(arm-스코프 wrap) 노출 없이 "정보·경고·에러까지 빠짐없이 모아 본다" 수준으로만 기술.
- **iframe 요소 선택**: 요소 선택(picker)이 **1-depth iframe**(페이지에 직접 박힌 프레임) 내부 요소까지 지원한다 — cross-origin(결제 창·임베드 위젯 등) 포함해 선택·스타일 편집·캡처 가능. **중첩(프레임 안의 프레임)·sandbox**로 막힌 프레임만 안쪽 접근 불가 → 안내 다이얼로그(`app.iframeUnsupported.title/body`, ko "이 iframe은 선택할 수 없습니다" / en "This iframe can't be selected") + 선택 취소. 거부 문구가 안내하는 폴백은 **범위 캡처**(en Capture area). 가이드엔 내부 메커니즘(프레임 핸드셰이크·좌표 변환) 노출 없이 "대부분의 iframe 내부 요소도 그대로 다룬다, 중첩·sandbox만 예외" 수준으로. 대상: `element/picker.md`(ko/en, "iframe 안의 요소" 소절). (과거 "iframe 내부는 선택 불가" 안내는 stale — 쓰지 않는다.)
- **로그 출처(iframe) 필터**: 콘솔·네트워크 로그는 cross-origin iframe(결제 위젯·임베드 등) 로그까지 수집한다. 출처가 2개 이상 섞이면 콘솔·네트워크·액션 로그 탭 모두에 출처 필터 바(`OriginFilterBar`, 사이드패널 서브탭·로그 다이얼로그·log-viewer 공용) 노출 — 호스트별 버튼(각 버튼에 출처별 로그 개수 muted 표시) + opaque(`data:`/`about:blank`) 묶음 라벨 ko "(알 수 없음)" · en "(unknown)". **"전체" 버튼은 없음** — 아무것도 선택하지 않은 상태가 전체이고, 선택된 출처 버튼을 다시 누르면 해제(toggle)된다. (초기엔 액션 로그를 출처 필터에서 제외했으나, top↔iframe 액션이 섞이면 navigation만으론 출처 추적이 안 돼 액션에도 추가함.)
- **AI 가용성**: BYOK LLM 연결 시 그 모델(배지=프로바이더명) → 미연결 시 Chrome 내장 AI 자동 폴백(배지="Chrome AI", `globalThis.LanguageModel` 가용 시) → 그것도 불가하면 AI 스타일링·초안 배너 **미노출**. "키 없으면 미노출"이 아니다.
- **로그 뷰어 마커**: 콘솔/네트워크/액션 3종. 페이지 이동은 액션 마커의 variant(별도 타입 아님). `logs.html`은 빌드 산출물 → 일반 사용자는 "이슈 첨부로 받은 리포트를 여는" 개발자 관점으로만 기술.
- **액션 로그가 잡는 동작 종류**(`ActionEntryKind`): 클릭 / 텍스트 입력 / 페이지 이동 / **키 입력(keypress — 단축키·특수키만, 인쇄 문자·필드 입력값은 제외)** / **토글(체크박스·라디오)** / **선택(드롭다운 `<select>`)** / **드래그(drag — 요소를 끌어다 놓기)**. 가이드엔 영문 식별자 대신 "단축키·특수키 입력, 체크박스·라디오 토글, 드롭다운 선택, 드래그 앤 드롭"으로 풀어 쓰고, keypress는 "글자 하나하나가 아니라 어떤 키를 눌렀는지"로 안내(프라이버시 톤). **드래그는 포인터 방식(출발 요소 위주)과 네이티브 방식(출발·도착)으로 잡는 정밀도가 갈리지만, 이건 내부 구현이라 가이드엔 "드래그를 기록한다"로만 노출**(출발/도착 차이 비노출). 출처: `video/issue.md`(녹화 로그 정책)·`logs/viewer.md`(액션 마커).
- **플랫폼 표** (현 시점 8개 스냅샷):

  | 플랫폼 | 연결 방식 | 토큰 입력 시 필요값 | 토큰 발급 |
  |---|---|---|---|
  | Jira | OAuth / API Token | baseUrl, email, apiToken | id.atlassian.com → API tokens |
  | GitHub | OAuth / PAT | PAT | github.com/settings/tokens |
  | Linear | OAuth / API Key | apiKey | linear.app 보안 설정 |
  | Notion | OAuth / Internal Token | token | notion.so 통합 |
  | GitLab | OAuth / PAT | instanceUrl(self-managed만), pat | gitlab.com PAT |
  | Asana | OAuth / PAT | pat | app.asana.com my-apps |
  | ClickUp | OAuth / API Token | pat(`pk_...`) | app.clickup.com 설정 > Apps |
  | Slack | OAuth 전용 | — (토큰 입력 없음) | — |

  > ClickUp은 이슈 대상이 **Workspace → Space → List 3단계**다(다른 플랫폼은 1~2단계). 연결 후 기본값·이슈 제출 모두 이 3단계로 List를 고른다. 토큰은 만료가 없어 재연결만 있고 자동 갱신은 없다.
  > **Slack은 이슈 트래커가 아니라 메시지 앱**이다(8번째 플랫폼). 다른 7개와 갈리는 점: OAuth **user token 전용**(BYOK·토큰 입력 없음 — connect 다이얼로그 없이 바로 OAuth), 대상은 **채널/비공개 채널/DM**(본인이 멤버인 대화만), 전송 구조는 **제목=부모 메시지 / 상세 본문·첨부=스레드 답글**, **멘션** 멤버 지정(`@이름` 알림), 메시지엔 상태가 없어 **폴링 없는 "전송됨" 정적 배지**(누르면 permalink 이동). 연결 후 기본값은 채널. 대상: `integrations/platforms.md`(ko/en, "Slack — 채널·DM" 소절), `integrations/README.md`, `faq.md`.
  > **Slack 이슈 승격(slack-issue-promotion)**: Slack 제출 이슈는 다른 플랫폼과 달리 원본 데이터(캡처·영상·로그·draft)를 **폐기하지 않고 보존**한다(`slackPreserved` 플래그). Slack 제외 트래커가 1개 이상 연결돼 있으면 이슈 목록 카드 우측에 **자세히**(en `View details`, `issueList.viewDetail`)·**트래커로 등록**(en `Promote to tracker`, `issueList.promote`) 두 버튼이 동적 노출(트래커 연결 상태 기준 — 미연결이면 미노출 + 기존 "전송됨" 배지 유지). [자세히]=보존 원본 확인, [승격]=Slack 제외 제출 다이얼로그로 정식 트래커 등록(등록 후 일반 이슈로 강등, Slack 이력 폐기). **카드 본문 클릭은 항상 permalink 이동(불변)**. **승격 백링크(slack-promotion-thread-link)**: 트래커 등록 성공 시 원 Slack 메시지 스레드에 트래커 이슈 링크 댓글이 1개 남는다(`{platform}에 이슈로 등록되었습니다.\n<url>` — 본인 user token 후속 댓글, best-effort·실패해도 승격은 정상). 가이드엔 내부 동작(파싱·조용한 drop) 노출 없이 "원 스레드에 트래커 링크 댓글이 남아 팀원이 어디 정리됐는지 안다" 수준으로만. 대상: `integrations/platforms.md`(ko/en, "나중에 정식 트래커로 승격하기" 소절).
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
- 캡처 모드 라벨: ko "요소 스타일 편집 / 요소 캡처 / 범위 캡처 / 탭 녹화 / 화면 녹화" · en "Edit element style / Capture element / Capture area / Record tab / Record screen". `요소 캡처`/`Capture element`는 screenshot 세부 모드(요소를 클릭해 그 요소만 크롭한 스크린샷 + 이슈 env에 DOM selector 노출) — `screenshot/capture.md`에서 다룬다. `탭 녹화`(`issue.mode.video`)=현재 탭 캡처(tabCapture), `화면 녹화`(`issue.mode.screenRecord`)=화면/창 선택(getDisplayMedia) 구분. **단, 캡처 진입 화면엔 녹화 버튼이 1개**이고 이 두 라벨은 선택된 녹화 모드에 따라 그 버튼에 번갈아 표시된다. 설정 녹화 모드 Tabs는 **별도 키·짧은 라벨**(`settings.recordingMode.tab`/`.screen` = `탭`/`화면`)을 써 이슈 버튼 라벨과 분리 — 위 사실 스냅샷의 "녹화 모드 설정" 참조.
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
grep -rn "작성 예정\|coming soon" .

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

- 섹션 단위로 끊어 ko·en을 함께 작성(46파일을 한 번에 쓰면 품질 편차). 톤 일관성을 위해 소개(README)를 먼저 써서 어휘·문체 기준을 잡는다.
- 라벨/사실 일괄 변경은 `sed`로, 톤 워싱은 페이지별 재작성으로(문맥 의존).
- 이 문서(`guide/AUTHORING.md`)도 IA·톤·운영 방식·사실 스냅샷이 바뀌면 함께 갱신한다.
- 가이드 작성·갱신은 **`/guide` 스킬**이 이 매뉴얼을 로드해 실행한다(`.claude/commands/guide.md`). `/feature` tasks의 "가이드 영향" + `/implement` 보고의 "가이드 영향 ⚠️" 플래그가 진입 신호. `/push`는 stale을 감지하는 게이트일 뿐, 무거운 작성은 `/guide`로 분리한다.
