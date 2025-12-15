/**
 * ゲームロジック関数のテスト
 * モーメント計算、ポイント計算などのコアロジックをテスト
 */

import { describe, it, expect } from 'vitest';
import {
    calculateMoment,
    calculatePlayerPoints,
    isBalanced,
    canStackAt,
    getRemainingStock,
} from '../src/js/game-logic.js';

describe('calculateMoment', () => {
    it('左右のモーメントを正しく計算する', () => {
        const leverData = {
            '-3': [{ owner: 'blue' }],  // 左側: |-3| * 1 * 10 = 30
            '2': [{ owner: 'yellow' }],  // 右側: |2| * 1 * 10 = 20
        };
        const positions = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

        const result = calculateMoment(leverData, positions, 10);

        expect(result.left).toBe(30);
        expect(result.right).toBe(20);
        expect(result.diff).toBe(10);
    });

    it('複数のおもりがある場合', () => {
        const leverData = {
            '-2': [{ owner: 'blue' }, { owner: 'blue' }],  // 左: |-2| * 2 * 10 = 40
            '4': [{ owner: 'yellow' }],                     // 右: |4| * 1 * 10 = 40
        };
        const positions = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

        const result = calculateMoment(leverData, positions, 10);

        expect(result.left).toBe(40);
        expect(result.right).toBe(40);
        expect(result.diff).toBe(0);
    });

    it('おもりがない場合は0', () => {
        const leverData = {};
        const positions = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

        const result = calculateMoment(leverData, positions, 10);

        expect(result.left).toBe(0);
        expect(result.right).toBe(0);
        expect(result.diff).toBe(0);
    });

    it('片側のみの場合', () => {
        const leverData = {
            '-6': [{ owner: 'red' }],
            '-1': [{ owner: 'red' }],
        };
        const positions = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

        const result = calculateMoment(leverData, positions, 10);

        expect(result.left).toBe(70);  // 60 + 10
        expect(result.right).toBe(0);
        expect(result.diff).toBe(70);
    });
});

describe('calculatePlayerPoints', () => {
    it('各プレイヤーのポイントを正しく計算する', () => {
        const leverData = {
            '-3': [{ owner: 'blue' }],     // blue: 3 * 10 = 30
            '2': [{ owner: 'yellow' }],     // yellow: 2 * 10 = 20
            '5': [{ owner: 'red' }, { owner: 'red' }],  // red: 5 * 10 * 2 = 100
        };
        const positions = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

        const result = calculatePlayerPoints(leverData, positions);

        expect(result.blue).toBe(30);
        expect(result.yellow).toBe(20);
        expect(result.red).toBe(100);
        expect(result.green).toBe(0);
    });

    it('neutralのおもりはカウントしない', () => {
        const leverData = {
            '1': [{ owner: 'neutral' }],
            '2': [{ owner: 'blue' }],
        };
        const positions = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

        const result = calculatePlayerPoints(leverData, positions);

        expect(result.blue).toBe(20);
        expect(result.yellow).toBe(0);
    });

    it('おもりがない場合は全員0ポイント', () => {
        const leverData = {};
        const positions = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

        const result = calculatePlayerPoints(leverData, positions);

        expect(result.blue).toBe(0);
        expect(result.yellow).toBe(0);
        expect(result.red).toBe(0);
        expect(result.green).toBe(0);
    });
});

describe('isBalanced', () => {
    it('モーメントが等しい場合はtrue', () => {
        expect(isBalanced(100, 100)).toBe(true);
        expect(isBalanced(0, 0)).toBe(true);
    });

    it('モーメントが異なる場合はfalse', () => {
        expect(isBalanced(100, 90)).toBe(false);
        expect(isBalanced(50, 100)).toBe(false);
    });
});

describe('canStackAt', () => {
    it('空の位置にはスタック可能', () => {
        const leverData = {};
        expect(canStackAt(leverData, 1, 6)).toBe(true);
        expect(canStackAt(leverData, -3, 6)).toBe(true);
    });

    it('最大数未満ならスタック可能', () => {
        const leverData = {
            '2': [{ owner: 'blue' }, { owner: 'blue' }],  // 2個
        };
        expect(canStackAt(leverData, 2, 6)).toBe(true);
    });

    it('最大数に達したらスタック不可', () => {
        const leverData = {
            '2': [
                { owner: 'blue' },
                { owner: 'blue' },
                { owner: 'blue' },
                { owner: 'blue' },
                { owner: 'blue' },
                { owner: 'blue' },  // 6個（最大）
            ],
        };
        expect(canStackAt(leverData, 2, 6)).toBe(false);
    });

    it('支点（位置0）にはスタック不可', () => {
        const leverData = {};
        expect(canStackAt(leverData, 0, 6)).toBe(false);
    });
});

describe('getRemainingStock', () => {
    it('使用したおもりの数を正しくカウントする', () => {
        const leverData = {
            '-3': [{ owner: 'blue' }],
            '2': [{ owner: 'blue' }, { owner: 'yellow' }],
            '5': [{ owner: 'blue' }],
        };
        const positions = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

        expect(getRemainingStock(leverData, positions, 'blue', 10)).toBe(7);
        expect(getRemainingStock(leverData, positions, 'yellow', 10)).toBe(9);
        expect(getRemainingStock(leverData, positions, 'red', 10)).toBe(10);
    });

    it('全て使い切った場合は0', () => {
        const leverData = {
            '1': [
                { owner: 'blue' },
                { owner: 'blue' },
                { owner: 'blue' },
                { owner: 'blue' },
                { owner: 'blue' },
            ],
            '2': [
                { owner: 'blue' },
                { owner: 'blue' },
                { owner: 'blue' },
                { owner: 'blue' },
                { owner: 'blue' },
            ],
        };
        const positions = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

        expect(getRemainingStock(leverData, positions, 'blue', 10)).toBe(0);
    });
});
