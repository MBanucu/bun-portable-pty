import { expect, test } from "bun:test";
import { Pty } from "../pty.ts";

test("Pty worker messages sh", async () => {
	const receivedMessages: string[] = [];
	using pty = new Pty(24, 80, "/bin/sh", (msg) => receivedMessages.push(msg));

	// Give initial prompt time to appear
	await Bun.sleep(100);

	pty.write("echo Hello from PTY\n");
	await Bun.sleep(100);

	pty.write("exit\n");
	await Bun.sleep(100);

	const actual = receivedMessages.join("");

	// This is the snapshot line
	expect(actual).toMatchSnapshot();
});

test("Pty worker messages bash", async () => {
	const receivedMessages: string[] = [];
	using pty = new Pty(24, 80, "/usr/bin/env bash", (msg) =>
		receivedMessages.push(msg),
	);

	// Give initial prompt time to appear
	await Bun.sleep(100);

	pty.write("echo Hello from PTY\n");
	await Bun.sleep(100);

	pty.write("exit\n");
	await Bun.sleep(100);

	const actual = receivedMessages.join("");

	// This is the snapshot line
	expect(actual).toMatchSnapshot();
});
