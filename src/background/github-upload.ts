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
  try {
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
  } catch (err) {
    // Created the tab but load failed — remove it before propagating so the
    // caller's finally (which keys off `created=true`) isn't bypassed.
    await chrome.tabs.remove(tabId).catch(() => {});
    throw err;
  }
  return { tabId, created: true };
}

interface PageUploadResult {
  files: Array<{ filename: string; href: string | null }>;
  debug: string[];
}

// MUST be self-contained. chrome.scripting.executeScript serializes this via
// Function.prototype.toString() and re-evaluates it in the target tab's MAIN
// world — module-scope references won't survive the boundary.
async function pageBatchUploadFn(
  repoId: number,
  files: Array<{ filename: string; contentType: string; dataUrl: string }>,
): Promise<PageUploadResult> {
  async function uploadOne(
    file: { filename: string; contentType: string; dataUrl: string },
  ): Promise<{ filename: string; href: string | null; debug: string[] }> {
    const debug: string[] = [];
    try {
      const idx = file.dataUrl.indexOf(";base64,");
      if (idx < 0) { debug.push(`${file.filename}: invalid dataUrl`); return { filename: file.filename, href: null, debug }; }
      const binary = atob(file.dataUrl.slice(idx + ";base64,".length));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: file.contentType });
      debug.push(`${file.filename}: blob ${blob.size}b, type=${file.contentType}`);

      const policyForm = new FormData();
      policyForm.append("repository_id", String(repoId));
      policyForm.append("name", file.filename);
      policyForm.append("size", String(blob.size));
      policyForm.append("content_type", file.contentType);

      const policyRes = await fetch("https://github.com/upload/policies/assets", {
        method: "POST",
        body: policyForm,
        headers: {
          "GitHub-Verified-Fetch": "true",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      if (!policyRes.ok) {
        const body = await policyRes.text().catch(() => "");
        debug.push(`${file.filename}: policy ${policyRes.status} ${body.substring(0, 200)}`);
        return { filename: file.filename, href: null, debug };
      }
      const policy = await policyRes.json();
      debug.push(`${file.filename}: policy ok, upload_url=${policy.upload_url?.substring(0, 80)}`);

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
      if (!s3Res.ok) {
        debug.push(`${file.filename}: s3 ${s3Res.status}`);
        return { filename: file.filename, href: null, debug };
      }
      debug.push(`${file.filename}: s3 ok (${s3Res.status})`);

      const finalForm = new FormData();
      finalForm.append("authenticity_token", policy.asset_upload_authenticity_token);
      const finalUrl = new URL(policy.asset_upload_url, location.origin).href;

      const finalRes = await fetch(finalUrl, {
        method: "PUT",
        body: finalForm,
        headers: { Accept: "application/json" },
      });
      if (!finalRes.ok) {
        debug.push(`${file.filename}: finalize ${finalRes.status}`);
        return { filename: file.filename, href: null, debug };
      }
      debug.push(`${file.filename}: success href=${policy.asset.href}`);
      return { filename: file.filename, href: policy.asset.href as string, debug };
    } catch (e) {
      debug.push(`${file.filename}: exception ${e}`);
      return { filename: file.filename, href: null, debug };
    }
  }

  const settled = await Promise.all(files.map((f) => uploadOne(f)));
  return {
    files: settled.map((r) => ({ filename: r.filename, href: r.href })),
    debug: settled.flatMap((r) => r.debug),
  };
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
      args: [repoId, files],
    });
    const pageResult = result?.result as PageUploadResult | null;
    if (pageResult?.files.some((f) => f.href === null) && pageResult.debug.length > 0) {
      console.warn("[bugshot] github upload partial failure:", pageResult.debug.join(" | "));
    }
    return pageResult?.files ?? files.map((f) => ({ filename: f.filename, href: null }));
  } catch (err) {
    console.warn("[bugshot] github upload script injection failed", err);
    return files.map((f) => ({ filename: f.filename, href: null }));
  } finally {
    if (created) chrome.tabs.remove(tabId).catch(() => {});
  }
}
