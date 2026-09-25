# Deferred Infrastructure

## 1. Multi-Instance Scheduler (Redis/Queue)
**Reason for deferring**: The current `scheduler.ts` runs inside the API monolith using `setInterval` and claims jobs via atomic `nextRunAt` increments. This is perfectly safe for a single API instance deployment (the expected initial production state). It avoids the operational overhead of managing a Redis instance or a distributed message queue.
**Trigger for migration**: If the API needs to be horizontally scaled to multiple pods/instances to handle web traffic, the scheduler must be extracted to a separate worker service backed by a DB advisory lock or a message queue (like BullMQ).

## 2. Shared Cache (Redis)
**Reason for deferring**: The `context.ts` dataset cache is currently an in-process, bounded FIFO `Map`. Memory is capped safely. For a single-instance MVP, this provides instant lookups without external network hops.
**Trigger for migration**: If the API scales horizontally, cache hits will fragment across instances, dropping the hit rate. At that point, transition the context cache to a shared Redis cluster.

## 3. Columnar / Analytical Database (DuckDB / ClickHouse)
**Reason for deferring**: `Dataset.rows` uses PostgreSQL JSON storage. For datasets under ~100k rows, the MVP analytical query engine in Node (which pulls the JSON into memory and reduces it) operates within acceptable latency and memory bounds.
**Trigger for migration**: When datasets routinely exceed ~100k rows, or analytical query latency exceeds user expectations, migrate analytical data storage to an OLAP engine (e.g. DuckDB, ClickHouse) leaving PostgreSQL strictly for application metadata.
