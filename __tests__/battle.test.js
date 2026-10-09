import { describe, it, expect } from 'vitest';
import {
    canMoveTo, computeResult, createBattle, currentPlayer, forfeit, hang, hasSafeTurn, legalMoves,
    move, moveRuleFor, playerById, pointsOf, release, undoHang, undoMove,
} from '../src/js/engine/battle.js';
import { isBalanced, momentOf } from '../src/js/engine/lever.js';

const human = { kind: 'human' };
const twoPlayers = () => createBattle({ seats: [human, human, null, null], stock: 2 });

describe('createBattle', () => {
    it('中立のおもりが左右3にあり、つり合っている', () => {
        const s = twoPlayers();
        expect(s.board[-3]).toHaveLength(1);
        expect(s.board[3]).toHaveLength(1);
        expect(isBalanced(s.board)).toBe(true);
        expect(s.phase).toBe('hang');
        expect(currentPlayer(s).id).toBe('p1');
    });

    it('先攻の席を指定できる / 不参加の席はとばす', () => {
        const s = createBattle({ seats: [human, null, human, human], firstSeat: 1 });
        expect(s.order).toEqual(['p3', 'p4', 'p1']);
    });

    it('1人ではできない', () => {
        expect(() => createBattle({ seats: [human, null, null, null] })).toThrow();
    });
});

describe('ターンの流れ', () => {
    it('つるすと「うごかす」へ進み、つるしなおすと元にもどる', () => {
        let s = twoPlayers();
        s = hang(s, 3);
        expect(s.phase).toBe('move');
        s = undoHang(s);
        expect(s.phase).toBe('hang');
        expect(currentPlayer(s).stock).toBe(2);
    });

    it('かたむいたらアウトになり、てこはターン前にもどる', () => {
        let s = twoPlayers();
        const before = s.board;
        s = hang(s, 5);
        const r = release(s);
        expect(r.balanced).toBe(false);
        expect(playerById(r.state, 'p1').out).toBe(true);
        expect(r.state.board).toEqual(before);
        // 1人しか残らないので終了
        expect(r.state.phase).toBe('over');
        expect(r.state.result.winners).toEqual(['p2']);
    });

    it('動かしてつり合わせればセーフ', () => {
        let s = twoPlayers();
        s = hang(s, 2); // 右 30+20=50, 左 30
        // 中立の左3を左5へ（3→5 はとなりではない）→ 左 50
        s = move(s, 'n1', -5);
        const r = release(s);
        expect(r.balanced).toBe(true);
        expect(currentPlayer(r.state).id).toBe('p2');
        expect(r.state.phase).toBe('hang');
    });

    it('動かしたのを元にもどせる', () => {
        let s = hang(twoPlayers(), 2);
        s = move(s, 'n1', -5);
        s = undoMove(s);
        expect(s.board[-3].map(w => w.id)).toEqual(['n1']);
        expect(s.moved).toBeNull();
    });
});

describe('時間切れ', () => {
    it('つるす前でもアウトになり、次の人へ進む', () => {
        const s = createBattle({ seats: [human, human, human, null], stock: 2 });
        const r = forfeit(s);
        expect(r.timeout).toBe(true);
        expect(playerById(r.state, 'p1').out).toBe(true);
        expect(playerById(r.state, 'p1').stock).toBe(2);
        expect(currentPlayer(r.state).id).toBe('p2');
    });

    it('つるしたあとなら、おもりは手元にもどり、てこは元どおり', () => {
        const s = twoPlayers();
        const r = forfeit(hang(s, 5));
        expect(r.state.board).toEqual(s.board);
        expect(playerById(r.state, 'p1').stock).toBe(2);
        expect(r.state.phase).toBe('over');
    });
});

describe('うごかすルール', () => {
    it('今つるした場所のおもりは動かせない', () => {
        const s = hang(twoPlayers(), 3);
        expect(moveRuleFor(s, 'n2').ok).toBe(false);
    });

    it('となりへは動かせない（左1⇔右1 もとなり）', () => {
        const s = hang(twoPlayers(), 6);
        expect(canMoveTo(s, 'n1', -4)).toBe(false);
        expect(canMoveTo(s, 'n1', -2)).toBe(false);
        expect(canMoveTo(s, 'n1', -5)).toBe(true);
        const s2 = move(hang(twoPlayers(), 6), 'n1', -1);
        expect(s2.board[-1]).toHaveLength(1);
    });

    it('1ターンに1つだけ', () => {
        let s = hang(twoPlayers(), 6);
        s = move(s, 'n1', -5);
        expect(legalMoves(s)).toHaveLength(0);
        expect(() => move(s, 'n2', 1)).toThrow();
    });

    it('つるす前は動かせない', () => {
        expect(moveRuleFor(twoPlayers(), 'n1').ok).toBe(false);
    });
});

describe('終了と順位', () => {
    it('全員がおもりを使い切ったら、はたらきが大きい人の勝ち', () => {
        let s = createBattle({ seats: [human, human, null, null], stock: 1 });
        // p1: 右2につるし、中立 左3→左5（左50=右50）
        s = release(move(hang(s, 2), 'n1', -5)).state;
        // p2: 左2につるす → 左70, 右50 → 中立 右3 を 右5 へ → 右 70
        s = release(move(hang(s, -2), 'n2', 5)).state;
        expect(s.phase).toBe('over');
        expect(pointsOf(s, 'p1')).toBe(20);
        expect(pointsOf(s, 'p2')).toBe(20);
        expect(s.result.winners.sort()).toEqual(['p1', 'p2']);
    });

    it('アウトの人は生き残りより下の順位', () => {
        const s = createBattle({ seats: [human, human, human, null] });
        s.players[1].out = true;
        s.players[1].outAt = 3;
        const result = computeResult(s);
        expect(result.rows.at(-1).playerId).toBe('p2');
        expect(result.rows.at(-1).rank).toBe(3);
    });
});

describe('hasSafeTurn', () => {
    it('はじめの盤面ではつり合う手がある', () => {
        expect(hasSafeTurn(twoPlayers())).toBe(true);
        const s = hang(twoPlayers(), 4);
        expect(Math.abs(momentOf(s.board).diff)).toBe(40);
    });
});
