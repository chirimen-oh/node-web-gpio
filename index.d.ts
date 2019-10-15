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
/**
 * Not a specification in Web GPIO API.
 */
interface GPIOPortChangeEventHandler {
    (event: GPIOChangeEvent["value"]): void;
}
export declare class GPIOAccess extends EventEmitter {
    private readonly _ports;
    onchange: GPIOChangeEventHandler | undefined;
    constructor(ports?: GPIOPortMap);
    readonly ports: GPIOPortMap;
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
    onchange: GPIOPortChangeEventHandler | undefined;
    constructor(portNumber: PortNumber);
    readonly portNumber: PortNumber;
    readonly portName: PortName;
    readonly pinName: PinName;
    readonly direction: DirectionMode;
    readonly exported: boolean;
    export(direction: DirectionMode): Promise<void>;
    unexport(): Promise<void>;
    read(): Promise<GPIOValue>;
    write(value: GPIOValue): Promise<void>;
}
export declare class InvalidAccessError extends Error {
}
export declare class OperationError extends Error {
}
export declare function requestGPIOAccess(): Promise<GPIOAccess>;
export {};
