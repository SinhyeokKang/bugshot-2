# manual-smoke (Aside 실사이트 스모크)

> **제품 기능이 아니라 워크플로우 도구다.** `src/` 프로덕션 코드를 한 줄도 바꾸지 않는다. 산출물은 스킬 1개(`.claude/commands/manual-smoke.md`)와 데이터 문서 1개(`e2e/MANUAL-SMOKE.md`)뿐이다.

## 배경

`e2e/COVERAGE.md`의 "수동 잔여"에는 20개가 넘는 항목이 **코드 결함이 아니라 환경 제약** 때문에 자동화 밖에 남아 있다. 사유는 네 갈래로 수렴한다.

| 사유 | 대표 항목 |
|---|---|
| fixture 서버가 loopback → SSRF 가드가 보강 fetch를 차단 | cross-origin 스타일 보강 양성 경로 (**자동 그물 0**) |
| `captureVisibleTab` quota flaky → 캡처 진입 spec 금지 | 30s Replay 전량, 컨텍스트 확장 나머지 축 |
| 픽셀·시각 판정 불가 | 다크모드 대비, 320px truncate, konva 도형 정합, 썸네일 |
| 실제 외부 호스트 접근 필요 | webstore 차단 호스트 |

이 넷은 **Playwright를 더 잘 써서 해결되는 문제가 아니다.** e2e가 게이트로 서려면 결정론이 필요한데, 위 항목들은 결정론을 포기해야만 검증할 수 있다. 그래서 지금까지 "릴리스마다 사람이 손으로" 처리해 왔고, 실제로 빠뜨려서 회귀가 났다(`docs/POSTMORTEM.md`).

Aside 브라우저 에이전트에는 그 제약 넷이 **없다**. 실 브라우저에서 실사이트를 열고, 실제 로그인 세션을 쓰고, 스크린샷을 **보고** 판정한다. 게이트가 아니므로 flaky해도 된다.

### 실현 가능성은 확인됐다

설계 전에 실측으로 전 구간을 태웠다(2026-08-06).

- 언팩 확장 로드 후 id가 `dhmffogmoohdjficicjjfolcheklngfm`로 고정된다(`manifest.config.ts`의 `DEV_KEY` SHA256에서 계산한 값과 실제 로드 결과가 일치).
- `chrome-extension://<id>/src/sidepanel/index.html?tabId=<n>`을 탭으로 열면 패널이 실제 웹페이지에 바인딩된다(`useBoundTabId`의 `readQuery` 경로 — e2e `openPanel`과 동일).
- 모드 진입 시 실사이트에 `__bugshot_picker_host`가 주입되고, 요소 선택 → 스타일 에디터 12개 섹션 값 파생 → 라이브 편집이 프로덕션 페이지 computed에 반영되는 것까지 확인했다(`font-size` 60px → 24px, `width`·`height`·`line-height` 파생값 연쇄 갱신, 변경 배지 `1`).
- **실사이트에서만 나오는 값이 실제로 나왔다** — `--border 220 13% 91%`, `--foreground 224 71.4% 4.1%`, length 토큰 40여 개. fixture 서버로는 만들 수 없는 CSS 변수 그래프다.

## 목표

1. **`/manual-smoke` 한 번 호출로 우선순위 시나리오 6종(S1~S6)이 실사이트에서 순차 실행되고, 단계별 스크린샷과 항목별 판정이 리포트로 나온다.**
2. **각 시나리오는 `e2e/COVERAGE.md` 수동 잔여의 특정 줄에 1:1로 매핑된다.** 매핑 없는 시나리오를 추가하지 않는다 — 그러면 "그냥 이것저것 해보는 스킬"이 되어 존재 이유가 흐려진다.
3. **판정 기준이 문서에 박혀 있어 실행자가 즉흥 판단하지 않는다.** 각 시나리오마다 "무엇을 보면 통과인가"가 관측 가능한 문장으로 적혀 있다.
4. **실사이트가 바뀌어도 스킬이 죽지 않는다.** 픽셀 스냅샷을 고정하지 않고 구조 판정 + 육안으로 간다.
5. **리포트 전용이다.** 실패해도 아무것도 차단하지 않고, 코드를 고치지 않는다.
6. **확장 가능하다.** PoC 6종이 쓸모 있다고 판정되면 수동 잔여의 나머지 항목을 같은 틀에 추가할 수 있다.

## 비목표 (Non-goals)

- **차단 게이트화.** 실사이트 의존이라 결정론이 없다. e2e 차단 게이트는 CI의 `e2e-gate` 단독이라는 기존 구조를 건드리지 않는다.
- **OAuth 8플랫폼 실연동·실제 이슈 제출.** 실제 트래커에 이슈가 생성되고 정리가 필요하다. 별도 스킬로 분리한다.
- **영상 녹화·30s Replay.** `getDisplayMedia` 네이티브 picker는 Aside도 못 뚫는다(같은 벽으로 `osascript`·`pbcopy`·`screencapture`가 전부 샌드박스 차단인 것을 실측). 탭 녹화는 기술적으로 가능할 수 있으나 1차 제외.
- **pointer capture 회귀 감지.** `e2e/GOTCHAS.md`가 적은 대로 CDP 합성 입력은 실제 Chrome의 암묵적 pointer capture 해제를 재현하지 못한다. **Aside도 같은 배관이라 못 잡는다.** 이건 영구 사람 손이다.
- **픽셀 스냅샷 회귀 비교.** 실사이트가 바뀌므로 골든 이미지를 유지할 수 없다.
- **빌드 자동 실행.** `CLAUDE.md`의 "빌드는 자동 실행하지 않는다"를 그대로 따른다. `dist` 신선도만 확인하고 오래되면 중단한다.
- **`src/` 프로덕션 코드 변경.** 이 기능은 코드를 만들지 않는다.
- **최초 확장 로드 자동화.** 아래 참조.

### 최초 로드는 자동화할 수 없다 (확정 제약)

네 가지 경로를 전부 시도해 막힌 것을 확인했다.

| 경로 | 결과 |
|---|---|
| CDP `Extensions.loadUnpacked` | `Method not available` — Chrome이 unsafe 오퍼레이션을 pipe 연결에만 허용. 같은 도메인의 `Extensions.getStorageItems`는 `Invalid parameters`로 답하므로 **도메인은 살아있고 이 메서드만 게이트**돼 있다. 보안 게이트라 우회하지 않는다 |
| CDP `Input.dispatchDragEvent`로 폴더 경로 드롭 | CDP는 수락하지만 `loadUnpacked({useDraggedPath:true})`가 `No dragged path`. 드래그 경로는 views 레이어에서 잡히는데 CDP는 그 아래로 주입한다 |
| AppleScript로 네이티브 패널 조작 | 셸 샌드박스가 `osascript` 자체를 차단(`can't open default scripting component`) |
| `Page.setInterceptFileChooserDialog` | 활성화는 되지만 `filechooser` 이벤트 0건. `developerPrivate`는 브라우저 프로세스의 `SelectFileDialog`를 쓰지 renderer file chooser가 아니다 |

따라서 **프로필당 최초 1회 수동 로드를 전제**로 두고, 그 이후의 재로드는 `chrome.developerPrivate.reload(id)`로 자동화한다.

## 사용자 시나리오

### 정상 흐름

1. 사용자가 `pnpm build`로 `dist`를 갱신한다(또는 `/build`).
2. `/manual-smoke`를 호출한다. 인자 없으면 S1~S6 전체, `/manual-smoke S1 S3`처럼 부분 실행도 된다.
3. 스킬이 전제를 확인한다 — 런타임이 Aside인가 / 확장이 로드돼 있는가 / `dist`가 마지막 커밋보다 최신인가.
4. `chrome.developerPrivate.reload(<id>)`로 확장을 갱신하고 로드 오류 0건을 확인한다.
5. 시나리오를 순서대로 실행한다. 각 단계에서 스크린샷을 세션 임시 경로에 남긴다.
6. 리포트를 낸다: 시나리오별 pass / fail / skip + 사유 + 스크린샷 경로. 실패는 성공보다 앞에 쓴다.
7. `e2e/MANUAL-SMOKE.md`의 "최근 실행" 표에 한 줄(날짜·버전·항목별 결과)을 추가한다.

### 엣지 케이스

- **확장 미로드** → 로드 경로가 자동화 불가하므로 즉시 중단하고, `dist` 절대 경로와 "chrome://extensions에서 압축해제된 확장 프로그램 로드" 안내만 낸다. 부분 실행으로 얼버무리지 않는다.
- **`dist`가 stale** → 중단하고 `/build` 안내. 스킬이 직접 빌드하지 않는다.
- **비-Aside 런타임(Claude Code·Codex)에서 호출** → 브라우저 제어가 없으므로 즉시 중단. `ship.md`의 런타임 분기와 같은 방식.
- **대상 사이트가 죽었거나 구조가 바뀜** → 그 시나리오만 `skip(사이트 변경)`으로 기록하고 다음으로 넘어간다. 전체를 실패시키지 않는다.
- **캡처가 quota·`tab.active` 가드로 거부됨** → 1회 재시도 후 `skip(환경)`. 제품 회귀로 오판하지 않는다.
- **사이트에 로그인이 필요한 화면** → 1차 대상 사이트는 전부 비로그인 접근 가능한 것만 고른다.

## 성공 기준

- `/manual-smoke` 1회 실행이 사람 개입 없이 S1~S6를 끝내고 리포트를 낸다(최초 확장 로드는 제외).
- 리포트의 각 항목이 `e2e/COVERAGE.md` 수동 잔여의 특정 줄을 인용한다.
- 같은 커밋에서 두 번 돌렸을 때 판정이 뒤집히는 항목이 없다. 뒤집히면 그 항목의 판정 기준이 잘못된 것이므로 기준을 고치거나 항목을 뺀다.
- S1(cross-origin 보강)이 **한 번이라도 양성 판정을 낸다.** 이 항목은 현재 자동 그물이 0이라 이 스킬의 존재 가치를 단독으로 증명한다.
- 실패 리포트를 보고 `/implement`·`/postmortem`으로 넘어갈 수 있을 만큼 재현 정보가 충분하다(사이트 URL·요소 셀렉터·스크린샷).

## 가이드 영향

없음 — 사용자 노출 기능이 아니다.
