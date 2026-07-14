import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CcMultiCombobox, type CcUserOption } from "../CcMultiCombobox";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
}));

const OPTIONS: CcUserOption[] = [
  { key: "u1", label: "김철수" },
  { key: "u2", label: "이영희" },
  { key: "u3", label: "홍길동" },
];

function Harness() {
  const [selected, setSelected] = useState<CcUserOption[]>([]);
  return (
    <CcMultiCombobox
      options={OPTIONS}
      selected={selected}
      onToggle={(o) =>
        setSelected((prev) =>
          prev.some((s) => s.key === o.key)
            ? prev.filter((s) => s.key !== o.key)
            : [...prev, o],
        )
      }
      onClear={() => setSelected([])}
      loading={false}
      error={null}
    />
  );
}

// 목록에 보이는 유저 이름들 (선택 해제 액션 항목 제외).
function optionNames(): string[] {
  return screen
    .getAllByRole("option")
    .map((el) => el.textContent ?? "")
    .filter((text) => !text.includes("field.cc.clear"));
}

describe("CcMultiCombobox 선택자 상단 고정", () => {
  it("검색해서 골랐다가 다시 열어도 선택된 유저가 맨 위에 온다", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("cc-combobox"));
    await user.type(screen.getByPlaceholderText("field.cc.search"), "홍길");
    await waitFor(() => expect(optionNames()).toEqual(["홍길동"]));
    await user.click(screen.getByText("홍길동"));

    await user.click(screen.getByTestId("cc-combobox")); // 닫기
    await user.click(screen.getByTestId("cc-combobox")); // 재오픈
    await waitFor(() => expect(optionNames().length).toBe(OPTIONS.length));
    expect(optionNames()[0]).toContain("홍길동");
  });
});
