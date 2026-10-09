import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');

function listFiles(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
}

describe('Service Worker のキャッシュ一覧', () => {
    const sw = readFileSync(join(root, 'sw.js'), 'utf8');
    const cached = new Set([...sw.matchAll(/'([^']+\.(?:js|css|html|json|svg|png|woff2))'/g)].map(m => m[1]));

    it('src と public のファイルがすべて含まれている（オフラインで動く）', () => {
        const files = [...listFiles(join(root, 'src')), ...listFiles(join(root, 'public'))]
            .map(f => relative(root, f).replaceAll('\\', '/'))
            .filter(f => !f.endsWith('.txt'));
        const missing = files.filter(f => !cached.has(f));
        expect(missing).toEqual([]);
    });

    it('外部 CDN に依存していない', () => {
        const html = readFileSync(join(root, 'index.html'), 'utf8');
        expect(html).not.toMatch(/https?:\/\//);
    });
});
