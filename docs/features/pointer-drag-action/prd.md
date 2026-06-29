# 드래그 액션 기록 (Drag Action Capture)

## 배경

액션 레코더(`src/content/action-recorder.ts`)는 click·navigation·input·keypress·toggle·select 6종만 잡는다. 드래그 앤 드롭 동작은 구조적으로 누락된다:

- 라이브러리 dnd(dnd-kit·react-beautiful-dnd 등)는 pointer/mouse 기반이고, 레코더에 pointer/mouse/drag 핸들러가 아예 없다.
- 네이티브 HTML5 드래그(`draggable=true`)는 `dragstart`/`drop`만 발화하는데 이것도 미후킹.
- 게다가 드래그는 보통 뒤따르는 `click`을 suppress하므로 click조차 안 남는다.

실제 버그 리포트에서 "콘텐츠를 드래그로 이동" 같은 재현 동선이 액션 로그에 한 줄도 안 남아, AI 재현 단계가 "콘텐츠 이동을 시도합니다" 수준으로 뭉개지고 정확한 트리거가 추정으로 남는 사례가 발생했다.

> 참고: Jam(rrweb 기반)도 드래그를 **텍스트 step으로는 안 잡는다** — 드래그 가시성을 풀 DOM 세션 리플레이로 해결한다. 이 기능은 의미 단위 "drag" step을 추가하므로 Jam의 텍스트 활동 로그보다 앞선다.

## 목표

- 드래그 앤 드롭 동작을 액션 로그에 **`drag` 종류 1건**으로 기록한다. **precision 우선** — 신뢰 가능한 신호만 자신 있게 기록한다(틀린 정보로 개발자를 오도하는 것은 침묵보다 나쁨).
- 두 캡처 경로를 커버하되, 기록 범위를 신뢰도에 맞춘다:
  1. **포인터 휴리스틱**(`pointerdown → pointermove 임계 초과 → pointerup`, 마우스·터치·펜 통합, 라이브러리 dnd 커버): **source(드래그 시작 요소)만 기록.** 드롭 지점 target은 dnd 라이브러리의 드래그 고스트/오버레이 때문에 신뢰할 수 없어 기록하지 않는다(`elementFromPoint`는 "요소 간 이동" 판정 가드로만 사용).
  2. **네이티브 HTML5 DnD**(`dragstart` + `drop`, `draggable=true` 커버): **source + target(드롭존) 기록.** `drop` 이벤트의 target은 브라우저가 정확히 셋팅하므로 신뢰 가능.
- `dragTarget` 존재 여부가 곧 신뢰 신호 — 있으면 검증된 드롭존, 없으면 포인터 경로 source-only.
- 드래그로 판정된 시퀀스 끝에 따라오는 `click`을 억제해 **drag 1건만** 남긴다(이중 기록 방지).
- 액션 로그 UI·로그 뷰어 마커·AI 재현 단계·JSON export 모두에서 drag를 일관되게 표현한다(ko·en, target 유무로 문구 분기).

## 비목표 (Non-goals)

- **포인터 경로의 드롭 target 기록** — 고스트/오버레이로 신뢰 불가. 자신 있게 틀릴 바엔 안 남긴다(precision 우선). 네이티브 DnD의 신뢰 가능한 drop target만 기록.
- 드래그 **경로(중간 좌표 스트림)** 기록 — 끝점만. (Jam식 rrweb 좌표 샘플링은 도입하지 않음.)
- 이동 **거리·방향(dx/dy)** 기록 — 이번 스코프 제외.
- 드래그 결과로 DOM이 어떻게 바뀌었는지(순서 변경 인덱스 등) 추론.
- 30s Replay·영상 캡처와의 새로운 연동.
- 텍스트 선택 드래그를 액션으로 기록(노이즈 — 명시적으로 제외).
- 취소된 드래그(드롭 실패, 페이지 밖 드롭) 기록 — 성공한 in-page 드롭만.
- 액션 레코더의 활성 조건 변경 — 기존대로 **녹화(video) 모드 전용**.

## 사용자 시나리오

### 시나리오 A — 라이브러리 dnd (포인터 휴리스틱, source-only)

1. 사용자가 녹화 모드로 캡처를 시작한다(액션 레코더 활성).
2. 페이지에서 리스트 아이템 A를 마우스로 누르고(`pointerdown`), 끌어서(`pointermove`, 시작점에서 15px 초과 이동), 다른 영역 B에 놓는다(`pointerup`).
3. 레코더가 시퀀스를 drag로 판정 → `pointerup` 지점의 `elementFromPoint`로 끝 요소가 시작 요소와 다른지(요소 간 이동) 가드 확인 → `drag` 엔트리(source=A) 1건 적재. **드롭 target은 고스트 신뢰 불가라 기록하지 않음.**
4. 뒤따르는 `click`은 억제되어 안 남는다.
5. 액션 로그에 "**A** 드래그"로 표시된다.

### 시나리오 B — 네이티브 HTML5 드래그

1. (녹화 중) 사용자가 `draggable=true` 요소 A를 끌어 드롭 영역 B에 놓는다.
2. `dragstart`에서 source(A) 보류 → `drop`에서 target(B) 확정 → `drag` 엔트리(source=A, target=B) 1건 적재 → 액션 로그에 "**A** 을(를) **B** (으)로 드래그".
3. 드롭 없이 `dragend`만 발화(취소·페이지 밖 드롭)하면 보류 source 폐기 → 기록 없음.

### 엣지 케이스

- **텍스트 선택**: `<p>`에서 텍스트를 드래그 선택 → `pointerup` 시점에 비-collapsed selection 존재 → drag로 기록하지 않음.
- **같은 요소 내 미세 드래그**(슬라이더 노브 등): target === source → 기록 안 함(슬라이더는 input 이벤트로 이미 캡처됨).
- **자체 UI 위 드래그**: source 또는 target이 picker host(`#__bugshot_picker_host`)면 기록 안 함.
- **임계 미달**: 15px 미만 이동 후 pointerup → 드래그 아님 → 기존 click 경로로 정상 기록(억제 안 함).
- **우클릭/보조 포인터 드래그**: primary 포인터(`isPrimary` + `button===0`)만 후보.

## 성공 기준

- 라이브러리 dnd 드래그 1회 → 액션 로그에 `drag` 1건(**source-only**, source 식별), click 0건.
- 네이티브 `draggable=true` 드래그 1회 → `drag` 1건(**source+target**, 드롭존 식별).
- 임계 미달 클릭은 여전히 `click`으로 기록(회귀 없음).
- 텍스트 선택·드래그팬/스크롤(in-element) → `drag` 0건.
- `drag` 종류가 액션 로그 필터 탭·아이콘·문구, 로그 뷰어 마커, AI 재현 요약, JSON export에 ko·en으로 노출.
- `pnpm test` 통과(새 순수 헬퍼 단위 테스트 포함), `pnpm typecheck` 통과(`satisfies never` 분기 모두 충족).
