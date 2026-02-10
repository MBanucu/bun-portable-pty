import { expect, test } from "bun:test";

test("buf test const", async () => {
	const buf = Buffer.allocUnsafe(4096);
	buf[0] = "A".charCodeAt(0);
	buf[1] = "B".charCodeAt(0);
	buf[2] = "C".charCodeAt(0);
	const strABC = buf.toString(undefined, 0, 3);
	expect(strABC).toBe("ABC");
	buf[0] = "D".charCodeAt(0);
	buf[1] = "E".charCodeAt(0);
	buf[2] = "F".charCodeAt(0);
	const strDEF = buf.toString(undefined, 0, 3);
	expect(strDEF).toBe("DEF");
	expect(strABC).toBe("ABC");
});

test("buf test let", async () => {
	let str = "";
	const buf = Buffer.allocUnsafe(4096);
	buf[0] = "A".charCodeAt(0);
	buf[1] = "B".charCodeAt(0);
	buf[2] = "C".charCodeAt(0);
	const strABC = buf.toString(undefined, 0, 3);
	expect(strABC).toBe("ABC");
	str += strABC;
	expect(str).toBe("ABC");
	buf[0] = "D".charCodeAt(0);
	buf[1] = "E".charCodeAt(0);
	buf[2] = "F".charCodeAt(0);
	const strDEF = buf.toString(undefined, 0, 3);
	expect(strDEF).toBe("DEF");
	expect(strABC).toBe("ABC");
	str += strDEF;
	expect(str).toBe("ABCDEF");
});
