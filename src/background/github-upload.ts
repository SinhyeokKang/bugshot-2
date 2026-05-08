export function extractCsrfToken(html: string): string | null {
  const dataCsrf = /data-csrf[^>]*?value="([^"]+)"/i.exec(html)
    ?? /value="([^"]+)"[^>]*?data-csrf/i.exec(html);
  if (dataCsrf?.[1]) return dataCsrf[1];

  const meta = /<meta\s+name="csrf-token"\s+content="([^"]+)"/i.exec(html)
    ?? /<meta\s+content="([^"]+)"\s+name="csrf-token"/i.exec(html);
  if (meta?.[1]) return meta[1];

  const input = /name="authenticity_token"[^>]*?value="([^"]+)"/i.exec(html)
    ?? /value="([^"]+)"[^>]*?name="authenticity_token"/i.exec(html);
  return input?.[1] || null;
}

export interface GithubUploadFileEntry {
  filename: string;
  contentType: string;
  dataUrl: string;
}

async function ensureGithubTab(owner: string, repo: string): Promise<{ tabId: number; created: boolean }> {
  const tabs = await chrome.tabs.query({ url: "https://github.com/*", status: "complete" });
  if (tabs[0]?.id != null) return { tabId: tabs[0].id, created: false };

  const tab = await chrome.tabs.create({
    url: `https://github.com/${owner}/${repo}`,
    active: false,
  });
  if (tab.id == null) throw new Error("tab created without id");
  const tabId = tab.id;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("tab load timeout"));
    }, 15000);
    function listener(tid: number, info: chrome.tabs.TabChangeInfo) {
      if (tid === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
  return { tabId, created: true };
}

async function pageBatchUploadFn(
  owner: string,
  repo: string,
  repoId: number,
  files: Array<{ filename: string; contentType: string; dataUrl: string }>,
): Promise<Array<{ filename: string; href: string | null }>> {
  // extractCsrfToken 인라인 (executeScript 직렬화 제약)
  function extractCsrf(html: string): string | null {
    const dataCsrf = /data-csrf[^>]*?value="([^"]+)"/i.exec(html)
      ?? /value="([^"]+)"[^>]*?data-csrf/i.exec(html);
    if (dataCsrf?.[1]) return dataCsrf[1];
    const meta = /<meta\s+name="csrf-token"\s+content="([^"]+)"/i.exec(html)
      ?? /<meta\s+content="([^"]+)"\s+name="csrf-token"/i.exec(html);
    if (meta?.[1]) return meta[1];
    const input = /name="authenticity_token"[^>]*?value="([^"]+)"/i.exec(html)
      ?? /value="([^"]+)"[^>]*?name="authenticity_token"/i.exec(html);
    return input?.[1] || null;
  }

  let csrfToken: string | null = null;
  try {
    const html = await fetch(`/${owner}/${repo}/releases/new`).then((r) => r.text());
    csrfToken = extractCsrf(html);
  } catch { /* csrfToken stays null */ }

  if (!csrfToken) {
    return files.map((f) => ({ filename: f.filename, href: null }));
  }

  const results: Array<{ filename: string; href: string | null }> = [];

  for (const file of files) {
    try {
      const match = /^data:[^;]*;base64,(.+)$/.exec(file.dataUrl);
      if (!match) { results.push({ filename: file.filename, href: null }); continue; }
      const binary = atob(match[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: file.contentType });

      const policyForm = new FormData();
      policyForm.append("name", file.filename);
      policyForm.append("size", String(blob.size));
      policyForm.append("content_type", file.contentType);
      policyForm.append("authenticity_token", csrfToken);
      policyForm.append("repository_id", String(repoId));

      const policyRes = await fetch("https://github.com/upload/policies/assets", {
        method: "POST",
        body: policyForm,
        headers: { Accept: "application/json" },
      });
      if (!policyRes.ok) { results.push({ filename: file.filename, href: null }); continue; }
      const policy = await policyRes.json();

      const s3Form = new FormData();
      for (const [key, value] of Object.entries(policy.form as Record<string, string>)) {
        s3Form.append(key, value);
      }
      s3Form.append("file", blob);

      const s3Res = await fetch(policy.upload_url, {
        method: "POST",
        body: s3Form,
        mode: "cors",
      });
      if (!s3Res.ok && s3Res.status !== 204) { results.push({ filename: file.filename, href: null }); continue; }

      const finalForm = new FormData();
      finalForm.append("authenticity_token", policy.asset_upload_authenticity_token);
      const finalUrl = new URL(policy.asset_upload_url, location.origin).href;

      const finalRes = await fetch(finalUrl, {
        method: "PUT",
        body: finalForm,
        headers: { Accept: "application/json" },
      });
      if (!finalRes.ok) { results.push({ filename: file.filename, href: null }); continue; }

      results.push({ filename: file.filename, href: policy.asset.href as string });
    } catch {
      results.push({ filename: file.filename, href: null });
    }
  }

  return results;
}

export async function uploadGithubFiles(
  owner: string,
  repo: string,
  repoId: number,
  files: GithubUploadFileEntry[],
): Promise<Array<{ filename: string; href: string | null }>> {
  if (files.length === 0) return [];

  let tabId: number;
  let created = false;

  try {
    const tab = await ensureGithubTab(owner, repo);
    tabId = tab.tabId;
    created = tab.created;
  } catch (err) {
    console.warn("[bugshot] github tab not available", err);
    return files.map((f) => ({ filename: f.filename, href: null }));
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: pageBatchUploadFn,
      args: [owner, repo, repoId, files],
    });
    return result?.result ?? files.map((f) => ({ filename: f.filename, href: null }));
  } catch (err) {
    console.warn("[bugshot] github upload script injection failed", err);
    return files.map((f) => ({ filename: f.filename, href: null }));
  } finally {
    if (created) chrome.tabs.remove(tabId).catch(() => {});
  }
}
