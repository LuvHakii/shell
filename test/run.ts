import {start} from './harness';

const {tab, call, check, done} = await start("import './page';", "import './worker';");

const prompt = /root@localhost:[^\n#]*# /g;
const strip = (s: string) => s.replace(prompt, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '');

const cases: [string, RegExp][] = [
	['ls /', /sub.*dir/s],
	['ls /sub | get name | first', /\/sub\/a\.txt/],
	['cd /sub; ls | get name | first', /a\.txt/],
	['"hello" | save /b.txt; open /b.txt', /hello/],
	['"x" | save /sub/c.txt; rm /sub/c.txt; ls /sub | length', /^1$/m],
	['glob /**/*.txt | length', /^1$/m],
	['sleep 50ms; "slept"', /slept/],
	['[1 2 3] | each {|x| $x * 2} | math sum', /^12$/m],
	['du /sub | get 0.physical', /\d+ B/],
	['^echo hi there', /hi there/],
	['"abc" | ^cat', /abc/],
	['^echo a | ^cat | str trim | str upcase', /^A$/m],
	['^fail; $env.LAST_EXIT_CODE', /^3$/m],
	['try { ^nope } catch {|e| $e.msg }', /External command failed/],
	['cd /sub; ^echo *.txt', /a\.txt/],
	['^echo hi | complete | $"($in.stdout | str trim)|($in.stderr)|($in.exit_code)"', /^hi\|\|0$/m],
	['do { ^fail } | complete | $"($in.stdout)|($in.stderr | str trim)|($in.exit_code)"', /^\|boom\|3$/m],
	['which ls cat nope | select command type path | to nuon', /^\[\[command, type, path\]; \[ls, built-in, ""\], \[cat, external, \/bin\/cat\]\]$/m],
	['which | where type == external | get command | sort | str join " "', /^cat fail printf$/m],
	['let n = (input "name: ")\nbob\n$"hi ($n)"', /name: [\s\S]*hi bob/]];

for (const [script, expect] of cases) {
	const r = await call('runNu', script);
	check(expect.test(strip(r.out)), script, `\n${strip(r.out)}${r.err}`);
}

if (await tab.evaluate(() => 'Suspending' in WebAssembly)) {
	const j = await call('runNuJspi', 'sleep 300ms; "slept"');
	check(/slept/.test(strip(j.out)) && j.elapsed >= 290 && j.ticks >= 15, 'jspi sleep 300ms', `  elapsed=${Math.round(j.elapsed)}ms ticks=${j.ticks}`);
}

const w = await call('runNuWorker', 'sleep 300ms; ^echo a | ^cat; "abc" | ^cat', 150);
check(
	w.isolated && /abc/.test(strip(w.out)) && w.elapsed >= 700 && w.ticks >= 40,
	"atomics.wait worker: sleep 300ms + 3 blocked spawns (150ms each)",
	`  elapsed=${Math.round(w.elapsed)}ms ticks=${w.ticks} isolated=${w.isolated}\n${strip(w.out)}${w.err}`
);

const big = await call('runNuWorker', '"x" | fill -c x -w 200000 | ^cat | str length', 10);
check(/^200000$/m.test(strip(big.out)), 'atomics.wait worker: 200KB stdin round trip through growable SAB', `  ${strip(big.out).trim()} ${big.err}`);

const wide = '1..30 | each {|i| {a: $i, bbbbbbbbbb: "cccccccccccccccccccc", dddddddddd: "eeeeeeeeeeeeeeeeeeee"}} | table';
const widest = (s: string) => Math.max(...strip(s).split('\n').map(l => [...l].length));

const multi = await call('runNu', '"one"; "two"\n"three"; cd /sub\n^nope; "after"');
check(/one[\s\S]*two[\s\S]*three/.test(strip(multi.out)), 'multi-statement prints every statement', `\n${strip(multi.out)}`);
check(/root@localhost:\/# /.test(multi.out) && /root@localhost:\/sub# /.test(multi.out), 'prompt shows user@host:pwd and follows cd');
check(/External command failed|not found/.test(strip(multi.err)) && !/after/.test(multi.out), 'error goes to stderr and stops the line', strip(multi.err));

const bye = await call('runNu', '"a"\nexit\n"b"');
check(/a/.test(strip(bye.out)) && !/b/.test(strip(bye.out)), 'exit stops the repl', strip(bye.out) + bye.err);

const colour = await call('runNu', 'ls /');
check(/\x1b\[/.test(colour.out), 'ansi colour on by default');

const cls = await call('runNu', 'clear');
check(cls.out.includes('\x1b[H\x1b[2J\x1b[3J') && !cls.err, 'clear emits home + erase screen + scrollback', cls.err);

const execute = ['-e', '# Greet someone\ndef hi [name: string] { {greeting: $name} }\n"Welcome banner"'];
const init = await call('runNu', 'hi bob | get greeting\nhelp hi | lines | first', 80, execute);
const initOut = strip(init.out);
check(
	init.out.indexOf('Welcome banner') < init.out.search(prompt) && /^bob$/m.test(initOut) && /^Greet someone$/m.test(initOut),
	'nu -e runs before the first prompt: banner, def with description',
	`\n${initOut}${init.err}`
);

const narrow = await call('runNu', wide, 40);
const broad = await call('runNu', wide, 200);
check(widest(narrow.out) <= 40 && widest(broad.out) > 40, 'table width follows winsize', `  40cols->${widest(narrow.out)} 200cols->${widest(broad.out)}`);

const intr = await call('runNuWorker', '1..100000000 | each {|x| $x} | length', 0, {interruptAfter: 500});
check(/interrupt/i.test(strip(intr.err + intr.out)) && intr.elapsed < 8000, 'interrupted import aborts a long loop', `  elapsed=${Math.round(intr.elapsed)}ms ${strip(intr.err + intr.out).trim()}`);

const hellos = (s: string) => strip(s).split('hello').length - 1;
const clean = (r: {err: string}) => !/Error|panicked/.test(r.err);
const tabbed = await call('runNuRepl', ['ls /sub/ap', '\t', '\r', 'exit\r']);
check(/apple\.txt[\s\S]*file/.test(strip(tabbed.out)) && clean(tabbed), 'repl: tab completes a path', `\n${strip(tabbed.out)}${strip(tabbed.err)}`);
const recalled = await call('runNuRepl', ['"he" + "llo"\r', '\x1b[A', '\r', 'exit\r']);
check(hellos(recalled.out) === 2 && clean(recalled), 'repl: up arrow recalls history', `\n${strip(recalled.out)}${strip(recalled.err)}`);
const hinted = await call('runNuRepl', ['"he" + "llo"\r', '"he', '\x1b[C', '\r', 'exit\r']);
check(hellos(hinted.out) === 2 && clean(hinted), 'repl: right arrow accepts the history hint', `\n${strip(hinted.out)}${strip(hinted.err)}`);

check(/^1(01)+0$/.test(recalled.modes), 'repl: raw mode on while editing, off while a command runs', `  modes=${recalled.modes}`);

const cancelled = await call('runNuRepl', ['"dro" + "pped"', '\x03', '"ke" + "pt"\r', 'exit\r']);
check(/kept/.test(strip(cancelled.out)) && !/dropped/.test(strip(cancelled.out)) && clean(cancelled), 'repl: ctrl+c (0x03) discards the line', `\n${strip(cancelled.out)}${strip(cancelled.err)}`);

const long = `"${'x'.repeat(30)}"`;
const repaints = (r: {err: string}) => r.err.split(`\x1b]133;B\x1b\\\x1b[0m\x1b[0m\x1b[32m${long}`).length - 1;
const plain = await call('runNuRepl', [long, '\r', 'exit\r']);
const resized = await call('runNuRepl', [long, 20, '\r', 'exit\r']);
check(repaints(resized) === repaints(plain) + 1 && clean(resized), 'repl: resize repaints the line', `  plain=${repaints(plain)} resized=${repaints(resized)}\n${strip(resized.err)}`);

await done();
