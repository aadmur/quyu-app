# 真机冷启动测量 SOP

> 对应迭代计划 v12 · QY-PERF-008。目标：把功能需求清单 4.1 里长期「待补测」的两项指标
> ——**冷启动首屏（APK）< 2 s** 与**下单接口 P99 < 500 ms**——变成可重复测量、可对照的实测值。

---

## 一、指标定义与验收线

| 指标 | 定义 | 验收线 | 当前状态 |
|---|---|---|---|
| 冷启动首屏 | 从导航开始到**首屏可交互**（Layout 首帧提交后再等两帧） | < 2 s | 已有实测（见 §5） |
| 下单接口 P99 | 服务端 `createOrder()` 单请求处理耗时的第 99 百分位 | < 500 ms | 工具就绪，待可用测试库（见 §6） |

冷启动同时记录 4 个中间量，便于定位瓶颈落点：

- `ttfbMs` 首字节 —— 网络与服务端响应
- `fcpMs` 首次内容绘制 —— 关键 CSS/字体就绪
- `lcpMs` 最大内容绘制 —— 首屏主要图片/文字就绪
- `interactiveMs` 首屏可交互 —— JS 解析执行完成

埋点实现在 `app/src/lib/perf.ts`，为**零依赖**的浏览器原生 Performance API 采集；
每个页面加载只上报一次，用 `sendBeacon`（降级 `fetch(keepalive)`）POST 到 `/api/perf`。

> 想临时关闭埋点：`localStorage.setItem('qy_perf_off','1')`。
> 想在 DevTools 里现场核对原始对象：读 `window.__QY_PERF__`。

---

## 二、选哪种测量方法

| 方法 | 适用 | 是否改动制品 | 可信度 |
|---|---|---|---|
| **A. 实验室测量** | 优化前后对照、回归看门禁 | 否 | 中（桌面 Chromium + 节流，非真机） |
| **B. 真机 release APK（服务端采样）** | **真机验收（推荐主力）** | 否 | 高（真实设备/网络/用户） |
| **C. 真机 + WebView 远程调试** | 单机现场深挖（要看得见瀑布图） | **是**（需开调试开关重新打包） | 高 |

**为什么 B 是主力**：Capacitor 的 `android.webContentsDebuggingEnabled` 缺省值等于 `isDebug`
（见 `apk-shell/node_modules/@capacitor/android/.../CapConfig.java`，未在 `capacitor.config.json` 显式设置），
因此**现行 release APK 的 WebView 远程调试是关闭的**，无法直接接 DevTools。
而应用自身已经把数据 POST 到 `/api/perf` 并落盘，这条路在 release 包上开箱可用。

---

## 三、方法 A：实验室测量（已跑通）

```bash
cd app
npm run build                      # 必须先在本地构建

# 默认：Slow 4G（1.5 Mbps / 300 ms）+ CPU 4x 节流，10 次取中位数
npm run perf:coldstart -- --serve --runs 10 --log-dir ../tmp-lab-logs

# 真实 4G 档位
npm run perf:coldstart -- --serve --runs 5 --net fast4g --log-dir ../tmp-lab-logs

# 只测客户端成本（不限速，隔离出 JS 执行开销）
npm run perf:coldstart -- --serve --runs 5 --net none --log-dir ../tmp-lab-logs

# 测任意已在跑的站点（含生产）
npm run perf:coldstart -- --url http://47.109.185.118:3000 --runs 10
```

关键设计：**每次测量都新起一个 Chromium 实例 + 全新 `--user-data-dir`**，
因此磁盘缓存、HTTP 缓存、JS 引擎全为冷态；再叠加 `Emulation.setCPUThrottlingRate`
与 `Network.emulateNetworkConditions`。参数可用 `--cpu` / `--net` 覆盖。

网络档位（Chrome DevTools 内置口径）：`slow4g`（默认）/ `fast4g` / `fast3g` / `slow3g` / `none`。

> 务必带 `--log-dir`：否则实验室样本会写进 `logs/`，与真机样本混在一起算分位数。

**自检**：脚本会检查 FCP/LCP/首屏可交互/load 是否缺失或恒为 0，任一异常会打印
`⚠ 埋点自检未通过` 并提示结果不可用于验收。这是有来历的——早期埋点把导航时序放在
`initPerfMonitor()` 阶段读取，`loadEventEnd` 当时尚未发生，`loadMs` 恒为 0，正是靠这条自检抓出来的。

---

## 四、方法 B：真机 release APK（服务端采样）

真机上不需要任何调试工具，应用自己会上报。

1. **装机**：安装现行 APK（真机、非模拟器），连好网络。
2. **冷启动采样**：每次测量前**彻底杀掉进程**再启动，否则是热启动（`sessionKind` 会是
   `reload`/`back_forward`，聚合时会被过滤掉，白测）。
   ```bash
   adb shell am force-stop com.quyu.fishing          # 实际包名见 apk-shell/capacitor.config.json
   adb shell am start -n com.quyu.fishing/.MainActivity
   ```
   重复 **≥ 10 次**，覆盖你要验收的网络档位（建议分别在 Wi-Fi 与移动数据下各测一轮）。
3. **取数**：样本按天落在生产 `/opt/quyu/logs/perf-YYYY-MM-DD.jsonl`。
   用 Workbench CLI 或 scp 把文件拉回本地，然后：
   ```bash
   cd app
   npm run perf:stats -- logs/perf-2026-09-12.jsonl                 # 全部
   npm run perf:stats -- --since 2026-09-12 --group net             # 按网络分档
   npm run perf:stats -- --since 2026-09-12 --group cpu             # 按 CPU 核数分档
   npm run perf:stats -- --since 2026-09-12 --path /                # 只看首页冷启动
   ```
   也可直接在服务器上跑（把 `scripts/perf-log-stats.mjs` 拷到 `/opt/quyu` 后 `node` 执行，零依赖）。

**分档为什么重要**：`interactiveMs` 在中端机上可能是旗舰机的 2–3 倍。
不分档看总体中位数会把两类设备混成一个没有意义的数字。**验收结论必须绑定设备档位与网络档位。**

`PERF_LOG_DIR` 可覆盖落盘目录（默认 `<cwd>/logs`），用于把采样挂到独立数据盘。

---

## 五、方法 C：真机 + WebView 远程调试（需重新打包）

仅当你需要看网络瀑布图、Long Task 火焰图时使用。

1. 在 `apk-shell/capacitor.config.json` 增加：
   ```json
   { "android": { "webContentsDebuggingEnabled": true } }
   ```
2. 重新打 debug/release 包并安装。
3. 转发 WebView 的 DevTools 端口：
   ```bash
   adb shell cat /proc/net/unix | grep webview_devtools_remote        # 找到 socket 名（含 pid）
   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
   curl http://127.0.0.1:9222/json                                     # 取 page 的 webSocketDebuggerUrl
   ```
4. 把该 WebSocket 地址直接喂给测量脚本（复用同一套指标口径）：
   ```bash
   npm run perf:coldstart -- --ws ws://127.0.0.1:9222/devtools/page/<id> --runs 10
   ```

> 注意：开了调试开关的包**不是**发布包，其性能数据只能用于定位，不能用于验收结论。

---

## 六、变量控制规则（必须遵守）

1. **只统计冷启动**：聚合脚本默认只保留 `sessionKind === 'navigate'`。
2. **测量前杀进程**：热启动不是冷启动。
3. **同机同网同档位**：前后对照必须同设备、同网络档位、同 CPU 档位；跨档位对比无效。
4. **取中位数（P50）作为结论口径**，同时记录 P90 观察长尾。样本量 ≥ 10。
5. **不混样本**：实验室样本用 `--log-dir` 单独落盘；冒烟脚本的合成探针值写系统临时目录
   （`PERF_LOG_DIR` 隔离），绝不进 `logs/`。
6. **不删原始日志**：JSONL 是原始证据，分析产物另存（`--json`）。

---

## 七、已产出的基线对照（v8.9.0 → v8.10.0）

**测量环境（两次完全相同）**：桌面 Chromium 1217（`chrome-win64`），视口 390×844、dpr 3，
CPU 4× 节流，每次全新浏览器实例（真冷缓存），各 10 次取 P50。
基线为 `3e59500`（v12 动工前的 v8.9.0 状态）用 `git archive` 单独构建，**并注入同一份埋点**
（`src/lib/perf.ts` + `/api/perf` 端点）以保证前后用同一把尺子。

### Slow 4G（1.5 Mbps / 300 ms）— 10 次

| 指标 | v8.9.0 基线 | v8.10.0 | 变化 |
|---|---|---|---|
| 首屏传输量 | 1026 KB | **287 KB** | **−72.0%** |
| 请求数 | 4 | 20 | +16 |
| TTFB | 11 ms | 11 ms | — |
| FCP | 7064 ms | **2464 ms** | **−65.1%** |
| LCP | 7560 ms | **2984 ms** | **−60.5%** |
| 首屏可交互 | 7343 ms | **2708 ms** | **−63.1%** |
| load 完成 | 6439 ms | **1916 ms** | **−70.2%** |

### Fast 4G（4 Mbps / 20 ms）— 5 次

| 指标 | v8.9.0 基线 | v8.10.0 | 变化 |
|---|---|---|---|
| 首屏传输量 | 1149 KB | **290 KB** | **−74.8%** |
| 请求数 | 8 | 22 | +14 |
| FCP | 3212 ms | **1264 ms** | **−60.7%** |
| LCP | 3568 ms | **1772 ms** | **−50.3%** |
| 首屏可交互 | 3436 ms | **1551 ms** | **−54.9%** |
| load 完成 | 2522 ms | **710 ms** | **−71.8%** |

### 怎么读这张表

- **达成情况**：在真实 4G（4 Mbps）档位，首屏可交互 **1551 ms < 2000 ms，达成设计指标**；
  在 Slow 4G（1.5 Mbps）档位 **2708 ms**，未达成——但剩余瓶颈已经是**带宽下限**
  （287 KB ÷ 1.5 Mbps ≈ 1.53 s 仅传输耗时），不是前端执行。要在这类弱网达标，
  下一步只能继续压缩字节（首屏图片是当前最大剩余项），而不是再优化 JS。
- **请求数从 4 → 20 是预期代价**：路由级代码分割把一个大包拆成多个小组，
  弱网下多出的 RTT 成本远小于省下的字节。Slow 4G 下 4→20 请求只带来 0.3 s 量级的
  `latency` 叠加，而字节省了 739 KB（≈ 4 s）。
- **基线在 Fast 4G 下多出 4 个请求、多 123 KB**：基线 `index.html` 仍引用
  Google Fonts 外链（`fonts.googleapis.com` + `fonts.gstatic.com`，QY-PERF-003 已移除）。
  慢网下外链加载失败、快网下成功，因此出现这个差异。这条差异是**推断**，
  依据是「请求数 4→8 且多出量级与字体子集相符」，未逐条比对资源 URL。

> 上述数字是**实验室数据**，用于证明优化有效性与量级。
> **上线验收结论必须以方法 B 的真机数据为准**，并按设备/网络分档。

---

## 八、下单接口 P99 补测

```bash
cd app
# 需要 DATABASE_URL 指向可丢弃的测试库
node --env-file=.env.smoke --import tsx scripts/bench-order-p99.ts --iter 200
node --env-file=.env.smoke --import tsx scripts/bench-order-p99.ts --iter 200 --cleanup
```

- 测的是服务层 `createOrder()` —— 即 `app.orders.create` 这个 tRPC 过程内部执行的**同一个函数**，
  量到的是服务端处理耗时（含 MySQL 事务写入），不含公网 RTT。
- 串行执行（concurrency = 1）是有意为之：下单是写操作，要的是**单请求时延分布**而非吞吐，
  串行无排队干扰，P99 反映真实的慢请求。
- 会先做 1 次预热（排除建连/语句缓存/JIT 的虚高）。
- `--cleanup` 会按本次 `runId` 前缀删除写入的订单，**仅适用于可丢弃的测试库**。
  默认不清理，脚本会打印 runId 前缀便于手工处理。
- **HTTP 层端到端压测不要直接用 autocannon 打 `app.orders.create`**：
  该过程带 10 次/分钟的限流桶（`api/feature-router.ts`），单 actor 无法做高并发，
  压出来的数只反映限流而不是性能。

**当前阻塞**：本机 MySQL 3306 实例不是 `quyu_test`（`root/root` 被拒），因此本机无法产出可信的
P99 数字。脚本已就绪并在连库失败时以退出码 2 明确报错（不抛栈）。
补测需二者之一：① 一个可丢弃的测试库；② 生产低峰期由你确认后执行（写操作，需你明确授权）。

---

## 九、常见坑

| 现象 | 原因 | 处置 |
|---|---|---|
| `window.__QY_PERF__` 为空 | 埋点未启动 / 被 `qy_perf_off` 关闭 | `check-perf-wiring.mjs` 已作为构建门禁拦截接线断裂 |
| `loadMs` 恒为 0 | 导航时序被过早读取 | 已在 `src/lib/perf.ts` 修（改为 `report()` 时读取）；脚本自检会报警 |
| 分位数看着离谱 | 实验室样本与真机样本混在一个文件 | 实验室一律带 `--log-dir` |
| 每次都是热启动 | 没杀进程 | `adb shell am force-stop <包名>` |
| 接不上 WebView DevTools | release 包默认关闭调试 | 走方法 B，或按方法 C 显式开开关重新打包 |
| `/api/perf` 返回 404 | 路由被注册到 `app.all("/api/*")` 之后 | 构建门禁第 3 条不变量会拦截 |

---

## 十、命令速查

```bash
cd app

npm run perf:firstload                                  # 首屏静态资源核算（不启浏览器）
npm run perf:coldstart -- --serve --runs 10             # 实验室冷启动（默认 Slow 4G + CPU 4x）
npm run perf:coldstart -- --url <URL> --runs 10         # 测线上
npm run perf:coldstart -- --ws <CDP_WS_URL> --runs 10   # 接真机 WebView
npm run perf:stats -- --since 2026-09-12 --group net    # 聚合真机采样
npm run perf:order -- --iter 200                        # 下单 P99（需测试库）
```
