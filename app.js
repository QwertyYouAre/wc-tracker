// ===== WC Tracker — main app logic =====

const STATE = {
    favorites: new Set(JSON.parse(localStorage.getItem('wc26-favs') || '[]')),
    filter: 'all',
    standings: {}, // groupLetter -> sorted [{ team, p, w, d, l, gf, ga, gd, pts }]
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ===== FLAGS =====
// FIFA 3-letter code → ISO 3166-1 alpha-2 (with gb-eng / gb-sct for home nations)
const FIFA_TO_ISO = {
    MEX:'mx', RSA:'za', KOR:'kr', CZE:'cz',
    CAN:'ca', BIH:'ba', QAT:'qa', SUI:'ch',
    BRA:'br', MAR:'ma', HAI:'ht', SCO:'gb-sct',
    USA:'us', PAR:'py', AUS:'au', TUR:'tr',
    GER:'de', CUW:'cw', CIV:'ci', ECU:'ec',
    NED:'nl', JPN:'jp', SWE:'se', TUN:'tn',
    BEL:'be', EGY:'eg', IRN:'ir', NZL:'nz',
    ESP:'es', CPV:'cv', KSA:'sa', URU:'uy',
    FRA:'fr', SEN:'sn', IRQ:'iq', NOR:'no',
    ARG:'ar', ALG:'dz', AUT:'at', JOR:'jo',
    POR:'pt', COD:'cd', UZB:'uz', COL:'co',
    ENG:'gb-eng', CRO:'hr', GHA:'gh', PAN:'pa',
};

function teamFlag(team) {
    if (!team || team.placeholder) return '<span class="flag-img placeholder" aria-hidden="true"></span>';
    const iso = FIFA_TO_ISO[team.code];
    if (!iso) return `<span class="flag-img placeholder" aria-hidden="true">${team.code}</span>`;
    return `<img class="flag-img" src="flags/${iso}.png" alt="${team.code}" loading="lazy" decoding="async">`;
}

// ===== DATA STATE (populated by setDataset() after load) =====
let TOURNAMENT, TEAMS, MATCHES, TEAM;
let todayDate, startDate, NOW_INSTANT, LOCAL_TODAY;

// ===== DATE / TIME HELPERS =====
// Live (openfootball) fixtures carry an absolute `kickoffISO`. Bundled fallback
// fixtures store a US Eastern wall-clock date+time; convert those to an instant.
const SOURCE_TZ = 'America/New_York';

function tzOffsetMs(timeZone, date) {
    // Offset (ms) of `timeZone` from UTC at the given instant.
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
    // Intl can emit hour "24" at midnight — normalize to 0.
    const hour = p.hour === '24' ? 0 : +p.hour;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
    return asUTC - date.getTime();
}

function kickoffInstant(dateStr, timeStr) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const [h, mi] = timeStr.split(':').map(Number);
    const naive = Date.UTC(y, mo - 1, d, h, mi); // ET wall-clock treated as if UTC
    return new Date(naive - tzOffsetMs(SOURCE_TZ, new Date(naive)));
}

// The absolute instant a match kicks off, as a Date.
function instantOf(m) {
    if (m.instant) return m.instant;
    return m.kickoffISO ? new Date(m.kickoffISO) : kickoffInstant(m.date, m.time);
}

function tournamentDay() {
    const today = new Date(todayDate + 'T00:00:00');
    return Math.floor((today - startDate) / 86400000) + 1;
}

// Display helpers take a match and render its instant in the viewer's local zone.
function fmtLocalTime(m) {
    return instantOf(m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtLocalDate(m) {
    return instantOf(m).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtLocalDateTime(m) {
    const inst = instantOf(m);
    const date = inst.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const time = inst.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
    return `${date} · ${time}`;
}

// YYYY-MM-DD calendar date of the kickoff in the viewer's local zone (sortable/comparable).
function localDateKey(m) {
    return instantOf(m).toLocaleDateString('en-CA');
}

function minutesUntil(m) {
    return Math.round((instantOf(m) - NOW_INSTANT) / 60000);
}

function relativeUntil(m) {
    const mins = minutesUntil(m);
    if (mins < 0) return '';
    if (mins < 60) return `in ${mins}m`;
    if (mins < 24 * 60) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
    const days = Math.floor(mins / (24 * 60));
    return days === 1 ? 'tomorrow' : `in ${days}d`;
}

// ===== STANDINGS =====
function computeStandings() {
    const out = {};
    const groups = [...new Set(TEAMS.map(t => t.group))].sort();
    for (const g of groups) {
        const teams = TEAMS.filter(t => t.group === g);
        const rows = teams.map(t => ({
            team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0
        }));
        const byCode = Object.fromEntries(rows.map(r => [r.team.code, r]));
        const matches = MATCHES.filter(m => m.group === g && (m.status === 'finished' || m.status === 'live'));
        for (const m of matches) {
            const h = byCode[m.home], a = byCode[m.away];
            const hs = m.homeScore ?? 0, as = m.awayScore ?? 0;
            // only count finished matches in P/W/D/L
            if (m.status === 'finished') {
                h.p++; a.p++;
                h.gf += hs; h.ga += as;
                a.gf += as; a.ga += hs;
                if (hs > as) { h.w++; h.pts += 3; a.l++; }
                else if (hs < as) { a.w++; a.pts += 3; h.l++; }
                else { h.d++; a.d++; h.pts++; a.pts++; }
            }
        }
        rows.forEach(r => r.gd = r.gf - r.ga);
        rows.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.name.localeCompare(y.team.name));
        out[g] = rows;
    }
    return out;
}

function bestThirds() {
    const thirds = [];
    for (const g of Object.keys(STATE.standings)) {
        const r = STATE.standings[g][2];
        if (r) thirds.push({ group: g, ...r });
    }
    thirds.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.name.localeCompare(y.team.name));
    return thirds;
}

// ===== TOP SCORERS =====
function computeScorers() {
    const goals = new Map(); // key: player|teamCode -> count
    for (const m of MATCHES) {
        if (!m.events) continue;
        for (const ev of m.events) {
            if (ev.type !== 'goal') continue;
            const teamCode = ev.side === 'home' ? m.home : m.away;
            const key = `${ev.player}|${teamCode}`;
            goals.set(key, (goals.get(key) || 0) + 1);
        }
    }
    return [...goals.entries()]
        .map(([k, count]) => {
            const [player, teamCode] = k.split('|');
            return { player, team: TEAM[teamCode], goals: count };
        })
        .sort((a, b) => b.goals - a.goals || a.player.localeCompare(b.player));
}

// Rough live minute estimated from kickoff (football-data's list endpoint omits it).
// Approximates the ~15-min half-time break; not exact during stoppage time.
function estimateMinute(m) {
    const elapsed = Math.floor((Date.now() - instantOf(m).getTime()) / 60000);
    if (elapsed < 0) return null;
    if (elapsed <= 45) return elapsed;   // first half
    if (elapsed <= 60) return 45;        // half-time window
    return Math.min(elapsed - 15, 91);   // second half (minus the break)
}

// "LIVE · 63'" / "LIVE · 90+'" when the minute is known or can be estimated, else "LIVE".
function liveLabel(m) {
    const min = m.apiMinute ?? estimateMinute(m);
    if (min == null) return 'LIVE';
    return min > 90 ? "LIVE · 90+'" : `LIVE · ${min}'`;
}

// ===== MATCH CARD =====
function matchCard(m) {
    const home = TEAM[m.home], away = TEAM[m.away];
    const isFav = isFavMatch(m);
    const cls = ['match-card', m.status === 'live' ? 'live' : '', isFav ? 'favorite' : ''].filter(Boolean).join(' ');

    let scoreHtml, statusHtml;
    if (m.status === 'live') {
        scoreHtml = `<div class="mc-score">${m.homeScore} – ${m.awayScore}</div>`;
        statusHtml = `<span class="live-tag"><span class="live-dot"></span>${liveLabel(m)}</span>`;
    } else if (m.status === 'finished') {
        scoreHtml = `<div class="mc-score">${m.homeScore} – ${m.awayScore}</div>`;
        statusHtml = `<span>FT · ${fmtLocalDate(m)}</span>`;
    } else {
        scoreHtml = `<div class="mc-score"><span class="vs">${fmtLocalTime(m)}</span></div>`;
        statusHtml = `<span>${fmtLocalDate(m)}</span>`;
    }

    const countdownHtml = m.status === 'upcoming' && (localDateKey(m) === LOCAL_TODAY || minutesUntil(m) <= 24 * 60)
        ? `<span class="mc-countdown">${relativeUntil(m)}</span>`
        : '';

    return `
        <div class="${cls}" data-match="${m.id}">
            <div class="mc-top">
                <span><span class="mc-group-tag">${m.group}</span> Group ${m.group}</span>
                ${statusHtml}
            </div>
            <div class="mc-teams">
                <div class="mc-team">
                    <span class="mc-flag">${teamFlag(home)}</span>
                    <span class="mc-name">${home.name}</span>
                </div>
                ${scoreHtml}
                <div class="mc-team away">
                    <span class="mc-flag">${teamFlag(away)}</span>
                    <span class="mc-name">${away.name}</span>
                </div>
            </div>
            <div class="mc-bottom">
                <span class="mc-venue">📍 ${m.venue}</span>
                ${countdownHtml}
            </div>
        </div>
    `;
}

// ===== LIVE / UPCOMING SECTION =====
const isFavMatch = (m) => STATE.favorites.has(m.home) || STATE.favorites.has(m.away);

function renderLiveSection() {
    const matchPasses = (m) => {
        if (STATE.filter === 'live') return m.status === 'live';
        if (STATE.filter === 'upcoming') return m.status === 'upcoming';
        if (STATE.filter === 'finished') return m.status === 'finished';
        if (STATE.filter === 'favorites') return isFavMatch(m);
        return true;
    };

    // Favorited teams' games come first, then chronological within each group.
    const byFavThenTime = (a, b) => {
        const fa = isFavMatch(a), fb = isFavMatch(b);
        if (fa !== fb) return fa ? -1 : 1;
        return instantOf(a) - instantOf(b);
    };

    const live = MATCHES.filter(m => m.status === 'live' && matchPasses(m));
    const today = MATCHES.filter(m => m.status !== 'finished' && m.status !== 'live' && localDateKey(m) === LOCAL_TODAY && matchPasses(m))
        .sort(byFavThenTime);
    const upcoming = MATCHES.filter(m => m.status === 'upcoming' && localDateKey(m) > LOCAL_TODAY && matchPasses(m))
        .sort(byFavThenTime)
        .slice(0, 12);
    const finished = MATCHES.filter(m => m.status === 'finished' && matchPasses(m))
        .sort((a, b) => instantOf(b) - instantOf(a))
        .slice(0, 8);

    const fill = (id, list, emptyMsg) => {
        $(id).innerHTML = list.length
            ? list.map(matchCard).join('')
            : `<div class="empty-state">${emptyMsg}</div>`;
    };

    fill('#liveMatches', live, 'No live matches right now.');
    fill('#todayMatches', today, 'No more matches scheduled today.');
    fill('#upcomingMatches', upcoming, 'No upcoming matches match this filter.');
    fill('#finishedMatches', finished, 'No finished matches yet.');
}

// ===== GROUPS SECTION =====
function renderGroups() {
    const grid = $('#groupsGrid');
    const groups = Object.keys(STATE.standings).sort();

    grid.innerHTML = groups.map(g => {
        const rows = STATE.standings[g];
        return `
        <div class="group-card">
            <h3><span><span class="group-letter">${g}</span>Group ${g}</span><span class="muted" style="font-weight:500;font-size:.8rem">${rows.reduce((s, r) => s + r.p, 0) / 2} / 6 played</span></h3>
            <table class="standings-table">
                <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
                <tbody>
                    ${rows.map((r, i) => {
                        const pos = i < 2 ? 'pos-q' : i === 2 ? 'pos-3' : 'pos-out';
                        const fav = STATE.favorites.has(r.team.code) ? 'fav' : '';
                        return `<tr class="${pos} ${fav}">
                            <td>${i + 1}</td>
                            <td class="team-cell"><span class="mini-flag">${teamFlag(r.team)}</span>${r.team.name}</td>
                            <td>${r.p}</td>
                            <td>${r.w}</td>
                            <td>${r.d}</td>
                            <td>${r.l}</td>
                            <td>${r.gd >= 0 ? '+' + r.gd : r.gd}</td>
                            <td class="pts">${r.pts}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
    }).join('');

    // best thirds
    const thirds = bestThirds();
    $('#thirdsBody').innerHTML = thirds.map((t, i) => `
        <tr class="${i < 8 ? 'in-r32' : ''}">
            <td>${i + 1}</td>
            <td><span class="mc-group-tag">${t.group}</span></td>
            <td class="team-cell"><span class="mini-flag">${teamFlag(t.team)}</span>${t.team.name}</td>
            <td>${t.p}</td>
            <td>${t.w}</td>
            <td>${t.d}</td>
            <td>${t.l}</td>
            <td>${t.gd >= 0 ? '+' + t.gd : t.gd}</td>
            <td class="pts">${t.pts}</td>
        </tr>
    `).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:1rem;">Standings appear after matches play.</td></tr>';
}

// ===== BRACKET =====
// R32 pairings — placeholder labels resolve to teams when standings allow.
// Slot label "1A" = winner of Group A, "2C" = runner-up of Group C, "3-N" = Nth-best 3rd-placed team.
const R32_PAIRS = [
    ['1A', '2C'],  ['1B', '3-1'],
    ['1C', '2A'],  ['1D', '3-2'],
    ['1E', '2G'],  ['1F', '3-3'],
    ['1G', '2E'],  ['1H', '3-4'],
    ['1I', '2L'],  ['1J', '3-5'],
    ['1K', '2J'],  ['1L', '3-6'],
    ['2B', '3-7'], ['2D', '3-8'],
    ['2F', '2H'],  ['2I', '2K'],
];

function resolveSlot(label) {
    if (/^[12][A-L]$/.test(label)) {
        const pos = +label[0] - 1;
        const grp = label[1];
        const row = STATE.standings[grp]?.[pos];
        if (row && row.p > 0) return row.team;
        return { name: label[0] === '1' ? `Winner ${grp}` : `Runner-up ${grp}`, flag: '🏳️', placeholder: true };
    }
    if (/^3-\d+$/.test(label)) {
        const n = +label.split('-')[1] - 1;
        const thirds = bestThirds();
        const row = thirds[n];
        if (row && row.p > 0) return row.team;
        return { name: `${ordinal(n + 1)} best 3rd`, flag: '🏳️', placeholder: true };
    }
    return { name: label, flag: '🏳️', placeholder: true };
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function bracketSlotHtml(teamA, teamB, label, finalCls = '') {
    const renderTeam = (t) => t.placeholder
        ? `<div class="br-team placeholder"><span class="br-flag">${teamFlag(t)}</span>${t.name}</div>`
        : `<div class="br-team"><span class="br-flag">${teamFlag(t)}</span>${t.name}</div>`;
    return `<div class="bracket-slot ${finalCls}">
        ${label ? `<div class="muted" style="font-size:.65rem;letter-spacing:.5px;text-transform:uppercase;">${label}</div>` : ''}
        ${renderTeam(teamA)}
        <div class="br-divider"></div>
        ${renderTeam(teamB)}
    </div>`;
}

function renderBracket() {
    const r32Html = R32_PAIRS.map((pair, i) =>
        bracketSlotHtml(resolveSlot(pair[0]), resolveSlot(pair[1]), `R32 · M${i + 1}`)
    ).join('');

    const placeholder = (txt) => ({ name: txt, flag: '🏳️', placeholder: true });
    const r16Html = Array.from({ length: 8 }, (_, i) =>
        bracketSlotHtml(placeholder(`Winner M${i * 2 + 1}`), placeholder(`Winner M${i * 2 + 2}`), `R16 · M${i + 1}`)
    ).join('');
    const qfHtml = Array.from({ length: 4 }, (_, i) =>
        bracketSlotHtml(placeholder(`Winner R16-${i * 2 + 1}`), placeholder(`Winner R16-${i * 2 + 2}`), `QF · M${i + 1}`)
    ).join('');
    const sfHtml = Array.from({ length: 2 }, (_, i) =>
        bracketSlotHtml(placeholder(`Winner QF-${i * 2 + 1}`), placeholder(`Winner QF-${i * 2 + 2}`), `SF · M${i + 1}`)
    ).join('');
    const finalHtml = bracketSlotHtml(placeholder('Winner SF-1'), placeholder('Winner SF-2'), '🏆 FINAL · Jul 19', 'final')
                    + bracketSlotHtml(placeholder('Loser SF-1'), placeholder('Loser SF-2'), '🥉 3rd Place');

    $('#bracketGrid').innerHTML = `
        <div class="round-col"><h4>Round of 32</h4>${r32Html}</div>
        <div class="round-col"><h4>Round of 16</h4>${r16Html}</div>
        <div class="round-col"><h4>Quarterfinals</h4>${qfHtml}</div>
        <div class="round-col"><h4>Semifinals</h4>${sfHtml}</div>
        <div class="round-col"><h4>Final</h4>${finalHtml}</div>
    `;
}

// ===== TOP SCORERS =====
function renderScorers() {
    const list = computeScorers();
    $('#scorersBody').innerHTML = list.length
        ? list.map((s, i) => `
            <tr>
                <td>${i + 1}</td>
                <td><strong>${s.player}</strong></td>
                <td class="team-cell"><span class="mini-flag">${teamFlag(s.team)}</span>${s.team.name}</td>
                <td class="goals-cell">${s.goals}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="4" class="muted" style="text-align:center;padding:1rem;">No goals scored yet — the tournament has just begun.</td></tr>';
}

// ===== FAVORITES =====
function renderFavorites() {
    $('#favoritesPicker').innerHTML = TEAMS.map(t => {
        const on = STATE.favorites.has(t.code) ? 'on' : '';
        return `<div class="fav-tile ${on}" data-fav="${t.code}">
            <span class="ft-flag">${teamFlag(t)}</span>
            <div>
                <div>${t.name}</div>
                <div class="ft-group">Group ${t.group}</div>
            </div>
            <span class="fav-star">★</span>
        </div>`;
    }).join('');
}

function toggleFavorite(code) {
    if (STATE.favorites.has(code)) STATE.favorites.delete(code);
    else STATE.favorites.add(code);
    localStorage.setItem('wc26-favs', JSON.stringify([...STATE.favorites]));
    renderFavorites();
    renderLiveSection();
    renderGroups();
}

// ===== ILLUSTRATIVE PASSING ANIMATION =====
// No free API provides ball-tracking/pass coordinates, so this is a SYNTHETIC
// visualization (clearly labelled). Deterministic per match id so it's stable.
const PITCH_HOME = [[25,100],[60,40],[60,80],[60,120],[60,160],[130,60],[130,100],[130,140],[210,52],[210,100],[210,148]];
const PITCH_AWAY = [[295,100],[260,40],[260,80],[260,120],[260,160],[190,60],[190,100],[190,140],[110,52],[110,100],[110,148]];
let pitchTimer = null;

function pitchHtml(m) {
    if (m.status !== 'live' && m.status !== 'finished') return '';
    const dot = (p, cls) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" class="${cls}"/>`;
    const home = PITCH_HOME.map((p) => dot(p, 'pp-home')).join('');
    const away = PITCH_AWAY.map((p) => dot(p, 'pp-away')).join('');
    return `
    <div class="pitch-wrap">
        <div class="pitch-head"><span>Passing map</span><span class="pitch-note">⚠ Illustrative — not real tracking data</span></div>
        <svg id="pitchSvg" viewBox="0 0 320 200" class="pitch-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <rect x="0" y="0" width="320" height="200" class="pp-grass"/>
            <rect x="6" y="6" width="308" height="188" fill="none" class="pp-line"/>
            <line x1="160" y1="6" x2="160" y2="194" class="pp-line"/>
            <circle cx="160" cy="100" r="22" fill="none" class="pp-line"/>
            <rect x="6" y="55" width="40" height="90" fill="none" class="pp-line"/>
            <rect x="274" y="55" width="40" height="90" fill="none" class="pp-line"/>
            <line id="pitchPass" class="pp-pass" x1="0" y1="0" x2="0" y2="0"/>
            ${home}${away}
            <g id="pitchRing"><circle r="9" class="pp-ring"/></g>
            <g id="pitchBall"><circle r="5" class="pp-ball"/></g>
        </svg>
        <div class="pitch-legend"><span class="pp-key pp-home"></span>${TEAM[m.home].name}<span class="pp-key pp-away"></span>${TEAM[m.away].name}</div>
    </div>`;
}

function stopPitch() { if (pitchTimer) { clearInterval(pitchTimer); pitchTimer = null; } }

function startPitch(seedStr) {
    stopPitch();
    const ball = document.getElementById('pitchBall');
    const ring = document.getElementById('pitchRing');
    const line = document.getElementById('pitchPass');
    if (!ball) return;
    const pts = PITCH_HOME.concat(PITCH_AWAY);
    let seed = 0;
    for (const ch of String(seedStr)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let team = 0, cur = 0;
    const place = (i) => {
        const [x, y] = pts[i];
        ball.setAttribute('transform', `translate(${x},${y})`);
        ring.setAttribute('transform', `translate(${x},${y})`);
    };
    place(0);
    const step = () => {
        if (rnd() < 0.18) team ^= 1;             // occasional turnover
        const base = team ? 11 : 0;
        let next = base + Math.floor(rnd() * 11);
        if (next === cur) next = base + ((next - base + 1) % 11);
        const [px, py] = pts[cur], [nx, ny] = pts[next];
        if (line) {
            line.setAttribute('x1', px); line.setAttribute('y1', py);
            line.setAttribute('x2', nx); line.setAttribute('y2', ny);
            line.style.opacity = '0.85';
            setTimeout(() => { if (line) line.style.opacity = '0.12'; }, 650);
        }
        place(next);
        cur = next;
    };
    step();
    pitchTimer = setInterval(step, 1300);
}

// Synthetic, deterministic match stats (no free 2026 stats source exists).
// Clearly labelled "Illustrative" wherever shown.
function syntheticStats(m) {
    let seed = 0;
    for (const ch of String(m.id)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const between = (lo, hi) => Math.floor(lo + rnd() * (hi - lo + 1));
    const possH = between(38, 62);
    const shotsH = between(5, 16), shotsA = between(5, 16);
    return {
        poss: [possH, 100 - possH],
        shots: [shotsH, shotsA],
        onTarget: [between(1, Math.max(1, Math.round(shotsH * 0.6))), between(1, Math.max(1, Math.round(shotsA * 0.6)))],
        corners: [between(1, 9), between(1, 9)],
        fouls: [between(6, 16), between(6, 16)],
    };
}

// ===== MATCH MODAL =====
function openMatchModal(matchId) {
    const m = MATCHES.find(x => x.id === matchId);
    if (!m) return;
    const home = TEAM[m.home], away = TEAM[m.away];

    let statusLine;
    if (m.status === 'live') statusLine = `<span class="live-tag"><span class="live-dot"></span>${liveLabel(m)}</span>`;
    else if (m.status === 'finished') statusLine = `Full Time · ${fmtLocalDateTime(m)}`;
    else statusLine = `Kick off ${fmtLocalDateTime(m)}`;

    const scoreDisplay = (m.status === 'live' || m.status === 'finished')
        ? `${m.homeScore} <span class="vs">–</span> ${m.awayScore}`
        : `<span class="vs">vs</span>`;

    const live = m.status === 'live' || m.status === 'finished';
    const synthetic = !m.stats && live;
    const stats = m.stats || (synthetic ? syntheticStats(m) : null);
    const statsHtml = stats ? `
        <h4 class="stats-head">Match Stats${synthetic ? ' <span class="pitch-note">⚠ Illustrative</span>' : ''}</h4>
        ${statRow('Possession %', stats.poss[0], stats.poss[1])}
        ${statRow('Shots', stats.shots[0], stats.shots[1])}
        ${statRow('Shots on Target', stats.onTarget[0], stats.onTarget[1])}
        ${statRow('Corners', stats.corners[0], stats.corners[1])}
        ${statRow('Fouls', stats.fouls[0], stats.fouls[1])}
    ` : '<p class="muted" style="text-align:center;padding:1rem 0;">Stats available once the match starts.</p>';

    const eventsHtml = (m.events && m.events.length) ? `
        <div class="timeline">
            <h4>Match Events</h4>
            ${m.events.slice().sort((a, b) => a.min - b.min).map(ev => {
                const team = ev.side === 'home' ? home : away;
                const icon = ev.type === 'goal' ? '⚽' : ev.type === 'og' ? '🥅' : ev.type === 'yellow' ? '🟨' : ev.type === 'red' ? '🟥' : ev.type === 'penalty' ? '⚽' : '•';
                const text = ev.type === 'goal'
                    ? `<strong>GOAL</strong> · ${ev.player}${ev.assist ? ` <span class="muted">(assist: ${ev.assist})</span>` : ''}`
                    : ev.type === 'og' ? `<strong>OWN GOAL</strong> · ${ev.player}`
                    : ev.type === 'yellow' ? `Yellow card · ${ev.player}`
                    : ev.type === 'red' ? `<strong>RED CARD</strong> · ${ev.player}`
                    : `${ev.type} · ${ev.player}`;
                return `<div class="tl-event">
                    <span class="tl-min">${ev.min}'</span>
                    <span class="tl-icon">${icon}</span>
                    <span class="tl-text">${text}<span class="tl-team-tag">${teamFlag(team)} ${team.name}</span></span>
                </div>`;
            }).join('')}
        </div>` : (m.status === 'upcoming' ? '<p class="muted" style="text-align:center;padding:1rem 0;">Live commentary begins at kick-off.</p>' : '');

    $('#modalBody').innerHTML = `
        <div class="modal-header">
            <div class="mh-meta">
                <span><span class="mc-group-tag">${m.group}</span> Group ${m.group}</span>
                <span>📍 ${m.venue}</span>
            </div>
            <div class="mh-teams">
                <div class="mh-team">
                    <div class="mh-flag">${teamFlag(home)}</div>
                    <div class="mh-name">${home.name}</div>
                </div>
                <div class="mh-score">${scoreDisplay}</div>
                <div class="mh-team">
                    <div class="mh-flag">${teamFlag(away)}</div>
                    <div class="mh-name">${away.name}</div>
                </div>
            </div>
            <div class="mh-status">${statusLine}</div>
        </div>
        <div class="modal-body">
            ${statsHtml}
            ${eventsHtml}
            ${pitchHtml(m)}
        </div>
    `;
    $('#modalBackdrop').classList.add('open');
    $('#modalBackdrop').setAttribute('aria-hidden', 'false');
    startPitch(m.id);
}

function statRow(label, l, r) {
    const total = l + r || 1;
    const lp = (l / total) * 100, rp = (r / total) * 100;
    return `<div class="stat-row">
        <div style="text-align:right;">${l}</div>
        <div>
            <div class="sr-label">${label}</div>
            <div class="sr-bar">
                <div class="sr-bar-fill left" style="width:${lp}%"></div>
                <div class="sr-bar-fill right" style="width:${rp}%"></div>
            </div>
        </div>
        <div>${r}</div>
    </div>`;
}

function closeModal() {
    stopPitch();
    $('#modalBackdrop').classList.remove('open');
    $('#modalBackdrop').setAttribute('aria-hidden', 'true');
}

// ===== THEME =====
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = $('#themeToggle');
    if (btn) {
        const dark = theme === 'dark';
        btn.textContent = dark ? '☀️' : '🌙';
        btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
        btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
}

function initTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current);
    $('#themeToggle').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try { localStorage.setItem('wc26-theme', next); } catch (e) {}
    });
}

// ===== NAV =====
function setSection(name) {
    $$('.page-section').forEach(s => s.classList.toggle('active-section', s.id === name));
    $$('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.section === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== LIVE MINUTE TICKER =====
function startLiveTicker() {
    // Re-render live cards periodically so estimated minutes advance on screen.
    setInterval(() => {
        if (MATCHES.some(m => m.status === 'live') && $('#live').classList.contains('active-section')) {
            renderLiveSection();
        }
    }, 20000);
}

// ===== LIVE DATA SOURCE: openfootball (with bundled fallback) =====
// Public-domain World Cup 2026 JSON, served via jsDelivr (CORS + CDN cache).
const OF_BASE = 'https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026';

// openfootball grounds (host city, sometimes with a borough in parens) → stadium label.
const STADIUMS = {
    'Atlanta': 'Mercedes-Benz Stadium, Atlanta',
    'Boston': 'Gillette Stadium, Boston',
    'Dallas': 'AT&T Stadium, Dallas',
    'Houston': 'NRG Stadium, Houston',
    'Kansas City': 'Arrowhead Stadium, Kansas City',
    'Los Angeles': 'SoFi Stadium, Los Angeles',
    'Miami': 'Hard Rock Stadium, Miami',
    'New York/New Jersey': 'MetLife Stadium, New York/NJ',
    'Philadelphia': 'Lincoln Financial Field, Philadelphia',
    'San Francisco Bay Area': "Levi's Stadium, San Francisco Bay Area",
    'Seattle': 'Lumen Field, Seattle',
    'Toronto': 'BMO Field, Toronto',
    'Vancouver': 'BC Place, Vancouver',
    'Guadalajara': 'Estadio Akron, Guadalajara',
    'Mexico City': 'Estadio Azteca, Mexico City',
    'Monterrey': 'Estadio BBVA, Monterrey',
};
function groundToVenue(ground) {
    const key = String(ground || '').split('(')[0].trim();
    return STADIUMS[key] || ground || 'TBD';
}

// Normalize a team name for matching (strip accents, punctuation, case).
const normName = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// "15:00 UTC-4" → { time: "15:00", kickoffISO: "2026-06-12T15:00:00-04:00" }
function parseKickoff(dateStr, timeStr) {
    const m = String(timeStr).match(/(\d{1,2}):(\d{2})\s*UTC\s*([+-]\d{1,2})(?::?(\d{2}))?/i);
    if (!m) return { time: '00:00', kickoffISO: `${dateStr}T00:00:00Z` };
    const hh = m[1].padStart(2, '0'), mm = m[2];
    const sign = m[3][0];
    const oh = String(Math.abs(parseInt(m[3], 10))).padStart(2, '0');
    const om = (m[4] || '00').padStart(2, '0');
    return { time: `${hh}:${mm}`, kickoffISO: `${dateStr}T${hh}:${mm}:00${sign}${oh}:${om}` };
}

// Map openfootball teams.json + worldcup.json into the app's {tournament, teams, matches}.
function mapOpenfootball(teamsJson, fixturesJson) {
    const teams = teamsJson.map(t => ({
        code: t.fifa_code, name: t.name, group: t.group, flag: t.flag_icon, confed: t.confed,
    }));
    const nameToCode = {};
    for (const t of teamsJson) {
        nameToCode[normName(t.name)] = t.fifa_code;
        if (t.name_normalised) nameToCode[normName(t.name_normalised)] = t.fifa_code;
        nameToCode[normName(t.fifa_code)] = t.fifa_code;
    }

    const matches = [];
    let i = 0, skipped = 0;
    for (const mt of (fixturesJson.matches || [])) {
        if (!/^Group\s/i.test(mt.group || '')) continue; // group stage only; the app builds its own bracket
        const home = nameToCode[normName(mt.team1)];
        const away = nameToCode[normName(mt.team2)];
        if (!home || !away) { skipped++; continue; } // placeholder/qualifier rows
        const { time, kickoffISO } = parseKickoff(mt.date, mt.time);
        matches.push({
            id: `wc${i++}`,
            group: String(mt.group).replace(/^Group\s+/i, ''),
            home, away, date: mt.date, time, kickoffISO,
            venue: groundToVenue(mt.ground),
            status: 'upcoming', // openfootball 2026 is fixtures-only (no scores yet)
        });
    }
    if (skipped) console.warn(`openfootball: skipped ${skipped} non-group/unmapped matches`);

    const now = new Date();
    const tournament = {
        startDate: '2026-06-11',
        finalDate: '2026-07-19',
        today: now.toLocaleDateString('en-CA'),
        nowISO: now.toISOString(),
    };
    return { tournament, teams, matches };
}

async function loadLiveData() {
    const [teams, fixtures] = await Promise.all([
        fetch(`${OF_BASE}/worldcup.teams.json`).then(r => { if (!r.ok) throw new Error('teams ' + r.status); return r.json(); }),
        fetch(`${OF_BASE}/worldcup.json`).then(r => { if (!r.ok) throw new Error('fixtures ' + r.status); return r.json(); }),
    ]);
    const data = mapOpenfootball(teams, fixtures);
    if (data.teams.length < 24 || data.matches.length < 48) throw new Error('incomplete openfootball data');
    return data;
}

// Install a dataset and derive everything dependent on it.
function setDataset(data) {
    TOURNAMENT = data.tournament;
    TEAMS = data.teams;
    MATCHES = data.matches;
    TEAM = Object.fromEntries(TEAMS.map(t => [t.code, t]));
    for (const m of MATCHES) m.instant = m.kickoffISO ? new Date(m.kickoffISO) : kickoffInstant(m.date, m.time);
    todayDate = TOURNAMENT.today;
    startDate = new Date(TOURNAMENT.startDate + 'T00:00:00');
    NOW_INSTANT = TOURNAMENT.nowISO ? new Date(TOURNAMENT.nowISO) : kickoffInstant(TOURNAMENT.today, TOURNAMENT.nowHHMM);
    LOCAL_TODAY = NOW_INSTANT.toLocaleDateString('en-CA');
}

// ===== LIVE SCORES (football-data.org via /api/scores serverless proxy) =====
// Additive layer over the openfootball schedule: merges scores/status onto the
// existing fixtures. If the proxy isn't configured (no token) or errors, this
// is a silent no-op and the schedule stands.
const FD_STATUS = {
    IN_PLAY: 'live', PAUSED: 'live',
    FINISHED: 'finished', AWARDED: 'finished',
    // SCHEDULED / TIMED / POSTPONED / SUSPENDED / CANCELLED → stay 'upcoming'
};
let scoresOn = false;     // true once the proxy returns a usable response

const pairKey = (a, b) => [a, b].sort().join('~');

// football-data team (tla + name) → app team code.
function resolveCode(tla, name) {
    if (tla && TEAM[tla]) return tla;
    if (name) {
        const n = normName(name);
        const t = TEAMS.find((x) => normName(x.name) === n);
        if (t) return t.code;
    }
    return null;
}

function mergeScores(payload) {
    if (!payload || !payload.ok || !Array.isArray(payload.matches)) return false;
    const byPair = new Map();
    for (const m of MATCHES) byPair.set(pairKey(m.home, m.away), m);

    let applied = 0;
    for (const s of payload.matches) {
        const hc = resolveCode(s.home, s.homeName);
        const ac = resolveCode(s.away, s.awayName);
        if (!hc || !ac) continue;
        const m = byPair.get(pairKey(hc, ac));
        if (!m) continue;
        const mapped = FD_STATUS[s.status];
        if (!mapped) continue; // still scheduled

        // Orient the upstream scores to the app's home/away ordering.
        let hs = s.homeScore, as = s.awayScore;
        if (m.home !== hc) { const t = hs; hs = as; as = t; }
        if (hs == null || as == null) {
            if (mapped === 'finished') continue; // finished but no score → skip
            hs = hs ?? 0; as = as ?? 0;
        }
        m.homeScore = hs; m.awayScore = as;
        m.status = mapped;
        m.fromApi = true;
        if (mapped === 'live') m.apiMinute = s.minute ?? null;
        applied++;
    }
    return applied > 0;
}

async function refreshScores() {
    let payload = null;
    try {
        const r = await fetch('/api/scores', { cache: 'no-store' });
        if (r.ok) payload = await r.json();
    } catch (e) { /* offline / no proxy — keep schedule */ }
    if (!payload || !payload.ok) return;
    scoresOn = true;
    const changed = mergeScores(payload);
    setFooterNote(true, true);
    if (changed) renderAll();
}

// ===== SKELETON LOADING =====
function skeletonCard() {
    return `<div class="match-card sk-card" aria-hidden="true">
        <div class="sk-row"><span class="sk sk-pill"></span><span class="sk sk-pill sk-pill-sm"></span></div>
        <div class="sk-teamrow">
            <span class="sk sk-flag"></span><span class="sk sk-bar sk-grow"></span>
            <span class="sk sk-bar sk-score"></span>
            <span class="sk sk-bar sk-grow"></span><span class="sk sk-flag"></span>
        </div>
        <span class="sk sk-bar sk-foot"></span>
    </div>`;
}
function showSkeletons() {
    const cards = (k) => Array.from({ length: k }, skeletonCard).join('');
    $('#liveMatches').innerHTML = `<div class="empty-state">Loading schedule…</div>`;
    $('#todayMatches').innerHTML = cards(2);
    $('#upcomingMatches').innerHTML = cards(6);
    $('#finishedMatches').innerHTML = '';
    const row = `<div class="sk-teamrow" style="margin:.55rem 0"><span class="sk sk-flag"></span><span class="sk sk-bar sk-grow"></span><span class="sk sk-bar sk-num"></span></div>`;
    const grp = `<div class="group-card" aria-hidden="true"><span class="sk sk-bar sk-title"></span>${row.repeat(4)}</div>`;
    $('#groupsGrid').innerHTML = grp.repeat(4);
}

function setFooterNote(live, withScores) {
    const el = $('#footerNote');
    if (!el) return;
    if (!live) { el.textContent = 'Live source unavailable — showing bundled sample data.'; return; }
    const schedule = 'Live schedule via <a href="https://github.com/openfootball/worldcup.json" target="_blank" rel="noopener">openfootball</a>';
    el.innerHTML = withScores
        ? `${schedule} · live scores via <a href="https://www.football-data.org" target="_blank" rel="noopener">football-data.org</a>.`
        : `${schedule} · public-domain World Cup 2026 data.`;
}

let tickerStarted = false;
function renderAll() {
    $('#tournamentDay').textContent = `Day ${tournamentDay()} of 39`;
    $('#todayDate').textContent = NOW_INSTANT.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    STATE.standings = computeStandings();
    renderLiveSection();
    renderGroups();
    renderBracket();
    renderScorers();
    renderFavorites();
    if (!tickerStarted) { startLiveTicker(); tickerStarted = true; }
}

// One-time wiring that needs no data.
function initChrome() {
    initTheme();
    $$('.nav-link').forEach(l => l.addEventListener('click', e => { e.preventDefault(); setSection(l.dataset.section); }));
    $$('.filter-chip').forEach(c => c.addEventListener('click', () => {
        $$('.filter-chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        STATE.filter = c.dataset.filter;
        renderLiveSection();
    }));
    document.addEventListener('click', e => {
        const card = e.target.closest('.match-card');
        if (card && card.dataset.match) openMatchModal(card.dataset.match);
        const fav = e.target.closest('.fav-tile');
        if (fav) toggleFavorite(fav.dataset.fav);
    });
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

async function boot() {
    initChrome();
    showSkeletons();
    let data, live = true;
    try {
        data = await loadLiveData();
    } catch (e) {
        console.warn('Live data unavailable; using bundled sample:', e);
        data = FALLBACK_DATA;
        live = false;
    }
    setDataset(data);
    renderAll();
    setFooterNote(live, false);

    // Layer live scores from football-data.org (via the serverless proxy) over the
    // openfootball schedule, then keep them fresh. No-op if the proxy isn't configured.
    if (live) {
        refreshScores();
        setInterval(refreshScores, 60000);
    }
}

document.addEventListener('DOMContentLoaded', boot);
