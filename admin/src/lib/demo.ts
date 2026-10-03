/**
 * DEMO_DATA=1: every page renders made-up sample data and login is skipped.
 * For previewing the design without production access. Never set in hosting.
 */
export function isDemo(): boolean {
  return process.env.DEMO_DATA === '1' && process.env.NODE_ENV !== 'production';
}
