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
    cloneLeverData,
    simulateHang,
    simulateMove,
} from '../src/js/game-logic.js';

const ALL_POSITIONS = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

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

describe('cloneLeverData', () => {
    it('元データと独立したコピーを返す', () => {
        const original = { '-3': [{ owner: 'blue' }] };
        const copy = cloneLeverData(original);

        copy['-3'][0].owner = 'red';
        copy['2'] = [{ owner: 'green' }];

        expect(original['-3'][0].owner).toBe('blue');
        expect(original['2']).toBeUndefined();
    });
});

describe('simulateHang', () => {
    it('元のデータを変更しない', () => {
        const original = { '-3': [{ owner: 'neutral' }] };

        simulateHang(original, 5, 'blue');

        expect(original['5']).toBeUndefined();
        expect(original['-3']).toHaveLength(1);
    });

    it('スタックの先頭に追加される（先頭＝てこから遠い側）', () => {
        const original = { '2': [{ owner: 'red' }] };

        const result = simulateHang(original, 2, 'blue');

        expect(result['2']).toHaveLength(2);
        expect(result['2'][0].owner).toBe('blue');
        expect(result['2'][1].owner).toBe('red');
    });

    it('吊るした後のモーメントが正しく増える', () => {
        // 左右つり合い状態から、右の位置4に1つ吊るす
        const original = { '-3': [{ owner: 'neutral' }], '3': [{ owner: 'neutral' }] };
        expect(calculateMoment(original, ALL_POSITIONS, 10).diff).toBe(0);

        const result = simulateHang(original, 4, 'blue');
        const moment = calculateMoment(result, ALL_POSITIONS, 10);

        // 右に |4| × 1 × 10 = 40 が加わる → diff = 30 - 70 = -40
        expect(moment.right).toBe(70);
        expect(moment.diff).toBe(-40);
    });
});

describe('simulateMove', () => {
    it('元のデータを変更しない', () => {
        const original = { '-3': [{ owner: 'blue' }] };

        simulateMove(original, -3, 0, 5);

        expect(original['-3']).toHaveLength(1);
        expect(original['5']).toBeUndefined();
    });

    it('移動元が空になったらキーごと削除される', () => {
        const original = { '-3': [{ owner: 'blue' }] };

        const result = simulateMove(original, -3, 0, 5);

        expect(result['-3']).toBeUndefined();
        expect(result['5']).toHaveLength(1);
    });

    it('選択したおもりとその下すべてが一緒に移動する', () => {
        const original = {
            '2': [{ owner: 'blue' }, { owner: 'red' }, { owner: 'green' }],
        };

        // index=1 を掴む → index 0,1 の2つが動き、index 2 が残る
        const result = simulateMove(original, 2, 1, 5);

        expect(result['2']).toHaveLength(1);
        expect(result['2'][0].owner).toBe('green');
        expect(result['5']).toHaveLength(2);
        expect(result['5'][0].owner).toBe('blue');
        expect(result['5'][1].owner).toBe('red');
    });

    it('移動先に既存のおもりがある場合は先頭に積まれる', () => {
        const original = {
            '2': [{ owner: 'blue' }],
            '5': [{ owner: 'red' }],
        };

        const result = simulateMove(original, 2, 0, 5);

        expect(result['5']).toHaveLength(2);
        expect(result['5'][0].owner).toBe('blue');
        expect(result['5'][1].owner).toBe('red');
    });

    it('移動によってモーメントが正しく変化する', () => {
        // 左-3に1つ、右3に1つ → つり合い
        const original = { '-3': [{ owner: 'blue' }], '3': [{ owner: 'red' }] };
        expect(calculateMoment(original, ALL_POSITIONS, 10).diff).toBe(0);

        // 右のおもりを 3 → 6 へ移動（隣接でないので合法）
        const result = simulateMove(original, 3, 0, 6);
        const moment = calculateMoment(result, ALL_POSITIONS, 10);

        expect(moment.left).toBe(30);
        expect(moment.right).toBe(60);
        expect(moment.diff).toBe(-30);
    });
});
