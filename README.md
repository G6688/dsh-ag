# dsh-ag

把 **ag中转站** 作为模型供应商接进 **DSH Desktop**
（DeepSeek Harness 桌面版）。

**装上就能用，关掉就失效，不需要任何命令。**

- **不碰你的密钥**：插件只往 `llm-pi-ai` 设置段里写一条供应商路由，用凭据名（默认 `AG_API_KEY`）
  引用密钥，密钥始终待在你自己的 DSH 凭据库里。
- **开关就是插件本身**：插件在挂载状态，模型就在选择器里；在插件面板里关掉它，它写进去的路由和它装的
  代理会一起撤掉，模型随之消失；重新打开就再接回来。
- **不弄丢你自己的东西**：如果那个路由位置在你装插件之前就有内容（比如你在「设置 → 模型」里手写过一条），
  插件卸载时会把原来那条原样放回去。

> **名字说明**：包名和目录名是 `dsh-ag`（npm 包名只能用 ASCII 字母），状态命令是 `/ag`；
> 界面、文档和模型卡片里统一显示「ag中转站」。

---

## 目录

- [它替你解决的两个坑](#它替你解决的两个坑)
- [前提](#前提)
- [安装](#安装)
- [安装后的第一次使用](#安装后的第一次使用)
- [确认装好了](#确认装好了)
- [日常使用](#日常使用)
- [改配置](#改配置)
- [遇到问题](#遇到问题)
- [升级 / 卸载](#升级--卸载)
- [插件是怎么工作的](#插件是怎么工作的)

---

## 它替你解决的两个坑

1. **服务端只放行它认得的编程助手客户端。** DSH 会强制发送自己的 `User-Agent` 且保留这个头，所以
   识别只能靠另一个头（本插件用 `originator: codex_cli_rs`，DSH 会原样透传）。少了它的典型表现是：
   请求被服务端以 **401** 拒绝，而界面把 401 说成「API 密钥无效」——很容易误判成密钥问题，白白折腾。
   插件写入的路由总是带着这个头。
2. **Node 不读操作系统的代理设置。** 浏览器走了系统代理，DSH 不会跟着走，所以即使你能打开网页也可能
   连不上接口。插件可以在运行时只把这一个站点的域名指向你本机的代理，其它供应商、模型的 `web_fetch`、
   本机回环地址都不受影响；关掉插件就把原来的网络出口原样放回去。

---

## 前提

1. 这台机器上装有 **DSH Desktop**，能正常开会话。
2. 有**你自己的** ag中转站账号和 API 密钥（到 [ag中转站官网](https://agentrouter.org/) 申请；不要用别人的密钥）。
3. 网络能连到 ag中转站 的接口：
   - 能直连 → 把插件配置里的 `proxy` 改成 `''`。
   - 不能直连（很多地方都不能）→ 本机需要有代理在跑，比如 Clash 常见的 `http://127.0.0.1:7890`，
     这也是插件里的默认值；端口不一样就改一下。

---

## 安装

> **如果感觉自己动手麻烦，可以让 agent 帮你安装这个插件。**
> 把这一句和本仓库地址丢给任意一个 coding agent（Codex / Claude Code / DSH 自己的 agent 都行）就行：
> 「请读一下这个仓库的 README，把这个 DSH 插件装到我的 DSH Desktop 里」。它会自己解压、跑脚本、
> 检查结果——装完你只需要在「设置 → 模型」里填一次密钥。

插件要装进的是 DSH 的 **profile 目录**，默认是 `%USERPROFILE%\.dsh\profiles\desktop`。

### 方式 A：一键脚本（推荐）

1. 下载本仓库（`Code` → `Download ZIP`），解压到任意位置，例如桌面。
   （仓库根目录里还有一个 `dsh-ag-1.0.0.zip`，装的东西和本仓库完全一样，
   适合直接打包转发给别人。）
2. 双击 `install.cmd`。
   （它调用 PowerShell；**不需要管理员权限**，只写你自己的用户目录。）
3. 看到 `完成` 后，**重启 DSH Desktop**。
4. 继续看下面的「安装后的第一次使用」。

脚本按顺序做四件事：

1. 把 `dsh-ag\` 复制到 profile 的 `node_modules\` 下；
2. 把 `vendor\dsh-ag-1.0.0.tgz` 复制到 profile 的 `vendor\` 下；
3. 在 profile 的 `package.json` 里登记依赖，并把它加进 `dsh.profile.bundles`；
4. 把 `pnpm-lock.yaml` 更新到和 `package.json` 一致（这样 DSH 自带的插件市场之后还能正常装卸别的插件）。

改过的文件都会先备份成 `<文件名>.bak-<时间戳>`。同一个 profile 上重复运行不会重复登记，只会在有新版本时
把插件换掉。它**不碰** `settings.yaml`，也不读不写任何密钥。

可用参数（一般用不到）：

| 参数 | 作用 |
| --- | --- |
| `-Profile <名字>` | 装进别的 profile（默认 `desktop`） |
| `-DshHome <目录>` | 换一个 DSH 主目录（默认 `%USERPROFILE%\.dsh`） |
| `-SkipLockFile` | 不动 `pnpm-lock.yaml` |

### 方式 B：手动（和脚本等价）

把 `%USERPROFILE%\.dsh\profiles\desktop` 记作 *profile 目录*。

1. 把仓库里的 `dsh-ag` 整个目录复制到 *profile 目录* 的 `node_modules\` 下，
   即 `…\node_modules\dsh-ag\`。
2. 把 `vendor\dsh-ag-1.0.0.tgz` 复制到 *profile 目录* 的 `vendor\` 下。
3. 编辑 *profile 目录* 里的 `package.json`，加两处：

   ```json
   {
     "dependencies": {
       "dsh-ag": "file:vendor\\dsh-ag-1.0.0.tgz"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "…原来那些不要动…",
           "dsh-ag"
         ]
       }
     }
   }
   ```

   注意 `dependencies` 里的路径要写**两个反斜杠**（JSON 里 `\` 本身要转义）。
4. 重启 DSH Desktop。

> 桌面版 profile 由应用自己管理，`dsh plugin --profile desktop add` 会被拒绝，所以只能走上面两条路。
> 自己创建的 web / tui profile 可以用官方命令：
> `dsh plugin --profile <名字> add file:<插件目录的绝对路径>`（路径前必须写 `file:`，否则会被当成 git 依赖）。

---

## 安装后的第一次使用

1. 重启 DSH Desktop。
2. 打开 **设置 → 模型**，找到 **ag中转站** 卡片，点 **密钥**，粘贴你自己的 API 密钥并保存。
   **只需要做这一次**（密钥存进 DSH 的凭据库，插件不保存它）。
3. 在模型选择器里选 **`glm-5.3`** 或 **`deepseek-v4-flash`**，直接对话。

---

## 确认装好了

随便打开一个会话，输入：

```
/ag
```

它会列出一段状态：地址、协议、请求头、模型清单、密钥是否已配置、端点是否可达、代理装了没有。
**它只报告，不改动任何东西**；带别的参数（比如以前习惯的 `on` / `off`）也只会得到一句说明和同样的状态。

看到「状态 : 已接入」和「密钥 : AG_API_KEY 已配置」就说明一切正常。

---

## 日常使用

- **不需要任何命令**。装好就是开着，直接选模型对话。
- **想临时停用**：在插件面板里关掉这个插件（或把它从 profile 的 `dsh.profile.bundles` 里删掉），
  它写进去的路由和它装的代理会一起撤掉，模型也随之从选择器里消失。
- **想再用**：重新打开（加回 `bundles`），重启即可。
- 一次都没用过的按键习惯（`/ag on`、`/ag off`）不会被当成命令执行，只会提示你
  插件本身就是开关。

---

## 改配置

配置在插件目录的 `cordis.patch.yml` 里：

| 字段 | 含义 | 默认 |
| --- | --- | --- |
| `displayName` | 模型卡片上显示的名字 | `ag中转站` |
| `baseURL` | 接口地址 | `https://agentrouter.org/v1` |
| `apiKeyEnv` | 凭据名 | `AG_API_KEY` |
| `originator` | 客户端识别头 `originator` 的值 | `codex_cli_rs` |
| `proxy` | 本地代理地址；能直连就填 `''` | `http://127.0.0.1:7890` |
| `models` | 暴露给 DSH 的模型 id 列表 | 6 个 |

改完重启一次 DSH。

也可以不改插件本身，而在 **profile 自己的** `cordis.patch.yml` 里按 id 覆盖（这一层在所有插件之后应用，
**重装插件不会覆盖它**）：

```yaml
- id: ag
  config:
    baseURL: https://your-endpoint.example/v1
    proxy: ''
```

（这种覆盖会替换整份 `config:`，没写的字段回落到插件内置默认值。）

---

## 遇到问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 输入 `/ag` 说没有这个命令 | 插件没加载。检查 `node_modules\dsh-ag\` 目录名是否正确、profile 的 `package.json` 里 `dependencies` 和 `dsh.profile.bundles` 两处是否都登记了，然后重启。 |
| 模型列表里没有 ag中转站 | 同上；确认重启过 DSH。 |
| 对话时报「API 密钥无效」 | **多半不是密钥问题**。服务端对缺少识别头的请求回 401，而界面把 401 说成密钥无效。先输入 `/ag` 确认插件在挂载状态（请求头那行应该有 `originator`），再确认密钥是你自己的、粘贴时没有多余空格。 |
| 端点不可达 / 连接超时 | 本机连不上该地址。把 `cordis.patch.yml` 的 `proxy` 改成你本机代理地址（例如 `http://127.0.0.1:7890`），或换一个能直连的地址并把 `proxy` 设为 `''`；改完重启。 |
| 报 `402 Budget pool quota has been exhausted` | 账号额度用完，不是配置问题。 |
| 想换地址 / 模型 / 代理 | 改 `cordis.patch.yml`，或按上面的「改配置」在自己的 profile 层里覆盖；改完重启。 |
| 想先确认代码没被动过 | 仓库里的 `dsh-ag\test\plugin.test.mjs` 是离线自测（需要本机有 Node.js）：在插件目录里跑 `node test/plugin.test.mjs`，输出 `all plugin tests passed` 即正常。它不联网、不动你的设置。 |

---

## 升级 / 卸载

**升级**：下载新版本，重新跑一遍 `install.cmd`（或手动把 `node_modules\dsh-ag\` 换成新的、
再更新 `vendor\` 里的 tgz），重启。

**卸载**：

1. 先停用它 —— 在插件面板里关掉，或从 `dsh.profile.bundles` 里删掉 `dsh-ag`。
   这一步就会把路由和代理撤掉。
2. 删掉 `node_modules\dsh-ag\` 目录，删掉 `vendor\` 里的 tgz。
3. 从 `package.json` 的 `dependencies` 里删掉 `dsh-ag`。
4. 重启 DSH Desktop。

---

## 插件是怎么工作的

```
dsh-ag/
  index.js             插件本体：写路由、还原、/ag 状态命令、挂载/卸载
  proxy.js             按站走代理：只把本插件的域名交给本地代理，其余原样放行
  cordis.patch.yml     插件配置（地址、模型、代理、识别头）
  test/plugin.test.mjs 离线自测
install.ps1 / install.cmd   一键安装脚本
vendor/*.tgz           安装包本体
```

三件值得知道的事：

- **路由**：插件往 `llm-pi-ai` 设置段写一条 `providers.ag`，里面用 `apiKeyEnv` 指向凭据名，
  而不是写密钥本身。挂载时写入，卸载时按原样还原。
- **代理**：用 undici 的全局 dispatcher 实现。之所以不用 `NODE_USE_ENV_PROXY`，是因为那个环境变量是
  Node 启动前读取的，插件在运行时设置它没有任何效果。
- **挂载即开关**：插件的 `apply` 在挂载时写入，`ctx.effect` 的清理函数在卸载时撤掉——所以「插件面板里
  那一行开着还是关着」就是唯一的开关。

## 许可

`package.json` 里声明的是 MIT。
