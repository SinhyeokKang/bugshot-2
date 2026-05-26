---
description: 원격 푸시 전 상태 점검 + CLAUDE.md/DIRECTORY.md/ARCHITECTURE.md/README.md/docs/privacy.md 신선도 확인 + 푸시
---

원격(`origin`)에 현재 브랜치를 안전하게 푸시한다. 푸시 전에 저장소 문서의 신선도를 점검하고 필요시 업데이트까지 커밋한다.

## 절차

0. **브랜치 가드** — `git branch --show-current`로 현재 브랜치 확인. `main`이면 즉시 중단하고 안내:
   > main은 브랜치 프로텍션으로 직접 push가 막혀 있습니다. 작업 변경은 `/merge`로 PR 흐름을 타고, 배포 커밋(버전 범프 + tag)은 `/deploy`에서 처리하세요.

1. **상태 점검 (병렬 실행)**
   - `git status` — 미커밋 변경 확인
   - `git log @{u}..HEAD --oneline` — 푸시될 커밋 목록
   - `git log -1 --stat` — 마지막 커밋 규모
   - 현재 브랜치: `git branch --show-current`

2. **미커밋 변경이 있으면 바로 커밋한다.** `/push`를 실행한 시점에 커밋 의도가 있다고 간주. 변경 파일을 stage하고 **영문 커밋 메시지**로 커밋한 뒤 푸시 절차를 계속 진행한다. 허락을 구하지 않는다.

3. **푸시될 커밋이 없으면** "푸시할 커밋 없음" 알리고 종료.

4. **문서 신선도 검사.** 푸시될 커밋들의 diff(`git diff @{u}..HEAD`)를 훑어 아래 트리거 중 하나라도 해당하면 **CLAUDE.md + README.md 업데이트 후보**:

   트리거:
   - 새 디렉터리/파일 추가·삭제 (특히 `src/` 하위 구조 변화)
   - `package.json`의 scripts 변경
   - `manifest.config.ts` 변경 (권한/명령어/스킴)
   - `src/background/tab-bindings.ts`, `src/sidepanel/App.tsx` 등 아키텍처 핵심 파일의 큰 변경
   - 새 하위 시스템 도입 (예: 새 스토어, 새 훅 카테고리)
   - 새로운 컨벤션·게이트웨이·주의사항이 커밋 메시지에서 드러남
   - 기능 추가/삭제로 README의 사용법·기능 설명이 어긋남
   - 워크플로우/스킬 라인업 변경
   - `manifest.config.ts`의 permissions·host_permissions·optional_host_permissions 변경, 새 플랫폼/연동 추가, 새 데이터 수집·외부 전송 메커니즘 도입 → **docs/privacy.md 업데이트 후보**
   - **⚠️ privacy 전용 트리거 (manifest diff와 무관 — 과거 심사 탈락 원인):** 새 기능이 *기존* 권한(광역 `https://*/*`·`<all_urls>`·`activeTab`·`tabCapture`·`scripting` 등)을 **새 목적으로 사용**하거나, 새 캡처·수집·저장·전송 *동작*을 추가하면 manifest 텍스트가 그대로여도 privacy 갱신 후보다. **manifest diff가 0이라는 이유로 privacy 검사를 건너뛰지 말 것.** 판단은 권한 문자열이 아니라 **실제 코드 동작**에 건다: diff에서 `chrome.permissions.request` / `captureVisibleTab` / `tabCapture` / `chrome.scripting` / 신규 `fetch`·외부 엔드포인트 / `chrome.storage`·IndexedDB 신규 write 호출이 보이면 무조건 docs/privacy.md를 대조한다. (예: 30s Replay가 기존 optional 권한으로 `captureVisibleTab` 상시 캡처를 추가했으나 manifest는 불변이라 트리거를 빠져나간 사례.)

   검사 대상 5개:
   - **CLAUDE.md** — 코드 컨벤션, 게이트웨이, 워크플로우 등 해당 섹션이 최신인지 확인
   - **DIRECTORY.md** — 디렉터리 구조·파일별 역할이 현재 코드베이스와 일치하는지 확인
   - **ARCHITECTURE.md** — Side Panel 탭 스코프, 세션 영속화, 인증 플로우, 어댑터 패턴, 토큰 체인, CSSOM 캐시, DOM lazy load, 이슈 섹션 구성, 마이그레이션 등 설계 상세가 최신인지 확인
   - **README.md** — 기능 목록, 설치/사용법, 스크린샷 설명 등이 현재 코드와 맞는지 확인
   - **docs/privacy.md** — 권한·호스트 권한·수집 정보·외부 전송 대상·저장 방식이 현재 매니페스트·**코드 동작**과 일치하는지 확인. 매니페스트뿐 아니라 캡처/수집/전송 *동작*까지 본다. 내용을 갱신하면 문서 상단의 **시행일도 오늘 날짜로 함께 갱신**한다.

   해당되는 변경을 발견하면:
   - 각 문서를 실제로 읽고 대응 섹션이 최신 상태인지 비교
   - 업데이트가 필요하면 **사용자에게 확인 후** Edit으로 반영
   - 문서별로 별도 커밋 (예: `docs(CLAUDE): update tab scope session description`, `docs(README): add new feature description`, `docs(privacy): add new platform data disclosure`)
   - 변경 불필요하거나 사용자가 스킵을 원하면 건너뜀

5. **푸시 전 최종 확인.** 사용자에게 "푸시해도 되냐" 묻고 OK면:
   - `git push` (upstream 없으면 `git push -u origin <branch>`)
   - 출력에서 결과 줄만 발췌해 보고

## 금지 사항

- `git push --force` / `--force-with-lease`는 **사용자가 명시 요청**한 경우에만. main/master에는 force push 금지 (요청받으면 경고 후 재확인).
- `--no-verify`로 hook 스킵 금지. hook 실패하면 원인 수정이 우선.
- 사용자가 확인해 주기 전까지 새 커밋을 만들지 않는다 (문서 업데이트 커밋 포함).
- `.env`, 크레덴셜 파일 등은 staged여도 경고하고 멈춤.
