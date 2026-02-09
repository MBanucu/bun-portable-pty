import { expect, test } from "bun:test";
import { Pty } from "../pty.ts";

test("Pty basic operations", async () => {
	using pty = new Pty(24, 80, "/bin/sh");

	// Write a command
	const input = Buffer.from("echo 'Hello, Pty!'\n");
	const written = pty.write(input);
	expect(written).toBe(input.length);

	// Give some time for the shell to process (PTY operations can be async-ish)
	await new Promise((resolve) => setTimeout(resolve, 100));

	// Read output
	let output: Buffer | null = null;
	let attempts = 0;
	while (!output && attempts < 10) {
		output = pty.read(4096);
		if (!output) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		attempts++;
	}

	expect(output).not.toBeNull();
	const outputStr = output!.toString();
	expect(outputStr).toContain("Hello, Pty!");

	// Test resize
	pty.resize(30, 120);
});
