/**
 * 物理エンジン：てこは剛体の回転、ふりこは往復の実測
 */
import { describe, it, expect } from 'vitest';
import {
    LEVER, createLeverBody, createSwing, dropImpulse, equilibriumAngle, leverLoads, stepLever, stepSwing, swingAngleDeg,
} from '../src/js/engine/physics.js';
import { createBoard, hang, momentOf } from '../src/js/engine/lever.js';
import { COUNT, periodOf, tenOf } from '../src/js/engine/pendulum.js';

const deg = rad => (rad * 180) / Math.PI;

/** 静まるまで進める（最大 secs 秒） */
function settle(body, loads, secs = 12) {
    for (let t = 0; t < secs; t += 1 / 60) {
        if (!stepLever(body, loads, 1 / 60) && t > 0.5) return t;
    }
    return secs;
}

describe('てこ', () => {
    it('つり合っていれば水平のまま静まる', () => {
        const board = hang(hang(createBoard(), -3, { id: 'a', mass: 20 }), 2, { id: 'b', mass: 30 });
        const body = createLeverBody();
        body.omega = 0.8; // 反動があっても
        settle(body, leverLoads(board));
        expect(Math.abs(deg(body.angle))).toBeLessThan(0.2);
        expect(body.resting).toBe(true);
    });

    it('右が重いと右が下がり（角度がプラス）、差が大きいほど大きくかたむく', () => {
        const small = hang(createBoard(), 1, { id: 'a', mass: 10 });
        const big = hang(createBoard(), 3, { id: 'a', mass: 10 });
        const b1 = createLeverBody();
        const b2 = createLeverBody();
        settle(b1, leverLoads(small));
        settle(b2, leverLoads(big));
        expect(b1.angle).toBeGreaterThan(0.005);
        expect(b2.angle).toBeGreaterThan(b1.angle);
        expect(deg(b1.angle)).toBeCloseTo(equilibriumAngle(momentOf(small), leverLoads(small)), 0);
    });

    it('左が重いと左が下がる（角度がマイナス）', () => {
        const board = hang(createBoard(), -4, { id: 'a', mass: 20 });
        const body = createLeverBody();
        settle(body, leverLoads(board));
        expect(body.angle).toBeLessThan(-0.01);
    });

    it('差がとても大きいとストッパーで止まる', () => {
        const board = hang(createBoard(), 6, { id: 'a', mass: 30 });
        const body = createLeverBody();
        settle(body, leverLoads(board));
        expect(body.angle).toBeCloseTo(LEVER.maxTilt, 5);
        expect(equilibriumAngle(momentOf(board), leverLoads(board))).toBeCloseTo(deg(LEVER.maxTilt), 5);
    });

    it('ささえているあいだは水平で動かない', () => {
        const board = hang(createBoard(), 6, { id: 'a', mass: 30 });
        const body = createLeverBody();
        expect(stepLever(body, leverLoads(board), 0.5, { held: true })).toBe(false);
        expect(body.angle).toBe(0);
    });

    it('つるした反動で動きだし、やがて静まる', () => {
        const board = hang(hang(createBoard(), -3, { id: 'a', mass: 10 }), 3, { id: 'b', mass: 10 });
        const body = createLeverBody();
        const loads = leverLoads(board);
        dropImpulse(body, 3, 10, loads);
        expect(body.omega).not.toBe(0);
        const moving = stepLever(body, loads, 0.05);
        expect(moving).toBe(true);
        settle(body, loads);
        expect(body.resting).toBe(true);
        expect(Math.abs(body.angle)).toBeLessThan(0.003);
    });
});

/** 10往復を実測する */
function measure(p) {
    const s = createSwing(p);
    for (let t = 0; t < 40 && s.cycles < COUNT; t += 1 / 60) stepSwing(s, p, 1 / 60);
    return s;
}

describe('ふりこ', () => {
    it('10往復の実測は理論（T = 2π√(L/g)）と合う', () => {
        for (const length of [25, 50, 75, 100]) {
            const s = measure({ length, amplitude: 20, side: 1 });
            expect(s.cycles).toBe(COUNT);
            expect(s.cycleTimes[COUNT - 1]).toBeCloseTo(tenOf(length), 1);
            expect(s.cycleTimes[0]).toBeCloseTo(periodOf(length), 1);
        }
    });

    it('重さ・ふれはばを変えても時間は変わらない', () => {
        const base = measure({ length: 50, mass: 10, amplitude: 10, side: 1 }).cycleTimes[COUNT - 1];
        const heavy = measure({ length: 50, mass: 30, amplitude: 10, side: 1 }).cycleTimes[COUNT - 1];
        const wide = measure({ length: 50, mass: 10, amplitude: 30, side: 1 }).cycleTimes[COUNT - 1];
        expect(heavy).toBeCloseTo(base, 2);
        expect(wide).toBeCloseTo(base, 2);
    });

    it('持ち上げた側からふれはじめ、半分の時間で反対側へ行く', () => {
        const p = { length: 100, amplitude: 30, side: -1 };
        const s = createSwing(p);
        expect(swingAngleDeg(s)).toBeCloseTo(-30, 6);
        const T = periodOf(100);
        for (let t = 0; t < T / 2; t += 1 / 240) stepSwing(s, p, 1 / 240);
        expect(swingAngleDeg(s)).toBeGreaterThan(28);
        expect(s.cycles).toBe(0);
        for (let t = 0; t < T / 2 + 0.05; t += 1 / 240) stepSwing(s, p, 1 / 240);
        expect(s.cycles).toBe(1);
    });

    it('ふれはばは少しずつ小さくなる（空気のてい抗）', () => {
        const s = measure({ length: 50, amplitude: 30, side: 1 });
        expect(Math.abs(swingAngleDeg(s))).toBeLessThan(30);
        expect(Math.abs(swingAngleDeg(s))).toBeGreaterThan(24);
    });
});
