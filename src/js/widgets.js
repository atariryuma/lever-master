/** 小さな UI ウィジェット */

import { escapeHtml } from './ui.js';
import { icon } from './icons.js';
import { play } from './audio.js';

/**
 * セグメントボタン（ラジオグループ）
 * @param {HTMLElement} root
 * @param {{ options: [string, string, string?][], value: string, onChange: (v:string)=>void, name?: string }} cfg
 *   options の3つ目はアイコン名（省略可）
 */
export function segmented(root, { options, value, onChange }) {
    let current = value;
    const render = () => {
        root.innerHTML = options.map(([v, label, ic]) => `
            <button type="button" role="radio" aria-checked="${v === current}" data-value="${escapeHtml(v)}"
                tabindex="${v === current ? 0 : -1}">${ic ? icon(ic) : ''}${escapeHtml(label)}</button>`).join('');
    };
    render();
    const choose = v => {
        if (v === current) return;
        current = v;
        render();
        root.querySelector(`[data-value="${CSS.escape(v)}"]`)?.focus();
        play('tap');
        onChange(v);
    };
    root.onclick = e => {
        const b = e.target.closest('button[data-value]');
        if (b) choose(b.dataset.value);
    };
    root.onkeydown = e => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const i = options.findIndex(([v]) => v === current);
        const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
        choose(options[(i + step + options.length) % options.length][0]);
    };
    return { get value() { return current; } };
}

/**
 * トレイのボタンからてこへドラッグできるようにする（タップは通常の click として届く）
 * @param {HTMLElement} container
 * @param {object|(() => object)} view てこのビュー（3D/図の切りかえに追従するため関数でもよい）
 * @param {(btn: HTMLElement) => object|null} getWeight ドラッグするおもり（null ならドラッグしない）
 */
const trayBindings = new WeakMap();

export function bindTrayDrag(container, view, getWeight) {
    const prev = trayBindings.get(container);
    if (prev) {
        container.removeEventListener('pointerdown', prev.down);
        container.removeEventListener('click', prev.click, true);
    }
    const down = e => {
        const btn = e.target.closest('[data-tray]');
        if (!btn || btn.disabled || e.button > 0) return;
        const start = { x: e.clientX, y: e.clientY };
        const move = ev => {
            if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 8) return;
            cleanup();
            const weight = getWeight(btn);
            if (!weight) return;
            btn.dataset.dragged = '1';
            // マウスだとドロップ先で click が起きるので、フラグは次の操作までに消す
            window.addEventListener('pointerup', () => setTimeout(() => delete btn.dataset.dragged, 0), { once: true });
            play('pick');
            (typeof view === 'function' ? view() : view).startDrag({ kind: 'new', weight, trayId: btn.dataset.tray }, ev);
        };
        const cleanup = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', cleanup);
            window.removeEventListener('pointercancel', cleanup);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', cleanup);
        window.addEventListener('pointercancel', cleanup);
    };
    // ドラッグしたあとの click は無視
    const click = e => {
        const btn = e.target.closest('[data-tray]');
        if (btn?.dataset.dragged) {
            delete btn.dataset.dragged;
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    };
    container.addEventListener('pointerdown', down);
    container.addEventListener('click', click, true);
    trayBindings.set(container, { down, click });
}

/**
 * てこにつるしてあるおもりをドラッグしているあいだ、下の操作エリアに「ここに出すと…」を出す
 * @param {string|null} label null で消す
 */
export function setDropZone(label) {
    const dock = document.getElementById('dock');
    if (!dock) return;
    if (label) dock.dataset.drop = label;
    else delete dock.dataset.drop;
}
