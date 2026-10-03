import {Directory, File, PreopenDirectory, WASI} from '@bjorn3/browser_wasi_shim';
import {HEADER, type Poll, Sink, Stdin, Tty, handleSpawn, makeTty, pollClock, runWasi} from './io';

const module = await WebAssembly.compileStreaming(fetch('/nu.wasm'));

Object.assign(globalThis, {
	runNu(script: string, cols = 80, args: string[] = []) {
		const bin = new Directory(new Map(['echo', 'cat', 'fail', 'printf'].map(n => [n, new File(new Uint8Array())])));
		const root = new PreopenDirectory('/', new Map([['sub', new Directory(new Map([['a.txt', new File(new TextEncoder().encode('x\n'))]]))], ['bin', bin]]));
		return runWasi(module, ['nu', ...args], ['PWD=/', 'PATH=/bin'], root, script, cols);
	},
	async runNuRepl(keys: (string | number)[]) {
		const tty = new Tty(keys);
		let modes = '';
		const dec = new TextDecoder();
		const out = new Sink(d => dec.decode(d).includes('\x1b[6n') && tty.push('\x1b[1;1R'));
		const err = new Sink();
		const root = new PreopenDirectory('/', new Map([['sub', new Directory(new Map([['apple.txt', new File(new Uint8Array())]]))]]));
		const shim = new WASI(['nu'], ['PWD=/', 'HOME=/'], [tty, out, err, root]);
		const mem = () => shim.inst.exports.memory;
		const instance = await WebAssembly.instantiate(module, {wasi_snapshot_preview1: shim.wasiImport, tty: makeTty(mem, () => tty.cols(), handleSpawn, () => 0, ms => tty.poll(ms), on => (modes += on))});
		try {
			shim.start(instance as {exports: {memory: WebAssembly.Memory; _start: () => unknown}});
		} catch (e) {
			err.fd_write(new TextEncoder().encode(String(e)));
		}
		return {out: out.text(), err: err.text(), modes};
	},
	async runNuJspi(script: string) {
		const out = new Sink();
		const err = new Sink();
		const shim = new WASI(['nu'], ['PWD=/'], [new Stdin(script), out, err, new PreopenDirectory('/', new Map())]);
		const mem = () => shim.inst.exports.memory;
		// biome-ignore lint/suspicious/noExplicitAny: JSPI is not in lib.dom yet
		const w = WebAssembly as any;
		const instance = await WebAssembly.instantiate(module, {
			wasi_snapshot_preview1: {...shim.wasiImport, poll_oneoff: new w.Suspending(async (...a: Poll) => (await new Promise(r => setTimeout(r, pollClock(mem(), ...a))), 0))},
			tty: makeTty(mem)
		});
		Object.assign(shim, {inst: instance});
		let ticks = 0;
		const timer = setInterval(() => ticks++, 10);
		const t0 = performance.now();
		try {
			await w.promising(instance.exports._start)();
		} catch (e) {
			if (!(e instanceof Error && e.message.startsWith('exit with exit code'))) throw e;
		}
		clearInterval(timer);
		return {out: out.text(), err: err.text(), elapsed: performance.now() - t0, ticks};
	},
	runNuWorker(script: string, spawnDelay: number, opts: {cols?: number; interruptAfter?: number} = {}) {
		return new Promise<{out: string; err: string; elapsed: number; ticks: number; isolated: boolean}>(resolve => {
			const sab = new SharedArrayBuffer(1024, {maxByteLength: 1 << 26});
			const flag = new Int32Array(new SharedArrayBuffer(4));
			if (opts.interruptAfter) setTimeout(() => Atomics.store(flag, 0, 1), opts.interruptAfter);
			const ctl = new Int32Array(sab, 0, 4);
			const worker = new Worker('/worker.js', {type: 'module'});
			let ticks = 0;
			const timer = setInterval(() => ticks++, 10);
			const t0 = performance.now();
			worker.onmessage = async e => {
				if (e.data.type === 'spawn') {
					const res = handleSpawn(new Uint8Array(sab, HEADER, ctl[1]).slice());
					await new Promise(r => setTimeout(r, spawnDelay));
					if (!res) Atomics.store(ctl, 0, 2);
					else {
						if (sab.byteLength < HEADER + res.length) (sab as SharedArrayBuffer & {grow(n: number): void}).grow(HEADER + res.length);
						new Uint8Array(sab, HEADER, res.length).set(res);
						ctl[1] = res.length;
						Atomics.store(ctl, 0, 1);
					}
					Atomics.notify(ctl, 0);
				} else if (e.data.type === 'done') {
					clearInterval(timer);
					worker.terminate();
					resolve({out: e.data.out, err: e.data.err, elapsed: performance.now() - t0, ticks, isolated: crossOriginIsolated});
				}
			};
			worker.postMessage({script, sab, flag, cols: opts.cols ?? 80});
		});
	}
});
