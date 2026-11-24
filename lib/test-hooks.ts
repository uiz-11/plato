/** `PLATO_TEST_HOOKS=1` turns on test-only behaviour (§10.1). Never set in the image. */
export function testHooksEnabled(): boolean {
  return process.env.PLATO_TEST_HOOKS === "1"
}
