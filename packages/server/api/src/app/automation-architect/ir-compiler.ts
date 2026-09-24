import {
    AutomationIrV1Schema,
    type AutomationIrV1,
    type AutomationReference,
    type AutomationStep,
    type AutomationValue,
} from '@activepieces/automation-architect'
import { SAFE_EXTERNAL_ID_PATTERN } from '@activepieces/core-utils'
import {
    BranchExecutionType,
    BranchOperator,
    CreateFlowRequest as CreateFlowRequestSchema,
    FlowActionType,
    FlowOperationRequest as FlowOperationRequestSchema,
    FlowOperationType,
    FlowTriggerType,
    RouterExecutionType,
    type CreateFlowRequest as CreateFlowRequestType,
    type FlowAction,
    type FlowOperationRequest,
    type FlowTrigger,
} from '@activepieces/shared'

const SCHEDULE_PIECE_NAME = '@activepieces/piece-schedule'
const SCHEDULE_TRIGGER_NAME = 'cron_expression'

export type ActivepiecesCapabilityId = {
    kind: 'action' | 'trigger'
    pieceName: string
    componentName: string
}

export type CompilerComponentMetadata = {
    name: string
    displayName: string
    requireAuth: boolean
    props: Record<string, {
        required?: boolean
    }>
}

export type CompilerPieceMetadata = {
    name: string
    displayName: string
    version: string
    actions: Record<string, CompilerComponentMetadata>
    triggers: Record<string, CompilerComponentMetadata>
}

export type ActivepiecesIrCompilerDependencies = {
    getPiece(params: {
        name: string
        platformId: string
        projectId: string
    }): Promise<CompilerPieceMetadata | undefined>
    now(): string
}

export type ActivepiecesIrCompilerParams = {
    automation: unknown
    platformId: string
    projectId: string
    connectionBindings?: Record<string, string>
}

export type ActivepiecesIrCompilerDiagnosticCode =
    | 'INVALID_IR'
    | 'INVALID_CAPABILITY_ID'
    | 'CAPABILITY_KIND_MISMATCH'
    | 'PIECE_NOT_VISIBLE_OR_MISSING'
    | 'COMPONENT_NOT_FOUND'
    | 'MISSING_CONNECTION_BINDING'
    | 'INVALID_CONNECTION_BINDING'
    | 'UNKNOWN_INPUT_PROPERTY'
    | 'MISSING_REQUIRED_INPUT'
    | 'UNSUPPORTED_TRIGGER'
    | 'UNSUPPORTED_STEP'
    | 'UNSUPPORTED_CONDITION'
    | 'UNSUPPORTED_SHARED_STEP'
    | 'CREATE_FLOW_FAILED'
    | 'APPLY_OPERATION_FAILED'
    | 'SAFETY_INVARIANT_VIOLATION'

export type ActivepiecesIrCompilerDiagnostic = {
    code: ActivepiecesIrCompilerDiagnosticCode
    message: string
    stepId?: string
    capabilityId?: string
}

export type ActivepiecesIrCompilerSuccess = {
    status: 'COMPILED'
    createRequest: CreateFlowRequestType
    operations: FlowOperationRequest[]
    stepNameById: Record<string, string>
    diagnostics: ActivepiecesIrCompilerDiagnostic[]
}

export type ActivepiecesIrCompilerFailure = {
    status: 'FAILED'
    diagnostics: ActivepiecesIrCompilerDiagnostic[]
}

export type ActivepiecesIrCompilerResult =
    | ActivepiecesIrCompilerSuccess
    | ActivepiecesIrCompilerFailure

export function parseActivepiecesCapabilityId(value: string): ActivepiecesCapabilityId | undefined {
    const match = /^activepieces:(action|trigger):([^:]+):([^:]+)$/.exec(value)
    if (match === null) {
        return undefined
    }
    const [, kind, pieceName, componentName] = match
    if (
        (kind !== 'action' && kind !== 'trigger')
        || pieceName === undefined
        || componentName === undefined
        || pieceName.trim().length === 0
        || componentName.trim().length === 0
    ) {
        return undefined
    }
    return {
        kind,
        pieceName,
        componentName,
    }
}

export const createActivepiecesIrCompiler = (
    dependencies: ActivepiecesIrCompilerDependencies,
) => ({
    async compile(params: ActivepiecesIrCompilerParams): Promise<ActivepiecesIrCompilerResult> {
        const parsed = AutomationIrV1Schema.safeParse(params.automation)
        if (!parsed.success) {
            return {
                status: 'FAILED',
                diagnostics: [{
                    code: 'INVALID_IR',
                    message: parsed.error.issues.map((issue) => issue.message).join(' '),
                }],
            }
        }

        const automation = parsed.data
        const unsupported = validateSupportedGraph(automation)
        if (unsupported.length > 0) {
            return {
                status: 'FAILED',
                diagnostics: unsupported,
            }
        }

        const stepNameById = Object.fromEntries(
            automation.steps.map((step, index) => [
                step.id,
                `aa_step_${String(index + 1).padStart(3, '0')}`,
            ]),
        )

        const compiler = new CompilerContext({
            automation,
            connectionBindings: params.connectionBindings ?? {},
            dependencies,
            platformId: params.platformId,
            projectId: params.projectId,
            stepNameById,
        })

        try {
            const trigger = await compiler.compileTrigger()
            const createRequest = CreateFlowRequestSchema.parse({
                displayName: automation.name,
                projectId: params.projectId,
            })
            const importOperation = FlowOperationRequestSchema.parse({
                type: FlowOperationType.IMPORT_FLOW,
                request: {
                    displayName: automation.name,
                    trigger,
                    schemaVersion: null,
                    notes: [],
                },
            })

            return {
                status: 'COMPILED',
                createRequest,
                operations: [importOperation],
                stepNameById,
                diagnostics: [],
            }
        }
        catch (error) {
            if (error instanceof IrCompilerError) {
                return {
                    status: 'FAILED',
                    diagnostics: [error.diagnostic],
                }
            }
            throw error
        }
    },
})

class CompilerContext {
    private readonly stepById: Map<string, AutomationStep>
    private readonly pieceCache = new Map<string, Promise<CompilerPieceMetadata | undefined>>()

    constructor(private readonly params: {
        automation: AutomationIrV1
        connectionBindings: Record<string, string>
        dependencies: ActivepiecesIrCompilerDependencies
        platformId: string
        projectId: string
        stepNameById: Record<string, string>
    }) {
        this.stepById = new Map(params.automation.steps.map((step) => [step.id, step]))
    }

    async compileTrigger(): Promise<FlowTrigger> {
        const nextAction = this.params.automation.trigger.next === undefined
            ? undefined
            : await this.compileStep(this.params.automation.trigger.next)

        switch (this.params.automation.trigger.type) {
            case 'MANUAL':
                throw compilerError(
                    'UNSUPPORTED_TRIGGER',
                    'Manual triggers do not yet have a safe Activepieces runtime mapping.',
                )
            case 'SCHEDULE':
                return this.compileScheduleTrigger(nextAction)
            case 'EVENT':
                return this.compileEventTrigger(nextAction)
        }
    }

    private async compileScheduleTrigger(nextAction: FlowAction | undefined): Promise<FlowTrigger> {
        const piece = await this.resolvePiece(SCHEDULE_PIECE_NAME)
        const trigger = piece.triggers[SCHEDULE_TRIGGER_NAME]
        if (trigger === undefined) {
            throw compilerError(
                'COMPONENT_NOT_FOUND',
                `Schedule trigger "${SCHEDULE_TRIGGER_NAME}" is unavailable on "${SCHEDULE_PIECE_NAME}".`,
            )
        }

        return {
            name: 'trigger',
            displayName: 'Schedule',
            valid: true,
            lastUpdatedDate: this.params.dependencies.now(),
            type: FlowTriggerType.PIECE,
            nextAction,
            settings: {
                pieceName: piece.name,
                pieceVersion: piece.version,
                triggerName: trigger.name,
                input: {
                    cronExpression: this.params.automation.trigger.type === 'SCHEDULE'
                        ? this.params.automation.trigger.cron
                        : '',
                    timezone: this.params.automation.trigger.type === 'SCHEDULE'
                        ? (this.params.automation.trigger.timezone ?? 'UTC')
                        : 'UTC',
                },
                propertySettings: {},
            },
        }
    }

    private async compileEventTrigger(nextAction: FlowAction | undefined): Promise<FlowTrigger> {
        if (this.params.automation.trigger.type !== 'EVENT') {
            throw new Error('compileEventTrigger called for non-event trigger')
        }
        const capability = await this.resolveCapability({
            capabilityId: this.params.automation.trigger.capability,
            expectedKind: 'trigger',
        })
        validateInput({
            capabilityId: this.params.automation.trigger.capability,
            component: capability.component,
            input: this.params.automation.trigger.input,
        })
        const input = this.compileInput(this.params.automation.trigger.input)
        this.attachAuth({
            capabilityId: this.params.automation.trigger.capability,
            component: capability.component,
            input,
        })

        return {
            name: 'trigger',
            displayName: capability.component.displayName,
            valid: true,
            lastUpdatedDate: this.params.dependencies.now(),
            type: FlowTriggerType.PIECE,
            nextAction,
            settings: {
                pieceName: capability.piece.name,
                pieceVersion: capability.piece.version,
                triggerName: capability.component.name,
                input,
                propertySettings: {},
            },
        }
    }

    private async compileStep(stepId: string): Promise<FlowAction> {
        const step = this.stepById.get(stepId)
        if (step === undefined) {
            throw compilerError('INVALID_IR', `Unknown step "${stepId}".`, stepId)
        }

        switch (step.type) {
            case 'ACTION':
            case 'NOTIFICATION':
                return this.compilePieceAction(step)
            case 'CONDITION':
                return this.compileCondition(step)
            case 'AI_DECISION':
                throw compilerError(
                    'UNSUPPORTED_STEP',
                    'AI_DECISION requires a dedicated AI-router execution contract before it can be compiled safely.',
                    step.id,
                )
            case 'APPROVAL_GATE':
                throw compilerError(
                    'UNSUPPORTED_STEP',
                    'APPROVAL_GATE requires a dedicated approval runtime contract before it can be compiled safely.',
                    step.id,
                )
        }
    }

    private async compilePieceAction(
        step: Extract<AutomationStep, { type: 'ACTION' | 'NOTIFICATION' }>,
    ): Promise<FlowAction> {
        const capability = await this.resolveCapability({
            capabilityId: step.capability,
            expectedKind: 'action',
            stepId: step.id,
        })
        validateInput({
            capabilityId: step.capability,
            component: capability.component,
            input: step.input,
            stepId: step.id,
        })
        const input = this.compileInput(step.input)
        this.attachAuth({
            capabilityId: step.capability,
            component: capability.component,
            input,
            stepId: step.id,
        })

        return {
            name: this.stepName(step.id),
            displayName: step.name,
            valid: true,
            lastUpdatedDate: this.params.dependencies.now(),
            type: FlowActionType.PIECE,
            settings: {
                pieceName: capability.piece.name,
                pieceVersion: capability.piece.version,
                actionName: capability.component.name,
                input,
                propertySettings: {},
            },
            nextAction: step.next === undefined
                ? undefined
                : await this.compileStep(step.next),
        }
    }

    private async compileCondition(
        step: Extract<AutomationStep, { type: 'CONDITION' }>,
    ): Promise<FlowAction> {
        const condition = compileBranchCondition(step, this.params.stepNameById)
        return {
            name: this.stepName(step.id),
            displayName: step.name,
            valid: true,
            lastUpdatedDate: this.params.dependencies.now(),
            type: FlowActionType.ROUTER,
            settings: {
                executionType: RouterExecutionType.EXECUTE_FIRST_MATCH,
                branches: [
                    {
                        branchType: BranchExecutionType.CONDITION,
                        branchName: 'True',
                        conditions: [[condition]],
                    },
                    {
                        branchType: BranchExecutionType.FALLBACK,
                        branchName: 'False',
                    },
                ],
            },
            children: [
                step.ifTrue === undefined ? null : await this.compileStep(step.ifTrue),
                step.ifFalse === undefined ? null : await this.compileStep(step.ifFalse),
            ],
        }
    }

    private compileInput(
        input: Record<string, AutomationValue>,
    ): Record<string, unknown> {
        return Object.fromEntries(
            Object.entries(input).map(([key, value]) => [
                key,
                compileAutomationValue(value, this.params.stepNameById),
            ]),
        )
    }

    private attachAuth(params: {
        capabilityId: string
        component: CompilerComponentMetadata
        input: Record<string, unknown>
        stepId?: string
    }): void {
        if (!params.component.requireAuth) {
            return
        }
        const externalId = this.params.connectionBindings[params.capabilityId]
        if (externalId === undefined || externalId.trim().length === 0) {
            throw compilerError(
                'MISSING_CONNECTION_BINDING',
                `Capability "${params.capabilityId}" requires an explicit project connection binding.`,
                params.stepId,
                params.capabilityId,
            )
        }
        if (!SAFE_EXTERNAL_ID_PATTERN.test(externalId)) {
            throw compilerError(
                'INVALID_CONNECTION_BINDING',
                `Connection externalId for "${params.capabilityId}" contains characters that are unsafe in an Activepieces connection expression.`,
                params.stepId,
                params.capabilityId,
            )
        }
        params.input.auth = `{{connections['${externalId}']}}`
    }

    private async resolveCapability(params: {
        capabilityId: string
        expectedKind: ActivepiecesCapabilityId['kind']
        stepId?: string
    }): Promise<{
        parsed: ActivepiecesCapabilityId
        piece: CompilerPieceMetadata
        component: CompilerComponentMetadata
    }> {
        const parsed = parseActivepiecesCapabilityId(params.capabilityId)
        if (parsed === undefined) {
            throw compilerError(
                'INVALID_CAPABILITY_ID',
                `Capability "${params.capabilityId}" is not a valid Activepieces capability id.`,
                params.stepId,
                params.capabilityId,
            )
        }
        if (parsed.kind !== params.expectedKind) {
            throw compilerError(
                'CAPABILITY_KIND_MISMATCH',
                `Capability "${params.capabilityId}" is ${parsed.kind}, but ${params.expectedKind} is required here.`,
                params.stepId,
                params.capabilityId,
            )
        }

        const piece = await this.resolvePiece(parsed.pieceName, params.stepId, params.capabilityId)
        const component = parsed.kind === 'action'
            ? piece.actions[parsed.componentName]
            : piece.triggers[parsed.componentName]
        if (component === undefined) {
            throw compilerError(
                'COMPONENT_NOT_FOUND',
                `${parsed.kind} "${parsed.componentName}" no longer exists on piece "${parsed.pieceName}".`,
                params.stepId,
                params.capabilityId,
            )
        }

        return {
            parsed,
            piece,
            component,
        }
    }

    private async resolvePiece(
        pieceName: string,
        stepId?: string,
        capabilityId?: string,
    ): Promise<CompilerPieceMetadata> {
        let lookup = this.pieceCache.get(pieceName)
        if (lookup === undefined) {
            lookup = this.params.dependencies.getPiece({
                name: pieceName,
                platformId: this.params.platformId,
                projectId: this.params.projectId,
            })
            this.pieceCache.set(pieceName, lookup)
        }
        const piece = await lookup
        if (piece === undefined) {
            throw compilerError(
                'PIECE_NOT_VISIBLE_OR_MISSING',
                `Piece "${pieceName}" is unavailable in this project scope.`,
                stepId,
                capabilityId,
            )
        }
        return piece
    }

    private stepName(stepId: string): string {
        const name = this.params.stepNameById[stepId]
        if (name === undefined) {
            throw compilerError('INVALID_IR', `No Activepieces step name allocated for "${stepId}".`, stepId)
        }
        return name
    }
}

function validateSupportedGraph(automation: AutomationIrV1): ActivepiecesIrCompilerDiagnostic[] {
    const diagnostics: ActivepiecesIrCompilerDiagnostic[] = []

    if (automation.trigger.type === 'MANUAL') {
        diagnostics.push({
            code: 'UNSUPPORTED_TRIGGER',
            message: 'Manual triggers do not yet have a safe Activepieces runtime mapping.',
        })
    }

    for (const step of automation.steps) {
        if (step.type === 'AI_DECISION') {
            diagnostics.push({
                code: 'UNSUPPORTED_STEP',
                message: 'AI_DECISION is not supported by the Phase 4B compiler.',
                stepId: step.id,
            })
        }
        if (step.type === 'APPROVAL_GATE') {
            diagnostics.push({
                code: 'UNSUPPORTED_STEP',
                message: 'APPROVAL_GATE is not supported by the Phase 4B compiler.',
                stepId: step.id,
            })
        }
    }

    const incoming = new Map<string, number>()
    for (const step of automation.steps) {
        for (const target of targetsForStep(step)) {
            incoming.set(target, (incoming.get(target) ?? 0) + 1)
        }
    }

    for (const [stepId, count] of incoming.entries()) {
        if (count > 1) {
            diagnostics.push({
                code: 'UNSUPPORTED_SHARED_STEP',
                message: `Step "${stepId}" has ${count} incoming control-flow edges. Phase 4B supports tree-shaped branching but not branch joins/shared downstream steps yet.`,
                stepId,
            })
        }
    }

    return diagnostics
}

function targetsForStep(step: AutomationStep): string[] {
    switch (step.type) {
        case 'ACTION':
        case 'NOTIFICATION':
            return step.next === undefined ? [] : [step.next]
        case 'CONDITION':
            return [step.ifTrue, step.ifFalse].filter((value): value is string => value !== undefined)
        case 'AI_DECISION':
            return [
                ...step.routes.map((route) => route.next),
                step.fallback,
            ].filter((value): value is string => value !== undefined)
        case 'APPROVAL_GATE':
            return [step.onApproved, step.onRejected].filter((value): value is string => value !== undefined)
    }
}

function validateInput(params: {
    capabilityId: string
    component: CompilerComponentMetadata
    input: Record<string, AutomationValue>
    stepId?: string
}): void {
    for (const key of Object.keys(params.input)) {
        if (!(key in params.component.props)) {
            throw compilerError(
                'UNKNOWN_INPUT_PROPERTY',
                `Input property "${key}" does not exist on capability "${params.capabilityId}".`,
                params.stepId,
                params.capabilityId,
            )
        }
    }

    for (const [key, property] of Object.entries(params.component.props)) {
        if (property.required === true && !(key in params.input)) {
            throw compilerError(
                'MISSING_REQUIRED_INPUT',
                `Required input property "${key}" is missing for capability "${params.capabilityId}".`,
                params.stepId,
                params.capabilityId,
            )
        }
    }
}

function compileAutomationValue(
    value: AutomationValue,
    stepNameById: Record<string, string>,
): unknown {
    if (isReference(value)) {
        return compileReference(value, stepNameById)
    }
    if (Array.isArray(value)) {
        return value.map((item) => compileAutomationValue(item, stepNameById))
    }
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [
                key,
                compileAutomationValue(nested, stepNameById),
            ]),
        )
    }
    return value
}

function compileReference(
    reference: AutomationReference,
    stepNameById: Record<string, string>,
): string {
    const base = reference.source === 'TRIGGER'
        ? 'trigger'
        : stepNameById[reference.stepId]
    if (base === undefined) {
        throw compilerError(
            'INVALID_IR',
            `Reference points to unknown step "${reference.source === 'STEP' ? reference.stepId : 'trigger'}".`,
            reference.source === 'STEP' ? reference.stepId : undefined,
        )
    }

    const path = reference.path.map((segment) => {
        if (typeof segment === 'number') {
            return `[${segment}]`
        }
        return `['${segment.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}']`
    }).join('')

    return `{{${base}['output']${path}}}`
}

function compileBranchCondition(
    step: Extract<AutomationStep, { type: 'CONDITION' }>,
    stepNameById: Record<string, string>,
): {
    firstValue: string
    operator: BranchOperator
    secondValue?: string
    caseSensitive?: boolean
} {
    const firstValue = conditionValue(step.expression.left, stepNameById)
    const right = step.expression.right

    switch (step.expression.operator) {
        case 'EQUALS':
            if (typeof right === 'boolean') {
                return {
                    firstValue,
                    operator: right ? BranchOperator.BOOLEAN_IS_TRUE : BranchOperator.BOOLEAN_IS_FALSE,
                }
            }
            if (typeof right === 'number') {
                return {
                    firstValue,
                    operator: BranchOperator.NUMBER_IS_EQUAL_TO,
                    secondValue: String(right),
                }
            }
            if (right === null || right === undefined) {
                throw compilerError('UNSUPPORTED_CONDITION', 'EQUALS with null/undefined is not supported.', step.id)
            }
            return {
                firstValue,
                operator: BranchOperator.TEXT_EXACTLY_MATCHES,
                secondValue: conditionValue(right, stepNameById),
                caseSensitive: true,
            }
        case 'NOT_EQUALS':
            if (typeof right === 'boolean') {
                return {
                    firstValue,
                    operator: right ? BranchOperator.BOOLEAN_IS_FALSE : BranchOperator.BOOLEAN_IS_TRUE,
                }
            }
            if (typeof right === 'number') {
                throw compilerError(
                    'UNSUPPORTED_CONDITION',
                    'Numeric NOT_EQUALS has no exact single Activepieces branch operator.',
                    step.id,
                )
            }
            if (right === null || right === undefined) {
                throw compilerError('UNSUPPORTED_CONDITION', 'NOT_EQUALS with null/undefined is not supported.', step.id)
            }
            return {
                firstValue,
                operator: BranchOperator.TEXT_DOES_NOT_EXACTLY_MATCH,
                secondValue: conditionValue(right, stepNameById),
                caseSensitive: true,
            }
        case 'GREATER_THAN':
            return binaryCondition(step, BranchOperator.NUMBER_IS_GREATER_THAN, stepNameById)
        case 'LESS_THAN':
            return binaryCondition(step, BranchOperator.NUMBER_IS_LESS_THAN, stepNameById)
        case 'GREATER_THAN_OR_EQUAL':
        case 'LESS_THAN_OR_EQUAL':
            throw compilerError(
                'UNSUPPORTED_CONDITION',
                `Condition operator "${step.expression.operator}" has no single equivalent Activepieces branch operator yet.`,
                step.id,
            )
        case 'CONTAINS':
            return binaryCondition(step, BranchOperator.TEXT_CONTAINS, stepNameById, true)
        case 'NOT_CONTAINS':
            return binaryCondition(step, BranchOperator.TEXT_DOES_NOT_CONTAIN, stepNameById, true)
        case 'EXISTS':
            return {
                firstValue,
                operator: BranchOperator.EXISTS,
            }
        case 'NOT_EXISTS':
            return {
                firstValue,
                operator: BranchOperator.DOES_NOT_EXIST,
            }
        case 'IS_TRUE':
            return {
                firstValue,
                operator: BranchOperator.BOOLEAN_IS_TRUE,
            }
        case 'IS_FALSE':
            return {
                firstValue,
                operator: BranchOperator.BOOLEAN_IS_FALSE,
            }
    }
}

function binaryCondition(
    step: Extract<AutomationStep, { type: 'CONDITION' }>,
    operator: BranchOperator,
    stepNameById: Record<string, string>,
    caseSensitive?: boolean,
): {
    firstValue: string
    operator: BranchOperator
    secondValue: string
    caseSensitive?: boolean
} {
    if (step.expression.right === undefined) {
        throw compilerError(
            'UNSUPPORTED_CONDITION',
            `Condition operator "${step.expression.operator}" requires a right-hand value.`,
            step.id,
        )
    }
    return {
        firstValue: conditionValue(step.expression.left, stepNameById),
        operator,
        secondValue: conditionValue(step.expression.right, stepNameById),
        ...(caseSensitive === undefined ? {} : { caseSensitive }),
    }
}

function conditionValue(
    value: AutomationValue,
    stepNameById: Record<string, string>,
): string {
    if (isReference(value)) {
        return compileReference(value, stepNameById)
    }
    if (
        typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
    ) {
        return String(value)
    }
    throw compilerError(
        'UNSUPPORTED_CONDITION',
        'Condition operands must be scalar values or direct trigger/step references in Phase 4B.',
    )
}

function isReference(value: AutomationValue): value is AutomationReference {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && 'kind' in value
        && value.kind === 'REFERENCE'
}

class IrCompilerError extends Error {
    constructor(readonly diagnostic: ActivepiecesIrCompilerDiagnostic) {
        super(diagnostic.message)
    }
}

function compilerError(
    code: ActivepiecesIrCompilerDiagnosticCode,
    message: string,
    stepId?: string,
    capabilityId?: string,
): IrCompilerError {
    return new IrCompilerError({
        code,
        message,
        ...(stepId === undefined ? {} : { stepId }),
        ...(capabilityId === undefined ? {} : { capabilityId }),
    })
}
