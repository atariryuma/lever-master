/**
 * もんだいモード：一覧とプレイ
 * 手でささえたままおもりをつるし、「手をはなす」でつり合うかたしかめる
 */

import { CHAPTERS, PUZZLES, allowedPositions, puzzleBoard, starsFor, trayWeights } from '../engine/puzzles.js';
import { POSITIONS, canHang, findWeight, hang, isBalanced, momentOf, moveWeight, removeWeight } from '../engine/lever.js';
import { $, SessionEnded, announce, banner, createSession, escapeHtml, formulaText, renderReadout, toast } from '../ui.js';
import * as fx from '../fx.js';
import { play } from '../audio.js';
import { load, save } from '../storage.js';
import { bindTrayDrag } from '../widgets.js';
import { weightIcon } from '../view/weight-art.js';
import { icon, stars as starIcons } from '../icons.js';

export const MODE = 'puzzle';

let progress = load('progress', { stars: {} });
let app;
let state;
let session;

export function reloadProgress() {
    progress = load('progress', { stars: {} });
}

export function progressSummary() {
    const earned = Object.values(progress.stars).reduce((a, b) => a + b, 0);
    return { total: PUZZLES.length, earned, max: PUZZLES.length * 3 };
}

const starText = n => starIcons(n);

/* ---------- 一覧 ---------- */

export function renderList(appCtx) {
    app = appCtx;
    const { earned, max } = progressSummary();
    $('#puzzle-total').innerHTML = `${icon('star', 'star is-on')} ${earned} / ${max}`;
    const nextId = PUZZLES.find(p => !progress.stars[p.id])?.id;
    const root = $('#puzzle-list');
    root.innerHTML = CHAPTERS.map(ch => `
        <section class="chapter">
            <h3><span class="chapter-no">${ch.id}</span>${escapeHtml(ch.title)}<small>${escapeHtml(ch.lead)}</small></h3>
            <div class="puzzle-grid">
                ${PUZZLES.filter(p => p.chapter === ch.id).map(p => {
        const stars = progress.stars[p.id] ?? 0;
        return `
                    <button type="button" class="puzzle-card${stars ? ' is-cleared' : ''}${p.id === nextId ? ' is-next' : ''}" data-id="${p.id}"
                        aria-label="もんだい${p.id} ${escapeHtml(p.title)}${stars ? ` クリア 星${stars}` : ''}">
                        <span class="pz-no">${p.id}</span>
                        <span class="pz-title">${escapeHtml(p.title)}</span>
                        <span class="pz-stars" aria-hidden="true">${starText(stars)}</span>
                        ${p.hideNumbers ? '<span class="pz-tag">式なし</span>' : ''}
                    </button>`;
    }).join('')}
            </div>
        </section>`).join('');
    root.onclick = e => {
        const card = e.target.closest('.puzzle-card');
        if (!card) return;
        play('tap');
        app.go('puzzle', { id: Number(card.dataset.id) });
    };
}

/* ---------- プレイ ---------- */

export function enter(appCtx, { id }) {
    app = appCtx;
    session = createSession();
    const puzzle = PUZZLES.find(p => p.id === id) ?? PUZZLES[0];
    state = {
        puzzle,
        board: puzzleBoard(puzzle),
        tray: trayWeights(puzzle),
        selected: null,
        held: true,
        tries: 0,
        phase: 'placing',
        revealSide: false,
        showHint: false,
        newIds: new Set(),
    };
    const chapter = CHAPTERS.find(c => c.id === puzzle.chapter);
    $('#play-title').innerHTML = `${icon('puzzle')}もんだい ${puzzle.id}「${escapeHtml(puzzle.title)}」`;
    $('#play-sub').textContent = `第${chapter.id}章 ${chapter.title}`;
    $('#players').hidden = true;
    app.view.handlers = {
        onHookTap, onWeightTap, onDrop,
        canDrag: id => state.phase === 'placing' && !findWeight(state.board, id)?.weight.locked,
    };
    buildDock();
    render();
    announce(`もんだい${puzzle.id}。${puzzle.text}`);
}

export function refresh() {
    if (state.phase !== 'cleared') render();
    else app.view.render({ board: state.board, held: false, targets: new Map(), interactive: false });
}

export function leave() {
    session?.end();
    app.view.handlers = {};
}

export function back() {
    app.go('puzzles');
}

function buildDock() {
    const dock = $('#dock');
    if (state.phase === 'cleared') {
        const stars = starsFor(state.tries);
        const m = momentOf(state.board);
        const last = state.puzzle.id === PUZZLES.length;
        dock.innerHTML = `
            <div class="clear-panel">
                <div class="clear-stars" aria-label="星${stars}">${starText(stars)}</div>
                <div class="clear-text">
                    <b>つり合った！ ${state.tries}回目でせいこう</b>
                    <p>${escapeHtml(state.puzzle.lesson)}</p>
                    <p class="clear-formula">左 ${m.left} ＝ 右 ${m.right}</p>
                </div>
                <div class="dock-actions">
                    <button type="button" class="btn" data-act="list">一覧</button>
                    <button type="button" class="btn" data-act="retry">もういちど</button>
                    <button type="button" class="btn btn-primary" data-act="next">${last ? 'おわり' : `つぎへ${icon('next')}`}</button>
                </div>
            </div>`;
        dock.onclick = onClearClick;
        dock.querySelector('[data-act="next"]').focus();
        return;
    }
    dock.innerHTML = `
        <div class="mission">
            <p class="mission-text">${escapeHtml(state.puzzle.text)}</p>
            <p class="mission-hint" hidden>${icon('bulb')}${escapeHtml(state.puzzle.hint)}</p>
        </div>
        <div class="tray" id="pz-tray" role="group" aria-label="つるすおもり"></div>
        <div class="dock-actions">
            <button type="button" class="btn" data-act="hint">${icon('bulb')}ヒント</button>
            <button type="button" class="btn" data-act="reset">${icon('reset')}やりなおし</button>
            <button type="button" class="btn btn-primary btn-release" data-act="release">${icon('hand')}手をはなす</button>
        </div>`;
    dock.onclick = onDockClick;
    bindTrayDrag(dock, () => app.view, btn => state.tray.find(w => w.id === btn.dataset.tray) ?? null);
}

function onDockClick(e) {
    const tray = e.target.closest('[data-tray]');
    if (tray && state.phase === 'placing') {
        const id = tray.dataset.tray;
        const same = state.selected?.kind === 'tray' && state.selected.id === id;
        state.selected = same ? null : { kind: 'tray', id };
        play('pick');
        render();
        return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || state.phase !== 'placing') return;
    if (act === 'hint') {
        play('tap');
        state.showHint = !state.showHint;
    } else if (act === 'reset') {
        play('tap');
        state.board = puzzleBoard(state.puzzle);
        state.tray = trayWeights(state.puzzle);
        state.selected = null;
        state.revealSide = false;
    } else if (act === 'release') {
        releaseHands().catch(err => {
            if (!(err instanceof SessionEnded)) throw err;
        });
        return;
    }
    render();
}

function onClearClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    play('tap');
    const id = state.puzzle.id;
    if (act === 'list') app.go('puzzles');
    else if (act === 'retry') app.go('puzzle', { id });
    else if (act === 'next') {
        if (id < PUZZLES.length) app.go('puzzle', { id: id + 1 });
        else {
            app.go('puzzles');
            toast('ぜんぶクリア！ きみはてこマスターだ！', 'success');
        }
    }
}

const allowed = pos => allowedPositions(state.puzzle).includes(pos);
const sideName = () => (state.puzzle.side === 'right' ? '右うで' : '左うで');

function placeFromTray(trayId, pos) {
    if (!allowed(pos)) {
        toast(`このもんだいは${sideName()}につるそう`, 'warn');
        play('error');
        return;
    }
    if (!canHang(state.board, pos)) {
        toast('そこはいっぱいだよ', 'warn');
        play('error');
        return;
    }
    const weight = state.tray.find(w => w.id === trayId);
    state.board = hang(state.board, pos, weight);
    state.tray = state.tray.filter(w => w.id !== trayId);
    state.newIds.add(trayId);
    state.selected = null;
    state.revealSide = false;
    play('drop');
    announce(state.tray.length ? `つるしました。のこり${state.tray.length}こ` : 'ぜんぶつるしました。手をはなしてたしかめよう');
}

function returnToTray(id) {
    const { weight } = findWeight(state.board, id);
    state.board = removeWeight(state.board, id);
    state.tray = [...state.tray, weight].sort((a, b) => a.id.localeCompare(b.id));
    state.selected = null;
    play('tap');
}

function onHookTap(pos) {
    if (state.phase !== 'placing') return;
    const sel = state.selected ?? (state.tray.length ? { kind: 'tray', id: state.tray[0].id } : null);
    if (!sel) {
        toast('ぜんぶつるしたよ。「手をはなす」でたしかめよう');
    } else if (sel.kind === 'tray') {
        placeFromTray(sel.id, pos);
    } else {
        const from = findWeight(state.board, sel.id).pos;
        if (from === pos) state.selected = null;
        else if (!allowed(pos)) toast(`このもんだいは${sideName()}につるそう`, 'warn');
        else if (canHang(state.board, pos)) {
            state.board = moveWeight(state.board, sel.id, pos);
            state.selected = null;
            play('move');
        }
    }
    render();
}

function onWeightTap(id, pos) {
    if (state.phase !== 'placing') return;
    const { weight } = findWeight(state.board, id);
    const selectedPos = state.selected?.kind === 'placed' ? findWeight(state.board, state.selected.id).pos : null;
    // 固定のおもり、または別の場所のおもりをタップ → その位置へつるす／動かす
    if (weight.locked || (state.selected && state.selected.id !== id && selectedPos !== pos)) {
        onHookTap(pos);
        return;
    }
    if (state.selected?.kind === 'placed' && state.selected.id === id) {
        returnToTray(id);
        toast('トレイにもどしたよ');
    } else {
        state.selected = { kind: 'placed', id };
        play('pick');
        toast('動かす場所をタップ。もう一度タップでトレイにもどす');
    }
    render();
}

function onDrop(source, pos) {
    if (state.phase !== 'placing') return;
    if (source.kind === 'new') {
        if (pos !== null) placeFromTray(source.trayId, pos);
    } else if (pos === null) {
        returnToTray(source.id);
    } else if (findWeight(state.board, source.id).pos !== pos) {
        if (allowed(pos) && canHang(state.board, pos)) {
            state.board = moveWeight(state.board, source.id, pos);
            play('move');
        } else {
            play('error');
        }
    }
    render();
}

async function releaseHands() {
    if (state.tray.length) {
        toast('トレイのおもりを、ぜんぶつるしてからためそう', 'warn');
        play('error');
        return;
    }
    state.phase = 'checking';
    state.selected = null;
    state.held = false;
    state.tries += 1;
    play('release');
    render();
    await Promise.all([session.wrap(app.view.settle()), session.sleep(700)]);

    if (isBalanced(state.board)) {
        await showClear();
        return;
    }

    play('miss');
    fx.shake('soft');
    const heavier = momentOf(state.board).diff > 0 ? '左' : '右';
    state.revealSide = true;
    render();
    announce(`かたむいた。${heavier}がおもいよ`);
    await session.wrap(banner('かたむいた…', { tone: 'warn', sub: `${heavier}がおもいみたい。もう一度考えよう`, duration: 1600 }));
    state.held = true;
    state.phase = 'placing';
    render();
}

const chapterDone = chapter => PUZZLES.filter(p => p.chapter === chapter).every(p => progress.stars[p.id]);

async function showClear() {
    const stars = starsFor(state.tries);
    const chapter = state.puzzle.chapter;
    const wasChapterDone = chapterDone(chapter);
    const wasAllDone = PUZZLES.every(p => progress.stars[p.id]);
    if (stars > (progress.stars[state.puzzle.id] ?? 0)) {
        progress.stars[state.puzzle.id] = stars;
        save('progress', progress);
    }
    state.phase = 'cleared';
    render();
    buildDock();
    announce(`つり合った！ ${formulaText(state.board)}。星${stars}`);
    play('clear');
    app.view.fx?.('safe');
    fx.flash('ok');
    const m = momentOf(state.board);
    const slamDone = fx.slam('CLEAR!', { tone: 'ok', sub: `左 ${m.left} ＝ 右 ${m.right}`, ms: 1500 });
    // 星を1つずつ光らせる
    const starEls = [...document.querySelectorAll('#dock .clear-stars .star')];
    starEls.forEach(el => el.classList.remove('is-on'));
    for (let i = 0; i < stars; i++) {
        await session.sleep(320);
        starEls[i]?.classList.add('is-on', 'is-pop');
        play('starPop', i);
    }
    if (stars === 3) fx.confetti();
    await session.wrap(slamDone);
    if (!wasAllDone && PUZZLES.every(p => progress.stars[p.id])) {
        play('win');
        fx.confetti();
        await session.wrap(fx.slam('ALL CLEAR!', { tone: 'gold', sub: 'きみはてこマスターだ！', ms: 2200 }));
    } else if (!wasChapterDone && chapterDone(chapter)) {
        play('finalRound');
        const title = CHAPTERS.find(c => c.id === chapter).title;
        await session.wrap(fx.turnSweep('CHAPTER CLEAR!', `第${chapter}章「${title}」クリア`, 'c-p2'));
    }
}

function render() {
    const { board, puzzle } = state;
    const targets = new Map();
    const placing = state.phase === 'placing';
    if (placing && (state.selected || state.tray.length)) {
        for (const pos of POSITIONS) targets.set(pos, allowed(pos) && canHang(board, pos) ? 'ok' : 'blocked');
    }
    const selectedId = state.selected?.kind === 'placed' ? state.selected.id : null;
    app.view.render({ board, held: state.held, selectedId, targets, newIds: state.newIds, interactive: placing });
    state.newIds = new Set();

    const cleared = state.phase === 'cleared';
    renderReadout($('#readout'), board, {
        hidden: puzzle.hideNumbers && !cleared,
        reveal: state.revealSide ? 'side' : 'all',
        verdictHidden: state.held && !state.revealSide,
        area: true,
    });
    $('#stage-note').innerHTML = state.held ? `${icon('hand')}手でささえているよ` : '';

    if (cleared) return;
    const dock = $('#dock');
    const trayBox = dock.querySelector('#pz-tray');
    trayBox.innerHTML = state.tray.length
        ? state.tray.map(w => `
            <button type="button" class="tray-item" data-tray="${w.id}" aria-pressed="${state.selected?.kind === 'tray' && state.selected.id === w.id}"
                aria-label="${w.mass}gのおもり">${weightIcon(w, 0.9)}<span class="tray-label">${w.mass}g</span></button>`).join('')
        : '<p class="tray-empty">ぜんぶつるした！</p>';
    dock.querySelector('.mission-hint').hidden = !state.showHint;
    const release = dock.querySelector('[data-act="release"]');
    release.disabled = !placing;
    release.classList.toggle('is-ready', placing && state.tray.length === 0);
    for (const b of dock.querySelectorAll('[data-act]')) b.disabled = !placing;
}
