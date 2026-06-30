# logs.html AI 소비 매뉴얼 — 기술 설계

## 개요

`logs.html`의 데이터 구조·인코딩은 그대로 두고, **정적 평문 매뉴얼 한 덩어리**를 `<head>`의 `<meta charset>` **바로 다음**(둘째 자식) 비활성 `<script type="text/markdown">` 태그에 박는다. 매뉴얼은 데이터 위치·디코드 레시피·각 필드 소비법을 설명한다. 메커니즘은 기존 `__BUGSHOT_DATA__`/`__BUGSHOT_META__`가 쓰는 "템플릿에 빈 placeholder 태그 → `buildLogsHtml`이 regex로 치환" 패턴을 그대로 따른다(단 위치는 다르다 — DATA/META는 `<body>`에 있고, 매뉴얼은 거대 JS 번들보다 앞서 AI가 파일 앞부분에서 먼저 만나게 하려고 head에 둔다). 뷰어(`main.tsx`)는 이 태그를 읽지 않으므로 자동으로 무시되고, `text/markdown` 타입이라 브라우저가 실행·렌더하지 않는다.

## 변경 범위

### `src/log-viewer/index.html` (템플릿)
- **현재 역할**: 뷰어 진입 HTML. 빌드 시 `dist-log-viewer/index.html`로 산출되며, `buildLogsHtml`이 이를 `?raw`로 읽어 데이터를 주입한다. `__BUGSHOT_DATA__`/`__BUGSHOT_META__` 빈 placeholder 보유.
- **변경**: `<head>`의 `<meta charset="UTF-8">` **바로 다음**(둘째 자식)에 빈 placeholder 추가:
  ```html
  <head>
    <meta charset="UTF-8" />
    <script id="__BUGSHOT_AI__" type="text/markdown"></script>
    ...
  ```
  charset **다음**에 두는 이유(중요): 매뉴얼은 수 KB라 charset 선언 **앞**에 넣으면 `<meta charset>`이 HTML5의 "head 첫 1024바이트 이내" 제약 밖으로 밀려, 비-ASCII META(한글 `issueTitle`·`pageUrl` 등) 렌더가 mojibake로 깨질 수 있다(뷰어 회귀). charset 직후면 그 위험이 없고, vite가 번들을 head 하단(title 뒤)으로 hoist하므로 매뉴얼은 여전히 번들보다 앞 → "AI가 먼저 만남" 목표 유지. `<!doctype>` 앞에는 두지 않는다(quirks mode 위험).

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
NOTE: this manual appears BEFORE the data in the file, so match the base64 by its
character set (not the first occurrence of the id) to avoid matching this recipe text.

Python:
    import re, base64, gzip, json
    html = open(PATH_TO_THE_UPLOADED_FILE, encoding="utf-8").read()
    b64 = re.search(r'id="__BUGSHOT_DATA__"[^>]*>([A-Za-z0-9+/=\s]{100,})', html).group(1)
    data = json.loads(gzip.decompress(base64.b64decode("".join(b64.split()))))

Node.js:
    const b64 = html.match(/id="__BUGSHOT_DATA__"[^>]*>([A-Za-z0-9+/=\s]{100,})/)[1];
    const zlib = require("zlib");
    const data = JSON.parse(zlib.gunzipSync(Buffer.from(b64, "base64")).toString("utf8"));

If you have no code-execution environment, ask the user to run the snippet above on
the file and paste back the decoded JSON.

A second script element with id `__BUGSHOT_META__` (type application/json) is plain
JSON, no decoding: { version, createdAt, pageUrl, issueTitle?, issueKey?, issueUrl? }.
createdAt is an ISO 8601 string (NOT epoch ms). issueKey/issueUrl are present and
non-empty only if the bug was filed to a tracker (Jira/GitHub/etc.); empty string "" otherwise.

## What's inside (decoded JSON top-level keys; any may be null)
- report  — READ THIS FIRST for bug context. The human/AI-drafted issue: title,
  env (array of { label, value }), and sections (array of { id, label, renderAs, value };
  enabled sections only, so they vary — e.g. description / steps to reproduce / expected
  result / notes). report.copy.markdown is the whole thing as one markdown string — if
  parsing the structure is awkward, just read report.copy.markdown. Tells you WHAT the bug is.
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

Each log (consoleLog/networkLog/actionLog) also has totalSeen vs captured and
networkLog.warnings (e.g. MEMORY_CAPPED, BODY_TRUNCATED, ENTRY_CAPPED, WS_FRAMES_CAPPED).
If captured < totalSeen or warnings are present, the log is partial/truncated — say so
and avoid concluding from absence of an entry.

All log timestamps are epoch milliseconds — correlate console/network/action/video by time.
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

- **레시피 self-match (해소됨, 회귀 주의)**: 매뉴얼은 데이터(`<body>`)보다 **앞(`<head>`)**에 있고 본문에 레시피 텍스트(`id="__BUGSHOT_DATA__"...`)를 리터럴로 포함한다. 첫 매치(`re.search`/`String.match`)를 쓰면 진짜 태그가 아니라 매뉴얼 내 레시피 텍스트를 잡아 디코드가 실패한다. → 레시피는 **base64 문자셋 앵커**(`([A-Za-z0-9+/=\s]{100,})`)로 캡처해 매뉴얼 내 비-base64 occurrence를 자동 스킵한다. **검증은 빈 placeholder 목이 아니라 실제 매뉴얼 포함 logs.html에서 레시피를 실행해야 잡힌다**(Task 6 / 성공 기준).
- **빌드 시 placeholder 보존·위치**: vite가 `__BUGSHOT_AI__` 빈 script를 산출물에 유지하는지(DATA/META 빈 placeholder가 이미 유지되므로 보존 자체는 안전), 그리고 `<meta charset>` 뒤·번들보다 앞에 남는지 확인. **dist-log-viewer 미재빌드 시 매뉴얼이 조용히 빠진다**(`buildLogsHtml`이 `?raw`로 읽는 템플릿이 구버전이면 placeholder 부재 → `.replace()` no-op, 에러 없음). build 게이트 + Task 3 산출물 확인으로 가드.
- **charset 1024바이트**: 매뉴얼을 `<meta charset>` 앞에 두면 charset이 head 첫 1024B 밖으로 밀려 비-ASCII META가 깨질 수 있음 → charset **다음**에 배치(변경 범위·개요 참조).
- **`</script` 조기 종료 + escape 부재**: `buildLogsHtml`은 meta JSON만 `<`→`<` escape하고(line 41) **매뉴얼은 함수형 replacement로 원문 그대로 주입한다**(escape 없음). 매뉴얼 본문에 `<`는 있으나(레시피 등) HTML script는 `</script`만 종료 트리거라 무해. 유일한 가드는 "본문에 리터럴 `</script` 없음" — 단위 테스트(대소문자 무시)로 강제.
- **TS 리터럴 이스케이프**: 매뉴얼을 백틱 템플릿 리터럴로 작성하면 본문의 백틱·`${`가 깨진다. 현재 레시피는 들여쓰기 코드블록(펜스·`${` 없음)이라 안전하나 작성 시 주의.
- **스키마 드리프트**: 매뉴얼이 데이터 필드명을 기술하므로, `types/network.ts`·`console.ts`·`action.ts`·`log-viewer.ts`가 크게 바뀌면 매뉴얼도 갱신해야 한다. 핵심 키 위주로만 적어 결합도를 낮추고, 세부는 "AI가 JSON 보고 추론"에 위임. (doc-check/구현 시 인지)
- **순수 채팅 AI 한계**: gzip 해독 불가 환경에선 매뉴얼이 직접 실행은 못 함. 단 매뉴얼 말미 fallback("실행 환경 없으면 사용자에게 one-liner를 돌려 결과를 붙여달라 요청")으로 *간접 실행 경로*를 연다 — 이는 "gzip을 풀 수 있게 만든다"는 비목표를 깨지 않는 사용자 위임이다.
- **개인정보**: 새로운 캡처·수집·전송 동작 없음(기존 데이터의 인코딩/문서화만 추가). `docs/privacy.md` 갱신 트리거 아님. 단, 매뉴얼이 "복호화하면 헤더·본문이 평문으로 보인다"는 사실을 더 가시화하므로 시행일 변경 없이 현행 방침과 모순 없음 확인.
