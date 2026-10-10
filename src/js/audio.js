/**
 * Web Audio で合成する効果音と BGM（音声ファイル不要・オフラインOK）
 * 最初にユーザーが画面にふれたときに AudioContext を有効にします（iOS対策）。
 *
 * BGM は3種類:
 *   menu   … ホーム・一覧・準備（軽いビートのシンセポップ）
 *   study  … じっけん・もんだい（考えるじゃまをしない、ゆったりしたパッドとベル）
 *   battle … たいせん（キック・ハット・ベース・アルペジオ）。intensity で速さと音数が上がる
 * 音量は settings.sfxVolume / settings.bgmVolume（0〜1）。0 なら鳴らさない。
 */

import { settings } from './storage.js';

let ctx = null;
let master = null;
let sfxBus = null;
let bgmBus = null;
let noiseBuffer = null;

function context() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -14;
    master.ratio.value = 4;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = settings.sfxVolume;
    sfxBus.connect(master);
    bgmBus = ctx.createGain();
    bgmBus.gain.value = 0;
    bgmBus.connect(master);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
}

export function unlockAudio() {
    const c = context();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (settings.bgmVolume > 0) startBgm();
}

/** 音量を反映（せってい画面から） */
export function applyVolumes() {
    if (!ctx) return;
    sfxBus.gain.setTargetAtTime(settings.sfxVolume, now(), 0.05);
    if (settings.bgmVolume > 0) {
        startBgm();
        bgmBus.gain.setTargetAtTime(bgmLevel(), now(), 0.2);
    } else {
        stopBgm();
    }
}

const now = () => ctx.currentTime;

/* ---------- 音の部品 ---------- */

function tone(freq, { at = 0, dur = 0.15, type = 'sine', vol = 0.18, to = null, out = sfxBus, attack = 0.008 } = {}) {
    const t = now() + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.03);
}

/** フィルターをかけたノイズ（打撃・風切り・シンバル） */
function noise({ at = 0, dur = 0.2, vol = 0.2, type = 'bandpass', freq = 1000, to = null, q = 1, out = sfxBus, attack = 0.004 } = {}) {
    const t = now() + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
}

function kick(at = 0, vol = 0.9, out = sfxBus) {
    tone(150, { at, dur: 0.32, to: 42, vol, out, attack: 0.002 });
    noise({ at, dur: 0.03, vol: vol * 0.3, type: 'highpass', freq: 3000, out });
}

const chord = (freqs, opts) => freqs.forEach((f, i) => tone(f, { ...opts, at: (opts.at ?? 0) + i * (opts.spread ?? 0) }));

/* ---------- 効果音 ---------- */

const SOUNDS = {
    tap: () => tone(1100, { dur: 0.05, type: 'triangle', vol: 0.07 }),
    pick: () => {
        tone(600, { dur: 0.09, to: 1000, type: 'triangle', vol: 0.12 });
        noise({ dur: 0.06, vol: 0.05, freq: 5000, q: 2 });
    },
    /** つるす：金属のガチャッ＋低い衝撃 */
    drop: () => {
        tone(180, { dur: 0.22, to: 70, vol: 0.5, attack: 0.002 });
        noise({ dur: 0.08, vol: 0.35, freq: 2600, q: 3 });
        tone(2400, { at: 0.01, dur: 0.18, type: 'square', vol: 0.03 });
        tone(3170, { at: 0.012, dur: 0.22, type: 'sine', vol: 0.05 });
    },
    move: () => {
        noise({ dur: 0.22, vol: 0.18, freq: 600, to: 3000, q: 1.5 });
        tone(320, { dur: 0.16, to: 640, type: 'triangle', vol: 0.12 });
    },
    error: () => {
        tone(160, { dur: 0.12, type: 'square', vol: 0.08 });
        tone(120, { at: 0.12, dur: 0.16, type: 'square', vol: 0.08 });
    },
    release: () => noise({ dur: 0.45, vol: 0.18, freq: 300, to: 2500, q: 0.8 }),
    /** ターン開始：シュッ＋プレイヤーごとの音程のスティンガー */
    whoosh: () => noise({ dur: 0.35, vol: 0.28, freq: 400, to: 4000, q: 0.9, attack: 0.12 }),
    turn: (seat = 0) => {
        const base = [392, 440, 494, 523.25][seat % 4];
        noise({ dur: 0.3, vol: 0.22, freq: 500, to: 5000, q: 0.9, attack: 0.1 });
        chord([base, base * 1.5], { at: 0.12, dur: 0.35, type: 'sawtooth', vol: 0.05 });
        tone(base * 2, { at: 0.12, dur: 0.4, type: 'triangle', vol: 0.1 });
    },
    tick: () => tone(1500, { dur: 0.04, type: 'square', vol: 0.05 }),
    tickUrgent: () => {
        tone(1900, { dur: 0.06, type: 'square', vol: 0.09 });
        tone(950, { dur: 0.06, type: 'square', vol: 0.06 });
    },
    heartbeat: () => {
        tone(70, { dur: 0.16, to: 45, vol: 0.55, attack: 0.004 });
        tone(65, { at: 0.18, dur: 0.18, to: 40, vol: 0.4, attack: 0.004 });
    },
    /** 判定前のドラムロール（だんだん速く・大きく） */
    drumroll: (dur = 1) => {
        let t = 0;
        let gap = 0.09;
        while (t < dur) {
            const p = t / dur;
            noise({ at: t, dur: 0.05, vol: 0.06 + p * 0.18, freq: 1800, q: 1.2 });
            tone(110 + p * 60, { at: t, dur: 0.05, vol: 0.05 + p * 0.15, attack: 0.002 });
            t += gap;
            gap = Math.max(0.035, gap * 0.93);
        }
        noise({ dur, vol: 0.12, type: 'lowpass', freq: 200, to: 2000, q: 0.7, attack: dur * 0.9 });
    },
    /** セーフ：キック＋明るい和音＋キラキラ */
    safe: () => {
        kick(0, 0.8);
        noise({ dur: 0.5, vol: 0.12, type: 'highpass', freq: 6000 });
        chord([523.25, 659.25, 783.99, 1046.5], { dur: 0.6, type: 'triangle', vol: 0.12, spread: 0.035 });
        chord([1568, 2093, 2637, 3136], { at: 0.12, dur: 0.25, type: 'sine', vol: 0.05, spread: 0.06 });
    },
    /** アウト：重い衝撃＋割れる音＋下がるブザー */
    out: () => {
        kick(0, 1);
        tone(55, { dur: 0.9, to: 30, vol: 0.6, attack: 0.002 });
        noise({ dur: 0.9, vol: 0.45, type: 'lowpass', freq: 3000, to: 200, q: 0.5, attack: 0.002 });
        noise({ dur: 0.25, vol: 0.3, freq: 4500, q: 5 });
        chord([233.08, 220], { at: 0.15, dur: 0.7, type: 'sawtooth', vol: 0.09, to: null });
        tone(440, { at: 0.15, dur: 0.8, to: 110, type: 'sawtooth', vol: 0.08 });
    },
    /** 巻きもどし */
    rewind: () => {
        noise({ dur: 0.5, vol: 0.18, freq: 4000, to: 400, q: 2 });
        tone(1200, { dur: 0.5, to: 200, type: 'sawtooth', vol: 0.04 });
    },
    /** じっけん：つり合った（やさしいチャイム） */
    balance: () => {
        chord([659.25, 783.99, 1046.5], { dur: 0.7, type: 'sine', vol: 0.1, spread: 0.07 });
        tone(2093, { at: 0.2, dur: 0.5, type: 'sine', vol: 0.03 });
    },
    /** もんだい：かたむいた（責めない音） */
    miss: () => {
        tone(392, { dur: 0.25, type: 'triangle', vol: 0.12 });
        tone(311.13, { at: 0.18, dur: 0.4, type: 'triangle', vol: 0.12 });
        noise({ dur: 0.3, vol: 0.06, type: 'lowpass', freq: 800 });
    },
    starPop: (n = 0) => {
        const f = [1046.5, 1318.5, 1568][n % 3];
        tone(f, { dur: 0.3, type: 'square', vol: 0.05 });
        tone(f * 2, { dur: 0.2, type: 'sine', vol: 0.06 });
        noise({ dur: 0.12, vol: 0.06, type: 'highpass', freq: 7000 });
    },
    clear: () => {
        kick(0, 0.7);
        chord([523.25, 659.25, 783.99, 1046.5], { dur: 0.9, type: 'triangle', vol: 0.11, spread: 0.06 });
        noise({ dur: 0.8, vol: 0.1, type: 'highpass', freq: 6000 });
    },
    points: () => chord([1318.5, 1760], { dur: 0.14, type: 'square', vol: 0.04, spread: 0.06 }),
    combo: () => chord([783.99, 987.77, 1174.66, 1567.98], { dur: 0.22, type: 'square', vol: 0.05, spread: 0.05 }),
    finalRound: () => {
        kick(0, 0.9);
        kick(0.25, 0.9);
        noise({ dur: 1.2, vol: 0.2, type: 'highpass', freq: 3000, to: 8000 });
        chord([146.83, 220, 293.66], { at: 0.25, dur: 1.2, type: 'sawtooth', vol: 0.08 });
    },
    star: () => chord([1046.5, 1318.5, 1568], { dur: 0.25, type: 'triangle', vol: 0.1, spread: 0.07 }),
    win: () => {
        kick(0, 0.9);
        noise({ dur: 1.4, vol: 0.18, type: 'highpass', freq: 5000 });
        const melody = [523.25, 659.25, 783.99, 1046.5, 987.77, 1046.5, 1318.5];
        melody.forEach((f, i) => tone(f, { at: 0.1 + i * 0.13, dur: i === melody.length - 1 ? 0.9 : 0.2, type: 'square', vol: 0.07 }));
        chord([261.63, 329.63, 392, 523.25], { at: 0.1 + 6 * 0.13, dur: 1.2, type: 'sawtooth', vol: 0.05 });
        kick(0.1 + 6 * 0.13, 0.9);
    },
    lose: () => {
        [392, 369.99, 349.23, 329.63].forEach((f, i) => tone(f, { at: i * 0.28, dur: i === 3 ? 1 : 0.3, type: 'sawtooth', vol: 0.06 }));
        tone(55, { at: 0.84, dur: 1, vol: 0.4 });
    },
};

export function play(name, arg) {
    if (!(settings.sfxVolume > 0) || !context() || ctx.state !== 'running') return;
    SOUNDS[name]?.(arg);
}

/* ---------- BGM ---------- */

let bgmMode = 'menu';
let intensity = 0;
let schedulerTimer = null;
let nextNoteTime = 0;
let step16 = 0;

const STUDY_CHORDS = [
    [261.63, 329.63, 392.0],
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
];
const STUDY_BELLS = [784, 659.25, 587.33, 523.25, 587.33, 659.25, 784, 880];

// C - Am - F - G（メニュー）
const MENU_ROOTS = [130.81, 110, 87.31, 98];
const MENU_CHORDS = [
    [261.63, 329.63, 392],
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [196, 246.94, 293.66],
];
// ペンタトニックのメロディ（16分音符×16 で1小節、0 は休み）
const MENU_MELODY = [
    [784, 0, 659.25, 0, 587.33, 0, 523.25, 0, 587.33, 0, 0, 659.25, 0, 0, 0, 0],
    [523.25, 0, 587.33, 0, 659.25, 0, 0, 784, 0, 0, 659.25, 0, 0, 0, 0, 0],
    [698.46, 0, 659.25, 0, 523.25, 0, 0, 440, 0, 0, 523.25, 0, 0, 0, 0, 0],
    [587.33, 0, 659.25, 0, 784, 0, 0, 880, 0, 784, 0, 0, 0, 0, 0, 0],
];

// Am - F - C - G（たいせん）
const BATTLE_ROOTS = [110, 87.31, 130.81, 98];
const BATTLE_ARP = [
    [220, 261.63, 329.63, 440],
    [174.61, 220, 261.63, 349.23],
    [261.63, 329.63, 392, 523.25],
    [196, 246.94, 293.66, 392],
];

function scheduleStudy(at, s) {
    const bar = Math.floor(s / 16) % 4;
    const i = s % 16;
    if (i === 0) {
        STUDY_CHORDS[bar].forEach((f, k) => tone(f / 2, { at: at + k * 0.05, dur: 3.2, vol: 0.4, out: bgmBus, attack: 0.6 }));
    }
    if (i % 8 === 4) {
        const f = STUDY_BELLS[(Math.floor(s / 8)) % STUDY_BELLS.length];
        tone(f, { at, dur: 1.6, type: 'sine', vol: 0.14, out: bgmBus, attack: 0.01 });
        tone(f * 2, { at, dur: 0.8, type: 'sine', vol: 0.03, out: bgmBus, attack: 0.01 });
    }
}

function scheduleMenu(at, s) {
    const bar = Math.floor(s / 16) % 4;
    const i = s % 16;
    if (i === 0 || i === 8 || i === 11) kick(at, 0.35, bgmBus);
    if (i === 4 || i === 12) noise({ at, dur: 0.08, vol: 0.12, freq: 2400, q: 1, out: bgmBus });
    if (i % 2 === 0) noise({ at, dur: 0.025, vol: 0.035, type: 'highpass', freq: 8000, out: bgmBus });
    if (i % 4 === 0 || i === 6 || i === 14) {
        tone(MENU_ROOTS[bar], { at, dur: 0.22, type: 'triangle', vol: 0.28, out: bgmBus, attack: 0.005 });
    }
    if (i === 0) MENU_CHORDS[bar].forEach(f => tone(f, { at, dur: 1.7, type: 'sine', vol: 0.06, out: bgmBus, attack: 0.08 }));
    const m = MENU_MELODY[bar][i];
    if (m && Math.floor(s / 64) % 2 === 1) {
        tone(m, { at, dur: 0.28, type: 'square', vol: 0.03, out: bgmBus });
        tone(m, { at, dur: 0.35, type: 'triangle', vol: 0.06, out: bgmBus });
    }
}

function scheduleBattle(at, s) {
    const bar = Math.floor(s / 16) % 4;
    const i = s % 16;
    if (i % 4 === 0) kick(at, 0.55, bgmBus);
    if (intensity >= 1 && i % 8 === 4) noise({ at, dur: 0.12, vol: 0.22, freq: 1800, q: 0.8, out: bgmBus });
    if (i % 2 === 1 || intensity >= 2) noise({ at, dur: 0.03, vol: 0.07, type: 'highpass', freq: 7000, out: bgmBus });
    if (i % 2 === 0) {
        const root = BATTLE_ROOTS[bar] * (i % 8 === 6 ? 2 : 1);
        tone(root, { at, dur: 0.16, type: 'sawtooth', vol: 0.16, out: bgmBus, attack: 0.004 });
    }
    const arp = BATTLE_ARP[bar];
    if (intensity >= 1 || i % 2 === 0) {
        tone(arp[i % 4] * 2, { at, dur: 0.1, type: 'square', vol: 0.035 + intensity * 0.01, out: bgmBus });
    }
    if (intensity >= 2 && i === 0) noise({ at, dur: 0.8, vol: 0.08, type: 'highpass', freq: 5000, out: bgmBus });
}

const TRACKS = {
    menu: { bpm: () => 104, level: 0.24, schedule: scheduleMenu },
    study: { bpm: () => 72, level: 0.16, schedule: scheduleStudy },
    battle: { bpm: () => [118, 128, 140][intensity], level: 0.3, schedule: scheduleBattle },
};

const bgmLevel = () => TRACKS[bgmMode].level * 2 * settings.bgmVolume;

function scheduler() {
    if (ctx.state !== 'running') return;
    const track = TRACKS[bgmMode];
    while (nextNoteTime < now() + 0.15) {
        track.schedule(nextNoteTime - now(), step16);
        nextNoteTime += 60 / track.bpm() / 4;
        step16 += 1;
    }
}

function startBgm() {
    if (!context() || schedulerTimer || !(settings.bgmVolume > 0)) return;
    nextNoteTime = now() + 0.1;
    step16 = 0;
    bgmBus.gain.setTargetAtTime(bgmLevel(), now(), 0.4);
    schedulerTimer = setInterval(scheduler, 40);
}

function stopBgm() {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    if (bgmBus) bgmBus.gain.setTargetAtTime(0, now(), 0.1);
}

/** BGM の種類（menu / study / battle）と盛り上がり（0〜2）を変える */
export function setBgm(mode, level = 0) {
    const changed = mode !== bgmMode;
    bgmMode = TRACKS[mode] ? mode : 'menu';
    intensity = Math.max(0, Math.min(2, level));
    if (!ctx || !schedulerTimer) return;
    if (changed) {
        // 小節の頭から：一瞬しぼってから新しい曲へ
        step16 = 0;
        nextNoteTime = now() + 0.25;
        bgmBus.gain.cancelScheduledValues(now());
        bgmBus.gain.setTargetAtTime(0, now(), 0.05);
        bgmBus.gain.setTargetAtTime(bgmLevel(), now() + 0.25, 0.3);
    } else {
        bgmBus.gain.setTargetAtTime(bgmLevel(), now(), 0.3);
    }
}

document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
});
