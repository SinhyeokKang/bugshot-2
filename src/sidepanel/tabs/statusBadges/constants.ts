export const STATUS_CATEGORY_COLORS: Record<
  string,
  { bg: string; text: string; darkBg: string; darkText: string }
> = {
  // new만 테마별로 스케일이 갈린다 — 나머지는 기능색(blue/green/red)이라 양 테마가 같은 색상환을
  // 쓰지만, new는 "무색" 배지라 base 팔레트를 따라간다(라이트=slate / 다크=neutral, globals.css 참조).
  new: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    darkBg: "dark:bg-neutral-500/15",
    darkText: "dark:text-neutral-300",
  },
  indeterminate: {
    bg: "bg-blue-100",
    text: "text-blue-700",
    darkBg: "dark:bg-blue-500/15",
    darkText: "dark:text-blue-300",
  },
  done: {
    bg: "bg-green-100",
    text: "text-green-700",
    darkBg: "dark:bg-green-500/15",
    darkText: "dark:text-green-300",
  },
  deleted: {
    bg: "bg-red-100",
    text: "text-red-700",
    darkBg: "dark:bg-red-500/15",
    darkText: "dark:text-red-300",
  },
};

export const LINEAR_STATE_TYPE_COLORS: Record<string, typeof STATUS_CATEGORY_COLORS[string]> = {
  backlog: STATUS_CATEGORY_COLORS.new,
  unstarted: STATUS_CATEGORY_COLORS.new,
  started: STATUS_CATEGORY_COLORS.indeterminate,
  completed: STATUS_CATEGORY_COLORS.done,
  cancelled: STATUS_CATEGORY_COLORS.new,
};

export const LINEAR_STATE_I18N: Record<string, string> = {
  backlog: "issueList.linear.backlog",
  unstarted: "issueList.linear.unstarted",
  started: "issueList.linear.started",
  completed: "issueList.linear.completed",
  cancelled: "issueList.linear.cancelled",
};
