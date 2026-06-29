# 콘솔 로그 가독성 개선 — 기술 설계

## 개요

세 LogContent(Console/Network/Action)의 행 표현을 **"본문은 중립색, 심각도/종류는 행 배경 틴트 + 아이콘(혹은 작은 배지)으로 신호, URL은 파란 클릭 링크"** 한 패턴으로 통일한다. 실측 결과 **Network가 이미 이 패턴의 레퍼런스**다(method는 작은 배지에만 색, URL/본문은 중립). Console은 `entry.args` 전체를 레벨 색으로, Action은 navigation 행 전체를 파랑으로 칠해 어긋나 있다 — 이 둘을 Network에 맞춘다.

URL 렌더는 2층으로 공유한다: 기존 `InlineLink`(구조화된 단일 URL 슬롯)와, 그 위에 얹는 신규 순수 토크나이저 `tokenizeLogText` + 얇은 래퍼 `LinkifiedText`(URL이 박힌 자유 텍스트 — 콘솔 args/stack 전용). 토크나이저는 순수 함수라 단위 테스트로 규칙을 검증한다.

## 추상화 분석 (패턴 통일 범위)

행 렌더를 레이어로 분해하면:

| 레이어 | 공유 여부 | 비고 |
|---|---|---|
| 행 컨테이너 배경/active | **이미 공유** `syncRowClass` (`logRow.ts`) | 셋 다 사용 중 |
| 상대시간 seek 칩 | **이미 공유** `LogSeekChip`+`formatRelativeTime` | 셋 다 사용 중 |
| origin 필터 | **이미 공유** `OriginFilterBar`+`logOrigin` | 셋 다 사용 중 |
| 선두 아이콘 | 공유 안 함 (도메인별) | `LevelIcon`/`KindIcon`/network type·method — 의미가 달라 통합 불가 |
| 본문 텍스트 색 | **제거로 통일** | Network=이미 중립(무변경). Console·Action의 `levelColor`/`kindColor` 삭제 → 전부 중립 foreground |
| URL 렌더 | **신규 `LinkifiedText`** | `LinkifiedText`(자유 텍스트, 콘솔 전용)는 기존 `InlineLink` atom 위에 토크나이저를 얹은 것. action nav URL은 기존 `InlineLink` 유지. network URL은 평문 유지 |

- **통합 `<LogRow>` 컴포넌트는 만들지 않는다**: Console은 인라인 아코디언(펼침 상태·chevron·상세 패널), Network는 사이드 상세 선택, Action은 정적 행이라 상호작용 모델이 다르다. 공통 shell로 묶으면 props만 비대해져 CLAUDE.md "요청 안 한 추상화 금지"에 반한다. 공유는 이미 존재하는 작은 프리미티브 + `LinkifiedText`로 충분.
- **본문 중립화는 추상 추가가 아니라 제거**: `levelColor`/`kindColor`의 색 적용을 없애면 본문은 기본 foreground가 되고, 두 함수는 고아가 되어 삭제된다. 별도 공유 "neutral" 헬퍼 불필요.
- **URL 렌더 2층 분리 기준**: 입력이 *구조화된 단일 URL 값*(action `entry.toUrl`)이면 `InlineLink` 직접. 입력이 *URL이 섞인 자유 텍스트*(console `entry.args`/`entry.stack`)면 `LinkifiedText`. `LinkifiedText`는 내부적으로 `InlineLink`를 써서 시각·동작이 동일. (network 상세 URL은 사용자 결정으로 평문 유지 — 링크화 대상 아님.)

## 변경 범위

### 신규: `src/sidepanel/lib/linkify.ts` — 순수 토크나이저

- **역할**: 자유 텍스트를 `text`/`url` 토큰 배열로 쪼갠다. JSX 없음(순수). 테스트 대상.
- **규칙**:
  - URL 매칭: `https?://` 시작, 공백·`)`·`'`·`"`·`<`·`>`에서 종료. regex `/https?:\/\/[^\s)'"<>]+/g`.
  - 후행 문장부호 트림: 매치 끝의 `.,;!?` 연속을 URL에서 떼어 다음 text 토큰으로. (예: `... errors/185.` → url `.../errors/185`, text `.`)
  - href 정리: 표시값(`value`)은 매치 전체 유지, `href`는 끝의 `:\d+(:\d+)?`(line 또는 line:col) 제거. (예: `https://h/index.js:55:27752` → value 동일, href `https://h/index.js`)
  - 매치 없으면 단일 text 토큰 1개.

### 신규: `src/sidepanel/components/LinkifiedText.tsx` — React 래퍼 (콘솔 전용 소비)

- **역할**: `tokenizeLogText`로 쪼갠 토큰 렌더. text는 그대로, url은 `InlineLink`로. 클릭 가능한 아코디언 헤더 안에서도 쓰이므로 링크 클릭은 `stopPropagation`해 행 토글을 막는다.
- **구현**: 토큰 map. url 토큰 → `<InlineLink href={t.href} onClick={(e)=>e.stopPropagation()}>{t.value}</InlineLink>`, text 토큰 → 문자열. key는 인덱스.

### 변경: `src/sidepanel/components/InlineLink.tsx`

- **현재**: 파란 밑줄 외부 링크(`target=_blank`).
- **변경**: optional `onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void` prop 추가(additive). `LinkifiedText`의 `stopPropagation` 전달용. 기존 호출부 무영향.

### 변경: `src/sidepanel/components/ConsoleLogContent.tsx`

- **현재**: 본문을 `levelColor`로 통째 색칠.
- **변경**:
  - 헤더 본문 span(현 235~237행)의 `levelColor(entry.level)` 제거 → 기본 foreground. `{entry.args}` → `<LinkifiedText text={entry.args} />`.
  - 펼친 본문 `<pre>`(현 246~248행)·스택 `<pre>`(현 254~256행)의 텍스트 → `<LinkifiedText text=... />`.
  - 고아가 된 `levelColor` 제거. `levelBgColor`·`levelCodeBg`·`LevelIcon` 유지.
  - 모든 레벨(error/warn/info 포함) 본문이 기본색. info의 기존 파란 텍스트도 제거(링크색과 충돌 회피).
  - **info 행의 배경 틴트(`levelBgColor` blue)·`Info` 아이콘(blue)은 유지**(중립화 안 함). 본문 파랑만 빠지면 info는 파란 배경+아이콘으로 신호되고 URL만 파란 링크 — 아이콘 형태(`Info`)가 충분히 구분하므로 3중 파랑을 별도 중립화하지 않는다(사용자 결정, 변경 최소).
  - **optional 가드**: `LinkifiedText(text)`는 non-null `string` 시그니처. 본문 span은 `entry.args`(항상 string), 스택 `<pre>`는 `{entry.stack && ...}` truthy 분기(`:249`) 안에서만 호출 → `?? ""` 폴백 불요.

### 변경: `src/sidepanel/components/ActionLogContent.tsx`

- **현재**: navigation 행 전체를 `kindColor`=파랑(함수 정의 `:37`, 파란값 반환 `:38`)으로 span에 적용(`:287`). nav URL은 이미 `InlineLink`(`:121`).
- **변경**:
  - 행 span(`:287`)에서 `kindColor(entry.kind)` 제거 → 기본 foreground. nav URL은 `InlineLink` 그대로(파란 링크 유지, `data-testid`/`title` 보존).
  - 고아가 된 `kindColor` 제거. `kindBgColor`(파란 배경 틴트)·`KindIcon`(파란 MapPin) 유지 → navigation 신호는 배경+아이콘+URL 링크로.
  - **`ClickTarget`(`:60-82`)의 셀렉터 syntax highlight(tagName=sky / `type`=amber / 값=red)는 유지** — network method 배지처럼 작은 토큰 색이라 "본문 중립" 원칙과 무관. 이번엔 navigation 행 전체 `kindColor`만 제거.

### NetworkLogContent.tsx — 변경 없음

Network는 이미 레퍼런스 패턴(method 배지에만 `methodColor`, 본문/URL 중립). 상세 패널 URL은 **평문 그대로 유지**(링크화 안 함, 사용자 결정). 이번 스코프에서 손대지 않는다.

## 데이터 흐름

순수 렌더 변경. 새 상태·메시지·스토리지·타입 변경 없음. 기존 문자열(`entry.args`/`entry.stack`/`entry.toUrl`)을 입력으로 토큰화 또는 직접 링크화.

```
console: entry.args (string) → tokenizeLogText → [text|url 토큰] → LinkifiedText → InlineLink/텍스트
action : entry.toUrl (string) → InlineLink (기존, 색만 제거)
network: 변경 없음 (URL 평문 유지)
```

log-viewer는 `@/sidepanel/components/ConsoleLogContent`를 재사용(`src/log-viewer/App.tsx:5,175`)하므로 사이드패널·로그 뷰어 양쪽 자동 반영.

## 인터페이스 설계

```ts
// src/sidepanel/lib/linkify.ts
export type LogTextToken =
  | { type: "text"; value: string }
  | { type: "url"; value: string; href: string };

export function tokenizeLogText(text: string): LogTextToken[];
```

```tsx
// src/sidepanel/components/LinkifiedText.tsx
export function LinkifiedText({ text }: { text: string }): JSX.Element;
```

```tsx
// InlineLink.tsx — prop 추가 (additive)
onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
```

## 기존 패턴 준수

- **테스트 우선**: `tokenizeLogText`는 신규 순수 함수 → `src/sidepanel/lib/__tests__/linkify.test.ts` 먼저(`/tdd interface`).
- **shadcn/디자인 토큰**: 색은 기존 토큰(`InlineLink`의 `text-blue-600 dark:text-blue-400`, `*BgColor`)만. 직접 hex 금지(DESIGN.md).
- **공유 헬퍼 컨벤션**: `logRow.ts`가 이미 Console/Network/Action 공유 순수 헬퍼 자리. linkify는 JSX 반환이라 순수부 `linkify.ts` / 렌더부 `LinkifiedText.tsx`로 분리(`logRow.ts`는 순수 문자열 헬퍼 유지).
- **외과적 변경**: network `methodColor`, action의 click/input 색(이미 중립)은 미변경. 통합 컴포넌트 추출 안 함.

## 대안 검토

1. **통합 `<LogRow>` 컴포넌트 추출**: 셋의 컨테이너+seek 칩 중복을 한 shell로. 그러나 상호작용 모델(아코디언/선택/정적)이 달라 props 비대 + 과추상 → 기각. 작은 프리미티브 공유로 충분.
2. **network 상세 URL 링크화**(이전 Q3에서 검토): 단일 클린 URL이라 `InlineLink` 직접이면 충분했으나, 사용자가 평문 유지로 결정 → network 무변경.
3. **action nav를 `LinkifiedText`로 교체**: `entry.toUrl`은 구조화 단일 URL이고, 교체 시 `data-testid="action-nav-link"`/`title` 손실(e2e 의존) → 기존 `InlineLink` 유지(색만 제거).
4. **본문 첫 줄만 강조 / 전면색 유지**: 검토했으나 "전면색 제거(기본색)" 선택. DevTools 근접안 채택.

## 위험 요소

- **헤더 링크 클릭 → 행 토글 회귀**(콘솔): 헤더 span `onClick`이 펼침 토글. `LinkifiedText`가 링크에 `stopPropagation`을 거는 것으로 방지. e2e/수동 확인 필수.
- **action nav 시각 회귀**: `kindColor` 제거로 동사부가 foreground가 됨. nav URL 링크·배경·아이콘은 유지돼야 함. `data-testid="action-nav-link"` 보존 확인(e2e).
- **토크나이저 과탐/누락**: `(url:line:col)` 괄호 종료, `errors/185.` 후행 점, 쿼리스트링, 멀티 URL, 멀티라인(URL이 `\n`을 안 넘음) 경계 → 단위 테스트로 고정.
- **괄호 포함 URL 절단(의도된 트레이드오프)**: regex `[^\s)'"<>]+`가 첫 `)`에서 종료 → V8 스택 `at f (https://h/x.js:55:27)`를 정확히 자르는 게 목적이지만, `https://en.wikipedia.org/wiki/Foo_(bar)`식 괄호 URL은 `...Foo_(bar`로 잘린다. 콘솔 컨텍스트는 V8 래핑 `(url)`이 지배적이라 `)` 제외가 맞다. 이 동작을 단위 테스트로 명문화(의도된 동작).
- **href line:col 제거 규칙**: "끝의 `:\d+(:\d+)?`만" 제거라 포트-only(`https://h:8080`, 경로 없음)는 포트가 깎일 수 있음. 실사용 콘솔 URL은 항상 경로/파일이 뒤라 위험 낮음 — 포트-only 케이스를 테스트에 넣어 동작 문서화.
- **다크모드 변별력**: 다크 배경 틴트(`bg-X-950/50`)는 거의 검정이라 에러/경고/정보 *배경* 구분이 약하고 변별력은 색 입힌 **좌측 아이콘이 사실상 전담**한다(DESIGN.md의 functional color 라이트/다크 WCAG 대비 미검증 명시). → 수동 라이트/다크 체크를 **성공 기준으로 승격**(tasks). 좁은 폭·아이콘 미표시 조건에서 아이콘 가림 시 폴백 점검.
- **action click/input·network 무영향 확인**: 이번 변경은 nav 색 제거 + URL 링크화뿐 → 그 외 행 시각 회귀 없어야 함(수동 확인).
