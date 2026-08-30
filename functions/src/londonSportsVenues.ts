/**
 * London sports grounds + club aliases for server ingest.
 * ESPN/FotMob only get a pin if we can resolve the venue here.
 * Longest alias wins so "Wimbledon Championships" does not land at Plough Lane.
 */

export interface SportsPlace {
  venue: string;
  latitude: number;
  longitude: number;
}

const PLACES: Record<string, SportsPlace> = {
  'emirates stadium': { venue: 'Emirates Stadium', latitude: 51.5549, longitude: -0.1084 },
  arsenal: { venue: 'Emirates Stadium', latitude: 51.5549, longitude: -0.1084 },
  'stamford bridge': { venue: 'Stamford Bridge', latitude: 51.4816, longitude: -0.1909 },
  chelsea: { venue: 'Stamford Bridge', latitude: 51.4816, longitude: -0.1909 },
  'tottenham hotspur stadium': { venue: 'Tottenham Hotspur Stadium', latitude: 51.6043, longitude: -0.0664 },
  'tottenham hotspur': { venue: 'Tottenham Hotspur Stadium', latitude: 51.6043, longitude: -0.0664 },
  tottenham: { venue: 'Tottenham Hotspur Stadium', latitude: 51.6043, longitude: -0.0664 },
  spurs: { venue: 'Tottenham Hotspur Stadium', latitude: 51.6043, longitude: -0.0664 },
  'london stadium': { venue: 'London Stadium', latitude: 51.5386, longitude: -0.0166 },
  'west ham united': { venue: 'London Stadium', latitude: 51.5386, longitude: -0.0166 },
  'west ham': { venue: 'London Stadium', latitude: 51.5386, longitude: -0.0166 },
  'selhurst park': { venue: 'Selhurst Park', latitude: 51.3983, longitude: -0.0855 },
  'crystal palace': { venue: 'Selhurst Park', latitude: 51.3983, longitude: -0.0855 },
  'craven cottage': { venue: 'Craven Cottage', latitude: 51.475, longitude: -0.2216 },
  fulham: { venue: 'Craven Cottage', latitude: 51.475, longitude: -0.2216 },
  'gtech community stadium': { venue: 'Gtech Community Stadium', latitude: 51.4906, longitude: -0.2885 },
  'brentford community stadium': { venue: 'Gtech Community Stadium', latitude: 51.4906, longitude: -0.2885 },
  brentford: { venue: 'Gtech Community Stadium', latitude: 51.4906, longitude: -0.2885 },
  'kiyan prince foundation stadium': { venue: 'Loftus Road', latitude: 51.5093, longitude: -0.2326 },
  'loftus road': { venue: 'Loftus Road', latitude: 51.5093, longitude: -0.2326 },
  'queens park rangers': { venue: 'Loftus Road', latitude: 51.5093, longitude: -0.2326 },
  qpr: { venue: 'Loftus Road', latitude: 51.5093, longitude: -0.2326 },
  'the den': { venue: 'The Den', latitude: 51.4859, longitude: -0.0509 },
  millwall: { venue: 'The Den', latitude: 51.4859, longitude: -0.0509 },
  'vicarage road stadium': { venue: 'Vicarage Road', latitude: 51.6498, longitude: -0.4017 },
  'vicarage road': { venue: 'Vicarage Road', latitude: 51.6498, longitude: -0.4017 },
  watford: { venue: 'Vicarage Road', latitude: 51.6498, longitude: -0.4017 },
  'kenilworth road stadium': { venue: 'Kenilworth Road', latitude: 51.8842, longitude: -0.4317 },
  'kenilworth road': { venue: 'Kenilworth Road', latitude: 51.8842, longitude: -0.4317 },
  'luton town': { venue: 'Kenilworth Road', latitude: 51.8842, longitude: -0.4317 },
  luton: { venue: 'Kenilworth Road', latitude: 51.8842, longitude: -0.4317 },
  'stadium:mk': { venue: 'Stadium MK', latitude: 52.0093, longitude: -0.7345 },
  'stadium mk': { venue: 'Stadium MK', latitude: 52.0093, longitude: -0.7345 },
  'milton keynes dons': { venue: 'Stadium MK', latitude: 52.0093, longitude: -0.7345 },
  'mk dons': { venue: 'Stadium MK', latitude: 52.0093, longitude: -0.7345 },
  'the valley': { venue: 'The Valley', latitude: 51.4865, longitude: 0.0364 },
  'charlton athletic': { venue: 'The Valley', latitude: 51.4865, longitude: 0.0364 },
  charlton: { venue: 'The Valley', latitude: 51.4865, longitude: 0.0364 },
  'brisbane road': { venue: 'Brisbane Road', latitude: 51.5601, longitude: -0.0125 },
  'breyer group stadium': { venue: 'Brisbane Road', latitude: 51.5601, longitude: -0.0125 },
  'leyton orient': { venue: 'Brisbane Road', latitude: 51.5601, longitude: -0.0125 },
  'plough lane': { venue: 'Plough Lane', latitude: 51.4318, longitude: -0.1996 },
  'cherry red records stadium': { venue: 'Plough Lane', latitude: 51.4318, longitude: -0.1996 },
  'afc wimbledon': { venue: 'Plough Lane', latitude: 51.4318, longitude: -0.1996 },
  'hayes lane': { venue: 'Hayes Lane', latitude: 51.3999, longitude: 0.0148 },
  bromley: { venue: 'Hayes Lane', latitude: 51.3999, longitude: 0.0148 },
  'the hive stadium': { venue: 'The Hive Stadium', latitude: 51.6057, longitude: -0.2942 },
  barnet: { venue: 'The Hive Stadium', latitude: 51.6057, longitude: -0.2942 },
  'gander green lane': { venue: 'Gander Green Lane', latitude: 51.3669, longitude: -0.2017 },
  'sutton united': { venue: 'Gander Green Lane', latitude: 51.3669, longitude: -0.2017 },
  'victoria road': { venue: 'Victoria Road', latitude: 51.5453, longitude: 0.1357 },
  'dagenham and redbridge': { venue: 'Victoria Road', latitude: 51.5453, longitude: 0.1357 },
  'dagenham redbridge': { venue: 'Victoria Road', latitude: 51.5453, longitude: 0.1357 },
  'dag and red': { venue: 'Victoria Road', latitude: 51.5453, longitude: 0.1357 },
  'kingfield stadium': { venue: 'Kingfield Stadium', latitude: 51.3102, longitude: -0.5528 },
  woking: { venue: 'Kingfield Stadium', latitude: 51.3102, longitude: -0.5528 },
  "lord's cricket ground": { venue: "Lord's Cricket Ground", latitude: 51.5294, longitude: -0.1727 },
  "lord's": { venue: "Lord's Cricket Ground", latitude: 51.5294, longitude: -0.1727 },
  lords: { venue: "Lord's Cricket Ground", latitude: 51.5294, longitude: -0.1727 },
  'london spirit': { venue: "Lord's Cricket Ground", latitude: 51.5294, longitude: -0.1727 },
  middlesex: { venue: "Lord's Cricket Ground", latitude: 51.5294, longitude: -0.1727 },
  'kia oval': { venue: 'The Oval', latitude: 51.4837, longitude: -0.1145 },
  'kennington oval': { venue: 'The Oval', latitude: 51.4837, longitude: -0.1145 },
  'the oval': { venue: 'The Oval', latitude: 51.4837, longitude: -0.1145 },
  kennington: { venue: 'The Oval', latitude: 51.4837, longitude: -0.1145 },
  'oval invincibles': { venue: 'The Oval', latitude: 51.4837, longitude: -0.1145 },
  surrey: { venue: 'The Oval', latitude: 51.4837, longitude: -0.1145 },
  'allianz stadium': { venue: 'Twickenham Stadium', latitude: 51.4561, longitude: -0.3415 },
  'twickenham stadium': { venue: 'Twickenham Stadium', latitude: 51.4561, longitude: -0.3415 },
  twickenham: { venue: 'Twickenham Stadium', latitude: 51.4561, longitude: -0.3415 },
  'london irish': { venue: 'Twickenham Stadium', latitude: 51.4561, longitude: -0.3415 },
  'stonex stadium': { venue: 'StoneX Stadium', latitude: 51.6191, longitude: -0.2244 },
  'allianz park': { venue: 'StoneX Stadium', latitude: 51.6191, longitude: -0.2244 },
  saracens: { venue: 'StoneX Stadium', latitude: 51.6191, longitude: -0.2244 },
  'twickenham stoop': { venue: 'The Stoop', latitude: 51.4538, longitude: -0.346 },
  'the stoop': { venue: 'The Stoop', latitude: 51.4538, longitude: -0.346 },
  harlequins: { venue: 'The Stoop', latitude: 51.4538, longitude: -0.346 },
  'wembley stadium': { venue: 'Wembley Stadium', latitude: 51.556, longitude: -0.2796 },
  'the o2 arena': { venue: 'The O2 Arena', latitude: 51.503, longitude: 0.003 },
  'o2 arena': { venue: 'The O2 Arena', latitude: 51.503, longitude: 0.003 },
  'the o2': { venue: 'The O2 Arena', latitude: 51.503, longitude: 0.003 },
  'ovo arena wembley': { venue: 'OVO Arena Wembley', latitude: 51.5586, longitude: -0.2826 },
  'wembley arena': { venue: 'OVO Arena Wembley', latitude: 51.5586, longitude: -0.2826 },
  'copper box arena': { venue: 'Copper Box Arena', latitude: 51.5462, longitude: -0.0153 },
  'copper box': { venue: 'Copper Box Arena', latitude: 51.5462, longitude: -0.0153 },
  'all england lawn tennis club': { venue: 'All England Lawn Tennis Club', latitude: 51.4348, longitude: -0.2138 },
  'the championships wimbledon': { venue: 'All England Lawn Tennis Club', latitude: 51.4348, longitude: -0.2138 },
  'wimbledon championships': { venue: 'All England Lawn Tennis Club', latitude: 51.4348, longitude: -0.2138 },
  'all england club': { venue: 'All England Lawn Tennis Club', latitude: 51.4348, longitude: -0.2138 },
  'centre court': { venue: 'All England Lawn Tennis Club', latitude: 51.4348, longitude: -0.2138 },
  aeltc: { venue: 'All England Lawn Tennis Club', latitude: 51.4348, longitude: -0.2138 },
  "the queen's club": { venue: "The Queen's Club", latitude: 51.4886, longitude: -0.2122 },
  "queen's club": { venue: "The Queen's Club", latitude: 51.4886, longitude: -0.2122 },
  'queens club': { venue: "The Queen's Club", latitude: 51.4886, longitude: -0.2122 },
  'ascot racecourse': { venue: 'Ascot Racecourse', latitude: 51.4139, longitude: -0.6796 },
  'epsom downs racecourse': { venue: 'Epsom Downs Racecourse', latitude: 51.311, longitude: -0.2577 },
  'epsom downs': { venue: 'Epsom Downs Racecourse', latitude: 51.311, longitude: -0.2577 },
  'sandown park racecourse': { venue: 'Sandown Park Racecourse', latitude: 51.3745, longitude: -0.3643 },
  'sandown park': { venue: 'Sandown Park Racecourse', latitude: 51.3745, longitude: -0.3643 },
  'kempton park racecourse': { venue: 'Kempton Park Racecourse', latitude: 51.4194, longitude: -0.4106 },
  'kempton park': { venue: 'Kempton Park Racecourse', latitude: 51.4194, longitude: -0.4106 },
  'royal windsor racecourse': { venue: 'Royal Windsor Racecourse', latitude: 51.4903, longitude: -0.6224 },
  'windsor racecourse': { venue: 'Royal Windsor Racecourse', latitude: 51.4903, longitude: -0.6224 },
  'crystal palace national sports centre': {
    venue: 'Crystal Palace National Sports Centre',
    latitude: 51.418,
    longitude: -0.0735,
  },
  'excel london': { venue: 'ExCeL London', latitude: 51.5079, longitude: 0.0297 },
  wimbledon: { venue: 'Plough Lane', latitude: 51.4318, longitude: -0.1996 },
};

const EXACT_ONLY = new Set(['oval', 'wembley', 'emirates', 'excel']);
const PLACE_KEYS = Object.keys(PLACES).sort((a, b) => b.length - a.length);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(fc|afc|cf|ccc|rfc)\b/g, ' ')
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findSportsPlace(...candidates: (string | undefined | null)[]): SportsPlace | null {
  for (const raw of candidates) {
    if (!raw) continue;
    const n = normalize(raw);
    if (!n) continue;
    if (PLACES[n]) return PLACES[n];
    for (const key of PLACE_KEYS) {
      if (EXACT_ONLY.has(key)) continue;
      if (key.length < 4) continue;
      const re = new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
      if (re.test(n)) return PLACES[key];
    }
  }
  return null;
}

export function resolveSportsPlace(venue?: string | null, homeTeam?: string | null): SportsPlace | null {
  const named = venue?.trim();
  if (named) return findSportsPlace(named);
  const home = homeTeam?.trim();
  if (home) return findSportsPlace(home);
  return null;
}

export const FOTMOB_CLUBS: {
  teamId: number;
  venue: string;
  locationMatch: string[];
  label: string;
}[] = [
  { teamId: 9825, venue: 'Emirates Stadium', locationMatch: ['emirates'], label: 'Arsenal' },
  { teamId: 8455, venue: 'Stamford Bridge', locationMatch: ['stamford bridge'], label: 'Chelsea' },
  { teamId: 8586, venue: 'Tottenham Hotspur Stadium', locationMatch: ['tottenham hotspur stadium'], label: 'Tottenham' },
  { teamId: 8654, venue: 'London Stadium', locationMatch: ['london stadium'], label: 'West Ham' },
  { teamId: 9826, venue: 'Selhurst Park', locationMatch: ['selhurst'], label: 'Crystal Palace' },
  { teamId: 9879, venue: 'Craven Cottage', locationMatch: ['craven cottage'], label: 'Fulham' },
  { teamId: 9937, venue: 'Gtech Community Stadium', locationMatch: ['gtech'], label: 'Brentford' },
  { teamId: 10172, venue: 'Loftus Road', locationMatch: ['loftus'], label: 'QPR' },
  { teamId: 10004, venue: 'The Den', locationMatch: ['the den'], label: 'Millwall' },
  { teamId: 8451, venue: 'The Valley', locationMatch: ['the valley'], label: 'Charlton' },
  { teamId: 8351, venue: 'Brisbane Road', locationMatch: ['brisbane', 'betwright'], label: 'Leyton Orient' },
  { teamId: 158319, venue: 'Plough Lane', locationMatch: ['plough lane'], label: 'AFC Wimbledon' },
  { teamId: 45729, venue: 'Hayes Lane', locationMatch: ['hayes lane', 'copperjax'], label: 'Bromley' },
  { teamId: 9817, venue: 'Vicarage Road', locationMatch: ['vicarage'], label: 'Watford' },
  { teamId: 8346, venue: 'Kenilworth Road', locationMatch: ['kenilworth'], label: 'Luton Town' },
  { teamId: 8645, venue: 'Stadium MK', locationMatch: ['stadium mk', 'stadium:mk'], label: 'MK Dons' },
];
