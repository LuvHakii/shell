import {mkdtempSync, openSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {WASI} from 'node:wasi';

const dist = new URL('../dist/', import.meta.url);
const root = mkdtempSync(`${tmpdir()}/smoke-`);
writeFileSync(`${root}/x.txt`, '1\n2\n');
const tty = {spawn: () => -1, spawn_read() {}, winsize() {}, interrupted: () => 0, poll: () => 0, raw() {}};

async function run(wasm: string, args: string[], stdin = '') {
	writeFileSync(`${root}/.in`, stdin);
	const out = `${root}/.out`;
	const wasi = new WASI({version: 'preview1', args, env: {PWD: '/'}, preopens: {'/': root}, returnOnExit: true,
		stdin: openSync(`${root}/.in`, 'r'), stdout: openSync(out, 'w'), stderr: openSync(`${root}/.err`, 'w')});
	const mod = await WebAssembly.compile(readFileSync(new URL(wasm, dist)));
	wasi.start(await WebAssembly.instantiate(mod, {wasi_snapshot_preview1: wasi.wasiImport, tty}));
	return readFileSync(out, 'utf8');
}

const cases: [string, string[], string, RegExp][] = [
	['nu.wasm', ['nu'], '[1 2 3] | math sum\n', /root@localhost:\/# 6\n/],
	['coreutils.wasm', ['coreutils', 'whoami'], '', /^root\n$/],
	['grep.wasm', ['grep', '-c', 'b'], 'a\nb\nb\n', /^2\n$/],
	['sed.wasm', ['sed', 's/a/b/g'], 'aaa\n', /^bbb\n$/],
	['find.wasm', ['find', '/', '-name', 'x.txt'], '', /^\/x\.txt\n$/],
	['awk.wasm', ['awk', '{s += $1} END {print s}', '/x.txt'], '', /^3\n$/]
];

let failed = 0;
for (const [wasm, args, stdin, want] of cases) {
	const got = await run(wasm, args, stdin).catch(e => String(e));
	const ok = want.test(got);
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${args.join(' ')}${ok ? '' : `\n${got}`}`);
}
process.exit(failed ? 1 : 0);
