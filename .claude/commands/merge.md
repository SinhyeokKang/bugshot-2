---
description: dev → main PR 생성 + 커버리지 리포트(비차단) + 버전 bump + squash 머지 + dev 동기화
---

현재 작업 브랜치(보통 `dev`)에 버전 bump 커밋을 얹은 뒤 `main`에 PR squash merge로 합치고, 머지 후 dev를 main과 동기화한다. main은 브랜치 프로텍션이 걸려있어 직접 push가 막혀있고, PR이 셀프 머지 가능한 환경 가정.

버전 bump를 머지 단계에서 처리하는 이유: bump 커밋이 PR에 포함돼서 squash로 main에 자연스럽게 들어가기 때문에 main 직접 push / 보호 우회가 필요 없다. tag는 `/deploy`에서 main HEAD를 가리키도록 별도로 찍는다.

## 절차

1. **사전 점검 (병렬 실행)**
   - `git branch --show-current` — 현재 브랜치 확인. main이면 즉시 중단하고 안내.
   - `git status` — 미커밋 변경 확인
   - `git log @{u}..HEAD --oneline` — 푸시되지 않은 로컬 커밋
   - `git log origin/main..HEAD --oneline` — main 대비 머지될 커밋 목록
   - `gh pr list --base main --head <current-branch> --state open --json number,title,url` — 기존 열린 PR 있는지
   - `node -p "require('./package.json').version"` — 현재 버전

2. **미커밋 변경이 있으면 멈추고 사용자에게 알린다.** `/merge`는 커밋된 변경만 다룬다. 자동 커밋 금지. 사용자가 `/push`로 먼저 정리하도록 안내.

3. **머지될 커밋이 없으면** "main에 머지할 새 커밋 없음" 알리고 종료.

4. **e2e 게이트 (원격 CI 결론 조회).** dev HEAD 커밋의 CI 결론을 조회한다 — 로컬에서 e2e를 돌리지 않는다.
   ```
   git rev-parse HEAD
   gh run list --branch dev --workflow ci.yml --limit 20 \
     --json databaseId,headSha,status,conclusion,url
   ```
   `headSha`가 dev HEAD와 일치하는 run을 찾아 판정한다:

   | 상태 | 처리 |
   |---|---|
   | `conclusion: success` | 통과 — 다음 단계 |
   | `status: in_progress`/`queued` | `gh run watch <databaseId> --exit-status`로 대기 후 결론 재조회 |
   | 완료됐지만 `conclusion != success` | **중단** (PR 생성 안 함) |
   | 일치 run 없음 | **중단** — "dev HEAD가 push되지 않았거나 CI가 트리거되지 않음" 보고 |
   | API 오류·알 수 없는 상태 | **중단** — 원인과 run 또는 Actions URL 보고 |

   중단 시 원인과 확인할 URL을 함께 보고한다. 사용자가 "skip e2e"로 명시 우회 요청한 경우에만 생략하고 보고에 우회 사실 기록.

   **bump 전에 두는 이유**: 빨강 코드로 PR을 만들지 않기 위해서다. bump 커밋은 메타데이터만 바꾸므로 **여기서 확인한 green이 곧 머지될 코드의 green**이다(bump 후 CI가 다시 도는 건 required check 충족용이고, 10단계가 그걸 기다린다).

   `/push`는 더 이상 e2e를 돌리지 않으므로 이 조회가 로컬 캐시 교차검증이 아니라 **유일한 사전 확인**이다.

5. **커버리지 리포트 (비차단).** e2e 통과 후 `pnpm test:coverage` → `pnpm coverage:report`로 로직 스코프 라인 %를 베이스라인 대비 리포트한다(`/coverage` 스킬과 동일 경로). main에 들어가는 코드 기준 커버리지 스냅샷 — dev→main 경계가 래칫의 자연스러운 측정점이다.
   - **막지 않는다.** 회귀(하락 로직 파일)가 보여도 경고로 요약에 남기고 머지는 계속 진행.
   - 유닛 테스트가 하나라도 **실패**하면 e2e가 통과했더라도 회귀 신호이므로 중단하고 보고한다(커버리지 수치는 무의미).
   - 개선됐으면(로직 % 상승 또는 하락 파일 0) **승인 없이 자동으로** `pnpm coverage:update`로 `coverage/baseline.json`을 래칫 갱신하고, bump 커밋과 별개로 `chore(coverage): ratchet baseline`으로 커밋해 같은 PR에 포함한다(베이스라인 = "직전 main 머지 시점 커버리지"로 정렬). 요약에 갱신 사실만 한 줄 보고.
   - **회귀가 있으면(하락 로직 파일 존재) 자동 갱신하지 않는다** — 회귀를 덮으면 래칫이 무의미. 하락 파일을 경고로 남기고 머지는 계속 진행(비차단).

6. **푸시 안 된 로컬 커밋이 있으면 먼저 푸시.** `git push` (upstream 없으면 `-u origin <branch>`). 푸시 실패하면 원인 보고 후 중단.

7. **버전 bump.** 사용자에게 범프 레벨을 물어본다:
   - `patch` — 버그 수정 (기본)
   - `minor` — 기능 추가
   - `major` — Breaking change
   - `skip` — 같은 릴리스에 다른 PR이 이미 bump했거나 docs/internal-only 머지면 건너뜀

   `skip`이 아니면:
   ```
   pnpm version <level> --no-git-tag-version
   git add package.json pnpm-lock.yaml
   git commit -m "v<new-version>"
   git push
   ```
   `--no-git-tag-version`은 자동 commit/tag 둘 다 막는다. 직접 commit해서 메시지를 통제하고, tag는 절대 만들지 않는다 (squash로 가리켜도 의미 없는 dev HEAD를 가리키게 되므로).

   **lockfile도 반드시 같이 stage한다.** `pnpm version`은 `package.json`뿐 아니라 `pnpm-lock.yaml` 안의 `version` 필드도 같이 업데이트한다. lockfile을 빠뜨리면 main에 머지된 후 `package.json`(새 버전)과 lockfile(이전 버전)이 mismatch 상태가 되고, 다음 install 시 lockfile이 다시 갱신돼 추가 PR이 필요해진다. 이 저장소의 lockfile은 `pnpm-lock.yaml` 하나다 — npm `package-lock.json`은 트래킹하지 않으므로(gitignore) `git add`에 넘기면 pathspec 에러로 죽는다.

8. **PR 준비.**
   - 기존 PR이 있으면 재사용. 번호와 URL을 보여준다.
   - 없으면 `gh pr create --base main --head <current-branch>`로 생성. **PR title과 body는 영문으로 작성한다.**
   - **PR title 포맷: `v{version}: {summary}`** (예: `v1.3.0: 30s Replay, Action Recorder, Log Viewer redesign`). bump를 skip한 경우 현재 `package.json` 버전을 사용. summary는 머지될 커밋 목록을 참고해 핵심 변경을 간결하게 영문으로 작성한다.
   - body에 세부 사항을 넣는다. `--fill`은 사용하지 않는다.

9. **머지 직전 요약.** PR 번호, 제목, 머지될 커밋 목록(버전 bump 커밋 포함)을 짧게 보여주고 **별도 승인 없이 바로 머지로 진행**한다.

10. **머지 실행.** PR CI가 green이 될 때까지 기다린 뒤 머지한다.
   ```
   gh pr checks <number> --watch --fail-fast
   gh pr merge <number> --squash
   ```
   **대기가 필요한 이유**: `verify`와 `e2e-gate`가 required status check라, PR 생성 직후 바로 `gh pr merge`를 부르면 미충족으로 거부된다. bump 커밋이 새 SHA를 만들었으므로 4단계에서 본 run과는 별개의 run이 돈다(≈5분).

   `--watch`가 빨강으로 끝나면 **중단하고 리포트** — `--admin`으로 우회하지 않는다.

   `--delete-branch`는 기본 OFF (dev 브랜치 살려둠). 머지 결과 출력에서 핵심 줄만 보고.

   `/push`(논블로킹)와 달리 여기서 기다리는 건 의도적이다 — `/merge`는 드물게 일어나는 종착 액션이고, 11단계 `/sync`가 실제 머지 완료를 전제로 이어진다.

11. **dev 동기화 자동 실행.** main 머지가 성공하면 곧바로 `/sync` 절차를 이어서 실행해 dev를 origin/main 상태로 맞추고 origin/dev에 force push한다. (유실 여부는 `/sync`가 diff 검증으로 자체 판단 — dev 전용 커밋이 실제 미반영 작업을 담고 있으면 `/sync`가 중단하니 그 판단을 그대로 따른다.) 안 하면 다음 PR diff가 지저분해질 수 있음. 이어서 배포할 거면 `git checkout main && git pull` 후 `/deploy`로.

## 금지 사항

- 현재 브랜치가 `main`이면 즉시 중단. main에서 자기 자신으로 머지는 의미 없음.
- `pnpm version`을 옵션 없이 실행 금지. 반드시 `--no-git-tag-version`으로 tag 생성을 막는다 (tag는 `/deploy`의 책임).
- `gh pr merge --admin`(브랜치 프로텍션 우회)은 사용자 명시 요청 시에만.
- `gh pr merge --merge` / `--rebase`로 머지 방식 변경은 사용자 명시 요청 시에만. 기본은 `--squash` (linear history + 1 PR = 1 commit).
- main 브랜치에 직접 push 시도 금지 (프로텍션이 막지만 시도 자체도 안 함).
- dev 동기화의 `git push -f`는 `/sync` 절차(diff 유실 검증) 밖에서 실행 금지.
- 사전 점검에서 `.env`, 크레덴셜 파일이 미커밋 변경에 보이면 경고하고 멈춤.
