# 로그 표면 mono 일관화 (Geist Mono)

## 배경

최근 Geist Mono를 패키지에 추가하고 `font-mono` 유틸을 코드 표면의 기본 서체로 전환 중이다. 현재 DOM 트리(`DomTreeDialog`)·CSS 코드뷰(`CssCodeMirror`)·프리뷰/에디터 코드블럭(preflight 경유 `pre`/`code`)·콘솔 펼침 본문·네트워크 raw body·로그 타임스탬프 칩(`LogSeekChip`)까지는 mono가 적용됐다.

그러나 로그 표면 중 **코드성 텍스트인데 아직 sans로 남은 곳**이 있어 화면 간 서체가 갈린다. 특히:
- 네트워크 로그 상세의 JSON 본문 트리(`JsonTreeViewer`) — 키·값·괄호가 코드인데 sans
- 콘솔 접힌 행의 인라인 메시지 — 펼치면 mono인데 접힌 요약은 sans (같은 데이터가 상태에 따라 다른 서체)
- 액션 로그 행 — 셀렉터·태그·입력값 등 코드성 조각이 섞인 문장이 통째로 sans
- 로그뷰어/트리밍 타임라인 마커 호버 툴팁 — 로그 내용(콘솔 메시지·네트워크 URL·액션)을 sans로 표시
- WS 접힌 프레임 프리뷰 행(`FrameRow`의 요약 `<span>`) — 프레임 본문을 그대로 프리뷰하는데 sans (콘솔 접힘 요약과 같은 "같은 데이터가 상태 따라 다른 서체" 갈림)

## 목표

코드성 로그 콘텐츠를 mono(Geist Mono)로 통일해 캡처 데이터가 어디에서 보이든 같은 서체로 읽히게 한다. 구체적으로:

1. `JsonTreeViewer`(네트워크 body + WebSocket frame 공용)를 mono로 렌더.
2. 콘솔 접힌 행 인라인 메시지를 mono로 렌더(펼침 상세와 일치).
3. 액션 로그 행 전체를 mono로 렌더(콘솔 로그와 통일).
4. 타임라인 마커 호버 툴팁(`TimelineMarkers` — 로그뷰어 `ProgressBar` + 트리밍 `TrimTimeline` 공용)을 mono로 렌더.
5. WebSocket non-JSON 프레임 본문(`FrameBody`의 raw `<pre>`)을 mono로 렌더 — JSON 프레임(JsonTreeViewer)과 같은 펼친 본문 안에서 서체가 갈리던 것을 통일.
6. WS 접힌 프레임 프리뷰 행(`FrameRow`의 요약 `<span>`)을 mono로 렌더 — 펼침 본문(5)과 접힘 프리뷰가 같은 서체로 읽히게(콘솔(2)과 같은 논리).

모든 신규 mono 표면은 DESIGN의 **mono 표면 불변식(12px)**을 지킨다. 이는 **크기 변경을 동반**한다: 현재 13px인 표면(JSON 트리·콘솔 인라인·액션 행)과 11px(WS non-JSON 본문)·`text-[12px]`(WS 접힘 프리뷰)를 전부 `text-xs`(12px)로 함께 정렬한다 — 마커 툴팁만 이미 `text-xs`. (비목표의 "레이아웃 변경 제외"는 행 배경·들여쓰기·구조를 말하며, 이 크기 정렬은 스코프 안이다.)

## 비목표 (Non-goals)

이번 스코프에서 명시적으로 제외 — 아래는 sans를 유지한다:

- **네트워크 요청 리스트 행**(method + URL path, `RequestRow`) — 좌측 LNB성 네비. 무리해서 mono 적용 안 함.
- **네트워크 HTTP 헤더 상세**(General 섹션 값 + `HeadersTable`의 헤더명·값·URL·status·content-type) — sans 유지.
- **UI 크롬** — 필터 탭·검색 인풋·`OriginFilterBar`·섹션 타이틀·빈 상태 문구·버튼·`.code-collapse-toggle` pill.
- **IssuePreview**의 제목·env 라벨/값·문단·리스트 — sans 유지(코드블럭 본문은 이미 preflight mono). env 값(URL·UA·버전)은 코드성 후보지만 네트워크 헤더 상세 sans 결정과 같은 결로 제외.
- 인라인 `<code>`·코드블럭(에디터/프리뷰) — **이미 preflight로 mono**라 변경 없음(확인만).
- 서체 외 요소(색상 토큰·레이아웃·행 배경·리거처 규칙) 변경.

## 사용자 시나리오

1. 사용자가 사이드패널 네트워크 로그 상세에서 response 탭으로 전환해 JSON 본문 트리를 보고 노드를 chevron으로 펼친다 → 키/값/괄호가 Geist Mono로 정렬되어 읽힌다(기존 sans 대비 정돈).
2. 콘솔 로그를 훑을 때 접힌 요약과 펼친 상세가 같은 mono 서체라 시선 이동 시 서체 점프가 없다.
3. 액션 로그에서 `clicked <button type="submit">` 같은 행이 mono로 렌더돼 태그·셀렉터가 코드처럼 보인다.
4. 로그뷰어(내보낸 `logs.html`)에서 영상 타임라인 마커에 호버하면 로그 내용 툴팁이 mono로 표시된다. 트리밍 다이얼로그의 타임라인에서도 동일.
5. WebSocket 메시지를 볼 때 JSON 프레임과 non-JSON 프레임(`------WebKitFormBoundary` 같은 raw 텍스트)이 같은 펼침 본문 안에서 같은 mono 서체로 읽힌다 — 기존엔 non-JSON 프레임만 sans라 한 화면 안에서 서체가 갈렸다. 이 기능에서 유일하게 *기존의 의도적 sans 결정을 되돌리는* 변경이다. 접힌 프레임 프리뷰 행도 mono라 접힘/펼침 간 서체 점프가 없다(콘솔(2)과 동일).

### 엣지 케이스
- 내보낸 `logs.html`은 별도 빌드라 Geist `@font-face`가 없어 **시스템 mono로 폴백**한다(기존 mono 표면과 동일한 의도된 발산). 개발자 기기엔 Geist가 설치돼 개발 중엔 안 보이므로 시각 검증은 export 산출물 기준.
- Geist의 리거처(`--` 붕괴)는 `.font-mono` 전역 규칙(`font-variant-ligatures: none`)이 자동 커버한다 — 신규 표면도 `font-mono` 클래스를 타므로 별도 대응 불필요.

## 성공 기준

- JsonTreeViewer·콘솔 인라인·액션 로그 행·마커 툴팁·WS non-JSON 프레임 본문·WS 접힘 프레임 프리뷰가 mono 12px로 렌더된다(사이드패널은 Geist Mono, 내보낸 `logs.html`은 시스템 mono 폴백 — 엣지 케이스 참조).
- 비목표 표면(네트워크 리스트/HTTP 헤더 상세, UI 크롬, IssuePreview env)은 서체가 그대로다.
- `pnpm test` 통과(기존 회귀 없음 + 신규 스타일 assertion).
- 라이트/다크·사이드패널/내보낸 logs.html 모두에서 시각 정합.
</invoke>
