# Custom Webhook 계약

BugShot의 **Custom Webhook** 연동은 버그 리포트를 사용자가 지정한 서버로 직접 POST한다. BugShot 서버를 거치지 않는다 — 이 문서는 그 서버를 직접 짜는 사람을 위한 것이다.

형식은 둘이고 **연동 설정의 `형식`에서 고른다**.

| | multipart | JSON 템플릿 |
|---|---|---|
| 요청 | `multipart/form-data` 단일 POST | `application/json` 단일 POST |
| 캡처 미디어 | 파일 파트로 함께 간다 | **가지 않는다** |
| 성공 판정 | 2xx **그리고** 응답의 `{key, url}` | 2xx만 |
| 응답 | 읽는다 (계약) | **읽지 않는다** (204가 정상) |
| BugShot 이슈 목록 | 행이 생긴다 | **행이 생기지 않는다** |

---

## 1. 인증

시크릿을 설정하면 매 요청에 이렇게 온다.

```
Authorization: Bearer <시크릿>
```

**서명이 아니다.** 수신 측 검증은 문자열 비교 한 줄이면 된다.

```js
if (req.headers.authorization !== `Bearer ${process.env.BUGSHOT_SECRET}`) {
  res.writeHead(401).end();
  return;
}
```

HMAC 서명을 쓰지 않는 이유는 위협 모델이 다르기 때문이다. 이 요청은 확장이 사용자의 브라우저에서 사용자가 지정한 주소로 직접 보내고, 중계 서버가 없다. 시크릿을 아는 주체와 서명 키를 아는 주체가 같은 하나(그 사용자)라서, 서명이 추가로 증명해 주는 게 없다.

시크릿은 `chrome.storage.local`에 평문으로 저장된다(8개 플랫폼 토큰과 같은 자리). 확장 설정에 접근할 수 있는 사람은 읽을 수 있다 — 그 사실을 전제로 시크릿의 권한 범위를 정하라.

**고급 설정에서 `Authorization` 헤더를 직접 정의하면 그쪽이 이긴다.** 시크릿은 무시된다(더 구체적인 의도로 본다).

### 브라우저가 못 싣는 헤더

고급 요청 헤더는 아래를 **거부한다**(저장 시점에 막는다). `fetch`가 조용히 드롭하는 이름들이라, 통과시키면 "넣었는데 안 나간다"가 된다.

```
accept-charset · accept-encoding · access-control-request-headers
access-control-request-method · connection · content-length · cookie · cookie2
date · dnt · expect · host · keep-alive · origin · referer · set-cookie
te · trailer · transfer-encoding · upgrade · via
```

여기에 더해 `Proxy-*`·`Sec-*` 접두사 전체가 막히고, 이름은 RFC 7230 token이어야 하며, 같은 이름을 대소문자만 바꿔 두 번 넣을 수 없다.

---

## 2. multipart 모드

### 파트 구성

| 파트 이름 | 내용 |
|---|---|
| `payload` | 아래 JSON 문자열 |
| *(파일명)* | 캡처 파일. 파트 이름이 곧 파일명이다 |

파일 파트의 이름은 `screenshot-1.webp`·`replay.mp4`·`logs.html`처럼 **파일명 그대로**다. 고정 이름이 아니라 그 리포트가 실제로 담은 것에 따라 달라지므로, **파트 이름을 하드코딩하지 말고 `payload.media[].part`를 읽어라.**

`Content-Type`은 확장이 지정하지 않는다 — 브라우저가 boundary를 붙인다. 고급 설정에서 `Content-Type`을 넣어도 multipart 모드에서는 제거된다(boundary 없는 요청이 나가면 수신 서버 파싱이 무음으로 실패한다).

### `payload` 스키마

```jsonc
{
  "title": "Save button does nothing on the settings page",
  // 마크다운. 미디어는 cid:<파트 이름>으로 참조한다 (§2.3)
  "body": "## Steps\n1. ...\n\n![screenshot-1.webp](cid:screenshot-1.webp)",
  "environment": [
    // 파생 행이 먼저, 사용자·자동 추가 행이 뒤에. 본문 `## 재현 환경` 섹션과 같은 출처다
    { "label": "OS", "value": "macOS 15.2" },
    { "label": "Browser", "value": "Chrome 140" },
    { "label": "Page", "value": "https://example.com/settings" },
    { "label": "DOM", "value": "#settings-form > button.save" },  // 선택된 요소가 있을 때만
    { "label": "Viewport", "value": "1440×900" },
    { "label": "Captured", "value": "2026. 01. 01. 09:00:00 GMT+9" },
    { "label": "API Hosts", "value": "api.example.com" }
  ],
  "logSummary": "console 3 · network 1 · action 12",   // 로그가 없으면 생략된다
  "media": [
    {
      "part": "screenshot-1.webp",      // multipart 파트 이름
      "filename": "screenshot-1.webp",  // 사용자에게 보일 이름 (첨부는 원본명이라 다를 수 있다)
      "contentType": "image/webp",
      "kind": "image"                   // image | video | logs | attachment | inline
    }
  ],
  "bugshot": {
    "version": "1.7.40",
    "sentAt": 1767225600000,
    "idempotencyKey": "3f0c…"           // §4
  }
}
```

`title`·`body`·`environment`·`media`·`bugshot`은 항상 있다. `logSummary`는 로그를 담지 않은 리포트에서 생략된다.

`environment`의 `label`은 파생 행만 고정 문자열(`OS`·`Browser`·`Page`·`DOM`·`Viewport`·`Captured`)이고, 값의 표기(날짜 스켈레톤 등)와 뒤따르는 커스텀 행의 라벨은 사용자가 고른 **본문 언어**를 따른다. **라벨로 찾되 순서에 기대지 말라** — 요소가 선택되지 않은 리포트엔 `DOM`이, 뷰포트를 못 읽은 리포트엔 `Viewport`가 없다.

`logSummary`는 사람이 읽는 문장이 아니라 **한 줄 카운트 요약**이다(`console`·`network`·`action` 중 담긴 것만 ` · `로 잇는다). 사람이 읽을 서술은 `body`의 `## 로그 요약` 섹션에 있다.

### `cid:` 참조

본문의 이미지·링크는 아직 URL이 없다 — 업로드와 생성이 같은 요청이라 확장이 URL을 미리 알 방법이 없다. 그래서 본문은 `cid:<파트 이름>`으로 참조하고, **수신 서버가 파일을 저장한 뒤 자기 URL로 치환한다.**

```js
let body = payload.body;
for (const m of payload.media) {
  body = body.split(`cid:${m.part}`).join(savedUrlOf(m.part));
}
```

치환하지 않아도 리포트는 읽을 수 있지만 이미지가 깨진 링크로 남는다.

### 응답 (계약)

```json
{ "key": "BUG-128", "url": "https://tracker.example.com/BUG-128" }
```

**둘 다 필수다.** 하나라도 없으면 확장은 제출을 **실패로 처리하고 리포트 원본을 그대로 남긴다** — 열 수 없는 링크가 이슈 목록에 남는 것보다 낫다고 판단했다. 2xx를 돌려주면서 본문을 비우면 사용자는 "전송했는데 실패로 나온다"를 보게 된다.

필드 이름은 몇 가지 별칭을 받는다(기존 트래커 API를 그대로 프록시하는 경우를 위해서다).

- `key` ← `key` · `id` · `number` · `iid` (숫자여도 된다. 문자열로 변환된다)
- `url` ← `url` · `html_url` · `web_url` · `link` (문자열이어야 한다)

---

## 3. JSON 템플릿 모드

Slack·Discord처럼 **스키마가 정해진 제3자 훅**으로 보낼 때 쓴다. 설정한 템플릿이 그대로 요청 바디가 된다.

```json
{ "text": "🐛 {{title}}\n{{url}}\n\n{{body}}" }
```

- 템플릿은 **유효한 JSON**이어야 하고, 저장 시점에 검사한다.
- `{{...}}`는 **문자열 리프 안에서만** 치환된다. 리프 전체가 하나의 placeholder면 타입이 보존된다(`"{{media.count}}"` → `2`).
- **캡처 미디어는 가지 않는다.** 바디에 실을 방법이 base64뿐인데 영상이 거의 항상 크기 상한을 넘긴다.
- **응답을 읽지 않는다.** 2xx면 성공이고, 그래서 **BugShot 이슈 목록에 행이 생기지 않는다.**

### 쓸 수 있는 변수

| 경로 | 값 |
|---|---|
| `{{title}}` | 리포트 제목 |
| `{{body}}` | 마크다운 본문. 미디어 자리에는 "본문에 인라인하지 못했다"는 안내가 들어가고, 로그 요약은 건수만 남는다(파일이 안 가므로 `logs.html`을 가리키지 않는다) |
| `{{url}}` | 버그가 난 페이지 주소 |
| `{{capturedAt}}` | 캡처 시각 (ISO 8601) |
| `{{logSummary}}` | 로그 요약 한 줄 |
| `{{env.os}}` `{{env.browser}}` `{{env.viewport}}` `{{env.selector}}` | 재현 환경 |
| `{{sections.<id>}}` | 본문 섹션 하나 |
| `{{media.count}}` | 리포트가 담은 캡처 파일 개수 — **이 모드에선 전송되지 않는 파일의 개수다** |
| `{{media.0.filename}}` `{{media.0.contentType}}` | N번째 캡처 파일의 메타데이터. 파일 자체는 가지 않으므로 "무엇이 찍혔는지"를 알리는 용도다. 없는 인덱스를 참조하면 제출이 실패한다 |

목록에 없는 이름은 **저장이 거부된다** — 제출 시점에 처음 알게 되는 일이 없도록.

---

## 4. 멱등 키와 중복

`payload.bugshot.idempotencyKey`는 **한 리포트에 하나**이고, 같은 리포트를 다시 보내면 같은 값이 온다. 이슈 레코드 id(`crypto.randomUUID`)를 그대로 쓴다.

이게 필요한 이유: 요청이 타임아웃되거나 확장의 service worker가 도중에 종료되면 **서버가 받았는지 알 수 있는 방법이 없다.** 그 상태에서 사용자가 다시 보내면 같은 리포트가 두 번 도착한다.

```js
const seen = new Set();                                  // 실제로는 영속 저장소에
const key = payload.bugshot.idempotencyKey;
if (seen.has(key)) return res.writeHead(200).end(JSON.stringify(prior[key]));
seen.add(key);
```

두 번째 요청에도 **첫 번째와 같은 `{key, url}`을 돌려주는 것**이 맞다(에러가 아니다).

JSON 템플릿 모드에서는 멱등 키가 전송되지 않고 템플릿 변수로도 노출되지 않는다. 타임아웃 뒤 다시 보내면 중복될 수 있으므로 수신 여부부터 확인하라. multipart 모드도 수신 서버가 이 키로 중복을 처리해야 한다 — 확장이 중복 방지를 보장하지 않는다.

---

## 5. 연결 테스트 요청

**multipart 모드**의 `연결 테스트` 버튼은 **리포트가 아닌** 작은 요청을 보낸다.

```
POST <endpoint>
Content-Type: application/json
X-BugShot-Test: 1

{"bugshot":{"test":true,"sentAt":1767225600000}}
```

`X-BugShot-Test: 1`을 보고 **저장하지 말고 2xx만 돌려주면 된다.** 이 요청에는 `payload`도 파일 파트도 없다. 타임아웃은 8초다(실제 제출은 30초).

**JSON 템플릿 모드**에서는 버튼이 `샘플 전송`으로 바뀐다. 현재 편집 중인 템플릿을 고정 예시 데이터로 채워 POST하고, `X-BugShot-Test` 헤더는 자동으로 붙이지 않는다. 실제 제출과 같은 JSON 형식이라 수신처에 **실제 메시지가 생성될 수 있다**. 현재 캡처 데이터나 미디어는 사용하지 않으며, 전송 결과는 화면의 미리보기와 같다. 2xx면 성공이고, 타임아웃은 8초·바디 상한은 제출과 같은 25MB다. 타임아웃이어도 샘플이 이미 도착했을 수 있으니 재시도 전에 확인하라.

---

## 6. 상한과 거부 규칙

| | |
|---|---|
| 요청 타임아웃 | 30초 (연결 테스트는 8초) |
| 바디 상한 | 25MB — 넘으면 **보내기 전에** 중단한다 |
| 리다이렉트 | **따라가지 않는다.** 3xx는 실패로 처리한다 — `Authorization`이 다른 호스트로 새는 걸 막는다. 최종 주소를 설정에 직접 넣어라 |
| 쿠키 | 붙지 않는다 (`credentials: "omit"`) |
| 주소 | `https`만. `http`는 사설망(loopback·RFC1918·링크로컬·IPv6 ULA·점 없는 호스트명·`.local`·`.internal`)에서만 허용하고, 그때 설정 화면에 평문 경고가 뜬다 |
| 에러 본문 | 실패 시 응답 본문 앞 8KB만 읽고, 제어·방향 전환 문자를 걷고 공백을 접어 앞 200자를 실패 안내 뒤에 덧붙인다(`수신 서버 응답: …`). 그 안에 **요청 헤더 값이나 엔드포인트 주소**(경로 전체·쿼리·20자 이상 경로 세그먼트)가 되비치면 `***`로 가린다 — 경로에 토큰을 박는 수신처(Slack·Discord)를 위해서다 |

---

## 7. 레퍼런스 수신 서버

의존성 없이 도는 최소 구현이다. `node server.mjs`로 띄우고 엔드포인트에 `http://localhost:8787/bugshot`을 넣으면 된다(사설망이라 평문 http가 허용된다).

```js
import { createServer } from "node:http";

const SECRET = process.env.BUGSHOT_SECRET ?? "dev-secret";
const seen = new Map(); // idempotencyKey → 이전 응답. 실제로는 영속 저장소에.

createServer((req, res) => {
  const reply = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? {}));
  };
  if (req.headers.authorization !== `Bearer ${SECRET}`) return reply(401, { error: "unauthorized" });
  if (req.headers["x-bugshot-test"] === "1") return reply(200, { ok: true });

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("binary");
    const boundary = /boundary=(.+)$/.exec(req.headers["content-type"] ?? "")?.[1];
    if (!boundary) return reply(415, { error: "expected multipart" });

    // payload 파트만 꺼낸다. 파일 파트는 같은 방식으로 이름(payload.media[].part)을 찾아 저장한다.
    const part = raw.split(`--${boundary}`).find((p) => p.includes('name="payload"'));
    const payloadText = part.slice(part.indexOf("\r\n\r\n") + 4).trim();
    const payload = JSON.parse(Buffer.from(payloadText, "binary").toString("utf8"));

    const key = payload.bugshot.idempotencyKey;
    if (seen.has(key)) return reply(200, seen.get(key)); // 중복: 첫 응답을 그대로 돌려준다
    const result = { key: `BUG-${seen.size + 1}`, url: `http://localhost:8787/r/${key}` };
    seen.set(key, result);

    console.log(payload.title, "·", payload.media.map((m) => m.part).join(", "));
    reply(201, result); // {key, url}이 없으면 확장이 실패로 처리한다
  });
}).listen(8787);
```

파일 파트를 실제로 저장하려면 `busboy` 같은 파서를 쓰는 편이 낫다 — 위 문자열 분해는 `payload`(텍스트)까지만 안전하다.
