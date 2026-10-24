/**
 * ふりこ（小5 理科「ふりこの運動」）のモデル
 *
 * 1往復の時間 T = 2π√(L / g)。ふりこの長さ L だけで決まり、おもりの重さ・ふれはばは関係ない。
 * ここは「理論」（もんだいの答え・たいせんの目標の計算）。
 * 実際の動きと「10往復の時間」の実測は physics.js の stepSwing（数値積分）で行う。
 * 教科書と同じ結論になるように、ふれはばが大きくても時間が変わらない線形のふりこにしてある。
 *
 * ここの関数はすべて純粋関数。
 */

export const G = 980; // cm/s²
export const COUNT = 10; // 「10往復の時間」をはかる
export const LENGTHS = Object.freeze([25, 50, 75, 100]); // cm（じっけん・もんだい）
export const MASSES = Object.freeze([10, 20, 30]); // g（てこと同じおもり）
export const AMPLITUDES = Object.freeze([10, 20, 30]); // 度
export const LENGTH_MIN = 10; // たいせんでは 1cm きざみ
export const LENGTH_MAX = 100;

/** @typedef {'length'|'mass'|'amplitude'} Condition */
export const CONDITIONS = Object.freeze(['length', 'mass', 'amplitude']);
export const CONDITION_META = Object.freeze({
    length: { name: 'ふりこの長さ', short: '長さ', unit: 'cm', values: LENGTHS },
    mass: { name: 'おもりの重さ', short: '重さ', unit: 'g', values: MASSES },
    amplitude: { name: 'ふれはば', short: 'ふれはば', unit: '°', values: AMPLITUDES },
});

/** 1往復の時間（秒） */
export const periodOf = length => 2 * Math.PI * Math.sqrt(length / G);
/** 10往復の時間（秒） */
export const tenOf = length => periodOf(length) * COUNT;
/** 1往復が T 秒になる長さ（cm） */
export const lengthForPeriod = period => (G * period * period) / (4 * Math.PI * Math.PI);
/** 10往復が ten 秒になる長さ（cm） */
export const lengthForTen = ten => lengthForPeriod(ten / COUNT);
export const round1 = x => Math.round(x * 10) / 10;
export const clampLength = x => Math.max(LENGTH_MIN, Math.min(LENGTH_MAX, Math.round(x)));

/**
 * @typedef {{ id: string, label: string, length: number, mass: number, amplitude: number, owner?: string,
 *   phase: 'rest'|'held'|'swinging'|'stopped', side: 1|-1, swing: import('./physics.js').Swing|null }} Pendulum
 *   phase … rest: まっすぐ下がっている / held: 手で持ち上げている / swinging: ふれている / stopped: 止めた
 *   side  … 持ち上げた側（1 = 右）
 *   swing … ふれている最中の物理の状態（physics.js）。画面が毎フレーム進める
 */

/** @returns {Pendulum} */
export function createPendulum({ id, label = id, length = 50, mass = 10, amplitude = 20, owner, phase = 'rest', side = 1 } = {}) {
    return { id, label, length, mass, amplitude, owner, phase, side, swing: null };
}

/** 条件を変えた新しいふりこ（元は書きかえない）。動きは止めて、持ち上げた形にする */
export const withCondition = (p, cond, value) => ({ ...p, [cond]: value, phase: p.phase === 'rest' ? 'rest' : 'held', swing: null });

/** 2つのふりこで、ちがう条件の一覧 */
export const differingConditions = (a, b) => CONDITIONS.filter(c => a[c] !== b[c]);

/** 「調べたい条件だけを変えて、ほかはそろえた」正しい実験か */
export function isFairTest(a, b, goal) {
    const diff = differingConditions(a, b);
    return diff.length === 1 && diff[0] === goal;
}

/** どちらが先に往復するか（1往復の時間が短いほうが先） @returns {'a'|'b'|'same'} */
export function compareSpeed(a, b) {
    const ta = periodOf(a.length);
    const tb = periodOf(b.length);
    if (Math.abs(ta - tb) < 1e-9) return 'same';
    return ta < tb ? 'a' : 'b';
}

export const formatValue = (cond, v) => `${v}${CONDITION_META[cond].unit}`;
export const formatSeconds = s => `${round1(s).toFixed(1)}秒`;

/** 経過時間（ふれていなければ 0） */
export const elapsedOf = p => (p.phase === 'swinging' && p.swing ? p.swing.t : 0);
/** 往復した回数 */
export const cyclesOf = p => (p.swing ? p.swing.cycles : 0);
/** n 往復目が終わった時刻（まだなら null） */
export const cycleTimeOf = (p, n) => p.swing?.cycleTimes[n - 1] ?? null;

/** ふれはばの候補にそろえる（指で引いた角度から） */
export function snapAmplitude(deg) {
    const a = Math.abs(deg);
    let best = AMPLITUDES[0];
    for (const v of AMPLITUDES) if (Math.abs(v - a) < Math.abs(best - a)) best = v;
    return best;
}
