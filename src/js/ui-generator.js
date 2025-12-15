/**
 * UI生成モジュール
 * 純粋なHTML生成関数を提供
 * DOM操作は含まず、文字列のHTMLのみを返す
 */

import { COLORS } from './constants.js';
import { hexToRGBA, PLAYER_META } from './utils.js';

/**
 * ポイントランキングHTML生成
 * @param {Object.<string, number>} points - プレイヤーごとのポイント
 * @param {string[]} activePlayers - アクティブなプレイヤーリスト
 * @returns {string} ランキングHTML
 */
export function generatePointsRankingHtml(points, activePlayers) {
    const sortedPlayers = [...activePlayers].sort((a, b) => points[b] - points[a]);

    let html = '<div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:12px;margin:12px 0;">';
    html += '<div style="font-size:0.85rem;color:#aaa;margin-bottom:8px;">🏅 ポイントランキング</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px;">';

    sortedPlayers.forEach((player, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
        const meta = PLAYER_META[player];
        const pt = points[player];
        html += `<div style="display:flex;align-items:center;gap:8px;">
            <span style="width:24px;">${medal}</span>
            <span style="color:${meta.cssColor};font-weight:700;width:40px;">${meta.displayName}</span>
            <span style="font-family:'Orbitron',sans-serif;color:var(--neon-green);">${pt} PT</span>
        </div>`;
    });

    html += '</div></div>';
    return html;
}

/**
 * バランス情報HTMLを生成
 * @param {number} leftMoment - 左側モーメント
 * @param {number} rightMoment - 右側モーメント
 * @returns {string} バランス情報HTML
 */
export function generateBalanceInfoHtml(leftMoment, rightMoment) {
    return `<div style="background:rgba(255,255,0,0.1);border:1px solid #ffff00;border-radius:8px;padding:10px;margin-bottom:8px;">
        <div style="font-size:0.8rem;color:#ffff00;">⚖️ 最終バランス</div>
        <div style="display:flex;justify-content:center;gap:16px;font-family:'Orbitron',sans-serif;font-size:0.85rem;">
            <span style="color:#00f5ff;">L: ${leftMoment}</span>
            <span style="color:#ffff00;">=</span>
            <span style="color:#ff5577;">R: ${rightMoment}</span>
        </div>
    </div>`;
}

/**
 * てこの状態（おもりの位置）をビジュアル化したHTML生成（純粋関数版）
 * @param {Object.<number, Array>} leverData - てこのデータ {pos: [weights...]}
 * @returns {string} てこの状態HTML
 */
export function generateLeverStateHtml(leverData) {
    // プレイヤーカラーをrgba形式で生成
    const ownerColors = {
        blue: hexToRGBA(COLORS.BLUE.primary, 0.8),
        yellow: hexToRGBA(COLORS.YELLOW.primary, 0.8),
        red: hexToRGBA(COLORS.RED.primary, 0.8),
        green: hexToRGBA(COLORS.GREEN.primary, 0.8),
    };

    let html = '<div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:12px;margin-top:8px;">';
    html += '<div style="font-size:0.8rem;color:#888;margin-bottom:8px;">📍 おもりの位置</div>';
    html += '<div style="display:flex;justify-content:center;align-items:end;gap:2px;height:60px;margin-bottom:8px;">';

    // 全位置を表示
    for (let pos = -6; pos <= 6; pos++) {
        if (pos === 0) {
            // 支点
            html += '<div style="width:20px;height:30px;background:linear-gradient(to top,#ffcc00,#ff9500);border-radius:2px 2px 0 0;margin:0 2px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;">▲</div>';
            continue;
        }

        const stack = leverData[pos] || [];
        const count = stack.length;
        const height = Math.min(count * 12, 50);

        // 複数のおもりがある場合はグラデーションで表示
        let bgColor = 'rgba(255,255,255,0.1)';
        if (count > 0) {
            // 最新のおもり（スタック先頭）の色を使用
            const topOwner = stack[0]?.owner || 'blue';
            bgColor = ownerColors[topOwner] || ownerColors.blue;
        }

        html += `<div style="width:16px;height:${height || 8}px;background:${bgColor};border-radius:2px;font-size:0.5rem;display:flex;align-items:center;justify-content:center;color:#fff;" title="位置${pos}: ${count}個">${count > 0 ? count : ''}</div>`;
    }

    html += '</div>';

    // 位置ラベル
    html += '<div style="display:flex;justify-content:center;gap:2px;font-size:0.5rem;color:#666;">';
    for (let pos = -6; pos <= 6; pos++) {
        if (pos === 0) {
            html += '<div style="width:20px;text-align:center;margin:0 2px;">支</div>';
        } else {
            html += `<div style="width:16px;text-align:center;">${Math.abs(pos)}</div>`;
        }
    }
    html += '</div>';

    html += '</div>';
    return html;
}
