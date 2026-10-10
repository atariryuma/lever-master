/**
 * てこ（実験用てこ）の盤面モデル
 *
 * 盤面は「位置 → その位置につるしたおもりの配列」です。
 * 位置は支点からのきょり（左がマイナス、右がプラス）。
 * 配列の 0 番目がうでに一番近いおもりで、新しいおもりは下に追加されます。
 *
 * ここの関数はすべて純粋関数で、引数の盤面を書きかえません。
 */

export const POSITIONS = Object.freeze([-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6]);
export const MAX_STACK = 6;
export const MASSES = Object.freeze([10, 20, 30]);

/** @typedef {{ id: string, mass: number, owner?: string, locked?: boolean }} Weight */
/** @typedef {Record<number, Weight[]>} Board */

/** @returns {Board} */
export function createBoard() {
    const board = {};
    for (const pos of POSITIONS) board[pos] = [];
    return board;
}

/** @param {Board} board */
export function cloneBoard(board) {
    const copy = {};
    for (const pos of POSITIONS) copy[pos] = board[pos].map(w => ({ ...w }));
    return copy;
}

export const distanceOf = pos => Math.abs(pos);
export const sideOf = pos => (pos < 0 ? 'left' : 'right');

/** 左右の「てこをかたむけるはたらき」（きょり × 重さ） */
export function momentOf(board) {
    let left = 0;
    let right = 0;
    for (const pos of POSITIONS) {
        const m = distanceOf(pos) * massAt(board, pos);
        if (pos < 0) left += m;
        else right += m;
    }
    return { left, right, diff: left - right };
}

const massAt = (board, pos) => board[pos].reduce((sum, w) => sum + w.mass, 0);

export const isBalanced = board => momentOf(board).diff === 0;

/**
 * 片側の計算式の項（支点から遠い順）
 * @returns {{ pos: number, distance: number, mass: number, moment: number }[]}
 */
export function termsOf(board, side) {
    const positions = POSITIONS.filter(p => sideOf(p) === side && board[p].length > 0);
    return positions
        .map(pos => {
            const mass = massAt(board, pos);
            return { pos, distance: distanceOf(pos), mass, moment: distanceOf(pos) * mass };
        })
        .sort((a, b) => b.distance - a.distance);
}

/** となりどうし（-1 と +1 も支点をはさんでとなり） */
export function isAdjacent(a, b) {
    if ((a === -1 && b === 1) || (a === 1 && b === -1)) return true;
    return Math.abs(a - b) === 1;
}

export const canHang = (board, pos) => POSITIONS.includes(pos) && board[pos].length < MAX_STACK;

export function findWeight(board, id) {
    for (const pos of POSITIONS) {
        const index = board[pos].findIndex(w => w.id === id);
        if (index !== -1) return { pos, index, weight: board[pos][index] };
    }
    return null;
}

/** おもりを位置 pos の一番下につるす */
export function hang(board, pos, weight) {
    if (!canHang(board, pos)) throw new Error(`cannot hang at ${pos}`);
    const next = cloneBoard(board);
    next[pos].push({ ...weight });
    return next;
}

export function removeWeight(board, id) {
    const found = findWeight(board, id);
    if (!found) throw new Error(`weight ${id} not found`);
    const next = cloneBoard(board);
    next[found.pos].splice(found.index, 1);
    return next;
}

export function moveWeight(board, id, toPos) {
    const found = findWeight(board, id);
    if (!found) throw new Error(`weight ${id} not found`);
    if (found.pos === toPos) return cloneBoard(board);
    return hang(removeWeight(board, id), toPos, found.weight);
}

/**
 * つかんだおもりと、その下にぶら下がっているおもり（いっしょに動く「くさり」）
 * @returns {Weight[]} つかんだおもりが先頭。見つからなければ空
 */
export function chainOf(board, id) {
    const found = findWeight(board, id);
    return found ? board[found.pos].slice(found.index) : [];
}

/** くさりごと pos へつるせるか（MAX_STACK をこえない） */
export function canHangChain(board, pos, count) {
    return POSITIONS.includes(pos) && board[pos].length + count <= MAX_STACK;
}

/** おもりを、その下のおもりごと toPos の一番下へ動かす（ならび順はそのまま） */
export function moveChain(board, id, toPos) {
    const found = findWeight(board, id);
    if (!found) throw new Error(`weight ${id} not found`);
    if (found.pos === toPos) return cloneBoard(board);
    const chain = board[found.pos].slice(found.index);
    if (!canHangChain(board, toPos, chain.length)) throw new Error(`cannot hang ${chain.length} at ${toPos}`);
    const next = cloneBoard(board);
    next[found.pos].splice(found.index);
    next[toPos].push(...chain.map(w => ({ ...w })));
    return next;
}

/** 持ち主ごとのはたらき（＝たいせんのポイント） */
export function momentByOwner(board, owner) {
    let total = 0;
    for (const pos of POSITIONS) {
        for (const w of board[pos]) {
            if (w.owner === owner) total += distanceOf(pos) * w.mass;
        }
    }
    return total;
}

/** 表示用の位置名（例: 左3） */
export const positionLabel = pos => `${pos < 0 ? '左' : '右'}${distanceOf(pos)}`;
