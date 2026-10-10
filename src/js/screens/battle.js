/**
 * たいせんモード：準備画面とプレイ
 */

import {
    alivePlayers, canMoveTo, createBattle, currentPlayer, forfeit, hang, hangablePositions, legalMoves,
    move, moveDestinations, moveRuleFor, playerById, pointsOf, release, undoHang, undoMove,
} from '../engine/battle.js';
import { CPU_LEVELS, planTurn } from '../engine/ai.js';
import {
    POSITIONS, canHang, canHangChain, chainOf, distanceOf, findWeight, isAdjacent, isBalanced, momentOf, moveChain,
    positionLabel,
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
import { watchKeep } from '../keep.js';
import { showRulesTour } from '../rules-tour.js';

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
    timer: '90',
    v: 2,
};

/** 持ち時間の選択肢（秒）。はじめは考える時間をたっぷりとる */
const TIMER_OPTIONS = [['none', 'なし'], ['30', '30秒'], ['60', '60秒'], ['90', '90秒'], ['120', '120秒']];

const SPEED = { slow: 1.6, normal: 1, fast: 0.45 };

let app;
// v は既定値に入れない（入れると、保存データに v がなくても既定値の v が見えてしまう）
const { v: SETUP_VERSION, ...SETUP_BASE } = SETUP_DEFAULT;
const setup = load('battleSetup', structuredClone(SETUP_BASE));
// v1（30秒/15秒が標準だったころ）の設定は、新しい標準の 90 秒にそろえる
if (setup.v !== SETUP_VERSION) {
    setup.timer = SETUP_DEFAULT.timer;
    setup.v = SETUP_VERSION;
}
if (!TIMER_OPTIONS.some(([v]) => v === setup.timer)) setup.timer = SETUP_DEFAULT.timer;
// こわれた保存データでも準備画面が開けるように、形をととのえる
if (!['3', '4', '5'].includes(String(setup.stock))) setup.stock = SETUP_DEFAULT.stock;
setup.stock = String(setup.stock);
if (!['on', 'off'].includes(setup.hints)) setup.hints = SETUP_DEFAULT.hints;
setup.seats = SETUP_DEFAULT.seats.map((def, i) => {
    const seat = Array.isArray(setup.seats) ? setup.seats[i] : null;
    const kind = ['human', 'cpu', 'none'].includes(seat?.kind) ? seat.kind : def.kind;
    const level = Object.hasOwn(CPU_LEVELS, seat?.level) ? seat.level : 'normal';
    return { kind, level };
});
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
        options: TIMER_OPTIONS,
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
        timer: null, keep: null, dragging: null, streak: {}, intensity: 0, finalShown: false, cpuCursor: null, intro: false,
    };

    $('#play-title').innerHTML = `${icon('scale')}たいせん`;
    $('#players').hidden = false;
    app.view.handlers = { onHookTap, onWeightTap, onDrop, canDrag, dropLabel, dragGroup, onDragStart, onDragEnd };
    setBgm('battle', 0);
    render();
    run(async () => {
        ui.busy = true;
        ui.intro = true;
        render();
        // はじめての対戦なら、始める前に「あそびかた」を絵で見せる
        if (!load('battleTour', { seen: false }).seen) {
            await session.wrap(showRulesTour({ first: true }));
            save('battleTour', { seen: true });
        }
        const order = state.order.map(id => PLAYER_META[id].name).join(' → ');
        setStatus(`じゅんばん：${order}`);
        play('finalRound');
        await session.wrap(fx.slam('BATTLE!', { tone: 'gold', sub: `じゅんばん ${order}`, ms: 1700 }));
        await startTurn();
    });
}

export function leave() {
    app.view.cancelDrag?.();
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

/** CPU の待ち時間。ダイアログ（やめますか？・ルールなど）を開いているあいだは進めない */
async function wait(ms) {
    await session.sleep(ms * (SPEED[settings.cpuSpeed] ?? 1) * (ui.fast ? 0.3 : 1));
    while (document.querySelector('dialog[open]:not(#dlg-result)')) await session.sleep(200);
}

function setStatus(text) {
    if (ui) ui.lastStatus = text;
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
        announce('ファイナルラウンド。これがラストの1周！');
        await session.wrap(fx.turnSweep('FINAL ROUND', 'これがラストの1周！', 'c-final'));
    }
}

async function startTurn() {
    if (state.phase === 'over') {
        await showResult();
        return;
    }
    // ターンの始まりの演出（FINAL ROUND・TURN の帯）のあいだは操作できない
    const p = currentPlayer(state);
    ui.busy = true;
    ui.intro = true;
    ui.selected = null;
    ui.fast = false;
    ui.pointsBefore = pointsOf(state, p.id);
    render();
    await updateIntensity();
    play('turn', seatOf(p.id));
    app.view.fx?.('turn', { color: cssVar(`--${p.id}`) });
    const sub = p.kind === 'cpu' ? 'CPU のばん' : p.stock > 0 ? 'おもりをつるせ！' : 'おもりはもうない。動かすか、けってい';
    await session.wrap(fx.turnSweep(`${PLAYER_META[p.id].name} TURN`, `${nameOf(p.id)} ─ ${sub}`, `c-${p.id}`));
    ui.intro = false;
    if (p.kind === 'cpu') {
        await runCpu();
        return;
    }
    ui.busy = false;
    setStatus(p.stock > 0
        ? `${nameOf(p.id)}のばん：おもりを1つつるそう`
        : `${nameOf(p.id)}のばん：おもりはもうないよ。動かすか、そのまま「けってい」`);
    startTimer();
    startKeep();
    render();
}

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** min〜max のランダムな待ち時間（ミリ秒） */
const jitter = (min, max) => min + Math.random() * (max - min);

/** CPU の「考える時間」。つよいほど・選べる手が多いほどじっくり考える */
const THINK = { easy: [1100, 2000], normal: [1500, 2600], strong: [2000, 3400] };

/** CPU が候補の場所を見くらべているように、カーソルをいくつか動かしてから決める */
async function cpuLook(finalPos, candidates, totalMs) {
    const others = candidates.filter(pos => pos !== finalPos).sort(() => Math.random() - 0.5);
    const path = [...others.slice(0, 1 + Math.floor(Math.random() * 3)), finalPos];
    for (const pos of path) {
        ui.cpuCursor = pos;
        render();
        await wait(totalMs / path.length);
    }
    ui.cpuCursor = null;
}

async function runCpu() {
    ui.busy = true;
    const p = currentPlayer(state);
    const name = nameOf(p.id);
    setStatus(`${name}がかんがえ中…`);
    render();
    const plan = planTurn(state, p.level);
    const [min, max] = THINK[p.level] ?? THINK.normal;
    const think = jitter(min, max);
    if (plan.hang !== null) {
        await wait(think * 0.35);
        await cpuLook(plan.hang, hangablePositions(state), think * 0.65);
        state = hang(state, plan.hang);
        hangEffects(plan.hang, p.id);
        setStatus(`${name}が ${positionLabel(plan.hang)} につるした`);
        render();
        await wait(jitter(900, 1500));
    } else {
        await wait(think * 0.6);
    }
    if (plan.move) {
        const from = findWeight(state.board, plan.move.weightId).pos;
        const count = chainOf(state.board, plan.move.weightId).length;
        ui.selected = { id: plan.move.weightId, rehang: false };
        setStatus(`${name}が ${positionLabel(from)} のおもり${count > 1 ? `（${count}こ）` : ''}をつかんだ…`);
        render();
        await wait(jitter(600, 1000));
        await cpuLook(plan.move.to, moveDestinations(state, plan.move.weightId), jitter(700, 1300));
        state = move(state, plan.move.weightId, plan.move.to);
        ui.selected = null;
        play('move');
        setStatus(`${name}が ${positionLabel(from)} → ${positionLabel(plan.move.to)} へ${count > 1 ? `${count}こまとめて` : ''}動かした`);
        render();
        await wait(jitter(800, 1200));
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
/** @param {{ auto?: boolean }} [opts] auto … 水平キープで決まったとき（ドラムロールは短く） */
async function judge({ auto = false } = {}) {
    stopTimer();
    app.view.cancelDrag?.(); // 押したままの指が、次の人の手番で効かないように
    ui.busy = true;
    ui.selected = null;
    const p = currentPlayer(state);
    render();
    app.view.fx?.('judge');
    const roll = auto ? 450 : p.kind === 'cpu' ? 700 : 1000;
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
    setStatus(`${nameOf(id)}はセーフ（左 ${left} ＝ 右 ${right}）`);
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
    ui.intro = true; // 次のターンの準備中（前の人の「判定中」を出さない）
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
    const sub = result.timeout ? `${nameOf(id)} 時間切れ（つるしていない）` : `${nameOf(id)} ─ 左 ${left} ≠ 右 ${right}`;
    setStatus(`${nameOf(id)}はアウト（${result.timeout ? '時間切れ' : `左 ${left}、右 ${right}`}）`);
    await session.wrap(fx.slam(title, { tone: 'danger', sub, ms: 1700 }));
    // てこをターン前にもどす
    play('rewind');
    state = result.state;
    ui.intro = true;
    render();
    await session.sleep(500);
    await startTurn();
}

/**
 * 時間切れ。つるしてあれば、その形のまま自動で判定する（けっていを押しわすれてもOK）。
 * まだつるしていなければアウト。
 */
async function timeUp() {
    if (!isHumanTurn()) return;
    ui.busy = true;
    ui.selected = null;
    app.view.cancelDrag?.();
    render();
    if (state.phase !== 'move') {
        await showOut(forfeit(state));
        return;
    }
    play('whoosh');
    fx.flash('danger');
    setStatus('時間切れ！ このままの形で判定');
    await session.wrap(fx.turnSweep('TIME UP!', 'このままの形で判定！', 'c-final'));
    await judge();
}

/* ---------- 持ち時間 ---------- */

function startTimer() {
    stopTimer();
    if (config.timer === 'none') return;
    const total = Number(config.timer) * 1000;
    const startedAt = performance.now();
    let lastSecond = Math.ceil(total / 1000);
    let lastBeat = 0;
    let lastTick = startedAt;
    let paused = 0;
    ui.timer = { total, left: total };
    ui.timer.id = setInterval(() => {
        if (!session.alive || !ui.timer) return;
        const t = performance.now();
        // 「やめますか？」・ルール・せっていを開いているあいだは時間を止める
        if (document.querySelector('dialog[open]') || document.hidden) paused += t - lastTick;
        lastTick = t;
        const elapsed = t - startedAt - paused;
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
    stopKeep();
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

/* ---------- 人の操作 ----------
 * ボタンにたよらず、てこを直接さわって進める
 *   - つるしたおもり … ドラッグ／タップで別の場所へ（つるしなおし）。てこの外へ出すと手にもどる
 *   - 動かしたおもり … もう一度動かせる。元の場所やてこの外へ出すと元にもどる
 *   - 別のおもりを動かす … さっきの「動かす」は元にもどして、こちらを動かす（動かせるのは1つ）
 *   - 水平のまま静まって 2 秒キープすると、自動で「けってい」
 */

/** 動かしなおすときの元の状態（すでに動かしていたら、それをもどした状態） */
const moveBase = () => (state.moved ? undoMove(state) : state);
const isHungWeight = id => state.hung?.weightId === id;
/** さっき動かしたくさり（先頭と、その下）に入っているか */
const inMovedChain = id => Boolean(state.moved) && chainOf(state.board, state.moved.weightId).some(w => w.id === id);

function selectedIsRehang() {
    return ui.selected?.rehang === true;
}

function canDrag(id) {
    if (!isHumanTurn() || state.phase !== 'move') return false;
    return isHungWeight(id) || moveRuleFor(moveBase(), id).ok;
}

/**
 * つかんだとき、実際にいっしょに動くおもり（表示用）。
 * つるしたおもりは1こだけ。ほかは「さっきの動かすをもどした盤面」での道づれ
 */
function dragGroup(id) {
    if (isHungWeight(id)) return [id];
    const base = moveBase();
    return findWeight(base.board, id) ? chainOf(base.board, id).map(w => w.id) : [id];
}

/** てこの外へ出したときの案内（null なら出さない） */
function dropLabel(id) {
    if (isHungWeight(id)) return 'ここに出すと、つるしたおもりを手にもどす';
    if (inMovedChain(id)) return 'ここに出すと、動かす前にもどす';
    return null;
}

function doHang(pos) {
    if (!canHang(state.board, pos)) {
        toast('そこはいっぱいだよ（6こまで）', 'warn');
        play('error');
        return;
    }
    state = hang(state, pos);
    hangEffects(pos, currentPlayer(state).id);
    setStatus(isBalanced(state.board)
        ? `${positionLabel(pos)} につるした。水平のまま 2 秒で決定！`
        : `${positionLabel(pos)} につるした。おもりを1つ動かして水平にしよう`);
}

/** つるしたおもりを別の場所へ。動かしていたおもりは、まだ動かせるならそのまま */
function rehang(pos) {
    if (pos === state.hung.pos) return;
    const moved = state.moved;
    const base = undoHang(state);
    if (!canHang(base.board, pos)) {
        toast('そこはいっぱいだよ', 'warn');
        play('error');
        return;
    }
    let next = hang(base, pos);
    if (moved) {
        if (canMoveTo(next, moved.weightId, moved.to)) next = move(next, moved.weightId, moved.to);
        else toast('動かしたおもりは元にもどったよ', 'warn');
    }
    state = next;
    ui.selected = null; // つるしなおすと id が変わるので、選択はのこさない
    hangEffects(pos, currentPlayer(state).id);
    setStatus(`${positionLabel(pos)} につるしなおした`);
}

/** てこの外へ出した：つるしたおもりは手に、動かしたおもりは元の場所にもどす */
function takeBack(id) {
    if (isHungWeight(id)) {
        const hadMove = Boolean(state.moved);
        state = undoHang(state);
        play('tap');
        setStatus('おもりを手にもどした。つるす場所をえらぼう');
        if (hadMove) toast('動かしたおもりも元にもどったよ');
    } else if (inMovedChain(id)) {
        state = undoMove(state);
        play('move');
        setStatus('動かす前にもどした');
    }
    ui.selected = null;
}

function explainMoveBlock(base, id, to) {
    const from = findWeight(base.board, id).pos;
    if (isAdjacent(from, to)) return 'となりの場所には動かせないよ';
    const count = chainOf(base.board, id).length;
    if (!canHangChain(base.board, to, count)) {
        return count > 1 ? `下のおもりと${count}こいっしょに動くので、そこには入らないよ（6こまで）` : 'そこはいっぱいだよ';
    }
    return '動かせないよ';
}

function tryMove(id, to) {
    const now = findWeight(state.board, id)?.pos;
    if (now === undefined || to === now) {
        ui.selected = null;
        return;
    }
    const again = inMovedChain(id);
    const base = moveBase();
    const from = findWeight(base.board, id).pos;
    ui.selected = null;
    // 動かしたおもりを元の場所へ → 動かす前にもどす
    if (again && to === from) {
        state = base;
        play('move');
        setStatus('動かす前にもどした');
        return;
    }
    if (!canMoveTo(base, id, to)) {
        toast(explainMoveBlock(base, id, to), 'warn');
        play('error');
        return;
    }
    const replaced = Boolean(state.moved) && !again;
    const chain = chainOf(base.board, id);
    // さっき動かしたおもりが元にもどって、今回の道づれに入るとき
    const pulledBack = replaced && chainOf(state.board, state.moved.weightId).some(w => chain.some(c => c.id === w.id));
    state = move(base, id, to);
    play('move');
    const what = chain.length > 1 ? `${chain.length}こまとめて` : '';
    setStatus(`${positionLabel(from)} → ${positionLabel(to)} へ${what}動かした（${isBalanced(state.board) ? 'つり合っている' : 'かたむいている'}）`);
    if (pulledBack) toast('動かせるのは1つ。さっき動かしたおもりは元にもどって、いっしょに動いたよ');
    else if (replaced) toast('動かせるのは1つ。さっき動かしたおもりは元にもどしたよ');
}

function onHookTap(pos) {
    if (!isHumanTurn()) return;
    if (state.phase === 'hang') {
        doHang(pos);
    } else if (ui.selected) {
        if (selectedIsRehang()) rehang(pos);
        else tryMove(ui.selected.id, pos);
    } else {
        toast('おもりをドラッグ（またはタップ）して動かせるよ');
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
    const selectedPos = ui.selected ? findWeight(state.board, ui.selected.id)?.pos : undefined;
    if (ui.selected && selectedPos === undefined) ui.selected = null;
    if (ui.selected && ui.selected.id !== id && selectedPos !== pos) {
        onHookTap(pos);
        return;
    }
    if (ui.selected?.id === id) {
        ui.selected = null;
    } else if (isHungWeight(id)) {
        ui.selected = { id, rehang: true };
        play('pick');
        toast('つるしなおす場所をタップ（てこの外へドラッグで手にもどす）');
    } else {
        const rule = moveRuleFor(moveBase(), id);
        if (rule.ok) {
            ui.selected = { id, rehang: false };
            play('pick');
            const count = chainOf(moveBase().board, id).length;
            toast(count > 1 ? `下の${count - 1}こも、いっしょに動くよ。✕（となり）には動かせない` : '動かす場所をタップ。✕（となり）には動かせないよ');
        } else {
            toast(rule.reason, 'warn');
            play('error');
        }
    }
    render();
}

function onDrop(source, pos) {
    if (!isHumanTurn()) {
        render();
        return;
    }
    if (source.kind === 'new') {
        if (pos !== null && state.phase === 'hang') doHang(pos);
    } else if (pos === null) {
        takeBack(source.id);
    } else if (isHungWeight(source.id)) {
        rehang(pos);
    } else {
        tryMove(source.id, pos);
    }
    render();
}

/** ボタンでも同じことができる（キーボード・読み上げ用）：最後の操作をもどす */
function undoLast() {
    if (state.moved) takeBack(state.moved.weightId);
    else if (state.hung) takeBack(state.hung.weightId);
}

function onDockClick(e) {
    // 自分のおもり（トレイ）を押したら、つるす場所へフォーカス（キーボードでは矢印で選んで Enter）
    if (e.target.closest('[data-tray]') && isHumanTurn() && state.phase === 'hang') {
        const first = POSITIONS.find(pos => canHang(state.board, pos));
        app.view.focusPosition?.(first);
        toast('つるす場所をえらんでね');
        return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (state.phase === 'over' && ['home', 'again', 'result'].includes(act)) {
        play('tap');
        if (act === 'home') app.go('home');
        else if (act === 'again') app.go('battle', { config });
        else if (!$('#dlg-result').open) $('#dlg-result').showModal();
        return;
    }
    if (act === 'fast') {
        ui.fast = true;
        play('tap');
        render();
        return;
    }
    if (!isHumanTurn()) return;
    play('tap');
    if (act === 'undo') {
        undoLast();
    } else if (act === 'judge') {
        run(judge);
        return;
    }
    render();
}

/* ---------- 水平キープで自動けってい ---------- */

const KEEP_MS = 2000;

function startKeep() {
    stopKeep();
    ui.keep = watchKeep({
        ms: KEEP_MS,
        label: '水平キープ',
        // 自分で何かしたあと（つるした・動かした）、つり合ったまま静まっていて、さわっていないとき
        isActive: () => isHumanTurn() && state.phase === 'move' && Boolean(state.hung || state.moved)
            && !ui.selected && !app.view.drag && !app.view.press && isBalanced(state.board) && app.view.isCalm?.() === true,
        onDone: () => run(() => judge({ auto: true })),
    });
}

function stopKeep() {
    ui?.keep?.stop();
    if (ui) ui.keep = null;
}

/* ---------- 描画 ---------- */

function hintTargets() {
    if (state.phase === 'hang') return hangTargets();
    // タップで選んだおもり、またはドラッグ中のおもり
    const sel = ui.selected ?? ui.dragging;
    if (!sel) return new Map();
    return sel.rehang ? rehangTargets() : moveTargets(sel.id);
}

/** ドラッグを始めたら、置ける場所・となり（✕）を見せる */
function onDragStart(source) {
    if (source.kind !== 'weight' || !isHumanTurn() || state.phase !== 'move') return;
    ui.dragging = { id: source.id, rehang: isHungWeight(source.id) };
    render();
}

function onDragEnd() {
    if (!ui.dragging) return;
    ui.dragging = null;
}

const withHints = () => config.hints === 'on';

function hangTargets() {
    const map = new Map();
    for (const pos of POSITIONS) map.set(pos, canHang(state.board, pos) ? 'ok' : 'blocked');
    if (!withHints()) return map;
    for (const pos of hangablePositions(state)) {
        const s1 = hang(state, pos);
        const safe = isBalanced(s1.board)
            || legalMoves(s1).some(m => isBalanced(moveChain(s1.board, m.weightId, m.to)));
        if (safe) map.set(pos, 'hint');
    }
    return map;
}

function rehangTargets() {
    const map = new Map();
    const base = undoHang(state);
    const moved = state.moved;
    for (const pos of POSITIONS) {
        if (!canHang(base.board, pos)) {
            map.set(pos, 'blocked');
            continue;
        }
        // つるしなおした結果（動かしたおもりも、まだ動かせればそのまま）がつり合うなら ✓
        let next = hang(base, pos);
        if (moved && canMoveTo(next, moved.weightId, moved.to)) next = move(next, moved.weightId, moved.to);
        map.set(pos, withHints() && isBalanced(next.board) ? 'hint' : 'ok');
    }
    return map;
}

function moveTargets(id) {
    const map = new Map();
    const base = moveBase();
    const dests = new Set(moveDestinations(base, id));
    // 動かしたおもりは、元の場所へもどせる
    if (inMovedChain(id)) dests.add(findWeight(base.board, id).pos);
    const from = findWeight(base.board, id).pos;
    for (const pos of POSITIONS) {
        if (!dests.has(pos)) {
            // となりは「✕ となり」とはっきり見せる（ルールで置けない）
            map.set(pos, isAdjacent(from, pos) ? 'near' : 'blocked');
            continue;
        }
        const after = canMoveTo(base, id, pos) ? moveChain(base.board, id, pos) : base.board;
        map.set(pos, withHints() && isBalanced(after) ? 'hint' : 'ok');
    }
    return map;
}

/** CPU が見ている場所 */
function cpuTargets() {
    return ui.cpuCursor == null ? new Map() : new Map([[ui.cpuCursor, 'ok']]);
}

function render() {
    const human = isHumanTurn();
    app.view.render({
        board: state.board,
        held: false, // たいせんでは手でささえない（つるすたびにその場で傾く）
        chainMoves: true, // つかんだおもりの下のおもりも道づれで動く
        selectedId: ui.selected?.id ?? null,
        targets: human ? hintTargets() : cpuTargets(),
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
            `<i class="${!p.out && i < p.stock ? 'is-left' : ''}"></i>`).join('');
        const sub = p.kind === 'cpu' ? `CPU・${CPU_LEVELS[p.level]?.label ?? ''}` : (humanCount() === 1 ? 'あなた' : 'ひと');
        return `
            <div class="pchip c-${id}${id === turnId ? ' is-turn' : ''}${p.out ? ' is-out' : ''}" role="group"
                aria-label="${PLAYER_META[id].name} ${sub}、のこり${p.stock}こ、はたらき${p.out ? 'アウト' : pointsOf(state, id)}${id === turnId ? '、いまのばん' : ''}">
                <span class="pchip-sym" aria-hidden="true">${icon(id)}</span>
                <span class="pchip-name">${PLAYER_META[id].name}<small>${sub}</small></span>
                <span class="pchip-stock" aria-hidden="true">${stock}</span>
                <span class="pchip-pts">${p.out ? 'OUT' : `<small>はたらき</small>${pointsOf(state, id)}`}</span>
            </div>`;
    }).join('');
    // 手番の人が横スクロールの外にいたら見えるところへ（スマホでは全員は入りきらない）
    const active = $('#players .pchip.is-turn');
    if (active) {
        const box = $('#players');
        const left = active.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
        if (left < box.scrollLeft || left + active.offsetWidth > box.scrollLeft + box.clientWidth) {
            box.scrollLeft = Math.max(0, left - 12);
        }
    }
}

function renderDock() {
    // 作りなおしてもキーボードのフォーカスを失わないように、押していたボタンを覚えておく
    const dock = $('#dock');
    const focused = dock.contains(document.activeElement) ? document.activeElement.dataset.act ?? 'tray' : null;
    fillDock(dock);
    if (focused) {
        const again = dock.querySelector(focused === 'tray' ? '[data-tray]' : `[data-act="${focused}"]`)
            ?? dock.querySelector('button:not([disabled])');
        (again ?? $('#play-title')).focus?.({ preventScroll: true });
    }
}

function fillDock(dock) {
    dock.onclick = onDockClick;
    if (state.phase === 'over') {
        // 結果のダイアログを閉じてしまっても、ここから続けられるように
        dock.innerHTML = `
            <div class="dock-actions">
                <button type="button" class="btn" data-act="home">${icon('back')}ホームへ</button>
                <button type="button" class="btn" data-act="again">${icon('reset')}もういちど</button>
                <button type="button" class="btn btn-primary" data-act="result">${icon('trophy')}けっかを見る</button>
            </div>`;
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
            <div class="turn-info c-${p.id}">${chip}<div><b>${escapeHtml(nameOf(p.id))}のばん</b><p>${icon('robot')}${escapeHtml(cpuLine(p))}</p></div></div>
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
            <div class="turn-info c-${p.id}">${timer}${chip}<div><b>${escapeHtml(nameOf(p.id))}のばん ${streak}</b>${turnSteps(0)}<p>つるす場所をタップ（ドラッグもOK）</p></div></div>
            <div class="tray"><button type="button" class="tray-item" data-tray="mine" aria-label="自分のおもり 10g、のこり${p.stock}こ">
                ${weightIcon({ mass: 10, owner: p.id }, 0.9)}<span class="tray-label">×${p.stock}</span></button></div>`;
        bindTrayDrag(dock, () => app.view, () => ({ id: 'ghost', mass: 10, owner: p.id }));
        updateTimerView();
        return;
    }
    const balanced = isBalanced(state.board);
    const acted = Boolean(state.hung || state.moved);
    const msg = !balanced
        ? `${icon('alert')}かたむいている！ おもりをドラッグして水平にしよう`
        : acted ? '水平のまま 2 秒キープで決定。まだ動かしてもOK'
            : 'おもりを1つ動かせるよ。このままでよければ「けってい」';
    // 「もどす」と「けってい」はキーボード・読み上げ用にのこす（ふだんは、てこを直接さわれば足りる）
    dock.innerHTML = `
        <div class="turn-info c-${p.id}">${timer}${chip}<div><b>${balanced ? 'つり合ってる！' : 'ピンチ！'} ${streak}</b>${turnSteps(state.moved || (balanced && acted) ? 2 : 1)}<p>${msg}</p></div></div>
        <div class="dock-actions">
            ${acted ? `<button type="button" class="btn" data-act="undo" aria-label="ひとつもどす">${icon('undo')}もどす</button>` : ''}
            <button type="button" class="btn btn-primary btn-judge${balanced ? ' is-ready btn-release' : ' is-risky'}" data-act="judge">${balanced ? `${icon('check')}けってい` : `${icon('alert')}けってい`}</button>
        </div>`;
    updateTimerView();
}

/** CPU の番の下の表示：いま何をしたか（上の小さい文字と同じ内容。スマホでは上は出さない） */
function cpuLine(p) {
    const text = ui.lastStatus ?? '';
    return text.startsWith(nameOf(p.id)) ? text.slice(nameOf(p.id).length).replace(/^が\s*/, '') : 'かんがえ中…';
}

/** いまどのステップか（0: つるす、1: うごかす、2: けってい） */
function turnSteps(now) {
    const names = ['つるす', 'うごかす', 'けってい'];
    return `<ol class="turn-steps" aria-label="いまのステップ：${names[now]}">${names.map((n, i) =>
        `<li class="${i < now ? 'is-done' : i === now ? 'is-now' : ''}">${i + 1} ${n}</li>`).join('')}</ol>`;
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
