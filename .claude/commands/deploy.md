---
description: 웹스토어 배포 (main 가드 → tag push → 스토어 빌드 → zip → GitHub Release draft → 심사 요청 안내)
---

Chrome 웹스토어 배포 흐름. main 브랜치에서만 실행. 버전 bump는 이미 `/merge` 단계에서 PR에 포함돼 main에 들어와 있다고 가정하고, `/deploy`는 그 버전을 가리키는 tag를 origin에 push + 스토어 빌드 산출물 패키징 + 크롬 웹스토어 심사 요청 가이드까지 한 번에 진행한다.

## 워크플로우 위치

```
1. dev 기준 pull → 작업 (/pull → 코드 작성 → /build로 검증)
2. dev push (/push)
3. /merge — dev 위에서 버전 bump 커밋 + dev → main squash PR
4. main 체크아웃 + git pull → /deploy ← 여기 (tag만 push)
5. dev 동기화 (force push, /deploy 마지막 안내 따라 수동 실행)
```

## 사전 가정

- main 브랜치 프로텍션은 그대로 유효해도 무방. **tag push는 branch ref가 아니라서 보호 규칙을 우회 없이 통과**한다 (tag protection rule이 별도로 걸려 있지 않은 한).
- `package.json`의 버전은 `/merge`에서 bump된 후 main에 squash 머지된 상태여야 한다. 그렇지 않으면 이번 배포는 직전 배포와 같은 버전이 되고, Chrome 웹스토어가 거부한다.

## 절차

0. **브랜치 가드** — `git branch --show-current`로 현재 브랜치 확인. `main`이 아니면 즉시 중단:
   > deploy는 main에서만 실행합니다. `git checkout main && git pull` 후 다시 시도하세요.

1. **사전 점검 (병렬 실행)**
   - `git status` — 미커밋 변경 확인. 있으면 "먼저 커밋하세요" 안내 후 중단.
   - `git fetch origin main && git status -uno` — main이 origin/main과 동기 상태인지. 뒤처지면 `git pull` 안내 후 중단.
   - `node -p "require('./package.json').version"` — 배포할 버전 확인
   - `git tag -l "v$(node -p \"require('./package.json').version\")"` — 같은 tag가 이미 존재하는지
   - `git log --oneline -10` — 직전 머지 흐름

2. **버전/태그 검증.**
   - `package.json` 버전이 직전 배포 버전과 같으면 (= `/merge`에서 bump를 깜빡한 경우) 즉시 중단:
     > 현재 버전이 직전 배포와 동일합니다. `/merge`에서 버전 bump를 빠뜨렸거나 같은 버전을 재배포하려는 상황입니다. 의도된 거면 dev에서 bump 후 다시 `/merge` → `/deploy` 하세요.
   - 같은 이름의 tag가 이미 있으면 (로컬이든 origin이든) 중단하고 알린다. 사용자가 의도적으로 재배포하는 거면 tag 삭제 후 재시도하라고 안내.

3. **tag 생성 + push.**
   ```
   git tag v<version>
   git push origin v<version>
   ```
   - branch가 아닌 tag ref만 push하므로 main 브랜치 보호 규칙과 무관하게 통과한다.
   - 거부 시 (예: tag protection rule이 별도로 걸려 있는 경우): 즉시 중단하고 안내한다. zip 단계로 넘어가지 않는다.

4. **스토어 빌드.** `pnpm build:store` 실행 (timeout 300000ms). `BUGSHOT_STORE_BUILD=1`로 manifest의 dev용 `key`가 빠진 산출물을 만든다.
   - 실패 시 에러 보고 + 중단 (이미 push된 tag는 그대로 두되 사용자에게 알림 — 같은 버전 재시도하려면 tag 삭제 후 재실행).
   - 성공 시 주요 번들 크기만 간결히 보고 (폰트 subset 로그 생략).

5. **zip 패키징.**
   ```
   cd dist && zip -r ../bugshot-v<version>.zip . && cd ..
   ```
   - 동일 이름 zip이 있으면 덮어쓸지 사용자에게 확인.
   - 완료 후 파일 절대경로 + 크기 보고.

6. **GitHub Release draft 생성.**

   먼저 직전 tag(`git describe --tags --abbrev=0 HEAD^` 또는 `git tag --sort=-v:refname | head -2`) 이후 main에 머지된 commit·PR 목록을 수집한다 (`git log <prev-tag>..HEAD --oneline`). 그걸 사용자 관점으로 카테고리화해서 **영문 release notes 본문을 직접 작성**한다 (`--generate-notes` 사용 금지 — 자동 생성된 PR 제목 나열은 사용자에게 의미가 약함).

   ### Release notes 양식 (영문 고정)

   ```markdown
   ## Highlights

   <한 문장으로 이 릴리스가 무엇을 하는지. "tightens X, expands Y, adds Z" 식으로 동사 3개 정도.>

   ## Features

   ### <기능 그룹 제목>
   - **<짧은 헤드라인>.** <뭐가 달라졌는지 + 왜 중요한지 1-3문장. 사용자 관점 동작 위주.>
   - …

   ## Fixes

   - **<버그 헤드라인>.** <원인 + 해결 + 사용자가 체감하는 변화. console 메시지 등은 백틱으로 인용.>

   ## Install

   The Chrome Web Store build (`bugshot-v<version>.zip`) is attached to this release. Until the store review completes you can sideload it:

   1. Download and unzip `bugshot-v<version>.zip`
   2. Open `chrome://extensions` and enable **Developer mode**
   3. Click **Load unpacked** and select the unzipped folder

   **Full changelog:** https://github.com/SinhyeokKang/bugshot-2/compare/v<prev-version>...v<version>
   ```

   ### 작성 가이드

   - **사용자가 봐도 되는 내용만 적는다.** Release notes는 확장 사용자/다운로더를 위한 문서다. 이들이 **체감하는 변화만** 포함:
     - 새 기능, 동작 변경, 버그 수정, UI/UX 변경, 권한/스토리지 영향, 성능/용량 변화 → **포함**
     - 워크플로우 / 빌드 스크립트 / `.claude/commands/*` 스킬 / `CLAUDE.md` / 내부 리팩토링 / docs 수정 / lockfile 동기화 → **제외**
     - 즉 release notes 작성 시 commit 목록을 훑어 위 분류로 필터링한 뒤 남는 commit들로만 본문을 구성한다. (commit이 모두 internal인 경우는 § "internal-only release" 참고.)
   - **사용자 관점 우선**. commit message를 그대로 옮기지 말고 "사용자가 무엇을 하게 되는지 / 무엇이 사라졌는지 / 왜 좋아졌는지"로 다시 쓴다.
   - **Features 섹션은 그룹화**. 동일 영역 변경(picker, issue form, settings 등)을 `### <그룹>` 단위로 묶어 헤딩한다. 그룹 내 항목은 bold 헤드라인 + 본문 1-3문장.
   - **Fixes**: 단순 패치라도 사용자가 체감하던 증상을 명시 (예: 콘솔 경고, 깜빡임, 데이터 누락).
   - **bold + 백틱 활용**. 헤드라인은 `**X.**`로 시작, 식별자는 `` `code` ``. 가독성 위해 빈 줄 유지.
   - **이전/이번 버전이 같은 commit을 둘 다 포함하는 경우**(예: 추가 후 같은 release 안에서 제거): "added briefly during this cycle, then removed" 식으로 한 줄 정리. 별도 항목으로 분리 금지.
   - **버전 비교 링크**는 항상 직전 release tag 기준 (`v<prev-version>...v<version>`).
   - **분량**: Highlights 1문장 + Features 3-6 항목 + Fixes 0-3 항목이 적정.

   ### internal-only release

   필터링 후 남는 commit이 0개면 (예: 워크플로우 / 스킬 / 문서만 수정한 release) Highlights에 `Maintenance release — no user-facing changes.` 한 줄만 적고 Features / Fixes 섹션은 생략. Install / Full changelog는 그대로 유지.

   ### 생성 명령

   본문이 길어서 인라인 escaping이 복잡하므로 **임시 파일을 거쳐 `--notes-file`로 전달**한다:

   ```
   # 작성한 본문을 임시 파일로 저장 (Write 툴 사용 권장)
   # /tmp/bugshot-release-notes.md

   gh release create v<version> \
     --draft \
     --title "v<version>" \
     --notes-file /tmp/bugshot-release-notes.md \
     bugshot-v<version>.zip

   rm /tmp/bugshot-release-notes.md
   ```

   - `--draft`: 즉시 published되지 않음. 사용자가 GitHub UI에서 검토 후 publish.
   - `--notes-file`: heredoc/escaping 회피. 작성한 영문 본문을 그대로 전달.
   - zip을 asset으로 첨부 → 외부 사용자가 unpacked 설치 또는 버전 아카이브 용도로 다운로드 가능.
   - 출력의 release URL을 절차 7 안내에 그대로 노출.
   - 실패 시(권한 부족·이미 release 존재 등): 에러 보고 + 중단. zip은 이미 생성되어 있으므로 사용자가 수동으로 `gh release create` 재시도 가능.
   - **사용자가 본문을 직접 손대고 싶다고 미리 말한 경우에만** `--generate-notes`로 가벼운 자동 생성 → 사용자 검토 후 재작성하는 방식 허용. 기본은 위 양식대로 직접 작성.

7. **심사 요청 안내 + Release publish 안내 + dev 동기화 안내.**

   ### 심사 요청 흐름
   - 크롬 웹스토어 개발자 대시보드: https://chrome.google.com/webstore/devconsole
   - 해당 항목 선택 → **패키지** 탭 → 새 zip 업로드
   - 변경 사항(스토어 등록정보 / 개인정보처리방침 / 권한 변경 사유 등) 갱신이 필요하면 같이 수정
   - 우상단 **"검토를 위해 제출"** 버튼 → 심사 요청
   - 심사 통과 시 자동 publish (며칠 ~ 1주 단위 소요)

   ### GitHub Release publish
   - 절차 6에서 만든 release URL 열기.
   - 직접 작성한 영문 본문 검토 → 필요시 수정. (스토어 심사가 통과되기 전까지는 publish를 미뤄도 무방하지만, 사용자가 sideload zip을 미리 공유하고 싶다면 먼저 publish해도 됨.)
   - 우상단 **"Publish release"** 버튼 클릭. asset(zip)은 그대로 유지.
   - publish하면 GitHub Atom 피드 / 워치하는 사용자에게 알림 발송.

   ### dev 동기화
   `/merge` 직후 dev가 squash 머지로 인해 main과 분기돼 있다. 아직 `/sync`를 안 했다면 지금이라도 실행 권장 (force push라 별도 스킬에서 사용자 승인 받음).

## 주의

- **main이 아닌 브랜치에서는 절대 진행하지 않는다** (절차 0에서 차단).
- 미커밋 변경이 있으면 절대 진행하지 않는다.
- 버전 bump는 이 스킬의 책임이 아니다. `/merge`에서 처리. `/deploy`에서 `pnpm version` 실행 금지.
- 같은 버전 tag가 이미 origin에 있으면 강제 덮어쓰기(`git push -f origin v<version>`) 금지 — 의도가 명확할 때만 사용자가 직접 처리.
- tag push가 실패하면 zip 단계로 넘어가지 않는다 (스토어 산출물의 버전이 SCM에 미반영된 상태로 배포되는 걸 막음).
- 빌드 전 코드 수정 금지.
- 스토어 업로드는 사용자가 대시보드에서 직접 수행한다 (자동화 금지 — 심사 제출 실수 방지).
- `gh release create`는 `--draft`로만 호출. `--prerelease`나 즉시 published 옵션은 사용자 명시 요청 시에만.
- Release notes는 **영문 + 직접 작성**이 기본이다. `--generate-notes` 자동 생성은 사용자가 명시적으로 "자동으로", "기본으로", "내가 다시 적을게" 같이 표현했을 때만.
