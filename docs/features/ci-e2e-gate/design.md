# e2e 게이트 CI 이관 — 기술 설계

## 개요

e2e 실행 위치를 로컬에서 GitHub Actions로 옮긴다. headed 강제라는 유일한 CI 차단 사유는 `xvfb-run`으로 해소하고(가상 디스플레이에서 실제 창을 띄운다), 직렬 실행 시간은 Playwright `--shard`로 4개 러너에 분산한다. 샤드는 각각 독립 job이므로 `workers: 1` 제약을 건드리지 않는다 — 프로세스 내 병렬이 아니라 프로세스 자체를 4개로 늘리는 방식이다. 샤드 결과는 `e2e-gate` 집계 job 하나로 수렴시켜 브랜치 프로텍션의 required check 이름을 샤드 개수와 분리한다. 전환은 두 단계다. 먼저 CI 워크플로를 push해 `e2e-gate` green을 1회 실증한다. 그 다음 `e2e/.last-green`을 읽고 쓰던 4개 스킬(`/e2e-run`·`/push`·`/merge`·`/ship`)에서 로컬 게이트를 걷어내고, `/merge`만 원격 CI 결론 조회로 대체한다.

## 변경 범위

### `.github/workflows/ci.yml` (수정)

**현재**: `verify` job 단일 — checkout → pnpm/node → install → typecheck → sync:agents:check → test → build → check:prearm. 트리거는 dev push · main PR.

**변경**:
- 워크플로 최상단에 `permissions: contents: read`를 명시해 fork PR의 임의 코드를 실행하는 `GITHUB_TOKEN` 권한을 읽기 전용으로 고정한다.
- 트리거에 `schedule`(`0 18 * * *` = 03:00 KST)과 `workflow_dispatch` 추가. `schedule`은 GitHub 사양상 기본 브랜치(main)에서만 발화하므로 nightly 대상은 자동으로 main이다.
- `e2e` job 신설 — `strategy.matrix.shard: [1,2,3,4]`, `fail-fast: false`, `timeout-minutes: 30`.
- `e2e-gate` job 신설 — `needs: [e2e]`, `if: always()`. `needs.e2e.result != 'success'`면 exit 1.
- `verify`는 그대로 두고 `e2e`와 **병렬** 실행한다(`needs` 없음). public 러너가 무료이므로 typecheck 실패를 기다리느라 e2e 시작을 늦출 이유가 없다.
- `concurrency` 그룹은 현행 유지 — 샤드 job들도 같은 워크플로 런에 속하므로 함께 취소된다.

`e2e` job 스텝 순서:

```
checkout → pnpm/action-setup → setup-node(cache: pnpm) → pnpm install --frozen-lockfile
→ cp .env.ci .env.local
→ pnpm exec playwright install --with-deps chromium
→ pnpm build:e2e
→ xvfb-run -a --server-args="-screen 0 1920x1080x24" pnpm test:e2e --shard=${{ matrix.shard }}/4
→ (if: failure()) actions/upload-artifact — playwright-report/ + test-results/
```

빌드는 샤드마다 반복한다(각 ~40초). 별도 build job + artifact 전달로 묶을 수도 있지만, install이 어차피 샤드마다 필요하고 artifact 왕복(업로드+4× 다운로드)이 절약분과 비슷해 직렬 job 하나만 더 늘어난다. 단순한 쪽을 택한다.

`--server-args="-screen 0 1920x1080x24"`가 필요한 이유: `xvfb-run` 기본 스크린이 배포판에 따라 8비트 깊이(`1280x1024x8`)다. `capture-methods`·`capture` spec은 스티칭 결과에서 **자홍 픽셀 색상을 직접 판정**하므로(`fixtures/pages/scroll-capture.html`의 `#sticky`) 컬러 깊이가 24비트여야 한다. 해상도는 사이드패널 480×720과 logview 1280×800을 모두 담아야 한다.

### `.env.ci` (신규, 커밋)

`.env.example`과 같은 키 집합에 **더미 OAuth client ID + proxy URL**을 채운 파일. `isConfigured()`는 `!!clientId && (!needsProxy || !!proxyUrl)`(`src/background/oauth/config.ts:131`)이라 비어 있지 않은 임의 문자열이면 OAuth UI가 로컬과 동일하게 노출된다. PostHog 키는 **비워 둔다** — CI 실행이 익명 집계를 오염시키면 안 된다(빈 값이면 no-op).

OAuth client ID는 공개 값이라 secret이 아니지만, 실제 값을 커밋할 이유도 없다. 더미로 충분하다 — e2e 스펙 어디에도 실제 OAuth 왕복이 없고(계정은 전부 `chrome.storage`에 직접 주입한다), 필요한 건 "설정됨" 판정뿐이다.

로드 방식: Vite는 `loadEnv(mode, cwd, "")`(`vite.config.ts:8`)로 `.env` / `.env.local` / `.env.[mode]` 계열만 읽는다. `.env.ci`는 어떤 mode에도 대응하지 않아 자동 로드되지 않으므로, 워크플로에서 `cp .env.ci .env.local`로 복사한다. `--mode ci`를 쓰면 `import.meta.env.MODE`가 바뀌어 crxjs·번들 분기에 부작용 위험이 생기므로 쓰지 않는다.

### `.gitignore` (수정)

- `.env.*` 무시 규칙에 대한 예외로 `!.env.ci` 추가 (`!.env.example` 바로 아래).
- `e2e/.last-green` 줄 삭제.

### `e2e/playwright.config.ts` (수정)

```ts
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  workers: 1,
  // 로컬은 flaky를 숨기지 않는다. CI는 확장 SW 기동·xvfb 환경 flaky를 흡수한다.
  retries: isCI ? 1 : 0,
  // .only가 남으면 샤드가 조용히 green이 되어 게이트가 무의미해진다.
  forbidOnly: isCI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "sidepanel", testIgnore: ["**/logview/**"] },
    {
      name: "logview",
      testMatch: "**/logview/**/*.spec.ts",
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],
});
```

`logview`의 `dependencies: ["sidepanel"]` **제거**가 이 파일의 핵심 변경이다. 이유:

- Playwright는 `--shard`를 쓸 때 의존 project를 각 샤드에서 실행한다. logview spec 4개를 위해 sidepanel spec 59개가 샤드마다 반복되면 샤딩 효과가 사라진다.
- 이 의존은 **실제 데이터 의존이 아니다.** logview는 확장을 로드하지 않고 `dist-log-viewer/index.html`을 합성 JSON으로 직접 여는 standalone이며(`e2e/logview/fixtures.ts`), 필요한 산출물은 `build:e2e`가 이미 만든다. 의존은 "사이드패널이 green인 뒤에 보자"는 실행 순서 표현일 뿐이고, 샤딩 환경에선 순서 자체가 의미를 잃는다.

제거의 대가: 로컬에서 `pnpm test:e2e --project=logview`가 더 이상 sidepanel을 선행 실행하지 않는다. `--no-deps` 플래그가 불필요해지므로 `e2e/README.md`의 해당 안내를 함께 고친다.

### `e2e/fixtures/extension.ts` (수정)

`launchPersistentContext` args에서 off-screen 이동을 CI에서 생략한다.

```ts
// 현재
...(process.env.E2E_SHOW === "1" ? [] : ["--window-position=-10000,-10000"]),

// 변경
...(process.env.E2E_SHOW === "1" || process.env.CI
  ? []
  : ["--window-position=-10000,-10000"]),
```

이 인자의 목적은 **개발자 화면에서 창 깜빡임·포커스 탈취를 없애는 것**이다(파일 주석에 명시). CI의 xvfb 가상 디스플레이엔 볼 사람이 없고, 반대로 창을 가상 스크린(1920×1080) 밖으로 밀면 컴포지터가 렌더를 클립·중단할 위험이 있다. `headless: false`는 그대로 유지한다.

### `.claude/commands/e2e-run.md` (수정)

frontmatter `description`에서 `.last-green` 문구 제거, 본문에서 green 시 `git rev-parse HEAD > e2e/.last-green` 기록 단계 삭제. 스킬의 정체성이 "게이트 캐시를 굽는 도구"에서 **"로컬 수동 전수 실행 + 리포트"** 로 바뀐다 — CI가 못 도는 상황이나 push 전 미리 확인하고 싶을 때 쓴다.

### `.claude/commands/push.md` (수정)

5단계 "e2e 게이트" 전체 삭제. 6단계 "푸시 실행"이 5단계로 당겨지고, push 성공 보고에 CI 안내 한 줄을 추가한다:

```
gh run list --branch <branch> --workflow ci.yml --limit 10 \
  --json headSha,url,status
```

push 직전 HEAD를 저장하고, 조회 결과 중 `headSha`가 그 SHA와 일치할 때만 해당 run URL을 보고한다. 푸시 직후 아직 런이 등록되지 않았거나 최신 결과가 이전 SHA뿐이면 `https://github.com/<owner>/<repo>/actions` 링크로 폴백하고 **대기하지 않는다**. `/push`는 논블로킹을 유지한다.

### `.claude/commands/merge.md` (수정)

4단계 e2e 게이트를 **로컬 해시 대조 → 원격 CI 결론 조회**로 교체한다.

```
git rev-parse HEAD                                          # dev HEAD
gh run list --branch dev --workflow ci.yml --limit 20 \
  --json databaseId,headSha,status,conclusion,url            # HEAD와 headSha 일치 런 탐색
```

판정:
| 상태 | 처리 |
|---|---|
| `conclusion: success` | 통과 — 다음 단계 |
| `status: in_progress`/`queued` | `gh run watch <databaseId> --exit-status`로 대기 후 결론 재조회 |
| 완료됐지만 `conclusion != success` | **중단** (PR 생성 안 함) |
| 일치 런 없음 | **중단** — "dev HEAD가 push되지 않았거나 CI가 트리거되지 않음" 보고 |
| API 오류·알 수 없는 상태 | **중단** — 원인과 run 또는 Actions URL 보고 |

`.last-green`이 없어져도 게이트 의미는 보존된다: "머지될 코드 상태가 e2e green이었나"를 로컬 캐시가 아니라 원격 사실로 확인한다.

10단계 머지 실행도 바뀐다. `verify` + `e2e-gate`가 required check이므로 PR 생성 직후 `gh pr merge --squash`는 미충족으로 거부된다. bump 커밋 push → PR 생성 → **`gh pr checks <number> --watch --fail-fast`로 PR CI green 대기** → `gh pr merge <number> --squash` 순으로 바꾼다.

### `.claude/commands/ship.md` (수정)

- **12단계 `/e2e-run` 삭제.** 13·14단계(`/push`·`/build`)를 12·13단계로, 15단계(최종 리포트)를 14단계로 당긴다.
- 43행 "Codex 런타임 종착점" 문단: 종착점이 12단계(`/e2e-run`)에서 **11단계(마지막 커밋)** 로 바뀌고, `.last-green` 기록으로 후속 `/push`가 스킵된다는 서술을 삭제한다. 인계 문구("push 대기 — Claude Code에서 `/push` 실행")는 유지.
- 13단계(구 `/push`) 설명에서 "e2e 게이트(`.last-green`==HEAD면 스킵)" 삭제.

### 문서 (수정)

문서 갱신은 **전환 2단계에 맞춰 쪼갠다.** 1차(CI 워크플로와 같은 커밋)는 "e2e가 CI에서 돈다"는 사실만 반영하고 `.last-green` 서술은 남긴다 — 그 시점에 로컬 게이트는 아직 살아있으니 참이다. 2차(로컬 게이트 제거와 같은 커밋)에서 `.last-green`을 걷어낸다. 1차를 미루면 워크플로에 e2e가 들어간 채 "CI에서 안 돈다"고 적힌 문서가 함께 push되고, `/push` 문서 신선도 검사가 거기서 멈춘다.

| 파일 | 1차 (CI 실행 사실) | 2차 (로컬 게이트 제거) |
|---|---|---|
| `CLAUDE.md` | "CI (GitHub Actions)" 섹션의 "e2e는 여기서 안 돈다" 문단 → 4샤드·xvfb·`.env.ci`·nightly 설명. `build`+`check:prearm` 문단의 "행동 검증이 CI에 없다" 수정 | `e2e-gate` required check 추가, `.last-green` 언급 삭제. 스킬 라인업 4줄 + "권장 흐름" 갱신 |
| `docs/DIRECTORY.md` | 106행(playwright.config 요약 — retries·projects), 129행(`workflows/ci.yml` 요약), 루트 `.env.ci` 항목 | 102행(`e2e/` — `.last-green` 서술 제거) |
| `e2e/README.md` | "실행" 섹션 — CI 실행 명시, `--no-deps` 안내 삭제, 창 깜빡임 문단 CI 분기, retries 분기 | 로컬 게이트 서술 정리 |
| `CONTRIBUTING.md` | 51~53행 "isn't in CI and you don't need to run it" → CI에서 자동 실행됨 | "PR에 required check로 걸린다" 추가 |
| `.env.example` | 최상단 주석에 `.env.ci`(CI 전용 더미)의 존재와 목적 한 줄 | — |

`AGENTS.md`·`.agents/skills/`는 Claude Code에서는 `.claude/settings.json` PostToolUse 훅이 자동 재생성한다. Codex에는 이 훅이 없으므로 원본 수정 뒤 `pnpm sync:agents`를 직접 실행해 미러를 함께 커밋한다(`/push`·`/merge`는 sync 스크립트 `EXCLUDE`라 미러 대상이 아니고, `/e2e-run`·`/ship`은 대상).

### 저장소 설정 (코드 아님)

브랜치 프로텍션의 required status checks에 `e2e-gate`만 추가한다. 현재 `verify`와 `strict` 값을 보존하기 위해 required-status-check 전체를 PATCH하지 않고 context 추가 전용 endpoint를 사용한다.

```
gh api -X POST \
  repos/:owner/:repo/branches/main/protection/required_status_checks/contexts \
  -f 'contexts[]=e2e-gate'
```

한 가지 손실을 감수한다: 현재 `verify`는 `checks: [{app_id: 15368, context: "verify"}]`로 **app_id 바인딩**돼 있는데(GitHub Actions만 이 체크를 보고할 수 있다), contexts 전용 endpoint로 추가한 `e2e-gate`는 바인딩 없이 들어가 어떤 앱이든 보고할 수 있다. 단일 메인테이너 저장소에서 실질 위험은 없다. 바인딩까지 맞추려면 PATCH로 `checks` 배열 전체를 다시 써야 하고, 그러면 Codex가 지적한 `strict` 보존 문제가 되살아난다 — 그때는 아래처럼 현재 값을 명시적으로 함께 넘긴다.

```
gh api -X PATCH repos/:owner/:repo/branches/main/protection/required_status_checks \
  -F strict=false \
  -f 'checks[][context]=verify'   -F 'checks[][app_id]=15368' \
  -f 'checks[][context]=e2e-gate' -F 'checks[][app_id]=15368'
```

## 데이터 흐름

### 현재 (로컬 게이트)

```
/e2e-run ──green & clean tree──> e2e/.last-green (HEAD 해시, gitignore)
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
              /push 5단계                              /merge 4단계
        (해시==HEAD면 스킵, 아니면 실행)          (해시==HEAD면 스킵, 아니면 실행)
```

### 변경 후 (CI 게이트)

```
git push ──> GitHub Actions (dev push / main PR / nightly / dispatch)
              │
              ├── verify   (typecheck·sync·test·build·prearm)  ─┐
              └── e2e      (shard 1..4, 병렬)                    │
                    │                                            │
                    └──> e2e-gate (집계, if: always())  ─────────┤
                                                                 ▼
                                                    branch protection required checks
                                                          (verify + e2e-gate)
                                                                 │
     /merge 4단계 ──gh run list(dev HEAD)──> conclusion 조회 ─────┘
     /merge 10단계 ─gh pr checks --watch─> green ─> gh pr merge --squash
```

샤드 간에는 상태를 공유하지 않는다. `fullyParallel`을 켜지 않은 현재 설정에서 Playwright는 spec 파일 단위로 샤딩하고, 각 샤드는 자체 worker process를 띄운다. `ext`는 worker-scope fixture라 샤드마다 자체 persistent context·fixture 서버(ephemeral 포트)·임시 프로필을 만든다.

## 인터페이스 설계

새 타입·함수·메시지는 없다. 인터페이스라 부를 만한 계약은 셋이다.

**1. CI 환경 판별** — Playwright config와 fixture가 `process.env.CI`로 갈린다. GitHub Actions가 `CI=true`를 자동 주입한다.

```ts
// e2e/playwright.config.ts
const isCI = !!process.env.CI;   // retries / forbidOnly / reporter

// e2e/fixtures/extension.ts
process.env.E2E_SHOW === "1" || process.env.CI   // off-screen 창 위치 생략
```

**2. 샤드 계약** — 워크플로 matrix의 샤드 개수와 CLI 인자가 한 곳에서만 맞으면 된다.

```yaml
strategy:
  matrix:
    shard: [1, 2, 3, 4]
run: ... pnpm test:e2e --shard=${{ matrix.shard }}/4
```

`e2e-gate`가 집계하므로 required check 이름은 샤드 개수와 무관하다 — 개수를 바꿔도 브랜치 프로텍션을 다시 건드리지 않는다.

**3. `.env.ci` 키 집합** — `.env.example`과 동일한 키. 값 규칙:

```
VITE_*_CLIENT_ID   = 비어 있지 않은 더미 문자열   # isConfigured() 통과용
VITE_OAUTH_PROXY_URL = 비어 있지 않은 더미 URL     # needsProxy 플랫폼용
VITE_POSTHOG_KEY*  = 빈 값                        # 집계 no-op 유지
```

## 기존 패턴 준수

- **빌드는 자동 실행하지 않는다** (CLAUDE.md) — 예외로 `build:e2e`는 e2e 게이트에서 허용된다. CI 워크플로가 `build:e2e`를 돌리는 것은 이 예외 범위 안이고, 배포 산출물 `dist`와 분리된 `dist-e2e`만 만든다.
- **`dist-e2e`는 테스트 전용** — CI에서도 아티팩트로 배포하지 않는다. 실패 시 올리는 것은 리포트와 trace뿐이다.
- **Codex 미러 동기화** — Claude Code는 `.claude/commands/*.md`와 `CLAUDE.md` 편집 시 PostToolUse 훅이 `pnpm sync:agents`를 자동 실행한다. Codex는 훅이 없으므로 원본 변경 직후 직접 `pnpm sync:agents`를 실행하고, `/push`의 `sync:agents:check`를 최종 게이트로 둔다.
- **문서 신선도** — 이번 변경은 `package.json` scripts를 바꾸지 않지만 워크플로·게이트 구조를 바꾸므로 CLAUDE.md·DIRECTORY.md 갱신이 필수 트리거에 해당한다. `manifest.config.ts`·권한·캡처 동작은 건드리지 않으므로 `docs/privacy.*`·`docs/PERMISSION.md`는 대상이 아니다.
- **가이드 영향 없음** — 사용자 노출 UX가 아니다.
- **외과적 변경** — `e2e/*.spec.ts` 63개 파일은 한 줄도 손대지 않는다.

## 대안 검토

**1. `/merge`에서 `gh pr merge --squash --auto` (auto-merge 위임) — 기각.**
required check green 시 GitHub이 자동 squash하므로 `/merge`가 대기하지 않아도 된다. 기각 이유 둘: (a) 저장소의 `allow_auto_merge`가 현재 `false`라 설정 변경이 선행돼야 한다. (b) 더 중요하게, `/merge` 11단계는 머지 직후 `/sync`(dev를 origin/main으로 hard reset + force push)를 이어서 실행한다. auto-merge면 `/merge` 종료 시점에 머지가 아직 안 일어나 `/sync`를 붙일 수 없고, 사용자가 나중에 수동으로 `/sync`를 불러야 한다. dev→main 전이를 한 호출로 끝내는 스킬의 성격이 깨진다. `/push`(자주·논블로킹)와 `/merge`(드물게·종착 액션)의 대기 정책을 다르게 가져가는 편이 일관적이다.

**2. 로컬 `.last-green` 유지 + CI 추가 (2중 그물) — 기각.**
push 전에 미리 잡을 수 있다는 이점은 있으나, 같은 green을 두 창구가 관리하면 `.last-green`이 이미 겪던 문제(머신 로컬 진실, 외부 PR 미적용, 어느 쪽이 권위인지 모호)가 그대로 남는다. 게이트 창구는 하나여야 한다.

**3. 샤딩 없이 단일 러너 — 기각.**
로컬 4~5분 기준으로 러너 단일코어 성능차(1.5~2.5배)를 감안하면 8~13분. 매 push마다 그만큼 지연되고 `/merge`는 두 배로 겪는다. 4샤드는 워크플로 몇 줄과 logview `dependencies` 제거만으로 얻어진다.

**4. build job + artifact 전달로 샤드 빌드 중복 제거 — 기각.**
샤드마다 `pnpm install`이 어차피 필요해 절약분은 `build:e2e` ~40초뿐인데, 직렬 job 하나(~2분)와 artifact 왕복이 추가된다. 순이득이 음수다.

**5. `.env.ci` 대신 워크플로 `env:` 블록에 더미 값 인라인 — 기각.**
`loadEnv(mode, cwd, "")`는 prefix가 빈 문자열이라 `process.env`도 흡수하므로 동작은 한다. 다만 값이 YAML에만 존재해 로컬에서 "CI와 같은 조건"을 재현할 수 없고(파일이면 `cp .env.ci .env.local` 한 줄), 키가 늘 때 `.env.example`과의 대칭을 눈으로 확인할 수 없다.

**6. GitHub Secrets에 실제 OAuth 값 주입 — 기각.**
fork PR에는 secret이 전달되지 않아 외부 기여 PR에서 다시 갈라진다. "secret 없이 빌드된다"가 이번 작업의 목표 중 하나다.

**7. nightly를 dev 대상으로 (명시 checkout) — 기각.**
dev는 push마다 이미 e2e가 돈다. nightly의 고유 가치는 "코드가 안 변했는데 환경이 변해서 깨지는 것"을 잡는 데 있고, 그 관측 대상으로는 배포된 상태인 main이 맞다.

**8. nightly 실패 이슈 자동 생성 — 기각.**
현재 단일 메인테이너가 GitHub Actions 기본 실패 알림을 직접 확인한다. 별도 issue 생성 job은 중복 알림과 자동 생성 이슈 정리 비용을 만들므로 추가하지 않고, 대응 SLA도 두지 않는다.

## 위험 요소

**1. xvfb headed에서 확장 서비스워커가 안 깨어날 가능성 — 최대 위험.**
"headless에서 SW가 안 깨어난다"는 것은 알려진 사실이고 xvfb는 headless가 아니지만(실제 창 + 가상 디스플레이), 리눅스 환경에서 실증한 적이 없다. 실패하면 `getSw()`의 `waitForEvent("serviceworker")`가 타임아웃하며 **모든 spec이 fixture 단계에서 죽는다** — 증상이 명확해 오진할 여지는 적다. 1차 대응: `--no-sandbox` 추가(dist-e2e는 테스트 전용이라 수용 가능). 2차: `--disable-dev-shm-usage`. 3차: xvfb 대신 `xvfb-run` 없이 러너의 기본 디스플레이 사용 시도. 첫 `e2e-gate` green 전에는 로컬 게이트를 유지해 전환 실패가 검증 공백으로 이어지지 않게 한다.

**2. `.env.ci` 누락 항목으로 인한 spec 실패.**
grep상 OAuth 연결 버튼을 단언하는 spec은 없고 연동 계정은 전부 `chrome.storage` 직접 주입이지만, 전 스위트를 `.env.local` 없이 돌려 검증한 적은 없다. `.env.ci`가 `.env.example`과 같은 키를 더미로 채우므로 로컬(`.env.local`에 실값)과의 차이는 "값이 실제냐 더미냐"뿐이고, 실제 OAuth 왕복을 하는 spec은 없다. 잔여 위험 낮음.

**3. Playwright 샤딩과 project `dependencies`의 상호작용.**
`dependencies` 제거가 이 위험의 대응책이지만, 제거 자체가 로컬 `--project=logview` 단독 실행 흐름을 바꾼다. `e2e/README.md`의 `--no-deps` 안내를 함께 고치지 않으면 문서가 즉시 stale이 된다.

**4. flaky의 성격 변화.**
`retries: 1`은 환경 flaky에 한 번의 복구 기회를 주지만 **진짜 회귀도 2번 중 1번만 통과하면 green으로 통과시킨다**. Playwright는 재시도로 살아난 테스트를 "flaky"로 리포트하므로, CI 요약에 flaky가 반복적으로 잡히는 spec은 별도로 추적한다(이번 스코프 밖).

**5. 빨간 커밋이 dev에 올라간다.**
`/push`·`/ship`이 로컬 e2e를 안 돌리므로 e2e를 깨는 커밋이 원격 dev에 일단 올라간다. dev는 force push가 허용된 작업 브랜치이고 main은 required check로 막히므로 실害는 제한적이지만, 이전과 달라지는 지점이라 인지가 필요하다.

**6. `/merge` 소요 시간 증가.**
dev HEAD CI 확인(대개 이미 끝나 있음) + bump 커밋 push 후 PR CI 대기(4~6분)가 추가된다. bump 커밋은 메타데이터만 바꾸지만 CI는 그 사실을 모르므로 전 스위트를 다시 돈다. 릴리스 빈도를 생각하면 수용 가능하나, 잦아지면 "docs/메타데이터 전용 커밋은 e2e 스킵" 같은 경로 필터를 별도로 검토한다(이번 스코프 밖 — 조기 최적화).

**7. 러너 시간 소비.**
dev push마다 4러너 × 5~7분 ≈ 25러너분. public 저장소라 무료지만, `concurrency` 취소 설정이 없으면 연속 push 시 누적된다. 기존 설정이 이미 이를 막고 있다.

**8. hard timeout 시 artifact 부재.**
일반 테스트 실패는 후속 `upload-artifact` 스텝이 report와 trace를 올리지만, job이 `timeout-minutes`에 걸려 강제 종료되면 후속 스텝 자체가 실행되지 않을 수 있다. 이 경우 Actions job 로그와 timeout 결론만 남는 한계를 수용한다.
