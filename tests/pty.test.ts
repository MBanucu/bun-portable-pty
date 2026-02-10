import { expect, test } from "bun:test";
import { Pty } from "../pty.ts";

class Waiter {
	public resolve: () => void = () => {};
	public readonly promise: Promise<void> = new Promise<void>((res) => {
		this.resolve = res;
	});
	public readonly waitFor: string;

	constructor(waitFor: string) {
		this.waitFor = waitFor;
	}
	public test = (msg: string) => {
		if (msg.includes(this.waitFor)) {
			this.resolve();
			return true;
		}
		return false;
	};
}
test("Pty worker messages sh", async () => {
	const receivedMessages: string[] = [];

	const waiter1 = new Waiter("$");
	const waiter2 = new Waiter("Hello from PTY");
	const waiter3 = new Waiter("$");
	const waiter4 = new Waiter("exit");
	const waiter5 = new Waiter("exit");

	const waiters = [waiter1, waiter2, waiter3, waiter4, waiter5];

	let resolveWaitForExit = () => {};
	const exitPromise = new Promise<void>((res) => {
		resolveWaitForExit = res;
	});

	let msgs = "";
	using pty = new Pty(24, 80, "sh", (msg) => {
		msgs += msg;
		receivedMessages.push(msg);
		while (waiters.length > 0 && waiters[0]?.test(msgs)) {
			const waiter = waiters.shift();
			if (!waiter) break;
			msgs = msgs.slice(msgs.indexOf(waiter.waitFor) + waiter.waitFor.length);
		}
		if (waiters.length === 0 && msg === "") {
			resolveWaitForExit();
		}
	});

	await waiter1.promise; // Wait for initial prompt

	pty.write('echo "Hello" "from" "PTY"\n');
	await waiter2.promise;
	await waiter3.promise; // Wait for prompt after command

	pty.write("exit\n");
	await waiter4.promise;
	await waiter5.promise;
	await exitPromise;

	const actual = receivedMessages.join("");
	expect(actual).toContain('"Hello" "from" "PTY"');
	expect(actual).toContain("Hello from PTY");
});

test("Pty worker messages bash", async () => {
	const receivedMessages: string[] = [];

	const waiter1 = new Waiter("$");
	const waiter2 = new Waiter("Hello from PTY");
	const waiter3 = new Waiter("$");
	const waiter4 = new Waiter("exit");
	const waiter5 = new Waiter("exit");

	const waiters = [waiter1, waiter2, waiter3, waiter4, waiter5];

	let resolveWaitForExit = () => {};
	const exitPromise = new Promise<void>((res) => {
		resolveWaitForExit = res;
	});

	let msgs = "";
	using pty = new Pty(24, 80, "bash", (msg) => {
		msgs += msg;
		receivedMessages.push(msg);
		while (waiters.length > 0 && waiters[0]?.test(msgs)) {
			const waiter = waiters.shift();
			if (!waiter) break;
			msgs = msgs.slice(msgs.indexOf(waiter.waitFor) + waiter.waitFor.length);
		}
		if (waiters.length === 0 && msg === "") {
			resolveWaitForExit();
		}
	});

	await waiter1.promise; // Wait for initial prompt

	pty.write('echo "Hello" "from" "PTY"\n');
	await waiter2.promise;
	await waiter3.promise; // Wait for prompt after command

	pty.write("exit\n");
	await waiter4.promise;
	await waiter5.promise;
	await exitPromise;

	const actual = receivedMessages.join("");
	expect(actual).toContain('"Hello" "from" "PTY"');
	expect(actual).toContain("Hello from PTY");
});
