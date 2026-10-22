/**
 * ふりこ じっけんモード：条件を1つだけ変えて、10往復の時間をくらべる
 *
 * A は もとのふりこ（50cm・10g・20°）。「変える条件」を1つえらぶと、B はその条件だけがちがう
 * （ほかの条件はそろえる＝条件制御）。おもりを持ち上げて手をはなすと、2つが同時にふれる。
 * 10往復の時間は physics.js の実測。結果は「きろく」の表にたまる。
 */

import {
    CONDITIONS, CONDITION_META, COUNT, createPendulum, cycleTimeOf, formatSeconds, round1, snapAmplitude,
} from '../engine/pendulum.js';
import { createSwing } from '../engine/physics.js';
import { $, announce, escapeHtml, toast } from '../ui.js';
import { compareVerdict, pendSummary, renderPendReadout, updatePendReadout } from '../ui-pend.js';
import * as fx from '../fx.js';
import { play } from '../audio.js';
import { segmented } from '../widgets.js';
import { icon } from '../icons.js';

export const MODE = 'pend-lab';
export const UNIT = 'pendulum';
export const HELP = 'dlg-learn-pend';

const BASE = Object.freeze({ length: 50, mass: 10, amplitude: 20 });
/** 変える条件ごとの、B のはじめの値 */
const B_DEFAULT = Object.freeze({ length: 100, mass: 30, amplitude: 30 });

let app;
let state;

export function enter(appCtx) {
    app = appCtx;
    state = {
        a: createPendulum({ id: 'A', ...BASE, phase: 'held' }),
        b: createPendulum({ id: 'B', ...BASE, length: B_DEFAULT.length, phase: 'held' }),
        variable: 'length',
        records: [],
        done: false,
        fast: false,
        firstId: null, // 先に 10往復した ふりこ
    };
    $('#play-title').innerHTML = `${icon('pendulum')}じっけん`;
    $('#play-sub').textContent = '変える条件は1つだけ。おもりを持ち上げて、手をはなそう';
    $('#players').hidden = true;
    app.view.handlers = {
        onBobDrag, onBobRelease, onBobTap, onCycle, onFrame, onBobLength, onLengthEnd: () => render(),
        canDrag: () => true,
        // B の長さを調べるときは、B を上下にドラッグして長さを変えられる（横なら持ち上げる）
        dragMode: id => (id === 'B' && state.variable === 'length' ? 'auto' : 'swing'),
    };
    buildDock();
    render();
    announce('ふりこのじっけん。変える条件を1つえらんで、おもりを持ち上げて手をはなそう');
}

export function refresh() {
    if (state) render();
}

export function leave() {
    app.view.handlers = {};
    app.view.timeScale = 1;
}

export function back() {
    app.go('home');
}

const both = () => [state.a, state.b];

/* ---------- 操作パネル ---------- */

function buildDock() {
    const dock = $('#dock');
    dock.innerHTML = `
        <div class="pend-controls">
            <div class="option">
                <span class="option-label" id="lbl-var">${icon('swap')}変える条件</span>
                <div class="seg" id="lab-var" role="radiogroup" aria-labelledby="lbl-var"></div>
            </div>
            <div class="option">
                <span class="option-label" id="lbl-val"></span>
                <div class="seg" id="lab-val" role="radiogroup" aria-labelledby="lbl-val"></div>
            </div>
        </div>
        <div class="dock-actions">
            <button type="button" class="btn" data-act="record">${icon('table')}きろく<span class="badge" data-badge hidden></span></button>
            <button type="button" class="btn btn-toggle" data-act="fast" aria-pressed="false">${icon('fast')}はやおくり</button>
            <button type="button" class="btn btn-primary btn-release" data-act="go">${icon('play')}手をはなす</button>
        </div>`;
    segmented($('#lab-var'), {
        options: CONDITIONS.map(c => [c, CONDITION_META[c].short]),
        value: state.variable,
        onChange: v => setVariable(v),
    });
    buildValueSeg();
    dock.onclick = onDockClick;
}

function buildValueSeg() {
    const cond = state.variable;
    $('#lbl-val').innerHTML = `B の ${CONDITION_META[cond].name}`;
    segmented($('#lab-val'), {
        options: CONDITION_META[cond].values.map(v => [String(v), `${v}${CONDITION_META[cond].unit}`]),
        value: String(state.b[cond]),
        onChange: v => setValue(Number(v)),
    });
}

function setVariable(cond) {
    state.variable = cond;
    // A の変える条件は基準にもどし、B は A と同じにして、変える条件だけ変える（ほかの条件をそろえる）
    state.a = { ...state.a, [cond]: BASE[cond] };
    const same = Object.fromEntries(CONDITIONS.map(c => [c, state.a[c]]));
    state.b = createPendulum({ id: 'B', ...same, [cond]: B_DEFAULT[cond], phase: 'held', side: state.a.side });
    hold();
    buildValueSeg();
    announce(`変える条件は ${CONDITION_META[cond].name}。B は ${B_DEFAULT[cond]}${CONDITION_META[cond].unit}`);
    render();
}

function setValue(value) {
    state.b = { ...state.b, [state.variable]: value };
    hold();
    play('pick');
    render();
}

/** 2つとも持ち上げた形にもどす（動きは止まる） */
function hold() {
    for (const p of both()) {
        p.phase = 'held';
        p.swing = null;
    }
    state.done = false;
    state.firstId = null;
}

function onDockClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    play('tap');
    if (act === 'go') {
        if (state.a.phase === 'swinging') hold();
        else release();
    } else if (act === 'fast') {
        state.fast = !state.fast;
        app.view.timeScale = state.fast ? 3 : 1;
    } else if (act === 'record') {
        openRecords();
    }
    render();
}

/* ---------- おもりをさわる ---------- */

function onBobDrag(id, amplitude, side) {
    // ふれはばを調べるとき以外は、2つのふれはばをそろえる（持ち上げる手は1つ）。
    // ふれはばを調べるときは、変えるのは B だけ（A は基準の 20° のまま。A をドラッグしても向きだけ）
    const varying = state.variable === 'amplitude';
    for (const p of both()) {
        p.phase = 'held';
        p.swing = null;
        if (!varying || (p.id === 'B' && id === 'B')) p.amplitude = snapAmplitude(amplitude);
        p.side = side;
    }
    // 変える条件がふれはばなら、B のつまみも合わせる
    if (state.variable === 'amplitude' && id === 'B') buildValueSeg();
    state.done = false;
    state.firstId = null;
    render({ light: true });
}

/** B を上下にドラッグ：長さを 25・50・75・100cm にそろえる */
function onBobLength(id, cm, { step = false } = {}) {
    if (id !== 'B' || state.variable !== 'length') return;
    const values = CONDITION_META.length.values;
    // キー（↑↓）は1cm ずつ来るので、となりの長さへ
    const i = values.indexOf(state.b.length);
    const next = step
        ? values[Math.max(0, Math.min(values.length - 1, i + Math.sign(cm - state.b.length)))]
        : values.reduce((best, v) => (Math.abs(v - cm) < Math.abs(best - cm) ? v : best), values[0]);
    if (next === state.b.length) return;
    state.b = { ...state.b, length: next };
    hold();
    play('tick');
    buildValueSeg();
    render({ light: true });
}

function onBobRelease() {
    release();
    render();
}

function onBobTap(id) {
    const p = both().find(q => q.id === id);
    if (p?.phase === 'swinging') {
        hold();
        play('tap');
        toast('止めたよ。もう一度タップか「手をはなす」でふれるよ');
    } else {
        release();
    }
    render();
}

/** 2つ同時に手をはなす */
function release() {
    for (const p of both()) {
        p.phase = 'swinging';
        p.swing = createSwing(p);
    }
    state.done = false;
    state.firstId = null;
    play('release');
    app.view.fx?.('release');
    announce(`手をはなした。A は ${describe(state.a)}、B は ${describe(state.b)}`);
}

const describe = p => `長さ${p.length}cm・${p.mass}g・ふれはば${p.amplitude}°`;

function onCycle(p, n) {
    if (n < COUNT) {
        play('count');
        app.view.fx?.('count', { id: p.id, color: cssVar(p.id === 'A' ? '--glow-left' : '--glow-right') });
        return;
    }
    if (n === COUNT) {
        play('starPop', p.id === 'A' ? 0 : 2);
        app.view.fx?.('done', { id: p.id });
        if (!state.firstId) state.firstId = p.id;
        render();
        if (both().every(q => cycleTimeOf(q, COUNT) !== null)) finish();
    }
}

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function onFrame() {
    if (state.a.phase === 'swinging' && !state.done) updatePendReadout($('#pend-readout'), both());
}

/** 2つとも 10往復した：結果を記録して、ひとこと */
function finish() {
    state.done = true;
    const ta = round1(cycleTimeOf(state.a, COUNT));
    const tb = round1(cycleTimeOf(state.b, COUNT));
    state.records.push({ variable: state.variable, a: { ...state.a }, b: { ...state.b }, ta, tb });
    const same = Math.abs(ta - tb) < 0.15;
    const text = lessonText(state.variable, same, ta, tb);
    play('balance');
    fx.popup(text, window.innerWidth / 2, window.innerHeight * 0.3, 'combo');
    announce(`${pendSummary(both())}。${text}`);
    render();
}

function lessonText(cond, same, ta, tb) {
    if (cond === 'length') return same ? '長さが同じなら、時間も同じ！' : tb > ta ? '長いほど ゆっくり！' : 'みじかいほど はやい！';
    if (cond === 'mass') return same ? '重さを変えても 同じ時間！' : 'あれ？ 重さは関係ないはず…';
    return same ? 'ふれはばを変えても 同じ時間！' : 'あれ？ ふれはばは関係ないはず…';
}

/* ---------- きろく ---------- */

/** その回にそろえた条件（記録したときの A・B の値。ちがっていたら両方を書く） */
function keptText(r) {
    return CONDITIONS.filter(c => c !== r.variable).map(c => {
        const { short, unit } = CONDITION_META[c];
        return r.a[c] === r.b[c] ? `${short} ${r.a[c]}${unit}` : `${short} A ${r.a[c]}${unit}・B ${r.b[c]}${unit}`;
    }).join('<br>');
}

function openRecords() {
    const dlg = $('#dlg-record');
    const body = dlg.querySelector('.record-body');
    const rows = state.records.map((r, i) => {
        const c = r.variable;
        const same = Math.abs(r.ta - r.tb) < 0.15;
        return `
            <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(CONDITION_META[c].short)}<small class="record-kept">${keptText(r)}</small></td>
                <td><b>A</b> ${r.a[c]}${CONDITION_META[c].unit}<br><b>B</b> ${r.b[c]}${CONDITION_META[c].unit}</td>
                <td class="num">${r.ta.toFixed(1)}<br>${r.tb.toFixed(1)}</td>
                <td class="num">${(r.ta / COUNT).toFixed(2)}<br>${(r.tb / COUNT).toFixed(2)}</td>
                <td class="${same ? 'is-same' : 'is-diff'}">${same ? '同じ' : r.ta < r.tb ? 'A がはやい' : 'B がはやい'}</td>
            </tr>`;
    }).join('');
    body.innerHTML = state.records.length
        ? `<table class="record-table">
            <thead><tr><th>回</th><th>変えた条件</th><th>A / B</th><th>10往復<small>（秒）</small></th><th>1往復<small>（秒）</small></th><th>けっか</th></tr></thead>
            <tbody>${rows}</tbody></table>
            <p class="muted">「変えた条件」の下の小さい字は、その回にそろえた条件。</p>`
        : '<p class="muted">まだ記録がないよ。おもりを持ち上げて、手をはなしてみよう。</p>';
    dlg.showModal();
}

/* ---------- 描画 ---------- */

function render({ light = false } = {}) {
    const highlight = new Map();
    if (state.firstId) highlight.set(state.firstId, 'first');
    if (state.done) for (const p of both()) highlight.set(p.id, p.id === state.firstId ? 'first' : 'done');
    app.view.render({ pendulums: both(), interactive: true, highlight });
    renderPendReadout($('#pend-readout'), both(), { changed: [state.variable], verdict: compareVerdict(state.a, state.b) });
    if (light) return;
    const dock = $('#dock');
    const swinging = state.a.phase === 'swinging';
    const go = dock.querySelector('[data-act="go"]');
    go.innerHTML = swinging ? `${icon('stop')}とめる` : `${icon('play')}手をはなす`;
    go.classList.toggle('is-ready', !swinging);
    dock.querySelector('[data-act="fast"]').setAttribute('aria-pressed', String(state.fast));
    const badge = dock.querySelector('[data-badge]');
    badge.hidden = state.records.length === 0;
    badge.textContent = String(state.records.length);
    $('#stage-note').innerHTML = swinging
        ? (state.done ? `${icon('check')}10往復おわり。A ${formatSeconds(cycleTimeOf(state.a, COUNT))}・B ${formatSeconds(cycleTimeOf(state.b, COUNT))}` : `${icon('timer')}10往復をはかっているよ（タップで止める）`)
        : state.variable === 'length'
            ? `${icon('hand')}横にドラッグで持ち上げ、はなすとふれる。B は上下にドラッグで長さ`
            : `${icon('hand')}おもりを横にドラッグして持ち上げ、はなすとふれるよ`;
}
