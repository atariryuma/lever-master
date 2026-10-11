/**
 * ふりこ たいせんの CPU
 *
 * やさしい … 長さを大きく外す。おもりの重さで時間が変わると思いこんでいて、重いおもりをえらぶことがある
 * ふつう   … 少し外す
 * つよい   … ほぼぴったり
 */

import { clampLength } from './pendulum.js';

/*
 * spread は目標の長さからのずれの最大（cm）。1cm ≈ 10往復で 0.1〜0.2秒 なので、
 *   やさしい … だいたい MISS〜OK（表を見て補間すれば、はじめてでも勝てる）
 *   ふつう   … GOOD〜GREAT（表の補間で ±2cm なら、ひとが少し有利）
 *   つよい   … ほぼ PERFECT / GREAT（表を正確に読まないと勝てない）
 */
export const CPU_LEVELS = Object.freeze({
    easy: { label: 'やさしい', spread: 14, heavyMass: 0.5 },
    normal: { label: 'ふつう', spread: 5, heavyMass: 0.15 },
    strong: { label: 'つよい', spread: 1.2, heavyMass: 0 },
});

/**
 * @returns {{ length: number, mass: number, amplitude: number }}
 */
export function planPick(state, level = 'normal', rng = Math.random) {
    const cfg = CPU_LEVELS[level] ?? CPU_LEVELS.normal;
    const error = (rng() * 2 - 1) * cfg.spread;
    const length = clampLength(state.target.length + error);
    const mass = rng() < cfg.heavyMass ? 30 : 10;
    return { length, mass, amplitude: 10 };
}
