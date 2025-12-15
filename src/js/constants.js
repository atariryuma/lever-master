// ==============================
// グローバル設定定数（CONSTANT_CASEに統一）
// ==============================

/**
 * ゲーム設定定数
 * @const {Object}
 */
export const GAME_CONFIG = {
    // ゲームルール
    WEIGHT_VALUE: 10,              // 各おもりの重さ
    MAX_STACK: 6,                  // 1箇所に吊るせるおもりの最大数
    MAX_TURNS_PER_PLAYER: 10,      // プレイヤーあたりの最大ターン数
    MAX_MOMENT_DIFF_MISTAKE: 100,  // ミス戦略で許容する最大モーメント差

    // タイミング設定
    CPU_DELAY: 800,                // CPU思考の基本遅延(ms)
    JUDGE_DELAY: 1000,             // 判定遅延(ms)
    ELIMINATION_DELAY: 1000,       // 脱落後の遅延(ms)
    BALANCE_RESULT_DELAY: 500,     // バランス結果表示後の遅延(ms)
    SCREEN_FLASH_DURATION: 300,    // 画面フラッシュの持続時間(ms)
};

/**
 * ビジュアルエフェクト設定
 * @const {Object}
 */
export const VISUAL_CONFIG = {
    PARTICLE_COUNT: 20,                // パーティクル爆発エフェクトの数
    CONFETTI_COUNT: 50,                // 紙吹雪の数
    BACKGROUND_PARTICLE_COUNT: 80,     // 背景パーティクルの数
    BACKGROUND_PARTICLE_X_RANGE: 60,   // 背景パーティクルのX範囲
    BACKGROUND_PARTICLE_Y_RANGE: 40,   // 背景パーティクルのY範囲
    BACKGROUND_PARTICLE_Z_RANGE: 30,   // 背景パーティクルのZ範囲
    BACKGROUND_PARTICLE_Z_OFFSET: -10, // 背景パーティクルのZオフセット
};

/**
 * CPU AI設定
 * @const {Object}
 */
export const CPU_CONFIG = {
    SABOTAGE_GAP_DIVISOR: 40,      // 妨害積極度計算の分母
    RISKY_RISK_TOLERANCE: 0.6,     // リスクテイカー判定しきい値
    RISKY_RANDOM_CHANCE: 0.4,      // リスクテイカーがランダム選択する確率
    ATTACK_SABOTAGE_CHANCE: 0.5,   // 攻撃派が妨害優先する確率
};

/**
 * ルーレット設定
 * @const {Object}
 */
export const ROULETTE_CONFIG = {
    ROUNDS: 2,                     // ルーレットのラウンド数
    INITIAL_SPEED: 80,             // ルーレット初期速度(ms)
    SLOWDOWN_1: 30,                // 減速1の増分
    SLOWDOWN_2: 60,                // 減速2の増分
    RESULT_DELAY: 500,             // 結果表示遅延(ms)
    START_DELAY: 2500,             // ゲーム開始までの遅延(ms)
};

/**
 * オーディオ設定
 * @const {Object}
 */
export const AUDIO_CONFIG = {
    BGM_VOLUME: 0.04,              // BGM音量
};

/**
 * 後方互換性のため CONFIG も維持（非推奨 - 個別の設定を使うことを推奨）
 * @deprecated 代わりに GAME_CONFIG, VISUAL_CONFIG 等を使用してください
 */
export const CONFIG = {
    ...GAME_CONFIG,
    ...VISUAL_CONFIG,
    ...CPU_CONFIG,
    ...ROULETTE_CONFIG,
    ...AUDIO_CONFIG,
    ROULETTE_ROUNDS: ROULETTE_CONFIG.ROUNDS,
    ROULETTE_INITIAL_SPEED: ROULETTE_CONFIG.INITIAL_SPEED,
    ROULETTE_SLOWDOWN_1: ROULETTE_CONFIG.SLOWDOWN_1,
    ROULETTE_SLOWDOWN_2: ROULETTE_CONFIG.SLOWDOWN_2,
    ROULETTE_RESULT_DELAY: ROULETTE_CONFIG.RESULT_DELAY,
    ROULETTE_START_DELAY: ROULETTE_CONFIG.START_DELAY,
};

/**
 * ストックおもりの位置（共通定義）
 * @const {Object}
 */
export const STOCK_POSITIONS = {
    blue:   { x: -6, y: 2.5, z: 3 },
    yellow: { x: -3, y: 2.5, z: 4 },
    red:    { x: 3, y: 2.5, z: 4 },
    green:  { x: 6, y: 2.5, z: 3 },
};

/**
 * プレイヤー順序
 * @const {string[]}
 */
export const PLAYER_ORDER = ['blue', 'yellow', 'red', 'green'];

/**
 * プレイヤーカラー定数
 * @const {Object}
 */
export const COLORS = {
    BLUE: {
        primary: 0x00f5ff,    // シアン
        emissive: 0x004455,
        bright: 0x00ccff,
    },
    YELLOW: {
        primary: 0xffee00,    // イエロー
        emissive: 0x554400,
        bright: 0xffff44,
    },
    RED: {
        primary: 0xff5577,    // レッド/ピンク
        emissive: 0x551122,
        bright: 0xff3366,
    },
    GREEN: {
        primary: 0x44ff88,    // グリーン
        emissive: 0x115533,
        bright: 0x66ffaa,
    },
    NEUTRAL: {
        primary: 0xaaaaaa,    // グレー（中立）
        emissive: 0x333333,
        bright: 0xcccccc,
    },
    MOVE_VALID: 0x00ff88,
};

/**
 * UI用カラー定数（拡張）
 * @const {Object}
 */
export const UI_COLORS = {
    WARNING: '#ff9500',      // 警告色（オレンジ）
    SUCCESS: '#00ff88',      // 成功色（グリーン）
    DANGER: '#ff3366',       // 危険色（レッド）
    INFO: '#00ccff',         // 情報色（シアン）
    ACCENT: '#ffff00',       // アクセント色（イエロー）
    MAGENTA: '#ff00ff',      // マゼンタ
    WHITE: '#ffffff',        // 白
    // Canvas描画用
    CANVAS_LEFT: '#00ffff',  // 左側（シアン）
    CANVAS_RIGHT: '#ff6688', // 右側（ピンク）
    CANVAS_BORDER: '#ff4466', // 枠線（レッド）
};

/**
 * DOM要素ID定数（タイポ防止・一元管理）
 * @const {Object}
 */
export const DOM_IDS = {
    // オーバーレイ
    START_OVERLAY: 'start-overlay',
    RESULT_OVERLAY: 'result-overlay',
    ROULETTE_OVERLAY: 'roulette-overlay',
    HELP_MODAL: 'help-modal',
    LEARN_MODAL: 'learn-modal',
    SPLASH_SCREEN: 'splash-screen',
    DEVICE_OVERLAY: 'device-overlay',
    INSTALL_GUIDE: 'install-guide',
    // ゲーム要素
    GAME_CANVAS: 'game-canvas',
    SCREEN_FLASH: 'screen-flash',
    COMBO_TEXT: 'combo-text',
    PARTICLES: 'particles',
    // UI要素
    DRAG_INDICATOR: 'drag-indicator',
    DRAG_TEXT: 'drag-text',
    GAME_HINT: 'game-hint',
    HINT_TEXT: 'hint-text',
    HINT_SUB: 'hint-sub',
    // ステータス表示
    MOMENT_LEFT: 'm-left',
    MOMENT_RIGHT: 'm-right',
    BALANCE_ICON: 'balance-icon',
    PHASE_BADGE: 'phase-badge',
    // ボタン
    BTN_PASS: 'btn-pass',
    BTN_REDO: 'btn-redo',
    SOUND_BTN: 'sound-btn',
    START_SOUND_BTN: 'start-sound-btn',
    START_SOUND_ICON: 'start-sound-icon',
    START_SOUND_LABEL: 'start-sound-label',
    // リザルト
    RESULT_ICON: 'result-icon',
    RESULT_TITLE: 'result-title',
    RESULT_DETAIL: 'result-detail',
    // ルーレット
    ROULETTE_WHEEL: 'roulette-wheel',
    ROULETTE_RESULT: 'roulette-result',
    ROULETTE_ORDER: 'roulette-order',
    // インストールガイド
    INSTALL_TEXT: 'install-text',
};

/**
 * ユーザーメッセージ定数（多言語化対応準備）
 * @const {Object}
 */
export const MESSAGES = {
    // ゲーム内アクション
    CANNOT_MOVE: '移動不可！',
    REDO: 'REDO!',
    BALANCED: 'BALANCED!',
    FINAL_TURN: 'FINAL!',
    PLAYER_OUT: 'OUT!',
    // FOV調整
    FOV_LABEL: 'FOV:',
    FOV_RESET: 'FOV: リセット',
};
