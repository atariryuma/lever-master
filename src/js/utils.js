/**
 * ユーティリティ関数モジュール
 * カラー変換などの純粋関数を提供
 */

import { COLORS } from './constants.js';

/**
 * THREE.jsカラー（0xXXXXXX）をCSS形式（#XXXXXX）に変換
 * @param {number} hexColor - 16進数カラー値
 * @returns {string} CSS形式のカラー文字列
 */
export function hexToCSS(hexColor) {
    if (hexColor == null) return '#000000';
    return `#${hexColor.toString(16).padStart(6, '0')}`;
}

/**
 * THREE.jsカラー/CSSカラーをrgba形式に変換
 * @param {number|string} hexColor - 16進数カラー値または#を含む文字列
 * @param {number} [alpha=1] - アルファ値（0-1）
 * @returns {string} rgba形式のカラー文字列
 */
export function hexToRGBA(hexColor, alpha = 1) {
    if (hexColor == null) return `rgba(0,0,0,${alpha})`;
    const hex = typeof hexColor === 'number' ? hexColor : parseInt(hexColor.replace('#', ''), 16);
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * プレイヤーメタデータ（表示用）
 * @const {Object}
 */
export const PLAYER_META = {
    blue:   { displayName: 'P1', icon: '⚡', cssColor: hexToCSS(COLORS.BLUE.primary) },
    yellow: { displayName: 'P2', icon: '⭐', cssColor: hexToCSS(COLORS.YELLOW.primary) },
    red:    { displayName: 'P3', icon: '🔥', cssColor: hexToCSS(COLORS.RED.primary) },
    green:  { displayName: 'P4', icon: '🍀', cssColor: hexToCSS(COLORS.GREEN.primary) },
};
