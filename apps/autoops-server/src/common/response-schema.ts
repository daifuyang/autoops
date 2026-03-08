export const apiResponseSchema = (dataSchema: Record<string, unknown>) => ({
  type: 'object',
  properties: {
    code: { type: 'number' },
    success: { type: 'boolean' },
    msg: { type: 'string' },
    data: dataSchema
  }
})

export const paginatedDataSchema = (itemSchema: Record<string, unknown>) => ({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: itemSchema
    },
    page: { type: 'number' },
    pageSize: { type: 'number' },
    total: { type: 'number' },
    totalPages: { type: 'number' }
  },
  required: ['items', 'page', 'pageSize', 'total', 'totalPages']
})
