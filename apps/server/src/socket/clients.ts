import type { SocketRole } from '@sims/shared';

export interface ClientInfo {
  socketId: string;
  role: SocketRole;
  connectedAt: string;
}

/** 在线客户端注册表(网关维护,/debug/clients 读取) */
export class ClientRegistry {
  private readonly _clients = new Map<string, ClientInfo>();

  add(info: ClientInfo): void {
    this._clients.set(info.socketId, info);
  }

  remove(socketId: string): void {
    this._clients.delete(socketId);
  }

  list(): ClientInfo[] {
    return [...this._clients.values()];
  }
}
