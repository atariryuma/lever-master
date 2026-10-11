/**
 * ふりこ たいせんの CPU
 *
 * やさしい … 長さを大きく外す。おもりの重さで時間が変わると思いこんでいて、重いおもりをえらぶことがある
 * ふつう   … 少し外す
 * つよい   … ほぼぴったり
 */

import { clampLength } from './pendulum.js';

export const CPU_LEVELS = Object.freeze({
    easy: { label: 'やさしい', spread: 16, heavyMass: 0.5 },
    normal: { label: 'ふつう', spread: 6, heavyMass: 0.15 },
    strong: { label: 'つよい', spread: 2, heavyMass: 0 },
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
