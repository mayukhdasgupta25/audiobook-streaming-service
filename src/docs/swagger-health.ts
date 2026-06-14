/**
 * OpenAPI path definitions — streaming health
 */

/**
 * @swagger
 * /api/stream/health:
 *   get:
 *     summary: Streaming service health check
 *     description: Returns component health (database, Redis, RabbitMQ, storage, FFmpeg, Bull workers). Requires support Basic auth.
 *     tags: [Health]
 *     security:
 *       - healthBasicAuth: []
 *     responses:
 *       200:
 *         description: All components healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthStatus'
 *             example:
 *               status: healthy
 *               service: audio-streaming
 *               timestamp: "2024-01-15T10:30:00Z"
 *               components:
 *                 database: true
 *                 redis: true
 *                 rabbitmq: true
 *                 storage: true
 *                 ffmpeg: true
 *                 bullWorkers: true
 *       503:
 *         description: One or more components unhealthy or degraded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthStatus'
 *             example:
 *               status: degraded
 *               service: audio-streaming
 *               timestamp: "2024-01-15T10:30:00Z"
 *               components:
 *                 database: true
 *                 redis: false
 *                 rabbitmq: true
 *                 storage: true
 *                 ffmpeg: true
 *                 bullWorkers: true
 *       401:
 *         description: Basic auth required
 *       500:
 *         description: Health check failed
 *         content:
 *           application/json:
 *             example:
 *               status: unhealthy
 *               service: audio-streaming
 *               error: "Health check failed"
 *               timestamp: "2024-01-15T10:30:00Z"
 */

export {};
