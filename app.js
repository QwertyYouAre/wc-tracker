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

// ===== DATE / TIME HELPERS =====
const todayDate = TOURNAMENT.today;
const startDate = new Date(TOURNAMENT.startDate + 'T00:00:00');

function tournamentDay() {
    const today = new Date(todayDate + 'T00:00:00');
    return Math.floor((today - startDate) / 86400000) + 1;
}

// Fixture times in data.js are US Eastern wall-clock (see data.js).
// Convert them to the instant they represent, then render in the viewer's local zone.
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
    const offset = tzOffsetMs(SOURCE_TZ, new Date(naive));
    return new Date(naive - offset);
}

function fmtLocalTime(dateStr, timeStr) {
    return kickoffInstant(dateStr, timeStr)
        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtLocalDateTime(dateStr, timeStr) {
    const inst = kickoffInstant(dateStr, timeStr);
    const date = inst.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const time = inst.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
    return `${date} · ${time}`;
}

function fmtLocalDate(dateStr, timeStr) {
    return kickoffInstant(dateStr, timeStr)
        .toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// YYYY-MM-DD calendar date of a kickoff in the viewer's local zone (sortable/comparable).
function localDateKey(dateStr, timeStr) {
    return kickoffInstant(dateStr, timeStr).toLocaleDateString('en-CA');
}

// The simulated "now" (TOURNAMENT.today + nowHHMM is Eastern), expressed as the
// viewer's local calendar date — so day grouping matches the localized kickoff dates.
const LOCAL_TODAY = localDateKey(todayDate, TOURNAMENT.nowHHMM);

function minutesUntil(date, time) {
    const target = new Date(`${date}T${time}:00`);
    const now = new Date(`${todayDate}T${TOURNAMENT.nowHHMM}:00`);
    return Math.round((target - now) / 60000);
}

function relativeUntil(date, time) {
    const mins = minutesUntil(date, time);
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

// ===== MATCH CARD =====
function matchCard(m) {
    const home = TEAM[m.home], away = TEAM[m.away];
    const isFav = isFavMatch(m);
    const cls = ['match-card', m.status === 'live' ? 'live' : '', isFav ? 'favorite' : ''].filter(Boolean).join(' ');

    let scoreHtml, statusHtml;
    if (m.status === 'live') {
        scoreHtml = `<div class="mc-score">${m.homeScore} – ${m.awayScore}</div>`;
        statusHtml = `<span class="live-tag"><span class="live-dot"></span>LIVE · ${m.liveMinute}'</span>`;
    } else if (m.status === 'finished') {
        scoreHtml = `<div class="mc-score">${m.homeScore} – ${m.awayScore}</div>`;
        statusHtml = `<span>FT · ${fmtLocalDate(m.date, m.time)}</span>`;
    } else {
        scoreHtml = `<div class="mc-score"><span class="vs">${fmtLocalTime(m.date, m.time)}</span></div>`;
        statusHtml = `<span>${fmtLocalDate(m.date, m.time)}</span>`;
    }

    const countdownHtml = m.status === 'upcoming' && (localDateKey(m.date, m.time) === LOCAL_TODAY || minutesUntil(m.date, m.time) <= 24 * 60)
        ? `<span class="mc-countdown">${relativeUntil(m.date, m.time)}</span>`
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
        return (a.date + a.time).localeCompare(b.date + b.time);
    };

    const live = MATCHES.filter(m => m.status === 'live' && matchPasses(m));
    const today = MATCHES.filter(m => m.status !== 'finished' && m.status !== 'live' && localDateKey(m.date, m.time) === LOCAL_TODAY && matchPasses(m))
        .sort(byFavThenTime);
    const upcoming = MATCHES.filter(m => m.status === 'upcoming' && localDateKey(m.date, m.time) > LOCAL_TODAY && matchPasses(m))
        .sort(byFavThenTime)
        .slice(0, 12);
    const finished = MATCHES.filter(m => m.status === 'finished' && matchPasses(m))
        .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
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

// ===== MATCH MODAL =====
function openMatchModal(matchId) {
    const m = MATCHES.find(x => x.id === matchId);
    if (!m) return;
    const home = TEAM[m.home], away = TEAM[m.away];

    let statusLine;
    if (m.status === 'live') statusLine = `<span class="live-tag"><span class="live-dot"></span>LIVE · ${m.liveMinute}'</span>`;
    else if (m.status === 'finished') statusLine = `Full Time · ${fmtLocalDateTime(m.date, m.time)}`;
    else statusLine = `Kick off ${fmtLocalDateTime(m.date, m.time)}`;

    const scoreDisplay = (m.status === 'live' || m.status === 'finished')
        ? `${m.homeScore} <span class="vs">–</span> ${m.awayScore}`
        : `<span class="vs">vs</span>`;

    const stats = m.stats;
    const statsHtml = stats ? `
        <h4 style="text-transform:uppercase;font-size:.8rem;letter-spacing:1px;color:var(--text-muted);margin-bottom:.75rem;">Match Stats</h4>
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
        </div>
    `;
    $('#modalBackdrop').classList.add('open');
    $('#modalBackdrop').setAttribute('aria-hidden', 'false');
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
    setInterval(() => {
        let changed = false;
        for (const m of MATCHES) {
            if (m.status === 'live' && m.liveMinute < 90) {
                // tick once every 10s of real time = 1 minute of match time
                m.liveMinute++;
                changed = true;
            }
        }
        if (changed && $('#live').classList.contains('active-section')) {
            renderLiveSection();
        }
    }, 10000);
}

// ===== INIT =====
function init() {
    // header bar
    $('#tournamentDay').textContent = `Day ${tournamentDay()} of 39`;
    $('#todayDate').textContent = fmtLocalDate(todayDate, TOURNAMENT.nowHHMM);

    initTheme();

    STATE.standings = computeStandings();

    renderLiveSection();
    renderGroups();
    renderBracket();
    renderScorers();
    renderFavorites();

    // nav
    $$('.nav-link').forEach(l => {
        l.addEventListener('click', e => {
            e.preventDefault();
            setSection(l.dataset.section);
        });
    });

    // filter chips
    $$('.filter-chip').forEach(c => {
        c.addEventListener('click', () => {
            $$('.filter-chip').forEach(x => x.classList.remove('active'));
            c.classList.add('active');
            STATE.filter = c.dataset.filter;
            renderLiveSection();
        });
    });

    // match card clicks (delegated)
    document.addEventListener('click', e => {
        const card = e.target.closest('.match-card');
        if (card) openMatchModal(card.dataset.match);
        const fav = e.target.closest('.fav-tile');
        if (fav) toggleFavorite(fav.dataset.fav);
    });

    // modal close
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', e => {
        if (e.target.id === 'modalBackdrop') closeModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
    });

    startLiveTicker();
}

document.addEventListener('DOMContentLoaded', init);
