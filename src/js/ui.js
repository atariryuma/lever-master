/** 画面まわりの小さな共通部品 */

import { momentOf, termsOf } from './engine/lever.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);

export function showScreen(id) {
    for (const s of $$('.screen')) s.hidden = s.id !== id;
    const screen = document.getElementById(id);
    screen.scrollTop = 0;
    const heading = screen.querySelector('[data-autofocus]') ?? screen.querySelector('h1, h2');
    heading?.focus?.({ preventScroll: true });
}

/** スクリーンリーダー向けのお知らせ */
export function announce(text) {
    const live = $('#live');
    live.textContent = '';
    requestAnimationFrame(() => {
        live.textContent = text;
    });
}

let toastTimer = null;
export function toast(text, tone = 'info') {
    const box = $('#toast');
    box.textContent = text;
    box.dataset.tone = tone;
    box.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('is-shown'), 2200);
}

/** ステージ中央に大きく出すメッセージ */
export function banner(text, { tone = 'info', sub = '', duration = 1100 } = {}) {
    const box = $('#banner');
    box.innerHTML = `<div class="banner-main">${escapeHtml(text)}</div>${sub ? `<div class="banner-sub">${escapeHtml(sub)}</div>` : ''}`;
    box.dataset.tone = tone;
    box.classList.remove('is-shown');
    void box.offsetWidth;
    box.classList.add('is-shown');
    const token = ++bannerToken;
    return new Promise(resolve => {
        setTimeout(() => {
            if (token === bannerToken) box.classList.remove('is-shown');
            resolve();
        }, duration);
    });
}

let bannerToken = 0;

export function hideBanner() {
    $('#banner').classList.remove('is-shown');
}

/** 画面を離れたら止まる sleep */
export function createSession() {
    let alive = true;
    const timers = new Set();
    return {
        get alive() {
            return alive;
        },
        sleep(ms) {
            return new Promise((resolve, reject) => {
                const id = setTimeout(() => {
                    timers.delete(id);
                    if (alive) resolve();
                    else reject(new SessionEnded());
                }, ms);
                timers.add(id);
            });
        },
        /** 画面を離れていたら、待っていた処理の続きを止める */
        wrap(promise) {
            return promise.then(value => {
                if (!alive) throw new SessionEnded();
                return value;
            });
        },
        end() {
            alive = false;
            timers.forEach(clearTimeout);
            timers.clear();
        },
    };
}

export class SessionEnded extends Error {}

/** 左右の計算式パネル */
export function renderReadout(root, board, { hidden = false, reveal = 'all', verdictHidden = false } = {}) {
    const m = momentOf(board);
    const max = Math.max(m.left, m.right, 1);
    for (const side of ['left', 'right']) {
        const box = root.querySelector(`.side-${side}`);
        const terms = termsOf(board, side);
        const total = m[side];
        const formula = box.querySelector('.formula');
        const bar = box.querySelector('.bar > span');
        if (hidden) {
            formula.innerHTML = '<span class="q">？</span>';
            bar.style.width = '0%';
            box.setAttribute('aria-label', `${side === 'left' ? '左' : '右'}うで：かくれています`);
            continue;
        }
        const expr = terms.length
            ? terms.map(t => `<span class="term">${t.distance}<i>×</i>${t.mass}</span>`).join('<i class="plus">+</i>')
            : '<span class="term empty">なし</span>';
        formula.innerHTML = `${expr}<span class="sum"><i class="eq">=</i><b class="total">${total}</b></span>`;
        bar.style.width = `${(total / max) * 100}%`;
        box.setAttribute('aria-label', `${side === 'left' ? '左' : '右'}うで：${terms.map(t => `${t.distance}かける${t.mass}`).join('たす') || 'なし'}、合計 ${total}`);
    }
    const verdict = root.querySelector('.verdict');
    let state;
    if ((hidden && reveal !== 'side') || verdictHidden) state = 'unknown';
    else if (m.diff === 0) state = 'equal';
    else state = m.diff > 0 ? 'left' : 'right';
    const labels = {
        unknown: ['？', 'どっちかな'],
        equal: ['＝', 'つり合う'],
        left: ['＞', '左がおもい'],
        right: ['＜', '右がおもい'],
    };
    verdict.dataset.state = state;
    verdict.innerHTML = `<span class="verdict-sign">${labels[state][0]}</span><span class="verdict-text">${labels[state][1]}</span>`;
    return m;
}

export function formulaText(board) {
    const m = momentOf(board);
    const side = s => termsOf(board, s).map(t => `${t.distance}×${t.mass}`).join(' + ') || '0';
    return `左 ${side('left')} = ${m.left}、右 ${side('right')} = ${m.right}`;
}
