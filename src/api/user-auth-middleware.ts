import type { FastifyRequest, FastifyReply } from "fastify";
import "@fastify/jwt";

export interface UserAuth {
    userId: string;
    role: "USER" | "ADMIN";
}

declare module "@fastify/jwt" {
    interface FastifyJWT {
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

export const createAdminAuthMiddleware = () => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            await request.jwtVerify();
            if (request.user.role !== "ADMIN") {
                return reply.status(403).send({
                    code: "FORBIDDEN",
                    message: "Admin role required for this action."
                });
            }
        } catch (err) {
            reply.status(401).send({
                code: "UNAUTHORIZED",
                message: "Missing or invalid authentication token."
            });
        }
    };
};
