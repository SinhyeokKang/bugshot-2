import * as markerjs2 from "markerjs2";

const STORAGE_KEY = "annotate:image";

const container = document.getElementById("container")!;
const toolbar = document.getElementById("toolbar")!;
const btnDone = document.getElementById("btn-done")!;
const btnCancel = document.getElementById("btn-cancel")!;

let markerArea: markerjs2.MarkerArea | null = null;
let markerState: markerjs2.MarkerAreaState | null = null;

async function init() {
  const data = await chrome.storage.session.get(STORAGE_KEY);
  const dataUrl = data[STORAGE_KEY] as string | undefined;
  if (!dataUrl) {
    container.innerHTML = '<div class="loading">이미지를 찾을 수 없습니다</div>';
    return;
  }

  const img = document.createElement("img");
  img.id = "target-image";
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image load failed"));
  });

  container.innerHTML = "";
  container.appendChild(img);
  toolbar.style.display = "";

  markerArea = new markerjs2.MarkerArea(img);
  markerArea.targetRoot = container;
  markerArea.uiStyleSettings.zIndex = "9999";
  markerArea.uiStyleSettings.resultButtonBlockVisible = false;
  markerArea.renderAtNaturalSize = true;
  markerArea.renderImageType = "image/png";

  markerArea.addEventListener("render", (event) => {
    img.src = event.dataUrl;
    markerState = event.state;
  });

  markerArea.addEventListener("close", () => {
    // re-show if user closes markerjs2 UI
    if (markerArea && markerState) {
      markerArea.show();
      markerArea.restoreState(markerState);
    }
  });

  markerArea.show();
}

btnDone.addEventListener("click", async () => {
  if (markerArea) {
    markerArea.startRenderAndClose();
    await new Promise((r) => setTimeout(r, 200));
  }
  const img = document.getElementById("target-image") as HTMLImageElement | null;
  if (!img) return;

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const annotatedUrl = canvas.toDataURL("image/png");

  await chrome.storage.session.set({ [STORAGE_KEY]: annotatedUrl });
  chrome.runtime.sendMessage({ type: "annotation.complete" }).catch(() => {});
});

btnCancel.addEventListener("click", () => {
  if (markerArea) {
    try { markerArea.close(); } catch {}
  }
  chrome.runtime.sendMessage({ type: "annotation.cancelled" }).catch(() => {});
});

init().catch((err) => {
  console.error("[bugshot] annotation init failed", err);
  container.innerHTML = '<div class="loading">초기화 실패</div>';
});
