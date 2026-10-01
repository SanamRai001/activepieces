import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { automationArchitectActivationController } from './activation.controller'

export const automationArchitectModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(automationArchitectActivationController, {
        prefix: '/v1/automation-architect/flows',
    })
}
