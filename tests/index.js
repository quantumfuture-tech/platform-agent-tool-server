"use strict";

/**
 * 让 node --test tests/ 也能跑：目录参数会解析到本文件。
 * 单独跑某个文件仍然可以：node --test tests/tools.test.js
 */

require("./engine.test.js");
require("./repo.test.js");
require("./tools.test.js");
