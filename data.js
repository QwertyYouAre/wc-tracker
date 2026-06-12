// FIFA World Cup 2026 — real draw + fixtures
// Tournament: June 11 – July 19, 2026
// "Today" for the app: 2026-06-12 (Day 2 of tournament)
//
// Group draw is the official Dec 5, 2025 draw.
// Fixtures, kick-off times and venues sourced from ESPN/FIFA published schedule.
// June 11 results (Group A) are real; June 12 onward have not yet been played.

// Bundled sample dataset — used as an offline fallback when the live
// openfootball feed can't be reached (see app.js boot()).
const FB_TOURNAMENT = {
    startDate: '2026-06-11',
    finalDate: '2026-07-19',
    today: '2026-06-12',
    nowHHMM: '14:00', // simulated "now" — early Friday afternoon, before Jun 12 kick-offs
};

// Venues — 16 host cities
const V = {
    ATL: 'Mercedes-Benz Stadium, Atlanta',
    BOS: 'Gillette Stadium, Boston',
    DAL: 'AT&T Stadium, Dallas',
    HOU: 'NRG Stadium, Houston',
    KAN: 'Arrowhead Stadium, Kansas City',
    LAX: 'SoFi Stadium, Los Angeles',
    MIA: 'Hard Rock Stadium, Miami',
    NYC: 'MetLife Stadium, New York/NJ',
    PHI: 'Lincoln Financial Field, Philadelphia',
    SFO: "Levi's Stadium, San Francisco Bay Area",
    SEA: 'Lumen Field, Seattle',
    TOR: 'BMO Field, Toronto',
    VAN: 'BC Place, Vancouver',
    GDL: 'Estadio Akron, Guadalajara',
    MEX: 'Estadio Azteca, Mexico City',
    MTY: 'Estadio BBVA, Monterrey',
};

// Official Dec 5, 2025 draw
const FB_TEAMS = [
    // Group A
    { code: 'MEX', name: 'Mexico',                 group: 'A', flag: '🇲🇽', confed: 'CONCACAF' },
    { code: 'RSA', name: 'South Africa',           group: 'A', flag: '🇿🇦', confed: 'CAF' },
    { code: 'KOR', name: 'South Korea',            group: 'A', flag: '🇰🇷', confed: 'AFC' },
    { code: 'CZE', name: 'Czechia',                group: 'A', flag: '🇨🇿', confed: 'UEFA' },
    // Group B
    { code: 'CAN', name: 'Canada',                 group: 'B', flag: '🇨🇦', confed: 'CONCACAF' },
    { code: 'BIH', name: 'Bosnia & Herzegovina',   group: 'B', flag: '🇧🇦', confed: 'UEFA' },
    { code: 'QAT', name: 'Qatar',                  group: 'B', flag: '🇶🇦', confed: 'AFC' },
    { code: 'SUI', name: 'Switzerland',            group: 'B', flag: '🇨🇭', confed: 'UEFA' },
    // Group C
    { code: 'BRA', name: 'Brazil',                 group: 'C', flag: '🇧🇷', confed: 'CONMEBOL' },
    { code: 'MAR', name: 'Morocco',                group: 'C', flag: '🇲🇦', confed: 'CAF' },
    { code: 'HAI', name: 'Haiti',                  group: 'C', flag: '🇭🇹', confed: 'CONCACAF' },
    { code: 'SCO', name: 'Scotland',               group: 'C', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', confed: 'UEFA' },
    // Group D
    { code: 'USA', name: 'United States',          group: 'D', flag: '🇺🇸', confed: 'CONCACAF' },
    { code: 'PAR', name: 'Paraguay',               group: 'D', flag: '🇵🇾', confed: 'CONMEBOL' },
    { code: 'AUS', name: 'Australia',              group: 'D', flag: '🇦🇺', confed: 'AFC' },
    { code: 'TUR', name: 'Türkiye',                group: 'D', flag: '🇹🇷', confed: 'UEFA' },
    // Group E
    { code: 'GER', name: 'Germany',                group: 'E', flag: '🇩🇪', confed: 'UEFA' },
    { code: 'CUW', name: 'Curaçao',                group: 'E', flag: '🇨🇼', confed: 'CONCACAF' },
    { code: 'CIV', name: "Côte d'Ivoire",          group: 'E', flag: '🇨🇮', confed: 'CAF' },
    { code: 'ECU', name: 'Ecuador',                group: 'E', flag: '🇪🇨', confed: 'CONMEBOL' },
    // Group F
    { code: 'NED', name: 'Netherlands',            group: 'F', flag: '🇳🇱', confed: 'UEFA' },
    { code: 'JPN', name: 'Japan',                  group: 'F', flag: '🇯🇵', confed: 'AFC' },
    { code: 'SWE', name: 'Sweden',                 group: 'F', flag: '🇸🇪', confed: 'UEFA' },
    { code: 'TUN', name: 'Tunisia',                group: 'F', flag: '🇹🇳', confed: 'CAF' },
    // Group G
    { code: 'BEL', name: 'Belgium',                group: 'G', flag: '🇧🇪', confed: 'UEFA' },
    { code: 'EGY', name: 'Egypt',                  group: 'G', flag: '🇪🇬', confed: 'CAF' },
    { code: 'IRN', name: 'Iran',                   group: 'G', flag: '🇮🇷', confed: 'AFC' },
    { code: 'NZL', name: 'New Zealand',            group: 'G', flag: '🇳🇿', confed: 'OFC' },
    // Group H
    { code: 'ESP', name: 'Spain',                  group: 'H', flag: '🇪🇸', confed: 'UEFA' },
    { code: 'CPV', name: 'Cape Verde',             group: 'H', flag: '🇨🇻', confed: 'CAF' },
    { code: 'KSA', name: 'Saudi Arabia',           group: 'H', flag: '🇸🇦', confed: 'AFC' },
    { code: 'URU', name: 'Uruguay',                group: 'H', flag: '🇺🇾', confed: 'CONMEBOL' },
    // Group I
    { code: 'FRA', name: 'France',                 group: 'I', flag: '🇫🇷', confed: 'UEFA' },
    { code: 'SEN', name: 'Senegal',                group: 'I', flag: '🇸🇳', confed: 'CAF' },
    { code: 'IRQ', name: 'Iraq',                   group: 'I', flag: '🇮🇶', confed: 'AFC' },
    { code: 'NOR', name: 'Norway',                 group: 'I', flag: '🇳🇴', confed: 'UEFA' },
    // Group J
    { code: 'ARG', name: 'Argentina',              group: 'J', flag: '🇦🇷', confed: 'CONMEBOL' },
    { code: 'ALG', name: 'Algeria',                group: 'J', flag: '🇩🇿', confed: 'CAF' },
    { code: 'AUT', name: 'Austria',                group: 'J', flag: '🇦🇹', confed: 'UEFA' },
    { code: 'JOR', name: 'Jordan',                 group: 'J', flag: '🇯🇴', confed: 'AFC' },
    // Group K
    { code: 'POR', name: 'Portugal',               group: 'K', flag: '🇵🇹', confed: 'UEFA' },
    { code: 'COD', name: 'DR Congo',               group: 'K', flag: '🇨🇩', confed: 'CAF' },
    { code: 'UZB', name: 'Uzbekistan',             group: 'K', flag: '🇺🇿', confed: 'AFC' },
    { code: 'COL', name: 'Colombia',               group: 'K', flag: '🇨🇴', confed: 'CONMEBOL' },
    // Group L
    { code: 'ENG', name: 'England',                group: 'L', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', confed: 'UEFA' },
    { code: 'CRO', name: 'Croatia',                group: 'L', flag: '🇭🇷', confed: 'UEFA' },
    { code: 'GHA', name: 'Ghana',                  group: 'L', flag: '🇬🇭', confed: 'CAF' },
    { code: 'PAN', name: 'Panama',                 group: 'L', flag: '🇵🇦', confed: 'CONCACAF' },
];

// Event shorthand
const g  = (min, side, player, assist) => ({ min, type: 'goal',   side, player, assist });
const y  = (min, side, player)         => ({ min, type: 'yellow', side, player });
const r  = (min, side, player)         => ({ min, type: 'red',    side, player });

// All 72 group-stage matches.
// All times are Eastern. Times for Mexican venues are local converted to ET.
const FB_MATCHES = [
    // ============ MATCHDAY 1 ============

    // June 11 — Group A (only matches played so far)
    { id: 'A1', group: 'A', home: 'MEX', away: 'RSA', date: '2026-06-11', time: '12:00', venue: V.MEX, status: 'finished',
      homeScore: 2, awayScore: 0,
      events: [
          g(9,'home','J. Quiñones','E. Lira'),
          g(54,'home','R. Jiménez'),
          r(63,'away','T. Mokoena'),
          r(78,'home','E. Álvarez'),
          r(85,'away','I. Jali'),
      ],
      stats: { poss:[57,43], shots:[14,7], onTarget:[6,2], corners:[7,3], fouls:[14,17] } },
    { id: 'A2', group: 'A', home: 'KOR', away: 'CZE', date: '2026-06-11', time: '22:00', venue: V.GDL, status: 'finished',
      homeScore: 2, awayScore: 1,
      events: [
          g(31,'away','L. Krejčí','V. Coufal'),
          g(57,'home','Hwang In-beom','Lee Kang-in'),
          g(82,'home','Oh Hyeon-gyu','Hwang In-beom'),
      ],
      stats: { poss:[55,45], shots:[15,9], onTarget:[6,3], corners:[6,4], fouls:[10,12] } },

    // June 12 — Group B + Group D openers
    { id: 'B1', group: 'B', home: 'CAN', away: 'BIH', date: '2026-06-12', time: '15:00', venue: V.TOR, status: 'upcoming' },
    { id: 'D1', group: 'D', home: 'USA', away: 'PAR', date: '2026-06-12', time: '21:00', venue: V.LAX, status: 'upcoming' },

    // June 13
    { id: 'B2', group: 'B', home: 'QAT', away: 'SUI', date: '2026-06-13', time: '15:00', venue: V.SFO, status: 'upcoming' },
    { id: 'C1', group: 'C', home: 'BRA', away: 'MAR', date: '2026-06-13', time: '18:00', venue: V.NYC, status: 'upcoming' },
    { id: 'C2', group: 'C', home: 'HAI', away: 'SCO', date: '2026-06-13', time: '21:00', venue: V.BOS, status: 'upcoming' },

    // June 14
    { id: 'D2', group: 'D', home: 'AUS', away: 'TUR', date: '2026-06-14', time: '00:00', venue: V.VAN, status: 'upcoming' },
    { id: 'E1', group: 'E', home: 'GER', away: 'CUW', date: '2026-06-14', time: '13:00', venue: V.HOU, status: 'upcoming' },
    { id: 'F1', group: 'F', home: 'NED', away: 'JPN', date: '2026-06-14', time: '16:00', venue: V.DAL, status: 'upcoming' },
    { id: 'E2', group: 'E', home: 'CIV', away: 'ECU', date: '2026-06-14', time: '19:00', venue: V.PHI, status: 'upcoming' },
    { id: 'F2', group: 'F', home: 'SWE', away: 'TUN', date: '2026-06-14', time: '22:00', venue: V.MTY, status: 'upcoming' },

    // June 15
    { id: 'H1', group: 'H', home: 'ESP', away: 'CPV', date: '2026-06-15', time: '12:00', venue: V.ATL, status: 'upcoming' },
    { id: 'G1', group: 'G', home: 'BEL', away: 'EGY', date: '2026-06-15', time: '15:00', venue: V.SEA, status: 'upcoming' },
    { id: 'H2', group: 'H', home: 'KSA', away: 'URU', date: '2026-06-15', time: '18:00', venue: V.MIA, status: 'upcoming' },
    { id: 'G2', group: 'G', home: 'IRN', away: 'NZL', date: '2026-06-15', time: '21:00', venue: V.LAX, status: 'upcoming' },

    // June 16
    { id: 'I1', group: 'I', home: 'FRA', away: 'SEN', date: '2026-06-16', time: '15:00', venue: V.NYC, status: 'upcoming' },
    { id: 'I2', group: 'I', home: 'IRQ', away: 'NOR', date: '2026-06-16', time: '18:00', venue: V.BOS, status: 'upcoming' },
    { id: 'J1', group: 'J', home: 'ARG', away: 'ALG', date: '2026-06-16', time: '21:00', venue: V.KAN, status: 'upcoming' },

    // June 17
    { id: 'J2', group: 'J', home: 'AUT', away: 'JOR', date: '2026-06-17', time: '00:00', venue: V.SFO, status: 'upcoming' },
    { id: 'K1', group: 'K', home: 'POR', away: 'COD', date: '2026-06-17', time: '13:00', venue: V.HOU, status: 'upcoming' },
    { id: 'L1', group: 'L', home: 'ENG', away: 'CRO', date: '2026-06-17', time: '16:00', venue: V.DAL, status: 'upcoming' },
    { id: 'L2', group: 'L', home: 'GHA', away: 'PAN', date: '2026-06-17', time: '19:00', venue: V.TOR, status: 'upcoming' },
    { id: 'K2', group: 'K', home: 'UZB', away: 'COL', date: '2026-06-17', time: '22:00', venue: V.MEX, status: 'upcoming' },

    // ============ MATCHDAY 2 ============

    // June 18 — Groups A, B
    { id: 'A3', group: 'A', home: 'CZE', away: 'RSA', date: '2026-06-18', time: '12:00', venue: V.ATL, status: 'upcoming' },
    { id: 'B3', group: 'B', home: 'SUI', away: 'BIH', date: '2026-06-18', time: '15:00', venue: V.LAX, status: 'upcoming' },
    { id: 'B4', group: 'B', home: 'CAN', away: 'QAT', date: '2026-06-18', time: '18:00', venue: V.VAN, status: 'upcoming' },
    { id: 'A4', group: 'A', home: 'MEX', away: 'KOR', date: '2026-06-18', time: '21:00', venue: V.GDL, status: 'upcoming' },

    // June 19 — Groups C, D
    { id: 'D3', group: 'D', home: 'USA', away: 'AUS', date: '2026-06-19', time: '15:00', venue: V.SEA, status: 'upcoming' },
    { id: 'C3', group: 'C', home: 'SCO', away: 'MAR', date: '2026-06-19', time: '18:00', venue: V.BOS, status: 'upcoming' },
    { id: 'C4', group: 'C', home: 'BRA', away: 'HAI', date: '2026-06-19', time: '21:00', venue: V.PHI, status: 'upcoming' },
    { id: 'D4', group: 'D', home: 'TUR', away: 'PAR', date: '2026-06-20', time: '00:00', venue: V.SFO, status: 'upcoming' },

    // June 20 — Groups E, F
    { id: 'F3', group: 'F', home: 'NED', away: 'SWE', date: '2026-06-20', time: '13:00', venue: V.HOU, status: 'upcoming' },
    { id: 'E3', group: 'E', home: 'GER', away: 'CIV', date: '2026-06-20', time: '16:00', venue: V.TOR, status: 'upcoming' },
    { id: 'E4', group: 'E', home: 'ECU', away: 'CUW', date: '2026-06-20', time: '20:00', venue: V.KAN, status: 'upcoming' },
    { id: 'F4', group: 'F', home: 'TUN', away: 'JPN', date: '2026-06-21', time: '00:00', venue: V.MTY, status: 'upcoming' },

    // June 21 — Groups G, H
    { id: 'H3', group: 'H', home: 'ESP', away: 'KSA', date: '2026-06-21', time: '12:00', venue: V.ATL, status: 'upcoming' },
    { id: 'G3', group: 'G', home: 'BEL', away: 'IRN', date: '2026-06-21', time: '15:00', venue: V.LAX, status: 'upcoming' },
    { id: 'H4', group: 'H', home: 'URU', away: 'CPV', date: '2026-06-21', time: '18:00', venue: V.MIA, status: 'upcoming' },
    { id: 'G4', group: 'G', home: 'NZL', away: 'EGY', date: '2026-06-21', time: '21:00', venue: V.VAN, status: 'upcoming' },

    // June 22 — Groups I, J
    { id: 'I3', group: 'I', home: 'FRA', away: 'IRQ', date: '2026-06-22', time: '17:00', venue: V.PHI, status: 'upcoming' },
    { id: 'I4', group: 'I', home: 'NOR', away: 'SEN', date: '2026-06-22', time: '20:00', venue: V.NYC, status: 'upcoming' },
    { id: 'J3', group: 'J', home: 'ARG', away: 'AUT', date: '2026-06-22', time: '13:00', venue: V.DAL, status: 'upcoming' },
    { id: 'J4', group: 'J', home: 'JOR', away: 'ALG', date: '2026-06-22', time: '23:00', venue: V.SFO, status: 'upcoming' },

    // June 23 — Groups K, L
    { id: 'K3', group: 'K', home: 'POR', away: 'UZB', date: '2026-06-23', time: '13:00', venue: V.HOU, status: 'upcoming' },
    { id: 'L3', group: 'L', home: 'ENG', away: 'GHA', date: '2026-06-23', time: '16:00', venue: V.BOS, status: 'upcoming' },
    { id: 'L4', group: 'L', home: 'PAN', away: 'CRO', date: '2026-06-23', time: '19:00', venue: V.TOR, status: 'upcoming' },
    { id: 'K4', group: 'K', home: 'COL', away: 'COD', date: '2026-06-23', time: '22:00', venue: V.GDL, status: 'upcoming' },

    // ============ MATCHDAY 3 ============ (final pair per group plays simultaneously)

    // June 24 — Groups A, B, C, D, E, F
    { id: 'A5', group: 'A', home: 'CZE', away: 'MEX', date: '2026-06-24', time: '21:00', venue: V.MEX, status: 'upcoming' },
    { id: 'A6', group: 'A', home: 'RSA', away: 'KOR', date: '2026-06-24', time: '21:00', venue: V.MTY, status: 'upcoming' },
    { id: 'B5', group: 'B', home: 'SUI', away: 'CAN', date: '2026-06-24', time: '15:00', venue: V.VAN, status: 'upcoming' },
    { id: 'B6', group: 'B', home: 'BIH', away: 'QAT', date: '2026-06-24', time: '15:00', venue: V.SEA, status: 'upcoming' },
    { id: 'C5', group: 'C', home: 'SCO', away: 'BRA', date: '2026-06-24', time: '18:00', venue: V.MIA, status: 'upcoming' },
    { id: 'C6', group: 'C', home: 'MAR', away: 'HAI', date: '2026-06-24', time: '18:00', venue: V.ATL, status: 'upcoming' },
    { id: 'D5', group: 'D', home: 'TUR', away: 'USA', date: '2026-06-24', time: '22:00', venue: V.LAX, status: 'upcoming' },
    { id: 'D6', group: 'D', home: 'PAR', away: 'AUS', date: '2026-06-24', time: '22:00', venue: V.SFO, status: 'upcoming' },
    { id: 'E5', group: 'E', home: 'ECU', away: 'GER', date: '2026-06-24', time: '16:00', venue: V.NYC, status: 'upcoming' },
    { id: 'E6', group: 'E', home: 'CUW', away: 'CIV', date: '2026-06-24', time: '16:00', venue: V.PHI, status: 'upcoming' },
    { id: 'F5', group: 'F', home: 'JPN', away: 'SWE', date: '2026-06-24', time: '19:00', venue: V.DAL, status: 'upcoming' },
    { id: 'F6', group: 'F', home: 'TUN', away: 'NED', date: '2026-06-24', time: '19:00', venue: V.KAN, status: 'upcoming' },

    // June 25 — Groups G, H, I, J, K, L
    { id: 'G5', group: 'G', home: 'EGY', away: 'IRN', date: '2026-06-25', time: '23:00', venue: V.SEA, status: 'upcoming' },
    { id: 'G6', group: 'G', home: 'NZL', away: 'BEL', date: '2026-06-25', time: '23:00', venue: V.VAN, status: 'upcoming' },
    { id: 'H5', group: 'H', home: 'CPV', away: 'KSA', date: '2026-06-25', time: '20:00', venue: V.HOU, status: 'upcoming' },
    { id: 'H6', group: 'H', home: 'URU', away: 'ESP', date: '2026-06-25', time: '20:00', venue: V.GDL, status: 'upcoming' },
    { id: 'I5', group: 'I', home: 'NOR', away: 'FRA', date: '2026-06-25', time: '15:00', venue: V.BOS, status: 'upcoming' },
    { id: 'I6', group: 'I', home: 'SEN', away: 'IRQ', date: '2026-06-25', time: '15:00', venue: V.TOR, status: 'upcoming' },
    { id: 'J5', group: 'J', home: 'ALG', away: 'AUT', date: '2026-06-25', time: '22:00', venue: V.KAN, status: 'upcoming' },
    { id: 'J6', group: 'J', home: 'JOR', away: 'ARG', date: '2026-06-25', time: '22:00', venue: V.DAL, status: 'upcoming' },
    { id: 'K5', group: 'K', home: 'COL', away: 'POR', date: '2026-06-25', time: '19:30', venue: V.MIA, status: 'upcoming' },
    { id: 'K6', group: 'K', home: 'COD', away: 'UZB', date: '2026-06-25', time: '19:30', venue: V.ATL, status: 'upcoming' },
    { id: 'L5', group: 'L', home: 'PAN', away: 'ENG', date: '2026-06-25', time: '17:00', venue: V.NYC, status: 'upcoming' },
    { id: 'L6', group: 'L', home: 'CRO', away: 'GHA', date: '2026-06-25', time: '17:00', venue: V.PHI, status: 'upcoming' },
];

// Offline fallback dataset consumed by app.js when the live feed is unavailable.
const FALLBACK_DATA = { tournament: FB_TOURNAMENT, teams: FB_TEAMS, matches: FB_MATCHES };
