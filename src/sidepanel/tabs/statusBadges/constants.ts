export const STATUS_CATEGORY_COLORS: Record<
  string,
  { bg: string; text: string; darkBg: string; darkText: string }
> = {
  new: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    darkBg: "dark:bg-slate-500/15",
    darkText: "dark:text-slate-300",
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
