const ko = {
  // Common
  "common.ok": "확인",
  "common.close": "닫기",
  "common.cancel": "취소",
  "common.back": "이전",
  "common.loading": "불러오는 중...",
  "common.empty": "비어 있음",
  "common.actions": "동작",
  "common.deselect": "선택 해제",
  "common.untitled": "(제목 없음)",
  "common.next": "다음",
  "common.done": "완료",
  "common.reset": "초기화",
  "common.submit": "제출",
  "common.verify": "검증",
  "common.delete": "삭제",

  // App tabs
  "app.tab.issue": "이슈 작성",
  "app.tab.issueList": "이슈 목록",
  "app.tab.settings": "Jira 연동",
  "app.tab.appSettings": "앱 설정",
  "app.unsupported.title": "이 페이지에서는 사용할 수 없습니다",
  "app.unsupported.body": "웹 페이지(http, https, file)에서 BugShot을 실행해주세요.",
  "app.oauthExpired.title": "Jira 인증이 만료되었습니다",
  "app.oauthExpired.body": "Jira 연동을 다시 설정해주세요.",

  // Issue sections (shared across drafting/preview/detail)
  "section.issueTitle": "이슈 제목",
  "section.env": "재현 환경",
  "section.description": "발생 현상",
  "section.media": "미디어",
  "section.styleChanges": "스타일 변경사항",
  "section.expectedResult": "기대 결과",

  // Issue tab
  "issue.unsupported": "지원하지 않는 페이지",
  "issue.empty.title": "캡처 방식을 선택하세요",
  "issue.mode.element": "DOM 요소 선택",
  "issue.mode.screenshot": "화면 캡처",
  "issue.mode.video": "영상 녹화",
  "issue.picking.title": "요소를 선택하세요",
  "issue.capturing.title": "캡처 영역을 선택하세요",
  "issue.recording.title": "녹화 중 {time}",
  "issue.recording.stop": "녹화 완료",
  "issue.sessionExpired.title": "페이지가 갱신되었습니다",
  "issue.sessionExpired.body": "작성 중인 내용이 초기화됩니다.",

  // Jira (shared)
  "jira.submitted": "이슈가 제출되었습니다",
  "jira.submit": "이슈 제출",
  "jira.notConnected.title": "Jira가 연결되어 있지 않습니다",
  "jira.notConnected.body": "Jira 이슈를 생성하시려면, 연동 탭에서 Jira를 먼저 연결해주세요.",
  "jira.connectFirst": "설정 탭에서 Jira를 먼저 연결하세요",

  // Style editor
  "editor.resetChanges": "변경사항 초기화",
  "editor.resetChanges.body": "{count}건의 변경사항을 초기화하시겠습니까? 모든 스타일이 원래 값으로 돌아갑니다.",
  "editor.textPlaceholder": "요소 텍스트",
  "editor.revertText": "원본 텍스트로 되돌리기",
  "editor.revertClass": "원본 class로 되돌리기",
  "editor.revertSection": "이 섹션 인라인 원복",

  // Style prop editors
  "prop.editIndividual": "개별 편집",
  "prop.editTogether": "일괄 편집",
  "prop.align.left": "왼쪽",
  "prop.align.center": "가운데",
  "prop.align.right": "오른쪽",
  "prop.align.justify": "양쪽",
  "prop.side.top": "위",
  "prop.side.right": "오른쪽",
  "prop.side.bottom": "아래",
  "prop.side.left": "왼쪽",
  "prop.corner.topLeft": "좌상단",
  "prop.corner.topRight": "우상단",
  "prop.corner.bottomRight": "우하단",
  "prop.corner.bottomLeft": "좌하단",
  "prop.gap.row": "row gap",
  "prop.gap.column": "column gap",

  // Value combobox
  "value.placeholder": "값 직접 입력 또는 토큰 검색",
  "value.reset": "원래 값 (reset)",
  "value.unset": "값 해제 (unset)",
  "value.manualInput": "직접 입력",
  "value.noMatch": "매칭 없음",
  "value.showMore": "다른 토큰 {count}개 더 보기",
  "value.otherTokens": "기타 토큰",

  // DOM tree
  "dom.parent": "부모 요소",
  "dom.child": "첫 자식 요소",
  "dom.repick": "다시 선택",
  "dom.dialogTitle": "DOM 선택",
  "dom.loading": "DOM 트리를 불러오는 중...",
  "dom.error": "DOM 트리를 불러오지 못했습니다.",
  "dom.collapse": "접기",
  "dom.expand": "펼치기",

  // Drafting panel
  "draft.titlePlaceholder": "이슈 제목",
  "draft.bodyPlaceholder": "재현 경로, 기대 동작 등 추가 설명",
  "draft.expectedResultPlaceholder": "수정 후 기대되는 동작 / 디자인 기준 등",
  "draft.removeAnnotation": "주석 제거",
  "draft.editAnnotation": "주석 수정",
  "draft.addAnnotation": "주석 추가",
  "draft.preview": "이슈 프리뷰",

  // Preview panel
  "preview.copied": "복사됨",
  "preview.copyMarkdown": "마크다운 복사",
  "preview.newIssue": "다른 이슈 작성",

  // Issue create modal
  "create.issueType": "이슈 타입",
  "create.assignee": "담당자",
  "create.priority": "우선순위",
  "create.parentEpic": "부모 에픽",
  "create.linkedIssue": "연결 이슈",

  // Field combobox
  "field.issueType.select": "이슈 타입 선택",
  "field.issueType.search": "이슈 타입 검색...",
  "field.issueType.empty": "일치하는 이슈 타입이 없습니다.",
  "field.priority.select": "우선순위 선택",
  "field.priority.search": "우선순위 검색...",
  "field.priority.empty": "일치하는 우선순위가 없습니다.",
  "field.priority.label": "우선순위",
  "field.assignee.select": "담당자 선택",
  "field.assignee.search": "이름으로 검색...",
  "field.assignee.empty": "일치하는 사용자가 없습니다.",
  "field.assignee.label": "담당자",
  "field.epic.select": "이슈 선택 (선택사항)",
  "field.epic.search": "이슈 검색...",
  "field.epic.empty": "일치하는 이슈가 없습니다.",
  "field.epic.label": "이슈 목록",

  // Issue list
  "issueList.empty": "등록한 이슈가 없습니다",
  "issueList.deleteAll": "모두 삭제",
  "issueList.deleteAll.title": "모든 이슈를 삭제할까요?",
  "issueList.deleteAll.body": "Bugshot의 이슈 목록만 삭제되며, Jira에 등록된 이슈는 영향받지 않습니다.",
  "issueList.refresh": "목록 새로고침",
  "issueList.draft": "초안",
  "issueList.deleteDraft.title": "초안을 삭제할까요?",
  "issueList.deleteDraft.body": "삭제된 초안은 복구할 수 없습니다.",
  "issueList.deleteIssue": "이슈 삭제",
  "issueList.unknown": "알 수 없음",

  // Time
  "time.justNow": "방금",
  "time.minutesAgo": "{n}분 전",
  "time.hoursAgo": "{n}시간 전",
  "time.daysAgo": "{n}일 전",

  // Settings
  "settings.jiraConnection": "Jira 연결",
  "settings.project": "프로젝트",
  "settings.issueSettings": "이슈 설정",
  "settings.defaultIssueType": "기본 이슈 타입",
  "settings.noJiraSites": "접근 가능한 Jira 사이트가 없습니다.",
  "settings.onboarding.title": "Jira 연결",
  "settings.onboarding.body": "Atlassian 계정 또는 API Token을 이용해 Jira와 연동해 주세요.",
  "settings.selectSite": "연결할 사이트를 선택하세요",
  "settings.atlassianLogin": "Atlassian 로그인",
  "settings.apiKeyDialog.title": "API Token 인증",
  "settings.apiKeyDialog.body": "Jira 워크스페이스 URL과 인증 정보를 입력하세요.",
  "settings.workspaceUrl": "워크스페이스 URL",
  "settings.email": "이메일",
  "settings.apiToken": "API 토큰",
  "settings.getToken": "발급 페이지",
  "settings.oauthError.noJira.title": "Jira가 존재하지 않는 계정입니다.",
  "settings.oauthError.noJira.body": "계정을 변경하여 재시도해주세요.",
  "settings.switchAccount": "계정 전환",
  "settings.projectDialog.title": "프로젝트 선택",
  "settings.projectDialog.body": "이슈를 생성할 프로젝트를 선택하세요.",
  "settings.projectDialog.label": "프로젝트",
  "settings.titlePrefix": "제목 Prefix",
  "settings.titlePrefix.help": "이슈 제목 앞에 자동으로 붙습니다. 비워두면 사용하지 않습니다.",
  "settings.connected": "Jira에 정상적으로 연결되었습니다.",
  "settings.disconnect": "Jira 연결 해제",
  "settings.disconnect.title": "Jira 연결을 해제할까요?",
  "settings.disconnect.body": "인증 정보와 프로젝트 설정이 모두 초기화됩니다. 다시 연결하려면 재인증이 필요합니다.",
  "settings.disconnect.confirm": "연결 해제",

  // App settings
  "appSettings.theme": "테마",
  "appSettings.language": "언어",
  "appSettings.theme.light": "라이트",
  "appSettings.theme.dark": "다크",
  "appSettings.theme.system": "시스템",

  // Draft detail
  "draftDetail.title": "초안 검토",

  // IssueType combobox (settings)
  "issueType.selectProjectFirst": "프로젝트를 먼저 선택하세요",

  // Project combobox
  "project.select": "프로젝트 선택",
  "project.search": "프로젝트 검색...",
  "project.empty": "일치하는 프로젝트가 없습니다.",

  // Cancel confirm dialog
  "cancelConfirm.trigger": "작성 취소",
  "cancelConfirm.title": "작성을 취소할까요?",
  "cancelConfirm.body": "작성 중인 내용이 모두 초기화됩니다.",

  // Annotation overlay
  "annotation.cancel": "취소",
  "annotation.done": "주석 완료",

  // Style changes table
  "styleTable.snapshot": "스냅샷",
  "styleTable.noChanges": "변경 사항이 없습니다.",

  // Build issue markdown / ADF
  "md.section.env": "재현 환경",
  "md.section.description": "발생 현상",
  "md.section.media": "미디어",
  "md.section.styleChanges": "스타일 변경사항",
  "md.section.expectedResult": "기대 결과",
  "md.videoAttached": "(첨부 영상 참조)",
  "md.imageAttached": "(첨부 이미지 참조)",
  "md.column.property": "속성",
  "md.noValue": "(없음)",

  // Background errors
  "bg.error.network": "네트워크 연결을 확인하세요. Jira 서버에 접근할 수 없습니다.",
  "bg.error.communication": "확장 프로그램 내부 통신 오류. 페이지를 새로고침해주세요.",
  "bg.error.unknown": "알 수 없는 오류가 발생했습니다.",

  // Jira API errors
  "jira.error.401": "인증 실패: 자격 증명을 확인하세요.",
  "jira.error.403": "권한 없음: 계정 권한을 확인하세요.",
  "jira.error.404": "찾을 수 없음: workspace URL 또는 사이트를 확인하세요.",
  "jira.error.429": "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
  "jira.error.5xx": "Jira 서버 오류. 잠시 후 다시 시도하세요.",
  "jira.error.generic": "Jira 요청 실패 ({status})",

  // OAuth errors
  "oauth.error.notConfiguredClient": "Atlassian OAuth 앱이 설정되지 않았습니다. VITE_ATLASSIAN_CLIENT_ID 환경 변수를 지정하세요.",
  "oauth.error.notConfiguredProxy": "OAuth proxy가 설정되지 않았습니다. VITE_OAUTH_PROXY_URL 환경 변수를 지정하세요.",
  "oauth.error.cancelled": "OAuth 취소됨",
  "oauth.error.stateMismatch": "OAuth state 불일치",
  "oauth.error.codeMissing": "OAuth code 누락",
  "oauth.error.tokenExchange": "토큰 교환 실패 ({status}) {text}",
  "oauth.error.siteList": "사이트 목록 조회 실패 ({status})",
  "oauth.error.tokenRefresh": "토큰 갱신 실패 ({status}) {text}",
} as const;

export type TranslationKey = keyof typeof ko;
export type TranslationMap = Record<TranslationKey, string>;
export default ko satisfies TranslationMap;
