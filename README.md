# node-web-gpio

GPIO access with Node.js

> [!NOTE]
> Linux only. This library uses the sysfs GPIO interface (`/sys/class/gpio`) and the native `epoll` addon for hardware interrupts, neither of which exist on Windows/macOS.

## Usage

```
$ npm i node-web-gpio
```

```js
import { requestGPIOAccess } from "node-web-gpio";
import { setTimeout as sleep } from "node:timers/promises";

const gpioAccess = await requestGPIOAccess();
const port = gpioAccess.ports.get(26);

await port.export("out");

while (true) {
  await port.write(1);
  await sleep(1000);
  await port.write(0);
  await sleep(1000);
}
```

### Input with hardware interrupts (epoll)

Input ports are watched via the Linux epoll API instead of polling, so `onchange` fires immediately on a hardware interrupt without dropping fast pulses.

```js
const port = gpioAccess.ports.get(17);

await port.export("in", { edge: "rising", debounce: 10 });

port.onchange = (event) => {
  console.log(event.value);
};
```

`export()` accepts an optional second argument (only applied when `direction` is `"in"`):

| Option      | Type                              | Default        | Description                                                        |
| ----------- | --------------------------------- | -------------- | ------------------------------------------------------------------ |
| `edge`      | `"rising" \| "falling" \| "both"` | `"both"`       | Which voltage transition fires `onchange`.                         |
| `debounce`  | `number`                          | `0` (disabled) | Milliseconds of chatter (e.g. mechanical switch bounce) to ignore. |
| `activeLow` | `boolean`                         | `false`        | Inverts the logic level (`1` when LOW, `0` when HIGH).             |

Since this relies on the native `epoll` package, a build toolchain (e.g. `build-essential` and `python3` on Debian/Raspberry Pi OS) is required when installing on Linux.

## Document

- [TSDoc](https://npmx.dev/package-docs/node-web-gpio)

## Reference

- [Web GPIO API for W3C Draft](http://browserobo.github.io/WebGPIO)

## Acknowledgments

- [node-web-gpio-onoff](https://github.com/satakagi/node-web-gpio-onoff) by [@satakagi](https://github.com/satakagi). This library's `onchange` handling is based on its epoll-based interrupt-driven approach.
