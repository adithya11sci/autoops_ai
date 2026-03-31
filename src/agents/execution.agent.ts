/**
 * Agent 5: Execution Agent
 * Executes remediation plan steps. Supports simulate and live modes.
 */
import { IncidentState, StepResult, PlanStep } from "../orchestrator/state";
import { config } from "../config";
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("ExecutionAgent");

// ── Simulated Action Handlers ─────────────────────

async function simulateAction(step: PlanStep): Promise<{ success: boolean; output: string }> {
    // Simulate execution with realistic delays
    const delays: Record<string, number> = {
        restart_service: 2000,
        scale_deployment: 1500,
        rolling_restart: 3000,
        rollback_deployment: 2500,
        update_resource_limits: 1000,
        clear_disk_space: 2000,
        flush_connection_pool: 800,
        apply_config: 1200,
        verify_health: 1000,
        trigger_pipeline: 2000,
    };

    const delay = delays[step.action] || 1000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Simulate occasional failures (5% chance in simulate mode)
    const shouldFail = Math.random() < 0.05;
    if (shouldFail) {
        return {
            success: false,
            output: `Simulated failure: ${step.action} timed out after ${step.timeoutSeconds}s`,
        };
    }

    // Resolve service name from various possible parameter keys the LLM might use
    const svc = step.parameters.service || step.parameters.deploymentName || step.parameters.name || step.parameters.target || "target-service";
    const replicas = step.parameters.replicas || step.parameters.replicaCount || 3;

    const outputs: Record<string, string> = {
        restart_service: `Service ${svc} restarted successfully. All pods healthy.`,
        scale_deployment: `Deployment ${svc} scaled to ${replicas} replicas.`,
        rolling_restart: `Rolling restart of ${svc} completed. 0 downtime.`,
        rollback_deployment: `Deployment ${svc} rolled back to previous revision.`,
        update_resource_limits: `Resource limits updated for ${svc}. Memory: ${step.parameters.memoryLimit || step.parameters.memory || "N/A"}.`,
        clear_disk_space: `Cleared ${step.parameters.freeSpaceGB || 10}GB of disk space on ${svc}.`,
        flush_connection_pool: `Connection pool for ${svc} flushed. Active connections reset.`,
        apply_config: `Configuration applied to ${svc}.`,
        verify_health: `Health check passed for ${svc}: HTTP 200 OK.`,
        trigger_pipeline: `CI/CD pipeline triggered for ${svc}.`,
    };

    return {
        success: true,
        output: outputs[step.action] || `Action ${step.action} completed successfully.`,
    };
}

// ── Main Agent ────────────────────────────────────

export async function executionAgent(state: IncidentState): Promise<IncidentState> {
    log.info(
        { incidentId: state.incidentId, mode: config.agents.executionMode },
        "▶ Execution Agent started"
    );
    state.currentAgent = "execution";
    state.workflowStatus = "executing";
    state.executionStatus = "running";
    state.updatedAt = new Date().toISOString();

    if (!state.plan || state.plan.steps.length === 0) {
        log.warn("No plan or empty steps, marking as failed");
        state.executionStatus = "failed";
        state.stepsFailed.push({
            stepId: 0,
            action: "no_plan",
            status: "failed",
            error: "No remediation plan available",
            completedAt: new Date().toISOString(),
        });
        return state;
    }

    const steps = state.plan.steps;
    const completed: StepResult[] = [];
    const failed: StepResult[] = [];

    log.info({ totalSteps: steps.length }, "Executing remediation plan...");

    for (const step of steps) {
        log.info(
            { stepId: step.stepId, action: step.action },
            `  ⚙️  Step ${step.stepId}/${steps.length}: ${step.action}`
        );

        try {
            let result: { success: boolean; output: string };

            if (config.agents.executionMode === "simulate") {
                result = await simulateAction(step);
            } else {
                // Live mode — would integrate with real K8s/Docker APIs
                log.warn("Live execution mode — using simulation as placeholder");
                result = await simulateAction(step);
            }

            if (result.success) {
                const stepResult: StepResult = {
                    stepId: step.stepId,
                    action: step.action,
                    status: "success",
                    result: result.output,
                    completedAt: new Date().toISOString(),
                };
                completed.push(stepResult);
                log.info(
                    { stepId: step.stepId, action: step.action },
                    `  ✅ Step ${step.stepId} completed`
                );
            } else {
                const stepResult: StepResult = {
                    stepId: step.stepId,
                    action: step.action,
                    status: "failed",
                    error: result.output,
                    completedAt: new Date().toISOString(),
                };
                failed.push(stepResult);
                log.error(
                    { stepId: step.stepId, error: result.output },
                    `  ❌ Step ${step.stepId} failed`
                );
                break; // Stop execution on failure
            }
        } catch (err: any) {
            const stepResult: StepResult = {
                stepId: step.stepId,
                action: step.action,
                status: "failed",
                error: err.message,
                completedAt: new Date().toISOString(),
            };
            failed.push(stepResult);
            log.error({ stepId: step.stepId, err: err.message }, `  ❌ Step ${step.stepId} exception`);
            break;
        }
    }

    // Update state
    state.stepsCompleted = [...state.stepsCompleted, ...completed];
    state.stepsFailed = [...state.stepsFailed, ...failed];

    if (failed.length === 0) {
        state.executionStatus = "success";
        log.info(
            { completed: completed.length },
            "✅ All execution steps completed successfully"
        );
    } else if (completed.length > 0) {
        state.executionStatus = "partial";
        log.warn(
            { completed: completed.length, failed: failed.length },
            "⚠️ Execution partially completed"
        );
    } else {
        state.executionStatus = "failed";
        log.error("❌ Execution failed on first step");
    }

    return state;
}
