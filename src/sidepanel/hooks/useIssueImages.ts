import { useEffect, useState } from "react";
import type { IssueSnapshot } from "@/store/issues-store";
import type { SavedElementShot } from "@/types/element-shot";
import { getImageBlob } from "@/store/blob-db";

interface IssueImages {
  beforeUrl: string | null;
  afterUrl: string | null;
  elementShotUrls: { id: string; url: string | null }[];
  loading: boolean;
}

export function useIssueImages(
  issueId: string | null,
  snapshot: IssueSnapshot | undefined,
  elementShots?: readonly SavedElementShot[],
  elementShotsRevision?: string,
): IssueImages {
  const [images, setImages] = useState<IssueImages>({ beforeUrl: null, afterUrl: null, elementShotUrls: [], loading: false });
  const slots = elementShots === undefined ? undefined : JSON.stringify(elementShots.map(({ id, imageSlot, hasImage }) => ({ id, imageSlot, hasImage })));
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    const empty = { beforeUrl: null, afterUrl: null, elementShotUrls: [] };
    setImages({ ...empty, loading: !!issueId && !!snapshot });
    if (!issueId || !snapshot) return;
    const read = async (slot: Parameters<typeof getImageBlob>[1]): Promise<string | null> => {
      const blob = await getImageBlob(issueId, slot);
      if (cancelled || !blob) return null;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return url;
    };
    void (async () => {
      if (slots !== undefined) {
        const shots = JSON.parse(slots) as SavedElementShot[];
        const elementShotUrls = await Promise.all(shots.map(async shot => ({ id: shot.id, url: shot.hasImage ? await read(shot.imageSlot) : null })));
        if (!cancelled) setImages({ ...empty, elementShotUrls, loading: false });
      } else {
        const [beforeUrl, afterUrl] = await Promise.all([snapshot.before ? read("before") : null, snapshot.after ? read("after") : null]);
        if (!cancelled) setImages({ beforeUrl, afterUrl, elementShotUrls: [], loading: false });
      }
    })().catch(() => { if (!cancelled) setImages({ ...empty, loading: false }); });
    return () => {
      cancelled = true;
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [issueId, snapshot?.before, snapshot?.after, slots, elementShotsRevision]);
  return images;
}
