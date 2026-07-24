# Log Viewer 통합 타임라인 패널

## 배경

log-viewer는 캡처된 세션(영상 + console/network/action 로그 + 리포트)을 리뷰하는 화면이다. 현재 우측은 console/network/action이 **타입별 분리 탭**으로만 보인다. 버그를 재현하려는 개발자는 "클릭 → 네비게이션 → API 500 → console 에러"라는 **인과 사슬**을 세 탭을 번갈아 보며 타임스탬프로 손수 재조립해야 한다.

세 로그는 이미 같은 절대 ms 타임축(`ConsoleEntry.timestamp` / `NetworkRequest.startTime` / `ActionEntry.timestamp`)을 갖는다. 이걸 시간순으로 병합해 **한 줄기 스트림**으로 좌측 영상 하단에 붙이면, 영상 스크러버와 수직으로 정렬돼 "이 순간 = 이 로그"가 물리적으로 붙는다. 스크러버에는 이미 3종 통합 마커(`buildErrorMarkers` — `src/sidepanel/30s-replay/trim-markers.ts`)가 있지만 그쪽은 **error-급 이벤트만 필터한 통합**이다 — Timeline은 그와 달리 **전 이벤트**(성공 요청·info 포함)를 1행 1이벤트로 펴는 전량 스트림이고, 노이즈 제어는 패널 자체의 타입 필터·검색이 담당한다.

경쟁 제품(BetterBugs=Sentry Replay breadcrumbs, PostHog `playerInspectorLogic`, Jam.dev)이 공통으로 채택한 패턴이며, BugShot은 **서버 없이 이미 클라이언트에 있는 로그를 정렬만** 하므로 코어 밸류(클라이언트 온리)와 무충돌이다.

## 목표

- 영상이 있는 log-viewer에서, 좌측 패널을 세로 2분할해 **하단에 3종 병합 타임라인 패널**을 추가한다.
- 각 행은 1행 1이벤트 고밀도로, `console`/`network`/`action` 카테고리를 **아이콘 + 토큰 문법**으로 구분한다.
- 패널 상단 컴팩트 바에서 **타입 필터(console/network/action 토글) + 텍스트 검색**으로 병합 스트림을 좁힐 수 있다.
- 영상 재생 위치를 따라 **active 행을 강조**(좌측 스파인 레일 `muted`→`primary` — 우측 탭 재생 동기 하이라이트 `syncRowClass`와 같은 색 문법)하고 자동 스크롤한다.
- **행 전체 클릭 = 영상 seek**. console 에러는 chevron으로 스택을 인라인 확장, network는 "상세" 링크로 우측 Network 탭을 열어 해당 요청을 선택한다.
- 행 면색은 기존 로그 탭의 배경색 함수(`levelBgColor`·`rowBg` 계열)를 **그대로 재사용**(단일 출처)해 우측 탭과 완전히 일치시킨다 — console info의 blue 틴트 포함.

## 비목표 (Non-goals)

- **패널 타이틀 없음** — 상단 필터·검색 바가 곧 헤더. origin 필터는 우측 전용 탭이 담당.
- **우측 4탭(report/console/network/action) 변경 없음** — 그대로 유지. Timeline은 추가만. 우측 탭의 휴면 재생 동기 하이라이트(`activeTs`) 배선도 이번 스코프 밖(playhead 리렌더 격리와 충돌 — design.md 참조).
- **스크러버 마커 동선 변경 없음** — 마커 클릭 = 우측 탭 전환 + 해당 entry 스크롤 현행 유지. 마커는 "상세 보기" 점프, Timeline은 "재생 따라가기"로 역할 분리.
- **스크린샷·노미디어 케이스에 Timeline 추가 없음** — 영상 playhead 앵커가 없으므로 대상 외.
- **정적(비동기) 병합 리스트 없음** — Timeline의 가치는 영상 동기화. 영상 없으면 미노출.
- **재생 구간(progress) 레일 표현 없음** — 이번엔 active 1행만 강조. progress 스파인은 후속 판단.
- **행 인라인 network 상세(헤더/바디) 없음** — 무거우므로 우측 Network 탭으로 라우팅.

## 사용자 시나리오

**메인 플로우 (영상 캡처 리뷰)**
1. 영상이 있는 리포트의 log-viewer를 연다.
2. 좌측 상단에 영상, 하단에 Timeline 패널(세로 분할, 리사이저블)이 뜬다. 우측은 기존 4탭.
3. 영상을 재생하면 Timeline에서 현재 시점의 행이 좌측 스파인 레일 색(`primary`)으로 강조되고, 뷰 밖이면 자동 스크롤로 따라온다.
4. 특정 행을 클릭하면 영상이 그 시점으로 seek된다.
5. 행이 많으면 상단 바에서 타입 토글로 특정 로그만 남기거나 검색어로 좁힌다.
6. console 에러 행의 chevron을 누르면 스택이 행 아래 인라인 확장된다.
7. network 행의 "상세"를 누르면 우측 탭이 Network로 전환되고 해당 요청이 선택돼 헤더/바디/cURL을 본다.

**엣지 케이스**
- **스크린샷만 있는 리포트**: 좌측은 이미지만, Timeline 미표시. 우측 탭은 기존대로.
- **미디어 없는 리포트**: 좌측 패널 없음, 우측 탭이 풀너비(기존 동작 유지). Timeline 미표시.
- **영상 로드 실패(`videoError`)**: sync 불가 → Timeline 미표시(기존 에러 표시 유지).
- **로그가 한 종류만 있음**: 해당 종류만 시간순으로 뜬다(병합 결과가 단일 타입일 뿐).
- **로그 0건(영상은 있음)**: 패널은 유지하고 빈 문구를 표시한다(타이틀 없는 패널이 정체불명 빈 영역이 되는 것 방지).
- **필터·검색 결과 0건**: 조건 안내 빈 문구를 표시한다.
- **같은 ms에 여러 이벤트**: 안정 정렬 + 타입 우선순위(action → network → console)로 결정론적 순서.
- **영상 시간 범위 밖 로그**: 구조적으로 발생하지 않는다 — 30s Replay는 저장 시 3종 로그를 영상 범위로 트리밍(`apply-trim.ts`/`use-30s-replay.ts`의 `trimByTime`)하고, 탭/화면 녹화는 `startRecording`이 로그를 리셋해 녹화 구간만 수집한다. 남는 ms급 arm 오차는 `toVideoSeconds`의 0 클램프로 흡수.

## 성공 기준

- 영상 리포트에서 Timeline 패널이 좌하에 뜨고, 세로 분할이 리사이저블하다.
- 재생 중 active 행이 스파인 레일(`primary`)로 강조되고 자동 스크롤된다(수동 스크롤 중엔 자동 스크롤 일시 정지).
- 행 클릭 시 영상이 해당 시점으로 이동한다.
- 타입 토글·검색이 병합 스트림 전체에 적용되고, 결과 0건이면 빈 문구가 뜬다.
- console 에러 인라인 확장, network "상세" → 우측 Network 탭 선택이 동작한다.
- 행 면색이 기존 로그 탭 배경색 함수 재사용(단일 출처)으로 우측 탭과 완전히 일치한다(console info blue 포함).
- 스크린샷/노미디어 케이스에서 Timeline이 뜨지 않고 기존 레이아웃이 유지된다.
- `buildTimeline` 등 순수 함수 단위 테스트(병합·정렬·타이브레이크·필터/검색 매칭)가 통과하고, `pnpm test`·`pnpm typecheck`가 green이다. 신규 i18n 키는 ko/en 대칭 테스트를 통과한다.
- 로그 데이터 임베드(`__BUGSHOT_DATA__`)·AI 매뉴얼(`__BUGSHOT_AI__`)은 무변경 — AI readability 무영향.
