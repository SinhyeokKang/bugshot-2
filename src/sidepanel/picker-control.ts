import { useEditorStore } from "@/store/editor-store";
import type {
  DescribeChildrenResponse,
  DescribeInitialResponse,
  PickerMessage,
  PickerTokensResponse,
  PrepareCaptureResponse,
  Token,
} from "@/types/picker";

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
  try {
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.stop",
    });
  } catch {
    /* content script may be absent; ignore */
  }
  useEditorStore.getState().cancelPicking();
}

export async function clearPicker(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.clear",
    });
  } catch {
    /* ignore */
  }
}

export async function navigatePicker(
  tabId: number,
  direction: "parent" | "child",
): Promise<void> {
  try {
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.navigate",
      direction,
    });
  } catch (err) {
    console.error("[bugshot] picker navigate failed", err);
  }
}

export async function applyClasses(
  tabId: number,
  classList: string[],
): Promise<void> {
  try {
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.applyClasses",
      classList,
    });
  } catch {
    /* ignore */
  }
}

export async function applyStyles(
  tabId: number,
  inlineStyle: Record<string, string>,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.applyStyles",
      inlineStyle,
    });
  } catch {
    /* ignore */
  }
}

export async function applyText(tabId: number, text: string): Promise<void> {
  try {
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.applyText",
      text,
    });
  } catch {
    /* ignore */
  }
}

export async function resetEdits(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.resetEdits",
    });
  } catch {
    /* ignore */
  }
}

export async function collectTokens(tabId: number): Promise<Token[]> {
  try {
    const res = await chrome.tabs.sendMessage<
      PickerMessage,
      PickerTokensResponse
    >(tabId, { type: "picker.collectTokens" });
    return res?.tokens ?? [];
  } catch {
    return [];
  }
}

export async function describeInitialTree(
  tabId: number,
): Promise<DescribeInitialResponse | null> {
  try {
    const res = await chrome.tabs.sendMessage<
      PickerMessage,
      DescribeInitialResponse
    >(tabId, { type: "picker.describeInitial" });
    return res ?? null;
  } catch {
    return null;
  }
}

export async function describeChildren(
  tabId: number,
  selector: string,
): Promise<DescribeChildrenResponse> {
  try {
    const res = await chrome.tabs.sendMessage<
      PickerMessage,
      DescribeChildrenResponse
    >(tabId, { type: "picker.describeChildren", selector });
    return res ?? { children: [] };
  } catch {
    return { children: [] };
  }
}

export async function previewHover(
  tabId: number,
  selector: string,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.previewHover",
      selector,
    });
  } catch {
    /* ignore */
  }
}

export async function previewClear(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.previewClear",
    });
  } catch {
    /* ignore */
  }
}

export async function selectByPath(
  tabId: number,
  selector: string,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.selectByPath",
      selector,
    });
  } catch {
    /* ignore */
  }
}

export async function prepareCapture(
  tabId: number,
): Promise<PrepareCaptureResponse | null> {
  try {
    const res = await chrome.tabs.sendMessage<
      PickerMessage,
      PrepareCaptureResponse
    >(tabId, { type: "picker.prepareCapture" });
    return res ?? null;
  } catch {
    return null;
  }
}

export async function endCapture(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage<PickerMessage>(tabId, {
      type: "picker.endCapture",
    });
  } catch {
    /* ignore */
  }
}
