/**
 * ふりこ たいせん「ジャスト・タイム」：準備画面とプレイ
 *
 * 目標（10往復で 16.0秒 など）に合わせて、ふりこの長さを決める。全員決まったら いっせいに手をはなし、
 * 10往復の時間（実測）が目標に近いほど高い点。ラウンドの合計点で勝負。
 * 重さ・ふれはばも変えられるが、時間には関係ない（わな）。
 */

import {
    choose, createMatch, currentPlayer, gradeFor, nextRound, playerById, resolveRound, targetLabel,
} from '../engine/pend-battle.js';
import { CPU_LEVELS, planPick } from '../engine/pend-ai.js';
import {
    COUNT, LENGTHS, LENGTH_MAX, LENGTH_MIN, clampLength, createPendulum, cycleTimeOf, elapsedOf, round1, tenOf,
} from '../engine/pendulum.js';
import { createSwing } from '../engine/physics.js';
import { PLAYER_META } from '../players.js';
import { $, SessionEnded, announce, createSession, escapeHtml, hideBanner, toast } from '../ui.js';
import { renderPendReadout, updatePendReadout } from '../ui-pend.js';
import { play, setBgm } from '../audio.js';
import * as fx from '../fx.js';
import { load, save, settings } from '../storage.js';
import { segmented } from '../widgets.js';
import { icon } from '../icons.js';
import { showRulesTour } from '../rules-tour.js';
import { watchKeep } from '../keep.js';
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
    app.view.handlers = {
        onBobTap, onCycle, onFrame,
        // 自分のばんには、自分のおもりを上下にドラッグして長さを変えられる（ものさしと同じ cm）
        canDrag: id => isHumanTurn() && id === currentPlayer(state).id,
        dragMode: () => 'length',
        onBobLength: (_id, cm, { step = false } = {}) => setLength(Math.round(cm), step ? Math.sign(cm - ui.pick.length) : 0),
        onLengthEnd: () => render(),
    };
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
    hideStopwatch();
    hideReveal();
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
    ui.adjusted = false; // このばんで長さを変えたか
    ui.lastAdjust = 0;
    ui.fast = false;
    render();
    play('turn', p.seat);
    await session.wrap(fx.turnSweep(`${PLAYER_META[p.id].name} TURN`, `${nameOf(p.id)} ─ ${targetLabel(state.target)} に合わせて長さを決めよう`, `c-${p.id}`));
    ui.intro = false;
    if (p.kind === 'cpu') {
        await runCpu();
        return;
    }
    ui.busy = false;
    setStatus(`${nameOf(p.id)}のばん：${targetLabel(state.target)} になる長さは？`);
    render();
    startTimer();
    startKeep();
    if (!ui.coached) {
        ui.coached = true;
        toast('おもりを上下にドラッグして長さを決めよう。手をはなすと決まるよ');
    }
}

/** CPU：長さはないしょなので、考える時間だけ見せて決める */
async function runCpu() {
    const p = currentPlayer(state);
    setStatus(`${nameOf(p.id)}がかんがえ中…`);
    render();
    const plan = planPick(state, p.level);
    await wait(jitter(1400, 2600));
    ui.pick = { ...plan };
    decide();
}

function applyPick() {
    const p = currentPlayer(state);
    if (!p) return;
    // えらぶあいだは、まっすぐ下げておく（長さだけが見えるように）
    Object.assign(pendOf(p.id), { length: ui.pick.length, mass: ui.pick.mass, amplitude: ui.pick.amplitude, phase: 'rest' });
}

/** えらんだ長さで決める（ほかの人には、はなすまでないしょ） */
function decide() {
    stopTimer();
    const p = currentPlayer(state);
    applyPick();
    state = choose(state, ui.pick);
    play('drop');
    app.view.fx?.('count', { id: p.id, color: cssVar(`--${p.id}`) });
    setStatus(`${nameOf(p.id)}がきめた！（長さはないしょ）`);
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
    setStatus(`全員きまった！ ねらいは ${targetLabel(state.target)}。3、2、1 で いっせいに はなす`);
    // ないしょにしていた長さを、いっせいにオープン → 全員そろって持ち上げる
    for (const p of ui.pendulums.values()) p.phase = 'held';
    render();
    play('whoosh');
    app.view.fx?.('release');
    await session.wrap(fx.slam('OPEN!', { tone: 'gold', sub: ordered().map(p => `${PLAYER_META[p.id].name} ${p.length}cm`).join('　'), ms: 1600 }));
    // 3・2・1 のカウントダウン（全員の手がおもりにかかっている時間）
    for (const n of [3, 2, 1]) {
        play('tick');
        await session.wrap(fx.slam(String(n), { tone: 'ok', ms: 700 }));
    }
    play('go');
    for (const p of ui.pendulums.values()) {
        p.phase = 'swinging';
        p.swing = createSwing(p);
    }
    play('release');
    app.view.fx?.('release');
    ui.intro = false;
    ui.watch = { shown: true, passed: false };
    render();
    fx.slam('GO!', { tone: 'ok', ms: 700 });
    await session.wrap(new Promise(resolveDone => {
        ui.onAllDone = resolveDone;
    }));
    await session.sleep(900);
    app.view.timeScale = 1;
    state = resolveRound(state, ui.times);
    hideStopwatch();
    render();
    const results = state.history.at(-1).results;
    const best = [...results].sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))[0];
    setStatus(`ラウンド ${state.history.length} おわり。いちばん近かったのは ${nameOf(best.playerId)}（${best.grade} +${best.points}）`);
    await revealRound();
    if (state.phase === 'over') {
        await showResult();
        return;
    }
    state = nextRound(state);
    await startRound();
}

/* ---------- ストップウォッチ（全員同時にはなすので、時計は 1 つ） ---------- */

function updateStopwatch() {
    const el = $('#stopwatch');
    if (!ui.watch?.shown) return;
    const first = ordered()[0];
    const t = elapsedOf(first);
    el.hidden = false;
    el.querySelector('.sw-time').textContent = t.toFixed(1);
    el.style.setProperty('--p', String(Math.min(1, t / (state.target.ten * 1.25))));
    const target = state.target.ten;
    if (!ui.watch.passed && t >= target) {
        // ねらいの時刻：ここで 10往復していれば ぴったり
        ui.watch.passed = true;
        el.classList.add('is-just');
        play('tickUrgent');
        fx.flash('white');
        setTimeout(() => el.classList.remove('is-just'), 900);
    }
    el.classList.toggle('is-near', !ui.watch.passed && target - t < 2);
}

function hideStopwatch() {
    if (ui.watch) ui.watch.shown = false;
    const el = $('#stopwatch');
    el.hidden = true;
    el.classList.remove('is-just', 'is-near');
}

function onCycle(p, n) {
    if (state.phase !== 'resolve' || !ui.onAllDone) return;
    if (n !== COUNT) return; // ちょうど 10往復した瞬間だけ（11往復目からは数えない）
    // 10往復：目標との差で評価
    const t = cycleTimeOf(p, COUNT);
    ui.times[p.id] = t;
    const diff = t - state.target.ten;
    const grade = gradeFor(diff).grade; // 評価はエンジンと同じ（実測の時間から）
    ui.grades[p.id] = grade;
    play(grade === 'PERFECT' ? 'just' : 'points');
    app.view.fx?.(grade === 'PERFECT' ? 'first' : 'done', { id: p.id, color: cssVar(`--${p.id}`) });
    const chip = document.querySelector(`#players .pchip.c-${p.id}`)?.getBoundingClientRect();
    // 評価だけを短く（差の秒は下のパネルとけっかに出る）。チップの下へ
    if (chip) fx.popup(grade, chip.left + chip.width / 2, chip.bottom + 18, grade === 'PERFECT' ? 'ok' : 'combo', { down: true });
    render();
    ui.doneCount += 1;
    if (ui.doneCount >= state.order.length) {
        const done = ui.onAllDone;
        ui.onAllDone = null;
        done();
    }
}

function onFrame() {
    if (state.phase === 'resolve' && ui.onAllDone) {
        updatePendReadout($('#pend-readout'), ordered());
        updateStopwatch();
    }
}

function onBobTap(id) {
    if (!isHumanTurn()) return;
    if (id === currentPlayer(state).id) toast('おもりを上下にドラッグすると、長さが変わるよ');
}

/* ---------- 持ち時間 ---------- */

function startTimer() {
    stopTimer();
    if (config.timer === 'none') return;
    const total = Number(config.timer) * 1000;
    const startedAt = performance.now();
    let lastSecond = Math.ceil(total / 1000);
    let lastTick = startedAt;
    let lastBeat = 0;
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
        // 心音：残りが少ないほど速く
        const elapsed = t - startedAt - paused;
        const beatGap = left < 5000 ? 450 : left < 10000 ? 750 : 0;
        if (beatGap && elapsed - lastBeat > beatGap) {
            lastBeat = elapsed;
            play('heartbeat');
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

/* ---------- 「けってい」ボタンのかわりに：長さを変えて、さわらずに少し待つと決まる ---------- */

const KEEP_MS = 2500;

function startKeep() {
    stopKeep();
    ui.keep = watchKeep({
        ms: KEEP_MS,
        label: 'これできめる',
        // 長さを1回でも変えたあと、おもり・スライダー・＋−をさわっていないとき
        isActive: () => isHumanTurn() && ui.adjusted && !app.view.drag && !app.view.press
            && performance.now() - ui.lastAdjust > 300,
        onDone: () => decide(),
    });
}

function stopKeep() {
    ui?.keep?.stop();
    if (ui) ui.keep = null;
}

function stopTimer() {
    stopKeep();
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
    }
}

function setLength(len) {
    const next = clampLength(len);
    if (next === ui.pick.length) return;
    ui.pick.length = next;
    ui.adjusted = true;
    ui.lastAdjust = performance.now();
    const howto = document.querySelector('#dock .choose-howto');
    if (howto) howto.textContent = '手をはなして少し待つと決まる';
    applyPick();
    play('tick');
    render({ light: true });
}

/* ---------- 描画 ---------- */

/**
 * 画面に出すふりこ。えらぶあいだは、自分（いまのひと）以外の長さはないしょ（「？」で、長さは見せない）
 */
function visiblePendulums() {
    const items = ordered();
    if (state.phase !== 'choose') return items;
    const mine = isHumanTurn() ? currentPlayer(state).id : null;
    return items.map(p => (p.id === mine ? p : { ...p, length: 50, phase: 'rest', secret: true }));
}

function render({ light = false } = {}) {
    const items = visiblePendulums();
    const turnId = state.phase === 'choose' ? currentPlayer(state).id : null;
    const highlight = new Map();
    for (const p of items) {
        if (ui.grades[p.id] === 'PERFECT') highlight.set(p.id, 'first');
        else if (ui.grades[p.id]) highlight.set(p.id, 'done');
    }
    app.view.render({ pendulums: items, interactive: isHumanTurn(), selectedId: turnId, highlight });
    // 計測パネルは、ふりこがふれているあいだだけ（えらぶあいだは「?秒」が並ぶだけなので出さない）
    const readout = $('#pend-readout');
    readout.hidden = state.phase === 'choose';
    if (!readout.hidden) renderPendReadout(readout, items, { grades: ui.grades, verdict: false });
    $('#stage-note').innerHTML = isHumanTurn() ? `${icon('hand')}自分のおもりを上下にドラッグ` : '';
    if (light) {
        const out = document.querySelector('#dock .length-out b');
        if (out) out.textContent = String(ui.pick.length);
        const range = document.querySelector('#dock #len-range');
        if (range && Number(range.value) !== ui.pick.length) range.value = String(ui.pick.length);
        const chart = document.querySelector('#dock .aim-chart');
        if (chart) chart.outerHTML = aimChart();
        return;
    }
    renderPlayers();
    renderDock();
}

function renderPlayers() {
    const turnId = state.phase === 'choose' ? currentPlayer(state).id : null;
    $('#players').innerHTML = state.order.map(id => {
        const p = playerById(state, id);
        const sub = p.kind === 'cpu' ? `CPU・${CPU_LEVELS[p.level]?.label ?? ''}` : (humanCount() === 1 ? 'あなた' : 'ひと');
        // ラウンドごとの評価（いまのラウンドは大きく）
        const past = state.history.map(h => h.results.find(r => r.playerId === id)?.grade).filter(Boolean);
        const dots = past.map((g, i) => `<i class="pchip-dot is-${g.toLowerCase()}" title="ラウンド${i + 1} ${g}"></i>`).join('');
        const decided = state.phase === 'choose' && state.picks[id] ? `<span class="pchip-ok" aria-label="きめた">${icon('check')}</span>` : '';
        const grade = ui.grades[id] ? `<span class="pchip-grade is-${ui.grades[id].toLowerCase()}">${ui.grades[id]}</span>` : decided || (dots ? `<span class="pchip-dots" aria-hidden="true">${dots}</span>` : '');
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

/** 手がかりの点：ヒントの表（設定で）と、これまでのラウンドで全員が実測した結果 */
function knownPoints() {
    const pts = [];
    if (config.hints === 'on') for (const L of LENGTHS) pts.push({ length: L, time: tenOf(L), kind: 'table' });
    state.history.forEach((h, i) => {
        for (const r of h.results) pts.push({ length: r.length, time: r.time, kind: 'measured', who: r.playerId, round: i + 1 });
    });
    return pts;
}

/**
 * 長さ → 10往復の時間 のグラフ（糸口）。
 * 横じく＝長さ、たてじく＝時間。わかっている点（表・実測）と、ねらいの時間の横線、いまえらんでいる長さのたて線。
 * 点をつないでいいかは言わない：ねらいの線と点のならびから「何cm か」を読み取るのが遊び
 */
function aimChart() {
    const pts = knownPoints();
    if (!pts.length) return '<div class="aim-chart aim-chart-empty">手がかりはまだない。ラウンドがすすむと、はかったけっかがここに出る</div>';
    const W = 320;
    const H = 132;
    const L0 = 38; // 左の余白（時間の数字）
    const R0 = 10;
    const T0 = 10;
    const B0 = 24; // 下の余白（長さの数字）
    const x = L => L0 + ((L - LENGTH_MIN) / (LENGTH_MAX - LENGTH_MIN)) * (W - L0 - R0);
    const tMin = 8;
    const tMax = 22;
    const y = t => T0 + (1 - (t - tMin) / (tMax - tMin)) * (H - T0 - B0);
    const target = state.target.ten;
    const cur = ui.pick.length;
    const grid = [10, 15, 20].map(t => `<line class="ac-grid" x1="${L0}" x2="${W - R0}" y1="${y(t)}" y2="${y(t)}"/><text class="ac-ylab" x="${L0 - 4}" y="${y(t) + 4}">${t}秒</text>`).join('');
    const xlab = [10, 25, 50, 75, 100].map(L => `<text class="ac-xlab" x="${x(L)}" y="${H - 8}">${L}${L === 10 ? 'cm' : ''}</text>`).join('');
    const dots = pts.map(pt => (pt.kind === 'table'
        ? `<circle class="ac-dot ac-table" cx="${x(pt.length)}" cy="${y(pt.time)}" r="4.5"/>`
        : `<g class="ac-measured c-${pt.who}"><circle cx="${x(pt.length)}" cy="${y(pt.time)}" r="5"/><text x="${x(pt.length)}" y="${y(pt.time) - 8}">R${pt.round}</text></g>`)).join('');
    return `
        <svg class="aim-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="長さと10往復の時間のグラフ。ねらい ${target.toFixed(1)}秒、いまの長さ ${cur}cm">
            ${grid}
            <line class="ac-axis" x1="${L0}" x2="${W - R0}" y1="${H - B0}" y2="${H - B0}"/>
            ${xlab}
            <line class="ac-target" x1="${L0}" x2="${W - R0}" y1="${y(target)}" y2="${y(target)}"/>
            <text class="ac-target-lab" x="${L0 + 4}" y="${y(target) - 4}">ねらい ${target.toFixed(1)}秒</text>
            <line class="ac-cur" x1="${x(cur)}" x2="${x(cur)}" y1="${T0}" y2="${H - B0}"/>
            <text class="ac-cur-lab" x="${x(cur)}" y="${T0 + 1}">${cur}cm</text>
            ${dots}
        </svg>`;
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
            <div class="turn-info c-${p.id}">${chip}<div><b>${escapeHtml(nameOf(p.id))}のばん</b><p>${icon('robot')}かんがえ中…（長さはないしょ）</p></div></div>
            <div class="dock-actions"><button type="button" class="btn" data-act="fast" ${ui.fast ? 'disabled' : ''}>${icon('fast')}はやおくり</button></div>`;
        return;
    }
    if (ui.busy) {
        dock.innerHTML = `<div class="turn-info c-${p.id}">${chip}<div><b>${escapeHtml(nameOf(p.id))}</b><p>きめた！ はなすまで ないしょ</p></div></div>`;
        return;
    }
    const timer = ui.timer ? '<div class="timer" role="timer" aria-label="のこり時間"><span></span></div>' : '';
    // えらぶ画面は 3 つだけ：お題（左）、手がかりのグラフ（まん中）、長さ（右）。
    // 「けってい」ボタンはない：長さを変えて、さわらずに 2.5 秒で決まる（上にゲージ）
    dock.innerHTML = `
        <div class="choose c-${p.id}">
            <div class="choose-target">
                <div class="choose-who">${timer}<span class="turn-chip" aria-hidden="true">${icon(p.id)}</span><b>${escapeHtml(nameOf(p.id))}のばん</b></div>
                <small>ねらい</small>
                <b class="choose-goal">${escapeHtml(targetLabel(state.target))}</b>
            </div>
            <div class="choose-chart">${aimChart()}</div>
            <div class="choose-ctl">
                <div class="length-ctl" role="group" aria-label="ふりこの長さ">
                    <button type="button" class="icon-btn" data-act="dec" aria-label="1cm みじかく">−</button>
                    <output class="length-out" for="len-range"><b>${ui.pick.length}</b>cm</output>
                    <button type="button" class="icon-btn" data-act="inc" aria-label="1cm ながく">＋</button>
                </div>
                <input type="range" id="len-range" min="${LENGTH_MIN}" max="${LENGTH_MAX}" step="1" value="${ui.pick.length}" aria-label="ふりこの長さ（cm）">
                <small class="choose-howto">${ui.adjusted ? '手をはなして少し待つと決まる' : '長さを変えよう'}</small>
            </div>
        </div>`;
    dock.querySelector('#len-range').addEventListener('input', e => setLength(Number(e.target.value)));
    updateTimerView();
}

/* ---------- ラウンドのけっか（全画面） ----------
 * ドラムロール →「RESULT」→ 下の順位から1人ずつ → 1位は少しためてから → 合計点がカウントアップ。
 * 画面のどこかをタップすると、のこりをすぐに見せる。最後に「つぎのラウンドへ」
 */
async function revealRound() {
    const h = state.history.at(-1);
    const rows = [...h.results].sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
    const last = state.phase === 'over';
    const box = $('#reveal');
    const totals = state.order.map(id => ({
        id, total: playerById(state, id).total, gained: h.results.find(r => r.playerId === id).points,
    }));
    const maxTotal = Math.max(...totals.map(t => t.total), 1);
    box.innerHTML = `
        <div class="reveal-card" role="dialog" aria-modal="true" aria-label="ラウンド${h.round}のけっか">
            <div class="reveal-kicker">ROUND ${h.round}${last ? ' ─ FINAL' : ''}</div>
            <h2 class="reveal-title" data-text="RESULT">RESULT</h2>
            <div class="reveal-target">${icon('target')}ねらい <b>${escapeHtml(targetLabel(h.target))}</b></div>
            <ol class="reveal-list">${rows.map((r, i) => `
                <li class="reveal-row c-${r.playerId}" data-rank="${i + 1}">
                    <span class="rv-rank">${i + 1}</span>
                    <span class="rank-chip" aria-hidden="true">${icon(r.playerId)}</span>
                    <span class="rv-name">${escapeHtml(nameOf(r.playerId))}<small>${r.length}cm → ${round1(r.time).toFixed(1)}秒</small></span>
                    <span class="rv-diff">${r.diff > 0 ? '+' : ''}${round1(r.diff).toFixed(1)}<small>秒</small></span>
                    <span class="pgrade is-${r.grade.toLowerCase()}">${r.grade}</span>
                    <span class="rv-pts">+${r.points}</span>
                </li>`).join('')}
            </ol>
            <div class="reveal-totals" aria-label="合計ポイント">${totals.map(t => `
                <div class="rv-total c-${t.id}">
                    <span class="rank-chip" aria-hidden="true">${icon(t.id)}</span>
                    <span class="rv-bar"><i style="width:${((t.total - t.gained) / maxTotal) * 100}%" data-to="${(t.total / maxTotal) * 100}%"></i></span>
                    <b data-from="${t.total - t.gained}" data-to="${t.total}">${t.total - t.gained}</b>
                </div>`).join('')}
            </div>
            <button type="button" class="btn btn-primary btn-xl reveal-next" hidden>${last ? `${icon('trophy')}さいごのけっかへ` : `つぎのラウンドへ${icon('next')}`}</button>
        </div>`;
    box.hidden = false;
    ui.revealFast = false;
    const skip = () => { ui.revealFast = true; };
    box.addEventListener('pointerdown', skip);
    const pause = ms => (ui.revealFast ? Promise.resolve() : session.sleep(ms));
    try {
        play('drumroll', 1);
        await pause(1100);
        const els = [...box.querySelectorAll('.reveal-row')].reverse(); // 下の順位から
        for (const el of els) {
            const first = el.dataset.rank === '1';
            if (first && els.length > 1) {
                // 1位の前に、少しためる
                play('drumroll', 0.9);
                await pause(1000);
            }
            el.classList.add('is-in');
            if (first) {
                el.classList.add('is-winner');
                const grade = rows[0].grade;
                play(grade === 'PERFECT' ? 'just' : 'safe');
                fx.flash('ok');
                if (grade === 'PERFECT' || playerById(state, rows[0].playerId).kind === 'human') fx.confetti();
                app.view.fx?.('first', { id: rows[0].playerId });
            } else {
                play('points');
            }
            await pause(first ? 900 : 650);
        }
        // 合計点のカウントアップ
        box.querySelector('.reveal-totals').classList.add('is-in');
        for (const bar of box.querySelectorAll('.rv-bar i')) bar.style.width = bar.dataset.to;
        play('combo');
        const nums = [...box.querySelectorAll('.rv-total b')];
        const steps = ui.revealFast ? 1 : 16;
        for (let k = 1; k <= steps; k++) {
            for (const n of nums) {
                const from = Number(n.dataset.from);
                n.textContent = String(Math.round(from + (Number(n.dataset.to) - from) * (k / steps)));
            }
            await pause(40);
        }
        announce(`ラウンド${h.round}のけっか。${rows.map((r, i) => `${i + 1}位 ${nameOf(r.playerId)} ${r.grade} プラス${r.points}`).join('、')}`);
        // つぎへ（押すか、少し待つ）
        const next = box.querySelector('.reveal-next');
        next.hidden = false;
        next.focus({ preventScroll: true });
        await session.wrap(new Promise(resolve => {
            next.addEventListener('click', () => { play('tap'); resolve(); }, { once: true });
            session.sleep(last ? 6000 : 9000).then(resolve, () => {});
        }));
    } finally {
        box.removeEventListener('pointerdown', skip);
        hideReveal();
    }
}

function hideReveal() {
    const box = $('#reveal');
    box.hidden = true;
    box.innerHTML = '';
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
