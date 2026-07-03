# Connecting Platforms

🌐 [한국어](https://bugshot.gitbook.io/ko/integrations/platforms)

Connect platforms in the **Integrations** tab. With nothing connected you land on "Add platform"; once one is connected you land on "My integrations".

## How to connect

It's simpler than it sounds — three steps and you're done.

1. In "Add platform", pick the platform you want to connect.
2. When the connect-method dialog appears, choose **OAuth** (browser login) or **enter a token** directly.
3. With OAuth, just approve access in the login window. With a token, paste the token you generated along with any required fields.

![Connect-method dialog](../assets/integrations-platforms-1.jpg)

OAuth is usually the easiest. That said, if your org policy blocks OAuth or you'd rather use a token, the token method works just as well. Note that **Slack supports OAuth only**, so hitting "Connect Slack" takes you straight to the login window.

## What each platform needs

| Platform | Connect method | Fields when using a token | Generate a token |
|---|---|---|---|
| Jira | OAuth / API Token | baseUrl, email, apiToken | id.atlassian.com → API tokens |
| GitHub | OAuth / PAT | PAT | github.com/settings/tokens |
| Linear | OAuth / API Key | apiKey | linear.app security settings |
| Notion | OAuth / Internal Token | token | notion.so integration |
| GitLab | OAuth / PAT | instanceUrl (self-managed only), pat | gitlab.com PAT |
| Asana | OAuth / PAT | pat | app.asana.com my-apps |
| ClickUp | OAuth / API Token | pat | app.clickup.com Settings > Apps |
| Slack | OAuth only | — (no token entry) | — |

## Slack — a quick share to a channel or DM

Slack is a messaging app rather than an issue tracker, so it works a little differently from the others. It's perfect for when you want to drop a quick "hey, this is broken" into a team channel before filing a formal issue.

- **Posts as you**: connect via OAuth and messages go out **under your own name** (not a bot). That means there's no bot to invite into channels.
- **Where it goes**: pick any public channel, private channel, or DM you're a member of. (Channels you haven't joined won't show up in the list.)
- **Title in the channel, details in a thread**: the title posts as a message in the channel, while the details — environment info, style changes, log summary — plus screenshots, video, and log files land as **thread replies** under it. Your channel timeline stays clean with just the one-line title.
- **Mentions**: pick members to mention and they'll be pinged by `@name` in the message.

> Slack messages don't have an "open/closed" state, so the issue list just shows "Submitted"; click it to jump straight to the message.

### Promote to a real tracker later

Shared something to Slack and then realized it deserves a proper issue too? No worries. Issues you share to Slack keep their **original data — capture images, video, and logs — intact**. So the moment you connect a tracker like Jira or GitHub, two buttons appear on the right of that Slack card in the issue list: **View details** and **Promote to tracker**.

- **View details**: reopen the saved capture and logs to take another look.
- **Promote to tracker**: opens the submit dialog (with Slack left out). Pick a tracker, file it as a formal issue, and the card turns into a regular issue while the Slack history is cleared. BugShot also drops a **comment linking to the new tracker issue right in the original Slack thread**, so teammates following that conversation can see exactly where it landed.

![View details and Promote buttons on a Slack card](../assets/integrations-platforms-3.jpg)

> If you haven't connected a tracker yet, the two buttons stay hidden and you'll just see the "Submitted" badge and a shortcut to the message, as before. Connect a tracker later and the buttons quietly show up on the same card. Clicking the card body always jumps to the Slack message — that never changes, so don't worry.

## Defaults after connecting

Once connected, you can pick a default location for new issues — a project for Jira/GitLab, a repository for GitHub, a team for Linear, a database for Notion, a project for Asana, a list for ClickUp (picked as Workspace → Space → List), a channel for Slack. Set it once and you won't have to choose it every time you write an issue, which saves a lot of clicks.

![Setting defaults after connecting](../assets/integrations-platforms-2.jpg)

## Disconnecting

In "My integrations" you can disconnect each platform (the unplug icon), or disconnect everything at once. Don't worry — disconnecting has no effect on issues you've already submitted.
