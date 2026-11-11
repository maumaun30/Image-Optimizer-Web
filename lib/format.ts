/** Human file size: 840 B · 12.4 KB · 3.1 MB · 1.46 GB. */
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Remaining encode time, rounded to what a person can act on. */
export function fmtEta(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `about ${m} min left` : `about ${Math.round(m / 60)} h left`;
}

export function fmtDuration(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

/** Start a browser download without navigating away from the page. */
export function triggerDownload(href: string, filename?: string) {
  const a = document.createElement("a");
  a.href = href;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
