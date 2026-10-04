# dsh-local-plugin-source（本地插件源）

[English](README.md) | 中文

把一个本地目录（默认 `%USERPROFILE%\.dsh\local-plugins`）变成**应用内可安装的插件源**：
在 **设置 → 插件 → 本地插件** 里列出目录中的插件包，并可直接**安装 / 重新安装 / 启用 / 停用 / 卸载**。

它是为「不想每次找路径、也不想找 Agent」准备的：装一次之后，本机插件随时可以在应用里装回来。

**平台：任何 profile。** 主力环境是 DeepSeek Harness Desktop，带 Web UI 的 profile 同样可用。
bundle 补丁里的行**不带 `disabled` 门控**：所有 profile 都会激活它，没有 webserver 时那个页面安静地不出现而已。

---

## 1. 它解决什么

`dsh-desktop-archive-manager`（归档管理器）这类本机插件以前只能靠把绝对路径粘进**侧栏 → 插件 → 添加插件**来安装。
本插件把那个目录变成页面里的一张列表，于是：

- 卸载归档管理器之后，仍然可以在 **设置 → 插件 → 本地插件** 里一键装回来；
- 将来放进该目录的任何 DSH bundle（含浏览器端的、纯主机的都行）都会自动出现在列表里；
- 目录里没有 bundle 补丁的普通包会显示「无 bundle 补丁」，且不提供安装按钮（装了也不会被激活）。

## 2. 安装

它自己也是一个 bundle，装法与其它本地插件一致（当前桌面配置档由应用独占管理）：

```text
plugin_manager: install_bundle(target: "C:\\Users\\Administrator\\.dsh\\local-plugins\\dsh-local-plugin-source")
# 或侧栏 → 插件 → 添加插件，粘贴上面的绝对路径
```

装好后打开 **设置 → 插件**，会多出 **本地插件** 标签页。

## 3. 页面上的每个动作做什么

所有动作都转给**当前配置档自己的 Plugin Manager**（`ctx.pluginManager`），
所以清单写入、bundle 选择、pnpm 调用、Loader 重组的行为与官方安装路径完全一致——
本插件只提供「源」，不提供第二套安装器。

| 动作 | 主机端调用 | 说明 |
|---|---|---|
| 安装 / 重新安装 | `pluginManager.installBundle(<绝对路径>, { enabled: true })` | 安装并立即启用；已安装时为「重新安装」（更新本地代码用） |
| 启用 / 停用 | `pluginManager.setBundleEnabled(name, enabled)` | 只切换 bundle 层选择，依赖与文件保留 |
| 卸载 | `pluginManager.removeBundle(name)` | 走 pnpm remove；管理器判定不可移除时原样报错 |

卡片状态来自 `pluginManager.listBundles()`：**已安装 / 已启用 / 已停用 / 未安装**，
以及管理器的 `readOnlyReason`、激活失败原因（如果该 bundle 装载失败）。
安装过程的 pnpm 输出会在页面底部显示（保留末尾 4 KB，完整日志在配置档的 `.plugin-manager/logs`）。

安全边界：

- **只能安装扫描到的包**：接口按包名在已扫描列表里查行，绝不接受调用方给的路径，因此不存在路径穿越；
- 只注册一条精确路由 `/local-plugin-source/api`，做同源校验（Origin + 自定义请求头）；
- 请求体上限 64 KB。

## 4. 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `directory` | `%DSH_HOME%\local-plugins` | 被扫描的本地插件目录 |

改法（配置档补丁层）：

```yaml
- id: local-plugin-source
  config:
    directory: D:\\my-dsh-plugins
```

## 5. 包结构

```text
dsh-local-plugin-source/
├── package.json          # dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # bundle 补丁层：插入一条 local-plugin-source 行（patch-relative 指向 lib/manager.js）
├── lib/manager.js        # 主机端：/local-plugin-source/api → ctx.pluginManager
├── lib/scan.js           # 纯扫描/分类逻辑（可单测）
├── lib/client.js         # 浏览器端：设置 → 插件 → 本地插件 标签页
├── test/*.test.mjs       # node --test 套件（25 项）
├── LICENSE
└── README.md / README.zh.md
```

## 6. 自测

```powershell
& "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" --test "test/*.test.mjs"
```

25 项覆盖：清单识别与分类（bundle / 浏览器端 / 非包 / 坏 JSON / 隐藏目录）、
已安装状态合并、缺目录、接口闸门（方法/跨源/坏 JSON/未知 op）、
「只安装扫描到的包」、管理器抛错的结构化上报、`listBundles()` 的两种返回形状，
以及浏览器端（标签页注册、注入面摊平契约、四种状态各自的按钮组合、空态、失败提示、英文词典完整性）。

## 7. 已知限制

- **只管理「本目录里的包」**：不扫描任意路径，也不接管 npm/git 安装；那两条路仍由官方的**添加插件**与 `plugin_manager` 工具负责。
- **需要配置档可写**：桌面配置档由应用管理，本插件通过同一服务操作，因此不会绕过其锁与兼容性检查。
- **重装才能更新代码**：本地插件改完源码后点「重新安装」即可让新版本进入 profile；已经在内存里的旧模块仍按 DSH 的模块缓存规则，必要时重启应用。
