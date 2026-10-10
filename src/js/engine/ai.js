/**
 * CPU の思考
 *
 * やさしい … つり合う手をてきとうに選ぶ。ときどきうっかりミスもする
 * ふつう   … 自分のはたらきを大きく、トップの人を小さくする手を選ぶ
 * つよい   … さらに「次の人がつり合わせられなくなる手」をねらう
 */

import { isBalanced, momentByOwner, momentOf, moveChain } from './lever.js';
import {
    alivePlayers,
    currentPlayer,
    hang,
    hangablePositions,
    hasSafeTurn,
    legalMoves,
    move,
    release,
} from './battle.js';

export const CPU_LEVELS = Object.freeze({
    easy: { label: 'やさしい', blunder: 0.15 },
    normal: { label: 'ふつう', blunder: 0.05 },
    strong: { label: 'つよい', blunder: 0 },
});

/** その手番で打てる手をすべて列挙する */
export function enumerateTurns(state) {
    const turns = [];
    const addMoves = (base, hangPos) => {
        turns.push({ hang: hangPos, move: null, board: base.board });
        for (const m of legalMoves(base)) {
            turns.push({
                hang: hangPos,
                move: { weightId: m.weightId, to: m.to },
                board: moveChain(base.board, m.weightId, m.to),
            });
        }
    };
    if (state.phase === 'hang') {
        for (const pos of hangablePositions(state)) addMoves(hang(state, pos), pos);
    } else if (state.phase === 'move') {
        addMoves(state, null);
    }
    return turns;
}

function evaluate(state, turn, meId) {
    const own = momentByOwner(turn.board, meId);
    const rivals = alivePlayers(state).filter(p => p.id !== meId);
    const leader = Math.max(0, ...rivals.map(p => momentByOwner(turn.board, p.id)));
    return own - 0.6 * leader;
}

/** 手を実際に適用した次の状態 */
export function applyTurn(state, turn) {
    let s = state;
    if (turn.hang !== null) s = hang(s, turn.hang);
    if (turn.move) s = move(s, turn.move.weightId, turn.move.to);
    return s;
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

/**
 * @returns {{ hang: number|null, move: {weightId:string,to:number}|null }}
 */
export function planTurn(state, level = 'normal', rng = Math.random) {
    const me = currentPlayer(state).id;
    const turns = enumerateTurns(state);
    const safe = turns.filter(t => isBalanced(t.board));
    const strip = t => ({ hang: t.hang, move: t.move });
    const config = CPU_LEVELS[level] ?? CPU_LEVELS.normal;

    if (safe.length === 0 || rng() < config.blunder) {
        // つり合う手がない（またはうっかり）… 差がなるべく小さい手
        const byDiff = [...turns].sort((a, b) => Math.abs(momentOf(a.board).diff) - Math.abs(momentOf(b.board).diff));
        const pool = safe.length === 0 ? byDiff.slice(0, 1) : turns.filter(t => !isBalanced(t.board));
        return strip(pick(pool.length ? pool : byDiff, rng));
    }

    if (level === 'easy') return strip(pick(safe, rng));

    const scored = safe
        .map(t => ({ t, score: evaluate(state, t, me) + rng() * 0.5 }))
        .sort((a, b) => b.score - a.score);

    if (level === 'normal') return strip(pick(scored.slice(0, 3), rng).t);

    // つよい: 上位の候補について、次の人が安全に打てるかを読む
    for (const entry of scored.slice(0, 24)) {
        const after = release(applyTurn(state, entry.t)).state;
        if (after.phase !== 'over' && !hasSafeTurn(after)) entry.score += 200;
    }
    scored.sort((a, b) => b.score - a.score);
    return strip(scored[0].t);
}
