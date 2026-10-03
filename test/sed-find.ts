import {type R, start} from './harness';

const {suite, done} = await start(`
import {Directory, File, PreopenDirectory} from '@bjorn3/browser_wasi_shim';
import {runWasi} from './io';

const enc = new TextEncoder();
const seed = () => new Map([
	['f.txt', new File(enc.encode('one\\ntwo\\nthree\\n'))],
	['dir', new Directory(new Map([
		['a.txt', new File(enc.encode('aaa\\n'))],
		['big.bin', new File(new Uint8Array(5000))],
		['sub', new Directory(new Map([['new.txt', new File(new Uint8Array())]]))]
	]))]
]);
let fs;
const mods = {
	sed: await WebAssembly.compileStreaming(fetch('/sed.wasm')),
	find: await WebAssembly.compileStreaming(fetch('/find.wasm'))
};

Object.assign(globalThis, {
	reset() {
		fs = new PreopenDirectory('/', seed());
	},
	run: (argv, stdin) => runWasi(mods[argv[0]], argv, ['PWD=/'], fs, stdin)
});
`);

const lines = (r: R) => r.out.trim().split('\n').sort().join(' ');
const cases: [string, [string[], string?][], RegExp | ((r: R) => boolean)][] = [
	['sed s///g stdin', [[['sed', 's/a/b/g'], 'banana\n']], /^bbnbnb\n$/],
	['sed -n 2p file', [[['sed', '-n', '2p', '/f.txt']]], /^two\n$/],
	['sed -E', [[['sed', '-E', 's/(o+)/[\\1]/'], 'foo\n']], /^f\[oo\]\n$/],
	['sed multi -e', [[['sed', '-e', '1d', '-e', 's/t/T/'], 'a\nt\n']], /^T\n$/],
	['sed -i -e', [[['sed', '-i', '-e', 's/two/TWO/', '/f.txt']], [['sed', '', '/f.txt']]], /^one\nTWO\nthree\n$/],
	['sed -i.bak', [[['sed', '-i.bak', 's/one/1/', '/f.txt']], [['sed', '', '/f.txt.bak']]], /^one\n/],
	['sed missing file', [[['sed', 'p', '/nope']]], r => r.code !== 0 && /nope/.test(r.err)],
	['find -name', [[['find', '/', '-name', '*.txt']]], r => r.code === 0 && lines(r) === '/dir/a.txt /dir/sub/new.txt /f.txt'],
	['find -type d', [[['find', '/dir', '-type', 'd']]], r => r.code === 0 && lines(r) === '/dir /dir/sub'],
	['find -maxdepth 1', [[['find', '/', '-maxdepth', '1']]], r => r.code === 0 && lines(r) === '/ /dir /f.txt'],
	['find -size +2k', [[['find', '/', '-size', '+2k']]], /^\/dir\/big\.bin\n$/],
	['find -empty', [[['find', '/', '-type', 'f', '-empty']]], /^\/dir\/sub\/new\.txt\n$/],
	['find -regex', [[['find', '/dir', '-regex', '.*a\\.txt']]], /^\/dir\/a\.txt\n$/],
	['find -path -prune', [[['find', '/', '-path', '/dir', '-prune', '-o', '-type', 'f', '-print']]], /^\/f\.txt\n$/],
	['find -print0', [[['find', '/dir/sub', '-print0']]], /^\/dir\/sub\0\/dir\/sub\/new\.txt\0$/],
	['find -delete', [[['find', '/dir', '-name', '*.bin', '-delete']], [['find', '/dir', '-type', 'f']]], r => lines(r) === '/dir/a.txt /dir/sub/new.txt'],
	['find missing dir', [[['find', '/nope']]], r => r.code === 1 && /nope/.test(r.err)],
	['find -exec (no spawn)', [[['find', '/f.txt', '-exec', 'echo', '{}', ';']]], r => /not supported/.test(r.err)]
];

await suite(cases);

await done();
