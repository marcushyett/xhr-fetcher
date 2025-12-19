/**
 * JSON Schema generator - infers schema from sample data
 */

export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  additionalProperties?: boolean;
  examples?: unknown[];
  oneOf?: JSONSchema[];
  nullable?: boolean;
}

/**
 * Get the JSON Schema type for a value
 */
function getType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return type;
}

/**
 * Merge two schemas (for array items with mixed types)
 */
function mergeSchemas(a: JSONSchema, b: JSONSchema): JSONSchema {
  const typeA = a.type;
  const typeB = b.type;

  // If same type, merge properties for objects
  if (typeA === typeB) {
    if (typeA === 'object' && a.properties && b.properties) {
      const mergedProps: Record<string, JSONSchema> = { ...a.properties };
      for (const [key, schema] of Object.entries(b.properties)) {
        if (mergedProps[key]) {
          mergedProps[key] = mergeSchemas(mergedProps[key], schema);
        } else {
          mergedProps[key] = schema;
        }
      }
      return {
        type: 'object',
        properties: mergedProps,
        additionalProperties: true,
      };
    }
    return a;
  }

  // Different types - use oneOf
  const types = new Set<string>();
  const schemas: JSONSchema[] = [];

  const addSchema = (schema: JSONSchema) => {
    const t = Array.isArray(schema.type) ? schema.type : [schema.type || 'unknown'];
    t.forEach(type => {
      if (!types.has(type as string)) {
        types.add(type as string);
        schemas.push(schema);
      }
    });
  };

  if (a.oneOf) {
    a.oneOf.forEach(addSchema);
  } else {
    addSchema(a);
  }

  if (b.oneOf) {
    b.oneOf.forEach(addSchema);
  } else {
    addSchema(b);
  }

  if (schemas.length === 1) {
    return schemas[0];
  }

  return { oneOf: schemas };
}

/**
 * Infer JSON Schema from a value
 */
export function inferJsonSchema(value: unknown, maxExamples = 3, maxDepth = 10): JSONSchema {
  if (maxDepth <= 0) {
    return { type: 'object', additionalProperties: true };
  }

  const type = getType(value);

  if (type === 'null') {
    return { type: 'null' };
  }

  if (type === 'string') {
    const str = value as string;
    const example = str.length > 100 ? str.substring(0, 100) + '...' : str;
    return {
      type: 'string',
      examples: [example],
    };
  }

  if (type === 'number' || type === 'integer') {
    return {
      type,
      examples: [value],
    };
  }

  if (type === 'boolean') {
    return {
      type: 'boolean',
      examples: [value],
    };
  }

  if (type === 'array') {
    const arr = value as unknown[];
    if (arr.length === 0) {
      return {
        type: 'array',
        items: {},
      };
    }

    // Infer schema from all items and merge
    let itemSchema: JSONSchema | null = null;
    const sampleItems = arr.slice(0, maxExamples);

    for (const item of sampleItems) {
      const schema = inferJsonSchema(item, maxExamples, maxDepth - 1);
      if (itemSchema === null) {
        itemSchema = schema;
      } else {
        itemSchema = mergeSchemas(itemSchema, schema);
      }
    }

    return {
      type: 'array',
      items: itemSchema || {},
    };
  }

  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const properties: Record<string, JSONSchema> = {};
    const required: string[] = [];

    for (const [key, val] of Object.entries(obj)) {
      properties[key] = inferJsonSchema(val, maxExamples, maxDepth - 1);
      if (val !== null && val !== undefined) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: true,
    };
  }

  return { type: 'unknown' };
}

/**
 * Create a sample from data (truncated for large responses)
 */
export function createSample(data: unknown, maxArrayItems = 2, maxStringLength = 200): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return data.length > maxStringLength
      ? data.substring(0, maxStringLength) + '...'
      : data;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.slice(0, maxArrayItems).map(item =>
      createSample(item, maxArrayItems, maxStringLength)
    );
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = createSample(value, maxArrayItems, maxStringLength);
    }
    return result;
  }

  return data;
}

/**
 * Parse JSON safely, returning null on failure
 */
export function safeJsonParse(str: string): unknown | null {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
