# Futures operation reference

Generated from the Core registry. Writes expose prepare tools and require a separate confirm_action. All CLI commands use --profile futures.

| MCP tool | CLI command | Required input | HTTP |
| --- | --- | --- | --- |
| futures_ping | ai-hub futures ping | None | GET /fapi/v1/ping |
| futures_time | ai-hub futures time | None | GET /fapi/v1/time |
| futures_contracts | ai-hub futures contracts | None | GET /fapi/v1/contracts |
| futures_depth | ai-hub futures market depth | contractName | GET /fapi/v1/depth |
| futures_ticker | ai-hub futures market ticker | contractName | GET /fapi/v1/ticker |
| futures_index | ai-hub futures market index | contractName | GET /fapi/v1/index |
| futures_klines | ai-hub futures market klines | contractName, interval | GET /fapi/v1/klines |
| futures_assets | ai-hub futures account assets | None | GET /fapi/v1/account |
| futures_positions | ai-hub futures account positions | None | GET /fapi/v1/account |
| futures_order_detail | ai-hub futures order detail | contractName | GET /fapi/v1/order |
| futures_open_orders | ai-hub futures order open | None | GET /fapi/v1/openOrders |
| futures_order_history | ai-hub futures order history | contractName | POST /fapi/v1/orderHistorical |
| futures_profit_history | ai-hub futures account profit-history | None | POST /fapi/v1/profitHistorical |
| futures_my_trades | ai-hub futures order trades | contractName | GET /fapi/v1/myTrades |
| futures_transactions | ai-hub futures account transactions | symbol, beginTime, endTime | POST /fapi/v1/get_user_transaction |
| futures_trigger_orders | ai-hub futures order triggers | contractName | POST /fapi/v1/trigger_order_list |
| futures_prepare_place_order | ai-hub futures trade place | contractName, intent, type, quantity, unit, marginMode | POST /fapi/v1/order |
| futures_prepare_place_condition_order | ai-hub futures trade condition | contractName, intent, type, quantity, unit, marginMode, triggerPrice, triggerType | POST /fapi/v1/conditionOrder |
| futures_prepare_place_profit_loss_order | ai-hub futures trade profit-loss | contractName, side, orderList | POST /fapi/v1/profitLossOrder |
| futures_prepare_cancel_order | ai-hub futures order cancel | contractName, orderId | POST /fapi/v1/cancel |
| futures_prepare_cancel_all_orders | ai-hub futures order cancel-all | scope | POST /fapi/v1/cancel_all |
| futures_prepare_cancel_trigger_order | ai-hub futures order cancel-trigger | contractName | POST /fapi/v1/cancel_trigger_order |
| futures_prepare_set_position_mode | ai-hub futures trade position-mode | contractName, positionModel | POST /fapi/v1/edit_user_position_model |
| futures_prepare_set_margin_mode | ai-hub futures trade margin-mode | contractName, marginModel | POST /fapi/v1/edit_user_margin_model |
| futures_prepare_adjust_position_margin | ai-hub futures trade position-margin | positionId, amount | POST /fapi/v1/edit_position_margin |
| futures_prepare_set_leverage | ai-hub futures trade leverage | contractName, nowLevel | POST /fapi/v1/edit_lever |
