/**
 * Download helpers. Works in the browser only (guarded at call sites —
 * downloads are always user-initiated actions).
 */

/** Trigger a browser download of `bytes` under `fileName`. */
export function saveBlob(bytes: Uint8Array, fileName: string, mime: string = ''): void {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  saveBlobArrayBuffer(buffer, fileName, mime);
}

/** Trigger a browser download of a string under `fileName`. */
export function saveText(text: string, fileName: string, mime: string = 'text/plain'): void {
  const encoder = new TextEncoder();
  saveBlob(encoder.encode(text), fileName, mime);
}

function saveBlobArrayBuffer(buffer: ArrayBuffer, fileName: string, mime: string): void {
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoke after the click has been processed by the browser.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
