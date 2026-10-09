/**
 * 外部ライブラリをリポジトリに同梱する（オフライン動作のため CDN は使わない）
 *   - three.js … ソースで使っている名前だけを1ファイルにまとめて圧縮
 *   - Orbitron フォント
 * three を更新したら `npm run vendor` を実行してコミットしてください。
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const files = dir => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
});

const names = new Set();
for (const file of files(join(root, 'src/js'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'[./]*vendor\/three\.js'/g)) {
        m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(n => names.add(n));
    }
}

mkdirSync(join(root, 'src/vendor'), { recursive: true });
await build({
    stdin: { contents: `export { ${[...names].sort().join(', ')} } from 'three';`, resolveDir: root },
    bundle: true,
    format: 'esm',
    minify: true,
    legalComments: 'inline',
    outfile: join(root, 'src/vendor/three.js'),
});
console.log(`three.js: ${names.size} exports`);

mkdirSync(join(root, 'public/fonts'), { recursive: true });
for (const w of [700, 900]) {
    copyFileSync(
        join(root, `node_modules/@fontsource/orbitron/files/orbitron-latin-${w}-normal.woff2`),
        join(root, `public/fonts/orbitron-${w}.woff2`),
    );
}
copyFileSync(join(root, 'node_modules/@fontsource/orbitron/LICENSE'), join(root, 'public/fonts/OFL.txt'));
console.log('fonts copied');
