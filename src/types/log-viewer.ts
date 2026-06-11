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
  // 생성 시점 locale로 박제된 env 섹션 제목 — 섹션 label들과 동일하게 데이터로 고정.
  // optional: 구버전 logs.html에는 없음 → 뷰어가 자체 i18n으로 폴백.
  envTitle?: string;
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
  // report는 heavy(gzip) blob에 직렬화된다 — injectIssueUrl이 치환하는 평문 meta 태그와
  // 분리돼 있어 report 본문의 빈 문자열 필드가 issueUrl 마커와 충돌하지 않는다.
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
