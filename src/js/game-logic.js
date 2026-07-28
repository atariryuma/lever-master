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
 * てこのデータをディープコピーする（純粋関数版）
 * @param {Object.<number, Array>} leverData - てこのデータ
 * @returns {Object.<number, Array>} コピーされたてこのデータ
 */
export function cloneLeverData(leverData) {
    const clone = {};
    Object.keys(leverData).forEach(key => {
        clone[key] = leverData[key].map(weight => ({ ...weight }));
    });
    return clone;
}

/**
 * おもりを吊るした後のてこのデータを返す（純粋関数版・元データは変更しない）
 * スタックの先頭に追加する（先頭 = 視覚的に一番下 = てこから遠い）
 * @param {Object.<number, Array>} leverData - てこのデータ
 * @param {number} pos - 吊るす位置
 * @param {string} owner - おもりの所有者
 * @returns {Object.<number, Array>} 吊るした後のてこのデータ
 */
export function simulateHang(leverData, pos, owner) {
    const next = cloneLeverData(leverData);
    next[pos] = [{ owner }, ...(next[pos] || [])];
    return next;
}

/**
 * おもりを移動した後のてこのデータを返す（純粋関数版・元データは変更しない）
 * 指定したおもりとその下（先頭側）すべてが一緒に移動する
 * @param {Object.<number, Array>} leverData - てこのデータ
 * @param {number} fromPos - 移動元の位置
 * @param {number} fromIndex - 移動するおもりのスタックインデックス
 * @param {number} toPos - 移動先の位置
 * @returns {Object.<number, Array>} 移動した後のてこのデータ
 */
export function simulateMove(leverData, fromPos, fromIndex, toPos) {
    const next = cloneLeverData(leverData);
    const stack = next[fromPos] || [];
    const moving = stack.slice(0, fromIndex + 1);
    const remaining = stack.slice(fromIndex + 1);

    if (remaining.length === 0) {
        delete next[fromPos];
    } else {
        next[fromPos] = remaining;
    }

    next[toPos] = [...moving, ...(next[toPos] || [])];
    return next;
}

/**
 * 移動後のモーメント差の絶対値を求める（純粋関数版・O(1)）
 *
 * 盤面を作り直さずに差分だけで計算する。
 * n個のおもりを fromPos から toPos へ移すと、
 * 各うでのモーメントは |位置| × n × おもりの重さ だけ増減する。
 * CPUの先読みは1ターンに千回以上この計算をするため、盤面コピーを避ける。
 *
 * @param {{left: number, right: number}} baseMoment - 移動前のモーメント
 * @param {number} fromPos - 移動元の位置
 * @param {number} movingCount - 一緒に動くおもりの数
 * @param {number} toPos - 移動先の位置
 * @param {number} weightValue - おもりの重さ
 * @returns {number} 移動後のモーメント差の絶対値
 */
export function momentDiffAfterMove(baseMoment, fromPos, movingCount, toPos,
    weightValue = GAME_CONFIG.WEIGHT_VALUE) {
    const delta = movingCount * weightValue;
    let { left, right } = baseMoment;

    // 移動元から取り除く
    if (fromPos < 0) {
        left -= Math.abs(fromPos) * delta;
    } else {
        right -= Math.abs(fromPos) * delta;
    }

    // 移動先へ加える
    if (toPos < 0) {
        left += Math.abs(toPos) * delta;
    } else {
        right += Math.abs(toPos) * delta;
    }

    return Math.abs(left - right);
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
