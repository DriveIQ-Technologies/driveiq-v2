'use client';

import { useEffect, useState } from 'react';

export function Load<T>({
  load,
  children,
}: {
  load: () => Promise<T>;
  children: (data: T) => React.ReactNode;
}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      live = false;
    };
    // Intentionally once per mount; pass `key` to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  return <>{children(data)}</>;
}
