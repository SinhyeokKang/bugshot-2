import {
  buildLinearIssueBody,
  type LinearMediaInput,
} from "./buildLinearIssueBody";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { sendBg } from "@/types/messages";
import type { LinearCreateIssueResult } from "@/types/linear";
import type { NormalizedSubmitResult } from "@/types/platform";

export interface LinearSubmitInput {
  ctx: MarkdownContext;
  images?: LinearMediaInput[];
  video?: LinearMediaInput;
  logs?: LinearMediaInput[];
  teamId: string;
  projectId?: string;
  labelId?: string;
  assigneeId?: string;
  priority?: number;
}

export async function submitToLinear(
  input: LinearSubmitInput,
): Promise<NormalizedSubmitResult> {
  const { body } = buildLinearIssueBody({
    ctx: input.ctx,
    images: input.images,
    video: input.video,
    logs: input.logs,
  });
  const result = await sendBg<LinearCreateIssueResult>({
    type: "linear.submitIssue",
    payload: {
      teamId: input.teamId,
      title: input.ctx.title.trim(),
      description: body,
      projectId: input.projectId,
      labelId: input.labelId,
      assigneeId: input.assigneeId,
      priority: input.priority,
    },
  });
  return { key: result.identifier, url: result.url };
}
