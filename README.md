# node-web-gpio

GPIO access with Node.js

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

## Document

- [TSDoc](https://npmx.dev/package-docs/node-web-gpio)

## Reference

- [Web GPIO API for W3C Draft](http://browserobo.github.io/WebGPIO)
