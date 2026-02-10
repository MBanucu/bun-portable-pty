import { CString, type Pointer } from "bun:ffi";
import { symbols } from "..";

export function extractErrorMessage(errPtrNumber?: bigint): string {
	const errPtr = Number(errPtrNumber) as Pointer;
	if (errPtr !== 0) {
		const errMsg = new CString(errPtr).toString();
		symbols.pty_free_err_msg(errPtr);
		return errMsg;
	} else {
		return "FFI call failed with no error message";
	}
}
