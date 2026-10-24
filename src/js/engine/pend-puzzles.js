/**
 * ふりこの もんだい（予想してからたしかめる）
 *
 * kind
 *   compare … 2つのふりこ A・B。どちらが先に 10往復するか（1往復の時間が短いほうが先）を予想する
 *   control … 調べたい条件（goal）を調べるのに「正しい実験」（その条件だけがちがう組み合わせ）をえらぶ
 *   tune    … 1往復（または10往復）がねらいの時間になる長さをえらぶ
 *   choice  … 身の回りのふりこ。はやく／おそくするには長さをどうするか
 *
 * 答えはデータに書かず、物理（periodOf）から correctOption() で求める。テストが「答えがちょうど1つあること」を確かめる。
 */

import { createPendulum, compareSpeed, isFairTest, periodOf, tenOf, CONDITION_META } from './pendulum.js';

export const CHAPTERS = Object.freeze([
    { id: 1, title: '長さがちがう', lead: 'ふりこが長いほど、1往復の時間は長くなる' },
    { id: 2, title: '重さは関係ある？', lead: 'おもりの重さを変えても、1往復の時間は変わらない' },
    { id: 3, title: 'ふれはばは？', lead: 'ふれはばを変えても、1往復の時間は変わらない' },
    { id: 4, title: '正しいじっけんは？', lead: '調べたい条件だけを変えて、ほかの条件はそろえる' },
    { id: 5, title: 'ちょうどの時間', lead: '長さを決めれば、1往復の時間が決まる' },
]);

/** [長さ, 重さ, ふれはば] の省略記法 */
const P = (length, mass = 10, amplitude = 20) => ({ length, mass, amplitude });
const AB = (a, b) => [{ label: 'A', ...a }, { label: 'B', ...b }];

/** 2つのふりこの選択肢：A が先・同時・B が先（「はやい」は第3章の「速さ」とまぎらわしいので使わない） */
export const COMPARE_OPTIONS = Object.freeze([
    { id: 'a', label: 'A が 先に 10往復' },
    { id: 'same', label: 'どちらも 同時' },
    { id: 'b', label: 'B が 先に 10往復' },
]);

export const PUZZLES = Object.freeze([
    // ---- 1章 長さ ----
    {
        chapter: 1, kind: 'compare', title: 'みじかい と ながい',
        text: 'A は 25cm、B は 100cm。先に 10往復するのは どっちかな？',
        hint: 'ふりこが長いと、1往復にかかる時間はどうなる？',
        pendulums: AB(P(25), P(100)),
        lesson: 'みじかいふりこほど、1往復の時間は みじかい。ながいふりこは ゆっくり往復する。',
    },
    {
        chapter: 1, kind: 'compare', title: '75cm と 50cm',
        text: 'A は 75cm、B は 50cm。先に 10往復するのは どっち？',
        hint: 'みじかいほうが、1往復の時間も みじかい',
        pendulums: AB(P(75), P(50)),
        lesson: '長さが少しちがうだけでも、時間はちがう。',
    },
    {
        chapter: 1, kind: 'compare', title: 'おなじ長さ',
        text: 'A も B も 50cm。先に 10往復するのは どっち？',
        hint: '長さが同じなら…',
        pendulums: AB(P(50), P(50)),
        lesson: '長さが同じなら、1往復の時間も同じ。ずっと そろって ふれる。',
    },
    // ---- 2章 重さ ----
    {
        chapter: 2, kind: 'compare', title: 'おもい おもり',
        text: '長さは同じ 50cm。B のおもりは 30g で おもい。先に 10往復するのは どっち？',
        hint: 'おもいほうが 先に往復する？ 本当にそうかな。たしかめてみよう',
        pendulums: AB(P(50, 10), P(50, 30)),
        lesson: 'おもりの重さを変えても、1往復の時間は変わらない！',
    },
    {
        chapter: 2, kind: 'compare', title: 'かるい おもり',
        text: 'どちらも 75cm。A は 30g、B は 10g。先に 10往復するのは どっち？',
        hint: '重さは時間に関係ある？',
        pendulums: AB(P(75, 30), P(75, 10)),
        lesson: 'かるくても おもくても、同じ長さなら同じ時間。',
    },
    {
        chapter: 2, kind: 'compare', title: '重さも長さもちがう',
        text: 'A は 50cm・30g、B は 100cm・10g。先に 10往復するのは どっち？',
        hint: '重さは関係ない。長さだけを見よう',
        pendulums: AB(P(50, 30), P(100, 10)),
        lesson: '重さは関係なし。長さだけで決まる。',
    },
    // ---- 3章 ふれはば ----
    {
        chapter: 3, kind: 'compare', title: '大きく ふる',
        text: 'どちらも 50cm。B は 30° と大きくふる。先に 10往復するのは どっち？',
        hint: '大きくふると、動くきょりは長い。でも、速さも…？',
        pendulums: AB(P(50, 10, 10), P(50, 10, 30)),
        lesson: 'ふれはばを変えても、1往復の時間は変わらない！ 大きくふると、そのぶん速く動く。',
    },
    {
        chapter: 3, kind: 'compare', title: 'ふれはば と 長さ',
        text: 'A は 25cm で 30°、B は 100cm で 10°。先に 10往復するのは どっち？',
        hint: 'ふれはばは関係ない。長さだけを見よう',
        pendulums: AB(P(25, 10, 30), P(100, 10, 10)),
        lesson: 'ふれはばが大きくても、みじかいふりこのほうが 先に 10往復する。',
    },
    {
        chapter: 3, kind: 'compare', title: '重さも ふれはばも',
        text: 'どちらも 75cm。A は 20g・30°、B は 10g・10°。先に 10往復するのは どっち？',
        hint: '時間を決めるのは、3つの条件のうち1つだけ',
        pendulums: AB(P(75, 20, 30), P(75, 10, 10)),
        lesson: '重さとふれはばをどう変えても、長さが同じなら時間は同じ。',
    },
    // ---- 4章 正しい実験 ----
    {
        chapter: 4, kind: 'control', goal: 'length', title: '長さを調べたい',
        text: '「長さ」と時間の関係を調べたい。正しいじっけんはどれ？',
        hint: '長さ だけ を変えて、重さ・ふれはば はそろえる',
        options: [
            { id: 'p1', pendulums: AB(P(50, 10, 20), P(100, 10, 20)) },
            { id: 'p2', pendulums: AB(P(50, 10, 20), P(100, 30, 20)) },
            { id: 'p3', pendulums: AB(P(50, 10, 20), P(50, 30, 20)) },
        ],
        lesson: '調べたい条件だけを変える。2つ変えると、どちらのせいかわからなくなる。',
    },
    {
        chapter: 4, kind: 'control', goal: 'mass', title: '重さを調べたい',
        text: '「重さ」と時間の関係を調べたい。正しいじっけんはどれ？',
        hint: '重さ だけ がちがう組み合わせをえらぼう',
        options: [
            { id: 'p1', pendulums: AB(P(50, 10, 20), P(100, 30, 20)) },
            { id: 'p2', pendulums: AB(P(50, 10, 20), P(50, 30, 20)) },
            { id: 'p3', pendulums: AB(P(50, 10, 10), P(50, 30, 30)) },
        ],
        lesson: '重さだけを変えて、時間が同じなら「重さは関係ない」といえる。',
    },
    {
        chapter: 4, kind: 'control', goal: 'amplitude', title: 'ふれはばを調べたい',
        text: '「ふれはば」と時間の関係を調べたい。正しいじっけんはどれ？',
        hint: 'ふれはば だけ がちがう組み合わせをえらぼう',
        options: [
            { id: 'p1', pendulums: AB(P(50, 10, 10), P(100, 10, 30)) },
            { id: 'p2', pendulums: AB(P(50, 10, 20), P(50, 30, 20)) },
            { id: 'p3', pendulums: AB(P(50, 10, 10), P(50, 10, 30)) },
        ],
        lesson: '変える条件は1つ。これが「条件をそろえる」じっけんの考え方。',
    },
    // ---- 5章 ちょうどの時間 ----
    {
        chapter: 5, kind: 'tune', target: { period: 1 }, title: '1往復 1秒',
        text: '1往復が ちょうど 1秒 になるふりこを作ろう。長さは？',
        hint: 'みじかいほど 1往復の時間は みじかい。10往復で 10秒 になる長さ',
        pendulums: [{ label: 'A', ...P(50) }],
        lesson: '約 25cm のふりこは、1往復が ほぼ 1秒。',
    },
    {
        chapter: 5, kind: 'tune', target: { period: 2 }, title: 'ふりこ時計',
        text: 'ふりこ時計は 1往復 2秒。その長さは？',
        hint: '1秒の 2倍の時間。長さは 2倍ではないよ',
        pendulums: [{ label: 'A', ...P(50) }],
        lesson: '1往復 2秒（かた道 1秒）は 約 1m。時間を 2倍にするには、長さは 4倍 いる。むかし、この長さを「1m」にしようという案もあったよ。',
    },
    {
        chapter: 5, kind: 'tune', target: { ten: 14 }, title: '10往復で 14秒',
        text: '10往復が 14秒 くらいになる長さは？',
        hint: '1往復は 1.4秒。1秒（25cm）と 2秒（100cm）のあいだ',
        pendulums: [{ label: 'A', ...P(25) }],
        lesson: '50cm で 10往復は 約 14.2秒。表やグラフにすると、長さと時間の関係が見えてくる。',
    },
    {
        chapter: 5, kind: 'choice', goal: 'faster', title: 'おくれる時計',
        text: 'ふりこ時計が おくれている（1往復に時間がかかりすぎ）。はやくするには？',
        hint: 'はやくする ＝ 1往復の時間を みじかくする',
        pendulums: [{ label: 'A', ...P(75) }],
        options: [
            { id: 'longer', label: 'ふりこを 長くする', patch: { length: 100 } },
            { id: 'shorter', label: 'ふりこを みじかくする', patch: { length: 50 } },
        ],
        lesson: 'おもりを上げて みじかくすると、はやくなる。本物のふりこ時計も、そうやって合わせるよ。',
    },
    {
        chapter: 5, kind: 'choice', goal: 'slower', title: 'ゆっくりにしたい',
        text: 'このふりこを、今より ゆっくりふらせたい。おもりをどっちへずらす？',
        hint: 'おそくする ＝ 1往復の時間を ながくする',
        pendulums: [{ label: 'A', ...P(50) }],
        options: [
            { id: 'up', label: 'おもりを 上に（みじかく）', patch: { length: 25 } },
            { id: 'down', label: 'おもりを 下に（ながく）', patch: { length: 100 } },
        ],
        lesson: 'おもりを下げて ながくすると、ゆっくりになる。メトロノームは上下さかさまのふりこで、上のおもりを上げる（支点から遠ざける）とゆっくりになるよ。',
    },
].map((p, i) => ({ id: i + 1, ...p })));

/** 長さの選択肢（tune 用） */
const LENGTH_OPTIONS = CONDITION_META.length.values.map(v => ({ id: `l${v}`, label: `${v}cm`, patch: { length: v } }));

/** もんだいの選択肢（えらぶボタン） */
export function optionsOf(puzzle) {
    if (puzzle.kind === 'compare') return COMPARE_OPTIONS;
    if (puzzle.kind === 'tune') return LENGTH_OPTIONS;
    return puzzle.options;
}

/** ステージに出すふりこ（選択肢をえらんでいれば、それを反映した形） */
export function stagePendulums(puzzle, optionId = null) {
    const opt = optionId ? optionsOf(puzzle).find(o => o.id === optionId) : null;
    let defs;
    if (puzzle.kind === 'control') defs = opt?.pendulums ?? puzzle.pendulums ?? puzzle.options[0].pendulums;
    else if (puzzle.kind === 'choice' && opt) defs = [...puzzle.pendulums, { ...puzzle.pendulums[0], label: 'B', ...opt.patch }];
    else if (puzzle.kind === 'tune' && opt) defs = [{ ...puzzle.pendulums[0], ...opt.patch }];
    else defs = puzzle.pendulums;
    return defs.map(d => createPendulum({ id: d.label, ...d, phase: 'held', side: 1 }));
}

/** 物理から正しい選択肢を求める */
export function correctOption(puzzle) {
    const options = optionsOf(puzzle);
    if (puzzle.kind === 'compare') {
        const [a, b] = puzzle.pendulums;
        return compareSpeed(a, b);
    }
    if (puzzle.kind === 'control') {
        const ok = options.filter(o => isFairTest(o.pendulums[0], o.pendulums[1], puzzle.goal));
        return ok.length === 1 ? ok[0].id : null;
    }
    if (puzzle.kind === 'tune') {
        const ok = options.filter(o => tuneHit(puzzle, o.patch.length));
        return ok.length === 1 ? ok[0].id : null;
    }
    if (puzzle.kind === 'choice') {
        const base = periodOf(puzzle.pendulums[0].length);
        const ok = options.filter(o => (puzzle.goal === 'faster' ? periodOf(o.patch.length) < base : periodOf(o.patch.length) > base));
        return ok.length === 1 ? ok[0].id : null;
    }
    return null;
}

/** ねらいの時間に合っているか（1往復なら ±0.05秒、10往復なら ±0.5秒） */
export function tuneHit(puzzle, length) {
    const { target } = puzzle;
    if (target.period !== undefined) return Math.abs(periodOf(length) - target.period) <= 0.05;
    return Math.abs(tenOf(length) - target.ten) <= 0.5;
}

/** ねらいの時間の表示 */
export function targetText(puzzle) {
    const { target } = puzzle;
    return target.period !== undefined ? `1往復 ${target.period}秒` : `10往復 ${target.ten}秒`;
}

/** 1回目でクリア ★3、2回目 ★2、それ以上 ★1 */
export const starsFor = tries => (tries <= 1 ? 3 : tries === 2 ? 2 : 1);

/** 選択肢の表示（control の実験の組み合わせを文で） */
export function optionText(puzzle, option) {
    if (option.label) return option.label;
    const fmt = p => `${p.length}cm・${p.mass}g・${p.amplitude}°`;
    return option.pendulums.map(p => `${p.label} ${fmt(p)}`).join(' ／ ');
}
