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
      try {
        handler(event);
      } catch (err) {
        // 单订阅者异常不阻断 tick 推进与其他订阅者(同步转发处于 tick 调用链上)
        console.error('[event-bus] 订阅者处理异常', err);
      }
    }
  }
}
