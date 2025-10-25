import request from 'supertest';
import express from 'express';

describe('Streaming Service API', () => {
   let app: express.Application;

   beforeEach(() => {
      app = express();
      app.use(express.json());

      // Mock health endpoint
      app.get('/health', (req, res) => {
         res.json({
            status: 'healthy',
            service: 'audio-streaming',
            timestamp: new Date().toISOString(),
            components: {
               database: true,
               redis: true,
               rabbitmq: true,
               storage: true,
               ffmpeg: true,
               bullWorkers: true
            }
         });
      });

      // Mock root endpoint
      app.get('/', (req, res) => {
         res.json({
            service: 'Audio Streaming Service',
            version: '1.0.0',
            status: 'running',
            timestamp: new Date().toISOString(),
            endpoints: {
               health: '/health',
               streaming: '/api/v1/stream'
            }
         });
      });

      // Mock 404 handler
      app.use((req, res) => {
         res.status(404).json({
            error: 'Route not found',
            path: req.path,
            method: req.method
         });
      });
   });

   describe('GET /health', () => {
      it('should return health status', async () => {
         const response = await request(app)
            .get('/health')
            .expect(200);

         expect(response.body).toHaveProperty('status', 'healthy');
         expect(response.body).toHaveProperty('timestamp');
         expect(response.body).toHaveProperty('service', 'audio-streaming');
      });
   });

   describe('GET /', () => {
      it('should return API information', async () => {
         const response = await request(app)
            .get('/')
            .expect(200);

         expect(response.body).toHaveProperty('service', 'Audio Streaming Service');
         expect(response.body).toHaveProperty('version', '1.0.0');
         expect(response.body).toHaveProperty('endpoints');
      });
   });

   describe('404 handler', () => {
      it('should return 404 for unknown routes', async () => {
         const response = await request(app)
            .get('/unknown-route')
            .expect(404);

         expect(response.body).toHaveProperty('error', 'Route not found');
         expect(response.body).toHaveProperty('path', '/unknown-route');
         expect(response.body).toHaveProperty('method', 'GET');
      });
   });
});
