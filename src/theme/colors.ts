/**
 * DriveIQ palette.
 *
 *   Primary:  #2D7DF6  (DriveIQ Blue)
 *   Gradient: #4CA9FF  (Light Blue, used for accents and second gradient stop)
 *   Dark BG:  #121212  (reserved for dark mode)
 *   Light BG: #FFFFFF
 *
 * Per-category accents are derived from the brand blue family and a small set
 * of supporting hues so different event types stand out on the map.
 */
export const colors = {
  primary: '#2D7DF6',
  primaryDark: '#1F62C9',
  primarySoft: '#E5F0FF',
  gradient: '#4CA9FF',
  accent: '#FF7E47',
  success: '#16A34A',

  background: '#FFFFFF',
  backgroundDark: '#121212',
  surface: '#FFFFFF',
  surfaceMuted: '#F4F7FA',

  textPrimary: '#0E2A3A',
  textSecondary: '#5B7388',
  textOnPrimary: '#FFFFFF',

  border: '#E2EAF0',
  shadow: 'rgba(14, 42, 58, 0.18)',

  // Pin / category accents
  sports: '#2D7DF6',     // Brand blue for sports
  music: '#8A4FFF',      // Purple for concerts
  theatre: '#E91E63',    // Magenta for theatre / arts
  comedy: '#FFB300',     // Amber for comedy
  film: '#FF5252',       // Red for film
  family: '#26C281',     // Green for family
  other: '#4CA9FF',      // Gradient blue fallback

  // Curated "featured" events that aren't in any API feed (e.g. Royal Ascot,
  // Epsom Derby). Gold so they stand out from the category palette.
  featured: '#E8A317',
};

export type AppColors = typeof colors;
