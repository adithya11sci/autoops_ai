package main

import (
	"fmt"
	"log"
	"strings"
	"time"
)

// processLogStream simulates an ultra-fast consumer processing raw logs.
// It filters out normal logs and only forwards potential anomalies.
func processLogStream(streamID string, logChannel <-chan string, alertChannel chan<- string) {
	for logLine := range logChannel {
		// High-speed filtering
		if strings.Contains(logLine, "ERROR") || strings.Contains(logLine, "OOM") || strings.Contains(logLine, "Exception") {
			// Format as JSON and send to the alert channel (destined for Kafka)
			alertChannel <- fmt.Sprintf(`{"stream": "%s", "log": "%s", "timestamp": "%s"}`, streamID, logLine, time.Now().Format(time.RFC3339))
		}
	}
}

func main() {
	log.Println("⚡ Starting High-Speed Go Log Ingester (Standalone/Sidecar mode)")

	// Buffered channels for high throughput
	logChannel := make(chan string, 10000)
	alertChannel := make(chan string, 1000)

	// 1. Spin up 5 concurrent workers instantly
	for i := 1; i <= 5; i++ {
		go processLogStream(fmt.Sprintf("worker-%d", i), logChannel, alertChannel)
	}

	// 2. Background task to push filtered alerts to Kafka
	// (The TypeScript monitoring.agent.ts can then consume these from Kafka)
	go func() {
		for alert := range alertChannel {
			log.Printf("[KAFKA PRODUCER MOCK] Forwarding to TS AI Agent: %s\n", alert)
		}
	}()

	// 3. Simulate high volumes of incoming logs
	simulateIncomingLogs(logChannel)
}

func simulateIncomingLogs(logChannel chan<- string) {
	log.Println("Simulating log stream...")

	sampleLogs := []string{
		"INFO: Service started normally",
		"DEBUG: Heartbeat check ok",
		"ERROR: Connection refused on port 5432 (Postgres)",
		"INFO: User login successful",
		"OOM: Container memory limit exceeded in pod-123",
	}

	for _, l := range sampleLogs {
		logChannel <- l
		time.Sleep(50 * time.Millisecond) // Simulating slight delay between batches
	}

	// Wait briefly so goroutines can finish processing
	time.Sleep(1 * time.Second)
	log.Println("✅ Go log ingestion simulation complete.")
}
