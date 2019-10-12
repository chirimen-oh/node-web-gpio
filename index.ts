import { EventEmitter } from "events";
import { promises as fs } from "fs";

/**
 * Interval of file system polling, in milliseconds.
 */
const PollingInterval = 100;

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

/**
 * Not a specification in Web GPIO API.
 */
interface GPIOPortChangeEventHandler {
  (event: GPIOChangeEvent["value"]): void;
}

export class GPIOAccess extends EventEmitter {
  private readonly _ports: GPIOPortMap;
  onchange: GPIOChangeEventHandler | undefined;

  constructor(ports?: GPIOPortMap) {
    super();

    this._ports = ports == null ? new GPIOPortMap() : ports;
    this._ports.forEach(port =>
      port.on("change", value => {
        const event: GPIOChangeEvent = { value, port };
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
  async unexportAll() {
    await Promise.all(
      [...this.ports.values()].map(port =>
        port.exported ? port.unexport() : undefined
      )
    );
  }
}

export class GPIOPortMap extends Map<PortNumber, GPIOPort> {}

export class GPIOPort extends EventEmitter {
  private readonly _portNumber: PortNumber;
  private readonly _pollingInterval: number;
  private _direction: DirectionMode | OperationError;
  private _exported: boolean | OperationError;
  private _value: GPIOValue | undefined;
  private _timeout: ReturnType<typeof setInterval> | undefined;
  onchange: GPIOPortChangeEventHandler | undefined;

  constructor(portNumber: PortNumber) {
    super();

    this._portNumber = portNumber;
    this._pollingInterval = PollingInterval;
    this._direction = new OperationError("Unknown direction.");
    this._exported = new OperationError("Unknown export.");

    this.on("change", (value: GPIOChangeEvent["value"]): void => {
      if (this.onchange !== undefined) this.onchange(value);
    });
  }

  get portNumber(): PortNumber {
    return this._portNumber;
  }

  get portName(): PortName {
    // NOTE: Unknown portName.
    return "";
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

  async export(direction: DirectionMode) {
    if (!/^(in|out)$/.test(direction)) {
      throw new InvalidAccessError(`Must be "in" or "out".`);
    }

    try {
      clearInterval(this._timeout as any);
      await fs.writeFile(
        `/sys/class/gpio/export`,
        parseUint16(this.portNumber.toString()).toString()
      );
      await fs.writeFile(
        `/sys/class/gpio/${parseUint16(this.portNumber.toString())}/direction`,
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

  async unexport() {
    clearInterval(this._timeout as any);

    try {
      await fs.writeFile(
        `/sys/class/gpio/unexport`,
        parseUint16(this.portNumber.toString()).toString()
      );
    } catch (error) {
      throw new OperationError(error);
    }

    this._exported = false;
  }

  async read() {
    try {
      const buffer = await fs.readFile(
        `/sys/class/gpio/${parseUint16(this.portNumber.toString())}/value`
      );

      const value = parseUint16(buffer.toString()) as GPIOValue;

      if (this._value !== value) {
        this._value = value;
        this.emit("change", value);
      }

      return value;
    } catch (error) {
      throw new OperationError(error);
    }
  }

  async write(value: GPIOValue) {
    try {
      await fs.writeFile(
        `/sys/class/gpio/${parseUint16(this.portNumber.toString())}/value`,
        parseUint16(value.toString()).toString()
      );
    } catch (error) {
      throw new OperationError(error);
    }
  }
}

export class InvalidAccessError extends Error {}

export class OperationError extends Error {}

export async function requestGPIOAccess(): Promise<GPIOAccess> {
  const ports = new GPIOPortMap(
    [...Array(Uint16Max + 1).keys()].map(portNumber => [
      portNumber,
      new GPIOPort(portNumber)
    ])
  );

  return new GPIOAccess(ports);
}
