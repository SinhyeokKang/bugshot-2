# e2e 게이트 CI 이관 — 구현 태스크

## 선행 조건

- `gh` CLI 인증 상태에서 브랜치 프로텍션 수정 권한 필요(Task 8). `gh api repos/:owner/:repo/branches/main/protection`이 200이면 OK.
- 새 의존성 없음. `@playwright/test`(^1.60.0)는 이미 devDependency이고 `--shard`·`github` reporter·`forbidOnly`는 전부 기본 제공.
- `manifest.config.ts`·권한·캡처 동작 변경 없음 → `docs/privacy.*`·`docs/PERMISSION.md`는 대상 아님.
- **Task 1~4·7a는 로컬 검증만으로 완결되지 않는다.** Task 9에서 첫 CI green을 확인해야 Task 5·6·7b·8의 로컬 게이트 제거·브랜치 프로텍션으로 진행할 수 있다.

## 태스크

### Task 1: `.env.ci` 추가 + gitignore 예외

- **변경 대상**: `.env.ci`(신규), `.gitignore`, `.env.example`
- **작업 내용**:
  - `.env.ci`를 `.env.example`과 **동일한 키 순서**로 만들고, 8개 `VITE_*_CLIENT_ID`와 `VITE_OAUTH_PROXY_URL`에 더미 값을 넣는다(예: `VITE_ATLASSIAN_CLIENT_ID=e2e-dummy-atlassian`, `VITE_OAUTH_PROXY_URL=https://e2e.invalid`). `VITE_GITHUB_CLIENT_ID_PROD`와 `VITE_POSTHOG_KEY*`는 **빈 값 유지**(store 빌드 전용 / 집계 no-op).
  - 파일 상단에 목적 주석: CI 전용, 실값 아님, `isConfigured()` 통과용.
  - `.gitignore`의 `!.env.example` 다음 줄에 `!.env.ci` 추가.
  - `.env.example` 상단 주석에 `.env.ci`의 존재·목적 한 줄 추가.
  - **`.gitignore`의 `e2e/.last-green` 줄은 여기서 지우지 않는다** — 1차 단계에선 로컬 게이트가 살아 있어 `/e2e-run`·`/push`가 계속 그 파일을 쓴다. 무시 규칙을 먼저 걷으면 untracked 노이즈가 되고 실수로 커밋될 수 있다. 삭제는 Task 6(파일 `rm`과 같은 단계)에서.
- **검증**:
  - [ ] `git check-ignore -q .env.ci`의 exit code가 `1`(=무시 안 됨). **`-v`는 negation 규칙도 "매칭"으로 출력하고 exit 0을 주므로 판정에 쓰면 안 된다** — `git status --porcelain`에 `?? .env.ci`가 뜨는지로 교차 확인
  - [ ] `git check-ignore -q .env.local`의 exit code가 `0`(여전히 무시됨)
  - [ ] `.env.ci`와 `.env.example`의 키 집합이 동일 — `grep -o '^VITE_[A-Z0-9_]*' .env.ci | sort` == `.env.example` 동일 명령 결과
  - [ ] `grep -n POSTHOG .env.ci`의 값이 전부 빈 문자열

### Task 2: `playwright.config.ts` CI 분기 + logview `dependencies` 제거

- **변경 대상**: `e2e/playwright.config.ts`
- **작업 내용**: `const isCI = !!process.env.CI` 도입 후 `retries: isCI ? 1 : 0`, `forbidOnly: isCI`, CI 전용 `github` reporter 추가. `logview` project의 `dependencies: ["sidepanel"]` 삭제. 기존 주석(workers·retries·project 분리 사유)은 새 동작에 맞게 갱신하되 삭제하지 않는다.
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
  - [ ] 로컬 `pnpm test:e2e --shard=1/4` 실행 시 창이 여전히 화면 밖(깜빡임 없음)
  - [ ] `CI=1 E2E_SHOW=1`·`CI=1` 조합 모두 `--window-position`이 args에 없음(코드 리뷰로 확인)

### Task 4: CI 워크플로에 e2e 매트릭스 + 집계 job 추가

- **변경 대상**: `.github/workflows/ci.yml`
- **작업 내용**:
  - 워크플로 최상단에 `permissions: contents: read`를 명시해 `GITHUB_TOKEN` 권한을 최소화한다.
  - `on`에 `schedule: - cron: "0 18 * * *"`(03:00 KST)와 `workflow_dispatch: {}` 추가.
  - `e2e` job 추가: `runs-on: ubuntu-latest`, `timeout-minutes: 30`, `strategy: { fail-fast: false, matrix: { shard: [1,2,3,4] } }`. 스텝은 checkout → pnpm/action-setup → setup-node(node 22, cache pnpm) → `pnpm install --frozen-lockfile` → `cp .env.ci .env.local` → `pnpm exec playwright install --with-deps chromium` → `pnpm build:e2e` → `xvfb-run -a --server-args="-screen 0 1920x1080x24" pnpm test:e2e --shard=${{ matrix.shard }}/4` → `if: failure()` artifact 업로드(`playwright-report/`, `test-results/`, `retention-days: 7`, 이름에 샤드 번호 포함).
  - `e2e-gate` job 추가: `needs: [e2e]`, `if: always()`, `runs-on: ubuntu-latest`. `needs.e2e.result != 'success'`면 exit 1.
  - `verify`는 수정하지 않는다. `e2e`에 `needs`를 걸지 않아 병렬 실행.
  - 기존 주석 스타일(왜 이 스텝이 있는지 한국어 설명)을 따라 xvfb 24비트 깊이 이유, `.env.ci` 복사 이유, `e2e-gate` 존재 이유를 각각 남긴다. 기존 "e2e는 여기서 안 돈다" 주석 블록은 삭제.
- **검증**:
  - [ ] `gh workflow view ci.yml` 또는 YAML 파서로 문법 오류 없음
  - [ ] `grep -c "shard" .github/workflows/ci.yml` — matrix 정의와 CLI 인자에서 분모 `4`가 일치
  - [ ] push 후 Actions 탭에 `verify`, `e2e (1)`~`e2e (4)`, `e2e-gate` 6개 job이 뜸 (Task 9에서 확인)

### Task 5: 첫 CI green 후 `/e2e-run`·`/push`에서 로컬 게이트 제거

- **변경 대상**: `.claude/commands/e2e-run.md`, `.claude/commands/push.md`
- **진입 조건**: Task 9에서 동일 워크플로의 `e2e-gate` green 1회 확인.
- **작업 내용**:
  - `e2e-run.md`: frontmatter `description`의 `.last-green` 문구 삭제, 본문에서 green 시 해시 기록 단계 삭제. 스킬 성격을 "로컬 수동 전수 실행 + 리포트"로 재서술.
  - `push.md`: 5단계 "e2e 게이트" 전체 삭제. 6단계를 5단계로 번호 조정. push 직전 HEAD를 저장하고, 성공 후 `gh run list --branch <branch> --workflow ci.yml --limit 10 --json headSha,url,status` 결과에서 SHA가 일치하는 CI run URL만 안내한다. 아직 등록되지 않았거나 일치 run이 없으면 Actions 탭 링크로 폴백하고 **대기하지 않는다**.
- **검증**:
  - [ ] `grep -rn "last-green" .claude/commands/`가 `merge.md`·`ship.md`만 남김(Task 6에서 처리)
  - [ ] `pnpm sync:agents:check` — `e2e-run` 미러 드리프트 검출됨(훅이 자동 재생성했으면 통과). `push`는 EXCLUDE라 미러 무관
  - [ ] `push.md` 단계 번호가 1~5로 연속

### Task 6: `/merge`·`/ship` 게이트를 CI 기준으로 교체

- **변경 대상**: `.claude/commands/merge.md`, `.claude/commands/ship.md`
- **진입 조건**: Task 9 green 확인 후 Task 5와 함께 전환.
- **작업 내용**:
  - `merge.md` 4단계: 로컬 해시 대조를 `gh run list --branch dev --workflow ci.yml --limit 20 --json databaseId,headSha,status,conclusion,url`로 dev HEAD 일치 런 탐색 + 결론 판정(`success`만 통과 / `in_progress`·`queued`는 `gh run watch <databaseId> --exit-status` 후 재조회 / 그 외 결론·API 오류·알 수 없는 상태·일치 런 없음은 전부 중단)으로 교체. 중단 시 원인과 run 또는 Actions URL을 보고한다. "푸시 전·bump 전에 두는 이유" 문단을 새 구조에 맞게 다시 쓴다.
  - `merge.md` 10단계: `gh pr merge <number> --squash` 앞에 `gh pr checks <number> --watch --fail-fast` 대기 추가. required check(`verify` + `e2e-gate`) 때문에 즉시 머지가 거부된다는 이유를 명시.
  - `ship.md`: 12단계(`/e2e-run`) 삭제, 이후 단계 번호 13→12·14→13·15→14로 조정. 43행 Codex 종착점 문단을 "11단계(마지막 커밋)까지"로 수정하고 `.last-green` 서술 삭제. 구 13단계 설명의 "e2e 게이트(`.last-green`==HEAD면 스킵)" 삭제. 파이프라인 요약 문구(`/ship` 설명의 `→(/e2e-run)→` 부분)도 함께 정리.
- **검증**:
  - [ ] `rg -n "last-green" .gitignore .claude/commands CLAUDE.md AGENTS.md .agents/skills docs/DIRECTORY.md e2e/README.md`가 0건(feature 설계 문서의 역사 설명은 검사 대상 제외)
  - [ ] `ship.md`의 단계 번호가 0~14로 연속, 중복·누락 없음
  - [ ] Codex에서는 원본 수정 뒤 `pnpm sync:agents` 직접 실행. 이어서 `pnpm sync:agents:check` 통과 (`ship`·`e2e-run` 미러 반영됨, `merge`는 EXCLUDE)
  - [ ] `.gitignore`에서 `e2e/.last-green` 줄 삭제 (Task 1에서 미룬 항목)
  - [ ] `e2e/.last-green` 파일 삭제 (`rm -f e2e/.last-green` — gitignore였으므로 git 상태 무관)

### Task 7a: 문서 갱신 — CI 실행 사실 (1차 커밋에 포함)

- **변경 대상**: `CLAUDE.md`, `docs/DIRECTORY.md`, `e2e/README.md`, `CONTRIBUTING.md`
- **왜 1차인가**: Task 4가 워크플로에 e2e를 넣는 순간 "e2e는 CI에서 안 돈다"는 서술이 **즉시 거짓**이 된다. 이 상태로 push하면 `/push` 문서 신선도 검사(`.github/workflows/ci.yml` 변경 → 새 게이트웨이 도입 트리거)에 걸려 어차피 멈춘다. **로컬 게이트가 아직 살아있다는 서술은 이 단계에서 그대로 둔다** — 그 시점엔 참이다.
- **작업 내용**:
  - `CLAUDE.md` "CI (GitHub Actions)" 섹션: "e2e는 여기서 안 돈다" 문단을 e2e 4샤드·xvfb·`.env.ci`·nightly(main) 설명으로 교체. `build`+`check:prearm` 문단의 "유일한 행동 검증(`logs-prearm.spec.ts`)이 CI에 없다"를 수정(이제 CI에서 돈다 — 구조 검사는 빠른 1차 그물로 재정의). **`.last-green`·스킬 라인업은 건드리지 않는다**(Task 7b).
  - `docs/DIRECTORY.md`: 106행(`playwright.config.ts` 요약 — `retries: CI 1 / 로컬 0`, logview `dependencies` 제거 반영), 129행(`workflows/ci.yml` 요약 — e2e 매트릭스·집계 job 추가), 루트 파일 목록에 `.env.ci` 항목 추가.
  - `e2e/README.md` "실행" 섹션: CI 자동 실행 명시(트리거·샤드·xvfb), `--no-deps` 안내 삭제(의존 제거로 불필요), "창 깜빡임" 문단에 CI에선 off-screen 미적용 추가, `retries` 서술에 CI 분기 반영.
  - `CONTRIBUTING.md` 51~53행: "isn't in CI and you don't need to run it. I run it locally before merging" → **"CI에서 자동 실행된다"까지만**(영문). required check 문구는 Task 8 완료 후(7b)에 넣는다 — 그 전엔 아직 required가 아니다.
- **검증**:
  - [ ] `grep -rni "isn't in CI\|not in CI\|CI에서 안 돈다\|CI에 없다" CLAUDE.md CONTRIBUTING.md e2e/README.md docs/DIRECTORY.md` 0건
  - [ ] 이 시점에 `.last-green` 서술은 **의도적으로 남아 있다** — `grep -rn "last-green" CLAUDE.md docs/DIRECTORY.md`가 여전히 hit (7b에서 제거)
  - [ ] Codex에서는 `pnpm sync:agents` 직접 실행 후 `pnpm sync:agents:check` 통과 (CLAUDE.md 편집 → `AGENTS.md` 재생성 반영)
  - [ ] `README.md`/`README.ko.md`의 e2e 서술(198·205·210행 등) 대조 — 명령어만 나열하므로 수정 불필요할 가능성 높음

### Task 7b: 문서 갱신 — 로컬 게이트 제거 반영 (2차 커밋)

- **변경 대상**: `CLAUDE.md`, `docs/DIRECTORY.md`, `e2e/README.md`, `CONTRIBUTING.md`
- **진입 조건**: Task 5·6·8 완료(스킬에서 `.last-green` 제거 + required check 등록).
- **작업 내용**:
  - `CLAUDE.md`: "CI (GitHub Actions)" 섹션에 `e2e-gate` required check 추가, 로컬 게이트(`.last-green`) 언급 삭제. 스킬 라인업 표의 `/e2e-run`·`/push`·`/merge`·`/ship` 줄에서 `.last-green` 제거. "권장 흐름" 문단의 `/push`(e2e 게이트)·`/merge`(게이트 교차) 서술 갱신.
  - `docs/DIRECTORY.md` 102행: `e2e/` 항목의 `.last-green` 서술 제거.
  - `e2e/README.md`: 로컬 게이트 관련 서술 정리.
  - `CONTRIBUTING.md`: 7a에서 미룬 "PR에 required check로 걸린다" 문구 추가(영문).
- **검증**:
  - [ ] `rg -n "last-green" .gitignore .claude/commands CLAUDE.md AGENTS.md .agents/skills docs/DIRECTORY.md e2e/README.md`가 0건(feature 설계 문서의 역사 설명은 검사 대상 제외)
  - [ ] Codex에서는 `pnpm sync:agents` 직접 실행 후 `pnpm sync:agents:check` 통과

### Task 8: 브랜치 프로텍션에 `e2e-gate` required check 추가

- **변경 대상**: 저장소 설정 (코드 아님)
- **작업 내용**: **Task 9에서 `e2e-gate`가 최소 1회 성공적으로 보고된 뒤** 실행한다. 존재한 적 없는 check를 required로 걸면 이후 모든 PR이 영구 pending이 된다.
  현재 `verify`와 `strict` 값을 보존하도록 context 추가 전용 endpoint를 사용한다.
  ```
  gh api -X POST \
    repos/:owner/:repo/branches/main/protection/required_status_checks/contexts \
    -f 'contexts[]=e2e-gate'
  ```
- **검증**:
  - [ ] 실행 **전** 현재 값 백업: `gh api repos/:owner/:repo/branches/main/protection/required_status_checks > /tmp/rsc-before.json`
  - [ ] `gh api repos/:owner/:repo/branches/main/protection --jq '.required_status_checks.contexts'`가 `["verify","e2e-gate"]`
  - [ ] `.required_status_checks.strict`가 실행 전과 동일(`false`) — contexts 전용 endpoint가 보존해야 하는 값
  - [ ] 테스트 PR에서 두 check가 모두 required로 표시됨
  - [ ] POST endpoint가 실패하면 design.md "저장소 설정"의 PATCH 폴백(현재 `strict`·`app_id`를 명시적으로 함께 전달)을 쓴다

### Task 9: 첫 CI 런 검증 + 실패 대응

- **변경 대상**: 없음 (관측 + 필요 시 Task 3·4 수정)
- **작업 내용**: Task 1~4만 첫 커밋으로 묶어 dev에 push한다. 이 시점에는 로컬 `.last-green` 게이트와 관련 스킬·문서를 유지한다. 첫 런을 관측하고 `e2e-gate` green을 확인한 뒤에만 Task 5~8로 진행한다. 관측 항목과 대응:
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
  - [ ] 파일 단위 샤드별 duration을 기록하고 10분 목표를 위협하는 편차가 있는지 확인
  - [ ] flaky로 리포트된 spec 목록을 보고에 기록
  - [ ] hard timeout이면 후속 artifact가 없을 수 있음을 보고에 명시하고 Actions job 로그를 보존
  - [ ] nightly 실패가 메인테이너의 GitHub Actions 기본 알림 대상인지 저장소 알림 설정에서 확인

### Task 10: 게이트 차단 동작 확인 (음성 케이스)

- **변경 대상**: 없음 (임시 브랜치와 draft PR에서만)
- **작업 내용**: spec 하나를 일부러 깨는 커밋을 임시 브랜치에 push한 뒤 main 대상 draft PR을 열어 `pull_request` CI를 트리거한다. `e2e-gate`가 빨간불이 되는지와 프로텍션 차단을 확인한 뒤 PR을 닫고 브랜치를 삭제한다.
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
  - [ ] `E2E_SHOW=1 pnpm test:e2e --shard=1/4`로 창이 보임(디버그 경로 보존)
  - [ ] `pnpm test:e2e --project=logview`가 sidepanel 없이 단독 실행됨
  - [ ] `/push` 실행 시 e2e가 돌지 않고 CI URL이 보고됨
  - [ ] `/merge` 실행 시 dev HEAD CI 결론을 조회해 게이트로 씀 (실제 릴리스 때 확인)

## 구현 순서 권장

```
Task 1 (.env.ci)  ─┐
Task 2 (config)   ─┼─> Task 4 (워크플로) ─> Task 7a (CI 사실 문서) ─> [1차 커밋 + push] ─> Task 9 (첫 green)
Task 3 (fixture)  ─┘                                                                          │
                                        ┌─────────────────────────────────────────────────────┘
                                        ├─> Task 5 ─> Task 6 (로컬 게이트 제거) ─┐
                                        └─> Task 8 (프로텍션) ──────────────────┼─> Task 7b (문서) ─> [2차 커밋]
                                                                                 └─> Task 10 (음성 케이스)
```

- **Task 1·2·3은 병렬 가능** — 서로 독립이고 전부 Task 4의 전제다.
- **Task 4는 Task 1~3 이후.** 워크플로가 `.env.ci`와 CI 분기를 전제한다.
- **Task 7a는 1차 커밋에 반드시 포함.** 워크플로에 e2e가 들어간 순간 "CI에서 안 돈다"는 서술이 거짓이 되고, `/push` 문서 신선도 검사가 이를 잡는다. 이 단계에선 `.last-green` 서술을 **남겨둔다** — 로컬 게이트가 아직 살아있으니 참이다.
- **Task 5·6은 Task 9 green 뒤에만 시작한다.** 서로 다른 스킬 파일이지만, Task 6의 제한 경로 `last-green` 검색 0건 검증은 Task 5 완료 후에만 성립하므로 순차가 안전하다.
- **Task 8은 반드시 Task 9 green 이후.** 존재한 적 없거나 아직 동작하지 않는 check를 required로 걸면 이후 모든 PR이 영구 pending이 된다.
- **Task 7b는 Task 5·6·8 이후** — required check 등록과 스킬 전환이 끝난 사실을 서술해야 한다. Task 9에서 워크플로를 수정했으면 7a 서술도 여기서 함께 보정한다.
- 커밋 분리 필수:
  - 1차 `ci(e2e): run Playwright suite on GitHub Actions` (Task 1~4) + `docs: describe e2e in CI` (Task 7a) → push → Task 9 green 확인
  - 2차 `chore(skills): drop local e2e gate` (Task 5~6) + `docs: drop local e2e gate references` (Task 7b)

## 가이드 영향

없음. 내부 개발 워크플로 변경으로, 확장 사용자에게 노출되는 UX·기능이 아니다.
