import { colors } from '@/theme/colors';
import type { AppEvent } from '@/types/event';

/**
 * Maps an event onto the icon shown on its map pin and on filter chips.
 *
 * Two pin variants:
 *   - 'logo'  — DriveIQ brand mark (used for music, theatre, comedy, film,
 *               family, other). Single accent colour per category.
 *   - 'glyph' — sport-specific emoji (football, rugby, cricket, basketball,
 *               NFL, tennis, etc.). Sports are SportMonks fixtures and merit
 *               a recognisable category-specific symbol.
 */

export type CategoryFilterKey =
  | 'sports'
  | 'music'
  | 'theatre'
  | 'comedy'
  | 'film'
  | 'family'
  | 'other';

export interface CategoryDescriptor {
  key: CategoryFilterKey;
  label: string;
  icon: string;
  color: string;
}

export const CATEGORY_FILTERS: CategoryDescriptor[] = [
  { key: 'sports', label: 'Sports', icon: '🏆', color: colors.sports },
  { key: 'music', label: 'Music', icon: '🎵', color: colors.music },
  { key: 'theatre', label: 'Theatre', icon: '🎭', color: colors.theatre },
  { key: 'comedy', label: 'Comedy', icon: '😄', color: colors.comedy },
  { key: 'film', label: 'Film', icon: '🎬', color: colors.film },
  { key: 'family', label: 'Family', icon: '🎈', color: colors.family },
  { key: 'other', label: 'Other', icon: '✨', color: colors.other },
];

/** Bucket an event into one of the category filter keys. */
export function categoryFilterFor(event: AppEvent): CategoryFilterKey {
  if (event.category === 'sports') return 'sports';
  const sub = (event.subCategory ?? '').toLowerCase();
  if (sub.includes('music') || sub.includes('concert')) return 'music';
  if (sub.includes('theatre') || sub.includes('arts')) return 'theatre';
  if (sub.includes('comedy')) return 'comedy';
  if (sub.includes('film')) return 'film';
  if (sub.includes('family')) return 'family';
  return 'other';
}

/** Hand-curated (built-in featured list) or hand-added on the admin page. */
export function isCuratedEvent(event: Pick<AppEvent, 'source'>): boolean {
  return event.source === 'featured' || event.source === 'manual';
}

export type PinDescriptor =
  | { kind: 'logo'; color: string; featured?: boolean }
  | { kind: 'glyph'; icon: string; color: string; featured?: boolean };

/**
 * Pin descriptor for a single event.
 *
 * - Featured events (curated, source === 'featured') → sport/category glyph
 *   in featured gold with a star badge, so big one-offs that aren't in any
 *   API feed (Royal Ascot, Epsom Derby) jump off the map.
 * - SportMonks fixtures (sports category) → sport-specific glyph in brand blue.
 *   The sub-category drives the symbol so a football match, rugby fixture,
 *   cricket test, NFL game, basketball game etc. each render distinctly.
 * - Everything else → DriveIQ logo mark coloured by category accent.
 */
export function pinDescriptorFor(event: AppEvent): PinDescriptor {
  const featured = isCuratedEvent(event);
  const accent = featured ? colors.featured : colors.sports;

  if (event.category === 'sports') {
    const sub = (event.subCategory ?? '').toLowerCase();
    const name = (event.title ?? '').toLowerCase();
    const hay = `${sub} ${name}`;

    // Order matters — check NFL / American football before generic rugby so
    // an "NFL London" fixture doesn't fall through to the rugby glyph, and
    // before generic football so "football" alone still means soccer.
    if (
      hay.includes('horse') ||
      hay.includes('racing') ||
      hay.includes('ascot') ||
      hay.includes('epsom') ||
      hay.includes('derby day') ||
      hay.includes('grand national')
    )
      return { kind: 'glyph', icon: '🏇', color: accent, featured };
    if (
      hay.includes('nfl') ||
      hay.includes('american football') ||
      hay.includes('gridiron')
    )
      return { kind: 'glyph', icon: '🏈', color: accent, featured };
    if (hay.includes('cricket'))
      return { kind: 'glyph', icon: '🏏', color: accent, featured };
    if (hay.includes('basketball') || hay.includes('nba'))
      return { kind: 'glyph', icon: '🏀', color: accent, featured };
    if (hay.includes('tennis'))
      return { kind: 'glyph', icon: '🎾', color: accent, featured };
    if (hay.includes('rugby'))
      return { kind: 'glyph', icon: '🏉', color: accent, featured };
    if (hay.includes('box'))
      return { kind: 'glyph', icon: '🥊', color: accent, featured };
    if (hay.includes('wrestl') || hay.includes('wwe') || hay.includes('wwf'))
      return { kind: 'glyph', icon: '🤼', color: accent, featured };
    if (hay.includes('dart'))
      return { kind: 'glyph', icon: '🎯', color: accent, featured };
    if (hay.includes('esport') || hay.includes('e-sport') || hay.includes('gaming'))
      return { kind: 'glyph', icon: '🎮', color: accent, featured };
    if (hay.includes('run') || hay.includes('marathon'))
      return { kind: 'glyph', icon: '🏃', color: accent, featured };
    if (hay.includes('hockey'))
      return { kind: 'glyph', icon: '🏒', color: accent, featured };
    if (hay.includes('golf'))
      return { kind: 'glyph', icon: '⛳', color: accent, featured };
    // Default sport pin = football (soccer) — by far the most common London fixture.
    return { kind: 'glyph', icon: '⚽', color: accent, featured };
  }

  // Non-sports: DriveIQ brand mark on a category-accent bubble.
  const bucket = categoryFilterFor(event);
  const desc = CATEGORY_FILTERS.find((c) => c.key === bucket);
  return {
    kind: 'logo',
    color: featured ? colors.featured : desc?.color ?? colors.primary,
    featured,
  };
}
