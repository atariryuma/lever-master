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
    screen.classList.remove('is-entering');
    void screen.offsetWidth;
    screen.classList.add('is-entering');
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
/**
 * はたらきの面積図：横＝きょり、縦＝重さ の長方形。面積がはたらき。
 * 左右で同じ縮尺にするので、面積を見比べればつり合いがわかる。
 */
function areaSvg(terms, side, scale) {
    const { kx, ky, height } = scale;
    let x = 0;
    const rects = terms.map(t => {
        const w = t.distance * kx;
        const h = t.mass * ky;
        const r = { x, w, h, t };
        x += w + 2;
        return r;
    });
    const width = Math.max(1, x);
    const flip = side === 'left';
    const body = rects.map(({ x: rx, w, h, t }) => {
        const px = flip ? width - rx - w : rx;
        const label = w > 26 && h > 13 ? `<text x="${px + w / 2}" y="${height - h / 2}">${t.distance}×${t.mass}</text>` : '';
        return `<rect x="${px}" y="${height - h}" width="${w}" height="${h}" rx="2"/>${label}`;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="area-${side}">${body}</svg>`;
}

function areaScale(board, maxWidth = 260, height = 56) {
    const all = [...termsOf(board, 'left'), ...termsOf(board, 'right')];
    const maxMass = Math.max(30, ...all.map(t => t.mass));
    const sumDist = side => termsOf(board, side).reduce((a, t) => a + t.distance, 0);
    const maxDist = Math.max(6, sumDist('left'), sumDist('right'));
    return { kx: Math.min(44, maxWidth / maxDist), ky: (height - 2) / maxMass, height };
}

const verdictOf = diff => (diff === 0 ? 'equal' : diff > 0 ? 'left' : 'right');

export function renderReadout(root, board, { hidden = false, reveal = 'all', verdictHidden = false, area = false } = {}) {
    const m = momentOf(board);
    const max = Math.max(m.left, m.right, 1);
    root.classList.toggle('has-area', area);
    const boxWidth = root.querySelector('.side-left')?.clientWidth ?? 300;
    const scale = area ? areaScale(board, Math.max(120, Math.min(320, boxWidth - 40))) : null;
    for (const side of ['left', 'right']) {
        const box = root.querySelector(`.side-${side}`);
        const terms = termsOf(board, side);
        const total = m[side];
        const formula = box.querySelector('.formula');
        const bar = box.querySelector('.bar > span');
        const areaBox = box.querySelector('.area');
        if (areaBox) areaBox.innerHTML = area && !hidden ? areaSvg(terms, side, scale) : '';
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
    const state = (hidden && reveal !== 'side') || verdictHidden ? 'unknown' : verdictOf(m.diff);
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
