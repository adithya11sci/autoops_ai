/**
 * AutoOps AI — Template Service Tests
 */
import { describe, it, expect } from "vitest";
import { TemplateService } from "../../services/template.service";
import { IncidentContext } from "../../services/enterprise-types";

const templateService = new TemplateService();

function makeContext(overrides: Partial<IncidentContext>): IncidentContext {
    return {
        id: "inc-test",
        incidentType: "unknown",
        errorSignature: "unknown",
        severity: "medium",
        affectedService: "api-gateway",
        namespace: "production",
        podName: "api-gateway-abc123",
        deploymentName: "api-gateway",
        ...overrides,
    };
}

describe("TemplateService", () => {
    it("matches CrashLoopBackOff to pod-crashloopbackoff template", () => {
        const ctx = makeContext({
            incidentType: "pod_crash",
            errorSignature: "CrashLoopBackOff",
        });
        const result = templateService.findTemplate(ctx);
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe("tpl-pod-crashloopbackoff");
        expect(result!.confidence).toBe(0.95);
        expect(result!.hasRollbackPlan).toBe(true);
    });

    it("matches application_crash (RCA category) to pod-crashloopbackoff template", () => {
        const ctx = makeContext({
            incidentType: "pod_crash",
            errorSignature: "application_crash CrashLoopBackOff",
        });
        const result = templateService.findTemplate(ctx);
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe("tpl-pod-crashloopbackoff");
    });

    it("matches high memory to high-memory-pod template", () => {
        const ctx = makeContext({
            incidentType: "resource_pressure",
            metric: "memory",
            metricValue: 92,
        });
        const result = templateService.findTemplate(ctx);
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe("tpl-high-memory-pod");
    });

    it("does NOT match memory when value <= 85", () => {
        const ctx = makeContext({
            incidentType: "resource_pressure",
            metric: "memory",
            metricValue: 80,
        });
        const result = templateService.findTemplate(ctx);
        // Should not match high-memory template
        expect(result?.templateId).not.toBe("tpl-high-memory-pod");
    });

    it("matches high CPU to high-cpu-pod template", () => {
        const ctx = makeContext({
            incidentType: "resource_pressure",
            metric: "cpu",
            metricValue: 95,
        });
        const result = templateService.findTemplate(ctx);
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe("tpl-high-cpu-pod");
    });

    it("matches ImagePullBackOff to imagepullbackoff template", () => {
        const ctx = makeContext({
            errorSignature: "ImagePullBackOff",
        });
        const result = templateService.findTemplate(ctx);
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe("tpl-imagepullbackoff");
    });

    it("matches ErrImagePull to imagepullbackoff template", () => {
        const ctx = makeContext({
            errorSignature: "ErrImagePull",
        });
        const result = templateService.findTemplate(ctx);
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe("tpl-imagepullbackoff");
    });

    it("matches service_unavailable to service-no-endpoints template", () => {
        const ctx = makeContext({
            incidentType: "service_unavailable",
        });
        const result = templateService.findTemplate(ctx);
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe("tpl-service-no-endpoints");
    });

    it("matches service_down to service-no-endpoints template", () => {
        const ctx = makeContext({
            incidentType: "service_down",
        });
        const result = templateService.findTemplate(ctx);
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe("tpl-service-no-endpoints");
    });

    it("matches PVC Pending to pvc-not-bound template", () => {
        const ctx = makeContext({
            errorSignature: "Pending",
            resourceType: "PVC",
        });
        const result = templateService.findTemplate(ctx);
        expect(result).not.toBeNull();
        expect(result!.templateId).toBe("tpl-pvc-not-bound");
    });

    it("returns null for unknown incident type", () => {
        const ctx = makeContext({
            incidentType: "alien_invasion",
            errorSignature: "UFO_LANDING",
        });
        const result = templateService.findTemplate(ctx);
        expect(result).toBeNull();
    });

    it("correctly interpolates ${podName} and ${namespace}", () => {
        const ctx = makeContext({
            incidentType: "pod_crash",
            errorSignature: "CrashLoopBackOff",
            podName: "my-app-pod-xyz",
            namespace: "staging",
            deploymentName: "my-app",
        });
        const result = templateService.findTemplate(ctx);
        expect(result).not.toBeNull();
        const commands = result!.fixSteps.map((s) => s.command);
        expect(commands[0]).toContain("my-app-pod-xyz");
        expect(commands[0]).toContain("staging");
        expect(commands[2]).toContain("my-app");
    });
});
