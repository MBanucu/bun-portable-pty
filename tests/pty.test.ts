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

const isWindows = process.platform === "win32";

const testMatrix = isWindows
	? [
			{ cmd: "cmd.exe", argv: [] },
			{ cmd: "powershell.exe", argv: [] },
			{ cmd: "pwsh.exe", argv: [] },
		]
	: [
			{ cmd: "sh", argv: [] },
			{ cmd: "bash", argv: [] },
			{ cmd: "/usr/bin/env", argv: ["bash"] },
		];

const TIMEOUT_MS = 1000;

async function waitWithTimeout(
	promise: Promise<void>,
	waitFor: string,
	receivedMessages: string[],
): Promise<void> {
	try {
		await Promise.race([
			promise,
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error(`Timeout waiting for "${waitFor}"`)),
					TIMEOUT_MS,
				),
			),
		]);
	} catch (err) {
		if (err instanceof Error) {
			err.message += ` (while waiting for "${waitFor}")`;
			console.error(err);
		}
		console.error(
			`Received messages so far: ${JSON.stringify(receivedMessages.join(""))}`,
		);
		throw err;
	}
}

test.each(
	testMatrix,
)("spawn success in interactive terminal: $cmd $argv", async (cmd) => {
	const receivedMessages: string[] = [];

	const prompt = isWindows ? ">" : "$"; // Simplistic prompt check; may need adjustment per shell
	const newline = isWindows ? "\r\n" : "\n";
	const echoAnswer = isWindows ? '"Hello" "from" "PTY"' : "Hello from PTY";

	const waiter1 = new Waiter(prompt);
	const waiter2 = new Waiter(echoAnswer);
	const waiter3 = new Waiter(prompt);
	const waiter4 = new Waiter("exit");

	const waiters = [waiter1, waiter2, waiter3, waiter4];

	let resolveWaitForExit = () => {};
	const exitPromise = new Promise<void>((res) => {
		resolveWaitForExit = res;
	});

	let msgs = "";
	using pty = new Pty(24, 80, cmd.cmd, cmd.argv, (msg) => {
		msgs += msg;
		receivedMessages.push(msg);
		while (waiters[0]?.test(msgs)) {
			const waiter = waiters.shift();
			if (!waiter) break;
			msgs = msgs.slice(msgs.indexOf(waiter.waitFor) + waiter.waitFor.length);
		}
		if (waiters.length === 0 && msg === "") {
			resolveWaitForExit();
		}
	});

	await waitWithTimeout(waiter1.promise, waiter1.waitFor, receivedMessages); // Wait for initial prompt

	pty.write(`echo "Hello" "from" "PTY"${newline}`);
	await waitWithTimeout(waiter2.promise, waiter2.waitFor, receivedMessages);
	await waitWithTimeout(waiter3.promise, waiter3.waitFor, receivedMessages); // Wait for prompt after command

	pty.write(`exit${newline}`);
	await waitWithTimeout(waiter4.promise, waiter4.waitFor, receivedMessages);
	await waitWithTimeout(exitPromise, "exit completion", receivedMessages);

	const actual = receivedMessages.join("");
	expect(actual).toContain('"Hello" "from" "PTY"');
	expect(actual).toContain("Hello from PTY");
});

test("spawn error", async () => {
	expect(() => {
		new Pty(24, 80, "/usr/bin/env bash");
	}).toThrow(
		"Unable to spawn /usr/bin/env bash because it doesn't exist on the filesystem (ENOENT: No such file or directory)",
	);
});
