import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Loader2 } from "lucide-react";
import type { LogViewerData } from "@/types/log-viewer";
import { base64ToGunzip } from "@/lib/gzip-base64";
import { App } from "./App";
import "./styles.css";

async function loadData(): Promise<LogViewerData | null> {
  const dataEl = document.getElementById("__BUGSHOT_DATA__");
  const raw = dataEl?.textContent?.trim();
  if (!raw) return null;
  try {
    if (dataEl?.getAttribute("type") === "application/gzip-base64") {
      // 무거운 로그·이미지는 gzip 압축, meta는 평문 별도 태그.
      const heavy = JSON.parse(await base64ToGunzip(raw));
      const metaEl = document.getElementById("__BUGSHOT_META__");
      const meta = metaEl?.textContent?.trim() ? JSON.parse(metaEl.textContent) : null;
      return { ...heavy, meta } as LogViewerData;
    }
    // 하위호환: 구버전 단일 평문 JSON 태그.
    return JSON.parse(raw) as LogViewerData;
  } catch {
    return null; // invalid data — render empty
  }
}

const root = createRoot(document.getElementById("root")!);
// gzip 해제 동안 빈 화면 대신 스피너 — 로드 완료 후 App으로 교체.
root.render(
  <div className="flex h-screen items-center justify-center text-muted-foreground">
    <Loader2 className="h-6 w-6 animate-spin" />
  </div>,
);
void loadData().then((data) => {
  root.render(
    <StrictMode>
      <App data={data} />
    </StrictMode>,
  );
});
