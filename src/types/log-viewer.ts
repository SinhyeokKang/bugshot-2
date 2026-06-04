import type { NetworkLog } from "./network";
import type { ConsoleLog } from "./console";
import type { ActionLog } from "./action";

export interface LogViewerReportSection {
  id: string;
  label: string;
  renderAs: "paragraph" | "orderedList";
  value: string; // inline 이미지가 dataURL로 resolve된 본문
}

export interface LogViewerReport {
  title: string;
  env: { label: string; value: string }[];
  sections: LogViewerReportSection[];
  copy: { markdown: string; html: string }; // 미리 빌드된 클립보드 페이로드
}

export interface LogViewerData {
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog: ActionLog | null;
  // har / *LogJson(export 포맷)은 logs.html에 저장하지 않는다 — networkLog/consoleLog/actionLog에서
  // 파생이라 중복 저장이 용량을 2배로 키운다. log-viewer가 다운로드 시점에 즉석 생성(meta.version 사용).
  video: {
    dataUrl: string;
    startedAt: number; // 동기화 앵커(공통 0점)
    thumbnail?: string; // <video poster>
  } | null;
  screenshot: { dataUrl: string } | null; // 시간축 없는 정적 이미지(좌측 패널)
  // report는 meta보다 앞에 둔다 — injectIssueUrl의 lastIndexOf('"issueUrl":""')
  // 마커가 meta 말미만 잡도록(report 본문의 빈 문자열 필드와 충돌 방지).
  report: LogViewerReport | null;
  meta: {
    version: string;
    createdAt: string;
    pageUrl: string;
    issueTitle?: string;
    issueKey?: string;
    issueUrl?: string;
  };
}
