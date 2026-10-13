# 05 安全

## 凭证安全

请为 AI Hub 单独创建 API 凭证，并按最小权限原则授权。

* 只查看行情时，不需要 API Key；
* 查询账户、订单、钱包时，需要相应的只读权限；
* 下单、撤单、划转等状态改变操作，需要对应交易或资金权限；
* 不要把 API Key、Secret Key、`~/.ai-hub/config.toml` 或终端历史上传到 GitHub、聊天记录或共享文档；
* 建议按平台能力配置 IP 白名单、权限范围和有效期。

当前版本将凭证保存于本机 `~/.ai-hub/config.toml`，配置目录权限为 `700`，配置文件权限为 `600`。`ai-hub config show` 不会打印密钥值，但本机账户和磁盘安全仍由使用者负责。

## 所有写操作必须二次确认

下单、撤单、划转、提现、子账户变更等改变状态的操作，均遵循以下流程：

{% stepper %}
{% step %}
## 生成预览

Agent 或 CLI 调用写操作，只校验参数并返回**预览**。
{% endstep %}

{% step %}
## 查看预览

预览包含操作摘要、`confirmationId` 和过期时间。
{% endstep %}

{% step %}
## 等待用户确认

Agent 必须停止，等待用户在预览**之后**发送一条新的、明确的确认消息。
{% endstep %}

{% step %}
## 执行确认

收到新消息后，才可使用 `confirmationId` 执行确认。
{% endstep %}

{% step %}
## 确认记录失效

确认记录只可消费一次，默认 5 分钟后失效。
{% endstep %}
{% endstepper %}

CLI 示例：

```bash
# 第一步：只生成预览，不会提交订单
ai-hub spot order market-sell \
  --symbol ETHUSDT \
  --base-quantity 0.5 \
  --profile default

# 第二步：仅在收到新的用户明确确认后执行
ai-hub confirm \
  --confirmation-id <confirmation-id> \
  --user-confirmation "yes" \
  --profile default
```

MCP 中的规则相同：先调用对应 `*_prepare_*` 工具，展示预览并停止；只有收到新的用户确认消息后，才可调用 `confirm_action`。Agent 不得自行生成、猜测或重复使用确认文本。

## 下单前本地规则检查

创建订单预览前，系统会按 Profile 懒加载并缓存币对规则，包括价格精度、数量精度和最小下单限制。缓存有效期为 1 小时。已知的精度或最小值不符合时会在本地直接拒绝，避免生成不可执行预览。

本地检查不代表成交保证。下单前后的余额、价格、市场状态和服务端风控规则都可能变化。若写操作返回网络不确定错误，请不要自动重试；应先按客户端订单号或历史记录核实最终结果。
