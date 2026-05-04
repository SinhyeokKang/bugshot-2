import { isSupportedUrl } from "@/lib/url-support";
import { useEditorStore } from "@/store/editor-store";
import { onPickerUnavailable } from "@/types/messages";
import { networkRecorderScript } from "@/content/network-recorder";
import { consoleRecorderScript } from "@/content/console-recorder";
import type {
  DescribeChildrenResponse,
  DescribeInitialResponse,
  PickerMessage,
  PickerTokensResponse,
  PrepareCaptureResponse,
  Token,
} from "@/types/picker";

class PickerUnavailableError extends Error {
  constructor() {
    super("Picker unavailable on this page");
    this.name = "PickerUnavailableError";
  }
}

async function pingOk(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
    return true;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  if (await pingOk(tabId)) return;

  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.[0]?.js;
  if (!files?.length) throw new PickerUnavailableError();
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
  } catch {
    // URL 사전 검사는 통과했지만 정책/제한으로 주입 불가한 케이스
    // (e.g. enterprise runtime_blocked_hosts, file:// 권한 미허용, 또는 검사 후 탭이 unsupported로 이동).
    throw new PickerUnavailableError();
  }

  // executeScript는 inject 완료까지 await하지만 onMessage listener 등록 시점이
  // 살짝 뒤따르는 케이스가 있어 picker.start가 "Receiving end does not exist"로
  // 깨지는 race. ping이 통과할 때까지 짧게 폴링.
  for (let i = 0; i < 10; i++) {
    if (await pingOk(tabId)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new PickerUnavailableError();
}

async function send<R = void>(
  tabId: number,
  msg: PickerMessage,
): Promise<R | undefined> {
  try {
    return await chrome.tabs.sendMessage<PickerMessage, R>(tabId, msg);
  } catch {
    return undefined;
  }
}

export async function startPicker(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (err) {
    console.error("[bugshot] picker start failed", err);
    return;
  }
  if (!isSupportedUrl(tab.url)) {
    onPickerUnavailable.fire();
    return;
  }
  useEditorStore.getState().startPicking({
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
  });
  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.start",
    });
  } catch (err) {
    if (err instanceof PickerUnavailableError) {
      onPickerUnavailable.fire();
    } else {
      console.error("[bugshot] picker start failed", err);
    }
    useEditorStore.getState().cancelPicking();
  }
}

export async function stopPicker(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.clear" });
  useEditorStore.getState().cancelPicking();
}

export async function clearPicker(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.clear" });
}

export async function navigatePicker(
  tabId: number,
  direction: "parent" | "child",
): Promise<void> {
  await send(tabId, { type: "picker.navigate", direction });
}

export async function applyClasses(
  tabId: number,
  classList: string[],
): Promise<void> {
  await send(tabId, { type: "picker.applyClasses", classList });
}

export async function applyStyles(
  tabId: number,
  inlineStyle: Record<string, string>,
): Promise<void> {
  await send(tabId, { type: "picker.applyStyles", inlineStyle });
}

export async function applyText(tabId: number, text: string): Promise<void> {
  await send(tabId, { type: "picker.applyText", text });
}

export async function resetEdits(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.resetEdits" });
}

export async function collectTokens(tabId: number): Promise<Token[]> {
  const res = await send<PickerTokensResponse>(tabId, {
    type: "picker.collectTokens",
  });
  return res?.tokens ?? [];
}

export async function describeInitialTree(
  tabId: number,
): Promise<DescribeInitialResponse | null> {
  const res = await send<DescribeInitialResponse>(tabId, {
    type: "picker.describeInitial",
  });
  return res ?? null;
}

export async function describeChildren(
  tabId: number,
  selector: string,
): Promise<DescribeChildrenResponse> {
  const res = await send<DescribeChildrenResponse>(tabId, {
    type: "picker.describeChildren",
    selector,
  });
  return res ?? { children: [] };
}

export async function previewHover(
  tabId: number,
  selector: string,
): Promise<void> {
  await send(tabId, { type: "picker.previewHover", selector });
}

export async function previewClear(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.previewClear" });
}

export async function selectByPath(
  tabId: number,
  selector: string,
): Promise<void> {
  await send(tabId, { type: "picker.selectByPath", selector });
}

export async function prepareCapture(
  tabId: number,
): Promise<PrepareCaptureResponse | null> {
  const res = await send<PrepareCaptureResponse>(tabId, {
    type: "picker.prepareCapture",
  });
  return res ?? null;
}

export async function endCapture(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.endCapture" });
}

export async function startAreaCapture(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (err) {
    console.error("[bugshot] area capture start failed", err);
    return;
  }
  if (!isSupportedUrl(tab.url)) {
    onPickerUnavailable.fire();
    return;
  }
  useEditorStore.getState().startCapturing({
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
  });
  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.startAreaSelect",
    });
  } catch (err) {
    if (err instanceof PickerUnavailableError) {
      onPickerUnavailable.fire();
    } else {
      console.error("[bugshot] area capture start failed", err);
    }
    useEditorStore.getState().reset();
  }
}

export async function cancelAreaCapture(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.cancelAreaSelect" });
  useEditorStore.getState().reset();
}

export async function injectNetworkRecorder(tabId: number): Promise<string> {
  await ensureContentScript(tabId);
  const sentinel = crypto.randomUUID();
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: networkRecorderScript,
    args: [sentinel],
  });
  await send(tabId, { type: "networkRecorder.setSentinel", sentinel });
  return sentinel;
}

export async function stopNetworkRecorder(tabId: number): Promise<void> {
  await send(tabId, { type: "networkRecorder.stop" });
}

export async function syncNetworkRecorder(tabId: number): Promise<void> {
  await send(tabId, { type: "networkRecorder.sync" });
}

export async function injectConsoleRecorder(tabId: number): Promise<string> {
  await ensureContentScript(tabId);
  const sentinel = crypto.randomUUID();
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: consoleRecorderScript,
    args: [sentinel],
  });
  await send(tabId, { type: "consoleRecorder.setSentinel", sentinel });
  return sentinel;
}

export async function stopConsoleRecorder(tabId: number): Promise<void> {
  await send(tabId, { type: "consoleRecorder.stop" });
}

export async function syncConsoleRecorder(tabId: number): Promise<void> {
  await send(tabId, { type: "consoleRecorder.sync" });
}

