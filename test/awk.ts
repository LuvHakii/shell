import {start} from './harness';

const {suite, done} = await start(`
import {File, PreopenDirectory} from '@bjorn3/browser_wasi_shim';
import {runWasi} from './io';

let fs;
const module = await WebAssembly.compileStreaming(fetch('/awk.wasm'));

Object.assign(globalThis, {
	reset() {
		fs = new PreopenDirectory('/', new Map([['in.txt', new File(new TextEncoder().encode('a 1\\nb 2\\nc 3\\n'))]]));
	},
	async run(argv, stdin) {
		const r = await runWasi(module, argv, [], fs, stdin);
		const f = fs.dir.contents.get('out.txt');
		return {...r, file: f ? new TextDecoder().decode(f.data) : null};
	}
});
`);

type R = {code: number; out: string; err: string; file?: string | null};
const cases: [string, string[], string, RegExp | ((r: R) => boolean)][] = [
	['$2 stdin', ['awk', '{print $2}'], 'x y z\n1 2 3\n', /^y\n2\n$/],
	['-F', ['awk', '-F:', '{print $3}'], 'a:b:c\n', /^c\n$/],
	['BEGIN/END sum', ['awk', 'BEGIN{s=0}{s+=$1}END{print s}'], '1\n2\n3\n', /^6\n$/],
	['printf', ['awk', 'BEGIN{printf "%05.2f|%s|%x\\n", 3.14159, "hi", 255}'], '', /^03\.14\|hi\|ff\n$/],
	['assoc array', ['awk', '{c[$1]++}END{for(k in c) print k, c[k]}'], 'a\nb\na\n', r => r.code === 0 && r.out.split('\n').sort().join(',') === ',a 2,b 1'],
	['regex match', ['awk', '/^foo/'], 'foo\nbar\nfoobar\n', /^foo\nfoobar\n$/],
	['match()', ['awk', 'BEGIN{print match("xxabc",/ab/), RSTART, RLENGTH}'], '', /^3 3 2\n$/],
	['read file', ['awk', '{print $1}', '/in.txt'], '', /^a\nb\nc\n$/],
	['getline < file', ['awk', 'BEGIN{while((getline l < "/in.txt")>0) print "L:" l}'], '', /^L:a 1\nL:b 2\nL:c 3\n$/],
	['> redirect', ['awk', 'BEGIN{print "out" > "/out.txt"}'], '', r => r.code === 0 && r.file === 'out\n'],
	['exit code + END', ['awk', 'BEGIN{print "x"; exit 3; print "no"} END{print "end"}'], '', r => r.code === 3 && r.out === 'x\nend\n'],
	['exit in END', ['awk', '{exit 4} END{print "end"; exit}'], '1\n2\n', r => r.code === 4 && r.out === 'end\n'],
	['system() fails cleanly', ['awk', 'BEGIN{print system("ls")}'], '', r => r.code === 0 && r.out === '-1\n' && /not supported/.test(r.err)],
	['cmd | getline fails cleanly', ['awk', 'BEGIN{print ("ls" | getline x)}'], '', r => r.code === 0 && r.out === '-1\n'],
	['print | cmd fails cleanly', ['awk', 'BEGIN{print "x" | "cat"}'], '', r => r.code === 2 && /can't open/.test(r.err)],
	['missing file', ['awk', '1', '/nope'], '', r => r.code === 2 && /can't open/.test(r.err)]
];

await suite(cases.map(([name, argv, stdin, expect]) => [name, [[argv, stdin]], expect]));

await done();
