# 로그 표면 mono 일관화 — 기술 설계

## 개요

순수 CSS 클래스 변경이다. 6개 표면에 Tailwind `font-mono` 유틸을 붙이고, DESIGN "mono 표면 불변식(12px)"에 맞춰 크기를 `text-xs`로 정렬한다. 신규 CSS 규칙·컴포넌트·타입·i18n 키는 없다. 리거처 방어는 기존 `.font-mono` 셀렉터 리스트(`globals.css` + `log-viewer/styles.css`)가 자동으로 커버한다.

## 변경 범위

### 1. `src/sidepanel/components/JsonTreeViewer.tsx`
- **현재 역할**: 네트워크 요청/응답 JSON 본문(`NetworkLogContent.BodyBlock`)과 WebSocket JSON 프레임(`FrameBody`)을 트리로 렌더. 모든 행 `text-[13px]` sans.
- **변경**:
  - `JsonTreeViewer` 반환부의 `<JsonNode>`를 `<div className="font-mono text-xs">`로 감싼다(Provider는 DOM 노드가 없어 래퍼가 필요). `font-variant-ligatures: none`·font-size 모두 상속으로 자식 전체에 적용 — 컨테이너 한 곳에 서체+크기를 얹고 행엔 크기 클래스를 두지 않는 `DomTreeDialog`(L201)·`CssCodeMirror` 선례 패턴.
  - 행의 `text-[13px]` 5곳은 **교체가 아니라 삭제**(래퍼에서 상속 — 행 하나만 놓치는 크기 드리프트 방지). 대상: `JsonNode` 빈 컨테이너·토글 행, `ArrayChildren` more 행, `StringRow`, `PrimitiveRow`, `KeyLabel` 하위 행 컨테이너(L128, L139, L210, L239, L272).
  - 색상 토큰(`JSON_TOKEN_CLASS`)·들여쓰기(`depth*12+4`)·`ChevronDown/Right` 아이콘 크기 등 그 외는 불변.

### 2. `src/sidepanel/components/ConsoleLogContent.tsx`
- **현재 역할**: 콘솔 로그 행. 접힌 요약 메시지는 크기 클래스 없이 부모 행 컨테이너(L233 `text-[13px]`)에서 sans 13px를 상속, 펼침 `<pre>`/스택은 이미 `font-mono`.
- **변경**: `EntryAccordion` 접힌 행의 메시지 `<span>`(L243 `min-w-0 flex-1 break-all`)에 `font-mono text-xs` 추가 — 상속 13px sans를 12px mono로 오버라이드. `LinkifiedText`는 그대로 감싸짐. 아이콘·타임스탬프 칩(이미 mono)·행 배경 불변. 결과적으로 행 안에서 텍스트를 가진 노드는 메시지 span과 `LogSeekChip`(이미 자체 `font-mono text-xs`)뿐이라 **행 텍스트 전체가 12px mono로 통일**된다(LevelIcon·chevron은 아이콘 전용, 서체 무관) — 현재의 칩 12px mono vs 메시지 13px sans 불일치가 해소되는 변경. 부모 L233의 `text-[13px]`는 텍스트 상속처가 사라져 사실상 dead 앵커로 남는다(제거 여부는 외과적 변경 원칙에 따라 구현 시 판단 — 남겨도 시각 부작용 없음).

### 3. `src/sidepanel/components/ActionLogContent.tsx`
- **현재 역할**: 액션 로그 행. verb 문장 + selector/tag/value chip 조합. 콘텐츠 `<span>`은 크기 클래스 없이 부모에서 sans 13px를 상속, `leading-relaxed`.
- **변경**: `ActionRow`의 콘텐츠 `<span>`(L322 `min-w-0 flex-1 break-words leading-relaxed`)에 `font-mono text-xs` 추가 + `leading-relaxed` **제거**. verb 문장·`InlineChip`·`ResolvedTargetChip`·`InlineLink`가 모두 mono를 상속(전체 mono = 콘솔과 통일). `text-xs`가 16px line-height를 공급하므로 relaxed를 빼면 콘솔 인라인(text-xs, relaxed 없음)과 **행간까지 통일**되고 DESIGN 리스트·칩 불변식(16px)에 그대로 합류한다(세 번째 행간 발산 없음).
- `InlineChip.tsx`·`ResolvedTargetChip`은 **수정 없음** — 부모 span의 mono를 상속.

### 4. `src/log-viewer/components/TimelineMarkers.tsx`
- **현재 역할**: 로그뷰어 `ProgressBar`와 트리밍 `TrimTimeline`이 공유하는 마커 핀 + 호버 툴팁. 툴팁이 로그 내용(`labelParts`)을 `text-xs` sans로 portal 렌더.
- **변경**: 툴팁 컨테이너 `<div>`(L87)에 `font-mono` 추가. 이미 `text-xs`(12px)라 크기 변경 불필요. `labelParts`의 per-part 색상 className은 그대로.
- `markers.ts`(labelParts 생성)는 **수정 없음** — 데이터·색상 로직 불변, 서체만 컨테이너에서 얹음.

### 5. `src/sidepanel/components/NetworkLogContent.tsx` — `FrameBody`
- **현재 역할**: WebSocket 프레임 펼침 본문. JSON이면 `JsonTreeViewer`, non-JSON raw 텍스트면 `<pre className="... font-sans text-[11px]">`(L744-745). `font-sans`는 preflight의 pre→mono 리셋을 되돌리고 Geist 리거처(`------WebKitFormBoundary`의 `--` 붕괴)를 회피하려던 명시적 선택이었다.
- **변경**: L745 `<pre>`를 `font-sans text-[11px]` → `font-mono text-xs`로 교체. 형제인 `BodyBlock`의 raw body `<pre>`(L588 `font-mono text-xs`)와 동일 표면이 된다. L744 주석은 갱신/삭제(이제 mono가 의도) — 리거처는 `.font-mono`의 `font-variant-ligatures: none`이 커버하므로 `--` 붕괴 걱정 없음.
- **주의**: 크기 11→12px(`text-xs`) 동반. mono 불변식(12px) 준수 + 형제 raw body pre와 정합. JSON 프레임(JsonTreeViewer, 12px)과도 통일.

### 6. `src/sidepanel/components/NetworkLogContent.tsx` — `FrameRow` 접힘 프리뷰
- **현재 역할**: WS 프레임 리스트의 접힌 행. 요약 `<span>`(L719 `min-w-0 flex-1 truncate text-[12px]`)이 프레임 본문(`frameText`)을 그대로 프리뷰하는데 sans. 펼침 본문(§1·§5)만 mono로 바꾸면 콘솔에서 고치려던 "같은 데이터가 상태 따라 다른 서체" 갈림이 WS 쪽에 재생산된다.
- **변경**: L719 span의 `text-[12px]` → `font-mono text-xs` 교체. DESIGN이 `text-[12px]`를 금지(행간 18px 누수)하는 것과도 정합 — 단 이 span은 `truncate` 단일 행이라 행간 누수 실영향은 없던 곳이고, 크기는 12px 그대로다(서체만 전환).
- `frameText`는 open/close/truncated 이벤트의 i18n 라벨도 반환하므로 이벤트 행 라벨까지 mono가 되는데, 콘솔 인라인(메시지 전체 mono — 라벨성 텍스트 포함)과 같은 결로 수용한다. 행 컨테이너(L715 `text-[13px]`)·바이트 크기·타임스탬프 span(L720·L724)은 불변.

### 변경 없음 (확인 완료)
- **인라인 `<code>`·코드블럭**(`doc-section-body.css`·`tiptap-editor.css`): font-family 미지정 → Tailwind preflight가 `fontFamily.mono`를 공급. 이미 Geist Mono 12px. 스코프 외.
- **`globals.css` / `log-viewer/styles.css`의 `.font-mono` 규칙**: 신규 표면이 `.font-mono` 셀렉터를 타므로 리거처 규칙 자동 적용. CSS 파일 수정 불필요(`tokens.test.ts` 일치 검사도 무영향).

## 데이터 흐름

데이터·상태 흐름 변화 없음. 순수 렌더 서체 변경.

**렌더 재사용 주의**: `ConsoleLogContent`·`ActionLogContent`·`NetworkLogContent`(FrameBody 포함)는 `log-viewer/App.tsx`가 **직접 import**하고, `JsonTreeViewer`는 `NetworkLogContent`(BodyBlock·FrameBody) 경유 **전이 재사용**이다. `TimelineMarkers`는 로그뷰어 native + 사이드패널 `TrimTimeline` 공용이다. 따라서 6개 변경 모두 **사이드패널과 내보낸 `logs.html` 양쪽에 동시 반영**된다. 단 "동시"는 소스 레벨 얘기다 — `logs.html`은 `buildLogsHtml.ts`가 `dist-log-viewer/index.html?raw` **빌드 아티팩트**를 임베드하는 구조라 `build:log-viewer` 재실행 전엔 stale dist가 쓰인다(정식 `pnpm build` 계열은 선두에 자동 포함). `logs.html`엔 Geist `@font-face`가 없어 시스템 mono로 폴백(기존 mono 표면과 동일한 의도된 발산).

## 인터페이스 설계

신규/변경 타입·시그니처 없음. props·함수 시그니처 불변, className 문자열만 변경.

## 기존 패턴 준수

- **mono 표면 불변식(DESIGN §4)**: "모든 mono 표면은 12px". 신규 리스트·칩 표면은 `text-xs`(12px / line-height 16px)를 쓴다. `text-[12px]` 금지(행간 18px 누수). → JSON 트리·콘솔 인라인·액션 행·WS 접힘 프리뷰를 `text-xs`로. 마커 툴팁은 이미 `text-xs`.
- **리거처 방어**: `font-feature-settings`가 아니라 `.font-mono` 셀렉터의 `font-variant-ligatures: none`. 신규 표면은 `font-mono` 클래스만 붙이면 자동 적용(추가 규칙 불필요).
- **preflight sans 오버라이드 패턴 역전**: 원래 preflight의 `pre`→mono 리셋을 되돌려 sans로 두려던 `<pre>`는 `font-sans`를 명시했고, WS non-JSON `FrameBody`가 그 대표 사례였다. 이번 변경(Task 5)은 바로 그 결정을 **역전**한다(`font-sans`→`font-mono`). 되돌려도 `--` 리거처 붕괴가 없는 건 `.font-mono`의 `font-variant-ligatures: none`이 커버하기 때문. → 이 역전으로 DESIGN이 `FrameBody`를 "sans여야 하는 pre는 font-sans 명시"의 대표 사례로 인용한 문장이 사실오류가 되므로 Task 6에서 함께 정정한다.
- **log-viewer 손복사본**: CSS는 손대지 않으므로 `styles.css` 동기화 불필요. 컴포넌트 재사용 경로만 타므로 자동 반영.

## 대안 검토

- **대안 A: 13px 유지한 채 font-mono만 추가.** 기각 — DESIGN 불변식이 "모든 mono 표면 12px"이고, 13px mono가 섞이면 DOM 트리·콘솔 본문(12px)과 크기가 갈려 오히려 불일치를 만든다. 문서에 예외를 늘리는 비용도 크다.
- **대안 B: 액션 로그를 chip만 mono(부분 적용).** 최초 안이었으나 사용자가 "전체 mono, 콘솔과 통일"로 번복. 부분 적용은 verb/chip 경계에서 서체가 튀어 콘솔 인라인(전체 mono)과 결이 안 맞는다.
- **대안 C: JsonTreeViewer 각 행에 `font-mono` 개별 부착.** 기각 — 래퍼 `<div>` 1개로 상속시키는 편이 외과적이고 리거처 상속도 자연스럽다.
- **대안 D: 네트워크 헤더 상세·리스트 행도 함께 mono.** 사용자가 sans 유지로 결정(LNB·헤더는 UI성으로 간주). 스코프에서 제외.

## 위험 요소

- **크기 변경(13→12px) 회귀**: JSON 트리·콘솔·액션 행이 1px 작아진다. 행 높이·truncation·가로 스크롤이 미세 변동. 좁은 패널에서 오히려 밀도 개선이나, 스냅샷성 시각 검증 필요.
- **log-viewer export 시각 검증**: 시스템 mono 폴백이라 개발 중(개발자 기기 Geist 설치)엔 안 보이는 발산. `pnpm build` 후 `logs.html`을 Geist 미설치 상태에 준해 확인.
- **액션 로그 행간**: `leading-relaxed`를 제거해 `text-xs`(16px line-height)로 DESIGN 리스트·칩 불변식(16px)에 정확히 합류한다. mono 집합 안에서 세 번째 행간을 만들지 않으므로 별도 예외·각주 불필요(콘솔 인라인과 서체·행간 모두 통일). 다중 행 액션 문장은 relaxed 없이도 16px로 충분히 읽히는지 시각 확인.
- **기존 컴포넌트 테스트**: `ConsoleLogContent.test.tsx`·`NetworkLogContent.test.tsx`는 서체 className을 assert하지 않음(확인함) → 회귀 없음. `markers.test.ts`는 `buildMarkers` 데이터만 검사(툴팁 DOM 무관) → 무영향.
- **WS 프레임 본문 11→12px**: `FrameBody` non-JSON `<pre>`가 `text-[11px]` → `text-xs`로 커진다. 형제 raw body pre(12px)와 정합되지만 WS 프레임 밀도가 미세 변동 — 시각 확인.
- **DragNodeChip 절단 지점 변동**: `ActionLogContent`의 DragNodeChip(`max-w-[40%] truncate`)은 액션 로그에서 유일하게 ellipsis 절단을 쓴다. mono는 자폭이 sans의 ~1.2배라 12px로 줄여도 절단되는 글자 수가 달라진다(깨짐 아님) — drag 액션으로 수동 확인.
- **마커 툴팁 세로 확장**: `markers.ts`가 네트워크·navigation URL을 무절단 전문으로 넣으므로 mono 전환 시 같은 URL이 더 많은 줄로 감겨 툴팁이 세로로 길어지고 영상 가림 면적이 소폭 는다(`max-w-[240px]` + `break-all` + offsetWidth clamp라 가로 오버플로우는 구조적으로 안전) — 긴 URL 마커로 수동 확인.
