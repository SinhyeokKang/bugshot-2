import { useEditorStore } from "@/store/editor-store";
import type {
  DescribeChildrenResponse,
  DescribeInitialResponse,
  PickerMessage,
  PickerTokensResponse,
  PrepareCaptureResponse,
  Token,
} from "@/types/picker";

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
  try {
    const tab = await chrome.tabs.get(tabId);
    useEditorStore.getState().startPicking({
      tabId,
      url: tab.url ?? "",
      title: tab.title ?? "",
    });
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.start",
    });
  } catch (err) {
    console.error("[bugshot] picker start failed", err);
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
  try {
    const tab = await chrome.tabs.get(tabId);
    useEditorStore.getState().startCapturing({
      tabId,
      url: tab.url ?? "",
      title: tab.title ?? "",
    });
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.startAreaSelect",
    });
  } catch (err) {
    console.error("[bugshot] area capture start failed", err);
    useEditorStore.getState().reset();
  }
}

export async function cancelAreaCapture(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.cancelAreaSelect" });
  useEditorStore.getState().reset();
}

export async function showAnnotation(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.showAnnotation" });
}

export async function hideAnnotation(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.hideAnnotation" });
}
