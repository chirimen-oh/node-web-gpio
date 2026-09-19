/**
 * epoll パッケージの型定義
 * @see {@link https://github.com/fivdi/epoll}
 */
declare module "epoll" {
  /** epoll イベントハンドラ */
  type EpollCallback = (err: Error | null, fd: number, events: number) => void;

  /** epoll によるファイルディスクリプタ監視 */
  export class Epoll {
    static readonly EPOLLIN: number;
    static readonly EPOLLOUT: number;
    static readonly EPOLLRDHUP: number;
    static readonly EPOLLPRI: number;
    static readonly EPOLLERR: number;
    static readonly EPOLLHUP: number;
    static readonly EPOLLET: number;
    static readonly EPOLLONESHOT: number;

    constructor(callback: EpollCallback);

    readonly closed: boolean;

    add(fd: number, events: number): this;
    modify(fd: number, events: number): this;
    remove(fd: number): this;
    close(): void;
  }
}
