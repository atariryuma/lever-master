/**
 * 「水平キープ」ゲージ
 * 条件（たとえば「つり合って静まっている」）が続くあいだゲージがたまり、たまりきったら決定する。
 * 条件がくずれたら 0 にもどる。下のボタンを押さなくても、てこを見ていれば結果が決まる。
 */

import { play } from './audio.js';

// さわった（タップ・キー）ら、ゲージは 0 から。「さわらずに待つ」を数えるため
let lastInput = 0;
window.addEventListener('pointerdown', () => { lastInput = performance.now(); }, { capture: true, passive: true });
window.addEventListener('keydown', () => { lastInput = performance.now(); }, { capture: true });

/**
 * @param {{ ms: number, label: string, isActive: () => boolean, onDone: () => void }} opts
 * @returns {{ stop: () => void }}
 */
export function watchKeep({ ms, label, isActive, onDone }) {
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
        // ダイアログ（ルール・せってい・やめますか？）を開いているあいだや、さわった直後は数えない
        const paused = document.querySelector('dialog[open]') || now - lastInput < 250;
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
