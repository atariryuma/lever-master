/**
 * 物理エンジン（てこ・ふりこ共通）
 *
 * どちらも「回転する剛体」を、固定の小さな時間きざみ（1/240 秒）で半陰的オイラー法で進める。
 * 画面（2D・3D）は毎フレームここを呼んで、返ってきた角度を描くだけ。
 *
 * ■ てこ（実験用てこ）
 *   うでは支点のまわりに回転する。おもりはフック（支点より少し下）から糸でぶら下がるので、
 *   おもりの力のうでは「フックの水平きょり」。うでの重心も支点より下にあるので、
 *   かたむくと元にもどそうとするトルクがはたらく（上皿てんびんと同じしくみ）。
 *     I·θ'' = g·Σ m_i·x_i·cosθ − g·(M_b·h + M_w·d)·sinθ − c·θ'
 *   左右の「きょり×重さ」の差が大きいほど、つり合う角度（atan(差 / K)）が大きくなり、
 *   差がとても大きいとストッパー（±MAX_TILT）にぶつかって止まる。
 *   角度は「時計回りが正（右が下がる）」。
 *
 * ■ ふりこ
 *   θ'' = −(g / L)·θ − 2γ·θ'
 *   5年生の学習内容（ふれはばを変えても時間は変わらない）に合わせ、復元力は角度に比例させる
 *   （本物の sinθ だと 30° で 1.7% 長くなるが、それは扱わない）。
 *   1往復は「ふれの向きが切りかわった（最初に持ち上げた側のはしにもどった）」ことで数える。
 */

import { POSITIONS } from './lever.js';

const SUBSTEP = 1 / 240;
const MAX_FRAME = 0.5; // 1回の呼び出しで進める上限（タブが裏にあったあと、大量に進めない。はやおくり ×3 でも足りる）

/* ======================== てこ ======================== */

/** 単位：長さは目盛り1つ（約 2.5cm）、質量は g、角度はラジアン */
export const LEVER = Object.freeze({
    g: 392, // 980 cm/s² ÷ 2.5 cm
    beamMass: 200, // うでの質量（g）
    beamHalf: 6.62, // うでの半分の長さ（目盛り）
    beamDrop: 1.0, // うで（＋支柱の金具）の重心が支点より下にある深さ
    hookDrop: 0.3, // フックが支点より下にある深さ（3D の HOOK_Y と同じ）
    maxTilt: (12 * Math.PI) / 180, // ストッパー
    zeta: 0.28, // 減衰比（2〜3 回ゆれてから、2〜3 秒で止まる。判定を待たせすぎない）
    restitution: 0.22, // ストッパーにぶつかったときのはね返り
});

/** @typedef {{ angle: number, omega: number, resting: boolean }} LeverBody  angle ラジアン・omega ラジアン/秒 */

/** @returns {LeverBody} */
export const createLeverBody = () => ({ angle: 0, omega: 0, resting: false });

/** 盤面のおもりを「位置 x（目盛り）・質量 m（g）」の列にする */
export function leverLoads(board) {
    const loads = [];
    if (!board) return loads;
    for (const pos of POSITIONS) {
        const m = board[pos].reduce((sum, w) => sum + w.mass, 0);
        if (m > 0) loads.push({ x: pos, m });
    }
    return loads;
}

/** かたむけるトルクの係数 K（おもりの合計が重いほど、同じ差でもかたむきにくい） */
export const leverStiffness = loads => LEVER.beamMass * LEVER.beamDrop + loads.reduce((s, l) => s + l.m, 0) * LEVER.hookDrop;

export const leverInertia = loads => LEVER.beamMass * (LEVER.beamHalf * LEVER.beamHalf) / 3
    + loads.reduce((s, l) => s + l.m * (l.x * l.x + LEVER.hookDrop * LEVER.hookDrop), 0);

/** 角度 θ でうでにはたらくトルク（減衰はふくまない） */
export function leverTorque(loads, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let t = 0;
    for (const l of loads) t += l.m * l.x * cos;
    return LEVER.g * (t - leverStiffness(loads) * sin);
}

/**
 * つり合う角度（度）。右が重いとプラス（右が下がる）。
 * @param {{ diff: number }} moment momentOf(board)（diff = 左 − 右）
 */
export function equilibriumAngle(moment, loads = []) {
    const K = leverStiffness(loads) || LEVER.beamMass * LEVER.beamDrop;
    const a = Math.atan(-moment.diff / K);
    return (Math.max(-LEVER.maxTilt, Math.min(LEVER.maxTilt, a)) * 180) / Math.PI;
}

/**
 * うでを dt 秒ぶん進める（body を書きかえる）
 * @param {LeverBody} body
 * @param {{x:number,m:number}[]} loads
 * @param {number} dt 秒
 * @param {{ held?: boolean }} [opts] held … 手でささえている（水平に固定）
 * @returns {boolean} まだ動いているか
 */
export function stepLever(body, loads, dt, { held = false } = {}) {
    if (held) {
        body.angle = 0;
        body.omega = 0;
        body.resting = true;
        return false;
    }
    const I = leverInertia(loads);
    const K = leverStiffness(loads);
    // 減衰係数は減衰比から（おもりが変わっても「ゆれ方」が同じに見えるように）
    const c = 2 * LEVER.zeta * Math.sqrt(K * LEVER.g * I);
    let remain = Math.min(dt, MAX_FRAME);
    while (remain > 0) {
        const h = Math.min(SUBSTEP, remain);
        remain -= h;
        const acc = (leverTorque(loads, body.angle) - c * body.omega) / I;
        body.omega += acc * h;
        body.angle += body.omega * h;
        // ストッパー
        if (body.angle > LEVER.maxTilt) {
            body.angle = LEVER.maxTilt;
            if (body.omega > 0) body.omega = -body.omega * LEVER.restitution;
        } else if (body.angle < -LEVER.maxTilt) {
            body.angle = -LEVER.maxTilt;
            if (body.omega < 0) body.omega = -body.omega * LEVER.restitution;
        }
    }
    // 静まった（つり合いの角度のそば（約 0.3° 以内）で、ほとんど動いていない（約 0.6°/秒 未満））。
    // 止めはしない（そのあとも積分を続けるので、つり合いの角度へゆっくり寄っていく）
    const onStopper = Math.abs(Math.abs(body.angle) - LEVER.maxTilt) < 1e-6;
    const acc = leverTorque(loads, body.angle) / I;
    const calm = Math.abs(body.omega) < 0.01 && (onStopper || Math.abs(acc) < 0.12);
    body.resting = calm;
    return !calm;
}

/** 静まっている（手をはなしていて、ほとんど動いていない） */
export const leverIsCalm = body => body.resting;

/**
 * おもりをつるした・はずしたときの反動（角速度のインパルス）。
 * 落ちてきたおもりがフックに当たる衝撃。重いほど・遠いほど大きい
 * @param {LeverBody} body
 * @param {number} x 位置（目盛り）
 * @param {number} mass g
 * @param {{x:number,m:number}[]} loads つるしたあとのおもり
 */
export function dropImpulse(body, x, mass, loads) {
    const v = 2.4; // 落ちてくる速さ（目盛り/秒）
    body.omega += (mass * v * x) / leverInertia(loads);
}

/* ======================== ふりこ ======================== */

const PEND_G = 980; // cm/s²
const PEND_GAMMA = 1 / 300; // 減衰（空気のてい抗）。20 秒で 1割ほど小さくなる

/**
 * @typedef {{ theta: number, omega: number, t: number, cycles: number, cycleTimes: number[], dir: number }} Swing
 *   theta ラジアン（右がプラス）・omega ラジアン/秒・t はなしてからの秒数・cycles 往復した回数
 *   cycleTimes … n 往復目が終わった時刻（秒）
 */

/**
 * 手をはなす
 * @param {{ amplitude: number, side: number }} p
 * @returns {Swing}
 */
export function createSwing(p) {
    return { theta: (p.side * p.amplitude * Math.PI) / 180, omega: 0, t: 0, cycles: 0, cycleTimes: [], dir: -p.side };
}

/**
 * ふりこを dt 秒ぶん進める（swing を書きかえる）
 * @param {Swing} s
 * @param {{ length: number, side: number }} p
 * @param {number} dt
 * @returns {number} この呼び出しで終わった往復の数
 */
export function stepSwing(s, p, dt) {
    const k = PEND_G / p.length;
    let done = 0;
    let remain = Math.min(dt, MAX_FRAME);
    while (remain > 0) {
        const h = Math.min(SUBSTEP, remain);
        remain -= h;
        const prevOmega = s.omega;
        s.omega += (-k * s.theta - 2 * PEND_GAMMA * s.omega) * h;
        s.theta += s.omega * h;
        s.t += h;
        // 持ち上げた側のはしにもどった瞬間（速度の向きが「はなした直後」と同じに切りかわる）で 1往復
        if (Math.sign(prevOmega) === p.side && Math.sign(s.omega) === -p.side) {
            s.cycles += 1;
            s.cycleTimes.push(s.t);
            done += 1;
        }
    }
    return done;
}

/** 度で */
export const swingAngleDeg = s => (s.theta * 180) / Math.PI;
