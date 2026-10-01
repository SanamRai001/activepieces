import type { AutomationActivationPolicy } from './activation-readiness'

export const AUTOMATION_ARCHITECT_ACTIVATION_POLICY: AutomationActivationPolicy = {
    riskPolicy: {
        requireApprovalFor: [
            'REVERSIBLE_WRITE',
            'EXTERNAL_COMMUNICATION',
            'SENSITIVE_MUTATION',
            'DESTRUCTIVE',
            'FINANCIAL',
        ],
        deny: [],
        maxAttemptsPerStep: 3,
    },
    requireSuccessfulSimulation: true,
}
