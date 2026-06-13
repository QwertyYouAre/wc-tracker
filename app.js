// ===== WC Tracker — main app logic =====

const STATE = {
    favorites: new Set(JSON.parse(localStorage.getItem('wc26-favs') || '[]')),
    notify: localStorage.getItem('wc26-notify') === '1',
    filter: 'all',
    standings: {}, // groupLetter -> sorted [{ team, p, w, d, l, gf, ga, gd, pts }]
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Escape any string we drop into innerHTML. Team/player/assist/venue text comes
// from third-party feeds (ESPN, openfootball); a stray < or & would otherwise
// break a card or, in the worst case, inject markup.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
// Tournament-wide goals from ESPN (player + team code), set by refreshESPN.
// Null until ESPN loads; then it's the source of truth for top scorers.
let ESPN_GOALS = null;

function computeScorers() {
    const goals = new Map(); // key: player|teamCode -> count
    if (ESPN_GOALS) {
        for (const g of ESPN_GOALS) {
            const key = `${g.player}|${g.code}`;
            goals.set(key, (goals.get(key) || 0) + 1);
        }
    } else {
        for (const m of MATCHES) {
            if (!m.events) continue;
            for (const ev of m.events) {
                if (ev.type !== 'goal') continue;
                const teamCode = ev.side === 'home' ? m.home : m.away;
                const key = `${ev.player}|${teamCode}`;
                goals.set(key, (goals.get(key) || 0) + 1);
            }
        }
    }
    return [...goals.entries()]
        .map(([k, count]) => {
            const sep = k.lastIndexOf('|');
            return { player: k.slice(0, sep), team: TEAM[k.slice(sep + 1)], goals: count };
        })
        .filter(s => s.team)
        .sort((a, b) => b.goals - a.goals || a.player.localeCompare(b.player));
}

// Rough live minute estimated from kickoff (football-data's list endpoint omits it).
// Approximates the ~15-min half-time break; not exact during stoppage time.
function estimateMinute(m) {
    const elapsed = Math.floor((Date.now() - instantOf(m).getTime()) / 60000);
    if (elapsed < 0) return null;
    if (elapsed <= 45) return elapsed;   // first half
    if (elapsed <= 60) return 'HT';      // half-time window
    return Math.min(elapsed - 15, 91);   // second half (minus the break)
}

// "LIVE · 63'" / "LIVE · 90+'" when the minute is known or can be estimated,
// "LIVE · HT" at half-time, else "LIVE".
function liveLabel(m) {
    if (m.halftime) return 'LIVE · HT';
    const min = m.apiMinute ?? estimateMinute(m);
    if (min == null) return 'LIVE';
    if (min === 'HT') return 'LIVE · HT';
    return min > 90 ? "LIVE · 90+'" : `LIVE · ${min}'`;
}

// A slim ESPN win-probability bar (home / draw / away) shown under each card.
// Renders nothing until that match's odds have loaded.
function oddsBar(m) {
    const o = m.odds;
    if (!o) return '';
    const title = `Win probability${o.provider ? ' · ' + o.provider : ''} (via ESPN)`;
    const aria = `${m.home} ${o.home}%, Draw ${o.draw}%, ${m.away} ${o.away}%`;
    return `
        <div class="mc-odds" title="${title}">
            <div class="mco-bar" role="img" aria-label="${aria}">
                <span class="mco-h" style="width:${o.home}%"></span>
                <span class="mco-d" style="width:${o.draw}%"></span>
                <span class="mco-a" style="width:${o.away}%"></span>
            </div>
            <div class="mco-legend">
                <span class="mco-lh">${m.home} ${o.home}%</span>
                <span class="mco-ld">Draw ${o.draw}%</span>
                <span class="mco-la">${m.away} ${o.away}%</span>
            </div>
        </div>`;
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

    const aria = `${TEAM[m.home].name} versus ${TEAM[m.away].name}, Group ${m.group}. Open match details.`;
    return `
        <div class="${cls}" data-match="${m.id}" role="button" tabindex="0" aria-label="${esc(aria)}">
            <div class="mc-top">
                <span><span class="mc-group-tag">${m.group}</span> Group ${m.group}</span>
                ${statusHtml}
            </div>
            <div class="mc-teams">
                <div class="mc-team">
                    <span class="mc-flag">${teamFlag(home)}</span>
                    <span class="mc-name">${esc(home.name)}</span>
                </div>
                ${scoreHtml}
                <div class="mc-team away">
                    <span class="mc-flag">${teamFlag(away)}</span>
                    <span class="mc-name">${esc(away.name)}</span>
                </div>
            </div>
            <div class="mc-bottom">
                <span class="mc-venue">📍 ${esc(m.venue)}</span>
                ${countdownHtml}
            </div>
            ${oddsBar(m)}
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

    // Under a specific filter, hide whole sections that have no matching
    // matches so e.g. the "Finished" view doesn't still show an "Upcoming"
    // heading. The "All" view keeps empty sections (their messages are useful).
    const hideEmpty = STATE.filter !== 'all';
    const fill = (id, list, emptyMsg) => {
        const grid = $(id);
        grid.innerHTML = list.length
            ? list.map(matchCard).join('')
            : `<div class="empty-state">${emptyMsg}</div>`;
        const block = grid.closest('.day-block');
        if (block) block.style.display = (list.length || !hideEmpty) ? '' : 'none';
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

// Real knockout results harvested from ESPN (pairKey of the two FIFA codes →
// winning code). Filled by refreshESPN() as games finish; lets the bracket
// propagate actual winners through every round instead of static placeholders.
const KNOCKOUT = {};
const brPlaceholder = (txt) => ({ name: txt, flag: '🏳️', placeholder: true });

// The winner of a tie, if both sides are real teams and ESPN has a result.
function knockoutWinner(a, b) {
    if (!a || !b || a.placeholder || b.placeholder) return null;
    const code = KNOCKOUT[pairKey(a.code, b.code)];
    return code ? TEAM[code] : null;
}
// The losing side of a decided tie (for the 3rd-place playoff).
function loserOf(slot) {
    if (!slot.winner || slot.a.placeholder || slot.b.placeholder) return null;
    return slot.winner.code === slot.a.code ? slot.b : slot.a;
}

function bracketSlotHtml(teamA, teamB, label, opts = {}) {
    const winCode = opts.winner && opts.winner.code;
    const renderTeam = (t) => {
        const isWin = winCode && !t.placeholder && t.code === winCode;
        const cls = `br-team${t.placeholder ? ' placeholder' : ''}${isWin ? ' br-win' : ''}`;
        return `<div class="${cls}"><span class="br-flag">${teamFlag(t)}</span>${esc(t.name)}</div>`;
    };
    return `<div class="bracket-slot ${opts.finalCls || ''}">
        ${label ? `<div class="muted" style="font-size:.65rem;letter-spacing:.5px;text-transform:uppercase;">${label}</div>` : ''}
        ${renderTeam(teamA)}
        <div class="br-divider"></div>
        ${renderTeam(teamB)}
    </div>`;
}

// Advance one round: each new slot is fed by two slots from the previous round.
// A feeding slot contributes its real winner if known, else a "Winner Mx"
// placeholder — so the tree stays coherent even before results exist.
function advanceRound(prev, prefix) {
    const slots = [];
    for (let i = 0; i < prev.length; i += 2) {
        const a = prev[i].winner || brPlaceholder(`Winner ${prev[i].tag}`);
        const b = prev[i + 1].winner || brPlaceholder(`Winner ${prev[i + 1].tag}`);
        slots.push({ a, b, winner: knockoutWinner(a, b), tag: `${prefix}${i / 2 + 1}` });
    }
    return slots;
}

function renderBracket() {
    // R32 sides come from the settled group standings; winners (and everything
    // beyond) come from real ESPN knockout results via KNOCKOUT.
    let r32 = R32_PAIRS.map((pair, i) => {
        const a = resolveSlot(pair[0]), b = resolveSlot(pair[1]);
        return { a, b, winner: knockoutWinner(a, b), tag: `M${i + 1}` };
    });
    const r16 = advanceRound(r32, 'R16-');
    const qf = advanceRound(r16, 'QF-');
    const sf = advanceRound(qf, 'SF-');

    const colHtml = (slots, round) => slots.map((s, i) =>
        bracketSlotHtml(s.a, s.b, `${round} · M${i + 1}`, { winner: s.winner })
    ).join('');

    // Final: contested by the two SF winners; champion highlighted if decided.
    const fa = sf[0].winner || brPlaceholder('Winner SF-1');
    const fb = sf[1].winner || brPlaceholder('Winner SF-2');
    const champion = knockoutWinner(fa, fb);
    // 3rd place: the two beaten semi-finalists.
    const la = loserOf(sf[0]) || brPlaceholder('Loser SF-1');
    const lb = loserOf(sf[1]) || brPlaceholder('Loser SF-2');
    const finalHtml = bracketSlotHtml(fa, fb, '🏆 FINAL · Jul 19', { finalCls: 'final', winner: champion })
                    + bracketSlotHtml(la, lb, '🥉 3rd Place', { winner: knockoutWinner(la, lb) });

    $('#bracketGrid').innerHTML = `
        <div class="round-col"><h4>Round of 32</h4>${colHtml(r32, 'R32')}</div>
        <div class="round-col"><h4>Round of 16</h4>${colHtml(r16, 'R16')}</div>
        <div class="round-col"><h4>Quarterfinals</h4>${colHtml(qf, 'QF')}</div>
        <div class="round-col"><h4>Semifinals</h4>${colHtml(sf, 'SF')}</div>
        <div class="round-col"><h4>Final</h4>${finalHtml}</div>
    `;
}

// ===== TOP SCORERS =====
function renderScorers() {
    let list = computeScorers();
    // Top 10, but keep anyone tied on goals with the 10th-placed player.
    if (list.length > 10) {
        const cutoff = list[9].goals;
        list = list.filter(s => s.goals >= cutoff);
    }
    // Shared rank for ties (1, 2, 2, 2, …) — standard competition ranking.
    let rank = 0, prevGoals = null;
    $('#scorersBody').innerHTML = list.length
        ? list.map((s, i) => {
            if (s.goals !== prevGoals) { rank = i + 1; prevGoals = s.goals; }
            return `
            <tr>
                <td>${rank}</td>
                <td><strong>${esc(s.player)}</strong></td>
                <td class="team-cell"><span class="mini-flag">${teamFlag(s.team)}</span>${esc(s.team.name)}</td>
                <td class="goals-cell">${s.goals}</td>
            </tr>`;
        }).join('')
        : '<tr><td colspan="4" class="muted" style="text-align:center;padding:1rem;">No goals scored yet — the tournament has just begun.</td></tr>';
}

// ===== FAVORITES =====
function renderFavorites() {
    $('#favoritesPicker').innerHTML = TEAMS.map(t => {
        const on = STATE.favorites.has(t.code) ? 'on' : '';
        const aria = `${on ? 'Remove' : 'Add'} ${t.name} ${on ? 'from' : 'to'} favorites`;
        return `<div class="fav-tile ${on}" data-fav="${t.code}" role="button" tabindex="0" aria-pressed="${on ? 'true' : 'false'}" aria-label="${esc(aria)}">
            <span class="ft-flag">${teamFlag(t)}</span>
            <div class="ft-info">
                <div>${esc(t.name)}</div>
                <div class="ft-group">Group ${t.group}</div>
            </div>
            <button class="ft-view" type="button" data-view="${t.code}" aria-label="${esc('View ' + t.name + ' lineup')}">View</button>
            <span class="fav-star">★</span>
        </div>`;
    }).join('');
}

// ===== TEAM LINEUP (formation, substitutes, WC-2026 goals/assists) =====
// "Accurate" here means real ESPN data only: for a team that has already played
// we show their actual XI + formation from the most recent match; for teams yet
// to kick off we show the official squad grouped by position (no invented XI).
let lineupToken = 0; // guards against a slow fetch writing into a closed/changed modal

// Tournament assist totals come from ESPN's leaders feed (goals are harvested
// from the scoreboard in refreshESPN). Fetched once, then cached.
async function loadWcStats() {
    if (WC_ASSISTS) return;
    WC_ASSISTS = {};
    try {
        const d = await (await fetch(`${ESPN_CORE_BASE}/seasons/2026/types/1/leaders`)).json();
        for (const c of (d.categories || [])) {
            if (c.name !== 'assists') continue;
            for (const e of (c.leaders || [])) {
                const mm = String((e.athlete && e.athlete.$ref) || '').match(/athletes\/(\d+)/);
                if (mm) WC_ASSISTS[mm[1]] = Math.round(parseFloat(e.value) || 0);
            }
        }
    } catch (e) { /* assists simply render as 0 */ }
}

// Map an ESPN position abbreviation to a pitch line: 0 GK, 1 DEF, 2 MID, 3 FWD.
function posLine(abbr) {
    const a = (abbr || '').toUpperCase();
    if (a[0] === 'G') return 0;
    if (a === 'D' || a.startsWith('CD') || a.startsWith('CB') || a === 'LB' || a === 'RB' || a.endsWith('WB') || a === 'SW') return 1;
    if (a === 'F' || a.startsWith('CF') || a === 'ST' || a === 'S' || a === 'LW' || a === 'RW' || a === 'W') return 3;
    return 2; // DM, CM, LM, RM, AM, M …
}
// Rough left→right ordering within a line from the L/R hint in the abbreviation.
function posX(abbr) {
    const a = (abbr || '').toUpperCase();
    if (a.includes('L')) return 0;
    if (a.includes('R')) return 2;
    return 1;
}

// Vertical band on the pitch from a position abbreviation (0 front line → 5 GK).
// This is what tucks a CDM below the CMs and keeps wingers up with the striker.
function posBand(abbr) {
    const a = (abbr || '').toUpperCase();
    if (a[0] === 'G') return 5;
    if (a === 'DM' || a === 'CDM') return 3;                                   // holding mid, just behind the CMs
    if (a === 'D' || a.startsWith('CB') || a.startsWith('CD') || a === 'SW'
        || a === 'LB' || a === 'RB' || a.endsWith('WB')) return 4;            // back line
    if (a === 'AM' || a === 'CAM' || a === 'SS') return 1;                     // No.10 line
    if (a === 'F' || a === 'CF' || a.startsWith('CF') || a === 'ST' || a === 'S'
        || a === 'LW' || a === 'RW' || a === 'W' || a === 'LF' || a === 'RF') return 0; // front line (wingers + striker)
    return 2; // CM, LM, RM, M … midfield line
}

// Finer left→right rank within a band: far-left 0, inside-left 1, centre 2, inside-right 3, far-right 4.
function posOrder(abbr) {
    const a = (abbr || '').toUpperCase();
    if (a === 'LB' || a === 'LWB' || a === 'LM' || a === 'LW' || a === 'LF') return 0;
    if (a.endsWith('-L')) return 1;
    if (a === 'RB' || a === 'RWB' || a === 'RM' || a === 'RW' || a === 'RF') return 4;
    if (a.endsWith('-R')) return 3;
    return 2;
}

function playerObj(athlete, jersey, pos, starter, subbedIn, place) {
    const at = athlete || {};
    return {
        id: at.id, name: at.shortName || at.displayName || '—', full: at.displayName || at.shortName || '',
        jersey: jersey || '', pos: pos || '', starter: !!starter, subbedIn: !!subbedIn,
        place: parseInt(place || 0, 10) || 0,
    };
}

// A team's roster entry from a match summary → {formation, lines[4][], subs[]}.
function parseMatchRoster(tr) {
    const players = (tr.roster || []).map(p =>
        playerObj(p.athlete, p.jersey, p.position && p.position.abbreviation, p.starter, p.subbedIn, p.formationPlace));
    const lines = [[], [], [], []];
    for (const p of players) if (p.starter) lines[posLine(p.pos)].push(p);
    for (const ln of lines) ln.sort((a, b) => posX(a.pos) - posX(b.pos) || a.place - b.place);
    const subs = players.filter(p => !p.starter)
        .sort((a, b) => (b.subbedIn - a.subbedIn) || (parseInt(a.jersey || 99, 10) - parseInt(b.jersey || 99, 10)));
    return { formation: tr.formation || null, lines, subs, squad: false };
}

// No match yet → build a default 4-3-3 XI from the official squad (lowest shirt
// numbers per position), with everyone else on the bench. Flagged as predicted.
function parseSquad(athletes) {
    const byLine = [[], [], [], []];
    for (const a of athletes) {
        const pos = (a.position && a.position.abbreviation) || '';
        byLine[posLine(pos)].push(playerObj(a, a.jersey, pos, false, false, 0));
    }
    for (const ln of byLine) ln.sort((a, b) => parseInt(a.jersey || 99, 10) - parseInt(b.jersey || 99, 10));
    const all = byLine.flat();
    const need = [1, 4, 3, 3]; // GK, DEF, MID, FWD → 4-3-3
    const lines = [[], [], [], []];
    const taken = new Set();
    for (let i = 0; i < 4; i++) for (const p of byLine[i]) { if (lines[i].length >= need[i]) break; lines[i].push(p); taken.add(p); }
    // If a position group is short, top it up from anyone left so the shape holds.
    for (let i = 0; i < 4; i++) for (const p of all) { if (lines[i].length >= need[i]) break; if (!taken.has(p)) { lines[i].push(p); taken.add(p); } }
    const subs = all.filter(p => !taken.has(p)).sort((a, b) => parseInt(a.jersey || 99, 10) - parseInt(b.jersey || 99, 10));
    return { formation: '4-3-3', lines, subs, presumed: true };
}

async function loadLineup(code) {
    if (LINEUP_CACHE[code]) return LINEUP_CACHE[code];
    // Prefer the real XI from this team's most recent live/finished match.
    const played = MATCHES
        .filter(m => (m.home === code || m.away === code) && (m.status === 'live' || m.status === 'finished') && m.espnId)
        .sort((a, b) => instantOf(b) - instantOf(a))[0];
    let data = null, fromMatch = null;
    if (played) {
        try {
            const d = await (await fetch(`${ESPN_BASE}/summary?event=${played.espnId}`, { cache: 'no-store' })).json();
            const tr = (d.rosters || []).find(r => r.team && r.team.abbreviation === code);
            if (tr && tr.roster && tr.roster.length) { data = parseMatchRoster(tr); fromMatch = played; }
        } catch (e) { /* fall through to squad */ }
    }
    if (!data && ESPN_TEAM_ID[code]) {
        try {
            const d = await (await fetch(`${ESPN_BASE}/teams/${ESPN_TEAM_ID[code]}/roster`, { cache: 'no-store' })).json();
            if (d.athletes && d.athletes.length) data = parseSquad(d.athletes);
        } catch (e) { /* none available */ }
    }
    if (data) { data.fromMatch = fromMatch; LINEUP_CACHE[code] = data; }
    return data;
}

// playerChip(p) → bench chip (flows in a grid). playerChip(p, x, y) → pitch chip
// absolutely placed at x%,y% on the field.
function playerChip(p, x, y) {
    const g = WC_GOALS[p.id] || 0, a = (WC_ASSISTS && WC_ASSISTS[p.id]) || 0;
    const gl = `${g} ${g === 1 ? 'goal' : 'goals'}`, al = `${a} ${a === 1 ? 'assist' : 'assists'}`;
    const badge = (g || a) ? `<span class="pc-badge">${g ? `⚽${g}` : ''}${g && a ? ' ' : ''}${a ? `🅰${a}` : ''}</span>` : '';
    const inMark = p.subbedIn ? '<span class="pc-in" title="Came on as a substitute">▲</span>' : '';
    const onPitch = x != null;
    const style = onPitch ? ` style="left:${x.toFixed(1)}%;top:${y}%"` : '';
    const flip = onPitch && y < 30 ? ' tip-below' : ''; // front-line tooltips open downward
    return `<div class="player-chip${flip}"${style} tabindex="0" aria-label="${esc(p.full)}, ${gl}, ${al}">
        <span class="pc-num">${esc(p.jersey || '·')}</span>
        <span class="pc-name">${esc(p.name)}${inMark}</span>
        ${badge}
        <span class="pc-tip">${esc(p.full)}<br>⚽ ${gl} · 🅰 ${al}<span class="pc-tip-sub">World Cup 2026</span></span>
    </div>`;
}

// Football-pitch markings (portrait), stretched behind the players.
const PITCH_SVG = `<svg class="pitch-lines" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden="true">
    <rect x="1" y="1" width="98" height="148" rx="2"/>
    <line x1="1" y1="75" x2="99" y2="75"/>
    <circle cx="50" cy="75" r="12"/>
    <circle class="spot" cx="50" cy="75" r="1"/>
    <rect x="21" y="1" width="58" height="22"/>
    <rect x="37" y="1" width="26" height="8"/>
    <circle class="spot" cx="50" cy="15" r="1"/>
    <path d="M40 23 A 12 12 0 0 0 60 23"/>
    <rect x="21" y="127" width="58" height="22"/>
    <rect x="37" y="141" width="26" height="8"/>
    <circle class="spot" cx="50" cy="135" r="1"/>
    <path d="M40 127 A 12 12 0 0 1 60 127"/>
</svg>`;

// Lay the XI out by real position: each player gets a vertical band (posBand)
// and a left→right slot within it, so the shape reflects the formation.
const BAND_Y = [14, 28, 44, 58, 74, 90]; // front line → goalkeeper
function pitchHtml(starters) {
    const bands = {};
    for (const p of starters) (bands[posBand(p.pos)] = bands[posBand(p.pos)] || []).push(p);
    let chips = '';
    Object.keys(bands).forEach(bk => {
        const row = bands[bk].sort((m, n) =>
            posOrder(m.pos) - posOrder(n.pos) || m.place - n.place || parseInt(m.jersey || 99, 10) - parseInt(n.jersey || 99, 10));
        const n = row.length;
        const margin = n >= 4 ? 13 : n === 3 ? 20 : n === 2 ? 33 : 50;
        row.forEach((p, k) => {
            const x = n === 1 ? 50 : margin + (k / (n - 1)) * (100 - 2 * margin);
            chips += playerChip(p, x, BAND_Y[+bk]);
        });
    });
    return `<div class="pitch">${PITCH_SVG}<div class="pitch-players">${chips}</div></div>`;
}

function lineupContentHtml(code, data) {
    if (!data) return '<div class="empty-state">Lineup isn’t available yet for this team.</div>';
    let note;
    if (data.presumed) {
        note = `Predicted XI · ${esc(data.formation)} — ${esc(TEAM[code].name)} haven’t kicked off yet, so this is a default shape, not a confirmed lineup.`;
    } else {
        const fm = data.fromMatch;
        const opp = fm ? TEAM[fm.home === code ? fm.away : fm.home] : null;
        note = `Starting XI${data.formation ? ` · ${esc(data.formation)}` : ''}${opp ? ` · from ${esc(TEAM[code].name)} v ${esc(opp.name)}` : ''}`;
    }
    const subsLabel = data.presumed ? 'Rest of squad' : 'Substitutes';
    const subsSide = data.subs.length
        ? `<div class="subs-side"><h4>${subsLabel}</h4><div class="subs-list">${data.subs.map(subRow).join('')}</div></div>`
        : '';
    return `<p class="lineup-note">${note}</p>
        <div class="lineup-layout">${subsSide}${pitchHtml(data.lines.flat())}</div>
        <p class="lineup-foot muted">⚽ goals · 🅰 assists (World Cup 2026) — hover a pitch player for the same.</p>`;
}

// A substitute's row for the left-hand panel: number, name, and WC-2026 G/A.
function subRow(p) {
    const g = WC_GOALS[p.id] || 0, a = (WC_ASSISTS && WC_ASSISTS[p.id]) || 0;
    const inMark = p.subbedIn ? ' <span class="pc-in" title="Came on as a substitute">▲</span>' : '';
    return `<div class="sub-row" tabindex="0" aria-label="${esc(p.full)}, ${g} goals, ${a} assists">
        <span class="sr-num">${esc(p.jersey || '·')}</span>
        <span class="sr-name">${esc(p.name)}${inMark}</span>
        <span class="sr-ga"><span title="Goals">⚽${g}</span><span title="Assists">🅰${a}</span></span>
    </div>`;
}

async function openLineupModal(code) {
    const t = TEAM[code];
    if (!t) return;
    const tok = ++lineupToken;
    openMatchId = null;
    $('#modalBody').innerHTML = `
        <div class="modal-header lineup-head">
            <div class="lh-flag">${teamFlag(t)}</div>
            <div>
                <div class="lh-name">${esc(t.name)}</div>
                <div class="lh-group">Group ${t.group} · Lineup</div>
            </div>
        </div>
        <div class="modal-body" id="lineupContent"><div class="empty-state">Loading lineup…</div></div>`;
    $('#modalBackdrop').classList.add('open');
    $('#modalBackdrop').setAttribute('aria-hidden', 'false');
    onModalOpened();

    await loadWcStats();
    const data = await loadLineup(code);
    if (tok !== lineupToken) return; // modal was closed or another team opened meanwhile
    const el = document.getElementById('lineupContent');
    if (el) el.innerHTML = lineupContentHtml(code, data);
}

// Persist favorites to localStorage (browser) AND a cookie (so the
// server-side api/ functions can read them for personalization).
function saveFavorites() {
    const json = JSON.stringify([...STATE.favorites]);
    try { localStorage.setItem('wc26-favs', json); } catch (e) {}
    // 1 year, root path, sent same-site on every request to our own api.
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `wc26-favs=${encodeURIComponent(json)}; path=/; max-age=${maxAge}; samesite=lax`;
}

function toggleFavorite(code) {
    if (STATE.favorites.has(code)) STATE.favorites.delete(code);
    else STATE.favorites.add(code);
    saveFavorites();
    renderFavorites();
    renderLiveSection();
    renderGroups();
    renderFavoritesFeed();
    syncPushFavorites().catch(() => {}); // keep server-side push targeting current
}

// ===== "YOUR TEAMS — NEXT UP" FEED =====
// Renders the favorited teams' matches straight from MATCHES — the same
// in-memory fixtures the Live section uses, kept current by refreshESPN()
// every 60s (ESPN: keyless, CORS-open, near-real-time). No network call, so
// live scores here are always exactly as fresh as the rest of the app.
// Favorites are still mirrored to the wc26-favs cookie by saveFavorites().
function renderFavoritesFeed() {
    const block = $('#favFeed'), grid = $('#favFeedMatches');
    if (!block || !grid) return;
    if (STATE.favorites.size === 0) { block.hidden = true; return; }

    // Live first, then soonest upcoming, then most-recently finished.
    const rank = { live: 0, upcoming: 1, finished: 2 };
    const fav = MATCHES.filter(isFavMatch).sort((a, b) => {
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return a.status === 'finished' ? instantOf(b) - instantOf(a) : instantOf(a) - instantOf(b);
    });

    if (!fav.length) { block.hidden = true; return; }
    grid.innerHTML = fav.slice(0, 8).map(matchCard).join('');
    block.hidden = false;
}

// ===== MATCH MODAL =====
let openMatchId = null;

// The stats + events portion of the modal (re-rendered after ESPN detail loads).
function modalDetailHtml(m) {
    const home = TEAM[m.home], away = TEAM[m.away];
    const stats = m.stats;
    const statsHtml = stats ? `
        <h4 class="stats-head">Match Stats</h4>
        ${statRow('Possession %', stats.poss[0], stats.poss[1])}
        ${statRow('Shots', stats.shots[0], stats.shots[1])}
        ${statRow('Shots on Target', stats.onTarget[0], stats.onTarget[1])}
        ${statRow('Corners', stats.corners[0], stats.corners[1])}
        ${statRow('Fouls', stats.fouls[0], stats.fouls[1])}
    ` : `<p class="muted" style="text-align:center;padding:1rem 0;">${
        (m.status === 'live' || m.status === 'finished')
            ? (m.espnLoaded ? "Detailed stats aren't available for this match." : 'Loading match stats…')
            : 'Stats available once the match starts.'
    }</p>`;

    const evList = m.espnEvents || m.events;
    const eventsHtml = (evList && evList.length) ? `
        <div class="timeline">
            <h4>Match Events</h4>
            ${evList.slice().sort((a, b) => b.min - a.min).map(ev => {
                const team = ev.side === 'home' ? home : away;
                const icon = ev.type === 'goal' ? '⚽' : ev.type === 'og' ? '🥅' : ev.type === 'yellow' ? '🟨' : ev.type === 'red' ? '🟥' : ev.type === 'sub' ? '🔄' : ev.type === 'disallowed' ? '🚫' : ev.type === 'penmiss' ? '❌' : '•';
                const who = ev.player ? ' · ' + esc(ev.player) : '';
                const text = ev.type === 'goal'
                    ? `<strong>GOAL</strong>${ev.pen ? ' <span class="muted">(pen)</span>' : ''}${who}${ev.assist ? ` <span class="muted">(assist: ${esc(ev.assist)})</span>` : ''}`
                    : ev.type === 'og' ? `<strong>OWN GOAL</strong>${who}`
                    : ev.type === 'yellow' ? `Yellow card${who}`
                    : ev.type === 'red' ? `<strong>RED CARD</strong>${who}`
                    : ev.type === 'sub' ? `Substitution${who}`
                    : ev.type === 'disallowed' ? `<strong>GOAL DISALLOWED</strong>${ev.reason ? ` <span class="muted">(${esc(ev.reason)})</span>` : ''}${who}`
                    : ev.type === 'penmiss' ? `<strong>PENALTY ${ev.saved ? 'SAVED' : 'MISSED'}</strong>${who}`
                    : `${esc(ev.type)}${who}`;
                return `<div class="tl-event${ev.type === 'disallowed' ? ' tl-void' : ''}${ev.type === 'penmiss' ? ' tl-miss' : ''}">
                    <span class="tl-min">${ev.minLabel || ev.min}'</span>
                    <span class="tl-icon">${icon}</span>
                    <span class="tl-text">${text}<span class="tl-team-tag">${teamFlag(team)} ${esc(team.name)}</span></span>
                </div>`;
            }).join('')}
        </div>` : (m.status === 'upcoming' ? '<p class="muted" style="text-align:center;padding:1rem 0;">Live commentary begins at kick-off.</p>' : '');

    return statsHtml + eventsHtml;
}

// Lazily fetch real stats + events from ESPN for the open match.
async function loadEspnDetail(m) {
    if (m.espnLoaded || !m.espnId || (m.status !== 'live' && m.status !== 'finished')) return;
    try {
        const r = await fetch(`${ESPN_BASE}/summary?event=${m.espnId}`, { cache: 'no-store' });
        if (r.ok) applyEspnSummary(m, await r.json());
    } catch (e) { /* keep graceful */ }
    m.espnLoaded = true;
    const detail = document.getElementById('modalDetail');
    if (detail && openMatchId === m.id && $('#modalBackdrop').classList.contains('open')) {
        detail.innerHTML = modalDetailHtml(m);
    }
}

function openMatchModal(matchId) {
    const m = MATCHES.find(x => x.id === matchId);
    if (!m) return;
    openMatchId = m.id;
    const home = TEAM[m.home], away = TEAM[m.away];

    let statusLine;
    if (m.status === 'live') statusLine = `<span class="live-tag"><span class="live-dot"></span>${liveLabel(m)}</span>`;
    else if (m.status === 'finished') statusLine = `Full Time · ${fmtLocalDateTime(m)}`;
    else statusLine = `Kick off ${fmtLocalDateTime(m)}`;

    const scoreDisplay = (m.status === 'live' || m.status === 'finished')
        ? `${m.homeScore} <span class="vs">–</span> ${m.awayScore}`
        : `<span class="vs">vs</span>`;

    $('#modalBody').innerHTML = `
        <div class="modal-header">
            <div class="mh-meta">
                <span><span class="mc-group-tag">${m.group}</span> Group ${m.group}</span>
                <span>📍 ${esc(m.venue)}</span>
            </div>
            <div class="mh-teams">
                <div class="mh-team">
                    <div class="mh-flag">${teamFlag(home)}</div>
                    <div class="mh-name">${esc(home.name)}</div>
                </div>
                <div class="mh-score">${scoreDisplay}</div>
                <div class="mh-team">
                    <div class="mh-flag">${teamFlag(away)}</div>
                    <div class="mh-name">${esc(away.name)}</div>
                </div>
            </div>
            <div class="mh-status">${statusLine}</div>
        </div>
        <div class="modal-body" id="modalDetail">${modalDetailHtml(m)}</div>
    `;
    $('#modalBackdrop').classList.add('open');
    $('#modalBackdrop').setAttribute('aria-hidden', 'false');
    onModalOpened();
    loadEspnDetail(m);
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

// ===== MODAL FOCUS MANAGEMENT (accessibility) =====
// Keep keyboard focus inside the open dialog and return it to wherever it was
// when the dialog closes, so keyboard / screen-reader users aren't dropped at
// the top of the page.
let lastFocusedEl = null;

function focusTrap(e) {
    if (e.key !== 'Tab') return;
    const modal = $('.modal');
    if (!modal) return;
    const f = $$('button, [href], input, [tabindex]:not([tabindex="-1"])', modal)
        .filter(el => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// Both modal openers call this once the dialog is shown.
function onModalOpened() {
    lastFocusedEl = document.activeElement;
    document.addEventListener('keydown', focusTrap);
    const close = $('#modalClose');
    if (close) close.focus();
}

function closeModal() {
    openMatchId = null;
    $('#modalBackdrop').classList.remove('open');
    $('#modalBackdrop').setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', focusTrap);
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
    lastFocusedEl = null;
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
        if (mapped === 'live') {
            m.apiMinute = s.minute ?? null;
            m.halftime = s.status === 'PAUSED'; // football-data uses PAUSED for the break
        }
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
    setFooterNote(true, 'football-data');
    if (changed) renderAll();
}

// ===== LIVE DATA: ESPN (primary) =====
// ESPN's public, keyless, CORS-open API covers the live tournament with real
// scores, minute, stats and events. Called directly from the browser. Its team
// abbreviations match the app's FIFA codes exactly.
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const ESPN_CORE_BASE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world';
const ESPN_STATE = { in: 'live', post: 'finished' };

// Reference data harvested from ESPN, used by the team lineup view.
const ESPN_TEAM_ID = {};   // FIFA code -> ESPN numeric team id (from the scoreboard)
let WC_GOALS = {};         // ESPN athlete id -> tournament goals (rebuilt each refresh)
let WC_ASSISTS = null;     // ESPN athlete id -> tournament assists (lazy, from leaders)
const LINEUP_CACHE = {};   // FIFA code -> parsed lineup

async function refreshESPN() {
    let data;
    try {
        const r = await fetch(`${ESPN_BASE}/scoreboard?dates=20260611-20260719&limit=400`, { cache: 'no-store' });
        if (!r.ok) return false;
        data = await r.json();
    } catch (e) { return false; }

    const byPair = new Map();
    for (const m of MATCHES) byPair.set(pairKey(m.home, m.away), m);
    let applied = 0;
    const goalLog = []; // tournament-wide goals for the top-scorers list
    const goalsById = {}; // ESPN athlete id -> goals, for the lineup view
    for (const ev of (data.events || [])) {
        const comp = ev.competitions && ev.competitions[0];
        const cs = (comp && comp.competitors) || [];
        if (cs.length < 2) continue;
        const ab0 = cs[0].team.abbreviation, ab1 = cs[1].team.abbreviation;
        if (cs[0].team.id) ESPN_TEAM_ID[ab0] = cs[0].team.id;
        if (cs[1].team.id) ESPN_TEAM_ID[ab1] = cs[1].team.id;

        // Collect goal scorers from this match's details (excludes own goals).
        const idToCode = { [cs[0].id]: ab0, [cs[1].id]: ab1 };
        for (const det of (comp.details || [])) {
            const tyt = (det.type && det.type.text) || '';
            // Real goals only — skip own goals and VAR-disallowed "goals".
            if (!/goal/i.test(tyt) || /own goal/i.test(tyt) || /disallow|no goal|ruled out|cancell?ed/i.test(tyt)) continue;
            const code = idToCode[det.team && det.team.id];
            const a0 = det.athletesInvolved && det.athletesInvolved[0];
            if (code && a0 && a0.displayName) goalLog.push({ player: a0.displayName, code });
            if (a0 && a0.id) goalsById[a0.id] = (goalsById[a0.id] || 0) + 1;
        }

        // Record any decided result by team-pair so the knockout bracket can
        // propagate real winners (group games are harmless here; the bracket
        // only ever looks up knockout pairings).
        if (ev.status && ev.status.type && ev.status.type.state === 'post') {
            const w = cs[0].winner ? ab0 : cs[1].winner ? ab1 : null;
            if (w) KNOCKOUT[pairKey(ab0, ab1)] = w;
        }

        const m = byPair.get(pairKey(ab0, ab1));
        if (!m) continue;
        m.espnId = ev.id; // keep for win-odds + lazy detail, even while still 'pre'
        const st = ESPN_STATE[ev.status.type.state];
        if (!st) continue; // 'pre' → leave upcoming (odds still load below)
        const score = {}; score[ab0] = parseInt(cs[0].score, 10); score[ab1] = parseInt(cs[1].score, 10);
        if (isNaN(score[m.home]) || isNaN(score[m.away])) continue;
        m.homeScore = score[m.home]; m.awayScore = score[m.away];
        m.status = st;
        if (st === 'live') {
            m.espnLoaded = false; // refetch detail on next open (stats change)
            const t = ev.status.type || {};
            m.halftime = t.name === 'STATUS_HALFTIME' || /half[\s-]?time/i.test(t.description || t.detail || '');
            const dc = ev.status.displayClock || t.detail || '';
            const mm = String(dc).match(/(\d+)/);
            m.apiMinute = mm ? parseInt(mm[1], 10) : null;
        }
        applied++;
    }
    ESPN_GOALS = goalLog;
    WC_GOALS = goalsById;
    setFooterNote(true, 'espn');
    maybeNotifyFavorites(); // OS alerts for favourited teams' kick-offs / goals / FT
    if (applied || goalLog.length) renderAll();
    return true;
}

// ===== WIN PROBABILITY (ESPN sportsbook odds → implied %) =====
// ESPN serves real, per-match odds via its core API. We take the home/draw/away
// American moneylines, convert each to an implied probability, then strip the
// book's built-in margin (the "vig") by normalising the three to 100% — giving
// an honest win/draw/win split straight from ESPN's own odds feed.
// (Reuses ESPN_CORE_BASE, defined above for the leaders feed.)

function americanToProb(ml) {
    const n = typeof ml === 'string' ? parseInt(ml.replace(/[+\s]/g, ''), 10) : ml;
    if (n == null || isNaN(n)) return null;
    return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

// Split three raw weights into whole percentages that always sum to 100
// (largest-remainder rounding), so the bar fills exactly and labels add up.
function pctTriple(h, d, a) {
    const raw = [h, d, a], sum = h + d + a;
    const scaled = raw.map(v => (v / sum) * 100);
    const out = scaled.map(Math.floor);
    let left = 100 - out.reduce((x, y) => x + y, 0);
    const order = scaled.map((v, i) => [v - Math.floor(v), i]).sort((p, q) => q[0] - p[0]);
    for (let i = 0; i < left; i++) out[order[i][1]]++;
    return out;
}

function winProbFromOdds(item) {
    if (!item) return null;
    const h = americanToProb(item.homeTeamOdds && item.homeTeamOdds.moneyLine);
    const d = americanToProb(item.drawOdds && item.drawOdds.moneyLine);
    const a = americanToProb(item.awayTeamOdds && item.awayTeamOdds.moneyLine);
    if (h == null || d == null || a == null) return null;
    const [home, draw, away] = pctTriple(h, d, a);
    return { home, draw, away, provider: (item.provider && item.provider.name) || null };
}

let oddsBusy = false;

// Fetch a single match's odds once (6KB each); the result is cached on the
// match so we never refetch. A missing/closed market just leaves no bar.
async function loadOddsFor(m) {
    if (!m.espnId || m.oddsLoaded) return false;
    m.oddsLoaded = true; // claim it up-front so concurrent ticks don't double-fetch
    try {
        const r = await fetch(`${ESPN_CORE_BASE}/events/${m.espnId}/competitions/${m.espnId}/odds`);
        if (!r.ok) return false;
        const d = await r.json();
        const wp = winProbFromOdds((d.items || [])[0]);
        if (wp) { m.odds = wp; return true; }
    } catch (e) { /* offline / no odds — the card simply omits the bar */ }
    return false;
}

async function refreshOdds() {
    if (oddsBusy) return;
    const pending = MATCHES.filter(m => m.espnId && !m.oddsLoaded);
    if (!pending.length) return;
    oddsBusy = true;
    let any = false;
    const LIMIT = 6; // gentle concurrency so we don't hammer ESPN
    for (let i = 0; i < pending.length; i += LIMIT) {
        const got = await Promise.all(pending.slice(i, i + LIMIT).map(loadOddsFor));
        if (got.some(Boolean)) any = true;
    }
    oddsBusy = false;
    if (any) renderAll(); // paint the bars in once the odds land
}

// ===== MATCH NOTIFICATIONS (in-tab) =====
// Instant OS notifications for favourited teams while the site is open in any
// tab. We diff each ESPN refresh against the previous snapshot and ping on the
// three moments that matter: kick-off, a goal, and full-time. When the tab is
// fully closed, the Web Push path below takes over (server-sent). Both share the
// same notification `tag` (keyed on the ESPN event id) so the OS collapses a
// duplicate instead of alerting twice.
let NOTIFY_SNAP = null; // matchId -> {h, a, st}; null until the first refresh seeds it

const notifySupported = () => typeof Notification !== 'undefined';

function fireNotification(title, body, tag, iconTeam) {
    if (!notifySupported() || Notification.permission !== 'granted') return;
    const iso = iconTeam && FIFA_TO_ISO[iconTeam.code];
    try {
        new Notification(title, { body, tag, icon: iso ? `flags/${iso}.png` : undefined });
    } catch (e) { /* some mobile browsers throw on construction — ignore */ }
}

function maybeNotifyFavorites() {
    if (!notifySupported()) return;
    const snapNow = {};
    for (const m of MATCHES) snapNow[m.id] = { h: m.homeScore ?? 0, a: m.awayScore ?? 0, st: m.status };

    // Only diff once a prior snapshot exists from a real ESPN refresh — this
    // avoids firing for matches that were already live when the page loaded.
    if (NOTIFY_SNAP && STATE.notify && Notification.permission === 'granted') {
        for (const m of MATCHES) {
            if (!isFavMatch(m)) continue;
            const prev = NOTIFY_SNAP[m.id];
            if (!prev) continue;
            const home = TEAM[m.home], away = TEAM[m.away];
            const line = `${home.name} ${m.homeScore ?? 0}–${m.awayScore ?? 0} ${away.name}`;
            const key = m.espnId || m.id; // align tags with the server push path

            if (prev.st !== 'live' && m.status === 'live') {
                fireNotification('🟢 Kick-off', `${home.name} vs ${away.name} is under way`, `ko-${key}`, home);
            }
            if (m.status === 'live') {
                const tag = `g-${key}-${m.homeScore}-${m.awayScore}`;
                if ((m.homeScore ?? 0) > prev.h) fireNotification(`⚽ GOAL — ${home.name}!`, line, tag, home);
                if ((m.awayScore ?? 0) > prev.a) fireNotification(`⚽ GOAL — ${away.name}!`, line, tag, away);
            }
            if (prev.st !== 'finished' && m.status === 'finished') {
                fireNotification('🏁 Full-time', line, `ft-${key}`, null);
            }
        }
    }
    NOTIFY_SNAP = snapNow;
}

function updateNotifyToggle() {
    const btn = $('#notifyToggle');
    if (!btn) return;
    if (!notifySupported()) { btn.hidden = true; return; }
    if (Notification.permission === 'denied') {
        btn.disabled = true;
        btn.classList.remove('on');
        btn.textContent = '🔕 Alerts blocked — enable them in your browser settings';
        return;
    }
    const on = STATE.notify && Notification.permission === 'granted';
    btn.disabled = false;
    btn.classList.toggle('on', on);
    btn.textContent = on ? '🔔 Match alerts on — tap to turn off' : '🔔 Notify me about my teams';
}

async function onNotifyToggle() {
    if (!notifySupported()) return;
    if (Notification.permission === 'default') {
        const res = await Notification.requestPermission();
        STATE.notify = res === 'granted';
    } else if (Notification.permission === 'granted') {
        STATE.notify = !STATE.notify; // toggle off/on without re-prompting
    }
    localStorage.setItem('wc26-notify', STATE.notify ? '1' : '0');
    updateNotifyToggle();
    if (STATE.notify) {
        fireNotification('🔔 Alerts on', "You'll get kick-off, goal & full-time alerts for your teams.", 'welcome', null);
        subscribeToPush().catch(() => {}); // background push, when the server's configured
    } else {
        unsubscribeFromPush().catch(() => {});
    }
}

// ===== WEB PUSH (background notifications when the tab is closed) =====
// Subscribes via the Push API and registers the subscription + the user's
// favorite team codes with the server, which pushes kick-off/goal/full-time
// alerts even with no tab open. Degrades silently to in-tab-only when the server
// isn't push-configured or the browser lacks support.
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && typeof atob === 'function';

// VAPID public keys are base64url; the subscribe() call wants a Uint8Array.
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
}

let pushPublicKey; // undefined = unfetched, '' = server not configured
async function getPushPublicKey() {
    if (pushPublicKey !== undefined) return pushPublicKey;
    try {
        const j = await (await fetch('/api/push-config')).json();
        pushPublicKey = (j && j.ok && j.publicKey) ? j.publicKey : '';
    } catch (e) { pushPublicKey = ''; }
    return pushPublicKey;
}

async function postSubscription(action, subscription) {
    try {
        await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, subscription, favs: [...STATE.favorites] }),
        });
    } catch (e) { /* offline / not configured — in-tab alerts still work */ }
}

async function subscribeToPush() {
    if (!pushSupported()) return false;
    const key = await getPushPublicKey();
    if (!key) return false; // server hasn't got VAPID keys → in-tab only
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
        });
    }
    await postSubscription('subscribe', sub);
    return true;
}

async function unsubscribeFromPush() {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await postSubscription('unsubscribe', sub);
    try { await sub.unsubscribe(); } catch (e) { /* ignore */ }
}

// Keep the server's copy of the favorites in step when they change (only if the
// user already opted into push).
async function syncPushFavorites() {
    if (!STATE.notify || !pushSupported()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await postSubscription('subscribe', sub);
}

// Parse an ESPN match summary into the app's stats + events shape.
function applyEspnSummary(m, sum) {
    const teams = (sum.boxscore && sum.boxscore.teams) || [];
    const pick = (arr, name) => {
        const s = (arr || []).find(x => x.name === name);
        if (!s) return null;
        const v = parseFloat(String(s.displayValue != null ? s.displayValue : s.value));
        return isNaN(v) ? null : v;
    };
    const out = { poss: [0, 0], shots: [0, 0], onTarget: [0, 0], corners: [0, 0], fouls: [0, 0] };
    let any = false;
    for (const t of teams) {
        const i = (t.team && t.team.abbreviation) === m.away ? 1 : 0;
        const sa = t.statistics || [];
        if (sa.length) any = true;
        const p = pick(sa, 'possessionPct'); if (p != null) out.poss[i] = p;
        out.shots[i] = pick(sa, 'totalShots') || 0;
        out.onTarget[i] = pick(sa, 'shotsOnTarget') || 0;
        out.corners[i] = pick(sa, 'wonCorners') || 0;
        out.fouls[i] = pick(sa, 'foulsCommitted') || 0;
    }
    if (any) m.stats = out;

    const comp = ((sum.header && sum.header.competitions) || [])[0];
    const idToCode = {};
    if (comp) for (const c of (comp.competitors || [])) idToCode[c.id] = c.team.abbreviation;
    const evs = [];
    for (const e of (sum.keyEvents || [])) {
        const tyt = (e.type && e.type.text) || '';
        const etext = e.text || '';
        const blob = `${tyt} ${etext}`;
        // ESPN flags a spot-kick with penaltyKick / shootout, or just says so in
        // the text. A scored penalty is a goal (annotated); a missed or saved one
        // used to fall through every branch and vanish — now it's its own event.
        const isPen = e.penaltyKick === true || /\bpenalt/i.test(blob);
        let type = null, pen = false, saved = false;
        // A VAR-cancelled goal reads as "Goal Disallowed" — catch it BEFORE the
        // /goal/ checks so it's shown as disallowed, never as a real goal.
        if (/disallow|no goal|ruled out|goal cancell?ed/i.test(tyt) || (/goal/i.test(tyt) && /offside|var|video review/i.test(tyt))) type = 'disallowed';
        else if (/own goal/i.test(tyt)) type = 'og';
        else if (isPen && /saved/i.test(blob)) { type = 'penmiss'; saved = true; }
        else if (isPen && /miss|fail|wide|over the|off the|hits? the (?:post|bar|crossbar)|woodwork/i.test(blob)) type = 'penmiss';
        else if (isPen && (e.scoringPlay === true || /goal|scored|convert/i.test(blob))) { type = 'goal'; pen = true; }
        else if (/goal/i.test(tyt)) type = 'goal';
        else if (/yellow card/i.test(tyt)) type = 'yellow';
        else if (/red card/i.test(tyt)) type = 'red';
        else if (/substitut/i.test(tyt)) type = 'sub';
        else if (isPen) type = 'penmiss'; // a penalty with no clear outcome — still surface it
        if (!type) continue;
        const side = idToCode[e.team && e.team.id] === m.away ? 'away' : 'home';
        // "45'+1'" → sortable 45.01, label "45+1"; "11'" → 11, "11"
        const cm = String((e.clock && e.clock.displayValue) || '').match(/(\d+)(?:\D*\+(\d+))?/);
        let base = cm ? parseInt(cm[1], 10) : 0;
        const extra = cm && cm[2] ? parseInt(cm[2], 10) : 0;
        // Subs made during the break sit on a frozen 45' clock but belong to the
        // second half (period ≥ 2) — they're the 46th minute, not 45'.
        const periodNum = (e.period && e.period.number) || 0;
        if (periodNum >= 2 && base === 45 && !extra) base = 46;
        const min = base + extra / 100;
        const minLabel = extra ? `${base}+${extra}` : `${base}`;
        const text = etext;
        let player = null, assist = null, reason = null;
        if (type === 'goal' || type === 'og') {
            const mm = text.match(/\d\.\s*([^(.]+?)\s*\(/); if (mm) player = mm[1].trim();
            // Penalty-goal text often lacks the "12. Name" prefix — fall back to
            // the first "Firstname Lastname (" in the sentence.
            if (!player) { const pm = text.match(/([A-Z][a-zà-ÿ'.-]+(?:\s+[A-Z][a-zà-ÿ'.-]+)*)\s*\(/); if (pm) player = pm[1].trim(); }
            const am = text.match(/assisted by ([^.]+?)\./i); if (am) assist = am[1].trim();
        } else if (type === 'disallowed' || type === 'penmiss') {
            // Name is the first "Name (" in the text — one or more words, so a
            // single-name player (e.g. "Neymar (") is matched too.
            const pm = text.match(/([A-Z][a-zà-ÿ'.-]+(?:\s+[A-Z][a-zà-ÿ'.-]+)*)\s*\(/); if (pm) player = pm[1].trim();
            if (type === 'disallowed') {
                const rm = text.match(/offside|hand ?ball|foul|push(?:ing)?|encroach\w*/i);
                if (rm) reason = rm[0].toLowerCase().replace(/hand ?ball/, 'handball');
            }
        } else {
            const mm = text.match(/^\s*([^(]+?)\s*\(/); if (mm) player = mm[1].trim();
        }
        evs.push({ min, minLabel, type, side, player, assist, reason, pen, saved });
    }
    if (evs.length) m.espnEvents = evs;
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

function setFooterNote(live, source) {
    const el = $('#footerNote');
    if (!el) return;
    if (!live) { el.textContent = 'Live source unavailable — showing bundled sample data.'; return; }
    const schedule = 'Schedule via <a href="https://github.com/openfootball/worldcup.json" target="_blank" rel="noopener">openfootball</a>';
    if (source === 'espn') el.innerHTML = `${schedule} · live scores &amp; stats via <a href="https://www.espn.com/soccer/" target="_blank" rel="noopener">ESPN</a>.`;
    else if (source === 'football-data') el.innerHTML = `${schedule} · live scores via <a href="https://www.football-data.org" target="_blank" rel="noopener">football-data.org</a>.`;
    else el.innerHTML = `${schedule} · public-domain World Cup 2026 data.`;
}

// ===== SEO: Schema.org SportsEvent markup =====
// Emit JSON-LD for the upcoming/live fixtures so search engines can surface them
// as rich results. Rebuilt from the in-memory schedule on each render (cheap).
function renderStructuredData() {
    if (!Array.isArray(MATCHES) || !TEAM) return;
    const items = MATCHES
        .filter(m => m.status !== 'finished')
        .sort((a, b) => instantOf(a) - instantOf(b))
        .slice(0, 50)
        .map(m => {
            const home = TEAM[m.home], away = TEAM[m.away];
            if (!home || !away) return null;
            return {
                '@type': 'SportsEvent',
                name: `${home.name} vs ${away.name}`,
                sport: 'Association football',
                startDate: instantOf(m).toISOString(),
                eventStatus: 'https://schema.org/EventScheduled',
                location: { '@type': 'Place', name: m.venue },
                competitor: [
                    { '@type': 'SportsTeam', name: home.name },
                    { '@type': 'SportsTeam', name: away.name },
                ],
                superEvent: { '@type': 'SportsEvent', name: 'FIFA World Cup 2026' },
            };
        })
        .filter(Boolean);
    const payload = { '@context': 'https://schema.org', '@graph': items };
    let el = document.getElementById('ld-matches');
    if (!el) {
        el = document.createElement('script');
        el.type = 'application/ld+json';
        el.id = 'ld-matches';
        document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(payload); // JSON.stringify escapes safely
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
    renderFavoritesFeed();
    renderStructuredData();
    if (!tickerStarted) { startLiveTicker(); tickerStarted = true; }
}

// One-time wiring that needs no data.
function initChrome() {
    initTheme();
    saveFavorites(); // seed the cookie from any favorites already in localStorage
    $$('.nav-link').forEach(l => l.addEventListener('click', e => { e.preventDefault(); setSection(l.dataset.section); }));
    $$('.filter-chip').forEach(c => c.addEventListener('click', () => {
        $$('.filter-chip').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
        c.classList.add('active');
        c.setAttribute('aria-pressed', 'true');
        STATE.filter = c.dataset.filter;
        renderLiveSection();
    }));
    // Reflect the default-selected chip to assistive tech.
    $$('.filter-chip').forEach(c => c.setAttribute('aria-pressed', c.classList.contains('active') ? 'true' : 'false'));
    document.addEventListener('click', e => {
        const card = e.target.closest('.match-card');
        if (card && card.dataset.match) { openMatchModal(card.dataset.match); return; }
        const view = e.target.closest('.ft-view');
        if (view) { openLineupModal(view.dataset.view); return; } // before the fav toggle
        const fav = e.target.closest('.fav-tile');
        if (fav) toggleFavorite(fav.dataset.fav);
    });
    // Keyboard equivalent of the above: match cards and fav tiles are role=button
    // and focusable, so Enter/Space must activate them. (The "View" button is a
    // real <button>, so its native click already fires — skip it here.)
    document.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        if (e.target.closest('.ft-view')) return;
        const card = e.target.closest('.match-card');
        if (card && card.dataset.match) { e.preventDefault(); openMatchModal(card.dataset.match); return; }
        const fav = e.target.closest('.fav-tile');
        if (fav) { e.preventDefault(); toggleFavorite(fav.dataset.fav); }
    });
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    $('#notifyToggle').addEventListener('click', onNotifyToggle);
    updateNotifyToggle();
}

// Register the service worker for offline app-shell + installability. Kept
// fully optional: any failure (or an unsupported browser) just means the site
// runs online-only, exactly as before.
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .catch(e => console.warn('Service worker registration failed:', e));
    });
}

async function boot() {
    initChrome();
    registerServiceWorker();
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
    setFooterNote(live, null);

    // If the user already opted into alerts on a previous visit, make sure this
    // device/browser has a live push subscription (it may be a new device, or the
    // old subscription may have expired) and that the server has current favs.
    if (STATE.notify && notifySupported() && Notification.permission === 'granted') {
        subscribeToPush().catch(() => {});
    }

    // Layer real live scores/stats over the openfootball schedule and keep them
    // fresh. ESPN (keyless, has stats + events) is primary; football-data is the
    // fallback. Both no-op gracefully if unreachable.
    if (live) {
        const tick = () => refreshESPN().then(ok => { if (!ok) refreshScores(); }).then(refreshOdds);
        await tick(); // initial live layer over the schedule

        // Auto-refresh so the viewer never has to reload. Poll faster while a
        // match is in play (every 30s) than when nothing's live (every 60s)…
        let timer = null;
        const anyLive = () => MATCHES.some(m => m.status === 'live');
        const loop = () => {
            clearTimeout(timer);
            timer = setTimeout(() => tick().then(loop), anyLive() ? 30000 : 60000);
        };
        loop();

        // …and refresh immediately when the tab regains focus, so returning to
        // the page never shows a stale score while waiting for the next tick.
        document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    }
}

document.addEventListener('DOMContentLoaded', boot);
