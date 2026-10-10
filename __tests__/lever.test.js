import { describe, it, expect } from 'vitest';
import {
    MAX_STACK, POSITIONS, canHang, createBoard, findWeight, hang, isAdjacent, isBalanced,
    chainOf, momentByOwner, momentOf, moveChain, moveWeight, positionLabel, removeWeight, termsOf,
} from '../src/js/engine/lever.js';

const w = (id, mass = 10, owner) => ({ id, mass, owner });

describe('momentOf', () => {
    it('きょり × 重さ を左右で合計する', () => {
        let b = createBoard();
        b = hang(b, -3, w('a', 20));
        b = hang(b, -1, w('b', 10));
        b = hang(b, 2, w('c', 30));
        expect(momentOf(b)).toEqual({ left: 70, right: 60, diff: 10 });
    });

    it('空の盤面はつり合っている', () => {
        expect(isBalanced(createBoard())).toBe(true);
    });

    it('重さ2倍・きょり半分でつり合う', () => {
        let b = hang(createBoard(), -6, w('a', 10));
        b = hang(b, 3, w('b', 20));
        expect(isBalanced(b)).toBe(true);
    });
});

describe('termsOf', () => {
    it('同じ位置のおもりはまとめ、遠い順に並べる', () => {
        let b = hang(createBoard(), 2, w('a', 10));
        b = hang(b, 2, w('b', 20));
        b = hang(b, 5, w('c', 10));
        expect(termsOf(b, 'right')).toEqual([
            { pos: 5, distance: 5, mass: 10, moment: 50 },
            { pos: 2, distance: 2, mass: 30, moment: 60 },
        ]);
        expect(termsOf(b, 'left')).toEqual([]);
    });
});

describe('isAdjacent', () => {
    it('となりの位置を判定する（左1と右1もとなり）', () => {
        expect(isAdjacent(2, 3)).toBe(true);
        expect(isAdjacent(-4, -5)).toBe(true);
        expect(isAdjacent(-1, 1)).toBe(true);
        expect(isAdjacent(1, -1)).toBe(true);
        expect(isAdjacent(2, 4)).toBe(false);
        expect(isAdjacent(-2, 1)).toBe(false);
    });
});

describe('hang / move / remove', () => {
    it('元の盤面を変更しない', () => {
        const b = createBoard();
        const b2 = hang(b, 4, w('a'));
        expect(b[4]).toHaveLength(0);
        expect(b2[4]).toHaveLength(1);
    });

    it(`1か所に ${MAX_STACK} こまで`, () => {
        let b = createBoard();
        for (let i = 0; i < MAX_STACK; i++) b = hang(b, 1, w(`x${i}`));
        expect(canHang(b, 1)).toBe(false);
        expect(() => hang(b, 1, w('over'))).toThrow();
    });

    it('支点（0）にはつるせない', () => {
        expect(canHang(createBoard(), 0)).toBe(false);
    });

    it('おもりを動かす・はずす', () => {
        let b = hang(createBoard(), -2, w('a'));
        b = moveWeight(b, 'a', 5);
        expect(findWeight(b, 'a').pos).toBe(5);
        b = removeWeight(b, 'a');
        expect(findWeight(b, 'a')).toBeNull();
    });
});

describe('momentByOwner / positionLabel', () => {
    it('持ち主ごとのはたらき', () => {
        let b = hang(createBoard(), -4, w('a', 10, 'p1'));
        b = hang(b, 2, w('b', 10, 'p1'));
        b = hang(b, 6, w('c', 10, 'p2'));
        expect(momentByOwner(b, 'p1')).toBe(60);
        expect(momentByOwner(b, 'p2')).toBe(60);
    });

    it('位置の表示名', () => {
        expect(positionLabel(-3)).toBe('左3');
        expect(positionLabel(6)).toBe('右6');
        expect(POSITIONS).toHaveLength(12);
    });
});

describe('moveChain（道づれ）', () => {
    it('つかんだおもりから下を、順番そのままで移動先の下へつなぐ', () => {
        let b = createBoard();
        b = hang(b, 2, w('a'));
        b = hang(b, 2, w('b', 20));
        b = hang(b, 2, w('c', 30));
        b = hang(b, -4, w('d'));
        expect(chainOf(b, 'b').map(x => x.id)).toEqual(['b', 'c']);
        const next = moveChain(b, 'b', -4);
        expect(next[2].map(x => x.id)).toEqual(['a']);
        expect(next[-4].map(x => x.id)).toEqual(['d', 'b', 'c']);
        expect(b[2]).toHaveLength(3); // 元の盤面は変えない
    });

    it('入りきらないときはエラー', () => {
        let b = createBoard();
        for (let i = 0; i < MAX_STACK; i++) b = hang(b, 5, w(`f${i}`));
        b = hang(b, 1, w('a'));
        b = hang(b, 1, w('b'));
        expect(() => moveChain(b, 'a', 5)).toThrow();
    });
});
