import {start} from './harness';

const {suite, done} = await start(`
import {Directory, File, PreopenDirectory} from '@bjorn3/browser_wasi_shim';
import {runWasi} from './io';

const enc = new TextEncoder();
const fs = new PreopenDirectory('/', new Map([
	['a.txt', new File(enc.encode('hello\\nworld\\nHello again\\n'))],
	['d', new Directory(new Map([
		['b.txt', new File(enc.encode('foo\\nbar hello\\n'))],
		['sub', new Directory(new Map([['c.txt', new File(enc.encode('nothing\\n'))]]))]
	]))]
]));
const module = await WebAssembly.compileStreaming(fetch('/grep.wasm'));

Object.assign(globalThis, {
	reset() {},
	run: (argv, stdin) => runWasi(module, argv, ['PWD=/'], fs, stdin)
});
`);

const cases: [string, string[], string, number, RegExp][] = [
	['stdin', ['grep', 'a'], 'a\nb\nab\n', 0, /^a\nab\n$/],
	['-i', ['grep', '-i', 'hello', '/a.txt'], '', 0, /^hello\nHello again\n$/],
	['-v', ['grep', '-v', 'hello', '/a.txt'], '', 0, /^world\nHello again\n$/],
	['-n', ['grep', '-n', 'world', '/a.txt'], '', 0, /^2:world\n$/],
	['-c', ['grep', '-c', 'o', '/a.txt'], '', 0, /^3\n$/],
	['-E alternation', ['grep', '-E', 'foo|world', '/a.txt', '/d/b.txt'], '', 0, /^\/a\.txt:world\n\/d\/b\.txt:foo\n$/],
	['BRE \\|', ['grep', 'foo\\|world', '/a.txt'], '', 0, /^world\n$/],
	['-F', ['grep', '-F', 'a.', '/d/b.txt'], '', 1, /^$/],
	['-w -o', ['grep', '-wo', 'hello', '/a.txt'], '', 0, /^hello\n$/],
	['-e -e', ['grep', '-e', 'foo', '-e', 'nothing', '-r', '/d'], '', 0, /\/d\/b\.txt:foo\n/],
	['-C1', ['grep', '-C1', 'world', '/a.txt'], '', 0, /^hello\nworld\nHello again\n$/],
	['-r', ['grep', '-r', 'hello', '/d'], '', 0, /^\/d\/b\.txt:bar hello\n$/],
	['-r cwd', ['grep', '-r', 'nothing'], '', 0, /^d\/sub\/c\.txt:nothing\n$/],
	['-rl', ['grep', '-rl', 'hello', '/'], '', 0, /^\/a\.txt\n\/d\/b\.txt\n$/],
	['--color=always', ['grep', '--color=always', 'world', '/a.txt'], '', 0, /\x1b\[01;31m\x1b\[Kworld/],
	['no match',['grep', 'zzz', '/a.txt'], '', 1, /^$/],
	['missing file', ['grep', 'x', '/nope'], '', 2, /^$/],
	['bad regex', ['grep', '-E', 'a(', '/a.txt'], '', 2, /^$/]
];

await suite(cases.map(([name, argv, stdin, code, out]) => [name, [[argv, stdin]], r => r.code === code && out.test(r.out)]));

await done();
