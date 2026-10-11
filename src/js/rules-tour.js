/**
 * たいせんのあそびかた（絵でステップ）
 * 「?」から開いたときも、はじめての対戦の前に自動で開いたときも、1ページ目から見せる。
 * てこ（#dlg-rules）・ふりこ（#dlg-rules-pend）の両方の <dialog> に入っている .tour を動かす。
 */

import { play } from './audio.js';

function show(d, page) {
    const root = d.querySelector('.tour');
    const pages = [...root.querySelectorAll('.tour-page')];
    const last = pages.length - 1;
    const i = Math.max(0, Math.min(last, page));
    root.dataset.page = String(i);
    pages.forEach((p, k) => { p.hidden = k !== i; });
    root.querySelectorAll('.tour-dots i').forEach((dot, k) => dot.classList.toggle('is-on', k === i));
    root.querySelector('[data-tour="prev"]').disabled = i === 0;
    root.querySelector('[data-tour="next"]').textContent = i === last ? (d.dataset.first ? 'はじめる！' : 'とじる') : 'つぎへ';
    root.querySelector('.tour-status').textContent = `${i + 1} / ${pages.length}：${pages[i].querySelector('h3').textContent}`;
}

export function setupRulesTour() {
    for (const d of document.querySelectorAll('dialog')) {
        const root = d.querySelector('.tour');
        if (!root) continue;
        root.addEventListener('click', e => {
            const act = e.target.closest('[data-tour]')?.dataset.tour;
            if (!act) return;
            play('tap');
            const page = Number(root.dataset.page);
            const last = root.querySelectorAll('.tour-page').length - 1;
            if (act === 'next' && page === last) d.close();
            else show(d, page + (act === 'next' ? 1 : -1));
        });
        // 開くたびに 1ページ目から
        d.addEventListener('sheet-open', () => show(d, 0));
        d.addEventListener('close', () => { delete d.dataset.first; });
        show(d, 0);
    }
}

/**
 * はじめての対戦の前に見せる。閉じたら resolve
 * @param {{ first?: boolean, id?: string }} [opts]
 */
export function showRulesTour({ first = false, id = 'dlg-rules' } = {}) {
    const d = document.getElementById(id);
    if (first) d.dataset.first = '1';
    else delete d.dataset.first;
    show(d, 0);
    d.showModal();
    return new Promise(resolve => d.addEventListener('close', () => resolve(), { once: true }));
}
