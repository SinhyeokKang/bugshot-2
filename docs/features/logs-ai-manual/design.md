# logs.html AI 소비 매뉴얼 — 기술 설계

## 개요

`logs.html`의 데이터 구조·인코딩은 그대로 두고, **정적 평문 매뉴얼 한 덩어리**를 `<head>` 상단의 비활성 `<script type="text/markdown">` 태그에 박는다. 매뉴얼은 데이터 위치·디코드 레시피·각 필드 소비법을 설명한다. 기존 `__BUGSHOT_DATA__`/`__BUGSHOT_META__`가 쓰는 "템플릿에 빈 placeholder 태그 → `buildLogsHtml`이 regex로 치환" 패턴을 그대로 따른다. 뷰어(`main.tsx`)는 이 태그를 읽지 않으므로 자동으로 무시되고, `text/markdown` 타입이라 브라우저가 실행·렌더하지 않는다.

## 변경 범위

### `src/log-viewer/index.html` (템플릿)
- **현재 역할**: 뷰어 진입 HTML. 빌드 시 `dist-log-viewer/index.html`로 산출되며, `buildLogsHtml`이 이를 `?raw`로 읽어 데이터를 주입한다. `__BUGSHOT_DATA__`/`__BUGSHOT_META__` 빈 placeholder 보유.
- **변경**: `<head>`의 **첫 자식**으로 빈 placeholder 추가:
  ```html
  <script id="__BUGSHOT_AI__" type="text/markdown"></script>
  ```
  첫 자식에 두는 이유: 빌드 산출물에서 매뉴얼이 거대 JS 번들보다 앞서 위치해 AI가 파일 앞부분에서 먼저 만나게 한다(절대 첫 위치는 best-effort — vite가 번들을 head에 hoist하므로 Task에서 산출물 순서 확인). `<!doctype>` 앞에는 두지 않는다(quirks mode 위험).

### `src/sidepanel/lib/aiLogsManual.ts` (신규)
- **역할**: 매뉴얼 마크다운 본문을 담은 상수 `AI_LOGS_MANUAL: string` 1개를 export. 정적·언어 영문. 본문에 리터럴 `</script` 미포함(아래 인터페이스 설계 참조).

### `src/sidepanel/lib/buildLogsHtml.ts`
- **현재 역할**: 템플릿의 두 placeholder를 데이터로 치환.
- **변경**: `AI_LOGS_MANUAL`을 import하고, `__BUGSHOT_AI__` placeholder를 치환하는 `.replace()` 한 줄 추가. 매뉴얼은 정적(사용자 입력 무관)이지만, 기존 코드와 동일하게 함수형 replacement(`() => ...`)로 넣어 `$&` 등 특수 패턴 오해석을 원천 차단한다.

### `src/sidepanel/lib/__tests__/buildLogsHtml.test.ts`
- **변경**: 목 템플릿에 `__BUGSHOT_AI__` placeholder 추가, 매뉴얼 주입·`</script` 부재 검증 케이스 추가(아래 테스트 계획).

> `main.tsx`/`App.tsx`/`inject-issue-url.ts`/`buildCaptureFiles.ts`는 **변경 없음**. 매뉴얼은 정적이라 제출 후 치환(`injectIssueUrl`) 대상이 아니고(issueUrl 마커를 넣지 않음), 뷰어는 id로 DATA/META만 읽는다.

## 데이터 흐름

```
빌드: src/log-viewer/index.html (placeholder 3개)
   └─(pnpm build:log-viewer / vite)→ dist-log-viewer/index.html

export: buildCaptureFiles → buildLogsHtml(template ?raw)
   ├─ __BUGSHOT_DATA__ ← gzip+base64(heavy)         [기존]
   ├─ __BUGSHOT_META__ ← 평문 JSON(meta)            [기존]
   └─ __BUGSHOT_AI__   ← AI_LOGS_MANUAL (정적 평문)  [신규]
   → logs.html

소비(AI): 매뉴얼 읽기 → 레시피로 __BUGSHOT_DATA__ 디코드 → JSON 분석
소비(뷰어): main.tsx가 __BUGSHOT_DATA__/__BUGSHOT_META__만 파싱 → 매뉴얼 무시
```

매뉴얼은 정적이므로 어떤 캡처에서든 동일한 바이트가 들어간다. 데이터 복제 없음 → gzip 절감 불변.

## 인터페이스 설계

```typescript
// src/sidepanel/lib/aiLogsManual.ts
export const AI_LOGS_MANUAL: string;
```

매뉴얼 본문(영문 마크다운) 구성 — 아래 골자대로 작성한다. **리터럴 `</script`를 포함하지 않는다**(HTML script 조기 종료 방지). 데이터 참조는 "the script element with id `__BUGSHOT_DATA__`"처럼 닫는 태그 없이 쓴다.

```markdown
You are reading a BugShot debug capture (logs.html), a self-contained bug report
exported from the BugShot Chrome extension. The visible page is a human viewer;
the real data is embedded as described here. Read this first, then consume the data.

## How to read the data
All captured data is in the script element with id `__BUGSHOT_DATA__`
(type application/gzip-base64). Its text is base64-encoded gzip of a JSON object.
To read it: base64-decode the text, gunzip it, then JSON.parse the UTF-8 result.

Python:
    import re, base64, gzip, json
    html = open("logs.html", encoding="utf-8").read()
    b64 = re.search(r'id="__BUGSHOT_DATA__"[^>]*>([^<]*)', html).group(1)
    data = json.loads(gzip.decompress(base64.b64decode(b64)))

Node.js:
    const m = html.match(/id="__BUGSHOT_DATA__"[^>]*>([^<]*)/)[1];
    const zlib = require("zlib");
    const data = JSON.parse(zlib.gunzipSync(Buffer.from(m, "base64")).toString("utf8"));

A second script element with id `__BUGSHOT_META__` (type application/json) is plain
JSON, no decoding: { version, createdAt, pageUrl, issueTitle?, issueKey?, issueUrl? }.

## What's inside (decoded JSON top-level keys; any may be null)
- report  — READ THIS FIRST for bug context. The human/AI-drafted issue: title,
  environment, and sections (description / steps to reproduce / expected result /
  notes). `report.copy.markdown` is the whole thing as markdown. Tells you WHAT the bug is.
- consoleLog.entries[] — console messages: level (log/info/warn/error/debug),
  timestamp (epoch ms), args (text, may include a stack), stack?, pageUrl.
- networkLog.requests[] — requests: method, url, status, statusText, durationMs,
  startTime (epoch ms), requestHeaders, responseHeaders, requestBody?, responseBody?,
  contentType, phase (pending/complete/error). Sensitive header values are masked as
  ***[len:N]. Bodies may be objects like { kind: "truncated"|"binary"|... } when not
  inlined. WebSocket connections appear as method "WS", status 101, with a
  webSocket.frames[] array.
- actionLog.entries[] — user action timeline: kind (click/navigation/input/keypress/
  toggle/select/drag), timestamp (epoch ms), pageUrl, plus kind-specific fields
  (target/selector, fromUrl/toUrl, fieldLabel/value, ...). Reconstruct what the user did.
- video — 30s screen replay { dataUrl, startedAt, thumbnail? }. dataUrl is an MP4
  (H.264) data URL; startedAt (epoch ms) is the shared anchor to align video time with
  log timestamps. If you can process MP4, decode dataUrl; otherwise use the timeline + report.
- screenshot — static image { dataUrl } (image data URL). Decode if you support images.

All timestamps are epoch milliseconds — correlate console/network/action/video by time.
preArm: true on an entry means it was captured very early in page load.
Respond in the user's language.
```

## 기존 패턴 준수

- **placeholder + regex 치환**(`buildLogsHtml`): DATA/META와 동일 메커니즘. 함수형 replacement로 특수 치환 패턴 차단(기존 주석 규약).
- **압축/평문 분리 원칙**(`docs/types/log-viewer.ts` 주석·CLAUDE.md): heavy는 gzip, 평문은 별도 태그. 매뉴얼은 정적 평문 → 압축 blob 미접근, issueUrl 마커와 무관.
- **테스트 우선**(CLAUDE.md): 순수 함수 `buildLogsHtml` 단위 테스트 갱신. `aiLogsManual`은 상수라 불변식(`</script` 부재)만 단언.
- **주석 최소화**: `src/components/ui/` 외 주석 최소 — placeholder·치환의 WHY 한 줄만.

## 대안 검토

1. **매뉴얼을 `index.html`에 정적 하드코딩**(buildLogsHtml 미변경): 가장 적은 변경이지만, vite/viteSingleFile의 HTML 처리(`vite-plugin-singlefile`)가 `text/markdown` script 본문의 백틱·`{}`·`#` 등을 어떻게 다루는지 보장이 어렵고, 매뉴얼 텍스트를 HTML 안에 두면 편집·lint가 불편하다. → placeholder + TS 상수 주입이 내용 보존·편집성에서 우위. (채택)
2. **로그를 평문/마크다운으로 별도 직렬화해 저장**: gzip 절감을 깎고 데이터가 2벌이 된다. 사용자가 명시적으로 거부. (기각)
3. **HTML 주석 `<!-- ... -->`로 매뉴얼 삽입**: 일부 HTML 미니파이어가 주석을 제거할 수 있어 산출물에서 사라질 위험. script 태그는 보존된다. (기각)
4. **i18n 분기**: AI는 영문 매뉴얼로 충분하고 "respond in user's language" 한 줄로 출력 언어를 위임. 분기는 불필요한 복잡도. (기각)

## 위험 요소

- **빌드 시 placeholder 보존·위치**: vite가 `__BUGSHOT_AI__` 빈 script를 산출물에 유지하는지, 그리고 거대 inline 모듈 스크립트보다 앞에 두는지 확인 필요(DATA/META 빈 placeholder가 이미 유지되므로 보존 자체는 안전, 순서만 확인). 번들이 앞서더라도 head 내 조기 위치면 허용(회귀 아님).
- **`</script` 조기 종료**: 매뉴얼 본문에 리터럴 `</script`가 들어가면 태그가 깨진다. 본문 작성 규칙 + 단위 테스트로 가드. (정규식 레시피의 `[^<]*` 패턴은 `<` 직후 `script`가 아니므로 안전.)
- **스키마 드리프트**: 매뉴얼이 데이터 필드명을 기술하므로, `types/network.ts`·`console.ts`·`action.ts`·`log-viewer.ts`가 크게 바뀌면 매뉴얼도 갱신해야 한다. 핵심 키 위주로만 적어 결합도를 낮추고, 세부는 "AI가 JSON 보고 추론"에 위임. (doc-check/구현 시 인지)
- **순수 채팅 AI 한계**: gzip 해독 불가 환경에선 매뉴얼이 실행 가능한 도움을 주지 못함(상황 인지만). 이는 설계가 아닌 환경 제약 — PRD 비목표에 명시.
- **개인정보**: 새로운 캡처·수집·전송 동작 없음(기존 데이터의 인코딩/문서화만 추가). `docs/privacy.md` 갱신 트리거 아님. 단, 매뉴얼이 "복호화하면 헤더·본문이 평문으로 보인다"는 사실을 더 가시화하므로 시행일 변경 없이 현행 방침과 모순 없음 확인.
