# e2e 게이트 CI 이관

## 배경

e2e 스위트(63 spec / 236 테스트)는 지금 **로컬에서만** 돈다. 확장 서비스워커가 headless Chrome에서 안 깨어나 `headless: false`가 강제되고(`e2e/fixtures/extension.ts`), `workers: 1`·`retries: 0`이라 직렬 실행 중 환경 flaky 하나가 곧바로 빨간 배지가 된다는 판단으로 CI에서 의도적으로 뺀 상태다. 대신 `e2e/.last-green`(green 커밋 해시를 담은 gitignore 파일)이 로컬 게이트 역할을 하고 `/e2e-run`이 쓰고 `/push`·`/merge`·`/ship`이 읽는다.

이 구조의 비용은 세 가지다.

1. **머신 점유.** 4~5분간 개발 머신이 headed Chrome 창에 잡힌다. `/push`마다 발생한다.
2. **머신 로컬 신뢰.** `.last-green`은 gitignore라 이 머신 밖에선 존재하지 않는다. 외부 기여 PR에는 e2e가 **전혀 적용되지 않고**, Codex 세션은 CI 결과를 볼 수 없다. CLAUDE.md도 이 한계를 명시하고 "외부 기여를 받기 시작하면 nightly·수동 트리거 e2e 잡을 추가한다"고 남겨뒀다.
3. **검증 창구 분산.** 같은 green을 로컬 캐시 해시와 CI 두 곳에서 관리하면 어느 쪽이 진실인지 흐려진다.

이 저장소는 public이라 GitHub Actions 러너가 무료다. headed 제약은 `xvfb`로 해소되고, 직렬 실행 시간은 샤딩으로 나눌 수 있다. CI에서 돌릴 수 없다는 전제 자체가 더 이상 유효하지 않다.

## 목표

- e2e 전체 스위트가 **dev push · main PR · nightly**에서 GitHub Actions로 실행된다.
- e2e 결과가 **브랜치 프로텍션 required status check**로 main 진입을 차단한다.
- `e2e/.last-green` 로컬 게이트가 저장소에서 완전히 제거된다 — `/push`·`/merge`·`/ship` 어디에도 로컬 e2e 실행이 남지 않는다.
- CI wall-clock이 **10분 이내**다(4샤드 매트릭스 기준 목표 4~6분).
- 외부 기여자의 fork PR에도 e2e가 동일하게 적용된다 — CI 빌드가 secret에 의존하지 않는다.
- `/push`가 e2e 때문에 세션을 잡지 않는다(논블로킹).

## 비목표 (Non-goals)

- **spec 자체의 추가·수정·삭제.** 커버리지는 지금 그대로 옮긴다.
- **headless 전환.** 확장 SW 미기동 제약은 그대로 두고 xvfb로 우회한다.
- **`workers: 1` 완화.** 확장 + persistent context는 프로필 단위 상태라 프로세스 내 병렬이 불가하다. 병렬성은 샤드(=별도 러너 프로세스)로만 얻는다.
- **flaky spec 색출·수리.** CI retries로 흡수하고, 반복 실패가 보이면 별도 작업으로 다룬다.
- **`/deploy`·`/sync` 변경.**
- **로컬 `/e2e-run` 폐지.** 스킬은 남는다 — 게이트 역할만 잃고 수동 리포트 도구가 된다.

## 사용자 시나리오

여기서 "사용자"는 이 저장소의 개발자(=메인테이너)와 외부 기여자다.

### S1. 평상시 dev 작업 → push

1. 개발자가 `/implement`·`/refactor` 등으로 작업하고 커밋한다.
2. `/push` 실행 → 문서 신선도 검사 + Codex 미러 게이트 통과 → **e2e 실행 없이** push.
3. `/push`가 CI run URL을 한 줄 보고하고 종료한다. 머신이 즉시 자유로워진다.
4. 4~6분 뒤 GitHub이 CI 결과를 알린다. 빨간불이면 개발자가 그때 대응한다.

**변화**: push 전 4~5분 로컬 e2e가 사라진다. 대가로 빨간 커밋이 dev에 일단 올라간다 — dev는 force push가 자유로운 작업 브랜치라 수용 가능한 거래다.

### S2. main 머지

1. `/merge` 실행 → 커밋 확인.
2. **e2e 게이트**: dev HEAD 커밋의 CI 결론을 조회한다.
   - `success` → 통과.
   - `failure` → 중단. main에 빨간 코드를 올리지 않는다.
   - 아직 진행 중 → 완료까지 대기 후 결론에 따른다.
   - run이 아예 없음(push되지 않은 커밋 등) → 중단하고 원인 보고.
3. 커버리지 리포트(비차단) → 버전 bump 커밋 → PR 생성.
4. PR CI(verify + e2e-gate)가 green이 될 때까지 대기 → squash 머지 → `/sync`.

**변화**: 로컬 해시 대조가 원격 CI 결론 조회로 바뀐다. bump 커밋 이후 PR CI를 한 번 더 기다리므로 `/merge`는 지금보다 4~6분 길어진다 — 릴리스 경계에서 드물게 일어나는 종착 액션이라 수용한다.

### S3. `/ship` 파이프라인

12단계 `/e2e-run`(최종 전수 게이트)이 사라진다. 11단계(docs 커밋) → 13단계 `/push`로 바로 이어지고, push가 CI에 검증을 넘긴다. Codex 런타임의 종착점은 12단계에서 **11단계(마지막 커밋)** 로 앞당겨진다.

### S4. 외부 기여자의 PR

1. 기여자가 fork에서 작업하고 main 대상 PR을 연다.
2. `verify` + `e2e-gate`가 자동 실행된다. 커밋된 `.env.ci`만 쓰므로 secret 없이 빌드된다.
3. required check가 빨간불이면 머지가 막힌다.

**변화**: 지금은 외부 PR에 e2e가 전혀 적용되지 않는다. 이게 이번 작업의 가장 큰 순증 가치다.

### S5. nightly

매일 03:00 KST에 **main** 기준으로 전체 CI가 돈다(GitHub `schedule` 이벤트는 기본 브랜치에서만 발화). 코드가 그대로여도 Chrome 버전 업데이트·러너 이미지 변경으로 생기는 깨짐을 잡는다. 실패하면 GitHub 알림으로 인지한다.

### 엣지 케이스

- **샤드 하나만 실패** → `fail-fast: false`로 나머지 샤드도 끝까지 돌려 실패 전모를 한 번에 본다. `e2e-gate` 집계 job이 빨간불이 된다.
- **연속 push** → `concurrency` 그룹(`ci-${{ github.ref }}`)이 이전 런을 취소한다. 기존 동작 유지.
- **spec에 `.only`가 남음** → `forbidOnly`(CI 한정)로 실패시킨다. 없으면 샤드가 조용히 green이 되어 게이트가 무의미해진다.
- **실패 원인 조사** → 실패한 샤드가 `playwright-report/`와 trace(`test-results/`)를 artifact로 올린다. `trace: "retain-on-failure"`는 이미 설정돼 있다.

## 성공 기준

1. dev에 push하면 CI에서 e2e 4샤드가 실행되고, 전체 wall-clock이 **10분 이내**다.
2. 의도적으로 깨뜨린 spec 하나가 담긴 브랜치를 push하면 `e2e-gate`가 빨간불이 되고, main PR 머지가 프로텍션에 막힌다.
3. 저장소 어디에도 `e2e/.last-green` 참조가 남지 않는다 — `grep -rn "last-green"`이 0건.
4. `/push`가 e2e를 실행하지 않고, push 후 즉시 CI run URL을 보고하며 종료한다.
5. `/merge`가 dev HEAD의 CI 결론을 조회해 게이트로 쓰고, 빨간불이면 PR을 만들지 않는다.
6. CI e2e가 `.env.local`·GitHub Secrets 없이 통과한다(커밋된 `.env.ci`만 사용).
7. 로컬 `pnpm test:e2e`는 지금과 동일하게 동작한다 — `retries: 0`, off-screen 창, `E2E_SHOW=1` 디버그 경로 모두 보존.
8. CLAUDE.md·`docs/DIRECTORY.md`·`e2e/README.md`·`CONTRIBUTING.md`의 "e2e는 CI에서 안 돈다" 서술이 전부 갱신된다.
