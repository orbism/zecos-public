/**
 * Copy to clipboard, everywhere.
 *
 * `navigator.clipboard` exists only in a SECURE CONTEXT - https, or localhost.
 * Open the app from another machine over plain http and it is `undefined`, which
 * is the same trap that broke Pool-id hashing. The old call sites wrote
 * `navigator.clipboard?.writeText(v)` and then flipped the button to "copied"
 * regardless, so on those origins nothing was copied and the UI said it had
 * been - a silent failure that reads as a working feature.
 *
 * Order of attempts:
 *   1. the async Clipboard API, when it is actually there;
 *   2. a hidden textarea plus `document.execCommand('copy')`, which is
 *      deprecated but still implemented everywhere and works on plain http.
 *
 * Returns whether it worked, so callers can tell the truth. Nothing here
 * throws: a failed copy is a nuisance, not an error worth breaking a payment
 * screen over.
 */
export async function copyText(value: string): Promise<boolean> {
  if (!value) return false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission denied, or not focused. Fall through to the older path, which
    // has different failure conditions and often works when this one does not.
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    // Off-screen rather than hidden: an element with `display:none` or
    // `visibility:hidden` cannot be selected, so the copy silently does nothing.
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, value.length);   // iOS ignores select() alone
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Select the text inside an element, so someone can copy it by hand.
 *
 * The last resort when both copy paths fail - which is better than telling
 * someone to retype a shielded address.
 */
export function selectContents(el: HTMLElement | null): void {
  if (!el || typeof window === 'undefined') return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
