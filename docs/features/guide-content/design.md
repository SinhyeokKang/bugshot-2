# BugShot 사용자 가이드 콘텐츠 — 기술 설계

## 개요

`guide/ko`·`guide/en` 두 GitBook 소스에 동일한 23페이지 트리를 만들고 마크다운 콘텐츠를 채운다. 코드 변경은 없다. 각 언어는 독립 GitBook 사이트(ko → `bugshot.gitbook.io/ko`, en → `bugshot.gitbook.io/en`)로 동기되므로 **assets도 언어별로 따로** 둔다. 스크린샷은 전부 더미 이미지(`assets/dummy.jpg`)로 채우고 사용자가 후속 교체한다.

## 변경 범위

순수 문서 작업. `src/`·`manifest`·`package.json` 불변.

### 파일 트리 (언어당 동일 — `guide/ko/`, `guide/en/` 양쪽)

```
README.md                       # 1. 소개
quick-start.md                  # 1-1. 빠른 시작
integrations/README.md          # 2. 연동 설정 (개요 + 바로가기)
integrations/platforms.md       # 2-1. 플랫폼 연동
integrations/issue-tracking.md  # 2-2. 이슈 트래킹
settings/README.md              # 3. 기본 설정 (개요 + 바로가기)
settings/issue.md               # 3-1. 이슈 설정
settings/ai.md                  # 3-2. AI LLM 연동
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
video/issue.md                  # 6-3. 버그 리포트 작성 (녹화 모드, 자기완결)
logs/README.md                  # 7. 로그 (개요 + 바로가기)
logs/live.md                    # 7-1. 실시간 로그 (+ freeform 흡수)
logs/viewer.md                  # 7-2. 로그 뷰어 (logs.html, 개발자 관점)
assets/dummy.jpg                # 더미 스크린샷 (기존 .gitkeep 옆에 추가)
```

페이지 23 × 2언어 = 46개 마크다운 + 언어별 `SUMMARY.md` 갱신 2개 + 더미 이미지 2개.

### `SUMMARY.md` (ko 예시 — en은 동일 경로 + 영문 제목)

```markdown
# Summary

- [소개](README.md)
  - [빠른 시작](quick-start.md)
- [연동 설정](integrations/README.md)
  - [플랫폼 연동](integrations/platforms.md)
  - [이슈 트래킹](integrations/issue-tracking.md)
- [기본 설정](settings/README.md)
  - [이슈 설정](settings/issue.md)
  - [AI LLM 연동](settings/ai.md)
- [요소 선택 & 스타일링](element/README.md)
  - [요소 선택](element/picker.md)
  - [스타일링](element/styling.md)
  - [이슈 작성](element/issue.md)
- [스크린샷 캡처](screenshot/README.md)
  - [스크린샷 캡처](screenshot/capture.md)
  - [어노테이션](screenshot/annotation.md)
  - [이슈 작성](screenshot/issue.md)
- [녹화](video/README.md)
  - [실시간 녹화](video/record.md)
  - [30초 리플레이](video/replay.md)
  - [버그 리포트 작성](video/issue.md)
- [로그](logs/README.md)
  - [실시간 로그](logs/live.md)
  - [로그 뷰어](logs/viewer.md)
```

## 페이지별 콘텐츠 명세

각 페이지는 (a) 1~2문단 도입 (b) 단계/항목 설명 (c) 스크린샷 자리로 구성. 아래는 각 페이지가 반드시 담을 사실(코드 스캔 기반)이다.

| 페이지 | 핵심 콘텐츠 (코드 근거) |
|---|---|
| `README.md` 소개 | BugShot = DOM 요소 골라 스타일 수정·비교 후 6개 플랫폼 이슈 등록하는 사이드패널 확장. 메인 탭 4개(Debug / 이슈 목록 / 연동 / 설정) 개념 + 각 섹션 바로가기 카드. |
| `quick-start.md` 빠른 시작 | 설치(웹스토어) → 사이드패널 열기(`Cmd/Ctrl+Shift+E` 또는 툴바 아이콘) → 플랫폼 1개 연결 → 요소/스크린샷 캡처 → 본문 작성 → 제출까지 1개 흐름. 각 단계 1스크린샷. |
| `integrations/README.md` | 연동 섹션 개요: 어떤 플랫폼을 왜 연결하는지 + 2-1/2-2 바로가기. 연결 없으면 연동 탭 자동 진입(`integrationsTabUtils`). |
| `integrations/platforms.md` 플랫폼 연동 | "플랫폼 추가" 서브탭 → 플랫폼 선택 → 연결 방식(OAuth vs 토큰, `ConnectMethodDialog`). 6개 플랫폼 표: 연결 방식 + 필요한 입력값 + 토큰 발급 링크 (아래 "플랫폼 표"). 연결 후 기본값(프로젝트/팀/DB 등). 연결 해제(개별 Unplug / 모두 해제). |
| `integrations/issue-tracking.md` 이슈 트래킹 | 이슈 목록 탭: 필터(All/Submitted/Draft), 검색, 날짜 그룹. 행 클릭 → `DraftDetailDialog`(Draft=편집 / Submitted=읽기전용). **Refresh = 플랫폼에서 상태 재조회**(연결 필요). Delete All. |
| `settings/README.md` | 설정 섹션 개요 + 3-1/3-2 바로가기. 설정 서브탭(이슈/AI/일반) 소개. 일반 탭 = 언어·테마. |
| `settings/issue.md` 이슈 설정 | 제목 접두어(prefill, 예 `[QA] `). 본문 구성 토글(Description/Steps to Reproduce/Expected Result/Notes — 기본 enabled 3개, Notes off / 라벨·플레이스홀더 override / paragraph vs orderedList). 30초 리플레이 토글 + **권한 요청** 설명. |
| `settings/ai.md` AI LLM 연동 | AI 모델 서브탭: LLM 프로바이더 연결(BYOK — baseUrl/apiKey/modelId). 연결하면 두 AI 기능이 활성화됨을 강조 + 각 페이지 교차링크: **AI 스타일링**(`element/styling.md`)·**AI 초안 작성**(이슈 작성 페이지). 미연결 시 두 배너 모두 비노출. |
| `element/README.md` | 요소 모드 개요: 요소 클릭 → 스타일 라이브 수정 → before/after로 이슈. 4-1/4-2/4-3 바로가기. |
| `element/picker.md` 요소 선택 | "Element" 버튼 또는 `Cmd/Ctrl+Shift+S` → picking 단계, 페이지에 crosshair. 요소 클릭 → 선택. DOM 트리 네비(부모/자식), Repick. iframe 내부 미지원 안내. |
| `element/styling.md` 스타일링 | 스타일 패널 섹션(Class/Layout/Container/Size/Overflow/Text/Typography/Effects/Transition — 실제 렌더 순서). 라이브 반영. Reset Changes(되돌림). **AI 스타일링 강조**(핵심 셀링): AI(BYOK LLM) 연결 시 "AI 스타일링"(en "AI Styling") 배너 등장 → **자연어로 스타일 수정 지시**("버튼을 둥글게", "여백 키워") → AI가 inline style·class 변경을 즉시 DOM에 적용. 미연결 시 배너 비노출. Next → 초안. |
| `element/issue.md` 이슈 작성(요소) | **자기완결**(공통 흐름은 "이슈 작성 공통 흐름" 섹션 참조). 요소 모드 고유분: **스타일 변경 before/after 표**(미디어 = 비교 표). |
| `screenshot/README.md` | 스크린샷 모드 개요 + 5-1/5-2/5-3 바로가기. |
| `screenshot/capture.md` 스크린샷 캡처 | "Screenshot" 버튼 → 영역 드래그 선택 → 캡처. 산출(원본/뷰포트/시각). |
| `screenshot/annotation.md` 어노테이션 | 캡처 이미지에 주석 추가/편집/초기화(Pencil). 어노테이션 UI는 `markerjs2` 라이브러리 툴바(`src/sidepanel/components/AnnotationOverlay.tsx`)를 그대로 띄움 — 도구 목록은 **실제 markerjs2 툴바를 실측**해 기술(임의 나열 금지). 일부 라벨만 i18n(`editor.ts` 주석 추가/수정/제거/완료), 도구 자체는 markerjs2 영문 UI일 수 있음을 안내. |
| `screenshot/issue.md` 이슈 작성(스크린샷) | **자기완결**(공통 흐름 섹션 참조). 스크린샷 모드 고유분: **주석 스크린샷 첨부**(미디어 = 주석 이미지). |
| `video/README.md` | 녹화 모드 개요 + 6-1/6-2/6-3 바로가기. 실시간 녹화 vs 30초 리플레이 차이 한 줄. |
| `video/record.md` 실시간 녹화 | "Video" 버튼 → recording 단계(경과/최대 타이머, Stop/Cancel) → 처리 → 초안. 산출(MP4/썸네일). 최대 길이. |
| `video/replay.md` 30초 리플레이 | 지난 30초 자동 버퍼 → "Replay" 버튼. **선행조건: 설정에서 토글 + 권한 허용**(→ `settings/issue.md` 링크). 버튼 상태(비활성/Recording/Encoding/준비). |
| `video/issue.md` 버그 리포트 작성(녹화) | **자기완결**(공통 흐름 섹션 참조) **+ 녹화 전용 로그 정책 강조**: 녹화 모드 고유분 = 영상 첨부 + **액션 로그**(녹화 모드에서만 수집, 기본 on) + 콘솔/네트워크 로그 토글(기본 on). 영상은 플랫폼별 처리 차이가 있으면 명시. |
| `logs/README.md` | 로그 섹션 개요: 실시간 로그(패널 내 열람) vs 로그 뷰어(첨부 리포트) 구분 + 7-1/7-2 바로가기. |
| `logs/live.md` 실시간 로그 | Debug 탭 콘솔/네트워크 서브탭: 필터·검색·상세, Copy cURL, Clear. 자동 수집(1.5초 주기). **freeform 흡수**: 캡처 없이 "Start Draft"로 로그만 담은 이슈 작성. |
| `logs/viewer.md` 로그 뷰어 | **개발자 관점**: 이슈에 첨부된 `logs.html`을 받아 여는 법 + 타임라인 마커(콘솔/네트워크/액션 — `MarkerType` 3종. 네비게이션은 별도 타입이 아니라 액션 마커의 variant) + 영상 플레이어 + 마커 클릭으로 영상 점프. 로그-영상 시간 동기. |

### 이슈 작성 공통 흐름 (단일 출처 — 3개 `issue.md` 드리프트 방지)

element/screenshot/video 세 `issue.md`는 아래 공통 흐름을 **그대로 반복**하고, 각 페이지는 위 명세표의 "고유분"(미디어 종류 + 녹화 모드 로그 정책)만 다르게 쓴다. 공통 단계는 이 표를 단일 출처로 삼아 ko/en 6벌이 어긋나지 않게 한다.

| 단계 | 내용 |
|---|---|
| 1. 제목 | 설정의 제목 접두어(prefill) 적용 |
| 2. 재현 환경 | 자동 메타(OS/브라우저/URL/뷰포트/시각) readonly + 사용자 추가 변수 row |
| 3. 미디어 | **모드별 고유** — 요소=before/after 스타일 표 / 스크린샷=주석 이미지 / 녹화=영상 |
| 4. 본문 섹션 | 발생 현상·재현 단계·기대 결과·비고 (설정 토글대로). **AI 초안 작성 강조**(핵심 셀링): AI 연결 시 "AI 초안 작성"(en "AI Draft") 배너 → 캡처/로그 컨텍스트(스크린샷=이미지, 요소=before/after+스타일 diff, 녹화/freeform=콘솔·네트워크·액션 로그 요약)를 근거로 **본문 섹션을 자동 작성**. 미연결 시 비노출. |
| 5. 로그 첨부 | 모드별 정책(요소=없음 / 스크린샷=콘솔·네트워크 토글 기본 off / 녹화=콘솔·네트워크·액션 기본 on) |
| 6. 미리보기 | 제출 전 본문 확인 + 마크다운 복사 |
| 7. 제출 | 플랫폼 필드 입력 → 완료 URL |

### 플랫폼 표 (`integrations/platforms.md` 핵심 데이터, 코드 근거)

| 플랫폼 | 연결 방식 | 토큰 입력 시 필요값 | 토큰 발급 |
|---|---|---|---|
| Jira | OAuth / API Token | baseUrl, email, apiToken | id.atlassian.com → API tokens |
| GitHub | OAuth / PAT | PAT | github.com/settings/tokens |
| Linear | OAuth / API Key | apiKey | linear.app 보안 설정 |
| Notion | OAuth / Internal Token | token | notion.so 통합 |
| GitLab | OAuth / PAT | instanceUrl(self-managed 선택), pat | gitlab.com PAT |
| Asana | OAuth / PAT | pat | app.asana.com my-apps |

## 톤앤매너

bug-shot.com 랜딩 기준.

- **한국어**: 존댓말, `-습니다`/`-어요` 혼용, 짧고 명확한 단문(길어도 2~3줄). 공감형 도입("~하던 작업"). 핵심어: "캡처 모드", "리포트", "한 번에", "자동으로", "클릭 한 번으로".
- **영어**: 액션 지향 동사 시작(Click/Take/Turn/Submit), 짧은 문장, 대시·리스트로 단순화. 핵심어: "Inspect & Edit CSS", "Capture & Record", "Console & Network logs", "in one shot / one click", "automatically". (랜딩 영문이 적으므로 ko 내용을 자연스러운 영어로 옮기되 이 어휘를 차용)
- ko/en은 **같은 정보**를 담되 직역하지 않고 각 언어 톤으로 자연스럽게.

## 스크린샷·이미지 처리

- 더미 이미지 1개를 `guide/ko/assets/dummy.jpg`, `guide/en/assets/dummy.jpg`에 배치(원본: `~/Desktop/bugshot-guide-dummy.jpg` 복사).
- 스크린샷이 필요한 모든 자리에 더미 참조 + 의미 있는 alt/캡션:
  - 루트 페이지: `![연결 방식 선택 다이얼로그](assets/dummy.jpg)`
  - 하위폴더 페이지: `![...](../assets/dummy.jpg)` (상대경로 깊이 주의)
- 캡션은 사용자가 나중에 "여기엔 무슨 스크린샷"인지 알 수 있게 구체적으로 쓴다.
- GitBook은 상대경로 이미지를 사용하므로 경로 깊이를 페이지 위치에 맞춘다(루트=`assets/`, 1단계 하위=`../assets/`).

## UI 라벨 표기 규칙

본 명세표의 영문 라벨(Element/Screenshot/Video, Start Draft 등)은 **식별용**이다. 가이드 본문은 **로케일별 실제 화면 라벨**을 인용한다(ko 가이드=ko UI, en 가이드=en UI). 실제 문구는 i18n 기준(`src/i18n/namespaces/`):

| 대상 | ko UI | en UI |
|---|---|---|
| 캡처 모드 | DOM 요소 선택 / 화면 캡처 / 영상 녹화 | Select DOM element / Screenshot / Record video |
| 본문 섹션 | 발생 현상 / 재현 단계 / 기대 결과 / 비고 | Description / Steps to reproduce / Expected result / Notes |
| freeform 진입 버튼 | 이슈 작성 | Write issue |
| 메인 탭 | 디버그 / 이슈 목록 / 연동 / 설정 | (en 키 대응) |

단축키는 화면에서 `chrome.commands.getAll()`로 동적 표시되므로(`useCommandShortcuts.ts`), 가이드는 manifest 배정값 `Cmd/Ctrl+Shift+E`(패널 토글)·`Cmd/Ctrl+Shift+S`(요소)·`Cmd/Ctrl+Shift+F`(스크린샷)·`Cmd/Ctrl+Shift+X`(영상)을 기준으로 적되, OS·타 확장 충돌 시 미배정될 수 있음을 한 줄 안내한다.

**GitBook 확장 문법(`{% hint %}` 등) 미사용** — 주의/경고성 콘텐츠(30초 리플레이 권한 선행, iframe 미지원)는 plain 마크다운 인용구(`>`)로 표기.

## 기존 패턴 준수

- `guide/` 갱신은 `/push` 신선도 검사의 `docs(guide): ...` 트리거 대상. 본 작업 커밋도 `docs(guide): ...` prefix.
- ko/en 동시 갱신 원칙(i18n과 동일 철학) — 한 페이지를 만들면 그 자리에서 ko·en 둘 다 작성해 컨텍스트 유지.
- `.gitbook.yaml`은 기존 그대로(root `./`, summary `SUMMARY.md`) 사용. 변경 없음.

## 대안 검토

- **단일 페이지(현 README 확장)**: 가장 단순하나, 사용자가 "원하는 카테고리만 선택 소비"하는 탐색 구조를 못 만든다. 기각.
- **이슈 작성 공통 페이지 추출 후 모드별 링크**: 중복은 줄지만, 사용자가 자기 모드 문서 하나만 열어도 전체 흐름을 알게 하려는 요구(선택적 소비)와 충돌. 기각 — 모드별 자기완결 유지.
- **en을 ko 직역**: 톤 손상. 기각 — 같은 정보, 언어별 톤 재작성.

## 위험 요소

- **이미지 상대경로**: 하위폴더 페이지에서 `assets/` 깊이를 틀리면 GitBook에서 깨진다. 작성 시 페이지 위치별 경로 일관성 확인.
- **ko/en 드리프트**: 한쪽만 페이지 추가/누락 시 트리 비대칭. SUMMARY와 파일 트리를 양쪽 동일하게 유지(검증 단계에서 대조).
- **사실 정합성**: 단축키(`Cmd/Ctrl+Shift+S` 등)·필드명·연결 방식이 코드와 어긋나면 사용자 혼란. 명세 표를 기준으로 작성하고, 불확실하면 해당 소스 재확인. (CLAUDE.md 게이트웨이 섹션이 단축키를 `Shift+S`로 잘못 적어 둔 전례 — manifest 배정값을 신뢰.)
- **플랫폼 표 스냅샷**: 플랫폼 표(6개)는 **현 시점 스냅샷**이다. `docs/features/`에 azure-devops·clickup 연동 PRD가 동시 존재하므로, 신규 플랫폼이 머지되면 이 표가 즉시 stale — 플랫폼 추가는 별도 `docs(guide)` 갱신 대상으로 분리(본 작업 비목표).
- **로그 뷰어 범위**: `logs.html`은 빌드 산출물(`build:log-viewer`)이라 일반 사용자가 직접 빌드하지 않는다 — "이슈 첨부로 받은 리포트를 여는" 소비자 관점으로만 기술(개발자 대상).
- **분량**: 46개 파일이라 한 번에 다 쓰면 품질 편차. 섹션 단위로 끊어 작성(태스크 참조).
