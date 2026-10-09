import { describe, it, expect } from 'vitest';
import { applyTurn, enumerateTurns, planTurn } from '../src/js/engine/ai.js';
import { createBattle, currentPlayer, release } from '../src/js/engine/battle.js';
import { isBalanced } from '../src/js/engine/lever.js';

function seeded(seed) {
    let x = seed;
    return () => {
        x = (x * 1103515245 + 12345) % 2147483648;
        return x / 2147483648;
    };
}

const cpuSeats = level => [1, 2, 3, 4].map(() => ({ kind: 'cpu', level }));

describe('enumerateTurns', () => {
    it('つるす位置ごとに「動かさない」手をふくむ', () => {
        const s = createBattle({ seats: cpuSeats('normal') });
        const turns = enumerateTurns(s);
        expect(turns.filter(t => t.move === null)).toHaveLength(12);
        expect(turns.some(t => isBalanced(t.board))).toBe(true);
    });
});

describe('planTurn', () => {
    it.each(['normal', 'strong'])('%s は可能ならつり合う手を選ぶ', level => {
        const s = createBattle({ seats: cpuSeats(level) });
        const plan = planTurn(s, level, seeded(1));
        expect(isBalanced(applyTurn(s, plan).board)).toBe(true);
    });

    it.each(['easy', 'normal', 'strong'])('%s 同士で最後まで対戦できる', level => {
        const rng = seeded(42);
        let s = createBattle({ seats: cpuSeats(level) });
        let guard = 0;
        while (s.phase !== 'over' && guard++ < 100) {
            const plan = planTurn(s, currentPlayer(s).level, rng);
            s = release(applyTurn(s, plan)).state;
        }
        expect(s.phase).toBe('over');
        expect(s.result.winners.length).toBeGreaterThan(0);
    });
});
