import { useEffect, useState } from "react";
import { CAPTURE_COMMANDS, type CaptureCommand } from "@/lib/capture-commands";

const CAPTURE_SET = new Set<string>(CAPTURE_COMMANDS);

/**
 * chrome.commands.getAll()을 1회 조회해 캡처 커맨드별 단축키 표기를 반환한다.
 * 캡처 외 커맨드와 키 미배정(빈 shortcut) 커맨드는 제외한다.
 */
export function useCommandShortcuts(): Partial<Record<CaptureCommand, string>> {
  const [shortcuts, setShortcuts] = useState<Partial<Record<CaptureCommand, string>>>({});

  useEffect(() => {
    let cancelled = false;
    chrome.commands
      .getAll()
      .then((cmds) => {
        if (cancelled) return;
        const map: Partial<Record<CaptureCommand, string>> = {};
        for (const cmd of cmds) {
          if (cmd.name && cmd.shortcut && CAPTURE_SET.has(cmd.name)) {
            map[cmd.name as CaptureCommand] = cmd.shortcut;
          }
        }
        setShortcuts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return shortcuts;
}
