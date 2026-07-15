const ko = {
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
  "common.save": "저장",
  "common.verify": "검증",
  "common.delete": "삭제",
  "common.attach": "첨부",
  "common.detach": "첨부 해제",
  "common.download": "다운로드",
  "common.expand": "펼치기",
  "common.collapse": "접기",

  "time.justNow": "방금",
  "time.minutesAgo": "{n}분 전",
  "time.hoursAgo": "{n}시간 전",
  "time.daysAgo": "{n}일 전",

  "bg.error.network": "네트워크 연결을 확인하세요. 외부 서버에 접근할 수 없습니다.",
  "bg.error.communication": "확장 프로그램 내부 통신 오류. 페이지를 새로고침해주세요.",
  "bg.error.unknown": "알 수 없는 오류가 발생했습니다.",
} as const;

type Bundle = Record<keyof typeof ko, string>;

const en = {
  "common.ok": "OK",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.back": "Back",
  "common.loading": "Loading...",
  "common.empty": "Empty",
  "common.actions": "Actions",
  "common.deselect": "Deselect",
  "common.untitled": "(Untitled)",
  "common.next": "Next",
  "common.done": "Done",
  "common.reset": "Reset",
  "common.submit": "Submit",
  "common.save": "Save",
  "common.verify": "Verify",
  "common.delete": "Delete",
  "common.attach": "Attach",
  "common.detach": "Detach",
  "common.download": "Download",
  "common.expand": "Expand",
  "common.collapse": "Collapse",

  "time.justNow": "Just now",
  "time.minutesAgo": "{n}m ago",
  "time.hoursAgo": "{n}h ago",
  "time.daysAgo": "{n}d ago",

  "bg.error.network": "Check your network connection. Cannot reach external server.",
  "bg.error.communication": "Extension communication error. Please refresh the page.",
  "bg.error.unknown": "An unknown error occurred.",
} satisfies Bundle;

export const common = { ko, en };
