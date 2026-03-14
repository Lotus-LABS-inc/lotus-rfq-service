import type { FastifyRequest, FastifyReply } from "fastify";
import "@fastify/jwt";

export interface UserAuth {
    userId: string;
    role: "USER" | "ADMIN";
}

export interface AdminPreviewMiddlewareConfig {
    enabled: boolean;
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

const isLoopbackRequest = (request: FastifyRequest): boolean => {
    const hostHeader = typeof request.headers.host === "string" ? request.headers.host : "";
    const host = hostHeader.split(":")[0]?.toLowerCase() ?? "";
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        return true;
    }

    return request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1";
};

export const createAdminSimulationPreviewMiddleware = (config: AdminPreviewMiddlewareConfig) => {
    const adminAuthMiddleware = createAdminAuthMiddleware();

    return async (request: FastifyRequest, reply: FastifyReply) => {
        if (config.enabled && isLoopbackRequest(request)) {
            const previewUser = request as FastifyRequest & { user: UserAuth };
            previewUser.user = {
                userId: "dev-simulation-preview",
                role: "ADMIN"
            };
            return;
        }

        return adminAuthMiddleware(request, reply);
    };
};
