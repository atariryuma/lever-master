import { describe, it, expect } from 'vitest';
import {
    AMPLITUDES, LENGTHS, compareSpeed, createPendulum, differingConditions, isFairTest, lengthForPeriod, lengthForTen,
    periodOf, snapAmplitude, tenOf, withCondition,
} from '../src/js/engine/pendulum.js';

describe('periodOf', () => {
    it('1往復の時間は長さだけで決まる（25cm ≈ 1秒、100cm ≈ 2秒）', () => {
        expect(periodOf(25)).toBeCloseTo(1.0, 1);
        expect(periodOf(100)).toBeCloseTo(2.0, 1);
        expect(tenOf(50)).toBeCloseTo(14.2, 1);
    });

    it('長さが 4倍 なら時間は 2倍', () => {
        expect(periodOf(100) / periodOf(25)).toBeCloseTo(2, 6);
    });

    it('lengthForPeriod / lengthForTen は periodOf の逆', () => {
        for (const L of LENGTHS) {
            expect(lengthForPeriod(periodOf(L))).toBeCloseTo(L, 6);
            expect(lengthForTen(tenOf(L))).toBeCloseTo(L, 6);
        }
    });
});

describe('条件', () => {
    const a = createPendulum({ id: 'a', length: 50, mass: 10, amplitude: 20 });
    it('ちがう条件を列挙する', () => {
        expect(differingConditions(a, withCondition(a, 'mass', 30))).toEqual(['mass']);
        expect(differingConditions(a, { ...a, length: 100, amplitude: 10 })).toEqual(['length', 'amplitude']);
        expect(differingConditions(a, a)).toEqual([]);
    });
    it('正しい実験 ＝ 調べたい条件だけがちがう', () => {
        expect(isFairTest(a, withCondition(a, 'length', 100), 'length')).toBe(true);
        expect(isFairTest(a, withCondition(a, 'length', 100), 'mass')).toBe(false);
        expect(isFairTest(a, { ...a, length: 100, mass: 30 }, 'length')).toBe(false);
        expect(isFairTest(a, a, 'length')).toBe(false);
    });
    it('はやいのは長さがみじかいほう。長さが同じなら同じ', () => {
        expect(compareSpeed(a, withCondition(a, 'length', 100))).toBe('a');
        expect(compareSpeed(withCondition(a, 'length', 100), a)).toBe('b');
        expect(compareSpeed(a, { ...a, mass: 30, amplitude: 30 })).toBe('same');
    });
    it('条件を変えると動きは止まる（持ち上げた形）', () => {
        const swinging = { ...a, phase: 'swinging', swing: { t: 3 } };
        expect(withCondition(swinging, 'length', 100).phase).toBe('held');
        expect(withCondition(swinging, 'length', 100).swing).toBeNull();
    });
    it('指で引いた角度は 10・20・30 にそろえる', () => {
        expect(snapAmplitude(4)).toBe(AMPLITUDES[0]);
        expect(snapAmplitude(-17)).toBe(20);
        expect(snapAmplitude(60)).toBe(30);
    });
});
