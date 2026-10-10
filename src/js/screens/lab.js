/**
 * じっけんモード：おもりを自由につるして、つり合いのしくみを調べる
 */

import { MASSES, POSITIONS, canHang, createBoard, findWeight, hang, moveWeight, positionLabel, removeWeight } from '../engine/lever.js';
import { $, announce, formulaText, renderReadout, toast } from '../ui.js';
import * as fx from '../fx.js';
import { isBalanced, momentOf } from '../engine/lever.js';
import { play } from '../audio.js';
import { bindTrayDrag } from '../widgets.js';
import { weightIcon } from '../view/weight-art.js';
import { icon } from '../icons.js';

export const MODE = 'lab';

let app;
let state;

export function enter(appCtx) {
    app = appCtx;
    state = {
        board: createBoard(),
        selectedMass: 10,
        selectedId: null,
        held: false,
        hidden: false,
        next: 1,
        newIds: new Set(),
    };
    $('#play-title').innerHTML = `${icon('flask')}じっけん`;
    $('#play-sub').textContent = 'おもりをえらんで、つるす場所をタップ（ドラッグでもOK）';
    $('#players').hidden = true;
    app.view.handlers = { onHookTap, onWeightTap, onDrop, canDrag: () => true };
    buildDock();
    render();
}

export function refresh() {
    render();
}

export function leave() {
    app.view.handlers = {};
}

export function back() {
    play('tap');
    app.go('home');
}

function buildDock() {
    const dock = $('#dock');
    dock.innerHTML = `
        <div class="tray" role="group" aria-label="つるすおもりをえらぶ">
            ${MASSES.map(m => `
                <button type="button" class="tray-item" data-tray="m${m}" data-mass="${m}" aria-pressed="false">
                    ${weightIcon({ mass: m }, 0.9)}<span class="tray-label">${m}g</span>
                </button>`).join('')}
        </div>
        <div class="dock-actions">
            <button type="button" class="btn" data-act="remove">${icon('trash')}はずす</button>
            <button type="button" class="btn" data-act="clear">${icon('clear')}ぜんぶはずす</button>
            <button type="button" class="btn btn-toggle" data-act="hold" aria-pressed="false">${icon('hand')}ささえる</button>
            <button type="button" class="btn btn-toggle" data-act="hide" aria-pressed="false">${icon('eyeOff')}式をかくす</button>
        </div>`;
    dock.onclick = onDockClick;
    bindTrayDrag(dock, () => app.view, btn => ({ id: 'ghost', mass: Number(btn.dataset.mass) }));
}

function onDockClick(e) {
    const tray = e.target.closest('[data-tray]');
    if (tray) {
        const mass = Number(tray.dataset.mass);
        state.selectedMass = mass;
        state.selectedId = null;
        play('pick');
        render();
        return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    play('tap');
    if (act === 'remove' && state.selectedId) {
        update(removeWeight(state.board, state.selectedId));
        state.selectedId = null;
    } else if (act === 'clear') {
        state.board = createBoard();
        state.selectedId = null;
        announce('おもりをぜんぶはずしました');
    } else if (act === 'hold') {
        state.held = !state.held;
        if (!state.held) play('release');
    } else if (act === 'hide') {
        state.hidden = !state.hidden;
    }
    render();
}

function update(board, newId) {
    const wasBalanced = isBalanced(state.board);
    state.board = board;
    if (newId) state.newIds.add(newId);
    announce(formulaText(board));
    // 左右どちらにもおもりがあって、つり合ったとき
    const m = momentOf(board);
    if (!wasBalanced && m.diff === 0 && m.left > 0) celebrate(m);
}

function celebrate(m) {
    play('balance');
    app.view.fx?.('safe');
    fx.popup(`つり合った！ 左 ${m.left} ＝ 右 ${m.right}`, window.innerWidth / 2, window.innerHeight * 0.32, 'combo');
}

function hangNew(pos, mass) {
    if (!canHang(state.board, pos)) {
        toast('1か所には6こまでだよ', 'warn');
        play('error');
        return;
    }
    const id = `L${state.next++}`;
    update(hang(state.board, pos, { id, mass }), id);
    play('drop');
}

function onHookTap(pos) {
    if (state.selectedId) {
        const from = findWeight(state.board, state.selectedId)?.pos;
        if (from === pos) {
            state.selectedId = null;
        } else if (canHang(state.board, pos)) {
            update(moveWeight(state.board, state.selectedId, pos));
            play('move');
            state.selectedId = null;
        } else {
            toast('そこはいっぱいだよ', 'warn');
            play('error');
        }
    } else if (state.selectedMass) {
        hangNew(pos, state.selectedMass);
    } else {
        toast('下のトレイからおもりをえらんでね');
    }
    render();
}

function onWeightTap(id, pos) {
    if (state.selectedId && state.selectedId !== id && findWeight(state.board, state.selectedId).pos !== pos) {
        onHookTap(pos);
        return;
    }
    state.selectedId = state.selectedId === id ? null : id;
    if (state.selectedId) {
        state.selectedMass = null;
        play('pick');
        const found = findWeight(state.board, id);
        toast(`${positionLabel(found.pos)}の ${found.weight.mass}g をえらんだよ。動かす場所をタップ`);
    }
    render();
}

function onDrop(source, pos) {
    if (source.kind === 'new') {
        if (pos !== null) hangNew(pos, source.weight.mass);
    } else if (pos === null) {
        update(removeWeight(state.board, source.id));
        state.selectedId = null;
        play('tap');
    } else if (findWeight(state.board, source.id)?.pos !== pos) {
        if (canHang(state.board, pos)) {
            update(moveWeight(state.board, source.id, pos));
            play('move');
        } else {
            play('error');
        }
    }
    render();
}

function render() {
    const { board } = state;
    const targets = new Map();
    if (state.selectedMass || state.selectedId) {
        for (const pos of POSITIONS) targets.set(pos, canHang(board, pos) ? 'ok' : 'blocked');
    }
    app.view.render({ board, held: state.held, selectedId: state.selectedId, targets, newIds: state.newIds });
    state.newIds = new Set();
    renderReadout($('#readout'), board, { hidden: state.hidden, area: true });

    const dock = $('#dock');
    for (const b of dock.querySelectorAll('[data-tray]')) {
        b.setAttribute('aria-pressed', String(Number(b.dataset.mass) === state.selectedMass));
    }
    dock.querySelector('[data-act="remove"]').disabled = !state.selectedId;
    dock.querySelector('[data-act="hold"]').setAttribute('aria-pressed', String(state.held));
    dock.querySelector('[data-act="hide"]').setAttribute('aria-pressed', String(state.hidden));
    $('#stage-note').innerHTML = state.held ? `${icon('hand')}ささえ中…もう一度おすと、てこが動くよ` : '';
}
