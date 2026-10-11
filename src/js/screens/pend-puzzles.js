/**
 * ふりこ もんだいモード：一覧とプレイ
 * 図（2D）の上で予想（選択肢をえらぶ）し、「3Dでたしかめる」で手をはなして実験する。
 * 10往復を実測して、予想が合っていればクリア。はずれたら図にもどって考え直す。
 */

import {
    CHAPTERS, PUZZLES, correctOption, optionText, optionsOf, stagePendulums, starsFor, targetText,
} from '../engine/pend-puzzles.js';
import { COUNT, cycleTimeOf, cyclesOf, periodOf, round1 } from '../engine/pendulum.js';
import { createSwing } from '../engine/physics.js';
import { $, SessionEnded, announce, banner, createSession, escapeHtml, toast } from '../ui.js';
import { compareVerdict, pendSummary, renderPendReadout, updatePendReadout } from '../ui-pend.js';
import * as fx from '../fx.js';
import { play } from '../audio.js';
import { load, save } from '../storage.js';
import { icon, stars as starIcons } from '../icons.js';
import { watchKeep } from '../keep.js';

export const MODE = 'pend-puzzle';
export const UNIT = 'pendulum';
export const HELP = 'dlg-learn-pend';
const KEY = 'pendProgress';

const loadProgress = () => {
    const p = load(KEY, { stars: {} });
    const raw = p.stars && typeof p.stars === 'object' ? p.stars : {};
    p.stars = {};
    for (const [id, n] of Object.entries(raw)) {
        const stars = Math.round(Number(n));
        if (stars >= 1 && stars <= 3) p.stars[id] = stars;
    }
    return p;
};

let progress = loadProgress();
let app;
let state;
let session;

export function reloadProgress() {
    progress = loadProgress();
}

export function progressSummary() {
    const earned = Object.values(progress.stars).reduce((a, b) => a + (Number(b) || 0), 0);
    return { total: PUZZLES.length, earned, max: PUZZLES.length * 3 };
}

/* ---------- 一覧 ---------- */

export function renderList(appCtx) {
    app = appCtx;
    const { earned, max } = progressSummary();
    $('#puzzles-title').innerHTML = `${icon('pendulum')}ふりこの もんだい`;
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
                        <span class="pz-stars" aria-hidden="true">${starIcons(stars)}</span>
                    </button>`;
    }).join('')}
            </div>
        </section>`).join('');
    playPendingCelebration();
    root.onclick = e => {
        const card = e.target.closest('.puzzle-card');
        if (!card) return;
        play('tap');
        app.go('pend-puzzle', { id: Number(card.dataset.id) });
    };
}

/* ---------- プレイ ---------- */

export function enter(appCtx, { id }) {
    app = appCtx;
    session = createSession();
    const puzzle = PUZZLES.find(p => p.id === id) ?? PUZZLES[0];
    state = {
        puzzle,
        options: optionsOf(puzzle),
        selected: null,
        pendulums: stagePendulums(puzzle),
        phase: 'placing', // placing（予想中）→ checking（実験中）→ cleared
        tries: 0,
        showHint: false,
        where: '2d',
        keep: null,
        triedKey: null,
        result: null, // 実験の結果の文
        fast: false,
        firstId: null, // 先に 10往復した ふりこ
        onDone: null,
    };
    const chapter = CHAPTERS.find(c => c.id === puzzle.chapter);
    $('#play-title').innerHTML = `${icon('pendulum')}もんだい ${puzzle.id}「${escapeHtml(puzzle.title)}」`;
    $('#play-sub').textContent = `第${chapter.id}章 ${chapter.title}`;
    $('#players').hidden = true;
    app.view.handlers = {
        onBobTap, onCycle, onFrame,
        canDrag: () => false, // もんだいでは、ふれはばは決まっている
    };
    buildDock();
    render();
    startAutoCheck();
    announce(`もんだい${puzzle.id}。${puzzle.text}`);
    playPendingCelebration();
}

export function refresh() {
    if (state) render();
}

export function leave() {
    stopKeep();
    session?.end();
    app.view.handlers = {};
    app.view.timeScale = 1;
}

export function back() {
    app.go('pend-puzzles');
}

function buildDock() {
    const dock = $('#dock');
    if (state.phase === 'cleared') {
        const stars = starsFor(state.tries);
        const last = state.puzzle.id === PUZZLES.length;
        dock.innerHTML = `
            <div class="clear-panel">
                <div class="clear-stars" aria-label="星${stars}">${starIcons(stars)}</div>
                <div class="clear-text">
                    <b>せいかい！ ${state.tries}回目でせいこう</b>
                    <p>${escapeHtml(state.puzzle.lesson)}</p>
                    <p class="clear-formula">${escapeHtml(state.result ?? '')}</p>
                </div>
                <div class="dock-actions">
                    <button type="button" class="btn" data-act="list" aria-label="一覧">${icon('puzzle')}一覧</button>
                    <button type="button" class="btn" data-act="retry" aria-label="もういちど">${icon('reset')}もういちど</button>
                    <button type="button" class="btn btn-primary" data-act="next">${last ? 'おわり' : `つぎへ${icon('next')}`}</button>
                </div>
            </div>`;
        dock.onclick = onClearClick;
        dock.querySelector('[data-act="next"]').focus();
        return;
    }
    const { puzzle } = state;
    const choices = state.options.map(o => `
        <button type="button" class="choice${puzzle.kind === 'control' ? ' choice-plan' : ''}" role="radio" aria-checked="false" data-choice="${escapeHtml(o.id)}">
            ${escapeHtml(optionText(puzzle, o))}</button>`).join('');
    const target = puzzle.kind === 'tune' ? `<span class="pill">ねらい：${escapeHtml(targetText(puzzle))}</span>` : '';
    dock.innerHTML = `
        <div class="mission">
            <p class="mission-text">${escapeHtml(puzzle.text)} ${target}</p>
            <p class="mission-hint" hidden>${icon('bulb')}${escapeHtml(puzzle.hint)}</p>
        </div>
        <div class="choices" role="radiogroup" aria-label="よそう">${choices}</div>
        <div class="dock-actions">
            <button type="button" class="btn" data-act="hint">${icon('bulb')}ヒント</button>
            <button type="button" class="btn btn-toggle" data-act="fast" aria-pressed="false" hidden>${icon('fast')}はやおくり</button>
            <button type="button" class="btn btn-primary btn-release" data-act="release">${app.has3d ? `${icon('cube')}3Dでたしかめる` : `${icon('hand')}手をはなす`}</button>
        </div>`;
    dock.onclick = onDockClick;
}

function onDockClick(e) {
    const choice = e.target.closest('[data-choice]');
    if (choice && state.phase === 'placing') {
        choose(choice.dataset.choice);
        return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'fast' && state.phase === 'checking') {
        play('tap');
        state.fast = !state.fast;
        app.view.timeScale = state.fast ? 3 : 1;
        render();
        return;
    }
    if (state.phase !== 'placing') return;
    if (act === 'hint') {
        play('tap');
        state.showHint = !state.showHint;
    } else if (act === 'release') {
        releaseHands().catch(err => {
            if (!(err instanceof SessionEnded)) throw err;
        });
        return;
    }
    render();
}

function choose(id) {
    state.selected = state.selected === id ? null : id;
    state.pendulums = stagePendulums(state.puzzle, state.selected);
    play('pick');
    const opt = state.options.find(o => o.id === id);
    announce(state.selected ? `${optionText(state.puzzle, opt)} をえらんだ。${releaseLabel()}` : 'えらぶのをやめた');
    render();
}

function onClearClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    play('tap');
    const id = state.puzzle.id;
    if (act === 'list') app.go('pend-puzzles');
    else if (act === 'retry') app.go('pend-puzzle', { id });
    else if (act === 'next') {
        if (id < PUZZLES.length) app.go('pend-puzzle', { id: id + 1 });
        else {
            app.go('pend-puzzles');
            const all = PUZZLES.every(p => progress.stars[p.id]);
            toast(all ? 'ぜんぶクリア！ きみはふりこマスターだ！' : 'まだ ★ がついていないもんだいに、ちょうせんしよう', all ? 'success' : 'info');
        }
    }
}

const releaseLabel = () => 'このまま少し待つと、自動でたしかめるよ';

/** おもりをタップ：予想がすんでいればたしかめる */
function onBobTap() {
    if (state.phase !== 'placing') return;
    if (!state.selected) {
        toast('まず、下から予想をえらぼう');
        return;
    }
    releaseHands().catch(err => {
        if (!(err instanceof SessionEnded)) throw err;
    });
}

/* ---------- 自動でたしかめる ---------- */

function stopKeep() {
    state?.keep?.stop();
    if (state) state.keep = null;
}

const tryKey = () => `${state.selected}`;

/** 予想をえらんで、さわらずに少し待つと自動でたしかめる（同じ予想で一度ためしたあとは、変えるまで待つ） */
function startAutoCheck() {
    stopKeep();
    state.keep = watchKeep({
        ms: 2500,
        label: app.has3d ? '3Dでたしかめるよ' : 'たしかめるよ',
        isActive: () => state.phase === 'placing' && Boolean(state.selected) && tryKey() !== state.triedKey,
        onDone: () => releaseHands().catch(err => {
            if (!(err instanceof SessionEnded)) throw err;
        }),
    });
}

async function releaseHands() {
    if (!state.selected) {
        toast('まず、予想をえらんでからたしかめよう', 'warn');
        play('error');
        return;
    }
    if (state.phase !== 'placing') return;
    stopKeep();
    state.triedKey = tryKey();
    state.phase = 'checking';
    state.tries += 1;
    state.result = null;
    state.firstId = null;
    if (app.has3d) await enter3d();
    for (const p of state.pendulums) {
        p.phase = 'swinging';
        p.swing = createSwing(p);
    }
    play('release');
    app.view.fx?.('release');
    render();
    announce('手をはなした。10往復をはかるよ');
    // 先に 10往復したふりこが出るまで待つ（長さが同じなら、同時に終わる）
    await session.wrap(waitForDone());
    await session.sleep(700);
    const correct = correctOption(state.puzzle);
    const ok = state.selected === correct;
    state.result = resultText(ok);
    if (ok) {
        await showClear();
        return;
    }
    play('miss');
    fx.shake('soft');
    render();
    announce(`ちがった。${state.result}`);
    await session.wrap(banner('ちがった…', { tone: 'warn', sub: state.result, duration: 1800 }));
    state.pendulums = stagePendulums(state.puzzle, state.selected);
    state.selected = null;
    state.fast = false;
    app.view.timeScale = 1;
    if (app.has3d) {
        app.setView('2d');
        state.where = '2d';
        render();
        play('whoosh');
        await session.wrap(fx.turnSweep('図で考えよう', 'どうしてかな？ もう一度 予想しよう', 'c-think'));
    }
    state.phase = 'placing';
    buildDock();
    render();
    startAutoCheck();
    document.querySelector('#dock [data-choice]')?.focus({ preventScroll: true });
}

/** 図で予想した形のまま 3D へ。「じっけん！」の帯のあいだは持ち上げたままにして、そのあと手をはなす */
async function enter3d() {
    app.setView('3d');
    state.where = '3d';
    render();
    play('whoosh');
    await session.wrap(fx.turnSweep('じっけん！', '3Dのふりこで たしかめよう', 'c-exp'));
}

function waitForDone() {
    return new Promise(resolve => {
        state.onDone = resolve;
    });
}

function isDone() {
    const ps = state.pendulums;
    if (state.puzzle.kind === 'tune') return cycleTimeOf(ps[0], COUNT) !== null;
    // 2つのとき：はやいほうが終われば結果はわかる。長さが同じなら両方そろって終わる
    const fastest = Math.min(...ps.map(p => periodOf(p.length)));
    return ps.filter(p => Math.abs(periodOf(p.length) - fastest) < 1e-9).every(p => cycleTimeOf(p, COUNT) !== null);
}

function onCycle(p, n) {
    if (state.phase !== 'checking') return;
    if (n < COUNT) {
        play('count');
        app.view.fx?.('count', { id: p.id });
        return;
    }
    if (n > COUNT) return; // 10往復のあとは数えない
    play('starPop', p.id === 'A' ? 0 : 2);
    app.view.fx?.(state.firstId ? 'done' : 'first', { id: p.id });
    state.firstId ??= p.id;
    render();
    if (isDone() && state.onDone) {
        const done = state.onDone;
        state.onDone = null;
        done();
    }
}

function onFrame() {
    if (state.phase === 'checking') updatePendReadout($('#pend-readout'), state.pendulums);
}

/** 実験の結果の文（正解でも不正解でも、何が起きたかを言う） */
function resultText(ok) {
    const { puzzle, pendulums: ps } = state;
    const fmt = p => `${cycleTimeOf(p, COUNT) !== null ? `10往復 ${round1(cycleTimeOf(p, COUNT)).toFixed(1)}秒` : `まだ ${cyclesOf(p)}往復`}`;
    if (puzzle.kind === 'compare') {
        const [a, b] = ps;
        const v = compareVerdict(a, b);
        return `A は ${fmt(a)}、B は ${fmt(b)}。${v?.text ?? ''}`;
    }
    if (puzzle.kind === 'tune') {
        const t = round1(cycleTimeOf(ps[0], COUNT) / COUNT).toFixed(2);
        return ok ? `${ps[0].length}cm → 1往復 ${t}秒。ぴったり！` : `${ps[0].length}cm → 1往復 ${t}秒。ねらいは ${targetText(puzzle)}`;
    }
    if (puzzle.kind === 'choice') {
        const [a, b] = ps;
        const ta = round1(cycleTimeOf(a, COUNT) / COUNT).toFixed(2);
        const tb = cycleTimeOf(b, COUNT) !== null ? round1(cycleTimeOf(b, COUNT) / COUNT).toFixed(2) : `まだ ${cyclesOf(b)}往復`;
        const faster = periodOf(b.length) < periodOf(a.length);
        return `${a.length}cm（1往復 ${ta}秒）→ ${b.length}cm（${tb}${cycleTimeOf(b, COUNT) !== null ? '秒' : ''}）。${faster ? 'はやくなった' : 'おそくなった'}`;
    }
    // control
    const [a, b] = ps;
    const v = compareVerdict(a, b);
    const diffs = ['length', 'mass', 'amplitude'].filter(c => a[c] !== b[c]);
    const names = { length: '長さ', mass: '重さ', amplitude: 'ふれはば' };
    if (ok) return `${names[puzzle.goal]}だけを変えた → ${v?.text ?? ''}。だから「${names[puzzle.goal]}」のことがわかる`;
    if (diffs.length === 0) return '何も変えていないので、くらべられない';
    if (diffs.length > 1) return `${diffs.map(c => names[c]).join('と')}の2つを変えたので、どちらのせいかわからない`;
    return `${names[diffs[0]]}を変えている。調べたいのは ${names[puzzle.goal]}`;
}

const chapterDone = chapter => PUZZLES.filter(p => p.chapter === chapter).every(p => progress.stars[p.id]);

async function showClear() {
    const stars = starsFor(state.tries);
    const chapter = state.puzzle.chapter;
    const wasChapterDone = chapterDone(chapter);
    const wasAllDone = PUZZLES.every(p => progress.stars[p.id]);
    if (stars > (progress.stars[state.puzzle.id] ?? 0)) {
        progress.stars[state.puzzle.id] = stars;
        save(KEY, progress);
    }
    if (!wasAllDone && PUZZLES.every(p => progress.stars[p.id])) pendingCelebration = { kind: 'all' };
    else if (!wasChapterDone && chapterDone(chapter)) pendingCelebration = { kind: 'chapter', chapter };
    state.phase = 'cleared';
    app.view.timeScale = 1;
    render();
    buildDock();
    announce(`せいかい！ ${pendSummary(state.pendulums)}。星${stars}`);
    play('clear');
    fx.flash('ok');
    const slamDone = fx.slam('CLEAR!', { tone: 'ok', sub: state.result, ms: 1600 });
    const starEls = [...document.querySelectorAll('#dock .clear-stars .star')];
    starEls.forEach(el => el.classList.remove('is-on'));
    for (let i = 0; i < stars; i++) {
        await session.sleep(320);
        starEls[i]?.classList.add('is-on', 'is-pop');
        play('starPop', i);
    }
    if (stars === 3) fx.confetti();
    await session.wrap(slamDone);
    await playPendingCelebration();
}

let pendingCelebration = null;
async function playPendingCelebration() {
    const c = pendingCelebration;
    if (!c) return;
    pendingCelebration = null;
    if (c.kind === 'all') {
        play('win');
        fx.confetti();
        await fx.slam('ALL CLEAR!', { tone: 'gold', sub: 'きみはふりこマスターだ！', ms: 2200 });
    } else {
        play('finalRound');
        const title = CHAPTERS.find(ch => ch.id === c.chapter).title;
        await fx.turnSweep('CHAPTER CLEAR!', `第${c.chapter}章「${title}」クリア`, 'c-p2');
    }
}

function stageNote() {
    if (state.phase === 'placing') return `${icon('chart')}図で予想しよう。下から答えをえらんでね`;
    if (state.phase === 'checking') return `${icon('timer')}10往復をはかっているよ`;
    return '';
}

function render() {
    const placing = state.phase === 'placing';
    const highlight = new Map();
    if (state.firstId && state.phase !== 'placing') highlight.set(state.firstId, 'first');
    app.view.render({ pendulums: state.pendulums, interactive: placing, highlight });
    const two = state.pendulums.length === 2;
    renderPendReadout($('#pend-readout'), state.pendulums, {
        hidden: placing,
        verdict: two && !placing ? compareVerdict(state.pendulums[0], state.pendulums[1]) : null,
    });
    $('#stage-note').innerHTML = stageNote();
    if (state.phase === 'cleared') return;
    const dock = $('#dock');
    for (const b of dock.querySelectorAll('[data-choice]')) {
        b.setAttribute('aria-checked', String(b.dataset.choice === state.selected));
        b.disabled = !placing;
    }
    dock.querySelector('.mission-hint').hidden = !state.showHint;
    const release = dock.querySelector('[data-act="release"]');
    release.disabled = !placing || !state.selected;
    release.classList.toggle('is-ready', placing && Boolean(state.selected));
    dock.querySelector('[data-act="hint"]').disabled = !placing;
    const fast = dock.querySelector('[data-act="fast"]');
    fast.hidden = placing;
    fast.setAttribute('aria-pressed', String(state.fast));
}
