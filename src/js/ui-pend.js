/**
 * ふりこの計測パネル（てこの「計算式パネル」にあたるもの）
 * ふりこごとに「条件（長さ・重さ・ふれはば）」と「往復の回数・時間」を出し、2つのときは まん中に結果を出す
 */

import { COUNT, CONDITIONS, CONDITION_META, cycleTimeOf, cyclesOf, elapsedOf, periodOf, round1 } from './engine/pendulum.js';
import { colorVarOf } from './view/pendulum-view.js';
import { escapeHtml } from './ui.js';
import { PLAYER_META } from './players.js';

/**
 * @param {HTMLElement} root
 * @param {object[]} pendulums
 * @param {{ changed?: string[], hidden?: boolean, verdict?: {state:string, sign:string, text:string}|null,
 *           grades?: Record<string,string>, interactiveId?: string|null }} [opts]
 *   changed … 強調する条件（じっけんで「変える条件」）
 *   hidden  … 時間をかくす（もんだいの予想中）
 *   verdict … まん中の結果（2つのときだけ。false なら出さない＝たいせん）
 *   grades  … たいせんの評価（PERFECT など）
 */
export function renderPendReadout(root, pendulums, { changed = [], hidden = false, verdict = null, grades = {} } = {}) {
    root.dataset.count = pendulums.length === 2 && verdict === false ? '2n' : String(pendulums.length);
    const cards = pendulums.map((p, i) => {
        const conds = CONDITIONS.map(c => `<span class="pcond${changed.includes(c) ? ' is-changed' : ''}">${CONDITION_META[c].short} <b>${p[c]}${CONDITION_META[c].unit}</b></span>`).join('');
        const label = p.owner && PLAYER_META[p.owner] ? `${PLAYER_META[p.owner].symbol}` : escapeHtml(p.label);
        const grade = grades[p.id] ? `<span class="pgrade is-${grades[p.id].toLowerCase()}">${grades[p.id]}</span>` : '';
        return `
            <div class="pside" data-id="${escapeHtml(p.id)}" style="--pc: var(${colorVarOf(p, i)})" role="group" aria-label="${escapeHtml(ariaOf(p, hidden))}">
                <div class="pside-head"><span class="pside-tag">${label}</span><span class="pside-conds">${conds}</span>${grade}</div>
                <div class="pside-time">${timeHtml(p, hidden)}</div>
                <div class="bar"><span style="width:${hidden ? 0 : Math.min(100, (cyclesOf(p) / COUNT) * 100)}%"></span></div>
            </div>`;
    });
    // 2つのときは、カードのあいだに結果
    if (pendulums.length === 2 && verdict !== false) cards.splice(1, 0, verdictHtml(verdict));
    root.innerHTML = cards.join('');
}

function ariaOf(p, hidden) {
    const cond = `長さ${p.length}cm・${p.mass}g・ふれはば${p.amplitude}°`;
    if (hidden) return `${p.label}：${cond}`;
    const n = cyclesOf(p);
    const t10 = cycleTimeOf(p, COUNT);
    return `${p.label}：${cond}、${n}往復${t10 !== null ? `、10往復 ${round1(t10)}秒` : ''}`;
}

function timeHtml(p, hidden) {
    if (hidden) return '<b class="q">？</b><small>秒</small><span class="pside-count">10往復で</span>';
    const t10 = cycleTimeOf(p, COUNT);
    if (t10 !== null) {
        return `<b class="is-done">${round1(t10).toFixed(1)}</b><small>秒</small><span class="pside-count">10往復<i>・1往復 ${(t10 / COUNT).toFixed(2)}秒</i></span>`;
    }
    const n = cyclesOf(p);
    const t = elapsedOf(p);
    return `<b data-live="time">${t.toFixed(1)}</b><small>秒</small><span class="pside-count"><em data-live="count">${n}</em> 往復</span>`;
}

/** 毎フレーム、時間と回数だけを書きかえる（作りなおさない） */
export function updatePendReadout(root, pendulums) {
    for (const p of pendulums) {
        const card = root.querySelector(`.pside[data-id="${CSS.escape(p.id)}"]`);
        if (!card) continue;
        const time = card.querySelector('[data-live="time"]');
        if (time) time.textContent = elapsedOf(p).toFixed(1);
        const count = card.querySelector('[data-live="count"]');
        if (count) count.textContent = String(cyclesOf(p));
        const bar = card.querySelector('.bar > span');
        if (bar) bar.style.width = `${Math.min(100, (cyclesOf(p) / COUNT) * 100)}%`;
    }
}

function verdictHtml(v) {
    const state = v?.state ?? 'unknown';
    const sign = v?.sign ?? '？';
    const text = v?.text ?? 'どっちかな';
    return `<div class="verdict" data-state="${escapeHtml(state)}"><span class="verdict-sign">${escapeHtml(sign)}</span><span class="verdict-text">${escapeHtml(text)}</span></div>`;
}

/**
 * 2つのふりこの結果（10往復が終わったほうから）
 * @returns {{state:string, sign:string, text:string}|null}
 */
export function compareVerdict(a, b) {
    const ta = cycleTimeOf(a, COUNT);
    const tb = cycleTimeOf(b, COUNT);
    if (ta === null && tb === null) return null;
    // 片方だけ終わった：先に終わったほうがはやい（長さが同じなら同時に終わる）
    if (ta === null || tb === null) {
        const same = Math.abs(periodOf(a.length) - periodOf(b.length)) < 1e-9;
        if (same) return null;
        return ta !== null ? { state: 'left', sign: '＜', text: 'A がはやい' } : { state: 'right', sign: '＞', text: 'B がはやい' };
    }
    const d = round1(ta - tb);
    if (Math.abs(d) < 0.15) return { state: 'equal', sign: '＝', text: '同じ時間' };
    return d < 0 ? { state: 'left', sign: '＜', text: `A が ${Math.abs(d).toFixed(1)}秒 はやい` } : { state: 'right', sign: '＞', text: `B が ${d.toFixed(1)}秒 はやい` };
}

/** 読み上げ用 */
export function pendSummary(pendulums) {
    return pendulums.map(p => {
        const t10 = cycleTimeOf(p, COUNT);
        return `${p.label} 長さ${p.length}cm ${t10 !== null ? `10往復 ${round1(t10)}秒` : `${cyclesOf(p)}往復`}`;
    }).join('、');
}
