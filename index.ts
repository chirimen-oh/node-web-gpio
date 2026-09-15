import { EventEmitter } from "node:events";
import { promises as fs, readSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Epoll } from "epoll";

/**
 * GPIO パス
 */
const SysfsGPIOPath = "/sys/class/gpio";

/**
 * GPIO ポートマップサイズ
 */
const GPIOPortMapSizeMax = 1024;

/**
 * Uint16 Max サイズ
 */
const Uint16Max = 65535;

/**
 *
 * Uint16型変換処理
 * @param parseString 変換文字列
 * @return Uint16型変換値
 */
function parseUint16(parseString: string) {
  const n = Number.parseInt(parseString, 10);
  if (0 <= n && n <= Uint16Max) return n;
  else throw new RangeError(`Must be between 0 and ${Uint16Max}.`);
}

/**
 * GPIO0 オフセット
 * @see {@link https://github.com/raspberrypi/linux/issues/6037}
 */
const GpioOffset =
  process.platform === "linux" &&
  os.release().localeCompare("6.6", undefined, { numeric: true }) >= 0
    ? 512
    : 0;

/** ポート番号 */
type PortNumber = number;
/** ポート名 */
type PortName = string;
/** ピン名 */
type PinName = string;

/** 入出力方向 */
type DirectionMode = "in" | "out";

/** エッジ検出方向 */
type EdgeMode = "rising" | "falling" | "both";

/** GPIO 値 0: LOW / 1: HIGH */
type GPIOValue = 0 | 1;

/**
 * GPIOPort.export() のオプション
 * direction が "in" の場合のみ有効。"out" の場合は無視される。
 */
interface ExportOptions {
  /**
   * onchange イベントを発火させる電圧変化のタイミング
   * @default "both"
   */
  readonly edge?: EdgeMode;
  /**
   * チャタリング（機械式スイッチの微細なオンオフ反復）を無視する時間（ミリ秒）
   * @default 0 (無効)
   */
  readonly debounce?: number;
  /**
   * true の場合、値の論理を反転する（HIGHのとき 0、LOWのとき 1 を返す）
   * @default false
   */
  readonly activeLow?: boolean;
}

/**
 * GPIO チェンジイベント
 */
interface GPIOChangeEvent {
  /** 入出力値 */
  readonly value: GPIOValue;
  /** ポート */
  readonly port: GPIOPort;
}

/**
 * GPIO チェンジイベントハンドラ
 */
interface GPIOChangeEventHandler {
  /** イベント */
  // biome-ignore lint/style/useShorthandFunctionType: インターフェースの呼び出しシグネチャとして定義する必要があるため
  (event: GPIOChangeEvent): void;
}

/**
 * GPIO
 */
export class GPIOAccess extends EventEmitter {
  /** ポート */
  readonly #ports: GPIOPortMap;
  /** GPIO チェンジイベントハンドラ */
  onchange: GPIOChangeEventHandler | undefined;

  /**
   * Creates an instance of GPIOAccess.
   * @param ports ポート番号
   */
  constructor(ports?: GPIOPortMap) {
    super();

    this.#ports = ports == null ? new GPIOPortMap() : ports;
    // biome-ignore lint/suspicious/useIterableCallbackReturn: port.on()の戻り値は使用しないため
    this.#ports.forEach((port) =>
      port.on("change", (event) => {
        this.emit("change", event);
      }),
    );

    this.on("change", (event: GPIOChangeEvent): void => {
      if (this.onchange !== undefined) this.onchange(event);
    });
  }

  /**
   * ポート情報取得処理
   * @return 現在のポート情報
   */
  get ports(): GPIOPortMap {
    return this.#ports;
  }

  /**
   * Unexport all exported GPIO ports.
   * 全てのポート開放をする
   * @return ポート開放結果
   */
  async unexportAll(): Promise<void> {
    await Promise.all(
      [...this.ports.values()].map(async (port) => {
        let isExported: boolean;
        try {
          isExported = port.exported;
        } catch (error) {
          if (error instanceof OperationError) return;
          throw error;
        }
        if (isExported) await port.unexport();
      }),
    );
  }
}

/**
 * Different from Web GPIO API specification.
 */
export class GPIOPortMap extends Map<PortNumber, GPIOPort> {}

/**
 * GPIO ポート
 */
export class GPIOPort extends EventEmitter {
  /** ポート番号 */
  readonly #portNumber: PortNumber;
  /** 入出力方向 */
  #direction: DirectionMode | OperationError;
  /** エクスポート */
  #exported: boolean | OperationError;
  /** エクスポートリトライ回数 */
  #exportRetry: number;
  /** 入出力値 */
  #value: GPIOValue | undefined;
  /** epoll インスタンス */
  #epoll: Epoll | undefined;
  /** 監視対象ファイルハンドル */
  #fileHandle: FileHandle | undefined;
  /** GPIO チェンジイベントハンドラ */
  onchange: GPIOChangeEventHandler | undefined;

  /**
   * Creates an instance of GPIOPort.
   * @param portNumber ポート番号
   */
  constructor(portNumber: PortNumber) {
    super();

    this.#portNumber = parseUint16(portNumber.toString()) + GpioOffset;
    this.#direction = new OperationError("Unknown direction.");
    this.#exported = new OperationError("Unknown export.");
    this.#exportRetry = 0;

    this.on("change", (event: GPIOChangeEvent): void => {
      if (this.onchange !== undefined) this.onchange(event);
    });
  }

  /**
   * ポート番号取得処理
   * @return 現在のポート番号
   */
  get portNumber(): PortNumber {
    return this.#portNumber;
  }

  /**
   * ポート名取得処理
   * @return 現在のポート名
   */
  get portName(): PortName {
    return `gpio${this.portNumber}`;
  }

  /**
   * ピン名取得処理
   * @return 現在のピン名
   */
  get pinName(): PinName {
    // NOTE: Unknown pinName.
    return "";
  }

  /**
   * GPIO 入出力方向 getter
   * @return 現在のGPIO 入出力方向
   */
  get direction(): DirectionMode {
    if (this.#direction instanceof OperationError) throw this.#direction;
    return this.#direction;
  }

  /**
   * GPIO export の有無 getter
   * @return 現在のGPIO 出力
   */
  get exported(): boolean {
    if (this.#exported instanceof OperationError) throw this.#exported;
    return this.#exported;
  }

  /**
   * GPIO 出力処理
   * @param direction GPIO 入出力方向
   * @param options export オプション（direction が "in" の場合のみ有効）
   * @return export 処理の完了
   */
  async export(direction: DirectionMode, options?: ExportOptions): Promise<void> {
    if (!/^(in|out)$/.test(direction)) {
      throw new InvalidAccessError(`Must be "in" or "out".`);
    }

    try {
      await fs.access(path.join(SysfsGPIOPath, this.portName));
      this.#exported = true;
    } catch {
      this.#exported = false;
    }

    try {
      await this.#unwatch();
      if (!this.exported) {
        await fs.writeFile(path.join(SysfsGPIOPath, "export"), String(this.portNumber));
      }
      await fs.writeFile(path.join(SysfsGPIOPath, this.portName, "direction"), direction);
      if (direction === "in") {
        await this.#watch(options);
      }
      // biome-ignore lint/suspicious/noExplicitAny: エラーの型が不明なため、any型を使用してOperationErrorに変換する
    } catch (error: any) {
      if (this.#exportRetry < 10) {
        await sleep(100);
        this.#exportRetry += 1;
        await this.export(direction, options);
      } else {
        throw new OperationError(error);
      }
    }

    this.#direction = direction;
    this.#exported = true;
  }

  /**
   * Unexport exported GPIO ports.
   * ポート開放をする
   * @return ポート開放処理の完了
   */
  async unexport(): Promise<void> {
    await this.#unwatch();

    try {
      await fs.writeFile(path.join(SysfsGPIOPath, "unexport"), String(this.portNumber));
      // biome-ignore lint/suspicious/noExplicitAny: エラーの型が不明なため、any型を使用してOperationErrorに変換する
    } catch (error: any) {
      throw new OperationError(error);
    }

    this.#exported = false;
  }

  /**
   * 入力値読み取り処理
   * @return 読み取り処理の完了
   */
  async read(): Promise<GPIOValue> {
    if (!(this.exported && this.direction === "in")) {
      throw new InvalidAccessError(
        `The exported must be true and value of direction must be "in".`,
      );
    }

    try {
      const buffer = await fs.readFile(path.join(SysfsGPIOPath, this.portName, "value"));

      return parseUint16(buffer.toString()) as GPIOValue;
      // biome-ignore lint/suspicious/noExplicitAny: エラーの型が不明なため、any型を使用してOperationErrorに変換する
    } catch (error: any) {
      throw new OperationError(error);
    }
  }

  /**
   * 出力値書き込み処理
   * @return 読み取り処理の完了
   */
  async write(value: GPIOValue): Promise<void> {
    if (!(this.exported && this.direction === "out")) {
      throw new InvalidAccessError(
        `The exported must be true and value of direction must be "out".`,
      );
    }

    try {
      await fs.writeFile(
        path.join(SysfsGPIOPath, this.portName, "value"),
        parseUint16(value.toString()).toString(),
      );
      // biome-ignore lint/suspicious/noExplicitAny: エラーの型が不明なため、any型を使用してOperationErrorに変換する
    } catch (error: any) {
      throw new OperationError(error);
    }
  }

  /**
   * ハードウェア割り込み (epoll) による入力値の監視を開始する。
   * ポーリングを行わず、sysfs の edge 検出による割り込みで onchange を発火する。
   * @param options export オプション
   * @return 監視開始処理の完了
   */
  async #watch(options: ExportOptions | undefined): Promise<void> {
    const edge = options?.edge ?? "both";
    const risingEnabled = edge === "both" || edge === "rising";
    const fallingEnabled = edge === "both" || edge === "falling";

    await fs.writeFile(path.join(SysfsGPIOPath, this.portName, "edge"), edge);

    if (options?.activeLow !== undefined) {
      await fs.writeFile(
        path.join(SysfsGPIOPath, this.portName, "active_low"),
        options.activeLow ? "1" : "0",
      );
    }

    this.#fileHandle = await fs.open(path.join(SysfsGPIOPath, this.portName, "value"), "r+");

    const buffer = Buffer.alloc(16);
    const readValue = (): GPIOValue => {
      const bytesRead = readSync(this.#fileHandle!.fd, buffer, 0, buffer.length, 0);
      return parseUint16(buffer.toString("utf8", 0, bytesRead)) as GPIOValue;
    };

    // 監視開始前に一度読んでおき、開始直後に偽の change イベントが発火するのを防ぐ
    this.#value = readValue();

    const notify = (): void => {
      const value = readValue();
      if ((value === 0 && fallingEnabled) || (value === 1 && risingEnabled)) {
        if (this.#value !== value) {
          this.#value = value;
          this.emit("change", { value, port: this });
        }
      }
    };
    const debounceMs = options?.debounce ?? 0;
    const notifyDebounced = debounceMs > 0 ? debounce(notify, debounceMs) : notify;

    this.#epoll = new Epoll((error) => {
      if (error) return;
      readValue(); // レベルトリガーの割り込みをクリアする
      notifyDebounced();
    });
    this.#epoll.add(this.#fileHandle.fd, Epoll.EPOLLPRI);
  }

  /**
   * ハードウェア割り込み (epoll) による入力値の監視を停止する。
   * @return 監視停止処理の完了
   */
  async #unwatch(): Promise<void> {
    if (this.#epoll !== undefined) {
      if (!this.#epoll.closed) this.#epoll.close();
      this.#epoll = undefined;
    }
    if (this.#fileHandle !== undefined) {
      await this.#fileHandle.close();
      this.#fileHandle = undefined;
    }
  }
}

/**
 * 無効なアクセスエラー
 */
export class InvalidAccessError extends Error {
  /**
   * Creates an instance of InvalidAccessError.
   * @param message エラーメッセージ
   */
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * 操作エラー
 */
export class OperationError extends Error {
  /**
   * Creates an instance of OperationError.
   * @param message エラーメッセージ
   */
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// Web GPIOの仕様に基づく意図的なasync関数の使用なので、ルールを無効化
// eslint-disable-next-line
export async function requestGPIOAccess(): Promise<GPIOAccess> {
  const ports = new GPIOPortMap(
    [...Array(GPIOPortMapSizeMax).keys()].map((portNumber) => [
      portNumber,
      new GPIOPort(portNumber),
    ]),
  );

  return new GPIOAccess(ports);
}

/**
 * デバウンス関数
 * @param fn 実行対象の関数
 * @param ms デバウンス時間（ミリ秒）
 * @return デバウンスされた関数
 */
function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

/**
 * 待機 関数
 * @param ms スリープ時間（ミリ秒）
 * @return 待機完了
 */
function sleep(ms: number) {
  return new Promise((resolve) => {
    return setTimeout(resolve, ms);
  });
}
