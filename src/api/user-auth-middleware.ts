import type { FastifyRequest, FastifyReply } from "fastify";

export interface UserAuth {
    userId: string;
}

declare module "fastify" {
    interface FastifyRequest {
        user: UserAuth;
    }
}

export const createUserAuthMiddleware = () => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            await request.jwtVerify();
        } catch (err) {
            reply.status(401).send({
                code: "UNAUTHORIZED",
                message: "Missing or invalid authentication token."
            });
        }
    };
};
