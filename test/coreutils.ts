import {type R, fmt, start} from './harness';

const {call, check, suite, done} = await start(`
import {Directory, File, PreopenDirectory} from '@bjorn3/browser_wasi_shim';
import {runWasi} from './io';

const enc = new TextEncoder();
const seeds = {
	core: () => [
		['hello.txt', new File(enc.encode('hello\\nworld\\n'))],
		['nums.txt', new File(enc.encode('3\\n1\\n2\\n1\\n'))],
		['csv.txt', new File(enc.encode('a,b,c\\n1,2,3\\n'))],
		['sub', new Directory(new Map([['a.txt', new File(enc.encode('x\\n'))]]))]
	],
	id: () => [
		['a.txt', new File(enc.encode('hello\\n'))],
		['sub', new Directory(new Map([['b.txt', new File(enc.encode('x'.repeat(5000)))]]))]
	],
	cwd: () => [['sub', new Directory(new Map([['a.txt', new File(enc.encode('hello\\n'))]]))]]
};
let fs;
const module = await WebAssembly.compileStreaming(fetch('/coreutils.wasm'));

Object.assign(globalThis, {
	reset(seed = 'core') {
		fs = new PreopenDirectory('/', new Map(seeds[seed]()));
	},
	run: (argv, stdin = '', env = ['PWD=/', 'FOO=bar']) => runWasi(module, argv, env, fs, stdin)
});
`);

const cases: [string, [string[], string?][], RegExp | ((r: R) => boolean)][] = [
	['echo', [[['echo', 'hi', 'there']]], /^hi there\n$/],
	['cat file', [[['cat', '/hello.txt']]], /^hello\nworld\n$/],
	['cat stdin', [[['cat'], 'from stdin\n']], /^from stdin\n$/],
	['wc -l', [[['wc', '-l', '/hello.txt']]], /^2 \/hello\.txt\n$/],
	['wc -l stdin', [[['wc', '-l'], 'a\nb\nc\n']], /^3\n$/],
	['sort', [[['sort', '/nums.txt']]], /^1\n1\n2\n3\n$/],
	['sort -u -n stdin', [[['sort', '-u', '-n'], '3\n1\n2\n1\n']], /^1\n2\n3\n$/],
	['head -n2', [[['head', '-n2', '/nums.txt']]], /^3\n1\n$/],
	['tail', [[['tail', '-n2', '/nums.txt']]], /^2\n1\n$/],
	['tr a-z A-Z', [[['tr', 'a-z', 'A-Z'], 'hello\n']], /^HELLO\n$/],
	['seq 1 5', [[['seq', '1', '5']]], /^1\n2\n3\n4\n5\n$/],
	['sha256sum', [[['sha256sum'], 'abc']], /^ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad {2}-\n$/],
	['ls /', [[['ls', '/']]], /hello\.txt[\s\S]*sub/],
	['ls -l', [[['ls', '-l', '/']]], /hello\.txt/],
	['ls -la /sub', [[['ls', '-la', '/sub']]], /a\.txt/],
	['date +%Y', [[['date', '+%Y']]], /^20\d\d\n$/],
	['date', [[['date']]], /\d{4}/],
	['date -u -d @0', [[['date', '-u', '-d', '@0']]], /1970/],
	['uname', [[['uname']]], r => r.code === 0 && r.out.length > 1],
	['uname -a', [[['uname', '-a']]], r => r.code === 0 && r.out.length > 1],
	['printenv FOO', [[['printenv', 'FOO']]], /^bar\n$/],
	['printenv', [[['printenv']]], /FOO=bar/],
	['mkdir', [[['mkdir', '/d']], [['ls', '-1', '/']]], /^d$/m],
	['mkdir -p', [[['mkdir', '-p', '/x/y/z']], [['ls', '/x/y']]], /^z$/m],
	['touch', [[['touch', '/t.txt']], [['ls', '-1', '/']]], /^t\.txt$/m],
	['rm', [[['rm', '/hello.txt']], [['ls', '/']]], r => !/hello/.test(r.out)],
	['rm -r', [[['rm', '-r', '/sub']], [['ls', '/']]], r => !/sub/.test(r.out)],
	['rmdir', [[['mkdir', '/e']], [['rmdir', '/e']], [['ls', '/']]], r => !/^e$/m.test(r.out)],
	['mv', [[['mv', '/hello.txt', '/moved.txt']], [['cat', '/moved.txt']]], /^hello\nworld\n$/],
	['cp', [[['cp', '/hello.txt', '/copy.txt']], [['cat', '/copy.txt']]], /^hello\nworld\n$/],
	['cp -r', [[['cp', '-r', '/sub', '/sub2']], [['cat', '/sub2/a.txt']]], /^x\n$/],
	['ln hard', [[['ln', '/hello.txt', '/hl']], [['cat', '/hl']]], /^hello/],
	['ln -s + readlink', [[['ln', '-s', '/hello.txt', '/lnk']], [['readlink', '/lnk']]], /^\/hello\.txt\n$/],
	['tee', [[['tee', '/tee.txt'], 'teed\n'], [['cat', '/tee.txt']]], /^teed\n$/],
	['basename', [[['basename', '/a/b/c.txt', '.txt']]], /^c\n$/],
	['dirname', [[['dirname', '/a/b/c.txt']]], /^\/a\/b\n$/],
	['od', [[['od', '-c'], 'abc']], /a\s+b\s+c/],
	['base64', [[['base64'], 'hello']], /^aGVsbG8=\n$/],
	['base64 -d', [[['base64', '-d'], 'aGVsbG8=\n']], /^hello$/],
	['nl', [[['nl', '/hello.txt']]], /1\s+hello\n\s+2\s+world/],
	['uniq', [[['uniq'], 'a\na\nb\nb\nc\n']], /^a\nb\nc\n$/],
	['uniq -c', [[['uniq', '-c'], 'a\na\nb\n']], /2 a\n\s+1 b/],
	['cut', [[['cut', '-d,', '-f2', '/csv.txt']]], /^b\n2\n$/],
	['md5sum', [[['md5sum'], 'abc']], /^900150983cd24fb0d6963f7d28e17f72/],
	['sleep 0.1', [[['sleep', '0.1']]], r => r.code === 0],
	['expr', [[['expr', '2', '+', '3']]], /^5\n$/],
	['printf', [[['printf', '%05d\\n', '42']]], /^00042\n$/],
	['printf', [[['printf', '\x1b[H\x1b[2J\x1b[3J']]], /^\x1b\[H\x1b\[2J\x1b\[3J$/],
	['realpath', [[['realpath', '/sub/../hello.txt']]], /^\/hello\.txt\n$/],
	['pwd', [[['pwd']]], /^\//],
	['nproc', [[['nproc']]], /^\d+\n$/],
	['wc stdin large (200KB)', [[['wc', '-c'], 'x'.repeat(200000)]], /^200000\n$/],
	['shuf -n', [[['shuf', '-n1', '/nums.txt']]], /^\d\n$/],
	['stat-like: ls -l size', [[['ls', '-l', '/csv.txt']]], /\b12\b.*csv\.txt/],
	['fold', [[['fold', '-w2'], 'abcd\n']], /^ab\ncd\n$/],
	['paste', [[['paste', '/hello.txt', '/csv.txt']]], /hello\ta,b,c/],
	['join', [[['join', '/hello.txt', '/hello.txt']]], r => r.code === 0],
	['split', [[['split', '-l1', '/hello.txt', '/sp_']], [['ls', '/']]], /sp_aa/],
	['truncate', [[['truncate', '-s', '3', '/hello.txt']], [['wc', '-c', '/hello.txt']]], /^3 /],
	['mktemp', [[['mktemp', '-p', '/']]], /^\/tmp|^\//],
	['dd', [[['dd', 'if=/hello.txt', 'of=/dd.txt']]], r => /records in/.test(r.err)],
	['dd file', [[['dd', 'status=none', 'if=/hello.txt', 'of=/dd.txt']], [['wc', '-c', '/dd.txt']]], /^12 /],
	['dd stdin', [[['dd', 'status=none'], 'hi']], /^hi$/],
	['tty', [[['tty']]], r => r.code === 0 || r.code === 1],
	['test -f', [[['test', '-f', '/hello.txt']]], r => r.code === 0],
	['true', [[['true']]], r => r.code === 0],
	['false', [[['false']]], r => r.code === 1],
	['nonexistent file exit code', [[['cat', '/nope']]], r => r.code === 1 && /No such file/.test(r.err)],
	['dispatch: coreutils echo', [[['coreutils', 'echo', 'x']]], /^x\n$/],
	['dispatch: coreutils.wasm echo', [[['coreutils.wasm', 'echo', 'x']]], /^x\n$/],
	['dispatch: /bin/echo', [[['/bin/echo', 'x']]], /^x\n$/],
	['dispatch: unknown util', [[['coreutils', 'nope']]], r => r.code !== 0],
	['--list', [[['coreutils', '--list']]], /^echo$/m],
	['comm', [[['comm', '/hello.txt', '/hello.txt']]], /hello/],
	['tsort', [[['tsort'], 'a b\nb c\n']], /^a\nb\nc\n$/],
	['factor', [[['factor', '60']]], /^60: 2 2 3 5\n$/],
	['numfmt', [[['numfmt', '--to=si', '1500']]], /^1\.5k\n$/],
	['expand', [[['expand'], 'a\tb\n']], /^a {7}b\n$/],
	['cksum', [[['cksum'], 'abc']], /^\d+ 3/],
	['b2sum', [[['b2sum'], 'abc']], /^ba80a53f/],
	['sha1sum', [[['sha1sum'], 'abc']], /^a9993e36/],
	['sha512sum', [[['sha512sum'], 'abc']], /^ddaf35a1/],
	['shred', [[['shred', '-u', '/hello.txt']], [['ls', '-1', '/']]], r => !/hello/.test(r.out)],
	['csplit', [[['csplit', '-f', '/cs_', '/hello.txt', '2']], [['ls', '-1', '/']]], /cs_01/],
	['pr', [[['pr', '-t', '/hello.txt']]], /hello/],
	['ptx', [[['ptx'], 'hello world\n']], r => r.code === 0],
	['link', [[['link', '/hello.txt', '/l2']], [['cat', '/l2']]], /^hello/],
	['unlink', [[['unlink', '/hello.txt']], [['ls', '-1', '/']]], r => !/hello/.test(r.out)],
	['dircolors', [[['dircolors', '-b']]], /LS_COLORS/],
	['hostid', [[['hostid']]], /^[0-9a-f]+\n$/],
	['sort -R', [[['sort', '-R', '/nums.txt']]], r => r.out.length === 8],
	['split -b', [[['split', '-b', '5', '/hello.txt', '/b_']], [['ls', '-1', '/']]], /b_ab/],
	['uname -s', [[['uname', '-s']]], /\S/],
	['--version', [[['coreutils', '--version']]], /multi-call/]
];

await suite(cases, new Set(['ln -s + readlink', 'dd', 'dd file', 'dd stdin']));

await call('reset', 'id');
const ENV = ['USER=root', 'LOGNAME=root', 'HOSTNAME=box', 'HOME=/root'];
const run = (argv: string[], env = ENV): Promise<R> => call('run', argv, '', env);
const cu = (...a: string[]) => run(['coreutils', ...a]);
const eq = async (label: string, argv: string[], want: string, env = ENV) => {
	const r = await run(argv, env);
	check(r.code === 0 && r.out === want, label, `${fmt(r)} want=${JSON.stringify(want)}`);
};
const match = async (label: string, a: string[], re: RegExp) => {
	const r = await cu(...a);
	check(r.code === 0 && re.test(r.out), label, fmt(r));
};

await eq('dispatch via argv0: whoami', ['whoami'], 'root\n');
await eq('dispatch via argv0 path: /bin/whoami', ['/bin/whoami'], 'root\n');
await eq('dispatch via argv0 suffix: uu-whoami', ['uu-whoami'], 'root\n');
await eq('coreutils whoami', ['coreutils', 'whoami'], 'root\n');
await eq('coreutils.wasm whoami', ['coreutils.wasm', 'whoami'], 'root\n');
await eq('whoami honors USER', ['coreutils', 'whoami'], 'bob\n', ['USER=bob']);
await eq('whoami fallback without env', ['coreutils', 'whoami'], 'root\n', []);
await eq('logname', ['coreutils', 'logname'], 'root\n');
await eq('logname fallback', ['coreutils', 'logname'], 'root\n', []);
await eq('id', ['coreutils', 'id'], 'uid=0(root) gid=0(root) groups=0(root)\n');
await eq('id -u', ['coreutils', 'id', '-u'], '0\n');
await eq('id -g', ['coreutils', 'id', '-g'], '0\n');
await eq('id -G', ['coreutils', 'id', '-G'], '0\n');
await eq('id -un', ['coreutils', 'id', '-un'], 'root\n');
await eq('id -gn', ['coreutils', 'id', '-gn'], 'root\n');
await eq('id -Gn', ['coreutils', 'id', '-Gn'], 'root\n');
await eq('id root', ['coreutils', 'id', 'root'], 'uid=0(root) gid=0(root) groups=0(root)\n');
check((await cu('id', 'nobody')).code !== 0, 'id nobody fails');
await eq('groups', ['coreutils', 'groups'], 'root\n');
await eq('hostname', ['coreutils', 'hostname'], 'box\n');
await eq('hostname honors HOSTNAME', ['coreutils', 'hostname'], 'box\n', ['HOSTNAME=box']);
await eq('hostname fallback', ['coreutils', 'hostname'], 'localhost\n', []);
await eq('uname -n', ['coreutils', 'uname', '-n'], 'box\n');
await eq('uname -s', ['coreutils', 'uname', '-s'], 'Linux\n');
await match('uname -a', ['uname', '-a'], /^Linux box \S+ \S+ wasm32 /);
await eq('stat -c %n %s %F', ['coreutils', 'stat', '-c', '%n %s %F', '/a.txt'], '/a.txt 6 regular file\n');
await eq('stat -c %U %G %a %A (file)', ['coreutils', 'stat', '-c', '%U %G %a %A %u %g', '/a.txt'], 'root root 644 -rw-r--r-- 0 0\n');
await eq('stat -c %F %a (dir)', ['coreutils', 'stat', '-c', '%F %a %A', '/sub'], 'directory 755 drwxr-xr-x\n');
await match('stat default', ['stat', '/a.txt'], /File: \/a\.txt\n\s+Size: 6\s.*regular file\n.*Uid: \(\s*0\/\s*root\).*Gid: \(\s*0\/\s*root\)/s);
await match('stat -c %i %h %x', ['stat', '-c', '%i %h %y', '/a.txt'], /^\d+ \d+ \d{4}-\d\d-\d\d /);
check((await cu('stat', '/nope')).code !== 0, 'stat missing file fails');
await match('ls -l owner column', ['ls', '-l', '/'], /^\S+\s+\d+\s+root\s+root\s+6\s.*a\.txt$/m);
await match('ls -ln owner column', ['ls', '-ln', '/'], /\s0\s+0\s+6\s.*a\.txt$/m);
await match('du -s /sub', ['du', '-s', '/sub'], /^\d+\s+\/sub$/m);
await match('du -ab /sub', ['du', '-ab', '/sub'], /^5000\s+\/sub\/b\.txt\n5000\s+\/sub\n$/);

const e = await cu('env');
const envLines = e.out.split('\n').filter(Boolean).sort();
check(e.code === 0 && ENV.every(v => envLines.includes(v)) && envLines.length === ENV.length, 'env | sort', JSON.stringify(envLines));
await eq('env -i FOO=1', ['coreutils', 'env', '-i', 'FOO=1'], 'FOO=1\n');
await eq('env -i', ['coreutils', 'env', '-i'], '');
await eq('env -u USER FOO=1', ['coreutils', 'env', '-u', 'USER', '-u', 'LOGNAME', '-u', 'HOSTNAME', '-u', 'HOME', 'FOO=1'], 'FOO=1\n');
await eq('env -0', ['coreutils', 'env', '-0', '-i', 'A=1', 'B=2'], 'A=1\0B=2\0');
const ex = await cu('env', 'echo', 'hi');
check(ex.code !== 0 && ex.out === '' && ex.err.length > 0, 'env CMD is an error (no exec)', fmt(ex));

const list = (await cu('--list')).out.split('\n');
for (const name of ['whoami', 'id', 'groups', 'hostname', 'logname', 'uname', 'stat', 'env', 'du', 'ls', 'cat'])
	check(list.includes(name), `--list has ${name}`);
for (const name of ['uptime', 'users', 'who', 'df', 'timeout', 'stty', 'install', 'kill', 'pinky', 'chown', 'chgrp', 'chmod']) {
	const r = await cu(name);
	check(!list.includes(name) && r.code !== 0 && /unknown program/.test(r.err), `${name} is absent`, fmt(r));
}

await call('reset', 'cwd');
const cwd: [string[], string[], RegExp][] = [
	[['cat', 'a.txt'], ['PWD=/sub'], /^hello$/m],
	[['pwd'], ['PWD=/sub'], /^\/sub$/m],
	[['ls'], ['PWD=/sub'], /a\.txt/],
	[['cat', 'a.txt'], [], /No such file/],
	[['cat', '/sub/a.txt'], ['PWD=/sub'], /^hello$/m]
];
for (const [argv, env, expect] of cwd) {
	const r = await run(argv, env);
	check(expect.test(r.out + r.err), `${env.join(' ')} ${argv.join(' ')}`, `\n${r.out}${r.err}`);
}

await done();
