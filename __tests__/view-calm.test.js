// @vitest-environment jsdom
/**
 * 盤面を変えた直後に、てこが「静まった」と読まれないこと。
 * （おもりを動かした直後に前の傾きのまま判定されて、つり合っているのにアウトになった不具合の再発防止）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createBoard, hang, moveWeight } from '../src/js/engine/lever.js';

let LeverView;
beforeAll(async () => {
    window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    globalThis.requestAnimationFrame ??= () => 0;
    ({ LeverView } = await import('../src/js/view/lever-view.js'));
});

describe('LeverView（2D）', () => {
    it('おもりを動かしたら、次のコマまでは「静まった」ではない', () => {
        document.body.innerHTML = '<svg id="lever"></svg>';
        const view = new LeverView(document.getElementById('lever'));
        const before = hang(hang(createBoard(), -3, { id: 'a', mass: 10 }), 3, { id: 'b', mass: 20 });
        view.render({ board: before, held: false });
        // かたむいたまま静まった状態にする
        view.body.resting = true;
        view.body.omega = 0;
        expect(view.isCalm()).toBe(true);
        view.render({ board: moveWeight(before, 'a', -6), held: false });
        expect(view.isCalm()).toBe(false);
    });

    it('同じ盤面で描きなおしただけなら、静まったまま', () => {
        document.body.innerHTML = '<svg id="lever"></svg>';
        const view = new LeverView(document.getElementById('lever'));
        const board = hang(createBoard(), 2, { id: 'a', mass: 10 });
        view.render({ board, held: false });
        view.body.resting = true;
        view.render({ board, held: false });
        expect(view.isCalm()).toBe(true);
    });
});
