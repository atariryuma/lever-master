// scripts/deploy-gas.mjs の clasp 起動の組み立て（実際の push / deploy はしない）
import { join, resolve, delimiter } from 'node:path';
import { claspCommand, resolveClaspEntry } from '../scripts/deploy-gas.mjs';

describe('deploy-gas: clasp を shell なしで起動する', () => {
    const entry = resolve('/dummy/npm/node_modules/@google/clasp/build/src/index.js');

    it('引数は加工せずそのまま渡し、shell を使わない（& や空白をふくむパスも安全）', () => {
        const args = ['--user', 'naha', '-P', 'C:\\Users\\a&b c\\gas-school', 'push', '-f'];
        const c = claspCommand(args, { platform: 'win32', entry, nodePath: 'node.exe' });
        expect(c.cmd).toBe('node.exe');
        expect(c.argv).toEqual([entry, ...args]);
        expect(c.options.shell).toBe(false);
    });

    it('Windows で clasp 本体が見つからなければ shell に頼らずエラーにする', () => {
        expect(() => claspCommand(['push'], { platform: 'win32', entry: null })).toThrow(/clasp/);
    });

    it('Windows 以外で見つからなければ PATH の clasp を shell なしで動かす', () => {
        const c = claspCommand(['push'], { platform: 'linux', entry: null });
        expect(c).toEqual({ cmd: 'clasp', argv: ['push'], options: { shell: false } });
    });

    it('PATH のフォルダの横の node_modules から bin を読む', () => {
        const binDir = resolve('/dummy/npm');
        const pkg = join(binDir, 'node_modules', '@google', 'clasp', 'package.json');
        const got = resolveClaspEntry({
            root: resolve('/dummy/repo'),
            pathEnv: [resolve('/dummy/other'), binDir].join(delimiter),
            exists: p => p === pkg,
            readJson: () => ({ bin: { clasp: 'build/src/index.js' } }),
        });
        expect(got).toBe(entry);
    });

    it('どこにも無ければ null', () => {
        expect(resolveClaspEntry({ root: resolve('/dummy/repo'), pathEnv: '', exists: () => false })).toBeNull();
    });
});
