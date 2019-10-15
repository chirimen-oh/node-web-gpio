"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const fs_1 = require("fs");
const path = require("path");
/**
 * Interval of file system polling, in milliseconds.
 */
const PollingInterval = 100;
const SysfsGPIOPath = "/sys/class/gpio";
const Uint16Max = 65535;
function parseUint16(string) {
    const n = Number.parseInt(string, 10);
    if (0 <= n && n <= Uint16Max)
        return n;
    else
        throw new RangeError(`Must be between 0 and ${Uint16Max}.`);
}
class GPIOAccess extends events_1.EventEmitter {
    constructor(ports) {
        super();
        this._ports = ports == null ? new GPIOPortMap() : ports;
        this._ports.forEach(port => port.on("change", value => {
            const event = { value, port };
            this.emit("change", event);
        }));
        this.on("change", (event) => {
            if (this.onchange !== undefined)
                this.onchange(event);
        });
    }
    get ports() {
        return this._ports;
    }
    /**
     * Unexport all exported GPIO ports.
     */
    async unexportAll() {
        await Promise.all([...this.ports.values()].map(port => port.exported ? port.unexport() : undefined));
    }
}
exports.GPIOAccess = GPIOAccess;
class GPIOPortMap extends Map {
}
exports.GPIOPortMap = GPIOPortMap;
class GPIOPort extends events_1.EventEmitter {
    constructor(portNumber) {
        super();
        this._portNumber = parseUint16(portNumber.toString());
        this._pollingInterval = PollingInterval;
        this._direction = new OperationError("Unknown direction.");
        this._exported = new OperationError("Unknown export.");
        this.on("change", (value) => {
            if (this.onchange !== undefined)
                this.onchange(value);
        });
    }
    get portNumber() {
        return this._portNumber;
    }
    get portName() {
        // NOTE: Unknown portName.
        return "";
    }
    get pinName() {
        // NOTE: Unknown pinName.
        return "";
    }
    get direction() {
        if (this._direction instanceof OperationError)
            throw this._direction;
        return this._direction;
    }
    get exported() {
        if (this._exported instanceof OperationError)
            throw this._exported;
        return this._exported;
    }
    async export(direction) {
        if (!/^(in|out)$/.test(direction)) {
            throw new InvalidAccessError(`Must be "in" or "out".`);
        }
        try {
            await fs_1.promises.access(path.join(SysfsGPIOPath, `gpio${this.portNumber}`));
            this._exported = true;
        }
        catch {
            this._exported = false;
        }
        try {
            clearInterval(this._timeout);
            if (!this.exported) {
                await fs_1.promises.writeFile(path.join(SysfsGPIOPath, "export"), String(this.portNumber));
            }
            await fs_1.promises.writeFile(path.join(SysfsGPIOPath, `gpio${this.portNumber}`, "direction"), direction);
            if (direction === "in") {
                this._timeout = setInterval(this.read.bind(this), this._pollingInterval);
            }
        }
        catch (error) {
            throw new OperationError(error);
        }
        this._direction = direction;
        this._exported = true;
    }
    async unexport() {
        clearInterval(this._timeout);
        try {
            await fs_1.promises.writeFile(path.join(SysfsGPIOPath, "unexport"), String(this.portNumber));
        }
        catch (error) {
            throw new OperationError(error);
        }
        this._exported = false;
    }
    async read() {
        if (!(this.exported && this.direction === "in")) {
            throw new InvalidAccessError(`The exported must be true and value of direction must be "in".`);
        }
        try {
            const buffer = await fs_1.promises.readFile(path.join(SysfsGPIOPath, `gpio${this.portNumber}`, "value"));
            const value = parseUint16(buffer.toString());
            if (this._value !== value) {
                this._value = value;
                this.emit("change", value);
            }
            return value;
        }
        catch (error) {
            throw new OperationError(error);
        }
    }
    async write(value) {
        if (!(this.exported && this.direction === "out")) {
            throw new InvalidAccessError(`The exported must be true and value of direction must be "out".`);
        }
        try {
            await fs_1.promises.writeFile(path.join(SysfsGPIOPath, `gpio${this.portNumber}`, "value"), parseUint16(value.toString()).toString());
        }
        catch (error) {
            throw new OperationError(error);
        }
    }
}
exports.GPIOPort = GPIOPort;
class InvalidAccessError extends Error {
}
exports.InvalidAccessError = InvalidAccessError;
class OperationError extends Error {
}
exports.OperationError = OperationError;
async function requestGPIOAccess() {
    const ports = new GPIOPortMap([...Array(Uint16Max + 1).keys()].map(portNumber => [
        portNumber,
        new GPIOPort(portNumber)
    ]));
    return new GPIOAccess(ports);
}
exports.requestGPIOAccess = requestGPIOAccess;
