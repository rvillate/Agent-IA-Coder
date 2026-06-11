const JOB_TYPES = ['shell.exec', 'file.list', 'file.read', 'file.write', 'file.delete', 'file.mkdir', 'file.search', 'git.status', 'git.diff']

const looseObjectSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true
}

const nullableLooseObjectSchema = {
  anyOf: [
    looseObjectSchema,
    { type: 'null' }
  ]
}

const patchJobRequestSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: JOB_TYPES,
      description: 'Nuevo tipo de job, solo si se quiere cambiar.'
    },
    runnerTarget: {
      type: 'string',
      description: 'ID del runner destino.'
    },
    payload: {
      ...looseObjectSchema,
      description: 'Payload JSON del job.'
    },
    priority: {
      type: 'integer',
      description: 'Prioridad del job.'
    },
    note: {
      type: 'string',
      description: 'Nota opcional del job.'
    }
  },
  additionalProperties: false
}

export function buildOpenApi(baseUrl) {
  const url = baseUrl?.replace(/\/$/, '') || ''
  return {
    openapi: '3.1.0',
    info: {
      title: 'Agent Coder Central Gateway',
      version: '1.0.0',
      description: 'API central para crear jobs de desarrollo local y consultar runners remotos conectados.'
    },
    servers: [{ url }],
    components: {
      securitySchemes: {
        AgentApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-agent-key'
        }
      },
      schemas: {
        CreateJobRequest: {
          type: 'object',
          required: ['type', 'runnerTarget', 'payload'],
          properties: {
            type: {
              type: 'string',
              enum: JOB_TYPES
            },
            runnerTarget: {
              type: 'string',
              description: 'ID del runner destino, por ejemplo local-runner-1.'
            },
            payload: {
              ...looseObjectSchema,
              description: 'Payload JSON específico del tipo de job.'
            },
            priority: {
              type: 'integer',
              default: 0
            },
            note: {
              type: 'string'
            }
          },
          additionalProperties: false
        },
        PatchJobRequest: patchJobRequestSchema,
        Job: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            status: { type: 'string' },
            runnerTarget: { type: 'string' },
            claimedBy: { type: ['string', 'null'] },
            exitCode: { type: ['integer', 'null'] },
            summary: { type: ['string', 'null'] },
            error: { type: ['string', 'null'] },
            stdoutTail: { type: 'string' },
            stderrTail: { type: 'string' },
            result: nullableLooseObjectSchema,
            payload: nullableLooseObjectSchema,
            note: { type: ['string', 'null'] },
            localLogPath: { type: ['string', 'null'] },
            truncated: { type: ['boolean', 'null'] },
            createdAt: { type: 'integer' },
            updatedAt: { type: 'integer' },
            startedAt: { type: ['integer', 'null'] },
            finishedAt: { type: ['integer', 'null'] }
          },
          additionalProperties: true
        }
      }
    },
    security: [{ AgentApiKey: [] }],
    paths: {
      '/api/health': {
        get: {
          operationId: 'health',
          summary: 'Verifica si la API central está funcionando',
          security: [],
          responses: { '200': { description: 'Estado de salud' } }
        }
      },
      '/api/runners': {
        get: {
          operationId: 'listRunners',
          summary: 'Lista runners conectados o registrados',
          responses: { '200': { description: 'Lista de runners' } }
        }
      },
      '/api/jobs': {
        get: {
          operationId: 'listJobs',
          summary: 'Lista jobs recientes de forma resumida',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'runnerTarget', in: 'query', schema: { type: 'string' } }
          ],
          responses: { '200': { description: 'Jobs recientes' } }
        },
        post: {
          operationId: 'createJob',
          summary: 'Crea un job en cola para un runner remoto',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateJobRequest' }
              }
            }
          },
          responses: { '200': { description: 'Job creado' } }
        }
      },
      '/api/jobs/bulk': {
        post: {
          operationId: 'createJobsBulk',
          summary: 'Crea varios jobs en cola',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['jobs'],
                  properties: {
                    jobs: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/CreateJobRequest' }
                    }
                  },
                  additionalProperties: false
                }
              }
            }
          },
          responses: { '200': { description: 'Jobs creados' } }
        }
      },
      '/api/jobs/{id}': {
        get: {
          operationId: 'getJob',
          summary: 'Obtiene un job específico con resultado resumido',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Job' } }
        },
        patch: {
          operationId: 'patchJob',
          summary: 'Actualiza campos básicos de un job queued',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PatchJobRequest' }
              }
            }
          },
          responses: { '200': { description: 'Job actualizado' } }
        },
        delete: {
          operationId: 'deleteJob',
          summary: 'Elimina un job por ID',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Job eliminado' } }
        }
      },
      '/api/jobs/{id}/cancel': {
        post: {
          operationId: 'cancelJob',
          summary: 'Cancela un job queued o marca cancel_requested si está corriendo',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Job cancelado o marcado' } }
        }
      },
      '/api/jobs/{id}/requeue': {
        post: {
          operationId: 'requeueJob',
          summary: 'Vuelve a poner un job en cola',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Job reencolado' } }
        }
      }
    }
  }
}
