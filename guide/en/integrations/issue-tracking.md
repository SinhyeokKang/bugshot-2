# Issue Tracking

![Issues tab](../assets/integrations-issue-tracking-1.jpg)

Never lose track of where your drafts and submitted issues went. The **Issues** tab gathers them all in one place.

## Find and filter

Even when the list grows, you'll find things fast.

- **Filter** — All / Submitted / Draft.
- **Search** — Find by title.
- **Date groups** — Items are grouped by the date they were written or submitted.

## Open a row

![Issue detail view](../assets/integrations-issue-tracking-2.jpg)

What opens depends on the row’s state.

- **Draft** — Editable. Keep writing, or tweak it and submit.
- **Submitted** — Opens the issue on its platform. A row with a recovery notice opens read-only recovery details instead.
- **Preserved Slack issue** — When a tracker is connected, use **View details** to review or edit the saved draft, then **Promote to tracker**. Resolve any recovery notice first.

## When attachments or registration need checking

![Attachment recovery details and downloads](../assets/integrations-issue-tracking-3.jpg)

An issue can be registered while a file or its body link is still missing. Open a row marked **Attachments need attention** to check each file and its saved copy. A registered issue stays in **Submitted**. Local recovery details remain available even after you disconnect the platform.

Use **Download** to save the files you need and attach them to the existing issue yourself. Files keep the format prepared for submission, such as a ZIP for Notion logs or a JPEG for Asana images. Downloading does not mark remote delivery as complete. **Local file unavailable** means the saved file has expired or is no longer in your browser.

If you see **Registration could not be confirmed**, check the destination first. Resubmission is blocked to avoid creating a duplicate. Choose **Confirm not registered** only after checking that the issue does not exist, then confirm in the dialog. Closing the dialog leaves everything unchanged.


## Refresh

Re-fetches the current status of a submitted issue from the platform (open, closed, etc.). Just keep in mind it only works while that platform is **connected**.

## Delete all

Clears every issue in the list at once. Local drafts, records, and their associated recovery data are cleaned up — issues already filed on the platform stay put, so no need to worry.

If attachment delivery or a later submission step is incomplete, or issue creation cannot be confirmed, the files needed for recovery stay in your browser. They expire 30 days after the submission attempt and are cleaned up when you next open the side panel after expiry. Deleting the issue record also removes its recovery record. A file shared with another draft may remain for that draft.

Confirm **Delete local copies** in recovery details to remove the saved recovery files now. For a confirmed registered issue, this also clears the recovery notice; the remote issue and attachments stay unchanged. If registration is unknown, deleting files does not unblock resubmission. Originals saved for Slack promotion or shared with another draft may remain.
