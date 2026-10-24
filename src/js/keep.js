/**
 * 「水平キープ」ゲージ
 * 条件（たとえば「つり合って静まっている」）が続くあいだゲージがたまり、たまりきったら決定する。
 * 条件がくずれたら 0 にもどる。下のボタンを押さなくても、てこを見ていれば結果が決まる。
 */

import { play } from './audio.js';
import { toast } from './ui.js';

// さわった（タップ・キー）ら、ゲージは 0 から。「さわらずに待つ」を数えるため
let lastInput = 0;
window.addEventListener('pointerdown', () => { lastInput = performance.now(); }, { capture: true, passive: true });
window.addEventListener('keydown', () => { lastInput = performance.now(); }, { capture: true });
// 操作ボタン・スライダーを押したままのあいだも数えない（押しっぱなしで決まらないように）。
// 画面に指を置いているだけ（てこ・ふりこの上など）では止めない（CPU の判定が止まらないように）
const pressing = new Set();
window.addEventListener('pointerdown', e => {
    if (e.target?.closest?.('input, button, select, [role="slider"]')) pressing.add(e.pointerId);
}, { capture: true, passive: true });
for (const type of ['pointerup', 'pointercancel']) {
    window.addEventListener(type, e => {
        pressing.delete(e.pointerId);
        lastInput = performance.now();
    }, { capture: true, passive: true });
}
for (const type of ['blur', 'contextmenu']) window.addEventListener(type, () => pressing.clear());

// 「さわると さいしょから」の案内は、ページを開いているあいだに1回だけ
const hinted = new Set();

/**
 * @param {{ ms: number, label: string, isActive: () => boolean, onDone: () => void, touchHint?: string }} opts
 *   touchHint … たまりかけたゲージを、さわってもどしてしまったときに出す案内
 * @returns {{ stop: () => void }}
 */
export function watchKeep({ ms, label, isActive, onDone, touchHint }) {
    const box = document.getElementById('keep');
    const text = document.getElementById('keep-label');
    let held = 0;
    let last = performance.now();
    let frame = 0;
    let stopped = false;
    let lastQuarter = 0; // 鳴らしたところ（1/4 ごと）

    const show = p => {
        box.hidden = p <= 0;
        box.style.setProperty('--p', String(p));
        text.textContent = label;
    };
    const stop = () => {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(frame);
        show(0);
    };
    const tick = now => {
        if (stopped) return;
        frame = requestAnimationFrame(tick);
        const dt = Math.max(0, Math.min(100, now - last));
        last = now;
        // ダイアログ（ルール・せってい・やめますか？）を開いているあいだや、押しているあいだ・さわった直後は数えない
        const touched = pressing.size > 0 || now - lastInput < 250;
        const paused = document.querySelector('dialog[open]') || touched;
        if (touched && touchHint && held >= ms / 4 && !hinted.has(touchHint)) {
            hinted.add(touchHint);
            toast(touchHint);
        }
        held = !paused && isActive() ? held + dt : 0;
        const p = Math.min(1, held / ms);
        // ゲージが 1/4 たまるごとに小さく鳴らす
        const quarter = Math.floor(p * 4);
        if (quarter > lastQuarter && quarter < 4) play('tick');
        lastQuarter = quarter;
        show(p);
        if (p >= 1) {
            stop();
            onDone();
        }
    };
    frame = requestAnimationFrame(tick);
    return { stop };
}
