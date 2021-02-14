import { EventEmitter } from "events";
import { promises as fs } from "fs";
import * as path from "path";

/**
 * Interval of file system polling, in milliseconds.
 */
const PollingInterval = 100;

const SysfsGPIOPath = "/sys/class/gpio";

const GPIOPortMapSizeMax = 1024;

const Uint16Max = 65535;

function parseUint16(string: string) {
  const n = Number.parseInt(string, 10);
  if (0 <= n && n <= Uint16Max) return n;
  else throw new RangeError(`Must be between 0 and ${Uint16Max}.`);
}

type PortNumber = number;
type PortName = string;
type PinName = string;

type DirectionMode = "in" | "out";

type GPIOValue = 0 | 1;

interface GPIOChangeEvent {
  readonly value: GPIOValue;
  readonly port: GPIOPort;
}

interface GPIOChangeEventHandler {
  (event: GPIOChangeEvent): void;
}

export class GPIOAccess extends EventEmitter {
  private readonly _ports: GPIOPortMap;
  onchange: GPIOChangeEventHandler | undefined;

  constructor(ports?: GPIOPortMap) {
    super();

    this._ports = ports == null ? new GPIOPortMap() : ports;
    this._ports.forEach(port =>
      port.on("change", event => {
        this.emit("change", event);
      })
    );

    this.on("change", (event: GPIOChangeEvent): void => {
      if (this.onchange !== undefined) this.onchange(event);
    });
  }

  get ports(): GPIOPortMap {
    return this._ports;
  }

  /**
   * Unexport all exported GPIO ports.
   */
  async unexportAll(): Promise<void> {
    await Promise.all(
      [...this.ports.values()].map(port =>
        port.exported ? port.unexport() : undefined
      )
    );
  }
}

/**
 * Different from Web GPIO API specification.
 */
export class GPIOPortMap extends Map<PortNumber, GPIOPort> {}

export class GPIOPort extends EventEmitter {
  private readonly _portNumber: PortNumber;
  private readonly _pollingInterval: number;
  private _direction: DirectionMode | OperationError;
  private _exported: boolean | OperationError;
  private _value: GPIOValue | undefined;
  private _timeout: ReturnType<typeof setInterval> | undefined;
  onchange: GPIOChangeEventHandler | undefined;

  constructor(portNumber: PortNumber) {
    super();

    this._portNumber = parseUint16(portNumber.toString());
    this._pollingInterval = PollingInterval;
    this._direction = new OperationError("Unknown direction.");
    this._exported = new OperationError("Unknown export.");

    this.on("change", (event: GPIOChangeEvent): void => {
      if (this.onchange !== undefined) this.onchange(event);
    });
  }

  get portNumber(): PortNumber {
    return this._portNumber;
  }

  get portName(): PortName {
    return `gpio${this.portNumber}`;
  }

  get pinName(): PinName {
    // NOTE: Unknown pinName.
    return "";
  }

  get direction(): DirectionMode {
    if (this._direction instanceof OperationError) throw this._direction;
    return this._direction;
  }

  get exported(): boolean {
    if (this._exported instanceof OperationError) throw this._exported;
    return this._exported;
  }

  async export(direction: DirectionMode): Promise<void> {
    if (!/^(in|out)$/.test(direction)) {
      throw new InvalidAccessError(`Must be "in" or "out".`);
    }

    try {
      await fs.access(path.join(SysfsGPIOPath, this.portName));
      this._exported = true;
    } catch {
      this._exported = false;
    }

    try {
      clearInterval(this._timeout as ReturnType<typeof setInterval>);
      if (!this.exported) {
        await fs.writeFile(
          path.join(SysfsGPIOPath, "export"),
          String(this.portNumber)
        );
      }
      await fs.writeFile(
        path.join(SysfsGPIOPath, this.portName, "direction"),
        direction
      );
      if (direction === "in") {
        this._timeout = setInterval(
          this.read.bind(this),
          this._pollingInterval
        );
      }
    } catch (error) {
      throw new OperationError(error);
    }

    this._direction = direction;
    this._exported = true;
  }

  async unexport(): Promise<void> {
    clearInterval(this._timeout as ReturnType<typeof setInterval>);

    try {
      await fs.writeFile(
        path.join(SysfsGPIOPath, "unexport"),
        String(this.portNumber)
      );
    } catch (error) {
      throw new OperationError(error);
    }

    this._exported = false;
  }

  async read(): Promise<GPIOValue> {
    if (!(this.exported && this.direction === "in")) {
      throw new InvalidAccessError(
        `The exported must be true and value of direction must be "in".`
      );
    }

    try {
      const buffer = await fs.readFile(
        path.join(SysfsGPIOPath, this.portName, "value")
      );

      const value = parseUint16(buffer.toString()) as GPIOValue;

      if (this._value !== value) {
        this._value = value;
        this.emit("change", { value, port: this });
      }

      return value;
    } catch (error) {
      throw new OperationError(error);
    }
  }

  async write(value: GPIOValue): Promise<void> {
    if (!(this.exported && this.direction === "out")) {
      throw new InvalidAccessError(
        `The exported must be true and value of direction must be "out".`
      );
    }

    try {
      await fs.writeFile(
        path.join(SysfsGPIOPath, this.portName, "value"),
        parseUint16(value.toString()).toString()
      );
    } catch (error) {
      throw new OperationError(error);
    }
  }
}

export class InvalidAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export async function requestGPIOAccess(): Promise<GPIOAccess> {
  return new Promise((res) => {
    const ports = new GPIOPortMap(
      [...Array(GPIOPortMapSizeMax).keys()].map(portNumber => [
        portNumber,
        new GPIOPort(portNumber)
      ])
    );
    res(new GPIOAccess(ports));
  });
}
