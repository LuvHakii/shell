import {Fd, WASI, wasi} from '@bjorn3/browser_wasi_shim';

const enc = new TextEncoder();
const dec = new TextDecoder();
export const HEADER = 16;
export type Poll = [number, number, number, number];

export class Stdin extends Fd {
	#data: Uint8Array;
	#pos = 0;

	constructor(text: string) {
		super();
		this.#data = enc.encode(text);
	}

	override fd_read(size: number) {
		const data = this.#data.slice(this.#pos, this.#pos + size);
		this.#pos += data.length;
		return {ret: 0, data};
	}

	override fd_fdstat_get() {
		return {ret: 0, fdstat: new wasi.Fdstat(wasi.FILETYPE_REGULAR_FILE, 0)};
	}
}

export class Tty extends Fd {
	#buf: number[] = [];

	constructor(private keys: string[]) {
		super();
	}

	push(s: string) {
		this.#buf.push(...enc.encode(s));
	}

	poll(ms: number) {
		if (!this.#buf.length && ms < 0) {
			const next = this.keys.shift();
			if (next === undefined) throw new Error('repl waited for input after the last key');
			this.push(next);
		}
		return this.#buf.length ? 1 : 0;
	}

	override fd_read(size: number) {
		return {ret: 0, data: new Uint8Array(this.#buf.splice(0, size))};
	}

	override fd_fdstat_get() {
		return {ret: 0, fdstat: new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0)};
	}
}

export class Sink extends Fd {
	chunks: Uint8Array[] = [];

	constructor(private onWrite?: (data: Uint8Array) => void) {
		super();
	}

	override fd_write(data: Uint8Array) {
		this.chunks.push(data.slice());
		this.onWrite?.(data);
		return {ret: 0, nwritten: data.byteLength};
	}

	override fd_fdstat_get() {
		return {ret: 0, fdstat: new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0)};
	}

	text() {
		const all = new Uint8Array(this.chunks.reduce((n, c) => n + c.length, 0));
		let o = 0;
		for (const c of this.chunks) {
			all.set(c, o);
			o += c.length;
		}
		return dec.decode(all);
	}
}

export function handleSpawn(b: Uint8Array): Uint8Array | null {
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let p = 0;
	const u32 = () => ((p += 4), v.getUint32(p - 4, true));
	const bytes = () => {
		const n = u32();
		p += n;
		return b.slice(p - n, p);
	};
	bytes();
	const argv = Array.from({length: u32()}, () => dec.decode(bytes()));
	for (let i = u32() * 2; i > 0; i--) bytes();
	const stdin = bytes();
	let code = 0;
	let out = new Uint8Array();
	let err = new Uint8Array();
	if (argv[0] === 'echo') out = enc.encode(`${argv.slice(1).join(' ')}\n`);
	else if (argv[0] === 'cat') out = stdin;
	else if (argv[0] === 'printf') out = enc.encode(argv[1]);
	else if (argv[0] === 'fail') {
		code = 3;
		err = enc.encode('boom\n');
	} else return null;
	const res = new Uint8Array(12 + out.length + err.length);
	const rv = new DataView(res.buffer);
	rv.setInt32(0, code, true);
	rv.setUint32(4, out.length, true);
	rv.setUint32(8, err.length, true);
	res.set(out, 12);
	res.set(err, 12 + out.length);
	return res;
}

export function makeTty(mem: () => WebAssembly.Memory, cols = 80, spawn = handleSpawn, interrupted = () => 0, poll = (_ms: number) => 0, raw = (_on: number) => {}) {
	let staged: Uint8Array = new Uint8Array();
	return {
		spawn(ptr: number, len: number) {
			const res = spawn(new Uint8Array(mem().buffer, ptr, len).slice());
			if (!res) return -1;
			staged = res;
			return res.length;
		},
		spawn_read(ptr: number) {
			new Uint8Array(mem().buffer, ptr, staged.length).set(staged);
		},
		winsize(ptr: number) {
			const v = new DataView(mem().buffer);
			v.setUint16(ptr, 24, true);
			v.setUint16(ptr + 2, cols, true);
		},
		interrupted,
		poll,
		raw
	};
}

export function pollClock(m: WebAssembly.Memory, inPtr: number, outPtr: number, _n: number, neventsPtr: number) {
	const v = new DataView(m.buffer);
	const userdata = v.getBigUint64(inPtr, true);
	const ms = Number(v.getBigUint64(inPtr + 24, true)) / 1e6;
	new Uint8Array(m.buffer, outPtr, 32).fill(0);
	v.setBigUint64(outPtr, userdata, true);
	v.setUint32(neventsPtr, 1, true);
	return ms;
}

export async function runWasi(module: WebAssembly.Module, argv: string[], env: string[], fs: Fd, stdin = '', cols = 80) {
	const out = new Sink();
	const err = new Sink();
	const shim = new WASI(argv, env, [new Stdin(stdin), out, err, fs]);
	const instance = await WebAssembly.instantiate(module, {wasi_snapshot_preview1: shim.wasiImport, tty: makeTty(() => shim.inst.exports.memory, cols)});
	try {
		return {code: shim.start(instance as {exports: {memory: WebAssembly.Memory; _start: () => unknown}}), out: out.text(), err: err.text()};
	} catch (e) {
		return {code: -1, out: out.text(), err: err.text() + String(e)};
	}
}
