## A flexible, constraint-aware task scheduler for order fulfillment scenarios involving multiple resources/accounts, daily limits, and time-based dependencies.

## Features

- Multi-resource (account) task balancing
- Daily/periodic per-resource caps
- Minimum delay windows between sequential tasks (e.g., purchase → review)
- Automatic rescheduling for missed or delayed tasks
- Audit log for scheduling decisions and changes
- Simple API for integration with bots, web dashboards, and order management systems

## Example Use Case

**Amazon Review Fulfillment:**
- 5 Amazon accounts
- Max 3 purchases/account/day
- No more than 1 purchase of same book per account per day
- Each review published min. 4 days after purchase
- Rescheduling on missed events
