/**
 * Vercel rejects any request body over 4.5 MB before our code even runs (a bare "413" with no
 * JSON), so the app enforces its own limit under that: 4.5 MB of file in decimal megabytes
 * leaves headroom for the rest of the form (the About You answers and multipart framing).
 * Checked in the browser first so people get a clear message instead of a failed upload.
 */
export const MAX_UPLOAD_BYTES = 4_500_000;
export const MAX_UPLOAD_LABEL = "4.5 MB";

export function fileTooLargeMessage(sizeBytes: number): string {
  const mb = (sizeBytes / 1_000_000).toFixed(1);
  return `That file is ${mb} MB and the limit is ${MAX_UPLOAD_LABEL}. Try a shorter date range, or export the statement as CSV, which is usually much smaller.`;
}
