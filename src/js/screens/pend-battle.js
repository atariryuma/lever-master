/**
 * ふりこ たいせん「ジャスト・タイム」：準備画面とプレイ
 *
 * 目標（10往復で 16.0秒 など）に合わせて、ふりこの長さを決める。全員決まったら いっせいに手をはなし、
 * 10往復の時間（実測）が目標に近いほど高い点。ラウンドの合計点で勝負。
 * 重さ・ふれはばも変えられるが、時間には関係ない（わな）。
 */

import {
    canChoose, choose, createMatch, currentPlayer, nearestFree, nextRound, playerById, resolveRound, takenLengths, targetLabel,
} from '../engine/pend-battle.js';
import { CPU_LEVELS, planPick } from '../engine/pend-ai.js';
import { COUNT, LENGTHS, LENGTH_MAX, LENGTH_MIN, clampLength, createPendulum, cycleTimeOf, round1, tenOf } from '../engine/pendulum.js';
import { createSwing } from '../engine/physics.js';
import { PLAYER_META } from '../players.js';
import { $, SessionEnded, announce, banner, createSession, escapeHtml, hideBanner, toast } from '../ui.js';
import { renderPendReadout, updatePendReadout } from '../ui-pend.js';
import { play, setBgm } from '../audio.js';
import * as fx from '../fx.js';
import { load, save, settings } from '../storage.js';
import { segmented } from '../widgets.js';
import { icon } from '../icons.js';
import { showRulesTour } from '../rules-tour.js';
import { normalizeSeats, renderSeats, seatsNote } from '../seats.js';

export const MODE = 'pend-battle';
export const UNIT = 'pendulum';
export const HELP = 'dlg-rules-pend';

const SETUP_DEFAULT = {
    seats: [
        { kind: 'human', level: 'normal' },
        { kind: 'cpu', level: 'normal' },
        { kind: 'none', level: 'normal' },
        { kind: 'none', level: 'normal' },
    ],
    rounds: '3',
    timer: '60',
    hints: 'on',
};
const TIMER_OPTIONS = [['none', 'なし'], ['30', '30秒'], ['60', '60秒'], ['90', '90秒']];
const SPEED = { slow: 1.6, normal: 1, fast: 0.45 };

let app;
const setup = load('pendBattleSetup', structuredClone(SETUP_DEFAULT));
if (!['2', '3', '5'].includes(String(setup.rounds))) setup.rounds = SETUP_DEFAULT.rounds;
setup.rounds = String(setup.rounds);
if (!TIMER_OPTIONS.some(([v]) => v === setup.timer)) setup.timer = SETUP_DEFAULT.timer;
if (!['on', 'off'].includes(setup.hints)) setup.hints = SETUP_DEFAULT.hints;
setup.seats = normalizeSeats(setup.seats, SETUP_DEFAULT.seats, CPU_LEVELS);

let session;
let config;
let state;
let ui;

/* ======================== 準備画面 ======================== */

export function renderSetup(appCtx) {
    app = appCtx;
    const persist = () => save('pendBattleSetup', setup);
    renderSeats($('#pend-seats'), setup, CPU_LEVELS, () => {
        validateSetup();
        persist();
    });
    segmented($('#popt-rounds'), {
        options: [['2', '2ラウンド'], ['3', '3ラウンド'], ['5', '5ラウンド']],
        value: setup.rounds,
        onChange: v => {
            setup.rounds = v;
            persist();
        },
    });
    segmented($('#popt-timer'), {
        options: TIMER_OPTIONS,
        value: setup.timer,
        onChange: v => {
            setup.timer = v;
            persist();
        },
    });
    segmented($('#popt-hints'), {
        options: [['off', 'なし'], ['on', 'あり（長さと時間の表）']],
        value: setup.hints,
        onChange: v => {
            setup.hints = v;
            persist();
        },
    });
    $('#btn-pend-start').onclick = () => {
        play('tap');
        app.go('pend-battle', { config: structuredClone(setup) });
    };
    validateSetup();
}

function validateSetup() {
    const { ok, note } = seatsNote(setup.seats);
    $('#btn-pend-start').disabled = !ok;
    $('#pend-setup-note').textContent = note;
}

/* ======================== プレイ ======================== */

const humanCount = () => state.players.filter(p => p.kind === 'human').length;

function nameOf(id) {
    const p = playerById(state, id);
    const base = PLAYER_META[id].name;
    if (p.kind === 'cpu') return `${base}（CPU）`;
    return humanCount() === 1 ? 'あなた' : base;
}

const isHumanTurn = () => state.phase === 'choose' && currentPlayer(state).kind === 'human' && !ui.busy;

export function enter(appCtx, params) {
    app = appCtx;
    config = { ...structuredClone(SETUP_DEFAULT), ...(params.config ?? structuredClone(setup)) };
    session = createSession();
    const seats = config.seats.map(s => (s.kind === 'none' ? null : { kind: s.kind, level: s.level }));
    const joined = seats.map((s, i) => (s ? i : -1)).filter(i => i >= 0);
    const firstSeat = joined[Math.floor(Math.random() * joined.length)];
    state = createMatch({ seats, rounds: Number(config.rounds), firstSeat });
    ui = {
        busy: true, intro: true, fast: false, timer: null, pick: null, grades: {},
        pendulums: new Map(state.players.map(p => [p.id, createPendulum({ id: p.id, label: PLAYER_META[p.id].name, owner: p.id, length: 50, mass: 10, amplitude: 10, phase: 'rest' })])),
    };
    $('#play-title').innerHTML = `${icon('pendulum')}たいせん`;
    $('#players').hidden = false;
    app.view.handlers = { onBobTap, onCycle, onFrame, canDrag: () => false };
    setBgm('battle', 0);
    render();
    run(async () => {
        if (!load('pendBattleTour', { seen: false }).seen) {
            await session.wrap(showRulesTour({ first: true, id: 'dlg-rules-pend' }));
            save('pendBattleTour', { seen: true });
        }
        const order = state.order.map(id => PLAYER_META[id].name).join(' → ');
        setStatus(`じゅんばん：${order}`);
        play('finalRound');
        await session.wrap(fx.slam('BATTLE!', { tone: 'gold', sub: `ジャスト・タイム ${state.rounds}ラウンド`, ms: 1700 }));
        await startRound();
    });
}

export function leave() {
    stopTimer();
    session?.end();
    hideBanner();
    fx.setDanger(0);
    setBgm('menu');
    app.view.handlers = {};
    app.view.timeScale = 1;
}

export async function back() {
    if (state.phase === 'over' || await app.confirm('たいせんをやめて、準備画面にもどりますか？')) {
        app.go('pend-setup');
    }
}

function run(fn) {
    fn().catch(err => {
        if (!(err instanceof SessionEnded)) throw err;
    });
}

async function wait(ms) {
    await session.sleep(ms * (SPEED[settings.cpuSpeed] ?? 1) * (ui.fast ? 0.3 : 1));
    while (document.querySelector('dialog[open]:not(#dlg-result)')) await session.sleep(200);
}

function setStatus(text) {
    ui.lastStatus = text;
    $('#play-sub').textContent = text;
    announce(text);
}

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const jitter = (min, max) => min + Math.random() * (max - min);
const pendOf = id => ui.pendulums.get(id);
const ordered = () => state.order.map(pendOf);

/* ---------- ラウンド ---------- */

async function startRound() {
    ui.busy = true;
    ui.intro = true;
    ui.grades = {};
    for (const p of ui.pendulums.values()) {
        p.phase = 'rest';
        p.swing = null;
        p.length = 50;
        p.mass = 10;
        p.amplitude = 10;
    }
    render();
    const level = state.round === state.rounds ? 2 : state.round > 1 ? 1 : 0;
    setBgm('battle', level);
    const final = state.round === state.rounds && state.rounds > 1;
    play(final ? 'finalRound' : 'whoosh');
    if (final) fx.flash('danger');
    setStatus(`ラウンド ${state.round}：ねらいは ${targetLabel(state.target)}`);
    await session.wrap(fx.turnSweep(final ? 'FINAL ROUND' : `ROUND ${state.round}`, `ねらい：${targetLabel(state.target)}`, final ? 'c-final' : 'c-exp'));
    await startTurn();
}

async function startTurn() {
    if (state.phase === 'resolve') {
        await resolve();
        return;
    }
    const p = currentPlayer(state);
    ui.busy = true;
    ui.intro = true;
    ui.pick = { length: 50, mass: 10, amplitude: 10 };
    ui.fast = false;
    render();
    play('turn', p.seat);
    await session.wrap(fx.turnSweep(`${PLAYER_META[p.id].name} TURN`, `${nameOf(p.id)} ─ ${targetLabel(state.target)} に合わせて長さを決めよう`, `c-${p.id}`));
    ui.intro = false;
    pendOf(p.id).phase = 'held';
    if (p.kind === 'cpu') {
        await runCpu();
        return;
    }
    ui.busy = false;
    setStatus(`${nameOf(p.id)}のばん：${targetLabel(state.target)} になる長さは？`);
    render();
    startTimer();
}

/** CPU：目標のあたりへ、つまみを行ったり来たりさせながら決める */
async function runCpu() {
    const p = currentPlayer(state);
    const name = nameOf(p.id);
    setStatus(`${name}がかんがえ中…`);
    render();
    const plan = planPick(state, p.level);
    const path = [clampLength(plan.length + jitter(-25, 25)), clampLength(plan.length + jitter(-8, 8)), plan.length];
    for (const len of path) {
        await wait(jitter(500, 900));
        ui.pick = { ...plan, length: len };
        applyPick();
        render({ light: true });
    }
    await wait(jitter(500, 900));
    decide();
}

function applyPick() {
    const p = currentPlayer(state);
    if (!p) return;
    Object.assign(pendOf(p.id), { length: ui.pick.length, mass: ui.pick.mass, amplitude: ui.pick.amplitude, phase: 'held' });
}

/** えらんだ長さで決める（同じ長さはえらべないので、時間切れなどで重なっていればずらす） */
function decide() {
    if (!canChoose(state, ui.pick.length)) {
        if (isHumanTurn() && ui.timer) {
            ui.pick.length = nearestFree(state, ui.pick.length);
        } else {
            toast(`${takenBy(ui.pick.length)} と同じ長さはえらべないよ（1cm ずらそう）`, 'warn');
            play('error');
            return;
        }
    }
    stopTimer();
    const p = currentPlayer(state);
    applyPick();
    state = choose(state, ui.pick);
    play('drop');
    app.view.fx?.('count', { id: p.id, color: cssVar(`--${p.id}`) });
    setStatus(`${nameOf(p.id)}は ${ui.pick.length}cm にした`);
    ui.busy = true;
    render();
    run(async () => {
        await session.sleep(600);
        await startTurn();
    });
}

/* ---------- いっせいに はなす ---------- */

async function resolve() {
    ui.busy = true;
    ui.intro = true;
    ui.times = {};
    ui.doneCount = 0;
    render();
    play('go');
    setStatus('いっせいに はなす！');
    await session.wrap(fx.turnSweep('はなす！', `ねらい：${targetLabel(state.target)}`, 'c-exp'));
    for (const p of ui.pendulums.values()) {
        p.phase = 'swinging';
        p.swing = createSwing(p);
    }
    play('release');
    app.view.fx?.('release');
    ui.intro = false;
    render();
    await session.wrap(new Promise(resolveDone => {
        ui.onAllDone = resolveDone;
    }));
    await session.sleep(900);
    state = resolveRound(state, ui.times);
    const results = state.history.at(-1).results;
    const best = [...results].sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))[0];
    render();
    setStatus(`ラウンド ${state.history.length} おわり。いちばん近かったのは ${nameOf(best.playerId)}（${best.grade}）`);
    await session.wrap(banner(`ROUND ${state.history.length} おわり`, {
        tone: 'info', sub: `いちばん近かったのは ${nameOf(best.playerId)}：${best.grade} +${best.points}`, duration: 1800,
    }));
    if (state.phase === 'over') {
        await showResult();
        return;
    }
    state = nextRound(state);
    await startRound();
}

function onCycle(p, n) {
    if (state.phase !== 'resolve' || !ui.onAllDone) return;
    if (n < COUNT) return;
    // 10往復：目標との差で評価
    const t = cycleTimeOf(p, COUNT);
    ui.times[p.id] = t;
    const diff = round1(t - state.target.ten);
    const grade = gradeOf(diff);
    ui.grades[p.id] = grade;
    play(grade === 'PERFECT' ? 'just' : 'points');
    app.view.fx?.(grade === 'PERFECT' ? 'first' : 'done', { id: p.id, color: cssVar(`--${p.id}`) });
    const chip = document.querySelector(`#players .pchip.c-${p.id}`)?.getBoundingClientRect();
    if (chip) fx.popup(`${grade} ${diff > 0 ? '+' : ''}${diff.toFixed(1)}秒`, chip.left + chip.width / 2, chip.bottom + 10, grade === 'PERFECT' ? 'ok' : 'combo');
    render();
    ui.doneCount += 1;
    if (ui.doneCount >= state.order.length) {
        const done = ui.onAllDone;
        ui.onAllDone = null;
        done();
    }
}

/** 画面用の評価（engine と同じしきい値） */
function gradeOf(diff) {
    const d = Math.abs(diff);
    return d <= 0.1 ? 'PERFECT' : d <= 0.3 ? 'GREAT' : d <= 0.6 ? 'GOOD' : d <= 1.0 ? 'OK' : 'MISS';
}

function onFrame() {
    if (state.phase === 'resolve' && ui.onAllDone) updatePendReadout($('#pend-readout'), ordered());
}

function onBobTap(id) {
    if (!isHumanTurn()) return;
    if (id === currentPlayer(state).id) toast('下のつまみで長さを決めて「けってい」');
}

/* ---------- 持ち時間 ---------- */

function startTimer() {
    stopTimer();
    if (config.timer === 'none') return;
    const total = Number(config.timer) * 1000;
    const startedAt = performance.now();
    let lastSecond = Math.ceil(total / 1000);
    let lastTick = startedAt;
    let paused = 0;
    ui.timer = { total, left: total };
    ui.timer.id = setInterval(() => {
        if (!session.alive || !ui.timer) return;
        const t = performance.now();
        if (document.querySelector('dialog[open]') || document.hidden) paused += t - lastTick;
        lastTick = t;
        const left = Math.max(0, total - (t - startedAt - paused));
        ui.timer.left = left;
        const sec = Math.ceil(left / 1000);
        if (sec !== lastSecond) {
            lastSecond = sec;
            if (sec <= 5 && sec > 0) play('tickUrgent');
            else if (sec <= 10) play('tick');
        }
        updateTimerView();
        fx.setDanger(left < 10000 ? 0.3 + (1 - left / total) * 0.7 : 0);
        if (left <= 0) {
            stopTimer();
            if (isHumanTurn()) {
                toast('時間切れ！ いまの長さで決定');
                decide();
            }
        }
    }, 100);
}

function stopTimer() {
    if (ui?.timer) clearInterval(ui.timer.id);
    if (ui) ui.timer = null;
    fx.setDanger(0);
}

function updateTimerView() {
    const el = document.querySelector('#dock .timer');
    if (!el || !ui.timer) return;
    const { left, total } = ui.timer;
    el.style.setProperty('--t', String(left / total));
    el.querySelector('span').textContent = String(Math.ceil(left / 1000));
    el.classList.toggle('is-warn', left <= 10000 && left > 5000);
    el.classList.toggle('is-danger', left <= 5000);
}

/* ---------- 操作 ---------- */

function onDockClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (state.phase === 'over' && ['home', 'again', 'result'].includes(act)) {
        play('tap');
        if (act === 'home') app.go('home');
        else if (act === 'again') app.go('pend-battle', { config });
        else if (!$('#dlg-result').open) $('#dlg-result').showModal();
        return;
    }
    if (act === 'fast') {
        play('tap');
        ui.fast = true;
        if (state.phase === 'resolve') app.view.timeScale = 3;
        render();
        return;
    }
    if (!isHumanTurn()) return;
    if (act === 'dec' || act === 'inc') {
        const dir = act === 'inc' ? 1 : -1;
        setLength(ui.pick.length + dir, dir);
    } else if (act === 'decide') {
        play('tap');
        decide();
    }
}

function setLength(len, dir = 0) {
    let next = clampLength(len);
    // ＋／− のボタンでは、もうえらばれている長さはとばす
    if (dir && !canChoose(state, next)) next = clampLength(next + dir);
    if (next === ui.pick.length) return;
    ui.pick.length = next;
    applyPick();
    play('tick');
    render({ light: true });
}

/** その長さをえらんだ人の名前 */
function takenBy(length) {
    const id = Object.keys(state.picks).find(k => state.picks[k].length === length);
    return id ? nameOf(id) : '';
}

/* ---------- 描画 ---------- */

function render({ light = false } = {}) {
    const items = ordered();
    const turnId = state.phase === 'choose' ? currentPlayer(state).id : null;
    const highlight = new Map();
    for (const p of items) {
        if (ui.grades[p.id] === 'PERFECT') highlight.set(p.id, 'first');
        else if (ui.grades[p.id]) highlight.set(p.id, 'done');
    }
    app.view.render({ pendulums: items, interactive: isHumanTurn(), selectedId: turnId, highlight });
    renderPendReadout($('#pend-readout'), items, { grades: ui.grades, hidden: state.phase === 'choose', verdict: false });
    $('#stage-note').innerHTML = state.phase === 'choose' ? `${icon('target')}ねらい：${escapeHtml(targetLabel(state.target))}` : '';
    if (light) {
        const out = document.querySelector('#dock .length-out b');
        if (out) out.textContent = String(ui.pick.length);
        const range = document.querySelector('#dock #len-range');
        if (range && Number(range.value) !== ui.pick.length) range.value = String(ui.pick.length);
        syncTaken();
        return;
    }
    renderPlayers();
    renderDock();
}

/** えらぼうとしている長さが、もうだれかのものなら「けってい」を止めて知らせる */
function syncTaken() {
    const dock = $('#dock');
    const note = dock.querySelector('.length-taken');
    const decide = dock.querySelector('[data-act="decide"]');
    if (!note || !decide) return;
    const taken = !canChoose(state, ui.pick.length);
    note.hidden = !taken;
    if (taken) note.textContent = `${takenBy(ui.pick.length)} と同じ長さ。1cm ずらそう`;
    decide.disabled = taken;
}

function renderPlayers() {
    const turnId = state.phase === 'choose' ? currentPlayer(state).id : null;
    $('#players').innerHTML = state.order.map(id => {
        const p = playerById(state, id);
        const sub = p.kind === 'cpu' ? `CPU・${CPU_LEVELS[p.level]?.label ?? ''}` : (humanCount() === 1 ? 'あなた' : 'ひと');
        const grade = ui.grades[id] ? `<span class="pchip-grade is-${ui.grades[id].toLowerCase()}">${ui.grades[id]}</span>` : '';
        return `
            <div class="pchip c-${id}${id === turnId ? ' is-turn' : ''}" role="group"
                aria-label="${PLAYER_META[id].name} ${sub}、${p.total}ポイント${id === turnId ? '、いまのばん' : ''}">
                <span class="pchip-sym" aria-hidden="true">${icon(id)}</span>
                <span class="pchip-name">${PLAYER_META[id].name}<small>${sub}</small></span>
                ${grade}
                <span class="pchip-pts"><small>ポイント</small>${p.total}</span>
            </div>`;
    }).join('');
}

function renderDock() {
    const dock = $('#dock');
    const focused = dock.contains(document.activeElement) ? document.activeElement.dataset.act ?? 'range' : null;
    fillDock(dock);
    if (focused) {
        const again = dock.querySelector(focused === 'range' ? '#len-range' : `[data-act="${focused}"]`) ?? dock.querySelector('button:not([disabled])');
        (again ?? $('#play-title')).focus?.({ preventScroll: true });
    }
}

/** 長さと時間の手がかり：ヒントの表（設定で）と、これまでのラウンドで実測した結果（全員ぶん） */
function hintTable() {
    const seen = new Map();
    if (config.hints === 'on') for (const L of LENGTHS) seen.set(L, { time: tenOf(L), kind: 'table' });
    for (const h of state.history) for (const r of h.results) seen.set(r.length, { time: r.time, kind: 'measured', who: r.playerId });
    if (!seen.size) return '';
    const chips = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([L, v]) => `
        <span class="${v.kind === 'measured' ? `is-measured c-${v.who}` : ''}" title="${v.kind === 'measured' ? `ラウンドで ${PLAYER_META[v.who].name} が実測` : 'ヒントの表'}">
            <b>${L}</b>cm → ${round1(v.time).toFixed(1)}秒</span>`).join('');
    const label = config.hints === 'on' ? (state.history.length ? '表と、これまでの実測' : '長さと10往復の時間の表') : 'これまでの実測';
    return `<div class="hint-table" aria-label="${label}">${chips}</div>`;
}

function fillDock(dock) {
    dock.onclick = onDockClick;
    if (state.phase === 'over') {
        dock.innerHTML = `
            <div class="dock-actions">
                <button type="button" class="btn" data-act="home">${icon('back')}ホームへ</button>
                <button type="button" class="btn" data-act="again">${icon('reset')}もういちど</button>
                <button type="button" class="btn btn-primary" data-act="result">${icon('trophy')}けっかを見る</button>
            </div>`;
        return;
    }
    if (state.phase === 'resolve' || state.phase === 'between') {
        dock.innerHTML = `
            <div class="turn-info"><div><b>${icon('timer')}10往復をはかっているよ</b><p>ねらい：${escapeHtml(targetLabel(state.target))}</p></div></div>
            <div class="dock-actions"><button type="button" class="btn" data-act="fast" ${ui.fast ? 'disabled' : ''}>${icon('fast')}はやおくり</button></div>`;
        return;
    }
    const p = currentPlayer(state);
    const chip = `<span class="turn-chip c-${p.id}" aria-hidden="true">${icon(p.id)}</span>`;
    if (ui.intro) {
        dock.innerHTML = `<div class="turn-info c-${p.id}">${chip}<div><b>${escapeHtml(nameOf(p.id))}のばん</b><p>まもなくスタート…</p></div></div>`;
        return;
    }
    if (p.kind === 'cpu') {
        dock.innerHTML = `
            <div class="turn-info c-${p.id}">${chip}<div><b>${escapeHtml(nameOf(p.id))}のばん</b><p>${icon('robot')}かんがえ中… <span class="length-out"><b>${ui.pick.length}</b>cm</span></p></div></div>
            <div class="dock-actions"><button type="button" class="btn" data-act="fast" ${ui.fast ? 'disabled' : ''}>${icon('fast')}はやおくり</button></div>`;
        return;
    }
    if (ui.busy) {
        dock.innerHTML = `<div class="turn-info c-${p.id}">${chip}<div><b>${escapeHtml(nameOf(p.id))}</b><p>${ui.pick.length}cm に決めた</p></div></div>`;
        return;
    }
    const timer = ui.timer ? '<div class="timer" role="timer" aria-label="のこり時間"><span></span></div>' : '';
    dock.innerHTML = `
        <div class="turn-info c-${p.id}">${timer}${chip}<div><b>${escapeHtml(nameOf(p.id))}のばん</b><p>${icon('target')}ねらい：${escapeHtml(targetLabel(state.target))}</p>${hintTable()}</div></div>
        <div class="length-ctl" role="group" aria-label="ふりこの長さ">
            <button type="button" class="icon-btn" data-act="dec" aria-label="1cm みじかく">−</button>
            <input type="range" id="len-range" min="${LENGTH_MIN}" max="${LENGTH_MAX}" step="1" value="${ui.pick.length}" aria-label="ふりこの長さ（cm）">
            <button type="button" class="icon-btn" data-act="inc" aria-label="1cm ながく">＋</button>
            <output class="length-out" for="len-range"><b>${ui.pick.length}</b>cm</output>
            <span class="length-taken" role="status" hidden></span>
        </div>
        <div class="decoys">
            <div class="seg seg-sm" id="pick-mass" role="radiogroup" aria-label="おもりの重さ"></div>
            <div class="seg seg-sm" id="pick-amp" role="radiogroup" aria-label="ふれはば"></div>
        </div>
        <div class="dock-actions">
            <button type="button" class="btn btn-primary btn-judge" data-act="decide">${icon('check')}けってい</button>
        </div>`;
    dock.querySelector('#len-range').addEventListener('input', e => setLength(Number(e.target.value)));
    // もうえらばれている長さを、つまみの下に目印で
    const taken = takenLengths(state);
    if (taken.length) {
        const range = dock.querySelector('#len-range');
        range.setAttribute('list', 'len-taken');
        range.insertAdjacentHTML('afterend', `<datalist id="len-taken">${taken.map(L => `<option value="${L}"></option>`).join('')}</datalist>`);
    }
    syncTaken();
    segmented(dock.querySelector('#pick-mass'), {
        options: [['10', '10g'], ['20', '20g'], ['30', '30g']],
        value: String(ui.pick.mass),
        onChange: v => {
            ui.pick.mass = Number(v);
            applyPick();
            render({ light: true });
        },
    });
    segmented(dock.querySelector('#pick-amp'), {
        options: [['10', '10°'], ['20', '20°']],
        value: String(ui.pick.amplitude),
        onChange: v => {
            ui.pick.amplitude = Number(v);
            applyPick();
            render({ light: true });
        },
    });
    updateTimerView();
}

/* ---------- 結果 ---------- */

async function showResult() {
    const { rows, winners } = state.result;
    render();
    await wait(400);
    const humanWon = winners.some(id => playerById(state, id).kind === 'human');
    const noHumans = humanCount() === 0;
    const single = humanCount() === 1;
    let title;
    if (winners.length > 1) title = `${winners.map(id => PLAYER_META[id].name).join('・')} の引き分け！`;
    else if (single && humanWon) title = 'あなたの勝ち！';
    else title = `${PLAYER_META[winners[0]].name} の勝ち！`;
    $('#result-emoji').innerHTML = icon(humanWon || noHumans ? 'trophy' : 'robot');
    $('#result-title').textContent = title;
    $('#result-sub').textContent = `${state.rounds}ラウンドの合計ポイントで勝負！`;
    $('#result-ranking').innerHTML = rows.map(r => `
        <li class="rank-row c-${r.playerId}">
            <span class="rank-no">${r.rank}</span>
            <span class="rank-chip" aria-hidden="true">${icon(r.playerId)}</span>
            <span class="rank-name">${escapeHtml(nameOf(r.playerId))}</span>
            <span class="rank-score">${r.total}<small>${r.grades.join(' / ')}</small></span>
        </li>`).join('');
    $('#btn-result-again').onclick = () => {
        play('tap');
        app.go('pend-battle', { config });
    };
    $('#btn-result-home').onclick = () => {
        play('tap');
        app.go('home');
    };
    setBgm('menu');
    if (humanWon || noHumans) {
        play('win');
        fx.confetti();
        app.view.fx?.('win', { color: cssVar(`--${winners[0]}`) });
        await session.wrap(fx.slam(winners.length > 1 ? 'DRAW!' : 'WINNER!', { tone: 'gold', sub: title, ms: 1800 }));
    } else {
        play('lose');
        await session.wrap(fx.slam('LOSE…', { tone: 'danger', sub: title, ms: 1600 }));
    }
    $('#dlg-result').showModal();
    announce(`${title} ${rows.map(r => `${r.rank}位 ${nameOf(r.playerId)} ${r.total}ポイント`).join('、')}`);
}
