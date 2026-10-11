// Stable database identities preserve orders and historical receipt documents.
// The owner-facing numbering reflects Brenda (B) and Jashtë (J).
export function tableDisplayCode(code: string): string {
  if (code === 'M13') return 'J11';
  if (/^M(?:[1-9]|1[0-2])$/.test(code)) return `B${code.slice(1)}`;
  if (/^T(?:[1-9]|10)$/.test(code)) return `J${code.slice(1)}`;
  return code;
}
