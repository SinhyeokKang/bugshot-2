# BugShot 사용자 가이드 콘텐츠 — 구현 태스크

## 선행 조건

- 더미 이미지 원본: `~/Desktop/bugshot-guide-dummy.jpg` (800×500 JPEG) 존재 확인.
- 톤 참고: bug-shot.com (ko) / bug-shot.com/en (en).
- 작성 단위 원칙: **페이지 하나당 ko·en을 그 자리에서 동시에 작성**(컨텍스트 유지). 섹션 단위로 태스크를 끊되, 각 태스크 안에서 양 언어를 함께 만든다.
- 사실 명세는 `design.md`의 "페이지별 콘텐츠 명세" + "플랫폼 표" + "이슈 작성 공통 흐름"을 기준으로 한다. 불확실한 사실은 해당 `src/` 소스를 재확인 후 작성(추측 금지).
- **UI 라벨**: 로케일별 실제 화면 라벨 인용(design.md "UI 라벨 표기 규칙" 표). 영문 라벨을 ko 본문에 그대로 쓰지 않는다.
- **단축키**: `Cmd/Ctrl+Shift+E`(패널 토글) / `Cmd/Ctrl+Shift+S`(요소) / `Cmd/Ctrl+Shift+F`(스크린샷) / `Cmd/Ctrl+Shift+X`(영상). (`Shift+S` 아님 — manifest.config.ts 배정값.)
- **GitBook 확장 문법(`{% hint %}`) 미사용** — 주의 콘텐츠는 plain 인용구(`>`).
- **사실 대조 소스**(검증 시 이 경로를 본다): 본문 섹션 `settings-ui-store.ts`(`DEFAULT_ISSUE_SECTIONS`)·`src/i18n/namespaces/issue.ts` / 스타일 섹션 `src/i18n/namespaces/editor.ts`·`StyleEditorPanel.tsx` / annotation `AnnotationOverlay.tsx`(markerjs2) / 단축키 `manifest.config.ts` / 로그 정책 `captureLogSupport.ts`·`editor-store.ts` / GitBook URL `src/lib/external-links.ts`.

## 태스크

### Task 0: 골격 — 디렉터리·더미 이미지·SUMMARY
- **변경 대상**: `guide/ko/`, `guide/en/` 하위 폴더, `guide/{ko,en}/assets/dummy.jpg`, `guide/{ko,en}/SUMMARY.md`
- **작업 내용**:
  - `integrations/`, `settings/`, `element/`, `screenshot/`, `video/`, `logs/` 폴더를 ko·en 양쪽에 생성.
  - `~/Desktop/bugshot-guide-dummy.jpg`를 `guide/ko/assets/dummy.jpg`, `guide/en/assets/dummy.jpg`로 복사.
  - `SUMMARY.md`를 `design.md`의 트리대로 ko·en 양쪽 갱신(23개 항목, 중첩 구조).
- **검증**:
  - [x] ko·en 폴더 트리 동일
  - [x] `assets/dummy.jpg` 양쪽 존재
  - [x] SUMMARY 23개 링크, ko/en 경로 대칭

### Task 1: 소개 + 빠른 시작
- **변경 대상**: `guide/{ko,en}/README.md`, `guide/{ko,en}/quick-start.md`
- **작업 내용**: README = 제품 한 문단 + 메인 탭 4개 개념 + 섹션 바로가기. quick-start = 설치→사이드패널 열기(`Cmd/Ctrl+Shift+E`)→플랫폼 연결→캡처→작성→제출 1흐름, 단계별 더미 스크린샷.
- **검증**:
  - [x] 플레이스홀더 0건
  - [x] 바로가기 링크가 실제 페이지로 연결
  - [x] ko/en 동일 구조

### Task 2: 연동 설정 섹션 (3페이지)
- **변경 대상**: `guide/{ko,en}/integrations/{README,platforms,issue-tracking}.md`
- **작업 내용**: README 개요+바로가기 / platforms = 추가 플로우 + 6개 플랫폼 표(연결 방식·입력값·발급 링크) + 기본값 + 연결 해제 / issue-tracking = 이슈 목록(필터·검색·그룹), Draft 편집 vs Submitted 읽기전용, **Refresh 상태 재조회(연결 필요)**, Delete All.
- **검증**:
  - [x] 플랫폼 표 6행, design.md 플랫폼 표와 일치
  - [x] 더미 스크린샷 경로(`../assets/dummy.jpg`) 정상
  - [x] ko/en 대칭

### Task 3: 기본 설정 섹션 (3페이지)
- **변경 대상**: `guide/{ko,en}/settings/{README,issue,ai}.md`
- **작업 내용**: README 개요+바로가기 / issue = 제목 접두어, 본문 구성 토글(4섹션, Notes 기본 off, override, paragraph/orderedList), 30초 리플레이 토글+권한 / ai = LLM 연결(BYOK: baseUrl/apiKey/modelId), 연결 시 **AI 스타일링·AI 초안 작성** 활성화 강조 + 두 기능 페이지 교차링크.
- **검증**:
  - [x] 본문 섹션 4종·기본값 코드와 일치
  - [x] 30초 리플레이 권한 설명 + video/replay.md 교차 링크
  - [x] ai 페이지가 AI 스타일링·AI 초안 작성 활성화를 강조하고 두 페이지로 교차링크
  - [x] ko/en 대칭

### Task 4: 요소 모드 섹션 (4페이지)
- **변경 대상**: `guide/{ko,en}/element/{README,picker,styling,issue}.md`
- **작업 내용**: README 개요+바로가기 / picker = Element 버튼·`Cmd/Ctrl+Shift+S`·DOM 트리·Repick·iframe 미지원 / styling = 스타일 패널 섹션 9종·라이브 반영·Reset·**AI 스타일링 강조**(자연어 지시로 스타일 변경 — AI 연결 시 배너)·Next / issue = **자기완결** 초안 전체(공통 흐름 표 참조: 제목·재현환경·**before/after 스타일 표**·본문 섹션·로그 첨부·미리보기·제출·완료·마크다운 복사) + **AI 초안 작성 강조**(AI 연결 시 본문 자동 작성).
- **검증**:
  - [x] 스타일 섹션 목록 코드와 일치(`editor.ts`/`StyleEditorPanel.tsx`)
  - [x] AI 스타일링 설명 포함(styling), AI 초안 작성 설명 포함(issue)
  - [x] issue 페이지 자기완결 필수항목 체크: 제목·재현환경·미디어(before/after)·본문섹션·로그·미리보기·제출·완료·마크다운 복사
  - [x] ko/en 대칭

### Task 5: 스크린샷 모드 섹션 (4페이지)
- **변경 대상**: `guide/{ko,en}/screenshot/{README,capture,annotation,issue}.md`
- **작업 내용**: README 개요+바로가기 / capture = Screenshot 버튼·영역 드래그·산출 / annotation = 주석 추가/편집/초기화 / issue = **자기완결**(미디어만 주석 스크린샷, 나머지 흐름 동일).
- **검증**:
  - [x] annotation 도구 설명이 실제 markerjs2 툴바(`AnnotationOverlay.tsx`)와 일치
  - [x] issue 페이지 자기완결(공통 흐름 필수항목 — Task 4 검증과 동일 체크, 미디어=주석 이미지)
  - [x] ko/en 대칭

### Task 6: 녹화 모드 섹션 (4페이지)
- **변경 대상**: `guide/{ko,en}/video/{README,record,replay,issue}.md`
- **작업 내용**: README 개요+바로가기(실시간 vs 30초 차이) / record = Video 버튼·타이머·Stop·산출·최대 길이 / replay = 30초 버퍼·버튼 상태·**설정 권한 선행(교차 링크)** / issue = **자기완결 + 녹화 전용 로그 정책 자세히**(영상 + 액션 로그 + 콘솔/네트워크 토글).
- **검증**:
  - [x] replay 권한 선행조건 명시 + settings/issue.md 링크 (plain 인용구)
  - [x] issue 페이지에 녹화 모드 로그 정책 상세 + 자기완결 공통 흐름 필수항목(미디어=영상)
  - [x] ko/en 대칭

### Task 7: 로그 섹션 (3페이지)
- **변경 대상**: `guide/{ko,en}/logs/{README,live,viewer}.md`
- **작업 내용**: README 개요(실시간 로그 vs 로그 뷰어 구분)+바로가기 / live = 콘솔·네트워크 서브탭(필터·검색·상세·Copy cURL·Clear·자동수집) + **freeform 흡수**(Start Draft로 로그만 담은 이슈) / viewer = **개발자 관점** logs.html 소비(타임라인 마커·영상 플레이어·마커 점프·시간 동기).
- **검증**:
  - [x] freeform 경로 live.md에 포함
  - [x] viewer가 개발자(버그 처리자) 관점으로 서술
  - [x] ko/en 대칭

### Task 8: 전체 정합성 검수
- **변경 대상**: 없음(검토) — 필요 시 수정
- **작업 내용**: 23×2 페이지 전수 — 플레이스홀더 잔존, 깨진 내부 링크, 이미지 경로 깊이, ko/en 트리·섹션 대칭, 단축키·필드명 사실 일치 확인.
- **검증**:
  - [x] `grep -rn "작성 예정\|coming soon" guide/` 0건
  - [x] SUMMARY + 본문 내부 링크 대상 파일 전부 존재(ko·en) — 아래 링크 검사 one-liner
  - [x] 더미 이미지 경로 전부 유효(루트 `assets/`, 하위 `../assets/`)
  - [x] ko 페이지 수 == en 페이지 수
  - [x] ko/en 페이지별 헤딩(`^#`) 구조 대칭 — 섹션 구성 일치 확인

## 테스트 계획

- 본 작업은 순수 문서라 단위 테스트 대상 없음(`pnpm test` 영향 없음).
- 검증은 정적 점검으로 대체:
  - 플레이스홀더 잔존 검사: `grep -rn "작성 예정\|coming soon" guide/`
  - 파일 대칭: `diff <(cd guide/ko && find . -name '*.md' | sort) <(cd guide/en && find . -name '*.md' | sort)`
  - 내부 링크 깨짐 검사(각 언어 루트에서): 마크다운 `](경로.md)`/이미지 `](경로)` 상대 경로를 뽑아 `test -f`로 대상 존재 확인하는 루프(앵커 `#...`·외부 URL 제외). SUMMARY와 본문 모두 대상.
  - ko/en 헤딩 대칭: 페이지별 `grep -c '^#'` 또는 헤딩 목록 diff로 섹션 구성 일치 확인.
- 수동: GitBook 동기 후(또는 로컬 미리보기) 좌측 트리·이미지·내부 링크 렌더 확인. (배포는 별도)

## 구현 순서 권장

- **Task 0 먼저**(골격·더미·SUMMARY) — 이후 모든 태스크의 전제.
- Task 1~7은 섹션 독립이라 순서 무관·병렬 가능하나, 톤 일관성을 위해 Task 1(소개)을 먼저 써서 어휘·문체 기준을 잡는 것을 권장.
- Task 8은 1~7 완료 후 마지막.
- 각 태스크 내부에서 ko·en을 반드시 함께 작성(분리 금지 — 드리프트·컨텍스트 손실 방지).
