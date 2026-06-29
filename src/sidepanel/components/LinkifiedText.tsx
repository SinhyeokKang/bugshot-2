import { Fragment } from "react";
import { tokenizeLogText } from "@/sidepanel/lib/linkify";
import { InlineLink } from "./InlineLink";

export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {tokenizeLogText(text).map((tok, i) =>
        tok.type === "url" ? (
          <InlineLink key={i} href={tok.href} onClick={(e) => e.stopPropagation()}>
            {tok.value}
          </InlineLink>
        ) : (
          <Fragment key={i}>{tok.value}</Fragment>
        ),
      )}
    </>
  );
}
