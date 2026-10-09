/**
 * Web Audio で合成する効果音と BGM（音声ファイル不要・オフラインOK）
 * 最初にユーザーが画面にふれたときに AudioContext を有効にします（iOS対策）。
 */

import { settings } from './storage.js';

let ctx = null;
let master = null;
let bgmGain = null;
let bgmTimer = null;

function context() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    return ctx;
}

export function unlockAudio() {
    const c = context();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (settings.bgm) startBgm();
}

function tone(freq, { at = 0, dur = 0.15, type = 'sine', vol = 0.18, to = null, out = master } = {}) {
    const c = ctx;
    const t = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
}

const SOUNDS = {
    tap: () => tone(880, { dur: 0.06, type: 'triangle', vol: 0.08 }),
    pick: () => tone(520, { dur: 0.1, to: 780, type: 'triangle', vol: 0.12 }),
    drop: () => {
        tone(330, { dur: 0.16, to: 180, vol: 0.22 });
        tone(1320, { at: 0.02, dur: 0.08, type: 'triangle', vol: 0.05 });
    },
    move: () => tone(400, { dur: 0.14, to: 620, type: 'triangle', vol: 0.14 }),
    error: () => tone(220, { dur: 0.18, to: 160, type: 'square', vol: 0.06 }),
    release: () => tone(200, { dur: 0.35, to: 90, type: 'sawtooth', vol: 0.05 }),
    safe: () => [523.25, 659.25, 783.99].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.28, vol: 0.14 })),
    out: () => [392, 311.13, 233.08].forEach((f, i) => tone(f, { at: i * 0.14, dur: 0.32, type: 'triangle', vol: 0.15 })),
    turn: () => tone(660, { dur: 0.12, type: 'sine', vol: 0.08 }),
    star: () => [1046.5, 1318.5].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.18, type: 'triangle', vol: 0.1 })),
    win: () => [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => tone(f, { at: i * 0.12, dur: 0.3, type: 'triangle', vol: 0.15 })),
};

export function play(name) {
    if (!settings.sfx || !context() || ctx.state !== 'running') return;
    SOUNDS[name]?.();
}

/* ---------- BGM：ゆったりしたコード進行 ---------- */

const CHORDS = [
    [261.63, 329.63, 392.0],
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
];

export function startBgm() {
    if (!context() || bgmTimer) return;
    bgmGain = ctx.createGain();
    bgmGain.gain.value = 0.05;
    bgmGain.connect(master);
    let i = 0;
    const step = () => {
        if (ctx.state === 'running') {
            CHORDS[i % CHORDS.length].forEach((f, k) => tone(f / 2, { at: k * 0.05, dur: 3.6, vol: 0.5, out: bgmGain }));
            tone(CHORDS[i % CHORDS.length][(i * 2) % 3] * 2, { at: 0.6, dur: 1.6, type: 'triangle', vol: 0.35, out: bgmGain });
        }
        i += 1;
    };
    step();
    bgmTimer = setInterval(step, 3600);
}

export function stopBgm() {
    clearInterval(bgmTimer);
    bgmTimer = null;
    bgmGain?.disconnect();
    bgmGain = null;
}

document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
});
