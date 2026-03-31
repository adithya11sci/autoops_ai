/**
 * Agent 3: Planning Agent (LLM-Based)
 * Uses Groq LLM + ChromaDB RAG to generate remediation plans.
 */
import { v4 as uuidv4 } from "uuid";
import { IncidentState, RemediationPlan, PlanStep } from "../orchestrator/state";
import { queryLLM } from "../services/groq.client";
import { querySimilarIncidents } from "../services/chroma.client";
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("PlanningAgent");

const SYSTEM_PROMPT = `You are an expert DevOps Site Reliability Engineer (SRE). Your job is to generate a structured remediation plan to resolve infrastructure incidents.

You MUST respond with valid JSON in exactly this format:
{
  "title": "Brief plan title",
  "riskLevel": "low" | "medium" | "high" | "critical",
  "estimatedDurationMinutes": <number>,
  "requiresApproval": <boolean>,
  "steps": [
    {
      "stepId": <number>,
      "action": "<action_name>",
      "description": "<what this step does>",
      "parameters": { <key-value params> },
      "timeoutSeconds": <number>,
      "rollback": "<rollback command or null>"
    }
  ],
  "rollbackPlan": ["<step1>", "<step2>", ...]
}

Available actions:
- restart_service: Restart pods/containers for a deployment
- scale_deployment: Scale replica count up or down
- rolling_restart: Zero-downtime rolling restart
- rollback_deployment: Rollback to previous version
- update_resource_limits: Change CPU/memory limits
- clear_disk_space: Remove logs and temp files
- flush_connection_pool: Reset database connection pool
- apply_config: Apply configuration changes
- verify_health: Check service health endpoint
- trigger_pipeline: Trigger CI/CD pipeline

Rules:
- Generate 3-7 concrete steps
- Include rollback for risky steps
- Start with safety measures (scale up before restart)
- End with health verification
- Be specific with parameters`;

/**
 * Build the user prompt with incident context and RAG results.
 */
function buildUserPrompt(
    state: IncidentState,
    ragContext: string[]
): string {
    const isRetry = state.retryCount > 0;
    const rootCause = state.rootCause!;
    const issue = state.issue!;

    let prompt = `## Current Incident
- Incident ID: ${state.incidentId}
- Issue Type: ${issue.type}
- Severity: ${issue.severity}
- Affected Service: ${issue.affectedService}
- Anomaly Score: ${issue.anomalyScore.toFixed(3)}
- Description: ${issue.description}

## Root Cause Analysis
- Category: ${rootCause.category}
- Service: ${rootCause.service}
- Description: ${rootCause.description}
- Confidence: ${rootCause.confidence.toFixed(2)}
- Remediation Hint: ${rootCause.remediationHint}
- Dependency Path: ${rootCause.dependencyPath.join(" → ")}
- Evidence:
${rootCause.evidence.map((e) => `  - ${e}`).join("\n")}`;

    if (ragContext.length > 0) {
        prompt += `\n\n## Similar Past Incidents (for reference)
${ragContext.map((ctx, i) => `### Past Incident ${i + 1}:\n${ctx}`).join("\n\n")}`;
    }

    if (isRetry) {
        prompt += `\n\n## ⚠️ RETRY CONTEXT (Attempt ${state.retryCount + 1})
The previous plan FAILED. Here is what happened:
- Previous plan: ${state.plan?.title || "unknown"}
- Failed steps: ${JSON.stringify(state.stepsFailed)}
- Error log: ${JSON.stringify(state.errorLog.slice(-3))}

IMPORTANT: Generate a DIFFERENT approach. Do not repeat the same steps.`;
    }

    prompt += `\n\nGenerate the remediation plan as JSON.`;

    return prompt;
}

// ── Main Agent ────────────────────────────────────

export async function planningAgent(state: IncidentState): Promise<IncidentState> {
    log.info(
        { incidentId: state.incidentId, retryCount: state.retryCount },
        "▶ Planning Agent started"
    );
    state.currentAgent = "planning";
    state.workflowStatus = "planning";
    state.updatedAt = new Date().toISOString();

    if (!state.rootCause || !state.issue) {
        log.warn("No root cause or issue available, skipping planning");
        return state;
    }

    // Step 1: RAG — retrieve similar past incidents from ChromaDB
    let ragContext: string[] = [];
    try {
        const queryText = `${state.rootCause.category}: ${state.rootCause.description} in ${state.rootCause.service}`;
        const similar = await querySimilarIncidents(queryText, 3);
        ragContext = similar.map(
            (s) =>
                `[Distance: ${s.distance.toFixed(3)}] ${s.document}`
        );
        log.info({ ragResults: similar.length }, "RAG context retrieved");
    } catch (err) {
        log.warn({ err }, "ChromaDB query failed, proceeding without RAG context");
    }

    // Step 2: Build prompt and query Groq LLM
    const userPrompt = buildUserPrompt(state, ragContext);

    let llmResponse;
    try {
        llmResponse = await queryLLM(SYSTEM_PROMPT, userPrompt);
    } catch (err: any) {
        log.error({ err: err.message }, "Groq LLM request failed");
        state.errorLog.push({
            agent: "planning",
            error: `LLM request failed: ${err.message}`,
            timestamp: new Date().toISOString(),
        });
        // Generate a fallback plan
        return generateFallbackPlan(state);
    }

    // Step 3: Parse LLM response
    let planData: any;
    try {
        planData = JSON.parse(llmResponse.content);
    } catch (err) {
        log.error({ content: llmResponse.content.slice(0, 200) }, "Failed to parse LLM JSON response");
        return generateFallbackPlan(state);
    }

    // Step 4: Construct the plan
    const steps: PlanStep[] = (planData.steps || []).map((s: any, i: number) => ({
        stepId: s.stepId || i + 1,
        action: s.action || "unknown",
        description: s.description || "",
        parameters: s.parameters || {},
        timeoutSeconds: s.timeoutSeconds || 120,
        rollback: s.rollback || undefined,
    }));

    const plan: RemediationPlan = {
        planId: `plan-${uuidv4().slice(0, 8)}`,
        title: planData.title || `Remediate ${state.rootCause.category} in ${state.rootCause.service}`,
        riskLevel: planData.riskLevel || "medium",
        estimatedDurationMinutes: planData.estimatedDurationMinutes || 10,
        steps,
        rollbackPlan: planData.rollbackPlan || ["Revert all changes", "Escalate to on-call"],
        requiresApproval: planData.requiresApproval || false,
        ragContext,
    };

    state.plan = plan;

    log.info(
        {
            planId: plan.planId,
            title: plan.title,
            steps: plan.steps.length,
            risk: plan.riskLevel,
            llmLatency: llmResponse.latencyMs,
            tokensUsed: llmResponse.tokensUsed,
        },
        "🧠 Remediation plan generated"
    );

    return state;
}

/**
 * Generate a fallback plan when LLM is unavailable.
 */
function generateFallbackPlan(state: IncidentState): IncidentState {
    log.warn("Generating fallback remediation plan (no LLM)");

    const service = state.rootCause?.service || state.issue?.affectedService || "unknown-service";
    const category = state.rootCause?.category || "unknown";

    const fallbackSteps: Record<string, PlanStep[]> = {
        memory_leak: [
            { stepId: 1, action: "scale_deployment", description: "Scale up for safety", parameters: { service, replicas: 4 }, timeoutSeconds: 120 },
            { stepId: 2, action: "rolling_restart", description: "Rolling restart to clear memory", parameters: { service, maxUnavailable: 1 }, timeoutSeconds: 300 },
            { stepId: 3, action: "update_resource_limits", description: "Increase memory limit", parameters: { service, memoryLimit: "768Mi" }, timeoutSeconds: 60 },
            { stepId: 4, action: "verify_health", description: "Verify service health", parameters: { service, endpoint: "/health" }, timeoutSeconds: 60 },
        ],
        application_crash: [
            { stepId: 1, action: "rollback_deployment", description: "Rollback to previous version", parameters: { service }, timeoutSeconds: 180 },
            { stepId: 2, action: "verify_health", description: "Verify health after rollback", parameters: { service, endpoint: "/health" }, timeoutSeconds: 60 },
        ],
        resource_exhaustion: [
            { stepId: 1, action: "scale_deployment", description: "Scale out under load", parameters: { service, replicas: 6 }, timeoutSeconds: 120 },
            { stepId: 2, action: "verify_health", description: "Verify service health", parameters: { service, endpoint: "/health" }, timeoutSeconds: 60 },
        ],
        default: [
            { stepId: 1, action: "restart_service", description: "Restart the affected service", parameters: { service }, timeoutSeconds: 120 },
            { stepId: 2, action: "verify_health", description: "Verify service health", parameters: { service, endpoint: "/health" }, timeoutSeconds: 60 },
        ],
    };

    const steps = fallbackSteps[category] || fallbackSteps.default;

    state.plan = {
        planId: `plan-fallback-${uuidv4().slice(0, 8)}`,
        title: `Fallback: Remediate ${category} in ${service}`,
        riskLevel: "medium",
        estimatedDurationMinutes: 5,
        steps,
        rollbackPlan: ["Revert all changes", "Escalate to on-call engineer"],
        requiresApproval: false,
        ragContext: [],
    };

    log.info({ planId: state.plan.planId, steps: steps.length }, "Fallback plan generated");
    return state;
}
