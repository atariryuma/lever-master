// ==============================
// 設定
// ==============================
const CONFIG = {
    WEIGHT_VALUE: 10,       // 各おもりの重さ
    MAX_STACK: 6,           // 1箇所に吊るせるおもりの最大数
    CPU_DELAY: 800,         // CPU思考の基本遅延(ms)
    JUDGE_DELAY: 1000,      // 判定遅延(ms)
    MAX_MOMENT_DIFF_MISTAKE: 100,  // ミス戦略で許容する最大モーメント差
    MAX_TURNS_PER_PLAYER: 10,      // プレイヤーあたりの最大ターン数
    ROULETTE_ROUNDS: 2,            // ルーレットのラウンド数
    PARTICLE_COUNT: 20,            // パーティクルの数
    CONFETTI_COUNT: 50,            // 紙吹雪の数
    SCREEN_FLASH_DURATION: 300,    // 画面フラッシュの持続時間(ms)
    ELIMINATION_DELAY: 1000,       // 脱落後の遅延(ms)
    BALANCE_RESULT_DELAY: 500,     // バランス結果表示後の遅延(ms)
    // CPU性格パラメータ
    SABOTAGE_GAP_DIVISOR: 40,      // 妨害積極度計算の分母
    RISKY_RISK_TOLERANCE: 0.6,     // リスクテイカー判定しきい値
    RISKY_RANDOM_CHANCE: 0.4,      // リスクテイカーがランダム選択する確率
    ATTACK_SABOTAGE_CHANCE: 0.5,   // 攻撃派が妨害優先する確率
    // ルーレット
    ROULETTE_INITIAL_SPEED: 80,    // ルーレット初期速度(ms)
    ROULETTE_SLOWDOWN_1: 30,       // 減速1の増分
    ROULETTE_SLOWDOWN_2: 60,       // 減速2の増分
    ROULETTE_RESULT_DELAY: 500,    // 結果表示遅延(ms)
    ROULETTE_START_DELAY: 2500,    // ゲーム開始までの遅延(ms)
    // サウンド
    BGM_VOLUME: 0.04               // BGM音量
};

// ストックおもりの位置（共通定義）
const STOCK_POSITIONS = {
    blue:   { x: -6, y: 2.5, z: 3 },
    yellow: { x: -3, y: 2.5, z: 4 },
    red:    { x: 3, y: 2.5, z: 4 },
    green:  { x: 6, y: 2.5, z: 3 }
};

// プレイヤー順序
const PLAYER_ORDER = ['blue', 'yellow', 'red', 'green'];

// プレイヤーカラー定数
const COLORS = {
    BLUE: {
        primary: 0x00f5ff,    // シアン
        emissive: 0x004455,
        bright: 0x00ccff
    },
    YELLOW: {
        primary: 0xffee00,    // イエロー
        emissive: 0x554400,
        bright: 0xffff44
    },
    RED: {
        primary: 0xff5577,    // レッド/ピンク
        emissive: 0x551122,
        bright: 0xff3366
    },
    GREEN: {
        primary: 0x44ff88,    // グリーン
        emissive: 0x115533,
        bright: 0x66ffaa
    },
    NEUTRAL: {
        primary: 0xaaaaaa,    // グレー（中立）
        emissive: 0x333333,
        bright: 0xcccccc
    },
    MOVE_VALID: 0x00ff88
};

// ==============================
// サウンドシステム（Web Audio API）
// ==============================
let audioCtx = null;
let isMuted = true;  // 初期状態はミュート（スプラッシュでタップ時にONになる）
let bgmGain = null;
let bgmStarted = false;
let bgmLoopTimeoutId = null;  // BGMループのタイムアウトID
let cpuTimeoutIds = new Set();       // CPU思考のタイムアウトID（複数管理）
let rouletteTimeoutIds = new Set();  // ルーレットのタイムアウトID（複数管理）

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
        console.log('Audio unlocked, state:', audioCtx.state);

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
        const btn = document.getElementById('btn-pass');
        if (btn && !btn.classList.contains('hidden')) {
            passMove();
        }
    }
    // R: Redo（moveフェーズで有効）
    if (e.code === 'KeyR' && game.phase === 'move' && !isCurrentPlayerCPU()) {
        const btn = document.getElementById('btn-redo');
        if (btn && !btn.classList.contains('hidden')) {
            redoHang();
        }
    }
    // Escape: Exit確認
    if (e.code === 'Escape') {
        const startOverlay = document.getElementById('start-overlay');
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
    bgmGain.connect(audioCtx.destination);

    // リラックスBGM - ゆったりしたアンビエントサウンド
    const playPad = (freq, time, dur) => {
        const osc = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();

        osc.type = 'sine';
        osc2.type = 'sine';
        osc.frequency.value = freq;
        osc2.frequency.value = freq * 1.002; // わずかなデチューンで厚み

        filter.type = 'lowpass';
        filter.frequency.value = 800;
        filter.Q.value = 1;

        osc.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(bgmGain);

        // フェードイン・アウト
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.15, time + dur * 0.3);
        gain.gain.linearRampToValueAtTime(0.15, time + dur * 0.7);
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

        // パッド音（コード）
        chord.forEach((freq, i) => {
            playPad(freq, now + i * 0.1, 4);
        });

        // ベル音（メロディ）
        playBell(bells[chordIndex % bells.length], now + 0.5);
        if (Math.random() > 0.5) {
            playBell(bells[(chordIndex + 2) % bells.length] * 0.5, now + 2);
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

// タイムアウト管理用ヘルパー（Set使用でO(1)操作）
function createTimeoutSetter(idSet) {
    return function(callback, delay) {
        const id = setTimeout(() => {
            idSet.delete(id);
            callback();
        }, delay);
        idSet.add(id);
        return id;
    };
}

function createTimeoutClearer(idSet) {
    return function() {
        idSet.forEach(id => clearTimeout(id));
        idSet.clear();
    };
}

const setCpuTimeout = createTimeoutSetter(cpuTimeoutIds);
const clearAllCpuTimeouts = createTimeoutClearer(cpuTimeoutIds);
const setRouletteTimeout = createTimeoutSetter(rouletteTimeoutIds);
const clearAllRouletteTimeouts = createTimeoutClearer(rouletteTimeoutIds);

function playSound(type) {
    if (!audioCtx || isMuted) return;

    // iOS PWA: suspended状態なら音を出さない（initAudioでアンロック処理）
    if (audioCtx.state === 'suspended') {
        return;
    }

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    // 自然さを出すためのランダム化（±5%ピッチ、±10%ボリューム）
    const pitchVar = 0.95 + Math.random() * 0.1;
    const volVar = 0.9 + Math.random() * 0.2;

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    switch(type) {
        case 'drop':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400 * pitchVar, now);
            osc.frequency.exponentialRampToValueAtTime(200 * pitchVar, now + 0.1);
            gain.gain.setValueAtTime(0.2 * volVar, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
            break;

        case 'move':
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(300 * pitchVar, now);
            osc.frequency.exponentialRampToValueAtTime(500 * pitchVar, now + 0.1);
            gain.gain.setValueAtTime(0.2 * volVar, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.start(now);
            osc.stop(now + 0.12);
            break;

        case 'balance':
            // 独自のoscを使用するため、共通のosc/gainは使わない
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
            return;

        case 'win':
            // 8音のアルペジオファンファーレ（C5→E5→G5→C6→E6→G6→C7→G6）
            [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98, 2093.00, 1567.98].forEach((freq, i) => {
                const o = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                o.type = i < 4 ? 'square' : 'sine';  // 高音部はsineで柔らかく
                o.frequency.value = freq * pitchVar;
                const gainVal = i < 4 ? 0.1 : 0.08;  // 高音部は少し控えめ
                g.gain.setValueAtTime(gainVal * volVar, now + i * 0.12);
                g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.5);
                o.connect(g);
                g.connect(audioCtx.destination);
                o.start(now + i * 0.12);
                o.stop(now + i * 0.12 + 0.5);
            });
            return;

        case 'lose':
            // 脱落時：短い下降音（ドスン）
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150 * pitchVar, now);
            osc.frequency.exponentialRampToValueAtTime(40 * pitchVar, now + 0.3);
            gain.gain.setValueAtTime(0.25 * volVar, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
            break;

        case 'gameover':
            // ゲームオーバー時：悲しい下降和音（ドーン...）
            [196.00, 233.08, 293.66].forEach((freq, i) => {  // G3, Bb3, D4 (Gm)
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
            return;

        case 'turn':
            osc.type = 'sine';
            osc.frequency.value = 880 * pitchVar;
            gain.gain.setValueAtTime(0.08 * volVar, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
            break;

        case 'click':
            osc.type = 'square';
            osc.frequency.value = 1000 * pitchVar;
            gain.gain.setValueAtTime(0.05 * volVar, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
            break;

        case 'select':
            // おもり選択時の軽い音
            osc.type = 'sine';
            osc.frequency.value = 600 * pitchVar;
            gain.gain.setValueAtTime(0.1 * volVar, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
            osc.start(now);
            osc.stop(now + 0.08);
            break;

        case 'error':
            // 無効操作時の警告音（下降音）
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200 * pitchVar, now);
            osc.frequency.exponentialRampToValueAtTime(150 * pitchVar, now + 0.15);
            gain.gain.setValueAtTime(0.12 * volVar, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
            break;

        case 'phase':
            // フェーズ移行音（上昇音）
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440 * pitchVar, now);
            osc.frequency.exponentialRampToValueAtTime(880 * pitchVar, now + 0.12);
            gain.gain.setValueAtTime(0.1 * volVar, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
            break;
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
function showScreenFlash(type) {
    const flash = document.getElementById('screen-flash');
    if (!flash) return;
    flash.className = 'screen-flash ' + type + ' active';
    setTimeout(() => {
        if (flash) flash.classList.remove('active');
    }, CONFIG.SCREEN_FLASH_DURATION);
}

// showComboTextのタイムアウトID（連続呼び出し時の競合防止）
let comboTimeoutId1 = null;
let comboTimeoutId2 = null;

function showComboText(text, color) {
    const combo = document.getElementById('combo-text');
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

    comboTimeoutId1 = setTimeout(() => {
        if (!combo) return;
        combo.style.transition = 'all 0.5s ease-out';
        combo.style.opacity = 0;
        combo.style.transform = 'translate(-50%, -50%) scale(2) translateY(-50px)';
    }, 100);

    comboTimeoutId2 = setTimeout(() => {
        if (combo) combo.style.transition = 'none';
        comboTimeoutId1 = null;
        comboTimeoutId2 = null;
    }, 600);
}

// 紙吹雪エフェクト（勝利演出用）
function createConfetti(count = 50) {
    const colors = ['#00f5ff', '#ffee00', '#ff5577', '#44ff88', '#ff00ff', '#ffffff'];
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
            rotation: Math.random() * 720 - 360
        });
    }

    // 一括追加
    container.appendChild(fragment);

    // アニメーション開始（DOM追加後）
    confettiElements.forEach(({ el, duration, horizontalDrift, rotation }) => {
        el.animate([
            {
                transform: `translateY(0) translateX(0) rotate(0deg)`,
                opacity: 1
            },
            {
                transform: `translateY(100vh) translateX(${horizontalDrift}px) rotate(${rotation}deg)`,
                opacity: 0.3
            }
        ], {
            duration: duration,
            easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
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
    currentTurnHungOwner: null
};

// 駒配分設定（常に4人プレイ、各4個ずつ=16個）
// humanCount でCPU/人間の区別のみ変わる
const DISTRIBUTIONS = {
    4: { blue: 4, yellow: 4, red: 4, green: 4 }
};

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
        outerAvoidance: 0.8,    // 外側回避率（高い）
        moveSkipRate: 0.3,      // 移動スキップ率（安全に済ませる）
        sabotageThreshold: 40,  // 妨害を検討するポイント差
        defensivePriority: 0.9, // 守備優先度（高い＝自分のバランス重視）
        thinkingDelay: 1000     // 長考タイプ
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
        moveSkipRate: 0.15,
        sabotageThreshold: 25,  // 25pt差から妨害開始
        defensivePriority: 0.6, // 攻守バランス
        thinkingDelay: 800      // 標準
    },
    // リスクテイカー：外側（位置4-6）を狙う、失敗率高め
    // 戦略：積極的に1位を狙い撃ち、高リスク高リターン
    risky: {
        name: '攻撃派',
        emoji: '🔥',
        preferInner: false,
        riskTolerance: 0.8,     // リスク許容度（高い）
        mistakeRate: 0.12,      // 失敗率12%
        outerAvoidance: 0.1,    // 外側回避しない
        moveSkipRate: 0.02,     // より積極的に移動する
        sabotageThreshold: 5,   // わずかな差でも妨害（攻撃的）
        defensivePriority: 0.3, // 攻撃優先
        thinkingDelay: 600      // 即断即決
    }
};

// 各CPUプレイヤーに性格を割り当て
const cpuPersonalities = {
    yellow: 'safe',    // P2: 慎重派
    red: 'risky',      // P3: 攻撃派
    green: 'normal'    // P4: バランス派
};

// 初期配置：中立おもり（owner: 'neutral'）を±3に配置
// モーメント: 3×10 = 3×10 → 30 = 30 で常にバランス

const allPositions = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

let scene, camera, renderer, leverGroup, pivotGroup;
let ghosts = {}, weightMeshes = [];
let ghostsArray = [];  // ghostsの配列キャッシュ（animate用）
let weightGroups = {};  // 位置ごとにグループ化されたおもり（パフォーマンス最適化用）
let weightGroupsKeys = [];  // weightGroupsのキーキャッシュ（animate用）
let stockWeightsArray = [];  // ストックおもりの配列キャッシュ
let raycaster, mouse;
let leverAngle = 0, targetLeverAngle = 0;
let cameraShake = { x: 0, y: 0, intensity: 0 };
let cameraBaseY = 5; // onResizeで更新
let cameraBaseZ = 14; // onResizeで更新
let stockWeights = { blue: null, yellow: null, red: null, green: null };
let draggedStock = null;
let dragPlane = null;
let hoveredGhost = null;
const weightPhysics = {};

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
    PEND_INERTIA_COEF: 0.05  // 振り子の慣性力係数
};

// てこの角速度（状態変数）
let leverAngularVelocity = 0;

// ==============================
// Three.js初期化
// ==============================
let threeInitialized = false;  // 重複初期化防止フラグ

function initThree() {
    // 重複初期化防止
    if (threeInitialized) {
        console.warn('initThree() called multiple times, skipping');
        return;
    }
    threeInitialized = true;

    const canvas = document.getElementById('game-canvas');
    if (!canvas) {
        console.error('Canvas element not found!');
        return;
    }

    // キャンバスの実際の表示サイズを取得
    // CSSが適用される前はデフォルト値(300x150)になるので、window sizeを使用
    const rect = canvas.getBoundingClientRect();
    let w = rect.width;
    let h = rect.height;

    // CSSデフォルト値(300x150)または異常に小さい場合はwindow sizeを使用
    if (w <= 300 || h <= 150) {
        w = window.innerWidth;
        h = window.innerHeight;
    }

    // ベストプラクティス: モバイルでは低いpixelRatioを使用
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || w < 768;
    const pixelRatio = isMobile ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a2040);

    addBackgroundParticles();

    // 画面サイズに応じた最適なカメラ設定を計算
    const aspect = w / h;
    const { z: optZ, fov: optFov, baseY: optY } = calculateOptimalCamera(w, h, aspect);

    camera = new THREE.PerspectiveCamera(optFov, aspect, 0.1, 1000);
    camera.position.set(0, optY, optZ);
    camera.lookAt(0, 0, 0);
    cameraBaseY = optY;
    cameraBaseZ = optZ;

    // ベストプラクティス: モバイルではantialiasを無効化してパフォーマンス向上
    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: !isMobile,  // モバイルではfalse
        powerPreference: 'high-performance'  // パフォーマンス優先
    });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);  // CSSサイズはスタイルシートで管理
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // ライティング
    scene.add(new THREE.AmbientLight(0x8899bb, 1.2));

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
    mainLight.position.set(0, 20, 10);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    scene.add(mainLight);

    const frontLight = new THREE.DirectionalLight(0xffffff, 1.0);
    frontLight.position.set(0, 5, 20);
    scene.add(frontLight);

    const cyanLight = new THREE.PointLight(0x00ddff, 1.5, 30);
    cyanLight.position.set(-10, 5, 8);
    scene.add(cyanLight);

    const pinkLight = new THREE.PointLight(0xff8899, 1.5, 30);
    pinkLight.position.set(10, 5, 8);
    scene.add(pinkLight);

    const fillLight = new THREE.PointLight(0xaabbcc, 0.8, 25);
    fillLight.position.set(0, -2, 10);
    scene.add(fillLight);

    // 床
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 40),
        new THREE.MeshStandardMaterial({ color: 0x1a1a30, roughness: 0.8 })
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

    // 支点
    pivotGroup = new THREE.Group();
    scene.add(pivotGroup);

    const basePlate = new THREE.Mesh(
        new THREE.CylinderGeometry(1.8, 1.8, 0.15, 48),
        new THREE.MeshStandardMaterial({ color: 0x4a4a6a, metalness: 0.9, roughness: 0.2 })
    );
    basePlate.position.y = -12.5;
    pivotGroup.add(basePlate);

    const baseGlow = new THREE.Mesh(
        new THREE.TorusGeometry(1.8, 0.06, 16, 64),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 1.0 })
    );
    baseGlow.rotation.x = Math.PI / 2;
    baseGlow.position.y = -12.42;
    pivotGroup.add(baseGlow);

    const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.2, 12.2, 24),
        new THREE.MeshStandardMaterial({ color: 0x6a6a8a, metalness: 0.9, roughness: 0.1 })
    );
    pillar.position.y = -6.3;
    pivotGroup.add(pillar);

    const pivotTop = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 0.8, 3),
        new THREE.MeshStandardMaterial({ color: 0x7a7a9a, metalness: 0.9, roughness: 0.1 })
    );
    pivotTop.position.y = 0.1;
    pivotTop.rotation.y = Math.PI / 6;
    pivotGroup.add(pivotTop);

    // てこ
    leverGroup = new THREE.Group();
    leverGroup.position.y = 0.5;
    scene.add(leverGroup);

    const leverBeam = new THREE.Mesh(
        new THREE.BoxGeometry(17, 0.25, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.8, roughness: 0.2 })
    );
    leverBeam.castShadow = true;
    leverGroup.add(leverBeam);

    const topGlowCenter = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.02, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.9 })
    );
    topGlowCenter.position.y = 0.14;
    leverGroup.add(topGlowCenter);

    const topGlowLeft = new THREE.Mesh(
        new THREE.BoxGeometry(6.5, 0.02, 0.3),
        new THREE.MeshBasicMaterial({ color: COLORS.BLUE.primary, transparent: true, opacity: 0.7 })
    );
    topGlowLeft.position.set(-5, 0.14, 0);
    leverGroup.add(topGlowLeft);

    const topGlowRight = new THREE.Mesh(
        new THREE.BoxGeometry(6.5, 0.02, 0.3),
        new THREE.MeshBasicMaterial({ color: COLORS.RED.primary, transparent: true, opacity: 0.7 })
    );
    topGlowRight.position.set(5, 0.14, 0);
    leverGroup.add(topGlowRight);

    const leftEnd = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 24, 24),
        new THREE.MeshStandardMaterial({
            color: COLORS.BLUE.bright, emissive: 0x0088aa, emissiveIntensity: 0.5, metalness: 0.9, roughness: 0.1
        })
    );
    leftEnd.position.set(-8.5, 0, 0);
    leverGroup.add(leftEnd);

    const rightEnd = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 24, 24),
        new THREE.MeshStandardMaterial({
            color: COLORS.RED.primary, emissive: 0xaa2244, emissiveIntensity: 0.5, metalness: 0.9, roughness: 0.1
        })
    );
    rightEnd.position.set(8.5, 0, 0);
    leverGroup.add(rightEnd);

    // ゴースト
    allPositions.forEach(pos => {
        const ghost = createGhost(pos);
        ghost.position.set(pos * 1.4, -0.8, 0);
        ghost.visible = false;
        leverGroup.add(ghost);
        ghosts[pos] = ghost;
    });
    // ghostsの配列キャッシュを作成（animate用パフォーマンス最適化）
    ghostsArray = Object.values(ghosts);

    dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    createPositionLabels();
    createStockWeights();

    // passive: false でpreventDefaultを有効化（スクロール防止）
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', onPointerUp, { passive: false });
    window.addEventListener('resize', onResize, { passive: true });

    // ResizeObserverでキャンバスのサイズ変更を検知（iOS PWA対応）
    if (typeof ResizeObserver !== 'undefined') {
        let resizeTimeout;
        const resizeObserver = new ResizeObserver(() => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(onResize, 100);
        });
        resizeObserver.observe(canvas);
    }

    // 初期カメラ位置を調整（CSSとcanvas初期化の完了を待つ）
    setTimeout(onResize, 100);

    animate();
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
            color: color, emissive: color, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.3
        })
    );
    group.add(sphere);

    const hitbox = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 12, 12),
        new THREE.MeshBasicMaterial({ visible: false })
    );
    group.add(hitbox);
    group.hitbox = hitbox;

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.6, 0.05, 12, 32),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8 })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const canvas2d = document.createElement('canvas');
    canvas2d.width = 256;
    canvas2d.height = 64;
    const ctx = canvas2d.getContext('2d');
    const ownerColorSet = COLORS[owner.toUpperCase()] || COLORS.BLUE;
    ctx.fillStyle = '#' + ownerColorSet.bright.toString(16).padStart(6, '0');
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
            color: baseColor, transparent: true, opacity: 0.3, emissive: baseColor, emissiveIntensity: 0.2
        })
    );
    group.add(sphere);

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.04, 12, 32),
        new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.5 })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const labelNum = Math.abs(pos);
    const canvas2d = document.createElement('canvas');
    canvas2d.width = 64;
    canvas2d.height = 64;
    const ctx = canvas2d.getContext('2d');
    ctx.fillStyle = isLeft ? '#00ffff' : '#ff6688';
    ctx.font = 'bold 48px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelNum.toString(), 32, 32);

    const labelTexture = new THREE.CanvasTexture(canvas2d);
    const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: labelTexture, transparent: true, opacity: 0.9 })
    );
    label.scale.set(0.5, 0.5, 1);
    label.position.y = 0.65;
    group.add(label);

    const hitbox = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 12, 12),
        new THREE.MeshBasicMaterial({ visible: false })
    );
    group.add(hitbox);

    // 満杯時の×マーク
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = 64;
    fullCanvas.height = 64;
    const fullCtx = fullCanvas.getContext('2d');
    fullCtx.strokeStyle = '#ff4466';
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
        new THREE.SpriteMaterial({ map: fullTexture, transparent: true, opacity: 0.9 })
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
        ctx.fillStyle = isLeft ? 'rgba(0,255,255,0.6)' : 'rgba(255,100,136,0.6)';
        ctx.font = 'bold 48px Orbitron, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelNum.toString(), 32, 32);

        const labelTexture = new THREE.CanvasTexture(canvas2d);
        const label = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: labelTexture, transparent: true })
        );
        label.scale.set(0.5, 0.5, 1);
        label.position.set(pos * 1.4, 0.35, 0);
        leverGroup.add(label);
    });
}

function addBackgroundParticles() {
    const particleCount = 80;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 60;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 40;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 30 - 10;

        const color = Math.random() > 0.5 ? new THREE.Color(COLORS.BLUE.primary) : new THREE.Color(COLORS.RED.primary);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const particles = new THREE.Points(geometry, new THREE.PointsMaterial({
        size: 0.15, vertexColors: true, transparent: true, opacity: 0.6
    }));
    scene.add(particles);
}

// ==============================
// イベント
// ==============================
function onPointerDown(e) {
    if (game.isOver) return;
    if (isCurrentPlayerCPU()) return;

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
                    showDragIndicator(e.clientX, e.clientY, true);
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
            const weightData = allWeights.find(w => w.hitbox === hitObject || w.sphere === hitObject || w.sphere === hitObject.parent);
            if (weightData) {
                // 吊るした位置のおもりは全て移動不可（新ルール）
                if (game.currentTurnHungPos === weightData.pos) {
                    playSound('error');
                    showComboText('移動不可！', '#ff9500');
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

    if (draggedStock) {
        raycaster.setFromCamera(mouse, camera);
        const intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragPlane, intersectPoint);
        if (intersectPoint) {
            draggedStock.position.x = intersectPoint.x;
            draggedStock.position.y = Math.max(intersectPoint.y, -6);
        }
    }

    raycaster.setFromCamera(mouse, camera);
    const visibleGhosts = Object.values(ghosts).filter(g => g.visible);
    const hitboxes = visibleGhosts.map(g => g.hitbox);
    const hits = raycaster.intersectObjects(hitboxes);

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

        const visibleGhosts = Object.values(ghosts).filter(g => g.visible);
        const hitboxes = visibleGhosts.map(g => g.hitbox);
        const hits = raycaster.intersectObjects(hitboxes);

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
                    createParticleExplosion(hits[0].point, '#' + ownerColorSet.bright.toString(16).padStart(6, '0'));
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

    const visibleGhosts = Object.values(ghosts).filter(g => g.visible);
    const hitboxes = visibleGhosts.map(g => g.hitbox);
    const hits = raycaster.intersectObjects(hitboxes);

    if (hits.length > 0) {
        const hitGhost = visibleGhosts.find(g => g.hitbox === hits[0].object);
        if (hitGhost) {
            const toPos = hitGhost.userData.pos;
            const fromPos = game.selectedWeight.pos;
            const movingCount = game.selectedWeight.index + 1;

            if (isValidMove(fromPos, toPos, movingCount)) {
                doMove(fromPos, game.selectedWeight.index, toPos);
                createParticleExplosion(hits[0].point, '#ffff00');
                triggerCameraShake(0.15);
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
function showDragIndicator(x, y, isHangPhase = false) {
    const indicator = document.getElementById('drag-indicator');
    const dragText = document.getElementById('drag-text');
    if (!indicator) return;
    indicator.classList.add('active');
    indicator.style.left = (x - 25) + 'px';
    indicator.style.top = (y - 25) + 'px';
    if (dragText) dragText.textContent = 'ここに配置！';
}

function updateDragIndicator(x, y) {
    const indicator = document.getElementById('drag-indicator');
    if (!indicator) return;
    indicator.style.left = (x - 25) + 'px';
    indicator.style.top = (y - 25) + 'px';
}

function hideDragIndicator() {
    const indicator = document.getElementById('drag-indicator');
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
function createParticleExplosion(point, color) {
    const container = document.getElementById('particles');
    if (!container) return;

    const count = 20;
    const screenPos = toScreenPosition(point);

    // DocumentFragmentで一括DOM追加（パフォーマンス最適化）
    const fragment = document.createDocumentFragment();
    const particleData = [];

    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.background = color;
        particle.style.boxShadow = `0 0 10px ${color}`;
        particle.style.left = screenPos.x + 'px';
        particle.style.top = screenPos.y + 'px';

        const angle = (Math.PI * 2 / count) * i;
        const velocity = 60 + Math.random() * 60;

        fragment.appendChild(particle);
        particleData.push({
            el: particle,
            vx: Math.cos(angle) * velocity,
            vy: Math.sin(angle) * velocity
        });
    }

    // 一括追加
    container.appendChild(fragment);

    // アニメーション開始（DOM追加後）
    particleData.forEach(({ el, vx, vy }) => {
        let posX = 0, posY = 0, opacity = 1;
        const animateParticle = () => {
            posX += vx * 0.02;
            posY += vy * 0.02;
            opacity -= 0.025;
            el.style.transform = `translate(${posX}px, ${posY}px)`;
            el.style.opacity = opacity;
            if (opacity > 0) requestAnimationFrame(animateParticle);
            else el.remove();
        };
        animateParticle();
    });
}

function toScreenPosition(point) {
    const vector = new THREE.Vector3(point.x, point.y, point.z);
    vector.project(camera);
    return {
        x: (vector.x * 0.5 + 0.5) * window.innerWidth,
        y: (-vector.y * 0.5 + 0.5) * window.innerHeight
    };
}

function triggerCameraShake(intensity) {
    cameraShake.intensity = intensity;
}

function addSwingImpulse(pos, intensity) {
    Object.keys(weightPhysics).forEach(key => {
        if (key.startsWith(pos + '_')) {
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
function doHang(pos, owner, isRehang = false) {
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
    triggerImpactPause(30);  // おもり配置時のインパクトポーズ

    rebuildWeights();
    updateMomentDisplay();
    updateUI();

    addSwingImpulse(pos, 0.8);

    game.phase = 'move';
    playSound('phase');
    updatePhaseUI();

    if (game.turnCount <= 1) {
        // 初回ターン：バランス説明を追加
        const m = calcMoment();
        if (m.diff === 0) {
            showHint('⚖️ バランスOK！', 'L=' + m.left + ' R=' + m.right + ' で釣り合い中');
        } else {
            showHint('⚠️ 傾いてる！', 'L=' + m.left + ' R=' + m.right + ' → 動かしてバランスを取ろう');
        }
    } else if (hasAnyValidMove()) {
        showHint('動かす or SKIP！', '隣はNG！');
    } else {
        showHint('移動先なし', 'SKIPしよう');
    }
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
function isValidMove(fromPos, toPos, movingCount = 1) {
    if (fromPos === toPos) return false;
    if (Math.abs(fromPos - toPos) === 1) return false;
    if ((fromPos === -1 && toPos === 1) || (fromPos === 1 && toPos === -1)) return false;
    // 今ターン吊るした位置からの移動は禁止（への移動はOK）
    if (game.currentTurnHungPos !== null) {
        if (fromPos === game.currentTurnHungPos) {
            return false;
        }
    }
    // スタック制限：移動先 + 移動数が上限を超える場合は無効
    const toStack = game.leverData[toPos] || [];
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

function doMove(fromPos, fromIndex, toPos) {
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

    rebuildWeights();
    updateMomentDisplay();

    addSwingImpulse(toPos, 1.2);

    setCpuTimeout(() => goToJudge(), 600);
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
        showComboText('REDO!', '#ff9500');
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
            playSound('lose');
            showScreenFlash('lose');
            triggerImpactPause(100);  // 脱落時のインパクトポーズ

            const eliminatedPlayer = game.turn;
            game[eliminatedPlayer].eliminated = true;
            game.activePlayers = game.activePlayers.filter(p => p !== eliminatedPlayer);

            const playerNames = { blue: 'P1', yellow: 'P2', red: 'P3', green: 'P4' };
            showComboText(`${playerNames[eliminatedPlayer]} OUT!`, '#ff3366');

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
                showComboText('FINAL!', '#ffff00');
                setCpuTimeout(() => {
                    if (!game.isOver) endGame('draw');
                    game.isJudging = false;
                }, CONFIG.BALANCE_RESULT_DELAY);
            } else {
                playSound('balance');
                showComboText('BALANCED!', '#00ff88');
                game.isJudging = false;
                switchTurn();
            }
        }
    }, CONFIG.JUDGE_DELAY);
}

// ==============================
// バランス計算
// ==============================
function calcMoment() {
    let left = 0, right = 0;
    allPositions.forEach(p => {
        const count = (game.leverData[p] || []).length;
        const m = Math.abs(p) * count * CONFIG.WEIGHT_VALUE;
        if (p < 0) left += m;
        else right += m;
    });
    return { left, right, diff: left - right };
}

// ポイント計算（各プレイヤーの |位置| × 10 の合計）
// 教育的意味：てこをかたむける働き = 支点からのきょり × おもりの重さ
function calcPlayerPoints() {
    const points = { blue: 0, yellow: 0, red: 0, green: 0 };
    allPositions.forEach(pos => {
        const stack = game.leverData[pos] || [];
        stack.forEach(weight => {
            // neutralまたは未知のownerは無視
            if (!weight.owner || weight.owner === 'neutral' || !(weight.owner in points)) {
                return;
            }
            const pt = Math.abs(pos) * 10;
            points[weight.owner] += pt;
        });
    });
    return points;
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

    // シンプルUI: 数値とアイコンのみ
    const mLeft = document.getElementById('m-left');
    const mRight = document.getElementById('m-right');
    const icon = document.getElementById('balance-icon');

    if (mLeft) mLeft.textContent = m.left;
    if (mRight) mRight.textContent = m.right;
    if (icon) icon.className = 'balance-icon ' + (m.diff === 0 ? 'balanced' : 'unbalanced');
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
                showHint('⚖️ バランスOK！', 'L=' + m.left + ' R=' + m.right + ' で釣り合い中');
            } else {
                showHint('⚠️ 傾いてる！', 'L=' + m.left + ' R=' + m.right + ' → 動かしてバランスを取ろう');
            }
        } else if (hasAnyValidMove()) {
            showHint('動かす or SKIP！', '隣はNG！');
        } else {
            showHint('移動先なし', 'SKIPしよう');
        }
    }
}

function updatePhaseUI() {
    const badge = document.getElementById('phase-badge');
    const btnPass = document.getElementById('btn-pass');
    const btnRedo = document.getElementById('btn-redo');

    if (!badge || !btnPass || !btnRedo) return;

    btnPass.classList.add('hidden');
    btnRedo.classList.add('hidden');
    updateStockWeightsVisibility();

    // プレイヤーパネルのアクティブ状態更新
    game.activePlayers.forEach(color => {
        const panel = document.getElementById('panel-' + color);
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
    const hint = document.getElementById('game-hint');
    const hintText = document.getElementById('hint-text');
    const hintSub = document.getElementById('hint-sub');
    if (!hint) return;
    if (hintText) hintText.textContent = text;
    if (hintSub) hintSub.textContent = sub || '';
    hint.classList.add('show');
}

function hideHint() {
    const hint = document.getElementById('game-hint');
    if (hint) hint.classList.remove('show');
}

// ==============================
// CPU AI（性格システム対応 + 妨害戦略）
// ==============================

// leverDataのディープコピー（シミュレーション用）
function cloneLeverData() {
    const clone = {};
    Object.keys(game.leverData).forEach(k => {
        clone[k] = game.leverData[k].map(w => ({ ...w }));
    });
    return clone;
}

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
function evaluateSabotageValue(fromPos, toPos, targetOwner) {
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
                w.pos === strategy.move.fromPos && w.stackIndex === strategy.move.index
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
                resultDiff: randomMove.diff
            };
        }
        return { hangPos: null, move: null, resultDiff: Infinity };
    }

    // ランダムな位置に吊るす（最善ではない）
    // バックアップを一度だけ取り、各シミュレーション後に確実に復元
    const validPositions = [];
    const originalLeverData = cloneLeverData();

    for (let i = 0; i < allPositions.length; i++) {
        const p = allPositions[i];

        // スタック制限チェック（満杯の位置はスキップ）
        const currentStack = originalLeverData[p] || [];
        if (currentStack.length >= CONFIG.MAX_STACK) {
            continue;
        }

        // 毎回元の状態からディープコピーで開始
        game.leverData = {};
        Object.keys(originalLeverData).forEach(k => {
            game.leverData[k] = originalLeverData[k].map(w => ({ ...w }));
        });

        if (!game.leverData[p]) game.leverData[p] = [];
        game.leverData[p].unshift({ owner: player });  // doHangと同じくunshiftを使用
        const m = calcMoment();

        // バランスが大きく崩れすぎない位置のみ
        if (Math.abs(m.diff) < CONFIG.MAX_MOMENT_DIFF_MISTAKE) {
            validPositions.push(p);
        }
    }

    // 元の状態に復元
    game.leverData = originalLeverData;

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
        const move = findBestMoveWithSabotage(player, personality, sabotageAggression, leader);
        return { hangPos: null, move: move, resultDiff: move ? simulateMoveInternal(move.fromPos, move.index, move.toPos) : Infinity };
    }

    const allStrategies = [];
    const backupHungPos = game.currentTurnHungPos;

    allPositions.forEach(hangPos => {
        // スタック制限チェック（満杯の位置はスキップ）
        const currentStack = game.leverData[hangPos] || [];
        if (currentStack.length >= CONFIG.MAX_STACK) {
            return; // forEach内なのでcontinue相当
        }

        const backupForHang = cloneLeverData();
        if (!game.leverData[hangPos]) game.leverData[hangPos] = [];
        // doHangと同じくunshiftを使用（スタック先頭に追加）
        game.leverData[hangPos].unshift({ owner: player });

        game.currentTurnHungPos = hangPos;

        const momentAfterHang = calcMoment();
        const diffAfterHang = Math.abs(momentAfterHang.diff);

        // 性格に基づく位置スコアを追加
        const positionBonus = getPositionScore(hangPos, personality);

        if (diffAfterHang === 0) {
            allStrategies.push({
                hangPos: hangPos,
                move: null,
                resultDiff: 0,
                positionBonus: positionBonus,
                sabotageBonus: 0
            });
        }

        const possibleMoves = findAllPossibleMoves();

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
                    sabotageBonus: sabotageBonus
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

                allStrategies.push({
                    hangPos: hangPos,
                    move: { fromPos: best.fromPos, index: best.index, toPos: best.toPos },
                    resultDiff: best.diff,
                    positionBonus: positionBonus,
                    sabotageBonus: (best.isLeaderWeight && best.sabotageValue > 0) ? best.sabotageValue * sabotageAggression : 0
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
            sabotageBonus: 0
        });
        game.leverData = backupForHang;
    });

    game.currentTurnHungPos = backupHungPos;

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
            Math.abs(s.hangPos) >= 4 && s.resultDiff <= 30
        );
        if (riskyOptions.length > 0) {
            return riskyOptions[0];
        }
    }

    // 攻撃派は時々純粋妨害を優先
    if (personality.riskTolerance >= 0.8 && sabotageAggression > 0.5 && Math.random() < CONFIG.ATTACK_SABOTAGE_CHANCE) {
        const sabotageOptions = allStrategies.filter(s =>
            s.sabotageBonus > 20 && s.resultDiff <= 20
        );
        if (sabotageOptions.length > 0) {
            return sabotageOptions[0];
        }
    }

    return allStrategies[0] || { hangPos: allPositions[0], move: null, resultDiff: Infinity };
}

// 妨害を考慮した最善移動を探す（ストック0の場合）
function findBestMoveWithSabotage(player, personality, sabotageAggression, leader) {
    const currentMoment = calcMoment();
    if (currentMoment.diff === 0) {
        // すでにバランスしている場合、純粋に妨害を狙う
        const moves = findAllPossibleMoves();
        const sabotageMoves = moves.filter(m =>
            m.isLeaderWeight && m.sabotageValue > 0 && m.diff <= 20
        );
        if (sabotageMoves.length > 0 && Math.random() < sabotageAggression) {
            const best = sabotageMoves.reduce((a, b) =>
                (a.sabotageValue - a.diff) > (b.sabotageValue - b.diff) ? a : b
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

function findAllPossibleMoves() {
    const moves = [];
    const leader = findLeader();

    allPositions.forEach(fromPos => {
        const stack = game.leverData[fromPos] || [];
        stack.forEach((w, idx) => {
            const movingCount = idx + 1;  // 選択したおもりとその下全て
            allPositions.forEach(toPos => {
                if (isValidMove(fromPos, toPos, movingCount)) {
                    const diff = simulateMoveInternal(fromPos, idx, toPos);
                    const sabotageValue = evaluateSabotageValue(fromPos, toPos, w.owner);
                    const isLeaderWeight = (w.owner === leader.player);

                    moves.push({
                        fromPos,
                        index: idx,
                        toPos,
                        diff,
                        owner: w.owner,
                        sabotageValue: sabotageValue,
                        isLeaderWeight: isLeaderWeight
                    });
                }
            });
        });
    });

    return moves;
}

function simulateMoveInternal(fromPos, fromIndex, toPos) {
    const backup = cloneLeverData();

    const stack = game.leverData[fromPos] || [];
    const moving = stack.slice(0, fromIndex + 1);
    const remaining = stack.slice(fromIndex + 1);

    // 空配列になったら削除（doMoveと同じ挙動）
    if (remaining.length === 0) {
        delete game.leverData[fromPos];
    } else {
        game.leverData[fromPos] = remaining;
    }

    if (!game.leverData[toPos]) game.leverData[toPos] = [];
    game.leverData[toPos] = [...moving, ...game.leverData[toPos]];

    const m = calcMoment();
    const diff = Math.abs(m.diff);

    game.leverData = backup;
    return diff;
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

function rebuildWeights() {
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
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8 })
    );
    group.add(rope);

    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(sphereRadius, 32, 32),
        new THREE.MeshStandardMaterial({
            color: color, metalness: 0.9, roughness: 0.1, emissive: emissive, emissiveIntensity: 0.5
        })
    );
    sphere.castShadow = true;
    group.add(sphere);

    const hitbox = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 12, 12),
        new THREE.MeshBasicMaterial({ visible: false })
    );
    sphere.add(hitbox);

    const glowRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.5, 0.04, 8, 32),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.4 })
    );
    glowRing.rotation.x = Math.PI / 2;
    sphere.add(glowRing);

    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 128;
    labelCanvas.height = 64;
    const ctx = labelCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('10g', 64, 32);

    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const labelSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: labelTexture, transparent: true })
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

    PLAYER_ORDER.forEach((player, idx) => {
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
// ゲーム制御
// ==============================
function endGame(winner) {
    game.isOver = true;
    hideHint();

    // モーメント計算
    const m = calcMoment();
    const leftMoment = m.left;
    const rightMoment = m.right;

    // ポイント計算
    const points = calcPlayerPoints();

    const icon = document.getElementById('result-icon');
    const title = document.getElementById('result-title');
    const detail = document.getElementById('result-detail');

    if (!icon || !title || !detail) return;

    // てこの状態を生成（学習用）
    const leverStateHtml = generateLeverStateHtml();

    const playerDisplayNames = { blue: 'P1', yellow: 'P2', red: 'P3', green: 'P4' };
    const playerIcons = { blue: '⚡', yellow: '⭐', red: '🔥', green: '🍀' };
    const playerColors = { blue: '#00f5ff', yellow: '#ffee00', red: '#ff5577', green: '#44ff88' };
    const humanPlayers = PLAYER_ORDER.slice(0, game.humanCount);

    // ポイントランキングHTML生成
    function generatePointsRankingHtml() {
        const activePlayers = game.activePlayers;
        const sortedPlayers = [...activePlayers].sort((a, b) => points[b] - points[a]);

        let html = '<div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:12px;margin:12px 0;">';
        html += '<div style="font-size:0.85rem;color:#aaa;margin-bottom:8px;">🏅 ポイントランキング</div>';
        html += '<div style="display:flex;flex-direction:column;gap:6px;">';

        sortedPlayers.forEach((player, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
            const color = playerColors[player];
            const name = playerDisplayNames[player];
            const pt = points[player];
            html += `<div style="display:flex;align-items:center;gap:8px;">
                <span style="width:24px;">${medal}</span>
                <span style="color:${color};font-weight:700;width:40px;">${name}</span>
                <span style="font-family:'Orbitron',sans-serif;color:var(--neon-green);">${pt} PT</span>
            </div>`;
        });

        html += '</div></div>';
        return html;
    }

    const pointsHtml = generatePointsRankingHtml();

    // てこを元に戻す（傾かせない）
    targetLeverAngle = 0;

    if (winner === 'draw') {
        // ドロー（引き分け）- ポイントで順位決定
        // まず、人間プレイヤーがアクティブプレイヤーに残っているかチェック
        const humanStillActive = humanPlayers.some(p => game.activePlayers.includes(p));

        if (!humanStillActive) {
            // 人間プレイヤーは全員脱落済み → CPUの勝利
            icon.textContent = '💀';
            title.textContent = 'GAME OVER';
            title.className = 'result-title lose';
            detail.innerHTML = `
                <div style="margin-bottom:12px;">脱落してしまった...CPUの勝利！</div>
                <div style="background:rgba(255,51,102,0.1);border:1px solid #ff5577;border-radius:8px;padding:12px;margin-bottom:8px;">
                    <div style="font-size:0.85rem;color:#ff5577;margin-bottom:4px;">💀 バランスを崩して脱落...</div>
                </div>
                ${pointsHtml}
                ${leverStateHtml}
            `;
            showScreenFlash('lose');
            playSound('gameover');
            triggerImpactPause(100);
        } else {
            // 人間プレイヤーが残っている → 通常のポイント勝負
            const sortedPlayers = [...game.activePlayers].sort((a, b) => points[b] - points[a]);
            const topPoint = points[sortedPlayers[0]];
            const topPlayers = sortedPlayers.filter(p => points[p] === topPoint);

            if (topPlayers.length === 1) {
                // ポイント1位が決定
                const pointWinner = topPlayers[0];
                const winnerName = playerDisplayNames[pointWinner];
                const isHuman = humanPlayers.includes(pointWinner);

                if (isHuman) {
                    // プレイヤーがポイント1位で勝利
                    icon.textContent = '🏆';
                    title.textContent = game.humanCount === 1 ? 'VICTORY!' : `${winnerName} WINS!`;
                    title.className = 'result-title win';

                    detail.innerHTML = `
                        <div style="margin-bottom:12px;">最後までバランスキープ！ポイント勝負で勝ち！</div>
                        <div style="background:rgba(0,255,136,0.1);border:1px solid #00ff88;border-radius:8px;padding:12px;margin-bottom:8px;">
                            <div style="font-size:0.9rem;color:#00ff88;margin-bottom:4px;">🎯 1位</div>
                            <div style="font-family:'Orbitron',sans-serif;font-size:1.2rem;color:${playerColors[pointWinner]};">${winnerName} - ${topPoint} PT</div>
                        </div>
                        ${pointsHtml}
                        <div style="background:rgba(255,255,0,0.1);border:1px solid #ffff00;border-radius:8px;padding:10px;margin-bottom:8px;">
                            <div style="font-size:0.8rem;color:#ffff00;">⚖️ 最終バランス</div>
                            <div style="display:flex;justify-content:center;gap:16px;font-family:'Orbitron',sans-serif;font-size:0.85rem;">
                                <span style="color:#00f5ff;">L: ${leftMoment}</span>
                                <span style="color:#ffff00;">=</span>
                                <span style="color:#ff5577;">R: ${rightMoment}</span>
                            </div>
                        </div>
                        ${leverStateHtml}
                    `;
                    showScreenFlash('win');
                    playSound('win');
                    createConfetti(50);
                    triggerImpactPause(150);
                } else {
                    // CPUがポイント1位で勝利 = プレイヤー負け（でも最後までバランスは保った）
                    icon.textContent = '💀';
                    title.textContent = 'GAME OVER';
                    title.className = 'result-title lose';

                    detail.innerHTML = `
                        <div style="margin-bottom:12px;">最後までバランスキープ...でもポイント負け！</div>
                        <div style="background:rgba(255,51,102,0.1);border:1px solid #ff5577;border-radius:8px;padding:12px;margin-bottom:8px;">
                            <div style="font-size:0.9rem;color:#ff5577;margin-bottom:4px;">💀 1位はCPU...</div>
                            <div style="font-family:'Orbitron',sans-serif;font-size:1.2rem;color:${playerColors[pointWinner]};">${winnerName} - ${topPoint} PT</div>
                    </div>
                    ${pointsHtml}
                    <div style="background:rgba(255,255,0,0.1);border:1px solid #ffff00;border-radius:8px;padding:10px;margin-bottom:8px;">
                        <div style="font-size:0.8rem;color:#ffff00;">⚖️ 最終バランス</div>
                        <div style="display:flex;justify-content:center;gap:16px;font-family:'Orbitron',sans-serif;font-size:0.85rem;">
                            <span style="color:#00f5ff;">L: ${leftMoment}</span>
                            <span style="color:#ffff00;">=</span>
                            <span style="color:#ff5577;">R: ${rightMoment}</span>
                        </div>
                    </div>
                    ${leverStateHtml}
                `;
                showScreenFlash('lose');
                playSound('gameover');
                triggerImpactPause(100);
            }
        } else {
            // ポイントも同点 → 完全引き分け
            // 引き分けはプレイヤーにとって悪くないので勝利扱い
            icon.textContent = '🤝';
            title.textContent = 'DRAW!';
            title.className = 'result-title win';

            detail.innerHTML = `
                <div style="margin-bottom:12px;">最後までバランスキープ！ポイントも同点！</div>
                ${pointsHtml}
                <div style="background:rgba(255,255,0,0.1);border:1px solid #ffff00;border-radius:8px;padding:10px;margin-bottom:8px;">
                    <div style="font-size:0.8rem;color:#ffff00;">⚖️ 最終バランス</div>
                    <div style="display:flex;justify-content:center;gap:16px;font-family:'Orbitron',sans-serif;font-size:0.85rem;">
                        <span style="color:#00f5ff;">L: ${leftMoment}</span>
                        <span style="color:#ffff00;">=</span>
                        <span style="color:#ff5577;">R: ${rightMoment}</span>
                    </div>
                </div>
                ${leverStateHtml}
            `;
            showScreenFlash('win');
            playSound('balance');  // 引き分けはバランス音
            triggerImpactPause(100);
        }
    }
    } else if (winner === 'all_out') {
        // 全員脱落
        icon.textContent = '💥';
        title.textContent = 'ALL OUT!';
        title.className = 'result-title lose';
        detail.innerHTML = `
            <div style="margin-bottom:12px;">全員脱落！勝者なし...</div>
            <div style="background:rgba(255,51,102,0.1);border:1px solid #ff5577;border-radius:8px;padding:12px;margin-bottom:8px;">
                <div style="font-size:0.85rem;color:#ff5577;margin-bottom:4px;">💀 誰もバランスを保てなかった...</div>
            </div>
            ${pointsHtml}
            ${leverStateHtml}
        `;
        showScreenFlash('lose');
        playSound('gameover');
        triggerImpactPause(100);
    } else {
        // 勝者あり（他プレイヤー脱落）
        const winnerName = playerDisplayNames[winner];
        const winnerIcon = playerIcons[winner];
        const winnerPoint = points[winner];
        const isWinnerHuman = humanPlayers.includes(winner);

        if (isWinnerHuman) {
            icon.textContent = '🏆';
            title.textContent = game.humanCount === 1 ? 'VICTORY!' : `${winnerName} WINS!`;
            title.className = 'result-title win';
            detail.innerHTML = `
                <div style="margin-bottom:12px;">${winnerIcon} <strong>${game.humanCount === 1 ? 'あなた' : winnerName}</strong>が最後まで生き残った！</div>
                <div style="background:rgba(0,255,136,0.1);border:1px solid #00ff88;border-radius:8px;padding:12px;margin-bottom:8px;">
                    <div style="font-size:0.85rem;color:#00ff88;margin-bottom:4px;">🏅 獲得ポイント</div>
                    <div style="font-family:'Orbitron',sans-serif;font-size:1.2rem;">${winnerPoint} PT</div>
                </div>
                ${pointsHtml}
                ${leverStateHtml}
            `;
            showScreenFlash('win');
            playSound('win');
            createConfetti(50);
            triggerImpactPause(150);  // 勝利時のインパクトポーズ
        } else {
            icon.textContent = '💀';
            title.textContent = 'GAME OVER';
            title.className = 'result-title lose';
            detail.innerHTML = `
                <div style="margin-bottom:12px;">CPUが最後まで生き残った...</div>
                <div style="background:rgba(255,51,102,0.1);border:1px solid #ff5577;border-radius:8px;padding:12px;margin-bottom:8px;">
                    <div style="font-size:0.85rem;color:#ff5577;margin-bottom:4px;">💀 脱落してしまった...</div>
                </div>
                ${pointsHtml}
                ${leverStateHtml}
            `;
            showScreenFlash('lose');
            playSound('gameover');
            triggerImpactPause(100);  // ゲームオーバー時のインパクトポーズ
        }
    }

    // 1秒後に結果画面を表示
    setTimeout(() => {
        const resultOverlay = document.getElementById('result-overlay');
        if (resultOverlay) resultOverlay.classList.remove('hidden');
    }, 1000);
}

// てこの状態をHTMLで生成（学習用）
function generateLeverStateHtml() {
    const ownerColors = {
        blue: 'rgba(0,245,255,0.8)',
        yellow: 'rgba(255,238,0,0.8)',
        red: 'rgba(255,85,119,0.8)',
        green: 'rgba(68,255,136,0.8)'
    };

    let html = '<div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:12px;margin-top:8px;">';
    html += '<div style="font-size:0.8rem;color:#888;margin-bottom:8px;">📍 おもりの位置</div>';
    html += '<div style="display:flex;justify-content:center;align-items:end;gap:2px;height:60px;margin-bottom:8px;">';

    // 全位置を表示
    for (let pos = -6; pos <= 6; pos++) {
        if (pos === 0) {
            // 支点
            html += '<div style="width:20px;height:30px;background:linear-gradient(to top,#ffcc00,#ff9500);border-radius:2px 2px 0 0;margin:0 2px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;">▲</div>';
            continue;
        }

        const stack = game.leverData[pos] || [];
        const count = stack.length;
        const height = Math.min(count * 12, 50);

        // 複数のおもりがある場合はグラデーションで表示
        let bgColor = 'rgba(255,255,255,0.1)';
        if (count > 0) {
            // 最新のおもり（スタック先頭）の色を使用
            const topOwner = stack[0]?.owner || 'blue';
            bgColor = ownerColors[topOwner] || ownerColors.blue;
        }

        html += `<div style="width:16px;height:${height || 8}px;background:${bgColor};border-radius:2px;font-size:0.5rem;display:flex;align-items:center;justify-content:center;color:#fff;" title="位置${pos}: ${count}個">${count > 0 ? count : ''}</div>`;
    }

    html += '</div>';

    // 位置ラベル
    html += '<div style="display:flex;justify-content:center;gap:2px;font-size:0.5rem;color:#666;">';
    for (let pos = -6; pos <= 6; pos++) {
        if (pos === 0) {
            html += '<div style="width:20px;text-align:center;margin:0 2px;">支</div>';
        } else {
            html += `<div style="width:16px;text-align:center;">${Math.abs(pos)}</div>`;
        }
    }
    html += '</div>';

    html += '</div>';
    return html;
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
    switch(mode) {
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

    Object.keys(weightPhysics).forEach(function(key) {
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
const LEVER_WIDTH = 17;      // てこの幅（3D単位）
const LEVER_HEIGHT = 8;      // てこ+おもりの高さ想定
const CAMERA_PADDING = 1.05; // 余白係数（5%の余裕に縮小してテコを大きく表示）

function calculateOptimalCamera(effectiveWidth, effectiveHeight, aspect) {
    // 基準FOV（度）
    let baseFov = 50;

    // スマホ横画面の判定（縦が狭い & 横長アスペクト）
    // iOS PWA: safe-area適用後のサイズで判定
    const isLandscapeMobile = effectiveHeight < 500 && aspect > 1.5;
    const isUltraWide = aspect > 2.0;  // iPhone等の超ワイド画面

    if (isLandscapeMobile) {
        // 横画面スマホ: FOVを広げてテコ全体を表示
        if (isUltraWide) {
            // iPhone等の超ワイド: FOVをさらに広げる
            baseFov = Math.min(75, 55 + (aspect - 2.0) * 15);
        } else {
            baseFov = Math.min(65, 50 + (aspect - 1.5) * 10);
        }
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
        const minZForHeight = distForHeight * 0.6;  // 縦方向の最低限
        optimalZ = Math.max(distForWidth, minZForHeight);
    } else {
        optimalZ = Math.max(distForWidth, distForHeight);
    }

    // 最小・最大制限（スマホは近めでOK）
    const minZ = isLandscapeMobile ? 7 : 8;
    optimalZ = Math.max(minZ, Math.min(optimalZ, 25));

    // 画面が小さい場合の追加調整
    let fov = baseFov;
    if (!isLandscapeMobile) {
        if (effectiveHeight < 400) {
            fov = 55;
            optimalZ *= 0.9;
        } else if (effectiveHeight < 500) {
            fov = 52;
            optimalZ *= 0.95;
        }
    }

    // カメラY位置の最適化
    // ゲームの特性: おもりは支点より下（Y < 0）に吊るされる
    // 視覚範囲: てこの上端（Y≈0.6）からおもりの下部（Y≈-6）まで
    // 理想的な中心: おもりが見える位置（Y = -1 ～ 0）
    let baseY;
    if (isLandscapeMobile) {
        // スマホ横画面: おもりをしっかり見せるため低めに
        baseY = isUltraWide ? -0.5 : 0;
    } else if (effectiveHeight < 500) {
        // 小さい画面: おもりが見えるように低めに
        baseY = 0;
    } else {
        // デスクトップ: おもり全体が見える高さ
        baseY = 1;
    }

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

    camera.position.z = z;
    camera.position.y = baseY;  // カメラのY位置も更新
    camera.fov = fov;
    cameraBaseY = baseY;

    cameraBaseZ = camera.position.z;
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
// アニメーション
// ==============================
function animate() {
    requestAnimationFrame(animate);

    // インパクトポーズ中は物理演算をスキップ（描画は継続）
    const isPaused = Date.now() < impactPauseUntil;

    // 動的カメラ調整：最大スタック数に応じてズームアウト
    let maxStack = 0;
    for (let i = 0; i < allPositions.length; i++) {
        const stack = game.leverData[allPositions[i]];
        if (stack && stack.length > maxStack) maxStack = stack.length;
    }
    const extra = Math.max(0, maxStack - 3);
    const targetZ = cameraBaseZ + extra * 1.5;
    const targetY = 5 - extra * 0.4;
    camera.position.z += (targetZ - camera.position.z) * 0.05;
    cameraBaseY += (targetY - cameraBaseY) * 0.05;

    // カメラシェイク（cameraBaseYはonResizeで設定済み）
    if (cameraShake.intensity > 0.01) {
        cameraShake.x = (Math.random() - 0.5) * cameraShake.intensity;
        cameraShake.y = (Math.random() - 0.5) * cameraShake.intensity;
        cameraShake.intensity *= 0.9;
    } else {
        cameraShake.x = 0;
        cameraShake.y = 0;
    }
    camera.position.x = cameraShake.x;
    camera.position.y = cameraBaseY + cameraShake.y;

    // ストックおもりパルス（キャッシュ配列を使用）
    const t = Date.now() * 0.003;
    for (let i = 0; i < stockWeightsArray.length; i++) {
        const stock = stockWeightsArray[i];
        if (stock && stock.visible && !draggedStock) {
            const pulse = 1 + Math.sin(t) * 0.1;
            stock.scale.set(pulse, pulse, pulse);
            stock.position.y = 2.5 + Math.sin(t * 1.5) * 0.2;
        }
    }

    // ========== てこの傾き（モーメント差による補間） ==========
    const { G, ROPE_LEN, SPHERE_R, PEND_DAMP, DT, UNIT, MAX_TILT, LEVER_SPEED, PEND_INERTIA_COEF } = PHYSICS;

    // インパクトポーズ中は物理更新をスキップ
    if (!isPaused) {
        // targetLeverAngleに向かってスムーズに補間
        const angleDelta = (targetLeverAngle - leverAngle) * LEVER_SPEED;
        leverAngularVelocity = angleDelta / DT;  // 振り子の慣性力計算用
        leverAngle += angleDelta;
    }

    // 最大傾斜で制限
    leverAngle = Math.max(-MAX_TILT, Math.min(MAX_TILT, leverAngle));
    leverGroup.rotation.z = leverAngle;

    // ========== 振り子の物理演算 ==========
    // cos/sinをループ外で1回だけ計算（全おもり共通）
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

            // インパクトポーズ中は振り子の物理更新をスキップ
            if (!isPaused) {
                // 単振り子の運動方程式: α = -(g/L) * sin(θ)
                const gravityAccel = -(G / ROPE_LEN) * Math.sin(ph.angle);
                // てこの回転による慣性力
                const inertialAccel = -leverAngularVelocity * armLength * PEND_INERTIA_COEF;

                ph.velocity += (gravityAccel + inertialAccel) * DT;
                ph.velocity *= PEND_DAMP;
                ph.angle += ph.velocity * DT;

                // 振れすぎ防止
                if (ph.angle > 0.6) { ph.angle = 0.6; ph.velocity *= -0.5; }
                else if (ph.angle < -0.6) { ph.angle = -0.6; ph.velocity *= -0.5; }
            }

            // ワールド座標を計算
            const ropeEndX = anchorWorldX + Math.sin(ph.angle) * ROPE_LEN;
            const ropeEndY = anchorWorldY - Math.cos(ph.angle) * ROPE_LEN;
            const sphereX = ropeEndX;
            const sphereY = ropeEndY - SPHERE_R;

            // てこのローカル座標に変換
            const ropeMidX = (anchorWorldX + ropeEndX) / 2;
            const ropeMidY = (anchorWorldY + ropeEndY) / 2;

            w.rope.position.set(ropeMidX * cosNeg - ropeMidY * sinNeg, ropeMidX * sinNeg + ropeMidY * cosNeg, 0);
            w.rope.rotation.z = ph.angle - leverAngle;
            w.sphere.position.set(sphereX * cosNeg - sphereY * sinNeg, sphereX * sinNeg + sphereY * cosNeg, 0);

            // 次のおもりのアンカー
            anchorWorldX = sphereX;
            anchorWorldY = sphereY - SPHERE_R;
        }
    }

    // ゴーストアニメーション（ghostsArrayはキャッシュ済み）
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

window.onload = () => {
    checkDevice();
    initThree();
    updateUI();
    // 初期状態のBGMボタンを更新（isMuted=trueなので🔇を表示）
    updateHeaderSoundBtn();
    updateStartSoundBtn();
};
