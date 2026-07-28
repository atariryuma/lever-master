// ==============================
// モジュールのインポート
// ==============================
import {
    CONFIG,
    CPU_CONFIG,
    AUDIO_CONFIG,
    FEEDBACK_CONFIG,
    PHYSICS_CONFIG,
    CAMERA_CONFIG,
    RENDER_CONFIG,
    COLORS,
    STOCK_POSITIONS,
    PLAYER_ORDER,
    DOM_IDS,
    MESSAGES,
    UI_COLORS,
} from './constants.js';

import {
    hexToCSS,
    hexToRGBA,
    PLAYER_META,
} from './utils.js';

import {
    generatePointsRankingHtml,
    generateBalanceInfoHtml,
    generateLeverStateHtml,
} from './ui-generator.js';

import { initializeEventListeners } from './event-handlers.js';

import {
    calculateMoment,
    calculatePlayerPoints,
    simulateHang,
    simulateMove,
} from './game-logic.js';

import {
    setCpuTimeout,
    clearAllCpuTimeouts,
    setRouletteTimeout,
    clearAllRouletteTimeouts,
    setManagedTimeout,
    clearManagedTimeout,
    clearAllManagedTimeouts,
} from './timeout-manager.js';

import { setupGlobalErrorHandler, logError } from './error-handler.js';

// CONFIG は constants.js の定義をそのまま使う（以前はここでも重複定義していた）

// ==============================
// サウンドシステム（Web Audio API）
// ==============================
let audioCtx = null;
let isMuted = true;  // 初期状態はミュート（スプラッシュでタップ時にONになる）
let bgmGain = null;
let bgmFilter = null;  // BGM全体のローパス（tensionでカットオフを動かす）
let bgmStarted = false;
let bgmLoopTimeoutId = null;  // BGMループのタイムアウトID

let audioUnlocked = false;

async function initAudio() {
    if (audioCtx && audioUnlocked) {
        // 既にアンロック済みの場合はBGM開始のみ
        if (!bgmStarted) startBGM();
        return Promise.resolve(true);
    }

    try {
        // AudioContext作成（まだない場合）
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        // iOS PWA対策: resume()をawaitで確実に待機
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        // サイレント音を再生してiOS音声をアンロック
        const silentBuffer = audioCtx.createBuffer(1, 1, 22050);
        const source = audioCtx.createBufferSource();
        source.buffer = silentBuffer;
        source.connect(audioCtx.destination);
        source.start(0);

        audioUnlocked = true;
        // デバッグ用: console.warn('Audio unlocked, state:', audioCtx.state);

        // BGM開始
        if (!bgmStarted) startBGM();
        return Promise.resolve(true);
    } catch (e) {
        console.warn('Audio init failed:', e);
        audioCtx = null;
        return Promise.resolve(false);
    }
}

// キーボードショートカット
document.addEventListener('keydown', (e) => {
    if (game.isOver) return;
    // S: Skip（moveフェーズで有効）
    if (e.code === 'KeyS' && game.phase === 'move' && !isCurrentPlayerCPU()) {
        const btn = document.getElementById(DOM_IDS.BTN_PASS);
        if (btn && !btn.classList.contains('hidden')) {
            passMove();
        }
    }
    // R: Redo（moveフェーズで有効）
    if (e.code === 'KeyR' && game.phase === 'move' && !isCurrentPlayerCPU()) {
        const btn = document.getElementById(DOM_IDS.BTN_REDO);
        if (btn && !btn.classList.contains('hidden')) {
            redoHang();
        }
    }
    // Escape: Exit確認
    if (e.code === 'Escape') {
        const startOverlay = document.getElementById(DOM_IDS.START_OVERLAY);
        if (startOverlay && startOverlay.classList.contains('hidden')) {
            confirmExit();
        }
    }
});

function startBGM() {
    if (!audioCtx || bgmStarted) return;
    bgmStarted = true;

    bgmGain = audioCtx.createGain();
    bgmGain.gain.value = isMuted ? 0 : CONFIG.BGM_VOLUME;

    // D-1: BGM全体を1つのローパスに通し、つり合いのズレ(tension)でカットオフを動かす。
    // 傾くほど音がこもる = 耳でモーメント差がわかる。
    bgmFilter = audioCtx.createBiquadFilter();
    bgmFilter.type = 'lowpass';
    bgmFilter.frequency.value = AUDIO_CONFIG.BGM_FILTER_FREQUENCY;
    bgmFilter.Q.value = 1;

    bgmGain.connect(bgmFilter);
    bgmFilter.connect(audioCtx.destination);

    // リラックスBGM - ゆったりしたアンビエントサウンド
    const playPad = (freq, time, dur) => {
        const osc = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc2.type = 'sine';
        osc.frequency.value = freq;
        osc2.frequency.value = freq * 1.002; // わずかなデチューンで厚み

        osc.connect(gain);
        osc2.connect(gain);
        gain.connect(bgmGain);

        // フェードイン・アウト
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(AUDIO_CONFIG.BGM_PAD_VOLUME, time + dur * 0.3);
        gain.gain.linearRampToValueAtTime(AUDIO_CONFIG.BGM_PAD_VOLUME, time + dur * 0.7);
        gain.gain.linearRampToValueAtTime(0, time + dur);

        osc.start(time);
        osc2.start(time);
        osc.stop(time + dur);
        osc2.stop(time + dur);
    };

    // ベル風の音（てこ・科学のイメージ）
    const playBell = (freq, time) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.value = freq;

        osc.connect(gain);
        gain.connect(bgmGain);

        gain.gain.setValueAtTime(0.08, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 3);

        osc.start(time);
        osc.stop(time + 3);
    };

    // D-4: 中盤から加わるベースパルス（1小節を4拍で刻む）
    const playBass = (freq, time, dur) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.value = freq;

        osc.connect(gain);
        gain.connect(bgmGain);

        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(AUDIO_CONFIG.BGM_BASS_VOLUME, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

        osc.start(time);
        osc.stop(time + dur);
    };

    // D-4: 終盤に加わるアルペジオ（切迫感）
    const playArp = (freq, time) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'square';
        osc.frequency.value = freq;

        osc.connect(gain);
        gain.connect(bgmGain);

        gain.gain.setValueAtTime(AUDIO_CONFIG.BGM_ARP_VOLUME, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

        osc.start(time);
        osc.stop(time + 0.25);
    };

    // BGMパターン - Cメジャー7系の落ち着いた進行
    const chords = [
        [130.81, 164.81, 196.00], // C E G (Cmaj)
        [146.83, 174.61, 220.00], // D F# A (Dmaj)
        [164.81, 196.00, 246.94], // E G B (Em)
        [130.81, 164.81, 196.00], // C E G (Cmaj)
    ];
    const bells = [523.25, 659.25, 783.99, 659.25]; // 高音のベル

    let chordIndex = 0;

    const bgmLoop = () => {
        if (!audioCtx) return;
        if (isMuted) {
            bgmLoopTimeoutId = setTimeout(bgmLoop, 4000);
            return;
        }

        const now = audioCtx.currentTime;
        const chord = chords[chordIndex % chords.length];
        const stage = getGameStage();

        // パッド音（コード）— 常時
        chord.forEach((freq, i) => {
            playPad(freq, now + i * 0.1, 4);
        });

        // ベル音（メロディ）— 常時
        playBell(bells[chordIndex % bells.length], now + 0.5);
        if (Math.random() > 0.5) {
            playBell(bells[(chordIndex + 2) % bells.length] * 0.5, now + 2);
        }

        // D-4: 中盤以降はベースパルスを重ねる（残り手数が減るほど層が増える）
        if (stage !== 'intro') {
            for (let beat = 0; beat < 4; beat++) {
                playBass(chord[0] / 2, now + beat, 0.45);
            }
        }

        // D-4: 終盤はアルペジオを重ねて切迫感を出す
        if (stage === 'endgame') {
            for (let i = 0; i < 8; i++) {
                playArp(chord[i % chord.length] * 2, now + i * 0.5);
            }
        }

        chordIndex++;
        bgmLoopTimeoutId = setTimeout(bgmLoop, 4000);
    };
    bgmLoop();
}

// BGMループを停止（ページ離脱時などに使用）
function stopBGM() {
    if (bgmLoopTimeoutId) {
        clearTimeout(bgmLoopTimeoutId);
        bgmLoopTimeoutId = null;
    }
}

// ページ離脱時にBGMを停止（メモリリーク防止）
window.addEventListener('beforeunload', stopBGM);

// タイムアウトは timeout-manager.js が一元管理する
// （setCpuTimeout / setRouletteTimeout / setManagedTimeout をimportして使用）

// ==============================
// 音声生成ヘルパー関数（単一責任の原則に従った分割）
// ==============================

/**
 * ランダム化されたバリエーションを計算
 * @returns {{ pitchVar: number, volVar: number }}
 */
function getSoundVariation() {
    return {
        pitchVar: 0.95 + Math.random() * 0.1,  // ±5%
        volVar: 0.9 + Math.random() * 0.2,     // ±10%
    };
}

/**
 * シンプルな音声生成（単一オシレーター）
 */
function playSimpleSound(config, variation) {
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const { pitchVar, volVar } = variation;

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = config.type;

    // 周波数設定
    if (config.freqStart && config.freqEnd) {
        osc.frequency.setValueAtTime(config.freqStart * pitchVar, now);
        osc.frequency.exponentialRampToValueAtTime(config.freqEnd * pitchVar, now + config.freqDuration);
    } else {
        osc.frequency.value = config.frequency * pitchVar;
    }

    // ゲイン設定
    gain.gain.setValueAtTime(config.volume * volVar, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + config.duration);

    osc.start(now);
    osc.stop(now + config.duration);
}

/**
 * バランス達成音（3音のアルペジオ）
 */
function playBalanceSound(variation) {
    const now = audioCtx.currentTime;
    const { pitchVar, volVar } = variation;

    [523.25, 659.25, 783.99].forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = freq * pitchVar;
        g.gain.setValueAtTime(0.15 * volVar, now + i * 0.1);
        g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start(now + i * 0.1);
        o.stop(now + i * 0.1 + 0.3);
    });
}

/**
 * 勝利音（8音のアルペジオファンファーレ）
 */
function playWinSound(variation) {
    const now = audioCtx.currentTime;
    const { pitchVar, volVar } = variation;

    [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98, 2093.00, 1567.98].forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = i < 4 ? 'square' : 'sine';
        o.frequency.value = freq * pitchVar;
        const gainVal = i < 4 ? 0.1 : 0.08;
        g.gain.setValueAtTime(gainVal * volVar, now + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.5);
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start(now + i * 0.12);
        o.stop(now + i * 0.12 + 0.5);
    });
}

/**
 * D-2: つり合いへ「あと少し」を知らせるベル音
 * BGMのローパスを通さず destination へ直結し、傾いていても必ず聞こえるようにする
 */
function playNearBalanceSound(variation) {
    const now = audioCtx.currentTime;
    const { pitchVar, volVar } = variation;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.value = FEEDBACK_CONFIG.NEAR_BALANCE_BELL_FREQUENCY * pitchVar;

    gain.gain.setValueAtTime(0.1 * volVar, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.6);
}

/**
 * ゲームオーバー音（悲しい下降和音）
 */
function playGameOverSound(variation) {
    const now = audioCtx.currentTime;
    const { pitchVar, volVar } = variation;

    [196.00, 233.08, 293.66].forEach((freq) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(freq * pitchVar, now);
        o.frequency.exponentialRampToValueAtTime(freq * 0.5 * pitchVar, now + 1.0);
        g.gain.setValueAtTime(0.12 * volVar, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 1.0);
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start(now);
        o.stop(now + 1.0);
    });
}

/**
 * 音声設定マップ（Data-Driven Approach）
 */
const SOUND_CONFIGS = {
    drop: { type: 'sine', freqStart: 400, freqEnd: 200, freqDuration: 0.1, volume: 0.2, duration: AUDIO_CONFIG.SFX_DROP_DURATION },
    move: { type: 'triangle', freqStart: 300, freqEnd: 500, freqDuration: 0.1, volume: 0.2, duration: 0.12 },
    lose: { type: 'sawtooth', freqStart: 150, freqEnd: 40, freqDuration: 0.3, volume: 0.25, duration: 0.3 },
    turn: { type: 'sine', frequency: 880, volume: 0.08, duration: 0.1 },
    click: { type: 'square', frequency: 1000, volume: 0.05, duration: 0.05 },
    select: { type: 'sine', frequency: AUDIO_CONFIG.SFX_SELECT_FREQUENCY, volume: 0.1, duration: 0.08 },
    error: { type: 'sawtooth', freqStart: 200, freqEnd: 150, freqDuration: AUDIO_CONFIG.SFX_ERROR_DURATION, volume: 0.12, duration: AUDIO_CONFIG.SFX_ERROR_DURATION },
    phase: { type: 'triangle', freqStart: 440, freqEnd: 880, freqDuration: 0.12, volume: 0.1, duration: AUDIO_CONFIG.SFX_PHASE_DURATION },
};

/**
 * 音声再生メイン関数（ルーティングのみ）
 * @param {string} type - 音声タイプ
 */
function playSound(type) {
    if (!audioCtx || isMuted) return;

    // iOS PWA: suspended状態なら音を出さない（initAudioでアンロック処理）
    if (audioCtx.state === 'suspended') {
        return;
    }

    const variation = getSoundVariation();

    // 複雑な音声（複数オシレーター）
    if (type === 'balance') {
        playBalanceSound(variation);
        return;
    }
    if (type === 'win') {
        playWinSound(variation);
        return;
    }
    if (type === 'gameover') {
        playGameOverSound(variation);
        return;
    }
    if (type === 'near') {
        playNearBalanceSound(variation);
        return;
    }

    // シンプルな音声（設定から生成）
    const config = SOUND_CONFIGS[type];
    if (config) {
        playSimpleSound(config, variation);
    }
}


function toggleSound() {
    isMuted = !isMuted;
    if (bgmGain) {
        bgmGain.gain.value = isMuted ? 0 : CONFIG.BGM_VOLUME;
    }
    updateHeaderSoundBtn();
    // スタート画面のボタンは存在しないので不要
}

// ==============================
// 画面エフェクト
// ==============================
/**
 * 画面フラッシュエフェクトを表示
 * @param {string} type - フラッシュのタイプ ('win', 'lose', 'balance')
 */
function showScreenFlash(type) {
    const flash = document.getElementById(DOM_IDS.SCREEN_FLASH);
    if (!flash) return;
    flash.className = `screen-flash ${  type  } active`;
    setManagedTimeout(() => {
        if (flash) flash.classList.remove('active');
    }, CONFIG.SCREEN_FLASH_DURATION);
}

// showComboTextのタイムアウトID（連続呼び出し時の競合防止）
let comboTimeoutId1 = null;
let comboTimeoutId2 = null;

/**
 * コンボテキストをアニメーション表示
 * @param {string} text - 表示するテキスト
 * @param {string} color - テキストの色（CSS形式）
 * @param {number} [duration=500] - フェードアウトまでの表示時間(ms)
 */
function showComboText(text, color, duration = 500) {
    if (!text) return;
    const combo = document.getElementById(DOM_IDS.COMBO_TEXT);
    if (!combo) return;

    // 前のタイムアウトをキャンセル
    if (comboTimeoutId1) clearTimeout(comboTimeoutId1);
    if (comboTimeoutId2) clearTimeout(comboTimeoutId2);

    // 即座にリセットしてから新しいアニメーション開始
    combo.style.transition = 'none';
    combo.textContent = text;
    combo.style.color = color;
    combo.style.opacity = 1;
    combo.style.transform = 'translate(-50%, -50%) scale(1.5)';

    // 表示時間後にフェードアウト開始
    const fadeStartDelay = Math.max(100, duration - 400);
    comboTimeoutId1 = setTimeout(() => {
        if (!combo) return;
        combo.style.transition = 'all 0.5s ease-out';
        combo.style.opacity = 0;
        combo.style.transform = 'translate(-50%, -50%) scale(2) translateY(-50px)';
    }, fadeStartDelay);

    comboTimeoutId2 = setTimeout(() => {
        if (combo) combo.style.transition = 'none';
        comboTimeoutId1 = null;
        comboTimeoutId2 = null;
    }, duration);
}

// 紙吹雪エフェクト（勝利演出用）
/**
 * 紙吹雪エフェクトを生成
 * @param {number} [count=CONFIG.CONFETTI_COUNT] - 紙吹雪の数
 */
function createConfetti(count = CONFIG.CONFETTI_COUNT) {
    const colors = [
        hexToCSS(COLORS.BLUE.primary),
        hexToCSS(COLORS.YELLOW.primary),
        hexToCSS(COLORS.RED.primary),
        hexToCSS(COLORS.GREEN.primary),
        UI_COLORS.MAGENTA,
        UI_COLORS.WHITE,
    ];
    const container = document.body;
    if (!container) return;

    // DocumentFragmentで一括DOM追加（パフォーマンス最適化）
    const fragment = document.createDocumentFragment();
    const confettiElements = [];

    for (let i = 0; i < count; i++) {
        const confetti = document.createElement('div');
        confetti.style.cssText = `
            position: fixed;
            width: ${6 + Math.random() * 8}px;
            height: ${6 + Math.random() * 8}px;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            left: ${Math.random() * 100}vw;
            top: -20px;
            opacity: 1;
            pointer-events: none;
            z-index: 10000;
            border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
            transform: rotate(${Math.random() * 360}deg);
        `;
        fragment.appendChild(confetti);
        confettiElements.push({
            el: confetti,
            duration: 2500 + Math.random() * 1500,
            horizontalDrift: (Math.random() - 0.5) * 200,
            rotation: Math.random() * 720 - 360,
        });
    }

    // 一括追加
    container.appendChild(fragment);

    // アニメーション開始（DOM追加後）
    confettiElements.forEach(({ el, duration, horizontalDrift, rotation }) => {
        el.animate([
            {
                transform: `translateY(0) translateX(0) rotate(0deg)`,
                opacity: 1,
            },
            {
                transform: `translateY(100vh) translateX(${horizontalDrift}px) rotate(${rotation}deg)`,
                opacity: 0.3,
            },
        ], {
            duration: duration,
            easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }).onfinish = () => el.remove();
    });
}

// ==============================
// ゲーム状態
// ==============================
const game = {
    mode: 'cpu1',           // 'cpu1', 'pvp2', 'pvp3', 'pvp4'
    playerCount: 2,         // 2〜4人
    humanCount: 1,          // 人間プレイヤー数
    turn: 'blue',
    turnIndex: 0,           // PLAYER_ORDER内のインデックス
    phase: 'hang',
    blue:   { stock: 0, eliminated: false },
    yellow: { stock: 0, eliminated: false },
    red:    { stock: 0, eliminated: false },
    green:  { stock: 0, eliminated: false },
    activePlayers: [],      // 生存プレイヤー
    leverData: {},
    isOver: false,
    isJudging: false,       // 判定中フラグ（競合状態防止）
    selectedWeight: null,
    isDragging: false,
    turnCount: 0,
    currentTurnHungPos: null,
    currentTurnHungOwner: null,
};

// 駒配分設定（常に4人プレイ、各4個ずつ=16個）
// humanCount でCPU/人間の区別のみ変わる
const DISTRIBUTIONS = {
    4: { blue: 4, yellow: 4, red: 4, green: 4 },
};

// ==============================
// 演出フィードバック（D-1〜D-5）
//
// 設計方針: 演出は物理量の可視化・可聴化であって装飾ではない。
// 音・カメラ・光をすべて tension（つり合いのズレ）と残り手数から導出する。
// ==============================

/** つり合いのズレ 0〜1（0=つり合い, 1=限界まで傾いている）*/
let targetTension = 0;
let currentTension = 0;
const TENSION_LERP = 0.06;

/** つり合いに「あと少し」の状態か */
let isNearBalance = false;
let wasNearBalance = false;

/** 演出用の一時的なFOVオフセット（updateCameraPositionが毎フレーム加算する）*/
let dramaticFovOffset = 0;

/** 脱落演出で支点に寄っている終了時刻 */
let eliminationFocusUntil = 0;

/** BGMカットオフ更新の間引き用カウンター */
let bgmTensionFrameCount = 0;
const BGM_TENSION_UPDATE_INTERVAL = 10;

/**
 * ゲームの進行段階を返す（BGMの層とカメラの寄りに使う）
 * 残りストックが少ない＝決着が近い、を唯一の根拠にする
 * @returns {'intro'|'midgame'|'endgame'} 進行段階
 */
function getGameStage() {
    if (game.isOver || game.activePlayers.length === 0) return 'intro';

    const remainingStock = game.activePlayers.reduce((sum, p) => sum + game[p].stock, 0);

    if (remainingStock <= FEEDBACK_CONFIG.ENDGAME_STOCK_THRESHOLD || game.activePlayers.length <= 2) {
        return 'endgame';
    }
    if (remainingStock <= FEEDBACK_CONFIG.MIDGAME_STOCK_THRESHOLD) {
        return 'midgame';
    }
    return 'intro';
}

/**
 * 演出用のFOVオフセットを一定時間かける
 * 毎フレーム targetFov を上書きする updateCameraPosition と競合しないようにするため、
 * 直接 targetFov を書き換えるのではなくオフセットとして保持する
 * @param {number} offset - FOVオフセット(度)
 * @param {number} duration - 継続時間(ms)
 */
function setDramaticFov(offset, duration) {
    dramaticFovOffset = offset;
    setManagedTimeout(() => {
        dramaticFovOffset = 0;
    }, duration);
}

/**
 * D-5: 脱落時に支点へ寄り、どちら側が重かったかを見せる
 */
function triggerEliminationFocus() {
    eliminationFocusUntil = Date.now() + FEEDBACK_CONFIG.ELIMINATION_DOLLY_DURATION;
    setDramaticFov(FEEDBACK_CONFIG.ELIMINATION_DOLLY_FOV, FEEDBACK_CONFIG.ELIMINATION_DOLLY_DURATION);
}

/**
 * D-1: BGMのローパスカットオフを tension に追従させる
 * 傾くほど音がこもる（= 耳でモーメント差がわかる）
 */
function updateBgmTension() {
    if (!bgmFilter || !audioCtx || audioCtx.state !== 'running') return;

    const range = AUDIO_CONFIG.BGM_FILTER_FREQUENCY - FEEDBACK_CONFIG.BGM_FILTER_MIN_FREQUENCY;
    const target = AUDIO_CONFIG.BGM_FILTER_FREQUENCY - currentTension * range;

    // setTargetAtTime で滑らかに追従させる（値の直接代入はノイズの原因になる）
    bgmFilter.frequency.setTargetAtTime(target, audioCtx.currentTime, 0.2);
}

// ==============================
// CPU性格システム
// ==============================
const CPU_PERSONALITIES = {
    // 安全策タイプ：内側（位置1-3）を好む、失敗率低い
    // 戦略：生き残り重視、ポイント差が大きく開いた時だけ妨害
    safe: {
        name: '慎重派',
        emoji: '🛡️',
        preferInner: true,      // 内側を好む
        riskTolerance: 0.2,     // リスク許容度（低い）
        mistakeRate: 0.01,      // 失敗率1%（より堅実に）
        outerAvoidance: CPU_CONFIG.OUTER_AVOIDANCE_HIGH,    // 外側回避率（高い）
        moveSkipRate: 0.3,      // 移動スキップ率（安全に済ませる）
        sabotageThreshold: 40,  // 妨害を検討するポイント差
        defensivePriority: 0.9, // 守備優先度（高い＝自分のバランス重視）
        thinkingDelay: 1000,     // 長考タイプ
    },
    // 普通タイプ：バランス型
    // 戦略：状況に応じて攻守を切り替え、適度に妨害
    normal: {
        name: 'バランス派',
        emoji: '⚖️',
        preferInner: false,
        riskTolerance: 0.5,
        mistakeRate: 0.06,      // 失敗率6%
        outerAvoidance: 0.4,
        moveSkipRate: CPU_CONFIG.MOVE_SKIP_RATE_LOW,
        sabotageThreshold: 25,  // 25pt差から妨害開始
        defensivePriority: 0.6, // 攻守バランス
        thinkingDelay: CPU_CONFIG.THINKING_DELAY_SLOW,      // 標準
    },
    // リスクテイカー：外側（位置4-6）を狙う、失敗率高め
    // 戦略：積極的に1位を狙い撃ち、高リスク高リターン
    risky: {
        name: '攻撃派',
        emoji: '🔥',
        preferInner: false,
        riskTolerance: CPU_CONFIG.RISK_TOLERANCE_HIGH,     // リスク許容度（高い）
        mistakeRate: 0.12,      // 失敗率12%
        outerAvoidance: 0.1,    // 外側回避しない
        moveSkipRate: 0.02,     // より積極的に移動する
        sabotageThreshold: 5,   // わずかな差でも妨害（攻撃的）
        defensivePriority: 0.3, // 攻撃優先
        thinkingDelay: CPU_CONFIG.THINKING_DELAY_FAST,      // 即断即決
    },
};

// 各CPUプレイヤーに性格を割り当て
const cpuPersonalities = {
    yellow: 'safe',    // P2: 慎重派
    red: 'risky',      // P3: 攻撃派
    green: 'normal',    // P4: バランス派
};

// 初期配置：中立おもり（owner: 'neutral'）を±3に配置
// モーメント: 3×10 = 3×10 → 30 = 30 で常にバランス

const allPositions = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

let scene, camera, renderer, leverGroup, pivotGroup;
let pivotGlowRing = null;  // 支点のリング（つり合い状態のインジケータ）
const ghosts = {};
let weightMeshes = [];
let ghostsArray = [];  // ghostsの配列キャッシュ（animate用）
let weightGroups = {};  // 位置ごとにグループ化されたおもり（パフォーマンス最適化用）
let weightGroupsKeys = [];  // weightGroupsのキーキャッシュ（animate用）
let stockWeightsArray = [];  // ストックおもりの配列キャッシュ
let rebuildTimeout = null;  // rebuildWeights debounce用タイマー
const rebuildCallbacks = [];  // 再構築完了後に実行する処理のキュー
const REBUILD_DEBOUNCE_MS = 50;  // 再構築のデバウンス時間
let raycaster, mouse;
let leverAngle = 0, targetLeverAngle = 0;
const cameraShake = { x: 0, y: 0, intensity: 0 };
let cameraBaseY = 5; // onResizeで更新
let cameraBaseZ = 14; // onResizeで更新
let cameraBaseFov = 65; // 基準FOV（動的調整用）
let targetFov = 65; // 目標FOV（アクション時に変化）
let currentFov = 65; // 現在のFOV（補間用）
let userFovOffset = 0; // ユーザー設定のFOVオフセット（-10〜+10度）
let currentLookAtY = -0.5; // 現在のlookAtターゲットY座標（補間用）
let currentLookAtX = 0;    // 現在のlookAtターゲットX座標（補間用）
const stockWeights = { blue: null, yellow: null, red: null, green: null };
let draggedStock = null;
let dragPlane = null;
let hoveredGhost = null;
const weightPhysics = {};

// パフォーマンス最適化: 再利用可能なVector3（initThree()で初期化）
let reusableIntersectPoint = null;

// パフォーマンス最適化: ゴーストのヒットテストをヘルパー関数化（重複コード削減）
function raycastVisibleGhosts() {
    const visibleGhosts = Object.values(ghosts).filter(g => g.visible);
    const hitboxes = visibleGhosts.map(g => g.hitbox);
    const hits = raycaster.intersectObjects(hitboxes);
    return { visibleGhosts, hits };
}

// 物理定数
const PHYSICS = {
    G: 9.8,              // 重力加速度 [m/s²]
    ROPE_LEN: 0.5,       // ロープ長 [m]
    SPHERE_R: 0.42,      // おもり半径
    DT: 1/60,            // 時間ステップ
    UNIT: 1.4,           // 位置1あたりの距離 [m]
    MAX_TILT: 0.5,       // 最大傾斜 [rad]（約29度）
    // てこの傾き計算
    TILT_SCALE: 0.003,   // モーメント差 → 角度の変換係数
    LEVER_SPEED: 0.04,   // 補間速度（目標角度への追従速度）
    // 振り子の物理パラメータ
    PEND_DAMP: 0.992,    // 振り子の減衰（自然な空気抵抗）
    PEND_INERTIA_COEF: 0.05,  // 振り子の慣性力係数
};

// ドラッグ制限定数
const DRAG_LIMITS = {
    X_MIN: -10,    // X軸最小値（てこの範囲-8.5より少し広め）
    X_MAX: 10,     // X軸最大値（てこの範囲8.5より少し広め）
    Y_MIN: -6,     // Y軸最小値（てこの下）
    Y_MAX: 3.5,     // Y軸最大値（ストック位置より少し上）
};

// カメラ動的調整定数
const CAMERA_DYNAMICS = {
    STACK_THRESHOLD: 3,      // カメラ調整が開始されるスタック数
    Z_DISTANCE_PER_STACK: 1.2,  // スタック1つあたりのZ軸距離増加量
    Y_OFFSET_PER_STACK: 0.3,    // スタック1つあたりのY軸オフセット
    POSITION_LERP_Z: 0.15,   // カメラZ位置の補間係数（後ろに引く）
    POSITION_LERP_Y: 0.08,   // カメラY位置の補間係数（下げる：よりゆっくり）
    LOOKAT_LERP: 0.06,       // lookAtターゲットの補間係数（さらにゆっくり）
    FOV_LERP: 0.15,          // FOVの補間係数
    FOV_ZOOM_IN: -8,         // ドラッグ時のFOVオフセット（度）
    FOV_UPDATE_THRESHOLD: 0.01,  // updateProjectionMatrixを呼ぶ最小変化量
    LOOKAT_Y_NORMAL: -0.5,   // 通常時のlookAtターゲットY座標
    LOOKAT_Y_STACKED: -1.5,  // スタック多い時のlookAtターゲットY座標
    DRAG_FOLLOW_X: CAMERA_CONFIG.DRAG_FOLLOW_X,      // ドラッグ時のX軸追従率（30%）
    DRAG_FOLLOW_Y: 0.5,       // ドラッグ時のY軸追従率（50%）
};

// てこの角速度（状態変数）
let leverAngularVelocity = 0;

// ==============================
// クリーンアップ管理（メモリリーク対策）
// ==============================
let eventAbortController = null;  // イベントリスナーのAbortController（2025ベストプラクティス）
let resizeObserver = null;        // ResizeObserver参照

/**
 * Three.jsとイベントリスナーのクリーンアップ
 * メモリリーク防止のため、ゲーム終了時やページ離脱時に呼び出す
 */
function cleanupThree() {
    // イベントリスナーのクリーンアップ（AbortController使用）
    if (eventAbortController) {
        eventAbortController.abort();
        eventAbortController = null;
    }

    // ResizeObserverのクリーンアップ
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }

    // タイムアウトのクリーンアップ（メモリリーク防止）
    clearAllCpuTimeouts();
    clearAllRouletteTimeouts();
    clearAllManagedTimeouts();
    // 保留中の再構築を破棄（破棄済みのleverGroupに触れないようにする）
    rebuildTimeout = null;
    rebuildCallbacks.length = 0;
    if (bgmLoopTimeoutId) {
        clearTimeout(bgmLoopTimeoutId);
        bgmLoopTimeoutId = null;
    }

    // Three.jsリソースのクリーンアップ
    if (scene) {
        scene.traverse(object => {
            if (object.geometry) {
                object.geometry.dispose();
            }
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(material => material.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });
    }

    if (renderer) {
        renderer.dispose();
        renderer = null;
    }

    threeInitialized = false;
}

// ページ離脱時のクリーンアップ（メモリリーク防止）
window.addEventListener('beforeunload', cleanupThree);

// ==============================
// Three.js初期化（エラーハンドリング強化）
// ==============================
let threeInitialized = false;  // 重複初期化防止フラグ

/**
 * WebGL機能検出（2025ベストプラクティス）
 * @returns {boolean} WebGLが利用可能かどうか
 */
function isWebGLAvailable() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        return !!gl;
    } catch {
        return false;
    }
}

/**
 * WebGL未対応時のエラー表示
 */
function showWebGLError() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;

    canvas.style.display = 'none';

    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 51, 102, 0.95);
        color: white;
        padding: 30px;
        border-radius: 12px;
        text-align: center;
        max-width: 400px;
        z-index: 10000;
        font-family: 'M PLUS Rounded 1c', sans-serif;
    `;
    errorDiv.innerHTML = `
        <h2 style="margin: 0 0 16px 0; font-size: 24px;">⚠️ WebGL未対応</h2>
        <p style="margin: 0 0 12px 0; line-height: 1.6;">
            お使いのブラウザまたはデバイスは3D描画（WebGL）に対応していません。
        </p>
        <p style="margin: 0; line-height: 1.6; font-size: 14px; opacity: 0.9;">
            💡 最新のChromeまたはSafariをお試しください。
        </p>
    `;
    document.body.appendChild(errorDiv);
}

/**
 * レンダラーとカメラのセットアップ（SRP: レンダリング設定の責任）
 * @param {HTMLElement} canvas - キャンバス要素
 * @returns {{ w: number, h: number, isMobile: boolean }}
 */
function setupRenderer(canvas) {
    const rect = canvas.getBoundingClientRect();
    let w = rect.width;
    let h = rect.height;

    // CSSデフォルト値または異常に小さい場合はwindow sizeを使用
    if (w <= 300 || h <= 150) {
        w = window.innerWidth;
        h = window.innerHeight;
    }

    // モバイル判定とpixelRatio調整
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || w < 768;
    const pixelRatio = isMobile ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2);

    // シーン作成
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a2040);
    addBackgroundParticles();

    // カメラ設定
    const aspect = w / h;
    const { z: optZ, fov: optFov, baseY: optY } = calculateOptimalCamera(w, h, aspect);
    camera = new THREE.PerspectiveCamera(optFov, aspect, 0.1, 1000);
    camera.position.set(0, optY, optZ);
    camera.lookAt(0, -0.5, 0);
    cameraBaseY = optY;
    cameraBaseZ = optZ;
    cameraBaseFov = optFov;
    targetFov = optFov;
    currentFov = optFov;
    currentLookAtY = -0.5;
    currentLookAtX = 0;

    // レンダラー設定
    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: !isMobile,
        powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    return { w, h, isMobile };
}

/**
 * ライティング設定（SRP: 照明の責任）
 */
function setupLighting() {
    // 環境光
    scene.add(new THREE.AmbientLight(0x8899bb, RENDER_CONFIG.AMBIENT_LIGHT_INTENSITY));

    // メインライト（45度の角度で立体感を最大化）
    const mainLight = new THREE.DirectionalLight(0xffffff, 2.0);
    mainLight.position.set(12, 18, 16);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.left = -20;
    mainLight.shadow.camera.right = 20;
    mainLight.shadow.camera.top = 20;
    mainLight.shadow.camera.bottom = -20;
    scene.add(mainLight);

    // リムライト
    const rimLight = new THREE.DirectionalLight(0xaaccff, 0.8);
    rimLight.position.set(-15, 10, -8);
    scene.add(rimLight);

    // アクセントライト
    const cyanLight = new THREE.PointLight(0x00ddff, 1.8, 35);
    cyanLight.position.set(-12, 6, 10);
    scene.add(cyanLight);

    const pinkLight = new THREE.PointLight(0xff8899, 1.8, 35);
    pinkLight.position.set(12, 6, 10);
    scene.add(pinkLight);

    // フィルライト
    const fillLight = new THREE.PointLight(0xaabbcc, 1.0, 30);
    fillLight.position.set(0, -3, 12);
    scene.add(fillLight);
}

/**
 * 床とグリッドの設定（SRP: 環境の責任）
 */
function setupFloorAndGrid() {
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 40),
        new THREE.MeshStandardMaterial({ color: 0x1a1a30, roughness: 0.8 }),
    );
    floor.rotation.x = -Math.PI/2;
    floor.position.y = -14;
    floor.receiveShadow = true;
    scene.add(floor);

    const gridHelper = new THREE.GridHelper(50, 50, COLORS.BLUE.primary, 0x2a2a50);
    gridHelper.position.y = -13.95;
    gridHelper.material.opacity = 0.5;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);
}

/**
 * 支点構造の設定（SRP: 支点の責任）
 */
function setupPivotStructure() {
    pivotGroup = new THREE.Group();
    scene.add(pivotGroup);

    const basePlate = new THREE.Mesh(
        new THREE.CylinderGeometry(1.8, 1.8, 0.15, 48),
        new THREE.MeshStandardMaterial({ color: 0x4a4a6a, metalness: 0.9, roughness: 0.2 }),
    );
    basePlate.position.y = -12.5;
    pivotGroup.add(basePlate);

    const baseGlow = new THREE.Mesh(
        new THREE.TorusGeometry(1.8, 0.06, 16, 64),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 1.0 }),
    );
    baseGlow.rotation.x = Math.PI / 2;
    baseGlow.position.y = -12.42;
    pivotGroup.add(baseGlow);
    // D-2: つり合い状態を示すインジケータとして参照を保持する
    pivotGlowRing = baseGlow;

    const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.2, 12.2, 24),
        new THREE.MeshStandardMaterial({ color: 0x6a6a8a, metalness: 0.9, roughness: 0.1 }),
    );
    pillar.position.y = -6.3;
    pivotGroup.add(pillar);

    const pivotTop = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 0.8, 3),
        new THREE.MeshStandardMaterial({ color: 0x7a7a9a, metalness: 0.9, roughness: 0.1 }),
    );
    pivotTop.position.y = 0.1;
    pivotTop.rotation.y = Math.PI / 6;
    pivotGroup.add(pivotTop);
}

/**
 * てこの設定（SRP: てこの責任）
 */
function setupLeverBeam() {
    leverGroup = new THREE.Group();
    leverGroup.position.y = 0.5;
    scene.add(leverGroup);

    const leverBeam = new THREE.Mesh(
        new THREE.BoxGeometry(17, 0.25, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.8, roughness: 0.2 }),
    );
    leverBeam.castShadow = true;
    leverGroup.add(leverBeam);

    const topGlowCenter = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.02, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.9 }),
    );
    topGlowCenter.position.y = 0.14;
    leverGroup.add(topGlowCenter);

    const topGlowLeft = new THREE.Mesh(
        new THREE.BoxGeometry(6.5, 0.02, 0.3),
        new THREE.MeshBasicMaterial({ color: COLORS.BLUE.primary, transparent: true, opacity: 0.7 }),
    );
    topGlowLeft.position.set(-5, 0.14, 0);
    leverGroup.add(topGlowLeft);

    const topGlowRight = new THREE.Mesh(
        new THREE.BoxGeometry(6.5, 0.02, 0.3),
        new THREE.MeshBasicMaterial({ color: COLORS.RED.primary, transparent: true, opacity: 0.7 }),
    );
    topGlowRight.position.set(5, 0.14, 0);
    leverGroup.add(topGlowRight);

    const leftEnd = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 24, 24),
        new THREE.MeshStandardMaterial({
            color: COLORS.BLUE.bright, emissive: 0x0088aa, emissiveIntensity: 0.5, metalness: 0.9, roughness: 0.1,
        }),
    );
    leftEnd.position.set(-8.5, 0, 0);
    leverGroup.add(leftEnd);

    const rightEnd = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 24, 24),
        new THREE.MeshStandardMaterial({
            color: COLORS.RED.primary, emissive: 0xaa2244, emissiveIntensity: 0.5, metalness: 0.9, roughness: 0.1,
        }),
    );
    rightEnd.position.set(8.5, 0, 0);
    leverGroup.add(rightEnd);
}

/**
 * ゴーストの設定（SRP: インタラクション表示の責任）
 */
function setupGhosts() {
    allPositions.forEach(pos => {
        const ghost = createGhost(pos);
        ghost.position.set(pos * 1.4, -0.8, 0);
        ghost.visible = false;
        leverGroup.add(ghost);
        ghosts[pos] = ghost;
    });
    ghostsArray = Object.values(ghosts);
}

/**
 * イベントリスナーの設定（SRP: イベント管理の責任）
 * @param {HTMLElement} canvas - キャンバス要素
 */
function setupEventListeners(canvas) {
    eventAbortController = new AbortController();
    const { signal } = eventAbortController;

    canvas.addEventListener('pointerdown', onPointerDown, { passive: false, signal });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false, signal });
    canvas.addEventListener('pointerup', onPointerUp, { passive: false, signal });
    canvas.addEventListener('pointercancel', onPointerUp, { passive: false, signal });
    window.addEventListener('resize', onResize, { passive: true, signal });

    // ResizeObserver（iOS PWA対応）
    if (typeof ResizeObserver !== 'undefined') {
        let resizeTimeout;
        resizeObserver = new ResizeObserver(() => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(onResize, 100);
        });
        resizeObserver.observe(canvas);
    }
}

/**
 * Three.js初期化のメイン関数（SRP: オーケストレーションの責任）
 * 各setup関数を呼び出して初期化を調整
 */
function initThree() {
    // 重複初期化防止
    if (threeInitialized) {
        console.warn('initThree() called multiple times, skipping');
        return false;
    }

    // WebGL機能検出
    if (!isWebGLAvailable()) {
        console.error('WebGL is not supported on this device');
        showWebGLError();
        return false;
    }

    const canvas = document.getElementById('game-canvas');
    if (!canvas) {
        console.error('Canvas element not found!');
        return false;
    }

    try {
        setupRenderer(canvas);
        setupLighting();
        setupFloorAndGrid();
        setupPivotStructure();
        setupLeverBeam();
        setupGhosts();

        dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        reusableIntersectPoint = new THREE.Vector3();

        createPositionLabels();
        createStockWeights();

        setupEventListeners(canvas);

        setTimeout(onResize, 100);

        threeInitialized = true;
        animate();
        return true;

    } catch (error) {
        logError(error, { phase: 'initThree' });

        if (canvas) canvas.style.display = 'none';

        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255, 51, 102, 0.95);
            color: white;
            padding: 30px;
            border-radius: 12px;
            text-align: center;
            max-width: 400px;
            z-index: 10000;
            font-family: 'M PLUS Rounded 1c', sans-serif;
        `;
        errorDiv.innerHTML = `
            <h2 style="margin: 0 0 16px 0; font-size: 24px;">⚠️ 初期化エラー</h2>
            <p style="margin: 0 0 12px 0; line-height: 1.6;">
                3D描画の初期化に失敗しました。
            </p>
            <p style="margin: 0; line-height: 1.6; font-size: 14px; opacity: 0.9;">
                💡 ページを再読み込みしてください。
            </p>
        `;
        document.body.appendChild(errorDiv);

        return false;
    }
}

function createStockWeights() {
    // 既存のストックを削除（メモリ解放含む）
    PLAYER_ORDER.forEach(player => {
        if (stockWeights[player]) {
            scene.remove(stockWeights[player]);
            disposeObject(stockWeights[player]);
            stockWeights[player] = null;
        }
    });
    stockWeightsArray = [];  // 配列キャッシュをクリア

    PLAYER_ORDER.forEach(player => {
        if (game[player].eliminated) return;

        const colorKey = player.toUpperCase();
        const stock = createStockWeight(player, COLORS[colorKey].bright);
        const pos = STOCK_POSITIONS[player];
        stock.position.set(pos.x, pos.y, pos.z);
        scene.add(stock);
        stockWeights[player] = stock;
        stockWeightsArray.push(stock);  // 配列キャッシュに追加
    });

    updateStockWeightsVisibility();
}

function createStockWeight(owner, color) {
    const group = new THREE.Group();
    group.userData = { type: 'stock', owner: owner };

    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 24, 24),
        new THREE.MeshStandardMaterial({
            color: color, emissive: color, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.3,
        }),
    );
    group.add(sphere);

    const hitbox = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 12, 12),
        new THREE.MeshBasicMaterial({ visible: false }),
    );
    group.add(hitbox);
    group.hitbox = hitbox;

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.6, 0.05, 12, 32),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8 }),
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const canvas2d = document.createElement('canvas');
    canvas2d.width = 256;
    canvas2d.height = 64;
    const ctx = canvas2d.getContext('2d');
    const ownerColorSet = COLORS[owner.toUpperCase()] || COLORS.BLUE;
    ctx.fillStyle = `#${  ownerColorSet.bright.toString(16).padStart(6, '0')}`;
    ctx.font = 'bold 36px "M PLUS Rounded 1c", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HANG!', 128, 32);
    const texture = new THREE.CanvasTexture(canvas2d);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    label.scale.set(1.8, 0.5, 1);
    label.position.y = -1;
    group.add(label);

    group.sphere = sphere;
    return group;
}

function updateStockWeightsVisibility() {
    const currentPlayer = game.turn;
    PLAYER_ORDER.forEach(player => {
        if (stockWeights[player]) {
            const show = game.phase === 'hang' &&
                         currentPlayer === player &&
                         game[player].stock > 0 &&
                         !game[player].eliminated;
            stockWeights[player].visible = show;
        }
    });
}

function createGhost(pos) {
    const group = new THREE.Group();
    group.userData = { type: 'ghost', pos: pos };

    const isLeft = pos < 0;
    const baseColor = isLeft ? COLORS.BLUE.primary : COLORS.RED.primary;

    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 24, 24),
        new THREE.MeshStandardMaterial({
            color: baseColor, transparent: true, opacity: 0.3, emissive: baseColor, emissiveIntensity: 0.2,
        }),
    );
    group.add(sphere);

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.04, 12, 32),
        new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.5 }),
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const labelNum = Math.abs(pos);
    const canvas2d = document.createElement('canvas');
    canvas2d.width = 64;
    canvas2d.height = 64;
    const ctx = canvas2d.getContext('2d');
    ctx.fillStyle = isLeft ? UI_COLORS.CANVAS_LEFT : UI_COLORS.CANVAS_RIGHT;
    ctx.font = 'bold 48px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelNum.toString(), 32, 32);

    const labelTexture = new THREE.CanvasTexture(canvas2d);
    const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: labelTexture, transparent: true, opacity: 0.9 }),
    );
    label.scale.set(0.5, 0.5, 1);
    label.position.y = 0.65;
    group.add(label);

    const hitbox = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 12, 12),
        new THREE.MeshBasicMaterial({ visible: false }),
    );
    group.add(hitbox);

    // 満杯時の×マーク
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = 64;
    fullCanvas.height = 64;
    const fullCtx = fullCanvas.getContext('2d');
    fullCtx.strokeStyle = UI_COLORS.CANVAS_BORDER;
    fullCtx.lineWidth = 8;
    fullCtx.lineCap = 'round';
    fullCtx.beginPath();
    fullCtx.moveTo(16, 16);
    fullCtx.lineTo(48, 48);
    fullCtx.moveTo(48, 16);
    fullCtx.lineTo(16, 48);
    fullCtx.stroke();

    const fullTexture = new THREE.CanvasTexture(fullCanvas);
    const fullMark = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: fullTexture, transparent: true, opacity: 0.9 }),
    );
    fullMark.scale.set(0.7, 0.7, 1);
    fullMark.position.y = 0;
    fullMark.visible = false;
    group.add(fullMark);

    group.sphere = sphere;
    group.ring = ring;
    group.hitbox = hitbox;
    group.fullMark = fullMark;
    group.baseColor = baseColor;

    return group;
}

function createPositionLabels() {
    allPositions.forEach(pos => {
        const isLeft = pos < 0;
        const labelNum = Math.abs(pos);
        const canvas2d = document.createElement('canvas');
        canvas2d.width = 64;
        canvas2d.height = 64;
        const ctx = canvas2d.getContext('2d');
        ctx.fillStyle = isLeft ? hexToRGBA(UI_COLORS.CANVAS_LEFT, 0.6) : hexToRGBA(UI_COLORS.CANVAS_RIGHT, 0.6);
        ctx.font = 'bold 48px Orbitron, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelNum.toString(), 32, 32);

        const labelTexture = new THREE.CanvasTexture(canvas2d);
        const label = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: labelTexture, transparent: true }),
        );
        label.scale.set(0.5, 0.5, 1);
        label.position.set(pos * 1.4, 0.35, 0);
        leverGroup.add(label);
    });
}

function addBackgroundParticles() {
    const particleCount = CONFIG.BACKGROUND_PARTICLE_COUNT;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * CONFIG.BACKGROUND_PARTICLE_X_RANGE;
        positions[i * 3 + 1] = (Math.random() - 0.5) * CONFIG.BACKGROUND_PARTICLE_Y_RANGE;
        positions[i * 3 + 2] = (Math.random() - 0.5) * CONFIG.BACKGROUND_PARTICLE_Z_RANGE
            + CONFIG.BACKGROUND_PARTICLE_Z_OFFSET;

        const color = Math.random() > 0.5 ? new THREE.Color(COLORS.BLUE.primary) : new THREE.Color(COLORS.RED.primary);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const particles = new THREE.Points(geometry, new THREE.PointsMaterial({
        size: 0.15, vertexColors: true, transparent: true, opacity: 0.6,
    }));
    scene.add(particles);
}

// ==============================
// イベント
// ==============================
function onPointerDown(e) {
    if (game.isOver) return;
    if (isCurrentPlayerCPU()) return;

    // 保留中の再構築を確定させ、古いメッシュを掴ませない
    flushPendingRebuild();

    e.preventDefault();
    updateMouse(e.clientX, e.clientY);
    raycaster.setFromCamera(mouse, camera);

    const currentPlayer = game.turn;

    if (game.phase === 'hang') {
        if (game[currentPlayer].stock > 0) {
            const stockWeight = stockWeights[currentPlayer];
            if (stockWeight && stockWeight.visible) {
                const hits = raycaster.intersectObject(stockWeight.hitbox || stockWeight.sphere);
                if (hits.length > 0) {
                    draggedStock = stockWeight;
                    game.isDragging = true;
                    stockWeight.sphere.material.emissiveIntensity = 0.8;
                    playSound('select');
                    showAllGhosts();
                    showDragIndicator(e.clientX, e.clientY);
                    return;
                }
            }
        }
    } else if (game.phase === 'move') {
        const allWeights = weightMeshes;
        const hitboxes = allWeights.map(w => w.hitbox || w.sphere);
        const hits = raycaster.intersectObjects(hitboxes);

        if (hits.length > 0) {
            const hitObject = hits[0].object;
            const weightData = allWeights.find(w =>
                w.hitbox === hitObject || w.sphere === hitObject || w.sphere === hitObject.parent);
            if (weightData) {
                // 吊るした位置のおもりは全て移動不可（新ルール）
                if (game.currentTurnHungPos === weightData.pos) {
                    playSound('error');
                    showComboText(MESSAGES.CANNOT_MOVE, UI_COLORS.WARNING);
                    return;
                }

                game.selectedWeight = { pos: weightData.pos, index: weightData.stackIndex, owner: weightData.owner };
                game.isDragging = true;
                playSound('select');

                const movingCount = weightData.stackIndex + 1;
                highlightChainWeights(weightData.pos, weightData.stackIndex);
                showValidMoveGhosts(weightData.pos, weightData.owner, movingCount);
                hideHint();
                showDragIndicator(e.clientX, e.clientY);
            }
        }
    }
}

function onPointerMove(e) {
    if (!game.isDragging || game.isOver) return;
    e.preventDefault();
    updateMouse(e.clientX, e.clientY);
    updateDragIndicator(e.clientX, e.clientY);

    // raycasterを一度だけセット（パフォーマンス最適化）
    raycaster.setFromCamera(mouse, camera);

    if (draggedStock && reusableIntersectPoint) {
        // 再利用可能なVector3を使用（毎フレーム生成しない）
        const hasIntersection = raycaster.ray.intersectPlane(dragPlane, reusableIntersectPoint);
        if (hasIntersection) {
            // ドラッグ範囲を制限（てこの範囲＋余裕）
            const clampedX = Math.max(DRAG_LIMITS.X_MIN, Math.min(DRAG_LIMITS.X_MAX, reusableIntersectPoint.x));
            const clampedY = Math.max(DRAG_LIMITS.Y_MIN, Math.min(DRAG_LIMITS.Y_MAX, reusableIntersectPoint.y));
            draggedStock.position.x = clampedX;
            draggedStock.position.y = clampedY;
        }
    }

    // ゴーストのハイライト処理（raycasterは既にセット済み）
    const { visibleGhosts, hits } = raycastVisibleGhosts();

    if (hits.length > 0) {
        const hitGhost = visibleGhosts.find(g => g.hitbox === hits[0].object);
        if (hitGhost) {
            highlightGhost(hitGhost.userData.pos);
        }
    } else if (hoveredGhost) {
        resetGhostHighlight(hoveredGhost);
        hoveredGhost = null;
    }
}

function onPointerUp(e) {
    hideDragIndicator();

    // pointercancelイベントでは座標が不正になるため、ドロップ処理をスキップ
    if (e.type === 'pointercancel') {
        if (draggedStock) {
            resetStockPosition(draggedStock);
            draggedStock.sphere.material.emissiveIntensity = 0.4;
            draggedStock = null;
        }
        game.selectedWeight = null;
        game.isDragging = false;
        hideAllGhosts();
        resetWeightHighlight();
        return;
    }

    if (draggedStock) {
        updateMouse(e.clientX, e.clientY);
        raycaster.setFromCamera(mouse, camera);

        const { visibleGhosts, hits } = raycastVisibleGhosts();

        if (hits.length > 0) {
            const hitGhost = visibleGhosts.find(g => g.hitbox === hits[0].object);
            if (hitGhost) {
                const pos = hitGhost.userData.pos;
                const owner = draggedStock.userData.owner;
                // 満杯チェック
                const stack = game.leverData[pos] || [];
                if (stack.length >= CONFIG.MAX_STACK) {
                    showHint('この位置は満杯！', `最大${CONFIG.MAX_STACK}個まで`);
                    playSound('click');
                } else {
                    doHang(pos, owner);
                    const ownerColorSet = COLORS[owner.toUpperCase()] || COLORS.BLUE;
                    createParticleExplosion(hits[0].point, `#${  ownerColorSet.bright.toString(16).padStart(6, '0')}`);
                }
            }
        }

        resetStockPosition(draggedStock);
        draggedStock.sphere.material.emissiveIntensity = 0.4;
        draggedStock = null;
        game.isDragging = false;
        hideAllGhosts();
        return;
    }

    if (!game.isDragging || !game.selectedWeight) {
        hideAllGhosts();
        resetWeightHighlight();
        return;
    }

    updateMouse(e.clientX, e.clientY);
    raycaster.setFromCamera(mouse, camera);

    const { visibleGhosts, hits } = raycastVisibleGhosts();

    if (hits.length > 0) {
        const hitGhost = visibleGhosts.find(g => g.hitbox === hits[0].object);
        if (hitGhost) {
            const toPos = hitGhost.userData.pos;
            const fromPos = game.selectedWeight.pos;
            const movingCount = game.selectedWeight.index + 1;

            if (isValidMove(fromPos, toPos, movingCount)) {
                doMove(fromPos, game.selectedWeight.index, toPos);
                createParticleExplosion(hits[0].point, UI_COLORS.ACCENT);
                triggerCameraShake(PHYSICS_CONFIG.CAMERA_SHAKE_INTENSITY);
            } else {
                // 満杯の場合はメッセージ表示
                const toStack = game.leverData[toPos] || [];
                if (toStack.length + movingCount > CONFIG.MAX_STACK) {
                    showHint('この位置は満杯！', `最大${CONFIG.MAX_STACK}個まで`);
                    playSound('click');
                }
            }
        }
    }

    game.selectedWeight = null;
    game.isDragging = false;
    hideAllGhosts();
    resetWeightHighlight();
}

function updateMouse(x, y) {
    // キャンバスの実際の位置とサイズを使用（スマホ横画面サイドバー対応）
    const canvas = document.getElementById('game-canvas');
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((y - rect.top) / rect.height) * 2 + 1;
}

// ==============================
// ドラッグインジケーター
// ==============================
/**
 * ドラッグインジケーターを表示
 * @param {number} x - X座標
 * @param {number} y - Y座標
 */
function showDragIndicator(x, y) {
    const indicator = document.getElementById(DOM_IDS.DRAG_INDICATOR);
    const dragText = document.getElementById(DOM_IDS.DRAG_TEXT);
    if (!indicator) return;
    indicator.classList.add('active');
    indicator.style.left = `${x - 25  }px`;
    indicator.style.top = `${y - 25  }px`;
    if (dragText) dragText.textContent = 'ここに配置！';
}

function updateDragIndicator(x, y) {
    const indicator = document.getElementById(DOM_IDS.DRAG_INDICATOR);
    if (!indicator) return;
    indicator.style.left = `${x - 25  }px`;
    indicator.style.top = `${y - 25  }px`;
}

function hideDragIndicator() {
    const indicator = document.getElementById(DOM_IDS.DRAG_INDICATOR);
    if (indicator) indicator.classList.remove('active');
}

// ==============================
// おもりハイライト
// ==============================
function highlightChainWeights(pos, grabIndex) {
    // 選択したおもりとその下をハイライト
    let chainCount = 0;

    weightMeshes.forEach(w => {
        if (w.pos === pos && w.stackIndex <= grabIndex) {
            w.sphere.material.emissiveIntensity = 1.5;
            w.sphere.scale.set(1.2, 1.2, 1.2);
            if (w.owner === game.turn) {
                w.sphere.material.emissive.setHex(0xffaa00);
            } else {
                w.sphere.material.emissive.setHex(0xffffff);
            }
            chainCount++;
        }
    });

    return chainCount;
}

function resetWeightHighlight() {
    weightMeshes.forEach(w => {
        const colorKey = w.owner.toUpperCase();
        const colorSet = COLORS[colorKey] || COLORS.NEUTRAL;
        w.sphere.material.emissiveIntensity = 0.5;
        w.sphere.material.emissive.setHex(colorSet.emissive);
        w.sphere.scale.set(1, 1, 1);
    });
}

function resetStockPosition(stock) {
    if (!stock) return;
    const owner = stock.userData.owner;
    const pos = STOCK_POSITIONS[owner] || STOCK_POSITIONS.blue;
    stock.position.set(pos.x, pos.y, pos.z);
}

// ==============================
// パーティクル
// ==============================
/**
 * パーティクル爆発エフェクトを生成
 * @param {THREE.Vector3} point - 3D空間の座標
 * @param {string} color - パーティクルの色
 */
function createParticleExplosion(point, color) {
    if (!point || !color) return;
    const container = document.getElementById(DOM_IDS.PARTICLES);
    if (!container) return;

    const count = CONFIG.PARTICLE_COUNT;
    const screenPos = toScreenPosition(point);
    if (!screenPos) return;

    // DocumentFragmentで一括DOM追加（パフォーマンス最適化）
    const fragment = document.createDocumentFragment();
    const particleData = [];

    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.background = color;
        particle.style.boxShadow = `0 0 10px ${color}`;
        particle.style.left = `${screenPos.x  }px`;
        particle.style.top = `${screenPos.y  }px`;

        const angle = (Math.PI * 2 / count) * i;
        const velocity = 60 + Math.random() * 60;

        fragment.appendChild(particle);
        particleData.push({
            el: particle,
            vx: Math.cos(angle) * velocity,
            vy: Math.sin(angle) * velocity,
        });
    }

    // 一括追加
    container.appendChild(fragment);

    // アニメーション開始（DOM追加後）
    // 経過時間ベースで計算し、120Hz端末でも60Hz端末でも同じ速さ・同じ寿命にする
    const PARTICLE_LIFETIME_MS = 800;

    particleData.forEach(({ el, vx, vy }) => {
        let startTime = null;
        const animateParticle = (now) => {
            if (startTime === null) startTime = now;
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / PARTICLE_LIFETIME_MS);

            const seconds = elapsed / 1000;
            el.style.transform = `translate(${vx * seconds}px, ${vy * seconds}px)`;
            el.style.opacity = 1 - progress;

            if (progress < 1) requestAnimationFrame(animateParticle);
            else el.remove();
        };
        requestAnimationFrame(animateParticle);
    });
}

/**
 * 3D座標をビューポート座標へ変換
 * canvasは横画面時にサイドパネル分だけ内側に配置されるため、
 * window.innerWidth ではなく canvas の実寸・オフセットを基準にする
 * （updateMouse と同じ基準に揃えることで、入力と演出の位置が一致する）
 * @param {THREE.Vector3} point - 3D空間の座標
 * @returns {{x: number, y: number}|null} ビューポート座標
 */
function toScreenPosition(point) {
    const canvas = document.getElementById(DOM_IDS.GAME_CANVAS);
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const vector = new THREE.Vector3(point.x, point.y, point.z);
    vector.project(camera);

    return {
        x: rect.left + (vector.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-vector.y * 0.5 + 0.5) * rect.height,
    };
}

function triggerCameraShake(intensity) {
    cameraShake.intensity = intensity;
}

function addSwingImpulse(pos, intensity) {
    Object.keys(weightPhysics).forEach(key => {
        if (key.startsWith(`${pos  }_`)) {
            const physics = weightPhysics[key];
            physics.velocity += (Math.random() - 0.5) * intensity * 0.5;
        }
    });
    Object.keys(weightPhysics).forEach(key => {
        const physics = weightPhysics[key];
        physics.velocity += (Math.random() - 0.5) * intensity * 0.1;
    });
}

// ==============================
// 吊るす
// ==============================
/**
 * おもりを吊るす処理
 * @param {number} pos - 吊るす位置（-6～6、0以外）
 * @param {string} owner - おもりの所有者（'blue', 'yellow', 'red', 'green'）
 * @param {boolean} [isRehang=false] - やり直しフラグ
 * @returns {boolean} 吊るせたかどうか（満杯・不正な引数の場合はfalse）
 */
function doHang(pos, owner, isRehang = false) {
    if (pos == null || !owner) return false;
    if (!game.leverData[pos]) game.leverData[pos] = [];

    // スタック制限チェック（満杯の位置には吊るせない）
    if (game.leverData[pos].length >= CONFIG.MAX_STACK) {
        return false;
    }

    // 吊るし直しの場合はストックを減らさない
    if (!isRehang) {
        game[owner].stock--;
    }

    // 新しいおもりをスタックの先頭（index 0 = 視覚的に一番下/てこから遠い）に追加
    game.leverData[pos].unshift({ owner, hungThisTurn: true });

    // このターンで吊るした位置を記録
    game.currentTurnHungPos = pos;
    game.currentTurnHungOwner = owner;

    playSound('drop');
    triggerImpactPause(PHYSICS_CONFIG.IMPACT_PAUSE_DURATION);  // おもり配置時のインパクトポーズ

    // 揺れは再構築後に与える（新しい weightPhysics のキーに作用させるため）
    rebuildWeights(() => addSwingImpulse(pos, PHYSICS_CONFIG.SWING_IMPULSE_HANG));
    updateMomentDisplay();
    updateUI();

    game.phase = 'move';
    playSound('phase');
    updatePhaseUI();

    if (game.turnCount <= 1) {
        // 初回ターン：バランス説明を追加
        const m = calcMoment();
        if (m.diff === 0) {
            showHint('⚖️ バランスOK！', `L=${  m.left  } R=${  m.right  } で釣り合い中`);
        } else {
            showHint('⚠️ 傾いてる！', `L=${  m.left  } R=${  m.right  } → 動かしてバランスを取ろう`);
        }
    } else if (hasAnyValidMove()) {
        showHint('動かす or SKIP！', '隣はNG！');
    } else {
        showHint('移動先なし', 'SKIPしよう');
    }

    return true;
}

// 吊るし直し：今吊るしたおもりを取り消す
function undoHang() {
    if (game.currentTurnHungPos === null) return false;

    const pos = game.currentTurnHungPos;
    const owner = game.currentTurnHungOwner;
    const stack = game.leverData[pos];

    if (stack && stack.length > 0 && stack[0].hungThisTurn) {
        // 今ターン吊るしたおもり（スタック先頭 = 視覚的に最下部）を取り除く
        stack.shift();
        if (stack.length === 0) {
            delete game.leverData[pos];
        }

        // ストックに戻す
        game[owner].stock++;

        // 記録をクリア
        game.currentTurnHungPos = null;
        game.currentTurnHungOwner = null;

        rebuildWeights();
        updateMomentDisplay();
        updateUI();

        return true;
    }
    return false;
}

// ==============================
// 移動
// ==============================
/**
 * 移動が合法かどうかを判定
 * CPUのシミュレーションからも呼ばれるため、対象の状態を引数で差し替えられる
 * @param {number} fromPos - 移動元の位置
 * @param {number} toPos - 移動先の位置
 * @param {number} [movingCount=1] - 一緒に動くおもりの数
 * @param {Object.<number, Array>} [leverData=game.leverData] - 対象のてこデータ
 * @param {number|null} [hungPos=game.currentTurnHungPos] - このターンに吊るした位置
 * @returns {boolean} 移動可能かどうか
 */
function isValidMove(fromPos, toPos, movingCount = 1,
    leverData = game.leverData, hungPos = game.currentTurnHungPos) {
    if (fromPos === toPos) return false;
    if (Math.abs(fromPos - toPos) === 1) return false;
    if ((fromPos === -1 && toPos === 1) || (fromPos === 1 && toPos === -1)) return false;
    // 今ターン吊るした位置からの移動は禁止（への移動はOK）
    if (hungPos !== null && fromPos === hungPos) {
        return false;
    }
    // スタック制限：移動先 + 移動数が上限を超える場合は無効
    const toStack = leverData[toPos] || [];
    if (toStack.length + movingCount > CONFIG.MAX_STACK) {
        return false;
    }
    return true;
}

// 実際に有効な移動が存在するかチェック
function hasAnyValidMove() {
    for (const fromPos of allPositions) {
        const stack = game.leverData[fromPos];
        if (!stack || stack.length === 0) continue;
        // 今ターン吊るした位置からは移動不可
        if (game.currentTurnHungPos === fromPos) continue;

        for (const toPos of allPositions) {
            if (isValidMove(fromPos, toPos)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * おもりを移動する処理
 * @param {number} fromPos - 移動元の位置
 * @param {number} fromIndex - 移動するおもりのスタックインデックス
 * @param {number} toPos - 移動先の位置
 * @returns {boolean} 成功したかどうか
 */
function doMove(fromPos, fromIndex, toPos) {
    if (fromPos == null || fromIndex == null || toPos == null) return false;
    // 選択したおもりと、その下のおもり全てを移動
    const stack = game.leverData[fromPos] || [];
    const moving = stack.slice(0, fromIndex + 1);
    const remaining = stack.slice(fromIndex + 1);

    // 空配列になったら削除、そうでなければ残りを設定
    if (remaining.length === 0) {
        delete game.leverData[fromPos];
    } else {
        game.leverData[fromPos] = remaining;
    }

    if (!game.leverData[toPos]) game.leverData[toPos] = [];
    game.leverData[toPos] = [...moving, ...game.leverData[toPos]];

    playSound('move');

    // 揺れは再構築後に与える（新しい weightPhysics のキーに作用させるため）
    rebuildWeights(() => addSwingImpulse(toPos, PHYSICS_CONFIG.SWING_IMPULSE_MOVE));
    updateMomentDisplay();

    setCpuTimeout(() => goToJudge(), PHYSICS_CONFIG.MOVE_JUDGE_DELAY);
}

// ==============================
// パス・判定
// ==============================
function passMove() {
    playSound('click');
    hideHint();
    goToJudge();
}

function redoHang() {
    if (game.phase !== 'move') return;
    if (game.currentTurnHungPos === null) return;

    playSound('click');

    // 吊るしたおもりを取り消し
    if (undoHang()) {
        // HANGフェーズに戻る
        game.phase = 'hang';
        updatePhaseUI();
        updateStockWeightsVisibility();
        showHint('やり直しOK！', '別の場所へ');
        showComboText(MESSAGES.REDO, UI_COLORS.WARNING);
    }
}

function goToJudge() {
    // 競合状態防止：既に判定中またはゲーム終了済みなら何もしない
    if (game.isJudging || game.isOver) return;
    game.isJudging = true;  // 注意: 全ての終了パスで必ずfalseに戻すこと

    game.phase = 'judge';
    updatePhaseUI();

    setCpuTimeout(() => {
        // 再度チェック（setTimeoutの間に状態が変わる可能性）
        if (game.isOver) {
            game.isJudging = false;
            return;
        }

        const balanced = checkBalance();
        if (!balanced) {
            // 現在のプレイヤーが脱落
            triggerCameraShake(0.4);
            // D-5: 支点へ寄り、どちら側が重かったかを見せる時間を作る
            triggerEliminationFocus();
            playSound('lose');
            showScreenFlash('lose');
            triggerImpactPause(100);  // 脱落時のインパクトポーズ

            const eliminatedPlayer = game.turn;
            game[eliminatedPlayer].eliminated = true;
            game.activePlayers = game.activePlayers.filter(p => p !== eliminatedPlayer);

            showComboText(`${PLAYER_META[eliminatedPlayer].displayName} ${MESSAGES.PLAYER_OUT}`, UI_COLORS.DANGER);

            // 生存者が1人なら勝利
            if (game.activePlayers.length === 1) {
                setCpuTimeout(() => {
                    if (!game.isOver) endGame(game.activePlayers[0]);
                    game.isJudging = false;
                }, CONFIG.ELIMINATION_DELAY);
            } else if (game.activePlayers.length === 0) {
                // 全員脱落
                setCpuTimeout(() => {
                    if (!game.isOver) endGame('all_out');
                    game.isJudging = false;
                }, CONFIG.ELIMINATION_DELAY);
            } else {
                // ゲーム続行
                setCpuTimeout(() => {
                    if (!game.isOver) {
                        updateUI();
                        switchTurn();
                    }
                    game.isJudging = false;
                }, CONFIG.ELIMINATION_DELAY);
            }
        } else {
            // 全員のストック切れ判定
            const allOutOfStock = game.activePlayers.every(p => game[p].stock <= 0);
            const maxTurnsReached = game.turnCount >= game.playerCount * CONFIG.MAX_TURNS_PER_PLAYER;

            if (allOutOfStock || maxTurnsReached) {
                playSound('balance');
                showComboText(MESSAGES.FINAL_TURN, UI_COLORS.ACCENT);
                setCpuTimeout(() => {
                    if (!game.isOver) endGame('draw');
                    game.isJudging = false;
                }, CONFIG.BALANCE_RESULT_DELAY);
            } else {
                playSound('balance');
                showComboText(MESSAGES.BALANCED, UI_COLORS.SUCCESS);
                // 成功時のカメラ演出: 軽くズームイン（達成感）
                setDramaticFov(-5, 600);
                game.isJudging = false;
                switchTurn();
            }
        }
    }, CONFIG.JUDGE_DELAY);
}

// ==============================
// バランス計算
// ==============================
/**
 * 現在のてこのモーメントを計算
 * 実装は game-logic.js の純粋関数（テスト対象）に委譲する
 * @param {Object.<number, Array>} [leverData=game.leverData] - 対象のてこデータ
 * @returns {{left: number, right: number, diff: number}} モーメント情報
 */
function calcMoment(leverData = game.leverData) {
    return calculateMoment(leverData, allPositions, CONFIG.WEIGHT_VALUE);
}

// ポイント計算（各プレイヤーの |位置| × 10 の合計）
// 教育的意味：てこをかたむける働き = 支点からのきょり × おもりの重さ
/**
 * 全プレイヤーのポイントを計算
 * 実装は game-logic.js の純粋関数（テスト対象）に委譲する
 * @param {Object.<number, Array>} [leverData=game.leverData] - 対象のてこデータ
 * @returns {Object.<string, number>} プレイヤー名をキーとするポイントマップ
 */
function calcPlayerPoints(leverData = game.leverData) {
    return calculatePlayerPoints(leverData, allPositions);
}

function updatePointsDisplay() {
    const points = calcPlayerPoints();
    PLAYER_ORDER.forEach(player => {
        const el = document.getElementById(`points-${player}`);
        if (el) el.textContent = points[player];
    });
}

function updateMomentDisplay() {
    const m = calcMoment();
    updatePointsDisplay();

    if (!game.isOver) {
        targetLeverAngle = m.diff * PHYSICS.TILT_SCALE;
        targetLeverAngle = Math.max(-PHYSICS.MAX_TILT, Math.min(PHYSICS.MAX_TILT, targetLeverAngle));
    }

    // D-1: モーメント差を 0〜1 に正規化。てこが限界まで傾く差を 1 とする
    const maxDiff = PHYSICS.MAX_TILT / PHYSICS.TILT_SCALE;
    const absDiff = Math.abs(m.diff);
    targetTension = Math.min(1, absDiff / maxDiff);

    // D-2: つり合いへの「接近」を検出し、入った瞬間だけベルを鳴らす
    isNearBalance = absDiff > 0 && absDiff <= FEEDBACK_CONFIG.NEAR_BALANCE_DIFF;
    if (isNearBalance && !wasNearBalance && !game.isOver) {
        playSound('near');
    }
    wasNearBalance = isNearBalance;

    // シンプルUI: 数値とアイコンのみ
    const mLeft = document.getElementById('m-left');
    const mRight = document.getElementById('m-right');
    const icon = document.getElementById('balance-icon');

    if (mLeft) mLeft.textContent = m.left;
    if (mRight) mRight.textContent = m.right;
    if (icon) icon.className = `balance-icon ${  m.diff === 0 ? 'balanced' : 'unbalanced'}`;
}

function checkBalance() {
    const m = calcMoment();
    return m.diff === 0;
}

// ==============================
// ターン管理
// ==============================
function switchTurn() {
    // 次の生存プレイヤーを探す
    let nextIndex = game.turnIndex;
    let loopCount = 0;
    do {
        nextIndex = (nextIndex + 1) % game.playerCount;
        loopCount++;
        if (loopCount > game.playerCount) break; // 全員脱落防止
    } while (game[PLAYER_ORDER[nextIndex]].eliminated);

    game.turnIndex = nextIndex;
    game.turn = PLAYER_ORDER[nextIndex];
    game.phase = 'hang';
    game.selectedWeight = null;
    game.isDragging = false;
    game.turnCount++;

    // ターン終了時に記録をリセット
    game.currentTurnHungPos = null;
    game.currentTurnHungOwner = null;

    // hungThisTurnフラグをクリア
    allPositions.forEach(pos => {
        const stack = game.leverData[pos];
        if (stack) {
            stack.forEach(w => {
                delete w.hungThisTurn;
            });
        }
    });

    playSound('turn');

    updateUI();
    updatePhaseUI();

    if (game.turnCount <= 1) {
        showHint('💡 おもりをドラッグ！', '光る場所に置くと吊るせるよ');
    } else if (game.turnCount <= 4) {
        showHint('ドラッグで配置！', '光る場所へ');
    }

    // CPUターンの場合は自動実行
    if (isCurrentPlayerCPU() && !game.isOver) {
        hideHint();
        setCpuTimeout(cpuTurn, getCpuDelay(game.turn));
    } else if (!game.isOver && game[game.turn].stock <= 0) {
        // 人間プレイヤーでストック0の場合、自動で移動フェーズへ
        hideHint();
        game.phase = 'move';
        playSound('phase');
        updatePhaseUI();

        // 実際に有効な移動があるかチェック
        if (game.turnCount <= 1) {
            const m = calcMoment();
            if (m.diff === 0) {
                showHint('⚖️ バランスOK！', `L=${  m.left  } R=${  m.right  } で釣り合い中`);
            } else {
                showHint('⚠️ 傾いてる！', `L=${  m.left  } R=${  m.right  } → 動かしてバランスを取ろう`);
            }
        } else if (hasAnyValidMove()) {
            showHint('動かす or SKIP！', '隣はNG！');
        } else {
            showHint('移動先なし', 'SKIPしよう');
        }
    }
}

function updatePhaseUI() {
    const badge = document.getElementById(DOM_IDS.PHASE_BADGE);
    const btnPass = document.getElementById(DOM_IDS.BTN_PASS);
    const btnRedo = document.getElementById(DOM_IDS.BTN_REDO);

    if (!badge || !btnPass || !btnRedo) return;

    btnPass.classList.add('hidden');
    btnRedo.classList.add('hidden');
    updateStockWeightsVisibility();

    // プレイヤーパネルのアクティブ状態更新
    game.activePlayers.forEach(color => {
        const panel = document.getElementById(`panel-${  color}`);
        if (panel) {
            panel.classList.toggle('active', color === game.turn);
        }
    });

    const isCpuTurn = isCurrentPlayerCPU();

    if (isCpuTurn) {
        badge.textContent = '🤖 CPU...';
        badge.className = 'phase-badge cpu';
        return;
    }

    // 人間プレイヤーの場合
    if (game.phase === 'hang') {
        badge.textContent = '🎯 HANG';
        badge.className = 'phase-badge hang';
    } else if (game.phase === 'move') {
        badge.textContent = '✋ MOVE';
        badge.className = 'phase-badge move';
        btnPass.classList.remove('hidden');
        if (game.currentTurnHungPos !== null) {
            btnRedo.classList.remove('hidden');
        }
    } else if (game.phase === 'judge') {
        badge.textContent = '⚖️ JUDGE';
        badge.className = 'phase-badge judge';
    }
}

function showHint(text, sub) {
    const hint = document.getElementById(DOM_IDS.GAME_HINT);
    const hintText = document.getElementById(DOM_IDS.HINT_TEXT);
    const hintSub = document.getElementById(DOM_IDS.HINT_SUB);
    if (!hint) return;
    if (hintText) hintText.textContent = text;
    if (hintSub) hintSub.textContent = sub || '';
    hint.classList.add('show');
}

function hideHint() {
    const hint = document.getElementById(DOM_IDS.GAME_HINT);
    if (hint) hint.classList.remove('show');
}

// ==============================
// CPU AI（性格システム対応 + 妨害戦略）
// ==============================

// 現在のリーダー（最高ポイントプレイヤー）を取得
function findLeader(excludePlayer = null) {
    const points = calcPlayerPoints();
    let leader = null;
    let maxPoints = -1;

    game.activePlayers.forEach(player => {
        if (player !== excludePlayer && !game[player].eliminated && points[player] > maxPoints) {
            maxPoints = points[player];
            leader = player;
        }
    });

    return { player: leader, points: maxPoints };
}

// 自分と1位とのポイント差を計算
function getPointGap(player) {
    const points = calcPlayerPoints();
    const myPoints = points[player];
    const leader = findLeader(player);

    if (!leader.player) return 0;
    return leader.points - myPoints;
}

// 妨害移動の効果を評価（相手のポイントをどれだけ下げられるか）
/**
 * 妨害行動の価値を評価（相手のポイント減少量）
 * @param {number} fromPos - 移動元の位置
 * @param {number} toPos - 移動先の位置
 * @returns {number} 妨害価値（正の値が大きいほど効果的）
 */
function evaluateSabotageValue(fromPos, toPos) {
    const fromValue = Math.abs(fromPos) * 10;
    const toValue = Math.abs(toPos) * 10;
    const pointReduction = fromValue - toValue;

    // 相手の重りを内側に移動する = ポイント減少
    return pointReduction;
}

// CPUの性格を取得
function getCpuPersonality(player) {
    const personalityType = cpuPersonalities[player] || 'normal';
    return CPU_PERSONALITIES[personalityType];
}

// CPUの思考時間を取得（性格に応じて変動）
function getCpuDelay(player) {
    const personality = getCpuPersonality(player);
    return personality.thinkingDelay || CONFIG.CPU_DELAY;
}

// 人間らしいミスを判定
function shouldMakeMistake(player) {
    const personality = getCpuPersonality(player);
    return Math.random() < personality.mistakeRate;
}

// 性格に基づいて位置のスコアを計算
function getPositionScore(pos, personality) {
    const absPos = Math.abs(pos);
    let score = 0;

    if (personality.preferInner) {
        // 安全派：内側を好む（位置1-2を高評価）
        if (absPos <= 2) score += 50;
        else if (absPos <= 3) score += 20;
        else score -= absPos * 10; // 外側はペナルティ
    } else if (personality.riskTolerance > 0.6) {
        // 攻撃派：外側を好む（高ポイント狙い）
        score += absPos * 15; // 外側ほど高評価
        if (absPos >= 5) score += 30; // ボーナス
    } else {
        // バランス派：中間を好む
        if (absPos >= 2 && absPos <= 4) score += 30;
    }

    return score;
}

function cpuTurn() {
    if (game.isOver) return;

    const currentPlayer = game.turn;
    const personality = getCpuPersonality(currentPlayer);

    // 人間らしいミスをするかどうか
    const makeMistake = shouldMakeMistake(currentPlayer);

    let strategy;
    if (makeMistake) {
        // ミス：ランダムまたは次善の手を選ぶ
        strategy = findMistakeStrategy(currentPlayer, personality);
    } else {
        strategy = findBestStrategyWithPersonality(currentPlayer, personality);
    }

    if (strategy.hangPos !== null) {
        doHang(strategy.hangPos, currentPlayer);
    }

    setCpuTimeout(() => {
        if (game.isOver) return;

        // 保留中の再構築を確定させてから weightMeshes を参照する
        flushPendingRebuild();

        // 現在のバランス状態を確認
        const currentMoment = calcMoment();
        const isBalanced = currentMoment.diff === 0;

        // 性格に基づいて移動をスキップするか判定
        // ただし、バランスが崩れている場合はスキップしない（脱落回避優先）
        const skipMove = isBalanced && Math.random() < personality.moveSkipRate;

        // 移動が必要かつスキップしない場合、または移動によりバランスが改善する場合
        const shouldMove = strategy.move && !skipMove;

        if (shouldMove) {
            const fromWeight = weightMeshes.find(w =>
                w.pos === strategy.move.fromPos && w.stackIndex === strategy.move.index,
            );
            if (fromWeight) {
                const movingCount = strategy.move.index + 1;
                highlightChainWeights(strategy.move.fromPos, strategy.move.index);
                showValidMoveGhosts(strategy.move.fromPos, fromWeight.owner, movingCount);
            }

            setCpuTimeout(() => {
                if (game.isOver) return;
                doMove(strategy.move.fromPos, strategy.move.index, strategy.move.toPos);
                triggerCameraShake(0.1);
                hideAllGhosts();
                resetWeightHighlight();
            }, 400);
        } else {
            setCpuTimeout(() => {
                if (game.isOver) return;
                goToJudge();
            }, 300);
        }
    }, getCpuDelay(currentPlayer));
}

// ミス戦略：わざと次善の手を選ぶ
function findMistakeStrategy(player, personality) {
    if (game[player].stock <= 0) {
        // 移動のみの場合、ランダムに選ぶか何もしない
        if (Math.random() < 0.5) {
            return { hangPos: null, move: null, resultDiff: Infinity };
        }
        const moves = findAllPossibleMoves();
        if (moves.length > 0) {
            // ランダムな移動を選ぶ（最善ではない）
            const randomMove = moves[Math.floor(Math.random() * moves.length)];
            return {
                hangPos: null,
                move: { fromPos: randomMove.fromPos, index: randomMove.index, toPos: randomMove.toPos },
                resultDiff: randomMove.diff,
            };
        }
        return { hangPos: null, move: null, resultDiff: Infinity };
    }

    // ランダムな位置に吊るす（最善ではない）
    // 非破壊シミュレーション：game.leverData には一切触れない
    const validPositions = [];

    for (let i = 0; i < allPositions.length; i++) {
        const p = allPositions[i];

        // スタック制限チェック（満杯の位置はスキップ）
        const currentStack = game.leverData[p] || [];
        if (currentStack.length >= CONFIG.MAX_STACK) {
            continue;
        }

        const m = calcMoment(simulateHang(game.leverData, p, player));

        // バランスが大きく崩れすぎない位置のみ
        if (Math.abs(m.diff) < CONFIG.MAX_MOMENT_DIFF_MISTAKE) {
            validPositions.push(p);
        }
    }

    if (validPositions.length === 0) {
        return findBestStrategyWithPersonality(player, personality);
    }

    const randomPos = validPositions[Math.floor(Math.random() * validPositions.length)];
    return { hangPos: randomPos, move: null, resultDiff: 50 };
}

// 性格を考慮した戦略（妨害戦略強化版）
function findBestStrategyWithPersonality(player, personality) {
    const leader = findLeader(player);
    const pointGap = getPointGap(player);

    // 妨害の積極度を決定（性格とポイント差に基づく）
    let sabotageAggression = 0;
    const sabotageThreshold = personality.sabotageThreshold || 30;
    const defensivePriority = personality.defensivePriority || 0.5;

    if (leader.player && leader.player !== player) {
        // ポイント差がしきい値を超えたら妨害開始
        if (pointGap >= sabotageThreshold) {
            // ポイント差が大きいほど妨害を優先
            const gapFactor = Math.min((pointGap - sabotageThreshold) / CONFIG.SABOTAGE_GAP_DIVISOR, 1);

            // 守備優先度が低いほど妨害に積極的
            const attackFactor = 1 - defensivePriority;
            sabotageAggression = attackFactor * 0.5 + gapFactor * 0.5;

            // 攻撃派は常に高めの妨害意欲
            if (personality.riskTolerance >= 0.8) {
                sabotageAggression = Math.max(sabotageAggression, 0.6);
            }
        } else if (personality.riskTolerance >= 0.8) {
            // 攻撃派はしきい値未満でも少し妨害
            sabotageAggression = 0.3;
        }
    }

    if (game[player].stock <= 0) {
        const move = findBestMoveWithSabotage(sabotageAggression);
        const resultDiff = move ? simulateMoveInternal(move.fromPos, move.index, move.toPos) : Infinity;
        return { hangPos: null, move: move, resultDiff };
    }

    const allStrategies = [];

    allPositions.forEach(hangPos => {
        // スタック制限チェック（満杯の位置はスキップ）
        const currentStack = game.leverData[hangPos] || [];
        if (currentStack.length >= CONFIG.MAX_STACK) {
            return; // forEach内なのでcontinue相当
        }

        // 非破壊シミュレーション：吊るした後の盤面をコピー上で作る
        const afterHang = simulateHang(game.leverData, hangPos, player);

        const momentAfterHang = calcMoment(afterHang);
        const diffAfterHang = Math.abs(momentAfterHang.diff);

        // 性格に基づく位置スコアを追加
        const positionBonus = getPositionScore(hangPos, personality);

        if (diffAfterHang === 0) {
            allStrategies.push({
                hangPos: hangPos,
                move: null,
                resultDiff: 0,
                positionBonus: positionBonus,
                sabotageBonus: 0,
            });
        }

        // 吊るした後の盤面を対象に移動候補を探す（吊るした位置からは動かせない）
        const possibleMoves = findAllPossibleMoves(afterHang, hangPos);

        if (possibleMoves.length > 0) {
            // バランスを取れる移動を探す
            const balancingMoves = possibleMoves.filter(m => m.diff === 0);

            if (balancingMoves.length > 0) {
                // バランスを取れる移動の中で妨害効果が高いものを優先
                const bestSabotage = balancingMoves.reduce((best, m) => {
                    const sabBonus = (m.isLeaderWeight && m.sabotageValue > 0) ? m.sabotageValue : 0;
                    const bestBonus = (best.isLeaderWeight && best.sabotageValue > 0) ? best.sabotageValue : 0;
                    return sabBonus > bestBonus ? m : best;
                });

                const sabotageBonus = (bestSabotage.isLeaderWeight && bestSabotage.sabotageValue > 0)
                    ? bestSabotage.sabotageValue * sabotageAggression : 0;

                allStrategies.push({
                    hangPos: hangPos,
                    move: { fromPos: bestSabotage.fromPos, index: bestSabotage.index, toPos: bestSabotage.toPos },
                    resultDiff: 0,
                    positionBonus: positionBonus,
                    sabotageBonus: sabotageBonus,
                });
            }

            // バランス改善する移動
            const improvingMoves = possibleMoves.filter(m => m.diff < diffAfterHang);
            if (improvingMoves.length > 0) {
                // 妨害効果を考慮してベストを選択
                const scored = improvingMoves.map(m => {
                    const sabBonus = (m.isLeaderWeight && m.sabotageValue > 0)
                        ? m.sabotageValue * sabotageAggression : 0;
                    return { ...m, score: -m.diff + sabBonus };
                });
                const best = scored.reduce((a, b) => a.score > b.score ? a : b);

                const sabBonus = (best.isLeaderWeight && best.sabotageValue > 0)
                    ? best.sabotageValue * sabotageAggression : 0;
                allStrategies.push({
                    hangPos: hangPos,
                    move: { fromPos: best.fromPos, index: best.index, toPos: best.toPos },
                    resultDiff: best.diff,
                    positionBonus: positionBonus,
                    sabotageBonus: sabBonus,
                });
            }
        }

        // 外側回避：性格に応じてペナルティ
        const absPos = Math.abs(hangPos);
        let outerPenalty = 0;
        if (absPos >= 4 && Math.random() < personality.outerAvoidance) {
            outerPenalty = 50;
        }

        allStrategies.push({
            hangPos: hangPos,
            move: null,
            resultDiff: diffAfterHang + outerPenalty,
            positionBonus: positionBonus,
            sabotageBonus: 0,
        });
    });

    // ソート：バランス優先、次に妨害ボーナス、次に位置ボーナス
    allStrategies.sort((a, b) => {
        // まずバランスで比較
        if (a.resultDiff !== b.resultDiff) return a.resultDiff - b.resultDiff;
        // 同じなら妨害ボーナスで比較（高い方が良い）
        if ((a.sabotageBonus || 0) !== (b.sabotageBonus || 0)) {
            return (b.sabotageBonus || 0) - (a.sabotageBonus || 0);
        }
        // 同じなら位置ボーナスで比較（高い方が良い）
        if ((a.positionBonus || 0) !== (b.positionBonus || 0)) {
            return (b.positionBonus || 0) - (a.positionBonus || 0);
        }
        // 移動なしを優先（安定性のため）
        if (a.move === null && b.move !== null) return -1;
        if (a.move !== null && b.move === null) return 1;
        return 0;
    });

    // リスクテイカーは時々最善手ではなく高ポイント位置を選ぶ
    if (personality.riskTolerance > CONFIG.RISKY_RISK_TOLERANCE && Math.random() < CONFIG.RISKY_RANDOM_CHANCE) {
        const riskyOptions = allStrategies.filter(s =>
            Math.abs(s.hangPos) >= 4 && s.resultDiff <= 30,
        );
        if (riskyOptions.length > 0) {
            return riskyOptions[0];
        }
    }

    // 攻撃派は時々純粋妨害を優先
    if (personality.riskTolerance >= 0.8 && sabotageAggression > 0.5 && Math.random() < CONFIG.ATTACK_SABOTAGE_CHANCE) {
        const sabotageOptions = allStrategies.filter(s =>
            s.sabotageBonus > 20 && s.resultDiff <= 20,
        );
        if (sabotageOptions.length > 0) {
            return sabotageOptions[0];
        }
    }

    return allStrategies[0] || { hangPos: allPositions[0], move: null, resultDiff: Infinity };
}

// 妨害を考慮した最善移動を探す（ストック0の場合）
/**
 * 妨害を考慮した最適な移動を見つける
 * @param {number} sabotageAggression - 妨害積極度（0-1）
 * @returns {Object|null} 最適な移動、またはnull
 */
function findBestMoveWithSabotage(sabotageAggression) {
    const currentMoment = calcMoment();
    if (currentMoment.diff === 0) {
        // すでにバランスしている場合、純粋に妨害を狙う
        const moves = findAllPossibleMoves();
        const sabotageMoves = moves.filter(m =>
            m.isLeaderWeight && m.sabotageValue > 0 && m.diff <= 20,
        );
        if (sabotageMoves.length > 0 && Math.random() < sabotageAggression) {
            const best = sabotageMoves.reduce((a, b) =>
                (a.sabotageValue - a.diff) > (b.sabotageValue - b.diff) ? a : b,
            );
            return { fromPos: best.fromPos, index: best.index, toPos: best.toPos };
        }
        return null;
    }

    const moves = findAllPossibleMoves();
    if (moves.length === 0) return null;

    // バランスを取れる移動を探す
    const balancingMoves = moves.filter(m => m.diff === 0);
    if (balancingMoves.length > 0) {
        // 妨害効果が高いものを優先
        const best = balancingMoves.reduce((a, b) => {
            const aScore = (a.isLeaderWeight ? a.sabotageValue * sabotageAggression : 0);
            const bScore = (b.isLeaderWeight ? b.sabotageValue * sabotageAggression : 0);
            return aScore > bScore ? a : b;
        });
        return { fromPos: best.fromPos, index: best.index, toPos: best.toPos };
    }

    // 改善できる移動を探す
    const currentDiff = Math.abs(currentMoment.diff);
    const improvingMoves = moves.filter(m => m.diff < currentDiff);
    if (improvingMoves.length > 0) {
        const scored = improvingMoves.map(m => {
            const sabBonus = (m.isLeaderWeight && m.sabotageValue > 0)
                ? m.sabotageValue * sabotageAggression : 0;
            return { ...m, score: (currentDiff - m.diff) + sabBonus };
        });
        const best = scored.reduce((a, b) => a.score > b.score ? a : b);
        return { fromPos: best.fromPos, index: best.index, toPos: best.toPos };
    }

    return null;
}

/**
 * 可能な移動をすべて列挙する（非破壊：game.leverData を変更しない）
 * @param {Object.<number, Array>} [leverData=game.leverData] - 対象のてこデータ
 * @param {number|null} [hungPos=game.currentTurnHungPos] - このターンに吊るした位置
 * @returns {Array<Object>} 移動候補の配列
 */
function findAllPossibleMoves(leverData = game.leverData, hungPos = game.currentTurnHungPos) {
    const moves = [];
    const leader = findLeader();

    allPositions.forEach(fromPos => {
        const stack = leverData[fromPos] || [];
        stack.forEach((w, idx) => {
            const movingCount = idx + 1;  // 選択したおもりとその下全て
            allPositions.forEach(toPos => {
                if (isValidMove(fromPos, toPos, movingCount, leverData, hungPos)) {
                    const diff = simulateMoveInternal(fromPos, idx, toPos, leverData);
                    const sabotageValue = evaluateSabotageValue(fromPos, toPos);
                    const isLeaderWeight = (w.owner === leader.player);

                    moves.push({
                        fromPos,
                        index: idx,
                        toPos,
                        diff,
                        owner: w.owner,
                        sabotageValue: sabotageValue,
                        isLeaderWeight: isLeaderWeight,
                    });
                }
            });
        });
    });

    return moves;
}

/**
 * 移動後のモーメント差を求める（非破壊：game.leverData を変更しない）
 * @param {number} fromPos - 移動元の位置
 * @param {number} fromIndex - 移動するおもりのスタックインデックス
 * @param {number} toPos - 移動先の位置
 * @param {Object.<number, Array>} [leverData=game.leverData] - 対象のてこデータ
 * @returns {number} 移動後のモーメント差の絶対値
 */
function simulateMoveInternal(fromPos, fromIndex, toPos, leverData = game.leverData) {
    const after = simulateMove(leverData, fromPos, fromIndex, toPos);
    return Math.abs(calcMoment(after).diff);
}

// ==============================
// 3Dオブジェクト
// ==============================
// Three.jsオブジェクトのメモリ解放
function disposeObject(obj) {
    if (!obj) return;
    obj.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            // マテリアルが配列の場合に対応
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
                if (!mat) return;
                // 全てのテクスチャタイプを解放
                const textureProps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'bumpMap', 'envMap'];
                textureProps.forEach(prop => {
                    if (mat[prop]) {
                        mat[prop].dispose();
                    }
                });
                mat.dispose();
            });
        }
    });
}

/**
 * rebuildWeights: おもりメッシュの再構築をスケジュール（Debounce方式）
 * 連続した呼び出しを最適化し、最後の呼び出しから REBUILD_DEBOUNCE_MS 後に1回だけ実行する。
 *
 * ⚠️ 重要: 再構築で weightPhysics のキーが作り直されるため、
 * 「再構築後のおもり」に対する処理（addSwingImpulse など）は必ず onComplete で渡すこと。
 * 呼び出し直後に実行すると、まだ古いキーに対して作用してしまう。
 *
 * @param {Function|null} [onComplete=null] - 再構築完了後に実行するコールバック
 */
function rebuildWeights(onComplete = null) {
    if (onComplete) rebuildCallbacks.push(onComplete);

    // 既存のタイマーをキャンセル
    if (rebuildTimeout !== null) {
        clearManagedTimeout(rebuildTimeout);
    }

    // 新しいタイマーをセット（タイムアウトマネージャー管理下に置く）
    rebuildTimeout = setManagedTimeout(() => {
        rebuildTimeout = null;
        runPendingRebuild();
    }, REBUILD_DEBOUNCE_MS);
}

/**
 * 保留中の再構築を即座に実行し、溜まったコールバックを消化する
 */
function runPendingRebuild() {
    rebuildWeightsImmediate();
    // splice で取り出してから実行（コールバック内で再登録されても取りこぼさない）
    rebuildCallbacks.splice(0).forEach(callback => callback());
}

/**
 * 保留中の再構築があれば即座に確定させる
 * プレイヤー操作の直前に呼び、古い weightMeshes を掴ませないようにする
 */
function flushPendingRebuild() {
    if (rebuildTimeout === null) return;
    clearManagedTimeout(rebuildTimeout);
    rebuildTimeout = null;
    runPendingRebuild();
}

/**
 * rebuildWeightsImmediate: おもりメッシュの即座の再構築
 * 通常は rebuildWeights() を通じて呼び出される
 */
function rebuildWeightsImmediate() {
    weightMeshes.forEach(w => {
        leverGroup.remove(w.group);
        disposeObject(w.group);
    });
    weightMeshes = [];
    weightGroups = {};  // グループキャッシュをクリア

    // 古い物理状態をクリアして新しいキーのみ保持
    const newPhysics = {};

    allPositions.forEach(pos => {
        const stack = game.leverData[pos] || [];
        const totalInStack = stack.length;

        if (totalInStack > 0) {
            weightGroups[pos] = [];  // 位置ごとのグループを初期化
        }

        stack.forEach((item, idx) => {
            const distanceFromLever = totalInStack - 1 - idx;

            const mesh = createWeight(item.owner, pos, idx, totalInStack);
            mesh.owner = item.owner;
            mesh.pos = pos;
            mesh.stackIndex = idx;
            mesh.distanceFromLever = distanceFromLever;
            mesh.totalInStack = totalInStack;

            const key = `${pos}_${idx}`;
            // 既存の物理状態があれば引き継ぎ、なければ初期化
            newPhysics[key] = weightPhysics[key] || { angle: 0, velocity: 0 };
            mesh.physicsKey = key;

            leverGroup.add(mesh.group);
            weightMeshes.push(mesh);
            weightGroups[pos].push(mesh);
        });

        // stackIndexの降順でソート（animate関数で毎フレームソートしなくて済むように）
        if (weightGroups[pos]) {
            weightGroups[pos].sort((a, b) => b.stackIndex - a.stackIndex);
        }
    });

    // 古いキーを削除して新しい物理状態で置き換え
    Object.keys(weightPhysics).forEach(key => delete weightPhysics[key]);
    Object.assign(weightPhysics, newPhysics);

    // キーキャッシュを更新（animate関数で毎フレームObject.keys()を呼ばなくて済むように）
    weightGroupsKeys = Object.keys(weightGroups);
}

function createWeight(owner, pos, stackIdx, totalInStack) {
    const group = new THREE.Group();
    // ownerに応じた色を取得
    const colorKey = owner.toUpperCase();
    const colorSet = COLORS[colorKey] || COLORS.NEUTRAL;
    const color = colorSet.primary;
    const emissive = colorSet.emissive;

    const singleRopeLen = 0.5;
    const sphereRadius = 0.42;
    const sphereDiameter = sphereRadius * 2;

    const distFromLever = totalInStack - 1 - stackIdx;
    const chainLength = distFromLever * (singleRopeLen + sphereDiameter);
    const ropeLen = singleRopeLen;

    const rope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, ropeLen, 8),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8 }),
    );
    group.add(rope);

    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(sphereRadius, 32, 32),
        new THREE.MeshStandardMaterial({
            color: color, metalness: 0.9, roughness: 0.1, emissive: emissive, emissiveIntensity: 0.5,
        }),
    );
    sphere.castShadow = true;
    group.add(sphere);

    const hitbox = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 12, 12),
        new THREE.MeshBasicMaterial({ visible: false }),
    );
    sphere.add(hitbox);

    const glowRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.5, 0.04, 8, 32),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.4 }),
    );
    glowRing.rotation.x = Math.PI / 2;
    sphere.add(glowRing);

    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 128;
    labelCanvas.height = 64;
    const ctx = labelCanvas.getContext('2d');
    ctx.fillStyle = UI_COLORS.WHITE;
    ctx.font = 'bold 40px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('10g', 64, 32);

    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const labelSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: labelTexture, transparent: true }),
    );
    labelSprite.scale.set(0.7, 0.35, 1);
    labelSprite.position.y = -0.65;
    sphere.add(labelSprite);

    return { group, sphere, hitbox, rope, ropeLen, chainLength, singleRopeLen, sphereRadius };
}

// ==============================
// ゴースト表示制御
// ==============================
function showAllGhosts() {
    // 現在のプレイヤーの色でゴーストを表示
    const colorKey = game.turn.toUpperCase();
    const playerColorSet = COLORS[colorKey] || COLORS.BLUE;

    allPositions.forEach(pos => {
        const ghost = ghosts[pos];
        const stack = game.leverData[pos] || [];
        // スタック制限をチェック（満杯の位置は吊るせない）
        if (stack.length >= CONFIG.MAX_STACK) {
            // 満杯：×マークを表示、ゴースト自体は薄く表示
            ghost.visible = true;
            ghost.sphere.material.opacity = 0.1;
            ghost.sphere.material.color.setHex(0x666666);
            ghost.sphere.material.emissive.setHex(0x000000);
            ghost.ring.material.opacity = 0.2;
            ghost.ring.material.color.setHex(0x666666);
            if (ghost.fullMark) ghost.fullMark.visible = true;
        } else {
            ghost.visible = true;
            if (ghost.fullMark) ghost.fullMark.visible = false;
            // プレイヤーの色に変更
            ghost.sphere.material.color.setHex(playerColorSet.primary);
            ghost.sphere.material.emissive.setHex(playerColorSet.primary);
            ghost.ring.material.color.setHex(playerColorSet.primary);
            ghost.sphere.material.opacity = 0.3;
            ghost.sphere.material.emissiveIntensity = 0.2;
            ghost.ring.material.opacity = 0.5;
        }
    });
}

function showValidMoveGhosts(fromPos, weightOwner, movingCount = 1) {
    // クリックしたおもりの持ち主の色でゴーストを表示
    const colorKey = weightOwner.toUpperCase();
    const ghostColor = (COLORS[colorKey] || COLORS.NEUTRAL).primary;

    allPositions.forEach(pos => {
        const ghost = ghosts[pos];
        const toStack = game.leverData[pos] || [];
        const wouldExceedLimit = toStack.length + movingCount > CONFIG.MAX_STACK;

        if (isValidMove(fromPos, pos, movingCount)) {
            ghost.visible = true;
            ghost.sphere.material.color.setHex(ghostColor);
            ghost.sphere.material.emissive.setHex(ghostColor);
            ghost.sphere.material.opacity = 0.4;
            ghost.sphere.material.emissiveIntensity = 0.3;
            ghost.ring.material.color.setHex(ghostColor);
            ghost.ring.material.opacity = 0.6;
            if (ghost.fullMark) ghost.fullMark.visible = false;
        } else if (wouldExceedLimit) {
            // 満杯または移動数超過：×マーク表示
            ghost.visible = true;
            ghost.sphere.material.opacity = 0.1;
            ghost.sphere.material.color.setHex(0x666666);
            ghost.sphere.material.emissive.setHex(0x000000);
            ghost.ring.material.opacity = 0.2;
            ghost.ring.material.color.setHex(0x666666);
            if (ghost.fullMark) ghost.fullMark.visible = true;
        } else {
            ghost.visible = false;
            if (ghost.fullMark) ghost.fullMark.visible = false;
        }
    });
}

function highlightGhost(pos) {
    if (hoveredGhost && hoveredGhost !== ghosts[pos]) {
        resetGhostHighlight(hoveredGhost);
    }
    const ghost = ghosts[pos];
    if (ghost && ghost.visible) {
        // HANGフェーズの場合はプレイヤーカラー、MOVEフェーズの場合は緑を維持
        if (game.phase === 'hang') {
            const colorKey = game.turn.toUpperCase();
            const playerColorSet = COLORS[colorKey] || COLORS.BLUE;
            ghost.sphere.material.color.setHex(playerColorSet.primary);
            ghost.sphere.material.emissive.setHex(playerColorSet.primary);
            ghost.ring.material.color.setHex(playerColorSet.primary);
        }
        ghost.sphere.material.opacity = 0.8;
        ghost.sphere.material.emissiveIntensity = 0.8;
        ghost.ring.material.opacity = 1.0;
        ghost.scale.set(1.2, 1.2, 1.2);
        hoveredGhost = ghost;
    }
}

function resetGhostHighlight(ghost) {
    if (!ghost) return;
    ghost.sphere.material.opacity = 0.3;
    ghost.sphere.material.emissiveIntensity = 0.2;
    ghost.ring.material.opacity = 0.5;
    ghost.scale.set(1, 1, 1);

    // HANGフェーズの場合はプレイヤーカラー、MOVEフェーズの場合は選択中おもりの色を維持
    if (game.phase === 'hang') {
        const colorKey = game.turn.toUpperCase();
        const playerColorSet = COLORS[colorKey] || COLORS.BLUE;
        ghost.sphere.material.color.setHex(playerColorSet.primary);
        ghost.sphere.material.emissive.setHex(playerColorSet.primary);
        ghost.ring.material.color.setHex(playerColorSet.primary);
    } else if (game.phase === 'move' && game.selectedWeight) {
        // MOVEフェーズでは選択中おもりの持ち主の色を維持
        const colorKey = game.selectedWeight.owner.toUpperCase();
        const ownerColorSet = COLORS[colorKey] || COLORS.NEUTRAL;
        ghost.sphere.material.color.setHex(ownerColorSet.primary);
        ghost.sphere.material.emissive.setHex(ownerColorSet.primary);
        ghost.ring.material.color.setHex(ownerColorSet.primary);
    } else {
        ghost.sphere.material.color.setHex(ghost.baseColor);
        ghost.sphere.material.emissive.setHex(ghost.baseColor);
        ghost.ring.material.color.setHex(ghost.baseColor);
    }
}

function hideAllGhosts() {
    allPositions.forEach(pos => {
        const ghost = ghosts[pos];
        ghost.visible = false;
        ghost.sphere.material.color.setHex(ghost.baseColor);
        ghost.sphere.material.emissive.setHex(ghost.baseColor);
        ghost.ring.material.color.setHex(ghost.baseColor);
        ghost.scale.set(1, 1, 1);
        if (ghost.fullMark) ghost.fullMark.visible = false;
    });
    hoveredGhost = null;
}

// ==============================
// UI
// ==============================
function updateUI() {
    const playerNames = { blue: 'P1', yellow: 'P2', red: 'P3', green: 'P4' };
    const points = calcPlayerPoints();

    PLAYER_ORDER.forEach((player, _idx) => {
        const panel = document.getElementById(`panel-${player}`);
        const stockEl = document.getElementById(`stock-${player}`);
        const pointsEl = document.getElementById(`points-${player}`);
        const nameEl = document.getElementById(`name-${player}`);

        if (!panel) return;

        // 参加していないプレイヤーは非表示（配分が0のプレイヤー）
        const dist = DISTRIBUTIONS[game.playerCount];
        // ゲーム開始前はdistが未定義の可能性があるのでチェック
        if (!dist) {
            panel.classList.add('hidden');
            return;
        }
        if (dist[player] === 0) {
            panel.classList.add('hidden');
            return;
        }

        panel.classList.remove('hidden');
        panel.classList.toggle('active', game.turn === player && !game[player].eliminated);
        panel.classList.toggle('eliminated', game[player].eliminated);

        stockEl.textContent = game[player].stock;
        if (pointsEl) pointsEl.textContent = points[player];

        // 名前設定（人間/CPU判定）
        const humanPlayers = PLAYER_ORDER.slice(0, game.humanCount);
        const isHuman = humanPlayers.includes(player);
        if (game.humanCount === 1) {
            nameEl.textContent = isHuman ? 'YOU' : 'CPU';
        } else {
            nameEl.textContent = isHuman ? playerNames[player] : 'CPU';
        }
    });
}

// ==============================
// ゲーム終了処理 - ヘルパー関数群（SRP適用）
// ==============================

/**
 * 勝利/敗北エフェクトを再生
 * @param {boolean} isWin - 勝利かどうか
 * @param {number} impactIntensity - インパクトの強度
 */
function playEndGameEffects(isWin, impactIntensity = 150) {
    if (isWin) {
        showScreenFlash('win');
        playSound('win');
        createConfetti(CONFIG.CONFETTI_COUNT);
        triggerImpactPause(impactIntensity);
    } else {
        showScreenFlash('lose');
        playSound('gameover');
        triggerImpactPause(impactIntensity);
    }
}

/**
 * ドロー結果の処理
 */
function handleDrawResult(elements, ctx) {
    const { icon, title, detail } = elements;
    const { points, humanPlayers, pointsHtml, balanceHtml, leverStateHtml } = ctx;
    const humanStillActive = humanPlayers.some(p => game.activePlayers.includes(p));

    if (!humanStillActive) {
        icon.textContent = '💀';
        title.textContent = 'GAME OVER';
        title.className = 'result-title lose';
        detail.innerHTML = `
            <div style="margin-bottom:12px;">脱落してしまった...CPUの勝利！</div>
            <div style="background:rgba(255,51,102,0.1);border:1px solid #ff5577;border-radius:8px;padding:12px;margin-bottom:8px;">
                <div style="font-size:0.85rem;color:#ff5577;margin-bottom:4px;">💀 バランスを崩して脱落...</div>
            </div>
            ${pointsHtml}${leverStateHtml}`;
        playEndGameEffects(false, 100);
        return;
    }

    const sortedPlayers = [...game.activePlayers].sort((a, b) => points[b] - points[a]);
    const topPoint = points[sortedPlayers[0]];
    const topPlayers = sortedPlayers.filter(p => points[p] === topPoint);

    if (topPlayers.length === 1) {
        handlePointWinner(elements, ctx, topPlayers[0], topPoint);
    } else {
        icon.textContent = '🤝';
        title.textContent = 'DRAW!';
        title.className = 'result-title win';
        detail.innerHTML = `
            <div style="margin-bottom:12px;">最後までバランスキープ！ポイントも同点！</div>
            ${pointsHtml}${balanceHtml}${leverStateHtml}`;
        showScreenFlash('win');
        playSound('balance');
        triggerImpactPause(100);
    }
}

/**
 * ポイント勝者の処理
 */
function handlePointWinner(elements, ctx, pointWinner, topPoint) {
    const { icon, title, detail } = elements;
    const { humanPlayers, pointsHtml, balanceHtml, leverStateHtml } = ctx;
    const winnerMeta = PLAYER_META[pointWinner];
    const isHuman = humanPlayers.includes(pointWinner);

    if (isHuman) {
        icon.textContent = '🏆';
        title.textContent = game.humanCount === 1 ? 'VICTORY!' : `${winnerMeta.displayName} WINS!`;
        title.className = 'result-title win';
        detail.innerHTML = `
            <div style="margin-bottom:12px;">最後までバランスキープ！ポイント勝負で勝ち！</div>
            <div style="background:rgba(0,255,136,0.1);border:1px solid #00ff88;border-radius:8px;padding:12px;margin-bottom:8px;">
                <div style="font-size:0.9rem;color:#00ff88;margin-bottom:4px;">🎯 1位</div>
                <div style="font-family:'Orbitron',sans-serif;font-size:1.2rem;color:${winnerMeta.cssColor};">${winnerMeta.displayName} - ${topPoint} PT</div>
            </div>
            ${pointsHtml}${balanceHtml}${leverStateHtml}`;
        playEndGameEffects(true, 150);
    } else {
        icon.textContent = '💀';
        title.textContent = 'GAME OVER';
        title.className = 'result-title lose';
        detail.innerHTML = `
            <div style="margin-bottom:12px;">最後までバランスキープ...でもポイント負け！</div>
            <div style="background:rgba(255,51,102,0.1);border:1px solid #ff5577;border-radius:8px;padding:12px;margin-bottom:8px;">
                <div style="font-size:0.9rem;color:#ff5577;margin-bottom:4px;">💀 1位はCPU...</div>
                <div style="font-family:'Orbitron',sans-serif;font-size:1.2rem;color:${winnerMeta.cssColor};">${winnerMeta.displayName} - ${topPoint} PT</div>
            </div>
            ${pointsHtml}${balanceHtml}${leverStateHtml}`;
        playEndGameEffects(false, 100);
    }
}

/**
 * 全員脱落結果の処理
 */
function handleAllOutResult(elements, ctx) {
    const { icon, title, detail } = elements;
    const { pointsHtml, leverStateHtml } = ctx;
    icon.textContent = '💥';
    title.textContent = 'ALL OUT!';
    title.className = 'result-title lose';
    detail.innerHTML = `
        <div style="margin-bottom:12px;">全員脱落！勝者なし...</div>
        <div style="background:rgba(255,51,102,0.1);border:1px solid #ff5577;border-radius:8px;padding:12px;margin-bottom:8px;">
            <div style="font-size:0.85rem;color:#ff5577;margin-bottom:4px;">💀 誰もバランスを保てなかった...</div>
        </div>
        ${pointsHtml}${leverStateHtml}`;
    playEndGameEffects(false, 100);
}

/**
 * 勝者ありの結果処理
 */
function handleWinnerResult(elements, ctx, winner) {
    const { icon, title, detail } = elements;
    const { points, humanPlayers, pointsHtml, leverStateHtml } = ctx;
    const winnerMeta = PLAYER_META[winner];
    const winnerPoint = points[winner];
    const isWinnerHuman = humanPlayers.includes(winner);

    if (isWinnerHuman) {
        icon.textContent = '🏆';
        title.textContent = game.humanCount === 1 ? 'VICTORY!' : `${winnerMeta.displayName} WINS!`;
        title.className = 'result-title win';
        const playerName = game.humanCount === 1 ? 'あなた' : winnerMeta.displayName;
        detail.innerHTML = `
            <div style="margin-bottom:12px;">${winnerMeta.icon} <strong>${playerName}</strong>が最後まで生き残った！</div>
            <div style="background:rgba(0,255,136,0.1);border:1px solid #00ff88;border-radius:8px;padding:12px;margin-bottom:8px;">
                <div style="font-size:0.85rem;color:#00ff88;margin-bottom:4px;">🏅 獲得ポイント</div>
                <div style="font-family:'Orbitron',sans-serif;font-size:1.2rem;">${winnerPoint} PT</div>
            </div>
            ${pointsHtml}${leverStateHtml}`;
        playEndGameEffects(true, 150);
    } else {
        icon.textContent = '💀';
        title.textContent = 'GAME OVER';
        title.className = 'result-title lose';
        detail.innerHTML = `
            <div style="margin-bottom:12px;">CPUが最後まで生き残った...</div>
            <div style="background:rgba(255,51,102,0.1);border:1px solid #ff5577;border-radius:8px;padding:12px;margin-bottom:8px;">
                <div style="font-size:0.85rem;color:#ff5577;margin-bottom:4px;">💀 脱落してしまった...</div>
            </div>
            ${pointsHtml}${leverStateHtml}`;
        playEndGameEffects(false, 100);
    }
}

// ==============================
// ゲーム制御
// ==============================
/**
 * ゲーム終了処理のメイン関数
 * @param {string} winner - 勝者（'blue', 'yellow', 'red', 'green', 'draw'）
 */
function endGame(winner) {
    game.isOver = true;
    hideHint();

    // モーメント計算
    const m = calcMoment();
    const points = calcPlayerPoints();

    const icon = document.getElementById(DOM_IDS.RESULT_ICON);
    const title = document.getElementById(DOM_IDS.RESULT_TITLE);
    const detail = document.getElementById(DOM_IDS.RESULT_DETAIL);
    if (!icon || !title || !detail) return;

    // コンテキスト情報を準備
    const elements = { icon, title, detail };
    const ctx = {
        points,
        humanPlayers: PLAYER_ORDER.slice(0, game.humanCount),
        leverStateHtml: generateLeverStateHtml(game.leverData),
        pointsHtml: generatePointsRankingHtml(points, game.activePlayers),
        balanceHtml: generateBalanceInfoHtml(m.left, m.right),
    };

    // てこを元に戻す
    targetLeverAngle = 0;

    // 結果タイプに応じた処理
    if (winner === 'draw') {
        handleDrawResult(elements, ctx);
    } else if (winner === 'all_out') {
        handleAllOutResult(elements, ctx);
    } else {
        handleWinnerResult(elements, ctx, winner);
    }

    // 1秒後に結果画面を表示
    setManagedTimeout(() => {
        const resultOverlay = document.getElementById(DOM_IDS.RESULT_OVERLAY);
        if (resultOverlay) resultOverlay.classList.remove('hidden');
    }, FEEDBACK_CONFIG.RESULT_OVERLAY_DELAY);
}

// ==============================
// ゲーム開始
// ==============================

function startGame(mode) {
    playSound('click');
    startGameInternal(mode);
}

function startGameInternal(mode) {
    game.mode = mode;

    // モードに応じてプレイヤー数を設定
    switch (mode) {
        case 'cpu1':
            game.playerCount = 4;
            game.humanCount = 1;
            break;
        case 'pvp2':
            game.playerCount = 4;
            game.humanCount = 2;
            break;
        case 'pvp3':
            game.playerCount = 4;
            game.humanCount = 3;
            break;
        case 'pvp4':
            game.playerCount = 4;
            game.humanCount = 4;
            break;
    }

    const startOverlay = document.getElementById('start-overlay');
    if (startOverlay) startOverlay.classList.add('hidden');

    // ランダムスタートルーレット演出を開始
    showStartRoulette();
}

// スタートプレイヤー抽選ルーレット
function showStartRoulette() {
    const overlay = document.getElementById('roulette-overlay');
    const wheel = document.getElementById('roulette-wheel');
    const resultEl = document.getElementById('roulette-result');
    const orderEl = document.getElementById('roulette-order');

    if (!overlay || !wheel || !resultEl || !orderEl) return;

    // リセット
    resultEl.classList.remove('show');
    orderEl.classList.remove('show');
    wheel.querySelectorAll('.roulette-player').forEach(el => {
        el.classList.remove('highlight', 'selected');
    });

    overlay.classList.remove('hidden');

    // ランダムで先攻を決定
    const randomStartIndex = Math.floor(Math.random() * 4);
    const players = ['blue', 'yellow', 'red', 'green'];
    const playerNames = { blue: 'P1', yellow: 'P2', red: 'P3', green: 'P4' };
    const playerEmojis = { blue: '⚡', yellow: '⭐', red: '🔥', green: '🍀' };

    // ルーレットアニメーション（再帰的setTimeoutで速度変化を実現）
    let currentIndex = 0;
    let speed = CONFIG.ROULETTE_INITIAL_SPEED;
    const rounds = CONFIG.ROULETTE_ROUNDS;
    // +1 で最後のハイライトが選択プレイヤーと一致するように
    const totalSteps = rounds * 4 + randomStartIndex + 1;
    let step = 0;

    function rouletteStep() {
        // 前のハイライトを消す
        wheel.querySelectorAll('.roulette-player').forEach(el => {
            el.classList.remove('highlight');
        });

        // 現在のプレイヤーをハイライト
        const currentPlayer = players[currentIndex % 4];
        const playerEl = wheel.querySelector(`[data-player="${currentPlayer}"]`);
        if (playerEl) playerEl.classList.add('highlight');

        playSound('click');

        currentIndex++;
        step++;

        // 終了判定
        if (step >= totalSteps) {
            // 最終選択: まず全員のハイライトを確実に削除
            wheel.querySelectorAll('.roulette-player').forEach(el => {
                el.classList.remove('highlight');
            });

            // 選ばれたプレイヤーのみselectedを追加
            const selectedPlayer = players[randomStartIndex];
            const selectedEl = wheel.querySelector(`[data-player="${selectedPlayer}"]`);
            if (selectedEl) selectedEl.classList.add('selected');

            playSound('win');

            // 人間かCPUかを判定
            const humanPlayers = PLAYER_ORDER.slice(0, game.humanCount);
            const isHuman = humanPlayers.includes(selectedPlayer);
            const displayName = isHuman ?
                (game.humanCount === 1 ? 'あなた' : playerNames[selectedPlayer]) :
                `CPU (${playerNames[selectedPlayer]})`;

            // 結果表示
            setRouletteTimeout(() => {
                resultEl.innerHTML = `${playerEmojis[selectedPlayer]} <strong>${displayName}</strong> が先攻！`;
                resultEl.classList.add('show');

                // 順番表示（時計回り）
                const orderPlayers = [];
                for (let i = 0; i < 4; i++) {
                    const idx = (randomStartIndex + i) % 4;
                    orderPlayers.push(playerNames[players[idx]]);
                }
                orderEl.innerHTML = `順番: ${orderPlayers.join(' → ')}`;
                orderEl.classList.add('show');
            }, CONFIG.ROULETTE_RESULT_DELAY);

            // ゲーム開始
            setRouletteTimeout(() => {
                overlay.classList.add('hidden');
                resetGame(randomStartIndex);
                showHint('💡 おもりをドラッグ！', '光る場所に置くと吊るせるよ');
            }, CONFIG.ROULETTE_START_DELAY);
            return;
        }

        // 徐々に遅くする
        if (step > totalSteps - 6) speed += CONFIG.ROULETTE_SLOWDOWN_1;
        if (step > totalSteps - 3) speed += CONFIG.ROULETTE_SLOWDOWN_2;

        // 次のステップを予約
        setRouletteTimeout(rouletteStep, speed);
    }

    // 最初のステップを開始
    setRouletteTimeout(rouletteStep, speed);
}

function backToStart() {
    playSound('click');
    // 全てのタイムアウトをクリア
    clearAllRouletteTimeouts();
    clearAllCpuTimeouts();
    // オーバーレイを適切に表示/非表示
    const startOverlay = document.getElementById('start-overlay');
    const resultOverlay = document.getElementById('result-overlay');
    const rouletteOverlay = document.getElementById('roulette-overlay');
    if (startOverlay) startOverlay.classList.remove('hidden');
    if (resultOverlay) resultOverlay.classList.add('hidden');
    if (rouletteOverlay) rouletteOverlay.classList.add('hidden');
    hideHint();
    resetGame(0);
}

// ゲームリセット（startIndex: 先攻プレイヤーのインデックス、デフォルト0=blue）
function resetGame(startIndex = 0) {
    // 前のゲームのCPUタイムアウトをクリア
    clearAllCpuTimeouts();

    game.turnIndex = startIndex;
    game.turn = PLAYER_ORDER[startIndex];
    game.phase = 'hang';

    // 駒配分設定
    const dist = DISTRIBUTIONS[game.playerCount];

    // 各プレイヤーの初期化
    PLAYER_ORDER.forEach(player => {
        const totalWeights = dist[player] || 0;
        game[player].stock = totalWeights;
        game[player].eliminated = totalWeights === 0;
    });

    // 生存プレイヤーリスト
    game.activePlayers = PLAYER_ORDER.filter(p => !game[p].eliminated);

    // 初期配置：中立おもりを±3に配置（常にバランス）
    game.leverData = {};
    game.leverData[-3] = [{ owner: 'neutral' }];
    game.leverData[3] = [{ owner: 'neutral' }];

    game.isOver = false;
    game.isJudging = false;
    game.selectedWeight = null;
    game.isDragging = false;
    game.currentTurnHungPos = null;
    game.currentTurnHungOwner = null;
    game.turnCount = 0;
    leverAngle = 0;
    targetLeverAngle = 0;
    leverAngularVelocity = 0;

    // 演出フィードバックの状態もリセット
    targetTension = 0;
    currentTension = 0;
    isNearBalance = false;
    wasNearBalance = false;
    dramaticFovOffset = 0;
    eliminationFocusUntil = 0;
    currentLookAtX = 0;

    Object.keys(weightPhysics).forEach((key) => {
        weightPhysics[key] = { angle: 0, velocity: 0 };
    });

    rebuildWeights();
    createStockWeights();
    hideAllGhosts();
    updateMomentDisplay();
    updateUI();
    updatePhaseUI();

    // CPUターンの場合は自動開始
    if (isCurrentPlayerCPU() && !game.isOver) {
        setCpuTimeout(cpuTurn, getCpuDelay(game.turn));
    }
}

// 現在のプレイヤーがCPUかどうか
function isCurrentPlayerCPU() {
    const humanPlayers = PLAYER_ORDER.slice(0, game.humanCount);
    return !humanPlayers.includes(game.turn);
}

// モーダル管理用ヘルパー
function toggleModal(modalId, show) {
    playSound('click');
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.toggle('hidden', !show);
}


function openHelp() { toggleModal('help-modal', true); }

function closeHelp() { toggleModal('help-modal', false); }

function openLearn() { toggleModal('learn-modal', true); }

function closeLearn() { toggleModal('learn-modal', false); }
function closeExitModal() { toggleModal('exit-modal', false); }

function confirmExit() {
    // スタート画面が表示中なら何もしない
    const startOverlay = document.getElementById('start-overlay');
    if (!startOverlay || !startOverlay.classList.contains('hidden')) return;
    toggleModal('exit-modal', true);
}


function exitGame() {
    closeExitModal();
    game.isOver = true;
    backToStart();
}

// ==============================
// 動的カメラ計算（てこが画面に収まるよう自動調整）
// iOS PWA対応: アスペクト比に応じてテコが潰れないように調整
// ==============================
// 実際の3D空間の範囲:
// - てこ: X = ±11.2 (位置±8 × UNIT 1.4)
// - ストックおもり: X = ±6, Y = 2.5
// - 吊るされたおもり: Y = -0.3 to -6 (スタック時)
// - 合計Y範囲: 2.5 - (-6) = 8.5
const LEVER_WIDTH = 18;      // てこ+ストックの横幅（余裕含む）
const LEVER_HEIGHT = 11;     // ストックから吊るされたおもりまでの縦範囲
const CAMERA_PADDING = 1.15; // 余白係数（15%の余裕で画面いっぱいに表示）

function calculateOptimalCamera(effectiveWidth, effectiveHeight, aspect) {
    // 基準FOV（度）- 広角でカメラを近づける
    let baseFov = 65;  // 広角化（55→65）

    // スマホ横画面の判定（縦が狭い & 横長アスペクト）
    // iOS PWA: safe-area適用後のサイズで判定
    const isLandscapeMobile = effectiveHeight < 500 && aspect > 1.5;
    const isUltraWide = aspect > 2.0;  // iPhone等の超ワイド画面
    const isTablet = effectiveWidth >= 768 && effectiveHeight >= 600; // タブレット判定

    if (isLandscapeMobile) {
        // 横画面スマホ: FOVを広げてゲーム全体を表示
        if (isUltraWide) {
            // iPhone等の超ワイド（Foldableスマホ含む）: FOVをさらに広げる
            baseFov = Math.min(75, 65 + (aspect - 2.0) * 10);
        } else {
            // 通常の横画面スマホ
            baseFov = Math.min(70, 62 + (aspect - 1.5) * 8);
        }
    } else if (isTablet) {
        // タブレット: 広角
        baseFov = 60;
    }

    const fovRad = (baseFov * Math.PI) / 180;

    // てこ全体が見える距離を計算
    // 横方向: distance = (width/2) / tan(fov/2) / aspect
    // 縦方向: distance = (height/2) / tan(fov/2)
    const halfWidth = (LEVER_WIDTH * CAMERA_PADDING) / 2;
    const halfHeight = (LEVER_HEIGHT * CAMERA_PADDING) / 2;

    const distForWidth = halfWidth / Math.tan(fovRad / 2) / aspect;
    const distForHeight = halfHeight / Math.tan(fovRad / 2);

    // スマホ横画面では横幅優先、それ以外は大きい方を採用
    let optimalZ;
    if (isLandscapeMobile) {
        // 横画面スマホ: 横幅を収める距離を基準に
        // ただし、テコが縦方向に潰れないよう最低限の距離を確保
        const minZForHeight = distForHeight * 0.65;  // 縦方向の最低限（0.6→0.65）
        optimalZ = Math.max(distForWidth, minZForHeight);
    } else {
        optimalZ = Math.max(distForWidth, distForHeight);
    }

    // 最小・最大制限（デバイス別に最適化 - カメラを近づける）
    let minZ;
    if (isLandscapeMobile) {
        minZ = isUltraWide ? 7 : 8;  // 横画面スマホ: 近づける（9,10→7,8）
    } else if (isTablet) {
        minZ = 8;  // タブレット: 近づける（11→8）
    } else {
        minZ = 8;  // PC・縦スマホ: 近づける（10→8）
    }
    optimalZ = Math.max(minZ, Math.min(optimalZ, 25));

    // 画面が小さい場合の追加調整（縦スマホ）
    let fov = baseFov;
    if (!isLandscapeMobile && !isTablet) {
        // 縦スマホ: 画面高さに応じてFOVを調整
        if (effectiveHeight < 600) {
            fov = Math.max(baseFov, 68);  // FOVを広げて全体を表示（58→68）
            optimalZ *= 0.9;  // さらに近づける（0.95→0.9）
        } else if (effectiveHeight < 700) {
            fov = Math.max(baseFov, 66);  // 56→66
        }
    }

    // カメラY位置の最適化
    // ベストプラクティス: 斜め上から見下ろす角度で立体感を出す
    // 視覚範囲: ストックおもり（Y=2.5）からおもり下部（Y=-6）まで
    // lookAtターゲット: ゲームの中心（Y=-2）
    let baseY;
    if (isLandscapeMobile) {
        // スマホ横画面: コンパクトな見下ろし角度
        baseY = isUltraWide ? 2.8 : 3.2;  // 少し高めに調整
    } else if (isTablet) {
        // タブレット: ゆったりとした見下ろし角度
        baseY = 4;
    } else if (effectiveHeight < 600) {
        // 小さい縦スマホ: 適度な見下ろし角度
        baseY = 3.2;
    } else {
        // PC・大きい画面: ゆったりとした見下ろし角度
        baseY = 4.5;
    }

    // ユーザー設定のFOVオフセットを適用（範囲：-10〜+10度）
    fov = Math.max(50, Math.min(80, fov + userFovOffset));

    return { z: optimalZ, fov, baseY };
}

function onResize() {
    // レンダラーが初期化されていない場合はスキップ
    if (!renderer || !camera) return;

    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;

    // キャンバスの実際のサイズを取得（CSS適用後）
    const rect = canvas.getBoundingClientRect();
    let w = rect.width;
    let h = rect.height;

    // CSSデフォルト値(300x150)または異常に小さい場合はwindow sizeを使用
    if (w <= 300 || h <= 150) {
        w = window.innerWidth;
        h = window.innerHeight;
    }

    const aspect = w / h;

    // カメラのアスペクト比を更新
    camera.aspect = aspect;

    // 動的にカメラ設定を計算
    const { z, fov, baseY } = calculateOptimalCamera(w, h, aspect);

    // 基準値を更新
    cameraBaseY = baseY;
    cameraBaseZ = z;
    cameraBaseFov = fov;

    // 現在のゲーム状態（スタック数）を取得してカメラ位置を調整
    const { maxStack } = calculateGameState();
    const extraZ = Math.max(0, maxStack - CAMERA_DYNAMICS.STACK_THRESHOLD) * CAMERA_DYNAMICS.Z_DISTANCE_PER_STACK;
    const extraY = Math.max(0, maxStack - CAMERA_DYNAMICS.STACK_THRESHOLD) * CAMERA_DYNAMICS.Y_OFFSET_PER_STACK;

    // カメラ位置をゲーム状態に合わせて設定（ガクつき防止）
    camera.position.x = 0;  // 操作性重視: 真正面から
    camera.position.z = z + extraZ;
    camera.position.y = baseY - extraY;

    // FOVとlookAtも同様に設定
    targetFov = fov;
    currentFov = fov;
    currentLookAtY = -0.5;
    currentLookAtX = 0;
    camera.fov = fov;

    // てこの原理を理解しやすい視点: 支点付近を見る
    camera.lookAt(0, currentLookAtY, 0);

    camera.updateProjectionMatrix();

    // ベストプラクティス: デバイスに応じた最適なpixelRatioを設定
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || w < 768;
    const pixelRatio = isMobile ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);  // CSSサイズはスタイルシートで管理
}

// ==============================
// インパクトポーズ（衝撃時の一時停止）
// ==============================
let impactPauseUntil = 0;

function triggerImpactPause(duration = 60) {
    impactPauseUntil = Date.now() + duration;
}

// ==============================
// アニメーション - ヘルパー関数
// ==============================

/**
 * ゲーム状態からスタック情報を計算
 * @returns {{maxStack: number}} スタック情報
 */
function calculateGameState() {
    let maxStack = 0;
    for (let i = 0; i < allPositions.length; i++) {
        const stack = game.leverData[allPositions[i]];
        if (stack && stack.length > 0) {
            maxStack = Math.max(maxStack, stack.length);
        }
    }
    return { maxStack };
}

/**
 * カメラの位置とFOVを更新
 * @param {number} maxStack - 最大スタック数
 */
function updateCameraPosition(maxStack) {
    // D-5: 脱落直後は支点へ寄って「なぜ倒れたか」を見せる
    const isEliminationFocus = Date.now() < eliminationFocusUntil;

    // カメラ距離: おもりが多いほど引く
    const extraZ = Math.max(0, maxStack - CAMERA_DYNAMICS.STACK_THRESHOLD) * CAMERA_DYNAMICS.Z_DISTANCE_PER_STACK;
    const dollyZ = isEliminationFocus ? FEEDBACK_CONFIG.ELIMINATION_DOLLY_Z : 0;
    const targetZ = cameraBaseZ + extraZ - dollyZ;

    // カメラ高さ: おもりの範囲を見やすく
    const extraY = Math.max(0, maxStack - CAMERA_DYNAMICS.STACK_THRESHOLD) * CAMERA_DYNAMICS.Y_OFFSET_PER_STACK;
    const targetY = cameraBaseY - extraY;

    // スムーズなカメラ移動（Z軸とY軸で異なる速度）
    camera.position.z += (targetZ - camera.position.z) * CAMERA_DYNAMICS.POSITION_LERP_Z;
    const smoothY = camera.position.y + (targetY - camera.position.y) * CAMERA_DYNAMICS.POSITION_LERP_Y;

    // カメラシェイク
    if (cameraShake.intensity > 0.01) {
        cameraShake.x = (Math.random() - 0.5) * cameraShake.intensity;
        cameraShake.y = (Math.random() - 0.5) * cameraShake.intensity;
        cameraShake.intensity *= 0.9;
    } else {
        cameraShake.x = 0;
        cameraShake.y = 0;
    }

    camera.position.x = cameraShake.x;
    camera.position.y = smoothY + cameraShake.y;

    // 動的FOV調整
    let fovBase = cameraBaseFov;
    if (draggedStock) {
        fovBase += CAMERA_DYNAMICS.FOV_ZOOM_IN;
    }
    // D-1: 傾くほど広角にして不安定さを強調する
    fovBase += currentTension * FEEDBACK_CONFIG.TENSION_FOV_MAX;
    // D-4: 終盤はわずかに寄って緊張感を出す
    if (getGameStage() === 'endgame') {
        fovBase -= FEEDBACK_CONFIG.ENDGAME_FOV_TIGHTEN;
    }
    // 演出用オフセット（勝敗・脱落時）を加算する
    targetFov = fovBase + dramaticFovOffset;

    const prevFov = currentFov;
    currentFov += (targetFov - currentFov) * CAMERA_DYNAMICS.FOV_LERP;

    if (Math.abs(currentFov - prevFov) > CAMERA_DYNAMICS.FOV_UPDATE_THRESHOLD) {
        camera.fov = currentFov;
        camera.updateProjectionMatrix();
    }

    // 動的lookAtターゲット（滑らかに補間）
    // D-3: 重い側（下がっている側）へ視線を寄せる。
    // leverAngle > 0 は左が下がっている状態なので、lookAtX は負（左）へ向ける。
    const tiltRatio = PHYSICS.MAX_TILT === 0 ? 0 : leverAngle / PHYSICS.MAX_TILT;
    const lookAtBoost = isEliminationFocus ? FEEDBACK_CONFIG.ELIMINATION_LOOKAT_BOOST : 1;
    let lookAtX = -tiltRatio * FEEDBACK_CONFIG.LOOKAT_X_MAX * lookAtBoost;
    let targetLookAtY = maxStack > CAMERA_DYNAMICS.STACK_THRESHOLD
        ? CAMERA_DYNAMICS.LOOKAT_Y_STACKED : CAMERA_DYNAMICS.LOOKAT_Y_NORMAL;

    // ドラッグ中は掴んでいるおもりを追う（傾き追従より操作性を優先）
    if (draggedStock && draggedStock.visible) {
        lookAtX = draggedStock.position.x * CAMERA_DYNAMICS.DRAG_FOLLOW_X;
        targetLookAtY = draggedStock.position.y * CAMERA_DYNAMICS.DRAG_FOLLOW_Y;
    }

    // lookAtYを滑らかに補間
    currentLookAtY += (targetLookAtY - currentLookAtY) * CAMERA_DYNAMICS.LOOKAT_LERP;
    // lookAtXも補間して急な振れを防ぐ
    currentLookAtX += (lookAtX - currentLookAtX) * CAMERA_DYNAMICS.LOOKAT_LERP;
    camera.lookAt(currentLookAtX, currentLookAtY, 0);
}

/**
 * D-2: 支点のリングでつり合い状態を示す
 * 明るく静止 = つり合い / 脈動 = あと少し / 暗い = 崩れている
 * @param {number} time - 経過時間(秒)
 */
function updatePivotFeedback(time) {
    if (!pivotGlowRing) return;

    const material = pivotGlowRing.material;

    if (currentTension < 0.001) {
        // つり合い：明るく静止
        material.opacity = 1;
        pivotGlowRing.scale.set(1, 1, 1);
    } else if (isNearBalance) {
        // あと少し：脈動して「近い」ことを知らせる
        const wave = Math.sin(time * FEEDBACK_CONFIG.NEAR_BALANCE_PULSE_SPEED);
        const pulse = 1 + wave * FEEDBACK_CONFIG.NEAR_BALANCE_PULSE_AMOUNT;
        material.opacity = 0.65 + wave * 0.35;
        pivotGlowRing.scale.set(pulse, pulse, 1);
    } else {
        // 崩れている：ズレが大きいほど暗くなる
        material.opacity = Math.max(0.15, 1 - currentTension * 0.85);
        pivotGlowRing.scale.set(1, 1, 1);
    }
}

/**
 * 振り子の物理演算を更新
 * @param {boolean} isPaused - ポーズ中かどうか
 */
function updatePendulumPhysics(isPaused) {
    const { G, ROPE_LEN, SPHERE_R, PEND_DAMP, DT, UNIT, PEND_INERTIA_COEF } = PHYSICS;
    const cosLever = Math.cos(leverAngle);
    const sinLever = Math.sin(leverAngle);
    const cosNeg = Math.cos(-leverAngle);
    const sinNeg = Math.sin(-leverAngle);

    for (let gi = 0; gi < weightGroupsKeys.length; gi++) {
        const posKey = weightGroupsKeys[gi];
        const chain = weightGroups[posKey];
        if (!chain || chain.length === 0) continue;

        const pos = parseInt(posKey, 10);
        const leverLocalX = pos * UNIT;
        const leverLocalY = -0.15;
        let anchorWorldX = leverLocalX * cosLever - leverLocalY * sinLever;
        let anchorWorldY = leverLocalX * sinLever + leverLocalY * cosLever;
        const armLength = Math.abs(pos) * UNIT;

        for (let ci = 0; ci < chain.length; ci++) {
            const w = chain[ci];
            const ph = weightPhysics[w.physicsKey];
            if (!ph) continue;

            if (!isPaused) {
                const gravityAccel = -(G / ROPE_LEN) * Math.sin(ph.angle);
                const inertialAccel = -leverAngularVelocity * armLength * PEND_INERTIA_COEF;
                ph.velocity += (gravityAccel + inertialAccel) * DT;
                ph.velocity *= PEND_DAMP;
                ph.angle += ph.velocity * DT;

                if (ph.angle > 0.6) {
                    ph.angle = 0.6;
                    ph.velocity *= -0.5;
                } else if (ph.angle < -0.6) {
                    ph.angle = -0.6;
                    ph.velocity *= -0.5;
                }
            }

            const ropeEndX = anchorWorldX + Math.sin(ph.angle) * ROPE_LEN;
            const ropeEndY = anchorWorldY - Math.cos(ph.angle) * ROPE_LEN;
            const sphereX = ropeEndX;
            const sphereY = ropeEndY - SPHERE_R;

            const ropeMidX = (anchorWorldX + ropeEndX) / 2;
            const ropeMidY = (anchorWorldY + ropeEndY) / 2;

            const ropeLocalX = ropeMidX * cosNeg - ropeMidY * sinNeg;
            const ropeLocalY = ropeMidX * sinNeg + ropeMidY * cosNeg;
            w.rope.position.set(ropeLocalX, ropeLocalY, 0);
            w.rope.rotation.z = ph.angle - leverAngle;

            const sphereLocalX = sphereX * cosNeg - sphereY * sinNeg;
            const sphereLocalY = sphereX * sinNeg + sphereY * cosNeg;
            w.sphere.position.set(sphereLocalX, sphereLocalY, 0);

            anchorWorldX = sphereX;
            anchorWorldY = sphereY - SPHERE_R;
        }
    }
}

// ==============================
// アニメーション - メイン
// ==============================
function animate() {
    requestAnimationFrame(animate);
    if (!camera || !renderer || !scene) return;

    const isPaused = Date.now() < impactPauseUntil;
    const { maxStack } = calculateGameState();

    // D-1: tension を滑らかに追従させる（音・カメラ・光の共通駆動値）
    currentTension += (targetTension - currentTension) * TENSION_LERP;

    // BGMのカットオフ更新は毎フレーム不要なので間引く
    bgmTensionFrameCount++;
    if (bgmTensionFrameCount >= BGM_TENSION_UPDATE_INTERVAL) {
        bgmTensionFrameCount = 0;
        updateBgmTension();
    }

    // カメラ更新
    updateCameraPosition(maxStack);

    // ストックおもりパルス
    const t = Date.now() * 0.003;
    for (let i = 0; i < stockWeightsArray.length; i++) {
        const stock = stockWeightsArray[i];
        if (stock && stock.visible && !draggedStock) {
            const pulse = 1 + Math.sin(t) * 0.1;
            stock.scale.set(pulse, pulse, pulse);
            stock.position.y = 2.5 + Math.sin(t * 1.5) * 0.2;
        }
    }

    // てこの傾き更新
    const { DT, MAX_TILT, LEVER_SPEED } = PHYSICS;
    if (!isPaused) {
        const angleDelta = (targetLeverAngle - leverAngle) * LEVER_SPEED;
        leverAngularVelocity = angleDelta / DT;
        leverAngle += angleDelta;
    }
    leverAngle = Math.max(-MAX_TILT, Math.min(MAX_TILT, leverAngle));
    leverGroup.rotation.z = leverAngle;

    // 振り子の物理演算
    updatePendulumPhysics(isPaused);

    // D-2: 支点リングでつり合い状態を示す
    updatePivotFeedback(Date.now() * 0.001);

    // ゴーストアニメーション
    const gt = Date.now() * 0.003;
    for (let i = 0; i < ghostsArray.length; i++) {
        const ghost = ghostsArray[i];
        if (ghost.visible && ghost !== hoveredGhost) {
            ghost.ring.rotation.z = gt;
            const scale = 1 + Math.sin(gt * 2 + ghost.userData.pos) * 0.05;
            ghost.ring.scale.set(scale, scale, 1);
        }
    }

    renderer.render(scene, camera);
}

// スマホ縦画面チェック
function checkDevice() {
    const o = document.getElementById('device-overlay');
    if (!o) return;
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    // Note: window.orientation is deprecated but kept as fallback for older browsers
    const portrait = screen.orientation ? screen.orientation.type.includes('portrait') :
        typeof window.orientation !== 'undefined' ? (window.orientation === 0 || window.orientation === 180) :
            window.innerHeight > window.innerWidth;
    // screen.widthが取得できない場合はwindow.innerWidthを使用、それも無ければ小型と仮定
    const screenWidth = screen.width || window.innerWidth || 0;
    const small = screenWidth < 700;
    o.style.display = (touch && portrait && small) ? 'flex' : 'none';
}
window.addEventListener('resize', checkDevice, { passive: true });
window.addEventListener('orientationchange', () => setTimeout(checkDevice, 200), { passive: true });
document.addEventListener('DOMContentLoaded', checkDevice, { passive: true });

// ==============================
// デバイス検出 & インストールガイド
// ==============================
function getDeviceType() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isAndroid = /Android/.test(ua);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                      || window.navigator.standalone === true;
    return { isIOS, isAndroid, isStandalone };
}

function showInstallGuide() {
    const guide = document.getElementById('install-guide');
    const text = document.getElementById('install-text');
    if (!guide || !text) return;

    const { isIOS, isAndroid, isStandalone } = getDeviceType();

    // 既にインストール済み or 閉じた履歴あり
    if (isStandalone || localStorage.getItem('install-guide-closed')) {
        guide.style.display = 'none';
        return;
    }

    if (isIOS) {
        text.innerHTML = '全画面でプレイ！<br><b>共有 → ホーム画面に追加</b>';
        guide.style.display = 'flex';
    } else if (isAndroid) {
        text.innerHTML = '全画面でプレイ！<br><b>メニュー → アプリをインストール</b>';
        guide.style.display = 'flex';
    } else {
        guide.style.display = 'none';
    }
}


function closeInstallGuide() {
    const guide = document.getElementById('install-guide');
    if (guide) guide.style.display = 'none';
    localStorage.setItem('install-guide-closed', '1');
}

// ==============================
// スタート画面サウンドトグル
// ==============================

function toggleStartSound() {
    // スプラッシュ画面でオーディオは既に初期化済み
    // ここでは単純にトグルのみ
    isMuted = !isMuted;
    if (bgmGain) {
        bgmGain.gain.value = isMuted ? 0 : CONFIG.BGM_VOLUME;
    }
    updateStartSoundBtn();
    updateHeaderSoundBtn();
}

function updateStartSoundBtn() {
    const btn = document.getElementById('start-sound-btn');
    const icon = document.getElementById('start-sound-icon');
    const label = document.getElementById('start-sound-label');
    if (!btn || !icon || !label) return;

    icon.textContent = isMuted ? '🔇' : '🔊';
    label.textContent = isMuted ? 'BGM OFF' : 'BGM ON';
    btn.classList.toggle('muted', isMuted);
}

function updateHeaderSoundBtn() {
    const btn = document.getElementById('sound-btn');
    if (!btn) return;
    btn.textContent = isMuted ? '🔇' : '🔊';
    btn.classList.toggle('muted', isMuted);
}

// ==============================
// 初期化
// ==============================

// スプラッシュ画面をタップして開始
let splashDismissed = false;


function dismissSplash(event) {
    // イベント伝播を防止（touchstart/clickの重複発火を防ぐ）
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    // 重複呼び出し防止
    if (splashDismissed) return;
    splashDismissed = true;

    const splash = document.getElementById('splash-screen');
    if (!splash) return;

    // スプラッシュを非表示
    splash.classList.add('hidden');

    // BGMをONにする（initAudioの前に設定）
    isMuted = false;

    // オーディオを初期化してBGM開始
    initAudio().then((success) => {
        if (success) {
            // BGM gainを確実に設定
            if (bgmGain) {
                bgmGain.gain.value = CONFIG.BGM_VOLUME;
            }
        }
        // UIを更新
        updateStartSoundBtn();
        updateHeaderSoundBtn();
    });

    // インストールガイドを表示
    showInstallGuide();
}

// ==============================
// カメラ設定の永続化（LocalStorage）
// ==============================
function loadCameraSettings() {
    try {
        const savedFovOffset = localStorage.getItem('levermaster_fov_offset');
        if (savedFovOffset !== null) {
            userFovOffset = parseFloat(savedFovOffset);
            // 範囲制限（-10〜+10度）
            userFovOffset = Math.max(-10, Math.min(10, userFovOffset));
        }
    } catch (e) {
        console.warn('Failed to load camera settings:', e);
    }
}

function saveCameraSettings() {
    try {
        localStorage.setItem('levermaster_fov_offset', userFovOffset.toString());
    } catch (e) {
        console.warn('Failed to save camera settings:', e);
    }
}

// ==============================
// FOVカスタマイズ: キーボード操作（+/-キー）
// ==============================
function updateFovSettings() {
    if (!camera) return;

    // パフォーマンス最適化: onResize()の代わりに必要な計算のみ実行
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let w = rect.width;
    let h = rect.height;

    if (w <= 300 || h <= 150) {
        w = window.innerWidth;
        h = window.innerHeight;
    }

    const aspect = w / h;
    const { fov } = calculateOptimalCamera(w, h, aspect);

    cameraBaseFov = fov;
    targetFov = fov;
    currentFov = fov;
    currentLookAtY = -0.5;
    currentLookAtX = 0;
    camera.fov = fov;
    camera.updateProjectionMatrix();
}

window.addEventListener('keydown', (e) => {
    // +キーまたは=キー: FOVを広げる（ズームアウト）
    if (e.key === '+' || e.key === '=' || e.key === ';') {
        userFovOffset = Math.min(10, userFovOffset + 1);
        saveCameraSettings();
        updateFovSettings();
        showComboText(`${MESSAGES.FOV_LABEL} ${Math.round(cameraBaseFov)}°`, UI_COLORS.INFO, 800);
    } else if (e.key === '-') {
        // -キー: FOVを狭める（ズームイン）
        userFovOffset = Math.max(-10, userFovOffset - 1);
        saveCameraSettings();
        updateFovSettings();
        showComboText(`${MESSAGES.FOV_LABEL} ${Math.round(cameraBaseFov)}°`, UI_COLORS.INFO, 800);
    } else if (e.key === '0') {
        // 0キー: FOVをリセット
        userFovOffset = 0;
        saveCameraSettings();
        updateFovSettings();
        showComboText(MESSAGES.FOV_RESET, UI_COLORS.INFO, 800);
    }
});

window.onload = () => {
    // 未捕捉エラー・未処理Promiseを一元的に記録する（error-handler.js）
    setupGlobalErrorHandler();

    loadCameraSettings(); // 設定を読み込み
    checkDevice();
    initThree();
    updateUI();
    // 初期状態のBGMボタンを更新（isMuted=trueなので🔇を表示）
    updateHeaderSoundBtn();
    updateStartSoundBtn();

    // イベントリスナーを初期化（onclick属性の代わり）
    initializeEventListeners({
        dismissSplash,
        startGame,
        toggleSound,
        toggleStartSound,
        openHelp,
        closeHelp,
        openLearn,
        closeLearn,
        confirmExit,
        exitGame,
        closeExitModal,
        closeInstallGuide,
        backToStart,
        passMove,
        redoHang,
        hideHint,
    });
};

// ==============================
// グローバル関数のエクスポート（レガシー互換性のため維持）
// ⚠️ 非推奨: イベントハンドラーモジュールを使用してください
// ベストプラクティス: HTMLのonclick属性は使用せず、event-handlers.jsで管理
// ==============================
// 以下のグローバルエクスポートは削除予定（2025年のベストプラクティスに準拠）
