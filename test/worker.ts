import {PreopenDirectory, WASI} from '@bjorn3/browser_wasi_shim';
import {HEADER, type Poll, Sink, Stdin, makeTty, pollClock} from './io';

self.onmessage = async (e: MessageEvent<{script: string; sab: SharedArrayBuffer; flag: Int32Array; cols: number}>) => {
	const {script, sab, flag, cols} = e.data;
	const ctl = new Int32Array(sab, 0, 4);
	const out = new Sink();
	const err = new Sink();
	const shim = new WASI(['nu'], ['PWD=/'], [new Stdin(script), out, err, new PreopenDirectory('/', new Map())]);
	const mem = () => shim.inst.exports.memory;
	const sleeper = new Int32Array(new SharedArrayBuffer(4));

	const spawn = (req: Uint8Array) => {
		if (sab.byteLength < HEADER + req.length) (sab as SharedArrayBuffer & {grow(n: number): void}).grow(HEADER + req.length);
		new Uint8Array(sab, HEADER, req.length).set(req);
		ctl[1] = req.length;
		Atomics.store(ctl, 0, 0);
		self.postMessage({type: 'spawn'});
		while (Atomics.load(ctl, 0) === 0) Atomics.wait(ctl, 0, 0);
		return Atomics.load(ctl, 0) === 2 ? null : new Uint8Array(sab, HEADER, ctl[1]).slice();
	};

	const instance = await WebAssembly.instantiate(await WebAssembly.compileStreaming(fetch('/nu.wasm')), {
		wasi_snapshot_preview1: {...shim.wasiImport, poll_oneoff: (...a: Poll) => (Atomics.wait(sleeper, 0, 0, pollClock(mem(), ...a)), 0)},
		tty: makeTty(mem, cols, spawn, () => Atomics.load(flag, 0))
	});
	shim.start(instance as {exports: {memory: WebAssembly.Memory; _start: () => unknown}});
	self.postMessage({type: 'done', out: out.text(), err: err.text()});
};
