# manual-smoke — 구현 태스크

## 선행 조건

- **신규 권한 0 · 신규 env 0 · 신규 의존성 0 · 신규 npm 스크립트 0.** 프로덕션 코드(`src/`·`manifest.config.ts`·`package.json`·`playwright.config.ts`)를 건드리지 않는다.
- **실행 런타임은 Aside 전용.** Claude Code·Codex에는 브라우저 제어가 없다.
- **프로필당 최초 1회 언팩 로드는 사람이 한다.** 자동화 경로 4종이 전부 막힌 것은 `design.md` "최초 로드는 자동화할 수 없다" 참조. 로드 대상은 **`dist`**(`dist-e2e` 금지).
- 착수 전 `e2e/GOTCHAS.md`를 `tab.active`·`quota`·`bringToFront`·`탭 누수`로 grep한다. 이 기능의 위험 요소 5개가 전부 거기 선례가 있다.
- `docs/POSTMORTEM.md`를 `캡처 타이밍`·`포커스`로 grep한다.

---

## 태스크

### Task 1: `e2e/MANUAL-SMOKE.md` 골격

- **변경 대상**: `e2e/MANUAL-SMOKE.md` (신규)
- **작업 내용**: 4개 절 — (1) 개요·승격 기준 (2) 시나리오 정의 S1~S6(각각 목적·대상 사이트·전제 단언·절차·판정 문장·COVERAGE 매핑 인용) (3) 대상 사이트 표 (4) 최근 실행 이력 표(헤더만). 판정 문장은 **관측 가능한 형태**로 쓴다 — "정상인지 확인" 금지, "specified에 author 값이 뜨고 source 라벨에 셀렉터가 표시된다" 형태.
- **검증**:
  - [ ] S1~S6 각각에 **전제 단언**이 있다(사이트 붕괴를 회귀로 오판하지 않기 위한 것 — `design.md` 위험 4)
  - [ ] 각 시나리오가 `e2e/COVERAGE.md` 수동 잔여의 **원문 일부를 인용**한다(매핑 없는 시나리오 0개)
  - [ ] 사이트 표에 시나리오별 사이트와 "왜 이 사이트인가" 한 줄이 있다
  - [ ] 승격 기준(파일 3개 초과 또는 `.mjs` 등장 → `smoke/`)이 명시돼 있다
  - [ ] 이력 표 컬럼: 날짜 · 버전 · 커밋 · S1~S6 결과 · 비고

### Task 2: `.claude/commands/manual-smoke.md` 스킬

- **변경 대상**: `.claude/commands/manual-smoke.md` (신규), `.agents/skills/source-command-manual-smoke/SKILL.md` (sync 자동 생성)
- **작업 내용**: frontmatter `description` + 본문. 본문 구성은 `e2e-run.md`를 형식 참조. 절차 5단계(런타임 확인 → 전제 확인 → reload → 시나리오 루프 → 리포트+이력). **상수 4개**(확장 ID·패널 경로·`?tabId=`·picker host)와 **포커스 규칙**을 본문에 박는다. 시나리오 절차는 여기 복제하지 않고 `e2e/MANUAL-SMOKE.md`를 가리킨다.
- **검증**:
  - [ ] `pnpm sync:agents` 후 `.agents/skills/source-command-manual-smoke/SKILL.md`가 생성된다
  - [ ] `pnpm sync:agents:check` green
  - [ ] 본문에 **런타임 분기**가 있다 — 비-Aside 런타임은 즉시 중단(`ship.md`의 "런타임별 종착점" 형식 차용)
  - [ ] 금지 사항에 **빌드 금지**·**코드 수정 금지**·**push 금지**·**후속 스킬 자동 제안 금지**가 있다
  - [ ] 허용 쓰기가 `e2e/MANUAL-SMOKE.md` 이력 표 1행으로 한정돼 있다
  - [ ] `dist-e2e` 로드 금지가 명시돼 있다
  - [ ] 시나리오 절차가 본문에 복제돼 있지 않다(단일 출처 = `e2e/MANUAL-SMOKE.md`)

### Task 3: S5 배선 스모크 (가장 싼 시나리오로 파이프라인 검증)

- **변경 대상**: 없음 (실행만)
- **작업 내용**: 전제 확인 → `reload` → `chromewebstore.google.com/detail/bugshot/...` 열기 → 패널을 그 탭에 바인딩 → 미지원 안내 판정 → 지원 URL로 이동 후 자동 복구 판정 → 리포트. **스킬 배선 자체가 도는지**를 보는 게 목적이라 시나리오 내용은 부차적이다.
- **검증**:
  - [ ] `getExtensionsInfo`가 `location: "UNPACKED"` · `state: "ENABLED"` · 오류 0건을 돌려준다
  - [ ] `reload` 후에도 확장 ID가 `dhmffogmoohdjficicjjfolcheklngfm`로 유지된다
  - [ ] 패널에 `capture-unsupported` 안내가 뜨고 캡처 버튼 5개가 부재하다
  - [ ] 같은 탭을 지원 URL로 보내면 **조작 없이** `mode-element`가 복구된다
  - [ ] 시나리오 종료 시 열었던 탭이 전부 닫힌다(위험 5)

### Task 4: S1 — cross-origin 스타일 보강 양성 경로

- **변경 대상**: 없음 (실행만) / 결과를 `e2e/MANUAL-SMOKE.md`에 반영
- **작업 내용**: `naver.com`·`github.com`·`ui.shadcn.com`에서 **외부 CDN 시트로만 스타일이 오는 요소**를 골라 선택하고, specified가 author 값으로 채워지는지·source 라벨에 셀렉터가 뜨는지·`var()`가 해석되는지·cross-origin-only 커스텀 prop이 토큰 목록에 들어오는지 본다.
- **검증**:
  - [ ] **전제 단언**: 대상 요소의 스타일 출처 시트가 실제로 cross-origin이다(`document.styleSheets`의 `href` origin이 페이지와 다름). 아니면 `skip(사이트 변경)`
  - [ ] specified 값이 computed 폴백이 아니라 **author 원문 표기**로 뜬다(`rem`·`%` 등 computed에서 표기가 바뀌는 축으로 판정 — `GOTCHAS.md`의 "색으로는 캐스케이드를 검증할 수 없다"와 같은 이유)
  - [ ] source 라벨에 셀렉터 문자열이 표시된다
  - [ ] cross-origin `:root`에만 정의된 custom prop이 토큰 드롭다운에 나타난다(`mergeCrossOriginTokens` 실경로)
  - [ ] 보강이 **부분 실패**했을 때 에러 없이 computed 유지로 폴백한다(3개 사이트 중 하나는 이 경로에 걸릴 가능성이 높다)
  - [ ] 3개 사이트 중 **최소 1개에서 양성**이 나온다 — 0개면 이 항목의 판정 기준이나 사이트 선정이 잘못된 것이므로 기준을 고친다

### Task 5: S2 — 페이지 전체(스크롤) 캡처 실사이트

- **변경 대상**: 없음 (실행만)
- **작업 내용**: `ko.wikipedia.org` 긴 문서와 `news.naver.com` 기사에서 페이지 전체 캡처를 실행하고 스티칭 결과를 본다.
- **검증**:
  - [ ] **전제 단언**: 문서 높이가 뷰포트의 3배 이상이고 `position: fixed` 또는 `sticky` 요소가 1개 이상 존재한다
  - [ ] 결과 이미지에 sticky/fixed 헤더가 **반복되지 않는다**(첫 타일에만 존재)
  - [ ] 캡처 후 페이지 `scrollY`가 원래 값으로 복원된다
  - [ ] 캡(20타일·32000px·4M px)에 걸리는 문서에서 안내가 뜨고 조용히 잘리지 않는다
  - [ ] 캡처 중 추가·`position` 변경된 요소의 원래 스타일이 복원된다(인라인 `style` 잔여 0)
  - [ ] quota·`tab.active` 실패는 1회 재시도 후 `skip(환경)`으로 기록한다(위험 6)

### Task 6: S3 — element 캡처 컨텍스트 확장 (과확장·인접 개인정보)

- **변경 대상**: 없음 (실행만)
- **작업 내용**: `github.com` 이슈 목록의 행(`li`/`tr` 구조)과 `bug-shot.com/ko`의 카드에서 element 모드로 요소를 선택해 before/after 범위를 본다.
- **검증**:
  - [ ] **전제 단언**: 대상 요소에 의미 단위 조상이 있고 확장 게이트 3개(뷰포트 완전 포함 / 요소 포함 / 뷰포트 40% 이하)를 실제로 만족한다. 불만족이면 `skip(사이트 변경)` — 안 하면 "확장 안 됨"이 회귀인지 사이트 변경인지 구별 불가(위험 4)
  - [ ] 확장 범위가 의미 단위 컨테이너에서 멈추고 형제 행까지 번지지 않는다
  - [ ] 확장 이미지에 **인접 사용자 데이터가 불필요하게 포함되지 않는다**(육안 — privacy 코어 밸류 축)
  - [ ] `form`·`fieldset`이 후보에서 제외되는 것이 실사이트에서도 유지된다
  - [ ] 요소 선택 시 `buildSelector` 동기 블로킹이 체감되지 않는다(대형 DOM에서 선택→에디터 표시까지의 체감 지연을 기록)

### Task 7: S4 — picker 실사이트 정합 (광고 iframe 다수)

- **변경 대상**: 없음 (실행만)
- **작업 내용**: `news.naver.com`에서 picker를 켜고 광고 iframe이 여럿인 영역을 훑는다.
- **검증**:
  - [ ] **전제 단언**: 페이지의 iframe 수가 3개 이상이고 그중 cross-origin이 1개 이상이다
  - [ ] hover 하이라이트가 커서 아래 요소와 일치한다(엉뚱한 요소에 붙지 않음)
  - [ ] 등록 iframe 경계를 넘나들 때 하이라이트 깜빡임이 사용 불가 수준이 아니다(육안)
  - [ ] picking 중 인접 링크로 오네비게이션이 발생하지 않는다
  - [ ] 미등록 iframe(2-depth·srcdoc) 클릭 시 안내 다이얼로그가 뜨고 idle로 복귀한다
  - [ ] 프레임 수십 개에서 선택 반응이 체감상 멈추지 않는다(체감 지연 기록)

### Task 8: S6 — 시각 회귀 스윕 (light/dark × 320·376·480px)

- **변경 대상**: 없음 (실행만)
- **작업 내용**: 고정 사이트 1개에 패널을 물리고, 폭 3종 × 테마 2종 = 6조합으로 idle·drafting 화면을 찍어 육안 판정한다.
- **검증**:
  - [ ] 폭 강제가 `Emulation.setDeviceMetricsOverride`로 걸리고 `window.innerWidth`가 지정값과 같다(`setViewportSize`는 Aside에 없다)
  - [ ] **네비게이션·reload 후 override를 다시 건다**(위험 3 — reload에 날아가는 것을 실측)
  - [ ] 스크린샷에 override와 **같은 `clip`** 을 준다(안 주면 좁은 렌더가 가로로 반복돼 찍힌다 — 실측)
  - [ ] 다크는 **앱 테마를 바꿔서** 만든다(`bugshot-app-settings` seed 또는 설정 탭 Select). `prefers-color-scheme` 에뮬레이션만으로는 안 걸린다 — 기본 `theme`가 `"light"`(위험 2)
  - [ ] `integrations-cta` 배너: 320px ko 문구가 truncate돼도 우측 아이콘+"플랫폼 추가"가 살아있다
  - [ ] 다크모드 대비가 WCAG AA를 만족한다(육안 + 필요 시 computed 색 추출)
  - [ ] action 로그 필터 탭이 376px·**en 로케일**에서 가로 스크롤로 처리된다(ko는 라벨이 2자라 이 경로를 안 탄다)
  - [ ] idle 1×2×2 레이아웃의 3행 정렬·녹화/리플레이 균등 너비가 좁은 폭에서 깨지지 않는다
  - [ ] 스킵 없이 6조합 전부 찍힌다(조합 누락이 가장 흔한 실수)

### Task 9: 주변 문서 갱신

- **변경 대상**: `docs/DIRECTORY.md`, `e2e/COVERAGE.md`, `e2e/README.md`, `CLAUDE.md`
- **작업 내용**: `design.md`의 "변경 범위 > 갱신" 표대로. **`e2e/COVERAGE.md`의 수동 잔여 항목 자체는 옮기지 않는다** — 여전히 e2e 미커버라는 사실이 바뀌지 않았고, Aside 스윕은 별개 실행체다. 도입부 포인터 한 줄만 넣는다.
- **검증**:
  - [ ] `DIRECTORY.md`에 `e2e/MANUAL-SMOKE.md` 한 줄과 스킬 수 갱신이 반영됐다
  - [ ] `COVERAGE.md` 수동 잔여 목록의 **줄 수가 그대로다**(항목 이동 0)
  - [ ] `CLAUDE.md` 권장 흐름에 `/manual-smoke`가 `/merge` 전 권고로 들어갔다
  - [ ] `CLAUDE.md` 편집 후 `pnpm sync:agents:check` green (훅이 없는 런타임이면 손으로 `pnpm sync:agents`)
  - [ ] `pnpm typecheck` green (문서만 바꿨으므로 무변화 확인용)

### Task 10: 전체 1회 실행 + 이력 기록

- **변경 대상**: `e2e/MANUAL-SMOKE.md` (이력 표 1행)
- **작업 내용**: S1~S6 전체를 한 번 돌리고 이력 표에 1행 추가.
- **검증**:
  - [ ] 사람 개입 없이 S1~S6가 끝난다(최초 확장 로드 제외)
  - [ ] 리포트가 실패·skip을 성공보다 앞에 쓴다
  - [ ] 각 항목에 재현 정보(사이트 URL·요소 셀렉터·스크린샷 경로)가 있다
  - [ ] **같은 커밋에서 2회 실행 시 판정이 뒤집히는 항목이 0개다.** 뒤집히면 그 항목의 판정 기준을 고치거나 뺀다(성공 기준)
  - [ ] 스크린샷이 저장소에 커밋되지 않았다(세션 경로에만)

---

## 테스트 계획

- **단위 테스트**: **없음.** 프로덕션 코드를 만들지 않는다. 이 기능의 자동 그물은 `pnpm sync:agents:check`(미러 드리프트)와 `pnpm typecheck`(무변화 확인)뿐이다.
- **e2e 시나리오**: **없음.** 이 기능 자체가 e2e 바깥을 다루는 도구라 e2e로 감쌀 대상이 아니다. `playwright.config.ts`의 `testMatch`가 `.md`를 안 집으므로 스위트에 영향도 없다.
- **수동 테스트**: 스킬을 실제로 실행하는 것이 곧 수동 테스트다(Task 3·10). 추가로:
  - [ ] 비-Aside 런타임(Claude Code 또는 Codex)에서 `/manual-smoke`를 호출하면 즉시 중단되고 이유를 설명한다
  - [ ] 확장을 비활성화한 상태로 호출하면 중단하고 수동 로드 안내가 나온다
  - [ ] `dist`가 stale일 때 호출하면 중단하고 `/build` 안내가 나온다
  - [ ] `dist-e2e`를 로드한 프로필에서 호출하면 ID 불일치로 중단하고 "store/e2e 빌드 아닌가" 안내가 나온다

## 구현 순서 권장

```
Task 1 (MANUAL-SMOKE.md 골격)
  └→ Task 2 (스킬 + sync)
       └→ Task 3 (S5 배선 스모크)   ← 여기서 파이프라인이 안 돌면 뒤를 다 버린다
            └→ Task 4 (S1)          ← 최우선. 자동 그물 0인 유일 항목
                 ├→ Task 5 (S2)  ┐
                 ├→ Task 6 (S3)  ├ 병렬 가능 (서로 독립, 사이트도 다름)
                 └→ Task 7 (S4)  ┘
                      └→ Task 8 (S6)   ← 폭·테마 제어라 앞의 화면들을 재사용
                           └→ Task 9 (문서) → Task 10 (전체 실행 + 이력)
```

**Task 3을 앞에 두는 것이 핵심이다.** S5는 사이트 하나 열고 스냅샷 한 번이라 가장 싸고, 여기서 전제 확인·reload·바인딩·탭 정리 배선이 전부 검증된다. 이게 안 되면 S1~S4를 짜봐야 전부 같은 지점에서 죽는다.

Task 4를 Task 5~7보다 먼저 두는 것은 **PoC 판정 기준** 때문이다. S1이 양성을 못 내면 이 스킬의 가치 주장(자동 그물 0인 구간을 덮는다)이 무너지므로, 나머지에 시간을 쓰기 전에 확인한다.

## 가이드 영향

없음 — 사용자 노출 기능이 아니다.
