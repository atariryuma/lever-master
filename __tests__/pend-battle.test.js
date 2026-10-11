import { describe, it, expect } from 'vitest';
import {
    GRADES, choose, computeResult, createMatch, currentPlayer, gradeFor, makeTarget, nextRound, resolveRound, targetLabel,
} from '../src/js/engine/pend-battle.js';
import { planPick, CPU_LEVELS } from '../src/js/engine/pend-ai.js';
import { tenOf } from '../src/js/engine/pendulum.js';

/** 決まった順に数を返す乱数 */
const seq = (...values) => {
    let i = 0;
    return () => values[i++ % values.length];
};
const human = { kind: 'human' };
const cpu = level => ({ kind: 'cpu', level });

describe('createMatch', () => {
    it('参加者の順番・目標・ラウンド数', () => {
        const s = createMatch({ seats: [human, null, cpu('easy'), human], rounds: 2, firstSeat: 2, rng: seq(0.5, 0.1) });
        expect(s.order).toEqual(['p3', 'p4', 'p1']);
        expect(s.round).toBe(1);
        expect(s.rounds).toBe(2);
        expect(s.target.ten).toBeCloseTo(15, 6);
        expect(s.target.show).toBe('ten');
        expect(currentPlayer(s).id).toBe('p3');
    });

    it('1人ではできない', () => {
        expect(() => createMatch({ seats: [human, null, null, null] })).toThrow();
    });

    it('目標は 10.5〜19.5 秒で、前の目標からはなれている', () => {
        for (let i = 0; i < 50; i++) {
            const t = makeTarget(Math.random);
            expect(t.ten).toBeGreaterThanOrEqual(10.5);
            expect(t.ten).toBeLessThanOrEqual(19.5);
            expect(tenOf(t.length)).toBeCloseTo(t.ten, 6);
            const next = makeTarget(Math.random, t);
            expect(Math.abs(next.ten - t.ten)).toBeGreaterThanOrEqual(1.5);
        }
        expect(targetLabel({ ten: 16, show: 'ten' })).toBe('10往復で 16.0秒');
        expect(targetLabel({ ten: 16, show: 'one' })).toBe('1往復で 1.6秒');
    });
});

describe('ラウンドの流れ', () => {
    it('全員えらぶと「はなす」になり、目標に近いほど点が高い', () => {
        let s = createMatch({ seats: [human, human, null, null], rounds: 2, rng: seq(0.5, 0.1) }); // 15.0秒 → 約55.8cm
        const exact = s.target.length;
        s = choose(s, { length: exact });
        expect(currentPlayer(s).id).toBe('p2');
        s = choose(s, { length: exact + 20 });
        expect(s.phase).toBe('resolve');
        s = resolveRound(s);
        const [r1, r2] = s.history[0].results;
        expect(r1.grade).toBe('PERFECT');
        expect(r1.points).toBe(100);
        expect(r2.points).toBeLessThan(r1.points);
        expect(s.phase).toBe('between');
        expect(s.players.find(p => p.id === 'p1').total).toBe(100);
    });

    it('次のラウンドは先頭が入れかわり、最後のラウンドのあとは終わり', () => {
        let s = createMatch({ seats: [human, human, human, null], rounds: 2, rng: seq(0.5, 0.1) });
        s = choose(s, { length: 50 });
        s = choose(s, { length: 60 });
        s = choose(s, { length: 70 });
        s = resolveRound(s);
        s = nextRound(s, seq(0.9, 0.9));
        expect(s.round).toBe(2);
        expect(s.order).toEqual(['p2', 'p3', 'p1']);
        expect(s.picks).toEqual({});
        s = choose(s, { length: 50 });
        s = choose(s, { length: 60 });
        s = choose(s, { length: 70 });
        s = resolveRound(s);
        expect(s.phase).toBe('over');
        expect(s.result.rows).toHaveLength(3);
        expect(s.result.rows[0].rank).toBe(1);
    });

    it('同点は同じ順位', () => {
        const result = computeResult({
            players: [{ id: 'p1', total: 50 }, { id: 'p2', total: 70 }, { id: 'p3', total: 70 }],
            history: [],
        });
        expect(result.rows.map(r => [r.playerId, r.rank])).toEqual([['p2', 1], ['p3', 1], ['p1', 3]]);
        expect(result.winners).toEqual(['p2', 'p3']);
    });

    it('長さは 10〜100cm の整数にそろえる', () => {
        let s = createMatch({ seats: [human, human, null, null] });
        s = choose(s, { length: 3.7 });
        expect(s.picks.p1.length).toBe(10);
    });
});

describe('gradeFor', () => {
    it('差で評価が決まる', () => {
        expect(gradeFor(0.05).grade).toBe('PERFECT');
        expect(gradeFor(-0.3).grade).toBe('GREAT');
        expect(gradeFor(0.5).grade).toBe('GOOD');
        expect(gradeFor(0.9).grade).toBe('OK');
        expect(gradeFor(3).grade).toBe('MISS');
        expect(GRADES.at(-1).points).toBeGreaterThan(0);
    });
});

describe('CPU', () => {
    it('つよいほど目標に近い長さをえらぶ', () => {
        const s = createMatch({ seats: [cpu('easy'), cpu('strong'), null, null], rng: seq(0.5, 0.1) });
        for (const level of Object.keys(CPU_LEVELS)) {
            for (let i = 0; i < 30; i++) {
                const pick = planPick(s, level, Math.random);
                expect(Math.abs(pick.length - s.target.length)).toBeLessThanOrEqual(CPU_LEVELS[level].spread + 0.5);
                expect(pick.length).toBeGreaterThanOrEqual(10);
                expect(pick.length).toBeLessThanOrEqual(100);
            }
        }
        expect(planPick(s, 'easy', seq(0, 0.1)).mass).toBe(30);
        expect(planPick(s, 'strong', seq(0, 0.1)).mass).toBe(10);
    });
});
