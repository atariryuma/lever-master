/**
 * ふりこの たいせん「ジャスト・タイム」のルールエンジン（純粋関数・状態は毎回コピー）
 *
 * 1ラウンドの流れ
 *   1. ねらい … 「10往復で 16.0秒」のような目標が出る
 *   2. えらぶ … 順番に、自分のふりこの長さ（10〜100cm、1cmきざみ）を決める。重さ・ふれはばも変えられるが時間には関係ない
 *   3. いっせいに はなす … 全員のふりこが同時にふれ、10往復の時間が目標にどれだけ近いかで点が入る
 * 長さは「ないしょ」で決める（画面は、はなすまで他の人の長さを見せない）。だから同じ長さでもよい。
 * ラウンドごとに先頭の人が入れかわる。すべてのラウンドが終わったとき、合計点がいちばん大きい人の勝ち。
 */

import { lengthForTen, round1, tenOf, clampLength } from './pendulum.js';

const DEFAULT_ROUNDS = 3;

/** 目標との差（10往復の秒）→ 評価と点 */
export const GRADES = Object.freeze([
    { grade: 'PERFECT', max: 0.1, points: 100 },
    { grade: 'GREAT', max: 0.3, points: 70 },
    { grade: 'GOOD', max: 0.6, points: 50 },
    { grade: 'OK', max: 1.0, points: 30 },
    { grade: 'MISS', max: Infinity, points: 10 },
]);

export function gradeFor(diff) {
    const d = Math.abs(diff);
    return GRADES.find(g => d <= g.max + 1e-9);
}

/**
 * 目標を作る。10往復 10.5〜19.5 秒（0.5 きざみ）。見せ方は「10往復で」か「1往復で」
 * @param {() => number} rng
 */
export function makeTarget(rng = Math.random, prev = null) {
    let ten;
    do ten = 10.5 + Math.floor(rng() * 19) * 0.5;
    while (prev && Math.abs(ten - prev.ten) < 1.5);
    return { ten, length: lengthForTen(ten), show: rng() < 0.65 ? 'ten' : 'one' };
}

export const targetLabel = target => (target.show === 'one'
    ? `1往復で ${round1(target.ten / 10).toFixed(2).replace(/0$/, '')}秒`
    : `10往復で ${target.ten.toFixed(1)}秒`);

/**
 * @param {{ seats: ({kind:'human'|'cpu', level?:string}|null)[], rounds?: number, firstSeat?: number, rng?: () => number }} options
 */
export function createMatch({ seats, rounds = DEFAULT_ROUNDS, firstSeat = 0, rng = Math.random }) {
    const players = seats
        .map((seat, i) => (seat ? { id: `p${i + 1}`, seat: i, kind: seat.kind, level: seat.level ?? null, total: 0 } : null))
        .filter(Boolean);
    if (players.length < 2) throw new Error('2人以上必要です');
    const startIdx = Math.max(0, players.findIndex(p => p.seat >= firstSeat));
    const order = [...players.slice(startIdx), ...players.slice(0, startIdx)].map(p => p.id);
    return {
        players,
        order,
        round: 1,
        rounds,
        target: makeTarget(rng),
        turnIndex: 0,
        phase: 'choose', // choose → resolve → (between | over)
        picks: {},
        history: [],
        result: null,
    };
}

const copy = state => structuredClone(state);

export const currentPlayer = state => (state.phase === 'choose' ? state.players.find(p => p.id === state.order[state.turnIndex]) : null);
export const playerById = (state, id) => state.players.find(p => p.id === id);
export const pickOf = (state, id) => state.picks[id] ?? null;

/** いまの人が長さを決める。全員決まったら「はなす」へ */
export function choose(state, { length, mass = 10, amplitude = 10 }) {
    if (state.phase !== 'choose') throw new Error('いまはえらぶときではありません');
    const s = copy(state);
    const p = currentPlayer(s);
    s.picks[p.id] = { length: clampLength(length), mass, amplitude };
    s.turnIndex += 1;
    if (s.turnIndex >= s.order.length) s.phase = 'resolve';
    return s;
}

/**
 * 全員のふりこの結果（10往復の時間・差・評価・点）
 * @param {Record<string, number>|null} [times] 実測した10往復の時間（プレイヤーID → 秒）。なければ理論値
 */
export function resolveRound(state, times = null) {
    if (state.phase !== 'resolve') throw new Error('まだ全員えらんでいません');
    const s = copy(state);
    const results = s.order.map(id => {
        const pick = s.picks[id];
        const time = times?.[id] ?? tenOf(pick.length);
        const diff = time - s.target.ten;
        const g = gradeFor(diff);
        return { playerId: id, length: pick.length, time, diff, grade: g.grade, points: g.points };
    });
    for (const r of results) playerById(s, r.playerId).total += r.points;
    s.history.push({ round: s.round, target: s.target, results });
    if (s.round >= s.rounds) {
        s.phase = 'over';
        s.result = computeResult(s);
    } else {
        s.phase = 'between';
    }
    return s;
}

/** 次のラウンド：先頭を入れかえ、新しい目標 */
export function nextRound(state, rng = Math.random) {
    if (state.phase !== 'between') throw new Error('まだラウンドの途中です');
    const s = copy(state);
    s.round += 1;
    s.order = [...s.order.slice(1), s.order[0]];
    s.target = makeTarget(rng, s.target);
    s.turnIndex = 0;
    s.picks = {};
    s.phase = 'choose';
    return s;
}

/** 合計点の順位表（同点は同じ順位） */
export function computeResult(state) {
    const rows = state.players.map(p => ({
        playerId: p.id,
        total: p.total,
        grades: state.history.map(h => h.results.find(r => r.playerId === p.id)?.grade ?? '-'),
    }));
    rows.sort((a, b) => b.total - a.total);
    let rank = 0;
    rows.forEach((row, i) => {
        rank = i > 0 && rows[i - 1].total === row.total ? rank : i + 1;
        row.rank = rank;
    });
    return { rows, winners: rows.filter(r => r.rank === 1).map(r => r.playerId) };
}

/** 選べる長さにそろえる */
export { clampLength };
