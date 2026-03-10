function toPascalCase(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function hasRef(schema) {
  return Boolean(schema && typeof schema === 'object' && schema.$ref)
}

function singularize(value) {
  if (!value) return value
  if (value.endsWith('ies') && value.length > 3) return `${value.slice(0, -3)}y`
  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 1) return value.slice(0, -1)
  return value
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

module.exports = (openApi) => {
  if (!openApi || typeof openApi !== 'object') return openApi

  const spec = openApi
  spec.components = spec.components || {}
  spec.components.schemas = spec.components.schemas || {}

  const usedNames = new Set(Object.keys(spec.components.schemas))
  const hashToName = new Map()
  const pendingComponents = new Set()
  const paths = spec.paths || {}
  const verbs = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']

  const ensureUniqueName = (preferredName) => {
    const baseName = toPascalCase(preferredName) || 'Schema'
    let schemaName = baseName
    let index = 2
    while (usedNames.has(schemaName)) {
      schemaName = `${baseName}${index}`
      index += 1
    }
    usedNames.add(schemaName)
    return schemaName
  }

  const isHoistableObjectSchema = (schema) => {
    if (!schema || typeof schema !== 'object' || hasRef(schema)) return false
    const hasProperties = schema.properties && typeof schema.properties === 'object' && Object.keys(schema.properties).length > 0
    const hasCompositions =
      (Array.isArray(schema.allOf) && schema.allOf.length > 0) ||
      (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) ||
      (Array.isArray(schema.anyOf) && schema.anyOf.length > 0)
    return hasProperties || hasCompositions
  }

  const createChildName = (parentName, segment, arrayItem) => {
    const parentBase = String(parentName || 'Model').replace(/(Response|Schema|DTO)+$/i, '') || 'Model'
    const rawSegment = segment || 'item'
    const cleanedSegment = arrayItem ? singularize(rawSegment) : rawSegment
    const segmentName = toPascalCase(cleanedSegment) || 'Item'
    if (segmentName.toLowerCase() === 'data') {
      return `${parentBase}${arrayItem ? 'Item' : 'Data'}Schema`
    }
    const itemSuffix = arrayItem && segmentName.toLowerCase() !== 'item' ? 'Item' : ''
    return `${parentBase}${segmentName}${itemSuffix}Schema`
  }

  const normalizeSchema = (schema, schemaName) => {
    if (!schema || typeof schema !== 'object' || hasRef(schema)) return schema

    if (Array.isArray(schema.allOf)) {
      schema.allOf = schema.allOf.map((item, idx) => normalizeInline(item, schemaName, `allOf${idx}`, false))
    }
    if (Array.isArray(schema.oneOf)) {
      schema.oneOf = schema.oneOf.map((item, idx) => normalizeInline(item, schemaName, `oneOf${idx}`, false))
    }
    if (Array.isArray(schema.anyOf)) {
      schema.anyOf = schema.anyOf.map((item, idx) => normalizeInline(item, schemaName, `anyOf${idx}`, false))
    }

    if (schema.properties && typeof schema.properties === 'object') {
      for (const propName of Object.keys(schema.properties)) {
        const propSchema = schema.properties[propName]
        if (propSchema && typeof propSchema === 'object' && propSchema.type === 'array' && propSchema.items && typeof propSchema.items === 'object') {
          propSchema.items = normalizeInline(propSchema.items, schemaName, propName, true)
          schema.properties[propName] = normalizeSchema(propSchema, schemaName)
        } else {
          schema.properties[propName] = normalizeInline(propSchema, schemaName, propName, false)
        }
      }
    }

    if (schema.type === 'array' && schema.items && typeof schema.items === 'object') {
      schema.items = normalizeInline(schema.items, schemaName, 'item', true)
    }

    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      schema.additionalProperties = normalizeInline(schema.additionalProperties, schemaName, 'value', false)
    }

    return schema
  }

  const normalizeInline = (schema, parentName, segment, arrayItem) => {
    if (!schema || typeof schema !== 'object' || hasRef(schema)) return schema
    if (!isHoistableObjectSchema(schema)) return normalizeSchema(schema, parentName)

    const preferredName = createChildName(parentName, segment, arrayItem)
    const normalized = normalizeSchema(clone(schema), preferredName)
    const hash = stableStringify(normalized)
    if (hashToName.has(hash)) {
      return { $ref: `#/components/schemas/${hashToName.get(hash)}` }
    }
    const componentName = ensureUniqueName(preferredName)
    spec.components.schemas[componentName] = normalized
    hashToName.set(hash, componentName)
    pendingComponents.add(componentName)
    return { $ref: `#/components/schemas/${componentName}` }
  }

  for (const pathKey of Object.keys(paths)) {
    const pathItem = paths[pathKey]
    if (!pathItem || typeof pathItem !== 'object') continue

    for (const verb of verbs) {
      const operation = pathItem[verb]
      if (!operation || typeof operation !== 'object') continue

      const operationId = operation.operationId
      if (!operationId) continue

      const responses = operation.responses
      if (!responses || typeof responses !== 'object') continue

      for (const statusCode of Object.keys(responses)) {
        if (!/^2\d\d$/.test(statusCode)) continue

        const response = responses[statusCode]
        const content = response && response.content
        const jsonSchema = content && content['application/json'] && content['application/json'].schema
        if (!jsonSchema || hasRef(jsonSchema)) continue

        let baseName = `${toPascalCase(operationId)}Response`
        if (!baseName) baseName = 'OperationResponse'

        const schemaName = ensureUniqueName(baseName)

        spec.components.schemas[schemaName] = clone(jsonSchema)
        pendingComponents.add(schemaName)
        content['application/json'].schema = { $ref: `#/components/schemas/${schemaName}` }
      }
    }
  }

  for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
    const normalized = normalizeSchema(schema, schemaName)
    spec.components.schemas[schemaName] = normalized
    hashToName.set(stableStringify(normalized), schemaName)
  }

  while (pendingComponents.size > 0) {
    const current = Array.from(pendingComponents)
    pendingComponents.clear()
    for (const schemaName of current) {
      const schema = spec.components.schemas[schemaName]
      if (!schema) continue
      const normalized = normalizeSchema(schema, schemaName)
      spec.components.schemas[schemaName] = normalized
      hashToName.set(stableStringify(normalized), schemaName)
    }
  }

  return spec
}
