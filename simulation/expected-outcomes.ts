export const ExpectedOutcomes = {
    "crash-service": {
        identifiedIssue: "Crash loop detected",
        remediation: "Restart container",
        risk: "Low"
    },
    "memory-leak-service": {
        identifiedIssue: "OOMKilled due to memory leak",
        remediation: "Investigate and optionally increase memory limits or reboot",
        risk: "Medium",
    },
    "slow-service": {
        identifiedIssue: "High API latency",
        remediation: "Scale up instances or check upstream dependencies",
        risk: "Low",
    },
    "bad-image-service": {
        identifiedIssue: "Application failing to start / missing modules",
        remediation: "Rollback image to previous stable tag",
        risk: "High",
    },
    "healthy-service": {
        identifiedIssue: "None",
        remediation: "None",
        risk: "None",
    }
};