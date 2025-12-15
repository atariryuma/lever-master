/**
 * タイムアウト管理モジュール
 * 全ての非同期タイマーを一元管理し、メモリリークを防止
 *
 * ベストプラクティス:
 * - Set データ構造で O(1) の追加・削除を実現
 * - クリーンアップを確実に実行
 * - ページ離脱時の自動クリーンアップ
 */

/**
 * タイムアウトマネージャークラス
 */
class TimeoutManager {
    constructor() {
        this.timeoutIds = new Set();
        this.setupCleanup();
    }

    /**
     * タイムアウトを設定（管理下に追加）
     * @param {Function} callback - 実行するコールバック関数
     * @param {number} delay - 遅延時間(ms)
     * @returns {number} タイムアウトID
     */
    setTimeout(callback, delay) {
        const id = setTimeout(() => {
            this.timeoutIds.delete(id);
            callback();
        }, delay);
        this.timeoutIds.add(id);
        return id;
    }

    /**
     * 特定のタイムアウトをクリア
     * @param {number} id - タイムアウトID
     */
    clearTimeout(id) {
        if (this.timeoutIds.has(id)) {
            clearTimeout(id);
            this.timeoutIds.delete(id);
        }
    }

    /**
     * 全てのタイムアウトをクリア
     */
    clearAll() {
        this.timeoutIds.forEach(id => clearTimeout(id));
        this.timeoutIds.clear();
    }

    /**
     * アクティブなタイムアウト数を取得
     * @returns {number} アクティブなタイムアウト数
     */
    getActiveCount() {
        return this.timeoutIds.size;
    }

    /**
     * ページ離脱時の自動クリーンアップを設定
     */
    setupCleanup() {
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                this.clearAll();
            });
        }
    }
}

// シングルトンインスタンス
const cpuTimeoutManager = new TimeoutManager();
const rouletteTimeoutManager = new TimeoutManager();
const generalTimeoutManager = new TimeoutManager();

/**
 * CPU処理用のタイムアウトを設定
 * @param {Function} callback - コールバック関数
 * @param {number} delay - 遅延時間(ms)
 * @returns {number} タイムアウトID
 */
export function setCpuTimeout(callback, delay) {
    return cpuTimeoutManager.setTimeout(callback, delay);
}

/**
 * 全てのCPUタイムアウトをクリア
 */
export function clearAllCpuTimeouts() {
    cpuTimeoutManager.clearAll();
}

/**
 * ルーレット用のタイムアウトを設定
 * @param {Function} callback - コールバック関数
 * @param {number} delay - 遅延時間(ms)
 * @returns {number} タイムアウトID
 */
export function setRouletteTimeout(callback, delay) {
    return rouletteTimeoutManager.setTimeout(callback, delay);
}

/**
 * 全てのルーレットタイムアウトをクリア
 */
export function clearAllRouletteTimeouts() {
    rouletteTimeoutManager.clearAll();
}

/**
 * 汎用タイムアウトを設定
 * @param {Function} callback - コールバック関数
 * @param {number} delay - 遅延時間(ms)
 * @returns {number} タイムアウトID
 */
export function setManagedTimeout(callback, delay) {
    return generalTimeoutManager.setTimeout(callback, delay);
}

/**
 * 全ての汎用タイムアウトをクリア
 */
export function clearAllManagedTimeouts() {
    generalTimeoutManager.clearAll();
}

/**
 * デバッグ用：全てのマネージャーの状態を取得
 * @returns {Object} 各マネージャーのアクティブなタイムアウト数
 */
export function getTimeoutStats() {
    return {
        cpu: cpuTimeoutManager.getActiveCount(),
        roulette: rouletteTimeoutManager.getActiveCount(),
        general: generalTimeoutManager.getActiveCount(),
        total: cpuTimeoutManager.getActiveCount() +
               rouletteTimeoutManager.getActiveCount() +
               generalTimeoutManager.getActiveCount(),
    };
}
