import { isNil } from '@activepieces/core-utils'
import { BranchExecutionType, flowStructureUtil, FlowTriggerType, Step } from '@activepieces/shared'

export type FlowStructureValidationSeverity = 'error' | 'warning' | 'info'

export type FlowStructureValidationIssue = {
    category: 'step_validity' | 'template_reference' | 'empty_branch'
    severity: FlowStructureValidationSeverity
    stepName: string
    message: string
}

export type FlowStructureValidationResult = {
    totalSteps: number
    validSteps: number
    invalidSteps: number
    skippedSteps: number
    issues: FlowStructureValidationIssue[]
}

export function validateFlowStructure({ trigger }: { trigger: Step }): FlowStructureValidationResult {
    const allSteps = flowStructureUtil.getAllSteps(trigger)
    const allStepNames = new Set(allSteps.map((step) => step.name))
    const issues: FlowStructureValidationIssue[] = []

    if (trigger.type === FlowTriggerType.EMPTY) {
        issues.push({
            category: 'step_validity',
            severity: 'error',
            stepName: 'trigger',
            message: 'Trigger is not configured (use ap_update_trigger).',
        })
    }

    const seenSteps = new Set<string>()
    let validCount = 0
    let invalidCount = 0
    let skippedCount = 0

    for (const step of allSteps) {
        const isSkipped = 'skip' in step && step.skip === true

        if (isSkipped) {
            skippedCount++
        }
        else if (step.valid) {
            validCount++
        }
        else {
            invalidCount++
            if (!flowStructureUtil.isTrigger(step.type)) {
                issues.push({
                    category: 'step_validity',
                    severity: 'error',
                    stepName: step.name,
                    message: `"${step.displayName}" is invalid (use ap_update_step to fix).`,
                })
            }
        }

        const strings = collectStringValues(step)
        const seenRefs = new Set<string>()
        for (const value of strings) {
            const refs = extractReferencedStepNames(value)
            for (const ref of refs) {
                if (seenRefs.has(ref)) {
                    continue
                }
                seenRefs.add(ref)

                if (!allStepNames.has(ref)) {
                    issues.push({
                        category: 'template_reference',
                        severity: 'error',
                        stepName: step.name,
                        message: `"${step.displayName}" references "{{${ref}...}}" which does not exist in the flow.`,
                    })
                }
                else if (!seenSteps.has(ref)) {
                    issues.push({
                        category: 'template_reference',
                        severity: 'error',
                        stepName: step.name,
                        message: `"${step.displayName}" references "{{${ref}...}}" which comes after it in execution order.`,
                    })
                }
            }
        }

        if (flowStructureUtil.isBranchedAction(step)) {
            const { children, settings } = step
            const branches = settings.branches ?? []
            for (let index = 0; index < children.length; index++) {
                if (!isNil(children[index])) {
                    continue
                }

                const branchName = branches[index]?.branchName ?? `Branch ${index}`
                const isFallback = branches[index]?.branchType === BranchExecutionType.FALLBACK
                issues.push({
                    category: 'empty_branch',
                    severity: isFallback ? 'info' : 'warning',
                    stepName: step.name,
                    message: isFallback
                        ? `"${step.displayName}" has an empty fallback branch: "${branchName}". This is fine if the unmatched case intentionally does nothing.`
                        : `"${step.displayName}" has an empty branch: "${branchName}".`,
                })
            }
        }

        seenSteps.add(step.name)
    }

    return {
        totalSteps: allSteps.length,
        validSteps: validCount,
        invalidSteps: invalidCount,
        skippedSteps: skippedCount,
        issues,
    }
}

export function hasNoBlockingFlowStructureIssues(issues: FlowStructureValidationIssue[]): boolean {
    return issues.every((issue) => issue.severity === 'info')
}

function collectStringValues(step: Step): string[] {
    const result: string[] = []

    if ('settings' in step && typeof step.settings === 'object' && step.settings !== null) {
        const settings = step.settings as Record<string, unknown>

        if ('input' in settings && typeof settings.input === 'object' && settings.input !== null) {
            walkValues(settings.input, (value) => {
                if (typeof value === 'string') {
                    result.push(value)
                }
            })
        }

        if ('items' in settings && typeof settings.items === 'string') {
            result.push(settings.items)
        }

        if ('branches' in settings && Array.isArray(settings.branches)) {
            for (const branch of settings.branches) {
                if (typeof branch !== 'object' || branch === null || !('conditions' in branch) || !Array.isArray(branch.conditions)) {
                    continue
                }

                for (const group of branch.conditions) {
                    if (!Array.isArray(group)) {
                        continue
                    }
                    for (const condition of group) {
                        if (typeof condition !== 'object' || condition === null) {
                            continue
                        }
                        if ('firstValue' in condition && typeof condition.firstValue === 'string') {
                            result.push(condition.firstValue)
                        }
                        if ('secondValue' in condition && typeof condition.secondValue === 'string') {
                            result.push(condition.secondValue)
                        }
                    }
                }
            }
        }
    }

    return result
}

function walkValues(value: unknown, visitor: (value: unknown) => void): void {
    if (value === null || value === undefined) {
        return
    }

    visitor(value)

    if (Array.isArray(value)) {
        for (const item of value) {
            walkValues(item, visitor)
        }
        return
    }

    if (typeof value === 'object') {
        for (const child of Object.values(value)) {
            walkValues(child, visitor)
        }
    }
}

function extractReferencedStepNames(value: string): string[] {
    const regex = /\{\{(\w+)/g
    const names = new Set<string>()
    let match: RegExpExecArray | null

    while ((match = regex.exec(value)) !== null) {
        const name = match[1]
        if (name !== 'connections') {
            names.add(name)
        }
    }

    return [...names]
}
