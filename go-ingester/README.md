# 🚀 Experimental Go Ingester (Inactive)

**Status:** `INACTIVE / PROOF-OF-CONCEPT`

## Overview
This directory contains a high-speed Proof-of-Concept (PoC) log ingester written in Go (Golang). 

The primary AutoOps AI system runs entirely on **TypeScript/Node.js**. However, this Go microservice was built to demonstrate how we could eventually replace the TypeScript log ingestion layer with a blazing-fast, highly concurrent Go binary if the system ever needs to scale to millions of events per second.

## Why keep this here?
This is kept in the repository as a forward-looking architectural option. It is **not used by the main system** and does not affect the current autonomous resolution workflow. It strictly serves to highlight the advantages of a hybrid (polyglot) architecture for extreme scaling.

## Advantages Displayed Here:
1. **Parallel Processing:** Uses Go's `goroutines` to process multiple log streams simultaneously without blocking.
2. **Noise Reduction:** Instantly filters out standard `INFO/DEBUG` logs, only forwarding critical anomalies (`ERROR`, `OOM`) to the AI agents.
3. **Low Resource Footprint:** Capable of handling massive throughput with significantly less RAM/CPU compared to Node.js.

## Running the PoC (Locally)
If you wish to test this standalone PoC (without connecting to the main pipeline):
```bash
cd go-ingester
go run main.go
```
*(This will run a bounded simulation to demonstrate the filtering and concurrency, then exit cleanly).*
