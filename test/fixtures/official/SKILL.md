---
name: 通达信TQ-Local
version: 1.2.0（2026-09-20）
description: TdxQuant是由通达信软件提供的证券行情分析和量化投研平台。本Skill提供两种执行模式：模式A生成Python策略文件（tqcenter），模式B通过本地HTTP服务(127.0.0.1:17709)直连tqcenter接口，接口名与TQ平台一致。
---

# 通达信 TQ 量化数据接口（tq-local）

TdxQuant 是由通达信软件提供的证券行情分析和量化投研平台。本 Skill 提供两种执行模式：

- **模式 A：Python 策略文件** —— 用户要求“生成 py 文件 / 生成策略 / 编写回测脚本 / 要运行的策略代码”时使用。基于 `tqcenter`（`tq` 类）生成可运行的 Python 策略文件，在通达信客户端 TQ 策略环境中执行。
- **模式 B：HTTP 直连** —— 其余所有情况（查询行情/数据/板块/交易等，未要求生成文件）使用。通过向本机 HTTP 服务发送 JSON-RPC 请求直接获取数据，不生成 Python 文件。

两个模式的**接口名一致**（与 TQ 平台接口同名），仅调用方式不同。**出参字段统一见文末「附录」**，接口介绍中不再重复字段表。

> 官方文档：<https://help.tdx.com.cn/quant/>

---

## 模式选择规则（执行前必须先判断）

| 用户请求                                                    | 使用模式           |
| ------------------------------------------------------- | -------------- |
| 生成/编写/修改 Python 策略文件、回测脚本、公式调用脚本、需要 `tq.initialize` 的代码 | 模式 A           |
| 查询行情、K线、财务、板块、交易、下载数据等（未要求生成文件）                         | 模式 B           |
| 订阅实时行情（`subscribe_hq` 等）                                | 仅模式 A（需策略进程回调） |
| 云回测（`send_source` / `get_backtest_result`）              | 仅模式 B          |

---

## 执行前强制检查（两种模式通用，按顺序执行）

1. **操作系统**：仅支持 Windows（`platform.system() == "Windows"`），否则立即终止。
2. **通达信已安装**：用 `winreg` 检查注册表 `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\` 下的 `通达信金融终端64` / `通达信专业版` / `通达信金融终端(量化模拟)` / `通达信iTendx研究终端` / `通达信金融终端(测试)`，至少一个存在即视为已安装；未安装则提示用户从 `https://data.tdx.com.cn/level2/new_tdx64.exe` 下载安装。
3. **TdxW.exe 正在运行**：`tasklist | grep -i TdxW` 有结果；未运行则提示用户先启动通达信客户端并登录。
4. **HTTP 服务连通**：向 `http://127.0.0.1:17709/` 发送测试请求，返回正常 JSON-RPC 响应才可继续：

```bash
curl -s --connect-timeout 3 -X POST "http://127.0.0.1:17709/"   -H "Content-Type: application/json; charset=utf-8"   -d '{"id":1,"method":"get_match_stkinfo","params":{"key_word":"茅台"}}'
```

5. **模式 A 额外检查**：通达信安装目录 `PYPlugins\user\tqcenter.py` 存在。
6. **股票名解析（新增，必须遵守）**：用户请求中**凡涉及证券名称（而非代码）**，一律先调 `get_match_stkinfo(key_word=证券名)` 解析出代码，确认返回结果后再调用后续数据接口。**禁止凭名称猜测/臆断代码**（如把"通达信"当作指数或默认取上证指数），若 `get_match_stkinfo` 返回多个候选，选与名称最匹配的标的并在回复中说明所选代码；拿不准时询问用户确认。

---

## 模式 A：Python 策略文件方式（tqcenter）

> 用于“生成 py 文件 / 策略”。生成的文件由用户放入通达信 TQ 策略环境运行。

**标准接入代码（生成的策略文件开头必带）：**

```python
# -*- coding: utf-8 -*-
import sys
from pathlib import Path

# 将通达信安装目录的 PYPlugins\user 加入 sys.path
TDX_USER_DIR = Path(r"<通达信安装目录>\PYPlugins\user")
if str(TDX_USER_DIR) not in sys.path:
    sys.path.insert(0, str(TDX_USER_DIR))

from tqcenter import tq
```

**核心规则：**

- 所有策略开头调用 `tq.initialize(__file__)` 进行初始化，结束可调用 `tq.close()`。
- 接口统一用 `tq.<接口名>(...)` 调用，接口名与平台一致。
- 需要复权/周期等常量时，可使用 `tqconst`（如 `tqconst.PRICE_SJ`）。
- 行情订阅（`subscribe_hq` 等）只在策略进程中有效。
- 函数名 `"initialize"` 不可修改，每个策略必须有该函数；错误码 `ErrorId='12'` 表示已有同名策略运行（会打印警告但不报错），`ErrorId='6'`/`'7'` 表示连接断开（会自动触发重新初始化）。

---

## 模式 B：HTTP JSON-RPC 方式

> 直接向本机 HTTP 服务发请求取数，**不生成 Python 文件**；即使使用 Python，也只能作为通用 HTTP 客户端，不得导入或运行 `tqcenter`。

**请求地址：** `http://127.0.0.1:17709/`

**请求格式（JSON-RPC）：**

```json
{
  "id": 1,
  "method": "接口名",
  "params": {
    "参数名": "参数值"
  }
}
```

- `method` 为 TQ 平台原接口名（如 `get_market_data`），`params` 为原接口入参，不要加 `tq.` 前缀。
- 请求体必须是标准 JSON：字段与值之间用 `:`，字符串用双引号。
- 响应：成功结果在 `result`，错误在 `error`；底层接口通常返回 `result.ErrorId`（`"0"` 表示成功）与 `result.Value`。

**curl 示例：**

```bash
curl -s -X POST "http://127.0.0.1:17709/"   -H "Content-Type: application/json; charset=utf-8"   -d '{"id":1,"method":"get_market_data","params":{"stock_list":["688318.SH"],"count":5,"dividend_type":"none","period":"1d"}}'
```

**Python（仅作 HTTP 客户端）示例：**

```python
import json
import urllib.request

payload = {"id": 1, "method": "get_market_data",
           "params": {"stock_list": ["688318.SH"], "count": 5,
                      "dividend_type": "none", "period": "1d"}}
req = urllib.request.Request(
    "http://127.0.0.1:17709/",
    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    headers={"Content-Type": "application/json; charset=utf-8"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as resp:
    print(json.loads(resp.read().decode("utf-8")))
```

**大结果分页规则（模式 B）：** 以下接口可能分页返回，遇到分页标记必须续取并合并完整结果后再使用：

- `TPythPaged`：`result` 中有 `page_token`/`page_data`/`has_more`/`next_page_offset`（另有 `page_offset` 供校验），保持原 `method`，按游标依次传 `_tpyth_page_token`、`_tpyth_page_offset`（`next_page_offset` 的字符串值）续取，直到 `has_more=false`。
- `KlinePaged`（`get_market_data`）：一页解析后若 `result.has_more` 为 `true`，用相同参数 + `result.next_stock_page_index` 重调，合并各页 `Value` 直到 `has_more=false`。
- `ProDataPaged`（专业数据接口）：按 `result.stock_page_index` 从 `0` 到 `stock_total_pages-1` 依次调用并合并 `Value`。

分页缓存仅在当前进程内暂存，续取失败时重新发起原始请求，不得把不完整结果当完整数据。

**股票名/代码补全规则（模式 A/B 通用）：**

- **用户只给股票名时，先调 `get_match_stkinfo(key_word=股票名)` 查代码，再调后续接口（强制，不可跳过）。**
- 返回只有代码、但展示需要名称时，用代码调 `get_stock_info` 补名称；不要凭记忆/前缀猜名称。
- 多只股票需要补名时，只对最终展示的股票调用，避免逐只全量查询。
- **禁止凭名称猜测代码**：例如用户说"通达信"必须查 `get_match_stkinfo("通达信")`（结果为 688318.SH 财富趋势），不得默认取上证指数或其他标的。

**交易账号规则（模式 A/B 通用）：**

- 未指定账号时，交易接口 `account_id` 默认传 `0`，不要先调 `stock_account`。
- 用户明确给出账号与账号类型（如“账号 1190306953, STOCK 账户”）时，流程为：`stock_account` → 用返回的 `result.Value` 作为 `account_id` → `query_stock_*` / `order_stock` / `cancel_order_stock`。

---

## 公共约定

### 股票代码格式

| 市场      | 格式                                                    |
| ------- | ----------------------------------------------------- |
| 上交所     | `600000.SH`                                           |
| 深交所     | `000001.SZ`                                           |
| 北交所     | `430047.BJ`                                           |
| 港股      | `00700.HK`                                            |
| 美股      | `AAPL.US`                                             |
| 新三板     | `430047.NQ`                                           |
| 股票期权    | `10004073.SZO` / `10004073.SHO`                       |
| 国内期货    | `代码.CFF` / `.SHF` / `.DCE` / `.CZC` / `.INE` / `.GFE` |
| 中证指数    | `000300.CSI`                                          |
| 开放式基金净值 | `代码.OF`                                               |

### 时间格式

- 仅日期：`YYYYMMDD`（如 `20260605`）
- 含时间：`YYYYMMDDHHMMSS`（如 `20260605150000`）

### K 线周期 `period`

| 值            | 说明             |
| ------------ | -------------- |
| `1m`         | 1 分钟           |
| `5m`         | 5 分钟           |
| `15m`        | 15 分钟          |
| `30m`        | 30 分钟          |
| `1h` / `60m` | 60 分钟          |
| `1d`         | 日线             |
| `1w`         | 周线             |
| `1mon`       | 月线             |
| `1q`         | 季线             |
| `1y`         | 年线             |
| `tick`       | 分笔（仅模式 A 部分场景） |

### 复权类型 `dividend_type`

| 值               | 说明  |
| --------------- | --- |
| `none`          | 不复权 |
| `front` / `qfq` | 前复权 |
| `back` / `hfq`  | 后复权 |

### 委托类型 `order_type` 常用值

| 中文            | 数值                      | 说明     |
| ------------- | ----------------------- | ------ |
| 买入 / 卖出       | `0` / `1`               | 普通股票买卖 |
| 融资买入 / 融券卖出   | `69` / `70`             | 信用账户   |
| 买券还券 / 卖券还款   | `71` / `76`             | 信用账户   |
| 基金申购 / 基金赎回   | `45` / `46`             | ETF    |
| 期货开多/开空/平多/平空 | `101`/`102`/`103`/`104` | 期货     |
| 期权开多/开空/平多/平空 | `201`/`202`/`203`/`204` | 期权     |

### 报价类型 `price_type`

| 中文         | 数值  | 说明            |
| ---------- | --- | ------------- |
| 自填价 / 限价   | `0` | 使用 `price` 参数 |
| 市价         | `1` | 市价委托          |
| 涨停价 / 笼子上限 | `2` | —             |
| 跌停价 / 笼子下限 | `3` | —             |

---

## 接口目录

> 每个接口给出：**参数说明 + 两种模式的调用模板**。出参字段统一见文末「附录」，接口介绍不再重复字段表。
>   
> 参数模板中的 `<值>` 为占位符，调用时替换为实际参数。

### 行情与基础信息

#### `get_market_data`

**参数说明：**

| 参数            | 必填 | 类型        | 说明                                                                            |
| ------------- | -- | --------- | ----------------------------------------------------------------------------- |
| field_list    | N  | List[str] | 需返回的字段列表；空列表返回所有字段                                                            |
| stock_list    | Y  | List[str] | 股票代码列表                                                                        |
| period        | Y  | str       | K线周期，如 `1m`, `5m`, `15m`, `30m`, `60m`/`1h`, `1d`, `1w`, `1mon`, `1q`, `1y` |
| start_time    | N  | str       | 开始时间，常用 `YYYYMMDD` 或 `YYYY-MM-DD`                                             |
| end_time      | N  | str       | 结束时间；未传则默认当前时间                                                                |
| count         | N  | int       | `count>0`：取截止 `end_time` 最近 n 条；`count<=0`：使用 `start_time/end_time` 区间        |
| dividend_type | N  | str       | 复权类型：`none` 不复权、`front`/`qfq` 前复权、`back`/`hfq` 后复权                            |
| fill_data     | N  | bool      | 是否向前填充缺失数据，默认 `True`                                                          |

> **完整大结果：** 此接口支持 `TPythPaged` 和 `KlinePaged`。出现分页标记时，严格按“大结果分页规则”续取并合并所有股票页和底层分片后再使用结果。

> **注意：** `count>0` 时 `start_time` 失效，`end_time` 未传默认当前时间；后复权数据与取的数据个数有关，只在返回的数据中进行后复权；`dividend_type=None`（Python `None`，非字符串）时默认不复权。

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_market_data(
        field_list=<值>,
        stock_list=<值>,
        period=<值>,
        start_time=<值>,
        end_time=<值>,
        count=<值>,
        dividend_type=<值>,
        fill_data=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_market_data", "params": {"field_list": <值>, "stock_list": <值>, "period": <值>, "start_time": <值>, "end_time": <值>, "count": <值>, "dividend_type": <值>, "fill_data": <值>}}
```

**出参字段：** 见文末「附录 A」。

---

#### `get_market_snapshot`

**参数说明：**

| 参数         | 必填 | 类型        | 说明                 |
| ---------- | -- | --------- | ------------------ |
| stock_code | Y  | str       | 单只证券代码             |
| field_list | N  | List[str] | 指定返回字段；空列表返回所有可用字段 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_market_snapshot(
        stock_code=<值>,
        field_list=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_market_snapshot", "params": {"stock_code": <值>, "field_list": <值>}}
```

**出参字段：** 见文末「附录 A」。

---

#### `get_stock_info`

**参数说明：**

| 参数         | 必填 | 类型        | 说明                 |
| ---------- | -- | --------- | ------------------ |
| stock_code | Y  | str       | 单只证券代码             |
| field_list | N  | List[str] | 指定返回字段；**不能为空，必须明确指定字段列表** |

**注意：** `field_list` 不能为空，必须明确指定字段列表。

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_stock_info(
        stock_code=<值>,
        field_list=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_stock_info", "params": {"stock_code": <值>, "field_list": <值>}}
```

**出参字段：** 见文末「附录 B」。

---

#### `get_more_info`

**参数说明：**

| 参数         | 必填 | 类型        | 说明     |
| ---------- | -- | --------- | ------ |
| stock_code | Y  | str       | 证券代码   |
| field_list | N  | List[str] | 指定返回字段 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_more_info(
        stock_code=<值>,
        field_list=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_more_info", "params": {"stock_code": <值>, "field_list": <值>}}
```

**出参字段：** 见文末「附录 B」。

---

#### `get_relation`

**参数说明：**

| 参数         | 必填 | 类型  | 说明   |
| ---------- | -- | --- | ---- |
| stock_code | Y  | str | 证券代码 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_relation(
        stock_code=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_relation", "params": {"stock_code": <值>}}
```

**出参字段：** 见文末「附录 C」。

---

#### `get_divid_factors`

**参数说明：**

| 参数         | 必填 | 类型  | 说明   |
| ---------- | -- | --- | ---- |
| stock_code | Y  | str | 股票代码 |
| start_time | N  | str | 开始日期 |
| end_time   | N  | str | 结束日期 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_divid_factors(
        stock_code=<值>,
        start_time=<值>,
        end_time=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_divid_factors", "params": {"stock_code": <值>, "start_time": <值>, "end_time": <值>}}
```

**出参字段：** 见文末「附录 D」。

---

#### `get_gb_info`

**参数说明：**

| 参数         | 必填 | 类型        | 说明                          |
| ---------- | -- | --------- | --------------------------- |
| stock_code | Y  | str       | 股票代码                        |
| date_list  | Y  | List[str] | 日期列表，通常为 `YYYYMMDD`，按从小到大排序 |
| count      | Y  | int       | 需要获取的日期数量                   |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_gb_info(
        stock_code=<值>,
        date_list=<值>,
        count=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_gb_info", "params": {"stock_code": <值>, "date_list": <值>, "count": <值>}}
```

**出参字段：** 见文末「附录 D」。

---

#### `get_gb_info_by_date`

**参数说明：**

| 参数         | 必填 | 类型  | 说明   |
| ---------- | -- | --- | ---- |
| stock_code | Y  | str | 股票代码 |
| start_date | Y  | str | 开始日期 |
| end_date   | Y  | str | 结束日期 |

**官方注：** 须通过客户端或 `refresh_kline` 下载对应股票的日K线数据。

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_gb_info_by_date(
        stock_code=<值>,
        start_date=<值>,
        end_date=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_gb_info_by_date", "params": {"stock_code": <值>, "start_date": <值>, "end_date": <值>}}
```

**出参字段：** 见文末「附录 D」。

---

#### `get_kzz_info`

**参数说明：**

| 参数         | 必填 | 类型        | 说明                    |
| ---------- | -- | --------- | --------------------- |
| stock_code | N  | str       | 可转债或正股代码；空表示按底层默认范围返回 |
| field_list | N  | List[str] | 指定返回字段                |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_kzz_info(
        stock_code=<值>,
        field_list=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_kzz_info", "params": {"stock_code": <值>, "field_list": <值>}}
```

**出参字段：** 见文末「附录 D」。

---

#### `get_trackzs_etf_info`

**参数说明：**

| 参数      | 必填 | 类型  | 说明                  |
| ------- | -- | --- | ------------------- |
| zs_code | Y  | str | 指数代码，如 `000300.CSI` |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_trackzs_etf_info(
        zs_code=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_trackzs_etf_info", "params": {"zs_code": <值>}}
```

**出参字段：** 见文末「附录 D」。

---

#### `get_ipo_info`

**参数说明：**

| 参数       | 必填 | 类型  | 说明                         |
| -------- | -- | --- | -------------------------- |
| ipo_type | N  | int | `0` 新股申购；`1` 新发债；`2` 两者都返回 |
| ipo_date | N  | int | `0` 只返回今天；`1` 今天及以后        |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_ipo_info(
        ipo_type=<值>,
        ipo_date=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_ipo_info", "params": {"ipo_type": <值>, "ipo_date": <值>}}
```

**出参字段：** 见文末「附录 D」。

---

#### `get_pricevol`

**参数说明：**

| 参数         | 必填 | 类型        | 说明     |
| ---------- | -- | --------- | ------ |
| stock_list | Y  | List[str] | 股票代码列表 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_pricevol(
        stock_list=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_pricevol", "params": {"stock_list": <值>}}
```

**出参字段：** 见文末「附录 D」。

---

#### `get_match_stkinfo`

**参数说明：**

| 参数       | 必填 | 类型  | 说明                      |
| -------- | -- | --- | ----------------------- |
| key_word | Y  | str | 查询关键字；用户输入股票名时把股票名填入此参数 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_match_stkinfo(
        key_word=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_match_stkinfo", "params": {"key_word": <值>}}
```

**出参字段：** 见文末「附录 B」。

---

#### `get_exday_data`

**参数说明：**

| 参数         | 必填 | 类型  | 说明              |
| ---------- | -- | --- | --------------- |
| stock_code | Y  | str | 股票代码            |
| count      | N  | int | 返回最近记录数量，默认 `1` |

> 调用前会刷新对应市场数据。

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_exday_data(
        stock_code=<值>,
        count=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_exday_data", "params": {"stock_code": <值>, "count": <值>}}
```

**出参字段：** 见文末「附录 D」。

---

#### `get_zdt_data`

**参数说明：**

| 参数         | 必填 | 类型        | 说明     |
| ---------- | -- | --------- | ------ |
| stock_list | Y  | List[str] | 股票代码列表 |

> 调用前会刷新每只证券所属市场数据。
>
> **官方注：** 此函数需要通达信客户端有短线宝权限（普及增强版、财富版、专业版等）。

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_zdt_data(
        stock_list=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_zdt_data", "params": {"stock_list": <值>}}
```

**出参字段：** 见文末「附录 D」。

---

### 批量接口

> 批量接口统一返回「每代码一条记录」`{代码: {字段...}}`；传 `return_df=True` 时返回以代码为索引的 `DataFrame`（行=代码，列=字段）。
>
> **注意：** 本节的 `return_df` 依赖 pandas，`tqcenter` 对 pandas 与 numpy 为**硬依赖**（非可选），环境未安装时模块无法加载。

#### `get_market_snapshot_batch`

**参数说明：**

| 参数           | 必填 | 类型          | 说明                        |
| ------------ | -- | ----------- | ------------------------- |
| stock_list   | Y  | List[str]   | 证券代码列表                    |
| field_list   | N  | List[str]   | 为空返回全部字段                  |
| return_df    | N  | bool        | `True` 时返回以代码为索引的 DataFrame |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_market_snapshot_batch(
        stock_list=<值>,
        field_list=<值>,
        return_df=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_market_snapshot_batch", "params": {"stock_list": <值>, "field_list": <值>, "return_df": <值>}}
```

**出参字段：** 同 `get_market_snapshot`，见文末「附录 A」。

---

#### `get_stock_info_batch`

**参数说明：**

| 参数           | 必填 | 类型          | 说明                        |
| ------------ | -- | ----------- | ------------------------- |
| stock_list   | Y  | List[str]   | 证券代码列表                    |
| field_list   | N  | List[str]   | 为空返回全部字段                  |
| return_df    | N  | bool        | `True` 时返回以代码为索引的 DataFrame |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_stock_info_batch(
        stock_list=<值>,
        field_list=<值>,
        return_df=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_stock_info_batch", "params": {"stock_list": <值>, "field_list": <值>, "return_df": <值>}}
```

**出参字段：** 同 `get_stock_info`，见文末「附录 B」。

---

#### `get_more_info_batch`

**参数说明：**

| 参数           | 必填 | 类型          | 说明                        |
| ------------ | -- | ----------- | ------------------------- |
| stock_list   | Y  | List[str]   | 证券代码列表                    |
| field_list   | N  | List[str]   | 为空返回全部字段                  |
| return_df    | N  | bool        | `True` 时返回以代码为索引的 DataFrame |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_more_info_batch(
        stock_list=<值>,
        field_list=<值>,
        return_df=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_more_info_batch", "params": {"stock_list": <值>, "field_list": <值>, "return_df": <值>}}
```

**出参字段：** 同 `get_more_info`，见文末「附录 B」。

---

#### `get_kzz_info_batch`

**参数说明：**

| 参数           | 必填 | 类型          | 说明                        |
| ------------ | -- | ----------- | ------------------------- |
| stock_list   | Y  | List[str]   | 可转债代码列表                   |
| field_list   | N  | List[str]   | 为空返回全部字段                  |
| return_df    | N  | bool        | `True` 时返回以代码为索引的 DataFrame |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_kzz_info_batch(
        stock_list=<值>,
        field_list=<值>,
        return_df=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_kzz_info_batch", "params": {"stock_list": <值>, "field_list": <值>, "return_df": <值>}}
```

**出参字段：** 同 `get_kzz_info`，见文末「附录 D」。

---

### 专业数据

#### `get_financial_data`

**参数说明：**

| 参数          | 必填 | 类型        | 说明                          |
| ----------- | -- | --------- | --------------------------- |
| stock_list  | Y  | List[str] | 股票代码列表                      |
| field_list  | Y  | List[str] | 专业财务字段列表                    |
| start_time  | N  | str       | 开始日期                        |
| end_time    | N  | str       | 结束日期                        |
| report_type | N  | str       | `announce_time`, `tag_time` |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_financial_data(
        stock_list=<值>,
        field_list=<值>,
        start_time=<值>,
        end_time=<值>,
        report_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_financial_data", "params": {"stock_list": <值>, "field_list": <值>, "start_time": <值>, "end_time": <值>, "report_type": <值>}}
```

**出参字段：** 见文末「附录 F」。

---

#### `get_financial_data_by_date`

**参数说明：**

| 参数         | 必填 | 类型        | 说明                                            |
| ---------- | -- | --------- | --------------------------------------------- |
| stock_list | Y  | List[str] | 股票代码列表                                        |
| field_list | Y  | List[str] | 专业财务字段列表                                      |
| year       | N  | int       | 年份；`0` 表示最新                                   |
| mmdd       | N  | int       | 报告期月日，如 `331`, `630`, `930`, `1231`; `0` 表示最新 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_financial_data_by_date(
        stock_list=<值>,
        field_list=<值>,
        year=<值>,
        mmdd=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_financial_data_by_date", "params": {"stock_list": <值>, "field_list": <值>, "year": <值>, "mmdd": <值>}}
```

**出参字段：** 见文末「附录 F」。

---

#### `get_gpjy_value`

**参数说明：**

| 参数         | 必填 | 类型        | 说明       |
| ---------- | -- | --------- | -------- |
| stock_list | Y  | List[str] | 股票代码列表   |
| field_list | Y  | List[str] | 专业数据字段列表 |
| start_time | N  | str       | 开始日期     |
| end_time   | N  | str       | 结束日期     |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_gpjy_value(
        stock_list=<值>,
        field_list=<值>,
        start_time=<值>,
        end_time=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_gpjy_value", "params": {"stock_list": <值>, "field_list": <值>, "start_time": <值>, "end_time": <值>}}
```

**出参字段：** 见文末「附录 G」。

---

#### `get_gpjy_value_by_date`

**参数说明：**

| 参数         | 必填 | 类型        | 说明          |
| ---------- | -- | --------- | ----------- |
| stock_list | Y  | List[str] | 股票代码列表      |
| field_list | Y  | List[str] | 专业数据字段列表    |
| year       | N  | int       | 年份；`0` 表示最新 |
| mmdd       | N  | int       | 月日；`0` 表示最新 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_gpjy_value_by_date(
        stock_list=<值>,
        field_list=<值>,
        year=<值>,
        mmdd=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_gpjy_value_by_date", "params": {"stock_list": <值>, "field_list": <值>, "year": <值>, "mmdd": <值>}}
```

**出参字段：** 见文末「附录 G」。

---

#### `get_bkjy_value`

**参数说明：**

| 参数         | 必填 | 类型        | 说明       |
| ---------- | -- | --------- | -------- |
| stock_list | Y  | List[str] | 板块代码列表   |
| field_list | Y  | List[str] | 专业数据字段列表 |
| start_time | N  | str       | 开始日期     |
| end_time   | N  | str       | 结束日期     |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_bkjy_value(
        stock_list=<值>,
        field_list=<值>,
        start_time=<值>,
        end_time=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_bkjy_value", "params": {"stock_list": <值>, "field_list": <值>, "start_time": <值>, "end_time": <值>}}
```

**出参字段：** 见文末「附录 H」。

---

#### `get_bkjy_value_by_date`

**参数说明：**

| 参数         | 必填 | 类型        | 说明          |
| ---------- | -- | --------- | ----------- |
| stock_list | Y  | List[str] | 板块代码列表      |
| field_list | Y  | List[str] | 专业数据字段列表    |
| year       | N  | int       | 年份；`0` 表示最新 |
| mmdd       | N  | int       | 月日；`0` 表示最新 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_bkjy_value_by_date(
        stock_list=<值>,
        field_list=<值>,
        year=<值>,
        mmdd=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_bkjy_value_by_date", "params": {"stock_list": <值>, "field_list": <值>, "year": <值>, "mmdd": <值>}}
```

**出参字段：** 见文末「附录 H」。

---

#### `get_scjy_value`

**参数说明：**

| 参数         | 必填 | 类型        | 说明         |
| ---------- | -- | --------- | ---------- |
| field_list | Y  | List[str] | 市场专业数据字段列表 |
| start_time | N  | str       | 开始日期       |
| end_time   | N  | str       | 结束日期       |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_scjy_value(
        field_list=<值>,
        start_time=<值>,
        end_time=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_scjy_value", "params": {"field_list": <值>, "start_time": <值>, "end_time": <值>}}
```

**出参字段：** 见文末「附录 I」。

---

#### `get_scjy_value_by_date`

**参数说明：**

| 参数         | 必填 | 类型        | 说明          |
| ---------- | -- | --------- | ----------- |
| field_list | Y  | List[str] | 市场专业数据字段列表  |
| year       | N  | int       | 年份；`0` 表示最新 |
| mmdd       | N  | int       | 月日；`0` 表示最新 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_scjy_value_by_date(
        field_list=<值>,
        year=<值>,
        mmdd=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_scjy_value_by_date", "params": {"field_list": <值>, "year": <值>, "mmdd": <值>}}
```

**出参字段：** 见文末「附录 I」。

---

#### `get_gp_one_data`

**参数说明：**

| 参数         | 必填 | 类型        | 说明       |
| ---------- | -- | --------- | -------- |
| stock_list | Y  | List[str] | 股票代码列表   |
| field_list | Y  | List[str] | 专业数据字段列表 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_gp_one_data(
        stock_list=<值>,
        field_list=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_gp_one_data", "params": {"stock_list": <值>, "field_list": <值>}}
```

**出参字段：** 见文末「附录 J」。

---

### 列表、板块与交易日

#### `get_stock_list`

**参数说明：**

| 参数        | 必填 | 类型  | 说明                      |
| --------- | -- | --- | ----------------------- |
| market    | N  | str | 市场或系统分类；常用 `5` 获取全部 A 股 |
| list_type | N  | int | `0` 只返回代码；`1` 返回代码和名称   |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_stock_list(
        market=<值>,
        list_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_stock_list", "params": {"market": <值>, "list_type": <值>}}
```

**出参字段：** 见文末「附录 C」。

---

#### `get_sector_list`

**参数说明：**

| 参数        | 必填 | 类型  | 说明     |
| --------- | -- | --- | ------ |
| list_type | N  | int | 板块分类类型 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_sector_list(
        list_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_sector_list", "params": {"list_type": <值>}}
```

**出参字段：** 见文末「附录 C」。

---

#### `get_stock_list_in_sector`

**参数说明：**

| 参数         | 必填 | 类型  | 说明                   |
| ---------- | -- | --- | -------------------- |
| block_code | Y  | str | 板块代码或板块名称            |
| block_type | N  | int | 板块类型，默认 `0`          |
| list_type  | N  | int | `0` 返回代码；`1` 返回代码和名称 |

**官方注意：** 入参板块只能是自定义板块或 15 个板块指数，**不支持**"全部A股""沪深A股"等系统板块。

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_stock_list_in_sector(
        block_code=<值>,
        block_type=<值>,
        list_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_stock_list_in_sector", "params": {"block_code": <值>, "block_type": <值>, "list_type": <值>}}
```

**出参字段：** 见文末「附录 C」。

---

#### `get_user_sector`

**参数说明：**

| 参数 | 必填 | 类型 | 说明    |
| -- | -- | -- | ----- |
| 无  | N  | -  | 不需要参数 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_user_sector()
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_user_sector"}
```

**出参字段：** 见文末「附录 C」。

---

#### `create_sector`

**参数说明：**

| 参数         | 必填 | 类型  | 说明     |
| ---------- | -- | --- | ------ |
| block_code | Y  | str | 板块简称   |
| block_name | Y  | str | 板块显示名称 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.create_sector(
        block_code=<值>,
        block_name=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "create_sector", "params": {"block_code": <值>, "block_name": <值>}}
```

**出参字段：** 见文末「附录 C」。

---

#### `delete_sector`

**参数说明：**

| 参数         | 必填 | 类型  | 说明   |
| ---------- | -- | --- | ---- |
| block_code | Y  | str | 板块简称 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.delete_sector(
        block_code=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "delete_sector", "params": {"block_code": <值>}}
```

**出参字段：** 见文末「附录 C」。

---

#### `rename_sector`

**参数说明：**

| 参数         | 必填 | 类型  | 说明      |
| ---------- | -- | --- | ------- |
| block_code | Y  | str | 板块简称    |
| block_name | Y  | str | 新板块显示名称 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.rename_sector(
        block_code=<值>,
        block_name=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "rename_sector", "params": {"block_code": <值>, "block_name": <值>}}
```

**出参字段：** 见文末「附录 C」。

---

#### `clear_sector`

**参数说明：**

| 参数         | 必填 | 类型  | 说明   |
| ---------- | -- | --- | ---- |
| block_code | Y  | str | 板块简称 |

> **完整大结果：** 本节全部接口均支持 `TPythPaged` 和 `ProDataPaged`。出现分页标记时，严格按“大结果分页规则”续取所有底层分片和股票页，并合并全部 `Value` 后再使用或回复用户。

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.clear_sector(
        block_code=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "clear_sector", "params": {"block_code": <值>}}
```

**出参字段：** 见文末「附录 C」。

---

#### `get_trading_dates`

**参数说明：**

| 参数         | 必填 | 类型  | 说明   |
| ---------- | -- | --- | ---- |
| market     | Y  | str | 市场代码 |
| start_time | Y  | str | 开始日期 |
| end_time   | Y  | str | 结束日期 |
| count      | N  | int | 返回数量 |

> **需要先在客户端下载上证指数（999999）的盘后数据，目前仅支持 A 股。**

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_trading_dates(
        market=<值>,
        start_time=<值>,
        end_time=<值>,
        count=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_trading_dates", "params": {"market": <值>, "start_time": <值>, "end_time": <值>, "count": <值>}}
```

**出参字段：** 见文末「附录 C」。

---

#### `get_trading_calendar`

**参数说明：**

| 参数         | 必填 | 类型  | 说明   |
| ---------- | -- | --- | ---- |
| market     | Y  | str | 市场代码 |
| start_time | Y  | str | 开始日期 |
| end_time   | Y  | str | 结束日期 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_trading_calendar(
        market=<值>,
        start_time=<值>,
        end_time=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_trading_calendar", "params": {"market": <值>, "start_time": <值>, "end_time": <值>}}
```

**出参字段：** 见文末「附录 C」。

---

### 行情订阅（仅模式 A：py 策略文件）

#### `subscribe_hq`

**参数说明：**

| 参数         | 必填 | 类型        | 说明               |
| ---------- | -- | --------- | ---------------- |
| stock_list | Y  | List[str] | 待订阅股票代码列表        |
| callback   | N  | callable  | 行情回调函数（仅模式 A 使用） |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.subscribe_hq(stock_list=<股票列表>, callback=<回调函数>)
```

> 此接口**仅支持模式 A**（需生成/运行 Python 策略文件）。

**出参字段：** 见文末「附录 K」。

---

#### `unsubscribe_hq`

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.unsubscribe_hq(stock_list=<股票列表>)
```

> 此接口**仅支持模式 A**（需生成/运行 Python 策略文件）。

**出参字段：** 见文末「附录 K」。

---

#### `get_subscribe_hq_stock_list`

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_subscribe_hq_stock_list()
```

> 此接口**仅支持模式 A**（需生成/运行 Python 策略文件）。

**出参字段：** 见文末「附录 K」。

---

### 刷新与下载

#### `refresh_cache`

**参数说明：**

| 参数     | 必填 | 类型   | 说明                        |
| ------ | -- | ---- | ------------------------- |
| market | N  | str  | 市场范围，默认 `AG`              |
| force  | N  | bool | 是否强制刷新；`False` 时可能因间隔不足跳过 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.refresh_cache(
        market=<值>,
        force=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "refresh_cache", "params": {"market": <值>, "force": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `refresh_kline`

**参数说明：**

| 参数         | 必填 | 类型        | 说明                                                  |
| ---------- | -- | --------- | --------------------------------------------------- |
| stock_list | Y  | List[str] | 需要刷新的股票代码列表,一次最多一百条                                 |
| period     | Y  | str       | K 线周期，1d为日线、1m为一分钟线、5m为五分钟线，只支持这三种，其它周期的数据均由这三种数据生成 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.refresh_kline(
        stock_list=<值>,
        period=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "refresh_kline", "params": {"stock_list": <值>, "period": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `download_file`

**参数说明：**

| 参数         | 必填 | 类型  | 说明                                                                              |
| ---------- | -- | --- | ------------------------------------------------------------------------------- |
| stock_code | N  | str | down_type=1,5,6 时为 A 股代码; down_type=2 时为 ETF 代码; down_type=3,4 时无效              |
| down_time  | N  | str | down_type=1,5 时为年份 (`YYYY`); down_type=2 时为日期 (`YYYYMMDD`); down_type=3,4,6 时无效 |
| down_type  | N  | int | 下载类型，默认 `1`                                                                     |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.download_file(
        stock_code=<值>,
        down_time=<值>,
        down_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "download_file", "params": {"stock_code": <值>, "down_time": <值>, "down_type": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

### 客户端交互

#### `send_message`

**参数说明：**

| 参数      | 必填 | 类型  | 说明   |
| ------- | -- | --- | ---- |
| msg_str | Y  | str | 消息文本 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.send_message(
        msg_str=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "send_message", "params": {"msg_str": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `send_file`

**参数说明：**

| 参数        | 必填 | 类型  | 说明     |
| --------- | -- | --- | ------ |
| file_path | Y  | str | 本机文件路径 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.send_file(
        file_path=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "send_file", "params": {"file_path": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `send_warn`

**参数说明：**

| 参数             | 必填 | 类型        | 说明                    |
| -------------- | -- | --------- | --------------------- |
| stock_list     | Y  | List[str] | 股票代码列表                |
| time_list      | Y  | List[str] | 时间列表                  |
| price_list     | Y  | List[str] | 价格列表                  |
| close_list     | N  | List[str] | 收盘价列表                 |
| volum_list     | N  | List[str] | 成交量列表，沿用 tqcenter 参数名 |
| bs_flag_list   | N  | List[str] | 买卖标志列表                |
| warn_type_list | N  | List[str] | 预警类型列表                |
| reason_list    | N  | List[str] | 预警原因列表                |
| count          | Y  | int       | 记录数量                  |

**注意：** `price_list`、`close_list`、`volum_list` 中的元素必须为纯数字字符串；`bs_flag_list` 可以传空字符串 `''`（等同于 `'2'`）。

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.send_warn(
        stock_list=<值>,
        time_list=<值>,
        price_list=<值>,
        close_list=<值>,
        volum_list=<值>,
        bs_flag_list=<值>,
        warn_type_list=<值>,
        reason_list=<值>,
        count=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "send_warn", "params": {"stock_list": <值>, "time_list": <值>, "price_list": <值>, "close_list": <值>, "volum_list": <值>, "bs_flag_list": <值>, "warn_type_list": <值>, "reason_list": <值>, "count": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `send_bt_data`

**参数说明：**

| 参数         | 必填 | 类型              | 说明       |
| ---------- | -- | --------------- | -------- |
| stock_code | Y  | str             | 股票代码     |
| time_list  | Y  | List[str]       | 时间列表     |
| data_list  | Y  | List[List[str]] | 回测数据二维列表 |
| count      | Y  | int             | 记录数量     |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.send_bt_data(
        stock_code=<值>,
        time_list=<值>,
        data_list=<值>,
        count=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "send_bt_data", "params": {"stock_code": <值>, "time_list": <值>, "data_list": <值>, "count": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `send_user_block`

**参数说明：**

| 参数         | 必填 | 类型        | 说明        |
| ---------- | -- | --------- | --------- |
| block_code | Y  | str       | 用户板块代码/简称 |
| stock_list | Y  | List[str] | 股票代码列表    |
| show       | N  | bool      | 是否在通达信中显示 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.send_user_block(
        block_code=<值>,
        stock_list=<值>,
        show=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "send_user_block", "params": {"block_code": <值>, "stock_list": <值>, "show": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `exec_to_tdx`

**参数说明：**

| 参数          | 必填                                                                                                                  | 类型  | 说明                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | --- | ------------------ |
| url         | Y                                                                                                                   | str | 通达信可识别的 URL 或命令字符串 |
| 功能串         | 说明和示例                                                                                                               |     |                    |
| :-----      | :-------                                                                                                            |     |                    |
| inhttp      | 内部打开 比如：<http://www.treeid/inhttp://>.......                                                                        |     |                    |
| dlghttp     | 内部对话框打开 比如： <http://www.treeid/dlghttp://.......\&tdxmyietitle=标题\&tdxmyiewidth=500\&tdxmyieheight=300\&noborder=0> |     |                    |
| localurl    | 内部打开(非对话框) 比如：<http://www.treeid/localurlc:\pa\tips.html>.......                                                    |     |                    |
| dlglocalurl | 内部打开(对话框) 比如：<http://www.treeid/dlglocalurlc:\pa\tips.mht>.......                                                   |     |                    |
| code\_      | 进入某只股票(只传入代码)                                                                                                       |     |                    |
| breed\_     | 到某个品种(可以传入市场和代码,如果不清楚市场,在代码前加-即可进行模糊处理), 比如到财富趋势 <http://www.treeid/breed_1#688318> 市场：0#为深市 1#为沪市 2#为京市            |     |                    |
| zb\_        | 指标公式 比如：<http://www.treeid/zb_MACD>                                                                                 |     |                    |
| exp\_       | 专家系统公式                                                                                                              |     |                    |
| padcode\_   | 进入用户定制版面,后面是版面简称                                                                                                    |     |                    |
| ZXG         | 自选股列表                                                                                                               |     |                    |
| ETF         | ETF基金                                                                                                               |     |                    |
| HK          | 显示港股                                                                                                                |     |                    |
| QH          | 显示期货                                                                                                                |     |                    |
| MAINQH      | 显示为主力期货合约                                                                                                           |     |                    |
| SORT67      | 排行(67)                                                                                                              |     |                    |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.exec_to_tdx(
        url=<值>,
        inhttp=<值>,
        dlghttp=<值>,
        localurl=<值>,
        dlglocalurl=<值>,
        code_=<值>,
        breed_=<值>,
        zb_=<值>,
        exp_=<值>,
        padcode_=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "exec_to_tdx", "params": {"url": <值>, "inhttp": <值>, "dlghttp": <值>, "localurl": <值>, "dlglocalurl": <值>, "code_": <值>, "breed_": <值>, "zb_": <值>, "exp_": <值>, "padcode_": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `print_to_tdx`

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.print_to_tdx()
```

> 此接口**仅支持模式 A**（需生成/运行 Python 策略文件）。

**出参字段：** 见文末「附录 K」。

---

#### `send_source`

**参数说明：**

| 参数          | 必填 | 类型  | 说明                                     |
| ----------- | -- | --- | -------------------------------------- |
| py_code     | Y  | str | 完整 Python 源码文本，不是本地文件路径                |
| handle_type | N  | int | `0` 仅传输，`1` 传输后提交回测，`2` 传输后提交执行；默认 `0` |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.send_source(
        py_code=<值>,
        handle_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "send_source", "params": {"py_code": <值>, "handle_type": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `get_backtest_result`

**参数说明：**

| 参数      | 必填 | 类型  | 说明                                  |
| ------- | -- | --- | ----------------------------------- |
| task_id | Y  | int | `send_source` 成功返回的任务 ID，必须大于等于 `0` |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.get_backtest_result(
        task_id=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "get_backtest_result", "params": {"task_id": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

### 公式接口

#### `formula_set_data`

**参数说明：**

| 参数            | 必填 | 类型   | 说明         |
| ------------- | -- | ---- | ---------- |
| stock_code    | Y  | str  | 股票代码       |
| stock_period  | N  | str  | 周期，默认 `1d` |
| stock_data    | Y  | List | 公式输入行情数据   |
| count         | N  | int  | 数据条数       |
| dividend_type | N  | int  | 复权类型数值     |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_set_data(
        stock_code=<值>,
        stock_period=<值>,
        stock_data=<值>,
        count=<值>,
        dividend_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "formula_set_data", "params": {"stock_code": <值>, "stock_period": <值>, "stock_data": <值>, "count": <值>, "dividend_type": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `formula_set_data_info`

**参数说明：**

| 参数            | 必填 | 类型  | 说明         |
| ------------- | -- | --- | ---------- |
| stock_code    | Y  | str | 股票代码       |
| stock_period  | N  | str | 周期，默认 `1d` |
| start_time    | N  | str | 开始日期       |
| end_time      | N  | str | 结束日期       |
| count         | N  | int | 数据条数       |
| dividend_type | N  | int | 复权类型数值     |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_set_data_info(
        stock_code=<值>,
        stock_period=<值>,
        start_time=<值>,
        end_time=<值>,
        count=<值>,
        dividend_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "formula_set_data_info", "params": {"stock_code": <值>, "stock_period": <值>, "start_time": <值>, "end_time": <值>, "count": <值>, "dividend_type": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `formula_get_data`

**参数说明：**

| 参数 | 必填 | 类型 | 说明    |
| -- | -- | -- | ----- |
| 无  | N  | -  | 不需要参数 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_get_data()
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "formula_get_data"}
```

**出参字段：** 见文末「附录 K」。

---

#### `formula_format_data`

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_format_data()
```

> 此接口**仅支持模式 A**（需生成/运行 Python 策略文件）。

**出参字段：** 见文末「附录 K」。

---

#### `formula_zb`

**参数说明：**

| 参数           | 必填 | 类型  | 说明      |
| ------------ | -- | --- | ------- |
| formula_name | Y  | str | 指标公式名称  |
| formula_arg  | N  | str | 公式参数字符串 |
| xsflag       | N  | int | 小数位控制   |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_zb(
        formula_name=<值>,
        formula_arg=<值>,
        xsflag=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "formula_zb", "params": {"formula_name": <值>, "formula_arg": <值>, "xsflag": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `formula_xg`

**参数说明：**

| 参数           | 必填 | 类型  | 说明      |
| ------------ | -- | --- | ------- |
| formula_name | Y  | str | 选股公式名称  |
| formula_arg  | N  | str | 公式参数字符串 |
| xsflag       | N  | int | 小数位控制   |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_xg(
        formula_name=<值>,
        formula_arg=<值>,
        xsflag=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "formula_xg", "params": {"formula_name": <值>, "formula_arg": <值>, "xsflag": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `formula_exp`

**参数说明：**

| 参数           | 必填 | 类型  | 说明      |
| ------------ | -- | --- | ------- |
| formula_name | Y  | str | 专家公式名称  |
| formula_arg  | N  | str | 公式参数字符串 |
| xsflag       | N  | int | 小数位控制   |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_exp(
        formula_name=<值>,
        formula_arg=<值>,
        xsflag=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "formula_exp", "params": {"formula_name": <值>, "formula_arg": <值>, "xsflag": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `formula_process_mul_xg`

**参数说明：**

| 参数            | 必填 | 类型        | 说明         |
| ------------- | -- | --------- | ---------- |
| formula_name  | Y  | str       | 选股公式名称     |
| formula_arg   | N  | str       | 公式参数字符串    |
| return_count  | N  | int       | 每只股票返回结果数量 |
| return_date   | N  | bool      | 是否返回日期     |
| stock_list    | Y  | List[str] | 股票代码列表     |
| stock_period  | N  | str       | 周期，默认 `1d` |
| start_time    | N  | str       | 开始日期       |
| end_time      | N  | str       | 结束日期       |
| count         | N  | int       | 行情数据条数     |
| dividend_type | N  | int       | 复权类型数值     |

**重要：** 批量调用无需 `formula_set_data`，且 `formula_set_data` 的设置对批量调用不生效；`count` 太小会导致结果比客户端条件选股少（需覆盖公式最大回溯K线数）；服务端分批（`BatchFormulaPaged`）结果已由接口自动续取合并，无需手动处理。

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_process_mul_xg(
        formula_name=<值>,
        formula_arg=<值>,
        return_count=<值>,
        return_date=<值>,
        stock_list=<值>,
        stock_period=<值>,
        start_time=<值>,
        end_time=<值>,
        count=<值>,
        dividend_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "formula_process_mul_xg", "params": {"formula_name": <值>, "formula_arg": <值>, "return_count": <值>, "return_date": <值>, "stock_list": <值>, "stock_period": <值>, "start_time": <值>, "end_time": <值>, "count": <值>, "dividend_type": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `formula_process_mul_zb`

**参数说明：**

| 参数            | 必填 | 类型        | 说明         |
| ------------- | -- | --------- | ---------- |
| formula_name  | Y  | str       | 指标公式名称     |
| formula_arg   | N  | str       | 公式参数字符串    |
| return_count  | N  | int       | 每只股票返回结果数量 |
| return_date   | N  | bool      | 是否返回日期     |
| xsflag        | N  | int       | 小数位控制      |
| stock_list    | Y  | List[str] | 股票代码列表     |
| stock_period  | N  | str       | 周期，默认 `1d` |
| start_time    | N  | str       | 开始日期       |
| end_time      | N  | str       | 结束日期       |
| count         | N  | int       | 行情数据条数     |
| dividend_type | N  | int       | 复权类型数值     |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_process_mul_zb(
        formula_name=<值>,
        formula_arg=<值>,
        return_count=<值>,
        return_date=<值>,
        xsflag=<值>,
        stock_list=<值>,
        stock_period=<值>,
        start_time=<值>,
        end_time=<值>,
        count=<值>,
        dividend_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "formula_process_mul_zb", "params": {"formula_name": <值>, "formula_arg": <值>, "return_count": <值>, "return_date": <值>, "xsflag": <值>, "stock_list": <值>, "stock_period": <值>, "start_time": <值>, "end_time": <值>, "count": <值>, "dividend_type": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `formula_process_mul_exp`

**参数说明：**

| 参数            | 必填 | 类型        | 说明         |
| ------------- | -- | --------- | ---------- |
| formula_name  | Y  | str       | 专家公式名称     |
| formula_arg   | N  | str       | 公式参数字符串    |
| return_count  | N  | int       | 每只股票返回结果数量 |
| return_date   | N  | bool      | 是否返回日期     |
| xsflag        | N  | int       | 小数位控制      |
| stock_list    | Y  | List[str] | 股票代码列表     |
| stock_period  | N  | str       | 周期，默认 `1d` |
| start_time    | N  | str       | 开始日期       |
| end_time      | N  | str       | 结束日期       |
| count         | N  | int       | 行情数据条数     |
| dividend_type | N  | int       | 复权类型数值     |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_process_mul_exp(
        formula_name=<值>,
        formula_arg=<值>,
        return_count=<值>,
        return_date=<值>,
        xsflag=<值>,
        stock_list=<值>,
        stock_period=<值>,
        start_time=<值>,
        end_time=<值>,
        count=<值>,
        dividend_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "formula_process_mul_exp", "params": {"formula_name": <值>, "formula_arg": <值>, "return_count": <值>, "return_date": <值>, "xsflag": <值>, "stock_list": <值>, "stock_period": <值>, "start_time": <值>, "end_time": <值>, "count": <值>, "dividend_type": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `formula_get_all`

**参数说明：**

| 参数           | 必填 | 类型  | 说明                             |
| ------------ | -- | --- | ------------------------------ |
| formula_type | N  | int | `0` 技术指标公式`1` 条件选股公式`2` 专家系统公式 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_get_all(
        formula_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "formula_get_all", "params": {"formula_type": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `formula_get_info`

**参数说明：**

| 参数           | 必填 | 类型  | 说明                   |
| ------------ | -- | --- | -------------------- |
| formula_type | N  | int | `0` 指标；`1` 选股；`2` 专家 |
| formula_code | Y  | str | 公式代码                 |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.formula_get_info(
        formula_type=<值>,
        formula_code=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "formula_get_info", "params": {"formula_type": <值>, "formula_code": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

### 交易接口

> **注意：** 交易接口需要先在通达信客户端登录交易账号。

#### `stock_account`

**参数说明：**

| 参数           | 必填 | 类型  | 说明              |
| ------------ | -- | --- | --------------- |
| account      | Y  | str | 资金账号            |
| account_type | N  | str | 账号类型，默认 `stock` |

**模式 A（生成 py 策略文件）：**



```python
from tqcenter import tq
tq.initialize(__file__)
tq.stock_account(
        account=<值>,
        account_type=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "stock_account", "params": {"account": <值>, "account_type": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `query_stock_orders`

**参数说明：**

| 参数              | 必填 | 类型   | 说明                |
| --------------- | -- | ---- | ----------------- |
| account_id      | Y  | int  | 账户句柄；未指定账号时默认 `0` |
| stock_code      | N  | str  | 股票代码；空表示不按股票过滤    |
| cancelable_only | N  | bool | 是否仅查询可撤委托         |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.query_stock_orders(
        account_id=<值>,
        stock_code=<值>,
        cancelable_only=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "query_stock_orders", "params": {"account_id": <值>, "stock_code": <值>, "cancelable_only": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `query_history_trade`

**参数说明：**

| 参数         | 必填 | 类型  | 说明                |
| ---------- | -- | --- | ----------------- |
| account_id | Y  | int | 账户句柄；未指定账号时默认 `0` |
| stock_code | Y  | str | 股票代码（需带市场后缀，如 `688318.SH`） |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.query_history_trade(
        account_id=<值>,
        stock_code=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "query_history_trade", "params": {"account_id": <值>, "stock_code": <值>}}
```

**出参字段：**

| 字段        | 类型    | 说明                 |
| --------- | ----- | ------------------ |
| `Date`    | `str` | 成交日期，格式 `YYYYMMDD` |
| `Time`    | `str` | 成交时间，格式 `HHMMSS`   |
| `Code`    | `str` | 股票代码（带市场后缀）        |
| `Name`    | `str` | 证券名称               |
| `BSFlag`  | `int` | 买卖标志               |
| `CjPrice` | `str` | 成交价格               |
| `CjVol`   | `str` | 成交量                |

> **注意：** `stock_code` 需带市场后缀（如 `688318.SH`）方可命中；传空串或不传时返回 `[]`。

---

#### `query_stock_positions`

**参数说明：**

| 参数         | 必填 | 类型  | 说明                |
| ---------- | -- | --- | ----------------- |
| account_id | Y  | int | 账户句柄；未指定账号时默认 `0` |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.query_stock_positions(
        account_id=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "query_stock_positions", "params": {"account_id": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `query_stock_asset`

**参数说明：**

| 参数         | 必填 | 类型  | 说明                |
| ---------- | -- | --- | ----------------- |
| account_id | Y  | int | 账户句柄；未指定账号时默认 `0` |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.query_stock_asset(
        account_id=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "query_stock_asset", "params": {"account_id": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `order_stock`

**参数说明：**

| 参数           | 必填 | 类型    | 说明                                     |
| ------------ | -- | ----- | -------------------------------------- |
| account_id   | Y  | int   | 账户句柄；未指定账号时默认 `0`                      |
| stock_code   | Y  | str   | 股票代码                                   |
| order_type   | Y  | int   | `0` 买入；`1` 卖出                          |
| order_volume | Y  | int   | 委托数量                                   |
| price_type   | Y  | int   | `0` 自填价；`1` 市价；`2` 涨停/笼子上限；`3` 跌停/笼子下限 |
| price        | N  | float | 委托价格；市价可传 `0`                          |
| notify       | N  | int   | 是否通知，默认 `0`                            |

> **注意：** 实盘交易账户下单后需用户在客户端确认（Value=1）。自动下单需联系开户券商开通支持TQ的版本。

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.order_stock(
        account_id=<值>,
        stock_code=<值>,
        order_type=<值>,
        order_volume=<值>,
        price_type=<值>,
        price=<值>,
        notify=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "order_stock", "params": {"account_id": <值>, "stock_code": <值>, "order_type": <值>, "order_volume": <值>, "price_type": <值>, "price": <值>, "notify": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

#### `cancel_order_stock`

**参数说明：**

| 参数         | 必填 | 类型  | 说明                |
| ---------- | -- | --- | ----------------- |
| account_id | Y  | int | 账户句柄；未指定账号时默认 `0` |
| stock_code | Y  | str | 股票代码              |
| order_id   | Y  | str | 委托编号              |

**模式 A（生成 py 策略文件）：**

```python
from tqcenter import tq
tq.initialize(__file__)
tq.cancel_order_stock(
        account_id=<值>,
        stock_code=<值>,
        order_id=<值>
    )
```

**模式 B（HTTP 直连）：**

```json
{"id": 1, "method": "cancel_order_stock", "params": {"account_id": <值>, "stock_code": <值>, "order_id": <值>}}
```

**出参字段：** 见文末「附录 K」。

---

---

## 附录：出参字段统一清单

> 所有接口的出参字段集中在此。除特别说明外，模式 B 的返回在 JSON-RPC 的 `result.Value` 中；模式 A 返回 Python 原生对象（dict / DataFrame / list）。
>   
> 字段类型 `double` 表示数值，`str` 表示字符串；`Value` 数组下标语义由字段代码决定。

## 附录 A

### get_market_data：K线/分钟线/历史行情

| 字段            | 类型  | 说明                |
| ------------- | --- | ----------------- |
| Date          | str | 日期                |
| Time          | str | 时间，分钟线/分时数据常见     |
| Open          | str | 开盘价（元）            |
| High          | str | 最高价（元）            |
| Low           | str | 最低价（元）            |
| Close         | str | 收盘价（元）            |
| Volume        | str | 成交量（股）            |
| Amount        | str | 成交额（万元）           |
| ForwardFactor | str | 前复权因子，通常仅不复权数据中返回 |
| VolInStock    | str | 持仓量(期货期权有效)           |

### get_market_snapshot：实时行情快照

| 字段            | 类型        | 说明                           |
| ------------- | --------- | ---------------------------- |
| ItemNum       | str       | 快照笔数                         |
| LastClose     | str       | 前收盘价                         |
| Open          | str       | 开盘价                          |
| Max           | str       | 最高价                          |
| Min           | str       | 最低价                          |
| Now           | str       | 现价                           |
| Volume        | str       | 总手                           |
| NowVol        | str       | 现手                           |
| Amount        | str       | 总成交金额                        |
| Inside        | str       | 内盘 板块指数时为跌停家数                |
| Outside       | str       | 外盘 板块指数时为涨停家数                |
| TickDiff      | str       | 笔涨跌                          |
| InOutFlag     | str       | 内外盘标志 0:Buy 1:Sell 2:Unknown |
| Jjjz          | str       | 基金净值                         |
|               |           |                              |
| Buyp          | List[str] | 五个买价                         |
| Buyv          | List[str] | 对应的五个买盘量                     |
| Sellp         | List[str] | 五个卖价                         |
| Sellv         | List[str] | 对应的五个卖盘量                     |
| UpHome        | str       | 上涨家数 对于指数有效                  |
| DownHome      | str       | 下跌家数 对于指数有效                  |
|               |           |                              |
| Before5MinNow | str       | 5分钟前价格                       |
| Average       | str       | 均价                           |
| XsFlag        | str       | 小数位数                         |
| Zangsu        | str       | 涨速                           |
| ZAFPre3       | str       | 3日涨幅                         |

## 附录 B

### get_stock_info：证券基础信息

| 数据              | 默认返回 | 数据类型      | 数据说明                                                                      |
| :-------------- | :--- | :-------- | ------------------------------------------------------------------------- |
| Name            | Y    | str       | 证券名称                                                                      |
| Unit            | Y    | str       | 交易单位                                                                      |
| VolBase         | Y    | str       | 量比的基量                                                                     |
| MinPrice        | Y    | str       | 最小价格变动                                                                    |
| XsFlag          | Y    | str       | 价格小数位数                                                                    |
| Fz[8]           | Y    | List[str] | 开收市时间（4段）                                                                 |
| DelayMin        | Y    | str       | 延时分钟数                                                                     |
| QHVolBaseRate   | Y    | str       | 期货期权的每手乘数                                                                 |
| HKVolBaseRate   | Y    | str       | 港股/日股/新加坡股 每手股数                                                           |
| BelongHS300     | Y    | str       | 是否属于沪深300                                                                 |
| BelongHasKQZ    | Y    | str       | 是否含可转债                                                                    |
| BelongRZRQ      | Y    | str       | 是否是融资融券标的                                                                 |
| BelongHSGT      | Y    | str       | 是否属于沪深股通                                                                  |
| IsHKGP          | Y    | str       | 是否是港股                                                                     |
| IsQH            | Y    | str       | 是否是期货                                                                     |
| IsQQ            | Y    | str       | 是否是期权                                                                     |
| IsSTGP          | Y    | str       | 是否是ST股票                                                                   |
| IsQuitGP        | Y    | str       | 是否是退市整理板股票                                                                |
| TodayDRFlag     | Y    | str       | 当天是否有除权除息(沪深京)                                                            |
| HSStockKind     | Y    | str       | 沪深京品种类型 0:指数,1:A股主板,2:北证A股,3:创业板,4:科创板,5:B股,6:债券,7:基金,8:权证,9:其它,10:非沪深京品种 |
|                 |      |           |                                                                           |
| ActiveCapital   | Y    | str       | 流通股本(万股)                                                                  |
| J_zgb           | Y    | str       | 总股本(万股)                                                                   |
| J_bg            | Y    | str       | B股(万股)                                                                    |
| J_hg            | Y    | str       | H股(万股)                                                                    |
| J_zzc           | Y    | str       | 总资产(万元)                                                                   |
| J_ldzc          | Y    | str       | 流动资产(万元)                                                                  |
| J_gdzc          | Y    | str       | 固定资产(万元)                                                                  |
| J_wxzc          | Y    | str       | 无形资产(万元)                                                                  |
| J_ldfz          | Y    | str       | 流动负债(万元)                                                                  |
| J_cqfz          | Y    | str       | 少数股东权益(万元)                                                                |
| J_zbgjj         | Y    | str       | 资本公积金(万元)                                                                 |
| J_jzc           | Y    | str       | 股东权益/净资产(万元)                                                              |
| J_yysy          | Y    | str       | 营业收入(万元)                                                                  |
| J_yycb          | Y    | str       | 营业成本(万元)                                                                  |
| J_yszk          | Y    | str       | 应收账款(万元)                                                                  |
| J_yyly          | Y    | str       | 营业利润(万元)                                                                  |
| J_tzsy          | Y    | str       | 投资收益(万元)                                                                  |
| J_jyxjl         | Y    | str       | 经营现金净流量(万元)                                                               |
| J_zxjl          | Y    | str       | 总现金净流量(万元)                                                                |
| J_ch            | Y    | str       | 存货(万元)                                                                    |
| J_lyze          | Y    | str       | 利润总额(万元)                                                                  |
| J_shly          | Y    | str       | 税后利润(万元)                                                                  |
| J_jly           | Y    | str       | 净利润(万元)                                                                   |
| J_wfply         | Y    | str       | 未分配利益(万元)                                                                 |
| J_jyl           | Y    | str       | 净资产收益率                                                                    |
| J_mgwfp         | Y    | str       | 每股未分配                                                                     |
| J_mgsy          | Y    | str       | 每股收益（折算为全年）                                                               |
| J_mgsy2         | Y    | str       | 季报每股收益 (财报中提供的每股收益)                                                       |
| J_mggjj         | Y    | str       | 每股公积金                                                                     |
| J_mgjzc         | Y    | str       | 每股净资产                                                                     |
| J_mgjzc2        | Y    | str       | 季报每股净资产 (财报中提供的每股收益)                                                      |
| J_gdqyb         | Y    | str       | 股东权益比                                                                     |
| J_gdrs          | Y    | str       | 股东人数                                                                      |
| J_HalfYearFlag  | Y    | str       | 报告期月份(3,6,9,12)                                                           |
| J_start         | Y    | str       | 上市日期                                                                      |
|                 |      |           |                                                                           |
| tdx_dycode      | Y    | str       | 通达信地域代码                                                                   |
| tdx_dyname      | Y    | str       | 通达信地域                                                                     |
| rs_hycode_sim   | Y    | str       | 通达信行业代码                                                                   |
| rs_hyname       | Y    | str       | 通达信行业                                                                     |
| blockzscode     | Y    | str       | 所属的行业板块指数代码                                                               |
| underly_setcode | Y    | str       | 标的市场代码(比如：当前ETF跟踪的指数市场)                                                   |
| underly_code    | Y    | str       | 标的代码(比如：当前ETF跟踪的指数代码)                                                     |

### get_more_info：更多证券信息

| 数据                | 默认返回 | 数据类型 | 数据说明                 |
| :---------------- | :--- | :--- | -------------------- |
| MainBusiness      | Y    | str  | 主营构成                 |
| SafeValue         | Y    | str  | 安全分                  |
| ShineValue        | Y    | str  | 亮点数                  |
| ShapeValue        | Y    | str  | 短期形态+中期形态+长期形态 编号    |
|                   |      |      |                      |
| TPFlag            | Y    | str  | 停牌标识                 |
| ZTPrice           | Y    | str  | 涨停价                  |
| DTPrice           | Y    | str  | 跌停价                  |
| HqDate            | Y    | str  | 行情日期                 |
|                   |      |      |                      |
| fHSL              | Y    | str  | 换手率                  |
| fLianB            | Y    | str  | 量比                   |
| Wtb               | Y    | str  | 委比                   |
| Zsz               | Y    | str  | 总市值(亿)               |
| Ltsz              | Y    | str  | 流通市值(亿)              |
|                   |      |      |                      |
| vzangsu           | Y    | str  | 量涨速                  |
| Fzhsl             | Y    | str  | 分钟换手率                |
| FzAmo             | Y    | str  | 2分钟金额(万元)            |
| VOpenZAF          | Y    | str  | 抢筹涨幅                 |
|                   |      |      |                      |
| ZAF               | Y    | str  | 涨幅                   |
| ZAFYesterday      | Y    | str  | 昨日涨幅                 |
| ZAFPre2D          | Y    | str  | 前天涨幅                 |
| ZAFPre5           | Y    | str  | 5日涨幅                 |
| ZAFPre10          | Y    | str  | 10日涨幅                |
| ZAFPre20          | Y    | str  | 20日涨幅                |
| ZAFPre30          | Y    | str  | 30日涨幅                |
| ZAFPre60          | Y    | str  | 60日涨幅                |
| ZAFYear           | Y    | str  | 年初至今涨幅               |
| ZAFPreMyMonth     | Y    | str  | 涨幅(本月来)              |
| ZAFPreOneYear     | Y    | str  | 涨幅(一年来)              |
|                   |      |      |                      |
| Zjl               | Y    | str  | 主买净额(万元)             |
| Zjl_HB            | Y    | str  | 主力净流入(万元)            |
|                   |      |      |                      |
| TotalBVol         | Y    | str  | 总买量                  |
| TotalSVol         | Y    | str  | 总卖量                  |
| BCancel           | Y    | str  | 总撤买量                 |
| SCancel           | Y    | str  | 总撤卖量                 |
| L2TicNum          | Y    | str  | L2逐笔成交数              |
| L2OrderNum        | Y    | str  | L2逐笔委托数              |
|                   |      |      |                      |
| FCAmo             | Y    | str  | 封单额(万元)              |
| FCb               | Y    | str  | 封成比                  |
| OpenAmo           | Y    | str  | 开盘金额(万元)(A股和板块指数有效)  |
| OpenZTBuy         | Y    | str  | 竞价涨停买入金额(万元)         |
|                   |      |      |                      |
| OpenAmoPre1       | Y    | str  | 昨开盘金额(万元)            |
| OpenVolPre1       | Y    | str  | 昨开盘量                 |
| CJJEPre1          | Y    | str  | 昨成交额(万元)             |
| CJJEPre3          | Y    | str  | 3日成交额(万元)            |
| FDEPre1           | Y    | str  | 昨封单额(万元)             |
| FDEPre2           | Y    | str  | 前封单额(万元)             |
|                   |      |      |                      |
| ZTGPNum           | Y    | str  | 板块指数的涨停家数            |
| LastStartZT       | Y    | str  | 几天                   |
| LastZTHzNum       | Y    | str  | 几板                   |
| EverZTCount       | Y    | str  | 连板天                  |
| ConZAFDateNum     | Y    | str  | 连涨天数                 |
| YearZTDay         | Y    | str  | 年涨停天数                |
|                   |      |      |                      |
| MA5Value          | Y    | str  | 5日均价                 |
| HisHigh           | Y    | str  | 52周最高                |
| HisLow            | Y    | str  | 52周最低                |
| IPO_Price         | Y    | str  | 发行价                  |
|                   |      |      |                      |
| More_YJL          | Y    | str  | ETF,LOF溢价率           |
| BetaValue         | Y    | str  | 贝塔系数                 |
| DynaPE            | Y    | str  | 动态市盈率                |
| MorePE            | Y    | str  | 市盈率(港股:动,其他扩展:静)     |
| StaticPE_TTM      | Y    | str  | 市盈率(TTM)             |
| DYRatio           | Y    | str  | 股息率                  |
| PB_MRQ            | Y    | str  | 市净率(MRQ)             |
|                   |      |      |                      |
| IsT0Fund          | Y    | str  | 是否是T+0基金             |
| IsZCZGP           | Y    | str  | 是否是注册制A股             |
| IsKzz             | Y    | str  | 是否是可转债               |
| Kzz_HSCode        | Y    | str  | 可转债对应的正股代码           |
| QHMainYYMM        | Y    | str  | 主力合约关联的月份(期货),主力和次主力 |
| PreVolIn          | Y    | str  | 昨持仓量(期货期权有效)         |
| VolInStock        | Y    | str  | 持仓量(期货期权有效)           |
| ClearPrice        | Y    | str  | 结算价(期货期权有效)           |
| PreMinum          | Y    | str  | 基差/溢价                  |
|                   |      |      |                      |
| FreeLtgb          | Y    | str  | 自由流通股本(万)            |
| Yield             | Y    | str  | 应计利息(债券),占款天数(回购)    |
| KfEarnMoney       | Y    | str  | 扣非净利润(万元)            |
| RDInputFee        | Y    | str  | 研发费用(万元)             |
| CashZJ            | Y    | str  | 货币资金(万元)             |
| PreReceiveZJ      | Y    | str  | 合同负债(万元)             |
| OtherQYJzc        | Y    | str  | 其它权益工具(万元)           |
| StaffNum          | Y    | str  | 员工人数                 |
|                   |      |      |                      |
| RecentGGJYDate    | Y    | str  | 最近北上大额交易日            |
| RecentHGDate      | Y    | str  | 最近回购预案日              |
| RecentIncentDate  | Y    | str  | 最近股权激励预案日            |
| NoticeDate_Recent | Y    | str  | 最近业绩预告日              |
| RecentReleaseDate | Y    | str  | 最近解禁日                |
| RecentDZDate      | Y    | str  | 最近定增日                |
| ReportDate        | Y    | str  | 最近财报公告日期             |
| ZTDate_Recent     | Y    | str  | 近2年最近涨停板日期           |
| DTDate_Recent     | Y    | str  | 近2年最近跌停板日期           |
| TopDate_Recent    | Y    | str  | 近2年最近龙虎榜日期           |
| StopJYDate_Recent | Y    | str  | 最近停牌日期               |

### get_match_stkinfo：模糊查证券

| 名称   | 类型 | 数值  | 说明   |
| :--- | :- | :-- | ---- |
| Code | Y  | str | 证券代码 |
| Name | Y  | str | 证券名称 |

## 附录 C

### get_relation：证券所属板块

| 数据        | 默认返回 | 数据类型 | 数据说明  |
| :-------- | :--- | :--- | ----- |
| BlockCode | Y    | str  | 板块代码  |
| BlockName | Y    | str  | 板块名称  |
| BlockType | Y    | str  | 板块类型  |
| GPNume    | Y    | str  | 成份股数量 |

### get_stock_list：系统证券列表

| 字段   | 类型  | 说明                      |
| ---- | --- | ----------------------- |
| Code | str | 成分股代码                   |
| Name | str | 成分股名称, list_type = 1时返回 |

### get_sector_list：板块列表

| 字段   | 类型  | 说明                      |
| ---- | --- | ----------------------- |
| Code | str | 成分股代码                   |
| Name | str | 成分股名称, list_type = 1时返回 |

### get_stock_list_in_sector：板块成分股

| 字段   | 类型  | 说明                      |
| ---- | --- | ----------------------- |
| Code | str | 成分股代码                   |
| Name | str | 成分股名称, list_type = 1时返回 |

### get_user_sector：用户自定义板块

| 字段   | 类型  | 说明     |
| ---- | --- | ------ |
| Code | str | 用户板块代码 |
| Name | str | 用户板块名称 |

### get_trading_dates：交易日

| 字段    | 类型        | 说明     |
| ----- | --------- | ------ |
| Value | List[str] | 交易日期列表 |

### get_trading_calendar：交易日历

| 字段    | 类型        | 说明     |
| ----- | --------- | ------ |
| Value | List[str] | 交易日期列表 |

## 附录 D

### get_divid_factors：除权除息

| 字段         | 类型      | 说明       |
| ---------- | ------- | -------- |
| Date       | str     | 除权除息日期   |
| Type       | str/int | 类型       |
| Bonus      | str     | 每 10 股分红 |
| AllotPrice | str     | 配股价      |
| ShareBonus | str     | 送股比例     |
| Allotment  | str     | 配股比例     |

### get_gb_info：股本信息

| 字段   | 类型     | 说明 |      |
| ---- | ------ | -- | ---- |
| Date | double |    | 日期   |
| Zgb  | double |    | 总股本  |
| Ltgb | double |    | 流通股本 |

### get_gb_info_by_date：区间股本

| 字段   | 类型     | 说明 |      |
| ---- | ------ | -- | ---- |
| Date | double |    | 日期   |
| Zgb  | double |    | 总股本  |
| Ltgb | double |    | 流通股本 |

### get_kzz_info：可转债信息

| 字段          | 类型  | 说明       |
| ----------- | --- | -------- |
| SetCode     | str | 证券市场     |
| KZZCode     | str | 可转债代码    |
| HSCode      | str | 正股代码     |
| ZGPrice     | str | 转股价格     |
| CurRate     | str | 当期利率     |
| RestScope   | str | 剩余规模(万)  |
| PutBack     | str | 回售触发价    |
| ForceRedeem | str | 强赎触发价    |
| ZGDate      | str | 转股日      |
| EndPrice    | str | 到期价      |
| EndDate     | str | 到期日期     |
| ZGRate      | str | 转股比率%    |
| RealValue   | str | 纯债价值     |
| ExpireYield | str | 到期收益率%   |
| KZZScore    | str | 可转债评级    |
| HSScore     | str | 主体评级     |
| RedeemDate  | str | 赎回登记日期   |
| RedeemPrice | str | 赎回价格     |
| PutDate     | str | 回售申报起始日期 |
| PutPrice    | str | 回售价格     |
| ZGCode      | str | 转股代码     |
|             |     |          |
| AGPrice     | str | 正股当前价格   |
| KZZPrice    | str | 可转债当前价格  |
| KZZYj       | str | 溢价率      |
| ZGValue     | str | 转股价值     |

### get_trackzs_etf_info：跟踪指数ETF

| 字段       | 类型  | 说明     |
| -------- | --- | ------ |
| Code     | str | 证券代码   |
| Name     | str | 证券名称   |
| NowPrice | str | 现价     |
| PreClose | str | 昨收     |
| IOPV     | str | 净值     |
| Zgb      | str | 净额（万份） |
| Sz       | str | 规模（亿元） |

### get_zdt_data：涨跌停数据

| 字段                              | 类型        | 说明                                                                |
| ------------------------------- | --------- | ----------------------------------------------------------------- |
| Code                            | str       | 标准证券代码                                                            |
| ZDTStatusNow                    | str       | 当前涨跌停状态：1 自然涨停，2 一字涨停，3 曾涨停，4 自然跌停，5 一字跌停，6 曾跌停，7 涨超 10%，8 跌超 10% |
| ZDTStatusOri                    | str       | 历史涨跌停状态                                                           |
| FirstTimeZT / FirstTimeDT       | str       | 首次涨停 / 跌停时间                                                       |
| LastOpenTimeZT / LastOpenTimeDT | str       | 最后涨停 / 跌停打开时间                                                     |
| LastTimeZT / LastTimeDT         | str       | 最近一次涨停 / 跌停时间                                                     |
| OpenTimesZT / OpenTimesDT       | str       | 涨停 / 跌停打开次数                                                       |
| FDVolMaxZT / FDVolMaxDT / VolZT | str       | 封单量与涨停累计成交量                                                       |
| DaysZTSeries / DaysDTSeries     | str       | 连续涨停 / 跌停天数                                                       |
| ZDTStatusDays                   | List[str] | 近 3 天涨跌停状态，依次为今天、昨天、前天                                            |
| ZTRecentDays                    | str       | 最近 20 个交易日涨停数                                                     |

### get_pricevol：价量分布

| 名称        | 类型 | 数值  | 说明   |
| :-------- | :- | :-- | ---- |
| LastClose | Y  | str | 前收盘价 |
| Now       | Y  | str | 现价   |
| Volume    | Y  | str | 成交量  |

### get_exday_data：扩展日线L2

| 字段                                  | 类型              | 说明                |
| ----------------------------------- | --------------- | ----------------- |
| Date                                | str             | 日期                |
| CJBS                                | str             | 成交单数              |
| Vol / Amo                           | List[List[str]] | 4×4 成交数量 / 成交金额矩阵 |
| VolNum                              | List[List[str]] | 2×2 成交笔数分档比例矩阵    |
| BOrder / BCancel / SOrder / SCancel | str             | 买卖净挂单与净撤单累计值      |
| BuyAvp / SellAvp                    | str             | 委买均价 / 委卖均价       |
| TotalBOrder / TotalSOrder           | str             | 当前总委买 / 当前总委卖     |

### get_ipo_info：新股/新债申购

| 数据       | 默认返回 | 数据类型 | 数据说明  |
| :------- | :--- | :--- | ----- |
| Code     | Y    | str  | 证券代码  |
| Name     | Y    | str  | 证券名称  |
| SGDate   | Y    | str  | 申购日期  |
| SGPrice  | Y    | str  | 申购价格  |
| SGCode   | Y    | str  | 申购代码  |
| MaxSG    | Y    | str  | 申购上限  |
| PE_Issue | Y    | str  | 发行市盈率 |

## 附录 F

### get_financial_data：专业财务数据（FN1~FN584 完整字段）

| 字段              | 类型       | 说明                                                                                                                                                  |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `announce_time` | `int`    | 公告日期                                                                                                                                                |
| `tag_time`      | `int`    | 报告期                                                                                                                                                 |
| `FN1`           | `double` | 基本每股收益                                                                                                                                              |
| `FN2`           | `double` | 扣除非经常性损益每股收益                                                                                                                                        |
| `FN3`           | `double` | 每股未分配利润                                                                                                                                             |
| `FN4`           | `double` | 每股净资产                                                                                                                                               |
| `FN5`           | `double` | 每股资本公积金                                                                                                                                             |
| `FN6`           | `double` | 净资产收益率                                                                                                                                              |
| `FN7`           | `double` | 每股经营现金流量                                                                                                                                            |
| `FN8`           | `double` | 货币资金                                                                                                                                                |
| `FN9`           | `double` | 交易性金融资产                                                                                                                                             |
| `FN10`          | `double` | 应收票据                                                                                                                                                |
| `FN11`          | `double` | 应收账款                                                                                                                                                |
| `FN12`          | `double` | 预付款项                                                                                                                                                |
| `FN13`          | `double` | 其他应收款                                                                                                                                               |
| `FN14`          | `double` | 应收关联公司款                                                                                                                                             |
| `FN15`          | `double` | 应收利息                                                                                                                                                |
| `FN16`          | `double` | 应收股利                                                                                                                                                |
| `FN17`          | `double` | 存货                                                                                                                                                  |
| `FN18`          | `double` | 其中：消耗性生物资产                                                                                                                                          |
| `FN19`          | `double` | 一年内到期的非流动资产                                                                                                                                         |
| `FN20`          | `double` | 其他流动资产                                                                                                                                              |
| `FN21`          | `double` | 流动资产合计                                                                                                                                              |
| `FN22`          | `double` | 可供出售金融资产                                                                                                                                            |
| `FN23`          | `double` | 持有至到期投资                                                                                                                                             |
| `FN24`          | `double` | 长期应收款                                                                                                                                               |
| `FN25`          | `double` | 长期股权投资                                                                                                                                              |
| `FN26`          | `double` | 投资性房地产                                                                                                                                              |
| `FN27`          | `double` | 固定资产                                                                                                                                                |
| `FN28`          | `double` | 在建工程                                                                                                                                                |
| `FN29`          | `double` | 工程物资                                                                                                                                                |
| `FN30`          | `double` | 固定资产清理                                                                                                                                              |
| `FN31`          | `double` | 生产性生物资产                                                                                                                                             |
| `FN32`          | `double` | 油气资产                                                                                                                                                |
| `FN33`          | `double` | 无形资产                                                                                                                                                |
| `FN34`          | `double` | 开发支出                                                                                                                                                |
| `FN35`          | `double` | 商誉                                                                                                                                                  |
| `FN36`          | `double` | 长期待摊费用                                                                                                                                              |
| `FN37`          | `double` | 递延所得税资产                                                                                                                                             |
| `FN38`          | `double` | 其他非流动资产                                                                                                                                             |
| `FN39`          | `double` | 非流动资产合计                                                                                                                                             |
| `FN40`          | `double` | 资产总计                                                                                                                                                |
| `FN41`          | `double` | 短期借款                                                                                                                                                |
| `FN42`          | `double` | 交易性金融负债                                                                                                                                             |
| `FN43`          | `double` | 应付票据                                                                                                                                                |
| `FN44`          | `double` | 应付账款                                                                                                                                                |
| `FN45`          | `double` | 预收款项                                                                                                                                                |
| `FN46`          | `double` | 应付职工薪酬                                                                                                                                              |
| `FN47`          | `double` | 应交税费                                                                                                                                                |
| `FN48`          | `double` | 应付利息                                                                                                                                                |
| `FN49`          | `double` | 应付股利                                                                                                                                                |
| `FN50`          | `double` | 其他应付款                                                                                                                                               |
| `FN51`          | `double` | 应付关联公司款                                                                                                                                             |
| `FN52`          | `double` | 一年内到期的非流动负债                                                                                                                                         |
| `FN53`          | `double` | 其他流动负债                                                                                                                                              |
| `FN54`          | `double` | 流动负债合计                                                                                                                                              |
| `FN55`          | `double` | 长期借款                                                                                                                                                |
| `FN56`          | `double` | 应付债券                                                                                                                                                |
| `FN57`          | `double` | 长期应付款                                                                                                                                               |
| `FN58`          | `double` | 专项应付款                                                                                                                                               |
| `FN59`          | `double` | 预计负债 （非流动负债）                                                                                                                                        |
| `FN60`          | `double` | 递延所得税负债                                                                                                                                             |
| `FN61`          | `double` | 其他非流动负债                                                                                                                                             |
| `FN62`          | `double` | 非流动负债合计                                                                                                                                             |
| `FN63`          | `double` | 负债合计                                                                                                                                                |
| `FN64`          | `double` | 实收资本（或股本）                                                                                                                                           |
| `FN65`          | `double` | 资本公积                                                                                                                                                |
| `FN66`          | `double` | 盈余公积                                                                                                                                                |
| `FN67`          | `double` | 减：库存股                                                                                                                                               |
| `FN68`          | `double` | 未分配利润                                                                                                                                               |
| `FN69`          | `double` | 少数股东权益                                                                                                                                              |
| `FN70`          | `double` | 外币报表折算价差                                                                                                                                            |
| `FN71`          | `double` | 非正常经营项目收益调整                                                                                                                                         |
| `FN72`          | `double` | 所有者权益（或股东权益）合计                                                                                                                                      |
| `FN73`          | `double` | 负债和所有者（或股东权益）合计                                                                                                                                     |
| `FN98`          | `double` | 销售商品、提供劳务收到的现金                                                                                                                                      |
| `FN99`          | `double` | 收到的税费返还                                                                                                                                             |
| `FN100`         | `double` | 收到其他与经营活动有关的现金                                                                                                                                      |
| `FN101`         | `double` | 经营活动现金流入小计                                                                                                                                          |
| `FN102`         | `double` | 购买商品、接受劳务支付的现金                                                                                                                                      |
| `FN103`         | `double` | 支付给职工以及为职工支付的现金                                                                                                                                     |
| `FN104`         | `double` | 支付的各项税费                                                                                                                                             |
| `FN105`         | `double` | 支付其他与经营活动有关的现金                                                                                                                                      |
| `FN106`         | `double` | 经营活动现金流出小计                                                                                                                                          |
| `FN107`         | `double` | 经营活动产生的现金流量净额                                                                                                                                       |
| `FN108`         | `double` | 收回投资收到的现金                                                                                                                                           |
| `FN109`         | `double` | 取得投资收益收到的现金                                                                                                                                         |
| `FN110`         | `double` | 处置固定资产、无形资产和其他长期资产收回的现金净额                                                                                                                           |
| `FN111`         | `double` | 处置子公司及其他营业单位收到的现金净额                                                                                                                                 |
| `FN112`         | `double` | 收到其他与投资活动有关的现金                                                                                                                                      |
| `FN113`         | `double` | 投资活动现金流入小计                                                                                                                                          |
| `FN114`         | `double` | 购建固定资产、无形资产和其他长期资产支付的现金                                                                                                                             |
| `FN115`         | `double` | 投资支付的现金                                                                                                                                             |
| `FN116`         | `double` | 取得子公司及其他营业单位支付的现金净额                                                                                                                                 |
| `FN117`         | `double` | 支付其他与投资活动有关的现金                                                                                                                                      |
| `FN118`         | `double` | 投资活动现金流出小计                                                                                                                                          |
| `FN119`         | `double` | 投资活动产生的现金流量净额                                                                                                                                       |
| `FN120`         | `double` | 吸收投资收到的现金                                                                                                                                           |
| `FN121`         | `double` | 取得借款收到的现金                                                                                                                                           |
| `FN122`         | `double` | 收到其他与筹资活动有关的现金                                                                                                                                      |
| `FN123`         | `double` | 筹资活动现金流入小计                                                                                                                                          |
| `FN124`         | `double` | 偿还债务支付的现金                                                                                                                                           |
| `FN125`         | `double` | 分配股利、利润或偿付利息支付的现金                                                                                                                                   |
| `FN126`         | `double` | 支付其他与筹资活动有关的现金                                                                                                                                      |
| `FN127`         | `double` | 筹资活动现金流出小计                                                                                                                                          |
| `FN128`         | `double` | 筹资活动产生的现金流量净额                                                                                                                                       |
| `FN129`         | `double` | 四、汇率变动对现金的影响                                                                                                                                        |
| `FN130`         | `double` | 四(2)、其他原因对现金的影响                                                                                                                                     |
| `FN131`         | `double` | 五、现金及现金等价物净增加额                                                                                                                                      |
| `FN132`         | `double` | 期初现金及现金等价物余额                                                                                                                                        |
| `FN133`         | `double` | 期末现金及现金等价物余额                                                                                                                                        |
| `FN134`         | `double` | 净利润                                                                                                                                                 |
| `FN135`         | `double` | 加：资产减值准备                                                                                                                                            |
| `FN136`         | `double` | 固定资产折旧、油气资产折耗、生产性生物资产折旧                                                                                                                             |
| `FN137`         | `double` | 无形资产摊销                                                                                                                                              |
| `FN138`         | `double` | 长期待摊费用摊销                                                                                                                                            |
| `FN139`         | `double` | 处置固定资产、无形资产和其他长期资产的损失                                                                                                                               |
| `FN140`         | `double` | 固定资产报废损失                                                                                                                                            |
| `FN141`         | `double` | 公允价值变动损失                                                                                                                                            |
| `FN142`         | `double` | 财务费用                                                                                                                                                |
| `FN143`         | `double` | 投资损失                                                                                                                                                |
| `FN144`         | `double` | 递延所得税资产减少                                                                                                                                           |
| `FN145`         | `double` | 递延所得税负债增加                                                                                                                                           |
| `FN146`         | `double` | 存货的减少                                                                                                                                               |
| `FN147`         | `double` | 经营性应收项目的减少                                                                                                                                          |
| `FN148`         | `double` | 经营性应付项目的增加                                                                                                                                          |
| `FN149`         | `double` | 其他                                                                                                                                                  |
| `FN150`         | `double` | 经营活动产生的现金流量净额2                                                                                                                                      |
| `FN151`         | `double` | 债务转为资本                                                                                                                                              |
| `FN152`         | `double` | 一年内到期的可转换公司债券                                                                                                                                       |
| `FN153`         | `double` | 融资租入固定资产                                                                                                                                            |
| `FN154`         | `double` | 现金的期末余额                                                                                                                                             |
| `FN155`         | `double` | 减：现金的期初余额                                                                                                                                           |
| `FN156`         | `double` | 加：现金等价物的期末余额                                                                                                                                        |
| `FN157`         | `double` | 减：现金等价物的期初余额                                                                                                                                        |
| `FN158`         | `double` | 现金及现金等价物净增加额                                                                                                                                        |
| `FN159`         | `double` | 流动比率(非金融类指标)                                                                                                                                        |
| `FN160`         | `double` | 速动比率(非金融类指标)                                                                                                                                        |
| `FN161`         | `double` | 现金比率(%)(非金融类指标)                                                                                                                                     |
| `FN162`         | `double` | 利息保障倍数(非金融类指标)                                                                                                                                      |
| `FN163`         | `double` | 非流动负债比率(%)(非金融类指标)                                                                                                                                  |
| `FN164`         | `double` | 流动负债比率(%)(非金融类指标)                                                                                                                                   |
| `FN166`         | `double` | 有形资产净值债务率(%)                                                                                                                                        |
| `FN167`         | `double` | 权益乘数(%)                                                                                                                                             |
| `FN168`         | `double` | 股东的权益/负债合计(%)                                                                                                                                       |
| `FN169`         | `double` | 有形资产/负债合计(%)                                                                                                                                        |
| `FN170`         | `double` | 经营活动产生的现金流量净额/负债合计(%)(非金融类指标)                                                                                                                       |
| `FN171`         | `double` | EBITDA/负债合计(%)(非金融类指标)                                                                                                                              |
| `FN172`         | `double` | 应收帐款周转率(非金融类指标)                                                                                                                                     |
| `FN173`         | `double` | 存货周转率(非金融类指标)                                                                                                                                       |
| `FN174`         | `double` | 运营资金周转率(非金融类指标)                                                                                                                                     |
| `FN175`         | `double` | 总资产周转率(非金融类指标)                                                                                                                                      |
| `FN176`         | `double` | 固定资产周转率(非金融类指标)                                                                                                                                     |
| `FN177`         | `double` | 应收帐款周转天数(非金融类指标)                                                                                                                                    |
| `FN178`         | `double` | 存货周转天数(非金融类指标)                                                                                                                                      |
| `FN179`         | `double` | 流动资产周转率(非金融类指标)                                                                                                                                     |
| `FN180`         | `double` | 流动资产周转天数(非金融类指标)                                                                                                                                    |
| `FN181`         | `double` | 总资产周转天数(非金融类指标)                                                                                                                                     |
| `FN182`         | `double` | 股东权益周转率(非金融类指标)                                                                                                                                     |
| `FN183`         | `double` | 营业收入增长率(%)                                                                                                                                          |
| `FN184`         | `double` | 净利润增长率(%)                                                                                                                                           |
| `FN185`         | `double` | 净资产增长率(%)                                                                                                                                           |
| `FN186`         | `double` | 固定资产增长率(%)                                                                                                                                          |
| `FN187`         | `double` | 总资产增长率(%)                                                                                                                                           |
| `FN188`         | `double` | 投资收益增长率(%)                                                                                                                                          |
| `FN189`         | `double` | 营业利润增长率(%)                                                                                                                                          |
| `FN190`         | `double` | 扣非每股收益同比(%)                                                                                                                                         |
| `FN191`         | `double` | 扣非净利润同比(%)                                                                                                                                          |
| `FN192`         | `double` | 暂无                                                                                                                                                  |
| `FN193`         | `double` | 成本费用利润率(%)                                                                                                                                          |
| `FN194`         | `double` | 营业利润率(非金融类指标)                                                                                                                                       |
| `FN195`         | `double` | 营业税金率(非金融类指标)                                                                                                                                       |
| `FN196`         | `double` | 营业成本率(非金融类指标)                                                                                                                                       |
| `FN197`         | `double` | 净资产收益率                                                                                                                                              |
| `FN198`         | `double` | 投资收益率                                                                                                                                               |
| `FN199`         | `double` | 销售净利率(%)                                                                                                                                            |
| `FN200`         | `double` | 总资产净利率                                                                                                                                              |
| `FN201`         | `double` | 净利润率(非金融类指标)                                                                                                                                        |
| `FN202`         | `double` | 销售毛利率(%)(非金融类指标)                                                                                                                                    |
| `FN203`         | `double` | 三费比重(非金融类指标)                                                                                                                                        |
| `FN204`         | `double` | 管理费用率(非金融类指标)                                                                                                                                       |
| `FN205`         | `double` | 财务费用率(非金融类指标)                                                                                                                                       |
| `FN206`         | `double` | 扣除非经常性损益后的净利润                                                                                                                                       |
| `FN207`         | `double` | 息税前利润(EBIT)                                                                                                                                         |
| `FN208`         | `double` | 息税折旧摊销前利润(EBITDA)                                                                                                                                   |
| `FN209`         | `double` | EBITDA/营业总收入(%)(非金融类指标)                                                                                                                             |
| `FN210`         | `double` | 资产负债率(%)                                                                                                                                            |
| `FN211`         | `double` | 流动资产比率(非金融类指标)                                                                                                                                      |
| `FN212`         | `double` | 货币资金比率(非金融类指标)                                                                                                                                      |
| `FN213`         | `double` | 存货比率(非金融类指标)                                                                                                                                        |
| `FN214`         | `double` | 固定资产比率                                                                                                                                              |
| `FN215`         | `double` | 负债结构比(非金融类指标)                                                                                                                                       |
| `FN216`         | `double` | 归属于母公司股东权益/全部投入资本(%)                                                                                                                                |
| `FN217`         | `double` | 股东的权益/带息债务(%)                                                                                                                                       |
| `FN218`         | `double` | 有形资产/净债务(%)                                                                                                                                         |
| `FN219`         | `double` | 每股经营性现金流(元)                                                                                                                                         |
| `FN220`         | `double` | 营业收入现金含量(%)(非金融类指标)                                                                                                                                 |
| `FN221`         | `double` | 经营活动产生的现金流量净额/经营活动净收益(%)                                                                                                                            |
| `FN222`         | `double` | 销售商品提供劳务收到的现金/营业收入(%)                                                                                                                               |
| `FN223`         | `double` | 经营活动产生的现金流量净额/营业收入                                                                                                                                  |
| `FN224`         | `double` | 资本支出/折旧和摊销                                                                                                                                          |
| `FN225`         | `double` | 每股现金流量净额(元)                                                                                                                                         |
| `FN226`         | `double` | 经营净现金比率（短期债务）(非金融类指标)                                                                                                                               |
| `FN227`         | `double` | 经营净现金比率（全部债务）                                                                                                                                       |
| `FN228`         | `double` | 经营活动现金净流量与净利润比率                                                                                                                                     |
| `FN229`         | `double` | 全部资产现金回收率                                                                                                                                           |
| `FN230`         | `double` | 营业收入                                                                                                                                                |
| `FN231`         | `double` | 营业利润                                                                                                                                                |
| `FN232`         | `double` | 归属于母公司所有者的净利润                                                                                                                                       |
| `FN233`         | `double` | 扣除非经常性损益后的净利润                                                                                                                                       |
| `FN234`         | `double` | 经营活动产生的现金流量净额                                                                                                                                       |
| `FN235`         | `double` | 投资活动产生的现金流量净额                                                                                                                                       |
| `FN236`         | `double` | 筹资活动产生的现金流量净额                                                                                                                                       |
| `FN237`         | `double` | 现金及现金等价物净增加额                                                                                                                                        |
| `FN238`         | `double` | 总股本                                                                                                                                                 |
| `FN239`         | `double` | 已上市流通A股                                                                                                                                             |
| `FN240`         | `double` | 已上市流通B股                                                                                                                                             |
| `FN241`         | `double` | 已上市流通H股                                                                                                                                             |
| `FN242`         | `double` | 股东人数(户)                                                                                                                                             |
| `FN243`         | `double` | 第一大股东的持股数量                                                                                                                                          |
| `FN244`         | `double` | 十大流通股东持股数量合计(股)                                                                                                                                     |
| `FN245`         | `double` | 十大股东持股数量合计(股)                                                                                                                                       |
| `FN246`         | `double` | 机构总量（家）                                                                                                                                             |
| `FN247`         | `double` | 机构持股总量(股)                                                                                                                                           |
| `FN248`         | `double` | QFII机构数                                                                                                                                             |
| `FN249`         | `double` | QFII持股量                                                                                                                                             |
| `FN250`         | `double` | 券商机构数                                                                                                                                               |
| `FN251`         | `double` | 券商持股量                                                                                                                                               |
| `FN252`         | `double` | 保险机构数                                                                                                                                               |
| `FN253`         | `double` | 保险持股量                                                                                                                                               |
| `FN254`         | `double` | 基金机构数                                                                                                                                               |
| `FN255`         | `double` | 基金持股量                                                                                                                                               |
| `FN256`         | `double` | 社保机构数                                                                                                                                               |
| `FN257`         | `double` | 社保持股量                                                                                                                                               |
| `FN258`         | `double` | 私募机构数                                                                                                                                               |
| `FN259`         | `double` | 私募持股量                                                                                                                                               |
| `FN260`         | `double` | 财务公司机构数                                                                                                                                             |
| `FN261`         | `double` | 财务公司持股量                                                                                                                                             |
| `FN262`         | `double` | 年金机构数                                                                                                                                               |
| `FN263`         | `double` | 年金持股量                                                                                                                                               |
| `FN264`         | `double` | 十大流通股东持有的流通A股合计(股)[ 注：2019半年报之前，季度报告中，若股东持股除了流通A股、还有流通B股或流通H股，指标264取的是包含流通B股或流通H股的流通股数]                                                             |
| `FN265`         | `double` | 第一大流通股东持股量(股)                                                                                                                                       |
| `FN266`         | `double` | 自由流通股(股)[注：1.自由流通股=已流通A股-持股5%以上股东的流通A股（一致行动人算一起）；2.指标按报告期展示，新股在上市日的下个报告期才有数据]                                                                       |
| `FN267`         | `double` | 受限流通A股(股)                                                                                                                                           |
| `FN268`         | `double` | 一般风险准备(金融类)                                                                                                                                         |
| `FN269`         | `double` | 其他综合收益(利润表)                                                                                                                                         |
| `FN270`         | `double` | 综合收益总额(利润表)                                                                                                                                         |
| `FN271`         | `double` | 归属于母公司股东权益(资产负债表)                                                                                                                                   |
| `FN272`         | `double` | 银行机构数(家)(机构持股)                                                                                                                                      |
| `FN273`         | `double` | 银行持股量(股)(机构持股)                                                                                                                                      |
| `FN274`         | `double` | 一般法人机构数(家)(机构持股)                                                                                                                                    |
| `FN275`         | `double` | 一般法人持股量(股)(机构持股)                                                                                                                                    |
| `FN276`         | `double` | 近一年净利润(元)                                                                                                                                           |
| `FN277`         | `double` | 信托机构数(家)(机构持股)                                                                                                                                      |
| `FN278`         | `double` | 信托持股量(股)(机构持股)                                                                                                                                      |
| `FN279`         | `double` | 特殊法人机构数(家)(机构持股)                                                                                                                                    |
| `FN280`         | `double` | 特殊法人持股量(股)(机构持股)                                                                                                                                    |
| `FN281`         | `double` | 加权净资产收益率(每股指标)                                                                                                                                      |
| `FN282`         | `double` | 扣非每股收益(单季度财务指标)                                                                                                                                     |
| `FN283`         | `double` | 最近一年营业收入(万元)                                                                                                                                        |
| `FN284`         | `double` | 国家队持股数量（万股)[注：本指标统计包含汇金公司、证金公司、外汇管理局旗下投资平台、国家队基金、国开、养老金以及中科汇通等国家队机构持股数量]                                                                            |
| `FN285`         | `double` | 业绩预告-本期归母净利润同比增幅下限%[注：指标285至294展示未来一个报告期的数据。例，3月31日至6月29日这段时间内展示的是中报的数据；如果最新的财务报告后面有多个报告期的业绩预告/快报，只能展示最新的财务报告后面的一个报告期的业绩预告/快报]                      |
| `FN286`         | `double` | 业绩预告-本期归母净利润同比增幅上限%                                                                                                                                 |
| `FN287`         | `double` | 业绩快报-归母净利润                                                                                                                                          |
| `FN288`         | `double` | 业绩快报-扣非净利润                                                                                                                                          |
| `FN289`         | `double` | 业绩快报-总资产                                                                                                                                            |
| `FN290`         | `double` | 业绩快报-净资产                                                                                                                                            |
| `FN291`         | `double` | 业绩快报-每股收益                                                                                                                                           |
| `FN292`         | `double` | 业绩快报-摊薄净资产收益率                                                                                                                                       |
| `FN293`         | `double` | 业绩快报-加权净资产收益率                                                                                                                                       |
| `FN294`         | `double` | 业绩快报-每股净资产                                                                                                                                          |
| `FN295`         | `double` | 应付票据及应付账款(资产负债表)                                                                                                                                    |
| `FN296`         | `double` | 应收票据及应收账款(资产负债表)                                                                                                                                    |
| `FN297`         | `double` | 递延收益(资产负债表-非流动负债)                                                                                                                                   |
| `FN298`         | `double` | 其他综合收益(资产负债表)                                                                                                                                       |
| `FN299`         | `double` | 其他权益工具(资产负债表)                                                                                                                                       |
| `FN300`         | `double` | 其他收益(利润表)                                                                                                                                           |
| `FN301`         | `double` | 资产处置收益(利润表)                                                                                                                                         |
| `FN302`         | `double` | 持续经营净利润(利润表)                                                                                                                                        |
| `FN303`         | `double` | 终止经营净利润(利润表)                                                                                                                                        |
| `FN304`         | `double` | 研发费用(利润表)                                                                                                                                           |
| `FN305`         | `double` | 其中:利息费用(利润表-财务费用)                                                                                                                                   |
| `FN306`         | `double` | 其中:利息收入(利润表-财务费用)                                                                                                                                   |
| `FN307`         | `double` | 近一年经营活动现金流净额                                                                                                                                        |
| `FN308`         | `double` | 近一年归母净利润(万元)                                                                                                                                        |
| `FN309`         | `double` | 近一年扣非净利润(万元)                                                                                                                                        |
| `FN310`         | `double` | 近一年现金净流量(万元)                                                                                                                                        |
| `FN311`         | `double` | 基本每股收益（单季度）                                                                                                                                         |
| `FN312`         | `double` | 营业总收入(单季度)(万元)                                                                                                                                      |
| `FN313`         | `double` | 业绩预告公告日期 [注：本指标展示未来一个报告期的数据。例,3月31日至6月29日这段时间内展示的是中报的数据；如果最新的财务报告后面有多个报告期的业绩预告/快报，只能展示最新的财务报告后面的一个报告期的业绩预告/快报的数据；公告日期格式为YYMMDD，例：190101代表2019年1月1日] |
| `FN314`         | `double` | 财报公告日期 [注：日期格式为YYMMDD,例：190101代表2019年1月1日]                                                                                                          |
| `FN315`         | `double` | 业绩快报公告日期 [注：本指标展示未来一个报告期的数据。例,3月31日至6月29日这段时间内展示的是中报的数据；如果最新的财务报告后面有多个报告期的业绩预告/快报，只能展示最新的财务报告后面的一个报告期的业绩预告/快报的数据；公告日期格式为YYMMDD，例：190101代表2019年1月1日] |
| `FN316`         | `double` | 近一年投资活动现金流净额(万元)                                                                                                                                    |
| `FN317`         | `double` | 业绩预告-本期归母净利润下限(万元)[注：指标317至318展示未来一个报告期的数据。例，3月31日至6月29日这段时间内展示的是中报的数据；如果最新的财务报告后面有多个报告期的业绩预告/快报，只能展示最新的财务报告后面的一个报告期的业绩预告/快报]                       |
| `FN318`         | `double` | 业绩预告-本期归母净利润上限(万元)                                                                                                                                  |
| `FN319`         | `double` | 营业总收入TTM(万元)                                                                                                                                        |
| `FN320`         | `double` | 员工总数(人)                                                                                                                                             |
| `FN321`         | `double` | 每股企业自由现金流                                                                                                                                           |
| `FN322`         | `double` | 每股股东自由现金流                                                                                                                                           |
| `FN323`         | `double` | 近一年营业利润(万元)                                                                                                                                         |
| `FN324`         | `double` | 净利润（单季度）(万元)                                                                                                                                        |
| `FN325`         | `double` | 北上资金数（家）(机构持股）                                                                                                                                      |
| `FN326`         | `double` | 北上资金持股量（股）(机构持股）                                                                                                                                    |
| `FN327`         | `double` | 有息负债率                                                                                                                                               |
| `FN328`         | `double` | 营业成本（单季度）(万元)                                                                                                                                       |
| `FN329`         | `double` | 投入资本回报率（ROIC）(获利能力分析)                                                                                                                               |
| `FN330`         | `double` | 业绩快报-营业收入（本期）                                                                                                                                       |
| `FN331`         | `double` | 业绩快报-营业收入（上期）                                                                                                                                       |
| `FN332`         | `double` | 业绩快报-营业利润（本期）                                                                                                                                       |
| `FN333`         | `double` | 业绩快报-营业利润（上期）                                                                                                                                       |
| `FN334`         | `double` | 业绩快报-利润总额（本期）                                                                                                                                       |
| `FN335`         | `double` | 业绩快报-利润总额（上期）                                                                                                                                       |
| `FN336`         | `double` | 审计意见  [注：0-未审计,1-无保留意见,2-带强调事项段的无保留意见,3-保留意见,4-无法表示意见,5-否定意见及其他]                                                                                    |
| `FN337`         | `double` | 股利支付率（%）                                                                                                                                            |
| `FN338`         | `double` | 近一年营业成本-非金融类(万元)                                                                                                                                    |
| `FN339`         | `double` | 近一年营业成本-金融类(万元)                                                                                                                                     |
| `FN340`         | `double` | 业绩预告-本期扣非后净利润下限(万元)                                                                                                                                 |
| `FN341`         | `double` | 业绩预告-本期扣非后净利润上限(万元)                                                                                                                                 |
| `FN342`         | `double` | 业绩预告-本期扣非后净利润同比增长下限（%）                                                                                                                              |
| `FN343`         | `double` | 业绩预告-本期扣非后净利润同比增长上限（%）                                                                                                                              |
| `FN344`         | `double` | 业绩预告-预告基本每股收益下限(元)                                                                                                                                  |
| `FN345`         | `double` | 业绩预告-预告基本每股收益上限(元)                                                                                                                                  |
| `FN346`         | `double` | 业绩预告-预告基本每股收益同比增长下限（%）                                                                                                                              |
| `FN347`         | `double` | 业绩预告-预告基本每股收益同比增长上限（%）                                                                                                                              |
| `FN348`         | `double` | 业绩预告-预告扣非后基本每股收益下限(元)                                                                                                                               |
| `FN349`         | `double` | 业绩预告-预告扣非后基本每股收益上限(元)                                                                                                                               |
| `FN350`         | `double` | 业绩预告-预告扣非后基本每股收益同比增长下限（%）                                                                                                                           |
| `FN351`         | `double` | 业绩预告-预告扣非后基本每股收益同比增长上限（%）                                                                                                                           |
| `FN352`         | `double` | 业绩预告-预告营业收入下限(万元)                                                                                                                                   |
| `FN353`         | `double` | 业绩预告-预告营业收入上限(万元)                                                                                                                                   |
| `FN354`         | `double` | 业绩预告-预告营业收入同比增长下限（%）                                                                                                                                |
| `FN355`         | `double` | 业绩预告-预告营业收入同比增长上限（%）                                                                                                                                |
| `FN356`         | `double` | 业绩预告-预告扣除后营业收入下限(万元)                                                                                                                                |
| `FN357`         | `double` | 业绩预告-预告扣除后营业收入上限(万元)                                                                                                                                |
| `FN358`         | `double` | 主营业务收入(内销)(万元)                                                                                                                                      |
| `FN359`         | `double` | 主营业务收入(外销)(万元)                                                                                                                                      |
| `FN360`         | `double` | 资管计划机构数(家)                                                                                                                                          |
| `FN361`         | `double` | 资管计划持股量(股)                                                                                                                                          |
| `FN362`         | `double` | 财务总评分                                                                                                                                               |
| `FN401`         | `double` | 专项储备(万元)                                                                                                                                            |
| `FN402`         | `double` | 结算备付金(万元)                                                                                                                                           |
| `FN403`         | `double` | 拆出资金(万元)                                                                                                                                            |
| `FN404`         | `double` | 发放贷款及垫款(万元)(流动资产科目)                                                                                                                                 |
| `FN405`         | `double` | 衍生金融资产(万元)                                                                                                                                          |
| `FN406`         | `double` | 应收保费(万元)                                                                                                                                            |
| `FN407`         | `double` | 应收分保账款(万元)                                                                                                                                          |
| `FN408`         | `double` | 应收分保合同准备金(万元)                                                                                                                                       |
| `FN409`         | `double` | 买入返售金融资产(万元)                                                                                                                                        |
| `FN410`         | `double` | 划分为持有待售的资产(万元)                                                                                                                                      |
| `FN411`         | `double` | 发放贷款及垫款(万元)(非流动资产科目)                                                                                                                                |
| `FN412`         | `double` | 向中央银行借款(万元)                                                                                                                                         |
| `FN413`         | `double` | 吸收存款及同业存放(万元)                                                                                                                                       |
| `FN414`         | `double` | 拆入资金(万元)                                                                                                                                            |
| `FN415`         | `double` | 衍生金融负债(万元)                                                                                                                                          |
| `FN416`         | `double` | 卖出回购金融资产款(万元)                                                                                                                                       |
| `FN417`         | `double` | 应付手续费及佣金(万元)                                                                                                                                        |
| `FN418`         | `double` | 应付分保账款(万元)                                                                                                                                          |
| `FN419`         | `double` | 保险合同准备金(万元)                                                                                                                                         |
| `FN420`         | `double` | 代理买卖证券款(万元)                                                                                                                                         |
| `FN421`         | `double` | 代理承销证券款(万元)                                                                                                                                         |
| `FN422`         | `double` | 划分为持有待售的负债(万元)                                                                                                                                      |
| `FN423`         | `double` | 预计负债(万元) （流动负债）                                                                                                                                     |
| `FN424`         | `double` | 递延收益(万元)（流动负债科目，公告此科目的股票较少，大部分公司没有此数据）                                                                                                              |
| `FN425`         | `double` | 其中:优先股(万元)(非流动负债科目)                                                                                                                                 |
| `FN426`         | `double` | 永续债(万元)(非流动负债科目)                                                                                                                                    |
| `FN427`         | `double` | 长期应付职工薪酬(万元)                                                                                                                                        |
| `FN428`         | `double` | 其中:优先股(万元)(所有者权益科目)                                                                                                                                 |
| `FN429`         | `double` | 永续债(万元)(所有者权益科目)                                                                                                                                    |
| `FN430`         | `double` | 债权投资(万元)                                                                                                                                            |
| `FN431`         | `double` | 其他债权投资(万元)                                                                                                                                          |
| `FN432`         | `double` | 其他权益工具投资(万元)                                                                                                                                        |
| `FN433`         | `double` | 其他非流动金融资产(万元)                                                                                                                                       |
| `FN434`         | `double` | 合同负债(万元)                                                                                                                                            |
| `FN435`         | `double` | 合同资产(万元)                                                                                                                                            |
| `FN436`         | `double` | 其他资产(万元)                                                                                                                                            |
| `FN437`         | `double` | 应收款项融资(万元)                                                                                                                                          |
| `FN438`         | `double` | 使用权资产(万元)                                                                                                                                           |
| `FN439`         | `double` | 租赁负债(万元)                                                                                                                                            |
| `FN440`         | `double` | 发放贷款及垫款(万元)  [注：金融类科目]                                                                                                                              |
| `FN441`         | `double` | 应收款项(万元)  [注：证券类指标]                                                                                                                                 |
| `FN442`         | `double` | 存出保证金(万元)  [注：证券类指标]                                                                                                                                |
| `FN443`         | `double` | 现金及存放中央银行款项(万元)  [注：金融类科目]                                                                                                                          |
| `FN444`         | `double` | 贵金属(万元)  [注：金融类科目]                                                                                                                                  |
| `FN445`         | `double` | 以公允价值计量且其变动计入当期损益的金融资产(万元)  [注：金融类科目]                                                                                                               |
| `FN446`         | `double` | 代理业务资产(万元)  [注：金融类科目]                                                                                                                               |
| `FN447`         | `double` | 应收款项类投资(万元)  [注：金融类科目]                                                                                                                              |
| `FN448`         | `double` | 同业及其它金融机构存放款项(万元)  [注：金融类科目]                                                                                                                        |
| `FN449`         | `double` | 以公允价值计量且其变动计入当期损益的金融负债(万元)  [注：金融类科目]                                                                                                               |
| `FN450`         | `double` | 吸收存款(万元)  [注：金融类科目]                                                                                                                                 |
| `FN451`         | `double` | 代理业务负债(万元)  [注：金融类科目]                                                                                                                               |
| `FN452`         | `double` | 其他负债(万元)  [注：金融类科目]                                                                                                                                 |
| `FN453`         | `double` | 发放贷款及垫款(万元)  [注：金融类科目]                                                                                                                              |
| `FN501`         | `double` | 稀释每股收益(元)                                                                                                                                           |
| `FN502`         | `double` | 营业总收入(万元)                                                                                                                                           |
| `FN503`         | `double` | 汇兑收益(万元)                                                                                                                                            |
| `FN504`         | `double` | 其中:归属于母公司综合收益(万元)                                                                                                                                   |
| `FN505`         | `double` | 其中:归属于少数股东综合收益(万元)                                                                                                                                  |
| `FN506`         | `double` | 利息收入(万元)                                                                                                                                            |
| `FN507`         | `double` | 已赚保费(万元)                                                                                                                                            |
| `FN508`         | `double` | 手续费及佣金收入(万元)                                                                                                                                        |
| `FN509`         | `double` | 利息支出(万元)                                                                                                                                            |
| `FN510`         | `double` | 手续费及佣金支出(万元)                                                                                                                                        |
| `FN511`         | `double` | 退保金(万元)                                                                                                                                             |
| `FN512`         | `double` | 赔付支出净额(万元)                                                                                                                                          |
| `FN513`         | `double` | 提取保险合同准备金净额(万元)                                                                                                                                     |
| `FN514`         | `double` | 保单红利支出(万元)                                                                                                                                          |
| `FN515`         | `double` | 分保费用(万元)                                                                                                                                            |
| `FN516`         | `double` | 其中:非流动资产处置利得(万元)                                                                                                                                    |
| `FN517`         | `double` | 信用减值损失(万元)                                                                                                                                          |
| `FN518`         | `double` | 净敞口套期收益(万元)                                                                                                                                         |
| `FN519`         | `double` | 营业总成本(万元)                                                                                                                                           |
| `FN520`         | `double` | 信用减值损失(万元、2019格式)                                                                                                                                   |
| `FN521`         | `double` | 资产减值损失(万元、2019格式)                                                                                                                                   |
| `FN522`         | `double` | 其他业务收入(万元)  [注：金融类科目]                                                                                                                               |
| `FN523`         | `double` | 业务及管理费(万元)  [注：金融类科目]                                                                                                                               |
| `FN524`         | `double` | 其他业务成本(万元)  [注：金融类科目]                                                                                                                               |
| `FN561`         | `double` | 加:其他原因对现金的影响2(万元)(现金的期末余额科目)                                                                                                                        |
| `FN562`         | `double` | 客户存款和同业存放款项净增加额(万元)                                                                                                                                 |
| `FN563`         | `double` | 向中央银行借款净增加额(万元)                                                                                                                                     |
| `FN564`         | `double` | 向其他金融机构拆入资金净增加额(万元)                                                                                                                                 |
| `FN565`         | `double` | 收到原保险合同保费取得的现金(万元)                                                                                                                                  |
| `FN566`         | `double` | 收到再保险业务现金净额(万元)                                                                                                                                     |
| `FN567`         | `double` | 保户储金及投资款净增加额(万元)                                                                                                                                    |
| `FN568`         | `double` | 处置以公允价值计量且其变动计入当期损益的金融资产净增加额(万元)                                                                                                                    |
| `FN569`         | `double` | 收取利息、手续费及佣金的现金(万元)                                                                                                                                  |
| `FN570`         | `double` | 拆入资金净增加额(万元)                                                                                                                                        |
| `FN571`         | `double` | 回购业务资金净增加额(万元)                                                                                                                                      |
| `FN572`         | `double` | 客户贷款及垫款净增加额(万元)                                                                                                                                     |
| `FN573`         | `double` | 存放中央银行和同业款项净增加额(万元)                                                                                                                                 |
| `FN574`         | `double` | 支付原保险合同赔付款项的现金(万元)                                                                                                                                  |
| `FN575`         | `double` | 支付利息、手续费及佣金的现金(万元)                                                                                                                                  |
| `FN576`         | `double` | 支付保单红利的现金(万元)                                                                                                                                       |
| `FN577`         | `double` | 其中:子公司吸收少数股东投资收到的现金(万元)                                                                                                                             |
| `FN578`         | `double` | 其中:子公司支付给少数股东的股利、利润(万元)                                                                                                                             |
| `FN579`         | `double` | 投资性房地产的折旧及摊销(万元)                                                                                                                                    |
| `FN580`         | `double` | 信用减值损失(万元)                                                                                                                                          |
| `FN581`         | `double` | 使用权资产折旧（万元）                                                                                                                                         |
| `FN582`         | `double` | 收取利息和手续费净增加额(万元)  [注：金融类科目]                                                                                                                         |
| `FN583`         | `double` | 支付手续费的现金(万元)  [注：金融类科目]                                                                                                                             |
| `FN584`         | `double` | 发行债券支付的现金(万元)  [注：金融类科目]                                                                                                                            |

## 附录 G

### get_gpjy_value：股票交易专业数据（GP01~GP46）

| 字段     | 类型       | 说明                                                                                                       |
| ------ | -------- | -------------------------------------------------------------------------------------------------------- |
| `GP01` | `double` | 股东人数 股东户数(户)                                                                                             |
| `GP02` | `double` | 龙虎榜   买入总计(万元) 卖出总计(万元)[注：该指标展示20230717日之后的数据]                                                           |
| `GP03` | `double` | 融资融券1 融资余额(万元) 融券余量(股)                                                                                   |
| `GP04` | `double` | 大宗交易 成交均价(元) 成交额(万元)                                                                                     |
| `GP05` | `double` | 增减持1   成交均价(元) 变动股数(股)                                                                                   |
| `GP06` | `double` | 陆股通持股量  持股数量(股)[注：该指标展示20170317日之后的数据]                                                                   |
| `GP07` | `double` | 陆股通市场成交净额  陆股通市场净买入(万元)[注：官方只公布了每日的前十名数据]                                                                |
| `GP08` | `double` | 龙虎榜机构(卖方)数据  卖方机构个数 机构卖出金额(万元)                                                                           |
| `GP09` | `double` | 龙虎榜机构(买方)数据  买方机构个数 机构买入金额(万元)                                                                           |
| `GP10` | `double` | 近3月机构调研情况  近3月机构调研次数 近3月调研机构数量                                                                           |
| `GP11` | `double` | 融资融券2 融资买入额(万元) 融资偿还额(万元)                                                                                |
| `GP12` | `double` | 融资融券3 融券卖出量(股) 融券偿还量(股)                                                                                  |
| `GP13` | `double` | 融资融券4 融资净买入(万元) 融券净卖出(股)                                                                                 |
| `GP14` | `double` | 涨停数据 涨停金额(即板上成交,万元) 开板次数[注：该指标展示20180319日之后的数据]                                                          |
| `GP15` | `double` | 涨跌停 涨跌停状态 封单金额(万元)[注：涨停取2,曾涨停取1,跌停取-2,曾跌停取-1;跌停和曾跌停时,封单金额取负值 该指标展示20160926日之后的数据]                        |
| `GP16` | `double` | 总市值 总市值(万元)                                                                                              |
| `GP17` | `double` | 龙虎榜营业部数据    买入金额(万元) 卖出金额(万元)                                                                            |
| `GP18` | `double` | 龙虎榜沪深股通数据  买入金额(万元) 卖出金额(万元)                                                                             |
| `GP19` | `double` | 每周股票质押数量    无限售股份质押数(万) 有限售股份质押数(万)[注：该指标展示20180316日之后的数据]                                               |
| `GP20` | `double` | 每周股票质押比例    质押比例(%)[注：该指标展示20180316日之后的数据]                                                               |
| `GP21` | `double` | 股息率 股息率(%)                                                                                               |
| `GP22` | `double` | 涨跌停 封成比 封流比[注：该指标展示20180319日之后的数据]                                                                       |
| `GP23` | `double` | 拟增减持 拟增持数量(万股) 拟减持数量(万股)                                                                                 |
| `GP24` | `double` | 涨停  首次涨停时间  涨停最大封单额(万) [注：首次涨停时间展示20160301之后的数据，涨停最大封单额展示20200730之后的数据]                                  |
| `GP25` | `double` | 盘前盘后成交量  开盘成交量(手)  盘后固定成交量(手)  [注：盘后固定成交量只包含科创板和创业板]                                                     |
| `GP26` | `double` | 拟增减持金额  拟增持金额(万元)  拟减持金额(万元)                                                                             |
| `GP27` | `double` | 人气排名  市场人气排名  行业人气排名  [注：行业排名为通达信二级研究行业排名]                                                               |
| `GP28` | `double` | 股票回购  回购均价(元)  回购数量(万股)                                                                                  |
| `GP29` | `double` | 证券信息  是否复牌日  是否更名日  [注：是否复牌日说明：0-不是复牌日，n(n>0)-停牌n个交易日之后的复牌日；是否更名日说明：0-未更名，1-常规更名，2-加ST，3-加*ST，4-摘帽，5-其他] |
| `GP30` | `double` | 分红送转  派息金额(万元)  送转数量(股)  [注：对应展示日期为除权除息日]                                                                |
| `GP31` | `double` | 转融券  期初余量(股)  期末余量(股)                                                                                    |
| `GP32` | `double` | 转融券  融出数量(股)  融出市值(元)                                                                                    |
| `GP33` | `double` | 跌停数据  跌停金额(万元)  开板次数 [注：该指标展示20180319日之后的数据,暂无跌停金额数据]                                                    |
| `GP34` | `double` | 跌停  首次跌停时间  跌停最大封单额(万) [注：首次跌停时间展示20160301之后的数据，跌停最大封单额展示20200730之后的数据]                                  |
| `GP35` | `double` | 增减持2  增持数量(股) 减持数量(股)                                                                                    |
| `GP36` | `double` | 竞价涨停买  买入金额(万元) [注：该指标展示20241101日之后的数据]                                                                  |
| `GP37` | `double` | 龙虎榜2  上榜类型连续交易日(天) [注：该指标展示上榜类型中指代的连续交易日类型]                                                              |
| `GP38` | `double` | 涨停相关1  近1年涨停次数  近1年溢价5%次数                                                                                |
| `GP39` | `double` | 涨停相关2  近1年首板封板率(%)  近1年次日红盘率(%)                                                                          |
| `GP40` | `double` | 涨停相关3  近1年连板率(%)  最后涨停时间                                                                                 |
| `GP41` | `double` | 股权登记日  配股股权登记日                                                                                           |
| `GP42` | `double` | 龙虎榜专业机构买卖净额  买方成交净额(万元)  卖方成交净额(万元)                                                                      |
| `GP43` | `double` | 配股实施  配股价格(元)  配股数量(万股)                                                                                  |
| `GP44` | `double` | 股票评分  综合评分                                                                                               |
| `GP45` | `double` | 评级系数  评级系数                                                                                               |
| `GP46` | `double` | 拟询价转让  拟转让股数(万股)  拟转让占总股本(%)                                                                             |

## 附录 H

### get_bkjy_value：板块交易专业数据（BK5~BK19）

| 字段     | 类型       | 说明                                                                     |
| ------ | -------- | ---------------------------------------------------------------------- |
| `BK5`  | `double` | 市盈率TTM   整体法  算术平均                                                     |
| `BK6`  | `double` | 市净率MRQ   整体法  算术平均                                                     |
| `BK7`  | `double` | 市销率TTM   整体法  算术平均                                                     |
| `BK8`  | `double` | 市现率TTM   整体法  算术平均                                                     |
| `BK9`  | `double` | 涨跌数   上涨家数  下跌家数                                                       |
| `BK10` | `double` | 板块总市值(亿元)   整体法  算术平均                                                  |
| `BK11` | `double` | 板块流通市值(亿元) 整体法  算术平均                                                   |
| `BK12` | `double` | 涨停数   涨停家数  曾涨停家数[注：该指标展示20160926日之后的数据]                               |
| `BK13` | `double` | 跌停数   跌停家数  曾跌停家数[注：该指标展示20160926日之后的数据]                               |
| `BK14` | `double` | 涨停数据  市场高度(不含ST股和未开板新股)  2板及以上涨停个数(不含ST股和未开板新股)[注：该指标展示20180319日之后的数据] |
| `BK15` | `double` | 融资融券  沪深京融资余额(万元)   沪深京融券余额(万元)                                        |
| `BK16` | `double` | 陆股通资金流入  沪股通流入金额(亿元)  深股通流入金额(亿元) [注：该指标展示20170320日之后的数据]              |
| `BK17` | `double` | 开盘成交数    开盘成交额(万元)  开盘成交量(万股)                                          |
| `BK18` | `double` | 板块股息率(%)   算数平均  整体法                                                   |
| `BK19` | `double` | 板块自由流通市值(亿元)  整体法  算术平均                                                |

## 附录 I

### get_scjy_value：市场交易专业数据（SC01~SC42）

| 字段     | 类型       | 说明                                                                                           |
| ------ | -------- | -------------------------------------------------------------------------------------------- |
| `SC01` | `double` | 融资融券       沪深京融资余额(万元) 沪深京融券余额(万元)                                                           |
| `SC02` | `double` | 陆股通资金流入 沪股通流入金额(亿元) 深股通流入金额(亿元)[注：沪股通限制展示2000条数据，深股通展示自20161205以后的数据]                        |
| `SC03` | `double` | 沪深京涨停股个数 涨停股个数  曾涨停股个数 [注：该指标展示20160926日之后的数据]                                               |
| `SC04` | `double` | 沪深京跌停股个数 跌停股个数  曾跌停股个数 [注：该指标展示20160926日之后的数据]                                               |
| `SC05` | `double` | 上证50股指期货  净持仓(手)[注：该指标展示20171009日之后的数据]                                                      |
| `SC06` | `double` | 沪深300股指期货 净持仓(手) [注：该指标展示20171009日之后的数据]                                                     |
| `SC07` | `double` | 中证500股指期货 净持仓(手) [注：该指标展示20171009日之后的数据]                                                     |
| `SC08` | `double` | ETF基金规模份额数据 ETF基金规模(亿份) ETF净申赎(亿份)                                                           |
| `SC09` | `double` | 沪月新开A股账户   沪月新开A股账户(万户)                                                                      |
| `SC10` | `double` | 增减持统计    增持额(万元)  减持额(万元)[注：部分公司公告滞后,造成每天查看的数据可能会不一样]                                        |
| `SC11` | `double` | 大宗交易      溢价的大宗交易额(万元) 折价的大宗交易额(万元)                                                          |
| `SC12` | `double` | 限售解禁      限售解禁计划额(亿元)  限售解禁股份实际上市金额(亿元)[注：该指标展示201802月之后的数据;部分股票的解禁日期延后，造成不同日期提取的某天的计划额可能不同] |
| `SC13` | `double` | 分红    市场总分红额(亿元)[注：除权派息日的A股市场总分红额]                                                           |
| `SC14` | `double` | 募资    市场总募资额(亿元)[注：发行日期/除权日期的首发、配股和增发的总募资额]                                                  |
| `SC15` | `double` | 打板资金    封板成功资金(亿元) 封板失败资金(亿元) [注：该指标展示20160926日之后的数据]                                        |
| `SC16` | `double` | 龙虎榜    买入总金额(亿元) 卖出总金额(亿元)                                                                   |
| `SC17` | `double` | 龙虎榜机构数据    买入金额(亿元) 卖出金额(亿元)                                                                 |
| `SC18` | `double` | 龙虎榜营业部数据    买入金额(亿元) 卖出金额(亿元)                                                                |
| `SC19` | `double` | 龙虎榜沪深股通数据    买入金额(亿元) 卖出金额(亿元)                                                               |
| `SC20` | `double` | 陆股通净买入    沪股通净买入额(亿元) 深股通净买入额(亿元)                                                            |
| `SC21` | `double` | 每周无限售质押率    深市质押率(%) 沪市质押率(%)[注：该指标展示20180128日之后的数据]                                         |
| `SC22` | `double` | 每周有限售质押率    深市质押率(%) 沪市质押率(%)[注：该指标展示20180128日之后的数据]                                         |
| `SC23` | `double` | 连板家数    连板股个数(包含ST和未开板新股)  连板股个数(不含ST股和未开板新股）[注：该指标展示20180319日之后的数据]                         |
| `SC24` | `double` | 沪深京涨跌停股个数    涨停股个数(不含ST股和未开板新股) 跌停股个数（不含ST股）[注：该指标展示20160926日之后的数据]                          |
| `SC25` | `double` | 融资融券    沪深京融资买入额（万元）沪深京融券卖出量（万股）                                                             |
| `SC26` | `double` | 每周市场质押比     每周市场质押比例（%）[注：该指标展示20180316日之后的数据]                                               |
| `SC27` | `double` | 央行公开市场净投放    央行公开市场净投放 (亿元)                                                                  |
| `SC28` | `double` | 历史A股新高新低数  历史新高A股股票个数 历史新低A股股票个数(上市满一年的股票)                                                   |
| `SC29` | `double` | 120天A股新高新低数 120天新高A股股票个数 120天新低A股股票个数(上市满一年的股票)                                              |
| `SC30` | `double` | 涨停数据  市场高度(不含ST股和未开板新股)  2板以上涨停个数(不含ST股和未开板新股)[注：该指标展示20180319日之后的数据]                        |
| `SC31` | `double` | 涨跌家数   涨家数（剔除停牌）  跌家数（剔除停牌）                                                                  |
| `SC32` | `double` | 20天A股新高新低数 20天新高A股股票个数 20天新低A股股票个数(上市满一年的股票)                                                 |
| `SC33` | `double` | 市场总封单金额  涨停封单金额（亿元）跌停封单金额（亿元）[注：该指标展示20160926日之后的数据]                                         |
| `SC34` | `double` | 涨跌股成交量    上涨股成交量(万手)  下跌股成交量(万手)                                                             |
| `SC35` | `double` | 涨停数据   换手板家数  回封率(%)  [注：两个指标都剔除了未开板新股，换手板家数展示20190605日之后的数据，回封率展示20180927日之后的数据]            |
| `SC36` | `double` | 曾涨跌停股个数	曾涨停股个数(剔除ST股和未开板新股)	曾跌停股个数(剔除ST股) [注：该指标展示20160926日之后的数据]                            |
| `SC37` | `double` | 转融券  融出市值(亿元)  期末余额(亿元)                                                                      |
| `SC38` | `double` | ETF基金规模金额数据  ETF基金规模(亿元)  ETF净申赎(亿元)                                                         |
| `SC39` | `double` | 涨跌5%家数  涨幅大于等于5%家数  跌幅大于等于5%家数                                                               |
| `SC40` | `double` | 陆股通成交  陆股通成交总额(亿元) 陆股通成交总笔(万笔)                                                               |
| `SC41` | `double` | 中证1000股指期货 净持仓(手) [注：该指标展示20220722日之后的数据]                                                    |
| `SC42` | `double` | 沪深股通成交金额  沪股通成交总额(亿元)  深股通成交总额(亿元)                                                           |

## 附录 J

### get_gp_one_data：股票单项数据（GO1~GO47）

| 字段     | 类型       | 说明                                    |
| ------ | -------- | ------------------------------------- |
| `GO1`  | `double` | 发行价(元)                                |
| `GO2`  | `double` | 总发行数量(万股)                             |
| `GO3`  | `double` | 一致预期目标价(元)[注：一致预期值均为近半年内各家机构预测数值的平均值] |
| `GO4`  | `double` | 一致预期T年度                               |
| `GO5`  | `double` | 一致预期T年每股收益                            |
| `GO6`  | `double` | 一致预期T+1年每股收益                          |
| `GO7`  | `double` | 一致预期T+2年每股收益                          |
| `GO8`  | `double` | 一致预期T年净利润(万元)                         |
| `GO9`  | `double` | 一致预期T+1年净利润(万元)                       |
| `GO10` | `double` | 一致预期T+2年净利润(万元)                       |
| `GO11` | `double` | 一致预期T年营业收入(万元)                        |
| `GO12` | `double` | 一致预期T+1年营业收入(万元)                      |
| `GO13` | `double` | 一致预期T+2年营业收入(万元)                      |
| `GO14` | `double` | 一致预期T年营业利润(万元)                        |
| `GO15` | `double` | 一致预期T+1年营业利润(万元)                      |
| `GO16` | `double` | 一致预期T+2年营业利润(万元)                      |
| `GO17` | `double` | 一致预期T年每股净资产(元)                        |
| `GO18` | `double` | 一致预期T+1年每股净资产(元)                      |
| `GO19` | `double` | 一致预期T+2年每股净资产(元)                      |
| `GO20` | `double` | 一致预期T年净资产收益率(%)                       |
| `GO21` | `double` | 一致预期T+1年净资产收益率(%)                     |
| `GO22` | `double` | 一致预期T+2年净资产收益率(%)                     |
| `GO23` | `double` | 一致预期T年PE                              |
| `GO24` | `double` | 一致预期T+1年PE                            |
| `GO25` | `double` | 一致预期T+2年PE                            |
| `GO26` | `double` | 最新解禁日(YYMMDD格式)                       |
| `GO27` | `double` | 最新解禁数量（万股）                            |
| `GO28` | `double` | 下一报告期的预约披露时间                          |
| `GO29` | `double` | 最新持股机构家数                              |
| `GO30` | `double` | 最新机构持股总量（万股）                          |
| `GO31` | `double` | 最新持股基金家数                              |
| `GO32` | `double` | 最新基金持股量（万股）                           |
| `GO33` | `double` | 最新总股本（万股）                             |
| `GO34` | `double` | 最新实际流通A股（万股）                          |
| `GO35` | `double` | 最新业绩预告 报告期(YYMMDD格式)                  |
| `GO36` | `double` | 最新业绩预告 本期归母净利润下限（万元）                  |
| `GO37` | `double` | 最新业绩预告 本期归母净利润上限（万元）                  |
| `GO38` | `double` | 最新业绩预告 本期归母净利润预计同比增减幅下限%              |
| `GO39` | `double` | 最新业绩预告 本期归母净利润预计同比增减幅上限%              |
| `GO40` | `double` | 最新业绩快报 报告期                            |
| `GO41` | `double` | 最新业绩快报 归母净利润（万元）                      |
| `GO42` | `double` | 分红募资 派现总额（万元）                         |
| `GO43` | `double` | 分红募资 募资总额（万元）                         |
| `GO44` | `double` | 最新业绩预告 本期扣非净利润下限(万元)                  |
| `GO45` | `double` | 最新业绩预告 本期扣非净利润上限(万元)                  |
| `GO46` | `double` | 最新业绩预告 本期扣非净利润预计同比增减幅下限%              |
| `GO47` | `double` | 最新业绩预告 本期扣非净利润预计同比增减幅上限%              |

## 附录 K

| 字段        | 类型           | 说明           |
| --------- | ------------ | ------------ |
| `ErrorId` | `str`        | 错误码，`0` 表示成功 |
| `Value`   | `str/Object` | 返回结果或状态信息    |

> 交易接口的 `Value` 结构由各接口（委托/持仓/资产/下单/撤单）返回，字段以实际响应为准。


---

## 故障排除

### "TQ数据接口初始化失败或已有同名策略运行"
1. 确保通达信客户端已运行并登录
2. 使用 `sys.path.insert(0, ...)` 而非 `sys.path.append()`
3. 确认 `PYPlugins/` 目录下存在 `TPyth.dll` 和 `TPythClient.dll`
4. 检查是否已有相同 `__file__` 路径的策略在运行（ErrorId='12'）

### 菜单一直显示"正在开启TQ策略..."
检查是否有防火墙弹窗，若有请允许访问。

### 获取数据时指标值前面是 None
`count` 参数设置的K线数量不足以覆盖公式计算中的最大参数值。例如 `MA(C,20)` 需要至少20根K线，若 `count=10` 则前10根K线的MA值为 None。

### `send_warn` 报 ValueError
- 确认 `count > 0`
- 确认 `stock_list`、`price_list`、`close_list`、`volum_list` 的长度均 ≥ `count`
- 确认 `price_list`、`close_list`、`volum_list` 中的元素均为纯数字字符串

### 批量公式选股结果比客户端少
`count` 参数设置太小，不够覆盖公式计算所需的最大回溯K线数，适当增大 `count` 值。

> 注：接口已自动续取并合并服务端批次（`BatchFormulaPaged`）返回的完整股票池结果，结果偏少一般不再是服务端分批截断所致。

### Module Not Found 错误
- 确认 `PYPlugins/user` 路径正确
- 使用绝对路径而非相对路径
- 使用 `sys.path.insert(0, ...)` 保证优先加载

---

## 技术说明

### 版本信息
- **tqcenter.py 版本**：1.2.0（2026-09-20）
- **Python 支持**：3.7 ~ 3.14（64位），推荐 3.13

### 依赖项
- **TPyth.dll / TPythClient.dll**：与通达信客户端通信，位于 `PYPlugins/` 目录下（`tqcenter.py` 所在目录的上级目录）
- **Python库**：`json`, `ctypes`, `numpy`, `pandas`, `weakref`, `sys`, `os`, `shutil`, `time`, `pathlib`, `typing`, `collections`, `datetime`, `re`, `atexit`, `inspect`, `concurrent.futures`, `threading`
- **可选第三方库**：`vectorbt`（回测），`plotly`（图形）

### refresh_cache 市场代码对照表
| 字符串 | 含义 |
|--------|------|
| `'AG'` | A股（默认） |
| `'QH'` | 国内期货 |
| `'HK'` | 港股 |
| `'US'` | 美股 |
| `'NQ'` | 新三板 |
| `'QQ'` | 股票期权 |
| `'ZZ'` | 中证指数 |
| `'ZS'` | 综合指数 |
| `'OF'` | 开放式基金 |
