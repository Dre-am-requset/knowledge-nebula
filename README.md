# Knowledge Nebula · 知识星云

把有出处的小知识组织成可拖动、可缩放、可点击的三维星云。

**每颗小星对应一条可阅读的知识。** 大星表示知识类别与主题；亮度表示阅读重要度。
放大星团后点击小星，阅读内容、来源与适用条件，并保存自己的笔记。

本项目的代码与自编演示资料采用 **MIT** 许可。默认数据包含 288 条教学示例、48 份自编资料、
8 篇总结和 8 步 Prompt 学习路线；不包含真实聊天或个人记录。

![知识星云演示界面：可拖动的三维星图与有出处的知识阅读区](docs/preview.png)

截图展示默认演示数据；实际运行时可以旋转、缩放和点击知识星。

## 快速开始

需要 Python **3.10+** 和支持 WebGL 的现代浏览器。应用使用 Python 标准库与 SQLite，
不需要 pip 安装、Node.js、MySQL、飞书登录、API Key 或云服务。

```sh
python -m nebula serve --demo
```

在浏览器打开 **http://127.0.0.1:8768/**。保持终端运行；按 Ctrl+C 停止。
`--demo` 只在没有导入数据的空库中初始化示例，不会在每次启动时重置笔记。

Windows 可双击 `start.cmd`；macOS/Linux 可运行 `sh start.sh`。
启动器输出网址，由你自行打开浏览器。

## 能做什么

- 透视三维星云；拖动旋转、平移、缩放，悬停预览，点击阅读，双击靠近。
- 真实知识点与同坐标光晕叠加成星云；没有拿随机装饰粒子充当知识。
- 类别 → 主题 → 小知识；按来源、日期、知识类型、阅读状态和关键词筛选。
- 收藏、待学、已读、已掌握、学习笔记和 Prompt 练习进度持久保存。
- 人工编辑、合并、拆分、隐藏与修订历史；导入更新保留这些个人记录。
- 来源变化或撤回后标为待复核；核对新原文后可以显式重新整理。
- 页面每 30 秒检查发布版本；导入后更新数据并保留当前三维视角。
- “缓慢巡航”由用户开启；页面隐藏时暂停，不追赶后台经过的时间。
- WebGL 不可用时仍能使用知识清单、主题列表和资料检索。

空间位置由稳定 ID 与主题生成，**星之间的距离不表示语义相似度**；关系线表示共享出处。
当前版本没有向量检索、模型调用或自动深度总结。主题和重要度来自导入字段，
离线聊天转换器只做明确标记的词项摘编。

## 导入自己的知识

在 `data/` 放你的私有导入文件。最小格式示例见 [`examples/minimal.json`](examples/minimal.json)。

```sh
python -m nebula import data/my-knowledge.json
python -m nebula status
python -m nebula serve
```

默认按稳定 ID 合并，重复导入更新相同记录，不增加重复副本。
`--replace` 将文件中缺少的既有来源和知识标为非当前记录；收藏、笔记与审计历史仍保留。
个人记录的知识可在“已隐藏”中查找。原来源的首次内容保留在 SQLite 的 `first_payload` 中。

```sh
# 用全量新快照替换当前来源清单；这不是清空个人记录。
python -m nebula import data/my-knowledge.json --replace
```

数据文件包含：

| 字段 | 内容 |
| --- | --- |
| `version` / `label` | 格式版本 1 与资料集名称 |
| `groups` | 来源 ID 与显示名称，既可以是笔记本，也可以是群或资料集 |
| `categories` | 大类 ID、名称、颜色；可选三维 `position: [x,y,z]` |
| `topics` | 主题 ID、名称和所属大类 |
| `sources` | 来源 ID、标题、正文、所属来源组、作者、时间、链接与 `withdrawn` 状态 |
| `atoms` | 小知识 ID、标题、摘要、正文、主题、类型、重要度与 `source_ids` |
| `cards` | 总结卡片的段落与出处；可为空 |
| `paths` | 学习路线、练习与检查题；可为空 |

IDs 需要稳定且在各自集合内唯一；知识与总结必须引用文件内的实际来源。
普通外部知识 ID 自动映射为稳定的 `a_` ID，之后可通过知识卡地址分享本机入口。
完整验证逻辑在 [`nebula/dataset.py`](nebula/dataset.py)。

自定义数据不需要学习路线或总结卡片，最小示例同样可以显示三维知识星。
更新来源后，人工正文会暂时隐藏并显示待复核；在编辑窗口填写核对后的正文、
勾选“已核对更新后的来源”再保存。已撤回来源不能通过这个勾选恢复为有效证据。

## 飞书 / Lark JSON 转换

提供一个**离线**转换器，读取你已经获得的消息 JSON：

```sh
python adapters/feishu_json.py data/messages.json --output data/feishu-knowledge.json
python -m nebula import data/feishu-knowledge.json
```

支持包含 `message_id` 的列表或嵌套 `data.items` 数据，以及普通 text/post 内容。
保存话题和根消息标识；短消息与非文字内容保留为资料，不强行生成知识星。
它不会登录、连接 Chrome、读取本机凭据、执行消息中的命令或调用模型；
不会自动抓取遗漏的回复。远端同步、文档权限和完整性由你的数据采集器处理。

MySQL、Markdown、其他聊天平台或模型摘编结果，都可通过转换成相同 JSON 接入。
原来的本机飞书 MySQL 服务和账号同步脚本不是这个公开演示的启动依赖。

## 架构

```text
笔记 / 文档 / 聊天导出 / 自有采集器
                 │
          version-1 JSON
                 │ 校验、按 ID 导入
                 ▼
SQLite ── 来源与知识 + 人工覆盖 + 学习记录 + 修订历史
                 │
        Python 本机 HTTP API
                 │
       Vanilla JS + Three.js
                 ▼
       三维星云 / 阅读 / 搜索 / 学习
```

Three.js **0.180.0** 与 OrbitControls 已随源码附带，运行时不访问 CDN。
`web/galaxy3d.js` 使用透视相机、WebGL、稳定布局、鼠标拾取和自定义 shader；
光晕与可点击知识点共享三维坐标。Python 服务仅监听 `127.0.0.1`；
当前版本是单用户本地应用，尚未提供公网部署所需的账号系统。

主要目录：

```text
nebula/      数据校验、SQLite、HTTP API、CLI、自编演示资料
web/         三维界面、阅读和学习界面、Three.js 及其许可
adapters/    离线消息 JSON 转换器
examples/    可公开的最小数据格式示例
tests/       导入、来源守卫、个人记录、事务与 HTTP 验证
data/        运行时数据库与私有导入文件，Git 忽略
```

## 开发与验证

```sh
python -m unittest discover -s tests -v
```

可换端口和数据库文件；`--db` 是全局参数，位于子命令前：

```sh
python -m nebula --db data/another.sqlite serve --demo --port 8770
```

没有遥测、外部模型调用或账号凭据依赖。所有源码中附带的例子均为项目自编资料。
仓库忽略本地数据库、日志和私有导出；软件的 MIT 许可不改变你导入资料原有的所有权与权限。

欢迎通过 Issue 提供可公开、可复现的最小样例，通过 PR 改进数据适配器、检索或三维交互。
请保持演示素材与本地私有数据分离，并为新增第三方资源附带对应许可。

打包可分享的源码包：

```sh
python tools/package_release.py
```

打包器采用显式源码文件清单，并检查账号标识、常见凭据和本机路径；
不会收录 `data/`、SQLite、个人笔记、日志、Git 元数据或聊天导出。
输出在 Git 忽略的 `dist/`，同时给出文件哈希清单。

## 许可

项目代码和自编示例：[`LICENSE`](LICENSE)，MIT。
Three.js：[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 与原始许可。
