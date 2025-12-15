/**
 * ゲームロジックモジュール
 * 純粋関数（副作用なし）のみを含む
 * テスト容易性を重視した設計
 */

import { GAME_CONFIG, PLAYER_ORDER } from './constants.js';

/**
 * モーメントを計算する（純粋関数版）
 * @param {Object.<number, Array>} leverData - てこのデータ {pos: [weights...]}
 * @param {number[]} positions - 全ての位置配列
 * @param {number} weightValue - おもりの重さ
 * @returns {Object} 左右のモーメントと差 {left, right, diff}
 */
export function calculateMoment(leverData, positions, weightValue = GAME_CONFIG.WEIGHT_VALUE) {
    let left = 0;
    let right = 0;

    positions.forEach(pos => {
        const count = (leverData[pos] || []).length;
        const moment = Math.abs(pos) * count * weightValue;

        if (pos < 0) {
            left += moment;
        } else {
            right += moment;
        }
    });

    return { left, right, diff: left - right };
}

/**
 * 全プレイヤーのポイントを計算（純粋関数版）
 * 各プレイヤーの |位置| × 10 の合計
 * @param {Object.<number, Array>} leverData - てこのデータ {pos: [weights...]}
 * @param {number[]} positions - 全ての位置配列
 * @returns {Object.<string, number>} プレイヤー名をキーとするポイントマップ
 */
export function calculatePlayerPoints(leverData, positions) {
    const points = {};

    // 全プレイヤーを初期化
    PLAYER_ORDER.forEach(player => {
        points[player] = 0;
    });

    positions.forEach(pos => {
        const stack = leverData[pos] || [];

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

/**
 * バランスが保たれているかチェック（純粋関数版）
 * @param {number} leftMoment - 左側のモーメント
 * @param {number} rightMoment - 右側のモーメント
 * @returns {boolean} バランスが保たれているか
 */
export function isBalanced(leftMoment, rightMoment) {
    return leftMoment === rightMoment;
}

/**
 * 指定位置にスタック可能かチェック（純粋関数版）
 * @param {Object.<number, Array>} leverData - てこのデータ
 * @param {number} position - 位置
 * @param {number} maxStack - 最大スタック数
 * @returns {boolean} スタック可能か
 */
export function canStackAt(leverData, position, maxStack = GAME_CONFIG.MAX_STACK) {
    if (position === 0) return false; // 支点には置けない

    const currentStack = leverData[position] || [];
    return currentStack.length < maxStack;
}

/**
 * プレイヤーの残りストック数を計算（純粋関数版）
 * @param {Object.<number, Array>} leverData - てこのデータ
 * @param {number[]} positions - 全ての位置配列
 * @param {string} player - プレイヤー名
 * @param {number} initialStock - 初期ストック数
 * @returns {number} 残りストック数
 */
export function getRemainingStock(leverData, positions, player, initialStock = 10) {
    let usedCount = 0;

    positions.forEach(pos => {
        const stack = leverData[pos] || [];
        usedCount += stack.filter(w => w.owner === player).length;
    });

    return initialStock - usedCount;
}
