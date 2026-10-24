/**
 * たいせんの準備：参加する席（P1〜P4：ひと／CPU／なし と CPU のつよさ）
 * てこ・ふりこ のどちらのたいせんでも同じ部品を使う
 */

import { PLAYER_META, SEAT_IDS } from './players.js';
import { icon } from './icons.js';
import { segmented } from './widgets.js';

/**
 * @param {HTMLElement} root 席をならべる要素
 * @param {{ seats: {kind:string, level:string}[] }} setup 保存する設定（書きかえる）
 * @param {Record<string, {label:string}>} levels CPU のつよさの一覧
 * @param {() => void} onChange 変わったとき
 */
export function renderSeats(root, setup, levels, onChange) {
    root.innerHTML = SEAT_IDS.map((id, i) => `
        <div class="seat c-${id}" data-seat="${i}">
            <div class="seat-head">
                <span class="seat-chip" aria-hidden="true">${icon(id)}</span>
                <b>${PLAYER_META[id].name}</b><span class="seat-color">${PLAYER_META[id].color}</span>
            </div>
            <div class="seg seat-kind" role="radiogroup" aria-label="${PLAYER_META[id].name} の参加"></div>
            <div class="seg seg-sm seat-level" role="radiogroup" aria-label="${PLAYER_META[id].name} のCPUのつよさ"></div>
        </div>`).join('');

    SEAT_IDS.forEach((_id, i) => {
        const seatEl = root.querySelector(`[data-seat="${i}"]`);
        const seat = setup.seats[i] ?? { kind: 'none', level: 'normal' };
        setup.seats[i] = seat;
        const levelBox = seatEl.querySelector('.seat-level');
        const syncSeat = () => {
            levelBox.hidden = seat.kind !== 'cpu';
            seatEl.classList.toggle('is-off', seat.kind === 'none');
            onChange();
        };
        segmented(seatEl.querySelector('.seat-kind'), {
            options: [['human', 'ひと', 'user'], ['cpu', 'CPU', 'robot'], ['none', 'なし']],
            value: seat.kind,
            onChange: v => {
                seat.kind = v;
                syncSeat();
            },
        });
        segmented(levelBox, {
            options: Object.entries(levels).map(([k, v]) => [k, v.label]),
            value: seat.level ?? 'normal',
            onChange: v => {
                seat.level = v;
                onChange();
            },
        });
        syncSeat();
    });
}

/** こわれた保存データでも準備画面が開けるように、席の形をととのえる */
export function normalizeSeats(seats, defaults, levels) {
    return defaults.map((def, i) => {
        const seat = Array.isArray(seats) ? seats[i] : null;
        const kind = ['human', 'cpu', 'none'].includes(seat?.kind) ? seat.kind : def.kind;
        const level = Object.hasOwn(levels, seat?.level) ? seat.level : 'normal';
        return { kind, level };
    });
}

/** 参加人数の案内。2人未満なら始められない @returns {{ ok: boolean, note: string }} */
export function seatsNote(seats, what = 'たいせん') {
    const joined = seats.filter(s => s.kind !== 'none');
    const ok = joined.length >= 2;
    const humans = joined.filter(s => s.kind === 'human').length;
    const note = !ok ? '2人以上えらんでね' : humans === 0 ? `CPUどうしの${what}を見るよ` : `${joined.length}人で${what}（ひと ${humans}人）`;
    return { ok, note };
}
