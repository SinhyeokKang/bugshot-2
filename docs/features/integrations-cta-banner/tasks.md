# 연동 CTA 배너 — 구현 태스크

## 선행 조건

- 새 권한·env·의존성 없음. `manifest.config.ts` 변경 없음.
- 새 shadcn 컴포넌트 설치 없음. 배너는 raw `<button>`(기존 AI 배너 패턴).
- 아이콘 `Info`·`Blocks`는 lucide-react에 이미 있고 코드베이스에서 사용 중.
- 착수 전 `docs/POSTMORTEM.md`를 `sidepanel`·`탭`·`i18n` 키워드로 grep해 과거 함정을 확인한다.

---

## 태스크

### Task 1: i18n 키 추가·삭제

- **변경 대상**: `src/i18n/namespaces/app.ts`
- **작업 내용**:
  - 추가 (ko/en 동시):
    - `platform.cta.body` — ko "플랫폼을 추가해 이슈를 등록하세요." / en "Add a platform to start filing issues."
    - `platform.cta.action` — ko "플랫폼 추가" / en "Add platform"
  - 삭제: `platform.empty.body` (ko `38` / en `91`).
  - 유지: `platform.empty.title` — `IssueCreateModal.tsx:556`이 툴팁으로 계속 쓴다.
- **주의**: 삭제는 Task 3·4로 사용처를 먼저 없앤 뒤에 해야 타입 에러가 안 난다. 순서상 이 태스크의 "추가"만 먼저 하고 "삭제"는 Task 4 이후로 미뤄도 된다.
- **검증**:
  - [ ] `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행하고 통과한다 (ko/en 키 대칭·빈 값·placeholder 일치)
  - [ ] `grep -rn "platform.empty.body" src/ e2e/` → 결과 0건
  - [ ] `grep -rn "platform.empty.title" src/` → `IssueCreateModal.tsx` 1건만 남음

### Task 2: `IntegrationsCta` 컴포넌트 신설

- **변경 대상**: `src/sidepanel/components/IntegrationsCta.tsx` (신규)
- **작업 내용**: `design.md`의 "인터페이스 설계" 마크업 그대로 구현.
  - props: `{ onNavigate: () => void; className?: string }`
  - `rounded-t-lg` + amber 컬러 + 다크모드 대응
  - 좌측 `Info` 아이콘 + `t("platform.cta.body")` (truncate)
  - 우측 `Blocks` 아이콘 + `t("platform.cta.action")` (shrink-0)
  - `data-testid="integrations-cta"`
  - `cn()`으로 `className` 합성
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 컴포넌트가 `useTabNav`를 직접 호출하지 않는다 (호출부가 `onNavigate` 주입)
  - [ ] gradient text(`bg-clip-text text-transparent`)를 쓰지 않는다

### Task 3: `App.tsx` 자동 전환 제거

- **변경 대상**: `src/sidepanel/App.tsx`
- **작업 내용**:
  - `102-106`의 `useEffect` 삭제
  - `85`의 `const accounts = ...` 삭제 (고아)
  - `20`의 import에서 `connectedPlatforms` 제거 (`useSettingsStore`는 유지 — `57`·`60`에서 사용)
  - `settingsHydrated`(`81`)는 유지 — `176` 렌더 가드에서 사용
- **검증**:
  - [ ] `pnpm typecheck` 통과 (미사용 변수·import 없음)
  - [ ] `grep -n "connectedPlatforms\|accounts" src/sidepanel/App.tsx` → 결과 0건
  - [ ] `navTo`·`TabNavContext.Provider`는 그대로 남아 있다

### Task 4: 3개 호출부에 배너 배치

병렬 가능한 3개 하위 작업. 각각 Alert 제거 + 배너 삽입 + import 정리.

#### 4-1. `IssueTab.tsx` — `EmptyState`

- **작업 내용**:
  - `EmptyState` 내부에서 `useTabNav()`·`useSettingsStore((s) => s.accounts)` 호출
  - `connectedPlatforms(accounts).length === 0`일 때 `<PageFooter>`(`219`) 직전에 `<IntegrationsCta onNavigate={() => navTo("integrations")} />`
  - `className` 주입 없음
- **검증**:
  - [ ] 연동 0개일 때 캡처 진입 화면에 배너가 뜬다
  - [ ] 연동 1개 이상이면 배너가 없다
  - [ ] 캡처 버튼 6개가 여전히 전부 활성이다

#### 4-2. `PreviewPanel.tsx`

- **작업 내용**:
  - `387-393`의 `<Alert>` 블록 삭제
  - `</PageScroll>`(`385`)와 `<PageFooter>`(`386`) 사이에 배너 삽입, 조건은 기존 `noPlatformConnected`(`74-77`) 재사용
  - `useTabNav` import 추가
  - `Alert`/`AlertDescription`/`AlertTitle`(`4`), `Info`(`2`) import가 고아면 제거. `Download`는 유지
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 미리보기 화면에서 Alert 대신 배너가 뜬다
  - [ ] 클립보드 복사 버튼이 여전히 동작한다 (연동 무관)
  - [ ] 제출 버튼은 여전히 disabled + 툴팁

#### 4-3. `DraftDetailDialog.tsx`

- **작업 내용**:
  - `943-949`의 `<Alert>` 블록 삭제
  - 같은 위치에 `<IntegrationsCta className="-mx-6 -mb-5" onNavigate={() => { onOpenChange(false); navTo("integrations"); }} />`
  - 조건은 기존 `available.length === 0` 유지 (변경 금지 — PRD S4)
  - **닫기를 먼저, `navTo`를 나중에** 호출한다
  - `useTabNav` import 추가
  - `Alert` 계열·`Info` import가 고아면 제거
- **검증**:
  - [ ] 배너 하단이 `DialogFooter` 상단에 갭 없이 붙는다 (`-mb-5`가 `gap-5`를 상쇄)
  - [ ] 배너 좌우 끝이 `DialogFooter` 좌우 끝과 일치한다 (`-mx-6`)
  - [ ] 배너 클릭 시 다이얼로그가 닫히고 `integrations` 탭이 active가 된다
  - [ ] Slack만 연동 + Slack-preserved 이슈에서도 배너가 뜬다

### Task 5: 단위 테스트

- **변경 대상**: 신규 순수 함수 없음
- **작업 내용**: 배너 노출 조건은 전부 기존 셀렉터(`connectedPlatforms`, `submittablePlatforms`)의 파생값이고, 두 함수는 이미 테스트가 있는지 확인한다. 없으면 `submittablePlatforms`의 Slack-preserved 분기 케이스를 추가한다.
- **검증**:
  - [ ] `pnpm test` 통과
  - [ ] `submittablePlatforms`: Slack만 연동 + Slack-preserved 이슈 → `[]` 반환하는 케이스가 커버됨

> 배너 자체는 컴포넌트라 `/tdd` 분류표상 단위 테스트 스킵 대상. e2e로 커버한다.

### Task 6: e2e 스위트 수정

- **변경 대상**: `e2e/onboarding.spec.ts`
- **작업 내용**: 기존 테스트 "연동 0개 → integrations 탭 자동 진입"은 이번 변경으로 **정반대 동작을 검증**한다. 파일을 새 동작 기준으로 재작성한다.
  - 삭제: 자동 전환 검증 (`tab-integrations`가 active)
  - 추가 시나리오:
    1. 연동 0개로 사이드패널을 열면 `tab-debug`가 active다
    2. 캡처 진입 화면에 `integrations-cta` 배너가 보인다
    3. 배너를 클릭하면 `tab-integrations`가 active가 된다
    4. 사이드패널을 닫았다 다시 열어도 `tab-debug`에 착지한다 (반복 리다이렉트 없음)
  - e2e 프로필은 플랫폼을 연결하지 않으므로 배너가 항상 뜬다. 기존 fixture(`ext.openPanel`, `ext.fixtureUrl("basic.html")`) 재사용.
- **주의**: `previewing` 상태 배너의 e2e는 freeform draft 진입(`mode-freeform`) 후 미리보기까지 도달해야 한다. 기존 spec에 유사 경로가 있으면 재사용하고, 없으면 이 시나리오는 수동 테스트로 넘긴다.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e` green
  - [ ] `onboarding.spec.ts`에 `tab-integrations` 자동 active 단언이 남아 있지 않다

---

## 테스트 계획

### 단위 테스트
- `submittablePlatforms` — Slack-preserved 이슈 + Slack 단독 연동 → `[]`. (Task 5)
- 배너 컴포넌트는 스킵 (`/tdd` 분류표: 컴포넌트).

### e2e 시나리오 (`/e2e-write` 입력)
- 연동 0개로 사이드패널을 열면 `tab-debug`가 active가 된다.
- 연동 0개로 사이드패널을 열면 `integrations-cta` 배너가 보인다.
- `integrations-cta`를 클릭하면 `tab-integrations`가 active가 된다.
- 사이드패널을 닫았다 다시 열면 다시 `tab-debug`가 active가 된다.
- 연동 0개 상태에서 `mode-freeform`으로 초안을 만들고 미리보기에 도달하면 `integrations-cta` 배너가 보인다. (기존 경로 재사용 가능할 때만)

### 수동 테스트 (Chrome)
- [ ] `EmptyState`에 배너가 추가된 뒤에도 캡처 버튼 묶음의 수직 중앙 정렬이 어색하지 않다
- [ ] 사이드패널 최소 폭에서 배너 좌측 문구가 truncate되고 우측 액션(`Blocks` + "플랫폼 추가")이 살아남는다
- [ ] ko 문구("플랫폼을 추가해 이슈를 등록하세요.")가 en보다 길어 먼저 잘리는 지점을 확인
- [ ] 다크모드에서 amber 배너 대비가 충분하다 (`bg-amber-950/50` + `text-amber-300`)
- [ ] `DraftDetailDialog`에서 배너가 `DialogFooter`에 갭·단차 없이 접합된다
- [ ] 배너가 `PageFooter`의 `bg-muted/50` 위에서 묻히지 않는다
- [ ] 다른 창에서 OAuth 완료 후 돌아오면 배너가 즉시 사라진다 (PRD S5)

---

## 구현 순서 권장

```
Task 1(추가분만) → Task 2 → Task 3 ─┐
                                    ├→ Task 4-1 / 4-2 / 4-3 (병렬)
                                    │        ↓
                                    │   Task 1(삭제분)
                                    │        ↓
                                    └→ Task 5 → Task 6
```

- Task 3(App.tsx)과 Task 4는 서로 독립이라 순서 무관하지만, Task 3을 먼저 해야 수동 확인 시 자동 전환에 가로막히지 않는다.
- Task 4의 세 하위 작업은 서로 독립.
- `platform.empty.body` 삭제(Task 1의 후반)는 Task 4-2·4-3 완료 후에.
- Task 6은 Task 3·4가 끝나야 의미가 있다.

## 가이드 영향

**있음.** 사이드패널 최초 진입 동작이 바뀌므로 온보딩·시작하기 성격의 페이지를 대조한다. 구현 후 `/guide`로 처리하며, 작성 전 `guide/AUTHORING.md`를 먼저 읽는다.

- 시작하기 / 설치 직후 첫 화면을 설명하는 페이지 (ko·en) — "설치하면 연동 탭이 먼저 열린다"는 서술이 있으면 "캡처 화면에 착지하고, 연동은 배너로 안내된다"로 갱신
- 연동(Integrations) 페이지 (ko·en) — 연동 탭 진입 경로에 "캡처·미리보기 화면의 배너 클릭"을 추가

> 정확한 파일 경로는 `/guide` 실행 시 `guide/ko`·`guide/en` 트리에서 확인한다.
