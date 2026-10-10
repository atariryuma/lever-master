/**
 * アプリ専用の SVG アイコン（絵文字は OS ごとに見た目が変わるので使わない）
 * 24×24・線の太さ 2・色は currentColor。
 * installIcons() で <body> にスプライトを入れ、icon('名前') で <svg><use> を返す。
 */

const PATHS = {
    back: '<path d="M15 5l-7 7 7 7"/><path d="M8 12h12"/>',
    next: '<path d="M9 5l7 7-7 7"/><path d="M4 12h12"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    book: '<path d="M3 5.5C3 4.7 3.7 4 4.5 4H10a2 2 0 012 2v14a2 2 0 00-2-2H4.5c-.8 0-1.5-.7-1.5-1.5z"/><path d="M21 5.5c0-.8-.7-1.5-1.5-1.5H14a2 2 0 00-2 2v14a2 2 0 012-2h5.5c.8 0 1.5-.7 1.5-1.5z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/><circle cx="12" cy="12" r="6.5"/>',
    help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 015.4 1c0 1.9-2.7 2.4-2.7 4"/><circle cx="12" cy="17.4" r=".6" fill="currentColor"/>',
    flask: '<path d="M9 3h6M10 3v6.2L4.8 18a2 2 0 001.7 3h11a2 2 0 001.7-3L14 9.2V3"/><path d="M7.5 14.5h9"/><circle cx="10.5" cy="17.5" r=".8" fill="currentColor"/><circle cx="14" cy="16.6" r=".6" fill="currentColor"/>',
    puzzle: '<path d="M4 8h4a2 2 0 114 0h4v4a2 2 0 110 4v4H12a2 2 0 10-4 0H4v-4a2 2 0 100-4z"/>',
    scale: '<path d="M12 3v18M7 21h10M4 7h16"/><path d="M12 5l0 2"/><path d="M6 7l-3 6a3 3 0 006 0z"/><path d="M18 7l-3 6a3 3 0 006 0z"/>',
    lever: '<path d="M3 9l18-3"/><path d="M12 7.5L8.5 20h7z"/><path d="M5 9v3M19 6.7v3.5"/><rect x="3" y="12" width="4" height="4" rx="1"/><rect x="17.2" y="10.2" width="3.6" height="3.6" rx="1"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 013 0V11"/><path d="M11 10V4a1.5 1.5 0 013 0v6"/><path d="M14 10V5.5a1.5 1.5 0 013 0V13"/><path d="M17 11a1.5 1.5 0 013 0v3a7 7 0 01-7 7h-1a7 7 0 01-6-3.4L3.6 14a1.5 1.5 0 012.6-1.5L8 15"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0112 6c5 0 9 6 9 6a16 16 0 01-2.7 3.3M6.6 6.6A16 16 0 003 12s4 6 9 6a9 9 0 004.4-1.1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    clear: '<path d="M4 20h16"/><path d="M7 16l9.5-9.5a2.1 2.1 0 013 3L10 19H7z"/><path d="M13.5 9.5l3 3"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".6" fill="currentColor"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>',
    reset: '<path d="M3 12a9 9 0 103-6.7"/><path d="M3 4v5h5"/>',
    fast: '<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/>',
    trophy: '<path d="M8 4h8v6a4 4 0 01-8 0z"/><path d="M8 6H4a3 3 0 003 4M16 6h4a3 3 0 01-3 4"/><path d="M12 14v4M8 21h8M9.5 18h5"/>',
    robot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5"/><circle cx="12" cy="3.5" r="1"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1-4.5-4.3 6.1-.8z"/>',
    phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7v7M9 11l3 3 3-3M10 18.5h4"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
    cube: '<path d="M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z"/><path d="M3.5 7.3L12 12l8.5-4.7M12 12v9.5"/>',
    chart: '<rect x="3" y="11" width="6" height="9" rx="1"/><rect x="15" y="5" width="6" height="15" rx="1"/><path d="M12 3v18"/>',
};

/** プレイヤーの記号（色だけに頼らないため） */
const SHAPES = {
    p1: '<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>',
    p2: '<path d="M12 4.5l8 14.5H4z" fill="currentColor" stroke="none"/>',
    p3: '<rect x="5.5" y="5.5" width="13" height="13" rx="1.5" fill="currentColor" stroke="none"/>',
    p4: '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" fill="currentColor" stroke="none"/>',
};

export function installIcons() {
    if (document.getElementById('icon-sprite')) return;
    const symbols = Object.entries({ ...PATHS, ...SHAPES })
        .map(([name, d]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${d}</symbol>`).join('');
    const holder = document.createElement('div');
    holder.innerHTML = `<svg id="icon-sprite" xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols}</svg>`;
    document.body.prepend(holder.firstElementChild);
}

/** アイコン1つ（装飾なので読み上げない） */
export function icon(name, className = '') {
    return `<svg class="i${className ? ` ${className}` : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

/** 星3つ（取った数だけ塗る） */
export function stars(n, className = '') {
    return [0, 1, 2].map(i => icon('star', `star${i < n ? ' is-on' : ''}${className ? ` ${className}` : ''}`)).join('');
}

export const ICON_NAMES = Object.freeze(Object.keys(PATHS));
