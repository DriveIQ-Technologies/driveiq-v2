/**
 * Event-description cleanup — client request 26 Jul 2026 (tightened 31 Jul).
 *
 * Ticketmaster's `info` field is usually ticket-sales small print (fixed
 * tier pricing, age restrictions, bag policy, "CLICK HERE" links) rather
 * than a real description. The client wants a consistent, simple 1–2 line
 * About — like the support-act line on the Bruno Mars / Wembley card —
 * and no About at all when there's nothing meaningful to show
 * (EventDetailsSheet hides the block when `description` is undefined).
 *
 * Strategy: split into sentences, drop ticket/admissions/ops boilerplate,
 * drop shouty all-caps lines and decoration, then keep at most the first
 * two surviving sentences, capped in length.
 */

/** Sentence-level patterns that mark ticket-sales / admissions / ops noise. */
const BOILERPLATE = [
  /ticket/i,
  /\bprice(s|d)?\b|\bpricing\b|\b£\d|\b\$\d/i,
  /\btier\b|\bfixed tier\b/i,
  /\bpresale\b|\bon[- ]sale\b|\bre-?sale\b|\btransfer\b/i,
  /\bper (person|household|order)\b|\bmax(imum)? of \d+ tickets\b/i,
  /age restriction|\bunder \d+s?\b|\bover \d+s?\b|accompanied by an adult|\bover 18s?\b|\b18\+\b/i,
  /\bid required\b|photo id|proof of age|challenge 25|purchase alcohol|\bunder 25s?\b.*\bid\b/i,
  /\bbox office\b/i,
  /click here|for (more )?info(rmation)? (on|about|visit)|please visit|see website/i,
  /\badmission\b|\bentry requirements\b|\bre-?admission\b|\bbag (policy|search)\b|\blarge bags?\b|\brucksacks?\b/i,
  /\bno (briefcases|bags|luggage)\b|\brestricted bag\b/i,
  /\bstanding\b.*\bunreserved\b|\bunreserved\b.*\bstanding\b/i,
  /\bwe recommend choosing\b/i,
  /\bevent organiser\b|\bpromoter\b.*\breserves?\b|right to refuse/i,
  /\bcard\b.*\blead booker\b|\blead booker\b/i,
  /\brefund\b|\bexchange(s|d)?\b/i,
  /doors? open|last entry|curfew|advertised door time/i,
  /general admission ticket allows entry/i,
  /\bsteep gradient\b|\bvertigo\b/i,
  /\bsecurity\b.*\bbag\b|\bbag\b.*\bsecurity\b/i,
  /^https?:\/\//i,
];

/** Strip emoji / dingbats / variation selectors and collapse whitespace. */
function stripDecoration(text: string): string {
  return text
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when a sentence is mostly SHOUTING (marketing/link lines). */
function isShouty(sentence: string): boolean {
  const letters = sentence.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^A-Z]/g, '');
  return upper.length / letters.length > 0.8;
}

const MAX_SENTENCES = 2;
const MAX_LENGTH = 220;

/**
 * Reduce a raw feed description to a clean 1–2 line About, or undefined
 * when nothing meaningful survives (the About section is then hidden).
 */
export function cleanDescription(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;

  const text = stripDecoration(raw);
  if (!text) return undefined;

  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)|.+/g) ?? [text];

  const kept: string[] = [];
  for (const s of sentences) {
    const sentence = s.trim();
    if (!sentence) continue;
    if (BOILERPLATE.some((re) => re.test(sentence))) continue;
    if (isShouty(sentence)) continue;
    kept.push(sentence);
    if (kept.length >= MAX_SENTENCES) break;
  }

  let result = kept.join(' ').trim();
  if (!result) return undefined;

  if (result.length > MAX_LENGTH) {
    const cut = result.slice(0, MAX_LENGTH);
    result = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 160)).trimEnd()}…`;
  }
  return result;
}

/**
 * Pick the best About text from feed candidates.
 * Prefer real descriptions over Ticketmaster `info` (often bag/doors copy).
 * Never pass `pleaseNote` — it is age/entry small print by definition.
 */
export function pickEventDescription(
  ...candidates: Array<string | undefined | null>
): string | undefined {
  for (const candidate of candidates) {
    const cleaned = cleanDescription(candidate);
    if (cleaned) return cleaned;
  }
  return undefined;
}
