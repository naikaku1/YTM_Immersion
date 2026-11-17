// Rebuild the shipped offline assets. Runtime needs neither npm nor a CDN.
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const CMU_REV = '74790861f652b15e4ac49015a90074ad62a27690';
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'ytm-vendor-'));
const assets = join(root, 'src/assets/pronunciation');
const vendor = join(root, 'src/js/vendor');
try {
  execFileSync('npm', ['install', '--prefix', temp, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', 'kuromoji@0.1.2', 'esbuild@0.25.12'], { stdio: 'inherit' });
  const pkg = join(temp, 'node_modules/kuromoji');
  await mkdir(assets, { recursive: true });
  await mkdir(vendor, { recursive: true });
  await cp(join(pkg, 'dict'), join(assets, 'ja'), { recursive: true });
  const entry = join(temp, 'entry.js');
  await writeFile(entry, `export { default as Tokenizer } from './node_modules/kuromoji/src/Tokenizer.js';\nexport { default as DynamicDictionaries } from './node_modules/kuromoji/src/dict/DynamicDictionaries.js';\n`);
  const { build } = await import(pathToFileURL(join(temp, 'node_modules/esbuild/lib/main.js')));
  await build({ entryPoints: [entry], outfile: join(vendor, 'kuromoji.js'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', minify: true, legalComments: 'eof' });
  const fetchText = async name => {
    const response = await fetch(`https://raw.githubusercontent.com/cmusphinx/cmudict/${CMU_REV}/${name}`);
    if (!response.ok) throw new Error(`CMUdict ${name}: ${response.status}`);
    return response.text();
  };
  const raw = await fetchText('cmudict.dict');
  const dictionary = Object.create(null);
  for (const line of raw.split('\n')) {
    const match = line.match(/^([a-z]+(?:'[a-z]+)*) ([A-Z0-9 ]+)(?: #.*)?$/);
    if (match && !Object.hasOwn(dictionary, match[1])) dictionary[match[1]] = match[2].trim();
  }
  await writeFile(join(assets, 'en.json.gz'), gzipSync(JSON.stringify(dictionary), { level: 9 }));
  await cp(join(pkg, 'LICENSE-2.0.txt'), join(assets, 'LICENSE-kuromoji.txt'));
  await cp(join(pkg, 'NOTICE.md'), join(assets, 'NOTICE-ipadic.txt'));
  await cp(join(temp, 'node_modules/doublearray/LICENSE.txt'), join(assets, 'LICENSE-doublearray.txt'));
  await writeFile(join(assets, 'LICENSE-cmudict.txt'), await fetchText('LICENSE'));
  const { readdir } = await import('node:fs/promises');
  const files = ['en.json.gz', ...(await readdir(join(assets, 'ja'))).sort().map(name => `ja/${name}`)];
  const hashes = {};
  for (const file of files) hashes[file] = createHash('sha256').update(await readFile(join(assets, file))).digest('hex');
  hashes['../../js/vendor/kuromoji.js'] = createHash('sha256').update(await readFile(join(vendor, 'kuromoji.js'))).digest('hex');
  await writeFile(join(assets, 'sources.json'), JSON.stringify({ cmudict: { repository: 'https://github.com/cmusphinx/cmudict', revision: CMU_REV, entries: Object.keys(dictionary).length }, kuromoji: { repository: 'https://github.com/takuyaa/kuromoji.js', version: '0.1.2' }, doublearray: '0.0.2', esbuild: '0.25.12', sha256: hashes }, null, 2) + '\n');
} finally {
  await rm(temp, { recursive: true, force: true });
}
