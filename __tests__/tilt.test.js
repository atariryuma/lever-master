/**
 * てこの傾く向き：重いほうが下がること（2D と 3D の両方）
 * 3D は Three.js（反時計回りが正）、SVG は時計回りが正なので、向きの取りちがえを防ぐ。
 */
import { describe, it, expect } from 'vitest';
import { Vector3 } from '../src/vendor/three.js';
import { tiltFor } from '../src/js/view/lever-view.js';
import { beamRotationZ } from '../src/js/view/lever-view-3d.js';
import { createBoard, hang, momentOf } from '../src/js/engine/lever.js';

const leftHeavy = hang(createBoard(), -4, { id: 'a', mass: 20 });
const rightHeavy = hang(createBoard(), 4, { id: 'a', mass: 20 });

/** 3D：左端・右端の高さ */
function ends3d(board) {
    const rz = beamRotationZ(tiltFor(momentOf(board).diff));
    const axis = new Vector3(0, 0, 1);
    return {
        left: new Vector3(-6, 0, 0).applyAxisAngle(axis, rz).y,
        right: new Vector3(6, 0, 0).applyAxisAngle(axis, rz).y,
    };
}

/** SVG：rotate(angle) は時計回り、y は下向きが正 → 画面上の高さは -y */
function ends2d(board) {
    const a = (tiltFor(momentOf(board).diff) * Math.PI) / 180;
    const y = x => x * Math.sin(a);
    return { left: -y(-6), right: -y(6) };
}

describe.each([['3D', ends3d], ['2D', ends2d]])('%s の傾き', (_name, ends) => {
    it('左が重いと左が下がる', () => {
        const { left, right } = ends(leftHeavy);
        expect(left).toBeLessThan(right);
    });

    it('右が重いと右が下がる', () => {
        const { left, right } = ends(rightHeavy);
        expect(right).toBeLessThan(left);
    });

    it('つり合えば水平', () => {
        const { left, right } = ends(createBoard());
        expect(Math.abs(left - right)).toBeLessThan(1e-9);
    });
});
