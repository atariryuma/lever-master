/** プレイヤーの見た目（色は CSS の .c-p1 などで定義。色だけに頼らないよう記号も持つ） */
export const PLAYER_META = Object.freeze({
    p1: { name: 'P1', color: 'あお', symbol: '●' },
    p2: { name: 'P2', color: 'きいろ', symbol: '▲' },
    p3: { name: 'P3', color: 'あか', symbol: '■' },
    p4: { name: 'P4', color: 'みどり', symbol: '◆' },
});

export const SEAT_IDS = Object.freeze(['p1', 'p2', 'p3', 'p4']);
