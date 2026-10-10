/**
 * 画面全体の演出（DOM）。3D でも 2D でも同じように出る。
 * すべて pointer-events: none の #fx レイヤーに描く。
 */

import { escapeHtml } from './ui.js';

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const layer = () => document.getElementById('fx');

function spawn(className, html = '', ms = 1200) {
    const el = document.createElement('div');
    el.className = className;
    el.innerHTML = html;
    layer().appendChild(el);
    setTimeout(() => el.remove(), ms);
    return el;
}

/** 画面フラッシュ */
export function flash(tone = 'white') {
    spawn(`fx-flash is-${tone}`, '', 600);
}

/** 画面のふちが赤く脈打つ（0〜1） */
export function setDanger(level) {
    const v = document.getElementById('fx-vignette');
    if (!v) return;
    v.style.setProperty('--danger', String(Math.max(0, Math.min(1, level))));
    v.classList.toggle('is-on', level > 0.01);
}

/** ターン開始：斜めの帯が画面を横切る */
export function turnSweep(title, sub, colorClass) {
    return new Promise(resolve => {
        const el = spawn(`fx-sweep ${colorClass}`, `
            <div class="fx-sweep-band">
                <div class="fx-sweep-title">${escapeHtml(title)}</div>
                ${sub ? `<div class="fx-sweep-sub">${escapeHtml(sub)}</div>` : ''}
            </div>`, reduceMotion() ? 900 : 1300);
        setTimeout(resolve, reduceMotion() ? 600 : 1000);
        return el;
    });
}

/** 大きな文字を画面にたたきつける（SAFE! / OUT!! など） */
export function slam(text, { tone = 'ok', sub = '', ms = 1400 } = {}) {
    spawn(`fx-slam is-${tone}`, `
        <div class="fx-slam-text" data-text="${escapeHtml(text)}">${escapeHtml(text)}</div>
        ${sub ? `<div class="fx-slam-sub">${escapeHtml(sub)}</div>` : ''}`, ms);
    return new Promise(resolve => setTimeout(resolve, ms - 200));
}

/** 得点などのポップアップ（画面座標） */
export function popup(text, x, y, tone = 'ok') {
    const el = spawn(`fx-pop is-${tone}`, escapeHtml(text), 1300);
    // 画面の外に出ないように（中央ぞろえなので、はしから少しはなす）
    const margin = Math.min(90, window.innerWidth / 4);
    el.style.left = `${Math.max(margin, Math.min(window.innerWidth - margin, x))}px`;
    el.style.top = `${y}px`;
}

/** 紙吹雪 */
export function confetti(colors = ['#38bdf8', '#facc15', '#fb7185', '#4ade80', '#a78bfa']) {
    if (reduceMotion()) return;
    const box = spawn('fx-confetti', '', 4200);
    for (let i = 0; i < 90; i++) {
        const p = document.createElement('i');
        p.style.left = `${Math.random() * 100}%`;
        p.style.background = colors[i % colors.length];
        p.style.animationDelay = `${Math.random() * 0.6}s`;
        p.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
        p.style.setProperty('--drift', `${(Math.random() - 0.5) * 240}px`);
        p.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
        box.appendChild(p);
    }
}

/** 画面をゆらす（DOM 全体） */
export function shake(strength = 'strong') {
    if (reduceMotion()) return;
    const app = document.getElementById('screen-play');
    app.classList.remove('fx-shake', 'fx-shake-soft');
    void app.offsetWidth;
    app.classList.add(strength === 'soft' ? 'fx-shake-soft' : 'fx-shake');
}
