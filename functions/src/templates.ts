/** Template fallbacks. A blunt line beats a missing alert. */

const clean = (s?: string | null): string =>
  (s ?? '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();

export function templateFromRaw(kind: string, raw: string): string {
  const text = clean(raw);
  if (kind === 'road') return text || 'Road disruption. Check the map before you set off.';
  if (kind === 'rail') return text || 'Line disruption. Check Connections before you set off.';
  if (kind === 'flight') return text || 'Flight change. Check the arrivals board.';
  return text || 'Event in London tonight.';
}
