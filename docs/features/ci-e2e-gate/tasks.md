# e2e 게이트 CI 이관 — 구현 태스크

## 선행 조건

- `gh` CLI 인증 상태에서 브랜치 프로텍션 수정 권한 필요(Task 8). `gh api repos/:owner/:repo/branches/main/protection`이 200이면 OK.
- 새 의존성 없음. `@playwright/test`(^1.60.0)는 이미 devDependency이고 `--shard`·`github` reporter·`forbidOnly`는 전부 기본 제공.
- `manifest.config.ts`·권한·캡처 동작 변경 없음 → `docs/privacy.*`·`docs/PERMISSION.md`는 대상 아님.
- **Task 1~7은 로컬 검증만으로 완결되지 않는다.** 최종 확인은 Task 9(첫 CI 런)에서 이뤄진다.

## 태스크

### Task 1: `.env.ci` 추가 + gitignore 예외

- **변경 대상**: `.env.ci`(신규), `.gitignore`, `.env.example`
- **작업 내용**:
  - `.env.ci`를 `.env.example`과 **동일한 키 순서**로 만들고, 8개 `VITE_*_CLIENT_ID`와 `VITE_OAUTH_PROXY_URL`에 더미 값을 넣는다(예: `VITE_ATLASSIAN_CLIENT_ID=e2e-dummy-atlassian`, `VITE_OAUTH_PROXY_URL=https://e2e.invalid`). `VITE_GITHUB_CLIENT_ID_PROD`와 `VITE_POSTHOG_KEY*`는 **빈 값 유지**(store 빌드 전용 / 집계 no-op).
  - 파일 상단에 목적 주석: CI 전용, 실값 아님, `isConfigured()` 통과용.
  - `.gitignore`의 `!.env.example` 다음 줄에 `!.env.ci` 추가.
  - `.gitignore`에서 `e2e/.last-green` 줄 삭제.
  - `.env.example` 상단 주석에 `.env.ci`의 존재·목적 한 줄 추가.
- **검증**:
  - [ ] `git check-ignore -v .env.ci`가 아무것도 출력하지 않음(추적 대상)
  - [ ] `git check-ignore -v .env.local`은 여전히 무시됨
  - [ ] `.env.ci`와 `.env.example`의 키 집합이 동일 — `grep -o '^VITE_[A-Z_]*' .env.ci | sort` == `.env.example` 동일 명령 결과
  - [ ] `grep -n POSTHOG .env.ci`의 값이 전부 빈 문자열

### Task 2: `playwright.config.ts` CI 분기 + logview `dependencies` 제거

- **변경 대상**: `e2e/playwright.config.ts`
- **작업 내용**: `const isCI = !!process.env.CI` 도입 후 `retries: isCI ? 2 : 0`, `forbidOnly: isCI`, CI 전용 `github` reporter 추가. `logview` project의 `dependencies: ["sidepanel"]` 삭제. 기존 주석(workers·retries·project 분리 사유)은 새 동작에 맞게 갱신하되 삭제하지 않는다.
- **검증**:
  - [ ] `pnpm typecheck` 통과 (`tsconfig.e2e.json`이 루트 references에 편입돼 있어 config도 검사 대상)
  - [ ] `pnpm exec playwright test --config e2e/playwright.config.ts --list` 출력의 총 테스트 수가 변경 전과 동일
  - [ ] `CI=1 pnpm exec playwright test --config e2e/playwright.config.ts --list`가 오류 없이 같은 목록을 출력(= `.only` 잔존 없음, `forbidOnly` 통과)
  - [ ] `pnpm exec playwright test --config e2e/playwright.config.ts --project=logview --list`가 sidepanel 테스트를 포함하지 않음

### Task 3: fixture의 off-screen 창 위치 CI 분기

- **변경 대상**: `e2e/fixtures/extension.ts`
- **작업 내용**: `args` 배열의 `--window-position=-10000,-10000` 조건을 `process.env.E2E_SHOW === "1" || process.env.CI`로 확장. 인접 주석에 "CI(xvfb)에선 볼 화면이 없고, 가상 스크린 밖으로 밀면 렌더가 클립될 수 있어 생략한다"를 추가한다. `headless: false`는 유지.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 로컬 `pnpm test:e2e -- --shard=1/4` 실행 시 창이 여전히 화면 밖(깜빡임 없음)
  - [ ] `CI=1 E2E_SHOW=1`·`CI=1` 조합 모두 `--window-position`이 args에 없음(코드 리뷰로 확인)

### Task 4: CI 워크플로에 e2e 매트릭스 + 집계 job 추가

- **변경 대상**: `.github/workflows/ci.yml`
- **작업 내용**:
  - `on`에 `schedule: - cron: "0 18 * * *"`(03:00 KST)와 `workflow_dispatch: {}` 추가.
  - `e2e` job 추가: `runs-on: ubuntu-latest`, `timeout-minutes: 30`, `strategy: { fail-fast: false, matrix: { shard: [1,2,3,4] } }`. 스텝은 checkout → pnpm/action-setup → setup-node(node 22, cache pnpm) → `pnpm install --frozen-lockfile` → `cp .env.ci .env.local` → `pnpm exec playwright install --with-deps chromium` → `pnpm build:e2e` → `xvfb-run -a --server-args="-screen 0 1920x1080x24" pnpm test:e2e -- --shard=${{ matrix.shard }}/4` → `if: failure()` artifact 업로드(`playwright-report/`, `test-results/`, `retention-days: 7`, 이름에 샤드 번호 포함).
  - `e2e-gate` job 추가: `needs: [e2e]`, `if: always()`, `runs-on: ubuntu-latest`. `needs.e2e.result != 'success'`면 exit 1.
  - `verify`는 수정하지 않는다. `e2e`에 `needs`를 걸지 않아 병렬 실행.
  - 기존 주석 스타일(왜 이 스텝이 있는지 한국어 설명)을 따라 xvfb 24비트 깊이 이유, `.env.ci` 복사 이유, `e2e-gate` 존재 이유를 각각 남긴다. 기존 "e2e는 여기서 안 돈다" 주석 블록은 삭제.
- **검증**:
  - [ ] `gh workflow view ci.yml` 또는 YAML 파서로 문법 오류 없음
  - [ ] `grep -c "shard" .github/workflows/ci.yml` — matrix 정의와 CLI 인자에서 분모 `4`가 일치
  - [ ] push 후 Actions 탭에 `verify`, `e2e (1)`~`e2e (4)`, `e2e-gate` 6개 job이 뜸 (Task 9에서 확인)

### Task 5: `/e2e-run`·`/push`에서 로컬 게이트 제거

- **변경 대상**: `.claude/commands/e2e-run.md`, `.claude/commands/push.md`
- **작업 내용**:
  - `e2e-run.md`: frontmatter `description`의 `.last-green` 문구 삭제, 본문에서 green 시 해시 기록 단계 삭제. 스킬 성격을 "로컬 수동 전수 실행 + 리포트"로 재서술.
  - `push.md`: 5단계 "e2e 게이트" 전체 삭제. 6단계를 5단계로 번호 조정. push 성공 보고에 CI run URL 안내 추가(`gh run list --branch <branch> --workflow ci.yml --limit 1 --json url --jq '.[0].url'`, 실패 시 Actions 탭 링크 폴백, **대기하지 않음**).
- **검증**:
  - [ ] `grep -rn "last-green" .claude/commands/`가 `merge.md`·`ship.md`만 남김(Task 6에서 처리)
  - [ ] `pnpm sync:agents:check` — `e2e-run` 미러 드리프트 검출됨(훅이 자동 재생성했으면 통과). `push`는 EXCLUDE라 미러 무관
  - [ ] `push.md` 단계 번호가 1~5로 연속

### Task 6: `/merge`·`/ship` 게이트를 CI 기준으로 교체

- **변경 대상**: `.claude/commands/merge.md`, `.claude/commands/ship.md`
- **작업 내용**:
  - `merge.md` 4단계: 로컬 해시 대조를 `gh run list --branch dev --workflow ci.yml --limit 20 --json headSha,status,conclusion,url`로 dev HEAD 일치 런 탐색 + 결론 판정(success 통과 / failure·cancelled·timed_out 중단 / in_progress·queued는 `gh run watch <id> --exit-status` 대기 / 일치 런 없으면 중단)으로 교체. "푸시 전·bump 전에 두는 이유" 문단을 새 구조에 맞게 다시 쓴다.
  - `merge.md` 10단계: `gh pr merge <number> --squash` 앞에 `gh pr checks <number> --watch --fail-fast` 대기 추가. required check(`verify` + `e2e-gate`) 때문에 즉시 머지가 거부된다는 이유를 명시.
  - `ship.md`: 12단계(`/e2e-run`) 삭제, 이후 단계 번호 13→12·14→13·15→14로 조정. 43행 Codex 종착점 문단을 "11단계(마지막 커밋)까지"로 수정하고 `.last-green` 서술 삭제. 구 13단계 설명의 "e2e 게이트(`.last-green`==HEAD면 스킵)" 삭제. 파이프라인 요약 문구(`/ship` 설명의 `→(/e2e-run)→` 부분)도 함께 정리.
- **검증**:
  - [ ] `grep -rn "last-green" .` 전체 0건 (`.git` 제외)
  - [ ] `ship.md`의 단계 번호가 0~14로 연속, 중복·누락 없음
  - [ ] `pnpm sync:agents:check` 통과 (`ship`·`e2e-run` 미러 반영됨, `merge`는 EXCLUDE)
  - [ ] `e2e/.last-green` 파일 삭제 (`rm -f e2e/.last-green` — gitignore였으므로 git 상태 무관)

### Task 7: 문서 갱신

- **변경 대상**: `CLAUDE.md`, `docs/DIRECTORY.md`, `e2e/README.md`, `CONTRIBUTING.md`
- **작업 내용**:
  - `CLAUDE.md` "CI (GitHub Actions)" 섹션: "e2e는 CI에서 안 돈다" 문단 전체 교체 → e2e 4샤드·xvfb·`.env.ci`·`e2e-gate` required check·nightly(main) 설명. 로컬 게이트(`.last-green`) 언급 삭제. `build`+`check:prearm`이 CI에 있는 이유 문단은 유지하되 "유일한 행동 검증이 CI에 없다"는 서술이 더 이상 맞지 않으므로 수정(`logs-prearm.spec.ts`가 이제 CI에서 돈다 — 구조 검사는 빠른 1차 그물로 재정의).
  - `CLAUDE.md` 스킬 라인업 표: `/e2e-run`·`/push`·`/merge`·`/ship` 줄에서 `.last-green` 제거. "권장 흐름" 문단의 `/push`(e2e 게이트)·`/merge`(게이트 교차) 서술 갱신.
  - `docs/DIRECTORY.md`: 102행(`e2e/` — `.last-green` 서술 제거), 106행(`playwright.config.ts` 요약 — `retries: CI 2 / 로컬 0`, logview `dependencies` 제거 반영), 129행(`workflows/ci.yml` 요약 — e2e 매트릭스·집계 job 추가), 루트 파일 목록에 `.env.ci` 항목 추가.
  - `e2e/README.md` "실행" 섹션: CI 자동 실행 명시(트리거·샤드·xvfb), `--no-deps` 안내 삭제(의존 제거로 불필요), "창 깜빡임" 문단에 CI에선 off-screen 미적용 추가, `retries` 서술 갱신(`sidepanel — 확장 구동 메인 게이트(retries:0, 결정적)` → CI 분기 반영).
  - `CONTRIBUTING.md` 51~53행: "isn't in CI and you don't need to run it. I run it locally before merging" → CI에서 자동 실행되고 PR에 required check로 걸린다는 서술로 교체(영문).
- **검증**:
  - [ ] `grep -rni "e2e.*not.*in CI\|isn't in CI\|CI에서 안 돈다\|CI에 없다" CLAUDE.md CONTRIBUTING.md e2e/README.md docs/DIRECTORY.md` 0건
  - [ ] `pnpm sync:agents:check` 통과 (CLAUDE.md 편집 → `AGENTS.md` 재생성 반영)
  - [ ] `README.md`/`README.ko.md`의 e2e 서술(198·205·210행 등)이 여전히 정확한지 확인 — 명령어만 나열하므로 수정 불필요할 가능성 높으나 대조는 한다

### Task 8: 브랜치 프로텍션에 `e2e-gate` required check 추가

- **변경 대상**: 저장소 설정 (코드 아님)
- **작업 내용**: **Task 9에서 `e2e-gate`가 최소 1회 성공적으로 보고된 뒤** 실행한다. 존재한 적 없는 check를 required로 걸면 이후 모든 PR이 영구 pending이 된다.
  ```
  gh api -X PATCH repos/:owner/:repo/branches/main/protection/required_status_checks \
    -f 'contexts[]=verify' -f 'contexts[]=e2e-gate'
  ```
- **검증**:
  - [ ] `gh api repos/:owner/:repo/branches/main/protection --jq '.required_status_checks.contexts'`가 `["verify","e2e-gate"]`
  - [ ] 테스트 PR에서 두 check가 모두 required로 표시됨

### Task 9: 첫 CI 런 검증 + 실패 대응

- **변경 대상**: 없음 (관측 + 필요 시 Task 3·4 수정)
- **작업 내용**: Task 1~7을 커밋하고 dev에 push한 뒤 첫 런을 관측한다. 관측 항목과 대응:
  | 증상 | 원인 추정 | 대응 |
  |---|---|---|
  | 전 spec이 fixture 단계에서 timeout | xvfb에서 확장 SW 미기동 | `--no-sandbox` 추가 → `--disable-dev-shm-usage` 추가 순으로 |
  | 색상 판정 spec만 실패(`capture`·`capture-methods`) | 컬러 깊이 | `--server-args` 깊이 확인, `x24` 누락 여부 |
  | 연동 탭 관련 spec 실패 | `.env.ci` 미적용/키 누락 | `cp .env.ci .env.local` 스텝 위치·키 대조 |
  | 샤드별 시간 편차 큼 | 무거운 spec 편중 | 관측만 — 이번 스코프에선 조정 안 함 |
  | 특정 spec이 retry로만 통과(flaky 리포트) | 환경 flaky | 목록만 기록. 수리는 별도 작업 |
- **검증**:
  - [ ] `e2e-gate`가 green
  - [ ] 전체 wall-clock 10분 이내 (성공 기준 1)
  - [ ] 4샤드의 테스트 수 합계가 `--list` 총계와 일치
  - [ ] flaky로 리포트된 spec 목록을 보고에 기록

### Task 10: 게이트 차단 동작 확인 (음성 케이스)

- **변경 대상**: 없음 (임시 브랜치에서만)
- **작업 내용**: spec 하나를 일부러 깨는 커밋을 임시 브랜치에 올려 `e2e-gate`가 빨간불이 되는지, main 대상 PR이 프로텍션에 막히는지 확인한다. 확인 후 브랜치 삭제.
- **검증**:
  - [ ] 실패 샤드만 red, 나머지 샤드는 완주(`fail-fast: false` 동작)
  - [ ] `e2e-gate`가 red
  - [ ] 해당 샤드의 `playwright-report` artifact가 업로드됨
  - [ ] main 대상 PR에서 머지 버튼이 막힘

## 테스트 계획

- **단위 테스트**: 없음. 이번 변경은 순수 함수를 추가·수정하지 않는다(워크플로 YAML·Playwright config·env 파일·스킬 마크다운). `pnpm test`는 회귀 확인용으로 통과만 확인한다.
- **e2e 시나리오**: 신규 spec 없음. 기존 63개 spec이 그대로 판정 대상이며, 이번 작업의 "e2e 시나리오"에 해당하는 것은 Task 9·10의 CI 런 자체다.
- **수동 테스트** (Chrome/GitHub에서 확인):
  - [ ] 로컬 `pnpm test:e2e`가 변경 전과 동일하게 동작 — 창이 화면 밖, `retries: 0`, 실패 시 즉시 red
  - [ ] `E2E_SHOW=1 pnpm test:e2e -- --shard=1/4`로 창이 보임(디버그 경로 보존)
  - [ ] `pnpm test:e2e --project=logview`가 sidepanel 없이 단독 실행됨
  - [ ] `/push` 실행 시 e2e가 돌지 않고 CI URL이 보고됨
  - [ ] `/merge` 실행 시 dev HEAD CI 결론을 조회해 게이트로 씀 (실제 릴리스 때 확인)

## 구현 순서 권장

```
Task 1 (.env.ci)  ─┐
Task 2 (config)   ─┼─> Task 4 (워크플로) ─> Task 9 (첫 런) ─> Task 8 (프로텍션) ─> Task 10 (음성 케이스)
Task 3 (fixture)  ─┘
Task 5 (skills)   ─┬─> Task 7 (문서)
Task 6 (skills)   ─┘
```

- **Task 1·2·3은 병렬 가능** — 서로 독립이고 전부 Task 4의 전제다.
- **Task 5·6은 병렬 가능** — 서로 다른 스킬 파일이지만, Task 6의 `grep -rn "last-green"` 0건 검증은 Task 5 완료 후에만 성립한다. 순차가 안전.
- **Task 4는 Task 1~3 이후.** 워크플로가 `.env.ci`와 CI 분기를 전제한다.
- **Task 8은 반드시 Task 9 이후.** 존재한 적 없는 check를 required로 걸면 이후 모든 PR이 영구 pending이 된다.
- **Task 7(문서)은 Task 4·6 이후** — 확정된 동작을 서술해야 한다. Task 9에서 워크플로를 수정하면 문서도 함께 갱신한다.
- 커밋 분리 권장: `ci(e2e): run Playwright suite on GitHub Actions`(Task 1~4) / `chore(skills): drop local e2e gate`(Task 5~6) / `docs: ...`(Task 7).

## 가이드 영향

없음. 내부 개발 워크플로 변경으로, 확장 사용자에게 노출되는 UX·기능이 아니다.
