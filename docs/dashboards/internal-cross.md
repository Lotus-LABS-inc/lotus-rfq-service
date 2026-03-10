# Internal Cross Dashboard Spec

## Purpose
Operational dashboard for Phase 1 internal crossing readiness, shadow rollout, and integrity monitoring.

## Panels

### Cross Attempts by Status
```promql
sum by (status) (increase(internal_crossing_total[5m]))
```

### Filled Size
```promql
sum(increase(internal_crossing_filled_size_total[5m]))
```

### Kill Switch Activations
```promql
sum by (mode) (increase(internal_cross_kill_switch_total[15m]))
```

### Shadow Evaluations
```promql
sum by (status) (increase(internal_cross_shadow_total[15m]))
```

### Shadow Divergence
```promql
sum by (reason) (increase(internal_cross_shadow_divergence_total[15m]))
```

### Rebuild Discrepancies
```promql
sum by (discrepancy_type) (increase(internal_cross_rebuild_discrepancy_total[15m]))
```

### Routing Outcome Before External SOR
```promql
sum by (status) (increase(sor_internal_cross_result_total[5m]))
```

### Reservation Pressure
```promql
risk_reservations_active
```
