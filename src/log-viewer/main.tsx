import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { LogViewerData } from "@/types/log-viewer";
import { App } from "./App";
import "./styles.css";

let data: LogViewerData | null = null;
const el = document.getElementById("__BUGSHOT_DATA__");
if (el?.textContent?.trim()) {
  try {
    data = JSON.parse(el.textContent) as LogViewerData;
  } catch { /* invalid data — render empty */ }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App data={data} />
  </StrictMode>,
);
