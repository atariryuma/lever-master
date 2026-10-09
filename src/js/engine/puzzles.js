/**
 * もんだいモード（つり合わせパズル）
 *
 * fixed … はじめからつるしてあるおもり [位置, 重さ]（動かせない）
 * tray  … つるすおもりの重さ。ぜんぶつるして、つり合えばクリア
 * side  … つるせる側の制限（'left' | 'right'）。省略するとどちらでもOK
 * hideNumbers … 計算式をかくす（頭で計算するもんだい）
 */

import { POSITIONS, canHang, createBoard, hang, isBalanced, sideOf } from './lever.js';

export const CHAPTERS = Object.freeze([
    { id: 1, title: 'おなじ重さ', lead: '同じ重さのおもりは、同じきょりでつり合う' },
    { id: 2, title: '重さがちがう', lead: '重さが2倍なら、きょりは半分でつり合う' },
    { id: 3, title: '2つ以上', lead: 'はたらきは、たし算できる' },
    { id: 4, title: '両がわ', lead: '足りない分だけ、反対がわをふやす' },
    { id: 5, title: '頭で計算', lead: '式を見ないで、予想してからたしかめよう' },
]);

export const PUZZLES = Object.freeze([
    {
        chapter: 1, title: 'はじめの一歩', side: 'right',
        text: '右うでに 10g をつるして、つり合わせよう',
        hint: '左は 3×10 = 30。右も 30 にするには？',
        fixed: [[-3, 10]], tray: [10],
        lesson: '同じ重さなら、支点から同じきょりでつり合うね。',
    },
    {
        chapter: 1, title: 'とおくのおもり', side: 'right',
        text: '右うでに 10g をつるして、つり合わせよう',
        hint: '左は 5×10 = 50',
        fixed: [[-5, 10]], tray: [10],
        lesson: 'きょりが同じなら、左右のはたらきも同じ。',
    },
    {
        chapter: 2, title: '半分の重さ', side: 'right',
        text: '左は 20g。右に 10g をつるしてつり合わせよう',
        hint: '左は 2×20 = 40。10g なら きょり いくつで 40 になる？',
        fixed: [[-2, 20]], tray: [10],
        lesson: '重さが半分なら、きょりを2倍にすればつり合う！',
    },
    {
        chapter: 2, title: '2倍の重さ', side: 'right',
        text: '右に 20g をつるしてつり合わせよう',
        hint: '左は 6×10 = 60。□×20 = 60',
        fixed: [[-6, 10]], tray: [20],
        lesson: '重さが2倍なら、きょりは半分でいい。',
    },
    {
        chapter: 2, title: '3倍の重さ', side: 'right',
        text: '右に 10g をつるしてつり合わせよう',
        hint: '左は 2×30 = 60',
        fixed: [[-2, 30]], tray: [10],
        lesson: '重いおもりも、近くにつるすとはたらきは小さくなるね。',
    },
    {
        chapter: 2, title: 'おもいおもい', side: 'right',
        text: '右に 20g をつるしてつり合わせよう',
        hint: '左は 4×30 = 120。□×20 = 120',
        fixed: [[-4, 30]], tray: [20],
        lesson: 'きょり × 重さ が同じなら、どんな組み合わせでもつり合う。',
    },
    {
        chapter: 3, title: 'たし算', side: 'right',
        text: '左には 2か所。右に 10g をつるしてつり合わせよう',
        hint: '左は 4×10 + 2×10 = 60',
        fixed: [[-4, 10], [-2, 10]], tray: [10],
        lesson: 'いくつかつるしたときは、はたらきをたし算すればいい。',
    },
    {
        chapter: 3, title: '2こで勝負', side: 'right',
        text: '右に 10g を 2こ つるしてつり合わせよう',
        hint: '左は 3×20 = 60。2この合計を 60 に',
        fixed: [[-3, 20]], tray: [10, 10],
        lesson: '答えはいくつもあるよ。ほかの組み合わせもためしてみよう。',
    },
    {
        chapter: 3, title: 'ちがう重さを2こ', side: 'right',
        text: '右に 30g と 10g をつるしてつり合わせよう',
        hint: '左は 5×20 = 100。30g をどこにつるすかから考えよう',
        fixed: [[-5, 20]], tray: [30, 10],
        lesson: '大きいおもりの場所を先に決めると、考えやすいね。',
    },
    {
        chapter: 4, title: '足りない分',
        text: '10g を 1こ つるしてつり合わせよう',
        hint: '左 3×20 = 60、右 2×10 = 20。どちらにいくつ足りない？',
        fixed: [[-3, 20], [2, 10]], tray: [10],
        lesson: '差の分だけ、軽いほうにはたらきを足せばいい。',
    },
    {
        chapter: 4, title: '右を助けよう',
        text: '10g を 1こ つるしてつり合わせよう',
        hint: '左 6×10 = 60、右 1×30 = 30。差は？',
        fixed: [[-6, 10], [1, 30]], tray: [10],
        lesson: '左右の差を計算するのがポイント！',
    },
    {
        chapter: 4, title: '左を助けよう',
        text: '20g を 1こ つるしてつり合わせよう',
        hint: '左 2×20 = 40、右 5×20 = 100',
        fixed: [[-2, 20], [5, 20]], tray: [20],
        lesson: '今度は左が軽かったね。',
    },
    {
        chapter: 5, title: '見ないで計算', hideNumbers: true,
        text: '10g と 30g をつるしてつり合わせよう',
        hint: '左は 4×20。紙に式を書いてみよう',
        fixed: [[-4, 20]], tray: [10, 30],
        lesson: '予想してからたしかめる。これが実験だ！',
    },
    {
        chapter: 5, title: '3か所のおもり', hideNumbers: true,
        text: '20g と 10g をつるしてつり合わせよう',
        hint: '左 1×30 + 5×10、右 2×10。差を出してから考えよう',
        fixed: [[-1, 30], [-5, 10], [2, 10]], tray: [20, 10],
        lesson: '式を整理すれば、むずかしい形でもとける。',
    },
    {
        chapter: 5, title: '3こまとめて', hideNumbers: true,
        text: '20g を 3こ つるしてつり合わせよう',
        hint: '左は 6×30 = 180。20g 3こ のきょりの合計は？',
        fixed: [[-6, 30]], tray: [20, 20, 20],
        lesson: '同じ重さなら、きょりの合計で考えられるね。',
    },
    {
        chapter: 5, title: 'てこマスター', hideNumbers: true,
        text: '10g・20g・30g をぜんぶつるしてつり合わせよう',
        hint: '左 3×30 + 2×20、右 6×10。まず差を求めよう',
        fixed: [[-3, 30], [-2, 20], [6, 10]], tray: [10, 20, 30],
        lesson: 'ここまでとけたら、きみはてこマスター！',
    },
].map((p, i) => ({ id: i + 1, ...p })));

export function puzzleBoard(puzzle) {
    let board = createBoard();
    puzzle.fixed.forEach(([pos, mass], i) => {
        board = hang(board, pos, { id: `f${i + 1}`, mass, locked: true });
    });
    return board;
}

export function trayWeights(puzzle) {
    return puzzle.tray.map((mass, i) => ({ id: `t${i + 1}`, mass }));
}

export const allowedPositions = puzzle => POSITIONS.filter(p => !puzzle.side || sideOf(p) === puzzle.side);

/** 1回目でクリア ★3、2回目 ★2、それ以上 ★1 */
export const starsFor = tries => (tries <= 1 ? 3 : tries === 2 ? 2 : 1);

/** 解をすべて探す（テスト・ヒント用）。答えは位置の配列（tray と同じ順） */
export function solve(puzzle, limit = Infinity) {
    const tray = trayWeights(puzzle);
    const positions = allowedPositions(puzzle);
    const solutions = [];
    const walk = (board, i, chosen) => {
        if (solutions.length >= limit) return;
        if (i === tray.length) {
            if (isBalanced(board)) solutions.push([...chosen]);
            return;
        }
        for (const pos of positions) {
            if (!canHang(board, pos)) continue;
            walk(hang(board, pos, tray[i]), i + 1, [...chosen, pos]);
        }
    };
    walk(puzzleBoard(puzzle), 0, []);
    return solutions;
}
