# 📈 AutoOps AI — Scalability Design

> **Handling 1000+ events/sec with enterprise-grade reliability**

---

## 1. Architecture for Scale

### Design Philosophy

AutoOps AI decouples data ingestion from processing using Kafka, enabling independent horizontal scaling of every component.

---

## 2. Kafka Message Queue

```
┌──────────────────────────────────────────────────────┐
│                 KAFKA CLUSTER (3 Brokers)             │
│                                                      │
│  Topic: raw-events         (12 partitions, RF=3)     │
│  Topic: processed-events   (6 partitions, RF=3)      │
│  Topic: agent-results      (6 partitions, RF=3)      │
│  Topic: execution-commands (3 partitions, RF=3)       │
│  Topic: dead-letter-queue  (3 partitions, RF=3)       │
│                                                      │
│  Throughput: 1,000-10,000 events/sec                 │
│  Retention: 7 days (raw), 30 days (results)          │
└──────────────────────────────────────────────────────┘
```

| Topic | Partition Key | Purpose |
|---|---|---|
| `raw-events` | `source_id` | Group by source for locality |
| `processed-events` | `service_name` | Group by service for RCA |
| `agent-results` | `incident_id` | Group by incident |
| `execution-commands` | `target_service` | Prevent concurrent actions |

---

## 3. Stream & Batch Processing

### Event Processing Rate Targets

| Stage | Rate | Instances | Per Instance |
|---|---|---|---|
| Ingestion | 1,000+ evt/s | 1 (Kafka) | N/A (buffered) |
| Parsing | 1,000+ evt/s | 4 | 250 evt/s |
| Anomaly Detection | 200+ evt/s | 4-8 | 50 evt/s |
| RCA | 50/min | 2-4 | 25/min |
| Planning | 20/min | 2-4 | 10/min |
| Execution | 10/min | 2-4 | 5/min |

### Micro-Batching

```typescript
class MicroBatchProcessor {
  private buffer: RawEvent[] = [];
  private batchSize = 100;
  private flushIntervalMs = 1000;

  async ingest(event: RawEvent) {
    this.buffer.push(event);
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush() {
    const batch = this.buffer.splice(0);
    const features = extractFeatures(batch);
    const scores = anomalyDetector.batchPredict(features);
    // Only emit detected anomalies
    const anomalies = batch.filter((_, i) => scores[i] > threshold);
    for (const event of anomalies) {
      await this.emitAnomaly(event);
    }
  }
}
```

---

## 4. Horizontal Scaling (Kubernetes HPA)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: monitoring-agent-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: monitoring-agent
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Pods
      pods:
        metric:
          name: kafka_consumer_lag
        target:
          type: AverageValue
          averageValue: "100"
```

### Scaling Triggers

```
CPU > 70%        → Scale Up (+2 pods, wait 60s)
CPU < 30%        → Scale Down (-1 pod, wait 300s)
Queue Lag > 100  → Scale Up (+2 pods, immediate)
Memory > 80%     → Scale Up (+1 pod, wait 60s)
Error Rate > 5%  → Alert + Scale Up
```

---

## 5. Load Balancing

```
Internet → Cloud LB (L4/TCP)
  → Nginx Ingress (L7, path-based routing)
  → K8s Service (ClusterIP, round-robin)
  → Agent Pods
```

---

## 6. SLA-Based Priority Queue

```
P0 (Critical) → 4 workers, preemptive, immediate
P1 (High)     → 3 workers, 15 min timeout
P2 (Medium)   → 2 workers, 1 hour timeout
P3 (Low)      → 1 worker, 4 hour timeout
P4 (Info)     → Deferred processing
```

---

## 7. Tiered Storage

```
🔴 HOT (0-24h)   → Redis + PostgreSQL     Access: < 5ms   Cost: $$$
🟡 WARM (1-30d)   → PostgreSQL + Search    Access: < 50ms  Cost: $$
🔵 COLD (30-365d) → S3 / Object Storage    Access: < 5s    Cost: $
```

---

## 8. Rate Limiting & Backpressure

```
Normal Load  → Process all events
High Load    → Larger micro-batches
Overload     → Rate limiting + sampling (1 in N)
Critical     → Circuit breaker (drop non-critical, alert)
```

### Adaptive Rate Limiter

```typescript
class AdaptiveRateLimiter {
  private baseRate = 1000;
  private currentRate = 1000;
  
  async adjustRate() {
    const cpuUsage = await getSystemCPU();
    const queueDepth = await getKafkaLag();
    
    if (cpuUsage > 85) {
      this.currentRate = Math.max(100, this.currentRate * 0.7);
    } else if (cpuUsage < 50 && queueDepth < 10) {
      this.currentRate = Math.min(5000, this.currentRate * 1.2);
    }
  }
}
```

---

## 9. Performance Benchmarks

| Metric | Target | @1K evt/s | @5K evt/s | @10K evt/s |
|---|---|---|---|---|
| Ingestion latency | < 10ms | 2ms | 5ms | 8ms |
| Detection latency | < 500ms | 200ms | 350ms | 480ms |
| End-to-end MTTR | < 5 min | 2 min | 3 min | 4.5 min |
| Agent pods | Auto | 4 | 12 | 24 |
| Memory usage | < 80% | 40% | 60% | 75% |
