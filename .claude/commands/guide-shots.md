---
description: guide/{ko,en}/assets 스크린샷을 Aside 브라우저로 자동 촬영·갱신. stale 탐지 후 필요한 컷만 다시 찍는다. 빌드 안 함.
---

`guide/ko/assets`·`guide/en/assets`의 스크린샷 146장(로케일당 73장)을 **실제 확장을 조작해 다시 찍는** 전용 스킬. 문서 본문은 건드리지 않는다 — 본문은 `/guide`, 이미지는 여기.

촬영 절차·합성 스펙·마스킹 표·함정·진행 상태는 전부 **`guide/SHOOTING.md`가 단일 출처**다. 이 스킬은 그 문서를 로드해 실행하는 손이고, 여기에는 **stale 판정 로직과 런타임 분기**만 둔다.

## 런타임별 종착점 (가장 먼저 판정)

**이 스킬은 Aside 세션에서만 끝까지 돈다.** 브라우저를 실제로 조작해 확장 UI를 찍는 게 본체라, 브라우저 제어가 없는 런타임에서는 시작하지 않는다.

| 런타임 | 동작 |
|---|---|
| **Aside** | 1~6단계 전부 수행 |
| **Claude Code · Codex** | **1~2단계까지만**(stale 탐지 + 리포트) 수행하고 촬영 없이 종료. "촬영은 Aside 세션에서 `/guide-shots`를 실행하라"고 안내한다 |

stale 탐지는 git 메타데이터만 보므로 어느 런타임에서든 돈다. 이 분리 덕에 CLI에서 "지금 몇 장이 낡았나"만 싸게 물어볼 수 있다.

## 사용

- `/guide-shots` — stale 탐지 후 낡은 컷만 재촬영.
- `/guide-shots check` — **탐지만** 하고 촬영 안 함. 어느 런타임에서든 동작.
- `/guide-shots all <ko|en>` — 해당 로케일 전량 재촬영.
- `/guide-shots <에셋명…>` — 지정한 컷만. 예: `/guide-shots settings-issue-4 logs-viewer-2`.
- `/guide-shots new` — 아직 실제 이미지가 없는 자리(placeholder)만.

## 절차

### 1. 전제 확인

- `guide/SHOOTING.md`를 **먼저 읽는다**(§1 상수·§2 촬영·§3 합성·§4 마스킹·§6 벽·§8 진행 상태).
- Aside 런타임이면 `chrome://extensions`에서 `chrome.developerPrivate.getExtensionsInfo`로 BugShot이 **ENABLED·UNPACKED**이고 `path`가 이 저장소 `dist`인지 확인한다.
- `dist`가 마지막 커밋보다 오래됐으면 **촬영 전에 `pnpm build`가 필요하다**고 보고하고 멈춘다. 낡은 빌드를 찍으면 새 이미지가 곧바로 stale이 된다.

### 2. stale 탐지

세 신호를 합쳐 후보를 만든다.

**(a) placeholder** — `guide/{ko,en}/assets/dummy.jpg`와 바이트가 같은 파일. 무조건 대상.

**(b) 코드가 이미지보다 새로움** — 에셋별로 "그 화면을 그리는 소스 경로"를 매핑해, 소스의 마지막 커밋 시각이 이미지의 마지막 커밋 시각보다 나중이면 후보.

```bash
img=$(git log -1 --format=%ct -- "guide/ko/assets/<name>.jpg")
src=$(git log -1 --format=%ct -- <매핑된 src 경로들>)
[ "$src" -gt "$img" ] && echo "STALE <name>"
```

매핑은 `guide/AUTHORING.md` §4 "사실 대조 소스" 표를 그대로 쓴다. 그 표가 이미 "이 화면의 진실은 어느 파일인가"의 단일 출처다. 표에 없는 화면은 아래 기본 매핑을 쓴다.

| 에셋 접두어 | 소스 경로 |
|---|---|
| `settings-*` | `src/sidepanel/tabs/Settings*`, `src/store/settings-ui-store.ts`, `src/i18n/namespaces/settings.ts` |
| `integrations-*` | `src/sidepanel/tabs/connect/`, `src/sidepanel/tabs/IssueListTab.tsx`, `IssueRow.tsx`, `statusBadges/` |
| `element-picker-*` | `src/content/picker.ts`, `src/content/element-label.ts` |
| `element-styling-*` | `src/sidepanel/tabs/StyleEditorPanel.tsx`, `src/sidepanel/tabs/styleEditor/` |
| `*-issue-*` | `src/sidepanel/tabs/DraftingPanel.tsx`, `src/store/editor-store.ts`, `src/i18n/namespaces/issue.ts` |
| `screenshot-capture-*` | `src/sidepanel/scroll-capture.ts`, `src/content/scroll-capture.ts` |
| `screenshot-annotation-*` | `src/sidepanel/components/AnnotationOverlay.tsx`, `annotation/` |
| `video-*` | `src/sidepanel/video-recorder.ts`, `30s-replay/`, `ReplayTrimDialog.tsx` |
| `logs-live-*` | `src/content/*-recorder.ts`, `src/sidepanel/components/*Log*.tsx` |
| `logs-viewer-*` | `src/log-viewer/` |

**(c) 캡션과 화면의 불일치** — `guide/{ko,en}`의 `![캡션](경로)`를 읽어, 캡션이 말하는 UI가 현재 i18n·컴포넌트에 존재하는지 확인한다. 라벨이 개명·삭제됐으면 이미지도 stale이다. 이건 자동 판정이 아니라 **눈으로 대조**하는 단계다 — 후보가 많으면 (a)(b)를 먼저 처리한다.

**리포트 형식**(`check`는 여기까지):

```
placeholder   2 : video-record-5(ko,en)
코드 최신     5 : settings-issue-4, logs-viewer-2, …
캡션 불일치   1 : element-picker-1 — "십자선"인데 현재는 …
촬영 불가     11: video-* (§6 user gesture 벽)
```

### 3. 촬영 환경 구성

`SHOOTING.md` §8 "촬영 환경 재구성 절차"를 그대로 따른다. 세 가지를 빠뜨리면 조용히 깨진다:

1. 패널을 **별도 팝업 창**으로 뺀다 — 대상 페이지와 같은 윈도우의 탭이면 `captureVisibleTab`이 실패하고 `스냅샷 없음`으로 렌더된다.
2. 촬영 직전 **`innerWidth`를 검증**한다 — `Emulation.setDeviceMetricsOverride`는 탭 전환마다 조용히 풀린다.
3. **합성용 탭에도 viewport를 건다** — 안 걸면 결과가 타일링된다.

로케일은 설정 > 일반 > 언어로 맞춘다(`settings-ui-store`에 영속).

### 4. 촬영

`SHOOTING.md` §2·§3 규칙대로 찍는다. 구도는 **패널 높이가 아니라 카드 offset으로** 잡는다(상단 60 / 중간 블리드 / 하단 60, 잘리는 변엔 곡률 0). 캡처 진입 화면과 제출 완료 화면만 패널 높이 600 고정.

**결과를 바로 레포에 쓰지 않는다.** 스테이징 디렉터리에 모으고, 각 컷을 `display()`로 눈으로 확인한 뒤 반영한다. 좌표 계산만 믿으면 "그럴듯하게 이상한" 이미지가 통과한다.

### 5. 마스킹 (공개 문서 전제)

가이드는 `bug-shot.com/{locale}/docs`로 공개 서빙된다. `SHOOTING.md` §4 마스킹 표를 **촬영 직전 DOM 텍스트 노드에** 적용한다. 새 화면에서 회사·개인 식별 문자열이 보이면 표에 추가하고 문서도 갱신한다.

영상·이미지 **픽셀 안의** 문자열은 마스킹이 불가능하다. 그런 컷은 다른 소스로 다시 만들거나 프레임을 바꿔 피한다.

### 6. 반영 · 커밋 · 문서 갱신

- `guide/{ko,en}/assets/`에 복사한다. **ko/en 파일 트리는 항상 대칭**이어야 한다(`AUTHORING.md` §8).
- 커밋 prefix는 **`docs(guide): …`**. 무엇을 왜 다시 찍었는지 본문에 남긴다.
- `SHOOTING.md` §8 진행 상태를 갱신한다. 새로 발견한 함정은 "남은 잔여 이슈"에 추가한다 — **기록하지 않으면 다음 세션이 같은 곳에서 막힌다.**

## 알려진 벽

`SHOOTING.md` §6이 단일 출처. 요약하면:

- **녹화 계열 전체**(`video-record-2~5`·`video-replay-3`·`video-issue-*`) — `tabCapture`·30초 리플레이·`getDisplayMedia` 모두 실제 user gesture를 요구해 합성 클릭으로 시작되지 않는다. **수동 촬영 전용**이니 stale로 잡혀도 자동 촬영을 시도하지 말고 리포트에만 남긴다.
- **AI 배너 컷** — Chrome 내장 AI가 `available`이 아니면 배너 자체가 안 뜬다. BYOK 키를 꽂으면 즉시 가능하지만 배지에 프로바이더명이 노출된다.
- **순간 상태 컷** — 진행률·트랜지션 화면은 sleep 없이 폴링해 프레임을 낚아채야 한다.

## 다른 스킬과의 분리

- `/guide` — 가이드 **본문** 작성·갱신. 이미지는 placeholder만 놓고 촬영은 안 함.
- `/guide-shots` ← 여기. **이미지만** 촬영·갱신. 본문은 안 건드림.
- `/push` — diff에 걸린 문서 신선도 트라이아지. 이미지 stale은 `/guide-shots check`로 위임.
