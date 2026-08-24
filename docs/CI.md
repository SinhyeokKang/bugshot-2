# CI (GitHub Actions)

`.github/workflows/ci.yml` — **dev push · main PR · nightly(08:00 KST) · 수동(`workflow_dispatch`)** 에서 돈다. `schedule`은 GitHub 사양상 기본 브랜치에서만 발화하므로 nightly 대상은 main이다(코드가 그대로여도 Chrome 버전·러너 이미지 변경으로 깨지는 걸 잡는 게 목적).

## job 4개

- **`verify`** — typecheck → sync:agents:check → test → build → check:prearm. 브라우저·시크릿 없이 결정적. job 상한 15분.
- **`e2e`** — Playwright 전 스위트(77 spec / 303 테스트)를 `--shard=N/4` 매트릭스로 4개 러너에 분산. **샤딩이 유일한 병렬 수단인 이유는 `workers: 1`이기 때문**이다 — 확장 + persistent context는 프로필 단위 상태라 한 러너 안에서 병렬이 안 된다. project는 둘이다: `sidepanel`(확장 구동 메인 스위트, `**/logview/**` 제외)과 `logview`(확장을 안 띄우고 `dist-log-viewer/index.html`을 직접 여는 standalone, viewport 1280×800). `logview`에 **`dependencies`를 일부러 안 둔다** — 실제 의존이 없고, 의존 project는 샤드마다 전량 실행돼 샤딩 효과를 지운다. (303은 grep으로 안 나온다: 정적 `test(` 선언은 **293**이고 `e2e/logview/log-viewer.spec.ts`의 `labelSuite()`가 테스트 5개를 담은 채 ko·en·fr 3회 호출돼 +10이다.) 각 샤드는 `pnpm build:e2e`로 `dist-e2e`를 자기 러너에 새로 만든다(`verify`가 만드는 `dist`와 별개 산출물이고 job 사이에 전달되지 않는다). Chromium은 `actions/cache@v4`(키 `playwright-<os>-<pw 버전>`)로 캐시하고 **미스일 때만** `playwright install --with-deps chromium`을 `timeout-minutes: 6`으로 돌린다(apt가 가끔 10분으로 튀는 편차를 자른다). 확장 SW가 headless에서 안 깨어나 `headless: false`가 강제라(`e2e/fixtures/extension.ts`) `xvfb-run`으로 돌린다 — **가상 스크린 깊이 24는 필수**(기본 8비트인 배포판이 있고 캡처 spec이 픽셀 색을 직접 판정한다). `fail-fast: false`라 한 샤드가 깨져도 나머지를 완주하고, 실패 샤드는 report·trace를 artifact로 올린다. launch args의 `--host-resolver-rules=MAP *.bugshot.test 127.0.0.1`도 전제다 — 서브도메인이 갈리는 **동족 origin**을 만드는 유일한 수단이라(127.0.0.1↔localhost는 registrable domain이 서로 다르다) 이게 없으면 `api-hosts-env-row` spec이 통째로 무의미해진다. job 상한은 30분인데 **여기서 잘리면 hard kill이라 뒤따르는 artifact 업로드 스텝이 안 돈다** — 타임아웃 실패는 report·trace 없이 온다.
- **`e2e-gate`** — 4샤드 결과를 단일 이름으로 수렴시키는 집계 job. main의 **required status check는 `verify` + `e2e-gate` 둘**이고, 샤드 개수를 바꿔도 이 이름은 안 변하므로 프로텍션 설정을 다시 건드릴 필요가 없다. 상한 5분.
- **`notify`** — nightly 배치 결과를 Slack Incoming Webhook으로 보낸다(`needs`는 집계 job `e2e-gate`가 아니라 원본 **`[verify, e2e]`** 다 — 게이트와 알림이 매다는 대상이 다르다)(`SLACK_WEBHOOK_URL` secret, 없으면 warning 남기고 skip). **`schedule`·`workflow_dispatch`에서만** 돌아 dev push·PR 결과로 채널을 어지럽히지 않고, fork PR은 이 조건에 걸릴 수 없어 secret 노출 경로가 없다. 성공/실패를 **항상** 보내는 게 요점 — 실패만 보내면 GitHub가 60일 무활동으로 `schedule`을 끈 상태와 green을 구분할 수 없다(매일 1건이 부재 감지를 겸한다). 그래서 nightly는 **concurrency group을 분리**한다 — 같은 그룹이면 `workflow_dispatch`가 진행 중 nightly를 취소하고, 취소된 런은 `notify`가 발화하지 않아 그날 신호가 빈다(`cancel-in-progress`를 event로 분기하는 건 해법이 아니다 — 그 값은 취소하는 쪽 런의 설정을 읽는다). 커밋 메시지는 payload에 넣지 않는다(임의 문자열이 JSON을 깬다) — sha·ref·run URL만이고, **ref도 그냥 싣지 않는다**: git이 ref 이름에 `"`를 허용해 payload JSON이 깨지므로 `Compose result`에서 벗겨 output으로 내린다. webhook secret을 쥔 스텝은 액션을 full SHA로 핀한다. 상한 5분.

fork PR 축의 나머지 반쪽은 워크플로 레벨 `permissions: contents: read`다 — fork PR의 임의 코드가 이 워크플로에서 도는 이상 `GITHUB_TOKEN`을 읽기 전용으로 고정해 둔다.

## e2e 차단 게이트는 CI 단독

로컬 `e2e/.last-green` 캐시 게이트는 폐기했다 — gitignore라 머신 로컬이었고, 그래서 외부 PR에 적용되지 않았으며 같은 green을 두 창구가 관리했다. `/push`는 e2e를 돌리지 않고 run URL만 안내한다(논블로킹). `/merge`는 dev HEAD의 CI 결론을 `gh run list`로 조회해 게이트로 쓰고, PR 머지 직전엔 `gh pr checks --watch`로 required check를 기다린다. `/e2e-run`은 게이트에서 빠져 **CI를 안 기다리고 미리 볼 때 쓰는 로컬 도구**로 남는다.

## 병렬 실행 · secret 비의존

`e2e` job은 `verify`와 **병렬**로 돈다(`needs` 없음) — public 저장소라 러너가 무료다. CI 빌드는 **secret에 의존하지 않는다**: 커밋된 더미 `.env.ci`를 `.env.local`로 복사해 쓴다(`verify`·`e2e` **양쪽 job**에서 복사한다 — e2e 전용이 아니다)(OAuth client ID가 비면 `isConfigured()`가 false가 되어 연동 탭 UI가 로컬과 갈리므로, 그 판정만 통과시키는 가짜 값이다. PostHog 키는 비워 집계 no-op 유지). 덕분에 secret이 전달되지 않는 **fork PR에도 e2e가 그대로 적용된다.**

CI에서의 `retries`는 1, 로컬은 0이다(`process.env.CI` 분기). `forbidOnly`도 CI 한정 — `.only`가 남으면 샤드가 조용히 green이 되어 게이트가 무의미해진다. 세 번째 CI 분기는 reporter로, CI에서만 `github`를 더해 실패를 PR diff에 인라인 annotation으로 붙인다(PR에 주석이 달리는 출처가 여기다).

## 이 저장소의 다른 워크플로

`.github/workflows/trigger-web-deploy.yml` — main push 중 `docs/privacy.{ko,en}.md`·`guide/**`가 걸리면 `WEB_DEPLOY_HOOK`으로 POST해 bugshot-web 배포를 깨운다. **게이트가 아니라 후속 훅**이라 PR 머지를 막지 않고, required status check에도 안 들어간다.

## `build` + `check:prearm`이 `verify`에 있는 이유

`recorders-entry`가 async loader로 강등되는 회귀는 typecheck도 유닛도 못 잡는다. 행동 검증(`e2e/logs-prearm.spec.ts`)은 이제 `e2e` job이 맡지만, `scripts/check-prearm-chunk.mjs`(워크플로에선 `pnpm check:prearm`이 아니라 `node scripts/check-prearm-chunk.mjs dist` 직접 호출이라, 스크립트명으로 grep하면 안 잡힌다)는 manifest의 `world`/`run_at`·loader 여부·IIFE 시작·잔여 static import를 몇 초 만에 대조하는 **1차 그물**이라 e2e green을 기다리지 않고 형태 회귀를 먼저 알린다.
