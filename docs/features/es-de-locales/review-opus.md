# es/de 번역 언어·제품 맥락 리뷰 (Opus)

- 리뷰 대상 SHA: `2205d7e0ea279930a14b2862b8017824872580fa` (dev, clean)
- 리뷰어: Claude Code, 모델 `claude-opus-5-5`(시스템 프롬프트 기준 확인). effort `medium`은 브리프 지정값이며 세션 안에서 독립적으로 검증할 수단은 없다. 서브에이전트·위임 없이 단독 수행.
- 성격: 리포트 전용. 소스 수정·빌드·커밋 없음. 저장소 쓰기는 이 파일 하나.

## 결론 요약

구조(키 대칭·placeholder 토큰)는 깨끗하지만 **기계 초안의 오역이 상당수 남아 있어 현재 상태로 출시하면 안 된다**. 의미가 뒤집히거나 우스꽝스러운 오역(P1)이 **15건(영향 키 약 60개)**, 문법·용어 불일치·라벨 형태 오류(P2)가 **47건(패턴 그룹 8 + 개별 39)**, 선택적 다듬기(P3)가 **5개 묶음(약 40항목)**이다.

대표 사례:
- ES "PAT" → **"palmadita"**(쓰다듬기). 6키
- DE 정렬 "Right" → **"Richtig"**(옳음)
- DE "Collapse" → **"Zusammenbruch"**(붕괴)
- DE ClickUp "No spaces" → **"Keine Leerzeichen"**(공백 문자 없음)
- DE "Extension" → **"Nebenstelle"**(전화 내선)
- Slack 스레드에 공개로 게시되는 문구가 ES "Archivado como problema"(문제로 보관됨)
- 이슈 본문에 나가는 로그 요약 문장의 어순이 깨져 "Red: Solicitudes 12 (errores 3)", "Netzwerk: 12-Anfragen"처럼 출력된다

## 커버리지

| 범위 | ES | DE | 방법 |
|---|---|---|---|
| `src/i18n/namespaces/ai.ts` | 29 | 29 | en/es/de 3열 전량 판독 |
| `app.ts` | 57 | 57 | 〃 |
| `common.ts` | 29 | 29 | 〃 |
| `editor.ts` | 153 | 153 | 〃 |
| `integrations.ts` | 337 | 337 | 〃 |
| `issue.ts` | 204 | 204 | 〃 |
| `logs.ts` | 127 | 127 | 〃 |
| `settings.ts` | 103 | 103 | 〃 |
| **소계** | **1039** | **1039** | |
| `src/log-viewer/i18n.ts` | 130 | 130 | 공유 96키는 스크립트로 메인 사전과 **값이 전부 일치**함을 확인(불일치 0). 그래서 메인 사전 지적이 그대로 적용된다. 독립 34키는 전량 판독 |
| `public/_locales/{es,de}/messages.json` | 4 | 4 | 전량 판독 + 글자 수 확인(EXT_DESCRIPTION 131자 ≤ 132 한도) |
| 로케일 이름·매핑 | — | — | `LOCALE_LABELS`(Español/Deutsch), `LOCALE_AI_PRESET`(Spanish/German), `BCP47`(es-ES/de-DE), `MONTH_STYLE`·`USER_GUIDE_URLS`(en 폴백) 확인. **문제 없음** |

보조 자동 점검(전 키 대상): placeholder 토큰 집합 불일치 0건, en 대문자 시작인데 es가 소문자로 시작하는 값 51건(de 0건), ES 존대 표지 휴리스틱 집계, DE `du` 사용 1건, 용어 grep(problema/Problem, Registerkarte/Tab, Serverfehler, Ficha, assignee 계열, Etikett).

맥락 확인용 호출부: `IntegrationsCta.tsx`(platform.cta.body truncate), `LogPreviewDialog.tsx`(common.detach), `IssueTab.tsx:415-437`(replay 버튼 라벨 전환), `TrimTimeline.tsx:94`(trimStart/End = 슬라이더 thumb aria-label), `DraftDetailDialog.tsx:864`(slack.promotedComment → Slack 게시), `clickup-api.ts:262`, `log-viewer/timeline-merge.ts`(HTTP method → verb), `StyleChangesTable.tsx:128`(alt 텍스트).

**공유 키 주의**: 아래 지적 중 `common.collapse`, `codeBlock.*`, `networkLog.*`, `consoleLog.*`, `actionLog.*`, `json.*`, `logViewer.seekTo`, `debug.*.empty`는 `src/log-viewer/i18n.ts`의 esDict/deDict에도 같은 값으로 들어 있다. **두 사전을 함께 고쳐야** `log-viewer/__tests__/i18n.test.ts`의 교집합 값 일치 단언이 green으로 남는다.

## P1 — 의미 오류·오해 유발·외부 노출 (반드시 수정)

| # | 언어 | 경로 / 키 | 현재 | 제안 | 근거 |
|---|---|---|---|---|---|
| 1 | ES | integrations: `github.patButton`, `github.auth.kind.pat`, `gitlab.patButton`, `gitlab.auth.kind.pat`, `asana.patButton`, `asana.auth.kind.pat` | palmadita | PAT | "pat"을 '토닥임'으로 오역. 약어라 그대로 둬야 한다(제목 `*.patDialog.title`은 이미 "Autenticación PAT") |
| 2 | ES | integrations: `clickup.patButton`, `clickup.auth.kind.pat` / `clickup.patLabel` / `notion.internalToken.button`, `notion.internalToken.label` | Ficha API / Ficha API personal / Ficha interna | Token de API / Token de API personal / Token interno | "ficha"는 게임 칩·카드라는 뜻. 같은 화면의 `notion.auth.kind.internalToken`은 이미 "Token interno"라 한 화면 안에서도 엇갈린다 |
| 3 | ES·DE | integrations `notion.internalToken.placeholder` | secreto_... / geheim_... | secret_... | 실제 토큰 접두사 리터럴이다. 번역하면 사용자가 형식을 오인한다(코드 리터럴 보존 원칙) |
| 4 | ES·DE | integrations assignee 계열 19키: `{github,gitlab,asana,clickup}.field.assignee{,.placeholder,.search,.empty}`, `linear.field.assignee{,.select,.empty}` | ES Cesionario / Seleccionar cesionario... / Buscar asignatarios / Sin cesionarios · DE Bevollmächtigter / Beauftragten auswählen... / Beauftragte suchen / Keine Beauftragten | ES Responsable / Seleccionar responsable... / Buscar responsables / Sin responsables · DE Zuständige Person / Zuständige Person auswählen... / Zuständige Personen suchen / Keine zuständigen Personen | "cesionario"(양수인)·"Bevollmächtigter"(법적 대리인)는 법률 용어다. Jira 쪽 `create.assignee`·`field.assignee.*`는 이미 Responsable/Zuständige Person이라 플랫폼마다 용어가 갈린다 |
| 5 | DE | integrations ClickUp Space 6키: `clickup.field.space`, `.space.select`, `.space.search`, `.space.empty`, `clickup.section.space`, `clickup.field.requireSpace` | Raum / Wählen Sie einen Raum aus / **Suchräume** / **Keine Leerzeichen** / **Standardspeicherplatz** / …einen Bereich aus | Space / Space auswählen / Spaces suchen / Keine Spaces / Standard-Space / Wählen Sie zuerst einen Space aus | "space"를 공백 문자·저장 공간·방으로 오역했고, 한 기능 안에서 Raum과 Bereich가 섞였다. ClickUp 고유 개념이라 원어 유지가 안전하다 |
| 6 | ES·DE | integrations `clickup.field.list.search`, `linear.field.team.search` | ES Listas de búsqueda / Equipos de búsqueda... · DE Suchlisten | ES Buscar listas / Buscar equipos... · DE Listen suchen | "검색 목록 / 검색 팀"이라는 명사구가 됐다. 동작 라벨이어야 한다 |
| 7 | DE | editor `prop.align.right`, `prop.side.right` / `prop.side.top` | Richtig / Top | Rechts / Oben | "Richtig"는 '옳은'이다. Links/Unten과 짝이 안 맞는다 |
| 8 | DE·ES | common `common.collapse`(+log-viewer), editor `dom.collapse`(DE) | DE Zusammenbruch · ES Colapso | DE Einklappen · ES Contraer | '붕괴'라는 뜻의 명사. `codeBlock.collapse`는 이미 Einklappen/Contraer다 |
| 9 | DE·ES | common `bg.error.communication` | DE Kommunikationsfehler der **Nebenstelle**. … · ES Error de comunicación de extensión. Por favor actualice la página. | DE Interner Kommunikationsfehler der Erweiterung. Bitte laden Sie die Seite neu. · ES Error de comunicación interna de la extensión. Actualiza la página. | DE "Nebenstelle"는 전화 내선이다. ES는 관사가 빠져 "확장 프로그램"으로 읽히지 않는다 |
| 10 | ES·DE | integrations `slack.promotedComment` | ES [BugShot] Archivado como problema en {platform}. · DE [BugShot] Abgelegt als Problem in {platform}. | ES [BugShot] Registrada como incidencia en {platform}. · DE [BugShot] Als Ticket in {platform} erstellt. | Slack 스레드에 **공개로 게시되는** 문구다. "Archivado"는 '보관됨', "Problem"은 앱 용어(incidencia/Ticket)와 어긋난다 |
| 11 | ES·DE | logs(본문 출력) `logSummary.network.line` | ES Red: Solicitudes {n} (errores {errors}) · DE Netzwerk: {n}-Anfragen ({errors}-Fehler) | ES Red: {n} solicitudes ({errors} errores) · DE Netzwerk: {n} Anfragen ({errors} Fehler) | **이슈 본문**(bodyLocale)에 실려 외부 트래커로 나간다. 숫자 어순이 깨지고 DE는 잘못된 하이픈 합성어가 됐다 |
| 12 | ES·DE | logs `logSummary.network.lineNoError` | ES Red: Solicitudes {n} (sin errores) · DE Netzwerk: {n}-Anfragen (keine Fehler) | ES Red: {n} solicitudes (sin errores) · DE Netzwerk: {n} Anfragen (keine Fehler) | 11과 같음 |
| 13 | ES·DE | logs `logSummary.console.line` / `.lineNoError` | ES Consola: registros de {n} (errores de {errors}, advertencias de {warns}) / Consola: registros {n} (…) · DE Konsole: {n}-Protokolle ({errors}-Fehler, {warns}-Warnungen) / {n}-Protokolle (…) | ES Consola: {n} registros ({errors} errores, {warns} advertencias) / Consola: {n} registros (sin errores ni advertencias) · DE Konsole: {n} Einträge ({errors} Fehler, {warns} Warnungen) / Konsole: {n} Einträge (keine Fehler oder Warnungen) | 11과 같음. ES는 "{n}의 기록"이라는 뜻이 된다 |
| 14 | ES·DE | logs `actionLog.verb.toggle.check` / `.toggle.uncheck` (+log-viewer) | ES Comprobado {field} / {field} sin marcar · DE Überprüft {field} / Ungeprüft {field} | ES Marcó {field} / Desmarcó {field} · DE {field} aktiviert / {field} deaktiviert | 체크박스 선택을 '검증함'으로 오역. 액션 로그는 AI 재현 단계 자동채움의 입력이라 의미가 그대로 번진다 |
| 15 | DE | issue `issueList.linear.noStates` / ai `aiRepro.loading3` | Keine **Staaten** verfügbar / **Bestellen** der Repro-Schritte | Keine Status verfügbar / Repro-Schritte ordnen | '국가', '주문(구매)'으로 오역 |

## P2 — 문법·용어 불일치·라벨 형태 (수정 권장)

### 패턴 그룹

**P2-1. ES 소문자 시작 (en은 대문자 라벨) — 51키 중 #1 palmadita 6키를 뺀 45키.** 첫 글자를 대문자로 올린다. 의미 교정이 필요한 키는 → 뒤에 따로 적었다.
`aiDraft.generate`(generar→Generar), `common.empty`(vacio→**Vacío**, 악센트 누락. 로그 뷰어 `logViewer.report.empty`는 이미 "Vacío"), `common.done`·`annotation.done`·`recovery.retry.progress.done`(hecho→Hecho), `common.verify`(verificar→Verificar), `editor.section.class`(clase→Clase), `editor.section.typography`(tipografía→Tipografía), `draft.captureArea`·`issue.capturing.method.area`(captura de área→Captura de área), `issue.capturing.method.viewport`(captura de pantalla→Captura de pantalla), `draft.envLabelPlaceholder`(campo→Campo), `prop.side.top`(arriba→Arriba), `styleTable.asIs`(tal cual→Actual. 짝인 toBe가 "Propuesto"), `annotation.ellipse`(Elipse), `annotation.pen`(bolígrafo→**Lápiz**. 그리기 도구 관용어), `annotation.color.red/yellow/blue/black`(Rojo/Amarillo/Azul/Negro), `annotation.thickness.S`(Delgado), `annotation.textSize.S`(Pequeño), `annotation.zoomOut`(alejar→Alejar), `jira.apiToken`(token API→Token de API), `webhook.secret.label`(secreto→Secreto), `webhook.format.multipart`(multiparte→Multipart), `clickup.field.space`(espacio→Espacio), `slack.field.channel`(canal→Canal), `linear.field.team`·`linear.section.team`(equipo→Equipo), `notion.auth.defaultBotName`(robot Notion→Bot de Notion), `issue.replay.trim.log.action`·`debug.tab.action`(+log-viewer `logViewer.tab.action`·`timeline.filter.action`)(acción→Acción), `issue.recording.stop`(dejar de grabar→Detener grabación), `issueList.deleteAll`(eliminar todo→Eliminar todo), `issueList.asana.status.complete`·`issueList.clickup.status.complete`(completo→Completado), `networkLog.detail.time`(tiempo→Tiempo), `networkLog.filter.font`(fuente→Fuente), `consoleLog.filter.error`(error→Error), `md.section.before`/`md.section.after`(antes/después→Antes/Después — **본문 출력 헤딩**), `settings.theme.dark`(oscuro→Oscuro), `llm.providerCustom`(personalizado→Personalizado), `llm.section.model`(modelo→Modelo).

**P2-2. DE 명령형 문장이 버튼·라벨·툴팁 자리에 들어감.** 독일어 UI 관례상 라벨은 "목적어 + 부정사"다. Sie 명령형은 안내문에만 쓴다.

| 키 | 현재 | 제안 |
|---|---|---|
| editor `editor.changesDialog.trigger` | Überprüfen Sie die Änderungen | Änderungen prüfen |
| editor `editor.changesDialog.resetRow` | Setzen Sie diese Änderung zurück | Diese Änderung zurücksetzen |
| editor `editor.revertText` | Kehren Sie zum Originaltext zurück | Originaltext wiederherstellen |
| editor `editor.revertClass` | Kehren Sie zu den ursprünglichen Klassen zurück | Ursprüngliche Klassen wiederherstellen |
| editor `draftDetail.editField.title` | Bearbeiten Sie {label} | {label} bearbeiten |
| editor `dom.repick` | Wählen Sie ein anderes Element | Anderes Element wählen |
| editor `value.showMore` | Zeige {count} weitere Token | {count} weitere Token anzeigen |
| app `platform.connectMethod.title` | Verbinden Sie {platform} | {platform} verbinden |
| integrations `github.field.labels.search`, `gitlab.field.labels.search` | Suchen Sie nach Etiketten | Labels suchen |
| integrations `linear.field.priority.select` / settings `field.priority.select` | Wählen Sie Priorität aus | Priorität auswählen |
| integrations `notion.field.property.placeholder` | Wählen Sie {name} | {name} auswählen |
| settings `field.cc.select` | Wählen Sie Benutzer für CC aus | Benutzer für CC auswählen |
| integrations `webhook.entry.editLabel` | Bearbeiten Sie Ihren benutzerdefinierten Webhook | Eigenen Webhook bearbeiten |
| issue `issue.recording.stop` | Stoppen Sie die Aufnahme | Aufnahme stoppen |
| logs `networkLog.dialog.selectRequest`(+log-viewer) | Wählen Sie eine Anfrage aus | Anfrage auswählen |
| logs `logViewer.seekTo`(+log-viewer) | Springe zu {time} | Zu {time} springen |
| settings `settings.autoReproPrefill.label`(토글 라벨) | Füllen Sie die Schritte zur Reproduktion aus | Schritte zur Reproduktion ausfüllen |
| settings `llm.onboarding.title` | Verbinden Sie ein KI-Modell | KI-Modell verbinden |
| issue `recovery.promotionBlocked` | Lösen Sie zuerst die Wiederherstellung von Anhängen | Zuerst Anhang-Wiederherstellung abschließen |

ES에도 같은 형태가 있다: `settings.autoReproPrefill.label` "Complete los pasos para reproducir" → "Completar pasos para reproducir", `llm.dialog.title` "Conecte el modelo de IA" → "Conectar modelo de IA", `llm.onboarding.title` "Conecte un modelo de IA" → "Conectar un modelo de IA", `webhook.entry.editLabel` "Edite su webhook personalizado" → "Editar webhook propio", `platform.reconnect`·`platform.connectMethod.reconnectTitle` "Vuelva a conectar {platform}" → "Reconectar {platform}".

**P2-3. DE 진행 상태 텍스트가 부정사·명사형이라 "동작 지시"로 읽힘.**
- `issue.capturing.canceling`: "Aufnahme abbrechen…" → "Aufnahme wird abgebrochen…". 현재 문구는 '취소 버튼'으로 읽힌다
- `issue.replay.encoding`: "Kodierung…" → "Wird kodiert…"
- `issue.replay.tooltip.recording`: "Aufnahme des Bildschirms…" → "Bildschirm wird aufgenommen…"
- `issue.replay.trim.encoding`: "Das Video zuschneiden" → "Video wird gekürzt"
- `issue.recording.titleTab` / `titleScreen`: "Tab aufnehmen {time}" / "Bildschirm aufnehmen {time}" → "Tab-Aufnahme {time}" / "Bildschirmaufnahme {time}"
- `aiRepro.loading1`: "Verfolgen Sie Ihre Handlungen"(사용자에게 하는 명령) → "Ihre Aktionen nachverfolgen"

`issue.replay.encoding`은 replay 버튼 안의 truncate 영역에 들어간다(`IssueTab.tsx:432`). 길이가 늘어나므로 400px 확인을 권한다.

**P2-4. ES 존대 혼용 — 판단 필요.** 휴리스틱 집계상 usted 계열 약 118키, tú 계열 약 70키가 섞여 있다. 같은 에러 계열 안에서도 갈린다. 예: `jira.error.401` "verifique sus credenciales"(usted) vs `jira.error.429` "Vuelve a intentarlo"(tú). 아래 4키는 **한 문자열 안에서** 섞여 있어 명백한 오류다.
- `asana.patDialog.body`: "Ingrese su… Puedes crear uno…" → "Introduce tu token de acceso personal de Asana. Puedes crear uno en la consola de desarrollador (My apps)."
- `clickup.patDialog.body`: "Ingrese su token API personal ClickUp. Puedes crear uno…" → "Introduce tu token de API personal de ClickUp. Puedes crear uno en Settings > Apps."
- `recovery.retry.reason.authentication`: "…su inicio de sesión expiró. Vuelva a conectarse… Aún puedes…" → "La conexión se perdió o la sesión caducó. Vuelve a conectarte en la pestaña Integraciones. Aún puedes descargar los archivos."
- `settings.replay.help`: "¿Detectar un error? Adjunte…"(부정사 의문문 + usted) → "Guarda siempre los últimos 30 segundos de tu pantalla. ¿Has visto un error? Adjunta lo que acaba de pasar como vídeo con un clic."

전체 통일 방향은 사용자 결정이다. **추천은 tú**다. Chrome의 스페인어 UI와 현대 SaaS 관례에 맞고, 최근 문맥 교정분(recovery.*, webhook 도움말)이 이미 tú다. 통일하려면 전 키를 다시 훑는 별도 패스가 필요하다. 휴리스틱에 오탐("en su lugar", 비인칭 "se puede")이 섞여 있어 이 리뷰에서 키 목록을 확정하지 않았다. `settings.contact` "Contáctenos"와 `settings.review` "Deja una reseña"는 나란히 놓인 푸터 버튼인데 존대가 갈린다. 통일 시 "Contacto"로 바꾸는 것을 권한다.

**P2-5. DE 대명사·성 일치 오류.**
- `webhook.error.timeout`: "Möglicherweise hat **es** den Bericht erhalten" → "…hat **er** den Bericht…" (der Server)
- `webhook.error.url.invalid`: "Geben Sie **es** erneut…ein" → "Geben Sie **sie** erneut…ein" (die Adresse). ES "Ingréselo" → "Ingrésela"
- `webhook.invalid.headerValue`: "Halten Sie es in einer Zeile." → "Schreiben Sie ihn in eine Zeile."
- `webhook.error.templateMissing` ES "Agregue **uno**" → "Agrega **una**" (la plantilla)
- `asana.patDialog.body` DE "Ihren persönlichen Zugangstoken Asana ein. Sie können **eine**…" → "Geben Sie Ihr persönliches Asana-Zugriffstoken ein. Sie können eines in der Entwicklerkonsole (My apps) erstellen."
- `clickup.patDialog.body` DE "Ihr persönliches API-Token ClickUp ein. Sie können **eine**…" → "Geben Sie Ihr persönliches ClickUp-API-Token ein. Sie können eines unter Settings > Apps erstellen."
- `linear.apiKeyDialog.body` DE "Ihren persönlichen API-Schlüssel Linear ein" → "Ihren persönlichen Linear-API-Schlüssel ein". ES "clave API personal Linear" → "clave de API personal de Linear"
- `editor.cssDraftUnapplied` DE "**Der** aktuelle CSS" → "**Das** aktuelle CSS"

**P2-6. "URL"·"JSON" 어순(영어 어순 직역).**

| 키 | ES 현재 → 제안 | DE 현재 → 제안 |
|---|---|---|
| `jira.workspaceUrl` | Espacio de trabajo URL → URL del espacio de trabajo | Arbeitsbereich URL → Arbeitsbereich-URL |
| `jira.workspaceUrl.invalid` | Ingrese un espacio de trabajo válido URL. → Introduce una URL de espacio de trabajo válida. | …einen gültigen Arbeitsbereich URL ein. → Geben Sie eine gültige Arbeitsbereich-URL ein. |
| `jira.error.404` | …verifique el espacio de trabajo URL o el sitio. → …revisa la URL del espacio de trabajo o el sitio. | …den Arbeitsbereich URL oder die Site. → …die Arbeitsbereich-URL oder die Site. |
| `gitlab.instanceUrl.label` | Instancia URL → URL de la instancia | Instanz URL → Instanz-URL |
| `gitlab.instanceUrl.invalid` | Introduzca una instancia válida URL. → Introduce una URL de instancia válida. | …eine gültige Instanz URL ein. → …eine gültige Instanz-URL ein. |
| `llm.error.invalidUrl` | Ingrese un URL válido. → Introduce una URL válida. | …einen gültigen URL ein. → …eine gültige URL ein. |
| `llm.error.redirect` | …Verifique la base URL. → …Revisa la URL base. | …Überprüfen Sie die Basis URL. → …die Basis-URL. |
| `llm.error.fetch` | Verifique URL y la clave API. → Revisa la URL y la clave de API. | Überprüfen Sie URL und den API-Schlüssel. → Überprüfen Sie die URL und den API-Schlüssel. |
| `webhook.error.templateMissing` | (P2-5 참고) | Die Vorlage JSON ist leer. → Die JSON-Vorlage ist leer. |
| `webhook.invalid.templateJson` | La plantilla no es válida JSON: {message} → La plantilla no es un JSON válido: {message} | Die Vorlage ist ungültig JSON: {message} → Die Vorlage ist kein gültiges JSON: {message} |

**P2-7. 이슈 용어 누수 — issue가 problema/Problem으로 번역됨.** 앱 전체는 incidencia/Ticket을 쓴다.
- ES: `recovery.retry.reason.ambiguous`("Abra el problema" → "Abre la incidencia"), `notion.internalToken.dialog.body`("crear problemas" → "crear incidencias"), `settings.attachments.help`("a un problema" → "a una incidencia"), `field.issueType.select`/`.search`/`.empty`("tipo(s) de problema(s)" → "tipo(s) de incidencia". `create.issueType`는 이미 "Tipo de incidencia")
- DE: `recovery.retry.reason.ambiguous`("Öffnen Sie das Problem" → "Öffnen Sie das Ticket"), `notion.internalToken.dialog.body`("Probleme erstellen" → "Tickets erstellen"), `settings.attachments.help`("an ein Problem" → "an ein Ticket"), `md.imageNotCopied`·`md.inlineImageNotCopied`(**복사되는 본문** "wenn Sie das Problem einreichen" → 짝인 `md.videoNotCopied`와 같은 "beim Senden des Tickets")

**P2-8. 같은 기능의 이름이 화면마다 다름.**
- 요소 캡처 모드 이름: 버튼 `issue.mode.elementShot`은 폭 때문에 ES "Capturar elem."·DE "Elementfoto"로 줄었다. 그런데 이를 인용하는 `editor.noChangeHint`는 ES "Capturar elemento"·DE „Element erfassen“이다. DE는 버튼 라벨과 아예 다른 말이라 사용자가 찾을 수 없다. 제안: DE 힌트를 „Elementfoto“로 맞춘다. ES는 "Capturar elemento" 유지(약어 원형이라 추적 가능)
- `app.iframeUnsupported.body`가 인용하는 Screenshot 모드: ES "Captura de pantalla" vs 버튼 `issue.mode.screenshot` "Captura". 제안: 본문을 "…o usa Captura." 쪽으로 맞춘다
- 30초 리플레이: **같은 버튼**(`IssueTab.tsx:432-437`)이 버퍼 상태에 따라 ES "Últimos 30 s" ↔ "Repetición de {n} s", DE "30 s Replay" ↔ "{n} s Rückblick"으로 이름이 바뀐다. 설정 `settings.replay.label`(Repetición de 30 s / 30-Sekunden-Rückblick)과 툴팁 `issue.replay.tooltip.disabled`(reproducción de 30 segundos / 30-Sekunden-Wiedergabe)까지 넷이 다 다르다. 제안: `issue.mode.replayProgress` ES "Últimos {n} s"·DE "{n} s Replay". `settings.replay.label` ES "Repetición de 30 s" 유지, DE "30-Sekunden-Replay". 툴팁 ES "Haz clic para activar la repetición de 30 s en la configuración"·DE "Klicken, um 30-Sekunden-Replay in den Einstellungen zu aktivieren"
- 웹훅 샘플 전송: DE 버튼 `webhook.test.json.button` "Probe senden"인데 도움말 `webhook.test.json.help`는 „Beispiel senden“을 인용한다 → 버튼을 "Beispiel senden"으로
- 캡처 방식 3종(DE): `issue.capturing.method.area` "Flächenerfassung", `.viewport` "Bildschirmaufnahme", `.fullPage` "Seitenerfassung", `draft.captureArea` "Flächenerfassung" → "Bereichsaufnahme" / "Bildschirmaufnahme" / "Ganzseitenaufnahme"로 '…aufnahme' 계열 통일

**P2-9. 개별 오역·어색한 직역.**

| 언어 | 키 | 현재 | 제안 | 근거 |
|---|---|---|---|---|
| ES | editor `editor.resetChanges.body` | ¿Restablecer cambios en {count}? … | ¿Restablecer {count} cambio(s)? Todos los estilos volverán a sus valores originales. | "{count} 안의 변경"이라는 뜻이 됐다 |
| ES·DE | editor `codeBlock.expand`(+log-viewer) | Ampliar (líneas {count}) · Erweitern ({count}-Zeilen) | Expandir ({count} líneas) · Ausklappen ({count} Zeilen) | 숫자 어순, 잘못된 하이픈 |
| ES | editor `value.showMore` | Mostrar {count} más tokens | Mostrar {count} tokens más | 어순 |
| ES | editor `prop.corner.all` | Todos los rincones | Todas las esquinas | rincón은 '안쪽 구석'이다. 모서리는 esquina |
| ES·DE | editor `prop.gap.column` / `prop.gap.row`(DE) | Espacio de columna · Reihenlücke / Spaltenlücke | Espacio entre columnas · Zeilenabstand / Spaltenabstand | DE "Lücke"는 '빈틈·결함'이다. CSS gap은 Abstand |
| ES·DE | editor `annotation.zoomFit` / `annotation.zoomOut`(DE) | Ancho de ajuste · Herauszoomen | Ajustar al ancho · Verkleinern(zoomIn "Vergrößern"과 짝) | ES는 '조정의 폭'이라는 명사구 |
| ES·DE | issue `alt.beforeSnapshot`/`afterSnapshot`/`*Annotated` | Antes de la instantánea… · Vor dem Schnappschuss… | Instantánea de antes / de después (anotada) · Vorher-Schnappschuss / Nachher-Schnappschuss (mit Anmerkungen) | '스냅샷 이전에'라는 시간 부사구가 됐다(alt 텍스트·스크린리더) |
| DE | issue `issueList.github.status.closedNotPlanned` | Geschlossen wie nicht geplant | Als nicht geplant geschlossen | 문법 오류(closedCompleted와 같은 구조로) |
| DE | issue `issueList.linear.cancelled` | Abgesagt | Abgebrochen | 행사 취소에 쓰는 말 |
| ES·DE | logs `json.moreItems`(+log-viewer) | … {n} más artículos · … {n} weitere Artikel | … {n} elementos más · … {n} weitere Einträge | '기사/상품'으로 오역 |
| DE | logs `actionLog.role.button`(+log-viewer) | Taste | Schaltfläche | Taste는 키보드 키다. `actionLog.verb.keypress`와 혼동된다 |
| ES·DE | logs `actionLog.verb.*`(+log-viewer) | ES Se hizo clic en / Seleccionado {value} en {field} / Arrastrado {source} · DE Gedrückt {keys} / Ausgewählte {value} in {field} | ES Hizo clic en {target} / Seleccionó {value} en {field} / Arrastró {source} · DE {keys} gedrückt / {value} in {field} ausgewählt | 같은 목록 안에서 시제·태가 섞였다(Ingresó·Navegó와 통일). DE "Ausgewählte {value}"는 형용사 변화형이다 |
| DE | logs `networkLog.display.binary`(+log-viewer) | … · Text nicht gespeichert | … · Inhalt nicht gespeichert | 바이너리 본문을 "Text"라고 부른다. 같은 계열 `bodyTruncated`·`bodyOmitted`는 Inhalt다 |
| ES | logs `logCard.networkCount`/`consoleCount` | Red {captured} (error {errors}) | Red {captured} ({errors} errores) | 어순·수 일치 |
| ES | log-viewer 독립 `networkLog.counter.captured` / issue `recovery.completed` / `recovery.retry.summary.partial` | {n} capturado / {n} completado / {n} volvió a fallar | Capturados: {n} / Completados: {n} / Fallaron de nuevo: {n} | 복수형 불일치. 라벨: 숫자 형태로 n 단복수를 피한다. DE `summary.partial`도 "Erneut fehlgeschlagen: {n}" |
| ES·DE | log-viewer 독립 `timeline.net.verb.posted` | Publicado {path} · Gepostet {path} | Enviado {path} · {path} gesendet | HTTP POST를 '게시'(SNS)로 옮겼다. DE는 나머지 verb도 "{path} abgerufen / aktualisiert / geprüft / angefordert", "Mit {path} verbunden"으로 어순을 맞춘다(현재 "Abgerufen {path}"만 영어 어순) |
| ES | integrations `webhook.error.tooLarge` | …supera el límite {limit}. Suelta el vídeo… | …supera el límite de {limit}. Quita el vídeo o algunos adjuntos. | "soltar"는 '손을 놓다'다. DE "über dem {limit}-Grenzwert. Löschen Sie…" → "überschreitet das Limit von {limit}. Entfernen Sie das Video oder einige Anhänge." |
| ES | integrations `webhook.error.url.insecurePublic` | Se bloqueó el texto sin formato http a un host público. | Se bloqueó una conexión http sin cifrar a un host público. | plaintext를 '서식 없는 텍스트'로 오역 |
| ES·DE | integrations `webhook.test.button` | Conexión de prueba · Testverbindung | Probar conexión · Verbindung testen | 버튼인데 '테스트용 연결'이라는 명사가 됐다 |
| DE | integrations `webhook.advanced.label` | Fortgeschritten | Erweitert | 숙련도 '상급'이라는 뜻이다. 설정의 Advanced는 Erweitert |
| ES·DE | integrations `webhook.secret.label` / `webhook.error.url.credentials` / `webhook.invalid.urlCredentials` | Geheimnis · das geheime Feld · ES el campo secreto | Secret · das Feld „Secret“ · ES el campo Secreto | "비밀의 필드"로 읽힌다. 필드 이름을 인용해야 한다 |
| ES | integrations `clickup.error.statusMappingFailed` | …un estado completo para esta lista. | No se encontró un estado de finalización para esta lista. | '완전한 상태'라는 뜻이 됐다 |
| ES | integrations `webhook.error.mediaUploadFailed` | …Intentar otra vez. | …Inténtalo de nuevo. | 부정사 문장 |
| ES | integrations `oauth.error.github.notConfiguredClient` | …Establecer VITE_GITHUB_CLIENT_ID. | …Establezca VITE_GITHUB_CLIENT_ID. | 형제 키 `oauth.error.notConfiguredClient`와 형태 통일 |
| DE | integrations `slack.error.notInChannel` | Du bist kein Mitglied dieses Kanals. Machen Sie mit und versuchen Sie es erneut. | Sie sind kein Mitglied dieses Kanals. Treten Sie ihm bei und versuchen Sie es erneut. | 사전 전체에서 유일한 du이고 Sie와 섞였다. "Machen Sie mit"은 '동참하세요'다 |
| ES | app `platform.oauthExpired.title` | La autenticación {platform} ha caducado | La autenticación de {platform} ha caducado | 전치사 누락 |
| DE | app `platform.reconnect` / `platform.connectMethod.reconnectTitle` | {platform} erneut anschließen | {platform} erneut verbinden | anschließen은 물리적 결선이다. 같은 계열 `platform.reconnect.title`은 verbinden이다 |
| DE | app `app.pickerUnavailable.body` | …im Chrome-Webshop… | …im Chrome Web Store… | 고유명사. Google 독일어 표기도 Chrome Web Store다 |
| ES·DE | common `common.detach` | Separar · Abtrennen | Quitar · Entfernen | 로그 첨부 토글(`LogPreviewDialog.tsx:140`)이다. '절단·분리'로 읽힌다 |
| DE | common `common.next` | Als nächstes | Weiter | 버튼 관례 |
| ES | issue `issue.sessionExpired.title` | La pagina ha cambiado | La página ha cambiado | 악센트 누락 |
| ES·DE | issue `issue.replay.trim.trimStart`/`trimEnd` | Empezar / Fin · Starten / Ende | Inicio / Fin · Anfang / Ende | 슬라이더 thumb의 aria-label(`TrimTimeline.tsx:94`)이라 동사가 아니라 명사여야 한다 |
| DE | issue `issue.replay.trim.keepTab` | Lassen Sie dieses **Feld**… geöffnet | Lassen Sie dieses Panel während des Kürzens geöffnet. Schließen oder Tabwechsel pausiert den Fortschritt. | Feld는 입력 필드다. ES "detiene" → "pausa"(EN pauses) |
| ES | issue `section.notes.help` | Contexto adicional como enlaces o fondo. | Contexto adicional, como enlaces o antecedentes. | fondo는 '배경색·바닥'이다 |
| DE | settings `settings.reorder.announce.start` | Abgeholt {label}. | {label} aufgenommen. | 택배를 '수령함'이라는 뜻(스크린리더 안내) |
| DE | settings `settings.theme` | Thema | Design | Chrome DE 설정의 테마는 "Design"이다. Thema는 '주제' |
| DE | settings `settings.replay.help` | …Einen Fehler entdecken? … | …Fehler entdeckt? Hängen Sie das Geschehene mit einem Klick als Video an. | 부정사 의문문(ES는 P2-4) |
| DE | ai `aiDraft.contextTrimmed` | Es gab viel zu besprechen, … | Es gab viel Kontext, daher wurde ein Teil weggelassen. | besprechen은 '논의하다'다 |
| DE | logs `consoleLog.filter.warn`/`debug`(+log-viewer) | Warnen / Debuggen · ES Advertir / Depurar | Warnung / Debug · ES Advertencia / Debug | 필터 칩은 로그 레벨 명사다(Error·Info와 짝) |

## P3 — 선택적 다듬기

- **DE 하이픈 합성어 누락** 7키: `{jira,github,gitlab,asana,clickup,linear,notion}.error.5xx` "Jira Serverfehler" → "Jira-Serverfehler". `*.oauth.notConfigured`·`*.notConfiguredProxy`(gitlab/asana/clickup/slack/linear/notion)도 "GitLab-OAuth-Umgebungsvariable", "Der Asana-OAuth-Token-Exchange-Proxy"처럼 묶는다(현재 "Der Token-Exchange-Proxy Asana OAuth"는 영어 어순). ES 같은 키의 "GitLab OAuth var env" → "La variable de entorno de OAuth de GitLab". 이 키들은 env 누락 빌드에서만 보여 노출이 낮다.
- **DE 용어 통일**:
  - `Erlaubnis` → `Berechtigung`(`app.permissionExpired.title`, `gitlab.selfManaged.permissionDenied`. 같은 화면 본문은 이미 Berechtigung)
  - `Registerkarte`(4키: `app.sessionSaveExhausted.body`, `recovery.retry.reason.authentication`, `issue.replay.trim.wrongTab`, `actionLog.role.tab`)와 `Tab`(6키)이 섞여 있다 → Chrome DE에 맞춰 "Tab"
  - Etikett(11키: `{github,gitlab}.field.labels*`, `linear.field.labels{,.select,.empty}`) → "Label". 같은 Linear 필드의 search만 "Labels suchen"이다
  - "Token-Bereiche"(`github.error.403`, `gitlab.error.403`, `asana.error.403`)·"Gültigkeitsbereich"(`gitlab.patDialog.body`)·"Scope"(`github.patDialog.body`)를 "Scope"로
  - `Anforderungsheader`(networkLog) vs `Anfrageheader`(webhook) → "Anfrage-Header"
  - "kürzen/zuschneiden/Trimmen"(`issue.replay.trim*`) → kürzen
  - "Eingereicht"(`issueList.filter.submitted`, `issueList.submitted`) vs 다른 곳 "gesendet" → "Gesendet"
  - Seitenleiste: UI `github/gitlab.attachmentNotInline` "Seitenbereich"와 manifest `EXT_DESCRIPTION`·`CMD_TOGGLE_PANEL` "Seitenfenster" → Chrome DE 용어 "Seitenleiste"
- **ES 용어**:
  - "clave API / token API" 25키 → "clave de API / token de API"(`jira.*`, `clickup.*`, `linear.*`, `llm.*` 일대. P2-1의 `jira.apiToken` 포함)
  - `video`(`issue.replay.encodeFailed`, `settings.replay.help`, log-viewer `timeline.empty`) vs `vídeo`(11곳) → 다수인 vídeo로(BCP47 es-ES와 일치)
  - "cuerpo/contenido"가 network body에 섞여 있다(`networkLog.display.*`, `detail.noBody`, `search`) → "cuerpo"
  - `networkLog.ws.framesCount`/`ws.empty` "fotogramas"(영상 프레임) → "frames"
  - "Por favor inténtalo" 등 쉼표 누락 11키(`bg.error.communication`, `draft.aiError`, `draft.aiParseError`, `annotation.exportError`, `notion.oauthExpired`, `oauth.error.browserContextShutDown`, `oauth.error.tokenPersist`, `oauth.error.refreshExhausted`, `oauth.error.github.refreshUnavailable`, `issue.replay.encodeFailed`, `llm.error.empty`) → "Por favor, …" 또는 "Por favor" 삭제
  - "Sólo"(악센트, RAE 비권장) → "Solo"(`gitlab/asana.oauth.notConfigured`, `*.notConfiguredProxy`)
- **로딩 문구 형태 통일**: ES `aiDraft.loading3` "Escoger…" / `aiRepro.loading3` "Ordenar…" → 나머지처럼 현재분사("Escogiendo lo que importa" / "Ordenando los pasos de reproducción"). DE 로딩 15키는 부정사구("Den Entwurf schreiben")·명사구("Verfeinerung des Wortlauts", "Überprüfung des Ergebnisses", "Anpassen der Eigenschaften")가 섞였다 → 부정사구 하나로("Wortlaut verfeinern", "Ergebnis prüfen", "Eigenschaften anpassen"). `aiStyling.loading1` "Über das Element schauen" → "Element unter die Lupe nehmen".
- **ES/DE 기타 자연스러움**:
  - `common.ok` DE "Okay" → "OK"
  - `common.loading` DE "Laden..." → "Wird geladen…"
  - `time.*Ago` ES "Hace {n}m" / DE "Vor {n}m" → "Hace {n} min" / "vor {n} Min."(h·d도 같은 식). 단위 약어 m은 미터로도 읽힌다
  - `draft.notesPlaceholder` DE "Alles andere, was es wert ist, geteilt zu werden"(영어 직역) → "Weitere erwähnenswerte Informationen"
  - `draft.descriptionPlaceholder` ES 끝 마침표 삭제(형제 placeholder와 통일)
  - `annotation.undo`·`issue.replay.trim.undo` DE "Rückgängig machen" → "Rückgängig"(툴바)
  - `editor.image.annotate` DE "Kommentieren" → "Beschriften"
  - `settings.otherSection` "Otro / Andere" → "Otros / Sonstiges"
  - `llm.error.overloaded` DE "AI-Server" → "KI-Server"
  - `recovery.reason.local-storage` DE "Der lokale Speicher ist fehlgeschlagen" → "Lokales Speichern fehlgeschlagen"
  - `attachment.limit.total` ES "del archivo adjunto" → "de los adjuntos", DE "des Anhangs" → "aller Anhänge"
  - `oauth.error.tokenPersist` DE "Beibehalten" → "Speichern", ES "conservar" → "guardar"
  - `issueList.linear.backlog` DE "Rückstand" → "Backlog"
  - `issueList.{asana,clickup}.status.complete` DE "Komplett" → "Erledigt"
  - `linear.field.priority.*` ES 성 일치(prioridad는 여성) "Ninguno/Alto/Medio/Bajo" → "Ninguna/Alta/Media/Baja"
  - `webhook.dialog.body` ES "a un servidor que ejecute" → "a un servidor propio"
  - log-viewer 독립 `timeline.empty` ES "No hay registros registrados en este rango de video." → "No hay registros en este tramo del vídeo"(중복 표현·끝 마침표, en에는 마침표가 없다)
  - `timeline.searchPlaceholder` ES → "Buscar en la línea de tiempo…"
  - `logSummary.title` ES "Resumen de registro" → "Resumen de registros"
  - `logSummary.logs.lead` ES "Se adjunta informe BugShot." → "Se adjunta el informe de BugShot."
- **의도된 축약은 지적에서 제외**: `platform.cta.body`(ES "Sin plataformas conectadas", DE "Keine Plattform verbunden")는 en("플랫폼을 추가해…")과 의미가 다르다. 하지만 커밋 `032314e5`가 400px truncate 대응으로 일부러 줄였고, 옆의 "Agregar plataforma" 버튼이 동작을 맡으므로 수용 가능하다. `issue.mode.elementShot`(Capturar elem./Elementfoto), `webhook.entry.label`, `settings.contact`/`review` DE(Kontakt/Bewerten)도 같은 이유로 유지한다.

## 문제 없음으로 판정한 영역

- 제품명·서드파티 UI 라벨(Jira/GitHub/GitLab/Linear/Notion/Asana/ClickUp/Slack, Chrome AI, OAuth, cURL, CC, Sprint), 코드·환경변수·placeholder 리터럴(`atl_xxx...`, `ghp_...`, `glpat-...`, `pk_1234...`, `lin_api_...`, `sk-...`, URL 예시)은 #3을 빼고 전부 보존됐다.
- placeholder 토큰 집합: 1039×2 + 로그 뷰어 130×2 전부 en과 일치. 단 토큰 **주변 문법**은 P1-11~13, P2-9에서 지적했다.
- recovery.\*·webhook 도움말·submit.\*·md.\* 대부분, issue 섹션 헤딩(`section.*`, `md.section.*` 중 before/after 제외), 날짜·로케일 매핑, manifest 4키(DE 용어 1건 P3 제외)는 자연스럽다.
- DE는 `slack.error.notInChannel` 한 건을 빼면 Sie로 일관된다.

## 한계

- 리뷰어는 원어민이 아닌 LLM이다. 지역 변이(ES 중남미/스페인)와 문체 선호는 판단에 편차가 있을 수 있다. 특히 P3는 취향 영역이 섞여 있다.
- 시각 잘림은 새로 주장하지 않았다. 기존 증거(`fix1-shots/` 2장, review-fix1의 Kontakt/Bewerten 해소)만 참고했다. 제안 중 길이가 늘어나는 것(P2-3 "Wird kodiert…", "Bildschirm wird aufgenommen…", P2-8 툴팁 등)은 반영 전에 400px 확인이 필요하다.
- ES 존대 집계(usted≈118/tú≈70)는 정규식 휴리스틱이라 오탐·누락이 있다. 문자열 내부 혼용 4건만 수동 확인으로 확정했다.
- 각 플랫폼의 실제 현지화 UI 문자열(Jira 스페인어판의 정확한 필드명 등)은 외부 조회 없이 일반 관례로 판단했다.
- 수정 반영 시 `src/i18n/` 편집은 PostToolUse 훅의 `locales.test.ts`가 대칭을 본다. 공유 키는 `src/log-viewer/i18n.ts`도 같이 고쳐야 `pnpm test`의 교집합 값 일치 단언이 유지된다.
