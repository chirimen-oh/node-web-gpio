/// <reference types="node" />
import { EventEmitter } from "events";
declare type PortNumber = number;
declare type PortName = string;
declare type PinName = string;
declare type DirectionMode = "in" | "out";
declare type GPIOValue = 0 | 1;
interface GPIOChangeEvent {
    readonly value: GPIOValue;
    readonly port: GPIOPort;
}
interface GPIOChangeEventHandler {
    (event: GPIOChangeEvent): void;
}
export declare class GPIOAccess extends EventEmitter {
    private readonly _ports;
    onchange: GPIOChangeEventHandler | undefined;
    constructor(ports?: GPIOPortMap);
    get ports(): GPIOPortMap;
    /**
     * Unexport all exported GPIO ports.
     */
    unexportAll(): Promise<void>;
}
/**
 * Different from Web GPIO API specification.
 */
export declare class GPIOPortMap extends Map<PortNumber, GPIOPort> {
}
export declare class GPIOPort extends EventEmitter {
    private readonly _portNumber;
    private readonly _pollingInterval;
    private _direction;
    private _exported;
    private _value;
    private _timeout;
    onchange: GPIOChangeEventHandler | undefined;
    constructor(portNumber: PortNumber);
    get portNumber(): PortNumber;
    get portName(): PortName;
    get pinName(): PinName;
    get direction(): DirectionMode;
    get exported(): boolean;
    export(direction: DirectionMode): Promise<void>;
    unexport(): Promise<void>;
    read(): Promise<GPIOValue>;
    write(value: GPIOValue): Promise<void>;
}
export declare class InvalidAccessError extends Error {
    constructor(message: string);
}
export declare class OperationError extends Error {
    constructor(message: string);
}
export declare function requestGPIOAccess(): Promise<GPIOAccess>;
export {};
