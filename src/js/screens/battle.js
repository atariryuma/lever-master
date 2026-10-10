/**
 * たいせんモード：準備画面とプレイ
 */

import {
    alivePlayers, canMoveTo, createBattle, currentPlayer, forfeit, hang, hangablePositions, legalMoves,
    move, moveDestinations, moveRuleFor, playerById, pointsOf, release, undoHang, undoMove,
} from '../engine/battle.js';
import { CPU_LEVELS, planTurn } from '../engine/ai.js';
import {
    POSITIONS, canHang, distanceOf, findWeight, isAdjacent, isBalanced, momentOf, moveWeight, positionLabel,
} from '../engine/lever.js';
import { PLAYER_META, SEAT_IDS } from '../players.js';
import {
    $, SessionEnded, announce, createSession, escapeHtml, hideBanner, renderReadout, toast,
} from '../ui.js';
import { play, setBgm } from '../audio.js';
import * as fx from '../fx.js';
import { load, save, settings } from '../storage.js';
import { bindTrayDrag, segmented } from '../widgets.js';
import { weightIcon } from '../view/weight-art.js';
import { icon } from '../icons.js';

export const MODE = 'battle';

const SETUP_DEFAULT = {
    seats: [
        { kind: 'human', level: 'normal' },
        { kind: 'cpu', level: 'normal' },
        { kind: 'cpu', level: 'normal' },
        { kind: 'cpu', level: 'normal' },
    ],
    stock: '4',
    hints: 'off',
    timer: '30',
};

const SPEED = { slow: 1.6, normal: 1, fast: 0.45 };

let app;
const setup = load('battleSetup', structuredClone(SETUP_DEFAULT));
setup.timer ??= SETUP_DEFAULT.timer;
let session;
let config;
let state;
let ui;

/* ======================== 準備画面 ======================== */

export function renderSetup(appCtx) {
    app = appCtx;
    const root = $('#seats');
    root.innerHTML = SEAT_IDS.map((id, i) => `
        <div class="seat c-${id}" data-seat="${i}">
            <div class="seat-head">
                <span class="seat-chip" aria-hidden="true">${icon(id)}</span>
                <b>${PLAYER_META[id].name}</b><span class="seat-color">${PLAYER_META[id].color}</span>
            </div>
            <div class="seg seat-kind" role="radiogroup" aria-label="${PLAYER_META[id].name} の参加"></div>
            <div class="seg seg-sm seat-level" role="radiogroup" aria-label="${PLAYER_META[id].name} のCPUのつよさ"></div>
        </div>`).join('');

    SEAT_IDS.forEach((_id, i) => {
        const seatEl = root.querySelector(`[data-seat="${i}"]`);
        const seat = setup.seats[i] ?? { kind: 'none', level: 'normal' };
        setup.seats[i] = seat;
        const levelBox = seatEl.querySelector('.seat-level');
        const syncSeat = () => {
            levelBox.hidden = seat.kind !== 'cpu';
            seatEl.classList.toggle('is-off', seat.kind === 'none');
            validateSetup();
            save('battleSetup', setup);
        };
        segmented(seatEl.querySelector('.seat-kind'), {
            options: [['human', 'ひと', 'user'], ['cpu', 'CPU', 'robot'], ['none', 'なし']],
            value: seat.kind,
            onChange: v => {
                seat.kind = v;
                syncSeat();
            },
        });
        segmented(levelBox, {
            options: Object.entries(CPU_LEVELS).map(([k, v]) => [k, v.label]),
            value: seat.level ?? 'normal',
            onChange: v => {
                seat.level = v;
                save('battleSetup', setup);
            },
        });
        syncSeat();
    });

    segmented($('#opt-stock'), {
        options: [['3', '3こ'], ['4', '4こ'], ['5', '5こ']],
        value: String(setup.stock),
        onChange: v => {
            setup.stock = v;
            save('battleSetup', setup);
        },
    });
    segmented($('#opt-timer'), {
        options: [['none', 'なし'], ['30', '30秒'], ['15', '15秒']],
        value: setup.timer,
        onChange: v => {
            setup.timer = v;
            save('battleSetup', setup);
        },
    });
    segmented($('#opt-hints'), {
        options: [['off', 'なし'], ['on', 'あり（✓で教える）']],
        value: setup.hints,
        onChange: v => {
            setup.hints = v;
            save('battleSetup', setup);
        },
    });
    $('#btn-start').onclick = () => {
        play('tap');
        app.go('battle', { config: structuredClone(setup) });
    };
    validateSetup();
}

function validateSetup() {
    const joined = setup.seats.filter(s => s.kind !== 'none');
    const ok = joined.length >= 2;
    $('#btn-start').disabled = !ok;
    const humans = joined.filter(s => s.kind === 'human').length;
    $('#setup-note').textContent = !ok
        ? '2人以上えらんでね'
        : humans === 0 ? 'CPUどうしの対戦を見るよ' : `${joined.length}人で対戦（ひと ${humans}人）`;
}

/* ======================== プレイ ======================== */

const humanCount = () => state.players.filter(p => p.kind === 'human').length;

function nameOf(id) {
    const p = playerById(state, id);
    const base = PLAYER_META[id].name;
    if (p.kind === 'cpu') return `${base}（CPU）`;
    return humanCount() === 1 ? 'あなた' : base;
}

const isHumanTurn = () => state.phase !== 'over' && currentPlayer(state).kind === 'human' && !ui.busy;
const seatOf = id => playerById(state, id).seat;

export function enter(appCtx, params) {
    app = appCtx;
    config = { ...structuredClone(SETUP_DEFAULT), ...(params.config ?? structuredClone(setup)) };
    session = createSession();
    const seats = config.seats.map(s => (s.kind === 'none' ? null : { kind: s.kind, level: s.level }));
    const joined = seats.map((s, i) => (s ? i : -1)).filter(i => i >= 0);
    const firstSeat = joined[Math.floor(Math.random() * joined.length)];
    state = createBattle({ seats, stock: Number(config.stock), firstSeat });
    ui = {
        selected: null, newIds: new Set(), busy: false, fast: false,
        timer: null, streak: {}, intensity: 0, finalShown: false,
    };

    $('#play-title').innerHTML = `${icon('scale')}たいせん`;
    $('#players').hidden = false;
    app.view.handlers = { onHookTap, onWeightTap, onDrop, canDrag };
    setBgm('battle', 0);
    render();
    run(async () => {
        ui.busy = true;
        render();
        const order = state.order.map(id => PLAYER_META[id].name).join(' → ');
        setStatus(`じゅんばん：${order}`);
        play('finalRound');
        await session.wrap(fx.slam('BATTLE!', { tone: 'gold', sub: `じゅんばん ${order}`, ms: 1700 }));
        ui.busy = false;
        await startTurn();
    });
}

export function leave() {
    stopTimer();
    session?.end();
    hideBanner();
    fx.setDanger(0);
    app.view.setDanger?.(0);
    app.view.fx?.('judgeEnd');
    setBgm('menu');
    app.view.handlers = {};
}

export async function back() {
    if (state.phase === 'over' || await app.confirm('たいせんをやめて、準備画面にもどりますか？')) {
        app.go('setup');
    }
}

/** 画面を離れたときの中断エラーは無視する */
function run(fn) {
    fn().catch(err => {
        if (!(err instanceof SessionEnded)) throw err;
    });
}

const wait = ms => session.sleep(ms * (SPEED[settings.cpuSpeed] ?? 1) * (ui.fast ? 0.3 : 1));

function setStatus(text) {
    $('#play-sub').textContent = text;
    announce(text);
}

/** 試合の進み具合で BGM を盛り上げる。最後の1周は FINAL ROUND */
async function updateIntensity() {
    const alive = alivePlayers(state);
    const total = state.players.length * Number(config.stock);
    const left = alive.reduce((sum, p) => sum + p.stock, 0);
    const final = alive.every(p => p.stock <= 1);
    const level = final ? 2 : left <= total / 2 ? 1 : 0;
    if (level !== ui.intensity) {
        ui.intensity = level;
        setBgm('battle', level);
    }
    if (final && !ui.finalShown && state.phase !== 'over') {
        ui.finalShown = true;
        play('finalRound');
        fx.flash('danger');
        await session.wrap(fx.turnSweep('FINAL ROUND', 'これがラストの1周！', 'c-final'));
    }
}

async function startTurn() {
    if (state.phase === 'over') {
        await showResult();
        return;
    }
    await updateIntensity();
    const p = currentPlayer(state);
    ui.selected = null;
    ui.fast = false;
    ui.pointsBefore = pointsOf(state, p.id);
    render();
    play('turn', seatOf(p.id));
    app.view.fx?.('turn', { color: cssVar(`--${p.id}`) });
    const sub = p.kind === 'cpu' ? 'CPU のばん' : p.stock > 0 ? 'おもりをつるせ！' : 'おもりはもうない。動かすか、けってい';
    await session.wrap(fx.turnSweep(`${PLAYER_META[p.id].name} TURN`, `${nameOf(p.id)} ─ ${sub}`, `c-${p.id}`));
    if (p.kind === 'cpu') {
        await runCpu();
        return;
    }
    setStatus(p.stock > 0
        ? `${nameOf(p.id)}のばん：おもりを1つつるそう`
        : `${nameOf(p.id)}のばん：おもりはもうないよ。動かすか、そのまま「けってい」`);
    startTimer();
    render();
}

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

async function runCpu() {
    ui.busy = true;
    const p = currentPlayer(state);
    const name = nameOf(p.id);
    setStatus(`${name}がかんがえ中…`);
    render();
    await wait(700);
    const plan = planTurn(state, p.level);
    if (plan.hang !== null) {
        state = hang(state, plan.hang);
        hangEffects(plan.hang, p.id);
        setStatus(`${name}が ${positionLabel(plan.hang)} につるした`);
        render();
        await wait(950);
    }
    if (plan.move) {
        const from = findWeight(state.board, plan.move.weightId).pos;
        ui.selected = { id: plan.move.weightId, rehang: false };
        render();
        await wait(600);
        state = move(state, plan.move.weightId, plan.move.to);
        ui.selected = null;
        play('move');
        setStatus(`${name}が ${positionLabel(from)} → ${positionLabel(plan.move.to)} へ動かした`);
        render();
        await wait(800);
    }
    await judge();
}

function hangEffects(pos, owner) {
    ui.newIds.add(state.hung.weightId);
    play('drop');
    app.view.fx?.('hang', { pos, color: cssVar(`--${owner}`) });
    fx.shake('soft');
}

/** 判定：ドラムロール → SAFE! / OUT!! */
async function judge() {
    stopTimer();
    ui.busy = true;
    ui.selected = null;
    const p = currentPlayer(state);
    render();
    app.view.fx?.('judge');
    const roll = p.kind === 'cpu' ? 700 : 1000;
    play('drumroll', roll / 1000);
    await session.sleep(roll * (ui.fast ? 0.4 : 1));
    const result = release(state);
    app.view.fx?.('judgeEnd');
    await (result.balanced ? showSafe(result) : showOut(result));
}

async function showSafe(result) {
    const { left, right } = result.moment;
    const id = result.playerId;
    play('safe');
    app.view.fx?.('safe');
    fx.flash('ok');
    ui.streak[id] = (ui.streak[id] ?? 0) + 1;
    const gained = pointsOf(state, id) - (ui.pointsBefore ?? 0);
    const sub = `左 ${left} ＝ 右 ${right}`;
    const slamDone = fx.slam('SAFE!', { tone: 'ok', sub, ms: 1300 });
    await session.sleep(350);
    const chip = document.querySelector(`#players .pchip.c-${id}`)?.getBoundingClientRect();
    if (chip && gained !== 0) {
        play('points');
        fx.popup(`${gained > 0 ? '+' : ''}${gained}`, chip.left + chip.width / 2, chip.bottom + 10);
    }
    if (ui.streak[id] >= 2 && chip) {
        play('combo');
        fx.popup(`${ui.streak[id]} 連続セーフ！`, chip.left + chip.width / 2, chip.bottom + 46, 'combo');
    }
    await session.wrap(slamDone);
    state = result.state;
    ui.busy = false;
    render();
    await startTurn();
}

async function showOut(result) {
    const id = result.playerId;
    ui.streak[id] = 0;
    const { left, right, diff } = result.moment;
    const side = diff > 0 ? 'left' : diff < 0 ? 'right' : null;
    play('out');
    app.view.fx?.('out', { side: result.timeout ? null : side });
    fx.flash('danger');
    fx.shake();
    const title = result.timeout ? 'TIME UP!' : 'OUT!!';
    const sub = result.timeout ? `${nameOf(id)} 時間切れ` : `${nameOf(id)} ─ 左 ${left} ≠ 右 ${right}`;
    setStatus(`${nameOf(id)}はアウト（${result.timeout ? '時間切れ' : `左 ${left}、右 ${right}`}）`);
    await session.wrap(fx.slam(title, { tone: 'danger', sub, ms: 1700 }));
    // てこをターン前にもどす
    play('rewind');
    state = result.state;
    ui.busy = false;
    render();
    await session.sleep(500);
    await startTurn();
}

async function timeUp() {
    if (!isHumanTurn()) return;
    ui.busy = true;
    render();
    await showOut(forfeit(state));
}

/* ---------- 持ち時間 ---------- */

function startTimer() {
    stopTimer();
    if (config.timer === 'none') return;
    const total = Number(config.timer) * 1000;
    const startedAt = performance.now();
    let lastSecond = Math.ceil(total / 1000);
    let lastBeat = 0;
    ui.timer = { total, left: total };
    ui.timer.id = setInterval(() => {
        if (!session.alive || !ui.timer) return;
        const elapsed = performance.now() - startedAt;
        const left = Math.max(0, total - elapsed);
        ui.timer.left = left;
        const sec = Math.ceil(left / 1000);
        if (sec !== lastSecond) {
            lastSecond = sec;
            if (sec <= 5 && sec > 0) play('tickUrgent');
            else if (sec <= 10) play('tick');
        }
        // 心音：残りが少ないほど速く
        const beatGap = left < 5000 ? 450 : left < 10000 ? 750 : 0;
        if (beatGap && elapsed - lastBeat > beatGap) {
            lastBeat = elapsed;
            play('heartbeat');
        }
        updateTimerView();
        updateDanger();
        if (left <= 0) {
            stopTimer();
            run(timeUp);
        }
    }, 100);
}

function stopTimer() {
    if (ui?.timer) clearInterval(ui.timer.id);
    if (ui) ui.timer = null;
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

/** 危険度：かたむいている・時間がない */
function updateDanger() {
    if (state.phase === 'over') {
        fx.setDanger(0);
        app.view.setDanger?.(0);
        return;
    }
    const tilted = momentOf(state.board).diff !== 0;
    const t = ui.timer ? 1 - ui.timer.left / ui.timer.total : 0;
    const level = Math.max(tilted && !ui.busy ? 0.55 : 0, ui.timer && ui.timer.left < 10000 ? 0.3 + t * 0.7 : 0);
    fx.setDanger(level);
    app.view.setDanger?.(tilted ? Math.max(0.6, level) : level);
}

/* ---------- 人の操作 ---------- */

function selectedIsRehang() {
    return ui.selected?.rehang === true;
}

function canDrag(id) {
    if (!isHumanTurn() || state.phase !== 'move') return false;
    if (state.hung?.weightId === id && !state.moved) return true;
    return moveRuleFor(state, id).ok;
}

function doHang(pos) {
    if (!canHang(state.board, pos)) {
        toast('そこはいっぱいだよ（6こまで）', 'warn');
        play('error');
        return;
    }
    state = hang(state, pos);
    hangEffects(pos, currentPlayer(state).id);
    setStatus(`${positionLabel(pos)} につるした。1つ動かすか、そのまま「けってい」`);
}

function rehang(pos) {
    if (pos === state.hung.pos) return;
    const base = undoHang(state);
    if (!canHang(base.board, pos)) {
        toast('そこはいっぱいだよ', 'warn');
        return;
    }
    state = hang(base, pos);
    hangEffects(pos, currentPlayer(state).id);
    setStatus(`${positionLabel(pos)} につるしなおした`);
}

function explainMoveBlock(id, to) {
    const from = findWeight(state.board, id).pos;
    if (to === from) return null;
    if (isAdjacent(from, to)) return 'となりの場所には動かせないよ';
    if (!canHang(state.board, to)) return 'そこはいっぱいだよ';
    return '動かせないよ';
}

function tryMove(id, to) {
    if (canMoveTo(state, id, to)) {
        const from = findWeight(state.board, id).pos;
        state = move(state, id, to);
        play('move');
        setStatus(`${positionLabel(from)} → ${positionLabel(to)} へ動かした。「けってい」で判定！`);
        ui.selected = null;
        return;
    }
    const reason = explainMoveBlock(id, to);
    if (reason) {
        toast(reason, 'warn');
        play('error');
    } else {
        ui.selected = null;
    }
}

function onHookTap(pos) {
    if (!isHumanTurn()) return;
    if (state.phase === 'hang') {
        doHang(pos);
    } else if (ui.selected) {
        if (selectedIsRehang()) {
            rehang(pos);
            ui.selected = null;
        } else {
            tryMove(ui.selected.id, pos);
        }
    } else {
        toast(state.moved ? '動かせるのは1つだけ。「けってい」で判定しよう' : '動かしたいおもりをタップしてね');
    }
    render();
}

function onWeightTap(id, pos) {
    if (!isHumanTurn()) return;
    if (state.phase === 'hang') {
        doHang(pos);
        render();
        return;
    }
    // 選んでいるおもりがあり、別の場所のおもりをタップ → その場所へ
    if (ui.selected && ui.selected.id !== id && findWeight(state.board, ui.selected.id).pos !== pos) {
        onHookTap(pos);
        return;
    }
    if (ui.selected?.id === id) {
        ui.selected = null;
    } else if (state.hung?.weightId === id && !state.moved) {
        ui.selected = { id, rehang: true };
        play('pick');
        toast('つるしなおす場所をタップしてね');
    } else {
        const rule = moveRuleFor(state, id);
        if (rule.ok) {
            ui.selected = { id, rehang: false };
            play('pick');
        } else {
            toast(rule.reason, 'warn');
            play('error');
        }
    }
    render();
}

function onDrop(source, pos) {
    if (!isHumanTurn() || pos === null) {
        render();
        return;
    }
    if (source.kind === 'new' && state.phase === 'hang') doHang(pos);
    else if (source.kind === 'weight' && state.hung?.weightId === source.id && !state.moved) rehang(pos);
    else if (source.kind === 'weight') tryMove(source.id, pos);
    render();
}

function onDockClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'fast') {
        ui.fast = true;
        play('tap');
        render();
        return;
    }
    if (!isHumanTurn()) return;
    play('tap');
    if (act === 'undo-hang') {
        state = undoHang(state);
        ui.selected = null;
        setStatus('つるしなおそう');
    } else if (act === 'undo-move') {
        state = undoMove(state);
        setStatus('動かしたのをもどした');
    } else if (act === 'judge') {
        run(judge);
        return;
    }
    render();
}

/* ---------- 描画 ---------- */

function hintTargets() {
    const map = new Map();
    if (state.phase === 'hang') {
        for (const pos of POSITIONS) map.set(pos, canHang(state.board, pos) ? 'ok' : 'blocked');
        if (config.hints === 'on') {
            for (const pos of hangablePositions(state)) {
                const s1 = hang(state, pos);
                const safe = isBalanced(s1.board)
                    || legalMoves(s1).some(m => isBalanced(moveWeight(s1.board, m.weightId, m.to)));
                if (safe) map.set(pos, 'hint');
            }
        }
        return map;
    }
    if (!ui.selected) return map;
    if (selectedIsRehang()) {
        const base = undoHang(state);
        for (const pos of POSITIONS) map.set(pos, canHang(base.board, pos) ? 'ok' : 'blocked');
        return map;
    }
    const dests = new Set(moveDestinations(state, ui.selected.id));
    for (const pos of POSITIONS) {
        if (!dests.has(pos)) {
            map.set(pos, 'blocked');
            continue;
        }
        const balanced = config.hints === 'on' && isBalanced(moveWeight(state.board, ui.selected.id, pos));
        map.set(pos, balanced ? 'hint' : 'ok');
    }
    return map;
}

function render() {
    const human = isHumanTurn();
    app.view.render({
        board: state.board,
        held: false, // たいせんでは手でささえない（つるすたびにその場で傾く）
        selectedId: ui.selected?.id ?? null,
        targets: human ? hintTargets() : new Map(),
        newIds: ui.newIds,
        interactive: human,
    });
    ui.newIds = new Set();
    renderReadout($('#readout'), state.board);
    $('#stage-note').textContent = '';
    renderPlayers();
    renderDock();
    updateDanger();
}

function renderPlayers() {
    const turnId = state.phase === 'over' ? null : currentPlayer(state).id;
    $('#players').innerHTML = state.order.map(id => {
        const p = playerById(state, id);
        const stock = Array.from({ length: Number(config.stock) }, (_, i) =>
            `<i class="${i < p.stock ? 'is-left' : ''}"></i>`).join('');
        const sub = p.kind === 'cpu' ? `CPU・${CPU_LEVELS[p.level]?.label ?? ''}` : (humanCount() === 1 ? 'あなた' : 'ひと');
        return `
            <div class="pchip c-${id}${id === turnId ? ' is-turn' : ''}${p.out ? ' is-out' : ''}"
                aria-label="${PLAYER_META[id].name} ${sub}、のこり${p.stock}こ、はたらき${p.out ? 'アウト' : pointsOf(state, id)}${id === turnId ? '、いまのばん' : ''}">
                <span class="pchip-sym" aria-hidden="true">${icon(id)}</span>
                <span class="pchip-name">${PLAYER_META[id].name}<small>${sub}</small></span>
                <span class="pchip-stock" aria-hidden="true">${stock}</span>
                <span class="pchip-pts">${p.out ? 'OUT' : `<small>はたらき</small>${pointsOf(state, id)}`}</span>
            </div>`;
    }).join('');
}

function renderDock() {
    const dock = $('#dock');
    dock.onclick = onDockClick;
    if (state.phase === 'over') {
        dock.innerHTML = '';
        return;
    }
    const p = currentPlayer(state);
    const chip = `<span class="turn-chip c-${p.id}" aria-hidden="true">${icon(p.id)}</span>`;
    if (p.kind === 'cpu') {
        dock.innerHTML = `
            <div class="turn-info c-${p.id}">${chip}<div><b>${escapeHtml(nameOf(p.id))}のばん</b><p>${icon('robot')}かんがえ中…</p></div></div>
            <div class="dock-actions"><button type="button" class="btn" data-act="fast" ${ui.fast ? 'disabled' : ''}>${icon('fast')}はやおくり</button></div>`;
        return;
    }
    if (ui.busy) {
        dock.innerHTML = `<div class="turn-info c-${p.id}">${chip}<div><b>${escapeHtml(nameOf(p.id))}</b><p>判定中…</p></div></div>`;
        return;
    }
    const timer = ui.timer ? '<div class="timer" role="timer" aria-label="のこり時間"><span></span></div>' : '';
    const streak = (ui.streak[p.id] ?? 0) >= 2 ? `<span class="streak">${ui.streak[p.id]} 連続セーフ中</span>` : '';
    if (state.phase === 'hang') {
        dock.innerHTML = `
            <div class="turn-info c-${p.id}">${timer}${chip}<div><b>${escapeHtml(nameOf(p.id))}のばん ${streak}</b><p>つるす場所をタップ（ドラッグもOK）</p></div></div>
            <div class="tray"><button type="button" class="tray-item" data-tray="mine" aria-label="自分のおもり 10g、のこり${p.stock}こ">
                ${weightIcon({ mass: 10, owner: p.id }, 0.9)}<span class="tray-label">10g ×${p.stock}</span></button></div>`;
        bindTrayDrag(dock, () => app.view, () => ({ id: 'ghost', mass: 10, owner: p.id }));
        updateTimerView();
        return;
    }
    const balanced = isBalanced(state.board);
    const msg = !balanced
        ? `${icon('alert')}かたむいている！ このままけっていするとアウト`
        : state.moved ? 'つり合ってる！ けっていしよう'
            : state.hung ? 'おもりを1つ動かせるよ（となりはNG）。そのままでもOK' : 'おもりを1つ動かせるよ。そのままでもOK';
    dock.innerHTML = `
        <div class="turn-info c-${p.id}">${timer}${chip}<div><b>${balanced ? 'うごかす？' : 'ピンチ！'} ${streak}</b><p>${msg}</p></div></div>
        <div class="dock-actions">
            ${state.hung ? `<button type="button" class="btn" data-act="undo-hang">${icon('undo')}つるしなおす</button>` : ''}
            ${state.moved ? `<button type="button" class="btn" data-act="undo-move">${icon('undo')}動かしたのをもどす</button>` : ''}
            <button type="button" class="btn btn-primary btn-judge${balanced ? ' is-ready btn-release' : ' is-risky'}" data-act="judge">${balanced ? `${icon('check')}けってい！` : `${icon('alert')}けってい`}</button>
        </div>`;
    updateTimerView();
}

/* ---------- 結果 ---------- */

function ownFormula(id) {
    const terms = [];
    for (const pos of POSITIONS) {
        for (const w of state.board[pos]) if (w.owner === id) terms.push(`${distanceOf(pos)}×${w.mass}`);
    }
    return terms.join(' + ');
}

async function showResult() {
    const { rows, winners } = state.result;
    render();
    await wait(500);
    const humanWon = winners.some(id => playerById(state, id).kind === 'human');
    const noHumans = humanCount() === 0;
    const single = humanCount() === 1;
    let title;
    if (winners.length > 1) title = `${winners.map(id => PLAYER_META[id].name).join('・')} の引き分け！`;
    else if (single && humanWon) title = 'あなたの勝ち！';
    else title = `${PLAYER_META[winners[0]].name} の勝ち！`;
    const lastOne = alivePlayers(state).length === 1;
    $('#result-emoji').innerHTML = icon(humanWon || noHumans ? 'trophy' : 'robot');
    $('#result-title').textContent = title;
    $('#result-sub').textContent = lastOne
        ? 'さいごまで生き残った！'
        : 'はたらき（きょり × 重さ）の合計で勝負！';
    $('#result-ranking').innerHTML = rows.map(r => `
        <li class="rank-row c-${r.playerId}${r.out ? ' is-out' : ''}">
            <span class="rank-no">${r.rank}</span>
            <span class="rank-chip" aria-hidden="true">${icon(r.playerId)}</span>
            <span class="rank-name">${escapeHtml(nameOf(r.playerId))}</span>
            <span class="rank-score">${r.out
        ? `OUT<small>ターン${r.outAt}</small>`
        : `${r.points}<small>${ownFormula(r.playerId) || 'なし'}</small>`}</span>
        </li>`).join('');
    $('#btn-result-again').onclick = () => {
        play('tap');
        app.go('battle', { config });
    };
    $('#btn-result-home').onclick = () => {
        play('tap');
        app.go('home');
    };
    fx.setDanger(0);
    app.view.setDanger?.(0);
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
    announce(`${title} ${rows.map(r => `${r.rank}位 ${nameOf(r.playerId)} ${r.out ? 'アウト' : r.points}`).join('、')}`);
}
