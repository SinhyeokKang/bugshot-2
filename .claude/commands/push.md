---
description: 원격 푸시 전 상태 점검 + CLAUDE.md/docs/DIRECTORY.md/docs/ARCHITECTURE.md/README.md/docs/PERMISSION.md/docs/privacy.{ko,en}.md/guide/ 신선도 확인 + 푸시
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

4. **문서 신선도 검사 (트라이아지 → 정밀).** 검사 대상이 6개라 무겁게 느껴지지만, 본질은 **diff를 한 번 읽고 트리거에 걸리는 문서만 골라내는 것**이다. 문서 수만큼 비용이 늘지 않는다.

   **4a. 트라이아지 (1회, 가볍게).** 푸시될 커밋들의 diff(`git diff @{u}..HEAD`)를 **한 번** 훑어, 아래 트리거에 걸리는 문서를 **후보 목록**으로 매핑한다. 이 단계에서는 문서를 읽지 않는다 — diff와 트리거만 본다.
   - **후보가 0개면 검사 종료하고 바로 5단계(e2e 게이트)로 간다.** 대부분의 push가 여기서 통과한다.
   - 후보가 1개 이상이면 4b로 진행하되, **걸린 문서만** 다룬다.

   트리거:
   - 새 디렉터리/파일 추가·삭제 (특히 `src/` 하위 구조 변화)
   - `package.json`의 scripts 변경
   - `manifest.config.ts` 변경 (권한/명령어/스킴)
   - `src/background/tab-bindings.ts`, `src/sidepanel/App.tsx` 등 아키텍처 핵심 파일의 큰 변경
   - 새 하위 시스템 도입 (예: 새 스토어, 새 훅 카테고리)
   - 새로운 컨벤션·게이트웨이·주의사항이 커밋 메시지에서 드러남
   - 기능 추가/삭제로 README의 사용법·기능 설명이 어긋남
   - 사용자 노출 UX·기능 추가/변경 → **guide/ 업데이트 후보** (`guide/ko`·`guide/en` 양쪽 대조, 커밋 prefix `docs(guide): ...`). **guide/ 작성·수정 전 반드시 `guide/AUTHORING.md`를 먼저 읽고 그 규칙(IA·톤·UI 라벨·footer·검증)대로 한다.**
   - 가이드 IA·운영 방식·톤·UI 라벨 규칙·사실 스냅샷(특히 플랫폼 표)·지원 플랫폼 등 **가이드 작성 기준 자체가 바뀜** → **guide/AUTHORING.md 업데이트 후보**
   - 워크플로우/스킬 라인업 변경
   - `manifest.config.ts`의 permissions·host_permissions·optional_host_permissions 변경, 새 플랫폼/연동 추가, 새 데이터 수집·외부 전송 메커니즘 도입 → **docs/privacy.{ko,en}.md 업데이트 후보** (ko 원본·en 번역 양쪽 동시)
   - **⚠️ privacy 전용 트리거 (manifest diff와 무관 — 과거 심사 탈락 원인):** 새 기능이 *기존* 권한(광역 `https://*/*`·`<all_urls>`·`activeTab`·`tabCapture`·`scripting` 등)을 **새 목적으로 사용**하거나, 새 캡처·수집·저장·전송 *동작*을 추가하면 manifest 텍스트가 그대로여도 privacy 갱신 후보다. **manifest diff가 0이라는 이유로 privacy 검사를 건너뛰지 말 것.** 판단은 권한 문자열이 아니라 **실제 코드 동작**에 건다: diff에서 `chrome.permissions.request` / `captureVisibleTab` / `tabCapture` / `chrome.scripting` / 신규 `fetch`·외부 엔드포인트 / `chrome.storage`·IndexedDB 신규 write 호출이 보이면 무조건 docs/privacy.{ko,en}.md를 대조한다. (예: 30s Replay가 기존 optional 권한으로 `captureVisibleTab` 상시 캡처를 추가했으나 manifest는 불변이라 트리거를 빠져나간 사례.)

   **4b. 후보 정밀 검사.** 트라이아지에서 걸린 문서만 아래 관점으로 실제 읽고 대조한다. 안 걸린 문서는 열지 않는다.

   검사 대상 8개:
   - **CLAUDE.md** — 코드 컨벤션, 게이트웨이, 워크플로우 등 해당 섹션이 최신인지 확인
   - **docs/DIRECTORY.md** — 디렉터리 구조·파일별 역할이 현재 코드베이스와 일치하는지 확인
   - **docs/ARCHITECTURE.md** — Side Panel 탭 스코프, 세션 영속화, 인증 플로우, 어댑터 패턴, 토큰 체인, CSSOM 캐시, DOM lazy load, 이슈 섹션 구성, 마이그레이션 등 설계 상세가 최신인지 확인
   - **README.md** — 기능 목록, 설치/사용법, 스크린샷 설명 등이 현재 코드와 맞는지 확인
   - **docs/PERMISSION.md** — Chrome 권한 전체 레퍼런스(activeTab 라이프사이클, OAuth 토큰 흐름, optional permission 등)가 현재 manifest·코드와 일치하는지 확인. 권한 추가/삭제, 사용처 변경, 새 API 호출 추가 시 갱신
   - **docs/privacy.{ko,en}.md** — 권한·호스트 권한·수집 정보·외부 전송 대상·저장 방식이 현재 매니페스트·**코드 동작**과 일치하는지 확인. 매니페스트뿐 아니라 캡처/수집/전송 *동작*까지 본다. **ko가 원본, en은 번역이라 내용이 항상 같아야 한다 — 갱신 시 ko/en 양쪽 본문과 상단 시행일을 오늘 날짜로 함께 갱신**한다(한쪽만 고치면 en이 stale).
   - **guide/** — 사용자 노출 UX·기능 변경 시 `guide/ko`·`guide/en`(GitBook 사용 가이드, ko/en 양쪽 site)이 현재 동작과 맞는지 대조. **작성·수정에 들어가기 전 `guide/AUTHORING.md`를 먼저 읽어 IA·톤·UI 라벨·footer·검증 규칙을 그대로 따른다** (가이드 작업의 단일 출처). **변경 규모가 크면(여러 페이지·IA 변경) 여기서 직접 쓰지 말고 `/guide` 스킬로 분리**하고, 작은 문구 수정만 인라인 처리. 커밋 prefix `docs(guide): ...`
   - **guide/AUTHORING.md** — 가이드 작성 매뉴얼 자체의 신선도. 가이드 운영 규칙(IA/파일 트리·톤·사실 대조 소스·현재 사실 스냅샷·플랫폼 표·footer·검증 체크리스트)이 코드/구조 변경으로 어긋났는지 확인. 새 플랫폼 연동·단축키 변경·로그 정책 변경·본문 섹션 변경·새 페이지 추가 등이 diff에 보이면 AUTHORING.md의 해당 스냅샷·표를 갱신. 커밋 prefix `docs(guide): ...`

   해당되는 변경을 발견하면:
   - 각 문서를 실제로 읽고 대응 섹션이 최신 상태인지 비교
   - 업데이트가 필요하면 확인 없이 바로 Edit으로 반영
   - 문서별로 별도 커밋 (예: `docs(CLAUDE): update tab scope session description`, `docs(README): add new feature description`, `docs(privacy): add new platform data disclosure`)
   - 변경 불필요하면 건너뜀

5. **e2e 게이트.** 문서 신선도 검사 후, 푸시 직전에 수행:
   1. `cat e2e/.last-green`이 `git rev-parse HEAD`와 일치하면 → "직전 green (해시)" 한 줄로 통과.
   2. 불일치(또는 파일 없음) → `/e2e-run` 절차 수행 (`pnpm build:e2e` → `pnpm test:e2e` → 리포트).
   3. **빨강 → 실패 리포트 후 중단 (푸시 안 함).** 사용자가 "skip e2e"로 명시 우회한 경우에만 생략하고 보고에 우회 사실 기록.
   4. green → 워킹 트리 클린일 때만 `git rev-parse HEAD > e2e/.last-green` 기록(dirty면 생략을 보고에 명시) 후 푸시로 진행. 통상 이 기록으로 `/merge` 게이트가 스킵된다(캐시 priming).

6. **푸시 실행.** 확인 없이 바로 푸시한다:
   - `git push` (upstream 없으면 `git push -u origin <branch>`)
   - 출력에서 결과 줄만 발췌해 보고

## 금지 사항

- `git push --force` / `--force-with-lease`는 **사용자가 명시 요청**한 경우에만. main/master에는 force push 금지 (요청받으면 경고 후 재확인).
- `--no-verify`로 hook 스킵 금지. hook 실패하면 원인 수정이 우선.
- `.env`, 크레덴셜 파일 등은 staged여도 경고하고 멈춤.
- `.env`, 크레덴셜 파일 등은 staged여도 경고하고 멈춤.
