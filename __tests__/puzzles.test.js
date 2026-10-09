import { describe, it, expect } from 'vitest';
import { CHAPTERS, PUZZLES, puzzleBoard, solve, starsFor } from '../src/js/engine/puzzles.js';
import { isBalanced } from '../src/js/engine/lever.js';

describe('PUZZLES', () => {
    it.each(PUZZLES.map(p => [p.id, p.title, p]))('もんだい%i「%s」は解ける', (_id, _title, puzzle) => {
        expect(solve(puzzle, 1)).toHaveLength(1);
    });

    it('はじめの盤面はつり合っていない（もうクリアしていない）', () => {
        for (const p of PUZZLES) expect(isBalanced(puzzleBoard(p))).toBe(false);
    });

    it('すべての章にもんだいがある', () => {
        for (const c of CHAPTERS) expect(PUZZLES.some(p => p.chapter === c.id)).toBe(true);
    });

    it('もんだい1の答えは右3だけ', () => {
        expect(solve(PUZZLES[0])).toEqual([[3]]);
    });
});

describe('starsFor', () => {
    it('ためした回数で星が決まる', () => {
        expect(starsFor(1)).toBe(3);
        expect(starsFor(2)).toBe(2);
        expect(starsFor(5)).toBe(1);
    });
});
