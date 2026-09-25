import { isNil, Permission } from '@activepieces/core-utils'
import { McpToolDefinition, ProjectScopedMcpServer } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { z } from 'zod'
import { flowService } from '../../flows/flow/flow.service'
import {
    FlowStructureValidationIssue,
    FlowStructureValidationResult,
    hasNoBlockingFlowStructureIssues,
    validateFlowStructure,
} from '../../flows/validation/flow-structure-validation'
import { mcpUtils } from './mcp-utils'

export const apValidateFlowTool = (mcp: ProjectScopedMcpServer, log: FastifyBaseLogger): McpToolDefinition => {
    return {
        title: 'ap_validate_flow',
        permission: Permission.READ_FLOW,
        description: 'Validate a flow for structural issues without publishing. Checks step validity, template references, and empty branches. Returns a detailed report with all issues found. Use this before ap_lock_and_publish to catch problems early.',
        inputSchema: validateFlowInput.shape,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        execute: async (args) => {
            try {
                const { flowId } = validateFlowInput.parse(args)

                const flow = await flowService(log).getOnePopulated({ id: flowId, projectId: mcp.projectId })
                if (isNil(flow)) {
                    return { content: [{ type: 'text', text: '❌ Flow not found.' }] }
                }

                const result = validateFlowStructure({ trigger: flow.version.trigger })
                return {
                    content: [{ type: 'text', text: formatValidationResult({ result, flowDisplayName: flow.version.displayName }) }],
                    structuredContent: {
                        valid: hasNoBlockingFlowStructureIssues(result.issues) && result.validSteps > 0,
                        totalSteps: result.totalSteps,
                        validSteps: result.validSteps,
                        invalidSteps: result.invalidSteps,
                        skippedSteps: result.skippedSteps,
                        issues: result.issues.map((issue) => ({
                            category: issue.category,
                            severity: issue.severity,
                            stepName: issue.stepName,
                            message: issue.message,
                        })),
                    },
                }
            }
            catch (err) {
                return mcpUtils.mcpToolError('Flow validation failed', err)
            }
        },
    }
}

const validateFlowInput = z.object({
    flowId: z.string().describe('The id of the flow to validate. Use ap_list_flows to find it.'),
})

const CATEGORY_ORDER: FlowStructureValidationIssue['category'][] = ['step_validity', 'template_reference', 'empty_branch']
const CATEGORY_LABELS: Record<FlowStructureValidationIssue['category'], string> = {
    step_validity: 'Step Validity',
    template_reference: 'Template References',
    empty_branch: 'Empty Branches',
}

function formatInfoNotes(infoIssues: FlowStructureValidationIssue[]): string[] {
    if (infoIssues.length === 0) {
        return []
    }
    return ['', 'Notes (non-blocking):', ...infoIssues.map((issue) => `- ${issue.stepName}: ${issue.message}`)]
}

function formatValidationResult({ result, flowDisplayName }: { result: FlowStructureValidationResult, flowDisplayName: string }): string {
    const blockingIssues = result.issues.filter((issue) => issue.severity !== 'info')
    const infoIssues = result.issues.filter((issue) => issue.severity === 'info')

    if (blockingIssues.length === 0 && result.validSteps > 0) {
        const skippedNote = result.skippedSteps > 0 ? `, ${result.skippedSteps} skipped` : ''
        return [`✅ Flow "${flowDisplayName}" is ready to publish (${result.totalSteps} steps, ${result.validSteps} valid${skippedNote}).`, ...formatInfoNotes(infoIssues)].join('\n')
    }

    if (blockingIssues.length === 0 && result.validSteps === 0) {
        return [`⚠️ Flow "${flowDisplayName}" has no valid steps (${result.totalSteps} total). Configure the trigger and actions before publishing.`, ...formatInfoNotes(infoIssues)].join('\n')
    }

    const grouped = new Map<FlowStructureValidationIssue['category'], FlowStructureValidationIssue[]>()
    for (const issue of blockingIssues) {
        const list = grouped.get(issue.category) ?? []
        list.push(issue)
        grouped.set(issue.category, list)
    }

    const lines: string[] = []
    lines.push(`⚠️ Flow "${flowDisplayName}" has ${blockingIssues.length} issue(s):`)
    lines.push('')

    for (const category of CATEGORY_ORDER) {
        const issues = grouped.get(category)
        if (issues && issues.length > 0) {
            lines.push(`${CATEGORY_LABELS[category]}:`)
            for (const issue of issues) {
                lines.push(`- ${issue.stepName}: ${issue.message}`)
            }
            lines.push('')
        }
    }

    lines.push(`Summary: ${result.totalSteps} total, ${result.validSteps} valid, ${result.invalidSteps} invalid, ${result.skippedSteps} skipped`)

    return [...lines, ...formatInfoNotes(infoIssues)].join('\n')
}
