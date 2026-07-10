# 연동 CTA 배너 — 구현 태스크

## 선행 조건

- 새 권한·env·의존성 없음. `manifest.config.ts` 변경 없음.
- 새 shadcn 컴포넌트 설치 없음. 배너는 raw `<button>`(기존 AI 배너 패턴).
- 아이콘 `Blocks`는 lucide-react에 이미 있고 코드베이스에서 사용 중(`IntegrationsTab.tsx:208`).
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
- **주의**: `t()`가 `TranslationKey` 타입(`src/i18n/index.ts:23`)이라, 사용처(`PreviewPanel.tsx:391`·`DraftDetailDialog.tsx:947`)가 남은 채 `platform.empty.body`를 지우면 typecheck가 깨진다. Task 4와 한 배치로 끝내고 마지막에 typecheck를 돌리면 순서는 무관하다. 중간에 typecheck를 돌릴 계획이면 삭제를 Task 4 이후로 미룬다.
- **검증**:
  - [x] `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행하고 통과한다 (ko/en 키 대칭·빈 값·placeholder 일치) — 훅이 ko만 추가/삭제한 중간 상태를 두 번 차단해 대칭을 강제했다
  - [x] `grep -rn "platform.empty.body" src/ e2e/` → 결과 0건
  - [x] `grep -rn "platform.empty.title" src/` → `IssueCreateModal.tsx:556` 1건만 남음

### Task 2: `IntegrationsCta` 컴포넌트 신설

- **변경 대상**: `src/sidepanel/components/IntegrationsCta.tsx` (신규)
- **작업 내용**: `design.md`의 "인터페이스 설계" 마크업 그대로 구현.
  - props: `{ onNavigate: () => void; className?: string }`
  - `rounded-t-lg` + amber 컬러 + 다크모드 대응
  - `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset` (ring-inset — 배너가 가장자리까지 밀리므로 바깥 링은 잘린다)
  - 좌측은 아이콘 없이 `t("platform.cta.body")` (truncate). 컨테이너에 `gap-2`로 우측과 간격 확보
  - 우측 `Blocks` 아이콘 + `t("platform.cta.action")` (shrink-0)
  - `data-testid="integrations-cta"`
  - `cn()`으로 `className` 합성
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] 컴포넌트가 `useTabNav`를 직접 호출하지 않는다 (호출부가 `onNavigate` 주입)
  - [x] gradient text(`bg-clip-text text-transparent`)를 쓰지 않는다

### Task 3: AI 배너 2개에 focus 링 소급

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx:388`, `src/sidepanel/tabs/StyleEditorPanel.tsx:489`
- **작업 내용**: Task 2와 **동일한 `focus-visible` 클래스**를 두 배너 버튼에 추가한다. 그 외 마크업·색·동작은 일절 건드리지 않는다.
- **근거**: 세 배너가 같은 슬롯·같은 형태인데 CTA에만 focus 링이 있으면 형제끼리 동작이 갈린다. design.md "focus 링 소급 적용" 참조.
- **검증**:
  - [ ] Tab 키로 세 배너에 도달했을 때 모두 동일한 링이 보인다
  - [ ] 마우스 클릭 시에는 링이 안 보인다 (`focus-visible`이므로)
  - [ ] 세 배너의 hover 동작이 기존과 같다

### Task 4: `App.tsx` 자동 전환 제거

- **변경 대상**: `src/sidepanel/App.tsx`
- **작업 내용**:
  - `102-106`의 `useEffect` 삭제
  - `85`의 `const accounts = ...` 삭제 (고아)
  - `20`의 import에서 `connectedPlatforms` 제거 (`useSettingsStore`는 유지 — `57`·`60`에서 사용)
  - `settingsHydrated`(`81`)는 유지 — `176` 렌더 가드에서 사용
- **주의**: `App.tsx:262`의 OAuth 만료 다이얼로그가 `setTab("integrations")`를 호출한다. 이 경로는 독립이며 삭제 대상이 아니다.
- **검증**:
  - [x] `pnpm typecheck` 통과 (미사용 변수·import 없음)
  - [x] `grep -n "connectedPlatforms\|accounts" src/sidepanel/App.tsx` → 결과 0건
  - [x] `navTo`·`TabNavContext.Provider`는 그대로 남아 있다
  - [x] OAuth 만료 다이얼로그의 `setTab("integrations")`는 그대로 남아 있다 (effect 삭제로 `255`로 이동)

### Task 5: 3개 호출부에 배너 배치

병렬 가능한 3개 하위 작업.

#### 5-1. `IssueTab.tsx` — `EmptyState`

- **작업 내용**:
  - `EmptyState` 내부에서 `useTabNav()`·`useSettingsStore((s) => s.accounts)` 호출
  - `connectedPlatforms(accounts).length === 0`일 때 `<PageFooter>`(`219`) 직전에 `<IntegrationsCta onNavigate={() => navTo("integrations")} />`
  - `className` 주입 없음
- **검증**:
  - [ ] 연동 0개일 때 캡처 진입 화면에 배너가 뜬다
  - [ ] 연동 1개 이상이면 배너가 없다
  - [ ] 캡처 버튼 6개가 여전히 전부 활성이다

#### 5-2. `PreviewPanel.tsx`

- **작업 내용**:
  - `387-393`의 `<Alert>` 블록 삭제
  - `</PageScroll>`(`385`)와 `<PageFooter>`(`386`) 사이에 배너 삽입
  - **제자리 교체가 아니다**: Alert는 `PageFooter`의 자식이었고, 배너는 `PageFooter`의 형제로 승격된다. Alert가 갖고 있던 `className="mb-2"`는 버린다.
  - 조건은 기존 `noPlatformConnected`(`74-77`) 재사용
  - `useTabNav` import 추가
  - `Alert`/`AlertDescription`/`AlertTitle`(`4`), `Info`(`2`) import 제거. `Download`는 `177`·`210`·`239`에서 계속 쓰므로 유지
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] 미리보기 화면에서 Alert 대신 배너가 뜬다 (수동/e2e)
  - [ ] 클립보드 복사 버튼이 여전히 동작한다 (연동 무관) (수동/e2e)
  - [ ] 제출 버튼은 여전히 disabled + 툴팁 (배너와 공존이 의도) (수동/e2e)

#### 5-3. `DraftDetailDialog.tsx`

- **작업 내용**:
  - `943-949`의 `<Alert>` 블록 삭제
  - 같은 위치에 `<IntegrationsCta className="-mx-6 -mt-5 -mb-5" onNavigate={() => { onOpenChange(false); navTo("integrations"); }} />`
  - 조건은 기존 `available.length === 0` 유지 (변경 금지 — PRD S4)
  - **닫기를 먼저, `navTo`를 나중에** 호출한다
  - `useTabNav` import 추가
  - `Info`(`945`에서만 사용), `Alert`/`AlertTitle`/`AlertDescription`(`944-947`에서만 사용) import 제거. 삭제 확인용 `AlertDialog` 계열은 별도 import이므로 건드리지 않는다
- **검증**:
  - [ ] 배너 상단이 스크롤 영역 하단에 갭 없이 붙는다 (`-mt-5`)
  - [ ] 배너 하단이 `DialogFooter` 상단에 갭 없이 붙는다 (`-mb-5`)
  - [ ] 배너 좌우 끝이 `DialogFooter` 좌우 끝과 일치한다 (`-mx-6`)
  - [ ] 배너 클릭 시 다이얼로그가 닫히고 `integrations` 탭이 active가 된다
  - [ ] Slack만 연동 + Slack-preserved 이슈에서도 배너가 뜬다
  - [ ] 삭제 확인 AlertDialog(`952-972`)·제출 모달·필드 편집·네트워크 로그 프리뷰가 그대로 동작한다

### Task 6: 단위 테스트

- **변경 대상**: `src/sidepanel/tabs/__tests__/issueListUtils.test.ts`
- **작업 내용**: 조사 결과 아래 두 케이스가 **없는 것으로 확정**됐다(`issueListUtils.test.ts:487-499`에 `submittablePlatforms` 테스트 2개가 있으나 둘 다 미포함). 반드시 추가한다.
  1. Slack 단독 연동 + Slack-preserved 이슈 → `submittablePlatforms`가 `[]` 반환
  2. 빈 `accounts` → `submittablePlatforms`가 `[]` 반환
- **근거**: 두 경로 모두 `DraftDetailDialog`의 배너 노출 조건이자 제출 버튼 disabled 조건(`978`)을 공유한다.
- **검증**:
  - [x] `pnpm test` 통과 (185 files / 2803 tests)
  - [x] 위 두 케이스가 실제로 새로 추가됐다 (기존 테스트 재활용 아님)

> 배너 컴포넌트 자체는 `/tdd` 분류표상 단위 테스트 스킵 대상. e2e로 커버한다.

### Task 7: e2e 스위트 수정

- **변경 대상**: `e2e/onboarding.spec.ts`, `e2e/fixtures/extension.ts`, `e2e/COVERAGE.md`, `e2e/GOTCHAS.md`

#### 7-1. `onboarding.spec.ts` 재작성

기존 테스트 "연동 0개 → integrations 탭 자동 진입"은 이번 변경으로 **정반대 동작을 검증**한다. 새 동작 기준으로 다시 쓴다.

필수 시나리오:
1. 연동 0개로 사이드패널을 열면 `tab-debug`가 active다
2. 캡처 진입 화면에 `integrations-cta`가 보인다
3. `integrations-cta`를 클릭하면 `tab-integrations`가 active가 된다
4. 사이드패널을 닫았다 다시 열어도 `tab-debug`에 착지한다 (반복 리다이렉트 없음)
5. **`previewing` 화면에 `integrations-cta`가 보인다** — 수동 유예 불가

> 5번은 경로가 이미 실증돼 있다. `e2e/freeform-draft.spec.ts:12-38`이 `enterDebug(panel)` → `mode-freeform` 클릭 → `drafting-panel` 노출 → `draft-title` fill → `to-preview` 클릭 → `preview-section-*` 노출로 previewing에 도달한다. 이 경로를 그대로 재사용한다. PRD가 previewing을 "전환 의도가 가장 높은 지점"으로 규정하므로 자동 회귀 커버리지에서 빠지면 안 된다.

선택 시나리오 (넣으면 좋음):
6. 연동을 1개 주입하면 배너가 사라진다. `slack-submit-gating.spec.ts:49-54`의 storage seed 패턴(`chrome.storage.local.set("bugshot-settings", envelope{version:10})` + `panel.reload()`)을 재사용한다.

#### 7-2. `enterDebug` 헬퍼 주석 갱신

`e2e/fixtures/extension.ts:278-288`의 `enterDebug` 주석은 "fresh 프로필은 연동 0개라 integrations 자동 전환 effect와 race가 난다"고 설명한다. Task 4가 그 effect를 지우면 **이 주석이 거짓이 된다**. 헬퍼 자체는 idempotent라 계속 동작하지만, 40개 spec이 이 헬퍼에 의존하므로 유령 race를 쫓지 않도록 주석을 갱신한다.

`e2e/COVERAGE.md:42`, `e2e/GOTCHAS.md:23`의 "auto-redirect race 회피" 서술도 함께 정리한다.

#### 7-3. 회귀 확인

`PreviewPanel`은 연동 0개로 previewing에 도달하는 여러 spec이 공유한다(`freeform-draft`, `capture`, `download-buttons`, `draft-field-edit`, `settings-sections` 등). 이제 non-interactive `Alert` 대신 interactive `<button>`이 footer 위에 렌더된다.

- **검증**:
  - [x] `pnpm build:e2e && pnpm test:e2e` **전체 green** (174 passed). 1회차에 `picker-guard`가 실패했으나 GOTCHAS 20번에 기록된 알려진 환경 flaky(재arm clobber 데드락)로, 단독 재실행 2/2 green + 전체 재실행 174/174 green으로 판정
  - [x] previewing에 도달하는 spec들의 footer 버튼(`copy-markdown`·download·복귀)이 배너에 가려지거나 클릭이 가로채이지 않는다 (전체 스위트 green으로 확인)
  - [x] `onboarding.spec.ts`에 `tab-integrations` 자동 active 단언이 남아 있지 않다 (5 tests로 재작성, 2회 연속 green)
  - [x] `grep -rn "자동 전환\|auto-redirect" e2e/` → stale 주석 0건 (`onboarding.spec.ts` 제외 — 재작성 대상). `fixtures/extension.ts`·`GOTCHAS.md`·`COVERAGE.md` 외에 `attachments`·`settings-sections`·`draft-resume`·`draft-field-edit` spec 주석 4곳이 추가로 발견돼 함께 정정

---

## 테스트 계획

### 단위 테스트
- `submittablePlatforms` — Slack-preserved 이슈 + Slack 단독 연동 → `[]` (Task 6)
- `submittablePlatforms` — 빈 `accounts` → `[]` (Task 6)
- 배너 컴포넌트는 스킵 (`/tdd` 분류표: 컴포넌트)

### e2e 시나리오 (`/e2e-write` 입력)
- 연동 0개로 사이드패널을 열면 `tab-debug`가 active가 된다.
- 연동 0개로 사이드패널을 열면 `integrations-cta` 배너가 보인다.
- `integrations-cta`를 클릭하면 `tab-integrations`가 active가 된다.
- 사이드패널을 닫았다 다시 열면 다시 `tab-debug`가 active가 된다.
- 연동 0개 상태에서 `mode-freeform` → `draft-title` fill → `to-preview`로 미리보기에 도달하면 `integrations-cta` 배너가 보인다.
- (선택) storage seed로 연동 1개를 주입하고 reload하면 `integrations-cta`가 보이지 않는다.

### 수동 테스트 (Chrome)
- [ ] 320px 폭에서 배너 좌측 문구가 truncate되고 우측 `Blocks` + "플랫폼 추가"가 잘리지 않고 표시된다
- [ ] 320px 폭에서 좌측 문구가 3~4자만 남는 수준이면 문구 단축을 검토한다 (좌측 아이콘은 이미 제거됨)
- [ ] `EmptyState`에서 캡처 버튼 6개가 겹침·잘림 없이 표시되고, 배너 위 빈 여백이 어색하지 않다 (어색하면 배너를 `PageFooter` 첫 자식으로 이동 — design.md 위험 요소 참조)
- [ ] 다크모드에서 배너 텍스트 대비가 WCAG AA(4.5:1)를 충족한다
- [ ] 라이트모드에서 배너(`bg-amber-100/80`)와 footer(`bg-muted/50`)의 경계가 border로 식별된다
- [ ] `DraftDetailDialog`에서 배너 상·하단이 갭·단차 없이 접합된다
- [ ] Tab 키로 세 배너(amber CTA, purple AI, teal AI)에 도달 시 동일한 focus 링이 보인다
- [ ] 다른 창에서 OAuth 완료 후 돌아오면 배너가 즉시 사라진다 (PRD S5)

---

## 구현 순서 권장

```
Task 1(추가분) → Task 2 → Task 3 (독립, 병렬 가능)
                    │
Task 4 (독립) ──────┤
                    ↓
        Task 5-1 / 5-2 / 5-3 (병렬)
                    ↓
              Task 1(삭제분)
                    ↓
              Task 6 → Task 7
```

- Task 3(AI 배너 focus 소급)은 Task 2의 focus 클래스가 확정된 뒤에 하면 복붙으로 끝난다.
- Task 4(App.tsx)는 Task 5와 독립이지만 먼저 하면 수동 확인 시 자동 전환에 가로막히지 않는다.
- Task 5의 세 하위 작업은 서로 독립.
- `platform.empty.body` 삭제는 Task 5-2·5-3 완료 후에 (typecheck 순서).
- Task 7은 Task 4·5가 끝나야 의미가 있다.

## 가이드 영향

**있음.** 사이드패널 최초 진입 동작이 바뀌므로 온보딩·시작하기 성격의 페이지를 대조한다. 구현 후 `/guide`로 처리하며, 작성 전 `guide/AUTHORING.md`를 먼저 읽는다.

- 시작하기 / 설치 직후 첫 화면을 설명하는 페이지 (ko·en) — "설치하면 연동 탭이 먼저 열린다"는 서술이 있으면 "캡처 화면에 착지하고, 연동은 배너로 안내된다"로 갱신
- 연동(Integrations) 페이지 (ko·en) — 연동 탭 진입 경로에 "캡처·미리보기 화면의 배너 클릭"을 추가

> 정확한 파일 경로는 `/guide` 실행 시 `guide/ko`·`guide/en` 트리에서 확인한다.
