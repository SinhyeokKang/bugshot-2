import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// text-mono(커스텀 fontSize 토큰 = mono 표면 13/18)를 font-size 그룹으로 등록한다. 없으면 twMerge가
// text-color로 오분류해 뒤따르는 text-* 색과 만나면 text-mono를 제거하고, text-xs와도 dedupe되지 않는다.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["mono"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
