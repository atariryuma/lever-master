import { describe, it, expect } from 'vitest';
import {
    CHAPTERS, PUZZLES, correctOption, optionsOf, stagePendulums, starsFor, tuneHit,
} from '../src/js/engine/pend-puzzles.js';

describe('ふりこの PUZZLES', () => {
    it.each(PUZZLES.map(p => [p.id, p.title, p]))('もんだい%i「%s」は答えがちょうど1つある', (_id, _title, puzzle) => {
        const answer = correctOption(puzzle);
        expect(answer).not.toBeNull();
        expect(optionsOf(puzzle).some(o => o.id === answer)).toBe(true);
    });

    it('すべての章にもんだいがある', () => {
        for (const c of CHAPTERS) expect(PUZZLES.some(p => p.chapter === c.id)).toBe(true);
    });

    it('重さ・ふれはばのもんだいは「同じ」が答え（思いこみをくずす）', () => {
        const same = PUZZLES.filter(p => p.kind === 'compare' && correctOption(p) === 'same');
        expect(same.length).toBeGreaterThanOrEqual(4);
    });

    it('ステージのふりこは、えらんだ選択肢を反映する', () => {
        const tune = PUZZLES.find(p => p.kind === 'tune');
        expect(stagePendulums(tune, 'l100')[0].length).toBe(100);
        const control = PUZZLES.find(p => p.kind === 'control');
        expect(stagePendulums(control, 'p2')).toHaveLength(2);
        const choice = PUZZLES.find(p => p.kind === 'choice');
        expect(stagePendulums(choice)).toHaveLength(1);
        expect(stagePendulums(choice, correctOption(choice))).toHaveLength(2);
        for (const p of stagePendulums(tune, 'l25')) expect(p.phase).toBe('held');
    });

    it('ねらいの時間は 25cm → 1秒、100cm → 2秒', () => {
        const one = PUZZLES.find(p => p.kind === 'tune' && p.target.period === 1);
        expect(tuneHit(one, 25)).toBe(true);
        expect(tuneHit(one, 50)).toBe(false);
    });
});

describe('starsFor', () => {
    it('ためした回数で星が決まる', () => {
        expect(starsFor(1)).toBe(3);
        expect(starsFor(2)).toBe(2);
        expect(starsFor(4)).toBe(1);
    });
});
