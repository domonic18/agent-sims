/** catch 块错误文案统一: Error 取 message,否则取 fallback(缺省 String(err)) */
export function toErrorMessage(err: unknown, fallback: string = String(err)): string {
  return err instanceof Error ? err.message : fallback;
}
