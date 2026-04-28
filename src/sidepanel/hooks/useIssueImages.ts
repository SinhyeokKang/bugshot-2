import { useEffect, useRef, useState } from "react";
import type { IssueSnapshot } from "@/store/issues-store";
import { getImageBlob } from "@/store/blob-db";

interface IssueImages {
  beforeUrl: string | null;
  afterUrl: string | null;
  loading: boolean;
}

export function useIssueImages(
  issueId: string | null,
  snapshot: IssueSnapshot | undefined,
): IssueImages {
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prevUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    const staleUrls = prevUrlsRef.current;
    prevUrlsRef.current = [];

    if (!issueId || !snapshot) {
      staleUrls.forEach((u) => URL.revokeObjectURL(u));
      setBeforeUrl(null);
      setAfterUrl(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setBeforeUrl(null);
    setAfterUrl(null);

    const newUrls: string[] = [];
    const promises: Promise<void>[] = [];

    if (snapshot.before) {
      promises.push(
        getImageBlob(issueId, "before").then((blob) => {
          if (cancelled || !blob) return;
          const url = URL.createObjectURL(blob);
          newUrls.push(url);
          setBeforeUrl(url);
        }),
      );
    }

    if (snapshot.after) {
      promises.push(
        getImageBlob(issueId, "after").then((blob) => {
          if (cancelled || !blob) return;
          const url = URL.createObjectURL(blob);
          newUrls.push(url);
          setAfterUrl(url);
        }),
      );
    }

    void Promise.all(promises).finally(() => {
      staleUrls.forEach((u) => URL.revokeObjectURL(u));
      if (cancelled) {
        newUrls.forEach((u) => URL.revokeObjectURL(u));
      } else {
        prevUrlsRef.current = newUrls;
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [issueId, snapshot?.before, snapshot?.after]);

  useEffect(() => {
    return () => {
      prevUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  return { beforeUrl, afterUrl, loading };
}
