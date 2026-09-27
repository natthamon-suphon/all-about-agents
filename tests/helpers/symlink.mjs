const LINK_UNAVAILABLE_CODES = new Set(["EPERM", "EACCES"]);

/**
 * Skip the test when the host refuses to create a symlink or junction.
 *
 * Only a permission refusal means the host lacks link support. Any other
 * error, such as ENOENT from a wrong link path, is a test bug and is rethrown,
 * so a containment check cannot pass by skipping. t.skip() does not stop the
 * test body: the caller must return right after this call.
 */
export function skipIfLinkUnavailable(t, error) {
  if (!LINK_UNAVAILABLE_CODES.has(error?.code)) throw error;
  t.skip(`symlink unavailable: ${error.code}`);
}
