import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiLoadingOverlay } from "../AiLoadingOverlay";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

describe("AiLoadingOverlay", () => {
  it("traps keyboard focus on Stop and calls the current cancel handler", async () => {
    const cancel = vi.fn();
    const fallbackFocusRef = createRef<HTMLButtonElement>();
    const user = userEvent.setup();
    render(<><input aria-label="Background title" /><button ref={fallbackFocusRef}>Fallback</button>
      <AiLoadingOverlay surface="draft" step={0} onCancel={cancel} fallbackFocusRef={fallbackFocusRef} />
    </>);
    const stop = screen.getByRole("button", { name: "ai.stop" });
    await waitFor(() => expect(document.activeElement).toBe(stop));
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    await user.tab();
    expect(document.activeElement).toBe(stop);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(stop);
    fireEvent.keyDown(stop, { key: "Escape" });
    expect(cancel).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("restores a connected input and releases modal state on unmount", async () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const { unmount } = render(<AiLoadingOverlay surface="repro" step={0} onCancel={vi.fn()} fallbackFocusRef={createRef()} />);
    await waitFor(() => expect(document.activeElement).not.toBe(input));
    unmount();
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(input.hasAttribute("aria-hidden")).toBe(false);
    input.remove();
  });

  it("uses the panel fallback when the originating dialog has disappeared", async () => {
    const origin = document.createElement("button");
    document.body.append(origin);
    origin.focus();
    const fallback = document.createElement("button");
    document.body.append(fallback);
    const { unmount } = render(<AiLoadingOverlay surface="styling" step={0} onCancel={vi.fn()} fallbackFocusRef={{ current: fallback }} />);
    origin.remove();
    unmount();
    await waitFor(() => expect(document.activeElement).toBe(fallback));
    fallback.remove();
  });
});
