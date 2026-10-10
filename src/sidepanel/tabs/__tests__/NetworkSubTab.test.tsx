import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, t: (key: string) => key }));

vi.mock("@/sidepanel/components/NetworkLogContent", () => ({
  NetworkLogContent: ({ bottomInset }: { bottomInset?: boolean }) => (
    <div data-testid="stub-log" data-bottom-inset={String(!!bottomInset)} />
  ),
}));
vi.mock("@/sidepanel/components/RecordingFloatingBar", () => ({
  RecordingFloatingBar: () => <div data-testid="recording-bar" />,
}));
vi.mock("@/sidepanel/hooks/useRecorderSyncInterval", () => ({ useRecorderSyncInterval: () => {} }));
vi.mock("@/sidepanel/picker-control", () => ({ syncNetworkRecorder: vi.fn() }));
vi.mock("@/sidepanel/hooks/usePickerMessages", () => ({ networkLogPersist: { discard: vi.fn() } }));
vi.mock("@/sidepanel/hooks/useBoundTabId", () => ({ useBoundTabId: () => 1 }));

let phase = "idle";
// 0건이면 Clear는 원래 disabled라 녹화 잠금 단언이 공허해진다 — 항상 1건 이상 seed.
const networkLog = { requests: [{ id: "r1" }] };
vi.mock("@/store/editor-store", () => {
  const useEditorStore = (sel: (s: Record<string, unknown>) => unknown) => sel({ phase, networkLog });
  useEditorStore.getState = () => ({ clearNetworkLog: vi.fn() });
  return { useEditorStore };
});

import { NetworkSubTab } from "../NetworkSubTab";

const button = (id: string) => screen.getByTestId(id) as HTMLButtonElement;

function renderSub() {
  return render(<NetworkSubTab active onStartFreeform={() => {}} />);
}

beforeEach(() => {
  phase = "idle";
});

afterEach(() => {
  cleanup();
});

describe("NetworkSubTab — 녹화 상태", () => {
  it("녹화 중이면 footer 버튼이 disabled이고 바가 뜨며 LogContent에 bottomInset을 준다", () => {
    phase = "recording";
    renderSub();
    expect(button("network-clear").disabled).toBe(true);
    expect(button("network-write-issue").disabled).toBe(true);
    expect(screen.getByTestId("recording-bar")).toBeTruthy();
    expect(screen.getByTestId("stub-log").dataset.bottomInset).toBe("true");
  });

  it("idle이면 footer 버튼이 활성이고 바가 없으며 bottomInset은 false", () => {
    renderSub();
    expect(button("network-clear").disabled).toBe(false);
    expect(button("network-write-issue").disabled).toBe(false);
    expect(screen.queryByTestId("recording-bar")).toBeNull();
    expect(screen.getByTestId("stub-log").dataset.bottomInset).toBe("false");
  });

  it("읽기 순서: footer가 바보다 앞에 온다", () => {
    phase = "recording";
    renderSub();
    const footerButton = button("network-clear");
    const bar = screen.getByTestId("recording-bar");
    expect(footerButton.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("바의 absolute 기준이 되도록 PageShell이 relative다", () => {
    phase = "recording";
    renderSub();
    expect(screen.getByTestId("recording-bar").parentElement?.classList.contains("relative")).toBe(true);
  });
});
