# 콘솔 로그 가독성 개선 — 기술 설계

## 개요

URL 링크화를 (1) 순수 토크나이저 `tokenizeLogText(text)` + (2) 얇은 React 래퍼 `LinkifiedText`로 분리해 신설하고, `ConsoleLogContent`의 본문 렌더(헤더 span·본문 pre·스택 pre)와 `NetworkLogContent`의 상세 URL 필드에 적용한다. 동시에 `ConsoleLogContent`의 본문 텍스트에서 레벨 색을 제거해 심각도를 행 배경(`levelBgColor`) + 아이콘(`LevelIcon`)으로만 신호한다. 토크나이저는 순수 함수라 단위 테스트로 규칙(URL 추출·`:line:col` href 정리·후행 문장부호 트림)을 검증한다.

## 변경 범위

### 신규: `src/sidepanel/lib/linkify.ts` — 순수 토크나이저

- **역할**: 임의 텍스트를 `text`/`url` 토큰 배열로 쪼갠다. JSX 없음(순수). 테스트 대상.
- **규칙**:
  - URL 매칭: `https?://` 시작, 공백·`)`·`'`·`"`·`<`·`>`에서 종료.
  - 후행 문장부호 트림: 매치 끝의 `.,;!?` 연속을 URL에서 떼어 다음 text 토큰으로 넘긴다. (예: `visit https://react.dev/errors/185.` → url `https://react.dev/errors/185`, text `.`)
  - href 정리: 표시값(`value`)은 매치 전체를 유지하되, `href`는 끝의 `:\d+(:\d+)?`(line 또는 line:col)를 제거한다. (예: `https://h/index.js:55:27752` → value 동일, href `https://h/index.js`)
  - 매치가 없으면 단일 text 토큰 1개.

### 신규: `src/sidepanel/components/LinkifiedText.tsx` — React 래퍼

- **역할**: `tokenizeLogText`로 쪼갠 토큰을 렌더. text 토큰은 그대로, url 토큰은 `InlineLink`로. 접힌 헤더 등 클릭 가능한 행 안에서도 쓰이므로 링크 클릭은 `stopPropagation`해 행 토글을 막는다.
- **구현**: 토큰을 map해 `<>{...}</>` 반환. url 토큰은 `<InlineLink href={token.href} onClick={(e) => e.stopPropagation()}>{token.value}</InlineLink>`.

### 변경: `src/sidepanel/components/InlineLink.tsx`

- **현재 역할**: 파란 밑줄 외부 링크(`target=_blank`).
- **변경**: optional `onClick?: (e: MouseEvent) => void` prop 추가(additive). `LinkifiedText`가 `stopPropagation`을 넘기기 위함. 기존 호출부 무영향.

### 변경: `src/sidepanel/components/ConsoleLogContent.tsx`

- **현재 역할**: 콘솔 엔트리 리스트 + 필터 + 행 렌더(`EntryAccordion`). 본문을 `levelColor`로 통째 색칠.
- **변경**:
  - 헤더 본문 span(현 235~237행)의 `levelColor(entry.level)` 제거 → 기본 foreground. 텍스트를 `<LinkifiedText text={entry.args} />`로 감싼다.
  - 펼친 본문 `<pre>`(현 246~248행)의 `{entry.args}` → `<LinkifiedText text={entry.args} />`.
  - 스택 `<pre>`(현 254~256행)의 `{entry.stack}` → `<LinkifiedText text={entry.stack} />`.
  - `levelColor` 함수는 이 변경 후 유일 호출부가 사라져 고아가 되므로 **함께 제거**(내 변경이 만든 고아). `levelBgColor`·`levelCodeBg`·`LevelIcon`은 유지.
  - 모든 레벨(error/warn/info 포함) 본문이 기본색이 된다 — info의 기존 파란 텍스트도 제거(파란색은 링크색과 충돌 회피).

### 변경: `src/sidepanel/components/NetworkLogContent.tsx`

- **현재 역할**: 네트워크 요청 리스트 + 상세 패널. 상세 패널 URL을 `<dd className="break-all">{req.url}</dd>` 평문 렌더(현 473행).
- **변경**: 473행을 `<dd className="break-all"><LinkifiedText text={req.url} /></dd>`로. (접힌 행 434행의 `networkLogPath` 라벨은 토글 트리거라 미변경.)

## 데이터 흐름

순수 렌더 변경. 새 상태·메시지·스토리지 없음. `ConsoleEntry`/`NetworkRequest` 타입 변경 없음. `entry.args`·`entry.stack`·`req.url`(기존 문자열)을 입력으로 토크나이저가 토큰 배열을 만들고 React가 렌더할 뿐.

```
entry.args (string)
  → tokenizeLogText(args)  // 순수
  → [{type:'text',value}, {type:'url',value,href}, ...]
  → LinkifiedText           // InlineLink/텍스트로 렌더
```

log-viewer는 `@/sidepanel/components/ConsoleLogContent`를 그대로 재사용(`src/log-viewer/App.tsx:5,175`)하므로 사이드패널·로그 뷰어 양쪽에 자동 반영.

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

- **테스트 우선**: `tokenizeLogText`는 신규 순수 함수 → `src/sidepanel/lib/__tests__/linkify.test.ts`를 먼저 작성하고 구현(`/tdd interface` 가능).
- **shadcn/디자인 토큰**: 색은 기존 토큰(`text-blue-600 dark:text-blue-400` via `InlineLink`, `levelBgColor`)만 사용. 직접 hex 금지(DESIGN.md).
- **공유 헬퍼 컨벤션**: `logRow.ts`가 이미 Console/Network/Action 공유 헬퍼 자리. 단 linkify는 JSX를 반환하므로 순수부는 `linkify.ts`, 렌더부는 `LinkifiedText.tsx`로 분리(`logRow.ts`는 순수 문자열 헬퍼 유지).
- **외과적 변경**: action row의 `kindColor`, network의 `methodColor`는 손대지 않음.

## 대안 검토

1. **네트워크 상세 URL을 `InlineLink` 직접 사용** (LinkifiedText 안 거침): 단일 URL이라 토크나이저 불필요. 더 단순하지만 "URL 링크화는 한 경로로 공유"라는 결정과 어긋나고, 향후 상세 필드에 혼합 텍스트가 생기면 갈라진다. → 일관성 위해 `LinkifiedText`로 통일. (단일 URL 입력 시 토큰 1개라 비용 미미.)
2. **InlineLink를 항상 `stopPropagation`하도록 변경**: 호출부 무관하게 전파 차단. 그러나 action nav 링크 등 기존 동작에 영향 가능 → optional `onClick` prop으로 호출부가 선택하게 함(외과적).
3. **본문 첫 줄만 빨강 유지 / 전면 빨강 유지**: 검토했으나 사용자가 "전면색 제거(기본색)"·"좌측 바 미추가" 선택. DevTools와 가장 근접한 안 채택.

## 위험 요소

- **헤더 링크 클릭 → 행 토글 회귀**: 헤더 span은 `onClick`으로 펼침 토글. 링크에 `stopPropagation` 누락 시 클릭이 토글까지 발화. `LinkifiedText`가 항상 `stopPropagation`을 거는 것으로 방지. (e2e/수동 체크 필수.)
- **토크나이저 과탐/누락**: 스택의 `(url:line:col)` 괄호 종료, `react.dev/errors/185.`의 후행 점, 쿼리스트링(`?a=b`) 포함 URL 등 경계. 단위 테스트로 케이스 고정.
- **href의 line:col 제거 규칙 오작동**: 경로 자체에 `:8080`(포트)이 끝에 오는 비정상 입력은 거의 없지만, 규칙은 "끝의 `:\d+(:\d+)?`만" 제거라 `https://h:8080`(포트만, 경로 없음)은 포트가 깎일 수 있음 → 실사용에서 콘솔 URL은 항상 경로/파일이 뒤에 와 위험 낮음. 테스트에 포트-only 케이스를 넣어 동작을 문서화(깎임 허용 여부 명시).
- **다크모드 대비**: 기본색 본문 + 연분홍/연노랑 배경에서 가독성. 기존 토큰이라 대비 보장되나 시각 확인 권장.
- **action/network 무영향 확인**: linkify는 추가만, 기존 색 헬퍼 미변경 → action/network 행 시각 회귀 없어야 함(수동 확인).
