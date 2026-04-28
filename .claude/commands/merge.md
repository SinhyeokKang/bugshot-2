---
description: dev → main PR 생성 + squash 머지 + dev 동기화
---

현재 작업 브랜치(보통 `dev`)를 `main`에 PR squash merge로 합치고, 머지 후 dev를 main과 동기화한다. main은 브랜치 프로텍션이 걸려있어 직접 push가 막혀있고, PR이 셀프 머지 가능한 환경 가정.

## 절차

1. **사전 점검 (병렬 실행)**
   - `git branch --show-current` — 현재 브랜치 확인. main이면 즉시 중단하고 안내.
   - `git status` — 미커밋 변경 확인
   - `git log @{u}..HEAD --oneline` — 푸시되지 않은 로컬 커밋
   - `git log origin/main..HEAD --oneline` — main 대비 머지될 커밋 목록
   - `gh pr list --base main --head <current-branch> --state open --json number,title,url` — 기존 열린 PR 있는지

2. **미커밋 변경이 있으면 멈추고 사용자에게 알린다.** `/merge`는 커밋된 변경만 다룬다. 자동 커밋 금지. 사용자가 `/push`로 먼저 정리하도록 안내.

3. **머지될 커밋이 없으면** "main에 머지할 새 커밋 없음" 알리고 종료.

4. **푸시 안 된 로컬 커밋이 있으면 먼저 푸시.** `git push` (upstream 없으면 `-u origin <branch>`). 푸시 실패하면 원인 보고 후 중단.

5. **PR 준비.**
   - 기존 PR이 있으면 재사용. 번호와 URL을 보여준다.
   - 없으면 `gh pr create --base main --head <current-branch> --fill`로 생성. `--fill`은 마지막 커밋 메시지를 title/body로 자동 채움. 머지될 커밋이 여러 개면 fill로 부족할 수 있으니 title을 검토하고, 필요시 `--title`/`--body`로 덮어쓰기 제안.

6. **머지 직전 요약 + 사용자 승인.** PR 번호, 제목, 머지될 커밋 목록을 짧게 보여주고 "main에 squash merge해도 되냐" 묻는다. 승인 없으면 중단.

7. **머지 실행.**
   ```
   gh pr merge <number> --squash
   ```
   `--delete-branch`는 기본 OFF (dev 브랜치 살려둠). 머지 결과 출력에서 핵심 줄만 보고.

8. **dev 동기화 안내.** main 머지 후 dev가 main 뒤로 처지지 않게 `/sync` 실행 권장. (force push라 별도 스킬에서 사용자 승인 받음.) 안 하면 다음 PR diff가 지저분해질 수 있음.

## 금지 사항

- 현재 브랜치가 `main`이면 즉시 중단. main에서 자기 자신으로 머지는 의미 없음.
- `gh pr merge --admin`(브랜치 프로텍션 우회)은 사용자 명시 요청 시에만.
- `gh pr merge --merge` / `--rebase`로 머지 방식 변경은 사용자 명시 요청 시에만. 기본은 `--squash` (linear history + 1 PR = 1 commit).
- main 브랜치에 직접 push 시도 금지 (프로텍션이 막지만 시도 자체도 안 함).
- dev 동기화의 `git push -f`는 사용자 승인 없이 실행 금지.
- 사전 점검에서 `.env`, 크레덴셜 파일이 미커밋 변경에 보이면 경고하고 멈춤.
