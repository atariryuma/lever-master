/**
 * 「水平キープ」ゲージ
 * 条件（たとえば「つり合って静まっている」）が続くあいだゲージがたまり、たまりきったら決定する。
 * 条件がくずれたら 0 にもどる。下のボタンを押さなくても、てこを見ていれば結果が決まる。
 */

import { play } from './audio.js';

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
    let lastQuarter = 0;

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
        const dt = Math.min(100, now - last);
        last = now;
        held = isActive() ? held + dt : 0;
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
