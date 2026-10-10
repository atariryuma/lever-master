/**
 * たいせんモードのルールエンジン（純粋関数・状態は毎回コピー）
 *
 * 1ターンの流れ
 *   1. つるす … 自分のおもりを1つつるす（持っているときは必須）
 *   2. うごかす … 好きなおもりを1つだけ動かしてよい（任意）
 *      - 今つるした場所のおもりは動かせない
 *      - となりの位置へは動かせない（左1⇔右1 もとなり）
 *   3. はなす … 手をはなして判定。かたむいたらアウト（てこはターン前にもどる）
 *
 * 全員がおもりを使い切ったら、生き残りの中で「はたらき」（きょり×重さの合計）が一番大きい人の勝ち。
 * 1人だけ生き残った場合はその人の勝ち。
 */

import {
    POSITIONS,
    canHang,
    cloneBoard,
    createBoard,
    findWeight,
    hang as hangOnBoard,
    isAdjacent,
    isBalanced,
    momentByOwner,
    momentOf,
    moveWeight,
} from './lever.js';

const WEIGHT_MASS = 10;
const DEFAULT_STOCK = 4;

/**
 * @param {{ seats: ({kind:'human'|'cpu', level?:string}|null)[], stock?: number, firstSeat?: number }} options
 *   seats は P1〜P4 の席。null は不参加。
 */
export function createBattle({ seats, stock = DEFAULT_STOCK, firstSeat = 0 }) {
    const players = seats
        .map((seat, i) => (seat ? {
            id: `p${i + 1}`,
            seat: i,
            kind: seat.kind,
            level: seat.level ?? null,
            stock,
            out: false,
            outAt: null,
        } : null))
        .filter(Boolean);

    if (players.length < 2) throw new Error('2人以上必要です');

    const startIdx = Math.max(0, players.findIndex(p => p.seat >= firstSeat));
    const order = [...players.slice(startIdx), ...players.slice(0, startIdx)].map(p => p.id);

    let board = createBoard();
    board = hangOnBoard(board, -3, { id: 'n1', mass: WEIGHT_MASS, owner: 'neutral' });
    board = hangOnBoard(board, 3, { id: 'n2', mass: WEIGHT_MASS, owner: 'neutral' });

    return startTurn({
        board,
        players,
        order,
        turnIndex: 0,
        turnNumber: 1,
        phase: 'hang',
        hung: null,
        moved: null,
        turnStartBoard: null,
        nextWeight: 1,
        result: null,
    });
}

const copy = state => structuredClone(state);

export const currentPlayer = state => state.players.find(p => p.id === state.order[state.turnIndex]);
export const playerById = (state, id) => state.players.find(p => p.id === id);
export const alivePlayers = state => state.players.filter(p => !p.out);

function startTurn(state) {
    const s = copy(state);
    const player = currentPlayer(s);
    s.phase = player.stock > 0 ? 'hang' : 'move';
    s.hung = null;
    s.moved = null;
    s.turnStartBoard = cloneBoard(s.board);
    return s;
}

/** 今の手番でつるせる位置 */
export function hangablePositions(state) {
    if (state.phase !== 'hang') return [];
    return POSITIONS.filter(pos => canHang(state.board, pos));
}

export function hang(state, pos) {
    if (state.phase !== 'hang') throw new Error('いまはつるすときではありません');
    if (!canHang(state.board, pos)) throw new Error('そこにはつるせません');
    const s = copy(state);
    const player = currentPlayer(s);
    const weight = { id: `w${s.nextWeight}`, mass: WEIGHT_MASS, owner: player.id };
    s.nextWeight += 1;
    s.board = hangOnBoard(s.board, pos, weight);
    player.stock -= 1;
    s.hung = { pos, weightId: weight.id };
    s.phase = 'move';
    return s;
}

/** つるしなおし（動かした後なら、動かしたのも元にもどる） */
export function undoHang(state) {
    if (!state.hung) throw new Error('つるしたおもりがありません');
    const s = copy(state);
    s.board = cloneBoard(s.turnStartBoard);
    currentPlayer(s).stock += 1;
    s.hung = null;
    s.moved = null;
    s.phase = 'hang';
    return s;
}

export function undoMove(state) {
    if (!state.moved) throw new Error('動かしたおもりがありません');
    const s = copy(state);
    s.board = moveWeight(s.board, s.moved.weightId, s.moved.from);
    s.moved = null;
    return s;
}

/** このおもりを動かせるか（理由つき） */
export function moveRuleFor(state, weightId) {
    if (state.phase !== 'move') return { ok: false, reason: 'まずおもりをつるそう' };
    if (state.moved) return { ok: false, reason: '動かせるのは1ターンに1つだけ' };
    const found = findWeight(state.board, weightId);
    if (!found) return { ok: false, reason: 'おもりが見つかりません' };
    if (state.hung && found.pos === state.hung.pos) {
        return { ok: false, reason: '今つるした場所のおもりは動かせないよ' };
    }
    return { ok: true, from: found.pos };
}

export function canMoveTo(state, weightId, toPos) {
    const rule = moveRuleFor(state, weightId);
    if (!rule.ok) return false;
    return toPos !== rule.from && !isAdjacent(rule.from, toPos) && canHang(state.board, toPos);
}

export function moveDestinations(state, weightId) {
    return POSITIONS.filter(pos => canMoveTo(state, weightId, pos));
}

/** 動かせるすべての手 { weightId, from, to } */
export function legalMoves(state) {
    const moves = [];
    for (const from of POSITIONS) {
        if (state.hung && from === state.hung.pos) continue;
        for (const w of state.board[from]) {
            for (const to of moveDestinations(state, w.id)) moves.push({ weightId: w.id, from, to });
        }
    }
    return moves;
}

export function move(state, weightId, toPos) {
    if (!canMoveTo(state, weightId, toPos)) throw new Error('そこへは動かせません');
    const s = copy(state);
    const from = findWeight(s.board, weightId).pos;
    s.board = moveWeight(s.board, weightId, toPos);
    s.moved = { weightId, from, to: toPos };
    return s;
}

/** 手をはなせる状態か（持っているならつるしてから） */
const canRelease = state => state.phase === 'move';

/**
 * 手をはなして判定する
 * @returns {{ state: object, balanced: boolean, playerId: string, moment: {left:number,right:number,diff:number} }}
 */
export function release(state) {
    if (!canRelease(state)) throw new Error('まずおもりをつるそう');
    const player = currentPlayer(state);
    const moment = momentOf(state.board);
    const balanced = moment.diff === 0;
    const s = balanced ? copy(state) : knockOut(state);
    return { state: advance(s), balanced, playerId: player.id, moment };
}

/** 時間切れ：その場でアウト（てこはターン前にもどる） */
export function forfeit(state) {
    if (state.phase === 'over') throw new Error('ゲームは終わっています');
    const player = currentPlayer(state);
    const moment = momentOf(state.board);
    return { state: advance(knockOut(state)), balanced: false, playerId: player.id, moment, timeout: true };
}

/** いまの手番の人をアウトにし、てこをターン前にもどす */
function knockOut(state) {
    const s = copy(state);
    const p = currentPlayer(s);
    p.out = true;
    p.outAt = s.turnNumber;
    s.board = cloneBoard(s.turnStartBoard);
    if (s.hung) p.stock += 1;
    return s;
}

function advance(state) {
    const s = copy(state);
    const alive = alivePlayers(s);
    if (alive.length <= 1 || alive.every(p => p.stock === 0)) {
        s.phase = 'over';
        s.hung = null;
        s.moved = null;
        s.result = computeResult(s);
        return s;
    }
    let idx = s.turnIndex;
    do {
        idx = (idx + 1) % s.order.length;
    } while (playerById(s, s.order[idx]).out);
    s.turnIndex = idx;
    s.turnNumber += 1;
    return startTurn(s);
}

export const pointsOf = (state, playerId) => momentByOwner(state.board, playerId);

/** 順位表。生き残り（はたらきの大きい順）→ アウトになった人（あとまで残った順） */
export function computeResult(state) {
    const rows = state.players.map(p => ({
        playerId: p.id,
        points: p.out ? 0 : momentByOwner(state.board, p.id),
        out: p.out,
        outAt: p.outAt,
    }));
    rows.sort((a, b) => {
        if (a.out !== b.out) return a.out ? 1 : -1;
        if (!a.out) return b.points - a.points;
        return b.outAt - a.outAt;
    });
    let rank = 0;
    rows.forEach((row, i) => {
        const prev = rows[i - 1];
        const tied = prev && prev.out === row.out
            && (row.out ? prev.outAt === row.outAt : prev.points === row.points);
        rank = tied ? rank : i + 1;
        row.rank = rank;
    });
    const winners = rows.filter(r => r.rank === 1).map(r => r.playerId);
    return { rows, winners };
}

/** 盤面がつり合う手（つるす位置と動かし方の組み合わせ）があるか */
export function hasSafeTurn(state) {
    const tryRelease = s => isBalanced(s.board);
    if (state.phase === 'move' && !state.hung) {
        if (tryRelease(state)) return true;
        return legalMoves(state).some(m => tryRelease(move(state, m.weightId, m.to)));
    }
    for (const pos of hangablePositions(state)) {
        const afterHang = hang(state, pos);
        if (tryRelease(afterHang)) return true;
        for (const m of legalMoves(afterHang)) {
            if (isBalanced(moveWeight(afterHang.board, m.weightId, m.to))) return true;
        }
    }
    return false;
}
