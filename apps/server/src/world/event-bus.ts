/**
 * 极简事件总线(纯逻辑零 I/O):离散事件即时分发,订阅者同步消费。
 * 感知/记忆写入等异步重活由订阅方自行转异步,不阻塞 tick。
 */
export class EventBus<E> {
  private readonly _handlers = new Set<(event: E) => void>();

  subscribe(handler: (event: E) => void): () => void {
    this._handlers.add(handler);
    return () => {
      this._handlers.delete(handler);
    };
  }

  emit(event: E): void {
    for (const handler of this._handlers) {
      handler(event);
    }
  }
}
