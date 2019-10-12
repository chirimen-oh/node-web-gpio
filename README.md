# @notweb/gpio

GPIO access with Node.js

## Usage

```js
const { requestGPIOAccess } = require("@notweb/gpio");

async function main() {
  const gpioAccess = await requestGPIOAccess();
  const port = gpioAccess.ports.get(26);

  await port.export("out");

  for (;;) {
    port.write(value);
    await new Promise(resolve => setTimeout(resolve, 1e3));
  }
}

main();
```

## Document

[Web GPIO API](http://browserobo.github.io/WebGPIO)
