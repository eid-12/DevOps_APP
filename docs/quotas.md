# Quotas

Everyone is on the Free plan in this release. Marketing numbers on Billing (2 projects, 3 services) are **soft**. I do not reject a fourth project.

Hard pool (enforced):

| Resource | Cap |
|----------|-----|
| RAM | 4096 MB |
| CPU | 2000 millicores |
| Disk | 5 GB |

When they add a service I take a slice (default something like 256 MB / 250m CPU / 1 GB). Sum of running slices cannot pass the pool. Usage meters on Account and Billing read the same numbers.

I can still stop someone with **Suspend** or by turning Deploy off. That is the human quota.
