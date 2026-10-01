import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { automationArchitectActivationController } from './activation.controller'
import { runtimeSupervisionService } from './runtime-supervision.service'

export const automationArchitectModule: FastifyPluginAsyncZod = async (app) => {
    runtimeSupervisionService(app.log).setup()
    await app.register(automationArchitectActivationController, {
        prefix: '/v1/automation-architect/flows',
    })
}
