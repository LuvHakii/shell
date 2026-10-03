import {chromium} from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const isolation = {'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp'};

export type R = {code: number; out: string; err: string};
type Expect = RegExp | ((r: R) => boolean);

const bundle = async (src: string) => {
	const entry = `${root}test/_page.ts`;
	const built = await Bun.build({entrypoints: [entry], files: {[entry]: src}, target: 'browser', format: 'esm'});
	if (!built.success) throw new Error(built.logs.join('\n'));
	return built.outputs[0]!.text();
};

const show = (s: string) => JSON.stringify(s.length > 300 ? `${s.slice(0, 300)}...` : s);
export const fmt = (r: R) => `  code=${r.code} out=${show(r.out)} err=${show(r.err)}`;

export async function start(page: string, worker = '') {
	const js: Record<string, string> = {'/page.js': await bundle(`${page}\ndocument.title = 'ready';`), '/worker.js': worker && (await bundle(worker))};
	const server = Bun.serve({
		port: 0,
		fetch(req) {
			const path = new URL(req.url).pathname;
			if (path === '/') return new Response('<!doctype html><script type="module" src="/page.js"></script>', {headers: {'content-type': 'text/html', ...isolation}});
			if (path in js) return new Response(js[path], {headers: {'content-type': 'text/javascript', ...isolation}});
			if (path.endsWith('.wasm')) return new Response(Bun.file(`${root}dist${path}`), {headers: {'content-type': 'application/wasm', ...isolation}});
			return new Response('not found', {status: 404});
		}
	});
	const browser = await chromium.launch();
	const tab = await browser.newPage();
	tab.on('pageerror', e => console.error('pageerror', e.message));
	await tab.goto(`http://localhost:${server.port}/`);
	await tab.waitForFunction(() => document.title === 'ready', null, {timeout: 60000});

	let failed = 0;
	const call = (f: string, ...a: unknown[]): Promise<any> => tab.evaluate(([f, a]) => (globalThis as any)[f](...a), [f, a] as const);
	const check = (ok: boolean, label: string, detail = '', xfail = false) => {
		if (!ok && !xfail) failed++;
		console.log(`${ok ? 'PASS' : xfail ? 'XFAIL' : 'FAIL'}  ${label}${ok ? '' : detail}`);
	};
	return {
		tab,
		call,
		check,
		async suite(cases: [string, [string[], string?][], Expect][], known = new Set<string>()) {
			for (const [name, steps, expect] of cases) {
				await call('reset');
				let r!: R;
				for (const [argv, stdin = ''] of steps) r = await call('run', argv, stdin);
				check(typeof expect === 'function' ? expect(r) : r.code === 0 && expect.test(r.out), name, fmt(r), known.has(name));
			}
		},
		async done() {
			await browser.close();
			server.stop();
			process.exit(failed ? 1 : 0);
		}
	};
}
